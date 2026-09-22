import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import styles from "./Activity.module.css";

const ENDPOINT = "https://stats.xthehacker2000x.workers.dev/";
const REQUEST_TIMEOUT = 10_000;
const WEEKS = 52;
const DAY_MS = 86_400_000;
/** Keeps a tooltip from touching the viewport edge. */
const EDGE_GAP = 8;
/** Cells described closer together than this are one sweep, not two moves. */
const SWEEP_MS = 140;

/** `max` wins when the space is too small to satisfy both bounds. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

type Metric = "steps" | "tokens";

/**
 * `color` is the primary for that metric: the four filled cell shades are
 * mixed from it towards the page in CSS, so one value sets the whole ramp.
 */
const METRICS: { id: Metric; label: string; color: string }[] = [
  { id: "steps", label: "Steps", color: "rgb(49, 95, 187)" },
  { id: "tokens", label: "Tokens", color: "rgb(124, 58, 237)" },
];

interface Props {
  /** Overrides the built-in primary of either metric. */
  colors?: Partial<Record<Metric, string>>;
}

interface Stat {
  date: string;
  /** Empty string when the day has no reading. */
  steps: number | string;
  tokens: number | string;
  must_used_model: string;
}

interface Day {
  date: Date;
  steps: number;
  tokens: number;
  model: string;
  hasEntry: boolean;
}

interface Tip {
  /** Viewport coordinates of the cell the tooltip belongs to. */
  x: number;
  above: number;
  below: number;
}

/**
 * One rendering of the card's contents. Two are kept on screen during a swap
 * so the outgoing day can blur away while the incoming one sharpens in.
 */
interface Layer {
  key: string;
  day: Day;
  metric: Metric;
  level: number;
}

/** `YYYY-MM-DD` -> UTC midnight, so the grid never shifts with the timezone. */
function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : 0;
}

/**
 * Four buckets split on the quartiles of the days that recorded something, so
 * the scale adapts both to the metric and to whatever the stats file holds.
 */
function makeLevelScale(values: number[]): (value: number) => number {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return () => 0;

  const quantile = (q: number) => sorted[Math.floor((sorted.length - 1) * q)];
  const thresholds = [quantile(0.25), quantile(0.5), quantile(0.75)];

  return (value) => {
    if (value <= 0) return 0;
    if (value <= thresholds[0]) return 1;
    if (value <= thresholds[1]) return 2;
    if (value <= thresholds[2]) return 3;
    return 4;
  };
}

const numberFormat = new Intl.NumberFormat("en-US");
const dateFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const monthFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});

/** The same value as `formatValue`, split so the card can style the unit. */
function formatParts(metric: Metric, value: number): { value: string; unit: string } {
  if (metric === "steps") {
    return { value: numberFormat.format(Math.round(value)), unit: "steps" };
  }
  if (value >= 1_000_000) return { value: `${(value / 1_000_000).toFixed(1)}M`, unit: "tokens" };
  if (value >= 1_000) return { value: `${(value / 1_000).toFixed(1)}K`, unit: "tokens" };
  return { value: numberFormat.format(value), unit: "tokens" };
}

function formatValue(metric: Metric, value: number): string {
  if (metric === "steps") return `${numberFormat.format(Math.round(value))} steps`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M tokens`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K tokens`;
  return `${numberFormat.format(value)} tokens`;
}

function describe(day: Day, metric: Metric): string {
  const when = dateFormat.format(day.date);
  if (!day.hasEntry) return `No data\n${when}`;

  const value = day[metric];
  let headline = value > 0 ? formatValue(metric, value) : `No ${metric} recorded`;
  if (metric === "tokens" && day.model) headline += `\nMust used model: ${day.model}`;
  return `${headline}\n${when}`;
}

interface Calendar {
  weeks: Day[][];
  months: { label: string; span: number }[];
}

/** UTC midnight today, so the empty grid drawn before the stats land already
    covers the weeks they will fill. */
function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** The grid for one set of stats: 52 columns of days, and the month labels
    above them. Built once per response rather than per render. */
function buildCalendar(entries: Stat[]): Calendar {
  const latest = entries.reduce((latest, entry) => (entry.date > latest ? entry.date : latest), "");
  const lastDate = latest ? parseDate(latest) : utcToday();

  // The grid always holds 52 Sunday-to-Saturday columns. The last one is the
  // week `lastDate` falls in, and `firstDay` is the Sunday 51 weeks before it,
  // so every column starts on a Sunday in its first row.
  const lastColumnEnd = new Date(lastDate.getTime() + (6 - lastDate.getUTCDay()) * DAY_MS);
  const firstDay = new Date(lastColumnEnd.getTime() - (WEEKS * 7 - 1) * DAY_MS);

  const byDate = new Map(entries.map((entry) => [entry.date, entry]));

  const weeks: Day[][] = Array.from({ length: WEEKS }, (_, weekIndex) =>
    Array.from({ length: 7 }, (_, dayIndex) => {
      const date = new Date(firstDay.getTime() + (weekIndex * 7 + dayIndex) * DAY_MS);
      const entry = byDate.get(toKey(date));
      const steps = entry ? toNumber(entry.steps) : 0;
      const tokens = entry ? toNumber(entry.tokens) : 0;
      return {
        date,
        steps,
        tokens,
        model: entry?.must_used_model ?? "",
        hasEntry: Boolean(entry) && (steps > 0 || tokens > 0),
      };
    })
      // The current week stops at the last day on record; the rest of that
      // column is still in the future, so it gets no cells at all.
      .filter((day) => day.date <= lastDate),
  );

  // One label per month, spanning the columns whose first day falls in it. A
  // leading partial month is left blank so its label cannot overlap the next.
  const months: { label: string; span: number }[] = [];
  weeks.forEach((week, weekIndex) => {
    const month = week[0].date.getUTCMonth();
    const previous = months[months.length - 1];
    if (weekIndex > 0 && previous && month === weeks[weekIndex - 1][0].date.getUTCMonth()) {
      previous.span += 1;
    } else {
      months.push({ label: monthFormat.format(week[0].date), span: 1 });
    }
  });
  if (months.length > 1 && months[0].span < 2) months[0].label = "";

  return { weeks, months };
}

async function fetchStats(signal: AbortSignal): Promise<Stat[]> {
  const response = await fetch(ENDPOINT, { signal });
  if (!response.ok) {
    throw new Error(`Stats returned HTTP ${response.status}; expected a successful response.`);
  }

  const payload = await response.json();
  if (payload?.ok !== true || !Array.isArray(payload.data)) {
    throw new Error(`Invalid stats payload: ${JSON.stringify(payload)?.slice(0, 200)}; expected { ok: true, data: [...] }.`);
  }

  // A malformed day would land outside the grid anyway; dropping it keeps the
  // rest of the year on screen.
  return payload.data.filter((entry: Stat) => typeof entry?.date === "string");
}

interface CardProps {
  day: Day;
  /** The bucket the cell was painted with, so the swatch matches the grid. */
  level: number;
}

function CardHead({ day, level }: CardProps) {
  return (
    <div className={styles.cardHead}>
      <span className={styles.cardDate}>{dateFormat.format(day.date)}</span>
      <span className={styles.cardSwatch} data-level={level} />
    </div>
  );
}

function CardValue({ metric, value, empty }: { metric: Metric; value: number; empty: string }) {
  if (value <= 0) return <p className={styles.cardMuted}>{empty}</p>;

  const { value: amount, unit } = formatParts(metric, value);
  return (
    <p className={styles.cardValue}>
      {amount}
      <span className={styles.cardUnit}>{unit}</span>
    </p>
  );
}

/** Steps have no companion fields, so the card stays at the date and the count. */
function StepsCard({ day, level }: CardProps) {
  return (
    <>
      <CardHead day={day} level={level} />
      <CardValue
        metric="steps"
        value={day.steps}
        empty={day.hasEntry ? "No steps recorded" : "No data recorded"}
      />
    </>
  );
}

/** Tokens carry the model that spent them, which earns a row of its own. */
function TokensCard({ day, level }: CardProps) {
  return (
    <>
      <CardHead day={day} level={level} />
      <CardValue
        metric="tokens"
        value={day.tokens}
        empty={day.hasEntry ? "No tokens recorded" : "No data recorded"}
      />
      {day.model && (
        <dl className={styles.cardRows}>
          <div className={styles.cardRow}>
            <dt>Top model</dt>
            <dd className={styles.cardModel}>{day.model}</dd>
          </div>
        </dl>
      )}
    </>
  );
}

/** Each metric renders its own fields only; the layer below just animates. */
const METRIC_CARDS = { steps: StepsCard, tokens: TokensCard };

function CardLayer({ layer, leaving, onDone }: {
  layer: Layer;
  leaving: boolean;
  onDone: () => void;
}) {
  const Card = METRIC_CARDS[layer.metric];

  return (
    <div
      className={styles.cardLayer}
      data-leaving={leaving ? "" : undefined}
      onAnimationEnd={leaving ? onDone : undefined}
    >
      <Card day={layer.day} level={layer.level} />
    </div>
  );
}

export default function Activity({ colors }: Props) {
  const [metric, setMetric] = useState<Metric>("steps");
  const [tip, setTip] = useState<Tip | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const tipRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /* Retain the input type through focus and click events after a tap. */
  const pointerType = useRef("mouse");
  /** When the previous cell was described, for the sweep check above. */
  const lastMove = useRef(0);

  const [entries, setEntries] = useState<Stat[]>([]);
  const [failed, setFailed] = useState(false);

  // The stats are fetched from the worker on mount rather than baked into the
  // bundle, so the grid follows the endpoint without a rebuild. Until they
  // land the calendar is drawn empty, which is the same shape the days fill.
  useEffect(() => {
    let disposed = false;
    const request = new AbortController();
    const timeout = setTimeout(() => request.abort(), REQUEST_TIMEOUT);

    fetchStats(request.signal)
      .then((data) => {
        if (!disposed) setEntries(data);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      disposed = true;
      clearTimeout(timeout);
      request.abort();
    };
  }, []);

  const { weeks, months } = useMemo(() => buildCalendar(entries), [entries]);

  const toLevel = useMemo(
    () => makeLevelScale(entries.map((entry) => toNumber(entry[metric]))),
    [entries, metric],
  );

  // The tooltip is fixed to the viewport rather than absolutely placed inside
  // the grid: that keeps it out of the scroll box, which would otherwise grow
  // a horizontal scrollbar to fit it. Placement is nudged back in once its
  // real size is known.
  useLayoutEffect(() => {
    const element = tipRef.current;
    if (!element || !tip) return;

    /* The card glides between cells, but that transition makes it trail the
       cursor during a fast sweep: every new cell restarts a 0.16s move the
       pointer has already left behind. Cells arriving in quick succession are
       a sweep, so the card jumps and keeps up; a deliberate move still glides. */
    const now = performance.now();
    element.style.transitionProperty = now - lastMove.current < SWEEP_MS ? "opacity, scale" : "";
    lastMove.current = now;

    /* offsetWidth/offsetHeight are the untransformed layout box. A
       getBoundingClientRect would measure whichever position the left/top
       transition happens to be passing through, and clamp against that. */
    const { offsetWidth: width, offsetHeight: height } = element;
    const half = width / 2;

    // Above the cell when it fits, otherwise below; then held inside the
    // viewport either way, so a grid near an edge cannot push it off screen.
    const above = tip.above - height >= EDGE_GAP;
    element.dataset.placement = above ? "above" : "below";
    const top = above ? tip.above - height : tip.below;
    element.style.top = `${clamp(top, EDGE_GAP, window.innerHeight - height - EDGE_GAP) + (above ? height : 0)}px`;

    // `translate(-50%)` puts the card's edges half a width either side of this.
    element.style.left = `${clamp(tip.x, EDGE_GAP + half, window.innerWidth - EDGE_GAP - half)}px`;
  }, [tip]);

  // A viewport-fixed tooltip would otherwise hang behind while the page moves.
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    window.addEventListener("scroll", hide, { passive: true });
    return () => window.removeEventListener("scroll", hide);
  }, [tip]);

  /* Touch never fires the pointerleave that dismisses the card for a mouse,
     so a tap anywhere outside the grid stands in for it. */
  useEffect(() => {
    if (!tip) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      const target = event.target;
      if (!(target instanceof Node) || !gridRef.current?.contains(target)) setTip(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [tip]);

  const showTip = (event: { currentTarget: HTMLElement }, day: Day) => {
    const box = event.currentTarget.getBoundingClientRect();
    setTip({
      x: box.left + box.width / 2,
      above: box.top - 8,
      below: box.bottom + 8,
    });

    const key = `${toKey(day.date)}:${metric}`;
    setLayers((current) => {
      const showing = current[current.length - 1];
      if (showing?.key === key) return current;
      const next: Layer = { key, day, metric, level: toLevel(day[metric]) };
      // At most two: whatever is on screen, plus what is replacing it.
      return showing ? [showing, next] : [next];
    });
  };

  /* Only the visibility flips here. The card stays mounted so it can fade out,
     and its contents are dropped once that transition has run. */
  const hideTip = () => setTip(null);

  /* The tap equivalent of moving on and off a cell: tapping the day already
     being described closes the card. */
  const showingKey = tip ? layers[layers.length - 1]?.key : undefined;

  const toggleTip = (event: { currentTarget: HTMLElement }, day: Day) => {
    if (showingKey === `${toKey(day.date)}:${metric}`) hideTip();
    else showTip(event, day);
  };

  const primary = colors?.[metric] ?? METRICS.find(({ id }) => id === metric)!.color;

  return (
    <div
      className="flex flex-col gap-2"
      style={{ "--primary": primary } as CSSProperties}
      onPointerDownCapture={(event) => {
        pointerType.current = event.pointerType;
      }}
      onKeyDownCapture={() => {
        pointerType.current = "keyboard";
      }}
      onPointerLeave={(event) => {
        // Touch fires this the instant the finger lifts, which would hide the
        // card before it ever painted.
        if (event.pointerType !== "touch") hideTip();
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <h1>Activity</h1>
        <div className={styles.metricToggle} role="group" aria-label="Metric">
          {METRICS.map(({ id, label }) => (
            <button
              type="button"
              className={styles.metricButton}
              aria-pressed={metric === id}
              onClick={() => {
                setMetric(id);
                hideTip();
              }}
              key={id}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`relative ${styles.profileBox}`}
        aria-busy={entries.length === 0 && !failed}
        ref={gridRef}
      >
        <div className={styles.profileCells}>
          {weeks.map((week, weekIndex) => (
            <div className={styles.profileWeek} key={weekIndex}>
              {week.map((day) => (
                <button
                  type="button"
                  className={styles.profileButton}
                  data-level={toLevel(day[metric])}
                  aria-label={describe(day, metric).replace("\n", ", ")}
                  onClick={(event) => {
                    // Use the browser's completed tap target, including touch
                    // hit-testing near these small cells. A pan is not a tap.
                    if (pointerType.current === "touch") toggleTip(event, day);
                    else showTip(event, day);
                  }}
                  onPointerEnter={(event) => {
                    if (event.pointerType !== "touch") showTip(event, day);
                  }}
                  onFocus={(event) => {
                    // Keyboard focus only: a tap also focuses the button on
                    // Android, and the tap handler above owns that case.
                    if (pointerType.current !== "touch" && event.currentTarget.matches(":focus-visible")) {
                      showTip(event, day);
                    }
                  }}
                  onBlur={() => {
                    // Tapping a second cell blurs the first; the tap itself
                    // decides what to show next.
                    if (pointerType.current !== "touch") hideTip();
                  }}
                  key={toKey(day.date)}
                ></button>
              ))}
            </div>
          ))}
        </div>
        <div className={styles.profileMonth}>
          {months.map((month, index) => (
            <span key={index} style={{ gridColumn: `span ${month.span}` }}>
              {month.label}
            </span>
          ))}
        </div>
      </div>

      {failed && <p className={styles.notice}>Activity stats are unavailable right now.</p>}

      {layers.length > 0 && (
        <div
          className={styles.tooltip}
          role="tooltip"
          ref={tipRef}
          data-visible={tip ? "" : undefined}
          onTransitionEnd={(event) => {
            if (!tip && event.propertyName === "opacity") setLayers([]);
          }}
        >
          <div className={styles.tooltipStack}>
            {layers.map((layer, index) => (
              <CardLayer
                layer={layer}
                leaving={index < layers.length - 1}
                onDone={() => setLayers((current) => current.slice(-1))}
                key={layer.key}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

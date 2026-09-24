import { useEffect, useId, useState } from "react";
import type { CSSProperties } from "react";
import { compass, fetchForecasts, type Forecast, type Level } from "../lib/wind";
import { useHoverCard } from "../lib/useHoverCard";
import card from "./HoverCard.module.css";
import styles from "./Windsock.module.css";

const REFRESH_DELAY = 15 * 60_000;
const ERROR_RETRY_DELAY = 60_000;
const REQUEST_TIMEOUT = 10_000;

/* A real sock stands straight out at 15 knots, one stripe per 3 knots */
const FULL_SPEED = 28;
const SEGMENTS = 5;
const SEGMENT_LENGTH = 3.6;
const MOUTH = 5;
const TAIL = 2.6;
/* Degrees below horizontal when there is no wind at all */
const LIMP = 82;

const VERDICT: Record<Level, string> = {
  flyable: "Flyable",
  marginal: "Marginal",
  grounded: "Grounded",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function hour(value: number): string {
  return `${String(value).padStart(2, "0")}:00`;
}

/* The mouth takes most of the droop and every stripe after it sags a little
   more, so a light wind reads as a curve rather than a stiff stick */
function droop(speed: number): { mouth: number; stripe: number } {
  const strength = clamp(speed / FULL_SPEED, 0, 1);
  const total = LIMP * (1 - strength) ** 1.4 + 3;
  return { mouth: total * 0.7, stripe: (total * 0.3) / (SEGMENTS - 1) };
}

function Stripe({ index, angle }: { index: number; angle: (i: number) => number }) {
  const h0 = MOUTH - ((MOUTH - TAIL) * index) / SEGMENTS;
  const h1 = MOUTH - ((MOUTH - TAIL) * (index + 1)) / SEGMENTS;
  const path = `M0 ${-h0 / 2}L${SEGMENT_LENGTH} ${-h1 / 2}V${h1 / 2}L0 ${h0 / 2}Z`;
  return (
    <g className={styles.hinge} style={{ rotate: `${angle(index)}deg` }}>
      <g className={styles.flutter} style={{ "--delay": `${index * -0.14}s` } as CSSProperties}>
        <path className={index % 2 ? styles.stripeLight : styles.stripe} d={path} />
        {index + 1 < SEGMENTS && (
          <g transform={`translate(${SEGMENT_LENGTH - 0.05} 0)`}>
            <Stripe index={index + 1} angle={angle} />
          </g>
        )}
      </g>
    </g>
  );
}

interface Props {
  /** Any CSS length; defaults to a little over the surrounding text. */
  size?: string;
}

export default function Windsock({ size }: Props) {
  const [forecasts, setForecasts] = useState<Forecast[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { anchorProps, cardProps } = useHoverCard<HTMLButtonElement, HTMLSpanElement>([forecasts]);
  const id = useId();

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController;

    async function refresh() {
      request = new AbortController();
      const timeout = setTimeout(() => request.abort(), REQUEST_TIMEOUT);
      let delay = ERROR_RETRY_DELAY;
      try {
        const next = await fetchForecasts(request.signal);
        if (disposed) return;
        setForecasts(next);
        setFailed(false);
        delay = REFRESH_DELAY;
      } catch {
        /* Keep showing the last good reading; only an empty sock says "failed" */
        if (!disposed) setFailed(true);
      } finally {
        clearTimeout(timeout);
        if (!disposed) timer = setTimeout(refresh, delay);
      }
    }

    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
      request?.abort();
    };
  }, []);

  const best = forecasts?.[0];
  const speed = best?.now.speed ?? 0;
  const gusts = best?.now.gusts ?? 0;
  const { mouth, stripe } = droop(speed);
  /* The sock points downwind: wind from the east blows it to the west */
  const flipped = best ? Math.sin((best.now.direction * Math.PI) / 180) > 0 : false;
  const sockStyle = {
    "--sock-size": size,
    /* Every stripe flutters on top of the one before it, so this compounds */
    "--amp": `${clamp((gusts - speed) / 10 + 0.6, 0.6, 3)}deg`,
    "--period": `${1.6 - clamp(speed / FULL_SPEED, 0, 1) * 0.9}s`,
  } as CSSProperties;

  return (
    <span className={styles.root}>
      <button
        {...anchorProps}
        type="button"
        className={styles.button}
        aria-label="Wind at my launch sites"
        aria-describedby={id}
        data-level={best?.level}
      >
        <svg className={styles.sock} viewBox="0 0 24 24" data-flipped={flipped || undefined} style={sockStyle} aria-hidden="true">
          {/* Two stacked ellipses fake a soft contact shadow without a filter,
              which would need a document-unique id per instance */}
          <ellipse className={styles.shadow} cx="3.4" cy="22.9" rx="2.8" ry="0.75" />
          <ellipse className={styles.shadow} cx="3.2" cy="22.9" rx="1.5" ry="0.45" />
          <line className={styles.pole} x1="3" y1="3" x2="3" y2="22.6" />
          <g transform="translate(3.6 5)">
            <g className={styles.hinge} style={{ rotate: `${mouth}deg` }}>
              <g className={styles.flutter}>
                <rect className={styles.ring} x="-0.6" y={-MOUTH / 2 - 0.3} width="1" height={MOUTH + 0.6} rx="0.5" />
                <g transform="translate(0.3 0)">
                  <Stripe index={0} angle={(i) => (i ? stripe : 0)} />
                </g>
              </g>
            </g>
          </g>
        </svg>
      </button>

      <span {...cardProps} id={id} className={`${card.card} ${styles.card}`}>
        {best ? (
          <>
            <span className={styles.verdict} data-level={best.level}>
              <span className={styles.dot} />
              {VERDICT[best.level]} {best.day}
              {best.window && best.level !== "grounded" && (
                <span className={styles.window}>{hour(best.window[0])}–{hour(best.window[1])}</span>
              )}
            </span>
            <span className={styles.site}>
              {best.launch.name}
              {best.reason && ` · ${best.reason}`}
            </span>
            <span className={styles.rows}>
              <span className={styles.row}>
                <span className={styles.key}>Now</span>
                <span className={styles.value}>
                  <svg className={styles.arrow} viewBox="0 0 12 12" style={{ rotate: `${best.now.direction + 180}deg` }} aria-hidden="true">
                    <path d="M6 1.5 9.5 10 6 8 2.5 10Z" />
                  </svg>
                  {Math.round(best.now.speed)} km/h {compass(best.now.direction)}
                  <span className={styles.muted}> · gusts {Math.round(best.now.gusts)}</span>
                </span>
              </span>
              <span className={styles.row}>
                <span className={styles.key}>Launch</span>
                <span className={styles.value}>
                  faces {compass(best.launch.facing)}
                  <span className={styles.muted}> · {best.launch.elevation.toLocaleString("en")} m</span>
                </span>
              </span>
              {best.cloudbase && best.cloudbase > best.launch.elevation && (
                <span className={styles.row}>
                  <span className={styles.key}>Base</span>
                  <span className={styles.value}>~{best.cloudbase.toLocaleString("en")} m</span>
                </span>
              )}
            </span>
            {forecasts.length > 1 && (
              <span className={styles.others}>
                {forecasts.slice(1).map((forecast) => (
                  <span key={forecast.launch.name} className={styles.other} data-level={forecast.level}>
                    <span className={styles.dot} />
                    {forecast.launch.name}
                  </span>
                ))}
              </span>
            )}
            <span className={styles.credit}>Forecast by Open-Meteo</span>
          </>
        ) : (
          <span className={styles.site}>{failed ? "No wind data right now" : "Checking the wind…"}</span>
        )}
      </span>
    </span>
  );
}

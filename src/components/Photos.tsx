import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./Photos.module.css";

export interface Photo {
  src: string;
  /* Larger rendition, fetched the first time the photo is pinched */
  full?: string;
  caption: string;
}

interface Props {
  photos: Photo[];
  label?: string;
}

/* Card geometry, in CSS pixels: the polaroid frame is the image plus a thin
   border on three sides and a deeper one at the bottom */
const IMAGE_W = 100;
const IMAGE_H = 120;
const FRAME = 6;
const FRAME_BOTTOM = 18;
const CARD_W = IMAGE_W + FRAME * 2;
const CARD_H = IMAGE_H + FRAME + FRAME_BOTTOM;

const MAX_FAN_ANGLE = 12;
const ENLARGED_SCALE = 1.9;
/* How far a hovered or focused card slides out of the fan, along its own tilt */
const LIFT = -18;
/* Pointer travel under this many pixels is a click, anything more a drag */
const DRAG_THRESHOLD = 4;
/* Pinch zoom limits, as total scale; pinching past either one stretches
   with growing resistance, and never by more than the overshoot */
const MAX_ZOOM = 3.5;
const MAX_OVERSHOOT = 0.8;
const MIN_OVERSHOOT = 0.25;

/* Critically-ish damped springs, in per-second units */
const HOME = { k: 170, c: 22 };
const SPIN = { k: 260, c: 16 };
const SCALE = { k: 420, c: 30 };
const PINCH_RELEASE = { k: 300, c: 26 };
/* Exponential decay rate of a thrown card's momentum */
const FRICTION = 3.2;
const BOUNCE = 0.55;
const MAX_TILT = 28;

interface Body {
  /* Offset from the card's slot in the fan */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /* Rotation relative to the card's fan angle */
  r: number;
  vr: number;
  s: number;
  vs: number;
  lift: number;
  vlift: number;
  /* Extra horizontal shift that keeps an enlarged card inside the column */
  ex: number;
  vex: number;
  /* Pinch zoom on top of the regular scale, and the pan that keeps the
     pinched spot under the fingers; both spring away once released */
  pz: number;
  vpz: number;
  px: number;
  vpx: number;
  py: number;
  vpy: number;
  pinching: boolean;
  /* Springs back to its slot; cleared once the user has thrown it */
  homing: boolean;
  dragging: boolean;
  /* Where on the card it was grabbed, -1 (top) to 1 (bottom) */
  lever: number;
  hovered: boolean;
  focused: boolean;
  z: number;
}

function spring(value: number, velocity: number, target: number, { k, c }: { k: number; c: number }, dt: number) {
  const next = velocity + (-k * (value - target) - c * velocity) * dt;
  return [value + next * dt, next] as const;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/* Past a limit, each extra unit of input moves the value a little less,
   approaching `limit ± overshoot` but never reaching it */
function rubberBand(value: number, min: number, max: number) {
  const band = (over: number, range: number) => (1 - 1 / ((over * 0.55) / range + 1)) * range;
  if (value > max) return max + band(value - max, MAX_OVERSHOOT);
  if (value < min) return min - band(min - value, MIN_OVERSHOOT);
  return value;
}

interface Gesture {
  pointers: Map<number, { x: number; y: number }>;
  /* Called when a second finger lands on the card */
  startPinch: () => void;
  /* Drops the gesture as if every pointer had lifted */
  end: () => void;
}

export default function Photos({ photos, label = "Photos" }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const bodies = useRef<Body[]>([]);
  const frame = useRef(0);
  const lastTime = useRef(0);
  const zCounter = useRef(photos.length);
  const suppressClick = useRef(false);
  const gestures = useRef(new Map<number, Gesture>());
  const imageRefs = useRef<(HTMLImageElement | null)[]>([]);
  const reducedMotion = useRef(false);

  const [width, setWidth] = useState(0);
  const [enlarged, setEnlarged] = useState<number | null>(null);
  const [scattered, setScattered] = useState(false);
  const enlargedRef = useRef(enlarged);
  enlargedRef.current = enlarged;

  if (bodies.current.length !== photos.length) {
    bodies.current = photos.map((_, i) => ({
      x: 0, y: 0, vx: 0, vy: 0, r: 0, vr: 0, s: 1, vs: 0, lift: 0, vlift: 0, ex: 0, vex: 0,
      pz: 1, vpz: 0, px: 0, vpx: 0, py: 0, vpy: 0, pinching: false,
      homing: true, dragging: false, lever: 0, hovered: false, focused: false, z: i,
    }));
  }

  const n = photos.length;
  const slot = useCallback(
    (i: number) => {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const spread = Math.max(0, width - CARD_W);
      /* A shallow arc: the middle of the fan sits a touch higher */
      const arc = Math.sin(t * Math.PI);
      return {
        left: t * spread,
        top: 16 - arc * 10,
        angle: (t * 2 - 1) * MAX_FAN_ANGLE,
      };
    },
    [n, width],
  );
  const slotRef = useRef(slot);
  slotRef.current = slot;

  const render = useCallback((i: number) => {
    const el = cardRefs.current[i];
    const b = bodies.current[i];
    if (!el) return;
    const { angle } = slotRef.current(i);
    const isEnlarged = enlargedRef.current === i;
    el.style.transform =
      `translate3d(${b.x + b.ex + b.px}px, ${b.y + b.py}px, 0) ` +
      `rotate(${(isEnlarged ? 0 : angle) + b.r}deg) translateY(${b.lift}px) scale(${b.s * b.pz})`;
    /* Offset by one so every card stacks above the reset button; a hovered
       or focused card rises above the rest, an enlarged or pinched one above that */
    el.style.zIndex = String(
      b.pinching ? 10_001 : isEnlarged ? 10_000 : b.hovered || b.focused ? 9_999 : b.z + 1,
    );
  }, []);

  const step = useCallback(
    (time: number) => {
      /* The first frame after the loop wakes has no previous timestamp; a zero
         step would leave every card looking settled and stop the loop at once */
      const dt = lastTime.current ? Math.min((time - lastTime.current) / 1000, 1 / 30) : 1 / 60;
      lastTime.current = time;
      const root = rootRef.current;
      const rootRect = root?.getBoundingClientRect();
      let moving = false;

      bodies.current.forEach((b, i) => {
        const isEnlarged = enlargedRef.current === i;
        const { left, top } = slotRef.current(i);

        if (b.dragging) {
          /* Pointer samples only arrive while it moves: a held-still card
             has to lose its velocity, and with it the tilt, on its own */
          const decay = Math.exp(-8 * dt);
          b.vx *= decay;
          b.vy *= decay;
        } else {
          if (b.homing) {
            [b.x, b.vx] = spring(b.x, b.vx, 0, HOME, dt);
            [b.y, b.vy] = spring(b.y, b.vy, 0, HOME, dt);
          } else {
            const decay = Math.exp(-FRICTION * dt);
            b.vx *= decay;
            b.vy *= decay;
            b.x += b.vx * dt;
            b.y += b.vy * dt;

            /* Thrown cards bounce off the edges of the viewport */
            if (rootRect) {
              const { clientWidth: vw, clientHeight: vh } = document.documentElement;
              const cx = rootRect.left + left + CARD_W / 2 + b.x;
              const cy = rootRect.top + top + CARD_H / 2 + b.y;
              const hw = CARD_W / 2;
              const hh = CARD_H / 2;
              if (cx - hw < 0 && b.vx < 0) { b.x += hw - cx; b.vx *= -BOUNCE; b.vr += b.vy * 0.2; }
              if (cx + hw > vw && b.vx > 0) { b.x -= cx + hw - vw; b.vx *= -BOUNCE; b.vr -= b.vy * 0.2; }
              if (cy - hh < 0 && b.vy < 0) { b.y += hh - cy; b.vy *= -BOUNCE; b.vr -= b.vx * 0.2; }
              if (cy + hh > vh && b.vy > 0) { b.y -= cy + hh - vh; b.vy *= -BOUNCE; b.vr += b.vx * 0.2; }
            }
          }
        }

        /* Cards swing like they hang from wherever they were grabbed: moving
           sideways tilts them against the direction of travel */
        const tilt = reducedMotion.current || isEnlarged
          ? 0
          : clamp(b.vx * 0.035 * b.lever, -MAX_TILT, MAX_TILT);
        [b.r, b.vr] = spring(b.r, b.vr, tilt, SPIN, dt);

        const active = b.hovered || b.focused;
        const targetScale = isEnlarged ? ENLARGED_SCALE : b.dragging ? 1.08 : active ? 1.05 : 1;
        [b.s, b.vs] = spring(b.s, b.vs, targetScale, SCALE, dt);
        [b.lift, b.vlift] = spring(b.lift, b.vlift, active && !isEnlarged ? LIFT : 0, SCALE, dt);

        /* An enlarged card slides inwards if it would spill out of the column */
        let targetEx = 0;
        if (isEnlarged && root) {
          const half = (CARD_W * ENLARGED_SCALE) / 2;
          const cx = left + CARD_W / 2 + b.x;
          const w = root.clientWidth;
          targetEx = w < half * 2 ? w / 2 - cx : clamp(cx, half, w - half) - cx;
        }
        [b.ex, b.vex] = spring(b.ex, b.vex, targetEx, SCALE, dt);

        if (!b.pinching) {
          [b.pz, b.vpz] = spring(b.pz, b.vpz, 1, PINCH_RELEASE, dt);
          [b.px, b.vpx] = spring(b.px, b.vpx, 0, PINCH_RELEASE, dt);
          [b.py, b.vpy] = spring(b.py, b.vpy, 0, PINCH_RELEASE, dt);
        }

        if (reducedMotion.current) {
          /* Snap every animated value straight to its target */
          if (!b.dragging) {
            if (b.homing) b.x = b.y = 0;
            b.vx = b.vy = 0;
          }
          b.r = tilt; b.s = targetScale; b.lift = active && !isEnlarged ? LIFT : 0; b.ex = targetEx;
          b.vr = b.vs = b.vlift = b.vex = 0;
          if (!b.pinching) {
            b.pz = 1; b.px = b.py = 0;
            b.vpz = b.vpx = b.vpy = 0;
          }
        }

        const settled =
          !b.dragging &&
          !b.pinching &&
          Math.abs(b.pz - 1) < 0.001 && Math.abs(b.px) + Math.abs(b.py) < 0.5 &&
          Math.abs(b.vx) + Math.abs(b.vy) < 2 &&
          Math.abs(b.vr) < 0.5 && Math.abs(b.vs) < 0.005 && Math.abs(b.vlift) < 0.2 && Math.abs(b.vex) < 0.5 &&
          (!b.homing || Math.abs(b.x) + Math.abs(b.y) < 0.5);
        if (!settled) moving = true;
        render(i);
      });

      frame.current = moving ? requestAnimationFrame(step) : 0;
      if (!moving) lastTime.current = 0;
    },
    [render],
  );

  const kick = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(step);
  }, [step]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(root);
    setWidth(root.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => (reducedMotion.current = media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  /* Re-lay the fan when the column width changes */
  useEffect(() => {
    bodies.current.forEach((_, i) => render(i));
  }, [width, render]);

  useEffect(() => {
    kick();
  }, [enlarged, kick]);

  /* Escape or a click anywhere else puts the enlarged photo back */
  useEffect(() => {
    if (enlarged === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEnlarged(null);
    };
    const onPointer = (event: PointerEvent) => {
      if (!cardRefs.current[enlarged]?.contains(event.target as Node)) setEnlarged(null);
    };
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onPointer);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("pointerdown", onPointer);
    };
  }, [enlarged]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /* `touch-action: none` on the cards should keep the page from scrolling
     under a drag, but mobile browsers resolve it when the touch starts, and
     iOS gets it wrong on rotated, script-transformed elements. Cancelling
     the touch itself stops the page from scrolling on every browser. Not on
     touchstart, which would also cancel the tap that enlarges a photo */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onTouchMove = (event: TouchEvent) => {
      if (gestures.current.size) event.preventDefault();
    };
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => root.removeEventListener("touchmove", onTouchMove);
  }, []);

  const bringToFront = (i: number) => {
    bodies.current[i].z = ++zCounter.current;
  };

  /* Swaps in the large rendition once it has loaded, so a pinched photo
     sharpens instead of blanking while it downloads */
  const loadFull = (i: number) => {
    const full = photos[i].full;
    const img = imageRefs.current[i];
    if (!full || !img || img.dataset.full) return;
    img.dataset.full = "loading";
    const loader = new Image();
    loader.src = full;
    loader.decode().then(
      () => (img.src = full),
      () => delete img.dataset.full,
    );
  };

  const onPointerDown = (i: number) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    let existing = gestures.current.get(i);
    /* The primary pointer is the first finger on an otherwise empty screen,
       so anything still tracked is left over from a lift the browser never
       reported. Kept, it would make this touch the "second finger" of a
       pinch, and the card would zoom instead of following the drag */
    if (existing && event.isPrimary) {
      existing.end();
      existing = undefined;
    }
    if (existing) {
      /* A second finger on a card already being touched turns it into a pinch */
      if (event.pointerType === "touch" && existing.pointers.size === 1) {
        existing.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        existing.startPinch();
      }
      return;
    }

    /* A drag released off the card never gets its click, so the flag from it
       must not swallow this press */
    suppressClick.current = false;
    const el = event.currentTarget;
    const b = bodies.current[i];
    const primary = event.pointerId;
    const pointers = new Map([[primary, { x: event.clientX, y: event.clientY }]]);
    const start = { x: event.clientX, y: event.clientY, bx: b.x, by: b.y };
    let last = { x: event.clientX, y: event.clientY, t: performance.now() };
    let dragging = false;
    /* Once pinched, the gesture never goes back to dragging, even when one
       finger lifts before the other */
    let pinched = false;
    let pinch: {
      distance: number;
      mid: { x: number; y: number };
      /* From the card's centre to the pinch midpoint, at the start */
      offset: { x: number; y: number };
      pz: number;
      px: number;
      py: number;
    } | null = null;

    const rect = el.getBoundingClientRect();
    b.lever = clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
    /* A dead-centre grab still swings a little, as if held just above centre */
    if (Math.abs(b.lever) < 0.35) b.lever = -0.35;

    const pinchGeometry = () => {
      const [p, q] = [...pointers.values()];
      return {
        distance: Math.max(Math.hypot(q.x - p.x, q.y - p.y), 1),
        mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
      };
    };

    const startPinch = () => {
      if (dragging) {
        dragging = false;
        b.dragging = false;
        b.vx = b.vy = 0;
      }
      pinched = true;
      suppressClick.current = true;
      const { distance, mid } = pinchGeometry();
      const box = el.getBoundingClientRect();
      pinch = {
        distance,
        mid,
        offset: { x: mid.x - (box.left + box.width / 2), y: mid.y - (box.top + box.height / 2) },
        pz: b.pz,
        px: b.px,
        py: b.py,
      };
      b.pinching = true;
      bringToFront(i);
      loadFull(i);
      kick();
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pinch) {
        if (pointers.size < 2) return;
        const { distance, mid } = pinchGeometry();
        /* Can't shrink below the size it rests at, nor grow past the limit,
           without the rubber band pushing back */
        const total = rubberBand(b.s * pinch.pz * (distance / pinch.distance), b.s, MAX_ZOOM);
        b.pz = total / b.s;
        /* Scaling about the card's centre would slide the pinched spot out
           from under the fingers; this pan puts it back, and follows them */
        const ratio = b.pz / pinch.pz;
        b.px = pinch.px + mid.x - pinch.mid.x - pinch.offset.x * (ratio - 1);
        b.py = pinch.py + mid.y - pinch.mid.y - pinch.offset.y * (ratio - 1);
        kick();
        return;
      }
      if (pinched || e.pointerId !== primary) return;

      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragging = true;
        el.setPointerCapture(e.pointerId);
        if (enlargedRef.current === i) setEnlarged(null);
        b.dragging = true;
        b.homing = false;
        b.vx = b.vy = 0;
        bringToFront(i);
        setScattered(true);
      }
      const now = performance.now();
      const dt = Math.max((now - last.t) / 1000, 1 / 240);
      /* Smoothed so a single jittery sample doesn't fling the card */
      b.vx += ((e.clientX - last.x) / dt - b.vx) * 0.35;
      b.vy += ((e.clientY - last.y) / dt - b.vy) * 0.35;
      last = { x: e.clientX, y: e.clientY, t: now };
      b.x = start.bx + dx;
      b.y = start.by + dy;
      kick();
    };

    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;

      if (pinch) {
        /* Lifting either finger lets the zoom spring back */
        pinch = null;
        b.pinching = false;
        kick();
      } else if (dragging && e.pointerId === primary) {
        dragging = false;
        /* The pointer has been still for a while: drop, don't throw */
        if (performance.now() - last.t > 80) b.vx = b.vy = 0;
        b.dragging = false;
        suppressClick.current = true;
        kick();
      }

      if (!pointers.size) end();
    };

    const end = () => {
      for (const id of [...pointers.keys()]) onUp({ pointerId: id } as PointerEvent);
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      removeEventListener("pointercancel", onUp);
      gestures.current.delete(i);
    };

    gestures.current.set(i, { pointers, startPinch, end });
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
    addEventListener("pointercancel", onUp);
  };

  const onClick = (i: number) => () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    bringToFront(i);
    setEnlarged((current) => (current === i ? null : i));
  };

  const setActive = (i: number, key: "hovered" | "focused", value: boolean) => {
    bodies.current[i][key] = value;
    kick();
  };

  const reset = () => {
    setEnlarged(null);
    setScattered(false);
    /* Back to the stacking order of a fresh page, too */
    zCounter.current = n;
    bodies.current.forEach((b, i) => {
      b.z = i;
      b.homing = true;
      b.vr += (Math.random() - 0.5) * 200;
    });
    kick();
  };

  return (
    <div ref={rootRef} className={styles.photos} role="group" aria-label={label} style={{ height: CARD_H + 32 }}>
      {photos.map((photo, i) => {
        const { top, angle } = slot(i);
        const t = n === 1 ? 0.5 : i / (n - 1);
        return (
          <div
            key={photo.src}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            className={styles.slot}
            /* Laid out in CSS rather than from the measured width, so the
               server-rendered fan is already in place before hydration */
            style={{
              left: `calc((100% - ${CARD_W}px) * ${t})`,
              top,
              width: CARD_W,
              height: CARD_H,
              zIndex: i + 1,
              transform: `rotate(${angle}deg)`,
            }}
          >
            <button
              type="button"
              className={styles.card}
              aria-label={photo.caption}
              aria-pressed={enlarged === i}
              data-enlarged={enlarged === i || undefined}
              onPointerDown={onPointerDown(i)}
              onClick={onClick(i)}
              onPointerEnter={(e) => e.pointerType === "mouse" && setActive(i, "hovered", true)}
              onPointerLeave={() => setActive(i, "hovered", false)}
              onFocus={(e) => setActive(i, "focused", e.currentTarget.matches(":focus-visible"))}
              onBlur={() => setActive(i, "focused", false)}
              style={{ padding: `${FRAME}px ${FRAME}px ${FRAME_BOTTOM}px` }}
            >
              <img
                ref={(el) => {
                  imageRefs.current[i] = el;
                }}
                src={photo.src} alt="" width={IMAGE_W} height={IMAGE_H} draggable={false} decoding="async" />
            </button>
            <span className={styles.caption} aria-hidden="true">
              {photo.caption}
            </span>
          </div>
        );
      })}
      {/* Sits behind the fan, so it only shows through once cards are moved */}
      <button type="button" className={styles.reset} onClick={reset} hidden={!scattered}>
        Put them back
      </button>
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DependencyList, PointerEvent } from "react";

/** Keeps the card from touching the viewport edge. */
const EDGE_GAP = 8;
/** Space between the anchor and the card. */
const OFFSET = 8;

export interface CardPosition {
  left: number;
  top: number;
  placement: "above" | "below";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * A fixed card that opens over a button: on hover for a mouse, on focus for
 * a keyboard, on tap for touch. Sits above the anchor unless there is no
 * room, and closes on Escape, on a press elsewhere, or when the page scrolls.
 * `deps` re-measure the card when its content changes size while open.
 */
export function useHoverCard<A extends HTMLElement, C extends HTMLElement>(deps: DependencyList = []) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CardPosition>();
  const anchor = useRef<A>(null);
  const card = useRef<C>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !card.current) return;
    const box = anchor.current.getBoundingClientRect();
    const { width, height } = card.current.getBoundingClientRect();
    const left = clamp(box.left + box.width / 2 - width / 2, EDGE_GAP, innerWidth - width - EDGE_GAP);
    const above = box.top - OFFSET - height;
    setPosition(above >= EDGE_GAP
      ? { left, top: above, placement: "above" }
      : { left, top: box.bottom + OFFSET, placement: "below" });
  }, [open, ...deps]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    const onPointer = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) close();
    };
    /* The card is fixed: rather than chase the anchor while the page moves, let it go */
    addEventListener("scroll", close, { passive: true });
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onPointer);
    return () => {
      removeEventListener("scroll", close);
      removeEventListener("keydown", onKey);
      removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const anchorProps = {
    ref: anchor,
    onPointerEnter: (event: PointerEvent) => event.pointerType === "mouse" && setOpen(true),
    onPointerLeave: (event: PointerEvent) => event.pointerType === "mouse" && setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
    /* Not a toggle: a tap has already opened it through focus */
    onClick: () => setOpen(true),
  };

  const cardProps = {
    ref: card,
    role: "tooltip",
    "data-visible": open && position ? "" : undefined,
    "data-placement": position?.placement,
    style: position && { left: position.left, top: position.top },
  };

  return { open, anchorProps, cardProps };
}

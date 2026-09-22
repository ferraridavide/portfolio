// Pointer/keyboard state for one badge, normalised to [-1, 1] over its box.
export function badgeInput(element: HTMLElement, signal: AbortSignal) {
  const state = { x: 0.2, y: -0.25, hover: 0 };
  let start: { x: number; y: number } | undefined;
  let dragged = false;

  // One falloff for every input: the light follows the point exactly, and the
  // foil fades out over roughly one badge width once the point leaves the box.
  const track = (clientX: number, clientY: number) => {
    const rect = element.getBoundingClientRect();
    state.x = (clientX - rect.left) / rect.width * 2 - 1;
    state.y = (clientY - rect.top) / rect.height * 2 - 1;
    const distanceX = Math.max(rect.left - clientX, 0, clientX - rect.right);
    const distanceY = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
    const proximity = Math.max(0, 1 - Math.hypot(distanceX, distanceY) / Math.max(1, rect.width));
    state.hover = proximity * proximity * (3 - 2 * proximity);
    if (start && Math.hypot(clientX - start.x, clientY - start.y) > 10) {
      dragged = true;
    }
  };

  const leave = () => { state.hover = 0; start = undefined; };

  window.addEventListener('pointermove', (event) => {
    if (!event.isPrimary || event.pointerType !== 'mouse') return;
    track(event.clientX, event.clientY);
  }, { signal, passive: true });

  // Touch is read from the touch events rather than the pointer stream: the
  // moment a drag becomes a scroll the browser cancels the pointer stream, but
  // touchmove keeps firing for the whole gesture. Reading it directly means a
  // finger scrolling past the badges still lights them, and the badge moving
  // under a held finger animates too, without taking the scroll off the page.
  const finger = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (touch) track(touch.clientX, touch.clientY);
  };
  window.addEventListener('touchstart', finger, { signal, passive: true });
  window.addEventListener('touchmove', finger, { signal, passive: true });
  const lift = (event: TouchEvent) => {
    if (!event.touches.length) leave();
  };
  window.addEventListener('touchend', lift, { signal, passive: true });
  window.addEventListener('touchcancel', lift, { signal, passive: true });

  // Pointer events still open the gesture, so a drag can be told from a tap.
  element.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary) return;
    dragged = false;
    start = { x: event.clientX, y: event.clientY };
    track(event.clientX, event.clientY);
  }, { signal, passive: true });
  // A cancel means the browser took the gesture over to scroll: no click will
  // follow, and the foil now rides on the touch events, so only the drag ends.
  element.addEventListener('pointercancel', () => { start = undefined; }, { signal });
  element.addEventListener('pointerup', () => { start = undefined; }, { signal });
  element.addEventListener('focus', () => {
    state.x = 0.2;
    state.y = -0.25;
    state.hover = 1;
  }, { signal });
  element.addEventListener('blur', leave, { signal });
  // A drag that started on the badge should not follow the credential link.
  element.addEventListener('click', (event) => {
    if (dragged && event.detail !== 0) event.preventDefault();
    dragged = false;
  }, { signal });
  return state;
}

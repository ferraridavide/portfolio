import { createRenderer } from './renderer';

export const FOILS = {
  contours: 0,
  cubes: 1,
  lattice: 2,
  satin: 3,
} as const;

export type Foil = keyof typeof FOILS;

// One lifecycle for every badge on the page: WebGPU devices are expensive, so they
// are released on page hide and recreated when the page is restored from the cache.
export function mountBadges() {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-holo-badge]')];
  if (!links.length) return;
  const events = new AbortController();
  let renderers: ReturnType<typeof createRenderer>[] = [];

  const stop = () => {
    renderers.forEach((renderer) => renderer.dispose());
    renderers = [];
  };
  const start = () => {
    stop();
    renderers = links.map((link) => createRenderer(
      link,
      link.querySelector('img')!,
      () => Number(link.dataset.foil ?? 0),
      // The PNG underneath stays visible, so a failure is a silent downgrade.
      (error) => console.warn('Holographic badge is using the original artwork:', error),
    ));
  };

  window.addEventListener('pagehide', stop, { signal: events.signal });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) start();
  }, { signal: events.signal });
  if (import.meta.hot) import.meta.hot.dispose(() => { stop(); events.abort(); });
  start();
}

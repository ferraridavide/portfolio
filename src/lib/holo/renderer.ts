import { clock, frame, frameLoop, init, surface, type Gpu } from 'vgpu';
import { badgeInput } from './input';
import { createScene, loadFoilImages } from './scene';

// The badges sit far below the fold, so their artwork is still a deferred lazy
// image when the renderer starts: `decode()` rejects on one outright, and it
// reports `complete` despite holding no data, so `naturalWidth` is the signal to
// trust. Promoting the element starts the deferred fetch.
async function decodeArtwork(image: HTMLImageElement) {
  image.loading = 'eager';
  if (!image.naturalWidth) {
    await new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', reject, { once: true });
    });
  }
  await image.decode();
}

// Keeps the example's ready/dispose contract, including async initialization races:
// every await re-checks `disposed`, so a teardown mid-initialization still frees the device.
export function createRenderer(
  link: HTMLAnchorElement,
  image: HTMLImageElement,
  foilType: () => number,
  onError: (error: unknown) => void,
) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  link.append(canvas);
  const events = new AbortController();
  let disposed = false;
  let gpu: Gpu | undefined;
  let unsubscribeResize = () => {};
  let unsubscribeErrors = () => {};
  let stopLoop = () => {};
  let observer: IntersectionObserver | undefined;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stopLoop();
    events.abort();
    observer?.disconnect();
    unsubscribeResize();
    unsubscribeErrors();
    gpu?.dispose();
    canvas.remove();
    link.classList.remove('is-ready');
  };
  const fail = (error: unknown) => {
    if (disposed) return;
    dispose();
    onError(error);
  };

  const ready = (async () => {
    const [, foils] = await Promise.all([decodeArtwork(image), loadFoilImages()]);
    if (disposed) return;
    const context = await init({ powerPreference: 'low-power' });
    if (disposed) { context.dispose(); return; }
    gpu = context;
    unsubscribeErrors = context.onError(fail);
    void context.gpu.lost.then((info) => fail(new Error(`WebGPU device lost: ${info.message}`)));
    const output = surface(context, canvas, { dpr: [1, 2], clearColor: [0, 0, 0, 0] });
    const shader = createScene(context, output, image, foils);
    await shader.compile({ colors: [output.format] });
    if (disposed) return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = badgeInput(link, events.signal);
    const time = clock(context);
    let tiltX = 0;
    let tiltY = 0;
    let hover = 0;
    let lightX = 0.2;
    let lightY = -0.25;
    unsubscribeResize = output.onResize(() => {
      shader.set({ params: { resolution: output.size } });
    });

    // Present a valid frame before hiding the original, accessible PNG.
    frame(context, (currentFrame) => currentFrame.pass(output, shader));
    link.classList.add('is-ready');
    let visible = true;
    const resume = () => {
      stopLoop();
      if (disposed || document.hidden || !visible) return;
      const loop = frameLoop(context, (currentFrame) => {
        try {
          const targetX = motion.matches ? 0 : Math.max(-1, Math.min(1, pointer.x)) * 0.16 * pointer.hover;
          const targetY = motion.matches ? 0 : -Math.max(-1, Math.min(1, pointer.y)) * 0.12 * pointer.hover;
          const blend = motion.matches ? 1 : 1 - Math.exp(-10 * Math.min(time.deltaTime, 0.1));
          tiltX += (targetX - tiltX) * blend;
          tiltY += (targetY - tiltY) * blend;
          hover += (pointer.hover - hover) * blend;
          if (pointer.hover > 0) {
            lightX += (pointer.x - lightX) * blend;
            lightY += (pointer.y - lightY) * blend;
          }
          shader.set({ params: {
            tilt: [tiltX, tiltY], pointer: [lightX, lightY], hover,
            strength: 1, foilType: foilType(),
          } });
          currentFrame.pass(output, shader);
        } catch (error) {
          // Dispose after this frame unwinds, so its encoder is no longer active.
          queueMicrotask(() => fail(error));
          throw error;
        }
      }, { fps: 60 });
      stopLoop = () => loop.stop();
    };
    // Off-screen badges and hidden tabs stop rendering until they come back.
    observer = new IntersectionObserver(([entry]) => {
      visible = entry!.isIntersecting;
      if (!visible) pointer.hover = 0;
      resume();
    });
    observer.observe(link);
    document.addEventListener('visibilitychange', () => {
      pointer.hover = 0;
      resume();
    }, { signal: events.signal });
    resume();
  })().catch(fail);

  return { ready, dispose };
}

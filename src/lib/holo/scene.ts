import { effect, sampler, texture, type Gpu, type Target } from 'vgpu';
import fragment from './badge.wgsl?raw';

function uploadImage(gpu: Gpu, image: HTMLImageElement, label: string) {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(`Cannot read pixels for ${label}: 2D canvas is unavailable`);
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, width, height);

  const resource = texture(gpu, {
    kind: '2d',
    size: [width, height],
    format: 'rgba8unorm',
    usage: ['texture_binding', 'copy_dst'],
    label,
  });
  // Safari can reject decoded HTMLImageElements as external GPU images.
  // Upload straight-alpha RGBA pixels instead, as the vgpu demo does for lettering.
  gpu.gpu.queue.writeTexture(
    { texture: resource.gpu },
    data,
    { bytesPerRow: width * 4 },
    [width, height, 1],
  );
  return resource;
}

// The two foil masks are shared by every badge, so decode them once per page.
let foilImages: Promise<HTMLImageElement[]> | undefined;

export function loadFoilImages() {
  foilImages ??= Promise.all(['cubes.png', 'pixel-lattice.jpg'].map(async (file) => {
    const image = new Image();
    image.src = `${import.meta.env.BASE_URL}foils/${file}`;
    await image.decode();
    return image;
  }));
  return foilImages;
}

export function createScene(gpu: Gpu, output: Target, image: HTMLImageElement, foils: HTMLImageElement[]) {
  return effect(gpu, fragment, {
    label: 'holographic-certification-badge',
    set: {
      params: {
        resolution: output.size, tilt: [0, 0], pointer: [0.2, -0.25],
        hover: 0, strength: 1, foilType: 0,
      },
      badge: uploadImage(gpu, image, 'certification-artwork'),
      cubes: uploadImage(gpu, foils[0]!, 'cube-foil-mask'),
      lattice: uploadImage(gpu, foils[1]!, 'pixel-lattice-foil-mask'),
      linear: sampler(gpu, { minFilter: 'linear', magFilter: 'linear' }),
    },
  });
}

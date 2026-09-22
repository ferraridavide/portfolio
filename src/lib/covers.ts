import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';

/** Empty data-cover marks rows that should dismiss the previous preview. */
export async function coverAttributes(cover?: ImageMetadata | string) {
  if (!cover || typeof cover === 'string') {
    return { 'data-cover': cover ?? '' };
  }

  const image = await getImage({
    src: cover,
    width: 320,
    densities: [1, 2],
    format: 'webp',
    quality: 70,
  });

  return {
    'data-cover': image.src,
    'data-cover-srcset': image.srcSet.attribute,
  };
}

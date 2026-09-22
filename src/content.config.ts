import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/* One folder per post under src/content/posts, Hugo page-bundle style:
   src/content/posts/sunomi/index.md -> /posts/sunomi, with its assets
   (cover.jpg, diagrams, ...) sitting next to it. A trailing `/index` is
   stripped from the id, so flat `sunomi.md` files work the same way. */
const posts = defineCollection({
	loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
	/* `image()` resolves the path relative to the entry file and hands back
	   ImageMetadata, so a missing or misspelled cover fails the build */
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			/* Quoted or bare YAML dates both work: coerce normalises them to a Date */
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			description: z.string().optional(),
			/* Shown in the hover tooltip on the home page */
			cover: image().optional(),
			/* Kept out of the build in production, still visible in `astro dev` */
			draft: z.boolean().default(false),
		}),
});

/* Same page-bundle shape as `posts`, but a separate collection so the two
   never share a URL space or a listing: these are flying logs, not articles,
   and each one keeps its `track.igc` next to its photos. */
const flying = defineCollection({
	loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/flying' }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			description: z.string().optional(),
			/* Launch site, shown next to the title in the listing */
			site: z.string().optional(),
			cover: image().optional(),
			draft: z.boolean().default(false),
		}),
});

export const collections = { posts, flying };

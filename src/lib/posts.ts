import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

/** Newest first, with drafts hidden from production builds only. */
export async function getPosts(): Promise<Post[]> {
	const posts = await getCollection('posts', ({ data }) => import.meta.env.DEV || !data.draft);
	return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

/** "Feb 25, 2026" — UTC so a bare `2026-02-25` never slips to the previous day */
export function formatDate(date: Date): string {
	return date.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC',
	});
}

/** The route rendered by src/pages/posts/[...id].astro */
export function postHref(post: Post): string {
	return `${import.meta.env.BASE_URL}posts/${post.id}`;
}

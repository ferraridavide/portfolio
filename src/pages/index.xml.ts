import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import davide from '../assets/davide.jpg';
import { getFlights, flightHref } from '../lib/flying';
import { getPosts, postHref } from '../lib/posts';

const FEED_TITLE = 'Davide Ferrari';
const FEED_DESCRIPTION = 'Recent content on Davide Ferrari';

export async function GET({ site }: APIContext) {
	if (!site) {
		throw new Error('RSS generation requires the `site` option in astro.config.mjs.');
	}

	const [posts, flights] = await Promise.all([getPosts(), getFlights()]);
	const baseUrl = new URL(import.meta.env.BASE_URL, site);
	const feedUrl = new URL('index.xml', baseUrl);
	const imageUrl = new URL(davide.src, site);

	/* Articles and flying logs share one feed, interleaved by date, so a
	   subscriber sees them in the order they were published. Only posts carry a
	   legacy guid: the flying collection has never been published elsewhere. */
	const items = [
		...posts.map((post) => ({
			title: post.data.title,
			link: postHref(post),
			pubDate: post.data.pubDate,
			description: post.data.description,
		})),
		...flights.map((flight) => ({
			title: flight.data.title,
			link: flightHref(flight),
			pubDate: flight.data.pubDate,
			description: flight.data.description,
		})),
	].sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf());

	/* The newest change across both collections, so publishing a flight moves
	   the feed's timestamp just as publishing an article does */
	const lastBuildDate = [...posts, ...flights]
		.map((entry) => entry.data.updatedDate ?? entry.data.pubDate)
		.sort((a, b) => b.valueOf() - a.valueOf())[0];

	return rss({
		title: FEED_TITLE,
		description: FEED_DESCRIPTION,
		site: baseUrl,
		xmlns: {
			atom: 'http://www.w3.org/2005/Atom',
			content: 'http://purl.org/rss/1.0/modules/content/',
		},
		customData: [
			`<image><title>${FEED_TITLE}</title><url>${imageUrl}</url><link>${imageUrl}</link></image>`,
			'<generator>Astro</generator>',
			'<language>en-us</language>',
			lastBuildDate && `<lastBuildDate>${lastBuildDate.toUTCString()}</lastBuildDate>`,
			`<atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />`,
		]
			.filter(Boolean)
			.join(''),
		items,
	});
}

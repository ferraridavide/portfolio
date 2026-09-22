import { getCollection, type CollectionEntry } from 'astro:content';

export type Flight = CollectionEntry<'flying'>;

/** Newest first, with drafts hidden from production builds only. */
export async function getFlights(): Promise<Flight[]> {
	const flights = await getCollection('flying', ({ data }) => import.meta.env.DEV || !data.draft);
	return flights.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

/** The route rendered by src/pages/flying/[...id].astro */
export function flightHref(flight: Flight): string {
	return `${import.meta.env.BASE_URL}flying/${flight.id}`;
}

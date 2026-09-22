import type { APIContext } from 'astro';

/* Generated rather than dropped in public/ so the Sitemap line follows
   `site` in astro.config.mjs instead of pinning the domain in two places.
   Crawlers only read /robots.txt at the domain root, so this file is the
   one thing here that stops working if the site moves back under a `base`. */
export function GET({ site }: APIContext) {
	if (!site) {
		throw new Error('robots.txt generation requires the `site` option in astro.config.mjs.');
	}

	/* @astrojs/sitemap emits the index; it points at the numbered sitemaps */
	const sitemapUrl = new URL(`${import.meta.env.BASE_URL}sitemap-index.xml`, site);

	const body = `User-agent: *
Allow: /

Sitemap: ${sitemapUrl}
`;

	return new Response(body, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
}

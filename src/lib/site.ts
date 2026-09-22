/* Identity shared by the page chrome and the JSON-LD in Seo.astro, so a
   renamed job title or a moved profile only has to be changed in one place. */
export const profile = {
	name: 'Davide Ferrari',
	jobTitle: 'CloudOps Engineer',
	employer: 'beSharp',
	email: 'davideferrari.bns@gmail.com',
	twitterHandle: '@frrdavide',
	/* Emitted verbatim as the Person's `sameAs`, which is how search engines
	   decide these accounts and this site are the same person */
	socials: {
		github: 'https://github.com/ferraridavide',
		x: 'https://x.com/frrdavide',
		instagram: 'https://www.instagram.com/davideferrari.py',
		linkedin: 'https://www.linkedin.com/in/frrdavide',
		telegram: 'https://t.me/ferraridavide',
	},
} as const;

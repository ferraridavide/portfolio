// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';

import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://davide.im',

  integrations: [react(), mdx(), sitemap()],

  server: {
    allowedHosts: true,
  },

  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Geist',
      cssVariable: '--font-geist',
      // Variable axis, so any weight in the range is available at no extra cost
      weights: ['100 900'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['ui-sans-serif', 'system-ui', 'sans-serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'Geist Mono',
      cssVariable: '--font-geist-mono',
      weights: ['100 900'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
    },
    {
      provider: fontProviders.google(),
      name: 'Libre Baskerville',
      // Not `--font-libre-baskerville`: that name is the Tailwind theme token,
      // and pointing it at itself would be circular
      cssVariable: '--font-baskerville',
      weights: [400],
      styles: ['italic'],
      subsets: ['latin'],
      fallbacks: ['ui-serif', 'Georgia', 'serif'],
    },
  ],

  markdown: {
    shikiConfig: {
      // Dual themes: Shiki emits `--shiki-light`/`--shiki-dark` custom properties
      // instead of hard-coded colors, and global.css picks one per color scheme
      themes: { light: 'github-light', dark: 'github-dark' },
      // Drops the inline `color`/`background-color`, leaving only the variables,
      // so the surface can be styled from CSS without `!important`
      defaultColor: false,
    },
  },

  vite: {
    plugins: [tailwindcss()],
    /* Flight tracks live next to the post that shows them and are imported
       with `?url`; without this Vite treats the extension as source */
    assetsInclude: ['**/*.igc'],
  }
});

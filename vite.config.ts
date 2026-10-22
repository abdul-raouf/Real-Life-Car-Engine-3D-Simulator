import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

// Social previews need absolute URLs. Set SITE_URL (e.g. https://redline-recital.pages.dev)
// in the build environment; without it, links fall back to site-root paths.
const SITE_URL = (process.env.SITE_URL ?? '').replace(/\/$/, '');

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'site-url',
      transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', SITE_URL),
    },
  ],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: { main: page('./index.html'), makingOf: page('./making-of.html') },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});

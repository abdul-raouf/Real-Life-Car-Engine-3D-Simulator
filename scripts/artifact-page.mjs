// Turn the Vite build into an Artifact page: the host supplies <!doctype>, <html>,
// <head>, <body>, charset and viewport, so strip those and keep everything else.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const page = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '')
  .replace(/<\/html>\s*/i, '')
  .replace(/<head>\s*/i, '')
  .replace(/<\/head>\s*/i, '')
  .replace(/<body>\s*/i, '')
  .replace(/<\/body>\s*/i, '')
  .replace(/\s*<meta charset="UTF-8" \/>/i, '')
  .replace(/\s*<meta name="viewport"[^>]*>/i, '')
  .trim();
writeFileSync('dist/page.html', page + '\n');
const assets = readdirSync('dist/assets');
console.log(JSON.stringify(Object.fromEntries(assets.map((f) => [`assets/${f}`, `dist/assets/${f}`])), null, 2));

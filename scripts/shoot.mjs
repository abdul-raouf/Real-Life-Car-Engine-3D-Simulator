// Screenshot harness: node scripts/shoot.mjs <url> <outDir> [engines...]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [url, outDir, ...ids] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);
for (const id of ids.length ? ids : ['v8']) {
  await page.evaluate((id) => window.__show(id), id);
  await page.evaluate(() => window.__cycle(95));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/${id}.png` });
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();

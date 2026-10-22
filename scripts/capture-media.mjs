// Screenshots for the case study and the social preview card.
// Usage: npm run build && npx vite preview --port 4173, then: node scripts/capture-media.mjs
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://localhost:4173/';
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

async function revved(viewport, id, { hideUi = false } = {}) {
  const page = await browser.newPage({ viewport, colorScheme: 'dark' });
  await page.goto(`${URL}#${id}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__redline);
  await page.click('#start');
  await page.waitForFunction(() => window.__redline.sim.state === 'running', null, { timeout: 30000 });
  if (hideUi) {
    await page.addStyleTag({ content: '.card, .console, .toast, .byline, .engines { display: none !important; }' });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  }
  // Hold a high, steady note so the headers glow and the pulses run.
  await page.evaluate(() => {
    const r = window.__redline;
    r.setMode('play');
    r.noteOn(64);
  });
  // Software rendering is slow: wait on the header heat, not the clock.
  await page.waitForFunction(() => window.__redline.state.heat > 0.55, null, { timeout: 120000 }).catch(() => {});
  await page.evaluate(() => (window.__redline.stage.autoRotate = false));
  await page.waitForTimeout(3000);
  return page;
}

const only = process.argv[3];
let page;
if (only !== 'og') {
page = await revved({ width: 1600, height: 1000 }, 'v8');
await page.screenshot({ path: 'public/media/hero-v8.jpg', type: 'jpeg', quality: 84 });
await page.close();

page = await revved({ width: 1600, height: 1000 }, 'r2');
await page.screenshot({ path: 'public/media/rotary.jpg', type: 'jpeg', quality: 84 });
await page.close();
}

// Social card: title on the left, the engine framed in the right 60%.
page = await revved({ width: 1200, height: 630 }, 'v8', { hideUi: true });
await page.addStyleTag({
  content: `
    .topbar, .card, .console, .toast, .gate { display: none !important; }
    .og { position: fixed; left: 56px; top: 0; bottom: 0; width: 470px; display: grid; align-content: center; gap: 18px; z-index: 9; }
    .og h1 { margin: 0; font-family: var(--font-display); font-weight: 800; font-size: 96px; line-height: 0.86; text-transform: uppercase; color: var(--ink); }
    .og p { margin: 0; font-size: 24px; line-height: 1.35; color: var(--ink); }
    .og small { font-size: 17px; color: var(--ink-2); }
    .og b { color: var(--gold); font-family: var(--font-data); font-weight: 600; font-size: 21px; }
  `,
});
await page.evaluate(() => {
  const d = document.createElement('div');
  d.className = 'og';
  d.innerHTML =
    '<h1>Redline<br>Recital</h1><p>Eight 3D engines tuned like instruments. A V8 at 3,300 rpm hums <b>A3</b>.</p><small>By Abdul Raouf · Built with Claude Code</small>';
  document.body.append(d);
  const r = window.__redline;
  r.stage.setFocus(520, 20, 680, 600);
  r.frameEngine();
});
await page.waitForTimeout(4000);
await page.screenshot({ path: 'public/og.png' });
await page.close();

await browser.close();
console.log('captured');

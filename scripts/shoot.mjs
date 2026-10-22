// End-to-end check in headless Chromium: start the engine, rev it, swap engines,
// try every mode, at desktop and phone sizes, in dark and light themes.
// Usage: node scripts/shoot.mjs <url> <outDir>

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [url, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const problems = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(name, options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[${name}] console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[${name}] page error: ${e}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__redline, null, { timeout: 30000 });
  await wait(2000);
  return { context, page };
}

async function audioLevel(page) {
  return page.evaluate(() => {
    const a = window.__redline.audio;
    if (!a.analyser) return { state: 'none', mode: a.mode, rms: 0 };
    const d = new Float32Array(a.analyser.fftSize);
    a.analyser.getFloatTimeDomainData(d);
    let s = 0;
    for (const v of d) s += v * v;
    return { state: a.ctx.state, mode: a.mode, rms: Math.sqrt(s / d.length) };
  });
}

async function noOverflow(page, name) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  if (o.sw > o.cw + 1) problems.push(`[${name}] horizontal overflow ${o.sw} > ${o.cw}`);
}

// ---- Desktop, dark ------------------------------------------------------------------
{
  const { context, page } = await open('desktop', { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  await page.screenshot({ path: `${outDir}/01-gate.png` });
  await page.click('#start');
  // Headless software rendering runs at about 1 fps, so wait on engine state, not on the clock.
  await page.waitForFunction(() => window.__redline.sim.state === 'running', null, { timeout: 30000 });
  await wait(2500);
  await page.screenshot({ path: `${outDir}/02-idle.png` });
  const idle = await audioLevel(page);
  console.log('audio at idle', idle);
  if (idle.state !== 'running') problems.push(`audio context not running: ${idle.state}`);
  if (!(idle.rms > 0.002)) problems.push(`audio silent at idle: rms ${idle.rms}`);

  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__redline.sim.rpm > 5000, null, { timeout: 30000 }).catch(() => {});
  const revving = await page.evaluate(() => window.__redline.sim.rpm);
  const rev = await audioLevel(page);
  await page.screenshot({ path: `${outDir}/03-rev.png` });
  await page.keyboard.up('Space');
  console.log('rpm while revving', Math.round(revving), 'rms', rev.rms.toFixed(4));
  if (revving < 3000) problems.push(`space did not rev the engine: ${revving}`);
  await wait(1500);

  for (const [k, id] of ['i4', 'b4', 'i6', 'v8', 'v12', 'v10', 'v6', 'r2'].entries()) {
    await page.keyboard.press(`Digit${k + 1}`);
    await page.waitForFunction((id) => window.__redline.state.spec.id === id, id, { timeout: 30000 }).catch(() => {});
    await wait(1800);
    const cur = await page.evaluate(() => window.__redline.state.spec.id);
    if (cur !== id) problems.push(`engine key ${k + 1} selected ${cur}, expected ${id}`);
    await page.screenshot({ path: `${outDir}/04-engine-${id}.png` });
  }

  await page.keyboard.press('Digit4');
  await wait(1200);
  await page.click('#tab-play');
  await wait(300);
  await page.keyboard.down('h');
  await page.waitForFunction(() => Math.abs(window.__redline.sim.rpm - 3300) < 20, null, { timeout: 30000 }).catch(() => {});
  const playRpm = await page.evaluate(() => window.__redline.sim.rpm);
  if (Math.abs(playRpm - 3300) > 20) problems.push(`H on a V8 should hold A3 at 3300 rpm, got ${playRpm}`);
  await page.screenshot({ path: `${outDir}/05-play.png` });
  await page.keyboard.up('h');
  console.log('play: held H, rpm', Math.round(playRpm));

  await page.click('#demo-play');
  await wait(3000);
  await page.screenshot({ path: `${outDir}/06-demo.png` });
  await page.click('#demo-play');

  // The new engines hold notes too: A3 is 4,400 rpm on the V6 and 6,600 rpm on the rotary.
  for (const [key, id, rpm] of [['Digit7', 'v6', 4400], ['Digit8', 'r2', 6600]]) {
    await page.keyboard.press(key);
    await page.waitForFunction((id) => window.__redline.state.spec.id === id, id, { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => window.__redline.noteOn(57));
    await page.waitForFunction((rpm) => Math.abs(window.__redline.sim.rpm - rpm) < rpm * 0.006, rpm, { timeout: 40000 }).catch(() => {});
    const got = await page.evaluate(() => window.__redline.sim.rpm);
    await page.evaluate(() => window.__redline.noteOff(57));
    console.log(`${id}: A3 held at`, Math.round(got), 'rpm');
    if (Math.abs(got - rpm) > rpm * 0.006) problems.push(`${id} should hold A3 at ${rpm} rpm, got ${got}`);
  }

  await page.click('#tab-hero');
  await wait(300);
  await page.click('#hero-start');
  const hw = await page.locator('#highway').boundingBox();
  await page.mouse.move(hw.x + hw.width * 0.5, hw.y + hw.height * 0.5);
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(hw.x + hw.width * 0.5, hw.y + hw.height * (0.3 + 0.02 * i));
    await wait(200);
  }
  await page.screenshot({ path: `${outDir}/07-hero.png` });
  await noOverflow(page, 'desktop');
  await context.close();
}

// ---- Desktop, light ------------------------------------------------------------------
{
  const { context, page } = await open('light', { viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
  await page.click('#start');
  await wait(3000);
  await page.screenshot({ path: `${outDir}/08-light.png` });
  await context.close();
}

// ---- Phone -----------------------------------------------------------------------------
{
  const { context, page } = await open('phone', {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  });
  await page.screenshot({ path: `${outDir}/09-phone-gate.png` });
  await page.tap('#start');
  await wait(3500);
  await page.screenshot({ path: `${outDir}/10-phone-idle.png` });
  await noOverflow(page, 'phone');
  await page.tap('#t-info');
  await wait(500);
  await page.screenshot({ path: `${outDir}/11-phone-notes.png` });
  await page.tap('#card-close');
  await page.tap('#tab-play');
  await wait(500);
  await page.screenshot({ path: `${outDir}/12-phone-play.png` });
  await page.tap('#tab-hero');
  await wait(300);
  await page.tap('#hero-start');
  await wait(2500);
  await page.screenshot({ path: `${outDir}/13-phone-hero.png` });
  await noOverflow(page, 'phone-hero');
  await context.close();
}

await browser.close();
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no problems found');

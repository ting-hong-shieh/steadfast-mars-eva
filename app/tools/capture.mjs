// Written with AI tools (Claude and Codex). See AI_USE.md.
// Captures the concept build at two sizes for review. Usage: npm run build && npm run capture
// A second argument keeps only the shots whose name holds one of its comma-separated words, and a
// third keeps one size: node tools/capture.mjs captures tour,card desktop
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = join(homedir(), '.cache', 'ms-playwright');
  const dirs = readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse();
  for (const d of dirs) {
    for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
      const p = join(root, d, sub);
      if (existsSync(p)) return p;
    }
  }
  throw new Error('No Chromium found. Set CHROMIUM=/path/to/chrome');
}

const out = process.argv[2] || 'captures';
const only = (process.argv[3] || '').split(',').filter(Boolean);
const onlySize = process.argv[4] || '';
const scale = Number(process.env.CAPTURE_SCALE) || 2;   // CAPTURE_SCALE=1 is four times fewer pixels, for a quick look
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const errors = [];
try {
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const shots = [
    ['hab-start', ''],
    ['hab-late', 't=7'],
    ['measured-forward', 's=4'],
    ['measured-look-down', 's=9&look=down'],
    ['forward', 's=40'],
    ['look-down', 's=95&look=down'],
    ['agent', 's=120&agent=1'],
    ['turn-back', 's=150&t=7.6'],
    ['alarm', 's=260&alarm=1'],
    ['turn-back-behind', 's=150&t=7.6&look=back'],
    ['turn-back-auto', 's=150&t=7.6&auto=1'],
    ['alarm-dip', 's=260&alarm=1&t=8.38'],
    ['late', 's=60&t=6.55'],
    ['station-photo', 's=170'],
    ['station-photo-agent', 's=170&agent=1'],
    // The card at each station: the rover's photo, the reason, and the chemistry measured there.
    ['station-card-a', 's=193'],
    ['station-card-b', 's=471'],
    ['station-card-c', 's=577'],
    ['map-close', 's=40&map=0'],
    ['map-wide', 's=40&map=3'],
    ['map-widest', 's=40&map=4'],
    ['map-geology', 's=40&layer=geology'],
    ['map-open', 's=40&mapopen=1'],
    ['map-open-geology', 's=40&mapopen=4&layer=geology'],
    // The cards over the view: the seven steps of the guided tour and a layer card.
    ['tour-1-plan', 'tour=1'],
    ['tour-2-walk', 'tour=2'],
    ['tour-3-ground', 'tour=3'],
    ['tour-4-station', 'tour=4'],
    ['tour-5-margin', 'tour=5'],
    ['tour-6-late', 'tour=6'],
    ['tour-7-storm', 'tour=7'],
    ['card-layer', 's=40&explain=ground'],
  ].filter(([name]) => !only.length || only.some((w) => name.includes(w)));
  const sizes = [['desktop', 1440, 900], ['phone', 390, 844]].filter(([name]) => !onlySize || name === onlySize);
  // The scene is drawn in software here, so one frame can take many seconds: the waits are long.
  for (const [sizeName, width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    page.on('pageerror', (e) => errors.push(`${sizeName}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${sizeName}: ${m.text()}`); });
    for (const [name, query] of shots) {
      await page.goto(`http://localhost:4173/?${query}`, { timeout: 180000 });
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
      await page.waitForTimeout(2500);
      // The station card opens a moment after the arrival, and its photo unrolls.
      if (name.startsWith('station-card')) { await page.waitForSelector('#choice:not([hidden]) .chem', { timeout: 180000 }); await page.waitForTimeout(2500); }
      await page.screenshot({ path: join(out, `${name}-${sizeName}.png`), timeout: 240000 });
      if (name === 'measured-forward' && sizeName === 'desktop') {
        console.log('footholds', JSON.stringify(await page.evaluate(() => window.__footholds.stats)));
        console.log('route', JSON.stringify(await page.evaluate(() => window.__route)));
        console.log('first40', JSON.stringify(await page.evaluate(() => window.__footholds.first.map((f) => [f.side, +f.inclineDeg.toFixed(1), +f.support.toFixed(2), f.valid ? 1 : 0, f.measured ? 1 : 0, +f.moved.toFixed(2)]))));
      }
      console.log(`captured ${name}-${sizeName}`);
    }
    await page.close();
  }
  await browser.close();
} finally {
  server.kill();
}
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'page errors: 0');
process.exit(errors.length ? 1 : 0);

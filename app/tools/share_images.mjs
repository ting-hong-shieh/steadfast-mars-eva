// Written with an AI tool (Claude). See AI_USE.md.
// Makes the two pictures a shared link and a home-screen shortcut need, from the built app:
//   public/social.jpg            a screenshot of the helmet view, 1440 x 756 (the 1.91 : 1 of a link preview)
//   public/apple-touch-icon.png  public/favicon.svg drawn at 180 x 180
// Usage: npm run build && node tools/share_images.mjs   (then build again, so dist holds the new files)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = join(homedir(), '.cache', 'ms-playwright');
  for (const d of readdirSync(root).filter((q) => q.startsWith('chromium-')).sort().reverse()) {
    for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) { const p = join(root, d, sub); if (existsSync(p)) return p; }
  }
  throw new Error('No Chromium found. Set CHROMIUM=/path/to/chrome');
}
const PORT = '4174';
const server = spawn('npx', ['vite', 'preview', '--port', PORT, '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
try {
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  // The walk 40 m along the route, every panel open. The line at the foot of the view says what is simulated and that AI tools were used.
  const page = await browser.newPage({ viewport: { width: 1440, height: 756 }, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${PORT}/?s=40`, { timeout: 180000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'public/social.jpg', type: 'jpeg', quality: 86, timeout: 240000 });
  console.log('public/social.jpg');
  const icon = await browser.newPage({ viewport: { width: 180, height: 180 }, deviceScaleFactor: 1 });
  // A home-screen icon gets its round corners from the phone, so the square fills the picture.
  const svg = readFileSync('public/favicon.svg', 'utf8').replace('rx="14"', 'rx="0"');
  await icon.setContent(`<body style="margin:0;background:#07090b">${svg.replace('<svg ', '<svg width="180" height="180" ')}</body>`);
  await icon.screenshot({ path: 'public/apple-touch-icon.png', timeout: 60000 });
  console.log('public/apple-touch-icon.png');
  await browser.close();
} finally {
  server.kill();
}

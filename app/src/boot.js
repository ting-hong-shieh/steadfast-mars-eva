// Written with an AI tool (Claude). See AI_USE.md.
// Load the terrain files first, then start the app.
import { loadTerrain } from './terrain.js';
import { loadRad } from './rad.js';
import { loadMinimap } from './minimap.js';
import { loadEnv, evaStartUtc } from './env.js';
import { loadSites, SITE, IMAGINED_PLACES } from './site.js';
import { setPlaces } from './route.js';
import { loadWorld } from './world.js';

// The start screen and the training are run by game.js once the app has loaded.
// The loading screen (index.html) counts the parts as they arrive, so it moves while the files load.
const PARTS = 5; let got = 0;
const part = (name) => (v) => {
  got += 1;
  const bar = document.getElementById('bootBar'), step = document.getElementById('bootStep');
  if (bar) bar.style.transform = `scaleX(${(0.84 * got / PARTS).toFixed(3)})`;
  if (step) step.textContent = `${got} OF ${PARTS} · ${name}`;
  return v;
};
loadSites().then(() => {
  if (!SITE.main) setPlaces(IMAGINED_PLACES);
  return Promise.all([loadTerrain(SITE.base).then(part('TERRAIN')), loadWorld().then(part('WORLD MAP')), loadEnv().then(() => loadRad(evaStartUtc())).then(part('WEATHER AND RADIATION')), loadMinimap().then(part('MAP TILES'))]);
}).then(() => { const step = document.getElementById('bootStep'); if (step) step.textContent = 'BUILDING THE VIEW';
  // The last part runs on the main thread for a second or more: the bar creeps on toward its end meanwhile.
  const bar = document.getElementById('bootBar');
  if (bar) { bar.style.transitionDuration = '7s'; bar.style.transform = 'scaleX(0.97)'; }
  // Two frames, so the bar has started to move before the script takes the main thread. A tab in the background draws no frame: the timer lets it go on.
  return new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 150); }).then(() => import('./main.js')); }).then(part('DISPLAY')).then(() => document.body.classList.add('styled')).catch((err) => {
  document.getElementById('boot')?.remove();
  document.body.insertAdjacentHTML('beforeend',
    `<pre style="visibility:visible;position:fixed;inset:0;margin:0;padding:24px;color:#ffb347;background:#120b08;font:14px monospace">Data files did not load.\n${String(err)}</pre>`);
});

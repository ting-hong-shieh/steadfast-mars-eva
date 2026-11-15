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
loadSites().then(() => { if (!SITE.main) setPlaces(IMAGINED_PLACES); return Promise.all([loadTerrain(SITE.base), loadWorld(), loadEnv().then(() => loadRad(evaStartUtc())), loadMinimap()]); }).then(() => import('./main.js')).then(() => document.body.classList.add('styled')).catch((err) => {
  document.body.insertAdjacentHTML('beforeend',
    `<pre style="visibility:visible;position:fixed;inset:0;margin:0;padding:24px;color:#ffb347;background:#120b08;font:14px monospace">Data files did not load.\n${String(err)}</pre>`);
});

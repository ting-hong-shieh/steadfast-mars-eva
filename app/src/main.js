// Written with AI tools (Claude and Codex). See AI_USE.md.
// Concept build of the helmet view. docs/methods.md lists what is measured and what is simulated.
import * as THREE from 'three';
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import './style.css';
import { buildTerrain, buildSky, heightAt, slopeDegAt, inNavcamSquare, classAt, classPatchAt, classPatches, setClassLook, clearRocksNear, TERRAIN_SIZE } from './terrain.js';
import { Route, buildRouteLine, buildBeacons, Footsteps, ReturnLine, PLACES } from './route.js';
import { spread, cellOf, cellXZ, toblerFactor, etaAt, useEta, heightGrid, GRID_N, CELL, usePlan, planTraverse, pathFacts, slopeGrid, shadeGrid, STEEP_DEG, SUN, WEIGHT } from './planner.js';
import { supply, edgeO2, kjhToGPerMin, kjhToVo2, vo2Walk, vo2Level, vo2ToGPerMin, vo2ToWatts, hrFromVo2,
  STATION_KJ_H, EVA_MEAN_KJ_H, LEAK_KJ_H, BAND, ETA_DEFAULT, ETA_BY_CLASS, SUSTAIN, HR_BAND } from './metabolic.js';
import { radNow, radDose, setRadShift, radShownAt, fmtRate, FLICKER } from './rad.js';
import { envNow, sunNow, setDeparture, daylight, DEPART_DEFAULT } from './env.js';
import { lineOfSight, stateWithHold } from './los.js';
import { Minimap } from './minimap.js';
import { reachMask, contour, ReachLine } from './reach.js';
import { returnConfidence, GO_AT } from './confidence.js';
import { buildHabitat } from './habitat.js';
import { Companion, ev2Ratio, PAIR_RATIO_MAX, LEAD_M, SIDE_M } from './crew.js';
import { setupLook } from './look.js';
import { setupGame } from './game.js';
import { setupWorld } from './world.js';
import { SITE } from './site.js';
import { setupNpcs } from './npc.js';

// Assumptions of the simulation. Each has a note on where the number comes from.
// They are shown to the user in the agent text. See docs/research-digest.md, section 1.
const ASSUME = {
  evaLimitH: 8,        // Design target for exploration EVAs is 6 to 8 h (NASA HRP evidence report, 2021).
  reserveMin: 30,      // Apollo planning kept a 30 minute consumables reserve (Bellcomm memo, 1970).
  walkKmh: 2.7,        // Walk-back planning speed used for Apollo 17 (ALSJ editors' note).
};
// Oxygen in the suit: our sizing assumption (metabolic.js supply), stated on screen.
const O2 = supply(ASSUME.evaLimitH, ASSUME.reserveMin);
const FLAT_MPS = ASSUME.walkKmh / 3.6;
// Rates in grams per minute. Station work and standing use the Apollo geology-station mean.
const STATION_GPM = kjhToGPerMin(STATION_KJ_H + LEAK_KJ_H);
// The rate a turn-back margin in grams is turned into minutes with: walking on flat ground at the
// planning speed with the carried load, with the safety band and the leak. Set by buildFields().
let WALK_GPM = 0;
const EYE = 1.72;
const DEMO_SPEED = 1.6; // metres per second on screen. Faster than the planning speed, so the demo moves.

const params = new URLSearchParams(location.search);
// ?glass=0.4 sets how dark the glass cards are, from 0 (clear) to 1 (solid), so the team can try values (hud2.css, --glass).
// ?sat=1.1 sets how much of the view's colour the pane keeps (--glass-sat): lower is greyer and cooler.
{ const st = document.documentElement.style, g = parseFloat(params.get('glass')), sat = parseFloat(params.get('sat'));
  if (g >= 0 && g <= 1) { st.setProperty('--glass', g); st.setProperty('--glass-deep', Math.min(1, g + 0.16)); }
  if (sat >= 0 && sat <= 3) st.setProperty('--glass-sat', sat); }
// EV2 uses ev2Now times EV1's oxygen from now on (crew.js). Every oxygen limit takes whoever runs
// out first. Key E raises ev2Now to the largest Apollo pair (film scene).
let ev2Base = params.get('ev2'), ev2Now = ev2Ratio(ev2Base), ev2Raised = null;
// ?yaw=<degrees> turns the head at the start, for captures.
const state = {
  s: Number(params.get('s') || 0),
  elapsedSec: Math.min(8, Math.max(0, Number(params.get('t')) || 0)) * 3600,
  auto: params.get('auto') === '1',
  lookDown: params.get('look') === 'down',
  alarm: params.get('alarm') === '1' ? 0 : null,   // EVA time when the replay of the measured particle event began
  pos: new THREE.Vector3(), heading: 0, pitch: 0, yawOffset: params.get('look') === 'back' ? Math.PI : Number(params.get('yaw') || 0) * Math.PI / 180, bob: 0,
  keys: new Set(),
};
let evaStarted = state.s > 0 || state.elapsedSec > 0 || state.alarm !== null;
// Oxygen used so far. A capture that starts later in the EVA (?t=) assumes the Apollo mean rate.
state.o2Used = Math.min(O2.totalG, state.elapsedSec / 60 * kjhToGPerMin(EVA_MEAN_KJ_H + LEAK_KJ_H));
state.o2Used2 = Math.min(O2.totalG, state.o2Used * ev2Now);
// Oxygen used by both: EV1 uses g, EV2 uses ev2Now * g. Neither tank goes below empty.
function useO2(g) {
  state.o2Used = Math.min(O2.totalG, state.o2Used + g);
  state.o2Used2 = Math.min(O2.totalG, state.o2Used2 + g * ev2Now);
}
state.vo2 = kjhToVo2(STATION_KJ_H);

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#cf9f78', 0.0052);
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 4000);
camera.rotation.order = 'YXZ';

const sky = buildSky();
scene.add(sky);
const hemi = new THREE.HemisphereLight('#e9c3a2', '#5a3222', 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff0dd', 2.3);
const sunDir = new THREE.Vector3(0.45, 0.32, -0.83).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 400 });
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);
// Scene look (look.js): the default since 2026-11-14 (owner: game-level presentation). ?look=old
// keeps the earlier plain render.
const look = params.get('look') !== 'old' ? setupLook({ renderer, scene, camera, sun, hemi, sky }) : null;

scene.add(buildTerrain(renderer));
// The habitat at HAB and the second astronaut (habitat.js, crew.js). Both load in the background.
buildHabitat(PLACES[0]).then((g) => { scene.add(g); window.__habitat = g.userData; }).catch((e) => console.error('habitat', e));
const ev2 = new Companion();
scene.add(ev2.group);
ev2.load().catch((e) => console.error('ev2', e));

// Ground factor of each 2 m planning cell from the ground classes of the terrain model. A cell is
// sampled every 20 cm. Samples without a class (outside the Navcam square, gaps) take the default.
const etaCells = new Float32Array(GRID_N * GRID_N).fill(ETA_DEFAULT);
let etaClassed = 0;
for (let i = 0; i < etaCells.length; i++) {
  const q = cellXZ(i);
  if (!classPatchAt(q.x, q.z)) continue;
  let sum = 0, n = 0, known = 0;
  for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) {
    const k = classAt(q.x - CELL / 2 + (a + 0.5) * CELL / 10, q.z - CELL / 2 + (b + 0.5) * CELL / 10);
    sum += k >= 0 ? ETA_BY_CLASS[k] : ETA_DEFAULT; n++; if (k >= 0) known++;
  }
  etaCells[i] = sum / n; if (known) etaClassed++;
}
useEta(etaCells);
window.__eta = { cellsWithClass: etaClassed };
// ---------- What the route considers ----------
// The team's idea of 2026-11-15: before going out, the crew picks what the route considers (plan
// screen, game.js). Every path of the walk then uses that plan: the route, the way home, the
// turn-back numbers and the safe-return line.
//   steep   ground steeper than STEEP_DEG is an obstacle (planner.js)
//   shade   avoid ground in the shadow of the terrain, for the sun of the planned hour
//   loadKg  carried equipment: it changes the oxygen itself (metabolic.js)
//   depart  the hour of departure, LMST: it moves the sun, the weather and the dose rate (env.js)
// The choices on offer and the defaults are ours. Obstacles are on, because the challenge asks
// for a route that avoids them. ?steep=0, ?shade=1, ?load=20, ?depart=15:30 set them for a capture.
const LOADS = [0, 10, 20, 30], DEPARTS = ['06:00', DEPART_DEFAULT, '15:30'];
const planOpts = {
  steep: params.get('steep') !== '0', shade: params.get('shade') === '1',
  loadKg: LOADS.includes(Number(params.get('load'))) ? Number(params.get('load')) : 0,
  depart: DEPARTS.includes(params.get('depart')) ? params.get('depart') : DEPART_DEFAULT,
};
// Time, oxygen and distance to each place from every 2 m cell of the ground (planner.js). Each
// place has the sun of the hour at which the plan starts the leg that ends there.
const toward = new Map();
let home = null;
function buildFields() {
  setRadShift(setDeparture(planOpts.depart));
  toward.clear();
  let clock = 0;
  for (let k = 1; k < PLACES.length; k++) {
    const pl = PLACES[k], from = PLACES[k - 1];
    const cost = { base: 'o2', steep: planOpts.steep, shade: planOpts.shade, sun: sunNow(clock), loadKg: planOpts.loadKg };
    const f = spread(cellOf(pl.x, pl.z), ASSUME.walkKmh, true, cost);
    f.cost = cost;
    toward.set(pl.name, f);
    clock += f.time[cellOf(from.x, from.z)] + (pl.workMin || 0) * 60;
  }
  home = toward.get('HAB');
  // A path asked with 'plan' and without a field (a spread from where the astronaut stands) uses
  // the factors of the way home.
  usePlan(home.cost);
  WALK_GPM = vo2ToGPerMin(vo2Walk(FLAT_MPS, 0, ETA_DEFAULT, planOpts.loadKg) + BAND) + kjhToGPerMin(LEAK_KJ_H);
}
buildFields();
const returnLine = new ReturnLine(home);
scene.add(returnLine.mesh);

// Safe-return line (reach.js). The spread from the astronaut's cell runs in a worker; the line is
// rebuilt when a new spread arrives. Asked again after 3 m of movement or 4 s.
const reachLine = new ReachLine();
scene.add(reachLine.mesh);
const reachWorker = new Worker(new URL('./reach.worker.js', import.meta.url), { type: 'module' });
reachWorker.postMessage({ type: 'init', heights: heightGrid(), eta: etaCells, kmh: ASSUME.walkKmh, cost: home.cost });
let fromField = null, reachAsk = null, reachBusy = false, reachSegs = [], reachMaskNow = null;
reachWorker.onmessage = (e) => { fromField = e.data; reachBusy = false; rebuildReach(); };
function askReach(now) {
  if (reachBusy) return;
  if (reachAsk && Math.hypot(state.pos.x - reachAsk.x, state.pos.z - reachAsk.z) < 3 && now - reachAsk.t < 4000) return;
  reachBusy = true; reachAsk = { x: state.pos.x, z: state.pos.z, t: now };
  reachWorker.postMessage({ type: 'spread', x: state.pos.x, z: state.pos.z });
}
// Oxygen above the reserve, in grams of EV1's use, for the pair: what EV2 has left, divided by
// EV2's multiple, and EV2's reserve is ev2Now times EV1's.
const o2BudgetG = () => Math.min(O2.totalG - state.o2Used, (O2.totalG - state.o2Used2) / ev2Now) - O2.reserveG;
const budgets = () => ({ t: ASSUME.evaLimitH * 3600 - state.elapsedSec - ASSUME.reserveMin * 60, g: o2BudgetG() });
function rebuildReach() {
  if (!fromField) return;
  const b = budgets();
  const mask = reachMask(fromField, home, b.t, b.g);
  reachSegs = contour(mask, GRID_N, CELL, TERRAIN_SIZE / 2);
  reachMaskNow = mask;
  reachLine.set(reachSegs);
  let inside = 0; for (let i = 0; i < mask.length; i++) inside += mask[i];
  window.__reach = { segments: reachSegs.length, insideShare: +(inside / mask.length).toFixed(3) };
}

// The route and what hangs on it. Rebuilt when the plan changes on site.
let route, routeLine, beacons, steps;
function setRoute(places) {
  for (const o of [routeLine, beacons, steps && steps.group]) if (o) scene.remove(o);
  route = new Route(ASSUME.walkKmh, places, toward);
  routeLine = buildRouteLine(route); beacons = buildBeacons(route); steps = new Footsteps(route);
  scene.add(routeLine, beacons, steps.group);
}
setRoute(PLACES);
// Generated rocks are decoration that no camera measured: none stays on the planned path (terrain.js).
clearRocksNear(route.samples.map((q) => q.p), 3);
window.__route = { lengthM: Math.round(route.length), plannedMin: Math.round(route.plannedSeconds / 60), stations: route.stations.map((st) => [st.name, Math.round(st.s)]), maxReturnMin: Math.round(Math.max(...route.samples.map((q) => home.time[cellOf(q.p.x, q.p.z)])) / 60) };
window.__footholds = { stats: steps.plan.stats, inSquare: steps.plan.filter((f) => inNavcamSquare(f.x, f.z)).length, first: steps.plan.slice(0, 40) };
// Line of sight from any point to the habitat, for the capture checks.
window.__los = (x, z) => lineOfSight(heightAt, x, z, PLACES[0].x, PLACES[0].z);
window.__losRoute = () => route.samples.filter((q, k) => k % 4 === 0).map((q) => ({ s: Math.round(q.s), ...lineOfSight(heightAt, q.p.x, q.p.z, PLACES[0].x, PLACES[0].z) }));

// Start on the route.
{
  const { p, heading } = route.at(state.s);
  state.pos.copy(p); state.heading = heading;
  // ?side=<m> starts that many metres to the right of the route (for the off-route captures).
  const side = Number(params.get('side') || 0);
  state.pos.x += Math.cos(heading) * side; state.pos.z += Math.sin(heading) * side;
  state.lastH = heightAt(p.x, p.z);
}

// ---------- Input ----------
// One press is one action. A held key repeats, and an input method (Chinese, Japanese) can deliver the
// same key twice, which switched a panel on and off again in one press. The walking keys are held on purpose.
const HELD_KEYS = /^(Key[WASD]|Arrow|Shift|Space)/, lastDown = {};
addEventListener('keydown', (e) => {
  if (HELD_KEYS.test(e.code || '')) return;
  const now = performance.now();
  if (e.repeat || now - (lastDown[e.code] || -1e9) < 250) { e.stopImmediatePropagation(); if (e.code === 'Tab') e.preventDefault(); return; }
  lastDown[e.code] = now;
}, true);
addEventListener('keydown', (e) => {
  state.keys.add(e.code);
  if (e.code === 'KeyV') state.lookDown = !state.lookDown;
  if (e.code === 'KeyP') state.auto = !state.auto;
  // +30 min, up to the EVA limit.
  if (e.code === 'KeyT') { const dt = Math.min(1800, Math.max(0, ASSUME.evaLimitH * 3600 - state.elapsedSec)); state.elapsedSec += dt; useO2(dt / 60 * STATION_GPM); evaStarted = true; }
  // E: EV2 uses more oxygen than EV1. E again: EV2 is back at the starting ratio (the oxygen already used stays used).
  if (e.code === 'KeyE') {
    if (ev2Raised === null) { ev2Now = PAIR_RATIO_MAX; ev2Raised = performance.now(); } else { ev2Now = ev2Ratio(ev2Base); ev2Raised = null; }
    agentDismissed = null; agentShown = ''; agentTypedAt = performance.now();
  }
  if (e.code === 'KeyG') toggleAgent();
  if (e.code === 'KeyL') minimap.toggleLayer();
  // C: show the ground classes in the model's colours, or as materials again.
  if (e.code === 'KeyC') { classLabels = !classLabels; setClassLook(classLabels ? 'label' : 'material'); }
  if (e.code === 'Equal' || e.code === 'NumpadAdd') minimap.step(-1);
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') minimap.step(1);
  if (e.code === 'Enter' && offInfo && offInfo.suggest) checkPlan(true);
  if (e.code === 'Escape' && offInfo && offInfo.suggest) { offSnoozeAt = state.offset; offInfo = null; agentShown = ''; agentTypedAt = performance.now(); }
  if (e.code === 'KeyR') {
    state.alarm = state.alarm === null ? state.elapsedSec : null;
    evaStarted = true;
    agentShown = ''; agentTypedAt = performance.now();
  }
});
addEventListener('keyup', (e) => state.keys.delete(e.code));
document.querySelectorAll('#keys button').forEach((b) => b.addEventListener('click', () => {
  dispatchEvent(new KeyboardEvent('keydown', { code: b.dataset.key }));
  dispatchEvent(new KeyboardEvent('keyup', { code: b.dataset.key }));
}));
// Phone: a virtual joystick at the lower left (owner, 2026-11-15 22:35: without one it is hard to move).
// Up walks, down steps back, sideways turns, in proportion to how far the knob is pushed. Touching it stops the auto walk.
{
  const pad = document.getElementById('stick'), knob = pad && pad.querySelector('i');
  let sid = null;
  const set = (e) => {
    const b = pad.getBoundingClientRect(), r = b.width / 2;
    let dx = e ? e.clientX - (b.left + r) : 0, dy = e ? e.clientY - (b.top + r) : 0;
    const d = Math.hypot(dx, dy); if (d > r) { dx *= r / d; dy *= r / d; }
    knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    const dead = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    state.stick = { x: dead(dx / r), y: dead(dy / r) };
    pad.classList.toggle('on', !!e);
  };
  if (pad) {
    pad.addEventListener('pointerdown', (e) => { e.preventDefault(); sid = e.pointerId; pad.setPointerCapture(sid); state.auto = false; set(e); });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === sid) set(e); });
    const end = (e) => { if (e.pointerId === sid) { sid = null; set(null); } };
    pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  }
}
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  state.yawOffset += (e.clientX - drag.x) * 0.004;
  state.pitch = THREE.MathUtils.clamp(state.pitch - (e.clientY - drag.y) * 0.004, -1.2, 0.6);
  drag = { x: e.clientX, y: e.clientY };
});

// ---------- HUD ----------
let losAt = null, losShown = null;
const GROUND_NAMES = ['SOIL', 'BEDROCK', 'SAND', 'BIG ROCK'];
const $ = (id) => document.getElementById(id);
const el = {
  elapsed: $('elapsed'), left: $('left'), leftBar: $('leftBar'), ret: $('ret'), margin: $('margin'),
  nextName: $('nextName'), nextDist: $('nextDist'), slope: $('slope'), off: $('off'),
  backArrow: $('backArrow'), timeBlock: $('timeBlock'), o2: $('o2'), o2Bar: $('o2Bar'), effort: $('effort'), effortRow: $('effortRow'), doseRow: $('doseRow'), doseRate: $('doseRate'), doseSrc: $('doseSrc'), agent: $('agent'), agentText: $('agentText'), agentRule: $('agentRule'),
  labels: $('labels'), tape: $('tape'), navBlock: $('navBlock'), los: $('los'), losRow: $('losRow'), ground: $('ground'), groundRow: $('groundRow'), offRow: $('offRow'), gauge: $('gauge'), keyRoute: $('keyRoute'), keyKeep: $('keyKeep'), keys: $('keys'), mmReach: document.querySelector('.mm-reach'), photoRow: $('photoRow'), nextThumb: $('nextThumb'), photoKey: $('photoKey'), agentFig: $('agentFig'), gArc2: $('gArc2'), ev2Tag: $('ev2Tag'), gArc: $('gArc'), gO2: $('gO2'), gTime: $('gTime'), gSub: $('gSub'),
};
// Corner map. ?map=0..4 picks the zoom step, ?map=off hides it, ?mapopen=0..3 opens it at
// that step, ?layer=geology shows the geologic map.
const minimap = new Minimap($('minimap'), params.get('map') === null || params.get('map') === 'off' ? 1 : Number(params.get('map')));
if (params.get('map') === 'off') minimap.hide();
if (params.get('mapopen') !== null) { minimap.zoomOpen = Number(params.get('mapopen')); minimap.toggleOpen(); }
if (params.get('layer') === 'geology') minimap.toggleLayer();
minimap.radius = minimap.goal();   // start at the asked scale, without the zoom animation
minimap.off = { x: SITE.x, z: SITE.z };
// M and a click on the corner map open the world map (world.js). ?mapopen still shows the earlier
// opened circle, for the capture views.
const world = setupWorld({ state, minimap });
minimap.toggleOpen = () => world.toggle();
const hm = (sec) => {
  const neg = sec < 0; sec = Math.abs(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${neg ? '-' : ''}${h}:${String(m).padStart(2, '0')}`;
};
const hms = (sec) => `${hm(sec)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
// A duration with its units, so 0:05 cannot be read as five hours. Whole minutes, rounded down.
const durParts = (sec) => {
  const neg = sec < 0; sec = Math.abs(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return { sign: neg ? '−' : '', h, m };
};
// A list in plain English: "A", "A and B", "A, B and C".
const list = (a) => (a.length < 3 ? a.join(' and ') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const dur = (sec) => { const { sign, h, m } = durParts(sec); return h ? `${sign}${h} h ${m} min` : `${sign}${m} min`; };
const durHtml = (sec) => {
  const { sign, h, m } = durParts(sec);
  const u = (t) => `<span class="unit">${t}</span>`;
  return h ? `${sign}${h}${u(' h')} ${m}${u(' min')}` : `${sign}${m}${u(' min')}`;
};

// Station photos: what Curiosity's Mastcam saw at each stop (tools/station_photos.py).
let stationInfo = {};
// Only at the main place: the stops of the other places are imagined and have no photo.
// What Curiosity's APXS and ChemCam measured at each stop (tools/build_station_chemistry.py).
let stationChem = {};
const stationsReady = !SITE.main ? Promise.resolve() : Promise.all([
  fetch(`${import.meta.env.BASE_URL}data/stations.json`).then((r) => r.json()).then((j) => {
    for (const st of j.stations) stationInfo[st.id] = st;
  }).catch(() => {}),
  fetch(`${import.meta.env.BASE_URL}data/station_chemistry.json`).then((r) => r.json()).then((j) => {
    for (const st of j.stations) stationChem[st.id] = { columns: j.columns, sols: st.sols, apxs: st.apxs, chemcam: st.chemcam };
  }).catch(() => {}),
]);
// The calibrated Mastcam image Curiosity took at each station: a small picture under NEXT all the
// time, and a large one in the agent card within ARRIVE_M of the station.
const ARRIVE_M = 60;
let arrival = null;
function showCard(name, dist, back) {
  const info = stationInfo[name], pl = PLACES.find((q) => q.name === name);
  el.photoRow.hidden = !info || !info.photo || back;
  arrival = info && info.photo && !back && dist < ARRIVE_M ? { name, dist, info, pl } : null;
  if (!info || !info.photo || el.nextThumb.dataset.name === name) return;
  el.nextThumb.dataset.name = name;
  // A picture that fails to load hides its row instead of showing a broken image.
  el.nextThumb.onerror = () => { el.photoRow.style.display = 'none'; };
  el.nextThumb.onload = () => { el.photoRow.style.display = ''; };
  el.nextThumb.src = `${import.meta.env.BASE_URL}${info.photo}`;
  el.photoKey.innerHTML = `CURIOSITY · SOL ${info.sol}<em>${pl && pl.task ? pl.task : ''}</em>`;
}

let stationLabels = [];
function setLabels() {
  el.labels.replaceChildren();
  stationLabels = route.stations.map((st) => {
    const d = document.createElement('div');
    d.className = 'stn';
    el.labels.appendChild(d);
    return { st, d };
  });
}
setLabels();

// ---------- Plan on site ----------
// Which of the stations ahead still fit in the time left. The rule follows the NASA JSC Joint AR
// Concept of Operations (2023): a display should give "suggestions to reduce time or drop
// subsequent stations as to not exceed overall EVA duration constraints" (digest section 2).
// The choice here: keep as many stations as fit with a return confidence of at least GO_AT, in
// the planned order. Among equal counts keep the earlier ones. This tie rule is ours.
const legSec = (fromX, fromZ, toName) => toward.get(toName).time[cellOf(fromX, fromZ)];
const legG = (fromX, fromZ, toName) => toward.get(toName).o2[cellOf(fromX, fromZ)];
// Stations whose planned work was done on this walk (visit.js): the plan no longer counts their minutes.
const worked = new Set();
const workOf = (pl) => (worked.has(pl.name) ? 0 : pl.workMin);
function stationsAhead() {
  return route.places.slice(1, -1).filter((pl) => {
    const st = route.stations.find((q) => q.name === pl.name);
    return st && st.s > state.s + 2;
  });
}
// Time and oxygen of a plan: the legs and the work at each station kept, then the way home.
function planCost(keep, x = state.pos.x, z = state.pos.z) {
  let t = 0, g = 0;
  for (const pl of keep) { t += legSec(x, z, pl.name) + workOf(pl) * 60; g += legG(x, z, pl.name) + workOf(pl) * STATION_GPM; x = pl.x; z = pl.z; }
  return Object.assign(t + legSec(x, z, 'HAB'), { g: g + legG(x, z, 'HAB') });
}
function bestPlan() {
  const ahead = stationsAhead();
  const budget = ASSUME.evaLimitH * 3600 - state.elapsedSec - ASSUME.reserveMin * 60;
  const budgetG = o2BudgetG();
  let best = null;
  for (let mask = (1 << ahead.length) - 1; mask >= 0; mask--) {
    const keep = ahead.filter((_, i) => mask & (1 << i));
    const cost = planCost(keep);
    // A plan must fit both the time and the oxygen, and its return confidence must reach GO_AT
    // (team decision of 2026-11-14). Going straight home is always allowed: if even that is below
    // GO_AT, the plan is to go home and the gauge shows CAUTION.
    if (cost > budget || cost.g > budgetG) continue;
    if (keep.length && planConfidence(keep).p < GO_AT) continue;
    // More stations first. Then the earlier ones: a smaller sum of positions.
    const rank = keep.length * 100 - ahead.reduce((a, _, i) => a + (mask & (1 << i) ? i : 0), 0);
    if (!best || rank > best.rank) best = { keep, cost, rank };
  }
  const full = planCost(ahead);
  return { ahead, budget, budgetG, full, keep: best ? best.keep : [], cost: best ? best.cost : planCost([]), fits: !!best };
}
// Off route (issues 46 and 47, owner's feedback of 2026-11-14 17:00).
//  - Past OFF_WARN_M from the line, the route is planned once from where the astronaut stands
//    (the same station rule as when late) and drawn as white dashes from here to the first place
//    it keeps. The agent shows both choices with their return confidence: Enter takes the new
//    route, Esc keeps the old one and the walk back to the line (team decision: ask the astronaut).
//  - The plan is made again only after the astronaut is OFF_SNOOZE_M further off, so it does not
//    change at every step. If the old route no longer fits, the suggestion shows from OFF_MIN_M.
//  - The OFF ROUTE row shows the distance and what walking back costs as a share of the margin.
// The three distances are our settings, not taken from a source. Below OFF_MIN_M the 2 m grid
// cannot tell a detour from the drawn line.
const OFF_MIN_M = 4, OFF_WARN_M = 10, OFF_SNOOZE_M = 10;
let offInfo = null, offPlan = null, offSnoozeAt = null;
const previews = new Map();
function previewTo(name) {
  if (!previews.has(name)) {
    const l = new ReturnLine(toward.get(name));
    l.mesh.material = l.mesh.material.clone(); l.mesh.material.color.set('#eaf7ff');
    scene.add(l.mesh); previews.set(name, l);
  }
  return previews.get(name);
}
function hidePreviews(except) { for (const [k, l] of previews) if (k !== except) l.update(0, 0, false); }
function updateOff(n, back) {
  offInfo = null;
  if (state.offset < OFF_MIN_M) { offSnoozeAt = null; offPlan = null; }
  if (state.auto || back || !fromField || state.offset < OFF_MIN_M) { hidePreviews(); return; }
  const rp = route.at(state.s).p, rc = cellOf(rp.x, rp.z);
  const detourG = fromField.o2[rc], detourT = fromField.time[rc];
  const marginG = Math.max(1, n.marginGe);
  const ahead = stationsAhead();
  const old = planCost(ahead, rp.x, rp.z);
  const oldFits = detourT + old <= budgets().t && detourG + old.g <= o2BudgetG();
  const snoozed = offSnoozeAt !== null && state.offset < offSnoozeAt + OFF_SNOOZE_M;
  const due = !snoozed && (state.offset > OFF_WARN_M || !oldFits);
  // Plan once when the suggestion becomes due, and again only OFF_SNOOZE_M further off.
  if (due && (!offPlan || state.offset > offPlan.at + OFF_SNOOZE_M)) {
    const p = bestPlan();
    offPlan = { at: state.offset, keep: p.keep, gone: p.ahead.filter((pl) => !p.keep.includes(pl)).map((pl) => pl.name) };
  }
  const suggest = due && offPlan ? {
    oldFits, keep: offPlan.keep.map((pl) => pl.name), gone: offPlan.gone,
    confOld: planConfidence(ahead, rp.x, rp.z, detourT, detourG).p, confNew: planConfidence(offPlan.keep).p,
  } : null;
  const first = suggest ? (offPlan.keep[0] ? offPlan.keep[0].name : 'HAB') : null;
  hidePreviews(first);
  if (first) previewTo(first).update(state.pos.x, state.pos.z, true);
  offInfo = { detourG, share: detourG / marginG, warn: !!suggest || state.offset > OFF_WARN_M, suggest, preview: first ? previewTo(first).pts : null };
}
let dropped = [], planNote = null, lastPlanCheck = -1, replans = 0;

// Return confidence of the plan in force (confidence.js), worked out once a second.
const BAND_GPM = vo2ToGPerMin(BAND);
let conf = null;
// keep: stations still to visit, from (x, z). preT, preG: a walk before that (the way back to
// the line when off route), in seconds and banded grams.
function planConfidence(keep, x = state.pos.x, z = state.pos.z, preT = 0, preG = 0) {
  const walkSec = preT ? [preT] : [], workSec = [];
  let g = preT ? preG - BAND_GPM * preT / 60 : 0;
  const leg = (name) => { const t = legSec(x, z, name); walkSec.push(t); g += legG(x, z, name) - BAND_GPM * t / 60; };
  for (const pl of keep) { leg(pl.name); workSec.push(workOf(pl) * 60); g += workOf(pl) * STATION_GPM; x = pl.x; z = pl.z; }
  leg('HAB');
  const b = budgets();
  return returnConfidence({ walkSec, workSec, o2G: g }, b.t, b.g);
}
function updateConfidence(back) {
  conf = planConfidence(back ? [] : stationsAhead());
  window.__conf = { p: conf.p, spareG: conf.spareG.map(Math.round), spareMin: conf.spareT.map((t) => Math.round(t / 60)) };
}
function checkPlan(offRoute = false) {
  const p = bestPlan();
  // Taking the off-route suggestion: use the plan that was shown, not a new one.
  if (offRoute && offPlan) { p.keep = offPlan.keep; p.cost = planCost(p.keep); }
  if (!offRoute && p.keep.length === p.ahead.length) return;
  const gone = p.ahead.filter((pl) => !p.keep.includes(pl));
  dropped = dropped.concat(gone.map((pl) => pl.name));
  replans += 1;
  planNote = { why: offRoute ? 'off' : 'late', off: Math.round(state.offset), gone: gone.map((pl) => pl.name), keep: p.keep.map((pl) => pl.name), full: p.full, budget: p.budget, budgetG: p.budgetG, cost: p.cost, at: state.elapsedSec, conf: planConfidence(p.keep).p };
  offPlan = null; hidePreviews();
  // New route from here through the stations that stay, then to the habitat.
  setRoute([{ x: state.pos.x, z: state.pos.z, name: 'HERE' }, ...p.keep, PLACES[PLACES.length - 1]]);
  setLabels();
  state.s = 0; state.offset = 0;
  agentShown = ''; agentTypedAt = performance.now();
}

// Reference used by the particle event rule. Löwe et al. 2025 (arXiv 2502.02469, a preprint):
// "an astronaut should not move more than 30 minutes away from a shelter".
const SHELTER_REF_MIN = 30;

// Once the replay meets the alarm rule, the alarm stays on until the person stops the replay
// with R. The measured rate dips below the threshold for a few minutes during the event; an
// all-clear in the middle of an event is not what a person walking to shelter should see.
// This latch is our rule, not one taken from a source.
const alarmOn = () => state.alarm !== null && radNow(state.elapsedSec, state.alarm).latched;
// Go home: the return limit is reached or the particle event alarm is on. The screen then shows
// only the way back: the amber line, the habitat and its distance. The planned route is hidden.
// Head home: no station is left in the plan and its return confidence is below GO_AT. The way
// home is then drawn the same way as for the turn-back (owner's feedback of 2026-11-14).
const headHome = () => !!conf && conf.p < GO_AT && stationsAhead().length === 0;
const goHome = (n) => n.margin <= 0 || alarmOn() || headHome();

function numbers() {
  const limit = ASSUME.evaLimitH * 3600;
  const left = Math.max(0, limit - state.elapsedSec);
  // Return time: the least-time path to the habitat over the real ground (planner.js).
  const c = cellOf(state.pos.x, state.pos.z);
  const ret = home.time[c], back = home.dist[c];
  // Whole minutes, on the safe side: time left rounded down, walk back rounded up. The margin is
  // made from the shown minutes, so the sum on the screen always adds up.
  const leftM = Math.floor(left / 60), retM = Math.ceil(ret / 60);
  const marginT = (leftM - retM - ASSUME.reserveMin) * 60;
  // Oxygen: what is left, minus the way home (least-oxygen path, with the safety band), minus the
  // reserve. Whole grams on the safe side. In minutes: at the flat walking rate.
  // Both crew members; the one with the smaller oxygen margin decides (crew.js). Each in their own grams.
  const crew = [1, ev2Now].map((r, k) => {
    const o2Left = Math.max(0, Math.floor(O2.totalG - (k ? state.o2Used2 : state.o2Used))), o2Ret = Math.ceil(r * home.o2[c]), o2Res = Math.ceil(r * O2.reserveG);
    return { who: k ? 'EV2' : 'EV1', r, o2Left, o2Ret, o2Res, marginG: o2Left - o2Ret - o2Res };
  });
  const lim = crew[1].marginG < crew[0].marginG ? crew[1] : crew[0];
  const { o2Left, o2Ret, o2Res, marginG } = lim;
  const marginO = Math.floor(marginG / (lim.r * WALK_GPM)) * 60;
  // The tighter of the two limits decides.
  const by = marginO < marginT ? 'O2' : 'TIME';
  return { limit, left: leftM * 60, back, ret: retM * 60, marginT, o2Left, o2Ret, o2Res, marginG, marginO, by, margin: Math.min(marginT, marginO),
    who: lim.who, marginGe: marginG / lim.r, o2Self: crew[0].o2Left, o2Ev2: crew[1].o2Left,
    // Emergency: someone's oxygen left is less than the walk home, before any reserve (team decision
    // of 2026-11-14, after the review panel: a partner who cannot reach HAB must not look like a
    // routine turn-back).
    short: crew.filter((m) => m.o2Left < m.o2Ret) };
}

// keys=0 hides the key help line, for film capture only (owner's choice of 2026-11-14).
if (params.get('keys') === '0') document.getElementById('help').hidden = true;
// classes=1 opens with the class colours on (key C).
let classLabels = params.get('classes') === '1';
if (classLabels) setClassLook('label');
let agentOpen = params.get('agent') === '1', agentShown = '', agentFull = '', agentTypedAt = 0;
// Which way the way home starts, seen from where the person looks.
function homeSide() {
  const aim = returnLine.pointAhead(12);
  if (!aim) return '';
  const b = Math.atan2(aim.x - state.pos.x, -(aim.z - state.pos.z));
  let d = b - (state.heading + state.yawOffset);
  d = Math.atan2(Math.sin(d), Math.cos(d)) * 180 / Math.PI;
  if (Math.abs(d) > 120) return 'behind you';
  if (Math.abs(d) > 45) return `to your ${d > 0 ? 'right' : 'left'}`;
  return '';
}
// Off route enough to warn: walking by hand, not on the way home.
const offWarn = () => !!(offInfo && offInfo.warn);
function agentMessage() {
  const n = numbers();
  if (n.short.length) {
    const who = n.short.map((m) => m.who).join(' and '), m0 = n.short[0];
    return {
      id: 'short', rule: 'RULE · O₂ LEFT BELOW THE WALK HOME', warn: true, alert: true,
      head: `EMERGENCY. ${who} ${n.short.length > 1 ? 'run' : 'runs'} out of O₂ before HAB.`,
      body: `${n.short.map((m) => `${m.who} is ${m.o2Ret - m.o2Left} g short of the walk home.`).join(' ')}\nStart the suit's backup O₂ procedure and tell the HAB. Follow the amber line (${dur(n.ret)}).${homeSide() ? ` It starts ${homeSide()}.` : ''}`,
      note: `Modelled oxygen, not a suit reading. The walk back is the least-oxygen path with a +1 SD band. The backup procedure is not modelled.${m0.who === 'EV2' ? ' EV2 uses a fixed multiple of EV1\'s oxygen.' : ''}`,
    };
  }
  if (ev2Raised !== null && performance.now() - ev2Raised < 25000) {
    return {
      id: 'pair', rule: 'RULE · PAIR · FIRST TO RUN OUT DECIDES', warn: true,
      head: `EV2 is using ${Math.round((ev2Now - 1) * 100)} % more oxygen than EV1.`,
      body: `The plan now uses EV2's oxygen: margin ${dur(n.margin)}, ${n.who} decides.\nThe same gap as the two crew members of Apollo 16 EVA 1.`,
      note: 'Apollo 15 to 17: Miller et al. 2017 (S38). The gap is a fixed multiple, not a second metabolic model.',
    };
  }
  if (alarmOn()) {
    const min = n.ret / 60;
    const inside = min <= SHELTER_REF_MIN;
    const r = radNow(state.elapsedSec, state.alarm);
    // The agent reads out the dose rate the panel shows (radLive), not a second number.
    const x = radLive / r.quiet;
    return {
      id: 'alarm', rule: 'RULE · DOSE RATE 25 % ABOVE BACKGROUND',
      warn: true,
      head: 'Particle event. Go to HAB on the amber line.',
      body: `HAB ${dur(n.ret)} · ${(n.back / 1000).toFixed(2)} km${homeSide() ? ` · starts ${homeSide()}` : ''} · ${inside ? 'within' : 'beyond'} ${SHELTER_REF_MIN} min of shelter\nDose rate ${fmtRate(radLive)} µGy/h · ${x.toFixed(x < 10 ? 1 : 0)}× before the event`,
      note: `Replay: Curiosity RAD, ${r.utc} UTC, in the instrument, not in a suit. Rule: Löwe et al. 2025, preprint. R ends the replay.`,
    };
  }
  if (offWarn()) {
    const m = Math.round(state.offset), sg = offInfo.suggest, back = Math.ceil(offInfo.detourG);
    const note = `New plan once past ${OFF_WARN_M} m, again every ${OFF_SNOOZE_M} m further. Our settings. Finish plan: chance to do the stations and reach HAB above the reserve, from 1,000 runs on Apollo EVA data.`;
    if (sg) {
      const to = `${[...sg.keep, 'HAB'].join(' → ')}${sg.gone.length ? `, drops ${list(sg.gone)}` : ''}`;
      const pc = (v) => `${Math.round(v * 100)} %`;
      return {
        id: 'off-decide', rule: 'RULE · OFF ROUTE · YOU DECIDE', warn: true,
        head: sg.oldFits ? `Off route ${m} m. New route from here: white dashes.` : `Off route ${m} m. The old route no longer fits.`,
        body: `Enter: new route ${to}. Finish plan ${pc(sg.confNew)}.\nEsc: back to the cyan line (${back} g O₂), old route. Finish plan ${pc(sg.confOld)}.`,
        note,
      };
    }
    return {
      id: 'off', rule: 'RULE · OFF ROUTE', warn: true,
      head: `Off route ${m} m.`,
      body: `Walk back to the cyan line (${back} g O₂, ${Math.round(offInfo.share * 100)} % of the margin).`,
      note,
    };
  }

  if (planNote && n.margin > 0) {
    const next = planNote.keep.length ? `New route: ${planNote.keep.join(' → ')} → HAB` : 'New route: HAB';
    const gone = planNote.gone.length ? ` ${list(planNote.gone)} dropped.` : '';
    return {
      id: `plan-${planNote.at}`, rule: planNote.why === 'off' ? 'RULE · NEW PLAN WHEN OFF ROUTE' : planNote.why === 'crew' ? 'CREW CHOICE · GO HOME' : 'RULE · DROP STATIONS WHEN LATE', warn: true,
      head: planNote.why === 'off' ? `New route taken.${gone}` : planNote.why === 'crew' ? `Your call: going home.${planNote.gone.length ? ` ${list(planNote.gone)} skipped.` : ''}` : `Running late.${gone}`,
      body: `${next} · finish plan ${Math.round(planNote.conf * 100)} %`,
      note: `Assumed: ${PLACES[1].workMin} min per station, ${ASSUME.reserveMin} min reserve. Oxygen: suited test data at 3/8 g (NASA 2009), slope term from Minetti 2002.`,
    };
  }
  if (arrival && n.margin > 0) {
    const { info, pl, dist } = arrival;
    return {
      id: `arrive-${pl.name}`, rule: `${pl.name} · ${Math.round(dist)} m`, warn: false,
      head: `${pl.name}: ${pl.task}.`,
      body: `Curiosity stood here on sol ${info.sol} and imaged ${info.target.replace(/_/g, ' ')}.\nWork planned: ${pl.workMin} min. ${dur(n.margin)} to spare.`,
      note: 'Mastcam M-100, calibrated. NASA/JPL-Caltech/MSSS.',
      img: `${import.meta.env.BASE_URL}${info.photo}`,
    };
  }
  if (headHome() && n.margin > 0) {
    return {
      id: 'head-home', rule: 'RULE · FINISH PLAN BELOW 90 %', warn: true,
      head: `Head home now. Finish plan ${Math.round(conf.p * 100)} %.`,
      body: `Follow the amber line to HAB (${dur(n.ret)}).`,
      note: `GO at ${GO_AT * 100} % or more is our setting. The turn-back rule (margin at zero) still applies.`,
    };
  }
  const go = n.margin > 0;
  return {
    id: go ? 'limit-go' : 'limit-back', rule: 'RULE · RETURN LIMIT', warn: !go,
    head: go ? `Continue. ${dur(n.margin)} to spare (${n.by === 'O2' ? `oxygen, ${n.who}` : 'time'}).` : 'Turn back. Follow the amber line to HAB.',
    // One action line and one number. The sums behind the margin are in docs/methods.md ("Margin"),
    // owner's choice of 2026-11-14 after the review panel.
    body: go ? '' : `HAB ${dur(n.ret)} away.${homeSide() ? ` The line starts ${homeSide()}.` : ''}`,
    note: `Assumed: ${ASSUME.evaLimitH} h limit, ${ASSUME.walkKmh} km/h on flat ground, slower on slopes (Tobler 1993). O₂ sized for ${ASSUME.evaLimitH} h at the Apollo mean rate. Suit data: one prototype suit at 3/8 g (NASA 2009). Simulated clock.`,
  };
}
// G and the cross of the box. A box that is on screen closes, whether the walker opened it or a
// rule did, and stays closed until another message takes its place (owner, 2026-11-15: the box
// must not stay on the screen). A closed box opens.
let radLive = 0;
if (params.get('flicker') === '0') FLICKER.on = false;
if (/^\d+$/.test(params.get('seed') || '')) FLICKER.seed = Number(params.get('seed'));
let agentVisible = false, agentDismissed = null, agentNowId = null;
function closeAgent() { agentOpen = false; agentDismissed = agentNowId; }
function toggleAgent() { if (agentVisible) closeAgent(); else { agentOpen = true; agentDismissed = null; } agentShown = ''; agentTypedAt = performance.now(); }
document.getElementById('agentClose').addEventListener('click', () => { closeAgent(); document.activeElement && document.activeElement.blur && document.activeElement.blur(); });

function drawTape(headingDeg, bearingDeg, markColor) {
  const cv = el.tape, dpr = Math.min(devicePixelRatio, 2);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const span = 90, pxPerDeg = w / span;
  ctx.strokeStyle = 'rgba(127,233,255,0.9)'; ctx.fillStyle = '#eafcff';
  ctx.lineWidth = 1; ctx.textAlign = 'center'; ctx.font = '500 11px "Chakra Petch", sans-serif';
  ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
  const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  const start = Math.floor((headingDeg - span / 2) / 5) * 5;
  for (let d = start; d <= headingDeg + span / 2; d += 5) {
    const x = w / 2 + (d - headingDeg) * pxPerDeg;
    const norm = ((d % 360) + 360) % 360;
    const major = norm % 15 === 0;
    ctx.globalAlpha = 1 - Math.min(1, Math.abs(d - headingDeg) / (span / 2)) ** 3;
    ctx.beginPath(); ctx.moveTo(x, 24); ctx.lineTo(x, major ? 34 : 29); ctx.stroke();
    if (major) ctx.fillText(names[norm] ?? String(norm).padStart(3, '0'), x, 18);
  }
  ctx.globalAlpha = 1;
  // Centre mark.
  ctx.beginPath(); ctx.moveTo(w / 2 - 5, 44); ctx.lineTo(w / 2, 37); ctx.lineTo(w / 2 + 5, 44); ctx.stroke();
  // Bearing to the next station, or along the way back.
  let diff = ((bearingDeg - headingDeg + 540) % 360) - 180;
  const clamped = THREE.MathUtils.clamp(diff, -span / 2 + 2, span / 2 - 2);
  const bx = w / 2 + clamped * pxPerDeg;
  ctx.fillStyle = markColor;
  ctx.beginPath(); ctx.moveTo(bx, 36); ctx.lineTo(bx - 5, 28); ctx.lineTo(bx + 5, 28); ctx.closePath(); ctx.fill();
}

const v = new THREE.Vector3();
function updateHud(now, dt) {
  const n = numbers();
  el.elapsed.textContent = hms(state.elapsedSec);
  el.left.innerHTML = durHtml(n.left);
  el.leftBar.style.width = `${Math.max(0, Math.min(100, 100 * n.left / n.limit))}%`;
  el.ret.innerHTML = `${durHtml(n.ret)}<span class="km"> · ${(n.back / 1000).toFixed(2)} km</span>`;
  el.margin.innerHTML = `${durHtml(n.margin)}<span class="km"> · ${n.by === 'O2' ? `O2 ${n.who}` : n.by}</span>`;
  const o2Pct = Math.max(0, Math.round(100 * n.o2Self / O2.totalG)), ev2Pct = Math.max(0, Math.round(100 * n.o2Ev2 / O2.totalG));
  el.o2.innerHTML = `${o2Pct}<span class="unit"> %</span><span class="km"> · ${n.o2Self} g</span>`;
  el.o2Bar.style.width = `${Math.max(0, Math.min(100, 100 * n.o2Self / O2.totalG))}%`;
  // Shown only when the effort is up (owner, 2026-11-14). No heart rate: the suit in this
  // simulation has no heart sensor, and a number on screen reads as measured.
  el.effort.innerHTML = `${Math.round(vo2ToWatts(state.vo2) / 10) * 10}<span class="unit"> W</span><span class="km"> · ${state.vo2.toFixed(0)} ml/kg/min</span>`;
  el.effortRow.classList.toggle('warn', state.vo2 > SUSTAIN.high);
  // Shown above the low end of the sustained band (12.6 ml/kg/min): walking uphill or on sand.
  // Hidden while standing. Amber above the high end (18).
  el.effortRow.hidden = !(state.vo2 > SUSTAIN.low) && params.get('effort') !== '1';
  const alarm = alarmOn(), back = goHome(n);
  el.timeBlock.classList.toggle('warn', n.margin <= 0);
  el.doseRow.classList.toggle('warn', alarm);
  const rad = radNow(state.elapsedSec, state.alarm);
  // The number moves around the reading between two readings (rad.js, radFlicker: simulated, the line under it says so).
  // `now` is the frame time, the same one game.js uses for the other places that show the dose rate.
  radLive = radShownAt(rad.rate, now);
  el.doseRate.innerHTML = `${fmtRate(radLive)}<span class="unit"> µGy/h</span><span class="km"> · ${rad.total.toFixed(0)} µGy</span>`;
  // With the flicker on, a line under the row gives the reading itself and says that the movement is simulated.
  el.doseSrc.textContent = FLICKER.on ? `RAD READING ${fmtRate(rad.rate)} · FLICKER SIMULATED` : `${rad.label} · IN INSTRUMENT`;
  el.doseSrc.classList.toggle('sim', FLICKER.on);

  // The way back is traced before the panel reads from it.
  returnLine.update(state.pos.x, state.pos.z, back);
  const view = state.heading + state.yawOffset;
  { const sl = Math.round(slopeDegAt(state.pos.x, state.pos.z, state.heading)); el.slope.textContent = `${sl < 0 ? '−' : ''}${Math.abs(sl)}°`; }
  el.off.textContent = back ? '--' : `${Math.round(state.offset)} m`;
  el.offRow.classList.toggle('warn', offWarn());
  if (!back && offInfo) el.off.innerHTML = `${Math.round(state.offset)} m<span class="km"> · ${Math.round(offInfo.share * 100)} % OF MARGIN</span>`;
  const decide = !!(offInfo && offInfo.suggest);
  el.keyRoute.hidden = el.keyKeep.hidden = !decide;
  el.keys.classList.toggle('decide', decide);
  // Ground class under the boots from the terrain model, and the ground factor it gives.
  // Shown only on ground the model has classified (around HAB and STN A), hidden elsewhere.
  const gk = classAt(state.pos.x, state.pos.z);
  el.groundRow.hidden = gk < 0;
  el.ground.innerHTML = gk < 0 ? '--' : `${GROUND_NAMES[gk]}<span class="km"> · WALK COST ×${ETA_BY_CLASS[gk].toFixed(1)}</span>`;
  el.groundRow.classList.toggle('warn', gk === 2);
  // Line of sight to the habitat over the terrain, worked out again after 0.5 m of movement.
  if (!losAt || Math.hypot(state.pos.x - losAt.x, state.pos.z - losAt.z) > 0.5) {
    losAt = { x: state.pos.x, z: state.pos.z, r: lineOfSight(heightAt, state.pos.x, state.pos.z, PLACES[0].x, PLACES[0].z) };
  }
  const los = losAt.r;
  losShown = stateWithHold(losShown, los.clearance);
  el.los.innerHTML = los.len < 3 ? 'AT HAB' : `${losShown}<span class="km"> · ${los.clearance >= 0 ? '+' : ''}${los.clearance.toFixed(1)} m</span>`;
  el.losRow.classList.toggle('warn', los.len >= 3 && losShown === 'BLOCKED');
  el.navBlock.classList.toggle('warn', back);
  let target, targetName, targetDist;
  if (back) {
    // Going home: the panel and the heading mark follow the amber line, not the planned route.
    targetName = 'HAB'; targetDist = n.back;
    target = returnLine.pointAhead(12) || PLACES[0];
  } else {
    // The row MAX AT STATION (time at the next station if every later station is skipped) was removed
    // on 2026-11-15: beside the gauge's time to spare it read as a second answer to one question (owner).
    const next = route.nextStation(state.s);
    targetName = next.name; targetDist = Math.max(0, next.s - state.s); target = next.p;
  }
  showCard(targetName, targetDist, back);
  el.nextName.textContent = targetName;
  el.nextName.toggleAttribute('data-imagined', !SITE.main && targetName !== 'HAB');
  el.nextDist.textContent = `${targetDist.toFixed(0)} m`;
  const bearing = Math.atan2(target.x - state.pos.x, -(target.z - state.pos.z)) * 180 / Math.PI;
  drawTape(view * 180 / Math.PI, bearing, back ? '#ffb347' : '#7fe9ff');

  // The planned route, its footstep cues and the station markers are hidden on the way home.
  routeLine.visible = !back; steps.group.visible = !back;
  // No beacon while a choice card is open: its beam crossed the card.
  for (const o of beacons.children) o.visible = !document.body.classList.contains('choosing') && (!back || o.userData.station === 'HAB');
  // One label: the place the panel names, with the same distance as the panel.
  const labelName = targetName;
  let labelled = false;
  for (const { st, d } of stationLabels) {
    let visible = false;
    if (st.name === labelName && !labelled && (back || st.s > state.s + 2) && !minimap.open) {
      v.copy(st.p); v.y += 9.3;
      const range = v.distanceTo(camera.position);
      v.project(camera);
      const sx = v.x * 0.5 + 0.5, sy = -v.y * 0.5 + 0.5;
      // Keep labels out of the two side blocks, the heading tape and the corner map.
      const inBlocks = ((sx < 0.31 || sx > 0.69) && sy > 0.2 && sy < 0.62) || inRect(sx * innerWidth, sy * innerHeight, mapRect);
      visible = v.z < 1 && sx > 0.04 && sx < 0.96 && sy > 0.13 && sy < 0.9 && range > 6 && !inBlocks;
      if (visible) {
        labelled = true;
        d.style.left = `${sx * innerWidth}px`;
        d.style.top = `${sy * innerHeight}px`;
        d.innerHTML = `<b>${st.name}</b>${targetDist.toFixed(0)} m`;
      }
    }
    d.style.display = visible ? '' : 'none';
    d.classList.toggle('warn', back);
  }

  // Off the route by hand: an arrow over the view that shows where to walk back to the planned
  // line, as a waypoint mark in a game does (owner, 2026-11-15). The target is the point of the
  // route 4 m ahead of the nearest one. In view: the arrow floats over that point. Out of view: it
  // sits on a ring around the middle of the screen, on the side to turn to. Not shown on the auto
  // walk, on the way home, or while a card holds the walk.
  {
    const show = !back && !state.auto && !state.frozen && state.offset >= OFF_MIN_M && !document.body.classList.contains('choosing');
    el.backArrow.hidden = !show;
    if (show) {
      const tp = route.at(Math.min(route.length, state.s + 4)).p, dist = Math.hypot(tp.x - state.pos.x, tp.z - state.pos.z);
      v.set(tp.x, heightAt(tp.x, tp.z) + 1.5, tp.z).project(camera);
      const inView = v.z < 1 && Math.abs(v.x) < 0.8 && Math.abs(v.y) < 0.7;
      let sx, sy, rot;
      if (inView) { sx = (v.x + 1) / 2 * innerWidth; sy = (1 - v.y) / 2 * innerHeight; rot = 180; }
      else {
        let d = Math.atan2(tp.x - state.pos.x, -(tp.z - state.pos.z)) - view;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const R = Math.min(innerHeight * 0.26, innerWidth * 0.3);
        sx = innerWidth / 2 + Math.sin(d) * R; sy = innerHeight * 0.46 - Math.cos(d) * R; rot = d * 180 / Math.PI;
      }
      el.backArrow.style.left = `${sx.toFixed(1)}px`; el.backArrow.style.top = `${sy.toFixed(1)}px`;
      el.backArrow.style.setProperty('--rot', `${rot.toFixed(1)}deg`);
      el.backArrow.classList.toggle('at', inView);
      el.backArrow.lastElementChild.textContent = `ROUTE ${Math.round(dist)} m`;
    }
    window.__backArrow = show ? { x: Math.round(parseFloat(el.backArrow.style.left)), y: Math.round(parseFloat(el.backArrow.style.top)), at: el.backArrow.classList.contains('at') } : null;
  }
  minimap.draw({
    pos: state.pos, view, fovDeg: 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect) * 180 / Math.PI, route, s: state.s, stations: route.stations,
    nextName: targetName, home: PLACES[0], returnPts: returnLine.pts, back, dt, reach: back ? null : reachSegs,
    mate: ev2.group.visible ? ev2.pos : null,
    reachMask: back || !reachSegs.length ? null : { mask: reachMaskNow, n: GRID_N, cell: CELL, half: TERRAIN_SIZE / 2 },
    preview: offInfo && offInfo.preview,
  });
  el.mmReach.hidden = back || !reachSegs.length;
  // EV2 tag over the figure: name, oxygen and, when apart, the distance.
  if (ev2.group.visible) {
    const hp = ev2.head().project(camera), apart = Math.hypot(ev2.pos.x - state.pos.x, ev2.pos.z - state.pos.z);
    const show = hp.z < 1 && Math.abs(hp.x) < 0.88 && Math.abs(hp.y) < 0.95;
    el.ev2Tag.style.display = show ? '' : 'none';
    if (show) {
      el.ev2Tag.style.left = `${(hp.x + 1) / 2 * innerWidth}px`; el.ev2Tag.style.top = `${(1 - hp.y) / 2 * innerHeight}px`;
      el.ev2Tag.innerHTML = `<b>EV2</b>O₂ ${ev2Pct} %${apart > 15 ? ` · ${Math.round(apart)} m` : ''}`;
      el.ev2Tag.classList.toggle('warn', n.who === 'EV2' && (back || (conf && conf.p < GO_AT)));
      // The station label and the EV2 tag must not lie on each other: the tag moves just above or below the label.
      const lab = stationLabels.find((q) => q.d.style.display !== 'none');
      if (lab) {
        const t = el.ev2Tag.getBoundingClientRect(), r = lab.d.getBoundingClientRect();
        if (t.left < r.right + 4 && r.left - 4 < t.right && t.top < r.bottom + 4 && r.top - 4 < t.bottom) {
          el.ev2Tag.style.top = `${(t.top + t.bottom < r.top + r.bottom ? r.top - 4 : r.bottom + 4 + t.height).toFixed(1)}px`;
        }
      }
      // Nor may it lie on the panels: on 2026-11-15 it covered the O₂ LEFT row of the left block (owner).
      // Beside a side panel the tag moves just outside its edge, toward the middle; over the gauge it moves above it.
      for (const id of ['timeBlock', 'navBlock', 'day', 'gauge']) {
        const b = document.getElementById(id);
        if (!b || !b.getClientRects().length || getComputedStyle(b).visibility === 'hidden' || Number(getComputedStyle(b).opacity) < 0.1) continue;
        const t = el.ev2Tag.getBoundingClientRect(), r = b.getBoundingClientRect();
        if (!(t.left < r.right + 6 && r.left - 6 < t.right && t.top < r.bottom + 6 && r.top - 6 < t.bottom)) continue;
        if (id === 'gauge') el.ev2Tag.style.top = `${(r.top - 6).toFixed(1)}px`;
        else if (r.left + r.right < innerWidth) el.ev2Tag.style.left = `${(r.right + 8 + t.width / 2).toFixed(1)}px`;
        else el.ev2Tag.style.left = `${(r.left - 8 - t.width / 2).toFixed(1)}px`;
      }
    }
    window.__ev2 = { x: +ev2.pos.x.toFixed(1), z: +ev2.pos.z.toFixed(1), apart: +apart.toFixed(1), o2Pct: ev2Pct, ratio: +ev2Now.toFixed(3), limits: n.who };
  }

  if (Math.floor(now / 1000) !== lastPlanCheck) { lastPlanCheck = Math.floor(now / 1000); if (state.alarm === null && n.margin > 0) if (state.auto || state.offset < OFF_MIN_M) checkPlan(); updateOff(n, back); updateConfidence(back); rebuildReach(); }
  askReach(now);
  reachLine.mesh.visible = !back;
  // Bottom gauge: oxygen in percent, and the return confidence with its level.
  const turn = n.margin <= 0 || alarmOn();
  // HEAD HOME whenever the plan holds no station any more (owner's choice of 2026-11-14 after the
  // review panel: GO read as "carry on with the science" when all stations had been dropped).
  // Amber when stations were dropped or the finish plan is below GO_AT; after a normal last
  // station it keeps the GO colour.
  const planHome = stationsAhead().length === 0;
  const level = n.short.length ? 'EMERGENCY' : turn ? 'TURN BACK' : planHome ? 'HEAD HOME' : conf && conf.p < GO_AT ? 'CAUTION' : 'GO';
  const calm = level === 'GO' || (level === 'HEAD HOME' && !headHome() && !(planNote && planNote.gone.length));
  el.gArc.setAttribute('stroke-dasharray', `${Math.min(100, Math.max(0, 100 * n.o2Self / O2.totalG)).toFixed(1)} 100`);
  el.gArc2.setAttribute('stroke-dasharray', `${Math.min(100, Math.max(0, ev2Pct)).toFixed(1)} 100`);
  // Decision first (owner, 2026-11-14 about 21:00, "1-5可以接受"): the big line is the level, the
  // second line the time it leaves. O₂ in percent moves to the small type under it.
  el.gO2.textContent = level;
  el.gauge.toggleAttribute('data-long', level.length > 7);
  el.gTime.textContent = level === 'EMERGENCY' || turn ? `HAB ${dur(n.ret)} away` : `${dur(n.margin)} to spare`;
  // Finish plan: the share of 1,000 runs that do the stations left and reach HAB above the reserve.
  // Under it, the oxygen above the reserve at HAB: median, and the range of 90 % of the runs.
  const sp = conf ? conf.spareG.map((g) => Math.round(g)) : null, sg = (g) => `${g >= 0 ? '+' : '−'}${Math.abs(g)}`;
  el.gSub.innerHTML = `O₂ ${o2Pct} % · ${n.o2Self} g · <span class="ev2">EV2 ${ev2Pct} %</span><br>FINISH PLAN ${conf ? Math.round(conf.p * 100) : '--'} %`
    + (sp ? `<br><span class="g-range">O₂ AT HAB ${sg(sp[1])} g · 90 % OF RUNS ${sg(sp[0])} TO ${sg(sp[2])}</span>` : '');
  el.gauge.dataset.level = level === 'EMERGENCY' ? 'emergency' : calm ? 'go' : turn ? 'back' : 'caution';
  window.__offRoute = { offset: +state.offset.toFixed(1), warn: offWarn(), share: offInfo && +offInfo.share.toFixed(3), suggest: offInfo && offInfo.suggest, replans, why: planNote && planNote.why, keep: planNote && planNote.keep };
  const auto = back || offWarn() || !!arrival || (ev2Raised !== null && performance.now() - ev2Raised < 25000) || (planNote && state.elapsedSec - planNote.at < 90);
  const msg = agentOpen || auto ? agentMessage() : null;
  agentNowId = msg && msg.id;
  agentVisible = !!msg && (agentOpen || msg.id !== agentDismissed);
  if (msg && !agentOpen && msg.id !== agentDismissed) agentDismissed = null;   // another message: the closed one may come back later
  if (agentVisible) {
    el.agent.hidden = false;
    el.agent.classList.toggle('warn', msg.warn);
    el.agent.classList.toggle('alert', !!msg.alert);
    el.agentRule.textContent = msg.rule;
    const full = [msg.head, msg.body, msg.note].join('\u0000');
    if (full !== agentFull) { agentFull = full; if (!agentShown) agentTypedAt = now; }
    // The head line shows at once. The rest types out.
    const chars = params.get('agent') === '1' ? agentFull.length : msg.head.length + Math.floor((now - agentTypedAt) / 14);
    agentShown = agentFull.slice(0, chars);
    const [h = '', bd = '', nt = ''] = agentShown.split('\u0000');
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    el.agentText.innerHTML = `<b>${esc(h)}</b>${esc(bd)}${nt ? `<small>${esc(nt)}</small>` : ''}`;
    el.agentFig.hidden = !msg.img;
    if (msg.img && el.agentFig.dataset.src !== msg.img) { el.agentFig.dataset.src = msg.img; el.agentFig.querySelector('img').src = msg.img; }
  } else {
    el.agent.hidden = true;
  }
}

// ---------- Loop ----------
let mapRect = null;
const inRect = (x, y, r) => r && x > r.left - 40 && x < r.right + 40 && y > r.top - 10 && y < r.bottom + 40;
function resize() {
  const m = $('minimap');
  mapRect = m && !m.hidden ? m.getBoundingClientRect() : null;
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  // Keep a wide enough view on a tall phone screen.
  camera.fov = camera.aspect < 1 ? 86 : 72;
  camera.updateProjectionMatrix();
  if (look) { const v = renderer.getDrawingBufferSize(new THREE.Vector2()); look.resize(v.x, v.y); }
}
addEventListener('resize', resize); resize();
// The corner map must not lie over the time panel. On a short screen (a laptop at 150 % scaling
// is about 700 px high) the panel reached into the map and its DOSE RATE row was covered (owner,
// 2026-11-15). When the two would meet, the panel moves up to just under the day panel and the
// map gets smaller, with its lower edge kept where it is. Room for the EFFORT row is kept even
// while that row is hidden, so the map does not change size during the walk.
function fitCornerMap() {
  const m = $('minimap'), b = el.timeBlock, d = $('day');
  b.style.top = ''; m.style.removeProperty('--mm'); m.style.top = '';
  if (innerWidth < 760 || m.classList.contains('open') || !b.offsetHeight) return;   // the phone layout has its own places; folded panels leave the map alone
  const floor = innerHeight * 0.86, size = Math.max(132, Math.min(188, innerWidth * 0.12));   // the style sheet's values for the map
  const need = b.offsetHeight + (el.effortRow.hidden ? 28 : 0) + 12;
  let top = b.getBoundingClientRect().top;
  if (top + need <= floor - size) { mapRect = m.getBoundingClientRect(); return; }
  const dayEnd = d && d.offsetHeight ? d.getBoundingClientRect().bottom + 14 : top;
  if (dayEnd < top) { top = dayEnd; b.style.top = `${Math.round(top)}px`; }
  const fit = Math.round(Math.max(84, Math.min(size, floor - top - need)));
  m.style.setProperty('--mm', `${fit}px`); m.style.top = `${Math.round(floor - fit)}px`;
  mapRect = { left: m.offsetLeft, right: m.offsetLeft + fit, top: floor - fit, bottom: floor + 30 };
}
addEventListener('resize', fitCornerMap);
new ResizeObserver(fitCornerMap).observe(el.timeBlock);

let last = performance.now();
state.offset = 0;
const CINE_UP_M = 240;
let cine = null, cine0Frozen = false;
function playCine({ dur = 5200, caption = '', onLand = null } = {}) {
  return new Promise((done) => {
    cine0Frozen = false; state.frozen = true; state.keys.clear();
    document.body.classList.add('cine');
    const c = $('cineCap'); c.innerHTML = caption; c.classList.remove('in'); void c.offsetWidth; c.classList.add('in');
    cine = { t0: performance.now(), dur, onLand, done };
  });
}
function frame(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
  // state.frozen: a station card is open (visit.js) or the descent plays, nothing moves and the clock stands.
  // state.speedK: a faster pace on screen. Nothing sets it now, so it is 1.
  const k = state.frozen ? new Set() : state.keys;
  const SPEED = DEMO_SPEED * (state.speedK || 1);
  let moved = 0;
  const px = state.pos.x, pz = state.pos.z;
  const homeward = state.auto && goHome(numbers());
  if (state.frozen) {
    // nothing
  } else if (homeward) {
    // Auto walk on the way home follows the amber line, not the planned route.
    const nxt = returnLine.pointAhead(SPEED * dt), aim = returnLine.pointAhead(4);
    if (nxt && Math.hypot(nxt.x - state.pos.x, nxt.z - state.pos.z) > 1e-3) {
      state.pos.x = nxt.x; state.pos.z = nxt.z;
      returnLine.update(state.pos.x, state.pos.z, true);
      moved = SPEED * dt;
    }
    if (aim && Math.hypot(aim.x - state.pos.x, aim.z - state.pos.z) > 0.5) {
      let dh = Math.atan2(aim.x - state.pos.x, -(aim.z - state.pos.z)) - state.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      state.heading += dh * Math.min(1, dt * 3);
    }
    const pr = route.project(state.pos.x, state.pos.z, state.s);
    state.s = pr.s; state.offset = pr.offset;
  } else if (state.auto) {
    const nextS = Math.min(route.length, state.s + SPEED * dt);
    moved = Math.max(0, nextS - state.s);
    state.s = nextS;
    const a = route.at(state.s);
    state.pos.copy(a.p);
    let dh = a.heading - state.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    state.heading += dh * Math.min(1, dt * 3);
  } else {
    // The phone's joystick (state.stick, -1 to 1 on each axis) adds to the keys: sideways turns, up walks.
    const st = state.stick || { x: 0, y: 0 };
    const turn = THREE.MathUtils.clamp((k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + st.x, -1, 1);
    state.heading += turn * 1.3 * dt;
    const fwd = THREE.MathUtils.clamp((k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - st.y, -1, 1);
    if (fwd) {
      const h = state.heading + state.yawOffset;
      const lim = TERRAIN_SIZE / 2 - 12;
      state.pos.x = THREE.MathUtils.clamp(state.pos.x + Math.sin(h) * fwd * SPEED * dt, -lim, lim);
      state.pos.z = THREE.MathUtils.clamp(state.pos.z - Math.cos(h) * fwd * SPEED * dt, -lim, lim);
      moved = SPEED * dt;
      state.heading = h; state.yawOffset = 0;
    }
    const pr = route.project(state.pos.x, state.pos.z, state.s);
    state.s = pr.s; state.offset = pr.offset;
  }
  if (state.auto && !homeward && !state.frozen) state.offset = 0;
  // The clock and oxygen use the distance actually moved on the ground. A route or a return line
  // starts at the centre of a 2 m cell, so after a new plan the first step can be longer than the
  // planned step. With the planned step, the slope came out many times too steep, the walking
  // speed near zero, and the clock jumped by hours (seen by the film session, 2026-11-14).
  if (moved > 0) moved = Math.max(1e-3, Math.hypot(state.pos.x - px, state.pos.z - pz));
  if (moved > 0) { evaStarted = true; state.walked = (state.walked || 0) + moved; }
  // Clock and oxygen start with the EVA. Walking: the time and oxygen the walking model gives for
  // the metres moved (the demo moves faster on screen than the planning speed). Standing: real
  // time, at the station work rate.
  if (moved > 0) {
    const h1 = heightAt(state.pos.x, state.pos.z), grade = (h1 - state.lastH) / moved;
    const v = FLAT_MPS * toblerFactor(grade), eta = etaAt(cellOf(state.pos.x, state.pos.z));
    state.elapsedSec += moved / v;
    useO2(edgeO2(moved, v, grade, eta, false, planOpts.loadKg));
    state.vo2 += (vo2Walk(v, grade, eta, planOpts.loadKg) - state.vo2) * Math.min(1, dt * 0.8);
  } else if (evaStarted && !state.frozen) {
    const ck = state.speedK ? state.speedK * DEMO_SPEED / FLAT_MPS : 1;   // standing counts as fast as walking does
    state.elapsedSec += dt * ck;
    useO2(STATION_GPM * dt * ck / 60);
    state.vo2 += (kjhToVo2(STATION_KJ_H) - state.vo2) * Math.min(1, dt * 0.8);
  }
  state.lastH = heightAt(state.pos.x, state.pos.z);
  state.bob += moved * 3.2;

  const targetPitch = state.lookDown ? -1.02 : 0;
  if (!drag) state.pitch += (targetPitch + (state.lookDown ? 0 : -0.06) - state.pitch) * Math.min(1, dt * 4);
  const y = heightAt(state.pos.x, state.pos.z) + EYE + Math.sin(state.bob) * 0.025;
  camera.position.set(state.pos.x, y, state.pos.z);
  camera.rotation.set(state.pitch, -(state.heading + state.yawOffset), 0);

  // Descent (cine): the view comes down from CINE_UP_M above the walker, turning, and lands on the
  // walker's eyes. IMAGINED: no lander is modelled. The ground it flies over is the measured one.
  if (cine) {
    // ?cinek=0.4 holds the descent at that share of its way, for a capture.
    const hold = parseFloat(params.get('cinek'));
    const k = hold >= 0 ? Math.min(0.89, hold) : Math.min(1, (now - cine.t0) / cine.dur), e = 1 - (1 - k) ** 3, up = 1 - e;
    camera.position.y += CINE_UP_M * up * up + 1.2 * up;
    camera.position.x -= Math.sin(state.heading) * 70 * up; camera.position.z += Math.cos(state.heading) * 70 * up;
    camera.rotation.set(state.pitch * e - 1.25 * up ** 0.7, -(state.heading + state.yawOffset) + 1.9 * up * up, 0.25 * up);
    if (k > 0.9 && !cine.thud) { cine.thud = true; cine.onLand && cine.onLand(); }
    if (cine.thud) { const sh = Math.max(0, 1 - (now - cine.t0 - cine.dur * 0.9) / 420) * 0.05; camera.position.y += (Math.random() - 0.5) * sh; camera.rotation.z += (Math.random() - 0.5) * sh * 0.4; }
    if (k >= 1) { const done = cine.done; cine = null; state.frozen = cine0Frozen; document.body.classList.remove('cine'); done && done(); }
  }
  sun.position.copy(camera.position).addScaledVector(sunDir, 150);
  sun.target.position.copy(camera.position);
  beacons.children.forEach((m) => { if (m.userData.billboard) m.rotation.y = camera.rotation.y; });
  // The route ribbon flows forward, and the station rings breathe, so the view is alive at rest.
  if (npcs) npcs.update(dt, now);
  routeLine.material.uniforms.uTime.value = now / 1000; routeLine.material.uniforms.uS.value = state.s;
  beacons.children.forEach((m, i) => { if (m.userData.pulse) { const k = 1 + 0.16 * (0.5 + 0.5 * Math.sin(now / 520 + i)); m.scale.set(k, 1, k); } });
  steps.update(state.s);
  // EV2 walks LEAD_M ahead on the plan (or on the amber line home) and SIDE_M to the left.
  {
    const homeLine = goHome(numbers());
    const a = homeLine ? null : route.at(state.s + LEAD_M);
    const pt = homeLine ? returnLine.pointAhead(LEAD_M) : a.p;
    if (pt) {
      const q = homeLine ? returnLine.pointAhead(LEAD_M + 2) : null;
      const h = !homeLine ? a.heading : q && Math.hypot(q.x - pt.x, q.z - pt.z) > 0.1 ? Math.atan2(q.x - pt.x, -(q.z - pt.z)) : ev2.heading;
      const fx = Math.sin(h), fz = -Math.cos(h);
      ev2.update({ x: pt.x - Math.cos(h) * SIDE_M, z: pt.z - Math.sin(h) * SIDE_M }, { x: fx, z: fz }, dt);
    }
  }

  // Capture aid: ?cam=ev2 looks at EV2 from 4 m in front of it.
  if (params.get('cam') === 'ev2' && ev2.group.visible) {
    const f = ev2.heading, hx = ev2.pos.x + Math.sin(f) * 4, hz = ev2.pos.z + Math.cos(f) * 4;
    camera.position.set(hx, heightAt(hx, hz) + 1.6, hz);
    camera.lookAt(ev2.pos.x, heightAt(ev2.pos.x, ev2.pos.z) + 1.0, ev2.pos.z);
  }
  if (look) look.render(dt); else renderer.render(scene, camera);
  updateHud(now, dt);
  requestAnimationFrame(frame);
}
// ---------- Game layer (game.js): training, scenarios, data layers, on-screen actions ----------
// Put the walk in a given state without a reload: metres along the planned route, hours elapsed,
// the partner's oxygen multiple, the particle event, the ground class colours.
function jumpTo({ s = 0, t = 0, ev2: ev2Arg = null, alarm = false, auto = false, classes = false, lookDown = false, back = false, work = null, o2h = null } = {}) {
  state.frozen = false; state.speedK = 0; worked.clear();
  window.dispatchEvent(new CustomEvent('mm-jump'));   // visit.js: a station card that is open closes, and every station can be met again
  // Planned minutes at each station: the route file's value, unless a caller gives another.
  for (const pl of PLACES) if (pl.workMin) { pl.workMin0 = pl.workMin0 || pl.workMin; pl.workMin = work || pl.workMin0; }
  setRoute(PLACES); setLabels();
  dropped = []; planNote = null; offInfo = null; offPlan = null; offSnoozeAt = null; conf = null; arrival = null; hidePreviews();
  state.s = Math.min(s, route.length); state.offset = 0;
  const a = route.at(state.s);
  state.pos.copy(a.p); state.heading = a.heading; state.yawOffset = back ? Math.PI : 0; state.pitch = 0;
  state.lastH = heightAt(a.p.x, a.p.z);
  state.elapsedSec = t * 3600;
  ev2Base = ev2Arg; ev2Now = ev2Ratio(ev2Arg); ev2Raised = null; agentDismissed = null;
  // o2h: hours of use at the Apollo mean rate that the oxygen starts from, when not the hours elapsed.
  state.o2Used = Math.min(O2.totalG, (o2h === null ? state.elapsedSec : o2h * 3600) / 60 * kjhToGPerMin(EVA_MEAN_KJ_H + LEAK_KJ_H));
  state.o2Used2 = Math.min(O2.totalG, state.o2Used * ev2Now);
  state.vo2 = kjhToVo2(STATION_KJ_H);
  state.alarm = alarm ? state.elapsedSec : null;
  state.auto = auto; state.lookDown = lookDown; state.walked = 0;
  evaStarted = s > 0 || t > 0 || alarm;
  classLabels = classes; setClassLook(classes ? 'label' : 'material');
  const lead = route.at(state.s + LEAD_M);
  ev2.pos.set(lead.p.x - Math.cos(lead.heading) * SIDE_M, 0, lead.p.z - Math.sin(lead.heading) * SIDE_M);
  reachAsk = null; lastPlanCheck = -1; losAt = null; agentShown = ''; agentTypedAt = performance.now();
}
const press = (code) => { dispatchEvent(new KeyboardEvent('keydown', { code })); dispatchEvent(new KeyboardEvent('keyup', { code })); };
// The same walk planned three ways, for the plan screen: the shortest path, the path of least
// oxygen with no other factor, and the plan in force. Every row has the same stations, the same
// load and the same oxygen model, so the rows differ only in where the path goes. Walking only:
// the work at the stations is the same in every row. What each path meets (planner.js pathFacts)
// is counted with the sun of the hour at which that leg starts.
let refPlans = null;
function comparePlans() {
  const pause = (k) => (PLACES[k + 1].workMin || 0) * 60, loadKg = planOpts.loadKg;
  if (!refPlans || refPlans.loadKg !== loadKg) refPlans = { loadKg,
    short: planTraverse(PLACES, ASSUME.walkKmh, { base: 'dist', loadKg }, { pause }),
    least: planTraverse(PLACES, ASSUME.walkKmh, { base: 'o2', loadKg }, { pause }) };
  const row = (id, plan) => {
    const f = { m: 0, steepM: 0, shadeM: 0, towardSunM: 0, awaySunM: 0 };
    for (const leg of plan.legs) { const q = pathFacts(leg.cells, sunNow(leg.startSec)); for (const k of Object.keys(f)) f[k] += q[k]; }
    return { id, sec: plan.seconds, g: plan.grams, ...f, line: plan.points.map((q) => [q.x, q.z]) };
  };
  return [row('short', refPlans.short), row('least', refPlans.least), row('plan', planTraverse(PLACES, ASSUME.walkKmh, 'plan', { fields: toward, pause }))];
}
// The rover and the robot (npc.js). ?npc=0 leaves them out, for the capture views.
const npcs = params.get('npc') === '0' ? null : setupNpcs({ scene, camera, canvas, state, heightAt, site: SITE, hud: $('hud'), alarm: () => alarmOn() });
setupGame({
  params, npcs, state, scene, hemi, sun, sky, jumpTo, press, minimap, world, site: SITE, heightAt, patches: classPatches(),
  hold: (code, on) => { if (on) state.keys.add(code); else state.keys.delete(code); },
  // For the station card (visit.js). work: minutes at a station, at the station rate. stationDone:
  // the planned work there is done, so the plan stops counting it. goHomeNow: drop every station
  // ahead, the same way a late plan does.
  work: (min) => { evaStarted = true; state.elapsedSec += min * 60; useO2(min * STATION_GPM); },
  stationDone: (name) => { worked.add(name); lastPlanCheck = -1; },
  // The plan as it stands at the habitat before the walk: each leg and each station, with the
  // model's walking time and oxygen (the oxygen carries the +1 SD band of every turn-back number).
  planSummary: () => {
    const rows = []; let x = PLACES[0].x, z = PLACES[0].z, prevS = 0, t = 0, g = 0;
    for (const pl of PLACES.slice(1)) {
      const st = pl.name === 'HAB' ? null : route.stations.find((q) => q.name === pl.name);   // the last leg ends at the end of the route
      const m = (st ? st.s : route.length) - prevS, sec = legSec(x, z, pl.name), og = legG(x, z, pl.name), work = pl.workMin || 0;
      // m: metres along the drawn line, which is smoothed. pathM: metres of the grid path that the
      // time and the oxygen are counted on (a few percent longer). The plan screen shows pathM.
      rows.push({ to: pl.name, m, pathM: toward.get(pl.name).dist[cellOf(x, z)], sec, g: og, workMin: work, workG: work * STATION_GPM, task: pl.task || '', sol: pl.sol || null, x: pl.x, z: pl.z });
      t += sec + work * 60; g += og + work * STATION_GPM; x = pl.x; z = pl.z; prevS = st ? st.s : route.length;
    }
    const c = planConfidence(PLACES.slice(1, -1), PLACES[0].x, PLACES[0].z);
    // What the crew chose, the same walk planned three ways, and the day at the hour of departure.
    const sun0 = sunNow(0), sun1 = sunNow(t), e0 = envNow(0);
    return { rows, sec: t, g, routeM: route.length, limitH: ASSUME.evaLimitH, reserveMin: ASSUME.reserveMin, o2G: O2.totalG, o2ReserveG: O2.reserveG, walkKmh: ASSUME.walkKmh, conf: c.p,
      line: route.samples.filter((_, i) => i % 4 === 0).map((q) => [q.p.x, q.p.z]), hab: [PLACES[0].x, PLACES[0].z], size: TERRAIN_SIZE,
      opts: { ...planOpts }, loads: LOADS, departs: DEPARTS, steepDeg: STEEP_DEG, sunLowDeg: SUN.lowDeg, sunLineDeg: SUN.lineDeg, weight: WEIGHT, compare: comparePlans(),
      grid: { n: GRID_N, slope: slopeGrid(), shade: sun0.el > 0 ? shadeGrid(sun0.az, sun0.el) : null },
      day: { lmst: e0.lmst, sun0, sun1, airK: e0.air && e0.air.v, groundK: e0.ground && e0.ground.v, doseUGy: radDose(0, t), ...daylight() } };
  },
  // The plan screen changes what the route considers. Every field, the route and the lines that
  // read them are made again. The caller then puts the walk back at the habitat (jumpTo).
  setPlan: (next) => {
    Object.assign(planOpts, next);
    buildFields();
    returnLine.field = home; returnLine.cell = -1;
    for (const [name, l] of previews) { l.field = toward.get(name); l.cell = -1; }
    reachWorker.postMessage({ type: 'plan', cost: home.cost });
    fromField = null; reachAsk = null; reachSegs = []; reachMaskNow = null; reachLine.set([]);
    setRoute(PLACES); setLabels();
    clearRocksNear(route.samples.map((q) => q.p), 3);
    window.__plan = { ...planOpts, routeM: Math.round(route.length) };
  },
  goHomeNow: () => { const gone = stationsAhead(); if (!gone.length) return; dropped = dropped.concat(gone.map((pl) => pl.name)); replans += 1;
    planNote = { why: 'crew', gone: gone.map((pl) => pl.name), keep: [], at: state.elapsedSec, conf: planConfidence([]).p };
    setRoute([{ x: state.pos.x, z: state.pos.z, name: 'HERE' }, PLACES[PLACES.length - 1]]); setLabels(); state.s = 0; state.offset = 0; agentShown = ''; agentTypedAt = performance.now(); },
  cine: playCine,
  stationInfo: (name) => stationInfo[name], stationChem: (name) => stationChem[name], stationsReady, places: PLACES, camera, startMin: (ASSUME.evaLimitH * 60), reserveMin: ASSUME.reserveMin, get walkGpm() { return WALK_GPM; }, stationGpm: STATION_GPM, o2: O2,
  snapshot: () => {
    const n = numbers();
    return { n, alarm: alarmOn(), rad: radNow(state.elapsedSec, state.alarm), radLive, ground: classAt(state.pos.x, state.pos.z), patch: classPatchAt(state.pos.x, state.pos.z),
      next: (() => { const nx = route.nextStation(state.s); return { name: nx.name, dist: Math.max(0, nx.s - state.s), p: nx.p }; })(), ahead: stationsAhead().map((pl) => pl.name),
      classLabels, ev2Raised: ev2Raised !== null, agentShown: agentVisible && el.agent.getClientRects().length > 0, ev2Now, auto: state.auto, elapsed: state.elapsedSec, walked: state.walked || 0, back: goHome(n),
      dropped: dropped.slice(), conf: conf ? conf.p : null, eta: ETA_BY_CLASS, etaDefault: ETA_DEFAULT, level: el.gauge.dataset.level, word: el.gO2.textContent, routeM: Math.round(route.length) };
  },
});
document.fonts.ready.then(() => { window.__ready = true; });
requestAnimationFrame(frame);

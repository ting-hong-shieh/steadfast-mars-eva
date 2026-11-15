// Written with an AI tool (Claude). See AI_USE.md.
// The game layer over the helmet view (owner's direction of 2026-11-14 after the judges' feedback):
//  - a guided tour that a first visit goes through before the free walk, one part of the product at a
//    time, starting with the plan of the walk (owner, 2026-11-15: the entry is a look at the whole
//    product, not a game);
//  - scenarios that put the walk in a chosen state;
//  - a row of data layers, each marked MEASURED, MODEL, COMPUTED or SIMULATED, with a plain explanation;
//  - on-screen buttons for everything that was only on the keyboard;
//  - the day's weather and Earth link, a ground-type legend, and the look of a particle event.
// One thing here changes the walk: the plan screen, where the crew picks what the route considers
// (api.setPlan). Nothing else changes a route, a margin or a number. Texts restate docs/methods.md.
import * as THREE from 'three';
import './game.css';
import './hud2.css';
import '@fontsource/chakra-petch/700.css';
import { envNow, envSeries } from './env.js';
import { radCurve, FLICKER, flickerShare, radFlicker, radShownAt, fmtRate } from './rad.js';
import { setupVisit, arrivalCaption, land } from './visit.js';

const h = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.innerHTML = html; return e; };
const KIND = { measured: 'MEASURED', model: 'MODEL', computed: 'COMPUTED', simulated: 'SIMULATED' };
// A phone-width screen (the same 760 px limit as the style sheets). It has no keyboard, so the tour's tasks are tapped.
const PHONE = typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;
const TAP_TASK = { W: ['KeyP', 'Tap here to walk a few steps'], C: ['KeyC', 'Tap here to switch the colours'], T: ['KeyT', 'Tap here to jump 30 minutes ahead'], R: ['KeyR', 'Tap here to start the storm'] };
const KD = Object.fromEntries(Object.keys(KIND).map((k) => [k, `<i class="kd" data-kind="${k}" title="${KIND[k]}"></i>`]));
const GROUND = [['SOIL', '#cda06e'], ['BEDROCK', '#7878c8'], ['SAND', '#f0dc50'], ['BIG ROCK', '#dc3c3c']];

// ---------- Data layers ----------
// `data` names the kind of data in the words of the challenge text.
const LAYERS = [
  { id: 'terrain', name: 'TERRAIN', kind: 'measured', data: 'TOPOGRAPHIC',
    title: 'The shape of the ground is real.',
    body: 'An orbiter camera measured this part of Gale crater on a 1 m grid. Around the habitat, Curiosity\'s own stereo cameras give the ground on 5 cm cells, fine enough to choose where each boot goes. Every slope, walking time, route and gram of oxygen on this display starts from these heights.',
    src: 'USGS Gale 1 m elevation model (HiRISE) · Curiosity Navcam stereo, sol 4709',
    limit: 'Checked against Curiosity\'s tilt sensor at 61 stops: the orbital ground reads about 7° too steep over 3 m.' },
  { id: 'imagery', name: 'IMAGERY', kind: 'measured', data: 'OPTICAL',
    title: 'You see what the cameras saw.',
    body: 'The ground picture is a 25 cm orbital image. At each station the display shows the photo Curiosity\'s Mastcam took at that exact stop, so you know the place before you arrive. The corner map is made of JPL Mars Trek tiles stored in the suit, so it needs no link.',
    src: 'USGS Gale 25 cm orthoimage · Mastcam, sols 4616, 4829, 4838 · JPL Mars Trek',
    limit: 'The orbital image is grey. Its colour is one tint matched to the Mastcam photos.' },
  { id: 'ground', name: 'GROUND', kind: 'model', data: 'OPTICAL → CLASSES',
    title: 'Sand costs twice the oxygen of bedrock.',
    body: 'An image model reads Curiosity\'s Navcam photos and sorts the ground into soil, bedrock, sand and big rock. Each type changes what a step costs, so the route bends around sand. Two 48 m patches are classified: the habitat and Station A. Everywhere else the display assumes rocky ground (×1.2).',
    src: 'DINOv3 fine-tuned on AI4Mars labels · Navcam, sols 4709 and 4614',
    limit: 'On 322 Curiosity images it had not seen: mean IoU 0.69. Big rock is weak (0.18). The cost factors are Earth values without a suit.',
    live: (s) => s.ground >= 0 ? `UNDER YOUR BOOTS: ${GROUND[s.ground][0]} · WALK COST ×${s.eta[s.ground].toFixed(1)}` : `NOT CLASSIFIED HERE · ASSUMED ×${s.etaDefault.toFixed(1)}` },
  { id: 'radiation', name: 'RADIATION', kind: 'measured', data: 'RADIATION',
    title: 'The dose rate is what Curiosity read on this sol.',
    body: 'The number comes from the radiation detector on Curiosity\'s deck. Start the solar storm to replay the real particle event of 20 May 2024: the reading climbs from 5.6 to 351 µGy/h in 54 minutes. The alarm fires when the rate is 25 % above the background, and the display then shows only the way to shelter.',
    src: 'MSL RAD, PDS · alarm rule: Löwe et al. 2025 (preprint)',
    limit: 'Read inside the instrument on the rover, not inside a suit. The event happened on sol 4190, not on the sol of this walk.',
    live: (s) => FLICKER.on ? `NOW: ${fmtRate(s.radShown)} µGy/h · RAD READING ${fmtRate(s.rad.rate)} · FLICKER SIMULATED` : `NOW: ${fmtRate(s.rad.rate)} µGy/h · ${s.rad.label}` },
  { id: 'weather', name: 'WEATHER', kind: 'measured', data: 'ATMOSPHERIC · THERMAL',
    title: 'The weather of the same day, minute by minute.',
    body: 'Air temperature, ground temperature and pressure, as Curiosity\'s weather station measured them on sol 4709. They run on the clock of your walk, which starts at 08:08 local time. They are shown on this card so the crew knows the day. They are not on the helmet view, and they do not change the oxygen model.',
    src: 'MSL REMS, PDS Atmospheres node (MODRDR), sol 4709',
    limit: 'Readings at the rover. The sensors\' quality flags were not applied. Shown is the last reading, which can be an hour old.',
    live: (s, e) => e.air && e.ground ? `NOW ${e.lmst} LOCAL: AIR ${c(e.air.v)} °C · GROUND ${c(e.ground.v)} °C · ${Math.round(e.pressure.v)} Pa` : '' },
  { id: 'geology', name: 'GEOLOGY', kind: 'measured', data: 'GEOLOGIC MAP',
    title: 'One rock unit for seven kilometres.',
    body: 'Open the map and switch to the USGS geologic map of Mars. This site lies in one unit, a Hesperian transition unit, and the next unit starts about 7 km away. So the geology shows only when the map is zoomed out to 8 km and more.',
    src: 'USGS Scientific Investigations Map 3292, through JPL Mars Trek',
    limit: 'A global map at 1 : 20,000,000. It cannot tell one outcrop from the next.' },
  { id: 'link', name: 'EARTH LINK', kind: 'computed', data: 'EPHEMERIS',
    title: 'A question to Earth takes 40 minutes to answer.',
    body: 'On 4 November 2025 Mars was 2.41 astronomical units from Earth. A radio signal needed 20 minutes one way. That is why this display decides on the spot and never waits for Mission Control.',
    src: 'JPL Horizons (DE441), centre of Mars to centre of Earth',
    limit: 'Geometry only. No relay orbiter, antenna or terrain is modelled.',
    live: (s, e) => { const [m, sec] = minSec(e.lightMin); return `NOW: ${m} min ${String(sec).padStart(2, '0')} s ONE WAY`; } },
  { id: 'oxygen', name: 'OXYGEN', kind: 'model', data: 'NASA SUIT TESTS · APOLLO',
    title: 'Oxygen from NASA suit tests, doubt from Apollo.',
    body: 'What a step costs comes from NASA tests of people walking in a prototype suit at Mars gravity, with a term for slope. How wrong a plan can be comes from Apollo: in 9 of 12 cases the crew member ended with less oxygen than planned. The display runs 1,000 simulated walks with those errors and shows the share that finish the plan.',
    src: 'NASA/TP-2009-214796, 2010-216115, 2010-216125 · NASA/TP-2017-219457 (Apollo)',
    limit: 'One prototype suit, six test subjects, level ground. Apollo crews walked on the Moon. A model confidence, not a measured risk.',
    live: (s) => s.conf === null ? '' : `NOW: FINISH PLAN ${Math.round(s.conf * 100)} %` },
  { id: 'sim', name: 'SIMULATED', kind: 'simulated', data: 'FOR THE DEMO',
    title: 'What is made up, and says so.',
    body: 'The clock, the size of the oxygen tank, the sky and the light, the fine grain of the ground, the small rocks and the sand-and-plate look of the ground outside the measured square, the descent at the start of a visit, the dust in the air and the glow of the particle event are made for the demo. The second astronaut\'s figure is AI-generated. Nothing simulated is shown as a measurement.',
    src: 'Our choices, listed in the methods file of the repository',
    limit: 'This is a simulation of the view through a helmet display. It is not a headset build.' },
];
// How the ground colours are made, step by step, with a real frame (docs/methods.md, row Ground classes).
const FIGS = `${import.meta.env.BASE_URL}figs/`;
const GROUND_HOW = `<ol class="pipe">
  <li><b>1 · NASA PHOTO</b><img src="${FIGS}seg_frame.jpg" alt=""><span>Curiosity's Navcam: 22 frames around the habitat (sol 4709) and 19 at Station A (sol 4614). The colours here are the model's answer on one frame of sol 4709.</span></li>
  <li><b>2 · MODEL</b><span>DINOv3 ViT-B/16 with a segmentation head, fine-tuned on AI4Mars v0.6 (labelled Curiosity and Perseverance images). It gives every pixel one of four types.</span>
    <em>${GROUND.map(([n, col]) => `<span><i style="background:${col}"></i>${n}</span>`).join('')}</em></li>
  <li><b>3 · ONTO THE GROUND</b><span>Navcam's stereo product gives each pixel a place in metres. Every 5 cm cell takes the type with the most votes.</span></li>
  <li><b>4 · INTO THE ROUTE</b><span>The type sets what a step costs: bedrock ×1.0, soil ×1.2, big rock ×1.5, sand ×2.1. The route is the path of least oxygen.</span></li>
</ol>`;
const c = (kelvin) => `${kelvin - 273.15 < 0 ? '−' : ''}${Math.abs(Math.round(kelvin - 273.15))}`;
// Minutes and whole seconds of a time in minutes. Rounding the seconds alone could give "20 min 60 s".
const minSec = (min) => { const t = Math.round(min * 60); return [Math.floor(t / 60), t % 60]; };

// ---------- Guided tour ----------
// Each step puts the walk in one state and shows one part of the product. A step with `goal` waits
// for the player to do the thing (or 15 s, so nobody is stuck). Seven steps since the owner's
// decision of 2026-11-15: the plan of the walk comes first and a station stop is one of the steps.
// `plan`: the step is the plan screen. `station`: the station card may open in this step.
const STEPS = [
  { title: 'The plan, before you go out', jump: { s: 2 }, spot: null, plan: true,
    body: 'A walk on Mars is planned inside, with the data on the table. Choose what the route considers, and see what each choice costs. This is the plan the display will hold you to.' },
  { title: 'Walk on Mars', jump: { s: 2 }, spot: '#navBlock',
    body: 'You are EV1, just outside the habitat in Gale crater. The ground is real NASA data. The lit path on the ground is the route of your plan: the least oxygen, around the ground you chose to avoid.',
    task: ['W', 'Hold W to walk a few steps'], goal: (s) => s.walked > 5,
    why: { text: 'The route is the path that uses the least oxygen in our model. It is found with Dijkstra\'s algorithm on a 2 m grid of the measured heights. Walking speed falls on slopes (Tobler 1993), and oxygen per metre comes from NASA suit tests. Ground steeper than 24° counts as an obstacle when the plan says so.' } },
  { title: 'Read the ground', jump: { s: 6, classes: true }, spot: '#legend',
    body: 'Curiosity photographed this ground. A model sorted it into soil, bedrock, sand and big rock. Sand costs twice the oxygen of bedrock, so the route avoids it.',
    task: ['C', 'Press C to switch the colours'], goal: (s, ev) => ev.has('KeyC'),
    why: { html: GROUND_HOW, text: 'Tested on 322 Curiosity images the model had not seen: mean IoU 0.69 (soil 0.92, sand 0.87, bedrock 0.82, big rock 0.18, so big rock is weak). The cost factors are Earth values without a suit. Outside the two classified patches the display assumes rocky ground, ×1.2.' } },
  { title: 'Science at a station', jump: (api) => ({ s: Math.max(2, api.planSummary().rows[0].m - 10) }), spot: null, station: true, demoMs: 16500,
    body: 'The stations are places where Curiosity stopped and took photos. When you arrive, the display shows the rover\'s photo, the reason on its label, and what each choice leaves for the way home.',
    task: ['W', 'Walk to the station and choose'], goal: (s, ev) => ev.has('visit'),
    why: { text: 'The photo and the reason are from the Mastcam image label of that sol. The minutes to spare come from the same clock and oxygen numbers as the gauge. The 25 minutes of work are an assumption of the plan.' } },
  { title: 'Know your margin', jump: { s: 170, t: 1 }, spot: '#gauge',
    body: 'The big word is the decision. Under it is the time to spare before you must turn back. It is the tighter of two limits: the clock and the oxygen. EV2 walks with you, and the pair turns back when the first of the two would run low.',
    task: ['T', 'Press T to jump 30 minutes ahead'], goal: (s, ev) => ev.has('KeyT'),
    why: { fig: 'apollo_oxygen.png', text: 'Apollo plans were often too hopeful: in 9 of 12 cases the crew member ended with less oxygen than planned. So the margin keeps a 30 minute reserve, and FINISH PLAN runs 1,000 walks with Apollo\'s errors.' } },
  // The same moment as slide 5 of the deck and the replan figure: 6.0 h in, just past Station A, Station C is
  // dropped and Station B kept (checked on the build of 2026-11-15 21:40). Before that the step jumped to
  // 6.55 h near the habitat, where all three stations were dropped, and its title "Late?" was unclear (owner).
  { title: 'Running late: the plan changes', jump: { s: 240, t: 6.0, auto: true }, spot: '#agent',
    body: 'Six hours in, just past Station A, the walk is behind its plan, and Stations B and C no longer both fit before the way home. The display drops Station C, keeps Station B and plans a new way home. It keeps a station only if at least 90 % of 1,000 simulated walks would finish.',
    why: { fig: 'replan_example.png', text: 'Three moments read from the app: the plan stops fitting, a station is dropped, and a new least-oxygen route is planned from where you stand.' } },
  { title: 'Solar storm', jump: { s: 260, t: 2 }, spot: null,
    body: 'Curiosity measured a real particle event at this crater on 20 May 2024. Replay it. The amber line is the fastest way to shelter, and the planned route disappears.',
    task: ['R', 'Press R to start the storm'], goal: (s, ev) => ev.has('KeyR'),
    why: { fig: 'rad_event.png', text: 'On the readings of 20 May 2024 the alarm rule (25 % above the background) fires 53 minutes before the peak of 351 µGy/h. The longest walk home on this route is about 6 minutes.' } },
];

const SCENARIOS = [
  { name: 'Running late', note: 'A station is dropped and the route is planned again.', jump: { s: 240, t: 6.0, auto: true } },
  { name: 'Solar storm', note: 'Replay of the particle event Curiosity measured in 2024.', jump: { s: 260, t: 2, alarm: true, auto: true } },
];

const ACTIONS = [
  ['KeyW', 'W', 'WALK', 'hold'], ['KeyP', 'P', 'AUTO WALK'], ['KeyT', 'T', '+30 MIN'], ['KeyE', 'E', 'PARTNER O₂'],
  ['KeyR', 'R', 'SOLAR STORM'], ['KeyC', 'C', 'GROUND TYPES'], ['KeyM', 'M', 'MAP'], ['KeyL', 'L', 'GEOLOGY'], ['KeyV', 'V', 'LOOK DOWN'], ['KeyX', 'X', 'GOGGLES'], ['KeyG', 'G', 'AGENT'], ['Tab', 'TAB', 'ALL READINGS'],
];

export function setupGame(api) {
  const { params, state } = api;
  const hud = document.getElementById('hud');
  document.getElementById('loading')?.remove();
  if (params.get('game') === '0') return;
  const plain = location.search === '';
  let trained = false;
  try { trained = localStorage.getItem('mm.trained') === '1'; } catch { /* private window */ }
  const done = new Set();          // what the player did during the current step
  addEventListener('keydown', (e) => done.add(e.code));
  // Two views of the same display. FOCUS: the decision, the heading, the map and one line of the
  // day, as a walker would keep it. TELEMETRY (Tab): every panel. The training, an open layer card
  // and a particle event always show the panels.
  // On a computer every panel shows by default and Tab folds them away (owner, 2026-11-15). On a phone the panels
  // start folded, in the tour too, and the button READINGS opens them: unfolded they lay on each other and the
  // phone view read as chaotic (owner, 2026-11-15 22:20: "fold by default on a phone"). ?hud=all opens them.
  let focusPref = params.get('hud') === 'focus' || (PHONE && params.get('hud') !== 'all');
  // The Tab hint blinks until the panels were folded once, on this computer. After that it stays, without blinking.
  let foldSeen = focusPref;
  try { foldSeen = foldSeen || localStorage.getItem('mm.folded') === '1'; } catch { /* private window */ }
  // The panels can fold only in the free walk: a press during the tour, a layer card or a storm changed nothing on
  // screen and folded the panels later, by surprise. The TAB button is dimmed meanwhile.
  const canFold = () => (step < 0 || PHONE) && (stormK < 0.02 || PHONE) && !explainId;
  addEventListener('keydown', (e) => {
    if (e.code !== 'Tab') return;
    e.preventDefault?.(); if (!canFold()) return;
    focusPref = !focusPref;
    if (!foldSeen) { foldSeen = true; try { localStorage.setItem('mm.folded', '1'); } catch { /* private window */ } }
  });

  // ----- Top: the day, and the data layers -----
  const day = h('section', { id: 'day', class: 'panel' }, `
    <div class="day-head"><b>SOL 4709</b><span id="dayClock"></span><i>REPLAY OF A REAL DAY · 4 NOV 2025</i></div>
    <div class="tiles">
      <div data-kind="computed"><span>EARTH LINK</span><b id="tLink">--</b></div><div data-kind="${FLICKER.on ? 'simulated' : 'measured'}" title="${FLICKER.on ? 'The last 18 s of the number on the panel: a simulated flicker around the RAD reading, which is the dashed line' : 'RAD readings of the sol'}"><span>DOSE RATE</span><canvas id="tDose" width="120" height="28"></canvas></div>
    </div>
    <div class="day-mini" id="dayMini"></div>
    <div class="src">CURIOSITY RAD · JPL HORIZONS</div>
    <div class="kd-key">${Object.keys(KIND).map((k) => `<span>${KD[k]}${KIND[k]}</span>`).join('')}</div>`);
  const layers = h('nav', { id: 'layers', 'aria-label': 'Data layers' });
  for (const l of LAYERS) {
    const b = h('button', { 'data-id': l.id, 'data-kind': l.kind }, `<i></i>${l.name}`);
    b.addEventListener('click', () => { done.add('layer'); openExplain(explainId === l.id ? null : l.id); });
    layers.appendChild(b);
  }
  const explain = h('section', { id: 'explain', class: 'panel', hidden: '' });
  const legend = h('section', { id: 'legend', class: 'panel' });
  const storm = h('section', { id: 'storm', hidden: '' }, `
    <div class="storm-head">SOLAR PARTICLE EVENT</div>
    <div class="storm-rate"><b id="stormRate">--</b><span>µGy/h ${KD.measured}</span><em id="stormX"></em></div>
    <canvas id="stormCurve" width="520" height="70"></canvas>
    <div class="storm-src"><span id="stormRead"></span>Replay of what Curiosity's RAD measured on 20 May 2024. The glow and the streaks are a visual effect.</div>`);
  const fx = h('div', { id: 'radfx', 'aria-hidden': 'true' }, '<i></i><i></i>');
  const coach = h('section', { id: 'coach', class: 'panel', hidden: '' });
  const dock = h('nav', { id: 'dock', 'aria-label': 'Actions' });
  for (const [code, key, label, mode] of ACTIONS) {
    const b = h('button', { 'data-code': code }, `<kbd>${key}</kbd>${label}`);
    if (mode === 'hold') {
      const on = (v) => (e) => { e.preventDefault(); api.hold(code, v); b.classList.toggle('on', v); if (v) done.add(code); };
      b.addEventListener('pointerdown', on(true)); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, on(false));
    } else b.addEventListener('click', () => api.press(code));
    dock.appendChild(b);
  }
  const guideBtn = h('button', { class: 'wide' }, '<kbd>?</kbd>GUIDED TOUR');
  guideBtn.addEventListener('click', () => startTraining(0, false));
  // Back to the first screen from anywhere (teammate's test: nothing led back, and SCENARIOS did not say that it ends a run).
  const scenBtn = h('button', { class: 'wide' }, '<kbd>≡</kbd><span>MAIN MENU</span>');
  scenBtn.addEventListener('click', () => showBriefing(false, true));
  dock.append(guideBtn, scenBtn);
  // ? opens the guided tour. Escape closes what is on top: a layer card, the demo, the guided tour, the briefing over a walk.
  addEventListener('keydown', (e) => {
    // The key by its place on the keyboard too: with a Chinese input method on, e.key is not '?'.
    // ? again closes the tour, like every other key of the row that opens something.
    if ((e.key === '?' || e.key === '？' || e.code === 'Slash') && !api.world.open) { if (step < 0) startTraining(0, !intro.hidden); else closeTour(); }
    if (e.code !== 'Escape') return;
    if (explainId) openExplain(null);
    else if (demo) { stopDemo(); leaveTour(); showBriefing(trained); }
    else if (step >= 0) { if (!visit.open() && document.getElementById('keyKeep').hidden) closeTour(); }
    else if (!intro.hidden && trained) intro.hidden = true;
  });
  // Every panel is open at first. This line says which key folds them. It blinks until the panels were folded once (owner, 2026-11-15).
  const foldHint = h('button', { id: 'foldHint' }, '<kbd>TAB</kbd><span>FOLD THE PANELS</span>');
  foldHint.addEventListener('click', () => api.press('Tab'));
  // A clicked button must not keep the keyboard: Enter or Space would press it again.
  for (const el of [dock, foldHint, layers]) el.addEventListener('click', () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  hud.append(day, layers, legend, storm, explain, coach, dock, foldHint);
  document.body.insertBefore(fx, hud);
  if (params.get('keys') === '0') dock.hidden = true;
  document.getElementById('help').hidden = true;
  // A mark on every number of the display (design review of 2026-11-14): what kind of number it
  // is. Filled circle: measured by a NASA mission. Filled diamond: a model of ours on such data.
  // Ring: computed from geometry. Hollow diamond: simulated for the demo. docs/methods.md, "Marks".
  const NUM_KIND = { elapsed: 'simulated', left: 'simulated', ret: 'model', margin: 'model', o2: 'model', effort: 'model', doseRate: 'measured',
    nextDist: 'computed', slope: 'measured', ground: 'model', off: 'computed', los: 'computed' };
  for (const [id, kind] of Object.entries(NUM_KIND)) { const row = document.getElementById(id)?.closest('.row'); if (row) { row.dataset.kind = kind; row.title = KIND[kind]; } }
  document.getElementById('gTime').dataset.kind = 'model';

  // ----- Explanation of one layer -----
  let explainId = null;
  function openExplain(id) {
    explainId = id;
    for (const b of layers.children) b.classList.toggle('on', b.dataset.id === id);
    explain.hidden = !id; document.body.classList.toggle('explaining', !!id);
    if (!id) return;
    const l = LAYERS.find((q) => q.id === id);
    explain.dataset.kind = l.kind;
    explain.innerHTML = `<header><span class="badge">${KIND[l.kind]}</span><span class="data">${l.data}</span><button aria-label="Close">×</button></header>
      <h2>${l.title}</h2><p>${l.body}</p><p class="live" id="explainLive"></p>
      <dl><dt>SOURCE</dt><dd>${l.src}</dd><dt>LIMIT</dt><dd>${l.limit}</dd></dl>`;
    explain.querySelector('button').addEventListener('click', () => openExplain(null));
  }

  // ----- Training -----
  let step = -1, stepAt = 0, passed = false;
  function spot(sel) {
    document.querySelectorAll('.spot').forEach((e) => e.classList.remove('spot'));
    document.body.classList.toggle('training', step >= 0);
    if (sel) document.querySelector(sel)?.classList.add('spot');
  }
  // The plan screen: what the route considers (the crew's choice), a map of the walk on the orbital
  // image with the same walk planned three ways, and what the model says each part costs.
  const ROUTE_NAMES = { short: 'Shortest path', least: 'Least oxygen only', plan: 'This plan' };
  const compass = (az) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(az / 45) % 8];
  // Steep ground and terrain shadow as one picture over the map: one pixel per 2 m cell.
  function overlayUrl(G, steepDeg) {
    const cv = document.createElement('canvas'); cv.width = cv.height = G.n;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(G.n, G.n), d = img.data;
    for (let i = 0; i < G.n * G.n; i++) {
      if (G.slope[i] > steepDeg) d.set([255, 92, 66, 140], 4 * i);
      else if (G.shade && G.shade[i]) d.set([10, 20, 62, 150], 4 * i);
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL();
  }
  function planHtml() {
    const P = api.planSummary(), min = (sec) => Math.round(sec / 60), stops = P.rows.slice(0, -1), O = P.opts, D = P.day;
    const all = P.compare.flatMap((r) => r.line);
    const xs = all.map((q) => q[0]).concat(stops.map((r) => r.x)), zs = all.map((q) => q[1]).concat(stops.map((r) => r.z));
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const w = Math.min(P.size, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 90), u = w / 100;
    const x0 = Math.max(-P.size / 2, Math.min(P.size / 2 - w, cx - w / 2)), z0 = Math.max(-P.size / 2, Math.min(P.size / 2 - w, cz - w / 2));
    const real = stops.some((r) => r.sol), steep = Math.round(P.steepDeg), lowSun = D.sun0.el > 0 && D.sun0.el < P.sunLowDeg;
    const mark = (x, z, name, home) => `<g transform="translate(${x.toFixed(1)} ${z.toFixed(1)})"><circle r="${(home ? 2.2 : 1.8) * u}" class="${home ? 'hab' : 'stn'}"/><text x="${2.8 * u}" y="${1.2 * u}" font-size="${3.6 * u}">${name}</text></g>`;
    const pts = (line) => line.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
    // The sun's direction at departure, as an arrow that points where the light goes.
    const sa = D.sun0.az * Math.PI / 180, sx = x0 + w - 9 * u, sz = z0 + 15 * u;
    const sunMark = D.sun0.el > 0 ? `<g class="sun" transform="translate(${sx.toFixed(1)} ${sz.toFixed(1)})"><circle r="${1.6 * u}"/><line x1="0" y1="0" x2="${(-Math.sin(sa) * 6 * u).toFixed(1)}" y2="${(Math.cos(sa) * 6 * u).toFixed(1)}" stroke-width="${0.6 * u}"/><text x="${-2 * u}" y="${-3 * u}" font-size="${3 * u}" text-anchor="end">SUN ${Math.round(D.sun0.el)}°</text></g>` : '';
    const map = `<svg class="plan-map" viewBox="${x0.toFixed(1)} ${z0.toFixed(1)} ${w.toFixed(1)} ${w.toFixed(1)}" aria-label="Map of the planned walk, north up">
      <image href="${api.site.base}orbital_ortho.jpg" x="${-P.size / 2}" y="${-P.size / 2}" width="${P.size}" height="${P.size}" preserveAspectRatio="none"/>
      <image class="over" href="${overlayUrl(P.grid, P.steepDeg)}" x="${-P.size / 2}" y="${-P.size / 2}" width="${P.size}" height="${P.size}" preserveAspectRatio="none"/>
      ${P.compare.map((r) => `<polyline class="r-${r.id}" points="${pts(r.line)}" stroke-width="${(r.id === 'plan' ? 0.9 : 0.5) * u}"${r.id === 'short' ? ` stroke-dasharray="${1.4 * u} ${1.2 * u}"` : ''}/>`).join('')}
      ${stops.map((r) => mark(r.x, r.z, r.to)).join('')}${mark(P.hab[0], P.hab[1], 'HAB', true)}${sunMark}
      <g transform="translate(${(x0 + 4 * u).toFixed(1)} ${(z0 + w - 5 * u).toFixed(1)})"><rect width="100" height="${0.7 * u}" class="bar"/><text y="${-1.4 * u}" font-size="${3 * u}">100 m</text></g>
      <text x="${(x0 + w - 4 * u).toFixed(1)}" y="${(z0 + 6 * u).toFixed(1)}" font-size="${3.4 * u}" text-anchor="end">N ↑</text></svg>`;
    let from = 'HAB';
    const rows = P.rows.map((r) => { const tr = `<tr><td><b>${from} → ${r.to}</b>${r.task ? `<small>${r.task}</small>` : ''}</td><td>${Math.round(r.pathM)} m</td><td>${min(r.sec)} min</td><td>${r.workMin ? `${r.workMin} min` : '·'}</td><td>${Math.round(r.g + r.workG)} g</td></tr>`; from = r.to; return tr; }).join('');
    const limitMin = P.limitH * 60 - P.reserveMin, useG = Math.round(P.g), haveG = Math.round(P.o2G - P.o2ReserveG);
    const tog = (key, name, note) => `<button class="opt${O[key] ? ' on' : ''}" data-opt="${key}" aria-pressed="${O[key]}"><i></i><b>${name}</b><small>${note}</small></button>`;
    const pick = (key, list, label) => `<div class="seg" role="group" aria-label="${label}">${list.map((v) => `<button class="${String(O[key]) === String(v) ? 'on' : ''}" data-opt="${key}" data-val="${v}">${label === 'LOAD' ? `${v} kg` : v}</button>`).join('')}</div>`;
    // SHADOW and SUN LINE appear only when some path has metres in them. At the default hour (08:08)
    // both are 0 on every path, and two columns of zeros read as noise (owner, 2026-11-15 21:30).
    const showShade = P.compare.some((r) => Math.round(r.shadeM) > 0);
    const showSun = P.compare.some((r) => Math.round(r.towardSunM) + Math.round(r.awaySunM) > 0);
    const cmp = P.compare.map((r) => `<tr class="${r.id === 'plan' ? 'mine' : ''}"><td><i class="sw r-${r.id}"></i>${ROUTE_NAMES[r.id]}</td><td>${Math.round(r.m)} m</td><td>${(r.sec / 60).toFixed(1)} min</td><td>${r.g.toFixed(1)} g</td><td>${Math.round(r.steepM)} m</td>${showShade ? `<td>${Math.round(r.shadeM)} m</td>` : ''}${showSun ? `<td>${Math.round(r.towardSunM)} · ${Math.round(r.awaySunM)} m</td>` : ''}</tr>`).join('');
    const tC = (k) => (k ? `${k - 273.15 < 0 ? '−' : ''}${Math.abs(Math.round(k - 273.15))} °C` : '--');
    return `<div class="plan-grid">
      <figure>${map}<figcaption><span><i class="sw r-plan"></i>THIS PLAN</span><span><i class="sw r-least"></i>LEAST OXYGEN ONLY</span><span><i class="sw r-short"></i>SHORTEST PATH</span><span><i class="sw steep"></i>STEEPER THAN ${steep}°</span>${D.sun0.el > 0 ? `<span><i class="sw shade"></i>IN SHADOW AT ${D.lmst}</span>` : ''}
        <br><span>${KD.measured}ORBITAL IMAGE, 25 CM</span><span>${real ? `${KD.measured}STATIONS: CURIOSITY STOPS` : `${KD.simulated}STATIONS: IMAGINED, NOT ROVER TARGETS`}</span><span>${KD.computed}STEEP GROUND AND SHADOW: FROM THE 1 M HEIGHTS</span></figcaption>
        <p class="plan-day">${KD.computed}<b>LEAVE ${D.lmst} LOCAL TIME</b> · sun ${D.sun0.el > 0 ? `${Math.round(D.sun0.el)}° up in the ${compass(D.sun0.az)}` : 'not up yet'}, ${D.sun1.el > 0 ? `${Math.round(D.sun1.el)}° when you are back` : 'down when you are back'} · daylight ${D.rise} to ${D.set}<br>${KD.measured}air ${tC(D.airK)} · ground ${tC(D.groundK)} · dose on this walk ${D.doseUGy.toFixed(1)} µGy, in the instrument</p></figure>
      <div>
        <div class="plan-opts">
          <span class="plan-h plan-top">THE ROUTE CONSIDERS<em class="plan-busy" role="status"><i></i>PLANNING THE ROUTE AGAIN</em></span>
          <div><button class="opt on" disabled aria-pressed="true"><i></i><b>OXYGEN</b><small>slope and ground type</small></button>
            ${tog('steep', 'STEEP GROUND', `obstacle above ${steep}°`)}${tog('shade', 'SHADOW', lowSun || O.shade ? 'avoid terrain shadow' : 'little shadow at this hour')}</div>
          <div><span class="plan-h">YOU CARRY</span>${pick('loadKg', P.loads, 'LOAD')}<span class="plan-h">YOU LEAVE AT</span>${pick('depart', P.departs, 'HOUR')}</div>
          <div class="plan-bar" aria-hidden="true"><i></i></div>
        </div>
        <table class="plan-t plan-c"><tr><th>THE SAME WALK, THREE WAYS</th><th>GROUND</th><th>WALK</th><th>OXYGEN</th><th>STEEP</th>${showShade ? '<th>SHADOW</th>' : ''}${showSun ? '<th>SUN LINE</th>' : ''}</tr>${cmp}</table>
        <p class="plan-note">${KD.model}Walking only, with the same oxygen model and load in every row. STEEP: metres on ground above ${steep}°.${showSun ? ` SUN LINE: metres walked toward a sun lower than ${P.sunLowDeg}° · metres walked straight away from it.` : ''}</p>
        <table class="plan-t"><tr><th>LEG</th><th>GROUND</th><th>WALK</th><th>WORK</th><th>OXYGEN</th></tr>${rows}
          <tr class="sum"><td><b>THE WHOLE WALK</b></td><td>${Math.round(P.rows.reduce((a, r) => a + r.pathM, 0))} m</td><td>${min(P.rows.reduce((a, r) => a + r.sec, 0))} min</td><td>${P.rows.reduce((a, r) => a + r.workMin, 0)} min</td><td>${useG} g</td></tr></table>
        <div class="plan-sum">
          <div><span>${KD.model}CLOCK</span><b>${min(P.sec)} min</b><small>of ${limitMin} min before the ${P.reserveMin} min reserve</small></div>
          <div><span>${KD.model}OXYGEN</span><b>${useG} g</b><small>of ${haveG} g before the reserve</small></div>
          <div><span>${KD.model}FINISH PLAN</span><b>${Math.round(P.conf * 100)} %</b><small>of 1,000 simulated walks</small></div>
        </div>
        <p class="plan-note">${KD.simulated}Assumed: ${P.limitH} h outside at most, ${P.reserveMin} min kept in reserve, ${P.rows[0].workMin} min of work at each station, ${P.walkKmh} km/h on flat ground. How much a factor counts is our setting: a step on steep ground counts ×${P.weight.steep}, a step in shadow +${Math.round(P.weight.shade * 100)} %.</p>
      </div></div>`;
  }
  // A click on a choice of the plan screen: plan again, put the walk back at the habitat, draw again.
  function wirePlan() {
    coach.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.opt, seg = b.dataset.val !== undefined;
      if (coach.classList.contains('busy') || (seg && b.classList.contains('on'))) return;
      const val = !seg ? !b.classList.contains('on') : key === 'loadKg' ? Number(b.dataset.val) : b.dataset.val;
      // The choice shows on its button at once, and a moving bar says that the route is planned again.
      // Before 2026-11-15 20:40 the whole screen dimmed and stood still for half a second with the old
      // choice still marked, which read as a stutter (owner).
      if (seg) b.parentElement.querySelectorAll('button').forEach((q) => q.classList.toggle('on', q === b));
      else { b.classList.toggle('on', val); b.setAttribute('aria-pressed', String(val)); }
      coach.classList.add('busy');
      const cells = () => [...coach.querySelectorAll('.plan-grid td, .plan-grid .plan-sum b, .plan-grid .plan-day')];
      const before = cells().map((q) => q.textContent), body = coach.querySelector('.body'), top = body ? body.scrollTop : 0, t0 = performance.now();
      let ran = false;
      const plan = () => {
        if (ran) return; ran = true;
        api.setPlan({ [key]: val }); api.jumpTo(STEPS[step] && STEPS[step].plan ? STEPS[step].jump : { s: 2 });
        const html = planHtml();
        // The bar stays for at least 0.4 s, so a fast search does not blink. Then the numbers that changed light up once.
        setTimeout(() => {
          const grid = coach.querySelector('.plan-grid');
          if (grid) {
            grid.outerHTML = html; wirePlan(); fadeBody(); if (body) body.scrollTop = top;
            const after = cells();
            if (after.length === before.length) after.forEach((q, i) => { if (q.textContent !== before[i]) q.classList.add('chg'); });
          }
          coach.classList.remove('busy'); done.add('plan');
        }, Math.max(0, 400 - (performance.now() - t0)));
      };
      // Two frames, so the button and the bar are on screen before the search takes the main thread (about half a second).
      requestAnimationFrame(() => requestAnimationFrame(plan)); setTimeout(plan, 200);
    }));
  }
  const fadeBody = () => { const b = coach.querySelector('.body'); if (b) b.classList.toggle('more', b.scrollHeight - b.scrollTop - b.clientHeight > 6); };
  addEventListener('resize', fadeBody);
  function showStep(k) {
    step = k; stepAt = performance.now(); passed = false; done.clear(); openExplain(null);
    if (k >= STEPS.length) return finishTraining();
    const st = STEPS[k];
    api.jumpTo(typeof st.jump === 'function' ? (api.jumpTo({ s: 2 }), st.jump(api)) : st.jump);
    document.body.classList.remove('cut'); void document.body.offsetWidth; document.body.classList.add('cut');
    spot(st.spot);
    coach.hidden = false; coach.classList.toggle('plan', !!st.plan); document.body.classList.toggle('planning', !!st.plan);
    coach.dataset.spot = st.spot || '';   // a phone puts the card at the top when the step is about something low on the screen
    coach.innerHTML = `<header><span class="badge">GUIDED TOUR</span><span class="pips">${STEPS.map((q, i) => `<i class="${i < k ? 'past' : i === k ? 'now' : ''}" data-step="${i}" role="button" title="${i + 1} · ${q.title}"></i>`).join('')}</span><span class="count"><button class="pg" data-step="${k - 1}" aria-label="Previous step" title="Previous step"${k === 0 ? ' disabled' : ''}>‹</button>${k + 1} / ${STEPS.length}<button class="pg" data-step="${k + 1}" aria-label="Next step" title="Next step">›</button></span><button class="coach-x" aria-label="Close the guided tour" title="Close the guided tour (Esc)">×</button></header>
      <div class="body"><h2>${st.title}</h2><p>${st.body}</p>${st.plan ? planHtml() : ''}
      ${st.why ? `<details class="why"${PHONE ? '' : ' open'}><summary>HOW WE KNOW</summary>${st.why.html ? st.why.html : ''}${st.why.fig ? `<img src="${import.meta.env.BASE_URL}figs/${st.why.fig}" alt="">` : ''}<p>${st.why.text}</p></details>` : ''}</div>
      ${st.task ? `<div class="task"${PHONE && st.task[0] ? ' role="button" tabindex="0"' : ''}>${st.task[0] ? `<kbd>${PHONE ? 'TAP' : st.task[0]}</kbd>` : ''}<span>${PHONE && TAP_TASK[st.task[0]] ? (st.station ? 'Tap to walk to the station, then choose' : TAP_TASK[st.task[0]][1]) : st.task[1]}</span><b class="tick">✓</b></div>` : ''}
      <footer><button class="ghost" data-go="-1"${k === 0 ? ' disabled' : ''}>BACK</button><button class="go${st.goal ? ' wait' : ''}" data-go="1"${st.goal ? ' aria-disabled="true" title="Do the task above first, or wait a few seconds"' : ''}>${k === STEPS.length - 1 ? 'FINISH' : st.plan && outCine ? 'NEXT · GO OUTSIDE' : 'NEXT'}</button></footer>`;
    coach.querySelector('.coach-x').addEventListener('click', closeTour);
    // The marks and the two arrows at the top of the card go straight to a step, without waiting for its task (owner, 2026-11-15: "how do I see the next page").
    coach.querySelectorAll('header [data-step]').forEach((b) => b.addEventListener('click', () => { const to = Number(b.dataset.step); if (to !== step && to >= 0) { stopDemo(); showStep(to); } }));
    if (st.plan) wirePlan();
    // On a phone there is no keyboard: the task row itself is the key (W starts the auto walk).
    if (PHONE && st.task && TAP_TASK[st.task[0]]) coach.querySelector('.task').addEventListener('click', () => { const code = TAP_TASK[st.task[0]][0]; if (code === 'KeyP' && api.state.auto) return; api.press(code); });
    // The text of a step fades at its lower edge while more follows below it.
    const body = coach.querySelector('.body');
    body.addEventListener('scroll', fadeBody, { passive: true });
    body.querySelectorAll('img').forEach((im) => im.addEventListener('load', fadeBody));
    body.querySelector('details')?.addEventListener('toggle', fadeBody);
    requestAnimationFrame(fadeBody); setTimeout(fadeBody, 450);
    coach.querySelectorAll('footer button').forEach((b) => b.addEventListener('click', () => {
      // NEXT while the task waits: the task row moves once, so the click is answered and says what is missing.
      if (b.classList.contains('wait')) { const t = coach.querySelector('.task'); if (t) { t.classList.remove('nudge'); void t.offsetWidth; t.classList.add('nudge'); } return; }
      const out = st.plan && outCine && b.dataset.go === '1' && params.get('cine') !== '0';
      stopDemo(); showStep(step + Number(b.dataset.go));
      // From the plan to the ground: the descent plays while the walk loads behind it (owner, 2026-11-15: it stays, as the cut between the two).
      if (out) api.cine({ caption: arrivalCaption(api.site, 'GOING OUT'), onLand: land }).then(() => { stepAt = performance.now(); });
    }));
  }
  // The card is emptied when the tour ends: a hidden card that still held an open "how we know" kept
  // the left panels hidden in the free walk after the tour (owner's test of 2026-11-15).
  function leaveTour() { step = -1; spot(null); coach.hidden = true; coach.innerHTML = ''; coach.classList.remove('plan', 'auto'); document.body.classList.remove('planning'); }
  // The cross of the tour card, Escape, or a click beside the plan screen: the tour ends there and
  // the free walk starts at the habitat (owner, 2026-11-15: the only way out of the card was a
  // button that went on with the tour).
  function closeTour() {
    if (step < 0 || document.body.classList.contains('cine')) return;
    stopDemo(); leaveTour(); openExplain(null); api.jumpTo({ s: 2 }); intro.hidden = true;
  }
  document.getElementById('scene').addEventListener('click', () => { if (step >= 0 && STEPS[step] && STEPS[step].plan) closeTour(); });
  // The descent between the plan and the walk plays when the tour starts from the start screen. A tour
  // opened during a walk (key ? or the button of the key bar) turns its pages without it.
  let outCine = true;
  function startTraining(k = 0, cineOut = true) { stopDemo(); intro.hidden = true; outCine = cineOut; showStep(k); }
  // The demo plays the tour by itself: each step shows, does its own task, opens "how we
  // know", and moves on. About a minute. Any button of the card takes over.
  let demo = null;
  function stopDemo() { if (demo) { demo.timers.forEach(clearTimeout); demo = null; coach.classList.remove('auto'); } }
  function playStep() {
    if (!demo) return;
    if (demo.k >= STEPS.length) { stopDemo(); return finishTraining(); }
    const st = STEPS[demo.k];
    showStep(demo.k); coach.classList.add('auto');
    const act = () => {
      const key = st.task && st.task[0];
      if (key === 'W' && st.station) {
        // Walk until the station card opens, show it for a few seconds, then do the planned work.
        api.hold('KeyW', true); let seen = false;
        const poll = setInterval(() => {
          if (!demo || seen || !visit.open()) return;
          seen = true; clearInterval(poll); api.hold('KeyW', false); demo.timers.push(setTimeout(() => visit.choose('work'), 4200));
        }, 200);
        demo.timers.push(poll, setTimeout(() => api.hold('KeyW', false), 9000));
      } else if (key === 'W') { api.hold('KeyW', true); done.add('KeyW'); demo.timers.push(setTimeout(() => api.hold('KeyW', false), 3200)); }
      else if (key) api.press(`Key${key}`);
      else if (st.task) { done.add('layer'); openExplain('radiation'); }
    };
    demo.timers = [setTimeout(act, 3200), setTimeout(() => { const d = coach.querySelector('details'); if (d) d.open = true; }, 6200),
      setTimeout(() => { demo.k += 1; playStep(); }, st.demoMs || (st.why && st.why.fig ? 13500 : 10000))];
  }
  function runDemo() { stopDemo(); intro.hidden = true; demo = { k: 0, timers: [] }; playStep(); }
  function finishTraining() {
    leaveTour(); trained = true;
    try { localStorage.setItem('mm.trained', '1'); } catch { /* private window */ }
    showBriefing(true);
  }

  // ----- Briefing (start screen) and scenarios -----
  const intro = document.getElementById('intro');
  // The stop at a station. Its card opens in the free walk, and in the tour only in the step about it.
  const visit = setupVisit(api, { allow: () => intro.hidden && !document.body.classList.contains('cine') && (step < 0 || !!(STEPS[step] && STEPS[step].station)) });
  function showBriefing(cleared = false, fromWalk = false) {
    if (cleared) trained = true;
    intro.hidden = false;
    intro.querySelector('.intro-card').innerHTML = `
      <p class="intro-brand">SteadFast${cleared ? '<span>TOUR COMPLETE</span>' : ''}</p>
      <h1>${cleared ? 'You have seen the whole display.' : 'A helmet display for an astronaut walking on Mars.'}</h1>
      ${cleared ? '<p><b>Now walk it yourself.</b> The plan is the one you saw: three stations in the boxwork and the way home, with EV2 at your side. At each station the display shows why the Curiosity team looked there and what each choice leaves for the way home. Nothing is timed and nothing is scored.</p>'
    // Shortened on 2026-11-15 to the words of the deck and the project page (owner: the start screen said too much).
    : '<p>An answer from Earth takes 40 minutes, so on a walk outside the astronaut decides alone. From the data it carries, the display answers three questions: <b>which way</b>, <b>how much time and oxygen are left</b>, and <b>when to turn back</b>.</p><p>The walk crosses real NASA terrain in Gale crater, to three spots where Curiosity photographed the boxwork ridges in 2025.</p>'}
      <div class="intro-actions">
        ${trained ? '<button class="go" data-do="free">' + (fromWalk ? 'BACK TO THE WALK' : 'FREE WALK') + '</button><button class="ghost" data-do="train">GUIDED TOUR AGAIN</button>'
    : `<button class="go" data-do="train">START THE GUIDED TOUR · ${STEPS.length} STEPS</button>${fromWalk ? '<button class="ghost" data-do="free">BACK TO THE WALK</button>' : ''}`}
      </div>
      ${trained ? `<p class="intro-kicker">OR START IN A SCENARIO</p><div class="scen">${SCENARIOS.map((s, i) => `<button data-scen="${i}"><b>${s.name}</b><span>${s.note}</span></button>`).join('')}</div>` : ''}
      <p class="intro-small">A simulation of the view through a helmet display, in a browser. Simulated: the clock, the oxygen supply, sky and light, the glow of the particle event, and every sound${PHONE ? '' : ' (key N switches it off)'}. Made with AI tools. The second astronaut's figure is AI-generated.</p>`;
    intro.querySelectorAll('[data-do]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.do === 'train') startTraining(0);
      else { if (!fromWalk) api.jumpTo({ s: 2 }); intro.hidden = true; }   // a free walk starts at the habitat, not where the last tour step stood
    }));
    intro.querySelectorAll('[data-scen]').forEach((b) => b.addEventListener('click', () => {
      const sc = SCENARIOS[Number(b.dataset.scen)];
      intro.hidden = true; api.jumpTo(sc.jump);
      if (sc.then) setTimeout(() => api.press(sc.then), 1200);
    }));
  }
  // Arriving from the world map (world.js sets the flag before the page loads again), or ?cine=1.
  let arrived = params.get('cine') === '1';
  try { if (sessionStorage.getItem('mm.arrive') === '1') { arrived = true; sessionStorage.removeItem('mm.arrive'); } } catch { /* private window */ }
  if (arrived) setTimeout(() => api.cine({ caption: arrivalCaption(api.site, 'ARRIVING'), onLand: land }), 300);
  if (params.get('demo') === '1') runDemo();
  else if (params.get('tour') !== null) showStep(Math.min(STEPS.length - 1, Math.max(0, (parseInt(params.get('tour'), 10) || 1) - 1)));
  else if (plain || params.get('intro') === '1') showBriefing(params.get('cleared') === '1');
  if (LAYERS.some((l) => l.id === params.get('explain'))) openExplain(params.get('explain'));

  // ----- The curves -----
  function curve(cv, pts, t, color, t0, t1, log = false) {
    const ctx = cv.getContext('2d'), w = cv.width, hh = cv.height;
    ctx.clearRect(0, 0, w, hh);
    const f = (v) => (log ? Math.log(v) : v);
    const inR = pts.filter((p) => p[0] >= t0 && p[0] <= t1);
    if (inR.length < 2) return;
    const lo = Math.min(...inR.map((p) => f(p[1]))), hi = Math.max(...inR.map((p) => f(p[1])));
    const X = (x) => (x - t0) / (t1 - t0) * w, Y = (v) => hh - 3 - (f(v) - lo) / Math.max(1e-6, hi - lo) * (hh - 6);
    ctx.lineWidth = 1.5; ctx.strokeStyle = color; ctx.globalAlpha = 0.35;
    ctx.beginPath(); inR.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])))); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = 2;
    ctx.beginPath(); let last = null;
    inR.filter((p) => p[0] <= t).forEach((p, i) => { if (i) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1])); last = p; });
    ctx.stroke();
    if (last) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(Math.min(t, t1)), Y(last[1]), 3, 0, 6.3); ctx.fill(); }
  }
  let stripAt = -1;
  function liveStrip(cv, r, color) {
    const ctx = cv.getContext('2d'), w = cv.width, hh = cv.height, span = 3.4 * flickerShare();
    ctx.clearRect(0, 0, w, hh);
    const X = (i) => w - 5 - (r.length - 1 - i) * (w - 9) / 39, Y = (q) => hh / 2 - (q - 1) / span * (hh / 2 - 3);
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = 0.4; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, hh / 2); ctx.lineTo(w, hh / 2); ctx.stroke(); ctx.setLineDash([]);
    if (!r.length) return;
    ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    ctx.beginPath(); r.forEach((q, i) => (i ? ctx.lineTo(X(i), Y(q)) : ctx.moveTo(X(i), Y(q)))); ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(r.length - 1), Y(r[r.length - 1]), 2.6, 0, 6.3); ctx.fill();
  }

  // ----- Goggles: two false-colour views of the scene (key X). Both are simulated looks. -----
  // INFRARED: the brightness of the drawn image in a heat palette. It is not a temperature: the
  // line over the view gives the measured ground and air temperature of REMS for that minute.
  // RADIATION: the image in one colour, with flashes whose number per second follows the RAD
  // reading (3 per second for each µGy/h, at most 500). A flash is drawn, not a counted particle.
  const GOGGLES = [null, 'ir', 'rad'];
  let goggle = Math.max(0, GOGGLES.indexOf(params.get('goggles')));
  const gogFx = h('div', { id: 'gogFx', hidden: '' }, '<canvas></canvas><p></p>');
  document.getElementById('scene').after(gogFx);
  const gogCv = gogFx.firstElementChild, gogTag = gogFx.lastElementChild, gogCtx = gogCv.getContext('2d');
  let gogSeed = 1, gogLast = 0, gogOwed = 0, gogText = '';
  const gogRnd = () => { gogSeed = gogSeed + 0x6D2B79F5 | 0; let t = Math.imul(gogSeed ^ gogSeed >>> 15, 1 | gogSeed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  function setGoggle(k) {
    goggle = k; gogSeed = FLICKER.seed; gogOwed = 0;
    document.body.classList.toggle('gog-ir', GOGGLES[k] === 'ir'); document.body.classList.toggle('gog-rad', GOGGLES[k] === 'rad');
    gogFx.hidden = !k; gogCtx.clearRect(0, 0, gogCv.width, gogCv.height);
  }
  addEventListener('keydown', (e) => { if (e.code === 'KeyX' && !e.repeat && !e.ctrlKey && !e.metaKey && !api.world.open) setGoggle((goggle + 1) % GOGGLES.length); });
  if (goggle) setGoggle(goggle);
  function goggleTick(s, e, now) {
    if (!goggle) return;
    const dt = Math.min(0.1, (now - gogLast) / 1000); gogLast = now;
    const kelvin = (q) => (q && Number.isFinite(q.v) ? `${c(q.v)} °C` : '--');
    const text = GOGGLES[goggle] === 'ir'
      ? `<b>INFRARED VIEW · SIMULATED</b>Image brightness in false colour, not a temperature. REMS at the rover: ground ${kelvin(e.ground)}, air ${kelvin(e.air)}`
      : `<b>RADIATION VIEW · SIMULATED</b>Particles cannot be seen. Flashes per second follow the dose rate on the panel: ${fmtRate(s.radShown)} µGy/h`;
    if (text !== gogText) { gogText = text; gogTag.innerHTML = `${text}<small>X · NEXT VIEW</small>`; }
    if (GOGGLES[goggle] !== 'rad') return;
    const w = Math.round(innerWidth / 2), hh = Math.round(innerHeight / 2);
    if (gogCv.width !== w || gogCv.height !== hh) { gogCv.width = w; gogCv.height = hh; }
    // What was drawn fades, then the flashes of this frame.
    gogCtx.globalCompositeOperation = 'destination-out'; gogCtx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, dt * 3.5).toFixed(3)})`; gogCtx.fillRect(0, 0, w, hh);
    gogCtx.globalCompositeOperation = 'lighter';
    gogOwed += Math.min(500, s.radShown * 3) * dt;
    for (; gogOwed >= 1; gogOwed -= 1) {
      const x = gogRnd() * w, y = gogRnd() * hh, len = 2 + gogRnd() * gogRnd() * 22, a = gogRnd() * 6.283, r = 1.2 + gogRnd() * 1.8;
      gogCtx.strokeStyle = gogCtx.fillStyle = `rgba(215, 255, 235, ${(0.7 + gogRnd() * 0.3).toFixed(2)})`; gogCtx.lineWidth = 1.2;
      gogCtx.beginPath(); gogCtx.moveTo(x, y); gogCtx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); gogCtx.stroke();
      gogCtx.beginPath(); gogCtx.arc(x, y, r, 0, 6.3); gogCtx.fill();
    }
  }

  const eventCurve = radCurve('event');
  const eventEnd = eventCurve[eventCurve.length - 1][0];
  window.__env = { series: Object.fromEntries(['air_k', 'ground_k', 'pressure_pa', 'uv_abc'].map((k) => [k, envSeries(k).length])) };

  // ----- Frames on the ground around the two patches where the ground types are known -----
  for (const p of api.patches) {
    const pts = [], n = Math.round(2 * p.half_m);
    const edge = (k) => { const u = -p.half_m + (k % n) * (2 * p.half_m / n), side = Math.floor(k / n);
      return side === 0 ? [u, -p.half_m] : side === 1 ? [p.half_m, u] : side === 2 ? [-u, p.half_m] : [-p.half_m, -u]; };
    for (let k = 0; k <= 4 * n; k++) { const [dx, dz] = edge(k % (4 * n)); pts.push(new THREE.Vector3(p.x + dx, api.heightAt(p.x + dx, p.z + dz) + 0.12, p.z + dz)); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: '#7dffb2', dashSize: 0.9, gapSize: 0.6, transparent: true, opacity: 0.85 }));
    line.computeLineDistances(); line.renderOrder = 3;
    api.scene.add(line);
  }

  // ----- Storm look of the scene -----
  const fogBase = api.scene.fog.color.clone(), fogStorm = new THREE.Color('#8f4a66');
  const hemiBase = api.hemi.color.clone(), hemiStorm = new THREE.Color('#d98aa6');
  let stormK = 0;

  const $ = (id) => document.getElementById(id);
  let lastLegend = '';
  function tick(ts) {
    const s = api.snapshot(), e = envNow(s.elapsed), now = performance.now();
    // The dose rate of this frame, as main.js draws it on the panel row (rad.js radShownAt).
    s.radShown = radShownAt(s.rad.rate, ts);
    // The day.
    $('dayClock').textContent = `${e.lmst} LOCAL`;
    const [lm, ls] = minSec(e.lightMin);
    $('tLink').innerHTML = `${lm}<small> min </small>${String(ls).padStart(2, '0')}<small> s</small>`;
    // The small line of the dose rate. With the flicker on (rad.js) it is a strip of the last 18 s of
    // the number on the panel around the reading in force, which is the dashed line. Without it, the readings of the sol.
    if (FLICKER.on) {
      const tk = Math.floor(ts / FLICKER.stepMs);
      if (tk !== stripAt && s.rad.rate > 0) { stripAt = tk; liveStrip($('tDose'), Array.from({ length: 40 }, (_, i) => radFlicker(s.rad.rate, tk - 39 + i) / s.rad.rate), s.alarm ? '#ff7aa8' : '#7dffb2'); }
    } else curve($('tDose'), radCurve('quiet'), s.elapsed, '#7dffb2', 0, 8 * 3600);
    goggleTick(s, e, now);
    $('dayMini').innerHTML = `${KD.measured}DOSE <b>${fmtRate(s.radShown)} µGy/h</b> · ${KD.computed}EARTH <b>${lm} min</b>`;
    visit.tick(s, now);
    if (visit.last() && step >= 0 && STEPS[step] && STEPS[step].station) done.add('visit');
    const focus = focusPref && canFold();
    document.body.classList.toggle('focus', focus);
    foldHint.lastChild.textContent = focusPref ? 'SHOW EVERY READING' : 'FOLD THE PANELS';
    foldHint.classList.toggle('seen', foldSeen);
    // Ground legend: the four types with their cost, the one under the boots marked.
    const key = `${s.ground}|${s.classLabels}|${!!s.patch}`;
    if (key !== lastLegend) {
      lastLegend = key;
      legend.innerHTML = `<div class="leg-head"><b>GROUND TYPE</b><span>${s.patch ? `CLASSIFIED PATCH · ${s.patch.name}` : 'NOT CLASSIFIED HERE'}</span></div>`
        + (s.patch ? GROUND.map(([n, col], i) => `<div class="leg-row${i === s.ground ? ' here' : ''}"><i style="background:${col}"></i><span>${n}</span><b>×${s.eta[i].toFixed(1)}</b></div>`).join('')
          + `<div class="src"><i class="leg-frame"></i>FRAME: CLASSIFIED PATCH · ×: O₂ PER STEP</div>`
          : `<div class="leg-row here plain"><i style="background:#9aa4a8"></i><span>ASSUMED ROCKY</span><b>×${s.etaDefault.toFixed(1)}</b></div><div class="src"><i class="leg-frame"></i>${api.site.main ? 'TYPES KNOWN INSIDE THE FRAMES AT HAB AND STN A' : 'NO GROUND TYPES AT THIS PLACE · ORBITAL GROUND ONLY'}</div>`);
    }
    // Dock: which toggles are on.
    for (const b of dock.children) {
      if (b.dataset.code === 'Tab') b.classList.toggle('na', !canFold());
      const on = { KeyP: s.auto, KeyR: s.rad.replay, KeyC: s.classLabels, KeyM: api.world.open, KeyL: api.minimap.layer === 'geology', KeyV: state.lookDown, KeyX: goggle > 0, KeyE: s.ev2Raised, KeyG: s.agentShown, Tab: !document.body.classList.contains('focus') }[b.dataset.code];
      if (on !== undefined) b.classList.toggle('on', !!on);
    }
    // Explanation: the live line.
    if (explainId) { const l = LAYERS.find((q) => q.id === explainId), el = $('explainLive'); if (el) el.textContent = l.live ? l.live(s, e) : ''; }
    // Storm: strength follows the measured rate, on a log scale between the background and the peak.
    const target = s.rad.replay && s.alarm ? Math.max(0.25, Math.min(1, Math.log(s.rad.rate / s.rad.quiet) / Math.log(s.rad.peak / s.rad.quiet))) : 0;
    stormK += (target - stormK) * 0.06;
    document.body.classList.toggle('storming', stormK > 0.02);
    fx.style.setProperty('--k', stormK.toFixed(3));
    api.scene.fog.color.copy(fogBase).lerp(fogStorm, stormK * 0.8);
    api.hemi.color.copy(hemiBase).lerp(hemiStorm, stormK * 0.8);
    storm.hidden = !(s.rad.replay && s.alarm) || !!explainId;
    if (!storm.hidden) {
      const x = s.radShown / s.rad.quiet;
      $('stormRate').textContent = fmtRate(s.radShown);
      $('stormX').textContent = `${x.toFixed(x < 10 ? 1 : 0)}× BACKGROUND · ${s.rad.utc} UTC`;
      // The reading itself goes on the source line, as under the panel row, so the line of the big number keeps its length.
      $('stormRead').textContent = FLICKER.on ? `RAD reading ${fmtRate(s.rad.rate)} µGy/h, the flicker around it is simulated. ` : '';
      curve($('stormCurve'), eventCurve, s.elapsed - state.alarm, '#ff8fb4', -3 * 3600, Math.min(eventEnd, 12 * 3600), true);
    }
    window.__game = { step, stormK: +stormK.toFixed(2), explain: explainId, lmst: e.lmst, airC: e.air && +(e.air.v - 273.15).toFixed(1), groundC: e.ground && +(e.ground.v - 273.15).toFixed(1), lightMin: +e.lightMin.toFixed(3) };
    // Tour: a task is met by doing it, or after 15 s (the station step: 40 s, the walk and the card need them).
    if (step >= 0 && step < STEPS.length && !passed) {
      const st = STEPS[step];
      if (st.goal && (st.goal(s, done) || now - stepAt > (st.station ? 40000 : 15000))) {
        passed = true;
        coach.querySelector('.task')?.classList.toggle('met', st.goal(s, done));
        const go = coach.querySelector('.go'); go.classList.remove('wait'); go.removeAttribute('aria-disabled'); go.removeAttribute('title');
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

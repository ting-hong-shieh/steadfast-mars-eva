// Written with an AI tool (Claude). See AI_USE.md.
// The world map: the whole of the Gale elevation mosaic on one screen, with the places the walk
// can start from. Key M, a click on the corner map, or the MAP button.
//
// What is what on this map (the legend on screen says the same):
//  - COMPUTED: the picture. Colour by height and shading from NASA's 1 m elevation mosaic
//    (tools/build_world_relief.py). The colour ramp is ours.
//  - MEASURED: Curiosity's path and the six stops, from MSL PLACES (tools/build_site_terrain.py),
//    and, zoomed in, the Mars Trek orbital images of the corner map.
//  - MAPPED: the USGS geologic units, the same layer as on the corner map. They are on when the
//    map opens, and the button at the top or key L hides them (owner, 2026-11-15).
//  - OURS: the short names of the places. At five of them the stops of the walk are imagined.
// Travel reloads the app at the chosen place (?site=<id>).
import { SITE } from './site.js';
import { surfaceLevels, geologyLevel, mapImage, geologyLegend } from './minimap.js';

const BASE = `${import.meta.env.BASE_URL}data/`;
let W = null, relief = null, path = null;

export async function loadWorld() {
  const [w, t] = await Promise.all([fetch(BASE + 'world.json').then((r) => r.json()), fetch(BASE + 'traverse.json').then((r) => r.json())]);
  W = w; path = t;
  relief = await new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => fail(new Error('world_relief.jpg')); im.src = BASE + w.image; });
}

const MEASURED = '#7dffb2', CYAN = '#7fe9ff', OURS = '#ffb347', TEXT = '#eafcff', INK = '#070b0f';
const FONT = '"Chakra Petch", sans-serif';
const km = (m) => (m >= 10000 ? `${(m / 1000).toFixed(0)} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const elev = (m) => `${m < 0 ? '−' : ''}${Math.abs(Math.round(m)).toLocaleString('en-US')} m`;

export function setupWorld({ state, minimap }) {
  const root = document.createElement('section');
  root.id = 'world'; root.hidden = true; root.setAttribute('aria-label', 'World map of Gale crater');
  root.innerHTML = `
    <canvas></canvas>
    <header class="w-head"><span class="w-kicker">WORLD MAP</span><h1>GALE CRATER</h1>
      <p>Six places on Curiosity's real path. Pick one and travel there.</p></header>
    <aside class="w-card panel"></aside>
    <div class="w-legend">
      <div><i class="k-line" style="background:${MEASURED}"></i><b>MEASURED</b> Curiosity's path and stops · NASA PDS</div>
      <div><i class="k-ramp"></i><b>COMPUTED</b> height and shading · NASA 1 m elevation model</div>
      <div class="w-geo" hidden><i class="k-box"></i><b>MAPPED</b> <span></span></div>
      <div><i class="k-dot" style="background:${OURS}"></i><b>OURS</b> place names · imagined stops at five places</div>
    </div>
    <div class="w-ramp"><span></span><i></i><span></span></div>
    <div class="w-keys"><span><kbd>DRAG</kbd> move</span><span><kbd>WHEEL</kbd> zoom</span><span><kbd>M</kbd> close</span></div>
    <button class="w-layer" type="button" aria-pressed="true"><kbd>L</kbd><span></span></button>
    <button class="w-close" aria-label="Close the map">×</button>
    <div class="w-travel" hidden><span>TRAVEL</span><b></b></div>`;
  document.body.appendChild(root);
  const cv = root.querySelector('canvas'), card = root.querySelector('.w-card');
  const rampEl = root.querySelector('.w-ramp');
  rampEl.children[0].textContent = elev(W.height_m.low);
  rampEl.children[2].textContent = elev(W.height_m.high);
  rampEl.children[1].style.background = `linear-gradient(90deg, ${W.ramp.map((r) => `rgb(${r.rgb.join(",")}) ${r.at * r.at * 100}%`).join(', ')})`;

  const sites = SITE.all;
  const view = { x: 0, z: 0, mpp: 20 };       // app metres at the centre of the canvas, metres per CSS pixel
  let selected = SITE.id, hover = null, open = false, raf = 0, drag = null, moved = 0;

  const here = () => ({ x: SITE.x + state.pos.x, z: SITE.z + state.pos.z });
  function fit() {
    const xs = path.points.map((p) => p[0]), zs = path.points.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const w = cv.clientWidth, h = cv.clientHeight;
    // Leave room for the card on the right and the title on the left.
    view.mpp = Math.max((x1 - x0) / (w * 0.34), (z1 - z0) / (h * 0.66));
    view.x = (x0 + x1) / 2 + view.mpp * w * 0.03; view.z = (z0 + z1) / 2 + view.mpp * h * 0.01;
  }
  const toScreen = (x, z) => [cv.clientWidth / 2 + (x - view.x) / view.mpp, cv.clientHeight / 2 + (z - view.z) / view.mpp];
  const toWorld = (sx, sy) => [view.x + (sx - cv.clientWidth / 2) * view.mpp, view.z + (sy - cv.clientHeight / 2) * view.mpp];

  function showCard() {
    const s = sites.find((q) => q.id === selected);
    const cur = s.id === SITE.id;
    const h = here(), d = Math.hypot(s.x - h.x, s.z - h.z);
    const img = s.main ? `${BASE}orbital_ortho.jpg` : `${BASE}sites/${s.id}/orbital_ortho.jpg`;
    card.innerHTML = `
      <header><span class="w-stop">CURIOSITY STOP · SOL ${s.sol} · MEASURED</span>${cur ? '<span class="w-here">YOU ARE HERE</span>' : ''}</header>
      <h2>${s.name}<small>OUR NAME</small></h2>
      <figure><img src="${img}" alt="Orbital image of the 600 m square around the stop"><figcaption>ORBITAL IMAGE · 600 M SQUARE · MEASURED</figcaption></figure>
      <p>${s.blurb}</p>
      <dl>
        <div><dt>HEIGHT</dt><dd>${elev(s.elevation_m)}</dd></div>
        ${s.relief_m ? `<div><dt>HIGH TO LOW IN THE SQUARE</dt><dd>${Math.round(s.relief_m)} m</dd></div>` : ''}
        <div><dt>${cur ? 'FROM THE STOP' : 'FROM YOU'}</dt><dd>${km(d)}</dd></div>
        <div><dt>GROUND</dt><dd>${s.main ? 'Orbital 1 m + rover camera 5 cm' : 'Orbital 1 m only'}</dd></div>
        <div><dt>STOPS OF THE WALK</dt><dd class="${s.main ? '' : 'ours'}">${s.main ? '3 Mastcam targets' : '3 imagined'}</dd></div>
      </dl>
      <button class="w-go"${cur ? ' disabled' : ''}>${cur ? 'YOU ARE HERE' : `TRAVEL TO ${s.name}`}</button>
      ${cur ? '' : '<p class="w-note">The weather, the dose and the clock stay those of sol 4709 at the rover.</p>'}`;
    card.dataset.kind = s.main ? 'measured' : 'simulated';
    card.querySelector('.w-go').addEventListener('click', () => travel(s));
  }
  function travel(s) {
    if (s.id === SITE.id) return;
    const t = root.querySelector('.w-travel');
    t.querySelector('b').textContent = s.name; t.hidden = false;
    try { sessionStorage.setItem('mm.arrive', '1'); } catch { /* private window */ }
    setTimeout(() => { location.search = `?site=${s.id}`; }, 650);
  }

  function nodeAt(sx, sy) {
    let best = null, bd = 22;
    for (const s of sites) { const [x, y] = toScreen(s.x, s.z); const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = s.id; } }
    return best;
  }

  function draw(now) {
    raf = open ? requestAnimationFrame(draw) : 0;
    const dpr = Math.min(devicePixelRatio, 2), w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = INK; ctx.fillRect(0, 0, w, h);
    const im = (img, a, alpha = 1, op = 'source-over') => {
      const [x0, y0] = toScreen(a.x_min, a.z_min), [x1, y1] = toScreen(a.x_max, a.z_max);
      ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0); ctx.restore();
    };
    im(relief, W.app_m);
    // Zoomed in past the cell size of the relief: the orbital images of the corner map, as light and shade.
    if (view.mpp < 14) {
      const lv = surfaceLevels().filter((l) => l.m_per_px <= Math.max(view.mpp * 1.5, 5.1)).sort((a, b) => b.m_per_px - a.m_per_px)[0];
      if (lv) im(mapImage(lv), lv.app_m, Math.min(0.85, (14 - view.mpp) / 8), 'luminosity');
    }
    const geo = minimap.layer === 'geology';
    if (geo) { const g = geologyLevel(); im(mapImage(g), g.app_m, 0.42, 'color'); }

    // A 5 km grid, so distances read without the scale bar.
    const step = view.mpp > 60 ? 10000 : view.mpp > 12 ? 5000 : 1000;
    ctx.strokeStyle = 'rgba(234,252,255,0.07)'; ctx.lineWidth = 1; ctx.beginPath();
    const [wx0, wz0] = toWorld(0, 0), [wx1, wz1] = toWorld(w, h);
    for (let x = Math.ceil(wx0 / step) * step; x < wx1; x += step) { const sx = Math.round(toScreen(x, 0)[0]) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, h); }
    for (let z = Math.ceil(wz0 / step) * step; z < wz1; z += step) { const sy = Math.round(toScreen(0, z)[1]) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(w, sy); }
    ctx.stroke();

    // Curiosity's path: a dark bed, the line, and a light that runs along it from the landing.
    const pts = path.points.map((p) => toScreen(p[0], p[1]));
    const stroke = (color, width, alpha) => {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.restore();
    };
    stroke(INK, 6, 0.55); stroke(MEASURED, 1.8, 0.95);
    const runner = ((now / 9000) % 1) * (pts.length - 1), ri = Math.floor(runner), rf = runner - ri;
    if (pts[ri + 1]) {
      const rx = pts[ri][0] + (pts[ri + 1][0] - pts[ri][0]) * rf, ry = pts[ri][1] + (pts[ri + 1][1] - pts[ri][1]) * rf;
      const g = ctx.createRadialGradient(rx, ry, 0, rx, ry, 16);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.25, 'rgba(125,255,178,0.55)'); g.addColorStop(1, 'rgba(125,255,178,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(rx, ry, 16, 0, Math.PI * 2); ctx.fill();
    }
    // Sol marks along the path, every 1,000 sols.
    ctx.font = `500 10px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let nextSol = 1000;
    path.points.forEach((p, i) => {
      if (p[2] < nextSol) return;
      const [x, y] = pts[i];
      // No mark where a place's name plate sits.
      if (sites.some((q) => { const [qx, qy] = toScreen(q.x, q.z); return Math.abs(qy - y) < 26 && x > qx - 170 && x < qx + 90; })) { nextSol += 1000; return; }
      ctx.fillStyle = MEASURED; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(234,252,255,0.62)'; ctx.fillText(`SOL ${nextSol.toLocaleString('en-US')}`, x + 8, y);
      nextSol += 1000;
    });

    // The places.
    const pulse = 0.5 + 0.5 * Math.sin(now / 420);
    for (const s of sites) {
      const [x, y] = toScreen(s.x, s.z);
      const cur = s.id === SITE.id, sel = s.id === selected, hov = s.id === hover;
      const r = sel || hov ? 10 : 8;
      if (cur) { ctx.strokeStyle = CYAN; ctx.globalAlpha = 0.75 - 0.6 * pulse; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 14 + 14 * pulse, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 8;
      ctx.fillStyle = cur ? CYAN : sel ? TEXT : INK; ctx.strokeStyle = cur ? CYAN : TEXT; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.rect(-r * 0.72, -r * 0.72, r * 1.44, r * 1.44); ctx.fill(); ctx.stroke();
      ctx.restore();
      if (sel) {
        // Corner brackets around the chosen place.
        const b = 20, a = 7; ctx.strokeStyle = TEXT; ctx.lineWidth = 1.5; ctx.beginPath();
        for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(x + dx * b, y + dy * (b - a)); ctx.lineTo(x + dx * b, y + dy * b); ctx.lineTo(x + dx * (b - a), y + dy * b); }
        ctx.stroke();
      }
      // Name plate, to the left of the node so it stays clear of the sol marks.
      ctx.font = `600 ${sel || hov ? 15 : 13}px ${FONT}`;
      const name = s.name, tw = ctx.measureText(name).width + (name.length - 1) * 1.4;
      const px = x - 30 - tw, py = y - 9;
      // The plate has round corners like the tags of the helmet view (a browser without roundRect draws it square).
      const plate = () => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(px - 8, py - 11, tw + 16, 34, 6); else ctx.rect(px - 8, py - 11, tw + 16, 34); };
      ctx.fillStyle = 'rgba(7,11,15,0.78)'; plate(); ctx.fill();
      ctx.fillStyle = cur ? CYAN : TEXT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      let cx = px; for (const ch of name) { ctx.fillText(ch, cx, py); cx += ctx.measureText(ch).width + 1.4; }
      ctx.font = `500 9px ${FONT}`; ctx.fillStyle = 'rgba(234,252,255,0.62)';
      ctx.fillText(cur ? 'YOU ARE HERE' : `SOL ${s.sol}`, px, py + 14);
      ctx.save(); plate(); ctx.clip(); ctx.fillStyle = OURS; ctx.fillRect(px - 8, py - 11, 2, 34); ctx.restore();
    }
    // You: a small chevron at your position when zoomed in enough to tell it from the stop.
    const hp = here(), [hx, hy] = toScreen(hp.x, hp.z), [sx0, sy0] = toScreen(SITE.x, SITE.z);
    if (Math.hypot(hx - sx0, hy - sy0) > 16) {
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(state.heading + (state.yawOffset || 0));
      ctx.fillStyle = CYAN; ctx.strokeStyle = INK; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }

    // Scale bar, bottom centre.
    const bars = [100, 200, 500, 1000, 2000, 5000, 10000, 20000], bar = bars.find((b) => b / view.mpp >= 90) || 20000;
    const bw = bar / view.mpp, bx = w / 2 - bw / 2, by = h - 34;
    ctx.strokeStyle = TEXT; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by - 5); ctx.stroke();
    ctx.fillStyle = TEXT; ctx.font = `500 11px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(km(bar), w / 2, by - 12);

    const g = root.querySelector('.w-geo');
    if (g.hidden === geo) {
      g.hidden = !geo;
      layerBtn.setAttribute('aria-pressed', String(geo));
      layerBtn.lastChild.textContent = geo ? 'GEOLOGIC MAP ON · HIDE' : 'SHOW THE GEOLOGIC MAP';
      const lg = geologyLegend();
      g.querySelector('span').textContent = `geologic units · USGS SIM 3292 (1 : 20,000,000) · here: ${lg.here.unit}, ${lg.here.desc}`;
    }
  }

  // The geologic units are on whenever the map opens. The corner map gets its own layer back when the map closes.
  const layerBtn = root.querySelector('.w-layer');
  layerBtn.lastChild.textContent = 'GEOLOGIC MAP ON · HIDE';
  layerBtn.addEventListener('click', () => { minimap.toggleLayer(); layerBtn.blur(); });
  let layerBefore = null;
  function setOpen(v) {
    if (open === v) return;
    open = v; root.hidden = !v; document.body.classList.toggle('world-open', v);
    if (v) { layerBefore = minimap.layer; if (minimap.layer !== 'geology') minimap.toggleLayer(); }
    else if (layerBefore && minimap.layer !== layerBefore) minimap.toggleLayer();
    if (v) { selected = SITE.id; fit(); showCard(); if (!raf) raf = requestAnimationFrame(draw); }
  }
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [wx, wz] = toWorld(e.offsetX, e.offsetY);
    view.mpp = Math.max(1.5, Math.min(70, view.mpp * (e.deltaY > 0 ? 1.18 : 1 / 1.18)));
    view.x = wx - (e.offsetX - cv.clientWidth / 2) * view.mpp; view.z = wz - (e.offsetY - cv.clientHeight / 2) * view.mpp;
  }, { passive: false });
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.offsetX, y: e.offsetY }; moved = 0; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y; moved += Math.abs(dx) + Math.abs(dy);
      view.x -= dx * view.mpp; view.z -= dy * view.mpp; drag = { x: e.offsetX, y: e.offsetY };
      const a = W.app_m; view.x = Math.max(a.x_min, Math.min(a.x_max, view.x)); view.z = Math.max(a.z_min, Math.min(a.z_max, view.z));
    } else { hover = nodeAt(e.offsetX, e.offsetY); cv.style.cursor = hover ? 'pointer' : 'grab'; }
  });
  cv.addEventListener('pointerup', (e) => {
    if (moved < 5) { const n = nodeAt(e.offsetX, e.offsetY); if (n) { selected = n; showCard(); } }
    drag = null;
  });
  root.querySelector('.w-close').addEventListener('click', () => setOpen(false));
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !e.repeat) setOpen(!open);
    else if (e.code === 'Escape' && open) setOpen(false);
  });

  // A line at the top of the helmet view at the other places: what is real there and what is not.
  if (!SITE.main) {
    const chip = document.createElement('div');
    chip.id = 'siteChip';
    chip.innerHTML = `<b>${SITE.name}</b><span>CURIOSITY STOP · SOL ${SITE.sol}</span><span class="m">ORBITAL GROUND · MEASURED</span><span class="o">STOPS · IMAGINED</span>`;
    document.getElementById('hud').appendChild(chip);
  }
  const params = new URLSearchParams(location.search);
  if (params.get('world') !== null) { setOpen(true); if (params.get('world')) { const s = sites.find((q) => q.id === params.get('world')); if (s) { selected = s.id; showCard(); } } }
  window.__world = { sites: sites.map((s) => s.id), site: SITE.id };
  return { toggle: () => setOpen(!open), get open() { return open; } };
}

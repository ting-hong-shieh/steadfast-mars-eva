// Written with an AI tool (Claude). See AI_USE.md.
// The corner map. JPL Mars Trek tiles, fetched once by tools/fetch_trek_tiles.py and shipped with
// the app, so the map works without a network. docs/methods.md, row "Corner map".
//
// Small: heading up, 75 m to 1.5 km, HiRISE. Opened (M or a tap): larger, north up, 1 km to
// 40 km, HiRISE then CTX, with a solid ring for the small map's area and a dashed square for the
// 3D ground. L switches the surface image and the USGS SIM 3292 geologic map.

let meta = null;
const images = new Map();
let geoPixels = null;   // the geology image as RGBA, to tell which units are inside the circle
const K = 3396190 * Math.PI / 180;   // metres per degree, the frame of the tiles and the ground

export async function loadMinimap(base = `${import.meta.env.BASE_URL}data/`) {
  meta = await fetch(base + 'trek_tiles.json').then((r) => r.json());
  const all = Object.values(meta.layers).flatMap((l) => l.levels);
  // Where each layer really has data, in app metres (outside it the tiles are empty).
  for (const l of all) {
    const [w, s, e, n] = l.data_bbox_deg, o = meta.origin_deg;
    l.data_m = { x_min: (w - o.lon) * K, x_max: (e - o.lon) * K, z_min: -(n - o.lat) * K, z_max: -(s - o.lat) * K };
  }
  await Promise.all(all.map((l) => new Promise((ok, fail) => {
    const im = new Image();
    im.onload = () => { images.set(l.image, im); ok(); };
    im.onerror = () => fail(new Error(`map image ${l.image} did not load`));
    im.src = base + l.image;
  })));
  const g = meta.layers.geology.levels[0], im = images.get(g.image);
  const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
  const c2 = cv.getContext('2d', { willReadFrequently: true }); c2.drawImage(im, 0, 0);
  geoPixels = { data: c2.getImageData(0, 0, im.width, im.height).data, w: im.width, h: im.height, level: g };
}

// Geology units inside a circle around (px, pz): sample the geology image on a grid and match
// each colour to the nearest unit colour of the legend.
function unitsInside(px, pz, r) {
  const { data, w, h, level } = geoPixels, a = level.app_m;
  const units = meta.geology_legend.units.map((u) => ({ u, rgb: [1, 3, 5].map((i) => parseInt(u.color.slice(i, i + 2), 16)) }));
  const found = new Set();
  for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) {
    if (i * i + j * j > 64) continue;
    const x = px + r * j / 8, z = pz + r * i / 8;
    const cx = Math.floor((x - a.x_min) / (a.x_max - a.x_min) * w), cy = Math.floor((z - a.z_min) / (a.z_max - a.z_min) * h);
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
    const k = (cy * w + cx) * 4;
    let best = null, bd = 40 * 40 * 3;
    for (const q of units) { const d = (q.rgb[0] - data[k]) ** 2 + (q.rgb[1] - data[k + 1]) ** 2 + (q.rgb[2] - data[k + 2]) ** 2; if (d < bd) { bd = d; best = q.u; } }
    if (best) found.add(best.unit);
  }
  return found;
}

// For the world map (world.js): the surface images, the geology image and its legend.
export const surfaceLevels = () => ['hirise', 'ctx'].flatMap((k) => meta.layers[k].levels);
export const geologyLevel = () => meta.layers.geology.levels[0];
export const mapImage = (l) => images.get(l.image);
export const geologyLegend = () => meta.geology_legend;

// Map radius in metres for each zoom step.
export const RADII = [75, 150, 300, 600, 1500];
export const RADII_OPEN = [1000, 3000, 8000, 15000, 40000];
const CYAN = '#7fe9ff', AMBER = '#ffb347', TEXT = '#eafcff';
const BARS = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];
const niceBar = (r) => BARS.find((b) => b >= r / 3) ?? 5000;
const fmtM = (m) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);

export class Minimap {
  constructor(root, zoom = 1) {
    this.root = root;
    this.cv = root.querySelector('canvas');
    this.barEl = root.querySelector('.mm-scale i');
    this.barText = root.querySelector('.mm-scale span');
    this.srcEl = root.querySelector('.mm-src');
    this.legendEl = root.querySelector('.mm-legend');
    this.zoom = Math.max(0, Math.min(RADII.length - 1, zoom));
    this.zoomOpen = 1;
    this.open = false;
    this.layer = 'surface';
    this.radius = RADII[this.zoom];     // shown radius, eases toward the goal
    this.shown = true;
    // Where this place is on the map: app metres of the place's origin from the main place
    // (site.js). Positions passed to draw() are metres from the place's own origin.
    this.off = { x: 0, z: 0 };
    root.addEventListener('wheel', (e) => { e.preventDefault(); this.step(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    root.addEventListener('click', () => this.toggleOpen());
    this.setLegend();
  }

  goal() { return this.open ? RADII_OPEN[this.zoomOpen] : RADII[this.zoom]; }
  step(d) {
    if (this.open) this.zoomOpen = Math.max(0, Math.min(RADII_OPEN.length - 1, this.zoomOpen + d));
    else this.zoom = Math.max(0, Math.min(RADII.length - 1, this.zoom + d));
  }
  toggleOpen() { this.open = !this.open; this.root.classList.toggle('open', this.open); this.setLegend(); }
  toggleLayer() { this.layer = this.layer === 'surface' ? 'geology' : 'surface'; this.setLegend(); }
  hide() { this.shown = false; this.root.hidden = true; }

  setLegend() {
    const g = meta.geology_legend;
    const geo = this.layer === 'geology';
    this.srcEl.textContent = geo ? 'GEOLOGY: USGS SIM 3292 (1:20M) · VIA MARS TREK · STORED OFFLINE'
      : `MARS TREK ${this.open ? 'HIRISE + CTX' : 'HIRISE'} · STORED OFFLINE`;
    this.legendEl.hidden = !geo;
    if (!geo) { this.legendEl.innerHTML = ''; return; }   // the style sheet shows the element even when hidden, so it is emptied
    // The units inside the circle now. The unit you stand on is marked HERE.
    const inside = this.unitsNow || new Set([g.here.unit]);
    const units = g.units.filter((u) => inside.has(u.unit));
    this.legendEl.innerHTML = units.map((u) => `<span><i style="background:${u.color}"></i><b>${u.unit}</b> ${u.desc}${u.unit === g.here.unit ? ' · HERE' : ''}</span>`).join('');
  }

  // The image for this scale: the coarsest level still at least as sharp as the screen, with
  // data over the whole circle. Surface: HiRISE, then CTX. Geology: its one level.
  level(layerKeys, px, pz, mPerScreenPx) {
    const ls = layerKeys.flatMap((k) => meta.layers[k].levels).sort((a, b) => b.m_per_px - a.m_per_px);
    const r = this.radius;
    const inside = (b) => px - r > b.x_min && px + r < b.x_max && pz - r > b.z_min && pz + r < b.z_max;
    const covers = (l) => inside(l.app_m) && inside(l.data_m);
    return ls.find((l) => l.m_per_px <= mPerScreenPx * 1.4 && covers(l))
      || [...ls].reverse().find(covers) || ls[0];
  }

  // view: heading of the view in radians, clockwise from north. pos: app metres (x east, z south).
  draw({ pos: local, view, fovDeg, route, s, stations, nextName, home, returnPts, back, dt, reach, mate, reachMask, preview }) {
    if (!this.shown) return;
    const off = this.off, pos = { x: local.x + off.x, z: local.z + off.z };
    const cv = this.cv, dpr = Math.min(devicePixelRatio, 2);
    const size = cv.clientWidth;
    if (!size) return;
    if (cv.width !== Math.round(size * dpr)) { cv.width = cv.height = Math.round(size * dpr); }
    // Zoom eases in log space, about a quarter of a second.
    const goal = this.goal();
    this.radius = Math.exp(Math.log(this.radius) + (Math.log(goal) - Math.log(this.radius)) * Math.min(1, dt * 9));
    if (Math.abs(this.radius - goal) < 0.01 * goal) this.radius = goal;

    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const c = size / 2, R = c - 1;
    const k = R / this.radius;                       // screen px per metre
    const rot = this.open ? 0 : view;                // opened: north up
    const cos = Math.cos(-rot), sin = Math.sin(-rot);
    const toScreen = (lx, lz) => {   // from metres of this place
      const dx = (lx - local.x) * k, dy = (lz - local.z) * k;
      return [c + dx * cos - dy * sin, c + dx * sin + dy * cos];
    };
    const drawLevel = (l, alpha) => {
      ctx.save();
      ctx.translate(c, c); ctx.rotate(-rot); ctx.scale(k, k); ctx.translate(-pos.x, -pos.z);
      ctx.imageSmoothingQuality = 'high';
      ctx.globalAlpha = alpha;
      ctx.drawImage(images.get(l.image), l.app_m.x_min, l.app_m.z_min, l.app_m.x_max - l.app_m.x_min, l.app_m.z_max - l.app_m.z_min);
      ctx.restore();
    };

    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.clip();

    drawLevel(this.level(['hirise', 'ctx'], pos.x, pos.z, 1 / (k * dpr)), 0.82);
    if (this.layer === 'geology') {
      // The unit colour, with the light and shade of the image kept.
      ctx.save(); ctx.globalCompositeOperation = 'color';
      drawLevel(meta.layers.geology.levels[0], 0.85);
      ctx.restore();
      const now = unitsInside(pos.x, pos.z, this.radius);
      if (!this.unitsNow || [...now].join() !== [...this.unitsNow].join()) { this.unitsNow = now; this.setLegend(); }
    }
    ctx.fillStyle = `rgba(6, 14, 20, ${this.layer === 'geology' ? 0.16 : 0.28})`; ctx.fillRect(0, 0, size, size);

    // View cone: where the person looks.
    const half = (fovDeg / 2) * Math.PI / 180, up = -Math.PI / 2 + (view - rot);
    const cone = ctx.createRadialGradient(c, c, 0, c, c, R * (this.open ? 0.3 : 0.62));
    cone.addColorStop(0, back ? 'rgba(255,179,71,0.42)' : 'rgba(127,233,255,0.42)');
    cone.addColorStop(1, 'rgba(127,233,255,0)');
    ctx.fillStyle = cone;
    ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, R * (this.open ? 0.3 : 0.62), up - half, up + half); ctx.closePath(); ctx.fill();

    const line = (pts, color, width, dash, alpha = 1) => {
      if (pts.length < 2) return;
      ctx.save();
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 3;
      ctx.beginPath();
      pts.forEach(([x, z], i) => { const [sx, sy] = toScreen(x, z); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
      ctx.stroke(); ctx.restore();
    };

    if (this.open) {
      // The 3D ground (dashed square) and the small map's area (solid ring).
      const g = 300;
      line([[-g, -g], [g, -g], [g, g], [-g, g], [-g, -g]], TEXT, 1, [3, 3], 0.7);
      const smallR = RADII[this.zoom] * k;
      ctx.save(); ctx.strokeStyle = CYAN; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(c, c, smallR, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      if (g * k > 14) {
        const [lx, ly] = toScreen(-g, -g);
        ctx.save(); ctx.fillStyle = TEXT; ctx.globalAlpha = 0.8; ctx.font = '500 9px "Chakra Petch", sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('3D GROUND', lx, ly - 3); ctx.restore();
      }
    }

    // Ground with no way back (reach.js): shaded, so the amber edge reads as a boundary.
    if (reachMask && reachMask.mask) {
      if (this.shadeSrc !== reachMask.mask) {
        this.shadeSrc = reachMask.mask;
        const N = reachMask.n;
        if (!this.shade) { this.shade = document.createElement('canvas'); this.shade.width = this.shade.height = N; }
        const sctx = this.shade.getContext('2d'), im = sctx.createImageData(N, N);
        for (let i = 0; i < N * N; i++) if (!reachMask.mask[i]) { im.data[i * 4] = 40; im.data[i * 4 + 1] = 8; im.data[i * 4 + 2] = 0; im.data[i * 4 + 3] = 150; }
        sctx.putImageData(im, 0, 0);
      }
      const W = reachMask.n * reachMask.cell;
      ctx.save(); ctx.translate(c, c); ctx.rotate(-rot); ctx.scale(k, k); ctx.translate(-pos.x, -pos.z);
      ctx.translate(off.x, off.z); ctx.imageSmoothingEnabled = true; ctx.drawImage(this.shade, -reachMask.half, -reachMask.half, W, W); ctx.restore();
    }
    // Suggested new route while off route: white dashes from here.
    if (preview && preview.length > 1) line(preview.map((p) => [p.x, p.z]), '#eaf7ff', 1.6, [4, 3]);
    // Safe-return line (reach.js): the edge of the ground that can still be visited with a way home.
    if (reach && reach.length) {
      ctx.save(); ctx.strokeStyle = '#ffb454'; ctx.globalAlpha = 0.9; ctx.lineWidth = 1.4;
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 2; ctx.beginPath();
      for (const [x1, z1, x2, z2] of reach) { const [ax, ay] = toScreen(x1, z1), [bx, by] = toScreen(x2, z2); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
      ctx.stroke(); ctx.restore();
    }
    if (back) {
      line(returnPts.map((p) => [p.x, p.z]), AMBER, 2, []);
    } else {
      const behind = [], ahead = [];
      route.samples.forEach((q, i) => { if (i % 4 && i !== route.samples.length - 1) return; (q.s <= s ? behind : ahead).push([q.p.x, q.p.z]); });
      if (ahead.length) behind.push(ahead[0]);
      line(behind, CYAN, 1.5, [], 0.35);
      ahead.unshift([local.x, local.z]);
      line(ahead, CYAN, 1.8, [5, 4]);
    }

    // Places. On the way home only the habitat. Names only where they fit.
    const marks = back ? [{ name: 'HAB', p: home }] : stations;
    const outside = [];
    ctx.font = '600 9px "Chakra Petch", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const st of marks) {
      const [sx, sy] = toScreen(st.p.x, st.p.z);
      const isNext = st.name === nextName;
      const color = back ? AMBER : CYAN;
      if (Math.hypot(sx - c, sy - c) > R - 6) { if (isNext) outside.push({ sx, sy, color }); continue; }
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3;
      ctx.strokeStyle = color; ctx.fillStyle = isNext ? color : 'rgba(6,14,20,0.6)'; ctx.lineWidth = 1.2;
      if (st.name === 'HAB') { ctx.beginPath(); ctx.rect(sx - 4, sy - 4, 8, 8); ctx.fill(); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(sx, sy, 3.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      if (this.radius < 450 || (isNext && !this.open)) {
        ctx.fillStyle = TEXT;
        ctx.fillText(st.name === 'HAB' ? 'HAB' : st.name.replace('STN ', ''), sx, sy - 10);
      }
      ctx.restore();
    }
    ctx.restore();   // end of the circle clip

    // Ring, and a tick for the next place when it is off the map.
    ctx.strokeStyle = back ? 'rgba(255,179,71,0.8)' : 'rgba(127,233,255,0.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(c, c, R - 0.5, 0, Math.PI * 2); ctx.stroke();
    for (const o of outside) {
      const a = Math.atan2(o.sy - c, o.sx - c);
      ctx.save(); ctx.translate(c + Math.cos(a) * (R - 1), c + Math.sin(a) * (R - 1)); ctx.rotate(a);
      ctx.fillStyle = o.color; ctx.beginPath(); ctx.moveTo(1, 0); ctx.lineTo(-7, -5); ctx.lineTo(-7, 5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // North on the ring.
    const na = -Math.PI / 2 - rot;
    const nx = c + Math.cos(na) * (R - 9), ny = c + Math.sin(na) * (R - 9);
    ctx.fillStyle = 'rgba(6,14,20,0.75)'; ctx.beginPath(); ctx.arc(nx, ny, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = TEXT; ctx.font = '600 9px "Chakra Petch", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 0.5);

    // EV2 (crew.js): a white dot with its name.
    if (mate) {
      const [mx, my] = toScreen(mate.x, mate.z);
      if (Math.hypot(mx - c, my - c) < R - 4) {
        ctx.fillStyle = '#f5f2ec'; ctx.strokeStyle = '#06121a'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(mx, my, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (this.open) { ctx.font = '500 9px "Chakra Petch", sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('EV2', mx + 6, my); }
      }
    }
    // The person: a chevron that points where they look.
    ctx.save();
    ctx.translate(c, c); ctx.rotate(view - rot);
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
    ctx.fillStyle = back ? AMBER : CYAN; ctx.strokeStyle = '#06121a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();

    // Scale bar under the circle.
    const bar = niceBar(this.radius);
    this.barEl.style.width = `${(bar * k).toFixed(1)}px`;
    const txt = fmtM(bar);
    if (this.barText.textContent !== txt) this.barText.textContent = txt;
  }
}

// Written with an AI tool (Claude). See AI_USE.md.
// Walking paths over the real ground, and the factors the crew can ask the search to consider.
//
// Method and sources (SOURCES.md):
//  - Tobler 1993 (S14): turn the slope of the ground into a walking speed, then "compute, from
//    any inital [sic] point, the minimum time path to all other places". His hiking function is
//    W = 6 exp(-3.5 * abs(S + 0.05)) km/h, with S = dh/dx.
//  - The search is Dijkstra's algorithm on the height grid. The research tools for EVA traverse
//    planning use A* or Dijkstra on a terrain grid (docs/research-digest.md, section 2).
//  - SEXTANT (Johnson et al. 2010): the user picks what the path minimises (distance, time or
//    energy), and ground steeper than a set slope is an obstacle. The factors below follow that
//    idea (the team's idea of 2026-11-15: let the crew choose what the route considers).
//
// LIMITS. Tobler's function was fitted to people hiking on Earth without a space suit. No walking
// speed model for a suited person on Mars was found (digest section 2: the cost models are weak).
// Here only the SHAPE of his function is used. It is scaled so that flat ground gives the
// planning speed that the app assumes (ASSUME.walkKmh). This scaling is our assumption.
//
// TWO KINDS OF NUMBERS, kept apart on purpose:
//  - What a path costs: its length, its walking time (Tobler) and its oxygen (metabolic.js, with
//    the carried load). These are the numbers the display shows. No factor below changes them.
//  - What the search prefers: the oxygen of each step times a weight for every factor that is
//    switched on (steep ground, ground in shadow). The weights are our settings, with no source.
//    They only decide which path is picked.
import { heightAt, TERRAIN_SIZE } from './terrain.js';
import { edgeO2, ETA_DEFAULT } from './metabolic.js';

export const CELL = 2;                         // metres. The orbital ground has 1 m cells.
const N = Math.floor(TERRAIN_SIZE / CELL);     // cells per side
const HALF = TERRAIN_SIZE / 2;
const DEG = Math.PI / 180;

export function toblerFactor(S) {
  return Math.exp(-3.5 * Math.abs(S + 0.05)) / Math.exp(-3.5 * 0.05);
}

let H = null;
// For tests only: use these heights (N * N values, row by row) in place of the terrain.
export function useHeightsForTest(heights) { H = heights; SLOPE = null; shadeCache.clear(); prepCache.clear(); }
export const GRID_N = Math.floor(TERRAIN_SIZE / CELL);
// The 2 m height grid, for the reach worker (reach.worker.js).
export const heightGrid = () => grid();
function grid() {
  if (H) return H;
  H = new Float32Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) H[r * N + c] = heightAt(cx(c), cz(r));
  return H;
}
const cx = (c) => (c + 0.5) * CELL - HALF;
const cz = (r) => (r + 0.5) * CELL - HALF;
export function cellOf(x, z) {
  const c = Math.min(N - 1, Math.max(0, Math.floor((x + HALF) / CELL)));
  const r = Math.min(N - 1, Math.max(0, Math.floor((z + HALF) / CELL)));
  return r * N + c;
}
export const cellXZ = (i) => ({ x: cx(i % N), z: cz(Math.floor(i / N)) });

// Neighbours as [east, south] steps (x is east, z is minus north).
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Ground factor per cell (metabolic.js ETA). Set from the ground classes when they are known.
let ETA_CELLS = null;
export function useEta(eta) { ETA_CELLS = eta; }
export const etaAt = (i) => (ETA_CELLS ? ETA_CELLS[i] : ETA_DEFAULT);

// ---------- Factor maps: what the ground and the sky say about each 2 m cell ----------

// Slope of the ground in each cell, in degrees: the steepest gradient of the 2 m height grid,
// from height differences over 4 m (2 m at the edge of the grid). This is the slope of the ground
// itself, whichever way a person crosses it.
let SLOPE = null;
export function slopeGrid() {
  if (SLOPE) return SLOPE;
  const h = grid();
  SLOPE = new Float32Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const r0 = Math.max(0, r - 1), r1 = Math.min(N - 1, r + 1), c0 = Math.max(0, c - 1), c1 = Math.min(N - 1, c + 1);
    const gx = (h[r * N + c1] - h[r * N + c0]) / ((c1 - c0) * CELL), gz = (h[r1 * N + c] - h[r0 * N + c]) / ((r1 - r0) * CELL);
    SLOPE[r * N + c] = Math.atan(Math.hypot(gx, gz)) / DEG;
  }
  return SLOPE;
}
// Steep ground counts as an obstacle above 45 % grade (24.2 degrees). That is the steepest grade
// in the walking data behind our oxygen model (Minetti et al. 2002 measured -45 % to +45 %, and
// metabolic.js holds the grade there). NASA's suited tests stop at 30 % (IST-2). So this is the
// edge of what was measured, not a safety limit from a NASA rule: none was found (digest 1).
// SEXTANT lets the user set the limit, and its examples use 15 degrees on a 240 m lunar map. On
// this 1 m elevation model 15 degrees would mark a third of the ground, the stations included.
// Why a rule on top of the oxygen: the oxygen model only knows the slope along a step. A path
// across a steep side slope costs little in the model, and the model has no data for it.
export const STEEP_DEG = Math.atan(0.45) / DEG;

// Height of the 2 m grid at (x, z), bilinear between cell centres.
function gridHeightAt(h, x, z) {
  const fc = Math.min(N - 1.001, Math.max(0, (x + HALF) / CELL - 0.5)), fr = Math.min(N - 1.001, Math.max(0, (z + HALF) / CELL - 0.5));
  const c0 = Math.floor(fc), r0 = Math.floor(fr), tc = fc - c0, tr = fr - r0, i = r0 * N + c0;
  return h[i] * (1 - tc) * (1 - tr) + h[i + 1] * tc * (1 - tr) + h[i + N] * (1 - tc) * tr + h[i + N + 1] * tc * tr;
}

// Cells that the ground itself puts in shadow, for a sun at azimuth `az` (degrees clockwise from
// north) and elevation `el`. A ray goes from 0.3 m above the cell toward the sun in 2 m steps; the
// cell is in shadow when the ground rises above the ray. Geometry only: the Martian sky is bright
// with dust, so a shadow there is not black, and how dark it is was not modelled. Only ground
// inside the 600 m square can cast a shadow here; Mount Sharp and the crater rim are not in it.
const shadeCache = new Map();
export function shadeGrid(az, el) {
  const key = `${az.toFixed(1)}|${el.toFixed(1)}`;
  if (shadeCache.has(key)) return shadeCache.get(key);
  const h = grid(), out = new Uint8Array(N * N);
  if (el <= 0) out.fill(1);
  else {
    let hMax = -Infinity; for (let i = 0; i < h.length; i++) if (h[i] > hMax) hMax = h[i];
    const dx = Math.sin(az * DEG), dz = -Math.cos(az * DEG), rise = Math.tan(el * DEG) * CELL;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const i = r * N + c;
      let x = cx(c), z = cz(r), y = h[i] + 0.3;
      for (;;) {
        x += dx * CELL; z += dz * CELL; y += rise;
        if (y > hMax || Math.abs(x) > HALF || Math.abs(z) > HALF) break;
        if (gridHeightAt(h, x, z) > y) { out[i] = 1; break; }
      }
    }
  }
  if (shadeCache.size > 12) shadeCache.delete(shadeCache.keys().next().value);
  shadeCache.set(key, out);
  return out;
}

// ---------- What the search considers ----------

// The weights of the factors. OUR SETTINGS, with no source: they say how much longer a path the
// search accepts to avoid something. The display shows them as assumptions.
//   steep: a step onto ground steeper than STEEP_DEG counts ten times. The path crosses such
//          ground only where there is no other way, and the plan says how many metres it does.
//   shade: a step onto ground in shadow counts 25 % more.
export const WEIGHT = { steep: 10, shade: 0.25 };
// The sun line. Apollo crews driving the rover reported poor visibility "in the zero-phase
// direction" (the sun behind, the own shadow ahead: Apollo 15 and 16 mission reports), and an
// earlier MIT planner scored a traverse "directly into or away from the sun" as undesirable
// (Johnson et al. 2010, p. 5). The search does NOT use this: between fixed stations an 8-way
// grid cannot turn a leg away from the sun. It is reported as a fact of the plan (pathFacts),
// and it changes with the hour of departure. Our settings: the sun counts as low under 30
// degrees, and a heading counts as on the sun line within 45 degrees of the sun or of the
// direction opposite to it.
export const SUN = { lowDeg: 30, lineDeg: 45 };
const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
// Is a heading (compass degrees) toward a low sun, or straight away from it?
export function sunLine(headingDeg, sun) {
  if (!sun || sun.el <= 0 || sun.el >= SUN.lowDeg) return { toward: false, away: false };
  const d = angleBetween(headingDeg, sun.az);
  return { toward: d <= SUN.lineDeg, away: d >= 180 - SUN.lineDeg };
}

// The plan in force: what every path of the walk is planned with (main.js sets it).
//   base    'o2' | 'time' | 'dist': what a step costs before the factors
//   steep   true: ground steeper than STEEP_DEG is an obstacle
//   shade   true: avoid ground in shadow (needs sun)
//   sun     { az, el } in degrees clockwise from north and above the horizon, or null
//   loadKg  carried mass in kg. It changes the oxygen itself, not a weight of the search
export const PLAIN = { base: 'o2', steep: false, shade: false, sun: null, loadKg: 0 };
let PLAN = { ...PLAIN };
export function usePlan(opts) { PLAN = { ...PLAIN, ...opts }; }
export const planNow = () => PLAN;
const resolve = (cost) => (cost === 'plan' ? PLAN : typeof cost === 'string' ? { ...PLAIN, base: cost } : { ...PLAIN, ...cost });

// The weights of one search: a factor per cell, for a step INTO that cell. null: no factor is on.
const prepCache = new Map();
function prepare(o) {
  const sun = o.shade && o.sun && o.sun.el > 0 ? o.sun : null;
  if (!o.steep && !sun) return null;
  const key = `${o.steep ? 1 : 0}${sun ? `|${sun.az.toFixed(1)}|${sun.el.toFixed(1)}` : ''}`;
  let cell = prepCache.get(key);
  if (!cell) {
    cell = new Float32Array(N * N).fill(1);
    if (o.steep) { const sl = slopeGrid(); for (let i = 0; i < cell.length; i++) if (sl[i] > STEEP_DEG) cell[i] *= WEIGHT.steep; }
    if (sun) { const sh = shadeGrid(sun.az, sun.el); for (let i = 0; i < cell.length; i++) if (sh[i]) cell[i] *= 1 + WEIGHT.shade; }
    if (prepCache.size > 24) prepCache.delete(prepCache.keys().next().value);
    prepCache.set(key, cell);
  }
  return cell;
}

// Seconds and grams of oxygen to walk from cell a to its neighbour b.
function edge(a, b, flat, flatMps, loadKg) {
  const h = grid();
  const dh = h[b] - h[a];
  const len = Math.hypot(flat, dh), v = flatMps * toblerFactor(dh / flat);
  return { t: len / v, o2: edgeO2(len, v, dh / flat, (etaAt(a) + etaAt(b)) / 2, true, loadKg), len };
}

// Dijkstra from `source`. toward = false: time[i] is the time to walk from the source to i.
// toward = true: time[i] is the time to walk from i to the source. link[i] is the next cell on
// that best path, in the direction of the source. dist[i] is the length of the path in metres,
// o2[i] the grams of oxygen along it (with the safety band, metabolic.js).
// cost: 'time', 'o2' or 'dist' picks the least-time, least-oxygen or shortest path. 'plan' uses
// the plan in force (usePlan), and an object gives the factors directly (see PLAIN).
// stopAt: a cell at which the search may stop early; the values of cells further away than it
// are then not final.
export function spread(source, flatKmh, toward, cost = 'time', stopAt = -1) {
  const h = grid();
  const flatMps = flatKmh / 3.6;
  const o = resolve(cost), cellW = prepare(o), loadKg = o.loadKg || 0;
  // Float64: with Float32 a stored time can round up above the value just computed, and the
  // same cell is then relaxed again and again.
  const time = new Float64Array(N * N).fill(Infinity);
  const o2 = new Float64Array(N * N).fill(Infinity);
  const key = new Float64Array(N * N).fill(Infinity);   // what the search minimises
  const dist = new Float64Array(N * N);
  const link = new Int32Array(N * N).fill(-1);
  const heap = [];
  const push = (t, i) => {
    heap.push([t, i]);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
    }
    return top;
  };
  time[source] = 0; o2[source] = 0; key[source] = 0; push(0, source);
  while (heap.length) {
    const [t, u] = pop();
    if (t > key[u]) continue;
    if (u === stopAt) break;
    const ur = Math.floor(u / N), uc = u % N;
    for (let n = 0; n < 8; n++) {
      const dc = NB[n][0], dr = NB[n][1];
      const vc = uc + dc, vr = ur + dr;
      if (vc < 0 || vr < 0 || vc >= N || vr >= N) continue;
      const v = vr * N + vc;
      const flat = CELL * (dc && dr ? Math.SQRT2 : 1);
      // The step that is walked: v -> u when the field leads toward the source, u -> v otherwise.
      const e = toward ? edge(v, u, flat, flatMps, loadKg) : edge(u, v, flat, flatMps, loadKg);
      let w = o.base === 'o2' ? e.o2 : o.base === 'dist' ? e.len : e.t;
      if (cellW) w *= cellW[toward ? u : v];
      if (t + w < key[v]) {
        key[v] = t + w; time[v] = time[u] + e.t; o2[v] = o2[u] + e.o2; link[v] = u;
        dist[v] = dist[u] + e.len;
        push(key[v], v);
      }
    }
  }
  return { time, o2, dist, link, source };
}

// Cells from `from` to the source of `field`, following the links.
export function trace(field, from) {
  const out = [];
  for (let i = from, guard = 0; i >= 0 && guard < N * N; i = field.link[i], guard++) out.push(i);
  return out;
}

// What a path meets, for the plan screen: its length, the metres on steep ground, the metres in
// shadow, and the metres walked toward a low sun or straight away from it. `cells` is the path in
// walking order. `sun` is where the sun stands while it is walked, or null. The heading of a step
// is taken over the six cells around it (about 12 m), so that the staircase of the grid does not
// decide it.
export function pathFacts(cells, sun = null) {
  const h = grid(), slope = slopeGrid();
  const lit = !!sun && sun.el > 0, shade = lit ? shadeGrid(sun.az, sun.el) : null;
  const f = { m: 0, steepM: 0, steepest: 0, shadeM: 0, towardSunM: 0, awaySunM: 0, climbM: 0 };
  for (let k = 1; k < cells.length; k++) {
    const a = cells[k - 1], b = cells[k];
    const len = Math.hypot(CELL * Math.hypot((b % N) - (a % N), Math.floor(b / N) - Math.floor(a / N)), h[b] - h[a]);
    f.m += len;
    if (h[b] > h[a]) f.climbM += h[b] - h[a];
    if (slope[b] > STEEP_DEG) f.steepM += len;
    if (slope[b] > f.steepest) f.steepest = slope[b];
    if (!lit) continue;
    if (shade[b]) f.shadeM += len;
    const p = cells[Math.max(0, k - 3)], q = cells[Math.min(cells.length - 1, k + 2)];
    const line = sunLine((Math.atan2((q % N) - (p % N), -(Math.floor(q / N) - Math.floor(p / N))) / DEG + 360) % 360, sun);
    if (line.toward) f.towardSunM += len;
    if (line.away) f.awaySunM += len;
  }
  return f;
}

// Plan the whole traverse: a path for each leg between the given places.
// cost: as for spread(), or a function (leg index, seconds since the start of the traverse) that
// gives the cost of that leg, so that a leg can be planned with the sun of its own hour.
// fields: a Map from a place name to a field that leads TOWARD that place (spread with toward =
// true). A leg to a place in the map is read from its field, so no new search is run.
// pause: seconds spent at the end of leg k before the next leg starts (work at a station).
export function planTraverse(places, flatKmh, cost = 'time', { fields = null, pause = () => 0 } = {}) {
  const points = [], marks = [], legs = [];
  let seconds = 0, grams = 0, clock = 0;
  for (let k = 0; k < places.length - 1; k++) {
    const a = cellOf(places[k].x, places[k].z), b = cellOf(places[k + 1].x, places[k + 1].z);
    const legCost = typeof cost === 'function' ? cost(k, clock) : cost;
    const ready = fields && fields.get(places[k + 1].name);
    let cells, t, g;
    if (ready) { cells = trace(ready, a); t = ready.time[a]; g = ready.o2[a]; }
    else { const field = spread(a, flatKmh, false, legCost, b); cells = trace(field, b).reverse(); t = field.time[b]; g = field.o2[b]; }
    seconds += t; grams += g;
    legs.push({ from: places[k].name, to: places[k + 1].name, cells, seconds: t, grams: g, startSec: clock, cost: legCost });
    clock += t + pause(k);
    if (k === 0) marks.push({ name: places[0].name, index: 0 });
    for (let j = k === 0 ? 0 : 1; j < cells.length; j++) points.push(cellXZ(cells[j]));
    marks.push({ name: places[k + 1].name, index: points.length - 1 });
  }
  return { points, marks, seconds, grams, legs };
}

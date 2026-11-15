// Written with an AI tool (Claude). See AI_USE.md.
// What the choices of the plan screen do on the real ground of the main place. Run in app/:
//   npm run routes
// It builds the planner's 2 m grid from the shipped files the way the app does (main.js), plans
// the walk with each choice of the plan screen, and plans the way home from across the square.
// It writes docs/checks/route_factors_check.json and prints a summary.
// Every number here is a model value: the same planner and oxygen model as the app. Nothing is
// measured on a person, and the ground is the 1 m orbital elevation model (docs/methods.md).
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as P from '../src/planner.js';
import * as M from '../src/metabolic.js';
import * as E from '../src/env.js';

const APP = fileURLToPath(new URL('..', import.meta.url)), D = `${APP}public/data/`;
const json = (f) => JSON.parse(fs.readFileSync(D + f, 'utf8'));

// ---------- The ground, as terrain.js reads it ----------
const meta = json('terrain.json');
const i16 = (f) => { const b = fs.readFileSync(D + f); return new Int16Array(b.buffer, b.byteOffset, b.length / 2); };
const orb = i16('orbital_height.bin'), det = i16('near_detail.bin');
const SIZE = 600, on = meta.orbital.cells, nn = meta.near.cells, nearHalf = meta.near.size_m / 2, nearCell = meta.near.cell_m;
function sample(grid, n, col, row) {
  const c0 = Math.min(n - 2, Math.max(0, Math.floor(col))), r0 = Math.min(n - 2, Math.max(0, Math.floor(row)));
  const fc = Math.min(1, Math.max(0, col - c0)), fr = Math.min(1, Math.max(0, row - r0)), i = r0 * n + c0;
  return grid[i] * (1 - fc) * (1 - fr) + grid[i + 1] * fc * (1 - fr) + grid[i + n] * (1 - fc) * fr + grid[i + n + 1] * fc * fr;
}
function heightAt(x, z) {
  let h = sample(orb, on, x + SIZE / 2 - 0.5, z + SIZE / 2 - 0.5) / 100;
  if (Math.abs(x) < nearHalf && Math.abs(z) < nearHalf) h += sample(det, nn, (x + nearHalf) / nearCell - 0.5, (z + nearHalf) / nearCell - 0.5) / 1000;
  return h;
}
// The first channel of an 8-bit PNG without interlace (the class pictures).
function pngFirstChannel(file) {
  const b = fs.readFileSync(file); let p = 8, w = 0, h = 0, ct = 0, plte = null; const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8), data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error(`${file}: PNG format not handled`); }
    if (type === 'PLTE') plte = data;
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 3: 1, 6: 4 }[ct], raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, out = new Uint8Array(w * h), cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, up = prev[x], c = x >= ch ? prev[x - ch] : 0; let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) { const v = cur[x * ch]; out[y * w + x] = ct === 3 ? plte[v * 3] : v; }
    prev.set(cur);
  }
  return { w, px: out };
}
const patches = json('classes/classes.json').patches.map((p) => { const im = pngFirstChannel(`${D}classes/${p.file}`); return { ...p, n: im.w, px: im.px }; });
const patchAt = (x, z) => patches.find((p) => Math.abs(x - p.x) < p.half_m && Math.abs(z - p.z) < p.half_m) || null;
function classAt(x, z) {
  for (const p of patches) {
    const dx = x - p.x, dz = z - p.z;
    if (Math.abs(dx) >= p.half_m || Math.abs(dz) >= p.half_m) continue;
    const c = Math.floor((dx + p.half_m) / p.cell_m), r = Math.floor((dz + p.half_m) / p.cell_m), v = p.px[r * p.n + c];
    if (v < 4) return v;
    const cnt = [0, 0, 0, 0];
    for (let dr = -6; dr <= 6; dr += 2) for (let dc = -6; dc <= 6; dc += 2) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= p.n || cc >= p.n) continue;
      const w = p.px[rr * p.n + cc]; if (w < 4) cnt[w]++;
    }
    const best = cnt.indexOf(Math.max(...cnt));
    return cnt[best] > 0 ? best : -1;
  }
  return -1;
}

const N = P.GRID_N, CELL = P.CELL, KMH = 2.7, MPS = KMH / 3.6;
const H = new Float32Array(N * N);
for (let i = 0; i < H.length; i++) { const q = P.cellXZ(i); H[i] = heightAt(q.x, q.z); }
P.useHeightsForTest(H);
const eta = new Float32Array(N * N).fill(M.ETA_DEFAULT);
for (let i = 0; i < eta.length; i++) {
  const q = P.cellXZ(i);
  if (!patchAt(q.x, q.z)) continue;
  let sum = 0, n = 0;
  for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) { const k = classAt(q.x - CELL / 2 + (a + 0.5) * CELL / 10, q.z - CELL / 2 + (b + 0.5) * CELL / 10); sum += k >= 0 ? M.ETA_BY_CLASS[k] : M.ETA_DEFAULT; n++; }
  eta[i] = sum / n;
}
P.useEta(eta);
E.useEnvForTest(json('rems_sol4709.json'), json('sun_sol4709.json'));

// ---------- The walk, with each choice of the plan screen ----------
const WORK_MIN = 25;   // the work time at a station that the plan assumes (route.js)
const PLACES = [{ x: 0, z: 0, name: 'HAB' }, ...json('stations.json').stations.map((s) => ({ x: s.x, z: s.z, name: s.id, workMin: WORK_MIN })), { x: 0, z: 0, name: 'HAB' }];
const pause = (k) => (PLACES[k + 1].workMin || 0) * 60;
const r1 = (v) => Math.round(v * 10) / 10;
// One plan of the walk, as buildFields and comparePlans do it in main.js: the field toward each
// place is made with the sun of the hour at which the plan starts that leg.
function walk(opts) {
  E.setDeparture(opts.depart);
  const toward = new Map(); let clock = 0;
  for (let k = 1; k < PLACES.length; k++) {
    const pl = PLACES[k], from = PLACES[k - 1];
    const f = P.spread(P.cellOf(pl.x, pl.z), KMH, true, { base: opts.base || 'o2', steep: opts.steep, shade: opts.shade, sun: E.sunNow(clock), loadKg: opts.loadKg });
    toward.set(pl.name, f);
    clock += f.time[P.cellOf(from.x, from.z)] + (pl.workMin || 0) * 60;
  }
  const plan = P.planTraverse(PLACES, KMH, 'o2', { fields: toward, pause });
  const f = { m: 0, steepM: 0, shadeM: 0, towardSunM: 0, awaySunM: 0, climbM: 0 };
  for (const leg of plan.legs) { const q = P.pathFacts(leg.cells, E.sunNow(leg.startSec)); for (const k of Object.keys(f)) f[k] += q[k]; }
  const sun0 = E.sunNow(0);
  return { walkMin: r1(plan.seconds / 60), walkO2g: r1(plan.grams), groundM: r1(f.m), steepM: r1(f.steepM), shadowM: r1(f.shadeM), towardLowSunM: r1(f.towardSunM), awayFromLowSunM: r1(f.awaySunM), climbM: r1(f.climbM), sunAtDeparture: { azDeg: r1(sun0.az), elDeg: r1(sun0.el) } };
}
const DEPARTS = ['06:00', '08:08', '15:30'], LOADS = [0, 10, 20, 30];
const walks = [];
for (const depart of DEPARTS) {
  walks.push({ depart, loadKg: 0, route: 'shortest path on the grid', ...walk({ base: 'dist', depart, loadKg: 0 }) });
  for (const steep of [false, true]) for (const shade of [false, true]) walks.push({ depart, loadKg: 0, route: `least oxygen${steep ? ' + steep ground' : ''}${shade ? ' + shadow' : ''}`, steep, shade, ...walk({ steep, shade, depart, loadKg: 0 }) });
}
const loads = LOADS.map((loadKg) => ({ loadKg, ...walk({ steep: true, shade: false, depart: '08:08', loadKg }) }));

// Shadow over the square at each hour of departure.
const shadowShare = DEPARTS.map((depart) => { E.setDeparture(depart); const s = E.sunNow(0), g = P.shadeGrid(s.az, s.el); let n = 0; for (let i = 0; i < g.length; i++) n += g[i]; return { depart, azDeg: r1(s.az), elDeg: r1(s.el), shareOfCells: Math.round(1000 * n / g.length) / 1000 }; });

// ---------- The way home from across the square ----------
E.setDeparture('08:08');
const HAB = P.cellOf(0, 0), slope = P.slopeGrid();
const least = P.spread(HAB, KMH, true, 'o2'), short = P.spread(HAB, KMH, true, 'dist'), avoid = P.spread(HAB, KMH, true, { base: 'o2', steep: true });
const hAt = (x, z) => { const fc = Math.min(N - 1.001, Math.max(0, (x + SIZE / 2) / CELL - 0.5)), fr = Math.min(N - 1.001, Math.max(0, (z + SIZE / 2) / CELL - 0.5)), c0 = Math.floor(fc), r0 = Math.floor(fr), tc = fc - c0, tr = fr - r0, i = r0 * N + c0;
  return H[i] * (1 - tc) * (1 - tr) + H[i + 1] * tc * (1 - tr) + H[i + N] * (1 - tc) * tr + H[i + N + 1] * tc * tr; };
// The straight line to the habitat in 2 m steps, with the planner's own speed and oxygen for each
// step. offRange: a step steeper than the grades Minetti measured (0.45), where the oxygen model
// is used outside its data.
const MINETTI_MAX = 0.45;
function straight(x, z) {
  const d = Math.hypot(x, z), n = Math.max(1, Math.round(d / CELL)); let t = 0, g = 0, steep = 0, len = 0, off = false, px = x, pz = z, ph = hAt(x, z);
  for (let k = 1; k <= n; k++) {
    const qx = x * (1 - k / n), qz = z * (1 - k / n), qh = hAt(qx, qz), flat = Math.hypot(qx - px, qz - pz), i = (qh - ph) / flat, l = Math.hypot(flat, qh - ph), v = MPS * P.toblerFactor(i);
    t += l / v; g += M.edgeO2(l, v, i, (P.etaAt(P.cellOf(px, pz)) + P.etaAt(P.cellOf(qx, qz))) / 2, true); len += l;
    if (slope[P.cellOf(qx, qz)] > P.STEEP_DEG) steep += l;
    if (Math.abs(i) > MINETTI_MAX) off = true;
    px = qx; pz = qz; ph = qh;
  }
  return { t, g, steep, len, off };
}
const rows = [];
for (let r = 6; r < N - 6; r += 4) for (let c = 6; c < N - 6; c += 4) {
  const i = r * N + c, q = P.cellXZ(i); if (Math.hypot(q.x, q.z) < 30) continue;
  const s = straight(q.x, q.z);
  rows.push({ s, o2: least.o2[i], t: least.time[i], len: least.dist[i], steep: P.pathFacts(P.trace(least, i)).steepM, shortO2: short.o2[i], avoidO2: avoid.o2[i], avoidLen: avoid.dist[i], avoidSteep: P.pathFacts(P.trace(avoid, i)).steepM });
}
const quant = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
const r3 = (v) => Math.round(v * 1000) / 1000;
const dist = (arr) => ({ median: r3(quant(arr, 0.5)), p75: r3(quant(arr, 0.75)), p90: r3(quant(arr, 0.9)) });
const share = (list, f) => r3(list.filter(f).length / list.length);
const inRange = rows.filter((q) => !q.s.off);
const home = {
  startCells: rows.length, spacingM: 4 * CELL, minDistanceM: 30,
  straightLineOverLeastOxygen: {
    oxygenRatio: dist(rows.map((q) => q.s.g / q.o2)), timeRatio: dist(rows.map((q) => q.s.t / q.t)),
    shareMoreThan5Percent: share(rows, (q) => q.s.g / q.o2 > 1.05), shareMoreThan10Percent: share(rows, (q) => q.s.g / q.o2 > 1.10), shareMoreThan20Percent: share(rows, (q) => q.s.g / q.o2 > 1.20),
    shareOfStraightLinesOutsideMeasuredGrades: share(rows, (q) => q.s.off),
    onlyLinesInsideMeasuredGrades: { startCells: inRange.length, oxygenRatio: dist(inRange.map((q) => q.s.g / q.o2)), shareMoreThan5Percent: share(inRange, (q) => q.s.g / q.o2 > 1.05), shareMoreThan10Percent: share(inRange, (q) => q.s.g / q.o2 > 1.10) },
  },
  shortestGridPathOverLeastOxygen: { oxygenRatio: dist(rows.map((q) => q.shortO2 / q.o2)) },
  steepGround: {
    limitDeg: r1(P.STEEP_DEG), shareOfCellsAboveLimit: r3(slope.reduce((a, v) => a + (v > P.STEEP_DEG ? 1 : 0), 0) / slope.length),
    // For comparison: the 15 degree limit of the SEXTANT example and of the VIPER slides.
    shareOfCellsAbove15Deg: r3(slope.reduce((a, v) => a + (v > 15 ? 1 : 0), 0) / slope.length),
    slopeAtStationsDeg: Object.fromEntries(PLACES.slice(1, -1).map((pl) => [pl.name, r1(slope[P.cellOf(pl.x, pl.z)])])),
    shareOfWaysHomeThatCrossIt: { straightLine: share(rows, (q) => q.s.steep > 0), leastOxygen: share(rows, (q) => q.steep > 0), withObstacleRule: share(rows, (q) => q.avoidSteep > 0) },
    metresOnIt: { straightLine: dist(rows.map((q) => q.s.steep)), leastOxygen: dist(rows.map((q) => q.steep)), withObstacleRule: dist(rows.map((q) => q.avoidSteep)) },
    obstacleRuleOverLeastOxygen: { oxygenRatio: dist(rows.map((q) => q.avoidO2 / q.o2)), lengthRatio: dist(rows.map((q) => q.avoidLen / q.len)) },
  },
};

const out = {
  what: 'Model values from app/tools/route_check.mjs: the planner and oxygen model of the app on the ground of the main place. Not measurements.',
  made_utc: new Date().toISOString(),
  inputs: ['orbital_height.bin', 'near_detail.bin', 'classes/classes.json', 'stations.json', 'rems_sol4709.json', 'sun_sol4709.json'],
  settings: { cellM: CELL, flatKmh: KMH, steepLimitDeg: r1(P.STEEP_DEG), steepWeight: P.WEIGHT.steep, shadowWeight: P.WEIGHT.shade, lowSunDeg: P.SUN.lowDeg, sunLineDeg: P.SUN.lineDeg, workMinPerStation: WORK_MIN },
  limits: ['An 8-neighbour grid path comes out up to 8 % longer than a free path, so grid paths are at a disadvantage against the straight line.',
    'The straight line is walked on the same 2 m heights. Where a step is steeper than a grade of 0.45 the oxygen model is outside the grades Minetti measured. Ratios are given with and without those lines.',
    'The 1 m orbital ground reads steeper than the ground Curiosity stood on (docs/methods.md, tilt check).'],
  theWalk: walks, carriedLoad: loads, shadowAtDeparture: shadowShare, wayHome: home,
};
const file = fileURLToPath(new URL('../../docs/checks/route_factors_check.json', import.meta.url));
fs.mkdirSync(new URL('.', new URL('../../docs/checks/route_factors_check.json', import.meta.url)), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');

const pc = (v) => `${(100 * v).toFixed(1)} %`;
console.log('THE WALK (walking only, 0 kg)');
for (const w of walks) console.log(`  ${w.depart}  ${w.route.padEnd(40)} ${String(w.groundM).padStart(6)} m ${String(w.walkMin).padStart(5)} min ${String(w.walkO2g).padStart(5)} g | steep ${String(w.steepM).padStart(5)} m | shadow ${String(w.shadowM).padStart(5)} m | sun line ${w.towardLowSunM} / ${w.awayFromLowSunM} m`);
console.log('CARRIED LOAD (08:08, steep ground on)');
for (const l of loads) console.log(`  ${String(l.loadKg).padStart(2)} kg  ${l.groundM} m  ${l.walkMin} min  ${l.walkO2g} g`);
console.log('SHADOW AT DEPARTURE'); for (const s of shadowShare) console.log(`  ${s.depart}  sun az ${s.azDeg} el ${s.elDeg}  ${pc(s.shareOfCells)} of cells in shadow`);
const S = home.straightLineOverLeastOxygen, G = home.steepGround;
console.log(`THE WAY HOME from ${home.startCells} places (every ${home.spacingM} m, more than ${home.minDistanceM} m out)`);
console.log(`  straight line / least-oxygen path, oxygen: median ${S.oxygenRatio.median}, p75 ${S.oxygenRatio.p75}, p90 ${S.oxygenRatio.p90}; more than +5 %: ${pc(S.shareMoreThan5Percent)}, +10 %: ${pc(S.shareMoreThan10Percent)}, +20 %: ${pc(S.shareMoreThan20Percent)}`);
console.log(`  straight lines with a step outside the measured grades: ${pc(S.shareOfStraightLinesOutsideMeasuredGrades)}. Without them (${S.onlyLinesInsideMeasuredGrades.startCells} places): median ${S.onlyLinesInsideMeasuredGrades.oxygenRatio.median}, p90 ${S.onlyLinesInsideMeasuredGrades.oxygenRatio.p90}; more than +5 %: ${pc(S.onlyLinesInsideMeasuredGrades.shareMoreThan5Percent)}, +10 %: ${pc(S.onlyLinesInsideMeasuredGrades.shareMoreThan10Percent)}`);
console.log(`  straight line / least-oxygen path, time: median ${S.timeRatio.median}, p90 ${S.timeRatio.p90}`);
console.log(`  shortest grid path / least-oxygen path, oxygen: median ${home.shortestGridPathOverLeastOxygen.oxygenRatio.median}, p90 ${home.shortestGridPathOverLeastOxygen.oxygenRatio.p90}`);
console.log(`  ground above 15 deg: ${pc(G.shareOfCellsAbove15Deg)} of cells. Slope at the stations: ${JSON.stringify(G.slopeAtStationsDeg)}`);
console.log(`  ground above ${G.limitDeg} deg: ${pc(G.shareOfCellsAboveLimit)} of cells. Ways home that cross it: straight ${pc(G.shareOfWaysHomeThatCrossIt.straightLine)}, least oxygen ${pc(G.shareOfWaysHomeThatCrossIt.leastOxygen)}, with the obstacle rule ${pc(G.shareOfWaysHomeThatCrossIt.withObstacleRule)}`);
console.log(`  metres on it: straight median ${G.metresOnIt.straightLine.median} p90 ${G.metresOnIt.straightLine.p90}; least oxygen median ${G.metresOnIt.leastOxygen.median} p90 ${G.metresOnIt.leastOxygen.p90}; obstacle rule median ${G.metresOnIt.withObstacleRule.median} p90 ${G.metresOnIt.withObstacleRule.p90}`);
console.log(`  obstacle rule / least oxygen: oxygen median ${G.obstacleRuleOverLeastOxygen.oxygenRatio.median} p90 ${G.obstacleRuleOverLeastOxygen.oxygenRatio.p90}; length median ${G.obstacleRuleOverLeastOxygen.lengthRatio.median} p90 ${G.obstacleRuleOverLeastOxygen.lengthRatio.p90}`);
console.log(`written: ${file}`);

// Written with an AI tool (Claude). See AI_USE.md.
// Checks the path planner against cases with a known answer. Usage: npm test
import { spread, trace, cellOf, cellXZ, toblerFactor, useHeightsForTest, GRID_N, CELL, planTraverse, pathFacts, slopeGrid, shadeGrid, sunLine, STEEP_DEG, SUN } from '../src/planner.js';

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  ${detail}`); if (!ok) failed++; };
const N = GRID_N, KMH = 2.7, MPS = KMH / 3.6;

// 1. Tobler's function: values worked out by hand from W = 6 exp(-3.5 |S + 0.05|).
check('factor on flat ground is 1', Math.abs(toblerFactor(0) - 1) < 1e-12, `${toblerFactor(0)}`);
check('fastest at slope -0.05', toblerFactor(-0.05) > toblerFactor(0) && toblerFactor(-0.05) > toblerFactor(-0.1), `${toblerFactor(-0.05).toFixed(4)}`);
const w = 6 * Math.exp(-3.5 * Math.abs(0.2 + 0.05)), w0 = 6 * Math.exp(-3.5 * 0.05);
check('factor at slope 0.2 matches the formula', Math.abs(toblerFactor(0.2) - w / w0) < 1e-12, `${toblerFactor(0.2).toFixed(4)}`);

// 2. Flat ground: the time along a grid axis is distance / speed.
useHeightsForTest(new Float32Array(N * N));
let f = spread(cellOf(0, 0), KMH, true);
let c = cellOf(100, 0);
check('flat, 100 m along an axis', Math.abs(f.time[c] - 100 / MPS) < 0.5, `${f.time[c].toFixed(1)} s, expected ${(100 / MPS).toFixed(1)} s`);
check('flat, distance along an axis', Math.abs(f.dist[c] - 100) < 0.01, `${f.dist[c].toFixed(2)} m`);
// Diagonal: exact on an 8-neighbour grid.
c = cellOf(80, 80);
check('flat, diagonal', Math.abs(f.dist[c] - 80 * Math.SQRT2) < 0.01, `${f.dist[c].toFixed(2)} m, expected ${(80 * Math.SQRT2).toFixed(2)} m`);
// Off-axis: an 8-neighbour grid over-estimates by at most 8.24 %.
c = cellOf(100, 40);
const straight = Math.hypot(100, 40);
check('flat, off-axis is within the 8-neighbour bound', f.dist[c] >= straight - 0.01 && f.dist[c] <= straight * 1.0824 + 0.01, `${f.dist[c].toFixed(2)} m, straight ${straight.toFixed(2)} m`);

// 3. A uniform slope along x: going up takes longer than going down, by the ratio of the formula.
const S = 0.2, h = new Float32Array(N * N);
for (let r = 0; r < N; r++) for (let col = 0; col < N; col++) h[r * N + col] = S * col * CELL;
useHeightsForTest(h);
const a = cellOf(-50, 0), b = cellOf(50, 0);
const up = spread(a, KMH, false).time[b], down = spread(b, KMH, false).time[a];
const len = 100 * Math.hypot(1, S);
check('uphill time on a uniform slope', Math.abs(up - len / (MPS * toblerFactor(S))) < 1, `${up.toFixed(1)} s, expected ${(len / (MPS * toblerFactor(S))).toFixed(1)} s (straight up)`);
check('downhill is faster than uphill', down < up, `down ${down.toFixed(1)} s, up ${up.toFixed(1)} s`);

// 4. A wall with one gap: the path goes through the gap.
const wall = new Float32Array(N * N);
const wc = Math.floor(N / 2);
for (let r = 0; r < N; r++) if (Math.abs(r - (N / 2 + 40)) > 2) wall[r * N + wc] = 30;
useHeightsForTest(wall);
f = spread(cellOf(-60, 0), KMH, false);
const path = trace(f, cellOf(60, 0)).map(cellXZ);
const cross = path.find((q) => Math.abs(q.x - ((wc + 0.5) * CELL - 300)) < 0.01);
check('path crosses the wall at the gap', cross && Math.abs(cross.z - ((N / 2 + 40 + 0.5) * CELL - 300)) <= 2 * CELL, cross ? `crossed at z = ${cross.z}` : 'did not cross');

// 5. toward = true and toward = false agree on flat ground.
useHeightsForTest(new Float32Array(N * N));
const t1 = spread(cellOf(0, 0), KMH, true).time[cellOf(70, -30)], t2 = spread(cellOf(0, 0), KMH, false).time[cellOf(70, -30)];
check('both directions agree on flat ground', Math.abs(t1 - t2) < 1e-3, `${t1.toFixed(2)} s, ${t2.toFixed(2)} s`);

// 6. The factors the crew can switch on. A ridge 6 m high with 45 degree sides runs north to
// south, with a 12 m gap in it 80 m to the south. Steep ground counts as an obstacle above
// STEEP_DEG (24.2 degrees).
const ridge = new Float32Array(N * N);
for (let r = 0; r < N; r++) for (let col = 0; col < N; col++) {
  const x = (col + 0.5) * CELL - 300, z = (r + 0.5) * CELL - 300;
  if (Math.abs(z - 86) > 6) ridge[r * N + col] = Math.max(0, 6 - Math.abs(x));
}
useHeightsForTest(ridge);
const A = cellOf(-60, 0), B = cellOf(60, 0);
const sl = slopeGrid();
check('slope of the ridge side is 45 degrees', Math.abs(sl[cellOf(-3, 0)] - 45) < 0.5 && sl[cellOf(-40, 0)] === 0, `${sl[cellOf(-3, 0)].toFixed(1)} deg on the side, ${sl[cellOf(-40, 0)]} deg on the plain`);
const plainF = spread(A, KMH, false, 'o2'), steepF = spread(A, KMH, false, { base: 'o2', steep: true });
const plainP = trace(plainF, B).reverse(), steepP = trace(steepF, B).reverse();
const fp = pathFacts(plainP), fs = pathFacts(steepP);
check('least oxygen alone goes over the ridge', fp.steepM > 0 && fp.steepest > STEEP_DEG, `${fp.steepM.toFixed(1)} m on steep ground, ${fp.m.toFixed(0)} m long`);
check('with the obstacle rule the path meets no steep ground', fs.steepM === 0, `${fs.steepM} m on steep ground, ${fs.m.toFixed(0)} m long`);
check('  and it goes through the gap', steepP.map(cellXZ).some((q) => Math.abs(q.x) < 1.5 && Math.abs(q.z - 86) <= 6), 'crossed x = 0 inside the gap');
// The weights only pick the path. The time, the oxygen and the length it reports are those of the path itself.
check('  its oxygen is not below the least-oxygen path', steepF.o2[B] >= plainF.o2[B] - 1e-9, `${steepF.o2[B].toFixed(2)} g vs ${plainF.o2[B].toFixed(2)} g`);
check('  its length is the length of its cells', Math.abs(steepF.dist[B] - fs.m) < 1e-6, `${steepF.dist[B].toFixed(2)} m vs ${fs.m.toFixed(2)} m`);
// The same search, stopped at the goal, and the same leg read from a field that leads to the goal.
check('stopping at the goal gives the same oxygen', Math.abs(spread(A, KMH, false, 'o2', B).o2[B] - plainF.o2[B]) < 1e-9, `${plainF.o2[B].toFixed(3)} g`);
const two = [{ x: -60, z: 0, name: 'P' }, { x: 60, z: 0, name: 'Q' }];
const fields = new Map([['Q', spread(B, KMH, true, { base: 'o2', steep: true })]]);
const viaField = planTraverse(two, KMH, 'o2', { fields }), direct = planTraverse(two, KMH, { base: 'o2', steep: true });
check('a leg read from a field matches a leg searched for', Math.abs(viaField.grams - direct.grams) < 1e-6 && Math.abs(viaField.seconds - direct.seconds) < 1e-6, `${viaField.grams.toFixed(3)} g, ${direct.grams.toFixed(3)} g`);
// On flat ground no factor changes anything.
useHeightsForTest(new Float32Array(N * N));
const sunLow = { az: 90, el: 10 };
const flatO = spread(cellOf(0, 0), KMH, true, 'o2'), flatAll = spread(cellOf(0, 0), KMH, true, { base: 'o2', steep: true, shade: true, sun: sunLow });
check('flat ground: the factors change nothing', Math.abs(flatO.o2[cellOf(90, 40)] - flatAll.o2[cellOf(90, 40)]) < 1e-9 && Math.abs(flatO.time[cellOf(90, 40)] - flatAll.time[cellOf(90, 40)]) < 1e-9, `${flatAll.o2[cellOf(90, 40)].toFixed(3)} g`);
// A carried load raises the oxygen of the same path.
const loaded = spread(cellOf(0, 0), KMH, true, { base: 'o2', loadKg: 20 });
check('flat ground: 20 kg carried costs more oxygen, same time', loaded.o2[cellOf(100, 0)] > flatO.o2[cellOf(100, 0)] && Math.abs(loaded.time[cellOf(100, 0)] - flatO.time[cellOf(100, 0)]) < 1e-9, `${flatO.o2[cellOf(100, 0)].toFixed(2)} g without, ${loaded.o2[cellOf(100, 0)].toFixed(2)} g with`);

// 7. Shadow. A wall 10 m high along x = 0, the sun in the east 20 degrees up: the shadow reaches
// 10 / tan(20 deg) = 27.5 m west of the wall.
const wall2 = new Float32Array(N * N);
for (let r = 0; r < N; r++) wall2[r * N + N / 2] = 10;
useHeightsForTest(wall2);
const sh = shadeGrid(90, 20);
check('shadow west of the wall, within its reach', sh[cellOf(-11, 0)] === 1 && sh[cellOf(-21, 0)] === 1, `${sh[cellOf(-11, 0)]}, ${sh[cellOf(-21, 0)]}`);
check('no shadow beyond its reach or on the sun side', sh[cellOf(-35, 0)] === 0 && sh[cellOf(15, 0)] === 0, `${sh[cellOf(-35, 0)]}, ${sh[cellOf(15, 0)]}`);
check('sun below the horizon: everything is in shadow', shadeGrid(90, -1)[cellOf(100, 100)] === 1, '');
// With the shadow factor on, a walk along the wall's west side keeps out of the shadow where the extra way is small.
const sA = cellOf(-10, -60), sB = cellOf(-10, 60);
const inShade = pathFacts(trace(spread(sA, KMH, false, 'o2'), sB).reverse(), { az: 90, el: 20 }).shadeM;
const outShade = pathFacts(trace(spread(sA, KMH, false, { base: 'o2', shade: true, sun: { az: 90, el: 20 } }), sB).reverse(), { az: 90, el: 20 }).shadeM;
check('the shadow factor shortens the way in shadow', inShade > 100 && outShade < inShade, `${inShade.toFixed(0)} m without, ${outShade.toFixed(0)} m with`);

// 8. The sun line: toward a low sun, straight away from it, or neither.
check('heading east, low sun in the east: toward', sunLine(90, sunLow).toward && !sunLine(90, sunLow).away, '');
check('heading west, low sun in the east: away', sunLine(270, sunLow).away && !sunLine(270, sunLow).toward, '');
check('heading north: neither', !sunLine(0, sunLow).toward && !sunLine(0, sunLow).away, '');
check('a sun above the limit does not count', !sunLine(90, { az: 90, el: SUN.lowDeg + 1 }).toward, `limit ${SUN.lowDeg} deg`);
useHeightsForTest(new Float32Array(N * N));
const east = trace(spread(cellOf(-50, 0), KMH, false, 'o2'), cellOf(50, 0)).reverse();
const fe = pathFacts(east, sunLow);
check('a walk to the east under a low eastern sun is all toward the sun', Math.abs(fe.towardSunM - fe.m) < 1e-9 && fe.awaySunM === 0, `${fe.towardSunM.toFixed(0)} of ${fe.m.toFixed(0)} m`);

console.log(failed ? `${failed} FAILED` : 'all planner checks passed');
process.exit(failed ? 1 : 0);

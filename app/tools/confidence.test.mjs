// Written with an AI tool (Claude). See AI_USE.md.
// Checks the return confidence and the safe-return line against cases with a known answer.
import { O2_RATIOS, APOLLO_O2_REMAINING, deviation, returnConfidence, APOLLO_PAIR_RATIOS, PAIR_RATIO_MAX, PAIR_RATIO_MEDIAN, ev2Ratio } from '../src/confidence.js';
import { reachMask, contour } from '../src/reach.js';

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  ${detail}`); if (!ok) failed++; };

// Apollo oxygen ratios: worked by hand for the first row, (100 - 21.1) / (100 - 33.4) = 1.1847.
check('12 crew-EVAs in the aggregate set', APOLLO_O2_REMAINING.length === 12, `${APOLLO_O2_REMAINING.length}`);
check('A15 EVA 1 CDR ratio', Math.abs(O2_RATIOS[0] - 78.9 / 66.6) < 1e-12, O2_RATIOS[0].toFixed(4));
const mean = O2_RATIOS.reduce((a, b) => a + b, 0) / O2_RATIOS.length;
check('mean ratio above 1 (crews used more than predicted)', mean > 1, mean.toFixed(3));

// Deviation draws: exact at the given percentiles, held at the ends, interpolated between.
check('traverse median', Math.abs(deviation('traverse', 0.5) - 0.181) < 1e-12, `${deviation('traverse', 0.5)}`);
check('traverse held below P25', deviation('traverse', 0.01) === -0.356, `${deviation('traverse', 0.01)}`);
check('traverse held above P90', deviation('traverse', 0.99) === 2.0, `${deviation('traverse', 0.99)}`);
check('station between P50 and P75', Math.abs(deviation('station', 0.625) - 0.203) < 1e-12, `${deviation('station', 0.625)}`);

// Confidence: large budgets pass every run, budgets of zero pass none, more budget never lowers it.
const plan = { walkSec: [600, 900], workSec: [1500], o2G: 100 };
check('everything fits', returnConfidence(plan, 1e6, 1e6).p === 1, '');
check('nothing fits', returnConfidence(plan, 0, 0).p === 0, '');
let prev = -1, mono = true;
for (const g of [80, 100, 110, 120, 130]) { const p = returnConfidence(plan, 1e6, g).p; if (p < prev) mono = false; prev = p; }
check('more oxygen never lowers the confidence', mono, '');
// With only oxygen binding, the pass share is the share of ratios at or below budget / o2G.
const want = O2_RATIOS.filter((r) => r * 100 <= 110).length / O2_RATIOS.length;
const got = returnConfidence(plan, 1e6, 110, 20000).p;
check('oxygen-only case matches the ratio share', Math.abs(got - want) < 0.02, `${got.toFixed(3)} vs ${want.toFixed(3)}`);
check('same seed, same answer', returnConfidence(plan, 3500, 110).p === returnConfidence(plan, 3500, 110).p, '');

// Safe-return line: a 3 x 3 block of inside cells in a 7 x 7 grid gives a closed outline.
const N = 7, mask = new Uint8Array(N * N);
for (let r = 2; r <= 4; r++) for (let c = 2; c <= 4; c++) mask[r * N + c] = 1;
const segs = contour(mask, N, 2, 7);
const ends = new Map();
for (const [x1, z1, x2, z2] of segs) for (const k of [`${x1},${z1}`, `${x2},${z2}`]) ends.set(k, (ends.get(k) || 0) + 1);
check('outline has segments', segs.length === 12, `${segs.length}`);
check('outline is closed (every end used twice)', [...ends.values()].every((v) => v === 2), '');
// reachMask: time and oxygen must both fit.
const from = { time: Float64Array.from([0, 10, 20]), o2: Float64Array.from([0, 1, 5]) };
const home = { time: Float64Array.from([5, 10, 30]), o2: Float64Array.from([1, 1, 1]) };
check('mask keeps cells that fit both budgets', reachMask(from, home, 25, 3).join('') === '110', reachMask(from, home, 25, 3).join(''));

// Crew pair ratios (crew.js): Apollo 16 EVA 1, CDR 35.8 % and LMP 21.8 % left: 78.2 / 64.2.
check('largest pair ratio is Apollo 16 EVA 1', Math.abs(PAIR_RATIO_MAX - 78.2 / 64.2) < 1e-9, PAIR_RATIO_MAX.toFixed(4));
check('six pair ratios, all at least 1', APOLLO_PAIR_RATIOS.length === 6 && APOLLO_PAIR_RATIOS.every((r) => r >= 1), APOLLO_PAIR_RATIOS.map((r) => r.toFixed(3)).join(' '));
check('median pair ratio between 1.03 and 1.04', PAIR_RATIO_MEDIAN > 1.03 && PAIR_RATIO_MEDIAN < 1.04, PAIR_RATIO_MEDIAN.toFixed(4));
check('ev2 URL value', ev2Ratio(null) === PAIR_RATIO_MEDIAN && ev2Ratio('max') === PAIR_RATIO_MAX && ev2Ratio('1.1') === 1.1 && ev2Ratio('x') === PAIR_RATIO_MEDIAN, '');

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);

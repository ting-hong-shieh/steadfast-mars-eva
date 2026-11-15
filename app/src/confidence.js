// Written with an AI tool (Claude). See AI_USE.md.
// Return confidence: the chance that the rest of the plan ends at the habitat with both the
// oxygen and the time still above the reserve, when the EVA goes the way Apollo EVAs went.
//
// Source (SOURCES.md S38): Miller, Claybrook, Greenlund, Marquez, Feigh, "Operational Assessment
// of Apollo Lunar Surface Extravehicular Activity", NTRS 20170007261. Read in full; the numbers
// below are copied from it and checked against the text (docs/research/2026-11-14-apollo-variability.md).
//
// Method. N runs. Each run is one possible day:
//  - Oxygen: the grams our model expects for the rest of the plan, without the +1 SD band, times
//    one ratio drawn from Apollo "actual / predicted oxygen used". One ratio per run, for the whole
//    EVA: the Apollo ratios are per crew member and EVA, so they already hold the effect of
//    running late on oxygen.
//  - Time: each walking leg is stretched by a draw from the Apollo traverse task deviation, and
//    each station by a draw from the station task deviation. One draw per leg and per station:
//    the report gives these statistics per task.
//  - A run passes when oxygen used <= O2 left - reserve and time used <= time left - reserve.
// The runs use a fixed seed, so the shown number moves only when the plan or the state moves.
//
// LIMITS (also on screen and in the writeup):
//  - This is a model confidence, not a measured risk.
//  - Apollo crews on the Moon, not suited walkers on Mars. Applying the Apollo planners' error to
//    our model is our assumption.
//  - "% remaining" is read as a share of the initial oxygen load; the report does not define it.
//  - The deviation statistics are given as quartiles and a 90th percentile. Below the 25th
//    percentile the draw is held at the 25th (no run is faster than that), and above the 90th it
//    is held at the 90th (the far upper tail is not modelled, which makes the number optimistic).
//  - Ground class errors and walking speed changes are not drawn separately.

// Actual and predicted oxygen % remaining at the end of the EVA, CDR then LMP, for the six EVAs
// the report aggregates (Apollo 15 EVA 1, 16 EVA 1 and 2, 17 EVA 1 to 3). Tables 13, 19, 20, 25,
// 26, 27 (pages 37, 48, 51, 59, 62, 65 of the PDF file; the printed page numbers are 4 lower). Truncated and restructured EVAs are left out, as the
// report does for its aggregate.
export const APOLLO_O2_REMAINING = [
  [21.1, 33.4], [24.2, 33.4],   // A15 EVA 1
  [35.8, 26.9], [21.8, 26.9],   // A16 EVA 1
  [32.6, 27.6], [30.4, 27.6],   // A16 EVA 2
  [19.7, 32.3], [19.1, 32.3],   // A17 EVA 1
  [25.3, 35.9], [24.9, 35.9],   // A17 EVA 2
  [24.9, 30.9], [21.0, 30.9],   // A17 EVA 3
];
export const O2_RATIOS = APOLLO_O2_REMAINING.map(([a, p]) => (100 - a) / (100 - p));

// The two crew members of one EVA: ratio of the larger to the smaller oxygen used (crew.js).
export const APOLLO_PAIR_RATIOS = [];
for (let i = 0; i < APOLLO_O2_REMAINING.length; i += 2) {
  const a = 100 - APOLLO_O2_REMAINING[i][0], b = 100 - APOLLO_O2_REMAINING[i + 1][0];
  APOLLO_PAIR_RATIOS.push(Math.max(a, b) / Math.min(a, b));
}
const pairSorted = [...APOLLO_PAIR_RATIOS].sort((a, b) => a - b);
export const PAIR_RATIO_MAX = pairSorted[pairSorted.length - 1];
export const PAIR_RATIO_MEDIAN = (pairSorted[(pairSorted.length - 1) >> 1] + pairSorted[pairSorted.length >> 1]) / 2;
// EV2's ratio from the URL: 'max', a number, or by default the median Apollo pair
// (team decision of 2026-11-14). The largest pair is used for the film scene (key E, main.js).
export function ev2Ratio(param) {
  if (param === 'max') return PAIR_RATIO_MAX;
  const v = Number(param);
  return param && Number.isFinite(v) && v > 0 ? v : PAIR_RATIO_MEDIAN;
}

// Normalized task duration deviation, (as-performed - planned) / planned, Apollo 15 to 17,
// Table 31 (PDF file page 74): 25th percentile, median, 75th percentile. 90th percentile from the text,
// file pages 74-75: "when considering 90% of the traverse tasks performed during Apollo, the crew required
// potentially up to 200% more time ... Station activity and Overhead tasks required up to 100%
// additional time".
export const DEVIATION = {
  traverse: [[0.25, -0.356], [0.5, 0.181], [0.75, 0.8], [0.9, 2.0]],
  station: [[0.25, -0.333], [0.5, 0.0], [0.75, 0.406], [0.9, 1.0]],
};

// Deviation for a uniform draw u, interpolated between the given percentiles and held at the ends.
export function deviation(kind, u) {
  const q = DEVIATION[kind];
  if (u <= q[0][0]) return q[0][1];
  for (let i = 1; i < q.length; i++) {
    if (u <= q[i][0]) { const [u0, d0] = q[i - 1], [u1, d1] = q[i]; return d0 + (d1 - d0) * (u - u0) / (u1 - u0); }
  }
  return q[q.length - 1][1];
}

// Small seeded generator (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// plan: { walkSec: [...], workSec: [...], o2G } with o2G the grams for the whole rest of the plan
// without the safety band. budgetT, budgetG: time and oxygen above the reserve.
export function returnConfidence(plan, budgetT, budgetG, n = 1000, seed = 20261114) {
  const r = rng(seed);
  let pass = 0;
  const spareG = new Float64Array(n), spareT = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const g = plan.o2G * O2_RATIOS[Math.floor(r() * O2_RATIOS.length)];
    let t = 0;
    for (const s of plan.walkSec) t += s * (1 + deviation('traverse', r()));
    for (const s of plan.workSec) t += s * (1 + deviation('station', r()));
    spareG[k] = budgetG - g; spareT[k] = budgetT - t;
    if (spareG[k] >= 0 && spareT[k] >= 0) pass++;
  }
  const q = (a, p) => { const s = Float64Array.from(a).sort(); return s[Math.min(n - 1, Math.floor(p * n))]; };
  return { p: pass / n, spareG: [q(spareG, 0.05), q(spareG, 0.5), q(spareG, 0.95)], spareT: [q(spareT, 0.05), q(spareT, 0.5), q(spareT, 0.95)], n };
}

// GO at or above this confidence, CAUTION below. Our setting (decision of 2026-11-14), no source.
export const GO_AT = 0.9;

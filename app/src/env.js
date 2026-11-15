// Written with an AI tool (Claude). See AI_USE.md.
// The day the walk replays: sol 4709 at Gale, 4 November 2025 on Earth.
//  - Weather: Curiosity's Rover Environmental Monitoring Station (REMS), PDS Atmospheres node,
//    data set MSL-M-REMS-5-MODRDR-V1.0 (tools/build_rems_series.py). Readings at the rover, about
//    1.5 m above the ground for air, not at a suit.
//  - Earth link: one-way light time from Mars to Earth on that day, from JPL Horizons (DE441),
//    centre of Mars to centre of Earth. A geometric value: no relay orbiter, no antenna, no
//    terrain, no solar conjunction rule.
//  - Sun: where the sun stood in the sky of the main place on that day, from JPL Horizons
//    (tools/build_sun_series.py), every 10 minutes. Airless and over an ideal horizon.
let rems = null, sun = null;

export async function loadEnv() {
  const get = async (file) => { const res = await fetch(`${import.meta.env.BASE_URL}data/${file}`); if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`); return res.json(); };
  [rems, sun] = await Promise.all([get('rems_sol4709.json'), get('sun_sol4709.json')]);
}

// For the tools that run outside a browser (tools/route_check.mjs): the same two files, already read.
export function useEnvForTest(remsJson, sunJson) { rems = remsJson; sun = sunJson; }

// The walk starts at the first REMS bin at or after 08:00 local mean solar time (08:08 LMST,
// 2025-11-04 09:08:36 UTC), so the eight hours fall in daylight. The start hour is our choice.
export const evaStartUtc = () => rems.eva_start.utc;

// One Mars second of local mean solar time is 1.02749 SI seconds (a sol is 88,775.244 s).
const SOL_S = 88775.244;
// The hour of departure (plan screen): the walk starts `shift` SI seconds after 08:08 LMST (before
// it when negative). The weather, the dose rate, the clock and the sun all move with it.
let shift = 0;
export const DEPART_DEFAULT = '08:08';
export function setDeparture(lmst) {
  const [h0, m0] = rems.eva_start.lmst.split(':').map(Number), [h, m] = lmst.split(':').map(Number);
  shift = ((h - h0) * 3600 + (m - m0) * 60) * SOL_S / 86400;
  return shift;
}
export const departureShift = () => shift;

// Azimuth (degrees clockwise from north) and elevation of the sun, `elapsed` seconds into the
// walk. Between two rows the direction is interpolated as a vector, so the azimuth near the
// zenith does not jump.
export function sunNow(elapsed) {
  const t = (Date.parse(rems.eva_start.utc) - Date.parse(sun.start_utc)) / 1000 + shift + elapsed;
  const k = Math.min(sun.rows.length - 2, Math.max(0, Math.floor(t / sun.step_seconds))), f = Math.min(1, Math.max(0, t / sun.step_seconds - k));
  const vec = ([az, el]) => { const a = az * Math.PI / 180, e = el * Math.PI / 180; return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)]; };
  const a = vec(sun.rows[k]), b = vec(sun.rows[k + 1]), v = a.map((x, i) => x + (b[i] - x) * f), n = Math.hypot(...v);
  return { az: (Math.atan2(v[0], v[1]) * 180 / Math.PI + 360) % 360, el: Math.asin(v[2] / n) * 180 / Math.PI };
}
// The local hours between which the sun is above the ideal horizon on that day.
export function daylight() {
  const lmstOf = (k) => { const [h0, m0] = rems.eva_start.lmst.split(':').map(Number);
    const s = h0 * 3600 + m0 * 60 + ((Date.parse(sun.start_utc) - Date.parse(rems.eva_start.utc)) / 1000 + k * sun.step_seconds) * 86400 / SOL_S;
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`; };
  const cross = (up) => { for (let k = 1; k < sun.rows.length; k++) { const a = sun.rows[k - 1][1], b = sun.rows[k][1]; if (up ? a <= 0 && b > 0 : a > 0 && b <= 0) return k - 1 + (0 - a) / (b - a); } return null; };
  return { rise: lmstOf(cross(true)), set: lmstOf(cross(false)) };
}

// JPL Horizons, target Mars (499), centre Earth (500@399), quantity 21 (1-way down-leg light
// time), queried 2026-11-14. Minutes at 2025-11-04 06:00 and 18:00 UT.
const LT = [[Date.parse('2025-11-04T06:00:00Z'), 20.06206361], [Date.parse('2025-11-04T18:00:00Z'), 20.06582334]];

// The last reading at or before t (seconds after the series start), or null before the first one.
function lastAt(rows, t) {
  let lo = 0, hi = rows.length - 1;
  if (!rows.length || t < rows[0][0]) return null;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (rows[mid][0] <= t) lo = mid; else hi = mid - 1; }
  return rows[lo];
}

export function envNow(elapsed) {
  elapsed += shift;
  const t = rems.eva_start.seconds_after_start + elapsed;
  const pick = (k) => { const r = lastAt(rems.series[k], t); return r ? { v: r[1], ageMin: Math.round((t - r[0]) / 60), lmst: r[3] } : null; };
  const [h0, m0] = rems.eva_start.lmst.split(':').map(Number);
  const lm = (h0 * 3600 + m0 * 60 + elapsed * 86400 / SOL_S + 86400) % 86400;
  const utcMs = Date.parse(rems.eva_start.utc) + elapsed * 1000;
  const f = Math.max(0, Math.min(1, (utcMs - LT[0][0]) / (LT[1][0] - LT[0][0])));
  return {
    air: pick('air_k'), ground: pick('ground_k'), pressure: pick('pressure_pa'), uv: pick('uv_abc'),
    lmst: `${String(Math.floor(lm / 3600)).padStart(2, '0')}:${String(Math.floor(lm % 3600 / 60)).padStart(2, '0')}`,
    utc: new Date(utcMs).toISOString().slice(0, 16).replace('T', ' '),
    lightMin: LT[0][1] + f * (LT[1][1] - LT[0][1]),
  };
}
// The whole day of one quantity, for the small curves: [seconds after the walk starts, value].
export const envSeries = (k) => rems.series[k].map((r) => [r[0] - rems.eva_start.seconds_after_start - shift, r[1]]);

// Written with an AI tool (Claude). See AI_USE.md.
// Dose rate measured by the Radiation Assessment Detector (RAD) on Curiosity, at Gale crater.
// Data: PDS PPI node, data set MSL-M-RAD-3-RDR-V1.0. tools/build_rad_series.py copies the
// values under [DOSIMETRY_TOTAL_DOSE_E] (plastic scintillator E, microgray per hour).
// These are readings inside the instrument on the rover deck. They are not a dose in a suit.

const series = {};

export async function loadRad(startUtc) {
  for (const [key, file] of [['quiet', 'rad_sol4709.json'], ['event', 'rad_event_20240520.json']]) {
    const res = await fetch(`${import.meta.env.BASE_URL}data/${file}`);
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    series[key] = await res.json();
  }
  // The quiet-day readings run from the moment the walk starts (env.js: 08:08 LMST on sol 4709),
  // so the dose rate, the weather and the clock on screen belong to the same minutes of that day.
  const q = series.quiet;
  q.base = startUtc ? (Date.parse(startUtc) - Date.parse(q.start_utc)) / 1000 : 0;
  setRadShift(0);
  const ev = series.event;
  // The replay starts at the first reading that meets the alarm rule (2024-05-20 05:21:50 UTC).
  ev.replayStart = (Date.parse(REPLAY_START_UTC) - Date.parse(ev.start_utc)) / 1000;
  const before = ev.rows.filter((r) => r[0] < ev.replayStart).map((r) => r[1]).sort((a, b) => a - b);
  ev.quiet = before[Math.floor(before.length / 2)];   // median of the readings before the rise
  ev.peak = Math.max(...ev.rows.map((r) => r[1]));
  // First reading at or after the replay start that meets the alarm rule.
  const hit = ev.rows.find((r) => r[0] >= ev.replayStart && r[1] >= ALARM_FACTOR * ev.quiet);
  ev.firstAlarm = hit ? hit[0] : Infinity;
}
// The hour of departure moved by `shift` seconds (env.js setDeparture): the quiet-day readings
// then run from that minute of the same sol.
export function setRadShift(shift) {
  const q = series.quiet;
  q.offset = Math.max(0, Math.min(q.rows[q.rows.length - 1][0], q.base + shift));
}
// The dose of the quiet day between two times of the walk (seconds after it starts), in microgray:
// what the plan screen shows for a planned walk. Inside the instrument, as every RAD number here.
export const radDose = (from, to) => dose(series.quiet, series.quiet.offset + from, series.quiet.offset + to);
export const REPLAY_START_UTC = '2024-05-20T05:21:50Z';
// Alarm rule of Löwe et al. 2025 (arXiv 2502.02469, a preprint): "an astronaut is warned as soon
// as dose rates exceed the omnipresent background level by at least 25%". Our background level is
// the median of the readings in the nine hours before the rise. The paper may define it differently.
export const ALARM_FACTOR = 1.25;

// The reading in force at time t (seconds after the start of the series): the last row at or before t.
function rowAt(rows, t) {
  let lo = 0, hi = rows.length - 1;
  if (t <= rows[0][0]) return rows[0];
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (rows[mid][0] <= t) lo = mid; else hi = mid - 1; }
  return rows[lo];
}
function utcAt(s, t) { return new Date(Date.parse(s.start_utc) + t * 1000).toISOString().slice(0, 16).replace('T', ' '); }

// Sum of rate x time between two times of one series, in microgray. Step function, no smoothing.
function dose(s, t0, t1) {
  const rows = s.rows; let sum = 0;
  const end = Math.min(t1, rows[rows.length - 1][0]);
  for (let i = 0; i < rows.length; i++) {
    const a = Math.max(t0, rows[i][0]), b = Math.min(end, i + 1 < rows.length ? rows[i + 1][0] : end);
    if (b > a) sum += rows[i][1] * (b - a) / 3600;
  }
  return sum;
}

// What the panel shows at EVA time `elapsed` (s). `alarmAt` is the EVA time when the event replay began, or null.
// Before the alarm the readings of sol 4709 run from their first row. After it the readings of 2024-05-20 run.
export function radNow(elapsed, alarmAt) {
  const q = series.quiet, ev = series.event;
  const last = q.rows[q.rows.length - 1][0];
  if (alarmAt === null) {
    const t = Math.min(last, q.offset + elapsed);
    return { rate: rowAt(q.rows, t)[1], total: dose(q, q.offset, t), replay: false, label: 'RAD · SOL 4709', utc: utcAt(q, t) };
  }
  const t = ev.replayStart + (elapsed - alarmAt);
  const ta = Math.min(last, q.offset + alarmAt);
  const rate = rowAt(ev.rows, t)[1];
  return {
    // alarm: this reading meets the rule. latched: some reading since the replay start has met it.
    rate, alarm: rate >= ALARM_FACTOR * ev.quiet, latched: t >= ev.firstAlarm, total: dose(q, q.offset, ta) + dose(ev, ev.replayStart, t),
    replay: true, label: 'RAD · 2024-05-20 REPLAY', utc: utcAt(ev, Math.min(t, ev.rows[ev.rows.length - 1][0])),
    quiet: ev.quiet, peak: ev.peak, ended: t > ev.rows[ev.rows.length - 1][0],
  };
}

// The two series for the small curves on screen: [seconds, microgray per hour]. The quiet day is
// counted from the start of the walk, the event from the start of its replay.
export const radCurve = (key) => key === 'event'
  ? series.event.rows.map((r) => [r[0] - series.event.replayStart, r[1]])
  : series.quiet.rows.map((r) => [r[0] - series.quiet.offset, r[1]]);

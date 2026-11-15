// Written with an AI tool (Claude). See AI_USE.md.
// Line of sight between the suit and the habitat over the terrain (issue #42).
//
// This is geometry only. It says whether the ground model rises above the straight line between
// two antennas. It does not say that a radio link works: diffraction over a ridge, reflections,
// the antenna pattern, power and range are not modelled.

// Antenna heights above the ground. Our assumptions, shown on screen, no source yet (issue #42).
export const SUIT_ANT_M = 1.5;
export const HAB_ANT_M = 3.0;
// Band for UNCERTAIN: 1 m. The USGS page of the elevation model (SOURCES.md S6) says the mosaic is
// "only as accurate as MOLA (~100m horizontal and ~1 m vertical accuracy)". That is the absolute
// accuracy of the whole mosaic. The page gives no figure for the error between two points a few
// hundred metres apart, which is what matters here, so using 1 m is our cautious assumption.
export const DEM_V_ERR_M = 1.0;

// Smallest clearance between the line from antenna A to antenna B and the ground below it.
// height(x, z) gives the ground height. Samples every `step` metres, ends excluded.
// Returns { state: 'CLEAR' | 'BLOCKED' | 'UNCERTAIN', clearance (m), at (m from A), len (m) }.
export function lineOfSight(height, ax, az, bx, bz, hA = SUIT_ANT_M, hB = HAB_ANT_M, step = 1) {
  const ya = height(ax, az) + hA, yb = height(bx, bz) + hB;
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(len / step));
  let clearance = Math.min(hA, hB), at = 0;
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const g = height(ax + (bx - ax) * t, az + (bz - az) * t);
    if (!Number.isFinite(g)) return { state: 'UNCERTAIN', clearance: NaN, at: t * len, len };
    const c = ya + (yb - ya) * t - g;
    if (c < clearance) { clearance = c; at = t * len; }
  }
  const state = clearance > DEM_V_ERR_M ? 'CLEAR' : clearance < -DEM_V_ERR_M ? 'BLOCKED' : 'UNCERTAIN';
  return { state, clearance, at, len };
}

// The state shown on screen. It changes only when the clearance passes a threshold by more than
// `hold` metres, so small bumps do not make the row flicker between two states while walking.
export function stateWithHold(prev, clearance, band = DEM_V_ERR_M, hold = 0.3) {
  if (!Number.isFinite(clearance)) return 'UNCERTAIN';
  const fresh = clearance > band ? 'CLEAR' : clearance < -band ? 'BLOCKED' : 'UNCERTAIN';
  if (!prev || fresh === prev) return fresh;
  if (prev === 'CLEAR' && clearance > band - hold) return prev;
  if (prev === 'BLOCKED' && clearance < -band + hold) return prev;
  if (prev === 'UNCERTAIN' && Math.abs(clearance) < band + hold) return prev;
  return fresh;
}

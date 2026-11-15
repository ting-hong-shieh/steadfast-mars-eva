// Written with an AI tool (Claude). See AI_USE.md.
// Where to put each foot, chosen from the ground heights.
//
// Method, with its sources (rows S12 and S13 in SOURCES.md):
//  - A foothold is tested on the 5 cm height grid. Griffin et al. 2019 search footsteps on a 5 cm
//    grid and reject a foothold when the surface is too steep, when too little of the foot is
//    supported, or when the step is too far or too high from the stance foot (their section
//    "Edge Checking").
//  - The score of a foothold is the share of height cells under the foot that lie close to the
//    foot's plane. McCrory et al. 2022 score a foothold region as "the percentage of sampled
//    height map cells with a sufficiently low incline and within a certain proximity of the
//    node's height" (their section III-C).
//  - The search here is greedy: one step at a time along the planned route. Both papers use an
//    A* search over many steps. This is a simplification.
//
// NOT FROM A SOURCE: every number in PARAMS. No source was found for the boot size, stride or
// slope limit of a suited person on Mars. People decide these (issue 14).
import { heightAt, measuredAt } from './terrain.js';

export const PARAMS = {
  stride: 0.62,          // metres between one footfall and the next, along the route
  halfWidth: 0.17,       // metres from the route line to the middle of each foot
  footLength: 0.30, footWidth: 0.12,
  cell: 0.05,            // the height grid under the foot
  planeTol: 0.03,        // a cell supports the foot if it is within this of the foot's plane
  maxInclineDeg: 25,     // reject a foothold steeper than this
  maxStepUp: 0.30,       // reject a step higher or lower than this from the stance foot
  minSupport: 0.6,       // reject a foothold with a smaller supported share
  shiftAlong: [-0.20, -0.10, 0, 0.10, 0.20],
  shiftAcross: [-0.10, -0.05, 0, 0.05, 0.10],
  shiftCost: 0.8,        // score lost per metre moved away from the nominal place
};

// Fit a plane to the heights under a foot centred at (x, z) and pointing along `heading`.
export function evaluate(x, z, heading, P = PARAMS) {
  const fx = Math.sin(heading), fz = -Math.cos(heading);   // forward
  const rx = Math.cos(heading), rz = Math.sin(heading);    // right
  const us = [], vs = [], hs = [];
  let measured = 0;
  const nu = Math.max(2, Math.round(P.footLength / P.cell)), nv = Math.max(2, Math.round(P.footWidth / P.cell));
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const u = (i - (nu - 1) / 2) * P.cell, v = (j - (nv - 1) / 2) * (P.footWidth / nv);
      const px = x + fx * u + rx * v, pz = z + fz * u + rz * v;
      us.push(u); vs.push(v); hs.push(heightAt(px, pz));
      if (measuredAt(px, pz)) measured++;
    }
  }
  const n = hs.length;
  // Least squares for h = a u + b v + c. The sample points form a centred grid, so the sums of
  // u, v and u v are zero and the three unknowns separate. Heights are centred first.
  let sh = 0;
  for (let i = 0; i < n; i++) sh += hs[i];
  const c = sh / n;
  let suu = 0, svv = 0, suh = 0, svh = 0;
  for (let i = 0; i < n; i++) { suu += us[i] * us[i]; svv += vs[i] * vs[i]; suh += us[i] * (hs[i] - c); svh += vs[i] * (hs[i] - c); }
  const a = suh / suu, b = svh / svv;
  let ok = 0;
  for (let i = 0; i < n; i++) if (Math.abs(hs[i] - (a * us[i] + b * vs[i] + c)) <= P.planeTol) ok++;
  return {
    y: c, pitch: Math.atan(a), roll: Math.atan(b),
    inclineDeg: Math.atan(Math.hypot(a, b)) * 180 / Math.PI,
    support: ok / n, measuredShare: measured / n,
  };
}

// One foothold per stride along the route. Returns an array ordered by distance along the route.
export function planFootholds(route, P = PARAMS) {
  const out = [];
  let prevY = null;
  const stats = { steps: 0, measured: 0, moved: 0, noValid: 0 };
  for (let k = 1; k * P.stride < route.length; k++) {
    const s = k * P.stride;
    const { p, heading } = route.at(s);
    const side = k % 2 === 0 ? -1 : 1;
    const fx = Math.sin(heading), fz = -Math.cos(heading), rx = Math.cos(heading), rz = Math.sin(heading);
    const nx = p.x + rx * side * P.halfWidth, nz = p.z + rz * side * P.halfWidth;
    let best = null;
    for (const da of P.shiftAlong) {
      for (const dc of P.shiftAcross) {
        const x = nx + fx * da + rx * dc, z = nz + fz * da + rz * dc;
        const e = evaluate(x, z, heading, P);
        const valid = e.inclineDeg <= P.maxInclineDeg && e.support >= P.minSupport
          && (prevY === null || Math.abs(e.y - prevY) <= P.maxStepUp);
        const value = (valid ? 1 : 0) + e.support - P.shiftCost * Math.hypot(da, dc);
        if (!best || value > best.value) best = { x, z, e, valid, value, moved: Math.hypot(da, dc) };
      }
    }
    const measured = best.e.measuredShare >= 0.5;
    out.push({
      s, side, heading, x: best.x, z: best.z, y: best.e.y, pitch: best.e.pitch, roll: best.e.roll,
      inclineDeg: best.e.inclineDeg, support: best.e.support, valid: best.valid, measured, moved: best.moved,
    });
    prevY = best.e.y;
    stats.steps++; if (measured) stats.measured++; if (best.moved > 0) stats.moved++; if (!best.valid) stats.noValid++;
  }
  out.stats = stats;
  return out;
}

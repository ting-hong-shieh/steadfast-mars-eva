// Written with an AI tool (Claude). See AI_USE.md.
// Runs the spread from the astronaut's cell off the main thread (about 0.1 s on the full
// 300 x 300 grid), so the view does not stutter when the safe-return line is updated. The spread
// uses the plan in force (least oxygen, with the factors the crew switched on), as the way home does.
import { spread, cellOf, useHeightsForTest, useEta, usePlan } from './planner.js';

let kmh = 2.7;
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { useHeightsForTest(m.heights); useEta(m.eta); kmh = m.kmh; if (m.cost) usePlan(m.cost); return; }
  if (m.type === 'eta') { useEta(m.eta); return; }
  if (m.type === 'plan') { usePlan(m.cost); return; }
  const f = spread(cellOf(m.x, m.z), kmh, false, 'plan');
  self.postMessage({ id: m.id, x: m.x, z: m.z, time: f.time, o2: f.o2 }, [f.time.buffer, f.o2.buffer]);
};

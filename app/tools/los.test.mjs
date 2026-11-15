// Written with an AI tool (Claude). See AI_USE.md.
// Checks the line-of-sight geometry against cases with a known answer. Usage: npm test
import { lineOfSight, stateWithHold, SUIT_ANT_M, HAB_ANT_M, DEM_V_ERR_M } from '../src/los.js';

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  ${detail}`); if (!ok) failed++; };

// 1. Flat ground: the line stays at least the lower antenna height above the ground.
let r = lineOfSight(() => 0, 0, 0, 100, 0);
check('flat ground is clear', r.state === 'CLEAR' && Math.abs(r.clearance - SUIT_ANT_M) < 1e-9, `${r.state} ${r.clearance.toFixed(3)} m`);

// 2. A wall 10 m high halfway: blocked, and the lowest point is at the wall.
const wall = (h) => (x) => (Math.abs(x - 50) < 0.6 ? h : 0);
r = lineOfSight(wall(10), 0, 0, 100, 0);
const lineAt50 = (SUIT_ANT_M + HAB_ANT_M) / 2;
check('10 m wall blocks', r.state === 'BLOCKED' && Math.abs(r.clearance - (lineAt50 - 10)) < 1e-9 && Math.abs(r.at - 50) < 1e-9, `${r.state} ${r.clearance.toFixed(3)} m at ${r.at} m`);

// 3. A wall that reaches the line height to within the DEM error: uncertain.
r = lineOfSight(wall(lineAt50 - 0.5), 0, 0, 100, 0);
check('wall 0.5 m under the line is uncertain', r.state === 'UNCERTAIN' && Math.abs(r.clearance - 0.5) < 1e-9, `${r.state} ${r.clearance.toFixed(3)} m`);
r = lineOfSight(wall(lineAt50 - DEM_V_ERR_M - 0.1), 0, 0, 100, 0);
check('wall 1.1 m under the line is clear', r.state === 'CLEAR', `${r.state} ${r.clearance.toFixed(3)} m`);

// 4. A ridge seen from the high side: the line drops toward a low habitat and hits the crest.
// Suit on a 20 m hill at x = 0, a 21 m crest at x = 40, habitat at x = 100 on flat ground.
const ridge = (x) => (x <= 30 ? 20 : x <= 50 ? 21 : 0);
r = lineOfSight(ridge, 0, 0, 100, 0);
check('crest between suit and habitat blocks', r.state === 'BLOCKED', `${r.state} ${r.clearance.toFixed(2)} m at ${r.at.toFixed(0)} m`);

// 5. Missing data is uncertain, never clear.
r = lineOfSight((x) => (x > 40 && x < 60 ? NaN : 0), 0, 0, 100, 0);
check('missing ground data is uncertain', r.state === 'UNCERTAIN', r.state);

// 6. Same point: no samples between the antennas, clear.
r = lineOfSight(() => 5, 3, 3, 3, 3);
check('zero length is clear', r.state === 'CLEAR' && r.len === 0, `${r.state} ${r.clearance}`);

// 7. The shown state holds until the clearance passes the threshold by 0.3 m.
check('clear holds at 0.9 m', stateWithHold('CLEAR', 0.9) === 'CLEAR', stateWithHold('CLEAR', 0.9));
check('clear drops at 0.6 m', stateWithHold('CLEAR', 0.6) === 'UNCERTAIN', stateWithHold('CLEAR', 0.6));
check('uncertain holds at 1.2 m', stateWithHold('UNCERTAIN', 1.2) === 'UNCERTAIN', stateWithHold('UNCERTAIN', 1.2));
check('uncertain becomes clear at 1.4 m', stateWithHold('UNCERTAIN', 1.4) === 'CLEAR', stateWithHold('UNCERTAIN', 1.4));
check('blocked holds at -0.8 m', stateWithHold('BLOCKED', -0.8) === 'BLOCKED', stateWithHold('BLOCKED', -0.8));
check('no previous state uses the plain rule', stateWithHold(null, 1.05) === 'CLEAR', stateWithHold(null, 1.05));

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);

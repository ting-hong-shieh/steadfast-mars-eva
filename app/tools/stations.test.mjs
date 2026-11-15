// Written with an AI tool (Claude). See AI_USE.md.
// The station places typed in route.js must match the stops in stations.json
// (made from MSL PLACES by tools/station_photos.py).
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/route.js', import.meta.url), 'utf8');
const j = JSON.parse(readFileSync(new URL('../public/data/stations.json', import.meta.url), 'utf8'));
let failed = 0;
for (const st of j.stations) {
  const m = src.match(new RegExp(`\\{ x: ([-\\d.]+), z: ([-\\d.]+), name: '${st.id}', target: '${st.target}', sol: ${st.sol}`));
  const ok = m && Math.abs(Number(m[1]) - st.x) < 0.01 && Math.abs(Number(m[2]) - st.z) < 0.01;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${st.id} ${st.target} sol ${st.sol} at (${st.x}, ${st.z})`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);

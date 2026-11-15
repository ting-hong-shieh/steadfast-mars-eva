// Written with an AI tool (Claude). See AI_USE.md.
// The chemistry block of the station card (src/chem.js) against its data file
// (public/data/station_chemistry.json, made by tools/build_station_chemistry.py).
//  1. Every station with a photo has an entry at the same rover position (site and drive).
//  2. Every number the block prints is a number of the file, printed with one decimal
//     (the errors of APXS with two), and nothing is printed as "undefined" or "NaN".
//  3. The limits the archives state hold for what is shown: no shown oxide of a ChemCam point
//     lies beyond the test set of its model, and no sum of oxides is above 110.
import { readFileSync } from 'node:fs';
import { chemHtml, chemcamFacts, duration, range } from '../src/chem.js';
const read = (f) => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8'));
const chem = read('station_chemistry.json'), stations = read('stations.json').stations;
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };

check(duration('00:22:00') === '22 min' && duration('01:32:24') === '1 h 32 min' && duration('02:00:00') === '2 h' && duration('00:00:40') === '0 min', 'duration: 00:22:00 is 22 min, 01:32:24 is 1 h 32 min, 02:00:00 is 2 h');
check(range(2.26, 2.26) === '2.3' && range(2.25, 3.86) === '2.3 to 3.9', 'range: one value when both ends print the same');
check(chem.inputs.length === 5 && chem.inputs.every((i) => /^[0-9a-f]{64}$/.test(i.sha256)), 'the file names its five input tables with their checksums');
check(!chem.columns.includes('MnO'), 'MnO is not a column (APXS release note on low MnO values after sol 4400)');

for (const st of stations) {
  const c = chem.stations.find((q) => q.id === st.id);
  check(c && c.site === st.site && c.drive === st.drive, `${st.id}: an entry at site ${st.site}, drive ${st.drive}`);
  if (!c) continue;
  const doc = { columns: chem.columns, sols: c.sols, apxs: c.apxs, chemcam: c.chemcam }, html = chemHtml(doc);
  check(html && !/undefined|NaN|null|\[object/.test(html), `${st.id}: the block has no empty value`);
  for (const r of [...c.apxs, ...c.chemcam]) check(html.includes(`<b>${r.target.replace(/_/g, ' ')}</b>`) && c.sols.includes(r.sol), `${st.id}: ${r.target} is a row and its sol ${r.sol} is one of the station's`);
  check(html.includes(`· SOLS ${Math.min(...c.sols)}–${Math.max(...c.sols)} ·`), `${st.id}: the heading gives sols ${Math.min(...c.sols)} to ${Math.max(...c.sols)}`);
  // Every cell, in the order of the page, against the file.
  const cells = [...html.matchAll(/<td(?: class="none")?>(.*?)<\/td>/g)].map((m) => m[1]).filter((s) => !s.startsWith('<b>'));
  const want = [
    ...c.apxs.flatMap((r) => chem.columns.map((k) => (r.wt[k] ? `${r.wt[k][0].toFixed(1)}<span>±${r.wt[k][1].toFixed(2)}</span>` : '–'))),
    ...c.chemcam.flatMap((r) => chem.columns.map((k) => (r.wt[k] ? `${r.wt[k].median.toFixed(1)}<span>${range(r.wt[k].min, r.wt[k].max, '–')}</span>` : '–'))),
  ];
  check(cells.length === want.length && cells.every((s, i) => s === want[i]), `${st.id}: ${want.length} cells equal the file`);
  for (const r of c.chemcam) {
    check(r.sum_of_oxides[1] <= 110, `${st.id}: ${r.target} sum of oxides ${r.sum_of_oxides[1]} is not above 110`);
    check(chem.columns.every((k) => !(r.outside_test_set || {})[k]), `${st.id}: ${r.target} has no shown oxide beyond the test set`);
    check(chem.columns.every((k) => !r.wt[k] || (r.wt[k].min <= r.wt[k].median && r.wt[k].median <= r.wt[k].max)), `${st.id}: ${r.target} middle values lie between lowest and highest`);
  }
  if (c.chemcam.length) {
    const f = chemcamFacts(doc);
    check(html.includes(`an error of ${range(...f.rmsep)}, by oxide`) && html.includes(`${f.points[0]} points per target`) && f.points[0] === f.points[1], `${st.id}: the text gives the error ${range(...f.rmsep)} and the ${f.points[0]} points of its own rows`);
  }
}
check(chemHtml(undefined) === '' && chemHtml({ columns: chem.columns, sols: [], apxs: [], chemcam: [] }) === '', 'no block for a stop without measurements');
process.exit(failed ? 1 : 0);

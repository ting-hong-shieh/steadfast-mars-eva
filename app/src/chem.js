// Written with an AI tool (Claude). See AI_USE.md.
// The chemistry Curiosity measured at a station, as a block of the station card (visit.js).
//
// The numbers come from public/data/station_chemistry.json, which tools/build_station_chemistry.py
// makes from the NASA PDS tables of the two instruments (SOURCES.md, S63). This file only formats
// them. It adds no number of its own and it says nothing about what the rocks are.
//  - APXS: the value and the error of the table.
//  - ChemCam: one line for a target. The middle value (median) of its points for each oxide, with
//    the lowest and the highest point under it.
// Target names are the names of the tables with the underscores shown as spaces. The words under
// a ChemCam target ("Bedrock", "Vein") are the target type of the ChemCam observation table. Under
// an APXS target stands how long the measurement ran. The sols of the rows stand in the heading.

const oxide = (k) => k.replace(/\d/g, (d) => `<sub>${d}</sub>`);
const label = (t) => t.replace(/_/g, ' ');
const one = (v) => v.toFixed(1);
// "01:35:00" is 1 h 35 min of measuring. The seconds are dropped.
export const duration = (hms) => { const [h, m] = hms.split(':').map(Number); return [h ? `${h} h` : '', m || !h ? `${m} min` : ''].filter(Boolean).join(' '); };
// "2.3" when both ends round to the same value, "2.3 to 3.9" otherwise.
export const range = (lo, hi, sep = ' to ') => (one(lo) === one(hi) ? one(lo) : `${one(lo)}${sep}${one(hi)}`);

// What the text of the block says about the ChemCam rows of one station, counted from those rows.
export function chemcamFacts(doc) {
  const rows = doc.chemcam, cols = doc.columns;
  const points = rows.map((r) => r.points);
  const rmsep = rows.flatMap((r) => cols.filter((c) => r.wt[c]).flatMap((c) => r.wt[c].rmsep));
  return {
    points: [Math.min(...points), Math.max(...points)],
    rmsep: [Math.min(...rmsep), Math.max(...rmsep)],
    absent: cols.filter((c) => rows.every((r) => !r.wt[c])),
  };
}

// `doc`: the columns of the file and one of its stations ({ columns, sols, apxs, chemcam }).
export function chemHtml(doc) {
  if (!doc || !(doc.apxs.length + doc.chemcam.length)) return '';
  const cols = doc.columns, none = '<td class="none">–</td>';
  const row = (r, under, cell) => `<tr><th><b>${label(r.target)}</b><span>${under}</span></th>${cols.map((c) => (r.wt[c] ? cell(r.wt[c]) : none)).join('')}</tr>`;
  const apxs = doc.apxs.map((r) => row(r, `${duration(r.lifetime)} of measuring`, (v) => `<td>${one(v[0])}<span>±${v[1].toFixed(2)}</span></td>`)).join('');
  const ccam = doc.chemcam.map((r) => row(r, r.type, (v) => `<td>${one(v.median)}<span>${range(v.min, v.max, '–')}</span></td>`)).join('');
  const f = doc.chemcam.length ? chemcamFacts(doc) : null;
  const pts = f && (f.points[0] === f.points[1] ? `${f.points[0]}` : `${f.points[0]} to ${f.points[1]}`);
  const sols = [Math.min(...doc.sols), Math.max(...doc.sols)];
  return `<section class="chem">
    <b><i class="kd" data-kind="measured"></i>WHAT CURIOSITY MEASURED HERE · ${sols[0] === sols[1] ? `SOL ${sols[0]}` : `SOLS ${sols[0]}–${sols[1]}`} · WEIGHT PERCENT</b>
    <table>
      <thead><tr><th></th>${cols.map((c) => `<th>${oxide(c)}</th>`).join('')}</tr></thead>
      <tbody>
        ${apxs ? `<tr class="grp"><td colspan="${cols.length + 1}"><b>APXS</b>X-ray sensor on the arm, on or just above the target. Under each value: its error.</td></tr>${apxs}` : ''}
        ${ccam ? `<tr class="grp"><td colspan="${cols.length + 1}"><b>CHEMCAM</b>Laser from the rover's mast, ${pts} points per target, each about 0.5 mm wide. Under the middle value: the lowest and the highest point.</td></tr>${ccam}` : ''}
      </tbody>
    </table>
    <small>${f ? `${f.absent.length ? `ChemCam's table has no ${f.absent.map(oxide).join(', ')}. ` : ''}It names its iron FeOT and gives one point an error of ${range(...f.rmsep)}, by oxide. ` : ''}${apxs && ccam ? 'The two methods are not compared here. ' : ''}Source: NASA Planetary Data System.</small>
  </section>`;
}

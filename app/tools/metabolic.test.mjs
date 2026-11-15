// Written with an AI tool (Claude). See AI_USE.md.
// Checks the oxygen model against the worked example of the metabolic research report
// (scripts/chain_example.py there: body 80 kg, MKIII-like suit 121 kg, Mars gravity).
import { vo2Level, vo2Grade, vo2Walk, minettiCw, vo2ToGPerMin, vo2ToWatts, edgeO2, kjhToGPerMin, LEAK_KJ_H, BAND, supply, hrFromVo2, WEIGHT_VO2_PER_KG } from '../src/metabolic.js';
import { spread, cellOf, useHeightsForTest, GRID_N } from '../src/planner.js';

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  ${detail}`); if (!ok) failed++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// Worked example rows: v, grade, eta -> VO2 (ml/kg/min), O2 (g/h), power (W).
const rows = [
  [0.8, 0, 1.0, 15.8, 108, 440],
  [1.2, 0, 1.0, 25.9, 177, 721],
  [1.2, 0, 1.2, 31.1, 213, 865],
  [1.2, 0.10, 1.2, 38.9, 267, 1084],
  [0.8, 0.20, 1.2, 30.7, 210, 855],
];
for (const [v, i, eta, vo2, gph, w] of rows) {
  const got = vo2Walk(v, i, eta);
  check(`VO2 at ${v} m/s, grade ${i}, eta ${eta}`, near(got, vo2, 0.1), `${got.toFixed(2)} expected ${vo2}`);
  check(`  oxygen g/h`, near(vo2ToGPerMin(got) * 60, gph, 1), `${(vo2ToGPerMin(got) * 60).toFixed(1)} expected ${gph}`);
  check(`  power W`, near(vo2ToWatts(got), w, 2), `${vo2ToWatts(got).toFixed(1)} expected ${w}`);
}
// The report's -10 % row (26.6) counts the downhill saving. The budget sets it to 0 instead.
check('downhill saving is not counted', vo2Grade(-0.1, 1.2) === 0, `${vo2Grade(-0.1, 1.2)}`);
check('Minetti Cw(0) = 2.5 J/kg/m', near(minettiCw(0), 2.5, 1e-12), `${minettiCw(0)}`);
check('level fits meet near 1.07 m/s', near(vo2Level(1.0699), vo2Level(1.0701), 0.3), `${vo2Level(1.0699).toFixed(2)} vs ${vo2Level(1.0701).toFixed(2)}`);
check('no speed above 1.53 m/s', vo2Level(2) === vo2Level(1.53), `${vo2Level(2).toFixed(2)}`);
check('heart rate line: VO2 15 -> about 100 bpm', near(hrFromVo2(15), 99.7, 0.1), `${hrFromVo2(15).toFixed(1)}`);

// Oxygen on one edge = (VO2 + band) rate + leak, over the walking time.
const e = edgeO2(100, 0.75, 0, 1.2, true);
const want = (vo2ToGPerMin(1.2 * vo2Level(0.75) + BAND) + kjhToGPerMin(LEAK_KJ_H)) * (100 / 0.75) / 60;
check('edge oxygen, 100 m flat', near(e, want, 1e-9), `${e.toFixed(2)} g`);
const sup = supply(8, 30);
check('supply = 8 h at 980 + 211 kJ/h', near(sup.totalG, kjhToGPerMin(1191) * 480, 1e-9), `${sup.totalG.toFixed(0)} g, reserve ${sup.reserveG.toFixed(0)} g`);

// Carried equipment. The walkback test gives the cost of the suit's weight at 3/8 g: 1.7, 1.6 and
// 2.0 ml/kg/min at the three walking speeds for the 121 kg suit system (NASA/TP-2009-214796,
// Table 5). Per kg of carried mass that is their mean divided by 121.
check('weight cost per kg carried', near(WEIGHT_VO2_PER_KG, (1.7 + 1.6 + 2.0) / 3 / 121, 1e-12), `${WEIGHT_VO2_PER_KG.toFixed(5)} ml/kg/min per kg`);
check('no load: the model is unchanged', vo2Walk(0.75, 0.1, 1.2, 0) === vo2Walk(0.75, 0.1, 1.2) && edgeO2(100, 0.75, 0.1, 1.2, true, 0) === edgeO2(100, 0.75, 0.1, 1.2, true), `${vo2Walk(0.75, 0.1, 1.2).toFixed(2)} ml/kg/min`);
check('121 kg carried on the level costs what the suit weight cost', near(vo2Walk(0.75, 0, 1.0, 121) - vo2Walk(0.75, 0, 1.0), (1.7 + 1.6 + 2.0) / 3, 1e-9), `${(vo2Walk(0.75, 0, 1.0, 121) - vo2Walk(0.75, 0, 1.0)).toFixed(2)} ml/kg/min`);
check('20 kg carried: level term', near(vo2Walk(0.75, 0, 1.2, 20) - vo2Walk(0.75, 0, 1.2), 1.2 * 20 * WEIGHT_VO2_PER_KG, 1e-9), `+${(vo2Walk(0.75, 0, 1.2, 20) - vo2Walk(0.75, 0, 1.2)).toFixed(3)} ml/kg/min`);
check('20 kg carried: the climb term grows by 20 / (80 + 121)', near(vo2Grade(0.2, 0.8, 20) / vo2Grade(0.2, 0.8), 1 + 20 / 201, 1e-9), `x${(vo2Grade(0.2, 0.8, 20) / vo2Grade(0.2, 0.8)).toFixed(4)}`);

// Planner: on flat ground the least-oxygen path is the least-time path, and its oxygen is
// the time times the flat rate.
const N = GRID_N;
useHeightsForTest(new Float32Array(N * N));
const ft = spread(cellOf(0, 0), 2.7, true, 'time'), fo = spread(cellOf(0, 0), 2.7, true, 'o2');
const c = cellOf(100, 0);
check('flat: same time either way', near(ft.time[c], fo.time[c], 1e-6), `${ft.time[c].toFixed(1)} s`);
check('flat: oxygen of 100 m', near(fo.o2[c], edgeO2(100, 0.75, 0), 0.01), `${fo.o2[c].toFixed(2)} g`);
// On a uniform slope, the least-oxygen path never uses more oxygen than the least-time path.
const S = 0.25, h = new Float32Array(N * N);
for (let r = 0; r < N; r++) for (let col = 0; col < N; col++) h[r * N + col] = S * col * 2;
useHeightsForTest(h);
const a = cellOf(-60, 0), b = cellOf(60, 0);
const pt = spread(a, 2.7, false, 'time'), po = spread(a, 2.7, false, 'o2');
check('slope: least-oxygen path uses no more oxygen', po.o2[b] <= pt.o2[b] + 1e-9, `${po.o2[b].toFixed(1)} g vs ${pt.o2[b].toFixed(1)} g`);
check('slope: uphill costs more oxygen than downhill', spread(b, 2.7, false, 'o2').o2[a] < po.o2[b], `down ${spread(b, 2.7, false, 'o2').o2[a].toFixed(1)} g, up ${po.o2[b].toFixed(1)} g`);

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);

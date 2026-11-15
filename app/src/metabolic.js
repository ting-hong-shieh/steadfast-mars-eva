// Written with an AI tool (Claude). See AI_USE.md.
// Oxygen use of a suited person walking on Mars: speed, grade and ground -> VO2 -> oxygen.
//
// The chain and every number come from the metabolic research report (docs/methods.md, row
// "Oxygen"; SOURCES.md rows S21 to S27). Each constant names its source below.
//
// LIMITS (also in the writeup):
//  - All suited data at Mars gravity come from one prototype suit (MKIII, 121 kg system), six men,
//    level treadmill, 1.07 to 1.53 m/s (Norcross et al. 2009, NASA/TP-2009-214796).
//  - Slopes at 0.38 g were never measured. The slope term was checked against suited data only up
//    to 0.32 g (Norcross et al. 2010, IST-2).
//  - Ground factors come from Earth studies without a suit.
//  - Heart rate is shown only through a population line with a wide band. It never sets the budget.

// Mars gravity as a fraction of Earth's: 3.71 / 9.81.
export const G_MARS = 0.378;
// Body and suit system mass of the NASA walkback test (NASA/TP-2009-214796: MKIII 121 kg incl.
// PLSS mock-up and gimbal). The body mass is the round value used in the report's worked example.
export const BODY_KG = 80;
export const SUIT_KG = 121;
// Energy per litre of oxygen, 20.9 kJ/L (+-3 to 5 % with RQ), and the mass of a litre of O2.
export const KJ_PER_L = 20.9;
export const G_PER_L = 1.43;
// One residual SD of the suited fits (3.6 to 3.8 ml/kg/min). Added for every safety number.
export const BAND = 4;

// Level suited walking cost in ml O2 per kg body mass per minute.
// v <= 1.07 m/s: quadratic fit to the IST-1 suited points at 0.32 g (n = 34, residual SD 3.6).
//   A lower bound at 0.38 g, since 0.32 g < 0.38 g.
// 1.07 < v <= 1.53 m/s: linear fit to the EWT suited points at 3/8 g (n = 16, residual SD 3.8).
// Both fits are ours, made on points digitized from the NASA figures (data/metabolic/).
export function vo2Level(v) {
  if (v <= 1.07) return 1.53 + 18.28 * v - 0.58 * v * v;
  return -26.12 + 43.33 * Math.min(v, 1.53);
}

// Minetti et al. 2002: net cost of walking on a grade i (rise/run), J per kg per metre, at 1 g.
// Valid for -0.45 <= i <= 0.45.
export function minettiCw(i) {
  i = Math.max(-0.45, Math.min(0.45, i));
  return 280.5 * i ** 5 - 58.7 * i ** 4 - 76.8 * i ** 3 + 51.9 * i ** 2 + 19.6 * i + 2.5;
}

// Extra cost of the grade, scaled by suited weight at Mars gravity. Downhill savings are set to 0:
// in a suit they are uncertain, so the budget does not count on them.
// loadKg: carried equipment. The climb term scales with the weight that is lifted, so the load is
// added to the body and the suit.
export function vo2Grade(i, v, loadKg = 0) {
  const d = (minettiCw(i) - minettiCw(0)) * v * (BODY_KG + SUIT_KG + loadKg) / BODY_KG * G_MARS * 60 / KJ_PER_L;
  return Math.max(0, d);
}

// Carried equipment on level ground (challenge text: "possibly carrying scientific equipment and
// other supplies"). The walkback test separated the cost of the suit's weight from the rest of
// its cost: unsuited subjects were offloaded to the weight they would have in the suit. At 3/8 g
// the weight of the 121 kg suit system cost 1.7, 1.6 and 2.0 ml/kg/min at the three walking
// speeds (NASA/TP-2009-214796, Table 5, "Metabolic Cost Due to Weight"). Their mean, per kg of
// the suit system, is what one kg of carried mass costs here.
// LIMITS: weight only. The report says this comparison "would not account for additional
// metabolic cost associated with the increased mass", such as inertia and where the mass sits
// (p. 17). NASA measured a load carried in the hands only at lunar gravity (4.5, 9.1 and 13.6 kg,
// NASA/TP-2010-216125, section 2.3.3 and Figure 80: the metabolic rate rose with the load).
export const WEIGHT_VO2_PER_KG = (1.7 + 1.6 + 2.0) / 3 / SUIT_KG;

// Ground factor eta (Pandolf et al. 1977 terrain factors; field terrain +51 to 56 %).
// 1.0 packed smooth ground, 1.2 to 1.5 rocky or gravelly, 2.1 loose sand.
export const ETA = { packed: 1.0, rocky: 1.2, sand: 2.1 };
export const ETA_DEFAULT = ETA.rocky;   // where no ground class is known

// Ground factor for each AI4Mars class (tools/seg). Our mapping onto the Pandolf range:
// bedrock is the firmest surface (1.0), soil is the gravelly regolith (1.2, the rocky value),
// sand is loose sand (2.1), big rock is the top of the firm range (1.5): a boot steps around or
// over it. Earth, unsuited values (report section on terrain).
export const ETA_BY_CLASS = [ETA.rocky, ETA.packed, ETA.sand, 1.5];   // soil, bedrock, sand, big rock

// VO2 while walking at speed v (m/s) on grade i over ground factor eta, carrying loadKg.
export const vo2Walk = (v, i, eta = ETA_DEFAULT, loadKg = 0) => eta * (vo2Level(v) + WEIGHT_VO2_PER_KG * loadKg) + vo2Grade(i, v, loadKg);

// Work at a station: Apollo lunar EVA mean for geology stations, 1024 kJ/h
// (Waligora et al. 1975, NASA TN D-7883, Table I, mean row).
export const STATION_KJ_H = 1024;
// Apollo lunar EVA overall mean, 980 kJ/h (same table). Used to size the supply.
export const EVA_MEAN_KJ_H = 980;
// Suit leakage: the Apollo suit specification allowed leakage equal to about 211 kJ/h of
// metabolic oxygen (TN D-7883, p. 5). Used as the leak term here.
export const LEAK_KJ_H = 211;

// Conversions.
export const vo2ToGPerMin = (vo2) => vo2 * BODY_KG / 1000 * G_PER_L;           // ml/kg/min -> g/min
export const kjhToGPerMin = (kjh) => kjh / KJ_PER_L * G_PER_L / 60;             // kJ/h -> g/min
export const vo2ToWatts = (vo2) => vo2 * BODY_KG / 1000 * KJ_PER_L * 1000 / 60;  // ml/kg/min -> W
export const kjhToVo2 = (kjh) => kjh / KJ_PER_L * 1000 / 60 / BODY_KG;         // kJ/h -> ml/kg/min

// Oxygen supply: our assumption, stated on screen. The tank holds what an 8 h EVA at the Apollo
// mean rate, plus the leak, would use. The reserve is 30 min of that rate (the existing time
// reserve, Apollo planning practice).
export function supply(evaH, reserveMin) {
  const perMin = kjhToGPerMin(EVA_MEAN_KJ_H + LEAK_KJ_H);
  return { totalG: perMin * evaH * 60, reserveG: perMin * reserveMin };
}

// Grams of oxygen to walk one grid edge: length (m) at speed v (m/s), grade i, ground eta.
// With safe = true the VO2 carries the +1 SD band, as used for every turn-back number.
export function edgeO2(len, v, i, eta = ETA_DEFAULT, safe = true, loadKg = 0) {
  const vo2 = vo2Walk(v, i, eta, loadKg) + (safe ? BAND : 0);
  return (vo2ToGPerMin(vo2) + kjhToGPerMin(LEAK_KJ_H)) * (len / v) / 60;
}

// Sustained effort ceiling: flight rule VO2max >= 36 ml/kg/min, sustained work 35 to 50 % of
// VO2max (NASA EVA physiology slides, S20 of the report): 12.6 to 18 ml/kg/min.
export const SUSTAIN = { low: 0.35 * 36, high: 0.5 * 36 };

// Heart rate from VO2 through the median per-test line of an open treadmill dataset
// (PhysioNet treadmill exercise data; our fit; a = -21.5, b = 0.366 ml/kg/min per bpm).
// A population line misses by about 6 ml/kg/min, so the band shown is +-20 bpm.
export const hrFromVo2 = (vo2) => (vo2 + 21.5) / 0.366;
export const HR_BAND = 20;

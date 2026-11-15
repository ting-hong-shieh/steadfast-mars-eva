# Written with an AI tool (Claude, run by a research worker). See AI_USE.md.
# Run: uv run --no-project --with numpy --with pandas python -I data/metabolic/chain_fits.py data/metabolic
# Fits used for the recommended model chain. Our own analysis on digitized NASA data + Minetti 2002 polynomial.
import numpy as np, pandas as pd, sys
D = sys.argv[1]
rd = lambda f: pd.read_csv(f"{D}/{f}", comment="#")
ewt = rd("norcross2009_ewt_fig16_suited_vo2_speed_lunar_mars_DIGITIZED.csv")
m = ewt[ewt.series == "suited_3/8g"]
b1, b0 = np.polyfit(m.speed_m_s, m.vo2_ml_kg_min, 1)
res = m.vo2_ml_kg_min - (b0 + b1*m.speed_m_s)
print("EWT suited 3/8 g linear: VO2 = %.2f + %.2f*v  (n=%d, v %.2f-%.2f, residual SD %.2f)" % (b0, b1, len(m), m.speed_m_s.min(), m.speed_m_s.max(), res.std(ddof=2)))
for series in ["suited_1/6g"]:
    q = ewt[ewt.series == series]; c = np.polyfit(q.speed_m_s, q.vo2_ml_kg_min, 2)
    print("EWT %s quadratic: VO2 = %.2f + %.2f v + %.2f v^2 (n=%d, v %.2f-%.2f)" % (series, c[2], c[1], c[0], len(q), q.speed_m_s.min(), q.speed_m_s.max()))
ist1 = rd("norcross2010_ist1_fig22_suited_vo2_speed_gravity_DIGITIZED.csv")
for g in ["0.32g", "0.17g"]:
    q = ist1[ist1.series == "suited_" + g]; c = np.polyfit(q.speed_m_s, q.vo2_ml_kg_min, 2)
    r = q.vo2_ml_kg_min - np.polyval(c, q.speed_m_s)
    print("IST-1 suited %s quadratic: VO2 = %.2f + %.2f v + %.2f v^2 (n=%d, v %.2f-%.2f, resid SD %.2f)" % (g, c[2], c[1], c[0], len(q), q.speed_m_s.min(), q.speed_m_s.max(), r.std(ddof=3)))
# Grade test against IST-2 Fig 36 (suited, 0.12-0.32 g). Minetti 2002 Cw polynomial (net, 1 g, J/kg/m).
Cw = lambda i: 280.5*i**5 - 58.7*i**4 - 76.8*i**3 + 51.9*i**2 + 19.6*i + 2.5
ist2 = rd("norcross2010_ist2_fig36_suited_vo2_grade_gravity_DIGITIZED.csv")
ist2["grade"] = ist2.grade_percent.round(0)
ist2["G"] = ist2.series.str.extract(r"([0-9.]+)g").astype(float)
mb, msys = 80.7, 121.0
print("\nIST-2 suited incline: measured mean increase over level vs Minetti increment scaled by (mb+msys)/mb * G")
print("G     grade  n  meas_mean  meas_incr  pred_incr(v=0.56) pred_incr(v=0.77) pred_incr(v=0.97)")
for G, gq in ist2.groupby("G"):
    lvl = gq[gq.grade == 0].vo2_ml_kg_min.mean()
    for gr, q in gq.groupby("grade"):
        if gr == 0: continue
        i = gr/100.0
        pred = lambda v: (Cw(i) - Cw(0)) * v * (mb+msys)/mb * G * 60/20.9
        print("%.2f  %4.0f  %2d  %6.1f  %6.1f   %6.1f  %6.1f  %6.1f" % (G, gr, len(q), q.vo2_ml_kg_min.mean(), q.vo2_ml_kg_min.mean()-lvl, pred(0.56), pred(0.77), pred(0.97)))

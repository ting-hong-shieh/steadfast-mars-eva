# Metabolic data behind `app/src/metabolic.js`

Points digitized from the vector figures of three NASA technical reports (US Government works) and
two tables transcribed from NASA reports. Each CSV has a header line that names its source,
figure or table, and page. The digitizing was done by an AI research worker on 2026-11-14
(estimated accuracy ±0.02 m/s and ±0.3 ml/kg/min). The agent of the lead checked that the mean of
the 16 digitized 3/8 g points (31.6 ml/kg/min) agrees with the stage means of Table 5 (27.6, 32.5
and 35.7, mean 31.9) and reran `chain_fits.py`, which gives the coefficients used in the app.

| File | Source (SOURCES.md) |
|---|---|
| `norcross2009_ewt_fig16_suited_vo2_speed_lunar_mars_DIGITIZED.csv` | S21, Figure 16 |
| `norcross2009_ewt_table5_metabolic_lunar_mars.csv` | S21, Table 5 |
| `norcross2010_ist1_fig22_suited_vo2_speed_gravity_DIGITIZED.csv` | S22, Figure 22 |
| `norcross2010_ist2_fig36_suited_vo2_grade_gravity_DIGITIZED.csv` | S23, Figure 36 |
| `apollo_tnD7883_table1_eva_metabolic.csv` | S26, Table I |
| `chain_fits.py` | Our fits and the slope-term check |

#!/usr/bin/env python3
# Written with an AI tool (Claude). See AI_USE.md.
"""Weather at Gale on sol 4709 from Curiosity's Rover Environmental Monitoring Station (REMS).

Input (not in git, 12.7 MB): the MODRDR table of sol 4709 and its PDS4 label
  https://atmos.nmsu.edu/PDS/data/PDS4/msl_rems_bundle/data_calibrated/SOL_04613_04709/SOL04709/
  RME_815485151RMD47090000000_______P1.TAB
  sha256 057f320f21b4816299823aec20d8b571d2a3f1d4d8dc8d5d3c789cbfb1d8e515
Data set MSL-M-REMS-5-MODRDR-V1.0. The label calls the table "environmental magnitudes after
applying filters, corrections and models to ENV_RDR, thus containing the best estimation of the
real data".

Columns used (numbers from the label, 1-based):
  1  TIMESTAMP        seconds since noon 1-Jan-2000
  2  LMST             local mean solar time, "SSSSSMHH:MM:SS.sss"
  8  BRIGHTNESS_TEMP  kelvin, the ground temperature sensor
  16 AMBIENT_TEMP     kelvin, "Estimated ambient air temperature"
  21 UV_ABC           W/m2
  38 PRESSURE         pascal
The label gives -999.00 as the unknown constant. Those values are dropped.

Output: the median of the valid values in each 10 minute bin, one list per quantity, so the app
can show the last reading at or before a time. LIMIT: the confidence strings of the sensors
(columns 11, 17, 30, 40) are not applied. A reading the team flagged as low quality can be in a
median.

Usage: tools/build_rems_series.py <TAB file> <output json>
"""
import csv
import json
import statistics
import sys
from datetime import datetime, timedelta, timezone

# From the PDS3 label of the same product: START_TIME and SPACECRAFT_CLOCK_START_COUNT.
START_UTC = datetime(2025, 11, 4, 0, 48, 36, 470000, tzinfo=timezone.utc)
START_COUNT = 815485218
BIN = 600
COLS = {"ground_k": 7, "air_k": 15, "uv_abc": 20, "pressure_pa": 37}


def main(src, dst):
    bins = {k: {} for k in COLS}
    lmst = {}
    n = 0
    with open(src, newline="") as f:
        for row in csv.reader(f):
            n += 1
            t = int(row[0]) - START_COUNT
            b = t // BIN
            lmst.setdefault(b, row[1].strip().split("M")[1][:5])
            for k, c in COLS.items():
                v = float(row[c])
                if v > -900:
                    bins[k].setdefault(b, []).append(v)
    out = {
        "source": "MSL REMS MODRDR, PDS Atmospheres node, data set MSL-M-REMS-5-MODRDR-V1.0, sol 4709",
        "file": src.split("/")[-1],
        "start_utc": START_UTC.isoformat().replace("+00:00", "Z"),
        "bin_seconds": BIN,
        "rows_read": n,
        "note": "Median of the valid values in each 10 minute bin. Unknown values (-999) dropped. "
                "Sensor confidence strings not applied.",
        "columns": ["seconds after start", "value", "readings in the bin", "LMST of the bin start"],
        "series": {},
    }
    for k in COLS:
        out["series"][k] = [[b * BIN, round(statistics.median(v), 2), len(v), lmst[b]] for b, v in sorted(bins[k].items())]
    # The moment the walk starts in the app: the first bin at or after 08:00 local mean solar time.
    first = min(b for b, s in lmst.items() if s >= "08:00")
    out["eva_start"] = {"seconds_after_start": first * BIN, "lmst": lmst[first],
                        "utc": (START_UTC + timedelta(seconds=first * BIN)).isoformat().replace("+00:00", "Z")}
    with open(dst, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    for k, s in out["series"].items():
        vals = [r[1] for r in s]
        print(k, len(s), "bins", min(vals), "to", max(vals))
    print("eva_start", out["eva_start"])


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

#!/usr/bin/env python3
"""Read MSL RAD RDR text files and write the dose-rate series the app shows.

Source: PDS PPI node, data set MSL-M-RAD-3-RDR-V1.0 (see SOURCES.md).
The RDR SIS says the values under [DOSIMETRY_TOTAL_DOSE_B] and
[DOSIMETRY_TOTAL_DOSE_E] are the total dose of the B and E detectors in
microgray per hour. This script copies them. It does no correction.

Rows are dropped when the observation is shorter than MIN_DUR_S. In the four
files we use, those are five rows whose value is far below the rows next to
them. We did not find the reason in the RDR SIS, so this cut is our own choice.

Usage: tools/build_rad_series.py OUT.json FROM_UTC TO_UTC RAD_RDR_*.TXT [...]
FROM_UTC and TO_UTC look like 2024-05-20T03:00:00Z. Use - for no bound.
Output rows: [seconds after the first row, E detector, B detector].

This file was written with an AI coding agent (see AI_USE.md).
"""
import json, re, sys
from datetime import datetime, timedelta

def parse(path):
    obs, cur, want = {}, None, None
    with open(path, encoding="latin-1") as f:
        for line in f:
            s = line.strip()
            m = re.match(r"\[(\w+): (\d+)\]", s)
            if m:
                name, n = m.group(1), int(m.group(2))
                cur = obs.setdefault(n, {})
                want = {"DOSIMETRY_TOTAL_DOSE_B": "b", "DOSIMETRY_TOTAL_DOSE_E": "e"}.get(name)
                continue
            if cur is None or not s:
                continue
            if want:
                try:
                    cur[want] = float(s)
                except ValueError:
                    pass
                want = None
            elif s.startswith("START_OBS_UTC="):
                cur["utc"] = s.split("=", 1)[1].strip('"')
            elif s.startswith("START_OBS_MARS="):
                cur["mars"] = s.split("=", 1)[1].strip('"')
            elif s.startswith("OBS_DURATION="):
                cur["dur"] = int(s.split("=", 1)[1])
    return obs

MIN_DUR_S = 400
lo, hi = sys.argv[2], sys.argv[3]
files = sys.argv[4:]
rows = []
for p in files:
    for n, o in sorted(parse(p).items()):
        if "utc" not in o or ("b" not in o and "e" not in o):
            continue
        y, rest = o["utc"].split("-", 1)
        doy, hms = rest.split(" ")
        t = datetime(int(y), 1, 1) + timedelta(days=int(doy) - 1)
        h, mi, se = map(int, hms.split(":"))
        t += timedelta(hours=h, minutes=mi, seconds=se)
        rows.append({"utc": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "mars": o.get("mars"),
                     "dur_s": o.get("dur"), "b_uGy_h": o.get("b"), "e_uGy_h": o.get("e")})
rows.sort(key=lambda r: r["utc"])
kept = [r for r in rows if (r["dur_s"] or 0) >= MIN_DUR_S and r["e_uGy_h"] is not None
        and (lo == "-" or r["utc"] >= lo) and (hi == "-" or r["utc"] <= hi)]
t0 = datetime.strptime(kept[0]["utc"], "%Y-%m-%dT%H:%M:%SZ")
out = {
    "unit": "microgray per hour",
    "source": "MSL RAD RDR, PDS PPI, data set MSL-M-RAD-3-RDR-V1.0",
    "files": [p.split("/")[-1] for p in files],
    "columns": ["seconds after start", "E detector dose rate", "B detector dose rate"],
    "start_utc": kept[0]["utc"], "start_mars": kept[0]["mars"], "end_utc": kept[-1]["utc"],
    "dropped_short_rows": sum(1 for r in rows if (r["dur_s"] or 0) < MIN_DUR_S),
    "rows": [[int((datetime.strptime(r["utc"], "%Y-%m-%dT%H:%M:%SZ") - t0).total_seconds()),
              r["e_uGy_h"], r["b_uGy_h"]] for r in kept],
}
json.dump(out, open(sys.argv[1], "w"), separators=(",", ":"))
e = [r[1] for r in out["rows"]]
print(out["start_utc"], out["end_utc"], "rows", len(e), "dropped", out["dropped_short_rows"],
      "E min", min(e), "max", max(e))

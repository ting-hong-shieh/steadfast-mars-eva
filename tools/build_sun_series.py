#!/usr/bin/env python3
# Written with an AI tool (Claude). See AI_USE.md.
"""Where the sun stood in the sky of the main place on sol 4709 (4 November 2025).

Input (not in git): the text answer of the JPL Horizons API to this query
  https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='10'&OBJ_DATA='NO'
    &MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='coord@499'&COORD_TYPE='GEODETIC'
    &SITE_COORD='-137.3811,-4.8081,-3.609'&START_TIME='2025-11-04 00:00'
    &STOP_TIME='2025-11-05 02:00'&STEP_SIZE='10 m'&QUANTITIES='4'
Target: the Sun (10). Observer: a surface point on Mars (499). Quantity 4 is the apparent
azimuth and elevation, "(a-app)": Mars has no refraction model in Horizons, so the values are
the airless ones. Azimuth is counted clockwise from north.

Longitude. Horizons answers a positive east longitude for Mars with "Input east-longitude as
negative for IAU west-positive body #499". Which sign is right was settled with three Mastcam
image labels, which give the solar elevation at the rover (SOLAR_ELEVATION, site frame):
  STN A, 2025-07-31T23:30:33.697Z: label 63.2389 deg, Horizons 63.13 deg
  STN B, label 72.55 deg, Horizons 72.63 deg
  STN C, label 70.4953 deg, Horizons 70.56 deg
with the east longitude given as a negative number. With the other sign the first case gives
0.57 deg. The site is 137.3811 E, 4.8081 S, 3.609 km below the reference surface (the height
is the 1 m elevation model at the rover stop of sol 4709, app/public/data/sites.json).

Output: one row every 10 minutes, [azimuth, elevation] in degrees, from the first time tag.
LIMIT: the horizon is the ideal one. Mount Sharp and the crater rim are not in it.

Usage: tools/build_sun_series.py <horizons text file> <output json>
"""
import hashlib
import json
import re
import sys
from datetime import datetime, timezone

MONTHS = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}
ROW = re.compile(r"^\s*(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})\s+[*CNAmrts ]*?\s*(-?[\d.]+)\s+(-?[\d.]+)\s*$")


def main(src, dst):
    raw = open(src, "rb").read()
    text = raw.decode()
    body = text.split("$$SOE")[1].split("$$EOE")[0]
    times, rows = [], []
    for line in body.strip().splitlines():
        m = ROW.match(line)
        if not m:
            raise SystemExit(f"cannot read row: {line!r}")
        y, mon, d, hh, mm, az, el = m.groups()
        times.append(datetime(int(y), MONTHS[mon], int(d), int(hh), int(mm), tzinfo=timezone.utc))
        rows.append([round(float(az), 3), round(float(el), 3)])
    step = (times[1] - times[0]).total_seconds()
    if any((b - a).total_seconds() != step for a, b in zip(times, times[1:])):
        raise SystemExit("time tags are not evenly spaced")
    out = {
        "source": "JPL Horizons API 1.2, target Sun (10), observer coord@499 geodetic "
                  "-137.3811, -4.8081, -3.609 km (137.3811 E), quantity 4: apparent azimuth and "
                  "elevation, airless. Queried 2026-11-14 21:14 UTC.",
        "input_sha256": hashlib.sha256(raw).hexdigest(),
        "columns": ["azimuth, degrees clockwise from north", "elevation, degrees above the ideal horizon"],
        "start_utc": times[0].isoformat().replace("+00:00", "Z"),
        "step_seconds": step,
        "rows": rows,
    }
    with open(dst, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    up = [t for t, r in zip(times, rows) if r[1] > 0]
    print(f"{len(rows)} rows, {times[0]} to {times[-1]}, sun above the horizon {up[0]:%H:%M} to {up[-1]:%H:%M} UTC, "
          f"highest {max(r[1] for r in rows):.2f} deg")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

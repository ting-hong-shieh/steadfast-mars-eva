#!/usr/bin/env python3
# Written with an AI tool (Claude). See AI_USE.md.
"""More places in Gale crater for the world map: orbital ground only, one 600 m square per place.

Each place is a real stop of the Curiosity rover, taken from the MSL PLACES localizations
(SOURCES.md S31, localized_pos.csv: site, drive, easting, northing, sol). Which stops are offered is
our choice (SITES below): they are spread along the rover's path so the ground differs.

For each place:
  orbital_height.bin  int16 LE, centimetres above the place's own origin, north-up rows, 1 m cells
                      (S6, MSL_Gale_DEM_Mosaic_1m_v3.tif, read from the local file)
  orbital_ortho.jpg   8-bit grey orthoimage of the same square, 25 cm per pixel
                      (S7, MSL_Gale_Orthophoto_Mosaic_25cm_v3.tif, the square is read from the
                      remote file and kept in <data>/orbital/sites/<id>_ortho.tif)
  terrain.json        sizes, origin and sources
There is no rover-camera ground at these places: the app shows the orbital ground everywhere
there, and no ground classes.

Also written:
  sites.json     the list of places with their offset from the main place (sol 4709), in app metres
  traverse.json  the rover's path from the same file, thinned to one point per 25 m

Run:
  uv run --no-project --with rasterio --with pillow python -I tools/build_site_terrain.py \
      /mnt/d/Data/nasa-space-apps-2026-martian-map/gale \
      /mnt/d/Data/nasa-space-apps-2026-martian-map/research/2026-11-14-ground-texture/downloads/pds_msl_places_localized_pos/localized_pos.csv \
      app/public/data
"""
import csv
import json
import os
import sys

import numpy as np
import rasterio
from PIL import Image
from rasterio.windows import from_bounds

# The main place: Curiosity position of sol 4709 (tools/build_gale_terrain.py).
E0, N0, Z0 = 8143220.156, -284992.705, -3608.689
HALF = 300.0
ORTHO_PX = 2400
ORTHO_URL = "https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_Orthophoto_Mosaic_25cm_v3.tif"

# (id, site, drive): rows of localized_pos.csv. Our choice of stops.
SITES = [
    ("sol0000", 1, 0),
    ("sol0717", 40, 1286),
    ("sol1720", 63, 2978),
    ("sol3036", 86, 1840),
    ("sol4098", 106, 438),
]


def main(data_dir, places_csv, out_dir):
    rows = [r for r in csv.DictReader(open(places_csv)) if r["frame"] == "ROVER"]
    by = {}
    for r in rows:
        by.setdefault((int(r["site"]), int(r["drive"])), r)
    os.makedirs(os.path.join(data_dir, "orbital/sites"), exist_ok=True)
    dem = rasterio.open(os.path.join(data_dir, "orbital/MSL_Gale_DEM_Mosaic_1m_v3.tif"))
    index = []
    for sid, site, drive in SITES:
        r = by[(site, drive)]
        e, n = float(r["easting"]), float(r["northing"])
        win = from_bounds(e - HALF, n - HALF, e + HALF, n + HALF, dem.transform).round_offsets().round_lengths()
        h = dem.read(1, window=win).astype(np.float64)
        assert h.shape == (600, 600) and (h > -1e4).all(), (sid, h.shape)
        # The origin height: the elevation model at the rover position (mean of the 2 x 2 cells
        # around it), so the place's own zero is on the ground of the model.
        z0 = float(h[299:301, 299:301].mean())
        rel = h - z0
        d = os.path.join(out_dir, "sites", sid)
        os.makedirs(d, exist_ok=True)
        np.round(rel * 100).astype("<i2").tofile(os.path.join(d, "orbital_height.bin"))

        crop = os.path.join(data_dir, "orbital/sites", f"{sid}_ortho.tif")
        if not os.path.exists(crop):
            with rasterio.open("/vsicurl/" + ORTHO_URL) as ds:
                w = from_bounds(e - HALF, n - HALF, e + HALF, n + HALF, ds.transform).round_offsets().round_lengths()
                a = ds.read(1, window=w)
                prof = ds.profile.copy()
                prof.update(width=a.shape[1], height=a.shape[0], transform=ds.window_transform(w),
                            compress="deflate", tiled=False)
                prof.pop("blockxsize", None); prof.pop("blockysize", None)
                with rasterio.open(crop, "w", **prof) as out:
                    out.write(a, 1)
        with rasterio.open(crop) as ds:
            ortho = ds.read(1)
        # Display stretch only, the same as the main place: 1st to 99th percentile to 0.30 .. 1.00.
        lo, hi = np.percentile(ortho, [1, 99])
        img = (255 * (0.30 + 0.70 * np.clip((ortho - lo) / max(hi - lo, 1), 0, 1))).astype(np.uint8)
        Image.fromarray(img).resize((ORTHO_PX, ORTHO_PX), Image.LANCZOS).save(
            os.path.join(d, "orbital_ortho.jpg"), quality=84)

        meta = {
            "note": "Made by tools/build_site_terrain.py from NASA files. See SOURCES.md S6, S7, S31.",
            "origin": {"easting_m": e, "northing_m": n, "elevation_m": z0,
                       "what": f"Curiosity stop, sol {r['sol']}, site {site} drive {drive} (MSL PLACES localized_pos.csv); "
                               "height from the 1 m elevation model at that point"},
            "axes": "app x = east, app z = minus north, app y = up, metres from the origin",
            "orbital": {"size_m": 2 * HALF, "cells": 600, "cell_m": 1.0,
                        "height_unit": "cm above origin, int16 LE, row 0 is the north edge",
                        "ortho_px": ORTHO_PX, "min_m": float(rel.min()), "max_m": float(rel.max())},
            "near": None,
        }
        json.dump(meta, open(os.path.join(d, "terrain.json"), "w"), indent=1)
        index.append({
            "id": sid, "sol": int(r["sol"]), "site": site, "drive": drive,
            "x": round(e - E0, 1), "z": round(-(n - N0), 1),
            "lon": float(r["longitude"]), "lat": float(r["planetocentric_latitude"]),
            "elevation_m": round(z0, 1), "places_elevation_m": float(r["elevation"]),
            "relief_m": round(float(rel.max() - rel.min()), 1),
            "yaw_deg": float(r["yaw"]),
        })
        print(index[-1], "ortho", ortho.shape, "stretch", lo, hi)

    json.dump({
        "note": "Made by tools/build_site_terrain.py. Each place is a real Curiosity stop (MSL PLACES, S31). "
                "x and z are app metres from the main place (sol 4709): x east, z minus north. yaw_deg is the rover's heading at the stop, clockwise from north. "
                "elevation_m is the 1 m elevation model (S6) at the stop. Which stops are offered is our choice.",
        "main": {"id": "sol4709", "sol": 4709, "site": 120, "drive": 0, "x": 0, "z": 0, "elevation_m": Z0,
                 "yaw_deg": float(by[(120, 0)]["yaw"])},
        "sites": index,
    }, open(os.path.join(out_dir, "sites.json"), "w"), indent=1)

    # The rover's path, one point per 25 m of path, plus the last point.
    path, last, acc = [], None, 0.0
    for r in rows:
        e, n = float(r["easting"]), float(r["northing"])
        if last is not None:
            acc += float(np.hypot(e - last[0], n - last[1]))
        if last is None or acc >= 25:
            path.append([round(e - E0, 1), round(-(n - N0), 1), int(r["sol"])])
            acc = 0.0
        last = (e, n)
    path.append([round(last[0] - E0, 1), round(-(last[1] - N0), 1), int(rows[-1]["sol"])])
    json.dump({
        "note": "Curiosity's path from MSL PLACES localized_pos.csv (S31), ROVER rows, thinned to one point "
                "per 25 m of path. Columns: x east, z minus north (app metres from the main place), sol.",
        "last_sol": int(rows[-1]["sol"]), "points": path,
    }, open(os.path.join(out_dir, "traverse.json"), "w"), separators=(",", ":"))
    print("traverse points", len(path), "last sol", rows[-1]["sol"])


if __name__ == "__main__":
    main(*sys.argv[1:4])

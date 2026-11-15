#!/usr/bin/env python3
# Written with an AI tool (Claude). See AI_USE.md.
"""The base picture of the world map: shaded relief of the whole Gale elevation mosaic.

Input (not in git): MSL_Gale_DEM_Mosaic_1m_v3.tif (SOURCES.md S6), 32,980 x 57,440 cells of 1 m.
The file is read one row in every STEP rows, and each row is averaged over STEP columns, so one
output cell stands for STEP x STEP metres (the average is along the row only).

Output:
  world_relief.jpg  colour by height (our colour ramp) times a hillshade (light from the north-west,
                    45 degrees up, heights not exaggerated). COMPUTED from the elevation model.
  world.json        the square it covers in app metres, the cell size, the height range, and the
                    colour ramp with its heights, so the map can print a legend.

Run:
  uv run --no-project --with rasterio --with pillow python -I tools/build_world_relief.py \
      /mnt/d/Data/nasa-space-apps-2026-martian-map/gale app/public/data
"""
import json
import os
import sys

import numpy as np
import rasterio
from PIL import Image
from rasterio.windows import Window

E0, N0 = 8143220.156, -284992.705     # the main place (tools/build_gale_terrain.py)
STEP = 20
# Our colour ramp, low to high: dusk blue floor, ochre, rust, pale summit. Display choice.
RAMP = [(0.00, (38, 52, 66)), (0.22, (86, 84, 80)), (0.45, (150, 106, 74)), (0.70, (198, 134, 86)),
        (0.88, (232, 190, 150)), (1.00, (250, 236, 220))]


def main(data_dir, out_dir):
    ds = rasterio.open(os.path.join(data_dir, "orbital/MSL_Gale_DEM_Mosaic_1m_v3.tif"))
    w = ds.width // STEP
    rows = list(range(STEP // 2, ds.height, STEP))
    h = np.full((len(rows), w), np.nan, dtype=np.float32)
    for i, r in enumerate(rows):
        a = ds.read(1, window=Window(0, r, w * STEP, 1))[0].astype(np.float32)
        a[a < -1e4] = np.nan
        with np.errstate(invalid="ignore"):
            h[i] = np.nanmean(a.reshape(w, STEP), axis=1)
    ok = np.isfinite(h)
    lo, hi = float(np.nanpercentile(h, 0.5)), float(np.nanpercentile(h, 99.5))
    filled = np.where(ok, h, lo)
    # Hillshade: light from the north-west, 45 degrees above the horizon.
    gy, gx = np.gradient(filled, STEP)
    az, alt = np.deg2rad(315), np.deg2rad(45)
    lx, ly, lz = np.sin(az) * np.cos(alt), np.cos(az) * np.cos(alt), np.sin(alt)
    # Row index grows to the south, so north-up slope is -gy.
    nx, ny, nz = -gx, gy, np.ones_like(gx)
    shade = (nx * lx + ny * ly + nz * lz) / np.sqrt(nx * nx + ny * ny + nz * nz)
    shade = np.clip(0.35 + 0.65 * np.clip(shade / lz, 0, 1.6) / 1.0, 0, 1.25)
    # The square root spreads the colours over the low ground, where the rover's path is.
    t = np.sqrt(np.clip((filled - lo) / (hi - lo), 0, 1))
    xs = [p for p, _ in RAMP]
    rgb = np.stack([np.interp(t, xs, [c[k] for _, c in RAMP]) for k in range(3)], axis=-1)
    rgb = np.clip(rgb * shade[..., None], 0, 255)
    rgb[~ok] = (10, 14, 18)
    Image.fromarray(rgb.astype(np.uint8)).save(os.path.join(out_dir, "world_relief.jpg"), quality=86)
    b = ds.bounds
    meta = {
        "note": "Made by tools/build_world_relief.py from the 1 m Gale elevation mosaic (SOURCES.md S6). "
                "Colour by height is our ramp. Shading is a hillshade, light from the north-west.",
        "image": "world_relief.jpg", "px": [w, len(rows)], "cell_m": STEP,
        "app_m": {"x_min": b.left - E0, "x_max": b.left + w * STEP - E0,
                  "z_min": -(b.top - N0), "z_max": -(b.top - len(rows) * STEP - N0)},
        "height_m": {"low": round(lo), "high": round(hi),
                     "min": round(float(np.nanmin(h))), "max": round(float(np.nanmax(h)))},
        "ramp": [{"at": p, "height_m": round(lo + p * p * (hi - lo)), "rgb": list(c)} for p, c in RAMP],
        "valid_fraction": round(float(ok.mean()), 4),
    }
    json.dump(meta, open(os.path.join(out_dir, "world.json"), "w"), indent=1)
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

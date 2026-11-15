# Written with an AI tool (Claude). See AI_USE.md.
"""Turn the NASA files for the Gale crater boxwork site into the small files the app loads.

Inputs (not in git, see SOURCES.md for the links and data/README.md for the download commands):
  orbital/gale_boxwork_dem_1m_1200m.tif     crop of MSL_Gale_DEM_Mosaic_1m_v3.tif
  orbital/gale_boxwork_ortho_25cm_1200m.tif crop of MSL_Gale_Orthophoto_Mosaic_25cm_v3.tif
  navcam-sol04709/N?B_*{XYZ,RAS}LF*.{IMG,LBL} Curiosity Navcam stereo products, sol 4709

Outputs (app/public/data/):
  orbital_height.bin  int16 little-endian, centimetres above the origin, north-up rows
  orbital_ortho.jpg   8-bit grey orthoimage of the same square
  near_detail.bin     int16, millimetres: measured ground minus orbital ground, feathered to 0
  near_weight.png     8-bit: 255 where a 5 cm cell holds measured Navcam points
  near_grey.png       8-bit: mean Navcam radiance of each 5 cm cell, stretched
  terrain.json        sizes, origin, sources and the numbers of the alignment check

Frames. The Navcam XYZ products are in SITE_FRAME (X north, Y east, Z down, metres; MSL Camera
SIS section 5.2.1.4 and MSL_COORDINATE_FRAMES.PDF). The origin of site 120 is the rover position
of sol 4709 in the MMGIS waypoint file (site 120, drive 0). Two files are in site 119; the labels
give the rover position in site 119 at the place where site 120 was declared.

Run:
  uv run --no-project --with rasterio --with pillow --with scipy python -I \
      tools/build_gale_terrain.py /mnt/d/Data/nasa-space-apps-2026-martian-map/gale app/public/data
"""
import glob
import json
import os
import re
import sys

import numpy as np
import rasterio
from PIL import Image
from rasterio.windows import from_bounds
from scipy import ndimage

# Site 120 origin: MSL_waypoints.json, sol 4709, site 120, drive 0.
E0, N0, Z0 = 8143220.156, -284992.705, -3608.689
# Rover position in site 119 where site 120 was declared (ROVER_COORD_SYSTEM_PARMS in the labels).
SITE119_ROVER = (6.38459, 31.6903, 4.83849)

HALF = 300.0        # orbital square: 600 m on a side
ORTHO_PX = 2400     # 25 cm per pixel
NEAR_HALF = 24.0    # measured patch: 48 m on a side
CELL = 0.05         # 5 cm cells
MAX_RANGE = 26.0    # use Navcam points up to this distance from the rover
MIN_POINTS = 3      # a cell counts as measured with at least this many points
ROVER_RADIUS = 2.6   # metres around the origin that hold the rover, not ground
OUTLIER_M = 0.12     # see the cleaning steps


def read_label(path):
    text = open(path, errors="replace").read()
    rec = int(re.search(r'\^IMAGE\s*=\s*\("[^"]+"\s*,\s*(\d+)', text).group(1))
    rec_bytes = int(re.search(r"RECORD_BYTES\s*=\s*(\d+)", text).group(1))
    image = re.search(r"^OBJECT\s*=\s*IMAGE\s*$(.*?)^END_OBJECT\s*=\s*IMAGE\s*$", text, re.S | re.M).group(1)
    lines = int(re.search(r"LINES\s*=\s*(\d+)", image).group(1))
    samples = int(re.search(r"LINE_SAMPLES\s*=\s*(\d+)", image).group(1))
    bands = int(re.search(r"\bBANDS\s*=\s*(\d+)", image).group(1))
    bits = int(re.search(r"SAMPLE_BITS\s*=\s*(\d+)", image).group(1))
    kind = re.search(r"SAMPLE_TYPE\s*=\s*(\S+)", image).group(1)
    frame = re.search(
        r'DERIVED_IMAGE_PARMS.*?REFERENCE_COORD_SYSTEM_NAME\s*=\s*"(\w+)".*?'
        r"REFERENCE_COORD_SYSTEM_INDEX\s*=\s*(\S+)", text, re.S)
    rover = re.search(
        r"GROUP\s*=\s*ROVER_COORD_SYSTEM_PARMS.*?ORIGIN_OFFSET_VECTOR\s*=\s*\(([^)]*)\)", text, re.S)
    return {
        "offset": (rec - 1) * rec_bytes, "lines": lines, "samples": samples, "bands": bands,
        "bits": bits, "kind": kind,
        "frame": frame.group(1) if frame else None, "index": frame.group(2) if frame else None,
        "rover": [float(v) for v in rover.group(1).split(",")] if rover else None,
    }


def read_image(path, lab):
    if lab["bits"] == 32:
        dtype = ">f4" if "IEEE" in lab["kind"] and "PC" not in lab["kind"] else "<f4"
    else:
        dtype = ">i2" if "MSB" in lab["kind"] else "<i2"
    count = lab["lines"] * lab["samples"] * lab["bands"]
    data = np.fromfile(path, dtype=dtype, count=count, offset=lab["offset"])
    return data.reshape(lab["bands"], lab["lines"], lab["samples"])


def bilinear(grid, col, row):
    c0 = np.clip(np.floor(col).astype(int), 0, grid.shape[1] - 2)
    r0 = np.clip(np.floor(row).astype(int), 0, grid.shape[0] - 2)
    fc, fr = col - c0, row - r0
    return (grid[r0, c0] * (1 - fc) * (1 - fr) + grid[r0, c0 + 1] * fc * (1 - fr)
            + grid[r0 + 1, c0] * (1 - fc) * fr + grid[r0 + 1, c0 + 1] * fc * fr)


def main(data_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)

    # --- orbital square -------------------------------------------------------------------
    with rasterio.open(os.path.join(data_dir, "orbital/gale_boxwork_dem_1m_1200m.tif")) as ds:
        win = from_bounds(E0 - HALF, N0 - HALF, E0 + HALF, N0 + HALF, ds.transform)
        win = win.round_offsets().round_lengths()
        dem = ds.read(1, window=win).astype(np.float64)
        tr = ds.window_transform(win)
    # Cell (row, col) covers a 1 m square. Its centre is at tr.c + (col + 0.5), tr.f - (row + 0.5).
    rel = dem - Z0
    np.round(rel * 100).astype("<i2").tofile(os.path.join(out_dir, "orbital_height.bin"))

    with rasterio.open(os.path.join(data_dir, "orbital/gale_boxwork_ortho_25cm_1200m.tif")) as ds:
        win = from_bounds(E0 - HALF, N0 - HALF, E0 + HALF, N0 + HALF, ds.transform)
        win = win.round_offsets().round_lengths()
        ortho = ds.read(1, window=win)
    # Display stretch only: map the 1st to 99th percentile of this square to 0.30 .. 1.00.
    lo, hi = np.percentile(ortho, [1, 99])
    ortho = (255 * (0.30 + 0.70 * np.clip((ortho - lo) / max(hi - lo, 1), 0, 1))).astype(np.uint8)
    Image.fromarray(ortho).resize((ORTHO_PX, ORTHO_PX), Image.LANCZOS).save(
        os.path.join(out_dir, "orbital_ortho.jpg"), quality=88)

    # --- Navcam points ---------------------------------------------------------------------
    n = int(round(2 * NEAR_HALF / CELL))
    h_sum = np.zeros(n * n); g_sum = np.zeros(n * n); cnt = np.zeros(n * n)
    used = []
    check = {"lo": [], "d": []}
    for lbl in sorted(glob.glob(os.path.join(data_dir, "navcam-sol04709/N?B_*XYZLF*.LBL"))):
        img = lbl[:-3] + "IMG"
        if not os.path.exists(img):
            continue
        lab = read_label(lbl)
        if lab["index"] == "120":
            o_n, o_e, o_h = N0, E0, Z0
        elif lab["index"] == "119":
            o_n, o_e, o_h = N0 - SITE119_ROVER[0], E0 - SITE119_ROVER[1], Z0 + SITE119_ROVER[2]
        else:
            continue
        # float64: an easting of 8 million metres does not fit in float32 to better than 0.5 m.
        xyz = read_image(img, lab).astype(np.float64)
        ok = ~((xyz[0] == 0) & (xyz[1] == 0) & (xyz[2] == 0))
        ras_path = img.replace("XYZLF", "RASLF")
        grey = None
        if os.path.exists(ras_path) and os.path.exists(ras_path[:-3] + "LBL"):
            rl = read_label(ras_path[:-3] + "LBL")
            if (rl["lines"], rl["samples"]) == (lab["lines"], lab["samples"]):
                grey = read_image(ras_path, rl)[0].astype(np.float64)
        e = o_e + xyz[1][ok] - E0           # east of the origin, metres
        nn = o_n + xyz[0][ok] - N0          # north of the origin
        h = o_h - xyz[2][ok] - Z0           # above the origin
        rng = np.hypot(e, nn)
        keep = (rng < MAX_RANGE) & (np.abs(e) < NEAR_HALF) & (np.abs(nn) < NEAR_HALF)
        col = ((e[keep] + NEAR_HALF) / CELL).astype(int)
        row = ((NEAR_HALF - nn[keep]) / CELL).astype(int)
        idx = row * n + col
        h_sum += np.bincount(idx, h[keep], n * n)
        cnt += np.bincount(idx, minlength=n * n)
        if grey is not None:
            g_sum += np.bincount(idx, grey[ok][keep], n * n)
        else:
            g_sum += np.bincount(idx, np.full(idx.shape, np.nan), n * n)
        used.append(os.path.basename(img))

    cnt2 = cnt.reshape(n, n)
    measured = cnt2 >= MIN_POINTS
    near_h = np.where(measured, h_sum.reshape(n, n) / np.maximum(cnt2, 1), 0.0)
    near_g = np.where(measured, g_sum.reshape(n, n) / np.maximum(cnt2, 1), 0.0)

    # Orbital ground under each 5 cm cell centre.
    cc = (np.arange(n) + 0.5) * CELL - NEAR_HALF          # east of the origin
    rr = NEAR_HALF - (np.arange(n) + 0.5) * CELL          # north of the origin
    ee, nn2 = np.meshgrid(cc, rr)
    orb = bilinear(rel, (E0 + ee - tr.c) - 0.5, (tr.f - (N0 + nn2)) - 0.5)
    diff = np.where(measured, near_h - orb, 0.0)

    # Cleaning. Each step removes cells from the measured set. Removed cells fall back to the
    # orbital ground. The counts go into terrain.json.
    before = int(measured.sum())
    # 1. The rover itself: its body is inside this radius and is not ground.
    rover = np.hypot(ee, nn2) < ROVER_RADIUS
    measured &= ~rover
    # 2. Outliers: a cell that differs from the median of its 45 cm neighbourhood by more than
    #    OUTLIER_M. The median runs over a hole-filled copy.
    num = ndimage.gaussian_filter(diff * measured, 2.0)
    den = ndimage.gaussian_filter(measured.astype(float), 2.0)
    filled0 = np.where(measured, diff, num / np.maximum(den, 1e-6))
    med = ndimage.median_filter(filled0, size=9)
    outlier = measured & (np.abs(diff - med) > OUTLIER_M)
    measured &= ~outlier
    # 3. Thin support: a cell whose 55 cm neighbourhood is less than 40 % measured.
    support = ndimage.uniform_filter(measured.astype(float), size=11)
    thin = measured & (support < 0.4)
    measured &= ~thin
    cleaning = {"measured_before": before, "rover_radius_m": ROVER_RADIUS,
                "removed_rover": int((rover & (cnt2 >= MIN_POINTS)).sum()),
                "outlier_m": OUTLIER_M, "removed_outlier": int(outlier.sum()),
                "removed_thin_support": int(thin.sum()), "measured_after": int(measured.sum())}
    diff = np.where(measured, diff, 0.0)

    # Alignment numbers on 1 m blocks of measured cells.
    blk = int(round(1 / CELL))
    d_blocks = (diff.reshape(n // blk, blk, n // blk, blk).sum(axis=(1, 3))
                / np.maximum(measured.reshape(n // blk, blk, n // blk, blk).sum(axis=(1, 3)), 1))
    full = measured.reshape(n // blk, blk, n // blk, blk).mean(axis=(1, 3)) > 0.5
    dvals = d_blocks[full]

    # The measured ground and the orbital ground disagree by a few decimetres over metres
    # (see alignment_check). If holes fell back to the orbital height, each hole would show as a
    # pit or a spike. So the difference is split in two parts:
    #   low  = the difference smoothed over about 2 m, carried across holes from measured cells
    #   high = what is left, kept only on measured cells
    # In a hole the surface is the orbital shape moved by `low`. It is not measured there.
    m = measured.astype(float)
    sig = 2.0 / CELL
    den = ndimage.gaussian_filter(m, sig)
    low = ndimage.gaussian_filter(diff * m, sig) / np.maximum(den, 1e-9)
    far_from_data = den < 0.02
    if far_from_data.any() and (~far_from_data).any():
        idx = ndimage.distance_transform_edt(far_from_data, return_distances=False, return_indices=True)
        low = low[idx[0], idx[1]]
    high = (diff - low) * m
    hden = ndimage.gaussian_filter(m, 1.5)
    high_fill = ndimage.gaussian_filter(high, 1.5) / np.maximum(hden, 1e-6)
    weight = ndimage.gaussian_filter(ndimage.binary_erosion(measured, iterations=2).astype(float), 3.0)
    weight = np.clip(weight * 1.6 - 0.3, 0, 1)
    high = np.where(measured, high, high_fill) * weight
    # Fade everything to zero in the outer 4 m of the square, where the app joins the surfaces.
    edge = np.minimum(NEAR_HALF - np.abs(ee), NEAR_HALF - np.abs(nn2))
    fade = np.clip((edge - 0.5) / 3.5, 0, 1)
    fade = fade * fade * (3 - 2 * fade)
    detail = (low + high) * fade
    np.clip(np.round(detail * 1000), -32767, 32767).astype("<i2").tofile(
        os.path.join(out_dir, "near_detail.bin"))
    Image.fromarray((measured * 255).astype(np.uint8)).save(os.path.join(out_dir, "near_weight.png"))

    g = near_g.copy()
    if measured.any() and np.isfinite(g[measured]).any():
        lo, hi = np.nanpercentile(g[measured], [1, 99])
        g = 0.30 + 0.70 * np.clip((g - lo) / max(hi - lo, 1e-6), 0, 1)
        g_fill = ndimage.gaussian_filter(np.nan_to_num(g) * measured, 2.0) / np.maximum(
            ndimage.gaussian_filter(measured.astype(float), 2.0), 1e-6)
        g = np.where(measured, np.nan_to_num(g), g_fill)
    Image.fromarray((np.nan_to_num(g) * 255).astype(np.uint8)).save(os.path.join(out_dir, "near_grey.png"))

    meta = {
        "note": "Made by tools/build_gale_terrain.py from NASA files. See SOURCES.md.",
        "origin": {"easting_m": E0, "northing_m": N0, "elevation_m": Z0,
                   "what": "Curiosity position, sol 4709, site 120 drive 0 (MMGIS waypoints)"},
        "axes": "app x = east, app z = minus north, app y = up, metres from the origin",
        "orbital": {"size_m": 2 * HALF, "cells": int(rel.shape[0]), "cell_m": 1.0,
                    "height_unit": "cm above origin, int16 LE, row 0 is the north edge",
                    "ortho_px": ORTHO_PX,
                    "min_m": float(rel.min()), "max_m": float(rel.max())},
        "near": {"size_m": 2 * NEAR_HALF, "cells": n, "cell_m": CELL,
                 "detail_unit": "mm, measured minus orbital, feathered, int16 LE",
                 "measured_fraction": float(measured.mean()),
                 "navcam_files": len(used), "points": int(cnt.sum()), "cleaning": cleaning},
        "alignment_check": {
            "what": "Navcam ground minus orbital ground on 1 m blocks that are more than half measured",
            "blocks": int(dvals.size),
            "median_m": float(np.median(dvals)) if dvals.size else None,
            "std_m": float(dvals.std()) if dvals.size else None,
            "p5_m": float(np.percentile(dvals, 5)) if dvals.size else None,
            "p95_m": float(np.percentile(dvals, 95)) if dvals.size else None,
        },
    }
    json.dump(meta, open(os.path.join(out_dir, "terrain.json"), "w"), indent=1)
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

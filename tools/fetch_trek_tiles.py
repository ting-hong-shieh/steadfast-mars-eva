# Written with an AI tool (Claude). See AI_USE.md.
"""Download JPL Mars Trek tiles around the scene and stitch them for the corner map.

The map in the helmet view works without a network. So the tiles are fetched once, here, and
shipped with the app. The app never calls Mars Trek at run time.

Sources: three JPL Mars Trek WMTS layers, equirectangular tiles in degrees (TileMatrixSet
default028mm, 256 px, level 0 is two tiles of 180 degrees). See LAYERS below for the
capabilities link of each.
  hirise   "MRO HiRISE, Curiosity Roving Site Mosaic", the close map (levels 13 to 16)
  ctx      "MRO CTX, Gale Crater Mosaic", the wide map (levels 9, 11 and 12)
  geology  "Global Geology", USGS SIM 3292, the geology layer (level 9).
           Unit names come from the layer's ArcGIS identify service at a grid of points.

Frames. Our ground (SOURCES.md S6, S7) is in Mars_Equirectangular_clon0 on the Mars 2000 sphere
(radius 3,396,190 m, standard parallel 0, central meridian 0), read from the orthophoto crop's
header. In that frame easting / k and northing / k are longitude and latitude in degrees, with
k = 3,396,190 * pi / 180 metres per degree. The Trek tiles are linear in degrees too, so the
mapping between the two is linear. app x = easting - E0, app z = -(northing - N0).

Outputs:
  app/public/data/trek_<layer>_z<level>.jpg|png  north up, one image per layer and zoom level
  app/public/data/trek_tiles.json                bounds of each image in app metres, tile list
                                                 with sha256, the layers, the geology legend,
                                                 the time of download
Raw tiles are kept in <raw_dir>/<level>/<row>/<col>.png (HiRISE, as before) and
<raw_dir>/<layer>/<level>/<row>/<col>.png (the others).

Run:
  uv run --no-project --with pillow python -I tools/fetch_trek_tiles.py \
      /mnt/d/Data/nasa-space-apps-2026-martian-map/trek app/public/data
"""
import datetime
import hashlib
import io
import json
import math
import os
import sys
import time
import urllib.request

from PIL import Image

TREK = "https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{z}/{row}/{col}.png"
GEO = ("https://trek.nasa.gov/mars/trekarcgis/rest/services/SIM3292_Global_Geology/MapServer/WMTS/tile/"
       "1.0.0/SIM3292_Global_Geology/default/default028mm/{z}/{row}/{col}.png")
IDENTIFY = ("https://trek.nasa.gov/mars/trekarcgis/rest/services/SIM3292_Global_Geology/MapServer/identify"
            "?geometry={lon},{lat}&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=1"
            "&mapExtent={w},{s},{e},{n}&imageDisplay=400,400,96&returnGeometry=false&f=json")
# Half width in metres of the square kept at each level. The person can walk to 288 m from the
# origin, and the widest map shown with each level reaches this far past that.
LAYERS = {
    "hirise": {"name": "MRO HiRISE, Curiosity Roving Site Mosaic", "id": "curiosity_hirise_mosaic",
               "caps": "https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/WMTSCapabilities.xml",
               "bbox": (137.1224669, -4.9254743, 137.7298129, -4.2489588),
               "levels": {16: 480, 15: 800, 14: 1600, 13: 3200}, "grey": True, "ext": "jpg"},
    "ctx": {"name": "MRO CTX, Gale Crater Mosaic", "id": "Gale_CTX_BlockAdj_dd",
            "caps": "https://trek.nasa.gov/tiles/Mars/EQ/Gale_CTX_BlockAdj_dd/1.0.0/WMTSCapabilities.xml",
            "bbox": (135.1842593, -6.5732988, 139.2413012, -2.8077809),
            "levels": {12: 6500, 11: 17000, 9: 48000}, "grey": True, "ext": "jpg"},
    "geology": {"name": "Global Geology (USGS SIM 3292)", "id": "SIM3292_Global_Geology",
                "caps": "https://trek.nasa.gov/tiles/Mars/EQ/SIM3292_Global_Geology/1.0.0/WMTSCapabilities.xml",
                "bbox": (-180, -90, 180, 90), "levels": {9: 48000}, "grey": False, "ext": "png"},
}

R = 3396190.0
K = R * math.pi / 180.0          # metres per degree on the sphere, at the standard parallel 0
E0, N0 = 8143220.156, -284992.705  # Curiosity, sol 4709, site 120 drive 0 (MMGIS), as in terrain.json
LON0, LAT0 = E0 / K, N0 / K

TILE = 256


def fetch(url, tries=4):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "martian-map-tile-fetch/0.1"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if k == tries - 1:
                raise
            print(f"retry {url}: {e}", file=sys.stderr)
            time.sleep(2 + 3 * k)


def stitch(key, cfg, raw_dir, out_dir):
    levels = []
    for z, half in cfg["levels"].items():
        span = 180.0 / 2 ** z                        # degrees per tile
        lon_w, lon_e = LON0 - half / K, LON0 + half / K
        lat_n, lat_s = LAT0 + half / K, LAT0 - half / K
        b = cfg["bbox"]
        c0, c1 = math.floor((lon_w + 180) / span), math.floor((lon_e + 180) / span)
        r0, r1 = math.floor((90 - lat_n) / span), math.floor((90 - lat_s) / span)
        img = Image.new("L" if cfg["grey"] else "RGB", ((c1 - c0 + 1) * TILE, (r1 - r0 + 1) * TILE))
        tiles = []
        for row in range(r0, r1 + 1):
            for col in range(c0, c1 + 1):
                sub = [str(z)] if key == "hirise" else [key, str(z)]
                path = os.path.join(raw_dir, *sub, str(row), f"{col}.png")
                if not os.path.exists(path):
                    url = GEO.format(z=z, row=row, col=col) if key == "geology" else TREK.format(layer=cfg["id"], z=z, row=row, col=col)
                    data = fetch(url)
                    os.makedirs(os.path.dirname(path), exist_ok=True)
                    with open(path, "wb") as f:
                        f.write(data)
                    time.sleep(0.15)
                data = open(path, "rb").read()
                tile = Image.open(io.BytesIO(data))
                assert tile.size == (TILE, TILE), (path, tile.size)
                img.paste(tile.convert(img.mode), ((col - c0) * TILE, (row - r0) * TILE))
                tiles.append({"row": row, "col": col, "sha256": hashlib.sha256(data).hexdigest()})
        west, east = c0 * span - 180, (c1 + 1) * span - 180
        north, south = 90 - r0 * span, 90 - (r1 + 1) * span
        name = f"trek_{key}_z{z}.{cfg['ext']}"
        if cfg["ext"] == "jpg":
            img.save(os.path.join(out_dir, name), quality=80, optimize=True, progressive=True)
        else:
            img.save(os.path.join(out_dir, name), optimize=True)
        levels.append({
            "level": z, "image": name, "px": list(img.size),
            "m_per_px": span * K / TILE,
            "degrees": {"west": west, "east": east, "north": north, "south": south},
            "data_bbox_deg": list(b),
            "app_m": {"x_min": (west - LON0) * K, "x_max": (east - LON0) * K,
                      "z_min": -(north - LAT0) * K, "z_max": -(south - LAT0) * K},
            "tiles": tiles,
        })
        print(f"{key} level {z}: {len(tiles)} tiles, {img.size[0]} x {img.size[1]} px, {span * K / TILE:.2f} m/px")
    return levels


def legend(out_dir, geo_level, half=40000, n=17):
    """Unit names at a grid of points, and the colour of each unit in the stitched geology image."""
    img = Image.open(os.path.join(out_dir, geo_level["image"])).convert("RGB")
    a, d = geo_level["app_m"], geo_level["degrees"]
    units = {}
    for i in range(n):
        for j in range(n):
            x = -half + 2 * half * j / (n - 1)
            zz = -half + 2 * half * i / (n - 1)
            lon, lat = LON0 + x / K, LAT0 - zz / K
            url = IDENTIFY.format(lon=lon, lat=lat, w=lon - 0.5, s=lat - 0.5, e=lon + 0.5, n=lat + 0.5)
            res = json.loads(fetch(url)).get("results", [])
            time.sleep(0.1)
            if not res:
                continue
            at = res[0]["attributes"]
            px = int((x - a["x_min"]) / (a["x_max"] - a["x_min"]) * img.size[0])
            py = int((zz - a["z_min"]) / (a["z_max"] - a["z_min"]) * img.size[1])
            u = units.setdefault(at["Unit"], {"unit": at["Unit"], "desc": at["UnitDesc"], "points": 0, "colors": {}})
            u["points"] += 1
            c = "#%02x%02x%02x" % img.getpixel((px, py))
            u["colors"][c] = u["colors"].get(c, 0) + 1
    out = []
    for u in units.values():
        u["color"] = max(u["colors"], key=u["colors"].get)
        del u["colors"]
        out.append(u)
    lon0, lat0 = LON0, LAT0
    here = json.loads(fetch(IDENTIFY.format(lon=lon0, lat=lat0, w=lon0 - 0.5, s=lat0 - 0.5, e=lon0 + 0.5, n=lat0 + 0.5)))["results"][0]["attributes"]
    print("units:", [(u["unit"], u["points"], u["color"]) for u in out], "here:", here["Unit"])
    return {"grid": f"{n} x {n} points over +-{half} m", "here": {"unit": here["Unit"], "desc": here["UnitDesc"],
            "area_km2": float(here["SphArea_km"])}, "units": sorted(out, key=lambda u: -u["points"])}


def main(raw_dir, out_dir):
    fetched = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    layers = {key: {"name": cfg["name"], "id": cfg["id"], "capabilities": cfg["caps"],
                    "levels": stitch(key, cfg, raw_dir, out_dir)} for key, cfg in LAYERS.items()}
    meta = {
        "note": "Made by tools/fetch_trek_tiles.py. See SOURCES.md and docs/methods.md.",
        "source": "JPL Mars Trek WMTS",
        "fetched_utc": fetched,
        "frame": "Trek EQ tiles are linear in degrees. App metres use k = 3396190 * pi / 180 m per degree, "
                 "the Mars 2000 sphere at standard parallel 0, the frame of the S6 and S7 files.",
        "origin_deg": {"lon": LON0, "lat": LAT0},
        "layers": layers,
        "geology_legend": legend(out_dir, layers["geology"]["levels"][0]),
    }
    with open(os.path.join(out_dir, "trek_tiles.json"), "w") as f:
        json.dump(meta, f, indent=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

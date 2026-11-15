# Written with an AI tool (Claude). See AI_USE.md.
"""Station photos: calibrated Curiosity Mastcam M-100 images taken at real stops.

For each station: read the PDS DRCX product (PDS3 attached label, 16-bit, 3 bands), write a JPEG
for the app, and write app/public/data/stations.json with the stop position (MSL PLACES
localized_pos.csv), the product facts from the label, and sha256 of input and output.

Colour: DRCX is "color corrected" so that it is "roughly what the planetary surface would look
like if it were viewed by the human eye in situ" (MMM SIS v1.5, section 4.1.2.12). The display
stretch is ours: red 99.5th percentile -> 1, then the sRGB transfer. Brightness is not a measurement.

Run:  uv run --no-project --with numpy --with pillow python -I tools/station_photos.py \
        <folder with *.IMG> <localized_pos.csv> app/public
"""
import csv, hashlib, json, math, re, sys
import numpy as np
from PIL import Image

# Station id -> (product id, target named in the label rationale).
STATIONS = [
    ("STN A", "4616MR1080340022303802C00", "Villa_Abecia"),
    ("STN B", "4829MR1089100011904857C00", "Jayhuayco"),
    ("STN C", "4838MR1089560042500014C00", "Salar_De_Maricunga"),
]
R = 3396190.0; K = R * math.pi / 180      # Mars_Equirectangular_clon0 sphere
LON0, LAT0 = 137.3810495, -4.80799931      # HAB = Curiosity site 120 drive 0

def label(raw):
    head = raw[:200000].decode("latin1")
    g = lambda k: (re.search(rf"\b{k}\s*=\s*\"?([^\"\r\n]*)", head) or [None, None])[1]
    rat = re.search(r'RATIONALE_DESC\s*=\s*"([^"]*)"', head, re.S)
    rmc = re.search(r"ROVER_MOTION_COUNTER\s*=\s*\(\s*(\d+),\s*(\d+)", head)
    return head, {"image_id": g("IMAGE_ID"), "sol": int(g("PLANET_DAY_NUMBER")), "start_time": g("START_TIME").strip(),
                  "ltst": g("LOCAL_TRUE_SOLAR_TIME").strip(), "solar_elevation_deg": float(g("SOLAR_ELEVATION")),
                  "azimuth_deg": float(g("FIXED_INSTRUMENT_AZIMUTH")), "elevation_deg": float(g("FIXED_INSTRUMENT_ELEVATION")),
                  "site": int(rmc.group(1)), "drive": int(rmc.group(2)),
                  "rationale": re.sub(r"\s+", " ", rat.group(1)).strip()}

def pixels(raw, head):
    rb = int(re.search(r"RECORD_BYTES\s*=\s*(\d+)", head).group(1))
    ptr = int(re.search(r"\^IMAGE\s*=\s*(\d+)", head).group(1))
    obj = head[head.index("OBJECT = IMAGE"):] if "OBJECT = IMAGE" in head else head
    L = int(re.search(r"\bLINES\s*=\s*(\d+)", obj).group(1)); S = int(re.search(r"LINE_SAMPLES\s*=\s*(\d+)", obj).group(1))
    B = int(re.search(r"\bBANDS\s*=\s*(\d+)", obj).group(1))
    return np.frombuffer(raw, dtype=">i2", count=L * S * B, offset=(ptr - 1) * rb).reshape(B, L, S).astype(np.float32)

def srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * x ** (1 / 2.4) - 0.055)

def main(src, pos_csv, public):
    pos = {}
    for r in csv.DictReader(open(pos_csv)):
        try: pos[(int(r["site"]), int(r["drive"]))] = (float(r["longitude"]), float(r["planetocentric_latitude"]))
        except ValueError: pass
    out = []
    for sid, pid, target in STATIONS:
        raw = open(f"{src}/{pid}.IMG", "rb").read()
        head, lab = label(raw)
        a = pixels(raw, head)
        scale = np.percentile(a[0][a[0] > 0], 99.5)
        im = Image.fromarray((srgb(a / scale).transpose(1, 2, 0) * 255 + 0.5).astype(np.uint8))
        im.thumbnail((900, 900), Image.LANCZOS)
        name = f"data/stations/{pid}_DRCX.jpg"
        im.save(f"{public}/{name}", quality=88)
        lon, lat = pos[(lab["site"], lab["drive"])]
        out.append({"id": sid, "target": target, **lab,
                    "x": round((lon - LON0) * K, 2), "z": round(-(lat - LAT0) * K, 2), "lon": lon, "lat": lat,
                    "photo": name, "product": f"{pid}_DRCX.IMG",
                    "sha256_product": hashlib.sha256(raw).hexdigest(),
                    "sha256_photo": hashlib.sha256(open(f"{public}/{name}", "rb").read()).hexdigest()})
    json.dump({"source": "PDS Imaging Node, msl_mmm data_MSLMST calibrated (DRCX); stop positions MSL PLACES localized_pos.csv",
               "credit": "NASA/JPL-Caltech/MSSS", "stretch": "red 99.5th percentile -> 1, sRGB transfer (ours)",
               "stations": out}, open(f"{public}/data/stations.json", "w"), indent=1)
    for s in out: print(s["id"], s["target"], s["sol"], s["site"], s["drive"], s["x"], s["z"])

if __name__ == "__main__":
    main(*sys.argv[1:4])

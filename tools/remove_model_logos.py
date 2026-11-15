# Written with an AI tool (Claude). See AI_USE.md.
"""Take the logos off the textures of two NASA 3D models that the app ships (SOURCES.md S39).

uv run --no-project --with pillow python -I tools/remove_model_logos.py app/public/models

Why: the product must show no NASA logo, flag or mission mark (owner, 2026-11-15, and the
contest rule on logos in docs/contest-rules.md). The models came from NASA 3D Resources with
such marks painted on them:

  hdu.glb    the habitat. Its one texture (1,024 px, stored as WebP and as JPEG) carried two NASA
             insignia, flags, two X-Hab marks and two HDU patches on the wall, and a small
             insignia and a small flag beside each of the eight segment labels.
  mark3.glb  the suit that stands in when the walking figure does not load. One of its textures
             ("texturelogo", 700 px) was the NASA insignia on a plain ground.

What it does: each mark is painted over with the wall colour of its own row (the pixels just
left and right of it, blended across), so seams and shading stay. The logo texture of the suit
becomes its own plain ground colour. Shapes and materials are untouched. The changed pictures
are stored again at quality 95, so their other pixels differ by what that compression does.
Run it on the files as they came from tools/prep_nasa_model.py: a second run finds no mark
but compresses the pictures once more.
"""
import hashlib
import io
import json
import struct
import sys
from pathlib import Path

from PIL import Image

# Rectangles on the habitat texture, in pixels of its 1,024 px side: x0, y0, x1, y1.
HDU_MARKS = [
    (195, 70, 247, 125), (195, 395, 247, 450),      # flags on the wall
    (187, 154, 253, 210), (187, 478, 253, 534),     # NASA insignia
    (181, 232, 261, 290), (181, 557, 261, 612),     # X-Hab marks
    (24, 232, 86, 286), (64, 560, 121, 607),        # HDU patches
    (131, 0, 149, 660),                             # the column of small insignia and flags beside the segment labels
]


def paint_over(im, marks):
    px = im.load()
    w, h = im.size
    k = w / 1024
    for x0, y0, x1, y1 in marks:
        x0, y0, x1, y1 = (round(v * k) for v in (x0, y0, x1, y1))
        for y in range(max(0, y0), min(h, y1)):
            # The wall colour on each side: the mean of three pixels just outside the mark.
            left = [sum(px[x, y][c] for x in range(x0 - 4, x0 - 1)) / 3 for c in range(3)]
            right = [sum(px[x, y][c] for x in range(x1 + 1, x1 + 4)) / 3 for c in range(3)]
            for x in range(x0, x1):
                t = (x - x0) / max(1, x1 - x0 - 1)
                px[x, y] = tuple(round(left[c] + (right[c] - left[c]) * t) for c in range(3))
    return im


def encode(im, mime):
    out = io.BytesIO()
    if mime == "image/webp":
        im.save(out, "WEBP", quality=95, method=6)
    elif mime == "image/png":
        im.save(out, "PNG", optimize=True)
    else:
        im.save(out, "JPEG", quality=95)
    return out.getvalue()


def rewrite(path, change):
    """change(image name, PIL image) returns a new PIL image, or None to keep the picture."""
    raw = path.read_bytes()
    assert raw[:4] == b"glTF"
    off, js, blob = 12, None, b""
    while off < len(raw):
        n, kind = struct.unpack("<II", raw[off:off + 8])
        data = raw[off + 8:off + 8 + n]
        off += 8 + n
        if kind == 0x4E4F534A:
            js = json.loads(data)
        elif kind == 0x004E4942:
            blob = data
    new = {}
    for im in js.get("images", []):
        bv = js["bufferViews"][im["bufferView"]]
        start = bv.get("byteOffset", 0)
        pic = Image.open(io.BytesIO(blob[start:start + bv["byteLength"]])).convert("RGB")
        out = change(im.get("name", ""), pic)
        if out is not None:
            new[im["bufferView"]] = encode(out, im["mimeType"])
    # The binary part again, view by view, each at a multiple of four bytes.
    order = sorted(range(len(js["bufferViews"])), key=lambda i: js["bufferViews"][i].get("byteOffset", 0))
    body = bytearray()
    for i in order:
        bv = js["bufferViews"][i]
        start = bv.get("byteOffset", 0)
        data = new.get(i, blob[start:start + bv["byteLength"]])
        while len(body) % 4:
            body.append(0)
        bv["byteOffset"], bv["byteLength"] = len(body), len(data)
        body += data
    while len(body) % 4:
        body.append(0)
    js["buffers"][0]["byteLength"] = len(body)
    text = json.dumps(js, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    out = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(text) + 8 + len(body))
    out += struct.pack("<II", len(text), 0x4E4F534A) + text + struct.pack("<II", len(body), 0x004E4942) + bytes(body)
    before = hashlib.sha256(raw).hexdigest()
    path.write_bytes(out)
    print(f"{path.name}: {len(new)} pictures written again, sha256 {before[:12]}… -> {hashlib.sha256(out).hexdigest()}")


def main():
    folder = Path(sys.argv[1])
    rewrite(folder / "hdu.glb", lambda name, pic: paint_over(pic, HDU_MARKS))
    # The suit's logo texture: one plain colour, the one in its corner.
    rewrite(folder / "mark3.glb", lambda name, pic: Image.new("RGB", pic.size, pic.getpixel((4, 4))) if "logo" in name.lower() else None)


if __name__ == "__main__":
    main()

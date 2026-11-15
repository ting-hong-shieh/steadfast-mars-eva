#!/usr/bin/env python3
# Written with an AI tool (Claude). See AI_USE.md.
"""Can the orbital data alone tell the ground type? A check, with a negative result.

Why: the camera model (tools/seg) gives ground types only on two 48 m patches. The owner asked for
ground types over the whole map (2026-11-15). Before drawing any, this script tests whether the
orbital elevation model and orthoimage can predict the camera model's classes.

How:
  features of a 1 m cell, all from the files the app already ships:
    brightness of the 25 cm orthoimage (mean of the 4 x 4 pixels), its spread inside the cell and
    in a 3 m window, slope of the 1 m elevation model, roughness (spread of height minus its 5 m
    mean), height minus its 15 m mean (hollow or bump). Each feature is standardized per place.
  labels: the camera model's classes on the two patches (5 cm cells), one label per 1 m cell that
    holds at least 60 classified cells: the most common class.
  model: multinomial logistic regression (numpy, gradient descent, class-balanced weights).
  check: train on one patch, test on the other, both ways.

Result of 2026-11-15: agreement 0.38 and 0.24, below always answering the most common class
(0.52 and 0.69). Inside one patch (west half to east half) 0.49 against 0.42. Shifting the labels
by up to 4 m does not help, so it is not a misalignment. Conclusion: at this place the orbital
data does not carry the ground type. The app therefore shows NO estimated ground types outside the
two patches. The check is written to ground_est.json.

Run:
  uv run --no-project --with numpy --with pillow --with scipy python -I tools/build_ground_estimate.py app/public/data docs/research/2026-11-15-ground-estimate-check.json
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

CLASSES = ["soil", "bedrock", "sand", "big rock"]


def features(d):
    h = np.fromfile(os.path.join(d, "orbital_height.bin"), dtype="<i2").reshape(600, 600).astype(np.float64) / 100
    o = np.asarray(Image.open(os.path.join(d, "orbital_ortho.jpg")).convert("L"), dtype=np.float64)
    o = o.reshape(600, 4, 600, 4)
    bright = o.mean(axis=(1, 3))
    fine = o.std(axis=(1, 3))                                   # spread inside the 1 m cell
    spread = np.sqrt(np.maximum(0, ndi.uniform_filter(bright ** 2, 3) - ndi.uniform_filter(bright, 3) ** 2))
    gy, gx = np.gradient(h)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    res = h - ndi.uniform_filter(h, 5)
    rough = np.sqrt(ndi.uniform_filter(res ** 2, 5))
    tpi = h - ndi.uniform_filter(h, 15)
    f = np.stack([bright, fine, spread, slope, rough, tpi], axis=-1)
    f = (f - f.mean(axis=(0, 1))) / (f.std(axis=(0, 1)) + 1e-9)
    return f


def patch_labels(d, p):
    """1 m cells of a patch: (row, col) in the 600 grid and the most common class."""
    im = np.asarray(Image.open(os.path.join(d, "classes", p["file"])).convert("RGB"))[..., 0]
    n = im.shape[0]
    per_m = int(round(1 / p["cell_m"]))
    m = n // per_m
    im = im[: m * per_m, : m * per_m].reshape(m, per_m, m, per_m).transpose(0, 2, 1, 3).reshape(m, m, -1)
    rows, cols, labs = [], [], []
    for r in range(m):
        for c in range(m):
            v = im[r, c]
            v = v[v < 4]
            if v.size < 60:
                continue
            x = p["x"] - p["half_m"] + c + 0.5
            z = p["z"] - p["half_m"] + r + 0.5
            rows.append(int(np.floor(z + 300))); cols.append(int(np.floor(x + 300)))
            labs.append(int(np.bincount(v, minlength=4).argmax()))
    return np.array(rows), np.array(cols), np.array(labs)


def fit(X, y, steps=3000, lr=0.3, l2=1e-3):
    X1 = np.hstack([X, np.ones((len(X), 1))])
    W = np.zeros((X1.shape[1], 4))
    cnt = np.bincount(y, minlength=4).astype(float)
    w = np.where(cnt > 0, len(y) / (4 * np.maximum(cnt, 1)), 0)[y]
    Y = np.eye(4)[y]
    for _ in range(steps):
        z = X1 @ W
        z -= z.max(axis=1, keepdims=True)
        P = np.exp(z); P /= P.sum(axis=1, keepdims=True)
        W -= lr * (X1.T @ ((P - Y) * w[:, None]) / len(y) + l2 * W)
    return W


def predict(W, X):
    z = np.hstack([X, np.ones((len(X), 1))]) @ W
    z -= z.max(axis=1, keepdims=True)
    P = np.exp(z)
    return P / P.sum(axis=1, keepdims=True)


def main(data):
    idx = json.load(open(os.path.join(data, "classes", "classes.json")))
    F = features(data)
    sets = {}
    for p in idx["patches"]:
        r, c, y = patch_labels(data, p)
        sets[p["name"]] = (F[r, c], y)
        print(p["name"], "cells", len(y), "share", np.round(np.bincount(y, minlength=4) / len(y), 3))
    names = list(sets)
    check = []
    for a, b in [(names[0], names[1]), (names[1], names[0])]:
        W = fit(*sets[a])
        Xb, yb = sets[b]
        pred = predict(W, Xb).argmax(axis=1)
        acc = float((pred == yb).mean())
        base = float(np.bincount(yb, minlength=4).max() / len(yb))
        rec = {CLASSES[k]: (round(float((pred[yb == k] == k).mean()), 3) if (yb == k).any() else None) for k in range(4)}
        check.append({"train": a, "test": b, "cells": int(len(yb)), "agreement": round(acc, 3),
                      "always_most_common": round(base, 3), "recall": rec})
        print("train", a, "test", b, "agreement", round(acc, 3), "baseline", round(base, 3), rec)
    json.dump({
        "note": "Made by tools/build_ground_estimate.py. A check: can six features of the orbital elevation model and "
                "orthoimage predict the camera model's ground classes? Logistic regression, trained on one 48 m patch and "
                "tested on the other. agreement is below always_most_common both ways, so the app draws no estimated ground "
                "types outside the two patches.",
        "check": check,
    }, open(sys.argv[2] if len(sys.argv) > 2 else os.path.join(data, "ground_est.json"), "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1])

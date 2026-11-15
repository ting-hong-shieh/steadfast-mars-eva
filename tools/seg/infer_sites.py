# Written with an AI tool (Claude). See AI_USE.md.
"""Run a trained terrain model on Curiosity Navcam frames and put each class on the ground with the
stereo XYZ products. By default the frames of sol 4709 around HAB (site 120). With --site and
--centre, any other stop: the site frame origin and the patch centre are given as MSL PLACES
northing, easting and elevation (localized_pos.csv), the same source as the station places.

For each left-eye frame that has both RAS (image) and XYZ (stereo points) products:
  1. RAS radiance -> 8-bit: divide by the 99.5th percentile, square root (the onboard 12 to 8 bit
     companding is close to a square root; the training images are those 8-bit EDRs), then x 255.
  2. The model predicts a class for every pixel (soil, bedrock, sand, big rock).
  3. Pixels with a valid XYZ point within MAX_RANGE of the rover vote for the 5 cm ground cell
     they fall in, on the same grid as near_weight.png (tools/build_gale_terrain.py).
Output:
  near_class.png  960 x 960, north-up: 0 soil, 1 bedrock, 2 sand, 3 big rock, 255 no vote
  near_class.json counts, agreement between overlapping frames, the run used, the method
  previews/       one image per frame with the class colours over it (for checking by eye)

Run:  python -I tools/seg/infer_sites.py --run <run dir> --navcam <dir> --out <dir> [--size 1024]
      [--site 118 --origin N,E,ELEV --centre N,E]   (STN A: site 118 drive 0, PLACES SITE row)
"""
import argparse, glob, json, os, sys
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE))
from train_seg import make_model, prep, NC, CLASSES   # noqa: E402
from build_gale_terrain import read_label, read_image, E0, N0, Z0, SITE119_ROVER, NEAR_HALF, CELL, MAX_RANGE, ROVER_RADIUS   # noqa: E402

COLOURS = np.array([[205, 160, 110], [120, 120, 200], [240, 220, 80], [220, 60, 60]], np.uint8)


def to8(ras):
    r = np.clip(ras, 0, None)
    hi = np.percentile(r[r > 0], 99.5) if (r > 0).any() else 1.0
    return (255 * np.sqrt(np.clip(r / hi, 0, 1))).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--run', required=True); ap.add_argument('--navcam', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--size', type=int, default=512); ap.add_argument('--ckpt', default='best.pt')
    ap.add_argument('--site', default=None, help='site index of the frames, e.g. 118')
    ap.add_argument('--origin', default=None, help='PLACES northing,easting,elevation of that site frame origin')
    ap.add_argument('--centre', default=None, help='PLACES northing,easting of the patch centre (default: the origin)')
    a = ap.parse_args()
    # Patch centre (cn, ce) in the HAB frame's map coordinates. Default: HAB itself.
    cn, ce = N0, E0
    if a.site:
        sn, se, sz = (float(v) for v in a.origin.split(','))
        cn, ce = (float(v) for v in a.centre.split(',')) if a.centre else (sn, se)
    os.makedirs(f'{a.out}/previews', exist_ok=True)
    cfg = json.load(open(f'{a.run}/config.json'))
    device = 'cuda'
    torch.cuda.set_per_process_memory_fraction(min(1.0, 9.0 * 2**30 / torch.cuda.get_device_properties(0).total_memory))
    model = make_model(cfg['arm'], img_size=512).to(device)
    model.load_state_dict(torch.load(f'{a.run}/{a.ckpt}', map_location=device)); model.eval()
    if cfg['arm'] == 'dinov3' and a.size != 512:
        model.backbone.set_input_size(img_size=a.size)

    n = int(round(2 * NEAR_HALF / CELL))
    votes = np.zeros((NC, n * n), np.int32)
    per_frame = []
    for lbl in sorted(glob.glob(os.path.join(a.navcam, 'NLB_*XYZLF*.LBL'))):
        img = lbl[:-3] + 'IMG'; ras = img.replace('XYZLF', 'RASLF')
        if not (os.path.exists(img) and os.path.exists(ras)):
            continue
        lab = read_label(lbl); rl = read_label(ras[:-3] + 'LBL')
        if (rl['lines'], rl['samples']) != (lab['lines'], lab['samples']):
            continue
        if a.site:
            if lab['index'] != a.site:
                continue
            o_n, o_e, o_h = sn, se, sz
        elif lab['index'] == '120':
            o_n, o_e, o_h = N0, E0, Z0
        elif lab['index'] == '119':
            o_n, o_e, o_h = N0 - SITE119_ROVER[0], E0 - SITE119_ROVER[1], Z0 + SITE119_ROVER[2]
        else:
            continue
        g8 = to8(read_image(ras, rl)[0].astype(np.float64))
        x = torch.from_numpy(g8).to(device).unsqueeze(0)
        xin = prep(x)
        if xin.shape[-1] != a.size:
            xin = F.interpolate(xin, size=(a.size, a.size), mode='bilinear', align_corners=False)
        with torch.no_grad(), torch.autocast('cuda', dtype=torch.bfloat16):
            out = model(xin)
        cls = F.interpolate(out.float(), size=g8.shape, mode='bilinear', align_corners=False).argmax(1)[0].cpu().numpy()
        xyz = read_image(img, lab).astype(np.float64)
        ok = ~((xyz[0] == 0) & (xyz[1] == 0) & (xyz[2] == 0))
        e = o_e + xyz[1] - ce; nn = o_n + xyz[0] - cn
        # Range from the rover, which stood at the site origin for these frames.
        rng = np.hypot(xyz[0], xyz[1]) if a.site else np.hypot(e, nn)
        keep = ok & (rng < MAX_RANGE) & (rng > ROVER_RADIUS) & (np.abs(e) < NEAR_HALF) & (np.abs(nn) < NEAR_HALF)
        col = ((e[keep] + NEAR_HALF) / CELL).astype(int); row = ((NEAR_HALF - nn[keep]) / CELL).astype(int)
        idx = row * n + col
        c = cls[keep]
        for k in range(NC):
            votes[k] += np.bincount(idx[c == k], minlength=n * n).astype(np.int32)
        frac = np.bincount(cls[keep], minlength=NC) / max(1, keep.sum())
        per_frame.append({'frame': os.path.basename(img), 'ground_pixels': int(keep.sum()),
                          'share': {CL: round(float(f), 4) for CL, f in zip(CLASSES, frac)}})
        rgb = np.repeat(g8[..., None], 3, -1).astype(np.float32)
        over = COLOURS[cls].astype(np.float32)
        rgb[keep] = 0.55 * rgb[keep] + 0.45 * over[keep]
        Image.fromarray(rgb.astype(np.uint8)).resize((512, 512)).save(f'{a.out}/previews/{os.path.basename(img)[:-4]}.jpg', quality=85)
        print(per_frame[-1], flush=True)

    total = votes.sum(0)
    win = votes.argmax(0)
    cls_map = np.where(total > 0, win, 255).astype(np.uint8).reshape(n, n)
    Image.fromarray(cls_map).save(f'{a.out}/near_class.png')
    voted = total > 0
    multi = total >= 2
    agree = (votes.max(0)[multi] / total[multi]).mean() if multi.any() else None
    share = np.bincount(cls_map[cls_map < NC].ravel(), minlength=NC) / max(1, (cls_map < NC).sum())
    info = {'site': a.site or '120', 'centre_northing_easting': [cn, ce], 'run': a.run, 'ckpt': a.ckpt, 'arm': cfg['arm'], 'config': cfg['config'], 'input_size': a.size,
            'frames': len(per_frame), 'cells_voted': int(voted.sum()), 'cells_total': int(n * n),
            'cell_share': {CL: round(float(s), 4) for CL, s in zip(CLASSES, share)},
            'mean_vote_agreement_in_cells_with_2plus_votes': None if agree is None else round(float(agree), 4),
            'method': 'RAS radiance / p99.5, square root, 8-bit; class per pixel; vote per 5 cm cell; range < %.0f m' % MAX_RANGE,
            'per_frame': per_frame}
    json.dump(info, open(f'{a.out}/near_class.json', 'w'), indent=1)
    rgb = np.zeros((n, n, 3), np.uint8); m = cls_map < NC; rgb[m] = COLOURS[cls_map[m]]
    Image.fromarray(rgb).save(f'{a.out}/near_class_colour.png')
    print(json.dumps({k: v for k, v in info.items() if k != 'per_frame'}, indent=1))


if __name__ == '__main__':
    main()

# Written with an AI tool (Claude). See AI_USE.md.
"""Classify any rover images with a trained terrain model and write side-by-side previews.

Used for the Perseverance Raw Images gallery frames (a challenge Resource). There are no labels
for these frames, so the output is for looking at, not a score.

Each image is read as greyscale (colour images are converted, as in training), resized to
--size, classified, and written as <name>_classes.jpg: the image on the left, the classes over it
on the right. classes.json gives the share of each class per image.

Run:  python -I tools/seg/classify_images.py --run <run dir> --out <dir> <image> [<image> ...]
"""
import argparse, json, os, sys
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_seg import make_model, prep, NC, CLASSES   # noqa: E402

COLOURS = np.array([[205, 160, 110], [120, 120, 200], [240, 220, 80], [220, 60, 60]], np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--run', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--size', type=int, default=512); ap.add_argument('--ckpt', default='best.pt')
    ap.add_argument('images', nargs='+')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    cfg = json.load(open(f'{a.run}/config.json'))
    device = 'cuda'
    torch.cuda.set_per_process_memory_fraction(3.0 * 2**30 / torch.cuda.get_device_properties(0).total_memory)
    model = make_model(cfg['arm'], img_size=512).to(device)
    model.load_state_dict(torch.load(f'{a.run}/{a.ckpt}', map_location=device)); model.eval()
    res = {'run': a.run, 'ckpt': a.ckpt, 'arm': cfg['arm'], 'config': cfg['config'], 'images': []}
    for path in a.images:
        im = Image.open(path).convert('L')
        g = np.array(im)
        x = prep(torch.from_numpy(np.array(im.resize((a.size, a.size), Image.BILINEAR))).to(device).unsqueeze(0))
        with torch.no_grad(), torch.autocast('cuda', dtype=torch.bfloat16):
            out = model(x)
        cls = F.interpolate(out.float(), size=g.shape, mode='bilinear', align_corners=False).argmax(1)[0].cpu().numpy()
        share = np.bincount(cls.ravel(), minlength=NC) / cls.size
        rgb = np.repeat(g[..., None], 3, -1).astype(np.float32)
        over = (0.5 * rgb + 0.5 * COLOURS[cls]).astype(np.uint8)
        pair = Image.new('RGB', (2 * g.shape[1], g.shape[0]))
        pair.paste(Image.fromarray(rgb.astype(np.uint8)), (0, 0)); pair.paste(Image.fromarray(over), (g.shape[1], 0))
        d = ImageDraw.Draw(pair)
        for k, c in enumerate(CLASSES):
            d.rectangle([g.shape[1] + 10, 10 + 22 * k, g.shape[1] + 26, 26 + 22 * k], fill=tuple(int(v) for v in COLOURS[k]))
            d.text((g.shape[1] + 32, 12 + 22 * k), c, fill=(255, 255, 255))
        name = os.path.splitext(os.path.basename(path))[0]
        pair.save(f'{a.out}/{name}_classes.jpg', quality=88)
        res['images'].append({'image': os.path.basename(path), 'share': {c: round(float(s), 4) for c, s in zip(CLASSES, share)}})
        print(res['images'][-1], flush=True)
    json.dump(res, open(f'{a.out}/classes.json', 'w'), indent=1)


if __name__ == '__main__':
    main()

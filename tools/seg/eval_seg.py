# Written with an AI tool (Claude). See AI_USE.md.
"""Test a trained model on the Curiosity Navcam expert test sets (min1, min2, min3).

Convention (fixed before any test was run): one confusion matrix pooled over all labelled test
pixels at the full 1024 px label resolution. The model sees the image at --size (512 or 1024)
and its output is resized to 1024 bilinearly. Reports per-class IoU, mIoU over 4 classes,
mIoU without big rock, pixel accuracy, and 95 % bootstrap intervals over test images.

Run:  python -I tools/seg/eval_seg.py --data <prep dir> --run <run dir> [--size 512]
"""
import argparse, json, os, sys
import numpy as np
import torch
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_seg import make_model, confusion, iou, NC, CLASSES   # noqa: E402


def per_image_cms(model, img, lab, device, size):
    return np.stack([confusion(model, img, lab, [k], device, bs=1, size=size) for k in range(len(img))])


def summary(cm):
    v = iou(cm)
    return {'iou': {c: (None if np.isnan(t) else round(float(t), 4)) for c, t in zip(CLASSES, v)},
            'miou': round(float(np.nanmean(v)), 4), 'miou_no_bigrock': round(float(np.nanmean(v[:3])), 4),
            'pixel_acc': round(float(np.trace(cm) / cm.sum()), 4), 'pixels': int(cm.sum()),
            'bigrock_pixels': int(cm[3].sum())}


def boot(cms, n=1000, seed=0):
    rng = np.random.default_rng(seed)
    m4, m3 = [], []
    for _ in range(n):
        cm = cms[rng.integers(0, len(cms), len(cms))].sum(0)
        v = iou(cm); m4.append(np.nanmean(v)); m3.append(np.nanmean(v[:3]))
    q = lambda a: [round(float(np.percentile(a, 2.5)), 4), round(float(np.percentile(a, 97.5)), 4)]
    return {'miou_ci95': q(m4), 'miou_no_bigrock_ci95': q(m3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True); ap.add_argument('--run', required=True)
    ap.add_argument('--size', type=int, default=512); ap.add_argument('--ckpt', default='best.pt')
    a = ap.parse_args()
    cfg = json.load(open(f'{a.run}/config.json'))
    device = 'cuda'
    torch.cuda.set_per_process_memory_fraction(min(1.0, 9.0 * 2**30 / torch.cuda.get_device_properties(0).total_memory))
    model = make_model(cfg['arm'], img_size=a.size).to(device)
    sd = torch.load(f'{a.run}/{a.ckpt}', map_location=device)
    if cfg['arm'] == 'dinov3' and a.size != 512:
        # The position embedding is resampled by timm for other sizes (dynamic img size).
        model.backbone.set_input_size(img_size=512) if hasattr(model.backbone, 'set_input_size') else None
    model.load_state_dict(sd)
    if cfg['arm'] == 'dinov3' and a.size != 512 and hasattr(model.backbone, 'set_input_size'):
        model.backbone.set_input_size(img_size=a.size)
    train_names = set()
    if os.path.exists(f'{a.data}/msl_train_names.txt'):
        train_names = set(open(f'{a.data}/msl_train_names.txt').read().split())
    res = {'run': a.run, 'ckpt': a.ckpt, 'input_size': a.size, 'arm': cfg['arm'], 'config': cfg['config']}
    for m in (1, 2, 3):
        tag = f'msl_test_min{m}'
        img = np.load(f'{a.data}/{tag}_img.npy', mmap_mode='r'); lab = np.load(f'{a.data}/{tag}_lab.npy', mmap_mode='r')
        names = open(f'{a.data}/{tag}_names.txt').read().split()
        overlap = sum(1 for n in names if n.replace('_merged', '') in train_names)
        cms = per_image_cms(model, img, lab, device, a.size)
        r = summary(cms.sum(0)); r.update(boot(cms)); r['images'] = len(img); r['names_also_in_msl_train'] = overlap
        res[tag] = r
        print(tag, json.dumps(r), flush=True)
    out = f'{a.run}/test_{a.size}.json'
    json.dump(res, open(out, 'w'), indent=1)
    print('wrote', out)


if __name__ == '__main__':
    main()

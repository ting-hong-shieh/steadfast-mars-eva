# Written with an AI tool (Claude). See AI_USE.md.
"""Read the AI4Mars v0.6 merged zip and write fixed-size arrays for training and testing.

Reads the zip directly (no extraction). Every image becomes greyscale uint8. Labels keep the
class key of info.md: 0 soil, 1 bedrock, 2 sand, 3 big rock, 255 no label.

Sets written to OUT (numpy .npy, memory-mappable):
  m2020_nav  Perseverance Navcam NAV labels (train pool, both configs)
  mer_train  MER merged-unmasked train labels (train pool, both configs)
  mer_test_min1/2/3  MER expert test sets (validation: not Curiosity)
  msl_train  Curiosity Navcam train labels (config 2 only)
  msl_test_min1/2/3  Curiosity Navcam expert test sets, kept at 1024 px (final test only)
Train and validation sets are resized to SIZE (default 512): images bilinear, labels nearest.

Run:  python -I tools/seg/prep_ai4mars.py <zip> <out dir> [--size 512]
"""
import argparse, io, json, os, re, sys, zipfile
import numpy as np
from PIL import Image

ROOT = 'ai4mars-dataset-merged-0.6/'
IMG_EXT = ('.jpg', '.jpeg', '.png')


def stem(name):
    b = os.path.basename(name)
    return os.path.splitext(b)[0]


def label_key(name):
    # Labels carry suffixes such as _merged, _merged60. Images do not.
    # HAFIQ labels add -1, -2 ... before _rectified when one image was labelled more than once
    # (dataset TODO.md). Each copy is kept as its own training sample.
    k = re.sub(r'_merged\d*$', '', stem(name))
    return re.sub(r'-\d+(?=_rectified$)', '', k).lower()


def load_img(z, name):
    with z.open(name) as f:
        return Image.open(io.BytesIO(f.read())).convert('L')


def load_lab(z, name):
    with z.open(name) as f:
        a = np.array(Image.open(io.BytesIO(f.read())))
    if a.ndim == 3:
        a = a[..., 0]
    return a.astype(np.uint8)


def build(z, pairs, size, out, tag, keep_full=False):
    n = len(pairs)
    s = 1024 if keep_full else size
    imgs = np.lib.format.open_memmap(f'{out}/{tag}_img.npy', mode='w+', dtype=np.uint8, shape=(n, s, s))
    labs = np.lib.format.open_memmap(f'{out}/{tag}_lab.npy', mode='w+', dtype=np.uint8, shape=(n, s, s))
    counts = np.zeros(256, np.int64)
    names = []
    for k, (img_name, lab_name) in enumerate(pairs):
        im, lb = load_img(z, img_name), load_lab(z, lab_name)
        if im.size != (lb.shape[1], lb.shape[0]):
            im = im.resize((lb.shape[1], lb.shape[0]), Image.BILINEAR)
        imgs[k] = np.array(im.resize((s, s), Image.BILINEAR))
        labs[k] = np.array(Image.fromarray(lb).resize((s, s), Image.NEAREST))
        counts += np.bincount(labs[k].ravel(), minlength=256)
        names.append(stem(lab_name))
        if k % 1000 == 0:
            print(tag, k, '/', n, flush=True)
    imgs.flush(); labs.flush()
    with open(f'{out}/{tag}_names.txt', 'w') as f:
        f.write('\n'.join(names) + '\n')
    bad = [v for v in np.nonzero(counts)[0] if v not in (0, 1, 2, 3, 255)]
    return {'n': n, 'size': s, 'pixels': {str(v): int(counts[v]) for v in (0, 1, 2, 3, 255)}, 'unexpected_values': [int(v) for v in bad]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('zip'); ap.add_argument('out'); ap.add_argument('--size', type=int, default=512)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    z = zipfile.ZipFile(a.zip)
    names = [n for n in z.namelist() if not n.endswith('/')]

    def images_in(prefix):
        d = {}
        for n in names:
            if n.startswith(ROOT + prefix) and n.lower().endswith(IMG_EXT):
                d.setdefault(stem(n).lower(), []).append(n)
        return d

    def labels_in(prefix):
        return sorted(n for n in names if n.startswith(ROOT + prefix) and n.lower().endswith('.png'))

    def pair(lab_names, img_index, z):
        pairs, missing, dup = [], [], 0
        for ln in lab_names:
            key = label_key(ln)
            cands = img_index.get(key, [])
            if not cands:
                # Some labels add a suffix after the image name (MER test: _16165_T0; HAFIQ
                # duplicates: -1, -2). Take the longest image name that starts the label name.
                pre = [k for k in img_index if key.startswith(k) and len(key) > len(k) and key[len(k)] in '_-']
                if pre:
                    cands = img_index[max(pre, key=len)]
            if not cands:
                missing.append(ln); continue
            if len(cands) > 1:
                dup += 1
                # Duplicates in M2020 (.jpeg vs .jpg, different sizes): take the one whose size
                # matches the label, else the largest.
                lsz = Image.open(io.BytesIO(z.read(ln))).size
                sizes = [(Image.open(io.BytesIO(z.read(c))).size, c) for c in cands]
                match = [c for s, c in sizes if s == lsz]
                cands = match or [max(sizes, key=lambda t: t[0][0] * t[0][1])[1]]
            pairs.append((cands[0], ln))
        return pairs, missing, dup

    report = {}
    m2020_img = images_in('m2020/images/ncam/'); m2020_img.update({k: m2020_img.get(k, []) + v for k, v in images_in('m2020/images/HAFIQ/').items()})
    mer_img = images_in('mer/images/eff/'); mer_test_img = images_in('mer/images/test/')
    msl_img = images_in('msl/ncam/images/edr/')
    jobs = [
        ('m2020_nav', labels_in('m2020/labels/NAV/'), m2020_img, False),
        ('mer_train', labels_in('mer/labels/train/merged-unmasked/'), mer_img, False),
        ('msl_train', labels_in('msl/ncam/labels/train/'), msl_img, False),
    ]
    for m in (1, 2, 3):
        jobs.append((f'mer_test_min{m}', labels_in(f'mer/labels/test/masked-gold-min{m}-100agree/'), {**mer_test_img, **mer_img}, False))
        jobs.append((f'msl_test_min{m}', labels_in(f'msl/ncam/labels/test/masked-gold-min{m}-100agree/'), msl_img, True))
    for tag, labs, idx, full in jobs:
        pairs, missing, dup = pair(labs, idx, z)
        print(tag, 'labels', len(labs), 'paired', len(pairs), 'missing', len(missing), 'duplicates', dup, flush=True)
        r = build(z, pairs, a.size, a.out, tag, keep_full=full)
        r.update({'labels': len(labs), 'missing_image': len(missing), 'missing_examples': missing[:5], 'duplicate_images': dup})
        report[tag] = r
        json.dump(report, open(f'{a.out}/prep_report.json', 'w'), indent=1)
    print(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()

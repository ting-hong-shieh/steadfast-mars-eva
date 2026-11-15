# Written with an AI tool (Claude). See AI_USE.md.
"""Train a terrain segmentation model on AI4Mars arrays from prep_ai4mars.py.

Arms (model choice from the model survey of 2026-11-14, research/2026-11-14-seg-models):
  dinov3   DINOv3 ViT-B/16 (timm copy) + light head on the last 4 blocks.
           Stage A: backbone frozen. Stage B: full fine-tune, layer-wise learning rate decay.
  deeplab  DeepLabV3+ with a ResNet-101 encoder (ImageNet), the AI4Mars baseline family.

Configs:
  cross    train on Perseverance NAV + MER only. Curiosity is never seen (the strict test).
  all      also train on Curiosity Navcam train labels (the model used in the app).

Checkpoints are chosen on data that is not Curiosity: the MER expert test set (min1) and a
held-out slice of Perseverance sols. The Curiosity test sets are not read here.

Run:  python -I tools/seg/train_seg.py --data <prep dir> --out <run dir> --arm dinov3 --config cross
"""
import argparse, json, math, os, re, time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

NC = 4
CLASSES = ['soil', 'bedrock', 'sand', 'big rock']
MEAN, STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)


class DinoV3Seg(nn.Module):
    """DINOv3 ViT-B/16 (timm copy, not gated) + light head on the last 4 blocks."""

    def __init__(self, name='vit_base_patch16_dinov3.lvd1689m', img_size=512):
        super().__init__()
        import timm
        self.backbone = timm.create_model(name, pretrained=True, num_classes=0, img_size=img_size)
        depth = len(self.backbone.blocks)
        self.indices = list(range(depth - 4, depth))
        cin = self.backbone.num_features * len(self.indices)
        self.head = nn.Sequential(
            nn.Conv2d(cin, 256, 1), nn.BatchNorm2d(256), nn.GELU(),
            nn.Conv2d(256, 256, 3, padding=1), nn.BatchNorm2d(256), nn.GELU(),
            nn.Conv2d(256, NC, 1))

    def forward(self, x):
        feats = self.backbone.forward_intermediates(x, indices=self.indices, intermediates_only=True)
        out = self.head(torch.cat(feats, 1))
        return F.interpolate(out, size=x.shape[-2:], mode='bilinear', align_corners=False)


def make_model(arm, img_size=512):
    if arm == 'dinov3':
        return DinoV3Seg(img_size=img_size)
    import segmentation_models_pytorch as smp
    return smp.DeepLabV3Plus(encoder_name='tu-resnet101', encoder_weights='imagenet', classes=NC)


def prep(grey_u8):
    """uint8 (B, H, W) greyscale -> normalised float (B, 3, H, W)."""
    x = grey_u8.float().div_(255).unsqueeze(1).repeat(1, 3, 1, 1)
    m = torch.tensor(MEAN, device=x.device).view(1, 3, 1, 1)
    s = torch.tensor(STD, device=x.device).view(1, 3, 1, 1)
    return (x - m) / s


def sol_of(name):
    m = re.match(r'(?:NLF|NRF|NLE|NRE)_(\d{4})_', name)
    return int(m.group(1)) if m else None


def load_sets(data, config):
    def arr(tag):
        return (np.load(f'{data}/{tag}_img.npy', mmap_mode='r'), np.load(f'{data}/{tag}_lab.npy', mmap_mode='r'),
                open(f'{data}/{tag}_names.txt').read().split())
    m_img, m_lab, m_names = arr('m2020_nav')
    sols = np.array([sol_of(n) if sol_of(n) is not None else -1 for n in m_names])
    # Hold out the latest Perseverance sols (about 10 % of the NAV labels) for validation.
    known = sols[sols >= 0]
    cut = int(np.quantile(known, 0.9)) if len(known) else 10**9
    val_m = np.nonzero(sols >= cut)[0]
    tr_m = np.nonzero(sols < cut)[0]
    train = [(m_img, m_lab, tr_m)]
    e_img, e_lab, _ = arr('mer_train')
    train.append((e_img, e_lab, np.arange(len(e_img))))
    if config == 'all':
        c_img, c_lab, _ = arr('msl_train')
        train.append((c_img, c_lab, np.arange(len(c_img))))
    v_img, v_lab, _ = arr('mer_test_min1')
    val = {'mer_test_min1': (v_img, v_lab, np.arange(len(v_img))), 'm2020_heldout': (m_img, m_lab, val_m)}
    info = {'m2020_cut_sol': cut, 'm2020_train': int(len(tr_m)), 'm2020_val': int(len(val_m)), 'mer_train': int(len(e_img)),
            'msl_train': int(len(train[2][2])) if config == 'all' else 0}
    return train, val, info


def class_weights(train):
    cnt = np.zeros(NC, np.float64)
    for img, lab, idx in train:
        for k in idx[:: max(1, len(idx) // 800)]:
            cnt += np.bincount(lab[k].ravel(), minlength=256)[:NC]
    comp = cnt / cnt.sum()
    return comp, 1 - comp   # [S01]: weights are 1 - class composition


def batches(train, bs, rng):
    pool = [(s, k) for s, (_, _, idx) in enumerate(train) for k in idx]
    order = rng.permutation(len(pool))
    for b in range(0, len(order) - bs + 1, bs):
        sel = [pool[i] for i in order[b:b + bs]]
        x = np.stack([train[s][0][k] for s, k in sel]); y = np.stack([train[s][1][k] for s, k in sel])
        yield x, y


def augment(x, y, rng):
    """Flip and photometric jitter on the GPU. Cameras differ in exposure and contrast."""
    if rng.random() < 0.5:
        x, y = x.flip(-1), y.flip(-1)
    g = torch.empty(x.shape[0], 1, 1, device=x.device)
    gain = g.uniform_(0.75, 1.3); bias = torch.empty_like(g).uniform_(-20, 20)
    gamma = torch.empty_like(g).uniform_(0.8, 1.25)
    xf = (x.float() / 255).clamp(1e-4, 1) ** gamma * 255 * gain + bias
    return xf.clamp(0, 255), y


@torch.no_grad()
def confusion(model, img, lab, idx, device, bs=8, size=None):
    model.eval()
    cm = torch.zeros(NC, NC, dtype=torch.int64, device=device)
    for b in range(0, len(idx), bs):
        ii = idx[b:b + bs]
        x = torch.from_numpy(np.stack([img[k] for k in ii])).to(device)
        y = torch.from_numpy(np.stack([lab[k] for k in ii])).to(device).long()
        xin = prep(x)
        if size and size != xin.shape[-1]:
            xin = F.interpolate(xin, size=(size, size), mode='bilinear', align_corners=False)
        with torch.autocast('cuda', dtype=torch.bfloat16):
            out = model(xin)
        out = F.interpolate(out.float(), size=y.shape[-2:], mode='bilinear', align_corners=False)
        p = out.argmax(1)
        m = y < NC
        cm += torch.bincount(y[m] * NC + p[m], minlength=NC * NC).view(NC, NC)
    return cm.cpu().numpy()


def iou(cm):
    tp = np.diag(cm).astype(float)
    den = cm.sum(0) + cm.sum(1) - tp
    return np.where(den > 0, tp / np.maximum(den, 1), np.nan)


def param_groups(model, arm, stage, base_lr, head_lr, decay):
    if arm != 'dinov3':
        return [{'params': [p for p in model.parameters() if p.requires_grad], 'lr': base_lr}]
    groups = [{'params': list(model.head.parameters()), 'lr': head_lr}]
    if stage == 'A':
        return groups
    bb = model.backbone
    depth = len(bb.blocks)
    for i, blk in enumerate(bb.blocks):
        groups.append({'params': list(blk.parameters()), 'lr': base_lr * decay ** (depth - 1 - i)})
    seen = {id(p) for g in groups for p in g['params']}
    rest = [p for p in bb.parameters() if id(p) not in seen]
    groups.append({'params': rest, 'lr': base_lr * decay ** depth})
    return groups


def run_stage(model, arm, stage, epochs, bs, lrs, train, val, weights, device, out, log, rng, best):
    for p in model.parameters():
        p.requires_grad = True
    if arm == 'dinov3' and stage == 'A':
        for p in model.backbone.parameters():
            p.requires_grad = False
    groups = param_groups(model, arm, stage, *lrs)
    opt = torch.optim.AdamW(groups, weight_decay=0.05)
    for g in opt.param_groups:
        g['base'] = g['lr']
    steps_per_epoch = sum(len(i) for _, _, i in train) // bs
    total = epochs * steps_per_epoch
    warm = min(300, total // 10)
    crit = nn.CrossEntropyLoss(weight=torch.tensor(weights, dtype=torch.float32, device=device), ignore_index=255)
    step = 0
    for ep in range(epochs):
        model.train()
        if arm == 'dinov3' and stage == 'A':
            model.backbone.eval()
        t0, run_loss, nb = time.time(), 0.0, 0
        for x, y in batches(train, bs, rng):
            f = (step + 1) / warm if step < warm else 0.5 * (1 + math.cos(math.pi * (step - warm) / max(1, total - warm)))
            for g in opt.param_groups:
                g['lr'] = g['base'] * f
            x = torch.from_numpy(x).to(device, non_blocking=True)
            y = torch.from_numpy(y).to(device, non_blocking=True).long()
            xf, y = augment(x, y, rng)
            m = torch.tensor(MEAN, device=device).view(1, 3, 1, 1); s = torch.tensor(STD, device=device).view(1, 3, 1, 1)
            xin = ((xf / 255).unsqueeze(1).repeat(1, 3, 1, 1) - m) / s
            with torch.autocast('cuda', dtype=torch.bfloat16):
                loss = crit(model(xin).float(), y)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_([p for g in opt.param_groups for p in g['params']], 1.0)
            opt.step()
            run_loss += loss.item(); nb += 1; step += 1
        res = {'stage': stage, 'epoch': ep + 1, 'loss': run_loss / max(1, nb), 'sec': round(time.time() - t0)}
        score = []
        for name, (vi, vl, vidx) in val.items():
            cm = confusion(model, vi, vl, vidx, device)
            v = iou(cm)
            res[name] = {'iou': [None if np.isnan(t) else round(float(t), 4) for t in v], 'miou': round(float(np.nanmean(v)), 4),
                         'miou3': round(float(np.nanmean(v[:3])), 4)}
            score.append(np.nanmean(v))
        res['score'] = round(float(np.mean(score)), 4)
        log.write(json.dumps(res) + '\n'); log.flush()
        print(json.dumps(res), flush=True)
        if res['score'] > best['score']:
            best.update(score=res['score'], stage=stage, epoch=ep + 1)
            torch.save(model.state_dict(), f'{out}/best.pt')
    torch.save(model.state_dict(), f'{out}/last_{stage}.pt')
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--arm', choices=['dinov3', 'deeplab'], required=True)
    ap.add_argument('--config', choices=['cross', 'all'], required=True)
    ap.add_argument('--epochs-a', type=int, default=8); ap.add_argument('--epochs-b', type=int, default=12)
    ap.add_argument('--epochs', type=int, default=20, help='deeplab epochs')
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--mem-gib', type=float, default=9.0)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    torch.manual_seed(a.seed); rng = np.random.default_rng(a.seed)
    device = 'cuda'
    # WSL2: without a cap an overflow spills silently into shared memory and runs ~8x slower.
    torch.cuda.set_per_process_memory_fraction(a.mem_gib * 2**30 / torch.cuda.get_device_properties(0).total_memory)
    train, val, info = load_sets(a.data, a.config)
    comp, w = class_weights(train)
    info.update(vars(a)); info['class_composition'] = comp.round(4).tolist(); info['class_weights'] = w.round(4).tolist()
    info['torch'] = torch.__version__
    json.dump(info, open(f'{a.out}/config.json', 'w'), indent=1)
    print(json.dumps(info), flush=True)
    model = make_model(a.arm).to(device)
    log = open(f'{a.out}/log.jsonl', 'a')
    best = {'score': -1}
    if a.arm == 'dinov3':
        best = run_stage(model, a.arm, 'A', a.epochs_a, 16, (0, 1e-3, 1.0), train, val, w, device, a.out, log, rng, best)
        best = run_stage(model, a.arm, 'B', a.epochs_b, 8, (2e-5, 2e-4, 0.8), train, val, w, device, a.out, log, rng, best)
    else:
        best = run_stage(model, a.arm, 'all', a.epochs, 16, (2e-4, 0, 0), train, val, w, device, a.out, log, rng, best)
    json.dump(best, open(f'{a.out}/best.json', 'w'))
    print('best', best, flush=True)


if __name__ == '__main__':
    main()

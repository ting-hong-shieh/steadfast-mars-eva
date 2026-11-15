#!/usr/bin/env python3
"""Dose rates of MSL RAD, one row per reading, without downloading the daily files.

Written by a dispatched AI worker (Claude) on 2026-11-15 and kept as it ran (see AI_USE.md).
Source: PDS PPI node, data set MSL-M-RAD-3-RDR-V1.0 (S15 in SOURCES.md).

A daily RAD file is 8 to 100 MB. Its detached PDS label (.LBL) gives the byte offset of every
object in it (^OBSnnn_TOT_DOSE_B_ELEMENT and so on, 1-based <BYTES>). This script downloads the
label and then asks for byte ranges only: about 1,000 bytes before the first object of each label
entry (they hold the [OBSERVATION: nn] header with START_OBS_UTC and OBS_DURATION), and the two
7-byte values TOT_DOSE_B and TOT_DOSE_E (microgray per hour, detectors B and E). It applies no
correction. The answers of the server are kept under OUTDIR/raw, so a second run asks for nothing.

Every second entry of a label is a pulse-height table with no dose values. Its row is written with
empty fields, and tools/spe_mars_case.py skips it.

Usage: python3 -I tools/rad_dose_extract.py OUTDIR /DATA/SOL_04134_04257/RAD_RDR_2024_140_18_30_4190_V00.LBL [...]
The path of a label is the one in INDEX.TAB of the data set. Rows are appended to
OUTDIR/rad_dose_per_observation.csv with the columns
file, obs, START_OBS_UTC, START_OBS_MARS, OBS_DURATION_s, TOT_DOSE_B_uGy_per_h, TOT_DOSE_E_uGy_per_h.
"""
import sys, os, re, hashlib, urllib.request

BASE = 'https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0'
HDR = 1000

def get(url, ranges=None):
    req = urllib.request.Request(url)
    if ranges:
        req.add_header('Range', 'bytes=' + ','.join(f'{a}-{b}' for a, b in ranges))
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.headers.get('Content-Type', ''), r.read()

def parse_multipart(ctype, body):
    m = re.search(r'boundary=([^;]+)', ctype)
    if not m:
        return None
    out = {}
    for part in body.split(b'--' + m.group(1).strip().encode()):
        hm = re.search(rb'(?i)Content-Range: bytes (\d+)-(\d+)/\d+\r\n\r\n', part)
        if hm:
            s, e = int(hm.group(1)), int(hm.group(2))
            data = part[hm.end():hm.end() + (e - s + 1)]
            out[s] = data
    return out

def fetch_ranges(url, ranges, rawdir, tag):
    res = {}
    for i in range(0, len(ranges), 60):
        chunk = ranges[i:i + 60]
        fn = os.path.join(rawdir, f'{tag}_ranges_{i // 60:02d}.bin')
        if os.path.exists(fn):
            body = open(fn, 'rb').read()
            m = re.match(rb'\s*--(\S+)', body)
            ctype = 'boundary=' + m.group(1).decode() if m else ''
        else:
            ctype, body = get(url, chunk)
            open(fn, 'wb').write(body)
        mp = parse_multipart(ctype, body)
        if mp is None:  # single range answer
            mp = {chunk[0][0]: body}
        res.update(mp)
    return res

def main():
    outdir = sys.argv[1]
    os.makedirs(outdir, exist_ok=True)
    rawdir = os.path.join(outdir, 'raw')
    os.makedirs(rawdir, exist_ok=True)
    csv = open(os.path.join(outdir, 'rad_dose_per_observation.csv'), 'a')
    if csv.tell() == 0:
        csv.write('file,obs,START_OBS_UTC,START_OBS_MARS,OBS_DURATION_s,TOT_DOSE_B_uGy_per_h,TOT_DOSE_E_uGy_per_h\n')
    for path in sys.argv[2:]:
        base = os.path.basename(path)[:-4]
        lblfn = os.path.join(rawdir, base + '.LBL')
        if not os.path.exists(lblfn):
            open(lblfn, 'wb').write(get(BASE + path)[1])
        lbl = open(lblfn, encoding='latin-1').read()
        ptr = re.findall(r'\^OBS(\d+)_(\w+?)\s*=\s*\(\s*"([^"]+)"\s*,\s*(\d+)\s*<BYTES>\)', lbl)
        obs = {}
        txt = None
        for n, name, f, off in ptr:
            txt = f
            d = obs.setdefault(n, {})
            off = int(off)
            d['first'] = min(d.get('first', off), off)
            if name == 'TOT_DOSE_B_ELEMENT': d['B'] = off
            if name == 'TOT_DOSE_E_ELEMENT': d['E'] = off
        url = BASE + os.path.dirname(path) + '/' + txt
        ranges = []
        for n, d in obs.items():
            ranges.append((max(0, d['first'] - 1 - HDR), d['first'] - 2))
            for k in ('B', 'E'):
                if k in d: ranges.append((d[k] - 1, d[k] - 1 + 6))
        ranges = sorted(set(ranges))
        got = fetch_ranges(url, ranges, rawdir, base)
        for n in sorted(obs, key=int):
            d = obs[n]
            h = got.get(max(0, d['first'] - 1 - HDR), b'').decode('latin-1')
            blk = h[h.rfind('[OBSERVATION:'):] if '[OBSERVATION:' in h else ''
            def kv(k):
                m = re.search(k + r'=("?)([^"\r\n]*)\1', blk)
                return m.group(2) if m else ''
            vals = [got.get(d[k] - 1, b'').decode('latin-1').strip() if k in d else '' for k in ('B', 'E')]
            csv.write(f'{txt},{n},{kv("START_OBS_UTC")},{kv("START_OBS_MARS")},{kv("OBS_DURATION")},{vals[0]},{vals[1]}\n')
        csv.flush()
        print(base, len(obs), 'observations', flush=True)

main()

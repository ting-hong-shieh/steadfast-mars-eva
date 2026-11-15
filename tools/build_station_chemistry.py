# Written with an AI tool (Claude). See AI_USE.md.
"""Chemistry at the three stations: what Curiosity's APXS and ChemCam measured at each stop.

Reads five tables of the NASA Planetary Data System (Geosciences Node) and writes
app/public/data/station_chemistry.json for the card that opens at a station.

A measurement belongs to a station when the rover stood at the same position: the site and drive
counters of the rover are those of the station in app/public/data/stations.json.
  - APXS: site and drive are in the name of the source file (APXS RDR SIS v1.1, section 2.3:
    "<instr><config><sclk><product><sol><site><drive>_<producer><version>").
  - ChemCam: site and drive are columns of the observation table ("RMC Site", "RMC Drive").
    The script also reads them from the product name and stops if the two differ.

What the file keeps:
  - APXS, one row per target: the oxide weight percents and the error the table gives.
  - ChemCam, one row per target: the laser points of the target (5 at these stops). For each oxide
    the middle point (the median) and the lowest and highest point. With 5 points the median is one
    of the measured values. The table's accuracy of a point (RMSEP) is kept as a range.
  - "columns": the oxides the card shows. The rule: every oxide that is above 5 weight percent in at
    least one APXS row at the stations, largest first. MnO is never shown: the APXS release notes
    (release 42) say that low MnO values are too low from about sol 4400 on.

Nothing here is an interpretation of the rocks. The numbers are copied, the median is picked.

Get the tables (2026-11-15, sizes and sha256 below):
  B=https://pds-geosciences.wustl.edu/msl
  curl -O $B/msl-m-apxs-4_5-rdr-v1/mslapx_1xxx/extras/msl_apxs_concentrations_4613_4709.csv
  curl -O $B/msl-m-apxs-4_5-rdr-v1/mslapx_1xxx/extras/msl_apxs_concentrations_4710_4843.csv
  curl -O $B/msl-m-chemcam-libs-4_5-rdr-v1/mslccm_1xxx/data/moc/moc_4613_4709.csv
  curl -O $B/msl-m-chemcam-libs-4_5-rdr-v1/mslccm_1xxx/data/moc/moc_4710_4843.csv
  curl -O $B/msl-m-chemcam-libs-4_5-rdr-v1/mslccm_1xxx/document/msl_ccam_obs.csv

Run:  python3 -I tools/build_station_chemistry.py <folder with the five tables> app/public/data
"""
import csv
import hashlib
import json
import pathlib
import re
import statistics
import sys

BASE = "https://pds-geosciences.wustl.edu/msl/"
APXS = "msl-m-apxs-4_5-rdr-v1/mslapx_1xxx/extras/"
CCAM = "msl-m-chemcam-libs-4_5-rdr-v1/mslccm_1xxx/"
INPUTS = {   # name: (path in the archive, bytes, sha256)
    "msl_apxs_concentrations_4613_4709.csv": (APXS, 16007, "c0ebd3c2a832162a8d661c3543d1107edd926fe02e584c1bcb3a874876eb9e1f"),
    "msl_apxs_concentrations_4710_4843.csv": (APXS, 12110, "c0d42310c9599a174d79916742054f3b5c72a0622a0e9aaba5a21efb540a221e"),
    "moc_4613_4709.csv": (CCAM + "data/moc/", 101261, "b9c102f63edeb6d4af966e72404d5e553ef091273f17920730c9d7a09d5e9a35"),
    "moc_4710_4843.csv": (CCAM + "data/moc/", 77157, "ec059ff3d429a25ae8e391ed8ae261281a46d9efdb5b64d86cf0a6cf5ea31bde"),
    "msl_ccam_obs.csv": (CCAM + "document/", 26294662, "650df2f29dae0297e8de207645f8196fc8875fcec02140cbfd8472b00ba99545"),
}
APXS_OXIDES = ["Na2O", "MgO", "Al2O3", "SiO2", "P2O5", "SO3", "Cl", "K2O", "CaO", "TiO2", "Cr2O3", "MnO", "FeO"]
CCAM_OXIDES = ["SiO2", "TiO2", "Al2O3", "FeOT", "MgO", "CaO", "Na2O", "K2O", "MnO"]
SAME = {"FeOT": "FeO"}        # ChemCam's name for all iron as FeO -> the name the card uses
SHOW_ABOVE = 5.0              # weight percent, see "columns" above
NEVER = {"MnO"}


def num(s):
    v = float(s)
    return int(v) if v == int(v) and "." not in s else v


def main(src, out):
    src, out = pathlib.Path(src), pathlib.Path(out)
    inputs = []
    for name, (path, size, sha) in INPUTS.items():
        raw = (src / name).read_bytes()
        got = hashlib.sha256(raw).hexdigest()
        assert len(raw) == size and got == sha, f"{name}: {len(raw)} bytes, sha256 {got}. Not the file this script was written for."
        inputs.append({"file": name, "url": BASE + path + name, "bytes": size, "sha256": sha})
    stations = json.loads((out / "stations.json").read_text(encoding="utf-8"))["stations"]
    where = {(s["site"], s["drive"]): s["id"] for s in stations}

    # ---- APXS: one row per target.
    apxs = {sid: [] for sid in where.values()}
    for name in list(INPUTS)[:2]:
        with open(src / name, newline="", encoding="ascii") as f:
            rows = list(csv.reader(f))
        head, body = rows[0], rows[1:]
        if len(head) == 40:               # the table of sols 4613 to 4709 has no heading over its last field
            head = head + ["data_products"]
        assert len(head) == 41 and head[:4] == ["sol", "target", "fit_type", "start_time"], head
        ix = {h: i for i, h in enumerate(head)}
        for r in body:
            assert len(r) == 41, (name, r[:2])
            keys = set()
            for e in r[40].split(":"):
                m = re.fullmatch(r"APB_(\d{9})ESC(\d{4})(\d{3})(\d{4})_______M(\d)\.DAT", e)
                assert m, e
                keys.add((int(m.group(3)), int(m.group(4))))
            assert len(keys) == 1, (r[:2], keys)
            sid = where.get(next(iter(keys)))
            if not sid:
                continue
            apxs[sid].append({
                "target": r[ix["target"]], "sol": int(r[ix["sol"]]), "start_lmst": r[ix["start_time"]],
                "lifetime": r[ix["lifetime"]], "norm": num(r[ix["gnorm"]]), "fe_fwhm_ev": num(r[ix["Fe_FWHM"]]),
                "fit": r[ix["fit_type"]],
                "wt": {o: [num(r[ix[o]]), num(r[ix[o + "_err"]])] for o in APXS_OXIDES},
                "ppm": {o: [num(r[ix[o]]), num(r[ix[o + "_err"]])] for o in ("Ni", "Zn", "Br")},
                "source_files": r[40].split(":"), "table": name,
            })

    # ---- ChemCam: the observation table gives sol, position, target type and distance of each point.
    obs = {}
    with open(src / "msl_ccam_obs.csv", newline="", encoding="latin-1") as f:
        rd = csv.reader(f)
        ox = {h.strip(): i for i, h in enumerate(next(rd))}
        for r in rd:
            if len(r) < 34 or not r[ox["EDR Filename"]].startswith("CL5_"):
                continue
            key = (int(r[ox["RMC Site"]]), int(r[ox["RMC Drive"]]))
            if key in where:
                obs[r[ox["EDR Filename"]][4:13]] = (key, int(r[ox["Sol"]]), r[ox["Target"]].strip(), r[ox["Target Type"]].strip(),
                                                    float(r[ox["Distance (m)"]]), int(r[ox["Nbr of Shots"]]))
    points = {}
    for name in list(INPUTS)[2:4]:
        with open(src / name, newline="", encoding="latin-1") as f:
            rows = list(csv.reader(f))
        hi = next(i for i, r in enumerate(rows) if r and r[0] == "File")
        head = rows[hi]
        assert head[2:6] == ["SiO2", "+/-", "SiO2 RMSEP", "SiO2_shots_stdev"], head[:6]
        quart = {rows[i][1]: rows[i] for i in range(1, 6)}      # Min, 1st, Med, 3rd, Max of the test set
        col = {o: head.index(o) for o in CCAM_OXIDES}
        for r in rows[hi + 1:]:
            if not r or not r[0].strip():
                continue
            m = re.fullmatch(r"CL5_(\d{9})CCS_F(\d{3})(\d{4})CCAM(\d{5})P(\d)\.CSV", r[0].strip())
            assert m, r[0]
            key = (int(m.group(2)), int(m.group(3)))
            if key not in where:
                continue
            o = obs.get(m.group(1))
            assert o and o[0] == key and o[2] == r[1].strip(), (r[0], r[1], o)
            p = {"file": r[0].strip(), "table": name, "sum": float(r[head.index("Sum of Oxides")])}
            for ox_name, c in col.items():
                v, rmsep = float(r[c]), float(r[c + 2])
                lo, hi_ = float(quart["Min"][c]), float(quart["Max"][c])
                p[ox_name] = (v, rmsep, lo <= v <= hi_)
            points.setdefault((where[key], o[1], o[2], o[3]), []).append((p, o[4], o[5]))
    ccam = {sid: [] for sid in where.values()}
    for (sid, sol, target, ttype), pts in sorted(points.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2])):
        row = {"target": target, "sol": sol, "type": ttype, "points": len(pts), "shots_per_point": sorted({s for _, _, s in pts}),
               "distance_m": [round(min(d for _, d, _ in pts), 2), round(max(d for _, d, _ in pts), 2)],
               "sum_of_oxides": [min(p["sum"] for p, _, _ in pts), max(p["sum"] for p, _, _ in pts)],
               "wt": {}, "outside_test_set": {}, "source_files": [p["file"] for p, _, _ in pts], "table": pts[0][0]["table"]}
        for o in CCAM_OXIDES:
            vals = [p[o][0] for p, _, _ in pts]
            row["wt"][SAME.get(o, o)] = {"median": statistics.median(vals), "min": min(vals), "max": max(vals),
                                         "rmsep": [min(p[o][1] for p, _, _ in pts), max(p[o][1] for p, _, _ in pts)]}
            bad = sum(1 for p, _, _ in pts if not p[o][2])
            if bad:
                row["outside_test_set"][SAME.get(o, o)] = bad
        ccam[sid].append(row)

    # ---- The oxides the card shows.
    top = {}
    for rows in apxs.values():
        for a in rows:
            for o, (v, _) in a["wt"].items():
                top[o] = max(top.get(o, 0), v)
    columns = [o for o in sorted(top, key=lambda o: -top[o]) if top[o] > SHOW_ABOVE and o not in NEVER]

    doc = {
        "source": "NASA Planetary Data System, Geosciences Node: MSL APXS RDR (MSL-M-APXS-4/5-RDR-V1.0, concentration tables) "
                  "and MSL ChemCam LIBS RDR (MSL-M-CHEMCAM-LIBS-4/5-RDR-V1.0, MOC tables and observation table)",
        # The words each archive asks to be cited with (CITATION_DESC of its data set catalog file).
        "cite": [
            "Gellert, R., Mars Science Laboratory Alpha Particle X-Ray Spectrometer RDR Data V1.0, MSL-M-APXS-4/5-RDR-V1.0, NASA Planetary Data System, 2013.",
            "Wiens, R., MSL ChemCam Laser Induced Breakdown Spectrometer derived data, MSL-M-CHEMCAM-LIBS-5-RDR-V1.0, NASA Planetary Data System, 2013.",
        ],
        "unit": "weight percent (APXS trace elements in ppm)",
        "columns": columns,
        "columns_rule": f"oxides above {SHOW_ABOVE:g} weight percent in at least one APXS row at the stations, largest first. MnO never",
        "inputs": inputs,
        "stations": [{"id": s["id"], "site": s["site"], "drive": s["drive"],
                      "sols": sorted({a["sol"] for a in apxs[s["id"]]} | {c["sol"] for c in ccam[s["id"]]}),
                      "apxs": sorted(apxs[s["id"]], key=lambda a: a["start_lmst"]), "chemcam": ccam[s["id"]]} for s in stations],
    }
    (out / "station_chemistry.json").write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")

    # ---- What a person should look at.
    print("columns:", columns, {o: top[o] for o in columns})
    for st in doc["stations"]:
        print(f"\n{st['id']} site {st['site']} drive {st['drive']} sols {st['sols']}")
        for a in st["apxs"]:
            print(f"  APXS    sol {a['sol']} {a['target']:20s} " + " ".join(f"{o} {a['wt'][o][0]:5.1f}±{a['wt'][o][1]:.2f}" for o in columns)
                  + f"  | {a['lifetime']} norm {a['norm']} FWHM {a['fe_fwhm_ev']} eV")
        for c in st["chemcam"]:
            print(f"  ChemCam sol {c['sol']} {c['target']:20s} " + " ".join(
                f"{o} {c['wt'][o]['median']:5.1f} ({c['wt'][o]['min']:.1f}-{c['wt'][o]['max']:.1f})" for o in columns if o in c["wt"])
                + f"  | {c['type']}, {c['points']} points, {c['distance_m']} m, sum {c['sum_of_oxides']}, outside {c['outside_test_set']}")
    spread = max(c["wt"][o]["max"] - c["wt"][o]["min"] for st in doc["stations"] for c in st["chemcam"] for o in columns if o in c["wt"])
    rm = [r for st in doc["stations"] for c in st["chemcam"] for o in columns if o in c["wt"] for r in c["wt"][o]["rmsep"]]
    er = [a["wt"][o][1] for st in doc["stations"] for a in st["apxs"] for o in columns]
    ds = [d for st in doc["stations"] for c in st["chemcam"] for d in c["distance_m"]]
    sm = [s for st in doc["stations"] for c in st["chemcam"] for s in c["sum_of_oxides"]]
    print(f"\nChemCam: largest spread of the points of one target, shown oxides: {spread:.1f} wt%")
    print(f"ChemCam: RMSEP of a point, shown oxides: {min(rm)} to {max(rm)} wt%. Distance {min(ds)} to {max(ds)} m. Sum of oxides {min(sm)} to {max(sm)}")
    print(f"APXS: error of the shown oxides: {min(er)} to {max(er)} wt%")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

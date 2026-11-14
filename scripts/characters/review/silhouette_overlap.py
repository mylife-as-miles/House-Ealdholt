#!/usr/bin/env python3
"""Silhouette clone-risk measure for the crowd population (original Crownfall code, art fixer 8 November).

    python3 scripts/characters/review/silhouette_overlap.py PLAN.json SILHOUETTES.png POPULATION.json OUT.json \
        [--kit-median 0.8] [--pair-max 0.9]

PLAN.json and SILHOUETTES.png come from `population-evidence-plan.ts ... --set silhouettes` and render-population.mjs
(white unlit figures with their worn props on black, the idle pose at t = 0, one front and one isometric tile per crowd
resident). POPULATION.json lists {id, householdId, kit, roleId} per resident. Every pair of residents inside one
household, one outfit kit and one role is compared by the intersection over union of their masks (the larger of the
front and isometric values counts). Writes OUT.json and exits 1 when the same-kit median exceeds --kit-median or a
household or same-role pair exceeds --pair-max (crowd_publish.py --silhouettes reads OUT.json as a publish gate).
Requires numpy and Pillow. Evidence stays outside the repository.
"""
import argparse
import itertools
import json
import sys

import numpy as np
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("plan"); ap.add_argument("sheet"); ap.add_argument("population"); ap.add_argument("out")
    ap.add_argument("--kit-median", type=float, default=0.8)
    ap.add_argument("--pair-max", type=float, default=0.9)
    a = ap.parse_args()
    plan = json.load(open(a.plan))
    pop = json.load(open(a.population))
    ids = plan["silhouettes"]
    tw, th, cols = 160, 240, 16
    im = np.asarray(Image.open(a.sheet).convert("L")) > 127
    rows = (len(ids) * 2 + cols - 1) // cols
    top = im.shape[0] - rows * th  # the sheet's title bar
    masks = {}
    for k, rid in enumerate(ids):
        masks[rid] = []
        for v in range(2):
            i = 2 * k + v
            x, y = (i % cols) * tw, top + (i // cols) * th
            masks[rid].append(im[y:y + th, x:x + tw])

    def iou(p, q):
        return float((p & q).sum()) / max(1.0, float((p | q).sum()))
    groups = {}
    for r in pop:
        if r["id"] in masks:
            for kind, key in (("household", r["householdId"]), ("kit", r["kit"]), ("role", r["roleId"])):
                groups.setdefault((kind, key), []).append(r["id"])
    pairs = []
    for (kind, g), members in groups.items():
        for p, q in itertools.combinations(members, 2):
            f, i3 = iou(masks[p][0], masks[q][0]), iou(masks[p][1], masks[q][1])
            pairs.append({"kind": kind, "group": g, "a": p, "b": q, "front": round(f, 3), "iso": round(i3, 3), "max": round(max(f, i3), 3)})
    res = {"method": "IoU of white-on-black masks, idle t=0, front and isometric (30 deg azimuth, 54 deg elevation); max of the two",
           "residents": len(masks), "thresholds": {"kitMedian": a.kit_median, "pairMax": a.pair_max}}
    for kind in ("household", "kit", "role"):
        v = [p["max"] for p in pairs if p["kind"] == kind]
        res[kind] = {"pairs": len(v), "median": round(float(np.median(v)), 3) if v else None, "max": max(v) if v else None,
                     "over0.9": sum(x > 0.9 for x in v), "over0.85": sum(x > 0.85 for x in v)}
    res["flagged"] = [p for p in pairs if (p["kind"] in ("household", "role") and p["max"] > a.pair_max)]
    res["kitOver0.9"] = [p for p in pairs if p["kind"] == "kit" and p["max"] > 0.9]
    res["pass"] = (res["kit"]["median"] is not None and res["kit"]["median"] <= a.kit_median and not res["flagged"])
    json.dump(res, open(a.out, "w"), indent=1)
    print(json.dumps({k: res[k] for k in ("household", "kit", "role", "pass")}, indent=1))
    for p in res["flagged"]:
        print("flagged", p["kind"], p["group"], p["a"], p["b"], p["max"])
    sys.exit(0 if res["pass"] else 1)


if __name__ == "__main__":
    main()

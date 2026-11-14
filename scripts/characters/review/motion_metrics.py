"""Motion metrics for one member from the review harness (three.js skinning of the exported LOD0 GLB).

    python3 scripts/characters/review/motion_metrics.py EVIDENCE/summary-plan-stills.json BUILD/report.json OUT.json
"""
import json, math, sys
summ = json.load(open(sys.argv[1])); rep = json.load(open(sys.argv[2])); out = sys.argv[3]
m = summ["measurements"]; motion = rep["motion"]
walk = m["walk"]; v = motion["walk"]["speedMetresPerSecond"]; ts = walk["times"]
contacts = motion["walk"]["contactFrames"]
res = {"walk": {"cycleSeconds": round(motion["walk"]["seconds"], 3), "strideMetres": motion["walk"]["strideMetres"], "speedMetresPerSecond": v,
                "sourceSeamDegrees": motion["walk"].get("sourceSeamDegrees"), "source": motion["walk"]["source"]}}
n = len(ts)
for side, bone in (("l", "foot_l"), ("r", "foot_r")):
    pts = [(p[0], p[1], p[2] + v * t) for p, t in zip(walk["bones"][bone], ts)]
    frames = sorted(f for f in contacts[side] if f < n)
    runs, cur = [], []
    for f in frames:
        if cur and f != cur[-1] + 1:
            runs.append(cur); cur = []
        cur.append(f)
    if cur: runs.append(cur)
    if len(runs) > 1 and runs[0][0] == 0 and runs[-1][-1] >= n - 2:  # wrap-around contact
        runs = [runs[-1] + runs[0]] + runs[1:-1]
    slides = []
    for run in runs:
        xs = [pts[f] for f in run]
        # positions across the wrap belong to consecutive cycles: shift by one stride
        dx = max(math.dist((a[0], a[2]), (b[0], b[2])) for a in xs for b in xs) if run == sorted(run) else None
        if dx is None:
            fixed = [(p[0], p[1], p[2] + (v * ts[-1] if f < run[0] else 0.0)) for f, p in zip(run, xs)]
            dx = max(math.dist((a[0], a[2]), (b[0], b[2])) for a in fixed for b in fixed)
        slides.append(round(dx * 100, 2))
    heights = [pts[f][1] for f in frames]
    res["walk"][side] = {"contactShare": round(len(frames) / (n - 1), 3), "contactRuns": [[r[0], r[-1]] for r in runs], "maxSlideCm": slides,
                         "ankleHeightDuringContactCm": [round(min(heights) * 100, 2), round(max(heights) * 100, 2)] if heights else None}
res["walk"]["seamFootDeltaCm"] = {b: round(math.dist(walk["bones"][b][0], walk["bones"][b][-1]) * 100, 3) for b in ("foot_l", "foot_r", "hips")}
wk = m["work"]
res["work"] = {"clip": summ.get("workClip"), "feetMaxDriftCm": {b: round(max(math.dist(wk["bones"][b][0], p) for p in wk["bones"][b]) * 100, 3) for b in ("foot_l", "foot_r")},
               "seamDeltaCm": {b: round(math.dist(wk["bones"][b][0], wk["bones"][b][-1]) * 100, 3) for b in ("hand_r", "hand_l", "hips")},
               "handHeightRangeCm": {b: [round(min(p[1] for p in wk["bones"][b]) * 100, 1), round(max(p[1] for p in wk["bones"][b]) * 100, 1)] for b in ("hand_r", "hand_l")}}
idle = m["idle"]
res["idle"] = {"feetMaxDriftCm": {b: round(max(math.dist(idle["bones"][b][0], p) for p in idle["bones"][b]) * 100, 3) for b in ("foot_l", "foot_r")},
               "seamDeltaCm": {b: round(math.dist(idle["bones"][b][0], idle["bones"][b][-1]) * 100, 3) for b in ("foot_l", "foot_r", "hips")}}
res["note"] = "Positions from three.js skinning of the exported LOD0 GLB in the review harness; walk adds root motion v*t along +Z. Contact frames are the pipeline's detected planted frames."
json.dump(res, open(out, "w"), indent=1)
print(json.dumps(res)[:1500])

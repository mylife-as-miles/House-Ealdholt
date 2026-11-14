"""Per-clip layer penetration check for a built resident (desktop LOD0).

    PYTHON_WITH_BPY -I scripts/characters/review/penetration_check.py BUILD_DIR [--margin 0.003] [--step 2] [--out FILE]

At rest, every skin vertex and every outward-facing garment vertex that lies under another garment piece (a ray
along its normal meets that piece within 8 cm) is paired with that cover; pairs whose inner side is a hand (gloves,
mitts, skin weighted to the hands) are reported separately, since a hand meets a skirt from beside. Then each clip is sampled every `step` frames with the
armature deforming both meshes, and a paired vertex counts as out when its cover is no longer in front of it by at
least `margin`. It counts as through when the ray outward misses the cover and a ray inward meets it within a few
centimetres (the vertex came out through the cover), and as tight when the cover is nearer than the margin. Writes
JSON with, per clip and per (inner, cover) pair, the worst frame, its through count, the deepest excursion and the
largest tight count. Original Crownfall review code; reads the build's 08-export.blend only.
"""
import argparse
import json
import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def evaluated(obj, depsgraph):
    ev = obj.evaluated_get(depsgraph)
    me = ev.to_mesh()
    co = np.array([v.co[:] for v in me.vertices])
    no = np.array([v.normal[:] for v in me.vertices])
    tris = [t.vertices[:] for t in me.loop_triangles] if me.loop_triangles else None
    if tris is None:
        me.calc_loop_triangles()
        tris = [t.vertices[:] for t in me.loop_triangles]
    tri_poly = [t.polygon_index for t in me.loop_triangles]
    ev.to_mesh_clear()
    return co, no, tris, tri_poly


def _hand_sets(body, clothes, poly_piece, label, ctris, ctri_poly):
    """Vertex indices of each hand: skin whose strongest bone is a hand or finger bone of that side, and the mitt or
    glove vertices of that side (x > 0 is the character's left)."""
    hand_words = ("hand", "thumb", "index", "middle", "ring", "pinky")
    names = {g.index: g.name for g in body.vertex_groups}
    left, right = [], []
    for v in body.data.vertices:
        if not v.groups:
            continue
        top = names[max(v.groups, key=lambda g: g.weight).group]
        if any(top.startswith(w) for w in hand_words):
            (left if top.endswith("_l") else right).append(v.index)
    cl, cr = set(), set()
    for t, pi in zip(ctris, ctri_poly):
        if any(w in label(int(poly_piece[pi])).lower() for w in ("glove", "mitt")):
            for v in t:
                (cl if clothes.data.vertices[v].co.x > 0 else cr).add(v)
    return (np.array(left, dtype=np.int64), np.array(sorted(cl), dtype=np.int64)), \
           (np.array(right, dtype=np.int64), np.array(sorted(cr), dtype=np.int64))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("build")
    ap.add_argument("--margin", type=float, default=0.003)
    ap.add_argument("--step", type=int, default=2)
    ap.add_argument("--reach", type=float, default=0.08)
    ap.add_argument("--back-reach", dest="back_reach", type=float, default=0.025)
    ap.add_argument("--out", default=None)
    ap.add_argument("--outer", default="Cloak,HoodCape,Shawl,Capelet,Overdress,Tunic",
                    help="garment pieces the posed-hand test checks the hands against (round 2)")
    ap.add_argument("--stick-clips", dest="stick_clips", default="idle,walk,walk_start,walk_stop,talk,sit,sit_down,stand_up",
                    help="clips in which a held stick (prop_stick, hand_l) is tested against the posed garments (round 2)")
    ap.add_argument("--stick-limit", dest="stick_limit", type=float, default=0.05,
                    help="largest shaft length inside cloth allowed in any frame (metres)")
    args = ap.parse_args(argv)
    bpy.ops.wm.open_mainfile(filepath=os.path.join(args.build, "work", "08-export.blend"))
    arm = bpy.data.objects["Rig"]
    body, clothes = bpy.data.objects["Body"], bpy.data.objects["Clothes"]
    names = list(clothes.get("garment_names", []))
    attr = clothes.data.attributes.get("garment_piece")
    poly_piece = np.zeros(len(clothes.data.polygons), dtype=np.int32)
    if attr is not None:
        attr.data.foreach_get("value", poly_piece)
    label = lambda i: names[i] if 0 <= i < len(names) else f"piece{i}"
    ad = arm.animation_data
    for tr in ad.nla_tracks:
        tr.mute = True
    ad.action = None
    scene = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    # rest pairing: no action, and every pose bone back to identity (a saved file keeps the last evaluated pose)
    for pb in arm.pose.bones:
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.rotation_euler = (0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)
    scene.frame_set(0)
    dg.update()
    bco, bno, _bt, _bp = evaluated(body, dg)
    cco, cno, ctris, ctri_poly = evaluated(clothes, dg)
    tree = BVHTree.FromPolygons([tuple(c) for c in cco], ctris, all_triangles=True)
    vert_piece = np.full(len(cco), -1, dtype=np.int32)
    for t, pidx in zip(ctris, ctri_poly):
        for v in t:
            vert_piece[v] = poly_piece[pidx]
    # Hands are beside the skirts, not under them: their pairs are reported apart from the layer pairs.
    hand_words = ("hand", "finger", "thumb", "index", "middle", "ring", "pinky", "palm")
    group_is_hand = {g.index: any(w in g.name.lower() for w in hand_words) for g in body.vertex_groups}
    body_hand = np.zeros(len(bco), dtype=bool)
    for v in body.data.vertices:
        if v.groups:
            top = max(v.groups, key=lambda g: g.weight)
            body_hand[v.index] = group_is_hand.get(top.group, False)
    piece_is_hand = lambda i: any(w in label(i).lower() for w in ("glove", "mitt"))
    body_tree = BVHTree.FromPolygons([tuple(c) for c in bco], _bt, all_triangles=True)
    rest = {"body": bco.copy(), "cloth": cco.copy()}
    pairs = []  # (source 'body'|'cloth', vertex index, own piece, cover piece, hand pair)
    skipped_inward = 0
    for src, co, no in (("body", bco, bno), ("cloth", cco, cno)):
        for i in range(len(co)):
            p, n = Vector(co[i]), Vector(no[i])
            own = -2 if src == "body" else vert_piece[i]
            if src == "cloth":
                # the inner face of a garment shell faces the body: it is not under the next layer out
                near = body_tree.find_nearest(p)
                if near[0] is not None and near[1].dot(n) < 0.0:
                    skipped_inward += 1
                    continue
            hit = tree.ray_cast(p + n * 0.0005, n, args.reach)
            if hit[0] is None:
                continue
            cover = int(poly_piece[ctri_poly[hit[2]]])
            if cover == own:
                continue
            hand = bool(body_hand[i]) if src == "body" else piece_is_hand(own)
            pairs.append((src, i, own, cover, hand))
    hand_l, hand_r = _hand_sets(body, clothes, poly_piece, label, ctris, ctri_poly)
    outer_ids = [i for i, n in enumerate(names) if n in set(args.outer.split(","))]
    stick = bpy.data.objects.get("prop_stick")
    stick_grip = None
    if stick is not None and "grip_matrix" in stick:
        from mathutils import Matrix
        gm = list(stick["grip_matrix"])
        stick_grip = Matrix([gm[0:4], gm[4:8], gm[8:12], gm[12:16]])
        stick_len = -min(v.co.z for v in stick.data.vertices)
    stick_clips = set(c for c in args.stick_clips.split(",") if c)
    cloth_ids = [i for i, n in enumerate(names) if not any(w in n.lower() for w in ("glove", "mitt"))]
    report = {"build": os.path.basename(os.path.normpath(args.build)), "marginMetres": args.margin, "step": args.step,
              "backReachMetres": args.back_reach,
              "note": "maxThroughMm is capped at backReach + margin; hand pairs (gloves, mitts and skin weighted to "
                      "the hands) are listed under handClips because a swinging hand meets a skirt from beside, not "
                      "from under it; inner shell faces (normal facing the body) are not paired",
              "pairedVertices": len(pairs), "handPairedVertices": sum(1 for q in pairs if q[4]),
              "innerFacesSkipped": skipped_inward, "clips": {}, "handClips": {},
              "posedHands": {"note": "per frame, each hand's skin and mitt or glove vertices are tested against the posed outer "
                                     "garments (" + ", ".join(label(i) for i in outer_ids) + "): a vertex is inside a "
                                     "garment when a horizontal ray from the body axis through it meets the garment beyond "
                                     "it; a hand with at least 3 vertices on each side crosses the cloth (it comes out "
                                     "through it). Counts are the vertices on the minority side.", "clips": {}},
              "heldStick": {"note": "round 2: the held stick (prop_stick in hand_l through its grip) sampled every centimetre along the "
                                    "shaft; a point is inside cloth when a horizontal ray from the body axis through it meets a garment "
                                    "beyond it. Fails when any sampled frame has more than limitMetres of shaft inside cloth.",
                            "limitMetres": args.stick_limit, "clips": {}}}
    for track in ad.nla_tracks:
        action = bpy.data.actions.get(track.name)
        if action is None or track.name.startswith("face_"):
            continue
        ad.action = action
        f0, f1 = (int(x) for x in action.frame_range)
        worst = {}
        hand_worst = {}
        for f in range(f0, f1 + 1, args.step):
            scene.frame_set(f)
            dg.update()
            bco, bno, _bt, _bp = evaluated(body, dg)
            cco, cno, ctris, ctri_poly2 = evaluated(clothes, dg)
            tree = BVHTree.FromPolygons([tuple(c) for c in cco], ctris, all_triangles=True)
            if stick_grip is not None and track.name in stick_clips:
                axis_s = arm.matrix_world @ arm.pose.bones["hips"].head
                ctri = [t for t, pi in zip(ctris, ctri_poly2) if poly_piece[pi] in cloth_ids]
                ctree = BVHTree.FromPolygons([tuple(c) for c in cco], ctri, all_triangles=True)
                S = (arm.matrix_world @ arm.pose.bones["hand_l"].matrix) @ stick_grip
                inside = 0
                for k in range(int(stick_len * 100) + 1):
                    q = S @ Vector((0.0, 0.0, -k / 100.0))
                    d = Vector((q.x - axis_s.x, q.y - axis_s.y, 0.0))
                    if d.length > 1e-6 and ctree.ray_cast(q + d.normalized() * 0.0005, d.normalized(), 0.6)[0] is not None:
                        inside += 1
                sw = report["heldStick"]["clips"].setdefault(track.name, {"framesSampled": 0, "framesOverLimit": 0, "maxInsideCm": 0})
                sw["framesSampled"] += 1
                sw["maxInsideCm"] = max(sw["maxInsideCm"], inside)
                if inside / 100.0 > args.stick_limit:
                    sw["framesOverLimit"] += 1
            if outer_ids:
                axis = np.array(arm.matrix_world @ arm.pose.bones["hips"].head)
                otris = [t for t, pi in zip(ctris, ctri_poly2) if poly_piece[pi] in outer_ids]
                if otris:
                    otree = BVHTree.FromPolygons([tuple(c) for c in cco], otris, all_triangles=True)
                    for side, sets in (("left", hand_l), ("right", hand_r)):
                        pts = np.concatenate([bco[sets[0]], cco[sets[1]]]) if len(sets[1]) else bco[sets[0]]
                        if not len(pts):
                            continue
                        inside = 0
                        for q in pts:
                            d = Vector((q[0] - axis[0], q[1] - axis[1], 0.0))
                            if d.length < 1e-6:
                                continue
                            if otree.ray_cast(Vector(q) + d.normalized() * 0.0005, d.normalized(), 0.6)[0] is not None:
                                inside += 1
                        minority = min(inside, len(pts) - inside)
                        crossing = minority if minority >= 3 else 0
                        w = hand_worst.setdefault(side, {"frame": f, "minorityVertices": 0, "framesCrossing": 0, "framesSampled": 0,
                                                         "handVertices": int(len(pts))})
                        w["framesSampled"] += 1
                        if crossing:
                            w["framesCrossing"] += 1
                        if crossing > w["minorityVertices"]:
                            w.update(frame=f, minorityVertices=int(crossing), insideAtWorst=int(inside))
            counts, depth, tight, where = {}, {}, {}, {}
            for src, i, own, cover, hand in pairs:
                co, no = (bco, bno) if src == "body" else (cco, cno)
                p, n = Vector(co[i]), Vector(no[i])
                out = tree.ray_cast(p + n * 0.0005, n, args.reach)
                key = ("hand:" if hand else "") + ("Body" if src == "body" else label(own)) + "->" + label(cover)
                excursion = None
                if out[0] is not None and int(poly_piece[ctri_poly2[out[2]]]) == cover:
                    if out[3] < args.margin:
                        tight[key] = tight.get(key, 0) + 1
                else:
                    # through the cover: met behind the vertex within a few centimetres (farther hits are the
                    # garment's far side across a limb or the torso, not a penetration)
                    back = tree.ray_cast(p - n * 0.0005, -n, args.back_reach)
                    if back[0] is not None and int(poly_piece[ctri_poly2[back[2]]]) == cover and abs(back[1].dot(n)) > 0.3:
                        excursion = back[3] + args.margin
                if excursion is not None:
                    where.setdefault(key, []).append(rest[src][i])
                    counts[key] = counts.get(key, 0) + 1
                    depth[key] = max(depth.get(key, 0.0), excursion)
            for key in set(counts) | set(tight):
                c = counts.get(key, 0)
                w = worst.setdefault(key, {"frame": f, "throughVertices": 0, "maxThroughMm": 0.0, "tighterThanMarginVertices": 0})
                if c > w["throughVertices"]:
                    # where on the resting figure (metres, Blender axes: x left-right, y back-front, z up)
                    centre = np.mean(np.array(where[key]), axis=0)
                    w.update(frame=f, throughVertices=c, restCentre=[round(float(x), 3) for x in centre])
                w["maxThroughMm"] = max(w["maxThroughMm"], round(depth.get(key, 0.0) * 1000, 1))
                w["tighterThanMarginVertices"] = max(w["tighterThanMarginVertices"], tight.get(key, 0))
        ranked = sorted(worst.items(), key=lambda kv: -kv[1]["throughVertices"])
        report["posedHands"]["clips"][track.name] = hand_worst
        report["clips"][track.name] = {k: v for k, v in ranked if not k.startswith("hand:")}
        report["handClips"][track.name] = {k[5:]: v for k, v in ranked if k.startswith("hand:")}
        ad.action = None
    if report["heldStick"]["clips"]:
        report["heldStick"]["pass"] = all(v["framesOverLimit"] == 0 for v in report["heldStick"]["clips"].values())
    text = json.dumps(report, indent=1)
    if args.out:
        with open(args.out, "w") as handle:
            handle.write(text)
    print(text[:4000])


if __name__ == "__main__":
    main()

"""Joint face rig for the LOD1 and Quest heads (MakeHuman's CC0 low-poly proxy head).

Original Crownfall code (motion stage). LOD1 and Quest have no morph targets, so blinking and talking come from the
face joints alone (Tier A of shared/legacy/aethelgard/characters/face-performance.ts). The proxy head inherits
MakeHuman's interpolated skin weights: its upper-lid margins carry 0.45 to 0.5 of the lid joint, the lower margins 0.12
to 0.17 and the lower lip 0.41 of the jaw (MakeHuman's own base mesh has the same 0.41 at the lower lip; LOD0 opens the
mouth with morphs instead). A full blink left the eyes 16 to 45 percent open and a joint 'aa' parted the lips by a
few millimetres. This module authors the lid and lip weights from the proxy's own topology:

* each eye opening is a boundary loop of the proxy; its upper margin follows the upper-lid joint in proportion to the
  local height of the opening (so every point of the margin reaches the lower margin at the same joint angle), the
  lower margin follows the lower-lid joint, and the first two rings of skin above and below fall off;
* the mouth slit is the boundary loop in front of the jaw; below its line the jaw weights are rescaled so the lower
  lip follows the jaw fully, fading out toward the mouth corners and back to the original weights near the neck seam
  where the proxy is welded to the decimated body;
* the joint angles that close the eye (with a small overlap) and the lip gap at 'aa' are then measured on the
  deformed proxy and returned as the set's calibration (the face clips and household-art-sets.ts use them).
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree

LID_RINGS_UPPER = (1.0, 0.55, 0.15)
LID_RINGS_LOWER = (1.0, 0.35, 0.08)


def _boundary_loops(bm):
    adj = {}
    for e in bm.edges:
        if e.is_boundary:
            a, b = e.verts[0].index, e.verts[1].index
            adj.setdefault(a, []).append(b)
            adj.setdefault(b, []).append(a)
    seen, loops = set(), []
    for start in adj:
        if start in seen:
            continue
        loop, prev, cur = [start], None, start
        seen.add(start)
        while True:
            nxt = [n for n in adj[cur] if n != prev and n not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            loop.append(cur)
            seen.add(cur)
        loops.append(loop)
    return loops


def _rings(bm, start, depth):
    """Vertex sets at graph distance 1..depth from the start set."""
    rings, seen, front = [], set(start), set(start)
    for _ in range(depth):
        nxt = set()
        for i in front:
            for e in bm.verts[i].link_edges:
                j = e.other_vert(bm.verts[i]).index
                if j not in seen:
                    nxt.add(j)
        seen |= nxt
        rings.append(nxt)
        front = nxt
    return rings


def _weights(obj):
    names = {g.index: g.name for g in obj.vertex_groups}
    return [{names[g.group]: g.weight for g in v.groups if g.weight > 0.0} for v in obj.data.vertices]


def _write_weights(obj, per_vertex, touched):
    for name in {n for i in touched for n in per_vertex[i]}:
        if name not in obj.vertex_groups:
            obj.vertex_groups.new(name=name)
    groups = {g.name: g for g in obj.vertex_groups}
    for i in touched:
        w = {n: x for n, x in per_vertex[i].items() if x > 1e-4}
        total = sum(w.values())
        for g in obj.vertex_groups:
            g.remove([i])
        for n, x in w.items():
            groups[n].add([i], x / total, "REPLACE")


def _give(w, bone, amount, donors=("head",)):
    """Set bone's share to `amount`, taking the difference from the donors first, then from everything else."""
    have = w.get(bone, 0.0)
    need = amount - have
    if need <= 0:
        return
    for d in donors:
        take = min(need, w.get(d, 0.0))
        if take > 0:
            w[d] -= take
            need -= take
    if need > 1e-6:
        others = {n: x for n, x in w.items() if n != bone and x > 0}
        total = sum(others.values())
        if total > 0:
            for n, x in others.items():
                w[n] = x * max(0.0, 1.0 - need / total)
    w[bone] = amount


def _corner_line(points):
    """Lateral extremes of an opening: the corners, and the line between them."""
    xs = points[:, 0]
    a, b = points[int(np.argmin(xs))], points[int(np.argmax(xs))]
    return a, b


def _arcs(loop, co):
    """Split a closed boundary loop at its lateral extremes (the corners) into its upper and lower arcs. A corner
    line does not work: a smiling mouth slit has both arcs above the line between its corners."""
    xs = co[loop][:, 0]
    i1, i2 = sorted((int(np.argmin(xs)), int(np.argmax(xs))))
    arc1 = loop[i1 + 1:i2]
    arc2 = loop[i2 + 1:] + loop[:i1]
    if not arc1 or not arc2:
        raise RuntimeError("degenerate opening loop")
    if co[arc1][:, 2].mean() < co[arc2][:, 2].mean():
        arc1, arc2 = arc2, arc1
    return list(arc1), list(arc2), {loop[i1], loop[i2]}


def _line_z(a, b, x):
    t = (x - a[0]) / (b[0] - a[0]) if abs(b[0] - a[0]) > 1e-9 else 0.5
    return a[2] + (b[2] - a[2]) * t


def author_lod_face_weights(proxy, arm, report):
    """Author lid and lip weights on the proxy head (in place). Returns the opening data used for calibration."""
    bones = arm.data.bones
    mw = proxy.matrix_world
    bm = bmesh.new()
    bm.from_mesh(proxy.data)
    bm.verts.ensure_lookup_table()
    co = np.array([list(mw @ v.co) for v in bm.verts])
    loops = _boundary_loops(bm)
    eye_c = {s: np.array(list(arm.matrix_world @ bones[f"face_eye_{s}"].head_local)) for s in ("l", "r")}
    jaw_c = np.array(list(arm.matrix_world @ bones["face_jaw"].head_local))
    per = _weights(proxy)
    touched = set()
    info = {"eyes": {}, "mouth": {}}
    for side in ("l", "r"):
        best = min(loops, key=lambda L: np.linalg.norm(co[L].mean(axis=0) - eye_c[side]))
        if np.linalg.norm(co[best].mean(axis=0) - eye_c[side]) > 0.03:
            raise RuntimeError(f"no eye opening found on the proxy head for side {side}")
        pts = co[best]
        a, b = _corner_line(pts)
        upper, lower, corner_idx = _arcs(best, co)
        # opening height at each margin vertex (upper minus lower margin, interpolated along x)
        lx = sorted(lower, key=lambda i: co[i][0])
        ux = sorted(upper, key=lambda i: co[i][0])
        def interp(seq, x):
            xs = [a[0]] + [co[i][0] for i in seq] + [b[0]]
            zs = [_line_z(a, b, a[0])] + [co[i][2] for i in seq] + [_line_z(a, b, b[0])]
            order = np.argsort(xs)
            return float(np.interp(x, np.array(xs)[order], np.array(zs)[order]))
        gap = {i: max(0.0, co[i][2] - interp(lx, co[i][0])) for i in upper}
        gmax = max(gap.values()) if gap else 1.0
        lgap = {i: max(0.0, interp(ux, co[i][0]) - co[i][2]) for i in lower}
        lgmax = max(lgap.values()) if lgap else 1.0
        margin_w = {}
        for i in upper:
            margin_w[i] = ("u", 0.25 + 0.75 * gap[i] / gmax)
        for i in lower:
            margin_w[i] = ("d", 0.3 + 0.5 * lgap[i] / lgmax)
        for i in corner_idx:
            margin_w[i] = ("c", 0.0)
        lid_u, lid_d = f"face_lid_upper_{side}", f"face_lid_lower_{side}"
        for i, (kind, w) in margin_w.items():
            per[i].pop(lid_u, None)
            per[i].pop(lid_d, None)
            if kind == "u":
                _give(per[i], lid_u, w)
            elif kind == "d":
                _give(per[i], lid_d, w)
            else:  # corners hardly move in a blink
                _give(per[i], lid_u, 0.2)
                _give(per[i], lid_d, 0.1)
            touched.add(i)
        rings = _rings(bm, best, 2)
        x0, x1 = min(a[0], b[0]) - 0.004, max(a[0], b[0]) + 0.004
        for k, ring in enumerate(rings):
            for i in ring:
                p = co[i]
                if not (x0 <= p[0] <= x1) or np.linalg.norm(p - eye_c[side]) > 0.035:
                    continue
                near = min(margin_w, key=lambda j: np.linalg.norm(co[j] - p))
                kind, w = margin_w[near]
                above = kind == "u" or (kind == "c" and p[2] > _line_z(a, b, p[0]))
                per[i].pop(lid_u, None)
                per[i].pop(lid_d, None)
                if above:
                    base = w if kind == "u" else 0.4
                    _give(per[i], lid_u, base * LID_RINGS_UPPER[k + 1])
                else:
                    base = w if kind == "d" else 0.35
                    _give(per[i], lid_d, base * LID_RINGS_LOWER[k + 1])
                touched.add(i)
        info["eyes"][side] = {"upper": upper, "lower": lower, "corners": sorted(corner_idx), "loop": best,
                              "openingMetres": round(gmax, 4)}
    # ---- mouth slit: the boundary loop in front of the jaw joint, below the eyes
    cands = [L for L in loops if len(L) >= 8 and abs(co[L].mean(axis=0)[0]) < 0.01 and co[L].mean(axis=0)[2] < jaw_c[2]]
    if not cands:
        raise RuntimeError("no mouth slit found on the proxy head")
    slit = min(cands, key=lambda L: co[L].mean(axis=0)[1])  # the front-most (Blender forward is -Y)
    pts = co[slit]
    a, b = _corner_line(pts)
    upper_lip, lower_lip, corner_idx = _arcs(slit, co)
    # sort the lower arc by x and build the slit line z(x) as the mean of the two arcs
    def arc_z(seq, x):
        xs = [a[0]] + sorted(co[i][0] for i in seq) + [b[0]]
        zs_map = {co[i][0]: co[i][2] for i in seq}
        zs = [a[2]] + [zs_map[v] for v in sorted(zs_map)] + [b[2]]
        return float(np.interp(x, xs, zs))
    def slit_z(x):
        if x <= a[0] or x >= b[0]:
            return float(a[2] if x <= a[0] else b[2])
        return 0.5 * (arc_z(upper_lip, x) + arc_z(lower_lip, x))
    mid = min(lower_lip, key=lambda i: abs(co[i][0]))
    w_mid = per[mid].get("face_jaw", 0.0)
    scale = 1.0 / max(0.2, w_mid) if w_mid < 0.95 else 1.0
    from stage_lods import _neck_cut_z
    z_cut = _neck_cut_z(arm)
    half_w = 0.5 * abs(b[0] - a[0])
    for i in range(len(co)):
        p = co[i]
        if p[1] > jaw_c[1] + 0.02:  # behind the jaw joint: skull and nape
            continue
        dz = slit_z(p[0]) - p[2]
        if dz < -0.001:
            continue
        down = min(1.0, max(0.0, (dz + 0.001) / 0.003))
        neck = min(1.0, max(0.0, (p[2] - (z_cut + 0.004)) / 0.018))
        lateral = min(1.0, max(0.0, 1.0 - (abs(p[0]) - half_w) / 0.03))
        k = 1.0 + (scale - 1.0) * down * neck * lateral
        wj = per[i].get("face_jaw", 0.0)
        if wj <= 0.0 or k <= 1.0001:
            continue
        _give(per[i], "face_jaw", min(1.0, wj * k))
        touched.add(i)
    # the lower lip itself follows the jaw fully at the centre, less toward the corners (the corners stretch)
    for i in lower_lip:
        t = min(1.0, abs(co[i][0]) / max(1e-4, half_w))
        _give(per[i], "face_jaw", max(per[i].get("face_jaw", 0.0), 1.0 - 0.55 * t * t))
        touched.add(i)
    _write_weights(proxy, per, touched)
    info["mouth"] = {"upper": upper_lip, "lower": lower_lip, "corners": sorted(corner_idx), "jawWeightBefore": round(w_mid, 3),
                     "jawScale": round(scale, 3), "neckCutZ": round(z_cut, 4)}
    bm.free()
    report["verticesReweighted"] = len(touched)
    return info


def _posed(proxy, arm, rot):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = rot.get(pb.name, Quaternion())
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = proxy.evaluated_get(dg)
    me = ev.to_mesh()
    out = np.array([list(proxy.matrix_world @ v.co) for v in me.vertices])
    ev.to_mesh_clear()
    return out


def _closure(posed, info_eye):
    """Largest height of the opening left between the upper and lower margins (metres; negative = overlap)."""
    up, lo = info_eye["upper"], info_eye["lower"]
    xs_l = posed[lo][:, 0]
    order = np.argsort(xs_l)
    worst = -1.0
    for i in up:
        zl = float(np.interp(posed[i][0], xs_l[order], posed[lo][:, 2][order]))
        worst = max(worst, posed[i][2] - zl)
    return worst


def _eye_rays(arm, eyes_obj):
    """Eyeball geometry (rest, rigid to the eye joints) as one BVH per eye, the eye centres and a ray grid per eye and
    view: the cameras sit 0.3 m from the eyes' midpoint, straight ahead, 15 degrees above and 10 degrees below (the
    three.js eye-closure gate renders from the front at 0.3 m)."""
    names = {g.index: g.name for g in eyes_obj.vertex_groups}
    side_of = {}
    for v in eyes_obj.data.vertices:
        w = {names[g.group]: g.weight for g in v.groups}
        for s in "lr":
            if w.get(f"face_eye_{s}", 0.0) >= 0.5:
                side_of[v.index] = s
    co = [eyes_obj.matrix_world @ v.co for v in eyes_obj.data.vertices]
    centres = {s: arm.matrix_world @ arm.data.bones[f"face_eye_{s}"].head_local for s in "lr"}
    bvhs, boxes = {}, {}
    for s in "lr":
        polys = [tuple(p.vertices) for p in eyes_obj.data.polygons if all(side_of.get(i) == s for i in p.vertices)]
        used = sorted({i for p in polys for i in p})
        remap = {i: k for k, i in enumerate(used)}
        bvhs[s] = BVHTree.FromPolygons([co[i] for i in used], [tuple(remap[i] for i in p) for p in polys])
        pts = np.array([list(co[i]) for i in used])
        boxes[s] = (pts.min(axis=0), pts.max(axis=0))
    mid = (centres["l"] + centres["r"]) / 2
    cams = [mid + Vector((0.0, -0.3, 0.0)), mid + Vector((0.0, -0.29, 0.078)), mid + Vector((0.0, -0.295, -0.052))]
    return bvhs, boxes, centres, cams


def eye_visibility(proxy, arm, eyes_obj, upper, lower, grid=(48, 24)):
    """Fraction of each eye's rest-visible eyeball area that stays visible through the posed head with the lids at
    (upper, lower) radians, over three views: a ray grid over each eyeball's box, a ray counting as visible when it
    meets the eyeball before the head surface. Also returns where the visible rays meet the eyeball (eye-local x/z)."""
    from mathutils.bvhtree import BVHTree as _B
    bvhs, boxes, centres, cams = _eye_rays(arm, eyes_obj)
    X = Vector((1, 0, 0))

    def head_bvh(rot):
        p = _posed(proxy, arm, rot)
        return _B.FromPolygons([Vector(x) for x in p], [tuple(f.vertices) for f in proxy.data.polygons])
    rest = head_bvh({})
    closed = head_bvh({f"face_lid_upper_{s}": Quaternion(X, upper) for s in "lr"} | {f"face_lid_lower_{s}": Quaternion(X, lower) for s in "lr"})
    _posed(proxy, arm, {})
    out = {}
    for s in "lr":
        lo, hi = boxes[s]
        seen = {"rest": 0, "closed": 0}
        where = []
        for cam in cams:
            for i in range(grid[0]):
                for j in range(grid[1]):
                    target = Vector((lo[0] + (hi[0] - lo[0]) * (i + 0.5) / grid[0], lo[1], lo[2] + (hi[2] - lo[2]) * (j + 0.5) / grid[1]))
                    d = (target - cam).normalized()
                    e = bvhs[s].ray_cast(cam, d, 1.0)
                    if e[0] is None:
                        continue
                    for key, tree in (("rest", rest), ("closed", closed)):
                        h = tree.ray_cast(cam, d, 1.0)
                        if h[0] is None or h[3] > e[3] + 1e-5:
                            seen[key] += 1
                            if key == "closed" and len(where) < 24:
                                # where the eyeball shows, and the head face just behind it (the skin the eyeball pokes
                                # through), or None when the ray leaves through the opening
                                where.append([round((e[0] - centres[s]).x * 1000, 1), round((e[0] - centres[s]).z * 1000, 1),
                                              h[2] if h[0] is not None and h[3] - e[3] < 0.004 else None])
        out[s] = {"fraction": round(seen["closed"] / max(1, seen["rest"]), 4), "restRays": seen["rest"], "closedRays": seen["closed"],
                  "where": where}
    return out


def _boost_corner_weights(proxy, info, side, where_mm, arm, step=0.12):
    """Raise lid weights where eyeball still shows at full closure: the margin vertices nearest each spot and, when the
    eyeball pokes through the closed skin (the smith's lower inner corners: the eyeball surface 0.3 mm in front of the
    closed lower lid), the vertices of the skin face it pokes through. Spots below the eye centre raise the lower-lid
    weight, spots above it the upper-lid weight."""
    centre = arm.matrix_world @ arm.data.bones[f"face_eye_{side}"].head_local
    mw = proxy.matrix_world
    co = [mw @ v.co for v in proxy.data.vertices]
    eye = info["eyes"][side]
    margin = [(i, "u") for i in eye["upper"]] + [(i, "d") for i in eye["lower"]]
    names = {g.index: g.name for g in proxy.vertex_groups}
    touched = {}
    for spot in where_mm:
        wx, wz = spot[0], spot[1]
        face = spot[2] if len(spot) > 2 else None
        p = centre + Vector((wx / 1000.0, 0.0, wz / 1000.0))
        near = sorted(margin, key=lambda m: abs(co[m[0]].x - p.x) + 0.5 * abs(co[m[0]].z - p.z))[:2]
        for i, kind in near:
            touched[i] = kind
        if face is not None:
            upper_set, lower_set = set(eye["upper"]), set(eye["lower"])
            a, b = co[eye["corners"][0]], co[eye["corners"][1]]
            for i in proxy.data.polygons[face].vertices:
                if i in upper_set or i in lower_set or i in eye["corners"]:
                    continue  # margins keep their own lid; the nearest ones are boosted above
                # skin above the line between the corners follows the upper lid, below it the lower lid
                t = (co[i].x - a.x) / (b.x - a.x) if abs(b.x - a.x) > 1e-9 else 0.5
                touched.setdefault(i, "u" if co[i].z > a.z + (b.z - a.z) * t else "d")
    for i, kind in touched.items():
        bone = f"face_lid_upper_{side}" if kind == "u" else f"face_lid_lower_{side}"
        w = {names[g.group]: g.weight for g in proxy.data.vertices[i].groups}
        have = w.get(bone, 0.0)
        new = min(1.0, have + step)
        if new <= have + 1e-6:
            continue
        need = new - have
        for donor in ["head"] + sorted((n for n in w if n not in (bone, "head")), key=lambda n: -w[n]):
            take = min(need, w.get(donor, 0.0))
            if take > 0:
                w[donor] -= take
                need -= take
            if need <= 1e-6:
                break
        w[bone] = new - need
        total = sum(x for x in w.values() if x > 1e-4)
        for g in proxy.vertex_groups:
            g.remove([i])
        for n, x in w.items():
            if x > 1e-4:
                g = proxy.vertex_groups.get(n) or proxy.vertex_groups.new(name=n)
                g.add([i], x / total, "REPLACE")
    return len(touched)


def calibrate(proxy, arm, info, lower_closed=-0.15, overlap=0.0006, jaw_open=0.262, full_gap=None, eyes_obj=None):
    """Joint angles that close the proxy's eyes (upper margin `overlap` below the raised lower margin everywhere) and
    the lip gap at 'aa' (0.8 of jaw_open) and full opening. Pose bones are reset afterwards.

    Round 2 (motion fixer): the margin test alone passed while the three.js eye-closure render still saw eyeball at the
    smith's inner corners (2.4 percent on LOD1): the eyeball shows through faces between the margin vertices. When an
    eyes object is given, closure is also checked by rays over the eyeball from three views (eye_visibility); where
    eyeball still shows at the closed angle, the angle is raised (at most 15 percent) and then the nearest margin
    weights are boosted, until no ray sees the eyeball."""
    X = Vector((1, 0, 0))
    def lids(u, d):
        return {f"face_lid_upper_{s}": Quaternion(X, u) for s in "lr"} | {f"face_lid_lower_{s}": Quaternion(X, d) for s in "lr"}
    rest = _posed(proxy, arm, {})
    open_m = {s: _closure(rest, info["eyes"][s]) for s in "lr"}

    def bisect():
        lo, hi = 0.2, 1.1
        for _ in range(18):
            m = 0.5 * (lo + hi)
            p = _posed(proxy, arm, lids(m, lower_closed))
            if max(_closure(p, info["eyes"][s]) for s in "lr") > -overlap:
                lo = m
            else:
                hi = m
        return hi
    upper = bisect()
    vis_log = []
    if eyes_obj is not None:
        start = upper
        for attempt in range(12):
            vis = eye_visibility(proxy, arm, eyes_obj, upper, lower_closed)
            vis_log.append({"upper": round(upper, 3), **{s: vis[s]["closedRays"] for s in "lr"}})
            if all(vis[s]["closedRays"] == 0 for s in "lr"):
                break
            # boost the margins next to the spots at this angle (re-bisecting would give the boost straight back by
            # closing the margin vertices sooner), and every third pass raise the angle a little (at most 25 percent)
            for s in "lr":
                if vis[s]["closedRays"]:
                    _boost_corner_weights(proxy, info, s, vis[s]["where"], arm)
            if attempt % 3 == 2:
                upper = min(start * 1.25, upper * 1.05)
    upper = round(upper, 3)
    closed = _posed(proxy, arm, lids(upper, lower_closed))
    up, low = info["mouth"]["upper"], info["mouth"]["lower"]
    mid_u = min(up, key=lambda i: abs(rest[i][0]))
    mid_l = min(low, key=lambda i: abs(rest[i][0]))
    def gap(angle):
        p = _posed(proxy, arm, {"face_jaw": Quaternion(X, angle)})
        return float(p[mid_u][2] - p[mid_l][2])
    if full_gap:  # the jaw angle whose full opening parts the lips by full_gap metres at the midline
        lo_j, hi_j = 0.05, 0.45
        for _ in range(16):
            m = 0.5 * (lo_j + hi_j)
            lo_j, hi_j = (m, hi_j) if gap(m) < full_gap else (lo_j, m)
        jaw_open = round(0.5 * (lo_j + hi_j), 3)
    gaps = {label: round(gap(jaw_open * k) * 1000, 1) for label, k in (("aa", 0.8), ("full", 1.0))}
    gaps["rest"] = round(gap(0.0) * 1000, 1)
    _posed(proxy, arm, {})
    out = {"upperLidClosed": upper, "lowerLidClosed": lower_closed, "jawOpen": jaw_open,
           "openingAtRestMm": {s: round(open_m[s] * 1000, 2) for s in "lr"},
           "closureAtBlinkMm": {s: round(_closure(closed, info["eyes"][s]) * 1000, 2) for s in "lr"},
           "lipGapMm": gaps}
    if eyes_obj is not None:
        final = eye_visibility(proxy, arm, eyes_obj, upper, lower_closed)
        out["eyeballVisibleAtBlink"] = {s: final[s]["fraction"] for s in "lr"}
        out["visibilityPasses"] = vis_log
    return out


def run(rig_obj, recipe, report):
    """Author the LOD head's face weights and measure its calibration. Returns the calibration (radians)."""
    proxy = bpy.data.objects.get("HeadProxy")
    rep = report.setdefault("lodFaceRig", {})
    if proxy is None:
        rep["skipped"] = "no HeadProxy"
        return None
    info = author_lod_face_weights(proxy, rig_obj, rep)
    spec = recipe.get("faceRig", {})
    jaw = math.radians(spec.get("jawOpenDeg", 15.0))
    # a full joint opening parts the lips by about 1.8 cm on an adult (1.5 cm on the child); 'aa' is 0.8 of it
    cal = calibrate(proxy, rig_obj, info, lower_closed=-0.15, jaw_open=jaw, full_gap=spec.get("jawFullGapMm", 18.0) / 1000.0,
                    eyes_obj=bpy.data.objects.get("EyesMouth"))
    rep.update({"calibration": cal, "eyeOpeningMetres": {s: info["eyes"][s]["openingMetres"] for s in "lr"},
                "mouth": {k: v for k, v in info["mouth"].items() if k in ("jawWeightBefore", "jawScale", "neckCutZ")}})
    return cal

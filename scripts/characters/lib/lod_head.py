"""LOD1 and Quest head derived from the resident's own LOD0 head (original Crownfall code).

Round 2 of the critic loop: MakeHuman's CC0 low-poly proxy head (8-vertex eye openings, its own face shape and
proportions) read as a different person from each resident's LOD0 head and could not close its eyes. The LOD head is
now the LOD0 head itself, decimated with its lid margins, lip margins and atlas seams kept exactly (Blender's
collapse decimator never collapses an edge that touches a vertex of weight 0):

* the eye sockets behind the lid margins (skin that faces the eyeball) are removed, so each eye opening is a
  boundary loop resting on the eyeball, exactly where the LOD0 lid margin rests;
* the mouth bag behind the inner lips is removed from the head (stage_lods adds it back to each level as a separate
  dark cavity piece), so the inner lip ring is a boundary loop as well;
* the head keeps the LOD0 vertex weights, so face_rig.py (motion stage) authors the lid and lip joint weights from
  those loops and measures the calibration exactly as it did for the proxy;
* stage_lods projects the LOD0 skin atlas onto it (exact, it lies on the LOD0 surface), decimates it further for
  Quest with the same loops kept, and transfers the LOD0 face morphs (blink, visemes, expressions).
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from scene import triangle_count, vertex_array


def eye_sphere(eyes, side):
    """Least-squares sphere through one eyeball's vertices (the back is trimmed, so the mean is not the centre)."""
    co = vertex_array(eyes)
    sel = co[:, 0] > 0 if side == "l" else co[:, 0] < 0
    p = co[sel]
    A = np.hstack([2 * p, np.ones((len(p), 1))])
    b = (p * p).sum(axis=1)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    c = sol[:3]
    r = math.sqrt(max(1e-12, sol[3] + c @ c))
    return c, r


def _vertex_normals(obj):
    n = np.zeros(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get("normal", n)
    return n.reshape(-1, 3)


def socket_vertices(obj, spheres, margin=0.0045, facing=0.2):
    """Vertices of the eye sockets: skin within `margin` of the eyeball sphere whose normal faces the eyeball
    (the inner lid surfaces and the bag behind the eye). The lid margin, where the skin turns outward, is kept."""
    co = vertex_array(obj)
    vn = _vertex_normals(obj)
    out = np.zeros(len(co), dtype=bool)
    for c, r in spheres:
        d = co - c
        dist = np.linalg.norm(d, axis=1)
        toward = -(vn * d).sum(axis=1) / np.maximum(dist, 1e-9)
        out |= (dist < r + margin) & (toward > facing)
    return out


def mark_mouth(body, lip_faces, arm):
    """Mark the lip vertices ('crownfall_lips', point) and the mouth bag faces ('crownfall_mouth_bag', face) on the
    shaped body while its faces still carry the base-mesh indices. The bag is flooded from the back wall of the
    mouth (skin facing forward, deep behind the lips) through every vertex that is not lip skin, within the mouth's
    bounds; the lips (MakeHuman's lips_solid region, which includes part of the inner lip surface) stop the flood,
    so the outer face is never reached. Attributes survive the later stages' face deletions."""
    me = body.data
    co = vertex_array(body)
    vn = _vertex_normals(body)
    lip = np.zeros(len(co), dtype=bool)
    for f in lip_faces:
        if f < len(me.polygons):
            lip[list(me.polygons[f].vertices)] = True
    jaw = arm.data.bones["face_jaw"]
    mouth_c = (np.array(jaw.head_local) + np.array(jaw.tail_local)) * 0.5
    lip_front = float(co[lip][:, 1].min()) if lip.any() else float(mouth_c[1] - 0.04)
    # only the outward-facing lip skin stops the flood: the inner lip surfaces (facing back into the mouth) go with
    # the bag, so the head's mouth loop is the lip edge where the lips meet (face_rig measures its lip gap there)
    barrier = lip & (vn[:, 1] < 0.25)
    ok = (~barrier) & (co[:, 1] < lip_front + 0.125) & (np.abs(co[:, 0]) < 0.055) & \
         (co[:, 2] > mouth_c[2] - 0.07) & (co[:, 2] < mouth_c[2] + 0.06)
    cand = np.where(ok & (np.abs(co[:, 0]) < 0.006) & (np.abs(co[:, 2] - mouth_c[2]) < 0.02) &
                    (co[:, 1] > lip_front + 0.04) & (vn[:, 1] < -0.6))[0]
    bag_faces = np.zeros(len(me.polygons), dtype=np.int32)
    if len(cand):
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.verts.ensure_lookup_table()
        seed = int(cand[np.argmax(co[cand, 1])])
        flood, stack = {seed}, [seed]
        while stack:
            i = stack.pop()
            for e in bm.verts[i].link_edges:
                j = e.other_vert(bm.verts[i]).index
                if j not in flood and ok[j]:
                    flood.add(j)
                    stack.append(j)
        for f in bm.faces:
            if all(v.index in flood for v in f.verts):
                bag_faces[f.index] = 1
        bm.free()
    a = me.attributes.get("crownfall_lips") or me.attributes.new("crownfall_lips", "INT", "POINT")
    a.data.foreach_set("value", lip.astype(np.int32))
    b = me.attributes.get("crownfall_mouth_bag") or me.attributes.new("crownfall_mouth_bag", "INT", "FACE")
    b.data.foreach_set("value", bag_faces)
    return int(bag_faces.sum()), lip_front


def face_flags(obj, name):
    a = obj.data.attributes.get(name)
    if a is None or a.domain != "FACE":
        return np.zeros(len(obj.data.polygons), dtype=bool)
    v = np.zeros(len(obj.data.polygons), dtype=np.int32)
    a.data.foreach_get("value", v)
    return v.astype(bool)


def boundary_loops(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    adj = {}
    for e in bm.edges:
        if e.is_boundary:
            a, b = e.verts[0].index, e.verts[1].index
            adj.setdefault(a, []).append(b)
            adj.setdefault(b, []).append(a)
    bm.free()
    seen, loops = set(), []
    for start in adj:
        if start in seen:
            continue
        loop, stack = [], [start]
        seen.add(start)
        while stack:
            cur = stack.pop()
            loop.append(cur)
            for n in adj[cur]:
                if n not in seen:
                    seen.add(n)
                    stack.append(n)
        loops.append(loop)
    return loops


def rings(obj, start, depth):
    """Vertex index sets at graph distance 0..depth from the start set (index 0 is the start set)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    out, seen, front = [set(start)], set(start), set(start)
    for _ in range(depth):
        nxt = set()
        for i in front:
            for e in bm.verts[i].link_edges:
                j = e.other_vert(bm.verts[i]).index
                if j not in seen:
                    nxt.add(j)
        seen |= nxt
        out.append(nxt)
        front = nxt
    bm.free()
    return out


def uv_seam_vertices(obj, layer):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uvl = bm.loops.layers.uv[layer]
    seam = np.zeros(len(bm.verts), dtype=bool)
    for e in bm.edges:
        if len(e.link_loops) != 2:
            if e.is_boundary:
                continue
            seam[e.verts[0].index] = seam[e.verts[1].index] = True
            continue
        l1, l2 = e.link_loops
        if (l1[uvl].uv - l2.link_loop_next[uvl].uv).length > 1e-6 or (l1.link_loop_next[uvl].uv - l2[uvl].uv).length > 1e-6:
            seam[e.verts[0].index] = seam[e.verts[1].index] = True
    bm.free()
    return seam


def delete_faces(obj, faces):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in sorted(faces)], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def drop_small_pieces(obj, min_faces=24):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    comp = np.full(len(bm.faces), -1)
    pieces = []
    for f in bm.faces:
        if comp[f.index] >= 0:
            continue
        k = len(pieces)
        stack, members = [f], []
        comp[f.index] = k
        while stack:
            g = stack.pop()
            members.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if comp[h.index] < 0:
                        comp[h.index] = k
                        stack.append(h)
        pieces.append(members)
    doomed = [f for p in pieces if len(p) < min_faces for f in p]
    if doomed:
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return len(doomed)


def decimate_weighted(obj, ratio, weights):
    """Collapse-decimate with per-vertex weights (1 = free, small = keep, 0 = never collapsed), triangulated."""
    group = obj.vertex_groups.new(name="_decimate")
    buckets = {}
    for i, w in enumerate(weights):
        buckets.setdefault(round(float(w), 3), []).append(i)
    for w, idx in buckets.items():
        if w > 0:
            group.add(idx, w, "REPLACE")
    mod = obj.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = ratio
    mod.vertex_group = group.name
    mod.vertex_group_factor = 10.0
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    with bpy.context.temp_override(object=obj, active_object=obj):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.vertex_groups.remove(obj.vertex_groups["_decimate"])


def landmarks(obj, arm, eyes):
    bones = arm.data.bones
    spheres = {s: eye_sphere(eyes, s) for s in ("l", "r")}
    jaw = bones["face_jaw"]
    mouth_c = (np.array(jaw.head_local) + np.array(jaw.tail_local)) * 0.5
    co = vertex_array(obj)
    lips = co[(np.abs(co[:, 0]) < 0.004) & (np.abs(co[:, 2] - mouth_c[2]) < 0.03) & (co[:, 1] < mouth_c[1])]
    lip_front_y = float(lips[:, 1].min()) if len(lips) else float(mouth_c[1] - 0.04)
    head = bones["head"]
    return spheres, mouth_c, lip_front_y, float((head.head_local.y + head.tail_local.y) / 2)


def protection_weights(obj, arm, spheres, head_mid_y, spec, uv_layer=None):
    """Decimation weights: eye and mouth loops and their first rings never collapse, atlas seams never collapse,
    the face is kept denser than the skull, the neck decimates freely."""
    co = vertex_array(obj)
    weights = np.ones(len(co))
    bones = arm.data.bones
    eye_z = float((spheres["l"][0][2] + spheres["r"][0][2]) / 2)
    jaw_z = float(min(bones["face_jaw"].head_local.z, bones["face_jaw"].tail_local.z))
    face = (co[:, 1] < head_mid_y) & (co[:, 2] > jaw_z - 0.01)
    weights[co[:, 1] >= head_mid_y] = spec.get("skullWeight", 0.55)
    weights[face] = spec.get("faceWeight", 0.3)
    weights[co[:, 2] < jaw_z - 0.01] = spec.get("neckWeight", 1.0)
    loops = boundary_loops(obj)
    info = {"eyeLoops": 0, "mouthLoop": 0}
    mouth_cands = []
    for loop in loops:
        c = co[loop].mean(axis=0)
        near_eye = min(np.linalg.norm(c - spheres[s][0]) for s in "lr")
        if near_eye < 0.03 and len(loop) >= 8:
            for k, ring in enumerate(rings(obj, loop, spec.get("eyeRings", 2))):
                weights[list(ring)] = 0.0
            info["eyeLoops"] += 1
        elif abs(c[0]) < 0.01 and c[2] < eye_z - 0.03 and c[1] < head_mid_y - 0.05 and len(loop) >= 8:
            mouth_cands.append(loop)
    if mouth_cands:
        loop = min(mouth_cands, key=lambda L: co[L].mean(axis=0)[1])
        for ring in rings(obj, loop, spec.get("mouthRings", 4)):
            weights[list(ring)] = 0.0
        info["mouthLoop"] = len(loop)
    if uv_layer is not None and uv_layer in obj.data.uv_layers:
        seam = uv_seam_vertices(obj, uv_layer)
        weights[seam] = 0.0
        info["seamVertices"] = int(seam.sum())
    # nostrils: a short ring of skin that collapses into a flat nose tip
    nose_z = eye_z - 0.04
    nostrils = (np.abs(co[:, 2] - nose_z) < 0.012) & (np.abs(co[:, 0]) < 0.02) & (co[:, 1] < head_mid_y - 0.08)
    weights[nostrils] = np.minimum(weights[nostrils], spec.get("noseWeight", 0.12))
    return weights, info


def reduce(obj, target, weights_fn, attempts=6):
    """Decimate to about `target` triangles, recomputing the protection after each attempt."""
    base = obj.data.copy()
    ratio = min(1.0, target / max(1, triangle_count(obj)))
    for _ in range(attempts):
        obj.data = base.copy()
        decimate_weighted(obj, ratio, weights_fn(obj))
        got = triangle_count(obj)
        if abs(got - target) <= target * 0.03 or ratio >= 1.0:
            break
        ratio = min(1.0, ratio * target / max(1, got))
    bpy.data.meshes.remove(base)
    return triangle_count(obj), ratio


def build(body, eyes, arm, spec, report, z_keep):
    """Derive 'HeadProxy' from the shaped LOD0 body (rest pose, before any garment deletes skin)."""
    h = body.copy()
    h.data = body.data.copy()
    h.name = h.data.name = "HeadProxy"
    bpy.context.scene.collection.objects.link(h)
    if h.data.shape_keys:
        h.shape_key_clear()
    for m in list(h.modifiers):
        if m.type != "ARMATURE":
            h.modifiers.remove(m)
    co = vertex_array(h)
    below = [p.index for p in h.data.polygons if all(co[v][2] < z_keep for v in p.vertices)]
    delete_faces(h, below)
    spheres, mouth_c, lip_front_y, head_mid_y = landmarks(h, arm, eyes)
    sock = socket_vertices(h, [spheres["l"], spheres["r"]], spec.get("socketMargin", 0.0045), spec.get("socketFacing", 0.2))
    # optionally keep the first rings of socket skin next to the lid margin (off by default: face_rig needs the
    # margin itself as the opening loop; stage_lods closes the blink morph at that loop instead, close_lid_loops)
    keep_rings = spec.get("socketKeepRings", 0)
    if keep_rings > 0:
        kept = np.where(~sock)[0]
        for ring in rings(h, kept, keep_rings)[1:]:
            sock[list(ring)] = False
    sock_faces = [p.index for p in h.data.polygons if all(sock[v] for v in p.vertices)]
    delete_faces(h, sock_faces)
    bag = np.where(face_flags(h, "crownfall_mouth_bag"))[0].tolist()
    delete_faces(h, bag)
    dropped = drop_small_pieces(h, spec.get("minPieceFaces", 24))
    before = triangle_count(h)
    uv = h.data.uv_layers.active.name if h.data.uv_layers.active else None
    info = {}

    def weights_fn(obj):
        w, i = protection_weights(obj, arm, spheres, head_mid_y, spec, uv)
        info.update(i)
        return w
    got, ratio = reduce(h, spec.get("triangles", 1900), weights_fn)
    for p in h.data.polygons:
        p.use_smooth = True
    h["proxy_source"] = "lod0-derived"
    report.setdefault("parts", {})["HeadProxy"] = {
        "source": "the resident's own LOD0 head, decimated with lid, lip and atlas-seam loops kept (lod_head.py)",
        "trianglesBeforeDecimation": before, "triangles": got, "decimationRatio": round(ratio, 4),
        "socketFacesRemoved": len(sock_faces), "mouthBagFacesRemoved": len(bag), "smallPieceFacesDropped": dropped,
        "eyeSphereRadiusMm": {s: round(spheres[s][1] * 1000, 2) for s in "lr"}, **info}
    return h


def weights_of_obj(obj):
    names = {g.index: g.name for g in obj.vertex_groups}
    return [{names[g.group]: g.weight for g in v.groups if g.weight > 0.0} for v in obj.data.vertices]


def write_weights(obj, per_vertex, max_influences=4):
    """Replace every vertex's weights (top `max_influences`, normalised); groups are created as needed."""
    groups = {g.name: g for g in obj.vertex_groups}
    for acc in per_vertex:
        for name in acc:
            if name not in groups:
                groups[name] = obj.vertex_groups.new(name=name)
    all_idx = list(range(len(obj.data.vertices)))
    for g in obj.vertex_groups:
        g.remove(all_idx)
    for i, acc in enumerate(per_vertex):
        items = sorted(((k, v) for k, v in acc.items() if v > 1e-5), key=lambda kv: -kv[1])[:max_influences]
        total = sum(v for _k, v in items) or 1.0
        for k, v in items:
            groups[k].add([i], v / total, "REPLACE")


def transfer_face_morphs(target, source, vertex_mask, keys=None, max_distance=0.012, z_min=None, report=None):
    """Add the source's face morphs to `target` (in place): each masked target vertex takes the delta of the nearest
    source point in front of which it lies, with a normal check (a lower-lip vertex must not take the upper lip's
    motion). Exact LOD0 vertices (the kept lid and lip loops) map onto themselves. Unmasked vertices keep zero deltas.
    Returns the names of the keys added."""
    from mathutils.bvhtree import BVHTree
    skeys = source.data.shape_keys
    if skeys is None:
        return []
    names = [kb.name for kb in skeys.key_blocks[1:] if keys is None or kb.name in keys]
    sme = source.data
    sme.calc_loop_triangles()
    sco = vertex_array(source, skeys.key_blocks[0].name)
    tris = [t for t in sme.loop_triangles if z_min is None or max(sco[v][2] for v in t.vertices) > z_min]
    tv = np.array([t.vertices[:] for t in tris], dtype=np.int64)
    tree = BVHTree.FromPolygons([tuple(c) for c in sco], tv.tolist(), all_triangles=True)
    tn = np.cross(sco[tv[:, 1]] - sco[tv[:, 0]], sco[tv[:, 2]] - sco[tv[:, 0]])
    tn /= np.linalg.norm(tn, axis=1, keepdims=True) + 1e-12
    tco = vertex_array(target)
    tvn = _vertex_normals(target)
    idx = np.where(vertex_mask)[0]
    corner = np.zeros((len(idx), 3), dtype=np.int64)
    bary = np.zeros((len(idx), 3))
    found = np.zeros(len(idx), dtype=bool)
    for k, i in enumerate(idx):
        p = Vector(tco[i])
        best = None
        for loc, _n, ti, d in tree.find_nearest_range(p, max_distance):
            if tn[ti] @ tvn[i] < 0.15:
                continue
            if best is None or d < best[2]:
                best = (loc, ti, d)
        if best is None:
            loc, _n, ti, d = tree.find_nearest(p, max_distance)
            if loc is None:
                continue
            best = (loc, ti, d)
        loc, ti, d = best
        a, b, c = sco[tv[ti]]
        v0, v1, v2 = b - a, c - a, np.asarray(loc) - a
        d00, d01, d11, d20, d21 = v0 @ v0, v0 @ v1, v1 @ v1, v2 @ v0, v2 @ v1
        den = d00 * d11 - d01 * d01
        if abs(den) < 1e-20:
            w = np.array([1.0, 0.0, 0.0])
        else:
            vv = (d11 * d20 - d01 * d21) / den
            ww = (d00 * d21 - d01 * d20) / den
            w = np.clip(np.array([1.0 - vv - ww, vv, ww]), 0.0, 1.0)
            w /= w.sum()
        corner[k] = tv[ti]
        bary[k] = w
        found[k] = True
    if target.data.shape_keys is None:
        target.shape_key_add(name="Basis", from_mix=False)
    existing = {kb.name for kb in target.data.shape_keys.key_blocks}
    added = []
    for name in names:
        delta = vertex_array(source, name) - sco
        moved = np.zeros_like(tco)
        moved[idx[found]] = (delta[corner[found]] * bary[found][:, :, None]).sum(axis=1)
        if name in existing:
            kb = target.data.shape_keys.key_blocks[name]
            cur = vertex_array(target, name)
            cur[idx[found]] = tco[idx[found]] + moved[idx[found]]
            kb.data.foreach_set("co", cur.ravel())
        else:
            kb = target.shape_key_add(name=name, from_mix=False)
            kb.data.foreach_set("co", (tco + moved).ravel())
        added.append(name)
    if report is not None:
        report["mappedVertices"] = int(found.sum())
        report["unmappedVertices"] = int((~found).sum())
    return added


def transfer_rigid_arches(target, target_mask, target_lower, source, source_upper, source_lower, keys):
    """Per key, move the target's upper and lower arch vertices by the best-fit rigid motion of the source's matching
    arch (the LOD0 authored teeth): the low arches open with the jaw and follow the visemes like LOD0's."""
    skeys = source.data.shape_keys
    if skeys is None or target.data.shape_keys is None:
        return 0
    sbasis = vertex_array(source, skeys.key_blocks[0].name)
    tco = vertex_array(target)
    moved_any = 0
    for name in keys:
        if name not in skeys.key_blocks or name not in target.data.shape_keys.key_blocks:
            continue
        smoved = vertex_array(source, name)
        cur = vertex_array(target, name)
        for s_sel, t_sel in ((source_upper, target_mask & ~target_lower), (source_lower, target_mask & target_lower)):
            if not s_sel.any() or not t_sel.any():
                continue
            P, Q = sbasis[s_sel], smoved[s_sel]
            if np.abs(Q - P).max() < 1e-6:
                continue
            cP, cQ = P.mean(axis=0), Q.mean(axis=0)
            H = (P - cP).T @ (Q - cQ)
            U, _S, Vt = np.linalg.svd(H)
            dd = np.sign(np.linalg.det(Vt.T @ U.T))
            R = Vt.T @ np.diag([1.0, 1.0, dd]) @ U.T
            cur[t_sel] = (tco[t_sel] - cP) @ R.T + cQ
            moved_any += 1
        target.data.shape_keys.key_blocks[name].data.foreach_set("co", cur.ravel())
    return moved_any


def eye_loop_arcs(obj, arm, side, co=None):
    """(upper arc, lower arc) vertex indices of the boundary loop of one eye opening (x > 0 is the left eye), split
    at its lateral extremes, or None."""
    co = vertex_array(obj) if co is None else co
    c = np.array(arm.data.bones[f"face_eye_{side}"].head_local)
    best = None
    for loop in boundary_loops(obj):
        if len(loop) < 8:
            continue
        m = co[loop].mean(axis=0)
        d = np.linalg.norm(m - c)
        # in front of the eye centre (Blender -Y): the trimmed eyeball's own back loop lies behind it
        if d < 0.03 and (m[0] > 0) == (side == "l") and m[1] < c[1] - 0.004 and (best is None or d < best[0]):
            best = (d, loop)
    if best is None:
        return None
    # order the loop by walking it
    loop = best[1]
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    ring = set(loop)
    order = [loop[0]]
    prev = None
    while True:
        cur = order[-1]
        nxt = [e.other_vert(bm.verts[cur]).index for e in bm.verts[cur].link_edges
               if e.is_boundary and e.other_vert(bm.verts[cur]).index in ring and e.other_vert(bm.verts[cur]).index != prev]
        nxt = [n for n in nxt if n not in order[-2:]]
        if not nxt or nxt[0] == order[0]:
            break
        prev = cur
        order.append(nxt[0])
        if len(order) > len(loop):
            break
    bm.free()
    xs = co[order][:, 0]
    i1, i2 = sorted((int(np.argmin(xs)), int(np.argmax(xs))))
    a1, a2 = order[i1 + 1:i2], order[i2 + 1:] + order[:i1]
    if not a1 or not a2:
        return None
    if co[a1][:, 2].mean() < co[a2][:, 2].mean():
        a1, a2 = a2, a1
    return list(a1), list(a2)


def close_lid_loops(obj, arm, overlap=0.0007, falloff=(0.65, 0.3)):
    """Make each eye's blink morph close the opening loop exactly (round 2 blocker): the LOD0 blink closes the eye by
    bringing the inner lid surfaces together, and the LOD head (whose socket ends at the lid margin) kept a gap at
    the corners. In the eyeBlink key of that side, every upper-margin vertex that stays above the lower margin is
    moved down to `overlap` below it (and a little in front), and the first two rings above follow by `falloff`.
    Returns the largest correction per side in millimetres."""
    keys = obj.data.shape_keys
    if keys is None:
        return {}
    co = vertex_array(obj)
    out = {}
    for side, key in (("l", "eyeBlinkLeft"), ("r", "eyeBlinkRight")):
        if key not in keys.key_blocks:
            continue
        arcs = eye_loop_arcs(obj, arm, side, co)
        if arcs is None:
            continue
        upper, lower = arcs
        kco = vertex_array(obj, key)
        lx = kco[lower][:, 0]
        order = np.argsort(lx)
        lz = kco[lower][:, 2][order]
        ly = kco[lower][:, 1][order]
        lxs = lx[order]
        corr = {}
        for u in upper:
            z_low = float(np.interp(kco[u][0], lxs, lz))
            y_low = float(np.interp(kco[u][0], lxs, ly))
            dz = (z_low - overlap) - kco[u][2]
            dy = min(0.0, (y_low - 0.0004) - kco[u][1])
            if dz < 0 or dy < 0:
                corr[u] = np.array([0.0, dy, min(0.0, dz)])
        if not corr:
            out[side] = 0.0
            continue
        for u, d in corr.items():
            kco[u] += d
        rs = rings(obj, upper, len(falloff))
        ucoords = co[list(corr)]
        uvals = np.array(list(corr.values()))
        for k, ring in enumerate(rs[1:]):
            for i in ring:
                if co[i][2] < min(co[upper][:, 2].min(), co[lower][:, 2].max()):
                    continue  # only the upper lid follows
                j = int(np.argmin(np.linalg.norm(ucoords - co[i], axis=1)))
                kco[i] += uvals[j] * falloff[k]
        keys.key_blocks[key].data.foreach_set("co", kco.ravel())
        out[side] = round(float(np.abs(uvals).max()) * 1000, 2)
    return out


def mouth_loops(obj, arm, co=None):
    """Lip-edge boundary loops at the front of the mouth in a joined level mesh: the head's lip loop and the cavity
    piece's rim, which lie on the same vertices' positions."""
    co = vertex_array(obj) if co is None else co
    jaw = arm.data.bones["face_jaw"]
    mouth_c = (np.array(jaw.head_local) + np.array(jaw.tail_local)) * 0.5
    cands = []
    for loop in boundary_loops(obj):
        if len(loop) < 8:
            continue
        m = co[loop].mean(axis=0)
        if abs(m[0]) > 0.01 or abs(m[2] - mouth_c[2]) > 0.04 or m[1] > mouth_c[1]:
            continue
        cands.append((m[1], loop))
    if not cands:
        return []
    front = min(c[0] for c in cands)
    return [loop for y, loop in cands if y < front + 0.002]


def mouth_loop_arcs(obj, arm, co=None, loop=None):
    """(upper arc, lower arc) of a lip-edge boundary loop (the front-most one unless given), or None."""
    co = vertex_array(obj) if co is None else co
    if loop is None:
        loops = mouth_loops(obj, arm, co)
        if not loops:
            return None
        loop = loops[0]
    xs = co[loop][:, 0]
    # order by walking the boundary
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    ring = set(loop)
    order, prev = [loop[0]], None
    while True:
        cur = order[-1]
        nxt = [e.other_vert(bm.verts[cur]).index for e in bm.verts[cur].link_edges
               if e.is_boundary and e.other_vert(bm.verts[cur]).index in ring and e.other_vert(bm.verts[cur]).index != prev]
        nxt = [n for n in nxt if n not in order[-2:]]
        if not nxt or nxt[0] == order[0] or len(order) > len(loop):
            break
        prev = cur
        order.append(nxt[0])
    bm.free()
    xs = co[order][:, 0]
    i1, i2 = sorted((int(np.argmin(xs)), int(np.argmax(xs))))
    a1, a2 = order[i1 + 1:i2], order[i2 + 1:] + order[:i1]
    if not a1 or not a2:
        return None
    if co[a1][:, 2].mean() < co[a2][:, 2].mean():
        a1, a2 = a2, a1
    return list(a1), list(a2)


def seal_lips(obj, arm, max_gap=0.0016, overlap=0.0001):
    """Close the rest gap between the LOD head's upper and lower lip edges (round 2: the teeth showed through the
    0.4 mm slit of the closed lips at LOD1 and Quest). Each edge vertex moves half way toward the other edge where the
    two are closer than `max_gap`, so the lips meet; morphs are transferred afterwards. Returns vertices moved."""
    co = vertex_array(obj)
    moved = 0
    new = co.copy()
    for loop in mouth_loops(obj, arm, co):  # the lips and the cavity rim move alike and stay together
        arcs = mouth_loop_arcs(obj, arm, co, loop)
        if arcs is None:
            continue
        upper, lower = arcs
        for a, b, sign in ((upper, lower, -1.0), (lower, upper, 1.0)):
            bx = co[b][:, 0]
            order = np.argsort(bx)
            bz = co[b][:, 2][order]
            bxs = bx[order]
            for i in a:
                if co[i][0] < bxs[0] or co[i][0] > bxs[-1]:
                    continue
                other = float(np.interp(co[i][0], bxs, bz))
                gap = (co[i][2] - other) * (-sign)
                if 0.0 < gap < max_gap:
                    new[i][2] = co[i][2] + sign * (gap * 0.5 + overlap)
                    moved += 1
    obj.data.vertices.foreach_set("co", new.ravel())
    obj.data.update()
    return moved

"""Stage: levels of detail.

desktop-lod0: the master meshes, with the morph-free limbs of the body decimated (face untouched).
desktop-lod1 and quest: one opaque mesh (skin, clothes, eyes) decimated to budget with the face
region protected. Each part keeps its LOD0 texture coordinates through the decimation (collapse keeps
UV seams); its islands are rescaled (face and eyes denser than cloth) and repacked into one atlas, and
albedo, normal and ORM are transferred from the LOD0 maps through the kept coordinates with emission
and normal bakes of the object's own material. There are no rays between surfaces, so a texel can
neither miss (the grey blotches of the earlier selected-to-active bake) nor pick up the wrong layer.
A thinned card mesh carries hair, beard and brows. No morph targets; the face joints still work.
"""
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Vector

import groom_bake
import lod_head
import textures as tx
from scene import (apply_modifier, array_from_image, image_from_array, resized_image, select_only, strip_color_attributes,
                   triangle_count, vertex_array)

FACE_BONES = ("head", "neck", "face_jaw", "face_eye_l", "face_eye_r", "face_lid_upper_l", "face_lid_upper_r",
              "face_lid_lower_l", "face_lid_lower_r")


def _duplicate(obj, name):
    copy = obj.copy()
    copy.data = obj.data.copy()
    copy.name = name
    copy.data.name = name
    bpy.context.scene.collection.objects.link(copy)
    return copy


def _moving_vertices(obj):
    me = obj.data
    n = len(me.vertices)
    moving = np.zeros(n, dtype=bool)
    if not me.shape_keys:
        return moving
    basis = np.zeros(n * 3)
    me.shape_keys.key_blocks[0].data.foreach_get("co", basis)
    for kb in me.shape_keys.key_blocks[1:]:
        d = np.zeros(n * 3)
        kb.data.foreach_get("co", d)
        moving |= np.abs(d - basis).reshape(-1, 3).max(axis=1) > 1e-6
    return moving


def _dominant(obj):
    names = {g.index: g.name for g in obj.vertex_groups}
    out = []
    for v in obj.data.vertices:
        best = max(((g.weight, names[g.group]) for g in v.groups), default=(0, ""))
        out.append(best[1])
    return out


def _decimate_protected(obj, ratio, protect, protected_weight=0.0):
    """Collapse-decimate; protected vertices get a low weight in the controlling group (0 = untouched)."""
    group = obj.vertex_groups.new(name="_decimate")
    free = [i for i in range(len(obj.data.vertices)) if not protect[i]]
    group.add(free, 1.0, "REPLACE")
    kept = [i for i in range(len(obj.data.vertices)) if protect[i]]
    if protected_weight > 0 and kept:
        group.add(kept, protected_weight, "REPLACE")
    mod = obj.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = ratio
    mod.vertex_group = group.name
    mod.vertex_group_factor = 10.0
    mod.use_collapse_triangulate = False
    apply_modifier(obj, mod)
    obj.vertex_groups.remove(obj.vertex_groups["_decimate"])


def decimate_body_limbs(body, ratio, report, budget=None, others=0):
    """Decimate faces untouched by morphs and away from the head, protecting the seam, then rejoin.
    With a triangle budget for the whole LOD0 (others = triangles of the other LOD0 meshes), the limb ratio
    is lowered when needed so the level fits (never below 0.12)."""
    moving = _moving_vertices(body)
    dom = _dominant(body)
    keep = np.array([moving[i] or dom[i] in FACE_BONES for i in range(len(dom))])
    # grow the kept region by two edge rings so the seam sits away from deforming skin
    edges = np.array([e.vertices[:] for e in body.data.edges])
    for _ in range(2):
        grow = keep.copy()
        grow[edges[keep[edges[:, 0]], 1]] = True
        grow[edges[keep[edges[:, 1]], 0]] = True
        keep = grow
    before = triangle_count(body)
    limbs = _duplicate(body, "BodyLimbs")
    limbs.shape_key_clear()
    for obj, drop_keep in ((body, False), (limbs, True)):
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.verts.ensure_lookup_table()
        doomed = [f for f in bm.faces if all(keep[v.index] for v in f.verts) == drop_keep]
        bmesh.ops.delete(bm, geom=doomed, context="FACES_ONLY")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()
    # protect the limb boundary so it still matches the kept seam exactly
    bm = bmesh.new()
    bm.from_mesh(limbs.data)
    boundary = np.zeros(len(bm.verts), dtype=bool)
    for v in bm.verts:
        boundary[v.index] = v.is_boundary
    bm.free()
    if budget:
        kept = triangle_count(body)
        fit = (budget - others - kept) / max(1, triangle_count(limbs))
        if fit < ratio:
            ratio = max(0.12, fit * 0.985)
    _decimate_protected(limbs, ratio, boundary)
    select_only([body, limbs])
    bpy.ops.object.join()
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()
    report["bodyLimbDecimation"] = {"ratio": ratio, "before": before, "after": triangle_count(body)}


def _simplify_ribbons(obj, passes=1):
    """Halve the segments of every multi-segment hair ribbon instead of deleting whole cards: dissolve every
    other cross edge along each strip (the strip keeps its outline and texture coordinates). Thinning whole long
    cards at the LOD levels left bald patches of painted scalp between the survivors. Returns triangles removed."""
    removed = 0
    for _ in range(passes):
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.faces.ensure_lookup_table()
        before = sum(len(f.verts) - 2 for f in bm.faces)
        seen = set()
        doomed = []
        for f in bm.faces:
            if f.index in seen:
                continue
            interior = [e for e in f.edges if len(e.link_faces) == 2]
            if len(interior) != 1:
                continue  # start only at the end faces of a strip
            order, cur, prev_edge = [], f, None
            while True:
                seen.add(cur.index)
                nxt = [e for e in cur.edges if len(e.link_faces) == 2 and e is not prev_edge]
                if not nxt or len(nxt) > 1:
                    break
                e = nxt[0]
                other = e.link_faces[0] if e.link_faces[1] is cur else e.link_faces[1]
                if other.index in seen:
                    break
                order.append(e)
                prev_edge, cur = e, other
            doomed.extend(order[0::2] if len(order) % 2 else order[1::2])
        if doomed:
            bmesh.ops.dissolve_edges(bm, edges=list(set(doomed)), use_verts=True)
        after = sum(len(f.verts) - 2 for f in bm.faces)
        removed += before - after
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()
    return removed


def _drop_face_wisps(obj, above_eye):
    """Drop the loose wisps that hang beside the face: whole cards lying entirely in front of the ears and below
    `above_eye` metres over the eyes. Alpha-tested at a far level they turn into dark marks on the temples."""
    arm = bpy.data.objects["Rig"]
    eye_z = arm.data.bones["face_eye_l"].head_local.z
    ear_y = arm.data.bones["head"].head_local.y
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    seen, doomed, cards = set(), [], 0
    for f in bm.faces:
        if f.index in seen:
            continue
        comp, stack = [], [f]
        seen.add(f.index)
        while stack:
            g = stack.pop()
            comp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        if all(v.co.z < eye_z + above_eye and v.co.y < ear_y and abs(v.co.x) > 0.03 for g in comp for v in g.verts):
            doomed.extend(comp)
            cards += 1
    if doomed:
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return cards


def _thin_cards(obj, keep_fraction, seed, whole_above=200):
    """Keep about `keep_fraction` of the hair cards, each card (a connected strip of faces) kept or dropped whole;
    a connected piece larger than `whole_above` faces (a cap or shell) is always kept. (Dropping single faces at
    random cut every card into fragments, which read as straw with the painted scalp showing between them.)"""
    if keep_fraction >= 1.0:
        return
    rng = np.random.default_rng(seed)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    comp = np.full(len(bm.faces), -1, dtype=np.int64)
    sizes = []
    for f in bm.faces:
        if comp[f.index] >= 0:
            continue
        n = len(sizes)
        comp[f.index] = n
        stack, size = [f], 0
        while stack:
            g = stack.pop()
            size += 1
            for e in g.edges:
                for h in e.link_faces:
                    if comp[h.index] < 0:
                        comp[h.index] = n
                        stack.append(h)
        sizes.append(size)
    keep = (rng.random(len(sizes)) < keep_fraction) | (np.array(sizes) > whole_above)
    doomed = [f for f in bm.faces if not keep[comp[f.index]]]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def _keep_eyes_only(obj):
    """Drop teeth and tongue from an EyesMouth copy: keep faces skinned to the eye joints."""
    names = {g.index: g.name for g in obj.vertex_groups}
    eye_v = set()
    for v in obj.data.vertices:
        best = max(((g.weight, names[g.group]) for g in v.groups), default=(0, ""))
        if best[1].startswith("face_eye"):
            eye_v.add(v.index)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all(v.index in eye_v for v in f.verts)], context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def _any_selected():
    import bmesh
    for o in bpy.context.objects_in_mode:
        bm = bmesh.from_edit_mesh(o.data)
        if any(f.select for f in bm.faces):
            return True
    return False


def _drop_mouth_cavity(obj, mouth, corners=None, lips_bottom_z=None):
    """Remove the inner mouth behind the lips (invisible at LOD distances; decimating the lips otherwise
    lets the cavity show through). The box is bounded by the real mouth corners and lip heights: the
    jaw-joint midpoint sits inside the head, and a box around it also removed the skin that curves back
    beside and below the lips (a U-shaped hole around the mouth at LOD1 and Quest)."""
    co = vertex_array(obj)
    if corners is not None and lips_bottom_z is not None:
        cl, cr = np.array(corners[0]), np.array(corners[1])
        half_x = min(abs(cl[0]), abs(cr[0])) - 0.003
        z_lo, z_hi = float(lips_bottom_z) + 0.003, float((cl[2] + cr[2]) / 2) + 0.009
    else:
        half_x, z_lo, z_hi = 0.02, mouth.z - 0.012, mouth.z + 0.012
    near = co[(np.abs(co[:, 0]) < 0.012) & (co[:, 2] > z_lo - 0.01) & (co[:, 2] < z_hi + 0.01)]
    if not len(near):
        return
    lip_front = near[:, 1].min()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()

    def inside(f):
        c = f.calc_center_median()
        # bounded in depth too: the nape sits at lip height and its skin faces backward (+Y), and an
        # unbounded box punched a hole there (the red mouth seen through the back of the neck)
        return lip_front + 0.01 < c.y < lip_front + 0.06 and abs(c.x) < half_x and z_lo < c.z < z_hi and f.normal.y > -0.4
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if inside(f)], context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


FACE_REGION = ("head", "face_jaw", "face_eye_l", "face_eye_r", "face_lid_upper_l", "face_lid_upper_r",
               "face_lid_lower_l", "face_lid_lower_r")


def _decimate_weighted(obj, ratio, weights):
    """Collapse-decimate with per-vertex weights (1 = decimate freely, small = keep), triangulated."""
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
    apply_modifier(obj, mod)
    obj.vertex_groups.remove(obj.vertex_groups["_decimate"])


def _keep_only_uv(obj, name):
    me = obj.data
    keep = me.uv_layers.active.name
    for other in [u.name for u in me.uv_layers if u.name != keep]:
        me.uv_layers.remove(me.uv_layers[other])
    me.uv_layers[keep].name = name


def _components(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    seen, comps = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        comp, stack = [], [v]
        seen.add(v.index)
        while stack:
            cur = stack.pop()
            comp.append(cur.index)
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        comps.append(comp)
    bm.free()
    return comps


def _uv_seam_vertices(obj, layer):
    """Vertices on edges whose two faces disagree about the texture coordinates (UV seams)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uvl = bm.loops.layers.uv[layer]
    seam = np.zeros(len(bm.verts), dtype=bool)
    for e in bm.edges:
        if len(e.link_loops) != 2:
            continue
        l1, l2 = e.link_loops
        if (l1[uvl].uv - l2.link_loop_next[uvl].uv).length > 1e-6 or (l1.link_loop_next[uvl].uv - l2[uvl].uv).length > 1e-6:
            seam[e.verts[0].index] = seam[e.verts[1].index] = True
    bm.free()
    return seam


def _snap_strays(obj, source, limit=0.015):
    """Collapse decimation places each merged vertex at its quadric optimum; on thin strips (ties, bands,
    straps) the quadric is nearly singular and the optimum can land far away (a 30 cm spike from the
    spinner's apron tie at the Quest level). Vertices farther than `limit` from the LOD0 source surface
    are moved back onto it. Returns the number of vertices moved."""
    from mathutils.bvhtree import BVHTree
    sme = source.data
    sme.calc_loop_triangles()
    tree = BVHTree.FromPolygons([tuple(v.co) for v in sme.vertices], [t.vertices[:] for t in sme.loop_triangles], all_triangles=True)
    moved = 0
    for v in obj.data.vertices:
        loc, _n, _i, dist = tree.find_nearest(v.co)
        if loc is not None and dist > limit:
            v.co = loc
            moved += 1
    if moved:
        obj.data.update()
    return moved


def _drop_bridges(obj, source, limit=0.025, min_length=0.1, sliver=0.03):
    """Delete decimated faces that bridge open air: a collapse sequence along a thin connected strip can
    leave a needle triangle whose corners all lie on real surfaces (so _snap_strays keeps them) while its
    body spans free space (a 40 cm needle from the spinner's back waist to her forearm at the Quest level).
    A face is a bridge when its centroid or an edge midpoint is farther than `limit` from the LOD0 source
    surface; wire edges left without faces are removed too. Returns the number of faces deleted."""
    from mathutils.bvhtree import BVHTree
    sme = source.data
    sme.calc_loop_triangles()
    tree = BVHTree.FromPolygons([tuple(v.co) for v in sme.vertices], [t.vertices[:] for t in sme.loop_triangles], all_triangles=True)
    bm = bmesh.new()
    bm.from_mesh(obj.data)

    def off_surface(p):
        loc, _n, _i, dist = tree.find_nearest(p)
        return loc is None or dist > limit
    doomed = []
    for f in bm.faces:
        longest = max(e.calc_length() for e in f.edges)
        if longest < min_length or f.calc_area() > sliver * longest * longest:
            continue  # only needles: large legitimate faces of a heavily decimated skirt span curves too
        pts = [f.calc_center_median()] + [(e.verts[0].co + e.verts[1].co) * 0.5 for e in f.edges]
        if any(off_surface(p) for p in pts):
            doomed.append(f)
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    wires = [e for e in bm.edges if not e.link_faces]
    if wires:
        bmesh.ops.delete(bm, geom=wires, context="EDGES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return len(doomed)


def _neck_cut_z(arm):
    """Height of the seam between the proxy head and the decimated body: under the jaw, above the collarbones."""
    neck, head, jaw = (arm.data.bones[n] for n in ("neck", "head", "face_jaw"))
    z_jaw = min(jaw.head_local.z, jaw.tail_local.z)
    return float(max(neck.head_local.z + 0.02, min(z_jaw - 0.012, neck.head_local.z + 0.6 * (head.head_local.z - neck.head_local.z))))


def _bisect(obj, z, keep_above):
    """Cut a mesh at the plane z and keep one side (the cut boundary lies exactly on the plane)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=(0.0, 0.0, z), plane_no=(0.0, 0.0, 1.0),
                           clear_inner=keep_above, clear_outer=not keep_above)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def _project_src_uv(obj, source, layer="SrcUV"):
    """Texture coordinates of the LOD0 skin atlas for a mesh that only lies near the LOD0 skin (the proxy head):
    each corner takes the atlas coordinates of the nearest point on the LOD0 body. A face that spans an atlas seam
    (its corners land on different islands, or on both edges of one island, as along the back of the skull where
    the head island is cut open) takes the island under its centre, and each corner the nearest point among the
    LOD0 triangles of that island lying near the centre in the atlas, so the face samples one side of the seam,
    clamped at its border. (Averaging the corners put such faces between the islands on unbaked grey texels;
    giving a face its centre's coordinate made zero-area faces that baked nothing; and a face across the back
    seam of one island stretched over the whole island and drew a zig-zag streak.)"""
    from mathutils.bvhtree import BVHTree
    from mathutils.geometry import barycentric_transform
    sme = source.data
    sme.calc_loop_triangles()
    s_uv = sme.uv_layers.active.data
    s_co = [v.co.copy() for v in sme.vertices]
    s_co_t = [tuple(c) for c in s_co]
    tris = list(sme.loop_triangles)
    tri_v = np.array([t.vertices[:] for t in tris], dtype=np.int64)
    tree = BVHTree.FromPolygons(s_co_t, tri_v.tolist(), all_triangles=True)
    bm = bmesh.new()
    bm.from_mesh(sme)
    bm.faces.ensure_lookup_table()
    island = _uv_islands(bm, bm.loops.layers.uv[sme.uv_layers.active.name])
    bm.free()
    co_np = np.array([c[:] for c in s_co])
    uv_np = np.zeros((len(s_uv), 2))
    s_uv.foreach_get("uv", uv_np.ravel())
    tri_uv = uv_np[np.array([t.loops[:] for t in tris], dtype=np.int64)]
    tri_xyz = co_np[tri_v]
    e1, e2 = tri_uv[:, 1] - tri_uv[:, 0], tri_uv[:, 2] - tri_uv[:, 0]
    uv_area = 0.5 * np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0])
    xyz_area = 0.5 * np.linalg.norm(np.cross(tri_xyz[:, 1] - tri_xyz[:, 0], tri_xyz[:, 2] - tri_xyz[:, 0]), axis=1)
    density = np.sqrt(uv_area / np.maximum(xyz_area, 1e-12))  # atlas units per metre
    uv_centroid = tri_uv.mean(axis=1)
    tri_island = np.array([int(island[t.polygon_index]) for t in tris])
    me = obj.data
    for name in [u.name for u in me.uv_layers]:
        me.uv_layers.remove(me.uv_layers[name])
    uv = me.uv_layers.new(name=layer).data

    def uv_at(loc, ti):
        t = tris[ti]
        p0, p1, p2 = (s_co[i] for i in t.vertices)
        u0, u1, u2 = (s_uv[l].uv.to_3d() for l in t.loops)
        return barycentric_transform(loc, p0, p1, p2, u0, u1, u2).to_2d()

    def lookup(p):
        loc, _n, ti, _d = tree.find_nearest(p)
        return uv_at(loc, ti), int(tri_island[ti]), ti
    spanning = 0
    for poly in me.polygons:
        corners = [me.vertices[me.loops[l].vertex_index].co.copy() for l in poly.loop_indices]
        hits = [lookup(c) for c in corners]
        span3d = max((a - b).length for a in corners for b in corners)
        _cuv, cisl, cti = lookup(poly.center)
        d = float(np.median([density[h[2]] for h in hits] + [density[cti]]))
        span_uv = max((a[0] - b[0]).length for a in hits for b in hits)
        if len({h[1] for h in hits}) > 1 or span_uv > 2.5 * d * span3d + 1e-4:
            radius = 3.0 * d * span3d + 2e-3
            near = np.where((tri_island == cisl) & (np.linalg.norm(uv_centroid - np.array(_cuv[:]), axis=1) < radius))[0]
            if len(near):
                sub = BVHTree.FromPolygons(s_co_t, tri_v[near].tolist(), all_triangles=True)
                fixed = []
                for c in corners:
                    loc, _n, k, _d = sub.find_nearest(c)
                    fixed.append((uv_at(loc, int(near[k])), cisl, int(near[k])))
                hits = fixed
            spanning += 1
        for l, (q, _isl, _ti) in zip(poly.loop_indices, hits):
            uv[l].uv = q
    obj["seam_faces_flattened"] = spanning


def _bridge_seam(obj, z, head_vertex_count):
    """Join the proxy head to the body at the cut plane without new faces: each body boundary vertex moves onto
    the nearest head boundary edge, that edge is split there, and the coincident vertices are welded, so the
    seam is watertight and conforming. (Bridging the two loops with new faces left a band of thin triangles
    that lit as pale spikes round the neck.) The head's vertices come first in the joined mesh. Returns the
    number of body vertices welded to the head."""
    from mathutils.geometry import intersect_point_line
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    on_plane = lambda v: abs(v.co.z - z) < 2e-4
    head_edges = [e for e in bm.edges if e.is_boundary and all(on_plane(v) and v.index < head_vertex_count for v in e.verts)]
    body_verts = [v for v in bm.verts if v.index >= head_vertex_count and v.is_boundary and on_plane(v)]
    if not head_edges or not body_verts:
        bm.free()
        return 0
    targets = []
    for v in body_verts:
        best = None
        for e in head_edges:
            a, b = e.verts[0].co, e.verts[1].co
            _q, t = intersect_point_line(v.co, a, b)
            t = min(max(t, 0.0), 1.0)
            q = a + (b - a) * t
            d = (q - v.co).length
            if best is None or d < best[0]:
                best = (d, q, t)
        if best[0] < 0.012:
            v.co = best[1]
            if 1e-4 < best[2] < 1 - 1e-4:
                targets.append(best[1].copy())
    for q in targets:  # split the head edge under each moved body vertex so the seam conforms
        for e in head_edges:
            a, b = e.verts[0].co, e.verts[1].co
            ab = b - a
            if ab.length < 1e-9:
                continue
            t = (q - a).dot(ab) / ab.length_squared
            if 1e-4 < t < 1 - 1e-4 and ((a + ab * t) - q).length < 1e-6:
                new_e, new_v = bmesh.utils.edge_split(e, e.verts[0], t)
                new_v.co = q
                head_edges.append(new_e)
                break
    welded = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=[v for v in bm.verts if on_plane(v)], dist=1e-5)
    welded -= len(bm.verts)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return welded


def _eye_part(c, level):
    """LOD eyeballs: the back of each eyeball (never visible) is removed and the front cap, iris and limbus, is
    kept whole while the rest of the sclera is decimated. Decimated freely, the iris ring collapsed and the iris
    texels stretched over the whole visible eye, which read as black voids at LOD1 and Quest."""
    names = {g.index: g.name for g in c.vertex_groups}
    co = vertex_array(c)
    side = np.array([max(((g.weight, names[g.group]) for g in v.groups), default=(0, ""))[1] == "face_eye_l" for v in c.data.vertices])
    angle = np.zeros(len(co))
    for sel in (side, ~side):
        if not sel.any():
            continue
        centre = co[sel].mean(axis=0)
        d = co[sel] - centre
        d /= np.linalg.norm(d, axis=1, keepdims=True) + 1e-12
        angle[sel] = np.degrees(np.arccos(np.clip(-d[:, 1], -1.0, 1.0)))
    bm = bmesh.new()
    bm.from_mesh(c.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(angle[v.index] > level.get("eyeBackDeg", 118.0) for v in f.verts)], context="FACES")
    bm.to_mesh(c.data)
    bm.free()
    c.data.update()
    co = vertex_array(c)
    keep_angle = np.zeros(len(co))
    names = {g.index: g.name for g in c.vertex_groups}
    side = np.array([max(((g.weight, names[g.group]) for g in v.groups), default=(0, ""))[1] == "face_eye_l" for v in c.data.vertices])
    for sel in (side, ~side):
        if not sel.any():
            continue
        centre = co[sel].mean(axis=0)
        d = co[sel] - centre
        d /= np.linalg.norm(d, axis=1, keepdims=True) + 1e-12
        keep_angle[sel] = np.degrees(np.arccos(np.clip(-d[:, 1], -1.0, 1.0)))
    weights = np.where(keep_angle < level.get("irisKeepDeg", 38.0), 0.0, 1.0)
    target = level.get("eyeTriangles", 320)
    if triangle_count(c) > target:
        _decimate_weighted(c, min(1.0, target / max(1, triangle_count(c))), weights)


def _head_part(level, src, cover, prefix, material, z_cut, report_into):
    """The LOD head: MakeHuman's CC0 low-poly proxy head fitted to this body (authored loops round the eyes, nose
    and mouth), cut at the neck seam, given the LOD0 skin atlas coordinates, and settled under head-cloths and
    hoods like the rest of the skin. It is never decimated."""
    proxy = bpy.data.objects.get("HeadProxy")
    if proxy is None:
        return None
    h = _duplicate(proxy, f"{prefix}_Head")
    if h.data.shape_keys:
        h.shape_key_clear()
    for m in list(h.modifiers):
        if m.type != "ARMATURE":
            h.modifiers.remove(m)
    strip_color_attributes(h)
    h.data.materials.clear()
    h.data.materials.append(material)
    target = level.get("headTriangles")
    decimated_to = None
    if target and proxy.get("proxy_source") == "lod0-derived" and triangle_count(h) > target * 1.03:
        # a lighter level keeps the lid and lip loops (and so the face_rig weights and calibration) exactly
        arm = bpy.data.objects["Rig"]
        eyes = bpy.data.objects.get("EyesMouth")
        spheres = {s: (np.array(arm.data.bones[f"face_eye_{s}"].head_local), 0.0152) for s in "lr"}
        head_mid_y = float((arm.data.bones["head"].head_local.y + arm.data.bones["head"].tail_local.y) / 2)
        spec = {"eyeRings": level.get("headEyeRings", 1), "mouthRings": level.get("headMouthRings", 2),
                "faceWeight": level.get("headFaceWeight", 0.3), "skullWeight": level.get("headSkullWeight", 0.55)}
        decimated_to, _r = lod_head.reduce(h, target, lambda o: lod_head.protection_weights(o, arm, spheres, head_mid_y, spec, None)[0])
    _bisect(h, z_cut, keep_above=True)
    _project_src_uv(h, src)
    deleted, sunk = _settle_layers(h, cover, level.get("layerTight", 0.02), level.get("layerLoose", 0.035),
                                   level.get("layerPush", 0.005), wide_deg=50.0)
    report_into["headProxy"] = {"source": proxy.get("proxy_source", ""), "triangles": triangle_count(h),
                                "levelDecimatedTo": decimated_to,
                                "hiddenFacesDeleted": deleted, "verticesSunk": sunk,
                                "atlasSeamSpanningFaces": int(h.get("seam_faces_flattened", 0))}
    return h


def _tongue_part(src, prefix, material, level):
    """A light copy of the LOD0 tongue (round 2): an open mouth at LOD1 and Quest showed an empty cavity behind the
    lower teeth. It takes the low arches' material (the same eyes/mouth atlas) so the level morphs move it with the
    lower arch."""
    if material is None or not level.get("tongue", True):
        return None
    names = {g.index: g.name for g in src.vertex_groups}
    jaw = np.array([max((g.weight for g in v.groups if names[g.group] == "face_jaw"), default=0.0) for v in src.data.vertices])
    tongue_v = (jaw > 0.5) & (jaw < 0.95)  # the tongue is weighted 0.85 to the jaw; the lower teeth 1.0
    if tongue_v.sum() < 20:
        return None
    t = _duplicate(src, f"{prefix}_Tongue")
    if t.data.shape_keys:
        t.shape_key_clear()
    for m in list(t.modifiers):
        if m.type != "ARMATURE":
            t.modifiers.remove(m)
    strip_color_attributes(t)
    _keep_only_uv(t, "SrcUV")
    t.data.materials.clear()
    t.data.materials.append(material)
    lod_head.delete_faces(t, [p.index for p in t.data.polygons if not all(tongue_v[v] for v in p.vertices)])
    target = level.get("tongueTriangles", 70)
    if triangle_count(t) > target:
        _decimate_weighted(t, min(1.0, target / max(1, triangle_count(t))), np.ones(len(t.data.vertices)))
    return t


def _bake_head_normals(obj, source, z_cut, body_mat, normal_img, margin):
    """Bake the LOD0 head (its geometry and its normal map) into the level's normal map over the head skin only, by a
    short-range selected-to-active ray bake (round 2): the decimated head shaded in facets, and the head is skin
    over skin with no garment layer between, so the rays cannot pick up the wrong surface there. Returns the
    number of head faces baked."""
    me = obj.data
    tmp = _duplicate(obj, obj.name + "_HeadBake")
    tme = tmp.data
    if tme.shape_keys:
        tmp.shape_key_clear()
    co = vertex_array(tmp)
    keep = [p.index for p in tme.polygons if tme.materials[p.material_index].name == body_mat.name
            and all(co[v][2] > z_cut + 0.003 for v in p.vertices)]
    lod_head.delete_faces(tmp, [p.index for p in tme.polygons if p.index not in set(keep)])
    if not tmp.data.polygons:
        bpy.data.objects.remove(tmp)
        return 0
    arm = bpy.data.objects["Rig"]
    saved = arm.data.pose_position
    arm.data.pose_position = "REST"
    try:
        tx.bake_selected_to_active([source], tmp, "NORMAL", {body_mat: normal_img}, {"normal_space": "TANGENT"},
                                   samples=4, margin=margin, cage=0.004, reach=0.012)
    finally:
        arm.data.pose_position = saved
    n = len(tmp.data.polygons)
    bpy.data.objects.remove(tmp)
    return n


def _smooth_head_normals(obj, source, z_min, materials):
    """Custom normals for the level's head skin from the LOD0 skin at the nearest point (round 2): the decimated head
    otherwise shades in facets (cheeks, jaw, temples) that the transferred normal map cannot remove."""
    from mathutils.bvhtree import BVHTree
    me = obj.data
    sme = source.data
    sme.calc_loop_triangles()
    sco = vertex_array(source)
    svn = np.zeros(len(sme.vertices) * 3)
    sme.vertices.foreach_get("normal", svn)
    svn = svn.reshape(-1, 3)
    tris = [t for t in sme.loop_triangles if max(sco[v][2] for v in t.vertices) > z_min - 0.02]
    tv = np.array([t.vertices[:] for t in tris], dtype=np.int64)
    tree = BVHTree.FromPolygons([tuple(c) for c in sco], tv.tolist(), all_triangles=True)
    body_mat = materials["Body"].name
    co = vertex_array(obj)
    vn = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get("normal", vn)
    vn = vn.reshape(-1, 3)
    loops_v = np.zeros(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", loops_v)
    target = {}
    for p in me.polygons:
        if me.materials[p.material_index].name != body_mat:
            continue
        for vi in loops_v[p.loop_start:p.loop_start + p.loop_total]:
            if vi in target or co[vi][2] < z_min:
                continue
            best = None
            for loc, _n, ti, d in tree.find_nearest_range(Vector(co[vi]), 0.01):
                a, b, c = sco[tv[ti]]
                n = np.cross(b - a, c - a)
                n /= np.linalg.norm(n) + 1e-12
                if n @ vn[vi] < 0.2:
                    continue
                if best is None or d < best[0]:
                    best = (d, loc, ti)
            if best is None:
                continue
            _d, loc, ti = best
            a, b, c = sco[tv[ti]]
            w = groom_bake._bary(np.asarray(loc), a, b, c)
            n = w @ svn[tv[ti]]
            target[vi] = n / (np.linalg.norm(n) + 1e-12)
    if not target:
        return 0
    cn = np.array([c.vector[:] for c in me.corner_normals])
    for li, vi in enumerate(loops_v):
        t = target.get(int(vi))
        if t is not None:
            cn[li] = t
    me.normals_split_custom_set(cn.tolist())
    return len(target)


def _cavity_part(level, src, prefix, material, head):
    """The mouth bag of the LOD0 skin (flagged 'crownfall_mouth_bag' in the body stage), decimated, as the LOD's oral
    cavity: the LOD0-derived head ends at the inner lip ring (face_rig needs that loop), and without the bag an open
    mouth showed light-grey flat panels and the back of the head. Its texels are the LOD0 skin's darkened mouth.
    The ring that meets the lips takes the head's (face_rig-authored) weights so both follow the jaw together."""
    flags = lod_head.face_flags(src, "crownfall_mouth_bag")
    if not flags.any():
        return None
    c = _duplicate(src, f"{prefix}_Cavity")
    if c.data.shape_keys:
        c.shape_key_clear()
    for m in list(c.modifiers):
        if m.type != "ARMATURE":
            c.modifiers.remove(m)
    strip_color_attributes(c)
    _keep_only_uv(c, "SrcUV")
    c.data.materials.clear()
    c.data.materials.append(material)
    lod_head.delete_faces(c, np.where(~flags)[0].tolist())
    rim = np.zeros(len(c.data.vertices), dtype=bool)
    for loop in lod_head.boundary_loops(c):
        rim[loop] = True
    # the inner lip surfaces next to the rim stay whole: decimated, the upper and lower ones no longer met at rest and
    # the teeth showed through the slit between the closed lips
    keep = rim.copy()
    for ring in lod_head.rings(c, np.where(rim)[0], level.get("cavityLipRings", 3))[1:]:
        keep[list(ring)] = True
    target = level.get("cavityTriangles", 160)
    if triangle_count(c) > target:
        _decimate_weighted(c, min(1.0, target / max(1, triangle_count(c))), np.where(keep, 0.0, 1.0))
    # weights: the rim and the skin next to it copy the nearest head vertex (lips), fading to the bag's own deeper in
    from mathutils.kdtree import KDTree
    hco = vertex_array(head)
    kd = KDTree(len(hco))
    for i, p in enumerate(hco):
        kd.insert(p, i)
    kd.balance()
    hw = lod_head.weights_of_obj(head)
    cw = lod_head.weights_of_obj(c)
    cco = vertex_array(c)
    out = []
    for i, p in enumerate(cco):
        _q, j, d = kd.find(p)
        t = float(np.clip(1.0 - (d - 0.002) / 0.012, 0.0, 1.0))
        acc = {k: v * (1.0 - t) for k, v in cw[i].items()}
        for k, v in hw[j].items():
            acc[k] = acc.get(k, 0.0) + v * t
        out.append(acc)
    lod_head.write_weights(c, out)
    return c


def _decimated_parts(level, sources, prefix, eyes, mouth, head_mid_y, ratio, materials, settled, repaired, strays, bridges):
    """Decimated copies of Body, Clothes and the eyeballs that keep their LOD0 UVs as 'SrcUV'."""
    parts = []
    cover = _ClothCover(next(s for s in sources if s.name == "Clothes"), level.get("coverMinArea", 0.035))
    for src in sources:
        c = _duplicate(src, f"{prefix}_{src.name}")
        if c.data.shape_keys:
            c.shape_key_clear()
        for m in list(c.modifiers):
            if m.type != "ARMATURE":
                c.modifiers.remove(m)
        strip_color_attributes(c)
        _keep_only_uv(c, "SrcUV")
        c.data.materials.clear()
        c.data.materials.append(materials[src.name])
        # weld coincident duplicates (generated tubes and panels close their seams with separate vertices):
        # decimated separately, the two sides of such a seam open into cracks
        bm = bmesh.new()
        bm.from_mesh(c.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
        bm.to_mesh(c.data)
        bm.free()
        c.data.update()
        if src.name == "EyesMouth":
            tongue = _tongue_part(src, prefix, materials.get("TeethLow"), level)
            _keep_eyes_only(c)
            _eye_part(c, level)
            parts.append((src, c))
            if tongue is not None:
                parts.append((src, tongue))
            continue
        if src.name == "TeethLow":  # authored low arches and the throat occluder, kept whole
            parts.append((src, c))
            continue
        z_cut = _neck_cut_z(bpy.data.objects["Rig"])
        if src.name == "Body" and level.get("proxyHead", True) and "HeadProxy" in bpy.data.objects:
            _bisect(c, z_cut, keep_above=False)
        elif src.name == "Body":
            _drop_mouth_cavity(c, mouth, src.get("mouth_corners"), src.get("lips_bottom_z"))
        settled[src.name] = _settle_layers(c, cover, level.get("layerTight", 0.02), level.get("layerLoose", 0.035),
                                           level.get("layerPush", 0.005) if src.name == "Body" else level.get("clothLayerPush", 0.008),
                                           same_faces_as_cover=src.name == "Clothes",
                                           # skin also needs the wide rays (holes under narrow collars show); cloth under
                                           # cloth moves with its cover, so the narrow cone is enough there
                                           wide_deg=50.0 if src.name == "Body" else 0.0)
        co = vertex_array(c)
        weights = np.ones(len(co))
        if src.name == "Body":
            dom = _dominant(c)
            head = np.array([d in FACE_REGION for d in dom])
            face = head & (co[:, 1] < head_mid_y)
            weights[head] = level.get("headBackWeight", 0.3)  # the skull's silhouette (a flat facet behind the ears otherwise)
            weights[face] = level.get("headWeight", 0.2)
        else:
            head_c = np.array([0.0, head_mid_y, (eyes[0].z + eyes[1].z) / 2 + 0.03])
            weights[np.linalg.norm(co - head_c, axis=1) < level.get("headClothRadius", 0.16)] = level.get("headClothWeight", 0.35)
        near = np.zeros(len(co), dtype=bool)
        for e in eyes:
            near |= np.linalg.norm(co - np.array(e), axis=1) < level.get("eyeProtect", 0.028)
        near |= np.linalg.norm(co - np.array(mouth), axis=1) < level.get("mouthProtect", 0.045)
        # thin loose parts (straps, belt, pouch, rolls) collapse into slivers: keep them whole
        for comp in _components(c):
            if len(comp) < level.get("loosePartVertices", 450):
                near[comp] = True
        weights[near] = np.minimum(weights[near], level.get("protectedWeight", 0.3))
        grid = c.data.attributes.get("crownfall_keep_uv")
        if grid is not None and grid.domain == "FACE":
            # generated capes and shawls hang a little off the layer beneath: decimated like the rest, the
            # spinner's shawl cut chords through the curve of her back and her overdress showed through
            flags = np.zeros(len(c.data.polygons), dtype=np.int32)
            grid.data.foreach_get("value", flags)
            on_grid = np.zeros(len(co), dtype=bool)
            for poly in c.data.polygons:
                if flags[poly.index]:
                    on_grid[list(poly.vertices)] = True
            weights[on_grid] = np.minimum(weights[on_grid], level.get("gridWeight", 0.3))
        if src.name == "Clothes":
            # collars and hems: keep the boundary loops, which collapsed into pale shards at LOD1 and Quest
            bm_b = bmesh.new()
            bm_b.from_mesh(c.data)
            edge_b = np.zeros(len(bm_b.verts), dtype=bool)
            for v in bm_b.verts:
                edge_b[v.index] = v.is_boundary
            bm_b.free()
            weights[edge_b] = np.minimum(weights[edge_b], level.get("clothBoundaryWeight", 0.05))
        if src.name == "Body":
            # skin has few UV islands: keep their seams, so no decimated triangle can span two islands of
            # the skin atlas (the red and grey triangles at the nape of the first transfer builds)
            seam = _uv_seam_vertices(c, "SrcUV")
            weights[seam] = np.minimum(weights[seam], level.get("seamWeight", 0.04))
            # the neck seam must stay exactly on the cut plane for the bridge to the proxy head
            weights[np.abs(co[:, 2] - z_cut) < 2e-4] = 0.0
        _decimate_weighted(c, ratio, weights)
        strays[src.name] = _snap_strays(c, src, level.get("strayLimit", 0.015))
        bridges[src.name] = _drop_bridges(c, src, level.get("bridgeLimit", 0.025))
        # cloth islands share one texel density (averaged at LOD0), so a tighter outlier limit is safe there
        repaired[src.name] = _repair_seam_crossings(c, src, ratio_limit=5.0 if src.name == "Body" else 3.0)
        if src.name == "Body" and level.get("proxyHead", True) and "HeadProxy" in bpy.data.objects:
            head_info = settled.setdefault("_head", {})
            h = _head_part(level, src, cover, prefix, materials["Body"], z_cut, head_info)
            if h is not None:
                head_count = len(h.data.vertices)
                body_name = c.name
                select_only([h, c])
                bpy.context.view_layer.objects.active = h  # the head's vertices come first in the joined mesh
                bpy.ops.object.join()
                joined = bpy.context.view_layer.objects.active
                joined.name = body_name
                joined.data.name = body_name
                c = joined
                head_info["seamVerticesWelded"] = _bridge_seam(c, z_cut, head_count)
                cav = _cavity_part(level, src, prefix, materials["Body"], c)
                if cav is not None:
                    head_info["cavityTriangles"] = triangle_count(cav)
                    select_only([c, cav])
                    bpy.ops.object.join()
                    c = bpy.context.view_layer.objects.active
                    c.name = c.data.name = body_name
        parts.append((src, c))
    return parts


class _ClothCover:
    """Rest-pose BVH of the LOD0 clothes with the connected piece of every triangle (no modifiers: the
    armature may hold a clip pose). Only broad pieces (garments, aprons, head-cloths: one side of at
    least min_area square metres) count as covers: a garment's own folded hem, a separate edging band,
    straps and belts never hide what lies under them."""

    def __init__(self, obj, min_area=0.035):
        from mathutils.bvhtree import BVHTree
        me = obj.data
        me.calc_loop_triangles()
        self.tree = BVHTree.FromPolygons([tuple(v.co) for v in me.vertices], [t.vertices[:] for t in me.loop_triangles], all_triangles=True)
        self.tri_poly = np.array([t.polygon_index for t in me.loop_triangles])
        parent = list(range(len(me.vertices)))

        def find(a):
            root = a
            while parent[root] != root:
                root = parent[root]
            while parent[a] != root:
                parent[a], a = root, parent[a]
            return root
        for e in me.edges:
            a, b = find(e.vertices[0]), find(e.vertices[1])
            if a != b:
                parent[a] = b
        self.poly_piece = np.array([find(p.vertices[0]) for p in me.polygons])
        areas = np.array([p.area for p in me.polygons])
        # double-sided rims and folds count the area twice at most; halve to approximate one side
        self.big = {int(k) for k in np.unique(self.poly_piece) if areas[self.poly_piece == k].sum() * 0.5 >= min_area}

    def covers(self, tri_index, own_piece):
        piece = int(self.poly_piece[self.tri_poly[tri_index]])
        return piece in self.big and piece != own_piece


def _settle_layers(obj, cover, tight=0.02, loose=0.035, push=0.005, tilt_deg=25.0, wide_deg=50.0, same_faces_as_cover=False):
    """Hidden-layer handling before decimation. Each face casts rays outward (its normal, four tilted by
    tilt_deg and, when wide_deg is set, four more by wide_deg); a hit counts when it lands on another
    whole garment facing the same way. Faces whose rays all hit within `tight` lie under a broad
    close-fitting layer and are deleted (wide rays keep skin under a narrow collar); faces whose
    normal ray hits within `loose` sink by `push` along the vertex normals. Decimating the layers
    separately otherwise lets inner cloth and skin poke through outer layers as large wedges (the first
    transfer build of the spinner showed the underdress and shawl through the overdress)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()
    tilt, wide = math.radians(tilt_deg), (math.radians(wide_deg) if wide_deg else 0.0)
    doomed, sink = [], set()
    for f in bm.faces:
        n = f.normal
        if n.length < 0.5:
            continue
        own = int(cover.poly_piece[f.index]) if same_faces_as_cover else -1
        c = f.calc_center_median() + n * 0.0015
        t = n.orthogonal().normalized()
        b = n.cross(t)
        dirs = [n] + [(n * math.cos(a) + v * math.sin(a)).normalized() for a in ((tilt, wide) if wide else (tilt,)) for v in (t, -t, b, -b)]
        close, normal_hit = 0, False
        for k, d in enumerate(dirs):
            loc, hn, tri, dist = cover.tree.ray_cast(c, d, loose)
            if loc is None or hn.dot(n) < 0.4 or not cover.covers(tri, own):
                continue
            if k == 0:
                normal_hit = True
            if dist < tight:
                close += 1
        if close == len(dirs):
            doomed.append(f)
        elif normal_hit:
            sink.update(v.index for v in f.verts)
    bm.verts.ensure_lookup_table()
    for i in sink:
        v = bm.verts[i]
        v.co -= v.normal * push
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return len(doomed), len(sink)


def _pieces(me):
    """Connected-piece id of every vertex (union-find over edges)."""
    parent = list(range(len(me.vertices)))

    def find(a):
        root = a
        while parent[root] != root:
            root = parent[root]
        while parent[a] != root:
            parent[a], a = root, parent[a]
        return root
    for e in me.edges:
        a, b = find(e.vertices[0]), find(e.vertices[1])
        if a != b:
            parent[a] = b
    return np.array([find(i) for i in range(len(me.vertices))])


def _repair_seam_crossings(obj, source, layer="SrcUV", ratio_limit=5.0):
    """Collapse decimation occasionally merges vertices across a UV seam; such a triangle then spans two
    distant islands of the LOD0 atlas and samples whatever lies between them (a red mouth texel at the
    nape, grey atlas fill on the neck). A triangle is repaired only when both tests agree: its corners
    lie over LOD0 triangles of different UV islands, and one of its edges is far longer in texture space
    per metre than the part's median. Either test alone failed: the edge-length test also flagged
    stretched eyelid triangles inside one island (pale patches under the smith's eyes), and the island
    test alone flagged about half of every decimated garment, whose large triangles routinely span two
    neighbouring islands, and re-mapped them into atlas fill (pale blotches on the LOD1 tunics). Repair
    gives the corners the coordinates of the LOD0 triangle under the centre, from the same garment piece
    (the nearest triangle of another layer would paint the undershirt onto the tunic), extrapolated
    within that triangle's island. Returns the number of triangles repaired."""
    from mathutils.bvhtree import BVHTree
    from mathutils.geometry import barycentric_transform
    from mathutils.kdtree import KDTree
    sme = source.data
    sme.calc_loop_triangles()
    s_uv = sme.uv_layers.active.data
    s_co = [v.co.copy() for v in sme.vertices]
    tris = list(sme.loop_triangles)
    bm = bmesh.new()
    bm.from_mesh(sme)
    bm.faces.ensure_lookup_table()
    island_of_poly = _uv_islands(bm, bm.loops.layers.uv[sme.uv_layers.active.name])
    bm.free()
    s_piece = _pieces(sme)
    by_piece = {}
    for t in tris:
        by_piece.setdefault(int(s_piece[t.vertices[0]]), []).append(t)
    trees = {k: (BVHTree.FromPolygons([tuple(c) for c in s_co], [t.vertices[:] for t in ts], all_triangles=True), ts)
             for k, ts in by_piece.items()}
    kd = KDTree(len(s_co))
    for i, c in enumerate(s_co):
        kd.insert(c, i)
    kd.balance()
    me = obj.data
    uv = me.uv_layers[layer].data
    co = [v.co.copy() for v in me.vertices]
    c_piece = _pieces(me)
    piece_of = {}
    for comp in np.unique(c_piece):
        members = np.where(c_piece == comp)[0][:7]
        votes = [int(s_piece[kd.find(co[int(i)])[1]]) for i in members]
        piece_of[int(comp)] = max(set(votes), key=votes.count)
    ratios = []
    for p in me.polygons:
        ls = list(range(p.loop_start, p.loop_start + p.loop_total))
        worst = 0.0
        for k in range(len(ls)):
            a, b = ls[k], ls[(k + 1) % len(ls)]
            d3 = (co[me.loops[a].vertex_index] - co[me.loops[b].vertex_index]).length
            worst = max(worst, (uv[a].uv - uv[b].uv).length / max(d3, 1e-6))
        ratios.append(worst)
    if not ratios:
        return 0
    limit = float(np.median(ratios)) * ratio_limit
    fixed = 0
    for p in me.polygons:
        if ratios[p.index] <= limit:
            continue
        tree, ts = trees[piece_of[int(c_piece[p.vertices[0]])]]
        islands = set()
        for vi in p.vertices:
            hit = tree.find_nearest(co[vi])
            if hit[0] is not None:
                islands.add(int(island_of_poly[ts[hit[2]].polygon_index]))
        if len(islands) <= 1:
            continue
        ls = list(range(p.loop_start, p.loop_start + p.loop_total))
        centre = sum((co[me.loops[l].vertex_index] for l in ls), Vector()) / len(ls)
        loc, _n, ti, _d = tree.find_nearest(centre)
        if loc is None:
            continue
        t = ts[ti]
        p0, p1, p2 = (s_co[i] for i in t.vertices)
        if (p1 - p0).cross(p2 - p0).length < 1e-9:
            continue  # degenerate source triangle: no affine mapping
        u0, u1, u2 = (s_uv[l].uv.to_3d() for l in t.loops)
        lo = Vector((min(u0.x, u1.x, u2.x), min(u0.y, u1.y, u2.y))) - Vector((0.02, 0.02))
        hi = Vector((max(u0.x, u1.x, u2.x), max(u0.y, u1.y, u2.y))) + Vector((0.02, 0.02))
        new_uv = []
        for l in ls:
            x = co[me.loops[l].vertex_index]
            q = barycentric_transform(x, p0, p1, p2, u0, u1, u2).to_2d()
            if not (math.isfinite(q.x) and math.isfinite(q.y)):
                break
            new_uv.append(Vector((min(max(q.x, lo.x), hi.x), min(max(q.y, lo.y), hi.y))))
        else:
            for l, q in zip(ls, new_uv):
                uv[l].uv = q
            fixed += 1
    return fixed


def _transfer_material(name, albedo, normal, orm, normal_strength=1.0):
    """Bake-time material that reads the LOD0 maps through the kept 'SrcUV' coordinates. The normal
    detail can be weakened: pores and wrinkles that read at conversation range turn into blotches when
    the level's smaller map is viewed from farther away."""
    mat = bpy.data.materials.new(name)
    n = tx.Nodes(mat)
    uv = n.uv("SrcUV")
    a = n.image(albedo, uv)
    a.name = "XFER_ALBEDO"
    o = n.image(orm, uv)
    o.name = "XFER_ORM"
    n.link(a.outputs["Color"], n.bsdf.inputs["Base Color"])
    n.bsdf.inputs["Emission Strength"].default_value = 1.0
    if normal is not None:
        t = n.image(normal, uv)
        nm = n.new("ShaderNodeNormalMap", space="TANGENT", uv_map="SrcUV")
        nm.inputs["Strength"].default_value = normal_strength
        n.link(t.outputs["Color"], nm.inputs["Color"])
        n.link(nm.outputs["Normal"], n.bsdf.inputs["Normal"])
    return mat


def _emit_from(mat, node_name):
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    for link in list(bsdf.inputs["Emission Color"].links):
        nt.links.remove(link)
    nt.links.new(nt.nodes[node_name].outputs["Color"], bsdf.inputs["Emission Color"])


def _load(out_dir, name, colorspace):
    img = bpy.data.images.load(os.path.join(out_dir, "textures", name + ".png"), check_existing=False)
    img.colorspace_settings.name = colorspace
    return img


def _uv_islands(bm, uvl):
    parent = list(range(len(bm.faces)))

    def find(a):
        root = a
        while parent[root] != root:
            root = parent[root]
        while parent[a] != root:
            parent[a], a = root, parent[a]
        return root
    for e in bm.edges:
        if len(e.link_loops) != 2:
            continue
        l1, l2 = e.link_loops
        if (l1[uvl].uv - l2.link_loop_next[uvl].uv).length < 1e-7 and (l1.link_loop_next[uvl].uv - l2[uvl].uv).length < 1e-7:
            a, b = find(l1.face.index), find(l2.face.index)
            if a != b:
                parent[a] = b
    return np.array([find(f.index) for f in bm.faces])


def _scale_islands(obj, face_class, density, layer="UVMap"):
    """Rescale every UV island to its class's texel density (area per square metre, relative): the face
    and the eyes get more of the atlas than cloth and hands. Returns the island count."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    uvl = bm.loops.layers.uv[layer]
    roots = _uv_islands(bm, uvl)
    uv_area = np.zeros(len(bm.faces))
    area3 = np.zeros(len(bm.faces))
    for f in bm.faces:
        pts = [l[uvl].uv.copy() for l in f.loops]
        a2 = 0.0
        for k in range(1, len(pts) - 1):
            d1, d2 = pts[k] - pts[0], pts[k + 1] - pts[0]
            a2 += abs(d1.x * d2.y - d1.y * d2.x) * 0.5
        uv_area[f.index] = a2
        area3[f.index] = f.calc_area()
    for root in np.unique(roots):
        faces = np.where(roots == root)[0]
        a3 = area3[faces].sum()
        a2 = uv_area[faces].sum()
        if a3 <= 1e-10 or a2 <= 1e-12:
            continue
        classes = face_class[faces]
        share = {c: area3[faces][classes == c].sum() / a3 for c in set(classes)}
        # the head island of the skin atlas holds the scalp too: at 30 percent it never qualified and the LOD faces
        # got cloth density (painted brows a few texels wide, washed out to tan)
        cls = "face" if share.get("face", 0.0) >= 0.15 else max(share, key=share.get)
        k = min(max(math.sqrt(density[cls] * a3 / a2), 0.02), 50.0)
        loops = [l for fi in faces for l in bm.faces[fi].loops]
        centre = sum((l[uvl].uv for l in loops), Vector((0.0, 0.0))) / len(loops)
        for l in loops:
            l[uvl].uv = centre + (l[uvl].uv - centre) * k
    bm.to_mesh(me)
    bm.free()
    me.update()
    return int(len(np.unique(roots)))


def _uv_usage(obj, layer="UVMap"):
    me = obj.data
    uv = np.zeros(len(me.loops) * 2)
    me.uv_layers[layer].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    total = 0.0
    for p in me.polygons:
        pts = uv[p.loop_start:p.loop_start + p.loop_total]
        for k in range(1, len(pts) - 1):
            d1, d2 = pts[k] - pts[0], pts[k + 1] - pts[0]
            total += abs(d1[0] * d2[1] - d1[1] * d2[0]) * 0.5
    return total


def build_level(level, sources, groom, report, out_dir):
    lid = level["id"]
    prefix = level["prefix"]
    arm = bpy.data.objects["Rig"]
    eyes = [Vector(arm.data.bones[n].head_local) for n in ("face_eye_l", "face_eye_r")]
    jaw = arm.data.bones["face_jaw"]
    mouth = (Vector(jaw.head_local) + Vector(jaw.tail_local)) * 0.5
    head = arm.data.bones["head"]
    head_mid_y = float((head.head_local.y + head.tail_local.y) / 2)
    # transfer materials read the LOD0 maps (full resolution files from the textures stage)
    skin_alb = "skin_albedo_lod" if os.path.exists(os.path.join(out_dir, "textures", "skin_albedo_lod.png")) else "skin_albedo"
    maps = {"Body": (skin_alb, "skin_normal", "skin_orm"), "Clothes": ("cloth_albedo", "cloth_normal", "cloth_orm"),
            "EyesMouth": ("eyes_mouth_albedo", None, "eyes_mouth_orm"), "TeethLow": ("eyes_mouth_albedo", None, "eyes_mouth_orm")}
    materials = {}
    for name, (alb, nrm, orm) in maps.items():
        strength = level.get("skinNormalStrength", 0.6) if name == "Body" else level.get("clothNormalStrength", 0.85)
        materials[name] = _transfer_material(f"{prefix}_xfer_{name}", _load(out_dir, alb, "sRGB"),
                                             _load(out_dir, nrm, "Non-Color") if nrm else None, _load(out_dir, orm, "Non-Color"), strength)
    budget = level["opaqueTriangles"]
    total_src = sum(triangle_count(o) for o in sources if o.name not in ("EyesMouth", "TeethLow"))
    ratio = min(1.0, (budget - level.get("eyeTriangles", 240)) / max(1, total_src - 1300))
    settled, repaired, strays, bridges = {}, {}, {}, {}
    for attempt in range(5):
        parts = _decimated_parts(level, sources, prefix, eyes, mouth, head_mid_y, ratio, materials, settled, repaired, strays, bridges)
        total = sum(triangle_count(p[1]) for p in parts)
        if abs(total - budget) <= budget * 0.02 or attempt == 4:
            break
        for _s, part in parts:
            bpy.data.objects.remove(part)
        ratio = min(1.0, ratio * budget / total)
    part_tris = {src.name: triangle_count(part) for src, part in parts}
    select_only([p[1] for p in parts])
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = obj.data.name = f"{prefix}Body"
    me = obj.data
    # per-face class for the texel densities: eyes, cloth, face (front of the head), other skin
    mat_class = {materials["Body"].name: "skin", materials["Clothes"].name: "cloth", materials["EyesMouth"].name: "eyes",
                 materials["TeethLow"].name: "eyes"}
    dom = _dominant(obj)
    co = vertex_array(obj)
    face_v = np.array([d in FACE_REGION for d in dom]) & (co[:, 1] < head_mid_y)
    face_class = []
    for p in me.polygons:
        cls = mat_class[me.materials[p.material_index].name]
        if cls == "skin" and all(face_v[v] for v in p.vertices):
            cls = "face"
        face_class.append(cls)
    face_class = np.array(face_class)
    sealed = lod_head.seal_lips(obj, arm) if level.get("sealLips", True) else 0
    morph_info = _level_morphs(obj, sources, materials, level)
    morph_info["lipVerticesSealed"] = sealed
    body_src = next((src for src in sources if src.name == "Body"), None)
    smoothed = 0
    if level.get("headNormals") == "custom" and body_src is not None:
        smoothed = _smooth_head_normals(obj, body_src, _neck_cut_z(arm) - 0.005, materials)
    me.uv_layers.new(name="UVMap", do_init=True)
    me.uv_layers.active = me.uv_layers["UVMap"]
    me.uv_layers["UVMap"].active_render = True
    density = {"cloth": 1.0, "skin": level.get("skinDensity", 1.0), "face": level.get("faceDensity", 4.0), "eyes": level.get("eyeDensity", 3.0)}
    islands = _scale_islands(obj, face_class, density)
    uv_flat = np.zeros(len(me.loops) * 2)
    me.uv_layers["UVMap"].data.foreach_get("uv", uv_flat)
    bad = ~np.isfinite(uv_flat)
    if bad.any():  # the packer crashes on non-finite coordinates
        uv_flat[bad] = 0.0
        me.uv_layers["UVMap"].data.foreach_set("uv", uv_flat)
    select_only([obj])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin=level.get("packMargin", 0.004), scale=True)
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.uv.select_overlap()
    overlaps = sum(1 for f in bmesh.from_edit_mesh(obj.data).faces if f.select)
    bpy.ops.object.mode_set(mode="OBJECT")
    usage = _uv_usage(obj)
    size, aux = level["albedoSize"], level["auxSize"]
    margin = level.get("bakeMargin", 6)
    mats = list(materials.values())
    albedo = tx.new_target(f"{prefix}_albedo", size, "sRGB", (0.5, 0.5, 0.5, 1))
    for m in mats:
        _emit_from(m, "XFER_ALBEDO")
    tx.bake([obj], "EMIT", {m: albedo for m in mats}, samples=level.get("transferSamples", 8), margin=margin)
    normal = tx.new_target(f"{prefix}_normal", aux, "Non-Color", (0.5, 0.5, 1, 1))
    tx.bake([obj], "NORMAL", {m: normal for m in mats}, samples=level.get("transferSamples", 8), margin=margin, normal_space="TANGENT")
    head_baked = 0
    if level.get("headNormals", "bake") == "bake" and body_src is not None:
        head_baked = _bake_head_normals(obj, body_src, _neck_cut_z(arm), materials["Body"], normal, margin)
    flattened = tx.flatten_normal_outliers(normal, 0.35, 0.55)
    orm_full = tx.new_target(f"{prefix}_orm_full", aux, "Non-Color", (1.0, 0.6, 0.0, 1))
    for m in mats:
        _emit_from(m, "XFER_ORM")
    tx.bake([obj], "EMIT", {m: orm_full for m in mats}, samples=level.get("transferSamples", 8), margin=margin)
    orm = resized_image(orm_full, level.get("ormSize", aux), f"{prefix}_orm", "Non-Color")
    files = []
    for key, img in (("albedo", albedo), ("normal", normal), ("orm", orm)):
        path = os.path.join(out_dir, "textures", f"{prefix.lower()}_{key}.png")
        tx.save_png(img, path)
        files.append(path)
    me.uv_layers.remove(me.uv_layers["SrcUV"])
    me.materials.clear()
    me.materials.append(tx.final_material(f"{prefix.lower()}_body", albedo, orm, normal, double_sided=True))
    obj["crownfall_part"] = f"{lid}-body"
    # hair: thinned cards with a downsized strand atlas; the cards keep the LOD0 groom's face morphs (they were
    # transferred from the skin), so a fringe or a beard card follows the face at this level too
    hair = _duplicate(groom, f"{prefix}Hair")
    if hair.data.shape_keys and not level.get("morphs", True):
        hair.shape_key_clear()
    kind = hair.data.attributes.get("groom_kind")
    if kind is not None and kind.domain == "FACE":
        vals = np.zeros(len(hair.data.polygons), dtype=np.int32)
        kind.data.foreach_get("value", vals)
        bm = bmesh.new()
        bm.from_mesh(hair.data)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in np.where(vals >= 2)[0]], context="FACES")
        bm.to_mesh(hair.data)
        bm.free()
        hair.data.update()
    ribbon_tris = _simplify_ribbons(hair, level.get("ribbonPasses", 1))
    wisps = _drop_face_wisps(hair, level["dropFaceWisps"]) if level.get("dropFaceWisps") else 0
    _thin_cards(hair, level["cardFraction"], 17)
    cutoff = level.get("hairAlphaCutoff", 0.35)
    hair_tris = triangle_count(hair)
    if not hair.data.polygons:  # cropped hair at a far level: the painted scalp and beard shadow carry it
        bpy.data.objects.remove(hair)
        hair = None
    else:
        strands = groom.data.materials[0].node_tree.nodes
        atlas_img = next(n.image for n in strands if n.type == "TEX_IMAGE")
        small = _coverage_preserving(atlas_img, level["hairSize"], f"{prefix.lower()}_strands", cutoff,
                                     boost=level.get("hairCoverageBoost", 1.0), flatten=level.get("hairToneFlatten", 0.0))
        hair.data.materials.clear()
        # alpha-tested (glTF MASK, depth-writing, no sorting) MeshStandardMaterial hair: the blended hair with a
        # specular extension made three.js use a physical material with depth writes off, and cards sorted badly
        hair.data.materials.append(tx.final_material(f"{prefix.lower()}_hair", small, alpha=True, alpha_cutoff=cutoff, double_sided=True,
                                                     vertex_colour=level.get("hairVertexColour", True),
                                                     roughness=level.get("hairRoughness", 0.78), specular=0.5))
        hair["crownfall_part"] = f"{lid}-hair"
    report.setdefault("lods", {})[lid] = {"opaqueTriangles": triangle_count(obj), "hairTriangles": hair_tris,
                                         "hairRibbonTrianglesRemoved": ribbon_tris, "faceWispCardsDropped": wisps,
                                         "partTriangles": part_tris, "decimationRatio": round(ratio, 4),
                                         "hiddenLayerFacesDeleted": {k: v[0] for k, v in settled.items() if k != "_head"},
                                         "head": settled.get("_head", {}),
                                         "seamCrossingTrianglesRepaired": dict(repaired),
                                         "strayVerticesSnapped": dict(strays),
                                         "bridgeFacesDeleted": dict(bridges),
                                         "innerLayerVerticesSunk": {k: v[1] for k, v in settled.items() if k != "_head"},
                                         "faceMorphs": morph_info, "headNormalsFromLod0": smoothed, "headNormalBakeFaces": head_baked,
                                         "uvIslands": islands, "uvUsage": round(usage, 3), "uvOverlapFaces": overlaps,
                                         "normalTexelsFlattened": flattened, "textures": [os.path.basename(f) for f in files],
                                         "texelDensity": density,
                                         "transfer": "LOD0 UVs kept through decimation; islands rescaled and repacked; emission and "
                                                     "normal bakes of the object's own material (no ray transfer)"}
    return obj, hair


def _level_morphs(obj, sources, materials, level):
    """Face morphs for an LOD level (round 2): the skin (head and cavity) takes the LOD0 skin's ARKit and viseme
    deltas through a nearest-surface transfer with a normal check (the kept lid and lip loops are LOD0 vertices, so
    blink closes the eyes exactly as LOD0 does); the low dental arches follow the LOD0 arches rigidly. With
    morphs the shared face-rig adapters drive blink, visemes and expressions by morph at this level too."""
    if not level.get("morphs", True):
        return {"enabled": False}
    body = next((s for s in sources if s.name == "Body"), None)
    if body is None or body.data.shape_keys is None:
        return {"enabled": False, "reason": "LOD0 body has no shape keys"}
    me = obj.data
    mat_of = np.array([p.material_index for p in me.polygons])
    names = [m.name for m in me.materials]
    skin = np.zeros(len(me.vertices), dtype=bool)
    teeth = np.zeros(len(me.vertices), dtype=bool)
    loops_v = np.zeros(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", loops_v)
    for p in me.polygons:
        n = names[p.material_index]
        vs = loops_v[p.loop_start:p.loop_start + p.loop_total]
        if n == materials["Body"].name:
            skin[vs] = True
        elif "TeethLow" in materials and n == materials["TeethLow"].name:
            teeth[vs] = True
    z_cut = _neck_cut_z(bpy.data.objects["Rig"])
    co = vertex_array(obj)
    skin &= co[:, 2] > z_cut - 0.03  # the body below the neck never moves with a face morph
    keys = [kb.name for kb in body.data.shape_keys.key_blocks[1:]]
    drop = set(level.get("dropMorphs", ()))
    keys = [k for k in keys if k not in drop]
    rep = {}
    added = lod_head.transfer_face_morphs(obj, body, skin, keys, z_min=z_cut - 0.05, report=rep)
    rep["enabled"] = True
    rep["keys"] = len(added)
    em = next((s for s in sources if s.name == "EyesMouth"), None)
    if em is not None and em.data.shape_keys is not None and teeth.any():
        w_em = lod_head.weights_of_obj(em)
        s_up = np.array([w.get("head", 0.0) > 0.999 for w in w_em])
        s_lo = np.array([w.get("face_jaw", 0.0) > 0.999 for w in w_em])
        w_t = lod_head.weights_of_obj(obj)
        t_lo = np.array([w.get("face_jaw", 0.0) > 0.5 for w in w_t])
        rep["teethArchMotions"] = lod_head.transfer_rigid_arches(obj, teeth, t_lo, em, s_up, s_lo, added)
    rep["blinkLoopClosureMm"] = lod_head.close_lid_loops(obj, bpy.data.objects["Rig"])
    sk = me.shape_keys
    if sk is not None:
        basis = vertex_array(obj, sk.key_blocks[0].name)
        moving = np.zeros(len(basis), dtype=bool)
        for kb in sk.key_blocks[1:]:
            moving |= np.abs(vertex_array(obj, kb.name) - basis).max(axis=1) > 1e-6
        rep["movingVertices"] = int(moving.sum())
    return rep


def _groomed_skin(out_dir, body, groom, report):
    """LOD skin albedo with the LOD0 brow, lash, beard and scalp cards painted in (groom_bake.py): written once per
    build as textures/skin_albedo_lod.png and read by both levels' transfer bakes."""
    from PIL import Image
    path = os.path.join(out_dir, "textures", "skin_albedo.png")
    if groom is None or not os.path.exists(path):
        return None
    img = np.asarray(Image.open(path).convert("RGBA"), dtype=np.float32) / 255.0
    # lashes stay with the painted lash line: rasterised flat they drew a heavy dark rim round each eye
    out, stats = groom_bake.bake_cards_into_skin(img, body, groom, kinds=(0, 1, 2))
    dst = os.path.join(out_dir, "textures", "skin_albedo_lod.png")
    Image.fromarray((np.clip(out, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)).save(dst)
    report["groomBakedIntoLodSkin"] = stats
    return dst


def _coverage_preserving(img, size, name, cutoff, boost=1.0, flatten=0.0):
    """Downsized strand atlas whose alpha keeps the full-size coverage above the alpha-test cutoff: a plain
    resize thins fine strands below the cutoff and alpha-tested hair goes patchy (the pixelated hairlines).
    `boost` asks for more coverage than full size (fewer, fuller cards at a far level read as clumps rather than
    straw); `flatten` pulls the strand colours toward their mean (with a fraction of the cards, light tips and dark
    roots of neighbouring cards no longer average out and read as a patchwork)."""
    full = array_from_image(img)
    small = array_from_image(resized_image(img, size, name + "_tmp", "sRGB"))
    target = min(0.98, float((full[..., 3] > cutoff).mean()) * boost)
    if flatten > 0.0:
        covered = small[..., 3] > cutoff
        if covered.any():
            mean = small[..., :3][covered].mean(axis=0)
            small[..., :3] = small[..., :3] * (1.0 - flatten) + mean * flatten
    lo, hi = 0.5, 4.0
    for _ in range(24):
        mid = (lo + hi) / 2
        if float((np.clip(small[..., 3] * mid, 0, 1) > cutoff).mean()) < target:
            lo = mid
        else:
            hi = mid
    small[..., 3] = np.clip(small[..., 3] * hi, 0.0, 1.0)
    return image_from_array(name, small, "sRGB")


def run(ctx):
    recipe, report, out = ctx["recipe"], ctx["report"], ctx["out"]
    report["lods"] = {}
    body = bpy.data.objects["Body"]
    spec = recipe["lodBuild"]
    others = sum(triangle_count(bpy.data.objects[n]) for n in ("Clothes", "EyesMouth", "Groom") if n in bpy.data.objects)
    decimate_body_limbs(body, spec["lod0LimbRatio"], report, budget=spec.get("lod0Triangles"), others=others)
    sources = [bpy.data.objects[n] for n in ("Body", "Clothes", "EyesMouth", "TeethLow") if n in bpy.data.objects]
    groom = bpy.data.objects["Groom"]
    if spec.get("groomBake", True):
        _groomed_skin(out, body, groom, report["lods"])
    for level in spec["levels"]:
        build_level(level, sources, groom, report, out)
    report.setdefault("lods", {})["desktop-lod0"] = {"triangles": sum(triangle_count(bpy.data.objects[n]) for n in ("Body", "Clothes", "EyesMouth", "Groom"))}

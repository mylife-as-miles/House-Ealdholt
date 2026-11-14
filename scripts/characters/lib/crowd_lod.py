"""Crowd level: head preparation and decimation to the crowd budget (original Crownfall code).

The crowd level is built at full resolution and reduced once (EALDHOLT_POPULATION_ART.md section 4: 3,500 triangles
nominal, 4,500 maximum, at least 900 on the head). The head keeps its eye openings and mouth slit as boundary loops
(the eye sockets behind the lid margins and the mouth bag are removed, as in lod_head.py; the bag becomes a small dark
cavity piece), so face_rig.py can author the lid and jaw weights from those loops on the final mesh. Garments and hair
are decimated per piece with one shared ratio; pieces already small stay whole.
"""
import bmesh
import bpy
import numpy as np

import lod_head
from scene import delete_faces, triangle_count, vertex_array

SMALL_PIECE = 140


def _split_off(obj, face_mask, name):
    """Copy the masked faces into a new object (weights kept) and delete them from obj."""
    dup = obj.copy()
    dup.data = obj.data.copy()
    dup.name = dup.data.name = name
    bpy.context.scene.collection.objects.link(dup)
    delete_faces(dup, [i for i, m in enumerate(face_mask) if not m])
    delete_faces(obj, [i for i, m in enumerate(face_mask) if m])
    return dup


def prepare_head(body, eyes, arm, report):
    """Remove the eye sockets and split the mouth bag into a dark cavity piece. Returns the cavity (or None)."""
    spheres = {s: lod_head.eye_sphere(eyes, s) for s in "lr"}
    sock = lod_head.socket_vertices(body, [spheres["l"], spheres["r"]], 0.0045, 0.2)
    sock_faces = [p.index for p in body.data.polygons if all(sock[v] for v in p.vertices)]
    delete_faces(body, sock_faces)
    bag = lod_head.face_flags(body, "crownfall_mouth_bag")
    cavity = None
    if bag.any():
        cavity = _split_off(body, bag, "MouthCavity")
        cavity["crownfall_part"] = "mouth"
    report["crowdHead"] = {"socketFacesRemoved": len(sock_faces), "mouthBagFaces": int(bag.sum()),
                           "eyeSphereRadiusMm": {s: round(spheres[s][1] * 1000, 2) for s in "lr"}}
    return cavity, spheres


def decimate_body(body, eyes, arm, spheres, target, spec, report):
    """Reduce the skin to `target` triangles with the face protected (eye and mouth loops never collapse)."""
    head = arm.data.bones["head"]
    head_mid_y = float((head.head_local.y + head.tail_local.y) / 2)
    hspec = {"skullWeight": spec.get("skullWeight", 0.5), "faceWeight": spec.get("faceWeight", 0.22),
             "neckWeight": 1.0, "eyeRings": 1, "mouthRings": 2, "noseWeight": 0.1}
    if "_crowd_full" not in body:  # keep the full-resolution skin so a second pass can aim higher
        body["_crowd_full"] = body.data.copy().name
    else:
        old = body.data
        body.data = bpy.data.meshes[body["_crowd_full"]].copy()
        bpy.data.meshes.remove(old)
    before = triangle_count(body)

    def weights_fn(obj):
        w, _info = lod_head.protection_weights(obj, arm, spheres, head_mid_y, hspec, None)
        return w
    got, ratio = lod_head.reduce(body, target, weights_fn)
    for p in body.data.polygons:
        p.use_smooth = True
    neck_z = float(arm.data.bones["neck"].tail_local.z) - 0.01
    co = vertex_array(body)
    head_tris = 0
    body.data.calc_loop_triangles()
    for t in body.data.loop_triangles:
        if co[list(t.vertices)][:, 2].mean() > neck_z:
            head_tris += 1
    report.setdefault("crowdLod", {})["body"] = {"before": before, "after": got, "ratio": round(ratio, 4), "headTriangles": head_tris}
    return head_tris


def _area(obj):
    return sum(p.area for p in obj.data.polygons)


def decimate_pieces(pieces, target, report, label, min_tris=24):
    """Share `target` triangles between pieces by surface area (equal texel-like density), never adding triangles to a
    piece that is already coarser than the shared density; generated grids (capes, skirts) are usually coarse already
    and keep their shape, dense body-copy shells take the reduction."""
    tris = {k: triangle_count(o) for k, o in pieces.items()}
    area = {k: max(1e-6, _area(o)) for k, o in pieces.items()}
    alloc = {}
    free = dict(tris)
    budget = float(target)
    for _ in range(6):  # pieces under their density share keep everything; the rest share what is left
        dens = budget / max(1e-6, sum(area[k] for k in free))
        settled = {k: t for k, t in free.items() if t <= max(min_tris, area[k] * dens)}
        if not settled:
            break
        for k, t in settled.items():
            alloc[k] = t
            budget -= t
            del free[k]
    dens = max(0.0, budget) / max(1e-6, sum(area[k] for k in free)) if free else 0.0
    for k in free:
        alloc[k] = max(min_tris, int(area[k] * dens))
    for k, o in pieces.items():
        if alloc[k] >= tris[k] * 0.98 or tris[k] <= SMALL_PIECE:
            continue  # small pieces (belts, bands, knots) stay whole: collapsed, a thin band shot out into spikes
        decimate_protected(o, alloc[k])
    after = {k: triangle_count(o) for k, o in pieces.items()}
    report.setdefault("crowdLod", {})[label] = {"before": sum(tris.values()), "after": sum(after.values()), "pieces": after,
                                                "areaM2": {k: round(v, 3) for k, v in area.items()}}
    return sum(after.values())


INNER = ("Shirt", "ShiftHem")
LAYERS = ("Shirt", "Under", "Hose", "ShiftHem", "Upper", "Skirt", "Wraps", "Mail", "MailSkirt", "Surcoat", "SurcoatSkirt", "Over",
          "OverSkirt", "Apron", "Belt", "Cape", "Hood")


BODY_LAYERS = ("Shirt", "Under", "Hose", "ShiftHem", "Upper")


def _torso_tree(body):
    """BVH of the skin without the arms and hands (faces whose vertices are mostly weighted to arm joints are left out):
    the hands hang beside the hips in the rest pose and would push belts and skirts out into spikes."""
    from mathutils.bvhtree import BVHTree
    groups = {g.index for g in body.vertex_groups if g.name.startswith(ARM_BONES + ("thumb", "index", "middle", "ring", "pinky"))}
    arm_w = np.zeros(len(body.data.vertices))
    for v in body.data.vertices:
        arm_w[v.index] = sum(g.weight for g in v.groups if g.group in groups)
    co = vertex_array(body)
    body.data.calc_loop_triangles()
    tris = [tuple(t.vertices) for t in body.data.loop_triangles if arm_w[list(t.vertices)].mean() < 0.5]
    return BVHTree.FromPolygons([tuple(p) for p in co], tris, all_triangles=True) if tris else None


def restack_layers(garments, report, gap=0.006, body=None):
    """After decimation the coarser layers cut through each other (a skirt hem through the apron, the gambeson through
    the mail): push every piece outside the union of the pieces beneath it, innermost first. With `body`, the innermost
    layers (shirt, under-tunic, hose, shift, tunic) are also pushed outside the skin without the arms (art fixer,
    8 November: skin poked through decimated necklines as pale shards)."""
    import garments as G
    moved = {}
    below = []
    torso = _torso_tree(body) if body is not None and len(body.data.polygons) else None
    for name in LAYERS:
        obj = garments.get(name)
        if obj is None:
            continue
        trees = ([G.tree_of(below)] if below else []) + ([torso] if torso is not None and name in BODY_LAYERS else [])
        if trees:
            before = vertex_array(obj).copy()
            for tree in trees:  # push_outside takes one tree at a time
                G.push_outside(obj, (tree,), gap * (2.0 if name in ("Apron", "Cape", "Surcoat", "SurcoatSkirt", "Over", "OverSkirt") else 1.0),
                               iterations=3, reach=0.04)
            moved[name] = int((np.linalg.norm(vertex_array(obj) - before, axis=1) > 1e-5).sum())
        below.append(obj)
    report.setdefault("crowdLod", {})["restackedVertices"] = moved


OUTER_ORDER = ("Upper", "Skirt", "Apron", "Mail", "MailSkirt", "Surcoat", "SurcoatSkirt", "Over", "OverSkirt", "Cape", "Hood", "Wraps", "Belt")


def remove_hidden_layers(body, arm, garments, report):
    """After decimation: delete skin and inner-layer faces that the coarser outer layers now hide or that poke out
    through them (flat decimated cloth over a curved chest lets the skin through)."""
    import garments as G
    import crowd_outfits as CO
    out = {}
    info = G.BodyInfo(body, arm)
    out["skin"] = CO.delete_covered_skin(body, info, list(garments.values()), report, margin=0.03, inward=0.03)
    for name in INNER:
        inner = garments.get(name)
        if inner is None:
            continue
        outer = [garments[k] for k in OUTER_ORDER if k in garments]
        if not outer:
            continue
        out[name] = _delete_covered_faces(inner, outer)
    # Layers that are hidden at rest but came through their cover in the flexed work loops (population generator,
    # 7 November): two separately decimated shells 1 to 3 cm apart do not stay apart under linear blend skinning when the
    # hips or shoulders bend hard (hoe, reap, chop). The hidden part goes, with a margin at the cover's edge.
    # - hose under a short skirt (the thighs pushed through the skirt front when stooping): the front and sides go, 10 cm
    #   kept above the hem so a stride never opens a gap; the back stays (it filled gaps in the skirt's back at rest);
    # - the tunic or gown under a shoulder cape, shawl or mantle (patches of tunic through the cape), its sleeves kept
    #   (the arms leave the cape when they reach);
    # - the gambeson under the mail and the mail under the surcoat (the gambeson through the mail at the shoulder).
    # art fixer, 8 November:
    # - the gown (or overgown) under an apron came through it at the apron's hem in the walks and carries (red triangles
    #   through a white apron on most frames of carry_yoke_walk): the hidden part goes, with a margin band kept at the
    #   apron's side edges and a narrow one at its hem and top (cut flush, the hole's edge showed under the apron hem);
    # - the tunic under a sleeveless jerkin or overgown, the long-sleeved under-tunic under the jerkin (arms kept);
    # - the gown's skirt under an overgown's skirt (the gown below the overskirt's hem stays).
    pairs = [("Hose", ("Skirt", "MailSkirt", "SurcoatSkirt", "Apron"), 0.10, "back"),
             ("Upper", ("Cape",), 0.05, True),
             ("Upper", ("Mail",), 0.04, False), ("Skirt", ("MailSkirt",), 0.04, False),
             ("Mail", ("Surcoat",), 0.04, False), ("MailSkirt", ("SurcoatSkirt",), 0.04, False),
             ("Under", ("Upper",), 0.02, True), ("Upper", ("Over",), 0.04, True), ("Skirt", ("OverSkirt",), 0.04, False),
             ("Skirt", ("Apron",), 0.035, "sides"), ("OverSkirt", ("Apron",), 0.035, "sides"),
             ("Upper", ("Apron",), 0.035, "sides"), ("Over", ("Apron",), 0.035, "sides"),
             ("Mail", ("Cape",), 0.05, True), ("Over", ("Cape",), 0.05, True), ("Under", ("Cape",), 0.05, True)]
    for inner_name, cover_names, margin, keep_arms in pairs:
        inner = garments.get(inner_name)
        covers = [garments[k] for k in cover_names if k in garments]
        if inner is None or not covers or len(inner.data.polygons) == 0:
            continue
        # "back": the hose stays on the back of the legs, where it fills the gaps a decimated short skirt leaves at rest
        keep = _arm_faces(inner) if keep_arms is True else _back_faces(inner) if keep_arms == "back" else None
        if keep_arms == "sides":
            keep = _arm_faces(inner)
            edge_ok = _side_edge_filter(covers)
        else:
            edge_ok = None
        # at an apron's hem and top a narrower band stays: cut flush there, the edge of the hole showed under the apron hem
        out[f"{inner_name}Under{cover_names[0]}"] = _delete_covered_faces(inner, covers, margin=margin, keep=keep, edge_ok=edge_ok,
                                                                          other_margin=0.015 if edge_ok is not None else None)
    # the linen shirt shows only at the cuffs: its collar band poked through the tunic's neckline as white shards in the
    # rest pose (hall cook, carpenter), so everything but the sleeves goes
    shirt = garments.get("Shirt")
    if shirt is not None and len(shirt.data.polygons):
        arms = _arm_faces(shirt, threshold=0.5)
        before = triangle_count(shirt)
        delete_faces(shirt, [p.index for p in shirt.data.polygons if p.index not in arms])
        out["ShirtCollar"] = before - triangle_count(shirt)
    report.setdefault("crowdLod", {})["hiddenFacesRemoved"] = out
    return out


ARM_BONES = ("upperarm", "forearm", "hand")


def _back_faces(obj, min_back=0.2):
    """Indices of faces facing backwards (Blender +Y is the figure's back)."""
    return {p.index for p in obj.data.polygons if p.normal.y > min_back}


def _arm_faces(obj, threshold=0.3):
    """Indices of faces whose vertices are weighted to the arms (sleeves): they leave a cape when the arms reach."""
    groups = {g.index for g in obj.vertex_groups if g.name.startswith(ARM_BONES)}
    arm_w = np.zeros(len(obj.data.vertices))
    for v in obj.data.vertices:
        arm_w[v.index] = sum(g.weight for g in v.groups if g.group in groups)
    return {p.index for p in obj.data.polygons if arm_w[list(p.vertices)].mean() > threshold}


def _side_edge_filter(covers):
    """Boundary points of the covers that count for the edge margin: the side edges only (the hem and the top edge of an
    apron are left out)."""
    bounds = []
    for c in covers:
        co = vertex_array(c)
        bounds.append((float(co[:, 2].min()), float(co[:, 2].max())) if len(co) else (0.0, 0.0))

    def ok(p, piece_index):
        lo, hi = bounds[piece_index]
        return lo + 0.04 < p[2] < hi - 0.03
    return ok


def _delete_covered_faces(obj, covers, reach=0.08, margin=0.025, inward=0.03, keep=None, edge_ok=None, other_margin=None):
    """Delete faces of an inner layer that the outer pieces hide (a ray along the face normal hits one, or one lies
    just behind a face that pokes out through it), keeping a margin only at the edge of the piece that covers it
    (with `edge_ok`, `margin` at the edge points it accepts and `other_margin` at the others)."""
    import crowd_outfits as CO
    tree, owner, edges = CO._piece_tree(covers, edge_ok)
    others = CO._piece_tree(covers, lambda p, k: not edge_ok(p, k))[2] if (edge_ok is not None and other_margin) else None
    co = vertex_array(obj)
    doomed = []
    for poly in obj.data.polygons:
        if keep is not None and poly.index in keep:
            continue
        c, n = poly.center, poly.normal
        hit = tree.ray_cast(c + n * 0.001, n, reach)
        if hit[0] is None:
            hit = tree.ray_cast(c - n * 0.001, -n, inward)
        if hit[0] is None:
            continue
        kd = edges[owner[hit[2]]]
        if kd is not None:
            d = kd.find(c)[2]
            if d is not None and d < margin:
                continue
        if others is not None and others[owner[hit[2]]] is not None:
            kd2 = others[owner[hit[2]]]
            d = kd2.find(c)[2]
            if d is not None and d < other_margin:
                continue
            # a face reaching below the cover's hem stays whole: cutting it left teeth that showed under the apron
            if any(co[v][2] < kd2.find(co[v])[0][2] + 0.01 for v in poly.vertices if kd2.find(co[v])[2] is not None and kd2.find(co[v])[2] < 0.12):
                continue
        doomed.append(poly.index)
    before = triangle_count(obj)
    delete_faces(obj, doomed)
    return before - triangle_count(obj)


def decimate_to(obj, target, protect=False):
    if triangle_count(obj) <= target:
        return
    if protect:
        decimate_protected(obj, target)
        return
    mod = obj.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = target / max(1, triangle_count(obj))
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    with bpy.context.temp_override(object=obj, active_object=obj):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def clean_shell(obj, merge=0.0008):
    """Merge coincident vertices and drop loose and non-manifold faces (edges shared by three or more faces) before a
    collapse decimation: the basket weaver's wimple shell had four non-manifold edges and the collapse caved its crown
    in below the scalp (art fixer, 8 November)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge)
    bad = {f for e in bm.edges if len(e.link_faces) > 2 for f in e.link_faces}
    if bad:
        bmesh.ops.delete(bm, geom=list(bad), context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return len(bad)


def decimate_protected(obj, target, boundary_weight=0.04, attempts=4):
    """Collapse decimation that keeps every boundary loop (hems, cuffs, necklines, rims, face openings) as drawn: the
    plain collapse notched hems into dark triangles where the layer beneath showed through, and cut jagged teeth into
    cap and helmet rims (art fixer, 8 November). Boundary vertices are weighted to stay (lod_head.decimate_weighted)."""
    import lod_head
    if triangle_count(obj) <= target:
        return
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    edge_v = {v.index for e in bm.edges if e.is_boundary for v in e.verts}
    bm.free()
    if len(edge_v) > 0.6 * len(obj.data.vertices):
        boundary_weight = 1.0  # a strip that is nearly all edge: protection would only push the collapse into spikes
    weights = [boundary_weight if i in edge_v else 1.0 for i in range(len(obj.data.vertices))]
    base = obj.data.copy()
    ratio = target / max(1, triangle_count(obj))
    for _ in range(attempts):
        old = obj.data
        obj.data = base.copy()
        if old is not base:
            bpy.data.meshes.remove(old)
        lod_head.decimate_weighted(obj, min(1.0, ratio), weights)
        got = triangle_count(obj)
        if abs(got - target) <= max(6, target * 0.05) or ratio >= 1.0:
            break
        ratio = min(1.0, ratio * target / max(1, got))
    bpy.data.meshes.remove(base)


def ground_soles(garments, report, band=0.02, flat=0.004):
    """Put every shoe sole on the ground at rest (population generator, 7 November).

    The archetype skeletons stand the bare foot SOLE_LIFT above the ground (crowd_skeleton.SOLE_LIFT: the sole the clip
    libraries plant), but the shoe hull is the foot plus a 7 mm allowance, smoothed and decimated, so its lowest point
    rested 2 to 9 mm above the ground and residents hovered by that much in every clip. The lowest `band` of each shoe is
    pulled down by the measured gap (full at the bottom, nothing at the band's top) and points within `flat` of the ground
    are laid on it, giving a flat sole of the full SOLE_LIFT thickness. Ground z = 0 in the build frame is the actor's
    ground at every placement scale (the scale is about the root at the ground).
    """
    out = {}
    for name, o in garments.items():
        if o.get("crowd_kind") != "shoes" or len(o.data.vertices) == 0:
            continue
        co = vertex_array(o)
        gap = float(co[:, 2].min())
        if gap > 0.0:
            w = np.clip(1.0 - (co[:, 2] - gap) / band, 0.0, 1.0)
            co[:, 2] -= gap * w
        co[:, 2] = np.where(co[:, 2] < flat, 0.0, co[:, 2])
        o.data.vertices.foreach_set("co", co.ravel())
        o.data.update()
        out[name] = {"gapBeforeMm": round(gap * 1000.0, 2), "flatVertices": int((co[:, 2] == 0.0).sum())}
    report["groundSoles"] = out
    return out


FULL_COVER = ("coif", "padded-coif", "head-cloth", "veil-wimple", "hood")
SHELLS = ("Wimple", "HeadCloth", "Coif", "Kerchief", "Cap", "Helmet", "HatCrown", "Hood")


def headwear_gate(body, arm, head_pieces, garments, recipe, report, min_cover=0.95):
    """Build gate for headwear (art fixer, 8 November). Under a full cover (coif, padded coif, hood, head-cloth, veil and
    wimple) the scalp seen from above and from four isometric directions (40 degrees down) must be covered at least
    `min_cover` (the basket weaver's caved-in wimple left a bare crown); every headwear shell must stay one piece without
    loose shards (islands of fewer than 8 faces) and inside the head's reach (no stray faces beyond 1.6 head radii of
    the skull centre; 2.1 for wimples and hoods, whose collars run down the neck)."""
    import math as _m
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    hw = recipe.get("headwear", "none")
    out = {"headwear": hw, "pass": True}
    if hw in ("none", "ribbon"):
        report["headwearGate"] = out
        return out
    b = arm.data.bones
    eye_z = float((b["face_eye_l"].head_local.z + b["face_eye_r"].head_local.z) / 2)
    hb = b["head"]
    centre = np.array((hb.head_local + hb.tail_local) / 2)
    bco = vertex_array(body)
    scalp_v = bco[(bco[:, 2] > eye_z + 0.025) & (np.linalg.norm(bco - centre, axis=1) < 0.2)]
    if len(scalp_v) == 0:
        out.update({"pass": False, "error": "no scalp"})
        report["headwearGate"] = out
        return out
    top = float(scalp_v[:, 2].max())
    radius = float(top - eye_z) * 1.15
    wear = {k: o for k, o in list(head_pieces.items()) + list(garments.items())
            if o.get("crownfall_part") == "headwear" or k in ("Hood",)}
    cover_tree = G_tree(list(wear.values())) if wear else None
    body_tree = G_tree([body])
    if hw in FULL_COVER and cover_tree is not None:
        lo, hi = scalp_v.min(axis=0), scalp_v.max(axis=0)
        dirs = [Vector((0, 0, -1))] + [Vector((_m.sin(a) * _m.cos(_m.radians(40)), -_m.cos(a) * _m.cos(_m.radians(40)), -_m.sin(_m.radians(40)))).normalized()
                                      for a in (0.0, _m.pi / 2, _m.pi, 1.5 * _m.pi)]
        hits = covered = 0
        for d in dirs:
            for x in np.linspace(lo[0], hi[0], 18):
                for y in np.linspace(lo[1], hi[1], 18):
                    # aim each ray at a scalp point: start 0.6 m back along the view direction
                    target = Vector((x, y, top))
                    hb_ = body_tree.ray_cast(target - d * 0.6, d, 1.2)
                    if hb_[0] is None or hb_[0].z < eye_z + 0.025:
                        continue
                    hits += 1
                    hc = cover_tree.ray_cast(target - d * 0.6, d, 1.2)
                    if hc[0] is not None and (hc[3] <= hb_[3] + 1e-4):
                        covered += 1
        frac = covered / max(1, hits)
        out["scalpRays"] = hits
        out["scalpCovered"] = round(frac, 4)
        if frac < min_cover:
            out["pass"] = False
    shells = {}
    for k, o in wear.items():
        if k not in SHELLS or len(o.data.polygons) == 0:
            continue
        co = vertex_array(o)
        far = float(np.linalg.norm(co - centre, axis=1).max())
        islands = _islands(o)
        small = sum(1 for n in islands if n < 8)
        reach = 2.1 if k in ("Wimple", "Hood") else 1.6  # wimples and hoods run down the neck to the collar
        ok = far <= radius * reach and small == 0
        shells[k] = {"faces": len(o.data.polygons), "maxReachRadii": round(far / radius, 3), "islands": len(islands), "shardIslands": small, "pass": ok}
        if not ok:
            out["pass"] = False
    out["shells"] = shells
    report["headwearGate"] = out
    return out


def G_tree(objs):
    import garments as G
    return G.tree_of(objs)


def _islands(obj):
    """Face counts of the connected pieces of a mesh."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    seen, sizes = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, n = [f], 0
        seen.add(f.index)
        while stack:
            g = stack.pop()
            n += 1
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        sizes.append(n)
    bm.free()
    return sizes


def drop_shards(obj, min_faces=8):
    """Delete loose islands of fewer than `min_faces` faces left by cleaning and decimation (the grey wimple fragments
    beside the jaw). Returns the number of faces removed."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    seen, doomed = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, island = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            island.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        if len(island) < min_faces:
            doomed.extend(island)
    n = len(doomed)
    if doomed:
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(obj.data)
        obj.data.update()
    bm.free()
    return n

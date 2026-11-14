"""Stage: original layered garments built around the shaped body (Crownfall original work).

Shells copy the body's topology and weights in a region, are smoothed so they drape
over anatomy and pushed outside the layer beneath. Hanging parts (tunic skirt,
apron) are generated tubes/panels weighted to the shared skirt bones. Body faces
completely covered by clothing are deleted to save triangles and stop poke-through.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from scene import SurfaceBinding, assign_weights, new_mesh, normals_array, triangle_count, vertex_array, weights_of

TORSO_BONES = {"hips", "spine_01", "spine_02", "spine_03", "clavicle_l", "clavicle_r", "neck"}


class BodyInfo:
    """Rest-pose landmarks and per-vertex region data of the shaped body."""

    def __init__(self, body, arm):
        self.body, self.arm = body, arm
        self.v = vertex_array(body)
        self.n = normals_array(body)
        self.w = weights_of(body)
        self.dominant = [max(w.items(), key=lambda kv: kv[1])[0] if w else "hips" for w in self.w]
        self.bones = {b.name: (np.array(b.head_local), np.array(b.tail_local)) for b in arm.data.bones}
        me = body.data
        me.calc_loop_triangles()
        tris = [t.vertices[:] for t in me.loop_triangles]
        self.tree = BVHTree.FromPolygons([tuple(p) for p in self.v], tris, all_triangles=True)
        z = lambda name, end=0: float(self.bones[name][end][2])
        self.ankle_z = z("foot_l")
        self.knee_z = z("calf_l")
        self.hip_z = z("thigh_l")
        self.waist_z = z("spine_01") + 0.02
        self.chest_z = z("spine_03")
        self.neck_z = z("neck")
        self.head_z = z("head")

    def limb_t(self, i, bone):
        head, tail = self.bones[bone]
        d = tail - head
        return float(np.clip(np.dot(self.v[i] - head, d) / np.dot(d, d), -1, 2))

    def in_bones(self, i, names):
        return self.dominant[i] in names


def _shell(info, name, keep, offset, smooth=12, smooth_factor=0.5):
    """Copy body faces whose vertices all satisfy keep(i); offset along body normals and smooth."""
    me = info.body.data.copy()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    if me.shape_keys:
        obj.shape_key_clear()
    keep_mask = np.array([bool(keep(i)) for i in range(len(info.v))])
    bm = bmesh.new()
    bm.from_mesh(me)
    doomed = [f for f in bm.faces if not all(keep_mask[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=doomed, context="FACES_ONLY")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    src = vertex_array(obj)
    index = _nearest_body_vertices(info, src)  # shell vertices are exact copies of body vertices
    obj.data.vertices.foreach_set("co", (src + info.n[index] * offset).ravel())
    obj.data.update()
    _smooth(obj, smooth, smooth_factor)
    return obj, index


def _nearest_body_vertices(info, points):
    from mathutils.kdtree import KDTree
    if not hasattr(info, "_kd"):
        kd = KDTree(len(info.v))
        for i, p in enumerate(info.v):
            kd.insert(p, i)
        kd.balance()
        info._kd = kd
    return np.array([info._kd.find(Vector(p))[1] for p in points], dtype=np.int64)


def _smooth(obj, iterations, factor, keep_boundary=True):
    if iterations <= 0:
        return
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    verts = [v for v in bm.verts if not (keep_boundary and v.is_boundary)]
    for _ in range(iterations):
        bmesh.ops.smooth_vert(bm, verts=verts, factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def push_outside(obj, tree_points, min_gap, iterations=3, reach=0.035):
    """Move vertices outward until they are at least min_gap outside the given BVH surface.
    Only surfaces within reach count, so distant layers never capture a vertex."""
    tree, = tree_points
    coords = vertex_array(obj)
    for _ in range(iterations):
        changed = False
        for i, p in enumerate(coords):
            loc, normal, _f, dist = tree.find_nearest(Vector(p), reach)
            if loc is None:
                continue
            d = Vector(p) - loc
            signed = d.dot(normal)
            if signed < min_gap:
                coords[i] = np.array(loc + normal * min_gap)
                changed = True
        if not changed:
            break
    obj.data.vertices.foreach_set("co", coords.ravel())
    obj.data.update()


def tree_of(objs):
    verts, tris, base = [], [], 0
    for o in objs:
        dg = bpy.context.evaluated_depsgraph_get()
        me = o.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        mw = o.matrix_world
        verts.extend(tuple(mw @ v.co) for v in me.vertices)
        tris.extend(tuple(base + i for i in t.vertices) for t in me.loop_triangles)
        base += len(me.vertices)
        o.evaluated_get(dg).to_mesh_clear()
    return BVHTree.FromPolygons(verts, tris, all_triangles=True)


def _copy_body_weights(obj, info, index, arm, blur=0):
    weights = [dict(info.w[i]) for i in index]
    assign_weights(obj, weights, arm)


def _rim(obj, thickness):
    mod = obj.modifiers.new("Rim", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = -1.0
    mod.use_rim = True
    mod.use_rim_only = True
    # Even-thickness offsets divide by the cosine of the corner angle: on a decimated hem with a nearly
    # folded corner that shot one rim vertex 20 cm out (the spike beside the elder's hood). Plain normal
    # offsets, clamped to the local edge length, cannot blow up.
    mod.use_even_offset = False
    mod.thickness_clamp = 1.0
    return mod


def _apply_modifiers(obj, types=("SOLIDIFY",)):
    bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        if mod.type in types:
            with bpy.context.temp_override(object=obj, active_object=obj):
                bpy.ops.object.modifier_apply(modifier=mod.name)


def convex_hull(points):
    pts = sorted(set(map(tuple, np.round(points, 6))))
    if len(pts) < 3:
        return np.array(pts)

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return np.array(lower[:-1] + upper[:-1])


def resample_loop(hull, count, centre):
    """Resample a closed 2D loop to count points by angle around centre, starting at the front (-Y)."""
    angles = np.arctan2(hull[:, 0] - centre[0], -(hull[:, 1] - centre[1]))
    order = np.argsort(angles)
    hull = hull[order]
    angles = angles[order]
    radii = np.hypot(hull[:, 0] - centre[0], hull[:, 1] - centre[1])
    targets = np.linspace(-math.pi, math.pi, count, endpoint=False)
    ext_a = np.concatenate([angles - 2 * math.pi, angles, angles + 2 * math.pi])
    ext_r = np.concatenate([radii, radii, radii])
    r = np.interp(targets, ext_a, ext_r)
    return targets, r


def ring_section(info, z, exclude_arms=True, band=0.012):
    sel = [i for i in range(len(info.v)) if abs(info.v[i][2] - z) < band
           and not (exclude_arms and info.dominant[i].split("_")[0] in ("upperarm", "forearm", "hand", "thumb", "index", "middle", "ring", "pinky"))]
    return info.v[sel][:, :2]


def hull_tube(info, arm, name, levels, radius_of, segments=64, centre=None, seed=3):
    """Cloth tube around the torso/legs: per level, the convex hull of the body section (arms
    excluded) resampled by angle; radius_of(z, angles, hull_radius) returns the cloth radius."""
    centre = centre if centre is not None else np.array([0.0, float(np.mean(info.v[:, 1][np.abs(info.v[:, 2] - info.hip_z) < 0.02]))])
    verts, rows = [], []
    for z in levels:
        section = ring_section(info, z)
        hull = convex_hull(section)
        angles, radius = resample_loop(hull, segments, centre)
        r = radius_of(z, angles, radius)
        row = []
        for a, rr in zip(angles, r):
            row.append(len(verts))
            verts.append((centre[0] + math.sin(a) * rr, centre[1] - math.cos(a) * rr, z))
        rows.append(row)
    faces = []
    for k in range(len(rows) - 1):
        for s in range(segments):
            a, b = rows[k][s], rows[k][(s + 1) % segments]
            c, d = rows[k + 1][(s + 1) % segments], rows[k + 1][s]
            faces.append((a, d, c, b))
    obj = new_mesh(name, np.array(verts), faces)
    return obj, rows, centre


def skirt_weights(info, obj, rows, centre, z_body, z_hang, z_hem, arm):
    """Body-bound weights above z_body, the shared skirt bones (by angle) below z_hang."""
    pts = vertex_array(obj)
    binding = SurfaceBinding(info.body)
    bound = binding.transfer_weights(binding.bind(pts))
    weights = []
    for i, p in enumerate(pts):
        z = p[2]
        body_w = bound[i]
        if z >= z_body:
            weights.append(body_w)
            continue
        ang = math.atan2(p[0] - centre[0], -(p[1] - centre[1]))
        lobes = {"skirt_front": max(0.0, math.cos(ang)), "skirt_back": max(0.0, -math.cos(ang)),
                 "skirt_l": max(0.0, math.sin(ang)), "skirt_r": max(0.0, -math.sin(ang))}
        total = sum(v ** 2 for v in lobes.values())
        hang = float(np.clip((z_hang - z) / max(1e-3, z_hang - z_hem), 0.0, 1.0)) ** 1.2 * 0.9
        blend = float(np.clip((z_body - z) / max(1e-3, z_body - z_hang), 0.0, 1.0))
        w = {}
        for bone, value in body_w.items():
            w[bone] = w.get(bone, 0.0) + value * (1 - blend)
        hips_part = blend * (1.0 - hang)
        w["hips"] = w.get("hips", 0.0) + hips_part
        for bone, value in lobes.items():
            if value > 1e-3:
                w[bone] = w.get(bone, 0.0) + blend * hang * (value ** 2) / total
        weights.append(w)
    assign_weights(obj, weights, arm)


def boundary_loops(obj):
    """Boundary vertex loops as ordered vertex index lists."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    nxt = {}
    for e in bm.edges:
        if e.is_boundary:
            a, b = e.verts[0].index, e.verts[1].index
            nxt.setdefault(a, []).append(b)
            nxt.setdefault(b, []).append(a)
    bm.free()
    loops, seen = [], set()
    for start in nxt:
        if start in seen:
            continue
        loop, prev, cur = [start], None, start
        seen.add(start)
        while True:
            options = [n for n in nxt[cur] if n != prev and n not in seen]
            if not options:
                break
            prev, cur = cur, options[0]
            loop.append(cur)
            seen.add(cur)
        loops.append(loop)
    return loops


def relax_loop(obj, loop, iterations=12, factor=0.5):
    co = vertex_array(obj)
    n = len(loop)
    if n < 4:
        return
    for _ in range(iterations):
        pts = co[loop].copy()
        avg = (np.roll(pts, 1, axis=0) + np.roll(pts, -1, axis=0)) * 0.5
        co[loop] = pts * (1 - factor) + avg * factor
    obj.data.vertices.foreach_set("co", co.ravel())
    obj.data.update()


def fold_band(obj, loop, outward, back, lip=0.004):
    """Turn the edge of a garment back on itself (rolled cuff, neckband): adds two rings."""
    me = obj.data
    co = vertex_array(obj)
    normals = normals_array(obj)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    # inward = across the loop tangent, oriented toward the cloth (the faces around the vertex). The sum of
    # inner edges does not exist at boundary corners and sent those collar points straight up as spikes
    # (the smith's jagged undershirt collar); the household's fold_hem already works this way.
    m = len(loop)
    inward = []
    for k, i in enumerate(loop):
        faces = bm.verts[i].link_faces
        centre = np.mean([np.array(f.calc_center_median()) for f in faces], axis=0) if faces else co[i]
        t = co[loop[(k + 1) % m]] - co[loop[(k - 1) % m]]
        t = t / (np.linalg.norm(t) + 1e-12)
        d = np.cross(normals[i], t)
        d = d / (np.linalg.norm(d) + 1e-12)
        if np.dot(d, centre - co[i]) < 0:
            d = -d
        inward.append(d)
    bm.free()
    weights = []
    names = {g.index: g.name for g in obj.vertex_groups}
    for i in loop:
        weights.append({names[g.group]: g.weight for g in me.vertices[i].groups})
    ring1 = [co[i] + normals[i] * outward + (-inward[k]) * lip for k, i in enumerate(loop)]
    ring2 = [co[i] + normals[i] * outward * 1.15 + inward[k] * back for k, i in enumerate(loop)]
    base = len(me.vertices)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    old = [bm.verts[i] for i in loop]
    r1 = [bm.verts.new(Vector(p)) for p in ring1]
    r2 = [bm.verts.new(Vector(p)) for p in ring2]
    n = len(loop)
    closed = n > 2
    for k in range(n if closed else n - 1):
        j = (k + 1) % n
        for f in ((old[k], old[j], r1[j], r1[k]), (r1[k], r1[j], r2[j], r2[k])):
            try:
                bm.faces.new(f)
            except ValueError:
                pass
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.update()
    groups = {g.name: g for g in obj.vertex_groups}
    for ring_start in (base, base + n):
        for k in range(n):
            for bone, w in weights[k].items():
                groups[bone].add([ring_start + k], w, "REPLACE")


def drape(obj, colliders, pinned, spec=None, report=None):
    """Settle a hanging garment under gravity with Blender's cloth solver and keep the result as geometry: the
    procedural shells hung as rigid bells and boards (the elder's cloak, the aprons, the shawl). `pinned` lists the
    vertex indices held in place (the top band). Colliders are the body and the layers beneath. Runs in the rest
    pose before thickness is added; returns the mean and largest movement in metres."""
    import time
    spec = dict({"frames": 40, "quality": 6, "mass": 0.35, "tension": 40.0, "shear": 10.0, "bending": 0.6,
                 "airDamping": 2.0, "distance": 0.005, "thickness": 0.004}, **(spec or {}))
    before = vertex_array(obj)
    group = obj.vertex_groups.new(name="_drape_pin")
    group.add([int(i) for i in pinned], 1.0, "REPLACE")
    added = []
    for c in colliders:
        if c is None or c is obj:
            continue
        m = c.modifiers.new("_DrapeCollision", "COLLISION")
        c.collision.thickness_outer = spec["thickness"]
        c.collision.cloth_friction = 5.0
        added.append((c, m))
    mod = obj.modifiers.new("_Drape", "CLOTH")
    st = mod.settings
    st.quality = spec["quality"]
    st.mass = spec["mass"]
    st.air_damping = spec["airDamping"]
    st.tension_stiffness = st.compression_stiffness = spec["tension"]
    st.shear_stiffness = spec["shear"]
    st.bending_stiffness = spec["bending"]
    st.vertex_group_mass = group.name
    cs = mod.collision_settings
    cs.distance_min = spec["distance"]
    cs.use_self_collision = False
    scene = bpy.context.scene
    frames = int(spec["frames"])
    scene.frame_start, scene.frame_end = 1, frames
    mod.point_cache.frame_start, mod.point_cache.frame_end = 1, frames
    t0 = time.time()
    for f in range(1, frames + 1):
        scene.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    after = np.array([v.co[:] for v in me.vertices])
    ev.to_mesh_clear()
    obj.modifiers.remove(mod)
    for c, m in added:
        c.modifiers.remove(m)
    obj.vertex_groups.remove(group)
    scene.frame_set(1)
    if after.shape == before.shape and np.isfinite(after).all():
        obj.data.vertices.foreach_set("co", after.ravel())
        obj.data.update()
    moved = np.linalg.norm(after - before, axis=1) if after.shape == before.shape else np.zeros(1)
    out = {"meanMovedMetres": round(float(moved.mean()), 4), "maxMovedMetres": round(float(moved.max()), 4),
           "seconds": round(time.time() - t0, 1), "frames": frames}
    if report is not None:
        report.setdefault("drape", {})[obj.name] = out
    return out


def apron_panel(info, arm, name, z_top, z_bottom, widths, cols=12, rows=30, standoff=0.012, under_tree=None):
    """Leather apron hanging from a neck strap: follows the chest, then hangs straight past the thighs."""
    verts = []
    front_tree = under_tree or info.tree
    for r in range(rows + 1):
        v = r / rows
        z = z_top + (z_bottom - z_top) * v
        width = np.interp(v, [0.0, 0.33, 1.0], widths)
        for c in range(cols + 1):
            u = c / cols * 2 - 1
            x = u * width / 2
            # cast from the front toward the body to find the layer surface
            hit = front_tree.ray_cast(Vector((x, -1.0, z)), Vector((0.0, 1.0, 0.0)), 3.0)
            y = (hit[0].y - standoff) if hit[0] is not None else -0.12
            verts.append([x, y, z])
    verts = np.array(verts)
    grid = verts.reshape(rows + 1, cols + 1, 3)
    # below the belly the apron hangs: never further back than the most forward point above it
    for r in range(1, rows + 1):
        if grid[r, 0, 2] < info.waist_z:
            grid[r, :, 1] = np.minimum(grid[r, :, 1], grid[r - 1, :, 1].min() + 0.003 * (grid[r, :, 0] / 0.25) ** 2)
    # gentle cylinder curve so the panel wraps the thighs a little, plus soft lengthwise folds
    for r in range(rows + 1):
        v = r / rows
        u = np.linspace(-1, 1, cols + 1)
        grid[r, :, 1] += (u ** 2) * 0.03 * min(1.0, v * 2)
        grid[r, :, 1] += np.sin(u * 5.5 + 0.8) * 0.004 * v
    verts = grid.reshape(-1, 3)
    faces = []
    for r in range(rows):
        for c in range(cols):
            a = r * (cols + 1) + c
            faces.append((a, a + cols + 1, a + cols + 2, a + 1))
    obj = new_mesh(name, verts, faces)
    weights = []
    for p in verts:
        z = p[2]
        if z > info.chest_z - 0.04:
            w = {"spine_03": 0.7, "spine_02": 0.3}
        elif z > info.waist_z:
            t = (z - info.waist_z) / max(1e-3, info.chest_z - 0.04 - info.waist_z)
            w = {"spine_02": 0.6 * t + 0.1, "spine_01": 0.9 - 0.6 * t}
        else:
            # below the belt: the skirt bone carries the panel past the forward knee, and a softly split share of
            # each thigh bends its sides with the legs, so the leather flexes instead of swinging as one board
            t = min(1.0, (info.waist_z - z) / max(1e-3, info.waist_z - z_bottom))
            hang = t ** 1.2 * 0.85
            wl = float(np.clip(0.5 + p[0] / 0.3, 0.0, 1.0))
            legs = 0.38 * hang
            w = {"hips": 1.0 - hang, "skirt_front": hang - legs}
            if wl > 1e-3:
                w["thigh_l"] = legs * wl
            if wl < 1 - 1e-3:
                w["thigh_r"] = legs * (1 - wl)
        weights.append(w)
    assign_weights(obj, weights, arm)
    return obj


def band(info, arm, name, z, height, offset, segments=48, under=None, centre=None):
    """Closed band (belt, waist tie) hugging the layer below at height z."""
    section = ring_section(info, z, band=0.015)
    centre = centre if centre is not None else np.array([0.0, float(section[:, 1].mean())])
    hull = convex_hull(section)
    angles, radius = resample_loop(hull, segments, centre)
    verts, faces = [], []
    for k, dz in enumerate((-height / 2, height / 2)):
        for a, r in zip(angles, radius + offset):
            verts.append((centre[0] + math.sin(a) * r, centre[1] - math.cos(a) * r, z + dz))
    for s in range(segments):
        a, b = s, (s + 1) % segments
        faces.append((a, b, b + segments, a + segments))
    obj = new_mesh(name, np.array(verts), faces)
    if under is not None:
        push_outside(obj, (under,), offset * 0.5)
    binding = SurfaceBinding(info.body)
    assign_weights(obj, binding.transfer_weights(binding.bind(vertex_array(obj))), arm)
    return obj


def limb_roll(info, arm, name, bone, t, minor, offset, segments=28, rings=8):
    """Rolled-up sleeve: a torus around the limb section at parameter t along the bone."""
    head, tail = info.bones[bone]
    axis = (tail - head) / np.linalg.norm(tail - head)
    centre = head + (tail - head) * t
    # section radius from body vertices of this limb near the plane
    sel = [i for i in range(len(info.v)) if info.dominant[i] in (bone, bone.replace("upperarm", "forearm"))
           and abs(np.dot(info.v[i] - centre, axis)) < 0.012]
    pts = info.v[sel] - centre
    radial = pts - np.outer(pts @ axis, axis)
    major = float(np.percentile(np.linalg.norm(radial, axis=1), 90)) + offset + minor
    ref = np.cross(axis, [0, 0, 1.0])
    if np.linalg.norm(ref) < 1e-3:
        ref = np.cross(axis, [1.0, 0, 0])
    ref /= np.linalg.norm(ref)
    ref2 = np.cross(axis, ref)
    verts, faces = [], []
    for s in range(segments):
        a = 2 * math.pi * s / segments
        dirv = ref * math.cos(a) + ref2 * math.sin(a)
        for r in range(rings):
            b = 2 * math.pi * r / rings
            # flattened roll: thicker radially than along the arm
            p = centre + dirv * (major + minor * math.cos(b)) + axis * (minor * 0.8 * math.sin(b))
            verts.append(p)
    for s in range(segments):
        for r in range(rings):
            a = s * rings + r
            b = s * rings + (r + 1) % rings
            c = ((s + 1) % segments) * rings + (r + 1) % rings
            d = ((s + 1) % segments) * rings + r
            faces.append((a, b, c, d))
    obj = new_mesh(name, np.array(verts), faces)
    binding = SurfaceBinding(info.body)
    assign_weights(obj, binding.transfer_weights(binding.bind(vertex_array(obj))), arm)
    return obj


def pouch(info, arm, name, side=-1):
    """Small leather pouch hanging from the belt on one hip (side -1 = character's right)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.11, v.co.y * 0.045, v.co.z * 0.13))
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2, use_grid_fill=True)
    # round the box into a soft bag
    for v in bm.verts:
        d = Vector((v.co.x / 0.055, v.co.y / 0.0225, v.co.z / 0.065))
        k = 0.35
        v.co = Vector((v.co.x * (1 - k * (d.y ** 2) * 0.3), v.co.y * (1 - k * (d.x ** 2) * 0.3) * (1.0 + 0.25 * (v.co.z < 0)), v.co.z))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    section = ring_section(info, info.waist_z - 0.07, band=0.02)
    x = section[:, 0].min() if side < 0 else section[:, 0].max()
    y = float(section[:, 1].mean()) - 0.03
    obj.location = (x * 1.02 + side * 0.012, y, info.waist_z - 0.085)
    obj.rotation_euler = (0.0, 0.0, side * 0.35)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for p in obj.data.polygons:
        p.use_smooth = True
    assign_weights(obj, [{"hips": 0.8, f"thigh_{'r' if side < 0 else 'l'}": 0.2} for _ in obj.data.vertices], arm)
    return obj


def shoe_hulls(info, arm, name, region, top_z, spec):
    """Turnshoes: per-foot convex hull of the foot plus allowance, voxel-remeshed to even quads,
    opened at the ankle and weighted from the body surface."""
    objs = []
    for side in ("l", "r"):
        ids = [i for i in range(len(info.v)) if region(i) and info.dominant[i].endswith("_" + side)]
        pts = info.v[ids] + info.n[ids] * spec["allowance"]
        bm = bmesh.new()
        for p in pts:
            bm.verts.new(Vector(p))
        bmesh.ops.convex_hull(bm, input=bm.verts[:])
        me = bpy.data.meshes.new(f"{name}_{side}")
        bm.to_mesh(me)
        bm.free()
        obj = bpy.data.objects.new(f"{name}_{side}", me)
        bpy.context.scene.collection.objects.link(obj)
        mod = obj.modifiers.new("Remesh", "REMESH")
        mod.mode = "VOXEL"
        mod.voxel_size = spec["voxel"]
        _apply_modifiers(obj, ("REMESH",))
        co = vertex_array(obj)
        co[:, 2] = np.maximum(co[:, 2], 0.0)
        obj.data.vertices.foreach_set("co", co.ravel())
        obj.data.update()
        _smooth(obj, 4, 0.5, keep_boundary=False)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z > top_z], context="FACES")
        bm.to_mesh(obj.data)
        bm.free()
        objs.append(obj)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    shoes = bpy.context.view_layer.objects.active
    shoes.name = name
    for p in shoes.data.polygons:
        p.use_smooth = True
    binding = SurfaceBinding(info.body)
    assign_weights(shoes, binding.transfer_weights(binding.bind(vertex_array(shoes))), arm)
    return shoes


def clear_in_front(panel, layers, clearance, cell=0.02):
    """Keep every vertex of a front panel at least `clearance` in front (-Y) of the most forward vertex of
    the layers behind it within the neighbouring cells, so bulges between panel vertices cannot poke through."""
    pts = np.vstack([vertex_array(o) for o in layers])
    keys = {}
    for x, y, z in pts:
        k = (int(math.floor(x / cell)), int(math.floor(z / cell)))
        keys[k] = min(keys.get(k, 1e9), y)
    co = vertex_array(panel)
    for i, (x, y, z) in enumerate(co):
        kx, kz = int(math.floor(x / cell)), int(math.floor(z / cell))
        front = min((keys.get((kx + dx, kz + dz), 1e9) for dx in (-1, 0, 1) for dz in (-1, 0, 1)))
        if front < 1e8:
            co[i, 1] = min(y, front - clearance)
    panel.data.vertices.foreach_set("co", co.ravel())
    panel.data.update()


class HullField:
    """Convex-hull radius of the body section (arms excluded) sampled over height and angle."""

    def __init__(self, info, z_lo, z_hi, centre, step=0.01, samples=128):
        self.z = np.arange(z_lo, z_hi + step, step)
        self.centre = centre
        self.angles = np.linspace(-math.pi, math.pi, samples, endpoint=False)
        self.r = np.zeros((len(self.z), samples))
        for k, z in enumerate(self.z):
            hull = convex_hull(ring_section(info, z, band=0.008))
            _a, self.r[k] = resample_loop(hull, samples, centre)

    def radius(self, z, angle):
        k = np.clip((z - self.z[0]) / (self.z[1] - self.z[0]), 0, len(self.z) - 1.001)
        k0 = int(k)
        f = k - k0
        a = (angle + math.pi) / (2 * math.pi) * len(self.angles)
        a0 = int(math.floor(a)) % len(self.angles)
        a1 = (a0 + 1) % len(self.angles)
        fa = a - math.floor(a)
        row = lambda kk: self.r[kk, a0] * (1 - fa) + self.r[kk, a1] * fa
        return row(k0) * (1 - f) + row(min(k0 + 1, len(self.z) - 1)) * f


def drape_to_hull(obj, info, index, field, ease_of, z_top, z_fade=0.05):
    """Push torso shell vertices out onto the hull so cloth spans hollows instead of hugging them."""
    co = vertex_array(obj)
    cx, cy = field.centre
    for k, i in enumerate(index):
        if info.dominant[i] not in TORSO_BONES:
            continue
        x, y, z = co[k]
        if z > z_top:
            continue
        fade = min(1.0, (z_top - z) / z_fade)
        ang = math.atan2(x - cx, -(y - cy))
        r_now = math.hypot(x - cx, y - cy)
        r_target = field.radius(z, ang) + ease_of(z)
        if r_target > r_now:
            r = r_now + (r_target - r_now) * fade
            co[k, 0] = cx + math.sin(ang) * r
            co[k, 1] = cy - math.cos(ang) * r
    obj.data.vertices.foreach_set("co", co.ravel())
    obj.data.update()


def _loops_near(obj, predicate):
    co = vertex_array(obj)
    return [loop for loop in boundary_loops(obj) if np.mean([predicate(co[i]) for i in loop]) > 0.6]


def ribbon(info, arm, name, points, width, thickness, outward_tree, gap):
    """Flat strap along a smoothed path (Catmull-Rom), lying on the layer beneath."""
    pts = [Vector(p) for p in points]
    dense = []
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(len(pts) - 1, i + 2)]
        for k in range(3):
            t = k / 3
            t2, t3 = t * t, t * t * t
            dense.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    dense.append(pts[-1])
    verts, faces = [], []
    for i, p in enumerate(dense):
        tangent = (dense[min(i + 1, len(dense) - 1)] - dense[max(i - 1, 0)]).normalized()
        loc, normal, _f, _d = outward_tree.find_nearest(p)
        n = normal if loc is not None else Vector((0, 0, 1))
        side = tangent.cross(n).normalized()
        base = (loc + n * gap) if loc is not None else p
        for s_off, n_off in ((-0.5, 0.0), (0.5, 0.0), (0.5, thickness), (-0.5, thickness)):
            verts.append(base + side * width * s_off + n * n_off)
    rings = len(dense)
    for i in range(rings - 1):
        for k in range(4):
            a, b = i * 4 + k, i * 4 + (k + 1) % 4
            faces.append((a, b, b + 4, a + 4))
    obj = new_mesh(name, np.array([tuple(v) for v in verts]), faces)
    binding = SurfaceBinding(info.body)
    assign_weights(obj, binding.transfer_weights(binding.bind(vertex_array(obj))), arm)
    return obj


def build(body, arm, recipe, report):
    info = BodyInfo(body, arm)
    g = recipe["garments"]
    tg = g["tunic"]
    arms_up = ("upperarm_l", "upperarm_r")
    sleeve_t = tg["sleeveEnd"]
    neck_y = float(info.bones["neck"][0][1])
    armpit_z = float(info.bones["upperarm_l"][0][2]) - tg["armpitBelowShoulder"]
    belt_z = info.waist_z + g["belt"]["aboveWaist"]
    belt_h = g["belt"]["height"]
    hem_z = info.knee_z + tg["hemAboveKnee"]
    centre = np.array([0.0, float(np.mean(info.v[:, 1][np.abs(info.v[:, 2] - info.hip_z) < 0.02]))])
    field = HullField(info, hem_z - 0.02, armpit_z + 0.02, centre)
    body_tree = info.tree

    def neck_open(i, r, slit):
        p = info.v[i]
        if p[2] > info.neck_z + 0.012:
            return True
        if p[2] > info.neck_z - 0.03 and math.hypot(p[0], p[1] - neck_y) < r + max(0.0, p[2] - (info.neck_z - 0.03)) * 0.5:
            return True
        return bool(slit and abs(p[0]) < 0.016 and p[1] < neck_y - 0.03 and info.neck_z - tg["slitDepth"] < p[2])

    def upper(i, sleeve_end, r, slit, z_min):
        d = info.dominant[i]
        if info.v[i][2] < z_min:
            return False
        if d in TORSO_BONES:
            return not neck_open(i, r, slit)
        if d in arms_up:
            return info.limb_t(i, d) < sleeve_end
        return False

    pieces = {}
    near_neck = lambda p: p[2] > info.neck_z - 0.06
    near_sleeve = lambda p: p[2] < armpit_z + 0.12 and abs(p[0]) > 0.14

    # Linen undershirt: only its collar shows inside the tunic opening.
    shirt, shirt_idx = _shell(info, "Undershirt", lambda i: upper(i, 0.2, tg["neckRadius"] - 0.016, False, info.neck_z - 0.15), 0.0045, smooth=10)
    push_outside(shirt, (body_tree,), 0.003)
    _copy_body_weights(shirt, info, shirt_idx, arm)
    for loop in _loops_near(shirt, near_neck):
        relax_loop(shirt, loop, 20)
        fold_band(shirt, loop, 0.003, 0.010, lip=0.003)
    pieces["Undershirt"] = shirt

    # Wool tunic: one shell for shoulders, sleeves and torso, draped over hollows onto the hull.
    tunic, tunic_idx = _shell(info, "Tunic", lambda i: upper(i, sleeve_t, tg["neckRadius"], True, belt_z - belt_h * 0.3),
                              tg["offset"], smooth=24)
    ease = lambda z: np.interp(z, [belt_z - 0.02, belt_z + 0.03, belt_z + 0.09, armpit_z - 0.04, armpit_z],
                               [0.010, 0.020, tg["blouse"], 0.016, 0.012])
    drape_to_hull(tunic, info, tunic_idx, field, ease, armpit_z - 0.01)
    _smooth(tunic, 6, 0.4)
    push_outside(tunic, (tree_of([shirt]),), 0.003)
    push_outside(tunic, (body_tree,), 0.009)
    _copy_body_weights(tunic, info, tunic_idx, arm)
    for loop in _loops_near(tunic, near_neck):
        relax_loop(tunic, loop, 25)
        fold_band(tunic, loop, 0.004, 0.012, lip=0.004)
    for loop in _loops_near(tunic, near_sleeve):
        relax_loop(tunic, loop, 15)
        fold_band(tunic, loop, 0.007, tg["cuffWidth"], lip=0.006)
    for loop in _loops_near(tunic, lambda p: p[2] < belt_z + 0.02):
        relax_loop(tunic, loop, 15)
    pieces["Tunic"] = tunic

    def legs(i):
        d = info.dominant[i]
        p = info.v[i]
        return (d.startswith("thigh") or d.startswith("calf") or (d == "hips" and p[2] < belt_z)) and info.ankle_z + 0.035 < p[2] < belt_z
    trousers, trousers_idx = _shell(info, "Trousers", legs, 0.0065, smooth=18)
    push_outside(trousers, (body_tree,), 0.005)
    _copy_body_weights(trousers, info, trousers_idx, arm)
    pieces["Trousers"] = trousers

    wrap_top = info.knee_z - g["legWraps"]["belowKnee"]

    def wraps(i):
        d = info.dominant[i]
        return (d.startswith("calf") or d.startswith("thigh") or d.startswith("foot")) and info.ankle_z + 0.012 < info.v[i][2] < wrap_top
    wraps_obj, wraps_idx = _shell(info, "LegWraps", wraps, 0.0135, smooth=14)
    push_outside(wraps_obj, (tree_of([trousers]),), 0.004)
    _copy_body_weights(wraps_obj, info, wraps_idx, arm)
    pieces["LegWraps"] = wraps_obj

    def feet(i):
        d = info.dominant[i]
        return d.startswith("foot") or d.startswith("toes") or (info.v[i][2] < info.ankle_z + 0.04 and d.startswith("calf"))
    shoes = shoe_hulls(info, arm, "Shoes", feet, info.ankle_z + g["shoes"]["topAboveAnkle"], g["shoes"])
    pieces["Shoes"] = shoes

    side = g["glove"]["side"]
    hand_bones = {f"hand_{side}"} | {f"{f}_{k:02d}_{side}" for f in ("thumb", "index", "middle", "ring", "pinky") for k in (1, 2, 3)}
    fore = f"forearm_{side}"
    glove_obj, glove_idx = _shell(info, "Glove", lambda i: info.dominant[i] in hand_bones or (info.dominant[i] == fore and info.limb_t(i, fore) > g["glove"]["cuffT"]),
                                  0.0032, smooth=3, smooth_factor=0.3)
    push_outside(glove_obj, (body_tree,), 0.0025)
    _copy_body_weights(glove_obj, info, glove_idx, arm)
    pieces["Glove"] = glove_obj

    # Skirt of the tunic from under the belt to the hem, hanging from the hips.
    def skirt_radius(z, angles, hull_r):
        t = np.clip((belt_z - z) / max(1e-3, belt_z - hem_z), 0, 1)
        hips = np.array([field.radius(min(z, info.hip_z), a) for a in angles])
        base = np.maximum(hull_r, hips * np.clip((belt_z - z) / 0.08, 0, 1) + hull_r * (1 - np.clip((belt_z - z) / 0.08, 0, 1)))
        fold = tg["foldAmplitude"] * t ** 1.4 * (np.sin(tg["folds"] * angles + 0.9) * 0.65 + np.sin(tg["folds"] * 0.43 * angles + 2.1) * 0.35)
        return base + np.interp(t, [0, 0.12, 1], [0.012, tg["easeTop"], tg["easeHem"]]) + fold
    levels = list(np.linspace(belt_z + belt_h * 0.3, hem_z, tg.get("rings", 14)))
    skirt, rows, _c = hull_tube(info, arm, "TunicSkirt", levels, skirt_radius, segments=tg.get("segments", 48), centre=centre)
    push_outside(skirt, (tree_of([trousers]),), 0.012)
    skirt_weights(info, skirt, rows, centre, belt_z - 0.01, info.hip_z - 0.03, hem_z, arm)
    pieces["TunicSkirt"] = skirt

    z_top = info.chest_z + g["apron"]["topAboveChest"]
    apron = apron_panel(info, arm, "Apron", z_top, info.knee_z - g["apron"]["belowKnee"],
                        g["apron"]["widths"], cols=14, rows=28, standoff=g["apron"].get("standoff", 0.016), under_tree=tree_of([tunic, skirt]))
    clear_in_front(apron, [tunic, skirt, shirt], g["apron"].get("clearance", 0.015))
    # per-vertex pushes can fold the panel: relax it, push again, and keep its faces pointing forward
    _smooth(apron, 6, 0.5)
    clear_in_front(apron, [tunic, skirt, shirt], g["apron"].get("clearance", 0.015))
    _smooth(apron, 2, 0.3)
    bm = bmesh.new()
    bm.from_mesh(apron.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if sum(f.normal.y for f in bm.faces) > 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.to_mesh(apron.data)
    bm.free()
    apron.data.update()
    if "Apron" in g.get("drape", {}):
        aco = vertex_array(apron)
        top = aco[:, 2].max()
        pin = np.where((aco[:, 2] > top - 0.02) | (np.abs(aco[:, 2] - (belt_z + belt_h * 0.5)) < 0.02))[0]
        drape(apron, [body, tunic, skirt, shirt, trousers], pin, g["drape"]["Apron"], report)
        clear_in_front(apron, [tunic, skirt, shirt], g["apron"].get("clearance", 0.015))
    report["apronBackwardFaces"] = sum(1 for p in apron.data.polygons if p.normal.y > 0.2)
    pieces["Apron"] = apron
    # neck strap: from the bib corners over the trapezius and around the back of the neck
    co = vertex_array(apron)
    top = co[np.abs(co[:, 2] - co[:, 2].max()) < 1e-4]
    left, right = top[np.argmax(top[:, 0])], top[np.argmin(top[:, 0])]
    strap_surface = tree_of([tunic, shirt])
    neck_y = float(info.bones["neck"][0][1])
    path = [tuple(left), (0.10, neck_y - 0.06, info.neck_z - 0.05), (0.075, neck_y, info.neck_z - 0.015),
            (0.05, neck_y + 0.055, info.neck_z - 0.03), (0.0, neck_y + 0.07, info.neck_z - 0.035),
            (-0.05, neck_y + 0.055, info.neck_z - 0.03), (-0.075, neck_y, info.neck_z - 0.015),
            (-0.10, neck_y - 0.06, info.neck_z - 0.05), tuple(right)]
    pieces["ApronStrap"] = ribbon(info, arm, "ApronStrap", path, 0.022, 0.003, strap_surface, 0.004)
    belt = band(info, arm, "Belt", belt_z, belt_h, 0.026, under=tree_of([tunic, skirt, apron]))
    pieces["Belt"] = belt
    pieces["Pouch"] = pouch(info, arm, "Pouch", side=-1)
    for name, ratio in g.get("decimate", {}).items():
        if name in pieces and ratio < 1.0:
            mod = pieces[name].modifiers.new("Decimate", "DECIMATE")
            mod.ratio = ratio
            mod.use_collapse_triangulate = False
            _apply_modifiers(pieces[name], ("DECIMATE",))
    for name in ("TunicSkirt", "Apron", "Shoes", "Glove", "LegWraps"):
        _rim(pieces[name], {"Apron": 0.0045, "Shoes": 0.004, "Glove": 0.002, "LegWraps": 0.004}.get(name, 0.003))
        _apply_modifiers(pieces[name])

    # Delete body skin that clothing covers completely (a margin stays under every opening).
    covered = np.zeros(len(info.v), dtype=bool)
    for i in range(len(info.v)):
        p, d = info.v[i], info.dominant[i]
        if upper(i, sleeve_t - 0.08, tg["neckRadius"] + 0.03, False, belt_z - 0.06) and p[2] < info.neck_z - 0.035:
            covered[i] = True
        elif (d.startswith("thigh") or d.startswith("calf") or d == "hips") and info.ankle_z + 0.03 < p[2] < belt_z + 0.01:
            covered[i] = True
        elif (d.startswith("foot") or d.startswith("toes")) and p[2] < info.ankle_z - 0.005:
            covered[i] = True
        elif d in hand_bones:
            covered[i] = True
    faces = [f.index for f in body.data.polygons if all(covered[v] for v in f.vertices)]
    from scene import delete_faces
    before = triangle_count(body)
    delete_faces(body, faces)
    report["garments"] = {name: triangle_count(o) for name, o in pieces.items()}
    report["bodyTrianglesAfterCover"] = triangle_count(body)
    report["bodyTrianglesRemoved"] = before - triangle_count(body)
    report["garmentLandmarks"] = {"armpitZ": armpit_z, "beltZ": belt_z, "hemZ": hem_z, "kneeZ": info.knee_z, "ankleZ": info.ankle_z}
    for o in pieces.values():
        o["crownfall_part"] = "garment"
    return pieces

"""Stage: original layered garments for the smithy household (spinner, child, elder).

Crownfall original work, built from the shaped body like the smith's garments (garments.py):
shells copy the body surface in a region, are offset, draped over hollows and pushed outside the
layer beneath; long skirts, the cloak and aprons are generated tubes and panels whose lower parts
follow the thighs and shins as well as the shared skirt bones, so ankle-length cloth clears the
legs while walking and sitting. Head-cloths, the hood, the shawl and the vest are original shapes
over the head and torso. Body skin completely hidden under opaque layers is deleted.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

import garments as G
from scene import SurfaceBinding, assign_weights, delete_faces, new_mesh, select_only, triangle_count, vertex_array

ARM = ("upperarm", "forearm", "hand", "thumb", "index", "middle", "ring", "pinky")
FINGERS = ("thumb", "index", "middle", "ring", "pinky")


def fam(bone):
    return bone.split("_")[0]


def smoothstep(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


class Frame:
    """Landmarks used by every outfit (rest pose, metres)."""

    def __init__(self, info, arm):
        self.info = info
        b = info.bones
        self.neck_y = float(b["neck"][0][1])
        self.shoulder_z = float(b["upperarm_l"][0][2])
        self.shoulder_x = float(b["upperarm_l"][0][0])
        self.scale = info.hip_z / 0.935  # 1.0 for the smith-sized adult
        self.armpit_z = self.shoulder_z - 0.1 * self.scale
        self.centre = np.array([0.0, float(np.mean(info.v[:, 1][np.abs(info.v[:, 2] - info.hip_z) < 0.02]))])
        self.eye = (np.array(b["face_eye_l"][0]) + np.array(b["face_eye_r"][0])) / 2
        self.head_top = float(info.v[:, 2].max())

    def s(self, metres):
        return metres * self.scale


def nsmooth_compat(obj, iterations, factor=0.5, keep_boundary=True):
    nsmooth(obj, iterations, factor, keep_boundary)


def nsmooth(obj, iterations, factor=0.5, keep_boundary=True, renormal_every=4):
    """Smoothing along vertex normals only. Uniform Laplacian smoothing pulls the dense rings of the
    hm08 topology (nipples, navel, ears) into folded slivers that shade as dark spikes; moving each
    vertex only along its normal flattens bumps while the ring spacing stays intact."""
    if iterations <= 0:
        return
    from scene import normals_array
    me = obj.data
    co = vertex_array(obj)
    n = len(co)
    rows, cols = [], []
    for e in me.edges:
        a, b = e.vertices
        rows += [a, b]
        cols += [b, a]
    rows, cols = np.array(rows), np.array(cols)
    deg = np.bincount(rows, minlength=n).astype(float)
    free = deg > 0
    if keep_boundary:
        bm = bmesh.new()
        bm.from_mesh(me)
        for v in bm.verts:
            if v.is_boundary:
                free[v.index] = False
        bm.free()
    normals = normals_array(obj)
    for k in range(iterations):
        if k and k % renormal_every == 0:
            me.vertices.foreach_set("co", co.ravel())
            me.update()
            normals = normals_array(obj)
        acc = np.zeros_like(co)
        np.add.at(acc, rows, co[cols])
        avg = acc / np.maximum(deg, 1)[:, None]
        d = ((avg - co) * normals).sum(axis=1)
        co[free] += normals[free] * (d[free] * factor)[:, None]
    me.vertices.foreach_set("co", co.ravel())
    me.update()


def smooth_normals(info, radius=0.014):
    """Body normals averaged over a small neighbourhood (cached): offsets along them cannot crumple the
    tiny dense rings of the hm08 topology (nipples, navel), whose own normals diverge."""
    if getattr(info, "_soft_n", None) is not None:
        return info._soft_n
    from mathutils.kdtree import KDTree
    kd = KDTree(len(info.v))
    for i, p in enumerate(info.v):
        kd.insert(p, i)
    kd.balance()
    out = np.zeros_like(info.n)
    for i, p in enumerate(info.v):
        idx = [j for (_c, j, _d) in kd.find_range(Vector(p), radius)]
        n = info.n[idx].sum(axis=0) if idx else info.n[i]
        out[i] = n / (np.linalg.norm(n) + 1e-12)
    info._soft_n = out
    return out


def clean_boundary(obj, passes=3):
    """Delete 'ear' faces (two or more boundary edges): shell boundaries cut along mesh edges zigzag,
    and folded hems on ears turn into spikes."""
    for _ in range(passes):
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        ears = [f for f in bm.faces if sum(1 for e in f.edges if e.is_boundary) >= 2]
        if not ears:
            bm.free()
            break
        bmesh.ops.delete(bm, geom=ears, context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()


def fold_hem(obj, loop, outward, back, lip=0.004):
    """Turn a garment edge back on itself (hem, cuff, neckband) like garments.fold_band, with the inward
    direction taken across the loop tangent (oriented toward the cloth) instead of from inner edges,
    which do not exist at boundary corners and sent those hems straight up as spikes."""
    from scene import normals_array
    me = obj.data
    co = vertex_array(obj)
    normals = normals_array(obj)
    n = len(loop)
    if n < 3:
        return
    closed = loop[0] in {e.vertices[0] for e in me.edges if loop[-1] in e.vertices} | {e.vertices[1] for e in me.edges if loop[-1] in e.vertices}
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    centres = []
    for i in loop:
        faces = bm.verts[i].link_faces
        centres.append(np.mean([np.array(f.calc_center_median()) for f in faces], axis=0) if faces else co[i])
    bm.free()
    inward = []
    for k, i in enumerate(loop):
        a = loop[(k - 1) % n] if closed or k > 0 else loop[k]
        b = loop[(k + 1) % n] if closed or k < n - 1 else loop[k]
        t = co[b] - co[a]
        t = t / (np.linalg.norm(t) + 1e-12)
        d = np.cross(normals[i], t)
        d = d / (np.linalg.norm(d) + 1e-12)
        if np.dot(d, centres[k] - co[i]) < 0:
            d = -d
        inward.append(d)
    names = {g.index: g.name for g in obj.vertex_groups}
    weights = [{names[g.group]: g.weight for g in me.vertices[i].groups} for i in loop]
    ring1 = [co[i] + normals[i] * outward - inward[k] * lip for k, i in enumerate(loop)]
    ring2 = [co[i] + normals[i] * outward * 1.15 + inward[k] * back for k, i in enumerate(loop)]
    base = len(me.vertices)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    old = [bm.verts[i] for i in loop]
    r1 = [bm.verts.new(Vector(p)) for p in ring1]
    r2 = [bm.verts.new(Vector(p)) for p in ring2]
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
    for start in (base, base + n):
        for k in range(n):
            for bone, w in weights[k].items():
                groups[bone].add([start + k], w, "REPLACE")


def shell(info, name, keep, offset, smooth=12, factor=0.5):
    """garments._shell with ear faces removed, offset along smoothed normals, smoothed along normals only."""
    obj, _idx = G._shell(info, name, keep, 0.0, smooth=0)
    clean_boundary(obj)
    idx = G._nearest_body_vertices(info, vertex_array(obj))
    co = vertex_array(obj)
    obj.data.vertices.foreach_set("co", (co + smooth_normals(info)[idx] * offset).ravel())
    obj.data.update()
    nsmooth(obj, smooth, factor)
    return obj, idx


def soften_chest(body, arm, iterations=60):
    """Smooth away nipples and small chest detail on the (later covered) body skin so cloth shells built
    from it drape instead of printing anatomy. All shape keys move together (face morphs are unaffected
    here because their deltas are zero on the chest)."""
    me = body.data
    co = vertex_array(body)
    b = arm.data.bones
    chest_z = float(b["spine_03"].head_local.z)
    neck_z = float(b["neck"].head_local.z)
    sel = np.where((co[:, 2] > chest_z - 0.14) & (co[:, 2] < neck_z - 0.06) & (np.abs(co[:, 0]) < 0.17) & (co[:, 1] < float(b["spine_03"].head_local.y)))[0]
    if not len(sel):
        return
    adjacency = [[] for _ in range(len(co))]
    for e in me.edges:
        a, c = e.vertices
        adjacency[a].append(c)
        adjacency[c].append(a)
    from scene import normals_array
    normals = normals_array(body)
    new = co.copy()
    # move only along the surface normal: bumps flatten while dense rings (nipple, areola) keep their
    # spacing instead of collapsing into folded slivers that shade as dark spots
    for it in range(iterations):
        if it and it % 4 == 0:
            me.vertices.foreach_set("co", new.ravel())
            me.update()
            normals = normals_array(body)
        nxt = new.copy()
        for i in sel:
            nb = adjacency[i]
            if nb:
                d = new[nb].mean(axis=0) - new[i]
                nxt[i] = new[i] + normals[i] * float(d @ normals[i]) * 0.5
        new = nxt
    delta = new - co
    me.vertices.foreach_set("co", new.ravel())
    if me.shape_keys:
        for kb in me.shape_keys.key_blocks:
            k = np.zeros(len(co) * 3)
            kb.data.foreach_get("co", k)
            kb.data.foreach_set("co", (k.reshape(-1, 3) + delta).ravel())
    me.update()


def _flatten_bust(proxy, z_lo, z_hi, half_x, front_y, amount, falloff=0.04):
    """Compress whatever bulges in front of the straight line from the collarbone to the upper waist,
    column by column across the chest. A period kirtle, tunic or vest spans the bust instead of printing
    it, and the earlier all-axis smoothing kept the apex: shells built on it showed the bust as two
    points through every layer. The torso's horizontal curvature is kept (each column has its own
    line), only forward bulges move back (Y), and the effect fades out toward the sides."""
    if amount <= 0:
        return
    me = proxy.data
    co = vertex_array(proxy)
    front = co[:, 1] < front_y
    bins = np.arange(-half_x, half_x + 1e-6, 0.01)

    def edge_profile(z0, z1):
        sel = front & (co[:, 2] >= z0) & (co[:, 2] <= z1) & (np.abs(co[:, 0]) < half_x + 0.01)
        xs, ys = co[sel, 0], co[sel, 1]
        out = []
        for b in bins:
            m = np.abs(xs - b) < 0.008
            out.append(ys[m].min() if m.any() else np.nan)
        out = np.array(out)
        ok = ~np.isnan(out)
        return np.interp(bins, bins[ok], out[ok]) if ok.any() else None
    top = edge_profile(z_hi - 0.02, z_hi)
    bot = edge_profile(z_lo, z_lo + 0.02)
    if top is None or bot is None:
        return
    inside = front & (co[:, 2] > z_lo) & (co[:, 2] < z_hi) & (np.abs(co[:, 0]) < half_x)
    t = np.clip((co[:, 2] - z_lo) / (z_hi - z_lo), 0, 1)
    line = np.interp(co[:, 0], bins, bot) * (1 - t) + np.interp(co[:, 0], bins, top) * t
    side = np.clip((half_x - np.abs(co[:, 0])) / falloff, 0, 1)
    vert = np.clip(np.minimum(co[:, 2] - z_lo, z_hi - co[:, 2]) / 0.02, 0, 1)
    w = side * side * (3 - 2 * side) * vert
    bulge = inside & (co[:, 1] < line)
    co[bulge, 1] = line[bulge] + (co[bulge, 1] - line[bulge]) * (1 - amount * w[bulge])
    me.vertices.foreach_set("co", co.ravel())
    me.update()


def garment_proxy(body, arm, merge=0.0036, flatten=80, membrane=0.85):
    """A copy of the shaped body for building cloth: the dense hm08 rings on the chest (nipples) are
    merged and the chest flattened, so shells, offsets and push-outside never inherit sliver faces with
    divergent normals (they render as dark spikes through every layer). Weights stay on the copy; the
    real body is untouched except for the final covered-skin deletion."""
    proxy = body.copy()
    proxy.data = body.data.copy()
    proxy.name = proxy.data.name = "GarmentProxy"
    bpy.context.scene.collection.objects.link(proxy)
    if proxy.data.shape_keys:
        proxy.shape_key_clear()
    co = vertex_array(proxy)
    b = arm.data.bones
    chest_z = float(b["spine_03"].head_local.z)
    neck_z = float(b["neck"].head_local.z)
    front_y = float(b["spine_03"].head_local.y)
    region = (co[:, 2] > chest_z - 0.16) & (co[:, 2] < neck_z - 0.05) & (np.abs(co[:, 0]) < 0.18) & (co[:, 1] < front_y)
    bm = bmesh.new()
    bm.from_mesh(proxy.data)
    bm.verts.ensure_lookup_table()
    verts = [bm.verts[i] for i in np.where(region)[0]]
    bmesh.ops.remove_doubles(bm, verts=verts, dist=merge)
    bmesh.ops.dissolve_degenerate(bm, dist=merge * 0.5, edges=bm.edges[:])
    bm.to_mesh(proxy.data)
    bm.free()
    proxy.data.update()
    co = vertex_array(proxy)
    region = (co[:, 2] > chest_z - 0.16) & (co[:, 2] < neck_z - 0.05) & (np.abs(co[:, 0]) < 0.18) & (co[:, 1] < front_y)
    bm = bmesh.new()
    bm.from_mesh(proxy.data)
    bm.verts.ensure_lookup_table()
    chest = [v for v in bm.verts if region[v.index] and not v.is_boundary]
    for _ in range(flatten):
        bmesh.ops.smooth_vert(bm, verts=chest, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    bm.to_mesh(proxy.data)
    bm.free()
    proxy.data.update()
    _flatten_bust(proxy, chest_z - 0.16, neck_z - 0.05, 0.18, front_y, membrane)
    # ears: the hood and head-cloths pass over them; their dense folds crumple offset shells
    co = vertex_array(proxy)
    eye_l, eye_r = np.array(b["face_eye_l"].head_local), np.array(b["face_eye_r"].head_local)
    eye = (eye_l + eye_r) / 2
    ears = (np.abs(co[:, 0]) > abs(eye_l[0]) + 0.03) & (np.abs(co[:, 2] - eye[2]) < 0.05) & (co[:, 1] > eye[1] + 0.04) & (co[:, 1] < eye[1] + 0.13)
    bm = bmesh.new()
    bm.from_mesh(proxy.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.remove_doubles(bm, verts=[bm.verts[i] for i in np.where(ears)[0]], dist=merge)
    bm.verts.ensure_lookup_table()
    co2 = np.array([v.co[:] for v in bm.verts])
    ears2 = (np.abs(co2[:, 0]) > abs(eye_l[0]) + 0.03) & (np.abs(co2[:, 2] - eye[2]) < 0.05) & (co2[:, 1] > eye[1] + 0.04) & (co2[:, 1] < eye[1] + 0.13)
    ear_verts = [v for v in bm.verts if ears2[v.index] and not v.is_boundary]
    for _ in range(30):
        bmesh.ops.smooth_vert(bm, verts=ear_verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    bm.to_mesh(proxy.data)
    bm.free()
    proxy.data.update()
    return proxy


class SoftHull(G.HullField):
    """Hull radius field low-pass filtered around the body and over height: cloth spans the bust and
    shoulder blades as a rounded surface instead of tenting to points at the hull corners."""

    def __init__(self, info, z_lo, z_hi, centre, step=0.01, samples=128, around=7, up=2):
        super().__init__(info, z_lo, z_hi, centre, step, samples)
        r = self.r
        for _ in range(3):
            acc = np.zeros_like(r)
            for k in range(-around, around + 1):
                acc += np.roll(r, k, axis=1)
            r = acc / (2 * around + 1)
        for _ in range(up):
            pad = np.pad(r, ((1, 1), (0, 0)), mode="edge")
            r = (pad[:-2] + pad[1:-1] * 2 + pad[2:]) / 4
        # body clearance is restored afterwards by push_outside, so corners may be rounded off here
        self.r = r


def neck_open(info, fr, i, radius, front_drop=0.0):
    p = info.v[i]
    if p[2] > info.neck_z + 0.012:
        return True
    front = p[1] < fr.neck_y
    r = radius + (front_drop * 0.6 if front else 0.0)
    depth = 0.03 + (front_drop if front else 0.0)
    return p[2] > info.neck_z - depth and math.hypot(p[0], p[1] - fr.neck_y) < r + max(0.0, p[2] - (info.neck_z - depth)) * 0.5


def upper_keep(info, fr, radius, z_min, upper_t=1.0, fore_t=None, front_drop=0.0):
    """Torso plus sleeves: whole upper arm and forearm to fore_t, or the upper arm to upper_t."""
    def keep(i):
        d = info.dominant[i]
        if info.v[i][2] < z_min:
            return False
        f = fam(d)
        if d in G.TORSO_BONES:
            return not neck_open(info, fr, i, radius, front_drop)
        if f == "upperarm":
            return fore_t is not None or info.limb_t(i, d) < upper_t
        if f == "forearm" and fore_t is not None:
            return info.limb_t(i, d) < fore_t
        return False
    return keep


def shell_layer(info, name, keep, offset, under=(), gap=0.003, body_gap=0.004, smooth=12, arm=None):
    obj, idx = shell(info, name, keep, offset, smooth=smooth)
    for tree in under:
        G.push_outside(obj, (tree,), gap)
    G.push_outside(obj, (info.tree,), body_gap)
    G._copy_body_weights(obj, info, idx, arm)
    return obj, idx


def edge_loops(obj, predicate):
    return G._loops_near(obj, predicate)


def hem_loops(obj, rel=1.0, lip=0.004, back=0.010, relax=15, predicate=None):
    for loop in (edge_loops(obj, predicate) if predicate else G.boundary_loops(obj)):
        G.relax_loop(obj, loop, relax)
        fold_hem(obj, loop, 0.003 * rel, back, lip=lip)


def leg_follow_weights(info, obj, centre, z_body, z_hang, z_hem, arm, front=0.85, back=0.25, calf=0.75, side_arm=0.0, arm_zone=None, hang_amount=0.3):
    """Long cloth below the waist: hips plus angle lobes of the skirt bones, plus a share of the thigh
    (and below the knee the shin) of the leg on the same side, so hems travel with the legs."""
    pts = vertex_array(obj)
    binding = SurfaceBinding(info.body)
    bound = binding.transfer_weights(binding.bind(pts))
    knee = info.knee_z
    weights = []
    for i, p in enumerate(pts):
        x, y, z = p
        if z >= z_body:
            w = dict(bound[i])
        else:
            ang = math.atan2(x - centre[0], -(y - centre[1]))
            lobes = {"skirt_front": max(0.0, math.cos(ang)), "skirt_back": max(0.0, -math.cos(ang)),
                     "skirt_l": max(0.0, math.sin(ang)), "skirt_r": max(0.0, -math.sin(ang))}
            total = sum(v ** 2 for v in lobes.values())
            hang = float(np.clip((z_hang - z) / max(1e-3, z_hang - z_hem), 0.0, 1.0)) ** 1.2 * hang_amount
            blend = float(np.clip((z_body - z) / max(1e-3, z_body - z_hang), 0.0, 1.0))
            frontness = (math.cos(ang) + 1.0) * 0.5
            share = (back + (front - back) * frontness) * smoothstep((z_body - z) / max(1e-3, z_body - knee))
            share *= blend
            wl = float(np.clip(0.5 + (x - centre[0]) / 0.13, 0.0, 1.0))
            lower = smoothstep((knee + 0.02 - z) / 0.25) * calf * (0.35 + 0.65 * smoothstep((frontness - 0.35) / 0.4))  # shins drive mostly the front
            w = {}
            for bone, value in bound[i].items():
                w[bone] = w.get(bone, 0.0) + value * (1 - blend)
            rest = blend - share
            w["hips"] = w.get("hips", 0.0) + rest * (1.0 - hang)
            for bone, value in lobes.items():
                if value > 1e-3:
                    w[bone] = w.get(bone, 0.0) + rest * hang * (value ** 2) / total
            for side, k in (("l", wl), ("r", 1.0 - wl)):
                if k > 1e-3:
                    w[f"thigh_{side}"] = w.get(f"thigh_{side}", 0.0) + share * k * (1 - lower)
                    if lower > 0:
                        w[f"calf_{side}"] = w.get(f"calf_{side}", 0.0) + share * k * lower
        if side_arm > 0 and arm_zone is not None and arm_zone[0] < z < arm_zone[1]:
            ang = math.atan2(x - centre[0], -(y - centre[1]))
            s = math.sin(ang)
            k = side_arm * smoothstep((abs(s) - 0.45) / 0.4) * smoothstep(min(z - arm_zone[0], arm_zone[1] - z) / 0.3)
            if k > 1e-3:
                w = {b: v * (1 - k) for b, v in w.items()}
                side = "l" if s > 0 else "r"
                w[f"upperarm_{side}"] = w.get(f"upperarm_{side}", 0.0) + k
        weights.append(w)
    assign_weights(obj, weights, arm)


def follow_layer(obj, outer, arm):
    """Give a layer the skin weights of the nearest point of another layer, so the two move as one: the spinner's
    underdress hem and apron had their own leg-follow weights and the overdress skirt pushed through the apron in a
    V and the underdress through the overdress at every stride."""
    binding = SurfaceBinding(outer)
    assign_weights(obj, binding.transfer_weights(binding.bind(vertex_array(obj), max_distance=0.3)), arm)


def robust_section(info, z, band=0.012):
    """Body section at height z (arms excluded), widening the band where the mesh rings are sparse."""
    for _ in range(6):
        sec = G.ring_section(info, z, band=band)
        if len(sec) >= 8:
            return sec
        band *= 1.6
    return sec


def tube(info, name, levels, radius_of, segments, centre):
    """Like garments.hull_tube, with robust sections (long skirts reach the sparse shin rings)."""
    verts, rows = [], []
    for z in levels:
        hull = G.convex_hull(robust_section(info, z))
        angles, radius = G.resample_loop(hull, segments, centre)
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
    return new_mesh(name, np.array(verts), faces), rows, centre


def skirt_tube(info, fr, name, z_top, z_hem, ease_top, ease_hem, flare=0.0, folds=10, fold_amp=0.01, rings=16, segments=56,
               inset=0.0, hem_wave=0.0, seed=0.0):
    field = G.HullField(info, info.hip_z - 0.06, max(info.hip_z + 0.02, z_top + 0.02), fr.centre, step=0.01)

    def radius(z, angles, hull_r):
        t = np.clip((z_top - z) / max(1e-3, z_top - z_hem), 0, 1)
        hips = np.array([field.radius(min(z, info.hip_z), a) for a in angles])
        k = np.clip((z_top - z) / 0.1, 0, 1)
        base = np.maximum(hull_r, hips * k + hull_r * (1 - k))
        fold = fold_amp * t ** 1.3 * (np.sin(folds * angles + 0.9 + seed) * 0.65 + np.sin(folds * 0.43 * angles + 2.1 + seed) * 0.35)
        return base + ease_top + (ease_hem - ease_top) * t ** 1.4 + flare * t ** 2 + fold - inset
    levels = list(np.linspace(z_top, z_hem, rings))
    obj, rows, centre = tube(info, name, levels, radius, segments, fr.centre)
    if hem_wave:
        co = vertex_array(obj)
        for s, vi in enumerate(rows[-1]):
            a = 2 * math.pi * s / segments
            co[vi, 2] += hem_wave * (math.sin(2 * a + 0.5 + seed) * 0.6 + math.sin(5 * a + 1.3) * 0.4)
        obj.data.vertices.foreach_set("co", co.ravel())
        obj.data.update()
    return obj, rows, centre


def torso_tree(info, shoulder_cap=0.35):
    """BVH of the body without the arms (faces whose vertices are all dominated by arm bones are left out),
    so generated capes and shawls hang from the shoulders instead of wrapping the A-pose arms. The top of
    each upper arm (limb fraction below shoulder_cap) stays, so a cape covers the shoulder caps."""
    from mathutils.bvhtree import BVHTree
    arm_v = np.array([fam(d) in ARM and not (fam(d) == "upperarm" and info.limb_t(i, d) < shoulder_cap)
                      for i, d in enumerate(info.dominant)])
    me = info.body.data
    me.calc_loop_triangles()
    tris = [t.vertices[:] for t in me.loop_triangles if not all(arm_v[i] for i in t.vertices)]
    return BVHTree.FromPolygons([tuple(p) for p in info.v], tris, all_triangles=True)


def envelope_radius(trees, centre, z, angles, reach=0.7, floor=0.03):
    """Outermost surface of the given BVH trees along horizontal rays toward the vertical axis through
    centre, per angle (0 = front, +90 degrees = the character's left)."""
    out = np.full(len(angles), floor)
    for k, a in enumerate(angles):
        d = Vector((math.sin(a), -math.cos(a), 0.0))
        origin = Vector((centre[0], centre[1], z)) + d * reach
        for tree in trees:
            hit = tree.ray_cast(origin, -d, reach)
            if hit[0] is not None:
                out[k] = max(out[k], reach - hit[3])
    return out


def capelet(info, fr, arm, name, z_top, hem_of, trees, gap_of, segments=48, rings=12, flare=0.03, folds=7, fold_amp=0.008,
            v_gap_top=0.0, v_gap_power=1.3, v_gap_min=0.03, hang=0.002, seed=0.0, centre=None, ring_power=1.5, relax=24):
    """Shoulder cape or shawl generated as one grid of quads. Each column runs from the neck ring at z_top down
    to its own hem height hem_of(angle), so the hem is a clean curve; each ring hugs the outermost of the given
    surfaces (envelope_radius) by gap_of(t) and, once past the shoulders, hangs instead of following the body
    inward (radius never shrinks by more than `hang` per ring). With v_gap_top > 0 the front is open in a V whose
    half-angle closes from v_gap_top (radians) at the neck to zero at the hem, with clean straight edges.
    A body-shell cape cut along the body's topology left a ragged hem and tore into shards where it crossed
    the shoulder joints (the elder's hood); this replaces it. Rings are denser near the neck (ring_power), and
    each ring clears the surfaces over the whole band between its neighbours, not only at its own height:
    horizontal rays see the nearly flat shoulder tops edge-on, and straight quads between two rings let the
    shoulders through (pushing vertices out along nearest normals instead folded the cape)."""
    centre = fr.centre if centre is None else centre
    closed = v_gap_top <= 0.0
    base = np.linspace(0.0, 2 * math.pi, segments, endpoint=False) if closed else np.linspace(0.0, 1.0, segments)
    verts, rows, prev, ring_angles, ring_z, ring_r = [], [], None, [], [], []
    ts = [(k / (rings - 1)) ** ring_power for k in range(rings)]
    for k in range(rings):
        t = ts[k]
        if closed:
            angles = base
        else:
            g = v_gap_min + (v_gap_top - v_gap_min) * (1.0 - t) ** v_gap_power
            angles = g + base * (2 * math.pi - 2 * g)
        ring_angles.append(np.array(angles, dtype=float))
        hems = np.array([hem_of(a) for a in angles])
        zs = z_top + (hems - z_top) * t
        t_lo, t_hi = ts[max(0, k - 1)], ts[min(rings - 1, k + 1)]
        env = []
        for z, a, hem in zip(zs, angles, hems):
            band = [z_top + (hem - z_top) * (t + (tt - t) * f) for tt in (t_lo, t_hi) for f in (0.35, 0.7)]
            env.append(max(envelope_radius(trees, centre, zz, [a])[0] for zz in [z] + band))
        env = np.array(env)
        r = env + gap_of(t)
        if prev is not None:
            r = np.maximum(r, prev - hang)
        prev = r.copy()
        ring_z.append(zs)
        ring_r.append(r)
    # the clearance radii jump wherever the surfaces beneath do (hood corners, the cloak's front edge, the
    # toggle): the elder's cape had 102 grid edges creased past 55 degrees, each shaded flat as a block.
    # Relax the radii over the grid, never below the clearance, before the folds are added.
    floor_r = np.array(ring_r)
    R = floor_r.copy()
    for _ in range(relax):
        pad = np.pad(R, ((1, 1), (0, 0)), mode="edge")
        pad = np.concatenate([pad[:, -1:], pad, pad[:, :1]], axis=1) if closed else np.pad(pad, ((0, 0), (1, 1)), mode="edge")
        R = np.maximum((pad[:-2, 1:-1] + pad[2:, 1:-1] + pad[1:-1, :-2] + pad[1:-1, 2:] + 4 * pad[1:-1, 1:-1]) / 8.0, floor_r)
    for k in range(1, rings):  # hanging: no ring pulls in by more than `hang`
        R[k] = np.maximum(R[k], R[k - 1] - hang)
    for k in range(rings):
        t, angles, zs = ts[k], ring_angles[k], ring_z[k]
        wave = fold_amp * t ** 1.3 * (np.sin(folds * angles + 0.9 + seed) * 0.65 + np.sin(folds * 0.43 * angles + 2.1 + seed) * 0.35)
        rr = R[k] + flare * t ** 2 + wave
        row = []
        for a, z, q in zip(angles, zs, rr):
            row.append(len(verts))
            verts.append((centre[0] + math.sin(a) * q, centre[1] - math.cos(a) * q, z))
        rows.append(row)
    faces = []
    span = segments if closed else segments - 1
    for k in range(rings - 1):
        for c in range(span):
            a, b = rows[k][c], rows[k][(c + 1) % segments]
            cc, d = rows[k + 1][(c + 1) % segments], rows[k + 1][c]
            faces.append((a, d, cc, b))
    # one grid island in metres (u along each ring from the front, v down each column; a closed ring is cut
    # at the back): smart projection split these curved grids into islands that folded over themselves, the
    # overlap pass gave each folded face its own island, and the cape rendered as a patchwork of face-sized
    # blocks (and its decimated levels sampled between the scattered islands)
    # A cape widens fast below the neck (the elder's from a 0.5 m ring to a 2 m hem over 0.4 m), so straight
    # rows sheared the quads near the cut into bow-ties; the rows are laid out as arcs of a developed cone
    # instead (ring length kept, radius growing with the distance down the columns).
    P = np.array(verts)
    cols = segments + 1 if closed else segments
    mid = segments // 2 if closed else (segments - 1) // 2
    arc = np.zeros((rings, cols))
    down = np.zeros((rings, cols))
    for k in range(rings):
        ring = [P[rows[k][c % segments]] for c in range(cols)]
        s = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(ring, axis=0), axis=1))])
        arc[k] = s - s[mid]
    for c in range(cols):
        col = [P[rows[k][c % segments]] for k in range(rings)]
        down[:, c] = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(col, axis=0), axis=1))])
    length = arc[:, -1] - arc[:, 0]
    vbar = down.mean(axis=1)
    spread, offset = np.polyfit(vbar, length, 1) if rings > 1 else (0.0, 0.0)
    # columns sit at even angles, so each row is one arc and each column one radial line: arc lengths along
    # the rings (which pick up every radial jog of the hanging surface) sheared the cells into bow-ties
    theta = np.array([np.append(a, a[0] + 2 * math.pi) if closed else a for a in ring_angles])
    extent = theta[:, -1] - theta[:, 0]
    rel = (theta - theta[:, mid:mid + 1]) / extent[:, None]  # -0.5 .. 0.5 along each ring
    uv = np.zeros((rings, cols, 2))
    if spread > 0.2:
        r0 = max(offset / spread, length[0] / (2 * math.pi), 0.02)
        for k in range(rings):
            phi = rel[k] * spread
            rad = r0 + down[k]
            uv[k, :, 0] = rad * np.sin(phi)
            uv[k, :, 1] = -rad * np.cos(phi)
    else:
        uv[:, :, 0] = rel * length[:, None]
        uv[:, :, 1] = -down
    face_uvs = []
    for k in range(rings - 1):
        for c in range(span):
            face_uvs.append((k * cols + c, (k + 1) * cols + c, (k + 1) * cols + c + 1, k * cols + c + 1))
    obj = new_mesh(name, P, faces, uvs=uv.reshape(-1, 2), face_uvs=face_uvs)
    keep_grid_uv(obj)
    return obj, rows


def keep_grid_uv(obj):
    """Mark a piece whose own UVMap the texture stage keeps (faces added later, such as folded hems, are
    unmarked and unwrapped with the rest)."""
    attr = obj.data.attributes.get("crownfall_keep_uv") or obj.data.attributes.new("crownfall_keep_uv", "INT", "FACE")
    attr.data.foreach_set("value", [1] * len(obj.data.polygons))
    obj["crownfall_uv"] = "grid"


def blend_bound_weights(obj, sources, mix_of, arm):
    """Weights bound from several skinned surfaces (SurfaceBinding) and blended per vertex: mix_of(point)
    returns one share per source (summing to 1). A shoulder cape weighted like the cloak beneath it moves
    with the cloak instead of passing through it."""
    pts = vertex_array(obj)
    bound = []
    for src in sources:
        b = SurfaceBinding(src)
        bound.append(b.transfer_weights(b.bind(pts)))
    weights = []
    for i, p in enumerate(pts):
        shares = mix_of(p)
        w = {}
        for share, bw in zip(shares, bound):
            if share <= 0:
                continue
            for bone, v in bw[i].items():
                w[bone] = w.get(bone, 0.0) + v * share
        weights.append(w)
    assign_weights(obj, weights, arm)


def rebind_below(obj, body, arm, z_lo, z_hi):
    """Vertices below z_lo take the weights of the nearest body surface; between z_lo and z_hi those blend
    into the weights the vertices already carry. For shells whose vertices moved far from the body vertices
    they copied weights from (the elder's hood collar)."""
    from scene import weights_of
    own = weights_of(obj)
    pts = vertex_array(obj)
    b = SurfaceBinding(body)
    bound = b.transfer_weights(b.bind(pts))
    out = []
    for p, w0, w1 in zip(pts, own, bound):
        s = smoothstep((z_hi - p[2]) / max(1e-6, z_hi - z_lo))
        w = {}
        for bone, v in w0.items():
            w[bone] = w.get(bone, 0.0) + v * (1.0 - s)
        for bone, v in w1.items():
            w[bone] = w.get(bone, 0.0) + v * s
        out.append(w)
    assign_weights(obj, out, arm)


def open_front(obj, centre, gap_top, gap_bottom, z_top, z_bottom, left_extra=(0.0, 0.0)):
    """Delete tube faces inside a front opening whose half-angle widens from gap_top to gap_bottom. left_extra
    widens the character's left side (+X) by (top, bottom) degrees more: the elder's cloak is swept back on the
    stick side, so the hand and the stick stay outside it (they were hidden inside the closed bell)."""
    me = obj.data
    doomed = []
    for poly in me.polygons:
        c = poly.center
        a = math.atan2(c.x - centre[0], -(c.y - centre[1]))
        t = np.clip((z_top - c.z) / max(1e-3, z_top - z_bottom), 0, 1)
        half = gap_top + (gap_bottom - gap_top) * t
        if a > 0:
            half += left_extra[0] + (left_extra[1] - left_extra[0]) * smoothstep(t * 1.4)
        if abs(a) < math.radians(half):
            doomed.append(poly.index)
    delete_faces(obj, doomed)


def front_panel(info, fr, name, z_top, z_bottom, widths, under, standoff, cols=12, rows=24, wrap=0.035):
    """Apron panel: ray-cast onto the layer beneath, hanging straight below the belly."""
    verts = []
    for r in range(rows + 1):
        v = r / rows
        z = z_top + (z_bottom - z_top) * v
        width = np.interp(v, [0.0, 0.35, 1.0], widths)
        for c in range(cols + 1):
            u = c / cols * 2 - 1
            x = u * width / 2
            hit = under.ray_cast(Vector((x, -1.0, z)), Vector((0.0, 1.0, 0.0)), 3.0)
            y = (hit[0].y - standoff) if hit[0] is not None else fr.centre[1] - 0.15
            verts.append([x, y, z])
    grid = np.array(verts).reshape(rows + 1, cols + 1, 3)
    for r in range(1, rows + 1):
        grid[r, :, 1] = np.minimum(grid[r, :, 1], grid[r - 1, :, 1].min() + 0.004 * (grid[r, :, 0] / 0.2) ** 2)
    for r in range(rows + 1):
        u = np.linspace(-1, 1, cols + 1)
        grid[r, :, 1] += (u ** 2) * wrap * min(1.0, (r / rows) * 2)
        grid[r, :, 1] += np.sin(u * 5.0 + 0.8) * 0.004 * (r / rows)
    verts = grid.reshape(-1, 3)
    faces = []
    for r in range(rows):
        for c in range(cols):
            a = r * (cols + 1) + c
            faces.append((a, a + cols + 1, a + cols + 2, a + 1))
    obj = new_mesh(name, verts, faces)
    return obj


def orient_forward(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if sum(f.normal.y for f in bm.faces) > 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def blob(name, centre, radii, arm, weights, subdiv=2, squash=None, seed=0):
    """Soft lumpy ellipsoid (knots, skeins, rolled fleece) with constant weights."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    rng = np.random.default_rng(seed)
    for v in bm.verts:
        k = 1.0 + rng.uniform(-0.08, 0.08)
        v.co = Vector((v.co.x * radii[0] * k, v.co.y * radii[1] * k, v.co.z * radii[2] * k)) + Vector(centre)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for p in obj.data.polygons:
        p.use_smooth = True
    assign_weights(obj, [dict(weights) for _ in obj.data.vertices], arm)
    return obj


def skein(name, top, length, arm, weights, strands=2, turns=2.5, strand_r=0.0042, twist_r=0.0036, sides=6, rings=13, seed=0):
    """A hank of dyed yarn hanging from the belt: strands twisted round each other (a twisted skein), slightly
    flared at the folded end. Replaces the smooth lozenge that read as plastic."""
    rng = np.random.default_rng(seed)
    verts, faces = [], []
    top = np.array(top, dtype=np.float64)
    lean = np.array([rng.uniform(-0.15, 0.15), -0.12, -1.0])
    lean /= np.linalg.norm(lean)
    side = np.cross(lean, np.array([0.0, 1.0, 0.0]))
    side /= np.linalg.norm(side)
    fwd = np.cross(side, lean)
    for s_i in range(strands):
        base = len(verts)
        for r_i in range(rings):
            t = r_i / (rings - 1)
            ang = 2 * math.pi * (turns * t + s_i / strands)
            flare = 1.0 + 0.35 * t ** 3
            c = top + lean * length * t + (side * math.cos(ang) + fwd * math.sin(ang)) * twist_r * flare
            tangent = lean
            u = side * math.cos(ang + math.pi / 2) + fwd * math.sin(ang + math.pi / 2)
            v = np.cross(tangent, u)
            rad = strand_r * (0.85 + 0.15 * math.sin(t * math.pi)) * flare
            for k in range(sides):
                a = 2 * math.pi * k / sides
                verts.append(c + (u * math.cos(a) + v * math.sin(a)) * rad)
        for r_i in range(rings - 1):
            for k in range(sides):
                a0, a1 = base + r_i * sides + k, base + r_i * sides + (k + 1) % sides
                faces.append((a0, a1, a1 + sides, a0 + sides))
        faces.append(tuple(base + k for k in range(sides))[::-1])
        faces.append(tuple(base + (rings - 1) * sides + k for k in range(sides)))
    obj = new_mesh(name, np.array(verts), faces)
    assign_weights(obj, [dict(weights) for _ in verts], arm)
    return obj


def cylinder(name, a, b, radius, arm, weights, segments=8, cap=True):
    a, b = Vector(a), Vector(b)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, segments=segments, radius1=radius, radius2=radius * 0.9, depth=(b - a).length)
    rot = Vector((0, 0, 1)).rotation_difference((b - a).normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=rot, verts=bm.verts[:])
    bmesh.ops.translate(bm, vec=(a + b) / 2, verts=bm.verts[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for p in obj.data.polygons:
        p.use_smooth = True
    assign_weights(obj, [dict(weights) for _ in obj.data.vertices], arm)
    return obj


def strap(info, arm, name, points, width, thickness, surface, gap):
    return G.ribbon(info, arm, name, points, width, thickness, surface, gap)


def hanging_strip(name, top, direction, length, width, thickness, arm, weights_top, weights_bottom, segments=4):
    """Short hanging tail (cloth tie, ribbon end, cord end) as a thin box strip."""
    top = np.array(top, dtype=float)
    d = np.array(direction, dtype=float)
    d /= np.linalg.norm(d)
    side = np.cross(d, [0.0, 1.0, 0.0])
    if np.linalg.norm(side) < 1e-3:
        side = np.array([1.0, 0.0, 0.0])
    side /= np.linalg.norm(side)
    normal = np.cross(side, d)
    verts, faces = [], []
    for k in range(segments + 1):
        t = k / segments
        c = top + d * length * t
        w = width * (1.0 - 0.25 * t)
        for s, n in ((-0.5, 0.0), (0.5, 0.0), (0.5, thickness), (-0.5, thickness)):
            verts.append(c + side * w * s + normal * n)
    for k in range(segments):
        for e in range(4):
            a, b = k * 4 + e, k * 4 + (e + 1) % 4
            faces.append((a, b, b + 4, a + 4))
    obj = new_mesh(name, np.array(verts), faces)
    ws = []
    for k in range(segments + 1):
        t = k / segments
        w = {b: v * (1 - t) for b, v in weights_top.items()}
        for b, v in weights_bottom.items():
            w[b] = w.get(b, 0.0) + v * t
        ws.extend([w] * 4)
    assign_weights(obj, ws, arm)
    return obj


def hand_room(obj, centre, hip_z, rooms, report=None):
    """Bulge a hanging garment outward where a hanging hand meets it in the clips (round 2: the elder's right hand and
    mitt came out through the back of her cloak in every idle frame). Each room is an angle round the body (degrees,
    0 at the front, -90 the character's right), a height below the hips, half-width and half-height, and an amount
    in metres; the bulge falls off smoothly and pushes radially from the body axis."""
    if not rooms:
        return
    co = vertex_array(obj)
    d = co[:, :2] - np.array(centre[:2])
    r = np.linalg.norm(d, axis=1) + 1e-9
    ang = np.degrees(np.arctan2(d[:, 0], -d[:, 1]))
    moved = np.zeros(len(co))
    for room in rooms:
        da = (ang - room["angleDeg"] + 180.0) % 360.0 - 180.0
        wa = np.clip(1.0 - np.abs(da) / room["halfWidthDeg"], 0.0, 1.0)
        wz = np.clip(1.0 - np.abs(co[:, 2] - (hip_z - room["belowHip"])) / room["halfHeight"], 0.0, 1.0)
        w = (wa * wa * (3 - 2 * wa)) * (wz * wz * (3 - 2 * wz)) * room["amount"]
        moved = np.maximum(moved, w)
    co[:, 0] += d[:, 0] / r * moved
    co[:, 1] += d[:, 1] / r * moved
    obj.data.vertices.foreach_set("co", co.ravel())
    obj.data.update()
    if report is not None:
        report.setdefault("handRoom", {})[obj.name] = {"maxMm": round(float(moved.max()) * 1000, 1), "vertices": int((moved > 1e-4).sum())}


def rolled_edge(name, src, run, radius, inset, arm, closed=False, step=0.009, sides=6):
    """A rolled, rounded hem along a boundary run of a garment (round 2): a tube swept along the edge, sitting just
    inside it, instead of a flat folded band (the elder's hood edge read as a paper visor). The run is resampled to
    about `step` metres per ring (a ring per edge vertex cost 1,500 triangles on a head-cloth). Weights copy the edge."""
    co = vertex_array(src)
    vn = np.zeros(len(src.data.vertices) * 3)
    src.data.vertices.foreach_get("normal", vn)
    vn = vn.reshape(-1, 3)
    keep, acc = [0], 0.0
    for i in range(1, len(run)):
        acc += float(np.linalg.norm(co[run[i]] - co[run[i - 1]]))
        if acc >= step:
            keep.append(i)
            acc = 0.0
    if not closed and keep[-1] != len(run) - 1:
        keep.append(len(run) - 1)
    run = [run[i] for i in keep]
    pts = co[run]
    nrm = vn[run]
    n = len(pts)
    verts, faces = [], []
    for i in range(n):
        a, b = pts[max(0, i - 1)], pts[min(n - 1, i + 1)]
        if closed:
            a, b = pts[(i - 1) % n], pts[(i + 1) % n]
        t = b - a
        t /= np.linalg.norm(t) + 1e-12
        nn = nrm[i] - t * (nrm[i] @ t)
        nn /= np.linalg.norm(nn) + 1e-12
        bb = np.cross(t, nn)
        # the roll's centre lies a little in from the edge (toward the garment) so it covers the cut
        inward = -bb if (co[run].mean(axis=0) - pts[i]) @ bb < 0 else bb
        c = pts[i] + inward * inset
        for k in range(sides):
            ang = 2 * math.pi * k / sides
            verts.append(c + (nn * math.cos(ang) + bb * math.sin(ang)) * radius)
    rows = n if closed else n - 1
    for i in range(rows):
        j = (i + 1) % n
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((i * sides + k, i * sides + k2, j * sides + k2, j * sides + k))
    if not closed:
        faces.append(tuple(range(sides))[::-1])
        faces.append(tuple((n - 1) * sides + k for k in range(sides)))
    obj = new_mesh(name, np.array(verts), faces)
    w_src = [{src.vertex_groups[g.group].name: g.weight for g in src.data.vertices[i].groups if g.weight > 0} for i in run]
    assign_weights(obj, [w_src[i // sides] or {"head": 1.0} for i in range(len(verts))], arm)
    return obj


def kindling_bundle(info, fr, arm, name, spec, back_tree):
    """A small bundle of kindling carried on the back (round 2: the casting's household child carries a bucket or
    kindling, and at village distance she carried nothing): eight to twelve barked sticks of different lengths and
    thicknesses, tilted across the back, tied with two cords, slung from a strap over the right shoulder (built by
    the caller). Rigid with the upper back. Returns (sticks, cords, top and bottom points of the bundle)."""
    rng = np.random.default_rng(spec.get("seed", 21))
    z_c = fr.armpit_z - spec.get("belowArmpit", 0.04)
    sec = G.ring_section(info, z_c, band=0.03)
    back_y = float(sec[:, 1].max())
    tilt = math.radians(spec.get("tiltDeg", 22.0))
    axis = np.array([math.sin(tilt), 0.0, math.cos(tilt)])  # leaning toward the character's left at the top
    centre = np.array([fr.centre[0] - 0.01, back_y + spec.get("offBack", 0.05), z_c])
    side = np.array([math.cos(tilt), 0.0, -math.sin(tilt)])
    out = np.array([0.0, 1.0, 0.0])
    length = spec.get("length", 0.44)
    count = int(spec.get("sticks", 11))
    verts, faces = [], []
    for k in range(count):
        a = rng.uniform(0, math.tau)
        rr = spec.get("radius", 0.036) * math.sqrt(rng.uniform(0.05, 1.0))
        off = side * math.cos(a) * rr + out * math.sin(a) * rr * 0.7
        ln = length * rng.uniform(0.78, 1.08)
        shift = rng.uniform(-0.04, 0.04)
        r0 = rng.uniform(0.0055, 0.0105)
        bend = rng.normal(0.0, 0.01, 3)
        sides = 6
        base = len(verts)
        rings = 5
        for i in range(rings):
            t = i / (rings - 1)
            c = centre + off + axis * (shift + ln * (t - 0.5)) + bend * math.sin(t * math.pi)
            u = side
            v = np.cross(axis, u)
            r = r0 * (1.0 - 0.25 * t) * rng.uniform(0.92, 1.08)
            for j in range(sides):
                ang = math.tau * j / sides
                verts.append(c + (u * math.cos(ang) + v * math.sin(ang)) * r)
        for i in range(rings - 1):
            for j in range(sides):
                j2 = (j + 1) % sides
                faces.append((base + i * sides + j, base + i * sides + j2, base + (i + 1) * sides + j2, base + (i + 1) * sides + j))
        faces.append(tuple(base + j for j in range(sides))[::-1])
        faces.append(tuple(base + (rings - 1) * sides + j for j in range(sides)))
    sticks = new_mesh(name, np.array(verts), faces)
    w = {"spine_03": 0.75, "spine_02": 0.25}
    assign_weights(sticks, [dict(w) for _ in verts], arm)
    cords = []
    for k, t in enumerate((-0.22, 0.24)):
        c = centre + axis * length * t
        ring = []
        for j in range(14):
            ang = math.tau * j / 14
            ring.append(c + (side * math.cos(ang) + out * math.sin(ang) * 0.75) * (spec.get("radius", 0.036) + 0.008))
        cv, cf = [], []
        for j, q in enumerate(ring):
            u = ring[(j + 1) % 14] - ring[j - 1]
            u /= np.linalg.norm(u) + 1e-12
            v = np.cross(u, axis)
            for m in range(4):
                ang = math.tau * m / 4
                cv.append(q + (axis * math.cos(ang) + v * math.sin(ang)) * 0.0028)
        for j in range(14):
            j2 = (j + 1) % 14
            for m in range(4):
                m2 = (m + 1) % 4
                cf.append((j * 4 + m, j * 4 + m2, j2 * 4 + m2, j2 * 4 + m))
        cord = new_mesh(f"{name}Cord{k}", np.array(cv), cf)
        assign_weights(cord, [dict(w) for _ in cv], arm)
        cords.append(cord)
    return sticks, cords, centre + axis * length * 0.25, centre - axis * length * 0.3


def cloth_knot(name, centre, radii, arm, weights, seed=0, axis=(1.0, 0.0, 0.0), subdiv=1):
    """A tied cloth knot (round 2): two flattened lobes of folded cloth crossing over a wrapped band, with crease
    folds, instead of one lumpy ball (the critics read every knot as a plush ball with two strips)."""
    rng = np.random.default_rng(seed)
    centre = np.array(centre, dtype=float)
    ax = np.array(axis, dtype=float)
    ax /= np.linalg.norm(ax)
    up = np.array([0.0, 0.0, 1.0])
    if abs(ax @ up) > 0.9:
        up = np.array([0.0, 1.0, 0.0])
    side = np.cross(up, ax)
    side /= np.linalg.norm(side)
    up = np.cross(ax, side)
    bm = bmesh.new()
    parts = []
    for k, (off, rot) in enumerate(((0.45, 0.35), (-0.45, -0.4))):
        tb = bmesh.new()
        bmesh.ops.create_icosphere(tb, subdivisions=subdiv, radius=1.0)
        for v in tb.verts:
            x, y, z = v.co
            # a folded lobe: flattened across, a crease along its length, one end pinched toward the band
            pinch = 0.55 + 0.45 * smoothstep((x * math.copysign(1.0, off) + 1.0) / 1.4)
            crease = 1.0 - 0.18 * math.exp(-(z * z) / 0.08) * (1.0 - abs(x))
            lx = x * radii[0] * 0.62
            ly = y * radii[1] * 0.55 * pinch * crease
            lz = z * radii[2] * 0.72 * pinch
            c, sn = math.cos(rot), math.sin(rot)
            lx, lz = lx * c - lz * sn, lx * sn + lz * c
            p = centre + ax * (lx + off * radii[0]) + up * lz + side * ly
            v.co = Vector(p * 1.0 + rng.normal(0.0, radii[1] * 0.025, 3))
        parts.append(tb)
    # the wrapped band round the middle
    tb = bmesh.new()
    bmesh.ops.create_icosphere(tb, subdivisions=1, radius=1.0)
    for v in tb.verts:
        x, y, z = v.co
        v.co = Vector(centre + ax * x * radii[0] * 0.34 + up * z * radii[2] * 0.62 + side * y * radii[1] * 0.78)
    parts.append(tb)
    me = bpy.data.meshes.new(name)
    for tb in parts:
        tme = bpy.data.meshes.new(name + "_tmp")
        tb.to_mesh(tme)
        tb.free()
        bm.from_mesh(tme)
        bpy.data.meshes.remove(tme)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for p in obj.data.polygons:
        p.use_smooth = True
    assign_weights(obj, [dict(weights) for _ in obj.data.vertices], arm)
    return obj


def cloth_tail(name, top, direction, length, width, thickness, arm, weights_top, weights_bottom, segments=7, sag=0.18,
               twist=0.7, seed=0):
    """A hanging cloth end (round 2): a lens-shaped section (rounded edges, not a box) that tapers, sags, twists a
    little and ends in a slightly ragged cut, instead of a flat box strip."""
    rng = np.random.default_rng(seed)
    top = np.array(top, dtype=float)
    d = np.array(direction, dtype=float)
    d /= np.linalg.norm(d)
    side = np.cross(d, [0.0, 1.0, 0.0])
    if np.linalg.norm(side) < 1e-3:
        side = np.array([1.0, 0.0, 0.0])
    side /= np.linalg.norm(side)
    normal = np.cross(side, d)
    sag_dir = np.array([0.0, 0.0, -1.0]) - d * d[2]
    if np.linalg.norm(sag_dir) > 1e-6:
        sag_dir /= np.linalg.norm(sag_dir)
    sec = [(-0.5, 0.0), (-0.2, 0.9), (0.2, 0.9), (0.5, 0.0), (0.2, -0.9), (-0.2, -0.9)]
    n = len(sec)
    verts, faces = [], []
    wave = rng.uniform(0, math.tau)
    for k in range(segments + 1):
        t = k / segments
        c = top + d * length * t + sag_dir * length * sag * t * t + side * width * 0.25 * math.sin(t * math.pi * 1.5 + wave)
        a = twist * t
        sd = side * math.cos(a) + normal * math.sin(a)
        nd = -side * math.sin(a) + normal * math.cos(a)
        w = width * (1.0 - 0.32 * t) * (1.0 + 0.08 * math.sin(t * 9.0 + wave))
        th = thickness * 0.5 * (1.0 - 0.2 * t)
        for (u, v) in sec:
            fray = rng.uniform(-0.15, 0.1) * width if k == segments else 0.0
            verts.append(c + sd * w * u + nd * th * v + d * fray)
    for k in range(segments):
        for e in range(n):
            a0, b0 = k * n + e, k * n + (e + 1) % n
            faces.append((a0, b0, b0 + n, a0 + n))
    faces.append(tuple(range(n))[::-1])
    faces.append(tuple(segments * n + e for e in range(n)))
    obj = new_mesh(name, np.array(verts), faces)
    ws = []
    for k in range(segments + 1):
        t = k / segments
        w = {b: v * (1 - t) for b, v in weights_top.items()}
        for b, v in weights_bottom.items():
            w[b] = w.get(b, 0.0) + v * t
        ws.extend([w] * n)
    assign_weights(obj, ws, arm)
    return obj


def bind_weights(info, obj, arm):
    binding = SurfaceBinding(info.body)
    assign_weights(obj, binding.transfer_weights(binding.bind(vertex_array(obj))), arm)


def fold_separate(obj, loops, outward, back, lip, name):
    """Fold bands on the given loops, returned as a separate object (trim in another material)."""
    before = set(range(len(obj.data.polygons)))
    for loop in loops:
        fold_hem(obj, loop, outward, back, lip=lip)
    new_faces = [i for i in range(len(obj.data.polygons)) if i not in before]
    if not new_faces:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for i in new_faces:
        obj.data.polygons[i].select = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    trim = [o for o in bpy.context.selected_objects if o is not obj][0]
    trim.name = name
    trim.data.name = name
    return trim


def push_radial(obj, centre, trees, min_gap, z_min, reach=0.4):
    """Move vertices above z_min outward along the ray from centre until they clear the outermost of the
    given surfaces by min_gap. Nearest-point pushes over a head-cloth's edge send neighbouring vertices
    in opposite directions and folded the elder's hood (about 400 folded faces); radial moves keep the
    angular order around the head, so a star-shaped hood cannot fold."""
    co = vertex_array(obj)
    c = Vector(centre)
    for i, p in enumerate(co):
        if p[2] < z_min:
            continue
        d = Vector(p) - c
        r = d.length
        if r < 1e-6:
            continue
        d.normalize()
        outer = 0.0
        for tree in trees:
            hit = tree.ray_cast(c + d * reach, -d, reach)
            if hit[0] is not None:
                outer = max(outer, reach - hit[3])
        if r < outer + min_gap:
            co[i] = np.array(c + d * (outer + min_gap))
    obj.data.vertices.foreach_set("co", co.ravel())
    obj.data.update()


# ------------------------------------------------------------------ heads

def head_cloth(info, fr, arm, name, spec, hair_band_top):
    """Linen head-cloth over the scalp from just behind the visible hairline band, tied at the nape,
    with a bulge for the hair pinned up beneath it and a knot with two short tails."""
    eye = fr.eye
    head_mid_y = float((info.bones["head"][0][1] + info.bones["head"][1][1]) / 2)
    ear_y = eye[1] + spec.get("earBackFromEye", 0.085) * fr.scale
    nape_z = eye[2] - spec.get("napeBelowEye", 0.06) * fr.scale

    def keep(i):
        p = info.v[i]
        d = info.dominant[i]
        if d not in ("head", "neck"):
            return False
        rel = p - eye
        if p[2] < nape_z:
            return False
        if p[1] < head_mid_y - 0.01:  # front half: behind the hairline band
            ax = abs(rel[0])
            # a smooth front edge (a stepped limit left a notch in the rim at each temple)
            limit = hair_band_top - spec.get("templeDrop", 0.02) * smoothstep((ax - 0.015) / 0.055)
            if rel[2] < limit:
                return False
        # sides: the edge runs from the temple down behind the ear to the nape
        if abs(rel[0]) > 0.045 * fr.scale and rel[2] < spec.get("sideEdgeAboveEye", 0.035) * fr.scale and p[1] < ear_y:
            return False
        return True
    obj, idx = shell(info, name, keep, spec.get("offset", 0.011), smooth=14)
    co = vertex_array(obj)
    bun = np.array(info.bones["head"][0]) + np.array([0.0, spec.get("bunBack", 0.07), spec.get("bunUp", 0.06)]) * fr.scale
    r = spec.get("bunRadius", 0.05) * fr.scale
    amp = spec.get("bunHeight", 0.025) * fr.scale
    for k, p in enumerate(co):
        dsq = np.sum((p - bun) ** 2)
        n = smooth_normals(info)[idx[k]]
        co[k] += n * amp * math.exp(-dsq / (2 * r * r))
    # cloth, not a shell: it stands off the skull toward the crown and the back (hair is pinned up beneath it)
    # and gathers into soft folds that run back to the knot at the nape
    nrm = smooth_normals(info)
    knot_dir = np.array([0.0, 1.0, -0.35])
    knot_dir = knot_dir / np.linalg.norm(knot_dir)
    centre = np.array(info.bones["head"][0]) + np.array([0.0, 0.0, 0.06 * fr.scale])
    loose = spec.get("looseBack", 0.006) * fr.scale
    fold_amp = spec.get("foldAmplitude", 0.0026) * fr.scale
    folds = spec.get("folds", 7)
    fu = np.cross(knot_dir, np.array([1.0, 0.0, 0.0]))
    fu /= np.linalg.norm(fu)
    fv = np.cross(knot_dir, fu)
    for k, p in enumerate(co):
        d = p - centre
        dn = d / (np.linalg.norm(d) + 1e-9)
        back = float(np.clip(np.dot(dn, knot_dir) * 0.5 + 0.5, 0.0, 1.0))  # 1 toward the knot, 0 at the brow
        ang = math.atan2(float(np.dot(dn, fv)), float(np.dot(dn, fu)))  # azimuth round the axis to the knot
        wave = math.sin(folds * ang + 0.7) * 0.65 + math.sin(folds * 1.9 * ang + 2.3) * 0.35
        co[k] += nrm[idx[k]] * (loose * back ** 1.5 + fold_amp * (0.25 + 0.75 * back ** 2) * wave)
    obj.data.vertices.foreach_set("co", co.ravel())
    obj.data.update()
    nsmooth_compat(obj, 4, 0.4)
    G.push_outside(obj, (info.tree,), spec.get("offset", 0.011) * 0.6)
    G._copy_body_weights(obj, info, idx, arm)
    hems = []
    for k, loop in enumerate(G.boundary_loops(obj)):
        G.relax_loop(obj, loop, spec.get("edgeRelax", 40), 0.5)
        if spec.get("rolledHem"):
            # round 2: a soft rolled hem (a tube along the edge) instead of the folded rim, which read as paper
            hems.append(rolled_edge(name + "Hem" + (str(k) if k else ""), obj, loop, spec.get("hemRadius", 0.0042),
                                    spec.get("hemInset", 0.0025), arm, closed=True))
        else:
            # a turned, rolled edge with some body (the thin folded rim read as paper)
            fold_hem(obj, loop, spec.get("hemOut", 0.0045), spec.get("hemBack", 0.012), lip=spec.get("hemLip", 0.0045))
    G._rim(obj, spec.get("thickness", 0.0028))
    G._apply_modifiers(obj)
    if len(hems) > 1:
        select_only(hems)
        bpy.ops.object.join()
        hems = [bpy.context.view_layer.objects.active]
    for h in hems:
        h.name = h.data.name = name + "Hem"
    if not spec.get("knot", True):
        return [obj] + hems
    # knot and tails at the nape
    knot_c = np.array([0.0, float(info.v[(np.abs(info.v[:, 0]) < 0.02) & (np.abs(info.v[:, 2] - nape_z) < 0.015)][:, 1].max()) + 0.022 * fr.scale,
                       nape_z + 0.01 * fr.scale])
    head_w = {"head": 0.8, "neck": 0.2}
    knot = cloth_knot(name + "Knot", knot_c, (0.026 * fr.scale, 0.016 * fr.scale, 0.017 * fr.scale), arm, head_w, seed=3)
    tails = []
    for s in (-1, 1):
        tails.append(cloth_tail(name + f"Tail{'L' if s > 0 else 'R'}", knot_c + np.array([s * 0.01, -0.002, -0.008]) * fr.scale,
                                (s * 0.3, -0.12, -1.0), spec.get("tailLength", 0.06) * fr.scale, 0.024 * fr.scale, 0.004, arm,
                                head_w, {"neck": 0.7, "spine_03": 0.3}, seed=4 + s))
    return [obj, knot] + tails + hems


# ------------------------------------------------------------------ outfits

def _finish(pieces, decimate, rims):
    for name, ratio in decimate.items():
        if name in pieces and ratio < 1.0:
            mod = pieces[name].modifiers.new("Decimate", "DECIMATE")
            mod.ratio = ratio
            mod.use_collapse_triangulate = False
            G._apply_modifiers(pieces[name], ("DECIMATE",))
    for name, thick in rims.items():
        if name in pieces:
            G._rim(pieces[name], thick)
            G._apply_modifiers(pieces[name])


def _delete_covered(body, info, covered_fn, report):
    covered = np.array([bool(covered_fn(i)) for i in range(len(info.v))])
    faces = [f.index for f in body.data.polygons if all(covered[v] for v in f.vertices)]
    before = triangle_count(body)
    delete_faces(body, faces)
    report["bodyTrianglesAfterCover"] = triangle_count(body)
    report["bodyTrianglesRemoved"] = before - triangle_count(body)


def build_spinner(body, arm, recipe, report):
    proxy = garment_proxy(body, arm)
    info = G.BodyInfo(proxy, arm)
    fr = Frame(info, arm)
    g = recipe["garments"]
    pieces = {}
    waist = info.waist_z + g.get("waistRaise", 0.0)
    neck_r = g.get("neckRadius", 0.068)
    # linen underdress: neckline, forearm sleeves and the hem below the overdress show
    under, under_idx = shell_layer(info, "Underdress", upper_keep(info, fr, neck_r - 0.012, waist - 0.1, fore_t=0.93, front_drop=0.02),
                                   0.0045, smooth=10, arm=arm)
    for loop in edge_loops(under, lambda p: p[2] > info.neck_z - 0.08):
        G.relax_loop(under, loop, 20)
        fold_hem(under, loop, 0.003, 0.008, lip=0.003)
    for loop in edge_loops(under, lambda p: abs(p[0]) > 0.16 and p[2] < fr.shoulder_z):
        G.relax_loop(under, loop, 12)
        fold_hem(under, loop, 0.003, 0.012, lip=0.004)
    pieces["Underdress"] = under
    # wool overdress bodice with elbow-length sleeves, draped over hollows
    field = SoftHull(info, waist - 0.05, fr.armpit_z + 0.02, fr.centre)
    bodice, bodice_idx = shell(info, "Overdress", upper_keep(info, fr, neck_r, waist - 0.03, upper_t=g.get("sleeveEnd", 0.96), front_drop=0.035),
                                  g.get("offset", 0.011), smooth=22)
    ease = lambda z: np.interp(z, [waist - 0.02, waist + 0.04, fr.armpit_z - 0.04, fr.armpit_z], [0.006, 0.012, 0.012, 0.010])
    G.drape_to_hull(bodice, info, bodice_idx, field, ease, fr.armpit_z - 0.01)
    nsmooth_compat(bodice, 5, 0.4)
    G.push_outside(bodice, (G.tree_of([under]),), 0.003)
    G.push_outside(bodice, (info.tree,), 0.008)
    G._copy_body_weights(bodice, info, bodice_idx, arm)
    for loop in edge_loops(bodice, lambda p: p[2] > info.neck_z - 0.1):
        G.relax_loop(bodice, loop, 25)
        fold_hem(bodice, loop, 0.004, 0.012, lip=0.004)
    for loop in edge_loops(bodice, lambda p: abs(p[0]) > 0.14 and p[2] < fr.shoulder_z):
        G.relax_loop(bodice, loop, 15)
        fold_hem(bodice, loop, 0.006, 0.03, lip=0.006)
    pieces["Overdress"] = bodice
    hem = info.ankle_z + g.get("hemAboveAnkle", 0.07)
    skirt, rows, centre = skirt_tube(info, fr, "OverdressSkirt", waist + 0.01, hem, 0.012, g.get("hemEase", 0.05),
                                     flare=g.get("flare", 0.07), folds=11, fold_amp=0.014, rings=g.get("skirtRings", 18), segments=g.get("skirtSegments", 60), hem_wave=0.006)
    G.push_outside(skirt, (info.tree,), 0.012)
    leg_follow_weights(info, skirt, centre, waist - 0.01, info.hip_z - 0.04, hem, arm)
    pieces["OverdressSkirt"] = skirt
    under_hem = info.ankle_z + g.get("underHemAboveAnkle", 0.012)
    uskirt, urows, _c = skirt_tube(info, fr, "UnderdressHem", hem + 0.07, under_hem, 0.012, g.get("hemEase", 0.05) - 0.004,
                                   flare=g.get("flare", 0.07), folds=11, fold_amp=0.006, rings=5, segments=g.get("skirtSegments", 60), inset=0.014, hem_wave=0.003, seed=1.0)
    follow_layer(uskirt, skirt, arm)
    pieces["UnderdressHem"] = uskirt
    # linen work apron and its waist tie
    surface = G.tree_of([skirt, bodice])
    apron = front_panel(info, fr, "Apron", waist + 0.015, info.knee_z - g.get("apronBelowKnee", 0.1), g.get("apronWidths", [0.3, 0.42, 0.48]),
                        surface, 0.009, cols=12, rows=22)
    G.clear_in_front(apron, [skirt, bodice], 0.008)
    nsmooth_compat(apron, 4, 0.4)
    G.clear_in_front(apron, [skirt, bodice], 0.008)
    orient_forward(apron)
    if "Apron" in g.get("drape", {}):
        aco = vertex_array(apron)
        G.drape(apron, [body, skirt, bodice], np.where(aco[:, 2] > aco[:, 2].max() - 0.025)[0], g["drape"]["Apron"], report)
        G.clear_in_front(apron, [skirt, bodice], 0.006)
    follow_layer(apron, skirt, arm)
    pieces["Apron"] = apron
    pieces["ApronTie"] = G.band(info, arm, "ApronTie", waist + 0.01, 0.016, 0.022, under=G.tree_of([skirt, bodice, apron]))
    # narrow woven band belt (banner presentation item: undyed before the banner is confirmed)
    pieces["Belt"] = G.band(info, arm, "Belt", waist + 0.03, 0.026, 0.026, under=G.tree_of([skirt, bodice, apron]))
    # banner presentation: a narrow band tied at the belt (undyed natural wool before the banner is confirmed)
    sec_b = G.ring_section(info, waist + 0.03, band=0.02)
    bx = float(sec_b[:, 0].max()) * 0.62
    by = float(sec_b[:, 1].min()) - 0.03
    pieces["BannerBand"] = hanging_strip("BannerBand", (bx, by, waist + 0.03), (0.15, -0.08, -1.0), 0.16, 0.022, 0.003, arm,
                                         {"hips": 0.8, "spine_01": 0.2}, {"hips": 0.6, "thigh_l": 0.4})
    # wool shawl: over the shoulders, a point down the back, the front edges meeting in a V at the knot on the
    # chest. Generated as one grid of quads (capelet): the earlier body-shell shawl kept the front bands only a
    # few faces wide, the boundary clean-up ate them and the knot and its ends floated on the bodice
    z_knot = info.chest_z + g.get("shawlKnotAboveChest", 0.0)
    z_point = waist + g.get("shawlPointAboveWaist", 0.08)
    z_side = fr.shoulder_z - g.get("shawlSideBelowShoulder", 0.1)

    def shawl_hem(a):
        af = a if a <= math.pi else 2 * math.pi - a  # 0 at the front, pi at the back
        if af <= math.pi / 2:
            return z_knot + (z_side - z_knot) * (af / (math.pi / 2)) ** 0.7
        return z_side + (z_point - z_side) * ((af - math.pi / 2) / (math.pi / 2)) ** g.get("shawlBackPower", 1.1)
    shawl, _srows = capelet(info, fr, arm, "Shawl", info.neck_z + g.get("shawlTopAboveNeck", 0.02), shawl_hem,
                            [torso_tree(info), torso_tree(G.BodyInfo(body, arm)), G.tree_of([bodice, under])], lambda t: 0.011 + 0.006 * t,
                            segments=g.get("shawlSegments", 56), rings=g.get("shawlRings", 14), flare=0.012, folds=8, fold_amp=0.008,
                            v_gap_top=math.radians(g.get("shawlNeckOpeningDeg", 42.0)), v_gap_power=1.15, seed=0.7)
    if "Shawl" in g.get("drape", {}):
        sco = vertex_array(shawl)
        G.drape(shawl, [body, bodice, under], np.where(sco[:, 2] > sco[:, 2].max() - 0.03)[0], g["drape"]["Shawl"], report)
        G.push_outside(shawl, (G.tree_of([bodice, under]),), 0.006)
    bind_weights(info, shawl, arm)
    for loop in G.boundary_loops(shawl):
        G.relax_loop(shawl, loop, 4)
        fold_hem(shawl, loop, 0.003, 0.009, lip=0.004)
    pieces["Shawl"] = shawl
    shawl_front = vertex_array(shawl)
    near_knot = (np.abs(shawl_front[:, 0]) < 0.05) & (np.abs(shawl_front[:, 2] - z_knot) < 0.03) & (shawl_front[:, 1] < fr.centre[1])
    front_y = float(shawl_front[near_knot][:, 1].min()) if np.any(near_knot) else fr.centre[1] - 0.14
    chest_w = {"spine_03": 0.75, "spine_02": 0.25}
    pieces["ShawlKnot"] = cloth_knot("ShawlKnot", (0.0, front_y - 0.016, z_knot), (0.04, 0.024, 0.03), arm, chest_w, seed=7)
    for s in (-1, 1):
        pieces[f"ShawlEnd{'L' if s > 0 else 'R'}"] = cloth_tail(f"ShawlEnd{'L' if s > 0 else 'R'}", (s * 0.014, front_y - 0.022, z_knot - 0.012),
                                                                (s * 0.2, -0.06, -1.0), 0.16, 0.07, 0.008, arm, chest_w, {"spine_02": 0.6, "spine_01": 0.4},
                                                                sag=0.08, twist=0.5 * s, seed=8 + s)
    # head-cloth
    for part in head_cloth(info, fr, arm, "HeadCloth", g["headCloth"], recipe["groom"]["hair"]["hairlineAboveEye"] + recipe["groom"]["hair"].get("bandDepth", 0.03) - 0.006):
        pieces[part.name] = part
    # turnshoes
    def feet(i):
        d = info.dominant[i]
        return fam(d) in ("foot", "toes") or (info.v[i][2] < info.ankle_z + 0.04 and fam(d) == "calf")
    pieces["Shoes"] = G.shoe_hulls(info, arm, "Shoes", feet, info.ankle_z + g["shoes"]["topAboveAnkle"], g["shoes"])
    if g.get("wrapHeight"):
        # wool leg wraps over the ankles: the shin skin under the skirts is deleted, and the wraps close what a
        # long stride shows of the lower leg behind the hem (a cut skin edge otherwise)
        def wraps(i):
            d = info.dominant[i]
            return fam(d) in ("calf", "foot") and info.ankle_z + 0.01 < info.v[i][2] < info.ankle_z + g["wrapHeight"]
        # round 2: the wraps reach the knee (a stride showed a floating shoe with an open wrap stub and no shin above
        # it), close to the leg like wool hose
        wr, _ = shell_layer(info, "LegWraps", wraps, g.get("wrapOffset", 0.006), smooth=10, arm=arm)
        pieces["LegWraps"] = wr
    # belt possessions: knife in a sheath on the right hip, keys on the left, skeins tucked in the apron
    hips_w = {"hips": 0.85, "thigh_r": 0.15}
    sec = G.ring_section(info, waist, band=0.02)
    right_x = float(sec[:, 0].min()) - 0.012
    pieces["Sheath"] = cylinder("Sheath", (right_x, fr.centre[1] - 0.04, waist + 0.0), (right_x - 0.01, fr.centre[1] - 0.06, waist - 0.17),
                                0.013, arm, hips_w, segments=8)
    left_x = float(sec[:, 0].max()) + 0.01
    keys_w = {"hips": 0.8, "thigh_l": 0.2}
    pieces["KeyRing"] = cylinder("KeyRing", (left_x, fr.centre[1] - 0.05, waist - 0.02), (left_x, fr.centre[1] - 0.05, waist - 0.08), 0.004, arm, keys_w, segments=6)
    for k, (dx, dz) in enumerate(((0.0, -0.13), (0.012, -0.12))):
        pieces[f"Key{k}"] = cylinder(f"Key{k}", (left_x + dx, fr.centre[1] - 0.05, waist - 0.08), (left_x + dx * 1.6, fr.centre[1] - 0.052, waist + dz),
                                     0.0035, arm, keys_w, segments=6)
    apron_co = vertex_array(apron)
    ay = float(apron_co[np.abs(apron_co[:, 2] - (waist - 0.01)) < 0.03][:, 1].min())
    for k, (x, col) in enumerate(((0.075, "SkeinBlue"), (0.098, "SkeinRed"))):
        # round 2: a hank of yarn is a thick twisted loop (the thin two-strand skeins read as coloured pencils)
        pieces[col] = skein(col, (x, ay - 0.012, waist - 0.02 - 0.012 * k), 0.1, arm, {"hips": 0.7, "spine_01": 0.3}, strands=3,
                            turns=1.7, strand_r=0.0068, twist_r=0.0066, sides=6, rings=8, seed=11 + k)
    _finish(pieces, g.get("decimate", {}), {"OverdressSkirt": 0.004, "UnderdressHem": 0.003, "Apron": 0.003, "Shoes": 0.004, "Shawl": 0.004,
                                            "LegWraps": 0.003})

    def covered(i):
        p, d = info.v[i], info.dominant[i]
        f = fam(d)
        if (d in G.TORSO_BONES or f == "upperarm") and p[2] < info.neck_z - 0.04 and not neck_open(info, fr, i, neck_r + 0.03, 0.03):
            return True
        if f == "forearm" and info.limb_t(i, d) < 0.82:
            return True
        if (f in ("thigh",) or d == "hips") and p[2] < waist:
            return True
        # under the ankle-length skirts only the ankle can show at the hem: a kept shin came out through both
        # skirt layers at every stride
        if f == "calf" and p[2] > info.ankle_z + g.get("shinKeptAboveAnkle", 0.05):
            return True
        if f in ("foot", "toes") and p[2] < info.ankle_z - 0.005:
            return True
        return False
    info = G.BodyInfo(body, arm)  # the real body: covered skin is deleted there
    _delete_covered(body, info, covered, report)
    bpy.data.objects.remove(proxy)
    return pieces, info


def build_child(body, arm, recipe, report):
    proxy = garment_proxy(body, arm, flatten=20)
    info = G.BodyInfo(proxy, arm)
    fr = Frame(info, arm)
    g = recipe["garments"]
    pieces = {}
    waist = info.waist_z
    neck_r = g.get("neckRadius", 0.052)
    # linen shirt: collar and cuffs show
    shirt, _ = shell_layer(info, "Shirt", upper_keep(info, fr, neck_r - 0.01, waist - 0.08, fore_t=0.93), 0.0038, smooth=9, arm=arm)
    for loop in edge_loops(shirt, lambda p: p[2] > info.neck_z - 0.07):
        G.relax_loop(shirt, loop, 18)
        fold_hem(shirt, loop, 0.0025, 0.007, lip=0.003)
    for loop in edge_loops(shirt, lambda p: abs(p[0]) > 0.12 and p[2] < fr.shoulder_z):
        G.relax_loop(shirt, loop, 10)
        fold_hem(shirt, loop, 0.0025, 0.01, lip=0.003)
    pieces["Shirt"] = shirt

    def legs(i):
        d = info.dominant[i]
        p = info.v[i]
        return (fam(d) in ("thigh", "calf") or (d == "hips" and p[2] < waist)) and info.ankle_z + 0.03 < p[2] < waist
    leggings, _ = shell_layer(info, "Leggings", legs, 0.0045, smooth=12, arm=arm)
    pieces["Leggings"] = leggings
    # oversized tunic cut down from an adult one: baggy body and sleeves, uneven re-hemmed edge
    belt_z = waist + g.get("beltAboveWaist", 0.0)
    field = SoftHull(info, belt_z - 0.05, fr.armpit_z + 0.02, fr.centre)
    tunic, t_idx = shell(info, "Tunic", upper_keep(info, fr, neck_r, belt_z - 0.02, fore_t=g.get("sleeveEnd", 0.74)), 0.012, smooth=20)
    ease = lambda z: np.interp(z, [belt_z - 0.02, belt_z + 0.03, belt_z + 0.08, fr.armpit_z - 0.03, fr.armpit_z], [0.01, 0.022, 0.03, 0.018, 0.014])
    G.drape_to_hull(tunic, info, t_idx, field, ease, fr.armpit_z - 0.01)
    nsmooth_compat(tunic, 6, 0.4)
    G.push_outside(tunic, (G.tree_of([shirt]),), 0.003)
    G.push_outside(tunic, (info.tree,), 0.009)
    G._copy_body_weights(tunic, info, t_idx, arm)
    for loop in edge_loops(tunic, lambda p: p[2] > info.neck_z - 0.08):
        G.relax_loop(tunic, loop, 22)
        fold_hem(tunic, loop, 0.0035, 0.01, lip=0.004)
    for loop in edge_loops(tunic, lambda p: abs(p[0]) > 0.11 and p[2] < fr.shoulder_z):
        G.relax_loop(tunic, loop, 14)
        fold_hem(tunic, loop, 0.006, 0.03, lip=0.006)
    pieces["Tunic"] = tunic
    hem = info.knee_z + g.get("hemAboveKnee", -0.01)
    skirt, rows, centre = skirt_tube(info, fr, "TunicSkirt", belt_z + 0.01, hem, 0.014, 0.034, flare=0.02, folds=9, fold_amp=0.01,
                                     rings=12, segments=48, hem_wave=0.012, seed=2.0)
    G.push_outside(skirt, (G.tree_of([leggings]),), 0.01)
    leg_follow_weights(info, skirt, centre, belt_z - 0.01, info.hip_z - 0.03, hem, arm, front=0.75, back=0.3, calf=0.5)
    pieces["TunicSkirt"] = skirt
    # sheepskin vest worn fleece-in: tanned leather outside, fleece turned out at every edge
    vest_bottom = info.hip_z + g.get("vestAboveHip", 0.02)

    def vest_keep(i):
        p, d = info.v[i], info.dominant[i]
        if d not in G.TORSO_BONES or p[2] < vest_bottom:
            return False
        if neck_open(info, fr, i, neck_r + 0.018, 0.04):
            return False
        down = float(np.clip((info.chest_z - p[2]) / max(1e-3, info.chest_z - vest_bottom), 0, 1))
        up = float(np.clip((p[2] - info.chest_z) / max(1e-3, info.neck_z - info.chest_z), 0, 1))
        half = g.get("vestOpening", 0.03) + g.get("vestOpeningFlare", 0.02) * down + g.get("vestNeckV", 0.045) * up
        if p[1] < fr.centre[1] - 0.02 and abs(p[0]) < half:
            return False
        if abs(p[0]) > fr.shoulder_x * 0.92 and p[2] < fr.shoulder_z + 0.01 and p[2] > fr.armpit_z - 0.035:
            return False
        return d not in ("clavicle_l", "clavicle_r") or p[2] < fr.shoulder_z + 0.02
    vest, v_idx = shell(info, "Vest", vest_keep, 0.03, smooth=16)
    G.push_outside(vest, (G.tree_of([tunic, skirt]),), 0.008)
    G.push_outside(vest, (info.tree,), 0.026)
    G._copy_body_weights(vest, info, v_idx, arm)
    loops = G.boundary_loops(vest)
    for loop in loops:
        G.relax_loop(vest, loop, 16)
    trim = fold_separate(vest, G.boundary_loops(vest), 0.006, 0.01, 0.005, "VestFleece")
    pieces["Vest"] = vest
    if trim is not None:
        pieces["VestFleece"] = trim
    pieces["Belt"] = G.band(info, arm, "Belt", belt_z + 0.005, 0.012, 0.034, under=G.tree_of([tunic, skirt, vest]))
    sec = G.ring_section(info, belt_z, band=0.02)
    pieces["BeltKnot"] = cloth_knot("BeltKnot", (0.05, float(sec[:, 1].min()) - 0.04, belt_z), (0.014, 0.01, 0.011), arm, {"hips": 0.6, "spine_01": 0.4}, seed=5)
    for s, dx in ((1, 0.045), (-1, 0.058)):
        pieces[f"BeltEnd{s}"] = cloth_tail(f"BeltEnd{s}", (dx, float(sec[:, 1].min()) - 0.042, belt_z - 0.005), (0.08 * s, -0.1, -1.0), 0.09,
                                           0.009, 0.006, arm, {"hips": 0.8, "spine_01": 0.2}, {"hips": 0.6, "thigh_l": 0.4}, segments=6, sag=0.05, twist=1.2, seed=5 + s)
    if g.get("kindling"):
        outer = G.tree_of([tunic, skirt, vest])
        sticks, cords, top, bottom = kindling_bundle(info, fr, arm, "Kindling", g["kindling"], outer)
        pieces["Kindling"] = sticks
        for k, cord in enumerate(cords):
            pieces[f"KindlingCord{k}"] = cord
        # the carrying strap: from the bundle's top over the right shoulder, across the chest to the left hip and
        # round to the bundle's foot
        sh = np.array([fr.centre[0] - fr.shoulder_x * 0.55, fr.centre[1], fr.shoulder_z + 0.02])
        chest = np.array([fr.centre[0] - 0.02, fr.centre[1] - 0.12, fr.armpit_z - 0.08])
        hip = np.array([fr.centre[0] + fr.shoulder_x * 0.75, fr.centre[1] - 0.02, waist + 0.02])
        pieces["KindlingStrap"] = strap(info, arm, "KindlingStrap", [top, sh + np.array([0.0, 0.05, 0.0]), sh, chest, hip, bottom],
                                        g["kindling"].get("strapWidth", 0.016), 0.004, G.tree_of([tunic, skirt, vest, shirt]), 0.004)
    pouch = G.pouch(info, arm, "Pouch", side=-1)
    pco = vertex_array(pouch)
    pc = pco.mean(axis=0)
    pco = pc + (pco - pc) * 0.72
    pco[:, 0] += (0.012 if pc[0] < 0 else -0.012)
    pouch.data.vertices.foreach_set("co", pco.ravel())
    pouch.data.update()
    pieces["Pouch"] = pouch
    # wooden whistle the elder carved, on a cord around the neck (hangs in the vest opening)
    neck_front = info.v[(np.abs(info.v[:, 0]) < 0.015) & (np.abs(info.v[:, 2] - (info.neck_z - 0.06)) < 0.02)]
    fy = float(neck_front[:, 1].min()) if len(neck_front) else fr.centre[1] - 0.09
    whistle_top = (0.0, fy - 0.03, info.chest_z + 0.01)
    cord_path = [(0.02, fy - 0.032, info.chest_z + 0.02), (0.04, fy - 0.01, info.neck_z - 0.05), (0.045, fr.neck_y, info.neck_z - 0.01),
                 (0.03, fr.neck_y + 0.045, info.neck_z - 0.02), (0.0, fr.neck_y + 0.055, info.neck_z - 0.025),
                 (-0.03, fr.neck_y + 0.045, info.neck_z - 0.02), (-0.045, fr.neck_y, info.neck_z - 0.01),
                 (-0.04, fy - 0.01, info.neck_z - 0.05), (-0.02, fy - 0.032, info.chest_z + 0.02)]
    pieces["WhistleCord"] = strap(info, arm, "WhistleCord", cord_path, 0.004, 0.003, G.tree_of([tunic, shirt]), 0.004)
    pieces["Whistle"] = cylinder("Whistle", whistle_top, (0.0, fy - 0.034, info.chest_z - 0.055), 0.007, arm, {"spine_03": 0.7, "spine_02": 0.3}, segments=8)
    # hair ribbon at the tie (undyed linen before the banner is confirmed)
    hair = bpy.data.objects.get("Hair")
    tie = np.array(hair["tie_point"]) if hair is not None and "tie_point" in hair else None
    if tie is not None:
        ring_c = tie + np.array([0.0, 0.016, -0.004])
        pieces["Ribbon"] = cloth_knot("Ribbon", ring_c, (0.012, 0.007, 0.008), arm, {"head": 1.0}, seed=9)
        for s in (-1, 1):
            pieces[f"RibbonEnd{'L' if s > 0 else 'R'}"] = cloth_tail(f"RibbonEnd{'L' if s > 0 else 'R'}", ring_c + np.array([s * 0.008, 0.006, -0.006]),
                                                                     (s * 0.4, 0.3, -1.0), 0.045, 0.009, 0.0022, arm, {"head": 1.0}, {"head": 1.0},
                                                                     segments=6, sag=0.12, twist=0.9 * s, seed=9 + s)

    def feet(i):
        d = info.dominant[i]
        return fam(d) in ("foot", "toes") or (info.v[i][2] < info.ankle_z + 0.035 and fam(d) == "calf")
    pieces["Shoes"] = G.shoe_hulls(info, arm, "Shoes", feet, info.ankle_z + g["shoes"]["topAboveAnkle"], g["shoes"])
    _finish(pieces, g.get("decimate", {}), {"TunicSkirt": 0.003, "Vest": 0.004, "Shoes": 0.0035})

    def covered(i):
        p, d = info.v[i], info.dominant[i]
        f = fam(d)
        if (d in G.TORSO_BONES or f == "upperarm") and p[2] < info.neck_z - 0.03 and not neck_open(info, fr, i, neck_r + 0.02, 0.0):
            return True
        if f == "forearm" and info.limb_t(i, d) < 0.85:
            return True
        if (f in ("thigh", "calf") or d == "hips") and info.ankle_z + 0.04 < p[2] < waist + 0.01:
            return True
        if f in ("foot", "toes") and p[2] < info.ankle_z - 0.005:
            return True
        return False
    info = G.BodyInfo(body, arm)  # the real body: covered skin is deleted there
    _delete_covered(body, info, covered, report)
    bpy.data.objects.remove(proxy)
    return pieces, info


def build_elder(body, arm, recipe, report):
    proxy = garment_proxy(body, arm)
    info = G.BodyInfo(proxy, arm)
    fr = Frame(info, arm)
    g = recipe["garments"]
    pieces = {}
    waist = info.waist_z
    neck_r = g.get("neckRadius", 0.06)
    # linen shift: shows at the wrists below the kirtle sleeves
    shift, _ = shell_layer(info, "Shift", upper_keep(info, fr, neck_r - 0.012, waist - 0.06, fore_t=0.94), 0.0038, smooth=8, arm=arm)
    for loop in edge_loops(shift, lambda p: abs(p[0]) > 0.14 and p[2] < fr.shoulder_z):
        G.relax_loop(shift, loop, 10)
        fold_hem(shift, loop, 0.0025, 0.01, lip=0.003)
    pieces["Shift"] = shift
    # long wool kirtle with long sleeves
    field = SoftHull(info, waist - 0.05, fr.armpit_z + 0.02, fr.centre)
    kirtle, k_idx = shell(info, "Kirtle", upper_keep(info, fr, neck_r, waist - 0.03, fore_t=g.get("sleeveEnd", 0.86)), 0.0095, smooth=20)
    ease = lambda z: np.interp(z, [waist - 0.02, waist + 0.04, fr.armpit_z - 0.04, fr.armpit_z], [0.008, 0.016, 0.014, 0.01])
    G.drape_to_hull(kirtle, info, k_idx, field, ease, fr.armpit_z - 0.01)
    nsmooth_compat(kirtle, 5, 0.4)
    G.push_outside(kirtle, (G.tree_of([shift]),), 0.003)
    G.push_outside(kirtle, (info.tree,), 0.008)
    G._copy_body_weights(kirtle, info, k_idx, arm)
    for loop in edge_loops(kirtle, lambda p: p[2] > info.neck_z - 0.08):
        G.relax_loop(kirtle, loop, 22)
        fold_hem(kirtle, loop, 0.0035, 0.01, lip=0.004)
    for loop in edge_loops(kirtle, lambda p: abs(p[0]) > 0.14 and p[2] < fr.shoulder_z):
        G.relax_loop(kirtle, loop, 12)
        fold_hem(kirtle, loop, 0.004, 0.016, lip=0.004)
    pieces["Kirtle"] = kirtle
    hem = info.ankle_z + g.get("hemAboveAnkle", 0.03)
    kskirt, rows, centre = skirt_tube(info, fr, "KirtleSkirt", waist + 0.01, hem, 0.012, 0.045, flare=0.05, folds=10, fold_amp=0.012,
                                      rings=g.get("skirtRings", 18), segments=g.get("skirtSegments", 56), hem_wave=0.006, seed=0.5)
    G.push_outside(kskirt, (info.tree,), 0.012)
    leg_follow_weights(info, kskirt, centre, waist - 0.01, info.hip_z - 0.04, hem, arm)
    pieces["KirtleSkirt"] = kskirt
    # heavy cloak: bell from the chest (hidden under the hood's shoulder cape) to mid-shin, open at the front
    c_top = info.neck_z - g.get("cloakTopBelowNeck", 0.02)
    c_shoulder = fr.shoulder_z - 0.03
    c_hem = info.knee_z - g.get("cloakHemBelowKnee", 0.14)
    arm_r = fr.shoulder_x + g.get("cloakArmClear", 0.075)

    top_sec = robust_section(info, c_shoulder - 0.06)
    depth_r = float(np.abs(top_sec[:, 1] - fr.centre[1]).max()) + g.get("cloakDepthClear", 0.05)

    def cloak_radius(z, angles, hull_r):
        t = np.clip((c_shoulder - z) / max(1e-3, c_shoulder - c_hem), 0, 1)
        ellipse = 1.0 / np.sqrt((np.sin(angles) / arm_r) ** 2 + (np.cos(angles) / depth_r) ** 2)
        body = np.maximum(hull_r + 0.03, ellipse + g.get("cloakFlare", 0.09) * t ** 1.2)
        k = smoothstep((c_top - z) / max(1e-3, c_top - c_shoulder))  # 0 at the neck, 1 below the shoulder
        fold = 0.014 * t ** 1.2 * (np.sin(8 * angles + 0.4) * 0.6 + np.sin(3.3 * angles + 1.9) * 0.4)
        return (hull_r + 0.035) * (1 - k) + body * k + fold
    levels = list(np.linspace(c_top, c_shoulder, 4)) + list(np.linspace(c_shoulder, c_hem, g.get("cloakRings", 19)))[1:]
    cloak, crows, _c = tube(info, "Cloak", levels, cloak_radius, g.get("cloakSegments", 60), fr.centre)
    open_front(cloak, fr.centre, g.get("cloakGapTop", 16.0), g.get("cloakGapBottom", 38.0), c_top, c_hem,
               left_extra=tuple(g.get("cloakStickSideOpening", (0.0, 0.0))))
    G.push_outside(cloak, (G.tree_of([kirtle, kskirt]),), 0.012)
    # the back follows the thighs and shins about as much as the kirtle skirt beneath it: with a 12 percent
    # share the stooped idle and the walk pushed the skirt out through the cloak above its hem
    leg_follow_weights(info, cloak, fr.centre, waist + 0.02, info.hip_z - 0.06, c_hem, arm, front=g.get("cloakFrontFollow", 0.45),
                       back=g.get("cloakBackFollow", 0.3), calf=g.get("cloakCalf", 0.45),
                       side_arm=g.get("cloakArmShare", 0.42), arm_zone=(info.hip_z - 0.05, c_top + 0.02))
    for loop in G.boundary_loops(cloak):
        G.relax_loop(cloak, loop, 10)
        fold_hem(cloak, loop, 0.004, 0.02, lip=0.004)
    if "Cloak" in g.get("drape", {}):
        cco = vertex_array(cloak)
        G.drape(cloak, [body, kirtle, kskirt, shift], np.where(cco[:, 2] > cco[:, 2].max() - 0.06)[0], g["drape"]["Cloak"], report)
        G.push_outside(cloak, (G.tree_of([kirtle, kskirt]),), 0.008)
    if "Cloak" in g.get("drape", {}) or g.get("cloakHandRoom"):
        hand_room(cloak, fr.centre, info.hip_z, g.get("cloakHandRoom", ()), report)
        leg_follow_weights(info, cloak, fr.centre, waist + 0.02, info.hip_z - 0.06, c_hem, arm, front=g.get("cloakFrontFollow", 0.45),
                           back=g.get("cloakBackFollow", 0.3), calf=g.get("cloakCalf", 0.45),
                           side_arm=g.get("cloakArmShare", 0.42), arm_zone=(info.hip_z - 0.05, c_top + 0.02))
    pieces["Cloak"] = cloak
    # head-cloth under the hood
    for part in head_cloth(info, fr, arm, "HeadCloth", g["headCloth"], recipe["groom"]["hair"]["hairlineAboveEye"] + recipe["groom"]["hair"].get("bandDepth", 0.03) - 0.005):
        pieces[part.name] = part
    # hood over the head-cloth, ending in a collar that tucks inside the shoulder cape built below; the face
    # opening carries an edging band. The cape used to be part of this shell (body faces down to 16 to 20 cm
    # below the shoulder, upper arms included): its hem followed the body topology and it tore into dark
    # shards across the shoulder joints whenever the arms left the A-pose
    hc = g["hood"]
    eye = fr.eye
    face_c = eye + np.array([0.0, 0.0, -hc.get("faceCentreBelowEye", 0.03) * fr.scale])
    collar_z = info.neck_z - hc.get("collarBelowNeck", 0.05)

    def hood_keep(i):
        p, d = info.v[i], info.dominant[i]
        f = fam(d)
        if d in ("head", "neck", "face_jaw") or d.startswith("face_"):
            rel = p - face_c
            if p[1] < eye[1] + 0.035 and (rel[0] / (hc.get("faceHalfWidth", 0.082) * fr.scale)) ** 2 + (rel[2] / (hc.get("faceHalfHeight", 0.105) * fr.scale)) ** 2 < 1.0:
                return False
            if d == "neck" and p[1] < fr.neck_y - 0.01 and p[2] < info.neck_z + 0.02:
                return True
            return True
        if d in G.TORSO_BONES:
            return p[2] > collar_z
        return False
    hood, h_idx = shell(info, "Hood", hood_keep, hc.get("offset", 0.036), smooth=22)
    co = vertex_array(hood)
    peak = np.array(info.bones["head"][1]) + np.array([0.0, 0.06, -0.02]) * fr.scale
    for k, p in enumerate(co):
        dsq = np.sum((p - peak) ** 2)
        co[k] += (p - np.array(info.bones["head"][0])) / (np.linalg.norm(p - np.array(info.bones["head"][0])) + 1e-9) * 0.02 * math.exp(-dsq / (2 * 0.05 ** 2))
    hood.data.vertices.foreach_set("co", co.ravel())
    hood.data.update()
    # an offset of the head's surface crumples behind the ear and under the jaw (dark folds inside the
    # face opening): relax it tangentially as well; the pushes below restore every clearance
    G._smooth(hood, hc.get("relax", 30), 0.5)
    nsmooth_compat(hood, 6, 0.4)
    G.push_outside(hood, (G.tree_of([cloak, kirtle]),), 0.012, reach=0.02)
    G.push_outside(hood, (info.tree,), 0.02)
    # over the head: radial clearance from the body and the head-cloth, relaxed between passes
    head_c = (np.array(info.bones["head"][0]) + np.array(info.bones["head"][1])) / 2
    head_trees = [info.tree, G.tree_of([pieces["HeadCloth"]])]
    for _ in range(3):
        push_radial(hood, head_c, head_trees, hc.get("headGap", 0.016), info.neck_z - 0.02)
        bm = bmesh.new()
        bm.from_mesh(hood.data)
        upper = [v for v in bm.verts if not v.is_boundary and v.co.z > info.neck_z - 0.03]
        for _k in range(4):
            bmesh.ops.smooth_vert(bm, verts=upper, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        bm.to_mesh(hood.data)
        bm.free()
        hood.data.update()
    # the shoulder cape stays outside the cloak, kirtle and shift; the head part last, so nothing pulls it back inside
    G.push_outside(hood, (G.tree_of([cloak, kirtle, shift]),), 0.012, reach=0.03)
    G.push_outside(hood, (info.tree,), 0.02)
    push_radial(hood, head_c, head_trees, hc.get("headGap", 0.016), info.neck_z - 0.02)
    G._copy_body_weights(hood, info, h_idx, arm)
    face_loops = [l for l in G.boundary_loops(hood) if np.mean(vertex_array(hood)[l][:, 2]) > info.neck_z]
    cape_loops = [l for l in G.boundary_loops(hood) if np.mean(vertex_array(hood)[l][:, 2]) <= info.neck_z]
    for loop in cape_loops:  # the collar edge, hidden inside the shoulder cape
        G.relax_loop(hood, loop, 16)
    for loop in face_loops:  # the opening closes at the throat in a zigzag V; round it before folding the edge band
        G.relax_loop(hood, loop, hc.get("faceEdgeRelax", 16))
    # the edging band runs round the face down to the chin; under the chin the opening meets the throat
    # closure, where a folded band crumpled into a knot-like tangle: leave that stretch as a plain edge
    chin_z = float(eye[2] - hc.get("edgeStopBelowEye", 0.085) * fr.scale)
    hco_edge = vertex_array(hood)
    band_runs = []
    for loop in face_loops:
        above = [hco_edge[i][2] > chin_z for i in loop]
        if all(above):
            band_runs.append(loop)
            continue
        start = next((k for k in range(len(loop)) if not above[k] and above[(k + 1) % len(loop)]), None)
        if start is None:
            continue
        run = []
        for step in range(1, len(loop) + 1):
            k = (start + step) % len(loop)
            if not above[k]:
                break
            run.append(loop[k])
        if len(run) >= 4:
            band_runs.append(run)
    if hc.get("edgeStyle", "rolled") == "rolled":
        # the face edge stood 3.6 cm off the forehead and read as a visor in profile: pull the edge and the cloth
        # near it in toward the head, then roll the edge as a soft round hem
        pull = hc.get("edgePullIn", 0.012)
        if pull > 0:
            hco_p = vertex_array(hood)
            hn = np.zeros(len(hood.data.vertices) * 3)
            hood.data.vertices.foreach_get("normal", hn)
            hn = hn.reshape(-1, 3)
            edge_v = sorted({i for run in band_runs for i in run})
            from mathutils.kdtree import KDTree
            kd = KDTree(len(edge_v))
            for k, i in enumerate(edge_v):
                kd.insert(hco_p[i], k)
            kd.balance()
            for i in range(len(hco_p)):
                if hco_p[i][2] < chin_z:
                    continue
                _q, _k, dist = kd.find(hco_p[i])
                w = max(0.0, 1.0 - dist / hc.get("edgePullReach", 0.035))
                hco_p[i] -= hn[i] * pull * w * w * (3 - 2 * w)
            hood.data.vertices.foreach_set("co", hco_p.ravel())
            hood.data.update()
            G.push_outside(hood, (G.tree_of([pieces["HeadCloth"]]),), 0.004, reach=0.02)
        rolls = [rolled_edge(f"HoodEdge{k}" if k else "HoodEdge", hood, run, hc.get("edgeRollRadius", 0.0055),
                             hc.get("edgeRollInset", 0.003), arm) for k, run in enumerate(band_runs)]
        edge = rolls[0] if rolls else None
        for extra in rolls[1:]:
            select_only([edge, extra])
            bpy.ops.object.join()
            edge = bpy.context.view_layer.objects.active
            edge.name = edge.data.name = "HoodEdge"
    else:
        edge = fold_separate(hood, band_runs, hc.get("edgeOut", 0.008), hc.get("edgeBack", 0.016), hc.get("edgeLip", 0.009), "HoodEdge")
    # the collar under the cape: relaxing and pushing slid the lower hood up to 19 cm down over the shoulders,
    # still carrying the head and neck weights of the body vertices it started from, so the stooped idle
    # swung it out through the cape as long strips down the chest and arms. Faces wholly below the neck go
    # (the cape covers the collar from 3 cm above it); the rest is re-weighted from the cape further down.
    # Trimmed only after the face edging is built: trimmed earlier, the cut joined the face opening's throat
    # V to the collar edge in one boundary loop, which was then relaxed as the face opening and pulled the
    # edging across the forehead in jagged flaps.
    hco = vertex_array(hood)
    low = hco[:, 2] < info.neck_z - hc.get("collarTrimBelowNeck", 0.01)
    delete_faces(hood, [f.index for f in hood.data.polygons if all(low[v] for v in f.vertices)])
    pieces["Hood"] = hood
    if edge is not None:
        pieces["HoodEdge"] = edge
    # shoulder cape: a generated capelet from the neck over the hood's collar and the cloak top, short at
    # the front, deeper at the back; weighted like the body at the collar and like the cloak below it
    cp_top = info.neck_z - hc.get("capeTopBelowNeck", 0.02)
    z_front = fr.shoulder_z - hc.get("capeFrontBelowShoulder", 0.13)
    z_back = fr.shoulder_z - hc.get("capeBackBelowShoulder", 0.2)

    def cape_hem(a):
        u = (1.0 - math.cos(a)) / 2.0  # 0 at the front, 1 at the back
        return z_front + (z_back - z_front) * u ** 0.8 + 0.005 * math.sin(3 * a + 0.4)
    cape, _rows = capelet(info, fr, arm, "HoodCape", cp_top, cape_hem,
                          [torso_tree(info), torso_tree(G.BodyInfo(body, arm)), G.tree_of([cloak, kirtle, shift, hood])],
                          lambda t: 0.013 + 0.006 * t, segments=hc.get("capeSegments", 48), rings=hc.get("capeRings", 12),
                          flare=hc.get("capeFlare", 0.025), folds=9, fold_amp=hc.get("capeFoldAmp", 0.011), seed=0.3)
    blend_bound_weights(cape, [info.body, cloak], lambda p: (1.0 - smoothstep((c_top + 0.01 - p[2]) / 0.05),
                                                              smoothstep((c_top + 0.01 - p[2]) / 0.05)), arm)
    for loop in G.boundary_loops(cape):
        G.relax_loop(cape, loop, 6)
        fold_hem(cape, loop, 0.004, 0.012, lip=0.005)
    pieces["HoodCape"] = cape
    # the hood's collar takes the weights of the cape over it, blended back into its own above the cape's top
    # ring, so the two deform together: bound to the body instead, the collar still cut through the cape at
    # the sides of the neck in the stooped idle
    rebind_below(hood, cape, arm, info.neck_z + 0.02, info.neck_z + 0.09)
    # cloak faces lying wholly under the cape go: its top ring and fold band pierced the cape's back
    under = np.array([p[2] > cape_hem(math.atan2(p[0] - fr.centre[0], -(p[1] - fr.centre[1])) % (2 * math.pi)) + 0.04
                      for p in vertex_array(cloak)])
    delete_faces(cloak, [f.index for f in cloak.data.polygons if all(under[v] for v in f.vertices)])
    # bone toggle closing the cape at the throat
    cco = vertex_array(cape)
    tz = cp_top - hc.get("toggleBelowCapeTop", 0.035)
    throat = cco[(np.abs(cco[:, 0]) < 0.03) & (np.abs(cco[:, 2] - tz) < 0.02)]
    ty = float(throat[:, 1].min()) if len(throat) else fr.centre[1] - 0.12
    pieces["Toggle"] = cylinder("Toggle", (-0.022, ty - 0.006, tz), (0.022, ty - 0.006, tz - 0.004), 0.0065, arm, {"spine_03": 0.6, "neck": 0.4}, segments=8)
    # weighted like the cape it closes (with fixed chest weights it floated a few centimetres in front of the
    # cape once the stooped idle moved the cape's front)
    blend_bound_weights(pieces["Toggle"], [cape], lambda p: (1.0,), arm)
    # fingerless wool mitts
    for side in ("l", "r"):
        fore = f"forearm_{side}"

        def mitt_keep(i, side=side, fore=fore):
            d = info.dominant[i]
            if d == f"hand_{side}" or d == f"thumb_01_{side}":
                return True
            if d.endswith(f"_01_{side}") and fam(d) in FINGERS:
                return info.limb_t(i, d) < 0.45
            return d == fore and info.limb_t(i, fore) > 0.86
        mitt, _ = shell_layer(info, f"Mitt_{side}", mitt_keep, 0.0032, smooth=3, arm=arm, body_gap=0.0026)
        pieces[f"Mitt_{side}"] = mitt
    # leather shoes with wool wraps above them
    def feet(i):
        d = info.dominant[i]
        return fam(d) in ("foot", "toes") or (info.v[i][2] < info.ankle_z + 0.035 and fam(d) == "calf")
    pieces["Shoes"] = G.shoe_hulls(info, arm, "Shoes", feet, info.ankle_z + g["shoes"]["topAboveAnkle"], g["shoes"])

    def wraps(i):
        d = info.dominant[i]
        return fam(d) in ("calf", "foot") and info.ankle_z + 0.01 < info.v[i][2] < info.ankle_z + g.get("wrapHeight", 0.13)
    wr, _ = shell_layer(info, "LegWraps", wraps, 0.011, smooth=10, arm=arm)
    pieces["LegWraps"] = wr
    _finish(pieces, g.get("decimate", {}), {"KirtleSkirt": 0.004, "Cloak": 0.006, "Hood": 0.005, "HoodCape": 0.006, "Shoes": 0.004,
                                            "LegWraps": 0.003, "Mitt_l": 0.002, "Mitt_r": 0.002, "HoodEdge": 0.004})

    def covered(i):
        p, d = info.v[i], info.dominant[i]
        f = fam(d)
        if (d in G.TORSO_BONES or f == "upperarm") and p[2] < info.neck_z - 0.035:
            return True
        if f == "forearm" and info.limb_t(i, d) < 0.85:
            return True
        if (f in ("thigh", "calf") or d == "hips") and info.ankle_z + 0.03 < p[2] < waist + 0.01:
            return True
        if f in ("foot", "toes") and p[2] < info.ankle_z - 0.005:
            return True
        if d in ("hand_l", "hand_r"):
            return True
        return False
    info = G.BodyInfo(body, arm)  # the real body: covered skin is deleted there
    _delete_covered(body, info, covered, report)
    bpy.data.objects.remove(proxy)
    return pieces, info


OUTFITS = {"spinner": build_spinner, "child": build_child, "elder": build_elder}


def build(body, arm, recipe, report):
    outfit = recipe["garments"]["outfit"]
    pieces, info = OUTFITS[outfit](body, arm, recipe, report)
    report["garments"] = {name: triangle_count(o) for name, o in pieces.items()}
    report["garmentLandmarks"] = {"waistZ": info.waist_z, "hipZ": info.hip_z, "kneeZ": info.knee_z, "ankleZ": info.ankle_z,
                                  "chestZ": info.chest_z, "neckZ": info.neck_z}
    for o in pieces.values():
        o["crownfall_part"] = "garment"
    return pieces

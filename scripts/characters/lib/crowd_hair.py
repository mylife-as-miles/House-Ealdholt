"""Crowd hair, beards and headwear: opaque masses at crowd resolution (original Crownfall code).

The isometric view reads hair by its silhouette and colour, not strands (EALDHOLT_POPULATION_ART.md section 4): every
style is an offset shell over the scalp region of the resident's own head (garment proxy, ears smoothed) with its own
hairline, volume and noise, plus generated parts for long styles (ponytail, braids, bun, a back sheet for loose hair).
Beards are shells over the jaw region that keep clear of the lips, so the jaw joint still parts them. Headwear shapes
(coif, padded coif, felt cap, straw hat, kerchief, head-cloth, veil and wimple, kettle and nasal helmets, ribbon) are
shells or rigid parts on the head bone; hair hidden under them is deleted. Pieces carry `crowd_slot` for the texture
stage: hair, beard, linen, accent, main, secondary, metal, straw, quilt.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

import garments as G
import outfits as O
from scene import assign_weights, delete_faces, new_mesh, triangle_count, vertex_array

STYLES = {
    # thickness (m), front hairline above the eyes (m), nape below the eyes (m), noise amplitude, bald kind, extra part;
    # crown: extra lift at the crown (times t), fringe: a forward band over the forehead (art fixer, 8 November: short
    # styles were 5 to 13 mm swim-cap shells that read as bald domes from the isometric view; now 1 to 3 cm of volume)
    "cropped": dict(t=0.011, front=0.05, nape=0.06, noise=0.002, crown=0.7),
    "short-tousled": dict(t=0.02, front=0.04, nape=0.07, noise=0.007, crown=1.0, fringe=0.7),
    "balding-crop": dict(t=0.008, front=0.05, nape=0.06, noise=0.0015, bald="crown"),
    "tied-back": dict(t=0.012, front=0.045, nape=0.075, noise=0.0025, crown=0.6, extra="ponytail"),
    "curly-short": dict(t=0.025, front=0.042, nape=0.07, noise=0.009, crown=0.9, fringe=0.4),
    "tonsure": dict(t=0.012, front=0.045, nape=0.065, noise=0.002, bald="tonsure", fringe=0.5),
    "thinning-white": dict(t=0.008, front=0.06, nape=0.06, noise=0.0015, bald="thin"),
    "long-braid": dict(t=0.012, front=0.045, nape=0.075, noise=0.002, crown=0.6, extra="braid"),
    "bun": dict(t=0.012, front=0.045, nape=0.07, noise=0.002, crown=0.5, extra="bun"),
    "loose-long": dict(t=0.014, front=0.042, nape=0.09, noise=0.003, crown=0.7, extra="sheet"),
    "twin-braids": dict(t=0.012, front=0.045, nape=0.075, noise=0.002, crown=0.5, extra="twin"),
    "tousled-child": dict(t=0.019, front=0.035, nape=0.06, noise=0.007, crown=1.0, fringe=0.8),
    "cropped-child": dict(t=0.011, front=0.042, nape=0.055, noise=0.002, crown=0.7, fringe=0.4),
}
COVER = {  # how much of the scalp each headwear hides: 'all' (no hair shows), 'top' (hair shows below), 'band'
    "none": None, "coif": "all", "padded-coif": "all", "hood": "all", "head-cloth": "all", "veil-wimple": "all",
    "kerchief": "top", "felt-cap": "top", "straw-hat": "top", "kettle-helmet": "top", "nasal-helmet": "top", "ribbon": None,
}


class Head:
    """Head landmarks of the shaped body (rest pose, metres)."""

    def __init__(self, info, arm):
        b = info.bones
        self.eye = (np.array(b["face_eye_l"][0]) + np.array(b["face_eye_r"][0])) / 2
        self.eye_dx = abs(float(b["face_eye_l"][0][0]))
        h0, h1 = np.array(b["head"][0]), np.array(b["head"][1])
        self.base = h0
        hv = info.v[[i for i, d in enumerate(info.dominant) if d == "head"]]
        self.top = float(hv[:, 2].max())
        self.back_y = float(hv[:, 1].max())
        self.front_y = float(hv[:, 1].min())
        self.centre = np.array([0.0, (self.back_y + self.front_y) * 0.5 + 0.005, (self.top + self.eye[2]) * 0.5 - 0.01])
        self.radius = (self.top - self.eye[2]) * 1.15
        self.scale = (self.top - self.eye[2]) / 0.115  # 1.0 for an adult head
        jaw = b["face_jaw"]
        self.jaw = np.array(jaw[0])
        self.chin_z = float(np.array(jaw[1])[2])
        self.neck_z = float(info.neck_z)

    def azimuth(self, p):
        return math.atan2(p[0] - self.centre[0], -(p[1] - self.centre[1]))


def _hairline_z(head, phi, style):
    """Hairline height at azimuth phi (0 front, pi back): forehead, temples, over the ears, behind, nape."""
    e = head.eye[2]
    s = head.scale
    a = abs(phi)
    pts = [(0.0, e + style["front"] * s), (0.75, e + (style["front"] - 0.012) * s), (1.25, e + 0.012 * s),
           (1.75, e - 0.03 * s), (2.4, e - style["nape"] * 0.85 * s), (math.pi, e - style["nape"] * s)]
    xs, zs = zip(*pts)
    return float(np.interp(a, xs, zs))


def _head_vertex(info, i):
    d = info.dominant[i]
    return d == "head" or (d == "neck" and info.v[i][2] > info.neck_z + 0.02)


def _region_shell(info, name, keep, offset, smooth):
    mask = np.array([bool(keep(i)) for i in range(len(info.v))])
    me = info.body.data
    faces = sum(1 for poly in me.polygons if all(mask[v] for v in poly.vertices))
    if faces < 3:
        return new_mesh(name, np.zeros((0, 3)), []), []
    obj, idx = O.shell(info, name, lambda i: mask[i], offset, smooth=smooth)
    return obj, idx


def _rigid(obj, arm, bone="head"):
    assign_weights(obj, [{bone: 1.0}] * len(obj.data.vertices), arm)


def _noise(obj, head, amp, seed, freq=38.0):
    if amp <= 0:
        return
    co = vertex_array(obj)
    rng = np.random.default_rng(seed)
    ph = rng.uniform(0, 6.28, 6)
    c = head.centre
    d = co - c
    r = np.linalg.norm(d, axis=1, keepdims=True) + 1e-9
    n = d / r
    f = freq
    w = (np.sin(co[:, 0] * f + ph[0]) * np.sin(co[:, 1] * f * 1.3 + ph[1]) * np.sin(co[:, 2] * f * 0.9 + ph[2])
         + 0.5 * np.sin(co[:, 0] * f * 2.1 + ph[3]) * np.sin(co[:, 2] * f * 1.7 + ph[4]))
    co += n * (amp * w)[:, None]
    obj.data.vertices.foreach_set("co", co.ravel())
    obj.data.update()


def _tube(name, path, radii, sides=8, bulge=0.0, bulges=0):
    """Tube along a polyline with per-point radius; bulges make a braid read as plaited."""
    path = [np.array(p, dtype=float) for p in path]
    verts, faces = [], []
    n = len(path)
    prev_side = None
    for k, p in enumerate(path):
        t = path[min(k + 1, n - 1)] - path[max(k - 1, 0)]
        t /= np.linalg.norm(t) + 1e-9
        side = np.cross(t, [0.0, 1.0, 0.0]) if prev_side is None else prev_side - t * np.dot(prev_side, t)
        if np.linalg.norm(side) < 1e-6:
            side = np.cross(t, [1.0, 0.0, 0.0])
        side /= np.linalg.norm(side)
        prev_side = side
        up = np.cross(t, side)
        r = radii[k] * (1.0 + (bulge * abs(math.sin(k / max(1, n - 1) * math.pi * bulges)) if bulges else 0.0))
        for j in range(sides):
            a = 2 * math.pi * j / sides
            verts.append(p + (side * math.cos(a) + up * math.sin(a)) * r)
    for k in range(n - 1):
        for j in range(sides):
            a, b = k * sides + j, k * sides + (j + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    verts.append(path[-1] + (path[-1] - path[-2]) / (np.linalg.norm(path[-1] - path[-2]) + 1e-9) * radii[-1] * 0.6)
    tip = len(verts) - 1
    for j in range(sides):
        faces.append(((n - 1) * sides + j, (n - 1) * sides + (j + 1) % sides, tip))
    return new_mesh(name, np.array(verts), faces)


def _chain_weights(obj, arm, chain):
    """Weights along z for hanging parts: chain is [(z, {bone: w})] from top to bottom."""
    co = vertex_array(obj)
    zs = [c[0] for c in chain]
    out = []
    for p in co:
        z = p[2]
        if z >= zs[0]:
            out.append(dict(chain[0][1]))
            continue
        if z <= zs[-1]:
            out.append(dict(chain[-1][1]))
            continue
        for k in range(len(chain) - 1):
            if zs[k] >= z >= zs[k + 1]:
                t = (zs[k] - z) / max(1e-6, zs[k] - zs[k + 1])
                w = {}
                for bone, v in chain[k][1].items():
                    w[bone] = w.get(bone, 0.0) + v * (1 - t)
                for bone, v in chain[k + 1][1].items():
                    w[bone] = w.get(bone, 0.0) + v * t
                out.append(w)
                break
    assign_weights(obj, out, arm)


def _tag(obj, slot, kind, fabric=""):
    obj["crowd_slot"] = slot
    obj["crowd_kind"] = kind
    obj["crowd_fabric"] = fabric
    obj["crownfall_part"] = "hair" if slot in ("hair", "beard") else "headwear"
    return obj


def build_hair(info, fr, arm, head, recipe, pieces):
    style_id = recipe["hair"]["style"]
    st = STYLES[style_id]
    cover = COVER.get(recipe.get("headwear", "none"))
    s = head.scale
    seed = recipe.get("seed", 1)
    top = np.array([0.0, head.centre[1] + 0.01 * s, head.top])

    def keep(i):
        if not _head_vertex(info, i):
            return False
        p = info.v[i]
        if p[2] < _hairline_z(head, head.azimuth(p), st):
            return False
        bald = st.get("bald")
        if bald == "crown" and p[2] > head.eye[2] + 0.07 * s and p[1] < head.centre[1] + 0.03 * s:
            return False
        if bald == "tonsure" and np.linalg.norm((p - top)[:2]) < 0.052 * s and p[2] > head.top - 0.04 * s:
            return False
        if bald == "thin" and p[2] > head.eye[2] + 0.085 * s and p[1] < head.centre[1]:
            return False
        return True
    if cover == "all" and (recipe.get("headwear") != "hood" or "Hood" in pieces):
        # coifs, hoods, head-cloths and veils hide the whole scalp: the first batch kept a hair mass (and braids) under
        # them, which came through the cloth after decimation as blotches and dark stripes. Nothing is built under them.
        return
    t = st["t"] * (0.85 + 0.3 * s)
    crown, fringe = st.get("crown", 0.0), st.get("fringe", 0.0)
    if cover == "top":
        # under a cap, kerchief, hat or helmet the hair lies flat: only the edge below the headwear shows (the full
        # volume pushed through the felt caps and kerchiefs as a grey or brown mass)
        t, crown, fringe = min(t, 0.008), 0.0, 0.0
    hair, idx = _region_shell(info, "Hair", keep, t, smooth=10)
    if len(hair.data.vertices) == 0:
        bpy.data.objects.remove(hair)
        return
    # volume: thicker at the crown and back, thinner at the hairline
    co = vertex_array(hair)
    d = co - head.centre
    r = np.linalg.norm(d, axis=1, keepdims=True) + 1e-9
    hl = np.array([_hairline_z(head, head.azimuth(p), st) for p in co])
    lift = np.clip((co[:, 2] - hl) / 0.04, 0.0, 1.0) * t * (0.5 + 0.5 * crown)
    if fringe:  # a band of hair standing forward over the forehead (front only)
        az = np.array([abs(head.azimuth(p)) for p in co])
        band = np.exp(-((co[:, 2] - hl - 0.012 * s) / (0.016 * s)) ** 2) * np.clip(1.0 - az / 0.9, 0.0, 1.0)
        lift += band * t * fringe
        co[:, 2] -= band * 0.006 * s * fringe
    co += d / r * lift[:, None]
    hair.data.vertices.foreach_set("co", co.ravel())
    hair.data.update()
    _noise(hair, head, st["noise"] * s, seed)
    G.push_outside(hair, (info.tree,), 0.002)
    G._copy_body_weights(hair, info, idx, arm)
    for loop in G.boundary_loops(hair):
        G.relax_loop(hair, loop, 8)
    pieces["Hair"] = _tag(hair, "hair", "mass")
    extra = st.get("extra")
    if cover == "all" and extra in ("ponytail", "bun", "sheet", "twin"):
        extra = None  # tucked under the cloth
    back = np.array([0.0, head.back_y + 0.004, head.eye[2] - 0.02 * s])
    neck_bones = {"neck": 0.6, "head": 0.4}
    spine = {"spine_03": 1.0}
    if extra == "ponytail":
        p0 = back + np.array([0.0, 0.01, 0.0])
        path = [p0, p0 + np.array([0, 0.03, -0.04]) * s, p0 + np.array([0, 0.035, -0.09]) * s, p0 + np.array([0, 0.03, -0.14]) * s]
        tube = _tube("HairTail", path, [0.018 * s, 0.016 * s, 0.012 * s, 0.006 * s], sides=7)
        _chain_weights(tube, arm, [(p0[2], {"head": 1.0}), (p0[2] - 0.06 * s, neck_bones), (p0[2] - 0.14 * s, {"neck": 0.5, "spine_03": 0.5})])
        pieces["HairTail"] = _tag(tube, "hair", "tail")
    elif extra == "bun":
        c = back + np.array([0.0, 0.012, 0.045]) * s
        b = O.blob("HairBun", c, (0.032 * s, 0.026 * s, 0.028 * s), arm, {"head": 1.0}, subdiv=2, seed=seed)
        pieces["HairBun"] = _tag(b, "hair", "bun")
    elif extra == "braid":
        p0 = back + np.array([0.0, 0.012, -0.01])
        length = 0.32 * s if recipe["archetype"] not in ("child",) else 0.2 * s
        n = 9
        path = [p0 + np.array([0.0, 0.035 * math.sin(min(1, k / 3) * 1.4) * s, -length * k / (n - 1)]) for k in range(n)]
        G_trees = O.torso_tree(info)
        for k in range(2, n):  # rest on the back
            hit = G_trees.ray_cast(Vector((0.0, 1.0, path[k][2])), Vector((0.0, -1.0, 0.0)), 2.0)
            if hit[0] is not None:
                path[k][1] = max(path[k][1], hit[0].y + 0.035 * s)
        radii = [0.02 * s] + [0.016 * s] * (n - 3) + [0.012 * s, 0.006 * s]
        tube = _tube("HairBraid", path, radii, sides=7, bulge=0.25, bulges=6)
        _chain_weights(tube, arm, [(p0[2], {"head": 1.0}), (p0[2] - 0.08 * s, neck_bones), (p0[2] - 0.2 * s, spine),
                                   (p0[2] - 0.35 * s, {"spine_02": 0.6, "spine_03": 0.4})])
        pieces["HairBraid"] = _tag(tube, "hair", "braid")
    elif extra == "twin":
        for side, sx in (("l", 1.0), ("r", -1.0)):
            p0 = np.array([sx * (head.eye_dx + 0.045 * s), head.centre[1] + 0.03 * s, head.eye[2] - 0.03 * s])
            sh = np.array(info.bones[f"clavicle_{side}"][1])
            path = [p0, p0 + np.array([sx * 0.008, -0.005, -0.06]) * s, sh + np.array([-sx * 0.035, -0.06, 0.03]) * s,
                    sh + np.array([-sx * 0.05, -0.085, -0.04]) * s, sh + np.array([-sx * 0.055, -0.09, -0.1]) * s]
            tube = _tube(f"HairBraid_{side}", path, [0.014 * s, 0.013 * s, 0.012 * s, 0.011 * s, 0.005 * s], sides=6, bulge=0.25, bulges=4)
            _chain_weights(tube, arm, [(p0[2], {"head": 1.0}), (p0[2] - 0.07 * s, neck_bones),
                                       (sh[2], {"spine_03": 0.6, f"clavicle_{side}": 0.4}), (sh[2] - 0.1 * s, {"spine_03": 1.0})])
            pieces[f"HairBraid_{side}"] = _tag(tube, "hair", "braid")
    elif extra == "sheet":
        nape = head.eye[2] - st["nape"] * s * 0.6
        hem_z = float(info.bones["spine_03"][0][2]) + 0.02
        trees = [O.torso_tree(info)] + [G.tree_of([p]) for k, p in pieces.items() if k in ("Upper", "Cape", "Hood")]
        # hangs down the back between the shoulder blades (the first batch's 2.1 rad opening spread it over the shoulders
        # like a stiff cape)
        sheet, _rows = O.capelet(info, fr, arm, "HairSheet", nape, lambda a: hem_z - 0.03 * math.cos(a) * s, trees,
                                 lambda t: 0.008 + 0.003 * t, segments=12, rings=6, flare=0.0, folds=5, fold_amp=0.004,
                                 v_gap_top=2.45, v_gap_min=2.3, seed=seed * 0.01, relax=8)
        _chain_weights(sheet, arm, [(nape, {"head": 0.7, "neck": 0.3}), (nape - 0.06, {"neck": 0.5, "spine_03": 0.5}), (hem_z, {"spine_03": 1.0})])
        pieces["HairSheet"] = _tag(sheet, "hair", "sheet")


def build_beard(info, arm, head, recipe, pieces):
    kind = recipe["hair"].get("facialHair", "none")
    if kind in ("none", "stubble", "short-beard", "moustache"):
        return  # painted on the skin by the texture stage (a thin shell decimates into patches at crowd density)
    s = head.scale
    me = info.body.data
    lips = np.zeros(len(info.v), dtype=bool)
    a = me.attributes.get("crownfall_lips")
    if a is not None and len(a.data) == len(info.v):
        vals = np.zeros(len(info.v), dtype=np.int32)
        a.data.foreach_get("value", vals)
        lips = vals.astype(bool)
    lip_pts = info.v[lips] if lips.any() else np.zeros((0, 3))
    mouth_z = float(lip_pts[:, 2].mean()) if len(lip_pts) else head.jaw[2] - 0.02
    mouth_hw = float(np.abs(lip_pts[:, 0]).max()) if len(lip_pts) else 0.025
    ear_y = head.centre[1] + 0.005
    from mathutils.kdtree import KDTree
    kd = None
    if len(lip_pts):
        kd = KDTree(len(lip_pts))
        for k, p in enumerate(lip_pts):
            kd.insert(p, k)
        kd.balance()

    def lip_dist(p):
        if kd is None:
            return 1.0
        return kd.find(p)[2]

    def keep(i):
        d = info.dominant[i]
        if d not in ("head", "face_jaw", "neck"):
            return False
        p = info.v[i]
        if p[1] > ear_y or p[2] > head.eye[2] - 0.035 * s:
            return False
        if lip_dist(p) < 0.004:
            return False
        if kind == "moustache":
            return abs(p[0]) < mouth_hw + 0.012 and mouth_z + 0.002 < p[2] < mouth_z + 0.024 * s and p[1] < head.jaw[1] - 0.03
        # cheek line: from the sideburn down to just above the mouth corner
        x = abs(p[0])
        cheek = head.eye[2] - 0.035 * s - (head.eye[2] - 0.035 * s - (mouth_z + 0.012)) * np.clip((head.eye_dx + 0.05 - x) / 0.05, 0, 1)
        if p[2] > cheek and not (x < mouth_hw + 0.006 and mouth_z + 0.004 < p[2] < mouth_z + 0.02 * s):
            return False
        return p[2] > info.neck_z + (0.01 if kind == "full-beard" else 0.035) * s
    offset = {"short-beard": 0.0055, "full-beard": 0.011, "moustache": 0.004}[kind] * (0.8 + 0.2 * s)
    beard, idx = _region_shell(info, "Beard", keep, offset, smooth=6)
    if len(beard.data.vertices) == 0:
        bpy.data.objects.remove(beard)
        return
    if kind == "full-beard":  # longer at the chin
        co = vertex_array(beard)
        chin = np.exp(-((co[:, 0] / 0.03) ** 2)) * np.clip((mouth_z - 0.01 - co[:, 2]) / 0.04, 0, 1)
        co[:, 2] -= chin * 0.025 * s
        co[:, 1] -= chin * 0.008 * s
        beard.data.vertices.foreach_set("co", co.ravel())
        beard.data.update()
    _noise(beard, head, 0.0015 * s, recipe.get("seed", 1) + 7, freq=60.0)
    G._copy_body_weights(beard, info, idx, arm)
    pieces["Beard"] = _tag(beard, "beard", kind)


def _shell_over(info, name, head, keep, offset, smooth=12):
    obj, idx = _region_shell(info, name, keep, offset, smooth)
    G.push_outside(obj, (info.tree,), offset * 0.7)
    return obj, idx


def _ring_brim(name, centre, z, r_in, r_out, droop, segments=24, thickness=0.006):
    verts, faces = [], []
    for k, (r, dz) in enumerate(((r_in, 0.0), (r_out, -droop))):
        for j in range(segments):
            a = 2 * math.pi * j / segments
            verts.append((centre[0] + math.sin(a) * r, centre[1] - math.cos(a) * r * 1.08, z + dz))
    for j in range(segments):
        a, b = j, (j + 1) % segments
        faces.append((a, b, b + segments, a + segments))
    obj = new_mesh(name, np.array(verts), faces)
    mod = obj.modifiers.new("Solid", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = 0.0
    G._apply_modifiers(obj)
    return obj


def _spherize(obj, centre, radius, amount, cone=0.0, top_z=None):
    co = vertex_array(obj)
    d = co - centre
    r = np.linalg.norm(d, axis=1, keepdims=True) + 1e-9
    target = centre + d / r * radius
    if cone > 0 and top_z is not None:
        k = np.clip((co[:, 2] - centre[2]) / max(1e-4, top_z - centre[2]), 0, 1)
        target[:, 2] += cone * k ** 2
        target[:, :2] = centre[:2] + (target[:, :2] - centre[:2]) * (1.0 - 0.35 * k[:, None] ** 2)
    co = co + (target - co) * amount
    obj.data.vertices.foreach_set("co", co.ravel())
    obj.data.update()


def _ribbon(name, path, widths, thick, side):
    """Flat cloth strip along a polyline (tails, lappets): rectangle cross-section, `side` the width direction."""
    path = [np.array(p, dtype=float) for p in path]
    side = np.array(side, dtype=float) / (np.linalg.norm(side) + 1e-9)
    verts, faces = [], []
    n = len(path)
    for k, p in enumerate(path):
        t = path[min(k + 1, n - 1)] - path[max(k - 1, 0)]
        t /= np.linalg.norm(t) + 1e-9
        sd = side - t * np.dot(side, t)
        sd /= np.linalg.norm(sd) + 1e-9
        nd = np.cross(t, sd)
        w = widths[k] * 0.5
        for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append(p + sd * w * a + nd * thick * 0.5 * b)
    for k in range(n - 1):
        for j in range(4):
            a, b = k * 4 + j, k * 4 + (j + 1) % 4
            faces.append((a, b, b + 4, a + 4))
    faces.append((0, 3, 2, 1))
    faces.append(((n - 1) * 4, (n - 1) * 4 + 1, (n - 1) * 4 + 2, (n - 1) * 4 + 3))
    return new_mesh(name, np.array(verts), faces)


def _torus(name, centre, rx, ry, minor, z_of=None, segments=24, sides=6):
    """Rolled band (a ring of tube) around the head at height centre[2] (z_of(angle) may tilt it)."""
    verts, faces = [], []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        c = np.array([centre[0] + math.sin(a) * rx, centre[1] - math.cos(a) * ry, z_of(a) if z_of else centre[2]])
        out = np.array([math.sin(a), -math.cos(a), 0.0])
        for j in range(sides):
            b = 2 * math.pi * j / sides
            verts.append(c + out * math.cos(b) * minor + np.array([0.0, 0.0, 1.0]) * math.sin(b) * minor)
    for i in range(segments):
        for j in range(sides):
            a, b = i * sides + j, i * sides + (j + 1) % sides
            c2, d = ((i + 1) % segments) * sides + (j + 1) % sides, ((i + 1) % segments) * sides + j
            faces.append((a, b, c2, d))
    return new_mesh(name, np.array(verts), faces)


def _accessory(obj, slot, hw, fabric=""):
    """Small generated headwear parts (tails, lappets, bands, straps): built at crowd density, kept out of decimation."""
    _tag(obj, slot, hw, fabric)
    obj["crowd_accessory"] = True
    return obj


def _chin_strap(info, arm, head, name, offset):
    """Tie under the chin from ear to ear (a coif's strings): its lowest part follows the jaw."""
    s = head.scale
    e = head.eye[2]
    pts = []
    for k in range(9):
        u = k / 8.0
        a = (u - 0.5) * math.pi  # -90 (right ear) .. +90 (left ear) degrees around under the chin
        x = math.sin(a) * (head.eye_dx + 0.035 * s)
        z = e - 0.045 * s - math.cos(a) * (e - 0.045 * s - head.chin_z + 0.012 * s)
        y = head.jaw[1] - 0.02 * s - math.cos(a) * 0.035 * s
        pts.append((x, y, z))
    strap = _tube(name, pts, [0.0045 * s] * 9, sides=4)
    _chain_weights(strap, arm, [(e - 0.03 * s, {"head": 1.0}), (head.chin_z + 0.01 * s, {"face_jaw": 0.7, "head": 0.3}),
                                (head.chin_z - 0.01 * s, {"face_jaw": 1.0})])
    G.push_outside(strap, (info.tree,), offset)
    return strap


def build_headwear(info, fr, arm, head, recipe, pieces):
    """Headwear shells and their shape variants (art fixer, 8 November: shapes that read from above, and every linen,
    felt and kerchief piece coloured by the resident's own headwear tone, slot `headwear`, instead of one fixed linen)."""
    hw = recipe.get("headwear", "none")
    shape = (recipe.get("headwearStyle") or {}).get("shape", "plain")
    if hw == "none":
        return
    s = head.scale
    seed = recipe.get("seed", 1)
    hair_t = STYLES[recipe["hair"]["style"]]["t"] * 1.3
    e = head.eye[2]
    back = np.array([0.0, head.back_y, e])
    tail_chain = lambda z0: [(z0, {"head": 1.0}), (head.neck_z, {"neck": 0.6, "head": 0.4}), (head.neck_z - 0.1 * s, {"spine_03": 1.0})]
    if hw == "hood":
        hood = pieces.get("Hood")
        if hood is not None and shape == "liripipe":
            # a long tail from the hood's point hanging down the back
            hv = vertex_array(hood)
            upper = hv[hv[:, 2] > hv[:, 2].max() - 0.05 * s]
            top = upper[np.argmax(upper[:, 1])]  # the back of the hood just below its point
            p0 = top + np.array([0.0, -0.004, -0.02 * s])
            path = [p0, p0 + np.array([0.0, 0.05, -0.04]) * s, p0 + np.array([0.0, 0.07, -0.13]) * s,
                    p0 + np.array([0.0, 0.075, -0.24]) * s, p0 + np.array([0.0, 0.07, -0.34]) * s]
            tail = _tube("HoodTail", path, [0.03 * s, 0.022 * s, 0.016 * s, 0.012 * s, 0.006 * s], sides=6)
            G.push_outside(tail, (O.torso_tree(info),), 0.03)
            _chain_weights(tail, arm, tail_chain(p0[2]))
            pieces["HoodTail"] = _accessory(tail, hood.get("crowd_slot", "secondary"), hw, hood.get("crowd_fabric", ""))
        return

    def scalp(above_front, nape, include_ears=False):
        def keep(i):
            if not _head_vertex(info, i):
                return include_ears and info.dominant[i] == "neck" and info.v[i][2] > info.neck_z - 0.01
            p = info.v[i]
            phi = abs(head.azimuth(p))
            zline = float(np.interp(phi, [0.0, 0.8, 1.3, 1.9, math.pi],
                                    [e + above_front * s, e + (above_front - 0.01) * s,
                                     (e - 0.045 * s) if include_ears else (e + 0.005 * s), e - nape * 0.7 * s, e - nape * s]))
            return p[2] > zline
        return keep

    def relax_rims(obj, n=12):
        for loop in G.boundary_loops(obj):
            G.relax_loop(obj, loop, n)
    if hw in ("coif", "padded-coif"):
        off = hair_t + (0.016 if hw == "padded-coif" else 0.005)
        obj, idx = _shell_over(info, "Coif", head, scalp(0.035, 0.09 if hw == "padded-coif" else 0.07, include_ears=True), off, 14)
        _rigid(obj, arm) if hw == "coif" else G._copy_body_weights(obj, info, idx, arm)
        relax_rims(obj)
        pieces["Coif"] = _tag(obj, "quilt" if hw == "padded-coif" else "headwear", hw, "hessian_230" if hw == "padded-coif" else "rough_linen")
        if shape == "chin-tied":
            pieces["CoifTie"] = _accessory(_chin_strap(info, arm, head, "CoifTie", off * 0.6), pieces["Coif"]["crowd_slot"], hw, "rough_linen")
    elif hw == "felt-cap":
        obj, idx = _shell_over(info, "Cap", head, scalp(0.06, 0.0), hair_t + 0.007, 12)
        _spherize(obj, head.centre, head.radius * 0.93, 0.35, cone=(0.035 * s if shape == "peaked" else 0.0), top_z=head.top + hair_t + 0.02)
        _rigid(obj, arm)
        relax_rims(obj, 16)
        G._rim(obj, 0.012)
        G._apply_modifiers(obj)
        pieces["Cap"] = _tag(obj, "headwear", hw, "caban")
        if shape == "rolled-brim":
            cv = vertex_array(obj)
            zb = float(np.percentile(cv[:, 2], 6)) + 0.006
            ring = cv[np.abs(cv[:, 2] - zb) < 0.012]
            rx = float(np.abs(ring[:, 0]).max()) if len(ring) else head.radius * 0.8
            ry = float((ring[:, 1].max() - ring[:, 1].min()) / 2) if len(ring) else head.radius * 0.85
            cy = float((ring[:, 1].max() + ring[:, 1].min()) / 2) if len(ring) else head.centre[1]
            band = _torus("CapBrim", np.array([0.0, cy, zb]), rx + 0.004, ry + 0.004, 0.011 * s,
                          z_of=lambda a: zb + 0.012 * s * max(0.0, -math.cos(a)) - 0.006 * s * max(0.0, math.cos(a)))
            _rigid(band, arm)
            pieces["CapBrim"] = _accessory(band, "headwear", hw, "caban")
    elif hw == "straw-hat":
        obj, idx = _shell_over(info, "HatCrown", head, scalp(0.065, -0.01), hair_t + 0.012, 12)
        co = vertex_array(obj)
        co[:, 2] = np.minimum(co[:, 2], head.top + hair_t + 0.02)
        obj.data.vertices.foreach_set("co", co.ravel())
        obj.data.update()
        _rigid(obj, arm)
        relax_rims(obj)
        base_z = float(vertex_array(obj)[:, 2].min()) + 0.008
        width = {"wide": 0.095, "narrow": 0.055}.get(shape, 0.075)
        brim = _ring_brim("HatBrim", head.centre, base_z, head.radius * 0.72, head.radius * 0.72 + width * s, (0.024 if shape == "wide" else 0.014) * s, thickness=0.005)
        _rigid(brim, arm)
        pieces["HatCrown"] = _tag(obj, "straw", hw, "hessian_230")
        pieces["HatBrim"] = _tag(brim, "straw", hw, "hessian_230")
        brim["crowd_accessory"] = True
    elif hw in ("kettle-helmet", "nasal-helmet"):
        obj, idx = _shell_over(info, "Helmet", head, scalp(0.03 if hw == "kettle-helmet" else 0.035, -0.005), hair_t + 0.014, 10)
        top_z = head.top + hair_t + 0.02
        _spherize(obj, head.centre + np.array([0.0, 0.0, -0.01]), head.radius * 0.9, 0.35,
                  cone=0.03 * s if hw == "nasal-helmet" else 0.0, top_z=top_z)
        G.push_outside(obj, (G.tree_of([pieces["Hair"]]) if "Hair" in pieces else info.tree,), 0.004)
        G.push_outside(obj, (info.tree,), hair_t + 0.006)
        relax_rims(obj, 16)
        G._rim(obj, 0.006)
        G._apply_modifiers(obj)
        _rigid(obj, arm)
        pieces["Helmet"] = _tag(obj, "metal", hw)
        if hw == "kettle-helmet":
            # the brim sits level at the brow (the first batch put it at the helmet's lowest point, which is eye level at
            # the sides, so the brim crossed the eyes); the dome below the brim is cut away so hair shows under it
            base_z = e + 0.03 * s
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z < base_z - 0.004], context="FACES")
            bm.to_mesh(obj.data)
            bm.free()
            obj.data.update()
            relax_rims(obj, 16)
            brim = _ring_brim("HelmetBrim", head.centre, base_z, head.radius * 0.78, head.radius * 0.78 + 0.042 * s, 0.022 * s, thickness=0.004)
            _rigid(brim, arm)
            pieces["HelmetBrim"] = _tag(brim, "metal", hw)
            brim["crowd_accessory"] = True
        else:
            hv = info.v[[i for i, d in enumerate(info.dominant) if d == "head" and abs(info.v[i][0]) < 0.006
                         and e + 0.0 < info.v[i][2] < e + 0.03 * s]]
            fy = float(hv[:, 1].min()) if len(hv) else head.front_y
            nose_top = np.array([0.0, fy - 0.008, e + 0.028 * s])
            bar = O.cylinder("Nasal", nose_top, nose_top + np.array([0.0, -0.012, -0.05 * s]), 0.006 * s, arm, {"head": 1.0}, segments=4)
            pieces["Nasal"] = _tag(bar, "metal", hw)
            bar["crowd_accessory"] = True
    elif hw == "kerchief":
        obj, idx = _shell_over(info, "Kerchief", head, scalp(0.04, 0.08), hair_t + 0.006, 12)
        _rigid(obj, arm)
        relax_rims(obj, 10)
        knot_c = np.array([0.0, head.back_y + hair_t + 0.01, e - 0.06 * s])
        knot = O.blob("KerchiefKnot", knot_c, (0.018 * s, 0.012 * s, 0.014 * s), arm, {"head": 1.0}, subdiv=1, seed=seed)
        pieces["Kerchief"] = _tag(obj, "headwear", hw, "rough_linen")
        pieces["KerchiefKnot"] = _accessory(knot, "headwear", hw, "rough_linen")
        if shape == "nape-tails":
            for side, sx in (("l", 1.0), ("r", -1.0)):
                p0 = knot_c + np.array([sx * 0.008, 0.004, -0.008])
                path = [p0, p0 + np.array([sx * 0.012, 0.012, -0.04]) * s, p0 + np.array([sx * 0.018, 0.016, -0.085]) * s]
                tail = _ribbon(f"KerchiefTail_{side}", path, [0.028 * s, 0.03 * s, 0.022 * s], 0.004, (1.0, 0.0, 0.0))
                G.push_outside(tail, (O.torso_tree(info),), 0.012)
                _chain_weights(tail, arm, tail_chain(p0[2]))
                pieces[f"KerchiefTail_{side}"] = _accessory(tail, "headwear", hw, "rough_linen")
    elif hw == "head-cloth":
        obj, idx = _shell_over(info, "HeadCloth", head, scalp(0.038, 0.1), hair_t + 0.012, 14)
        _spherize(obj, head.centre + np.array([0.0, 0.01, 0.0]), head.radius * 1.0, 0.2)
        G._copy_body_weights(obj, info, idx, arm)
        relax_rims(obj)
        pieces["HeadCloth"] = _tag(obj, "headwear", hw, "rough_linen")
        knot_z = e + 0.01 * s if shape != "knotted-tails" else e - 0.035 * s
        knot_c = np.array([0.0, head.back_y + hair_t + 0.02, knot_z])
        knot = O.blob("HeadClothKnot", knot_c, (0.03 * s, 0.022 * s, 0.026 * s), arm, {"head": 1.0}, subdiv=1, seed=seed)
        pieces["HeadClothKnot"] = _accessory(knot, "headwear", hw, "rough_linen")
        if shape == "knotted-tails":
            for side, sx in (("l", 1.0), ("r", -1.0)):
                p0 = knot_c + np.array([sx * 0.012, 0.006, -0.012])
                path = [p0, p0 + np.array([sx * 0.02, 0.02, -0.05]) * s, p0 + np.array([sx * 0.03, 0.03, -0.11]) * s,
                        p0 + np.array([sx * 0.034, 0.034, -0.16]) * s]
                tail = _ribbon(f"HeadClothTail_{side}", path, [0.036 * s, 0.042 * s, 0.04 * s, 0.03 * s], 0.004, (1.0, 0.0, 0.0))
                G.push_outside(tail, (O.torso_tree(info),), 0.014)
                _chain_weights(tail, arm, tail_chain(p0[2]))
                pieces[f"HeadClothTail_{side}"] = _accessory(tail, "headwear", hw, "rough_linen")
        elif shape == "lappets":
            # two flaps from the temples down over the ears to the shoulders
            for side, sx in (("l", 1.0), ("r", -1.0)):
                x = sx * (head.eye_dx + 0.05 * s + hair_t)
                p0 = np.array([x, head.centre[1] - 0.005, e + 0.02 * s])
                path = [p0, p0 + np.array([sx * 0.008, 0.004, -0.06]) * s, p0 + np.array([sx * 0.02, 0.01, -0.13]) * s,
                        p0 + np.array([sx * 0.04, 0.018, -0.2]) * s]
                flap = _ribbon(f"HeadClothLappet_{side}", path, [0.05 * s, 0.055 * s, 0.06 * s, 0.055 * s], 0.004, (0.0, 1.0, 0.0))
                G.push_outside(flap, (info.tree,), hair_t + 0.012)
                _chain_weights(flap, arm, [(p0[2] - 0.03 * s, {"head": 1.0}), (head.neck_z, {"neck": 0.6, "head": 0.4}),
                                           (head.neck_z - 0.08 * s, {"spine_03": 0.6, f"clavicle_{side}": 0.4})])
                pieces[f"HeadClothLappet_{side}"] = _accessory(flap, "headwear", hw, "rough_linen")
        elif shape == "rolled-band":
            cv = vertex_array(obj)
            zb = e + 0.045 * s
            ring = cv[np.abs(cv[:, 2] - zb) < 0.012]
            if len(ring):
                rx = float(np.abs(ring[:, 0]).max())
                ry = float((ring[:, 1].max() - ring[:, 1].min()) / 2)
                cy = float((ring[:, 1].max() + ring[:, 1].min()) / 2)
                band = _torus("HeadClothBand", np.array([0.0, cy, zb]), rx + 0.006, ry + 0.006, 0.014 * s,
                              z_of=lambda a: zb + 0.01 * s * max(0.0, -math.cos(a)))
                _rigid(band, arm)
                pieces["HeadClothBand"] = _accessory(band, "headwear", hw, "rough_linen")
    elif hw == "veil-wimple":
        import crowd_outfits as CO
        wimple = CO._hood(info, fr, arm, "Wimple", offset=hair_t + 0.01)
        pieces["Wimple"] = _tag(wimple, "headwear", hw, "rough_linen")
        trees = [O.torso_tree(info), G.tree_of([wimple])] + [G.tree_of([p]) for k, p in pieces.items() if k in ("Upper", "Cape")]
        # folded-crown: the veil is laid over the crown (it starts just below the top of the head and its folded edge shows
        # from above); plain: it hangs from the temples behind the wimple
        veil_top = e + (0.075 if shape == "folded-crown" else 0.01) * s
        veil, _ = O.capelet(info, fr, arm, "Veil", veil_top, lambda a: info.neck_z - (0.09 + 0.05 * max(0.0, -math.cos(a))) * s,
                            trees, lambda t: 0.008 + 0.01 * t, segments=20, rings=8 if shape == "folded-crown" else 7, flare=0.02, folds=6,
                            fold_amp=0.005, v_gap_top=1.15 if shape != "folded-crown" else 1.25, v_gap_min=1.05, seed=seed * 0.01, relax=10)
        _chain_weights(veil, arm, [(e, {"head": 1.0}), (info.neck_z, {"neck": 0.6, "head": 0.4}), (info.neck_z - 0.1, {"spine_03": 1.0})])
        pieces["Veil"] = _tag(veil, "headwear", hw, "rough_linen")
    elif hw == "ribbon":
        # painted on the hair (a ring of geometry read as a halo at crowd density)
        hair = pieces.get("Hair")
        if hair is not None:
            c = np.array([0.0, head.centre[1], e + 0.05 * s])
            hair["crowd_marks"] = __import__("json").dumps([{"head": [float(x) for x in c], "tail": [float(x) for x in c + np.array([0.0, -0.004, 0.022 * s])],
                                                             "t": [0.0, 1.0], "slot": "accent", "reach": 0.2}])


def hide_covered_hair(pieces, report):
    """Delete hair faces hidden under headwear (a ray outward from the face centre hits headwear within 6 cm)."""
    wear = [p for p in pieces.values() if p.get("crownfall_part") == "headwear"]
    if not wear:
        return
    tree = G.tree_of(wear)
    removed = 0
    for name in [k for k, p in pieces.items() if p.get("crowd_slot") == "hair"]:
        obj = pieces[name]
        doomed = []
        for poly in obj.data.polygons:
            c, n = poly.center, poly.normal
            hit = tree.ray_cast(c + n * 0.001, n, 0.06)
            if hit[0] is not None:
                hit2 = tree.ray_cast(c + n * 0.001, (n + Vector((0, 0, 0.4))).normalized(), 0.07)
                if hit2[0] is not None:
                    doomed.append(poly.index)
        removed += len(doomed)
        delete_faces(obj, doomed)
        if len(obj.data.polygons) == 0:
            bpy.data.objects.remove(obj)
            del pieces[name]
    report["hairFacesUnderHeadwear"] = removed


def build(body, arm, recipe, garments, report):
    """Hair, beard and headwear on the body. Returns {name: object}."""
    full = None
    if body.get("crowd_full_mesh") and body["crowd_full_mesh"] in bpy.data.meshes:
        full = bpy.data.objects.new("BodyFull", bpy.data.meshes[body["crowd_full_mesh"]])
        bpy.context.scene.collection.objects.link(full)
        for g in body.vertex_groups:
            full.vertex_groups.new(name=g.name)
    proxy = O.garment_proxy(full or body, arm, flatten=10)
    info = G.BodyInfo(proxy, arm)
    fr = O.Frame(info, arm)
    head = Head(info, arm)
    pieces = {}
    combined = dict(garments)
    build_hair(info, fr, arm, head, recipe, combined)
    build_beard(info, arm, head, recipe, combined)
    build_headwear(info, fr, arm, head, recipe, combined)
    for k, v in combined.items():
        if k not in garments:
            pieces[k] = v
    hide_covered_hair(pieces, report)
    bpy.data.objects.remove(proxy)
    if full is not None:
        mesh = full.data
        bpy.data.objects.remove(full)
        bpy.data.meshes.remove(mesh)
        del body["crowd_full_mesh"]
    report["crowdHair"] = {"style": recipe["hair"]["style"], "facialHair": recipe["hair"].get("facialHair"),
                           "headwear": recipe.get("headwear"), "pieces": {k: triangle_count(v) for k, v in pieces.items()}}
    return pieces

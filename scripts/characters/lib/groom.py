"""Stage: original hair, beard and brow cards with a procedurally drawn strand atlas.

Cards are short quad strips rooted on the shaped head, combed along a flow field and
bound to the nearest body triangle so they inherit skin weights and face morphs
(the beard follows the jaw and the visemes). Regions use landmarks of the shaped
head plus MakeHuman's CC0 scalp/lips face sets. Colour comes from vertex colours
over a neutral strand atlas, so one atlas serves every resident.
"""
import math
import os

import bpy
import numpy as np
from mathutils import Vector

import mh
from scene import SurfaceBinding, assign_weights, new_mesh, vertex_array

# Atlas layout: rows of cells, each cell a strand card variant (u0, v0, u1, v1).
ATLAS = {
    "crop": [(i * 0.125, 0.75, (i + 1) * 0.125, 1.0) for i in range(8)],
    "crop_sparse": [(i * 0.125, 0.5, (i + 1) * 0.125, 0.75) for i in range(4)],
    "beard": [(0.5 + i * 0.125, 0.5, 0.5 + (i + 1) * 0.125, 0.75) for i in range(4)],
    "beard_sparse": [(i * 0.125, 0.25, (i + 1) * 0.125, 0.5) for i in range(4)],
    # brows: eight narrow cells of four tapered hairs each, so one card reads as a small clump of hairs
    "brow": [(0.5 + i * 0.0625, 0.25, 0.5 + (i + 1) * 0.0625, 0.5) for i in range(8)],
    "stray": [(i * 0.25, 0.0, (i + 1) * 0.25, 0.25) for i in range(3)],
}
LIFTED = {}  # card corners moved out of the skin per card mesh (reported by the groom stage)
LASH_CELL = (0.75, 0.0, 1.0, 0.25)  # thinned MakeHuman CC0 lash alpha, mapped by the lash mesh UVs
STYLE = {  # strands per cell, length range (fraction of cell), root/tip width px, curl, bend
    "crop": (18, (0.55, 1.0), (1.5, 0.35), 0.05, 0.16),
    "crop_sparse": (9, (0.5, 0.95), (1.4, 0.3), 0.06, 0.2),
    "beard": (16, (0.5, 1.0), (1.7, 0.4), 0.16, 0.3),
    "beard_sparse": (8, (0.45, 0.9), (1.6, 0.35), 0.18, 0.32),
    # round 2: five finer hairs per brow cell (six thick 5 px hairs read as wheat-ear clumps and combs at close range;
    # three 2.6 px hairs left the brows faint and sparse)
    "brow": (5, (0.68, 1.0), (3.6, 0.8), 0.04, 0.1),
    "stray": (4, (0.7, 1.0), (1.2, 0.25), 0.1, 0.25),
}


# Long-hair residents (no beard) redraw the two beard rows as dense locks and wispy locks.
LONG_STYLE = {"beard": (44, (0.82, 1.0), (2.0, 0.6), 0.025, 0.07), "beard_sparse": (22, (0.6, 1.0), (1.5, 0.35), 0.06, 0.16)}


def draw_strand_atlas(size, seed, lash_rgba=None, style_override=None, root_dark=0.38):
    """RGBA atlas: RGB = per-strand luminance variation (roots darker by root_dark), A = coverage."""
    rng = np.random.default_rng(seed)
    style = dict(STYLE)
    style.update(style_override or {})
    ss = 2
    big = size * ss
    lum = np.zeros((big, big), dtype=np.float32)
    alpha = np.zeros((big, big), dtype=np.float32)
    yy, xx = np.mgrid[0:big, 0:big]
    for kind, cells in ATLAS.items():
        count, (lmin, lmax), (w0, w1), curl, bend = style[kind]
        for (u0, v0, u1, v1) in cells:
            x0, x1 = int(u0 * big), int(u1 * big)
            y_top, y_bot = int((1 - v1) * big), int((1 - v0) * big)  # image rows top to bottom
            cw, ch = x1 - x0, y_bot - y_top
            for k_strand in range(count):
                # staggered roots: strands start at different heights, so a card's root end never reads as
                # a hard horizontal edge (the rectangular blocks along the first household hairlines)
                root_off = rng.uniform(0.0, 0.2) * ch
                length = min(rng.uniform(lmin, lmax) * ch * 0.94, ch * 0.96 - root_off)
                # stratified roots: separate strands, never a solid clump
                root_x = (0.1 + 0.8 * (k_strand + rng.uniform(0.15, 0.85)) / count) * cw
                lean = rng.normal(0, bend) * cw * 0.35
                phase, freq = rng.uniform(0, 2 * math.pi), rng.uniform(1.0, 3.0)
                shade = rng.uniform(0.55, 1.0)
                steps = max(8, int(length / 2))
                for k in range(steps):
                    t = k / (steps - 1)
                    px = x0 + root_x + lean * t * t + curl * cw * math.sin(phase + freq * t * math.pi) * t
                    py = y_bot - 2 - root_off - length * t
                    width = (w0 + (w1 - w0) * t) * ss * 0.5
                    r = int(math.ceil(width + 2))
                    cx, cy = int(px), int(py)
                    ya, yb = max(y_top, cy - r), min(y_bot, cy + r + 1)
                    xa, xb = max(x0, cx - r), min(x1, cx + r + 1)
                    if ya >= yb or xa >= xb:
                        continue
                    d = np.hypot(xx[ya:yb, xa:xb] - px, yy[ya:yb, xa:xb] - py)
                    edge = math.sin(math.pi * float(np.clip((px - x0) / cw, 0, 1))) ** 0.7
                    a = np.clip(width + 0.5 - d, 0.0, 1.0) * (1.0 - 0.3 * t) * edge * min(1.0, t / 0.22 + 0.08)
                    tone = shade * (1.0 - root_dark + root_dark * t)
                    sel = a > alpha[ya:yb, xa:xb]
                    lum[ya:yb, xa:xb] = np.where(sel, tone, lum[ya:yb, xa:xb])
                    alpha[ya:yb, xa:xb] = np.maximum(alpha[ya:yb, xa:xb], a)
    lum = lum.reshape(size, ss, size, ss).mean(axis=(1, 3))
    alpha = alpha.reshape(size, ss, size, ss).mean(axis=(1, 3))
    # dilate colour into transparent texels so mip filtering does not halo dark
    filled = lum.copy()
    for _ in range(8):
        pad = np.pad(filled, 1, mode="edge")
        neighbour = np.maximum.reduce([pad[1:-1, :-2], pad[1:-1, 2:], pad[:-2, 1:-1], pad[2:, 1:-1]])
        filled = np.where(filled > 0, filled, neighbour)
    filled = np.where(filled > 0, filled, 0.8)
    rgba = np.dstack([filled, filled, filled, alpha]).astype(np.float32)
    if lash_rgba is not None:
        u0, v0, u1, v1 = LASH_CELL
        x0, x1, y0, y1 = int(u0 * size), int(u1 * size), int((1 - v1) * size), int((1 - v0) * size)
        rgba[y0:y1, x0:x1] = lash_rgba
    return rgba


def thinned_lashes(path, cell_px):
    """MakeHuman CC0 lash alpha, thinned (fewer, finer, lighter strands) and resized into one cell."""
    from PIL import Image
    im = Image.open(path).convert("RGBA").resize((cell_px, cell_px), Image.LANCZOS)
    a = np.asarray(im, dtype=np.float32) / 255.0
    alpha = np.clip(a[..., 3], 0, 1) ** 2.6 * 0.55
    lum = np.full_like(alpha, 0.75)
    return np.dstack([lum, lum, lum, alpha])


class HeadFrame:
    """Landmarks of the shaped head in rest pose (metres, Blender axes)."""

    def __init__(self, body, arm, src):
        self.v = vertex_array(body)
        bones = arm.data.bones
        self.eye_l = np.array(bones["face_eye_l"].head_local)
        self.eye_r = np.array(bones["face_eye_r"].head_local)
        self.eye = (self.eye_l + self.eye_r) / 2
        self.head = np.array(bones["head"].head_local)
        self.head_top = np.array(bones["head"].tail_local)
        lips = mh.load_region_faces(src["mpfbData"], "lips_solid")
        lip_verts = sorted({v for f in lips if f < len(body.data.polygons) for v in body.data.polygons[f].vertices})
        self.lips = set(lip_verts)
        self.mouth = self.v[lip_verts].mean(axis=0)
        # ears: the most lateral head vertices around eye height
        band = self.v[(np.abs(self.v[:, 2] - self.eye[2]) < 0.025) & (self.v[:, 2] > self.eye[2] - 0.1)]
        lateral = band[np.abs(band[:, 0]) > np.percentile(np.abs(band[:, 0]), 97)]
        self.ear_y = float(lateral[:, 1].mean())
        self.ear_x = float(np.abs(lateral[:, 0]).mean())
        self.head_mid_y = float((self.head[1] + self.head_top[1]) / 2)
        self.scalp_faces = _scalp_faces(self, body)
        front = self.v[(self.v[:, 2] > self.mouth[2] - 0.08) & (self.v[:, 2] < self.mouth[2]) & (np.abs(self.v[:, 0]) < 0.02)]
        self.chin = front[np.argmin(front[:, 1])] if len(front) else self.mouth
        self.chin_z = float(self.v[(np.abs(self.v[:, 0]) < 0.015) & (self.v[:, 1] < self.mouth[1] + 0.03) & (self.v[:, 2] > self.mouth[2] - 0.09) & (self.v[:, 2] < self.mouth[2])][:, 2].min())


def _scalp_faces(hf, body, nape=0.06):
    return [p.index for p in body.data.polygons if _scalp_rule(hf, np.array(p.center), np.array(p.normal), nape)]


def _scalp_rule(hf, c, n, nape):
    rel = c - hf.eye
    if c[2] < hf.eye[2] - nape or n[2] < -0.35:
        return False
    if c[1] < hf.head_mid_y and rel[2] < 0.03:  # face and forehead below the hairline zone
        return False
    if abs(c[0]) > hf.ear_x - 0.022 and -0.05 < rel[2] < 0.032 and abs(c[1] - hf.ear_y) < 0.04:  # ears
        return False
    return True


def _sample_faces(body, faces, density_fn, count, rng):
    """Area-weighted random points on the given faces, thinned by density_fn(point) in 0..1."""
    me = body.data
    tris = []
    for f in faces:
        poly = me.polygons[f]
        vs = list(poly.vertices)
        for k in range(1, len(vs) - 1):
            tris.append((vs[0], vs[k], vs[k + 1]))
    co = vertex_array(body)
    tris = np.array(tris)
    a, b, c = co[tris[:, 0]], co[tris[:, 1]], co[tris[:, 2]]
    area = np.linalg.norm(np.cross(b - a, c - a), axis=1) * 0.5
    prob = area / area.sum()
    out = []
    tries = 0
    while len(out) < count and tries < count * 40:
        tries += 1
        t = rng.choice(len(tris), p=prob)
        r1, r2 = rng.random(), rng.random()
        if r1 + r2 > 1:
            r1, r2 = 1 - r1, 1 - r2
        p = a[t] + (b[t] - a[t]) * r1 + (c[t] - a[t]) * r2
        n = np.cross(b[t] - a[t], c[t] - a[t])
        n /= np.linalg.norm(n) + 1e-12
        if rng.random() < density_fn(p):
            out.append((p, n))
    return out


def _card(root, normal, direction, length, width, tilt, lift, cell, segments=2):
    """Quad strip lying along direction, tilted about it, lifted off the skin toward the tip."""
    n = normal / (np.linalg.norm(normal) + 1e-12)
    d = direction - n * np.dot(direction, n)
    d /= np.linalg.norm(d) + 1e-12
    side = np.cross(n, d)
    side = side * math.cos(tilt) + n * math.sin(tilt)
    verts, uvs = [], []
    u0, v0, u1, v1 = cell
    for k in range(segments + 1):
        t = k / segments
        centre = root + d * length * t + n * (0.0006 + lift * t * t)
        for s, u in ((-0.5, u0), (0.5, u1)):
            verts.append(centre + side * width * s)
            uvs.append((u, v0 + (v1 - v0) * t))
    faces = [(k * 2, k * 2 + 1, k * 2 + 3, k * 2 + 2) for k in range(segments)]
    return verts, uvs, faces


def lift_above_skin(points, body, gap=0.0006, reach=0.05):
    """Move card corners lying inside or too close to the skin out along the skin normal.

    Cards are flat quads placed from one ray hit and tilted about their flow, so on the curved brow ridge,
    jaw and scalp their corners dipped under the surface: about 40 percent of brow and a third of beard card
    corners measured under the skin, so the skin hid most of each card and brows rendered as broken dashes
    and the beard as dirt-like specks. Returns the moved points and how many moved."""
    from mathutils.bvhtree import BVHTree
    me = body.data
    me.calc_loop_triangles()
    tree = BVHTree.FromPolygons([tuple(v.co) for v in me.vertices], [t.vertices[:] for t in me.loop_triangles], all_triangles=True)
    out = np.array(points, dtype=np.float64)
    moved = 0
    for i, q in enumerate(out):
        loc, normal, _f, _d = tree.find_nearest(Vector(q), reach)
        if loc is None:
            continue
        signed = (Vector(q) - loc).dot(normal)
        if signed < gap:
            out[i] = np.array(Vector(q) + normal * (gap - signed))
            moved += 1
    return out, moved


def _build_cards(name, cards, body, arm, color_of, lift_gap=0.0006):
    verts, uvs, faces, colors = [], [], [], []
    for (cv, cu, cf, colour) in cards:
        base = len(verts)
        verts.extend(cv)
        uvs.extend(cu)
        colors.extend([colour] * len(cv))
        faces.extend([tuple(base + i for i in f) for f in cf])
    face_uvs = [list(f) for f in faces]
    verts, lifted = lift_above_skin(verts, body, lift_gap) if lift_gap else (np.array(verts), 0)
    LIFTED[name] = lifted
    obj = new_mesh(name, np.array(verts), faces, uvs=uvs, face_uvs=face_uvs)
    attr = obj.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", np.array([(*c, 1.0) for c in colors], dtype=np.float32).ravel())
    obj.data.color_attributes.active_color = attr
    binding = SurfaceBinding(body)
    bind = binding.bind(vertex_array(obj), max_distance=0.2)
    assign_weights(obj, binding.transfer_weights(bind), arm)
    morphs = binding.transfer_shape_keys(obj, bind)
    return obj, morphs


def _mix(a, b, t):
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(3))


def build(body, arm, src, recipe, out_dir, report):
    spec = recipe["groom"]
    rng = np.random.default_rng(spec.get("seed", 7))
    hf = HeadFrame(body, arm, src)
    # mouth landmarks for the skin weathering bake (face indices change once covered skin is deleted)
    lips = hf.v[sorted(hf.lips)]
    body["mouth_corners"] = [list(map(float, lips[np.argmax(lips[:, 0])])), list(map(float, lips[np.argmin(lips[:, 0])]))]
    body["lips_bottom_z"] = float(lips[:, 2].min())
    lash_png = os.path.join(src["systemAssets"], "eyelashes", recipe["parts"]["eyelashes"], recipe["parts"]["eyelashes"] + ".png")
    size = spec.get("atlasSize", 1024)
    long_hair = spec["hair"].get("style", "crop") != "crop"
    atlas = draw_strand_atlas(size, spec.get("seed", 7), thinned_lashes(lash_png, size // 4), LONG_STYLE if long_hair else None,
                              root_dark=spec.get("rootDarken", 0.38))
    os.makedirs(os.path.join(out_dir, "textures"), exist_ok=True)
    np.save(os.path.join(out_dir, "textures", "strands.npy"), atlas)
    colours = {k: tuple(v) for k, v in spec["colours"].items()}
    up = np.array([0.0, 0.0, 1.0])
    centre_head = (hf.head + hf.head_top) / 2

    # --- scalp: close crop combed from a crown whorl, receding at the temples
    crown = hf.head_top + np.array([0.0, 0.05, -0.01])
    hs = spec["hair"]
    style = hs.get("style", "crop")
    if style != "crop":
        return _build_long(body, arm, src, recipe, spec, hf, rng, colours, report)

    head_mid_y = float((hf.head[1] + hf.head_top[1]) / 2)

    def scalp_density(p):
        rel = p - hf.eye
        # receding hairline: front edge rises at the temples (M shape); applies to the front half
        front_limit = hs["hairlineAboveEye"] + hs["templeRecession"] * min(1.0, (abs(rel[0]) / 0.045) ** 2)
        front = p[1] < head_mid_y - 0.01
        if front and rel[2] < front_limit:
            return 0.0
        edge = float(np.clip((rel[2] - front_limit) / 0.014, 0, 1)) if front else 1.0
        # nape and above the ears thin out
        nape = np.clip((p[2] - (hf.eye[2] - hs["napeBelowEye"])) / 0.02, 0, 1)
        return float(edge * nape)

    cards = []
    for p, n in _sample_faces(body, hf.scalp_faces, scalp_density, hs["cards"], rng):
        rel = p - crown
        flow = rel - n * np.dot(rel, n)
        if p[1] < hf.eye[1] + 0.02:  # front: combed forward and down
            flow = flow + np.array([0.0, -0.6, -0.4]) * 0.06
        flow = flow + np.array([0.0, 0.0, -1.0]) * hs["gravity"] * 0.06
        if np.linalg.norm(flow) < 1e-6:
            flow = np.array([0.0, 0.03, -0.01])
        kind = "crop" if scalp_density(p) > 0.85 else "crop_sparse"
        cell = ATLAS[kind][rng.integers(len(ATLAS[kind]))]
        length = rng.uniform(*hs["length"])
        # no card may hang below the hairline: cards rooted at the front edge and combed down had their tips
        # on the forehead (stray hairs in the middle of the smith's forehead)
        rel_e = p - hf.eye
        if p[1] < head_mid_y - 0.01:
            limit = hs["hairlineAboveEye"] + hs["templeRecession"] * min(1.0, (abs(rel_e[0]) / 0.045) ** 2)
            d = flow / (np.linalg.norm(flow) + 1e-12)
            if rel_e[2] + d[2] * length < limit + 0.002:
                flow = crown - p
                flow = flow - n * np.dot(flow, n)
                length *= 0.7
        grey = np.clip((abs(p[0] - hf.head[0]) - 0.055) / 0.03, 0, 1) * hs["templeGrey"] if p[2] < hf.eye[2] + 0.06 else 0.0
        colour = _mix(colours["hair"], colours["grey"], grey * rng.uniform(0.6, 1.0))
        colour = tuple(c * rng.uniform(0.85, 1.12) for c in colour)
        cards.append((*_card(p, n, flow, length, rng.uniform(*hs["width"]), rng.uniform(-0.25, 0.45), length * hs["lift"], cell, segments=1), colour))
    hair, hair_m = _build_cards("Hair", cards, body, arm, None)

    # --- beard: short full beard, grey at the chin, singed shorter on one side
    bs = spec["beard"]
    mouth, chin_z = hf.mouth, hf.chin_z
    ear_y = hf.eye[1] + bs["backFromEye"]

    def beard_density(p):
        rel = p - mouth
        if p[1] > ear_y:
            return 0.0
        if p[2] > hf.eye[2] - bs["cheekBelowEye"] + max(0.0, (abs(p[0]) - 0.05)) * 0.8:
            return 0.0
        if p[2] < chin_z - bs["underJaw"] - max(0.0, 0.05 - abs(p[0])) * 0.2:
            return 0.0
        if abs(rel[0]) < 0.026 and -0.012 < rel[2] < 0.006:  # lips
            return 0.0
        if rel[2] > 0.006 and abs(rel[0]) < 0.034 and rel[2] > bs["moustacheHeight"]:  # under the nose
            return 0.0
        if rel[2] > 0.006 and 0.034 <= abs(rel[0]) < 0.045 and rel[2] > 0.012:
            return 0.25
        cheek_edge = np.clip(((hf.eye[2] - bs["cheekBelowEye"]) - p[2]) / 0.015, 0, 1)
        return float(0.35 + 0.65 * cheek_edge)

    face_ids = [f.index for f in body.data.polygons
                if (lambda c: c[2] < hf.eye[2] and c[2] > chin_z - 0.06 and c[1] < ear_y + 0.01)(np.array(f.center))]
    cards = []
    for p, n in _sample_faces(body, face_ids, beard_density, bs["cards"], rng):
        rel = p - mouth
        if rel[2] > 0.004 and abs(rel[0]) < 0.045:  # moustache: down and outward
            flow = np.array([math.copysign(0.6, rel[0]), -0.1, -1.0])
        elif p[2] < chin_z + 0.01:  # under the chin: back toward the neck
            flow = np.array([rel[0] * 3, 1.0, -0.6])
        else:  # cheeks and jaw: downward, slightly forward toward the chin
            flow = np.array([-rel[0] * 2.0, -0.35, -1.0])
        dens = beard_density(p)
        kind = "beard" if dens > 0.7 else "beard_sparse"
        cell = ATLAS[kind][rng.integers(len(ATLAS[kind]))]
        length = rng.uniform(*bs["length"])
        if p[2] < chin_z + 0.02 and abs(rel[0]) < 0.03:
            length *= bs["chinLengthScale"]
        if p[0] * bs["singedSide"] > 0.02:
            length *= bs["singedScale"]
        chin_grey = np.clip(1.0 - (abs(rel[0]) / 0.04), 0, 1) * np.clip((mouth[2] - 0.01 - p[2]) / 0.03, 0, 1)
        colour = _mix(colours["beard"], colours["grey"], np.clip(chin_grey * bs["chinGrey"] + rng.uniform(0, bs["salt"]), 0, 1))
        colour = tuple(c * rng.uniform(0.85, 1.12) for c in colour)
        cards.append((*_card(p, n, flow, length, rng.uniform(*bs["width"]), rng.uniform(-0.25, 0.6), length * bs["lift"], cell, segments=1), colour))
    beard, beard_m = _build_cards("Beard", cards, body, arm, None)

    # --- brows: layered hair cards along the brow's growth pattern (shared with the long-hair styles)
    br = spec["brows"]
    brows, brow_m = _brows(body, arm, br, hf, rng, colours)

    lashes = bpy.data.objects["Eyelashes"]
    u0, v0, u1, v1 = LASH_CELL
    uv = lashes.data.uv_layers.active.data
    co = np.zeros(len(uv) * 2)
    uv.foreach_get("uv", co)
    co = co.reshape(-1, 2)
    co[:, 0] = u0 + np.clip(co[:, 0], 0, 1) * (u1 - u0)
    co[:, 1] = v0 + np.clip(co[:, 1], 0, 1) * (v1 - v0)
    uv.foreach_set("uv", co.ravel())
    attr = lashes.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", np.tile(np.array([*colours["lash"], 1.0], dtype=np.float32), len(lashes.data.vertices)))
    lashes.data.color_attributes.active_color = attr
    report["groom"] = {"hairCards": len(hair.data.polygons) // 2, "beardCards": len(beard.data.polygons) // 2,
                       "browCards": len(brows.data.polygons), "hairMorphs": hair_m, "beardMorphs": beard_m, "browMorphs": brow_m,
                       "triangles": {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in (hair, beard, brows)},
                       "cardCornersLiftedOutOfSkin": dict(LIFTED)}
    # Skin paint masks for the texture stage: R scalp, G beard, B brow density (vertex colours on the body).
    masks = np.zeros((len(hf.v), 4), dtype=np.float32)
    masks[:, 3] = 1.0
    scalp_verts = {v for f in hf.scalp_faces for v in body.data.polygons[f].vertices}
    for i, p in enumerate(hf.v):
        if i in scalp_verts:
            masks[i, 0] = scalp_density(p)
        if p[2] < hf.eye[2] and p[1] < ear_y + 0.01:
            masks[i, 1] = beard_density(p) if i not in hf.lips else 0.0
    # brows: a soft tapered band under the brow cards (the same geometry as the cards)
    for i, p in enumerate(hf.v):
        masks[i, 2] = _brow_mask_value(p, hf, br)
    # smooth the masks over the mesh so painted edges follow skin, not vertex rows
    adjacency = [[] for _ in range(len(hf.v))]
    for e in body.data.edges:
        a, b = e.vertices
        adjacency[a].append(b)
        adjacency[b].append(a)
    for _ in range(4):
        smoothed = masks.copy()
        for i, nb in enumerate(adjacency):
            if nb:
                smoothed[i, :3] = 0.5 * masks[i, :3] + 0.5 * masks[nb, :3].mean(axis=0)
        masks = smoothed
    attr = body.data.color_attributes.new("GroomMask", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", masks.ravel())
    for o in (hair, beard, brows, lashes):
        o["crownfall_part"] = "groom"
    return {"Hair": hair, "Beard": beard, "Brows": brows, "Eyelashes": lashes}


# ------------------------------------------------------------------ long and covered hair (household members)
#
# Styles: "covered" (hair under a linen head-cloth: a combed-back band at the front hairline plus loose
# strands at the temples) and "tied" (jaw-length hair drawn back to a tie at the nape, a short tail and
# escaping strands). Long cards are ribbons marched over the scalp surface, held a few millimetres out
# so they keep the skull's shape; every card is bound to the head (and neck below the nape).

def _ribbon(points, normals, width_fn, tilt, cell):
    """Quad strip along a polyline: side vector across the surface normal, uv v from root (0) to tip (1)."""
    verts, uvs = [], []
    u0, v0, u1, v1 = cell
    count = len(points) - 1
    for k, p in enumerate(points):
        t = k / count
        tan = points[min(k + 1, count)] - points[max(k - 1, 0)]
        tan = tan / (np.linalg.norm(tan) + 1e-12)
        n = normals[k] - tan * np.dot(normals[k], tan)
        n = n / (np.linalg.norm(n) + 1e-12)
        side = np.cross(n, tan)
        side = side * math.cos(tilt) + n * math.sin(tilt)
        w = width_fn(t)
        verts.extend([p - side * w * 0.5, p + side * w * 0.5])
        uvs.extend([(u0, v0 + (v1 - v0) * t), (u1, v0 + (v1 - v0) * t)])
    faces = [(k * 2, k * 2 + 1, k * 2 + 3, k * 2 + 2) for k in range(count)]
    return verts, uvs, faces


class _Surface:
    """Nearest-point projection onto the shaped body (rest pose)."""

    def __init__(self, body):
        from mathutils.bvhtree import BVHTree
        me = body.data
        me.calc_loop_triangles()
        self.v = vertex_array(body)
        self.tree = BVHTree.FromPolygons([tuple(p) for p in self.v], [t.vertices[:] for t in me.loop_triangles], all_triangles=True)

    def project(self, p, offset, only_if_inside=False):
        loc, normal, _f, _d = self.tree.find_nearest(Vector(p))
        if loc is None:
            return p, np.array([0.0, 0.0, 1.0])
        loc, normal = np.array(loc), np.array(normal)
        signed = np.dot(p - loc, normal)
        if only_if_inside and signed >= offset:
            return p, normal
        return loc + normal * offset, normal


def _resample(points, count):
    pts = np.array(points)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    if cum[-1] < 1e-6:
        return [pts[0]] * (count + 1)
    targets = np.linspace(0.0, cum[-1], count + 1)
    return [np.array([np.interp(t, cum, pts[:, a]) for a in range(3)]) for t in targets]


def _hairline_density(hf, hs):
    """Scalp coverage inside a natural (non-receding) hairline: 0 outside, ramping to 1 inside."""
    head_mid_y = float((hf.head[1] + hf.head_top[1]) / 2)

    def density(p):
        rel = p - hf.eye
        ax = abs(rel[0])
        front_limit = (hs["hairlineAboveEye"] + hs.get("templeRecession", 0.0) * min(1.0, (ax / 0.045) ** 2)
                       - hs.get("templeDrop", 0.0) * float(np.clip((ax - 0.035) / 0.03, 0, 1)))
        front = p[1] < head_mid_y - 0.01
        if front and rel[2] < front_limit:
            return 0.0
        edge = float(np.clip((rel[2] - front_limit) / 0.012, 0, 1)) if front else 1.0
        nape = np.clip((p[2] - (hf.eye[2] - hs["napeBelowEye"])) / 0.02, 0, 1)
        return float(edge * nape)
    return density


def _card_colour(rng, base, tip=None, variation=(0.86, 1.12)):
    colour = tuple(c * rng.uniform(*variation) for c in base)
    if tip is not None:
        k = rng.uniform(0.0, 0.5)
        colour = tuple(colour[i] * (1 - k) + tip[i] * k for i in range(3))
    return colour


def _build_long(body, arm, src, recipe, spec, hf, rng, colours, report):
    hs = spec["hair"]
    style = hs["style"]
    surf = _Surface(body)
    density = _hairline_density(hf, hs)
    head_mid_y = float((hf.head[1] + hf.head_top[1]) / 2)
    cards = []
    tip_colour = colours.get("hairTip")
    # back-of-head point behind the eyes at a given height (ray from behind toward the face)
    def back_point(z):
        hit = body.ray_cast(Vector((0.0, hf.head[1] + 0.4, z)), Vector((0.0, -1.0, 0.0)))
        return np.array(hit[1]) if hit[0] else np.array([0.0, hf.head[1] + 0.09, z])

    def march(root, normal, flow, steps, ds, offset, free_z=None, outward_x=None, root_offset=0.0015):
        # strands leave the scalp at the root and rise to their layer over the first third of their length
        p, n = root + normal * min(offset, root_offset), normal
        pts, nrm = [p.copy()], [n.copy()]
        d = flow(p, None, 0)
        for k in range(1, steps + 1):
            d = flow(p, d, k)
            p = p + d * ds
            layer = root_offset + (offset - root_offset) * min(1.0, k / max(1.0, steps * 0.35))
            if free_z is None or p[2] > free_z:
                p, n = surf.project(p, max(layer, 0.001))
            else:
                p, n2 = surf.project(p, offset, only_if_inside=True)
                n = n2 if np.dot(n2, n) > 0 else n
            if outward_x is not None and p[2] < hf.eye[2] + 0.012:
                sx = 1.0 if p[0] > 0 else -1.0
                if abs(p[0]) < outward_x:
                    p = np.array([sx * outward_x, p[1], p[2]])
            pts.append(p.copy())
            nrm.append(n.copy())
        return pts, nrm

    if style == "tied":
        tie = back_point(hf.eye[2] - hs.get("tieBelowEye", 0.045))
        tie_out = tie + np.array([0.0, 0.012, 0.0])
        # hair drawn back to a nape tie goes up and over the crown from the front hairline: on the forehead
        # the direction to the tie projects onto the surface as straight down, and those cards fell over
        # the brows and eyes (the child's first build)
        crown_pt = hf.head_top + np.array([0.0, 0.035, -0.01])
        roots = _sample_faces(body, hf.scalp_faces, density, hs["cards"], rng)
        for p0, n0 in roots:
            layer = rng.uniform(0.0035, hs.get("volume", 0.009))
            phase, freq = rng.uniform(0, 2 * math.pi), rng.uniform(0.25, 0.6)
            amp = hs.get("tousle", 0.25)

            def flow(p, d, k, phase=phase, freq=freq, amp=amp):
                n = surf.project(p, 0.0)[1]
                to_tie = (tie - p) / (np.linalg.norm(tie - p) + 1e-9)
                to_crown = (crown_pt - p) / (np.linalg.norm(crown_pt - p) + 1e-9)
                w = float(np.clip((-n[1] - 0.15) / 0.3, 0.0, 1.0))  # forward-facing surface: aim over the crown
                to = to_tie * (1 - w) + to_crown * w
                to = to - n * np.dot(to, n)
                to = to / (np.linalg.norm(to) + 1e-9)
                side = np.cross(n, to)
                out = to + side * amp * math.sin(phase + k * freq) * (1 - 0.7 * w)
                if d is not None:
                    out = d * 0.45 + out * 0.55
                return out / (np.linalg.norm(out) + 1e-9)
            front_root = float(n0[1]) < -0.15
            dist = (np.linalg.norm(crown_pt - p0) + np.linalg.norm(tie - crown_pt)) if front_root else np.linalg.norm(tie - p0)
            steps = max(3, min(48, int(dist / 0.008)))
            pts, nrm = march(p0, n0, flow, steps, min(0.008, dist / steps * 1.05), layer)
            # enough segments that long cards follow the skull instead of cutting chords through it
            length = float(np.sum(np.linalg.norm(np.diff(np.array(pts), axis=0), axis=1)))
            pts = _resample(pts, int(np.clip(round(length / 0.04), 4, 6)))
            nrm = [surf.project(q, 0.0)[1] for q in pts]
            width = rng.uniform(*hs["width"])
            cell = ATLAS["beard_sparse"][rng.integers(4)] if rng.random() < 0.25 else ATLAS["beard"][rng.integers(4)]
            v, u, f = _ribbon(pts, nrm, lambda t, w=width: w * (1.0 - 0.3 * t), rng.uniform(-0.3, 0.3), cell)
            cards.append((v, u, f, _card_colour(rng, colours["hair"], tip_colour)))
        # short tail below the tie
        tail_dir = np.array([0.0, 0.32, -1.0])
        tail_dir /= np.linalg.norm(tail_dir)
        for k in range(hs.get("tailCards", 36)):
            a = rng.uniform(0, 2 * math.pi)
            r = rng.uniform(0.0, 0.009)
            start = tie_out + np.array([math.cos(a) * r, 0.0, math.sin(a) * r * 0.6])
            spread = np.array([math.cos(a), 0.15, 0.0]) * rng.uniform(0.15, 0.4)
            length = rng.uniform(*hs["tailLength"])
            pts, nrm = [], []
            for s in range(5):
                t = s / 4
                q = start + (tail_dir + spread * t + np.array([0.0, -0.1, -0.5]) * t * t) * length * t
                q, n = surf.project(q, 0.016, only_if_inside=True)
                pts.append(q)
                nrm.append(np.array([0.0, 1.0, 0.0]))
            width = rng.uniform(*hs["width"]) * 0.9
            cell = ATLAS["beard"][rng.integers(4)] if rng.random() < 0.7 else ATLAS["beard_sparse"][rng.integers(4)]
            v, u, f = _ribbon(pts, nrm, lambda t, w=width: w * (1.0 - 0.45 * t), rng.uniform(-0.9, 0.9), cell)
            cards.append((v, u, f, _card_colour(rng, colours["hair"], tip_colour)))
    elif style == "covered":
        # combed-back band at the hairline: the head-cloth covers everything behind it
        band = hs.get("bandDepth", 0.03)

        def band_density(p):
            rel = p - hf.eye
            if p[1] > head_mid_y - 0.01:
                return 0.0
            ax = abs(rel[0])
            limit = hs["hairlineAboveEye"] - hs.get("templeDrop", 0.0) * float(np.clip((ax - 0.035) / 0.03, 0, 1))
            return 1.0 if limit <= rel[2] <= limit + band + 0.01 * float(np.clip((ax - 0.03) / 0.03, 0, 1)) else 0.0
        crown = hf.head_top + np.array([0.0, 0.07, -0.02])
        for p0, n0 in _sample_faces(body, hf.scalp_faces, band_density, hs["cards"], rng):
            def flow(p, d, k):
                to = crown - p
                n = surf.project(p, 0.0)[1]
                to = to - n * np.dot(to, n)
                return to / (np.linalg.norm(to) + 1e-9)
            length = rng.uniform(*hs["length"])
            pts, nrm = march(p0, n0, flow, 4, length / 4, rng.uniform(0.0018, 0.0034))
            width = rng.uniform(*hs["width"])
            cell = ATLAS["beard"][rng.integers(4)]
            v, u, f = _ribbon(pts, nrm, lambda t, w=width: w * (1.0 - 0.3 * t), rng.uniform(-0.2, 0.2), cell)
            cards.append((v, u, f, _card_colour(rng, colours["hair"], tip_colour)))
    # loose strands at the temples (both styles)
    loose = hs.get("loose", {})
    for k in range(loose.get("perSide", 0) * 2):
        sx = 1.0 if k % 2 == 0 else -1.0
        x = sx * rng.uniform(*loose.get("x", (0.055, 0.068)))
        z = hf.eye[2] + rng.uniform(*loose.get("zAboveEye", (0.018, 0.04)))
        hit = body.ray_cast(Vector((x, hf.eye[1] - 0.3, z)), Vector((0.0, 1.0, 0.0)))
        if not hit[0]:
            continue
        p0, n0 = np.array(hit[1]), np.array(hit[2])
        phase = rng.uniform(0, 2 * math.pi)

        def flow(p, d, k, phase=phase, sx=sx):
            out = np.array([sx * 0.18, -0.12, -1.0]) + np.array([sx, 0.0, 0.0]) * 0.22 * math.sin(phase + k * 0.9)
            return out / np.linalg.norm(out)
        length = rng.uniform(*loose["length"])
        pts, nrm = march(p0, n0, flow, 6, length / 6, rng.uniform(*loose.get("offset", (0.005, 0.011))),
                         outward_x=loose.get("clearX", 0.064))
        width = rng.uniform(*loose.get("width", hs["width"]))
        cell = ATLAS["beard_sparse"][rng.integers(4)]
        v, u, f = _ribbon(_resample(pts, 4), [nrm[min(len(nrm) - 1, i * len(nrm) // 5)] for i in range(5)],
                          lambda t, w=width: w * (1.0 - 0.6 * t), rng.uniform(-0.5, 0.5), cell)
        cards.append((v, u, f, _card_colour(rng, colours["hair"], tip_colour)))
    hair, hair_m = _build_cards("Hair", cards, body, arm, None)
    if style == "tied":
        hair["tie_point"] = [float(x) for x in tie_out]
    # cards below the nape hang from the head rigidly instead of following neck skin
    _rigid_head_below(hair, arm, hf.eye[2] - hs["napeBelowEye"] + 0.01)
    brows, brow_m = _brows(body, arm, spec["brows"], hf, rng, colours)
    lashes = _lash_setup(colours)
    report["groom"] = {"style": style, "hairCards": len(cards), "browCards": len(brows.data.polygons), "hairMorphs": hair_m, "browMorphs": brow_m,
                       "triangles": {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in (hair, brows)},
                       "cardCornersLiftedOutOfSkin": dict(LIFTED)}
    _paint_masks(body, hf, density, None, spec["brows"], hf.eye[2] + 1.0)
    for o in (hair, brows, lashes):
        o["crownfall_part"] = "groom"
    return {"Hair": hair, "Brows": brows, "Eyelashes": lashes}


def _rigid_head_below(obj, arm, z_limit):
    """Vertices below z_limit take head weights (blended over 2 cm) so hanging hair keeps its shape."""
    names = {g.index: g.name for g in obj.vertex_groups}
    co = vertex_array(obj)
    weights = []
    for v in obj.data.vertices:
        w = {names[g.group]: g.weight for g in v.groups if g.weight > 0}
        k = float(np.clip((z_limit - co[v.index][2]) / 0.02, 0, 1))
        if k > 0:
            w = {b: x * (1 - k) for b, x in w.items()}
            w["head"] = w.get("head", 0.0) + k
        weights.append(w)
    assign_weights(obj, weights, arm)


class _BrowShape:
    """Brow geometry shared by the cards and the painted base. t runs from the head of the brow (0, near the
    nose) to the tail (1); v runs across it from the lower edge (-1) to the upper edge (+1). The tail ends at
    the bony rim of the eye socket, above and a little outside the outer eye corner: the first brows ran
    3.4 cm past the eye centre toward the temple over a painted band, and read as drawn strips."""

    def __init__(self, br, hf):
        self.k = float(np.linalg.norm(hf.eye_l - hf.eye_r)) / 0.064  # smaller faces get smaller brows
        self.inner = br.get("innerX", -0.012) * self.k
        self.tail = br.get("tailX", 0.025) * self.k
        self.span = self.tail - self.inner
        self.above, self.arch, self.slope = br["aboveEye"], br.get("arch", 0.003), br.get("slope", 0.004)
        self.thick = br.get("thickness", 0.0085) * self.k

    def centre_z(self, eye, t):
        return eye[2] + self.above + self.arch * math.sin(t * math.pi) - self.slope * t

    def half(self, t):
        # full and rounded at the head, tapering to a fine tail
        head = 0.7 + 0.3 * math.sin(min(1.0, t / 0.16) * math.pi / 2)
        return 0.5 * self.thick * (1.0 - 0.62 * t) * head

    def tangent(self, side, t):
        dz = (self.arch * math.pi * math.cos(t * math.pi) - self.slope) / max(self.span, 1e-4)
        d = np.array([float(side), 0.0, dz])
        return d / np.linalg.norm(d)


def _brow_mask_value(p, hf, br):
    """Painted base under the brow cards: 1 inside the brow shape, soft at its edges, 0 elsewhere."""
    shape = _BrowShape(br, hf)
    best = 0.0
    for eye, sgn in ((hf.eye_l, 1), (hf.eye_r, -1)):
        if p[1] > eye[1] + 0.02:
            continue
        t = ((p[0] - eye[0]) * sgn - shape.inner) / shape.span
        if t < -0.08 or t > 1.06:
            continue
        tc = min(max(t, 0.0), 1.0)
        d = abs(p[2] - shape.centre_z(eye, tc)) / max(shape.half(tc), 1e-4)
        ends = min(1.0, (t + 0.08) / 0.12) * min(1.0, (1.06 - t) / 0.16)
        best = max(best, float(np.clip(1.25 - d, 0.0, 1.0)) * ends)
    return best


def _brows(body, arm, br, hf, rng, colours):
    """Brows as two to three layers of short hair cards that follow the brow's growth pattern: hairs at the head
    stand up, lower hairs grow up and out, upper hairs down and out, and the tail lies flat toward the temple.
    Each card carries a clump of four tapered hairs from the narrow brow cells of the atlas, coloured from the
    resident's own hair (the first brows used a separate grey on every resident and 14-hair cells on wide cards,
    which read as stippled, barbed strips)."""
    shape = _BrowShape(br, hf)
    base = np.array(colours.get("brow", colours["hair"]), dtype=np.float64)
    if "browFromHair" in br:  # tint from the hair colour: brows sit a little darker than the scalp hair
        base = base * (1.0 - br["browFromHair"]) + np.array(colours["hair"]) * br["browDarken"] * br["browFromHair"]
    per_side = int(br.get("hairCards", br.get("cardsPerSide", 120)))
    layers = int(br.get("layers", 3))
    cards = []
    for side in (-1, 1):
        eye = hf.eye_l if side > 0 else hf.eye_r
        placed = tries = 0
        while placed < per_side and tries < per_side * 30:
            tries += 1
            t = rng.random()
            v = rng.uniform(-1.0, 1.0)
            density = (1.0 if t < 0.5 else max(0.12, 1.0 - (t - 0.5) / 0.5 * 0.88)) * (1.0 - 0.55 * abs(v) ** 3)
            if rng.random() > density * br.get("density", 1.0):
                continue
            x = eye[0] + side * (shape.inner + shape.span * t)
            z = shape.centre_z(eye, t) + v * shape.half(t)
            hit = body.ray_cast(Vector((x, eye[1] - 0.2, z)), Vector((0, 1, 0)))
            if not hit[0]:
                continue
            p, n = np.array(hit[1]), np.array(hit[2])
            if t < 0.14:
                angle = rng.uniform(58.0, 84.0)  # the head of the brow: hairs stand up
            else:
                angle = 30.0 * (1.0 - v) * 0.5 - 16.0 * (1.0 + v) * 0.5  # lower edge up and out, upper edge down and out
                angle *= 1.0 - 0.65 * max(0.0, (t - 0.6) / 0.4)  # the tail lies flatter, toward the temple
                angle += rng.normal(0.0, 7.0)
            a = math.radians(angle)
            flow = shape.tangent(side, t) * math.cos(a) + np.array([0.0, 0.0, 1.0]) * math.sin(a)
            layer = int(rng.integers(layers))
            length = rng.uniform(*br["length"]) * shape.k * (0.7 if t < 0.14 else 1.0) * (1.0 - 0.3 * t)
            width = rng.uniform(*br.get("hairWidth", (0.0012, 0.002))) * shape.k
            cell = ATLAS["brow"][rng.integers(len(ATLAS["brow"]))]
            colour = tuple(float(c) * rng.uniform(0.86, 1.1) * (1.0 + 0.06 * layer) for c in base)
            vs, us, fs = _card(p, n, flow, length, width, rng.uniform(-0.12, 0.12), length * (0.06 + 0.07 * layer), cell, segments=1)
            vs = [q + n * (br.get("rootLift", 0.0004) + 0.00025 * layer) for q in vs]
            cards.append((vs, us, fs, colour))
            placed += 1
    return _build_cards("Brows", cards, body, arm, None)


def _lash_setup(colours):
    lashes = bpy.data.objects["Eyelashes"]
    u0, v0, u1, v1 = LASH_CELL
    uv = lashes.data.uv_layers.active.data
    co = np.zeros(len(uv) * 2)
    uv.foreach_get("uv", co)
    co = co.reshape(-1, 2)
    co[:, 0] = u0 + np.clip(co[:, 0], 0, 1) * (u1 - u0)
    co[:, 1] = v0 + np.clip(co[:, 1], 0, 1) * (v1 - v0)
    uv.foreach_set("uv", co.ravel())
    attr = lashes.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", np.tile(np.array([*colours["lash"], 1.0], dtype=np.float32), len(lashes.data.vertices)))
    lashes.data.color_attributes.active_color = attr
    return lashes


def _paint_masks(body, hf, scalp_density, beard_density, br, beard_limit_z):
    """Skin paint masks for the texture stage: R scalp, G beard, B brow density (vertex colours)."""
    masks = np.zeros((len(hf.v), 4), dtype=np.float32)
    masks[:, 3] = 1.0
    scalp_verts = {v for f in hf.scalp_faces for v in body.data.polygons[f].vertices}
    for i, p in enumerate(hf.v):
        if i in scalp_verts:
            masks[i, 0] = scalp_density(p)
        if beard_density is not None and p[2] < beard_limit_z:
            masks[i, 1] = beard_density(p) if i not in hf.lips else 0.0
    for i, p in enumerate(hf.v):
        masks[i, 2] = _brow_mask_value(p, hf, br)
    adjacency = [[] for _ in range(len(hf.v))]
    for e in body.data.edges:
        a, b = e.vertices
        adjacency[a].append(b)
        adjacency[b].append(a)
    for _ in range(4):
        smoothed = masks.copy()
        for i, nb in enumerate(adjacency):
            if nb:
                smoothed[i, :3] = 0.5 * masks[i, :3] + 0.5 * masks[nb, :3].mean(axis=0)
        masks = smoothed
    attr = body.data.color_attributes.new("GroomMask", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", masks.ravel())

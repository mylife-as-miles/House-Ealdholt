"""Authored dental arches for the residents (original Crownfall geometry and texture).

The first builds decimated MakeHuman's 7,120-triangle CC0 teeth to about 900 triangles; the collapse left long
grey slivers that read as fangs or a picket fence whenever the mouth opened. These arches are generated per
resident instead: the upper and lower arch curves, incisal heights and depth are measured from MakeHuman's fitted
teeth (so the arches sit exactly where the CC0 asset sat inside the shaped mouth), and each tooth is a small
rounded crown with its own proportions (spade-shaped incisors, pointed canines, broad premolars and molars),
set in a scalloped gum band. Weights follow the arch (upper teeth on the head, lower teeth on the jaw) and the
face morphs (jawOpen, visemes) are transferred from the fitted MakeHuman teeth by nearest-triangle binding.
The texture is drawn here (ivory crowns, darker gaps, translucent edges, gums, and a depth gradient that keeps
the back of the mouth in shadow); a dark throat occluder closes the view past the molars.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from scene import assign_weights, vertex_array

# Mesiodistal widths (metres) from the midline outward: central, lateral, canine, premolar 1 and 2, molar 1 and 2.
WIDTHS = {"upper": (0.0085, 0.0066, 0.0076, 0.0070, 0.0066, 0.0100, 0.0092),
          "lower": (0.0053, 0.0058, 0.0069, 0.0070, 0.0071, 0.0108, 0.0100)}
KINDS = ("incisor", "incisor", "canine", "premolar", "premolar", "molar", "molar")
# crown height (cervix to edge) and labial-lingual depth at the cervix, metres
HEIGHT = {"incisor": 0.0098, "canine": 0.0102, "premolar": 0.0080, "molar": 0.0072}
DEPTH = {"incisor": 0.0068, "canine": 0.0076, "premolar": 0.0088, "molar": 0.0100}
EDGE_DEPTH = {"incisor": 0.32, "canine": 0.5, "premolar": 0.85, "molar": 0.9}  # depth at the edge / at the cervix
COLUMNS = 28  # texture columns: 7 teeth per quadrant, four quadrants


def _arch_fit(points):
    """Arch midline y = y0 + c * x^2 (Blender axes: -Y is the front of the face), incisal and gum heights."""
    x, y, z = points[:, 0], points[:, 1], points[:, 2]
    A = np.stack([np.ones_like(x), x * x], axis=1)
    (y0, c), *_ = np.linalg.lstsq(A, y, rcond=None)
    return float(y0), float(c), float(np.abs(x).max())


def _arch_point(y0, c, x):
    return np.array([x, y0 + c * x * x])


def _arc_samples(y0, c, x_max, n=400):
    xs = np.linspace(0.0, x_max, n)
    pts = np.stack([xs, y0 + c * xs * xs], axis=1)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    return xs, np.concatenate([[0.0], np.cumsum(seg)])


def _x_at(xs, s_cum, s):
    return float(np.interp(s, s_cum, xs))


def _crown(bm, kind, width, height, depth, centre, tangent, labial, down, tilt, cusp, segments, owner, label):
    """Rounded crown: a subdivided box shaped per tooth kind. Local axes: u along the arch, w toward the lips
    (labial), h from the cervix (h=0) toward the biting edge (h=1). Returns the new faces."""
    # built in its own bmesh: subdivide_edges invalidates the Python handles of every element in the mesh it
    # runs on (the gum vertices of the first arch vanished when the second arch's crowns were subdivided)
    tb = bmesh.new()
    bmesh.ops.create_cube(tb, size=2.0)
    if segments:
        bmesh.ops.subdivide_edges(tb, edges=list(tb.edges), cuts=segments, use_grid_fill=True)
    verts = list(tb.verts)
    edge_depth = EDGE_DEPTH[kind]
    round_k = 0.42 if kind in ("incisor", "canine") else 0.3
    for v in verts:
        u, w, hh = v.co.x, v.co.y, v.co.z  # -1..1
        h = (hh + 1.0) * 0.5  # 0 at the cervix, 1 at the edge
        r = (u * u + w * w) ** 0.5
        if r > 1e-6:  # round the box toward an elliptic cross-section
            sq = max(abs(u), abs(w)) / r
            u, w = u * (1 - round_k + round_k * sq), w * (1 - round_k + round_k * sq)
        wid = width * 0.5 * (0.84 + 0.16 * min(1.0, h * 1.6)) * (1.0 - 0.07 * max(0.0, (h - 0.9) / 0.1) * abs(u))
        dep = depth * 0.5 * (1.0 + (edge_depth - 1.0) * h ** 1.3)
        w_off = depth * 0.12 * (1.0 - (2 * h - 1) ** 2) if kind in ("incisor", "canine") else 0.0  # convex labial face
        z = height * h
        if kind == "canine" and h > 0.9:
            z -= cusp * abs(u)  # a pointed cusp
        if kind in ("premolar", "molar") and h > 0.9:
            z -= 0.0006 * (1.0 - abs(u)) * (1.0 - abs(w))  # a shallow occlusal fossa
        lean = math.tan(tilt) * z  # proclination: the edge leans toward the lips
        v.co = Vector(centre + tangent * (u * wid) + labial * (w * dep + w_off + lean) + down * z)
    tb.verts.index_update()
    new_verts = [bm.verts.new(v.co) for v in tb.verts]
    owner.extend([label] * len(new_verts))
    faces = [bm.faces.new([new_verts[v.index] for v in f.verts]) for f in tb.faces]
    tb.free()
    return faces


def _frame(y0, c, x):
    """Point on the arch midline at signed x, the tangent (increasing x) and the labial normal (out of the mouth)."""
    t = np.array([1.0, 2.0 * c * x, 0.0])
    t /= np.linalg.norm(t)
    lab = np.array([t[1], -t[0], 0.0])  # tangent turned by -90 degrees: toward -Y at the front, outward at the sides
    return np.array([x, y0 + c * x * x]), t, lab


def incisal_edges(teeth_full):
    """(upper, lower) incisal edge heights the authored arches are built at (the CC0 teeth's 4th and 96th
    percentile heights of each arch)."""
    co = vertex_array(teeth_full)
    names = {g.index: g.name for g in teeth_full.vertex_groups}
    lower = np.array([any(names[g.group] == "face_jaw" and g.weight > 0.5 for g in v.groups) for v in teeth_full.data.vertices])
    return float(np.percentile(co[~lower][:, 2], 4)), float(np.percentile(co[lower][:, 2], 96))


def build(teeth_full, arm, recipe, report, low=False, shift=(0.0, 0.0)):
    """Replace the fitted MakeHuman teeth by authored arches; returns the new 'Teeth' object. low=True builds the
    LOD1/Quest arches ('TeethLow'): incisors and canines as plain rounded boxes and a coarser gum band.
    shift = (upper, lower) height offsets of the arches (round 2: MakeHuman's teeth sit 3 to 6 mm high in the shaped
    mouths, so the upper incisors hid under the upper lip even with the mouth open; body.py lowers both arches to put
    the upper incisal edge just below the relaxed upper-lip line with a natural overbite)."""
    spec = recipe.get("teeth", {})
    co = vertex_array(teeth_full)
    names = {g.index: g.name for g in teeth_full.vertex_groups}
    lower = np.array([any(names[g.group] == "face_jaw" and g.weight > 0.5 for g in v.groups) for v in teeth_full.data.vertices])
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    tooth_uv = []  # (faces, column, centre, tangent, down, width, height)
    oriented = []  # (faces, outward direction or None) for explicit face orientation
    gum_uv = {}
    missing = set(spec.get("missing", ()))
    overlap = spec.get("overlap", {})
    built = []
    owner = []  # per created vertex: True when it belongs to the lower arch (moves with the jaw)
    for arch, sel in (("upper", ~lower), ("lower", lower)):
        pts = co[sel]
        y0, c, x_max = _arch_fit(pts)
        z_edge = float(np.percentile(pts[:, 2], 4 if arch == "upper" else 96)) + (shift[0] if arch == "upper" else shift[1])
        sign = -1.0 if arch == "upper" else 1.0  # from the cervix toward the biting edge
        down = np.array([0.0, 0.0, sign])
        xs, s_cum = _arc_samples(y0, c, x_max * 1.02)
        scale = float(np.clip(s_cum[-1] / sum(WIDTHS[arch]), 0.82, 1.18))
        # lower crowns a little shorter than before (they read as long pegs between the lips): most of a lower
        # incisor sits behind the lower lip
        crown_h = {kind: HEIGHT[kind] * (spec.get("lowerCrownScale", 0.84) if arch == "lower" else 1.0) * spec.get("crownScale", 1.0) for kind in HEIGHT}
        bounds = [0.0]
        for side in (1.0, -1.0):
            s = 0.0
            for k, (w0, kind) in enumerate(zip(WIDTHS[arch], KINDS)):
                width = w0 * scale
                sc = s + width * 0.5
                s += width
                if side > 0:
                    bounds.append(s)
                tag = f"{arch}_{'l' if side > 0 else 'r'}_{k + 1}"
                if tag in missing or (low and k >= 3):
                    continue
                x = _x_at(xs, s_cum, sc) * side
                p2, tangent, labial = _frame(y0, c, x)
                height = crown_h[kind]
                centre = np.array([p2[0], p2[1], z_edge - sign * 0.0006 * k - sign * height])
                tilt = math.radians({"incisor": 11.0, "canine": 7.0}.get(kind, 2.0) * (1.0 if arch == "upper" else 0.6))
                if tag in overlap:  # one tooth turned and pushed slightly forward
                    o = overlap[tag]
                    ang = math.radians(o.get("turnDeg", 8.0))
                    rot = np.array([[math.cos(ang), -math.sin(ang), 0], [math.sin(ang), math.cos(ang), 0], [0, 0, 1]])
                    tangent, labial = rot @ tangent, rot @ labial
                    centre = centre + labial * o.get("forward", 0.0006)
                faces = _crown(bm, kind, width * 0.97, height, DEPTH[kind] * spec.get("depthScale", 1.0), centre, tangent,
                               labial, down, tilt, spec.get("canineCusp", 0.0009) if kind == "canine" else 0.0, 0 if low else (1 if k < 3 else 0), owner, arch == "lower")
                col = (0 if arch == "upper" else 14) + (0 if side > 0 else 7) + k
                tooth_uv.append((faces, col, centre, tangent, down, width, height))
                built.append(tag)
        # gum band on the labial side: scalloped, reaching further over the crowns between teeth (papillae)
        n_seg = 16 if low else 30
        rows = []
        h_cerv = z_edge - sign * crown_h["incisor"]
        for r_i, (hz, out) in enumerate(((-0.0010, 0.0007), (0.0024, 0.0012), (0.0062, 0.0003))):
            row = []
            for j in range(n_seg + 1):
                x = -x_max * 0.98 + 2 * x_max * 0.98 * j / n_seg
                p2, _t, lab = _frame(y0, c, x)
                s_here = float(np.interp(abs(x), xs, s_cum))
                d_b = min(abs(s_here - b) for b in bounds)
                pap = (1.0 - min(1.0, d_b / 0.0028)) * 0.0016 if r_i == 0 else 0.0
                z = h_cerv - sign * (hz - pap)
                off = DEPTH["incisor"] * 0.5 + 0.0009 + out
                vert = bm.verts.new((p2[0] + lab[0] * off, p2[1] + lab[1] * off, z))
                owner.append(arch == "lower")
                gum_uv[vert] = (0.76 + 0.22 * j / n_seg, (0.53 if arch == "upper" else 0.77) + 0.09 * r_i)
                row.append((vert, lab))
            rows.append(row)
        gum_faces = []
        for a, b in zip(rows[:-1], rows[1:]):
            for j in range(n_seg):
                f = bm.faces.new((a[j][0], a[j + 1][0], b[j + 1][0], b[j][0]))
                oriented.append(([f], a[j][1]))
                gum_faces.append(f)
    # throat occluder (off by default since round 2: its hard black edges read as a card in the open mouth; the mouth
    # bag of the skin is darkened toward the throat by the skin bake instead, textures.refine_face_texels)
    back_y = float(co[:, 1].max()) + 0.006
    half_w = float(np.abs(co[:, 0]).max()) * 0.95
    z_lo, z_hi = float(co[:, 2].min()) - 0.012, float(co[:, 2].max()) + 0.006
    grid = []
    for i in range(3 if spec.get("throatOccluder", False) else 0):
        row = []
        for j in range(7):
            ang = -math.pi / 2 + math.pi * j / 6
            row.append(bm.verts.new((half_w * math.sin(ang), back_y - 0.006 * math.cos(ang), z_lo + (z_hi - z_lo) * i / 2)))
            owner.append(i == 0)
        grid.append(row)
    throat = []
    for a, b in zip(grid[:-1], grid[1:]):
        for j in range(6):
            f = bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
            throat.append(f)
            oriented.append(([f], np.array([0.0, -1.0, 0.0])))
    bm.normal_update()
    for faces, outward in oriented:
        for f in faces:
            if f.normal.dot(Vector(outward)) < 0:
                f.normal_flip()
    for faces, col, centre, tangent, down, width, height in tooth_uv:
        for f in faces:
            for loop in f.loops:
                rel = np.array(loop.vert.co) - centre
                a = float(np.clip(rel @ tangent / (width * 0.5) * 0.5 + 0.5, 0.0, 1.0))
                h = float(np.clip((rel @ down) / height, 0.0, 1.0))
                loop[uvl].uv = ((col + 0.06 + 0.88 * a) / COLUMNS * 0.74, 0.98 - 0.94 * h)
    for vert, uv in gum_uv.items():
        for loop in vert.link_loops:
            loop[uvl].uv = uv
    for f in throat:
        for loop in f.loops:
            loop[uvl].uv = (0.97, 0.03)
    name = "TeethLow" if low else "Teeth"
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    gen = vertex_array(obj)
    # arch membership comes from construction: a height split put the overlapping incisor tips on the wrong arch
    on_jaw = np.array(owner, dtype=bool)
    assert len(on_jaw) == len(gen)
    assign_weights(obj, [{"face_jaw": 1.0} if j else {"head": 1.0} for j in on_jaw], arm)
    morphs = 0 if low else _rigid_arch_keys(teeth_full, obj, lower, on_jaw)
    report.setdefault("parts", {})[name] = {
        "triangles": sum(len(p.vertices) - 2 for p in obj.data.polygons), "morphTargets": morphs,
        "source": "authored arches (Crownfall original) fitted to the MakeHuman teeth_base CC0 positions",
        "teeth": len(built), "missing": sorted(missing), "overlap": sorted(overlap)}
    return obj


def _kabsch(P, Q):
    """Rigid transform (R, cP, cQ) that best maps points P onto Q."""
    cP, cQ = P.mean(axis=0), Q.mean(axis=0)
    H = (P - cP).T @ (Q - cQ)
    U, _S, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    R = Vt.T @ np.diag([1.0, 1.0, d]) @ U.T
    return R, cP, cQ


def _rigid_arch_keys(source, target, src_lower, tgt_lower, min_delta=2e-4):
    """Face morphs for the authored arches: each arch moves rigidly, by the best-fit rigid motion of the matching
    MakeHuman arch in that morph. Nearest-triangle binding mixed the arches where the biting edges meet, so with
    the jaw open the lower crowns stretched up to the upper teeth like tall bars."""
    keys = source.data.shape_keys
    if not keys:
        return 0
    basis = vertex_array(source, keys.key_blocks[0].name)
    base = vertex_array(target)
    if not target.data.shape_keys:
        target.shape_key_add(name="Basis", from_mix=False)
    added = 0
    for kb in keys.key_blocks[1:]:
        moved = vertex_array(source, kb.name)
        if np.abs(moved - basis).max() < min_delta:
            continue
        out = base.copy()
        for s_sel, t_sel in ((src_lower, tgt_lower), (~src_lower, ~tgt_lower)):
            if np.abs(moved[s_sel] - basis[s_sel]).max() < min_delta or not t_sel.any():
                continue
            R, cP, cQ = _kabsch(basis[s_sel], moved[s_sel])
            out[t_sel] = (base[t_sel] - cP) @ R.T + cQ
        if np.abs(out - base).max() < min_delta:
            continue
        sk = target.shape_key_add(name=kb.name, from_mix=False)
        sk.data.foreach_set("co", out.ravel())
        added += 1
    if added == 0 and len(target.data.shape_keys.key_blocks) == 1:
        target.shape_key_clear()
    return added


def teeth_texture(size, spec):
    """Teeth cell of the eyes/mouth atlas (RGB 0..1, rows top to bottom) and its roughness (0..1)."""
    rgb = np.zeros((size, size, 3), dtype=np.float32)
    rough = np.full((size, size), 0.45, dtype=np.float32)
    ivory = np.array(spec.get("ivory", (0.94, 0.91, 0.82)), dtype=np.float32)
    edge = np.array((0.78, 0.79, 0.8), dtype=np.float32)
    yy, xx = np.mgrid[0:size, 0:size]
    u = (xx + 0.5) / size
    v = 1.0 - (yy + 0.5) / size
    teeth_zone = u < 0.74
    col = np.floor(u / 0.74 * COLUMNS).astype(int)
    a = (u / 0.74 * COLUMNS) - col
    k = np.where(col < 14, col % 7, (col - 14) % 7)
    depth_shade = np.clip(1.0 - 0.06 * k, 0.62, 1.0)  # back teeth sit in the mouth's shadow
    h = np.clip((0.98 - v) / 0.94, 0.0, 1.0)  # 0 cervix .. 1 edge
    base = ivory[None, None, :] * (0.93 + 0.07 * h[..., None])
    base = base * (1.0 - 0.06 * (1.0 - h[..., None]) * np.array([0.0, 0.3, 1.0]))  # warmer at the cervix
    base = base * (1 - 0.1 * np.clip((h[..., None] - 0.85) / 0.15, 0, 1)) + edge * 0.1 * np.clip((h[..., None] - 0.85) / 0.15, 0, 1)
    gap = np.clip(1.0 - np.minimum(a, 1 - a) / 0.07, 0.0, 1.0)  # darker where neighbouring teeth meet
    base = base * (1.0 - 0.3 * gap[..., None] ** 1.5)
    warm = np.array([1.0, 0.975, 0.92], dtype=np.float32)  # shade toward a warm grey, not an olive one
    base = base * (depth_shade[..., None] * (warm + (1 - warm) * depth_shade[..., None])) * spec.get("brightness", 1.0)
    rgb[teeth_zone] = base[teeth_zone]
    rough[teeth_zone] = 0.45
    gum = ~teeth_zone
    gum_col = np.array(spec.get("gum", (0.56, 0.27, 0.26)), dtype=np.float32)
    shade = np.clip(0.7 + 0.3 * np.abs(np.sin((u - 0.74) / 0.26 * math.pi)), 0.5, 1.0)
    rgb[gum] = (gum_col[None, None, :] * shade[..., None])[gum]
    rough[gum] = 0.42
    throat = (u > 0.94) & (v < 0.06)
    rgb[throat] = (0.035, 0.012, 0.012)
    rough[throat] = 0.6
    return rgb, rough

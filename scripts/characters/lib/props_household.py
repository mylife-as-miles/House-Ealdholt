"""Stage: role props for the smithy household (spinner, child, elder).

* Poly Haven (CC0) models, imported from the 1k glTF and decimated for runtime: wicker_basket_01 and
  wooden_bucket_01 (spinner), wooden_bucket_01 (child), wooden_spoon, wooden_bowl_01, wooden_stool_01 and
  wooden_hammer_01 (elder).
* Original Crownfall geometry with procedural materials: drop spindle with yarn and fibre roll, bellows
  lever, post, bellows, chain and forge hearth with coals, walking stick and whittling knife.
Hand props are given grips by the motion stage (exported under hand sockets); workplace props stand
relative to the resident root in the work pose; loose props are exported at the props root.
"""
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

from props import _material, _mesh_from_bm
from scene import apply_modifier, triangle_count, vertex_array


def import_polyhaven(ph_dir, asset_id, name, target_tris=None):
    folder = os.path.join(ph_dir, asset_id)
    path = os.path.join(folder, next(f for f in os.listdir(folder) if f.endswith(".gltf")))
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    keep = obj.name
    for o in new:
        try:
            if o.name != keep:
                bpy.data.objects.remove(o)
        except ReferenceError:
            pass  # already removed by the join
    obj.name = name
    # a separate roughness map (no packed ARM) exports as an empty glTF texture: use a constant instead
    for mat in obj.data.materials:
        if not mat or not mat.use_nodes:
            continue
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        rough_in = bsdf.inputs["Roughness"]
        for link in list(rough_in.links):
            src = link.from_node
            img = getattr(src, "image", None) or next((getattr(n, "image", None) for n in mat.node_tree.nodes
                                                      if n.type == "TEX_IMAGE" and any(l.to_node == src for o in n.outputs for l in o.links)), None)
            if img is not None and "rough" in img.name.lower():
                mat.node_tree.links.remove(link)
                rough_in.default_value = 0.75
    source = triangle_count(obj)
    if target_tris and source > target_tris:
        mod = obj.modifiers.new("Decimate", "DECIMATE")
        mod.ratio = target_tris / source
        apply_modifier(obj, mod)
    obj["source_triangles"] = source
    obj["polyhaven_id"] = asset_id
    return obj


def ground_and_centre(obj, z0=0.0):
    """Translate the mesh so its base sits at z0 and its footprint is centred on the origin."""
    co = vertex_array(obj)
    c = Vector(((co[:, 0].min() + co[:, 0].max()) / 2, (co[:, 1].min() + co[:, 1].max()) / 2, co[:, 2].min() - z0))
    obj.data.transform(Matrix.Translation(-c))
    obj.data.update()
    return float(co[:, 2].max() - co[:, 2].min())


def long_axis_to_y(obj):
    """Canonical tool frame: longest extent along +Y, butt (narrower end) at y = 0."""
    co = vertex_array(obj)
    centre = co.mean(axis=0)
    pts = co - centre
    _, _, vt = np.linalg.svd(pts, full_matrices=False)
    axis = vt[0]
    proj = pts @ axis
    # judge the ends by their width across the long axis within 10 percent of the length (a percentile test
    # flipped the smith's hammer, whose head holds most of the vertices)
    band = 0.1 * float(proj.max() - proj.min())

    def width(sel):
        q = pts[sel] - np.outer(proj[sel], axis)
        q = q - q.mean(axis=0)
        return float(np.ptp(q @ np.linalg.svd(q, full_matrices=False)[2][0]))
    if width(proj < proj.min() + band) > width(proj > proj.max() - band):
        axis, proj = -axis, -proj
    y = Vector(axis).normalized()
    side = Vector(vt[1]).normalized()
    z = y.cross(side).normalized()
    x = y.cross(z).normalized()
    rot = Matrix((x, y, z)).transposed()
    butt = centre + axis * proj.min()
    obj.data.transform((Matrix.Translation(Vector(butt)) @ rot.to_4x4()).inverted())
    obj.data.update()
    return float(proj.max() - proj.min())


def tube(name, points, radii, segments=10, cap=True):
    """Swept tube through points (Catmull-free polyline) with per-point radii."""
    pts = [Vector(p) for p in points]
    verts, faces = [], []
    for k, p in enumerate(pts):
        t = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        a = t.cross(ref).normalized()
        b = t.cross(a).normalized()
        for s in range(segments):
            ang = 2 * math.pi * s / segments
            verts.append(p + (a * math.cos(ang) + b * math.sin(ang)) * radii[k])
    for k in range(len(pts) - 1):
        for s in range(segments):
            i0, i1 = k * segments + s, k * segments + (s + 1) % segments
            faces.append((i0, i1, i1 + segments, i0 + segments))
    if cap:
        verts.append(pts[0])
        verts.append(pts[-1])
        c0, c1 = len(verts) - 2, len(verts) - 1
        last = (len(pts) - 1) * segments
        for s in range(segments):
            faces.append((c0, (s + 1) % segments, s))
            faces.append((c1, last + s, last + (s + 1) % segments))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    return obj


def box(bm, centre, size, rot=None):
    if isinstance(rot, (int, float)):  # an angle about Z (radians)
        rot = Matrix.Rotation(float(rot), 3, "Z")
    r = bmesh.ops.create_cube(bm, size=1.0)
    for v in r["verts"]:
        co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
        if rot is not None:
            co = rot @ co
        v.co = co + Vector(centre)
    return r["verts"]


def assign(obj, mats, rule=None):
    obj.data.materials.clear()
    for m in mats:
        obj.data.materials.append(m)
    if rule is not None:
        for p in obj.data.polygons:
            p.material_index = rule(p)


# ------------------------------------------------------------------ spinner

def spindle(spec):
    """Prop frame: origin at the yarn's top (where it leaves the fist), world-aligned in the work pose;
    the yarn hangs along -Z to the spindle; the fibre roll sits in the fist above the origin."""
    drop = spec["yarnDrop"]
    yarn = tube("yarn", [(0, 0, 0), (0, 0, -drop + 0.004)], [0.0011, 0.0011], segments=5, cap=False)
    shaft = tube("shaft", [(0, 0, -drop - 0.006), (0, 0, -drop + 0.004), (0, 0, -drop - 0.06), (0, 0, -drop - 0.2), (0, 0, -drop - 0.235)],
                 [0.0018, 0.0028, 0.0045, 0.0042, 0.0026], segments=8)
    cop = tube("cop", [(0, 0, -drop - 0.025), (0, 0, -drop - 0.05), (0, 0, -drop - 0.1), (0, 0, -drop - 0.15), (0, 0, -drop - 0.165)],
               [0.005, 0.012, 0.016, 0.011, 0.006], segments=12)
    bm = bmesh.new()
    r = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.021, radius2=0.017, depth=0.012)
    for v in r["verts"]:
        v.co += Vector((0, 0, -drop - 0.19))
    whorl = _mesh_from_bm(bm, "whorl")
    wood = _material("spindle_wood", (0.32, 0.23, 0.14), 0.0, 0.6)
    stone = _material("whorl_stone", (0.2, 0.19, 0.18), 0.0, 0.75)
    wool = _material("spun_wool", (0.62, 0.58, 0.5), 0.0, 0.95)
    for o, m in ((shaft, wood), (whorl, stone), (cop, wool), (yarn, wool)):
        assign(o, [m])
    obj = join([shaft, whorl, cop, yarn], "prop_spindle")
    return obj


def fibre_roll(spec, seed=5):
    """The rolag of carded wool held in the fibre hand (round 2): its own prop in the spindle's frame (it spun with
    the spindle in the props clip when it was part of that node) and fibrous, not a smooth foam sausage: a loose
    roll with lumpy, streaked sides, wisps drawn out toward the yarn and a frayed far end."""
    rng = np.random.default_rng(seed)
    axis = Vector(spec.get("fibreAxis", (0.0, 0.25, 1.0))).normalized()
    side = axis.cross(Vector((1.0, 0.0, 0.0))).normalized()
    up = axis.cross(side).normalized()
    rings, segs = 14, 18
    centres = [axis * (-0.012 + 0.165 * t) + Vector((0, 0, 0.01 + 0.03 * math.sin(t * math.pi))) for t in np.linspace(0, 1, rings)]
    radius = [0.006 + 0.022 * math.sin(min(1.0, t * 1.15) * math.pi) ** 0.7 for t in np.linspace(0, 1, rings)]
    phase = rng.uniform(0, math.tau, 5)
    verts, faces = [], []
    for i, (c, r) in enumerate(zip(centres, radius)):
        t = i / (rings - 1)
        for k in range(segs):
            a = math.tau * k / segs
            streak = 0.18 * math.sin(7 * a + phase[0] + t * 9.0) + 0.1 * math.sin(13 * a + phase[1]) + rng.normal(0.0, 0.07)
            fray = (0.25 * rng.uniform(-1, 1) if i in (0, rings - 1) else 0.0)
            rr = r * (1.0 + streak) * (0.82 if math.sin(a) < 0 else 1.0)
            verts.append(c + (side * math.cos(a) + up * math.sin(a)) * rr + axis * fray * 0.01)
    for i in range(rings - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            faces.append((i * segs + k, i * segs + k2, (i + 1) * segs + k2, (i + 1) * segs + k))
    faces.append(tuple(range(segs))[::-1])
    faces.append(tuple((rings - 1) * segs + k for k in range(segs)))
    me = bpy.data.meshes.new("prop_fibre_roll")
    me.from_pydata([tuple(v) for v in verts], [], faces)
    obj = bpy.data.objects.new("prop_fibre_roll", me)
    bpy.context.scene.collection.objects.link(obj)
    for p in obj.data.polygons:
        p.use_smooth = True
    from props import _worn_material
    fibre = _worn_material("fibre_wool", (0.66, 0.61, 0.52), (0.5, 0.46, 0.39), 0.0, 1.0, 0.04, 140.0, 0.45)
    assign(obj, [fibre])
    return obj


def wooden_mallet(handle_len=0.27):
    """A carpenter's round wooden mallet for mending tool handles (round 2; original geometry): a barrel-shaped
    beech head with worn, dented faces on an oval ash handle. Replaces Poly Haven's wooden_hammer_01, a modern
    claw hammer that did not fit the casting. Frame: handle butt at the origin, handle along +Y."""
    head = tube("mallet_head", [(-0.055, handle_len, 0.0), (-0.05, handle_len, 0.0), (0.0, handle_len, 0.0), (0.05, handle_len, 0.0),
                                (0.055, handle_len, 0.0)], [0.026, 0.031, 0.034, 0.031, 0.026], segments=16)
    rng = np.random.default_rng(13)
    for v in head.data.vertices:
        v.co += Vector(rng.normal(0.0, 0.0008, 3))
    handle = tube("mallet_handle", [(0, 0, 0), (0, 0.02, 0), (0, handle_len * 0.5, 0), (0, handle_len + 0.03, 0)],
                  [0.0125, 0.0135, 0.0115, 0.0105], segments=10)
    handle.data.transform(Matrix.Scale(0.8, 4, Vector((0.0, 0.0, 1.0))))  # oval section
    from props import _worn_material
    beech = _worn_material("mallet_beech", (0.42, 0.3, 0.19), (0.24, 0.16, 0.1), 0.0, 0.7, 0.12, 45.0, 0.5)
    ash = _worn_material("mallet_ash", (0.46, 0.36, 0.24), (0.28, 0.2, 0.13), 0.0, 0.62, 0.1, 60.0, 0.45)
    assign(head, [beech])
    assign(handle, [ash])
    return join([head, handle], "prop_mallet")


# ------------------------------------------------------------------ child

def bellows_set(spec):
    """Lever (hand prop, frame at the pivot with +Y toward the child), post, bellows, chain, hearth."""
    lv = spec["lever"]
    L, back = lv["length"], lv.get("backLength", 0.36)
    pole = tube("lever_pole", [(0, -back, 0), (0, 0, 0), (0, L - 0.02, 0)], [0.02, 0.022, 0.019], segments=10)
    bar = tube("lever_bar", [(-0.13, L, 0), (0.13, L, 0)], [0.015, 0.015], segments=10)
    bm = bmesh.new()
    box(bm, (0, 0, 0), (0.03, 0.05, 0.05))
    pin = _mesh_from_bm(bm, "lever_pin")
    wood = _material("lever_wood", (0.22, 0.15, 0.09), 0.0, 0.7)
    worn = _material("lever_worn", (0.36, 0.26, 0.17), 0.0, 0.55)
    iron = _material("iron_dark", (0.06, 0.058, 0.055), 0.75, 0.6)
    assign(pole, [wood])
    assign(bar, [worn])
    assign(pin, [iron])
    lever = join([pole, bar, pin], "prop_bellows_lever")
    pivot = Vector(lv["pivot"])
    post = tube("prop_bellows_post", [(pivot.x, pivot.y, 0.0), (pivot.x, pivot.y, pivot.z - 0.03)], [0.045, 0.04], segments=8)
    assign(post, [wood])
    # bellows: two boards and leather pleats, nozzle toward the hearth (+X)
    bx, by, bz = spec["bellows"]["back"], pivot.y - back, spec["bellows"]["base"]
    length, width = spec["bellows"]["length"], spec["bellows"]["width"]
    bm = bmesh.new()
    box(bm, (bx + length / 2, by, bz), (length, width, 0.03))
    tilt = Matrix.Rotation(math.radians(-9.0), 3, "Y")
    box(bm, (bx + length / 2, by, bz + 0.16), (length, width * 0.95, 0.03), rot=tilt)
    boards = _mesh_from_bm(bm, "bellows_boards")
    pleats = []
    for k in range(5):
        u = (k + 0.5) / 5
        hgt = 0.05 + 0.13 * (1 - u)
        x = bx + length * (0.1 + 0.75 * u)
        pleats.append(tube(f"pleat{k}", [(x, by - width * 0.42, bz + 0.02), (x, by - width * 0.42, bz + 0.02 + hgt), (x, by + width * 0.42, bz + 0.02 + hgt),
                                         (x, by + width * 0.42, bz + 0.02)], [0.024, 0.024, 0.024, 0.024], segments=6, cap=False))
    nozzle = tube("nozzle", [(bx + length, by, bz + 0.03), (bx + length + 0.2, by, bz + 0.05)], [0.03, 0.014], segments=10)
    stand = []
    for dx in (0.05, length - 0.05):
        for dy in (-width * 0.4, width * 0.4):
            stand.append(tube(f"leg{dx}{dy}", [(bx + dx, by + dy, 0.0), (bx + dx, by + dy, bz - 0.015)], [0.025, 0.025], segments=6))
    leather = _material("bellows_leather", (0.12, 0.075, 0.045), 0.0, 0.65)
    assign(boards, [wood])
    for o in pleats:
        assign(o, [leather])
    assign(nozzle, [iron])
    for o in stand:
        assign(o, [wood])
    bellows = join([boards, nozzle] + pleats + stand, "prop_bellows")
    up = math.radians(lv["upDegrees"])
    far = pivot + Vector((0, -back * math.cos(up), -back * math.sin(up)))
    chain = tube("prop_bellows_chain", [far, Vector((bx + 0.06, by, bz + 0.2))], [0.008, 0.008], segments=6)
    assign(chain, [iron])
    # forge hearth: dry-stone block, clay-lined fire pit, embers
    h = spec["hearth"]
    bm = bmesh.new()
    rng = np.random.default_rng(3)
    hx, hy, hz = h["centre"]
    sx, sy, sz = h["size"]
    # round 2: smaller, irregular stones in six uneven courses (the four courses of big chamfered blocks read as
    # grey masonry blocks), each turned and sized a little differently
    rows = h.get("courses", 6)
    for row in range(rows):
        z = sz * (row + 0.5) / rows
        cols = h.get("stonesPerCourse", 7) + (row % 2)
        widths = rng.uniform(0.7, 1.3, cols)
        widths = widths / widths.sum() * sx
        x = hx - sx / 2
        for col in range(cols):
            w = widths[col]
            jitter = rng.uniform(-0.012, 0.012, 3)
            rot = rng.uniform(-0.12, 0.12)
            for side in (-1, 1):
                box(bm, (x + w / 2 + jitter[0], hy + side * (sy / 2 - 0.045) + jitter[1] * 0.5, z + jitter[2] * 0.6),
                    (w * rng.uniform(0.86, 0.96), 0.09 * rng.uniform(0.85, 1.1), sz / rows * rng.uniform(0.8, 0.95)), rot)
            x += w
        for side in (-1, 1):
            n_side = h.get("sideStones", 4)
            for k in range(n_side):
                yy = hy - sy * 0.4 + sy * 0.8 * (k + 0.5) / n_side
                box(bm, (hx + side * (sx / 2 - 0.045), yy + rng.uniform(-0.01, 0.01), z),
                    (0.09 * rng.uniform(0.85, 1.1), sy * 0.8 / n_side * rng.uniform(0.85, 0.96), sz / rows * rng.uniform(0.8, 0.95)), rng.uniform(-0.1, 0.1))
    box(bm, (hx, hy, sz * 0.5), (sx * 0.8, sy * 0.8, sz * 0.98))
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.007, segments=h.get("bevelSegments", 2), affect="EDGES")
    # faces nobody can see: the backs of the stones inside the fill block and the undersides on the ground
    # (round 2: the stone courses had grown to 9,900 triangles; with these culled and single-segment chamfers the
    # hearth is near 4,000)
    core_x, core_y = sx * 0.4 - 0.004, sy * 0.4 - 0.004
    hidden = []
    for f in bm.faces:
        c, n = f.calc_center_median(), f.normal
        inside = abs(c.x - hx) < core_x and abs(c.y - hy) < core_y and 0.002 < c.z < sz * 0.98 - 0.002
        if (inside and n.z < 0.9) or (c.z < 0.004 and n.z < -0.7):
            hidden.append(f)
    bmesh.ops.delete(bm, geom=hidden, context="FACES")
    for v in bm.verts:
        v.co += Vector(rng.normal(0.0, 0.0045, 3))
    stones = _mesh_from_bm(bm, "hearth_stones")
    for p in stones.data.polygons:
        p.use_smooth = False
    # a bed of charcoal (round 2): many smaller angular lumps, flat-shaded, banked higher at the back; only the
    # middle glows, in thin low cracks (the large bright lumps read as golden crumpled foil)
    bm = bmesh.new()
    for k in range(h.get("coalLumps", 78)):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0, 0.2) ** 0.75
        # an icosahedron per lump (20 faces): angular like broken charcoal, and the bed stays near 1,600 triangles
        res = bmesh.ops.create_icosphere(bm, subdivisions=0, radius=rng.uniform(0.012, 0.027))
        c = Vector((hx + math.cos(a) * r, hy + math.sin(a) * r * 0.8, sz + 0.008 + rng.uniform(0, 0.022) + max(0.0, math.sin(a)) * 0.012))
        q = Vector(rng.normal(0, 1, 3)).normalized()
        ang = rng.uniform(0, math.pi)
        from mathutils import Quaternion
        rotq = Quaternion(q, ang)
        for v in res["verts"]:
            p = Vector((v.co.x * rng.uniform(0.7, 1.35), v.co.y * rng.uniform(0.7, 1.35), v.co.z * rng.uniform(0.45, 0.8)))
            v.co = rotq @ p + c + Vector(rng.normal(0.0, 0.002, 3))
    coals = _mesh_from_bm(bm, "hearth_coals")
    for p in coals.data.polygons:
        p.use_smooth = False
    from props import _worn_material
    stone_m = _worn_material("hearth_stone", (0.25, 0.235, 0.215), (0.07, 0.065, 0.06), 0.0, 0.88, 0.06, 7.0, 0.55)
    ember = _worn_material("embers", (0.045, 0.04, 0.037), (0.018, 0.016, 0.015), 0.0, 0.88, 0.05, 30.0, 0.55)
    _ember_glow(ember, centre=(hx, hy, sz), radius=h.get("glowRadius", 0.13))
    assign(stones, [stone_m])
    assign(coals, [ember])
    hearth = join([stones, coals], "prop_hearth")
    return {"lever": lever, "post": post, "bellows": bellows, "chain": chain, "hearth": hearth}


def _ember_glow(mat, centre=None, radius=0.13):
    """Glowing cracks in a dark crust: emission from a thresholded noise, deep orange, strongest in the middle of the
    bed and gone at its edge (round 2: thinner cracks, lower strength, a radial mask)."""
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.feature = "DISTANCE_TO_EDGE"
    vor.inputs["Scale"].default_value = 110.0
    nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
    crack = nt.nodes.new("ShaderNodeMapRange")
    crack.inputs["From Min"].default_value = 0.028
    crack.inputs["From Max"].default_value = 0.0
    nt.links.new(vor.outputs["Distance"], crack.inputs["Value"])
    heat = crack
    if centre is not None:
        sub = nt.nodes.new("ShaderNodeVectorMath")
        sub.operation = "SUBTRACT"
        sub.inputs[1].default_value = (centre[0], centre[1], centre[2] + 1.0)
        nt.links.new(tc.outputs["Object"], sub.inputs[0])
        flat = nt.nodes.new("ShaderNodeVectorMath")
        flat.operation = "MULTIPLY"
        flat.inputs[1].default_value = (1.0, 1.0, 0.0)
        nt.links.new(sub.outputs[0], flat.inputs[0])
        length = nt.nodes.new("ShaderNodeVectorMath")
        length.operation = "LENGTH"
        nt.links.new(flat.outputs[0], length.inputs[0])
        mask = nt.nodes.new("ShaderNodeMapRange")
        mask.inputs["From Min"].default_value = radius
        mask.inputs["From Max"].default_value = radius * 0.25
        nt.links.new(length.outputs["Value"], mask.inputs["Value"])
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        nt.links.new(crack.outputs["Result"], mul.inputs[0])
        nt.links.new(mask.outputs["Result"], mul.inputs[1])
        heat = mul
    out = heat.outputs["Result"] if heat is crack else heat.outputs["Value"]
    col = nt.nodes.new("ShaderNodeMix")
    col.data_type = "RGBA"
    col.inputs[6].default_value = (0.8, 0.09, 0.012, 1.0)
    col.inputs[7].default_value = (1.0, 0.36, 0.05, 1.0)
    nt.links.new(out, col.inputs[0])
    glow = nt.nodes.new("ShaderNodeMix")
    glow.data_type = "RGBA"
    glow.inputs[6].default_value = (0.0, 0.0, 0.0, 1.0)
    nt.links.new(col.outputs[2], glow.inputs[7])
    nt.links.new(out, glow.inputs[0])
    nt.links.new(glow.outputs[2], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 1.6


# ------------------------------------------------------------------ elder

def walking_stick(length):
    """Prop frame: grip at the origin, stick along -Z to the tip; a worn knob above the hand."""
    pts = [(0, 0, 0.07), (0.003, 0, 0.04), (0, 0, 0.0), (-0.004, 0.003, -length * 0.3), (0.003, -0.002, -length * 0.62), (0, 0, -length)]
    radii = [0.017, 0.015, 0.0135, 0.013, 0.012, 0.0105]
    stick = tube("prop_stick", pts, radii, segments=10)
    bark = _material("stick_wood", (0.13, 0.09, 0.06), 0.0, 0.75)
    polished = _material("stick_polished", (0.24, 0.16, 0.1), 0.0, 0.42)
    assign(stick, [bark, polished], rule=lambda p: 1 if p.center.z > -0.05 else 0)
    return stick


def whittling_knife():
    """Canonical tool frame: handle along +Y from the butt at the origin, blade beyond it, edge toward -Z."""
    handle = tube("knife_handle", [(0, 0, 0), (0, 0.05, 0), (0, 0.1, 0)], [0.0085, 0.0095, 0.008], segments=10)
    bm = bmesh.new()
    verts = [bm.verts.new(v) for v in ((-0.0012, 0.1, 0.004), (0.0012, 0.1, 0.004), (0.0012, 0.1, -0.008), (-0.0012, 0.1, -0.008),
                                       (-0.0008, 0.155, 0.003), (0.0008, 0.155, 0.003), (0.0004, 0.163, -0.002), (-0.0004, 0.163, -0.002))]
    for f in ((0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        bm.faces.new([verts[i] for i in f])
    blade = _mesh_from_bm(bm, "knife_blade")
    for p in blade.data.polygons:
        p.use_smooth = False
    assign(handle, [_material("knife_handle_wood", (0.2, 0.13, 0.08), 0.0, 0.55)])
    assign(blade, [_material("knife_steel", (0.32, 0.31, 0.3), 0.85, 0.35)])
    return join([handle, blade], "prop_knife")


# ------------------------------------------------------------------ stage

def build(arm, recipe, ph_dir, report):
    spec = recipe["props"]
    kit = spec["kit"]
    made, placement = {}, {}
    if kit == "spinner":
        made["spindle"] = spindle(recipe["motion"]["work"] | {"fibreAxis": spec.get("fibreAxis", (0.0, 0.25, 1.0))})
        placement["spindle"] = "hand"
        made["fibre_roll"] = fibre_roll({"fibreAxis": spec.get("fibreAxis", (0.0, 0.25, 1.0))})
        made["fibre_roll"]["grip_like"] = "prop_spindle"  # the spindle's grip (same frame); never spun by its clip
        placement["fibre_roll"] = "hand"
        basket = import_polyhaven(ph_dir, "wicker_basket_01", "prop_basket", spec.get("basketTris", 2600))
        ground_and_centre(basket)
        basket.location = Vector(spec["basketAt"])
        basket.rotation_euler.z = math.radians(spec.get("basketYaw", 20.0))
        made["basket"] = basket
        placement["basket"] = "workplace"
        bucket = import_polyhaven(ph_dir, "wooden_bucket_01", "prop_bucket", spec.get("bucketTris", 1500))
        ground_and_centre(bucket)
        made["bucket"] = bucket
        placement["bucket"] = "loose"
    elif kit == "child":
        parts = bellows_set(spec)
        made.update(parts)
        placement.update({"lever": "hand", "post": "workplace", "bellows": "workplace", "chain": "workplace", "hearth": "workplace"})
        bucket = import_polyhaven(ph_dir, "wooden_bucket_01", "prop_bucket_small", spec.get("bucketTris", 1300))
        height = ground_and_centre(bucket)
        k = spec.get("bucketHeight", 0.26) / max(1e-3, height)
        bucket.data.transform(Matrix.Scale(k, 4))
        bucket.location = Vector(spec["bucketAt"])
        made["bucket"] = bucket
        placement["bucket"] = "workplace"
    elif kit == "elder":
        st = spec["stick"]
        made["stick"] = walking_stick(st["length"])
        placement["stick"] = "hand"
        made["knife"] = whittling_knife()
        placement["knife"] = "hand"
        spoon = import_polyhaven(ph_dir, "wooden_spoon", "prop_spoon", spec.get("spoonTris", 1200))
        spoon_len = long_axis_to_y(spoon)
        made["spoon"] = spoon
        placement["spoon"] = "hand"
        seat = spec["seat"]
        stool = import_polyhaven(ph_dir, "wooden_stool_01", "prop_stool", spec.get("stoolTris", 2400))
        height = ground_and_centre(stool)
        # the stool top sits a little below the seated pose's seat height: at full height its seat came up
        # through the lap in sit and work_carving
        k = (seat["height"] - seat.get("stoolTopBelowSeat", 0.0)) / max(1e-3, height)
        stool.data.transform(Matrix.Scale(k, 4))
        stool.location = Vector((0.0, seat["y"] + seat.get("stoolBack", 0.03), 0.0))
        made["stool"] = stool
        placement["stool"] = "workplace"
        bowl = import_polyhaven(ph_dir, "wooden_bowl_01", "prop_bowl", spec.get("bowlTris", 1600))
        ground_and_centre(bowl)
        bowl.location = Vector(spec["bowlAt"])
        made["bowl"] = bowl
        placement["bowl"] = "workplace"
        mallet = wooden_mallet()
        mallet.data.transform(Matrix.Rotation(math.radians(90), 4, "X"))
        ground_and_centre(mallet)
        mallet.data.transform(Matrix.Rotation(math.radians(-90), 4, "X"))
        ground_and_centre(mallet)
        mallet.location = Vector(spec["malletAt"])
        mallet.rotation_euler.z = math.radians(spec.get("malletYaw", 30.0))
        made["mallet"] = mallet
        placement["mallet"] = "workplace"
        rest = walking_stick(st["length"])
        rest.name = "prop_stick_rest"
        rest.rotation_euler = (math.radians(spec.get("stickRestTilt", 86.0)), 0.0, math.radians(spec.get("stickRestYaw", 12.0)))
        rest.location = Vector(spec["stickRestAt"])
        made["stick_rest"] = rest
        placement["stick_rest"] = "workplace"
        report.setdefault("props", {})["spoonLength"] = round(spoon_len, 3)
    for key, obj in made.items():
        obj["crownfall_part"] = "prop"
        obj["placement"] = placement[key]
        if key in ("bellows", "chain"):
            obj["mechanism"] = True  # kept as its own node so a clip can drive it; static workplace props are merged
    report.setdefault("props", {}).update({"kit": kit, "triangles": {o.name: triangle_count(o) for o in made.values()},
                                           "sourceTriangles": {o.name: int(o["source_triangles"]) for o in made.values() if "source_triangles" in o},
                                           "placement": {made[k].name: v for k, v in placement.items()},
                                           "polyhavenModels": sorted({o["polyhaven_id"] for o in made.values() if "polyhaven_id" in o})})
    return made

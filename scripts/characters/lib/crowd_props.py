"""Crowd prop kits: the 65 role props of POPULATION_PROPS in seven shared GLBs (original Crownfall code).

Each kit (`farm`, `craft`, `textile`, `guard`, `letters-and-care`, `everyday`, `workplace`) is one GLB with one node per
prop (`prop_<id>`) and one material over one 512 atlas: 12 swatch cells (wood, iron, leather, straw, linen, wool, stone,
wax, bread, madder red, herb green, dark wood) with grain, plus up to four cells holding the downsized albedo of the
verified Poly Haven CC0 models the kit uses (wooden_bucket_01, wicker_basket_01, wooden_bowl_01, wooden_stool_01,
cross_pein_hammer), decimated to the prop budget. Everything else is a project-original low-poly model built here.

Frames (Blender, Z up; the glTF export turns +Z into +Y): hand props have their origin at the main grip with the handle
or shaft along +Z and the working end up (a spear, hoe or staff is held with its shaft vertical); worn props (quiver,
satchel, shield, keys, seed bag) have their origin at the strap or hanging point; workplace props stand on the floor
with their origin at the base centre and their working side toward +Y: the clip manifest places them ahead of the
resident, who faces -Y in Blender (glTF +Z), so the resident stands on the prop's +Y side (corrected by the art fixer,
8 November; the hide beam's high end and the sloped beam were already built this way). The grip
transform of each held prop per clip belongs to the clip library (motion builder); `kit.json` lists every prop's origin
kind, length and triangle count.
"""
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

SWATCHES = [  # linear RGB, grain amount
    ("wood", (0.30, 0.20, 0.11), 0.35), ("iron", (0.13, 0.13, 0.14), 0.25), ("leather", (0.11, 0.065, 0.035), 0.3),
    ("straw", (0.48, 0.38, 0.17), 0.4), ("linen", (0.6, 0.54, 0.42), 0.2), ("wool", (0.28, 0.26, 0.23), 0.25),
    ("stone", (0.33, 0.32, 0.29), 0.35), ("wax", (0.72, 0.64, 0.45), 0.12), ("bread", (0.42, 0.22, 0.08), 0.3),
    ("red", (0.36, 0.07, 0.045), 0.2), ("green", (0.1, 0.18, 0.05), 0.4), ("darkwood", (0.12, 0.075, 0.04), 0.3),
    ("hessian", (0.36, 0.27, 0.15), 0.45),  # art fixer, 8 November: seed bags, flour sacks, the hide bundle's straps
]
SW = {name: i for i, (name, _c, _g) in enumerate(SWATCHES)}
CELLS = 4  # 4 x 4 cells of 128 px in a 512 atlas; cells 13..15 hold Poly Haven albedos (at most three per kit)
PH_FIRST = len(SWATCHES)


class Builder:
    def __init__(self):
        self.bm = bmesh.new()
        self.sw = self.bm.faces.layers.int.new("swatch")

    def _tag(self, faces, swatch):
        for f in faces:
            f[self.sw] = SW[swatch] if isinstance(swatch, str) else swatch

    def smooth(self, faces):
        for f in faces:
            f.smooth = True

    def cyl(self, a, b, r1, r2=None, seg=8, swatch="wood", cap=True, smooth=False):
        a, b = Vector(a), Vector(b)
        r2 = r1 if r2 is None else r2
        d = b - a
        ret = bmesh.ops.create_cone(self.bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=d.length)
        rot = d.normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
        bmesh.ops.transform(self.bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=ret["verts"])
        faces = {f for v in ret["verts"] for f in v.link_faces}
        self._tag(faces, swatch)
        if smooth:  # sides only: rounded goods and handles, the caps stay flat
            self.smooth([f for f in faces if len(f.verts) == 4])

    def box(self, c, size, swatch="wood", rot_z=0.0, rot_x=0.0):
        ret = bmesh.ops.create_cube(self.bm, size=1.0)
        m = Matrix.Translation(Vector(c)) @ Matrix.Rotation(rot_z, 4, "Z") @ Matrix.Rotation(rot_x, 4, "X") @ Matrix.Diagonal((*size, 1.0))
        bmesh.ops.transform(self.bm, matrix=m, verts=ret["verts"])
        self._tag({f for v in ret["verts"] for f in v.link_faces}, swatch)

    def ball(self, c, r, swatch="wool", seg=8, rings=5, squash=(1, 1, 1)):
        ret = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=1.0)
        bmesh.ops.transform(self.bm, matrix=Matrix.Translation(Vector(c)) @ Matrix.Diagonal((r * squash[0], r * squash[1], r * squash[2], 1.0)),
                            verts=ret["verts"])
        faces = {f for v in ret["verts"] for f in v.link_faces}
        self._tag(faces, swatch)
        self.smooth(faces)  # balls are always rounded (faceted goods read as gems from the isometric view)

    def slab(self, outline_yz, thick, swatch="iron", x=0.0):
        """Thin solid from a polygon in the YZ plane (blades), `thick` along X."""
        top = [self.bm.verts.new((x + thick / 2, y, z)) for y, z in outline_yz]
        bot = [self.bm.verts.new((x - thick / 2, y, z)) for y, z in outline_yz]
        faces = [self.bm.faces.new(top), self.bm.faces.new(bot[::-1])]
        n = len(top)
        for i in range(n):
            j = (i + 1) % n
            faces.append(self.bm.faces.new((top[i], bot[i], bot[j], top[j])))
        self._tag(faces, swatch)

    def lumpy(self, c, radii, swatch, seed=0, subdiv=2, sag=0.0):
        """Rounded soft mass (sacks, bundles, cheeses): an icosphere with a little noise, sagging toward -Z."""
        ret = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=1.0)
        rng = np.random.default_rng(seed)
        for v in ret["verts"]:
            k = 1.0 + rng.uniform(-0.06, 0.06)
            x, y, z = v.co.x * radii[0] * k, v.co.y * radii[1] * k, v.co.z * radii[2] * k
            if sag:  # the bottom spreads, the top narrows
                w = 1.0 + sag * (-v.co.z)
                x, y = x * w, y * w
            v.co = Vector((x, y, z)) + Vector(c)
        faces = {f for v in ret["verts"] for f in v.link_faces}
        self._tag(faces, swatch)
        self.smooth(faces)

    def ring(self, c, r, minor, swatch="iron", seg=12, sides=4, axis="Z"):
        verts = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            for j in range(sides):
                b = 2 * math.pi * j / sides
                p = Vector(((r + minor * math.cos(b)) * math.cos(a), (r + minor * math.cos(b)) * math.sin(a), minor * math.sin(b)))
                if axis == "X":
                    p = Vector((p.z, p.x, p.y))
                elif axis == "Y":
                    p = Vector((p.x, p.z, p.y))
                verts.append(self.bm.verts.new(Vector(c) + p))
        faces = []
        for i in range(seg):
            for j in range(sides):
                q = [verts[i * sides + j], verts[i * sides + (j + 1) % sides], verts[((i + 1) % seg) * sides + (j + 1) % sides], verts[((i + 1) % seg) * sides + j]]
                faces.append(self.bm.faces.new(q))
        self._tag(faces, swatch)

    def finish(self, name):
        me = bpy.data.meshes.new(name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[:])
        smooth = [f.smooth for f in self.bm.faces]
        self.bm.to_mesh(me)
        for poly, sm in zip(me.polygons, smooth):
            poly.use_smooth = sm
        self.bm.free()
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        swatch_uvs(obj)
        return obj


def cell_rect(index):
    cx, cy = index % CELLS, index // CELLS
    s = 1.0 / CELLS
    return cx * s, 1.0 - (cy + 1) * s, s


def swatch_uvs(obj):
    """Each face maps into its swatch cell by a box projection of the whole prop (grain at prop scale, no wrapping)."""
    me = obj.data
    layer = me.uv_layers.new(name="UVMap")
    sw = me.attributes["swatch"]
    vals = np.zeros(len(me.polygons), dtype=np.int32)
    sw.data.foreach_get("value", vals)
    co = np.array([v.co[:] for v in me.vertices])
    lo, hi = co.min(axis=0), co.max(axis=0)
    ext = max(1e-4, float((hi - lo).max()))
    for poly in me.polygons:
        x0, y0, s = cell_rect(int(vals[poly.index]))
        n = np.abs(np.array(poly.normal[:]))
        ax = int(np.argmax(n))
        u_i, v_i = [(1, 2), (0, 2), (0, 1)][ax]
        for li in range(poly.loop_start, poly.loop_start + poly.loop_total):
            p = co[me.loops[li].vertex_index]
            u = (p[u_i] - lo[u_i]) / ext
            v = (p[v_i] - lo[v_i]) / ext
            layer.data[li].uv = (x0 + s * (0.08 + 0.84 * u), y0 + s * (0.08 + 0.84 * v))


# ------------------------------------------------------------------ prop models (metres)

def _long_tool(b, length, head):
    b.cyl((0, 0, -0.55 * length), (0, 0, 0.45 * length), 0.014, seg=6)
    head(b, 0.45 * length)


def m_hoe(b):
    _long_tool(b, 1.35, lambda b, z: b.box((0, -0.07, z), (0.16, 0.14, 0.012), "iron", rot_x=0.3))


def m_sickle(b):
    b.cyl((0, 0, -0.06), (0, 0, 0.06), 0.016, seg=6, swatch="wood")
    for k in range(6):
        a0, a1 = k / 6 * 2.6, (k + 1) / 6 * 2.6
        p0 = (math.sin(a0) * 0.13, 0, 0.06 + 0.13 - math.cos(a0) * 0.13)
        p1 = (math.sin(a1) * 0.13, 0, 0.06 + 0.13 - math.cos(a1) * 0.13)
        b.cyl(p0, p1, 0.008, 0.007, seg=4, swatch="iron")


def m_seed_bag(b):
    # a slumped hessian pouch hanging from its strap (the first bag was a faceted white blob that read as plastic)
    b.lumpy((0, 0, -0.16), (0.1, 0.065, 0.11), "hessian", seed=3, sag=0.35)
    b.cyl((0, 0, -0.07), (0, 0, 0.0), 0.012, seg=4, swatch="leather")
    b.ring((0, 0, -0.07), 0.035, 0.008, "leather", seg=8, sides=3)

def m_sack(b):
    # slumped grain sack, rounder and fuller at the bottom, a tied neck (origin at the hand hold)
    b.lumpy((0, 0, -0.02), (0.17, 0.13, 0.22), "hessian", seed=5, sag=0.3)
    b.cyl((0, 0, 0.18), (0, 0, 0.27), 0.035, 0.022, seg=6, swatch="hessian", smooth=True)
    b.ring((0, 0, 0.2), 0.035, 0.007, "linen", seg=8, sides=3)

def m_pitchfork(b):
    _long_tool(b, 1.5, lambda b, z: [b.cyl((x, 0, z), (x, 0, z + 0.25), 0.007, 0.004, seg=4) for x in (-0.06, 0.0, 0.06)]
               + [b.box((0, 0, z), (0.14, 0.02, 0.02), "wood")])


def m_crook(b):
    b.cyl((0, 0, -0.95), (0, 0, 0.55), 0.015, seg=6)
    for k in range(5):
        a0, a1 = k / 5 * math.pi * 1.2, (k + 1) / 5 * math.pi * 1.2
        b.cyl((0.07 - math.cos(a0) * 0.07, 0, 0.55 + math.sin(a0) * 0.07), (0.07 - math.cos(a1) * 0.07, 0, 0.55 + math.sin(a1) * 0.07), 0.014, seg=5)


def m_water_yoke(b):
    b.cyl((-0.45, 0, 0), (0.45, 0, 0), 0.03, seg=6)
    for x in (-0.42, 0.42):
        b.cyl((x, 0, 0), (x, 0, -0.45), 0.004, seg=3, swatch="leather")
        b.cyl((x, 0, -0.75), (x, 0, -0.45), 0.13, 0.15, seg=10, swatch="wood")


def m_saw(b):
    # hand saw in the clip contract frame (motion_roles.PROP_CONTRACTS.saw, art fixer 8 November): origin at the handle
    # grip, the handle across the fist along +Y, the blade along -Z from 8 to 62 cm with its teeth on the -Y edge
    b.box((0, 0.0, -0.005), (0.026, 0.11, 0.12), "darkwood")
    b.box((0, 0.0, -0.005), (0.03, 0.05, 0.05), "darkwood")
    b.slab([(-0.065, -0.07), (0.04, -0.06), (-0.015, -0.62), (-0.066, -0.62)], 0.0025, "iron")

def m_plane(b):
    # smoothing plane in the contract frame: origin at the rear grip (the tote), body along +Y, sole 6 cm below the grip
    b.box((0, 0.1, -0.038), (0.065, 0.26, 0.044), "wood")
    b.box((0, 0.0, -0.004), (0.024, 0.04, 0.05), "darkwood")
    b.cyl((0, 0.19, -0.016), (0, 0.19, 0.012), 0.016, seg=6, swatch="darkwood", smooth=True)
    b.box((0, 0.11, -0.012), (0.04, 0.012, 0.03), "iron", rot_x=0.8)

def m_mallet(b):
    b.cyl((0, 0, -0.18), (0, 0, 0.12), 0.013, seg=6)
    b.cyl((-0.08, 0, 0.16), (0.08, 0, 0.16), 0.05, seg=8, swatch="darkwood")


def m_chisel(b):
    b.cyl((0, 0, -0.06), (0, 0, 0.04), 0.012, seg=6)
    b.cyl((0, 0, 0.04), (0, 0, 0.16), 0.006, 0.003, seg=4, swatch="iron")


def m_axe(b):
    b.cyl((0, 0, -0.45), (0, 0, 0.35), 0.016, seg=6)
    b.box((0.08, 0, 0.3), (0.16, 0.025, 0.1), "iron")


def m_cleaver(b):
    b.cyl((0, 0, -0.08), (0, 0, 0.04), 0.014, seg=6)
    b.box((0.05, 0, 0.13), (0.11, 0.006, 0.18), "iron")


def m_awl(b):
    b.ball((0, 0, 0), 0.02, "wood", squash=(1, 1, 1.6))
    b.cyl((0, 0, 0.03), (0, 0, 0.1), 0.003, 0.001, seg=4, swatch="iron")


def m_hide_scraper(b):
    # two-handled fleshing knife in the contract frame: the right handle at the origin, the curved blade along +Y to the
    # left handle 40 cm away, its edge toward -Z (the working face); handles across the fists along X
    for y in (0.0, 0.4):
        b.cyl((-0.055, y, 0.0), (0.055, y, 0.0), 0.016, seg=6, smooth=True)
    pts = [(0.02, -0.01), (0.2, -0.035), (0.38, -0.01), (0.38, -0.03), (0.2, -0.06), (0.02, -0.03)]
    b.slab(pts, 0.004, "iron")

def m_ladle(b):
    b.cyl((0, 0, -0.4), (0, 0, 0.45), 0.012, seg=6)
    b.box((0, 0, 0.55), (0.1, 0.02, 0.2), "wood")


def m_oven_peel(b):
    b.cyl((0, 0, -0.7), (0, 0, 0.4), 0.014, seg=6)
    b.box((0, 0, 0.58), (0.32, 0.012, 0.36), "wood")


def m_broom(b):
    b.cyl((0, 0, -0.55), (0, 0, 0.65), 0.016, seg=6)
    b.cyl((0, 0, -1.0), (0, 0, -0.55), 0.09, 0.04, seg=8, swatch="straw")


def m_candle_rod(b):
    b.cyl((-0.4, 0, 0), (0.4, 0, 0), 0.01, seg=5)
    for k in range(6):
        x = -0.3 + k * 0.12
        b.cyl((x, 0, -0.01), (x, 0, -0.22), 0.009, 0.011, seg=5, swatch="wax")


def m_distaff(b):
    # distaff in the contract frame: origin at the butt, the rod along +Y (90 cm), the dressed fibre near the top
    b.cyl((0, 0, 0), (0, 0.9, 0), 0.011, seg=6, smooth=True)
    b.lumpy((0, 0.72, 0), (0.055, 0.15, 0.055), "wool", seed=2)

def m_carding_combs(b):
    for x in (-0.06, 0.06):
        b.box((x, 0, 0.06), (0.1, 0.02, 0.12), "wood")
        b.cyl((x, 0, -0.08), (x, 0, 0.0), 0.012, seg=5)


def m_net_shuttle(b):
    b.box((0, 0, 0.06), (0.04, 0.008, 0.2), "wood")
    b.ball((0, 0.1, -0.05), 0.08, "linen", squash=(1.2, 1.0, 0.5))


def m_osier_bundle(b):
    for k in range(9):
        a = k / 9 * 2 * math.pi
        b.cyl((math.cos(a) * 0.035, math.sin(a) * 0.035, -0.6), (math.cos(a) * 0.03, math.sin(a) * 0.03, 0.6), 0.006, seg=3, swatch="straw")
    b.ring((0, 0, 0), 0.045, 0.006, "leather", seg=8, sides=3)

def m_linen_bundle(b):
    # tied cloth bundle with sagging corners and a knot on top, undyed (the first was a clean white box)
    b.lumpy((0, 0, 0), (0.15, 0.11, 0.07), "linen", seed=7, sag=0.25)
    b.lumpy((0, 0, 0.065), (0.035, 0.03, 0.025), "linen", seed=8, subdiv=1)
    b.ring((0, 0, 0.0), 0.12, 0.004, "hessian", seg=12, sides=3, axis="Y")

def m_spear(b):
    b.cyl((0, 0, -1.0), (0, 0, 1.15), 0.014, seg=6)
    b.cyl((0, 0, 1.15), (0, 0, 1.38), 0.022, 0.0, seg=4, swatch="iron")


def m_round_shield(b):
    b.cyl((0, -0.02, 0), (0, 0.02, 0), 0.38, seg=14, swatch="wood")
    b.ball((0, -0.03, 0), 0.07, "iron", squash=(1, 0.5, 1))


def m_bow(b):
    # self bow with a visible curve and string, about twice the earlier width so it survives at isometric distance;
    # held at its grip (origin), limbs along +-Z, the belly curving toward +X, the string on the -X side
    n = 9
    pts = []
    for k in range(n):
        t = -1.0 + 2.0 * k / (n - 1)
        pts.append((0.1 * (1.0 - t * t) - 0.02 * abs(t) ** 3, 0.0, 0.8 * t))
    for k, (p0, p1) in enumerate(zip(pts[:-1], pts[1:])):
        r = 0.02 - 0.009 * abs((k + 0.5) / (n - 1) * 2 - 1)
        b.cyl(p0, p1, r, r * 0.92, seg=4, smooth=True, cap=False)
    b.cyl((pts[0][0] - 0.004, 0, pts[0][2] + 0.01), (pts[-1][0] - 0.004, 0, pts[-1][2] - 0.01), 0.003, seg=3, swatch="linen")
    b.cyl((0.09, 0, -0.06), (0.09, 0, 0.06), 0.024, seg=6, swatch="leather", smooth=True)

def m_quiver(b):
    b.cyl((0, 0, -0.55), (0, 0, 0.0), 0.05, 0.06, seg=8, swatch="leather")
    for k in range(5):
        a = k / 5 * 2 * math.pi
        b.cyl((math.cos(a) * 0.03, math.sin(a) * 0.03, 0.0), (math.cos(a) * 0.03, math.sin(a) * 0.03, 0.12), 0.006, seg=3, swatch="linen")


def m_sheathed_sword(b):
    b.cyl((0, 0, -0.85), (0, 0, 0.0), 0.022, 0.026, seg=6, swatch="leather")
    b.box((0, 0, 0.02), (0.2, 0.025, 0.02), "iron")
    b.cyl((0, 0, 0.03), (0, 0, 0.14), 0.014, seg=6, swatch="leather")
    b.ball((0, 0, 0.16), 0.022, "iron")


def m_arrow_bundle(b):
    for k in range(7):
        a = k / 7 * 2 * math.pi
        b.cyl((math.cos(a) * 0.02, math.sin(a) * 0.02, -0.38), (math.cos(a) * 0.02, math.sin(a) * 0.02, 0.38), 0.004, seg=3)
    b.ring((0, 0, 0), 0.028, 0.005, "linen", seg=8, sides=3)


def m_book(b):
    b.box((0, 0, 0), (0.18, 0.05, 0.24), "leather")


def m_wax_tablet(b):
    b.box((0, 0, 0), (0.14, 0.02, 0.2), "wood")
    b.box((0, -0.011, 0), (0.11, 0.004, 0.17), "wax")


def m_tally_sticks(b):
    for k in range(6):
        b.box(((k % 3 - 1) * 0.018, (k // 3 - 0.5) * 0.018, 0), (0.015, 0.015, 0.25), "wood")
    b.ring((0, 0, 0), 0.04, 0.005, "linen", seg=8, sides=3)


def m_keys(b):
    b.ring((0, 0, 0), 0.04, 0.005, "iron", seg=10, sides=3, axis="Y")
    for x in (-0.03, 0.0, 0.03):
        b.box((x, 0, -0.08), (0.008, 0.004, 0.08), "iron")


def m_satchel(b):
    b.box((0, 0, -0.12), (0.26, 0.08, 0.2), "leather")
    b.box((0, -0.042, -0.07), (0.26, 0.01, 0.12), "leather")


def m_basket_proc(b):
    b.cyl((0, 0, -0.12), (0, 0, 0.08), 0.15, 0.18, seg=10, swatch="straw")


def m_mortar_pestle(b):
    b.cyl((0, 0, 0), (0, 0, 0.12), 0.08, 0.1, seg=10, swatch="stone")
    b.cyl((0.02, 0, 0.08), (0.06, 0, 0.24), 0.015, seg=5, swatch="wood")


def m_walking_staff(b):
    b.cyl((0, 0, -1.0), (0, 0, 0.75), 0.018, seg=6)


def m_walking_stick(b):
    b.cyl((0, 0, -0.85), (0, 0, 0.08), 0.014, seg=6)
    b.cyl((0, 0, 0.08), (0.08, 0, 0.1), 0.015, seg=6)


def m_crutch(b):
    b.cyl((0, 0, -1.2), (0, 0, 0.0), 0.016, seg=6)
    b.cyl((0, 0, 0.0), (0, 0, 0.25), 0.012, seg=5)
    b.box((0, 0, 0.27), (0.18, 0.04, 0.03), "wood")


def m_pebbles(b):
    for k, (x, y, r) in enumerate(((0, 0, 0.016), (0.026, 0.012, 0.013), (-0.02, 0.018, 0.012))):
        b.ball((x, y, 0), r, "stone", seg=5, rings=3, squash=(1.0, 0.85, 0.7))

def m_whittling_knife(b):
    b.cyl((0, 0, -0.05), (0, 0, 0.04), 0.011, seg=5)
    b.box((0, 0, 0.08), (0.016, 0.003, 0.08), "iron")


def m_kindling_bundle(b):
    for k in range(8):
        a = k / 8 * 2 * math.pi
        b.cyl((math.cos(a) * 0.05, math.sin(a) * 0.05, -0.3), (math.cos(a) * 0.045, math.sin(a) * 0.045, 0.3), 0.014, seg=4)
    b.ring((0, 0, 0), 0.07, 0.006, "linen", seg=8, sides=3)


def m_loom(b):
    for x in (-0.6, 0.6):
        b.box((x, 0.1, 0.95), (0.06, 0.06, 1.9), rot_x=-0.15)
    b.box((0, 0.0, 1.85), (1.3, 0.08, 0.08))
    b.box((0, -0.05, 1.05), (1.1, 0.01, 1.4), "wool")
    for k in range(8):
        b.ball((-0.5 + k * 0.143, -0.12, 0.25), 0.04, "stone", seg=5, rings=3)


def m_potter_wheel(b):
    b.cyl((0, 0, 0), (0, 0, 0.08), 0.3, seg=12, swatch="wood")
    b.cyl((0, 0, 0.08), (0, 0, 0.6), 0.03, seg=6, swatch="wood")
    b.cyl((0, 0, 0.6), (0, 0, 0.63), 0.18, seg=12, swatch="darkwood")
    b.cyl((0, 0, 0.63), (0, 0, 0.75), 0.06, 0.04, seg=8, swatch="stone")


def m_market_trestle(b):
    # bare trestle under a cloth: the goods are per trade (goods-* props placed with it); the five faceted balls read as
    # gems or sweets from the isometric view (art fixer, 8 November)
    b.box((0, 0, 0.78), (1.4, 0.6, 0.04))
    for x in (-0.6, 0.6):
        for y in (-0.22, 0.22):
            b.box((x, y, 0.38), (0.05, 0.05, 0.76), "darkwood")
    b.box((0, 0, 0.805), (1.44, 0.64, 0.012), "linen")
    b.box((0, -0.322, 0.72), (1.44, 0.008, 0.18), "linen")

def m_chopping_block(b):
    b.cyl((0, 0, 0), (0, 0, 0.5), 0.24, 0.22, seg=10, swatch="wood")


def m_sawhorse(b):
    b.box((0, 0, 0.62), (1.0, 0.1, 0.1))
    for x in (-0.42, 0.42):
        for s in (-1, 1):
            b.box((x, s * 0.12, 0.3), (0.05, 0.05, 0.66), "darkwood", rot_x=s * 0.35)
    b.box((0.1, 0, 0.7), (1.5, 0.22, 0.03), "wood")


def m_workbench(b):
    b.box((0, 0, 0.8), (1.6, 0.6, 0.08))
    for x in (-0.7, 0.7):
        for y in (-0.24, 0.24):
            b.box((x, y, 0.38), (0.07, 0.07, 0.76), "darkwood")
    b.box((0, 0, 0.2), (1.4, 0.5, 0.03), "darkwood")


def m_hide_beam(b):
    b.cyl((0, -0.4, 0.0), (0, 0.6, 0.9), 0.12, seg=10, swatch="wood")
    for y in (0.4, 0.55):
        b.box((0, y, 0.35), (0.05, 0.05, 0.7), "darkwood")
    b.box((0, -0.1, 0.4), (0.5, 0.02, 0.7), "leather", rot_x=-0.85)


def m_butter_churn(b):
    b.cyl((0, 0, 0), (0, 0, 0.75), 0.17, 0.13, seg=10, swatch="wood")
    b.cyl((0, 0, 0.7), (0, 0, 1.15), 0.015, seg=5)


def m_brew_tub(b):
    b.cyl((0, 0, 0), (0, 0, 0.55), 0.38, 0.45, seg=14, swatch="wood")
    b.ring((0, 0, 0.45), 0.44, 0.012, "iron", seg=14, sides=3)


def m_fulling_trough(b):
    b.box((0, 0, 0.25), (1.4, 0.6, 0.5), "wood")
    b.box((0, 0, 0.5), (1.3, 0.5, 0.01), "wool")


def m_stone_block(b):
    b.box((0, 0, 0.3), (0.5, 0.5, 0.6), "wood")
    b.box((0, 0, 0.78), (0.5, 0.35, 0.36), "stone")


def m_bread_trough(b):
    b.box((0, 0, 0.7), (1.0, 0.45, 0.25), "wood")
    for x in (-0.4, 0.4):
        b.box((x, 0, 0.3), (0.06, 0.4, 0.6), "darkwood")
    b.ball((0, 0, 0.8), 0.18, "bread", squash=(1.8, 1, 0.5))


def m_washing_board(b):
    # sloping washing stone on a low bank of stones, a tub of linen beside it (the beetle is its own part)
    b.box((0, 0, 0.1), (0.75, 0.5, 0.2), "stone")
    b.box((0, -0.02, 0.24), (0.7, 0.42, 0.08), "stone", rot_x=0.28)
    b.cyl((0.6, 0.05, 0.0), (0.6, 0.05, 0.3), 0.18, 0.2, seg=10, swatch="wood", smooth=True)
    b.lumpy((0.6, 0.05, 0.3), (0.16, 0.16, 0.06), "linen", seed=4, subdiv=1)

def m_lectern(b):
    b.box((0, 0, 1.05), (0.55, 0.42, 0.04), rot_x=-0.45)
    b.box((0, 0.05, 0.5), (0.1, 0.1, 1.0), "darkwood")
    b.box((0, 0.05, 0.03), (0.45, 0.4, 0.06), "darkwood")
    b.box((0, -0.03, 1.1), (0.4, 0.28, 0.05), "leather", rot_x=-0.45)


# ------------------------------------------------------------------ parts of two-handed props (art fixer, 8 November)
# Each part is modelled in its clip contract frame (motion_roles.PROP_CONTRACTS and the clip's `part`): the clip
# manifest's grip for that hand applies to the part's node as it is (kit alignment identity).

def p_mortar(b):
    # mortar bowl in the left palm: origin 3.5 cm above the palm centre, bowl 14 cm across standing on the palm
    b.cyl((0, 0, -0.035), (0, 0, 0.03), 0.06, 0.07, seg=10, swatch="stone", smooth=True)
    b.cyl((0, 0, 0.03), (0, 0, 0.036), 0.055, 0.055, seg=10, swatch="darkwood")


def p_pestle(b):
    # pestle from its tip in the bowl (origin) up through the right fist along +Y, 20 cm
    b.cyl((0, 0.0, 0), (0, 0.07, 0), 0.02, 0.014, seg=7, swatch="stone", smooth=True)
    b.cyl((0, 0.07, 0), (0, 0.2, 0), 0.014, 0.012, seg=7, swatch="wood", smooth=True)


def p_comb(b):
    # wool card: origin at the handle butt, the handle along +Y, the toothed board at the far end with its teeth on -Z
    b.cyl((0, 0, 0), (0, 0.1, 0), 0.012, seg=6, swatch="wood", smooth=True)
    b.box((0, 0.15, 0.0), (0.12, 0.1, 0.014), "wood")
    b.box((0, 0.15, -0.011), (0.11, 0.09, 0.008), "iron")


def p_beetle(b):
    # washing beetle (bat) in the right fist: origin at the grip, the handle along +Y, the flat blade beyond, face -Z
    b.cyl((0, -0.04, 0), (0, 0.1, 0), 0.016, seg=6, swatch="wood", smooth=True)
    b.box((0, 0.24, 0.0), (0.09, 0.28, 0.025), "wood")


PARTS = {("mortar-pestle", "mortar"): p_mortar, ("mortar-pestle", "pestle"): p_pestle,
         ("carding-combs", "left"): p_comb, ("carding-combs", "right"): p_comb, ("washing-board", "beetle"): p_beetle}


# ------------------------------------------------------------------ workplaces, goods and tools added by the art fixer
# Workplace props: origin at the base centre, working side toward +Y (the resident's side). Goods (`placedWith` the trestle) are modelled in
# the trestle's base frame, standing on its 0.81 m top. Hand tools follow the contract convention (origin at the grip,
# +Y along the tool); carry goods replace the linen bundle with its frame (centred, held to the chest).

def m_mill_hopper(b):
    # hopper on a timber frame over the stone casing: the miller lifts the sack into the hopper from the +Y side at about
    # 1.25 m (work_tend_mill: hopper 0.42 m ahead of him, the prop 0.55 m ahead) and checks the meal at the spout
    for x in (-0.34, 0.34):
        for y in (-0.3, 0.28):
            b.box((x, y, 0.62), (0.07, 0.07, 1.24), "darkwood")
    b.cyl((0, -0.05, 0.0), (0, -0.05, 0.62), 0.4, 0.4, seg=14, swatch="wood", smooth=True)
    b.cyl((0, -0.05, 0.62), (0, -0.05, 0.66), 0.38, 0.38, seg=14, swatch="stone")
    b.cyl((0, 0.08, 1.02), (0, 0.08, 1.42), 0.07, 0.3, seg=4, swatch="wood")
    b.box((0, -0.01, 1.2), (0.7, 0.62, 0.04), "darkwood")
    b.box((0.36, 0.22, 0.5), (0.08, 0.22, 0.06), "wood", rot_x=-0.35)
    b.cyl((0.36, 0.38, 0.0), (0.36, 0.38, 0.3), 0.13, 0.15, seg=8, swatch="wood", smooth=True)


def m_bakehouse_oven(b):
    # stone oven front: a rounded dome with a dark arched mouth facing the baker (+Y) at about 0.8 m, a ledge for the peel;
    # work_oven_peel puts the prop 1.38 m ahead and the mouth about 1.1 m ahead, so the mouth face is at y = +0.28
    b.box((0, -0.15, 0.4), (1.3, 0.86, 0.8), "stone")
    b.lumpy((0, -0.2, 0.82), (0.62, 0.44, 0.36), "stone", seed=11)
    b.box((0, 0.27, 0.82), (0.44, 0.04, 0.26), "darkwood")
    b.cyl((0, 0.248, 0.95), (0, 0.29, 0.95), 0.22, 0.22, seg=10, swatch="darkwood")
    b.box((0, 0.36, 0.74), (0.7, 0.2, 0.06), "stone")


def m_stitching_clam(b):
    # two tall staves standing between the seated saddler's knees and leaning toward her (+Y), jaws at about 0.75 m
    for x in (-0.03, 0.03):
        b.box((x, 0.0, 0.38), (0.05, 0.1, 0.78), "wood", rot_x=-0.12)
    b.box((0, 0.05, 0.78), (0.14, 0.04, 0.06), "darkwood")
    b.box((0, 0.06, 0.84), (0.02, 0.06, 0.26), "leather")


def m_tallow_pot(b):
    # iron pot on a trivet over a bed of embers (rim at about 0.5 m), a rack with hanging candles beside it
    for k in range(3):
        a = k / 3 * 2 * math.pi
        b.cyl((math.cos(a) * 0.2, math.sin(a) * 0.2, 0.0), (math.cos(a) * 0.12, math.sin(a) * 0.12, 0.28), 0.012, seg=4, swatch="iron")
    b.cyl((0, 0, 0.26), (0, 0, 0.5), 0.16, 0.2, seg=10, swatch="iron", smooth=True)
    b.cyl((0, 0, 0.495), (0, 0, 0.505), 0.185, 0.185, seg=10, swatch="wax")
    b.cyl((0, 0, 0.0), (0, 0, 0.06), 0.22, 0.2, seg=8, swatch="darkwood")
    b.cyl((0.45, -0.1, 0.0), (0.45, -0.1, 0.9), 0.015, seg=4)
    b.cyl((0.35, -0.1, 0.9), (0.62, -0.1, 0.9), 0.012, seg=4)
    for k in range(4):
        x = 0.4 + k * 0.06
        b.cyl((x, -0.1, 0.89), (x, -0.1, 0.7), 0.01, 0.012, seg=5, swatch="wax", smooth=True)


TOP = 0.812  # the trestle's cloth


def _basket_of(b, c, r, fill, fill_r, n=7, seed=0):
    b.cyl((c[0], c[1], TOP), (c[0], c[1], TOP + r * 0.8), r * 0.85, r, seg=8, swatch="straw", smooth=True)
    rng = np.random.default_rng(seed)
    for k in range(n):
        a = k / n * 2 * math.pi + rng.uniform(0, 0.4)
        rr = r * 0.55 * (0.4 + 0.6 * (k % 2))
        b.ball((c[0] + math.cos(a) * rr, c[1] + math.sin(a) * rr, TOP + r * 0.8), fill_r, fill, seg=5, rings=3, squash=(1, 1, 1.25))


def m_goods_eggs(b):
    _basket_of(b, (-0.38, 0.05), 0.13, "wax", 0.024, seed=1)
    _basket_of(b, (-0.05, -0.05), 0.11, "wax", 0.022, n=6, seed=2)
    # slatted hen crate with a bird in it
    cx, cy = 0.4, 0.05
    b.box((cx, cy, TOP + 0.01), (0.42, 0.32, 0.02), "wood")
    b.box((cx, cy, TOP + 0.28), (0.42, 0.32, 0.02), "wood")
    for k in range(4):
        x = cx - 0.19 + k * 0.127
        b.box((x, cy - 0.15, TOP + 0.145), (0.018, 0.018, 0.27), "wood")
    b.lumpy((cx, cy, TOP + 0.12), (0.11, 0.08, 0.08), "linen", seed=3, subdiv=1)


def m_goods_flour(b):
    for k, (x, y, h) in enumerate(((-0.42, 0.06, 0.2), (-0.12, 0.08, 0.24), (0.2, 0.04, 0.18))):
        b.lumpy((x, y, TOP + h * 0.5), (0.14, 0.12, h * 0.55), "hessian", seed=20 + k, sag=0.35)
        b.cyl((x, y, TOP + h * 0.95), (x, y, TOP + h * 1.05), 0.05, 0.08, seg=8, swatch="linen", smooth=True)
    b.cyl((0.45, -0.05, TOP), (0.45, -0.05, TOP + 0.08), 0.1, 0.11, seg=10, swatch="wood", smooth=True)
    b.lumpy((0.45, -0.05, TOP + 0.08), (0.09, 0.09, 0.03), "linen", seed=4, subdiv=1)
    b.box((0.45, -0.22, TOP + 0.03), (0.06, 0.18, 0.03), "wood")


def m_goods_sausages(b):
    # the rail stands at the customers' edge (-Y), away from the seller
    for x in (-0.62, 0.62):
        b.cyl((x, -0.24, TOP), (x, -0.24, TOP + 0.55), 0.015, seg=5)
    b.cyl((-0.64, -0.24, TOP + 0.55), (0.64, -0.24, TOP + 0.55), 0.014, seg=5)
    for k in range(7):
        x = -0.5 + k * 0.165
        length = 0.22 + 0.08 * (k % 3)
        b.cyl((x, -0.24, TOP + 0.54), (x + 0.02, -0.25, TOP + 0.54 - length * 0.55), 0.018, 0.02, seg=5, swatch="red", smooth=True, cap=False)
        b.cyl((x + 0.02, -0.25, TOP + 0.54 - length * 0.55), (x, -0.24, TOP + 0.54 - length), 0.02, 0.017, seg=5, swatch="red", smooth=True)
    b.box((0.1, 0.05, TOP + 0.015), (0.6, 0.3, 0.03), "wood")
    for k in range(4):
        b.cyl((-0.1 + k * 0.12, 0.05, TOP + 0.045), (0.0 + k * 0.12, 0.07, TOP + 0.05), 0.022, seg=6, swatch="bread", smooth=True)


def m_goods_wares(b):
    b.box((0, 0.0, TOP + 0.03), (0.9, 0.42, 0.06), "darkwood")
    b.box((0, 0.0, TOP + 0.05), (0.84, 0.36, 0.02), "linen")
    for k, (sw, x, y) in enumerate((("red", -0.32, -0.08), ("green", -0.18, 0.08), ("wool", -0.04, -0.08), ("red", 0.1, 0.08),
                                    ("linen", 0.24, -0.08), ("green", 0.34, 0.08))):
        b.cyl((x, y - 0.03, TOP + 0.085), (x, y + 0.03, TOP + 0.085), 0.03, seg=8, swatch=sw, smooth=True)
    b.box((0.55, 0.05, TOP + 0.08), (0.18, 0.2, 0.16), "leather")


def m_goods_dairy(b):
    for k, (x, y, r, h) in enumerate(((-0.42, 0.05, 0.13, 0.08), (-0.42, 0.05, 0.11, 0.07), (-0.12, 0.08, 0.1, 0.07))):
        z0 = TOP + (0.08 if k == 1 else 0.0)
        b.cyl((x, y, z0), (x, y, z0 + h), r, r, seg=12, swatch="wax", smooth=True)
    for k, x in enumerate((0.15, 0.32, 0.49)):
        b.cyl((x, 0.0, TOP), (x, 0.0, TOP + 0.14), 0.065, 0.055, seg=10, swatch="stone", smooth=True)
        b.cyl((x, 0.0, TOP + 0.14), (x, 0.0, TOP + 0.155), 0.058, 0.05, seg=10, swatch="linen")


def m_goods_ale(b):
    b.cyl((-0.55, 0.1, TOP + 0.17), (-0.25, 0.1, TOP + 0.17), 0.16, 0.16, seg=12, swatch="wood", smooth=True)
    b.ring((-0.45, 0.1, TOP + 0.17), 0.162, 0.008, "iron", seg=12, sides=3, axis="X")
    b.ring((-0.35, 0.1, TOP + 0.17), 0.162, 0.008, "iron", seg=12, sides=3, axis="X")
    for k, x in enumerate((0.0, 0.2)):
        b.cyl((x, 0.0, TOP), (x, 0.0, TOP + 0.24), 0.07, 0.05, seg=10, swatch="bread", smooth=True)
        b.cyl((x, 0.0, TOP + 0.24), (x, 0.0, TOP + 0.3), 0.04, 0.035, seg=8, swatch="bread", smooth=True)
    for k, x in enumerate((0.38, 0.48, 0.58)):
        b.cyl((x, -0.12, TOP), (x, -0.12, TOP + 0.09), 0.035, 0.04, seg=8, swatch="wood", smooth=True)


def m_straw_bundle(b):
    # sheaf of straw bound by a twisted band: origin at the band (the grip), the sheaf along +Y
    b.cyl((0, -0.32, 0), (0, 0.0, 0), 0.085, 0.06, seg=9, swatch="straw", smooth=True)
    b.cyl((0, 0.0, 0), (0, 0.3, 0), 0.06, 0.075, seg=9, swatch="straw", smooth=True)
    b.ring((0, 0, 0), 0.066, 0.012, "straw", seg=10, sides=4, axis="Y")


def m_rope_coil(b):
    # coil of rope hanging from the hand (origin at the top of the coil, the coil below along -Z)
    for k in range(2):
        b.ring((0, 0.01 * k, -0.12), 0.11 - 0.008 * k, 0.015, "linen", seg=12, sides=4, axis="Y")


def m_twisting_stick(b):
    # rope-twisting stick: a short peg with a hook at its working end (+Y)
    b.cyl((0, -0.05, 0), (0, 0.2, 0), 0.012, seg=6, smooth=True)
    b.cyl((0, 0.2, 0), (0.04, 0.24, 0), 0.008, seg=4, swatch="iron")


def m_hide_bundle(b):
    # rolled hides on a strap (carried like the linen bundle: centred, across the chest)
    for k, (y, z) in enumerate(((-0.03, 0.0), (0.04, 0.05))):
        b.cyl((-0.2, y, z), (0.2, y, z), 0.065, 0.06, seg=9, swatch="leather", smooth=True)
    for x in (-0.1, 0.1):
        b.ring((x, 0.0, 0.025), 0.1, 0.008, "hessian", seg=10, sides=3, axis="X")


def m_shaft_bundle(b):
    # bundle of arrow shafts tied in two places (carried like the linen bundle)
    for k in range(9):
        a = k / 9 * 2 * math.pi
        b.cyl((-0.38, math.cos(a) * 0.03, math.sin(a) * 0.03), (0.38, math.cos(a) * 0.028, math.sin(a) * 0.028), 0.005, seg=3)
    for x in (-0.18, 0.18):
        b.ring((x, 0, 0), 0.036, 0.006, "linen", seg=8, sides=3, axis="X")


def m_osier_armful(b):
    # armful of long willow rods (carried like the linen bundle)
    for k in range(10):
        a = k / 10 * 2 * math.pi
        b.cyl((-0.5, math.cos(a) * 0.04, math.sin(a) * 0.035), (0.5, math.cos(a) * 0.03, math.sin(a) * 0.025), 0.006, seg=3, swatch="straw")
    b.ring((0, 0, 0), 0.05, 0.007, "leather", seg=8, sides=3, axis="X")


PROCEDURAL = {
    "hoe": m_hoe, "sickle": m_sickle, "seed-bag": m_seed_bag, "sack": m_sack, "pitchfork": m_pitchfork, "crook": m_crook,
    "water-yoke": m_water_yoke, "saw": m_saw, "plane": m_plane, "mallet": m_mallet, "chisel": m_chisel, "axe": m_axe,
    "cleaver": m_cleaver, "awl": m_awl, "hide-scraper": m_hide_scraper, "ladle": m_ladle, "oven-peel": m_oven_peel,
    "broom": m_broom, "candle-rod": m_candle_rod, "distaff": m_distaff, "carding-combs": m_carding_combs,
    "net-shuttle": m_net_shuttle, "osier-bundle": m_osier_bundle, "linen-bundle": m_linen_bundle, "spear": m_spear,
    "round-shield": m_round_shield, "bow": m_bow, "quiver": m_quiver, "sheathed-sword": m_sheathed_sword,
    "arrow-bundle": m_arrow_bundle, "book": m_book, "wax-tablet": m_wax_tablet, "tally-sticks": m_tally_sticks,
    "keys": m_keys, "satchel": m_satchel, "mortar-pestle": m_mortar_pestle, "walking-staff": m_walking_staff,
    "walking-stick": m_walking_stick, "crutch": m_crutch, "pebbles": m_pebbles, "whittling-knife": m_whittling_knife,
    "kindling-bundle": m_kindling_bundle, "loom": m_loom, "potter-wheel": m_potter_wheel, "market-trestle": m_market_trestle,
    "chopping-block": m_chopping_block, "sawhorse": m_sawhorse, "workbench": m_workbench, "hide-beam": m_hide_beam,
    "butter-churn": m_butter_churn, "brew-tub": m_brew_tub, "fulling-trough": m_fulling_trough, "stone-block": m_stone_block,
    "bread-trough": m_bread_trough, "washing-board": m_washing_board, "lectern": m_lectern,
    "mill-hopper": m_mill_hopper, "bakehouse-oven": m_bakehouse_oven, "stitching-clam": m_stitching_clam, "tallow-pot": m_tallow_pot,
    "goods-eggs": m_goods_eggs, "goods-flour": m_goods_flour, "goods-sausages": m_goods_sausages, "goods-wares": m_goods_wares,
    "goods-dairy": m_goods_dairy, "goods-ale": m_goods_ale, "straw-bundle": m_straw_bundle, "rope-coil": m_rope_coil,
    "twisting-stick": m_twisting_stick, "hide-bundle": m_hide_bundle, "shaft-bundle": m_shaft_bundle, "osier-armful": m_osier_armful,
}
# Props modelled in their clip contract frame (motion_roles.PROP_CONTRACTS): kit alignment identity in
# motion_library_manifest.KIT_ALIGN (art fixer, 8 November). The hammer is the household Poly Haven hammer in the
# household frame (butt at the origin, handle +Y, face -Z), which is the contract frame.
CONTRACT_FRAME = {"saw", "plane", "hide-scraper", "distaff", "hammer-small", "straw-bundle", "twisting-stick", "rope-coil"}
# Poly Haven CC0 models (verified in the household casting): asset, target height (m), origin kind
POLYHAVEN = {"milk-pail": ("wooden_bucket_01", 0.32, "grip"), "bucket": ("wooden_bucket_01", 0.36, "grip"),
             "small-bucket": ("wooden_bucket_01", 0.26, "grip"), "feed-basket": ("wicker_basket_01", 0.3, "grip"),
             "herb-basket": ("wicker_basket_01", 0.26, "grip"), "basket": ("wicker_basket_01", 0.32, "grip"),
             "bowl": ("wooden_bowl_01", 0.08, "base"), "stool": ("wooden_stool_01", 0.45, "base"),
             "hammer-small": ("cross_pein_hammer", 0.3, "contract")}
WORN = {"seed-bag", "quiver", "satchel", "round-shield", "keys", "sheathed-sword", "rope-coil"}


def _grain(size, colour, amount, seed):
    rng = np.random.default_rng(seed)
    base = rng.random((size // 8 + 1, size // 8 + 1))
    up = np.kron(base, np.ones((8, 8)))[:size, :size]
    streak = np.sin(np.linspace(0, 18, size))[None, :] * 0.5 + rng.random((size, size)) * 0.5
    g = 1.0 + (up - 0.5) * amount + (streak - 0.5) * amount * 0.5
    lin = np.clip(np.array(colour)[None, None, :] * g[..., None], 0, 1)
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    return srgb


def build_atlas(ph_cells, ph_dir, size=512):
    from PIL import Image
    cell = size // CELLS
    out = np.zeros((size, size, 4))
    out[..., 3] = 1.0
    for i, (_n, col, amt) in enumerate(SWATCHES):
        x0, y0 = (i % CELLS) * cell, (i // CELLS) * cell
        out[y0:y0 + cell, x0:x0 + cell, :3] = _grain(cell, col, amt, i)
    for asset, idx in ph_cells.items():
        folder = os.path.join(ph_dir, asset, "textures")
        diff = next(f for f in os.listdir(folder) if "_diff_" in f)
        im = np.asarray(Image.open(os.path.join(folder, diff)).convert("RGB").resize((cell, cell), Image.LANCZOS), dtype=np.float64) / 255.0
        x0, y0 = (idx % CELLS) * cell, (idx // CELLS) * cell
        out[y0:y0 + cell, x0:x0 + cell, :3] = im
    img = bpy.data.images.new("crowd_props_atlas", width=size, height=size, alpha=True)
    img.pixels.foreach_set(np.flipud(out).astype(np.float32).ravel())
    return img


def import_polyhaven(asset, ph_dir, name, height, origin, budget, cell_index):
    path = os.path.join(ph_dir, asset, f"{asset}_1k.gltf")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    new_names = [o.name for o in new]
    meshes = [o for o in new if o.type == "MESH"]
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for nm in new_names:
        o = bpy.data.objects.get(nm)
        if o is not None and o != obj:
            bpy.data.objects.remove(o)
    obj.parent = None
    co = np.array([v.co[:] for v in obj.data.vertices])
    lo, hi = co.min(axis=0), co.max(axis=0)
    k = height / max(1e-6, hi[2] - lo[2])
    centre = (lo + hi) / 2
    anchor = np.array([centre[0], centre[1], hi[2] if origin == "grip" else lo[2]])
    obj.data.transform(Matrix.Diagonal((k, k, k, 1.0)) @ Matrix.Translation(Vector(-anchor)))
    if len(obj.data.polygons) * 2 > budget:
        mod = obj.modifiers.new("Decimate", "DECIMATE")
        mod.ratio = budget / max(1, sum(len(p.vertices) - 2 for p in obj.data.polygons))
        mod.use_collapse_triangulate = True
        with bpy.context.temp_override(object=obj, active_object=obj):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    x0, y0, s = cell_rect(cell_index)
    uv = obj.data.uv_layers.active
    for layer in [l for l in obj.data.uv_layers if l != uv]:
        obj.data.uv_layers.remove(layer)
    for d in uv.data:
        u, v = d.uv
        d.uv = (x0 + s * (0.02 + 0.96 * (u % 1.0)), y0 + s * (0.02 + 0.96 * (v % 1.0)))
    uv.name = "UVMap"
    obj.name = obj.data.name = name
    return obj


def import_hammer_contract(ph_dir, name, length, budget, cell_index):
    """The Poly Haven cross-pein hammer in the household hammer frame (props.import_hammer: butt at the origin, handle
    along +Y, striking face toward -Z), which is the clip contract frame of hammer-small; scaled to `length` and
    decimated to the budget (art fixer, 8 November: imported upright with its origin at the top, it matched no grip)."""
    import props as HP
    obj, full = HP.import_hammer(ph_dir)
    k = length / max(1e-6, full)
    obj.data.transform(Matrix.Diagonal((k, k, k, 1.0)))
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tris > budget:
        mod = obj.modifiers.new("Decimate", "DECIMATE")
        mod.ratio = budget / max(1, tris)
        mod.use_collapse_triangulate = True
        with bpy.context.temp_override(object=obj, active_object=obj):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    x0, y0, s = cell_rect(cell_index)
    uv = obj.data.uv_layers.active
    for layer in [l for l in obj.data.uv_layers if l != uv]:
        obj.data.uv_layers.remove(layer)
    for d in uv.data:
        u, v = d.uv
        d.uv = (x0 + s * (0.02 + 0.96 * (u % 1.0)), y0 + s * (0.02 + 0.96 * (v % 1.0)))
    uv.name = "UVMap"
    for key in ("face_local", "head_centre_local"):
        if key in obj:
            del obj[key]
    obj.name = obj.data.name = name
    return obj


def wicker_basket(name, height, cell, seg=12):
    """Open tapered basket with a rim and a handle; the wall wraps the wicker albedo cell once around (origin: top of
    the handle, the grip)."""
    r0, r1 = height * 0.45, height * 0.6
    body_h = height * 0.62
    verts, faces, uvs = [], [], []
    x0, y0, s = cell_rect(cell)
    rings = [(0.0, r0), (body_h * 0.5, (r0 + r1) / 2), (body_h, r1)]
    for k, (z, r) in enumerate(rings):
        for j in range(seg + 1):
            a = 2 * math.pi * j / seg
            verts.append((math.cos(a) * r, math.sin(a) * r * 0.75, z))
            uvs.append((x0 + s * (0.02 + 0.96 * j / seg), y0 + s * (0.02 + 0.96 * k / (len(rings) - 1))))
    for k in range(len(rings) - 1):
        for j in range(seg):
            a = k * (seg + 1) + j
            faces.append((a, a + 1, a + seg + 2, a + seg + 1))
    base = len(verts)
    verts.append((0.0, 0.0, 0.0))
    uvs.append((x0 + s * 0.5, y0 + s * 0.5))
    for j in range(seg):
        faces.append((base, j + 1, j))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    layer = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in range(poly.loop_start, poly.loop_start + poly.loop_total):
            layer.data[li].uv = uvs[me.loops[li].vertex_index]
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    b = Builder()  # rim and handle in the straw swatch
    b.ring((0, 0, body_h), r1 * 0.98, 0.008, "straw", seg=seg, sides=3)
    for k in range(6):
        a0, a1 = k / 6 * math.pi, (k + 1) / 6 * math.pi
        b.cyl((math.cos(a0) * r1 * 0.9, 0, body_h + math.sin(a0) * (height - body_h)), (math.cos(a1) * r1 * 0.9, 0, body_h + math.sin(a1) * (height - body_h)),
              0.007, seg=4, swatch="straw")
    extra = b.finish(name + "_rim")
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    extra.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.join()
    obj.data.transform(Matrix.Translation((0.0, 0.0, -height)))
    return obj


def build_kit(kit, props, ph_dir, out_path, report):
    """props: POPULATION_PROPS entries of this kit. Writes the kit GLB; returns per-prop facts."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ph_assets = sorted({POLYHAVEN[p["id"]][0] for p in props if p["id"] in POLYHAVEN})
    ph_cells = {a: PH_FIRST + i for i, a in enumerate(ph_assets)}
    if PH_FIRST + len(ph_cells) > CELLS * CELLS:
        raise SystemExit(f"kit {kit} needs more Poly Haven cells than the atlas has")
    img = build_atlas(ph_cells, ph_dir)
    mat = bpy.data.materials.new(f"crowd_props_{kit}")
    mat.use_nodes = True
    nt = mat.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    nt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.8
    root = bpy.data.objects.new(f"crowd-props-{kit}", None)
    bpy.context.scene.collection.objects.link(root)
    facts = {}
    for p in props:
        pid = p["id"]
        name = "prop_" + pid.replace("-", "_")
        if pid in POLYHAVEN and POLYHAVEN[pid][0] == "wicker_basket_01":
            # the Poly Haven basket is modelled strand by strand: decimated to a crowd budget it fell apart into wires.
            # A solid project-original basket carries its CC0 wicker albedo instead.
            asset, height, origin = POLYHAVEN[pid]
            obj = wicker_basket(name, height, ph_cells[asset])
            source = f"polyhaven:{asset} (albedo) on a project-original shape"
        elif pid in POLYHAVEN and POLYHAVEN[pid][2] == "contract":
            asset, length, origin = POLYHAVEN[pid]
            obj = import_hammer_contract(ph_dir, name, length, p["trianglesBudget"], ph_cells[asset])
            source = f"polyhaven:{asset}"
        elif pid in POLYHAVEN:
            asset, height, origin = POLYHAVEN[pid]
            obj = import_polyhaven(asset, ph_dir, name, height, origin, p["trianglesBudget"], ph_cells[asset])
            source = f"polyhaven:{asset}"
        elif pid in PROCEDURAL:
            b = Builder()
            PROCEDURAL[pid](b)
            obj = b.finish(name)
            origin = "base" if p["kit"] == "workplace" else ("hang" if pid in WORN else "contract" if pid in CONTRACT_FRAME else "grip")
            source = "project-original"
        else:
            raise SystemExit(f"no model for prop {pid}")
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        for a in [a.name for a in obj.data.attributes if a.name == "swatch"]:
            obj.data.attributes.remove(obj.data.attributes[a])
        obj.parent = root
        obj.data.calc_loop_triangles()
        tris = len(obj.data.loop_triangles)
        co = np.array([v.co[:] for v in obj.data.vertices])
        facts[pid] = {"node": name, "source": source, "origin": origin, "triangles": tris, "trianglesBudget": p["trianglesBudget"],
                      "withinBudget": tris <= p["trianglesBudget"] * 1.25, "sizeMetres": [round(float(x), 3) for x in (co.max(0) - co.min(0))]}
        if p.get("placedWith"):
            facts[pid]["placedWith"] = p["placedWith"]
        if p.get("replaces"):
            facts[pid]["replaces"] = p["replaces"]
        parts = {}
        for part in p.get("parts", []) or []:
            pb = Builder()
            PARTS[(pid, part)](pb)
            po = pb.finish(f"{name}_{part}")
            po.data.materials.clear()
            po.data.materials.append(mat)
            for a in [a.name for a in po.data.attributes if a.name == "swatch"]:
                po.data.attributes.remove(po.data.attributes[a])
            po.parent = root
            po.data.calc_loop_triangles()
            parts[part] = {"node": po.name, "origin": "contract", "triangles": len(po.data.loop_triangles)}
        if parts:
            facts[pid]["parts"] = parts
    for o in bpy.context.selected_objects:
        o.select_set(False)
    root.select_set(True)
    for o in root.children:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", use_selection=True, export_animations=False, export_morph=False,
                              export_skins=False, export_image_format="WEBP", export_image_quality=85, export_yup=True,
                              export_extras=False, export_cameras=False, export_lights=False, export_vertex_color="NONE")
    report[kit] = {"file": os.path.basename(out_path), "bytes": os.path.getsize(out_path), "props": facts,
                   "polyhavenCells": ph_cells}
    return facts

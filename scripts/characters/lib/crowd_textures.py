"""Crowd atlas: one 512 RGBA albedo per resident, baked from source materials (original Crownfall code).

Every crowd piece gets a bake-time material: skin from the CC0 MakeHuman skin texture on the base-mesh UVs, tinted by
the family mix and tone, with painted brows, lash line, lips, beard shadow and role weathering (wind-burn, age spots,
freckles, flour, stained hands) as object-space masks evaluated per texel; garments from the Poly Haven CC0 fabrics
recoloured to the natural-dye palette, with wear (faded dye, muddy hems, flour, stains, soot, travel grime) and painted
bands; hair and beards as tinted strand streaks; metal, straw, leather and linen as their own looks; the eyes from the
CC0 eye texture; the mouth cavity dark. After decimation the joined mesh is unwrapped once into `AtlasUV` (the face at
about four times the cloth texel density) and Cycles bakes the diffuse colour of every material into one image.
"""
import json
import math
import os

import bmesh
import bpy
import numpy as np

import mh
from textures import Nodes, fabric_material, mean_luminance

HAIR_RGB = {  # linear
    "black": (0.016, 0.014, 0.012), "dark-brown": (0.04, 0.025, 0.016), "mid-brown": (0.085, 0.05, 0.028),
    "light-brown": (0.16, 0.1, 0.055), "fair": (0.36, 0.27, 0.15), "sandy": (0.3, 0.21, 0.11),
    "auburn": (0.16, 0.055, 0.025), "red-brown": (0.12, 0.05, 0.026), "white": (0.6, 0.58, 0.54),
}
GREY = (0.34, 0.33, 0.31)
FIXED = {  # linear base colours of the fixed slots
    "linen": (0.62, 0.56, 0.44), "leather": (0.075, 0.045, 0.026), "metal": (0.28, 0.285, 0.29), "mail": (0.11, 0.112, 0.118),
    "straw": (0.48, 0.38, 0.17), "cord": (0.5, 0.45, 0.34),
}
# reference statures of the archetype skeletons (metres; crowd residents are fitted onto them at build time)
REF_STATURE = {"adult-male": 1.735, "adult-female": 1.597, "adolescent": 1.507, "child": 1.195, "elder-male": 1.682,
               "elder-female": 1.516}
WEAR = {  # fade, fadeTo (multiplier), grime, grimeTop, grimeBottom, marks
    "clean": dict(fade=0.12, grime=0.1, top=0.35, bottom=0.0),
    "worn": dict(fade=0.32, grime=0.28, top=0.5, bottom=0.0),
    "muddy-hems": dict(fade=0.25, grime=0.65, top=0.42, bottom=0.0),
    "flour-dusted": dict(fade=0.2, grime=0.12, top=0.35, bottom=0.0, flour=0.55),
    "stained": dict(fade=0.25, grime=0.3, top=0.5, bottom=0.0, stains=0.6),
    "travel-worn": dict(fade=0.42, grime=0.45, top=0.6, bottom=0.0),
    "sooty": dict(fade=0.25, grime=0.4, top=0.9, bottom=0.0, soot=0.5),
}


def srgb_to_linear(hexstr):
    h = hexstr.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def hair_colour(name):
    if name.startswith("greying-"):
        base = HAIR_RGB.get(name[8:], HAIR_RGB["mid-brown"])
        return tuple(b * 0.6 + g * 0.4 for b, g in zip(base, GREY))
    if name.startswith("grey-"):
        base = HAIR_RGB.get(name[5:], HAIR_RGB["mid-brown"])
        return tuple(b * 0.3 + g * 0.7 for b, g in zip(base, GREY))
    return HAIR_RGB.get(name, HAIR_RGB["mid-brown"])


def fabric_stats(ph_dir):
    out = {}
    for fid in ("caban", "rough_linen", "poly_wool_herringbone", "fabric_leather_02", "brown_leather", "hessian_230", "curly_teddy_natural"):
        folder = os.path.join(ph_dir, fid)
        if not os.path.isdir(folder):
            continue
        files = os.listdir(folder)
        diff = next((f for f in files if "_diff_" in f or "_albedo_" in f), None)
        armf = next((f for f in files if "_arm_" in f), None)
        if diff and armf:
            out[fid] = {"diff": os.path.join(folder, diff), "arm": os.path.join(folder, armf),
                        "meanLum": mean_luminance(os.path.join(folder, diff))}
    return out


# ------------------------------------------------------------------ node helpers

def _vec(n, op, a, b=None):
    node = n.new("ShaderNodeVectorMath", operation=op)
    for idx, x in enumerate((a, b)):
        if x is None:
            continue
        if isinstance(x, (tuple, list)):
            node.inputs[idx].default_value = tuple(x)
        else:
            n.link(x, node.inputs[idx])
    return node.outputs["Value"] if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else node.outputs["Vector"]


def _position(n):
    tc = n.new("ShaderNodeTexCoord")
    return tc.outputs["Object"]


def ellipsoid(n, p, centre, radii, power=1.0):
    """1 at the centre, 0 outside: (1 - |(p - c) / r|^2) ^ power, clamped."""
    d = _vec(n, "SUBTRACT", p, centre)
    d = _vec(n, "DIVIDE", d, radii)
    q = _vec(n, "DOT_PRODUCT", d, d)
    m = n.math("SUBTRACT", 1.0, q, clamp=True)
    return n.math("POWER", m, power) if power != 1.0 else m


def slab(n, p, head, tail, t0, t1, reach=0.12):  # noqa: C901
    """Rest-pose band across a limb: the projection on the bone between t0 and t1 and within reach of its axis."""
    head, tail = np.array(head), np.array(tail)
    axis = tail - head
    L2 = float(axis @ axis)
    d = _vec(n, "SUBTRACT", p, tuple(head))
    t = n.math("DIVIDE", _vec(n, "DOT_PRODUCT", d, tuple(axis)), L2)
    inside = n.math("MULTIPLY", n.math("GREATER_THAN", t, t0), n.math("LESS_THAN", t, t1))
    proj = _vec(n, "SCALE", tuple(axis), None)
    scale_node = proj.node
    n.link(t, scale_node.inputs["Scale"])
    radial = _vec(n, "LENGTH", _vec(n, "SUBTRACT", d, proj))
    near = n.math("LESS_THAN", radial, reach)
    return n.math("MULTIPLY", inside, near)


def noise(n, p, scale, detail=3.0, rough=0.6):
    node = n.new("ShaderNodeTexNoise")
    node.inputs["Scale"].default_value = scale
    node.inputs["Detail"].default_value = detail
    node.inputs["Roughness"].default_value = rough
    n.link(p, node.inputs["Vector"])
    return node.outputs["Fac"]


# ------------------------------------------------------------------ materials

def skin_material(src, recipe, body, arm, eyes_spheres):
    """Bake material for the skin (MakeHuman CC0 diffuse on SrcUV, tinted and painted)."""
    sysdir = src["systemAssets"]
    skin_name = recipe["skin"]["base"]
    mat_path = os.path.join(sysdir, "skins", skin_name, skin_name + ".mhmat")
    info = mh.load_mhmat(mat_path)
    img_path = os.path.join(sysdir, "skins", skin_name, info["diffuseTexture"])
    mat = bpy.data.materials.new("bake_skin")
    n = Nodes(mat)
    tex = n.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(img_path, check_existing=True)
    uv = n.new("ShaderNodeUVMap", uv_map="SrcUV")
    n.link(uv.outputs["UV"], tex.inputs["Vector"])
    col = tex.outputs["Color"]
    fam = recipe["macro"].get("macroShapeFamilies", {"african": 0.0, "asian": 0.0, "caucasian": 1.0})
    tone = recipe["skin"].get("toneShift", 0.0)
    af, asn = float(fam.get("african", 0.0)), float(fam.get("asian", 0.0))
    tint = (1.0 - af * 1.1 + tone * 1.4, 1.0 - af * 1.3 - asn * 0.05 + tone * 1.4, 1.0 - af * 1.45 - asn * 0.18 + tone * 1.4)
    tint = tuple(max(0.25, min(1.25, t)) * 0.92 for t in tint)
    col = n.mix(col, tint, 1.0, "MULTIPLY")
    p = _position(n)
    b = arm.data.bones
    s = max(0.7, (b["head"].tail_local.z - b["head"].head_local.z) / 0.12)
    hair = hair_colour(recipe["hair"]["colour"])
    weather = recipe["skin"].get("weathering", [])
    male = recipe["sex"] == "male"
    # ruddy cheeks and nose (wind-burn) or a faint warmth
    ruddy = 0.35 if "wind-burn" in weather else 0.12
    for side in (1, -1):
        e = np.array(eyes_spheres["l" if side > 0 else "r"][0])
        cheek = ellipsoid(n, p, tuple(e + np.array([side * 0.012, -0.012, -0.035]) * s), (0.03 * s, 0.03 * s, 0.025 * s))
        col = n.mix(col, (0.55, 0.22, 0.17), n.math("MULTIPLY", cheek, ruddy))
    ec = (np.array(eyes_spheres["l"][0]) + np.array(eyes_spheres["r"][0])) / 2
    nose = ellipsoid(n, p, tuple(ec + np.array([0.0, -0.05, -0.035]) * s), (0.014 * s, 0.03 * s, 0.022 * s))
    col = n.mix(col, (0.55, 0.22, 0.17), n.math("MULTIPLY", nose, ruddy * 0.8))
    # beard shadow and stubble (men)
    jaw = np.array(b["face_jaw"].tail_local)
    fh = recipe["hair"].get("facialHair", "none")
    if male and recipe.get("ageYears", 30) >= 17:
        amount = {"none": 0.16, "stubble": 0.5, "moustache": 0.22, "short-beard": 0.9, "full-beard": 0.85}.get(fh, 0.2)
        jaw_r = (0.064 * s, 0.075 * s, 0.05 * s) if fh in ("short-beard", "full-beard") else (0.06 * s, 0.07 * s, 0.045 * s)
        zone = ellipsoid(n, p, tuple(jaw + np.array([0.0, 0.004, 0.006]) * s), jaw_r, 0.45 if fh in ("short-beard", "full-beard") else 0.6)
        lip_gap = ellipsoid(n, p, tuple(ec + np.array([0.0, -0.06, -0.075]) * s), (0.02 * s, 0.03 * s, 0.0045 * s))
        zone = n.math("MULTIPLY", zone, n.math("SUBTRACT", 1.0, lip_gap, clamp=True))
        tone = tuple(c * (0.8 if fh in ("short-beard", "full-beard") else 0.55) for c in hair)
        col = n.mix(col, tone, n.math("MULTIPLY", zone, amount))
        if fh in ("moustache", "short-beard", "full-beard"):
            stache = ellipsoid(n, p, tuple(ec + np.array([0.0, -0.07, -0.062]) * s), (0.028 * s, 0.03 * s, 0.009 * s), 0.5)
            col = n.mix(col, tuple(c * 0.8 for c in hair), n.math("MULTIPLY", stache, 0.92))
    # brows painted from the hair colour, an arch above each eye
    for side in (1, -1):
        e = np.array(eyes_spheres["l" if side > 0 else "r"][0])
        brow = ellipsoid(n, p, tuple(e + np.array([side * 0.006, -0.012, 0.021]) * s), (0.024 * s, 0.03 * s, 0.0065 * s), 0.7)
        col = n.mix(col, tuple(c * 0.7 for c in hair), n.math("MULTIPLY", brow, 0.85))
        r = eyes_spheres["l" if side > 0 else "r"][1]
        d = _vec(n, "LENGTH", _vec(n, "SUBTRACT", p, tuple(e)))
        ring = n.math("MULTIPLY", n.math("GREATER_THAN", d, r + 0.0006), n.math("LESS_THAN", d, r + 0.0026 * s))
        front = n.math("LESS_THAN", _vec(n, "DOT_PRODUCT", _vec(n, "SUBTRACT", p, tuple(e)), (0.0, 1.0, 0.0)), -0.004)
        col = n.mix(col, (0.09, 0.055, 0.045), n.math("MULTIPLY", n.math("MULTIPLY", ring, front), 0.4))
    # lips a touch deeper
    lips = ellipsoid(n, p, tuple(ec + np.array([0.0, -0.075, -0.073]) * s), (0.024 * s, 0.03 * s, 0.009 * s))
    col = n.mix(col, (0.36, 0.13, 0.11), n.math("MULTIPLY", lips, 0.35))
    head_c = (np.array(b["head"].head_local) + np.array(b["head"].tail_local)) / 2
    face = ellipsoid(n, p, tuple(head_c), (0.11 * s, 0.13 * s, 0.14 * s))
    if "age spots" in weather:
        spots = n.math("GREATER_THAN", noise(n, p, 160.0, 2.0, 0.5), 0.64)
        col = n.mix(col, (0.22, 0.12, 0.07), n.math("MULTIPLY", spots, 0.45))
    if "freckles" in weather:
        fr = n.math("GREATER_THAN", noise(n, p, 260.0, 1.0, 0.5), 0.62)
        col = n.mix(col, (0.3, 0.14, 0.07), n.math("MULTIPLY", n.math("MULTIPLY", fr, face), 0.5))
    hands = n.attr("crowd_hand", "R")
    if "stained hands" in weather:
        col = n.mix(col, (0.08, 0.06, 0.045), n.math("MULTIPLY", hands, 0.55))
    if "flour dust" in weather:
        dust = n.math("MULTIPLY", n.math("GREATER_THAN", noise(n, p, 40.0, 3.0, 0.6), 0.5), n.math("ADD", hands, n.math("MULTIPLY", face, 0.4)))
        col = n.mix(col, (0.75, 0.72, 0.66), n.math("MULTIPLY", dust, 0.45))
    if "old scar" in weather:
        e = np.array(eyes_spheres["l"][0])
        scar = ellipsoid(n, p, tuple(e + np.array([0.02, -0.02, -0.03]) * s), (0.003 * s, 0.02 * s, 0.022 * s))
        col = n.mix(col, (0.5, 0.3, 0.27), n.math("MULTIPLY", scar, 0.6))
    if "wind-burn" in weather or recipe.get("ageYears", 30) > 45:
        col = n.mix(col, (0.0, 0.0, 0.0), 0.06)
    n.link(col, n.bsdf.inputs["Base Color"])
    n.bsdf.inputs["Roughness"].default_value = 0.6
    return mat


def _hand_attribute(obj):
    """Point attribute crowd_hand (R = hand and finger weight) for the skin masks."""
    names = {g.index: g.name for g in obj.vertex_groups}
    vals = np.zeros((len(obj.data.vertices), 4), dtype=np.float32)
    vals[:, 3] = 1.0
    for v in obj.data.vertices:
        w = 0.0
        for g in v.groups:
            nm = names.get(g.group, "")
            if nm.split("_")[0] in ("hand", "thumb", "index", "middle", "ring", "pinky"):
                w += g.weight
        vals[v.index, 0] = min(1.0, w)
    attr = obj.data.color_attributes.get("crowd_hand") or obj.data.color_attributes.new("crowd_hand", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", vals.ravel())


def eyes_material(src, recipe):
    sysdir = src["systemAssets"]
    path = os.path.join(sysdir, "eyes", "materials", f"{recipe.get('eyes', 'brown')}_eye.png")
    if not os.path.exists(path):
        path = os.path.join(sysdir, "eyes", "materials", "brown_eye.png")
    mat = bpy.data.materials.new("bake_eyes")
    n = Nodes(mat)
    tex = n.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path, check_existing=True)
    uv = n.new("ShaderNodeUVMap", uv_map="SrcUV")
    n.link(uv.outputs["UV"], tex.inputs["Vector"])
    col = n.mix(tex.outputs["Color"], (0.82, 0.78, 0.72), 1.0, "MULTIPLY")
    n.link(col, n.bsdf.inputs["Base Color"])
    return mat


def flat_material(name, colour, noise_amount=0.08, scale=60.0):
    mat = bpy.data.materials.new("bake_" + name)
    n = Nodes(mat)
    p = _position(n)
    nz = noise(n, p, scale, 4.0, 0.6)
    col = n.mix(tuple(colour), tuple(c * 0.6 for c in colour), n.math("MULTIPLY", nz, noise_amount * 4))
    n.link(col, n.bsdf.inputs["Base Color"])
    return mat


def hair_material(name, colour, kind, seed, marks=None, palette=None):
    """Strand streaks running down and back from the crown, darker roots, lighter tips."""
    mat = bpy.data.materials.new("bake_" + name)
    n = Nodes(mat)
    p = _position(n)
    wave = n.new("ShaderNodeTexWave", wave_type="BANDS", bands_direction="X")
    wave.inputs["Scale"].default_value = 90.0 if kind != "beard" else 150.0
    wave.inputs["Distortion"].default_value = 6.0
    wave.inputs["Detail"].default_value = 3.0
    mp = n.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = (0.0, 1.2, 0.3 + seed % 7 * 0.1)
    n.link(p, mp.inputs["Vector"])
    n.link(mp.outputs["Vector"], wave.inputs["Vector"])
    streak = n.math("POWER", wave.outputs["Fac"], 1.5)
    base = tuple(colour)
    light = tuple(min(1.0, c * 1.7 + 0.01) for c in colour)
    dark = tuple(c * 0.45 for c in colour)
    col = n.mix(dark, light, streak)
    col = n.mix(col, base, 0.45)
    nz = noise(n, p, 30.0, 3.0, 0.6)
    col = n.mix(col, dark, n.math("MULTIPLY", n.math("GREATER_THAN", nz, 0.62), 0.4))
    for mk in marks or []:
        mcol = srgb_to_linear(palette[mk["slot"]]) if palette and mk["slot"] in palette else FIXED.get(mk["slot"], (0.4, 0.3, 0.2))
        col = n.mix(col, tuple(c * 0.85 for c in mcol), slab(n, p, mk["head"], mk["tail"], mk["t"][0], mk["t"][1], mk.get("reach", 0.12)))
    n.link(col, n.bsdf.inputs["Base Color"])
    return mat


def cloth_material(name, slot, fabric, recipe, ph_dir, stats, marks=None):
    palette = recipe["outfit"]["colours"]
    wear = WEAR.get(recipe["outfit"].get("wear", "worn"), WEAR["worn"])
    if slot in ("main", "secondary", "accent"):
        colour = srgb_to_linear(palette[slot])
    elif slot == "headwear":  # the resident's headwear tone as built (linen tone or dye; art fixer, 8 November)
        colour = srgb_to_linear(palette["headwear"]) if "headwear" in palette else FIXED["linen"]
    elif slot == "dark-accent":  # a darker overgown in the accent dye
        colour = tuple(x * 0.55 for x in srgb_to_linear(palette["accent"]))
    elif slot == "wraps":
        c = srgb_to_linear(palette["secondary"])
        colour = tuple(x * 0.8 for x in c)
    elif slot == "quilt":
        colour = srgb_to_linear(palette["main"])
    elif slot == "quilt-secondary":
        colour = srgb_to_linear(palette["secondary"])
    else:
        colour = FIXED.get(slot, (0.3, 0.3, 0.3))
    if slot == "metal":
        return flat_material(name, colour, 0.12, 120.0)
    if slot == "mail":  # riveted rings read darker than plate and carry a fine ring texture
        return flat_material(name, (0.11, 0.112, 0.118), 0.35, 260.0)
    fid = fabric if fabric in stats else ("rough_linen" if slot in ("linen", "cord") else "caban")
    # leather and hessian swatches tiled small at full contrast read as gravel or leopard print from the isometric view
    # (mason aprons, quilted gambesons; art fixer, 8 November): larger tiles and flatter contrast for them
    tile = {"rough_linen": 0.22, "fabric_leather_02": 0.5, "hessian_230": 0.4}.get(fid, 0.3)
    contrast = {"fabric_leather_02": 1.0, "hessian_230": 1.05}.get(fid, 1.25)
    spec = {"fabric": fid, "tileMetres": tile, "colour": [c * 0.82 for c in colour], "contrast": contrast,
            "fade": wear["fade"], "fadeColour": [min(1.0, c * 1.25 + 0.02) for c in colour], "grime": wear["grime"],
            "grimeTop": wear["top"], "grimeBottom": wear["bottom"], "ao": 0.45, "bump": 0.3}
    marks_spec = []
    if slot == "wraps":
        spec["bands"] = {"scale": 26.0, "colour": [c * 0.45 for c in colour], "amount": 0.55}
    if slot in ("quilt", "quilt-secondary"):
        marks_spec.append({"shape": "stripes", "axis": "z", "scale": 2 * math.pi / 0.045, "duty": 0.12, "colour": [c * 0.55 for c in colour], "amount": 0.6})
    # wear marks (population generator, 7 November): the first crowd batch painted flour and stains as hard-edged
    # blotches 10 to 15 cm across over the whole garment, headwear included, which read as camouflage. Now a fine,
    # soft-edged dusting or spotting kept in the working zone (shins to chest), never on headwear.
    H = REF_STATURE.get(recipe.get("archetype"), 1.7)
    if wear.get("flour") and slot not in ("headwear", "metal", "mail"):
        # flour and stone dust as a soft lightening toward the hem and the front (a fine noise read as camouflage from
        # the isometric view on the mason's apron, the miller's apprentice and the flour seller; art fixer, 8 November)
        marks_spec.append({"shape": "gradient", "scale": 5.0, "colour": [0.66, 0.64, 0.58], "amount": wear["flour"] * 0.55,
                           "zLow": 0.12 * H, "zHigh": 0.66 * H, "front": True})
    if wear.get("stains") and slot in ("secondary", "leather", "main"):
        marks_spec.append({"shape": "noise", "scale": 16.0, "threshold": 0.64, "soft": 0.12, "colour": [c * 0.45 for c in colour],
                           "amount": wear["stains"] * 0.7, "seed": 3.0, "zLow": 0.15 * H, "zHigh": 0.62 * H})
    if wear.get("soot"):
        marks_spec.append({"shape": "noise", "scale": 18.0, "threshold": 0.56, "soft": 0.22, "colour": [0.03, 0.028, 0.026],
                           "amount": wear["soot"] * 0.7, "zLow": 0.1 * H, "zHigh": 0.7 * H})
    spec["marks"] = marks_spec
    mat = fabric_material(name, spec, ph_dir, stats)
    if marks:
        n = Nodes(mat)
        nt = mat.node_tree
        link = next(l for l in nt.links if l.to_node == n.bsdf and l.to_socket.name == "Base Color")
        col = link.from_socket
        p = _position(n)
        for mk in marks:
            mcol = srgb_to_linear(palette[mk["slot"]]) if mk["slot"] in palette else FIXED.get(mk["slot"], (0.3, 0.3, 0.3))
            m = slab(n, p, mk["head"], mk["tail"], mk["t"][0], mk["t"][1])
            col = n.mix(col, tuple(c * 0.85 for c in mcol), m)
        n.link(col, n.bsdf.inputs["Base Color"])
    return mat


# ------------------------------------------------------------------ atlas

def atlas_unwrap(obj, face_scale=2.0, head_test=None, margin=0.004):
    """Smart-project the joined mesh into AtlasUV, enlarge face islands (linear face_scale) and pack."""
    me = obj.data
    if "AtlasUV" not in me.uv_layers:
        me.uv_layers.new(name="AtlasUV")
    me.uv_layers.active = me.uv_layers["AtlasUV"]
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(72.0), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    if head_test is not None:
        bm = bmesh.new()
        bm.from_mesh(me)
        uvl = bm.loops.layers.uv["AtlasUV"]
        bm.faces.ensure_lookup_table()
        # islands by shared UV coordinates
        parent = list(range(len(bm.faces)))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a
        for e in bm.edges:
            fs = e.link_faces
            if len(fs) != 2:
                continue
            f0, f1 = fs
            same = True
            for v in e.verts:
                u0 = next(l[uvl].uv for l in f0.loops if l.vert == v)
                u1 = next(l[uvl].uv for l in f1.loops if l.vert == v)
                if (u0 - u1).length > 1e-6:
                    same = False
            if same:
                parent[find(f0.index)] = find(f1.index)
        islands = {}
        for f in bm.faces:
            islands.setdefault(find(f.index), []).append(f)
        scaled = 0
        for faces in islands.values():
            heads = sum(1 for f in faces if head_test(f))
            if heads * 2 < len(faces):
                continue
            uvs = [l[uvl].uv.copy() for f in faces for l in f.loops]
            c = sum(uvs, uvs[0] * 0) / len(uvs)
            for f in faces:
                for l in f.loops:
                    l[uvl].uv = c + (l[uvl].uv - c) * face_scale
            scaled += 1
        bm.to_mesh(me)
        bm.free()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin=margin, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_atlas(obj, size, samples=4, margin=4):
    img = bpy.data.images.new("crowd_albedo", width=size, height=size, alpha=True, float_buffer=False)
    img.colorspace_settings.name = "sRGB"
    img.generated_color = (0.0, 0.0, 0.0, 0.0)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.render.bake.margin = margin
    scene.render.bake.margin_type = "EXTEND"
    obj.data.uv_layers.active = obj.data.uv_layers["AtlasUV"]
    for slot in obj.material_slots:
        nt = slot.material.node_tree
        node = nt.nodes.new("ShaderNodeTexImage")
        node.label = "BAKE_TARGET"
        node.image = img
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = "AtlasUV"
        nt.links.new(uvn.outputs["UV"], node.inputs["Vector"])
        nt.nodes.active = node
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, use_clear=False, margin=margin)
    fill_unbaked(img)
    return img


def fill_unbaked(img, passes=600):
    """Fill every texel outside the baked islands from its nearest baked neighbours, so bilinear filtering and mip
    levels never pull the empty atlas background into a resident (it showed as pale blotches at distance)."""
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    known = px[..., 3] > 0.5
    col = px[..., :3] * known[..., None]
    filled = known.copy()
    for _ in range(passes):
        if filled.all():
            break
        acc = np.zeros_like(col)
        cnt = np.zeros((h, w), dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            m = np.roll(np.roll(filled, dy, 0), dx, 1)
            c = np.roll(np.roll(col, dy, 0), dx, 1)
            acc += c * m[..., None]
            cnt += m
        new = (~filled) & (cnt > 0)
        col[new] = acc[new] / cnt[new][:, None]
        filled |= new
    px[..., :3] = col
    px[..., 3] = 1.0
    img.pixels.foreach_set(px.ravel())
    img.update()


def final_material(img, double_sided=True, roughness=0.85):
    mat = bpy.data.materials.new("crowd")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = "AtlasUV"
    nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    mat.use_backface_culling = not double_sided
    return mat

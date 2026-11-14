"""Crowd outfit kits: role garments generated on each resident's body at crowd resolution (original Crownfall code).

The 24 kits of POPULATION_OUTFIT_KITS (village-population.ts) are recipes of a few garment layers built with the
household garment primitives (garments.py, outfits.py): body shells for upper garments and hose, generated tubes for
skirts and long robes (weighted to the thighs and shins as well as the shared skirt bones), capelet grids for capes,
shawls, mantles and hooded capes, apron panels, belts and banded leg wraps. Only layers that can be seen are built
(a linen shirt shows as the sleeves and collar below the tunic), because the crowd level is about 3,500 triangles.
Each piece carries `crowd_slot` (main, secondary, accent, linen, leather, metal, quilt, cord) for the palette and
`crowd_fabric` for the cloth texture; the texture stage colours it from the resident's natural-dye palette and wear.
Skin hidden under opaque layers is deleted by a ray test that keeps a margin at every garment edge.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

import garments as G
import outfits as O
from scene import SurfaceBinding, assign_weights, delete_faces, new_mesh, triangle_count, vertex_array

# ------------------------------------------------------------------ kit table
# upper: sleeve ('fore', t) | ('upper', t) | None; skirt hem: 'thigh' 'above-knee' 'knee' 'calf' 'ankle';
# legs: hose to the waist; wraps: banded wraps ankle to below the knee; shoes: top above the ankle (boots higher);
# apron: 'waist' | 'bib' | 'small' | None; cape: None | 'hooded' | 'shawl' | 'mantle' | 'cloak' | 'cape';
# extras: 'belt', 'pouch', 'sleeve-band', 'shoulder-band', 'bracer', 'mail', 'surcoat', 'shift-hem', 'cord-belt'
KITS = {
    "field-tunic": dict(upper=("fore", 0.35), loose=0.02, hem="above-knee", legs=True, wraps=True, shoes=0.03,
                        extras=("belt", "pouch"), fabric="caban"),
    "field-kirtle": dict(upper=("fore", 0.72), loose=0.014, hem="calf", shift_hem=True, legs=False, shoes=0.025,
                         apron="waist", extras=("belt",), fabric="caban"),
    "herder-cloak": dict(upper=("fore", 0.9), loose=0.02, hem="knee", hem_f="calf", legs=True, wraps=True, shoes=0.045,
                         cape="hooded-cape", extras=("belt",), fabric="caban", upper_slot="secondary", skirt_slot="secondary",
                         cape_slot="main"),
    "workshop-apron-m": dict(upper=("fore", 0.45), loose=0.016, hem="above-knee", legs=True, wraps=False, shoes=0.03,
                             apron="bib", apron_slot="leather", extras=("belt", "pouch"), fabric="caban"),
    "workshop-apron-f": dict(upper=("fore", 0.55), loose=0.014, hem="ankle", legs=False, shoes=0.025, apron="bib",
                             apron_slot="secondary", extras=("belt",), fabric="caban"),
    "miller-smock": dict(upper=("fore", 0.9), loose=0.03, hem="knee", legs=True, wraps=False, shoes=0.03,
                         extras=("belt",), fabric="rough_linen"),
    "market-m": dict(upper=("fore", 0.95), loose=0.018, hem="calf", legs=True, wraps=False, shoes=0.03, cape="mantle",
                     cape_slot="secondary", extras=("belt", "pouch"), fabric="poly_wool_herringbone"),
    "market-f": dict(upper=("fore", 0.95), loose=0.014, hem="ankle", legs=False, shoes=0.025, extras=("belt", "pouch", "cuffs"),
                     fabric="poly_wool_herringbone"),
    "hall-livery": dict(upper=("fore", 0.92), loose=0.016, hem="knee", hem_f="ankle", legs=True, wraps=False, shoes=0.03,
                        apron_f="waist", extras=("belt", "sleeve-band"), fabric="caban"),
    "guard-gambeson": dict(upper=("fore", 0.95), loose=0.03, thick=0.022, hem="thigh", legs=True, wraps=False, shoes=0.12,
                           extras=("belt", "shoulder-band"), fabric="hessian_230", upper_slot="quilt", skirt_slot="quilt"),
    "guard-captain": dict(upper=("fore", 0.95), loose=0.028, thick=0.02, hem="thigh", legs=True, wraps=False, shoes=0.12,
                          extras=("belt", "mail", "surcoat"), fabric="hessian_230", upper_slot="quilt-secondary",
                          skirt_slot="quilt-secondary"),
    "guard-archer": dict(upper=("fore", 0.9), loose=0.022, thick=0.014, hem="thigh", legs=True, wraps=False, shoes=0.1,
                         extras=("belt", "bracer"), fabric="hessian_230", upper_slot="quilt", skirt_slot="quilt"),
    "clergy-cassock": dict(upper=("fore", 0.97), loose=0.022, hem="ankle", legs=False, shoes=0.025, cape="hooded-cape",
                           cape_slot="main", extras=("cord-belt",), fabric="caban"),
    "clerk-robe": dict(upper=("fore", 0.97), loose=0.02, hem="ankle", legs=False, shoes=0.025, extras=("belt", "pouch"),
                       fabric="poly_wool_herringbone"),
    "steward-gown": dict(upper=("fore", 0.97), loose=0.02, hem="ankle", legs=False, shoes=0.03, cape="mantle-long",
                         cape_slot="secondary", extras=("belt",), fabric="poly_wool_herringbone"),
    "healer-kirtle": dict(upper=("fore", 0.8), loose=0.014, hem="ankle", legs=False, shoes=0.025, apron="waist",
                          apron_slot="secondary", cape="shawl", cape_slot="accent", extras=("belt", "pouch"), fabric="caban"),
    "messenger-travel": dict(upper=("fore", 0.95), loose=0.016, hem="above-knee", legs=True, wraps=False, shoes=0.14,
                             cape="cloak", cape_slot="secondary", extras=("belt",), fabric="caban"),
    "mason-apron": dict(upper=("fore", 0.5), loose=0.016, hem="above-knee", legs=True, wraps=True, shoes=0.07,
                        apron="bib", apron_slot="leather", extras=("belt",), fabric="caban"),
    "child-tunic": dict(upper=("fore", 0.7), loose=0.022, hem="knee", legs=True, wraps=False, shoes=0.02,
                        extras=("cord-belt",), fabric="caban"),
    "child-dress": dict(upper=("fore", 0.7), loose=0.014, hem="calf", legs=False, shoes=0.02, apron="waist",
                        apron_slot="secondary", fabric="caban"),
    "apprentice-m": dict(upper=("fore", 0.6), loose=0.016, hem="above-knee", legs=True, wraps=False, shoes=0.03,
                         apron="small", apron_slot="leather", extras=("belt",), fabric="caban"),
    "apprentice-f": dict(upper=("fore", 0.75), loose=0.014, hem="ankle", legs=False, shoes=0.025, apron="waist",
                         apron_slot="secondary", extras=("belt",), fabric="caban"),
    "elder-m": dict(upper=("fore", 0.95), loose=0.02, hem="calf", legs=True, wraps=False, shoes=0.04, cape="cloak",
                    cape_slot="secondary", extras=("belt",), fabric="caban"),
    "elder-f": dict(upper=("fore", 0.95), loose=0.016, hem="ankle", legs=False, shoes=0.03, cape="shawl",
                    cape_slot="accent", extras=("belt",), fabric="caban"),
}
# Cut variants (art fixer, 8 November): overrides of the kit entry that change the silhouette, not only the dye. Ids match
# POPULATION_OUTFIT_KITS[].cuts in village-population.ts. Extra keys: under=(sleeve, t, slot) a long-sleeved under-tunic
# (shoulders and arms) for sleeveless jerkins and jacks; over=dict(slot, hem) a sleeveless overgown or surcoat-like layer
# with its own skirt over the gown; kilt (metres) lifts the skirt's front hem over the shift; apron None removes the apron.
JERKIN = dict(upper=None, under=("fore", 0.92, "main"), hem="thigh")
CUTS = {
    "field-tunic": {"short-tunic": {}, "long-tunic": dict(upper=("fore", 0.92), hem="below-knee", wraps=False, loose=0.024),
                    "shoulder-cape": dict(cape="cape", cape_slot="secondary"),
                    "sleeveless-jerkin": dict(JERKIN, upper_slot="leather", skirt_slot="leather", thick=0.004)},
    "field-kirtle": {"long-apron": dict(hem="ankle"), "kilted-half-apron": dict(hem="calf", kilt=0.17, apron="small"),
                     "shawl": dict(apron=None, cape="shawl", cape_slot="accent"),
                     "overgown": dict(hem="ankle", apron=None, over=dict(slot="accent", hem="calf"))},
    "workshop-apron-m": {"bib-leather": {}, "long-waist-apron": dict(upper=("fore", 0.92), hem="below-knee", apron="waist", apron_slot="linen"),
                         "sleeveless-jerkin": dict(JERKIN, upper_slot="secondary", skirt_slot="secondary", apron="small"),
                         "long-bib": dict(apron="bib-long")},
    "workshop-apron-f": {"bib-apron": {}, "half-apron": dict(upper=("fore", 0.4), apron="small"),
                         "overgown": dict(over=dict(slot="accent", hem="calf"), apron="waist"),
                         "shawl-apron": dict(hem="calf", shift_hem=True, cape="shawl", cape_slot="accent", apron="waist")},
    "market-f": {"plain-gown": {}, "overgown": dict(over=dict(slot="secondary", hem="calf")),
                 "mantle": dict(cape="mantle", cape_slot="accent"), "apron-gown": dict(apron="waist", apron_slot="secondary")},
    "guard-gambeson": {"thigh-gambeson": {}, "knee-gambeson": dict(hem="below-knee", loose=0.036),
                       "gambeson-cape": dict(hem="hip", cape="cape", cape_slot="secondary"),
                       "mail-shirt": dict(hem="thigh", extras=("belt", "shoulder-band", "mail")),
                       "jack-over-tunic": dict(JERKIN, under=("fore", 0.95, "main"), upper_slot="leather", skirt_slot="leather",
                                               thick=0.008, fabric="fabric_leather_02")},
    "guard-archer": {"jack": {}, "jack-cape": dict(cape="cape", cape_slot="secondary")},
    "healer-kirtle": {"dark-overgown": dict(over=dict(slot="dark-accent", hem="calf")),
                      "hooded-mantle": dict(apron=None, cape="cloak", cape_slot="accent"), "apron-shawl": {}},
    "mason-apron": {"standard": {}, "long-tunic": dict(upper=("fore", 0.92), hem="below-knee", wraps=False)},
    "child-tunic": {"knee-tunic": {}, "short-tunic": dict(upper=("fore", 0.4), hem="above-knee"),
                    "long-smock": dict(hem="calf", loose=0.034, upper=("fore", 0.9)),
                    "shoulder-cape": dict(cape="cape", cape_slot="secondary")},
    "child-dress": {"apron-dress": {}, "pinafore": dict(apron="bib"), "short-dress": dict(hem="knee", shift_hem=True, apron=None),
                    "shawl": dict(apron=None, cape="shawl", cape_slot="accent")},
    "apprentice-m": {"small-apron": {}, "long-tunic": dict(upper=("fore", 0.92), hem="below-knee"),
                     "sleeveless-jerkin": dict(JERKIN, upper_slot="secondary", skirt_slot="secondary")},
    "elder-m": {"cloak": {}, "shoulder-cape": dict(cape="cape", cape_slot="secondary"), "short-cloak": dict(cape="cloak-short")},
    "elder-f": {"shawl": {}, "cloak": dict(cape="cloak", cape_slot="secondary"), "shoulder-cape": dict(cape="cape", cape_slot="accent"),
                "apron": dict(cape=None, apron="waist", apron_slot="secondary")},
}


def kit_for(recipe):
    """The kit entry with the resident's cut applied (unknown cuts and 'standard' leave the kit as it is)."""
    kit_id = recipe["outfit"]["kit"]
    kit = dict(KITS[kit_id])
    cut_id = recipe["outfit"].get("cut", "standard")
    over = CUTS.get(kit_id, {}).get(cut_id)
    if over is None and cut_id not in ("standard",) and kit_id in CUTS:
        raise SystemExit(f"unknown cut {cut_id} for kit {kit_id}")
    kit.update(over or {})
    return kit


SLOT_FABRIC = {"linen": "rough_linen", "leather": "fabric_leather_02", "metal": None, "quilt": "hessian_230",
               "quilt-secondary": "hessian_230", "cord": "rough_linen"}


def _tag(obj, slot, fabric, kind):
    obj["crowd_slot"] = slot
    obj["crowd_fabric"] = fabric or ""
    obj["crowd_kind"] = kind
    obj["crownfall_part"] = "garment"
    return obj


def _hem_z(info, fr, hem):
    knee, ankle, hip = info.knee_z, info.ankle_z, info.hip_z
    return {"hip": hip - (hip - knee) * 0.2, "thigh": hip - (hip - knee) * 0.45, "below-knee": knee - (knee - ankle) * 0.25, "above-knee": knee + (hip - knee) * 0.12, "knee": knee - 0.02 * fr.scale,
            "calf": knee - (knee - ankle) * 0.55, "ankle": ankle + 0.035 * fr.scale}[hem]


_REAL = {}


def _clear_real(obj, gap):
    """Push a piece outside the real (unflattened) body as well as the garment proxy."""
    if _REAL.get("tree") is not None:
        G.push_outside(obj, (_REAL["tree"],), gap, iterations=4, reach=0.06)


def _upper(info, fr, arm, name, sleeve, z_bottom, neck_r, offset, loose, under=()):
    if sleeve is None:
        keep = O.upper_keep(info, fr, neck_r, z_bottom, upper_t=0.0)
    elif sleeve[0] == "fore":
        keep = O.upper_keep(info, fr, neck_r, z_bottom, fore_t=sleeve[1])
    else:
        keep = O.upper_keep(info, fr, neck_r, z_bottom, upper_t=sleeve[1])
    if sleeve is None:
        base = keep

        def keep(i):  # sleeveless: torso only, armholes cut at the shoulder
            p, d = info.v[i], info.dominant[i]
            if O.fam(d) in O.ARM:
                return False
            if d in ("clavicle_l", "clavicle_r") and abs(p[0]) > fr.shoulder_x * 0.85:
                return False
            return base(i)
    obj, idx = O.shell(info, name, keep, offset, smooth=14)
    if loose > 0:
        field = O.SoftHull(info, z_bottom - 0.03, fr.armpit_z + 0.02, fr.centre)
        ease = lambda z: np.interp(z, [z_bottom - 0.02, z_bottom + 0.05, fr.armpit_z - 0.03, fr.armpit_z],
                                   [loose * 0.6, loose, loose * 0.8, loose * 0.5])
        G.drape_to_hull(obj, info, idx, field, ease, fr.armpit_z - 0.01)
        O.nsmooth_compat(obj, 5, 0.4)
    for tree in under:
        G.push_outside(obj, (tree,), 0.004)
    G.push_outside(obj, (info.tree,), max(0.004, offset * 0.7))
    _clear_real(obj, max(0.004, offset * 0.6))
    G._copy_body_weights(obj, info, idx, arm)
    for loop in G.boundary_loops(obj):
        G.relax_loop(obj, loop, 12)
    return obj


def _skirt(info, fr, arm, name, z_top, z_hem, ease_top, ease_hem, flare, under=(), seed=0.0, front=0.85, back=0.25, kilt=0.0):
    rings = max(6, int(round((z_top - z_hem) / 0.06)) + 2)
    obj, rows, centre = O.skirt_tube(info, fr, name, z_top, z_hem, ease_top, ease_hem, flare=flare, folds=8, fold_amp=0.008,
                                     rings=rings, segments=32, hem_wave=0.005, seed=seed)
    if kilt > 0:
        # kilted up: the front of the skirt is drawn up into the belt, so the hem rises toward the front and the shift
        # shows below it (art fixer, 8 November); the gathered cloth stands a little off the body
        co = vertex_array(obj)
        rel = co[:, :2] - np.asarray(centre)[:2]
        r = np.linalg.norm(rel, axis=1) + 1e-9
        front_k = np.clip(-rel[:, 1] / r, 0.0, 1.0) ** 1.3
        t = np.clip((z_top - co[:, 2]) / max(1e-3, z_top - z_hem), 0.0, 1.0)
        co[:, 2] += kilt * front_k * t ** 1.6
        side_k = np.abs(rel[:, 0]) / r
        bunch = np.exp(-((t - 0.18) / 0.16) ** 2)  # the cloth drawn up into the belt bunches over the hips
        co[:, :2] += (rel / r[:, None]) * (0.25 * kilt * front_k * np.sin(np.pi * np.clip(t, 0, 1)) + 0.3 * kilt * side_k * bunch)[:, None]
        obj.data.vertices.foreach_set("co", co.ravel())
        obj.data.update()
    for tree in under:
        G.push_outside(obj, (tree,), 0.008)
    G.push_outside(obj, (info.tree,), 0.01)
    O.leg_follow_weights(info, obj, centre, z_top - 0.02, info.hip_z - 0.03, z_hem, arm, front=front, back=back,
                         calf=0.6 if z_hem < info.knee_z else 0.3)
    return obj


def _legs(info, arm, name, z_lo, z_hi, offset):
    def keep(i):
        d, p = info.dominant[i], info.v[i]
        return (O.fam(d) in ("thigh", "calf") or (d == "hips" and p[2] < z_hi)) and z_lo < p[2] < z_hi
    obj, _ = O.shell_layer(info, name, keep, offset, smooth=10, arm=arm)
    _clear_real(obj, offset * 0.8)
    return obj


def _capelet(info, fr, arm, name, kind, trees, seed, under=None, length=0.0):
    """Capes, shawls, mantles and cloaks as one capelet grid. `length` (-1..1, the resident's cut) varies long hems by up
    to 6 cm. Cloaks and mantles (art fixer, 8 November) hang from the collarbones in a rounded shoulder line (less ease
    at the shoulder, more relaxing), open at the front, with a few deep vertical fold ridges instead of a flat bell."""
    neck = info.neck_z
    s = fr.scale
    dl = 0.06 * length * s
    folds, fold_amp, relax = 6, 0.007, 16
    if kind in ("hooded-cape", "cape"):
        # to the upper arm, standing off the shoulders: a short cape widens the shoulder line from the isometric view
        z_top, hem = neck - 0.015 * s, lambda a: fr.armpit_z - (0.12 + 0.03 * math.cos(a)) * s - 0.3 * dl
        closed, flare, rings = True, 0.05, 9
    elif kind == "shawl":
        # a folded square: point at the back, short over the arms, the two ends hanging lower in front (the first batch's
        # level front hem read as a bib)
        z_top, hem = neck - 0.02 * s, lambda a: info.waist_z + (0.13 - 0.12 * max(0.0, math.cos(a)) ** 1.5 - 0.17 * max(0.0, -math.cos(a)) ** 2) * s
        closed, flare, rings = False, 0.02, 10
    elif kind == "mantle":
        z_top, hem = neck - 0.015 * s, lambda a: info.waist_z - (0.02 + 0.06 * max(0.0, -math.cos(a))) * s - 0.5 * dl
        closed, flare, rings = False, 0.04, 9
        folds, fold_amp, relax = 5, 0.012, 28
    elif kind == "mantle-long":
        z_top, hem = neck - 0.015 * s, lambda a: info.knee_z + 0.02 * s - dl
        closed, flare, rings = False, 0.05, 14
        folds, fold_amp, relax = 5, 0.016, 32
    elif kind == "cloak-short":
        z_top, hem = neck - 0.015 * s, lambda a: info.hip_z - (0.02 + 0.05 * max(0.0, -math.cos(a))) * s - 0.5 * dl
        closed, flare, rings = False, 0.04, 10
        folds, fold_amp, relax = 5, 0.013, 30
    else:  # cloak
        z_top, hem = neck - 0.015 * s, lambda a: info.knee_z - (0.06 + 0.04 * max(0.0, -math.cos(a))) * s - dl
        closed, flare, rings = False, 0.06, 15
        folds, fold_amp, relax = 5, 0.016, 32
    long_cloth = kind in ("cloak", "mantle-long", "cloak-short", "mantle")
    # less ease where the cloth lies on the shoulders, more toward the hem: the bell and the box both came from a cape
    # standing 2 cm off the shoulder corners
    gap = (lambda t: 0.012 + 0.02 * t ** 1.2) if long_cloth else (lambda t: 0.02 + 0.016 * t)
    v_gap = 0.0 if closed else (0.32 if kind == "shawl" else 0.26 if long_cloth else 0.22)
    obj, rows = O.capelet(info, fr, arm, name, z_top, hem, trees, gap, segments=28, rings=rings, flare=flare, folds=folds,
                          fold_amp=fold_amp, v_gap_top=v_gap, v_gap_min=(0.16 if kind == "shawl" else 0.09 if long_cloth else 0.05) if not closed else 0.03,
                          seed=seed, relax=relax)
    # weights: the upper part follows the torso and shoulders, the long parts the hips and legs (cloaks swing with legs)
    if kind in ("cloak", "mantle-long"):
        O.leg_follow_weights(info, obj, fr.centre, info.waist_z + 0.02, info.hip_z - 0.06, info.knee_z - 0.1, arm,
                             front=0.45, back=0.3, calf=0.4, side_arm=0.35, arm_zone=(info.hip_z - 0.05, z_top + 0.02))
    else:
        # `under` (bind to the layer beneath instead of the body) is available but not used for capes: tried on the full
        # population (7 November), it let the tunic through the cape's back hem in the idle pose; the tunic hidden under
        # the cape is removed instead (crowd_lod.remove_hidden_layers)
        # bound to the body without the arms below the shoulder caps (art fixer, 8 November): bound to the whole body, a
        # shawl's side panels followed the raised arms of carry_yoke_walk and stood out as wings
        src = under if under is not None and len(under.data.polygons) else _torso_body(info)
        b = SurfaceBinding(src)
        assign_weights(obj, b.transfer_weights(b.bind(vertex_array(obj), max_distance=0.4)), arm)
        if src is not under and src is not info.body:
            bpy.data.objects.remove(src)
    return obj


def _torso_body(info, shoulder_cap=0.35):
    """Copy of the body without the arms (faces whose vertices are all dominated by arm bones, except the top of each
    upper arm), carrying the body's vertex groups, for binding capes and shawls."""
    arm_v = np.array([O.fam(d) in O.ARM and not (O.fam(d) == "upperarm" and info.limb_t(i, d) < shoulder_cap)
                      for i, d in enumerate(info.dominant)])
    dup = info.body.copy()
    dup.data = info.body.data.copy()
    dup.name = dup.data.name = "TorsoBind"
    bpy.context.scene.collection.objects.link(dup)
    delete_faces(dup, [p.index for p in dup.data.polygons if all(arm_v[v] for v in p.vertices)])
    if len(dup.data.polygons) == 0:
        bpy.data.objects.remove(dup)
        return info.body
    return dup


def _hood(info, fr, arm, name, offset=0.028):
    """Hood over the head with an oval face opening, ending in a collar that the hooded cape covers."""
    eye = fr.eye
    s = fr.scale
    face_c = eye + np.array([0.0, 0.0, -0.03 * s])
    collar_z = info.neck_z - 0.05 * s

    def keep(i):
        p, d = info.v[i], info.dominant[i]
        if d in ("head", "neck", "face_jaw") or d.startswith("face_"):
            rel = p - face_c
            if p[1] < eye[1] + 0.035 and (rel[0] / (0.08 * s)) ** 2 + (rel[2] / (0.1 * s)) ** 2 < 1.0:
                return False
            return True
        if d in G.TORSO_BONES:
            return p[2] > collar_z
        return False
    hood, idx = O.shell(info, name, keep, offset, smooth=20)
    co = vertex_array(hood)
    head0, head1 = np.array(info.bones["head"][0]), np.array(info.bones["head"][1])
    peak = head1 + np.array([0.0, 0.07, -0.02]) * s
    for k, p in enumerate(co):
        dsq = np.sum((p - peak) ** 2)
        co[k] += (p - head0) / (np.linalg.norm(p - head0) + 1e-9) * 0.025 * math.exp(-dsq / (2 * 0.05 ** 2))
    hood.data.vertices.foreach_set("co", co.ravel())
    hood.data.update()
    G._smooth(hood, 24, 0.5)
    G.push_outside(hood, (info.tree,), 0.02)
    G._copy_body_weights(hood, info, idx, arm)
    for loop in G.boundary_loops(hood):
        G.relax_loop(hood, loop, 14)
    return hood


def _apron(info, fr, arm, name, kind, under_tree):
    s = fr.scale
    if kind in ("bib", "bib-long"):
        z_top, widths = info.chest_z + 0.06 * s, [0.2 * s, 0.36 * s, 0.46 * s]
        z_bottom = info.knee_z - 0.06 * s if kind == "bib" else info.ankle_z + (info.knee_z - info.ankle_z) * 0.35
    elif kind == "small":
        z_top, widths = info.waist_z + 0.01, [0.26 * s, 0.3 * s, 0.34 * s]
        z_bottom = info.hip_z - (info.hip_z - info.knee_z) * 0.55
    else:
        z_top, widths = info.waist_z + 0.01, [0.3 * s, 0.38 * s, 0.46 * s]
        z_bottom = info.knee_z - (info.knee_z - info.ankle_z) * 0.45
    return G.apron_panel(info, arm, name, z_top, z_bottom, widths, cols=6, rows=14, standoff=0.024, under_tree=under_tree)


def _rebind_to_layers(obj, layers, arm):
    """Weight a front panel like the nearest point of the layers beneath it (population generator, 7 November): the apron
    weighted from the body slid off the gown in stooping loops (hoe, dig, herd), so gown and apron showed through each
    other in patches; weighted from the gown, both deform alike."""
    from mathutils import Vector
    from scene import _barycentric
    binds = [SurfaceBinding(o) for o in layers if o is not None and len(o.data.polygons)]
    if not binds:
        return
    weights = []
    for p in vertex_array(obj):
        best = None
        for b in binds:
            hit = b.tree.find_nearest(Vector(p), 0.5)
            if hit[0] is not None and (best is None or hit[3] < best[0]):
                best = (hit[3], b, hit)
        if best is None:
            return  # far from every layer: keep the panel's own weights
        _d, b, (loc, _n, tri, _dist) = best
        a, bb, c = (b.verts[i] for i in b.tris[tri])
        weights.append(b.transfer_weights([(tri, _barycentric(np.asarray(loc), a, bb, c))])[0])
    assign_weights(obj, weights, arm)


def _arm_band(info, arm, name, side, t, width):
    return G.limb_roll(info, arm, name, f"upperarm_{side}", t, width, 0.012, segments=12, rings=4)


def _fore_band(info, arm, name, side, t):
    return G.limb_roll(info, arm, name, f"forearm_{side}", t, 0.018, 0.008, segments=12, rings=4)


def build(body, arm, recipe, report):
    """Generate the kit's garments on the body; delete covered skin. Returns {name: object}."""
    kit_id = recipe["outfit"]["kit"]
    kit = kit_for(recipe)
    female = recipe["sex"] == "female"
    # little bust flattening: crowd cloth follows the real body closely (a membrane over the bust left skin outside it)
    proxy = O.garment_proxy(body, arm, flatten=10, membrane=0.2)
    info = G.BodyInfo(proxy, arm)
    fr = O.Frame(info, arm)
    pieces = {}
    _REAL["tree"] = G.BodyInfo(body, arm).tree
    s = fr.scale
    seed = (recipe.get("seed", 0) % 97) * 0.13
    waist = info.waist_z
    belt_z = waist + 0.005
    neck_r = 0.06 * s if not female else 0.065 * s
    fabric = kit.get("fabric", "caban")
    upper_slot = kit.get("upper_slot", "main")
    skirt_slot = kit.get("skirt_slot", upper_slot)
    thick = kit.get("thick", 0.0)
    hem_kind = kit.get("hem_f", kit["hem"]) if female else kit["hem"]
    hem = _hem_z(info, fr, hem_kind)
    # per-resident cut (population generator, 7 November): residents of one kit shared one silhouette (rest-pose overlap
    # 0.88 median inside a kit), so the cut varies deterministically from the resident's seed: hem 4 cm either way (long
    # hems only shorter), body ease 0.8 to 1.45 times the kit's, sleeves 12 percent of the forearm either way, skirt flare
    rng = np.random.default_rng((int(recipe.get("seed", 0)) * 2654435761) % (2 ** 32))
    cut = {"hem": float(rng.uniform(-1.0, 1.0)), "ease": float(rng.uniform(0.8, 1.45)), "sleeve": float(rng.uniform(-1.0, 1.0)),
           "flare": float(rng.uniform(0.6, 1.6))}
    hem += (abs(cut["hem"]) * 0.03 if hem_kind == "ankle" else cut["hem"] * 0.04) * s
    report.setdefault("crowdOutfit", {})["cut"] = {k: round(v, 3) for k, v in cut.items()}
    # visible linen underlayer: cuffs below short sleeves, the collar
    sleeve = kit["upper"]
    if sleeve and sleeve[0] == "fore":
        sleeve = ("fore", float(np.clip(sleeve[1] + 0.12 * cut["sleeve"], 0.3, 0.97)))
    if sleeve and sleeve[0] == "fore" and sleeve[1] < 0.85:
        shirt = _upper(info, fr, arm, "Shirt", ("fore", min(0.94, sleeve[1] + 0.35)), fr.armpit_z - 0.02, neck_r - 0.012,
                       0.004, 0.0)
        pieces["Shirt"] = _tag(shirt, "linen", "rough_linen", "shirt")
    if kit.get("under") and sleeve is None:
        # long-sleeved under-tunic for a sleeveless jerkin or jack: shoulders and arms (the jerkin covers the torso)
        u_sleeve, u_t, u_slot = kit["under"]
        under_t = _upper(info, fr, arm, "Under", (u_sleeve, float(np.clip(u_t + 0.05 * cut["sleeve"], 0.6, 0.97))),
                         fr.armpit_z - 0.05, neck_r - 0.006, 0.005, 0.0)
        pieces["Under"] = _tag(under_t, u_slot, SLOT_FABRIC.get(u_slot, fabric), "shirt")
    legs = None
    if kit.get("legs"):
        legs = _legs(info, arm, "Hose", info.ankle_z + 0.02, waist - 0.02, 0.0045)
        pieces["Hose"] = _tag(legs, "secondary", "caban", "hose")
    under = [G.tree_of(list(pieces.values()))] if pieces else []
    upper = _upper(info, fr, arm, "Upper", sleeve, belt_z - 0.03, neck_r, 0.009 + thick, kit.get("loose", 0.016) * cut["ease"], under)
    pieces["Upper"] = _tag(upper, upper_slot, SLOT_FABRIC.get(upper_slot, fabric), "upper")
    skirt_under = [G.tree_of([legs])] if legs is not None else []
    if kit.get("shift_hem"):
        # a narrow shift: it shows from the knee down under kilted and short skirts and read as a white bulb when eased
        shift = _skirt(info, fr, arm, "ShiftHem", belt_z + 0.01, info.ankle_z + 0.04 * s, 0.01, 0.016, 0.004, skirt_under, seed)
        pieces["ShiftHem"] = _tag(shift, "linen", "rough_linen", "skirt")
        skirt_under = [G.tree_of([shift])]
    long_skirt = hem < info.knee_z - 0.1
    skirt = _skirt(info, fr, arm, "Skirt", belt_z + 0.01, hem, 0.012 + thick, (0.04 if long_skirt else 0.03) * cut["ease"] + thick,
                   (0.05 if long_skirt else 0.02) * cut["flare"], skirt_under, seed + 1.0, kilt=kit.get("kilt", 0.0) * s)
    pieces["Skirt"] = _tag(skirt, skirt_slot, SLOT_FABRIC.get(skirt_slot, fabric), "skirt")
    outer = G.tree_of([upper, skirt])
    extras = kit.get("extras", ())
    if "mail" in extras:
        mail = _upper(info, fr, arm, "Mail", ("upper", 0.85), belt_z - 0.03, neck_r + 0.005, 0.009 + thick + 0.012, 0.0,
                      [G.tree_of([upper])])
        pieces["Mail"] = _tag(mail, "mail", None, "upper")
        mskirt = _skirt(info, fr, arm, "MailSkirt", belt_z + 0.01, info.hip_z - 0.05 * s, 0.02 + thick + 0.012, 0.034 + thick + 0.012,
                        0.01, [G.tree_of([skirt])], seed + 2.0)
        pieces["MailSkirt"] = _tag(mskirt, "mail", None, "skirt")
        outer = G.tree_of([mail, mskirt, skirt])
    if "surcoat" in extras:
        sc = _upper(info, fr, arm, "Surcoat", None, belt_z - 0.03, neck_r + 0.01, 0.009 + thick + 0.022, 0.0, [outer])
        pieces["Surcoat"] = _tag(sc, "main", "caban", "upper")
        sskirt = _skirt(info, fr, arm, "SurcoatSkirt", belt_z + 0.01, info.knee_z - 0.04 * s, 0.03 + thick + 0.02,
                        0.05 + thick + 0.02, 0.03, [outer], seed + 3.0)
        pieces["SurcoatSkirt"] = _tag(sskirt, "main", "caban", "skirt")
        outer = G.tree_of([sc, sskirt])
    over = kit.get("over")
    if over:
        # sleeveless overgown (or a dyed over-layer) with its own shorter skirt: the gown shows below it and at the
        # sleeves, a second tier from the isometric view (art fixer, 8 November)
        o_hem = _hem_z(info, fr, over["hem"]) + cut["hem"] * 0.03 * s
        ov = _upper(info, fr, arm, "Over", None, belt_z - 0.03, neck_r + 0.012, 0.009 + thick + 0.016, 0.0, [outer])
        pieces["Over"] = _tag(ov, over["slot"], fabric, "upper")
        # flared well clear of the gown so the two tiers read apart in silhouette, not only in colour
        oskirt = _skirt(info, fr, arm, "OverSkirt", belt_z + 0.01, o_hem, 0.022 + thick, 0.065 * cut["ease"] + thick,
                        0.1 + 0.03 * cut["flare"], [outer], seed + 4.0)
        pieces["OverSkirt"] = _tag(oskirt, over["slot"], fabric, "skirt")
        outer = G.tree_of([ov, oskirt, skirt])
    if kit.get("wraps"):
        wraps = _legs(info, arm, "Wraps", info.ankle_z + 0.01, info.knee_z - 0.04 * s, 0.009)
        if legs is not None:
            G.push_outside(wraps, (G.tree_of([legs]),), 0.004)
        pieces["Wraps"] = _tag(wraps, "wraps", "caban", "wraps")
    apron_kind = kit.get("apron_f") if female and kit.get("apron_f") else kit.get("apron")
    if apron_kind:
        ap = _apron(info, fr, arm, "Apron", apron_kind, outer)
        _rebind_to_layers(ap, [pieces.get("OverSkirt") or pieces.get("Skirt"), pieces.get("Over") or pieces.get("Upper")], arm)
        pieces["Apron"] = _tag(ap, kit.get("apron_slot", "secondary"), SLOT_FABRIC.get(kit.get("apron_slot"), "rough_linen"), "apron")
    belt_tree = G.tree_of([p for k, p in pieces.items() if k in ("Upper", "Skirt", "Apron", "Surcoat", "SurcoatSkirt", "Mail", "MailSkirt", "Over", "OverSkirt")])
    if "belt" in extras or "cord-belt" in extras:
        cord = "cord-belt" in extras
        b = G.band(info, arm, "Belt", belt_z, 0.012 if cord else 0.03 * s, 0.03 + thick, segments=24, under=belt_tree)
        pieces["Belt"] = _tag(b, "accent" if cord else "leather", "rough_linen" if cord else "fabric_leather_02", "belt")
    if "pouch" in extras:
        p = G.pouch(info, arm, "Pouch", side=-1)
        pieces["Pouch"] = _tag(p, "leather", "fabric_leather_02", "pouch")
    # bands are painted by the texture stage (rest-pose slabs across the sleeve), not modelled: rings read as bracelets
    marks = []
    if "sleeve-band" in extras:
        marks += [{"bone": f"upperarm_{sd}", "t": [0.38, 0.5], "slot": "accent"} for sd in ("l", "r")]
    if "shoulder-band" in extras:
        marks += [{"bone": "upperarm_l", "t": [0.16, 0.3], "slot": "accent"}]
    if "cuffs" in extras:
        marks += [{"bone": f"forearm_{sd}", "t": [0.8, 0.97], "slot": "accent"} for sd in ("l", "r")]
    if "bracer" in extras:
        marks += [{"bone": "forearm_l", "t": [0.55, 0.85], "slot": "leather"}]
    upper["crowd_marks"] = __import__("json").dumps(
        [dict(m, head=[float(x) for x in info.bones[m["bone"]][0]], tail=[float(x) for x in info.bones[m["bone"]][1]]) for m in marks])
    cape = kit.get("cape")
    cape_slot = kit.get("cape_slot", "main")
    if recipe.get("headwear") == "hood" and not cape:
        cape, cape_slot = "hooded-cape", ("main" if kit_id == "guard-archer" else "secondary")
    if cape:
        torso_pieces = [p for k, p in pieces.items() if k in ("Skirt", "SurcoatSkirt", "MailSkirt", "Apron", "ShiftHem", "OverSkirt")]
        trees = [O.torso_tree(info)] + ([G.tree_of(torso_pieces)] if torso_pieces else [])
        if recipe.get("headwear") == "hood":  # any cape can carry the hood (the messenger's hooded travel cloak)
            hood = _hood(info, fr, arm, "Hood")
            pieces["Hood"] = _tag(hood, cape_slot, fabric, "hood")
            trees.append(G.tree_of([hood]))
        cp = _capelet(info, fr, arm, "Cape", "cape" if cape == "hooded-cape" else cape, trees, seed, length=cut["hem"])
        pieces["Cape"] = _tag(cp, cape_slot, fabric, "cape")
    # inner layers keep only what can show: the shirt at the cuffs and collar, hose below the skirt
    import crowd_lod
    culled = {}
    # legs are always clothed (hose under the tunic, or a skirt to the calf or ankle): their skin goes, so a stride never
    # pushes skin through cloth; hose stays whole under short skirts because the legs move under them
    body["crowd_cover_legs"] = bool(kit.get("legs")) or hem_kind in ("calf", "ankle")
    for name in ("Shirt", "ShiftHem"):
        if name in pieces:
            outer = [p for k, p in pieces.items() if k in crowd_lod.OUTER_ORDER and k != "Belt"]
            if outer:
                culled[name] = crowd_lod._delete_covered_faces(pieces[name], outer, margin=0.03)
                # the cut follows faces and leaves teeth: relax it into a smooth line so no triangle points out below a hem
                # (the dark "tears" at tunic and kirtle hems; art fixer, 8 November)
                for loop in G.boundary_loops(pieces[name]):
                    G.relax_loop(pieces[name], loop, 10)
    for k in [k for k, p in pieces.items() if len(p.data.polygons) == 0]:
        bpy.data.objects.remove(pieces.pop(k))
    report["innerFacesCulled"] = culled
    sh_top = info.ankle_z + kit.get("shoes", 0.03) * s

    def feet(i):
        d = info.dominant[i]
        return O.fam(d) in ("foot", "toes") or (info.v[i][2] < sh_top + 0.01 and O.fam(d) == "calf")
    shoes = G.shoe_hulls(info, arm, "Shoes", feet, sh_top, {"allowance": 0.007, "voxel": 0.014, "topAboveAnkle": kit.get("shoes", 0.03)})
    pieces["Shoes"] = _tag(shoes, "leather", "fabric_leather_02", "shoes")
    bpy.data.objects.remove(proxy)
    body["crowd_full_mesh"] = body.data.copy().name  # intact skin for the hair stage (landmarks need the whole body)
    info_body = G.BodyInfo(body, arm)
    removed = delete_covered_skin(body, info_body, [p for p in pieces.values()], report)
    report["crowdOutfit"] = {**report.get("crowdOutfit", {}), "kit": kit_id, "pieces": {k: triangle_count(v) for k, v in pieces.items()},
                             "skinTrianglesRemoved": removed}
    return pieces


def _piece_tree(garments, edge_ok=None):
    """BVH over all pieces with a face -> piece map, plus each piece's boundary points (KD tree; with `edge_ok(point,
    piece_index)` only the boundary points it accepts)."""
    from mathutils.bvhtree import BVHTree
    from mathutils.kdtree import KDTree
    verts, tris, owner, base = [], [], [], 0
    edges = []
    for k, g in enumerate(garments):
        dg = bpy.context.evaluated_depsgraph_get()
        me = g.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        verts.extend(tuple(v.co) for v in me.vertices)
        for t in me.loop_triangles:
            tris.append(tuple(base + i for i in t.vertices))
            owner.append(k)
        base += len(me.vertices)
        g.evaluated_get(dg).to_mesh_clear()
        co = vertex_array(g)
        pts = [co[i] for loop in G.boundary_loops(g) for i in loop]
        if edge_ok is not None:
            pts = [p for p in pts if edge_ok(p, k)]
        kd = None
        if pts:
            kd = KDTree(len(pts))
            for j, p in enumerate(pts):
                kd.insert(p, j)
            kd.balance()
        edges.append(kd)
    return BVHTree.FromPolygons(verts, tris, all_triangles=True), owner, edges


def delete_covered_skin(body, info, garments, report, reach=0.09, margin=0.035, inward=0.035, cover_legs=None):
    """Delete body faces whose vertices are all hidden under garments: a ray along the vertex normal and two tilted
    rays hit cloth within `reach` (or cloth lies just behind skin that pokes out through it), and the vertex is more
    than `margin` from the edge of the piece it is under (so bending joints never open a hole at a hem; the edge of an
    outer piece lying over another piece does not count). The head and the hands are never deleted."""
    tree, owner, edges = _piece_tree(garments)
    if cover_legs is None:
        cover_legs = bool(body.get("crowd_cover_legs", False))
    v, n = info.v, info.n
    covered = np.zeros(len(v), dtype=bool)
    for i in range(len(v)):
        d = info.dominant[i]
        f = O.fam(d)
        if d in ("head", "face_jaw") or d.startswith("face_") or f in O.FINGERS or f == "hand":
            continue
        # every kit's upper garment covers the torso below the collar and the upper arms (sleeves reach at least the
        # forearm): that skin goes whatever the rays say (thin bodies let tilted rays slip past close cloth)
        if (d in G.TORSO_BONES and d != "neck" and info.hip_z - 0.02 < v[i][2] < info.neck_z - 0.045) or \
                (f == "upperarm" and info.limb_t(i, d) < 0.85) or \
                (cover_legs and (f == "thigh" or (f == "calf" and v[i][2] > info.ankle_z + 0.05) or (d == "hips" and v[i][2] < info.hip_z))):
            covered[i] = True
            continue
        p = Vector(v[i])
        nn = Vector(n[i])
        if nn.length < 1e-6:
            continue
        side = nn.cross(Vector((0, 0, 1)))
        if side.length < 1e-3:
            side = nn.cross(Vector((1, 0, 0)))
        side.normalize()
        up = nn.cross(side)
        hits, first = 0, None
        for dvec in (nn, (nn + side * 0.5).normalized(), (nn - up * 0.5).normalized()):
            h = tree.ray_cast(p + nn * 0.0015, dvec, reach)
            if h[0] is None:  # skin poking out through a shell: cloth just behind it
                h = tree.ray_cast(p - nn * 0.0015, -dvec, inward)
            if h[0] is not None:
                hits += 1
                if first is None:
                    first = owner[h[2]]
        if hits < 3:
            continue
        kd = edges[first]
        if kd is not None:
            _co, _idx, dist = kd.find(v[i])
            if dist is not None and dist < margin:
                continue
        covered[i] = True
    faces = [poly.index for poly in body.data.polygons if all(covered[k] for k in poly.vertices)]
    before = triangle_count(body)
    delete_faces(body, faces)
    return before - triangle_count(body)

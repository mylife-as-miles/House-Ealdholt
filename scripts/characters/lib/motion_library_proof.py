"""Reuse proof for the crowd clip libraries (original Crownfall code, motion builder; evidence only, nothing published).

Exports test bodies bound to an archetype's reference skeleton, the way crowd residents are built (EALDHOLT_POPULATION_ART
section 4): a population resident's own MakeHuman macro shapes the CC0 base mesh, the best uniform scale s of its joints
against the reference is measured (crowd_skeleton.fit_scale), the shaped mesh is scaled by 1/s about the ground point and
skinned to the reference skeleton with the base-mesh weights. At runtime placement.scale = s restores the stature.
The bare foot gets a thin sole (the archetype's shoe lift) so planted feet can be judged on the mesh. The GLBs (no
clips) go to the evidence folder for scripts/characters/review/clip-library-proof.mjs, which plays the published
library clips on them.
"""
import json
import os

import bpy
import numpy as np
from mathutils import Vector

import crowd_skeleton as cs
from scene import to_blender_array


def _foot_mask(obj):
    gi = {g.name: g.index for g in obj.vertex_groups}
    ids = {gi[n] for n in ("foot_l", "foot_r", "toes_l", "toes_r") if n in gi}
    mask = np.zeros(len(obj.data.vertices), dtype=bool)
    for v in obj.data.vertices:
        if sum(g.weight for g in v.groups if g.group in ids) >= 0.5:
            mask[v.index] = True
    return mask


def _sole(co, mask, lift):
    """Thicken the bare sole by `lift` (vertices near the bottom of the foot move down, fading over 3 cm)."""
    zmin = co[mask, 2].min()
    w = np.clip(1.0 - (co[:, 2] - zmin) / 0.03, 0.0, 1.0) * mask
    co[:, 2] -= lift * w
    return co


def resident_body(src, L, macro, name):
    """A copy of the reference Body reshaped to a resident's macro, fitted by 1/s to the reference joints."""
    arch = L.archetype
    ref_recipe = cs.reference_recipe(arch)
    ref_coords, _uv, _f, groups = cs.shaped(src, ref_recipe)
    ref_j = cs.joint_points(src, ref_coords, groups)
    recipe = dict(ref_recipe, macro=dict(macro))
    coords, _uv, _f, groups = cs.shaped(src, recipe)
    res_j = cs.joint_points(src, coords, groups)
    s, resid = cs.fit_scale(ref_j, res_j)
    fitted = cs.scale_coords(coords, cs.ground_point(ref_j), s)
    obj = L.body.copy()
    obj.data = L.body.data.copy()
    obj.name = name
    bpy.context.scene.collection.objects.link(obj)
    body_ids = list(L.body["mh_body_ids"])
    co = to_blender_array(fitted[body_ids])
    co = _sole(np.array(co, dtype=np.float64), _foot_mask(obj), cs.SOLE_LIFT[arch])
    obj.data.vertices.foreach_set("co", co.ravel())
    obj.data.update()
    stature = float(co[:, 2].max() - co[:, 2].min()) * s
    return obj, {"placementScale": round(s, 4), "residualCm": resid, "statureCm": round(stature * 100, 1)}


def reference_body(L):
    obj = L.body.copy()
    obj.data = L.body.data.copy()
    obj.name = "RefBody"
    bpy.context.scene.collection.objects.link(obj)
    co = np.zeros(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get("co", co)
    co = _sole(co.reshape(-1, 3), _foot_mask(obj), cs.SOLE_LIFT[L.archetype])
    obj.data.vertices.foreach_set("co", co.ravel())
    obj.data.update()
    return obj


def export_body(L, obj, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in (L.arm, obj):
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = L.arm
    saved = obj.name
    obj.name = "Body"  # every test body exports its mesh as Body
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_animations=False,
                              export_morph=False, export_skins=True, export_def_bones=False, export_yup=True,
                              export_apply=False, export_extras=False, export_cameras=False, export_lights=False,
                              export_rest_position_armature=True, export_reset_pose_bones=True)
    obj.name = saved


def export_test_bodies(src, L, pop_path, out_dir, count=4):
    """Reference body plus the archetype's residents with the smallest and largest placement scale and the lightest and
    heaviest build (as many as exist, up to `count`)."""
    os.makedirs(out_dir, exist_ok=True)
    pop = json.load(open(pop_path))
    rows = [r for r in pop["residents"] if r["archetype"] == L.archetype and r["kind"] == "crowd"]
    L.body.name = "ReferenceSource"
    fits = []
    for r in rows:
        coords, _uv, _f, groups = cs.shaped(src, dict(cs.reference_recipe(L.archetype), macro=dict(r["macro"])))
        ref_c, _u, _ff, g0 = cs.shaped(src, cs.reference_recipe(L.archetype))
        s, resid = cs.fit_scale(cs.joint_points(src, ref_c, g0), cs.joint_points(src, coords, groups))
        fits.append((s, r["macro"]["weight"] + r["macro"]["muscle"], r, resid))
    picks = []
    if fits:
        by_s = sorted(fits, key=lambda x: x[0])
        by_w = sorted(fits, key=lambda x: x[1])
        for cand in (by_s[0], by_s[-1], by_w[-1], by_w[0]):
            if cand[2]["id"] not in [p[2]["id"] for p in picks]:
                picks.append(cand)
    picks = picks[:count]
    index = {"archetype": L.archetype, "bodies": {}, "allResidents": [
        {"id": f[2]["id"], "placementScale": round(f[0], 4), "residualCm": f[3]} for f in fits]}
    ref = reference_body(L)
    p = os.path.join(out_dir, f"{L.archetype}-reference.glb")
    export_body(L, ref, p)
    index["bodies"]["reference"] = {"file": os.path.basename(p), "placementScale": 1.0, "statureCm": L.info["statureCm"]}
    for s, _w, r, _res in picks:
        obj, info = resident_body(src, L, r["macro"], "Test_" + r["id"])
        p = os.path.join(out_dir, f"{L.archetype}-{r['id']}.glb")
        export_body(L, obj, p)
        index["bodies"][r["id"]] = {"file": os.path.basename(p), "role": r["role"], **info,
                                    "macro": {k: r["macro"][k] for k in ("ageYears", "muscle", "weight", "height")}}
        bpy.data.objects.remove(obj)
    bpy.data.objects.remove(ref)
    L.body.name = "Body"
    with open(os.path.join(out_dir, f"{L.archetype}-bodies.json"), "w") as f:
        json.dump(index, f, indent=1)
    return index

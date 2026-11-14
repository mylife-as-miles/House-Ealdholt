"""Stage 1: shaped MakeHuman body, renamed face-joint rig, weights, face morphs and fitted parts.

Original Crownfall code reading CC0 MakeHuman data (see mh.py). Produces Blender
objects: Rig (armature), Body (skin), Eyes, Teeth, Tongue, Eyelashes.
"""
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector

import mh
from scene import (SurfaceBinding, assign_weights, new_mesh, to_blender, to_blender_array,
                   triangle_count, vertex_array)

# Neutral Crownfall bone names for the CC0 MakeHuman 64-bone rig. The source
# names are only MakeHuman's naming convention; no third-party asset is used.
_SIDES = {"Left": "l", "Right": "r"}
_FINGERS = {"Thumb": "thumb", "Index": "index", "Middle": "middle", "Ring": "ring", "Pinky": "pinky"}
_BODY = {"Root": "root", "Hips": "hips", "Spine": "spine_01", "Spine1": "spine_02", "Spine2": "spine_03",
         "Neck": "neck", "Head": "head", "Jaw": "face_jaw"}
_LIMB = {"Shoulder": "clavicle", "Arm": "upperarm", "ForeArm": "forearm", "Hand": "hand", "UpLeg": "thigh",
         "Leg": "calf", "Foot": "foot", "ToeBase": "toes", "Eye": "face_eye",
         "OrbicularisTop": "face_lid_upper", "OrbicularisBottom": "face_lid_lower"}
# Soft-tissue bones are folded into their parents; their slots carry the shared skirt bones.
REMOVED_SOURCE_BONES = ("LeftBreast", "RightBreast", "LeftButtock", "RightButtock")
SKIRT_BONES = ("skirt_front", "skirt_back", "skirt_l", "skirt_r")
FACE_JOINTS = ("face_jaw", "face_eye_l", "face_eye_r", "face_lid_upper_l", "face_lid_upper_r",
               "face_lid_lower_l", "face_lid_lower_r")


def crownfall_bone_name(source):
    name = source.split(":", 1)[-1]
    if name in _BODY:
        return _BODY[name]
    for side, s in _SIDES.items():
        if name.startswith(side):
            rest = name[len(side):]
            if rest in _LIMB:
                return f"{_LIMB[rest]}_{s}"
            if rest.startswith("Hand"):
                finger = rest[4:]
                for key, label in _FINGERS.items():
                    if finger.startswith(key):
                        return f"{label}_{int(finger[len(key):]):02d}_{s}"
    raise KeyError(f"No Crownfall name for rig bone {source}")


def shape_coordinates(src, recipe, report):
    data = src["mpfbData"]
    verts, uvs, faces = mh.load_obj(os.path.join(data, "3dobjs", "base.obj"))
    coords = verts.copy()
    warnings = report.setdefault("warnings", [])
    report["macroTargets"] = mh.apply_targets(coords, mh.macro_targets(data, recipe["macro"]), data, warnings)
    detail = [(os.path.join(data, "targets", t + ".target.gz"), w) for t, w in recipe["detailTargets"].items()]
    report["detailTargets"] = mh.apply_targets(coords, detail, data, warnings)
    groups = {}
    for vi, _ti, g in faces:
        groups.setdefault(g, set()).update(vi)
    body_ids = sorted(groups["body"])
    lift = recipe.get("soleThicknessMetres", 0.0) * 10.0  # decimetres
    coords[:, 1] -= coords[body_ids, 1].min() - lift
    return coords, uvs, faces, groups


def build_body_mesh(coords, uvs, faces):
    body_faces = [(vi, ti) for vi, ti, g in faces if g == "body"]
    body_ids = sorted({i for vi, _ in body_faces for i in vi})
    remap = {old: new for new, old in enumerate(body_ids)}
    obj = new_mesh("Body", to_blender_array(coords[body_ids]),
                   [[remap[i] for i in vi] for vi, _ in body_faces], uvs, [ti for _, ti in body_faces])
    obj["mh_body_ids"] = body_ids
    return obj, body_ids, remap


def _rig_point(spec, coords, groups, warnings):
    strategy = spec["strategy"]
    if strategy == "CUBE":
        idx = groups.get(spec["cube_name"])
        if not idx:
            warnings.append("missing joint cube " + spec["cube_name"])
            return Vector(spec["default_position"])
        return Vector(to_blender(coords[sorted(idx)].mean(axis=0)))
    if strategy == "VERTEX":
        return Vector(to_blender(coords[spec["vertex_index"]]))
    if strategy == "MEAN":
        return Vector(to_blender(coords[spec["vertex_indices"]].mean(axis=0)))
    raise ValueError(strategy)


def build_rig(src, recipe, coords, groups, report):
    rig_json, weights_json = mh.load_rig(src["mpfbData"], recipe["rig"])
    warnings = report.setdefault("warnings", [])
    arm_data = bpy.data.armatures.new("Rig")
    arm = bpy.data.objects.new("Rig", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    ebones = {}
    removed = {k for k in rig_json if k.split(":", 1)[-1] in REMOVED_SOURCE_BONES}
    for source, spec in rig_json.items():
        if source in removed:
            continue
        eb = arm_data.edit_bones.new(crownfall_bone_name(source))
        eb.head = _rig_point(spec["head"], coords, groups, warnings)
        eb.tail = _rig_point(spec["tail"], coords, groups, warnings)
        if (eb.tail - eb.head).length < 1e-4:
            eb.tail = eb.head + Vector((0, 0, 0.01))
        eb.roll = spec.get("roll", 0.0)
        ebones[source] = eb
    for source, spec in rig_json.items():
        if source in removed or not spec.get("parent"):
            continue
        ebones[source].parent = ebones[spec["parent"]]
        ebones[source].use_connect = bool(spec.get("use_connect"))
    # Face joints get explicit frames: local X points to the character's left (+X), so
    # rotation about local X pitches (eyes look down, upper lid closes, jaw opens) and
    # rotation about local Z yaws the eyes toward the character's right.
    for name in FACE_JOINTS:
        eb = arm_data.edit_bones[name]
        direction = (eb.tail - eb.head).normalized()
        eb.align_roll(Vector((1.0, 0.0, 0.0)).cross(direction))
    # Shared skirt bones hang from the hips at the widest hip ring.
    hips = arm_data.edit_bones["hips"]
    thigh_l, thigh_r = arm_data.edit_bones["thigh_l"], arm_data.edit_bones["thigh_r"]
    hip_z = (thigh_l.head.z + thigh_r.head.z) * 0.5 + 0.02
    body = coords[sorted(groups["body"])]
    ring = to_blender_array(body[np.abs(body[:, 1] * 0.1 - hip_z) < 0.015])
    # hands hang at hip height in the rest pose of short residents: keep the pelvis ring only
    pelvis_half = abs(thigh_l.head.x - thigh_r.head.x) * 1.3
    ring = ring[np.abs(ring[:, 0]) < pelvis_half * 1.0 + 0.06]
    front, back = ring[:, 1].min(), ring[:, 1].max()
    left, right = ring[:, 0].max(), ring[:, 0].min()
    length = recipe.get("skirtBoneLength", 0.32)
    # Skirt frames: local X to the character's left, local Y down, local Z backward; rotation
    # about X swings the skirt backward (positive) or forward, about Z swings it sideways.
    for name, head in (("skirt_front", (0.0, front, hip_z)), ("skirt_back", (0.0, back, hip_z)),
                       ("skirt_l", (left, 0.0, hip_z)), ("skirt_r", (right, 0.0, hip_z))):
        eb = arm_data.edit_bones.new(name)
        eb.head = Vector(head)
        eb.tail = Vector((head[0], head[1], hip_z - length))
        eb.align_roll(Vector((0.0, 1.0, 0.0)))
        eb.parent = hips
    bpy.ops.object.mode_set(mode="OBJECT")
    for bone in arm.data.bones:
        bone.use_deform = bone.name != "root"
    report["bones"] = len(arm.data.bones)
    report["faceJoints"] = [b for b in FACE_JOINTS if b in arm.data.bones]

    # Per base-mesh-vertex weights with removed bones folded into their parents.
    parent_of = {k: v.get("parent", "") for k, v in rig_json.items()}
    per_vertex = {}
    for source, entries in weights_json["weights"].items():
        target = source
        while target in removed:
            target = parent_of[target]
        name = crownfall_bone_name(target)
        if name == "root":
            name = "hips"
        for index, weight in entries:
            slot = per_vertex.setdefault(index, {})
            slot[name] = slot.get(name, 0.0) + weight
    return arm, per_vertex


def load_face_targets(src, recipe):
    packs = {"faceunits01": ("faceunits", recipe["faceMorphs"]["arkit"]),
             "visemes02": ("visemes", recipe["faceMorphs"]["visemes"])}
    out = []
    for pack, (subdir, names) in packs.items():
        folder = os.path.join(src["facePacks"][pack], "targets", subdir)
        for name in names:
            idx, delta = mh.load_target(os.path.join(folder, name + ".target"))
            if len(idx):
                out.append((name, idx, delta))
    return out


def add_body_morphs(body, coords, body_ids, face_targets):
    position = {old: new for new, old in enumerate(body_ids)}
    body.shape_key_add(name="Basis", from_mix=False)
    base = to_blender_array(coords[body_ids])
    for name, idx, delta in face_targets:
        moved = coords.copy()
        np.add.at(moved, idx, delta)
        sk = body.shape_key_add(name=name, from_mix=False)
        local = to_blender_array(moved[body_ids])
        sk.data.foreach_set("co", local.ravel())
    del position, base


def add_fitted_part(label, mhclo_path, coords, per_vertex, arm, face_targets, report, keep=None, rigid=None):
    """Fit an mhclo asset to the shaped body, skin it from base-mesh weights and propagate morphs."""
    info = mh.load_mhclo(mhclo_path)
    arrays = mh.proxy_arrays(info)
    pv, puv, pf = mh.load_obj(info["obj"])
    fitted = mh.fit_proxy_fast(info, arrays, coords)
    faces = [(vi, ti) for vi, ti, _g in pf]
    if keep is not None:
        faces = [f for f in faces if keep(f, puv)]
    obj = new_mesh(label, to_blender_array(fitted), [vi for vi, _ in faces], puv, [ti for _, ti in faces])
    idx, wts, _ = arrays
    weights = []
    for row in range(len(fitted)):
        acc = {}
        for i, w in zip(idx[row], wts[row]):
            if w == 0:
                continue
            for bone, bw in per_vertex.get(int(i), {}).items():
                acc[bone] = acc.get(bone, 0.0) + bw * w
        weights.append(acc)
    for row, acc in enumerate(weights):
        if not acc:
            acc["head"] = 1.0
    if rigid is not None:
        weights = [rigid(row, fitted[row], acc) for row, acc in enumerate(weights)]
    assign_weights(obj, weights, arm)
    obj.shape_key_add(name="Basis", from_mix=False)
    kept = 0
    for name, tidx, delta in face_targets:
        moved = coords.copy()
        np.add.at(moved, tidx, delta)
        refit = mh.fit_proxy_fast(info, arrays, moved)
        if np.abs(refit - fitted).max() * 0.1 < 1e-4:
            continue
        sk = obj.shape_key_add(name=name, from_mix=False)
        sk.data.foreach_set("co", to_blender_array(refit).ravel())
        kept += 1
    if kept == 0:
        obj.shape_key_clear()
    _remove_loose(obj)
    report.setdefault("parts", {})[label] = {"triangles": triangle_count(obj), "morphTargets": kept,
                                             "source": os.path.basename(mhclo_path)}
    return obj, info


def eye_rule(_row, co, _acc):
    """Eyeballs rotate rigidly with their eye joint (the CC0 weights mix head and eye)."""
    return {"face_eye_l": 1.0} if co[0] > 0 else {"face_eye_r": 1.0}


def teeth_rule(_row, _co, acc):
    """Lower teeth follow the jaw, upper teeth the head."""
    return {"face_jaw": 1.0} if acc.get("face_jaw", 0.0) > 0.2 else {"head": 1.0}


def tongue_rule(_row, _co, acc):
    return {"face_jaw": 0.85, "head": 0.15}


def lash_rule(_row, _co, acc):
    """Lashes ride on their lid: the strongest lid joint takes the whole weight."""
    lids = {k: v for k, v in acc.items() if k.startswith("face_lid")}
    if not lids:
        return acc
    return {max(lids, key=lids.get): 1.0}


def _trim_eye_backs(eyes, back_deg=120.0):
    """Delete the back of each eyeball: the eyes turn at most about 35 degrees, so faces more than 120 degrees from
    the forward axis are never seen (about 40 percent of the CC0 high-poly eye), and the triangles go to the
    face and the authored teeth instead."""
    import bmesh
    co = vertex_array(eyes)
    left = co[:, 0] > 0
    angle = np.zeros(len(co))
    for sel in (left, ~left):
        if not sel.any():
            continue
        d = co[sel] - co[sel].mean(axis=0)
        d /= np.linalg.norm(d, axis=1, keepdims=True) + 1e-12
        angle[sel] = np.degrees(np.arccos(np.clip(-d[:, 1], -1.0, 1.0)))
    bm = bmesh.new()
    bm.from_mesh(eyes.data)
    doomed = [f for f in bm.faces if all(angle[v.index] > back_deg for v in f.verts)]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(eyes.data)
    bm.free()
    eyes.data.update()
    return len(doomed)


def _flush_iris(eyes, arm, keep=0.0004, cone_deg=26.0):
    """Lift the recessed iris disc of the CC0 eye onto the eyeball sphere (minus `keep`). With its cornea removed the
    iris sat about 1.8 mm inside the sclera sphere, and the wall of that step, textured with bright sclera, showed as a
    white ring round the iris whenever the eyes looked up or aside (round 2 critic). Returns vertices moved."""
    co = vertex_array(eyes)
    out = co.copy()
    moved = 0
    for side in ("l", "r"):
        b = np.array(arm.data.bones[f"face_eye_{side}"].head_local)
        sel = co[:, 0] > 0 if side == "l" else co[:, 0] < 0
        d = co - b
        r = np.linalg.norm(d, axis=1)
        ang = np.degrees(np.arccos(np.clip(-d[:, 1] / np.maximum(r, 1e-9), -1.0, 1.0)))
        sclera = sel & (ang > 35.0) & (ang < 95.0)
        if not sclera.any():
            continue
        rs = float(np.median(r[sclera])) - keep
        lift = sel & (ang < cone_deg) & (r < rs)
        out[lift] = b + d[lift] / r[lift][:, None] * rs
        moved += int(lift.sum())
    eyes.data.vertices.foreach_set("co", out.ravel())
    if eyes.data.shape_keys:
        for kb in eyes.data.shape_keys.key_blocks:
            kco = np.zeros(len(co) * 3)
            kb.data.foreach_get("co", kco)
            kb.data.foreach_set("co", (kco.reshape(-1, 3) + (out - co)).ravel())
    eyes.data.update()
    return moved


def _shrink_towards_centre(obj, k):
    """Scale a part (and its shape keys) about its rest centroid."""
    if k >= 1.0:
        return
    co = vertex_array(obj)
    c = co.mean(axis=0)
    obj.data.vertices.foreach_set("co", (c + (co - c) * k).ravel())
    if obj.data.shape_keys:
        for kb in obj.data.shape_keys.key_blocks:
            d = np.zeros(len(co) * 3)
            kb.data.foreach_get("co", d)
            d = d.reshape(-1, 3)
            kb.data.foreach_set("co", (c + (d - c) * k).ravel())
    obj.data.update()


def _remove_loose(obj):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def _teeth_shift(src, recipe, body, teeth_full, arm):
    """Height offsets (upper, lower) for the authored arches: the upper incisal edge goes `upperShowMm` below the
    relaxed upper-lip line (the lowest point of the upper lip at the midline, MakeHuman's lips_solid region; the
    upper lip is the part the jawOpen morph does not lower), and the lower incisal edge `overbiteMm` above it."""
    import teeth as teeth_lib
    spec = recipe.get("teeth", {})
    me = body.data
    lips = mh.load_region_faces(src["mpfbData"], "lips_solid")
    lipv = np.array(sorted({v for f in lips if f < len(me.polygons) for v in me.polygons[f].vertices}))
    keys = me.shape_keys
    b0 = vertex_array(body, keys.key_blocks[0].name)
    bj = vertex_array(body, "jawOpen") if "jawOpen" in keys.key_blocks else b0
    mid = lipv[np.abs(b0[lipv, 0]) < 0.004]
    upper = mid[(bj[mid, 2] - b0[mid, 2]) > -0.001]
    edge_u, edge_l = teeth_lib.incisal_edges(teeth_full)
    if not len(upper):
        return (0.0, 0.0), {"skipped": "no upper lip found"}
    lip_line = float(b0[upper, 2].min())
    want_u = lip_line - spec.get("upperShowMm", 1.5) / 1000.0
    d_u = float(np.clip(want_u - edge_u, -0.009, 0.0))
    want_l = edge_u + d_u + spec.get("overbiteMm", 2.5) / 1000.0
    d_l = float(np.clip(want_l - edge_l, -0.011, 0.0))
    return (d_u, d_l), {"upperLipLineZ": round(lip_line, 4), "upperIncisalEdgeBefore": round(edge_u, 4),
                        "lowerIncisalEdgeBefore": round(edge_l, 4), "upperShiftMm": round(d_u * 1000, 1),
                        "lowerShiftMm": round(d_l * 1000, 1)}


def build(src, recipe, report):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    coords, uvs, faces, groups = shape_coordinates(src, recipe, report)
    body, body_ids, _remap = build_body_mesh(coords, uvs, faces)
    arm, per_vertex = build_rig(src, recipe, coords, groups, report)
    assign_weights(body, [per_vertex.get(i, {"hips": 1.0}) for i in body_ids], arm)
    face_targets = load_face_targets(src, recipe)
    add_body_morphs(body, coords, body_ids, face_targets)
    report["bodyTriangles"] = triangle_count(body)
    report["morphTargets"] = [name for name, _i, _d in face_targets]
    sysdir = src["systemAssets"]
    parts = recipe["parts"]
    eye_mesh = parts.get("eyesMesh", "high-poly")
    # The eye proxy carries a cornea shell mapped to the texture corner; the pipeline keeps the
    # eyeball only and gives the iris a wet, low-roughness response instead.
    def not_cornea(face, puv):
        _vi, ti = face
        us = [puv[t][0] for t in ti]
        vs = [puv[t][1] for t in ti]
        return not (min(us) > 0.84 and max(vs) < 0.16)
    eyes, _ = add_fitted_part("Eyes", os.path.join(sysdir, "eyes", eye_mesh, eye_mesh + ".mhclo"), coords, per_vertex,
                              arm, face_targets, report, keep=not_cornea, rigid=eye_rule)
    report["parts"]["Eyes"]["backFacesRemoved"] = _trim_eye_backs(eyes)
    report["parts"]["Eyes"]["irisVerticesFlushed"] = _flush_iris(eyes, arm)
    report["parts"]["Eyes"]["triangles"] = triangle_count(eyes)
    teeth_full, _ = add_fitted_part("Teeth", os.path.join(sysdir, "teeth", "teeth_base", "teeth_base.mhclo"), coords,
                                    per_vertex, arm, face_targets, report, rigid=teeth_rule)
    # The 7k-triangle CC0 teeth only place the arches: decimated, they read as grey spikes and fangs. Authored
    # arches with rounded crowns and gums replace them (teeth.py), inheriting their weights and face morphs.
    import teeth as teeth_lib
    teeth_full.name = "TeethSource"
    shift, fit = _teeth_shift(src, recipe, body, teeth_full, arm)
    report.setdefault("parts", {})["TeethFit"] = fit
    teeth = teeth_lib.build(teeth_full, arm, recipe, report, shift=shift)
    tongue, _ = add_fitted_part("Tongue", os.path.join(sysdir, "tongue", "tongue01", "tongue01.mhclo"), coords,
                                per_vertex, arm, face_targets, report, rigid=tongue_rule)
    _shrink_towards_centre(tongue, parts.get("tongueScale", 0.86))
    # the CC0 tongue sits high in the authored arches: lower and draw it back a little, so the lower incisors
    # show in front of it when the mouth opens
    # round 2: it follows the lowered lower arch down, sits a little further back and is narrower, so its tip rests
    # behind the lower incisors and below their biting edge when the mouth opens (it poked out past them)
    t_off = np.array([0.0, parts.get("tongueBack", 0.006), shift[1] - parts.get("tongueDrop", 0.0085)])
    tongue.data.transform(Matrix.Translation(Vector(t_off)))
    if tongue.data.shape_keys:
        for kb in tongue.data.shape_keys.key_blocks:
            d = np.zeros(len(kb.data) * 3)
            kb.data.foreach_get("co", d)
            kb.data.foreach_set("co", (d.reshape(-1, 3) + t_off).ravel())
    tongue.data.update()
    lashes, _ = add_fitted_part("Eyelashes", os.path.join(sysdir, "eyelashes", parts["eyelashes"], parts["eyelashes"] + ".mhclo"),
                                coords, per_vertex, arm, face_targets, report, rigid=lash_rule)
    # The LOD1 and Quest heads (round 2): the resident's own LOD0 head, decimated with its lid, lip and atlas-seam
    # loops kept (lod_head.py). MakeHuman's CC0 low-poly proxy (8-vertex eye openings, its own face) read as a
    # different person and could not close its eyes; it stays available with lodHead.source = "makehuman".
    import lod_head
    from stage_lods import _neck_cut_z
    lod_spec = recipe.get("lodHead", {})
    lod_head.mark_mouth(body, mh.load_region_faces(src["mpfbData"], "lips_solid"), arm)
    if lod_spec.get("source", "lod0") == "makehuman":
        proxy_name = parts.get("lodHeadProxy") or ("male1591" if recipe["macro"]["gender"] >= 0.5 else "female1605")
        proxy, _ = add_fitted_part("HeadProxy", os.path.join(sysdir, "proxymeshes", proxy_name, proxy_name + ".proxy"),
                                   coords, per_vertex, arm, [], report)
        proxy["proxy_source"] = proxy_name
    else:
        proxy = lod_head.build(body, eyes, arm, lod_spec, report, _neck_cut_z(arm) - 0.03)
    # authored low arches for LOD1 and Quest (front teeth, gums and the throat occluder)
    teeth_low = teeth_lib.build(teeth_full, arm, recipe, report, low=True, shift=shift)
    bpy.data.objects.remove(teeth_full)
    return {"coords": coords, "groups": groups, "faces": faces, "uvs": uvs, "body_ids": body_ids,
            "per_vertex": per_vertex, "arm": arm, "body": body, "eyes": eyes, "teeth": teeth, "teeth_low": teeth_low,
            "tongue": tongue, "lashes": lashes, "face_targets": face_targets, "head_proxy": proxy}

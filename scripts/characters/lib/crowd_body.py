"""Crowd body: a resident shaped on its archetype's shared skeleton (original Crownfall code, CC0 MakeHuman data).

EALDHOLT_POPULATION_ART.md section 4: shape the hm08 base mesh with the resident's own macro values and CC0 head-region
detail targets, measure the best uniform scale s of its joints against the archetype reference, scale the shaped mesh
by 1/s about the ground point, bind it to the reference skeleton with the base-mesh weights and put the seven face
joints (jaw, eyes, lids) at the resident's own head. No morph targets: the face moves by joints only (face-performance
joints-only tier). Produces Blender objects Rig, Body (skin) and Eyes; the body carries the lip and mouth-bag marks the
head preparation uses later (lod_head.mark_mouth).
"""
import os

import bpy
import numpy as np
from mathutils import Vector

import body as body_lib
import crowd_skeleton as cs
import mh
from scene import assign_weights, triangle_count


def resident_recipe(recipe):
    """The body recipe (macro, detail targets, rig constants of the archetype) of a crowd recipe."""
    arch = recipe["archetype"]
    return {"macro": recipe["macro"], "detailTargets": recipe.get("detailTargets", {}), "rig": cs.RIG,
            "soleThicknessMetres": cs.SOLE_LIFT[arch], "skirtBoneLength": cs.SKIRT_BONE_LENGTH[arch]}


def check_reference(recipe):
    """The generator copies the archetype reference from village-population.ts; it must equal crowd_skeleton's mirror."""
    ref = recipe.get("archetypeReference")
    mine = cs.REFERENCE_MACROS[recipe["archetype"]]
    if ref is None:
        return
    for k, v in mine.items():
        if abs(float(ref[k]) - float(v)) > 1e-9:
            raise SystemExit(f"archetype {recipe['archetype']} reference {k}={ref[k]} differs from crowd_skeleton ({v}); "
                             "update crowd_skeleton.REFERENCE_MACROS and rebuild the clip libraries")


def _move_face_joints(arm, points):
    """Put the face joints at the resident's own head (rest pose); same frames as body.build_rig."""
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    moved = {}
    for name in cs.FACE_JOINTS:
        head, tail = points[name]
        bone = eb[name]
        moved[name] = round(float(np.linalg.norm(np.array(bone.head) - head)) * 100.0, 2)
        bone.use_connect = False
        bone.head = Vector(head)
        bone.tail = Vector(tail) if np.linalg.norm(tail - head) > 1e-4 else Vector(head) + Vector((0, 0, 0.01))
        direction = (bone.tail - bone.head).normalized()
        bone.align_roll(Vector((1.0, 0.0, 0.0)).cross(direction))
    bpy.ops.object.mode_set(mode="OBJECT")
    return moved


def eye_part(src, coords, per_vertex, arm, report, mesh="low-poly"):
    """Fitted CC0 eyeballs, rigid to their eye joints (the back trimmed)."""
    sysdir = src["systemAssets"]

    def not_cornea(face, puv):
        _vi, ti = face
        us = [puv[t][0] for t in ti]
        vs = [puv[t][1] for t in ti]
        return not (min(us) > 0.84 and max(vs) < 0.16)
    eyes, _ = body_lib.add_fitted_part("Eyes", os.path.join(sysdir, "eyes", mesh, mesh + ".mhclo"), coords, per_vertex, arm, [],
                                       report, keep=not_cornea, rigid=body_lib.eye_rule)
    report["parts"]["Eyes"]["backFacesRemoved"] = body_lib._trim_eye_backs(eyes, back_deg=115.0)
    report["parts"]["Eyes"]["triangles"] = triangle_count(eyes)
    return eyes


def build(src, recipe, report):
    """Fresh scene with Rig (archetype body joints, resident face joints), Body and Eyes. Returns a dict of facts."""
    check_reference(recipe)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    arch = recipe["archetype"]
    ref_recipe = cs.reference_recipe(arch)
    ref_coords, uvs, faces, groups = cs.shaped(src, ref_recipe, {})
    res = resident_recipe(recipe)
    coords, _uvs, _faces, _groups = cs.shaped(src, res, report)
    ref_j = cs.joint_points(src, ref_coords, groups)
    res_j = cs.joint_points(src, coords, groups)
    s, residual = cs.fit_scale(ref_j, res_j)
    ground = cs.ground_point(ref_j)
    fitted = cs.scale_coords(coords, ground, s)
    stature_own = cs.stature_cm(coords, groups)
    # the skeleton: every body joint from the reference body, so library clips play exactly
    arm, per_vertex = body_lib.build_rig(src, ref_recipe, ref_coords, groups, report)
    arm.name = "Rig"
    face = cs.joint_points(src, fitted, groups)
    moved = _move_face_joints(arm, {n: face[n] for n in cs.FACE_JOINTS})
    mesh, body_ids, _ = body_lib.build_body_mesh(fitted, uvs, faces)
    assign_weights(mesh, [per_vertex.get(i, {"hips": 1.0}) for i in body_ids], arm)
    mesh["crownfall_part"] = "body"
    eyes = eye_part(src, fitted, per_vertex, arm, report, recipe.get("eyesMesh", "low-poly"))
    eyes["crownfall_part"] = "eyes"
    import lod_head
    lod_head.mark_mouth(mesh, mh.load_region_faces(src["mpfbData"], "lips_solid"), arm)
    lo, hi = recipe.get("archetypeScaleRange", [0.0, 9.0])
    facts = {
        "archetype": arch,
        "placementScale": round(s, 4),
        "placementScaleInsideArchetypeRange": bool(lo - 1e-6 <= s <= hi + 1e-6),
        "jointResidualCm": residual,
        "statureCm": round(stature_own, 1),
        "referenceStatureCm": round(cs.stature_cm(ref_coords, groups), 1),
        "faceJointOffsetFromReferenceCm": moved,
        "groundPoint": [round(float(v), 5) for v in ground],
    }
    report["crowdBody"] = facts
    report["bodyTriangles"] = triangle_count(mesh)
    return {"arm": arm, "body": mesh, "eyes": eyes, "coords": fitted, "groups": groups, "body_ids": body_ids,
            "per_vertex": per_vertex, "facts": facts}

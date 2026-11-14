"""Crowd archetype reference skeletons (original Crownfall code; CC0 MakeHuman data only).

One shared 64-joint body skeleton per body archetype (EALDHOLT_POPULATION_ART.md section 4). The reference body is
the CC0 hm08 base mesh shaped with the archetype's reference macro values (mirrored from POPULATION_ARCHETYPE_SPECS in
shared/legacy/aethelgard/characters/village-population.ts; `crowd_recipes.ts` refuses to write recipes if they differ)
and the reference family mix. Every crowd resident of the archetype is shaped with its own macro and face targets,
scaled by 1/s about the ground point so its body joints fit the reference, and bound to the reference body joints; only
the seven face joints (jaw, eyes, lids) come from the resident's own head, because only the face rig drives them. At
runtime `placement.scale = s` restores the stature and every library clip plays exactly.

Used by the kit builder (crowd_body.py) and, read-only, by the motion builder for the clip libraries:

    import crowd_skeleton as cs
    arm, body, info = cs.build_reference(src, "adult-male")      # fresh scene: Rig + reference Body, weighted
    joints = cs.rest_joints(arm)                                 # {bone: (head, tail, roll)} in Blender metres

All functions are deterministic. Units: MakeHuman decimetres (+Y up, +Z forward) inside, Blender metres outside.
"""
import os

import numpy as np

ARCHETYPES = ("adult-male", "adult-female", "adolescent", "child", "elder-male", "elder-female")

# Mirror of POPULATION_ARCHETYPE_SPECS[*].reference (village-population.ts). The generator checks it.
REFERENCE_MACROS = {
    "adult-male": {"gender": 1.0, "ageYears": 34, "muscle": 0.55, "weight": 0.5, "height": 0.5, "proportions": 0.5},
    "adult-female": {"gender": 0.0, "ageYears": 30, "muscle": 0.45, "weight": 0.5, "height": 0.5, "proportions": 0.5},
    "adolescent": {"gender": 0.5, "ageYears": 14, "muscle": 0.45, "weight": 0.45, "height": 0.6, "proportions": 0.5},
    "child": {"gender": 0.5, "ageYears": 8, "muscle": 0.45, "weight": 0.45, "height": 0.6, "proportions": 0.5},
    "elder-male": {"gender": 1.0, "ageYears": 70, "muscle": 0.4, "weight": 0.5, "height": 0.45, "proportions": 0.5},
    "elder-female": {"gender": 0.0, "ageYears": 70, "muscle": 0.35, "weight": 0.5, "height": 0.4, "proportions": 0.5},
}
# The family mix the architect measured the references with (FAMS[0] of the joint-variation runs).
REFERENCE_FAMILY = {"african": 0.05, "asian": 0.1, "caucasian": 0.85}
# Per archetype constants of the shared skeleton (must not vary per resident: they shape the rest pose).
SOLE_LIFT = {"adult-male": 0.012, "adult-female": 0.012, "adolescent": 0.010, "child": 0.008,
             "elder-male": 0.010, "elder-female": 0.010}
SKIRT_BONE_LENGTH = {"adult-male": 0.40, "adult-female": 0.58, "adolescent": 0.45, "child": 0.28,
                     "elder-male": 0.55, "elder-female": 0.58}
RIG = "mixamo_unity"

FACE_JOINTS = ("face_jaw", "face_eye_l", "face_eye_r", "face_lid_upper_l", "face_lid_upper_r",
               "face_lid_lower_l", "face_lid_lower_r")
FINGERS = ("thumb", "index", "middle", "ring", "pinky")


def reference_recipe(archetype):
    """A minimal body recipe for the archetype reference (used by body.shape_coordinates and body.build_rig)."""
    macro = dict(REFERENCE_MACROS[archetype])
    macro["macroShapeFamilies"] = dict(REFERENCE_FAMILY)
    return {"macro": macro, "detailTargets": {}, "rig": RIG, "soleThicknessMetres": SOLE_LIFT[archetype],
            "skirtBoneLength": SKIRT_BONE_LENGTH[archetype]}


def shaped(src, recipe, report=None):
    """(coords dm, uvs, faces, groups) of the base mesh shaped by the recipe's macro and detail targets."""
    import body
    return body.shape_coordinates(src, recipe, report if report is not None else {})


def joint_points(src, coords, groups):
    """Head and tail of every rig joint (Crownfall names) computed from shaped coords, Blender metres. No bpy needed."""
    import body
    import mh
    from mathutils import Vector  # noqa: F401  (body._rig_point returns mathutils vectors)
    rig_json, _ = mh.load_rig(src["mpfbData"], RIG)
    warnings = []
    out = {}
    for source, spec in rig_json.items():
        if source.split(":", 1)[-1] in body.REMOVED_SOURCE_BONES:
            continue
        name = body.crownfall_bone_name(source)
        out[name] = (np.array(body._rig_point(spec["head"], coords, groups, warnings)),
                     np.array(body._rig_point(spec["tail"], coords, groups, warnings)))
    return out


def is_body_joint(name):
    return name not in FACE_JOINTS and name != "root" and not name.startswith("skirt_")


def is_core_joint(name):
    return is_body_joint(name) and name.split("_")[0] not in FINGERS


def ground_point(joints):
    hips = joints["hips"][0]
    return np.array([hips[0], hips[1], 0.0])


def fit_scale(ref, res):
    """Best uniform scale s about the reference ground point with res ~ s * ref (body joint heads, fingers included,
    like the architect's measurement). Returns s and residual statistics in centimetres (all body joints / core)."""
    names = sorted(n for n in ref if is_body_joint(n) and n in res)
    g = ground_point(ref)
    a = np.array([ref[n][0] for n in names]) - g
    b = np.array([res[n][0] for n in names]) - g
    s = float((a * b).sum() / (a * a).sum())
    err = np.linalg.norm(b - s * a, axis=1) * 100.0  # as the architect measured: visible misplacement at stature s
    core = np.array([is_core_joint(n) for n in names])
    worst = names[int(np.argmax(np.where(core, err, -1)))]
    return s, {"allMaxCm": round(float(err.max()), 2), "coreMaxCm": round(float(err[core].max()), 2),
               "coreMeanCm": round(float(err[core].mean()), 2), "coreWorstJoint": worst}


def scale_coords(coords, ground_blender, s):
    """Scale MakeHuman coords by 1/s about a ground point given in Blender metres."""
    gx, gy = ground_blender[0] * 10.0, ground_blender[1] * 10.0  # Blender y = -MH z
    out = coords.copy()
    out[:, 0] = gx + (coords[:, 0] - gx) / s
    out[:, 1] = coords[:, 1] / s
    out[:, 2] = (-gy) + (coords[:, 2] - (-gy)) / s
    return out


def stature_cm(coords, groups):
    body_ids = sorted(groups["body"])
    return float(coords[body_ids, 1].max() - coords[body_ids, 1].min()) * 10.0


def build_reference(src, archetype, report=None):
    """Fresh scene with the archetype's reference Rig and reference Body (base-mesh weights). Returns (arm, body, info)."""
    import bpy
    import body as body_lib
    from scene import assign_weights
    report = report if report is not None else {}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    recipe = reference_recipe(archetype)
    coords, uvs, faces, groups = shaped(src, recipe, report)
    mesh, body_ids, _ = body_lib.build_body_mesh(coords, uvs, faces)
    arm, per_vertex = body_lib.build_rig(src, recipe, coords, groups, report)
    assign_weights(mesh, [per_vertex.get(i, {"hips": 1.0}) for i in body_ids], arm)
    arm.name = "Rig"
    info = {"archetype": archetype, "referenceMacro": recipe["macro"], "statureCm": round(stature_cm(coords, groups), 1),
            "soleLiftMetres": SOLE_LIFT[archetype], "skirtBoneLength": SKIRT_BONE_LENGTH[archetype], "rig": RIG}
    return arm, mesh, info


def rest_joints(arm):
    """{bone: [head, tail, roll, parent]} of an armature in rest pose (armature space, metres)."""
    out = {}
    for b in arm.data.bones:
        out[b.name] = {"head": [round(float(v), 6) for v in b.head_local], "tail": [round(float(v), 6) for v in b.tail_local],
                       "parent": b.parent.name if b.parent else None,
                       "matrix": [[round(float(v), 6) for v in row] for row in b.matrix_local]}
    return out


def compare_rest(a, b, tol=1e-5, body_only=True):
    """Largest head/tail difference (metres) between two rest_joints dicts over body joints (face joints may differ)."""
    worst, at = 0.0, None
    for name, ja in a.items():
        if body_only and not (is_body_joint(name) or name.startswith("skirt_") or name == "root"):
            continue
        jb = b.get(name)
        if jb is None:
            return float("inf"), name
        d = max(float(np.abs(np.array(ja["head"]) - np.array(jb["head"])).max()),
                float(np.abs(np.array(ja["tail"]) - np.array(jb["tail"])).max()))
        if d > worst:
            worst, at = d, name
    return worst, at


def library_path(root, archetype):
    return os.path.join(root, f"crowd-clips-{archetype}-v1.glb")

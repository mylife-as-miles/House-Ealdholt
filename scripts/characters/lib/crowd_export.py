"""Crowd export: one skinned mesh, one material, no clips, no morphs; measured resident manifest (original code).

The crowd file holds the 64-joint archetype skeleton (body joints identical across the archetype, face joints at the
resident's own head) and one mesh with one material referencing the 512 atlas (EXT_texture_webp). Clips live in the
archetype clip libraries (crowd-clips-<archetype>-v1.glb, built by the motion builder) and are paired at load time:
`{scene: resident.scene, animations: library.animations}`; the resident manifest carries `placementScale` for the
actor owner's existing `placement.scale`.
"""
import os

import bpy
import numpy as np

import measure
from scene import select_only, triangle_count, vertex_array


def join(objects, name):
    objects = [o for o in objects if o is not None and len(o.data.polygons)]
    select_only(objects)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = obj.data.name = name
    return obj


def finalize(obj, material):
    me = obj.data
    for layer in [l for l in me.uv_layers if l.name != "AtlasUV"]:
        me.uv_layers.remove(layer)
    for attr in [a for a in me.color_attributes]:
        me.color_attributes.remove(attr)
    for name in [a.name for a in me.attributes if a.name.startswith("crownfall_") or a.name.startswith("crowd_")]:
        if name in me.attributes:
            me.attributes.remove(me.attributes[name])
    me.materials.clear()
    me.materials.append(material)
    for p in me.polygons:
        p.material_index = 0
    # drop empty vertex groups so only deforming joints are referenced
    used = set()
    for v in me.vertices:
        for g in v.groups:
            if g.weight > 1e-4:
                used.add(g.group)
    for g in list(obj.vertex_groups):
        if g.index not in used and not g.name.startswith("face_"):
            pass  # keep: the skin lists every joint so all residents of an archetype share one joint order
    obj["crownfall_part"] = "crowd"


def export(arm, mesh, path, quality=88):
    for m in list(mesh.modifiers):
        if m.type != "ARMATURE":
            mesh.modifiers.remove(m)
    if not any(m.type == "ARMATURE" for m in mesh.modifiers):
        mod = mesh.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
    mesh.parent = arm
    for b in arm.pose.bones:
        b.rotation_quaternion = (1, 0, 0, 0)
        b.location = (0, 0, 0)
        b.scale = (1, 1, 1)
    select_only([arm, mesh])
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_animations=False, export_morph=False,
        export_skins=True, export_all_influences=False, export_def_bones=False, export_image_format="WEBP",
        export_image_quality=quality, export_tangents=False, export_vertex_color="NONE", export_yup=True,
        export_apply=False, export_extras=False, export_cameras=False, export_lights=False, export_rest_position_armature=True)
    return path


def manifest(recipe, report, glb, calibration, head_tris, built):
    facts = measure.glb_facts(glb)
    size = os.path.getsize(glb)
    body = report["crowdBody"]
    budget = recipe["budget"]
    tris = sum(m["triangles"] for m in facts["meshes"])
    images = facts["images"]
    measured = {
        "fileBytes": size, "fileMiB": round(size / 1048576, 3), "triangles": tris, "headTriangles": head_tris,
        "vertices": sum(m["vertices"] for m in facts["meshes"]), "materials": len(facts["materials"]),
        "meshes": len(facts["meshes"]), "joints": facts.get("joints"), "morphTargets": max([m["morphTargets"] for m in facts["meshes"]] or [0]),
        "clips": len(facts["animations"]), "images": [{k: im[k] for k in ("mime", "bytes", "width", "height", "decodedRgba8WithMipsBytes")} for im in images],
    }
    gates = {
        "trianglesAtMost": [tris, budget["triangles"]["max"], tris <= budget["triangles"]["max"]],
        "headTrianglesAtLeast": [head_tris, budget["triangles"]["headMin"], head_tris >= budget["triangles"]["headMin"]],
        "materialsAtMost": [measured["materials"], budget["materials"]["max"], measured["materials"] <= budget["materials"]["max"]],
        "noMorphs": measured["morphTargets"] == 0, "noClips": measured["clips"] == 0,
        "atlas512": all(im["width"] == budget["textures"]["albedoPx"] for im in images) and len(images) == 1,
        "fileAtMostMiB": [measured["fileMiB"], budget["file"]["maxMiB"], measured["fileMiB"] <= budget["file"]["maxMiB"]],
        "placementScaleInArchetypeRange": body["placementScaleInsideArchetypeRange"],
        "faceRigCalibrated": bool(calibration) and not report.get("faceRig", {}).get("error"),
        # art fixer, 8 November: the scalp is covered under full covers and no headwear shell leaves shards or strays
        "headwearCovers": bool(report.get("headwearGate", {}).get("pass", True)),
    }
    gates["allPass"] = all((g[2] if isinstance(g, list) else g) for g in gates.values())
    # envelope margin: how far this body and kit reach beyond the archetype reference body (rest pose, metres)
    co = vertex_array(bpy.data.objects["Crowd"])
    radial = np.hypot(co[:, 0], co[:, 1] - float(np.median(co[:, 1])))
    return {
        "status": "working-placeholder",
        "residentId": recipe["residentId"], "label": recipe["label"], "roleId": recipe["roleId"], "group": recipe["group"],
        "householdId": recipe["householdId"], "fidelityTier": recipe["fidelityTier"],
        "file": os.path.basename(glb), "archetype": recipe["archetype"],
        "clipLibrary": recipe["motion"]["library"] + ".glb" if recipe["motion"].get("library") else None,
        "placementScale": body["placementScale"], "jointResidualCm": body["jointResidualCm"],
        "statureCm": body["statureCm"], "referenceStatureCm": body["referenceStatureCm"],
        "faceTier": "face-joints-only", "faceCalibration": calibration, "faceRigError": report.get("faceRig", {}).get("error"),
        "restRadiusMetres": round(float(radial.max()), 3),
        "envelopeMarginMetres": round(max(0.0, float(radial.max()) - 0.35) + 0.02, 3),
        "outfit": {"kit": recipe["outfit"]["kit"], "cut": recipe["outfit"].get("cut", "standard"), "palette": recipe["outfit"]["palette"],
                   "wear": recipe["outfit"]["wear"]},
        "hair": recipe["hair"], "headwear": recipe["headwear"], "headwearStyle": recipe.get("headwearStyle"),
        "headwearGate": report.get("headwearGate"), "props": recipe["props"], "motion": recipe["motion"],
        "measured": measured, "gates": gates,
    }

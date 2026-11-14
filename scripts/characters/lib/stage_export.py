"""Stage: export the resident GLBs (desktop LOD0, desktop LOD1, Quest) and the props GLB.

Character files contain one armature (64 joints), named clips from the NLA tracks
(LINEAR-sampled transform tracks only) and, for desktop LOD0, the face morph targets.
Props travel separately: hand props hang under `socket_hand_r` / `socket_hand_l` nodes
whose children carry the grip transform relative to the hand joint, and workplace props
are placed relative to the resident root in the work pose.
"""
import json
import os

import bpy
from mathutils import Matrix

import measure


def _select(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def export_glb(path, objects, animations=True, morphs=True, quality=88, tangents=True, morph_normals=False, yup=True):
    _select(objects)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True,
        export_animations=animations, export_animation_mode="NLA_TRACKS", export_force_sampling=True,
        export_optimize_animation_size=True, export_reset_pose_bones=True, export_rest_position_armature=True,
        export_anim_slide_to_zero=True, export_try_sparse_sk=True,
        export_morph=morphs, export_morph_normal=morph_normals and morphs, export_morph_tangent=False, export_skins=True,
        export_all_influences=False, export_def_bones=False, export_image_format="WEBP", export_image_quality=quality,
        export_tangents=tangents, export_vertex_color="ACTIVE", export_yup=yup, export_apply=False,
        export_extras=False, export_cameras=False, export_lights=False)
    if animations:
        # drop rest-pose channels and redundant keys; face clips keep the face joints only (glb_prune.py)
        import glb_prune
        PRUNE_STATS[os.path.basename(path)] = glb_prune.prune(path, rot_tol_deg=0.03, pos_tol=1e-4)
    return path


PRUNE_STATS = {}


def _atlas_uvs(objs, hand_scale=1.6):
    """One shared UV layout ('AtlasUV') over every prop: Poly Haven models keep their own islands, procedural
    props are unwrapped; island scales are averaged (one texel density) and hand props, seen close, get more."""
    for o in objs:
        me = o.data
        if not me.uv_layers:
            me.uv_layers.new(name="SrcUV")
        src = me.uv_layers.active
        src.name = "SrcUV"
        atlas = me.uv_layers.new(name="AtlasUV")
        me.uv_layers.active = atlas
        atlas.active_render = False
        src.active_render = True
        # every source image reads SrcUV explicitly (the bake writes through the active AtlasUV)
        for mat in me.materials:
            if not mat or not mat.use_nodes:
                continue
            nt = mat.node_tree
            for node in list(nt.nodes):
                if node.type == "TEX_IMAGE" and node.label != "BAKE_TARGET" and not node.inputs["Vector"].links:
                    uvn = nt.nodes.new("ShaderNodeUVMap")
                    uvn.uv_map = "SrcUV"
                    nt.links.new(uvn.outputs["UV"], node.inputs["Vector"])
                elif node.type in ("UVMAP", "NORMAL_MAP"):
                    node.uv_map = "SrcUV"
    procedural = [o for o in objs if "polyhaven_id" not in o and o.name != "prop_hammer"]
    for o in objs:
        o.hide_set(False)
    bpy.ops.object.select_all(action="DESELECT")
    if procedural:
        for o in procedural:
            o.select_set(True)
        bpy.context.view_layer.objects.active = procedural[0]
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.01, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode="OBJECT")
    for o in objs:  # Poly Haven models: copy their islands
        if o in procedural:
            continue
        me = o.data
        data = [0.0] * (len(me.loops) * 2)
        me.uv_layers["SrcUV"].data.foreach_get("uv", data)
        me.uv_layers["AtlasUV"].data.foreach_set("uv", data)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in objs:
        if "grip_matrix" in o:  # hand props are seen at arm's length: denser
            me = o.data
            data = [0.0] * (len(me.loops) * 2)
            me.uv_layers["AtlasUV"].data.foreach_get("uv", data)
            data = [v * hand_scale for v in data]
            me.uv_layers["AtlasUV"].data.foreach_set("uv", data)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004, scale=True)
    bpy.ops.object.mode_set(mode="OBJECT")


def _bake_props_atlas(objs, out_dir, size=1024, samples=4):
    """Bake every prop's own material into one atlas set (albedo, roughness/metal ORM, tangent normal, emission).
    The props had 5 to 10 materials and up to twelve 1k maps per set (64 MiB decoded for the elder's alone)."""
    import numpy as np
    import textures as tx
    from scene import array_from_image, image_from_array
    mats = sorted({m for o in objs for m in o.data.materials if m is not None}, key=lambda m: m.name)
    rough = tx.new_target("props_rough", size // 2, "Non-Color")
    tx.bake(objs, "ROUGHNESS", {m: rough for m in mats}, samples=1, margin=6)
    normal = tx.new_target("props_normal", size // 2, "Non-Color", (0.5, 0.5, 1.0, 1.0))
    tx.bake(objs, "NORMAL", {m: normal for m in mats}, samples=1, margin=6, normal_space="TANGENT")
    # metallic and emission through the emission pass, one at a time (the original links are restored after)
    saved = {}
    for m in mats:
        b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b is None:
            continue
        ec, es = b.inputs["Emission Color"], b.inputs["Emission Strength"]
        saved[m] = ([l.from_socket for l in ec.links], tuple(ec.default_value), es.default_value,
                    [l.from_socket for l in es.links])
    def route(kind):
        for m, (ec_links, ec_val, es_val, es_links) in saved.items():
            nt = m.node_tree
            b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
            ec, es = b.inputs["Emission Color"], b.inputs["Emission Strength"]
            for l in list(ec.links) + list(es.links):
                nt.links.remove(l)
            if kind in ("metal", "base"):
                # base colour through the emission pass: the diffuse pass darkens metals by their metallic share
                src_in = b.inputs["Metallic"] if kind == "metal" else b.inputs["Base Color"]
                if src_in.links:
                    nt.links.new(src_in.links[0].from_socket, ec)
                else:
                    v = src_in.default_value
                    ec.default_value = (v, v, v, 1.0) if kind == "metal" else tuple(v)
                es.default_value = 1.0
            else:  # emission restored as authored
                for src in ec_links:
                    nt.links.new(src, ec)
                ec.default_value = ec_val
                es.default_value = es_val
                for src in es_links:
                    nt.links.new(src, es)
    albedo = tx.new_target("props_albedo", size, "sRGB")
    route("base")
    tx.bake(objs, "EMIT", {m: albedo for m in mats}, samples=samples, margin=6)
    metal = tx.new_target("props_metal", size // 2, "Non-Color", (0, 0, 0, 1))
    route("metal")
    tx.bake(objs, "EMIT", {m: metal for m in mats}, samples=1, margin=6)
    route("emission")
    emit = bpy.data.images.new("props_emit", width=size // 2, height=size // 2, alpha=False, float_buffer=True)
    emit.colorspace_settings.name = "Non-Color"  # linear radiance, so glow above 1.0 survives (normalized below)
    emit.generated_color = (0, 0, 0, 1)
    tx.bake(objs, "EMIT", {m: emit for m in mats}, samples=1, margin=6)
    r = array_from_image(rough)[..., 0]
    mt = array_from_image(metal)[..., 0]
    orm = image_from_array("props_orm", np.dstack([np.ones_like(r), r, mt, np.ones_like(r)]), "Non-Color")
    e = array_from_image(emit)
    peak = float(e[..., :3].max())
    emit_strength = max(1.0, peak)
    e[..., :3] = e[..., :3] / emit_strength
    lin = np.clip(e[..., :3], 0.0, 1.0)  # stored as sRGB like any colour map
    e[..., :3] = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    emit_img = image_from_array("props_emissive", e, "sRGB")
    for key, img in (("albedo", albedo), ("normal", normal), ("orm", orm), ("emissive", emit_img)):
        tx.save_png(img, os.path.join(out_dir, "textures", f"props_{key}.png"))
    return {"albedo": albedo, "normal": normal, "orm": orm, "emissive": emit_img, "emitStrength": emit_strength,
            "anyEmission": peak > 0.02, "materialsBefore": len(mats)}


def _props_material(name, maps, size):
    """The set's one props material at a platform's atlas size."""
    import textures as tx
    from scene import resized_image
    alb = resized_image(maps["albedo"], size, f"{name}_albedo", "sRGB")
    nrm = resized_image(maps["normal"], max(128, size // 2), f"{name}_normal", "Non-Color")
    orm = resized_image(maps["orm"], max(128, size // 4), f"{name}_orm", "Non-Color")
    mat = tx.final_material(name, alb, orm, nrm, double_sided=True)
    if maps["anyEmission"]:
        n = tx.Nodes(mat)
        em = n.image(resized_image(maps["emissive"], max(128, size // 4), f"{name}_emissive", "sRGB"), colorspace="sRGB")
        n.link(em.outputs["Color"], n.bsdf.inputs["Emission Color"])
        n.bsdf.inputs["Emission Strength"].default_value = maps["emitStrength"]
    return mat


def export_props(path, report, per_prop_sockets=False):
    """Props GLB without the Y-up conversion: socket children are hand-joint-local (joint frames are
    not converted by the character export either); workplace props hang under `workplace`, which
    carries the same -90 degree X rotation the character's root joint uses to become Y-up."""
    props = {o.name: o for o in bpy.data.objects if o.get("crownfall_part") == "prop"}
    for o in props.values():  # a prop held in the same grip as another (the spinner's fibre roll and spindle)
        src = props.get(o.get("grip_like", ""))
        if src is not None and "grip_matrix" in src and "grip_matrix" not in o:
            o["grip_matrix"] = list(src["grip_matrix"])
            o["grip_bone"] = src["grip_bone"]
    sockets, asides = [], []
    workplace = bpy.data.objects.new("workplace", None)
    bpy.context.scene.collection.objects.link(workplace)
    workplace.rotation_euler = (-1.5707963267948966, 0.0, 0.0)
    for name, obj in props.items():
        if "grip_matrix" in obj:
            socket_name = "socket_" + obj["grip_bone"] + ("_" + name.replace("prop_", "") if per_prop_sockets else "")
            socket = bpy.data.objects.new(socket_name, None)
            bpy.context.scene.collection.objects.link(socket)
            obj.parent = socket
            obj.matrix_parent_inverse.identity()
            g = list(obj["grip_matrix"])
            obj.matrix_basis = Matrix([g[0:4], g[4:8], g[8:12], g[12:16]])
            sockets.append(socket)
        elif obj.get("placement") == "loose":
            continue  # exported at the props root in its own frame
        elif obj.get("placement") == "aside":
            # shown only in some clips (the elder's resting stick during work_carving): its own node at the props
            # root, in the resident root frame with the same Y-up turn the workplace carries, never merged
            world = obj.matrix_world.copy()
            obj.parent = None
            obj.matrix_basis = workplace.matrix_basis @ world
            asides.append(obj)
        elif obj.parent is None:
            world = obj.matrix_world.copy()
            obj.parent = workplace
            obj.matrix_parent_inverse.identity()
            obj.matrix_basis = world
    bpy.context.view_layer.update()
    # one atlas material per platform for the whole set, and the static workplace props merged into one mesh
    # (one draw); mechanisms that a clip may animate (bellows, chain) stay separate nodes
    out_dir = os.path.dirname(os.path.dirname(path))
    meshes = [o for o in props.values() if o.type == "MESH"]
    _atlas_uvs(meshes)
    maps = _bake_props_atlas(meshes, out_dir)
    statics = [o for o in workplace.children if o.type == "MESH" and not o.get("mechanism")]
    merged = None
    if len(statics) > 1:
        merged_names = [o.name for o in statics]
        keep_names = [n for n in props if n not in merged_names]
        for o in statics:
            o.data = o.data.copy()
        bpy.ops.object.select_all(action="DESELECT")
        for o in statics:
            o.select_set(True)
        bpy.context.view_layer.objects.active = statics[0]
        bpy.ops.object.join()
        merged = bpy.context.view_layer.objects.active
        merged.name = "workplace_static"
        merged["crownfall_part"] = "prop"
        merged["merged_from"] = merged_names
        props = {n: bpy.data.objects[n] for n in keep_names if n in bpy.data.objects}
        props[merged.name] = merged
    for o in [o for o in props.values() if o.type == "MESH"]:
        me = o.data
        if "SrcUV" in me.uv_layers:
            me.uv_layers.remove(me.uv_layers["SrcUV"])
        me.uv_layers["AtlasUV"].name = "UVMap"
    platforms = {"desktop": (path, 1024), "quest": (path.replace("-props.glb", "-props-quest.glb"), 512)}
    quest_halved = []
    for platform, (target, size) in platforms.items():
        if platform == "quest":
            # Quest keeps a lighter copy of the big models (basket, stool, bowl): halve meshes over 1,500 triangles
            for o in [o for o in props.values() if o.type == "MESH"]:
                from scene import apply_modifier, triangle_count
                if triangle_count(o) > 1500:
                    mod = o.modifiers.new("QuestDecimate", "DECIMATE")
                    mod.ratio = 0.5
                    apply_modifier(o, mod)
                    quest_halved.append(o.name)
        mat = _props_material(f"props_{platform}", maps, size)
        for o in [o for o in props.values() if o.type == "MESH"]:
            o.data.materials.clear()
            o.data.materials.append(mat)
        objs = sockets + [workplace] + list(props.values())
        # mechanisms keyed by the motion stage (bellows, spindle) export as clips named after the body clip
        animated = any(o.animation_data is not None and len(o.animation_data.nla_tracks) for o in props.values())
        export_glb(target, objs, animations=animated, morphs=False, tangents=False, yup=False,
                   quality=88 if platform == "desktop" else 82)
    mech = sorted(o.name for o in props.values() if o.get("mechanism"))
    clips = sorted({t.name for o in props.values() if o.animation_data for t in o.animation_data.nla_tracks})
    return {"sockets": {s.name: [c.name for c in s.children] for s in sockets}, "workplace": [c.name for c in workplace.children],
            "aside": [o.name for o in asides], "mechanisms": mech, "propClips": clips,
            "loose": sorted(n for n, o in props.items() if o.get("placement") == "loose"), "props": sorted(props),
            "atlas": {"materialsBefore": maps["materialsBefore"], "materialsAfter": 1, "desktopAtlas": 1024, "questAtlas": 512,
                      "mergedStatic": [o for o in ([merged.name] if merged else [])], "emission": maps["anyEmission"],
                      "questHalved": quest_halved},
            "questFile": os.path.basename(platforms["quest"][0])}


def run(ctx):
    out, recipe, report = ctx["out"], ctx["recipe"], ctx["report"]
    set_id = recipe["set"].replace("-v1", "")
    glb_dir = os.path.join(out, "glb")
    arm = bpy.data.objects["Rig"]
    files = {}
    for level in recipe["lods"]:
        meshes = [bpy.data.objects[n] for n in level["meshes"] if n in bpy.data.objects]
        path = os.path.join(glb_dir, f"{set_id}-{level['id']}.glb")
        export_glb(path, [arm] + meshes, morphs=level.get("morphs", False), quality=level.get("imageQuality", 88),
                   tangents=level.get("tangents", True), morph_normals=level.get("morphNormals", False))
        files[level["id"]] = path
    files["props"] = os.path.join(glb_dir, f"{set_id}-props.glb")
    report["propsExport"] = export_props(files["props"], report, per_prop_sockets=recipe.get("props", {}).get("kit", "smith") != "smith")
    files["props-quest"] = os.path.join(glb_dir, report["propsExport"]["questFile"])
    report["exports"] = {k: measure.glb_facts(v) for k, v in files.items()}
    # per-clip animated envelopes of every level for the actor owner (integration patch 5; round 2)
    import time
    import envelopes
    t0 = time.time()
    levels = {level["id"]: [bpy.data.objects[n] for n in level["meshes"] if n in bpy.data.objects] for level in recipe["lods"]}
    report["envelopes"] = envelopes.measure(arm, levels)
    report["envelopesSeconds"] = round(time.time() - t0, 1)
    report["animationPrune"] = {k: v for k, v in PRUNE_STATS.items()}
    with open(os.path.join(out, "exports.json"), "w") as handle:
        json.dump(report["exports"], handle, indent=1)

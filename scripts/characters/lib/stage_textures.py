"""Stage: bake skin and cloth atlases, pack eyes/mouth, and join into four meshes with four materials."""
import math
import os

import bpy
import numpy as np

import textures as tx
from scene import image_from_array, resized_image, select_only, strip_color_attributes


def _png(img, out, name):
    path = os.path.join(out, "textures", name + ".png")
    tx.save_png(img, path)
    return path


def _orm_from(rough_img, size, ao=None):
    r = tx.array_from_image(rough_img) if hasattr(tx, "array_from_image") else None
    from scene import array_from_image
    rough = array_from_image(rough_img)[..., 0]
    orm = np.dstack([np.ones_like(rough) if ao is None else ao, rough, np.zeros_like(rough), np.ones_like(rough)])
    return orm


def run(ctx):
    src, recipe, out, report = ctx["src"], ctx["recipe"], ctx["out"], ctx["report"]
    os.makedirs(os.path.join(out, "textures"), exist_ok=True)
    arm = bpy.data.objects["Rig"]
    body = bpy.data.objects["Body"]
    rep = report.setdefault("textures", {})

    # ---------------- skin
    sk = recipe["skin"]
    size = sk["atlasSize"]
    tx.weather_masks(body, arm, sk, body.get("mouth_corners"), body.get("lips_bottom_z"))
    tx.repack_skin_uv(body, sk["headScale"])
    mh_diffuse = bpy.data.images.load(os.path.join(src["systemAssets"], "skins", recipe["parts"]["skin"],
                                                   _skin_file(src, recipe)), check_existing=True)
    eyes = [tuple(arm.data.bones[b].head_local) for b in ("face_eye_l", "face_eye_r")]
    lid = tx.lid_tone(body, mh_diffuse, eyes)
    rep.pop("lidGain", None)
    rep["lidTone"] = {"skinLinear": [round(c, 4) for c in lid["skin"]], "lidLuminance": round(lid["lidLuminance"], 4)} if lid else None
    mat = tx.skin_material(body, src, recipe, mh_diffuse, lid)
    body.data.materials.clear()
    body.data.materials.append(mat)
    body.data.uv_layers.active = body.data.uv_layers["AtlasUV"]
    body.data.uv_layers["AtlasUV"].active_render = True
    albedo = tx.new_target("skin_albedo", size, "sRGB")
    tx.bake([body], "DIFFUSE", {mat: albedo}, samples=sk.get("bakeSamples", 4), pass_filter={"COLOR"})
    rep["skinGutterTexelsFilled"] = tx.fill_gutters(albedo, body, "AtlasUV")
    rep["browPaintTexels"] = tx.paint_brows(albedo, body, arm, recipe)
    rep["faceTexels"] = tx.refine_face_texels(albedo, body, arm, recipe)
    normal = tx.new_target("skin_normal", size, "Non-Color", (0.5, 0.5, 1.0, 1.0))
    tx.bake([body], "NORMAL", {mat: normal}, samples=4, normal_space="TANGENT")
    rep["skinNormalTexelsFlattened"] = tx.flatten_normal_outliers(normal, sk.get("normalFlatZ", 0.45), sk.get("normalKeepZ", 0.7))
    rep["lidNormalTexelsFlattened"] = tx.flatten_lid_normals(normal, body, sk.get("lidNormalFlatten", 0.85))
    rough = tx.new_target("skin_rough", size, "Non-Color")
    tx.bake([body], "ROUGHNESS", {mat: rough}, samples=1)
    orm = image_from_array("skin_orm", _orm_from(rough, size), colorspace="Non-Color")
    rep["skin"] = {"size": size, "files": [_png(albedo, out, "skin_albedo"), _png(normal, out, "skin_normal"), _png(orm, out, "skin_orm")]}
    body.data.uv_layers.remove(body.data.uv_layers["UVMap"])
    for name in ("Weather1", "Weather2", "Weather3", "Weather4", "GroomMask"):
        if name in body.data.color_attributes:
            body.data.color_attributes.remove(body.data.color_attributes[name])
    body.data.materials.clear()
    sizes = recipe.get("mapSizes", {})
    normal_s = resized_image(normal, sizes.get("skinNormal", size), "skin_normal_final", "Non-Color")
    orm_s = resized_image(orm, sizes.get("skinOrm", size), "skin_orm_final", "Non-Color")
    body.data.materials.append(tx.final_material("skin", albedo, orm_s, normal_s))

    # ---------------- eyes and mouth
    parts = [bpy.data.objects[n] for n in ("Eyes", "Teeth", "Tongue")]
    lod_parts = [bpy.data.objects[n] for n in ("TeethLow",) if n in bpy.data.objects]
    em_size = recipe["eyesMouthAtlasSize"]
    em_rgb, em_orm = tx.eyes_mouth_atlas(src, recipe, parts + lod_parts, em_size)
    em_base = image_from_array("eyes_mouth_albedo", em_rgb, "sRGB")
    em_ormi = image_from_array("eyes_mouth_orm", em_orm, "Non-Color")
    for p in parts + lod_parts:
        p.data.materials.clear()
        for uv in list(p.data.uv_layers)[1:]:
            p.data.uv_layers.remove(uv)
        p.data.uv_layers[0].name = "UVMap"
    eyes_mouth = tx.join(parts, "EyesMouth")
    strip_color_attributes(eyes_mouth)
    eyes_mouth.data.materials.append(tx.final_material("eyes_mouth", em_base, resized_image(em_ormi, sizes.get("eyesOrm", em_size), "eyes_mouth_orm_final", "Non-Color")))
    rep["eyesMouth"] = {"size": em_size, "files": [_png(em_base, out, "eyes_mouth_albedo"), _png(em_ormi, out, "eyes_mouth_orm")]}

    # ---------------- cloth
    cl = recipe["cloth"]
    stats = {}
    for fid in {spec["fabric"] for spec in cl["pieces"].values()}:
        folder = os.path.join(src["polyhaven"], fid)
        if not any("_diff_" in f or "_albedo_" in f for f in os.listdir(folder)):
            folder = os.path.join(folder, "textures")  # a Poly Haven model's maps used as a material swatch
        files = os.listdir(folder)
        diff = next(f for f in files if "_diff_" in f or "_albedo_" in f)
        armf = next((f for f in files if "_arm_" in f), None) or next(f for f in files if "_rough_" in f)
        stats[fid] = {"diff": os.path.join(folder, diff), "arm": os.path.join(folder, armf),
                      "meanLum": tx.mean_luminance(os.path.join(folder, diff))}
    pieces = [o for o in bpy.data.objects if o.get("crownfall_part") == "garment"]
    bake_mats = {}
    for o in pieces:
        spec = cl["pieces"][o.name]
        m = tx.fabric_material(o.name, spec, src["polyhaven"], stats)
        bake_mats[o.name] = m
        o.data.materials.clear()
        o.data.materials.append(m)
        keep = o.get("crownfall_uv") == "grid" and "UVMap" in o.data.uv_layers
        for uv in list(o.data.uv_layers):
            if not (keep and uv.name == "UVMap"):
                o.data.uv_layers.remove(uv)
        if not keep:
            o.data.uv_layers.new(name="UVMap")
            if "crownfall_keep_uv" in o.data.attributes:
                o.data.attributes.remove(o.data.attributes["crownfall_keep_uv"])
    # which garment each face came from (for the per-clip layer penetration check, review/penetration_check.py)
    names = sorted(o.name for o in pieces)
    for o in pieces:
        attr = o.data.attributes.new("garment_piece", "INT", "FACE")
        attr.data.foreach_set("value", [names.index(o.name)] * len(o.data.polygons))
    clothes = tx.join(pieces, "Clothes")
    clothes["garment_names"] = names
    # faces added with bmesh (folded hems, rims) default to flat shading and showed as facets on the
    # head-cloths and hood edges: smooth everything, keeping only real creases (folds) sharp, before the
    # normal bake so the baked tangent frames match what the renderer shades
    select_only([clothes])
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(cl.get("smoothAngleDeg", 55.0)), keep_sharp_edges=False)
    rep["clothGridEdgesSmoothed"] = tx.smooth_kept_grid(clothes)
    rep["clothUvOverlapsRemaining"] = tx.unwrap_without_overlaps(clothes)
    rep["clothGridUvFaces"] = int(sum(tx.kept_uv_faces(clothes)))
    csize = cl["atlasSize"]
    c_albedo = tx.new_target("cloth_albedo", csize, "sRGB")
    tx.bake([clothes], "DIFFUSE", {m: c_albedo for m in clothes.data.materials}, samples=cl.get("bakeSamples", 4), pass_filter={"COLOR"})
    rep["clothGutterTexelsFilled"] = tx.fill_gutters(c_albedo, clothes, "UVMap")
    c_normal = tx.new_target("cloth_normal", csize, "Non-Color", (0.5, 0.5, 1.0, 1.0))
    tx.bake([clothes], "NORMAL", {m: c_normal for m in clothes.data.materials}, samples=4, normal_space="TANGENT")
    rep["clothNormalTexelsFlattened"] = tx.flatten_normal_outliers(c_normal, cl.get("normalFlatZ", 0.35), cl.get("normalKeepZ", 0.55))
    c_rough = tx.new_target("cloth_rough", csize, "Non-Color")
    tx.bake([clothes], "ROUGHNESS", {m: c_rough for m in clothes.data.materials}, samples=1)
    c_orm = image_from_array("cloth_orm", _orm_from(c_rough, csize), colorspace="Non-Color")
    rep["cloth"] = {"size": csize, "fabrics": {k: {"diff": os.path.basename(v["diff"]), "arm": os.path.basename(v["arm"]),
                                                    "meanLum": round(v["meanLum"], 4)} for k, v in stats.items()},
                    "files": [_png(c_albedo, out, "cloth_albedo"), _png(c_normal, out, "cloth_normal"), _png(c_orm, out, "cloth_orm")]}
    clothes.data.materials.clear()
    strip_color_attributes(clothes)
    clothes.data.materials.append(tx.final_material("cloth", c_albedo, resized_image(c_orm, sizes.get("clothOrm", csize), "cloth_orm_final", "Non-Color"),
                                                    resized_image(c_normal, sizes.get("clothNormal", csize), "cloth_normal_final", "Non-Color"), double_sided=True))
    clothes["crownfall_part"] = "clothes"

    # ---------------- groom
    groom_parts = [bpy.data.objects[n] for n in ("Hair", "Beard", "Brows", "Eyelashes") if n in bpy.data.objects]
    atlas = np.load(os.path.join(out, "textures", "strands.npy"))
    strands = image_from_array("strands", atlas, "sRGB")
    kinds = {"Hair": 0, "Beard": 1, "Brows": 2, "Eyelashes": 3}
    for p in groom_parts:
        p.data.materials.clear()
        for uv in list(p.data.uv_layers)[1:]:
            p.data.uv_layers.remove(uv)
        p.data.uv_layers[0].name = "UVMap"
        # which card set each face came from: the LOD levels keep scalp and beard cards only (brows and
        # lashes are carried by the skin paint there; alpha-tested at that size they broke into black stitches)
        attr = p.data.attributes.new("groom_kind", "INT", "FACE")
        attr.data.foreach_set("value", [kinds[p.name]] * len(p.data.polygons))
    groom = tx.join(groom_parts, "Groom")
    # blended cards draw in index order with depth writes off: order the faces from the head outward, so outer
    # cards draw over inner ones from any outside view (no per-frame sorting is needed)
    arm_obj = bpy.data.objects["Rig"]
    head_c = (arm_obj.data.bones["head"].head_local + arm_obj.data.bones["head"].tail_local) * 0.5
    select_only([groom])
    bpy.context.scene.cursor.location = head_c
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.sort_elements(type="CURSOR_DISTANCE", elements={"FACE"})
    bpy.ops.object.mode_set(mode="OBJECT")
    groom.data.materials.append(tx.final_material("hair", strands, alpha=recipe["groom"].get("alphaMode", "blend"), double_sided=True, vertex_colour=True,
                                                  roughness=recipe["groom"].get("roughness", 0.72), specular=recipe["groom"].get("specular", 0.22),
                                                  alpha_cutoff=recipe["groom"].get("alphaCutoff", 0.35)))
    rep["groom"] = {"size": int(atlas.shape[0]), "files": [_png(strands, out, "strands")]}
    for o in (body, clothes, eyes_mouth, groom):
        o["crownfall_part"] = o.name.lower()


def _skin_file(src, recipe):
    folder = os.path.join(src["systemAssets"], "skins", recipe["parts"]["skin"])
    import mh
    mat = mh.load_mhmat(os.path.join(folder, recipe["parts"]["skin"] + ".mhmat"))
    return mat["diffuseTexture"]

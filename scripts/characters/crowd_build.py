"""Build crowd residents of the Ealdholt village population in headless Blender (original Crownfall code).

    PYTHON_WITH_BPY -I scripts/characters/crowd_build.py --sources PRIVATE/sources.json \
        --recipes RECIPE_DIR --out BUILD_DIR [--only id,id,...] [--keep-blend]

RECIPE_DIR is the output of `tsx scripts/characters/crowd_recipes.ts RECIPE_DIR` (one JSON per crowd resident). For
each resident: crowd_body (shaped on the archetype's shared skeleton), crowd_outfits (role kit), crowd_hair (hair,
beard, headwear), crowd_lod (head loops, decimation to the crowd budget), face_rig (joints-only lid and jaw weights
and calibration), crowd_textures (one 512 atlas baked from the source materials) and crowd_export (GLB without clips
or morphs, measured facts). Writes BUILD_DIR/<id>/<id>.glb, <id>.json (resident manifest) and report.json; the work
.blend is kept only with --keep-blend (disk is tight: a resident's final files are well under 1 MB). Inputs are read
only. It reads CC0 MakeHuman data and CC0 Poly Haven fabrics; it does not run MPFB2 or any GPL add-on code.
"""
import argparse
import json
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))

import bpy  # noqa: E402


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser(description="Build crowd residents")
    p.add_argument("--sources", required=True)
    p.add_argument("--recipes", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--only", default="")
    p.add_argument("--keep-blend", action="store_true")
    p.add_argument("--atlas", type=int, default=512)
    p.add_argument("--props", action="store_true", help="build the seven shared prop-kit GLBs into OUT/props instead")
    return p.parse_args(argv)


def build_props(src, recipes_dir, out):
    import crowd_props
    pop = json.load(open(os.path.join(recipes_dir, "population.json")))
    os.makedirs(out, exist_ok=True)
    report = {}
    kits = sorted({p["kit"] for p in pop["props"]})
    for kit in kits:
        props = [p for p in pop["props"] if p["kit"] == kit]
        crowd_props.build_kit(kit, props, src["polyhaven"], os.path.join(out, f"crowd-props-{kit}-v1.glb"), report)
        print(f"PROPS {kit} {len(props)} props {report[kit]['bytes']} bytes", flush=True)
    with open(os.path.join(out, "props-report.json"), "w") as h:
        json.dump(report, h, indent=1, sort_keys=True)
    return report


def build_one(src, recipe, out_dir, atlas_px=512, keep_blend=False):
    import crowd_body
    import crowd_export
    import crowd_hair
    import crowd_lod
    import crowd_outfits
    import crowd_textures as CT
    import face_rig
    from scene import triangle_count
    report = {"residentId": recipe["residentId"], "recipeGenerator": recipe.get("generator")}
    t = {}
    t0 = time.time()
    built = crowd_body.build(src, recipe, report)
    arm, body, eyes = built["arm"], built["body"], built["eyes"]
    garments = crowd_outfits.build(body, arm, recipe, report)
    hair = crowd_hair.build(body, arm, recipe, garments, report)
    t["shape"] = time.time() - t0
    t1 = time.time()
    budget = recipe["budget"]["triangles"]
    cavity, spheres = crowd_lod.prepare_head(body, eyes, arm, report)
    # targets: the head keeps ~1000, the skin elsewhere (hands, forearms, neck) shares what is left
    lod = recipe.get("lod", {})
    body_target = lod.get("bodyTriangles", 1500)
    head_tris = crowd_lod.decimate_body(body, eyes, arm, spheres, body_target, lod, report)
    for _attempt in range(3):
        if head_tris >= budget["headMin"]:
            break
        body_target = int(body_target + (budget["headMin"] - head_tris) * 1.6 + 20)
        head_tris = crowd_lod.decimate_body(body, eyes, arm, spheres, body_target, lod, report)
    if "_crowd_full" in body:
        bpy.data.meshes.remove(bpy.data.meshes[body["_crowd_full"]])
        del body["_crowd_full"]
    if cavity is not None:
        crowd_lod.decimate_to(cavity, 40)
    fixed = triangle_count(body) + triangle_count(eyes) + (triangle_count(cavity) if cavity else 0)
    hair_target = lod.get("hairTriangles", 380)
    beard = {k: v for k, v in hair.items() if v.get("crowd_slot") == "beard"}
    for v in beard.values():  # a full beard keeps its own share: decimated with the hair it broke into patches
        crowd_lod.decimate_to(v, lod.get("beardTriangles", 260))
    # generated headwear parts (tails, lappets, bands, brims, straps) are built at crowd density and keep their shape;
    # headwear shells are cleaned of non-manifold faces first and decimated with their rims kept (art fixer, 8 November)
    acc = {k: v for k, v in hair.items() if v.get("crowd_accessory")}
    shells = {k: v for k, v in hair.items() if v.get("crownfall_part") == "headwear" and k not in acc}
    report["headwearCleaned"] = {k: crowd_lod.clean_shell(v) for k, v in shells.items()}
    pre = {k: v.data.copy() for k, v in shells.items()}
    rest = {k: v for k, v in hair.items() if k not in beard and k not in acc}
    hair_tris = ((crowd_lod.decimate_pieces(rest, hair_target, report, "hair") if rest else 0) + sum(triangle_count(v) for v in beard.values())
                 + sum(triangle_count(v) for v in acc.values()))
    # a hood is head shape, not cloth area: shared by area it fell to about 100 triangles and collapsed into a spike once
    # no hair mass was left under it (population generator, 7 November); it keeps its own share like a full beard
    hoods = {k: v for k, v in garments.items() if k == "Hood"}
    for v in hoods.values():
        crowd_lod.clean_shell(v)
        crowd_lod.decimate_to(v, lod.get("hoodTriangles", 380), protect=True)
    hood_tris = sum(triangle_count(v) for v in hoods.values())
    garment_target = budget["nominal"] - fixed - hair_tris - hood_tris
    crowd_lod.decimate_pieces({k: v for k, v in garments.items() if k not in hoods}, max(900, garment_target), report, "garments")
    crowd_lod.restack_layers(garments, report, body=body)
    crowd_lod.remove_hidden_layers(body, arm, garments, report)
    for k in [k for k, o in garments.items() if len(o.data.polygons) == 0]:
        bpy.data.objects.remove(garments.pop(k))
    crowd_lod.ground_soles(garments, report)
    report["headwearShardFaces"] = {k: crowd_lod.drop_shards(v) for k, v in list(shells.items()) + list(hoods.items())}
    gate = crowd_lod.headwear_gate(body, arm, hair, garments, recipe, report)
    if not gate["pass"] and pre:
        # one retry with the shells at a larger share before the resident is refused
        for k, me in pre.items():
            old = shells[k].data
            shells[k].data = me
            bpy.data.meshes.remove(old)
            crowd_lod.decimate_to(shells[k], int(hair_target * 0.9), protect=True)
            crowd_lod.drop_shards(shells[k])
        report["headwearRetry"] = gate
        gate = crowd_lod.headwear_gate(body, arm, hair, garments, recipe, report)
    else:
        for me in pre.values():
            bpy.data.meshes.remove(me)
    t["lod"] = time.time() - t1
    t2 = time.time()
    # face by joints: lid and jaw weights from the head's own loops, calibrated with the eyeballs
    rep = report.setdefault("faceRig", {})
    cal = None
    try:
        info = face_rig.author_lod_face_weights(body, arm, rep)
        child = recipe["archetype"] == "child"
        cal = face_rig.calibrate(body, arm, info, lower_closed=-0.15, jaw_open=0.262,
                                 full_gap=(0.015 if child else 0.018) / report["crowdBody"]["placementScale"], eyes_obj=eyes)
        rep["calibration"] = cal
    except Exception as exc:  # recorded, never hidden: the resident is flagged in its manifest
        rep["error"] = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()
    t["faceRig"] = time.time() - t2
    t3 = time.time()
    # bake materials, join, atlas
    stats = CT.fabric_stats(src["polyhaven"])
    body.data.uv_layers[0].name = "SrcUV"
    eyes.data.uv_layers[0].name = "SrcUV"
    CT._hand_attribute(body)
    mats = {"skin": CT.skin_material(src, recipe, body, arm, spheres), "eyes": CT.eyes_material(src, recipe),
            "mouth": CT.flat_material("mouth", (0.035, 0.012, 0.01), 0.0)}
    hcol = CT.hair_colour(recipe["hair"]["colour"])
    objs = [body, eyes] + ([cavity] if cavity else [])
    body.data.materials.clear(); body.data.materials.append(mats["skin"])
    eyes.data.materials.clear(); eyes.data.materials.append(mats["eyes"])
    if cavity:
        cavity.data.materials.clear(); cavity.data.materials.append(mats["mouth"])
    cloth_cache = {}
    for name, o in list(garments.items()) + list(hair.items()):
        slot, fabric = o.get("crowd_slot", "main"), o.get("crowd_fabric", "")
        marks = json.loads(o["crowd_marks"]) if "crowd_marks" in o else None
        if slot in ("hair", "beard"):
            key = ("hair", slot, json.dumps(marks) if marks else "")
            if key not in cloth_cache:
                cloth_cache[key] = CT.hair_material(slot, hcol if slot == "hair" else tuple(c * 0.7 for c in hcol), slot, recipe["seed"],
                                                    marks, recipe["outfit"]["colours"])
        else:
            key = (slot, fabric, json.dumps(marks) if marks else "")
            if key not in cloth_cache:
                cloth_cache[key] = CT.cloth_material(f"{slot}_{len(cloth_cache)}", slot, fabric, recipe, src["polyhaven"], stats, marks)
        o.data.materials.clear()
        o.data.materials.append(cloth_cache[key])
        objs.append(o)
    for o in objs:
        for p in o.data.polygons:
            p.use_smooth = True
    if os.environ.get("CROWD_DEBUG_PREJOIN"):
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, "prejoin.blend"), compress=True)
    crowd = crowd_export.join(objs, "Crowd")
    neck_z = float(arm.data.bones["neck"].tail_local.z)
    skin_index = next(i for i, s in enumerate(crowd.material_slots) if s.material.name.startswith("bake_skin"))
    eyes_index = next(i for i, s in enumerate(crowd.material_slots) if s.material.name.startswith("bake_eyes"))

    def head_face(f):
        return f.material_index in (skin_index, eyes_index) and f.calc_center_median().z > neck_z
    CT.atlas_unwrap(crowd, face_scale=lod.get("faceTexelScale", 2.0), head_test=head_face)
    img = CT.bake_atlas(crowd, atlas_px, samples=lod.get("bakeSamples", 4))
    t["texture"] = time.time() - t3
    t4 = time.time()
    os.makedirs(out_dir, exist_ok=True)
    final = CT.final_material(img)
    crowd_export.finalize(crowd, final)
    tex_path = os.path.join(out_dir, "albedo.png")
    img.filepath_raw = tex_path
    img.file_format = "PNG"
    img.save()
    glb = os.path.join(out_dir, recipe["residentId"] + ".glb")
    crowd_export.export(arm, crowd, glb)
    manifest = crowd_export.manifest(recipe, report, glb, cal, head_tris, built)
    t["export"] = time.time() - t4
    report["stageSeconds"] = {k: round(v, 1) for k, v in t.items()}
    report["totalSeconds"] = round(time.time() - t0, 1)
    manifest["build"] = {"seconds": report["totalSeconds"], "stageSeconds": report["stageSeconds"]}
    with open(os.path.join(out_dir, recipe["residentId"] + ".json"), "w") as h:
        json.dump(manifest, h, indent=1, sort_keys=True)
    with open(os.path.join(out_dir, "report.json"), "w") as h:
        json.dump(report, h, indent=1, sort_keys=True, default=str)
    if keep_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, "work.blend"), compress=True)
    return manifest


def main():
    args = parse()
    src = json.load(open(args.sources))
    if args.props:
        build_props(src, args.recipes, os.path.join(os.path.abspath(args.out), "props"))
        return
    only = {s for s in args.only.split(",") if s}
    files = sorted(f for f in os.listdir(args.recipes) if f.startswith("ealdholt-") and f.endswith(".json"))
    done = []
    for f in files:
        rid = f[:-5]
        if only and rid not in only:
            continue
        recipe = json.load(open(os.path.join(args.recipes, f)))
        if recipe.get("kind") != "crowd":
            continue
        out = os.path.join(os.path.abspath(args.out), rid)
        started = time.time()
        try:
            m = build_one(src, recipe, out, args.atlas, args.keep_blend)
            print(f"BUILT {rid} {round(time.time() - started, 1)}s tris={m['measured']['triangles']} "
                  f"bytes={m['measured']['fileBytes']} scale={m['placementScale']}", flush=True)
            done.append(rid)
        except Exception:
            traceback.print_exc()
            print(f"FAILED {rid}", flush=True)
    print(f"DONE {len(done)} residents", flush=True)


if __name__ == "__main__":
    main()

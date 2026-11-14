#!/usr/bin/env python3
"""Publish a built resident into the desktop asset tree with provenance and a measured manifest.

    python3 scripts/characters/publish_resident.py --sources PRIVATE/sources.json \
        --recipe scripts/characters/recipes/village-smith.json --build BUILD_DIR

Copies BUILD_DIR/glb/*.glb into main game/public/assets/legacy/environment/aethelgard/characters/<set>/
(mirrored to Quest by scripts/sync-legacy-environment-assets.mjs) and writes SOURCES.md,
provenance.json, manifest.json and the licence texts beside them. Standard library only.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(HERE, "lib"))
import measure  # noqa: E402

DOWNLOADED = "2026-11-06"
MPFB_COMMIT = "6ff1eb358f6c1959ced77e79e6dd2406d9a71f49"
CC0 = {"spdx": "CC0-1.0", "legalCodeUrl": "https://creativecommons.org/publicdomain/zero/1.0/legalcode"}
CCBY = {"spdx": "CC-BY-4.0", "legalCodeUrl": "https://creativecommons.org/licenses/by/4.0/legalcode"}
STYLE100_ATTRIBUTION = ("100STYLE dataset by Ian Mason, Sebastian Starke and Taku Komura (2022), CC BY 4.0, "
                        "doi:10.1145/3522618. Retargeted, trimmed, straightened, loop-closed and foot-locked.")
PROP_TO_POLYHAVEN = {"prop_hammer": "cross_pein_hammer", "prop_basket": "wicker_basket_01", "prop_bucket": "wooden_bucket_01",
                     "prop_bucket_small": "wooden_bucket_01", "prop_spoon": "wooden_spoon", "prop_bowl": "wooden_bowl_01",
                     "prop_stool": "wooden_stool_01"}
KIT_TEXT = {
    "smith": {"original": "Garments, hair/beard/brow cards and strand atlas, weathering, tongs, anvil, stump, workpiece, the hammering loop, the work entry and exit, talk gestures, face clips "
                          "and all procedural materials are original Crownfall work authored by the pipeline (repository licence).",
              "short": "garments, hair/beard/brow cards and strand atlas, weathering and procedural materials, tongs, anvil, stump, workpiece, the hammering loop, talk and face clips",
              "props": "The hammer is used as modelled; fabrics are recoloured and baked."},
    "spinner": {"original": "Garments (underdress, overdress, shawl, apron, head-cloth, woven belt, knife sheath, keys, skeins), hair and brow cards and strand atlas, "
                            "weathering, the drop spindle with yarn and fibre roll, the drop-spindle loop and the spindle's spin, the work entry and exit, talk gestures, face clips and all procedural materials are original "
                            "Crownfall work authored by the pipeline (repository licence).",
                "short": "garments, hair and brow cards and strand atlas, weathering and procedural materials, drop spindle and fibre roll, the drop-spindle loop, talk and face clips",
                "props": "The basket and bucket are decimated for runtime; fabrics are recoloured and baked."},
    "child": {"original": "Garments (shirt, leggings, cut-down tunic, fleece-lined vest, cord belt, pouch, whistle on a cord, hair ribbon, a kindling bundle carried on the back with its cords and strap), tied-back hair and brow "
                          "cards and strand atlas, weathering, the bellows lever, post, bellows, chain and forge hearth, the bellows loop and its animated mechanism (lever, top board, pleats, chain), the work entry and exit, talk gestures, face clips and all "
                          "procedural materials are original Crownfall work authored by the pipeline (repository licence).",
              "short": "garments, hair and brow cards and strand atlas, weathering and procedural materials, bellows, lever, post, chain and hearth, the bellows loop, talk and face clips",
              "props": "The small bucket is decimated and scaled; fabrics are recoloured and baked."},
    "elder": {"original": "Garments (shift, kirtle, hooded cloak with shoulder cape and toggle, head-cloth, fingerless mitts, shoes and wraps), hair and brow cards and "
                          "strand atlas, weathering, the walking stick, whittling knife and wooden mallet, the stick planting and grip, stoop, seated whittling loop, seated rest, "
                          "sit-down, stand-up, the work entry and exit, talk gestures, face clips and all procedural materials are original Crownfall work authored by the pipeline (repository licence).",
              "short": "garments, hair and brow cards and strand atlas, weathering and procedural materials, walking stick, whittling knife, the stick planting and grip, seated whittling, seated rest, sit-down, stand-up, talk gestures and face clips",
              "props": "The spoon, bowl and stool are decimated (stool scaled to seat height); the mallet is original; fabrics are recoloured and baked."},
}
ACTOR = {  # same shape as HouseholdArtSet.actorMotions / propsByClip in shared/legacy/aethelgard/characters/household-art-sets.ts
    "smith": ({"idle": "idle", "walk": "walk", "talk": "talk", "sit": None, "work": "work_hammer",
               "extra": {"start": "walk_start", "stop": "walk_stop", "workEnter": "work_enter", "workExit": "work_exit"}},
              {c: [["prop_hammer", "hand_r"], ["prop_tongs", "hand_l"]] for c in ("work_hammer", "work_enter", "work_exit")}),
    "spinner": ({"idle": "idle", "walk": "walk", "talk": "talk", "sit": None, "work": "work_spindle",
                 "extra": {"start": "walk_start", "stop": "walk_stop", "workEnter": "work_enter", "workExit": "work_exit"}},
                {c: [["prop_spindle", "hand_l"], ["prop_spindle_yarn", "hand_l"], ["prop_fibre_roll", "hand_l"]]
                 for c in ("work_spindle", "work_enter", "work_exit")}),
    "child": ({"idle": "idle", "walk": "walk", "talk": "talk", "sit": None, "work": "work_bellows",
               "extra": {"start": "walk_start", "stop": "walk_stop", "workEnter": "work_enter", "workExit": "work_exit"}},
              {}),
    "elder": ({"idle": "idle", "walk": "walk", "talk": "talk", "sit": "sit", "work": "work_carving",
               "extra": {"start": "walk_start", "stop": "walk_stop", "sitDown": "sit_down", "standUp": "stand_up",
                         "workEnter": "work_enter", "workExit": "work_exit"}},
              {**{c: [["prop_stick", "hand_l"]] for c in ("idle", "walk", "walk_start", "walk_stop", "talk", "sit_down", "stand_up", "sit")},
               "work_carving": [["prop_knife", "hand_r"], ["prop_spoon", "hand_l"]],
               **{c: [["prop_stick", "hand_l"], ["prop_knife", "hand_r"], ["prop_spoon", "hand_l"]] for c in ("work_enter", "work_exit")}}),
}
# resting copies of held props (HouseholdArtSet.restingProps): the workstation (bone None) or a girdle (hips joint)
RESTING = {
    "smith": {"prop_hammer": [["prop_hammer_rest", None]], "prop_tongs": [["prop_tongs_rest", None], ["prop_workpiece_rest", None]]},
    "spinner": {"prop_fibre_roll": [["prop_fibre_roll_rest", "hips"]], "prop_spindle": [["prop_spindle_rest", "hips"]], "prop_spindle_yarn": []},
    "child": {},
    "elder": {"prop_stick": [["prop_stick_rest", None]], "prop_knife": [["prop_knife_rest", "hips"]], "prop_spoon": [["prop_spoon_rest", "hips"]]},
}
# where each clip's motion comes from (per-clip provenance; 100STYLE is CC BY 4.0 wherever it contributes)
CLIP_ORIGIN = {
    "idle": "100STYLE capture (CC BY 4.0), retargeted; feet grounded on the walk's stance, sway and weight shift added by Crownfall",
    "walk": "100STYLE capture (CC BY 4.0), retargeted, straightened, re-aimed, loop-closed and foot-locked by Crownfall",
    "walk_start": "Crownfall-built from this resident's 100STYLE-derived idle and walk (CC BY 4.0 attribution applies)",
    "walk_stop": "Crownfall-built from this resident's 100STYLE-derived walk and idle (CC BY 4.0 attribution applies)",
    "talk": "Crownfall-built from this resident's 100STYLE-derived idle with original head and open-hand gestures (CC BY 4.0 attribution applies)",
    "work": "original Crownfall keyframes and IK; the standing or seated base pose starts from this resident's 100STYLE-derived idle",
    "sit": "original Crownfall keyframes and IK (seated rest)",
    "sit_down": "original Crownfall keyframes and IK between the 100STYLE-derived idle and the seated rest",
    "stand_up": "original Crownfall keyframes and IK between the seated rest and the 100STYLE-derived idle",
    "work_enter": "original Crownfall keyframes and IK (round 2) from this resident's 100STYLE-derived idle (or the seated rest) into the work loop",
    "work_exit": "original Crownfall keyframes and IK (round 2) from the work loop back to this resident's 100STYLE-derived idle (or the seated rest)",
    "face": "original Crownfall face clips (face joints only)",
}
CLIP_KEYS = ("speedMetresPerSecond", "strideMetres", "rootTravelMetres", "impactSeconds", "sourceSeamDegrees", "contactFrames",
             "stanceWindows", "stanceShare", "swingLiftCm", "toeOutDegrees", "facingCorrectionDegrees", "pelvisDropCm",
             "endsOnWalkFrame", "startDistanceMetres", "stopDistanceMetres", "accelerationSeconds", "decelerationSeconds",
             "firstStepLiftFrame", "leftLandsFrame", "closingStepFrames", "lateralMismatchCm", "impactChecks", "strokeSeconds",
             "bladeToSurfaceCm", "faceCues", "draftSeconds", "twirlSeconds", "twirlPinchToShaftCm", "turnsPerLoop", "spinRevPerSecond",
             "pumpsPerLoop", "leverDegrees", "lidMaxDegrees", "chainLengthMetres", "palmToBarErrorCm", "mechanismNodes",
             "propSwaps", "from", "headToFibreArmMinCm", "headToFibreRollMinCm", "fibreWristAboveShoulderMaxCm", "freeArmSwingKept",
             "swayCm", "swayCycles", "weightShifts", "endVelocity")


def clip_origin(name):
    if name.startswith("face_"):
        return CLIP_ORIGIN["face"]
    return CLIP_ORIGIN.get(name) or (CLIP_ORIGIN["work"] if name.startswith("work_") else "Crownfall")


def clip_events(work_name, info):
    """Clip timing for the integration, the same table as HouseholdArtSet.events."""
    ev = {}
    for key in ("impactSeconds", "strokeSeconds", "draftSeconds", "twirlSeconds"):
        if key in info:
            v = info[key]
            ev[key] = [round(x, 4) for x in (v if isinstance(v, list) else [v])]
    if "pumpsPerLoop" in info:
        ev["pullSeconds"] = [round(i * info["seconds"] / info["pumpsPerLoop"], 4) for i in range(info["pumpsPerLoop"])]
    return {work_name: ev} if ev else {}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def rel_hash(base, rel):
    path = os.path.join(base, rel)
    return {"path": rel, "bytes": os.path.getsize(path), "sha256": sha256(path)}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--sources", required=True)
    ap.add_argument("--recipe", required=True)
    ap.add_argument("--build", required=True)
    args = ap.parse_args()
    src = json.load(open(args.sources))
    recipe = json.load(open(args.recipe))
    report = json.load(open(os.path.join(args.build, "report.json")))
    set_name = recipe["set"]
    dest = os.path.join(REPO, "main game", "public", "assets", "legacy", "environment", "aethelgard", "characters", set_name)
    os.makedirs(dest, exist_ok=True)
    glb_dir = os.path.join(args.build, "glb")
    outputs = []
    for name in sorted(os.listdir(glb_dir)):
        if name.endswith(".glb"):
            shutil.copyfile(os.path.join(glb_dir, name), os.path.join(dest, name))
            outputs.append(name)

    data = src["mpfbData"]
    sysdir = src["systemAssets"]
    parts = recipe["parts"]
    used_targets = sorted({t for t, _w in report.get("macroTargets", [])} | {t for t, _w in report.get("detailTargets", [])})
    makehuman = {
        "source": f"https://github.com/makehumancommunity/mpfb2/tree/{MPFB_COMMIT}/src/mpfb/data",
        "author": "MakeHuman team (Data Collection AB, Joel Palmius, Jonas Hauquier)", "licence": CC0,
        "evidence": "LICENSE.md section C and LICENSE.ASSETS.md: base mesh, proxies, targets, textures, rigs and mesh JSON are CC0 1.0. "
                    "MPFB2 program code (GPL-3.0) was not executed, copied or redistributed.",
        "files": [rel_hash(data, "3dobjs/base.obj"), rel_hash(data, f"rigs/standard/rig.{recipe['rig']}.json"),
                  rel_hash(data, f"rigs/standard/weights.{recipe['rig']}.json"),
                  rel_hash(data, "uv_layers/lips_solid.json.gz")] + [rel_hash(data, t) for t in used_targets],
    }
    head_source = report.get("parts", {}).get("HeadProxy", {}).get("source") or ""
    lod0_head = "LOD0 head" in head_source  # round 2: the LOD head is derived from the resident's own LOD0 head
    proxy = None if lod0_head else (head_source.replace(".proxy", "") or ("male1591" if recipe["macro"]["gender"] >= 0.5 else "female1605"))
    skin_dir = os.path.join("skins", parts["skin"])
    skin_png = next(f for f in os.listdir(os.path.join(sysdir, skin_dir)) if f.endswith(".png"))
    system = {
        "source": "https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip",
        "archiveSha256": "b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107", "author": "makehuman_system",
        "licence": CC0, "evidence": "Pack manifest lists 94/94 assets CC0; every mhclo/mhmat/obj used carries the CC0 release header.",
        "files": [rel_hash(sysdir, os.path.join(skin_dir, skin_png)),
                  rel_hash(sysdir, os.path.join("eyes", parts["eyesMesh"], parts["eyesMesh"] + ".mhclo")),
                  rel_hash(sysdir, os.path.join("eyes", parts["eyesMesh"], parts["eyesMesh"] + ".obj")),
                  rel_hash(sysdir, os.path.join("eyes", "materials", parts["eyeTexture"])),
                  rel_hash(sysdir, "teeth/teeth_base/teeth_base.mhclo"), rel_hash(sysdir, "teeth/teeth_base/teeth_base.obj"),
                  rel_hash(sysdir, "tongue/tongue01/tongue01.mhclo"),
                  rel_hash(sysdir, "tongue/tongue01/tongue01.obj"), rel_hash(sysdir, "tongue/tongue01/tongue01_diffuse.png"),
                  rel_hash(sysdir, os.path.join("eyelashes", parts["eyelashes"], parts["eyelashes"] + ".mhclo")),
                  rel_hash(sysdir, os.path.join("eyelashes", parts["eyelashes"], parts["eyelashes"] + ".obj")),
                  rel_hash(sysdir, os.path.join("eyelashes", parts["eyelashes"], parts["eyelashes"] + ".png"))]
                 + ([rel_hash(sysdir, os.path.join("proxymeshes", proxy, proxy + ext)) for ext in (".proxy", ".obj")] if proxy else []),
    }
    face = {}
    for pack, sub, names, archive in (("faceunits01", "faceunits", recipe["faceMorphs"]["arkit"], "d113107bd7eb59f3af4df6fc0ec29bfcc593f496d0b336aec14f086a80ce7146"),
                                      ("visemes02", "visemes", recipe["faceMorphs"]["visemes"], "a69ab6fb95ddd5f56f70acc7e859f5f9c6ae613c527d577ea1571eff2183d29e")):
        base = src["facePacks"][pack]
        face[pack] = {"source": f"https://files.makehumancommunity.org/functional/{pack}.zip", "archiveSha256": archive,
                      "author": "Mika Suominen", "licence": CC0, "evidence": f"packs/{pack}.json lists licence CC0 for every target.",
                      "files": [rel_hash(base, os.path.join("targets", sub, n + ".target")) for n in names]}
    s100 = src["style100"]
    motion = report.get("motion", {})
    used_bvh = sorted({f"{m.group(1)}/{m.group(1)}_{m.group(2)}.bvh" for v in motion.values() if isinstance(v, dict)
                       for m in re.finditer(r"100STYLE (\w+?)_(FW|ID|TR1)", str(v.get("source", "")))})
    style100 = {"source": "https://zenodo.org/records/8127870", "author": "Ian Mason, Sebastian Starke, Taku Komura",
                "licence": CCBY, "attribution": STYLE100_ATTRIBUTION,
                "evidence": "Zenodo record licence cc-by-4.0 covers 100STYLE.zip (1,468,515,354 bytes, md5 3cf627852fd8192024c04a8d0ef49583); members read by HTTP range requests.",
                "files": [rel_hash(s100, f) for f in used_bvh],
                "clips": {k: v["source"] for k, v in motion.items() if isinstance(v, dict) and "100STYLE" in str(v.get("source", ""))}}
    intake = json.load(open(os.path.join(src["polyhaven"], "intake.json")))
    kit = recipe.get("props", {}).get("kit", "smith")
    prop_models = report.get("props", {}).get("polyhavenModels") or sorted(
        {PROP_TO_POLYHAVEN[n] for n in report.get("props", {}).get("triangles", {}) if n in PROP_TO_POLYHAVEN})
    used_ph = ({"cross_pein_hammer"} if kit == "smith" else set(prop_models)) | {spec["fabric"] for spec in recipe["cloth"]["pieces"].values()}
    polyhaven = {"licence": dict(CC0, officialUrl="https://polyhaven.com/license", officialPageSha256=intake["licence"]["officialPageSha256"]),
                 "assets": {k: v for k, v in intake["assets"].items() if k in used_ph}}
    files = []
    for name in outputs:
        path = os.path.join(dest, name)
        files.append({"file": name, "bytes": os.path.getsize(path), "sha256": sha256(path)})
    provenance = {
        "set": set_name, "status": "working-placeholder", "residentId": recipe["residentId"], "downloaded": DOWNLOADED,
        "builtWith": {"pipeline": "scripts/characters/build_resident.py", "recipe": os.path.relpath(os.path.abspath(args.recipe), REPO),
                      "blender": "Blender 5.2.3 LTS (bpy module)", "note": "Original Crownfall code reading the data below; no MPFB2 code executed."},
        "sources": {"makehuman": makehuman, "makehumanSystemAssets": system, "faceMorphPacks": face, "style100": style100, "polyhaven": polyhaven},
        "original": KIT_TEXT[kit]["original"],
        "modifications": [
            "MakeHuman body shaped with the macro and detail targets listed above; rig bones renamed to neutral Crownfall names; breast and buttock weights folded into parents; four skirt bones added.",
            "Face joints re-rolled so local +X pitches and local +Z yaws; 30 ARKit-style and 14 viseme targets added as morphs and propagated to eyes, teeth, tongue, lashes and cards.",
            "Teeth: the MakeHuman teeth only place the arches; the runtime teeth are authored arches (original crowns, gums and texture) "
            "fitted to those positions and lowered so the upper incisal edge sits just below the relaxed upper-lip line, with rigid per-arch "
            "face morphs; the tongue follows the lower arch down and back. The eye cornea shell and the never-visible back of each eyeball "
            "removed and the recessed iris disc lifted onto the eyeball sphere; eye maps recoloured with widened pupils, a lifted, warmer "
            "sclera and a soft limbal ring.",
            "Skin diffuse re-baked into a repacked atlas with weathering, painted crop/stubble, the brow base painted per texel in the brow's "
            "shape, the whole lid-to-brow area recoloured to the forehead's tone (each texel keeps its relative luminance), a lid crease, lash "
            "line and toned waterline, pores and age-line bump; eye maps recoloured and packed. Round 2: the mouth bag darkened with depth "
            "toward the throat (no occluder card), the lid-to-brow area tone-gated against the forehead and cheek, the upper lids evened.",
            ("LOD1 and Quest heads: the resident's own LOD0 head decimated with its lid, lip and atlas-seam loops kept (lod_head.py), eye "
             "sockets and mouth bag removed (a separate dark cavity piece and a light tongue are kept), welded to the decimated body at a neck "
             "seam; the LOD0 skin atlas projected onto it with the LOD0 brow, beard and scalp cards rasterised into it (groom_bake.py), "
             + ("the LOD0 head's normals baked into it, " if any(lv.get("headNormals") == "bake" for lv in recipe["lodBuild"]["levels"])
                else "shaded with its own vertex normals (no normal bake), ")
             + "and the LOD0 face morphs transferred (blink closed exactly at the lid loops)." if lod0_head else
             "LOD1 and Quest heads: MakeHuman's CC0 low-poly proxy mesh (" + str(proxy) + ") fitted to the shaped body, cut at the neck and welded "
             "to the decimated body, its texture coordinates projected onto the LOD0 skin atlas; skin weights from the base mesh."),
            "Poly Haven fabrics recoloured (luminance detail times target colour), worn and baked through box projection into the cloth atlas"
            + ("; the hammer re-pivoted." if kit == "smith" else "."),
            "100STYLE takes retargeted onto the rig (pelvis matched frame to frame), the capture path straightened (heading drift removed), made in-place, loop-closed, head pitch corrected and foot-locked with two-bone IK (one anchor per contact, eased in and out in the air); "
            "walk re-aimed along the chord of its travelled path and the pelvis and shoulder facing (no crab walk), feet turned out 7 degrees, "
            "stance windows detected from the sole heights and an authored heel-to-toe roll locked to the ground (heel rocker, flat foot, heel rise "
            "about the ball), the pelvis lowered where a leg would over-reach, swing clearance at least 1.8 cm; idle grounded on the walk's stance "
            "with sway and a weight shift; walk_start synthesized from the second half of the walk faded in over the idle with real steps from the "
            "idle stance (begins exactly on idle, ends exactly on walk); walk_stop synthesized from the walk with a planted last step and a closing "
            "step onto the idle stance (begins exactly on walk, ends exactly on idle); talk built from the idle with head and open-hand gestures."
            + (" Walk cycles phase-aligned and blended between two styles and time-scaled per resident." if kit != "smith" else ""),
            "LOD1 and Quest meshes: inner layers hidden under whole garments removed or sunk, decimated with the face region protected while "
            "keeping the LOD0 texture coordinates, islands rescaled (face and eyes denser) and repacked, and the LOD0 maps transferred through "
            "the kept coordinates (emission and normal bakes, no ray transfer); card hair thinned.",
            "Clips exported with forced sampling and then pruned (scripts/characters/lib/glb_prune.py): channels that stay at the rest pose "
            "removed and keys that linear or spherical interpolation reproduces within 0.03 degrees / 0.1 mm dropped, first and last keys kept; "
            "body clips never key the face joints and face clips key only them. Mechanism clips (the bellows' lever, top board, pleats and chain; "
            "the spindle's spin) are exported in the props files under the body clip's name.",
            "Props: every prop's material baked into one atlas material per platform (1k desktop, 512 px Quest in the -props-quest file), "
            "static workplace props merged into one mesh, large models halved for Quest; the hammer and spoon frames chosen by the geometry of their ends.",
        ] + (["Poly Haven models imported from the 1k glTF and decimated for runtime (" + ", ".join(prop_models) + ")."] if prop_models else []),
        "clips": {c["name"]: {"origin": clip_origin(c["name"]), "source": motion.get(c["name"], {}).get("source", clip_origin(c["name"]))}
                  for c in motion.get("clips", [])},
        "files": files,
    }
    with open(os.path.join(dest, "provenance.json"), "w") as handle:
        json.dump(provenance, handle, indent=1)

    exports = report["exports"]
    manifest = {"version": 2, "set": set_name, "status": "working-placeholder", "residentId": recipe["residentId"],
                "label": recipe["label"], "levels": {}, "clips": {}, "faceRig": {}, "props": {}}
    for level, facts in exports.items():
        entry = {k: facts[k] for k in ("file", "bytes", "triangles", "vertices", "materialCount", "joints", "maxMorphTargets",
                                        "textureBytes", "decodedTextureBytesEstimate")}
        entry["materials"] = facts["materials"]
        # round 2 budget facts: three.js packs position morphs into a float RGBA texture (16 bytes per vertex per target;
        # normals are not morphed in these files, so the morph texture holds positions only)
        entry["morphTextureBytesEstimate"] = int(sum(m["vertices"] * m["morphTargets"] * 16 * (2 if m.get("morphNormals") else 1)
                                                     for m in facts["meshes"]))
        entry["morphNormals"] = any(m.get("morphNormals") for m in facts["meshes"])
        entry["doubleSidedMaterials"] = sum(1 for m in facts["materials"] if m.get("doubleSided"))
        entry["textures"] = [{k: i[k] for k in ("name", "width", "height", "bytes")} for i in facts["images"]]
        entry["meshes"] = [{k: m[k] for k in ("mesh", "material", "triangles", "vertices", "morphTargets")} for m in facts["meshes"]]
        manifest["levels"][level] = entry
    for anim in exports.get("desktop-lod0", {}).get("animations", []):
        info = motion.get(anim["name"], {})
        clip = {"seconds": anim["seconds"], "interpolations": anim["interpolations"], "paths": anim["paths"], "channels": anim["channels"]}
        for key in CLIP_KEYS:
            if key in info:
                clip[key] = info[key]
        manifest["clips"][anim["name"]] = clip
    manifest["actorMotions"], props_by_clip = ACTOR[kit]
    manifest["propsByClip"] = {clip: [{"node": n, "bone": b} for n, b in items] for clip, items in props_by_clip.items()}
    manifest["workstation"] = {"node": "workplace"}
    manifest["restingProps"] = {k: [{"node": n, "bone": b} for n, b in v] for k, v in RESTING[kit].items()}
    swaps_rep = motion.get("propSwaps", {})

    def expand(entries):  # one row per held node (a swap may change several nodes over at once: "with")
        rows = []
        for x in entries:
            for node in [x["node"]] + list(x.get("with", [])):
                rows.append({"seconds": round(x["seconds"], 4), "node": node, "to": x["to"]})
        return rows
    manifest["workTransitions"] = {"enter": "work_enter", "exit": "work_exit", "from": "sit" if kit == "elder" else "idle",
                                   "swaps": {clip: expand(swaps_rep.get(clip, [])) for clip in ("work_enter", "work_exit")}}
    work_name = manifest["actorMotions"]["work"]
    manifest["events"] = clip_events(work_name, motion.get(work_name, {}))
    cues = motion.get(work_name, {}).get("faceCues")
    manifest["faceCues"] = {work_name: cues} if cues else {}
    pe_all = report.get("propsExport", {})
    manifest["propClips"] = {c: c for c in pe_all.get("propClips", [])}
    manifest["mechanisms"] = pe_all.get("mechanisms", [])
    if motion.get("idle", {}).get("stick"):
        manifest["stick"] = motion["idle"]["stick"]
    manifest["animationPrune"] = {"tool": "scripts/characters/lib/glb_prune.py", "rotationToleranceDegrees": 0.03, "positionToleranceMetres": 1e-4,
                                  "files": report.get("animationPrune", {})}
    manifest["faceRig"] = {
        "joints": ["face_jaw", "face_eye_l", "face_eye_r", "face_lid_upper_l", "face_lid_upper_r", "face_lid_lower_l", "face_lid_lower_r"],
        "convention": "Local +X points to the character's left: +X pitch looks down / closes the upper lid / opens the lower lid / opens the jaw; "
                      "+Z yaws the eyes toward the character's right. Same frames in Blender and in the exported glTF.",
        "morphTargets": recipe["faceMorphs"]["arkit"] + recipe["faceMorphs"]["visemes"],
        "morphLevels": [lvl["id"] for lvl in recipe["lods"] if lvl.get("morphs")],
        "lodCalibration": dict(report.get("lodFaceRig", {}).get("calibration", {}),
                               method="scripts/characters/lib/face_rig.py: LOD1/Quest head lid and jaw weights authored from the eye and "
                                      "mouth loops; upperLidClosed found by bisection so the closed lids overlap 0.6 mm everywhere with the lower "
                                      "lid at lowerLidClosed; jawOpen parts the lips lipGapMm.full at full opening. Radians. Since round 2 the "
                                      "LOD1 and Quest levels also carry the face morphs, so the shared adapters blink and speak by morph there "
                                      "and these joint angles drive only the face clips and joints-only consumers."),
        "calibration": "shared/legacy/aethelgard/characters/household-art-sets.ts (faceCalibration of this resident)",
        "contract": "shared/legacy/aethelgard/characters/face-performance.ts"}
    work = motion.get("work_hammer", {})
    if kit != "smith":
        pe = report.get("propsExport", {})
        manifest["props"] = {"file": os.path.basename(exports.get("props", {}).get("file", "")),
                             "questFile": os.path.basename(exports.get("props-quest", {}).get("file", "")),
                             "sockets": {name: f"{', '.join(children)} (attach to joint {name.split('_')[1]}_{name.split('_')[2]}, keep the local transform)"
                                         for name, children in pe.get("sockets", {}).items()},
                             "workplace": "node 'workplace' (already Y-up) holds " + ", ".join(pe.get("workplace", [])) + " relative to the resident root in the work pose",
                             "loose": pe.get("loose", []), "aside": pe.get("aside", []), "recipe": {k: v for k, v in recipe.get("props", {}).items() if k != "kit"}}
        manifest["work"] = {k: v for k, v in motion.get(manifest["actorMotions"]["work"], {}).items() if k != "source"}
    if kit == "smith":
        pe = report.get("propsExport", {})
        manifest["props"] = {"file": os.path.basename(exports.get("props", {}).get("file", "")),
                         "questFile": os.path.basename(exports.get("props-quest", {}).get("file", "")),
                         "sockets": {"socket_hand_r": "prop_hammer (attach to joint hand_r, keep local transform; prop frame: butt at the "
                                                      "origin, handle along +Y, striking face toward -Z)",
                                     "socket_hand_l": "prop_tongs with prop_workpiece (attach to joint hand_l)"},
                         "workplace": "node 'workplace' (already Y-up) holds " + ", ".join(pe.get("workplace", [])) +
                                      " (the anvil and stump merged) relative to the resident root in the work pose",
                         "hammerFaceLocal": report.get("props", {}).get("hammerFaceLocal"),
                         "hammerHeadCentreLocal": report.get("props", {}).get("hammerHeadCentreLocal"),
                         "anvilFaceHeightMetres": recipe["props"].get("anvilFaceHeight"), "strikePointBlender": work.get("strike"),
                         "feetBlender": work.get("feet")}
    manifest["budgets"] = {"desktop-lod0": {"maxTriangles": 25000, "maxMaterials": 4, "maxMorphTargets": 45, "maxTextureSize": 2048},
                           "desktop-lod1": {"maxTriangles": 8000, "maxMaterials": 2, "maxMorphTargets": 45, "maxTextureSize": 1024},
                           "quest": {"maxTriangles": 6000, "maxMaterials": 2, "maxMorphTargets": 45, "maxTextureSize": 1024},
                           "props": {"maxMaterials": 1, "maxTextureSize": 1024, "note": "desktop props atlas"},
                           "props-quest": {"maxMaterials": 1, "maxTextureSize": 512, "note": "Quest props atlas; with the household at work "
                                           "each set adds one draw per hand prop plus one for its static workplace"}}
    pe = report.get("propsExport", {})
    manifest["propsAtlas"] = pe.get("atlas", {})
    if report.get("envelopes"):  # integration patch 5: per-level, per-clip animated envelopes for the actor owner
        manifest["envelopes"] = dict(report["envelopes"], note=(
            "glTF model frame (Y up, +Z forward), metres. Every body clip skinned at every frame from Blender's own pose "
            "evaluation (scripts/characters/lib/envelopes.py), face-morph vertices padded by the sum of their 16 largest "
            "deltas, widened by half the largest per-frame vertex travel plus 5 mm. Pass envelopes[level][clip] to the "
            "owner (patch 5), which checks each at 9 times."))
    pen_path = os.path.join(args.build, "penetration.json")
    if os.path.exists(pen_path):  # scripts/characters/review/penetration_check.py on this build
        pen = json.load(open(pen_path))
        keep = lambda table: {clip: {pair: {k: v[k] for k in ("throughVertices", "maxThroughMm", "restCentre") if k in v}
                                     for pair, v in pairs.items() if v["throughVertices"] > 0} for clip, pairs in table.items()}
        manifest["penetration"] = {"marginMetres": pen["marginMetres"], "backReachMetres": pen.get("backReachMetres"),
                                   "check": "scripts/characters/review/penetration_check.py", "note": pen.get("note", ""),
                                   "pairedVertices": pen.get("pairedVertices"), "clips": keep(pen["clips"]),
                                   "handClips": keep(pen.get("handClips", {}))}
        if pen.get("posedHands", {}).get("clips"):  # round 2: hands against the posed outer garments, per clip and side
            manifest["penetration"]["posedHands"] = {
                "note": pen["posedHands"]["note"],
                "clips": {clip: {side: {k: v[k] for k in ("framesCrossing", "framesSampled", "minorityVertices", "frame") if k in v}
                                 for side, v in sides.items()} for clip, sides in pen["posedHands"]["clips"].items() if sides}}
        if pen.get("heldStick", {}).get("clips"):  # round 2: the held stick's shaft inside the posed garments
            manifest["penetration"]["heldStick"] = pen["heldStick"]
    manifest["textureMemoryNote"] = "decodedTextureBytesEstimate assumes RGBA8 with full mips; not a GPU measurement."
    with open(os.path.join(dest, "manifest.json"), "w") as handle:
        json.dump(manifest, handle, indent=1)
    shutil.copyfile(os.path.join(REPO, "main game", "public", "assets", "legacy", "environment", "aethelgard", "textures", "grass-leafy-v1", "CC0-1.0.txt"),
                    os.path.join(dest, "CC0-1.0.txt"))
    ccby = os.environ.get("CC_BY_LEGALCODE")
    if ccby and os.path.exists(ccby):
        shutil.copyfile(ccby, os.path.join(dest, "CC-BY-4.0.txt"))
    authors = "; ".join(f"{k}: {', '.join(v['authors'])}" for k, v in sorted(polyhaven["assets"].items()))
    levels = "\n".join(f"| {k} | {v['file']} | {v['triangles']:,} | {v['materialCount']} | {v['joints']} | {v['maxMorphTargets']} | "
                       f"{max((i['width'] or 0) for i in v['textures']) if v['textures'] else 0} | {v['decodedTextureBytesEstimate'] / 2**20:.1f} MiB | {v['bytes'] / 2**20:.2f} MiB |"
                       for k, v in manifest["levels"].items())
    intro = ("First resident of the proposed smithy household" if kit == "smith" else "Member of the proposed smithy household")
    clips_100 = ", ".join(sorted(style100["clips"])) or "none"
    clip_lines = "\n".join(f"* `{name}`: {entry['origin']}." for name, entry in provenance["clips"].items())
    sources_md = f"""# {recipe["label"]} resident (working placeholder)

{intro} (role label only; no name, history or private canon). Built by
`scripts/characters/build_resident.py` from the recipe `{os.path.relpath(os.path.abspath(args.recipe), REPO)}`;
published by `scripts/characters/publish_resident.py`. Nothing here is integrated into the village yet;
see docs/legacy/claude-integration/characters/ and shared/legacy/aethelgard/characters/household-art-sets.ts.

## Levels (measured from the exported files)

| Level | File | Triangles | Materials | Joints | Morph targets | Max map | Decoded maps (RGBA8 + mips, estimate) | File |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
{levels}

## Sources and licences

* **MakeHuman** base mesh, shape targets, 64-bone rig and weights, region data
  (mpfb2 data at commit {MPFB_COMMIT}): CC0-1.0, MakeHuman team. MPFB2 program code
  (GPL-3.0) was not executed or redistributed. Legal code: CC0-1.0.txt.
* **makehuman_system_assets** (skin diffuse, high-poly eyes, teeth, tongue, eyelashes):
  CC0-1.0, makehuman_system; pack sha256 b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107.
* **faceunits01** (30 of 52 ARKit-style targets) and **visemes02** (14 visemes): CC0-1.0, Mika Suominen.
* **Poly Haven** (CC0-1.0, https://polyhaven.com/license): {authors}.
  Powered by Poly Haven. {KIT_TEXT[kit]["props"]}
* **100STYLE** ({clips_100}; files {", ".join(used_bvh)}): {STYLE100_ATTRIBUTION} Licence: CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/); the legal code is in CC-BY-4.0.txt.
* **Original Crownfall work**: {KIT_TEXT[kit]["short"]}.

## Where each clip comes from

{clip_lines}

Exact source files, SHA-256 hashes, frame ranges and modifications: provenance.json. Measured
budgets, clips (durations, stride, root travel, contacts), the face-joint convention and prop
sockets: manifest.json. Download date for every source: {DOWNLOADED}. Software-rendered review
captures are not headset or performance evidence.
"""
    with open(os.path.join(dest, "SOURCES.md"), "w") as handle:
        handle.write(sources_md)
    print(json.dumps({"dest": os.path.relpath(dest, REPO), "files": outputs}, indent=1))


if __name__ == "__main__":
    main()

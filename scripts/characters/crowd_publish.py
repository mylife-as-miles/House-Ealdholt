#!/usr/bin/env python3
"""Publish built crowd residents and prop kits into crowd-v1 with provenance and a measured manifest.

    python3 scripts/characters/crowd_publish.py --sources PRIVATE/sources.json --recipes RECIPE_DIR \
        --build BUILD_DIR [--only id,id,...] [--props]

Copies BUILD_DIR/<id>/<id>.glb and <id>.json into
main game/public/assets/legacy/environment/aethelgard/characters/crowd-v1/residents/ (and BUILD_DIR/props/*.glb into
crowd-v1/props/ with --props; mirrored to Quest by scripts/sync-legacy-environment-assets.mjs), then merges
crowd-v1/manifest.json and crowd-v1/provenance.json: entries this script owns (residents, props, budgets) are
replaced, entries written by others (the motion builder's clip libraries under "clipLibraries" and clips/ files) are
kept. Writes residents/index.json, the kit section of SOURCES.md and the CC0 legal code. Standard library only.
Every resident file is gated (triangles, materials, morphs, clips, atlas, file size, placement scale, face rig): a
resident failing a gate is refused unless --allow-failing is given (then it is published and flagged).
"""
import argparse
import hashlib
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(HERE, "lib"))
import measure  # noqa: E402

DEST = os.path.join(REPO, "main game/public/assets/legacy/environment/aethelgard/characters/crowd-v1")
SMITH = os.path.join(REPO, "main game/public/assets/legacy/environment/aethelgard/characters/village-smith-v1")
MPFB_COMMIT = "6ff1eb358f6c1959ced77e79e6dd2406d9a71f49"
SYSTEM_PACK = ("https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip",
               "b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107")
CC0 = {"spdx": "CC0-1.0", "legalCodeUrl": "https://creativecommons.org/publicdomain/zero/1.0/legalcode"}
FABRICS = ("caban", "rough_linen", "poly_wool_herringbone", "fabric_leather_02", "hessian_230")
PROP_MODELS = ("wooden_bucket_01", "wicker_basket_01", "wooden_bowl_01", "wooden_stool_01", "cross_pein_hammer")
BUILT_ON = "2026-11-08"


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def file_entry(base, rel):
    p = os.path.join(base, rel)
    return {"path": rel, "bytes": os.path.getsize(p), "sha256": sha256(p)}


def load_json(path, default):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return default


def makehuman_files(src, report):
    data = src["mpfbData"]
    rels = {"3dobjs/base.obj", "rigs/standard/rig.mixamo_unity.json", "rigs/standard/weights.mixamo_unity.json",
            "uv_layers/lips_solid.json.gz"}
    for key in ("macroTargets", "detailTargets"):
        for rel, _w in report.get(key, []):
            rels.add(rel)
    return [file_entry(data, r) for r in sorted(rels) if os.path.exists(os.path.join(data, r))]


def system_files(src, recipe):
    sysdir = src["systemAssets"]
    rels = ["eyes/low-poly/low-poly.mhclo", "eyes/low-poly/low-poly.obj", f"eyes/materials/{recipe.get('eyes', 'brown')}_eye.png"]
    skin = recipe["skin"]["base"]
    mat = os.path.join(sysdir, "skins", skin, skin + ".mhmat")
    rels.append(f"skins/{skin}/{skin}.mhmat")
    for line in open(mat, encoding="utf-8", errors="replace"):
        if line.startswith("diffuseTexture"):
            rels.append(f"skins/{skin}/{line.split(None, 1)[1].strip()}")
    return [file_entry(sysdir, r) for r in rels if os.path.exists(os.path.join(sysdir, r))]


def polyhaven_entries(src, names):
    intake = load_json(os.path.join(src["polyhaven"], "intake.json"), {}).get("assets", {})
    out = {}
    for n in names:
        a = intake.get(n)
        if a is None:
            raise SystemExit(f"Poly Haven asset {n} missing from the verified intake")
        out[n] = {"name": a["name"], "authors": a["authors"], "sourceUrl": a["sourceUrl"], "kind": a["kind"],
                  "files": {k: {"url": v["url"], "bytes": v["bytes"], "sha256": v["sha256"]} for k, v in a["files"].items()
                            if k in ("Diffuse", "diff", "arm", "gltf") or k.endswith("_1k") or "diff" in k.lower() or v["url"].endswith((".gltf", ".bin"))}}
    return out


def gate_ok(manifest):
    return bool(manifest.get("gates", {}).get("allPass"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", required=True)
    ap.add_argument("--recipes", required=True)
    ap.add_argument("--build", required=True)
    ap.add_argument("--only", default="")
    ap.add_argument("--props", action="store_true")
    ap.add_argument("--allow-failing", action="store_true")
    ap.add_argument("--silhouettes", default="", help="OUT.json of review/silhouette_overlap.py: publish gate and manifest figures")
    ap.add_argument("--no-motion", action="store_true", help="skip crowd_motion_publish.ts (motion, presentation and envelopes in the JSONs)")
    ap.add_argument("--no-tests", action="store_true", help="skip the character tests run after publishing")
    args = ap.parse_args()
    silhouettes = None
    if args.silhouettes:
        # silhouette clone-risk gate (art fixer, 8 November): same-kit median overlap and household / same-role pairs
        silhouettes = json.load(open(args.silhouettes))
        if not silhouettes.get("pass") and not args.allow_failing:
            raise SystemExit(f"silhouette overlap gate fails: kit median {silhouettes['kit']['median']}, "
                             f"{len(silhouettes.get('flagged', []))} household or role pairs over {silhouettes['thresholds']['pairMax']}")
    src = json.load(open(args.sources))
    pop = json.load(open(os.path.join(args.recipes, "population.json")))
    only = {s for s in args.only.split(",") if s}
    os.makedirs(os.path.join(DEST, "residents"), exist_ok=True)
    manifest = load_json(os.path.join(DEST, "manifest.json"), {})
    prov = load_json(os.path.join(DEST, "provenance.json"), {})
    prov.setdefault("files", {})
    published, refused = [], []
    resident_sources = {}
    for rid in sorted(os.listdir(args.build)):
        if not rid.startswith("ealdholt-") or (only and rid not in only):
            continue
        bdir = os.path.join(args.build, rid)
        mpath, gpath = os.path.join(bdir, rid + ".json"), os.path.join(bdir, rid + ".glb")
        if not (os.path.exists(mpath) and os.path.exists(gpath)):
            continue
        m = json.load(open(mpath))
        report = json.load(open(os.path.join(bdir, "report.json")))
        recipe = json.load(open(os.path.join(args.recipes, rid + ".json")))
        if not gate_ok(m) and not args.allow_failing:
            refused.append({"id": rid, "gates": m.get("gates")})
            continue
        facts = measure.glb_facts(gpath)
        if facts["maxMorphTargets"] or facts["animations"] or facts["materialCount"] > 2 or facts["joints"] != 64:
            raise SystemExit(f"{rid}: published crowd files carry no morphs or clips, at most 2 materials and 64 joints")
        out_glb = os.path.join(DEST, "residents", rid + ".glb")
        shutil.copyfile(gpath, out_glb)
        m["recipeSha256"] = hashlib.sha256(open(os.path.join(args.recipes, rid + ".json"), "rb").read()).hexdigest()
        m["published"] = {"bytes": os.path.getsize(out_glb), "sha256": sha256(out_glb)}
        with open(os.path.join(DEST, "residents", rid + ".json"), "w") as f:
            json.dump(m, f, indent=1, sort_keys=True)
        rel = f"residents/{rid}.glb"
        prov["files"][rel] = {
            "bytes": m["published"]["bytes"], "sha256": m["published"]["sha256"], "kind": "crowd-resident",
            "residentId": rid, "builtOn": BUILT_ON, "builtWith": "scripts/characters/crowd_build.py",
            "recipe": f"generated by scripts/characters/crowd_recipes.ts from shared/legacy/aethelgard/characters/village-population.ts (sha256 {m['recipeSha256']})",
            "licence": CC0["spdx"] + " sources; project-original pipeline output: MIT (original Crownfall work)",
            "sources": {"makehuman": makehuman_files(src, report), "makehumanSystemAssets": system_files(src, recipe),
                        "polyhavenFabrics": sorted({o for o in FABRICS})},
            "modifications": ("Base mesh shaped by MakeHuman macro and head-region targets, scaled to the archetype skeleton, rigged with the "
                              "CC0 64-bone rig; eye sockets and mouth bag removed; garments (with a per-resident cut), hair, beards and "
                              "headwear generated by the pipeline; capes and aprons weighted from the layer beneath; decimated to the crowd "
                              "budget, layers hidden under their covers removed and shoe soles laid on the ground; skin texture tinted and "
                              "painted, fabrics recoloured with wear marks, baked into one 512 atlas (WebP)."),
        }
        resident_sources[rid] = recipe
        published.append(m)
    if args.props:
        pdir = os.path.join(args.build, "props")
        os.makedirs(os.path.join(DEST, "props"), exist_ok=True)
        preport = json.load(open(os.path.join(pdir, "props-report.json")))
        ph = polyhaven_entries(src, PROP_MODELS)
        for kit, info in sorted(preport.items()):
            out = os.path.join(DEST, "props", info["file"])
            shutil.copyfile(os.path.join(pdir, info["file"]), out)
            used_ph = sorted({p["source"].split(":", 1)[1].split()[0] for p in info["props"].values() if p["source"].startswith("polyhaven:")})
            prov["files"][f"props/{info['file']}"] = {
                "bytes": os.path.getsize(out), "sha256": sha256(out), "kind": "crowd-prop-kit", "kit": kit, "builtOn": BUILT_ON,
                "builtWith": "scripts/characters/crowd_build.py --props (lib/crowd_props.py)", "licence": "CC0-1.0 sources; project-original models: MIT (original Crownfall work)",
                "polyhaven": {n: ph[n] for n in used_ph},
                "original": sorted(pid for pid, p in info["props"].items() if p["source"] == "project-original"),
                "modifications": "Poly Haven models scaled, re-origined, decimated to the prop budget and remapped into one 512 kit atlas "
                                 "(their albedo downsized into a cell); originals modelled by the pipeline with swatch cells.",
            }
        kit_json = {k: {"file": v["file"], "bytes": os.path.getsize(os.path.join(DEST, "props", v["file"])), "props": v["props"]}
                    for k, v in preport.items()}
        with open(os.path.join(DEST, "props", "kits.json"), "w") as f:
            json.dump({"status": "working-placeholder",
                       "frames": ("see scripts/characters/lib/crowd_props.py: hand props have their origin at the grip; origin 'contract' "
                                  "props and every part node (prop_<id>_<part>, matching a clip grip's `part`) are modelled in the "
                                  "clip contract frame (kit alignment identity); workplace props stand on their base with the resident "
                                  "on their +Y side (glTF -Z); goods (`placedWith`) share their workplace prop's base frame; carry goods "
                                  "(`replaces`) take the replaced prop's grip"),
                       "kits": kit_json}, f,
                      indent=1, sort_keys=True)
        prov["files"]["props/kits.json"] = {"kind": "index", "sha256": sha256(os.path.join(DEST, "props", "kits.json"))}
    # resident index (everything published so far, not only this run)
    index = []
    for f in sorted(os.listdir(os.path.join(DEST, "residents"))):
        if f.endswith(".json") and f != "index.json":
            m = json.load(open(os.path.join(DEST, "residents", f)))
            index.append({k: m[k] for k in ("residentId", "archetype", "group", "fidelityTier", "householdId", "file", "placementScale",
                                            "clipLibrary")} | {"triangles": m["measured"]["triangles"], "bytes": m["published"]["bytes"],
                                                               "gatesPass": gate_ok(m)})
    with open(os.path.join(DEST, "residents", "index.json"), "w") as f:
        json.dump({"status": "working-placeholder", "residents": index}, f, indent=1, sort_keys=True)
    tri = [r["triangles"] for r in index]
    size = [r["bytes"] for r in index]
    manifest.update({
        "status": "working-placeholder", "set": "crowd-v1",
        "description": "Crowd level of the Ealdholt village population (docs/legacy/characters/EALDHOLT_POPULATION_ART.md).",
        "budget": pop["budget"],
        "residents": {"published": len(index), "plannedCrowdResidents": len(pop["residents"]), "index": "residents/index.json",
                      "measured": {"trianglesMin": min(tri) if tri else None, "trianglesMax": max(tri) if tri else None,
                                   "bytesMin": min(size) if size else None, "bytesMax": max(size) if size else None,
                                   "bytesTotal": sum(size)}},
        "props": {"index": "props/kits.json"} if os.path.exists(os.path.join(DEST, "props", "kits.json")) else manifest.get("props"),
        "pairing": "template = { scene: residentGltf.scene, animations: clipLibraryGltf.animations }; placement.scale = placementScale",
    })
    manifest.setdefault("clipLibraries", manifest.get("clipLibraries", "published by the motion builder under clips/"))
    if silhouettes is not None:
        manifest["silhouetteOverlap"] = {k: silhouettes[k] for k in ("method", "residents", "thresholds", "household", "kit", "role", "pass")}
        manifest["silhouetteOverlap"]["tool"] = "scripts/characters/review/silhouette_overlap.py"
    with open(os.path.join(DEST, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
    prov.update({"set": "crowd-v1", "status": "working-placeholder",
                 "sources": {
                     "makehuman": {"source": f"https://github.com/makehumancommunity/mpfb2/tree/{MPFB_COMMIT}/src/mpfb/data",
                                   "author": "MakeHuman team (Data Collection AB, Joel Palmius, Jonas Hauquier)", "licence": CC0,
                                   "evidence": "LICENSE.md section C and LICENSE.ASSETS.md: base mesh, proxies, targets, textures, rigs and mesh JSON are CC0 1.0. MPFB2 program code (GPL-3.0) was not executed, copied or redistributed."},
                     "makehumanSystemAssets": {"source": SYSTEM_PACK[0], "archiveSha256": SYSTEM_PACK[1], "author": "makehuman_system", "licence": CC0},
                     "polyhaven": {"licence": dict(CC0, officialUrl="https://polyhaven.com/license"), "assets": polyhaven_entries(src, FABRICS + PROP_MODELS)},
                 }})
    with open(os.path.join(DEST, "provenance.json"), "w") as f:
        json.dump(prov, f, indent=1, sort_keys=True)
    cc0 = os.path.join(SMITH, "CC0-1.0.txt")
    shutil.copyfile(cc0, os.path.join(DEST, "CC0-1.0.txt"))
    write_sources(index, os.path.exists(os.path.join(DEST, "props", "kits.json")), src)
    print(json.dumps({"published": [m["residentId"] for m in published], "refused": refused}, indent=1))
    after_publish(args, [m["residentId"] for m in published])


# The resident JSONs copied above come from the kit build and lack the motion publisher's blocks; a republish must be
# followed by the motion publisher, and the character tests are run here because npm run test:legacy does not glob the
# characters folders until Codex applies characters-03-test-globs.patch (motion and runtime fixer, 8 November).
TSX = os.path.join(REPO, "main-game-vr", "node_modules", ".bin", "tsx")
CHARACTER_TESTS = ["shared/legacy/aethelgard/characters/*.test.ts", "scripts/characters/crowd-assets.test.ts"]


def after_publish(args, ids):
    import glob
    import subprocess
    if not os.path.exists(TSX):
        print("tsx not found: run scripts/characters/crowd_motion_publish.ts and the character tests by hand")
        return
    if not args.no_motion and ids:
        cmd = [TSX, os.path.join("scripts", "characters", "crowd_motion_publish.ts")] + (["--only", ",".join(ids)] if args.only else [])
        if subprocess.run(cmd, cwd=REPO).returncode:
            raise SystemExit("crowd_motion_publish.ts failed: the published JSONs lack motion, presentation or gated envelopes")
    if not args.no_tests:
        files = sorted(f for g in CHARACTER_TESTS for f in glob.glob(os.path.join(REPO, g)))
        if subprocess.run([TSX, "--test"] + [os.path.relpath(f, REPO) for f in files], cwd=REPO).returncode:
            raise SystemExit("character tests failed after publishing")


def write_sources(index, props, src):
    path = os.path.join(DEST, "SOURCES.md")
    start, end = "<!-- crowd-kit:start -->", "<!-- crowd-kit:end -->"
    ph = polyhaven_entries(src, FABRICS + PROP_MODELS)
    authors = "; ".join(f"{k}: {', '.join(v['authors'])}" for k, v in sorted(ph.items()))
    body = f"""{start}
## Residents and prop kits (crowd kit builder)

Working placeholder, 7 November 2026. Role labels only. Crowd residents are built by `scripts/characters/crowd_build.py`
from recipes generated by `scripts/characters/crowd_recipes.ts` out of `shared/legacy/aethelgard/characters/village-population.ts`,
and published by `scripts/characters/crowd_publish.py`. {len(index)} residents published so far (`residents/index.json`);
{"seven prop kits in `props/` (`props/kits.json`)" if props else "no prop kits yet"}. Clips are not in these files: they live in
the archetype clip libraries (`clips/`, motion builder).

* **MakeHuman** base mesh, macro and head-region shape targets, 64-bone rig and weights, lips region (mpfb2 data at
  commit {MPFB_COMMIT}): CC0-1.0, MakeHuman team. MPFB2 program code (GPL-3.0) was not executed or redistributed.
* **makehuman_system_assets** (skin diffuse textures, low-poly eyes and eye textures): CC0-1.0, makehuman_system; pack
  sha256 {SYSTEM_PACK[1]}.
* **Poly Haven** (CC0-1.0, https://polyhaven.com/license): {authors}. Powered by Poly Haven. Fabrics are recoloured to
  natural-dye palettes and baked; the bucket, basket, bowl, stool and hammer are scaled, decimated and re-textured into kit atlases.
* **Original Crownfall work** (MIT, the repository licence): garment kits, hair masses, beards and headwear, painted skin and wear
  masks, the crowd level, all prop models other than the Poly Haven ones, and the pipeline.
* No Fab, Mixamo, MetaHuman, SMPL or unclear-terms asset is used. Per-file SHA-256 and sources: `provenance.json`.
{end}"""
    text = open(path).read() if os.path.exists(path) else "# Ealdholt crowd level (working placeholder)\n\n"
    if start in text and end in text:
        text = text[:text.index(start)] + body + text[text.index(end) + len(end):]
    else:
        text = text.rstrip() + "\n\n" + body + "\n"
    with open(path, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()

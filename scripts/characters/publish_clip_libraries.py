"""Publish the crowd clip libraries built by build_clip_library.py (one output folder per archetype).

    python3 scripts/characters/publish_clip_libraries.py --sources PRIVATE/sources.json --build BUILD_ROOT \
        [--style100-extra DIR ...]

BUILD_ROOT holds out-<archetype>/crowd-clips-<archetype>-v1.glb and library-<archetype>.json for the six archetypes.
Writes main game/public/assets/legacy/environment/aethelgard/characters/crowd-v1/clips/: the six GLBs, manifest.json
(every library's clips, joins, travel, props, events and measured quality), provenance.json (sources with SHA-256,
licences, modifications; SHA-256 of every published file), SOURCES.md and the CC0 and CC BY 4.0 legal texts (copied
from the household sets). Only this folder is written; the crowd residents and prop kits beside it belong to the kit.
"""
import argparse
import hashlib
import json
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
CHARS = os.path.join(REPO, "main game", "public", "assets", "legacy", "environment", "aethelgard", "characters")
OUT = os.path.join(CHARS, "crowd-v1", "clips")
ARCHETYPES = ("adult-male", "adult-female", "adolescent", "child", "elder-male", "elder-female")
STYLE_ATTRIBUTION = ("100STYLE dataset by Ian Mason, Sebastian Starke and Taku Komura (2022), CC BY 4.0, doi:10.1145/3522618. "
                     "Retargeted, trimmed, straightened, blended, time-scaled, loop-closed and foot-locked.")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", required=True)
    ap.add_argument("--build", required=True)
    ap.add_argument("--style100-extra", action="append", default=[])
    args = ap.parse_args()
    src = json.load(open(args.sources))
    roots = [src["style100"]] + args.style100_extra
    os.makedirs(OUT, exist_ok=True)
    libs, files, takes = {}, [], set()
    for a in ARCHETYPES:
        d = os.path.join(args.build, f"out-{a}")
        glb = f"crowd-clips-{a}-v1.glb"
        shutil.copyfile(os.path.join(d, glb), os.path.join(OUT, glb))
        man = json.load(open(os.path.join(d, f"library-{a}.json")))
        rep = json.load(open(os.path.join(d, f"report-{a}.json")))
        takes |= set(rep["takes"])
        man["sha256"] = sha256(os.path.join(OUT, glb))
        man["bytes"] = os.path.getsize(os.path.join(OUT, glb))
        man["buildSeconds"] = rep["seconds"]
        libs[a] = man
        files.append({"path": glb, "bytes": man["bytes"], "sha256": man["sha256"]})
    take_files = []
    for t in sorted(takes):
        p = next(os.path.join(r, t) for r in roots if os.path.exists(os.path.join(r, t)))
        take_files.append({"path": t, "bytes": os.path.getsize(p), "sha256": sha256(p)})
    total = sum(f["bytes"] for f in files)
    manifest = {
        "set": "crowd-v1/clips", "status": "working-placeholder", "fps": 30,
        "description": "Shared clip libraries of the Ealdholt crowd, one per body archetype (EALDHOLT_POPULATION_ART.md sections 4 and 6). "
                       "Clips-only GLBs: the archetype's 64-joint skeleton as nodes and every clip as a named animation of body-joint "
                       "rotations plus the hips translation; no mesh, no face-joint channels.",
        "binding": {"template": "{ scene: resident.scene, animations: library.animations } (resident: crowd-v1/residents/<id>.glb)",
                    "placementScale": "set the actor's placement.scale to the resident's placementScale; root travel, stride and speed "
                                      "in this manifest are at scale 1 and scale with it",
                    "skeleton": "body joints of every crowd resident equal the library skeleton (referenceSkeleton.skeletonSha256 covers "
                                "the node rest TRS); the household residents can play these clips too, scaled by hips height (evidence only)",
                    "hubs": "standing clips start and end on the archetype's hub pose (idle frame 0); seated loops on the sit pose; "
                            "stick clips on the stick hub",
                    "oneShots": "clips with loop=false play once and hold their last frame (sit_down, stand_up, walk*_start, walk*_stop, "
                                "look_around, guard_challenge, <loop>_enter, <loop>_exit)",
                    "carries": "carry_*_walk, guard_patrol_walk and fetch_carry keep walk's legs and timing (syncWith: walk): switch at the "
                               "same normalised time",
                    "props": "see each library's propBinding"},
        "totalBytes": total, "libraries": libs,
    }
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
    prov = {
        "set": "crowd-v1/clips", "status": "working-placeholder", "downloaded": "2026-11-06 (100STYLE Neutral_FR and Elated_FR: 2026-11-07)",
        "builtWith": {"pipeline": "scripts/characters/build_clip_library.py (lib/motion_library.py, lib/motion_roles.py, "
                                  "lib/motion_library_export.py, lib/motion_library_manifest.py)",
                      "skeleton": "scripts/characters/lib/crowd_skeleton.py build_reference (kit builder)",
                      "blender": "Blender 5.2.3 LTS (bpy module)", "note": "Original Crownfall code reading the data below; no MPFB2 code executed."},
        "sources": {
            "style100": {"source": "https://zenodo.org/records/8127870", "author": "Ian Mason, Sebastian Starke, Taku Komura",
                         "licence": {"spdx": "CC-BY-4.0", "legalCodeUrl": "https://creativecommons.org/licenses/by/4.0/legalcode"},
                         "attribution": STYLE_ATTRIBUTION,
                         "evidence": "Zenodo record licence cc-by-4.0 covers 100STYLE.zip (1,468,515,354 bytes); members read by HTTP range requests.",
                         "files": take_files},
            "makehuman": {"source": "https://github.com/makehumancommunity/mpfb2/tree/6ff1eb358f6c1959ced77e79e6dd2406d9a71f49/src/mpfb/data",
                          "author": "MakeHuman team (Data Collection AB, Joel Palmius, Jonas Hauquier)",
                          "licence": {"spdx": "CC0-1.0", "legalCodeUrl": "https://creativecommons.org/publicdomain/zero/1.0/legalcode"},
                          "use": "base mesh, macro targets, 64-bone rig and weights that define each archetype's reference skeleton",
                          "files": [{"path": "3dobjs/base.obj"}, {"path": "rigs/standard/rig.mixamo_unity.json"}]},
            "original": {"licence": "MIT (original Crownfall work)",
                         "use": "every role loop, enter and exit, talk and look layers, seated clips, stick and crutch solving, the "
                                "start and stop synthesis and the export"},
        },
        "clipSources": {a: {n: c.get("source", "original keyframes (Crownfall)") for n, c in libs[a]["clips"].items()} for a in ARCHETYPES},
        "files": files,
        "excluded": "No Fab, Mixamo, MetaHuman, SMPL, CMU or unclear-terms motion is used.",
    }
    with open(os.path.join(OUT, "provenance.json"), "w") as f:
        json.dump(prov, f, indent=1, sort_keys=True)
    for name, src_set in (("CC-BY-4.0.txt", "village-smith-v1"), ("CC0-1.0.txt", "village-smith-v1")):
        shutil.copyfile(os.path.join(CHARS, src_set, name), os.path.join(OUT, name))
    rows = "\n".join(f"| {a} | {libs[a]['file']} | {libs[a]['clipCount']} | {libs[a]['bytes'] / 1048576:.2f} MiB | "
                     f"{libs[a]['referenceSkeleton']['statureCm']} cm |" for a in ARCHETYPES)
    with open(os.path.join(OUT, "SOURCES.md"), "w") as f:
        f.write(f"""# Ealdholt crowd clip libraries (working placeholder)

Shared motion for the crowd residents, one clips-only GLB per body archetype, built by
`scripts/characters/build_clip_library.py` and published by `scripts/characters/publish_clip_libraries.py`. Role labels
only; nothing here is integrated yet (docs/legacy/claude-integration/characters/clip-library-README.md).

| Archetype | File | Clips | Size | Reference stature |
| --- | --- | --- | --- | --- |
{rows}

All six: {total / 1048576:.2f} MiB.

## Sources and licences

* **100STYLE** (CC BY 4.0): {STYLE_ATTRIBUTION} Takes used: {', '.join(sorted(takes))}. Locomotion, idles and every clip built
  from them (walk variants, run, stick and crutch walks, idles, talk, start and stop clips, carry and patrol walks over the walk)
  carry this attribution. Legal code: CC-BY-4.0.txt.
* **MakeHuman** (CC0-1.0, mpfb2 data at commit 6ff1eb358f6c1959ced77e79e6dd2406d9a71f49): base mesh, macro targets, 64-bone rig
  and weights from which each archetype's reference skeleton is built. Legal code: CC0-1.0.txt.
* **Original Crownfall work**: every role loop, enter and exit, talk and look layers, seated clips, stick and crutch solving and
  the start/stop synthesis.
* No Fab, Mixamo, MetaHuman, SMPL, CMU or unclear-terms motion. Per-file SHA-256: provenance.json; per-clip source, duration,
  loop flag, joins, root travel, props and measured quality: manifest.json. Software-rendered review captures are not headset
  or performance evidence.
""")
    print(json.dumps({"published": OUT, "bytes": total, "files": [f["path"] for f in files], "takes": sorted(takes)}, indent=1))


if __name__ == "__main__":
    main()

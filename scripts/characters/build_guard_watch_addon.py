"""Blender --background --python THIS -- --assets-root CHARACTERS --out NEW_PRIVATE_DIR.

Single published-rig additive authoring pass. No MakeHuman/body rebuild, network,
scene rendering or source overwrite. Bounds/contact/clearance are NOT approved by
this exporter; its exact GLB and provenance feed the separate real-mesh sampler.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "lib"))
import glb_prune
import published_guard_watch as watch


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--assets-root", required=True)
    p.add_argument("--out", required=True)
    args = p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    root, out = Path(args.assets_root).resolve(), Path(args.out).resolve()
    if out == root or root in out.parents or out.exists():
        raise ValueError("Choose a new private output outside the read-only character assets")
    # The authoritative published registry, not a caller-invented digest.
    import re
    registry = (HERE.parent.parent / "shared/legacy/aethelgard/characters/population-asset-integrity.ts").read_text()
    expected = dict(re.findall(r'"([^"\n]+)":\s*"([a-f0-9]{64})"', registry))
    paths = {"library": "crowd-v1/clips/crowd-clips-adult-male-v1.glb",
             "resident": "crowd-v1/residents/ealdholt-garrison-spearman.glb",
             "metadata": "crowd-v1/residents/ealdholt-garrison-spearman.json",
             "kit": "crowd-v1/props/crowd-props-guard-v1.glb"}
    for path in paths.values():
        if sha(root / path) != expected[path]:
            raise ValueError("Published source identity mismatch: " + path)
    source, binary = glb_prune._read(str(root / paths["library"]))
    body, skin = glb_prune._read(str(root / paths["resident"]))
    meta = json.loads((root / paths["metadata"]).read_text())
    if meta["motion"]["roleClips"] != ["guard_stand_watch_d", "guard_patrol_walk"]:
        raise ValueError("The source must own the exact unchanged watch and patrol clips")
    rig = watch.rig_from_published(source)
    soles = watch.published_soles(body, skin, rig)
    start = watch.frame_at(source, binary, rig, "guard_patrol_walk")
    end = watch.frame_at(source, binary, rig, "guard_stand_watch_d")
    clips = meta["presentation"]["clips"]
    def grip(name):
        a = clips[name]["held"]
        if len(a) != 1 or a[0]["prop"] != "spear":
            raise ValueError("Exactly the already-owned spear must be preserved")
        return watch.Matrix([a[0]["matrix"][i:i + 4] for i in range(0, 16, 4)]).transposed()
    frames, shafts = watch.compact_frames(rig, soles, start, end, grip("guard_patrol_walk"), grip("guard_stand_watch_d"))
    out.mkdir(mode=0o700, parents=True)
    glb = out / "guard-watch-adult-male-compact-v1.glb"
    watch.write_addon(source, binary, rig, frames, shafts, str(glb),
                      {"guard_patrol_walk": ("r", grip("guard_patrol_walk")),
                       "guard_stand_watch_d": ("l", grip("guard_stand_watch_d"))})
    provenance = {"schemaVersion": 1, "generator": str(Path(__file__).relative_to(HERE.parent.parent)),
                  "generatorSha256": sha(__file__), "keyframesSha256": sha(HERE / "lib/published_guard_watch.py"),
                  "authoringHelpers": {name: sha(HERE / "lib" / name) for name in
                    ["motion.py", "transitions.py", "locomotion.py", "glb_prune.py", "motion_library_export.py", "motion_household.py"]},
                  "sources": {path: expected[path] for path in paths.values()},
                  "output": {"file": glb.name, "sha256": sha(glb), "bytes": glb.stat().st_size},
                  "clips": [watch.ENTER, watch.EXIT], "helper": watch.HELPER,
                  "loopTransportTracks": watch.TRANSPORTS,
                  "handoff": {"leftClosedByPhase": watch.LEFT_CLOSED_BY, "rightReleaseAfterPhase": watch.RIGHT_RELEASE_AFTER},
                  "soles": {s: [{"bone": bone, "point": list(local)} for bone, local in soles.local[s].values()] for s in ("l", "r")},
                  "grips": {"r": clips["guard_patrol_walk"]["held"][0]["matrix"], "l": clips["guard_stand_watch_d"]["held"][0]["matrix"]},
                  "fromClip": "guard_patrol_walk", "fromSeconds": 0, "toClip": "guard_stand_watch_d", "toSeconds": 0,
                  "seconds": (len(frames) - 1) / watch.FPS, "fps": watch.FPS,
                  "props": "one original licensed guard-kit spear, explicit right-to-left handoff",
                  "sourceLicences": ["CC0 MakeHuman geometry", "CC BY 4.0 100STYLE (existing published attribution)", "Crownfall original guard keyframes and spear"],
                  "qualification": "unqualified: full skinned body, actual held kit, floor, contact and blend measurement still required"}
    (out / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    os.chmod(glb, 0o600); os.chmod(out / "provenance.json", 0o600)
    print(json.dumps(provenance))


if __name__ == "__main__":
    main()

"""Build one crowd clip library (clips-only GLB + manifest) for a body archetype in headless Blender.

    PYTHON_WITH_BPY -I scripts/characters/build_clip_library.py --sources PRIVATE/sources.json \
        --archetype adult-male --out NEW_OUTPUT_DIR [--style100-extra DIR ...] [--only clip,clip]

PYTHON_WITH_BPY is a Python with the ``bpy`` module (Blender 5.2 LTS as a module). The archetype's reference
skeleton comes from lib/crowd_skeleton.py (shared with the crowd residents); base clips from lib/motion_library.py,
role loops from lib/motion_roles.py, export from lib/motion_library_export.py. Writes OUT/crowd-clips-<archetype>-v1.glb,
OUT/library-<archetype>.json (clip manifest, measurements) and OUT/report-<archetype>.json. Inputs are read only.
Original Crownfall code reading CC0 MakeHuman data and CC BY 4.0 100STYLE motion; it runs no GPL add-on code.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))

import bpy  # noqa: E402,F401


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser(description="Build one crowd clip library")
    p.add_argument("--sources", required=True)
    p.add_argument("--archetype", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--style100-extra", action="append", default=[])
    p.add_argument("--only", default="", help="comma list of role clips to build (default: the archetype's whole list)")
    p.add_argument("--no-roles", action="store_true")
    p.add_argument("--clips", default="", help="JSON file: {archetype: [clip ids]} (the population's clip libraries)")
    p.add_argument("--test-bodies", default="", help="evidence folder: export reference and resident test bodies (no clips)")
    p.add_argument("--pop", default="", help="JSON dump of the population residents (for --test-bodies)")
    return p.parse_args(argv)


def main():
    args = parse()
    src = json.load(open(args.sources))
    roots = [src["style100"]] + list(args.style100_extra)
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    import motion_library as ML
    import motion_library_export as EX
    t0 = time.time()
    L = ML.Library(src, args.archetype, roots)
    log = lambda *a: print("[%6.1fs]" % (time.time() - t0), *a, flush=True)  # noqa: E731
    log("reference", L.info)
    ML.build_base(L, log=log)
    t_base = time.time() - t0
    wanted = []
    if args.clips:
        wanted = json.load(open(args.clips)).get(args.archetype, [])
    if not args.no_roles:
        import motion_roles as MR
        only = [c for c in args.only.split(",") if c]
        MR.build_roles(L, wanted if not only else only, log=log)
    t_roles = time.time() - t0 - t_base
    written = EX.write_all(L)
    glb = os.path.join(out, f"crowd-clips-{args.archetype}-v1.glb")
    stats = EX.export_library(L, glb)
    facts = EX.glb_facts(glb)
    log("exported", glb, facts["bytes"], "bytes", len(facts["clips"]), "clips")
    import motion_library_manifest as MM
    manifest = MM.library_manifest(L, facts, wanted)
    with open(os.path.join(out, f"library-{args.archetype}.json"), "w") as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
    report = {"archetype": args.archetype, "seconds": {"base": round(t_base, 1), "roles": round(t_roles, 1),
                                                       "total": round(time.time() - t0, 1)},
              "written": written, "prune": stats, "rep": EX.round_floats(L.rep), "takes": sorted(L.takes)}
    with open(os.path.join(out, f"report-{args.archetype}.json"), "w") as f:
        json.dump(report, f, indent=1, sort_keys=True, default=str)
    if args.test_bodies:
        import motion_library_proof as MP
        idx = MP.export_test_bodies(src, L, args.pop, args.test_bodies)
        log("test bodies", {k: v.get("placementScale") for k, v in idx["bodies"].items()})
    log("done")


if __name__ == "__main__":
    main()

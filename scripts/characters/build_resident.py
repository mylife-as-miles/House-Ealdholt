"""Build one Ealdholt resident from CC0/CC-BY sources in headless Blender.

    PYTHON_WITH_BPY -I scripts/characters/build_resident.py \
        --sources PRIVATE/sources.json --recipe scripts/characters/recipes/village-smith.json \
        --out NEW_OUTPUT_DIR [--stages body,groom,garments,props,textures,motion,lods,export]

PYTHON_WITH_BPY is a Python with the ``bpy`` module (Blender 5.2 LTS as a module) or
Blender itself (``blender -b --factory-startup --python build_resident.py -- ...``).
Each stage saves ``OUT/work/NN-stage.blend`` and later stages resume from the last
checkpoint, so a single stage can be rerun. Inputs are read only; outputs go to OUT.
Original Crownfall code: it reads CC0 MakeHuman data and CC0 Poly Haven files and
CC BY 4.0 100STYLE motion; it does not run MPFB2 or any GPL add-on code.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))

import bpy  # noqa: E402

STAGES = ("body", "groom", "garments", "props", "textures", "motion", "lods", "export")


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser(description="Build one resident")
    parser.add_argument("--sources", required=True)
    parser.add_argument("--recipe", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--stages", default=",".join(STAGES))
    return parser.parse_args(argv)


def main():
    args = parse()
    with open(args.sources) as handle:
        src = json.load(handle)
    with open(args.recipe) as handle:
        recipe = json.load(handle)
    out = os.path.abspath(args.out)
    work = os.path.join(out, "work")
    os.makedirs(work, exist_ok=True)
    report_path = os.path.join(out, "report.json")
    report = json.load(open(report_path)) if os.path.exists(report_path) else {}
    report["recipe"] = os.path.basename(args.recipe)
    stages = [s for s in args.stages.split(",") if s]
    for stage in stages:
        if stage not in STAGES:
            raise SystemExit(f"Unknown stage {stage}")
    first = STAGES.index(stages[0])
    if first > 0:
        previous = os.path.join(work, f"{first:02d}-{STAGES[first - 1]}.blend")
        if not os.path.exists(previous):
            raise SystemExit(f"Run the earlier stages first: missing {previous}")
        bpy.ops.wm.open_mainfile(filepath=previous)
    ctx = {"src": src, "recipe": recipe, "out": out, "work": work, "report": report}
    for stage in stages:
        started = time.time()
        module = __import__("stage_" + stage)
        module.run(ctx)
        report.setdefault("stageSeconds", {})[stage] = round(time.time() - started, 1)
        index = STAGES.index(stage) + 1
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(work, f"{index:02d}-{stage}.blend"), compress=True)
        with open(report_path, "w") as handle:
            json.dump(report, handle, indent=1, sort_keys=True)
        print(f"STAGE_DONE {stage} {report['stageSeconds'][stage]}s", flush=True)


if __name__ == "__main__":
    main()

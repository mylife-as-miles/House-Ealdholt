"""Print the measured-levels table of the household art doc from the published manifests (round 2 critic: the doc's
hand-copied figures went stale after each republish). Standard library only.

    python3 scripts/characters/review/doc_tables.py [CHARACTERS_DIR]

CHARACTERS_DIR defaults to main game/public/assets/legacy/environment/aethelgard/characters.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SETS = ("village-smith-v1", "smithy-spinner-v1", "smithy-child-v1", "smithy-elder-v1")
LEVELS = ("desktop-lod0", "desktop-lod1", "quest")
MIB = 1024 * 1024


def cell(level):
    return (f"{level['triangles']:,} tris, {level['materialCount']} mat, {level['maxMorphTargets']} morphs, "
            f"{level['bytes'] / MIB:.2f} MiB file, {level.get('morphTextureBytesEstimate', 0) / MIB:.2f} MiB morph texture")


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "main game", "public", "assets", "legacy", "environment",
                                                             "aethelgard", "characters")
    rows = ["| Set | desktop-lod0 | desktop-lod1 | quest | props (desktop / Quest) |", "| --- | --- | --- | --- | --- |"]
    for name in SETS:
        path = os.path.join(root, name, "manifest.json")
        if not os.path.exists(path):
            continue
        m = json.load(open(path))
        lv = m["levels"]
        props = lv.get("props", {})
        pq = lv.get("props-quest", {})
        rows.append(f"| {name} | " + " | ".join(cell(lv[k]) for k in LEVELS if k in lv) +
                    f" | {props.get('triangles', 0):,} / {pq.get('triangles', 0):,} tris, {props.get('bytes', 0) / MIB:.2f} / "
                    f"{pq.get('bytes', 0) / MIB:.2f} MiB |")
    print("\n".join(rows))


if __name__ == "__main__":
    main()

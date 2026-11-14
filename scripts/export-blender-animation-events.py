"""Export Crownfall animation notifies from Blender Actions.

Blender's glTF exporter does not standardise Action/event markers. This script
exports *real authored markers*, frame-accurate, into a v1 JSON sidecar consumed
by web/src/scene/animationContacts.ts.

Usage:
  blender --background warrior.blend --python scripts/export-blender-animation-events.py -- \
    --action "Sword_Judgment" --output web/public/models/sword-judgment.events.json

In the Dope Sheet / Action Editor add pose markers (where supported), or add
scene timeline markers named 'ActionName::impact' / 'ActionName::foot_left_plant'.
Markers must be inside the Action frame range. Never invent contact frames.
"""
import argparse
import json
import os
import sys

try:
    import bpy
except ImportError as exc:
    raise SystemExit("Run this script with Blender's Python executable.") from exc

NAMES = {
    "impact", "cast_release", "guard",
    "foot_left_plant", "foot_left_lift",
    "foot_right_plant", "foot_right_lift",
}

def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", required=True, help="Exact Blender Action datablock name")
    parser.add_argument("--output", required=True, help="Destination .events.json file")
    opts = parser.parse_args(args)
    action = bpy.data.actions.get(opts.action)
    if action is None:
        parser.error(f"No Action named {opts.action!r} in the open .blend file")

    scene = bpy.context.scene
    fps = scene.render.fps / scene.render.fps_base
    if fps <= 0:
        parser.error("Scene frame rate is invalid")
    begin, end = (float(v) for v in action.frame_range)
    if end <= begin:
        parser.error("Action must have a nonzero exported frame range")

    markers = {}
    poses = getattr(action, "pose_markers", None)
    if poses is not None:
        for marker in poses:
            if marker.name in NAMES:
                markers[(marker.name, float(marker.frame))] = None
    prefix = opts.action + "::"
    for marker in scene.timeline_markers:
        if marker.name.startswith(prefix):
            name = marker.name[len(prefix):]
            if name in NAMES:
                markers[(name, float(marker.frame))] = None

    events = []
    for name, frame in sorted(markers, key=lambda item: (item[1], item[0])):
        if frame < begin or frame > end:
            parser.error(f"Marker {name!r} at frame {frame} is outside [{begin}, {end}]")
        events.append({"name": name, "time": round((frame - begin) / fps, 6)})
    if not events:
        parser.error("No authored combat event markers found; refusing to create a fake sidecar")

    output = os.path.abspath(opts.output)
    os.makedirs(os.path.dirname(output), exist_ok=True)
    with open(output, "w", encoding="utf-8") as stream:
        json.dump({"version": 1, "action": action.name, "events": events}, stream, indent=2)
        stream.write("\n")
    print(f"[Crownfall] Exported {len(events)} Action markers to {output}")

if __name__ == "__main__":
    main()

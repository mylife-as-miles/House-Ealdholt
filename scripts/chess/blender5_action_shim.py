"""Run a script written for Blender 4.x's legacy Action API (action.fcurves) unchanged under Blender 5.x.

Blender 5 keeps an Action's F-curves in layers -> strips -> channelbags. This shim gives Action back a read-only
`fcurves` view over every channelbag, then runs the target script with its real path as __file__ (so a script that
hashes itself, like scripts/chess/build_combat_library.py, records the hash of its own unmodified bytes).

Usage: blender -b --factory-startup --python scripts/chess/blender5_action_shim.py -- <target.py> [target args...]"""
import runpy
import sys

import bpy


def _fcurves(action):
    curves = []
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                curves.extend(bag.fcurves)
    return curves


if not hasattr(bpy.types.Action, "fcurves"):
    bpy.types.Action.fcurves = property(_fcurves)

argv = sys.argv[sys.argv.index("--") + 1:]
target = argv[0]
# The target parses everything after "--" itself: hand it its own arguments only.
sys.argv = sys.argv[:sys.argv.index("--") + 1] + argv[1:]
runpy.run_path(target, run_name="__main__")

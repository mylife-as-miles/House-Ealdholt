"""Stage: shaped body, rig, weights, face morphs and fitted eyes/teeth/tongue/lashes."""
import json
import os

import bpy
import numpy as np

import body


def run(ctx):
    built = body.build(ctx["src"], ctx["recipe"], ctx["report"])
    np.save(os.path.join(ctx["work"], "coords.npy"), built["coords"])
    with open(os.path.join(ctx["work"], "body_ids.json"), "w") as handle:
        json.dump(built["body_ids"], handle)
    with open(os.path.join(ctx["work"], "per_vertex_weights.json"), "w") as handle:
        json.dump({str(k): v for k, v in built["per_vertex"].items()}, handle)
    for name in ("Body", "Eyes", "Teeth", "Tongue", "Eyelashes"):
        bpy.data.objects[name]["crownfall_part"] = name.lower()
    # LOD-only sources (never exported at LOD0): the low-poly proxy head and the low dental arches
    bpy.data.objects["HeadProxy"]["crownfall_part"] = "lod-source"
    bpy.data.objects["TeethLow"]["crownfall_part"] = "lod-source"

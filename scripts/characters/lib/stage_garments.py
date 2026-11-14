"""Stage: original layered garments and covered-skin removal (smith: garments.py; household: outfits.py)."""
import bpy

import garments
import outfits


def run(ctx):
    recipe = ctx["recipe"]
    builder = outfits if recipe["garments"].get("outfit", "smith") in outfits.OUTFITS else garments
    pieces = builder.build(bpy.data.objects["Body"], bpy.data.objects["Rig"], recipe, ctx["report"])
    ctx["report"]["garmentPieces"] = sorted(pieces)

"""Stage: role props (smith: hammer, tongs with workpiece, anvil on a stump; household kits: props_household.py)."""
import bpy

import props


def run(ctx):
    arm = bpy.data.objects["Rig"]
    if ctx["recipe"].get("props", {}).get("kit", "smith") != "smith":
        import props_household
        props_household.build(arm, ctx["recipe"], ctx["src"]["polyhaven"], ctx["report"])
        return
    bones = arm.data.bones
    recipe = ctx["recipe"]
    spec = recipe.setdefault("props", {})
    if "anvilFaceHeight" not in spec:
        # traditional anvil height: the smith's knuckles with the arm hanging straight
        reach = bones["upperarm_r"].length + bones["forearm_r"].length + bones["hand_r"].length * 0.75
        spec["anvilFaceHeight"] = round(bones["upperarm_r"].head_local.z - reach, 3)
    built = props.build(arm, recipe, ctx["src"]["polyhaven"], ctx["report"])
    built["anvil"].location.y = built["stump"].location.y = -spec.get("anvilDistance", 0.58)
    built["anvil"].rotation_euler.z = 3.14159265  # horn toward the smith's left
    # the strike point sits in front of the hammer shoulder, so the anvil stands slightly right of centre
    built["anvil"].location.x = built["stump"].location.x = spec.get("anvilOffsetX", -0.13)

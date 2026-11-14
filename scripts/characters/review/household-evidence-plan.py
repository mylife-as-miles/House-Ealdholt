"""Household group and interaction-aligned shots for render-resident.mjs (three.js harness plan).

    python3 scripts/characters/review/household-evidence-plan.py CHARACTERS_DIR OUT_PLAN.json
    node scripts/characters/review/render-resident.mjs OUT_PLAN.json EVIDENCE_DIR

CHARACTERS_DIR is main game/public/assets/legacy/environment/aethelgard/characters. Positions are three.js world
coordinates (x right, y up, z toward an az=0 camera); residents face +Z at yaw 0. Every shot uses daylight over a
plain untextured ground plane: no stand-in terrain, village or scene geometry (environment work is paused).
"""
import json, math, sys
glb_dir, out = sys.argv[1], sys.argv[2]
sets = {"sm": "village-smith", "sp": "smithy-spinner", "ch": "smithy-child", "el": "smithy-elder"}
models = {}
for k, base in sets.items():
    models[k] = f"{base}-v1/{base}-desktop-lod1.glb"
    models[k + "0"] = f"{base}-v1/{base}-desktop-lod0.glb"
    models["p" + k] = f"{base}-v1/{base}-props.glb"
def b2t(x, y, z=0.0):  # Blender (x left, -y forward, z up) to three.js
    return [x, z, -y]
def rot_y(v, yaw_deg):
    a = math.radians(yaw_deg)
    return [v[0] * math.cos(a) + v[2] * math.sin(a), v[1], -v[0] * math.sin(a) + v[2] * math.cos(a)]
def member(model, props_model, clip, time, root, yaw, props):
    return {"model": model, "clip": clip, "time": time, "root": root, "yaw": yaw,
            "props": [{"model": props_model, "node": n, **({"bone": b} if b else {})} for n, b in props]}
stick = [("prop_stick", "hand_l")]
# loose conversational arc, every member visible from the front: smith and elder at the ends turned inward,
# spinner and child between them
group = [member("sm", "psm", "talk", 1.6, [-1.15, 0, 0.05], 22, []),
         member("sp", "psp", "idle", 2.2, [-0.38, 0, 0.32], 6, []),
         member("ch", "pch", "idle", 1.0, [0.36, 0, 0.42], -12, []),
         member("el", "pel", "idle", 3.0, [1.08, 0, 0.08], -24, stick)]
group0 = [dict(m, model=m["model"] + "0") for m in group]
def shot(label, members, cam, light="village"):
    main, *rest = members
    return {**{k: v for k, v in main.items()}, "label": label, "light": light, "extras": rest, "camera": cam}
frames_group = [shot("household at 9 m (LOD1, daylight, plain ground)", group, {"az": 8, "el": 7, "dist": 9.0, "fov": 30, "target": [0.0, 0.85, 0.2]}),
                shot("household at 15 m (LOD1)", group, {"az": -20, "el": 9, "dist": 15.0, "fov": 30, "target": [0.0, 0.85, 0.2]}),
                shot("household at 5 m (LOD0)", group0, {"az": 8, "el": 6, "dist": 5.2, "fov": 40, "target": [0.12, 0.9, 0.2]}),
                shot("household from behind at 8 m (LOD1)", group, {"az": 172, "el": 8, "dist": 8.0, "fov": 30, "target": [0.0, 0.85, 0.2]})]
# interaction: the smith strikes at the anvil while the child works the bellows feeding the same hearth
child_root = [-1.85, 0, -0.4]
hearth = [child_root[0] + 0.95, 0, child_root[2] + 1.3]
forge = lambda t_smith, t_child, sm="sm", ch="ch": [member(sm, "psm", "work_hammer", t_smith, [0, 0, 0], 0, [("prop_hammer", "hand_r"), ("prop_tongs", "hand_l"), ("workplace", None)]),
                                                     member(ch, "pch", "work_bellows", t_child, child_root, 0, [("prop_bellows_lever", "hand_r"), ("workplace", None)])]
frames_forge = [shot("forge: strike 0.64 s, bellows down (LOD0)", forge(0.64, 0.5, "sm0", "ch0"), {"az": -25, "el": 12, "dist": 4.6, "fov": 32, "target": [-0.85, 0.85, 0.45]}),
                shot("forge: backswing 0.45 s, bellows up (LOD0)", forge(0.45, 1.3, "sm0", "ch0"), {"az": -25, "el": 12, "dist": 4.6, "fov": 32, "target": [-0.85, 0.85, 0.45]}),
                shot("forge at 9 m (LOD1, daylight)", forge(1.62, 1.9), {"az": -35, "el": 9, "dist": 9.0, "fov": 30, "target": [-0.85, 0.8, 0.4]}),
                shot("forge from the hearth side (LOD0)", forge(0.6, 0.45, "sm0", "ch0"), {"az": -80, "el": 10, "dist": 4.2, "fov": 32, "target": [-0.85, 0.85, 0.45]})]
seq = [shot("", forge(round((i / 30) % 2.4, 4), round((i / 30) % 2.8, 4)), {"az": -25, "el": 12, "dist": 4.8, "fov": 32, "target": [-0.85, 0.85, 0.45]}) for i in range(0, 85)]
# second interaction at the house: the spinner spins standing by her basket while the elder carves seated on her
# stool beside her (both registered at smithy-house); turned a little toward each other
home = lambda t_sp, t_el, sp="sp", el="el": [member(sp, "psp", "work_spindle", t_sp, [-0.62, 0, 0.0], 18, [("prop_spindle", "hand_l"), ("prop_fibre_roll", "hand_l"), ("workplace", None)]),
                                             member(el, "pel", "work_carving", t_el, [0.62, 0, 0.12], -28, [("prop_knife", "hand_r"), ("prop_spoon", "hand_l"), ("workplace", None)])]
frames_home = [shot("home: spinning and carving side by side (LOD0, 4.5 m)", home(0.8, 0.6, "sp0", "el0"), {"az": 6, "el": 9, "dist": 4.5, "fov": 32, "target": [0.0, 0.8, 0.1]}),
               shot("home: a later beat of both loops (LOD0)", home(2.75, 2.15, "sp0", "el0"), {"az": 30, "el": 9, "dist": 4.8, "fov": 32, "target": [0.22, 0.75, 0.1]}),
               shot("home at 9 m (LOD1, daylight)", home(1.95, 1.55), {"az": -15, "el": 8, "dist": 9.0, "fov": 30, "target": [0.0, 0.75, 0.1]}),
               shot("home from the elder's side (LOD0)", home(3.35, 3.4, "sp0", "el0"), {"az": 70, "el": 10, "dist": 4.8, "fov": 32, "target": [0.2, 0.72, 0.1]})]
seq_home = [shot("", home(round((i / 30) % 4.0, 4), round((i / 30) % 4.0, 4)), {"az": 12, "el": 9, "dist": 4.6, "fov": 32, "target": [0.0, 0.8, 0.1]}) for i in range(0, 120)]
plan = {"modelDir": glb_dir, "models": models, "outputs": [
    {"file": "group-normal-distance.png", "size": [720, 520], "cols": 2, "frames": frames_group},
    {"file": "interaction-forge.png", "size": [720, 520], "cols": 2, "frames": frames_forge},
    {"sequence": "seq-forge", "size": [720, 520], "frames": seq},
    {"file": "interaction-home.png", "size": [720, 520], "cols": 2, "frames": frames_home},
    {"sequence": "seq-home", "size": [720, 520], "frames": seq_home}], "measure": []}
json.dump(plan, open(out, "w"))
print(out, "hearth (three.js)", hearth)

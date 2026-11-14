"""Bake Crownfall Pawn combat library v2: CC0 animations retargeted in Blender.

Extends `build_combat_library.py` (v1, procedurally keyframed) rather than
replacing it: the same empty-node scene, GLB merge, marker extras and manifest
shape are reused from that module. What changes is where the motion comes from.
Every clip here is a professionally made CC0 animation (Quaternius Universal
Animation Library 1 + 2, KayKit Character Animations) retargeted onto the four
pinned Pawn rigs by `combat_retarget.py`:

  bone map + rest-pose alignment -> pelvis path -> planted-foot IK lock ->
  spear/shield re-seating (wrist aim + shield IK) -> motion-derived markers.

Runs under Blender 4.3+ or the `bpy` 5.2 Python module:

  python scripts/chess/build_combat_library_v2.py -- \
    --sources PRIVATE/pawn-sources/manifest.json --animations PRIVATE/cc0-animations \
    --sockets web/src/assets/chess/combat-v1/prop-sockets-kingdoms.json \
    --output web/src/assets/chess/combat-v2 --scratch PRIVATE/combat-v2-bake --classes wp,bp,ep,kp

Authored timing is kept: sources are sampled at their own rate, 30 fps.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_combat_library as v1  # noqa: E402  (scene, GLB merge and marker export are shared with v1)
import combat_retarget as cr  # noqa: E402

FPS = cr.FPS
VERSION = "crownfall-pawn-combat-2"
HALF_PI = math.pi/2

# pack id -> (rig family, file inside the fetched cache). Hashes live in provenance.json.
FILES = {
    "ual1": ("quaternius", "ual1/UAL1_Standard_RM.glb"),
    "ual2": ("quaternius", "ual2/UAL2_Standard_RM.glb"),
    "kaykit-melee": ("kaykit", "kaykit/Rig_Medium_CombatMelee.glb"),
    "kaykit-general": ("kaykit", "kaykit/Rig_Medium_General.glb"),
    "kaykit-movement": ("kaykit", "kaykit/Rig_Medium_MovementAdvanced.glb"),
    "kaykit-simulation": ("kaykit", "kaykit/Rig_Medium_Simulation.glb"),
}
GUARD = dict(file="ual2", clip="Idle_Shield_Loop")

# id, tags, marker kind, source file + clip, and the retarget/prop options.
# `derived` marks clips whose direction was changed from the authored one.
CLIPS = [
    # --- attack
    dict(id="attack.thrust", tags=["attack", "polearm", "mid", "thrust", "committed"], kind="thrust", file="kaykit-melee", clip="Melee_1H_Attack_Stab", spear="thrust"),
    dict(id="attack.jab", tags=["attack", "polearm", "high", "jab", "quick"], kind="thrust", file="ual1", clip="Punch_Cross", spear="thrust", shield="front"),
    dict(id="attack.bash", tags=["attack", "shield", "mid", "bash"], kind="bash", file="ual2", clip="Shield_OneShot", shield="front"),
    dict(id="ready.windup", tags=["ready", "polearm", "windup", "anticipation"], kind="windup", file="kaykit-melee", clip="Melee_1H_Attack_Stab", spear="thrust",
         trim="cock", hold_level=True),
    dict(id="ready.feint", tags=["ready", "polearm", "feint"], kind="feint", file="ual1", clip="Punch_Jab", mirror=True, spear="thrust", shield="front"),
    # --- defence
    dict(id="ready.guard", tags=["ready", "shield", "guard", "idle"], kind="guard", file="ual2", clip="Idle_Shield_Loop", shield="front", loop=True),
    dict(id="defend.block-mid", tags=["defense", "shield", "mid", "block"], kind="block", file="kaykit-melee", clip="Melee_Block", shield="block", line="mid"),
    dict(id="defend.block-high", tags=["defense", "shield", "high", "block"], kind="block", file="kaykit-melee", clip="Melee_Block", shield="block", line="high"),
    dict(id="defend.block-impact", tags=["defense", "shield", "mid", "block", "absorb"], kind="hit", file="kaykit-melee", clip="Melee_Block_Hit", shield="block-held", line="mid"),
    dict(id="defend.parry", tags=["defense", "polearm", "mid", "parry"], kind="parry", file="ual2", clip="Sword_Block", spear="parry", shield="front"),
    dict(id="defend.dodge-left", tags=["defense", "evade", "dodge", "left"], kind="dodge", file="kaykit-movement", clip="Dodge_Left"),
    dict(id="defend.dodge-right", tags=["defense", "evade", "dodge", "right"], kind="dodge", file="kaykit-movement", clip="Dodge_Right"),
    dict(id="defend.dodge-back", tags=["defense", "evade", "dodge", "back"], kind="dodge", file="kaykit-movement", clip="Dodge_Backward"),
    # --- reactions and movement
    dict(id="hit.recoil", tags=["hit", "recoil", "front", "guard-break"], kind="hit", file="ual2", clip="Idle_Shield_Break", shield="front-fade"),
    dict(id="hit.stagger-light", tags=["hit", "stagger", "light", "front"], kind="hit", file="kaykit-general", clip="Hit_A"),
    dict(id="hit.stagger-heavy", tags=["hit", "stagger", "heavy", "front"], kind="hit", file="kaykit-general", clip="Hit_B"),
    dict(id="hit.front", tags=["hit", "light", "front", "chest"], kind="hit", file="ual1", clip="Hit_Chest"),
    dict(id="hit.head", tags=["hit", "light", "front", "head"], kind="hit", file="ual1", clip="Hit_Head"),
    dict(id="hit.back", tags=["hit", "light", "back", "derived"], kind="hit", file="kaykit-general", clip="Hit_A", redirect=math.pi, derived="Hit_A reaction turned 180 degrees about the vertical axis"),
    dict(id="hit.left", tags=["hit", "light", "left", "derived"], kind="hit", file="kaykit-general", clip="Hit_A", redirect=HALF_PI, derived="Hit_A reaction turned 90 degrees: struck from the left, reels right"),
    dict(id="hit.right", tags=["hit", "light", "right", "derived"], kind="hit", file="kaykit-general", clip="Hit_A", redirect=-HALF_PI, derived="Hit_A reaction turned -90 degrees: struck from the right, reels left"),
    dict(id="ready.step-forward", tags=["ready", "step", "forward", "guard"], kind="step", file="ual1", clip="Walk_Loop", upper=GUARD, shield="front"),
    dict(id="ready.step-back", tags=["ready", "step", "back", "guard"], kind="step", file="kaykit-movement", clip="Walking_Backwards", treadmill=True, upper=GUARD, shield="front"),
    # --- deaths
    dict(id="death.forward", tags=["death", "forward", "front"], kind="death", file="kaykit-general", clip="Death_B", anchor=True),
    dict(id="death.backward", tags=["death", "backward"], kind="death", file="kaykit-general", clip="Death_A", anchor=True),
    dict(id="death.collapse", tags=["death", "collapse", "knee-buckle", "backward"], kind="death", file="ual1", clip="Death01", anchor=True),
    dict(id="death.left", tags=["death", "left", "derived"], kind="death", file="kaykit-general", clip="Death_A", anchor=True, spin=-HALF_PI,
         derived="Death_A (backward fall) with a whole-body quarter turn eased in over the first 8 frames: spins and falls to the fighter's left"),
    dict(id="death.right", tags=["death", "right", "derived"], kind="death", file="kaykit-general", clip="Death_A", anchor=True, spin=HALF_PI,
         derived="Death_A (backward fall) with a whole-body quarter turn eased in over the first 8 frames: spins and falls to the fighter's right"),
    # --- after the fight
    dict(id="recovery.victory", tags=["recovery", "victory"], kind="victory", file="kaykit-simulation", clip="Cheering"),
    dict(id="recovery.settle", tags=["recovery", "idle", "settle"], kind="settle", file="ual1", clip="Idle_Loop", loop=True),
]
RETARGET_SETTINGS = {
    "fps": FPS,
    "restPoseAlignment": "per-bone shortest arc from the Pawn bind direction to the source reference pose (A_TPose / T-Pose)",
    "rotation": "world-space delta from the source reference pose, applied to the aligned Pawn bind pose",
    "pelvis": "horizontal travel scaled by the smaller of the head-height and leg-length ratios; height mapped standing-to-standing and lying-to-lying (pelvis radius 0.11 m)",
    "footLock": "source ankle below 3% (plant) / above 5.5% (lift) of source head height and slower than 0.35 heights/s; "
                "locked feet solved with two-bone IK, 5-frame blend out; falls anchor the pelvis to the locked feet instead",
    "treadmill": "in-place gaits get their travel from the planted foot",
    "props": "wrist turned so the spear is carried upright, levels on the attack line through thrusts, and the shield faces the opponent; "
             "block clips pull the shield centre onto the incoming thrust line with two-bone IK",
    "boneMaps": cr.BONE_MAPS,
}


def retarget_clip(pawn, sources, spec):
    family, _ = FILES[spec["file"]]; source = sources[spec["file"]]
    options = dict(mirror=spec.get("mirror", False), redirect=spec.get("redirect", 0.), treadmill=spec.get("treadmill", False), anchor=spec.get("anchor", False),
                   spin=spec.get("spin", 0.))
    pose, info = cr.retarget(pawn, source, spec["clip"], **options)
    if spec.get("trim") == "cock":
        # wind-up: the authored anticipation only, cut at the most drawn-back frame
        reach = pose.pos("RightHand")[:, 2]-pose.pos("Spine")[:, 2]
        peak = int(np.argmax(reach)); cock = int(np.argmin(reach[:peak+1]))
        pose, info = cr.retarget(pawn, source, spec["clip"], start=0, end=cock/FPS, **options)
    if spec.get("upper"):
        # upper-body layer: spine, arms and head of the guard idle over the gait's legs
        top = spec["upper"]; guard, _ = cr.retarget(pawn, sources[top["file"]], top["clip"])
        sk = pawn.skel; stack = [sk.index["Spine02"]]; members = []
        while stack:
            i = stack.pop(); members.append(i); stack.extend(sk.children(i))
        frames = np.arange(pose.frames) % guard.frames
        pose.local_r[:, members] = guard.local_r[frames][:, members]; pose.world = None
    shield = spec.get("shield", "carry"); prop_spec = dict(spec)
    prop_spec["shield"] = {"front-fade": "front"}.get(shield, shield)
    cr.apply_props(pose, prop_spec, info)
    markers = cr.derive_markers(pose, spec, info)
    return pose, info, markers


def _clean(value):
    """Round for the sidecar; no negative zeros (JSON round-trips them as -0)."""
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, float):
        value = round(value, 4)
        return 0.0 if value == 0 else value
    return value


def metadata(pawn, spec, pose, info, markers):
    squares = pawn.sockets["normalizationScale"]            # board squares per rig metre
    hips = info["hips"]; travel = (hips-hips[0])[:, [0, 2]]*squares
    peak = int(np.argmax(np.linalg.norm(travel, axis=1)))
    record = dict(
        id=spec["id"], version=VERSION, archetype=pawn.key, tags=spec["tags"], fps=FPS, duration=(pose.frames-1)/FPS,
        markers=[dict(name=name, frame=frame, time=frame/FPS) for name, frame in markers],
        loop=bool(spec.get("loop", False)),
        source=dict(pack=spec["file"].split("-")[0], file=FILES[spec["file"]][1], clip=spec["clip"],
                    seconds=[round(v, 4) for v in info["source_time"]], mirrored=bool(spec.get("mirror", False)),
                    yawDegrees=round(math.degrees(spec.get("redirect", 0.)), 1), spinDegrees=round(math.degrees(spec.get("spin", 0.)), 1)),
        rootTravel=dict(units="squares", axes=["side(+left)", "along(+forward)"], net=[round(float(v), 4) for v in travel[-1]],
                        peak=[round(float(v), 4) for v in travel[peak]], peakFrame=peak,
                        track=[[round(float(x), 4), round(float(z), 4)] for x, z in travel]),
    )
    if spec.get("upper"):
        record["source"]["upperBody"] = dict(pack=spec["upper"]["file"], clip=spec["upper"]["clip"])
    if spec.get("derived"):
        record["derived"] = spec["derived"]
    if "contact" in info:
        c = info["contact"]
        record["contact"] = dict(anchor=c["anchor"], frame=c["frame"], metres=[round(v, 4) for v in c["metres"]],
                                 squares=[round(v*squares, 4) for v in c["metres"]])
    if "blockLine" in info:
        record["blockLine"] = dict(heightMetres=round(info["blockLine"]["height"], 4), residualMetres=round(info["blockLine"]["residual"], 4))
    if "land" in info:
        record["land"] = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in info["land"].items()}
    record["footLockResidualMetres"] = round(max(info.get("footResidual", {"": 0.}).values()), 4)
    keep = {name: record[name] for name in ("fps", "duration", "markers")}
    record = _clean(record); record.update(keep)
    return record


def key_pose(objects_by_index, pawn, pose, frame, f):
    sk = pawn.skel
    for i, obj in objects_by_index.items():
        t = pose.local_t[f, i]; r = pose.local_r[f, i]; s = sk.rest_s[i]
        obj.matrix_basis = v1.C @ Matrix.LocRotScale(Vector(t), Quaternion((r[3], r[0], r[1], r[2])), Vector(s)) @ v1.CI
        obj.keyframe_insert(data_path="location", frame=frame)
        obj.keyframe_insert(data_path="rotation_quaternion", frame=frame)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources", required=True); parser.add_argument("--animations", required=True)
    parser.add_argument("--output", required=True); parser.add_argument("--scratch", required=True)
    parser.add_argument("--sockets", required=True); parser.add_argument("--classes", default="wp,bp")
    parser.add_argument("--only", default=""); parser.add_argument("--dump", default="")
    parser.add_argument("--provenance", default=str(Path(__file__).resolve().parents[2]/"web/src/assets/chess/combat-v2/provenance.json"))
    argv = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)
    source_rows = json.loads(Path(args.sources).read_text()); output = Path(args.output); scratch = Path(args.scratch)
    socket_bytes = Path(args.sockets).read_bytes(); socket_catalog = json.loads(socket_bytes)["archetypes"]
    output.mkdir(parents=True, exist_ok=True); scratch.mkdir(parents=True, exist_ok=True)
    provenance_path = Path(args.provenance); provenance = json.loads(provenance_path.read_text())
    pinned = {f["path"]: f for pack in provenance["packs"] for f in pack["files"]}
    sources = {}
    for name, (family, relative) in FILES.items():
        path = Path(args.animations)/relative
        if hashlib.sha256(path.read_bytes()).hexdigest() != pinned[relative]["sha256"]:
            raise ValueError("CC0 animation source changed: "+relative)
        sources[name] = cr.SourceRig(family, path)
    scene = bpy.context.scene; scene.render.fps = FPS
    try:
        bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    except Exception:
        pass
    available = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    v1.VERSION = VERSION
    generator = hashlib.sha256(b"".join(Path(__file__).with_name(n).read_bytes() for n in
                                        ("build_combat_library_v2.py", "combat_retarget.py", "build_combat_library.py"))).hexdigest()
    for key in args.classes.split(","):
        rows = {row["role"]: row for row in source_rows if row["class"] == key}
        for row in rows.values():
            if hashlib.sha256(Path(row["path"]).read_bytes()).hexdigest() != row["sha256"]:
                raise ValueError("Source hash changed: "+row["path"])
        sockets = socket_catalog[key]
        if sockets["sourceSha256"] != rows["rigged"]["sha256"]:
            raise ValueError("Prop sockets belong to another source rig")
        pawn = cr.PawnRig(key, rows["rigged"]["path"], rows["idle"]["path"], sockets)
        check = pawn.socket_check()
        if check["weaponLocal"] > .002 or check["shieldNormal"] > .5:
            raise ValueError(f"Prop frames disagree with the prop sockets file: {check}")
        rig, _ = v1.read_glb(rows["rigged"]["path"]); objects, indexed = v1.build_scene(rig)
        parents = {child: i for i, node in enumerate(rig["nodes"]) for child in node.get("children", [])}
        (output/(key+"-skeleton.json")).write_text(json.dumps({
            "sourceSha256": rows["rigged"]["sha256"], "nodes": [
                {"name": obj.name, "parent": rig["nodes"][parents[i]]["name"] if parents.get(i) in indexed else None,
                 **{prop: rig["nodes"][i][prop] for prop in ("translation", "rotation", "scale", "matrix") if prop in rig["nodes"][i]}}
                for i, obj in indexed.items()]}, indent=2)+"\n")
        paths = []; records = []; dump = {}
        for spec in CLIPS:
            if args.only and spec["id"] not in args.only.split(","):
                continue
            pose, info, markers = retarget_clip(pawn, sources, spec)
            record = metadata(pawn, spec, pose, info, markers); last = pose.frames-1
            for obj in objects.values():
                obj.animation_data_create(); action = bpy.data.actions.new(spec["id"]+":"+obj.name)
                action.use_fake_user = True; obj.animation_data.action = action
            marker_action = next(iter(objects.values())).animation_data.action
            for name, frame in markers:
                marker_action.pose_markers.new(name).frame = frame
            for f in range(pose.frames):
                scene.frame_set(f); key_pose(indexed, pawn, pose, f, f)
            scene.frame_start = 0; scene.frame_end = last; scene.frame_set(0)
            path = scratch/(key+"-"+spec["id"]+".glb")
            options = dict(filepath=str(path), export_format="GLB", export_yup=True, export_animations=True,
                           export_animation_mode="SCENE", export_frame_range=True, export_force_sampling=True,
                           export_extras=True, export_animation_name=spec["id"], export_anim_scene_split_object=False,
                           export_optimize_animation_size=False)
            bpy.ops.export_scene.gltf(**{name: value for name, value in options.items() if name in available})
            record["markers"] = [dict(name=m.name, frame=m.frame, time=m.frame/FPS) for m in marker_action.pose_markers]
            paths.append(path); records.append(record)
            if args.dump:
                dump[spec["id"]] = dict(t=pose.local_t.tolist(), r=pose.local_r.tolist())
            print("BAKED", key, spec["id"], pose.frames, [(n, f) for n, f in markers if not n.startswith("foot_")],
                  "travel", record["rootTravel"]["net"], "footRes", record["footLockResidualMetres"], flush=True)
        target = output/(key+".glb"); v1.merge_clips(paths, records, target)
        data = target.read_bytes()
        manifest = dict(version=VERSION, archetype=key, bytes=len(data), sha256=hashlib.sha256(data).hexdigest(),
                        socketSourceSha256=hashlib.sha256(socket_bytes).hexdigest(), generatorSha256=generator,
                        provenance="provenance.json", provenanceSha256=hashlib.sha256(provenance_path.read_bytes()).hexdigest(),
                        blender=bpy.app.version_string, clips=records,
                        sources=[{name: row[name] for name in ("role", "url", "sha256", "bytes")} for row in rows.values()])
        (output/(key+".json")).write_text(json.dumps(manifest, indent=2)+"\n")
        bpy.ops.wm.save_as_mainfile(filepath=str(scratch/(key+"-authoring.blend")))
        if args.dump:
            Path(args.dump).mkdir(parents=True, exist_ok=True); (Path(args.dump)/(key+".json")).write_text(json.dumps(dump))
        print("CHECK", key, check, flush=True); print("LIBRARY", key, len(records), len(data), flush=True)


if __name__ == "__main__":
    main()

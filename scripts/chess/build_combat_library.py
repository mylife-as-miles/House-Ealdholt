"""Bake Crownfall Pawn combat channels and Blender pose-marker events.

blender -b --factory-startup --python scripts/chess/build_combat_library.py -- \
  --sources PRIVATE/manifest.json --output web/src/assets/chess/combat-v1 \
  --sockets PRIVATE/prop-sockets.json --scratch PRIVATE/combat-bake --classes wp,bp

Input GLBs are read only. No meshes/textures are copied to the output library.
Empty-node channels preserve the source joint coordinate frames exactly;
Three.js binds the named channels to the existing skinned figures' bones.
"""
import argparse
import bisect
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

FPS = 30
VERSION = "crownfall-pawn-combat-1"
C = Matrix.Rotation(math.pi / 2, 4, "X")
CI = C.inverted()
AXES = [C.to_3x3() @ Vector(v) for v in [(1, 0, 0), (0, 1, 0), (0, 0, 1)]]

# Contact frames are authored poses, not percentages of an imported clip.
RECIPES = [
    ("attack.thrust", 42, {"ready": 8, "contact": 24, "recovery": 34}, ["attack", "polearm", "mid", "thrust"]),
    ("attack.bash-thrust", 66, {"ready": 8, "clash": 20, "contact": 45, "recovery": 57}, ["attack", "polearm", "mid", "shield"]),
    ("attack.feint-step", 72, {"ready": 8, "feint": 20, "contact": 49, "recovery": 63}, ["attack", "polearm", "mid", "feint"]),
    ("defend.block", 36, {"guard": 14, "recovery": 29}, ["defense", "shield", "mid"]),
    ("defend.parry", 36, {"guard": 14, "recovery": 29}, ["defense", "polearm", "mid"]),
    ("defend.evade", 42, {"evade": 16, "recovery": 34}, ["defense", "evade", "mid"]),
    ("hit.light", 30, {"hit": 5, "recovery": 24}, ["hit", "light", "front"]),
    ("hit.medium", 39, {"hit": 7, "recovery": 32}, ["hit", "medium", "front"]),
    ("hit.heavy", 48, {"hit": 9, "recovery": 40}, ["hit", "heavy", "front"]),
    ("death.front", 51, {"hit": 4, "land": 43}, ["death", "front"]),
    ("death.backward", 57, {"hit": 4, "land": 48}, ["death", "backward"]),
    ("death.dramatic", 66, {"hit": 5, "land": 56}, ["death", "heavy"]),
    ("ready.raise", 30, {"ready": 20}, ["ready", "polearm"]),
    ("ready.stance", 36, {"ready": 25}, ["ready", "shield"]),
    ("recovery.stance", 27, {"recovery": 22}, ["recovery"]),
    ("recovery.victory", 45, {"victory": 23, "recovery": 39}, ["recovery", "victory"]),
]


def contact_markers(clip_id, frames, markers):
    """Notifies match the authored foot trajectories below, including returns."""
    events = [("start", 0), *markers.items(), ("end", frames)]
    if "contact" in markers:
        events.append(("impact", markers["contact"]))
    if clip_id.startswith("death."):
        return events
    for side in ("left", "right"):
        events.append((f"foot_{side}_plant", 0))
        if clip_id == "attack.bash-thrust":
            start, peak, end = (8, 23, 39) if side == "left" else (3, 20, 34)
            events.extend([(f"foot_{side}_lift", start), (f"foot_{side}_plant", peak),
                           (f"foot_{side}_lift", peak+1), (f"foot_{side}_plant", end)])
        elif clip_id in ("attack.feint-step", "defend.evade"):
            events.extend([(f"foot_{side}_lift", 1), (f"foot_{side}_plant", frames)])
    return sorted(events, key=lambda item: (item[1], item[0]))


def read_glb(path):
    data = Path(path).read_bytes()
    if data[:4] != b"glTF":
        raise ValueError(f"Not GLB: {path}")
    chunks = {}; offset = 12
    while offset < len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        chunks[kind] = data[offset + 8:offset + 8 + length]; offset += length + 8
    return json.loads(chunks[0x4E4F534A]), chunks.get(0x004E4942, b"")


def write_glb(path, document, binary):
    encoded = json.dumps(document, separators=(",", ":")).encode()
    encoded += b" " * ((-len(encoded)) % 4)
    binary += b"\0" * ((-len(binary)) % 4)
    data = struct.pack("<III", 0x46546C67, 2, 28 + len(encoded) + len(binary))
    data += struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
    data += struct.pack("<II", len(binary), 0x004E4942) + binary
    Path(path).write_bytes(data)


def accessor(document, binary, index):
    item = document["accessors"][index]; view = document["bufferViews"][item["bufferView"]]
    width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[item["type"]]
    if item["componentType"] != 5126 or "sparse" in item:
        raise ValueError("Combat inputs must contain dense float animation accessors")
    offset = view.get("byteOffset", 0) + item.get("byteOffset", 0)
    stride = view.get("byteStride", width * 4)
    return [struct.unpack_from("<" + "f" * width, binary, offset + stride * i) for i in range(item["count"])]


class SourceClip:
    def __init__(self, path):
        doc, data = read_glb(path); self.channels = {}; self.duration = 0
        for channel in doc["animations"][0]["channels"]:
            sample = doc["animations"][0]["samplers"][channel["sampler"]]
            times = [v[0] for v in accessor(doc, data, sample["input"])]
            values = accessor(doc, data, sample["output"])
            self.duration = max(self.duration, times[-1])
            self.channels[(doc["nodes"][channel["target"]["node"]]["name"], channel["target"]["path"])] = (times, values, sample.get("interpolation", "LINEAR"))

    def sample(self, name, kind, time, default):
        entry = self.channels.get((name, kind))
        if not entry:
            return default
        times, values, mode = entry
        at = min(len(times) - 1, max(0, bisect.bisect_right(times, time) - 1))
        if at == len(times) - 1 or mode == "STEP":
            return values[at * 3 + 1] if mode == "CUBICSPLINE" else values[at]
        span = times[at + 1] - times[at]; t = max(0, min(1, (time - times[at]) / max(span, 1e-9)))
        if mode == "CUBICSPLINE":
            a, b = values[at * 3 + 1], values[(at + 1) * 3 + 1]
            ta, tb = values[at * 3 + 2], values[(at + 1) * 3]
            v = [(2*t**3-3*t*t+1)*x + (t**3-2*t*t+t)*span*dx + (-2*t**3+3*t*t)*y + (t**3-t*t)*span*dy for x, y, dx, dy in zip(a, b, ta, tb)]
        elif kind == "rotation":
            a, b = values[at], values[at + 1]
            q = Quaternion((a[3], *a[:3])).slerp(Quaternion((b[3], *b[:3])), t)
            return (q.x, q.y, q.z, q.w)
        else:
            v = [x + (y - x) * t for x, y in zip(values[at], values[at + 1])]
        if kind == "rotation":
            q = Quaternion((v[3], *v[:3])).normalized(); return (q.x, q.y, q.z, q.w)
        return v


def smooth(t):
    t = max(0, min(1, t)); return t*t*(3-2*t)


def pulse(frame, start, peak, end):
    return smooth((frame-start)/max(1, peak-start)) if frame <= peak else 1-smooth((frame-peak)/max(1, end-peak))


def update():
    bpy.context.view_layer.update()


def rotate_world(obj, axis, angle):
    if not obj or abs(angle) < 1e-8:
        return
    parent = obj.parent.matrix_world.to_quaternion() if obj.parent else Quaternion()
    obj.rotation_quaternion = parent.inverted() @ Quaternion(axis, angle) @ parent @ obj.rotation_quaternion
    update()


def solve_limb(upper, lower, end, target):
    """Two-joint analytic IK; no joint lengths or translations are changed."""
    if not all((upper, lower, end)):
        return
    a, b, c = [o.matrix_world.translation.copy() for o in (upper, lower, end)]
    first, second = (b-a).length, (c-b).length
    if min(first, second) < 1e-7:
        return
    direction = target-a
    if direction.length < 1e-7:
        return
    distance = min(first+second-1e-6, max(abs(first-second)+1e-6, direction.length)); direction.normalize()
    pole = b-a-direction*((b-a).dot(direction))
    if pole.length < 1e-6:
        pole = AXES[0]-direction*AXES[0].dot(direction)
    if pole.length < 1e-6:
        pole = AXES[2]-direction*AXES[2].dot(direction)
    pole.normalize()
    along = (first*first-second*second+distance*distance)/(2*distance)
    elbow = a+direction*along+pole*math.sqrt(max(0, first*first-along*along))
    rotate_world(upper, (b-a).cross(elbow-a).normalized() if (b-a).cross(elbow-a).length > 1e-8 else AXES[0], (b-a).angle(elbow-a, 0))
    b, c = lower.matrix_world.translation.copy(), end.matrix_world.translation.copy()
    q = (c-b).rotation_difference(a+direction*distance-b)
    parent = lower.parent.matrix_world.to_quaternion() if lower.parent else Quaternion()
    lower.rotation_quaternion = parent.inverted() @ q @ parent @ lower.rotation_quaternion
    update()


def solve_socket(chain, local_point, target, weight):
    if weight <= 0:
        return 0
    upper, lower, hand = chain
    before = [obj.rotation_quaternion.copy() for obj in chain]
    point = hand.matrix_world @ local_point; grip = hand.matrix_world.translation.copy()
    shaft_length = (point-grip).length; direction = (target-upper.matrix_world.translation).normalized()
    solve_limb(upper, lower, hand, target-direction*shaft_length)
    grip = hand.matrix_world.translation.copy(); point = hand.matrix_world @ local_point
    if (point-grip).length > 1e-8 and (target-grip).length > 1e-8:
        correction = (point-grip).rotation_difference(target-grip)
        parent = hand.parent.matrix_world.to_quaternion() if hand.parent else Quaternion()
        hand.rotation_quaternion = parent.inverted() @ correction @ parent @ hand.rotation_quaternion
    solved = [obj.rotation_quaternion.copy() for obj in chain]
    for obj, a, b in zip(chain, before, solved):
        obj.rotation_quaternion = a.slerp(b, weight)
    update()
    return ((hand.matrix_world @ local_point)-target).length


def contact_root_adjustment(chain, local_point, target, weight, unit):
    upper, lower, hand = chain
    a, b, c = [obj.matrix_world.translation.copy() for obj in chain]
    length = ((hand.matrix_world @ local_point)-c).length
    arm = (b-a).length+(c-b).length
    direction = target-a; distance = direction.length
    if distance < 1e-8:
        return Vector()
    direction.normalize()
    maximum, minimum = length+arm*.97, max(0, length-arm*.97)
    shift = direction*(max(0, distance-maximum)-max(0, minimum-distance))*weight
    if shift.length > unit*.12:
        raise ValueError(f"Contact needs a new approach pose: shift={shift.length/unit:.4f} body-heights, target={distance:.4f}, socket={length:.4f}, arm={arm:.4f}, weight={weight:.3f}")
    return shift


def author_pose(objects, unit, clip_id, frame, last, markers, ground_floor, sockets):
    hips = objects.get("Hips"); spine = objects.get("Spine")
    right = [objects.get(n) for n in ("RightArm", "RightForeArm", "RightHand")]
    left = [objects.get(n) for n in ("LeftArm", "LeftForeArm", "LeftHand")]
    feet = {side: objects.get(side+"Foot").matrix_world.translation.copy() for side in ("Left", "Right")}
    goals = [right[-1].matrix_world.translation.copy(), left[-1].matrix_world.translation.copy()]
    dx = dy = dz = lean = twist = ready = 0.; thrust = shield = side = 0.
    if clip_id.startswith("attack."):
        contact = markers["contact"]; strike = pulse(frame, max(0, contact-15), contact, last)
        wind = pulse(frame, 0, max(6, contact-18), contact)
        thrust = .27*strike-.10*wind; lean = .12*strike-.06*wind; ready = .08*strike
        if clip_id == "attack.bash-thrust":
            bash = pulse(frame, 3, markers["clash"], 34)
            shield = .25*bash; dz = .40*bash; dy = -.08*bash; dx = -.04*bash; twist = -.35*bash
        if clip_id == "attack.feint-step":
            feint = pulse(frame, 3, markers["feint"], 34); thrust += .12*feint
            side = pulse(frame, 8, 30, 58); dx = .09*side; twist = -.18*side
    elif clip_id.startswith("defend."):
        weight = pulse(frame, 0, markers.get("guard", markers.get("evade", 14)), last)
        if clip_id == "defend.evade":
            dx = .11*weight; rotate_world(spine, AXES[2], -.18*weight); ready = .08*weight
        else:
            shield = .15*weight; ready = .14*weight; lean = -.08*weight
            if clip_id == "defend.parry":
                side = weight; twist = -.18*weight
    elif clip_id.startswith("hit."):
        power = {"hit.light": .6, "hit.medium": 1., "hit.heavy": 1.5}[clip_id]
        weight = pulse(frame, 0, markers["hit"], last); lean = -.25*power*weight; dz = -.055*power*weight
        thrust = -.07*power*weight; twist = .08*power*weight
    elif clip_id.startswith("death."):
        weight = smooth(frame/markers["land"])
        if clip_id == "death.front":
            lean = .3*weight; dy = -.42*weight; dz = .10*weight
            rotate_world(hips, AXES[0], 1.3*weight)
        elif clip_id == "death.backward":
            lean = -.2*weight; dy = -.4*weight; dz = -.12*weight
            rotate_world(hips, AXES[0], -1.4*weight)
        else:
            lean = -.2*weight; twist = .5*weight; dx = .10*weight
            rotate_world(hips, AXES[2], .65*weight)
        for limb in ("LeftLeg", "RightLeg"):
            rotate_world(objects.get(limb), AXES[0], .45*weight)
    else:
        weight = pulse(frame, 0, markers.get("ready", markers.get("victory", 12)), last)
        ready = .12*weight; shield = .07*weight
        if clip_id == "recovery.victory":
            thrust = -.03*weight; rotate_world(objects.get("Head"), AXES[1], .23*weight)
    rotate_world(spine, AXES[0], lean); rotate_world(spine, AXES[1], twist)
    if hips:
        matrix = hips.matrix_world.copy(); matrix.translation += AXES[0]*(dx*unit)+AXES[1]*(dy*unit)+AXES[2]*(dz*unit)
        hips.matrix_world = matrix; update()
    if clip_id.startswith("death."):
        # Floor contact is a baked constraint, not a hidden scale/stretch. Hold
        # the landed pose from its Blender "land" marker through the end.
        floor = ground_floor
        lowest = min(obj.matrix_world.translation.z for name, obj in objects.items() if name != "Armature")
        if lowest < floor and hips:
            matrix = hips.matrix_world.copy(); matrix.translation.z += floor-lowest
            hips.matrix_world = matrix; update()
    if not clip_id.startswith("death."):
        compensation = Vector()
        if clip_id.startswith("attack."):
            cue_targets = [("contact", right, "weaponLocal", "bodyTarget", 10, 8)]
            if "clash" in markers:
                cue_targets.append(("clash", left, "shieldLocal", "shieldTarget", 8, 8))
            for marker, chain, socket, target, before, after in cue_targets:
                weight = pulse(frame, markers[marker]-before, markers[marker], min(last, markers[marker]+after))
                if weight <= 0:
                    continue
                try:
                    shift = contact_root_adjustment(chain, C.to_3x3() @ Vector(sockets[socket]), C.to_3x3() @ Vector(sockets[target]), weight, unit)
                except ValueError as error:
                    raise ValueError(f"{clip_id}, frame {frame}, {marker}: {error}") from error
                matrix = hips.matrix_world.copy(); matrix.translation += shift; hips.matrix_world = matrix; update()
                compensation += shift
        body_offset = AXES[0]*(dx*unit)+AXES[1]*(dy*unit)+AXES[2]*(dz*unit)+compensation
        goals[0] += body_offset; goals[1] += body_offset
        goals[0] += AXES[2]*(thrust*unit)+AXES[1]*(ready*.4*unit)
        goals[1] += AXES[2]*(shield*unit)+AXES[1]*(ready*unit)+AXES[0]*(side*.04*unit)
        solve_limb(*right, goals[0]); solve_limb(*left, goals[1])
        if clip_id in ("defend.block", "defend.parry"):
            # A shield is a face, not a short spear. Author its +Z face toward
            # the incoming attacker while the blocking arm rises.
            weight = pulse(frame, 0, markers["guard"], last)
            normal = left[-1].matrix_world.to_quaternion() @ (C.to_3x3() @ Vector(sockets["shieldNormalLocal"]))
            correction = Quaternion().slerp(normal.rotation_difference(AXES[2]), weight)
            parent = left[-1].parent.matrix_world.to_quaternion()
            left[-1].rotation_quaternion = parent.inverted() @ correction @ parent @ left[-1].rotation_quaternion
            update()
        rotate_world(right[-1], AXES[0], .6*max(0, thrust/.27))
        for index, leg in enumerate(("Left", "Right")):
            foot = feet[leg]
            if clip_id == "attack.bash-thrust":
                start, peak, end = (3, 20, 34) if index else (8, 23, 39)
                foot += AXES[2]*(.40*unit*pulse(frame, start, peak, end))+AXES[0]*(dx*unit*.6)
                portion = (frame-start)/(peak-start) if frame <= peak else (frame-peak)/(end-peak)
                if 0 < portion < 1:
                    foot += AXES[1]*(math.sin(math.pi*portion)**2*.055*unit)
            if clip_id in ("attack.feint-step", "defend.evade"):
                foot += AXES[0]*(dx*unit*.7)
                foot += AXES[1]*(math.sin(math.pi*frame/last)**2*.025*unit*(1 if index else .4))
            solve_limb(objects.get(leg+"UpLeg"), objects.get(leg+"Leg"), objects.get(leg+"Foot"), foot)
        if clip_id.startswith("attack."):
            contact = markers["contact"]
            weight = pulse(frame, contact-10, contact, min(last, contact+8))
            error = solve_socket(right, C.to_3x3() @ Vector(sockets["weaponLocal"]), C.to_3x3() @ Vector(sockets["bodyTarget"]), weight)
            if frame == contact and error > unit*.005:
                raise ValueError(f"Unreachable authored weapon contact: {clip_id}, error={error}")
            if "clash" in markers:
                clash = markers["clash"]; weight = pulse(frame, clash-8, clash, clash+8)
                error = solve_socket(left, C.to_3x3() @ Vector(sockets["shieldLocal"]), C.to_3x3() @ Vector(sockets["shieldTarget"]), weight)
                if frame == clash and error > unit*.005:
                    raise ValueError(f"Unreachable authored shield contact: {clip_id}, error={error}")


def build_scene(rig):
    bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)
    joints = set(j for skin in rig["skins"] for j in skin["joints"])
    parents = {child: i for i, node in enumerate(rig["nodes"]) for child in node.get("children", [])}
    for node in list(joints):
        while node in parents:
            node = parents[node]; joints.add(node)
    objects = {}; indexed = {}
    for i in sorted(joints):
        node = rig["nodes"][i]; obj = bpy.data.objects.new(node["name"], None)
        obj.rotation_mode = "QUATERNION"; bpy.context.collection.objects.link(obj)
        objects[node["name"]] = obj; indexed[i] = obj
    for i, obj in indexed.items():
        if parents.get(i) in indexed:
            obj.parent = indexed[parents[i]]
    return objects, indexed


def set_source_pose(rig, indexed, source, time):
    for i, obj in indexed.items():
        node = rig["nodes"][i]; name = node["name"]
        pos = source.sample(name, "translation", time, node.get("translation", (0, 0, 0)))
        rot = source.sample(name, "rotation", time, node.get("rotation", (0, 0, 0, 1)))
        scale = source.sample(name, "scale", time, node.get("scale", (1, 1, 1)))
        obj.matrix_basis = C @ Matrix.LocRotScale(Vector(pos), Quaternion((rot[3], *rot[:3])), Vector(scale)) @ CI
    update()


def merge_clips(paths, metadata, output):
    combined = None; binary = bytearray()
    for path, meta in zip(paths, metadata):
        doc, blob = read_glb(path)
        # Constant channels are meaningful when binding a clips-only file to a
        # different scene. Preserve the exported Blender pose for every joint,
        # rather than inheriting a previous attack's unanimated wrist/hip pose.
        for animation in doc.get("animations", []):
            existing = {(c["target"]["node"], c["target"]["path"]) for c in animation["channels"]}
            def append_values(values, kind, minimum=None, maximum=None):
                nonlocal blob
                blob += b"\0"*((-len(blob)) % 4); offset = len(blob)
                packed = struct.pack("<"+"f"*sum(len(v) for v in values), *(x for v in values for x in v))
                blob += packed; view = len(doc["bufferViews"])
                doc["bufferViews"].append(dict(buffer=0, byteOffset=offset, byteLength=len(packed)))
                record = dict(bufferView=view, componentType=5126, count=len(values), type=kind)
                if minimum is not None:
                    record.update(min=minimum, max=maximum)
                index = len(doc["accessors"]); doc["accessors"].append(record); return index
            time_accessor = append_values([(0,), (meta["duration"],)], "SCALAR", [0], [meta["duration"]])
            for node_index, node in enumerate(doc["nodes"]):
                for kind, default in (("translation", [0, 0, 0]), ("rotation", [0, 0, 0, 1]), ("scale", [1, 1, 1])):
                    if (node_index, kind) in existing:
                        continue
                    value = node.get(kind, default)
                    output_accessor = append_values([value, value], "VEC4" if kind == "rotation" else "VEC3")
                    sampler = len(animation["samplers"])
                    animation["samplers"].append(dict(input=time_accessor, output=output_accessor, interpolation="LINEAR"))
                    animation["channels"].append(dict(sampler=sampler, target=dict(node=node_index, path=kind)))
        if combined is None:
            combined = {key: value for key, value in doc.items() if key not in ("buffers", "bufferViews", "accessors", "animations")}
            combined.update(bufferViews=[], accessors=[], animations=[])
        names = {node["name"]: i for i, node in enumerate(combined["nodes"])}
        view_offset = len(combined["bufferViews"]); accessor_offset = len(combined["accessors"])
        binary += b"\0"*((-len(binary)) % 4); byte_offset = len(binary)
        for view in doc.get("bufferViews", []):
            combined["bufferViews"].append({**view, "buffer": 0, "byteOffset": byte_offset+view.get("byteOffset", 0)})
        for item in doc.get("accessors", []):
            combined["accessors"].append({**item, "bufferView": item["bufferView"]+view_offset})
        for animation in doc.get("animations", []):
            animation["name"] = meta["id"]; animation["extras"] = {"crownfall": meta}
            for channel in animation["channels"]:
                channel["target"]["node"] = names[doc["nodes"][channel["target"]["node"]]["name"]]
            for sampler in animation["samplers"]:
                sampler["input"] += accessor_offset; sampler["output"] += accessor_offset
            combined["animations"].append(animation)
        binary += blob
    combined["buffers"] = [{"byteLength": len(binary)}]
    combined["asset"]["generator"] = VERSION+" / Blender "+bpy.app.version_string
    write_glb(output, combined, bytes(binary))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources", required=True); parser.add_argument("--output", required=True)
    parser.add_argument("--scratch", required=True); parser.add_argument("--classes", default="wp,bp")
    parser.add_argument("--sockets", required=True)
    parser.add_argument("--only", default="")
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    source_rows = json.loads(Path(args.sources).read_text()); output = Path(args.output); scratch = Path(args.scratch)
    socket_bytes = Path(args.sockets).read_bytes(); socket_catalog = json.loads(socket_bytes)["archetypes"]
    output.mkdir(parents=True, exist_ok=True); scratch.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene; scene.render.fps = FPS
    available = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    for key in args.classes.split(","):
        rows = {row["role"]: row for row in source_rows if row["class"] == key}
        for row in rows.values():
            if hashlib.sha256(Path(row["path"]).read_bytes()).hexdigest() != row["sha256"]:
                raise ValueError("Source hash changed: "+row["path"])
        rig, _ = read_glb(rows["rigged"]["path"]); objects, indexed = build_scene(rig)
        sockets = socket_catalog[key]
        if sockets["sourceSha256"] != rows["rigged"]["sha256"]:
            raise ValueError("Prop sockets belong to another source rig")
        parents = {child: i for i, node in enumerate(rig["nodes"]) for child in node.get("children", [])}
        (output/(key+"-skeleton.json")).write_text(json.dumps({
            "sourceSha256": rows["rigged"]["sha256"], "nodes": [
                {"name": obj.name, "parent": rig["nodes"][parents[i]]["name"] if parents.get(i) in indexed else None,
                 **{prop: rig["nodes"][i][prop] for prop in ("translation", "rotation", "scale", "matrix") if prop in rig["nodes"][i]}}
                for i, obj in indexed.items()]}, indent=2)+"\n")
        idle = SourceClip(rows["idle"]["path"]); death = SourceClip(rows["death"]["path"])
        set_source_pose(rig, indexed, idle, 0)
        positions = [obj.matrix_world.translation.z for obj in objects.values()]
        unit = max(positions)-min(positions)
        ground_floor = min(objects[name].matrix_world.translation.z for name in ("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase") if name in objects)
        if unit <= 0:
            raise ValueError("Invalid skeleton size")
        paths = []; records = []
        for clip_id, frames, markers, tags in RECIPES:
            if args.only and clip_id not in args.only.split(","):
                continue
            for obj in objects.values():
                obj.animation_data_create(); action = bpy.data.actions.new(clip_id+":"+obj.name)
                action.use_fake_user = True; obj.animation_data.action = action
            marker_action = next(iter(objects.values())).animation_data.action
            for name, frame in contact_markers(clip_id, frames, markers):
                marker_action.pose_markers.new(name).frame = frame
            for frame in range(frames+1):
                scene.frame_set(frame)
                source = death if clip_id == "death.dramatic" else idle
                time = source.duration*min(1, frame/markers["land"]) if source is death else min(source.duration, frame/FPS)
                if clip_id in ("death.front", "death.backward"):
                    time = 0
                set_source_pose(rig, indexed, source, time)
                author_pose(objects, unit, clip_id, frame, frames, markers, ground_floor, sockets)
                for obj in objects.values():
                    obj.keyframe_insert(data_path="location", frame=frame)
                    obj.keyframe_insert(data_path="rotation_quaternion", frame=frame)
            for obj in objects.values():
                for curve in obj.animation_data.action.fcurves:
                    for point in curve.keyframe_points:
                        point.interpolation = "LINEAR"
            scene.frame_start = 0; scene.frame_end = frames; scene.frame_set(0)
            path = scratch/(key+"-"+clip_id+".glb")
            options = dict(filepath=str(path), export_format="GLB", export_yup=True, export_animations=True,
                           export_animation_mode="SCENE", export_frame_range=True, export_force_sampling=True,
                           export_extras=True, export_animation_name=clip_id, export_anim_scene_split_object=False)
            bpy.ops.export_scene.gltf(**{name: value for name, value in options.items() if name in available})
            record = dict(id=clip_id, version=VERSION, archetype=key, tags=tags, fps=FPS, duration=frames/FPS,
                          markers=[dict(name=m.name, frame=m.frame, time=m.frame/FPS) for m in marker_action.pose_markers])
            paths.append(path); records.append(record)
            print("BAKED", key, clip_id, len(read_glb(path)[0].get("animations", [])), flush=True)
        target = output/(key+".glb"); merge_clips(paths, records, target)
        data = target.read_bytes()
        manifest = dict(version=VERSION, archetype=key, bytes=len(data), sha256=hashlib.sha256(data).hexdigest(),
                        socketSourceSha256=hashlib.sha256(socket_bytes).hexdigest(),
                        generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), clips=records,
                        sources=[{name: row[name] for name in ("role", "url", "sha256", "bytes")} for row in rows.values()])
        (output/(key+".json")).write_text(json.dumps(manifest, indent=2)+"\n")
        bpy.ops.wm.save_as_mainfile(filepath=str(scratch/(key+"-authoring.blend")))
        print("LIBRARY", key, len(records), len(data), flush=True)


if __name__ == "__main__":
    main()

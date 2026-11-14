"""Additive guard keyframes on the published rig; no body, base clip or site edits.

Uses Crownfall's existing analytic IK/grounding authoring helpers. Inputs are the
licensed, byte-pinned published character/library/guard kit, not a rebuilt body.
The spear is one actual kit mesh on an explicitly keyed root helper: it passes
from the patrol's right grip to the unchanged watch loop's left grip. Bounds are
NOT inferred here: the independent full-skin/held-prop sampler must qualify it.
"""
import math
import numpy as np
from mathutils import Matrix, Quaternion, Vector
import glb_prune
import motion as mo
import locomotion as lc
import transitions as tr

FPS = 30
HELPER = "guard_watch_spear_pose"
ENTER = "guard_stand_watch_d_compact_enter_v1"
EXIT = "guard_stand_watch_d_compact_exit_v1"
TRANSPORTS = {"guard_patrol_walk": "guard_patrol_walk_spear_pose_v1",
              "guard_stand_watch_d": "guard_stand_watch_d_spear_pose_v1"}
LEFT_CLOSED_BY = .32
RIGHT_RELEASE_AFTER = .34
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def accessor(js, binary, index):
    values = glb_prune._accessor(js, binary, index)
    a = js["accessors"][index]
    if a.get("normalized"):
        divisor = {5120: 127, 5121: 255, 5122: 32767, 5123: 65535}.get(a["componentType"])
        if divisor is None:
            raise ValueError("Unsupported normalized accessor")
        values = np.maximum(values / divisor, -1)
    return values


def trs(node):
    if "matrix" in node:
        return Matrix([node["matrix"][i:i + 4] for i in range(0, 16, 4)]).transposed()
    q = node.get("rotation", [0, 0, 0, 1])
    return Matrix.LocRotScale(Vector(node.get("translation", [0, 0, 0])),
                              Quaternion((q[3], *q[:3])), Vector(node.get("scale", [1, 1, 1])))


def hierarchy(js, local=None):
    parents = {i: None for i in range(len(js["nodes"]))}
    for i, node in enumerate(js["nodes"]):
        for child in node.get("children", []):
            if parents[child] is not None:
                raise ValueError("Published skeleton has competing parents")
            parents[child] = i
    out = {}
    def visit(i):
        if i not in out:
            p = parents[i]
            out[i] = (visit(p) if p is not None else Matrix.Identity(4)) @ (local[i] if local else trs(js["nodes"][i]))
        return out[i]
    for i in parents:
        visit(i)
    return parents, out


def rig_from_published(js):
    parents, world = hierarchy(js)
    joint_ids = set(js["skins"][0]["joints"])
    rig = mo.Rig.__new__(mo.Rig)
    rig.indices = {js["nodes"][i]["name"]: i for i in joint_ids}
    if len(rig.indices) != len(joint_ids):
        raise ValueError("Ambiguous published joints")
    rig.parent = {name: js["nodes"][parents[i]]["name"] if parents[i] in joint_ids else None
                  for name, i in rig.indices.items()}
    rig.children = {n: [c for c, p in rig.parent.items() if p == n] for n in rig.parent}
    rig.order = []
    def visit(n):
        rig.order.append(n)
        for child in rig.children[n]:
            visit(child)
    for name, parent in rig.parent.items():
        if parent is None:
            visit(name)
    rig.rest = {n: C @ world[i] for n, i in rig.indices.items()}
    rig.rel = {n: (rig.rest[p].inverted() @ rig.rest[n] if p else rig.rest[n].copy()) for n, p in rig.parent.items()}
    rig.length = {n: min(((rig.rest[c].translation - m.translation).length for c in rig.children[n]), default=.05)
                  for n, m in rig.rest.items()}
    rig.outer_parent = {n: C @ world[parents[i]] if parents[i] is not None else C.copy()
                        for n, i in rig.indices.items() if rig.parent[n] is None}
    return rig


def frame_at(js, binary, rig, clip_name, seconds=0):
    anim = next(a for a in js["animations"] if a["name"] == clip_name)
    values = [{k: v for k, v in node.items() if k in ("translation", "rotation", "scale", "matrix")} for node in js["nodes"]]
    for ch in anim["channels"]:
        sampler = anim["samplers"][ch["sampler"]]
        interpolation = sampler.get("interpolation", "LINEAR")
        if interpolation not in ("LINEAR", "STEP"):
            raise ValueError("Only the existing linear/discrete published tracks are supported")
        times = accessor(js, binary, sampler["input"])[:, 0]
        data = accessor(js, binary, sampler["output"])
        k = min(len(times) - 1, max(0, int(np.searchsorted(times, seconds, side="right")) - 1))
        v = data[k]
        if k + 1 < len(times) and interpolation == "LINEAR":
            w = max(0, min(1, (seconds - times[k]) / (times[k + 1] - times[k])))
            if ch["target"]["path"] == "rotation":
                a, b = Quaternion((v[3], *v[:3])), Quaternion((data[k + 1][3], *data[k + 1][:3]))
                q = a.normalized().slerp(b.normalized() if a.dot(b) >= 0 else -b.normalized(), w)
                v = [q.x, q.y, q.z, q.w]
            else:
                v = v * (1 - w) + data[k + 1] * w
        values[ch["target"]["node"]][ch["target"]["path"]] = list(v)
    _, world = hierarchy(js, [trs(v) for v in values])
    pose = {n: C @ world[i] for n, i in rig.indices.items()}
    rot, loc = {}, {}
    for n in rig.order:
        p = rig.parent[n]
        basis = rig.rel[n].inverted() @ (pose[p].inverted() if p else Matrix.Identity(4)) @ pose[n]
        rot[n] = basis.to_quaternion().normalized()
        if basis.translation.length > 1e-7:
            loc[n] = basis.translation.copy()
    return rot, loc


def published_soles(js, binary, rig):
    """The existing sole definition, measured from the actual weighted shoes."""
    _, world = hierarchy(js)
    points = {s: [] for s in ("l", "r")}
    for node_id, node in enumerate(js["nodes"]):
        if "mesh" not in node or "skin" not in node:
            continue
        joints = js["skins"][node["skin"]]["joints"]
        names = [js["nodes"][i]["name"] for i in joints]
        for prim in js["meshes"][node["mesh"]]["primitives"]:
            attrs = prim["attributes"]
            pos, ix, weight = (accessor(js, binary, attrs[k]) for k in ("POSITION", "JOINTS_0", "WEIGHTS_0"))
            for v, indices, weights in zip(pos, ix, weight):
                for s in ("l", "r"):
                    if sum(w for j, w in zip(indices, weights) if names[int(j)] in (f"foot_{s}", f"toes_{s}")) >= .5:
                        points[s].append(C @ world[node_id] @ Vector(v))
    soles = lc.Soles.__new__(lc.Soles)
    soles.rig, soles.local, soles.ground = rig, {}, {}
    for s, pts in points.items():
        if not pts:
            raise ValueError("Actual weighted shoe geometry is missing")
        p = np.array([list(v) for v in pts]); z = float(p[:, 2].min()); low = p[p[:, 2] < z + .012]
        y = low[:, 1]; span = float(y.max() - y.min())
        heel = low[y > y.max() - .25 * span].mean(axis=0)
        tip = low[y < y.min() + .12 * span].mean(axis=0)
        heel[2] = tip[2] = z; toe = rig.rest[f"toes_{s}"].translation
        targets = {"heel": (f"foot_{s}", heel), "ball": (f"foot_{s}", (toe.x, toe.y, z)), "tip": (f"toes_{s}", tip)}
        soles.local[s] = {k: (bone, rig.rest[bone].inverted() @ Vector(v)) for k, (bone, v) in targets.items()}
        soles.ground[s] = z
    soles.length = {s: (soles.world_rest(s, "tip") - soles.world_rest(s, "heel")).length for s in points}
    return soles


def reference_roll(rig, pose, rot, loc, bone, child, desired_end, reference):
    """Resolve axial roll from the actual source bone frames. Shortest-vector
    rotations alone can flip a nearly straight elbow by 180 degrees between
    keys; this constructs the complete world frame instead of inheriting that
    ambiguous roll. The child's real rest offset defines its longitudinal axis."""
    axis = rig.rel[child].translation.normalized()
    across = Vector((1, 0, 0)) if abs(axis.x) < .85 else Vector((0, 0, 1))
    across = (across - axis * across.dot(axis)).normalized()
    forward = (desired_end - pose[bone].translation).normalized()
    roll = reference @ across
    roll = roll - forward * roll.dot(forward)
    if roll.length < 1e-5:
        raise ValueError("Source arm roll becomes singular; author another actual hand path")
    roll.normalize()
    source = Matrix((axis, across, axis.cross(across))).transposed()
    target = Matrix((forward, roll, forward.cross(roll))).transposed()
    mo.set_world_rotation(rig, pose, rot, loc, bone, target @ source.inverted())


def compact_frames(rig, soles, start, watch, right_grip, left_grip, seconds=1.2):
    """Carry the existing spear through a measured two-hand transfer. Root/helper
    keyframes are authored, not an IK guess made by the runtime. Exact endpoints
    are the published patrol phase-zero and unmodified watch-loop phase-zero."""
    a, b = rig.fk(*start), rig.fk(*watch)
    w0, w1 = a["hand_r"] @ right_grip, b["hand_l"] @ left_grip
    fa, fb = tr.feet_of(rig, soles, start), tr.feet_of(rig, soles, watch)
    order = sorted(("l", "r"), key=lambda s: -(fa[s][0] - fb[s][0]).length)
    steps = {s: ((.08 + .38 * i) * seconds, (.43 + .38 * i) * seconds, .035)
             for i, s in enumerate(order) if (fa[s][0] - fb[s][0]).length > .01 or abs(fa[s][1] - fb[s][1]) > .03}
    frames = tr.transition_clip(rig, soles, start, watch, seconds, steps=steps)
    shafts = []
    for i, (rot, loc) in enumerate(frames):
        u = i / (len(frames) - 1); ease = tr.smooth(u)
        q0, q1 = w0.to_quaternion(), w1.to_quaternion()
        w = Matrix.LocRotScale(w0.translation.lerp(w1.translation, ease),
                              q0.slerp(q1 if q0.dot(q1) >= 0 else -q1, ease), w0.to_scale().lerp(w1.to_scale(), ease))
        shafts.append(w)
        if i in (0, len(frames) - 1):
            continue
        pose = rig.fk(rot, loc)
        # Both hands control the same shaft during the overlap. The right hand
        # releases only after the left has closed; no duplicate spear is spawned.
        for side, grip, weight in (("r", right_grip, 1 - tr.smooth((u - RIGHT_RELEASE_AFTER) / .21)),
                                    ("l", left_grip, tr.smooth((u - .08) / (LEFT_CLOSED_BY - .08)))):
            if weight <= 0:
                continue
            hand = w @ grip.inverted(); arm = (f"upperarm_{side}", f"forearm_{side}", f"hand_{side}")
            before = {n: rot[n].copy() for n in arm}
            # The actual source elbows define the bend plane at both joins;
            # a new arbitrary world pole would change the very first/last pose.
            pole = a[arm[1]].translation.lerp(b[arm[1]].translation, ease)
            mo.two_bone_ik(rig, pose, rot, loc, *arm, hand.translation, pole)
            elbow, wrist = pose[arm[1]].translation.copy(), pose[arm[2]].translation.copy()
            for bone, child, end in ((arm[0], arm[1], elbow), (arm[1], arm[2], wrist)):
                qa, qb = a[bone].to_quaternion(), b[bone].to_quaternion()
                ref = qa.slerp(qb if qa.dot(qb) >= 0 else -qb, ease).to_matrix()
                reference_roll(rig, pose, rot, loc, bone, child, end, ref)
            mo.set_world_rotation(rig, pose, rot, loc, arm[-1], hand.to_3x3())
            for n in arm:
                rot[n] = before[n].slerp(rot[n] if before[n].dot(rot[n]) >= 0 else -rot[n], weight)
            rig.update_chain(pose, rot, loc, arm[0])
            grip_frame = start if side == "r" else watch
            for n in rot:
                if n.endswith("_" + side) and n.startswith(("thumb_", "index_", "middle_", "ring_", "pinky_")):
                    q = grip_frame[0][n]
                    rot[n] = rot[n].slerp(q if rot[n].dot(q) >= 0 else -q, weight)
    frames[0], frames[-1] = lc.copy_frame(start), lc.copy_frame(watch)
    return frames, shafts


def write_addon(source, binary, rig, frames, shafts, path, grips):
    """Write only new transition tracks, retaining the exact published rest TRS.
    The helper is outside the body skeleton; it keys the real kit attachment,
    and never changes skin weights or adds an unsupported held weapon."""
    import copy
    import motion_library_export as export
    js = copy.deepcopy(source); js["animations"] = []
    helper = len(js["nodes"])
    js["nodes"].append({"name": HELPER})
    for scene in js["scenes"]:
        scene["nodes"].append(helper)
    data = bytearray(binary)
    def put(values, kind, bounds=False):
        array = np.ascontiguousarray(values, dtype=np.float32)
        data.extend(b"\0" * ((4 - len(data) % 4) % 4))
        js["bufferViews"].append({"buffer": 0, "byteOffset": len(data), "byteLength": array.nbytes})
        data.extend(array.tobytes())
        acc = {"bufferView": len(js["bufferViews"]) - 1, "componentType": 5126, "count": len(values), "type": kind}
        if bounds:
            acc.update(min=[float(array.min())], max=[float(array.max())])
        js["accessors"].append(acc)
        return len(js["accessors"]) - 1
    for name, poses, tools in ((ENTER, frames, shafts), (EXIT, list(reversed(frames)), list(reversed(shafts)))):
        times = put([[i / FPS] for i in range(len(poses))], "SCALAR", True)
        anim = {"name": name, "channels": [], "samplers": []}
        def channel(node, prop, values):
            previous = None
            if prop == "rotation":
                for i, value in enumerate(values):
                    if previous is not None and sum(a * b for a, b in zip(previous, value)) < 0:
                        values[i] = [-v for v in value]
                    previous = values[i]
            index = put(values, "VEC4" if prop == "rotation" else "VEC3")
            anim["channels"].append({"sampler": len(anim["samplers"]), "target": {"node": node, "path": prop}})
            anim["samplers"].append({"input": times, "output": index, "interpolation": "LINEAR"})
        worlds = [rig.fk(*frame) for frame in poses]
        for bone in rig.order:
            if bone == "root" or bone.startswith("face_"):
                continue
            p = rig.parent[bone]
            local = [(world[p] if p else rig.outer_parent[bone]).inverted() @ world[bone] for world in worlds]
            channel(rig.indices[bone], "rotation", [[m.to_quaternion().x, m.to_quaternion().y, m.to_quaternion().z, m.to_quaternion().w] for m in local])
            if bone == "hips":
                channel(rig.indices[bone], "translation", [list(m.translation) for m in local])
        gltf_tools = [C.inverted() @ m for m in tools]
        channel(helper, "translation", [list(m.translation) for m in gltf_tools])
        channel(helper, "rotation", [[m.to_quaternion().x, m.to_quaternion().y, m.to_quaternion().z, m.to_quaternion().w] for m in gltf_tools])
        channel(helper, "scale", [list(m.to_scale()) for m in gltf_tools])
        js["animations"].append(anim)
    # Separate helper-only tracks are joined to copies of the original owned
    # loops by the loader. Their original body tracks/bytes remain untouched;
    # one spear then follows the same helper through both loop crossfades.
    for original, auxiliary in TRANSPORTS.items():
        src = next(a for a in source["animations"] if a["name"] == original)
        seconds = max(float(accessor(source, binary, s["input"])[-1, 0]) for s in src["samplers"])
        count = int(math.ceil(seconds * FPS))
        stamps = [min(i / FPS, seconds) for i in range(count + 1)]
        times = put([[t] for t in stamps], "SCALAR", True)
        side, grip = grips[original]
        tools = [C.inverted() @ rig.fk(*frame_at(source, binary, rig, original, t))[f"hand_{side}"] @ grip for t in stamps]
        anim = {"name": auxiliary, "channels": [], "samplers": []}
        channel(helper, "translation", [list(m.translation) for m in tools])
        channel(helper, "rotation", [[m.to_quaternion().x, m.to_quaternion().y, m.to_quaternion().z, m.to_quaternion().w] for m in tools])
        channel(helper, "scale", [list(m.to_scale()) for m in tools])
        js["animations"].append(anim)
    js["buffers"] = [{"byteLength": len(data)}]
    glb_prune._write(path, js, data)
    # The existing pipeline compacts channels and normalized quaternion buffers.
    # Its pose tolerances are independently checked after publication.
    export.compact(path)

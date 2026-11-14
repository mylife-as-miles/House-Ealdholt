"""Numeric core of the Crownfall combat-v2 retarget: GLB sampling, forward
kinematics, rest-pose alignment, limb IK, foot locking and motion-derived
markers. Pure Python + numpy (no bpy), so the same code serves the Blender bake
(`build_combat_library_v2.py`) and node-free unit checks.

Conventions: glTF space throughout (Y up, the fighter faces +Z, +X is its left).
Quaternions are (x, y, z, w). Matrices are numpy [.., 4, 4], column vectors.
"""
import json
import struct
from pathlib import Path

import numpy as np

FPS = 30


# ---------------------------------------------------------------- quaternions
def qmul(a, b):
    ax, ay, az, aw = np.moveaxis(np.asarray(a, float), -1, 0)
    bx, by, bz, bw = np.moveaxis(np.asarray(b, float), -1, 0)
    return np.stack([aw*bx+ax*bw+ay*bz-az*by, aw*by-ax*bz+ay*bw+az*bx,
                     aw*bz+ax*by-ay*bx+az*bw, aw*bw-ax*bx-ay*by-az*bz], -1)


def qinv(q):
    q = np.asarray(q, float)
    return q*np.array([-1., -1., -1., 1.])


def qnorm(q):
    q = np.asarray(q, float)
    return q/np.maximum(np.linalg.norm(q, axis=-1, keepdims=True), 1e-12)


def qrot(q, v):
    q = np.asarray(q, float); v = np.asarray(v, float)
    u = q[..., :3]; w = q[..., 3:4]
    t = 2*np.cross(u, v)
    return v+w*t+np.cross(u, t)


def qmat(q):
    x, y, z, w = np.moveaxis(qnorm(q), -1, 0)
    m = np.empty(np.shape(x)+(3, 3))
    m[..., 0, 0] = 1-2*(y*y+z*z); m[..., 0, 1] = 2*(x*y-z*w); m[..., 0, 2] = 2*(x*z+y*w)
    m[..., 1, 0] = 2*(x*y+z*w); m[..., 1, 1] = 1-2*(x*x+z*z); m[..., 1, 2] = 2*(y*z-x*w)
    m[..., 2, 0] = 2*(x*z-y*w); m[..., 2, 1] = 2*(y*z+x*w); m[..., 2, 2] = 1-2*(x*x+y*y)
    return m


def matq(m):
    """Rotation matrix (orthonormal, det +1) -> quaternion."""
    m = np.asarray(m, float); out = np.empty(m.shape[:-2]+(4,))
    flat = m.reshape(-1, 3, 3); res = out.reshape(-1, 4)
    for i, r in enumerate(flat):
        t = r[0, 0]+r[1, 1]+r[2, 2]
        if t > 0:
            s = np.sqrt(t+1)*2; q = [(r[2, 1]-r[1, 2])/s, (r[0, 2]-r[2, 0])/s, (r[1, 0]-r[0, 1])/s, .25*s]
        elif r[0, 0] > r[1, 1] and r[0, 0] > r[2, 2]:
            s = np.sqrt(1+r[0, 0]-r[1, 1]-r[2, 2])*2; q = [.25*s, (r[0, 1]+r[1, 0])/s, (r[0, 2]+r[2, 0])/s, (r[2, 1]-r[1, 2])/s]
        elif r[1, 1] > r[2, 2]:
            s = np.sqrt(1+r[1, 1]-r[0, 0]-r[2, 2])*2; q = [(r[0, 1]+r[1, 0])/s, .25*s, (r[1, 2]+r[2, 1])/s, (r[0, 2]-r[2, 0])/s]
        else:
            s = np.sqrt(1+r[2, 2]-r[0, 0]-r[1, 1])*2; q = [(r[0, 2]+r[2, 0])/s, (r[1, 2]+r[2, 1])/s, .25*s, (r[1, 0]-r[0, 1])/s]
        res[i] = q
    return qnorm(out)


def qbetween(a, b):
    """Shortest rotation taking direction a onto direction b."""
    a = np.asarray(a, float); b = np.asarray(b, float)
    a = a/max(np.linalg.norm(a), 1e-12); b = b/max(np.linalg.norm(b), 1e-12)
    d = float(np.dot(a, b))
    if d > 1-1e-10:
        return np.array([0., 0., 0., 1.])
    if d < -1+1e-10:
        axis = np.cross(a, [1., 0., 0.])
        if np.linalg.norm(axis) < 1e-6:
            axis = np.cross(a, [0., 1., 0.])
        axis /= np.linalg.norm(axis)
        return np.array([*axis, 0.])
    c = np.cross(a, b)
    return qnorm(np.array([*c, 1+d]))


def qaxis(axis, angle):
    axis = np.asarray(axis, float); axis = axis/max(np.linalg.norm(axis), 1e-12)
    return np.array([*(axis*np.sin(angle/2)), np.cos(angle/2)])


def qslerp(a, b, t):
    a = qnorm(a); b = qnorm(b)
    d = float(np.dot(a, b))
    if d < 0:
        b = -b; d = -d
    if d > .9995:
        return qnorm(a+(b-a)*t)
    th = np.arccos(d)
    return (np.sin((1-t)*th)*a+np.sin(t*th)*b)/np.sin(th)


def trs(t, r, s=None):
    m = np.zeros(np.shape(t)[:-1]+(4, 4))
    rot = qmat(r)
    if s is not None:
        rot = rot*np.asarray(s, float)[..., None, :]
    m[..., :3, :3] = rot; m[..., :3, 3] = t; m[..., 3, 3] = 1
    return m


def smooth(t):
    t = np.clip(t, 0, 1)
    return t*t*(3-2*t)


# ----------------------------------------------------------------------- GLB
def read_glb(path):
    data = Path(path).read_bytes()
    if data[:4] != b"glTF":
        raise ValueError(f"Not GLB: {path}")
    chunks = {}; offset = 12
    while offset < len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        chunks[kind] = data[offset+8:offset+8+length]; offset += length+8
    return json.loads(chunks[0x4E4F534A]), chunks.get(0x004E4942, b"")


def accessor(doc, blob, index):
    item = doc["accessors"][index]; view = doc["bufferViews"][item["bufferView"]]
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[item["type"]]
    kind = {5126: "<f4", 5123: "<u2", 5125: "<u4", 5121: "u1", 5122: "<i2", 5120: "i1"}[item["componentType"]]
    if "sparse" in item:
        raise ValueError("Sparse accessors are not supported")
    offset = view.get("byteOffset", 0)+item.get("byteOffset", 0)
    size = np.dtype(kind).itemsize*width; stride = view.get("byteStride", size)
    if stride == size:
        out = np.frombuffer(blob, kind, item["count"]*width, offset).reshape(item["count"], width)
    else:
        out = np.stack([np.frombuffer(blob, kind, width, offset+stride*i) for i in range(item["count"])])
    out = out.astype(float)
    if item.get("normalized"):
        out /= {5121: 255., 5123: 65535., 5120: 127., 5122: 32767.}[item["componentType"]]
    return out


class Skeleton:
    """Node hierarchy of one GLB with rest TRS; samples its named animations."""

    def __init__(self, path):
        self.path = str(path); self.doc, self.blob = read_glb(path)
        nodes = self.doc["nodes"]; self.count = len(nodes)
        self.names = [n.get("name", f"node{i}") for i, n in enumerate(nodes)]
        self.index = {}
        for i, name in enumerate(self.names):
            self.index.setdefault(name, i)
        self.parent = [-1]*self.count
        for i, n in enumerate(nodes):
            for c in n.get("children", []):
                self.parent[c] = i
        self.order = []
        stack = [i for i in range(self.count) if self.parent[i] < 0]
        while stack:
            i = stack.pop(); self.order.append(i); stack.extend(reversed(nodes[i].get("children", [])))
        self.rest_t = np.zeros((self.count, 3)); self.rest_r = np.tile([0., 0., 0., 1.], (self.count, 1)); self.rest_s = np.ones((self.count, 3))
        for i, n in enumerate(nodes):
            if "matrix" in n:
                m = np.array(n["matrix"], float).reshape(4, 4).T
                self.rest_t[i] = m[:3, 3]; s = np.linalg.norm(m[:3, :3], axis=0); self.rest_s[i] = s
                self.rest_r[i] = matq(m[:3, :3]/s)
            else:
                self.rest_t[i] = n.get("translation", (0, 0, 0)); self.rest_r[i] = n.get("rotation", (0, 0, 0, 1)); self.rest_s[i] = n.get("scale", (1, 1, 1))
        self.animations = {a.get("name", str(i)): a for i, a in enumerate(self.doc.get("animations", []))}

    def duration(self, name):
        anim = self.animations[name]
        return max(self.doc["accessors"][s["input"]]["max"][0] for s in anim["samplers"])

    def sample(self, name, times):
        """Local TRS for every node at each time: ([F,N,3], [F,N,4], [F,N,3])."""
        times = np.asarray(times, float); frames = len(times)
        t = np.tile(self.rest_t, (frames, 1, 1)); r = np.tile(self.rest_r, (frames, 1, 1)); s = np.tile(self.rest_s, (frames, 1, 1))
        if name is None:
            return t, r, s
        anim = self.animations[name]; cache = {}
        for channel in anim["channels"]:
            node = channel["target"].get("node"); path = channel["target"]["path"]
            if node is None or path == "weights":
                continue
            sampler = anim["samplers"][channel["sampler"]]
            key = sampler["input"]
            if key not in cache:
                cache[key] = accessor(self.doc, self.blob, key)[:, 0]
            keys = cache[key]; values = accessor(self.doc, self.blob, sampler["output"])
            mode = sampler.get("interpolation", "LINEAR")
            if mode == "CUBICSPLINE":
                values = values[1::3]; mode = "LINEAR"
            at = np.clip(np.searchsorted(keys, times, side="right")-1, 0, len(keys)-1)
            nxt = np.minimum(at+1, len(keys)-1)
            span = np.maximum(keys[nxt]-keys[at], 1e-9)
            f = np.clip((times-keys[at])/span, 0, 1) if mode == "LINEAR" else np.zeros(frames)
            f = np.where(nxt == at, 0, f)
            if path == "rotation":
                a = values[at]; b = values[nxt]
                b = np.where((np.sum(a*b, -1) < 0)[:, None], -b, b)
                r[:, node] = qnorm(a+(b-a)*f[:, None]) if len(keys) > 1 else a
                # nlerp between dense 30 fps keys; re-slerp where keys are sparse
                wide = span > 1.5/FPS
                for i in np.nonzero(wide & (nxt != at))[0]:
                    r[i, node] = qslerp(a[i], b[i], f[i])
            elif path == "translation":
                t[:, node] = values[at]+(values[nxt]-values[at])*f[:, None]
            elif path == "scale":
                s[:, node] = values[at]+(values[nxt]-values[at])*f[:, None]
        return t, r, s

    def fk(self, t, r, s=None):
        """World matrices [F,N,4,4] from local TRS arrays."""
        local = trs(t, r, s); world = np.empty_like(local)
        for i in self.order:
            p = self.parent[i]
            world[:, i] = local[:, i] if p < 0 else world[:, p] @ local[:, i]
        return world

    def children(self, i):
        return self.doc["nodes"][i].get("children", [])


def world_rot(world):
    """Pure rotation quaternions of world matrices (scale removed)."""
    m = world[..., :3, :3]
    m = m/np.maximum(np.linalg.norm(m, axis=-2, keepdims=True), 1e-12)
    return matq(m)


# -------------------------------------------------------------- source maps
# target (Crownfall Pawn joint) -> source joint, for each CC0 rig family.
BONE_MAPS = {
    "quaternius": {
        "Hips": "pelvis", "Spine02": "spine_01", "Spine01": "spine_02", "Spine": "spine_03", "neck": "neck_01", "Head": "Head",
        "LeftShoulder": "clavicle_l", "LeftArm": "upperarm_l", "LeftForeArm": "lowerarm_l", "LeftHand": "hand_l",
        "RightShoulder": "clavicle_r", "RightArm": "upperarm_r", "RightForeArm": "lowerarm_r", "RightHand": "hand_r",
        "LeftUpLeg": "thigh_l", "LeftLeg": "calf_l", "LeftFoot": "foot_l", "LeftToeBase": "ball_l",
        "RightUpLeg": "thigh_r", "RightLeg": "calf_r", "RightFoot": "foot_r", "RightToeBase": "ball_r",
    },
    "kaykit": {
        "Hips": "hips", "Spine02": "spine", "Spine": "chest", "Head": "head",
        "LeftArm": "upperarm.l", "LeftForeArm": "lowerarm.l", "LeftHand": "wrist.l",
        "RightArm": "upperarm.r", "RightForeArm": "lowerarm.r", "RightHand": "wrist.r",
        "LeftUpLeg": "upperleg.l", "LeftLeg": "lowerleg.l", "LeftFoot": "foot.l", "LeftToeBase": "toes.l",
        "RightUpLeg": "upperleg.r", "RightLeg": "lowerleg.r", "RightFoot": "foot.r", "RightToeBase": "toes.r",
    },
}
# Reference ("rest") clips used for rest-pose alignment.
REST_CLIP = {"quaternius": "A_TPose", "kaykit": "T-Pose"}
# Child joint that defines each bone's direction (target names).
BONE_CHILD = {
    "Hips": "Spine02", "Spine02": "Spine01", "Spine01": "Spine", "Spine": "neck", "neck": "Head",
    "LeftShoulder": "LeftArm", "LeftArm": "LeftForeArm", "LeftForeArm": "LeftHand",
    "RightShoulder": "RightArm", "RightArm": "RightForeArm", "RightForeArm": "RightHand",
    "LeftUpLeg": "LeftLeg", "LeftLeg": "LeftFoot", "LeftFoot": "LeftToeBase",
    "RightUpLeg": "RightLeg", "RightLeg": "RightFoot", "RightFoot": "RightToeBase",
}
MIRROR = {}
for _name in list(BONE_CHILD)+["LeftHand", "RightHand", "LeftToeBase", "RightToeBase", "Head"]:
    MIRROR[_name] = _name.replace("Left", "\0").replace("Right", "Left").replace("\0", "Right")


def two_bone_ik(a, b, c, target, pole_hint=None):
    """World-space two-joint solve. Returns (q_upper, q_lower): world rotations
    to pre-multiply onto the upper chain and then onto the lower bone so that
    the end joint c reaches `target` (clamped to the reachable shell). The bend
    plane is kept from the current pose unless it is degenerate."""
    a, b, c, target = (np.asarray(v, float) for v in (a, b, c, target))
    l1 = np.linalg.norm(b-a); l2 = np.linalg.norm(c-b)
    d = target-a; dist = np.linalg.norm(d)
    if min(l1, l2) < 1e-9 or dist < 1e-9:
        return np.array([0., 0., 0., 1.]), np.array([0., 0., 0., 1.])
    dist = min(l1+l2-1e-5*(l1+l2), max(abs(l1-l2)+1e-5*(l1+l2), dist)); d = d/np.linalg.norm(d)
    cur = c-a; cur_n = cur/max(np.linalg.norm(cur), 1e-12)
    pole = (b-a)-cur_n*np.dot(b-a, cur_n)
    if np.linalg.norm(pole) < 1e-5*l1 and pole_hint is not None:
        pole = np.asarray(pole_hint, float)
    # carry the bend direction along with the swing of the end-effector line
    swing = qbetween(cur_n, d)
    pole = qrot(swing, pole); pole = pole-d*np.dot(pole, d)
    if np.linalg.norm(pole) < 1e-9:
        pole = np.cross(d, [1., 0., 0.])
    pole /= np.linalg.norm(pole)
    along = (l1*l1-l2*l2+dist*dist)/(2*dist)
    elbow = a+d*along+pole*np.sqrt(max(0., l1*l1-along*along))
    q_upper = qbetween(b-a, elbow-a)
    c1 = a+qrot(q_upper, c-a); b1 = elbow
    q_lower = qbetween(c1-b1, a+d*dist-b1)
    return q_upper, q_lower


def plant_intervals(height, speed, lift_height, plant_height, speed_limit, min_frames=3):
    """Frames where a foot is planted, with hysteresis: a plant starts when the
    foot is below `plant_height` and slower than `speed_limit`, and ends when it
    rises above `lift_height` or moves faster than 2x the limit."""
    n = len(height); planted = np.zeros(n, bool); state = bool(height[0] < plant_height and speed[0] < speed_limit)
    for i in range(n):
        if state:
            if height[i] > lift_height or speed[i] > 2*speed_limit:
                state = False
        elif height[i] < plant_height and speed[i] < speed_limit:
            state = True
        planted[i] = state
    out = []; i = 0
    while i < n:
        if planted[i]:
            j = i
            while j+1 < n and planted[j+1]:
                j += 1
            if j-i+1 >= min_frames or i == 0 or j == n-1:
                out.append((i, j))
            i = j+1
        else:
            i += 1
    return out


# ------------------------------------------------------------------ the rigs
LEGS = {"Left": ("LeftUpLeg", "LeftLeg", "LeftFoot"), "Right": ("RightUpLeg", "RightLeg", "RightFoot")}
ARMS = {"Left": ("LeftArm", "LeftForeArm", "LeftHand"), "Right": ("RightArm", "RightForeArm", "RightHand")}
# Prop specs of web/src/scene/weapons.ts (figure heights; aim/offset in body axes).
SPEAR = dict(grip=.3, aim=(-.03, 1, .06), offset=(.018, 0, .028), butt=-.036)
# Korvenia's and Kwind-09's Pawns carry no shield. Their guard is the socket `verify_pawn_contacts.mts` measures for
# prop-sockets-kingdoms.json: 11.5% of the body height in front of the left fist, facing the figure's front.
FOREARM_GUARD = dict(aim=(0, 0, 1), offset=(0, 0, .115), half=0., radius=.06)
PROPS = {
    "wp": {"spear": SPEAR, "shield": dict(aim=(.36, .05, 1), offset=(.045, .015, .055), half=.155, radius=.142)},
    # Solforiz's ash spear and riveted shield keep the old spear's reach and the old shield's size.
    "bp": {"spear": SPEAR, "shield": dict(aim=(.36, .05, 1), offset=(.045, .015, .055), half=.2, radius=.14)},
    # Korvenia's Charleville with the bayonet fixed is a `longArm` hold: the game lays it downrange from the two fists
    # every frame, so its tip is not a fixed point of the hand. The bake seats a spear of the musket's length for the
    # wrist and the markers; the measured tip socket is not compared.
    "ep": {"spear": dict(grip=.26, aim=(-.03, 1, .06), offset=(.014, -.005, .02), butt=-.008, tip=.86, held=True), "shield": FOREARM_GUARD},
    # Kwind-09's shock pike is spear length.
    "kp": {"spear": SPEAR, "shield": FOREARM_GUARD},
}


class PawnRig:
    """A Crownfall Pawn: joint frames of the pinned rigged GLB plus the prop
    frames `attachWeapons` gives the spear and shield in the idle stance."""

    def __init__(self, key, rigged, idle, sockets):
        self.key = key; self.skel = Skeleton(rigged); sk = self.skel
        self.rest_world = sk.fk(*sk.sample(None, [0]))[0]
        self.rest_pos = self.rest_world[:, :3, 3]; self.rest_rot = world_rot(self.rest_world)
        self.joints = sorted({j for skin in sk.doc["skins"] for j in skin["joints"]})
        self.id = lambda name: sk.index[name]
        mesh = [sk.doc["accessors"][p["attributes"]["POSITION"]] for m in sk.doc["meshes"] for p in m["primitives"]]
        self.stature = max(a["max"][1] for a in mesh)-min(a["min"][1] for a in mesh)
        self.ground = 0.0
        self.ankle = {s: self.rest_pos[self.id(s+"Foot")][1] for s in ("Left", "Right")}
        self.scale = float(np.linalg.norm(self.rest_world[self.id("Hips"), :3, 0]))  # armature scale (0.01)
        self.sockets = sockets
        # --- prop frames from the idle stance, replicating weapons.ts `mount`
        idle_sk = Skeleton(idle); clip = next(iter(idle_sk.animations))
        world = idle_sk.fk(*idle_sk.sample(clip, [0]))[0]
        spec = PROPS[key]; unit = self.stature; self.props = {}
        for hand, prop in (("RightHand", "spear"), ("LeftHand", "shield")):
            m = world[idle_sk.index[hand]]; pos = m[:3, 3]; quat = world_rot(m[None])[0]
            lateral = -1. if hand == "RightHand" else 1.
            if abs(pos[0]) > .03*unit:
                lateral = 1. if pos[0] > 0 else -1.
            s = spec[prop]; aim = np.array([s["aim"][0]*lateral, s["aim"][1], s["aim"][2]]); aim /= np.linalg.norm(aim)
            offset = np.array([s["offset"][0]*lateral, s["offset"][1], s["offset"][2]])
            height = float(np.clip(pos[1]/unit, .15, .95))
            if prop == "shield":
                bottom = height+offset[1]-s["half"]
                if bottom < .07:
                    offset[1] += .07-bottom
                z = aim; y = np.array([0., 1., 0.])-z*z[1]; y /= np.linalg.norm(y); x = np.cross(y, z)
            else:
                grip = s["grip"] if s.get("held") else min(s["grip"], max(.03, height+offset[1]-.07))
                y = aim; z = np.array([0., 0., 1.])-y*y[2]; z /= np.linalg.norm(z); x = np.cross(y, z)
            basis = np.stack([x, y, z], 1)                      # prop axes in body/world space
            inv = qinv(quat); local_basis = qmat(inv) @ basis   # prop axes in hand-local space
            origin = qrot(inv, offset*unit)/self.scale          # prop group origin, hand-local units
            k = unit/self.scale                                 # figure heights -> hand-local units
            if prop == "spear":
                axis = local_basis[:, 1]
                # the tip height is the measured socket (prop-sockets-kingdoms.json), which
                # follows the real head geometry; it must lie on the reconstructed shaft
                if not s.get("held"):
                    reach = float(np.dot(np.array(sockets["weaponLocal"], float)-origin, axis)); s = dict(s, tip=grip+reach/k)
                self.props["spear"] = dict(axis=axis, grip=origin, tip=origin+axis*(s["tip"]-grip)*k, tip_height=s["tip"], butt=origin+axis*(s["butt"]-grip)*k,
                                           basis=local_basis, grip_height=grip, lateral=lateral)
            else:
                self.props["shield"] = dict(normal=local_basis[:, 2], center=origin, basis=local_basis, radius=s["radius"]*k, lateral=lateral)
        self.body_carry = {"spear": np.array(PROPS[key]["spear"]["aim"], float)*np.array([-self.props["spear"]["lateral"], 1, 1]),
                           "shield": np.array(PROPS[key]["shield"]["aim"], float)}
        for v in self.body_carry.values():
            v /= np.linalg.norm(v)

    def socket_check(self):
        """Distance (m) between the reconstructed prop sockets and the sockets file."""
        s = self.sockets; out = {}
        held = PROPS[self.key]["spear"].get("held")  # a pose-driven hold has no hand-fixed tip to compare
        out["weaponLocal"] = 0. if held else float(np.linalg.norm(self.props["spear"]["tip"]-np.array(s["weaponLocal"])))*self.scale
        out["shieldLocal"] = float(np.linalg.norm(self.props["shield"]["center"]-np.array(s["shieldLocal"])))*self.scale
        out["shieldNormal"] = float(np.degrees(np.arccos(np.clip(np.dot(self.props["shield"]["normal"], s["shieldNormalLocal"]), -1, 1))))
        return out


class SourceRig:
    def __init__(self, family, path):
        self.family = family; self.skel = Skeleton(path); self.map = BONE_MAPS[family]
        sk = self.skel; rest = REST_CLIP[family]
        self.rest_world = sk.fk(*sk.sample(rest if rest in sk.animations else None, [0]))[0]
        self.rest_pos = {t: self.rest_world[sk.index[s], :3, 3] for t, s in self.map.items()}
        self.rest_rot = {t: world_rot(self.rest_world[sk.index[s]][None])[0] for t, s in self.map.items()}
        toes = self.rest_pos["LeftToeBase"]-self.rest_pos["LeftFoot"]
        if toes[2] <= 0:
            raise ValueError("Source rig does not face +Z")


def _mapped_child(name, mapping):
    child = BONE_CHILD.get(name)
    while child is not None and child not in mapping:
        child = BONE_CHILD.get(child)
    return child


def alignment(pawn, source):
    """Per-bone world rotation taking the Pawn's rest bone direction onto the
    source's reference-pose direction (shortest arc)."""
    out = {}
    for name in source.map:
        child = _mapped_child(name, source.map)
        if child is None:
            continue
        dt = pawn.rest_pos[pawn.id(child)]-pawn.rest_pos[pawn.id(name)]
        ds = source.rest_pos[child]-source.rest_pos[name]
        out[name] = qbetween(dt, ds)
    for name, parent in (("LeftHand", "LeftForeArm"), ("RightHand", "RightForeArm"), ("LeftToeBase", "LeftFoot"), ("RightToeBase", "RightFoot")):
        out[name] = out[parent]
    out.setdefault("Head", np.array([0., 0., 0., 1.]))
    return out


def _decay_offsets(offset, active, frames=5):
    """Extend per-frame offsets that are defined on `active` frames into the
    neighbouring frames with a linear decay, so locks blend in and out."""
    n = len(offset); out = offset.copy()
    for i in range(n):
        if active[i]:
            continue
        best = None
        for step in range(1, frames+1):
            for j in (i-step, i+step):
                if 0 <= j < n and active[j]:
                    best = (j, 1-step/(frames+1)); break
            if best:
                break
        if best:
            out[i] = offset[best[0]]*smooth(best[1])
        else:
            out[i] = 0
    return out


class Pose:
    """Mutable world-space pose track of a Pawn: desired world rotations for
    every joint, hips position, solved back to local channels on demand."""

    def __init__(self, pawn, frames):
        self.pawn = pawn; sk = pawn.skel; self.frames = frames
        self.local_r = np.tile(sk.rest_r, (frames, 1, 1)); self.local_t = np.tile(sk.rest_t, (frames, 1, 1))
        self.world = None

    def set_world_rot(self, name, quats):
        """Assign a joint's world rotation track (parents must be final)."""
        sk = self.pawn.skel; i = sk.index[name]; chain = []; p = sk.parent[i]
        while p >= 0:
            chain.append(p); p = sk.parent[p]
        parent = np.tile([0., 0., 0., 1.], (self.frames, 1))
        for j in reversed(chain):
            parent = qmul(parent, self.local_r[:, j])
        self.local_r[:, i] = qnorm(qmul(qinv(parent), quats)); self.world = None

    def solve(self):
        if self.world is None:
            sk = self.pawn.skel
            self.world = sk.fk(self.local_t, self.local_r, np.tile(sk.rest_s, (self.frames, 1, 1)))
        return self.world

    def pos(self, name):
        return self.solve()[:, self.pawn.id(name), :3, 3]

    def rot(self, name):
        return world_rot(self.solve()[:, self.pawn.id(name)])

    def premultiply(self, name, quats, weight=None):
        """Rotate a joint (and so its subtree) by world-space quaternions."""
        current = self.rot(name)
        if weight is not None:
            quats = np.stack([qslerp([0., 0., 0., 1.], q, float(w)) for q, w in zip(quats, weight)])
        self.set_world_rot(name, qmul(quats, current))

    def limb_ik(self, chain, targets, weight=None, keep_end=True):
        """Two-bone IK of `chain` (upper, lower, end) to per-frame world targets."""
        upper, lower, end = chain
        a, b, c = self.pos(upper).copy(), self.pos(lower).copy(), self.pos(end).copy()
        end_rot = self.rot(end).copy()
        qu = np.empty((self.frames, 4)); ql = np.empty((self.frames, 4))
        for f in range(self.frames):
            qu[f], ql[f] = two_bone_ik(a[f], b[f], c[f], targets[f])
            if weight is not None:
                qu[f] = qslerp([0., 0., 0., 1.], qu[f], float(weight[f])); ql[f] = qslerp([0., 0., 0., 1.], ql[f], float(weight[f]))
        self.premultiply(upper, qu)
        self.premultiply(lower, ql)
        if keep_end:
            self.set_world_rot(end, end_rot)
        return np.linalg.norm(self.pos(end)-targets, axis=1)


def retarget(pawn, source, clip, start=None, end=None, mirror=False, redirect=0.0, treadmill=False, lock_feet=True,
             anchor=False, spin=0.0, spin_frames=8, pelvis_radius=(None, .11)):
    """Body retarget of one source clip onto a Pawn. Returns (Pose, info).

    Authored timing is kept: the clip is sampled at 30 fps at its own rate.
    """
    sk = source.skel; duration = sk.duration(clip)
    f0 = 0 if start is None else int(round(start*FPS)); f1 = int(round(duration*FPS)) if end is None else int(round(end*FPS))
    times = np.arange(f0, f1+1)/FPS; frames = len(times)
    world = sk.fk(*sk.sample(clip, np.minimum(times, duration)))
    names = list(source.map)
    delta = {}; spos = {}
    for name in names:
        i = sk.index[source.map[name]]
        delta[name] = qmul(world_rot(world[:, i]), qinv(source.rest_rot[name])[None])
        spos[name] = world[:, i, :3, 3].copy()
    if mirror:
        flip = np.array([1., -1., -1., 1.])
        delta = {name: delta[MIRROR[name]]*flip for name in names}
        spos = {name: spos[MIRROR[name]]*np.array([-1., 1., 1.]) for name in names}
    if redirect:
        yaw = qaxis([0, 1, 0], redirect)
        for name in names:
            first = delta[name][0]
            step = qmul(delta[name], qinv(first)[None])
            delta[name] = qmul(qmul(qmul(yaw[None], step), qinv(yaw)[None]), first[None])
        origin = spos["Hips"][0].copy()
        for name in names:
            spos[name] = origin+qrot(yaw[None], spos[name]-origin)
    if spin:
        # whole-body quarter turn eased in over the first frames (the fall then
        # goes where the authored fall went, relative to the new facing)
        origin = spos["Hips"][0]*np.array([1., 0., 1.])
        turn = np.stack([qaxis([0, 1, 0], spin*float(smooth(f/max(1, spin_frames)))) for f in range(frames)])
        for name in names:
            delta[name] = qmul(turn, delta[name]); spos[name] = origin+qrot(turn, spos[name]-origin)
    align = alignment(pawn, source)
    pose = Pose(pawn, frames); tsk = pawn.skel
    for i in tsk.order:                                   # parents first
        name = tsk.names[i]
        if name in delta:
            const = qmul(align[name], pawn.rest_rot[pawn.id(name)])
            pose.set_world_rot(name, qmul(delta[name], const[None]))
    # --- hips trajectory
    hips_t = pawn.rest_pos[pawn.id("Hips")]; hips_s = source.rest_pos["Hips"]
    leg = lambda pos, hip, foot: float(np.linalg.norm(pos(hip)-pos(foot)))
    k = min(pawn.rest_pos[pawn.id("Head")][1]/source.rest_pos["Head"][1],
            leg(lambda n: pawn.rest_pos[pawn.id(n)], "LeftUpLeg", "LeftFoot")/leg(lambda n: source.rest_pos[n], "LeftUpLeg", "LeftFoot"))
    radius_s = pelvis_radius[0] if pelvis_radius[0] is not None else .12*source.rest_pos["Head"][1]
    radius_t = pelvis_radius[1]
    hips = np.empty((frames, 3))
    hips[:, 0] = hips_t[0]+k*(spos["Hips"][:, 0]-hips_s[0]); hips[:, 2] = hips_t[2]+k*(spos["Hips"][:, 2]-hips_s[2])
    # lying-to-lying, standing-to-standing: slope k near the ground (a pelvis a
    # little off the floor stays a little off it), easing quadratically to the
    # standing height
    u = np.clip((spos["Hips"][:, 1]-radius_s)/(hips_s[1]-radius_s), 0, 1)
    low = radius_t+k*(spos["Hips"][:, 1]-radius_s)+(hips_t[1]-radius_t-k*(hips_s[1]-radius_s))*u*u
    high = hips_t[1]+k*(spos["Hips"][:, 1]-hips_s[1])
    hips[:, 1] = np.where(spos["Hips"][:, 1] >= hips_s[1], high, low)
    hid = pawn.id("Hips")

    def place(h):
        pose.local_t[:, hid] = h/pawn.scale; pose.world = None
    place(hips)
    # --- plants, from the source feet
    stature_s = source.rest_pos["Head"][1]
    info = {"frames": frames, "plants": {}, "k": float(k)}
    plants = {}
    for side in ("Left", "Right"):
        foot = spos[side+"Foot"]; height = foot[:, 1]-source.rest_pos[side+"Foot"][1]
        speed = np.zeros(frames)
        if frames > 1:
            v = np.linalg.norm(np.diff(foot[:, [0, 2]], axis=0), axis=1)*FPS
            speed[1:] = v; speed[0] = v[0]
        limit = 1e9 if (treadmill or anchor) else .35*stature_s
        plants[side] = plant_intervals(height, speed, .055*stature_s, .03*stature_s, limit)
    if treadmill:
        # In-place locomotion: the planted foot defines the travel.
        shift = np.zeros((frames, 3)); feet = {s: pose.pos(s+"Foot").copy() for s in plants}
        for f in range(1, frames):
            moves = [feet[s][f]-feet[s][f-1] for s, spans in plants.items() if any(a < f <= b for a, b in spans)]
            shift[f] = shift[f-1]
            if moves:
                step = -np.mean(moves, axis=0); shift[f, 0] += step[0]; shift[f, 2] += step[2]
        hips = hips+shift; place(hips)
    # 1 while the source stands, 0 once its pelvis is below ~45% of standing height:
    # a body on the ground rests on the board, not on its feet
    upright = smooth((spos["Hips"][:, 1]/hips_s[1]-.45)/.3)
    if anchor:
        # Falls pivot about the planted feet: derive the pelvis from the Pawn's
        # own legs standing on the locked feet instead of bending them to a
        # path scaled from differently proportioned legs.
        shift = np.zeros((frames, 3)); active = np.zeros(frames, bool); count = np.zeros(frames)
        for side, spans in plants.items():
            fk = pose.pos(side+"Foot").copy()
            for a, b in spans:
                lock = np.array([fk[a, 0], pawn.ankle[side], fk[a, 2]])
                shift[a:b+1] += lock-fk[a:b+1]; count[a:b+1] += 1; active[a:b+1] = True
        shift[active] /= count[active][:, None]
        shift = _decay_offsets(shift, active, frames=8)
        hips = hips+shift*upright[:, None]; place(hips)
    # --- ground: never below the board. Lift the body where pelvis, torso, head,
    # knees or hands would sink, then pin the planted feet.
    def lift_clear():
        nonlocal hips
        lowest = np.full(frames, np.inf)
        for name, radius in (("Hips", radius_t), ("Spine", .12), ("Head", .11), ("LeftLeg", .06), ("RightLeg", .06)):
            lowest = np.minimum(lowest, pose.pos(name)[:, 1]-radius)
        for name in ("LeftHand", "RightHand"):              # hands only hold the body up while it stands
            lowest = np.minimum(lowest, np.where(upright > .5, pose.pos(name)[:, 1]-.04, np.inf))
        lift = np.maximum(0, pawn.ground-lowest)
        if lift.max() > 1e-4:
            hips = hips+np.stack([np.zeros(frames), lift, np.zeros(frames)], 1); place(hips)
        return lift
    lift = lift_clear()
    if anchor and (upright < 1).any():
        # A fallen body rests on the board. Sources with other proportions (a
        # large head props the chest up) leave the Pawn's torso hovering, so
        # bend at the waist until the chest lies at its own radius.
        pelvis = pose.pos("Hips"); chest = pose.pos("Spine"); turn = np.tile([0., 0., 0., 1.], (frames, 1))
        for f in range(frames):
            d = chest[f]-pelvis[f]; length = np.linalg.norm(d); want = .13-pelvis[f, 1]
            if upright[f] >= 1 or chest[f, 1] <= .15 or abs(want) >= length:
                continue
            flat = np.array([d[0], 0., d[2]]); norm = np.linalg.norm(flat)
            if norm < 1e-6:
                continue
            goal = flat/norm*np.sqrt(length*length-want*want)+np.array([0., want, 0.])
            turn[f] = qslerp([0., 0., 0., 1.], qbetween(d, goal), float(1-upright[f]))
        pose.premultiply("Spine02", turn)
        lift = np.maximum(lift, lift_clear())
    for side, spans in plants.items():
        chain = LEGS[side]; fk = pose.pos(chain[2]).copy()
        offset = np.zeros((frames, 3)); active = np.zeros(frames, bool)
        if lock_feet:
            for a, b in spans:
                lock = np.array([fk[a, 0], pawn.ankle[side], fk[a, 2]])
                offset[a:b+1] = lock-fk[a:b+1]; active[a:b+1] = True
            offset = _decay_offsets(offset, active)*upright[:, None]
        target = fk+offset; target[:, 1] = np.maximum(target[:, 1], .55*pawn.ankle[side])
        residual = pose.limb_ik(chain, target)
        info["plants"][side] = [(int(a), int(b)) for a, b in spans]
        info.setdefault("footResidual", {})[side] = float(residual[active].max()) if active.any() else 0.
    info["lift"] = float(lift.max()); info["hips"] = hips; info["times"] = times-times[0]; info["source_pos"] = spos
    info["source_time"] = (float(times[0]), float(times[-1]))
    return pose, info


# ------------------------------------------------------------ props and cues
def _first(mask, default=None):
    hits = np.nonzero(mask)[0]
    return int(hits[0]) if len(hits) else default


def _dir_blend(a, b, w):
    """Per-frame spherical blend from direction track a to direction track b."""
    out = np.empty_like(a)
    for f in range(len(a)):
        out[f] = qrot(qslerp([0., 0., 0., 1.], qbetween(a[f], b[f]), float(w[f])), a[f])
    return out


def _torso_delta(pose):
    pawn = pose.pawn
    return qmul(pose.rot("Spine"), qinv(pawn.rest_rot[pawn.id("Spine")])[None])


def spear_tip(pose):
    pawn = pose.pawn; m = pose.solve()[:, pawn.id("RightHand")]
    return (m @ np.append(pawn.props["spear"]["tip"], 1.))[:, :3]


def spear_axis(pose):
    return qrot(pose.rot("RightHand"), pose.pawn.props["spear"]["axis"][None])


def shield_center(pose):
    pawn = pose.pawn; m = pose.solve()[:, pawn.id("LeftHand")]
    return (m @ np.append(np.array(pawn.sockets["shieldLocal"], float), 1.))[:, :3]


def shield_normal(pose):
    return qrot(pose.rot("LeftHand"), pose.pawn.props["shield"]["normal"][None])


def _rise(track):
    """0..1 progress of a scalar track from its first value to its peak."""
    span = track.max()-track[0]
    return np.zeros(len(track)) if span < 1e-6 else np.clip((track-track[0])/span, 0, 1)


def apply_props(pose, spec, info):
    """Re-seat spear and shield on the retargeted arms.

    The CC0 sources swing swords or empty hands; the Pawn carries an upright
    spear in its right fist and a round shield on its left. The wrist is turned
    (never the timing) so the spear is carried upright, levels along the attack
    line through a thrust, and the shield faces the opponent in guards, blocks
    and bashes; block clips also pull the shield onto the incoming thrust line
    with two-bone IK. Returns the weight tracks used, for the metadata."""
    pawn = pose.pawn; F = pose.frames; ones = np.ones(F); zeros = np.zeros(F)
    torso = _torso_delta(pose)
    kind = spec["kind"]; fade = ones.copy()
    if kind == "death":
        chest = pose.pos("Spine")[:, 1]; land = _first(chest < .45*chest[0], F-1)
        fade = 1-smooth(np.arange(F)/max(1, land))
    # ---- spear
    carry = pawn.body_carry["spear"]
    d_carry = .5*carry[None]+.5*qrot(torso, carry[None]); d_carry /= np.linalg.norm(d_carry, axis=1, keepdims=True)
    hand = pose.pos("RightHand"); chest_p = pose.pos("Spine")
    reach = hand[:, 2]-chest_p[:, 2]
    w = zeros.copy(); desired = d_carry
    mode = spec.get("spear", "carry")
    if mode == "thrust":
        peak = _first(reach >= reach.max()-.015*(reach.max()-reach.min()+1e-9), F-1)
        cock = int(np.argmin(reach[:peak+1])) if peak > 0 else 0
        level = max(cock, min(4, max(1, peak//2)))
        w = smooth(np.arange(F)/max(1, level))
        if not spec.get("hold_level"):               # a wind-up ends levelled; everything else comes back to the carry
            start_reach = reach[-1]
            back = _first((np.arange(F) > peak) & (reach-start_reach < .5*(reach[peak]-start_reach)), None)
            if back is not None and back < F-1:
                w = np.minimum(w, 1-smooth((np.arange(F)-back)/max(1, F-1-back)))
        far = np.array([0., pawn.sockets["bodyTarget"][1], pose.pos("Hips")[0, 2]+pawn.sockets["standoffUnits"]/pawn.sockets["normalizationScale"]+1.])
        aim = far[None]-hand; aim /= np.linalg.norm(aim, axis=1, keepdims=True)
        desired = _dir_blend(d_carry, aim, w)
        info["spearLevel"] = dict(cock=int(cock), peak=int(peak))
    elif mode == "parry":
        hips_y = pose.pos("Hips")[:, 1]; w = _rise(-hips_y)       # the block's crouch drives the spear across the body
        across = np.array([.55, .75, .35]); across /= np.linalg.norm(across)
        desired = _dir_blend(d_carry, np.tile(across, (F, 1)), w)
    if kind == "death":
        # a dropped spear lies on the board: ease the shaft from the carry to
        # the horizontal projection of wherever the dying hand leaves it
        axis = spear_axis(pose); flat = axis*np.array([1., 0., 1.]); norm = np.linalg.norm(flat, axis=1, keepdims=True)
        flat = np.where(norm > 1e-3, flat/np.maximum(norm, 1e-9), np.array([0., 0., 1.]))
        for f in range(1, F):                       # keep the lying direction from flipping
            if np.dot(flat[f], flat[f-1]) < 0 and fade[f] < .5:
                flat[f] = -flat[f]
        flat[:, 1] = .04; desired = _dir_blend(d_carry, flat, 1-fade); fade_spear = ones
    else:
        fade_spear = fade
    q = np.stack([qbetween(a, b) for a, b in zip(spear_axis(pose), desired)])
    pose.premultiply("RightHand", q, weight=fade_spear)
    # ---- shield
    carry = pawn.body_carry["shield"]
    n_carry = .5*carry[None]+.5*qrot(torso, carry[None]); n_carry /= np.linalg.norm(n_carry, axis=1, keepdims=True)
    left = pose.pos("LeftHand"); forward = left[:, 2]-chest_p[:, 2]
    mode = spec.get("shield", "carry"); wf = zeros.copy()
    if mode == "front":
        wf = ones.copy()
    elif mode == "block":
        wf = _rise(forward+.5*(left[:, 1]-left[0, 1]))
    elif mode == "block-held":
        wf = ones.copy(); mode = "block"
    front = np.array([.12, .04, 1.]); front /= np.linalg.norm(front)
    desired = _dir_blend(n_carry, np.tile(front, (F, 1)), wf)
    q = np.stack([qbetween(a, b) for a, b in zip(shield_normal(pose), desired)])
    pose.premultiply("LeftHand", q, weight=fade)
    if mode == "block":
        height = pawn.sockets["bodyTarget"][1] if spec.get("line", "mid") == "mid" else pawn.rest_pos[pawn.id("Head")][1]+.06
        goal = np.stack([chest_p[:, 0]*0+pose.pos("Hips")[:, 0], np.full(F, height), chest_p[:, 2]+.40], 1)
        offset = qrot(pose.rot("LeftHand"), (np.array(pawn.sockets["shieldLocal"], float)*pawn.scale)[None])
        pose.limb_ik(ARMS["Left"], goal-offset, weight=.9*wf)
        info["blockLine"] = dict(height=float(height), residual=float(np.linalg.norm(shield_center(pose)-goal, axis=1)[int(np.argmax(wf))]))
    info["weights"] = dict(spearLevel=w, shieldFront=wf, parry=w)
    return info


def derive_markers(pose, spec, info):
    """Named events read off the baked motion itself (frame numbers at 30 fps)."""
    F = pose.frames; last = F-1; kind = spec["kind"]; pawn = pose.pawn
    events = [("start", 0), ("end", last)]
    tip = spear_tip(pose); shield = shield_center(pose); chest = pose.pos("Spine"); hips = pose.pos("Hips")

    def strike(track):
        """Contact = closest approach to the opponent: the frame the driving
        hand arrives at its furthest forward point (where its velocity
        reverses). Ready = the last near-still frame before that drive."""
        z = track[:, 2]; v = np.gradient(z)*FPS
        span = max(z.max()-z.min(), 1e-6)
        hit = _first(z >= z.max()-.02*span, last)
        vmax = max(v[:hit+1].max(), 1e-6)
        fast = np.nonzero(v[:hit+1] >= .5*vmax)[0]; drive = int(fast[-1]) if len(fast) else 0
        while drive > 0 and v[drive-1] >= .1*vmax:
            drive -= 1
        ready = max(0, drive-1) if drive > 0 else 0
        settle = _first((np.arange(F) > hit) & (z-z[-1] < .1*(z[hit]-z[-1])), None)
        return hit, ready, settle

    if kind in ("thrust", "bash", "feint"):
        # timing from the driving hand (the wrist re-aim moves the tip on its own);
        # the contact point is where the tip / shield face is at that frame
        track = shield if kind == "bash" else tip
        hit, ready, settle = strike(pose.pos("LeftHand" if kind == "bash" else "RightHand"))
        events.append(("ready", ready))
        if kind == "feint":
            events.append(("feint", hit))
        else:
            if kind == "bash":
                events.append(("clash", hit))
            events += [("contact", hit), ("impact", hit)]
            point = track[hit]
            info["contact"] = dict(anchor="shieldFace" if kind == "bash" else "weaponTip", frame=int(hit), metres=[float(v) for v in point])
        if settle is not None and settle < last:
            events.append(("recovery", settle))
    elif kind == "windup":
        events.append(("ready", last))
    elif kind in ("block", "parry"):
        w = info["weights"]["shieldFront" if kind == "block" else "parry"]
        guard = _first(w >= .95, last); events.append(("guard", guard))
        drop = _first((np.arange(F) > guard) & (w < .3), None)
        if drop is not None and drop < last:
            events.append(("recovery", drop))
    elif kind == "dodge":
        away = np.linalg.norm((hips-hips[0])[:, [0, 2]], axis=1)
        events.append(("evade", _first(away >= .2, last)))
    elif kind in ("hit", "death"):
        speed = np.linalg.norm(np.gradient(chest, axis=0), axis=1)*FPS
        onset = _first(speed >= .15*speed.max(), 0); events.append(("hit", max(0, onset-1)))
        if kind == "death":
            # first pelvis or torso ground contact: the frame either comes to rest height
            land = min(_first(track <= track.min()+.03, last) for track in (hips[:, 1], chest[:, 1])); events.append(("land", land))
            info["land"] = dict(frame=int(land), pelvisHeight=float(hips[land, 1]), torsoHeight=float(chest[land, 1]))
        else:
            away = np.linalg.norm(chest-chest[-1], axis=1); peak = int(np.argmax(away))
            settle = _first((np.arange(F) > peak) & (away < .15*away[peak]), None)
            if settle is not None and settle < last:
                events.append(("recovery", settle))
    elif kind == "victory":
        hands = pose.pos("LeftHand")[:, 1]+pose.pos("RightHand")[:, 1]; peak = int(np.argmax(hands))
        events.append(("victory", peak))
        drop = _first((np.arange(F) > peak) & (hands-hands[-1] < .3*(hands[peak]-hands[-1])), None)
        if drop is not None and drop < last:
            events.append(("recovery", drop))
    elif kind in ("guard", "step"):
        events.append(("ready", 0 if kind == "guard" else last))
    elif kind == "settle":
        events.append(("recovery", 0))
    if kind != "death":
        for side, spans in info["plants"].items():
            if not spans or spans[0][0] > 0:        # clip opens with this foot in the air
                events.append((f"foot_{side.lower()}_lift", 0))
            for a, b in spans:
                events.append((f"foot_{side.lower()}_plant", a))
                if b < last:
                    events.append((f"foot_{side.lower()}_lift", b+1))
    seen = set(); out = []
    for name, frame in sorted(events, key=lambda e: (e[1], e[0])):
        if (name, frame) not in seen:
            seen.add((name, frame)); out.append((name, int(frame)))
    return out

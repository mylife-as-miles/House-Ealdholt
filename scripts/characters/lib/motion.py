"""Motion: 100STYLE (CC BY 4.0) retargeting and original keyframed loops for the shared rig.

Original Crownfall code. A small BVH reader produces source joint transforms; each
target bone takes the source joint's global rotation, pre-aligned so the rest
directions coincide (the source rest is a T-pose, the target an A-pose). Cycles are
closed by distributing the seam error, made in-place, and the feet are locked to the
ground with analytic two-bone IK during contact. Clips are written as NLA tracks so
the glTF exporter emits one named animation per clip.
"""
import math

import bpy
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector

# ------------------------------------------------------------------ BVH

class BVH:
    def __init__(self, path):
        self.names, self.parents, self.offsets, self.channels, self.ends = [], [], [], [], {}
        with open(path, encoding="utf-8", errors="replace") as handle:
            tokens = handle.read().split()
        i, stack, current = 0, [], -1
        while tokens[i] != "MOTION":
            t = tokens[i]
            if t in ("ROOT", "JOINT"):
                self.names.append(tokens[i + 1])
                self.parents.append(stack[-1] if stack else -1)
                current = len(self.names) - 1
                i += 2
            elif t == "End":
                self.ends[current] = None
                current = -2
                i += 2
            elif t == "{":
                stack.append(current)
                i += 1
            elif t == "}":
                stack.pop()
                i += 1
            elif t == "OFFSET":
                off = tuple(float(x) for x in tokens[i + 1:i + 4])
                if current == -2:
                    self.ends[stack[-2] if len(stack) > 1 else -1] = off
                else:
                    self.offsets.append(off)
                i += 4
            elif t == "CHANNELS":
                n = int(tokens[i + 1])
                self.channels.append(tokens[i + 2:i + 2 + n])
                i += 2 + n
            else:
                i += 1
        i += 1
        assert tokens[i] == "Frames:"
        frames = int(tokens[i + 1])
        self.frame_time = float(tokens[i + 4])
        data = np.array(tokens[i + 5:], dtype=np.float64)
        self.frames = data.reshape(frames, -1)
        self.offsets = np.array(self.offsets)
        # fix end-site parent keys (End Site sits inside its joint's braces)
        fixed = {}
        for k, v in self.ends.items():
            if v is not None:
                fixed[k] = v
        self.ends = fixed

    @property
    def fps(self):
        return 1.0 / self.frame_time

    def index(self, name):
        return self.names.index(name)

    def globals(self, frame_indices):
        """Global rotation matrices (F,J,3,3) and positions (F,J,3) in BVH space (cm, +Y up)."""
        J = len(self.names)
        F = len(frame_indices)
        rot = np.zeros((F, J, 3, 3))
        pos = np.zeros((F, J, 3))
        col = 0
        layout = []
        for j in range(J):
            layout.append((col, self.channels[j]))
            col += len(self.channels[j])
        for fi, f in enumerate(frame_indices):
            row = self.frames[f]
            for j in range(J):
                start, chans = layout[j]
                local_t = np.array(self.offsets[j], dtype=np.float64)
                r = np.eye(3)
                for k, ch in enumerate(chans):
                    v = row[start + k]
                    if ch == "Xposition":
                        local_t[0] = v
                    elif ch == "Yposition":
                        local_t[1] = v
                    elif ch == "Zposition":
                        local_t[2] = v
                    else:
                        a = math.radians(v)
                        c, s = math.cos(a), math.sin(a)
                        if ch == "Xrotation":
                            m = np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
                        elif ch == "Yrotation":
                            m = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
                        else:
                            m = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
                        r = r @ m
                p = self.parents[j]
                if p < 0:
                    rot[fi, j] = r
                    pos[fi, j] = local_t
                else:
                    rot[fi, j] = rot[fi, p] @ r
                    pos[fi, j] = pos[fi, p] + rot[fi, p] @ local_t
        return rot, pos

    def rest_positions(self):
        J = len(self.names)
        pos = np.zeros((J, 3))
        for j in range(J):
            p = self.parents[j]
            pos[j] = self.offsets[j] if p < 0 else pos[p] + self.offsets[j]
        return pos


# BVH (+Y up, +Z forward, cm) to Blender (+Z up, -Y forward, m)
C3 = np.array([[1.0, 0, 0], [0, 0, -1.0], [0, 1.0, 0]])


def to_blender_pos(p):
    return (C3 @ np.asarray(p).T).T * 0.01


def to_blender_rot(r):
    return C3 @ r @ C3.T


# ------------------------------------------------------------------ rig model

class Rig:
    def __init__(self, arm):
        self.arm = arm
        bones = arm.data.bones
        self.order = []

        def visit(b):
            self.order.append(b.name)
            for c in b.children:
                visit(c)
        for b in bones:
            if b.parent is None:
                visit(b)
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in bones}
        self.children = {b.name: [c.name for c in b.children] for b in bones}
        self.rest = {b.name: b.matrix_local.copy() for b in bones}
        self.rel = {n: (self.rest[p].inverted() @ self.rest[n] if p else self.rest[n].copy()) for n, p in self.parent.items()}
        self.length = {b.name: b.length for b in bones}

    def fk(self, rot, loc=None, upto=None):
        loc = loc or {}
        out = {}
        for n in self.order:
            q = rot.get(n)
            basis = q.to_matrix().to_4x4() if q is not None else Matrix.Identity(4)
            if n in loc:
                basis = Matrix.Translation(loc[n]) @ basis
            p = self.parent[n]
            out[n] = (out[p] if p else Matrix.Identity(4)) @ self.rel[n] @ basis
        return out

    def local_from_world(self, name, pose, world_rot):
        """Basis rotation of bone `name` giving armature-space rotation world_rot (3x3), given parent pose."""
        p = self.parent[name]
        frame = (pose[p] if p else Matrix.Identity(4)) @ self.rel[name]
        return (frame.to_3x3().inverted() @ world_rot).to_quaternion()

    def update_chain(self, pose, rot, loc, start):
        """Recompute pose matrices for `start` and its descendants after rot/loc changes."""
        stack = [start]
        while stack:
            n = stack.pop()
            q = rot.get(n)
            basis = q.to_matrix().to_4x4() if q is not None else Matrix.Identity(4)
            if n in loc:
                basis = Matrix.Translation(loc[n]) @ basis
            p = self.parent[n]
            pose[n] = (pose[p] if p else Matrix.Identity(4)) @ self.rel[n] @ basis
            stack.extend(self.children[n])


STYLE100_MAP = {
    "hips": ("Hips", "Chest"), "spine_01": ("Chest", "Chest2"), "spine_02": ("Chest2", "Chest3"),
    "spine_03": ("Chest4", "Neck"), "neck": ("Neck", "Head"), "head": ("Head", None),
    "clavicle_l": ("LeftCollar", "LeftShoulder"), "upperarm_l": ("LeftShoulder", "LeftElbow"),
    "forearm_l": ("LeftElbow", "LeftWrist"), "hand_l": ("LeftWrist", None),
    "clavicle_r": ("RightCollar", "RightShoulder"), "upperarm_r": ("RightShoulder", "RightElbow"),
    "forearm_r": ("RightElbow", "RightWrist"), "hand_r": ("RightWrist", None),
    "thigh_l": ("LeftHip", "LeftKnee"), "calf_l": ("LeftKnee", "LeftAnkle"), "foot_l": ("LeftAnkle", "LeftToe"),
    "toes_l": ("LeftToe", None),
    "thigh_r": ("RightHip", "RightKnee"), "calf_r": ("RightKnee", "RightAnkle"), "foot_r": ("RightAnkle", "RightToe"),
    "toes_r": ("RightToe", None),
}


class Retarget:
    def __init__(self, bvh, rig, mapping=STYLE100_MAP):
        self.bvh, self.rig, self.mapping = bvh, rig, mapping
        rest = to_blender_pos(bvh.rest_positions())
        self.align = {}
        for bone, (joint, child) in mapping.items():
            j = bvh.index(joint)
            if child is not None:
                d_s = Vector(rest[bvh.index(child)] - rest[j])
            elif j in bvh.ends:
                d_s = Vector(C3 @ np.array(bvh.ends[j]) * 0.01)
            else:
                d_s = None
            d_t = rig.rest[bone].to_3x3() @ Vector((0, 1, 0))
            self.align[bone] = d_t.rotation_difference(d_s.normalized()).to_matrix() if d_s is not None and d_s.length > 1e-6 else Matrix.Identity(3)
        # The pelvis is matched frame to frame, not by bone direction: the CC0 rig's hips bone points up and
        # back about 45 degrees, so direction matching pitched every retargeted pelvis forward by that much
        # (hips-weighted skin and skirt bones inherited the tilt). Both rest poses stand upright.
        self.align["hips"] = Matrix.Identity(3)
        sl = np.linalg.norm(rest[bvh.index("LeftKnee")] - rest[bvh.index("LeftHip")]) + np.linalg.norm(rest[bvh.index("LeftAnkle")] - rest[bvh.index("LeftKnee")])
        tl = rig.length["thigh_l"] + rig.length["calf_l"]
        self.scale = tl / sl

    def pose(self, rot_f, pos_f, yaw=0.0, hips_blender=None):
        """Target basis rotations and hips location for one frame of source globals, turned by yaw about +Z.
        hips_blender overrides the (unscaled, Blender-space) hips position, e.g. for a straightened path."""
        rig = self.rig
        rot, loc, pose = {}, {}, {}
        rz = Matrix.Rotation(yaw, 3, "Z")
        if hips_blender is None:
            hips_src = rz @ Vector(to_blender_pos(pos_f[self.bvh.index("Hips")]) * self.scale)
        else:
            hips_src = Vector(hips_blender) * self.scale
        for n in rig.order:
            if n in self.mapping:
                j = self.bvh.index(self.mapping[n][0])
                g = rz @ Matrix(to_blender_rot(rot_f[j]).tolist())
                world = g @ self.align[n] @ rig.rest[n].to_3x3()
                if n == "hips":
                    loc[n] = rig.rest[n].inverted() @ hips_src
                    # basis loc is applied in the bone's rest frame; rotation solved below
                p = rig.parent[n]
                frame = (pose[p] if p else Matrix.Identity(4)) @ rig.rel[n]
                if n == "hips":
                    frame = frame @ Matrix.Translation(loc[n])
                rot[n] = (frame.to_3x3().inverted() @ world).to_quaternion()
            p = rig.parent[n]
            basis = rot[n].to_matrix().to_4x4() if n in rot else Matrix.Identity(4)
            if n in loc:
                basis = Matrix.Translation(loc[n]) @ basis
            pose[n] = (pose[p] if p else Matrix.Identity(4)) @ rig.rel[n] @ basis
        return rot, loc, pose


def straightened(bvh, rot, pos, yaw):
    """Per-frame yaw that removes the linear heading drift of a curved capture path, and the hips
    path re-integrated along the corrected heading (Blender metres, before retarget scaling)."""
    hips = bvh.index("Hips")
    fwd = rot[:, hips] @ np.array([0.0, 0.0, 1.0])
    heading = np.unwrap(np.arctan2(fwd[:, 0], fwd[:, 2]))
    n = len(heading)
    trend = heading[0] + (heading[-1] - heading[0]) * np.linspace(0.0, 1.0, n)
    yaws = yaw - (trend - trend[0])
    p = to_blender_pos(pos[:, hips])
    out = np.zeros_like(p)
    out[0] = np.array(Matrix.Rotation(yaws[0], 3, "Z") @ Vector(p[0]))
    for k in range(1, n):
        out[k] = out[k - 1] + np.array(Matrix.Rotation(yaws[k], 3, "Z") @ Vector(p[k] - p[k - 1]))
    return yaws, out, float(np.degrees(heading[-1] - heading[0]))


# ------------------------------------------------------------------ pose utilities

def slerp(a, b, t):
    return a.slerp(b, t)


def ensure_continuity(frames):
    """Keep quaternion signs continuous frame to frame (no hemisphere flips)."""
    for n in frames[0][0]:
        prev = frames[0][0][n]
        for f in frames[1:]:
            q = f[0][n]
            if prev.dot(q) < 0:
                f[0][n] = Quaternion((-q.w, -q.x, -q.y, -q.z))
            prev = f[0][n]


def close_loop(frames):
    """Distribute the seam (last vs first) linearly over the clip so the loop closes exactly."""
    n = len(frames)
    first_rot, first_loc = frames[0][0], frames[0][1]
    last_rot, last_loc = frames[-1][0], frames[-1][1]
    for i, (rot, loc) in enumerate(frames):
        t = i / (n - 1)
        for b in rot:
            d = first_rot[b] @ last_rot[b].inverted()  # rotation that maps last onto first
            if d.w < 0:
                d = Quaternion((-d.w, -d.x, -d.y, -d.z))
            rot[b] = Quaternion().slerp(d, t) @ rot[b]
            rot[b].normalize()
        for b in loc:
            loc[b] = loc[b] + (first_loc[b] - last_loc[b]) * t


def seam_degrees(frames):
    worst = 0.0
    a, b = frames[0][0], frames[-1][0]
    for n in a:
        worst = max(worst, math.degrees(a[n].rotation_difference(b[n]).angle))
    return worst


def resample(frames_src, fps_src, fps_dst):
    """Linear (slerp) resampling of (rot, loc) frames."""
    n_src = len(frames_src)
    duration = (n_src - 1) / fps_src
    n_dst = int(round(duration * fps_dst)) + 1
    out = []
    for i in range(n_dst):
        t = i / fps_dst * fps_src
        k = min(int(t), n_src - 2)
        f = t - k
        r0, l0 = frames_src[k]
        r1, l1 = frames_src[k + 1]
        rot = {b: r0[b].slerp(r1[b], f) for b in r0}
        loc = {b: l0[b].lerp(l1[b], f) for b in l0}
        out.append((rot, loc))
    return out


def two_bone_ik(rig, pose, rot, loc, upper, lower, end, target, pole):
    """Analytic two-bone IK: place `end`'s head at target, knee/elbow toward pole. Updates rot/pose."""
    a = pose[upper].translation
    b = pose[lower].translation
    c = pose[end].translation
    la, lb = (b - a).length, (c - b).length
    to_t = target - a
    d = max(abs(la - lb) + 1e-4, min(la + lb - 1e-4, to_t.length))
    to_t = to_t.normalized()
    pole_dir = (pole - a)
    pole_dir = (pole_dir - to_t * pole_dir.dot(to_t))
    if pole_dir.length < 1e-6:
        pole_dir = (b - a) - to_t * (b - a).dot(to_t)
    pole_dir.normalize()
    cos_a = (la * la + d * d - lb * lb) / (2 * la * d)
    sin_a = math.sqrt(max(0.0, 1 - cos_a * cos_a))
    nb = a + to_t * (cos_a * la) + pole_dir * (sin_a * la)
    q1 = (b - a).rotation_difference(nb - a)
    upper_world = q1.to_matrix() @ pose[upper].to_3x3()
    rot[upper] = rig.local_from_world(upper, pose, upper_world)
    rig.update_chain(pose, rot, loc, upper)
    b2, c2 = pose[lower].translation, pose[end].translation
    q2 = (c2 - b2).rotation_difference((a + to_t * d) - b2)
    lower_world = q2.to_matrix() @ pose[lower].to_3x3()
    rot[lower] = rig.local_from_world(lower, pose, lower_world)
    rig.update_chain(pose, rot, loc, lower)


def set_world_rotation(rig, pose, rot, loc, bone, world_rot):
    rot[bone] = rig.local_from_world(bone, pose, world_rot)
    rig.update_chain(pose, rot, loc, bone)


# ------------------------------------------------------------------ writing clips

def write_clip(arm, name, frames, fps, bones=None):
    """Key the given (rot, loc) frames as a new action on its own NLA track named `name`."""
    scene = bpy.context.scene
    scene.render.fps = fps
    if arm.animation_data is None:
        arm.animation_data_create()
    action = bpy.data.actions.new(name)
    arm.animation_data.action = action
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    keyed = set()
    names = sorted(bones) if bones is not None else [b.name for b in arm.pose.bones]
    for i, (rot, loc) in enumerate(frames):
        frame = i  # clips start at t = 0 so loops close without a held frame
        for b in names:
            q = rot.get(b, Quaternion())
            pb = arm.pose.bones[b]
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=frame)
            keyed.add(b)
        for b, v in loc.items():
            pb = arm.pose.bones[b]
            pb.location = v
            pb.keyframe_insert("location", frame=frame)
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 0, action)
    strip.name = name
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    return {"name": name, "frames": len(frames), "seconds": (len(frames) - 1) / fps, "bones": len(keyed)}

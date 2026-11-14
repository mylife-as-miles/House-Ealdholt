"""Stage: clips for the shared rig.

idle, walk, walk_start, walk_stop: 100STYLE Neutral takes (CC BY 4.0), retargeted, in-place,
loop-closed and foot-locked. work_hammer: original keyframed two-strike loop solved with IK
at the anvil, with the hammer and tongs held through fixed grips. talk: the idle with head
and jaw beats. face_blink, face_gaze, face_jaw: Tier A joint demonstrations.
Root motion removed from locomotion is reported per clip for route presentation.
"""
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

import face_rig
import idle_talk as it
import locomotion as lc
import motion as mo

FPS = 30
BODY_SKIP = {"root"}


def smoothstep(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


class Hands:
    """Palm frames and grip curls derived from the rest skeleton."""

    def __init__(self, rig):
        self.rig = rig
        self.frames = {}
        for side in ("l", "r"):
            R = rig.rest
            wrist = R[f"hand_{side}"].translation
            idx, pky, mid = (R[f"{f}_01_{side}"].translation for f in ("index", "pinky", "middle"))
            axis = (mid - wrist).normalized()
            across = (idx - pky)
            across = (across - axis * across.dot(axis)).normalized()
            palm = axis.cross(across).normalized()
            tip_bone = f"index_03_{side}"
            tip = R[tip_bone].translation + R[tip_bone].to_3x3() @ Vector((0, rig.length[tip_bone], 0))
            if (tip - idx).dot(palm) < 0:
                palm = -palm
            centre = (wrist + idx + pky + mid) / 4
            self.frames[side] = {"axis": axis, "across": across, "palm": palm, "centre": centre}

    def curl(self, side, finger_deg, thumb_deg):
        rig, f = self.rig, self.frames[side]
        out = {}
        for finger, angles in finger_deg.items():
            for k, a in enumerate(angles):
                b = f"{finger}_{k + 1:02d}_{side}"
                d = rig.rest[b].to_3x3() @ Vector((0, 1, 0))
                ax = d.cross(f["palm"]).normalized()
                out[b] = Quaternion(rig.rest[b].to_3x3().inverted() @ ax, math.radians(a))
        for k, a in enumerate(thumb_deg):
            b = f"thumb_{k + 1:02d}_{side}"
            d = rig.rest[b].to_3x3() @ Vector((0, 1, 0))
            ax = d.cross(f["palm"] - f["across"] * 0.6).normalized()
            out[b] = Quaternion(rig.rest[b].to_3x3().inverted() @ ax, math.radians(a))
        return out

    def grip_matrix(self, side, handle_offset):
        """Prop frame in hand-bone space: prop +Y across the palm toward the thumb side, prop -Z along
        the hand axis (knuckle direction), prop origin `handle_offset` metres behind the grip point."""
        rig, f = self.rig, self.frames[side]
        y = f["across"] if side == "r" else f["across"]
        z = -f["axis"]
        x = y.cross(z).normalized()
        z = x.cross(y).normalized()
        rot = Matrix((x, y, z)).transposed()
        grip_point = f["centre"] + f["palm"] * 0.024 + f["axis"] * 0.012
        world = Matrix.Translation(grip_point) @ rot.to_4x4() @ Matrix.Translation(Vector((0, -handle_offset, 0)))
        return rig.rest[f"hand_{side}"].inverted() @ world  # relative to the hand bone at rest


RELAXED = {"index": (14, 18, 10), "middle": (18, 22, 12), "ring": (22, 26, 14), "pinky": (26, 28, 16)}
GRIP = {"index": (62, 78, 40), "middle": (70, 80, 42), "ring": (74, 82, 44), "pinky": (78, 84, 46)}


def skirt_follow(rig, frames, cyclic=True, gain=0.25, lag=0.2, dead=math.radians(8.0), cap=math.radians(12.0)):
    """Front/back/side skirt bones swing with the thighs (damped) so hems clear the legs."""
    targets = []
    rest_hips = rig.rest["hips"].to_3x3()
    for rot, loc in frames:
        pose = rig.fk(rot, loc)
        # leg direction in a pelvis-aligned world frame (-Y forward, +X left, +Z up), compared with rest
        to_rest = (pose["hips"].to_3x3() @ rest_hips.inverted()).inverted()
        swing = {}
        for side in ("l", "r"):
            d = to_rest @ (pose[f"calf_{side}"].translation - pose[f"thigh_{side}"].translation)
            d0 = rig.rest[f"calf_{side}"].translation - rig.rest[f"thigh_{side}"].translation
            fwd = math.atan2(-d.y, -d.z) - math.atan2(-d0.y, -d0.z)
            out = math.atan2(abs(d.x), -d.z) - math.atan2(abs(d0.x), -d0.z)
            swing[side] = (fwd, out)
        front = -gain * max(0.0, max(swing["l"][0], swing["r"][0]) - dead)
        back = gain * max(0.0, max(-swing["l"][0], -swing["r"][0]) - dead)
        targets.append({"skirt_front": (front, 0.0), "skirt_back": (back, 0.0),
                        "skirt_l": (-0.5 * gain * swing["l"][0], -0.4 * swing["l"][1]),
                        "skirt_r": (-0.5 * gain * swing["r"][0], 0.4 * swing["r"][1])})
    n = len(targets)
    state = {k: list(v) for k, v in targets[0].items()}
    vel = {k: [0.0, 0.0] for k in state}
    out = [None] * n
    k_spring = (2 * math.pi / max(lag * 4, 1e-3)) ** 2
    damp = 2 * math.sqrt(k_spring) * 1.0  # critically damped: no hem overshoot
    dt = 1.0 / FPS
    passes = 3 if cyclic else 1
    for p in range(passes):
        for i in range(n):
            for bone, tgt in targets[i].items():
                for c in range(2):
                    acc = k_spring * (tgt[c] - state[bone][c]) - damp * vel[bone][c]
                    vel[bone][c] += acc * dt
                    state[bone][c] += vel[bone][c] * dt
            if p == passes - 1:
                out[i] = {b: tuple(v) for b, v in state.items()}
    for (rot, loc), s in zip(frames, out):
        for bone, (pitch, roll) in s.items():
            pitch, roll = max(-cap, min(cap, pitch)), max(-cap, min(cap, roll))
            rot[bone] = Quaternion((1, 0, 0), pitch) @ Quaternion((0, 0, 1), roll)


def hips_world(rig, loc):
    return rig.rest["hips"] @ loc


def set_hips_world(rig, loc, p):
    return rig.rest["hips"].inverted() @ p


def lock_feet(rig, frames, ankle_z, contacts_fn, flat=True):
    """Two-bone IK keeps each planted foot on its contact target (world, metres)."""
    for i, (rot, loc) in enumerate(frames):
        pose = rig.fk(rot, loc)
        for side in ("l", "r"):
            target, w = contacts_fn(i, side, pose)
            if w <= 0:
                continue
            fk_ankle = pose[f"foot_{side}"].translation.copy()
            goal = fk_ankle.lerp(target, w)
            knee = pose[f"calf_{side}"].translation
            pole = knee + Vector((0, -0.4, 0))
            mo.two_bone_ik(rig, pose, rot, loc, f"thigh_{side}", f"calf_{side}", f"foot_{side}", goal, pole)
            if flat:
                foot = pose[f"foot_{side}"]
                toe = pose[f"toes_{side}"].translation - foot.translation
                level = Vector((toe.x, toe.y, toe.z * (1 - w) + (rig.rest[f"toes_{side}"].translation.z - rig.rest[f"foot_{side}"].translation.z) * w))
                q = toe.rotation_difference(level)
                mo.set_world_rotation(rig, pose, rot, loc, f"foot_{side}", q.to_matrix() @ foot.to_3x3())


def retarget_frames(bvh, rt, f0, f1, yaw, straighten=True, info=None):
    rot, pos = bvh.globals(list(range(f0, f1 + 1, 2)))
    if straighten:
        yaws, path, turned = mo.straightened(bvh, rot, pos, yaw)
        # travel along -Y: the chord of the straightened path, not of the original curved one (crab walk)
        yaws, path, chord = lc.align_chord(yaws, path)
        if info is not None:
            info["sourceTurnDegrees"] = round(turned, 1)
            info["chordCorrectionDegrees"] = round(chord, 1)
    else:
        yaws = list(yaw) if isinstance(yaw, (list, tuple)) else [yaw] * len(rot)
        # a per-frame yaw turns the path step by step about the actor, not about the capture origin
        path = lc.incremental_path(bvh, pos, yaws) if isinstance(yaw, (list, tuple)) else [None] * len(rot)
    frames = []
    for i in range(len(rot)):
        r, l, _pose = rt.pose(rot[i], pos[i], float(yaws[i]), path[i])
        frames.append((r, l))
    mo.ensure_continuity(frames)
    return frames


def walk_yaw(bvh, f0, f1):
    _r, pos = bvh.globals([f0, f1])
    d = mo.to_blender_pos(pos[1, bvh.index("Hips")] - pos[0, bvh.index("Hips")])
    # rotate so the walk heads along -Y (Blender forward)
    return math.atan2(d[0], -d[1]) * -1.0


def transition_yaws(bvh, a, b, heading_frames, name, travel_frames=60):
    """Per-frame yaw for a start or stop take: the travel heading while the actor walks, easing to (stop) or
    from (start) the standing facing. One yaw from the standing frames turned the walking part of the take
    off the path: the smith's stop walked in about 50 degrees askew and swung back as it halted, so the
    clip could not meet the walk cycle cleanly. Returns the yaws and the eased turn in degrees."""
    n = len(range(a, b + 1, 2))
    facing = facing_yaw(bvh, *heading_frames)
    travel = walk_yaw(bvh, a, min(b, a + travel_frames)) if name == "walk_stop" else walk_yaw(bvh, max(a, b - travel_frames), b)
    d = (facing - travel + math.pi) % (2 * math.pi) - math.pi
    out = []
    for i in range(n):
        u = i / max(1, n - 1)
        if name == "walk_stop":
            out.append(travel + d * smoothstep((u - 0.4) / 0.35))
        else:
            out.append(facing - d * smoothstep((u - 0.25) / 0.35))
    return out, math.degrees(d)


def facing_yaw(bvh, f0, f1):
    """Yaw that turns the hips' average facing (BVH local +Z) to Blender forward (-Y)."""
    rot, _pos = bvh.globals(list(range(f0, f1 + 1, 10)))
    fwd = rot[:, bvh.index("Hips")] @ np.array([0.0, 0.0, 1.0])
    d = mo.to_blender_pos(fwd.mean(axis=0)) * 100.0
    return -math.atan2(d[0], -d[1])


def correct_head_pitch(rig, frames, target_deg):
    """Raise or lower neck and head by a constant world pitch so the mean gaze sits at target_deg below level
    (the capture actor watched the floor); the motion's own head bob is kept."""
    pitches = []
    for rot, loc in frames:
        pose = rig.fk(rot, loc)
        f = pose["head"].to_3x3() @ (rig.rest["head"].to_3x3().inverted() @ Vector((0, -1, 0)))
        pitches.append(math.degrees(math.asin(max(-1.0, min(1.0, -f.z)))))
    delta = math.radians(float(np.mean(pitches)) - target_deg)
    for rot, loc in frames:
        pose = rig.fk(rot, loc)
        for bone, share in (("neck", 0.4), ("head", 0.6)):
            q = Quaternion((1, 0, 0), -delta * share)
            mo.set_world_rotation(rig, pose, rot, loc, bone, q.to_matrix() @ pose[bone].to_3x3())
    return round(float(np.mean(pitches)), 1)


def add_relaxed_hands(hands, frames, right=RELAXED, left=RELAXED):
    curl = {**hands.curl("l", left, (8, 10, 6)), **hands.curl("r", right, (8, 10, 6))}
    for rot, _loc in frames:
        rot.update(curl)


def detrend(rig, frames, mode):
    """Remove horizontal root travel: 'linear' (cycle), 'mean' (idle) or 'smooth' (transitions)."""
    pts = np.array([list(hips_world(rig, l["hips"])) for _r, l in frames])
    n = len(frames)
    if mode == "linear":
        trend = np.outer(np.linspace(0, 1, n), pts[-1, :2] - pts[0, :2]) + pts[0, :2]
    elif mode == "mean":
        trend = np.tile(pts[:, :2].mean(axis=0), (n, 1))
    else:
        k = 9
        pad = np.pad(pts[:, :2], ((k, k), (0, 0)), mode="edge")
        trend = np.array([pad[i:i + 2 * k + 1].mean(axis=0) for i in range(n)])
    for i, (_r, l) in enumerate(frames):
        p = Vector(pts[i])
        p.x -= trend[i, 0]
        p.y -= trend[i, 1]
        l["hips"] = set_hips_world(rig, l, p)
    travel = trend - trend[0]
    return [float(-travel[i, 1]) for i in range(n)]  # forward (-Y) distance from the first frame


def ground_offset(rig, frames, ankle_z, contact_frames):
    lows = []
    for i, side in contact_frames:
        pose = rig.fk(*frames[i])
        lows.append(pose[f"foot_{side}"].translation.z)
    if not lows:
        return
    dz = ankle_z - float(np.median(lows))
    for _r, l in frames:
        p = hips_world(rig, l["hips"])
        p.z += dz
        l["hips"] = set_hips_world(rig, l, p)


def contacts_from_motion(rig, frames, root_travel, ankle_z, height_tol=0.035, speed_tol=0.35):
    """Contact intervals where a foot is low and moves with the ground (opposite the removed travel)."""
    n = len(frames)
    ank = {s: [] for s in ("l", "r")}
    for rot, loc in frames:
        pose = rig.fk(rot, loc)
        for s in ank:
            ank[s].append(pose[f"foot_{s}"].translation.copy())
    planted = {s: [False] * n for s in ank}
    for s in ank:
        for i in range(n):
            j = min(n - 1, i + 1)
            k = max(0, i - 1)
            ground_v = (root_travel[j] - root_travel[k]) / ((j - k) / FPS) if j != k else 0.0
            v = (ank[s][j] - ank[s][k]) / ((j - k) / FPS) if j != k else Vector()
            rel = Vector((v.x, v.y - ground_v, 0.0)).length  # ground moves +Y when travel is removed
            planted[s][i] = ank[s][i].z < ankle_z + height_tol and rel < speed_tol
        flags = planted[s]
        for i in range(n):  # close one- and two-frame gaps inside a contact
            if not flags[i] and any(flags[max(0, i - 2):i]) and any(flags[i + 1:i + 3]):
                flags[i] = True
    return ank, planted


def make_lock_fn(ank, planted, root_travel, ankle_z, cyclic, ease=4):
    """Foot-lock targets: each contact run plants its foot on one anchor (the lowest frame's ankle, carried
    with the ground) at full weight, and the lock eases in over `ease` frames before landing and out over
    `ease` frames after lift-off, while the foot is in the air. The first version blended over two frames
    inside each contact: the planted foot slid during early contact and snapped up to 7 cm sideways at
    lift-off. In a cyclic clip (whose last frame repeats the first) a contact that runs through the seam is
    one run: split in two it took two anchors and the right foot popped 5.5 cm at the loop seam."""
    n = len(root_travel)
    period = n - 1 if cyclic else n
    stride = (root_travel[-1] - root_travel[0]) if cyclic else 0.0
    anchors = {s: [None] * n for s in ank}
    weights = {s: [0.0] * n for s in ank}
    in_air = {s: [True] * n for s in ank}
    for s in ank:
        flags = list(planted[s][:period])
        if cyclic:
            flags[0] = flags[0] or planted[s][-1]
        runs, i = [], 0
        while i < period:  # runs over unwrapped indices 0..period-1
            if flags[i]:
                j = i
                while j < period and flags[j]:
                    j += 1
                runs.append([i, j - 1])
                i = j
            else:
                i += 1
        if cyclic and len(runs) > 1 and runs[0][0] == 0 and runs[-1][1] == period - 1:
            first = runs.pop(0)
            runs[-1][1] = first[1] + period  # one run through the seam
        if cyclic and len(runs) == 1 and runs[0] == [0, period - 1]:
            runs = []  # never lifted: leave it to the idle-style stance lock
        def travel(u):  # unwrapped frame index -> root travel
            k, cycle = u % period, u // period if cyclic else 0
            return root_travel[k] + cycle * stride
        for a, b in runs:
            seg = list(range(a, b + 1))
            mid = min(seg, key=lambda u: ank[s][u % period].z)
            base = ank[s][mid % period]
            for u in range(a - ease, b + ease + 1):
                if not cyclic and (u < 0 or u >= n):
                    continue
                k = u % period if cyclic else u
                d = (a - u) if u < a else (u - b) if u > b else 0
                w = 1.0 if d == 0 else smoothstep(1.0 - d / (ease + 1.0))
                if w <= weights[s][k]:
                    continue
                shift = travel(u) - travel(mid)
                anchors[s][k] = Vector((base.x, base.y + shift, ankle_z))
                weights[s][k] = w
                in_air[s][k] = d > 0
        if cyclic:  # the last frame repeats the first
            anchors[s][n - 1] = anchors[s][0] + Vector((0.0, stride, 0.0)) if anchors[s][0] is not None else None
            weights[s][n - 1], in_air[s][n - 1] = weights[s][0], in_air[s][0]

    def fn(i, side, pose):
        a = anchors[side][i]
        if a is None:
            return None, 0.0
        if in_air[side][i]:  # easing in or out: keep the swing's own height
            a = Vector((a.x, a.y, pose[f"foot_{side}"].translation.z))
        return a, weights[side][i]
    return fn


# ------------------------------------------------------------------ hammering

def hammer_loop(rig, hands, recipe, anvil_pos, face_h, hammer_len, soles=None, face_local=None):
    """Original keyframed two-strike loop: anticipation, fast strike, rebound, settle, turn the work."""
    spec = recipe["motion"]["hammer"]
    T = spec["seconds"]
    n = int(round(T * FPS)) + 1
    ankle_z = rig.rest["foot_l"].translation.z
    tongs_len = recipe["props"]["tongsLength"]
    # the stock lies flat on the anvil face, gripped by the tongs from the smith's left
    tong_h = Vector((-0.45, -0.89, 0.0)).normalized()
    tilt = math.radians(spec.get("tongsTilt", 14.0))
    tong_dir = (tong_h * math.cos(tilt) + Vector((0, 0, -math.sin(tilt)))).normalized()
    jaws = Vector((anvil_pos.x + 0.07, anvil_pos.y + 0.05, face_h + 0.007))
    strike = jaws + tong_h * 0.11 + Vector((0, 0, 0.007))
    grip_r = hands.grip_matrix("r", spec["hammerGrip"])
    grip_l = hands.grip_matrix("l", spec["tongsGrip"])
    feet = {"l": Vector((0.13, -0.05, ankle_z)), "r": Vector((-0.15, 0.10, ankle_z))}
    shoulder_r = rig.rest["upperarm_r"].translation
    fwd = (strike - shoulder_r)
    fwd = Vector((fwd.x, fwd.y, 0.0)).normalized()
    up = Vector((0, 0, 1))

    def key(t, keys):
        """Piecewise smooth interpolation of (time, value) keys; cyclic over T."""
        ts = [k[0] for k in keys]
        t = t % T
        for a in range(len(keys) - 1):
            if ts[a] <= t <= ts[a + 1]:
                u = (t - ts[a]) / max(1e-6, ts[a + 1] - ts[a])
                ease = keys[a + 1][2] if len(keys[a + 1]) > 2 else "smooth"
                if ease == "in":
                    u = u ** 2.2
                elif ease == "out":
                    u = 1 - (1 - u) ** 2
                else:
                    u = smoothstep(u)
                va, vb = keys[a][1], keys[a + 1][1]
                return va + (vb - va) * u
        return keys[-1][1]

    # strike A (heavy) and B (lighter), then a turn of the work with the tongs. Each backswing starts from rest with a
    # smooth ease (the first version eased 'out' from rest, a velocity jump at the loop seam: the forearm turned 44
    # degrees in the first frame); the downswing accelerates into the impact and rebounds off it.
    # impacts land exactly on frames (19 and 49 at 30 fps): between frames the face never reached the work
    IA, IB = 19 / FPS, 49 / FPS
    phi = [(0.0, -2.0), (0.40, 92.0), (0.50, 98.0), (IA, -6.0, "in"), (0.70, 4.0, "out"), (0.80, 0.0),
           (1.10, 8.0), (1.42, 70.0), (1.50, 74.0), (IB, -5.0, "in"), (1.68, 4.0, "out"), (1.80, 0.0),
           (2.30, -2.0), (T, -2.0)]
    lift = [(0.0, 0.03), (0.40, 0.44), (0.50, 0.47), (IA, 0.0, "in"), (0.70, 0.04, "out"), (0.80, 0.02),
            (1.10, 0.06), (1.42, 0.34), (1.50, 0.36), (IB, 0.0, "in"), (1.68, 0.035, "out"), (1.80, 0.02),
            (2.30, 0.03), (T, 0.03)]
    back = [(0.0, 0.0), (0.45, 0.16), (IA, 0.0, "in"), (1.10, 0.0), (1.46, 0.12), (IB, 0.0, "in"), (T, 0.0)]
    flex = [(0.0, 16.0), (0.45, 10.0), (IA, 23.0, "in"), (0.9, 18.0), (1.46, 12.0), (IB, 22.0, "in"), (1.9, 17.0), (2.3, 18.0), (T, 16.0)]
    twist = [(0.0, 0.0), (0.45, -9.0), (IA, 3.0, "in"), (0.9, 0.0), (1.46, -6.0), (IB, 2.0, "in"), (2.0, 0.0), (T, 0.0)]
    sink = [(0.0, 0.035), (0.45, 0.02), (IA + 0.02, 0.05, "in"), (0.9, 0.035), (1.46, 0.025), (IB + 0.02, 0.048, "in"), (2.0, 0.035), (T, 0.035)]
    # a turn of the work between strike pairs; the return eases out over 0.32 s so the loop seam carries no turn
    # (round 1 returned 38 degrees in 0.15 s: hand_l turned 6.3 degrees in the loop's last frame and 0.1 in its first)
    turn = [(0.0, 0.0), (1.8, 0.0), (1.97, 32.0), (2.07, 32.0), (T, 0.0)]
    impacts = (IA, IB)

    # the impact pose of the hammer: prop frame butt at the origin, handle +Y, striking face toward -Z; the face centre
    # (hammerFaceLocal, measured from the model) lands exactly on the strike point at the top of the stock
    face_local = Vector(face_local or (0.0, hammer_len - 0.02, -0.045))
    ph_imp = math.radians(-6.0)
    handle_imp = (fwd * math.cos(ph_imp) + up * math.sin(ph_imp)).normalized()
    face_imp = -(up * math.cos(ph_imp) - fwd * math.sin(ph_imp)).normalized()
    hx_imp = handle_imp.cross(-face_imp).normalized()
    rot_imp = Matrix((hx_imp, handle_imp, hx_imp.cross(handle_imp).normalized())).transposed()
    H_imp = Matrix.Translation(strike - rot_imp @ face_local) @ rot_imp.to_4x4()
    wrist_impact = (H_imp @ grip_r.inverted()).translation
    frames = []
    hammer_world = []
    for i in range(n):
        t = i / FPS
        rot = {}
        loc = {}
        # pelvis: lowered stance, weight forward into the strike
        hips_rest = rig.rest["hips"].translation
        p = Vector((hips_rest.x - 0.01, hips_rest.y + 0.035, hips_rest.z - key(t, sink)))
        loc["hips"] = rig.rest["hips"].inverted() @ p
        pose = rig.fk(rot, loc)
        q = Quaternion((0, 0, 1), math.radians(key(t, twist) * 0.4)) @ Quaternion((1, 0, 0), math.radians(5.0))
        mo.set_world_rotation(rig, pose, rot, loc, "hips", q.to_matrix() @ pose["hips"].to_3x3())
        # spine: forward flex toward the anvil and a twist opening the right shoulder in the backswing
        for bone, share in (("spine_01", 0.35), ("spine_02", 0.35), ("spine_03", 0.3)):
            q = Quaternion((0, 0, 1), math.radians(key(t, twist) * share)) @ Quaternion((1, 0, 0), math.radians(key(t, flex) * share))
            world = q.to_matrix() @ pose[bone].to_3x3()
            mo.set_world_rotation(rig, pose, rot, loc, bone, world)
        raise_r = key(t, lift) / 0.55
        q = Quaternion(Vector((0, 1, 0)), math.radians(12.0 * raise_r))
        mo.set_world_rotation(rig, pose, rot, loc, "clavicle_r", q.to_matrix() @ pose["clavicle_r"].to_3x3())
        # hammer: pitch angle of the handle in the strike plane; face down at impact
        ph = math.radians(key(t, phi))
        handle = (fwd * math.cos(ph) + up * math.sin(ph)).normalized()
        face = -(up * math.cos(ph) - fwd * math.sin(ph)).normalized()
        hz = -face
        hx = handle.cross(hz).normalized()
        hz = hx.cross(handle).normalized()
        hrot = Matrix((hx, handle, hz)).transposed()
        # the wrist follows an arc above its impact position; the hammer pitches through the grip
        hand_rot = hrot @ grip_r.to_3x3().inverted()
        wrist = wrist_impact + up * key(t, lift) - fwd * key(t, back)
        hand_r = Matrix.Translation(wrist) @ hand_rot.to_4x4()
        H = hand_r @ grip_r
        hammer_world.append(H)
        target = hand_r.translation
        elbow_pole = rig.rest["upperarm_r"].translation + Vector((-0.35, 0.25, -0.15 + 0.35 * raise_r))
        mo.two_bone_ik(rig, pose, rot, loc, "upperarm_r", "forearm_r", "hand_r", target, elbow_pole)
        mo.set_world_rotation(rig, pose, rot, loc, "hand_r", hand_r.to_3x3())
        # tongs: jaws hold the cold end on the anvil; a quarter turn between strike pairs
        tz = Vector((0, 0, 1))
        tx = tong_dir.cross(tz).normalized()
        tz = tx.cross(tong_dir).normalized()
        trot = Quaternion(tong_dir, math.radians(key(t, turn))).to_matrix() @ Matrix((tx, tong_dir, tz)).transposed()
        T_world = Matrix.Translation(jaws - tong_dir * (tongs_len - 0.02)) @ trot.to_4x4()
        if i == 0:
            bar_rot = Matrix((tong_h.cross(Vector((0, 0, 1))).normalized(), tong_h, Vector((0, 0, 1)))).transposed()
            bar_world = Matrix.Translation(jaws + tong_h * 0.085) @ bar_rot.to_4x4()
            workpiece_local = T_world.inverted() @ bar_world
        hand_l = T_world @ grip_l.inverted()
        mo.two_bone_ik(rig, pose, rot, loc, "upperarm_l", "forearm_l", "hand_l", hand_l.translation,
                       rig.rest["upperarm_l"].translation + Vector((0.35, 0.2, -0.25)))
        mo.set_world_rotation(rig, pose, rot, loc, "hand_l", hand_l.to_3x3())
        # head keeps the work in view
        for bone, share in (("neck", 0.45), ("head", 0.55)):
            hp = pose[bone].translation
            look = (strike - hp).normalized()
            fwd_probe = pose["head"].to_3x3() @ (rig.rest["head"].to_3x3().inverted() @ Vector((0, -1, 0)))
            q = fwd_probe.rotation_difference(look)
            q = Quaternion().slerp(q, share * 0.8)
            mo.set_world_rotation(rig, pose, rot, loc, bone, q.to_matrix() @ pose[bone].to_3x3())
        # legs: planted stance, both feet flat on the ground (a striking stance: the left foot forward, toes out)
        for side in ("l", "r"):
            knee = pose[f"calf_{side}"].translation
            lc.plant_flat(rig, soles, pose, rot, loc, side, feet[side], math.radians(12 if side == "l" else -16),
                          pole=knee + Vector((0.08 if side == "l" else -0.06, -0.4, 0)))
        frames.append((rot, loc))
    curl = {**hands.curl("r", GRIP, (40, 35, 25)), **hands.curl("l", GRIP, (40, 35, 25))}
    for rot, _l in frames:
        rot.update(curl)
    # contact check on the exported frames: where the face centre is at each impact, and that the hand holds the
    # handle (near the butt) and not the head
    checks = []
    head_c = Vector((0.0, hammer_len - 0.03, -0.02))
    for t_imp in impacts:
        k = int(round(t_imp * FPS))
        pose = rig.fk(*frames[k])
        H = pose["hand_r"] @ grip_r
        face_w = H @ face_local
        palm = pose["hand_r"] @ (rig.rest["hand_r"].inverted() @ hands.frames["r"]["centre"])
        checks.append({"seconds": t_imp, "faceToStrikeCm": round((face_w - strike).length * 100, 2),
                       "faceAboveStrikeCm": round((face_w.z - strike.z) * 100, 2),
                       "palmToButtCm": round((palm - H @ Vector((0.0, 0.0, 0.0))).length * 100, 1),
                       "palmToHeadCm": round((palm - H @ head_c).length * 100, 1)})
    return frames, grip_r, grip_l, {"impactSeconds": list(impacts), "strike": list(strike), "feet": {k: list(v) for k, v in feet.items()},
                                    "anvil": list(anvil_pos), "jaws": list(jaws), "workpieceLocal": [list(r) for r in workpiece_local],
                                    "impactChecks": checks}


def talk_from_idle(frames, recipe):
    """Head beats and jaw syllables over the idle so a conversation reads without visemes."""
    out = []
    n = len(frames)
    for i, (rot, loc) in enumerate(frames):
        t = i / FPS
        r = dict(rot)
        nod = math.sin(t * 2 * math.pi * 0.9) * 2.5 + math.sin(t * 2 * math.pi * 2.1 + 0.6) * 1.2
        r["head"] = rot.get("head", Quaternion()) @ Quaternion((1, 0, 0), math.radians(nod * 0.6))
        syll = max(0.0, math.sin(t * 2 * math.pi * 3.7) * 0.6 + math.sin(t * 2 * math.pi * 5.3 + 1.0) * 0.4)
        r["face_jaw"] = Quaternion((1, 0, 0), math.radians(9.0 * syll * smoothstep(min(t, (n - 1) / FPS - t) / 0.3)))
        out.append((r, dict(loc)))
    return out


def face_clips(rig, cal=None):
    """Tier A joint demonstration clips (local X pitch, local Z yaw in Blender = local Y in glTF), keyed on the seven
    face joints only. `cal` is the measured LOD head calibration (face_rig.calibrate): the lid angles that close the
    proxy head's eyes and the jaw angle of a full opening."""
    lid_u = cal["upperLidClosed"] if cal else math.radians(31.0)
    lid_l = cal["lowerLidClosed"] if cal else math.radians(-9.0)
    jaw_open = cal["jawOpen"] if cal else math.radians(16.0)

    def blink(t):
        if t < 0.08:
            return (t / 0.08) ** 2
        if t < 0.12:
            return 1.0
        if t < 0.27:
            return 1 - smoothstep((t - 0.12) / 0.15)
        return 0.0
    clips = {}
    frames = []
    for i in range(int(0.6 * FPS) + 1):
        b = blink(i / FPS)
        frames.append(({"face_lid_upper_l": Quaternion((1, 0, 0), lid_u * b), "face_lid_upper_r": Quaternion((1, 0, 0), lid_u * b),
                        "face_lid_lower_l": Quaternion((1, 0, 0), lid_l * b), "face_lid_lower_r": Quaternion((1, 0, 0), lid_l * b)}, {}))
    clips["face_blink"] = frames
    frames = []
    gaze = [(0.0, 0, 0), (0.4, 0, 0), (0.55, 22, 0), (1.3, 22, 0), (1.45, -22, 0), (2.2, -22, 0), (2.35, 0, -14), (3.1, 0, -14), (3.25, 0, 0), (3.6, 0, 0)]
    for i in range(int(3.6 * FPS) + 1):
        t = i / FPS
        for a in range(len(gaze) - 1):
            if gaze[a][0] <= t <= gaze[a + 1][0]:
                u = smoothstep((t - gaze[a][0]) / (gaze[a + 1][0] - gaze[a][0]))
                yaw = gaze[a][1] + (gaze[a + 1][1] - gaze[a][1]) * u
                pitch = gaze[a][2] + (gaze[a + 1][2] - gaze[a][2]) * u
                break
        q = Quaternion((1, 0, 0), math.radians(pitch)) @ Quaternion((0, 0, 1), math.radians(yaw))
        follow = Quaternion((1, 0, 0), math.radians(pitch) * 0.5)
        frames.append(({"face_eye_l": q, "face_eye_r": q, "face_lid_upper_l": follow, "face_lid_upper_r": follow}, {}))
    clips["face_gaze"] = frames
    frames = []
    for i in range(int(1.2 * FPS) + 1):
        t = i / FPS
        o = smoothstep(t / 0.25) * (1 - smoothstep((t - 0.75) / 0.3))
        frames.append(({"face_jaw": Quaternion((1, 0, 0), jaw_open * o)}, {}))
    clips["face_jaw"] = frames
    return clips


GESTURE_BONES = ("clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r", "forearm_l", "forearm_r", "hand_l", "hand_r")


def damp_gestures(frames, ref_rot, name, low=0.25, head_low=0.5):
    """The 100STYLE idle takes that supply the start and stop transitions contain the actors' own arm
    gestures (an arm raised forward to shoulder height, the head thrown back), which read as pointing.
    Pull the arms (and less strongly the neck and head) toward the idle's first pose in the still part of
    each transition; walk_start regains the full captured swing over its last stretch so it meets the
    walk cycle, and walk_stop keeps it only while still walking."""
    n = len(frames)
    for i, (rot, _loc) in enumerate(frames):
        u = i / max(1, n - 1)
        ramp = smoothstep((u - 0.6) / 0.3) if name == "walk_start" else 1.0 - smoothstep((u - 0.15) / 0.25)
        for b in GESTURE_BONES + ("neck", "head"):
            if b not in rot or b not in ref_rot:
                continue
            floor = head_low if b in ("neck", "head") else low
            a = floor + (1.0 - floor) * ramp
            q = rot[b] if rot[b].dot(ref_rot[b]) >= 0 else -rot[b]
            rot[b] = ref_rot[b].slerp(q, a)


def synth_stop(rig, walk, idle, speed, ankle_z, seconds=1.6, blend=(0.3, 1.2)):
    """walk_stop built from the resident's own walk cycle and idle: the walk plays from its first frame
    (where the actor owner leaves the cycle) while every bone eases into the idle's first pose and the root
    decelerates with the same weight; the feet are then planted from the motion and the end matches the
    idle exactly. None of the 100STYLE stand-still takes stops straight: every actor turns about 180
    degrees while slowing (the smith's take walked in facing away and swung round as it halted, and its
    travel ran backward), so captured stops could not meet the walk or follow the resident's path.
    Returns frames, forward root travel per frame and the planted-foot flags."""
    n = int(round(seconds * FPS)) + 1
    nw = len(walk) - 1
    ir, il = idle[0]
    frames, trav = [], [0.0]
    for i in range(n):
        w = smoothstep((i / FPS - blend[0]) / (blend[1] - blend[0]))
        wr, wl = walk[i % nw]
        rot = {b: q.copy() for b, q in wr.items()}
        loc = {b: v.copy() for b, v in wl.items()}
        for b in rot:
            if b in ir:
                q = ir[b] if rot[b].dot(ir[b]) >= 0 else -ir[b]
                rot[b] = rot[b].slerp(q, w)
        for b in loc:
            if b in il:
                loc[b] = loc[b].lerp(il[b], w)
        frames.append((rot, loc))
        if i:
            trav.append(trav[-1] + speed * (1.0 - w) / FPS)
    ankt, plt = contacts_from_motion(rig, frames, trav, ankle_z, height_tol=0.05)
    lock_feet(rig, frames, ankle_z, make_lock_fn(ankt, plt, trav, ankle_z, False))
    skirt_follow(rig, frames, cyclic=False)
    blend_into(frames, [idle[k] for k in range(8)], 8, at_end=True)
    return frames, trav, plt


def blend_into(frames, target, count, at_end=True, skip=()):
    """Blend the first/last `count` frames into target frames so clip boundaries match exactly (bones in `skip` keep
    their own rotations)."""
    n = len(frames)
    for k in range(count):
        i = n - count + k if at_end else k
        w = smoothstep((k + 1) / count) if at_end else smoothstep(1 - k / count)
        rot, loc = frames[i]
        trot, tloc = target[k] if at_end else target[k]
        for b in list(rot):
            if b in trot and b not in skip:
                q = trot[b] if rot[b].dot(trot[b]) >= 0 else -trot[b]
                rot[b] = rot[b].slerp(q, w)
        for b in list(loc):
            if b in tloc:
                loc[b] = loc[b].lerp(tloc[b], w)


def smooth_legs(frames, bones=("thigh_l", "thigh_r", "calf_l", "calf_r"), passes=2):
    """Low-pass the hips and knees of a one-shot clip (round 2: the child's walk_start knee extended at about 900
    degrees a second and stopped dead at heel strike; walk_stop's knees were still turning 8 to 10 degrees a frame
    where it met the static idle). The first and last two frames are kept so the joins stay exact; the feet keep
    their own rotations, so ground contact is untouched."""
    n = len(frames)
    for _p in range(passes):
        src = [{b: frames[i][0][b].copy() for b in bones if b in frames[i][0]} for i in range(n)]
        for i in range(2, n - 2):
            for b, q in src[i].items():
                qa, qb = src[i - 1].get(b, q), src[i + 1].get(b, q)
                acc = q * 0.5 + (qa if qa.dot(q) >= 0 else -qa) * 0.25 + (qb if qb.dot(q) >= 0 else -qb) * 0.25
                acc.normalize()
                frames[i][0][b] = acc


LEGS = ("thigh_l", "thigh_r", "calf_l", "calf_r", "foot_l", "foot_r", "toes_l", "toes_r")


def ground_clamp(rig, soles, frames, ground=None):
    """Lift any foot whose lowest sole point is below the ground back onto it (ankle by IK, foot rotation kept)."""
    ground = lc.GROUND if ground is None else ground
    lifted = 0.0
    for rot, loc in frames:
        pose = rig.fk(rot, loc)
        for s in ("l", "r"):
            low = min(p.z for p in soles.points(pose, s).values())
            if low >= ground - 1e-5:
                continue
            foot_rot = pose[f"foot_{s}"].to_3x3()
            goal = pose[f"foot_{s}"].translation + Vector((0.0, 0.0, ground - low))
            knee = pose[f"calf_{s}"].translation
            mo.two_bone_ik(rig, pose, rot, loc, f"thigh_{s}", f"calf_{s}", f"foot_{s}", goal, knee + Vector((0.0, -0.4, 0.0)))
            mo.set_world_rotation(rig, pose, rot, loc, f"foot_{s}", foot_rot)
            lifted = max(lifted, ground - low)
    return lifted


def seal_locomotion_joins(rig, soles, walk, idle, start, stop, start_trav, stop_trav, count=6):
    """Round 2: the joins to the walk and idle met within 3 degrees (walk_stop's first frame had its own foot lock, 2.9
    degrees at the left foot); ease the first and last `count` frames of walk_start and walk_stop into the frames of the
    clip they join (the idle's and walk's frames around their first frame), so each join is exact and its velocity
    carries across. The legs are not blended by joint angle (that slid and sank a planted foot up to 1.4 cm into the
    ground): the feet blend by position and rotation, solved by IK and carried with the root travel
    (locomotion.blend_legs_to), and any sole point left below the ground is lifted back onto it."""
    pw, pi = len(walk) - 1, len(idle) - 1
    smooth_legs(start)
    smooth_legs(stop)
    blend_into(start, [idle[k] for k in range(count)], count, at_end=False, skip=LEGS)
    blend_into(start, [walk[(pw - count + 1 + k) % pw] for k in range(count - 1)] + [walk[0]], count, at_end=True, skip=LEGS)
    blend_into(stop, [walk[k] for k in range(count)], count, at_end=False, skip=LEGS)
    blend_into(stop, [idle[(pi - count + 1 + k) % pi] for k in range(count - 1)] + [idle[0]], count, at_end=True, skip=LEGS)
    lc.blend_legs_to(rig, start, idle[0], count, at_end=False, travel=list(start_trav))
    lc.blend_legs_to(rig, start, walk[0], count, at_end=True, travel=list(start_trav))
    lc.blend_legs_to(rig, stop, walk[0], count, at_end=False, travel=list(stop_trav))
    lc.blend_legs_to(rig, stop, idle[0], count, at_end=True, travel=list(stop_trav))
    for clip, a, b in ((start, idle[0], walk[0]), (stop, walk[0], idle[0])):
        ground_clamp(rig, soles, clip)
        clip[0] = lc.copy_frame(a)
        clip[-1] = lc.copy_frame(b)


def run(ctx):
    if ctx["recipe"]["motion"].get("kit", "smith") != "smith":
        import motion_household
        return motion_household.run(ctx)
    src, recipe, report = ctx["src"], ctx["recipe"], ctx["report"]
    arm = bpy.data.objects["Rig"]
    rig = mo.Rig(arm)
    hands = Hands(rig)
    soles = lc.Soles(rig)
    ankle_z = rig.rest["foot_l"].translation.z
    spec = recipe["motion"]
    base = src["style100"]
    face_cal = face_rig.run(arm, recipe, report)  # LOD1/Quest head lid and lip weights, measured calibration
    rep = report.setdefault("motion", {})
    clips = {}

    # ---- walk: best loopable left-foot cycle of Neutral_FW
    fw = mo.BVH(os.path.join(base, "Neutral", "Neutral_FW.bvh"))
    rt = mo.Retarget(fw, rig)
    w0, w1 = spec["walk"]["frames"]
    yaw = walk_yaw(fw, w0, w1)
    winfo = {}
    walk = retarget_frames(fw, rt, w0, w1, yaw, info=winfo)
    seam_before = mo.seam_degrees(walk)
    travel = detrend(rig, walk, "linear")
    mo.close_loop(walk)
    walk = lc.align_left_forward(rig, walk)  # every walk starts at left heel strike (walk_stop leaves from here)
    add_relaxed_hands(hands, walk)
    winfo["sourceHeadPitchDegrees"] = correct_head_pitch(rig, walk, spec["walk"].get("headPitch", 7.0))
    mo.close_loop(walk)
    stride = travel[-1]
    travel = [stride * i / (len(walk) - 1) for i in range(len(walk))]
    windows = lc.lock_walk_cycle(rig, soles, walk, travel, winfo)
    skirt_follow(rig, walk)
    walk[-1] = lc.copy_frame(walk[0])  # exact loop
    clips["walk"] = walk
    rep["walk"] = {"source": f"100STYLE Neutral_FW frames {w0}-{w1} (60 fps), every second frame", "seconds": (len(walk) - 1) / FPS,
                   "strideMetres": round(stride, 3), "speedMetresPerSecond": round(stride / ((len(walk) - 1) / FPS), 3),
                   "sourceSeamDegrees": round(seam_before, 2), **winfo,
                   "contactFrames": {s: sorted({u % (len(walk) - 1) for a, b in windows[s] for u in range(a, b + 1)}) for s in windows}}

    # ---- idle and transitions from Neutral_ID (walk in, stand, walk off)
    idb = mo.BVH(os.path.join(base, "Neutral", "Neutral_ID.bvh"))
    rti = mo.Retarget(idb, rig)
    i0, i1 = spec["idle"]["frames"]
    stand_yaw = facing_yaw(idb, i0, i1)
    idle = retarget_frames(idb, rti, i0, i1, stand_yaw, straighten=False)
    seam_idle = mo.seam_degrees(idle)
    detrend(rig, idle, "mean")
    add_relaxed_hands(hands, idle)
    idle_pitch = correct_head_pitch(rig, idle, spec["idle"].get("headPitch", 4.0))
    mo.close_loop(idle)
    ground_offset(rig, idle, ankle_z, [(i, s) for i in range(0, len(idle), 5) for s in ("l", "r")])
    stance_h = it.stance_from_walk(rig, soles, walk, windows, spec["walk"].get("toeOutDeg", 7.0))
    layer = it.ground_idle(rig, soles, idle, stance_h, shift_side=spec["idle"].get("shiftSide", "r"), style=it.IDLE_STYLES["smith"])
    skirt_follow(rig, idle)
    clips["idle"] = idle
    rep["idle"] = {"source": f"100STYLE Neutral_ID frames {i0}-{i1} (60 fps), every second frame; feet planted flat on the "
                             "walk's stance, sway and a weight shift added (Crownfall)", "seconds": (len(idle) - 1) / FPS,
                   "sourceSeamDegrees": round(seam_idle, 2), "sourceHeadPitchDegrees": idle_pitch,
                   "stance": {s: [round(stance_h[s][0].x, 4), round(stance_h[s][0].y, 4), round(math.degrees(stance_h[s][1]), 1)] for s in stance_h},
                   **layer}
    stop_info = {}
    stop, stop_trav, _plt = lc.synth_stop(rig, soles, walk, travel, windows, idle[0], stance_h, rep["walk"]["speedMetresPerSecond"],
                                          report=stop_info)
    skirt_follow(rig, stop, cyclic=False)
    clips["walk_stop"] = stop
    rep["walk_stop"] = {"source": "the resident's walk with a planted last step and a closing step onto the idle stance (Crownfall); "
                                  "see locomotion.synth_stop", "seconds": (len(stop) - 1) / FPS,
                        "rootTravelMetres": [round(x, 4) for x in stop_trav], **stop_info}
    start_info = {}
    start, start_trav, _splt = lc.synth_start(rig, soles, walk, travel, windows, idle[0], stance_h, rep["walk"]["speedMetresPerSecond"],
                                              report=start_info)
    skirt_follow(rig, start, cyclic=False)
    clips["walk_start"] = start
    rep["walk_start"] = {"source": "the second half of the resident's walk cycle faded in over its idle with real steps from the idle "
                                   "stance (Crownfall); see locomotion.synth_start", "seconds": (len(start) - 1) / FPS,
                         "rootTravelMetres": [round(x, 4) for x in start_trav], **start_info}

    seal_locomotion_joins(rig, soles, walk, idle, start, stop, start_trav, stop_trav)

    # ---- hammering at the anvil (original keyframes)
    anvil = bpy.data.objects["prop_anvil"]
    hammer = bpy.data.objects["prop_hammer"]
    face_h = recipe["props"]["anvilFaceHeight"]
    hammer_len = report["props"]["hammerLength"]
    work, grip_r, grip_l, info = hammer_loop(rig, hands, recipe, Vector(anvil.location), face_h, hammer_len, soles,
                                             face_local=report["props"].get("hammerFaceLocal"))
    skirt_follow(rig, work)
    clips["work_hammer"] = work
    rep["work_hammer"] = {"source": "original keyframes (Crownfall), IK at the anvil", "seconds": (len(work) - 1) / FPS, **info}
    # hand props: grips are exported as sockets in the props GLB (see stage_export)
    for obj, bone, grip in ((hammer, "hand_r", grip_r), (bpy.data.objects["prop_tongs"], "hand_l", grip_l)):
        obj["grip_bone"] = bone
        obj["grip_matrix"] = [v for row in grip for v in row]
    wp = bpy.data.objects["prop_workpiece"]
    wp.parent = bpy.data.objects["prop_tongs"]
    wp.matrix_parent_inverse.identity()
    wl = info["workpieceLocal"]
    wp.matrix_basis = Matrix(wl)
    rep["grips"] = {"hand_r": [list(r) for r in grip_r], "hand_l": [list(r) for r in grip_l]}

    # work entry and exit with the hammer and tongs taken from and put back on the anvil (round 2)
    import transitions as tr
    tclips, swaps, rests, targets = tr.smith(rig, soles, idle[0], work[0], {"prop_hammer": grip_r, "prop_tongs": grip_l}, info,
                                             {"prop_hammer": hammer, "prop_tongs": bpy.data.objects["prop_tongs"], "prop_workpiece": wp}, recipe)
    clips.update(tclips)
    g = {"prop_hammer": grip_r, "prop_tongs": grip_l}
    for name in ("work_enter", "work_exit"):
        rep[name] = {"source": "original keyframes (Crownfall): " + ("from the idle into the striking stance, the tongs and hammer "
                     "taken from the anvil" if name == "work_enter" else "from the work loop's first frame back to the idle, the hammer "
                     "and tongs laid on the anvil"), "seconds": (len(tclips[name]) - 1) / FPS,
                     "propSwaps": tr.check_swaps_any(rig, tclips[name], swaps[name], g, targets)}
    rep["propSwaps"] = swaps
    rep["restProps"] = sorted(o.name for o in rests.values())
    clips["talk"] = it.talk_frames(rig, hands, soles, idle, stance_h, "smith")
    skirt_follow(rig, clips["talk"])
    clips.update(face_clips(rig, face_cal))

    # write in a stable order
    body_bones = [b.name for b in arm.data.bones if not b.name.startswith("face_") and b.name not in BODY_SKIP]
    face_bones = [b.name for b in arm.data.bones if b.name.startswith("face_")]
    written = []
    for name in ("idle", "walk", "walk_start", "walk_stop", "work_hammer", "work_enter", "work_exit", "talk", "face_blink", "face_gaze", "face_jaw"):
        # body clips never key the face joints: speech and blinks come from the face rig (face-performance.ts), so a
        # clip cannot fight it for the jaw (the talk clip's syllables were erased by the rig every frame)
        allowed = face_bones if name.startswith("face_") else body_bones
        written.append(mo.write_clip(arm, name, clips[name], FPS, bones=set(allowed)))
    rep["clips"] = written

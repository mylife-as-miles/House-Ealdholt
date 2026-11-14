"""Role loops for the crowd clip libraries (original Crownfall code, motion builder).

Every role loop is authored once, in metres for the adult-man reference body, as a function of time that returns pose
goals; positions are multiplied by the archetype's body scale (stature / 173.5 cm) and solved on the archetype's
reference skeleton with the household IK (two-bone arms and legs, feet planted flat on their own ankle points, spine
flex and twist, look-at). So one description serves every archetype that uses the loop, and every resident bound to the
archetype skeleton plays it exactly.

* Goals per frame: pelvis offset and turn, spine flex/twist/side, each foot's ankle point and heading (planted, or
  lifted on a step arc), each hand (a palm placement, a point on a tool shaft, or riding a tool through a fixed grip),
  the head's look target and finger curls. Keys are interpolated by a periodic Catmull-Rom spline, so loops carry their
  velocity through every key and across the seam (frame 0 = last frame).
* Tools are rigid props in a fixed grip in the primary hand (hand-local matrix, the household socket convention); the
  second hand of a two-handed tool takes the shaft where the tool puts it. Contacts (a blade on the ground, the axe on the
  log) are authored on the tool, so the prop meets its target and the hands meet the prop by construction; the solver
  reports any hand that could not reach its goal (handErrorCm in the manifest).
* Carry walks and the guard patrol keep `walk`'s legs and timing exactly (switch at matching phase), with the arms holding
  the load in the chest's frame. Sowing walks slowly on `walk` played at half speed.
* Every standing or crouching loop gets `<clip>_enter` (from the hub) and `<clip>_exit` (back to the hub); every seated
  loop enters and exits from the seated rest `sit` (transitions.transition_clip: feet step between stances, ends exact).

Prop frames (the contract the prop kit models to; Blender axes, metres): origin at the butt of the handle, +Y along the
handle toward the working end, -Z the working face (the knuckle side of the primary hand). PROP_CONTRACTS lists each
prop's dimensions and named points; the manifest carries each clip's grips.
"""
import math

import numpy as np
from mathutils import Matrix, Quaternion, Vector

import locomotion as lc
import motion as mo
import motion_household as MH
import motion_library as ML
import stage_motion as SM
import transitions as tr

FPS = 30
RELAXED, GRIP = SM.RELAXED, SM.GRIP
PINCH = {"index": (40, 50, 30), "middle": (50, 60, 35), "ring": (60, 70, 40), "pinky": (70, 75, 45)}
OPEN = {"index": (4, 6, 4), "middle": (5, 7, 5), "ring": (6, 8, 5), "pinky": (8, 9, 6)}
CUP = {"index": (25, 30, 20), "middle": (28, 32, 22), "ring": (30, 34, 24), "pinky": (32, 36, 26)}
FIST = {"index": (75, 85, 50), "middle": (80, 88, 52), "ring": (82, 88, 54), "pinky": (84, 90, 56)}
POINT = {"index": (4, 6, 4), "middle": (75, 85, 50), "ring": (82, 88, 54), "pinky": (84, 90, 56)}
CURLS = {"relaxed": (RELAXED, (8, 10, 6)), "grip": (GRIP, (40, 35, 25)), "pinch": (PINCH, (30, 30, 20)),
         "open": (OPEN, (2, 4, 2)), "cup": (CUP, (14, 14, 10)), "fist": (FIST, (45, 40, 30)), "point": (POINT, (40, 35, 25))}

# ------------------------------------------------------------------ prop contracts (Blender axes, metres)

PROP_CONTRACTS = {
    "hoe": {"length": 1.25, "points": {"blade_edge": [0.0, 1.25, -0.15]}, "note": "draw hoe: blade at the head end, perpendicular to the shaft along -Z, 0.15 m"},
    "broom": {"length": 1.3, "points": {"head_end": [0.0, 1.3, 0.0]}, "note": "besom: twig head occupies the last 0.35 m (+Y end)"},
    "axe": {"length": 0.8, "points": {"edge": [0.0, 0.8, -0.1]}, "note": "head at +Y end, cutting edge along -Z 0.1 m from the shaft axis"},
    "spear": {"length": 2.2, "points": {"point": [0.0, 2.2, 0.0]}, "note": "origin at the butt (rests on the ground), point at +Y"},
    "crook": {"length": 1.6, "points": {"hook": [0.0, 1.6, 0.0]}, "note": "origin at the ground tip, crook hook at +Y end"},
    "walking-staff": {"length": 1.55, "points": {"top": [0.0, 1.55, 0.0]}, "note": "origin at the ground tip"},
    "ladle": {"length": 1.15, "points": {"blade": [0.0, 1.15, 0.0]}, "note": "stirring paddle: origin at the top end, blade 0.25 m at +Y end"},
    "saw": {"length": 0.62, "points": {"teeth_start": [0.0, -0.06, -0.1], "teeth_end": [0.0, -0.06, -0.62]},
            "note": "origin at the handle grip; blade runs along -Z from 0.08 to 0.62 m, teeth on the -Y edge"},
    "sickle": {"length": 0.5, "points": {"blade_mid": [0.0, 0.3, -0.18]}, "note": "origin at the handle butt, crescent blade toward -Z"},
    "oven-peel": {"length": 1.6, "points": {"blade": [0.0, 1.6, 0.0]}, "note": "origin at the handle end, flat blade 0.3 m at +Y"},
    "mallet": {"length": 0.32, "points": {"face": [0.0, 0.3, -0.06]}, "note": "household mallet frame"},
    "chisel": {"length": 0.22, "points": {"edge": [0.0, 0.22, 0.0]}, "note": "origin at the struck end, edge at +Y"},
    "cleaver": {"length": 0.32, "points": {"edge": [0.0, 0.25, -0.07]}, "note": "origin at the handle butt, blade edge along -Z"},
    "hammer-small": {"length": 0.3, "points": {"face": [0.0, 0.28, -0.04]}, "note": "household hammer frame (butt at origin, face -Z)"},
    "book": {"length": 0.24, "points": {}, "note": "closed size 0.24 x 0.17 x 0.05; held open at the spine in the left hand"},
    "mortar-pestle": {"length": 0.24, "points": {}, "note": "two parts: mortar bowl (hand_l, 0.14 dia) and pestle (hand_r, 0.2 long)"},
    "bucket": {"length": 0.35, "points": {}, "note": "origin at the handle top, bucket hangs along -Z"},
    "small-bucket": {"length": 0.25, "points": {}, "note": "origin at the handle top, bucket hangs along -Z"},
    "basket": {"length": 0.4, "points": {}, "note": "hip basket: origin at the rim held by the hand"},
    "sack": {"length": 0.6, "points": {}, "note": "grain sack on the shoulder, origin at the hand hold"},
    "water-yoke": {"length": 1.1, "points": {}, "note": "yoke across both shoulders, buckets hang 0.5 m from each end"},
    "seed-bag": {"length": 0.3, "points": {}, "note": "bag on a strap at the left hip"},
    "bow": {"length": 1.6, "points": {}, "note": "self bow held at its grip (origin), limbs along +-Y"},
    "awl": {"length": 0.14, "points": {"tip": [0.0, 0.0, -0.1]}, "note": "origin in the fist, point along -Z (past the knuckles)"},
    "whittling-knife": {"length": 0.18, "points": {}, "note": "household knife frame (butt at origin, blade +Y, edge -Z)"},
    "plane": {"length": 0.24, "points": {"sole": [0.0, 0.0, -0.06]}, "note": "origin at the rear grip, body along +Y, sole 6 cm below the grip"},
    "sickle": {"length": 0.5, "points": {"blade_mid": [0.0, 0.3, -0.18]}, "note": "origin at the handle butt, crescent blade toward -Z"},
    "wax-tablet": {"length": 0.22, "points": {}, "note": "0.22 x 0.16 x 0.02 tablet, riding the left hand"},
    "arrow-bundle": {"length": 0.75, "points": {}, "note": "one shaft along +Y from the left fist"},
    "carding-combs": {"length": 0.3, "points": {}, "note": "two parts: left comb (tines up) and right comb, each in its hand"},
    "distaff": {"length": 0.9, "points": {}, "note": "rides spine_03: rod under the left arm, fibre head at the left shoulder"},
    "tally-sticks": {"length": 0.3, "points": {}, "note": "stick along +Y across the left fist"},
    "feed-basket": {"length": 0.35, "points": {}, "note": "basket on the left hip"},
    "candle-rod": {"length": 0.6, "points": {}, "note": "rod along +Y from the right fist to the left, wicks hang along -Z"},
    "kindling-bundle": {"length": 0.5, "points": {}, "note": "household kindling bundle under the left arm"},
    "pebbles": {"length": 0.05, "points": {}, "note": "a few pebbles in the right palm"},
    "hide-scraper": {"length": 0.4, "points": {}, "note": "two-handled bar; the right handle is the origin, bar along +Y to the left handle"},
    "washing-board": {"length": 0.35, "points": {}, "note": "workplace stone; part beetle rides the right fist"},
    "bowl": {"length": 0.2, "points": {}, "note": "household bowl on the lap"},
    "straw-bundle": {"length": 0.62, "points": {}, "note": "sheaf bound by a twisted band: origin at the band, sheaf along +Y (laid on the ground while tied)"},
    "rope-coil": {"length": 0.24, "points": {}, "note": "coil hanging from the left fist: origin at its top, coil below along -Z"},
    "twisting-stick": {"length": 0.25, "points": {}, "note": "peg through the right fist: origin at the grip, hook at +Y"},
    "linen-bundle": {"length": 0.32, "points": {}, "note": "folded bundle held to the chest"},
    "walking-stick": {"length": 0.0, "points": {}, "note": "household stick frame (grip origin, shaft down -Z); length = manifest stick.length"},
    "crutch": {"length": 0.0, "points": {}, "note": "stick frame (hand grip origin, shaft down -Z, pad above on +Z); length = manifest stick.length"},
}

# ------------------------------------------------------------------ spline keys


def _arr(v):
    return np.array(v, dtype=np.float64) if isinstance(v, (tuple, list, np.ndarray)) else np.array([float(v)])


def spline(t, keys, period=None):
    """Catmull-Rom (cardinal, time-scaled tangents) through (time, value) keys; periodic when `period` is given (the last
    key must equal the first, at t = period). Values: floats or tuples."""
    ts = [k[0] for k in keys]
    vs = [_arr(k[1]) for k in keys]
    scalar = not isinstance(keys[0][1], (tuple, list))
    n = len(keys)
    if period:
        t = t % period
    if t <= ts[0]:
        out = vs[0]
    elif t >= ts[-1]:
        out = vs[-1]
    else:
        i = max(j for j in range(n - 1) if ts[j] <= t)
        t1, t2 = ts[i], ts[i + 1]
        p1, p2 = vs[i], vs[i + 1]
        if period:
            p0, t0 = (vs[i - 1], ts[i - 1]) if i > 0 else (vs[n - 2], ts[n - 2] - period)
            p3, t3 = (vs[i + 2], ts[i + 2]) if i + 2 < n else (vs[1], ts[1] + period)
        else:
            p0, t0 = (vs[i - 1], ts[i - 1]) if i > 0 else (p1, t1 - 1.0)
            p3, t3 = (vs[i + 2], ts[i + 2]) if i + 2 < n else (p2, t2 + 1.0)
        dt = t2 - t1
        m1 = (p2 - p0) / max(1e-6, t2 - t0) * dt
        m2 = (p3 - p1) / max(1e-6, t3 - t1) * dt
        if not period and i == 0:
            m1 = m1 * 0.0
        if not period and i + 1 == n - 1:
            m2 = m2 * 0.0
        u = (t - t1) / dt
        h00, h10, h01, h11 = 2 * u ** 3 - 3 * u ** 2 + 1, u ** 3 - 2 * u ** 2 + u, -2 * u ** 3 + 3 * u ** 2, u ** 3 - u ** 2
        out = h00 * p1 + h10 * m1 + h01 * p2 + h11 * m2
    return float(out[0]) if scalar else tuple(float(x) for x in out)


def bell(t, a, b, rise=0.3):
    if t <= a or t >= b:
        return 0.0
    u = (t - a) / (b - a)
    return MH.smooth(u / rise) * MH.smooth((1 - u) / rise)


# ------------------------------------------------------------------ authoring context


class Ctx:
    def __init__(self, L):
        self.L, self.rig, self.hands, self.soles, self.k = L, L.rig, L.hands, L.soles, L.k
        r = L.rig.rest
        self.sh = {s: r[f"upperarm_{s}"].translation.copy() for s in ("l", "r")}
        self.hips0 = r["hips"].translation.copy()
        self.hub_pose = L.rig.fk(*L.hub)
        self.hub_hips = L.rig.rest["hips"] @ L.hub[1]["hips"]
        st = L.stance_h
        self.stance = {s: (st[s][0].x / self.k, -st[s][0].y / self.k, math.degrees(st[s][1])) for s in ("l", "r")}
        self.arm = {s: (r[f"forearm_{s}"].translation - r[f"upperarm_{s}"].translation).length +
                       (r[f"hand_{s}"].translation - r[f"forearm_{s}"].translation).length for s in ("l", "r")}
        self.grips = {}

    def P(self, x, f, z):
        """Root-frame point from authored (left, forward, up) metres of the adult-man reference, scaled to the archetype."""
        return Vector((x * self.k, -f * self.k, z * self.k))

    def D(self, x, f, z):
        """Direction (not scaled) from (left, forward, up)."""
        return Vector((x, -f, z)).normalized()

    def grip(self, side, offset):
        key = (side, round(offset, 4))
        if key not in self.grips:
            self.grips[key] = self.hands.grip_matrix(side, offset)
        return self.grips[key]

    def curl(self, side, name):
        f, th = CURLS[name]
        return self.hands.curl(side, f, th)


def tool_frame(butt, axis, face):
    """Prop world matrix: origin at `butt`, +Y along `axis`, -Z toward `face` (made perpendicular)."""
    y = Vector(axis).normalized()
    mz = Vector(face) - y * Vector(face).dot(y)
    mz = mz.normalized() if mz.length > 1e-6 else (y.orthogonal()).normalized()
    z = -mz
    x = y.cross(z).normalized()
    z = x.cross(y).normalized()
    return Matrix.Translation(butt) @ Matrix((x, y, z)).transposed().to_4x4()


def tool_from_head(head, axis, face, length):
    """Tool whose head end (origin + axis * length) sits at `head`."""
    return tool_frame(Vector(head) - Vector(axis).normalized() * length, axis, face)


def palm_place(C, side, centre, axis_w, palm_w):
    """Hand world matrix: palm centre at `centre`, knuckle axis toward axis_w, palm facing palm_w."""
    f = C.hands.frames[side]
    a0, c0, p0 = f["axis"], f["across"], f["palm"]
    sign = 1.0 if a0.dot(c0.cross(p0)) >= 0 else -1.0
    p1 = Vector(palm_w).normalized()
    a1 = Vector(axis_w) - p1 * Vector(axis_w).dot(p1)
    a1 = a1.normalized()
    c1 = p1.cross(a1).normalized() * sign
    src = Matrix((a0, c0, p0)).transposed()
    dst = Matrix((a1, c1, p1)).transposed()
    rot = dst @ src.inverted() @ C.rig.rest[f"hand_{side}"].to_3x3()
    return MH.hand_at(C.hands, C.rig, side, rot, centre)


def palm_centre(C, pose, side):
    """The palm centre of a posed hand (world)."""
    return pose[f"hand_{side}"] @ (C.rig.rest[f"hand_{side}"].inverted() @ C.hands.frames[side]["centre"])


def fist_point(C, pose, side):
    """Where a handle runs through the posed fist (the grip point of stage_motion.Hands.grip_matrix), world."""
    f = C.hands.frames[side]
    return pose[f"hand_{side}"] @ (C.rig.rest[f"hand_{side}"].inverted() @ (f["centre"] + f["palm"] * 0.024 + f["axis"] * 0.012))


def palm_normal(C, pose, side):
    r = C.rig.rest[f"hand_{side}"].to_3x3()
    return (pose[f"hand_{side}"].to_3x3() @ (r.inverted() @ C.hands.frames[side]["palm"])).normalized()


def mix(M1, M2, w):
    """Blend two rigid matrices (slerp the rotation, lerp the translation)."""
    q = M1.to_quaternion().slerp(M2.to_quaternion(), w)
    return Matrix.Translation(M1.translation.lerp(M2.translation, w)) @ q.to_matrix().to_4x4()


def on_tool(C, side, primary, grip, d, **kw):
    """Goal for the second hand: the shaft of the tool as it rides the primary hand (evaluated after that hand is set)."""
    return lambda pose: shaft_hold(C, side, pose[f"hand_{primary}"] @ grip, d, pose, **kw)


def shaft_hold(C, side, tool, d, pose, thumb_to_head=True, around=None):
    """Second hand on a tool shaft at distance d from the butt: the shaft runs through the fist (across the palm), the
    hand on the shaft's side nearest its shoulder (or toward `around`)."""
    a = (tool.to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()
    p = tool @ Vector((0.0, d, 0.0))
    sh = pose[f"upperarm_{side}"].translation
    s = (around if around is not None else sh) - p
    n = (s - a * s.dot(a))
    n = n.normalized() if n.length > 1e-6 else a.orthogonal().normalized()
    f = C.hands.frames[side]
    a0, c0, p0 = f["axis"], f["across"], f["palm"]
    sign = 1.0 if a0.dot(c0.cross(p0)) >= 0 else -1.0
    across = a if thumb_to_head else -a
    palm = -n
    axis = (across.cross(palm) * sign).normalized()
    # rotate so (axis, across, palm) of the rest hand map to these
    src = Matrix((a0, c0, p0)).transposed()
    dst = Matrix((axis, across, palm)).transposed()
    if abs(dst.determinant() - src.determinant()) > 1e-3:
        axis = -axis
        dst = Matrix((axis, across, palm)).transposed()
    rot = dst @ src.inverted() @ C.rig.rest[f"hand_{side}"].to_3x3()
    grip_point = p
    centre = grip_point - palm * 0.024 - axis * 0.012
    return MH.hand_at(C.hands, C.rig, side, rot, centre)


# ------------------------------------------------------------------ the frame solver

def solve(C, base, g, base_pose=None):
    """One frame from a goal dict (see the module docstring). Returns (rot, loc, hand errors in metres)."""
    rig = C.rig
    rot, loc = lc.copy_frame(base)
    bp = base_pose or rig.fk(rot, loc)
    hp = rig.rest["hips"] @ loc["hips"]
    if "hipsAt" in g:
        hp = Vector(g["hipsAt"])
    if "hips" in g:
        hp = hp + C.P(*g["hips"])
    loc["hips"] = rig.rest["hips"].inverted() @ hp
    pose = rig.fk(rot, loc)
    yaw, pitch, roll = g.get("pelvis", (0.0, 0.0, 0.0))
    if yaw or pitch or roll:
        q = (Matrix.Rotation(math.radians(yaw), 3, "Z") @ Matrix.Rotation(math.radians(roll), 3, "Y") @
             Matrix.Rotation(math.radians(pitch), 3, "X"))
        mo.set_world_rotation(rig, pose, rot, loc, "hips", q @ pose["hips"].to_3x3())
    flex, twist, side = g.get("spine", (0.0, 0.0, 0.0))
    if flex or twist or side:
        MH.spine_flex(rig, pose, rot, loc, flex, twist_deg=twist, side_deg=side, shares=g.get("spineShares", (0.35, 0.35, 0.3)))
    if "neck" in g:
        nyaw, npitch = g["neck"]
        for bone, share in (("neck", 0.45), ("head", 0.55)):
            q = Matrix.Rotation(math.radians(nyaw * share), 3, "Z") @ Matrix.Rotation(math.radians(npitch * share), 3, "X")
            mo.set_world_rotation(rig, pose, rot, loc, bone, q @ pose[bone].to_3x3())
    errs = {}
    hands = g.get("hands", {})
    solved = {}

    def place_hand(s, H):
        sx = 1.0 if s == "l" else -1.0
        pole = g.get("poles", {}).get(s)
        pole = (pose[f"upperarm_{s}"].translation + C.P(sx * 0.35, -0.25, -0.3)) if pole is None else (
            pole(pose) if callable(pole) else pose[f"upperarm_{s}"].translation + C.P(*pole))
        MH.set_hand(rig, pose, rot, loc, s, H, pole)
    for s in g.get("reachOrder", ("r", "l")):
        if s in hands and hands[s] is not None:
            # goals are evaluated in order, after the previous hand is set: a shaft hold reads the primary hand's
            # actual pose (the tool rides that hand), so the second hand always meets the prop as drawn. When this
            # hand needs the spine to bend, the hands already placed are placed again on their (world) goals.
            H = hands[s](pose) if callable(hands[s]) else hands[s]
            if g.get("reach", True) and reach_assist(C, pose, rot, loc, s, H.translation) > 0.0:
                for p_, Hp in solved.items():
                    place_hand(p_, Hp)
                if callable(hands[s]):
                    H = hands[s](pose)
            place_hand(s, H)
            solved[s] = H
    for s, H in solved.items():
        errs[s] = (pose[f"hand_{s}"].translation - H.translation).length
    for s in ("l", "r"):
        if not (s in hands and hands[s] is not None) and g.get("hang", True):
            # a free arm hangs as in the hub (world direction), however the torso turns or bends
            w = g.get("swing", {}).get(s, 0.0)
            R = bp[f"upperarm_{s}"].to_3x3()
            if w:
                R = Matrix.Rotation(math.radians(w), 3, "X") @ R
            mo.set_world_rotation(rig, pose, rot, loc, f"upperarm_{s}", R)
    if g.get("look") is not None:
        MH.look_at(rig, pose, rot, loc, g["look"], g.get("lookShare", 0.8))
    feet = g.get("feet")
    for s in ("l", "r"):
        x, f, hd, lift = feet[s] if feet and s in feet else (C.stance[s][0], C.stance[s][1], C.stance[s][2], 0.0)
        tr._plant(rig, C.soles, pose, rot, loc, s, (x * C.k, -f * C.k), math.radians(hd), lift * C.k)
    for s, name in g.get("curl", {}).items():
        rot.update(C.curl(s, name))
    return rot, loc, errs


def reach_assist(C, pose, rot, loc, side, wrist, limit=0.94, max_deg=32.0):
    """When a hand goal is beyond the arm's reach, bend and turn the spine (spine_01 to spine_03, about spine_01) just
    enough to bring that shoulder within reach, so hands meet their props instead of stopping short."""
    sh = pose[f"upperarm_{side}"].translation
    reach = C.arm[side] * limit
    if (wrist - sh).length <= reach:
        return 0.0
    pivot = pose["spine_01"].translation
    v1, v2 = sh - pivot, wrist - pivot
    q_full = v1.rotation_difference(v2)
    if math.degrees(q_full.angle) > max_deg:
        q_full = Quaternion(q_full.axis, math.radians(max_deg))
    lo, hi = 0.0, 1.0
    if (pivot + q_full @ v1 - wrist).length > reach:
        lo = hi = 1.0
    for _ in range(14):
        if lo == hi:
            break
        m = 0.5 * (lo + hi)
        q = Quaternion().slerp(q_full, m)
        if (pivot + q @ v1 - wrist).length > reach:
            lo = m
        else:
            hi = m
    q = Quaternion().slerp(q_full, hi)
    part = Quaternion().slerp(q, 1.0 / 3.0).to_matrix()
    for bone in ("spine_01", "spine_02", "spine_03"):
        mo.set_world_rotation(C.rig, pose, rot, loc, bone, part @ pose[bone].to_3x3())
    # still short (a goal near the ground): the pelvis sinks and leans toward it, the knees bend (feet are planted later)
    dv = wrist - pose[f"upperarm_{side}"].translation
    excess = dv.length - reach
    if excess > 0.0:
        shift = dv.normalized() * excess
        horiz = Vector((shift.x, shift.y, 0.0))
        if horiz.length > 0.15 * C.k:
            horiz = horiz.normalized() * 0.15 * C.k
        shift = Vector((horiz.x, horiz.y, max(-0.4 * C.k, min(0.0, shift.z))))
        p = C.rig.rest["hips"] @ loc["hips"] + shift
        loc["hips"] = C.rig.rest["hips"].inverted() @ p
        C.rig.update_chain(pose, rot, loc, "hips")
    return math.degrees(q.angle) + 1.0


def tool_by_butt(C, butt, aim, face, length, contact=None, w=0.0, ground=0.0):
    """Tool from its butt toward `aim` (the head lands at butt + axis * length); with `contact` (a point in the prop
    frame) and weight w, the whole tool (and so the hands) shifts vertically so that point sits on `ground`."""
    a = (Vector(aim) - Vector(butt)).normalized()
    T = tool_frame(Vector(butt), a, face)
    if contact is not None and w > 0.0:
        p = T @ Vector(contact)
        T = Matrix.Translation(Vector((0.0, 0.0, (ground - p.z) * w))) @ T
    return T


def feet_track(t, plants, period, lift=0.08):
    """Periodic stepping: plants[side] = [(t0, t1, x, f, heading)] planted intervals; between them the foot swings on an
    arc (lift metres, authored scale). Returns {side: (x, f, heading, lift)}."""
    out = {}
    for s, ps in plants.items():
        ps = sorted(ps)
        tt = t % period
        val = None
        for (a, b, x, f, h) in ps:
            if a <= tt <= b:
                val = (x, f, h, 0.0)
        if val is None:
            seq = ps + [(a + period, b + period, x, f, h) for (a, b, x, f, h) in ps]
            for (a0, b0, x0, f0, h0), (a1, b1, x1, f1, h1) in zip(seq, seq[1:]):
                for shift in (0.0, period):
                    u_t = tt + shift
                    if b0 <= u_t <= a1:
                        u = (u_t - b0) / max(1e-6, a1 - b0)
                        w = MH.smooth(u)
                        val = (x0 + (x1 - x0) * w, f0 + (f1 - f0) * w, h0 + (h1 - h0) * w, lift * math.sin(math.pi * u))
                        break
                if val is not None:
                    break
        out[s] = val if val is not None else (ps[0][2], ps[0][3], ps[0][4], 0.0)
    return out


# ------------------------------------------------------------------ building a loop

def build_loop(C, name, seconds, fn, base=None, cyclic=True, kind="work", hub="hub", props=None, workplace=None, events=None,
               note=None, travel=None):
    L = C.L
    base = base or L.hub
    base_pose = C.rig.fk(*base)
    n = int(round(seconds * FPS)) + 1
    frames, worst, worst_at = [], {"l": 0.0, "r": 0.0}, {}
    for i in range(n):
        t = i / FPS
        g = fn(t)
        if callable(base):
            b = base(t)
            rot, loc, errs = solve(C, b, g)
        else:
            rot, loc, errs = solve(C, base, g, base_pose)
        for s, e in errs.items():
            if e > worst[s]:
                worst[s] = e
                worst_at[s] = round(t, 2)
        frames.append((rot, loc))
    if cyclic:
        frames[-1] = lc.copy_frame(frames[0])
    SM.skirt_follow(C.rig, frames, cyclic=cyclic)
    if cyclic:
        frames[-1] = lc.copy_frame(frames[0])
    props = resolve_props(C, frames, props)
    meta = {"hub": hub, "handErrorCm": {s: round(v * 100, 2) for s, v in worst.items()}, "handErrorAtSeconds": worst_at}
    if props:
        meta["props"] = props
    if workplace:
        meta["workplace"] = workplace
    if events:
        meta["events"] = events
    if note:
        meta["note"] = note
    if travel is not None:
        meta["travelOf"] = travel
    L.add(name, frames, cyclic, kind, **meta)
    L.rep[name] = {"source": "original keyframes (Crownfall), IK on the archetype reference skeleton" + (
        "; legs from the archetype's 100STYLE-derived walk" if travel else ""), "seconds": round(seconds, 4)}
    return frames


def resolve_props(C, frames, props):
    """Props given with a `world` function (the prop's world matrix in the first frame) ride their bone with the
    matrix that function implies (bone-local, constant through the clip)."""
    if not props:
        return props
    pose0 = C.rig.fk(*frames[0])
    out = []
    for p in props:
        p = dict(p)
        if callable(p.get("world")):
            M = pose0[p["bone"]].inverted() @ p.pop("world")(pose0)
            p["matrix"] = [round(v, 6) for col in M.transposed() for v in col]
        out.append(p)
    return out


def ride(prop, bone, world, **extra):
    return {"prop": prop, "bone": bone, "world": world, **extra}


def prop_attach(C, prop, bone, grip):
    """Manifest entry: the prop rides `bone` with the hand-local matrix `grip` (Blender bone-local = glTF joint-local)."""
    return {"prop": prop, "bone": bone, "matrix": [round(v, 6) for col in grip.transposed() for v in col]}


def place(C, prop, x, f, z=0.0, yaw=0.0, **extra):
    """Workplace prop placement in the resident root frame (glTF: +X left, +Y up, +Z forward), yaw about +Y in degrees."""
    p = C.P(x, f, z)
    return {"prop": prop, "positionGltf": [round(p.x, 4), round(p.z, 4), round(-p.y, 4)], "yawDeg": yaw, **extra}


# ------------------------------------------------------------------ enter and exit

def enter_exit(C, name, loop, from_frame, seated=False, seconds=None):
    """`<name>_enter` from the hub (or the seated rest) into the loop's first frame and `<name>_exit` back; feet step
    when the stances differ (transitions.transition_clip)."""
    L = C.L
    fa = tr.feet_of(C.rig, C.soles, from_frame)
    fb = tr.feet_of(C.rig, C.soles, loop[0])
    move = max((fa[s][0] - fb[s][0]).length for s in ("l", "r"))
    turn = max(abs(fa[s][1] - fb[s][1]) for s in ("l", "r"))
    pa, pb = C.rig.fk(*from_frame), C.rig.fk(*loop[0])
    drop = (pa["hips"].translation - pb["hips"].translation).length
    reach = max((pa[f"hand_{s}"].translation - pb[f"hand_{s}"].translation).length for s in ("l", "r"))
    secs = seconds or round(min(2.2, max(0.9, 0.7 + 1.6 * move + 1.0 * drop + 0.6 * reach)), 2)
    steps = None
    if not seated and (move > 0.02 or turn > 0.05):
        # step the foot that moves more first, then the other
        order = sorted(("l", "r"), key=lambda s: -(fa[s][0] - fb[s][0]).length)
        steps = {}
        t = 0.12 * secs
        for s in order:
            if (fa[s][0] - fb[s][0]).length > 0.01 or abs(fa[s][1] - fb[s][1]) > 0.03:
                steps[s] = (t, t + 0.38 * secs, 0.06 * C.k)
                t += 0.3 * secs
    enter = tr.transition_clip(C.rig, C.soles, from_frame, loop[0], secs, steps=steps, seated=seated)
    rev = {s: (secs - b, secs - a, h) for s, (a, b, h) in (steps or {}).items()} if steps else None
    # the exit steps in reverse order
    exit_ = tr.transition_clip(C.rig, C.soles, loop[0], from_frame, secs, steps=rev, seated=seated)
    for c in (enter, exit_):
        SM.skirt_follow(C.rig, c, cyclic=False)
    enter[0], enter[-1] = lc.copy_frame(from_frame), lc.copy_frame(loop[0])
    exit_[0], exit_[-1] = lc.copy_frame(loop[0]), lc.copy_frame(from_frame)
    hub = "sit" if seated else "hub"
    props = L.meta[name].get("props")
    L.add(f"{name}_enter", enter, False, "transition", fromPose=hub, toClip=name, **({"props": props} if props else {}))
    L.add(f"{name}_exit", exit_, False, "transition", fromClip=name, toPose=hub, **({"props": props} if props else {}))
    for nm, c in ((f"{name}_enter", enter), (f"{name}_exit", exit_)):
        L.rep[nm] = {"source": "original keyframes (Crownfall): transitions.transition_clip between the hub and the loop",
                     "seconds": round((len(c) - 1) / FPS, 4)}


# ------------------------------------------------------------------ walk-based loops (carries, patrol, sowing)

def walk_overlay(C, name, fn, slow=1.0, kind="carry", props=None, note=None, gait="walk", cycles=1):
    """Upper body over the archetype's `walk` (legs, pelvis and timing exact; slow > 1 plays the walk slower and reports
    the slower root speed). fn(t, u, pose) returns goals (hands, spine extra, look) solved over each walk frame.
    `gait` overlays another gait (the child's run); `cycles` repeats it so the upper body can act over several strides."""
    L = C.L
    walk, travel, _win = L.gaits[gait]
    if cycles > 1:
        walk = [f for _ in range(cycles) for f in walk[:-1]] + [walk[0]]
    period = len(walk) - 1
    n = int(round(period * slow)) + 1
    src = walk if slow == 1.0 else MH.resample_phase(walk, n - 1)
    frames, worst = [], {"l": 0.0, "r": 0.0}
    for i in range(n):
        u = i / (n - 1)
        t = i / FPS
        rot, loc = lc.copy_frame(src[i])
        pose = C.rig.fk(rot, loc)
        g = fn(t, u, pose)
        flex, twist, side = g.get("spine", (0.0, 0.0, 0.0))
        if flex or twist or side:
            MH.spine_flex(C.rig, pose, rot, loc, flex, twist_deg=twist, side_deg=side)
        for s, H in g.get("hands", {}).items():
            H = H(pose) if callable(H) else H
            sh = pose[f"upperarm_{s}"].translation
            d = H.translation - sh
            if d.length > 0.96 * C.arm[s]:  # beyond reach: bring the goal in along the line to the shoulder
                H = Matrix.Translation(sh + d.normalized() * 0.96 * C.arm[s]) @ H.to_3x3().to_4x4()
            sx = 1.0 if s == "l" else -1.0
            pole = pose[f"upperarm_{s}"].translation + C.P(*(g.get("poles", {}).get(s) or (sx * 0.35, -0.25, -0.3)))
            MH.set_hand(C.rig, pose, rot, loc, s, H, pole)
            worst[s] = max(worst[s], (pose[f"hand_{s}"].translation - H.translation).length)
        for s, k in g.get("damp", {}).items():
            pass
        if g.get("look") is not None:
            MH.look_at(C.rig, pose, rot, loc, g["look"], 0.5)
        for s, name_c in g.get("curl", {}).items():
            rot.update(C.curl(s, name_c))
        frames.append((rot, loc))
    for s, keep in (fn(0.0, 0.0, C.rig.fk(*src[0])).get("damp") or {}).items():
        MH.damp_arm(frames, s, keep)
    frames[-1] = lc.copy_frame(frames[0])
    SM.skirt_follow(C.rig, frames)
    frames[-1] = lc.copy_frame(frames[0])
    props = resolve_props(C, frames, props)
    stride = L.rep[gait]["strideMetres"] * cycles
    secs = (n - 1) / FPS
    meta = {"syncWith": gait if slow == 1.0 and cycles == 1 else None, "handErrorCm": {s: round(v * 100, 2) for s, v in worst.items()},
            "strideMetres": round(stride, 4), "speedMetresPerSecond": round(stride / secs, 4)}
    if props:
        meta["props"] = props
    if note:
        meta["note"] = note
    L.add(name, frames, True, kind, **{k: v for k, v in meta.items() if v is not None})
    L.gaits[name] = (frames, [stride * i / (n - 1) for i in range(n)], None)
    L.meta[name]["gait"] = name
    L.rep[name] = {"source": f"original keyframes (Crownfall) over the archetype's 100STYLE-derived {gait} (legs and timing kept)",
                   "seconds": round(secs, 4), "strideMetres": round(stride, 4), "speedMetresPerSecond": round(stride / secs, 4)}
    return frames


def chest_point(C, pose, rest_point):
    """A rest-frame point carried with the chest (spine_03) as it moves in the pose."""
    r = C.rig.rest["spine_03"]
    return pose["spine_03"] @ (r.inverted() @ rest_point)


def head_point(C, pose, rest_point):
    r = C.rig.rest["head"]
    return pose["head"] @ (r.inverted() @ rest_point)


def chest_dir(C, pose, rest_dir):
    r = C.rig.rest["spine_03"].to_3x3()
    return (pose["spine_03"].to_3x3() @ (r.inverted() @ Vector(rest_dir))).normalized()


# ------------------------------------------------------------------ loops: farm and herding

def loop_hoe(C, name="work_hoe"):
    """Draw hoe: raise the blade forward, chop it into the soil, draw it back toward the feet along the ground."""
    T = 2.2
    L_h = PROP_CONTRACTS["hoe"]["length"] * C.k
    g_r = C.grip("r", 0.32 * C.k)
    edge_local = Vector(PROP_CONTRACTS["hoe"]["points"]["blade_edge"]) * C.k
    feet = {"l": (0.12, 0.2, 12.0, 0.0), "r": (-0.13, -0.16, -28.0, 0.0)}
    # butt (top hand) path and the shaft's pitch below horizontal; contact weight (blade edge held on the ground)
    butt = [(0.0, (0.02, 0.26, 0.98)), (0.45, (0.03, 0.34, 1.08)), (0.8, (0.03, 0.38, 1.12)), (1.02, (0.02, 0.38, 0.94)),
            (1.2, (0.02, 0.38, 0.93)), (1.85, (0.02, 0.25, 0.97)), (T, (0.02, 0.26, 0.98))]
    pitch = [(0.0, 60.0), (0.45, 40.0), (0.8, 30.0), (1.02, 48.0), (1.2, 49.0), (1.85, 61.0), (T, 60.0)]
    contact = [(0.0, 1.0), (0.2, 1.0), (0.45, 0.0), (0.9, 0.0), (1.02, 1.0), (T, 1.0)]
    flex = [(0.0, 18.0), (0.5, 12.0), (0.85, 10.0), (1.05, 21.0), (1.3, 21.0), (1.85, 19.0), (T, 18.0)]

    def fn(t):
        b = C.P(*spline(t, butt, T))
        th = math.radians(spline(t, pitch, T))
        aim = b + Vector((0.0, -math.cos(th), -math.sin(th)))
        face = Vector((0.0, math.sin(th), -math.cos(th)))
        H = tool_by_butt(C, b, aim, face, L_h, edge_local, max(0.0, min(1.0, spline(t, contact, T))))
        return {"feet": feet, "hips": (0.0, -0.06, -0.09 - 0.02 * bell(t % T, 0.9, 1.4)), "pelvis": (-8.0, 10.0, 0.0),
                "spine": (spline(t, flex, T), -6.0, 0.0),
                "hands": {"r": H @ g_r.inverted(), "l": on_tool(C, "l", "r", g_r, 0.08 * C.k)},
                "look": C.P(0.0, 1.0, 0.0), "curl": {"l": "grip", "r": "grip"}}
    lp = build_loop(C, name, T, fn, props=[prop_attach(C, "hoe", "hand_r", g_r)], events={"impactSeconds": [1.02]})
    enter_exit(C, name, lp, C.L.hub)


def loop_sow(C, name="work_sow"):
    """Broadcast sowing while walking slowly: the left hand holds the bag's mouth at the left hip, the right hand dips
    into it and casts in a wide arc on every left step."""
    L = C.L
    sh_r = C.sh["r"]

    def fn(t, u, pose):
        # two casts per cycle (one per step): dip at u 0.0 / 0.5, cast out to the right and forward
        ph = (u * 2.0) % 1.0
        dip = chest_point(C, pose, C.hips0 + C.P(0.14, 0.17, 0.02))
        out = chest_point(C, pose, sh_r + C.P(-0.38, 0.38, -0.12))
        w = MH.smooth(ph / 0.45) if ph < 0.45 else 1.0 - MH.smooth((ph - 0.55) / 0.45) if ph > 0.55 else 1.0
        pos = dip.lerp(out, w)
        fwd = chest_dir(C, pose, C.D(-0.6, 0.8, -0.1))
        palm = chest_dir(C, pose, C.D(0.0, 0.2 + 0.6 * w, -1.0 + 1.2 * w))
        bag = chest_point(C, pose, C.hips0 + C.P(0.17, 0.14, 0.05))
        return {"hands": {"r": palm_place(C, "r", pos, fwd, palm),
                          "l": palm_place(C, "l", bag, chest_dir(C, pose, C.D(-0.3, 0.6, -0.6)), chest_dir(C, pose, C.D(-1.0, 0.0, 0.2)))},
                "spine": (6.0, 10.0 * (w - 0.5), 0.0), "curl": {"r": "cup" if w < 0.5 else "open", "l": "fist"},
                "poles": {"r": (-0.4, -0.3, -0.2), "l": (0.35, -0.3, -0.3)}}
    walk_overlay(C, name, fn, slow=2.0, kind="work", props=[ride("seed-bag", "hips", lambda pose: Matrix.Translation(pose["hips"].translation + C.P(0.2, 0.1, -0.08)), note="bag at the left hip")],
                 note="walks forward slowly while sowing: move the resident at speedMetresPerSecond x placementScale")


def loop_herd(C, name="work_herd"):
    """Leaning on the crook planted ahead and to the right, watching the flock; a step forward with a sweep of the left
    arm toward the flock, and back."""
    T = 7.0
    L_c = PROP_CONTRACTS["crook"]["length"] * C.k
    tip = C.P(-0.2, 0.36, 0.0)
    g_r = C.grip("r", 1.0 * C.k)
    lean = [(0.0, (-0.01, 0.03, -0.02)), (2.0, (0.01, 0.02, -0.02)), (3.0, (-0.02, 0.08, -0.03)), (5.0, (-0.02, 0.08, -0.03)),
            (6.0, (-0.01, 0.03, -0.02)), (T, (-0.01, 0.03, -0.02))]
    step = 0.0

    def fn(t):
        top = tip + C.P(*spline(t, [(0.0, (0.06, -0.22, 1.5)), (2.5, (0.05, -0.2, 1.5)), (3.2, (0.02, -0.1, 1.52)),
                                     (5.2, (0.02, -0.1, 1.52)), (6.2, (0.06, -0.22, 1.5)), (T, (0.06, -0.22, 1.5))], T))
        a = (top - tip).normalized()
        H = tool_frame(tip, a, C.D(0.0, 1.0, 0.0))
        g = bell(t, 2.8, 5.6, 0.25)
        plants = {"l": [(0.0, 2.85, 0.1, 0.05, 8.0), (3.25, 5.35, 0.11, 0.32, 10.0), (5.75, T, 0.1, 0.05, 8.0)],
                  "r": [(0.0, T, -0.12, -0.08, -14.0)]}
        feet = feet_track(t, plants, T, lift=0.06)
        hands = {"r": H @ g_r.inverted()}
        if g > 0.02:
            sweep = math.sin(2 * math.pi * (t - 3.4) / 1.6) * bell(t, 3.3, 5.3, 0.3)
            hands["l"] = palm_place(C, "l", C.P(0.36 + 0.14 * sweep, 0.42, 1.02 + 0.04 * sweep), C.D(0.5, 0.85, -0.1), C.D(0.2, 0.6, -0.75))
        else:
            hands["l"] = on_tool(C, "l", "r", g_r, 1.09 * C.k)
        look = C.P(1.5 * math.sin(math.radians(spline(t, [(0.0, -20.0), (1.5, 10.0), (3.0, 25.0), (5.0, 20.0), (6.5, -20.0), (T, -20.0)], T))),
                   4.0, 0.3)
        return {"feet": feet, "hips": tuple(x + y for x, y in zip(spline(t, lean, T), (0.0, 0.0, 0.0))),
                "pelvis": (-6.0, 4.0, 0.0), "spine": (8.0 + 4 * g, 6.0 * g, 0.0), "hands": hands, "look": look,
                "curl": {"r": "grip", "l": "grip" if g < 0.02 else "open"}}
    lp = build_loop(C, name, T, fn, props=[prop_attach(C, "crook", "hand_r", g_r)])
    enter_exit(C, name, lp, C.L.hub)


def loop_chop_wood(C, name="work_chop_wood"):
    """Splitting a log on the block: axe raised over the head, the edge driven onto the top of the log, worked free."""
    T = 2.4
    L_a = PROP_CONTRACTS["axe"]["length"] * C.k
    g_r = C.grip("r", 0.22 * C.k)
    edge_local = Vector(PROP_CONTRACTS["axe"]["points"]["edge"]) * C.k
    feet = {"l": (0.19, 0.0, 14.0, 0.0), "r": (-0.19, -0.05, -14.0, 0.0)}
    block_h, log_h = 0.45, 0.28
    top = (block_h + log_h) * C.k
    # butt (both hands near it) path and the handle's elevation above horizontal (toward the head)
    butt = [(0.0, (0.0, 0.3, 0.92)), (0.55, (0.02, 0.06, 1.5)), (0.8, (0.02, 0.0, 1.6)), (1.02, (0.0, 0.18, 1.22)),
            (1.12, (0.0, 0.22, 0.98)), (1.32, (0.0, 0.22, 0.96)), (1.75, (0.0, 0.26, 0.98)), (T, (0.0, 0.3, 0.92))]
    elev = [(0.0, -8.0), (0.55, 80.0), (0.8, 110.0), (1.02, 40.0), (1.12, -10.0), (1.32, -11.0), (1.75, -4.0), (T, -8.0)]
    contact = [(0.0, 0.0), (1.06, 0.0), (1.12, 1.0), (1.36, 1.0), (1.6, 0.0), (T, 0.0)]
    flex = [(0.0, 18.0), (0.55, -2.0), (0.8, -6.0), (1.05, 22.0), (1.15, 36.0), (1.35, 35.0), (1.8, 24.0), (T, 18.0)]

    def fn(t):
        b = C.P(*spline(t, butt, T))
        e = math.radians(spline(t, elev, T))
        a = Vector((0.0, -math.cos(e), math.sin(e)))
        face = Vector((1.0, 0.0, 0.0)).cross(a)  # the edge leads the downswing
        H = tool_by_butt(C, b, b + a, face, L_a, edge_local, max(0.0, min(1.0, spline(t, contact, T))), ground=top)
        dz = spline(t, [(0.0, -0.03), (0.6, 0.02), (1.15, -0.11), (1.4, -0.1), (T, -0.03)], T)
        return {"feet": feet, "hips": (0.0, -0.04, dz), "pelvis": (0.0, 6.0, 0.0), "spine": (spline(t, flex, T), 0.0, 0.0),
                "hands": {"r": H @ g_r.inverted(), "l": on_tool(C, "l", "r", g_r, 0.07 * C.k)},
                "look": C.P(0.0, 0.72, block_h + log_h), "curl": {"l": "grip", "r": "grip"},
                "poles": {"l": (0.4, -0.2, -0.35), "r": (-0.4, -0.2, -0.35)}}
    lp = build_loop(C, name, T, fn, props=[prop_attach(C, "axe", "hand_r", g_r)], events={"impactSeconds": [1.12]})
    # the block stands where the edge lands
    pose_imp = C.rig.fk(*lp[int(round(1.2 * FPS))])
    edge_w = (pose_imp["hand_r"] @ g_r) @ edge_local
    C.L.meta[name]["workplace"] = [place(C, "chopping-block", edge_w.x / C.k, -edge_w.y / C.k, 0.0, topHeight=round(block_h * C.k, 3),
                                         logTopHeight=round(top, 3))]
    enter_exit(C, name, lp, C.L.hub)


def loop_sweep(C, name="work_sweep"):
    """Besom strokes from right to left along the ground, lifted back, twice a loop, with the body turning into them."""
    T = 2.6
    L_b = PROP_CONTRACTS["broom"]["length"] * C.k
    g_r = C.grip("r", 0.42 * C.k)
    end_local = Vector((0.0, L_b, 0.0))
    butt = [(0.0, (0.0, 0.24, 1.04)), (0.75, (0.16, 0.28, 1.0)), (1.0, (0.12, 0.27, 1.04)), (1.3, (0.0, 0.24, 1.04)),
            (2.05, (0.16, 0.28, 1.0)), (2.3, (0.12, 0.27, 1.04)), (T, (0.0, 0.24, 1.04))]
    aim = [(0.0, (-0.42, 0.9, 0.0)), (0.75, (0.3, 0.95, 0.0)), (1.0, (0.34, 0.9, 0.12)), (1.3, (-0.42, 0.9, 0.0)),
           (2.05, (0.3, 0.95, 0.0)), (2.3, (0.34, 0.9, 0.12)), (T, (-0.42, 0.9, 0.0))]
    contact = [(0.0, 1.0), (0.75, 1.0), (0.95, 0.0), (1.2, 0.0), (1.3, 1.0), (2.05, 1.0), (2.25, 0.0), (2.5, 0.0), (T, 1.0)]

    def fn(t):
        b, a = C.P(*spline(t, butt, T)), C.P(*spline(t, aim, T))
        H = tool_by_butt(C, b, a, C.D(0.0, 0.0, -1.0), L_b, end_local, max(0.0, min(1.0, spline(t, contact, T))), ground=0.02 * C.k)
        tw = spline(t, [(0.0, -14.0), (0.75, 12.0), (1.3, -14.0), (2.05, 12.0), (T, -14.0)], T)
        return {"feet": {"l": (0.14, 0.12, 15.0, 0.0), "r": (-0.13, -0.08, -15.0, 0.0)}, "hips": (0.0, -0.02, -0.04),
                "pelvis": (tw * 0.4, 6.0, 0.0), "spine": (10.0, tw * 0.6, 0.0),
                "hands": {"r": H @ g_r.inverted(), "l": on_tool(C, "l", "r", g_r, 0.1 * C.k)},
                "look": C.P(0.0, 1.2, 0.0), "curl": {"l": "grip", "r": "grip"}}
    lp = build_loop(C, name, T, fn, props=[prop_attach(C, "broom", "hand_r", g_r)])
    enter_exit(C, name, lp, C.L.hub)


# ------------------------------------------------------------------ loops: crafts

def loop_saw(C, name="work_saw"):
    """Sawing a plank on the sawhorse: the left hand holds the plank down, the right saws in long strokes along the cut,
    the body rocking into each push."""
    T = 2.0
    top = 0.62  # plank top height
    cut = (-0.18, 0.5, top)
    g_r = C.grip("r", 0.0)

    def fn(t):
        s = math.sin(2 * math.pi * t / 1.0)  # two strokes a loop
        d = C.D(0.0, 0.75, -0.66)  # blade direction (forward and down along the knuckles)
        mid = C.P(*cut) + C.P(0.0, 0.0, 0.03)
        # the blade slides along its own line through the cut: handle = cut point - d * (distance along the blade)
        along = (0.36 + 0.13 * s) * C.k
        grip_pt = mid - d * along
        H = tool_frame(grip_pt, C.D(0.0, 0.66, 0.75), d)  # handle across the fist (+Y up and forward), blade along -Z = d
        Hr = H @ g_r.inverted()
        return {"feet": {"l": (0.12, 0.2, 18.0, 0.0), "r": (-0.16, -0.18, -12.0, 0.0)}, "hips": (0.0, 0.02 * s - 0.02, -0.05),
                "pelvis": (-6.0, 8.0, 0.0), "spine": (30.0 + 4.0 * s, -4.0, 0.0),
                "hands": {"r": Hr, "l": palm_place(C, "l", C.P(0.08, 0.5, top + 0.035), C.D(-0.2, 1.0, -0.2), C.D(0.0, 0.0, -1.0))},
                "look": C.P(*cut), "curl": {"r": "grip", "l": "open"}}
    lp = build_loop(C, name, T, fn, props=[prop_attach(C, "saw", "hand_r", g_r)],
                    workplace=[place(C, "sawhorse", -0.05, 0.5, 0.0, topHeight=round(top * C.k, 3))], events={"strokeSeconds": [0.25, 1.25]})
    enter_exit(C, name, lp, C.L.hub)


def loop_weave(C, name="work_weave"):
    """At the upright loom: passes the weft through the shed from the right hand to the left, then beats it up twice."""
    T = 4.4
    plane = 0.42  # warp plane distance in front

    def fn(t):
        pass_u = MH.smooth((t - 0.2) / 1.4) if t < 2.2 else 1.0 - MH.smooth((t - 3.6) / 0.7)
        beat = bell(t, 2.0, 2.6, 0.4) + bell(t, 2.7, 3.3, 0.4)
        rx = -0.3 + 0.32 * pass_u
        lx = 0.02 + 0.28 * pass_u
        z = 1.18 + 0.12 * beat
        hr = palm_place(C, "r", C.P(rx, plane - 0.03, z), C.D(0.3, 1.0, 0.1), C.D(0.0, 0.2, 1.0) if beat > 0.3 else C.D(0.4, 1.0, 0.0))
        hl = palm_place(C, "l", C.P(lx if beat < 0.3 else 0.12, plane - 0.03, z), C.D(-0.3, 1.0, 0.1), C.D(0.0, 0.2, 1.0) if beat > 0.3 else C.D(-0.4, 1.0, 0.0))
        shift = spline(t, [(0.0, -0.02), (1.6, 0.02), (2.2, 0.0), (3.6, 0.0), (T, -0.02)], T)
        return {"hips": (shift, 0.0, -0.01 + 0.01 * beat), "spine": (4.0, 6.0 * (0.5 - pass_u), 0.0),
                "hands": {"r": hr, "l": hl}, "look": C.P((rx + lx) / 2, plane, z - 0.05), "curl": {"r": "pinch", "l": "pinch"}}
    lp = build_loop(C, name, T, fn, workplace=[place(C, "loom", 0.0, plane, 0.0, warpPlaneForward=round(plane * C.k, 3))])
    enter_exit(C, name, lp, C.L.hub)


def loop_stir(C, name="work_stir"):
    T = 4.0
    rim = 0.72
    centre = (0.0, 0.5, rim)
    L_p = PROP_CONTRACTS["ladle"]["length"] * C.k
    g_r = C.grip("r", 0.3 * C.k)

    def fn(t):
        a = 2 * math.pi * t / 2.0
        blade = C.P(centre[0] + 0.14 * math.cos(a), centre[1] + 0.12 * math.sin(a), rim - 0.32)
        topp = C.P(0.04 - 0.05 * math.cos(a), 0.18 - 0.04 * math.sin(a), rim + 0.68)
        ax = (blade - topp).normalized()
        H = tool_frame(blade - ax * L_p, ax, C.D(0.0, 1.0, 0.0))
        return {"feet": {"l": (0.13, 0.04, 10.0, 0.0), "r": (-0.12, -0.08, -14.0, 0.0)},
                "hips": (0.015 * math.cos(a), 0.015 * math.sin(a) - 0.02, -0.02), "spine": (12.0 + 3.0 * math.sin(a), 6.0 * math.cos(a), 0.0),
                "hands": {"r": H @ g_r.inverted(), "l": on_tool(C, "l", "r", g_r, 0.05 * C.k)},
                "look": C.P(0.0, 0.5, rim - 0.1), "curl": {"r": "grip", "l": "grip"}}
    lp = build_loop(C, name, T, fn, props=[prop_attach(C, "ladle", "hand_r", g_r)],
                    workplace=[place(C, "brew-tub", 0.0, 0.5, 0.0, rimHeight=round(rim * C.k, 3))])
    enter_exit(C, name, lp, C.L.hub)


def loop_sell(C, name="work_sell"):
    """Behind the trestle: picks up an item, offers it, haggles with nods and a hand, hands it over, puts both hands on
    the table edge."""
    T = 7.0
    table = 0.8
    edge = 0.36

    def fn(t):
        pick = bell(t, 0.3, 1.5, 0.35)
        offer = bell(t, 1.2, 5.4, 0.15)
        give = bell(t, 4.3, 5.4, 0.35)
        rest_r = C.P(-0.2, edge, table + 0.04)
        item = C.P(-0.12, edge + 0.25, table + 0.05)
        held = C.P(-0.12, 0.48 + 0.12 * give, 1.12 + 0.05 * give)
        pos_r = rest_r.lerp(item, pick) if t < 1.2 else item.lerp(held, offer) if t < 5.6 else rest_r.lerp(held, offer)
        hr = palm_place(C, "r", pos_r, C.D(-0.1, 1.0, -0.3), C.D(0.0, 0.0, -1.0) if offer < 0.5 else C.D(0.0, 0.0, 1.0))
        gest = bell(t, 2.2, 4.2, 0.25) * math.sin(2 * math.pi * (t - 2.2) / 1.0)
        pos_l = C.P(0.2, edge, table + 0.04).lerp(C.P(0.24, 0.42, 1.12 + 0.06 * gest), bell(t, 2.0, 4.4, 0.25))
        hl = palm_place(C, "l", pos_l, C.D(0.2, 1.0, -0.2), C.D(0.0, 0.0, -1.0) if bell(t, 2.0, 4.4, 0.25) < 0.4 else C.D(-0.5, 0.2, 0.8))
        nod = 6.0 * math.sin(2 * math.pi * t / 1.1) * bell(t, 2.0, 4.6, 0.2)
        return {"hips": (0.0, 0.01 * offer, -0.01), "spine": (10.0 - 6.0 * offer + 10.0 * pick, 0.0, 0.0), "neck": (0.0, nod),
                "hands": {"r": hr, "l": hl}, "look": C.P(0.0, 1.5, 1.4) if offer > 0.4 else C.P(-0.1, edge + 0.2, table),
                "curl": {"r": "pinch" if offer > 0.2 or pick > 0.6 else "relaxed", "l": "open"}}
    lp = build_loop(C, name, T, fn, workplace=[place(C, "market-trestle", 0.0, edge + 0.3, 0.0, tableHeight=round(table * C.k, 3),
                                                   nearEdgeForward=round(edge * C.k, 3))])
    enter_exit(C, name, lp, C.L.hub)


# ------------------------------------------------------------------ loops: care, clergy, leaders

def loop_grind_herbs(C, name="work_grind_herbs"):
    T = 3.0
    g_l = C.grip("l", 0.0)
    g_r = C.grip("r", 0.0)
    bowl = C.P(0.06, 0.26, 1.0)

    def fn(t):
        a = 2 * math.pi * t / 1.0
        hl = palm_place(C, "l", bowl + C.P(0.04, 0.0, -0.05), C.D(-0.6, 0.5, 0.0), C.D(0.0, 0.0, 1.0))
        tip = bowl + C.P(0.025 * math.cos(a), 0.02 * math.sin(a), 0.0)
        top = tip + C.P(-0.06 - 0.02 * math.cos(a), -0.04, 0.16)
        hr = palm_place(C, "r", top, (tip - top).normalized(), C.D(1.0, 0.3, 0.0))
        return {"hips": (0.0, 0.0, -0.005), "spine": (10.0, 4.0 * math.cos(a) * 0.3, 0.0), "hands": {"l": hl, "r": hr},
                "look": bowl, "curl": {"l": "cup", "r": "fist"}, "poles": {"l": (0.35, -0.2, -0.35), "r": (-0.4, -0.15, -0.3)}}
    palm_c = lambda pose, s: pose[f"hand_{s}"] @ (C.rig.rest[f"hand_{s}"].inverted() @ C.hands.frames[s]["centre"])
    lp = build_loop(C, name, T, fn, props=[ride("mortar-pestle", "hand_l", lambda pose: Matrix.Translation(palm_c(pose, "l") + C.P(0.0, 0.0, 0.035)),
                                                part="mortar", note="mortar bowl in the left palm"),
                                           ride("mortar-pestle", "hand_r", lambda pose: tool_frame(bowl + C.P(0.025, 0.0, 0.0),
                                                (palm_c(pose, "r") - bowl - C.P(0.025, 0.0, 0.0)).normalized(), C.D(0.0, 1.0, 0.0)), part="pestle",
                                                note="pestle from its tip in the bowl (origin) up through the right fist (+Y)")])
    enter_exit(C, name, lp, C.L.hub)


def loop_pray(C, name="work_pray"):
    T = 8.0

    def fn(t):
        lift = bell(t, 5.0, 7.2, 0.3)
        sway = 0.006 * math.sin(2 * math.pi * t / T * 2)
        c = C.P(0.0, 0.24, 1.18 + 0.03 * lift)
        hl = palm_place(C, "l", c + C.P(0.012, 0.0, 0.0), C.D(0.15, 0.3, 1.0), C.D(-1.0, 0.0, 0.0))
        hr = palm_place(C, "r", c + C.P(-0.012, 0.0, 0.0), C.D(-0.15, 0.3, 1.0), C.D(1.0, 0.0, 0.0))
        return {"hips": (sway, 0.0, -0.005), "spine": (6.0 - 3.0 * lift, 0.0, 0.0), "neck": (0.0, 22.0 - 30.0 * lift),
                "hands": {"l": hl, "r": hr}, "curl": {"l": "open", "r": "open"}, "poles": {"l": (0.3, -0.1, -0.4), "r": (-0.3, -0.1, -0.4)}}
    lp = build_loop(C, name, T, fn)
    enter_exit(C, name, lp, C.L.hub)


def loop_read(C, name="work_read"):
    T = 7.0
    g_l = C.grip("l", 0.0)

    def fn(t):
        turn = bell(t, 4.2, 5.4, 0.3)
        book = C.P(0.03, 0.3, 1.06)
        hl = palm_place(C, "l", book + C.P(0.06, 0.0, -0.03), C.D(-0.3, 0.6, 0.2), C.D(0.0, -0.3, 1.0))
        pr = book + C.P(-0.1 + 0.16 * turn, 0.0, 0.01 + 0.04 * math.sin(math.pi * turn))
        hr = palm_place(C, "r", pr, C.D(0.4, 0.6, 0.2), C.D(0.0, -0.3, 1.0))
        return {"hips": (0.004 * math.sin(2 * math.pi * t / T), 0.0, -0.004), "spine": (6.0, 0.0, 0.0), "neck": (0.0, 18.0),
                "hands": {"l": hl, "r": hr}, "look": book, "curl": {"l": "cup", "r": "pinch" if turn > 0.2 else "relaxed"},
                "poles": {"l": (0.35, -0.15, -0.35), "r": (-0.35, -0.15, -0.35)}}
    book_w = lambda pose: Matrix.Translation(pose["hand_l"] @ (C.rig.rest["hand_l"].inverted() @ C.hands.frames["l"]["centre"]) + C.P(-0.05, 0.0, 0.03)) @ \
        Matrix.Rotation(math.radians(-35), 4, "X")
    lp = build_loop(C, name, T, fn, props=[ride("book", "hand_l", book_w, note="open book on the left palm, spine toward the right hand")],
                    events={"pageTurnSeconds": [4.8]})
    enter_exit(C, name, lp, C.L.hub)


def loop_address(C, name="work_address"):
    """Addressing a small group: turns to one side and the other, open-handed gestures, a firm beat."""
    T = 8.0

    def fn(t):
        tw = spline(t, [(0.0, 0.0), (1.5, 16.0), (3.4, 14.0), (4.6, -16.0), (6.6, -14.0), (T, 0.0)], T)
        gr = bell(t, 0.6, 3.6, 0.25)
        gl = bell(t, 3.8, 6.8, 0.25)
        beat = max(0.0, math.sin(2 * math.pi * t / 0.8)) ** 2
        hands = {}
        if gr > 0.01:
            hands["r"] = lambda pose, w=gr: _blend_hand(C, pose, "r", palm_place(C, "r", chest_point(C, pose, C.sh["r"] + C.P(-0.12, 0.42, -0.25 - 0.05 * beat)),
                                                                                   chest_dir(C, pose, C.D(-0.3, 1.0, 0.1)), chest_dir(C, pose, C.D(0.2, 0.1, 1.0))), w)
        if gl > 0.01:
            hands["l"] = lambda pose, w=gl: _blend_hand(C, pose, "l", palm_place(C, "l", chest_point(C, pose, C.sh["l"] + C.P(0.12, 0.42, -0.25)),
                                                                                   chest_dir(C, pose, C.D(0.3, 1.0, 0.1)), chest_dir(C, pose, C.D(-0.2, 0.1, 1.0))), w)
        return {"pelvis": (tw * 0.3, 0.0, 0.0), "spine": (2.0, tw * 0.7, 0.0), "neck": (tw * 0.5, -2.0 + 3.0 * beat * (gr + gl)),
                "hands": hands, "curl": {"r": "open" if gr > 0.3 else "relaxed", "l": "open" if gl > 0.3 else "relaxed"}}
    lp = build_loop(C, name, T, fn, kind="talk")
    enter_exit(C, name, lp, C.L.hub)


def loop_address_b(C, name="work_address_b"):
    """Addressing people in a firmer manner: feet set wider, the right hand raised and pointing out over the listeners
    with beats, then the left hand sweeping open toward the other side."""
    T = 7.0
    st = C.stance
    feet = {"l": (st["l"][0] + 0.05, st["l"][1] + 0.04, st["l"][2] + 4.0, 0.0), "r": (st["r"][0] - 0.05, st["r"][1] - 0.03, st["r"][2] - 4.0, 0.0)}

    def fn(t):
        tw = spline(t, [(0.0, 0.0), (1.2, -18.0), (3.6, -16.0), (4.4, 14.0), (6.2, 12.0), (T, 0.0)], T)
        pr = bell(t, 0.5, 3.8, 0.22)
        gl = bell(t, 4.0, 6.6, 0.3)
        beat = max(0.0, math.sin(2 * math.pi * t / 0.7)) ** 2
        hands = {}
        if pr > 0.01:
            hands["r"] = lambda pose, w=pr: _blend_hand(C, pose, "r", palm_place(C, "r", chest_point(C, pose, C.sh["r"] + C.P(-0.16, 0.5, 0.12 - 0.05 * beat)),
                                                                                   chest_dir(C, pose, C.D(-0.25, 1.0, 0.35)), chest_dir(C, pose, C.D(0.6, 0.0, -0.8))), w)
        if gl > 0.01:
            hands["l"] = lambda pose, w=gl: _blend_hand(C, pose, "l", palm_place(C, "l", chest_point(C, pose, C.sh["l"] + C.P(0.3, 0.36, -0.3)),
                                                                                   chest_dir(C, pose, C.D(0.6, 0.8, 0.0)), chest_dir(C, pose, C.D(-0.1, 0.4, 1.0))), w)
        return {"feet": feet, "pelvis": (tw * 0.3, 0.0, 0.0), "spine": (-3.0, tw * 0.7, 0.0), "neck": (tw * 0.5, -4.0 + 3.0 * beat * pr),
                "hands": hands, "curl": {"r": "point" if pr > 0.3 else "relaxed", "l": "open" if gl > 0.3 else "relaxed"}}
    lp = build_loop(C, name, T, fn, kind="talk")
    enter_exit(C, name, lp, C.L.hub)


def _blend_hand(C, pose, side, H, w):
    """Ease a hand goal in from where the arm hangs (weight w)."""
    cur = pose[f"hand_{side}"]
    q = cur.to_quaternion().slerp(H.to_quaternion(), w)
    p = cur.translation.lerp(H.translation, w)
    return Matrix.Translation(p) @ q.to_matrix().to_4x4()


# ------------------------------------------------------------------ loops: guards

def loop_stand_watch(C, name="guard_stand_watch"):
    T = 8.0
    L_s = PROP_CONTRACTS["spear"]["length"] * C.k
    g_r = C.grip("r", 1.22 * C.k)
    butt = C.P(-0.25, 0.08, 0.0)

    def fn(t):
        top = butt + C.P(0.02, 0.06 + 0.01 * math.sin(2 * math.pi * t / T), 2.2)
        a = (top - butt).normalized()
        H = tool_frame(butt, a, C.D(0.0, 1.0, 0.0))
        look = spline(t, [(0.0, 0.0), (1.5, 0.0), (2.5, 35.0), (4.0, 35.0), (5.0, -25.0), (6.5, -25.0), (7.5, 0.0), (T, 0.0)], T)
        shift = spline(t, [(0.0, 0.0), (3.0, -0.02), (6.0, -0.02), (T, 0.0)], T)
        belt = C.hips0 + C.P(0.19, 0.06, 0.08)
        return {"hips": (shift, 0.0, -0.005), "spine": (0.0, look * 0.15, 0.0), "neck": (look * 0.8, 0.0),
                "hands": {"r": H @ g_r.inverted(), "l": palm_place(C, "l", belt, C.D(-0.3, 0.5, -0.8), C.D(-1.0, -0.2, 0.0))},
                "curl": {"r": "grip", "l": "relaxed"}, "poles": {"l": (0.4, -0.1, -0.2)}}
    lp = build_loop(C, name, T, fn, kind="guard", props=[prop_attach(C, "spear", "hand_r", g_r)])
    enter_exit(C, name, lp, C.L.hub)
    return lp


def loop_challenge(C, base_loop, name="guard_challenge"):
    """From the watch pose: the left hand comes up palm out and the left foot steps forward to question a stranger,
    then back to the watch pose (one-shot; starts and ends on guard_stand_watch's first frame)."""
    T = 3.2
    L_s = PROP_CONTRACTS["spear"]["length"] * C.k
    g_r = C.grip("r", 1.22 * C.k)
    butt = C.P(-0.25, 0.08, 0.0)
    w0 = base_loop[0]

    def fn(t):
        up = bell(t, 0.3, 2.9, 0.3)
        plants = {"l": [(0.0, 0.5, C.stance["l"][0], C.stance["l"][1], C.stance["l"][2]), (0.95, 2.2, C.stance["l"][0] + 0.03, 0.3, 10.0),
                        (2.75, T, C.stance["l"][0], C.stance["l"][1], C.stance["l"][2])],
                  "r": [(0.0, T, C.stance["r"][0], C.stance["r"][1], C.stance["r"][2])]}
        feet = feet_track(t, plants, 99.0, lift=0.05)
        top = butt + C.P(0.02 + 0.04 * up, 0.06 + 0.08 * up, 2.2)
        a = (top - butt).normalized()
        H = tool_frame(butt, a, C.D(0.0, 1.0, 0.0))
        belt = C.hips0 + C.P(0.19, 0.06, 0.08)
        raised = C.sh["l"] + C.P(0.06, 0.45, 0.04)
        hl = lambda pose, up=up: palm_place(C, "l", belt.lerp(chest_point(C, pose, raised), up), C.D(0.0, 0.3, 1.0).lerp(C.D(-0.3, 0.5, -0.8), 1 - up),
                                            C.D(0.0, 1.0, 0.0).lerp(C.D(-1.0, -0.2, 0.0), 1 - up))
        return {"feet": feet, "hips": (0.0, 0.1 * up, -0.005), "spine": (-2.0 * up, -6.0 * up, 0.0),
                "hands": {"r": H @ g_r.inverted(), "l": hl}, "look": C.P(0.0, 4.0, 1.6),
                "curl": {"r": "grip", "l": "open" if up > 0.4 else "relaxed"}, "poles": {"l": (0.4, -0.1, -0.2)}}
    frames = build_loop(C, name, T, fn, cyclic=False, kind="guard", props=[prop_attach(C, "spear", "hand_r", g_r)])
    frames[0], frames[-1] = lc.copy_frame(w0), lc.copy_frame(w0)
    C.L.meta[name].update({"fromClip": "guard_stand_watch", "toClip": "guard_stand_watch"})


def loop_lookout(C, name="guard_lookout"):
    """Scanning the distance with the right hand shading the eyes; the bow (motion fixer, 8 November) stands on its lower
    tip beside the left foot and leans back into the left hand at its grip, so it rises beside the body, clear of the
    face and of the shading arm, instead of crossing in front of them."""
    T = 7.0
    g_l = C.grip("l", 0.0)
    tip = C.P(0.31, 0.24, 0.01)
    axis = C.D(-0.05, -0.16, 0.98)
    bow_frame = tool_frame(tip + axis * (0.8 * C.k), axis, C.D(0.0, 1.0, 0.0))

    def fn(t):
        scan = spline(t, [(0.0, -30.0), (2.5, 30.0), (3.5, 32.0), (6.0, -30.0), (T, -30.0)], T)
        brow = C.rig.rest["head"].translation + C.P(-0.02, 0.17, 0.11)
        hr = lambda pose: palm_place(C, "r", head_point(C, pose, brow), chest_dir(C, pose, C.D(0.95, 0.25, 0.0)), chest_dir(C, pose, C.D(0.0, 0.1, -1.0)))
        hl = bow_frame @ g_l.inverted()
        return {"hips": (0.0, 0.0, -0.005), "pelvis": (scan * 0.2, 0.0, 0.0), "spine": (-2.0, scan * 0.35, 0.0), "neck": (scan * 0.5, -4.0),
                "hands": {"r": hr, "l": hl}, "curl": {"r": "open", "l": "grip"}, "poles": {"r": (-0.45, -0.1, 0.1), "l": (0.45, 0.0, -0.1)},
                "reachOrder": ("l", "r")}
    lp = build_loop(C, name, T, fn, kind="guard", props=[prop_attach(C, "bow", "hand_l", g_l)])
    enter_exit(C, name, lp, C.L.hub)


def _watch_scan(t, T, keys):
    return spline(t, keys, T)


def loop_stand_watch_b(C, name="guard_stand_watch_b"):
    """Watch with the spear grounded in front and both hands on the shaft (resting on it), the weight moving from one
    leg to the other and a slow head scan every few seconds (motion fixer, 8 November: guards on watch no longer share
    one frozen stance)."""
    T = 10.0
    g_r = C.grip("r", 1.3 * C.k)
    butt = C.P(-0.06, 0.34, 0.0)

    def fn(t):
        lean = 0.012 * math.sin(2 * math.pi * t / T)
        top = butt + C.P(-0.02, -0.05 + lean, 2.2)
        H = tool_frame(butt, (top - butt).normalized(), C.D(0.6, 1.0, 0.0))
        look = _watch_scan(t, T, [(0.0, 0.0), (1.2, 0.0), (2.2, 32.0), (3.6, 30.0), (4.4, 0.0), (6.4, 0.0), (7.4, -28.0), (8.8, -26.0), (9.6, 0.0), (T, 0.0)])
        shift = spline(t, [(0.0, 0.025), (3.0, 0.025), (5.0, -0.02), (8.0, -0.02), (T, 0.025)], T)
        return {"hips": (shift, 0.02, -0.012), "pelvis": (look * 0.1, 0.0, -shift * 60), "spine": (5.0, look * 0.2, shift * 40),
                "neck": (look * 0.7, 4.0), "hands": {"r": H @ g_r.inverted(), "l": on_tool(C, "l", "r", g_r, 1.1 * C.k)},
                "curl": {"r": "grip", "l": "grip"}, "poles": {"l": (0.35, -0.2, -0.3)}}
    lp = build_loop(C, name, T, fn, kind="guard", props=[prop_attach(C, "spear", "hand_r", g_r)])
    enter_exit(C, name, lp, C.L.hub)
    return lp


def loop_stand_watch_c(C, name="guard_stand_watch_c"):
    """Watch with the spear sloped back on the right shoulder (the patrol hold, standing), the left arm loose, the head
    scanning and the weight settling onto the left leg and back."""
    T = 9.0
    g_r = C.grip("r", 0.4 * C.k)

    def fn(t):
        look = _watch_scan(t, T, [(0.0, 0.0), (1.5, 0.0), (2.5, -34.0), (4.0, -32.0), (5.0, 10.0), (6.2, 36.0), (7.6, 34.0), (8.4, 0.0), (T, 0.0)])
        shift = spline(t, [(0.0, 0.0), (2.0, 0.03), (5.5, 0.03), (7.5, 0.0), (T, 0.0)], T)

        def hr(pose):
            grip_pt = chest_point(C, pose, C.sh["r"] + C.P(0.03, 0.17, -0.25))
            a = chest_dir(C, pose, C.D(0.04, -0.38, 0.92))
            return tool_frame(grip_pt - a * (0.4 * C.k), a, chest_dir(C, pose, C.D(0.0, 1.0, 0.0))) @ g_r.inverted()
        return {"hips": (shift, 0.0, -0.01), "pelvis": (look * 0.15, 0.0, -shift * 70), "spine": (-1.0, look * 0.3, shift * 50),
                "neck": (look * 0.6, -2.0), "hands": {"r": hr}, "swing": {"l": 4.0}, "curl": {"r": "grip", "l": "relaxed"},
                "poles": {"r": (-0.35, -0.25, -0.35)}}
    lp = build_loop(C, name, T, fn, kind="guard", props=[prop_attach(C, "spear", "hand_r", g_r)])
    enter_exit(C, name, lp, C.L.hub)
    return lp


def loop_stand_watch_d(C, name="guard_stand_watch_d"):
    """Watch with the spear grounded in the left hand and the right hand on the belt (the mirror of the base watch),
    the weight on the left leg, a look back over the right shoulder."""
    T = 9.0
    g_l = C.grip("l", 1.22 * C.k)
    butt = C.P(0.25, 0.08, 0.0)

    def fn(t):
        top = butt + C.P(-0.02, 0.06 + 0.01 * math.sin(2 * math.pi * t / T), 2.2)
        H = tool_frame(butt, (top - butt).normalized(), C.D(0.0, 1.0, 0.0))
        look = _watch_scan(t, T, [(0.0, 0.0), (1.0, 0.0), (2.0, 24.0), (3.2, 22.0), (4.2, 0.0), (5.2, -55.0), (6.6, -52.0), (7.8, 0.0), (T, 0.0)])
        shift = spline(t, [(0.0, 0.028), (4.0, 0.028), (5.5, 0.0), (7.5, 0.028), (T, 0.028)], T)
        belt = C.hips0 + C.P(-0.19, 0.06, 0.08)
        return {"hips": (shift, 0.0, -0.008), "pelvis": (look * 0.12, 0.0, -shift * 60), "spine": (0.0, look * 0.25, shift * 40),
                "neck": (look * 0.65, 0.0), "hands": {"l": H @ g_l.inverted(), "r": palm_place(C, "r", belt, C.D(0.3, 0.5, -0.8), C.D(1.0, -0.2, 0.0))},
                "curl": {"l": "grip", "r": "relaxed"}, "poles": {"r": (-0.4, -0.1, -0.2)}, "reachOrder": ("l", "r")}
    lp = build_loop(C, name, T, fn, kind="guard", props=[prop_attach(C, "spear", "hand_l", g_l)])
    enter_exit(C, name, lp, C.L.hub)
    return lp


def loop_patrol(C, name="guard_patrol_walk"):
    g_r = C.grip("r", 0.4 * C.k)

    def fn(t, u, pose):
        grip_pt = chest_point(C, pose, C.sh["r"] + C.P(0.03, 0.17, -0.25))
        a = chest_dir(C, pose, C.D(0.04, -0.38, 0.92))
        H = tool_frame(grip_pt - a * (0.4 * C.k), a, chest_dir(C, pose, C.D(0.0, 1.0, 0.0)))
        return {"hands": {"r": H @ g_r.inverted()}, "curl": {"r": "grip"}, "damp": {"l": 0.6}, "poles": {"r": (-0.35, -0.25, -0.35)}}
    walk_overlay(C, name, fn, kind="guard", props=[prop_attach(C, "spear", "hand_r", g_r)],
                 note="spear sloped on the right shoulder; legs and timing are walk's: switch at matching phase")


# ------------------------------------------------------------------ carries

def _carry(C, name, hands_fn, props, spine=(0.0, 0.0, 0.0), damp=None, kind="carry", note=None):
    def fn(t, u, pose):
        g = hands_fn(pose, u)
        g.setdefault("spine", spine)
        if damp:
            g["damp"] = damp
        return g
    walk_overlay(C, name, fn, kind=kind, props=props, note=note or "legs and timing are walk's: switch at matching phase")


def loop_carries(C, wanted):
    sh_l, sh_r = C.sh["l"], C.sh["r"]
    if "carry_sack_walk" in wanted:
        g = C.grip("r", 0.0)
        _carry(C, "carry_sack_walk", lambda pose, u: {
            "hands": {"r": palm_place(C, "r", chest_point(C, pose, sh_r + C.P(0.02, 0.06, 0.13)), chest_dir(C, pose, C.D(0.4, 0.4, 0.8)),
                                      chest_dir(C, pose, C.D(0.3, -0.2, -1.0)))},
            "curl": {"r": "cup"}, "poles": {"r": (-0.4, 0.0, -0.3)}}, [ride("sack", "spine_03", lambda pose: Matrix.Translation(chest_point(C, pose, C.sh["r"] + C.P(0.03, 0.0, 0.1))) @ Matrix.Rotation(math.radians(90), 4, "X"),
                     note="sack lying on the right shoulder, long axis front to back")],
               spine=(6.0, 0.0, 5.0), damp={"l": 0.7})
    if "carry_yoke_walk" in wanted:
        _carry(C, "carry_yoke_walk", lambda pose, u: {
            "hands": {s: palm_place(C, s, chest_point(C, pose, C.sh[s] + C.P(0.2 if s == "l" else -0.2, 0.04, 0.1)),
                                    chest_dir(C, pose, C.D(1.0 if s == "l" else -1.0, 0.2, 0.2)), chest_dir(C, pose, C.D(0.0, 0.3, -1.0)))
                      for s in ("l", "r")},
            "curl": {"l": "grip", "r": "grip"}, "poles": {"l": (0.4, 0.0, -0.4), "r": (-0.4, 0.0, -0.4)}},
               [ride("water-yoke", "spine_03", lambda pose: Matrix.Translation(chest_point(C, pose, (C.sh["l"] + C.sh["r"]) * 0.5 + C.P(0.0, -0.06, 0.08))) @
                     Matrix.Rotation(math.radians(90), 4, "Z"), note="yoke across both shoulders behind the neck (+Y across)")], spine=(8.0, 0.0, 0.0))
    if "carry_basket_walk" in wanted:
        _carry(C, "carry_basket_walk", lambda pose, u: {
            "hands": {"l": palm_place(C, "l", chest_point(C, pose, C.hips0 + C.P(0.24, 0.08, 0.02)), chest_dir(C, pose, C.D(-0.5, 0.8, 0.0)),
                                      chest_dir(C, pose, C.D(-0.2, 0.0, 1.0)))},
            "curl": {"l": "cup"}, "poles": {"l": (0.45, -0.2, -0.2)}}, [ride("basket", "hand_l", lambda pose: Matrix.Translation(chest_point(C, pose, C.hips0 + C.P(0.24, 0.1, 0.12))), note="basket on the left hip, rim at the hand")],
               spine=(2.0, 0.0, -4.0), damp={"r": 0.8})
    if "carry_bucket_walk" in wanted:
        g = C.grip("r", 0.0)
        _carry(C, "carry_bucket_walk", lambda pose, u: {
            "hands": {"r": palm_place(C, "r", pose["upperarm_r"].translation + C.P(-0.1, 0.03, -0.56), C.D(0.0, 0.2, -1.0), C.D(1.0, 0.0, 0.0))},
            "curl": {"r": "grip"}, "poles": {"r": (-0.2, -0.3, 0.0)}}, [prop_attach(C, "bucket", "hand_r", g)], spine=(2.0, 0.0, 7.0), damp={"l": 0.9})
    if "carry_bundle_walk" in wanted:
        _carry(C, "carry_bundle_walk", lambda pose, u: {
            "hands": {s: palm_place(C, s, chest_point(C, pose, C.hips0 + C.P(0.13 if s == "l" else -0.13, 0.25, 0.3)),
                                    chest_dir(C, pose, C.D(-0.6 if s == "l" else 0.6, 0.6, 0.3)), chest_dir(C, pose, C.D(-0.6 if s == "l" else 0.6, -0.2, 0.5)))
                      for s in ("l", "r")},
            "curl": {"l": "cup", "r": "cup"}, "poles": {"l": (0.4, -0.1, -0.3), "r": (-0.4, -0.1, -0.3)}},
               [ride("linen-bundle", "spine_03", lambda pose: Matrix.Translation(chest_point(C, pose, C.hips0 + C.P(0.0, 0.22, 0.34))),
                     note="held to the chest; osier and kindling bundles use the same hold")],
               spine=(-3.0, 0.0, 0.0))
    if "fetch_carry" in wanted:
        g = C.grip("r", 0.0)
        _carry(C, "fetch_carry", lambda pose, u: {
            "hands": {s: palm_place(C, s, chest_point(C, pose, C.hips0 + C.P(0.035 if s == "l" else -0.035, 0.22, -0.12)), C.D(0.0, 0.6, -0.8),
                                    C.D(-1.0 if s == "l" else 1.0, 0.0, 0.0)) for s in ("l", "r")},
            "curl": {"l": "grip", "r": "grip"}, "poles": {"l": (0.35, -0.2, -0.2), "r": (-0.35, -0.2, -0.2)}},
               [prop_attach(C, "small-bucket", "hand_r", g)], spine=(-6.0, 0.0, 3.0), kind="carry")


# ------------------------------------------------------------------ children

def loop_play_chase(C, name="play_chase"):
    """Dodging in place: quick side-steps left and right with a crouch, arms out, the head tracking a playmate."""
    T = 2.4
    x0l, f0l, hl = C.stance["l"]
    x0r, f0r, hr = C.stance["r"]
    plants = {"l": [(0.0, 0.15, x0l, f0l, hl), (0.4, 0.75, x0l + 0.2, f0l + 0.05, hl + 15), (1.0, 1.5, x0l, f0l, hl), (1.75, 2.1, x0l + 0.02, f0l - 0.08, hl),
                    (2.3, T, x0l, f0l, hl)],
              "r": [(0.0, 0.5, x0r, f0r, hr), (0.75, 1.1, x0r, f0r, hr), (1.35, 1.7, x0r - 0.2, f0r + 0.05, hr - 15), (1.95, T, x0r, f0r, hr)]}

    def fn(t):
        feet = feet_track(t, plants, T, lift=0.07)
        side = spline(t, [(0.0, 0.0), (0.55, 0.09), (1.1, 0.0), (1.55, -0.09), (2.1, 0.0), (T, 0.0)], T)
        crouch = spline(t, [(0.0, -0.05), (0.55, -0.1), (1.1, -0.04), (1.55, -0.1), (2.1, -0.05), (T, -0.05)], T)
        tw = spline(t, [(0.0, 0.0), (0.6, 20.0), (1.1, 0.0), (1.6, -20.0), (2.1, 0.0), (T, 0.0)], T)
        hands = {s: (lambda pose, s=s: palm_place(C, s, chest_point(C, pose, C.sh[s] + C.P(0.28 if s == "l" else -0.28, 0.18, -0.25)),
                                                  chest_dir(C, pose, C.D(0.8 if s == "l" else -0.8, 0.5, 0.0)), chest_dir(C, pose, C.D(0.0, 1.0, -0.2))))
                 for s in ("l", "r")}
        return {"feet": feet, "hips": (side, 0.0, crouch), "pelvis": (tw * 0.5, 8.0, -side * 60), "spine": (10.0, tw * 0.5, -side * 40),
                "hands": hands, "look": C.P(-side * 4, 2.5, 0.9), "curl": {"l": "open", "r": "open"}}
    lp = build_loop(C, name, T, fn, kind="play")
    enter_exit(C, name, lp, C.L.hub)



def loop_play_chase_b(C, name="play_chase_b"):
    """Running about (the archetype's run, four strides) with the arms flung out and a look back over each shoulder at
    the chaser. Travels: the manifest gives stride and speed, the caller moves the child (motion fixer, 8 November)."""
    if "run" not in C.L.gaits:
        return None

    def fn(t, u, pose):
        back = bell(u, 0.15, 0.45, 0.3) - bell(u, 0.6, 0.9, 0.3)
        hands = {}
        for s_, sx in (("l", 1.0), ("r", -1.0)):
            flap = 0.06 * math.sin(2 * math.pi * (4 * u) + (0.0 if s_ == "l" else math.pi))
            hands[s_] = (lambda pose, s_=s_, sx=sx, flap=flap: palm_place(C, s_, chest_point(C, pose, C.sh[s_] + C.P(sx * 0.3, 0.08, -0.22 + flap)),
                                                                         chest_dir(C, pose, C.D(sx * 0.9, 0.3, -0.1)), chest_dir(C, pose, C.D(0.0, 0.2, -1.0))))
        look = C.P(-back * 3.0, 2.5 - 3.5 * abs(back), 1.1)
        return {"hands": hands, "spine": (6.0, back * 22.0, 0.0), "look": look, "curl": {"l": "open", "r": "open"},
                "poles": {"l": (0.4, -0.1, -0.2), "r": (-0.4, -0.1, -0.2)}}
    walk_overlay(C, name, fn, kind="play", gait="run", cycles=4,
                 note="travels: over four strides of the archetype's run (legs and timing kept); move the child at speedMetresPerSecond")
    C.L.meta[name]["travels"] = True
    C.L.meta[name]["gaitOf"] = "run"
    return True


def loop_play_tag(C, name="play_tag"):
    """Tag: a crouched ready stance, a lunge with the right foot and a reaching right hand, a spring back and a quick
    turn to each side with the arms out."""
    T = 3.0
    x0l, f0l, hl0 = C.stance["l"]
    x0r, f0r, hr0 = C.stance["r"]
    plants = {"l": [(0.0, 1.9, x0l, f0l, hl0), (2.15, 2.5, x0l + 0.06, f0l - 0.04, hl0 + 20), (2.75, T, x0l, f0l, hl0)],
              "r": [(0.0, 0.55, x0r, f0r, hr0), (0.8, 1.3, x0r + 0.02, f0r + 0.32, hr0 + 6), (1.55, 2.3, x0r, f0r, hr0),
                    (2.55, 2.75, x0r - 0.06, f0r - 0.04, hr0 - 20), (2.9, T, x0r, f0r, hr0)]}

    def fn(t):
        feet = feet_track(t, plants, T, lift=0.07)
        lunge = bell(t, 0.5, 1.6, 0.35)
        turn = spline(t, [(0.0, 0.0), (1.8, 0.0), (2.35, 20.0), (2.8, -16.0), (T, 0.0)], T)
        hands = {"r": lambda pose, w=lunge: _blend_hand(C, pose, "r", palm_place(C, "r", chest_point(C, pose, C.sh["r"] + C.P(0.06, 0.5, -0.05)),
                                                                                     chest_dir(C, pose, C.D(0.0, 1.0, 0.1)), chest_dir(C, pose, C.D(0.0, 0.3, -1.0))), w)}
        wide = bell(t, 1.7, T, 0.35)
        # the left hand always has a goal (eased in from the arm's own pose), so it never switches between hanging and
        # placed in mid-loop
        hands["l"] = lambda pose, w=wide: _blend_hand(C, pose, "l", palm_place(C, "l", chest_point(C, pose, C.sh["l"] + C.P(0.3, 0.12, -0.25)),
                                                                                 chest_dir(C, pose, C.D(0.9, 0.3, 0.0)), chest_dir(C, pose, C.D(0.0, 0.2, -1.0))), w)
        return {"feet": feet, "hips": (0.0, 0.16 * lunge, -0.05 - 0.05 * lunge), "pelvis": (turn * 0.5, 8.0 + 6.0 * lunge, 0.0),
                "spine": (10.0 + 12.0 * lunge, turn * 0.5, 0.0), "hands": hands, "look": C.P(-turn * 0.08, 2.0, 0.8),
                "curl": {"r": "open", "l": "open"}}
    lp = build_loop(C, name, T, fn, kind="play")
    enter_exit(C, name, lp, C.L.hub)


def loop_play_hop(C, name="play_hop"):
    """Hopscotch: two hops on the left foot with the right foot tucked up behind, a two-footed landing astride, and a
    hop back onto the left foot. In place (the loop returns to its start)."""
    T = 2.4
    x0l, f0l, hl0 = C.stance["l"]
    x0r, f0r, hr0 = C.stance["r"]

    def fn(t):
        # the feet move apart and back together only in the air (the jump into the astride landing and out of it)
        astride = bell(t, 1.3, 2.2, 0.2)
        hop = 0.0
        for c in (0.35, 0.95, 1.45, 2.05):
            hop = max(hop, bell(t, c - 0.2, c + 0.2, 0.5))
        land = max(bell(t, 0.5, 0.75, 0.5), bell(t, 1.1, 1.35, 0.5), bell(t, 1.6, 1.9, 0.4), bell(t, 2.2, 2.4, 0.5))
        tuck = 1.0 - astride
        feet = {"l": (x0l + 0.06 * astride, f0l, hl0, 0.05 * hop),
                "r": (x0r - 0.06 * astride, f0r - 0.12 * tuck, hr0, 0.2 * tuck + 0.05 * hop * astride)}
        # balance: the left arm reaches forward and up, the right arm back and out (unlike the chase's low, open arms)
        arms = {"l": lambda pose: palm_place(C, "l", chest_point(C, pose, C.sh["l"] + C.P(0.12, 0.4, 0.02 + 0.06 * hop)),
                                             chest_dir(C, pose, C.D(0.1, 1.0, 0.3)), chest_dir(C, pose, C.D(-0.2, 0.0, -1.0))),
                "r": lambda pose: palm_place(C, "r", chest_point(C, pose, C.sh["r"] + C.P(-0.28, -0.22, -0.18 + 0.04 * hop)),
                                             chest_dir(C, pose, C.D(-0.6, -0.7, -0.2)), chest_dir(C, pose, C.D(0.0, 0.2, -1.0)))}
        return {"feet": feet, "hips": (0.04 * tuck, 0.0, -0.05 * land + 0.05 * hop - 0.02), "pelvis": (0.0, 6.0, -4.0 * tuck),
                "spine": (8.0 + 6.0 * land, 0.0, 3.0 * tuck), "hands": arms, "look": C.P(0.0, 1.6, 0.0), "curl": {"l": "open", "r": "open"},
                "poles": {"l": (0.4, -0.1, -0.2), "r": (-0.4, -0.1, -0.2)}}
    lp = build_loop(C, name, T, fn, kind="play")
    enter_exit(C, name, lp, C.L.hub)


def loop_play_skip(C, name="play_skip"):
    """Skipping on both feet in place, the arms swinging round at the sides as if turning a rope."""
    T = 1.6
    x0l, f0l, hl0 = C.stance["l"]
    x0r, f0r, hr0 = C.stance["r"]

    def fn(t):
        p = ph(t, 0.8)
        hop = bell(p, 0.2, 0.8, 0.5)
        land = 1.0 - min(1.0, bell(p, 0.1, 0.9, 0.4) * 1.4)
        a = 2 * math.pi * t / 0.8
        feet = {"l": (x0l - 0.03, f0l, hl0, 0.06 * hop), "r": (x0r + 0.03, f0r, hr0, 0.06 * hop)}
        # the hands turn small circles out at the sides, arms nearly straight (as if turning a rope)
        arms = {s_: (lambda pose, s_=s_, sx=sx: palm_place(C, s_, C.hips0 + C.P(sx * 0.4, 0.14 + 0.08 * math.cos(a), -0.02 + 0.08 * math.sin(a) + 0.05 * hop),
                                                           C.D(sx * 0.5, 0.6, -0.6), C.D(-sx * 0.3, 0.0, -1.0)))
                for s_, sx in (("l", 1.0), ("r", -1.0))}
        return {"feet": feet, "hips": (0.0, 0.0, -0.04 * land + 0.06 * hop - 0.01), "pelvis": (0.0, 4.0, 0.0), "spine": (4.0 + 4.0 * land, 0.0, 0.0),
                "hands": arms, "look": C.P(0.0, 2.0, 0.5), "curl": {"l": "fist", "r": "fist"}}
    lp = build_loop(C, name, T, fn, kind="play")
    enter_exit(C, name, lp, C.L.hub)


# ------------------------------------------------------------------ seated loops (on the stool of `sit`)

def lap(C, x, f, z):
    """Point over the lap: (left, forward of the seat front, up from the thigh top), authored metres."""
    seat = C.L.seat
    h, y = seat["heightMetres"], seat["centreBlender"][1]
    return Vector((x * C.k, y - (0.22 + f) * C.k, h + (0.13 + z) * C.k))


def seated_loop(C, name, T, fn, props=None, workplace=None, events=None):
    lp = build_loop(C, name, T, fn, base=C.L.sit[0], kind="seated", hub="sit", props=props, workplace=workplace, events=events)
    enter_exit(C, name, lp, C.L.sit[0], seated=True)
    return lp


def ph(t, period):
    return (t % period) / period


def loop_write(C, name="work_write"):
    T = 5.0

    def fn(t):
        tab = lap(C, 0.0, 0.04, 0.03)
        p = ph(t, 2.5)
        prog = MH.smooth(p / 0.84) if p < 0.84 else 1.0 - MH.smooth((p - 0.84) / 0.16)
        lift = 0.02 * (bell(p, 0.82, 1.0, 0.4))
        jit = 0.004 * math.sin(2 * math.pi * t * 7.0)
        tip = tab + C.P(0.07 - 0.14 * prog, 0.0, 0.012 + jit + lift)
        hl = palm_place(C, "l", tab + C.P(0.13, 0.0, 0.0), C.D(-0.5, 0.7, -0.4), C.D(-0.4, 0.0, -1.0))
        hr = palm_place(C, "r", tip + C.P(-0.035, -0.035, 0.05), C.D(0.5, 0.6, -0.6), C.D(0.3, -0.1, -1.0))
        return {"spine": (16.0, 0.0, 0.0), "neck": (0.0, 14.0), "hands": {"l": hl, "r": hr}, "look": tab, "curl": {"l": "grip", "r": "pinch"}}
    tab_w = lambda pose: Matrix.Translation(lap(C, 0.0, 0.04, 0.0)) @ Matrix.Rotation(math.radians(-20), 4, "X")
    seated_loop(C, name, T, fn, props=[ride("wax-tablet", "hand_l", tab_w, note="tablet on the lap, held at its left edge")])


def loop_cobble(C, name="work_cobble"):
    T = 4.0
    g_r = C.grip("r", 0.0)

    def fn(t):
        shoe = lap(C, 0.06, 0.02, 0.06)
        hl = palm_place(C, "l", shoe + C.P(0.06, 0.0, 0.02), C.D(-0.6, 0.5, -0.5), C.D(-0.8, 0.0, -0.4))
        p = ph(t, 2.0)
        pierce = bell(p, 0.0, 0.35, 0.4)
        pull = bell(p, 0.3, 0.85, 0.3)
        tap = bell(t, 3.0, 3.35, 0.4) + bell(t, 3.45, 3.8, 0.4)
        at = shoe + C.P(-0.03, 0.0, 0.03 - 0.01 * pierce)
        out = shoe + C.P(-0.32, -0.05, 0.22)
        pos = at.lerp(out, pull) + C.P(0.0, 0.0, 0.08 * tap)
        hr = palm_place(C, "r", pos, C.D(0.5, 0.4, -0.6).lerp(C.D(-0.4, 0.2, 0.5), pull), C.D(0.4, 0.0, -1.0).lerp(C.D(0.0, -0.4, -1.0), pull))
        return {"spine": (20.0 - 4.0 * pull, -6.0 * pull, 0.0), "neck": (0.0, 12.0), "hands": {"l": hl, "r": hr}, "look": shoe,
                "curl": {"l": "grip", "r": "grip" if pull < 0.5 else "pinch"}}
    seated_loop(C, name, T, fn, props=[prop_attach(C, "awl", "hand_r", g_r)], events={"pullSeconds": [0.85, 2.85]})


def loop_fletch(C, name="work_fletch"):
    T = 4.0

    def fn(t):
        shaft_l = lap(C, 0.2, 0.06, 0.04)
        wind = lap(C, -0.12, 0.06, 0.04)
        hl = palm_place(C, "l", shaft_l, C.D(-0.3, 0.5, -0.6), C.D(-0.3, 0.2, -1.0))
        a = 2 * math.pi * t / 0.8
        k = bell(t, 0.0, 3.0, 0.08)
        pos = wind + C.P(0.0, 0.035 * math.cos(a) * k, 0.035 * math.sin(a) * k + 0.03) + C.P(0.06 * bell(t, 3.0, T, 0.3), 0.0, 0.0)
        hr = palm_place(C, "r", pos, C.D(0.6, 0.5, -0.4), C.D(0.3, 0.0, -1.0))
        return {"spine": (18.0, 0.0, 0.0), "neck": (0.0, 12.0), "hands": {"l": hl, "r": hr}, "look": wind, "curl": {"l": "grip", "r": "pinch"}}
    shaft_w = lambda pose: tool_frame(lap(C, 0.26, 0.06, 0.04), C.D(-1.0, 0.0, 0.0), C.D(0.0, 0.0, -1.0))
    seated_loop(C, name, T, fn, props=[ride("arrow-bundle", "hand_l", shaft_w, note="one arrow shaft across the lap (+Y toward the right hand)")])


def loop_mend(C, name="work_mend_seated"):
    T = 5.0

    def fn(t):
        work = lap(C, 0.0, 0.05, 0.08)
        inspect = bell(t, 3.6, T, 0.3)
        up = C.P(0.0, -0.05, 0.25) * inspect
        hl = palm_place(C, "l", work + C.P(0.1, 0.0, 0.0) + up, C.D(-0.6, 0.6, -0.2), C.D(-0.9, 0.0, -0.2))
        pull = bell(ph(t, 1.8), 0.2, 0.9, 0.3) * (1.0 - inspect)
        hr = palm_place(C, "r", work + C.P(-0.08, 0.0, 0.0).lerp(C.P(-0.25, -0.05, 0.18), pull) + up, C.D(0.6, 0.6, -0.2), C.D(0.9, 0.0, -0.2))
        return {"spine": (18.0 - 8.0 * inspect, 0.0, 0.0), "neck": (0.0, 12.0 - 6.0 * inspect), "hands": {"l": hl, "r": hr}, "look": work + up,
                "curl": {"l": "grip", "r": "pinch"}}
    seated_loop(C, name, T, fn, props=[ride("basket", "hand_l", lambda pose: Matrix.Translation(lap(C, 0.0, 0.05, 0.06)), note="basket or handle being mended, on the lap")])


def loop_card_wool(C, name="work_card_wool"):
    T = 4.0

    def fn(t):
        comb = lap(C, 0.12, 0.12, 0.08)
        hl = palm_place(C, "l", comb + C.P(0.06, -0.04, 0.0), C.D(-0.2, 0.9, 0.1), C.D(-0.2, 0.0, 1.0))
        stroke = MH.smooth(ph(t, 0.8) / 0.6) if ph(t, 0.8) < 0.6 else 1.0 - MH.smooth((ph(t, 0.8) - 0.6) / 0.4)
        swap = bell(t, 3.2, T, 0.3)
        pos = comb + C.P(-0.02, 0.08, 0.06).lerp(C.P(-0.16, -0.08, 0.04), stroke * (1 - swap)) + C.P(0.0, 0.0, 0.08 * swap)
        hr = palm_place(C, "r", pos, C.D(0.3, 0.9, 0.0), C.D(0.1, 0.0, -1.0))
        return {"spine": (16.0, -4.0 * stroke, 0.0), "neck": (0.0, 12.0), "hands": {"l": hl, "r": hr}, "look": comb, "curl": {"l": "grip", "r": "grip"}}
    # motion fixer, 8 November: each card rides its hand (kit parts prop_carding_combs_left/right, contract frame: butt at
    # the origin, handle +Y, teeth -Z): the left card palm up with its teeth up, the right card's teeth down onto it
    seated_loop(C, name, T, fn, props=[
        ride("carding-combs", "hand_l", lambda pose: tool_frame(fist_point(C, pose, "l") + C.P(0.035, 0.0, 0.0), C.D(-1.0, 0.25, 0.0), C.D(0.0, 0.0, 1.0)),
             part="left", note="left card palm up, the handle across the fist, teeth up"),
        ride("carding-combs", "hand_r", lambda pose: tool_frame(fist_point(C, pose, "r") + C.P(-0.035, 0.0, 0.0), C.D(1.0, 0.25, 0.0), C.D(0.0, 0.0, -1.0)),
             part="right", note="right card palm down, teeth down onto the left card")])


def loop_milk(C, name="work_milk"):
    T = 2.0

    def fn(t):
        a = 2 * math.pi * t / 0.5
        teat = lap(C, 0.0, 0.32, 0.18)
        hl = palm_place(C, "l", teat + C.P(0.05, 0.0, -0.04 * max(0.0, math.sin(a))), C.D(0.0, 0.4, -0.9), C.D(-1.0, 0.0, 0.0))
        hr = palm_place(C, "r", teat + C.P(-0.05, 0.0, -0.04 * max(0.0, -math.sin(a))), C.D(0.0, 0.4, -0.9), C.D(1.0, 0.0, 0.0))
        return {"spine": (34.0, 0.0, 0.0), "neck": (0.0, -10.0), "hands": {"l": hl, "r": hr}, "look": teat + C.P(0.0, 0.3, 0.2),
                "curl": {"l": "fist" if math.sin(a) > 0 else "cup", "r": "fist" if math.sin(a) < 0 else "cup"}}
    seated_loop(C, name, T, fn, workplace=[place(C, "milk-pail", 0.0, 0.38, 0.0, note="pail between the feet under the udder")])


def loop_throw_pot(C, name="work_throw_pot"):
    T = 4.0
    st = C.stance

    def fn(t):
        pot = lap(C, 0.0, 0.22, 0.24)
        rise = 0.05 * (0.5 - 0.5 * math.cos(2 * math.pi * t / 2.0))
        hl = palm_place(C, "l", pot + C.P(0.06, 0.0, rise), C.D(-0.2, 0.7, -0.6), C.D(-1.0, 0.0, 0.0))
        hr = palm_place(C, "r", pot + C.P(-0.06, 0.0, rise), C.D(0.2, 0.7, -0.6), C.D(1.0, 0.0, 0.0))
        kick = 0.08 * math.sin(2 * math.pi * t / 1.0)
        feet = {"l": (st["l"][0], st["l"][1], st["l"][2], 0.0), "r": (st["r"][0], st["r"][1] + kick, st["r"][2], 0.01 + 0.01 * math.sin(2 * math.pi * t / 1.0))}
        return {"spine": (24.0, 0.0, 0.0), "neck": (0.0, 10.0), "hands": {"l": hl, "r": hr}, "look": pot, "feet": feet, "curl": {"l": "cup", "r": "cup"}}
    seated_loop(C, name, T, fn, workplace=[place(C, "potter-wheel", 0.0, 0.5, 0.0, headHeight=round(0.62 * C.k, 3))])


def loop_weave_basket(C, name="work_weave_basket"):
    T = 4.0

    def fn(t):
        bk = lap(C, 0.0, 0.06, 0.12)
        a = 2 * math.pi * t / 2.0
        hl = palm_place(C, "l", bk + C.P(0.14, 0.0, -0.04), C.D(-0.5, 0.5, -0.4), C.D(-1.0, 0.0, 0.0))
        rim = bk + C.P(-0.12 * math.cos(a * 0.5) - 0.04, 0.1 * math.sin(a * 0.5), 0.05 + 0.03 * math.sin(4 * a))
        hr = palm_place(C, "r", rim, C.D(0.5, 0.5, -0.5), C.D(0.6, -0.3, -0.7))
        return {"spine": (16.0, 0.0, 0.0), "neck": (0.0, 12.0), "hands": {"l": hl, "r": hr}, "look": bk, "curl": {"l": "grip", "r": "pinch"}}
    seated_loop(C, name, T, fn, props=[ride("basket", "hand_l", lambda pose: Matrix.Translation(lap(C, 0.0, 0.06, 0.06)), note="basket being woven, on the lap")])


def loop_stitch_leather(C, name="work_stitch_leather"):
    T = 2.4

    def fn(t):
        work = lap(C, 0.0, 0.18, 0.2)
        out = bell(ph(t, 1.2), 0.15, 0.85, 0.3)
        hl = palm_place(C, "l", work.lerp(work + C.P(0.32, -0.04, 0.12), out) + C.P(0.02, 0.0, 0.0), C.D(-0.4, 0.8, 0.2), C.D(-0.6, 0.0, -0.6))
        hr = palm_place(C, "r", work.lerp(work + C.P(-0.32, -0.04, 0.12), out) + C.P(-0.02, 0.0, 0.0), C.D(0.4, 0.8, 0.2), C.D(0.6, 0.0, -0.6))
        return {"spine": (14.0 - 4.0 * out, 0.0, 0.0), "neck": (0.0, 10.0), "hands": {"l": hl, "r": hr}, "look": work, "curl": {"l": "pinch", "r": "pinch"}}
    seated_loop(C, name, T, fn, props=[prop_attach(C, "awl", "hand_r", C.grip("r", 0.0))],
                workplace=[place(C, "stitching-clam", 0.0, 0.2, 0.0, note="clamp held between the knees")])


def loop_shell_peas(C, name="work_shell_peas"):
    T = 4.0

    def fn(t):
        bowl = lap(C, 0.0, 0.08, 0.06)
        pod = bowl + C.P(0.02, 0.0, 0.1)
        fetch = bell(t, 2.8, 3.8, 0.3)
        toss = bell(t, 2.0, 2.9, 0.3)
        hl = palm_place(C, "l", pod.lerp(lap(C, 0.34, -0.08, -0.12), fetch), C.D(-0.5, 0.7, -0.2), C.D(-0.3, 0.0, -1.0))
        run = 0.04 * math.sin(2 * math.pi * t / 0.7) * bell(t, 0.0, 2.0, 0.1)
        hr = palm_place(C, "r", (pod + C.P(-0.04, run, 0.0)).lerp(lap(C, -0.34, -0.04, -0.06), toss), C.D(0.5, 0.7, -0.2), C.D(0.3, 0.0, -1.0))
        return {"spine": (18.0 + 6.0 * fetch, 8.0 * fetch - 6.0 * toss, 0.0), "neck": (0.0, 12.0), "hands": {"l": hl, "r": hr},
                "look": bowl, "curl": {"l": "pinch", "r": "pinch"}}
    seated_loop(C, name, T, fn, props=[ride("bowl", "hips", lambda pose: Matrix.Translation(lap(C, 0.0, 0.08, 0.0)), note="bowl on the lap")])


def loop_whittle(C, name="work_whittle"):
    T = 4.0
    g_r = C.grip("r", 0.05 * C.k)

    def fn(t):
        stick = lap(C, 0.05, 0.12, 0.12)
        turn = bell(t, 2.6, 3.6, 0.3)
        hl = palm_place(C, "l", stick + C.P(0.05, -0.02, -0.02), C.D(-0.3, 0.85, -0.3), C.D(-0.6, 0.0, 0.8).lerp(C.D(-0.6, 0.6, 0.4), turn))
        stroke = MH.smooth(ph(t, 0.65) / 0.55) if ph(t, 0.65) < 0.55 else 1.0 - MH.smooth((ph(t, 0.65) - 0.55) / 0.45)
        stroke *= 1.0 - bell(t, 2.5, 3.8, 0.2)
        blade = stick + C.P(-0.02, 0.03 + 0.1 * stroke, 0.03)
        hr = palm_place(C, "r", blade + C.P(-0.03, -0.06, 0.0), C.D(0.4, 0.9, -0.1), C.D(0.6, 0.0, -0.8))
        return {"spine": (20.0 + 4.0 * turn, 0.0, 0.0), "neck": (0.0, 12.0 + 8.0 * turn), "hands": {"l": hl, "r": hr}, "look": stick,
                "curl": {"l": "grip", "r": "grip"}}
    seated_loop(C, name, T, fn, props=[prop_attach(C, "whittling-knife", "hand_r", g_r)], events={"strokeSeconds": [0.36, 1.0, 1.65, 2.3]})


def loop_spin_distaff(C, name="work_spin_distaff"):
    T = 4.0

    def fn(t):
        fibre = C.sh["l"] + C.P(-0.02, 0.24, -0.12)
        draft = 0.03 * math.sin(2 * math.pi * t / 1.0)
        hl = lambda pose: palm_place(C, "l", chest_point(C, pose, fibre) + C.P(0.0, 0.0, draft), C.D(-0.3, 0.6, 0.6), C.D(-0.5, 0.2, -0.8))
        roll = bell(t, 0.0, 0.9, 0.3)
        drop = bell(t, 0.9, 3.6, 0.2)
        thigh = lap(C, -0.12, -0.02, 0.0)
        yarn = chest_point(C, C.rig.fk(*C.L.sit[0]), fibre) + C.P(0.0, 0.0, -0.18)
        pos = thigh.lerp(thigh + C.P(0.0, 0.16, 0.0), roll) if t < 0.9 else (thigh + C.P(0.0, 0.16, 0.0)).lerp(yarn, drop)
        hr = palm_place(C, "r", pos, C.D(0.2, 0.9, -0.2), C.D(0.1, 0.0, -1.0) if t < 0.9 else C.D(0.6, -0.2, 0.2))
        return {"spine": (10.0, 4.0, 0.0), "neck": (0.0, 8.0), "hands": {"l": hl, "r": hr}, "look": C.P(0.0, 0.5, 0.9), "reachOrder": ("l", "r"),
                "curl": {"l": "pinch", "r": "open" if t < 0.9 else "pinch"}}
    def distaff_w(pose):
        # motion fixer, 8 November: the rod rises from the left hip under the arm to the dressed fibre (0.72 m up the rod)
        # just above the drafting left hand
        head = chest_point(C, pose, C.sh["l"] + C.P(-0.02, 0.24, -0.12)) + C.P(0.0, 0.0, 0.07)
        foot = pose["hips"].translation + C.P(0.17, 0.03, -0.04)
        a = (head - foot).normalized()
        return tool_frame(head - a * (0.72 * C.k), a, C.D(0.0, 1.0, 0.0))
    seated_loop(C, name, T, fn, props=[ride("distaff", "spine_03", distaff_w, note="distaff tucked under the left arm, fibre at the left shoulder")],
                events={"twirlSeconds": [0.45]})


# ------------------------------------------------------------------ standing craft and farm loops

def standing(C, name, T, fn, props=None, workplace=None, events=None, kind="work"):
    lp = build_loop(C, name, T, fn, kind=kind, props=props, workplace=workplace, events=events)
    enter_exit(C, name, lp, C.L.hub)
    return lp


def loop_tally(C, name="work_tally"):
    T = 5.0

    def fn(t):
        stick = C.hips0 + C.P(0.04, 0.3, 0.12)
        look_up = bell(t, 3.4, T, 0.3)
        hl = palm_place(C, "l", stick + C.P(0.09, 0.0, 0.0), C.D(-0.4, 0.8, 0.1), C.D(-0.3, 0.0, 1.0))
        notch = bell(ph(t, 0.55), 0.1, 0.6, 0.4) * (1.0 - look_up)
        hr = palm_place(C, "r", stick + C.P(-0.04, 0.0, 0.05 - 0.03 * notch), C.D(0.5, 0.6, -0.4), C.D(0.5, 0.0, -0.8))
        return {"spine": (8.0, 0.0, 0.0), "neck": (0.0, 22.0 - 26.0 * look_up), "hands": {"l": hl, "r": hr},
                "look": None if look_up > 0.3 else stick, "curl": {"l": "grip", "r": "grip"}}
    standing(C, name, T, fn, props=[ride("tally-sticks", "hand_l", lambda pose: tool_frame(C.hips0 + C.P(0.16, 0.3, 0.12), C.D(-1.0, 0.0, 0.0), C.D(0.0, 0.0, -1.0)),
                                         note="tally stick across the left fist")])


def loop_reap(C, name="work_reap"):
    T = 3.2
    g_r = C.grip("r", 0.05 * C.k)

    def fn(t):
        grab = bell(t, 0.2, 1.6, 0.3)
        cut = MH.smooth((t - 0.7) / 0.6) if t < 1.6 else 1.0 - MH.smooth((t - 2.4) / 0.8)
        aside = bell(t, 1.6, 2.7, 0.3)
        stalks = C.P(0.12, 0.6, 0.42)
        hl = palm_place(C, "l", stalks.lerp(C.P(0.4, 0.3, 0.55), aside), C.D(-0.2, 0.8, -0.4), C.D(-0.6, 0.0, -0.5))
        sweep = C.P(-0.3 + 0.38 * cut, 0.56, 0.38 + 0.05 * aside)
        hr = palm_place(C, "r", sweep, C.D(0.5, 0.7, -0.4), C.D(0.0, 0.3, -1.0))
        return {"feet": {"l": (0.15, 0.18, 12.0, 0.0), "r": (-0.14, -0.12, -16.0, 0.0)}, "hips": (0.0, -0.08, -0.16 + 0.04 * aside),
                "pelvis": (8.0 * aside - 6.0, 12.0, 0.0), "spine": (42.0 - 12.0 * aside, 16.0 * aside - 10.0 * (1 - cut), 0.0), "neck": (0.0, -16.0),
                "hands": {"l": hl, "r": hr}, "look": stalks, "curl": {"l": "fist" if grab > 0.4 else "open", "r": "grip"}}
    standing(C, name, T, fn, props=[prop_attach(C, "sickle", "hand_r", g_r)], events={"cutSeconds": [1.3]})


def loop_bundle_straw(C, name="work_bundle_straw"):
    T = 5.0

    def fn(t):
        gather = bell(t, 0.2, 2.6, 0.3)
        tie = bell(t, 2.6, 4.8, 0.2)
        g = math.sin(2 * math.pi * t / 1.1)
        a = 2 * math.pi * t / 0.9
        hands = {}
        for s_, sx in (("l", 1.0), ("r", -1.0)):
            ground = C.P(sx * (0.28 - 0.16 * (0.5 + 0.5 * g)), 0.42, 0.16)
            knot = C.P(sx * 0.06 + 0.04 * math.cos(a) * (1 if s_ == "r" else 0), 0.38, 0.24 + 0.03 * math.sin(a) * (1 if s_ == "r" else 0))
            hands[s_] = palm_place(C, s_, ground.lerp(knot, tie / max(1e-3, gather + tie)), C.D(-sx * 0.3, 0.8, -0.5), C.D(-sx * 0.5, 0.0, -0.8))
        return {"feet": {"l": (0.17, 0.06, 20.0, 0.0), "r": (-0.17, -0.02, -20.0, 0.0)}, "hips": (0.0, -0.12, -0.5), "pelvis": (0.0, 14.0, 0.0),
                "spine": (16.0, 0.0, 0.0), "neck": (0.0, -6.0), "hands": hands, "look": C.P(0.0, 0.42, 0.15), "curl": {"l": "grip", "r": "grip"}}
    # motion fixer, 8 November: the sheaf lies across in front of the knees (band under the tying hands); the worker's
    # resting back bundle is hidden while this loop plays (hidesRestProps)
    standing(C, name, T, fn, workplace=[place(C, "straw-bundle", 0.0, 0.38, 0.085, yaw=90.0, note="sheaf laid on the ground across the front, band at the middle")])
    C.L.meta[name]["hidesRestProps"] = ["osier-bundle", "straw-bundle"]


def loop_hammer_bench(C, name="work_hammer_bench"):
    T = 2.4
    bench = 0.85
    g_r = C.grip("r", 0.06 * C.k)
    face_local = Vector(PROP_CONTRACTS["hammer-small"]["points"]["face"]) * C.k

    def fn(t):
        hl = palm_place(C, "l", C.P(0.1, 0.42, bench + 0.04), C.D(-0.5, 0.8, -0.2), C.D(-0.3, 0.0, -1.0))
        p = ph(t, 0.8)
        lift = (MH.smooth(p / 0.55) if p < 0.55 else 1.0 - (min(1.0, (p - 0.55) / 0.25)) ** 2.2) if p < 0.8 else 0.0
        strike = C.P(-0.04, 0.44, bench + 0.02)
        hand_pt = strike + C.P(-0.06, -0.2, 0.06 + 0.24 * lift)
        a = (strike + C.P(0.0, 0.0, 0.25 * lift) - hand_pt).normalized()
        H = tool_by_butt(C, hand_pt - a * (0.06 * C.k), hand_pt - a * (0.06 * C.k) + a, Vector((1.0, 0.0, 0.0)).cross(a), 0.3 * C.k,
                         face_local, 1.0 - lift, ground=bench * C.k + 0.02 * C.k)
        return {"feet": {"l": (0.12, 0.1, 12.0, 0.0), "r": (-0.13, -0.1, -14.0, 0.0)}, "hips": (0.0, 0.0, -0.02), "spine": (16.0, -4.0, 0.0),
                "hands": {"r": H @ g_r.inverted(), "l": hl}, "look": strike, "curl": {"l": "grip", "r": "grip"}}
    standing(C, name, T, fn, props=[prop_attach(C, "hammer-small", "hand_r", g_r)], events={"impactSeconds": [0.8 * 0.8, 1.44, 2.24]},
             workplace=[place(C, "workbench", 0.0, 0.48, 0.0, topHeight=round(bench * C.k, 3))])


def loop_chisel(C, name="work_chisel"):
    T = 2.4
    top = 0.86
    g_r = C.grip("r", 0.06 * C.k)
    g_l = C.grip("l", 0.08 * C.k)
    face_local = Vector(PROP_CONTRACTS["mallet"]["points"]["face"]) * C.k

    def fn(t):
        edge = C.P(0.04, 0.44, top)
        ax = C.D(0.0, -0.3, 0.95)  # chisel up from the edge, leaning back toward the mason
        ch = tool_frame(edge + ax * (0.22 * C.k), -ax, C.D(0.0, 1.0, 0.0))  # chisel origin at the struck end, +Y down to the edge
        hl = ch @ g_l.inverted()
        head = edge + ax * (0.22 * C.k)
        p = ph(t, 0.6)
        lift = MH.smooth(p / 0.6) if p < 0.6 else 1.0 - (min(1.0, (p - 0.6) / 0.4)) ** 2
        hp = head + C.P(-0.08, -0.2, 0.02 + 0.2 * lift)
        a = (head + C.P(0.0, 0.0, 0.2 * lift) - hp).normalized()
        H = tool_by_butt(C, hp - a * (0.06 * C.k), hp - a * (0.06 * C.k) + a, Vector((1.0, 0.0, 0.0)).cross(a), 0.32 * C.k,
                         face_local, 1.0 - lift, ground=head.z)
        return {"feet": {"l": (0.12, 0.1, 12.0, 0.0), "r": (-0.13, -0.1, -14.0, 0.0)}, "hips": (0.0, 0.0, -0.02), "spine": (18.0, -4.0, 0.0),
                "hands": {"l": hl, "r": H @ g_r.inverted()}, "look": edge, "curl": {"l": "grip", "r": "grip"}, "reachOrder": ("l", "r")}
    standing(C, name, T, fn, props=[prop_attach(C, "mallet", "hand_r", g_r), prop_attach(C, "chisel", "hand_l", g_l)],
             events={"impactSeconds": [0.6, 1.2, 1.8, 2.4]}, workplace=[place(C, "stone-block", 0.04, 0.44, 0.0, topHeight=round(top * C.k, 3))])


def loop_tend_mill(C, name="work_tend_mill"):
    T = 8.0

    def fn(t):
        crouch = bell(t, 0.3, 2.2, 0.3)
        lift = bell(t, 1.6, 4.2, 0.25)
        check = bell(t, 4.8, 7.6, 0.25)
        floor = C.P(0.0, 0.45, 0.36)
        hopper = C.P(0.0, 0.42, 1.24)
        spout = C.P(0.18, 0.5, 0.55)
        hands = {}
        for s_, sx in (("l", 1.0), ("r", -1.0)):
            sack = (floor + C.P(sx * 0.13, 0.0, 0.0)).lerp(hopper + C.P(sx * 0.13, 0.0, 0.0), lift / max(1e-3, crouch + lift)) if crouch + lift > 0.02 else None
            if sack is not None:
                hands[s_] = lambda pose, sack=sack, sx=sx, w=min(1.0, crouch + lift): _blend_hand(C, pose, "l" if sx > 0 else "r",
                    palm_place(C, "l" if sx > 0 else "r", sack, C.D(-sx * 0.4, 0.7, -0.3), C.D(-sx, 0.0, 0.0)), w)
        if check > 0.02:
            hands["r"] = lambda pose, w=check: _blend_hand(C, pose, "r", palm_place(C, "r", spout, C.D(0.3, 0.8, -0.3), C.D(0.0, 0.0, 1.0)), w)
        return {"feet": {"l": (0.14, 0.05, 14.0, 0.0), "r": (-0.14, -0.05, -14.0, 0.0)}, "hips": (0.0, -0.04, -0.32 * crouch - 0.2 * check),
                "pelvis": (0.0, 10.0 * crouch, 0.0), "spine": (26.0 * crouch - 6.0 * lift + 22.0 * check, 0.0, 0.0),
                "hands": hands, "look": floor if crouch > 0.5 else (hopper if lift > 0.3 else spout), "curl": {"l": "grip", "r": "grip" if check < 0.3 else "pinch"}}
    standing(C, name, T, fn, workplace=[place(C, "mill-hopper", 0.0, 0.55, 0.0, hopperHeight=round(1.4 * C.k, 3), note="sack lifted from the floor into the hopper")])


def loop_plane(C, name="work_plane"):
    T = 2.4
    bench = 0.85
    g_r = C.grip("r", 0.0)

    def fn(t):
        p = ph(t, 1.2)
        push = MH.smooth(p / 0.6) if p < 0.6 else 1.0 - MH.smooth((p - 0.6) / 0.4)
        lifted = 0.015 * bell(p, 0.62, 1.0, 0.3)
        sole = C.P(-0.04, 0.32 + 0.38 * push, bench + 0.06 + lifted)
        H = tool_frame(sole, C.D(0.0, 1.0, 0.0), C.D(0.0, 0.0, -1.0))
        hl = palm_place(C, "l", sole + C.P(0.04, 0.16, 0.04), C.D(0.0, 1.0, -0.2), C.D(0.0, 0.0, -1.0))
        return {"feet": {"l": (0.13, 0.2, 10.0, 0.0), "r": (-0.15, -0.16, -18.0, 0.0)}, "hips": (0.0, 0.1 * push - 0.03, -0.04),
                "spine": (22.0 + 8.0 * push, -6.0, 0.0), "hands": {"r": H @ g_r.inverted(), "l": hl}, "look": sole + C.P(0.0, 0.2, 0.0),
                "curl": {"l": "cup", "r": "grip"}}
    standing(C, name, T, fn, props=[prop_attach(C, "plane", "hand_r", g_r)], workplace=[place(C, "workbench", 0.0, 0.55, 0.0, topHeight=round(bench * C.k, 3))])


def loop_tread_cloth(C, name="work_tread_cloth"):
    T = 1.6
    st = C.stance
    plants = {"l": [(0.0, 0.55, st["l"][0], st["l"][1], st["l"][2]), (0.95, T, st["l"][0], st["l"][1], st["l"][2])],
              "r": [(0.15, 1.35, st["r"][0], st["r"][1], st["r"][2])]}

    def fn(t):
        feet = feet_track(t, plants, T, lift=0.14)
        sway = 0.025 * math.sin(2 * math.pi * t / T)
        hands = {s_: palm_place(C, s_, C.hips0 + C.P(0.17 if s_ == "l" else -0.17, 0.0, 0.12), C.D(0.6 if s_ == "r" else -0.6, 0.4, -0.6),
                                C.D(-1.0 if s_ == "l" else 1.0, 0.3, 0.0)) for s_ in ("l", "r")}
        return {"feet": feet, "hips": (-sway, 0.0, -0.03), "spine": (6.0, 0.0, sway * 120), "hands": hands, "look": C.P(0.0, 0.8, 0.0),
                "curl": {"l": "relaxed", "r": "relaxed"}}
    standing(C, name, T, fn, workplace=[place(C, "fulling-trough", 0.0, 0.0, 0.0, note="the treader stands in the trough")])


def loop_scrape_hide(C, name="work_scrape_hide"):
    T = 1.8

    def fn(t):
        p = ph(t, 1.8)
        push = MH.smooth(p / 0.55) if p < 0.55 else 1.0 - MH.smooth((p - 0.55) / 0.45)
        lifted = 0.03 * bell(p, 0.58, 1.0, 0.3)
        mid = C.P(0.0, 0.3, 0.98).lerp(C.P(0.0, 0.72, 0.66), push) + C.P(0.0, 0.0, lifted)
        # motion fixer, 8 November: the fists sit on the two handles (0.4 m apart, the kit scraper's span)
        hands = {s_: palm_place(C, s_, mid + C.P(0.2 if s_ == "l" else -0.2, -0.03, 0.02), C.D(0.0, 0.7, -0.7), C.D(0.0, 0.5, -0.9)) for s_ in ("l", "r")}
        return {"feet": {"l": (0.14, 0.14, 12.0, 0.0), "r": (-0.14, -0.14, -14.0, 0.0)}, "hips": (0.0, 0.08 * push - 0.04, -0.05 - 0.04 * push),
                "spine": (24.0 + 16.0 * push, 0.0, 0.0), "hands": hands, "look": mid, "curl": {"l": "grip", "r": "grip"}}
    scraper_w = lambda pose: tool_frame(fist_point(C, pose, "r"), (fist_point(C, pose, "l") - fist_point(C, pose, "r")).normalized(), C.D(0.0, 0.5, -0.9))
    standing(C, name, T, fn, props=[ride("hide-scraper", "hand_r", scraper_w, note="two-handled bar from the right fist to the left, edge down on the hide")],
             workplace=[place(C, "hide-beam", 0.0, 0.5, 0.0, topHeight=round(1.0 * C.k, 3), note="beam slopes down away from the tanner")])


def loop_prune(C, name="work_prune"):
    T = 4.0

    def fn(t):
        reach = bell(t, 0.2, 3.0, 0.2)
        down = bell(t, 2.8, 3.9, 0.3)
        branch = C.P(0.12, 0.42, 1.88)
        hl = lambda pose: _blend_hand(C, pose, "l", palm_place(C, "l", branch, C.D(0.0, 0.3, 1.0), C.D(-0.6, 0.6, 0.0)), reach)
        cut = bell(ph(t, 0.6), 0.1, 0.6, 0.4) * reach * (1.0 - down)
        hr = palm_place(C, "r", (branch + C.P(-0.12, 0.0, -0.06 - 0.04 * cut)).lerp(C.hips0 + C.P(0.24, 0.12, 0.05), down), C.D(0.4, 0.4, 0.8), C.D(0.6, 0.6, 0.0))
        return {"hips": (0.0, 0.0, 0.0), "spine": (-6.0 * reach, 0.0, 4.0 * reach), "neck": (0.0, -24.0 * reach), "hands": {"l": hl, "r": hr},
                "look": branch if down < 0.4 else None, "curl": {"l": "grip", "r": "grip"}, "reachOrder": ("l", "r")}
    standing(C, name, T, fn, props=[ride("basket", "hips", lambda pose: Matrix.Translation(C.hips0 + C.P(0.26, 0.12, 0.1)),
                                         note="basket hanging at the left hip, rim where the right hand drops the cuttings")])


def loop_chop_block(C, name="work_chop_block"):
    T = 1.6
    top = 0.8
    g_r = C.grip("r", 0.05 * C.k)
    edge_local = Vector(PROP_CONTRACTS["cleaver"]["points"]["edge"]) * C.k

    def fn(t):
        hl = palm_place(C, "l", C.P(0.12, 0.45, top + 0.05), C.D(-0.5, 0.8, -0.3), C.D(-0.2, 0.0, -1.0))
        p = ph(t, 0.8)
        lift = MH.smooth(p / 0.55) if p < 0.55 else 1.0 - (min(1.0, (p - 0.55) / 0.2)) ** 2.2 if p < 0.75 else 0.0
        strike = C.P(-0.06, 0.46, top)
        hp = strike + C.P(-0.02, -0.2, 0.08 + 0.3 * lift)
        a = (strike + C.P(0.0, 0.0, 0.3 * lift) - hp).normalized()
        H = tool_by_butt(C, hp - a * (0.05 * C.k), hp - a * (0.05 * C.k) + a, Vector((1.0, 0.0, 0.0)).cross(a), 0.32 * C.k, edge_local, 1.0 - lift, ground=top * C.k)
        return {"feet": {"l": (0.12, 0.08, 12.0, 0.0), "r": (-0.14, -0.1, -14.0, 0.0)}, "hips": (0.0, 0.0, -0.02 - 0.015 * (1 - lift)),
                "spine": (18.0, -4.0, 0.0), "hands": {"r": H @ g_r.inverted(), "l": hl}, "look": strike, "curl": {"l": "grip", "r": "grip"}}
    standing(C, name, T, fn, props=[prop_attach(C, "cleaver", "hand_r", g_r)], events={"impactSeconds": [0.6, 1.4]},
             workplace=[place(C, "chopping-block", 0.0, 0.46, 0.0, topHeight=round(top * C.k, 3))])


def loop_knead(C, name="work_knead"):
    T = 3.2
    top = 0.8

    def fn(t):
        p = ph(t, 1.6)
        push = MH.smooth(p / 0.5) if p < 0.5 else 1.0 - MH.smooth((p - 0.5) / 0.5)
        fold = bell(p, 0.55, 1.0, 0.35)
        hands = {s_: palm_place(C, s_, C.P(sx * 0.09, 0.32 + 0.18 * push, top + 0.07 - 0.03 * push + 0.05 * fold), C.D(sx * -0.2, 0.9, -0.4),
                                C.D(0.0, 0.4, -1.0)) for s_, sx in (("l", 1.0), ("r", -1.0))}
        return {"feet": {"l": (0.12, 0.1, 10.0, 0.0), "r": (-0.13, -0.08, -12.0, 0.0)}, "hips": (0.0, 0.05 * push, -0.02), "spine": (20.0 + 8.0 * push, 0.0, 0.0),
                "hands": hands, "look": C.P(0.0, 0.42, top), "curl": {"l": "cup", "r": "cup"}}
    standing(C, name, T, fn, workplace=[place(C, "bread-trough", 0.0, 0.48, 0.0, topHeight=round(top * C.k, 3))])


def loop_churn(C, name="work_churn"):
    T = 2.4

    def fn(t):
        z = 1.06 + 0.11 * math.cos(2 * math.pi * t / 1.2)
        hr = palm_place(C, "r", C.P(-0.01, 0.32, z + 0.08), C.D(0.9, 0.3, 0.0), C.D(0.0, 1.0, 0.0))
        hl = palm_place(C, "l", C.P(0.01, 0.32, z - 0.04), C.D(-0.9, 0.3, 0.0), C.D(0.0, 1.0, 0.0))
        return {"feet": {"l": (0.12, 0.06, 10.0, 0.0), "r": (-0.13, -0.06, -12.0, 0.0)}, "hips": (0.0, 0.0, -0.02 - 0.02 * math.cos(2 * math.pi * t / 1.2)),
                "spine": (10.0 - 4.0 * math.cos(2 * math.pi * t / 1.2), 0.0, 0.0), "hands": {"l": hl, "r": hr}, "look": C.P(0.0, 0.4, 0.8),
                "curl": {"l": "grip", "r": "grip"}}
    standing(C, name, T, fn, workplace=[place(C, "butter-churn", 0.0, 0.34, 0.0, topHeight=round(0.9 * C.k, 3), note="dasher handle rises from the churn lid")])


def loop_dig(C, name="work_dig"):
    T = 3.0
    L_h = PROP_CONTRACTS["hoe"]["length"] * C.k
    g_r = C.grip("r", 0.32 * C.k)
    edge_local = Vector(PROP_CONTRACTS["hoe"]["points"]["blade_edge"]) * C.k
    butt = [(0.0, (0.02, 0.3, 1.0)), (0.6, (0.03, 0.36, 1.2)), (0.95, (0.02, 0.4, 0.92)), (1.4, (0.02, 0.36, 0.95)), (1.9, (-0.12, 0.3, 1.08)),
            (2.4, (-0.18, 0.28, 1.1)), (T, (0.02, 0.3, 1.0))]
    pitch = [(0.0, 52.0), (0.6, 34.0), (0.95, 58.0), (1.4, 64.0), (1.9, 40.0), (2.4, 36.0), (T, 52.0)]
    contact = [(0.0, 0.0), (0.85, 0.0), (0.95, 1.0), (1.45, 1.0), (1.7, 0.0), (T, 0.0)]

    def fn(t):
        b = C.P(*spline(t, butt, T))
        th = math.radians(spline(t, pitch, T))
        yaw = math.radians(spline(t, [(0.0, 0.0), (1.5, 0.0), (2.1, -35.0), (2.5, -35.0), (T, 0.0)], T))
        rz = Matrix.Rotation(yaw, 3, "Z")
        a = rz @ Vector((0.0, -math.cos(th), -math.sin(th)))
        face = rz @ Vector((0.0, math.sin(th), -math.cos(th)))
        H = tool_by_butt(C, b, b + a, face, L_h, edge_local, max(0.0, min(1.0, spline(t, contact, T))))
        return {"feet": {"l": (0.13, 0.2, 12.0, 0.0), "r": (-0.14, -0.15, -26.0, 0.0)}, "hips": (0.0, -0.06, -0.1), "pelvis": (math.degrees(yaw) * 0.3, 10.0, 0.0),
                "spine": (spline(t, [(0.0, 18.0), (0.6, 12.0), (0.95, 24.0), (1.4, 26.0), (1.9, 16.0), (T, 18.0)], T), math.degrees(yaw) * 0.5, 0.0),
                "hands": {"r": H @ g_r.inverted(), "l": on_tool(C, "l", "r", g_r, 0.08 * C.k)}, "look": C.P(0.0, 1.0, 0.0), "curl": {"l": "grip", "r": "grip"}}
    standing(C, name, T, fn, props=[prop_attach(C, "hoe", "hand_r", g_r)], events={"impactSeconds": [0.95]})


def loop_gather_herbs(C, name="work_gather_herbs"):
    T = 4.0

    def fn(t):
        put = bell(t, 2.4, 3.6, 0.3)
        plant = C.P(0.06, 0.42, 0.16)
        basket = C.P(0.34, 0.24, 0.24)
        hl = palm_place(C, "l", plant.lerp(basket, put), C.D(-0.2, 0.8, -0.5), C.D(-0.5, 0.0, -0.8))
        cut = bell(ph(t, 0.7), 0.1, 0.6, 0.4) * (1.0 - put)
        hr = palm_place(C, "r", plant + C.P(-0.08, 0.0, -0.03 - 0.02 * cut), C.D(0.5, 0.8, -0.3), C.D(0.4, 0.0, -0.9))
        return {"feet": {"l": (0.16, 0.08, 18.0, 0.0), "r": (-0.16, -0.02, -18.0, 0.0)}, "hips": (0.0, -0.12, -0.5), "pelvis": (6.0 * put, 14.0, 0.0),
                "spine": (18.0, 10.0 * put, 0.0), "neck": (0.0, -6.0), "hands": {"l": hl, "r": hr}, "look": plant, "curl": {"l": "fist", "r": "pinch"}}
    standing(C, name, T, fn, workplace=[place(C, "herb-basket", 0.36, 0.24, 0.0, note="basket set on the ground at the left")], kind="care")


def loop_oven_peel(C, name="work_oven_peel"):
    T = 4.0
    L_p = PROP_CONTRACTS["oven-peel"]["length"] * C.k
    g_r = C.grip("r", 0.12 * C.k)

    def fn(t):
        push = bell(t, 0.3, 3.4, 0.35)
        mouth = 0.86
        blade = C.P(0.1, 1.25 + 0.45 * push, mouth)
        b = C.P(-0.03, 0.1 + 0.3 * push, mouth + 0.12)
        H = tool_frame(b, (blade - b).normalized(), C.D(0.0, 0.0, -1.0))
        H = H @ Matrix.Translation(Vector((0.0, 0.0, 0.0)))
        plants = {"l": [(0.0, 0.5, 0.12, 0.08, 10.0), (0.9, 2.6, 0.12, 0.34, 10.0), (3.1, T, 0.12, 0.08, 10.0)], "r": [(0.0, T, -0.14, -0.12, -16.0)]}
        return {"feet": feet_track(t, plants, T, lift=0.05), "hips": (0.0, 0.12 * push, -0.03), "spine": (14.0, -8.0, 0.0),
                "hands": {"r": H @ g_r.inverted(), "l": on_tool(C, "l", "r", g_r, 0.34 * C.k)}, "look": blade, "curl": {"l": "grip", "r": "grip"}}
    standing(C, name, T, fn, props=[prop_attach(C, "oven-peel", "hand_r", g_r)],
             workplace=[place(C, "bakehouse-oven", 0.0, 1.5, 0.0, mouthHeight=round(0.86 * C.k, 3), note="oven mouth about 1.1 m ahead; the bakehouse is environment art")])


def loop_scatter_feed(C, name="work_scatter_feed"):
    T = 3.0

    def fn(t):
        p = ph(t, 1.5)
        cast = MH.smooth((p - 0.35) / 0.35) if p < 0.75 else 1.0 - MH.smooth((p - 0.75) / 0.25)
        dip = C.hips0 + C.P(0.2, 0.16, 0.16)
        out = C.sh["r"] + C.P(-0.34, 0.42, -0.2)
        hl = palm_place(C, "l", C.hips0 + C.P(0.24, 0.1, 0.04), C.D(-0.5, 0.8, 0.0), C.D(-0.2, 0.0, 1.0))
        hr = palm_place(C, "r", dip.lerp(out, cast), C.D(-0.5, 0.8, -0.1), C.D(0.0, 0.2 + 0.6 * cast, -1.0 + 1.2 * cast))
        tw = -14.0 * cast + 6.0
        return {"hips": (0.0, 0.0, -0.01), "pelvis": (tw * 0.3, 0.0, 0.0), "spine": (6.0, tw * 0.6, 0.0), "hands": {"l": hl, "r": hr},
                "look": C.P(-1.2, 2.5, 0.0), "curl": {"l": "cup", "r": "cup" if cast < 0.6 else "open"}, "poles": {"l": (0.45, -0.2, -0.2)}}
    standing(C, name, T, fn, props=[ride("feed-basket", "hand_l", lambda pose: Matrix.Translation(C.hips0 + C.P(0.24, 0.1, 0.14)), note="basket on the left hip")])


def loop_twist_rope(C, name="work_twist_rope"):
    T = 4.0
    st = C.stance
    plants = {"l": [(0.0, 1.2, st["l"][0], st["l"][1], st["l"][2]), (1.6, 2.8, st["l"][0], st["l"][1] - 0.22, st["l"][2]), (3.2, T, st["l"][0], st["l"][1], st["l"][2])],
              "r": [(0.0, 1.5, st["r"][0], st["r"][1], st["r"][2]), (1.9, 3.0, st["r"][0], st["r"][1] - 0.22, st["r"][2]), (3.45, T, st["r"][0], st["r"][1], st["r"][2])]}

    def fn(t):
        feet = feet_track(t, plants, T, lift=0.05)
        back = spline(t, [(0.0, 0.0), (1.4, 0.0), (2.4, -0.22), (3.0, -0.22), (3.8, 0.0), (T, 0.0)], T)
        a = 2 * math.pi * t / 0.5
        c = C.P(0.0, 0.34 + back, 1.08)
        hl = palm_place(C, "l", c + C.P(0.05, 0.03 * math.cos(a), 0.03 * math.sin(a)), C.D(0.0, 1.0, 0.0), C.D(-1.0, 0.0, 0.0))
        hr = palm_place(C, "r", c + C.P(-0.05, -0.03 * math.cos(a), -0.03 * math.sin(a)), C.D(0.0, 1.0, 0.0), C.D(1.0, 0.0, 0.0))
        return {"feet": feet, "hips": (0.0, back, -0.01), "spine": (8.0, 0.0, 0.0), "hands": {"l": hl, "r": hr}, "look": c + C.P(0.0, 1.0, -0.3),
                "curl": {"l": "fist", "r": "fist"}}
    # motion fixer, 8 November: the rope coil hangs from the left fist, the twisting stick stands up through the right
    standing(C, name, T, fn, props=[
        ride("rope-coil", "hand_l", lambda pose: Matrix.Translation(fist_point(C, pose, "l")), note="coil hanging from the left fist"),
        ride("twisting-stick", "hand_r", lambda pose: tool_frame(fist_point(C, pose, "r"), C.D(0.0, 0.0, 1.0), C.D(0.0, 1.0, 0.0)),
             note="peg up through the right fist, hook at the top")])


def loop_dip_candles(C, name="work_dip_candles"):
    T = 4.0

    def fn(t):
        dip = bell(t, 0.3, 1.5, 0.3)
        z = 1.02 - 0.42 * dip
        c = C.P(0.0, 0.42, z)
        hands = {s_: palm_place(C, s_, c + C.P(sx * 0.24, 0.0, 0.0), C.D(0.0, 0.6, -0.8), C.D(-sx, 0.0, 0.0)) for s_, sx in (("l", 1.0), ("r", -1.0))}
        return {"feet": {"l": (0.13, 0.06, 10.0, 0.0), "r": (-0.13, -0.06, -12.0, 0.0)}, "hips": (0.0, -0.04, -0.06 - 0.1 * dip), "spine": (12.0 + 20.0 * dip, 0.0, 0.0),
                "hands": hands, "look": C.P(0.0, 0.45, 0.5) if dip > 0.3 else c, "curl": {"l": "grip", "r": "grip"}}
    standing(C, name, T, fn, props=[ride("candle-rod", "hand_r", lambda pose: tool_frame(C.P(-0.26, 0.42, 1.02), C.D(1.0, 0.0, 0.0), C.D(0.0, 0.0, -1.0)),
                                         note="rod held level in both fists, wicks hanging along -Z")],
             workplace=[place(C, "tallow-pot", 0.0, 0.45, 0.0, rimHeight=round(0.5 * C.k, 3))])


def loop_wash_linen(C, name="work_wash_linen"):
    T = 5.0
    stone = 0.28
    # motion fixer, 8 November: the beetle (kit part prop_washing_board_beetle: grip at the origin, handle +Y, blade face
    # -Z) rides the right fist; the hand follows the beetle, whose blade face lands on the linen on the stone
    g_r = C.grip("r", 0.0)
    face_local = Vector((0.0, 0.26, -0.0125)) * C.k
    strike = C.P(-0.02, 0.5, stone + 0.025)

    def fn(t):
        beat = bell(t, 0.1, 3.0, 0.1)
        wring = bell(t, 3.0, 4.9, 0.25)
        p = ph(t, 0.7)
        lift = (MH.smooth(p / 0.6) if p < 0.6 else 1.0 - (min(1.0, (p - 0.6) / 0.4)) ** 2) * beat
        hl = palm_place(C, "l", C.P(0.14, 0.44, stone + 0.04).lerp(C.P(0.06, 0.38, 0.62), wring), C.D(-0.4, 0.8, -0.4), C.D(0.0, 0.0, -1.0).lerp(C.D(-1.0, 0.0, 0.0), wring))
        hand_pt = strike + C.P(-0.07, -0.2, 0.05 + 0.24 * lift)
        a = (strike + C.P(0.0, 0.0, 0.26 * lift) - hand_pt).normalized()
        H = tool_by_butt(C, hand_pt, hand_pt + a, Vector((1.0, 0.0, 0.0)).cross(a), 0.38 * C.k, face_local, beat * (1.0 - lift), ground=strike.z)
        hr = mix(H @ g_r.inverted(), palm_place(C, "r", C.P(-0.06, 0.38, 0.62), C.D(0.4, 0.8, -0.2), C.D(1.0, 0.0, 0.0)), wring)
        return {"feet": {"l": (0.17, 0.08, 18.0, 0.0), "r": (-0.17, -0.02, -18.0, 0.0)}, "hips": (0.0, -0.12, -0.5 + 0.1 * wring), "pelvis": (0.0, 14.0, 0.0),
                "spine": (20.0 - 8.0 * wring, 0.0, 0.0), "hands": {"l": hl, "r": hr}, "look": C.P(0.0, 0.5, stone), "curl": {"l": "grip", "r": "grip"}}
    standing(C, name, T, fn, props=[dict(prop_attach(C, "washing-board", "hand_r", g_r), part="beetle", note="wooden beetle in the right fist")],
             workplace=[place(C, "washing-board", 0.0, 0.52, 0.0, topHeight=round(stone * C.k, 3))])


# ------------------------------------------------------------------ children's play

def loop_play_toss(C, name="play_toss"):
    T = 3.0

    def fn(t):
        swing = bell(t, 0.4, 1.4, 0.35)
        back = bell(t, 0.3, 0.9, 0.4)
        pick = bell(t, 1.8, 2.8, 0.3)
        hr = palm_place(C, "r", C.hips0 + C.P(-0.16, -0.12 * back + 0.35 * max(0.0, swing - back), 0.0 + 0.25 * max(0.0, swing - back)).lerp(C.P(-0.1, 0.42, 0.08), pick),
                        C.D(0.0, 0.6, -0.8), C.D(0.0, 1.0, 0.2))
        return {"feet": {"l": (0.13, 0.12, 14.0, 0.0), "r": (-0.13, -0.08, -14.0, 0.0)}, "hips": (0.0, -0.03, -0.08 - 0.3 * pick), "pelvis": (0.0, 10.0 * pick, 0.0),
                "spine": (12.0 + 26.0 * pick, -8.0 * swing, 0.0), "hands": {"r": hr}, "look": C.P(0.0, 2.0 - 1.4 * pick, 0.0),
                "curl": {"r": "cup" if swing < 0.7 else "open"}}
    standing(C, name, T, fn, kind="play", props=[ride("pebbles", "hand_r", lambda pose: Matrix.Translation(palm_centre(C, pose, "r") + palm_normal(C, pose, "r") * (0.018 * C.k)),
                                                      note="pebbles cupped in the right palm")])


def loop_crouch_gather(C, name="crouch_gather"):
    T = 4.0

    def fn(t):
        down = bell(t, 0.2, 2.2, 0.3)
        add = bell(t, 2.2, 3.6, 0.3)
        hr = palm_place(C, "r", (C.hips0 + C.P(-0.1, 0.1, 0.0)).lerp(C.P(-0.08, 0.38, 0.14), down).lerp(C.hips0 + C.P(0.16, 0.18, 0.18), add),
                        C.D(0.2, 0.6, -0.7), C.D(0.0, 0.3, -1.0))
        hl = lambda pose: palm_place(C, "l", chest_point(C, pose, C.hips0 + C.P(0.2, 0.12, 0.22)), chest_dir(C, pose, C.D(-0.6, 0.7, 0.0)), chest_dir(C, pose, C.D(-0.6, -0.2, 0.6)))
        return {"feet": {"l": (0.15, 0.06, 16.0, 0.0), "r": (-0.15, -0.04, -16.0, 0.0)}, "hips": (0.0, -0.1 * down, -0.46 * down), "pelvis": (0.0, 12.0 * down, 0.0),
                "spine": (16.0 * down + 6.0, 6.0 * add, 0.0), "hands": {"l": hl, "r": hr}, "look": C.P(0.0, 0.45, 0.0) if down > 0.3 else None,
                "curl": {"l": "cup", "r": "fist" if down > 0.6 else "relaxed"}}
    standing(C, name, T, fn, props=[ride("kindling-bundle", "hand_l", lambda pose: Matrix.Translation(C.hips0 + C.P(0.2, 0.1, 0.24)) @ Matrix.Rotation(math.radians(90), 4, "Y"),
                                         note="sticks held under the left arm")])


# ------------------------------------------------------------------ registry

LOOPS = {
    "work_hoe": loop_hoe, "work_herd": loop_herd, "work_chop_wood": loop_chop_wood, "work_sweep": loop_sweep,
    "work_saw": loop_saw, "work_weave": loop_weave, "work_stir": loop_stir, "work_sell": loop_sell,
    "work_grind_herbs": loop_grind_herbs, "work_pray": loop_pray, "work_read": loop_read, "work_address": loop_address,
    "guard_lookout": loop_lookout, "play_chase": loop_play_chase,
    "work_write": loop_write, "work_cobble": loop_cobble, "work_fletch": loop_fletch, "work_mend_seated": loop_mend,
    "work_card_wool": loop_card_wool, "work_milk": loop_milk, "work_throw_pot": loop_throw_pot, "work_weave_basket": loop_weave_basket,
    "work_stitch_leather": loop_stitch_leather, "work_shell_peas": loop_shell_peas, "work_whittle": loop_whittle,
    "work_spin_distaff": loop_spin_distaff, "work_tally": loop_tally, "work_reap": loop_reap, "work_bundle_straw": loop_bundle_straw,
    "work_hammer_bench": loop_hammer_bench, "work_chisel": loop_chisel, "work_tend_mill": loop_tend_mill, "work_plane": loop_plane,
    "work_tread_cloth": loop_tread_cloth, "work_scrape_hide": loop_scrape_hide, "work_prune": loop_prune, "work_chop_block": loop_chop_block,
    "work_knead": loop_knead, "work_churn": loop_churn, "work_dig": loop_dig, "work_gather_herbs": loop_gather_herbs,
    "work_oven_peel": loop_oven_peel, "work_scatter_feed": loop_scatter_feed, "work_twist_rope": loop_twist_rope,
    "work_dip_candles": loop_dip_candles, "work_wash_linen": loop_wash_linen, "play_toss": loop_play_toss, "crouch_gather": loop_crouch_gather,
    # motion fixer, 8 November: role-loop variants (village-population ROLE_LOOP_VARIANTS)
    "guard_stand_watch_b": loop_stand_watch_b, "guard_stand_watch_c": loop_stand_watch_c, "guard_stand_watch_d": loop_stand_watch_d,
    "work_address_b": loop_address_b, "play_tag": loop_play_tag, "play_hop": loop_play_hop, "play_skip": loop_play_skip,
}
WALK_LOOPS = {"work_sow": loop_sow, "guard_patrol_walk": loop_patrol, "play_chase_b": loop_play_chase_b}
CARRIES = ("carry_sack_walk", "carry_yoke_walk", "carry_basket_walk", "carry_bucket_walk", "carry_bundle_walk", "fetch_carry")


def build_roles(L, wanted, log=print):
    """Build every role clip in `wanted` (clip ids from the population's library list) that this module authors."""
    C = Ctx(L)
    L.prop_contracts = {}
    done, skipped = [], []
    base_names = set(L.clips)
    for clip in wanted:
        if clip in base_names or clip in done:
            continue
        if clip in LOOPS:
            LOOPS[clip](C)
        elif clip in WALK_LOOPS:
            WALK_LOOPS[clip](C)
            if clip not in L.meta:  # a travelling variant over a gait this archetype lacks
                skipped.append(clip)
                continue
        elif clip in CARRIES:
            loop_carries(C, [clip])
        elif clip == "guard_stand_watch":
            watch = loop_stand_watch(C)
            if "guard_challenge" in wanted:
                loop_challenge(C, watch)
                done.append("guard_challenge")
        elif clip == "guard_challenge":
            continue
        else:
            skipped.append(clip)
            continue
        done.append(clip)
        log("role", clip, L.meta[clip].get("handErrorCm"))
    for name in done:
        for p in L.meta.get(name, {}).get("props", []) or []:
            if p["prop"] in PROP_CONTRACTS:
                L.prop_contracts[p["prop"]] = PROP_CONTRACTS[p["prop"]]
    L.rep["roles"] = {"built": done, "notBuilt": skipped}
    return done, skipped

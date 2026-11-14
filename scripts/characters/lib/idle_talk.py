"""Standing idle and talking performance for the resident clips (original Crownfall code, motion stage).

The first idles were the retargeted 100STYLE stand-still takes with the feet locked: 0.2 to 0.8 cm of hip travel and
at most 1.7 degrees per joint over five to six seconds, so they read as frozen, and the feet kept the captured toe bend
and roll (the soles sank up to 1.3 cm). Talking was the idle plus a jaw flap and a 2 degree nod. Here:

* the idle stance comes from the resident's own walk (the left foot's flat-stance position and the walk's toe-out), so
  walk_stop can end on it and walk_start can leave from it without sliding a foot; both feet are planted flat;
* a periodic layer adds postural sway (about 1 cm) and one weight shift onto a foot and back per loop (2.5 cm with a
  little pelvis roll, the spine compensating), zero at the loop seam with matching velocity;
* talk adds conversational body language over the grounded idle: nods and tilts, a slight lean in, and open-hand
  gestures with one or both hands (resident-specific; the elder keeps her left hand on the stick). The mouth is not in
  the body clip: speech comes from the shared face contract (face-performance.ts babble visemes), so no clip fights the
  face rig for the jaw.
"""
import math

from mathutils import Matrix, Quaternion, Vector

import locomotion as lc
import motion as mo

FPS = 30


def smoothstep(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def bell(t, t0, t1, rise=0.35):
    """0 outside [t0, t1], 1 in the middle, smooth shoulders lasting `rise` of the span."""
    if t <= t0 or t >= t1:
        return 0.0
    u = (t - t0) / (t1 - t0)
    return smoothstep(u / rise) * smoothstep((1.0 - u) / rise)


def stance_from_walk(rig, soles, walk, windows, toe_out_deg=7.0):
    """Idle stance per foot: the ankle where the walk's stance foot is flat (mean over its flat frames, x only; feet
    side by side under the pelvis), heading = the walk's toe-out. Returns {side: (Vector ankle xy, heading)}."""
    period = len(walk) - 1
    out = {}
    for s in ("l", "r"):
        xs = []
        for (a, b) in windows[s]:
            for u in range(a, b + 1):
                pose = rig.fk(*walk[u % period])
                pts = soles.points(pose, s)
                if max(p.z for p in pts.values()) < lc.GROUND + 0.004:
                    xs.append(pose[f"foot_{s}"].translation.x)
        if not xs:
            xs = [rig.rest[f"foot_{s}"].translation.x * 0.6]
        x = sum(xs) / len(xs)
        heading = math.radians(toe_out_deg) * (1 if s == "l" else -1)
        out[s] = (Vector((x, 0.0, 0.0)), heading)
    # one foot a little ahead of the other reads less posed than a parade stance
    out["l"][0].y -= 0.025
    out["r"][0].y += 0.02
    return out


# Per-resident idle layers (round 2: one generator gave all four the same sway, hips curves correlated 0.76 to 0.99).
# sway: lateral sway amplitude (m) with `swayCycles` whole cycles per loop at `swayPhase`; shifts: weight shifts
# (start, end as loop fractions, side, metres); bobCycles: fore-aft rocking cycles per loop. Whole cycles keep the
# loop seamless.
IDLE_STYLES = {
    # settled and heavy: one slow sway, a long lean onto the right leg
    "smith": {"sway": 0.006, "swayCycles": 1, "swayPhase": 0.9, "shifts": [(0.3, 0.78, "r", 0.03)], "bobCycles": 1, "roll": 2.4},
    # light and patient: two small sways, weight passes from one foot to the other
    "spinner": {"sway": 0.006, "swayCycles": 2, "swayPhase": 1.7, "shifts": [(0.08, 0.38, "l", 0.02), (0.55, 0.86, "r", 0.018)],
                "bobCycles": 2, "roll": 1.8},
    # restless: quicker sway and three weight swaps a loop
    "child": {"sway": 0.009, "swayCycles": 3, "swayPhase": 0.4,
              "shifts": [(0.04, 0.28, "r", 0.03), (0.38, 0.6, "l", 0.032), (0.7, 0.93, "r", 0.022)], "bobCycles": 3, "roll": 3.0},
    # careful: very little sway, the weight leaning toward the stick side
    "elder": {"sway": 0.004, "swayCycles": 1, "swayPhase": 2.4, "shifts": [(0.18, 0.86, "l", 0.015)], "bobCycles": 1, "roll": 1.2},
}


def ground_idle(rig, soles, frames, stance, sway=0.009, shift=0.025, shift_side="l", roll_deg=2.2, style=None):
    """Plant both feet flat on the stance and add the sway and weight-shift layer (periodic over the clip). `style`
    (IDLE_STYLES) replaces the default single sway and shift with the resident's own."""
    n = len(frames)
    st = style or {"sway": sway, "swayCycles": 1, "swayPhase": 0.0, "shifts": [(0.22, 0.62, shift_side, shift)], "bobCycles": 2,
                   "roll": roll_deg}
    rest_hips = rig.rest["hips"]
    # centre the pelvis over the stance (the walk's feet sit up to 4 cm off its in-place root)
    mid = 0.5 * (stance["l"][0].x + stance["r"][0].x)

    def shift_at(u):
        dx, w_sum, signed = 0.0, 0.0, 0.0
        for (a, b, side, amount) in st["shifts"]:
            span = b - a
            w = smoothstep((u - a) / (0.4 * span)) * (1.0 - smoothstep((u - (b - 0.45 * span)) / (0.45 * span)))
            sign = 1.0 if side == "l" else -1.0
            dx += sign * amount * w
            signed += sign * w
            w_sum = max(w_sum, w)
        return dx, w_sum, signed
    for i, (rot, loc) in enumerate(frames):
        u = i / (n - 1)
        dxs, w, signed = shift_at(u)
        dx = mid + dxs + st["sway"] * math.sin(2 * math.pi * st["swayCycles"] * u + st["swayPhase"]) - st["sway"] * math.sin(st["swayPhase"])
        dy = 0.004 * math.sin(2 * math.pi * st["bobCycles"] * u + 0.7) - 0.004 * math.sin(0.7)
        p = rest_hips @ loc["hips"]
        p.x += dx
        p.y += dy
        p.z -= 0.004 * w
        loc["hips"] = rest_hips.inverted() @ p
        pose = rig.fk(rot, loc)
        roll = math.radians(st["roll"]) * signed + math.radians(0.6) * math.sin(2 * math.pi * st["swayCycles"] * u + st["swayPhase"])
        fwd = Vector((0.0, -1.0, 0.0))
        mo.set_world_rotation(rig, pose, rot, loc, "hips", Matrix.Rotation(-roll, 3, fwd) @ pose["hips"].to_3x3())
        for bone, share in (("spine_01", 0.45), ("spine_02", 0.35), ("spine_03", 0.2)):
            mo.set_world_rotation(rig, pose, rot, loc, bone, Matrix.Rotation(roll * share, 3, fwd) @ pose[bone].to_3x3())
        for s in ("l", "r"):
            xy, heading = stance[s]
            lc.plant_flat(rig, soles, pose, rot, loc, s, xy, heading)
    frames[-1] = lc.copy_frame(frames[0])
    return {"swayCm": round(st["sway"] * 100, 2), "swayCycles": st["swayCycles"],
            "weightShifts": [[a, b, side, round(amount * 100, 1)] for (a, b, side, amount) in st["shifts"]]}


def _palm_up_rotation(hands, rig, side, pose, forward):
    """World rotation of a hand with its knuckles pointing `forward` and the palm turned up (an open, offering hand)."""
    f = hands.frames[side]
    a0, c0, p0 = f["axis"], f["across"], f["palm"]
    hand_sign = 1.0 if c0.dot(p0.cross(a0)) >= 0 else -1.0
    a1 = Vector(forward).normalized()
    p1 = Vector((0.0, 0.0, 1.0))
    p1 = (p1 - a1 * p1.dot(a1)).normalized()
    c1 = p1.cross(a1).normalized() * hand_sign
    src = Matrix((a0, c0, p0)).transposed()
    dst = Matrix((a1, c1, p1)).transposed()
    return dst @ src.inverted() @ rig.rest[f"hand_{side}"].to_3x3()


def _front_point(x, z, below_hips=None):
    """Rest-pose point just in front of the body surface (Body and Clothes) at lateral x and height z: where a hand rests
    on the belt or the apron. Falls back to 14 cm in front of the hips."""
    import bpy
    best = None
    for name in ("Clothes", "Body"):
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        mw = obj.matrix_world
        for v in obj.data.vertices:
            c = mw @ v.co
            if abs(c.x - x) < 0.03 and abs(c.z - z) < 0.025 and (best is None or c.y < best):
                best = c.y
    return Vector((x, (best if best is not None else -0.14) - 0.03, z))


# Per-resident talk performance (round 2: all four gave the same open-palm gesture with the right hand).
# gestures: (kind, side, start, end, amount); kinds: offer (open palm forward), beat (a hand raised in front that beats
# down twice), belt (thumb hooked at the belt front), clasp (hands joined at the apron); head: nod/tilt/turn degrees;
# lean: forward lean (degrees) and sideLean toward a side; fidget: lateral hip sway (m) with cycles per loop.
TALK_STYLES = {
    "smith": {"gestures": [("belt", "l", 0.06, 0.94, 1.0), ("beat", "r", 0.14, 0.44, 1.0), ("beat", "r", 0.58, 0.82, 0.75)],
              "nod": 3.2, "tilt": 2.0, "turn": 3.5, "lean": 2.0},
    "spinner": {"gestures": [("clasp", "l", 0.08, 0.52, 1.0), ("clasp", "r", 0.08, 0.52, 1.0), ("offer", "r", 0.62, 0.88, 0.7)],
                "nod": 2.2, "tilt": 4.5, "turn": 4.0, "lean": 3.0},
    "child": {"gestures": [("offer", "r", 0.12, 0.3, 0.85), ("offer", "l", 0.38, 0.54, 0.6), ("offer", "r", 0.62, 0.8, 0.9)],
              "nod": 2.8, "tilt": 5.5, "turn": 6.0, "lean": 1.5, "fidget": (0.012, 2)},
    # the elder leans on her stick and talks with her head; the free hand stays under the cloak
    "elder": {"gestures": [], "nod": 2.0, "tilt": 2.8, "turn": 3.5, "lean": 1.2, "sideLean": ("l", 0.8)},
}


def _hand_goal(kind, side, pose, rig, rest_hips, anchors, t_loop, a, b):
    sx = 1.0 if side == "l" else -1.0
    shoulder = pose[f"upperarm_{side}"].translation
    to_pose = pose["hips"] @ rest_hips.inverted()
    if kind == "offer":
        return Vector((shoulder.x * 0.55 + sx * 0.06, shoulder.y - 0.3, shoulder.z - 0.33)), Vector((sx * 0.25, -1.0, 0.15))
    if kind == "beat":
        u = (t_loop - a) / max(1e-6, b - a)
        beat = max(0.0, math.sin(2 * math.pi * 2 * u)) ** 2  # two downward beats
        return (Vector((shoulder.x * 0.45 + sx * 0.03, shoulder.y - 0.33, shoulder.z - 0.24 - 0.07 * beat)),
                Vector((sx * 0.1, -1.0, -0.25)))
    if kind == "belt":
        return to_pose @ anchors[f"belt_{side}"], Vector((-sx * 0.35, -0.25, -0.9))
    if kind == "clasp":
        return to_pose @ anchors[f"clasp_{side}"], Vector((-sx * 0.8, -0.3, -0.45))
    return None, None


def talk_frames(rig, hands, soles, idle, stance, kit, stick_side=None, ik_blend=False):
    """Talking over the grounded idle: head nods and tilts, a lean in, and the resident's own hand gestures (TALK_STYLES).
    Feet stay planted; the loop starts and ends on the idle pose. ik_blend (crowd libraries, 7 November): the gesturing
    arm's IK solution is mixed with the idle's own arm by the gesture weight, so the elbow does not snap into the IK
    pole plane as a gesture begins (the household clips, built without it, turned the forearm up to 370 deg/s faster
    in one frame there)."""
    n = len(idle)
    T = (n - 1) / FPS
    out = []
    style = TALK_STYLES.get(kit, TALK_STYLES["child"])
    rest_hips = rig.rest["hips"]
    hz = rig.rest["hips"].translation.z
    anchors = {}
    for side, sx in (("l", 1.0), ("r", -1.0)):
        anchors[f"belt_{side}"] = _front_point(sx * 0.11, hz + 0.1)
        anchors[f"clasp_{side}"] = _front_point(sx * 0.02, hz + 0.06)
    fid = style.get("fidget")
    for i, (rot0, loc0) in enumerate(idle):
        t = i / FPS
        u = t / T
        rot, loc = lc.copy_frame((rot0, loc0))
        if fid:
            p = rest_hips @ loc["hips"]
            p.x += fid[0] * math.sin(2 * math.pi * fid[1] * u)
            loc["hips"] = rest_hips.inverted() @ p
        pose = rig.fk(rot, loc)
        lean = style["lean"] * (0.5 - 0.5 * math.cos(2 * math.pi * u))
        side_lean = 0.0
        if style.get("sideLean"):
            side_lean = style["sideLean"][1] * (1 if style["sideLean"][0] == "l" else -1) * (0.5 - 0.5 * math.cos(2 * math.pi * u))
        for bone, share in (("spine_02", 0.5), ("spine_03", 0.5)):
            q = Matrix.Rotation(math.radians(side_lean * share), 3, "Y") @ Matrix.Rotation(math.radians(lean * share), 3, "X")
            mo.set_world_rotation(rig, pose, rot, loc, bone, q @ pose[bone].to_3x3())
        nod = style["nod"] * math.sin(2 * math.pi * 3 * u) + 0.55 * style["nod"] * math.sin(2 * math.pi * 5 * u + 0.6)
        tilt = style["tilt"] * math.sin(2 * math.pi * 2 * u + 1.1)
        turn = style["turn"] * math.sin(2 * math.pi * u + 0.4)
        for bone, share in (("neck", 0.4), ("head", 0.6)):
            q = (Matrix.Rotation(math.radians(turn * share), 3, "Z") @ Matrix.Rotation(math.radians(tilt * share), 3, "Y")
                 @ Matrix.Rotation(math.radians(nod * share), 3, "X"))
            mo.set_world_rotation(rig, pose, rot, loc, bone, q @ pose[bone].to_3x3())
        for side in ("l", "r"):
            if side == stick_side:
                continue
            w, pick = 0.0, None
            for (kind, s_, a, b, k) in style["gestures"]:
                if s_ != side:
                    continue
                g = bell(u, a, b) * k
                if g > w:
                    w, pick = g, (kind, a, b)
            if w <= 1e-4:
                continue
            kind, a, b = pick
            goal, fwd = _hand_goal(kind, side, pose, rig, rest_hips, anchors, u, a, b)
            if goal is None:
                continue
            hand = pose[f"hand_{side}"]
            shoulder = pose[f"upperarm_{side}"].translation
            sx = 1.0 if side == "l" else -1.0
            target = hand.translation.lerp(goal, w)
            pole = shoulder + Vector((sx * 0.35, 0.25, -0.35))
            if kind == "offer":
                r_goal = _palm_up_rotation(hands, rig, side, pose, fwd)
            else:
                from motion_household import hand_rotation
                thumb = Vector((0.0, -0.4, 1.0)) if kind in ("beat", "belt") else Vector((0.0, -0.6, 0.8))
                r_goal = hand_rotation(hands, rig, side, fwd, thumb)
            q = hand.to_3x3().to_quaternion().slerp(r_goal.to_quaternion(), min(1.0, w * 1.1))
            # the hand bone sits at the wrist: aim the palm centre, not the wrist, at the goal
            c_local = rig.rest[f"hand_{side}"].inverted() @ hands.frames[side]["centre"]
            target = target - (q.to_matrix() @ c_local) * w
            fk_arm = {b: rot[b].copy() for b in (f"clavicle_{side}", f"upperarm_{side}", f"forearm_{side}", f"hand_{side}") if b in rot}
            mo.two_bone_ik(rig, pose, rot, loc, f"upperarm_{side}", f"forearm_{side}", f"hand_{side}", target, pole)
            mo.set_world_rotation(rig, pose, rot, loc, f"hand_{side}", q.to_matrix())
            if ik_blend:
                wb = smoothstep(min(1.0, w * 1.6))
                for b, qf in fk_arm.items():
                    qi = rot[b]
                    rot[b] = qf.slerp(qi if qf.dot(qi) >= 0 else -qi, wb)
                rig.update_chain(pose, rot, loc, f"clavicle_{side}")
            if kind == "offer":  # fingers open as the hand offers
                for finger in ("index", "middle", "ring", "pinky"):
                    for k in (1, 2, 3):
                        bn = f"{finger}_{k:02d}_{side}"
                        if bn in rot:
                            rot[bn] = rot[bn].slerp(Quaternion(), w * 0.6)
        for s_ in ("l", "r"):
            xy, heading = stance[s_]
            lc.plant_flat(rig, soles, pose, rot, loc, s_, xy, heading)
        out.append((rot, loc))
    out[-1] = lc.copy_frame(out[0])
    return out

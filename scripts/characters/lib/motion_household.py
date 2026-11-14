"""Stage: clips for the smithy household (spinner, child, elder) on the shared rig.

Original Crownfall code. Locomotion comes from 100STYLE (CC BY 4.0) gait cycles: each cycle is
retargeted, made in-place, phase-aligned at the left foot's forward-most point and blended with a
second style (for example Proud with Neutral for the spinner, Neutral with Elated for the child,
WalkingStickLeft with Neutral for the elder), then time-scaled, loop-closed and foot-locked.
Per-resident adjustments: a narrower step, a stoop with level gaze, and a walking stick whose tip
is held on the ground while the right foot is planted. Work loops are original keyframes solved
with IK: drop spindle (spinner), bellows lever (child), seated whittling (elder), plus the elder's
seated idle and sit-down transition. Clips start at t = 0; loops end on their first pose.
"""
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

import face_rig
import idle_talk as it
import locomotion as lc
import mechanisms
import stick as stick_lib
import motion as mo
import stage_motion as SM

FPS = SM.FPS


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def copy_frame(frame):
    rot, loc = frame
    return ({b: q.copy() for b, q in rot.items()}, {b: v.copy() for b, v in loc.items()})


def load(base, style, take):
    return mo.BVH(os.path.join(base, style, f"{style}_{take}.bvh"))


def keyed(t, keys, period=None):
    """Smoothly interpolated (time, value[, ease]) keys; cyclic over period when given."""
    if period:
        t = t % period
    for a in range(len(keys) - 1):
        t0, t1 = keys[a][0], keys[a + 1][0]
        if t0 <= t <= t1:
            u = (t - t0) / max(1e-6, t1 - t0)
            ease = keys[a + 1][2] if len(keys[a + 1]) > 2 else "smooth"
            u = u ** 2.2 if ease == "in" else 1 - (1 - u) ** 2 if ease == "out" else u if ease == "linear" else smooth(u)
            va, vb = keys[a][1], keys[a + 1][1]
            if isinstance(va, (tuple, list)):
                return tuple(x + (y - x) * u for x, y in zip(va, vb))
            return va + (vb - va) * u
    return keys[-1][1]


# ------------------------------------------------------------------ locomotion cycles

def gait_cycle(base, rig, style, frames):
    bvh = load(base, style, "FW")
    rt = mo.Retarget(bvh, rig)
    f0, f1 = frames
    yaw = SM.walk_yaw(bvh, f0, f1)
    info = {}
    fr = SM.retarget_frames(bvh, rt, f0, f1, yaw, info=info)
    seam = mo.seam_degrees(fr)
    travel = SM.detrend(rig, fr, "linear")
    mo.close_loop(fr)
    return {"frames": fr, "stride": travel[-1], "seconds": (len(fr) - 1) / FPS, "seam": seam, "info": info,
            "source": f"100STYLE {style}_FW frames {f0}-{f1} (60 fps), every second frame"}


def align_left_forward(rig, frames):
    """Cyclic shift so the clip starts where the left foot is furthest forward (about heel strike)."""
    ys = []
    for rot, loc in frames[:-1]:
        pose = rig.fk(rot, loc)
        ys.append(pose["foot_l"].translation.y - pose["hips"].translation.y)
    k = int(np.argmin(ys))
    body = frames[:-1]
    out = [copy_frame(f) for f in body[k:] + body[:k]]
    out.append(copy_frame(out[0]))
    return out


def resample_phase(frames, n):
    m = len(frames) - 1
    out = []
    for i in range(n + 1):
        t = i / n * m
        k = min(int(t), m - 1)
        f = t - k
        r0, l0 = frames[k]
        r1, l1 = frames[k + 1]
        rot = {b: r0[b].slerp(r1[b] if r0[b].dot(r1[b]) >= 0 else -r1[b], f) for b in r0}
        loc = {b: l0[b].lerp(l1[b], f) for b in l0}
        out.append((rot, loc))
    return out


def blend_frames(a, b, w, n):
    A, B = resample_phase(a, n), resample_phase(b, n)
    out = []
    for (r1, l1), (r2, l2) in zip(A, B):
        rot = {k: r1[k].slerp(r2[k] if r1[k].dot(r2[k]) >= 0 else -r2[k], w) for k in r1}
        loc = {k: l1[k].lerp(l2[k], w) for k in l1}
        out.append((rot, loc))
    return out


def stoop(rig, frames, spec):
    """Rounded upper back (spine flexion) with neck extension so the gaze stays near level."""
    if not spec:
        return
    for rot, loc in frames:
        pose = rig.fk(rot, loc)
        for bone, deg in (("spine_01", spec.get("spine01", 0.0)), ("spine_02", spec.get("spine02", 0.0)),
                          ("spine_03", spec.get("spine03", 0.0)), ("neck", spec.get("neck", 0.0)), ("head", spec.get("head", 0.0))):
            if deg:  # positive flexes forward (rounded back), negative extends (neck lifting the head)
                q = Quaternion((1, 0, 0), math.radians(deg))
                mo.set_world_rotation(rig, pose, rot, loc, bone, q.to_matrix() @ pose[bone].to_3x3())
        for side in ("l", "r"):
            if spec.get("shoulderForward"):
                q = Quaternion((0, 0, 1), math.radians(spec["shoulderForward"] * (1 if side == "l" else -1)))
                mo.set_world_rotation(rig, pose, rot, loc, f"clavicle_{side}", q.to_matrix() @ pose[f"clavicle_{side}"].to_3x3())


def clamp_head_pitch(rig, frames, target_deg, limit_deg=14.0):
    """After the constant correction, pull frames whose gaze pitch strays more than limit_deg from the
    target back to the band (capture actors glance at the floor at the start and end of takes)."""
    for rot, loc in frames:
        pose = rig.fk(rot, loc)
        f = pose["head"].to_3x3() @ (rig.rest["head"].to_3x3().inverted() @ Vector((0, -1, 0)))
        pitch = math.degrees(math.asin(max(-1.0, min(1.0, -f.z))))
        excess = pitch - max(target_deg - limit_deg, min(target_deg + limit_deg, pitch))
        if abs(excess) < 0.1:
            continue
        for bone, share in (("neck", 0.45), ("head", 0.55)):
            q = Quaternion((1, 0, 0), math.radians(-excess * share))
            mo.set_world_rotation(rig, pose, rot, loc, bone, q.to_matrix() @ pose[bone].to_3x3())


def narrow_stance(rig, frames, narrow):
    """Bring both feet closer to the midline over the whole clip (two-bone IK on every frame), before the
    contacts are found and locked. Narrowing only the locked targets (the first version) left the swing at
    the capture's width, so each foot slid in after landing and snapped out at lift-off."""
    if not narrow:
        return
    for rot, loc in frames:
        pose = rig.fk(rot, loc)
        for side in ("l", "r"):
            ankle = pose[f"foot_{side}"].translation.copy()
            goal = Vector((ankle.x * (1.0 - narrow), ankle.y, ankle.z))
            knee = pose[f"calf_{side}"].translation
            mo.two_bone_ik(rig, pose, rot, loc, f"thigh_{side}", f"calf_{side}", f"foot_{side}", goal, knee + Vector((0, -0.4, 0)))


def damp_arm(frames, side, keep, toward=None):
    """Shrink one arm's captured swing: each frame's clavicle, upper arm, forearm and hand rotations move toward a
    reference (`toward`: a frame's rotations, for example the idle's first, or else their mean over the clip), keeping
    `keep` of the excursion (the elder's free right hand swung back through her cloak in 22 of 49 walk frames; it now
    stays in the room the cloak leaves for it at her side and rocks a little)."""
    bones = [f"{b}_{side}" for b in ("clavicle", "upperarm", "forearm", "hand")]
    for b in bones:
        qs = [rot[b] for rot, _l in frames if b in rot]
        if not qs:
            continue
        if toward is not None and b in toward:
            acc = toward[b].copy()
        else:
            ref = qs[0]
            acc = Quaternion((0.0, 0.0, 0.0, 0.0))
            for q in qs:
                acc = acc + (q if q.dot(ref) >= 0 else -q)
            acc.normalize()
        for rot, _l in frames:
            if b in rot:
                q = rot[b] if rot[b].dot(acc) >= 0 else -rot[b]
                rot[b] = acc.slerp(q, keep)


def finish_locomotion(rig, hands, frames, stride, spec, ankle_z, report_key, rep, cyclic=True):
    """Hands, stoop and head pitch, then the walk is grounded by locomotion.lock_walk_cycle (facing its travel, slight
    toe-out, heel-flat-ball-toe roll planted on one anchor per stance, swing clearance)."""
    n = len(frames)
    travel = [stride * i / (n - 1) for i in range(n)]
    SM.add_relaxed_hands(hands, frames)
    stoop(rig, frames, spec.get("stoop"))
    pitch = SM.correct_head_pitch(rig, frames, spec.get("headPitch", 7.0))
    mo.close_loop(frames)
    narrow_stance(rig, frames, spec.get("narrow", 0.0))
    soles = lc.Soles(rig)
    windows = lc.lock_walk_cycle(rig, soles, frames, travel, rep, toe_out_deg=spec.get("toeOutDeg", 7.0))
    SM.skirt_follow(rig, frames)
    frames[-1] = lc.copy_frame(frames[0])  # the last frame repeats the first exactly
    period = n - 1
    planted = {s: [False] * n for s in ("l", "r")}
    for s in windows:
        for a, b in windows[s]:
            for u in range(a, b + 1):
                planted[s][u % period] = True
        planted[s][n - 1] = planted[s][0]
    rep["sourceHeadPitchDegrees"] = pitch
    rep["contactFrames"] = {s: [i for i, f in enumerate(planted[s]) if f] for s in planted}
    return travel, planted


def build_walk(base, rig, hands, spec, ankle_z, rep):
    a = gait_cycle(base, rig, spec["style"], spec["frames"])
    frames_a = align_left_forward(rig, a["frames"])
    seconds, stride, sources, seams = a["seconds"], a["stride"], [a["source"]], [round(a["seam"], 2)]
    frames = frames_a
    blend = spec.get("blend")
    if blend:
        b = gait_cycle(base, rig, blend["style"], blend["frames"])
        frames_b = align_left_forward(rig, b["frames"])
        w = blend["weight"]
        seconds = a["seconds"] * (1 - w) + b["seconds"] * w
        stride = a["stride"] * (1 - w) + b["stride"] * w
        n = int(round(seconds / spec.get("timeScale", 1.0) * FPS))
        frames = blend_frames(frames_a, frames_b, w, n)
        sources.append(b["source"] + f", blended at weight {w}")
        seams.append(round(b["seam"], 2))
    elif spec.get("timeScale", 1.0) != 1.0:
        frames = resample_phase(frames_a, int(round(seconds / spec["timeScale"] * FPS)))
    stride *= spec.get("strideScale", 1.0)
    info = {}
    travel, planted = finish_locomotion(rig, hands, frames, stride, spec, ankle_z, "walk", info)
    secs = (len(frames) - 1) / FPS
    rep["walk"] = {"source": "; ".join(sources), "seconds": secs, "strideMetres": round(stride, 3),
                   "speedMetresPerSecond": round(stride / secs, 3), "sourceSeamDegrees": max(seams), **info}
    return frames, travel, planted


def build_idle(base, rig, hands, spec, ankle_z, rep, walk=None, walk_spec=None, kit=None):
    """Captured stand-still take, then grounded by idle_talk: feet flat on the walk's own stance (so walk_stop ends on
    it and walk_start leaves from it), postural sway and one weight shift per loop. Returns the frames, the stance as
    ankle points (for the work loops) and the stance with headings."""
    idb = load(base, spec["style"], "ID")
    rt = mo.Retarget(idb, rig)
    i0, i1 = spec["frames"]
    yaw = SM.facing_yaw(idb, i0, i1)
    idle = SM.retarget_frames(idb, rt, i0, i1, yaw, straighten=False)
    seam = mo.seam_degrees(idle)
    SM.detrend(rig, idle, "mean")
    if spec.get("timeScale", 1.0) != 1.0:
        idle = resample_phase(idle, int(round((len(idle) - 1) / spec["timeScale"])))
    SM.add_relaxed_hands(hands, idle)
    stoop(rig, idle, spec.get("stoop"))
    pitch = SM.correct_head_pitch(rig, idle, spec.get("headPitch", 4.0))
    mo.close_loop(idle)
    SM.ground_offset(rig, idle, ankle_z, [(i, s) for i in range(0, len(idle), 5) for s in ("l", "r")])
    soles = lc.Soles(rig)
    windows = {s: [tuple(w) for w in rep["walk"]["stanceWindows"][s]] for s in ("l", "r")}
    stance_h = it.stance_from_walk(rig, soles, walk, windows, (walk_spec or {}).get("toeOutDeg", 7.0))
    layer = it.ground_idle(rig, soles, idle, stance_h, shift_side=spec.get("shiftSide", "l"), style=it.IDLE_STYLES.get(kit))
    SM.skirt_follow(rig, idle)
    z = lc.flat_ankle_z(rig, soles, "l")
    stance = {s: Vector((stance_h[s][0].x, stance_h[s][0].y, z)) for s in ("l", "r")}
    rep["idle"] = {"source": f"100STYLE {spec['style']}_ID frames {i0}-{i1} (60 fps), every second frame" +
                   (f", time scale {spec['timeScale']}" if spec.get("timeScale", 1.0) != 1.0 else "") +
                   "; feet planted flat on the walk's stance, sway and a weight shift added (Crownfall)",
                   "seconds": (len(idle) - 1) / FPS, "sourceSeamDegrees": round(seam, 2), "sourceHeadPitchDegrees": pitch,
                   "stance": {s: [round(stance_h[s][0].x, 4), round(stance_h[s][0].y, 4), round(math.degrees(stance_h[s][1]), 1)] for s in stance_h},
                   **layer}
    return idle, stance, stance_h


def build_transition(base, rig, hands, spec, idle, ankle_z, name, rep):
    idb = load(base, spec["style"], "ID")
    rt = mo.Retarget(idb, rig)
    a, b = spec["frames"]
    hy, eased = SM.transition_yaws(idb, a, b, spec["headingFrames"], name)
    fr = SM.retarget_frames(idb, rt, a, b, hy, straighten=False)
    trav = SM.detrend(rig, fr, "smooth")
    if spec.get("timeScale", 1.0) != 1.0:
        n = int(round((len(fr) - 1) / spec["timeScale"]))
        fr = resample_phase(fr, n)
        trav = list(np.interp(np.linspace(0, len(trav) - 1, n + 1), np.arange(len(trav)), trav))
    SM.damp_gestures(fr, idle[0][0], name)
    SM.add_relaxed_hands(hands, fr)
    stoop(rig, fr, spec.get("stoop"))
    SM.correct_head_pitch(rig, fr, spec.get("headPitch", 7.0))
    clamp_head_pitch(rig, fr, spec.get("headPitch", 7.0))
    ankt, plt = SM.contacts_from_motion(rig, fr, trav, ankle_z, height_tol=0.05)
    SM.ground_offset(rig, fr, ankle_z, [(i, s) for s in plt for i, f in enumerate(plt[s]) if f])
    narrow_stance(rig, fr, spec.get("narrow", 0.0))
    ankt, plt = SM.contacts_from_motion(rig, fr, trav, ankle_z, height_tol=0.05)
    SM.lock_feet(rig, fr, ankle_z, SM.make_lock_fn(ankt, plt, trav, ankle_z, False))
    SM.skirt_follow(rig, fr, cyclic=False)
    SM.blend_into(fr, [idle[k] for k in range(8)], 8, at_end=(name == "walk_stop"))
    rep[name] = {"source": f"100STYLE {spec['style']}_ID frames {a}-{b} (60 fps), every second frame", "seconds": (len(fr) - 1) / FPS,
                 "headingEasedDegrees": round(eased, 1), "rootTravelMetres": [round(float(x), 4) for x in trav]}
    return fr, trav, plt


# ------------------------------------------------------------------ props held in a hand

def prop_axis_world(hand_rot, grip, local_axis):
    return (hand_rot @ grip.to_3x3() @ Vector(local_axis)).normalized()


def place_hand_for_prop(rig, pose, rot, loc, side, prop_world, grip, pole):
    """Hand transform that carries a rigid prop (prop_world, 4x4) through the hand grip; arm by two-bone IK."""
    hand = prop_world @ grip.inverted()
    mo.two_bone_ik(rig, pose, rot, loc, f"upperarm_{side}", f"forearm_{side}", f"hand_{side}", hand.translation, pole)
    mo.set_world_rotation(rig, pose, rot, loc, f"hand_{side}", hand.to_3x3())
    return hand


def stick_frames(rig, frames, travel, stance_flags, stick, grip, cyclic, lift=0.05):
    """Walking stick in the left hand: the tip stays on its ground spot while the right foot is planted and
    swings forward on a low arc in between; the grip follows the captured hand height."""
    n = len(frames)
    length = stick["length"]
    tip_local = Vector((0.0, 0.0, -length))  # prop frame: grip at the origin, stick along -Z
    planted = list(stance_flags)
    runs, i = [], 0
    while i < n:
        if planted[i]:
            j = i
            while j < n and planted[j]:
                j += 1
            runs.append((i, j - 1))
            i = j
        else:
            i += 1
    poses = [rig.fk(*f) for f in frames]
    # mocap grip points (the hand's palm), used for stick inclination
    grips = [(p["hand_l"] @ grip).translation for p in poses]
    anchors = [None] * n
    for (a, b) in runs:
        mid = (a + b) // 2
        g = grips[mid]
        base = Vector((g.x + stick.get("tipOut", 0.04), g.y - stick.get("tipAhead", 0.06), 0.0))
        for k in range(a, b + 1):
            anchors[k] = Vector((base.x, base.y + (travel[k] - travel[mid]), 0.0))
    # swing: interpolate between the surrounding stance anchors (wrapping for cycles)
    filled = [a for a in anchors]
    for k in range(n):
        if filled[k] is not None:
            continue
        prev = next(((k - d) % n for d in range(1, n) if anchors[(k - d) % n] is not None and (cyclic or k - d >= 0)), None)
        nxt = next(((k + d) % n for d in range(1, n) if anchors[(k + d) % n] is not None and (cyclic or k + d < n)), None)
        if prev is None and nxt is None:
            filled[k] = Vector((grips[k].x + 0.04, grips[k].y - 0.06, 0.0))
            continue
        if prev is None:
            filled[k] = anchors[nxt].copy()
            continue
        if nxt is None:
            filled[k] = anchors[prev].copy()
            continue
        dp = (k - prev) % n
        dn = (nxt - k) % n
        u = dp / max(1, dp + dn)
        pa = anchors[prev] + Vector((0.0, travel[k] - travel[prev] if cyclic else travel[k] - travel[prev], 0.0)) * 0.0
        pb = anchors[nxt]
        # the ground drifts backward (+Y) while the stick swings forward in the in-place frame
        a_end = Vector((anchors[prev].x, anchors[prev].y + (travel[k] - travel[prev]) if k >= prev else anchors[prev].y + travel[k] + (travel[-1] - travel[prev]), 0.0))
        b_start = Vector((anchors[nxt].x, anchors[nxt].y - ((travel[nxt] - travel[k]) if nxt >= k else (travel[-1] - travel[k]) + travel[nxt]), 0.0))
        p = a_end.lerp(b_start, smooth(u))
        p.z = lift * math.sin(math.pi * u)
        filled[k] = p
    for k, (rot, loc) in enumerate(frames):
        pose = poses[k]
        tip = filled[k]
        hand_m = pose["hand_l"]
        g = grips[k]
        axis = (g - tip).normalized()  # from tip up to the grip
        current = prop_axis_world(hand_m.to_3x3(), grip, (0.0, 0.0, 1.0))
        r_hand = current.rotation_difference(axis).to_matrix() @ hand_m.to_3x3()
        stick_rot = r_hand @ grip.to_3x3()
        grip_point = tip + stick_rot @ Vector((0.0, 0.0, length))
        prop_world = Matrix.Translation(grip_point) @ stick_rot.to_4x4()
        pole = pose["upperarm_l"].translation + Vector((0.35, 0.25, -0.2))
        place_hand_for_prop(rig, pose, rot, loc, "l", prop_world, grip, pole)
    return filled


# ------------------------------------------------------------------ the elder's stick across clips

def hold_static(stk, frames, tip, ends=None):
    """Keep the stick planted at one ground point; the grip follows the captured stick hand (smoothed), or, for a
    transition, eases between the grips of the clips at its two ends (`ends`: (first, last) grip points)."""
    if ends is None:
        want = stick_lib.smooth_points(stick_lib.hand_grips(stk, frames), cyclic=False, k=4)
    else:
        n = len(frames)
        want = [ends[0].lerp(ends[1], smooth(i / max(1, n - 1))) for i in range(n)]
    return stick_lib.apply(stk, frames, [tip.copy() for _ in frames], want)


def cloak_front_y(x_side=0.12, z_range=(0.3, 0.95)):
    """Front edge of the cloak's left panel at rest (in-place frame, Blender -Y forward): the front-most cloak vertex on
    the stick side between hem and hand height. None when the resident wears no cloak."""
    clothes = bpy.data.objects.get("Clothes")
    if clothes is None:
        return None
    names = list(clothes.get("garment_names", []))
    attr = clothes.data.attributes.get("garment_piece")
    if attr is None or "Cloak" not in names:
        return None
    k = names.index("Cloak")
    piece = np.zeros(len(clothes.data.polygons), dtype=np.int32)
    attr.data.foreach_get("value", piece)
    verts = {v for p in clothes.data.polygons if piece[p.index] == k for v in p.vertices}
    mw = clothes.matrix_world
    ys = [(mw @ clothes.data.vertices[i].co) for i in verts]
    ys = [c.y for c in ys if c.x > x_side and z_range[0] <= c.z <= z_range[1]]
    return min(ys) if ys else None


def elder_stick(rig, soles, stk, walk, travel, windows, idle, start, start_trav, stop, stop_trav, stop_info, stance_h, rep,
                spec=None):
    """Plant the stick with the right foot in the walk, start and stop, and hold one plant in the idle (and talk and
    sitting): see stick.py. Round 2: the walk plant lands with the right heel and lifts when the tip reaches the cloak's
    front edge (it used to stay down to the right toe-off and lean back through the cloak); the hand is kept in front
    of the cloak's opening, moving back over the planted stick and forward with the swing; walk_start leaves from the
    idle plant and eases into the walk's swing, walk_stop continues the walk's swing and lands on the idle plant."""
    spec = spec or {}
    x_l = stance_h["l"][0].x
    front = cloak_front_y()
    lift_y = (front if front is not None else -0.11) + spec.get("liftBehindFrontEdge", 0.0)
    tip_idle = Vector((x_l + stick_lib.OUT, spec.get("idleTipY", -0.2), 0.0))
    probe = lc.copy_frame(idle[0])
    stk.set_canonical(probe, tip_idle, stk.grip_point(rig.fk(*idle[0])))
    g_idle = stk.grip_point(rig.fk(*idle[0]))
    period = len(walk) - 1
    stride = travel[-1]
    v_walk = stride / period

    def trav_walk(u):
        return travel[u % period] + (u // period) * stride
    plants = []
    for (a, b) in windows["r"]:
        heel = soles.points(rig.fk(*walk[a % period]), "r")["heel"]
        p = stick_lib.plant_point(Vector((x_l, 0.0, 0.0)), heel)
        plants.append((a, stick_lib.lift_frame(a, b, p, trav_walk, lift_y), p))
    tips = stick_lib.tip_track(len(walk), travel, plants, True, stride)
    # where the hand wants to be: in front of the cloak's opening, moving back over the planted stick (the body passes
    # it) and forward again with the swing; its height follows the captured stick hand
    yf, yb = spec.get("handForwardY", -0.27), spec.get("handBackY", -0.21)
    captured = stick_lib.smooth_points(stick_lib.hand_grips(stk, walk), cyclic=True, k=3)
    a0, b0, _p0 = plants[0]
    a1 = a0 + period

    def want_y(u):  # u: walk frame (unwrapped from a0)
        if u <= b0:
            return yf + (yb - yf) * (u - a0) / max(1, b0 - a0)
        return yb + (yf - yb) * smooth((u - b0) / max(1, a1 - b0))
    want = []
    for k in range(len(walk)):
        u = k if k >= a0 else k + period
        want.append(Vector((tips[k].x - 0.03, want_y(u), captured[k].z)))
    want = stick_lib.smooth_points(want, cyclic=True, k=2)
    tip_err = {"walk": stick_lib.apply(stk, walk, tips, want, cyclic=True)}
    walk[-1] = lc.copy_frame(walk[0])
    walk_tips = tips
    # idle: one plant
    tip_err["idle"] = hold_static(stk, idle, tip_idle)
    idle[-1] = lc.copy_frame(idle[0])
    # walk_start: planted on the idle plant until the tip reaches the front edge, then a swing toward the walk's next
    # plant (its landing frame after the clip); the last frames ease into the walk's own tips at its frame 0
    n = len(start)
    b_s = stick_lib.lift_frame(0, n - 1, tip_idle, lambda u: start_trav[max(0, min(n - 1, u))], lift_y)
    nxt = (n - 1 + a0, n - 1 + b0, plants[0][2])
    tips = stick_lib.tip_track(n, start_trav, [(0, b_s, tip_idle), nxt], False, speed=v_walk)
    K = min(8, n // 2)
    tips = stick_lib.blend_tips(tips, [walk_tips[(period - K + 1 + k) % period] for k in range(K)], K, at_end=True)
    want = [g_idle.lerp(Vector((walk_tips[0].x - 0.03, want_y(period), captured[0].z)), smooth(i / max(1, n - 1))) for i in range(n)]
    tip_err["walk_start"] = stick_lib.apply(stk, start, tips, want)
    start[0] = lc.copy_frame(idle[0])
    start[-1] = lc.copy_frame(walk[0])
    # walk_stop: the walk's swing continues (the plant it lifted from is before the clip) and lands on the idle plant
    # in the frame of the closing step's landing; planted to the end
    n = len(stop)
    _to_r, land = stop_info["closingStepFrames"]
    land = max(6, min(land, n - 4))
    prev = plants[0]
    lifted = (prev[0] - period, prev[1] - period, prev[2])  # the walk's last plant, in stop frames (before frame 0)
    p1 = tip_idle - Vector((0.0, stop_trav[-1] - stop_trav[land], 0.0))
    tips = stick_lib.tip_track(n, stop_trav, [lifted, (land, n - 1, p1)], False, speed=v_walk)
    tips = stick_lib.blend_tips(tips, [walk_tips[k] for k in range(K)], K, at_end=False)
    want = [Vector((walk_tips[0].x - 0.03, want_y(period), captured[0].z)).lerp(g_idle, smooth(i / max(1, n - 1))) for i in range(n)]
    tip_err["walk_stop"] = stick_lib.apply(stk, stop, tips, want)
    stop[0] = lc.copy_frame(walk[0])
    stop[-1] = lc.copy_frame(idle[0])
    rep["idle"]["stick"] = {"tipBlender": [round(v, 4) for v in tip_idle], "length": round(stk.L, 4),
                            "cloakFrontYBlender": round(front, 4) if front is not None else None, "liftAtYBlender": round(lift_y, 4),
                            "walkPlantFrames": [[a, b] for a, b, _p in plants],
                            "rule": "tip 19 cm outside the left ankle; lands 24 cm ahead of the right heel as the right heel strikes, "
                                    "comes down vertically and lifts straight up before the shaft can reach the cloak (liftAtYBlender); "
                                    "the fist 2 cm below the top; the hand stays in front of the cloak's opening",
                            "plantedTipHeightCm": {k: round(v * 100, 2) for k, v in tip_err.items()}}
    return {"tip": tip_idle}


# ------------------------------------------------------------------ work loops (original keyframes)

def standing_base(rig, idle_frame, ankle_z, stance=None):
    rot, loc = copy_frame(idle_frame)
    pose = rig.fk(rot, loc)
    feet = stance or {s: Vector((pose[f"foot_{s}"].translation.x, pose[f"foot_{s}"].translation.y, ankle_z)) for s in ("l", "r")}
    return rot, loc, feet


SOLES = {}  # the resident's sole points, set by run() (locomotion.Soles)
TOE_OUT = math.radians(7.0)


def plant_feet(rig, pose, rot, loc, feet, yaw_deg=None):
    """Plant both feet flat at their ankle points with an absolute heading (toe-out in degrees, default the idle's
    7 degrees). The first version levelled only the toe vector's height, which left the captured pitch and roll: the
    child's bellows shoes were toes-down and up to 6 cm under the ground."""
    soles = SOLES["soles"]
    for side in ("l", "r"):
        heading = math.radians(yaw_deg[side]) if yaw_deg else (TOE_OUT if side == "l" else -TOE_OUT)
        # a pole fixed by the hip and the foot (the knee over the toes), not by the current knee: the same targets then
        # give the same leg in every clip, so seated clips and their transitions meet without a knee swivel pop
        hip = pose[f"thigh_{side}"].translation
        mid = (hip + Vector((feet[side][0], feet[side][1], 0.0))) * 0.5
        pole = mid + Vector((math.sin(heading) * 0.5 + (0.04 if side == "l" else -0.04), -math.cos(heading) * 0.5, 0.0))
        lc.plant_flat(rig, soles, pose, rot, loc, side, feet[side], heading, pole=pole)


def look_at(rig, pose, rot, loc, target, share=0.8):
    for bone, part in (("neck", 0.45), ("head", 0.55)):
        hp = pose[bone].translation
        look = (target - hp).normalized()
        fwd = pose["head"].to_3x3() @ (rig.rest["head"].to_3x3().inverted() @ Vector((0, -1, 0)))
        q = Quaternion().slerp(fwd.rotation_difference(look), part * share)
        mo.set_world_rotation(rig, pose, rot, loc, bone, q.to_matrix() @ pose[bone].to_3x3())


def spine_flex(rig, pose, rot, loc, flex_deg, twist_deg=0.0, side_deg=0.0, shares=(0.35, 0.35, 0.3)):
    for bone, share in zip(("spine_01", "spine_02", "spine_03"), shares):
        # +X rotation in the armature frame tips the spine toward -Y, the character's front: positive flex leans forward
        q = (Quaternion((0, 0, 1), math.radians(twist_deg * share)) @ Quaternion((0, 1, 0), math.radians(side_deg * share))
             @ Quaternion((1, 0, 0), math.radians(flex_deg * share)))
        mo.set_world_rotation(rig, pose, rot, loc, bone, q.to_matrix() @ pose[bone].to_3x3())


def hips_offset(rig, rot, loc, base_loc, d):
    p = rig.rest["hips"] @ base_loc + Vector(d)
    loc["hips"] = rig.rest["hips"].inverted() @ p


def hand_rotation(hands, rig, side, axis_w, thumb_w):
    """World rotation of a hand bone whose knuckle axis points along axis_w and thumb side toward thumb_w."""
    f = hands.frames[side]
    a, c = f["axis"], f["across"]
    a2 = Vector(axis_w).normalized()
    t = Vector(thumb_w)
    c2 = (t - a2 * t.dot(a2)).normalized()
    src = Matrix((a, c, a.cross(c))).transposed()
    dst = Matrix((a2, c2, a2.cross(c2))).transposed()
    return dst @ src.inverted() @ rig.rest[f"hand_{side}"].to_3x3()


def hand_at(hands, rig, side, rot_world, palm_point):
    """Hand bone world matrix that puts the palm centre on palm_point with the given rotation."""
    rest = rig.rest[f"hand_{side}"]
    c_local = rest.inverted() @ hands.frames[side]["centre"]
    return Matrix.Translation(Vector(palm_point) - rot_world @ c_local) @ rot_world.to_4x4()


def set_hand(rig, pose, rot, loc, side, hand, pole):
    mo.two_bone_ik(rig, pose, rot, loc, f"upperarm_{side}", f"forearm_{side}", f"hand_{side}", hand.translation, pole)
    mo.set_world_rotation(rig, pose, rot, loc, f"hand_{side}", hand.to_3x3())


def head_clearance(rig, frames, grip_l, head_radius=0.105, arm_radius=0.04):
    """Smallest gap over the clip between the head (a sphere round the skull centre, cap and hair included) and the
    fibre arm (forearm to hand, as a capsule) and the fibre roll held in the fibre hand: the twirl must keep at least
    5 cm (round 2 critic: her face pressed against the raised forearm)."""
    roll = bpy.data.objects.get("prop_fibre_roll")
    roll_co = [v.co.copy() for v in roll.data.vertices] if roll is not None else []
    worst_arm, worst_roll = 9.0, 9.0
    at_arm = at_roll = 0.0
    above = -9.0
    for i, (rot, loc) in enumerate(frames):
        pose = rig.fk(rot, loc)
        above = max(above, pose["hand_l"].translation.z - pose["upperarm_l"].translation.z)
        head = pose["head"]
        centre = head @ Vector((0.0, rig.length["head"] * 0.55, -0.02))  # bone +Y runs up the head; -Z is the face side
        a, b = pose["forearm_l"].translation, pose["hand_l"].translation
        ab = b - a
        tt = max(0.0, min(1.0, (centre - a).dot(ab) / max(1e-9, ab.length_squared)))
        d_arm = (centre - (a + ab * tt)).length - head_radius - arm_radius
        if d_arm < worst_arm:
            worst_arm, at_arm = d_arm, i / FPS
        if roll_co:
            m = pose["hand_l"] @ grip_l
            d_roll = min((m @ c - centre).length for c in roll_co[::3]) - head_radius
            if d_roll < worst_roll:
                worst_roll, at_roll = d_roll, i / FPS
    out = {"headToFibreArmMinCm": round(worst_arm * 100, 1), "headToFibreArmAtSeconds": round(at_arm, 2),
           "fibreWristAboveShoulderMaxCm": round(above * 100, 1)}
    if roll_co:
        out.update({"headToFibreRollMinCm": round(worst_roll * 100, 1), "headToFibreRollAtSeconds": round(at_roll, 2)})
    return out


def spindle_loop(rig, hands, recipe, idle0, stance, ankle_z):
    """Standing drop spindle: the left fist holds the fibre with the yarn running out of its little-finger
    side to the spindle hanging below; the right hand drafts down the yarn twice, then reaches down and
    twirls the spindle shaft. The spindle prop rides in the left hand and keeps the yarn vertical."""
    spec = recipe["motion"]["work"]
    T = spec["seconds"]
    n = int(round(T * FPS)) + 1
    shoulder_l = rig.rest["upperarm_l"].translation
    shoulder_r = rig.rest["upperarm_r"].translation
    fibre = Vector((shoulder_l.x - spec.get("fibreInward", 0.05), shoulder_l.y - spec.get("fibreForward", 0.27), shoulder_l.z - spec.get("fibreBelowShoulder", 0.05)))
    # fibre hand: knuckles forward and a little down, thumb and index pinching the fibre at the bottom
    rot_l = hand_rotation(hands, rig, "l", spec.get("fibreAxis", (-0.2, -0.85, -0.3)), spec.get("fibreThumb", (0.05, 0.1, -1.0)))
    across_l = (rot_l @ rig.rest["hand_l"].to_3x3().inverted() @ hands.frames["l"]["across"]).normalized()
    drop = spec.get("yarnDrop", 0.44)
    yarn_top0 = fibre + across_l * 0.035
    hand0 = hand_at(hands, rig, "l", rot_l, fibre)
    grip_l = hand0.inverted() @ Matrix.Translation(yarn_top0)
    # the twirl (round 2): the fibre hand rises to just below shoulder height and moves out to her left, lifting the
    # spindle to her left hip, while she turns toward it, leans a little and bends her knees; the right hand flicks the
    # shaft there. Round 1 brought the fibre hand in front of her face and bent her 28 degrees with a 7 cm dip: her face
    # pressed against the raised forearm in profile.
    tw = Vector(spec.get("twirlFibreShift", (0.06, -0.01, 0.08)))
    left_keys = [(0.0, (0.0, 0.0, 0.0)), (0.6, (0.0, 0.01, 0.012)), (1.5, (0.0, 0.0, 0.0)), (2.1, (0.0, 0.01, 0.012)), (2.65, (0.0, 0.0, 0.0)),
                 (3.0, tuple(tw)), (3.4, tuple(tw * 0.94)), (3.75, (0.0, 0.0, 0.0)), (T, (0.0, 0.0, 0.0))]
    pinch_top = yarn_top0 + Vector((0.0, 0.0, -0.06))
    pinch_low = pinch_top + Vector((0.0, 0.0, -0.13))
    spindle_top = yarn_top0 + Vector((0.0, 0.0, -drop))
    twirl_top = spindle_top + tw
    right_keys = [(0.0, tuple(pinch_top)), (0.55, tuple(pinch_low), "out"), (0.8, tuple(pinch_low + Vector((-0.04, -0.03, 0.02)))),
                  (1.2, tuple(pinch_top)), (1.95, tuple(pinch_low), "out"), (2.2, tuple(pinch_low + Vector((-0.04, -0.03, 0.02)))),
                  (2.75, tuple(twirl_top + Vector((-0.05, -0.03, 0.08)))), (3.05, tuple(twirl_top + Vector((-0.025, -0.01, 0.0)))),
                  (3.35, tuple(twirl_top + Vector((0.02, -0.035, 0.0))), "out"), (3.65, tuple(twirl_top + Vector((-0.06, -0.04, 0.1)))),
                  (T, tuple(pinch_top))]
    twirl_keys = [(0.0, 0.0), (2.95, 0.0), (3.05, 20.0), (3.35, -60.0, "out"), (3.65, 0.0), (T, 0.0)]
    look_keys = [(0.0, 0.0), (0.9, 0.3), (1.6, 0.0), (2.5, 0.4), (3.0, 1.0), (3.5, 1.0), (3.9, 0.0), (T, 0.0)]
    hips_bob = [(0.0, 0.0), (0.9, -0.006), (1.8, 0.0), (2.7, -0.006), (3.25, -spec.get("twirlKneeDipM", 0.065)), (3.7, -0.014), (T, 0.0)]
    frames = []
    for i in range(n):
        t = i / FPS
        rot, loc, feet = standing_base(rig, idle0, ankle_z, stance)
        base_loc = loc["hips"].copy()
        hips_offset(rig, rot, loc, base_loc, (0.0, 0.0, keyed(t, hips_bob)))
        pose = rig.fk(rot, loc)
        reach = keyed(t, look_keys)
        bend = smooth((t - 2.8) / 0.25) * (1.0 - smooth((t - 3.45) / 0.3))
        # turn toward the spindle at her left hip and lean a little (twist > 0 turns the chest to her left)
        spine_flex(rig, pose, rot, loc, 5.0 + 10.0 * reach + spec.get("twirlLeanDeg", 21.0) * bend, twist_deg=-6.0 - 4.0 * reach + spec.get("twirlTurnDeg", 30.0) * bend)
        yarn_top = yarn_top0 + Vector(keyed(t, left_keys))
        # the fist tips the fibre roll forward and out, away from her face as she leans in
        lean = Matrix.Rotation(math.radians(30.0 * bend), 3, "X") @ Matrix.Rotation(math.radians(22.0 * bend), 3, "Y")
        hand_l = Matrix.Translation(yarn_top) @ lean.to_4x4() @ grip_l.inverted()
        set_hand(rig, pose, rot, loc, "l", hand_l, shoulder_l + Vector((0.4, 0.15, -0.3)))
        twirl = math.radians(keyed(t, twirl_keys))
        axis_r = Matrix.Rotation(twirl, 3, "Z") @ Vector((0.55, -0.6, -0.1 - 0.5 * reach))
        rot_r = hand_rotation(hands, rig, "r", axis_r, (0.2, 0.0, 1.0))
        set_hand(rig, pose, rot, loc, "r", hand_at(hands, rig, "r", rot_r, Vector(keyed(t, right_keys))), shoulder_r + Vector((-0.4, 0.2, -0.3)))
        # the head stays up and the gaze drops to the spindle (the eyes and the face rig do the rest)
        look_at(rig, pose, rot, loc, yarn_top.lerp(spindle_top + tw * bend, reach), 0.85 - 0.55 * bend)
        # and the neck lifts the head against the lean, so she looks down at the spindle without folding over it
        for bone, share in (("neck", 0.5), ("head", 0.5)):
            q = Quaternion((1, 0, 0), math.radians(-14.0 * bend * share))
            mo.set_world_rotation(rig, pose, rot, loc, bone, q.to_matrix() @ pose[bone].to_3x3())
        plant_feet(rig, pose, rot, loc, feet)
        frames.append((rot, loc))
    pinch = {"index": (35, 30, 20), "middle": (55, 60, 35), "ring": (65, 70, 40), "pinky": (70, 75, 45)}
    curl = {**hands.curl("l", SM.GRIP, (35, 30, 20)), **hands.curl("r", pinch, (30, 25, 15))}
    for rot, _l in frames:
        rot.update(curl)
    # the twirl: the right thumb and index pinch the shaft just below the yarn (the first loop's twirl stopped 20 cm
    # above it); correct the hand so the pinch point lies on the spindle shaft, which hangs plumb from the yarn
    def pinch_point(pose):
        tips = []
        for b in ("index_03_r", "thumb_03_r"):
            tips.append(pose[b] @ Vector((0.0, rig.length[b], 0.0)))
        return (tips[0] + tips[1]) * 0.5
    gaps = []
    for i, (rot, loc) in enumerate(frames):
        t = i / FPS
        w = smooth((t - 2.8) / 0.2) * (1.0 - smooth((t - 3.45) / 0.22))
        if w <= 0.0:
            continue
        yarn_top = yarn_top0 + Vector(keyed(t, left_keys))
        shaft = yarn_top + Vector((0.0, 0.0, -drop - 0.035))
        for _it in range(5):
            pose = rig.fk(rot, loc)
            err = shaft - pinch_point(pose)
            hand = pose["hand_r"].copy()
            target = hand.translation + err * w
            mo.two_bone_ik(rig, pose, rot, loc, "upperarm_r", "forearm_r", "hand_r", target, shoulder_r + Vector((-0.4, 0.2, -0.3)))
            mo.set_world_rotation(rig, pose, rot, loc, "hand_r", hand.to_3x3())
        if 3.1 <= t <= 3.4:
            gaps.append((shaft - pinch_point(rig.fk(rot, loc))).length)
    SM.skirt_follow(rig, frames)
    clear = head_clearance(rig, frames, grip_l)
    return frames, grip_l, {"yarnTopBlender": list(yarn_top0), "yarnDropMetres": drop, "draftSeconds": [0.0, 0.55, 1.2, 1.95], "twirlSeconds": 3.35,
                            "twirlPinchToShaftCm": [round(min(gaps) * 100, 2), round(max(gaps) * 100, 2)] if gaps else None,
                            **clear}


def bellows_loop(rig, hands, recipe, idle0, ankle_z):
    """Two-handed bellows lever: pull the crossbar down with the whole body leaning in, let it rise.
    The lever prop rides in the right hand; both hands are solved on the crossbar every frame."""
    spec = recipe["motion"]["work"]
    T = spec["seconds"]
    n = int(round(T * FPS)) + 1
    lv = recipe["props"]["lever"]
    pivot = Vector(lv["pivot"])
    length = lv["length"]
    shoulder_l, shoulder_r = rig.rest["upperarm_l"].translation, rig.rest["upperarm_r"].translation
    feet = {"l": Vector((0.09, -0.06, ankle_z)), "r": Vector((-0.1, 0.12, ankle_z))}
    up_deg, down_deg = lv["upDegrees"], lv["downDegrees"]
    # each pull starts from rest with a smooth ease (an 'out' ease from rest made the loop seam jump 13 degrees a frame)
    angle = [(0.0, up_deg), (0.42, down_deg), (0.55, down_deg), (1.25, up_deg), (T / 2, up_deg),
             (T / 2 + 0.42, down_deg), (T / 2 + 0.55, down_deg), (T / 2 + 1.25, up_deg), (T, up_deg)]
    frames, lever_world = [], []
    for i in range(n):
        t = i / FPS
        theta = math.radians(keyed(t, angle))
        k = (math.degrees(theta) - up_deg) / (down_deg - up_deg)
        rot, loc, _f = standing_base(rig, idle0, ankle_z)
        base_loc = loc["hips"].copy()
        hips_offset(rig, rot, loc, base_loc, (0.0, -0.035 - 0.04 * k, -0.04 - 0.05 * k))
        pose = rig.fk(rot, loc)
        spine_flex(rig, pose, rot, loc, 10.0 + 18.0 * k, twist_deg=4.0)
        lever = Matrix.Translation(pivot) @ Matrix.Rotation(theta, 4, "X")
        lever_world.append(lever)
        handle = lever @ Matrix.Translation(Vector((0.0, length, 0.0)))
        lever_y = (lever.to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()
        for side, x, thumb, pole_off in (("l", 0.075, Vector((-1.0, 0.0, 0.0)), Vector((0.35, 0.15, -0.3))),
                                          ("r", -0.075, Vector((1.0, 0.0, 0.0)), Vector((-0.35, 0.15, -0.3)))):
            bar_point = (handle @ Matrix.Translation(Vector((x, 0.0, 0.0)))).translation
            # overhand grip: knuckles toward the pivot and a little down, thumbs pointing inward
            axis = (-lever_y + Vector((0.0, 0.0, -0.35))).normalized()
            rot_h = hand_rotation(hands, rig, side, axis, thumb)
            palm = bar_point + (rot_h @ rig.rest[f"hand_{side}"].to_3x3().inverted() @ hands.frames[side]["palm"]) * 0.022
            set_hand(rig, pose, rot, loc, side, hand_at(hands, rig, side, rot_h, palm), (shoulder_l if side == "l" else shoulder_r) + pole_off)
        look_at(rig, pose, rot, loc, Vector(recipe["props"]["hearthLook"]), 0.7)
        plant_feet(rig, pose, rot, loc, feet, {"l": 8, "r": -14})
        frames.append((rot, loc))
    curl = {**hands.curl("r", SM.GRIP, (40, 35, 25)), **hands.curl("l", SM.GRIP, (40, 35, 25))}
    for rot, _l in frames:
        rot.update(curl)
    SM.skirt_follow(rig, frames)
    lever_world[-1] = lever_world[0].copy()
    mech = mechanisms.bellows(recipe, lever_world)
    # contact check: both palms on the crossbar of the animated lever every frame
    worst = 0.0
    for i, (rot, loc) in enumerate(frames):
        pose = rig.fk(rot, loc)
        bar = lever_world[i] @ Vector((0.0, length, 0.0))
        for side in ("l", "r"):
            palm = pose[f"hand_{side}"] @ (rig.rest[f"hand_{side}"].inverted() @ hands.frames[side]["centre"])
            worst = max(worst, abs((palm - bar).length - math.hypot(0.075, 0.022)))
    return frames, None, {"feet": {k: list(v) for k, v in feet.items()}, "pumpsPerLoop": 2, "pivotBlender": list(pivot),
                          "leverDegrees": [up_deg, down_deg], "palmToBarErrorCm": round(worst * 100, 2), **mech}


def seated_pose(rig, ankle_z, seat, feet, hips_back=0.0):
    rot, loc = {}, {}
    hips_rest = rig.rest["hips"].translation
    p = Vector((0.0, seat["y"] + hips_back, seat["height"] + seat.get("hipAboveSeat", 0.085)))
    loc["hips"] = rig.rest["hips"].inverted() @ p
    return rot, loc

KNIFE_EDGE = Vector((0.0, 0.128, -0.0075))  # mid-edge of the whittling knife's blade in its tool frame


def spoon_carve_surface():
    """Surface points of the spoon (tool frame: butt at the origin, long axis +Y) along its neck and the back of the
    bowl, as a function of stroke progress 0..1."""
    spoon = bpy.data.objects["prop_spoon"]
    co = np.array([list(v.co) for v in spoon.data.vertices])
    length = float(co[:, 1].max())
    ys = np.linspace(0.42 * length, 0.78 * length, 13)
    pts = []
    for y in ys:
        sel = co[np.abs(co[:, 1] - y) < max(0.004, 0.02 * length)]
        if not len(sel):
            continue
        mid = sel[np.abs(sel[:, 0] - np.median(sel[:, 0])) < 0.008] if len(sel) > 3 else sel
        top = mid[np.argmax(mid[:, 2])]
        pts.append(Vector((float(np.median(sel[:, 0])), float(y), float(top[2]))))

    def at(u):
        u = max(0.0, min(1.0, u)) * (len(pts) - 1)
        k = min(int(u), len(pts) - 2)
        return pts[k].lerp(pts[k + 1], u - k)
    return at



def seated_frames(rig, hands, recipe, ankle_z, kind, stance=None, stick_grip=None, stick_top=None):
    """Seated loops on the stool: 'carve' (whittling a spoon away from the body, turning it, blowing off
    the shavings) or 'sit' (resting, hands on the knees, looking about). The tools ride in the hands
    through the standard grips (handle across the palm, as for the smith's hammer)."""
    spec = recipe["motion"]["seated"]
    seat = recipe["props"]["seat"]
    T = spec["carveSeconds"] if kind == "carve" else spec["sitSeconds"]
    n = int(round(T * FPS)) + 1
    ahead = seat.get("feetAhead", 0.42)
    feet = ({s: v.copy() for s, v in stance.items()} if stance else
            {"l": Vector((0.11, seat["y"] - ahead, ankle_z)), "r": Vector((-0.11, seat["y"] - ahead + 0.04, ankle_z))})
    if stance:
        seat = dict(seat, y=float((feet["l"].y + feet["r"].y) / 2 + ahead))
    grip_r = hands.grip_matrix("r", recipe["props"].get("knifeGrip", 0.05))
    grip_l = hands.grip_matrix("l", recipe["props"].get("spoonGrip", 0.07))
    shoulder_l, shoulder_r = rig.rest["upperarm_l"].translation, rig.rest["upperarm_r"].translation
    frames = []
    work = Vector((0.03, seat["y"] - 0.3, seat["height"] + 0.17))
    breath = [(0.0, 0.0), (T / 4, 0.004), (T / 2, 0.0), (3 * T / 4, 0.004), (T, 0.0)]
    if kind == "carve":
        stroke = [(0.0, 0.0), (0.35, 1.0), (0.6, 0.0), (0.95, 1.0), (1.2, 0.0), (1.55, 1.0), (1.8, 0.0),
                  (2.15, 1.0), (2.4, 0.0), (T, 0.0)]
        turn = [(0.0, 0.0), (2.5, 0.0), (2.9, 65.0), (3.3, 65.0), (3.7, 0.0), (T, 0.0)]
        blow = [(0.0, 0.0), (2.5, 0.0), (2.85, 1.0), (3.35, 1.0), (3.7, 0.0), (T, 0.0)]
        head_turn = [(0.0, 0.0), (T, 0.0)]
    else:
        stroke = turn = blow = [(0.0, 0.0), (T, 0.0)]
        head_turn = [(0.0, 0.0), (T * 0.3, 14.0), (T * 0.55, 14.0), (T * 0.8, -8.0), (T, 0.0)]
    carve_surface = spoon_carve_surface() if kind == "carve" else None
    cut_gaps = []
    for i in range(n):
        t = i / FPS
        rot, loc = seated_pose(rig, ankle_z, seat, feet)
        base_loc = loc["hips"].copy()
        hips_offset(rig, rot, loc, base_loc, (0.0, 0.0, keyed(t, breath)))
        pose = rig.fk(rot, loc)
        mo.set_world_rotation(rig, pose, rot, loc, "hips", Quaternion((1, 0, 0), math.radians(8.0)).to_matrix() @ pose["hips"].to_3x3())
        flex = (spec.get("carveFlex", 26.0) + 5.0 * keyed(t, blow)) if kind == "carve" else spec.get("sitFlex", 14.0)
        spine_flex(rig, pose, rot, loc, flex + keyed(t, breath) * 150.0, twist_deg=keyed(t, head_turn) * 0.3)
        if kind == "carve":
            st, tn = keyed(t, stroke), math.radians(keyed(t, turn))
            spoon_axis = Matrix.Rotation(tn, 3, Vector((0.3, -0.9, -0.3)).normalized()) @ Vector((-0.3, -0.85, -0.35))
            rot_l = hand_rotation(hands, rig, "l", spoon_axis, (-0.55, -0.35, 0.75))
            set_hand(rig, pose, rot, loc, "l", hand_at(hands, rig, "l", rot_l, work + Vector((0.05, 0.02, -0.02))),
                     shoulder_l + Vector((0.4, 0.1, -0.35)))
            # the blade edge rides on the spoon's surface through each stroke (the first loop kept it 3 to 7 cm off):
            # the contact slides along the neck and the back of the bowl while cutting and lifts 1.2 cm on the return
            spoon_w = pose["hand_l"] @ grip_l
            d_st = keyed(t + 0.01, stroke) - keyed(t - 0.01, stroke)
            lift = 0.012 * min(1.0, max(0.0, -d_st / 0.04))
            contact_local = carve_surface(st) + Vector((0.0, 0.0, lift))
            n_w = (spoon_w.to_3x3() @ Vector((0.0, 0.0, 1.0))).normalized()
            y_w = (spoon_w.to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()
            y_k = Matrix.Rotation(math.radians(28.0), 3, n_w) @ y_w
            z_k = n_w
            y_k = (y_k - z_k * y_k.dot(z_k)).normalized()
            x_k = y_k.cross(z_k).normalized()
            r_k = Matrix((x_k, y_k, z_k)).transposed()
            knife_w = Matrix.Translation(spoon_w @ contact_local - r_k @ KNIFE_EDGE) @ r_k.to_4x4()
            hand_r = knife_w @ grip_r.inverted()
            set_hand(rig, pose, rot, loc, "r", hand_r, shoulder_r + Vector((-0.4, 0.15, -0.3)))
            if d_st > 0:  # measure the edge against the surface while cutting
                cut_gaps.append(((pose["hand_r"] @ grip_r) @ KNIFE_EDGE - spoon_w @ carve_surface(st)).length)
            look_at(rig, pose, rot, loc, spoon_w @ carve_surface(0.5), 0.9)
        else:
            for side, x, pole_off in (("l", 0.1, Vector((0.4, 0.1, -0.3))), ("r", -0.1, Vector((-0.4, 0.1, -0.3)))):
                if side == "l" and stick_top is not None:
                    place_hand_for_prop(rig, pose, rot, loc, "l", Matrix.Translation(stick_top), stick_grip, shoulder_l + pole_off)
                    continue
                knee_top = Vector((feet[side].x + (0.0 if side == "l" else 0.01), seat["y"] - ahead + 0.07, seat["height"] + 0.075))
                rot_h = hand_rotation(hands, rig, side, (0.0, -0.75, -0.65), (-1.0 if side == "l" else 1.0, -0.2, 0.3))
                set_hand(rig, pose, rot, loc, side, hand_at(hands, rig, side, rot_h, knee_top), (shoulder_l if side == "l" else shoulder_r) + pole_off)
            gaze = Vector((math.sin(math.radians(keyed(t, head_turn))) * 1.5, seat["y"] - 2.0, seat["height"] + 0.7))
            look_at(rig, pose, rot, loc, gaze, 0.8)
        plant_feet(rig, pose, rot, loc, feet)
        frames.append((rot, loc))
    if kind == "carve":
        curl = {**hands.curl("r", SM.GRIP, (40, 35, 25)), **hands.curl("l", SM.GRIP, (35, 30, 20))}
    else:
        curl = {**hands.curl("r", SM.RELAXED, (8, 10, 6)), **hands.curl("l", SM.RELAXED, (8, 10, 6))}
    for rot, _l in frames:
        rot.update(curl)
    SM.skirt_follow(rig, frames)
    info = {"seat": seat, "feet": {k: list(v) for k, v in feet.items()}}
    if kind == "carve":
        info["strokeSeconds"] = [0.35, 0.95, 1.55, 2.15]
        info["bladeToSurfaceCm"] = round(max(cut_gaps) * 100, 2) if cut_gaps else None
        info["faceCues"] = [{"expression": "blow", "startSeconds": 2.85, "endSeconds": 3.35}]
        return frames, {"l": grip_l, "r": grip_r}, info
    return frames, None, info


def sit_down(rig, hands, idle_end, sit_start, stance, stick_top, stick_grip, seconds):
    """Standing to seated over planted feet: the hips travel back and down on an eased path while the
    torso leans forward and straightens; the left hand stays on the planted stick, the right hand moves
    from the stick to the right knee. Other bones blend from the idle's last pose to the seated rest."""
    n = int(round(seconds * FPS)) + 1
    out = []
    pose_a, pose_b = rig.fk(*idle_end), rig.fk(*sit_start)
    hand_a, hand_b = pose_a["hand_r"].copy(), pose_b["hand_r"].copy()
    hips_a, hips_b = rig.rest["hips"] @ idle_end[1]["hips"], rig.rest["hips"] @ sit_start[1]["hips"]
    shoulder_l, shoulder_r = rig.rest["upperarm_l"].translation, rig.rest["upperarm_r"].translation
    for i in range(n):
        u = i / (n - 1)
        w = smooth(u)
        rot = {}
        for bone in set(idle_end[0]) | set(sit_start[0]):
            qa = idle_end[0].get(bone, Quaternion())
            qb = sit_start[0].get(bone, Quaternion())
            rot[bone] = qa.slerp(qb if qa.dot(qb) >= 0 else -qb, w)
        down = smooth(min(1.0, u * 1.15)) ** 1.3
        back = smooth(max(0.0, (u - 0.1) / 0.9))
        p = Vector((hips_a.x + (hips_b.x - hips_a.x) * back, hips_a.y + (hips_b.y - hips_a.y) * back, hips_a.z + (hips_b.z - hips_a.z) * down))
        loc = {"hips": rig.rest["hips"].inverted() @ p}
        pose = rig.fk(rot, loc)
        spine_flex(rig, pose, rot, loc, 24.0 * math.sin(math.pi * u))
        plant_feet(rig, pose, rot, loc, stance)
        place_hand_for_prop(rig, pose, rot, loc, "l", Matrix.Translation(stick_top), stick_grip, shoulder_l + Vector((0.4, 0.15, -0.3)))
        hp = hand_a.translation.lerp(hand_b.translation, w)
        hq = hand_a.to_quaternion().slerp(hand_b.to_quaternion(), w)
        set_hand(rig, pose, rot, loc, "r", Matrix.Translation(hp) @ hq.to_matrix().to_4x4(), shoulder_r + Vector((-0.4, 0.15, -0.3)))
        out.append((rot, loc))
    return out


def stand_up(rig, hands, sit_end, idle_start, stance, stick_top, stick_grip, seconds):
    """Seated to standing over the planted feet (the elder had no way back up: sit to idle jumped her hips 56 cm):
    the trunk leans forward to bring the weight over the feet while the right hand pushes on the right knee, then the
    hips rise and come forward to the idle; the left hand stays on the planted stick. Ends exactly on the idle."""
    n = int(round(seconds * FPS)) + 1
    out = []
    pose_a, pose_b = rig.fk(*sit_end), rig.fk(*idle_start)
    hand_a, hand_b = pose_a["hand_r"].copy(), pose_b["hand_r"].copy()
    hips_a, hips_b = rig.rest["hips"] @ sit_end[1]["hips"], rig.rest["hips"] @ idle_start[1]["hips"]
    shoulder_l, shoulder_r = rig.rest["upperarm_l"].translation, rig.rest["upperarm_r"].translation
    for i in range(n):
        u = i / (n - 1)
        w = smooth((u - 0.3) / 0.7)
        rot = {}
        for bone in set(sit_end[0]) | set(idle_start[0]):
            qa = sit_end[0].get(bone, Quaternion())
            qb = idle_start[0].get(bone, Quaternion())
            rot[bone] = qa.slerp(qb if qa.dot(qb) >= 0 else -qb, w)
        fwd = smooth(u / 0.75)
        up = smooth((u - 0.22) / 0.7) ** 0.9
        p = Vector((hips_a.x + (hips_b.x - hips_a.x) * fwd, hips_a.y + (hips_b.y - hips_a.y) * fwd, hips_a.z + (hips_b.z - hips_a.z) * up))
        loc = {"hips": rig.rest["hips"].inverted() @ p}
        pose = rig.fk(rot, loc)
        spine_flex(rig, pose, rot, loc, 30.0 * math.sin(math.pi * min(1.0, u / 0.85)))
        plant_feet(rig, pose, rot, loc, stance)
        place_hand_for_prop(rig, pose, rot, loc, "l", Matrix.Translation(stick_top), stick_grip, shoulder_l + Vector((0.4, 0.15, -0.3)))
        # the right hand pushes off the right knee until the hips are up, then joins the idle
        knee = pose["calf_r"].translation + Vector((0.0, -0.06, 0.05))
        push = 1.0 - smooth((u - 0.45) / 0.3)
        hp = hand_a.translation.lerp(knee, smooth(u / 0.25)) if u < 0.25 else knee.lerp(hand_b.translation, 1.0 - push)
        hq = hand_a.to_quaternion().slerp(hand_b.to_quaternion(), smooth((u - 0.35) / 0.65))
        set_hand(rig, pose, rot, loc, "r", Matrix.Translation(hp) @ hq.to_matrix().to_4x4(), shoulder_r + Vector((-0.4, 0.15, -0.3)))
        out.append((rot, loc))
    out[-1] = lc.copy_frame(idle_start)
    return out


def face_clips(rig, cal):
    return SM.face_clips(rig, cal)


# ------------------------------------------------------------------ stage

def run(ctx):
    src, recipe, report = ctx["src"], ctx["recipe"], ctx["report"]
    arm = bpy.data.objects["Rig"]
    rig = mo.Rig(arm)
    hands = SM.Hands(rig)
    ankle_z = rig.rest["foot_l"].translation.z
    spec = recipe["motion"]
    base = src["style100"]
    face_cal = face_rig.run(arm, recipe, report)  # LOD1/Quest head lid and lip weights, measured calibration
    rep = report.setdefault("motion", {})
    kit = spec["kit"]
    clips, order = {}, []
    soles = lc.Soles(rig)
    SOLES["soles"] = soles
    walk, travel, planted = build_walk(base, rig, hands, spec["walk"], ankle_z, rep)
    windows = {s: [tuple(w) for w in rep["walk"]["stanceWindows"][s]] for s in ("l", "r")}
    idle, stance, stance_h = build_idle(base, rig, hands, spec["idle"], ankle_z, rep, walk, spec["walk"], kit=kit)
    if spec["walk"].get("freeArmSwing") is not None:  # the elder: the free hand stays under her cloak, as in the idle
        damp_arm(walk, spec["walk"].get("freeArmSide", "r"), spec["walk"]["freeArmSwing"])
        walk[-1] = lc.copy_frame(walk[0])
        rep["walk"]["freeArmSwingKept"] = spec["walk"]["freeArmSwing"]
    speed = rep["walk"]["speedMetresPerSecond"]
    stop_info, start_info = {}, {}
    stop, stop_trav, stop_plt = lc.synth_stop(rig, soles, walk, travel, windows, idle[0], stance_h, speed, report=stop_info)
    start, start_trav, start_plt = lc.synth_start(rig, soles, walk, travel, windows, idle[0], stance_h, speed, report=start_info)
    rep["walk_stop"] = {"source": "the resident's walk with a planted last step and a closing step onto the idle stance (Crownfall); "
                                  "see locomotion.synth_stop", "seconds": (len(stop) - 1) / FPS,
                        "rootTravelMetres": [round(float(x), 4) for x in stop_trav], **stop_info}
    rep["walk_start"] = {"source": "the second half of the resident's walk cycle faded in over its idle with real steps from the idle "
                                   "stance (Crownfall); see locomotion.synth_start", "seconds": (len(start) - 1) / FPS,
                         "rootTravelMetres": [round(float(x), 4) for x in start_trav], **start_info}
    props = {o.name: o for o in bpy.data.objects if o.get("crownfall_part") == "prop"}
    grips = {}
    stick_pose = None
    if kit == "elder":
        st = recipe["props"]["stick"]
        # the hand holds the shaft 5 cm below the stick's top (the worn knob rises above the fist): with the 0.74 m
        # stick gripped at its top, the elder's 0.42 m arm could not reach a planted tip without locking straight
        g_stick = hands.grip_matrix("l", -stick_lib.GRIP_BELOW_TOP) @ Matrix.Rotation(math.radians(-90), 4, "X")
        stick_lib.fit_length(props, st["length"])
        if "prop_stick_rest" in props:  # the resting stick shows only while she carves (not merged into the workplace)
            props["prop_stick_rest"]["placement"] = "aside"
        # the solver's length is the mesh's grip-origin-to-tip length (fit_length): the grip frame already holds the
        # fist 2 cm below the top (round 1 subtracted it again, which buried every planted tip 2 cm)
        stk = stick_lib.Stick(rig, hands, st["length"], g_stick, tip_radius=stick_lib.tip_radius(props.get("prop_stick")))
        stick_pose = elder_stick(rig, soles, stk, walk, travel, windows, idle, start, start_trav, stop, stop_trav, stop_info, stance_h, rep,
                                 spec=st)
        grips["prop_stick"] = ("hand_l", g_stick)
    for clip in (stop, start):
        SM.skirt_follow(rig, clip, cyclic=False)
    walk[-1] = lc.copy_frame(walk[0])  # exact loop
    SM.seal_locomotion_joins(rig, soles, walk, idle, start, stop, start_trav, stop_trav)
    clips.update({"idle": idle, "walk": walk, "walk_start": start, "walk_stop": stop})
    order = ["idle", "walk", "walk_start", "walk_stop"]
    import transitions as tr
    tswaps, ttargets, tgrips, tclips = None, None, None, None
    if kit == "spinner":
        work, g_l, info = spindle_loop(rig, hands, recipe, idle[0], stance, ankle_z)
        clips["work_spindle"] = work
        order.append("work_spindle")
        yarn = mechanisms.split_spindle_yarn(recipe["motion"]["work"]["yarnDrop"])
        if yarn is not None:
            yarn["crownfall_part"] = "prop"
            yarn["placement"] = "hand"
            props["prop_spindle_yarn"] = yarn
        tclips, tswaps, _rests, ttargets, sp_keys = tr.spinner(rig, soles, idle[0], work[0], g_l, props, recipe["motion"]["work"]["yarnDrop"])
        tgrips = {"prop_spindle": g_l, "prop_fibre_roll": g_l}
        for name in ("work_enter", "work_exit"):  # the spindle drops on its yarn and winds back up (transitions.spinner)
            mechanisms.key_spindle_and_yarn(name, *sp_keys[name])
        info.update(mechanisms.spindle(rig, work, g_l, recipe["motion"]["work"], info["twirlSeconds"]))
        rep["work_spindle"] = {"source": "original keyframes (Crownfall), IK; the spindle hangs plumb and spins (props GLB clip "
                                         "work_spindle)", "seconds": (len(work) - 1) / FPS, **info}
        grips["prop_spindle"] = ("hand_l", g_l)
    elif kit == "child":
        work, _none, info = bellows_loop(rig, hands, recipe, idle[0], ankle_z)
        clips["work_bellows"] = work
        order.append("work_bellows")
        tclips, tswaps, _rests, ttargets = tr.child(rig, soles, idle[0], work[0])
        tgrips = {}
        rep["work_bellows"] = {"source": "original keyframes (Crownfall), both hands solved on the crossbar of the lever, which is "
                                         "animated with the bellows lid, pleats and chain in the props GLB (clip work_bellows)",
                               "seconds": (len(work) - 1) / FPS, **info}
    elif kit == "elder":
        top = stick_pose["tip"] + Vector((0.0, 0.0, st["length"]))
        carve, carve_grips, info = seated_frames(rig, hands, recipe, ankle_z, "carve", stance=stance)
        sit, _g, sit_info = seated_frames(rig, hands, recipe, ankle_z, "sit", stance=stance, stick_grip=g_stick, stick_top=top)
        down = sit_down(rig, hands, idle[-1], sit[0], stance, top, g_stick, spec["seated"].get("sitDownSeconds", 2.4))
        up = stand_up(rig, hands, sit[-1], idle[0], stance, top, g_stick, spec["seated"].get("standUpSeconds", 2.2))
        hold_static(stk, sit, stick_pose["tip"])
        g_idle = stk.grip_point(rig.fk(*idle[0]))
        g_sit0, g_sit1 = stk.grip_point(rig.fk(*sit[0])), stk.grip_point(rig.fk(*sit[-1]))
        hold_static(stk, down, stick_pose["tip"], ends=(g_idle, g_sit0))
        hold_static(stk, up, stick_pose["tip"], ends=(g_sit1, g_idle))
        up[-1] = lc.copy_frame(idle[0])
        down[0] = lc.copy_frame(idle[0])
        down[-1] = lc.copy_frame(sit[0])
        up[0] = lc.copy_frame(sit[-1])
        for clip in (down, up):
            SM.skirt_follow(rig, clip, cyclic=False)
        clips.update({"work_carving": carve, "sit": sit, "sit_down": down, "stand_up": up})
        order += ["work_carving", "sit", "sit_down", "stand_up"]
        rep["work_carving"] = {"source": "original keyframes (Crownfall), seated IK", "seconds": (len(carve) - 1) / FPS, **info}
        rep["sit"] = {"source": "original keyframes (Crownfall), seated rest", "seconds": (len(sit) - 1) / FPS, **sit_info}
        rep["sit_down"] = {"source": "original keyframes (Crownfall): from the idle to the seated rest over planted feet, the stick planted",
                           "seconds": (len(down) - 1) / FPS}
        rep["stand_up"] = {"source": "original keyframes (Crownfall): from the seated rest to the idle, leaning forward and pushing off the knee",
                           "seconds": (len(up) - 1) / FPS}
        grips["prop_spoon"] = ("hand_l", carve_grips["l"])
        grips["prop_knife"] = ("hand_r", carve_grips["r"])
        tgrips = {"prop_stick": g_stick, "prop_knife": carve_grips["r"], "prop_spoon": carve_grips["l"]}
        tclips, tswaps, _rests, ttargets = tr.elder(rig, soles, sit[0], carve[0], tgrips, props, st["length"])
    if tclips:
        for name in ("work_enter", "work_exit"):
            clips[name] = tclips[name]
            order.append(name)
            rep[name] = {"source": "original keyframes (Crownfall): work entry/exit with props taken from and put back on the "
                                   "workstation (transitions.py)", "seconds": (len(tclips[name]) - 1) / FPS,
                         "from": "sit" if kit == "elder" else "idle",
                         "propSwaps": tr.check_swaps_any(rig, tclips[name], tswaps[name], tgrips, ttargets) if tgrips else []}
        rep["propSwaps"] = tswaps
        rep["restProps"] = sorted(o.name for o in bpy.data.objects if o.get("rest_of"))
    for name, (bone, grip) in grips.items():
        if name in props:
            props[name]["grip_bone"] = bone
            props[name]["grip_matrix"] = [v for row in grip for v in row]
    rep["grips"] = {name: {"bone": bone, "matrix": [list(r) for r in grip]} for name, (bone, grip) in grips.items()}
    clips["talk"] = it.talk_frames(rig, hands, soles, idle, stance_h, kit, stick_side="l" if kit == "elder" else None)
    if kit == "elder":
        hold_static(stk, clips["talk"], stick_pose["tip"])
    SM.skirt_follow(rig, clips["talk"])
    order.append("talk")
    clips.update(face_clips(rig, face_cal))
    order += ["face_blink", "face_gaze", "face_jaw"]
    body_bones = [b.name for b in arm.data.bones if not b.name.startswith("face_") and b.name not in SM.BODY_SKIP]
    face_bones = [b.name for b in arm.data.bones if b.name.startswith("face_")]
    written = []
    for name in order:
        # body clips never key the face joints (speech, blinks and the carving blow come from the face rig)
        allowed = face_bones if name.startswith("face_") else body_bones
        written.append(mo.write_clip(arm, name, clips[name], FPS, bones=set(allowed)))
    rep["clips"] = written

"""Crowd clip libraries: one shared clip set per body archetype (original Crownfall code, motion builder).

Every crowd resident of an archetype is bound to the archetype's reference skeleton (crowd_skeleton.py, owned by the
kit builder and only read here); its stature is restored at runtime by a uniform placement scale. So one set of clips,
authored once on the reference skeleton, plays on all of them: the caller builds the actor template as
`{scene: resident.scene, animations: library.animations}` (EALDHOLT_POPULATION_ART.md section 4).

This module builds the base clips of a library on the household methods:

* locomotion from 100STYLE (CC BY 4.0) gait cycles, retargeted, straightened, made in place, loop-closed and grounded
  by locomotion.lock_walk_cycle (stance windows, heel-flat-ball-toe roll on one anchor per stance, swing clearance);
* one standing hub pose per archetype (`hub`, the first frame of `idle`): idle, idle_b, talk, talk_b and look_around
  begin and end exactly on it, every walk variant has its own start and stop clips that leave from and return to it, so
  a resident's walk, idle and talk variants combine without a pop (one stance, measured from the neutral walk);
* the walking stick and crutch on the household stick solver (stick.py), the seated rest on a stool with sit_down and
  stand_up over planted feet.

Sole points are the shoe's: the reference Body is the bare base mesh lifted by the archetype's sole thickness, so the
sole points are lowered by that lift (a crowd shoe's sole reaches the ground at rest). Role loops are in
motion_roles.py; export, manifest and provenance in motion_library_export.py; entry script build_clip_library.py.
"""
import math
import os

import bpy  # noqa: F401  (Blender scene used by the imported modules)
import numpy as np
from mathutils import Matrix, Quaternion, Vector

import crowd_skeleton as cs
import idle_talk as it
import locomotion as lc
import motion as mo
import motion_household as MH
import stage_motion as SM
import stick as stick_lib

FPS = 30
ADULT_MALE_STATURE_CM = 173.5

# ------------------------------------------------------------------ 100STYLE takes (CC BY 4.0) and cycle windows

# (style, take, (first, last) frame at 60 fps). Cycles chosen by a pose-distance search over each take's straight
# segments (scratchpad find_cycles.py) or taken from the household recipes.
NEUTRAL_FW = ("Neutral", "FW", (4507, 4591))
PROUD_FW = ("Proud", "FW", (2463, 2539))
HEAVY_FW = ("Heavyset", "FW", (822, 900))
ELATED_FW = ("Elated", "FW", (4182, 4254))
OLD_FW = ("Old", "FW", (2311, 2419))
STICK_FW = ("WalkingStickLeft", "FW", (2131, 2223))
LIMP_FW = ("LimpLeft", "FW", (3760, 3836))
RUN_FR = ("Neutral", "FR", (495, 541))
NEUTRAL_ID = ("Neutral", "ID", (700, 1060))
NEUTRAL_ID_B = ("Neutral", "ID", (1100, 1460))
PROUD_ID = ("Proud", "ID", (760, 1120))
OLD_ID = ("Old", "ID", (900, 1260))
STICK_ID = ("WalkingStickLeft", "ID", (900, 1260))

STOOP = {"spine02": 6.0, "spine03": 10.0, "neck": -6.0, "head": -4.0, "shoulderForward": 4.0}
STOOP_LIGHT = {"spine02": 3.0, "spine03": 6.0, "neck": -4.0, "head": -2.0, "shoulderForward": 2.0}


def walk_spec(take, blend=None, weight=0.0, **kw):
    spec = {"style": take[0], "take": take[1], "frames": list(take[2])}
    if blend:
        spec["blend"] = {"style": blend[0], "take": blend[1], "frames": list(blend[2]), "weight": weight}
    spec.update(kw)
    return spec


def idle_spec(take, **kw):
    spec = {"style": take[0], "take": take[1], "frames": list(take[2])}
    spec.update(kw)
    return spec


# Per-archetype base motion. Gait specs follow motion_household.build_walk (blend, timeScale, narrow, stoop,
# headPitch); `idleStyle` and `talk` name idle_talk styles (some are added below for the crowd).
ARCHETYPE_MOTION = {
    "adult-male": {
        "walk": walk_spec(NEUTRAL_FW, headPitch=7.0),
        "walk_b": walk_spec(PROUD_FW, NEUTRAL_FW, 0.3, headPitch=5.0),
        "walk_c": walk_spec(HEAVY_FW, NEUTRAL_FW, 0.25, headPitch=9.0, timeScale=0.86),
        "walk_crutch": walk_spec(LIMP_FW, headPitch=8.0, timeScale=0.95),
        "idle": idle_spec(NEUTRAL_ID, headPitch=4.0), "idle_b": idle_spec(PROUD_ID, headPitch=3.0),
        "idleStyle": "smith", "idleStyleB": "crowd-upright", "talk": "smith", "talkB": "crowd-open",
    },
    "adult-female": {
        "walk": walk_spec(NEUTRAL_FW, headPitch=6.0, narrow=0.2),
        "walk_b": walk_spec(PROUD_FW, NEUTRAL_FW, 0.5, headPitch=5.0, narrow=0.25),
        "walk_c": walk_spec(HEAVY_FW, NEUTRAL_FW, 0.3, headPitch=8.0, narrow=0.15, timeScale=0.96),
        "idle": idle_spec(NEUTRAL_ID_B, headPitch=4.0, narrow=0.2), "idle_b": idle_spec(PROUD_ID, headPitch=4.0, narrow=0.2),
        "idleStyle": "spinner", "idleStyleB": "crowd-settled", "talk": "spinner", "talkB": "crowd-open",
    },
    "adolescent": {
        "walk": walk_spec(NEUTRAL_FW, ELATED_FW, 0.2, headPitch=5.0, timeScale=1.08, narrow=0.1),
        "walk_b": walk_spec(PROUD_FW, NEUTRAL_FW, 0.4, headPitch=4.0, timeScale=1.05, narrow=0.1),
        "walk_c": walk_spec(HEAVY_FW, NEUTRAL_FW, 0.4, headPitch=9.0, timeScale=1.04, narrow=0.1),
        "idle": idle_spec(NEUTRAL_ID_B, headPitch=3.0, timeScale=1.1), "idle_b": idle_spec(PROUD_ID, headPitch=3.0, timeScale=1.1),
        "idleStyle": "crowd-restless", "idleStyleB": "crowd-upright", "talk": "crowd-teen", "talkB": "crowd-open",
    },
    "child": {
        "walk": walk_spec(NEUTRAL_FW, ELATED_FW, 0.4, headPitch=4.0, timeScale=1.3),
        "walk_b": walk_spec(ELATED_FW, NEUTRAL_FW, 0.3, headPitch=3.0, timeScale=1.25),
        "walk_c": walk_spec(HEAVY_FW, NEUTRAL_FW, 0.5, headPitch=8.0, timeScale=1.2),
        "run": walk_spec(RUN_FR, headPitch=4.0, timeScale=1.1, run=True),
        "idle": idle_spec(NEUTRAL_ID_B, headPitch=2.0, timeScale=1.2), "idle_b": idle_spec(PROUD_ID, headPitch=2.0, timeScale=1.2),
        "idleStyle": "child", "idleStyleB": "crowd-restless", "talk": "child", "talkB": "crowd-child-b",
    },
    "elder-male": {
        "walk": walk_spec(NEUTRAL_FW, OLD_FW, 0.35, headPitch=6.0, timeScale=0.95, stoop=STOOP_LIGHT),
        "walk_b": walk_spec(NEUTRAL_FW, PROUD_FW, 0.2, headPitch=5.0, timeScale=0.97, stoop=STOOP_LIGHT),
        "walk_c": walk_spec(HEAVY_FW, OLD_FW, 0.3, headPitch=8.0, timeScale=0.92, stoop=STOOP),
        "walk_stick": walk_spec(STICK_FW, NEUTRAL_FW, 0.35, headPitch=6.0, narrow=0.1, timeScale=0.92, stoop=STOOP),
        "idle": idle_spec(NEUTRAL_ID, headPitch=3.0, stoop=STOOP_LIGHT), "idle_b": idle_spec(NEUTRAL_ID_B, headPitch=3.0, stoop=STOOP, timeScale=0.9),
        "idle_stick": idle_spec(STICK_ID, headPitch=2.0, stoop=STOOP),
        "idleStyle": "elder", "idleStyleB": "crowd-settled", "talk": "crowd-elder", "talkB": "crowd-open", "stickLengthShare": 0.55,
    },
    "elder-female": {
        "walk": walk_spec(NEUTRAL_FW, OLD_FW, 0.35, headPitch=6.0, timeScale=0.95, narrow=0.15, stoop=STOOP_LIGHT),
        "walk_b": walk_spec(NEUTRAL_FW, PROUD_FW, 0.2, headPitch=5.0, timeScale=0.97, narrow=0.15, stoop=STOOP_LIGHT),
        "walk_c": walk_spec(HEAVY_FW, OLD_FW, 0.3, headPitch=8.0, timeScale=0.92, narrow=0.1, stoop=STOOP),
        "walk_stick": walk_spec(STICK_FW, NEUTRAL_FW, 0.35, headPitch=6.0, narrow=0.1, timeScale=0.92, stoop=STOOP),
        "idle": idle_spec(NEUTRAL_ID_B, headPitch=3.0, narrow=0.15, stoop=STOOP_LIGHT),
        "idle_b": idle_spec(PROUD_ID, headPitch=3.0, narrow=0.15, stoop=STOOP, timeScale=0.9),
        "idle_stick": idle_spec(STICK_ID, headPitch=2.0, stoop=STOOP),
        "idleStyle": "elder", "idleStyleB": "spinner", "talk": "crowd-elder", "talkB": "spinner", "stickLengthShare": 0.555,
    },
}

# Crowd idle and talk styles, added to the household tables at import (whole cycles keep the loops seamless).
it.IDLE_STYLES.update({
    "crowd-upright": {"sway": 0.005, "swayCycles": 2, "swayPhase": 0.3, "shifts": [(0.12, 0.45, "l", 0.022)], "bobCycles": 1, "roll": 1.6},
    "crowd-settled": {"sway": 0.007, "swayCycles": 1, "swayPhase": 2.0, "shifts": [(0.5, 0.92, "r", 0.026)], "bobCycles": 2, "roll": 2.0},
    "crowd-restless": {"sway": 0.008, "swayCycles": 2, "swayPhase": 1.1,
                       "shifts": [(0.06, 0.34, "l", 0.026), (0.52, 0.84, "r", 0.028)], "bobCycles": 3, "roll": 2.6},
})
it.TALK_STYLES.update({
    "crowd-open": {"gestures": [("offer", "r", 0.1, 0.36, 1.0), ("offer", "l", 0.3, 0.55, 0.8), ("beat", "r", 0.62, 0.9, 0.9)],
                   "nod": 2.6, "tilt": 3.0, "turn": 5.0, "lean": 2.5},
    "crowd-teen": {"gestures": [("belt", "l", 0.05, 0.6, 1.0), ("offer", "r", 0.2, 0.42, 0.7), ("beat", "r", 0.66, 0.9, 0.7)],
                   "nod": 2.4, "tilt": 4.0, "turn": 5.5, "lean": 1.0, "fidget": (0.008, 1)},
    "crowd-child-b": {"gestures": [("beat", "r", 0.08, 0.3, 0.8), ("offer", "l", 0.36, 0.6, 0.9), ("offer", "r", 0.7, 0.9, 0.7)],
                      "nod": 3.4, "tilt": 6.0, "turn": 7.0, "lean": 2.0, "fidget": (0.014, 3)},
    "crowd-elder": {"gestures": [("clasp", "l", 0.05, 0.5, 1.0), ("clasp", "r", 0.05, 0.5, 1.0), ("offer", "r", 0.6, 0.86, 0.6)],
                    "nod": 2.0, "tilt": 2.6, "turn": 3.5, "lean": 1.5},
})


def bvh_path(roots, style, take):
    for root in roots:
        p = os.path.join(root, style, f"{style}_{take}.bvh")
        if os.path.exists(p):
            return p
    raise FileNotFoundError(f"100STYLE {style}_{take}.bvh not found in {roots}")


# ------------------------------------------------------------------ the library context

def shoe_soles(rig, lift):
    """Sole points of a crowd shoe: the bare reference foot's sole points lowered by the archetype's sole lift."""
    soles = lc.Soles(rig, meshes=("Body",))
    for side in ("l", "r"):
        for key, (bone, local) in list(soles.local[side].items()):
            w = rig.rest[bone] @ local
            w.z -= lift
            soles.local[side][key] = (bone, rig.rest[bone].inverted() @ w)
        soles.ground[side] -= lift
    soles.length = {s: (soles.world_rest(s, "tip") - soles.world_rest(s, "heel")).length for s in ("l", "r")}
    return soles


class Library:
    """One archetype's reference rig, its measurements and the clips built so far."""

    def __init__(self, src, archetype, roots):
        self.archetype, self.roots = archetype, roots
        self.arm, self.body, self.info = cs.build_reference(src, archetype)
        self.rig = mo.Rig(self.arm)
        self.hands = SM.Hands(self.rig)
        self.soles = shoe_soles(self.rig, cs.SOLE_LIFT[archetype])
        MH.SOLES["soles"] = self.soles  # motion_household.plant_feet reads the resident's sole points from here
        self.ankle_z = self.rig.rest["foot_l"].translation.z
        self.k = self.info["statureCm"] / ADULT_MALE_STATURE_CM  # body scale for authored distances
        self.spec = ARCHETYPE_MOTION[archetype]
        self.clips, self.rep, self.order = {}, {}, []
        self.takes = set()  # 100STYLE files used (for provenance)
        self.meta = {}      # per clip: loop flag, kind, hub joins, props, events

    def add(self, name, frames, loop, kind, **meta):
        self.clips[name] = frames
        if name not in self.order:
            self.order.append(name)
        self.meta[name] = dict(meta, loop=loop, kind=kind)


# ------------------------------------------------------------------ gait cycles

def cycle(L, style, take, frames):
    bvh = mo.BVH(bvh_path(L.roots, style, take))
    L.takes.add(f"{style}/{style}_{take}.bvh")
    rt = mo.Retarget(bvh, L.rig)
    f0, f1 = frames
    yaw = SM.walk_yaw(bvh, f0, f1)
    info = {}
    fr = SM.retarget_frames(bvh, rt, f0, f1, yaw, info=info)
    seam = mo.seam_degrees(fr)
    travel = SM.detrend(L.rig, fr, "linear")
    mo.close_loop(fr)
    return {"frames": fr, "stride": travel[-1], "seconds": (len(fr) - 1) / FPS, "seam": seam,
            "source": f"100STYLE {style}_{take} frames {f0}-{f1} (60 fps), every second frame"}


def build_gait(L, spec, rep, stance_x=None):
    """A grounded in-place gait cycle (motion_household.build_walk with the library's shoe soles). Returns frames,
    per-frame forward travel and stance windows. With `stance_x` (the hub stance's mean ankle half-width) the step width
    is adjusted (narrow_stance) until the gait's flat-foot stance has that width, so its start and stop clips step onto
    and off the hub stance without a sideways slide (a Proud walk's feet sat 6 cm off it)."""
    if stance_x is None:
        return _build_gait(L, spec, rep)
    spec = dict(spec)
    target_w, target_c = stance_x
    for _it in range(3):
        frames, travel, windows = _build_gait(L, spec, rep)
        st = it.stance_from_walk(L.rig, L.soles, frames, windows, spec.get("toeOutDeg", 7.0))
        x = 0.5 * (st["l"][0].x - st["r"][0].x)
        rep["stanceHalfWidthCm"] = round(x * 100, 2)
        if abs(x - target_w) < 0.004:
            break
        keep = (1.0 - spec.get("narrow", 0.0)) * target_w / max(1e-3, x)
        spec["narrow"] = round(1.0 - keep, 4)
    # centre the gait on the hub stance: the whole body moves sideways (the feet with it, contacts unchanged)
    c = 0.5 * (st["l"][0].x + st["r"][0].x)
    dx = target_c - c
    for _rot, loc in frames:
        p = L.rig.rest["hips"] @ loc["hips"]
        p.x += dx
        loc["hips"] = L.rig.rest["hips"].inverted() @ p
    rep["narrowApplied"] = spec.get("narrow", 0.0)
    rep["lateralCentringCm"] = round(dx * 100, 2)
    return frames, travel, windows


def _build_gait(L, spec, rep):
    rig = L.rig
    a = cycle(L, spec["style"], spec.get("take", "FW"), spec["frames"])
    frames = lc.align_left_forward(rig, a["frames"])
    seconds, stride, sources, seams = a["seconds"], a["stride"], [a["source"]], [round(a["seam"], 2)]
    blend = spec.get("blend")
    if blend:
        b = cycle(L, blend["style"], blend.get("take", "FW"), blend["frames"])
        frames_b = lc.align_left_forward(rig, b["frames"])
        w = blend["weight"]
        seconds = a["seconds"] * (1 - w) + b["seconds"] * w
        stride = a["stride"] * (1 - w) + b["stride"] * w
        n = int(round(seconds / spec.get("timeScale", 1.0) * FPS))
        frames = MH.blend_frames(frames, frames_b, w, n)
        sources.append(b["source"] + f", blended at weight {w}")
        seams.append(round(b["seam"], 2))
    elif spec.get("timeScale", 1.0) != 1.0:
        frames = MH.resample_phase(frames, int(round(seconds / spec["timeScale"] * FPS)))
    stride *= spec.get("strideScale", 1.0)
    n = len(frames)
    travel = [stride * i / (n - 1) for i in range(n)]
    SM.add_relaxed_hands(L.hands, frames)
    MH.stoop(rig, frames, spec.get("stoop"))
    pitch = SM.correct_head_pitch(rig, frames, spec.get("headPitch", 7.0))
    mo.close_loop(frames)
    MH.narrow_stance(rig, frames, spec.get("narrow", 0.0))
    info = {}
    windows = lc.lock_walk_cycle(rig, L.soles, frames, travel, info, toe_out_deg=spec.get("toeOutDeg", 7.0))
    SM.skirt_follow(rig, frames)
    frames[-1] = lc.copy_frame(frames[0])
    secs = (n - 1) / FPS
    rep.update({"source": "; ".join(sources), "seconds": round(secs, 4), "strideMetres": round(stride, 4),
                "speedMetresPerSecond": round(stride / secs, 4), "sourceSeamDegrees": max(seams), "sourceHeadPitchDegrees": pitch,
                **info})
    return frames, travel, windows


# ------------------------------------------------------------------ hub idle

def build_idle(L, spec, stance_h, style, rep):
    """A captured stand-still take grounded on the hub stance with an idle_talk style (motion_household.build_idle with
    the library's shoe soles)."""
    rig = L.rig
    idb = mo.BVH(bvh_path(L.roots, spec["style"], spec.get("take", "ID")))
    L.takes.add(f"{spec['style']}/{spec['style']}_{spec.get('take', 'ID')}.bvh")
    rt = mo.Retarget(idb, rig)
    i0, i1 = spec["frames"]
    yaw = SM.facing_yaw(idb, i0, i1)
    idle = SM.retarget_frames(idb, rt, i0, i1, yaw, straighten=False)
    seam = mo.seam_degrees(idle)
    SM.detrend(rig, idle, "mean")
    if spec.get("timeScale", 1.0) != 1.0:
        idle = MH.resample_phase(idle, int(round((len(idle) - 1) / spec["timeScale"])))
    SM.add_relaxed_hands(L.hands, idle)
    MH.stoop(rig, idle, spec.get("stoop"))
    pitch = SM.correct_head_pitch(rig, idle, spec.get("headPitch", 4.0))
    mo.close_loop(idle)
    SM.ground_offset(rig, idle, L.ankle_z, [(i, s) for i in range(0, len(idle), 5) for s in ("l", "r")])
    layer = it.ground_idle(rig, L.soles, idle, stance_h, style=it.IDLE_STYLES.get(style))
    SM.skirt_follow(rig, idle)
    idle[-1] = lc.copy_frame(idle[0])
    rep.update({"source": f"100STYLE {spec['style']}_{spec.get('take', 'ID')} frames {i0}-{i1} (60 fps), every second frame" +
                (f", time scale {spec['timeScale']}" if spec.get("timeScale", 1.0) != 1.0 else "") +
                f"; feet planted flat on the hub stance, idle style {style} (Crownfall)",
                "seconds": round((len(idle) - 1) / FPS, 4), "sourceSeamDegrees": round(seam, 2), "sourceHeadPitchDegrees": pitch, **layer})
    return idle


def plant_stance(L, frame, stance_h):
    rot, loc = frame
    pose = L.rig.fk(rot, loc)
    for s in ("l", "r"):
        xy, heading = stance_h[s]
        lc.plant_flat(L.rig, L.soles, pose, rot, loc, s, xy, heading)


def seal_to_hub(L, frames, hub, stance_h, count=10, loop=True, at_start=True, at_end=True):
    """Ease the first and last `count` frames of a standing clip into the hub pose (non-leg bones and the hips), then
    plant the feet on the hub stance again, so the clip begins and ends exactly on the hub without a foot sliding."""
    n = len(frames)
    count = min(count, max(2, n // 3))
    if at_end:
        SM.blend_into(frames, [hub] * count, count, at_end=True, skip=SM.LEGS)
    if at_start:
        SM.blend_into(frames, [hub] * count, count, at_end=False, skip=SM.LEGS)
    idx = set(range(count)) if at_start else set()
    if at_end:
        idx |= set(range(n - count, n))
    for i in sorted(idx):
        plant_stance(L, frames[i], stance_h)
    if at_start:
        frames[0] = lc.copy_frame(hub)
    if at_end or loop:
        frames[-1] = lc.copy_frame(hub if at_end else frames[0])


# ------------------------------------------------------------------ additive layers on the hub

def keyed(t, keys):
    return MH.keyed(t, keys)


def look_around(L, hub, stance_h, seconds=3.4, side=-1.0, stick=None):
    """Pause and glance aside (the influence pause): the head leads, the chest follows, a second shorter glance the
    other way, back to the hub. Feet stay planted; zero at both ends (exact hub joins)."""
    rig = L.rig
    n = int(round(seconds * FPS)) + 1
    yaw = [(0.0, 0.0), (0.35, 0.0), (1.0, 1.0), (1.9, 0.92), (2.35, -0.42), (2.75, -0.38), (seconds, 0.0)]
    lift = [(0.0, 0.0), (0.35, 0.0), (1.0, 1.0), (1.9, 0.6), (2.6, 0.2), (seconds, 0.0)]
    out = []
    for i in range(n):
        t = i / FPS
        rot, loc = lc.copy_frame(hub)
        a = keyed(t, yaw) * side
        breathe = 0.003 * math.sin(2 * math.pi * t / seconds)
        p = rig.rest["hips"] @ loc["hips"]
        p.z += breathe
        loc["hips"] = rig.rest["hips"].inverted() @ p
        pose = rig.fk(rot, loc)
        MH.spine_flex(rig, pose, rot, loc, -2.0 * keyed(t, lift), twist_deg=14.0 * a, shares=(0.2, 0.35, 0.45))
        for bone, deg in (("neck", 20.0), ("head", 30.0)):
            q = Matrix.Rotation(math.radians(deg * a), 3, "Z") @ Matrix.Rotation(math.radians(-4.0 * keyed(t, lift)), 3, "X")
            mo.set_world_rotation(rig, pose, rot, loc, bone, q @ pose[bone].to_3x3())
        if stick is not None:
            stick[0].hold(pose, rot, loc, stick[1], stick[2])
        for s in ("l", "r"):
            xy, heading = stance_h[s]
            lc.plant_flat(rig, L.soles, pose, rot, loc, s, xy, heading)
        out.append((rot, loc))
    out[0], out[-1] = lc.copy_frame(hub), lc.copy_frame(hub)
    return out


# ------------------------------------------------------------------ seated rest

def seat_spec(L):
    """Stool behind the hub stance (resident root frame, Blender metres): height and the hip point above it scale with
    the archetype's stature; the feet stay on the hub stance."""
    k = L.k
    return {"height": round(0.44 * k, 3), "feetAhead": round(0.40 * k, 3), "hipAboveSeat": round(0.085 * k, 3)}


def seated_frames(L, stance_h, seconds=6.0):
    """Seated rest: hands on the thighs, a slow look about, breathing; feet on the hub stance."""
    rig, hands = L.rig, L.hands
    seat = seat_spec(L)
    feet = {s: Vector((stance_h[s][0].x, stance_h[s][0].y, L.ankle_z)) for s in ("l", "r")}
    seat_y = float((feet["l"].y + feet["r"].y) / 2 + seat["feetAhead"])
    sh = {s: rig.rest[f"upperarm_{s}"].translation for s in ("l", "r")}
    n = int(round(seconds * FPS)) + 1
    head_turn = [(0.0, 0.0), (seconds * 0.3, 16.0), (seconds * 0.55, 16.0), (seconds * 0.8, -9.0), (seconds, 0.0)]
    out = []
    for i in range(n):
        t = i / FPS
        rot, loc = {}, {}
        b = 0.004 * (0.5 - 0.5 * math.cos(2 * math.pi * 2 * t / seconds))
        loc["hips"] = rig.rest["hips"].inverted() @ Vector((0.0, seat_y, seat["height"] + seat["hipAboveSeat"] + b))
        pose = rig.fk(rot, loc)
        mo.set_world_rotation(rig, pose, rot, loc, "hips", Quaternion((1, 0, 0), math.radians(8.0)).to_matrix() @ pose["hips"].to_3x3())
        MH.spine_flex(rig, pose, rot, loc, 12.0 + b * 150.0, twist_deg=keyed(t, head_turn) * 0.3)
        knee_y = seat_y - seat["feetAhead"] + 0.07 * L.k
        for side, sx in (("l", 1.0), ("r", -1.0)):
            thigh_top = Vector((feet[side].x * 0.9, (knee_y + seat_y) * 0.5 - 0.02, seat["height"] + 0.075 * L.k + 0.06 * L.k))
            r_h = MH.hand_rotation(hands, rig, side, (0.0, -0.75, -0.65), (-sx, -0.2, 0.3))
            MH.set_hand(rig, pose, rot, loc, side, MH.hand_at(hands, rig, side, r_h, thigh_top), sh[side] + Vector((sx * 0.4, 0.1, -0.3)))
        gaze = Vector((math.sin(math.radians(keyed(t, head_turn))) * 1.5, seat_y - 2.0, seat["height"] + 0.7 * L.k))
        MH.look_at(rig, pose, rot, loc, gaze, 0.8)
        MH.plant_feet(rig, pose, rot, loc, feet, yaw_deg={s: math.degrees(stance_h[s][1]) for s in ("l", "r")})
        out.append((rot, loc))
    curl = {**hands.curl("r", SM.RELAXED, (8, 10, 6)), **hands.curl("l", SM.RELAXED, (8, 10, 6))}
    for rot, _l in out:
        rot.update(curl)
    SM.skirt_follow(rig, out)
    out[-1] = lc.copy_frame(out[0])
    return out, {"seat": {"heightMetres": seat["height"], "centreBlender": [0.0, round(seat_y, 4), seat["height"]],
                          "rootFrame": "glTF: x left, y up, z forward; seat centre at (0, height, -centreBlender[1])"}}


def sit_down(L, hub, sit0, stance_h, seconds):
    """Standing to seated over the planted feet: the hips travel back and down on an eased path while the torso leans
    forward and straightens; the hands reach back toward the seat, then settle on the thighs."""
    rig = L.rig
    n = int(round(seconds * FPS)) + 1
    pa, pb = rig.fk(*hub), rig.fk(*sit0)
    ha, hb = rig.rest["hips"] @ hub[1]["hips"], rig.rest["hips"] @ sit0[1]["hips"]
    sh = {s: rig.rest[f"upperarm_{s}"].translation for s in ("l", "r")}
    feet = {s: Vector((stance_h[s][0].x, stance_h[s][0].y, L.ankle_z)) for s in ("l", "r")}
    out = []
    for i in range(n):
        u = i / (n - 1)
        w = MH.smooth(u)
        rot = {}
        for bone in set(hub[0]) | set(sit0[0]):
            qa, qb = hub[0].get(bone, Quaternion()), sit0[0].get(bone, Quaternion())
            rot[bone] = qa.slerp(qb if qa.dot(qb) >= 0 else -qb, w)
        down = MH.smooth(min(1.0, u * 1.15)) ** 1.3
        back = MH.smooth(max(0.0, (u - 0.1) / 0.9))
        p = Vector((ha.x + (hb.x - ha.x) * back, ha.y + (hb.y - ha.y) * back, ha.z + (hb.z - ha.z) * down))
        loc = {"hips": rig.rest["hips"].inverted() @ p}
        pose = rig.fk(rot, loc)
        MH.spine_flex(rig, pose, rot, loc, 26.0 * math.sin(math.pi * u))
        MH.plant_feet(rig, pose, rot, loc, feet, yaw_deg={s: math.degrees(stance_h[s][1]) for s in ("l", "r")})
        wik = MH.smooth(u / 0.3)  # the hub's arms hang by FK: the IK arm fades in (no elbow snap at frame 1)
        for side, sx in (("l", 1.0), ("r", -1.0)):
            a, b = pa[f"hand_{side}"], pb[f"hand_{side}"]
            reach = math.sin(math.pi * min(1.0, u / 0.85))
            hp = a.translation.lerp(b.translation, w) + Vector((sx * 0.04, 0.12, -0.04)) * reach * L.k
            hq = a.to_quaternion().slerp(b.to_quaternion(), w)
            fk = {bn: rot[bn].copy() for bn in (f"clavicle_{side}", f"upperarm_{side}", f"forearm_{side}", f"hand_{side}") if bn in rot}
            MH.set_hand(rig, pose, rot, loc, side, Matrix.Translation(hp) @ hq.to_matrix().to_4x4(), sh[side] + Vector((sx * 0.4, 0.1, -0.3)))
            mix_arm(rig, pose, rot, loc, side, fk, wik)
        out.append((rot, loc))
    out[0], out[-1] = lc.copy_frame(hub), lc.copy_frame(sit0)
    SM.smooth_legs(out)
    return out


def mix_arm(rig, pose, rot, loc, side, fk, w):
    """Mix an arm's IK rotations (now in rot) with its FK rotations `fk` by weight w (1 = IK)."""
    if w >= 0.999:
        return
    for b, q in fk.items():
        qi = rot[b]
        rot[b] = q.slerp(qi if q.dot(qi) >= 0 else -qi, w)
    rig.update_chain(pose, rot, loc, f"clavicle_{side}")


def stand_up(L, sit1, hub, stance_h, seconds):
    """Seated to standing: the trunk leans forward over the feet while both hands push on the knees, then the hips rise
    and come forward to the hub. Ends exactly on the hub."""
    rig = L.rig
    n = int(round(seconds * FPS)) + 1
    pa, pb = rig.fk(*sit1), rig.fk(*hub)
    ha, hb = rig.rest["hips"] @ sit1[1]["hips"], rig.rest["hips"] @ hub[1]["hips"]
    sh = {s: rig.rest[f"upperarm_{s}"].translation for s in ("l", "r")}
    feet = {s: Vector((stance_h[s][0].x, stance_h[s][0].y, L.ankle_z)) for s in ("l", "r")}
    out = []
    for i in range(n):
        u = i / (n - 1)
        w = MH.smooth((u - 0.3) / 0.7)
        rot = {}
        for bone in set(sit1[0]) | set(hub[0]):
            qa, qb = sit1[0].get(bone, Quaternion()), hub[0].get(bone, Quaternion())
            rot[bone] = qa.slerp(qb if qa.dot(qb) >= 0 else -qb, w)
        fwd = MH.smooth(u / 0.75)
        up = MH.smooth((u - 0.22) / 0.7) ** 0.9
        p = Vector((ha.x + (hb.x - ha.x) * fwd, ha.y + (hb.y - ha.y) * fwd, ha.z + (hb.z - ha.z) * up))
        loc = {"hips": rig.rest["hips"].inverted() @ p}
        pose = rig.fk(rot, loc)
        MH.spine_flex(rig, pose, rot, loc, 32.0 * math.sin(math.pi * min(1.0, u / 0.85)))
        MH.plant_feet(rig, pose, rot, loc, feet, yaw_deg={s: math.degrees(stance_h[s][1]) for s in ("l", "r")})
        push = 1.0 - MH.smooth((u - 0.45) / 0.3)
        wik = MH.smooth((1.0 - u) / 0.3)  # the IK arm fades out into the hub's hanging FK arms
        for side, sx in (("l", 1.0), ("r", -1.0)):
            a, b = pa[f"hand_{side}"], pb[f"hand_{side}"]
            knee = pose[f"calf_{side}"].translation + Vector((0.0, -0.05, 0.06)) * L.k
            hp = a.translation.lerp(knee, MH.smooth(u / 0.25)) if u < 0.25 else knee.lerp(b.translation, 1.0 - push)
            hq = a.to_quaternion().slerp(b.to_quaternion(), MH.smooth((u - 0.35) / 0.65))
            fk = {bn: rot[bn].copy() for bn in (f"clavicle_{side}", f"upperarm_{side}", f"forearm_{side}", f"hand_{side}") if bn in rot}
            MH.set_hand(rig, pose, rot, loc, side, Matrix.Translation(hp) @ hq.to_matrix().to_4x4(), sh[side] + Vector((sx * 0.4, 0.1, -0.3)))
            mix_arm(rig, pose, rot, loc, side, fk, wik)
        out.append((rot, loc))
    out[0], out[-1] = lc.copy_frame(sit1), lc.copy_frame(hub)
    SM.smooth_legs(out)
    return out


# ------------------------------------------------------------------ stick and crutch

def make_stick(L, length):
    g = L.hands.grip_matrix("l", -stick_lib.GRIP_BELOW_TOP) @ Matrix.Rotation(math.radians(-90), 4, "X")
    return stick_lib.Stick(L.rig, L.hands, length, g, tip_radius=0.012), g


def stick_walk(L, stk, walk, travel, windows, stance_h, plant_side, rep, tip_out=None, ahead=None, lift_y=None):
    """Plant the stick (left hand) with `plant_side`'s stance in a walk cycle: lands ahead of that heel as it strikes,
    comes down vertically, lifts before it passes the body (the household elder rule, stick.py), the hand moving back
    over the planted stick and forward with the swing."""
    rig, soles = L.rig, L.soles
    x_l = stance_h["l"][0].x
    period = len(walk) - 1
    stride = travel[-1]
    out_x = (tip_out if tip_out is not None else stick_lib.OUT) * L.k
    ahead_y = (ahead if ahead is not None else stick_lib.AHEAD) * L.k
    lift_y = -0.11 * L.k if lift_y is None else lift_y

    def trav_walk(u):
        return travel[u % period] + (u // period) * stride
    plants = []
    for (a, b) in windows[plant_side]:
        heel = soles.points(rig.fk(*walk[a % period]), plant_side)["heel"]
        p = Vector((x_l + out_x, heel.y - ahead_y, 0.0))
        plants.append((a, stick_lib.lift_frame(a, b, p, trav_walk, lift_y), p))
    tips = stick_lib.tip_track(len(walk), travel, plants, True, stride)
    captured = stick_lib.smooth_points(stick_lib.hand_grips(stk, walk), cyclic=True, k=3)
    yf, yb = -0.27 * L.k, -0.21 * L.k
    a0, b0, _p0 = plants[0]
    a1 = a0 + period

    def want_y(u):
        if u <= b0:
            return yf + (yb - yf) * (u - a0) / max(1, b0 - a0)
        return yb + (yf - yb) * MH.smooth((u - b0) / max(1, a1 - b0))
    want = []
    for k in range(len(walk)):
        u = k if k >= a0 else k + period
        want.append(Vector((tips[k].x - 0.03 * L.k, want_y(u), captured[k].z)))
    want = stick_lib.smooth_points(want, cyclic=True, k=2)
    err = stick_lib.apply(stk, walk, tips, want, cyclic=True)
    walk[-1] = lc.copy_frame(walk[0])
    rep["stick"] = {"plantSide": plant_side, "plantFrames": [[a, b] for a, b, _p in plants], "lengthMetres": round(stk.L, 4),
                    "plantedTipErrorCm": round(err * 100, 2)}
    return tips, plants, want_y


def stick_hold_clip(L, stk, frames, tip, ends=None):
    return MH.hold_static(stk, frames, tip, ends=ends)


# ------------------------------------------------------------------ base library

def walk_variants(L):
    names = ["walk", "walk_b", "walk_c"]
    for extra in ("walk_stick", "walk_crutch", "run"):
        if extra in L.spec:
            names.append(extra)
    return names


def transition_names(variant):
    return ("walk_start", "walk_stop") if variant == "walk" else (f"{variant}_start", f"{variant}_stop")


CROWD_TOE_CLEARANCE = 0.03


def crowd_toe_clearance(L, gait):
    """Lift the swing foot of a crowd walk so the body's lowest sole point clears the ground by CROWD_TOE_CLEARANCE away
    from contact (locomotion.swing_clearance; stance frames untouched), keeping the loop closed."""
    frames, travel, windows = gait
    lifted = lc.swing_clearance(L.rig, L.soles, frames, travel, windows, True, clearance=CROWD_TOE_CLEARANCE)
    frames[-1] = lc.copy_frame(frames[0])
    return lifted


def build_base(L, log=print):
    rig, soles, spec = L.rig, L.soles, L.spec
    rep = L.rep
    # neutral walk: its stance defines the hub stance every standing clip shares
    rep["walk"] = {}
    walk, travel, windows = build_gait(L, spec["walk"], rep["walk"])
    # motion fixer, 8 November: the crowd's long pointed turnshoes reach past the body's toe tip, so the body toe keeps
    # CROWD_TOE_CLEARANCE in mid-swing (the shoe tip then clears the ground by 1 to 2 cm instead of scuffing at 0.8 cm)
    rep["walk"]["crowdToeLiftCm"] = crowd_toe_clearance(L, (walk, travel, windows))
    stance_h = it.stance_from_walk(rig, soles, walk, windows, spec["walk"].get("toeOutDeg", 7.0))
    L.stance_h = stance_h
    L.gaits = {"walk": (walk, travel, windows)}
    L.add("walk", walk, True, "locomotion", gait="walk")
    log("walk", rep["walk"]["seconds"], rep["walk"]["speedMetresPerSecond"])
    # hub idle and idle_b
    rep["idle"] = {}
    idle = build_idle(L, spec["idle"], stance_h, spec["idleStyle"], rep["idle"])
    hub = lc.copy_frame(idle[0])
    L.hub = hub
    L.add("idle", idle, True, "idle", hub="hub")
    rep["idle_b"] = {}
    idle_b = build_idle(L, spec["idle_b"], stance_h, spec["idleStyleB"], rep["idle_b"])
    seal_to_hub(L, idle_b, hub, stance_h, count=12)
    L.add("idle_b", idle_b, True, "idle", hub="hub")
    log("idles", len(idle), len(idle_b))
    # other gaits and their start/stop clips (leave from and return to the hub)
    hub_x = (0.5 * (stance_h["l"][0].x - stance_h["r"][0].x), 0.5 * (stance_h["l"][0].x + stance_h["r"][0].x))
    for v in walk_variants(L):
        if v != "walk":
            rep[v] = {}
            g = build_gait(L, spec[v], rep[v], stance_x=None if spec[v].get("run") else hub_x)
            if v == "walk_crutch":  # the limp's sound foot skimmed the ground early in its swing: lift it clear
                rep[v]["extraSwingLiftCm"] = lc.swing_clearance(rig, soles, g[0], g[1], g[2], True, clearance=0.032)
                g[0][-1] = lc.copy_frame(g[0][0])
            elif not spec[v].get("run"):
                rep[v]["crowdToeLiftCm"] = crowd_toe_clearance(L, g)
            L.gaits[v] = g
            L.add(v, g[0], True, "locomotion", gait=v)
            log(v, rep[v]["seconds"], rep[v]["speedMetresPerSecond"])
    stick_users = [v for v in ("walk_stick", "walk_crutch") if v in L.gaits]
    for v in walk_variants(L):
        if v in stick_users or spec[v].get("run"):
            continue
        g_walk, g_trav, g_win = L.gaits[v]
        build_start_stop(L, v, g_walk, g_trav, g_win, idle, stance_h)
    # talk over the hub idle
    for name, style in (("talk", spec["talk"]), ("talk_b", spec["talkB"])):
        talk = it.talk_frames(rig, L.hands, soles, idle, stance_h, style, ik_blend=True)
        SM.skirt_follow(rig, talk)
        seal_to_hub(L, talk, hub, stance_h, count=8)
        L.add(name, talk, True, "talk", hub="hub", style=style)
        rep[name] = {"source": f"Crownfall talk style {style} over the 100STYLE-derived idle", "seconds": round((len(talk) - 1) / FPS, 4)}
    la = look_around(L, hub, stance_h)
    L.add("look_around", la, False, "idle", hub="hub")
    rep["look_around"] = {"source": "original keyframes (Crownfall) over the hub pose", "seconds": round((len(la) - 1) / FPS, 4)}
    # seated rest on a stool behind the hub stance
    sit, sinfo = seated_frames(L, stance_h)
    down = sit_down(L, hub, sit[0], stance_h, 1.9 if L.archetype not in ("elder-male", "elder-female") else 2.5)
    up = stand_up(L, sit[-1], hub, stance_h, 1.8 if L.archetype not in ("elder-male", "elder-female") else 2.4)
    for c in (down, up):
        SM.skirt_follow(rig, c, cyclic=False)
    down[0], down[-1], up[0], up[-1] = lc.copy_frame(hub), lc.copy_frame(sit[0]), lc.copy_frame(sit[-1]), lc.copy_frame(hub)
    L.sit = sit
    L.seat = sinfo["seat"]
    L.add("sit_down", down, False, "transition", fromPose="hub", toPose="sit")
    L.add("sit", sit, True, "seated", hub="sit", workplace=[{"prop": "stool", **sinfo["seat"]}])
    L.add("stand_up", up, False, "transition", fromPose="sit", toPose="hub")
    rep["sit"] = {"source": "original keyframes (Crownfall), seated rest", "seconds": round((len(sit) - 1) / FPS, 4), **sinfo}
    rep["sit_down"] = {"source": "original keyframes (Crownfall) over planted feet", "seconds": round((len(down) - 1) / FPS, 4)}
    rep["stand_up"] = {"source": "original keyframes (Crownfall) over planted feet", "seconds": round((len(up) - 1) / FPS, 4)}
    # walking stick and crutch
    if stick_users:
        build_stick_set(L, stick_users, idle, stance_h, log)
    if "run" in L.gaits:
        L.meta["run"]["note"] = "crossfade from walk at matching phase; no run start or stop clip"
    return L


def build_start_stop(L, v, walk, travel, windows, idle, stance_h, stick=None):
    rig, soles = L.rig, L.soles
    speed = L.rep[v]["speedMetresPerSecond"]
    s_name, e_name = transition_names(v)
    stop_info, start_info = {}, {}
    stop, stop_trav, _ = lc.synth_stop(rig, soles, walk, travel, windows, idle[0], stance_h, speed, report=stop_info)
    start, start_trav, _ = lc.synth_start(rig, soles, walk, travel, windows, idle[0], stance_h, speed, report=start_info)
    SM.skirt_follow(rig, stop, cyclic=False)
    SM.skirt_follow(rig, start, cyclic=False)
    SM.seal_locomotion_joins(rig, soles, walk, idle, start, stop, start_trav, stop_trav)
    L.add(s_name, start, False, "transition", fromPose="hub" if stick is None else "hub_stick", toClip=v,
          rootTravelMetres=[round(float(x), 4) for x in start_trav])
    L.add(e_name, stop, False, "transition", fromClip=v, toPose="hub" if stick is None else "hub_stick",
          rootTravelMetres=[round(float(x), 4) for x in stop_trav])
    L.rep[s_name] = {"source": f"Crownfall-built from the archetype's 100STYLE-derived {v} and hub idle (locomotion.synth_start)",
                     "seconds": round((len(start) - 1) / FPS, 4), **{k: v_ for k, v_ in start_info.items() if k != "rootTravelMetres"}}
    L.rep[e_name] = {"source": f"Crownfall-built from the archetype's 100STYLE-derived {v} and hub idle (locomotion.synth_stop)",
                     "seconds": round((len(stop) - 1) / FPS, 4), **{k: v_ for k, v_ in stop_info.items() if k != "rootTravelMetres"}}
    return start, start_trav, stop, stop_trav, stop_info


def build_stick_set(L, users, idle, stance_h, log):
    """walk_stick / walk_crutch with their own hub (the stick planted beside the left foot): idle_stick (elders),
    talk_stick and the start and stop clips; the stick is the left hand's prop throughout."""
    rig, spec = L.rig, L.spec
    length = round(spec.get("stickLengthShare", 0.55) * L.info["statureCm"] / 100.0, 3)
    stk, g = make_stick(L, length)
    L.stick = {"length": length, "grip": g}
    flat = lambda m: [round(v, 6) for col in m.transposed() for v in col]
    stick_prop = {"prop": "walking-stick", "bone": "hand_l", "matrix": flat(g), "lengthMetres": length,
                  "frame": "grip at the origin, shaft down -Z to the tip (household stick frame)"}
    tip_idle = Vector((stance_h["l"][0].x + stick_lib.OUT * L.k, -0.2 * L.k, 0.0))
    if "idle_stick" in spec:
        L.rep["idle_stick"] = {}
        idle_s = build_idle(L, spec["idle_stick"], stance_h, "elder", L.rep["idle_stick"])
    else:
        idle_s = [lc.copy_frame(f) for f in idle]
    probe = lc.copy_frame(idle_s[0])
    stk.set_canonical(probe, tip_idle, stk.grip_point(rig.fk(*idle_s[0])))
    err = stick_hold_clip(L, stk, idle_s, tip_idle)
    idle_s[-1] = lc.copy_frame(idle_s[0])
    hub_s = lc.copy_frame(idle_s[0])
    L.hub_stick = hub_s
    L.stick["tipIdleBlender"] = [round(v, 4) for v in tip_idle]
    if "idle_stick" in spec:
        L.add("idle_stick", idle_s, True, "idle", hub="hub_stick", props=[stick_prop])
        L.rep["idle_stick"]["plantedTipErrorCm"] = round(err * 100, 2)
    crutch_len = round(spec.get("crutchLengthShare", 0.53) * L.info["statureCm"] / 100.0, 3)
    for v in users:
        walk, travel, windows = L.gaits[v]
        if v == "walk_crutch":
            stk, g = make_stick(L, crutch_len)
            stk.set_canonical(lc.copy_frame(idle_s[0]), tip_idle, stk.grip_point(rig.fk(*idle_s[0])))
            L.crutch = {"length": crutch_len}
            crutch_prop = dict(stick_prop, prop="crutch", matrix=flat(g), lengthMetres=crutch_len,
                               frame="hand grip at the origin, shaft down -Z to the tip, the pad above on +Z under the armpit")
        if v == "walk_stick":
            stick_walk(L, stk, walk, travel, windows, stance_h, "r", L.rep[v])
        else:  # the crutch takes the weak (left) leg's weight: planted beside that foot, lifted with it
            stick_walk(L, stk, walk, travel, windows, stance_h, "l", L.rep[v], tip_out=0.15, ahead=0.22, lift_y=0.06 * L.k)
        L.meta[v]["props"] = [stick_prop if v == "walk_stick" else crutch_prop]
        if v == "walk_stick":
            # start and stop from the stick hub: the stick is re-solved over the synthesised steps
            start, start_trav, stop, stop_trav, stop_info = build_start_stop(L, v, walk, travel, windows, idle_s, stance_h, stick=True)
            stick_transitions(L, stk, v, walk, travel, windows, idle_s, start, start_trav, stop, stop_trav, stop_info, tip_idle)
            for nm in transition_names(v):
                L.meta[nm]["props"] = [stick_prop]
        else:
            L.meta[v]["note"] = "crutch walk: crossfade from the hub at matching phase; no start or stop clip"
        log(v, "stick", L.rep[v]["stick"])
    if "idle_stick" not in spec:
        return  # crutch only (adult-male): the crutch user idles and talks with the hub clips
    talk = it.talk_frames(rig, L.hands, L.soles, idle_s, stance_h, "elder", stick_side="l", ik_blend=True)
    stick_hold_clip(L, stk, talk, tip_idle)
    SM.skirt_follow(rig, talk)
    seal_to_hub(L, talk, hub_s, stance_h, count=8)
    L.add("talk_stick", talk, True, "talk", hub="hub_stick", props=[stick_prop])
    L.rep["talk_stick"] = {"source": "Crownfall talk style elder over the stick idle", "seconds": round((len(talk) - 1) / FPS, 4)}
    g_hub = stk.grip_point(rig.fk(*hub_s))
    la = look_around(L, hub_s, stance_h, stick=(stk, tip_idle, g_hub))
    L.add("look_around_stick", la, False, "idle", hub="hub_stick", props=[stick_prop])
    L.rep["look_around_stick"] = {"source": "original keyframes (Crownfall) over the stick hub", "seconds": round((len(la) - 1) / FPS, 4)}


def stick_transitions(L, stk, v, walk, travel, windows, idle_s, start, start_trav, stop, stop_trav, stop_info, tip_idle):
    """walk_stick_start leaves the stick hub's plant and eases into the walk's swing; walk_stick_stop continues the
    swing and lands on the hub plant (motion_household.elder_stick's rule)."""
    rig = L.rig
    period = len(walk) - 1
    plants = [(a, b, None) for a, b in L.rep[v]["stick"]["plantFrames"]]
    a0, b0 = plants[0][0], plants[0][1]
    walk_tips = [stk.tip_of(rig.fk(*f)) for f in walk]
    for t in walk_tips:
        if t.z < 0.004:
            t.z = 0.0
    p0 = walk_tips[a0 % period].copy()
    p0.z = 0.0
    v_walk = travel[-1] / period
    lift_y = -0.11 * L.k
    g_idle = stk.grip_point(rig.fk(*idle_s[0]))
    g_walk0 = stk.grip_point(rig.fk(*walk[0]))
    n = len(start)
    b_s = stick_lib.lift_frame(0, n - 1, tip_idle, lambda u: start_trav[max(0, min(n - 1, u))], lift_y)
    tips = stick_lib.tip_track(n, start_trav, [(0, b_s, tip_idle), (n - 1 + a0, n - 1 + b0, p0)], False, speed=v_walk)
    K = min(8, n // 2)
    tips = stick_lib.blend_tips(tips, [walk_tips[(period - K + 1 + k) % period] for k in range(K)], K, at_end=True)
    want = [g_idle.lerp(g_walk0, MH.smooth(i / max(1, n - 1))) for i in range(n)]
    stick_lib.apply(stk, start, tips, want)
    start[0], start[-1] = lc.copy_frame(idle_s[0]), lc.copy_frame(walk[0])
    n = len(stop)
    _to_r, land = stop_info["closingStepFrames"]
    land = max(6, min(land, n - 4))
    lifted = (a0 - period, b0 - period, p0)
    p1 = tip_idle - Vector((0.0, stop_trav[-1] - stop_trav[land], 0.0))
    tips = stick_lib.tip_track(n, stop_trav, [lifted, (land, n - 1, p1)], False, speed=v_walk)
    tips = stick_lib.blend_tips(tips, [walk_tips[k] for k in range(K)], K, at_end=False)
    want = [g_walk0.lerp(g_idle, MH.smooth(i / max(1, n - 1))) for i in range(n)]
    stick_lib.apply(stk, stop, tips, want)
    stop[0], stop[-1] = lc.copy_frame(walk[0]), lc.copy_frame(idle_s[0])


# ------------------------------------------------------------------ measurements (Blender side, before export)

def clip_quality(L, name, frames, travel=None, cyclic=False):
    """Sole-point slide and penetration (locomotion.clip_metrics), seam, and the largest per-frame joint jump."""
    m = lc.clip_metrics(L.rig, L.soles, frames, travel=travel, cyclic=cyclic)
    out = {"minSoleCm": None, "maxSlideCm": 0.0}
    lows, slides = [], []
    for s in ("l", "r"):
        side = m.get(s, {})
        for part in ("heel", "ball", "tip"):
            if part in side:
                lows.append(side[part]["minZcm"])
                slides.append(side[part]["maxSlideCm"])
    out["minSoleCm"] = round(min(lows), 2) if lows else None
    out["maxSlideCm"] = round(max(slides), 2) if slides else 0.0
    if cyclic:
        # q and -q are the same rotation (the hemisphere pass may flip a joint's sign along a loop)
        out["seamDegrees"] = round(max(math.degrees(2.0 * math.acos(min(1.0, abs(frames[0][0][b].dot(frames[-1][0].get(b, Quaternion()))))))
                                       for b in frames[0][0]), 3)
    jumps = lc.joint_speed_jumps(frames, cyclic=cyclic)
    out["jointJumps"] = jumps
    return out

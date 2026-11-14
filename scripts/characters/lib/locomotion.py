"""Foot contact, foot roll and gait measurements for the resident clips (original Crownfall code, motion stage).

The first clips locked the ankle joint to one anchor while it was low and slow. That missed heel strike and push-off
(the ankle is high while the heel or the toe is down), so the walks had almost no double support, the planted toe slid
during push-off and the swing toe could drag. Here each foot has three sole points measured from the shoe and foot
geometry (heel, ball under the toe joint, toe tip):

* stance windows of a walk cycle come from the foot's own motion relative to the pelvis (heel strike where the foot is
  furthest forward, toe-off where it is furthest back), so every foot is on the ground about 60 percent of the cycle
  with double support where the windows overlap;
* during stance the lowest sole point of the captured foot roll is the pivot: it is held on one ground anchor (heel
  rocker, flat foot, then the ball and the toe tip), the foot's yaw is held, and the leg reaches it by two-bone IK;
* in swing the foot path keeps a minimum toe clearance and the foot pitch is capped;
* measurements report stance share, double support, per-pivot slide, ground penetration, swing clearance and the
  pelvis, shoulder and foot facing relative to the travel direction.
"""
import math

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

import motion as mo

FPS = 30


def smoothstep(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


class Soles:
    """Heel (foot bone), ball (foot bone, under the toe joint) and toe tip (toes bone) sole points per side."""

    def __init__(self, rig, meshes=("Body", "Clothes")):
        self.rig = rig
        self.local = {}
        self.ground = {}
        for side in ("l", "r"):
            pts = []
            for name in meshes:
                obj = bpy.data.objects.get(name)
                if obj is None:
                    continue
                gi = {g.name: g.index for g in obj.vertex_groups}
                ids = [gi[n] for n in (f"foot_{side}", f"toes_{side}") if n in gi]
                if not ids:
                    continue
                mw = obj.matrix_world
                for v in obj.data.vertices:
                    w = sum(g.weight for g in v.groups if g.group in ids)
                    if w >= 0.5:
                        pts.append(mw @ v.co)
            P = np.array([list(p) for p in pts])
            zmin = float(P[:, 2].min())
            low = P[P[:, 2] < zmin + 0.012]
            ys = low[:, 1]  # Blender forward is -Y: the heel has the largest y
            heel = low[ys > ys.max() - 0.25 * (ys.max() - ys.min())].mean(axis=0)
            tip = low[ys < ys.min() + 0.12 * (ys.max() - ys.min())].mean(axis=0)
            toes_head = rig.rest[f"toes_{side}"].translation
            ball = np.array([toes_head.x, toes_head.y, zmin])
            heel[2] = tip[2] = zmin
            foot_inv = rig.rest[f"foot_{side}"].inverted()
            toes_inv = rig.rest[f"toes_{side}"].inverted()
            self.local[side] = {"heel": ("foot_" + side, foot_inv @ Vector(heel)),
                                "ball": ("foot_" + side, foot_inv @ Vector(ball)),
                                "tip": ("toes_" + side, toes_inv @ Vector(tip))}
            self.ground[side] = zmin
        self.length = {s: (self.world_rest(s, "tip") - self.world_rest(s, "heel")).length for s in ("l", "r")}

    def world_rest(self, side, point):
        bone, local = self.local[side][point]
        return self.rig.rest[bone] @ local

    def points(self, pose, side):
        return {k: pose[b] @ v for k, (b, v) in self.local[side].items()}


# ------------------------------------------------------------------ measurements

def _yaw_of(v):
    """Heading of a horizontal direction relative to Blender forward (-Y), degrees, positive toward +X (the left)."""
    return math.degrees(math.atan2(v.x, -v.y))


def clip_metrics(rig, soles, frames, travel=None, cyclic=False, down=0.01, contact=0.015, fps=FPS):
    """Sole-point measurements of one clip; `travel` is the forward root travel per frame (metres, along -Y)."""
    n = len(frames)
    travel = travel if travel is not None else [0.0] * n
    rows = []
    for i, (rot, loc) in enumerate(frames):
        pose = rig.fk(rot, loc)
        row = {"pose": pose}
        for s in ("l", "r"):
            row[s] = soles.points(pose, s)
        rows.append(row)
    out = {"frames": n}
    worst_pen, flags = 0.0, {}
    for s in ("l", "r"):
        side = {}
        anyc = []
        for part in ("heel", "ball", "tip"):
            z = [r[s][part].z for r in rows]
            worst_pen = min(worst_pen, min(z))
            dn = [h < down for h in z]
            wp = [Vector((r[s][part].x, r[s][part].y - travel[i], 0.0)) for i, r in enumerate(rows)]  # world (ground) frame
            slides, scuffs, k = [], 0, 0
            min_run = max(2, int(round(0.1 * fps)))
            while k < n:
                if dn[k]:
                    j = k
                    while j < n and dn[j]:
                        j += 1
                    run = wp[k:j]
                    if j - k >= min_run:
                        slides.append(max((a - b).length for a in run for b in run))
                    elif len(run) > 1 and max((a - b).length for a in run for b in run) / ((j - k) / fps) > 0.5:
                        scuffs += 1
                    k = j
                else:
                    k += 1
            side[part] = {"downShare": round(sum(dn) / n, 3), "maxSlideCm": round(max(slides) * 100, 2) if slides else 0.0,
                          "minZcm": round(min(z) * 100, 2), "scuffs": scuffs}
            anyc.append([h < contact for h in z])
        flags[s] = [any(c[i] for c in anyc) for i in range(n)]
        side["contactShare"] = round(sum(flags[s]) / n, 3)
        # swing: frames off the ground; clearance = lowest toe tip while the foot moves fast over the ground
        clear = []
        for i in range(n):
            if flags[s][i]:
                continue
            a, b = max(0, i - 1), min(n - 1, i + 1)
            pa = Vector((rows[a][s]["tip"].x, rows[a][s]["tip"].y - travel[a], 0))
            pb = Vector((rows[b][s]["tip"].x, rows[b][s]["tip"].y - travel[b], 0))
            speed = (pb - pa).length / max(1, b - a) * fps
            if speed > 0.5:
                clear.append(min(rows[i][s]["tip"].z, rows[i][s]["ball"].z, rows[i][s]["heel"].z))
        side["minSwingClearanceCm"] = round(min(clear) * 100, 2) if clear else None
        out[s] = side
    both = sum(1 for i in range(n) if flags["l"][i] and flags["r"][i])
    none = sum(1 for i in range(n) if not flags["l"][i] and not flags["r"][i])
    out["doubleSupportShare"] = round(both / n, 3)
    out["flightShare"] = round(none / n, 3)
    out["minSoleZcm"] = round(worst_pen * 100, 2)
    # facing relative to travel (-Y): pelvis, shoulder line, feet (heel to tip, in contact)
    pel, sho, feet = [], [], {"l": [], "r": []}
    hips_fwd = rig.rest["hips"].to_3x3().inverted() @ Vector((0, -1, 0))
    for i, r in enumerate(rows):
        pose = r["pose"]
        f = pose["hips"].to_3x3() @ hips_fwd
        pel.append(_yaw_of(Vector((f.x, f.y, 0))))
        across = pose["upperarm_l"].translation - pose["upperarm_r"].translation
        sho.append(_yaw_of(Vector((across.y, -across.x, 0))) if across.length > 1e-6 else 0.0)
        for s in ("l", "r"):
            if flags[s][i]:
                d = r[s]["tip"] - r[s]["heel"]
                feet[s].append(_yaw_of(Vector((d.x, d.y, 0))))
    out["facing"] = {"pelvisDeg": round(float(np.mean(pel)), 1), "shoulderDeg": round(float(np.mean(sho)), 1),
                     "footLdeg": round(float(np.mean(feet["l"])), 1) if feet["l"] else None,
                     "footRdeg": round(float(np.mean(feet["r"])), 1) if feet["r"] else None}
    if cyclic and n > 2:
        # seam: velocity of every joint across the loop seam against the neighbouring frames
        out["seamPoseDeg"] = round(mo.seam_degrees(frames), 2)
    return out


def joint_speed_jumps(frames, cyclic=True, fps=FPS):
    """Largest change of a joint's angular speed between consecutive frames (deg/s), and at the loop seam."""
    n = len(frames)
    names = sorted(frames[0][0])
    speeds = {}
    for b in names:
        sp = []
        for i in range(n - 1):
            q0 = frames[i][0].get(b, Quaternion())
            q1 = frames[i + 1][0].get(b, Quaternion())
            sp.append(math.degrees(q0.rotation_difference(q1).angle) * fps)
        speeds[b] = sp
    worst_in, worst_seam = (0.0, None), (0.0, None)
    for b, sp in speeds.items():
        for i in range(1, len(sp)):
            j = abs(sp[i] - sp[i - 1])
            if j > worst_in[0]:
                worst_in = (j, f"{b}@{i}")
        if cyclic and len(sp) > 1:
            j = abs(sp[0] - sp[-1])
            if j > worst_seam[0]:
                worst_seam = (j, b)
    return {"maxSpeedJumpDegS": round(worst_in[0], 1), "at": worst_in[1],
            "seamSpeedJumpDegS": round(worst_seam[0], 1) if cyclic else None, "seamJoint": worst_seam[1]}


# ------------------------------------------------------------------ paths and facing

def align_chord(yaws, path):
    """Turn a straightened capture so its travel (the chord of the straightened hips path) runs along -Y. The first
    clips aligned the chord of the ORIGINAL curved path instead, while straightening keeps the initial heading, so
    every walk faced half the cycle's turn off its travel (a crab walk: the smith's pelvis 19 degrees off)."""
    d = Vector(path[-1]) - Vector(path[0])
    theta = math.atan2(d.x, -d.y)
    rz = Matrix.Rotation(-theta, 3, "Z")
    return [float(y) - theta for y in yaws], [np.array(rz @ Vector(p)) for p in path], math.degrees(theta)


def incremental_path(bvh, pos, yaws, hips="Hips"):
    """Hips path of a take turned by a per-frame yaw, integrated step by step from the first frame. Rotating the
    absolute capture positions about the capture origin (the first transitions) moved a standing actor several
    centimetres per degree of yaw change, so planted heels slid during the heading ease."""
    p = mo.to_blender_pos(pos[:, bvh.index(hips)])
    out = np.zeros_like(p)
    out[0] = np.array(Matrix.Rotation(yaws[0], 3, "Z") @ Vector(p[0]))
    for k in range(1, len(p)):
        out[k] = out[k - 1] + np.array(Matrix.Rotation(yaws[k], 3, "Z") @ Vector(p[k] - p[k - 1]))
    return out


# ------------------------------------------------------------------ stance windows

def cycle_windows(rig, frames, soles=None, travel=None, band=0.02, heel_band=0.012, max_share=0.64):
    """Stance windows of an in-place walk cycle (last frame repeats the first). The foot is furthest forward of the
    pelvis just before heel strike and furthest back just after toe-off (there it still moves with the body); with sole
    points the window is trimmed to the frames where the heel (start) and the toe (end) are within `band` of their
    lowest heights. Returns {side: [(a, b)]}, unwrapped indices."""
    period = len(frames) - 1
    rel = {"l": [], "r": []}
    pts = {"l": [], "r": []}
    for rot, loc in frames[:-1]:
        pose = rig.fk(rot, loc)
        for s in ("l", "r"):
            rel[s].append(pose[f"foot_{s}"].translation.y - pose["hips"].translation.y)
            if soles is not None:
                pts[s].append(soles.points(pose, s))
    out = {}
    for s in ("l", "r"):
        y = np.array(rel[s])
        ff = int(np.argmin(y))  # furthest forward (Blender forward is -Y): late swing, just before heel strike
        hs, to = ff, int(np.argmax(y))
        if to <= hs:
            to += period
        if soles is not None:
            # heights do not depend on the per-frame yaw of the straightened capture (speeds do: the straightening
            # turns each captured frame about the hips, which swings a planted foot round by about a degree a frame)
            hz = [pts[s][u]["heel"].z for u in range(period)]
            tz = [min(pts[s][u]["tip"].z, pts[s][u]["ball"].z) for u in range(period)]
            h_min, t_min = min(hz), min(tz)
            heel_down = lambda u: hz[u % period] <= h_min + heel_band
            toe_down = lambda u: tz[u % period] <= t_min + band
            hs = ff - 2
            while hs < ff + period // 3 and not heel_down(hs):
                hs += 1
            to = hs
            # a shuffling swing keeps the toe low: stance never runs past max_share of the cycle (the elder's right
            # foot stood 81 percent of her cycle and its 5-frame swing whipped through the ground)
            while to < hs + int(max_share * period) - 1 and (heel_down(to + 1) or toe_down(to + 1)):
                to += 1
            if hs < 0:
                hs, to = hs + period, to + period
        out[s] = [(hs, to)]
    return out


def detect_windows(rig, soles, frames, travel, height=0.03, speed=0.3, min_run=4, gap=3):
    """Stance windows of a non-cyclic clip from sole height and ground-relative speed."""
    n = len(frames)
    low = {s: [] for s in ("l", "r")}
    pos = {s: [] for s in ("l", "r")}
    for i, (rot, loc) in enumerate(frames):
        pose = rig.fk(rot, loc)
        for s in ("l", "r"):
            pts = soles.points(pose, s)
            p = min(pts.values(), key=lambda v: v.z)
            low[s].append(p.z)
            c = (pts["heel"] + pts["ball"]) * 0.5
            pos[s].append(Vector((c.x, c.y - travel[i], 0.0)))
    out = {}
    for s in ("l", "r"):
        flags = []
        for i in range(n):
            a, b = max(0, i - 1), min(n - 1, i + 1)
            v = (pos[s][b] - pos[s][a]).length / max(1, b - a) * FPS
            flags.append(low[s][i] < height and v < speed)
        for i in range(n):  # close short gaps
            if not flags[i] and any(flags[max(0, i - gap):i]) and any(flags[i + 1:i + 1 + gap]):
                flags[i] = True
        runs, i = [], 0
        while i < n:
            if flags[i]:
                j = i
                while j < n and flags[j]:
                    j += 1
                if j - i >= min_run:
                    runs.append((i, j - 1))
                i = j
            else:
                i += 1
        out[s] = runs
    return out


# ------------------------------------------------------------------ foot roll lock

GROUND = 0.002  # sole points rest 2 mm above the ground plane
LEG_BONES = frozenset(f"{b}_{s}" for b in ("thigh", "calf", "foot", "toes") for s in ("l", "r"))
WALK_THETAS = {}  # per walk cycle (id of its frame list): {side: (landing pitch, push-off pitch)} for its transitions


def _heading(v):
    return math.atan2(v.x, -v.y)


def _foot_world(rig, pose, side):
    return pose[f"foot_{side}"].to_3x3().copy(), pose[f"foot_{side}"].translation.copy()


def _sole_offsets(rig, soles, pose, side, foot_rot):
    """Sole points relative to the ankle for a given world foot rotation (toes keep their local rotation)."""
    ankle = pose[f"foot_{side}"].translation
    cur = pose[f"foot_{side}"].to_3x3()
    delta = foot_rot @ cur.inverted()
    pts = soles.points(pose, side)
    return {k: delta @ (p - ankle) for k, p in pts.items()}


def _pitch_of(pts):
    """Foot pitch from the heel and ball sole points: positive = heel up (toes down), radians."""
    d = pts["ball"] - pts["heel"]
    return math.atan2(-d.z, Vector((d.x, d.y, 0.0)).length)


def stance_pitch(s, theta_hs, theta_to, flat_from=0.14, heel_off=0.52):
    """Foot roll through stance (s = 0 at heel strike, 1 at toe-off): heel rocker from the landing pitch to flat, flat
    foot, then the heel rises to the push-off pitch (about the ball)."""
    if s < flat_from:
        return theta_hs * (1.0 - smoothstep(s / flat_from))
    if s <= heel_off:
        return 0.0
    return theta_to * smoothstep((s - heel_off) / (1.0 - heel_off)) ** 1.3


def roll_lock(rig, soles, frames, travel, windows, cyclic, ease=4, anchors=None, yaw_override=None, report=None,
              theta_override=None, thetas_out=None):
    """Plant each stance on the ground with an authored foot roll: heel strike on the heel rocker (the landing pitch
    taken from the capture, at most 25 degrees toe-up), a flat foot from 14 to 52 percent of stance, then the heel
    rising about the ball with the toes kept flat to the captured push-off pitch (20 to 70 degrees). The pivot (heel,
    then ball) stays on one ground anchor carried with the travel, the stance keeps one heading, and the leg reaches by
    two-bone IK; the lock eases in and out over `ease` frames in the air. The captured stance feet stood on their toe
    tips with the heel 2 cm up for most of the stance, so the roll is authored rather than copied. `anchors` may fix a
    window's heel anchor {(side, a): Vector}; `yaw_override` {(side, a): heading radians}."""
    n = len(frames)
    period = n - 1 if cyclic else n
    stride = (travel[-1] - travel[0]) if cyclic else 0.0

    def trav(u):
        if cyclic:
            return travel[u % period] + (u // period) * stride
        return travel[max(0, min(n - 1, u))]
    poses = [rig.fk(r, l) for r, l in frames]
    plan = {s: [None] * n for s in ("l", "r")}
    # hip-to-ankle distance with the knee bent 12 degrees: the furthest a stance leg reaches without locking
    reach = {s: math.sqrt(rig.length[f"thigh_{s}"] ** 2 + rig.length[f"calf_{s}"] ** 2 + 2 * rig.length[f"thigh_{s}"] *
                          rig.length[f"calf_{s}"] * math.cos(math.radians(12.0))) for s in ("l", "r")}
    for s in ("l", "r"):
        rh = rest_heading(soles, s)
        ankle_rest = rig.rest[f"foot_{s}"].translation
        rest_foot = rig.rest[f"foot_{s}"].to_3x3()
        rest_toes = rig.rest[f"toes_{s}"].to_3x3()
        rel_toes = rig.rel[f"toes_{s}"].to_3x3()
        off_rest = {k: soles.world_rest(s, k) - ankle_rest for k in ("heel", "ball")}
        for (a, b) in windows[s]:
            idx = [u % period if cyclic else min(n - 1, max(0, u)) for u in range(a, b + 1)]
            pts0 = soles.points(poses[idx[0]], s)
            pts1 = soles.points(poses[idx[-1]], s)
            heading = (yaw_override or {}).get((s, a))
            if heading is None:
                mid = soles.points(poses[idx[len(idx) // 2]], s)
                heading = _heading(mid["tip"] - mid["heel"])
            rz = Matrix.Rotation(heading - rh, 3, "Z")
            r_flat = rz @ rest_foot
            toes_flat = rz @ rest_toes
            lat = Vector((math.cos(heading), math.sin(heading), 0.0))
            theta_hs = max(-0.44, min(0.0, _pitch_of(pts0)))
            theta_to = max(0.35, min(1.22, _pitch_of(pts1)))
            if theta_override and (s, a) in theta_override:  # a transition continuing the walk's own stance roll
                theta_hs, theta_to = theta_override[(s, a)]
            if thetas_out is not None:
                thetas_out[(s, a)] = (theta_hs, theta_to)
            base = (anchors or {}).get((s, a))
            if base is None:
                base = Vector((pts0["heel"].x, pts0["heel"].y, GROUND))
            anchor = {"heel": Vector((base.x, base.y, GROUND))}
            anchor["ball"] = anchor["heel"] + rz @ (off_rest["ball"] - off_rest["heel"])
            anchor["tip"] = anchor["heel"] + rz @ (soles.world_rest(s, "tip") - soles.world_rest(s, "heel"))
            anchor["ball"].z = anchor["tip"].z = GROUND
            span = max(1, b - a)
            for u in range(a - ease, b + ease + 1):
                if not cyclic and (u < 0 or u >= n):
                    continue
                k = u % period if cyclic else u
                d = (a - u) if u < a else (u - b) if u > b else 0
                w = 1.0 if d == 0 else smoothstep(1.0 - d / (ease + 1.0))
                if plan[s][k] is not None and plan[s][k][0] >= w:
                    continue
                sp = min(1.0, max(0.0, (u - a) / span))
                theta = stance_pitch(sp, theta_hs, theta_to)
                # before heel strike the landing spot is carried with the ground; after toe-off the lock eases out from
                # the toe-off pose itself (carried with the ground it dragged the leg straight behind the body)
                shift = Vector((0.0, trav(min(u, b)) - trav(a), 0.0))
                hip = poses[k][f"thigh_{s}"].translation

                def ankle_at(th):
                    # sole points relative to the ankle with the foot pitched by th (toes kept flat when the heel is
                    # up); the lowest one is the pivot on its anchor (heel rocker, flat foot, ball, then the toe tip:
                    # pitching about the ball sole point alone pushed the flat toes 8 mm into the ground)
                    rp = Matrix.Rotation(th, 3, lat) @ rz
                    offs = {"heel": rp @ off_rest["heel"], "ball": rp @ off_rest["ball"]}
                    toes_head = rp @ (rig.rest[f"toes_{s}"].translation - ankle_rest)
                    tip_rel = (rz if th > 0 else rp) @ (soles.world_rest(s, "tip") - rig.rest[f"toes_{s}"].translation)
                    offs["tip"] = toes_head + tip_rel
                    pv = min(offs, key=lambda key: offs[key].z)
                    return anchor[pv] + shift - offs[pv], pv
                if sp > 0.3:
                    # the heel rises as far as the leg needs to reach the planted ball with a bent knee (the authored
                    # profile alone left the knee locked straight behind the body before toe-off)
                    lo_t, hi_t = theta, 1.3
                    if (ankle_at(lo_t)[0] - hip).length > reach[s]:
                        for _ in range(14):
                            m = 0.5 * (lo_t + hi_t)
                            lo_t, hi_t = (m, hi_t) if (ankle_at(m)[0] - hip).length > reach[s] else (lo_t, m)
                        theta = hi_t
                ankle, pivot = ankle_at(theta)
                if d > 0:  # in the air: the foot descends onto the landing spot and rises off the toe-off spot
                    ankle = ankle + Vector((0.0, 0.0, 0.012 * d))
                r_foot = Matrix.Rotation(theta, 3, lat) @ r_flat
                toes_world = toes_flat if theta > 0 else r_foot @ rest_foot.inverted() @ rest_toes
                toes_basis = ((r_foot @ rel_toes).inverted() @ toes_world).to_quaternion()
                plan[s][k] = (w, ankle, r_foot, toes_basis, d > 0)
        if cyclic:  # the in-place loop's last frame repeats the first (same unwrapped time, same anchor)
            plan[s][n - 1] = plan[s][0]
    for i, (rot, loc) in enumerate(frames):
        pose = poses[i]
        for s in ("l", "r"):
            p = plan[s][i]
            if p is None:
                continue
            w, ankle, r_foot, toes_basis, air = p
            goal = pose[f"foot_{s}"].translation.lerp(ankle, w)
            knee = pose[f"calf_{s}"].translation
            mo.two_bone_ik(rig, pose, rot, loc, f"thigh_{s}", f"calf_{s}", f"foot_{s}", goal, knee + Vector((0, -0.4, 0)))
            cur = pose[f"foot_{s}"].to_3x3().to_quaternion()
            tgt = r_foot.to_quaternion()
            if cur.dot(tgt) < 0:
                tgt.negate()
            mo.set_world_rotation(rig, pose, rot, loc, f"foot_{s}", cur.slerp(tgt, w).to_matrix())
            tq = rot.get(f"toes_{s}", Quaternion())
            tb = toes_basis.copy()
            if tq.dot(tb) < 0:
                tb.negate()
            rot[f"toes_{s}"] = tq.slerp(tb, w)
            rig.update_chain(pose, rot, loc, f"toes_{s}")
    if report is not None:
        report["stanceWindows"] = {s: [list(w) for w in windows[s]] for s in windows}
    return plan


def leg_reach_drop(rig, frames, plan_targets, margin=0.995):
    """Pelvis drop (metres, per frame) that lets both legs reach their ankle targets without locking the knee."""
    drops = []
    la = {s: rig.length[f"thigh_{s}"] for s in ("l", "r")}
    lb = {s: rig.length[f"calf_{s}"] for s in ("l", "r")}
    for i, (rot, loc) in enumerate(frames):
        pose = rig.fk(rot, loc)
        need = 0.0
        for s in ("l", "r"):
            t = plan_targets[s][i]
            if t is None:
                continue
            hip = pose[f"thigh_{s}"].translation
            reach = (la[s] + lb[s]) * margin
            d = t - hip
            horiz = Vector((d.x, d.y, 0.0)).length
            if horiz >= reach:
                need = max(need, 0.05)
                continue
            vert_max = math.sqrt(reach * reach - horiz * horiz)
            need = max(need, -d.z - vert_max)
        drops.append(max(0.0, need))
    return drops


def lower_pelvis(rig, frames, drops, cyclic, smooth_frames=3):
    n = len(frames)
    d = np.array(drops, dtype=float)
    if smooth_frames > 0 and d.any():
        k = smooth_frames
        if cyclic:
            pad = np.concatenate([d[-1 - k:-1], d, d[1:1 + k]])
        else:
            pad = np.pad(d, k, mode="edge")
        # max filter then box blur: never less than needed
        mx = np.array([pad[i:i + 2 * k + 1].max() for i in range(n)])
        pad = np.concatenate([mx[-1 - k:-1], mx, mx[1:1 + k]]) if cyclic else np.pad(mx, k, mode="edge")
        d = np.array([pad[i:i + 2 * k + 1].mean() for i in range(n)])
    for i, (rot, loc) in enumerate(frames):
        if d[i] <= 0:
            continue
        p = rig.rest["hips"] @ loc["hips"]
        p.z -= float(d[i])
        loc["hips"] = rig.rest["hips"].inverted() @ p
    return float(d.max()) if len(d) else 0.0


def swing_clearance(rig, soles, frames, travel, windows, cyclic, clearance=0.018, max_pitch_deg=55.0, ease=4):
    """Lift the swing foot so its lowest sole point clears the ground by `clearance` away from contact, and cap the
    swing foot's toe-down pitch (the captured swings pitched 63 to 69 degrees and dragged the child's toe)."""
    n = len(frames)
    period = n - 1 if cyclic else n
    lifted = {"l": 0.0, "r": 0.0}
    for s in ("l", "r"):
        stance = [False] * n
        dist = [10 ** 6] * n
        for (a, b) in windows[s]:
            for u in range(a, b + 1):
                k = u % period if cyclic else u
                if 0 <= k < n:
                    stance[k] = True
        # distance (frames) to the nearest stance frame, cyclic
        for i in range(n):
            if stance[i]:
                dist[i] = 0
                continue
            best = 10 ** 6
            for j in range(n):
                if stance[j]:
                    dd = abs(i - j)
                    if cyclic:
                        dd = min(dd, period - dd)
                    best = min(best, dd)
            dist[i] = best
        need = [0.0] * n
        pitches = [0.0] * n
        for i, (rot, loc) in enumerate(frames):
            if stance[i] or dist[i] <= 1:
                continue
            pose = rig.fk(rot, loc)
            pts = soles.points(pose, s)
            low = min(p.z for p in pts.values())
            taper = smoothstep((dist[i] - 1) / float(ease))
            need[i] = max(0.0, (clearance - low)) * taper
            d = pts["tip"] - pts["heel"]
            pitches[i] = math.degrees(math.atan2(-d.z, Vector((d.x, d.y, 0)).length))
        # smooth the lift over neighbours
        arr = np.array(need)
        if arr.any():
            k = 2
            pad = np.concatenate([arr[-1 - k:-1], arr, arr[1:1 + k]]) if cyclic else np.pad(arr, k, mode="edge")
            arr = np.maximum(arr, np.array([pad[i:i + 2 * k + 1].mean() for i in range(n)]))
        for i, (rot, loc) in enumerate(frames):
            if stance[i] or dist[i] <= 1:
                continue
            excess = pitches[i] - max_pitch_deg
            if arr[i] <= 1e-5 and excess <= 0:
                continue
            pose = rig.fk(rot, loc)
            foot_rot = pose[f"foot_{s}"].to_3x3()
            if excess > 0:
                pts = soles.points(pose, s)
                d = pts["tip"] - pts["heel"]
                side_axis = Vector((d.y, -d.x, 0.0)).normalized()  # lateral axis of the foot
                ang = math.radians(excess) * smoothstep((dist[i] - 1) / float(ease))
                foot_rot = Matrix.Rotation(ang, 3, side_axis) @ foot_rot
                if (Matrix.Rotation(ang, 3, side_axis) @ d).z < d.z:  # wrong way: lifts the toe instead of lowering
                    foot_rot = Matrix.Rotation(-2 * ang, 3, side_axis) @ foot_rot
            goal = pose[f"foot_{s}"].translation + Vector((0.0, 0.0, float(arr[i])))
            knee = pose[f"calf_{s}"].translation
            mo.two_bone_ik(rig, pose, rot, loc, f"thigh_{s}", f"calf_{s}", f"foot_{s}", goal, knee + Vector((0, -0.4, 0)))
            mo.set_world_rotation(rig, pose, rot, loc, f"foot_{s}", foot_rot)
            lifted[s] = max(lifted[s], float(arr[i]))
    if cyclic:
        frames[-1] = ({b: q.copy() for b, q in frames[0][0].items()}, {b: v.copy() for b, v in frames[0][1].items()})
    return {s: round(v * 100, 2) for s, v in lifted.items()}


# ------------------------------------------------------------------ planted feet outside locomotion

def rest_heading(soles, side):
    return _heading(soles.world_rest(side, "tip") - soles.world_rest(side, "heel"))


def flat_ankle_z(rig, soles, side):
    """Ankle height that puts a flat (rest-pitched) foot's sole points GROUND above the plane."""
    return rig.rest[f"foot_{side}"].translation.z - (soles.ground[side] - GROUND)


def plant_flat(rig, soles, pose, rot, loc, side, ankle_xy, heading, pole=None):
    """Plant a foot flat on the ground: rest pitch and roll, the given heading, toes at rest, ankle at ankle_xy. The
    first plant levelled only the toe vector's height, which left a pitched foot pitched (the child's bellows feet were
    toes-down and up to 6 cm under the ground) and kept the captured toe bend and foot roll."""
    rest_foot = rig.rest[f"foot_{side}"].to_3x3()
    R = Matrix.Rotation(heading - rest_heading(soles, side), 3, "Z") @ rest_foot
    target = Vector((ankle_xy[0], ankle_xy[1], flat_ankle_z(rig, soles, side)))
    knee = pose[f"calf_{side}"].translation
    mo.two_bone_ik(rig, pose, rot, loc, f"thigh_{side}", f"calf_{side}", f"foot_{side}", target,
                   pole if pole is not None else knee + Vector((0.06 if side == "l" else -0.06, -0.4, 0)))
    mo.set_world_rotation(rig, pose, rot, loc, f"foot_{side}", R)
    rot[f"toes_{side}"] = Quaternion()
    rig.update_chain(pose, rot, loc, f"toes_{side}")
    return pose[f"foot_{side}"].translation.copy()


def stance_of(rig, soles, frame):
    """Ankle xy and heading of both feet in one frame (for idle-style stances)."""
    pose = rig.fk(*frame)
    out = {}
    for s in ("l", "r"):
        pts = soles.points(pose, s)
        out[s] = (pose[f"foot_{s}"].translation.copy(), _heading(pts["tip"] - pts["heel"]))
    return out


def copy_frame(frame):
    rot, loc = frame
    return ({b: q.copy() for b, q in rot.items()}, {b: v.copy() for b, v in loc.items()})


def align_left_forward(rig, frames):
    """Cyclic shift so the cycle starts where the left foot is furthest forward (about left heel strike)."""
    ys = []
    for rot, loc in frames[:-1]:
        pose = rig.fk(rot, loc)
        ys.append(pose["foot_l"].translation.y - pose["hips"].translation.y)
    k = int(np.argmin(ys))
    body = frames[:-1]
    out = [copy_frame(f) for f in body[k:] + body[:k]]
    out.append(copy_frame(out[0]))
    return out


def shift_hips(rig, frames, dz):
    for _rot, loc in frames:
        p = rig.rest["hips"] @ loc["hips"]
        p.z += dz
        loc["hips"] = rig.rest["hips"].inverted() @ p


def facing_offset(rig, frames):
    """Mean heading of the pelvis and the shoulder line over a clip, degrees from -Y (positive toward +X)."""
    hips_fwd = rig.rest["hips"].to_3x3().inverted() @ Vector((0, -1, 0))
    vals = []
    for rot, loc in frames[:-1] if len(frames) > 1 else frames:
        pose = rig.fk(rot, loc)
        f = pose["hips"].to_3x3() @ hips_fwd
        across = pose["upperarm_l"].translation - pose["upperarm_r"].translation
        vals.append(0.5 * (_yaw_of(Vector((f.x, f.y, 0))) + _yaw_of(Vector((across.y, -across.x, 0)))))
    return float(np.mean(vals))


def rotate_clip(rig, frames, degrees):
    """Turn every frame of an in-place clip about the vertical axis through the origin."""
    rz = Matrix.Rotation(math.radians(degrees), 4, "Z")
    rest = rig.rest["hips"]
    for rot, loc in frames:
        basis = Matrix.Translation(loc.get("hips", Vector())) @ rot.get("hips", Quaternion()).to_matrix().to_4x4()
        new = rest.inverted() @ rz @ rest @ basis
        loc["hips"] = new.to_translation()
        rot["hips"] = new.to_quaternion()


def set_foot_headings(rig, soles, frames, windows, targets, cyclic=True):
    """Turn each foot about the vertical so its mean stance heading equals targets[side] (radians from -Y). The
    captured feet toed in by up to 15 degrees after the travel was aligned; residents toe out a little instead."""
    n = len(frames)
    period = n - 1 if cyclic else n
    delta = {}
    for s in ("l", "r"):
        hs = []
        for (a, b) in windows[s]:
            for u in range(a, b + 1):
                pose = rig.fk(*frames[u % period if cyclic else u])
                pts = soles.points(pose, s)
                hs.append(_heading(pts["tip"] - pts["heel"]))
        if not hs:
            continue
        delta[s] = targets[s] - math.atan2(np.mean(np.sin(hs)), np.mean(np.cos(hs)))
    for rot, loc in frames:
        pose = rig.fk(rot, loc)
        for s, d in delta.items():
            mo.set_world_rotation(rig, pose, rot, loc, f"foot_{s}", Matrix.Rotation(d, 3, "Z") @ pose[f"foot_{s}"].to_3x3())
    return {s: round(math.degrees(d), 1) for s, d in delta.items()}


def lock_walk_cycle(rig, soles, frames, travel, report, toe_out_deg=7.0):
    """Ground a walk cycle in place: the body turned to face its travel, stance windows from the gait, the feet turned
    to a slight toe-out, pelvis height from the stance ankles, the foot roll planted on its pivots, the pelvis lowered
    where a leg could not reach, swing clearance and pitch cap."""
    n = len(frames)
    period = n - 1
    face = facing_offset(rig, frames)
    rotate_clip(rig, frames, -face)
    windows = cycle_windows(rig, frames, soles, travel)
    heads = {"l": math.radians(toe_out_deg), "r": -math.radians(toe_out_deg)}
    turned = set_foot_headings(rig, soles, frames, windows, heads)
    lows = []
    for s in ("l", "r"):
        for (a, b) in windows[s]:
            for u in range(a, b + 1):
                pose = rig.fk(*frames[u % period])
                pts = soles.points(pose, s)
                lows.append(min(p.z for p in pts.values()))
    shift_hips(rig, frames, GROUND - float(np.median(lows)))
    yaw = {(s, a): heads[s] for s in windows for (a, _b) in windows[s]}
    thetas = {}
    plan = roll_lock(rig, soles, frames, travel, windows, True, yaw_override=yaw, thetas_out=thetas)
    targets = {s: [p[1] if p is not None and p[0] > 0.99 else None for p in plan[s]] for s in ("l", "r")}
    drop = 0.0
    drops = leg_reach_drop(rig, frames, targets)
    if max(drops) > 1e-4:
        drop = lower_pelvis(rig, frames, drops, True)
        roll_lock(rig, soles, frames, travel, windows, True, yaw_override=yaw, theta_override=thetas)
    lifted = swing_clearance(rig, soles, frames, travel, windows, True)
    WALK_THETAS[id(frames)] = {s: thetas[(s, windows[s][0][0])] for s in ("l", "r")}
    frames[-1] = copy_frame(frames[0])
    share = {s: round(sum((b - a + 1) for a, b in windows[s]) / period, 3) for s in ("l", "r")}
    report.update({"stanceWindows": {s: [list(w) for w in windows[s]] for s in windows}, "stanceShare": share,
                   "pelvisDropCm": round(drop * 100, 2), "swingLiftCm": lifted, "facingCorrectionDegrees": round(-face, 1),
                   "footHeadingCorrectionDegrees": turned, "toeOutDegrees": toe_out_deg})
    return windows


# ------------------------------------------------------------------ transitions: stop and start

def _hermite_travel(distance, v0, seconds, n_move):
    """Forward travel easing from speed v0 to rest over `seconds` (cubic Hermite, monotonic for slopes up to 3)."""
    out = []
    m0 = v0 * seconds / max(1e-6, distance)
    for i in range(n_move):
        u = min(1.0, i / FPS / seconds)
        h = (u ** 3 - 2 * u ** 2 + u) * m0 + (-2 * u ** 3 + 3 * u ** 2)
        out.append(distance * h)
    return out


def heel_from_ankle(rig, soles, side, ankle_xy, heading):
    rz = Matrix.Rotation(heading - rest_heading(soles, side), 3, "Z")
    h = Vector((ankle_xy[0], ankle_xy[1], 0.0)) + rz @ (soles.world_rest(side, "heel") - rig.rest[f"foot_{side}"].translation)
    return Vector((h.x, h.y, GROUND))


def ankle_from_heel(rig, soles, side, heel, heading):
    rz = Matrix.Rotation(heading - rest_heading(soles, side), 3, "Z")
    a = heel - rz @ (soles.world_rest(side, "heel") - rig.rest[f"foot_{side}"].translation)
    return Vector((a.x, a.y, 0.0))


def blend_legs_to(rig, frames, target, count, at_end=True, travel=None):
    """Blend the feet (ankle position and foot rotation, solved by IK) toward a target frame over `count` frames at
    one end of a clip; blending the leg joint angles instead slides a planted foot. With `travel`, the target is
    carried with the ground (a foot planted at the end is planted at the same spot a few frames earlier)."""
    n = len(frames)
    tpose = rig.fk(*target)
    for j in range(count):
        i = n - count + j if at_end else count - 1 - j
        w = smoothstep((j + 1) / float(count))
        rot, loc = frames[i]
        pose = rig.fk(rot, loc)
        ref = (travel[-1] if at_end else travel[0]) if travel is not None else 0.0
        off = Vector((0.0, (travel[i] - ref) if travel is not None else 0.0, 0.0))
        for s in ("l", "r"):
            goal = pose[f"foot_{s}"].translation.lerp(tpose[f"foot_{s}"].translation + off, w)
            q0, q1 = pose[f"foot_{s}"].to_3x3().to_quaternion(), tpose[f"foot_{s}"].to_3x3().to_quaternion()
            if q0.dot(q1) < 0:
                q1.negate()
            knee = pose[f"calf_{s}"].translation.lerp(tpose[f"calf_{s}"].translation, w)
            mo.two_bone_ik(rig, pose, rot, loc, f"thigh_{s}", f"calf_{s}", f"foot_{s}", goal, knee + Vector((0, -0.4, 0)))
            mo.set_world_rotation(rig, pose, rot, loc, f"foot_{s}", q0.slerp(q1, w).to_matrix())
            tq = target[0].get(f"toes_{s}", Quaternion())
            cq = rot.get(f"toes_{s}", Quaternion())
            if cq.dot(tq) < 0:
                tq = -tq
            rot[f"toes_{s}"] = cq.slerp(tq, w)
            rig.update_chain(pose, rot, loc, f"toes_{s}")


def synth_stop(rig, soles, walk, walk_travel, windows, idle0, stance, speed, swing_seconds=0.5, settle=0.35, report=None):
    """walk_stop with real steps: the walk continues from frame 0 (late left swing) until the left heel strikes and that
    foot stays planted; the right foot finishes its push-off and makes one closing step onto the idle stance; the root
    decelerates from walking speed to rest so the left foot ends exactly on its idle stance, and the body settles into
    the idle's first pose. The first stop blended the walk into the idle while the root decelerated, so the feet slid
    5 to 10 cm into the idle and the last step's toe dragged through the ground."""
    period = len(walk) - 1
    stride = walk_travel[-1]
    (a_l, _b_l), = windows["l"]
    (a_r, b_r), = windows["r"]
    # the right foot's stance that covers walk frame 0 (cyclic) and its toe-off frame in this clip
    if a_r <= period <= b_r:
        r_start, to_r = a_r - period, b_r - period
    elif a_r <= 0 <= b_r:
        r_start, to_r = a_r, b_r
    else:
        raise RuntimeError("walk_stop: the right foot is not planted at walk frame 0")
    a_l = a_l % period
    pose_al = rig.fk(*walk[a_l])
    heel_l_clip = soles.points(pose_al, "l")["heel"]
    w_l_heel = Vector((heel_l_clip.x, heel_l_clip.y - walk_travel[a_l], GROUND))  # world landing spot of the left heel
    pose_ar = rig.fk(*walk[a_r % period])
    heel_r_clip = soles.points(pose_ar, "r")["heel"]
    # world spot of the right heel planted at walk frame 0 (its window began r_start frames before)
    trav_walk = lambda u: walk_travel[u % period] + (u // period) * stride
    # (a window that began in the previous cycle: the walk's travel has grown by one stride at the junction)
    w_r_heel = Vector((heel_r_clip.x, heel_r_clip.y - trav_walk(a_r % period) + (stride if r_start < 0 else 0.0), GROUND))
    h_l, h_r = stance["l"][1], stance["r"][1]
    l_ankle_world = ankle_from_heel(rig, soles, "l", w_l_heel, h_l)
    distance = stance["l"][0].y - l_ankle_world.y  # travel that brings the planted left foot onto its idle stance
    x_shift = stance["l"][0].x - l_ankle_world.x
    move = max(0.5, min(1.4, 2.0 * distance / max(1e-3, speed)))
    land = to_r + int(round(swing_seconds * FPS))
    n = max(land + int(round(settle * FPS)), int(round(move * FPS)) + 9) + 1
    travel = _hermite_travel(distance, speed, move, n)
    # base frames: the walk keeps playing while the body eases into the idle's first pose
    ir, il = idle0
    blend0, blend1 = 0.12, (n - 1) / FPS - 0.25
    frames = []
    for i in range(n):
        w = smoothstep((i / FPS - blend0) / max(1e-3, blend1 - blend0))
        wr, wl = walk[i % period]
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
    # right swing: a closing step from its toe-off pose to the idle stance, lifted on an arc
    r_land_heel_world = heel_from_ankle(rig, soles, "r", stance["r"][0] - Vector((0.0, distance, 0.0)), h_r)
    r_land_heel_world.x -= x_shift
    anchors = {("l", a_l): w_l_heel + Vector((x_shift * 0.0, travel[a_l], 0.0)),
               ("r", r_start): w_r_heel + Vector((0.0, travel[0], 0.0)),
               ("r", land): r_land_heel_world + Vector((0.0, travel[land], 0.0))}
    win = {"l": [(a_l, n - 1)], "r": [(r_start, to_r), (land, n - 1)]}
    yaw = {("l", a_l): h_l, ("r", r_start): h_r, ("r", land): h_r}
    wt = WALK_THETAS.get(id(walk), {})
    th = {}
    if "l" in wt:
        th[("l", a_l)] = (wt["l"][0], wt["l"][1])
    if "r" in wt:
        th[("r", r_start)] = wt["r"]
        th[("r", land)] = (max(-0.2, wt["r"][0] * 0.5), wt["r"][1])  # the closing step lands gently
    plan = roll_lock(rig, soles, frames, travel, win, False, anchors=anchors, yaw_override=yaw, theta_override=th)
    # the swing itself between toe-off and landing (roll_lock eased only the ends)
    p_to = plan["r"][to_r] if 0 <= to_r < n and plan["r"][to_r] else None
    p_land = plan["r"][land]
    if p_to is not None and p_land is not None:
        a0, r0 = p_to[1], p_to[2]
        a1, r1 = p_land[1], p_land[2]
        lift = 0.08
        for i in range(to_r + 1, land):
            u = (i - to_r) / float(land - to_r)
            # in the world the foot travels from its toe-off spot to its landing spot; in the clip the ground moves
            w0 = a0 - Vector((0.0, travel[to_r], 0.0))
            w1 = a1 - Vector((0.0, travel[land], 0.0))
            p = w0.lerp(w1, smoothstep(u)) + Vector((0.0, travel[i], 0.0)) + Vector((0.0, 0.0, lift * math.sin(math.pi * u) ** 1.2))
            q0, q1 = r0.to_quaternion(), r1.to_quaternion()
            if q0.dot(q1) < 0:
                q1.negate()
            rot, loc = frames[i]
            pose = rig.fk(rot, loc)
            knee = pose["calf_r"].translation
            mo.two_bone_ik(rig, pose, rot, loc, "thigh_r", "calf_r", "foot_r", p, knee + Vector((0, -0.4, 0)))
            mo.set_world_rotation(rig, pose, rot, loc, "foot_r", q0.slerp(q1, smoothstep(u)).to_matrix())
    # the last frames land exactly on the idle's first pose (both feet are already on the idle stance)
    k = 8
    for j in range(k):
        i = n - k + j
        w = smoothstep((j + 1) / k)
        rot, loc = frames[i]
        for b in list(rot):
            if b in LEG_BONES:
                continue
            if b in ir:
                q = ir[b] if rot[b].dot(ir[b]) >= 0 else -ir[b]
                rot[b] = rot[b].slerp(q, w)
        for b in list(loc):
            if b in il:
                loc[b] = loc[b].lerp(il[b], w)
    blend_legs_to(rig, frames, idle0, 6, at_end=True, travel=travel)
    frames[-1] = copy_frame(idle0)
    if report is not None:
        report.update({"stopDistanceMetres": round(distance, 3), "decelerationSeconds": round(move, 2),
                       "closingStepFrames": [to_r, land], "leftLandsFrame": a_l, "lateralMismatchCm": round(x_shift * 100, 2)})
    planted = {"l": [i >= a_l for i in range(n)], "r": [i <= to_r or i >= land for i in range(n)]}
    return frames, travel, planted


def synth_start(rig, soles, walk, walk_travel, windows, idle0, stance, speed, report=None):
    """walk_start with real steps, ending exactly on walk frame 0 (late left swing): the second half of the walk cycle
    fades in over the idle while the root accelerates from rest to walking speed; the right foot stays planted on its
    idle stance (flat, then the heel rising as at walk frame 0), the left foot rolls off its idle stance and swings to
    walk frame 0's position, and the pelvis first shifts toward the stance foot. The captured start takes rotated the
    whole take about the capture origin while easing the heading, so the planted heels slid at up to 45 cm/s."""
    period = len(walk) - 1
    stride = walk_travel[-1]
    (a_l, b_l), = windows["l"]
    (a_r, b_r), = windows["r"]
    if not (a_r <= period <= b_r):
        raise RuntimeError("walk_start: the right foot is not planted at walk frame 0")
    trav_walk = lambda u: walk_travel[u % period] + (u // period) * stride
    pose_ar = rig.fk(*walk[a_r % period])
    heel_r = soles.points(pose_ar, "r")["heel"]
    r0_anchor = Vector((heel_r.x, heel_r.y + (trav_walk(period) - trav_walk(a_r)), GROUND))  # clip, at walk frame 0
    h_l, h_r = stance["l"][1], stance["r"][1]
    r_idle_heel = heel_from_ankle(rig, soles, "r", stance["r"][0], h_r)
    distance = r0_anchor.y - r_idle_heel.y
    x_mismatch = r0_anchor.x - r_idle_heel.x
    move = max(0.55, min(1.3, 2.2 * distance / max(1e-3, speed)))
    n = int(round(move * FPS)) + 1
    m1 = speed * move / max(1e-6, distance)
    travel = []
    for i in range(n):
        u = i / (n - 1)
        travel.append(distance * ((-2 * u ** 3 + 3 * u ** 2) + (u ** 3 - u ** 2) * m1))
    ir, il = idle0
    frames = []
    for i in range(n):
        w = smoothstep(i / (n - 1) * 1.15)
        wr, wl = walk[period - (n - 1) + i] if period - (n - 1) + i >= 0 else walk[(period - (n - 1) + i) % period]
        rot = {b: (ir[b] if b in ir else q).copy() for b, q in wr.items()}
        loc = {b: (il[b] if b in il else v).copy() for b, v in wl.items()}
        for b in rot:
            q = wr[b] if rot[b].dot(wr[b]) >= 0 else -wr[b]
            rot[b] = rot[b].slerp(q, w)
        for b in loc:
            loc[b] = loc[b].lerp(wl[b], w)
        # gait initiation: the pelvis first moves over the stance (right) foot, then follows the step
        shift = -0.03 * math.sin(math.pi * min(1.0, i / (0.55 * (n - 1))))
        p = rig.rest["hips"] @ loc["hips"]
        p.x += shift
        loc["hips"] = rig.rest["hips"].inverted() @ p
        frames.append((rot, loc))
    # right foot: planted on its idle stance through the clip, phase matched to walk frame 0 at the end
    span_r = b_r - a_r
    phase_end = (period - a_r) / span_r
    a_s = -max(4, int(round(0.14 * span_r)))
    b_s = a_s + int(round((n - 1 - a_s) / max(0.3, phase_end)))
    # left foot: planted on its idle stance, rolls off and lifts after about a third of the clip
    lift = max(3, int(round(0.32 * (n - 1))))
    l_idle_heel = heel_from_ankle(rig, soles, "l", stance["l"][0], h_l)
    win = {"l": [(-lift, lift)], "r": [(a_s, b_s)]}  # the left heel starts to rise at once (phase 0.5)
    anchors = {("l", win["l"][0][0]): l_idle_heel, ("r", a_s): r_idle_heel}
    yaw = {("l", win["l"][0][0]): h_l, ("r", a_s): h_r}
    wt = WALK_THETAS.get(id(walk), {})
    th = {("r", a_s): wt["r"]} if "r" in wt else {}
    if "l" in wt:
        th[("l", win["l"][0][0])] = wt["l"]
    plan = roll_lock(rig, soles, frames, travel, win, False, anchors=anchors, yaw_override=yaw, theta_override=th)
    # the left swing from its toe-off pose to walk frame 0's left foot
    end_pose = rig.fk(*walk[0])
    a1 = end_pose["foot_l"].translation.copy()
    r1 = end_pose["foot_l"].to_3x3()
    p_to = plan["l"][lift]
    a0, r0 = p_to[1], p_to[2]
    w0 = a0 - Vector((0.0, travel[lift], 0.0))
    w1 = a1 - Vector((0.0, travel[n - 1], 0.0))
    for i in range(lift + 1, n):
        u = (i - lift) / float(n - 1 - lift)
        p = w0.lerp(w1, smoothstep(u) * 0.7 + u * 0.3) + Vector((0.0, travel[i], 0.0))
        p.z += 0.05 * math.sin(math.pi * min(1.0, u * 1.1)) * (1.0 - u) + (a1.z - w1.z) * smoothstep(u) * 0.0
        q0, q1 = r0.to_quaternion(), r1.to_quaternion()
        if q0.dot(q1) < 0:
            q1.negate()
        rot, loc = frames[i]
        pose = rig.fk(rot, loc)
        knee = pose["calf_l"].translation
        mo.two_bone_ik(rig, pose, rot, loc, "thigh_l", "calf_l", "foot_l", p, knee + Vector((0, -0.4, 0)))
        mo.set_world_rotation(rig, pose, rot, loc, "foot_l", q0.slerp(q1, smoothstep(u)).to_matrix())
    # exact ends: idle0 at the start, walk frame 0 at the end (small blends of the upper body; the legs already reach
    # the same planted feet from the same pelvis, and blending their joint angles would slide the feet)
    for j in range(4):
        w = smoothstep(1.0 - (j + 1) / 5.0)
        rot, loc = frames[j]
        for b in list(rot):
            if b in LEG_BONES:
                continue
            if b in ir:
                q = ir[b] if rot[b].dot(ir[b]) >= 0 else -ir[b]
                rot[b] = rot[b].slerp(q, w)
        for b in list(loc):
            if b in il:
                loc[b] = loc[b].lerp(il[b], w)
    wr0, wl0 = walk[0]
    for j in range(5):
        i = n - 5 + j
        w = smoothstep((j + 1) / 5.0)
        rot, loc = frames[i]
        for b in list(rot):
            if b in LEG_BONES:
                continue
            if b in wr0:
                q = wr0[b] if rot[b].dot(wr0[b]) >= 0 else -wr0[b]
                rot[b] = rot[b].slerp(q, w)
        for b in list(loc):
            if b in wl0:
                loc[b] = loc[b].lerp(wl0[b], w)
    blend_legs_to(rig, frames, idle0, 3, at_end=False, travel=travel)
    blend_legs_to(rig, frames, walk[0], 6, at_end=True, travel=travel)
    frames[0] = copy_frame(idle0)
    frames[-1] = copy_frame(walk[0])
    if report is not None:
        report.update({"startDistanceMetres": round(distance, 3), "accelerationSeconds": round((n - 1) / FPS, 2),
                       "firstStepLiftFrame": lift, "lateralMismatchCm": round(x_mismatch * 100, 2), "endsOnWalkFrame": 0})
    planted = {"l": [i <= lift for i in range(n)], "r": [True] * n}
    return frames, travel, planted

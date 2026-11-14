"""Work entry and exit transitions (original Crownfall code, motion stage, round 2).

Round 1 had no way into or out of a work loop: idle to work cut 88 to 163 degrees at the forearm or hand, the hammer,
tongs, spindle, knife and spoon appeared in the hands at the clip switch, the elder's stick jumped from her hand to the
ground beside the stool, and the workstations (anvil and stump, bellows and hearth, stool) were listed only under the
work clips, so they appeared and vanished with them. Here every resident gets two one-shot clips:

* `work_enter` from the idle (the elder: from the seated rest) into the work loop's first frame, and `work_exit` from the
  work loop's first frame back to the idle (the seated rest); each begins and ends exactly on the poses it joins;
* the hands pick each hand prop up from a resting copy on the workstation (`prop_<name>_rest`, in the resident root
  frame, like the elder's resting stick) and put it back: at the swap frame the hand prop's world transform equals the
  resting copy's, so the caller hides one and shows the other at the time listed in the manifest (`propSwaps`) and
  nothing jumps;
* the feet step between the idle stance and the work stance (lifted, then planted flat), the body leans and dips to
  reach, the head looks at what the hands do; finger curls open before a grasp and close on it.

The workstation itself is persistent: Codex places the props file's `workplace` node once at the work place's anchor
(the resident root transform for the work clips) and leaves it there.
"""
import math

import bpy
from mathutils import Matrix, Quaternion, Vector

import locomotion as lc
import motion as mo

FPS = 30
ARMS = {s: (f"clavicle_{s}", f"upperarm_{s}", f"forearm_{s}", f"hand_{s}") for s in ("l", "r")}
FINGERS = ("index", "middle", "ring", "pinky", "thumb")
SPINE = ("spine_01", "spine_02", "spine_03", "neck", "head")


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def copy_frame(frame):
    rot, loc = frame
    return ({b: q.copy() for b, q in rot.items()}, {b: v.copy() for b, v in loc.items()})


def blend(a, b, w):
    ra, la = a
    rb, lb = b
    rot = {}
    for k in set(ra) | set(rb):
        qa, qb = ra.get(k, Quaternion()), rb.get(k, Quaternion())
        rot[k] = qa.slerp(qb if qa.dot(qb) >= 0 else -qb, w)
    loc = {}
    for k in set(la) | set(lb):
        loc[k] = la.get(k, Vector()).lerp(lb.get(k, Vector()), w)
    return rot, loc


def keyed(t, keys):
    """Smoothstep interpolation of (time, value) keys; values may be floats or Vectors."""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1:
            u = smooth((t - t0) / max(1e-6, t1 - t0))
            return v0 + (v1 - v0) * u if not isinstance(v0, Vector) else v0.lerp(v1, u)
    return keys[-1][1]


def keyed_matrix(t, keys):
    """(time, 4x4) keys: position and rotation eased between neighbouring keys."""
    if t <= keys[0][0]:
        return keys[0][1].copy()
    for (t0, m0), (t1, m1) in zip(keys, keys[1:]):
        if t <= t1:
            u = smooth((t - t0) / max(1e-6, t1 - t0))
            p = m0.translation.lerp(m1.translation, u)
            q0, q1 = m0.to_quaternion(), m1.to_quaternion()
            q = q0.slerp(q1 if q0.dot(q1) >= 0 else -q1, u)
            return Matrix.Translation(p) @ q.to_matrix().to_4x4()
    return keys[-1][1].copy()


def lifted(m, dz):
    return Matrix.Translation(Vector((0.0, 0.0, dz))) @ m


def hand_world(rig, frame, side):
    return rig.fk(*frame)[f"hand_{side}"].copy()


def moved(m, d):
    return Matrix.Translation(Vector(d)) @ m


def grasp_keys(t_grasp, hand, approach=0.07, before=0.16, hold=0.1, after=0.14, leave=0.05, approach_vec=None, leave_vec=None):
    """Keys that bring a hand down onto a grasp pose and lift it away: above, on, held, lifted (approach_vec and
    leave_vec, world offsets, replace the straight lift, e.g. to come in from the front under a cape's hem)."""
    a = moved(hand, approach_vec) if approach_vec is not None else lifted(hand, approach)
    b = moved(hand, leave_vec) if leave_vec is not None else lifted(hand, leave)
    return [(t_grasp - before, a), (t_grasp, hand.copy()), (t_grasp + hold, hand.copy()), (t_grasp + hold + after, b)]


def _plant(rig, soles, pose, rot, loc, side, xy, heading, lift):
    rest_foot = rig.rest[f"foot_{side}"].to_3x3()
    R = Matrix.Rotation(heading - lc.rest_heading(soles, side), 3, "Z") @ rest_foot
    target = Vector((xy[0], xy[1], lc.flat_ankle_z(rig, soles, side) + lift))
    hip = pose[f"thigh_{side}"].translation
    mid = (hip + Vector((xy[0], xy[1], 0.0))) * 0.5
    pole = mid + Vector((math.sin(heading) * 0.5 + (0.04 if side == "l" else -0.04), -math.cos(heading) * 0.5, 0.0))
    mo.two_bone_ik(rig, pose, rot, loc, f"thigh_{side}", f"calf_{side}", f"foot_{side}", target, pole)
    mo.set_world_rotation(rig, pose, rot, loc, f"foot_{side}", R)
    rot[f"toes_{side}"] = Quaternion()
    rig.update_chain(pose, rot, loc, f"toes_{side}")


def feet_of(rig, soles, frame):
    st = lc.stance_of(rig, soles, frame)
    return {s: (Vector((st[s][0].x, st[s][0].y)), st[s][1]) for s in st}


def _foot_at(t, w, a, b, plan):
    """Foot track: plan None moves the foot with the pose blend (when its stance changes); (t0, t1, lift) steps it from
    its start to its end stance; a list of (t0, t1, lift, (x, y) or None, heading or None) steps through intermediate
    placements (None = the end stance)."""
    (xa, ha), (xb, hb) = a, b
    if plan is None:
        if (xa - xb).length > 0.005 or abs(ha - hb) > 0.01:
            return xa.lerp(xb, w), ha + (hb - ha) * w, 0.0
        return xa, ha, 0.0
    segs = [(plan[0], plan[1], plan[2], None, None)] if isinstance(plan, tuple) else plan
    x, h = xa, ha
    for (t0, t1, lift, to, hd) in segs:
        tx = Vector(to) if to is not None else xb
        th = hd if hd is not None else hb
        if t <= t0:
            return x, h, 0.0
        if t < t1:
            u = (t - t0) / max(1e-6, t1 - t0)
            sm = smooth(u)
            return x.lerp(tx, sm), h + (th - h) * sm, lift * math.sin(math.pi * u)
        x, h = tx, th
    return x, h, 0.0


def transition_clip(rig, soles, start, end, seconds, steps=None, hand_keys=None, poles=None, finger_keys=None,
                    flex=None, twist=None, dip=None, look=None, seated=False, ik_edge=0.18, spine_keys=None):
    """One-shot clip from `start` to `end` (frames). steps: {side: (t0, t1, lift)} moves that foot from its start to its
    end stance (planted otherwise); hand_keys: {side: [(t, world hand 4x4)]} (the first and last keys are added from the
    end frames); finger_keys: {side: [(t, {bone: Quaternion})]}; flex/twist/dip: keyed extra spine flex and twist
    (degrees) and pelvis drop (metres); look: keyed world target for the head. The hands follow their keys by IK,
    blended into the plain pose blend over the first and last `ik_edge` of the clip so the ends meet exactly.
    spine_keys: keyed blend weight (0 = start, 1 = end) for the spine, neck and head instead of the clip's own, so a
    seated resident can stay upright while the hands reach and lean in afterwards (or sit up first)."""
    import motion_household as MH
    n = int(round(seconds * FPS)) + 1
    feet_a, feet_b = feet_of(rig, soles, start), feet_of(rig, soles, end)
    hand_keys = {s: [(0.0, hand_world(rig, start, s))] + list(k) + [(seconds, hand_world(rig, end, s))]
                 for s, k in (hand_keys or {}).items()}
    out = []
    for i in range(n):
        t = i / FPS
        u = t / seconds
        w = smooth(u)
        rot, loc = blend(start, end, w)
        if spine_keys:
            ws = keyed(t, spine_keys)
            for b in SPINE:
                qa, qb = start[0].get(b, Quaternion()), end[0].get(b, Quaternion())
                rot[b] = qa.slerp(qb if qa.dot(qb) >= 0 else -qb, ws)
        if dip:
            p = rig.rest["hips"] @ loc["hips"]
            p.z -= keyed(t, dip)
            loc["hips"] = rig.rest["hips"].inverted() @ p
        pose = rig.fk(rot, loc)
        if flex or twist:
            MH.spine_flex(rig, pose, rot, loc, keyed(t, flex) if flex else 0.0, twist_deg=keyed(t, twist) if twist else 0.0)
        if not seated:
            for side in ("l", "r"):
                xy, hd, up = _foot_at(t, w, feet_a[side], feet_b[side], (steps or {}).get(side))
                _plant(rig, soles, pose, rot, loc, side, xy, hd, up)
        else:
            MH.plant_feet(rig, pose, rot, loc, {s: Vector((feet_a[s][0].x, feet_a[s][0].y, 0.0)) for s in ("l", "r")})
        wik = smooth(u / ik_edge) * smooth((1.0 - u) / ik_edge)
        for side, keys in hand_keys.items():
            fk = {b: rot[b].copy() for b in ARMS[side] if b in rot}
            H = keyed_matrix(t, keys)
            sh = pose[f"upperarm_{side}"].translation
            pole = (poles or {}).get(side) or (sh + Vector((0.35 if side == "l" else -0.35, 0.15, -0.3)))
            MH.set_hand(rig, pose, rot, loc, side, H, pole)
            if wik < 0.999:
                for b, q in fk.items():
                    qi = rot[b]
                    rot[b] = q.slerp(qi if q.dot(qi) >= 0 else -qi, wik)
                rig.update_chain(pose, rot, loc, ARMS[side][0])
        for side, keys in (finger_keys or {}).items():
            # (t, curl dict) keys, eased; the first key is the start frame's fingers, the last the end frame's
            ks = [(0.0, {b: start[0].get(b, Quaternion()) for b in keys[0][1]})] + list(keys) + \
                 [(seconds, {b: end[0].get(b, Quaternion()) for b in keys[0][1]})]
            for (t0, c0), (t1, c1) in zip(ks, ks[1:]):
                if t0 <= t <= t1:
                    uu = smooth((t - t0) / max(1e-6, t1 - t0))
                    for b in c0:
                        q0, q1 = c0[b], c1.get(b, c0[b])
                        rot[b] = q0.slerp(q1 if q0.dot(q1) >= 0 else -q1, uu)
                    break
        if look:
            MH.look_at(rig, pose, rot, loc, keyed(t, look), 0.75)
        out.append((rot, loc))
    out[0] = copy_frame(start)
    out[-1] = copy_frame(end)
    return out


def rest_copy(src, name, world):
    """A resting copy of a hand prop (its own mesh data, so the atlas bake treats it as a separate object), placed in
    the resident root frame at `world` and exported at the props root ('aside', like the elder's resting stick)."""
    old = bpy.data.objects.get(name)
    if old is not None:
        bpy.data.objects.remove(old, do_unlink=True)
    obj = src.copy()
    obj.data = src.data.copy()
    obj.name = obj.data.name = name
    obj.animation_data_clear()
    for key in ("grip_matrix", "grip_bone", "grip_like", "mechanism"):
        if key in obj:
            del obj[key]
    obj["crownfall_part"] = "prop"
    obj["placement"] = "aside"
    obj["rest_of"] = src.name
    obj.parent = None
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = world.copy()
    return obj


def check_swaps(rig, frames, swaps, grips, rests):
    """Distance (cm) and angle (degrees) between each hand prop and its resting copy at the swap frame."""
    out = []
    for sw in swaps:
        k = int(round(sw["seconds"] * FPS))
        side = sw["hand"][-1]
        H = rig.fk(*frames[k])[f"hand_{side}"] @ grips[sw["node"]]
        R = rests[sw["node"]]
        d = (H.translation - R.translation).length
        a = math.degrees(H.to_quaternion().rotation_difference(R.to_quaternion()).angle)
        out.append({**sw, "offsetCm": round(d * 100, 2), "angleDeg": round(min(a, 360 - a), 2)})
    return out


# ------------------------------------------------------------------ per resident

def _mesh_points(obj, step=1):
    return [v.co.copy() for v in obj.data.vertices[::step]]


def _frame_from_axes(x, y, z, origin):
    return Matrix.Translation(origin) @ Matrix((x, y, z)).transposed().to_4x4()


def smith(rig, soles, idle0, work0, grips, info, props, recipe, enter_s=1.6, exit_s=1.5):
    """The smith takes the tongs (left) and the hammer (right) from the anvil and steps into his striking stance; the
    exit puts them back and steps out. Rest: the hammer lies on its side on the anvil face beside the stock with the
    handle toward him; the tongs lie on the face with their jaws on the stock, handles level (the stock, gripped,
    lies on the face with them)."""
    hammer, tongs, wp = props["prop_hammer"], props["prop_tongs"], props.get("prop_workpiece")
    g_h, g_t = grips["prop_hammer"], grips["prop_tongs"]
    pose0 = rig.fk(*work0)
    T0 = pose0["hand_l"] @ g_t
    jaws, strike = Vector(info["jaws"]), Vector(info["strike"])
    face_h = recipe["props"]["anvilFaceHeight"]
    tdir = (T0.to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()
    level = Vector((tdir.x, tdir.y, 0.0)).normalized()
    q = tdir.rotation_difference(level)
    rest_t = Matrix.Translation(jaws) @ q.to_matrix().to_4x4() @ Matrix.Translation(-jaws) @ T0
    # the hammer on its side: head on the face 9 cm to his right of the strike point, handle toward him and to his right
    co = _mesh_points(hammer)
    hl = max(c.y for c in co)
    head = [c for c in co if c.y > hl - 0.06]
    hw = max(abs(c.x) for c in head)
    head_c = sum(head, Vector()) / len(head)
    yax = Vector((0.32, -0.95, 0.0)).normalized()   # butt -> head: from his right hand toward the anvil
    xax = Vector((0.0, 0.0, 1.0))
    zax = xax.cross(yax).normalized()
    rot = Matrix((xax, yax, zax)).transposed()
    target = strike + Vector((-0.09, 0.03, 0.0))
    target.z = face_h + hw + 0.002
    rest_h = Matrix.Translation(target - rot @ head_c) @ rot.to_4x4()
    rests = {"prop_tongs": rest_copy(tongs, "prop_tongs_rest", rest_t), "prop_hammer": rest_copy(hammer, "prop_hammer_rest", rest_h)}
    if wp is not None:
        wp_world = T0 @ wp.matrix_basis
        rests["prop_workpiece"] = rest_copy(wp, "prop_workpiece_rest", rest_t @ T0.inverted() @ wp_world)
        rests["prop_workpiece"]["rest_follows"] = "prop_tongs_rest"
    Hh, Ht = rest_h @ g_h.inverted(), rest_t @ g_t.inverted()
    look = [(0.0, strike + Vector((0.0, 0.0, 0.3))), (0.4, strike), (enter_s, strike)]
    t_t, t_h = 0.62, 0.78
    enter = transition_clip(rig, soles, idle0, work0, enter_s, steps={"r": (0.08, 0.5, 0.045), "l": (0.42, 0.78, 0.035)},
                            hand_keys={"l": grasp_keys(t_t, Ht), "r": grasp_keys(t_h, Hh)},
                            finger_keys=_grasp_fingers(rig, idle0, work0, {"l": t_t, "r": t_h}),
                            flex=[(0.0, 0.0), (0.55, 13.0), (0.85, 13.0), (enter_s, 0.0)],
                            dip=[(0.0, 0.0), (0.6, 0.03), (0.9, 0.03), (enter_s, 0.0)], look=look)
    x_h, x_t = 0.45, 0.6
    exit_ = transition_clip(rig, soles, work0, idle0, exit_s, steps={"l": (0.75, 1.05, 0.035), "r": (0.85, 1.3, 0.045)},
                            hand_keys={"r": _release_keys(x_h, Hh), "l": _release_keys(x_t, Ht)},
                            finger_keys=_release_fingers(rig, work0, idle0, {"r": x_h, "l": x_t}),
                            flex=[(0.0, 0.0), (0.35, 12.0), (0.7, 12.0), (exit_s, 0.0)],
                            dip=[(0.0, 0.0), (0.4, 0.03), (0.75, 0.03), (exit_s, 0.0)],
                            look=[(0.0, strike), (0.9, strike), (exit_s, strike + Vector((0.0, -0.8, 0.6)))])
    swaps = {"work_enter": [{"seconds": t_t, "node": "prop_tongs", "rest": "prop_tongs_rest", "hand": "hand_l", "to": "hand"},
                            {"seconds": t_h, "node": "prop_hammer", "rest": "prop_hammer_rest", "hand": "hand_r", "to": "hand"}],
             "work_exit": [{"seconds": x_h, "node": "prop_hammer", "rest": "prop_hammer_rest", "hand": "hand_r", "to": "rest"},
                           {"seconds": x_t, "node": "prop_tongs", "rest": "prop_tongs_rest", "hand": "hand_l", "to": "rest"}]}
    return {"work_enter": enter, "work_exit": exit_}, swaps, rests, {"prop_tongs": rest_t, "prop_hammer": rest_h}


def child(rig, soles, idle0, work0, enter_s=1.1, exit_s=1.0):
    """The child steps up to the bellows lever and takes the crossbar from above (no props change hands)."""
    pose0 = rig.fk(*work0)
    keys_in, keys_out = {}, {}
    for side in ("l", "r"):
        H = pose0[f"hand_{side}"]
        keys_in[side] = [(enter_s - 0.42, lifted(H, 0.09)), (enter_s - 0.16, lifted(H, 0.015))]
        keys_out[side] = [(0.16, lifted(H, 0.015)), (0.42, lifted(H, 0.09))]
    enter = transition_clip(rig, soles, idle0, work0, enter_s, steps={"r": (0.05, 0.45, 0.04), "l": (0.3, 0.65, 0.035)},
                            hand_keys=keys_in, flex=[(0.0, 0.0), (enter_s, 0.0)])
    exit_ = transition_clip(rig, soles, work0, idle0, exit_s, steps={"l": (0.35, 0.65, 0.035), "r": (0.5, 0.9, 0.04)},
                            hand_keys=keys_out)
    return {"work_enter": enter, "work_exit": exit_}, {"work_enter": [], "work_exit": []}, {}, {}


def _grasp_fingers(rig, start, end, times):
    """Fingers: as in the start frame, opening a little before each grasp, then the end frame's grip from the grasp on."""
    out = {}
    for side, tg in times.items():
        bones = [f"{f}_{k:02d}_{side}" for f in FINGERS for k in (1, 2, 3)]
        open_ = {b: start[0].get(b, Quaternion()).slerp(Quaternion(), 0.6) for b in bones}
        grip = {b: end[0].get(b, Quaternion()) for b in bones}
        out[side] = [(max(0.05, tg - 0.2), open_), (tg, grip)]
    return out


def _release_fingers(rig, start, end, times):
    out = {}
    for side, tr in times.items():
        bones = [f"{f}_{k:02d}_{side}" for f in FINGERS for k in (1, 2, 3)]
        grip = {b: start[0].get(b, Quaternion()) for b in bones}
        open_ = {b: grip[b].slerp(Quaternion(), 0.6) for b in bones}
        out[side] = [(tr, grip), (tr + 0.16, open_)]
    return out


def _release_keys(t_release, hand, approach=0.07, before=0.14, hold=0.1, after=0.16, leave=0.06, approach_vec=None, leave_vec=None):
    """Keys that set a held prop down on its rest pose and lift the hand away."""
    a = moved(hand, approach_vec) if approach_vec is not None else lifted(hand, approach)
    b = moved(hand, leave_vec) if leave_vec is not None else lifted(hand, leave)
    return [(t_release - before, a), (t_release - 0.02, hand.copy()), (t_release + hold, hand.copy()), (t_release + hold + after, b)]


def _stick_frame(tip, top_dir, length):
    """Stick prop frame (grip at the origin, shaft down -Z to the tip) for a stick standing on `tip` along top_dir."""
    z = top_dir.normalized()
    x = Vector((0.0, 1.0, 0.0)).cross(z).normalized()
    y = z.cross(x).normalized()
    return _frame_from_axes(x, y, z, tip + z * length)


def _belt_rest(rig, x, z_above_hips, prop_up, down_into, front_gap=0.012):
    """A tool tucked upright in the girdle at the front of the hips (hips-joint frame): rest pose world and hips-local."""
    import idle_talk as it
    hz = rig.rest["hips"].translation.z
    p = it._front_point(x, hz + z_above_hips)
    p.y += 0.03 - front_gap
    yax = Vector(prop_up).normalized()
    xax = Vector((1.0, 0.0, 0.0))
    zax = xax.cross(yax).normalized()
    world = _frame_from_axes(xax, yax, zax, p - yax * down_into)
    return world, rig.rest["hips"].inverted() @ world


def elder(rig, soles, sit0, carve0, grips, props, stick_len, enter_s=2.4, exit_s=2.4):
    """Seated: the elder leans her stick against her left knee, then takes the knife (right) and the spoon blank (left)
    from her girdle and settles into carving; the exit tucks them back, takes the stick and plants it. The knife and
    spoon ride in the girdle (hips joint) in every other clip, so they never appear from nowhere."""
    g_s, g_k, g_p = grips["prop_stick"], grips["prop_knife"], grips["prop_spoon"]
    pose_s = rig.fk(*sit0)
    S0 = pose_s["hand_l"] @ g_s
    tip0 = S0 @ Vector((0.0, 0.0, -stick_len))
    knee = pose_s["calf_l"].translation
    # the stick leans against the outside of her left knee (23 degrees, tip 24 cm out to the side), so its top sits
    # low and in front of her lap: a stick leaning back over the thigh put the fist under the shoulder cape's hem, and
    # an upright one held the arm out level with the cape's edge (candidates measured against the posed cloth: no
    # shaft inside the skirt, fist in front of the cape, shaft about 10 cm from the carving hands and tools)
    tip_r = Vector((knee.x + 0.24, knee.y + 0.02, 0.0))
    touch = knee + Vector((0.055, 0.0, 0.0))  # the shaft rests on the cloth over the knee (at 7.5 cm it stood 2.5 cm off)
    rest_s = _stick_frame(tip_r, touch - tip_r, stick_len)
    # tools in the girdle, both left of the front centre: knife handle up, spoon blank low with its bowl up; at 7.5 cm
    # right the grasping hand overlapped the cloak's right front edge when seated, and a higher spoon reached up under
    # the shoulder cape (both measured with the posed-hand rule against the posed cloak and cape)
    k_world, k_local = _belt_rest(rig, 0.03, 0.14, (0.0, 0.0, -1.0), -0.065)
    p_world, p_local = _belt_rest(rig, 0.085, 0.05, (0.0, 0.0, 1.0), 0.09)
    rest_k_rest_pose, rest_p_rest_pose = k_world, p_world

    def at_hips(frame, local):
        return rig.fk(*frame)["hips"] @ local
    H = lambda world, grip: world @ grip.inverted()
    S_mid = Matrix.Translation(Vector((0.0, 0.0, 0.05))) @ keyed_matrix(0.5, [(0.0, S0), (1.0, rest_s)])
    t_s, t_k, t_p = 0.85, 1.25, 1.55
    pose_c = rig.fk(*carve0)
    # the girdle at each swap: the hips of the blended pose at that moment (no dip or lean moves the hips here)
    Kg = at_hips(blend(sit0, carve0, smooth(t_k / enter_s)), k_local)
    Pg = at_hips(blend(sit0, carve0, smooth(t_p / enter_s)), p_local)
    # she stays upright (the seated rest's spine) until both tools are out of the girdle and leans into the carving
    # pose afterwards: leaning first dropped the shoulder cape's hem over the girdle, so the reaching hands went
    # through it (posed-hand check: 13 and 15 of 37 frames); the hands come to the girdle from the front, below the
    # hem, and she glances at her lap rather than bowing her head to the belt
    front = Vector((0.0, -0.06, 0.02))
    lap = (pose_c["hand_l"].translation + pose_c["hand_r"].translation) * 0.5
    enter = transition_clip(
        rig, soles, sit0, carve0, enter_s, seated=True,
        hand_keys={"l": [(0.4, H(S_mid, g_s)), (t_s - 0.04, H(rest_s, g_s)), (t_s + 0.1, H(rest_s, g_s)),
                         (t_s + 0.22, moved(H(rest_s, g_s), (0.0, -0.05, -0.02))), (t_s + 0.4, moved(H(rest_s, g_s), (0.0, -0.06, -0.13)))]
                        + grasp_keys(t_p, H(Pg, g_p), before=0.2, approach_vec=front, leave_vec=(0.0, -0.04, 0.03)),
                   "r": grasp_keys(t_k, H(Kg, g_k), before=0.22, approach_vec=front, leave_vec=(0.0, -0.04, 0.03))},
        finger_keys=_seq_fingers(sit0, carve0, {"l": [(t_s, "start"), (t_s + 0.16, "open"), (t_p - 0.12, "open"), (t_p, "end")],
                                                "r": [(t_k - 0.25, "start"), (t_k - 0.1, "open"), (t_k, "end")]}),
        twist=[(0.0, 0.0), (0.7, 6.0), (t_k, 7.0), (t_p + 0.1, 4.0), (enter_s, 0.0)],
        spine_keys=[(0.0, 0.0), (t_p + 0.15, 0.0), (enter_s, 1.0)],
        look=[(0.0, tip0 + Vector((0.0, 0.0, 0.5))), (0.75, touch), (1.25, lap + Vector((0.0, -0.1, 0.0))),
              (enter_s, pose_c["hand_l"].translation)])
    x_p, x_k, x_g = 0.55, 0.8, 1.35
    Kx = at_hips(blend(carve0, sit0, smooth(x_k / exit_s)), k_local)
    Px = at_hips(blend(carve0, sit0, smooth(x_p / exit_s)), p_local)
    # the exit sits up first (the seated rest's spine by 0.5 s), then tucks the tools back from the front
    exit_ = transition_clip(
        rig, soles, carve0, sit0, exit_s, seated=True,
        hand_keys={"l": _release_keys(x_p, H(Px, g_p), approach_vec=(0.0, -0.04, 0.03), leave_vec=front)
                        + [(x_g - 0.32, moved(H(rest_s, g_s), (0.0, -0.05, -0.12))), (x_g - 0.12, moved(H(rest_s, g_s), (0.0, -0.03, 0.0))),
                           (x_g, H(rest_s, g_s)),
                           (x_g + 0.1, H(rest_s, g_s)), (x_g + 0.45, H(S_mid, g_s))],
                   "r": _release_keys(x_k, H(Kx, g_k), approach_vec=(0.0, -0.04, 0.03), leave_vec=front)},
        finger_keys=_seq_fingers(carve0, sit0, {"l": [(x_p, "start"), (x_p + 0.16, "open"), (x_g - 0.1, "open"), (x_g, "end")],
                                                "r": [(x_k, "start"), (x_k + 0.16, "open")]}),
        twist=[(0.0, 0.0), (x_p, 4.0), (x_k, 7.0), (x_g, 6.0), (exit_s, 0.0)],
        spine_keys=[(0.0, 0.0), (0.5, 1.0), (exit_s, 1.0)],
        look=[(0.0, pose_c["hand_l"].translation), (0.6, lap + Vector((0.0, -0.1, 0.0))), (1.3, touch),
              (exit_s, tip0 + Vector((0.0, 0.0, 0.5)))])
    rests = {"prop_stick": rest_copy(props["prop_stick"], "prop_stick_rest", rest_s)}
    props["prop_stick_rest"] = rests["prop_stick"]
    rests["prop_knife"] = rest_copy(props["prop_knife"], "prop_knife_rest", rest_k_rest_pose)
    rests["prop_spoon"] = rest_copy(props["prop_spoon"], "prop_spoon_rest", rest_p_rest_pose)
    for name, local in (("prop_knife", k_local), ("prop_spoon", p_local)):
        rests[name]["grip_bone"] = "hips"  # exported under a hips socket: the girdle moves with her
        rests[name]["grip_matrix"] = [v for row in local for v in row]
        rests[name]["placement"] = "socket"
    swaps = {"work_enter": [{"seconds": t_s, "node": "prop_stick", "rest": ["prop_stick_rest"], "hand": "hand_l", "to": "rest"},
                            {"seconds": t_k, "node": "prop_knife", "rest": ["prop_knife_rest"], "hand": "hand_r", "to": "hand"},
                            {"seconds": t_p, "node": "prop_spoon", "rest": ["prop_spoon_rest"], "hand": "hand_l", "to": "hand"}],
             "work_exit": [{"seconds": x_p, "node": "prop_spoon", "rest": ["prop_spoon_rest"], "hand": "hand_l", "to": "rest"},
                           {"seconds": x_k, "node": "prop_knife", "rest": ["prop_knife_rest"], "hand": "hand_r", "to": "rest"},
                           {"seconds": x_g, "node": "prop_stick", "rest": ["prop_stick_rest"], "hand": "hand_l", "to": "hand"}]}
    targets = {"prop_stick": rest_s, "prop_knife": ("hips", k_local), "prop_spoon": ("hips", p_local)}
    return {"work_enter": enter, "work_exit": exit_}, swaps, rests, targets


def _seq_fingers(start, end, plans):
    """Finger keys from named states: 'start' (the start frame's fingers), 'end' (the end frame's), 'open'."""
    out = {}
    for side, plan in plans.items():
        bones = [f"{f}_{k:02d}_{side}" for f in FINGERS for k in (1, 2, 3)]
        st = {b: start[0].get(b, Quaternion()) for b in bones}
        en = {b: end[0].get(b, Quaternion()) for b in bones}
        op = {b: Quaternion().slerp(st[b], 0.35) for b in bones}
        out[side] = [(t, {"start": st, "end": en, "open": op}[name]) for t, name in plan]
    return out


def check_swaps_any(rig, frames, swaps, grips, targets):
    """Like check_swaps, with girdle (hips-joint) rests: targets maps a node to a world 4x4 or ('hips', local)."""
    out = []
    for sw in swaps:
        k = int(round(sw["seconds"] * FPS))
        side = sw["hand"][-1]
        pose = rig.fk(*frames[k])
        Hp = pose[f"hand_{side}"] @ grips[sw["node"]]
        tg = targets[sw["node"]]
        R = pose[tg[0]] @ tg[1] if isinstance(tg, tuple) else tg
        d = (Hp.translation - R.translation).length
        a = math.degrees(Hp.to_quaternion().rotation_difference(R.to_quaternion()).angle)
        out.append({"seconds": sw["seconds"], "node": sw["node"], "to": sw["to"], "offsetCm": round(d * 100, 2),
                    "angleDeg": round(min(a, 360 - a), 2), "propAt": [round(v, 3) for v in Hp.translation],
                    "restAt": [round(v, 3) for v in R.translation], "shoulder": [round(v, 3) for v in pose[f"upperarm_{side}"].translation]})
    return out


def spinner(rig, soles, idle0, work0, g_l, props, drop, enter_s=2.0, exit_s=1.9):
    """The spinner carries her fibre roll and spindle tucked in her apron band (hips joint). work_enter: the left hand
    draws them out, lets the spindle drop on its yarn (the yarn pays out, prop_spindle_yarn) and rises into drafting;
    work_exit winds the spindle back up to the fist and tucks both into the band. (Round 2: a basket on the ground was
    out of her reach without a deep squat.) Returns the clips, swaps, rest copies, targets and the spindle/yarn keys."""
    roll, spindle = props["prop_fibre_roll"], props["prop_spindle"]
    yarn = props.get("prop_spindle_yarn")
    pose_w = rig.fk(*work0)
    Hw = pose_w["hand_l"]
    Rw = Hw.to_3x3()
    # the roll lies across the band, the spindle (body only: its yarn is its own node) tucked upright beside it
    roll_world, roll_local = _belt_rest(rig, -0.02, 0.06, (0.0, 0.0, 1.0), 0.0)
    R_roll = Matrix.Rotation(math.radians(-80.0), 3, "Y") @ Matrix.Rotation(math.radians(-10.0), 3, "X")
    roll_world = Matrix.Translation(roll_world.translation + Vector((0.14, -0.01, 0.0))) @ R_roll.to_4x4()
    roll_local = rig.rest["hips"].inverted() @ roll_world
    sp_world, sp_local = _belt_rest(rig, -0.075, 0.06, (0.0, 0.0, 1.0), 0.0)
    sp_world = Matrix.Translation(sp_world.translation + Vector((0.0, 0.0, drop + 0.07))) @ Matrix.Identity(4)
    sp_local = rig.rest["hips"].inverted() @ sp_world

    def at_hips(frame, local):
        return rig.fk(*frame)["hips"] @ local
    t1, t_drop = 0.55, 0.42
    mid = blend(idle0, work0, smooth(t1 / enter_s))
    Rg = at_hips(mid, roll_local)            # the roll in the band at the grasp
    H1 = Rg @ g_l.inverted()                  # the hand that holds it there
    x1 = exit_s - 0.55
    mid_x = blend(work0, idle0, smooth(x1 / exit_s))
    Rgx = at_hips(mid_x, roll_local)
    H1x = Rgx @ g_l.inverted()
    enter = transition_clip(rig, soles, idle0, work0, enter_s,
                            hand_keys={"l": grasp_keys(t1, H1, before=0.2, hold=0.06, after=0.12, leave=0.06) +
                                       [(t1 + t_drop, lifted(H1, 0.09))]},
                            finger_keys=_seq_fingers(idle0, work0, {"l": [(t1 - 0.22, "start"), (t1 - 0.1, "open"), (t1, "end")]}),
                            flex=[(0.0, 0.0), (t1, 7.0), (t1 + t_drop, 4.0), (enter_s, 0.0)],
                            look=[(0.0, Rg.translation + Vector((0.0, -0.6, 0.5))), (t1, Rg.translation),
                                  (t1 + t_drop, Rg.translation - Vector((0.0, 0.1, 0.4))), (enter_s, (Hw @ g_l).translation - Vector((0.0, 0.0, 0.3)))])
    exit_ = transition_clip(rig, soles, work0, idle0, exit_s,
                            hand_keys={"l": [(x1 - t_drop, lifted(H1x, 0.1))] + _release_keys(x1, H1x, before=0.16, hold=0.06, after=0.14, leave=0.06)},
                            finger_keys=_seq_fingers(work0, idle0, {"l": [(x1, "start"), (x1 + 0.15, "open")]}),
                            flex=[(0.0, 0.0), (x1 - t_drop, 4.0), (x1, 7.0), (exit_s, 0.0)],
                            look=[(0.0, (Hw @ g_l).translation - Vector((0.0, 0.0, 0.3))), (x1 - t_drop, Rgx.translation - Vector((0.0, 0.1, 0.4))),
                                  (x1, Rgx.translation), (exit_s, Rgx.translation + Vector((0.0, -0.6, 0.5)))])
    # spindle and yarn keys (hand-local): tucked with the roll until the grasp, dropping on the paying-out yarn, then plumb
    L = float(yarn["yarn_length"]) if yarn is not None else drop
    sp_keys = {}
    for clip, frames, t_g, sign in (("work_enter", enter, t1, 1), ("work_exit", exit_, x1, -1)):
        s_loc, y_loc = [], []
        for i, (rot, loc) in enumerate(frames):
            t = i / FPS
            pose = rig.fk(rot, loc)
            hand = pose["hand_l"]
            top = (hand @ g_l).translation                      # the yarn leaves the fist here
            tucked = (pose["hips"] @ sp_local).translation       # the spindle's yarn-top reference when tucked
            hang = top                                           # plumb: the spindle frame sits at the yarn top
            k = smooth((t - t_g) / t_drop) if sign > 0 else 1.0 - smooth((t - (t_g - t_drop)) / t_drop)
            k = k ** 2 if sign > 0 else k                         # falling: slow, then quick; winding: steady
            ref = tucked.lerp(hang, k)
            S = Matrix.Translation(ref)
            s_loc.append(hand.inverted() @ S)
            body_top = ref - Vector((0.0, 0.0, drop))
            d = body_top - top
            length = max(0.002, d.length)
            # the yarn runs from the fist down to the spindle's top: its -Z along that line, turned from the plumb frame
            # by the smallest rotation (no roll about the thread, so the node never appears to spin)
            down = d.normalized() if d.length > 1e-5 else Vector((0.0, 0.0, -1.0))
            R = Vector((0.0, 0.0, -1.0)).rotation_difference(down).to_matrix().to_4x4()
            Y = Matrix.Translation(top) @ R @ Matrix.Diagonal((1.0, 1.0, length / L, 1.0))
            y_loc.append(hand.inverted() @ Y)
        sp_keys[clip] = (s_loc, y_loc)
    rests = {"prop_fibre_roll": rest_copy(roll, "prop_fibre_roll_rest", roll_world),
             "prop_spindle": rest_copy(spindle, "prop_spindle_rest", sp_world)}
    for name, local in (("prop_fibre_roll", roll_local), ("prop_spindle", sp_local)):
        rests[name]["grip_bone"] = "hips"
        rests[name]["grip_matrix"] = [v for row in local for v in row]
        rests[name]["placement"] = "socket"
    swaps = {"work_enter": [{"seconds": t1, "node": "prop_fibre_roll", "rest": ["prop_fibre_roll_rest", "prop_spindle_rest"],
                             "hand": "hand_l", "to": "hand", "with": ["prop_spindle", "prop_spindle_yarn"]}],
             "work_exit": [{"seconds": x1, "node": "prop_fibre_roll", "rest": ["prop_fibre_roll_rest", "prop_spindle_rest"],
                            "hand": "hand_l", "to": "rest", "with": ["prop_spindle", "prop_spindle_yarn"]}]}
    targets = {"prop_fibre_roll": ("hips", roll_local)}
    return {"work_enter": enter, "work_exit": exit_}, swaps, rests, targets, sp_keys

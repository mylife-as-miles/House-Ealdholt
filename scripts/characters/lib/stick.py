"""The elder's walking stick (original Crownfall code, motion stage).

The first stick clips planted the idle tip 14 cm ahead and 6 cm out of the left ankle (on the shoe), solved the hand
toward a target the arm often could not reach (the tip floated 1 to 6 cm above the ground), held the stick in the open
relaxed hand and popped the hand 15 degrees at the walk's loop seam; walk_start and walk_stop did not begin or end on
the idle's stick pose. Here:

* every plant is a ground point outside the left foot (15 cm lateral of its ankle) and 20 cm ahead of the right heel:
  the stick lands and lifts with the right foot (a stick in the left hand supports the right leg) and stays planted,
  carried with the ground, through that foot's stance; between plants it swings forward on a low arc;
* the grip point lies on the sphere of the stick's length around the tip, in the direction of the captured stick
  hand (WalkingStickLeft), moved toward the shoulder when the arm could not reach it, so the tip is always on the
  ground while planted; the hand turns about the stick so the stick's axis runs through the palm;
* the idle, talk and seated clips hold one static plant; walk_start keeps the idle plant until the walk's own plant
  (the right foot is planted through the start), walk_stop's last swing lands on the idle plant;
* the stick hand closes in a grip (fingers wrapped round the 2.7 cm shaft) in every stick clip.

Round 2 (motion fixer): the solver's stick length is the mesh's grip-origin-to-tip length (it used 2 cm less, so every
planted tip sat 2 cm under the ground); the swing lifts the tip straight up, carries it forward and sets it straight
down, so it lands with no horizontal speed (it skidded about 7 cm forward while sinking); the walk plant ends when
the tip reaches the cloak's front edge (`lift_y`) instead of at the right toe-off (38 percent of the walk had 12 to 36 cm
of shaft inside the cloak or kirtle); and the hand stays in front of the cloak's opening.
"""
import math

from mathutils import Matrix, Quaternion, Vector

import motion as mo

FPS = 30
OUT = 0.19      # tip outside the left ankle (metres, toward the character's left; clear of the cloak's side)
AHEAD = 0.24    # tip ahead of the right heel at the plant
GRIP_BELOW_TOP = 0.02  # the fist holds the shaft this far below the stick's top (the grip frame carries this offset)
LIFT = 0.05     # swing arc height
STICK_GRIP = {"index": (55, 70, 38), "middle": (62, 74, 40), "ring": (66, 76, 42), "pinky": (70, 78, 44)}


def smoothstep(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


class Stick:
    def __init__(self, rig, hands, length, grip, tip_radius=0.0):
        self.rig, self.hands, self.L, self.grip = rig, hands, length, grip
        self.tip_radius = tip_radius
        # the IK reaches with the joint-to-joint distances, not the bone lengths (the bones need not be connected)
        r = rig.rest
        self.arm = ((r["forearm_l"].translation - r["upperarm_l"].translation).length +
                    (r["hand_l"].translation - r["forearm_l"].translation).length)
        self.curl = hands.curl("l", STICK_GRIP, (38, 32, 22))
        self.canonical = None

    def set_canonical(self, frame, tip, want):
        """Fix the grip's twist from one frame (the idle's first): later holds start from this hand rotation."""
        rot, loc = frame
        pose = self.rig.fk(rot, loc)
        self.hold(pose, rot, loc, tip, want)
        self.canonical = pose["hand_l"].to_3x3().copy()

    def grip_point(self, pose):
        return (pose["hand_l"] @ self.grip).translation

    def tip_of(self, pose):
        return (pose["hand_l"] @ self.grip) @ Vector((0.0, 0.0, -self.L))

    def hold(self, pose, rot, loc, tip, want):
        """Put the left hand on the stick planted at `tip`, the grip as near `want` as the stick length and the arm allow."""
        rig = self.rig
        axis = want - tip
        axis = axis.normalized() if axis.length > 1e-6 else Vector((0.0, 0.0, 1.0))
        shoulder = pose["upperarm_l"].translation
        reach = 0.96 * self.arm
        # the hand turns about the stick: rotate a reference hand (one canonical grip for every stick clip, so the
        # twist about the stick never flips between frames or clips) so the prop's +Z (up the stick) runs along the axis
        cur = self.canonical if self.canonical is not None else pose["hand_l"].to_3x3()
        cur_axis = (cur @ self.grip.to_3x3() @ Vector((0.0, 0.0, 1.0))).normalized()

        def hand_for(a):
            r_hand = cur_axis.rotation_difference(a).to_matrix() @ cur
            prop = Matrix.Translation(tip + a * self.L) @ (r_hand @ self.grip.to_3x3()).to_4x4()
            return prop @ self.grip.inverted()
        hand = hand_for(axis)
        if (hand.translation - shoulder).length > reach:
            # the arm reaches the wrist, not the grip point: tilt the stick toward the shoulder until the wrist is
            # reachable, so the tip stays on the ground (the first solve let the tip float 1 to 6 cm)
            to_sh = (shoulder - tip).normalized()
            lo, hi = 0.0, 1.0
            for _ in range(18):
                m = 0.5 * (lo + hi)
                a = (axis * (1 - m) + to_sh * m).normalized()
                lo, hi = (m, hi) if (hand_for(a).translation - shoulder).length > reach else (lo, m)
            axis = (axis * (1 - hi) + to_sh * hi).normalized()
            hand = hand_for(axis)
        g = tip + axis * self.L
        pole = shoulder + Vector((0.38, 0.28, -0.22))
        mo.two_bone_ik(rig, pose, rot, loc, "upperarm_l", "forearm_l", "hand_l", hand.translation, pole)
        mo.set_world_rotation(rig, pose, rot, loc, "hand_l", hand.to_3x3())
        rot.update(self.curl)
        for b in self.curl:
            rig.update_chain(pose, rot, loc, b)
        return g


def fit_length(props, length):
    """Make the stick props (in hand and at rest) `length` from the grip origin to the tip. The recipe's 0.74 m stick
    was too short for the elder's reach (a 0.42 m arm from a 1.2 m shoulder: her wrist cannot come below about 0.79 m):
    planted, her arm locked straight and the tip still hung 3 to 5 cm above the ground. A 0.84 m stick (with its knob,
    a hip-high walking staff) lets her hold it with the elbow bent. The shaft is scaled; the worn knob keeps its shape."""
    for name in ("prop_stick", "prop_stick_rest"):
        obj = props.get(name)
        if obj is None:
            continue
        co = [v.co for v in obj.data.vertices]
        current = -min(c.z for c in co)
        if abs(current - length) < 1e-4:
            continue
        k = length / current
        for v in obj.data.vertices:
            if v.co.z < 0:
                v.co.z *= k
        obj.data.update()


def tip_radius(obj):
    """Radius of the stick's tip end (prop frame: the shaft runs down -Z from the grip origin)."""
    if obj is None:
        return 0.0
    co = [v.co for v in obj.data.vertices]
    low = min(c.z for c in co)
    ring = [c for c in co if c.z < low + 0.004]
    return max(math.hypot(c.x, c.y) for c in ring) if ring else 0.0


def plant_point(left_ankle, right_heel):
    """Ground point of a plant: outside the left ankle, ahead of the right heel (clip space at the plant)."""
    return Vector((left_ankle.x + OUT, right_heel.y - AHEAD, 0.0))


def swing_shape(s):
    """Swing progress s (0 at lift-off, 1 at the plant) to (forward fraction, height fraction): the tip rises before it
    moves (first 12 percent), travels forward through the middle, and comes straight down over the last 18 percent,
    so it reaches the ground with no horizontal speed and lifts without scraping."""
    h = smoothstep((s - 0.12) / 0.70)
    z = min(smoothstep(s / 0.16), 1.0 - smoothstep((s - 0.82) / 0.18)) * (0.75 + 0.25 * math.sin(math.pi * max(0.0, min(1.0, s))))
    return h, z


def tip_track(n, travel, plants, cyclic, stride=0.0, speed=None):
    """Tip positions per frame (clip space). plants: list of (a, b, ground point at frame a) in frame order; between
    plants the tip swings from the end of one plant to the start of the next (swing_shape). A non-cyclic clip may name
    plants outside its frames (a swing that began before the clip or lands after it): the travel is extrapolated there
    at `speed` metres per frame (default: the clip's end speeds)."""
    period = n - 1 if cyclic else n
    v0 = (travel[1] - travel[0]) if n > 1 else 0.0
    v1 = (travel[-1] - travel[-2]) if n > 1 else 0.0

    def trav(u):
        if cyclic:
            return travel[u % period] + (u // period) * stride
        if u < 0:
            return travel[0] + u * (speed if speed is not None else v0)
        if u > n - 1:
            return travel[-1] + (u - (n - 1)) * (speed if speed is not None else v1)
        return travel[u]
    tips = [None] * n
    for (a, b, p) in plants:
        for u in range(a, b + 1):
            if not cyclic and not (0 <= u < n):
                continue
            k = u % period if cyclic else u
            tips[k] = p + Vector((0.0, trav(u) - trav(a), 0.0))
    seq = sorted(plants, key=lambda x: x[0])
    # cyclic: the first plant again one period later, at the same clip position (one stride further over the ground)
    pairs = list(zip(seq, seq[1:] + ([(seq[0][0] + period, seq[0][1] + period, seq[0][2].copy())] if cyclic else [])))
    for (a0, b0, p0), (a1, b1, p1) in pairs:
        w0 = p0 + Vector((0.0, trav(b0) - trav(a0), 0.0)) - Vector((0.0, trav(b0), 0.0))  # world at lift-off
        w1 = p1 - Vector((0.0, trav(a1), 0.0))                                            # world at the next plant
        for u in range(b0 + 1, a1):
            if not cyclic and not (0 <= u < n):
                continue
            k = u % period if cyclic else u
            hs, zs = swing_shape((u - b0) / float(a1 - b0))
            q = w0.lerp(w1, hs) + Vector((0.0, trav(u), 0.0))
            q.z = LIFT * zs
            tips[k] = q
    if cyclic:  # the in-place loop's last frame repeats the first
        tips[n - 1] = tips[0].copy() if tips[0] is not None else None
    for k in range(n):  # frames before the first or after the last plant hold the nearest plant
        if tips[k] is None:
            near = min((j for j in range(n) if tips[j] is not None), key=lambda j: abs(j - k))
            tips[k] = tips[near].copy()
    return tips


def lift_frame(a, b, p, trav, lift_y):
    """Last planted frame of a plant that starts at frame a on ground point p (clip space): the frame before the tip,
    carried with the ground (trav(u) = forward root travel at frame u), would pass lift_y (the cloak's front edge in
    the in-place frame), capped at b."""
    for u in range(a + 1, b + 1):
        if p.y + (trav(u) - trav(a)) > lift_y:
            return u - 1
    return b


def blend_tips(tips, target, count, at_end):
    """Ease the first or last `count` tip positions into `target` (the neighbouring clip's tips at the join)."""
    n = len(tips)
    for k in range(count):
        i = n - count + k if at_end else k
        w = smoothstep((k + 1) / count) if at_end else smoothstep(1.0 - k / count)
        tips[i] = tips[i].lerp(target[k], w)
    return tips


ARM = ("upperarm_l", "forearm_l", "hand_l")


def _smooth_arm(frames, cyclic):
    """Low-pass the stick arm's joint rotations over neighbouring frames (the IK's minimal rotations from the
    captured arm could twist the forearm 27 degrees in one frame where the stick passed under the hand)."""
    n = len(frames)
    src = [{b: frames[i][0][b].copy() for b in ARM if b in frames[i][0]} for i in range(n)]
    for i in range(n):
        for b in src[i]:
            acc = None
            for d, w in ((-2, 0.1), (-1, 0.2), (0, 0.4), (1, 0.2), (2, 0.1)):
                j = i + d
                if cyclic:
                    j %= (n - 1)
                elif not (0 <= j < n):
                    j = max(0, min(n - 1, j))
                q = src[j][b]
                if acc is None:
                    acc = q * w
                else:
                    acc = acc + (q if acc.dot(q) >= 0 else -q) * w
            acc.normalize()
            frames[i][0][b] = acc


def apply(stick, frames, tips, want_grips, cyclic=False):
    """Hold the stick planted at tips[i] with the grip toward want_grips[i] in every frame (solved, the arm smoothed
    over time, solved again from the smoothed arm). A planted tip is raised by the tip's radius times the sine of the
    stick's lean, so the rim of the inclined tip end rests on the ground instead of the axis point (round 1 left the
    rim 2 to 3 mm under it). Returns the largest planted-tip error in metres."""
    rig = stick.rig
    tips = [t.copy() for t in tips]
    planted = [t.z < 1e-4 for t in tips]
    for _pass in range(3):
        for i, (rot, loc) in enumerate(frames):
            pose = rig.fk(rot, loc)
            stick.hold(pose, rot, loc, tips[i], want_grips[i])
        if _pass < 2:
            _smooth_arm(frames, cyclic)
        if _pass == 0 and stick.tip_radius > 0:
            for i, (rot, loc) in enumerate(frames):
                if planted[i]:
                    axis = (rig.fk(rot, loc)["hand_l"] @ stick.grip).to_3x3() @ Vector((0.0, 0.0, 1.0))
                    tips[i].z = stick.tip_radius * math.sqrt(max(0.0, 1.0 - min(1.0, axis.normalized().z) ** 2))
    worst = 0.0
    for i, (rot, loc) in enumerate(frames):
        if planted[i]:
            worst = max(worst, abs(stick.tip_of(rig.fk(rot, loc)).z - tips[i].z))
    return worst


def hand_grips(stick, frames):
    """The captured stick hand's grip point in each frame (where the hand wants to be)."""
    out = []
    for rot, loc in frames:
        out.append(stick.grip_point(stick.rig.fk(rot, loc)))
    return out


def smooth_points(points, cyclic, k=3):
    n = len(points)
    out = []
    for i in range(n):
        acc, wsum = Vector((0.0, 0.0, 0.0)), 0.0
        for d in range(-k, k + 1):
            j = i + d
            if cyclic:
                j %= (n - 1)
            elif not (0 <= j < n):
                continue
            w = 1.0 - abs(d) / (k + 1.0)
            acc += points[j] * w
            wsum += w
        out.append(acc / wsum)
    if cyclic:
        out[-1] = out[0].copy()
    return out

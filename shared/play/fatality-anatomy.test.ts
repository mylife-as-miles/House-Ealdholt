import assert from "node:assert/strict";
import test from "node:test";
import {
  anatomyLayout, boneEnds, channelLength, chestFrame, chooseFracture, fragmentAt, fragmentsOf, fragmentTurn, halfBend, pelvisFrame, ribAt, ribPoint, skullFrame, xrayAt,
  FRAGMENTS, RIBS, XRAY, XRAY_SECONDS, type Point,
} from "../../web/src/scene/fatality/anatomyPlan";
import { FATALITY_SECONDS } from "../../web/src/scene/fatality/fatalityPlan";
import type { RigJoint } from "../../web/src/scene/death/ragdoll/ragdollPlan";

/** The kingdoms' rig (Solforiz's Pawn, as its file lists its joints), standing on the origin and facing +z; its left is +x. */
const NAMES: [string, number, Point][] = [
  ["Hips", -1, { x: 0, y: 0.4, z: 0 }],
  ["LeftUpLeg", 0, { x: 0.05, y: 0.38, z: 0 }], ["LeftLeg", 1, { x: 0.05, y: 0.21, z: 0.01 }], ["LeftFoot", 2, { x: 0.05, y: 0.04, z: -0.01 }], ["LeftToeBase", 3, { x: 0.05, y: 0.01, z: 0.06 }],
  ["RightUpLeg", 0, { x: -0.05, y: 0.38, z: 0 }], ["RightLeg", 5, { x: -0.05, y: 0.21, z: 0.01 }], ["RightFoot", 6, { x: -0.05, y: 0.04, z: -0.01 }], ["RightToeBase", 7, { x: -0.05, y: 0.01, z: 0.06 }],
  ["Spine02", 0, { x: 0, y: 0.45, z: 0 }], ["Spine01", 9, { x: 0, y: 0.5, z: 0 }], ["Spine", 10, { x: 0, y: 0.56, z: 0 }],
  ["LeftShoulder", 11, { x: 0.02, y: 0.61, z: 0 }], ["LeftArm", 12, { x: 0.08, y: 0.61, z: 0 }], ["LeftForeArm", 13, { x: 0.1, y: 0.49, z: 0 }], ["LeftHand", 14, { x: 0.11, y: 0.39, z: 0.01 }],
  ["neck", 11, { x: 0, y: 0.63, z: 0 }], ["Head", 16, { x: 0, y: 0.67, z: 0 }], ["head_end", 17, { x: 0, y: 0.78, z: 0 }], ["headfront", 17, { x: 0, y: 0.7, z: 0.07 }],
  ["RightShoulder", 11, { x: -0.02, y: 0.61, z: 0 }], ["RightArm", 20, { x: -0.08, y: 0.61, z: 0 }], ["RightForeArm", 21, { x: -0.1, y: 0.49, z: 0 }], ["RightHand", 22, { x: -0.11, y: 0.39, z: 0.01 }],
];
const JOINTS: RigJoint[] = NAMES.map(([name, parent]) => ({ name, parent }));
const STANDING: Point[] = NAMES.map(([, , at]) => at);
const H = 0.78;
const index = (name: string) => NAMES.findIndex(([n]) => n === name);
/** The same figure turned a quarter round to face +x (its left is then -z), and moved across the board. */
const turned = (p: Point): Point => ({ x: p.z + 1.5, y: p.y, z: -p.x - 2 });
const near = (a: Point, b: Point, within: number, what: string) =>
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= within, `${what}: ${JSON.stringify(a)} is not near ${JSON.stringify(b)}`);

test("the layout is read off the rig by joint names: the kingdoms' figures and Mixamo's alike", () => {
  const layout = anatomyLayout(JOINTS);
  assert.ok(layout);
  const bones = layout.long.map(bone => bone.name).sort();
  assert.deepEqual(bones, ["clavicleL", "clavicleR", "femurL", "femurR", "footL", "footR", "forearmL", "forearmR", "handL", "handR", "humerusL", "humerusR", "shinL", "shinR"]);
  assert.deepEqual(layout.spine.map(i => NAMES[i][0]), ["Hips", "Spine02", "Spine01", "Spine", "neck", "Head"]);
  assert.deepEqual([layout.skull.head, layout.skull.top, layout.skull.front], [index("Head"), index("head_end"), index("headfront")]);
  assert.deepEqual([layout.chest.low, layout.chest.high, layout.chest.neck], [index("Spine01"), index("Spine"), index("neck")]);
  const clavicle = layout.long.find(bone => bone.name === "clavicleL")!;
  assert.deepEqual([clavicle.from, clavicle.to], [index("LeftShoulder"), index("LeftArm")]);
  // A hand runs on past the wrist, along the forearm.
  const [wrist, fingers] = boneEnds(layout.long.find(bone => bone.name === "handL")!, STANDING);
  assert.ok(fingers.y < wrist.y, "the hand hangs on down from the wrist");
  // Mixamo's names, prefix and all.
  const mixamo = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "HeadTop_End", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"];
  const parents = [-1, 0, 1, 2, 3, 4, 5, 3, 7, 8, 9, 3, 11, 12, 13, 0, 15, 16, 17, 0, 19, 20, 21];
  const named = anatomyLayout(mixamo.map((name, i) => ({ name: `mixamorig:${name}`, parent: parents[i] })));
  assert.ok(named);
  assert.equal(named.long.length, 14);
  assert.equal(named.skull.front, null, "no joint in front of the face: the chest's forward is used");
  // A knob at each elbow and knee, between the bones either side of it.
  assert.deepEqual(layout.knobs.map(k => k.name).sort(), ["elbowL", "elbowR", "kneeL", "kneeR"]);
  const knee = layout.knobs.find(k => k.name === "kneeL")!;
  assert.deepEqual([knee.before, knee.joint, knee.after], [index("LeftUpLeg"), index("LeftLeg"), index("LeftFoot")]);
  // No head, or no hips: no X-ray (the fatality plays without it).
  assert.equal(anatomyLayout(JOINTS.filter(joint => joint.name !== "Head")), null);
  assert.equal(anatomyLayout([{ name: "root", parent: -1 }, { name: "body", parent: 0 }]), null);
});

test("the frames stand on the body: up the spine, across to its left, forward out of its chest, however it is turned", () => {
  const layout = anatomyLayout(JOINTS)!;
  for (const [what, pose, forward, side] of [["facing +z", STANDING, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }], ["turned", STANDING.map(turned), { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }]] as const) {
    const chest = chestFrame(layout, pose, H), pelvis = pelvisFrame(layout, pose, H), skull = skullFrame(layout, pose, chest, H);
    for (const [name, frame] of [["chest", chest], ["pelvis", pelvis], ["skull", skull]] as const) {
      near(frame.forward, forward, 0.05, `${what}: the ${name} faces forward`);
      near(frame.side, side, 0.05, `${what}: the ${name}'s side is its left`);
      near(frame.up, { x: 0, y: 1, z: 0 }, 0.05, `${what}: the ${name} is upright`);
    }
    // The cage hangs under the shoulders, round the chest, and in proportion to the figure.
    assert.ok(chest.origin.y > 0.5 && chest.origin.y < 0.6, `${what}: the cage's middle at ${chest.origin.y.toFixed(3)}`);
    assert.ok(chest.half.x > H * 0.05 && chest.half.x < H * 0.13 && chest.half.z < chest.half.x);
    assert.ok(skull.size > H * 0.1 && skull.size < H * 0.2);
  }
});

test("a rib breaks where it is struck: the side, the height, and the breastbone in the middle", () => {
  const layout = anatomyLayout(JOINTS)!, chest = chestFrame(layout, STANDING, H);
  // Every point along a rib is that rib.
  for (let rib = 0; rib < RIBS; rib += 1) for (const side of [1, -1] as const) for (const theta of [0.3, 0.9, 1.6]) {
    const found = ribAt(ribPoint(rib, side, theta));
    assert.ok(found.kind === "rib" && found.index === rib && found.side === side, `rib ${rib} side ${side} at ${theta}: ${JSON.stringify(found)}`);
  }
  // A thrust into the front of the chest, left of the middle, from in front: a left rib.
  const left = chooseFracture(layout, STANDING, { x: 0.04, y: 0.56, z: 0.08 }, { x: 0, y: 0, z: -1 }, H);
  assert.equal(left.bone.kind, "rib");
  if (left.bone.kind === "rib") assert.equal(left.bone.side, 1);
  // The same thrust right of the middle: a right rib; in the middle: the breastbone.
  const right = chooseFracture(layout, STANDING, { x: -0.04, y: 0.56, z: 0.08 }, { x: 0, y: 0, z: -1 }, H);
  assert.ok(right.bone.kind === "rib" && right.bone.side === -1, JSON.stringify(right.bone));
  assert.equal(chooseFracture(layout, STANDING, { x: 0, y: 0.57, z: 0.08 }, { x: 0, y: 0, z: -1 }, H).bone.kind, "sternum");
  // A lower thrust breaks a lower rib than a higher one.
  const high = chooseFracture(layout, STANDING, { x: 0.05, y: 0.6, z: 0.08 }, { x: 0, y: 0, z: -1 }, H);
  const low = chooseFracture(layout, STANDING, { x: 0.05, y: 0.5, z: 0.08 }, { x: 0, y: 0, z: -1 }, H);
  assert.ok(high.bone.kind === "rib" && low.bone.kind === "rib" && low.bone.index > high.bone.index, `${JSON.stringify(high.bone)} over ${JSON.stringify(low.bone)}`);
  // It breaks on the front of the chest, about where the blow went in, not at the back.
  assert.ok(left.at.z > chest.origin.z && left.along < H * 0.12, JSON.stringify(left));
  // Turned with the figure, it is the same rib.
  const turnedLeft = chooseFracture(layout, STANDING.map(turned), turned({ x: 0.04, y: 0.56, z: 0.08 }), { x: -1, y: 0, z: 0 }, H);
  assert.ok(turnedLeft.bone.kind === "rib" && left.bone.kind === "rib" && turnedLeft.bone.index === left.bone.index && turnedLeft.bone.side === left.bone.side
    && Math.abs(turnedLeft.bone.theta - left.bone.theta) < 1e-9, JSON.stringify([turnedLeft.bone, left.bone]));
  near(turnedLeft.at, turned(left.at), 1e-9, "where it breaks turns with the figure");
});

test("the first bone the blow meets breaks: an arm before the ribs, the thigh, the skull, the spine from behind", () => {
  const layout = anatomyLayout(JOINTS)!;
  const named = (fracture: ReturnType<typeof chooseFracture>) => fracture.bone.kind === "long" ? layout.long[fracture.bone.index].name : fracture.bone.kind;
  // From the left side at chest height, the upper arm hangs in the way.
  assert.equal(named(chooseFracture(layout, STANDING, { x: 0.16, y: 0.55, z: 0 }, { x: -1, y: 0, z: 0 }, H)), "humerusL");
  assert.equal(named(chooseFracture(layout, STANDING, { x: 0.05, y: 0.3, z: 0.07 }, { x: 0, y: 0, z: -1 }, H)), "femurL");
  assert.equal(named(chooseFracture(layout, STANDING, { x: -0.05, y: 0.12, z: 0.06 }, { x: 0, y: 0, z: -1 }, H)), "shinR");
  assert.equal(named(chooseFracture(layout, STANDING, { x: 0, y: 0.73, z: 0.09 }, { x: 0, y: 0, z: -1 }, H)), "skull");
  const back = named(chooseFracture(layout, STANDING, { x: 0, y: 0.47, z: -0.1 }, { x: 0, y: 0, z: 1 }, H));
  assert.ok(back === "vertebra" || back === "rib", back);
  // A thrust into the belly (the game's wounds go in at the lowest spine joint) breaks the body, never a thigh: the
  // lowest ribs over it, or the spine behind; and so does a blade that comes in there and runs up out of the back.
  for (const [what, direction] of [["level", { x: 0, y: 0, z: -1 }], ["rising", { x: 0, y: 0.84, z: -0.55 }]] as const) {
    const belly = chooseFracture(layout, STANDING, { x: 0.03, y: 0.45, z: 0.09 }, direction, H).bone.kind;
    assert.ok(belly === "rib" || belly === "vertebra" || belly === "sternum", `${what}: ${belly}`);
  }
  // A long bone breaks along its length, between its joints.
  const thigh = chooseFracture(layout, STANDING, { x: 0.05, y: 0.3, z: 0.07 }, { x: 0, y: 0, z: -1 }, H);
  assert.ok(thigh.bone.kind === "long" && thigh.bone.t > 0.3 && thigh.bone.t < 0.7, JSON.stringify(thigh.bone));
  // The wound channel runs about through the body.
  const chest = chestFrame(layout, STANDING, H);
  const channel = channelLength({ x: 0, y: 0.56, z: 0.08 }, { x: 0, y: 0, z: -1 }, chest.origin, H);
  assert.ok(channel >= H * 0.16 && channel <= H * 0.5, `${channel}`);
});

test("the fragments: seeded, most of them on along the blow, some back out of the wound, slowing as they drift apart", () => {
  const along = { x: 0, y: 0, z: -1 };
  const a = fragmentsOf(along, H, 1234), b = fragmentsOf(along, H, 1234), c = fragmentsOf(along, H, 99);
  assert.equal(a.length, FRAGMENTS);
  assert.deepEqual(a, b, "the same game breaks the same way");
  assert.notDeepEqual(a, c);
  const on = a.filter(f => f.velocity.z < 0).length;
  assert.ok(on >= FRAGMENTS * 0.55 && on < FRAGMENTS, `${on} of ${FRAGMENTS} go on along the blow`);
  assert.ok(a.some(f => f.splinter) && a.some(f => !f.splinter), "splinters and chips");
  for (const fragment of a) {
    const speed = Math.hypot(fragment.velocity.x, fragment.velocity.y, fragment.velocity.z);
    assert.ok(speed > H * 0.2 && speed < H * 1.1, `speed ${speed}`);
    assert.ok(fragment.size > 0 && fragment.size < H * 0.07);
  }
  // Trailing out on a spring: leaving at its own speed, away along its heading, slowing, settling where it drifts to.
  const start = { x: 0, y: 0.56, z: 0.06 }, d = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
  for (const f of a) {
    const at = (t: number) => fragmentAt(f, start, t, H);
    const origin = { x: start.x + f.offset.x, y: start.y + f.offset.y, z: start.z + f.offset.z };
    near(at(0), origin, 1e-9, "starts at the break");
    const early = at(0.01), speed = Math.hypot(f.velocity.x, f.velocity.y, f.velocity.z);
    assert.ok(Math.abs(d(early, origin) / 0.01 - speed) < speed * 0.2, "leaves at its own speed");
    const out = { x: early.x - origin.x, y: early.y - origin.y, z: early.z - origin.z };
    assert.ok(out.x * f.velocity.x + out.y * f.velocity.y + out.z * f.velocity.z > 0, "along its heading");
    assert.ok(d(at(0.05), at(0)) > d(at(0.65), at(0.6)), "slowing");
    const settled = at(1.2), rest = { x: origin.x + f.rest.x, y: origin.y + f.rest.y, z: origin.z + f.rest.z };
    assert.ok(Math.abs(settled.x - rest.x) < H * 0.01 && Math.abs(settled.z - rest.z) < H * 0.01, "settles where it drifts to");
    assert.ok(settled.y < rest.y, "having sunk a little");
    // In the half second of scene time the slow motion shows, none goes further than about a figure's width.
    for (let t = 0; t <= 0.6; t += 0.05) assert.ok(d(at(t), start) < H * 0.45);
    // It tumbles fast at first, then less and less.
    const turn = (t: number) => { const r = fragmentTurn(f, t); return Math.hypot(r.x, r.y, r.z); };
    assert.equal(turn(0), 0);
    assert.ok(turn(0.1) - turn(0) > turn(0.6) - turn(0.5));
  }
});

test("a hinge's knob turns half way between its bones, so a bent joint keeps its volume", () => {
  const straight = halfBend({ x: 0, y: 0.38, z: 0 }, { x: 0, y: 0.21, z: 0 }, { x: 0, y: 0.04, z: 0 });
  near(straight, { x: 0, y: -1, z: 0 }, 1e-9, "a straight leg: along the limb");
  // A knee bent square: the knob points half way between the thigh's way down and the shin's way back.
  const bent = halfBend({ x: 0, y: 0.38, z: 0 }, { x: 0, y: 0.21, z: 0 }, { x: 0, y: 0.21, z: -0.17 });
  near(bent, { x: 0, y: -Math.SQRT1_2, z: -Math.SQRT1_2 }, 1e-9, "a bent knee: half way");
});

test("the X-ray lasts about a second: in, the channel, the crack, the shatter, and the skin back", () => {
  const before = xrayAt(0), peak = xrayAt(0.6), after = xrayAt(XRAY_SECONDS + 0.01);
  assert.equal(before.shown, false);
  assert.deepEqual([peak.shown, peak.ghost, peak.bones, peak.crack, peak.shattered, peak.channel], [true, 1, 1, 1, true, 1]);
  assert.deepEqual([after.shown, after.ghost, after.bones], [false, 0, 0]);
  assert.ok(XRAY_SECONDS > 0.9 && XRAY_SECONDS < 1.4, "about a second");
  assert.ok(XRAY_SECONDS <= FATALITY_SECONDS, "the skin is back before the director lets go");
  // In order: the crack runs before the bone shatters, and both while the skin is a ghost.
  assert.ok(XRAY.crack[1] <= XRAY.shatter && XRAY.shatter < XRAY.out[0] && XRAY.in[1] < XRAY.shatter);
  assert.equal(xrayAt(XRAY.shatter - 0.01).shattered, false);
  assert.ok(xrayAt(XRAY.crack[0] + 0.1).crack > 0 && xrayAt(XRAY.crack[0] + 0.1).crack < 1);
  // The change is a flash: the ghost starts milky and clears.
  assert.ok(xrayAt(0.04).milk > xrayAt(0.4).milk && xrayAt(0.4).milk === 0);
  // Nothing jumps while it shows.
  let last = xrayAt(0);
  for (let t = 0; t < 1.5; t += 1 / 60) {
    const now = xrayAt(t);
    assert.ok(Math.abs(now.ghost - last.ghost) < 0.2 && Math.abs(now.bones - last.bones) < 0.2, `at ${t.toFixed(2)}`);
    last = now;
  }
});

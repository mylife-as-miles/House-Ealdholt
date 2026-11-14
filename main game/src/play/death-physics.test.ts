/**
 * The death physics on real Jolt, in Node: the same WebAssembly build the
 * browser loads, driven through the same world, ragdoll and burst code.
 * (The pure parts are covered in shared/play/death-plan.test.ts.)
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import initJolt from "jolt-physics";
import { PHYSICS_STEP } from "../../../web/src/scene/death/physics/fixedStep";
import { PhysicsWorld, type JoltModule } from "../../../web/src/scene/death/physics/PhysicsWorld";
import type { Q4, V3 } from "../../../web/src/scene/death/physics/math";

const TILE = 1.02, ARENA = 4 * TILE + 0.6;
let module: JoltModule | null = null;
export const jolt = async (): Promise<JoltModule> => (module ??= await (initJolt as unknown as () => Promise<JoltModule>)());
const freeMemory = (J: JoltModule) => J.JoltInterface.prototype.sGetFreeMemory();

test("a box dropped on the board lands on it, stops, and sleeps", async () => {
  const J = await jolt();
  const world = new PhysicsWorld(J, { groundY: 0, arena: ARENA });
  const box = world.add({ shape: { kind: "box", half: [0.1, 0.1, 0.1] }, position: [0, 1, 0], rotation: [0, 0, 0, 1], mass: 10 });
  const at: V3 = [0, 0, 0];
  let frames = 0;
  while (!world.asleep(box) && frames < 600) { world.step(PHYSICS_STEP); frames += 1; }
  assert.ok(frames < 240, `asleep after ${frames} steps`);
  world.position(box, at);
  assert.ok(Math.abs(at[1] - 0.1) < 0.02, `resting on the stone, centre at ${at[1]}`);
  assert.ok(Math.hypot(at[0], at[2]) < 0.01);
  world.dispose();
});

test("the world steps by a fixed step whatever the frames were, so the same fall is the same fall", async () => {
  const J = await jolt();
  const run = (deltas: () => number): { at: V3; rotation: Q4; steps: number } => {
    const world = new PhysicsWorld(J, { groundY: 0, arena: ARENA });
    const body = world.add({ shape: { kind: "capsule", halfHeight: 0.2, radius: 0.06 }, position: [0.3, 0.6, -0.2], rotation: [0.3, 0, 0.2, 0.93], mass: 8, velocity: [1.2, 0.5, 0.4], spin: [1, 2, 3] });
    let time = 0;
    while (world.steps < 240) { const delta = deltas(); time += delta; world.step(delta); }
    const out = { at: world.position(body, [0, 0, 0]), rotation: world.rotation(body, [0, 0, 0, 1]), steps: world.steps };
    world.dispose();
    return out;
  };
  const even = run(() => PHYSICS_STEP), again = run(() => PHYSICS_STEP);
  assert.deepEqual(even, again, "bit for bit");
  // 30 fps frames (the capture harness) and ragged ones run the same steps.
  const thirty = run(() => 1 / 30);
  let i = 0; const ragged = run(() => [0.004, 0.021, 0.0167, 0.033, 0.009][i++ % 5]);
  for (const other of [thirty, ragged]) {
    assert.ok(other.steps >= 240 && other.steps <= 243);
    for (let k = 0; k < 3; k += 1) assert.ok(Math.abs(other.at[k] - even.at[k]) < 1e-3, `axis ${k}: ${other.at[k]} against ${even.at[k]}`);
  }
});

test("standing figures are posts and the arena has walls: nothing gets past either", async () => {
  const J = await jolt();
  const world = new PhysicsWorld(J, { groundY: 0, arena: ARENA });
  world.setObstacles([{ x: 1, z: 0, radius: 0.25 }]);
  assert.equal(world.obstacleCount, 1);
  const thrown = world.add({ shape: { kind: "sphere", radius: 0.08 }, position: [0, 0.3, 0], rotation: [0, 0, 0, 1], mass: 5, velocity: [4, 0, 0] });
  const fast = world.add({ shape: { kind: "sphere", radius: 0.08 }, position: [0, 0.3, 2], rotation: [0, 0, 0, 1], mass: 5, velocity: [0, 1, 12] });
  for (let i = 0; i < 600; i += 1) world.step(PHYSICS_STEP);
  const a = world.position(thrown, [0, 0, 0]), b = world.position(fast, [0, 0, 0]);
  assert.ok(Math.hypot(a[0] - 1, a[2]) >= 0.25 + 0.08 - 0.02 && a[0] < 1, `stopped by the post, at ${a}`);
  assert.ok(Math.abs(b[2]) <= ARENA && b[1] > 0, `inside the wall, at ${b}`);
  // New posts replace the old ones.
  world.setObstacles([{ x: -1, z: 0, radius: 0.2 }, { x: -2, z: 0, radius: 0.2 }]);
  assert.equal(world.obstacleCount, 2);
  world.dispose();
});

test("a world gives back everything it took", async () => {
  const J = await jolt();
  const cycle = () => {
    const world = new PhysicsWorld(J, { groundY: 0, arena: ARENA });
    world.setObstacles([{ x: 1, z: 1, radius: 0.25 }, { x: -1, z: 1, radius: 0.25 }]);
    const set = world.partSet(2, [[0, 1]]);
    const a = world.add({ shape: { kind: "box", half: [0.1, 0.1, 0.1] }, position: [0, 0.5, 0], rotation: [0, 0, 0, 1], mass: 10, set, part: 0 });
    const b = world.add({ shape: { kind: "capsule", halfHeight: 0.1, radius: 0.04 }, position: [0, 0.75, 0], rotation: [0, 0, 0, 1], mass: 4, set, part: 1 });
    world.join(a, b, { anchorA: [0, 0.1, 0], twistA: [0, 1, 0], planeA: [1, 0, 0], anchorB: [0, -0.15, 0], twistB: [0, 1, 0], planeB: [1, 0, 0], planeHalfCone: 0.5, normalHalfCone: 0.5, twistMin: -0.2, twistMax: 0.2 });
    for (let i = 0; i < 90; i += 1) world.step(PHYSICS_STEP);
    assert.equal(world.count, 2); assert.equal(world.jointCount, 1);
    world.dispose();
  };
  cycle();
  const before = freeMemory(J);
  for (let i = 0; i < 20; i += 1) cycle();
  assert.equal(freeMemory(J), before, "twenty worlds built and freed leave the heap where it was");
});

// ---------------------------------------------------------------- ragdoll

import { RIGS, loadRig, poseRig, type RigId, type Stand } from "../../../shared/play/death-rig";
import { RAGDOLL_MAX_SECONDS, RagdollSim, TRUNK_LOW, TRUNK_TOUCH, reachBelow } from "../../../web/src/scene/death/ragdoll/RagdollSim";
import { planRagdoll, type RagdollPlan } from "../../../web/src/scene/death/ragdoll/ragdollPlan";
import type { ShapeSpec, Obstacle } from "../../../web/src/scene/death/physics/PhysicsWorld";
import { cross, orthogonal, qConj, qMul, qRotate, sub, unit } from "../../../web/src/scene/death/physics/math";

const thickness = (shape: ShapeSpec) => shape.kind === "box" ? Math.min(...shape.half) : shape.radius;
interface Fall { /** Lowest corner of a held shield at rest, and how far it has come adrift of the forearm holding it. */ shieldLow: number; shieldDrift: number; plan: RagdollPlan; seconds: number; centres: V3[]; joints: { position: V3; rotation: Q4 }[]; highest: number; lowest: number; kneeMax: number; elbowMax: number; firstStep: number; /** The furthest a knee bent forward, and an elbow backward (the sine of the angle past straight): the wrong way for each. */ kneeWrong: number; elbowWrong: number }

/** One whole death: the rig in its hit reaction, struck, and stepped until it lies still. */
function fall(J: JoltModule, id: RigId, blow: { x: number; z: number }, options: { stand?: Stand; posts?: Obstacle[]; power?: number; simpleArms?: boolean; frame?: number; shield?: boolean } = {}): Fall {
  const rig = loadRig(id), stand = options.stand ?? { x: 0, z: 0, yaw: 0 }, frame = options.frame ?? 1 / 60;
  // The pose a sixtieth of a second earlier gives the bodies their starting speed, whatever frames the fall is then stepped in.
  const now = poseRig(rig, "hit.front", 0.2, stand), before = poseRig(rig, "hit.front", 0.2 - 1 / 60, stand);
  const bind = poseRig(rig, null, 0);
  // A round shield on the left forearm, face out: a quarter of a square across and a thumb thick.
  const hand = rig.joints.findIndex(joint => joint.name === "LeftHand"), fore = rig.joints.findIndex(joint => joint.name === "LeftForeArm");
  const held = options.shield ? [{ joint: hand, centre: [0, 1, 2].map(k => (now.positions[hand][k] + now.positions[fore][k]) / 2) as V3, rotation: now.rotations[fore], half: [0.13, 0.13, 0.02] as V3 }] : [];
  const plan = planRagdoll(rig.joints, bind, now, { simpleArms: options.simpleArms, held })!;
  const world = new PhysicsWorld(J, { groundY: 0, arena: ARENA });
  world.setObstacles(options.posts ?? []);
  const sim = new RagdollSim(world, plan, now, before, 1 / 60);
  const chest = plan.parts.findIndex(part => part.name === "chest");
  const part = (name: string) => plan.parts.findIndex(p => p.name === name);
  const bend = (a: number, b: number) => a < 0 || b < 0 ? 0 : Math.acos(Math.min(1, Math.max(-1, qRotate(world.rotation(sim.bodies[a], [0, 0, 0, 1]), [0, 1, 0]).reduce((sum, v, i) => sum + v * qRotate(world.rotation(sim.bodies[b], [0, 0, 0, 1]), [0, 1, 0])[i], 0))));
  // Struck high on the chest, a hand's width to the figure's left of its centre line.
  const at = sim.centre(chest, [0, 0, 0]);
  sim.blow({ direction: blow, point: [at[0] + 0.03, at[1] + 0.03, at[2]], power: options.power ?? 1 });
  // The figure's own front, from its bind pose, carried in the frame of each thigh and upper arm: a knee folds
  // towards the back of its thigh, an elbow towards the front of its upper arm.
  const named = (name: string) => rig.joints.findIndex(joint => joint.name === name);
  const up = unit(sub(bind.positions[named("Head")], bind.positions[named("Hips")])), left = orthogonal(sub(bind.positions[named("LeftUpLeg")], bind.positions[named("RightUpLeg")]), up), front = cross(left, up);
  const hinges = (["L", "R"] as const).flatMap(side => [[`thigh${side}`, `shin${side}`, -1], [`arm${side}`, `foreArm${side}`, 1]] as const).filter(([a, b]) => part(a) >= 0 && part(b) >= 0)
    .map(([a, b, sign]) => {
      // Square to the limb's own line, so a straight limb measures nothing whichever way the bind pose tilts it.
      const frame = qMul(bind.rotations[plan.parts[part(a)].joint], plan.parts[part(a)].frame);
      return { a: part(a), b: part(b), sign, local: qRotate(qConj(frame), orthogonal(front, qRotate(frame, [0, 1, 0]))) };
    });
  let highest = 0, lowest = Infinity, kneeMax = 0, elbowMax = 0, firstStep = 0, steps = 0, kneeWrong = 0, elbowWrong = 0;
  const start = plan.parts.map((_, i) => sim.joint(i).position.slice() as V3);
  while (!sim.atRest) {
    world.step(frame); steps += 1;
    if (steps === 1) firstStep = Math.max(...plan.parts.map((_, i) => Math.hypot(...sim.joint(i).position.map((v, k) => v - start[i][k]))));
    for (let i = 0; i < plan.parts.length; i += 1) { const y = sim.centre(i, [0, 0, 0])[1]; highest = Math.max(highest, y); lowest = Math.min(lowest, y - thickness(plan.parts[i].shape)); }
    for (const side of ["L", "R"]) { kneeMax = Math.max(kneeMax, bend(part(`thigh${side}`), part(`shin${side}`))); elbowMax = Math.max(elbowMax, bend(part(`arm${side}`), part(`foreArm${side}`))); }
    for (const hinge of hinges) {
      const towards = qRotate(world.rotation(sim.bodies[hinge.a], [0, 0, 0, 1]), hinge.local), limb = qRotate(world.rotation(sim.bodies[hinge.b], [0, 0, 0, 1]), [0, 1, 0]);
      const wrong = -hinge.sign * (limb[0] * towards[0] + limb[1] * towards[1] + limb[2] * towards[2]);
      if (hinge.sign < 0) kneeWrong = Math.max(kneeWrong, wrong); else elbowWrong = Math.max(elbowWrong, wrong);
    }
    assert.ok(steps < 2000, "the fall ends");
  }
  let shieldLow = Infinity, shieldDrift = 0;
  plan.parts.forEach((found, index) => {
    if (found.name !== "held" || found.shape.kind !== "box") return;
    const at = sim.centre(index, [0, 0, 0]), turn = world.rotation(sim.bodies[index], [0, 0, 0, 1]), half = found.shape.half;
    for (let c = 0; c < 8; c += 1) shieldLow = Math.min(shieldLow, at[1] + qRotate(turn, [c & 1 ? half[0] : -half[0], c & 2 ? half[1] : -half[1], c & 4 ? half[2] : -half[2]])[1]);
    // Where the weld says it should be: on the joint it hangs from, as the holder's body now carries that joint.
    const holder = found.parent, anchor = qRotate(world.rotation(sim.bodies[holder], [0, 0, 0, 1]), found.link!.anchorA), mine = qRotate(turn, found.link!.anchorB), base = sim.centre(holder, [0, 0, 0]);
    shieldDrift = Math.hypot(base[0] + anchor[0] - at[0] - mine[0], base[1] + anchor[1] - at[1] - mine[1], base[2] + anchor[2] - at[2] - mine[2]);
  });
  const out: Fall = {
    shieldLow, shieldDrift, plan, seconds: sim.age, centres: plan.parts.map((_, i) => sim.centre(i, [0, 0, 0])), highest, lowest, kneeMax, elbowMax, firstStep, kneeWrong, elbowWrong,
    joints: plan.parts.map((_, i) => { const joint = sim.joint(i); return { position: [...joint.position] as V3, rotation: [...joint.rotation] as Q4 }; }),
  };
  sim.release();
  assert.equal(world.count, 0, "the bodies are taken out of the world"); assert.equal(world.jointCount, 0);
  world.dispose();
  return out;
}

for (const id of RIGS) {
  test(`${id}: the ragdoll falls the way the blow pushed it, lies on the board, and comes to rest`, async () => {
    const J = await jolt();
    for (const [name, blow, stand] of [
      ["from the left", { x: 1, z: 0 }, { x: 0, z: 0, yaw: 0 }], ["from the right", { x: -1, z: 0 }, { x: 0, z: 0, yaw: 0 }],
      ["from the front", { x: 0, z: -1 }, { x: 0, z: 0, yaw: 0 }], ["on a far square, turned", { x: 0.6, z: 0.8 }, { x: -3.57, z: 2.55, yaw: 2.4 }],
    ] as const) {
      const result = fall(J, id, blow, { stand });
      assert.ok(result.seconds < RAGDOLL_MAX_SECONDS - 0.05, `${name}: at rest after ${result.seconds.toFixed(2)} s, not stopped by the clock`);
      const pelvis = result.centres[0], l = Math.hypot(blow.x, blow.z);
      const along = ((pelvis[0] - stand.x) * blow.x + (pelvis[2] - stand.z) * blow.z) / l, across = Math.abs((pelvis[0] - stand.x) * blow.z - (pelvis[2] - stand.z) * blow.x) / l;
      assert.ok(along > 0.2 && along < 1.0, `${name}: thrown ${along.toFixed(2)} along the blow`);
      assert.ok(across < along * 0.6, `${name}: ${across.toFixed(2)} off the blow's line`);
      result.centres.forEach((centre, i) => {
        const part = result.plan.parts[i];
        // On the stone: not sunk into it (a centimetre of settling at most) and lying down, not propped up.
        assert.ok(centre[1] >= thickness(part.shape) - 0.012, `${name}: ${part.name} rests at ${centre[1].toFixed(3)}, ${thickness(part.shape).toFixed(3)} thick`);
        assert.ok(centre[1] < 0.24, `${name}: ${part.name} is down (${centre[1].toFixed(2)})`);
        assert.ok(Math.abs(centre[0]) < ARENA && Math.abs(centre[2]) < ARENA, `${name}: ${part.name} is in the arena`);
      });
      assert.ok(result.lowest > -0.035, `${name}: nothing went through the board on the way (${result.lowest.toFixed(3)})`);
      // The handover: one step in, no joint has jumped.
      assert.ok(result.firstStep < 0.05, `${name}: first step moved a joint ${result.firstStep.toFixed(3)}`);
      // Limbs bend like limbs: a knee to about 130 degrees, an elbow to about 140, and no further.
      assert.ok(result.kneeMax < 2.3 + 0.3, `${name}: knee bent ${result.kneeMax.toFixed(2)}`);
      assert.ok(result.elbowMax < 2.4 + 0.3, `${name}: elbow bent ${result.elbowMax.toFixed(2)}`);
      // ...and the right way. No knee folds forward (a few degrees of give at the worst of an impact). An elbow is looser:
      // a forearm that was turned in the pose it died in keeps that turn, which reads here as up to half a radian.
      assert.ok(result.kneeWrong < 0.25, `${name}: a knee bent ${result.kneeWrong.toFixed(2)} forward`);
      assert.ok(result.elbowWrong < 0.6, `${name}: an elbow bent ${result.elbowWrong.toFixed(2)} backward`);
    }
  });
}

test("the same death is the same fall: twice from the same inputs, and at the capture harness's 30 frames a second", async () => {
  const J = await jolt();
  for (const id of ["wp", "kp"] as const) {
    const one = fall(J, id, { x: 0.7, z: -0.7 }), two = fall(J, id, { x: 0.7, z: -0.7 });
    assert.deepEqual(one.joints, two.joints, `${id}: every joint, bit for bit`);
    assert.equal(one.seconds, two.seconds);
    // After another death in between, too: each world starts from nothing.
    fall(J, "bp", { x: -1, z: 0 });
    assert.deepEqual(fall(J, id, { x: 0.7, z: -0.7 }).joints, one.joints);
    assert.notDeepEqual(fall(J, id, { x: -0.7, z: -0.7 }).joints, one.joints, "another blow, another fall");
    // The frame rate does not change it: the world steps the same steps, and rest is judged step by step.
    const thirty = fall(J, id, { x: 0.7, z: -0.7 }, { frame: 1 / 30 }).joints;
    thirty.forEach((joint, i) => { for (let k = 0; k < 3; k += 1) assert.ok(Math.abs(joint.position[k] - one.joints[i].position[k]) < 1e-9, `${id} joint ${i}`); });
  }
});

test("a blow from the left throws the body right, and the reverse", async () => {
  const J = await jolt();
  for (const id of RIGS) {
    const right = fall(J, id, { x: 1, z: 0 }), left = fall(J, id, { x: -1, z: 0 });
    for (const [result, sign] of [[right, 1], [left, -1]] as const) {
      assert.ok(result.centres[0][0] * sign > 0.2, `${id}: pelvis at ${result.centres[0][0].toFixed(2)}`);
      const head = result.centres[result.plan.parts.findIndex(part => part.name === "head")];
      assert.ok(head[0] * sign > 0.3, `${id}: head at ${head[0].toFixed(2)}`);
    }
    // A harder blow carries it further.
    assert.ok(fall(J, id, { x: 1, z: 0 }, { power: 1.6 }).centres[0][0] > right.centres[0][0]);
  }
});

test("a body does not come to rest inside a standing figure or on top of one", async () => {
  const J = await jolt();
  for (const id of RIGS) {
    for (const distance of [0.55, 0.8, 1.02]) {
      const post = { x: distance, z: 0.05, radius: 0.24 };
      const result = fall(J, id, { x: 1, z: 0 }, { posts: [post, { x: 0, z: -1.02, radius: 0.24 }] });
      assert.ok(result.seconds < RAGDOLL_MAX_SECONDS - 0.05, `${id} at ${distance}: at rest after ${result.seconds.toFixed(2)} s`);
      result.centres.forEach((centre, i) => {
        const part = result.plan.parts[i], gap = Math.hypot(centre[0] - post.x, centre[2] - post.z) - post.radius;
        assert.ok(gap > -0.015, `${id} at ${distance}: ${part.name} is ${(-gap).toFixed(3)} inside the figure`);
        assert.ok(centre[1] < 0.5 && centre[1] >= thickness(part.shape) - 0.012, `${id} at ${distance}: ${part.name} at height ${centre[1].toFixed(2)}`);
      });
    }
  }
});

test("a shield rides the arm that holds it and comes to rest on the stone, not in it", async () => {
  const J = await jolt();
  for (const id of ["wp", "bp"] as const) for (const blow of [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: -1 }, { x: 0.5, z: 0.8 }]) {
    const result = fall(J, id, blow, { shield: true });
    assert.equal(result.plan.parts.length, 12); assert.equal(result.plan.parts.at(-1)!.name, "held");
    assert.ok(result.seconds < RAGDOLL_MAX_SECONDS - 0.05, `${id}: at rest after ${result.seconds.toFixed(2)} s`);
    assert.ok(result.shieldLow > -0.015, `${id}: the shield's lowest corner is at ${result.shieldLow.toFixed(3)}`);
    assert.ok(result.shieldDrift < 0.02, `${id}: the shield is ${result.shieldDrift.toFixed(3)} adrift of the hand`);
    result.centres.forEach((centre, i) => assert.ok(centre[1] >= thickness(result.plan.parts[i].shape) - 0.015 && centre[1] < 0.3, `${id}: ${result.plan.parts[i].name} at ${centre[1].toFixed(3)}`));
    // The same fall twice is still the same fall.
    assert.deepEqual(fall(J, id, blow, { shield: true }).joints, result.joints);
  }
});

test("the lowest preset's ragdoll (one body an arm) falls and rests too, and ragdolls leave nothing behind", async () => {
  const J = await jolt();
  fall(J, "wp", { x: 1, z: 0 });
  const before = freeMemory(J);
  for (const id of RIGS) {
    const result = fall(J, id, { x: 0, z: 1 }, { simpleArms: true, frame: 1 / 30 });
    assert.equal(result.plan.parts.length, 9);
    assert.ok(result.seconds < RAGDOLL_MAX_SECONDS - 0.05 && result.centres[0][2] > 0.2);
  }
  assert.equal(freeMemory(J), before, "four deaths later the heap is where it was");
});

test("a ragdoll tells where its trunk first comes down: on the frame it meets the stone, under where it comes to lie", async () => {
  const J = await jolt();
  for (const id of RIGS) for (const blow of [{ x: 0.6, z: -0.8 }, { x: -1, z: 0 }]) {
    const rig = loadRig(id), stand = { x: 0.51, z: -1.53, yaw: 0.7 };
    const now = poseRig(rig, "hit.front", 0.2, stand), before = poseRig(rig, "hit.front", 0.2 - 1 / 60, stand);
    const plan = planRagdoll(rig.joints, poseRig(rig, null, 0), now)!;
    const world = new PhysicsWorld(J, { groundY: 0, arena: ARENA });
    const sim = new RagdollSim(world, plan, now, before, 1 / 60);
    const chest = plan.parts.findIndex(part => part.name === "chest"), at = sim.centre(chest, [0, 0, 0]);
    sim.blow({ direction: blow, point: [at[0] + 0.03, at[1] + 0.03, at[2]], power: 1 });
    const trunk = plan.parts.flatMap((part, i) => part.name === "pelvis" || part.name === "chest" ? [i] : []);
    const lowest = () => Math.min(...trunk.map(i => sim.centre(i, [0, 0, 0])[1] - reachBelow(plan.parts[i].shape, world.rotation(sim.bodies[i], [0, 0, 0, 1]))));
    let down: V3 | null = null, seconds = 0, frames = 0;
    // Stepped at the capture harness's 30 frames a second, and asked once a frame, as the ragdoll system asks.
    while (!sim.atRest) {
      world.step(1 / 30); frames += 1;
      const seen = sim.watchTrunk();
      if (seen && !down) {
        down = [...seen] as V3; seconds = frames / 30;
        assert.ok(lowest() <= TRUNK_TOUCH, `${id}: on the frame it is told, the trunk is on the stone (${lowest().toFixed(3)})`);
      } else if (!seen) assert.ok(lowest() > TRUNK_TOUCH || Math.min(...trunk.map(i => sim.centre(i, [0, 0, 0])[1])) > plan.height * TRUNK_LOW, `${id}: down and not told`);
      if (down) assert.deepEqual(sim.watchTrunk(), down, `${id}: the first contact, every frame after`);
      assert.ok(frames < 400, "the fall ends");
    }
    assert.ok(down, `${id}: the trunk comes down`);
    // It falls first, and is told well before it lies still (a body is at rest only after 0.3 s without moving).
    assert.ok(seconds > 0.2 && seconds < sim.age - 0.3, `${id}: down at ${seconds.toFixed(2)} s of ${sim.age.toFixed(2)}`);
    // On the stone, under the trunk as it comes to lie: a body slides and rolls a little after it lands, no more.
    assert.equal(down![1], 0);
    const near = Math.min(...trunk.map(i => { const c = sim.centre(i, [0, 0, 0]); return Math.hypot(c[0] - down![0], c[2] - down![2]); }));
    assert.ok(near < 0.35, `${id}: told ${near.toFixed(2)} from where its trunk lies`);
    sim.release(); world.dispose();
  }
});

test("a figure of one body is not down while it stands on its base, only once it has toppled", async () => {
  const J = await jolt();
  const height = 0.8;
  const plan: RagdollPlan = { parts: [{ name: "pelvis", joint: 0, parent: -1, shape: { kind: "box", half: [height * 0.2, height * 0.5, height * 0.2] }, mass: 70, centre: [0, height * 0.5, 0], frame: [0, 0, 0, 1], link: null }], apart: [], height };
  const world = new PhysicsWorld(J, { groundY: 0, arena: ARENA });
  const sim = new RagdollSim(world, plan, { positions: [[0, 0, 0]], rotations: [[0, 0, 0, 1]] });
  // Standing on its base it touches the stone, but it is not down.
  world.step(1 / 30);
  assert.equal(sim.watchTrunk(), null);
  sim.blow({ direction: { x: 1, z: 0 }, point: [0, height * 0.7, 0], power: 1 }, true);
  let down: V3 | null = null;
  for (let frames = 0; frames < 300 && !sim.atRest && !down; frames += 1) { world.step(1 / 30); down = sim.watchTrunk(); }
  assert.ok(down, "toppled, it is down");
  assert.ok(sim.centre(0, [0, 0, 0])[1] <= height * TRUNK_LOW, "and lying low");
  assert.ok(down![0] > 0.1, `fallen the way it was pushed (${down![0].toFixed(2)})`);
  sim.release(); world.dispose();
});

// ---------------------------------------------------------------- a body burst apart

import { GIB_MAX_SECONDS, GibSim, type GibBody } from "../../../web/src/scene/death/gibs/GibSim";
import { partBody } from "../../../web/src/scene/death/ragdoll/ragdollPlan";

/** The pieces a real rig bursts into: one box on each part of its body, where the figure stands. */
function piecesOf(id: RigId, stand: Stand): GibBody[] {
  const rig = loadRig(id), now = poseRig(rig, "hit.front", 0.2, stand);
  const plan = planRagdoll(rig.joints, poseRig(rig, null, 0), now)!;
  return plan.parts.map((part, index) => {
    const body = partBody(part, now.positions[part.joint], now.rotations[part.joint]);
    const half: V3 = part.shape.kind === "box" ? part.shape.half : part.shape.kind === "capsule" ? [part.shape.radius, part.shape.halfHeight + part.shape.radius, part.shape.radius] : [part.shape.radius, part.shape.radius, part.shape.radius];
    return { centre: body.position, rotation: body.rotation, half, neighbours: plan.parts.flatMap((other, j) => other.parent === index || part.parent === j ? [j] : []) };
  });
}
function burst(J: JoltModule, id: RigId, stand: Stand, power: number, seed: number, posts: Obstacle[] = [], frame = 1 / 60) {
  const pieces = piecesOf(id, stand), world = new PhysicsWorld(J, { groundY: 0, arena: ARENA });
  world.setObstacles(posts);
  const sim = new GibSim(world, pieces, [stand.x, 0.35, stand.z], power, seed);
  const landed: number[] = [];
  let highest = 0, steps = 0;
  while (!sim.atRest) {
    world.step(frame);
    landed.push(...sim.landings());
    for (let i = 0; i < pieces.length; i += 1) highest = Math.max(highest, sim.position(i, [0, 0, 0])[1]);
    assert.ok((steps += 1) < 3000);
  }
  const out = { pieces, seconds: sim.age, landed, highest, at: pieces.map((_, i) => [...sim.position(i, [0, 0, 0])] as V3), turn: pieces.map((_, i) => [...sim.rotation(i, [0, 0, 0, 1])] as Q4) };
  sim.release();
  assert.equal(world.count, 0);
  world.dispose();
  return out;
}

test("the pieces of a burst fly, land, and all come to rest on the board inside the arena", async () => {
  const J = await jolt();
  for (const id of RIGS) {
    // In the middle of the board, and on a corner square where the walls are a step away.
    for (const stand of [{ x: 0.51, z: -0.51, yaw: 0.6 }, { x: 3.57, z: 3.57, yaw: 2 }, { x: -3.57, z: 0.51, yaw: -1 }]) {
      for (const power of [1, 2]) {
        const result = burst(J, id, stand, power, 99);
        assert.ok(result.seconds < GIB_MAX_SECONDS - 0.05, `${id} power ${power}: settled after ${result.seconds.toFixed(2)} s`);
        assert.ok(result.highest > 0.45, `${id}: thrown up (${result.highest.toFixed(2)})`);
        // Each landing is told once. Thrown this close together, one piece may come down on another and never touch the stone itself.
        assert.equal(new Set(result.landed).size, result.landed.length, "no landing is told twice");
        assert.ok(result.landed.length >= result.pieces.length - 2, `${id}: ${result.landed.length} of ${result.pieces.length} pieces reached the stone`);
        let spread = 0;
        result.at.forEach((at, i) => {
          const piece = result.pieces[i], thin = Math.min(...piece.half), wide = Math.max(...piece.half);
          assert.ok(Math.abs(at[0]) <= ARENA && Math.abs(at[2]) <= ARENA, `${id}: piece ${i} at ${at.map(v => v.toFixed(2))} is in the arena`);
          assert.ok(at[1] >= thin - 0.012 && at[1] <= wide + 0.12, `${id}: piece ${i} lies on the stone or on a piece that does (${at[1].toFixed(3)})`);
          spread = Math.max(spread, Math.hypot(at[0] - stand.x, at[2] - stand.z));
        });
        // Scattered, but about the body: within two and a half squares of where it stood, however big the blast.
        assert.ok(spread > 0.5 && spread < 2.5 * TILE, `${id} power ${power}: scattered ${spread.toFixed(2)} from where it stood`);
      }
    }
  }
});

test("the same burst scatters the same way, another seed another way, and nothing lands inside a standing figure", async () => {
  const J = await jolt(), stand = { x: 0.51, z: 0.51, yaw: 0 };
  const one = burst(J, "bp", stand, 1.5, 4242), two = burst(J, "bp", stand, 1.5, 4242);
  assert.deepEqual(one.at, two.at); assert.deepEqual(one.turn, two.turn);
  assert.notDeepEqual(burst(J, "bp", stand, 1.5, 4243).at, one.at);
  // The capture harness's 30 frames a second ends in the same place.
  const thirty = burst(J, "bp", stand, 1.5, 4242, [], 1 / 30);
  // (One frame of two steps may run a step past the moment of rest: the pieces agree to a hair, not to the bit.)
  thirty.at.forEach((at, i) => { for (let k = 0; k < 3; k += 1) assert.ok(Math.abs(at[k] - one.at[i][k]) < 1e-4, `piece ${i} axis ${k}: ${at[k]} against ${one.at[i][k]}`); });
  assert.equal(thirty.seconds, one.seconds);
  const posts = [{ x: 1.53, z: 0.51, radius: 0.24 }, { x: -0.51, z: 0.51, radius: 0.24 }, { x: 0.51, z: 1.53, radius: 0.24 }, { x: 1.53, z: 1.53, radius: 0.24 }];
  const among = burst(J, "bp", stand, 1.5, 4242, posts);
  among.at.forEach((at, i) => { for (const post of posts) assert.ok(Math.hypot(at[0] - post.x, at[2] - post.z) > post.radius - 0.015, `piece ${i} is inside a figure`); assert.ok(at[1] < 0.3); });
  const before = freeMemory(J);
  burst(J, "kp", stand, 2, 1);
  assert.equal(freeMemory(J), before, "a burst leaves nothing behind");
});

// ---------------------------------------------------------------- every shipped figure

import { loadModelRig } from "../../../shared/play/death-rig";
import { gibPieces } from "../../../web/src/scene/death/gibs/gibPlan";

/** PIECE_HEIGHT in web/src/scene/pieces.ts, which cannot be imported here (it imports three.js from a folder Node cannot resolve it in). */
const HEIGHT: Record<string, number> = { p: 0.78, r: 0.98, n: 1.0, b: 1.04, q: 1.32, k: 1.48 };

test("every figure of Solforiz, Korvenia and Kwind-09 maps to a ragdoll and falls to rest on the board, the tallest King included", async () => {
  const J = await jolt();
  for (const kingdom of ["solforiz", "korvenia", "kwind09"] as const) for (const kind of ["p", "n", "b", "r", "q", "k"]) {
    const rig = loadModelRig(kingdom, kind, HEIGHT[kind] * 0.92, { x: 1.53, z: -0.51, yaw: 0.9 });
    const plan = planRagdoll(rig.joints, rig.bind, rig.rest);
    assert.ok(plan, `${kingdom} ${kind}: mapped`);
    assert.equal(plan.parts.length, 11, `${kingdom} ${kind}`);
    assert.equal(gibPieces(rig.joints, 2)?.names.length, 11, `${kingdom} ${kind}: the bones are shared between eleven pieces`);
    assert.ok(Math.abs(plan.height - HEIGHT[kind]) < HEIGHT[kind] * 0.3, `${kingdom} ${kind}: sized ${plan.height.toFixed(2)} for a figure ${HEIGHT[kind]} tall`);
    const world = new PhysicsWorld(J, { groundY: 0, arena: ARENA });
    const sim = new RagdollSim(world, plan, rig.rest);
    const chest = sim.centre(plan.parts.findIndex(part => part.name === "chest"), [0, 0, 0]);
    sim.blow({ direction: { x: -0.4, z: 1 }, point: chest, power: 1 });
    for (let steps = 0; !sim.atRest; steps += 1) { world.step(PHYSICS_STEP); assert.ok(steps < 2000); }
    assert.ok(sim.age < RAGDOLL_MAX_SECONDS - 0.05, `${kingdom} ${kind}: at rest after ${sim.age.toFixed(2)} s`);
    plan.parts.forEach((part, index) => {
      const at = sim.centre(index, [0, 0, 0]);
      assert.ok(at[1] >= thickness(part.shape) - 0.015 && at[1] < HEIGHT[kind] * 0.35, `${kingdom} ${kind}: ${part.name} lies at ${at[1].toFixed(3)}`);
      assert.ok(Math.abs(at[0]) < ARENA && Math.abs(at[2]) < ARENA);
    });
    const pelvis = sim.centre(0, [0, 0, 0]);
    assert.ok((pelvis[0] - 1.53) * -0.4 + (pelvis[2] + 0.51) * 1 > 0.15, `${kingdom} ${kind}: fell with the blow`);
    sim.release(); world.dispose();
  }
});

// ---------------------------------------------------------------- a severed limb (death/sever)

import { SEVER_MAX_SECONDS, SeverSim, type SeverBody } from "../../../web/src/scene/death/sever/SeverSim";
import { AVOID, avoidSeconds, limbLaunch, limbSegment, ragdollParts, severableLimbs, type SeverLimb } from "../../../web/src/scene/death/sever/severPlan";
import { length as span, qFromAxis } from "../../../web/src/scene/death/physics/math";

test("a ghost meets nothing, not a body and not the stone, until it is made solid; then it lands and stops", async () => {
  const J = await jolt();
  const world = new PhysicsWorld(J, { groundY: 0, arena: ARENA });
  const block = world.add({ shape: { kind: "box", half: [0.2, 0.2, 0.2] }, position: [0, 0.2, 0], rotation: [0, 0, 0, 1], mass: 40 });
  const ghost = world.add({ shape: { kind: "box", half: [0.04, 0.04, 0.04] }, position: [0, 0.8, 0], rotation: [0, 0, 0, 1], mass: 2, velocity: [0, -2, 0], ghost: true });
  assert.ok(world.isGhost(ghost) && !world.isGhost(block));
  for (let i = 0; i < 30; i += 1) world.step(PHYSICS_STEP);
  const before = world.position(block, [0, 0, 0]);
  for (let i = 0; i < 30; i += 1) world.step(PHYSICS_STEP);
  assert.ok(world.position(ghost, [0, 0, 0])[1] < -0.5, "through the block and through the board");
  const after = world.position(block, [0, 0, 0]);
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]) < 1e-3, "and the block felt nothing");
  world.dispose();
  const clear = new PhysicsWorld(J, { groundY: 0, arena: ARENA });
  const piece = clear.add({ shape: { kind: "box", half: [0.04, 0.1, 0.04] }, position: [0.5, 0.6, 0], rotation: [0, 0, 0, 1], mass: 2, velocity: [0.5, 1, 0], ghost: true });
  for (let i = 0; i < 6; i += 1) clear.step(PHYSICS_STEP);
  clear.solidify(piece);
  assert.ok(!clear.isGhost(piece));
  for (let i = 0; i < 600 && !clear.asleep(piece); i += 1) clear.step(PHYSICS_STEP);
  const rest = clear.position(piece, [0, 0, 0]);
  assert.ok(rest[1] > 0.03 && rest[1] < 0.12, `on the stone at ${rest[1].toFixed(3)}`);
  clear.dispose();
});

/** A real rig's limb as a box on its bone, the rig standing in its hit reaction, thrown as the plan throws it. */
function limbOf(id: RigId, limb: SeverLimb, stand: Stand, seed: number, direction: V3): { body: SeverBody; now: ReturnType<typeof poseRig> } {
  const rig = loadRig(id), now = poseRig(rig, "hit.front", 0.2, stand);
  const bone = severableLimbs(rig.joints).find(found => found.limb === limb)!;
  const [a, b] = limbSegment(bone, now), axis = sub(b, a);
  const { velocity, spin } = limbLaunch(direction, 1, seed, 0, limb);
  return { body: { centre: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], rotation: qFromAxis(unit(axis)), half: [0.035, span(axis) / 2 + 0.03, 0.035], velocity, spin }, now };
}

/** A whole sever: the body falls as a ragdoll without the limb, struck along the blow, and the limb is thrown out of it. */
function severFall(J: JoltModule, id: RigId, limb: SeverLimb, stand: Stand, seed: number, direction: V3, frame = 1 / 60) {
  const rig = loadRig(id), { body, now } = limbOf(id, limb, stand, seed, direction);
  const plan = planRagdoll(rig.joints, poseRig(rig, null, 0), now, { without: ragdollParts(limb) })!;
  const world = new PhysicsWorld(J, { groundY: 0, arena: ARENA });
  const ragdoll = new RagdollSim(world, plan, now);
  ragdoll.blow({ direction: { x: direction[0], z: direction[2] }, point: body.centre, power: 1 });
  const sim = new SeverSim(world, [body]);
  const g = 9.81 / 2.25, start = [...body.velocity];
  let steps = 0, ballistic = 0, solidAt = -1;
  const landed: number[] = [];
  while (!sim.atRest || !ragdoll.atRest) {
    world.step(frame); steps += Math.round(frame / PHYSICS_STEP);
    const t = steps * PHYSICS_STEP;
    // In its avoidance phase nothing touches it: it falls as a thrown thing falls, whatever it passes through.
    if (!sim.isSolid(0)) ballistic = Math.max(ballistic, Math.abs(world.velocity(sim.bodies[0], [0, 0, 0])[1] - (start[1] - g * t)));
    else if (solidAt < 0) solidAt = t;
    landed.push(...sim.landings());
    assert.ok(steps < 3000, "the fall ends");
  }
  const out = { avoid: sim.avoid[0], solidAt, ballistic, landed, seconds: sim.age, at: sim.position(0, [0, 0, 0]), turn: sim.rotation(0, [0, 0, 0, 1]), half: body.half, parts: plan.parts.length };
  sim.release(); ragdoll.release();
  assert.equal(world.count, 0);
  world.dispose();
  return out;
}

test("a severed limb collides with nothing for its avoidance phase, then lands on the board, settles and sleeps", async () => {
  const J = await jolt();
  for (const id of RIGS) for (const [limb, direction, stand] of [
    ["armR", [1, 0, 0], { x: 0, z: 0, yaw: 0 }], ["head", [0, 0, -1], { x: 0.51, z: -0.51, yaw: 0.6 }], ["foreArmL", [-0.6, 0, 0.8], { x: 3.57, z: 3.57, yaw: 2 }], ["shinL", [0.7, 0, -0.7], { x: -3.57, z: 0.51, yaw: -1 }],
  ] as const) {
    const result = severFall(J, id, limb, stand, 41, [...direction] as V3);
    assert.ok(result.parts < 11, `${id} ${limb}: the ragdoll has no body for it`);
    // The phase lasts as long as the plan says, at least one step, and ends no later than the stone.
    assert.ok(result.avoid >= PHYSICS_STEP && result.avoid <= AVOID.max && Math.abs(result.avoid - avoidSeconds(Math.hypot(...limbLaunch([...direction] as V3, 1, 41, 0, limb).velocity))) < 1e-12);
    assert.ok(result.solidAt > 0 && result.solidAt <= result.avoid + PHYSICS_STEP + 1e-9, `${id} ${limb}: solid at ${result.solidAt}`);
    assert.ok(result.ballistic < 0.03, `${id} ${limb}: nothing touched it in its flight (${result.ballistic.toFixed(3)} off a free fall)`);
    assert.ok(result.seconds < SEVER_MAX_SECONDS - 0.05, `${id} ${limb}: at rest after ${result.seconds.toFixed(2)} s, not stopped by the clock`);
    assert.deepEqual(result.landed, [0], `${id} ${limb}: its landing is told once`);
    const thin = Math.min(...result.half), wide = Math.max(...result.half);
    assert.ok(result.at[1] >= thin - 0.012 && result.at[1] <= wide + 0.15, `${id} ${limb}: lies on the stone (${result.at[1].toFixed(3)})`);
    assert.ok(Math.abs(result.at[0]) <= ARENA && Math.abs(result.at[2]) <= ARENA, `${id} ${limb}: in the arena`);
    assert.ok(Math.hypot(result.at[0] - stand.x, result.at[2] - stand.z) < 2.5 * TILE, `${id} ${limb}: about the body`);
  }
});

test("the same sever is the same flight, at the capture harness's 30 frames a second too, and leaves nothing behind", async () => {
  const J = await jolt(), stand = { x: 0.51, z: 0.51, yaw: 0.3 };
  const one = severFall(J, "wp", "armL", stand, 7, [1, 0, 0.2]), two = severFall(J, "wp", "armL", stand, 7, [1, 0, 0.2]);
  assert.deepEqual(one.at, two.at); assert.deepEqual(one.turn, two.turn);
  assert.notDeepEqual(severFall(J, "wp", "armL", stand, 8, [1, 0, 0.2]).at, one.at, "another kill, another flight");
  const thirty = severFall(J, "wp", "armL", stand, 7, [1, 0, 0.2], 1 / 30);
  for (let k = 0; k < 3; k += 1) assert.ok(Math.abs(thirty.at[k] - one.at[k]) < 1e-4, `axis ${k}: ${thirty.at[k]} against ${one.at[k]}`);
  const before = freeMemory(J);
  severFall(J, "kp", "head", stand, 3, [0, 0, 1]);
  assert.equal(freeMemory(J), before, "a sever leaves the heap where it was");
});

test("a limb and the weapon its hand held never collide with each other", async () => {
  const J = await jolt(), world = new PhysicsWorld(J, { groundY: 0, arena: ARENA });
  // Two boxes in one place, thrown alike: had they met they would have been flung apart.
  const piece: SeverBody = { centre: [0.2, 0.5, 0], rotation: [0, 0, 0, 1], half: [0.04, 0.12, 0.04], velocity: [1, 1.2, 0], spin: [0, 0, 0] };
  const sim = new SeverSim(world, [piece, { ...piece, mass: 2 }]);
  for (let steps = 0; !sim.atRest && steps < 3000; steps += 1) world.step(PHYSICS_STEP);
  const a = sim.position(0, [0, 0, 0]), b = sim.position(1, [0, 0, 0]);
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.03, `they lie together (${a.map(v => v.toFixed(3))} and ${b.map(v => v.toFixed(3))})`);
  sim.release(); world.dispose();
});

/**
 * The pure half of the death physics (web/src/scene/death): the fixed-step
 * clock, the ragdoll planned from each kingdom's real skeleton, and the
 * blow. The half that needs Jolt is in main game/src/play/death-physics.test.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { FixedStep, PHYSICS_MAX_STEPS, PHYSICS_STEP } from "../../web/src/scene/death/physics/fixedStep";
import { length, qRotate, sub, type V3 } from "../../web/src/scene/death/physics/math";
import { BLOW, blowVelocity, mapRig, measureGirth, partBody, partJoint, partOwners, planRagdoll } from "../../web/src/scene/death/ragdoll/ragdollPlan";
import { RIGS, loadRig, poseRig } from "./death-rig";

test("the physics clock pays out whole steps, whatever the frames were", () => {
  const clock = new FixedStep();
  assert.equal(clock.advance(PHYSICS_STEP), 1);
  assert.equal(clock.advance(1 / 30), 2, "a 30 fps frame is two steps, never one");
  assert.equal(clock.advance(0.004), 0);
  assert.equal(clock.advance(0.004) + clock.advance(0.004) + clock.advance(0.005), 1, "short frames add up");
  // The same total time is the same number of steps, however it was cut.
  const steps = (frame: number, frames: number) => { const c = new FixedStep(); let n = 0; for (let i = 0; i < frames; i += 1) n += c.advance(frame); return n; };
  assert.equal(steps(1 / 60, 120), 120); assert.equal(steps(1 / 30, 60), 120); assert.equal(steps(1 / 120, 240), 120); assert.equal(steps(1 / 144, 288), 120);
  // A stalled frame is not caught up: the fall slows, the frame does not.
  const stalled = new FixedStep();
  assert.equal(stalled.advance(1), PHYSICS_MAX_STEPS);
  assert.equal(stalled.remainder, 0);
  for (const bad of [0, -1, NaN, Infinity]) assert.equal(stalled.advance(bad), 0);
  stalled.advance(0.01); stalled.reset();
  assert.equal(stalled.remainder, 0);
});

for (const id of RIGS) {
  test(`${id}: the ragdoll is planned from the kingdom's own skeleton`, () => {
    const rig = loadRig(id), bind = poseRig(rig, null, 0), now = poseRig(rig, "hit.front", 0.2, { x: 1.53, z: -0.51, yaw: 2.2 });
    const { key, spine } = mapRig(rig.joints);
    const named = (index: number | undefined) => index === undefined ? null : rig.joints[index].name;
    assert.equal(named(key.hips), "Hips"); assert.equal(named(key.head), "Head"); assert.equal(named(key.neck), "neck");
    assert.deepEqual(spine.map(named), ["Spine02", "Spine01", "Spine"], "the spine from the pelvis up");
    for (const side of ["L", "R"] as const) {
      const word = side === "L" ? "Left" : "Right";
      assert.deepEqual([key[`arm${side}`], key[`foreArm${side}`], key[`hand${side}`], key[`upLeg${side}`], key[`leg${side}`], key[`foot${side}`]].map(named),
        [`${word}Arm`, `${word}ForeArm`, `${word}Hand`, `${word}UpLeg`, `${word}Leg`, `${word}Foot`]);
    }
    const plan = planRagdoll(rig.joints, bind, now);
    assert.ok(plan, "mapped");
    assert.deepEqual(plan.parts.map(part => part.name), ["pelvis", "chest", "head", "armL", "foreArmL", "thighL", "shinL", "armR", "foreArmR", "thighR", "shinR"]);
    assert.equal(plan.parts.filter(part => part.link).length, 10, "ten joints for eleven bodies");
    // Sized to the figure: a Pawn stands about 0.7 of a square.
    assert.ok(plan.height > 0.55 && plan.height < 0.85, `height ${plan.height}`);
    const mass = plan.parts.reduce((sum, part) => sum + part.mass, 0);
    assert.ok(mass > 65 && mass < 85, `${mass} kg`);
    for (const part of plan.parts) {
      // The body sits on its joint: reading the joint back from the body gives the pose it was made from, so the handover cannot pop.
      const body = partBody(part, now.positions[part.joint], now.rotations[part.joint]), back = partJoint(part, body.position, body.rotation);
      assert.ok(length(sub(back.position, now.positions[part.joint])) < 1e-9, part.name);
      for (let i = 0; i < 4; i += 1) assert.ok(Math.abs(back.rotation[i] - now.rotations[part.joint][i]) < 1e-9, part.name);
      // Every body starts above the stone and within the figure.
      assert.ok(body.position[1] > 0.02 && body.position[1] < 0.8, `${part.name} at ${body.position[1]}`);
      assert.ok(Math.hypot(body.position[0] - 1.53, body.position[2] + 0.51) < 0.45, part.name);
      if (!part.link) continue;
      // The joint's two anchors are the same world point: the child's own joint.
      const parent = plan.parts[part.parent], other = partBody(parent, now.positions[parent.joint], now.rotations[parent.joint]);
      const a: V3 = [0, 0, 0].map((_, i) => other.position[i] + qRotate(other.rotation, part.link!.anchorA)[i]) as V3;
      const b: V3 = [0, 0, 0].map((_, i) => body.position[i] + qRotate(body.rotation, part.link!.anchorB)[i]) as V3;
      assert.ok(length(sub(a, b)) < 1e-9 && length(sub(a, now.positions[part.joint])) < 1e-9, `${part.name} anchors`);
      for (const axis of [part.link.twistA, part.link.planeA, part.link.twistB, part.link.planeB]) assert.ok(Math.abs(length(axis) - 1) < 1e-6, `${part.name} axes are unit`);
      assert.ok(Math.abs(part.link.twistA[0] * part.link.planeA[0] + part.link.twistA[1] * part.link.planeA[1] + part.link.twistA[2] * part.link.planeA[2]) < 1e-6);
    }
    // Neighbours pass through each other, and arms through the trunk; the two shins still collide.
    const apart = new Set(plan.apart.map(([a, b]) => `${plan.parts[a].name}-${plan.parts[b].name}`));
    for (const pair of ["pelvis-chest", "chest-head", "chest-armL", "armL-foreArmL", "pelvis-thighL", "thighL-shinL", "thighL-thighR", "chest-foreArmR"]) assert.ok(apart.has(pair), pair);
    assert.ok(!apart.has("shinL-shinR") && !apart.has("chest-shinL"));
    // The same pose plans the same ragdoll, standing anywhere and facing anywhere.
    assert.deepEqual(planRagdoll(rig.joints, bind, now), plan);
    const elsewhere = planRagdoll(rig.joints, bind, poseRig(rig, "hit.front", 0.2, { x: -3, z: 2, yaw: -1 }))!;
    plan.parts.forEach((part, i) => { for (let k = 0; k < 3; k += 1) assert.ok(Math.abs(part.centre[k] - elsewhere.parts[i].centre[k]) < 1e-6, part.name); });
    // The lowest preset: one body an arm.
    const simple = planRagdoll(rig.joints, bind, now, { simpleArms: true })!;
    assert.deepEqual(simple.parts.map(part => part.name), ["pelvis", "chest", "head", "armL", "thighL", "shinL", "armR", "thighR", "shinR"]);
    // A measured girth is used, within reason.
    const measured = planRagdoll(rig.joints, bind, now, { girth: { thighL: 0.05, shinL: 5 } })!;
    const radius = (name: string, from = measured) => { const shape = from.parts.find(part => part.name === name)!.shape; return shape.kind === "capsule" ? shape.radius : 0; };
    assert.equal(radius("thighL"), 0.05);
    assert.ok(radius("shinL") < radius("shinL", plan) * 2, "a wild measurement is reined in");
  });
}

test("each bone goes with the part that carries it, and a part's thickness is measured off the skin", () => {
  const rig = loadRig("ep"), bind = poseRig(rig, null, 0), now = poseRig(rig, "hit.front", 0.2);
  const plan = planRagdoll(rig.joints, bind, now)!, owners = partOwners(rig.joints, plan);
  const part = (joint: string) => plan.parts[owners[rig.joints.findIndex(found => found.name === joint)]].name;
  for (const [joint, name] of [["Hips", "pelvis"], ["Spine02", "pelvis"], ["Spine01", "chest"], ["Spine", "chest"], ["LeftShoulder", "chest"], ["neck", "chest"], ["Head", "head"], ["head_end", "head"],
    ["LeftArm", "armL"], ["LeftForeArm", "foreArmL"], ["LeftHand", "foreArmL"], ["RightUpLeg", "thighR"], ["RightLeg", "shinR"], ["RightFoot", "shinR"], ["RightToeBase", "shinR"], ["Armature", "pelvis"]]) assert.equal(part(joint), name, joint);
  // Points on a ring 0.05 out from each limb (and on the ellipse a box encloses): that is the radius measured.
  const samples: { joint: number; x: number; y: number; z: number }[] = [];
  plan.parts.forEach(found => {
    const body = partBody(found, now.positions[found.joint], now.rotations[found.joint]);
    for (let i = 0; i < 24; i += 1) {
      const angle = i / 24 * Math.PI * 2, wide = found.shape.kind === "box" ? [1.25, 0.85] : [1, 1];
      const at = qRotate(body.rotation, [Math.cos(angle) * 0.05 * wide[0], (i % 3 - 1) * 0.005, Math.sin(angle) * 0.05 * wide[1]]);
      samples.push({ joint: found.joint, x: body.position[0] + at[0], y: body.position[1] + at[1], z: body.position[2] + at[2] });
    }
  });
  const girth = measureGirth(plan, owners, now, samples);
  for (const found of plan.parts) assert.ok(Math.abs(girth[found.name]! - 0.05) < 1e-6, `${found.name}: ${girth[found.name]}`);
  // Too few points on a part to trust: it keeps its built-in proportion.
  assert.deepEqual(measureGirth(plan, owners, now, samples.slice(0, 5)), {});
  // Points past the ends of a limb (a hand, a foot) do not thicken it.
  const shin = plan.parts.findIndex(found => found.name === "shinL"), body = partBody(plan.parts[shin], now.positions[plan.parts[shin].joint], now.rotations[plan.parts[shin].joint]);
  const beyond = Array.from({ length: 30 }, (_, i) => { const at = qRotate(body.rotation, [0.2, -0.3 - i * 0.01, 0]); return { joint: plan.parts[shin].joint, x: body.position[0] + at[0], y: body.position[1] + at[1], z: body.position[2] + at[2] }; });
  assert.equal(measureGirth(plan, owners, now, beyond).shinL, undefined);
});

test("a skeleton that cannot be mapped gets no plan", () => {
  const rig = loadRig("wp"), bind = poseRig(rig, null, 0);
  const legless = rig.joints.map(joint => ({ ...joint, name: joint.name.replace("UpLeg", "Wheel") }));
  assert.equal(planRagdoll(legless, bind, bind), null);
  assert.equal(planRagdoll([{ name: "root", parent: -1 }], { positions: [[0, 0, 0]], rotations: [[0, 0, 0, 1]] }, { positions: [[0, 0, 0]], rotations: [[0, 0, 0, 1]] }), null);
  // Other riggers' names for the same joints are understood.
  const renamed = rig.joints.map(joint => ({ ...joint, name: joint.name.replace(/^Left(.+)$/, "mixamorig:Left$1").replace("Hips", "pelvis").replace(/^Right(UpLeg|Leg|Arm|ForeArm|Foot|Hand)$/, (_, limb: string) => `${({ UpLeg: "thigh", Leg: "calf", Arm: "upperarm", ForeArm: "lowerarm", Foot: "foot", Hand: "hand" } as Record<string, string>)[limb]}_r`) }));
  assert.equal(planRagdoll(renamed, bind, bind)?.parts.length, 11);
});

test("the blow throws the body the way it travels, the head most and the feet least", () => {
  const head = blowVelocity({ direction: { x: 3, z: 0 }, point: [0, 0, 0], power: 1 }, 1), feet = blowVelocity({ direction: { x: 3, z: 0 }, point: [0, 0, 0], power: 1 }, 0);
  assert.ok(Math.abs(head[0] - BLOW.carry) < 1e-9 && head[2] === 0 && head[1] > 0);
  assert.ok(feet[0] > 0 && feet[0] < head[0] * 0.5, "it pivots over its feet");
  const hard = blowVelocity({ direction: { x: 0, z: -1 }, point: [0, 0, 0], power: 1.6 }, 1);
  assert.ok(hard[2] < -BLOW.carry * 1.5 && hard[0] === 0, "a harder blow throws further");
  // Power is bounded, and a blow with no direction still goes somewhere, the same way every time.
  assert.deepEqual(blowVelocity({ direction: { x: 1, z: 0 }, point: [0, 0, 0], power: 99 }, 1), blowVelocity({ direction: { x: 1, z: 0 }, point: [0, 0, 0], power: 2 }, 1));
  assert.deepEqual(blowVelocity({ direction: { x: 0, z: 0 }, point: [0, 0, 0], power: 1 }, 1), blowVelocity({ direction: { x: 0, z: 0 }, point: [0, 0, 0], power: 1 }, 1));
});

// ---------------------------------------------------------------- a body burst apart

import { BURST, GIB_BUDGET, GIB_SLABS, burstVelocity, fitBox, gibPieces, intoFrame, slabOwners, splitSkin, type GibGeometry } from "../../web/src/scene/death/gibs/gibPlan";
import { QUALITY_ORDER } from "../../web/src/scene/quality";

for (const id of RIGS) {
  test(`${id}: the bones are shared out between the pieces of a burst, fewer on the lower presets`, () => {
    const rig = loadRig(id), named = (pieces: NonNullable<ReturnType<typeof gibPieces>>, joint: string) => pieces.names[pieces.owner[rig.joints.findIndex(found => found.name === joint)]];
    const low = gibPieces(rig.joints, 0)!, medium = gibPieces(rig.joints, 1)!, high = gibPieces(rig.joints, 2)!;
    assert.deepEqual(low.names, ["trunk", "head", "armL", "legL", "armR", "legR"]);
    assert.equal(medium.names.length, 8); assert.equal(high.names.length, 11);
    for (const [joint, piece] of [["Hips", "trunk"], ["Spine", "trunk"], ["LeftShoulder", "trunk"], ["neck", "head"], ["head_end", "head"], ["LeftHand", "armL"], ["RightForeArm", "armR"], ["LeftFoot", "legL"], ["RightToeBase", "legR"]]) assert.equal(named(low, joint), piece, joint);
    assert.equal(named(medium, "LeftFoot"), "shinL"); assert.equal(named(medium, "LeftUpLeg"), "legL"); assert.equal(named(medium, "LeftHand"), "armL");
    for (const [joint, piece] of [["Hips", "pelvis"], ["Spine02", "pelvis"], ["Spine01", "chest"], ["RightShoulder", "chest"], ["RightHand", "foreArmR"], ["RightArm", "armR"], ["neck", "head"]]) assert.equal(named(high, joint), piece, joint);
    // Each piece keeps the frame of the joint it starts at.
    high.root.forEach((joint, piece) => assert.equal(high.owner[joint], piece));
  });
}

test("the presets bound a burst: 6, 8 and 11 pieces, and blood at a few landings", () => {
  assert.deepEqual(QUALITY_ORDER.map(preset => GIB_BUDGET[preset].level), [0, 1, 2, 2]);
  assert.deepEqual(QUALITY_ORDER.map(preset => GIB_BUDGET[preset].landings), [2, 3, 4, 4]);
  assert.ok(!GIB_BUDGET.low.props && !GIB_BUDGET.medium.props && GIB_BUDGET.high.props);
  assert.equal(gibPieces([{ name: "root", parent: -1 }, { name: "wheel", parent: 0 }], 2), null, "a skeleton with no limbs to tell apart");
});

/** A closed tube along y, as a skinned limb would be: rings of `around` points, both ends closed, and one column doubled as at a UV seam. */
function tube(rings = 9, around = 8): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; index: Uint32Array } {
  const P: number[] = [], N: number[] = [], U: number[] = [], index: number[] = [];
  for (let r = 0; r < rings; r += 1) for (let a = 0; a <= around; a += 1) {
    const angle = a / around * Math.PI * 2;
    P.push(Math.cos(angle) * 0.05, r * 0.1, Math.sin(angle) * 0.05); N.push(Math.cos(angle), 0, Math.sin(angle)); U.push(a / around, r / (rings - 1));
  }
  const at = (r: number, a: number) => r * (around + 1) + a;
  for (let r = 0; r + 1 < rings; r += 1) for (let a = 0; a < around; a += 1) index.push(at(r, a), at(r + 1, a), at(r, a + 1), at(r, a + 1), at(r + 1, a), at(r + 1, a + 1));
  for (const [r, y, flip] of [[0, -1, false], [rings - 1, 1, true]] as const) {
    const hub = P.length / 3; P.push(0, r * 0.1, 0); N.push(0, y, 0); U.push(0.5, 0.5);
    for (let a = 0; a < around; a += 1) index.push(...(flip ? [at(r, a), hub, at(r, a + 1)] : [at(r, a), at(r, a + 1), hub]));
  }
  return { positions: Float32Array.from(P), normals: Float32Array.from(N), uvs: Float32Array.from(U), index: Uint32Array.from(index) };
}
/** Edges of a piece that belong to one triangle only, with its points matched by position: none, if the piece is closed. */
function openEdges(piece: GibGeometry): number {
  const key = (i: number) => `${Math.round(piece.positions[i * 3] * 1e4)},${Math.round(piece.positions[i * 3 + 1] * 1e4)},${Math.round(piece.positions[i * 3 + 2] * 1e4)}`;
  const count = new Map<string, number>();
  for (let t = 0; t < piece.index.length; t += 3) for (let k = 0; k < 3; k += 1) {
    const a = key(piece.index[t + k]), b = key(piece.index[t + (k + 1) % 3]), id = a < b ? `${a}|${b}` : `${b}|${a}`;
    count.set(id, (count.get(id) ?? 0) + 1);
  }
  return [...count.values()].filter(times => times !== 2).length;
}

test("a skin is cut into its pieces and every cut is closed", () => {
  const skin = tube();
  assert.equal(openEdges({ piece: 0, ...skin, skin: skin.index.length, cap: 0, neighbours: [] }), 0, "the tube itself is closed");
  // Three pieces along it: by the height of each vertex, as bones would own them.
  const owner = Uint8Array.from({ length: skin.positions.length / 3 }, (_, v) => skin.positions[v * 3 + 1] < 0.25 ? 0 : skin.positions[v * 3 + 1] < 0.55 ? 1 : 2);
  const pieces = splitSkin({ ...skin, owner }, 3);
  assert.equal(pieces.length, 3);
  assert.equal(pieces.reduce((sum, piece) => sum + piece.skin, 0), skin.index.length, "every triangle of the skin is in exactly one piece");
  assert.deepEqual(pieces.map(piece => piece.neighbours), [[1], [0, 2], [1]]);
  for (const piece of pieces) {
    assert.equal(openEdges(piece), 0, `piece ${piece.piece} is closed: nothing to look into`);
    assert.ok(piece.cap > 0 && piece.cap % 3 === 0);
    assert.equal(piece.positions.length, piece.normals.length); assert.equal(piece.uvs!.length / 2, piece.positions.length / 3);
    // Each cap faces out of its cut: away from the middle of the piece.
    let y = 0; for (let i = 1; i < piece.positions.length; i += 3) y += piece.positions[i]; y /= piece.positions.length / 3;
    for (let i = piece.skin; i < piece.index.length; i += 1) { const v = piece.index[i]; assert.ok(piece.normals[v * 3 + 1] * (piece.positions[v * 3 + 1] - y) > 0, "cap normal"); }
  }
  // The middle piece is capped at both ends, the end pieces once.
  assert.equal(pieces[1].cap, pieces[0].cap * 2);
  // The same skin without an index (three vertices a triangle) cuts the same way.
  const flat = { positions: new Float32Array(skin.index.length * 3), normals: new Float32Array(skin.index.length * 3), uvs: null, index: null, owner: new Uint8Array(skin.index.length) };
  skin.index.forEach((v, i) => { for (let k = 0; k < 3; k += 1) { flat.positions[i * 3 + k] = skin.positions[v * 3 + k]; flat.normals[i * 3 + k] = skin.normals[v * 3 + k]; } flat.owner[i] = owner[v]; });
  const unindexed = splitSkin(flat, 3);
  assert.deepEqual(unindexed.map(piece => [piece.skin, piece.cap, openEdges(piece)]), pieces.map(piece => [piece.skin, piece.cap, 0]));
  // A piece that owns nothing is not made.
  assert.equal(splitSkin({ ...skin, owner: new Uint8Array(skin.positions.length / 3) }, 3).length, 1);
  // A figure with no skeleton is cut across its height.
  const slabs = slabOwners(skin.positions, GIB_SLABS);
  assert.deepEqual([...new Set(slabs)].sort(), [0, 1, 2, 3]);
  for (const piece of splitSkin({ ...skin, owner: slabs }, GIB_SLABS)) assert.equal(openEdges(piece), 0);
});

test("a piece's box holds it, and the piece is baked into the box's frame", () => {
  const skin = tube(), turned: [number, number, number, number] = [0, 0, Math.sin(0.4), Math.cos(0.4)];
  const box = fitBox([skin.positions], [0, 0, 0, 1]);
  for (let k = 0; k < 3; k += 1) assert.ok(Math.abs(box.centre[k] - [0, 0.4, 0][k]) < 1e-6 && Math.abs(box.half[k] - [0.05, 0.4, 0.05][k]) < 1e-6);
  const tilted = fitBox([skin.positions], turned);
  const positions = skin.positions.slice(), normals = skin.normals.slice();
  intoFrame(positions, normals, tilted.centre, turned);
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k += 1) assert.ok(Math.abs(positions[i + k]) <= tilted.half[k] + 1e-6);
  assert.ok(Math.abs(Math.hypot(normals[0], normals[1], normals[2]) - 1) < 1e-6);
  assert.deepEqual(fitBox([], [0, 0, 0, 1]).half, [0.01, 0.01, 0.01]);
});

test("a burst throws its pieces out from the blast, the same way for the same seed, and never too fast to stay in the arena", () => {
  const blast: [number, number, number] = [0, 0.4, 0];
  for (let index = 0; index < 11; index += 1) {
    const centre: [number, number, number] = [Math.cos(index) * 0.2, 0.2 + index * 0.04, Math.sin(index) * 0.2];
    const one = burstVelocity(centre, blast, 1, 0.4, 7, index);
    assert.deepEqual(burstVelocity(centre, blast, 1, 0.4, 7, index), one);
    assert.notDeepEqual(burstVelocity(centre, blast, 1, 0.4, 8, index), one);
    assert.ok(one.velocity[0] * centre[0] + one.velocity[2] * centre[2] > 0, "away from the blast");
    assert.ok(one.velocity[1] > 0.7, "and up");
    for (const power of [0.1, 1, 2, 50]) assert.ok(length(burstVelocity(centre, blast, power, 0.4, 7, index).velocity) <= BURST.cap + 1e-9);
    assert.ok(length(burstVelocity(centre, blast, 2, 0.4, 7, index).velocity) >= length(one.velocity) - 1e-9, "a bigger blast throws no less hard");
  }
  // A piece sitting on the blast still goes somewhere.
  assert.ok(Math.hypot(...burstVelocity(blast, blast, 1, 0.4, 7, 0).velocity) > 1);
});

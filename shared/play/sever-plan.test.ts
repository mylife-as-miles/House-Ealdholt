/**
 * Dismemberment's pure half (web/src/scene/death/sever/severPlan.ts): which killing blows take a limb off, at which
 * settings, which limb, how it is thrown, how long it collides with nothing, how the stump bleeds, and how the skin is
 * cut. The half that needs Jolt is in main game/src/play/death-physics.test.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { goreShow, type KillMoment, type TierSettings } from "../../web/src/scene/gore/goreTiers";
import { PHYSICS_STEP } from "../../web/src/scene/death/physics/fixedStep";
import { cross, dot, length, qAxisAngle, sub, unit, type V3 } from "../../web/src/scene/death/physics/math";
import { planRagdoll } from "../../web/src/scene/death/ragdoll/ragdollPlan";
import { splitSkin } from "../../web/src/scene/death/gibs/gibPlan";
import {
  AVOID, SEVERING_CUTS, SEVER_LIMBS, SEVER_THROW, SPURT, TEARING, WEAPON_CUT, avoidSeconds, boxBottom, carriedVelocity, limbJoints, limbLaunch, limbSegment,
  nearestLimb, planSevers, ragdollParts, segmentDistance, severSkin, severableLimbs, skinVertex, spurtPulses, spurtSpray, spurtStains, weaponOf, woundSevers,
  type SeverCut, type SeverLimb,
} from "../../web/src/scene/death/sever/severPlan";
import { RIGS, loadModelRig, loadRig, poseRig } from "./death-rig";
import type { QualityPreset } from "../../web/src/scene/quality";

const kill = (extra: Partial<KillMoment> = {}): KillMoment => ({ attacker: "n", victim: "r", style: "melee", weapon: "sword", ...extra });
const at = (violence: TierSettings["violence"], extra: Partial<TierSettings> = {}): TierSettings => ({ violence, reducedMotion: false, captureCinematics: true, ...extra });
const limbs = (moment: KillMoment, settings: TierSettings, cut: SeverCut, by: "duel" | "summon" = "duel", quality: QualityPreset = "high", physics = true) =>
  planSevers({ show: goreShow(moment, settings, quality), physics, cut, by, seed: 7 }).limbs;

test("a limb comes off only at an execution or a fatality, at Full, with the physics deaths, from a blade, an axe or a tearing", () => {
  // A Knight's blade felling a Rook: an execution at Full.
  assert.equal(limbs(kill(), at("full"), "slash"), 1);
  // A Pawn's fall to a sword is ordinary combat (tier 1): nothing comes off. An axe executes, whatever falls to it.
  assert.equal(limbs(kill({ victim: "p" }), at("full"), "slash"), 0);
  assert.equal(limbs(kill({ victim: "p", weapon: "axe" }), at("full"), "cleave"), 1);
  // A hammer executes but crushes; a spear runs the body through; a ball and a spell neither cut: none takes a limb.
  assert.equal(limbs(kill({ attacker: "r", victim: "p", weapon: "mace" }), at("full"), "crush"), 0);
  assert.equal(limbs(kill({ attacker: "p", victim: "n", weapon: "spear" }), at("full"), "thrust"), 0);
  assert.equal(limbs(kill({ attacker: "r", style: "gun", weapon: "musket" }), at("full"), "shot"), 0);
  assert.equal(limbs(kill({ attacker: "b", style: "spell", weapon: "staff" }), at("full"), "pierce"), 0, "a spell that runs the piece through impales");
  assert.equal(limbs(kill({ attacker: "q", style: "summon" }), at("full"), "burn", "summon"), 0, "a summon that burns burns");
  // Only Full: Cinematic shows the wounds and no more, Minimal nothing.
  assert.equal(limbs(kill(), at("cinematic"), "slash"), 0);
  assert.equal(limbs(kill(), at("minimal"), "slash"), 0);
  // Never under reduced motion, with capture fights off, on the map, on the menu's board, or without the physics deaths.
  for (const settings of [at("full", { reducedMotion: true }), at("full", { captureCinematics: false }), at("full", { tactical: true }), at("full", { menuBoard: true })]) assert.equal(limbs(kill(), settings, "slash"), 0, JSON.stringify(settings));
  assert.equal(limbs(kill(), at("full"), "slash", "duel", "high", false), 0);
  // A King is never captured: asked, the tiers show nothing.
  assert.equal(limbs(kill({ victim: "k" }), at("full"), "slash"), 0);
});

test("a duel's killing blow takes one limb; a summon's tearings take up to the tier's budget for the preset", () => {
  const summon = kill({ attacker: "q", victim: "n", style: "summon", weapon: "staff" });
  assert.deepEqual((["low", "medium", "high", "ultra"] as const).map(quality => limbs(summon, at("full"), "tear", "summon", quality)), [1, 1, 1, 2]);
  // A fatality (Queen takes Queen, mate, a side's last piece) affords more: up to three on Ultra.
  assert.equal(limbs(kill({ attacker: "q", victim: "q", style: "summon" }), at("full"), "tear", "summon", "ultra"), 3);
  assert.equal(limbs(kill({ mate: true }), at("full"), "tear", "summon", "medium"), 2);
  // One blow is one limb, however much the tier affords.
  assert.equal(limbs(kill({ mate: true }), at("full"), "slash", "duel", "ultra"), 1);
  assert.equal(limbs(kill({ victim: "q", attacker: "n" }), at("full"), "slash", "duel", "ultra"), 1);
  // The rule is decided from the kill alone: the same kill, the same rule.
  const rule = planSevers({ show: goreShow(summon, at("full"), "ultra"), physics: true, cut: "tear", by: "summon", seed: 99 });
  assert.deepEqual(rule, planSevers({ show: goreShow(summon, at("full"), "ultra"), physics: true, cut: "tear", by: "summon", seed: 99 }));
  assert.equal(rule.seed, 99);
});

test("which wounds take the limb: the killing blow and the tearings after it, while the budget lasts", () => {
  const duel = { limbs: 1, by: "duel" as const, seed: 1 }, summon = { limbs: 2, by: "summon" as const, seed: 1 }, none = { limbs: 0, by: "summon" as const, seed: 1 };
  assert.equal(woundSevers(duel, { struck: true, power: 1 }, 0), true);
  assert.equal(woundSevers(duel, { struck: true, power: 1 }, 1), false, "one limb a blow");
  assert.equal(woundSevers(duel, { struck: false, power: 1 }, 0), false);
  // A summon: the wounds before the kill only wound; talons (1) and a bite (0.9) only wound; a tearing takes a limb.
  assert.equal(woundSevers(summon, { struck: false, power: 1.6 }, 0), false);
  assert.equal(woundSevers(summon, { struck: true, power: 1 }, 0), false);
  assert.equal(woundSevers(summon, { struck: true, power: 0.9 }, 0), false);
  assert.equal(woundSevers(summon, { struck: true, power: 1.3 }, 0), true, "the wyvern's tear");
  assert.equal(woundSevers(summon, { struck: true, power: 1.6 }, 1), true, "the undead's killing blow, or the colossus's sabre, at Full");
  assert.equal(woundSevers(summon, { struck: true, power: 1.6 }, 2), false, "the budget is spent");
  assert.equal(woundSevers(none, { struck: true, power: 2 }, 0), false);
  assert.ok(TEARING === 1);
});

test("what each army kills with, and which weapons cut: the Knights' and Kings' blades slash, Solforiz's cleaver cleaves", () => {
  assert.deepEqual((["kingdom", "sun", "empire", "kwind"] as const).map(arsenal => weaponOf(arsenal, "n")), ["sword", "axe", "sword", "fist"]);
  assert.deepEqual((["kingdom", "sun", "empire", "kwind"] as const).map(arsenal => weaponOf(arsenal, "k")), ["sword", "sword", "musket", "staff"]);
  assert.deepEqual((["kingdom", "sun", "empire", "kwind"] as const).map(arsenal => weaponOf(arsenal, "p")), ["spear", "spear", "spear", "spear"]);
  assert.deepEqual((["kingdom", "sun", "kwind"] as const).map(arsenal => weaponOf(arsenal, "r")), ["mace", "mace", "mace"]);
  assert.deepEqual(Object.entries(WEAPON_CUT).filter(([, cut]) => SEVERING_CUTS.includes(cut)).map(([weapon]) => weapon).sort(), ["axe", "sword"]);
  assert.deepEqual([...SEVERING_CUTS].sort(), ["cleave", "slash", "tear"]);
});

const NAMES: Record<SeverLimb, string> = { head: "Head", armL: "LeftArm", armR: "RightArm", foreArmL: "LeftForeArm", foreArmR: "RightForeArm", legL: "LeftUpLeg", legR: "RightUpLeg", shinL: "LeftLeg", shinR: "RightLeg" };

for (const id of RIGS) {
  test(`${id}: the limb taken is the one whose bone runs nearest the wound, and what goes with it`, () => {
    const rig = loadRig(id), now = poseRig(rig, "hit.front", 0.2, { x: 1.53, z: -0.51, yaw: 2.2 });
    const found = severableLimbs(rig.joints);
    assert.deepEqual(found.map(bone => bone.limb).sort(), [...SEVER_LIMBS].sort());
    for (const bone of found) {
      assert.equal(rig.joints[bone.joint].name, NAMES[bone.limb], bone.limb);
      assert.equal(bone.parent, rig.joints[bone.joint].parent);
      // A point just off the middle of each limb's bone takes that limb.
      const [a, b] = limbSegment(bone, now), middle: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const side = unit(cross(sub(b, a), [0, 1, 0]), [1, 0, 0]), point: V3 = [middle[0] + side[0] * 0.01, middle[1] + side[1] * 0.01, middle[2] + side[2] * 0.01];
      assert.equal(nearestLimb(point, now, rig.joints, found)?.limb, bone.limb, `${id} ${bone.limb}`);
      assert.ok(segmentDistance(point, a, b) < 0.011);
      // Its joints are its own and everything under it, never the bone it hangs from.
      const going = limbJoints(rig.joints, bone).map(index => rig.joints[index].name);
      assert.equal(going[0], NAMES[bone.limb]);
      assert.ok(!going.includes(rig.joints[bone.parent].name));
    }
    const named = (limb: SeverLimb) => limbJoints(rig.joints, found.find(bone => bone.limb === limb)!).map(index => rig.joints[index].name).sort();
    assert.deepEqual(named("armL"), ["LeftArm", "LeftForeArm", "LeftHand"]);
    assert.deepEqual(named("foreArmR"), ["RightForeArm", "RightHand"]);
    assert.deepEqual(named("head"), ["Head", "head_end", "headfront"]);
    assert.deepEqual(named("shinL"), ["LeftFoot", "LeftLeg", "LeftToeBase"]);
    // A limb gone takes those that share its bones: with the left arm off, a wound at the left hand takes something else.
    const hand = now.positions[rig.joints.findIndex(joint => joint.name === "LeftHand")];
    assert.equal(nearestLimb(hand, now, rig.joints, found)?.limb, "foreArmL");
    const next = nearestLimb(hand, now, rig.joints, found, ["armL"])!;
    assert.ok(next && !["armL", "foreArmL"].includes(next.limb), next?.limb);
    // ...and a forearm taken at the elbow leaves the upper arm on the body, where it stays: a wound there takes another limb.
    const shoulder = now.positions[rig.joints.findIndex(joint => joint.name === "LeftArm")], elbow = now.positions[rig.joints.findIndex(joint => joint.name === "LeftForeArm")];
    const upper: V3 = [(shoulder[0] * 2 + elbow[0]) / 3, (shoulder[1] * 2 + elbow[1]) / 3, (shoulder[2] * 2 + elbow[2]) / 3];
    assert.equal(nearestLimb(upper, now, rig.joints, found)?.limb, "armL");
    const after = nearestLimb(upper, now, rig.joints, found, ["foreArmL"]);
    assert.ok(after && !["armL", "foreArmL"].includes(after.limb), after?.limb);
    assert.equal(nearestLimb(upper, now, rig.joints, found, SEVER_LIMBS), null, "nothing left");
    // The same wound on the same pose always takes the same limb.
    assert.deepEqual(nearestLimb([1.5, 0.5, -0.4], now, rig.joints, found), nearestLimb([1.5, 0.5, -0.4], now, rig.joints, found));
  });

  test(`${id}: the ragdoll keeps no body for a limb that came off, and still falls as the figure`, () => {
    const rig = loadRig(id), bind = poseRig(rig, null, 0), now = poseRig(rig, "hit.front", 0.2);
    const whole = planRagdoll(rig.joints, bind, now)!;
    for (const limb of SEVER_LIMBS) {
      const without = ragdollParts(limb), plan = planRagdoll(rig.joints, bind, now, { without })!;
      assert.ok(plan, limb);
      assert.equal(plan.parts.length, whole.parts.length - without.length, limb);
      for (const name of without) assert.ok(!plan.parts.some(part => part.name === name), `${limb}: ${name}`);
      // Every joint still links two bodies that exist, and the figure is sized as before (a leg gone, from the other).
      for (const part of plan.parts) if (part.parent >= 0) assert.ok(plan.parts[part.parent] && part.link, `${limb}: ${part.name}`);
      assert.ok(Math.abs(plan.height - whole.height) < whole.height * 0.12, `${limb}: height ${plan.height.toFixed(3)} against ${whole.height.toFixed(3)}`);
    }
    // An upper arm gone takes its forearm even if only the arm is named; the lowest preset's one-body arm stops at the elbow.
    assert.ok(!planRagdoll(rig.joints, bind, now, { without: ["armL"] })!.parts.some(part => part.name === "foreArmL"));
    const simple = planRagdoll(rig.joints, bind, now, { simpleArms: true })!, short = planRagdoll(rig.joints, bind, now, { simpleArms: true, without: ragdollParts("foreArmL") })!;
    const span = (plan: typeof simple) => { const shape = plan.parts.find(part => part.name === "armL")!.shape; return shape.kind === "capsule" ? shape.halfHeight : 0; };
    assert.ok(span(short) < span(simple) * 0.7, "the one-body arm is shorter without its forearm");
    // Both legs gone: the trunk measures the figure.
    const legless = planRagdoll(rig.joints, bind, now, { without: [...ragdollParts("legL"), ...ragdollParts("legR")] })!;
    assert.ok(legless && Math.abs(legless.height - whole.height) < whole.height * 0.35, `legless height ${legless?.height}`);
  });
}

test("every shipped figure of Solforiz, Korvenia and Kwind-09 has the nine limbs that can come off", () => {
  for (const kingdom of ["solforiz", "korvenia", "kwind09"] as const) for (const kind of ["p", "n", "b", "r", "q"]) {
    const rig = loadModelRig(kingdom, kind, 0.9);
    assert.deepEqual(severableLimbs(rig.joints).map(bone => bone.limb).sort(), [...SEVER_LIMBS].sort(), `${kingdom} ${kind}`);
  }
  assert.deepEqual(severableLimbs([{ name: "root", parent: -1 }, { name: "wheel", parent: 0 }]), []);
});

test("a limb is thrown along the blow, up and tumbling, the same way for the same kill and never too fast", () => {
  for (const direction of [[1, 0, 0], [0, 0, -1], [0.6, 0.3, 0.8], [-0.2, -0.4, 0.1]] as V3[]) {
    const flat = unit([direction[0], 0, direction[2]]);
    for (let seed = 1; seed < 40; seed += 1) {
      const leg = limbLaunch(direction, 1, seed, 0, "legL"), head = limbLaunch(direction, 1, seed, 0, "head");
      assert.deepEqual(limbLaunch(direction, 1, seed, 0, "legL"), leg);
      assert.ok(dot(leg.velocity, flat) > 0, "along the blow, within its scatter");
      assert.ok(leg.velocity[1] > 0.9, "and up");
      assert.ok(length(leg.velocity) <= SEVER_THROW.cap + 1e-9 && length(head.velocity) <= SEVER_THROW.cap + 1e-9);
      assert.ok(head.velocity[1] >= leg.velocity[1] - 1e-9, "a head goes higher");
      assert.ok(length(leg.spin) > SEVER_THROW.spin * 0.5 && length(leg.spin) < SEVER_THROW.spin * 1.3, `spin ${length(leg.spin)}`);
      assert.notDeepEqual(limbLaunch(direction, 1, seed, 1, "legL"), leg, "the next limb of a kill goes its own way");
    }
  }
  assert.notDeepEqual(limbLaunch([1, 0, 0], 1, 3, 0, "armL"), limbLaunch([1, 0, 0], 1, 4, 0, "armL"));
  // A blow with no direction still throws, the same way every time.
  assert.deepEqual(limbLaunch([0, 0, 0], 1, 5, 0, "armR"), limbLaunch([0, 0, 0], 1, 5, 0, "armR"));
  // What the hand held leaves with the hand: on the spin's axis no faster, off it the turn adds.
  assert.deepEqual(carriedVelocity([1, 2, 3], [0, 5, 0], [0, 0, 0], [0, 1, 0]), [1, 2, 3]);
  assert.deepEqual(carriedVelocity([0, 0, 0], [0, 0, 2], [0, 0, 0], [1, 0, 0]), [0, 2, 0]);
});

test("the avoidance phase is inversely proportional to the launch speed, and never shorter than one step", () => {
  for (const speed of [0.8, 1, 1.25, 1.7, 2.2, 2.6]) assert.ok(Math.abs(avoidSeconds(speed) * speed - AVOID.clear) < 1e-9, `${speed}`);
  assert.ok(avoidSeconds(2) < avoidSeconds(1), "faster is shorter");
  assert.equal(avoidSeconds(1e6), PHYSICS_STEP, "one step at the least, however fast");
  assert.equal(avoidSeconds(0), AVOID.max);
  assert.equal(avoidSeconds(Number.NaN), AVOID.max);
  assert.equal(avoidSeconds(-2), avoidSeconds(2));
  // A box's lowest corner, upright and turned.
  assert.ok(Math.abs(boxBottom([0, 1, 0], [0, 0, 0, 1], [0.1, 0.3, 0.2]) - 0.7) < 1e-9);
  assert.ok(Math.abs(boxBottom([0, 1, 0], qAxisAngle([0, 0, 1], Math.PI / 2), [0.1, 0.3, 0.2]) - 0.9) < 1e-9);
});

test("the stump beats along the bone's axis, slowing and weakening, and stains the stone where its droplets land", () => {
  const pulses = spurtPulses(11);
  assert.equal(pulses.length, SPURT.beats);
  assert.equal(pulses[0].at, SPURT.first); assert.equal(pulses[0].strength, 1);
  for (let i = 1; i < pulses.length; i += 1) {
    assert.ok(pulses[i].at > pulses[i - 1].at + 0.2 && pulses[i].strength < pulses[i - 1].strength);
    if (i > 1) assert.ok(pulses[i].at - pulses[i - 1].at > pulses[1].at - pulses[0].at - 2 * SPURT.jitter, "the heart slows");
  }
  assert.ok(pulses.at(-1)!.at > 1 && pulses.at(-1)!.at < 2.2, "a second or two");
  assert.deepEqual(spurtPulses(11), pulses); assert.notDeepEqual(spurtPulses(12), pulses);
  const template = { droplets: 60, mist: 6, speed: [1.3, 3.4] as const, size: [0.007, 0.02] as const };
  const origin = { x: 0.5, y: 0.62, z: -0.5 }, axis = { x: 0, y: 2, z: 0 };
  const sprays = pulses.map((pulse, i) => spurtSpray(template, pulse, i, origin, axis, 5));
  assert.ok(sprays[0] && sprays[0].mist === template.mist && sprays.slice(1).every(spray => !spray || spray.mist === 0), "mist on the first beat only");
  assert.deepEqual(sprays[0]!.axis, { x: 0, y: 1, z: 0 });
  for (let i = 1; i < sprays.length; i += 1) if (sprays[i]) assert.ok(sprays[i]!.droplets < sprays[i - 1]!.droplets && sprays[i]!.speed[1] < sprays[i - 1]!.speed[1]);
  assert.equal(spurtSpray({ ...template, droplets: 3 }, { at: 1, strength: 0.3 }, 5, origin, axis, 5), null, "too weak to throw two");
  // A fountain from a neck: its droplets come down round the body, inside the board, a little apart, after the beat.
  const stains = spurtStains(sprays[0]!, 0, 1.02, 3);
  assert.ok(stains.length >= 1 && stains.length <= 3);
  for (const stain of stains) {
    assert.ok(Math.hypot(stain.x - origin.x, stain.z - origin.z) < 1.2, `${stain.x} ${stain.z}`);
    assert.ok(stain.at > 0.1 && stain.radius > 0);
  }
  for (let i = 0; i < stains.length; i += 1) for (let j = i + 1; j < stains.length; j += 1) assert.ok(Math.hypot(stains[i].x - stains[j].x, stains[i].z - stains[j].z) >= 0.14 * 1.02 - 1e-9);
  assert.deepEqual(spurtStains(sprays[0]!, 0, 1.02, 0), []);
});

/** A closed tube along y, as a skinned limb would be: rings of `around` points, both ends closed, and one column doubled as at a texture seam. */
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
/** Edges that belong to one triangle only, matched by position: none, if the surface is closed. */
function openEdges(positions: Float32Array, index: ArrayLike<number>): number {
  const key = (i: number) => `${Math.round(positions[i * 3] * 1e4)},${Math.round(positions[i * 3 + 1] * 1e4)},${Math.round(positions[i * 3 + 2] * 1e4)}`;
  const count = new Map<string, number>();
  for (let t = 0; t < index.length; t += 3) for (let k = 0; k < 3; k += 1) {
    const a = key(index[t + k]), b = key(index[t + (k + 1) % 3]), id = a < b ? `${a}|${b}` : `${b}|${a}`;
    count.set(id, (count.get(id) ?? 0) + 1);
  }
  return [...count.values()].filter(times => times !== 2).length;
}

test("the limb is cut from the skin closed, the stump's edges are the body's own, and only what touches the limb is read", () => {
  const skin = tube(), count = skin.positions.length / 3;
  const owner = Uint8Array.from({ length: count }, (_, v) => skin.positions[v * 3 + 1] > 0.45 ? 1 : 0);
  let posed = 0;
  const source = {
    count, index: skin.index, owner,
    pose: (v: number, out: number[]) => { posed += 1; for (let k = 0; k < 3; k += 1) { out[k] = skin.positions[v * 3 + k]; out[k + 3] = skin.normals[v * 3 + k]; } },
    uv: (v: number, out: number[]) => { out[0] = skin.uvs[v * 2]; out[1] = skin.uvs[v * 2 + 1]; },
  };
  const { limb, stump } = severSkin(source);
  assert.ok(limb && stump);
  assert.ok(posed < count, `only the limb and its ring are skinned (${posed} of ${count})`);
  assert.equal(openEdges(limb.positions, limb.index), 0, "the limb is closed: nothing to look into");
  assert.ok(limb.cap > 0 && limb.cap % 3 === 0 && limb.skin % 3 === 0);
  assert.equal(limb.uvs!.length / 2, limb.positions.length / 3); assert.equal(limb.cut.length, limb.positions.length);
  // Its cap faces out of the cut (down, towards the body), and is marked 0 at the middle and 1 at the rim.
  let middleY = 0; for (let i = 1; i < limb.positions.length; i += 3) middleY += limb.positions[i]; middleY /= limb.positions.length / 3;
  for (let i = limb.skin; i < limb.index.length; i += 1) {
    const v = limb.index[i];
    assert.ok(limb.normals[v * 3 + 1] < 0 && limb.positions[v * 3 + 1] < middleY, "cap faces the body");
    assert.ok(limb.cut[v * 3] === 0 || Math.abs(limb.cut[v * 3] - 1) < 1e-6, "middle or rim");
    assert.ok(Math.abs(Math.hypot(limb.cut[v * 3 + 1], limb.cut[v * 3 + 2]) - (limb.cut[v * 3] === 0 ? 0 : 1)) < 1e-6);
  }
  // The stump: one round of the cut, each of its edges one of the body's triangles' and one of the limb's cap edges.
  assert.equal(stump.count, 1);
  assert.equal(stump.edges.length / 2, limb.cap / 3);
  const point = (v: number) => `${Math.round(skin.positions[v * 3] * 1e4)},${Math.round(skin.positions[v * 3 + 1] * 1e4)},${Math.round(skin.positions[v * 3 + 2] * 1e4)}`;
  const starts = new Map<string, number>(), ends = new Map<string, number>();
  for (let e = 0; e < stump.edges.length; e += 2) { starts.set(point(stump.edges[e]), (starts.get(point(stump.edges[e])) ?? 0) + 1); ends.set(point(stump.edges[e + 1]), (ends.get(point(stump.edges[e + 1])) ?? 0) + 1); }
  assert.deepEqual([...starts.keys()].sort(), [...ends.keys()].sort(), "a closed round, across the texture seam");
  for (const times of starts.values()) assert.equal(times, 1);
  for (let e = 0; e < stump.edges.length; e += 1) assert.ok(skin.positions[stump.edges[e] * 3 + 1] > 0.35 && skin.positions[stump.edges[e] * 3 + 1] < 0.55, "on the cut");
  // Cut the same skin unindexed: the same pieces. A mesh the limb owns nothing of gives nothing.
  const flat = { count: skin.index.length, index: null, owner: Uint8Array.from(skin.index, v => owner[v]), uv: null,
    pose: (v: number, out: number[]) => { const s = skin.index[v]; for (let k = 0; k < 3; k += 1) { out[k] = skin.positions[s * 3 + k]; out[k + 3] = skin.normals[s * 3 + k]; } } };
  const again = severSkin(flat);
  assert.equal(again.limb!.skin, limb.skin); assert.equal(again.limb!.cap, limb.cap); assert.equal(again.stump!.count, 1);
  assert.deepEqual(severSkin({ ...source, owner: new Uint8Array(count) }), { limb: null, stump: null });
});

test("a vertex is skinned as the vertex shader poses it", () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const shifted = [...identity.slice(0, 12), 0.5, 0, 0, 1], matrices = [...identity, ...shifted], out = [0, 0, 0, 0, 0, 0];
  skinVertex([1, 2, 3], [0, 0, 2], [0, 0, 0, 0], [1, 0, 0, 0], matrices, identity, identity, out);
  assert.deepEqual(out, [1, 2, 3, 0, 0, 1]);
  skinVertex([1, 2, 3], [0, 1, 0], [1, 0, 0, 0], [1, 0, 0, 0], matrices, identity, identity, out);
  assert.deepEqual(out.slice(0, 3), [1.5, 2, 3]);
  skinVertex([1, 2, 3], [0, 1, 0], [0, 1, 0, 0], [0.5, 0.5, 0, 0], matrices, identity, identity, out);
  assert.deepEqual(out.slice(0, 3), [1.25, 2, 3]);
  skinVertex([1, 2, 3], [0, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0], matrices, identity, shifted, out);
  assert.deepEqual(out.slice(0, 3), [1.5, 2, 3], "a vertex no bone holds stays where the bind pose has it");
});

test("a burst after a sever leaves the folded limb out and closes the cut against it", () => {
  const skin = tube(), count = skin.positions.length / 3;
  // Three pieces up the tube, and the top a folded limb that belongs to none.
  const owner = Int16Array.from({ length: count }, (_, v) => { const y = skin.positions[v * 3 + 1]; return y > 0.55 ? -1 : y < 0.25 ? 0 : 1; });
  const pieces = splitSkin({ ...skin, owner }, 2);
  assert.equal(pieces.length, 2);
  for (const piece of pieces) assert.equal(openEdges(piece.positions, piece.index), 0, `piece ${piece.piece} is closed`);
  for (const piece of pieces) for (let i = 1; i < piece.positions.length; i += 3) assert.ok(piece.positions[i] < 0.75, "nothing of the folded limb");
});

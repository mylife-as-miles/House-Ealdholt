import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ContactIK, TwoBoneIK } from "./contactIK";

function limb(yaw = 0) {
  const root = new THREE.Group(), upper = new THREE.Bone(), lower = new THREE.Bone(), end = new THREE.Bone();
  root.position.set(2, 1, -3); root.rotation.y = yaw;
  root.add(upper); upper.add(lower); lower.add(end);
  upper.name = "RightArm"; lower.name = "RightForeArm"; end.name = "RightHand";
  lower.position.set(.6, -.2, 0); end.position.set(.6, .2, 0);
  const tip = new THREE.Object3D(); tip.position.set(.35, 0, 0); end.add(tip);
  root.updateMatrixWorld(true);
  return { root, upper, lower, end, tip, chain: new TwoBoneIK(upper, lower, end) };
}

describe("contact IK on existing joint chains", () => {
  it("ignores invalid solver weights without corrupting a sampled skeleton", () => {
    for (const weight of [NaN, Infinity, -Infinity]) {
      const f = limb(), before = [f.upper, f.lower, f.end].map(b => b.quaternion.clone());
      expect(f.chain.solve(new THREE.Vector3(3.1, 1.25, -2.85), weight)).toBe(false);
      [f.upper, f.lower, f.end].forEach((b, i) => expect(b.quaternion.equals(before[i])).toBe(true));
    }
  });

  it("keeps an invalid shield weight out of the real wrist and arm joints", () => {
    const f = limb(); f.upper.name = "LeftArm"; f.lower.name = "LeftForeArm"; f.end.name = "LeftHand";
    const before = [f.upper, f.lower, f.end].map(b => b.quaternion.clone()), ik = new ContactIK(f.root, f.root, null, f.tip);
    ik.apply(1, "off", null, 0, new THREE.Vector3(3.1, 1.25, -2.85), NaN);
    [f.upper, f.lower, f.end].forEach((b, i) => expect(b.quaternion.equals(before[i])).toBe(true));
    expect(ik.shieldError).toBeNull();
  });

  it("reaches a world target under rotated parents without translating or stretching bones", () => {
    for (const yaw of [0, .8, Math.PI]) {
      const f = limb(yaw), positions = [f.upper, f.lower, f.end].map(b => b.position.clone());
      const goal = new THREE.Vector3(.7, .3, .2).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(f.root.position);
      expect(f.chain.solve(goal)).toBe(true);
      expect(f.end.getWorldPosition(new THREE.Vector3()).distanceTo(goal)).toBeLessThan(1e-5);
      [f.upper, f.lower, f.end].forEach((b, i) => expect(b.position.equals(positions[i])).toBe(true));
      expect(f.root.position.toArray()).toEqual([2, 1, -3]);
    }
  });

  it("clamps unreachable and coincident targets without NaNs or length changes", () => {
    const f = limb(), length = f.lower.position.length() + f.end.position.length();
    expect(f.chain.solve(new THREE.Vector3(200, 10, 20))).toBe(false);
    expect(f.upper.getWorldPosition(new THREE.Vector3()).distanceTo(f.end.getWorldPosition(new THREE.Vector3()))).toBeCloseTo(length, 5);
    for (const goal of [f.upper.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(NaN, 0, 0)]) expect(f.chain.solve(goal)).toBe(false);
    for (const bone of [f.upper, f.lower, f.end]) expect(bone.quaternion.toArray().every(Number.isFinite)).toBe(true);
  });

  it("corrects the actual weapon socket and restores the exact sampled pose", () => {
    const f = limb(), ik = new ContactIK(f.root, f.root, f.tip, null);
    const baseline = [f.upper, f.lower, f.end].map(b => b.quaternion.clone());
    const goal = new THREE.Vector3(3.1, 1.25, -2.85);
    const before = f.tip.getWorldPosition(new THREE.Vector3()).distanceTo(goal);
    ik.apply(1, "off", goal, 1, null);
    expect(ik.contactError).not.toBeNull(); expect(ik.contactError!).toBeLessThan(before);
    // Large pose mismatches remain visible instead of dragging the limb across
    // the board. Authored contacts only need small runtime corrections.
    expect(f.upper.quaternion.angleTo(baseline[0])).toBeLessThanOrEqual(.350001);
    expect(f.lower.quaternion.angleTo(baseline[1])).toBeLessThanOrEqual(.350001);
    expect(f.end.quaternion.angleTo(baseline[2])).toBeLessThanOrEqual(.500001);
    ik.restore();
    [f.upper, f.lower, f.end].forEach((b, i) => expect(b.quaternion.angleTo(baseline[i])).toBeLessThan(1e-7));
    ik.setEnabled(false); ik.apply(1, "off", goal, 1, null);
    expect(f.tip.getWorldPosition(new THREE.Vector3()).distanceTo(goal)).toBeCloseTo(before);
  });

  it("keeps stance feet on the board when the hips shift, while leaving the board anchor fixed", () => {
    const root = new THREE.Group(), hips = new THREE.Bone(); hips.position.y = 1; root.add(hips);
    const thigh = new THREE.Bone(), shin = new THREE.Bone(), foot = new THREE.Bone();
    thigh.name = "LeftUpLeg"; shin.name = "LeftLeg"; foot.name = "LeftFoot";
    hips.add(thigh); thigh.position.x = .15; thigh.add(shin); shin.position.set(0, -.45, .1); shin.add(foot); foot.position.set(0, -.45, -.1);
    root.updateMatrixWorld(true);
    const ik = new ContactIK(root, root, null, null); ik.plantFeet();
    const planted = foot.getWorldPosition(new THREE.Vector3()), source = [thigh, shin, foot].map(b => b.quaternion.clone());
    hips.position.x += .1; hips.position.y -= .07; ik.apply(0, "plant", null, 0, null);
    expect(foot.getWorldPosition(new THREE.Vector3()).distanceTo(planted)).toBeLessThan(1e-5);
    expect(root.position.toArray()).toEqual([0, 0, 0]);
    ik.restore(); [thigh, shin, foot].forEach((b, i) => expect(b.quaternion.angleTo(source[i])).toBeLessThan(1e-7));
    ik.releaseFeet();
    const moving = foot.getWorldPosition(new THREE.Vector3());
    ik.apply(0, "plant", null, 0, null, .8, { left: false, right: null });
    expect(foot.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(moving.x, 6);
  });

  it("reports each foot as it is set down: after its half of a staged step, and on the clip's own plant marker", () => {
    const root = new THREE.Group(), hips = new THREE.Bone(); hips.position.y = 1; root.add(hips);
    const leg = (side: "Left" | "Right", x: number) => {
      const thigh = new THREE.Bone(), shin = new THREE.Bone(), foot = new THREE.Bone();
      thigh.name = `${side}UpLeg`; shin.name = `${side}Leg`; foot.name = `${side}Foot`;
      hips.add(thigh); thigh.position.x = x; thigh.add(shin); shin.position.set(0, -.45, .1); shin.add(foot); foot.position.set(0, -.45, -.1);
      return foot;
    };
    leg("Left", .15); leg("Right", -.15);
    root.updateMatrixWorld(true);
    const ik = new ContactIK(root, root, null, null), down: [number, number][] = [];
    ik.onFootDown = (x, z) => down.push([x, z]);
    ik.plantFeet();
    ik.apply(0, "plant", null, 0, null);
    expect(down).toHaveLength(0);
    // A step of 0.4 along z: the leading foot comes down first, the other when the step ends. Nothing while both are in the air.
    expect(ik.beginStep(new THREE.Vector3(0, 0, .4))).toBe(true);
    for (const progress of [.1, .3, .5]) { ik.stepTo(progress); ik.restore(); ik.apply(0, "plant", null, 0, null); }
    expect(down).toHaveLength(0);
    ik.stepTo(.6); ik.restore(); ik.apply(0, "plant", null, 0, null);
    expect(down).toHaveLength(1);
    ik.stepTo(1); ik.restore(); ik.apply(0, "plant", null, 0, null);
    expect(down).toHaveLength(2);
    for (const [, z] of down) expect(z).toBeCloseTo(.4, 5);
    // Standing still afterwards says nothing more.
    ik.restore(); ik.apply(0, "plant", null, 0, null);
    expect(down).toHaveLength(2);
    // The clip's markers: lifted, then planted. Planted without having been lifted is not a footfall.
    ik.restore(); ik.apply(0, "ground", null, 0, null, .8, { left: true, right: null });
    expect(down).toHaveLength(2);
    ik.restore(); ik.apply(0, "ground", null, 0, null, .8, { left: false, right: null });
    ik.restore(); ik.apply(0, "ground", null, 0, null, .8, { left: true, right: null });
    expect(down).toHaveLength(3);
    // A lift that is never followed by a plant in a marked clip is forgotten when the markers stop.
    ik.restore(); ik.apply(0, "ground", null, 0, null, .8, { left: false, right: null });
    ik.restore(); ik.apply(0, "plant", null, 0, null);
    ik.restore(); ik.apply(0, "ground", null, 0, null, .8, { left: true, right: null });
    expect(down).toHaveLength(3);
    ik.onFootDown = null;
    expect(ik.beginStep(new THREE.Vector3(.3, 0, 0))).toBe(true);
    ik.stepTo(1); ik.restore(); ik.apply(0, "plant", null, 0, null);
    expect(down).toHaveLength(3);
  });

  it("turns the shield face toward a threat without flipping its centre like a spear tip", () => {
    const f = limb(); f.upper.name = "LeftArm"; f.lower.name = "LeftForeArm"; f.end.name = "LeftHand";
    const ik = new ContactIK(f.root, f.root, null, f.tip), target = f.tip.getWorldPosition(new THREE.Vector3());
    const incoming = new THREE.Vector3(1, 0, 1).normalize(), threat = target.clone().add(incoming);
    const before = f.tip.getWorldDirection(new THREE.Vector3()).dot(incoming), poses = [f.upper, f.lower, f.end].map(b => b.quaternion.clone());
    ik.apply(1, "off", null, 0, target, 1, undefined, threat);
    expect(f.tip.getWorldDirection(new THREE.Vector3()).dot(incoming)).toBeGreaterThan(before);
    expect(f.end.quaternion.angleTo(poses[2])).toBeLessThanOrEqual(.500001);
    ik.restore(); [f.upper, f.lower, f.end].forEach((b, i) => expect(b.quaternion.angleTo(poses[i])).toBeLessThan(1e-7));
  });

  it("supports a rig without recognized limbs and releases corrections on reset", () => {
    const root = new THREE.Group(), ik = new ContactIK(root, root, null, null);
    ik.apply(0, "plant", new THREE.Vector3(), 1, new THREE.Vector3()); ik.reset();
    expect(root.position.toArray()).toEqual([0, 0, 0]); expect(ik.contactError).toBeNull();
  });

  it("rejects disconnected lookalike bones and accepts alternate names in a real hierarchy", () => {
    const f = limb(); f.upper.name = "mixamorig:RightUpperArm"; f.lower.name = "mixamorig:RightLowerArm";
    const goal = new THREE.Vector3(3.2, 1.1, -2.95), valid = new ContactIK(f.root, f.root, f.tip, null);
    valid.apply(1, "off", goal, 1, null); expect(valid.contactError).not.toBeNull(); valid.restore();
    f.root.attach(f.lower);
    const invalid = new ContactIK(f.root, f.root, f.tip, null), before = f.upper.quaternion.clone();
    invalid.apply(1, "off", goal, 1, null);
    expect(invalid.contactError).toBeNull(); expect(f.upper.quaternion.equals(before)).toBe(true);
  });
});

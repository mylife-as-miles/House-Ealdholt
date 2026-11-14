import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LivingPieceRig } from "./livingPieceRig";
import { BoardReactionDirector, type BoardReactionCue } from "./boardReactionDirector";

function figure(yaw = 0) {
  const anchor = new THREE.Group(), visual = new THREE.Group();
  anchor.position.set(3, 0, 5); anchor.add(visual); visual.rotation.y = yaw;
  const hips = new THREE.Bone(), spine = new THREE.Bone(), neck = new THREE.Bone(), head = new THREE.Bone(), arm = new THREE.Bone();
  hips.name = "Hips"; spine.name = "Spine02"; neck.name = "neck"; head.name = "Head"; arm.name = "LeftArm";
  visual.add(hips); hips.add(spine); spine.add(neck, arm); neck.add(head);
  const foot = new THREE.Bone(); foot.name = "LeftFoot"; foot.position.set(-.15, 0, .05); hips.add(foot);
  spine.position.y = .5; neck.position.y = .4; head.position.y = .15;
  const rig = new LivingPieceRig(visual, hips);
  return { anchor, visual, hips, spine, neck, head, arm, foot, rig };
}

describe("living chess skeleton reactions", () => {
  const observerCue = (headOnly = false): BoardReactionCue => new BoardReactionDirector(headOnly ? "low" : "high").plan(
    { id: "mate", type: "checkmate", point: { x: 3, y: 0, z: 5 }, focus: { x: 6, y: 0, z: 6 }, kingId: "king", victimColor: "b" },
    [{ id: "king", square: "d6", kind: "k", color: "b", point: { x: 3, y: 0, z: 5 } }],
  ).reactions[0].cue;

  it("layers a defiant living King over the sampled pose without moving the board anchor or feet", () => {
    const f = figure(), pose = [f.hips, f.spine, f.head, f.arm].map(b => b.position.clone()), anchor = f.anchor.position.clone();
    const foot = f.foot.getWorldPosition(new THREE.Vector3());
    f.rig.observe(observerCue());
    for (let i = 0; i < 60; i++) { f.rig.restore(); f.rig.apply(1/60, i/60, false, false); }
    expect(f.head.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.1);
    expect(f.arm.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.02);
    expect(f.anchor.position.equals(anchor)).toBe(true);
    expect(f.foot.getWorldPosition(new THREE.Vector3()).distanceTo(foot)).toBeLessThan(1e-7);
    [f.hips, f.spine, f.head, f.arm].forEach((b, i) => expect(b.position.equals(pose[i])).toBe(true));
    // Let go, the look eases back over a third of a second instead of snapping; then the sampled pose is exact again.
    f.rig.restore(); f.rig.clearObservation(); f.rig.apply(1/60, 1, false, false);
    expect(f.head.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.05);
    for (let i = 1; i <= 30; i++) { f.rig.restore(); f.rig.apply(1/60, 1+i/60, false, false); }
    expect(f.head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
    expect(f.arm.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
    // A reset or a death lets it go at once.
    f.rig.observe(observerCue()); for (let i = 0; i < 30; i++) { f.rig.restore(); f.rig.apply(1/60, i/60, false, false); }
    f.rig.restore(); f.rig.clearObservation(true); f.rig.apply(1/60, 1, false, false);
    expect(f.head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
  });

  it("limits Low observer cues to head and neck and clears them on reduced motion or reset", () => {
    const f = figure(); f.rig.observe(observerCue(true));
    for (let i = 0; i < 30; i++) { f.rig.restore(); f.rig.apply(1/60, i/60, false, false); }
    expect(f.head.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.1);
    expect(f.spine.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
    expect(f.arm.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
    f.rig.setEnabled(false); expect(f.rig.hasReaction).toBe(false);
    expect(f.head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
    f.rig.setEnabled(true); f.rig.observe(observerCue()); f.rig.reset(); expect(f.rig.hasReaction).toBe(false);
  });

  it("expires finite observation overlays and refuses to animate a corpse as a witness", () => {
    const f = figure(); f.rig.observe({ ...observerCue(), sustained: false, duration: .5, delay: .1 });
    for (let i = 0; i < 120; i++) { f.rig.restore(); f.rig.apply(1/60, i/60, false, false); }
    expect(f.rig.hasReaction).toBe(false); expect(f.head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
    f.rig.beginDeath(); f.rig.observe(observerCue()); f.rig.apply(.016, 2, false, false);
    expect(f.rig.hasReaction).toBe(false);
  });

  it("flinches away from a witnessed impact rather than leaning into the fight", () => {
    const f = figure(); f.anchor.updateMatrixWorld(true);
    const before = f.head.getWorldPosition(new THREE.Vector3());
    f.rig.observe({ ...observerCue(), target: { x: 3, y: 0, z: 10 }, sustained: false, gaze: 0, grip: 0, posture: 0, flinch: .14, delay: 0 });
    f.rig.apply(.1, .1, false, false); f.anchor.updateMatrixWorld(true);
    expect(f.head.getWorldPosition(new THREE.Vector3()).z).toBeLessThan(before.z);
    expect(f.anchor.position.toArray()).toEqual([3, 0, 5]);
  });

  it("recognizes the real GLB joint names and moves the body without moving its square or joints", () => {
    const f = figure();
    const anchor = f.anchor.position.clone(), positions = [f.hips, f.spine, f.head].map(b => b.position.clone());
    // Spine, head and arm react; the hips are held for the duel layer alone.
    expect(f.rig.jointCount).toBe(5);
    f.rig.impact(new THREE.Vector3(0, 0, 1), 1.5); f.rig.apply(1 / 60, 0, false, false);
    expect(f.spine.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.03);
    expect(f.head.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.03);
    expect(f.arm.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.01);
    expect(f.anchor.position.equals(anchor)).toBe(true);
    [f.hips, f.spine, f.head].forEach((b, i) => expect(b.position.equals(positions[i])).toBe(true));
  });

  it("recoils away from the hit in world space even when the figure faces the other way", () => {
    for (const yaw of [0, Math.PI / 2, Math.PI]) {
      for (const direction of [-1, 1]) {
        const f = figure(yaw); f.anchor.updateMatrixWorld(true);
        const before = f.head.getWorldPosition(new THREE.Vector3());
        f.rig.impact(new THREE.Vector3(0, 0, direction)); f.rig.apply(1 / 60, 0, false, false);
        f.anchor.updateMatrixWorld(true);
        expect((f.head.getWorldPosition(new THREE.Vector3()).z - before.z) * direction).toBeGreaterThan(.015);
      }
    }
  });

  it("restores the sampled animation pose exactly, with no drift over repeated mixer frames", () => {
    const f = figure();
    for (let frame = 0; frame < 360; frame++) {
      f.rig.restore();
      const sampled = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), frame * .002);
      f.spine.quaternion.copy(sampled);
      f.rig.apply(1 / 60, frame / 60, true, false);
      f.rig.restore();
      expect(f.spine.quaternion.angleTo(sampled)).toBeLessThan(1e-7);
    }
  });

  it("holds a defensive stance throughout the approach and releases it for death", () => {
    const f = figure(); f.rig.brace(new THREE.Vector3(7, 0, 7));
    for (let i = 0; i < 180; i++) { f.rig.restore(); f.rig.apply(1 / 60, i / 60, false, false); }
    expect(f.head.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.1);
    expect(f.arm.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.1);
    f.rig.restore(); f.rig.beginDeath(); f.rig.apply(1 / 60, 3, true, false);
    expect(f.head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
    expect(f.arm.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
  });

  it("a nearby witness looks toward an impact and then resumes its sampled pose", () => {
    const f = figure(); f.rig.notice(new THREE.Vector3(6, 0, 6), .8);
    f.rig.apply(1 / 60, 0, false, false);
    expect(f.head.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.1);
    for (let i = 0; i < 120; i++) { f.rig.restore(); f.rig.apply(1 / 60, i / 60, false, false); }
    expect(f.rig.hasReaction).toBe(false);
    expect(f.head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
  });

  it("disabling motion clears the pose, pending contact hold and further reactions", () => {
    const f = figure(); f.rig.impact(new THREE.Vector3(1, 0, 0)); f.rig.hold(.1);
    f.rig.apply(.02, 1, true, false); f.rig.setEnabled(false);
    f.rig.brace(new THREE.Vector3(9, 0, 9)); f.rig.impact(new THREE.Vector3(1, 0, 0));
    f.rig.apply(.02, 2, true, false);
    expect(f.spine.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
    expect(f.rig.hasReaction).toBe(false); expect(f.rig.animationDelta(.02)).toBe(.02);
    f.rig.setEnabled(true); f.rig.impact(new THREE.Vector3(1, 0, 0));
    expect(f.rig.hasReaction).toBe(true);
  });

  it("holds only the attacking clip briefly and preserves excess elapsed time", () => {
    const f = figure(); f.rig.hold(.06);
    expect(f.rig.animationDelta(.04)).toBe(0);
    expect(f.rig.animationDelta(.04)).toBeCloseTo(.02);
    expect(f.rig.animationDelta(.04)).toBe(.04);
    f.rig.hold(99); expect(f.rig.animationDelta(.2)).toBeCloseTo(.06);
    f.rig.reset(); expect(f.rig.animationDelta(.02)).toBe(.02);
  });

  it("settles the death recoil under uneven frame times without restarting idle motion", () => {
    const f = figure(); f.rig.impact(new THREE.Vector3(0, 0, -1), 2); f.rig.beginDeath();
    for (let i = 0; i < 180; i++) {
      f.rig.restore(); f.rig.apply([.016, .033, .08][i % 3], i, true, false);
      expect(f.spine.quaternion.toArray().every(Number.isFinite)).toBe(true);
    }
    expect(f.rig.hasReaction).toBe(false);
    expect(f.spine.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
    f.rig.reset(); f.rig.apply(.016, 1, true, false);
    expect(f.spine.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.001);
  });

  it("leaves an unrigged fallback intact", () => {
    const model = new THREE.Group(), rig = new LivingPieceRig(model, model);
    rig.impact(new THREE.Vector3(1, 0, 0)); rig.apply(.016, 1, true, false); rig.restore();
    expect(rig.jointCount).toBe(0); expect(model.quaternion.equals(new THREE.Quaternion())).toBe(true);
  });

  const griefCue = (target = { x: 3, y: 0, z: 9 }): BoardReactionCue => ({ target, pose: "grief", gaze: .9, flinch: .05, grip: -.09, posture: .065, bow: .17, sigh: .022,
    onset: .55, release: 1.1, duration: 4.2, delay: .3, sustained: false, headOnly: false });

  it("hands one look over to the next, and eases a look back when it is let go, without a snap", () => {
    const f = figure(), first = { ...observerCue(), sustained: false, duration: 3, delay: 0 };
    let previous = 0, biggest = 0;
    for (let i = 0; i < 400; i++) {
      if (i === 0) f.rig.observe(first);
      if (i === 60) f.rig.observe(griefCue({ x: 1, y: 0, z: 9 }));
      if (i === 240) f.rig.clearObservation();
      f.rig.restore(); f.rig.apply(1/60, i/60, false, false);
      const angle = f.head.quaternion.angleTo(new THREE.Quaternion());
      if (i > 20) biggest = Math.max(biggest, Math.abs(angle-previous));
      previous = angle;
    }
    expect(biggest).toBeLessThan(.06);
    expect(f.rig.hasReaction).toBe(false);
  });

  it("bows the head in grief over the sampled pose, keeping feet, anchor and joints, and gives it back exactly", () => {
    const f = figure(); f.anchor.updateMatrixWorld(true);
    const nose = () => new THREE.Vector3(0, 0, 1).applyQuaternion(f.head.getWorldQuaternion(new THREE.Quaternion()));
    const level = nose().y, foot = f.foot.getWorldPosition(new THREE.Vector3()), anchor = f.anchor.position.clone(), joints = [f.hips, f.spine, f.head, f.arm].map(b => b.position.clone());
    f.rig.observe({ ...griefCue(), delay: 0 });
    for (let i = 0; i < 90; i++) { f.rig.restore(); f.rig.apply(1/60, i/60, false, false); }
    f.anchor.updateMatrixWorld(true);
    expect(level-nose().y).toBeGreaterThan(.1);
    expect(f.foot.getWorldPosition(new THREE.Vector3()).distanceTo(foot)).toBeLessThan(1e-7);
    expect(f.anchor.position.equals(anchor)).toBe(true);
    [f.hips, f.spine, f.head, f.arm].forEach((b, i) => expect(b.position.equals(joints[i])).toBe(true));
    for (let i = 0; i < 300; i++) { f.rig.restore(); f.rig.apply(1/60, 2+i/60, false, false); }
    expect(f.rig.hasReaction).toBe(false);
    expect(f.head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
  });

  it("carries the army's mood only while standing, eased in and out, and restores the sampled pose exactly under it", () => {
    const f = figure(); f.rig.setMood(1, .5, 0);
    for (let i = 0; i < 600; i++) { f.rig.restore(); f.rig.apply(1/60, i/60, true, false); }
    expect(f.head.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.03);
    for (let i = 0; i < 120; i++) { f.rig.restore(); f.rig.apply(1/60, 10+i/60, false, false); }
    expect(f.rig.hasReaction).toBe(false);
    expect(f.head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
    const g = figure(); g.rig.setMood(.8, .3, 0, true); g.rig.observe(griefCue());
    for (let frame = 0; frame < 360; frame++) {
      g.rig.restore();
      const sampled = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), frame * .002);
      g.spine.quaternion.copy(sampled);
      g.rig.apply(1/60, frame/60, true, false);
      g.rig.restore();
      expect(g.spine.quaternion.angleTo(sampled)).toBeLessThan(1e-7);
    }
    g.rig.beginDeath(); g.rig.apply(1/60, 7, false, false);
    expect(g.rig.hasReaction).toBe(false);
  });
});

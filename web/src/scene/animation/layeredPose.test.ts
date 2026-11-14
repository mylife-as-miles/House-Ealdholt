/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LayerFade, bodyMask, chargeGuard, guardHandover, layerTime, layeredSpine, smoothWeight, spineProxy, unit, witnessGuard, type SkeletonNode } from "./layeredPose";

const chess = resolve(process.cwd(), "src/assets/chess");
const skeletons = ["combat-v2", "combat-v1", "combat-ranks"].flatMap(folder => readdirSync(resolve(chess, folder))
  .filter(file => file.endsWith("-skeleton.json")).map(file => ({ file: `${folder}/${file}`, nodes: JSON.parse(readFileSync(resolve(chess, folder, file), "utf8")).nodes as SkeletonNode[] })));

const UPPER = ["Spine02", "Spine01", "Spine", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand",
  "neck", "Head", "head_end", "headfront"];
const LOWER = ["Armature", "Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"];

/** Deterministic quaternions for the algebra (no Math.random in a test either). */
function quaternions(count: number, seed = 7): THREE.Quaternion[] {
  let s = seed >>> 0;
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  return Array.from({ length: count }, () => new THREE.Quaternion().setFromEuler(new THREE.Euler((next() - .5) * 3, (next() - .5) * 6, (next() - .5) * 3)));
}
const angle = (a: THREE.Quaternion, b: THREE.Quaternion) => a.angleTo(b);

describe("the body mask on the figures' shared skeleton", () => {
  it("finds every baked rig's skeleton (combat-v1, combat-v2 and the rank libraries)", () => {
    expect(skeletons.length).toBeGreaterThanOrEqual(18);
  });

  for (const { file, nodes } of skeletons) it(`splits ${file} at Spine02: Hips, legs and root below, spine, arms and head above`, () => {
    const mask = bodyMask(nodes)!;
    expect(mask).not.toBeNull();
    expect(mask.hips).toBe("Hips");
    expect(mask.spine).toBe("Spine02");
    expect([...mask.upper].sort()).toEqual([...UPPER].sort());
    expect([...mask.lower].sort()).toEqual([...LOWER].sort());
    // Parents before children, the spine root first: the order the layer writes them in.
    expect(mask.upper[0]).toBe("Spine02");
    const parent = new Map(nodes.map(node => [node.name, node.parent]));
    mask.upper.forEach((name, index) => { if (index > 0) expect(mask.upper.indexOf(parent.get(name)!)).toBeLessThan(index); });
    // Every bone is in exactly one half.
    expect(new Set([...mask.upper, ...mask.lower]).size).toBe(nodes.length);
  });

  it("reads Mixamo-prefixed names, and refuses a rig it cannot split", () => {
    const mixamo: SkeletonNode[] = [
      { name: "mixamorigHips", parent: null }, { name: "mixamorigSpine", parent: "mixamorigHips" }, { name: "mixamorigNeck", parent: "mixamorigSpine" },
      { name: "mixamorigHead", parent: "mixamorigNeck" }, { name: "mixamorigLeftUpLeg", parent: "mixamorigHips" },
    ];
    expect(bodyMask(mixamo)).toEqual({ hips: "mixamorigHips", spine: "mixamorigSpine", upper: ["mixamorigSpine", "mixamorigNeck", "mixamorigHead"], lower: ["mixamorigHips", "mixamorigLeftUpLeg"] });
    expect(bodyMask([{ name: "Root", parent: null }, { name: "Head", parent: "Root" }])).toBeNull();
    expect(bodyMask([{ name: "Hips", parent: null }, { name: "Spine", parent: "Hips" }])).toBeNull();
    // A head that does not hang from the hips (a prop, a second rig) is not a body to layer.
    expect(bodyMask([{ name: "Hips", parent: null }, { name: "Prop", parent: null }, { name: "Head", parent: "Prop" }])).toBeNull();
  });
});

describe("the Spine Proxy", () => {
  it("gives the spine, under any hips, the rotation in the figure's frame it has in the upper clip", () => {
    const qs = quaternions(60);
    for (let i = 0; i + 2 < qs.length; i += 3) {
      const [hipsNow, hipsUpper, spineUpper] = [qs[i], qs[i + 1], qs[i + 2]];
      const spine = spineProxy(new THREE.Quaternion(), hipsNow, hipsUpper, spineUpper);
      const want = hipsUpper.clone().multiply(spineUpper), got = hipsNow.clone().multiply(spine);
      expect(angle(got, want)).toBeLessThan(1e-5);
    }
  });

  it("changes nothing when the hips already are the upper clip's, and may write into its own inputs", () => {
    const [hips, spine] = quaternions(2, 11);
    expect(angle(spineProxy(new THREE.Quaternion(), hips, hips, spine), spine)).toBeLessThan(1e-6);
    const into = spine.clone();
    spineProxy(into, quaternions(1, 3)[0], hips, into);
    expect(angle(quaternions(1, 3)[0].clone().multiply(into), hips.clone().multiply(spine))).toBeLessThan(1e-5);
  });

  it("blends from the lower clip's spine to the proxy by the layer's weight, and to the plain mask by the correction", () => {
    const [lower, upper, hipsNow, hipsUpper] = quaternions(4, 5);
    const proxied = spineProxy(new THREE.Quaternion(), hipsNow, hipsUpper, upper);
    expect(angle(layeredSpine(new THREE.Quaternion(), lower, upper, proxied, 0), lower)).toBeLessThan(1e-6);
    expect(angle(layeredSpine(new THREE.Quaternion(), lower, upper, proxied, 1), proxied)).toBeLessThan(1e-6);
    expect(angle(layeredSpine(new THREE.Quaternion(), lower, upper, proxied, 1, 0), upper)).toBeLessThan(1e-6);
    // Monotone and continuous in the weight: no step anywhere along a fade.
    let last = 0, previous = lower.clone();
    for (let w = 0; w <= 1.0001; w += .05) {
      const q = layeredSpine(new THREE.Quaternion(), lower, upper, proxied, w);
      const from = angle(q, lower);
      expect(from).toBeGreaterThanOrEqual(last - 1e-6);
      expect(angle(q, previous)).toBeLessThan(angle(lower, proxied) * .05 + 1e-4);
      last = from; previous = q;
    }
    expect(angle(layeredSpine(new THREE.Quaternion(), lower, upper, proxied, NaN), lower)).toBeLessThan(1e-6);
  });
});

describe("layer weights", () => {
  it("arrive in exactly the seconds asked, from wherever they stand", () => {
    const fade = new LayerFade();
    fade.to(1, .4);
    for (let i = 0; i < 4; i += 1) { expect(fade.settled).toBe(false); fade.advance(.1); }
    expect(fade.level).toBeCloseTo(1, 10);
    expect(fade.settled).toBe(true);
    fade.to(0, .3);
    fade.advance(.15);
    expect(fade.level).toBeCloseTo(.5, 10);
    expect(fade.weight).toBeCloseTo(.5, 10);
    // Turned round half way: back up in exactly the new fade's time.
    fade.to(1, .2);
    fade.advance(.1); expect(fade.level).toBeCloseTo(.75, 10);
    fade.advance(.1); expect(fade.level).toBeCloseTo(1, 10);
  });

  it("are read through a smoothstep, scaled by their peak, and ignore bad input", () => {
    expect(smoothWeight(0)).toBe(0);
    expect(smoothWeight(1)).toBe(1);
    expect(smoothWeight(.25)).toBeCloseTo(.15625, 10);
    for (let i = 0; i < 10; i += 1) expect(smoothWeight((i + 1) / 10)).toBeGreaterThan(smoothWeight(i / 10));
    const fade = new LayerFade();
    fade.peak = .6; fade.to(1, 0);
    expect(fade.weight).toBeCloseTo(.6, 10);
    fade.advance(NaN); fade.advance(-1);
    expect(fade.weight).toBeCloseTo(.6, 10);
    fade.to(NaN, .2); fade.advance(.2);
    expect(fade.weight).toBe(0);
    expect(unit(2)).toBe(1); expect(unit(-1)).toBe(0); expect(unit(Infinity)).toBe(0);
  });

  it("do not depend on how the time is cut into frames", () => {
    const steady = new LayerFade(), ragged = new LayerFade();
    steady.to(1, .5); ragged.to(1, .5);
    for (let i = 0; i < 30; i += 1) steady.advance(1 / 60);
    for (const dt of [.1, .033, .2, .017, .15]) ragged.advance(dt);
    expect(ragged.level).toBeCloseTo(steady.level, 10);
  });
});

describe("the layer's clock", () => {
  const clip = { duration: 2, from: 0, rate: 1, loop: false };
  it("plays once and keeps the last frame, loops, or runs to a held frame and stays", () => {
    expect(layerTime(clip, .5)).toBeCloseTo(.5);
    expect(layerTime(clip, 3)).toBe(2);
    expect(layerTime({ ...clip, loop: true }, 2.5)).toBeCloseTo(.5);
    expect(layerTime({ ...clip, loop: true, from: 1.5 }, 1)).toBeCloseTo(.5);
    expect(layerTime({ ...clip, hold: .3 }, .2)).toBeCloseTo(.2);
    expect(layerTime({ ...clip, hold: .3 }, 5)).toBeCloseTo(.3);
    // Held behind where it starts: it runs back to it, whatever the rate's sign.
    expect(layerTime({ ...clip, from: 1, hold: .4, rate: 2 }, .1)).toBeCloseTo(.8);
    expect(layerTime({ ...clip, from: 1, hold: .4 }, 9)).toBeCloseTo(.4);
    // A still frame.
    expect(layerTime({ ...clip, from: .7, rate: 0 }, 9)).toBeCloseTo(.7);
    expect(layerTime({ ...clip, rate: -1, from: 2 }, .5)).toBeCloseTo(1.5);
    expect(layerTime({ ...clip, hold: 9 }, 9)).toBe(2);
  });
});

describe("which guard a figure holds", () => {
  const library = (...ids: string[]) => (id: string) => ids.includes(id);
  const markers: Record<string, number> = { "ready.stance": .83, "defend.block": .47, "defend.block-mid": .3 };
  const marker = (id: string) => markers[id] ?? null;

  it("a charging killer: its library's guard loop, else the v1 stance held at its ready frame, else its blow held at the wind-up", () => {
    const thrust = { id: "attack.thrust", windup: .3 };
    expect(chargeGuard(library("ready.guard", "ready.stance", "attack.thrust"), marker, thrust)).toEqual({ id: "ready.guard", loop: true, strike: false });
    expect(chargeGuard(library("ready.stance", "attack.thrust"), marker, thrust)).toEqual({ id: "ready.stance", loop: false, hold: .83, strike: false });
    expect(chargeGuard(library(), marker, { id: "attack", windup: .19 })).toEqual({ id: "attack", loop: false, hold: .19, strike: true });
    expect(chargeGuard(library(), marker, null)).toBeNull();
    expect(chargeGuard(library(), marker, { id: "attack", windup: 0 })).toBeNull();
  });

  it("a witness: the duel guard loop, else a block held at its guard frame, else none", () => {
    expect(witnessGuard(library("ready.guard", "defend.block"), marker)).toEqual({ id: "ready.guard", loop: true, strike: false });
    expect(witnessGuard(library("defend.block"), marker)).toEqual({ id: "defend.block", loop: false, hold: .47, strike: false });
    expect(witnessGuard(library("defend.block-mid"), marker)).toEqual({ id: "defend.block-mid", loop: false, hold: .3, strike: false });
    expect(witnessGuard(library("attack.strike"), marker)).toBeNull();
  });

  it("a guard that is the blow's own opening holds until the blow has caught up; any other blends over the wind-up", () => {
    expect(guardHandover({ strike: true }, .3)).toEqual({ after: .3 - .08, fade: .08 });
    const short = guardHandover({ strike: true }, .05);
    expect(short.after).toBe(0); expect(short.fade).toBeCloseTo(.05, 10);
    // Either way the layer is gone by the wind-up frame, so the blow from there on is the clip's own.
    for (const windup of [.05, .16, .3, .9]) { const h = guardHandover({ strike: true }, windup); expect(h.after + h.fade).toBeCloseTo(windup, 10); }
    expect(guardHandover({ strike: false }, .3)).toEqual({ after: 0, fade: .3 });
    expect(guardHandover({ strike: false }, .02)).toEqual({ after: 0, fade: .1 });
    expect(guardHandover({ strike: false }, NaN)).toEqual({ after: 0, fade: .1 });
  });
});

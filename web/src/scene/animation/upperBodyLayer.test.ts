/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { UpperBodyLayer } from "./upperBodyLayer";
import { smoothWeight } from "./layeredPose";

const folder = resolve(process.cwd(), "src/assets/chess/combat-v2");
type Node = { name: string; parent: string | null; translation?: number[]; rotation?: number[]; scale?: number[] };

/** The Aethelgard Pawn's real skeleton, standing on a square somewhere on the board and turned to face along it. */
function figure(yaw = .9) {
  const nodes = JSON.parse(readFileSync(resolve(folder, "wp-skeleton.json"), "utf8")).nodes as Node[];
  const root = new THREE.Group(), bones = new Map<string, THREE.Object3D>();
  root.position.set(1.5, .2, -2.5); root.rotation.y = yaw; root.scale.setScalar(.012);
  for (const node of nodes) {
    const bone = node.name === "Armature" ? new THREE.Object3D() : new THREE.Bone();
    bone.name = node.name;
    if (node.translation) bone.position.fromArray(node.translation);
    if (node.rotation) bone.quaternion.fromArray(node.rotation);
    if (node.scale) bone.scale.fromArray(node.scale);
    bones.set(node.name, bone);
  }
  for (const node of nodes) (node.parent ? bones.get(node.parent)! : root).add(bones.get(node.name)!);
  root.updateMatrixWorld(true);
  return { root, bones };
}

const bytes = readFileSync(resolve(folder, "wp.glb"));
const library = new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")
  .then(gltf => new Map(gltf.animations.map(clip => [clip.name, clip])));

/** Poses `model` with `clip` alone at `time`, as a figure's mixer would. */
function pose(model: ReturnType<typeof figure>, clip: THREE.AnimationClip, time: number): void {
  const mixer = new THREE.AnimationMixer(model.root);
  const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  mixer.setTime(Math.min(time, clip.duration - 1e-4));
  // Left bound: stopping the action would hand the bones back their bind pose.
  model.root.updateMatrixWorld(true);
}
/** The angle between two rotations, well conditioned near zero (angleTo's acos is not). */
function turn(a: THREE.Quaternion, b: THREE.Quaternion): number {
  const d = a.clone().invert().multiply(b);
  return 2 * Math.atan2(Math.hypot(d.x, d.y, d.z), Math.abs(d.w));
}
const world = (model: ReturnType<typeof figure>, name: string) => model.bones.get(name)!.getWorldQuaternion(new THREE.Quaternion());
const snapshot = (model: ReturnType<typeof figure>) => new Map([...model.bones].map(([name, bone]) => [name, { q: bone.quaternion.clone(), p: bone.position.clone() }]));

const UPPER_CHAIN = ["Spine02", "Spine01", "Spine", "neck", "Head", "LeftArm", "LeftHand", "RightArm", "RightForeArm", "RightHand"];
const LOWER = ["Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"];
/** Lower clips whose hips swing, turn and travel: the steps, the dodges, a stagger. */
const LOWER_CLIPS = ["ready.step-forward", "ready.step-back", "defend.dodge-left", "defend.dodge-right", "hit.stagger-heavy", "recovery.victory"];

describe("an upper-body layer on the Pawn's real rig and clips", () => {
  it("keeps the spine's (and so every upper bone's) rotation in the figure's frame as in the upper clip, whatever the lower clip does to the hips", async () => {
    const clips = await library, guard = clips.get("ready.guard")!, thrust = clips.get("attack.thrust")!;
    let worstSpine = 0, worstHands = 0, hipsSwing = 0;
    for (const upper of [guard, thrust]) for (const lowerName of LOWER_CLIPS) {
      const lower = clips.get(lowerName)!;
      for (const [lt, ut] of [[.1, .4], [lower.duration * .5, upper.duration * .3], [lower.duration * .9, upper.duration * .8]]) {
        // What the upper clip alone puts the torso at, on the same figure.
        const alone = figure(); pose(alone, upper, ut);
        const layered = figure(); pose(layered, lower, lt);
        const legs = snapshot(layered);
        hipsSwing = Math.max(hipsSwing, turn(world(layered, "Hips"), world(alone, "Hips")));
        const layer = new UpperBodyLayer(layered.root);
        expect(layer.play(upper, { fade: 0, from: ut, rate: 0 })).toBe(true);
        layer.apply(1 / 60);
        layered.root.updateMatrixWorld(true);
        worstSpine = Math.max(worstSpine, turn(world(layered, "Spine02"), world(alone, "Spine02")));
        for (const name of UPPER_CHAIN) worstHands = Math.max(worstHands, turn(world(layered, name), world(alone, name)));
        // The hips, the legs and every translation are the lower clip's, untouched: the feet stay where it put them.
        for (const name of LOWER) expect(layered.bones.get(name)!.quaternion.equals(legs.get(name)!.q)).toBe(true);
        for (const [name, bone] of layered.bones) expect(bone.position.equals(legs.get(name)!.p)).toBe(true);
      }
    }
    // The lower clips really do move the hips away from the upper clip's...
    expect(hipsSwing).toBeGreaterThan(.2);
    // ...and the torso does not follow them.
    expect(worstSpine).toBeLessThan(1e-6);
    expect(worstHands).toBeLessThan(1e-6);
  });

  it("is what a plain mask gets wrong: without the proxy the torso inherits the lower clip's hips", async () => {
    const clips = await library, guard = clips.get("ready.guard")!, lower = clips.get("defend.dodge-left")!;
    const alone = figure(); pose(alone, guard, .5);
    const layered = figure(); pose(layered, lower, .25);
    const layer = new UpperBodyLayer(layered.root);
    layer.play(guard, { fade: 0, from: .5, rate: 0, correction: 0 });
    layer.apply(1 / 60);
    layered.root.updateMatrixWorld(true);
    const hipsOff = turn(world(layered, "Hips"), world(alone, "Hips"));
    expect(turn(world(layered, "Spine02"), world(alone, "Spine02"))).toBeGreaterThan(hipsOff * .5);
  });

  it("puts back exactly the pose the mixer left, so a held pose never stacks the layer", async () => {
    const clips = await library, model = figure(); pose(model, clips.get("ready.step-forward")!, .4);
    const before = snapshot(model), layer = new UpperBodyLayer(model.root);
    layer.play(clips.get("ready.guard")!, { fade: 0, loop: true });
    for (let frame = 0; frame < 5; frame += 1) {
      layer.restore();
      for (const [name, bone] of model.bones) expect(bone.quaternion.equals(before.get(name)!.q)).toBe(true);
      layer.apply(1 / 30);
    }
    expect(model.bones.get("Spine01")!.quaternion.equals(before.get("Spine01")!.q)).toBe(false);
    layer.restore();
    for (const [name, bone] of model.bones) expect(bone.quaternion.equals(before.get(name)!.q)).toBe(true);
  });

  it("blends by its weight: the lower clip's own upper body at 0, the upper clip's at 1, smoothly between", async () => {
    const clips = await library, guard = clips.get("ready.guard")!, lower = clips.get("ready.step-back")!;
    const at = (weight: number) => {
      const model = figure(); pose(model, lower, .5);
      const layer = new UpperBodyLayer(model.root);
      layer.play(guard, { fade: 0, from: 1, rate: 0, weight });
      layer.apply(1 / 60); model.root.updateMatrixWorld(true);
      return new Map(UPPER_CHAIN.map(name => [name, world(model, name)]));
    };
    const none = figure(); pose(none, lower, .5);
    for (const name of UPPER_CHAIN) expect(turn(at(0).get(name)!, world(none, name))).toBeLessThan(1e-6);
    const alone = figure(); pose(alone, guard, 1);
    for (const name of UPPER_CHAIN) expect(turn(at(1).get(name)!, world(alone, name))).toBeLessThan(1e-4);
    let previous = at(0);
    for (let w = .1; w <= 1.0001; w += .1) {
      const next = at(w);
      // No step anywhere along a fade: each tenth moves the hand a tenth of the way, give or take.
      for (const name of ["Spine02", "Head", "RightHand"]) expect(turn(next.get(name)!, previous.get(name)!)).toBeLessThan(.12);
      previous = next;
    }
  });

  it("fades in and out over the seconds asked, through a smoothstep, on the animation delta alone", async () => {
    const clips = await library, model = figure(), layer = new UpperBodyLayer(model.root);
    layer.play(clips.get("ready.guard")!, { fade: .3, loop: true, owner: "charge" });
    expect(layer.weight).toBe(0);
    layer.apply(.15);
    expect(layer.weight).toBeCloseTo(smoothWeight(.5), 6);
    layer.apply(.15);
    expect(layer.weight).toBeCloseTo(1, 6);
    // Another owner cannot let it go; its own can.
    layer.stop(.2, { owner: "reaction" });
    layer.apply(.1); expect(layer.weight).toBeCloseTo(1, 6);
    layer.stop(.2, { owner: "charge" });
    layer.apply(.1); expect(layer.weight).toBeCloseTo(.5, 6);
    expect(layer.active).toBe(true);
    layer.apply(.1); expect(layer.weight).toBe(0);
    layer.apply(0); expect(layer.active).toBe(false);
  });

  it("holds a wind-up, waits out a delay, lets go by itself, and hands one clip over to the next without a jump", async () => {
    const clips = await library, guard = clips.get("ready.guard")!, thrust = clips.get("attack.thrust")!;
    const model = figure(); pose(model, clips.get("ready.step-forward")!, .3);
    const layer = new UpperBodyLayer(model.root);
    layer.play(thrust, { fade: .1, hold: .3, delay: .2, until: .8, release: .2 });
    layer.apply(.1); expect(layer.weight).toBe(0);
    layer.apply(.15); expect(layer.weight).toBeCloseTo(smoothWeight(.5), 6);
    layer.apply(.5); expect(layer.weight).toBeCloseTo(1, 6);
    layer.restore(); layer.apply(.1);
    expect(layer.weight).toBeCloseTo(1, 6);
    // Held: the thrust's ready frame stays where it is however long it is held.
    const alone = figure(); pose(alone, thrust, .3);
    model.root.updateMatrixWorld(true);
    expect(turn(world(model, "RightHand"), world(alone, "RightHand"))).toBeLessThan(1e-4);
    layer.restore(); layer.apply(.05);
    expect(layer.weight).toBeCloseTo(1, 6);
    // 0.8 s after it came in it lets go, over 0.2 s.
    layer.restore(); layer.apply(.2);
    expect(layer.weight).toBeCloseTo(smoothWeight(.5), 6);
    layer.restore(); layer.apply(.1);
    expect(layer.weight).toBe(0);
    // A hand-over: the guard comes in while the held thrust goes, frame by frame, with no step in the hand.
    layer.play(thrust, { fade: 0, hold: .3, from: .3 });
    layer.restore(); layer.apply(1 / 30);
    model.root.updateMatrixWorld(true);
    let last = world(model, "RightHand");
    layer.play(guard, { fade: .25, loop: true });
    let biggest = 0;
    for (let frame = 0; frame < 12; frame += 1) {
      layer.restore(); layer.apply(1 / 30); model.root.updateMatrixWorld(true);
      const now = world(model, "RightHand");
      biggest = Math.max(biggest, turn(now, last)); last = now;
    }
    const end = figure(); pose(end, guard, 0);
    expect(biggest).toBeLessThan(turn(end.bones.get("RightHand")!.getWorldQuaternion(new THREE.Quaternion()), world(alone, "RightHand")) * .3 + .05);
    expect(layer.clip).toBe(guard);
  });

  it("lands on the same pose however the time is cut into frames (a replay at another frame rate matches)", async () => {
    const clips = await library, guard = clips.get("ready.guard")!, lower = clips.get("ready.step-forward")!;
    const run = (frames: readonly number[]) => {
      const model = figure(); pose(model, lower, .6);
      const layer = new UpperBodyLayer(model.root);
      layer.play(guard, { fade: .4, loop: true, delay: .15 });
      for (const dt of frames) { layer.restore(); layer.apply(dt); }
      model.root.updateMatrixWorld(true);
      return { weight: layer.weight, hand: world(model, "RightHand"), head: world(model, "Head") };
    };
    const steady = run(Array.from({ length: 42 }, () => 1 / 60)), ragged = run([.1, .033, .2, .017, .05, .3]);
    expect(ragged.weight).toBeCloseTo(steady.weight, 9);
    expect(turn(ragged.hand, steady.hand)).toBeLessThan(1e-6);
    expect(turn(ragged.head, steady.head)).toBeLessThan(1e-6);
  });

  it("leaves a rig it cannot split alone", () => {
    const root = new THREE.Group(), bone = new THREE.Bone(); bone.name = "Root"; root.add(bone);
    const layer = new UpperBodyLayer(root);
    expect(layer.usable).toBe(false);
    expect(layer.play(new THREE.AnimationClip("x", 1, []))).toBe(false);
    layer.apply(.1); layer.restore();
    expect(layer.active).toBe(false);
  });
});

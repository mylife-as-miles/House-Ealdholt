import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { SORCERER_RISE, claimantOf, reviveSorcerer } from "./arena-sorcerer";

const named = (name: string, x = 0, y = 0, z = 0) => {
  const node = new THREE.Bone();
  // GLTFLoader gives every node the sanitized form of its name; the module looks bones up the same way.
  node.name = THREE.PropertyBinding.sanitizeNodeName(name);
  node.position.set(x, y, z);
  return node;
};
const sculpt = (width = 1.6) => new THREE.BoxGeometry(width, 2, 0.4).translate(0, 1, 0);

/** A stand-in for the rigged sorcerer: a spine, a head and four arms, with the two clips the module plays. */
function rigged(options: { idle?: boolean; width?: number } = {}) {
  const root = named("ROOT"), hips = named("mixamorig:Hips", 0, 1, 0);
  const spine = named("mixamorig:Spine", 0, 0.2, 0), spine1 = named("mixamorig:Spine1", 0, 0.2, 0), spine2 = named("mixamorig:Spine2", 0, 0.2, 0);
  const neck = named("mixamorig:Neck", 0, 0.2, 0), head = named("mixamorig:Head", 0, 0.1, 0);
  root.add(hips); hips.add(spine); spine.add(spine1); spine1.add(spine2); spine2.add(neck); neck.add(head);
  const bones = [root, hips, spine, spine1, spine2, neck, head];
  const arm = (upper: string, fore: string, hand: string, side: number, height: number) => {
    const a = named(upper, 0.3 * side, height, 0), b = named(fore, 0.4 * side, 0, 0), c = named(hand, 0.4 * side, 0, 0);
    spine2.add(a); a.add(b); b.add(c); bones.push(a, b, c);
  };
  arm("UpperArm.L", "UpperForearm.L", "UpperHand.L", -1, 0.1); arm("UpperArm.R", "UpperForearm.R", "UpperHand.R", 1, 0.1);
  arm("mixamorig:LeftArm", "mixamorig:LeftForeArm", "mixamorig:LeftHand", -1, -0.1); arm("mixamorig:RightArm", "mixamorig:RightForeArm", "mixamorig:RightHand", 1, -0.1);

  const geometry = sculpt(options.width);
  const count = geometry.attributes.position.count;
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Float32Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const own = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  const body = new THREE.SkinnedMesh(geometry, own);
  const rig = new THREE.Group();
  rig.add(root, body);
  rig.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton(bones));

  const still = (node: THREE.Object3D) => new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, [0, 3], [...node.quaternion.toArray(), ...node.quaternion.toArray()]);
  const animations = [new THREE.AnimationClip("Threat_Cast", 3, bones.map(still))];
  if (options.idle !== false) animations.push(new THREE.AnimationClip("Idle", 3, bones.map(still)));
  return { model: { scene: rig, animations } as unknown as GLTF, rig, body, own, head };
}

/** The frozen statue as the look package stages it: far behind the board, turned a little, scaled up, inside the scaled world. */
function statue() {
  const scene = new THREE.Scene(), world = new THREE.Group(), extras = new THREE.Group();
  world.scale.setScalar(1 / 2.3);
  const frozen = new THREE.Mesh(sculpt(), new THREE.MeshStandardMaterial());
  frozen.position.set(12, -4.2, -86); frozen.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(-8)); frozen.scale.setScalar(23.4);
  frozen.castShadow = true;
  scene.add(world); world.add(extras); extras.add(frozen);
  scene.updateMatrixWorld(true);
  return { scene, extras, frozen };
}

const run = (sorcerer: { update(seconds: number, still: boolean): void }, seconds: number, still = false) => {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 30) sorcerer.update(1 / 30, still);
};

test("stands the rigged figure exactly where the statue stood, in the statue's material, and hides the statue", () => {
  const { extras, frozen } = statue(), { model, rig, body } = rigged();
  const sorcerer = reviveSorcerer(model, frozen);
  assert.ok(sorcerer);
  assert.equal(rig.parent, extras);
  assert.deepEqual(rig.position.toArray(), frozen.position.toArray());
  assert.deepEqual(rig.quaternion.toArray(), frozen.quaternion.toArray());
  assert.deepEqual(rig.scale.toArray(), frozen.scale.toArray());
  assert.equal(body.material, frozen.material, "the arena's fog and sky light are on the statue's material");
  assert.equal(body.castShadow, true);
  assert.equal(body.frustumCulled, false);
  assert.equal(frozen.visible, false);
});

test("keeps the statue when the rigged model is a different sculpt or has no idle", () => {
  const warn = console.warn; console.warn = () => {};
  try {
    for (const options of [{ width: 2.4 }, { idle: false }]) {
      const { frozen } = statue(), { model, rig } = rigged(options);
      assert.equal(reviveSorcerer(model, frozen), null);
      assert.equal(frozen.visible, true);
      assert.equal(rig.parent, null);
    }
  } finally { console.warn = warn; }
});

test("moves when alive, and holds one pose under reduced motion", () => {
  const { frozen } = statue(), { model, rig } = rigged();
  const sorcerer = reviveSorcerer(model, frozen)!;
  const pose = () => { const out: number[] = []; rig.traverse((node) => { if ((node as THREE.Bone).isBone) out.push(...node.quaternion.toArray()); }); return out; };
  const rest = pose();
  run(sorcerer, 4);
  const moved = pose();
  assert.ok(moved.some((value, i) => Math.abs(value - rest[i]) > 0.01), "breath and drifting arms change the pose");
  run(sorcerer, 1, true);
  const held = pose();
  run(sorcerer, 3, true);
  assert.deepEqual(pose(), held);
  assert.deepEqual(held.map((value) => +value.toFixed(6)), rest.map((value) => +value.toFixed(6)), "reduced motion stands it as it started");
  assert.equal(sorcerer.cast(new THREE.Vector3(0, 0, 0)), 0, "and it does not cast");
  run(sorcerer, 2, true);
  assert.deepEqual(pose(), held);
});

test("turns its head toward what happens on the board, no further than a neck allows, and lets go after a while", () => {
  const { frozen } = statue(), { model, rig, head } = rigged();
  const sorcerer = reviveSorcerer(model, frozen)!;
  rig.updateWorldMatrix(true, true);
  const ahead = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.getWorldQuaternion(new THREE.Quaternion()));
  const rest = head.getWorldQuaternion(new THREE.Quaternion()).invert();
  const facing = () => ahead.clone().applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()).multiply(rest));
  const off = (to: THREE.Vector3) => THREE.MathUtils.radToDeg(facing().angleTo(to.clone().sub(head.getWorldPosition(new THREE.Vector3())).normalize()));

  // Something far off to one side, level with the head: more than a neck can turn.
  const side = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(1, 0, 0).applyQuaternion(rig.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(40));
  const before = off(side);
  sorcerer.watch(side);
  run(sorcerer, 3);
  const turned = THREE.MathUtils.radToDeg(facing().angleTo(ahead));
  assert.ok(off(side) < before - 35, `the head turned toward it (${before.toFixed(0)} to ${off(side).toFixed(0)} degrees off)`);
  // 18 degrees of neck and 32 of head, on top of the few degrees its breathing chest turns under them.
  assert.ok(turned <= 18 + 32 + 5, `but only as far as the neck and head may go (${turned.toFixed(1)} degrees)`);

  run(sorcerer, 12);
  assert.ok(THREE.MathUtils.radToDeg(facing().angleTo(ahead)) < 30, "left alone, its eyes drift back over the arena");
});

test("raises all four arms over a cast and lowers them again", () => {
  const { frozen } = statue(), { model } = rigged();
  const sorcerer = reviveSorcerer(model, frozen)!;
  const hands = ["upperLeft", "upperRight", "lowerLeft", "lowerRight"] as const;
  const heights = () => hands.map((hand) => sorcerer.hand(hand, new THREE.Vector3()).y);
  // How high each hand drifts on its own, over a minute of idling.
  const low = heights(), high = heights();
  for (let i = 0; i < 60 * 30; i += 1) { sorcerer.update(1 / 30, false); heights().forEach((y, h) => { low[h] = Math.min(low[h], y); high[h] = Math.max(high[h], y); }); }
  const length = sorcerer.cast(new THREE.Vector3(0, 0, 0));
  assert.ok(Math.abs(length - 2.9) < 1e-9, "a rise, the usual hold and the way down");
  run(sorcerer, 1.5);
  const raised = heights();
  // A hand hangs 0.8 of a model unit from its shoulder; the figure is 23.4 times life size in a world 2.3 times smaller.
  for (const [i, hand] of hands.entries()) assert.ok(raised[i] > high[i] + 0.8, `${hand} rose above anything its idle does (${(raised[i] - high[i]).toFixed(2)})`);
  run(sorcerer, 2);
  const lowered = heights();
  for (const [i, hand] of hands.entries()) assert.ok(lowered[i] > low[i] - 0.05 && lowered[i] < high[i] + 0.05, `${hand} came back down into its idle (${lowered[i].toFixed(2)} in ${low[i].toFixed(2)}..${high[i].toFixed(2)})`);
});

test("keeps its hands up for as long as a ritual asks, and a second ritual holds them up instead of starting over", () => {
  const { frozen } = statue(), { model } = rigged();
  const sorcerer = reviveSorcerer(model, frozen)!;
  const height = () => sorcerer.hand("upperLeft", new THREE.Vector3()).y;
  run(sorcerer, 2);
  const idle = height();
  const length = sorcerer.cast(new THREE.Vector3(0, 0, 0), 4);
  assert.ok(Math.abs(length - (SORCERER_RISE + 4 + 0.8)) < 1e-9);
  run(sorcerer, SORCERER_RISE + 0.2);
  const up = height();
  assert.ok(up > idle + 0.8, "raised");
  run(sorcerer, 3.5);
  assert.ok(height() > idle + 0.8, "still raised near the end of the hold, long after the usual cast is over");
  // another body falls while the hands are up: they do not drop to begin again
  sorcerer.cast(new THREE.Vector3(1, 0, 0), 3);
  sorcerer.update(1 / 30, false);
  assert.ok(height() > idle + 0.8, "no restart");
  run(sorcerer, 2.5);
  assert.ok(height() > idle + 0.8, "held on for the second ritual, past the end of the first");
  run(sorcerer, 2);
  assert.ok(height() < up - 0.8, `and lowered when it is over (${height().toFixed(2)} from ${up.toFixed(2)}, idle ${idle.toFixed(2)})`);
  // caught on the way down, they go back up from where they are
  sorcerer.cast(new THREE.Vector3(0, 0, 0), 0.5);
  run(sorcerer, SORCERER_RISE + 0.5 + 0.4);
  const falling = height();
  assert.ok(falling > idle + 0.2 && falling < up, "half way down");
  sorcerer.cast(new THREE.Vector3(0, 0, 0), 1);
  sorcerer.update(1 / 30, false);
  assert.ok(Math.abs(height() - falling) < 0.35, `no jump when it is asked again (${(height() - falling).toFixed(2)})`);
});

test("holds each thread in the upper hand on the body's side, and says where its face is", () => {
  const { frozen } = statue(), { model, head } = rigged();
  const sorcerer = reviveSorcerer(model, frozen)!;
  const claimant = claimantOf(sorcerer);
  assert.equal(claimant.rise, SORCERER_RISE);
  const left = sorcerer.hand("upperLeft", new THREE.Vector3()), right = sorcerer.hand("upperRight", new THREE.Vector3());
  const out = new THREE.Vector3();
  const [near, other] = claimant.grips({ x: left.x - 3, y: 0, z: 0 });
  assert.ok(near(out).distanceTo(left) < 1e-6, "the hand on the body's side is its first choice");
  assert.ok(other(out).distanceTo(right) < 1e-6, "and the other upper hand is offered after it");
  const [far] = claimant.grips({ x: right.x + 3, y: 0, z: 0 });
  assert.ok(far(out).distanceTo(right) < 1e-6);
  // the hand moves, and the grip moves with it
  claimant.cast(new THREE.Vector3(0, 0, 0), 2);
  run(sorcerer, SORCERER_RISE + 0.3);
  assert.ok(near(out).distanceTo(left) > 0.5, "the grip follows the raised hand");
  assert.ok(claimant.face(out).distanceTo(head.getWorldPosition(new THREE.Vector3())) < 1e-6);
});

test("gives the statue back when it is disposed", () => {
  const { frozen } = statue(), { model, rig } = rigged();
  const sorcerer = reviveSorcerer(model, frozen)!;
  sorcerer.dispose();
  assert.equal(frozen.visible, true);
  assert.equal(rig.parent, null);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { AnimationClip, Bone, BufferGeometry, Float32BufferAttribute, Group, Matrix4, MeshStandardMaterial, QuaternionKeyframeTrack, Skeleton, SkinnedMesh,
  Uint16BufferAttribute, Vector3, VectorKeyframeTrack } from 'three';
import { createEaldholtResidentActors, type EaldholtResidentFrame, type EaldholtResidentFrameState, type EaldholtResidentMotion } from './resident-actors';

const bent = [Math.sin(.4), 0, 0, Math.cos(.4)];
function template() {
  const scene = new Group(), root = new Bone(), arm = new Bone(); root.name = 'root'; arm.name = 'arm'; arm.position.y = 1; root.add(arm); scene.add(root);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-.1, 1, 0, .1, 1, 0, 0, 1.6, 0], 3));
  g.setAttribute('skinIndex', new Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  g.setIndex([0, 1, 2]);
  const mesh = new SkinnedMesh(g, new MeshStandardMaterial()); mesh.name = 'Body';
  scene.add(mesh); scene.updateMatrixWorld(true); mesh.bind(new Skeleton([root, arm]), new Matrix4());
  const idle = new AnimationClip('idle', 1, [new VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0, 0])]);
  const walk = new AnimationClip('walk', 1, [new QuaternionKeyframeTrack('arm.quaternion', [0, 1], [...bent, ...bent])]);
  const stop = new AnimationClip('walk_stop', 1, [new QuaternionKeyframeTrack('arm.quaternion', [0, 1], [...bent, 0, 0, 0, 1])]);
  return { scene, mesh, idle, walk, stop, animations: [idle, walk, stop] };
}
const frame = (motion: EaldholtResidentMotion, extra: Partial<EaldholtResidentFrameState> = {}, reducedMotion = false): EaldholtResidentFrame =>
  ({ clockSeconds: 1, paused: false, reducedMotion, residents: [{ residentId: 'smith', motion, ...extra }] });
const angle = (actor: { model: { getObjectByName(name: string): unknown } }) => {
  const q = (actor.model.getObjectByName('arm') as Bone).quaternion; return 2 * Math.acos(Math.min(1, Math.abs(q.w)));
};
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-4, `${a} != ${b}`);

test('one-shot transitions play once, hold their last frame and resume from an explicit earlier time', () => {
  const t = template();
  const actors = createEaldholtResidentActors({ scene: t.scene, animations: t.animations }, [{ residentId: 'smith', position: [0, 0, 0], yawRadians: 0, phaseSeconds: .4 }], { clips: { idle: t.idle, walk: t.walk, stop: t.stop } });
  const actor = actors.actors[0];
  actors.update(0, frame('stop')); assert.equal(actor.activeMotion, 'stop'); near(angle(actor), .8);  // starts at 0, not at the placement phase
  actors.update(.5, frame('stop')); near(angle(actor), .4);
  actors.update(.75, frame('stop')); near(angle(actor), 0);
  actors.update(.9, frame('stop')); near(angle(actor), 0);  // no wrap back to the first frame
  actors.update(0, frame('stop', { animationTimeSeconds: 5 })); near(angle(actor), 0);
  actors.update(0, frame('stop', { animationTimeSeconds: .25 })); near(angle(actor), .6);
  actors.update(.25, frame('stop')); near(angle(actor), .4);  // delta time plays on after the clamp
  actors.dispose();
});

test('a crossfade weights the outgoing motion down over fadeSeconds inside conservative bounds', () => {
  const t = template();
  const actors = createEaldholtResidentActors({ scene: t.scene, animations: t.animations }, [{ residentId: 'smith', position: [3, 0, 1], yawRadians: .7 }], { clips: { idle: t.idle, walk: t.walk, stop: t.stop } });
  const actor = actors.actors[0], handleBounds = actors.bounds, idleBounds = actor.bounds.clone();
  const containsVisible = () => {
    actors.object.updateMatrixWorld(true); const mesh = actor.model.getObjectByName('Body') as SkinnedMesh, point = new Vector3(); mesh.skeleton.update();
    for (let i = 0; i < 3; i++) { mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld); assert.ok(actor.bounds.containsPoint(point)); }
    assert.ok(actors.bounds.containsBox(actor.bounds));
  };
  actors.update(0, frame('walk')); assert.equal(actor.fadingFrom, null); near(angle(actor), .8); containsVisible();
  actors.update(0, frame('idle', { fadeSeconds: .5 }));
  assert.equal(actor.activeMotion, 'idle'); assert.equal(actor.fadingFrom, 'walk'); near(angle(actor), .8); containsVisible();
  assert.ok(actor.bounds.containsBox(idleBounds));
  actors.update(.25, frame('idle', { fadeSeconds: .5 })); near(angle(actor), .4); containsVisible();
  near(actor.mixer.existingAction(t.walk)!.getEffectiveWeight(), .5);
  actors.update(.3, frame('idle')); assert.equal(actor.fadingFrom, null); near(angle(actor), 0); containsVisible();
  assert.equal(actor.mixer.existingAction(t.walk)!.isScheduled(), false);
  assert.ok(actor.bounds.equals(idleBounds)); assert.equal(actors.bounds, handleBounds);
  actors.dispose();
});

test('a fade into a one-shot ends on its last frame; a change mid-fade fades from the motion fading in', () => {
  const t = template();
  const actors = createEaldholtResidentActors({ scene: t.scene, animations: t.animations }, [{ residentId: 'smith', position: [0, 0, 0], yawRadians: 0 }], { clips: { idle: t.idle, walk: t.walk, stop: t.stop } });
  const actor = actors.actors[0];
  actors.update(0, frame('walk')); actors.update(0, frame('stop', { fadeSeconds: .2 }));
  actors.update(.1, frame('stop')); near(angle(actor), .76);  // half walk (0.8), half stop at 0.1 s (0.72)
  actors.update(.1, frame('idle', { fadeSeconds: .4 })); assert.equal(actor.fadingFrom, 'stop');
  assert.equal(actor.mixer.existingAction(t.walk)!.isScheduled(), false);
  for (let i = 0; i < 4; i++) actors.update(.5, frame('idle')); assert.equal(actor.fadingFrom, null); near(angle(actor), 0);
  actors.dispose();
});

test('reduced motion cuts a requested or running crossfade', () => {
  const t = template();
  const actors = createEaldholtResidentActors({ scene: t.scene, animations: t.animations }, [{ residentId: 'smith', position: [0, 0, 0], yawRadians: 0 }], { clips: { idle: t.idle, walk: t.walk } });
  const actor = actors.actors[0];
  actors.update(0, frame('walk')); actors.update(0, frame('idle', { fadeSeconds: .5 }, true));
  assert.equal(actor.activeMotion, 'idle'); assert.equal(actor.fadingFrom, null); near(angle(actor), 0);
  actors.update(0, frame('walk')); actors.update(0, frame('idle', { fadeSeconds: .5 })); assert.equal(actor.fadingFrom, 'walk');
  actors.update(.1, frame('idle', {}, true)); assert.equal(actor.fadingFrom, null); near(angle(actor), 0);
  actors.dispose();
});

test('invalid fades reject the frame and missing transitions fall back to idle', () => {
  const t = template();
  const actors = createEaldholtResidentActors({ scene: t.scene, animations: t.animations }, [{ residentId: 'smith', position: [0, 0, 0], yawRadians: 0 }], { clips: { idle: t.idle, walk: t.walk } });
  for (const fadeSeconds of [-.1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => actors.update(0, frame('walk', { fadeSeconds })), /invalid actor state/);
  for (const motion of ['start', 'stop', 'sitDown', 'standUp'] as const) {
    actors.update(.1, frame(motion)); assert.equal(actors.actors[0].activeMotion, 'idle'); assert.equal(actors.actors[0].status, 'unavailable-motion');
  }
  assert.throws(() => createEaldholtResidentActors({ scene: t.scene, animations: t.animations }, [], { clips: { idle: t.idle, walk: t.walk, stop: t.walk } }), /stand in/);
  actors.dispose();
});

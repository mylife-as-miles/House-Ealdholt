import assert from 'node:assert/strict';
import test from 'node:test';
import { AnimationClip, Bone, BufferGeometry, Float32BufferAttribute, Group, Matrix4, MeshStandardMaterial, QuaternionKeyframeTrack, Skeleton, SkinnedMesh,
  Uint16BufferAttribute, VectorKeyframeTrack } from 'three';
import { createEaldholtResidentActors, type EaldholtResidentFrame, type EaldholtResidentMotion } from './resident-actors';

// A body vertex low down and a face vertex high up that a relative morph target moves 0.2 m forward.
function template() {
  const scene = new Group(), root = new Bone(); root.name = 'root'; scene.add(root);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-.2, 0, 0, .2, 0, 0, 0, 1.7, 0], 3));
  g.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(12).fill(0), 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  g.setIndex([0, 1, 2]);
  g.morphAttributes.position = [new Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, .2], 3)];
  g.morphTargetsRelative = true;
  const mesh = new SkinnedMesh(g, new MeshStandardMaterial()); mesh.name = 'Body';
  mesh.morphTargetInfluences = [0]; mesh.morphTargetDictionary = { jawOpen: 0 };
  scene.add(mesh); scene.updateMatrixWorld(true); mesh.bind(new Skeleton([root]), new Matrix4());
  const still = (name: string, d = 1) => new AnimationClip(name, d, [new VectorKeyframeTrack('root.position', [0, d], [0, 0, 0, 0, 0, 0])]);
  const turn = (name: string) => new AnimationClip(name, 1, [new QuaternionKeyframeTrack('root.quaternion', [0, 1], [0, 0, 0, 1, Math.sin(.3), 0, 0, Math.cos(.3)])]);
  const clips = { idle: still('idle'), work: still('work_hammer', 2), workEnter: turn('work_enter'), workExit: still('work_exit', .8) };
  return { scene, animations: Object.values(clips), clips };
}
const frame = (motion: EaldholtResidentMotion, extra: Record<string, unknown> = {}): EaldholtResidentFrame =>
  ({ clockSeconds: 0, paused: false, reducedMotion: false, residents: [{ residentId: 'a', motion, ...extra }] });

test('morph padding grows the envelope only where the morphing vertices are', () => {
  const t = template();
  const actors = createEaldholtResidentActors(t, [{ residentId: 'a', position: [0, 0, 0], yawRadians: 0 }], { clips: { idle: t.clips.idle } });
  const b = actors.actors[0].bounds;
  assert.ok(b.max.z >= .2 - 1e-6, `the face vertex's 0.2 m morph is covered (max z ${b.max.z})`);
  // the uniform pad of patch 1 also pushed the feet 0.2 m below the ground and 0.2 m out to each side
  assert.ok(b.min.y > -.05 && b.max.x < .25 && b.min.x > -.25, `the body is not padded (min y ${b.min.y}, x ${b.min.x}..${b.max.x})`);
  actors.dispose();
});

test('work entry and exit are one-shots that clamp on their last frame', () => {
  const t = template();
  const actors = createEaldholtResidentActors(t, [{ residentId: 'a', position: [0, 0, 0], yawRadians: 0 }], { clips: t.clips });
  actors.update(0, frame('workEnter'));
  actors.update(.6, frame('workEnter')); actors.update(.6, frame('workEnter'));
  const root = actors.actors[0].model.getObjectByName('root')!;
  assert.ok(Math.abs(root.quaternion.x - Math.sin(.3)) < 1e-6, 'held on the last frame, not wrapped to the first');
  assert.equal(actors.actors[0].activeMotion, 'workEnter');
  actors.update(.1, frame('work', { animationTimeSeconds: 0 })); assert.equal(actors.actors[0].activeMotion, 'work');
  actors.update(.1, frame('workExit')); assert.equal(actors.actors[0].status, 'ready');
  actors.dispose();
});

test('a precomputed envelope is checked at a few times instead of re-measured, and a short one is refused', () => {
  const t = template();
  const envelopes = { idle: { min: [-.3, -.01, -.25] as [number, number, number], max: [.3, 1.95, .3] as [number, number, number] } };
  const actors = createEaldholtResidentActors(t, [{ residentId: 'a', position: [1, 0, 0], yawRadians: 0 }], { clips: { idle: t.clips.idle }, envelopes });
  assert.equal(actors.metrics.envelopeSamples, 9);
  assert.ok(Math.abs(actors.actors[0].bounds.min.x - .7) < 1e-9 && Math.abs(actors.actors[0].bounds.max.y - 1.95) < 1e-9, 'the given envelope is the bounds');
  actors.dispose();
  const short = { idle: { min: [-.3, -.01, -.25] as [number, number, number], max: [.3, 1.95, .1] as [number, number, number] } };
  assert.throws(() => createEaldholtResidentActors(t, [], { clips: { idle: t.clips.idle }, envelopes: short }), /does not contain/);
  const broken = { idle: { min: [0, 0, 0] as [number, number, number], max: [0, 1, 1] as [number, number, number] } };
  assert.throws(() => createEaldholtResidentActors(t, [], { clips: { idle: t.clips.idle }, envelopes: broken }), /finite box/);
});

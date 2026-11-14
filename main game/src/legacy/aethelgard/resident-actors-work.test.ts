import assert from 'node:assert/strict';
import test from 'node:test';
import { AnimationClip, Bone, BufferGeometry, Float32BufferAttribute, Group, Matrix4, MeshStandardMaterial, QuaternionKeyframeTrack, Skeleton, SkinnedMesh,
  Uint16BufferAttribute, VectorKeyframeTrack } from 'three';
import { createEaldholtResidentActors, type EaldholtResidentFrame } from './resident-actors';

function template() {
  const scene = new Group(), root = new Bone(), arm = new Bone(); root.name = 'root'; arm.name = 'arm'; arm.position.y = 1; root.add(arm); scene.add(root);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-.1, 1, 0, .1, 1, 0, 0, 1.5, 0], 3));
  g.setAttribute('skinIndex', new Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  g.setIndex([0, 1, 2]);
  const mesh = new SkinnedMesh(g, new MeshStandardMaterial()); mesh.name = 'Body';
  scene.add(mesh); scene.updateMatrixWorld(true); mesh.bind(new Skeleton([root, arm]), new Matrix4());
  const idle = new AnimationClip('idle', 1, [new VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0, 0])]);
  const work = new AnimationClip('work_hammer', 2, [new QuaternionKeyframeTrack('arm.quaternion', [0, 1, 2], [0, 0, 0, 1, Math.sin(.2), 0, 0, Math.cos(.2), 0, 0, 0, 1])]);
  return { scene, idle, work };
}
const frame = (motion: 'idle' | 'work'): EaldholtResidentFrame => ({ clockSeconds: 1, paused: false, reducedMotion: false, residents: [{ residentId: 'smith', motion }] });

test('a qualified work clip plays as the work motion; without one, work falls back to idle', () => {
  const { scene, idle, work } = template();
  const actors = createEaldholtResidentActors({ scene, animations: [idle, work] }, [{ residentId: 'smith', position: [0, 0, 0], yawRadians: 0 }], { clips: { idle, work } });
  actors.update(0.5, frame('work'));
  assert.equal(actors.actors[0].activeMotion, 'work');
  assert.equal(actors.actors[0].status, 'ready');
  actors.dispose();
  const plain = createEaldholtResidentActors({ scene, animations: [idle, work] }, [{ residentId: 'smith', position: [0, 0, 0], yawRadians: 0 }], { clips: { idle } });
  plain.update(0.5, frame('work'));
  assert.equal(plain.actors[0].activeMotion, 'idle');
  assert.equal(plain.actors[0].status, 'unavailable-motion');
  plain.dispose();
  assert.throws(() => createEaldholtResidentActors({ scene, animations: [idle] }, [], { clips: { idle, work: idle } }), /stand in/);
});

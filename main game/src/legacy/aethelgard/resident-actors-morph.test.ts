import assert from 'node:assert/strict';
import test from 'node:test';
import { AnimationClip, Bone, BufferGeometry, Float32BufferAttribute, Group, Matrix4, MeshStandardMaterial, Skeleton, SkinnedMesh,
  Uint16BufferAttribute, VectorKeyframeTrack } from 'three';
import { createEaldholtResidentActors } from './resident-actors';

test('relative face morph targets are accepted and pad the qualified envelope', () => {
  const scene = new Group(), root = new Bone(); root.name = 'root'; scene.add(root);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-.1, 1.6, 0, .1, 1.6, 0, 0, 1.75, 0], 3));
  g.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(12).fill(0), 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  g.setIndex([0, 1, 2]);
  g.morphAttributes.position = [new Float32BufferAttribute([0, 0, .3, 0, 0, 0, 0, 0, 0], 3)];
  g.morphTargetsRelative = true;
  const mesh = new SkinnedMesh(g, new MeshStandardMaterial()); mesh.name = 'Face';
  mesh.morphTargetInfluences = [0]; mesh.morphTargetDictionary = { jawOpen: 0 };
  scene.add(mesh); scene.updateMatrixWorld(true); mesh.bind(new Skeleton([root]), new Matrix4());
  const idle = new AnimationClip('idle', 1, [new VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0, 0])]);
  const actors = createEaldholtResidentActors({ scene, animations: [idle] }, [{ residentId: 'a', position: [0, 0, 0], yawRadians: 0 }], { clips: { idle } });
  assert.ok(actors.bounds.max.z >= .3 - 1e-6, `envelope covers the 0.3 m morph delta (max z ${actors.bounds.max.z})`);
  const bad = g.clone(); bad.morphTargetsRelative = false;
  const absMesh = new SkinnedMesh(bad, new MeshStandardMaterial()); absMesh.morphTargetInfluences = [0];
  const scene2 = new Group(), root2 = new Bone(); root2.name = 'root'; scene2.add(root2, absMesh); scene2.updateMatrixWorld(true);
  absMesh.bind(new Skeleton([root2]), new Matrix4());
  const idle2 = new AnimationClip('idle', 1, [new VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0, 0])]);
  assert.throws(() => createEaldholtResidentActors({ scene: scene2, animations: [idle2] }, [], { clips: { idle: idle2 } }), /relative/);
  actors.dispose();
});

test('overlapping morph targets pad the envelope by their summed deltas', () => {
  const scene = new Group(), root = new Bone(); root.name = 'root'; scene.add(root);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-.1, 1.6, 0, .1, 1.6, 0, 0, 1.75, 0], 3));
  g.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(12).fill(0), 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  g.setIndex([0, 1, 2]);
  // two targets each push the same vertex 0.2 m forward: both at full influence move it 0.4 m
  g.morphAttributes.position = [new Float32BufferAttribute([0, 0, .2, 0, 0, 0, 0, 0, 0], 3), new Float32BufferAttribute([0, 0, .2, 0, 0, 0, 0, 0, 0], 3)];
  g.morphTargetsRelative = true;
  const mesh = new SkinnedMesh(g, new MeshStandardMaterial()); mesh.name = 'Face';
  mesh.morphTargetInfluences = [0, 0]; mesh.morphTargetDictionary = { jawOpen: 0, viseme_aa: 1 };
  scene.add(mesh); scene.updateMatrixWorld(true); mesh.bind(new Skeleton([root]), new Matrix4());
  const idle = new AnimationClip('idle', 1, [new VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0, 0])]);
  const actors = createEaldholtResidentActors({ scene, animations: [idle] }, [{ residentId: 'a', position: [0, 0, 0], yawRadians: 0 }], { clips: { idle } });
  assert.ok(actors.bounds.max.z >= .4 - 1e-6, `envelope covers both targets at once (max z ${actors.bounds.max.z})`);
  actors.dispose();
});

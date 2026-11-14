import assert from 'node:assert/strict';
import test from 'node:test';
import { Bone, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import {
  DEFAULT_FACE_CALIBRATION, createFacePose, evaluateFacePose, faceMorphIndex, faceSeed,
} from '../../../../../shared/legacy/aethelgard/characters/face-performance';
import { bindResidentFaceRig } from './resident-face-rig';

const NAMES = ['face_jaw', 'face_eye_l', 'face_eye_r', 'face_lid_upper_l', 'face_lid_upper_r', 'face_lid_lower_l', 'face_lid_lower_r'];

function resident(withMorphs: boolean) {
  const root = new Group();
  const head = new Bone(); head.name = 'head'; root.add(head);
  for (const n of NAMES) {
    const b = new Bone(); b.name = n; b.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.1); head.add(b);
  }
  if (withMorphs) {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const mesh = new Mesh(g, new MeshStandardMaterial());
    mesh.name = 'Body';
    mesh.morphTargetDictionary = { eyeBlinkLeft: 0, eyeBlinkRight: 1, jawOpen: 2, viseme_aa: 3, mouthSmileLeft: 4, unrelated: 5 };
    mesh.morphTargetInfluences = [0, 0, 0, 0, 0, 0];
    root.add(mesh);
  }
  return root;
}
const bone = (root: Group, name: string) => root.getObjectByName(name)!;
const expected = (rest: Quaternion, pitch: number, yaw = 0) =>
  rest.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch)).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), yaw));

test('joint-only residents close lids, open the jaw and turn the eyes through local axes', () => {
  const root = resident(false);
  const rest = bone(root, 'face_lid_upper_l').quaternion.clone();
  const rig = bindResidentFaceRig(root);
  assert.equal(rig.tier, 'joints-only');
  assert.equal(rig.joints.length, 7);
  const pose = createFacePose();
  evaluateFacePose({ timeSeconds: 0, seed: 1, reducedMotion: true, blinkOverride: 1, gaze: { yaw: 0.2, pitch: 0.1 },
    visemes: [{ viseme: 'aa', weight: 1 }] }, DEFAULT_FACE_CALIBRATION, pose);
  rig.apply(pose);
  assert.ok(bone(root, 'face_lid_upper_l').quaternion.angleTo(expected(rest, DEFAULT_FACE_CALIBRATION.upperLidClosed)) < 1e-6);
  assert.ok(bone(root, 'face_eye_r').quaternion.angleTo(expected(rest, 0.1, 0.2)) < 1e-6);
  assert.ok(bone(root, 'face_jaw').quaternion.angleTo(expected(rest, pose.joints.jaw)) < 1e-6 && pose.joints.jaw > 0.2);
  rig.apply(pose); // idempotent: absolute rotations, no accumulation
  assert.ok(bone(root, 'face_eye_r').quaternion.angleTo(expected(rest, 0.1, 0.2)) < 1e-6);
  rig.reset();
  for (const n of NAMES) assert.ok(bone(root, n).quaternion.angleTo(rest) < 1e-9);
});

test('morph residents drive blink, jaw and visemes through morph targets and keep joints for gaze', () => {
  const root = resident(true);
  const rest = bone(root, 'face_jaw').quaternion.clone();
  const rig = bindResidentFaceRig(root);
  assert.equal(rig.tier, 'joints-and-morphs');
  assert.equal(rig.morphMeshes, 1);
  const pose = createFacePose();
  evaluateFacePose({ timeSeconds: 0, seed: faceSeed('ealdholt-village-smith'), reducedMotion: true, blinkOverride: 1,
    expression: { name: 'smile', intensity: 1 }, visemes: [{ viseme: 'aa', weight: 0.8 }], gaze: { yaw: -0.2, pitch: 0 } }, DEFAULT_FACE_CALIBRATION, pose);
  rig.apply(pose);
  const mesh = root.getObjectByName('Body') as Mesh;
  const inf = mesh.morphTargetInfluences!;
  assert.equal(inf[0], 1);
  assert.equal(inf[1], 1);
  assert.ok(Math.abs(inf[3] - 0.8) < 1e-6);
  assert.ok(Math.abs(inf[4] - pose.morphs[faceMorphIndex('mouthSmileLeft')]) < 1e-6 && inf[4] > 0.5);
  assert.equal(inf[5], 0, 'unknown morphs are never touched');
  assert.ok(bone(root, 'face_jaw').quaternion.angleTo(rest) < 1e-9, 'the jaw joint stays at rest when visemes are morphs');
  assert.ok(bone(root, 'face_eye_l').quaternion.angleTo(expected(rest, 0, -0.2)) < 1e-6);
  rig.dispose();
  assert.ok(rig.disposed);
  assert.deepEqual([...inf], [0, 0, 0, 0, 0, 0]);
  rig.apply(pose);
  assert.deepEqual([...inf], [0, 0, 0, 0, 0, 0], 'a disposed rig does nothing');
});

test('residents without face joints or morphs bind as tier none and duplicated names are rejected', () => {
  const plain = new Group();
  assert.equal(bindResidentFaceRig(plain).tier, 'none');
  const root = resident(false);
  const dup = new Bone(); dup.name = 'face_jaw'; root.add(dup);
  assert.throws(() => bindResidentFaceRig(root), /ambiguous/);
});

test('a talking resident opens the jaw joint from the shared babble on joint-only levels; dispose releases the rig', () => {
  const root = resident(false);
  const jaw = bone(root, 'face_jaw');
  const rest = jaw.quaternion.clone();
  const rig = bindResidentFaceRig(root);
  const pose = createFacePose();
  let widest = 0;
  for (let i = 0; i < 120; i++) {
    evaluateFacePose({ timeSeconds: i / 30, seed: faceSeed('ealdholt-smithy-elder'), talking: true }, DEFAULT_FACE_CALIBRATION, pose);
    rig.apply(pose);
    widest = Math.max(widest, jaw.quaternion.angleTo(rest));
  }
  assert.ok(widest > 0.1, `jaw opened by ${widest} rad while talking`);
  rig.dispose();
  jaw.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.3);
  const held = jaw.quaternion.clone();
  rig.apply(pose);
  rig.reset();
  assert.ok(jaw.quaternion.angleTo(held) < 1e-6, 'a disposed rig neither writes nor resets the borrowed joints');
});

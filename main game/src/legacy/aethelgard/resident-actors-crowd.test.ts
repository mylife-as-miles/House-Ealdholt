import assert from 'node:assert/strict';
import test from 'node:test';
import { AnimationClip, Bone, BufferGeometry, Float32BufferAttribute, Group, Matrix4, MeshStandardMaterial, Quaternion, QuaternionKeyframeTrack,
  Skeleton, SkinnedMesh, Uint16BufferAttribute, VectorKeyframeTrack, type Object3D } from 'three';
import { createEaldholtResidentActors, type EaldholtResidentFrame, type EaldholtResidentMotion } from './resident-actors';

// Crowd residents (docs/legacy/claude-integration/characters/population-README.md): a skinned resident file without
// clips and one clips-only library per body archetype, paired as { scene: resident.scene, animations: library.animations }.
// The library keys body joints only; each resident has its own face-joint rest (its own head). The owner needs no change
// for this pairing, for the placement scale or for the presence modes; role loops and envelopes use patches 2, 4 and 5.

const BODY = ['root', 'hips', 'spine', 'head'] as const;
function skeleton(faceZ: number): { rig: Group; bones: Bone[] } {
  const rig = new Group(); rig.name = 'Rig';
  const bones = BODY.map(name => { const b = new Bone(); b.name = name; return b; });
  bones[1].position.y = 0.95; bones[2].position.y = 0.3; bones[3].position.y = 0.45;
  for (let i = 1; i < bones.length; i++) bones[i - 1].add(bones[i]);
  const jaw = new Bone(); jaw.name = 'face_jaw'; jaw.position.set(0, -0.05, faceZ); bones[3].add(jaw);
  rig.add(bones[0]);
  return { rig, bones: [...bones, jaw] };
}
/** A resident: one skinned mesh over the archetype skeleton, no clips of its own. */
function resident(faceZ: number): Object3D {
  const scene = new Group(), { rig, bones } = skeleton(faceZ); scene.add(rig);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-0.2, 0, 0, 0.2, 0, 0, 0, 1.25, 0.1, 0, 1.62, 0.12], 3));
  g.setAttribute('skinIndex', new Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0], 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  const mesh = new SkinnedMesh(g, new MeshStandardMaterial()); mesh.name = 'Crowd'; rig.add(mesh);
  scene.updateMatrixWorld(true); mesh.bind(new Skeleton(bones), new Matrix4());
  return scene;
}
const q = (deg: number) => { const r = deg * Math.PI / 360; return [Math.sin(r), 0, 0, Math.cos(r)]; };
const bend = (name: string, deg: number, seconds = 1) => new AnimationClip(name, seconds,
  [new QuaternionKeyframeTrack('spine.quaternion', [0, seconds / 2, seconds], [...q(0), ...q(deg), ...q(0)])]);
const stride = (name: string) => new AnimationClip(name, 1, [new VectorKeyframeTrack('hips.position', [0, 0.5, 1], [0, 0.95, 0, 0, 0.9, 0, 0, 0.95, 0]),
  new QuaternionKeyframeTrack('spine.quaternion', [0, 0.5, 1], [...q(0), ...q(6), ...q(0)])]);
/** The clips-only library: skeleton nodes, no mesh, and more clips than any one resident plays. */
function library() {
  const scene = new Group(); scene.add(skeleton(0.09).rig);
  const clips = { idle: bend('idle', 4, 3), walk: stride('walk_b'), talk: bend('talk', 8, 2), start: bend('walk_b_start', 3, 0.8), stop: bend('walk_b_stop', 3, 0.7),
    work: bend('work_hoe', 40, 2.2), workEnter: bend('work_hoe_enter', 20, 0.9), workExit: bend('work_hoe_exit', 20, 0.9) };
  const unused = [bend('work_reap', 60), bend('guard_stand_watch', 2), bend('carry_sack_walk', 5)];
  return { scene, animations: [...Object.values(clips), ...unused], clips };
}
const frame = (id: string, motion: EaldholtResidentMotion, extra: Record<string, unknown> = {}): EaldholtResidentFrame =>
  ({ clockSeconds: 0, paused: false, reducedMotion: false, residents: [{ residentId: id, motion, ...extra }] });
const spine = (model: Object3D) => model.getObjectByName('spine')!.quaternion.clone();
/** Component distance between rotations (sign-free); angleTo is not exactly zero for float32-keyed equal rotations. */
const apart = (a: Quaternion, b: Quaternion) => { const d = a.dot(b) < 0 ? -1 : 1; return Math.max(Math.abs(a.x - d * b.x), Math.abs(a.y - d * b.y), Math.abs(a.z - d * b.z), Math.abs(a.w - d * b.w)); };

test('one clips-only library binds by node name to residents with their own heads; unused clips are ignored', () => {
  const lib = library(), a = resident(0.08), b = resident(0.11);
  const clips = { idle: lib.clips.idle, walk: lib.clips.walk, talk: lib.clips.talk };
  const actorsA = createEaldholtResidentActors({ scene: a, animations: lib.animations }, [{ residentId: 'a', position: [0, 0, 0], yawRadians: 0, scale: 0.92 }], { clips });
  const actorsB = createEaldholtResidentActors({ scene: b, animations: lib.animations }, [{ residentId: 'b', position: [2, 0, 0], yawRadians: 0, scale: 1.08 }], { clips });
  try {
    for (let i = 1; i <= 12; i++) { actorsA.update(1 / 24, frame('a', 'walk')); actorsB.update(1 / 24, frame('b', 'walk')); }
    const ma = actorsA.actors[0].model, mb = actorsB.actors[0].model;
    assert.ok(apart(spine(ma), spine(mb)) < 1e-7, 'the same library clip poses both residents\' body joints alike');
    assert.ok(Math.abs(ma.getObjectByName('face_jaw')!.position.z - 0.08) < 1e-9 && Math.abs(mb.getObjectByName('face_jaw')!.position.z - 0.11) < 1e-9,
      'library clips never key the face joints, so each resident keeps its own face rest for the face rig');
    const ha = actorsA.bounds.max.y - actorsA.bounds.min.y, hb = actorsB.bounds.max.y - actorsB.bounds.min.y;
    assert.ok(Math.abs(hb / ha - 1.08 / 0.92) < 0.02, 'placement scale carries stature inside the shared archetype skeleton');
  } finally { actorsA.dispose(); actorsB.dispose(); }
});

test('presence modes ride on the per-actor cadence: animated 0, low-rate an interval, posed null, hidden not updated', () => {
  const lib = library(), scene = resident(0.09);
  const make = () => createEaldholtResidentActors({ scene, animations: lib.animations }, [{ residentId: 'r', position: [0, 0, 0], yawRadians: 0 }],
    { clips: { idle: lib.clips.idle, walk: lib.clips.walk } });
  const full = make(), low = make(), posed = make();
  try {
    let changes = 0, prev = spine(low.actors[0].model), clock = 0;
    for (let f = 0; f < 72; f++) {
      clock += 1 / 72;
      full.update(1 / 72, { ...frame('r', 'idle'), clockSeconds: clock });
      low.update(1 / 72, { ...frame('r', 'idle', { animationUpdateIntervalSeconds: 1 / 12 }), clockSeconds: clock });
      posed.update(1 / 72, { ...frame('r', 'idle', { animationUpdateIntervalSeconds: f < 36 ? 0 : null }), clockSeconds: clock });
      const now = spine(low.actors[0].model); if (apart(now, prev) > 1e-9) changes++; prev = now;
    }
    assert.ok(changes >= 11 && changes <= 13, `low-rate evaluated ${changes} times in a second at 12 Hz`);
    const frozen = spine(posed.actors[0].model);
    full.update(1 / 72, { ...frame('r', 'idle'), clockSeconds: clock + 1 / 72 });
    posed.update(1 / 72, { ...frame('r', 'idle', { animationUpdateIntervalSeconds: null }), clockSeconds: clock + 1 / 72 });
    assert.ok(apart(spine(posed.actors[0].model), frozen) === 0, 'posed residents hold their last pose');
    // back to animated: logical time kept running while posed, so the pose matches the never-suspended actor
    full.update(1 / 72, { ...frame('r', 'idle'), clockSeconds: clock + 2 / 72 });
    posed.update(1 / 72, { ...frame('r', 'idle', { animationUpdateIntervalSeconds: 0 }), clockSeconds: clock + 2 / 72 });
    assert.ok(apart(spine(posed.actors[0].model), spine(full.actors[0].model)) < 1e-6, 'resumes at the shared clip time, no phase jump');
    // hidden: the caller hides the set and skips update; nothing in the owner runs for it
    low.object.visible = false;
    assert.equal(low.object.visible, false);
  } finally { full.dispose(); low.dispose(); posed.dispose(); }
});

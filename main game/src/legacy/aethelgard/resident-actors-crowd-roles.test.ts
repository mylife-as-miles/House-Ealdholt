import assert from 'node:assert/strict';
import test from 'node:test';
import { AnimationClip, Bone, BufferGeometry, Float32BufferAttribute, Group, Matrix4, MeshStandardMaterial, Quaternion, QuaternionKeyframeTrack,
  Skeleton, SkinnedMesh, Uint16BufferAttribute, VectorKeyframeTrack, type Object3D } from 'three';
import { createEaldholtResidentActors, type EaldholtResidentEnvelope, type EaldholtResidentFrame,
  type EaldholtResidentMotion } from './resident-actors';

// Crowd role loops (docs/legacy/claude-integration/characters/population-README.md): with patches 2, 4 and 5 a crowd
// resident plays its archetype library's role loop as `work`, the loop's `_enter` / `_exit` as workEnter / workExit and its
// walk variant's `_start` / `_stop` as start / stop, and the crowd adapter's conservative envelopes replace the owner's
// per-key measurement (each is still checked at 9 times). Requires characters-01 to 05.

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

test('role loops and transitions from the library, with precomputed envelopes checked rather than re-measured', () => {
  const lib = library(), scene = resident(0.09), c = lib.clips;
  const clips = { idle: c.idle, walk: c.walk, talk: c.talk, start: c.start, stop: c.stop, work: c.work, workEnter: c.workEnter, workExit: c.workExit };
  // the owner's own measurement, one motion at a time, then reused as the offline envelopes (with a margin)
  const measured = createEaldholtResidentActors({ scene, animations: lib.animations }, [{ residentId: 'm', position: [0, 0, 0], yawRadians: 0 }], { clips });
  const envelopes: Partial<Record<EaldholtResidentMotion, EaldholtResidentEnvelope>> = {};
  for (const motion of Object.keys(clips) as EaldholtResidentMotion[]) {
    measured.update(0, frame('m', motion)); const box = measured.actors[0].bounds;
    envelopes[motion] = { min: [box.min.x - 0.01, box.min.y - 0.01, box.min.z - 0.01], max: [box.max.x + 0.01, box.max.y + 0.01, box.max.z + 0.01] };
  }
  const measuredSamples = measured.metrics.envelopeSamples; measured.dispose();
  const actors = createEaldholtResidentActors({ scene, animations: lib.animations }, [{ residentId: 'r', position: [0, 0, 0], yawRadians: 0, scale: 1.05 }], { clips, envelopes });
  try {
    assert.equal(actors.metrics.envelopeSamples, 9 * Object.keys(clips).length, 'each supplied envelope is checked at 9 times');
    assert.ok(measuredSamples > 0, 'without envelopes the owner measured every key and midpoint itself');
    const seq: [EaldholtResidentMotion, number][] = [['workEnter', 0.9], ['work', 2.2], ['workExit', 0.9], ['start', 0.8], ['walk', 1], ['stop', 0.7], ['idle', 1]];
    for (const [motion, seconds] of seq) {
      for (let t = 0; t < seconds; t += 0.1) actors.update(0.1, frame('r', motion));
      assert.equal(actors.actors[0].activeMotion, motion); assert.equal(actors.actors[0].status, 'ready');
    }
    const bent = new Quaternion().fromArray(q(20));
    actors.update(0, frame('r', 'workExit', { animationTimeSeconds: 0.45 }));
    assert.ok(apart(spine(actors.actors[0].model), bent) < 1e-4, 'one-shots play from the library at the requested time');
  } finally { actors.dispose(); }
  const tight = { ...envelopes, work: { min: [-0.01, 0, -0.01], max: [0.01, 0.5, 0.01] } as EaldholtResidentEnvelope };
  assert.throws(() => createEaldholtResidentActors({ scene, animations: lib.animations }, [{ residentId: 'r', position: [0, 0, 0], yawRadians: 0 }], { clips, envelopes: tight }),
    /precomputed envelope does not contain/);
});

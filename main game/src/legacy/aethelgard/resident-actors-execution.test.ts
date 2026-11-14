import assert from 'node:assert/strict';
import test from 'node:test';
import { AnimationClip, Bone, BufferGeometry, Float32BufferAttribute, Group, Matrix4, MeshStandardMaterial, QuaternionKeyframeTrack,
  Skeleton, SkinnedMesh, Uint16BufferAttribute, VectorKeyframeTrack } from 'three';
import { HOUSEHOLD_ART_SETS } from '../../../../shared/legacy/aethelgard/characters/household-art-sets';
import { householdResidentAnimationMarkers, type ResidentAnimationEvent } from '../../../../shared/legacy/aethelgard/characters/resident-animation-execution';
import { createEaldholtResidentActors, type EaldholtResidentFrameState } from './resident-actors';

function fixture(constantWork = false) {
  const scene = new Group(), root = new Bone(), arm = new Bone(); root.name = 'root'; arm.name = 'arm'; root.add(arm); scene.add(root);
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute([-.1, 1, 0, .1, 1, 0, 0, 1.5, .1], 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4)); geometry.setIndex([0, 1, 2]);
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial()); scene.add(mesh); scene.updateMatrixWorld(true); mesh.bind(new Skeleton([root, arm]), new Matrix4());
  const idle = new AnimationClip('idle', 1, [new VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0, 0])]);
  const stop = new AnimationClip('walk_stop', 1, [new QuaternionKeyframeTrack('arm.quaternion', [0, 1], [Math.sin(.3), 0, 0, Math.cos(.3), 0, 0, 0, 1])]);
  const workValues = constantWork ? [Math.sin(.5), 0, 0, Math.cos(.5), Math.sin(.5), 0, 0, Math.cos(.5), Math.sin(.5), 0, 0, Math.cos(.5)]
    : [0, 0, 0, 1, Math.sin(.2), 0, 0, Math.cos(.2), 0, 0, 0, 1];
  const work = new AnimationClip('work_hammer', 2, [new QuaternionKeyframeTrack('arm.quaternion', [0, 1, 2], workValues)]);
  const walk = new AnimationClip('unsupported-root-translation', 1, [new VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 3, 0, 0])]);
  const markers = householdResidentAnimationMarkers(HOUSEHOLD_ART_SETS[0].events.work_hammer);
  const actors = createEaldholtResidentActors({ scene, animations: [idle, stop, work, walk] }, [{ residentId: 'resident', position: [0, 0, 0], yawRadians: 0 }],
    { clips: { idle, stop, work, walk }, markers: { work: markers, stop: [{ id: 'authored-stop-end', name: 'end', seconds: 1, kind: 'completion' }] } });
  let clock = 0;
  const update = (delta: number, motion: EaldholtResidentFrameState['motion'], extra: Partial<EaldholtResidentFrameState> = {}, paused = false) => {
    clock += delta;
    actors.update(delta, { clockSeconds: clock, paused, reducedMotion: false, residents: [{ residentId: 'resident', motion, ...extra }] });
  };
  const drain = () => { const events: ResidentAnimationEvent[] = []; actors.drainAnimationEvents(e => events.push({ ...e })); return events; };
  drain(); return { actors, actor: actors.actors[0], update, drain, root, work, stop };
}

test('actual owner lifecycle distinguishes queued, evaluated, final-pose and cancelled requests', () => {
  const r = fixture();
  r.update(.4, 'stop', { animationUpdateIntervalSeconds: null });
  assert.equal(r.actor.activeMotion, 'idle'); assert.equal(r.actor.animationExecution.state, 'ready'); assert.equal(r.actor.animationExecution.hold, 'cadence');
  r.update(.7, 'stop', { animationUpdateIntervalSeconds: null });
  assert.equal(r.actor.animationExecution.state, 'finishing'); assert.equal(r.actor.activeMotion, 'idle');
  r.update(0, 'stop', { animationUpdateIntervalSeconds: 0 });
  assert.equal(r.actor.activeMotion, 'stop'); assert.equal(r.actor.animationExecution.state, 'completed'); assert.equal(r.actor.mixer.existingAction(r.stop)!.time, 1);
  const completed = r.drain().filter(e => e.kind === 'lifecycle' && e.state === 'completed'); assert.equal(completed.length, 1);
  r.update(.5, 'stop'); assert.equal(r.drain().length, 0);
  r.update(.1, 'work'); r.drain(); r.actors.dispose();
  assert.equal(r.actor.animationExecution.state, 'cancelled'); assert.equal(r.actor.animationExecution.hold, 'disposed');
  assert.equal(r.drain().filter(e => e.state === 'cancelled').length, 1);
});

test('actual owner crosses genuine hammer markers through loops, pause and bounded cadence', () => {
  const r = fixture(); r.update(1, 'work');
  assert.deepEqual(r.drain().filter(e => e.kind === 'marker').map(e => [e.markerName, e.seconds, e.loop]), [['impactSeconds', 19 / 30, 0]]);
  const pose = r.actor.mixer.existingAction(r.work)!.time;
  r.update(1, 'work', {}, true); assert.equal(r.actor.mixer.existingAction(r.work)!.time, pose); assert.deepEqual(r.drain(), []);
  r.update(1, 'work', { animationUpdateIntervalSeconds: null }); assert.equal(r.drain().filter(e => e.kind === 'marker').length, 0);
  r.update(1, 'work', { animationUpdateIntervalSeconds: null });
  r.update(0, 'work', { animationUpdateIntervalSeconds: 0 });
  assert.deepEqual(r.drain().filter(e => e.kind === 'marker').map(e => [e.seconds, e.loop]), [[49 / 30, 0], [2 + 19 / 30, 1]]);
  r.actors.dispose();
});

test('absolute pose samples skip old markers; explicit replay renews the real one-shot and marker lifecycle', () => {
  const r = fixture(); r.update(0, 'work', { animationTimeSeconds: 10.5 }); assert.equal(r.drain().filter(e => e.kind === 'marker').length, 0);
  r.update(0, 'work', { animationTimeSeconds: 10.9, animationTimeMode: 'advance' });
  assert.deepEqual(r.drain().filter(e => e.kind === 'marker').map(e => e.loop), [5]);
  r.update(0, 'work', { animationTimeSeconds: .1 }); r.update(.9, 'work'); assert.equal(r.drain().filter(e => e.kind === 'marker').length, 0);
  r.update(1, 'stop', { animationPlaybackId: 'first' }); assert.equal(r.actor.animationExecution.state, 'completed');
  r.update(.25, 'stop', { animationPlaybackId: 'replay', animationUpdateIntervalSeconds: null });
  assert.equal(r.actor.animationExecution.state, 'ready');
  r.update(.25, 'stop', { animationPlaybackId: 'replay', animationUpdateIntervalSeconds: 0 });
  assert.equal(r.actor.animationExecution.state, 'playing'); assert.equal(r.actor.mixer.existingAction(r.stop)!.time, .5);
  r.update(.5, 'stop', { animationPlaybackId: 'replay' });
  assert.equal(r.actor.animationExecution.state, 'completed');
  assert.equal(r.drain().filter(e => e.kind === 'lifecycle' && e.state === 'completed').length, 2);
  r.actors.dispose();
});

test('missing and root-moving travel clips hold the actual pose while route position stays authoritative', () => {
  const r = fixture(); r.update(.75, 'work');
  const action = r.actor.mixer.existingAction(r.work)!, pose = r.actor.model.getObjectByName('arm')!.quaternion.clone(), time = action.time;
  r.update(.5, 'sit', { animationTimeSeconds: 99, position: [4, 0, 2] });
  assert.equal(r.actor.activeMotion, 'work'); assert.equal(action.time, time); assert.ok(r.actor.model.getObjectByName('arm')!.quaternion.equals(pose));
  assert.equal(r.actor.animationExecution.state, 'failed'); assert.equal(r.actor.animationExecution.hold, 'clip-unavailable');
  r.update(.5, 'walk', { animationTimeSeconds: .5, position: [5, 0, 2] });
  assert.equal(r.actor.activeMotion, 'work'); assert.equal(r.actor.animationExecution.hold, 'root-motion-unqualified');
  assert.deepEqual(r.actor.placement.position.toArray(), [5, 0, 2]); assert.equal(r.actor.model.getObjectByName('root')!.position.x, 0);
  assert.deepEqual(r.root.position.toArray(), [0, 0, 0]); assert.ok(r.actors.bounds.containsBox(r.actor.bounds));
  r.actors.dispose();
});

test('cold paused initialization adopts the exact pose without marker or delta catchup', () => {
  for (const reducedMotion of [false, true]) {
  const r = fixture();
  r.actors.update(1, { clockSeconds: 100, paused: true, reducedMotion, initializePausedPose: true,
    residents: [{ residentId: 'resident', motion: 'work', position: [8, 0, 2], animationTimeSeconds: 1 }] });
  assert.equal(r.actor.activeMotion, 'work'); assert.equal(r.actor.mixer.existingAction(r.work)!.time, 1);
  assert.equal(r.actor.animationExecution.hold, 'paused'); assert.deepEqual(r.actor.placement.position.toArray(), [8, 0, 2]);
  assert.equal(r.drain().filter(e => e.kind === 'marker').length, 0);
  r.actors.dispose();
  }
});


test('a longer outgoing fade settles after an incoming one-shot clamps, then completes its actual final pose once', () => {
  const r = fixture(true); r.update(0, 'work'); r.drain();
  const arm = r.actor.model.getObjectByName('arm')!;
  assert.ok(Math.abs(2 * Math.acos(arm.quaternion.w) - 1) < 1e-6);
  r.update(1, 'stop', { fadeSeconds: 2 });
  assert.equal(r.actor.mixer.existingAction(r.stop)!.time, 1);
  assert.equal(r.actor.fadingFrom, 'work'); assert.equal(r.actor.animationExecution.state, 'finishing');
  assert.ok(Math.abs(2 * Math.acos(arm.quaternion.w) - 1) < 1e-6, 'the endpoint still has zero weight at fade entry');
  const first = r.drain();
  assert.equal(first.filter(e => e.kind === 'marker' && e.markerId === 'authored-stop-end').length, 0, 'the zero-weight endpoint was never evaluated');
  assert.equal(first.filter(e => e.kind === 'lifecycle' && e.state === 'completed').length, 0);
  for (let i = 0; i < 3; i++) {
    r.update(.5, 'stop'); assert.equal(r.actor.animationExecution.state, 'finishing');
    assert.equal(r.actor.mixer.existingAction(r.stop)!.time, 1);
  }
  r.update(.5, 'stop'); assert.equal(r.actor.fadingFrom, null); assert.equal(r.actor.animationExecution.state, 'completed');
  assert.ok(Math.abs(arm.quaternion.x) < 1e-6 && Math.abs(arm.quaternion.w - 1) < 1e-6);
  const settled = r.drain(); assert.equal(settled.filter(e => e.kind === 'marker').length, 0);
  assert.equal(settled.filter(e => e.kind === 'lifecycle' && e.state === 'completed').length, 1);
  const mixerTime = r.actor.mixer.time;
  r.update(.5, 'stop'); assert.equal(r.actor.mixer.time, mixerTime); assert.equal(r.actor.mixer.existingAction(r.stop)!.time, 1);
  assert.deepEqual(r.drain(), []); r.actors.dispose();
});


test('zero-weight incoming work cannot emit an unevaluated hammer contact or replay it after fading in', () => {
  const r = fixture(); r.update(1, 'work', { fadeSeconds: .1 });
  const action = r.actor.mixer.existingAction(r.work)!;
  assert.equal(action.time, 1); assert.equal(action.getEffectiveWeight(), 0);
  assert.equal(r.actor.model.getObjectByName('arm')!.quaternion.x, 0);
  assert.equal(r.actor.animationExecution.state, 'ready'); assert.equal(r.actor.animationExecution.hold, 'blend-zero-weight');
  assert.equal(r.actor.animationExecution.evaluatedTimeSeconds, 0);
  assert.equal(r.drain().filter(e => e.kind === 'marker' || e.state === 'playing').length, 0);
  r.update(.05, 'work'); assert.ok(action.getEffectiveWeight() > 0); assert.equal(r.actor.animationExecution.state, 'playing');
  assert.equal(r.drain().filter(e => e.kind === 'marker').length, 0, 'the invisible 19/30s impact stays skipped');
  r.update(.1, 'work'); assert.equal(r.actor.fadingFrom, null);
  r.update(.5, 'work');
  assert.deepEqual(r.drain().filter(e => e.kind === 'marker').map(e => [e.markerName, e.seconds]), [['impactSeconds', 49 / 30]]);
  r.update(0, 'work'); assert.equal(r.drain().filter(e => e.kind === 'marker').length, 0);
  r.actors.dispose();
});

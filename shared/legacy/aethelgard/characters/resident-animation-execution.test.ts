import assert from 'node:assert/strict';
import test from 'node:test';
import { HOUSEHOLD_ART_SETS } from './household-art-sets';
import { ResidentAnimationExecution, householdResidentAnimationMarkers, qualifyResidentAnimationClip,
  type ResidentAnimationEvent, type ResidentAnimationMarker } from './resident-animation-execution';

const marker = (id: string, seconds: number): ResidentAnimationMarker => ({ id, name: id, seconds, kind: 'phase' });
const drain = (execution: ResidentAnimationExecution) => { const events: ResidentAnimationEvent[] = []; execution.drainEvents(e => events.push({ ...e })); return events; };

test('marker admission rejects malformed phases, duplicated IDs, unordered times and loop completion', () => {
  const qualify = (markers: readonly ResidentAnimationMarker[], loop = false) => qualifyResidentAnimationClip('authored', 1, loop, markers);
  for (const markers of [[marker('a', NaN)], [marker('a', -1)], [marker('a', 1.1)], [marker('a', .6), marker('b', .2)],
    [marker('a', .2), marker('a', .3)], [{ ...marker('a', .5), kind: 'completion' as const }]]) assert.throws(() => qualify(markers), /markers/);
  assert.throws(() => qualify([{ ...marker('end', 1), kind: 'completion' }], true), /markers/);
  assert.throws(() => qualifyResidentAnimationClip('authored', 0, false), /metadata/);
  assert.deepEqual(qualify([marker('a', .2), marker('b', .2)]).markers.map(m => m.id), ['a', 'b']);
});

test('real publisher household event and attachment tables import their exact seconds', () => {
  const smith = HOUSEHOLD_ART_SETS.find(s => s.actorMotions.work === 'work_hammer')!;
  const work = householdResidentAnimationMarkers(smith.events.work_hammer);
  assert.deepEqual(work.map(m => [m.name, m.seconds, m.kind]), [['impactSeconds', 19 / 30, 'contact'], ['impactSeconds', 49 / 30, 'contact']]);
  const enter = householdResidentAnimationMarkers(undefined, smith.workTransitions!.swaps.work_enter);
  assert.deepEqual(enter.map(m => [m.name, m.seconds, m.kind]), [['prop_tongs:hand', .62, 'attachment'], ['prop_hammer:hand', .78, 'attachment']]);
  assert.deepEqual(householdResidentAnimationMarkers(undefined), []);
});

test('one-shot completion waits for its actual final evaluated pose and emits once', () => {
  const execution = new ResidentAnimationExecution('resident'), clip = qualifyResidentAnimationClip('authored-enter', 1, false, [marker('touch', .5)]);
  execution.request('workEnter', clip, undefined, 0); assert.equal(execution.snapshot.state, 'ready');
  execution.evaluate(); assert.equal(execution.snapshot.state, 'playing');
  execution.stage(1); assert.equal(execution.snapshot.state, 'finishing'); assert.equal(execution.snapshot.evaluatedTimeSeconds, 0);
  assert.equal(drain(execution).filter(e => e.kind === 'marker').length, 0);
  execution.evaluate(); assert.equal(execution.snapshot.state, 'completed');
  const events = drain(execution); assert.deepEqual(events.filter(e => e.kind === 'marker').map(e => e.markerId), ['touch']);
  assert.equal(events.filter(e => e.state === 'completed').length, 1);
  execution.stage(1); execution.evaluate(); assert.deepEqual(drain(execution), []);
});

test('crossing dispatch handles wraps and skipped frames in authored order without duplicates', () => {
  const execution = new ResidentAnimationExecution('resident'), clip = qualifyResidentAnimationClip('authored-loop', 1, true, [marker('start', 0), marker('a', .2), marker('b', .8), marker('end', 1)]);
  execution.request('work', clip, undefined, .1); execution.evaluate(); drain(execution);
  execution.stage(2.3); execution.evaluate();
  assert.deepEqual(drain(execution).map(e => [e.markerId, e.loop]), [['a', 0], ['b', 0], ['end', 0], ['start', 1], ['a', 1], ['b', 1], ['end', 1], ['start', 2], ['a', 2]]);
  execution.stage(2.3); execution.evaluate(); assert.deepEqual(drain(execution), []);
});

test('seeks skip contacts and retain high water; only an explicit new playback re-arms them', () => {
  const execution = new ResidentAnimationExecution('resident'), clip = qualifyResidentAnimationClip('authored-loop', 1, true, [marker('a', .2), marker('b', .8)]);
  execution.request('work', clip, 'first', 0); execution.evaluate(); drain(execution);
  execution.stage(.6); execution.evaluate(); assert.deepEqual(drain(execution).map(e => e.markerId), ['a']);
  execution.stage(.1, true); execution.evaluate(); execution.stage(.6); execution.evaluate(); assert.deepEqual(drain(execution), []);
  execution.stage(10.6, true); execution.evaluate(); assert.deepEqual(drain(execution), []);
  execution.stage(10.9); execution.evaluate(); assert.deepEqual(drain(execution).map(e => [e.markerId, e.loop]), [['b', 10]]);
  execution.request('work', clip, 'second', 0); execution.evaluate(); drain(execution);
  execution.stage(.3); execution.evaluate(); assert.deepEqual(drain(execution).map(e => e.markerId), ['a']);
});

test('superseding or disposing cancels a live request; missing clips fail without a playing claim', () => {
  const execution = new ResidentAnimationExecution('resident'), clip = qualifyResidentAnimationClip('idle', 1, true);
  execution.request('idle', clip, undefined, 0); execution.evaluate(); drain(execution);
  execution.request('work', null, undefined, 0);
  assert.equal(execution.snapshot.state, 'failed'); assert.equal(execution.snapshot.hold, 'clip-unavailable');
  assert.deepEqual(drain(execution).map(e => [e.motion, e.state]), [['idle', 'cancelled'], ['work', 'requested'], ['work', 'failed']]);
  execution.request('idle', clip, undefined, 0); execution.evaluate(); execution.cancel(true);
  assert.equal(execution.snapshot.state, 'cancelled'); assert.equal(execution.snapshot.hold, 'disposed');
});

test('long jumps use a bounded preallocated queue and publish dropped-event diagnostics', () => {
  const execution = new ResidentAnimationExecution('resident', 8), clip = qualifyResidentAnimationClip('tiny-loop', .01, true, [marker('pulse', .005)]);
  execution.request('work', clip, undefined, 0); execution.evaluate(); drain(execution);
  execution.stage(1); execution.evaluate(); const events = drain(execution);
  assert.equal(events.length, 8); assert.equal(execution.snapshot.markerEvents, 100); assert.equal(execution.snapshot.droppedEvents, 92);
  assert.deepEqual(events.map(e => e.loop), [92, 93, 94, 95, 96, 97, 98, 99]);
  const hostile = qualifyResidentAnimationClip('tiny', Number.MIN_VALUE, true, [marker('pulse', 0)]);
  execution.request('work', hostile, 'tiny', 0); execution.stage(1); execution.evaluate();
  assert.equal(execution.snapshot.droppedEvents, Number.MAX_SAFE_INTEGER);
});

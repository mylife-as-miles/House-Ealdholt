import assert from 'node:assert/strict';
import test from 'node:test';
import { createResidentProcessingBudget, type ResidentProcessingScheduler } from './resident-processing-budget';
import type { VillagePopulationResidentState, VillagePopulationSample } from './village-population-runtime';

function sample(time = 540): VillagePopulationSample {
  return { generation: 1, navigationAuthority: 'resident-life',
    time: { absoluteWorldMinute: time, dayIndex: 0, dayMinute: time, fractionalMinute: 0, elapsedWorldMinutes: 0, deferredMilliseconds: 0 },
    counts: { total: 100, households: 25, major: 20, scheduled: 80, mapped: 100, unmapped: 0, moving: 100, blocked: 0 },
    residents: Array.from({ length: 100 }, (_, i): VillagePopulationResidentState => ({ residentId: `resident-${i}`, tier: i < 20 ? 'major' : 'scheduled',
      activity: 'walk', roleClip: null, availableRoleClips: [], scheduledPlaceId: 'work', placeId: null, fromPlaceId: 'home',
      slotIndex: 0, slotStartMinute: 0, slotEndMinute: 1440, status: 'travelling', reason: null,
      position: [i, 0, 0], yawRadians: 0, moving: true, presentable: true, navigationStatus: 'travelling', navigationReason: null })) };
}
function scheduler() {
  const callbacks: Array<{ callback: () => void; cancelled: boolean }> = [];
  const surface: ResidentProcessingScheduler = { schedule(callback) {
    const entry = { callback, cancelled: false }; callbacks.push(entry);
    return { cancel() { entry.cancelled = true; } };
  } };
  return { surface, callbacks,
    one() { const entry = callbacks.shift(); if (entry && !entry.cancelled) entry.callback(); },
    drain() { let turns = 0; while (callbacks.length) { this.one(); assert.ok(++turns < 100, 'finite resident work drains'); } },
  };
}

test('100 residents are qualified in bounded CPU tasks and publish one complete captured frame', () => {
  const tasks = scheduler(), frame = { sample: sample(), clockSeconds: 22, paused: false, animationRate: 1 };
  const admitted: string[] = [], frames: typeof frame[] = [];
  const budget = createResidentProcessingBudget({ scheduler: tasks.surface, now: () => 0,
    maximumQualificationsPerTask: 8, expensive: () => true,
    qualify(row) { admitted.push(row.residentId); return row.position; },
    accepted(actual, qualifications) { assert.equal(qualifications.size, 100); frames.push(actual as typeof frame); }, onError(error) { throw error; } });
  budget.request(frame, 'source-a', row => row.residentId === 'resident-99' ? 1e6 : -row.position![0]);
  assert.equal(admitted.length, 8); assert.equal(admitted[0], 'resident-99');
  assert.deepEqual(frames, []); assert.equal(budget.diagnostics.backlog, 92);
  tasks.one(); assert.equal(admitted.length, 16); assert.deepEqual(frames, []);
  tasks.drain(); assert.deepEqual(frames, [frame]); assert.equal(new Set(admitted).size, 100);
  assert.equal(budget.diagnostics.maximumQualificationsInTask, 8);
  assert.equal(budget.diagnostics.tierQualifications.major, 20); assert.equal(budget.diagnostics.tierQualifications.scheduled, 80);
  assert.ok(Object.isFrozen(budget.diagnostics)); assert.ok(Object.isFrozen(budget.diagnostics.tierMilliseconds)); budget.dispose();
});

test('latest commands coalesce while the finite older frame finishes without starving distant residents', () => {
  const tasks = scheduler(), published: Array<{ sample: VillagePopulationSample; clockSeconds: number; paused: boolean; animationRate: number }> = [];
  const budget = createResidentProcessingBudget({ scheduler: tasks.surface, now: () => 0, maximumQualificationsPerTask: 10,
    expensive: () => true, qualify: row => row.position,
    accepted(frame) { published.push(frame as typeof published[number]); }, onError(error) { throw error; } });
  const first = { sample: sample(), clockSeconds: 1, paused: false, animationRate: 1 };
  budget.request(first, 'source-a', () => 0);
  let latest = first;
  for (let i = 0; i < 8; i++) {
    latest = { sample: { ...sample(), residents: sample().residents.map(row => ({ ...row, position: [row.position![0] + i + 1, 0, 0] })) },
      clockSeconds: i + 2, paused: i % 2 === 0, animationRate: i + 1 };
    budget.request(latest, 'source-a', () => 0); tasks.one();
  }
  assert.equal(published.length, 0); tasks.drain(); assert.equal(published.length, 2);
  assert.strictEqual(published[0], first); assert.strictEqual(published[1], latest);
  assert.equal(budget.diagnostics.qualifications, 200); assert.equal(budget.diagnostics.queuedFrame, false); budget.dispose();
});

test('exact row reuse never reuses changed intent, hidden-peer hold, arrival, route or dwell facts', () => {
  const tasks = scheduler(), processed: string[] = [];
  const budget = createResidentProcessingBudget({ scheduler: tasks.surface, now: () => 0, expensive: row => row.presentable,
    qualify(row) { processed.push(row.residentId); return JSON.stringify(row); },
    accepted() {}, onError(error) { throw error; } });
  const first = sample(); budget.request({ sample: first }, 'source-a', () => 0); tasks.drain(); processed.length = 0;
  const second = { ...first, time: { ...first.time, fractionalMinute: .5 }, residents: first.residents.map(row => ({ ...row })) };
  budget.request({ sample: second }, 'source-a', () => 0); assert.equal(processed.length, 0); assert.equal(budget.diagnostics.cacheHits, 100);
  const changed = second.residents.map((row, i) => i === 0 ? { ...row, presentable: false, navigationReason: 'corridor-reserved' }
    : i === 1 ? { ...row, scheduledPlaceId: 'new-work', arrivalEvidence: 'certified-route-arrival' as const, arrivedAtAbsoluteMinute: 540 }
    : i === 2 ? { ...row, patrolDwell: { elapsedSeconds: 2, durationSeconds: 10 } }
    : i === 3 ? { ...row, lifeIntent: { residentId: row.residentId, activity: 'shelter', activityKey: 'shelter' as const,
      targetPlaceId: 'home', priority: 9, issuedAbsoluteMinute: 540, indoor: true, companionIds: [], reason: 'weather' as const } } : row);
  budget.request({ sample: { ...second, residents: changed } }, 'source-a', () => 0); tasks.drain();
  assert.deepEqual(new Set(processed), new Set(['resident-0', 'resident-1', 'resident-2', 'resident-3'])); budget.dispose();
});

test('source/context changes and backwards clocks cancel obsolete jobs and disposal rejects late callbacks', () => {
  const tasks = scheduler(), accepted: string[] = [];
  const budget = createResidentProcessingBudget<{ sample: VillagePopulationSample; tag: string }, VillagePopulationResidentState['position']>({ scheduler: tasks.surface, now: () => 0, maximumQualificationsPerTask: 2,
    expensive: () => true, qualify: row => row.position,
    accepted(frame) { accepted.push(frame.tag); }, onError(error) { throw error; } });
  budget.request({ sample: sample(), tag: 'old-source' }, 'a', () => 0);
  const obsolete = tasks.callbacks[0].callback;
  budget.request({ sample: sample(), tag: 'new-source' }, 'b', () => 0); obsolete(); tasks.drain();
  assert.deepEqual(accepted, ['new-source']);
  budget.request({ sample: { ...sample(541), residents: sample(541).residents.map(row => ({ ...row, position: [101, 0, 0] })) }, tag: 'future' }, 'b', () => 0);
  assert.ok(budget.diagnostics.backlog > 0);
  budget.request({ sample: sample(539), tag: 'reversed' }, 'b', () => 0); tasks.drain();
  assert.deepEqual(accepted, ['new-source', 'reversed']); assert.ok(budget.diagnostics.qualifications >= 202);
  budget.request({ sample: sample(538), tag: 'disposed' }, 'b', () => 0);
  const late = tasks.callbacks[tasks.callbacks.length - 1].callback; budget.dispose(); late(); tasks.drain();
  assert.equal(accepted[accepted.length - 1], 'reversed'); assert.equal(budget.diagnostics.taskPending, false);
});

test('deadline yields after one indivisible costly qualification and reports its actual cost', () => {
  const tasks = scheduler(); let time = 0;
  const budget = createResidentProcessingBudget({ scheduler: tasks.surface, now: () => time, maximumTaskMilliseconds: 3,
    expensive: () => true, qualify() { time += 7; return true; }, accepted() {}, onError(error) { throw error; } });
  budget.request({ sample: sample() }, 'a', () => 0);
  assert.equal(budget.diagnostics.qualifications, 1); assert.equal(budget.diagnostics.backlog, 99);
  assert.equal(budget.diagnostics.maximumTaskMilliseconds, 7); assert.equal(budget.diagnostics.tierMilliseconds.major, 7);
  budget.dispose();
});

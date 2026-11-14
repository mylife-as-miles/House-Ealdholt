import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { EALDHOLT_VILLAGE_POPULATION as population } from './village-population';
import { createVillagePopulationObservationPump, type VillagePopulationObservationScheduler } from './village-population-observation-pump';
import { createVillagePopulationRuntime, advanceVillagePopulationRuntime, serializeVillagePopulationRuntime,
  sampleVillagePopulationRuntime, getVillagePopulationObservationStatus, type VillagePopulationRuntime } from './village-population-runtime';
import { createEaldholtVillageSite, applyVillageSiteRigidClearance, validateVillageSiteRigidClearance } from './village-site';

const CREATED = 1800000000000, PACE = 4000;
function create(worldKey = 'observation-pump-fixture') {
  const r = createVillagePopulationRuntime({ population, confirmedEntry: true, worldKey, contentRevision: 'pump-test',
    createdAt: CREATED, initialDayMinute: 540, millisecondsPerWorldMinute: PACE, walkingSpeedMetresPerSecond: .8 });
  assert.ok(r.ok); return r.snapshot;
}
function queue() {
  const tasks: { callback(): void; cancelled: boolean }[] = [];
  const scheduler: VillagePopulationObservationScheduler = { schedule(callback) {
    const task = { callback, cancelled: false }; tasks.push(task); return { cancel() { task.cancelled = true; } };
  } };
  return { scheduler, tasks,
    next(evenCancelled = false) { const task = tasks.shift(); assert.ok(task); if (evenCancelled || !task.cancelled) task.callback(); },
    drain() { for (let i = 0; tasks.length; i++) { assert.ok(i < 1000, 'catch-up must quiesce'); this.next(); } },
  };
}

test('deferred owner drains existing two-minute slices with no render, canonical write or changed life decisions', () => {
  const canonical = create(), saved = serializeVillagePopulationRuntime(canonical), tasks = queue();
  const accepted: VillagePopulationRuntime[] = []; let now = 0, notifications = 0;
  const pump = createVillagePopulationObservationPump({ read: () => ({ owner: canonical, snapshot: canonical, requestedMilliseconds: 60 * PACE }),
    allowed: () => true, accepted: s => { accepted.push(s); now += 1; }, changed: () => { notifications++; }, scheduler: tasks.scheduler, now: () => now });
  const first = pump.step()!; assert.equal(first.clock.simulatedElapsedMilliseconds, 2 * PACE);
  assert.equal(tasks.tasks.length, 1); tasks.drain();
  const last = pump.snapshot!; assert.equal(last.clock.simulatedElapsedMilliseconds, 60 * PACE);
  assert.equal(getVillagePopulationObservationStatus(last)?.pendingMilliseconds, 0);
  assert.equal(pump.stats.taskPending, false);
  let previous = 0;
  for (const value of accepted) { assert.ok(value.clock.simulatedElapsedMilliseconds - previous <= 2 * PACE); previous = value.clock.simulatedElapsedMilliseconds; }
  const ordinary = advanceVillagePopulationRuntime(canonical, { expectedGeneration: canonical.generation, worldKey: canonical.worldKey,
    contentRevision: canonical.contentRevision, observedAt: CREATED + 60 * PACE, maxAdvanceMinutes: 60 });
  assert.ok(ordinary.ok); assert.deepEqual(last.life, ordinary.snapshot.life); assert.deepEqual(last.navigation, ordinary.snapshot.navigation);
  assert.deepEqual(serializeVillagePopulationRuntime(canonical), saved); assert.equal(serializeVillagePopulationRuntime(last).ok, false);
  assert.equal(advanceVillagePopulationRuntime(last, { expectedGeneration: last.generation, worldKey: last.worldKey,
    contentRevision: last.contentRevision, observedAt: CREATED + 61 * PACE, maxAdvanceMinutes: 1 }).ok, false);
  assert.equal(notifications, 2, 'intermediate slices update the cache without requesting a heavy draw per slice');
  pump.dispose();
});

test('inactivity pauses queued work, late cancelled callbacks cannot commit, and resuming keeps the existing branch', () => {
  const canonical = create(), tasks = queue(); let allowed = true, accepts = 0;
  const pump = createVillagePopulationObservationPump({ read: () => ({ owner: canonical, snapshot: canonical, requestedMilliseconds: 20 * PACE }),
    allowed: () => allowed, accepted: () => { accepts++; }, scheduler: tasks.scheduler });
  pump.step(); const first = pump.snapshot; allowed = false; pump.pause(); tasks.next(true);
  assert.equal(accepts, 1); assert.equal(pump.snapshot, first); assert.equal(pump.stats.taskPending, false);
  pump.step(); assert.equal(accepts, 1); allowed = true; pump.wake(); tasks.drain();
  assert.equal(pump.snapshot?.clock.simulatedElapsedMilliseconds, 20 * PACE); pump.dispose();
});

test('clear and disposal invalidate even callbacks whose scheduler fails to remove them', () => {
  const canonical = create(), tasks = queue(); let accepts = 0;
  const pump = createVillagePopulationObservationPump({ read: () => ({ owner: canonical, snapshot: canonical, requestedMilliseconds: 20 * PACE }),
    allowed: () => true, accepted: () => { accepts++; }, scheduler: tasks.scheduler });
  pump.step(); pump.clear(); tasks.next(true); assert.equal(accepts, 1); assert.equal(pump.snapshot, null);
  pump.step(); assert.equal(pump.snapshot?.clock.simulatedElapsedMilliseconds, 2 * PACE);
  pump.dispose(); tasks.next(true); assert.equal(accepts, 2); assert.equal(pump.snapshot, null); assert.equal(pump.stats.taskPending, false);
});

test('a queued callback reads the current owner and never publishes the old visit under a new world', () => {
  const a = create('first-pump-world'), b = create('second-pump-world'), tasks = queue();
  let canonical = a, owner = {}, requested = 20 * PACE; const values: VillagePopulationRuntime[] = [];
  const pump = createVillagePopulationObservationPump({ read: () => ({ owner, snapshot: canonical, requestedMilliseconds: requested }),
    allowed: () => true, accepted: s => values.push(s), scheduler: tasks.scheduler });
  pump.step(); canonical = b; owner = {}; requested = 4 * PACE; tasks.next();
  assert.equal(values.length, 2); assert.equal(values[1].worldKey, b.worldKey);
  assert.equal(values[1].clock.simulatedElapsedMilliseconds, 2 * PACE); tasks.drain();
  assert.equal(pump.snapshot?.clock.simulatedElapsedMilliseconds, 4 * PACE); pump.dispose();
});

test('a queued slice uses the live speed target, weather and safety callbacks instead of captured commands', () => {
  const canonical = create(), tasks = queue(); let requested = 20 * PACE, rainy = false, safetyReads = 0;
  const pump = createVillagePopulationObservationPump({ read: () => ({ owner: canonical, snapshot: canonical, requestedMilliseconds: requested,
    options: { environmentAt: () => rainy ? { weather: 'rain' as const, rain: 1 } : undefined, signalsAt: () => { safetyReads++; return []; } } }),
    allowed: () => true, accepted: () => undefined, scheduler: tasks.scheduler });
  // A normal pause anchors the already requested clock, not the earlier
  // displayed catch-up cursor. A newer target/command supersedes queued work.
  pump.step(); rainy = true; requested = 30 * PACE; tasks.next();
  assert.equal(pump.stats.error, '');
  assert.equal(pump.snapshot?.clock.simulatedElapsedMilliseconds, 4 * PACE);
  assert.ok(pump.snapshot!.life.journal.some(event => event.kind === 'weather-interrupted'));
  assert.ok(safetyReads > 0); tasks.drain();
  assert.equal(pump.snapshot?.clock.simulatedElapsedMilliseconds, requested);
  const held = pump.snapshot; tasks.drain(); assert.equal(pump.snapshot, held); pump.dispose();
});

test('reentrant clear from a live command callback cannot publish or schedule the abandoned result', () => {
  const canonical = create(), tasks = queue(); let clear = true, accepts = 0;
  const pump = createVillagePopulationObservationPump({ read: () => ({ owner: canonical, snapshot: canonical, requestedMilliseconds: 20 * PACE,
    options: { environmentAt: () => { if (clear) { clear = false; pump.clear(); } return undefined; } } }),
    allowed: () => true, accepted: () => { accepts++; }, scheduler: tasks.scheduler });
  pump.step(); assert.equal(accepts, 0); assert.equal(pump.snapshot, null); assert.equal(tasks.tasks.length, 0);
  pump.step(); assert.equal(accepts, 1); assert.equal(pump.snapshot?.clock.simulatedElapsedMilliseconds, 2 * PACE); pump.dispose();
});

test('an inline scheduler is rejected without a recursive catch-up loop or dangling task', () => {
  const canonical = create(); let errors = 0;
  const pump = createVillagePopulationObservationPump({ read: () => ({ owner: canonical, snapshot: canonical, requestedMilliseconds: 20 * PACE }),
    allowed: () => true, accepted: () => undefined, onError: () => { errors++; },
    scheduler: { schedule(callback) { callback(); return { cancel() {} }; } } });
  pump.step(); assert.equal(errors, 1); assert.match(pump.stats.error, /defer/); assert.equal(pump.stats.taskPending, false);
  assert.equal(pump.stats.slices, 1); pump.dispose();
});

test('default CPU task scheduling completes a read-only backlog without any renderer or frame callbacks', async () => {
  const canonical = create(), before = serializeVillagePopulationRuntime(canonical);
  let finished!: () => void; const completed = new Promise<void>(resolve => { finished = resolve; });
  const pump = createVillagePopulationObservationPump({ read: () => ({ owner: canonical, snapshot: canonical, requestedMilliseconds: 12 * PACE }),
    allowed: () => true, accepted: s => { if (!getVillagePopulationObservationStatus(s)?.pendingMilliseconds) finished(); } });
  const timeout = setTimeout(() => { finished(); }, 2000);
  try { pump.step(); await completed; assert.equal(pump.snapshot?.clock.simulatedElapsedMilliseconds, 12 * PACE); }
  finally { clearTimeout(timeout); pump.dispose(); }
  assert.deepEqual(serializeVillagePopulationRuntime(canonical), before);
});

const DIR = process.env.CROWNFALL_PATROL_SOURCE_FIXTURES ?? '/workspace/private-assets/crownfall/fresh-lane-patrol-v4-paired-2026-11-11';
const LEGACY = '/workspace/private-assets/crownfall/new-motion-evidence-2026-11-11/fresh-candidate-integration-v4-release-ready/desktop-fresh-commute-sites.json';
function source(file: string) {
  const d = JSON.parse(readFileSync(file, 'utf8'));
  const site = createEaldholtVillageSite({ profile: d.binding.profile, modelSha256: d.binding.sourceSha256,
    binding: d.binding, certificate: d.certificate, placeBindings: d.placeBindings, residentPlaceBindings: d.residentPlaceBindings });
  return applyVillageSiteRigidClearance(site, validateVillageSiteRigidClearance(site, d.rigidSourceClearance));
}
test('actual paired source drains to genuine patrols with no render; changing source holds the existing branch without a reset',
  { skip: (!existsSync(`${DIR}/desktop-guard-lane-patrol-v1.json`) || !existsSync(LEGACY)) && 'Requires the private reviewed paired source and unchanged legacy control.' }, () => {
    const site = source(`${DIR}/desktop-guard-lane-patrol-v1.json`), canonical = create(), before = serializeVillagePopulationRuntime(canonical), tasks = queue();
    let currentSite = site, requested = 245 * PACE; const commits: VillagePopulationRuntime[] = [];
    const pump = createVillagePopulationObservationPump({ read: () => ({ owner: canonical, snapshot: canonical, requestedMilliseconds: requested,
      options: { site: currentSite } }), allowed: () => true, accepted: s => { commits.push(s); }, scheduler: tasks.scheduler });
    pump.step(); tasks.drain();
    const reached = pump.snapshot!; assert.equal(reached.clock.simulatedElapsedMilliseconds, requested);
    assert.deepEqual(reached.navigation.navigationAllocation, site.navigationAllocation);
    assert.ok(commits.some(s => s.navigation.residents.some(r => r.patrol && r.status === 'travelling')), 'declared lane travel occurs through actual source decisions');
    const ordinary = advanceVillagePopulationRuntime(canonical, { expectedGeneration: canonical.generation, worldKey: canonical.worldKey,
      contentRevision: canonical.contentRevision, observedAt: CREATED + requested, maxAdvanceMinutes: 245, site });
    assert.ok(ordinary.ok); assert.deepEqual(reached.life, ordinary.snapshot.life); assert.deepEqual(reached.navigation, ordinary.snapshot.navigation);
    assert.equal(serializeVillagePopulationRuntime(reached).ok, false); assert.deepEqual(serializeVillagePopulationRuntime(canonical), before);
    // A changed source cannot make the observer restart from its unbound
    // canonical input and silently adopt legacy navigation instead.
    requested += 8 * PACE; pump.step(); const boundBeforeSwitch = pump.snapshot!;
    currentSite = source(LEGACY); tasks.next();
    const held = pump.snapshot!, sample = sampleVillagePopulationRuntime(held, currentSite);
    assert.deepEqual(held.navigation.navigationAllocation, site.navigationAllocation);
    for (const previous of boundBeforeSwitch.navigation.residents) {
      const row = held.navigation.residents.find(r => r.residentId === previous.residentId)!;
      assert.deepEqual(row.anchorPosition, previous.anchorPosition); assert.deepEqual(row.route, previous.route); assert.equal(row.progressMetres, previous.progressMetres);
    }
    assert.ok(sample.residents.every(r => !r.presentable && r.position === null));
    assert.deepEqual(serializeVillagePopulationRuntime(canonical), before); pump.dispose();
  });

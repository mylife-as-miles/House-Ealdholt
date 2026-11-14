import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorldPreparationQueue} from './world-preparation-queue';
test('a frame runs synchronous jobs in live priority order and skips cancelled ones', async () => {
  const queue = createWorldPreparationQueue(() => {}), signal = new AbortController(), cancelled = new AbortController(), order: string[] = [];
  const a = queue.enqueue({bytes: 32, signal: signal.signal, priority: () => 20, work: () => order.push('far')});
  const b = queue.enqueue({bytes: 32, signal: signal.signal, priority: () => 1, work: () => order.push('near')});
  const c = queue.enqueue({bytes: 32, signal: cancelled.signal, priority: () => 0, work: () => order.push('obsolete')});
  const rejected = assert.rejects(c); cancelled.abort(); queue.step(); await b; await a; await rejected;
  assert.deepEqual(order, ['near', 'far']); assert.equal(queue.stats.cancelled, 1); assert.equal(queue.stats.completed, 2); queue.dispose();
});
test('a frame stops at its upload budget and at its CPU budget, and always runs its first job', async () => {
  const bytes = createWorldPreparationQueue(() => {}, 64, 100), signal = new AbortController().signal, ran: number[] = [];
  const jobs = [0, 1, 2].map(i => bytes.enqueue({bytes: 40, signal, priority: () => i, work: () => { ran.push(i); }}));
  bytes.step(); assert.deepEqual(ran, [0, 1], 'Two 40-byte uploads fit a 100-byte frame; the third waits.');
  bytes.step(); await Promise.all(jobs); assert.deepEqual(ran, [0, 1, 2]); bytes.dispose();
  let clock = 0; const time = createWorldPreparationQueue(() => {}, 64, 1 << 20, 4), slow: number[] = [];
  const slowJobs = [0, 1, 2].map(i => time.enqueue({bytes: 0, signal, priority: () => i, work: () => { slow.push(i); clock += 5; }}));
  time.step(() => clock); assert.deepEqual(slow, [0], 'A 5 ms job spends a 4 ms frame: the rest wait for the next.');
  time.step(() => clock); time.step(() => clock); await Promise.all(slowJobs); assert.deepEqual(slow, [0, 1, 2]); time.dispose();
});
test('an asynchronous job ends the frame and wakes the next one when it settles', async () => {
  let wakes = 0; const queue = createWorldPreparationQueue(() => { wakes++; }), signal = new AbortController().signal, ran: string[] = [];
  let release!: () => void;
  const first = queue.enqueue({bytes: 1, signal, priority: () => 0, work: () => { ran.push('sync'); }});
  const compile = queue.enqueue({bytes: 1, signal, priority: () => 1, work: () => { ran.push('compile'); return new Promise<void>(r => { release = r; }); }});
  const after = queue.enqueue({bytes: 1, signal, priority: () => 2, work: () => { ran.push('after'); }});
  queue.step(); assert.deepEqual(ran, ['sync', 'compile']); assert.equal(queue.running, true);
  const before = wakes; release(); await first; await compile; await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(wakes > before, 'Settling wakes the queue for the next frame.'); assert.equal(queue.running, false);
  queue.step(); await after; assert.deepEqual(ran, ['sync', 'compile', 'after']); queue.dispose();
});
test('pending compilation does not run another GPU job or block frame caller', async () => {
  const queue = createWorldPreparationQueue(() => {}), signal = new AbortController(); let release!: () => void, submitted = 0;
  const first = queue.enqueue({bytes: 1, signal: signal.signal, priority: () => 0, work: () => new Promise<void>(r => { release = r; })});
  const second = queue.enqueue({bytes: 1, signal: signal.signal, priority: () => 1, work: () => { submitted++; }});
  assert.equal(queue.running,false);queue.step();assert.equal(queue.running,true);queue.step(); assert.equal(submitted, 0); release(); await first;
  await new Promise<void>(resolve => queueMicrotask(resolve));assert.equal(queue.running,false);queue.step(); await second; assert.equal(submitted, 1); queue.dispose();
});
test('oversized uploads and disposal reject without publishing work', async () => {
  const queue = createWorldPreparationQueue(() => {}, 2, 100), signal = new AbortController();
  await assert.rejects(queue.enqueue({bytes: 101, signal: signal.signal, priority: () => 0, work: () => 1}));
  const p = queue.enqueue({bytes: 50, signal: signal.signal, priority: () => 0, work: () => 1}); const rejected = assert.rejects(p);
  queue.dispose(); await rejected; assert.equal(queue.stats.pending, 0);
});
test('view retirement waits for submitted work while queued uploads cancel immediately', async () => {
  const queue = createWorldPreparationQueue(() => {}), signal = new AbortController(); let release!: () => void, retired = false;
  const active = queue.enqueue({bytes: 1, signal: signal.signal, priority: () => 0, work: () => new Promise<void>(r => {release = r;})});
  const cancelled = assert.rejects(active); queue.step();
  const idle = queue.whenIdle().then(() => {retired = true;}); queue.dispose();assert.equal(queue.running,true,'Submitted work stays in flight after queue retirement.');
  await new Promise<void>(resolve => queueMicrotask(resolve)); assert.equal(retired, false);
  release(); await cancelled; await idle; assert.equal(retired, true); assert.equal(queue.pending, false);assert.equal(queue.running,false);
});
test('a full waiting queue holds requests until slots free instead of failing them (L-25)', async () => {
  let wakes = 0; const queue = createWorldPreparationQueue(() => { wakes++; }, 2, 100, 4, 'wait'), signal = new AbortController().signal, ran: number[] = [];
  const jobs = [0, 1, 2, 3, 4].map(i => queue.enqueue({bytes: 10, signal, priority: () => i, work: () => { ran.push(i); return i; }}));
  assert.equal(queue.stats.pending, 2); assert.equal(queue.stats.waiting, 3); assert.equal(queue.pending, true);
  let idle = false; const whenIdle = queue.whenIdle().then(() => { idle = true; });
  for (let frame = 0; frame < 6 && queue.pending; frame++) queue.step();
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4]); assert.deepEqual(ran, [0, 1, 2, 3, 4]);
  await whenIdle; assert.equal(idle, true); assert.equal(queue.stats.waiting, 0); assert.ok(wakes >= 5);
  // An aborted waiting request leaves at once; dispose rejects the rest.
  const blocker = new AbortController(), a = queue.enqueue({bytes: 0, signal, priority: () => 0, work: () => 'a'}), b = queue.enqueue({bytes: 0, signal, priority: () => 0, work: () => 'b'});
  const held = queue.enqueue({bytes: 0, signal: blocker.signal, priority: () => 0, work: () => 'held'}), last = queue.enqueue({bytes: 0, signal, priority: () => 0, work: () => 'last'});
  const aborted = assert.rejects(held); blocker.abort(); await aborted; assert.equal(queue.stats.waiting, 1);
  const disposed = Promise.all([a, b, last].map(job => assert.rejects(job, /disposed/)));
  queue.dispose(); await disposed; assert.equal(queue.stats.waiting, 0); assert.equal(queue.pending, false);
});
test('the default queue still refuses a request when full, for callers with their own retry', async () => {
  const queue = createWorldPreparationQueue(() => {}, 1), signal = new AbortController().signal;
  const first = queue.enqueue({bytes: 0, signal, priority: () => 0, work: () => 1});
  await assert.rejects(queue.enqueue({bytes: 0, signal, priority: () => 0, work: () => 2}), /bounded job\/upload budget/);
  queue.step(); assert.equal(await first, 1); queue.dispose();
});

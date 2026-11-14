import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_PGN_BYTES, SHOWCASE_STORAGE_KEY } from './catalog';
import { compactReplay, recordFromPGN } from './records';
import { executeReplayJob } from './replay-jobs';
import type { ReplayJob, ReplayJobResponse } from './replay-jobs';
import { ShowcaseSession } from './session';
import { serializeReplayArchive } from './storage';
import { runReplayJob } from './worker-client';
import type { ShowcaseRecord } from './types';

const record = () => recordFromPGN('1. e4 e5 2. Nf3 Nc6 *', { id: 'worker-test' });
class WorkerHarness {
  static instances: WorkerHarness[] = [];
  static mode: 'execute' | 'hold' | 'creation-error' | 'runtime-error' = 'execute';
  onmessage: ((event: { data: ReplayJobResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  constructor() { if (WorkerHarness.mode === 'creation-error') throw new Error('blocked'); WorkerHarness.instances.push(this); }
  postMessage(job: ReplayJob): void {
    if (WorkerHarness.mode === 'hold') return;
    if (WorkerHarness.mode === 'runtime-error') { queueMicrotask(() => this.onerror?.()); return; }
    void executeReplayJob(structuredClone(job)).then(value => this.emit({ kind: 'complete', value: structuredClone(value) }), error => this.emit({ kind: 'error', message: error.message }));
  }
  emit(data: ReplayJobResponse): void { this.onmessage?.({ data }); }
  terminate(): void { this.terminated = true; }
}
async function withWorker(run: () => Promise<void>): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { value: WorkerHarness, configurable: true, writable: true });
  WorkerHarness.mode = 'execute'; WorkerHarness.instances = [];
  try { await run(); } finally { if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor); else Reflect.deleteProperty(globalThis, 'Worker'); }
}

test('Worker results restore nested immutable boundaries and terminate on completion', async () => withWorker(async () => {
  const value = await runReplayJob<ShowcaseRecord>({ kind: 'open', entry: compactReplay(record()) });
  assert.equal(value.plies, 4); assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.frames));
  assert.ok(Object.isFrozen(value.frames[1])); assert.ok(Object.isFrozen(value.frames[1].pieces));
  assert.ok(Object.isFrozen(value.frames[1].pieces[0])); assert.ok(Object.isFrozen(value.frames[1].move));
  assert.equal(WorkerHarness.instances.length, 1); assert.equal(WorkerHarness.instances[0].terminated, true);
}));

test('opening/import Worker cancellation, suspension and disposal ignore late responses', async () => withWorker(async () => {
  const session = new ShowcaseSession({ storage: null }); await session.load(record()); const old = session.snapshot.record;
  WorkerHarness.mode = 'hold'; const pending = session.load(record()); const worker = WorkerHarness.instances.at(-1)!;
  assert.equal(session.snapshot.phase, 'opening'); session.setSuspended(true);
  assert.equal((await pending).ok, false); assert.equal(worker.terminated, true);
  worker.emit({ kind: 'complete', value: record() }); assert.equal(session.snapshot.record, old);
  session.setSuspended(false); const imported = session.import('1. d4 d5 *'); const importWorker = WorkerHarness.instances.at(-1)!;
  session.cancelOpening(); assert.equal((await imported).ok, false); assert.equal(importWorker.terminated, true);
  const disposed = session.load(record()); session.dispose(); assert.equal((await disposed).ok, false);
  assert.equal(WorkerHarness.instances.at(-1)!.terminated, true); assert.equal(session.snapshot.record, old);
}));

test('Worker creation/runtime failures retain current replay and original archive bytes', async () => withWorker(async () => {
  const session = new ShowcaseSession({ storage: null }); await session.load(record()); const old = session.snapshot.record;
  WorkerHarness.mode = 'runtime-error'; assert.equal((await session.load(record())).ok, false);
  assert.equal(session.snapshot.record, old); assert.match(session.snapshot.error, /unchanged/);
  assert.equal(WorkerHarness.instances.at(-1)!.terminated, true);
  const raw = serializeReplayArchive([compactReplay(record())]); let writes = 0;
  WorkerHarness.mode = 'creation-error';
  const archive = new ShowcaseSession({ storage: { getItem: key => key === SHOWCASE_STORAGE_KEY ? raw : null, setItem: () => { writes++; } } });
  assert.equal((await archive.ready).ok, false); assert.equal(writes, 0); assert.equal(archive.snapshot.storage, 'corrupt');
  assert.match(archive.snapshot.error, /could not start/); assert.equal(archive.snapshot.library.length, 0);
}));

test('main-thread envelope limits reject oversized data before creating a Worker', async () => withWorker(async () => {
  const entry = { ...compactReplay(record()), pgn: 'x'.repeat(MAX_PGN_BYTES + 1) };
  await assert.rejects(runReplayJob({ kind: 'open', entry }), /limit/);
  assert.equal(WorkerHarness.instances.length, 0);
}));

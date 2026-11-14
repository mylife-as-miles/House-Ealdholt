import assert from 'node:assert/strict';
import test from 'node:test';
import {createTerrainPreparationWorker} from './terrain-worker';
test('cancelled tile work holds its worker slot until acknowledgement, bounding rapid teleport backlog', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  let instance: FakeWorker, wakes = 0;
  class FakeWorker {
    onmessage: ((e: {data: any}) => void) | null = null; onerror = null; sent: any[] = []; stopped = false;
    constructor() {instance = this;}
    postMessage(data: any) {this.sent.push(data);}
    terminate() {this.stopped = true;}
  }
  Object.defineProperty(globalThis, 'Worker', {value: FakeWorker, configurable: true});
  try {
    const lifetime = new AbortController(), worker = createTerrainPreparationWorker(lifetime.signal, () => wakes++);
    const requests = [];
    for (let i = 0; i < 4; i++) {const abort = new AbortController(); const pending = worker.tile(0, 'tile', 0, abort.signal); requests.push(pending.catch(e => e)); abort.abort();}
    await Promise.all(requests); assert.equal(worker.pending, 4); assert.equal(instance!.sent.length, 4);
    await assert.rejects(worker.tile(0, 'tile', 0, new AbortController().signal), /backlog/);
    instance!.onmessage!({data: {id: 0}}); assert.equal(worker.pending, 3); assert.equal(wakes, 1);
    const next = worker.tile(0, 'tile', 0, new AbortController().signal); assert.equal(instance!.sent.length, 5);
    instance!.onmessage!({data: {id: 4, result: {proof: 'new-current-result'}}}); assert.deepEqual(await next, {proof: 'new-current-result'});
    lifetime.abort(); assert.equal(worker.pending, 0); assert.equal(instance!.stopped, true);
  } finally {if (previous) Object.defineProperty(globalThis, 'Worker', previous); else Reflect.deleteProperty(globalThis, 'Worker');}
});

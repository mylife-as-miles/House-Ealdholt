import assert from 'node:assert/strict';
import test from 'node:test';
import {createTerrainResidency} from './terrain-residency';
const demand = (level: 0 | 1 | 2, retainFine = true) => [{id: 'tile', level, distance: 0, priority: 0, retainFine}];
test('teleport cancellation rejects stale uploads and retains the previous valid terrain', () => {
  const pool = createTerrainResidency(1000); let disposed = 0;
  const coarse = pool.begin('tile', 2, 100)!; coarse.commit({bytes: 100, dispose() {disposed++;}});
  pool.demand(demand(0)); const fine = pool.begin('tile', 0, 300)!;
  assert.equal(pool.selected('tile')!.level, 2); pool.demand(demand(1)); assert.equal(fine.signal.aborted, true);
  assert.equal(fine.commit({bytes: 300, dispose() {disposed++;}}), false); assert.equal(disposed, 1);
  const middle = pool.begin('tile', 1, 200)!; middle.commit({bytes: 200, dispose() {disposed++;}});
  assert.equal(pool.selected('tile')!.level, 1); assert.equal(pool.stats.reservedBytes, 0); assert.equal(pool.stats.stale, 1);
  pool.dispose(); assert.equal(disposed, 3); assert.equal(pool.stats.bytes, 0);
});
test('memory pressure evicts unused fine pages while protecting selected and coarse pages', () => {
  const pool = createTerrainResidency(400); let evicted = 0;
  pool.begin('tile', 2, 100)!.commit({bytes: 100, dispose() {}});
  pool.demand(demand(0)); pool.begin('tile', 0, 200)!.commit({bytes: 200, dispose() {evicted++;}});
  assert.equal(pool.begin('other', 2, 200), null);
  pool.demand(demand(2, false)); assert.equal(evicted, 1); assert.equal(pool.selected('tile')!.level, 2);
  assert.ok(pool.begin('other', 2, 200)); pool.dispose(); assert.equal(pool.stats.pending, 0); assert.equal(pool.stats.reservedBytes, 0);
});
test('over-budget completion disposes only its owned page and leaves the old terrain active', () => {
  const pool = createTerrainResidency(1000); let disposed = 0;
  pool.begin('tile', 2, 100)!.commit({bytes: 100, dispose() {}}); pool.demand(demand(0));
  const request = pool.begin('tile', 0, 200)!;
  assert.throws(() => request.commit({bytes: 201, dispose() {disposed++;}}), /reserved/);
  assert.equal(disposed, 1); assert.equal(pool.selected('tile')!.level, 2); assert.equal(pool.stats.reservedBytes, 0); pool.dispose();
});

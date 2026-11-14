import assert from 'node:assert/strict';
import test from 'node:test';
import {createVegetationResourcePool} from './vegetation-resource-pool';
test('cells share one prepared source resource until all leases release', async () => {
  const pool = createVegetationResourcePool(100); let builds = 0, disposals = 0;
  const build = async () => {builds++; return {bytes: 60, dispose() {disposals++;}};};
  const first = pool.acquire('source:atlas:v1', 60, build), second = pool.acquire('source:atlas:v1', 60, build);
  assert.equal(await first.ready, await second.ready); assert.equal(builds, 1); assert.equal(pool.stats.bytes, 60);
  first.release(); pool.trim(); assert.equal(disposals, 0);
  second.release(); second.release(); pool.trim(); assert.equal(disposals, 1); pool.dispose(); assert.equal(disposals, 1);
});
test('a stale completion cannot replace a newly requested source identity', async () => {
  const pool = createVegetationResourcePool(100); let release!: (value: {bytes: number; dispose(): void}) => void, oldDisposals = 0;
  const old = pool.acquire('same-key', 40, () => new Promise(r => {release = r;}));
  await new Promise<void>(resolve => queueMicrotask(resolve)); const rejected = assert.rejects(old.ready, /retired/);
  old.release(); const current = pool.acquire('same-key', 40, async () => ({bytes: 30, dispose() {}}));
  const value = await current.ready; release({bytes: 40, dispose() {oldDisposals++;}}); await rejected;
  assert.equal(oldDisposals, 1); assert.equal(pool.stats.bytes, 30); assert.equal(await current.ready, value); current.release(); pool.dispose();
});
test('residency pressure evicts unused entries and rejects work that cannot fit', async () => {
  const pool = createVegetationResourcePool(100); let retired = 0;
  const first = pool.acquire('first', 60, async () => ({bytes: 60, dispose() {retired++;}})); await first.ready;
  assert.throws(() => pool.acquire('too-early', 50, async () => ({bytes: 50, dispose() {}})), /residency/);
  first.release(); const next = pool.acquire('next', 50, async () => ({bytes: 50, dispose() {}})); await next.ready;
  assert.equal(retired, 1); assert.equal(pool.stats.bytes, 50); next.release(); pool.dispose();
});

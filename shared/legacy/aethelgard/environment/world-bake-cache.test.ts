import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorldBakeCache, worldBakeKey, type WorldBakeRecord, type WorldBakeStore} from './world-bake-cache';
import {createIndexedWorldBakeStore} from './world-bake-idb';
import {encodeVoxelBake, decodeVoxelBake} from './voxel-bake';
import {buildStaticVoxelVolume, voxelOccupancyIdentity} from './voxel-volume';
import {buildVegetationAtlasMips} from './vegetation-atlas';
import {encodeVegetationBake, decodeVegetationBake} from './vegetation-bake';

function memoryStore() {
  const values = new Map<string, WorldBakeRecord>(); let closed = false;
  const store: WorldBakeStore = {
    async get(key) {if (closed) throw Error('closed'); return structuredClone(values.get(key));},
    async put(record, limits) {
      values.delete(record.key); values.set(record.key, structuredClone(record)); let evicted = 0;
      const size = () => [...values.values()].reduce((n, v) => n + v.bytes, 0);
      for (const [key] of [...values.entries()].sort((a, b) => a[1].used - b[1].used)) {
        if (size() <= limits.bytes && values.size <= limits.entries) break; values.delete(key); evicted++;
      }
      return {bytes: size(), entries: values.size, evicted};
    },
    async remove(key) {values.delete(key);}, async clear() {values.clear();}, close() {closed = true;},
  };
  return {store, values};
}
const blob = {metadata: '{}', data: new Uint8Array([1, 2, 3])};
test('cold/warm reads validate payloads, source/generator/backend identities invalidate independently, and static keys omit the sun', async () => {
  const source = {worldRegion: 'ealdholt', sourceSha256: 'a'.repeat(64), generatorVersion: 'terrain-v1', backend: 'webgl2', grid: {resolution: [4, 4, 4], min: [0, 0, 0], size: [8, 8, 8]} as const};
  const key = await worldBakeKey('voxel-static', voxelOccupancyIdentity(source)), {store, values} = memoryStore(), cache = createWorldBakeCache({store});
  assert.equal(await cache.get(key, () => true), null); assert.equal(await cache.put(key, blob), true);
  assert.deepEqual(await cache.get(key, () => true), blob); assert.equal(cache.stats.hits, 1);
  for (const change of [{sourceSha256: 'b'.repeat(64)}, {generatorVersion: 'terrain-v2'}, {backend: 'webgpu'}]) {
    const other = await worldBakeKey('voxel-static', voxelOccupancyIdentity({...source, ...change})); assert.notEqual(other, key); assert.equal(await cache.get(other, () => true), null);
  }
  for (const sun of [0, 1, 2, 100]) {const live = {...source, sunDirection: [sun, 1, 0]}; assert.equal(await worldBakeKey('voxel-static', voxelOccupancyIdentity(live)), key);}
  assert.equal(values.size, 1, 'sunlight updates do not create static entries');
  values.get(key)!.data[0] = 44; assert.equal(await cache.get(key, () => true), null); assert.equal(cache.stats.invalid, 1); assert.equal(values.size, 0);
});
test('storage absence/failure, oversize resources, cancellation and cache clearing cannot block world preparation', async () => {
  const key = await worldBakeKey('voxel-static', 'region'), unavailable = createWorldBakeCache({store: null});
  assert.equal(createIndexedWorldBakeStore(), null, 'Node has no browser database'); assert.equal(await unavailable.get(key, () => true), null); assert.equal(await unavailable.put(key, blob), false);
  assert.equal(unavailable.stats.io,null);assert.equal(unavailable.stats.lastFailureTiming,null,'No store means no I/O diagnostic ledger, timers or contexts.');
  let attempts = 0;
  const broken = createWorldBakeCache({store: {...memoryStore().store, async get() {attempts++; throw Error('disabled');}}});
  assert.equal(await broken.get(key, () => true), null); assert.equal(await broken.get(key, () => true), null);
  assert.equal(attempts, 1, 'one storage failure must not delay every following atlas with another failed open');
  assert.equal(await broken.put(key, blob), false); assert.match(broken.stats.warning, /disabled/);
  const quota = createWorldBakeCache({store: {...memoryStore().store, async put() {throw Error('quota');}}});
  assert.equal(await quota.put(key, blob), false); assert.match(quota.stats.warning, /quota/);
  const {store, values} = memoryStore(), cache = createWorldBakeCache({store, maximumBytes: 8}), cancel = new AbortController(); cancel.abort();
  assert.equal(await cache.put(key, blob, cancel.signal), false); assert.equal(await cache.put(key, {metadata: '{}', data: new Uint8Array(20)}), false);
  const old = cache.generation; await cache.clear(); assert.equal(await cache.put(key, blob, undefined, old), false); assert.equal(values.size, 0);
  assert.equal(await cache.put(key, blob), true); await cache.clear(); assert.equal(await cache.get(key, () => true), null);
  cache.close(); assert.equal(await cache.put(key, blob), false);
});
test('logical byte and entry budgets evict old bakes instead of growing without bound', async () => {
  const {store, values} = memoryStore(); let now = 0;
  const cache = createWorldBakeCache({store, maximumBytes: 10, maximumEntries: 2, now: () => ++now});
  const keys = await Promise.all(['a', 'b', 'c'].map(s => worldBakeKey('voxel-static', s)));
  for (const key of keys) await cache.put(key, blob);
  assert.deepEqual([...values.keys()], keys.slice(1)); assert.equal(cache.stats.evicted, 1); assert.equal(cache.stats.bytes, 10);
});
test('clearing or cancelling a pending lookup cannot publish stale bytes; a cleared queued bake cannot write later', async () => {
  const key = await worldBakeKey('voxel-static', 'pending'), memory = memoryStore(), writer = createWorldBakeCache({store: memory.store});
  await writer.put(key, blob); const saved = structuredClone(memory.values.get(key)!);
  let finish!: (value: WorldBakeRecord) => void;
  const cache = createWorldBakeCache({store: {...memory.store, get: () => new Promise(resolve => {finish = resolve;})}});
  const pending = cache.get(key, () => true); await cache.clear(); finish(saved);
  assert.equal(await pending, null); assert.equal(cache.stats.hits, 0);
  const cancelled = new AbortController(), pendingCancelled = cache.get(key, () => true, cancelled.signal); cancelled.abort(); finish(saved);
  assert.equal(await pendingCancelled, null);
  const queued = writer.put(key, blob); await writer.clear(); assert.equal(await queued, false); assert.equal(memory.values.size, 0);
});
test('obsolete storage failures cannot disable a cleared or cancelled generation', async () => {
  const key = await worldBakeKey('voxel-static', 'stale-failure'), memory = memoryStore();
  let rejectRead!: (cause: Error) => void;
  const cache = createWorldBakeCache({store: {...memory.store, get: () => new Promise((_, reject) => {rejectRead = reject;})}});
  const stale = cache.get(key, () => true); assert.equal(await cache.clear(), true); rejectRead(Error('old transaction'));
  assert.equal(await stale, null); assert.equal(cache.stats.available, true); assert.equal(cache.stats.warning, '');
  assert.equal(await cache.put(key, blob), true, 'New occupancy/atlas bakes remain writable after stale failure.');
  const cancellation = new AbortController(), cancelled = cache.get(key, () => true, cancellation.signal);
  cancellation.abort(); rejectRead(Error('cancelled transaction')); assert.equal(await cancelled, null);
  assert.equal(cache.stats.available, true); assert.equal(cache.stats.warning, '');
  cache.close();
});
test('a malformed derived resource is evicted without disabling other warm resources when its decoder throws', async () => {
  const memory = memoryStore(), cache = createWorldBakeCache({store: memory.store});
  const invalid = await worldBakeKey('voxel-static', 'malformed'), valid = await worldBakeKey('cloud-density', 'valid');
  assert.equal(await cache.put(invalid, blob), true); assert.equal(await cache.put(valid, blob), true);
  assert.equal(await cache.get(invalid, () => {throw Error('invalid resource layout');}), null);
  assert.equal(cache.stats.invalid, 1); assert.equal(memory.values.has(invalid), false);
  assert.equal(cache.stats.available, true); assert.equal(cache.stats.warning, '');
  assert.deepEqual(await cache.get(valid, () => true), blob); cache.close();
});
test('stale writes and clear failures cannot poison newer cache generations', async () => {
  const key = await worldBakeKey('voxel-static', 'pending-write'), memory = memoryStore();
  let rejectWrite!: (cause: Error) => void, entered!: () => void;
  const started = new Promise<void>(resolve => {entered = resolve;});
  const cache = createWorldBakeCache({store: {...memory.store, put: () => new Promise((_, reject) => {rejectWrite = reject; entered();})}});
  const pending = cache.put(key, blob); await started; assert.equal(await cache.clear(), true); rejectWrite(Error('old write'));
  assert.equal(await pending, false); assert.equal(cache.stats.available, true); assert.equal(cache.stats.warning, '');
  let rejectClear!: (cause: Error) => void, first = true;
  const clearing = createWorldBakeCache({store: {...memory.store, clear: () => first ? (first = false, new Promise((_, reject) => {rejectClear = reject;})) : Promise.resolve()}});
  const old = clearing.clear(); assert.equal(await clearing.clear(), true); rejectClear(Error('old clear'));
  assert.equal(await old, false); assert.equal(clearing.stats.available, true); assert.equal(clearing.stats.warning, '');
  cache.close(); clearing.close();
});
test('cache shutdown tolerates store-close failures and pending clears cannot reopen a disposed world', async () => {
  const memory = memoryStore(); let finish!: () => void;
  const cache = createWorldBakeCache({store: {...memory.store, clear: () => new Promise(resolve => {finish = resolve;}), close() {throw Error('store already closed');}}});
  const pending = cache.clear(); assert.doesNotThrow(() => cache.close()); finish();
  assert.equal(await pending, false); assert.equal(cache.stats.available, false);
  assert.doesNotThrow(() => cache.close());
  assert.equal(await cache.put(await worldBakeKey('voxel-static', 'disposed'), blob), false);
});
test('a static voxel restoration preserves exact channels and refuses wrong grids, truncated buffers and invalid metadata', () => {
  const grid = {resolution: [4, 4, 4], min: [0, 0, 0], size: [8, 8, 8]} as const;
  const volume = buildStaticVoxelVolume({grid, proxies: [{min: [1, 1, 1], max: [3, 6, 3], albedo: [.3, .5, .1], opacity: .9}]});
  const expected = {key: 'source-static-key', volume, sourceCounts: {terrain: 0, proxies: 1}}, saved = encodeVoxelBake(expected), restored = decodeVoxelBake(saved, expected.key, grid);
  assert.deepEqual(restored, expected); restored!.volume.transport[0] = 0; assert.notEqual(restored!.volume.transport.buffer, saved.data.buffer);
  assert.equal(decodeVoxelBake(saved, expected.key, {...grid, min: [1, 0, 0]}), null);
  assert.equal(decodeVoxelBake({...saved, data: saved.data.subarray(1)}, expected.key, grid), null);
  assert.equal(decodeVoxelBake({...saved, metadata: '{}'}, expected.key, grid), null);
});
test('relightable vegetation restoration retains every colour/normal mip and rejects incompatible layouts', () => {
  const tileSize = 32, views = 8, width = tileSize * 4, height = tileSize * 2;
  const colour = new Uint8Array(width * height * 4).fill(255), normal = new Uint8Array(colour.length).fill(128);
  for (let i = 3; i < normal.length; i += 4) normal[i] = 255;
  const atlas = buildVegetationAtlasMips({schema: 1, views, tileSize, columns: 4, rows: 2, centre: [0, 3, 0], extent: [4, 6], colour, normal});
  const encoded = encodeVegetationBake(atlas), restored = decodeVegetationBake(encoded, tileSize, views);
  assert.deepEqual(restored, atlas); assert.equal(decodeVegetationBake(encoded, 64, views), null);
  assert.equal(decodeVegetationBake({...encoded, data: encoded.data.subarray(1)}, tileSize, views), null);
  const meta = JSON.parse(encoded.metadata); meta.mips[1].width++;
  assert.equal(decodeVegetationBake({...encoded, metadata: JSON.stringify(meta)}, tileSize, views), null);
});

test('roaming lighting volumes replace older volumes instead of pushing out vegetation atlases (L-18)', async () => {
  const {planWorldBakeEviction} = await import('./world-bake-cache');
  const MiB = 1024 * 1024, limits = {bytes: 64 * MiB, entries: 128, kindBytes: 32 * MiB, kindEntries: 64};
  const key = (kind: string, n: number) => `v1:${kind}:${n.toString(16).padStart(64, '0')}`;
  type Row = {key: string; bytes: number; used: number};
  let rows: Row[] = [], clock = 0;
  const write = (record: {key: string; bytes: number}) => {
    const plan = planWorldBakeEviction(rows.filter(row => row.key !== record.key), record, limits); assert.ok(plan, 'the record fits');
    rows = rows.filter(row => row.key !== record.key && !plan.evict.includes(row.key)); rows.push({...record, used: ++clock});
    assert.ok(plan.bytes <= limits.bytes && plan.entries <= limits.entries);
  };
  // Twenty-five 1 MiB regional atlases, captured once.
  for (let i = 0; i < 25; i++) write({key: key('vegetation-atlas', i), bytes: MiB});
  // A long High roam stores a 1 MiB lighting volume per grid cell.
  for (let i = 0; i < 400; i++) write({key: key('voxel-volume', i), bytes: MiB});
  assert.equal(rows.filter(row => row.key.includes(':vegetation-atlas:')).length, 25, 'every atlas survives the roam');
  assert.ok(rows.filter(row => row.key.includes(':voxel-volume:')).length <= 32, 'volumes stay inside their share');
  // Without shares the same roam evicts the atlases: the old single LRU.
  rows = []; clock = 0;
  const shared = {bytes: limits.bytes, entries: limits.entries};
  for (let i = 0; i < 25; i++) {const record = {key: key('vegetation-atlas', i), bytes: MiB}, plan = planWorldBakeEviction(rows, record, shared)!; rows = rows.filter(row => !plan.evict.includes(row.key)); rows.push({...record, used: ++clock});}
  for (let i = 0; i < 400; i++) {const record = {key: key('voxel-volume', i), bytes: MiB}, plan = planWorldBakeEviction(rows, record, shared)!; rows = rows.filter(row => !plan.evict.includes(row.key)); rows.push({...record, used: ++clock});}
  assert.equal(rows.filter(row => row.key.includes(':vegetation-atlas:')).length, 0);
  // A record larger than the whole budget cannot be planned.
  assert.equal(planWorldBakeEviction([], {key: key('voxel-volume', 1), bytes: 65 * MiB}, limits), null);
});

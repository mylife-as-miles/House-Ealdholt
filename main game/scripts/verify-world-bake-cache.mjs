// Actual IndexedDB and production voxel-worker regression; no demo world,
// staged save, GPU screenshot or frame-rate claim.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const host = new URL(process.env.CROWNFALL_TEST_URL ?? 'http://127.0.0.1:4191');
assert.ok(['localhost', '127.0.0.1'].includes(host.hostname));
const sharedRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../shared/legacy/aethelgard/environment');
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--disable-dev-shm-usage']});
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/__world-cache-api.html', r => r.fulfill({contentType: 'text/html', body: '<!doctype html><title>Environment cache regression</title>'}));
  await page.goto(new URL('/__world-cache-api.html', host).href);
  const result = await page.evaluate(async sharedRoot => {
    const {createWorldBakeCache, worldBakeKey} = await import(sharedRoot + '/world-bake-cache.ts');
    const {createIndexedWorldBakeStore} = await import(sharedRoot + '/world-bake-idb.ts');
    const {createVoxelPreparationWorker} = await import('/src/legacy/aethelgard/voxel-worker.ts');
    const check = (ok, message) => {if (!ok) throw Error(message);};
    const delay = () => new Promise(r => setTimeout(r, 5));
    const cache = createWorldBakeCache({store: createIndexedWorldBakeStore(), maximumBytes: 10, maximumEntries: 2});
    check(await cache.clear(), 'real IDB clear failed');
    const keys = await Promise.all(['first', 'second', 'third'].map(s => worldBakeKey('verification', s)));
    const blob = {metadata: '{}', data: new Uint8Array([1, 2, 3])};
    check(await cache.get(keys[0], () => true) === null, 'cold cache unexpectedly hit');
    for (const key of keys.slice(0, 2)) {check(await cache.put(key, blob), 'real IDB write failed'); await delay();}
    check((await cache.get(keys[0], () => true))?.data[1] === 2, 'real IDB read failed'); await delay();
    check(await cache.put(keys[2], blob), 'LRU write failed');
    check(await cache.get(keys[1], () => true) === null, 'LRU did not evict the older untouched entry');
    check((await cache.get(keys[0], () => true))?.data[0] === 1, 'LRU evicted the recently touched entry');
    check(cache.stats.evicted === 1 && cache.stats.bytes === 10 && cache.stats.entries === 2, 'persistent budgets do not match');
    // Change a stored byte without changing the checksum; the production cache
    // must discard/rebuild it instead of uploading corrupt lighting channels.
    const db = await new Promise((resolve, reject) => {const r = indexedDB.open('CrownfallWorldBakes', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);});
    await new Promise((resolve, reject) => {const tx = db.transaction('payloads', 'readwrite'); tx.objectStore('payloads').put({metadata: '{}', data: new Uint8Array([9, 2, 3])}, keys[0]); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);});
    check(await cache.get(keys[0], () => true) === null && cache.stats.invalid === 1, 'corrupt IDB content was accepted');
    db.close(); const lru = {...cache.stats}; await cache.clear(); cache.close();

    const source = {worldRegion: 'ealdholt-cache-regression', sourceSha256: 'a'.repeat(64), generatorVersion: 'verification-v1', backend: 'webgl2',
      terrain: [{positions: new Float32Array([-8, 0, -8, 8, 0, -8, -8, 0, 8, 8, 0, 8]), indices: new Uint32Array([0, 2, 1, 1, 2, 3]), bounds: {min: [-8, 0, -8], max: [8, 0, 8]}}],
      proxies: [{min: [1, 0, 1], max: [3, 5, 3], albedo: [.2, .4, .1], opacity: .9}]};
    const grid = {resolution: [4, 4, 4], min: [0, -2, 0], size: [8, 8, 8]}, workers = [];
    async function start(input) {const controller = new AbortController(), worker = createVoxelPreparationWorker(controller.signal, () => {}); workers.push({worker, controller}); await worker.init(structuredClone(input)); return worker;}
    try {
      const first = await start(source), cold = await first.volume(grid, new AbortController().signal);
      check(!cold.cacheHit && cold.cache.writes === 1, 'cold production worker did not save static transport');
      first.dispose();
      const second = await start(source), warm = await second.volume(grid, new AbortController().signal);
      check(warm.cacheHit && warm.cache.hits === 1, 'new worker did not restore IndexedDB transport');
      for (const channel of ['albedoOpacity', 'transport']) check(cold.volume[channel].every((v, i) => v === warm.volume[channel][i]), 'warm channels differ: ' + channel);
      check(cold.key === warm.key, 'same source/grid changed static identity');
      const changed = structuredClone(source); changed.proxies[0].opacity = .7;
      const third = await start(changed), invalidated = await third.volume(grid, new AbortController().signal);
      check(!invalidated.cacheHit && invalidated.key !== cold.key, 'changed source content did not invalidate occupancy');
      const changedGenerator = await start({...source, generatorVersion: 'verification-v2'}), versioned = await changedGenerator.volume(grid, new AbortController().signal);
      check(!versioned.cacheHit && versioned.key !== cold.key, 'changed generator did not invalidate occupancy');
      check((await second.clearCache()).cleared, 'development clear command failed');
      const afterClear = await second.volume(grid, new AbortController().signal);
      check(!afterClear.cacheHit, 'cleared occupancy unexpectedly restored');
      await second.clearCache();
      return {lru, workerCold: {cacheHit: cold.cacheHit, ...cold.cache}, workerWarm: {cacheHit: warm.cacheHit, ...warm.cache}, sourceInvalidation: !invalidated.cacheHit,
        generatorInvalidation: !versioned.cacheHit, exactChannels: true, developmentClear: true};
    } finally {for (const {worker, controller} of workers) {controller.abort(); worker.dispose();}}
  }, '/@fs/' + sharedRoot);
  assert.equal(errors.length, 0); console.log(JSON.stringify({passed: true, result, errors, scope: 'Actual browser IndexedDB and production worker; not full-scene, GPU-performance or Quest acceptance.'}));
} finally {await browser.close();}

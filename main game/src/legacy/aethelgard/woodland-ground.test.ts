import assert from 'node:assert/strict';
import test from 'node:test';
import { Texture, TextureLoader, SRGBColorSpace, NoColorSpace, RepeatWrapping } from 'three';
import { loadEaldholtValleyGroundSet, loadEaldholtWoodlandGroundLayer } from './woodland-ground';
import { EALDHOLT_WOODLAND_GROUND_CACHE_KEY, EALDHOLT_WOODLAND_GROUND_LAYERS, ealdholtWoodlandGroundMapSize, type EaldholtWoodlandGroundLayer, type EaldholtWoodlandGroundProfile } from '../../../../shared/legacy/aethelgard/environment/woodland-ground';

function manifest(layer: EaldholtWoodlandGroundLayer = 'meadow', overrides: Record<string, unknown> = {}, profile: EaldholtWoodlandGroundProfile = 'quest') {
  const spec = EALDHOLT_WOODLAND_GROUND_LAYERS[layer];
  return { version: 2, set: 'ealdholt-woodland-ground', layer, assetId: spec.assetId, sourceUrl: spec.sourceUrl, licence: 'CC0-1.0', tileMetres: spec.tileMetres, laasWeight: spec.laasWeight, modified: spec.modified, ...overrides,
    profiles: { [profile]: { meanLuminance: .248, files: Object.fromEntries(spec.roles.map(role => { const size = ealdholtWoodlandGroundMapSize(profile, role); return [role, { file: `${spec.prefix}-${profile}-${role}-${size}.webp`, size, bytes: 100, sha256: 'a'.repeat(64) }]; })) } } };
}
function leafyManifest(profile: EaldholtWoodlandGroundProfile = 'quest') {
  const size = profile === 'desktop' ? 1024 : 512;
  return { version: 1, assetId: 'leafy_grass', licence: 'CC0-1.0', sourceUrl: 'https://polyhaven.com/a/leafy_grass', tileMetres: 2,
    profiles: { [profile]: { size, meanLuminance: .24, files: Object.fromEntries(['albedo', 'normal', 'orm'].map(role => [role, { file: `grass-${profile}-${role}-${size}.webp`, size, bytes: 50, sha256: 'b'.repeat(64) }])) } } };
}
function texture(dispose: () => void, size: number) { const value = new Texture({ width: size, height: size }); value.addEventListener('dispose', dispose); return value; }
function meadowFallbackManifest() { return { ...leafyManifest(), assetId: 'Grass001', sourceUrl: 'https://ambientcg.com/a/Grass001', tileMetres: 1.4 }; }
const sizeOf = (url: string) => Number(/-(\d+)\.webp$/.exec(url)![1]);
/** fetch mock serving each folder's manifest; `fail` names folders that answer 404. */
function folders(fail: readonly string[] = []) {
  return async (url: string) => {
    const folder = /\/([^/]+)\/manifest\.json$/.exec(String(url))?.[1] ?? '';
    if (fail.includes(folder)) return new Response('missing', { status: 404 });
    if (folder === 'grass-leafy-v1') return new Response(JSON.stringify(leafyManifest()));
    if (folder === 'grass-meadow-v1') return new Response(JSON.stringify(meadowFallbackManifest()));
    const layer = (Object.keys(EALDHOLT_WOODLAND_GROUND_LAYERS) as EaldholtWoodlandGroundLayer[]).find(name => EALDHOLT_WOODLAND_GROUND_LAYERS[name].folder === folder)!;
    return new Response(JSON.stringify(manifest(layer)));
  };
}

test('a layer load requests only its own folder and shipped roles, configures owned maps and records source, cache key, tile and target', async t => {
  let releases = 0; const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => { urls.push(url); return new Response(JSON.stringify(manifest('meadow'))); });
  t.mock.method(TextureLoader.prototype, 'loadAsync', async (url: string) => { urls.push(url); return texture(() => releases++, sizeOf(url)); });
  const owner = await loadEaldholtWoodlandGroundLayer('/sub/assets/textures', 'meadow', 'quest');
  assert.deepEqual(urls, ['/sub/assets/textures/ground-meadow-v2/manifest.json', '/sub/assets/textures/ground-meadow-v2/meadow-quest-albedo-512.webp', '/sub/assets/textures/ground-meadow-v2/meadow-quest-normal-256.webp']);
  assert.equal(owner.textureCount, 2); assert.equal(owner.downloadBytes, 200); assert.equal(owner.surfaceMaps.orm, undefined);
  assert.equal(owner.surfaceMaps.sourceAssetId, 'forrest_ground_01'); assert.equal(owner.surfaceMaps.source, 'Poly Haven forrest_ground_01'); assert.equal(owner.surfaceMaps.cacheKey, EALDHOLT_WOODLAND_GROUND_CACHE_KEY + ':meadow');
  assert.equal(owner.surfaceMaps.tileMetres, 2); assert.equal(owner.surfaceMaps.meanLuminance, .248); assert.equal(owner.surfaceMaps.targetLuminance, .07);
  assert.equal(owner.surfaceMaps.albedo.colorSpace, SRGBColorSpace); assert.equal(owner.surfaceMaps.normal!.colorSpace, NoColorSpace);
  for (const value of [owner.surfaceMaps.albedo, owner.surfaceMaps.normal!]) { assert.equal(value.flipY, false); assert.equal(value.wrapS, RepeatWrapping); assert.equal(value.generateMipmaps, true); }
  owner.dispose(); owner.dispose(); assert.equal(releases, 2);
});

test('a foreign manifest, held-back layer, failed image, wrong size or abort fails closed and releases every completed texture', async t => {
  let releases = 0, requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response(JSON.stringify(manifest('meadow', { assetId: 'leafy_grass' }))); });
  await assert.rejects(loadEaldholtWoodlandGroundLayer('/t', 'meadow', 'quest'), /source contract/);
  await assert.rejects(loadEaldholtWoodlandGroundLayer('/t', 'path', 'quest'), /uncommitted/);
  const pre = new AbortController(); pre.abort(); const before = requests;
  await assert.rejects(loadEaldholtWoodlandGroundLayer('/t', 'bank', 'quest', pre.signal)); assert.equal(requests, before);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(manifest('bank'))));
  t.mock.method(TextureLoader.prototype, 'loadAsync', (url: string) => url.includes('normal') ? Promise.reject(Error('decode failure')) : Promise.resolve(texture(() => releases++, sizeOf(url))));
  await assert.rejects(loadEaldholtWoodlandGroundLayer('/t', 'bank', 'quest'), /decode failure/); assert.equal(releases, 2);
  t.mock.method(TextureLoader.prototype, 'loadAsync', async () => texture(() => releases++, 1024));
  await assert.rejects(loadEaldholtWoodlandGroundLayer('/t', 'bank', 'quest'), /dimensions/); assert.equal(releases, 5);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(manifest('woodland'))));
  t.mock.method(TextureLoader.prototype, 'loadAsync', async (url: string) => texture(() => releases++, sizeOf(url)));
  const floor = await loadEaldholtWoodlandGroundLayer('/t', 'woodland', 'quest'); assert.equal(floor.textureCount, 1); assert.equal(floor.surfaceMaps.normal, undefined); assert.equal(floor.surfaceMaps.targetLuminance, .055);
  floor.dispose(); assert.equal(releases, 6);
});

test('ground set: meadow and bank load as one unit with the optional floor; every request starts at once and one owner releases all', async t => {
  let live = 0, peak = 0; const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', folders());
  t.mock.method(TextureLoader.prototype, 'loadAsync', async (url: string) => { urls.push(url); live++; peak = Math.max(peak, live); await new Promise(resolve => setTimeout(resolve, 1)); return texture(() => live--, sizeOf(url)); });
  const set = await loadEaldholtValleyGroundSet('/t/', 'quest', { woodlandFloor: true });
  assert.equal(set.mode, 'woodland'); assert.deepEqual(set.layers, { meadow: 'ready', bank: 'ready', woodland: 'ready', leafy: 'skipped' }); assert.deepEqual(set.reasons, []);
  assert.equal(set.earth?.source, 'Poly Haven brown_mud_rocks_01'); assert.equal((set.grass as { source?: string }).source, 'Poly Haven forrest_ground_01'); assert.equal(set.forest?.source, 'Poly Haven forest_leaves_03');
  assert.equal(set.textureCount, 6); assert.equal(peak, 6, 'meadow, bank and floor maps are requested in one parallel batch'); assert.ok(!urls.some(url => url.includes('leafy')));
  set.dispose(); set.dispose(); assert.equal(live, 0);
  const noFloor = await loadEaldholtValleyGroundSet('/t/', 'quest'); assert.equal(noFloor.forest, undefined); assert.equal(noFloor.layers.woodland, 'skipped'); noFloor.dispose(); assert.equal(live, 0);
});

test('ground set: a failed meadow (or bank) releases the other woodland layers, including the floor, and falls back to leafy_grass with the borrowed earth', async t => {
  for (const failed of ['ground-meadow-v2', 'ground-bank-v2']) {
    let live = 0; const urls: string[] = [];
    t.mock.method(globalThis, 'fetch', folders([failed]));
    t.mock.method(TextureLoader.prototype, 'loadAsync', async (url: string) => { urls.push(url); live++; return texture(() => live--, sizeOf(url)); });
    const set = await loadEaldholtValleyGroundSet('/t', 'quest', { woodlandFloor: true });
    assert.equal(set.mode, 'fallback'); assert.equal(set.earth, undefined, 'the valley keeps the village stony_dirt_path earth'); assert.equal(set.forest, undefined);
    const other = failed === 'ground-meadow-v2' ? 'bank' : 'meadow';
    assert.equal(set.layers[failed === 'ground-meadow-v2' ? 'meadow' : 'bank'], 'failed'); assert.equal(set.layers[other], 'released'); assert.equal(set.layers.woodland, 'released'); assert.equal(set.layers.leafy, 'ready');
    assert.equal(set.grass?.meanLuminance, .24); assert.equal(set.textureCount, 3); assert.equal(live, 3, 'only the three leafy maps stay alive');
    assert.ok(urls.some(url => url === '/t/grass-leafy-v1/grass-quest-albedo-512.webp')); assert.match(set.reasons.join(), /Woodland ground manifest unavailable/);
    set.dispose(); assert.equal(live, 0); t.mock.restoreAll();
  }
});

test('ground set: total failure resolves with no grass maps; an abort releases everything and rejects', async t => {
  let live = 0;
  t.mock.method(globalThis, 'fetch', folders(['ground-meadow-v2', 'grass-leafy-v1']));
  t.mock.method(TextureLoader.prototype, 'loadAsync', async (url: string) => { live++; return texture(() => live--, sizeOf(url)); });
  const none = await loadEaldholtValleyGroundSet('/t', 'quest'); assert.equal(none.mode, 'fallback'); assert.equal(none.grass, undefined); assert.equal(none.layers.leafy, 'failed'); assert.equal(live, 0); none.dispose();
  t.mock.restoreAll();
  const abort = new AbortController(); let started = 0;
  t.mock.method(globalThis, 'fetch', folders());
  t.mock.method(TextureLoader.prototype, 'loadAsync', async (url: string) => { live++; if (++started === 3) abort.abort(); return texture(() => live--, sizeOf(url)); });
  await assert.rejects(loadEaldholtValleyGroundSet('/t', 'quest', { woodlandFloor: true, signal: abort.signal })); assert.equal(live, 0);
});

test('an explicit meadow fallback preserves its canonical folder and source identity while releasing the failed woodland unit', async t => {
  let live = 0; const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', folders(['ground-bank-v2']));
  t.mock.method(TextureLoader.prototype, 'loadAsync', async (url: string) => { urls.push(url); live++; return texture(() => live--, sizeOf(url)); });
  const set = await loadEaldholtValleyGroundSet('/sub/textures', 'quest', { woodlandFloor: true, fallbackDirectory: 'grass-meadow-v1' });
  assert.equal(set.mode, 'fallback'); assert.equal(set.earth, undefined); assert.equal(set.forest, undefined);
  assert.deepEqual(set.layers, { meadow: 'released', bank: 'failed', woodland: 'released', leafy: 'ready' });
  assert.equal(set.grass?.sourceAssetId, 'Grass001'); assert.equal(set.grass?.tileMetres, 1.4); assert.equal(live, 3);
  assert.ok(urls.includes('/sub/textures/grass-meadow-v1/grass-quest-albedo-512.webp')); assert.ok(!urls.some(url => url.includes('grass-leafy-v1')));
  set.dispose(); set.dispose(); assert.equal(live, 0);
});

test('selected meadow fallback failure and late abort release every owned texture, including completed woodland layers', async t => {
  for (const abortFallback of [false, true]) {
    let live = 0; const pending: (() => void)[] = []; let requested!: () => void;
    const fallbackRequested = new Promise<void>(resolve => { requested = resolve; });
    const abort = new AbortController();
    t.mock.method(globalThis, 'fetch', folders(['ground-bank-v2']));
    t.mock.method(TextureLoader.prototype, 'loadAsync', (url: string) => {
      if (!url.includes('grass-meadow-v1')) { live++; return Promise.resolve(texture(() => live--, sizeOf(url))); }
      if (!abortFallback && url.includes('normal')) return Promise.reject(Error('fallback decode failure'));
      if (!abortFallback) { live++; return Promise.resolve(texture(() => live--, sizeOf(url))); }
      return new Promise<Texture>(resolve => { pending.push(() => { live++; resolve(texture(() => live--, sizeOf(url))); }); if (pending.length === 3) requested(); });
    });
    const loading = loadEaldholtValleyGroundSet('/t', 'quest', { woodlandFloor: true, fallbackDirectory: 'grass-meadow-v1', signal: abort.signal });
    if (abortFallback) {
      const rejected = assert.rejects(loading, /abort/i); await fallbackRequested;
      assert.equal(live, 0, 'The completed woodland owners are released before fallback loading');
      abort.abort(); pending.forEach(finish => finish()); await rejected; assert.equal(live, 0, 'Late fallback images cannot revive an aborted owner');
    } else {
      const set = await loading; assert.equal(set.mode, 'fallback'); assert.equal(set.grass, undefined); assert.equal(set.layers.leafy, 'failed');
      assert.match(set.reasons.join(), /fallback decode failure/); assert.equal(live, 0); set.dispose(); set.dispose(); assert.equal(live, 0);
    }
    t.mock.restoreAll();
  }
});

test('the fallback directory is a closed canonical selection, refused before network work', async t => {
  let requests = 0; t.mock.method(globalThis, 'fetch', async () => { requests++; throw Error('unexpected request'); });
  // @ts-expect-error Only the two canonical fallback directories are accepted.
  await assert.rejects(loadEaldholtValleyGroundSet('/t', 'quest', { fallbackDirectory: '../unapproved' }), /fallback directory/);
  assert.equal(requests, 0);
});

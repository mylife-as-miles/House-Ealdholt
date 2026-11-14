import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEaldholtPondProbeIdentity, readEaldholtPondProbeConfig } from '../aethelgard/environment/pond-probe-config';
import { EALDHOLT_POND_PROBE } from '../aethelgard/environment/pond-probe';

const entry = (profile = 'quest') => ({ modelUrl: `http://127.0.0.1:8068/village-${profile}.glb`,
  modelSha256: 'a'.repeat(64), lightingVersion: 'fixture-r1',
  hdrUrl: `http://127.0.0.1:8068/pond-${profile}.hdr`, metadataUrl: `http://127.0.0.1:8068/pond-${profile}.metadata.json` });
const metadata = (profile: 'quest' | 'desktop' = 'quest') => ({ version: 1, profile,
  modelSha256: 'a'.repeat(64), lightingVersion: 'fixture-r1', sourceAxes: true,
  neutralFillAlreadyBaked: true, realtime: false, format: 'radiance-rgbe', ...EALDHOLT_POND_PROBE[profile], sourcePosition: [1, 2, 3] });

test('private probe profile is opt-in, deterministic and tied to the actual immutable source URL', () => {
  for (const raw of [undefined, null, '', '{}', JSON.stringify({ desktop: entry('desktop') })]) assert.equal(readEaldholtPondProbeConfig(raw, 'quest'), null);
  const raw = JSON.stringify({ quest: entry(), desktop: entry('desktop') });
  const config = readEaldholtPondProbeConfig(raw, 'quest', entry().modelUrl);
  assert.ok(config); assert.equal(config.profile, 'quest'); assert.equal(config.modelSha256, 'a'.repeat(64)); assert.ok(Object.isFrozen(config));
  assert.deepEqual(config, readEaldholtPondProbeConfig(raw, 'quest', entry().modelUrl));
  assert.throws(() => readEaldholtPondProbeConfig(raw, 'quest', entry('desktop').modelUrl), /selected village model URL/);
  for (const bad of ['{', '[]', 'null', '7']) assert.throws(() => readEaldholtPondProbeConfig(bad, 'quest'), /configuration/);
  for (const mutation of [{ hdrUrl: 'https://example.test/private.hdr' }, { metadataUrl: 'http://127.0.0.1:8068/nope.hdr' },
    { modelUrl: 'http://user:secret@127.0.0.1:8068/village.glb' }, { hdrUrl: 'http://127.0.0.1:8068/pond.hdr?token=private' },
    { modelSha256: 'not-a-hash' }, { lightingVersion: '' }, { modelUrl: 'http://127.0.0.1:8068/not-model.json' }]) {
    assert.throws(() => readEaldholtPondProbeConfig(JSON.stringify({ quest: { ...entry(), ...mutation } }), 'quest'));
  }
});

test('metadata load validates identity and radiance profile, copying no unrelated source data', async () => {
  for (const profile of ['quest', 'desktop'] as const) {
    const config = readEaldholtPondProbeConfig(JSON.stringify({ [profile]: entry(profile) }), profile)!;
    let calls = 0;
    const controller = new AbortController();
    const fetcher = (async (url, options) => {
      calls++; assert.equal(url, config.metadataUrl); assert.equal(options?.signal, controller.signal);
      assert.equal(options?.redirect, 'error'); assert.equal(options?.cache, 'no-store');
      return Response.json(metadata(profile));
    }) as typeof fetch;
    const identity = await loadEaldholtPondProbeIdentity(config, controller.signal, fetcher);
    assert.equal(identity.profile, profile); assert.equal(identity.modelSha256, config.modelSha256);
    assert.equal('sourcePosition' in identity, false); assert.equal('width' in identity, false); assert.ok(Object.isFrozen(identity)); assert.equal(calls, 1);
    for (const invalid of [{ modelSha256: 'b'.repeat(64) }, { profile: profile === 'quest' ? 'desktop' : 'quest' },
      { lightingVersion: 'other' }, { format: 'png' }, { width: 1 }, { neutralFillAlreadyBaked: false }, { realtime: true }, { modelSha256: undefined }]) {
      await assert.rejects(loadEaldholtPondProbeIdentity(config, controller.signal,
        (async () => Response.json({ ...metadata(profile), ...invalid })) as typeof fetch));
    }
  }
});

test('configured missing metadata and cancellation reject instead of falling back to claimed reflections', async () => {
  const config = readEaldholtPondProbeConfig(JSON.stringify({ quest: entry() }), 'quest')!;
  await assert.rejects(loadEaldholtPondProbeIdentity(config, new AbortController().signal,
    (async () => new Response('', { status: 404 })) as typeof fetch), /failed \(404\)/);
  const pre = new AbortController(); pre.abort(); let calls = 0;
  await assert.rejects(loadEaldholtPondProbeIdentity(config, pre.signal, (async () => { calls++; return Response.json(metadata()); }) as typeof fetch));
  assert.equal(calls, 0);
  const late = new AbortController();
  await assert.rejects(loadEaldholtPondProbeIdentity(config, late.signal, (async () => { late.abort(); return Response.json(metadata()); }) as typeof fetch));
});

test('a recorded valley art version is copied for staleness warnings, never checked as identity, and malformed values are dropped', async () => {
  const config = readEaldholtPondProbeConfig(JSON.stringify({ quest: entry() }), 'quest')!, signal = new AbortController().signal;
  const load = (extra: Record<string, unknown>) => loadEaldholtPondProbeIdentity(config, signal, (async () => Response.json({ ...metadata(), ...extra })) as typeof fetch);
  assert.equal((await load({ valleyArtVersion: 'grounded-bank-earth-grass-rock-v3' })).valleyArtVersion, 'grounded-bank-earth-grass-rock-v3');
  assert.equal((await load({ valleyArtVersion: 'grounded-bank-earth-grass-rock-v2' })).valleyArtVersion, 'grounded-bank-earth-grass-rock-v2');
  for (const malformed of [undefined, 3, 'x'.repeat(161), 'bad\u0000value']) assert.equal('valleyArtVersion' in (await load({ valleyArtVersion: malformed })), false);
});

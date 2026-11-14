import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readEaldholtResidentPreviewInput, verifyResidentPreviewGlb, loadVerifiedResidentPreviewGlb,
  RESIDENT_PREVIEW_ACTOR_MAX_BYTES, RESIDENT_PREVIEW_WORLD_MAX_BYTES, type ResidentPreviewGlb } from './resident-preview-input';

const worldUrl = 'http://127.0.0.1:8123/private/desktop.glb';
const digest = (bytes: ArrayBuffer) => createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
function config() {
  const profile = (file: string) => ({ source: { file, sha256: '1'.repeat(64), bytes: 100 }, position: [0, 1, 0],
    yawRadians: 0, idleEnvelope: { min: [-.4, .9, -.4], max: [.4, 2.9, .4] }, proofSha256: '3'.repeat(64) });
  return { schemaVersion: 1, usage: 'standing-visual-only', revision: 'synthetic-standing-v1',
    actor: { file: 'resident.glb', sha256: '2'.repeat(64), bytes: 100 }, idleClip: 'Synthetic neutral',
    profiles: { desktop: profile('desktop.glb'), quest: profile('quest.glb') } };
}
function glb(document: unknown = { asset: { version: '2.0' }, buffers: [{ byteLength: 4 }], images: [] }): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(document)), length = Math.ceil(json.length / 4) * 4;
  const bytes = new ArrayBuffer(20 + length + 8 + 4), out = new Uint8Array(bytes), view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true); out.fill(32, 20, 20 + length); out.set(json, 20);
  view.setUint32(20 + length, 4, true); view.setUint32(24 + length, 0x004e4942, true); return bytes;
}
function identity(bytes: ArrayBuffer): ResidentPreviewGlb {
  return { file: 'resident.glb', url: 'http://127.0.0.1:8123/private/resident.glb', bytes: bytes.byteLength, sha256: digest(bytes) };
}
const signal = () => new AbortController().signal;

test('unset input is disabled; valid private input is profile-bound, owned and deeply frozen', () => {
  assert.equal(readEaldholtResidentPreviewInput(undefined, 'desktop', worldUrl), null);
  assert.equal(readEaldholtResidentPreviewInput('', 'quest', worldUrl), null);
  const data = config(), before = JSON.stringify(data), result = readEaldholtResidentPreviewInput(before, 'desktop', worldUrl)!;
  assert.equal(result.source.url, worldUrl); assert.equal(result.actor.url, 'http://127.0.0.1:8123/private/resident.glb');
  assert.equal(result.profile, 'desktop'); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.source));
  assert.ok(Object.isFrozen(result.position)); assert.ok(Object.isFrozen(result.idleEnvelope.min));
  assert.equal(JSON.stringify(data), before); data.profiles.desktop.position[0] = 99; assert.equal(result.position[0], 0);
  assert.equal(readEaldholtResidentPreviewInput(before, 'quest', worldUrl.replace('desktop.glb', 'quest.glb'))!.profile, 'quest');
});

test('configuration rejects gameplay purposes, extra keys, traversal, oversized assets and profile mismatch', () => {
  const refused = (change: (value: ReturnType<typeof config>) => void) => { const value = config(); change(value); assert.throws(() => readEaldholtResidentPreviewInput(JSON.stringify(value), 'desktop', worldUrl)); };
  refused(c => { c.usage = 'household-worker'; }); refused(c => { c.schemaVersion = 2; });
  refused(c => { (c as unknown as Record<string, unknown>).qualified = true; });
  refused(c => { c.actor.file = '../resident.glb'; }); refused(c => { c.actor.file = 'https://example.org/actor.glb'; });
  refused(c => { c.actor.bytes = RESIDENT_PREVIEW_ACTOR_MAX_BYTES + 1; });
  refused(c => { c.profiles.quest.source.bytes = RESIDENT_PREVIEW_WORLD_MAX_BYTES + 1; });
  refused(c => { c.actor.sha256 = c.profiles.desktop.source.sha256; });
  refused(c => { c.profiles.quest.position[0] = NaN; });
  refused(c => { c.profiles.quest.yawRadians = 1e10; });
  refused(c => { c.profiles.desktop.idleEnvelope.max[0] = -.4; });
  refused(c => { c.profiles.quest.proofSha256 = 'unverified'; });
  refused(c => { c.idleClip = '\n'; });
  assert.throws(() => readEaldholtResidentPreviewInput(JSON.stringify(config()), 'desktop', worldUrl.replace('desktop.glb', 'other.glb')), /profile/);
  assert.throws(() => readEaldholtResidentPreviewInput(config(), 'desktop', worldUrl), /JSON/);
  assert.throws(() => readEaldholtResidentPreviewInput(' '.repeat(16385), 'desktop', worldUrl), /bounded/);
});

test('configuration permits no credentialed, non-HTTP, query or fragment model URLs', () => {
  for (const url of ['file:///desktop.glb', 'https://synthetic:fixture@example.org/desktop.glb', worldUrl + '?variant=other', worldUrl + '#other']) {
    assert.throws(() => readEaldholtResidentPreviewInput(JSON.stringify(config()), 'desktop', url), /plain HTTP/);
  }
});

test('exact GLB verification binds SHA and complete length before accepting embedded transport', async () => {
  const bytes = glb(), expected = identity(bytes), before = new Uint8Array(bytes).slice();
  await verifyResidentPreviewGlb(bytes, expected, signal()); assert.deepEqual(new Uint8Array(bytes), before);
  await assert.rejects(verifyResidentPreviewGlb(bytes, { ...expected, sha256: '0'.repeat(64) }, signal()), /hash/);
  await assert.rejects(verifyResidentPreviewGlb(bytes, { ...expected, bytes: expected.bytes + 4 }, signal()), /length/);
  const bad = bytes.slice(0); new DataView(bad).setUint32(4, 1, true);
  await assert.rejects(verifyResidentPreviewGlb(bad, identity(bad), signal()), /JSON\/BIN/);
});

test('hash-matching external resources and malformed GLB boundaries still fail closed', async () => {
  for (const document of [
    { buffers: [{ byteLength: 4, uri: 'https://example.org/buffer.bin' }] },
    { buffers: [{ byteLength: 4 }], images: [{ uri: 'https://example.org/image.png' }] },
    { buffers: [{ byteLength: 4 }], images: [{ uri: '../outside.png' }] },
    { buffers: [{ byteLength: 4 }, { byteLength: 0 }] },
    { buffers: [{ byteLength: 99 }] },
  ]) { const bytes = glb(document); await assert.rejects(verifyResidentPreviewGlb(bytes, identity(bytes), signal())); }
  const bytes = glb(), bad = bytes.slice(0); new DataView(bad).setUint32(12, 0xffffffff, true);
  await assert.rejects(verifyResidentPreviewGlb(bad, identity(bad), signal()), /JSON\/BIN/);
});

test('one transfer returns those same verified bytes without another URL fetch', async () => {
  const bytes = glb(), expected = identity(bytes); let calls = 0;
  const fetcher = (async (url, options) => {
    calls++; assert.equal(url, expected.url); assert.equal(options?.redirect, 'error'); assert.equal(options?.credentials, 'same-origin');
    return new Response(bytes, { headers: { 'content-length': String(bytes.byteLength) } });
  }) as typeof fetch;
  const loaded = await loadVerifiedResidentPreviewGlb(expected, signal(), fetcher);
  assert.equal(calls, 1); assert.notEqual(loaded, bytes); assert.deepEqual(new Uint8Array(loaded), new Uint8Array(bytes));
});

test('transfer rejects wrong declared length and cancels overflow instead of passing bytes to an engine', async () => {
  const bytes = glb(), expected = identity(bytes); let cancelled = false;
  const response = () => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(bytes.byteLength + 1)); }, cancel() { cancelled = true; } });
  await assert.rejects(loadVerifiedResidentPreviewGlb(expected, signal(), (async () => new Response(response(), { headers: { 'content-length': '99999' } })) as typeof fetch), /length/);
  assert.equal(cancelled, true); cancelled = false;
  await assert.rejects(loadVerifiedResidentPreviewGlb(expected, signal(), (async () => new Response(response())) as typeof fetch), /byte limit/);
  assert.equal(cancelled, true);
  await assert.rejects(loadVerifiedResidentPreviewGlb(expected, signal(), (async () => new Response(bytes.slice(0, -1))) as typeof fetch), /incomplete/);
});

test('abort before transfer or during SHA verification publishes no accepted asset', async () => {
  const bytes = glb(), expected = identity(bytes), early = new AbortController(); early.abort(); let calls = 0;
  await assert.rejects(loadVerifiedResidentPreviewGlb(expected, early.signal, (async () => { calls++; return new Response(bytes); }) as typeof fetch), /cancelled/);
  assert.equal(calls, 0);
  const later = new AbortController(), pending = verifyResidentPreviewGlb(bytes, expected, later.signal); later.abort();
  await assert.rejects(pending, /cancelled/);
});

test('transfer identity limits and status errors fail without speculative retries', async () => {
  const bytes = glb(), expected = identity(bytes); let calls = 0;
  for (const variant of [{ ...expected, bytes: RESIDENT_PREVIEW_WORLD_MAX_BYTES + 1 }, { ...expected, url: expected.url + '?other=1' }]) {
    await assert.rejects(loadVerifiedResidentPreviewGlb(variant, signal(), (async () => { calls++; return new Response(bytes); }) as typeof fetch), /identity/);
  }
  assert.equal(calls, 0);
  await assert.rejects(loadVerifiedResidentPreviewGlb(expected, signal(), (async () => { calls++; return new Response(null, { status: 404 }); }) as typeof fetch), /could not/);
  assert.equal(calls, 1);
});

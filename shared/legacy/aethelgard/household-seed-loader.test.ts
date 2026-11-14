import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOUSEHOLD_SEED_MAX_BYTES, householdSeedUrl, loadHouseholdSeed } from './household-seed-loader';

test('private seed is opt-in and confined to the configured folder', () => {
  assert.equal(householdSeedUrl('http://localhost:8068/models', undefined), null);
  assert.equal(householdSeedUrl('http://localhost:8068/models', ''), null);
  assert.equal(householdSeedUrl('http://localhost:8068/models', 'household-v1.json'), 'http://localhost:8068/models/household-v1.json');
  for (const file of ['../seed.json', 'https://elsewhere/seed.json', 'seed.json?token=secret', 'a/seed.json', 'seed.glb']) {
    assert.throws(() => householdSeedUrl('http://localhost:8068/', file));
  }
  for (const base of ['file:///private/', 'https://user:password@example.test/', 'https://example.test/?key=secret']) {
    assert.throws(() => householdSeedUrl(base, 'seed.json'));
  }
});

test('streaming load keeps cancellation and credentials with the host', async () => {
  const controller = new AbortController();
  const fetcher: typeof fetch = async (_url, options) => {
    assert.equal(options?.signal, controller.signal);
    assert.equal(options?.credentials, 'same-origin');
    assert.equal(options?.redirect, 'error');
    return new Response('{"kind":"private-seed"}');
  };
  assert.deepEqual(await loadHouseholdSeed('http://localhost/seed.json', controller.signal, fetcher), { kind: 'private-seed' });
  controller.abort();
  await assert.rejects(loadHouseholdSeed('http://localhost/seed.json', controller.signal, fetcher), { name: 'AbortError' });
});

test('oversize streams are refused even when the declared length is absent or false', async () => {
  for (const declared of [undefined, '1', String(HOUSEHOLD_SEED_MAX_BYTES + 1)]) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new Uint8Array(HOUSEHOLD_SEED_MAX_BYTES + 1)); },
      cancel() { cancelled = true; },
    });
    const fetcher: typeof fetch = async () => new Response(body, { headers: declared ? { 'content-length': declared } : {} });
    await assert.rejects(loadHouseholdSeed('http://localhost/seed.json', new AbortController().signal, fetcher), /size/);
    assert.equal(cancelled, true);
  }
});

test('invalid UTF-8, JSON and HTTP failures stay failures without returning partial content', async () => {
  for (const response of [new Response(new Uint8Array([0xc3, 0x28])), new Response('{broken'), new Response('missing', { status: 404 })]) {
    await assert.rejects(loadHouseholdSeed('http://localhost/seed.json', new AbortController().signal, async () => response));
  }
});

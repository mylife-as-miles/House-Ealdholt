import assert from 'node:assert/strict';
import test from 'node:test';
import { readResponseBytes } from './download-progress';

const bytes = (length: number) => Uint8Array.from({ length }, (_, index) => index % 251);
function chunked(parts: Uint8Array[], headers: Record<string, string>): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) { for (const part of parts) controller.enqueue(part); controller.close(); },
  });
  return new Response(body, { headers });
}

test('a body with a stated size is read whole and reports the share received after each chunk', async () => {
  const source = bytes(1000), seen: number[] = [];
  const response = chunked([source.subarray(0, 250), source.subarray(250, 600), source.subarray(600)], { 'Content-Length': '1000' });
  const result = new Uint8Array(await readResponseBytes(response, fraction => seen.push(fraction)));
  assert.deepEqual(result, source);
  assert.deepEqual(seen, [.25, .6, 1]);
});

test('without a usable size, or with a content encoding, the bytes still arrive and no share is invented', async () => {
  const source = bytes(300);
  for (const headers of [{}, { 'Content-Length': '0' }, { 'Content-Length': 'many' }, { 'Content-Length': '120', 'Content-Encoding': 'gzip' }] as Record<string, string>[]) {
    const seen: number[] = [];
    const result = new Uint8Array(await readResponseBytes(chunked([source], headers), fraction => seen.push(fraction)));
    assert.deepEqual(result, source, JSON.stringify(headers));
    assert.deepEqual(seen, [], JSON.stringify(headers));
  }
  // No listener: the plain read, even with a stated size.
  assert.deepEqual(new Uint8Array(await readResponseBytes(chunked([source], { 'Content-Length': '300' }))), source);
});

test('a body longer or shorter than its stated size keeps every byte it delivered', async () => {
  const source = bytes(900);
  const long: number[] = [];
  const longer = new Uint8Array(await readResponseBytes(chunked([source.subarray(0, 400), source.subarray(400)], { 'Content-Length': '500' }), fraction => long.push(fraction)));
  assert.deepEqual(longer, source);
  assert.deepEqual(long, [.8], 'no share above the stated total');
  const short: number[] = [];
  const shorter = new Uint8Array(await readResponseBytes(chunked([source.subarray(0, 450)], { 'Content-Length': '900' }), fraction => short.push(fraction)));
  assert.deepEqual(shorter, source.subarray(0, 450));
  assert.deepEqual(short, [.5]);
});

test('a read that fails part-way rejects, as arrayBuffer would', async () => {
  const failing = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(bytes(10)); controller.error(new DOMException('Aborted', 'AbortError')); },
  });
  await assert.rejects(readResponseBytes(new Response(failing, { headers: { 'Content-Length': '100' } }), () => {}), { name: 'AbortError' });
});

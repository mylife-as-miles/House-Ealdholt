import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { EXRExporter } from "three/examples/jsm/exporters/EXRExporter.js";
import { exrTexture, fetchBytes, loadExrTexture } from "./exr-texture";
import { flipRowsInPlace } from "./lightmap-rows";

test("a texture from decoded EXR pixels is set up as EXRLoader sets one up, so the arena looks the same (A-22)", () => {
  const data = new Uint16Array(2 * 3 * 4);
  const texture = exrTexture({ width: 2, height: 3, data, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace });
  // What EXRLoader.parse returns, applied by DataTextureLoader.
  const reference = new THREE.DataTexture();
  (new EXRLoader().setDataType(THREE.HalfFloatType) as unknown as { _applyTexData(texture: THREE.DataTexture, data: object): void })._applyTexData(reference, {
    width: 2, height: 3, data, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace, type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, flipY: false,
  });
  for (const key of ["format", "type", "colorSpace", "wrapS", "wrapT", "magFilter", "minFilter", "anisotropy", "flipY", "generateMipmaps"] as const) {
    assert.equal(texture[key], reference[key], key);
  }
  assert.equal(texture.image.data, data);
  assert.equal(texture.image.width, 2);
  assert.equal(texture.image.height, 3);
});

test("turns rows over in place, the last first (the lightmaps' flip, done in the decoding worker)", () => {
  const data = new Uint16Array([1, 1, 2, 2, 3, 3]);
  flipRowsInPlace(data, 3);
  assert.deepEqual(Array.from(data), [3, 3, 2, 2, 1, 1]);
  flipRowsInPlace(null, 3); // nothing to turn
});

test("reads a download whole, reporting its bytes as they come, and stops when called off (A-07)", async () => {
  const original = globalThis.fetch;
  const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const body = new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
    return new Response(body, { headers: { "content-length": "5" } });
  }) as typeof fetch;
  try {
    const seen: [number, number][] = [];
    const buffer = await fetchBytes("lightmap.exr", { onProgress: (loaded, total) => seen.push([loaded, total]) });
    assert.deepEqual(Array.from(new Uint8Array(buffer)), [1, 2, 3, 4, 5]);
    assert.deepEqual(seen, [[0, 5], [3, 5], [5, 5]]);
    const leaving = new AbortController();
    leaving.abort();
    await assert.rejects(loadExrTexture("lightmap.exr", { signal: leaving.signal }), { name: "AbortError" });
  } finally { globalThis.fetch = original; }
});

test("decodes a real EXR file, turned over for a lightmap, as EXRLoader decodes it (the path taken where there are no workers)", async () => {
  // A 2x3 half-float picture whose rows are numbered 1, 2 and 3 (bottom-up, as EXRLoader lays them out).
  const half = (value: number) => THREE.DataUtils.toHalfFloat(value);
  const rows = [1, 2, 3].flatMap((row) => [row, row, row, 1, row, row, row, 1].map(half));
  const source = new THREE.DataTexture(new Uint16Array(rows), 2, 3, THREE.RGBAFormat, THREE.HalfFloatType);
  const file = await new EXRExporter().parse(source, { type: THREE.HalfFloatType, compression: 0 } as never);
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(file.slice().buffer)) as typeof fetch;
  try {
    const reference = new EXRLoader().setDataType(THREE.HalfFloatType).parse(file.slice().buffer) as unknown as { data: Uint16Array; width: number; height: number };
    const plain = await loadExrTexture("plain.exr");
    assert.deepEqual(Array.from(plain.image.data as Uint16Array), Array.from(reference.data));
    const flipped = await loadExrTexture("lightmap.exr", { flip: true });
    const firstOfRow = (data: Uint16Array) => [0, 1, 2].map((row) => THREE.DataUtils.fromHalfFloat(data[row * 8]!));
    assert.deepEqual(firstOfRow(flipped.image.data as Uint16Array), firstOfRow(reference.data).reverse());
  } finally { globalThis.fetch = original; }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { EquirectangularReflectionMapping, HalfFloatType, LinearSRGBColorSpace, type DataTexture } from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { encodeEaldholtProbeHdr } from '../../../../shared/legacy/aethelgard/environment/pond-probe-hdr';
import { readEaldholtPondProbeConfig } from '../../../../shared/legacy/aethelgard/environment/pond-probe-config';
import { loadEaldholtOwnedPondProbe } from './pond-probe-runtime';

test('Desktop uses the actual HDR loader, owns the decoded texture and releases a late cancelled load', async () => {
  const entry = { modelUrl: 'http://127.0.0.1:8068/fixture-quest.glb', modelSha256: 'a'.repeat(64), lightingVersion: 'fixture-r1',
    hdrUrl: 'http://127.0.0.1:8068/fixture-quest.hdr', metadataUrl: 'http://127.0.0.1:8068/fixture-quest.metadata.json' };
  const config = readEaldholtPondProbeConfig(JSON.stringify({ quest: entry }), 'quest')!;
  const pixels = new Float32Array(512 * 256 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([2, .25, .125, 1], i);
  const hdr = encodeEaldholtProbeHdr(pixels, 512, 256);
  const metadata = { version: 1, profile: 'quest', modelSha256: entry.modelSha256, lightingVersion: entry.lightingVersion,
    sourceAxes: true, neutralFillAlreadyBaked: true, realtime: false, format: 'radiance-rgbe', width: 512, height: 256, cubeFaceSize: 128 };
  const originalFetch = globalThis.fetch, originalLoad = HDRLoader.prototype.loadAsync;
  const progressDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ProgressEvent');
  // Node's fetch streams lack this browser event. The actual public loader still
  // decodes the generated RGBE through its normal Blob URL/data-texture path.
  if (!progressDescriptor) Object.defineProperty(globalThis, 'ProgressEvent', { configurable: true, value: class extends Event {
    constructor(type: string, init: Record<string, unknown> = {}) { super(type); Object.assign(this, init); }
  } });
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === entry.metadataUrl) return Response.json(metadata);
    if (url === entry.hdrUrl) return new Response(new Uint8Array(hdr));
    return originalFetch(input, init);
  };
  try {
    const loaded = await loadEaldholtOwnedPondProbe(config, new AbortController().signal);
    const texture = loaded.texture as DataTexture;
    assert.equal(texture.type, HalfFloatType); assert.equal(texture.colorSpace, LinearSRGBColorSpace);
    assert.equal(texture.mapping, EquirectangularReflectionMapping); assert.equal(texture.image.width, 512); assert.equal(texture.image.height, 256);
    assert.ok(texture.image.data instanceof Uint16Array); assert.equal(texture.flipY, true);
    let disposals = 0; texture.addEventListener('dispose', () => disposals++);
    loaded.dispose(); loaded.dispose(); assert.equal(disposals, 1);
    const late = new AbortController(); let lateDisposals = 0;
    HDRLoader.prototype.loadAsync = async function (url, progress) {
      const texture = await originalLoad.call(this, url, progress);
      texture.addEventListener('dispose', () => lateDisposals++); late.abort(); return texture;
    };
    await assert.rejects(loadEaldholtOwnedPondProbe(config, late.signal));
    assert.equal(lateDisposals, 1);
  } finally {
    globalThis.fetch = originalFetch; HDRLoader.prototype.loadAsync = originalLoad;
    if (progressDescriptor) Object.defineProperty(globalThis, 'ProgressEvent', progressDescriptor);
    else Reflect.deleteProperty(globalThis, 'ProgressEvent');
  }
});

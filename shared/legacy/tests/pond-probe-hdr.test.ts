import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeEaldholtProbeHdr } from '../aethelgard/environment/pond-probe-hdr';
import { ealdholtProbeDirection, EALDHOLT_POND_PROBE, skipsEaldholtProbeNeutralFill,
  validateEaldholtPondProbeIdentity, type EaldholtPondProbeIdentity } from '../aethelgard/environment/pond-probe';

/** Independent format decoder: checks the produced standard packet boundaries,
 * channel planes and row order, rather than sharing encoder implementation. */
function decode(bytes: Uint8Array): { width: number; height: number; pixels: number[][] } {
  const text = new TextDecoder().decode(bytes.subarray(0, 100));
  const header = /^#\?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y (\d+) \+X (\d+)\n/.exec(text);
  assert.ok(header); const width = +header[2], height = +header[1]; let cursor = header[0].length;
  const pixels: number[][] = [];
  for (let row = 0; row < height; row++) {
    assert.deepEqual([...bytes.subarray(cursor, cursor + 4)], [2, 2, width >> 8, width & 255]); cursor += 4;
    const channels = Array.from({ length: 4 }, () => [] as number[]);
    for (const channel of channels) while (channel.length < width) {
      const count = bytes[cursor++]; assert.ok(count > 0 && count <= 128);
      for (let i = 0; i < count; i++) channel.push(bytes[cursor++]);
      assert.ok(channel.length <= width);
    }
    for (let x = 0; x < width; x++) {
      const scale = channels[3][x] ? 2 ** (channels[3][x] - 128) / 256 : 0;
      pixels.push([channels[0][x] * scale, channels[1][x] * scale, channels[2][x] * scale]);
    }
  }
  assert.equal(cursor, bytes.length); return { width, height, pixels };
}

test('Radiance output retains HDR radiance and reverses GL rows without exposure/gamma', () => {
  const width = 257, height = 2, rgba = new Float32Array(width * height * 4);
  const bottom = [12.5, .18, 1], top = [65504, 4096, 0];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set([...(y ? top : bottom), 1], (y * width + x) * 4);
  rgba.fill(0, 0, 4);
  const decoded = decode(encodeEaldholtProbeHdr(rgba, width, height));
  assert.equal(decoded.width, width); assert.equal(decoded.height, height);
  assert.deepEqual(decoded.pixels[0], [65280, 4096, 0]);
  assert.deepEqual(decoded.pixels[width], [0, 0, 0]);
  assert.deepEqual(decoded.pixels[width + 1], [12.5, .125, 1]); // one shared exponent, expected RGBE quantization
  const noFlip = decode(encodeEaldholtProbeHdr(rgba, width, height, 'top-down'));
  assert.deepEqual(noFlip.pixels[0], [0, 0, 0]);
  assert.equal(noFlip.pixels[width][0], 65280);
});

test('HDR encoder rejects unsupported dimensions, malformed buffers and invalid radiance', () => {
  assert.throws(() => encodeEaldholtProbeHdr(new Float32Array(16), 2, 2));
  assert.throws(() => encodeEaldholtProbeHdr(new Float32Array(33), 8, 1));
  for (const value of [NaN, Infinity, -.01]) {
    const rgba = new Float32Array(32); rgba[2] = value;
    assert.throws(() => encodeEaldholtProbeHdr(rgba, 8, 1), /finite and nonnegative/);
  }
});

test('probe projection axes and identity prohibit stale files and a second neutral mix', () => {
  for (const [u, v, expected] of [[.5, .5, [1, 0, 0]], [.75, .5, [0, 0, 1]], [.25, .5, [0, 0, -1]], [.5, 1, [0, 1, 0]]] as const) {
    const direction = ealdholtProbeDirection(u, v);
    direction.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-12));
  }
  const identity: EaldholtPondProbeIdentity = { version: 1, profile: 'quest', modelSha256: 'a'.repeat(64),
    lightingVersion: 'fixture-v1', sourceAxes: true, neutralFillAlreadyBaked: true, realtime: false };
  const expected = { profile: identity.profile, modelSha256: identity.modelSha256, lightingVersion: identity.lightingVersion };
  validateEaldholtPondProbeIdentity(identity, expected);
  assert.throws(() => validateEaldholtPondProbeIdentity(identity, { ...expected, modelSha256: 'b'.repeat(64) }));
  assert.throws(() => validateEaldholtPondProbeIdentity(identity, { ...expected, lightingVersion: 'fixture-v2' }));
  assert.equal(skipsEaldholtProbeNeutralFill({ crownfallLocalPondProbe: identity }), true);
  assert.equal(skipsEaldholtProbeNeutralFill({}), false);
  assert.equal(EALDHOLT_POND_PROBE.quest.width, 512); assert.equal(EALDHOLT_POND_PROBE.desktop.height, 512);
});

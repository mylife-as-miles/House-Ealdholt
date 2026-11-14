import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtFarBoundary, packEaldholtFarBoundary, sampleEaldholtFarBoundary, sampleEaldholtFarBoundaryField } from '../aethelgard/environment/far-projection-boundary';
import { EALDHOLT_FAR_LAND_FIELD, sampleEaldholtFarGeography, type EaldholtFarProjectionPacket } from '../aethelgard/environment/far-surround';
import { createEaldholtCloudPixels } from '../aethelgard/environment/atmosphere';
import { EALDHOLT_FAR_SOURCE_SUN } from '../aethelgard/environment/far-surround-projection';
import { EALDHOLT_VILLAGE_DAYLIGHT } from '../aethelgard/environment/daylight';
const packet: EaldholtFarProjectionPacket = { geography: { version: 1, axes: 'source:+X-east/-Z-north', landField: EALDHOLT_FAR_LAND_FIELD,
  coastSamples: new Float32Array([-1000, -1000, 1000, -1000]), channelSamples: new Float32Array([0, 200, 210, 0, 1000, 200, 210, 0]),
  seaLevel: 0, sourceEnvelope: { minX: 0, maxX: 100, minZ: 0, maxZ: 100 }, riverJoinX: 1000, riverFarX: 10000 }, localBounds: { min: [0, 0, 0], max: [100, 20, 100] } };
const surface = { positions: new Float64Array([0, 6, 0, 100, 7, 0, 0, 6.3, 100, 100, 7.3, 100]), indices: new Uint32Array([0, 2, 1, 1, 2, 3]) };
test('actual terrain boundary quantizes once, blends outside64m and keeps cloud R/A exact', () => {
  const boundary = createEaldholtFarBoundary(packet, [surface]);
  assert.equal(boundary.mainlandSamples, 1024); assert.equal(boundary.waterSamples, 0); assert.equal(boundary.heights.byteLength, 2048);
  assert.ok(boundary.maximumQuantizationError < .00002);
  assert.ok(Math.abs(sampleEaldholtFarBoundary(packet, boundary, 37.5, 100) - 6.675) < .00002);
  const atEdge = sampleEaldholtFarBoundaryField(packet, boundary, 37.5, 100);
  assert.ok(Math.abs(atEdge.level - 6.675) < .00002);
  const far = sampleEaldholtFarBoundaryField(packet, boundary, 37.5, 164);
  assert.equal(far.level, sampleEaldholtFarGeography(packet.geography, 37.5, 164).level);
  const middle = sampleEaldholtFarBoundaryField(packet, boundary, 37.5, 132);
  const expected = (sampleEaldholtFarBoundary(packet, boundary, 37.5, 132) + sampleEaldholtFarGeography(packet.geography, 37.5, 132).level) / 2;
  assert.ok(Math.abs(middle.level - expected) < 1e-12);
  const pixels = createEaldholtCloudPixels(128), before = pixels.slice(); packEaldholtFarBoundary(pixels, boundary);
  for (let i = 0; i < pixels.length; i += 4) { assert.equal(pixels[i], before[i]); assert.equal(pixels[i + 3], before[i + 3]); }
  for (let i = 0; i < 1024; i++) assert.equal(pixels[i * 4 + 1] * 256 + pixels[i * 4 + 2], boundary.heights[i]);
  assert.deepEqual(EALDHOLT_FAR_SOURCE_SUN, EALDHOLT_VILLAGE_DAYLIGHT.sunOffset);
  assert.throws(() => createEaldholtFarBoundary(packet, []), /mainland terrain missing/);
});

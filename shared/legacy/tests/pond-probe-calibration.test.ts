import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtCardinalProbePixels, EALDHOLT_PROBE_CARDINAL_RADIANCE, scoreEaldholtCardinalProbeSample,
  type EaldholtProbeCardinal } from '../aethelgard/environment/pond-probe-calibration';

test('original float diagnostic panorama gives six distinct correctly oriented cardinal colours', () => {
  const panorama = createEaldholtCardinalProbePixels('quest');
  assert.equal(panorama.width, 512); assert.equal(panorama.height, 256); assert.equal(panorama.data.length, 512 * 256 * 4);
  const positions: [number, number, EaldholtProbeCardinal][] = [[.5, .5, '+X'], [0, .5, '-X'], [.75, .5, '+Z'], [.25, .5, '-Z'], [.5, .999, '+Y'], [.5, 0, '-Y']];
  const colours = new Set();
  for (const [u, v, face] of positions) {
    const offset = (Math.min(255, Math.floor(v * 256)) * 512 + Math.min(511, Math.floor(u * 512))) * 4;
    const rgb = [...panorama.data.subarray(offset, offset + 3)] as [number, number, number];
    assert.equal(scoreEaldholtCardinalProbeSample(rgb, face).passed, true); colours.add(rgb.join(','));
    assert.equal(panorama.data[offset + 3], 1);
  }
  assert.equal(colours.size, 6);
  assert.equal(scoreEaldholtCardinalProbeSample(EALDHOLT_PROBE_CARDINAL_RADIANCE['-X'], '+X').passed, false);
  assert.equal(scoreEaldholtCardinalProbeSample([0, 0, 0], '+X').passed, false);
  assert.throws(() => scoreEaldholtCardinalProbeSample([NaN, 0, 0], '+X'), /invalid/);
});

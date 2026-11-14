import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtCloudPixels, EALDHOLT_CLOUDS } from '../aethelgard/environment/atmosphere';
import { EALDHOLT_POND_BROAD_WAVE, ealdholtWaterBandAttenuation, patchEaldholtWaterRipples } from '../aethelgard/environment/water-ripples';

test('cloud coverage is deterministic, varied opaque data with continuous repeat boundaries', () => {
  const size = 64, a = createEaldholtCloudPixels(size), b = createEaldholtCloudPixels(size);
  assert.deepEqual(a, b); assert.equal(a.length, size * size * 4);
  let minimum = 255, maximum = 0, seam = 0, neighbours = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = (y * size + x) * 4;
    minimum = Math.min(minimum, a[p]); maximum = Math.max(maximum, a[p]);
    assert.equal(a[p + 3], 255); assert.equal(a[p], a[p + 1]); assert.equal(a[p], a[p + 2]);
    if (x < size - 1) neighbours += Math.abs(a[p] - a[p + 4]);
    if (x === size - 1) seam += Math.abs(a[p] - a[y * size * 4]);
  }
  assert.ok(maximum - minimum > 90, 'cloud texture needs broad coverage variation');
  assert.ok(seam / size < neighbours / (size * (size - 1)) * 2, 'repeat edge must behave like an ordinary adjacent sample');
  assert.throws(() => createEaldholtCloudPixels(1)); assert.throws(() => createEaldholtCloudPixels(Number.NaN));
});

test('cloud projection is never safety-clamped while its coverage is visible at the horizon', () => {
  assert.ok(EALDHOLT_CLOUDS.projectionFloor > 0);
  assert.ok(EALDHOLT_CLOUDS.horizonFadeStart > EALDHOLT_CLOUDS.projectionFloor);
  assert.ok(EALDHOLT_CLOUDS.horizonFadeEnd > EALDHOLT_CLOUDS.horizonFadeStart);
  assert.ok(EALDHOLT_CLOUDS.horizonFadeEnd < 1);
});

test('gentle broad pond band remains resolvable at measured low-LOD pixels without restoring aliased fine bands', () => {
  for (const footprint of [.39, .47, .53]) {
    assert.equal(ealdholtWaterBandAttenuation(5.3, footprint), 0);
    assert.ok(ealdholtWaterBandAttenuation(EALDHOLT_POND_BROAD_WAVE.wavenumber, footprint) > .999);
  }
  assert.equal(ealdholtWaterBandAttenuation(.85, 3), 0, 'the broad band must also disappear when unresolved');
  assert.equal(EALDHOLT_POND_BROAD_WAVE.slopeAmplitude, .018);
  assert.ok(EALDHOLT_POND_BROAD_WAVE.slopeAmplitude / EALDHOLT_POND_BROAD_WAVE.wavenumber < .022);
});

test('pond shader preserves PBR chunks, filters distant bands and shares pauseable scalar time', () => {
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <normal_fragment_maps>' };
  const uniforms = { time: { value: 4 }, metresPerWorldUnit: { value: 50 }, worldToSource: { value: null }, sourceToWorldRotation: { value: null }, windDirection: { value: { x: 0, y: 1 } }, windStrength: { value: .7 } };
  patchEaldholtWaterRipples(shader, uniforms);
  assert.equal((shader.uniforms as Record<string, unknown>).uEaldholtRippleTime, uniforms.time);
  assert.equal((shader.uniforms as Record<string, unknown>).uEaldholtMetresPerWorldUnit, uniforms.metresPerWorldUnit);
  assert.equal((shader.uniforms as Record<string, unknown>).uEaldholtWaterWindDirection, uniforms.windDirection);
  assert.equal((shader.uniforms as Record<string, unknown>).uEaldholtWaterWindStrength, uniforms.windStrength);
  assert.match(shader.fragmentShader, /point = vec2\(dot\(point, wind\), dot\(point, acrossWind\)\)/);
  assert.match(shader.fragmentShader, /clamp\(uEaldholtWaterWindStrength, 0\., 1\.\)/);
  assert.match(shader.vertexShader, /instanceMatrix \* ealdholtWaterPosition/);
  assert.match(shader.fragmentShader, /dFdx\(point\)/); assert.match(shader.fragmentShader, /smoothstep\(.45, 1.6/);
  assert.match(shader.fragmentShader, /#include <normal_fragment_maps>/);
  assert.doesNotMatch(shader.fragmentShader, /gl_FragCoord|sampler2D|transmission|discard/);
  const previous = shader.fragmentShader; patchEaldholtWaterRipples(shader, uniforms); assert.equal(shader.fragmentShader, previous);
  assert.throws(() => patchEaldholtWaterRipples({ uniforms: {}, vertexShader: '', fragmentShader: '' }, uniforms));
});

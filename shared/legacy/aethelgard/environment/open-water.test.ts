import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenWaterBands, createOpenWaterNoise, computeOpenWaterSpectrumStats, openWaterDonelanBanner, openWaterInverseFFT1D } from './open-water-spectrum';
import { createOpenWaterClock, openWaterCapabilityFailure } from './open-water-clock';
import { patchEaldholtOpenWater, type EaldholtOpenWaterUniforms } from './open-water-shader';
import { OPEN_WATER_ASSEMBLE_FRAGMENT, OPEN_WATER_EVOLVE_FRAGMENT, OPEN_WATER_FFT_FRAGMENT, OPEN_WATER_SPECTRUM_FRAGMENT } from './open-water-programs';

const near = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
test('actual Stockham stages match an independent inverse DFT for impulses, packed fields and Hermitian waves', () => {
  for (const n of [4, 8, 32, 64]) {
    const source = Float64Array.from({ length: n * 2 }, (_, i) => Math.sin(i * .713) + (i % 7 === 0 ? 1 : 0));
    const result = openWaterInverseFFT1D(source);
    for (let x = 0; x < n; x++) {
      let real = 0, imaginary = 0;
      for (let k = 0; k < n; k++) { const angle = 2 * Math.PI * k * x / n; real += source[2 * k] * Math.cos(angle) - source[2 * k + 1] * Math.sin(angle); imaginary += source[2 * k] * Math.sin(angle) + source[2 * k + 1] * Math.cos(angle); }
      near(result[2 * x], real, 1e-10); near(result[2 * x + 1], imaginary, 1e-10);
    }
    const mode = new Float64Array(n * 2); mode[2] = .5; mode[(n - 1) * 2] = .5;
    const wave = openWaterInverseFFT1D(mode);
    for (let x = 0; x < n; x++) { near(wave[x * 2], Math.cos(2 * Math.PI * x / n)); near(wave[x * 2 + 1], 0); }
  }
  assert.match(OPEN_WATER_FFT_FRAGMENT, /int j = \(i >> \(uStage \+ 1\)\) \* ns \+ k/);
  assert.match(OPEN_WATER_EVOLVE_FRAGMENT, /cmul\(h0\.xy, e\) \+ cmul\(h0\.zw/);
});

test('bounded spectral bands remain contiguous and production energy statistics grow with wind', () => {
  for (const resolution of [32, 64] as const) {
    const bands = createOpenWaterBands(resolution); assert.deepEqual(bands.map(b => b.length), [1800, 117, 21, 3.7]);
    for (let i = 0; i < bands.length; i++) {
      assert.ok(bands[i].minimum > 0 && bands[i].minimum < bands[i].maximum);
      if (i) assert.equal(bands[i - 1].maximum, bands[i].minimum);
      assert.ok(bands[i].maximum <= Math.PI * (resolution - 2) / bands[i].length + 1e-9);
    }
    const calm = computeOpenWaterSpectrumStats({ wind: .5, fetch: 20000, direction: 0, scale: 0 }, bands);
    const breeze = computeOpenWaterSpectrumStats({ wind: 6, fetch: 20000, direction: 0, scale: .16 }, bands);
    const strong = computeOpenWaterSpectrumStats({ wind: 12, fetch: 20000, direction: 0, scale: 1 }, bands);
    assert.equal(calm.heightVariance, 0); assert.ok(breeze.heightVariance > 0); assert.ok(strong.heightVariance > breeze.heightVariance);
    assert.ok(strong.resolvedSlopeVariance > breeze.resolvedSlopeVariance); near(strong.bandSlopeVariance.reduce((a, b) => a + b), strong.resolvedSlopeVariance);
    assert.ok(strong.significantHeight > breeze.significantHeight && Number.isFinite(strong.significantHeight));
  }
  let integral = 0; const steps = 4096;
  for (let i = 0; i < steps; i++) integral += openWaterDonelanBanner(-Math.PI + (i + .5) * 2 * Math.PI / steps, 1) * 2 * Math.PI / steps;
  near(integral, 1, 1e-6);
  assert.match(OPEN_WATER_SPECTRUM_FRAGMENT, /float elfouhaily/); assert.match(OPEN_WATER_SPECTRUM_FRAGMENT, /float donelanBanner/);
});

test('seeded Gaussian noise is deterministic, finite and has independent unit-variance channels', () => {
  const a = createOpenWaterNoise(64, 1337), b = createOpenWaterNoise(64, 1337), c = createOpenWaterNoise(64, 1338);
  assert.deepEqual(a, b); assert.notDeepEqual(a, c);
  let mean = 0, power = 0; for (const sample of a) { assert.ok(Number.isFinite(sample)); mean += sample; power += sample * sample; }
  assert.ok(Math.abs(mean / a.length) < .04); assert.ok(Math.abs(power / a.length - 1) < .06);
});

test('presentation cadence is bounded, pause performs no work and history dt never double-counts a remainder', () => {
  const clock = createOpenWaterClock(15); assert.equal(clock.step(50, false), false); assert.equal(clock.step(500, false), false);
  assert.equal(clock.step(500, true), true); let updates = 0, simulated = 0;
  for (let i = 1; i <= 120; i++) if (clock.step(500 + i / 120, true)) { updates++; simulated += clock.deltaSeconds; }
  assert.ok(updates <= 15); near(clock.timeSeconds, 1, 1e-9); near(simulated, 1, 1e-9);
  const phase = clock.timeSeconds; assert.equal(clock.step(9000, false), false); assert.equal(clock.step(10000, true), false); near(clock.timeSeconds, phase);
  clock.step(20, true); near(clock.timeSeconds, phase); clock.step(NaN, true); clock.step(800, true); near(clock.timeSeconds, phase);
  clock.reset(); assert.equal(clock.step(1, false), false); assert.equal(clock.step(2, true), true); near(clock.timeSeconds, 0);
  assert.throws(() => createOpenWaterClock(16), /1..15/);
});

test('capability admission retains a reasoned analytic fallback on incomplete floating MRT hardware', () => {
  const caps = { webgl2: true, floatColorBuffer: true, maximumDrawBuffers: 4, maximumColorAttachments: 4, maximumTextureSize: 1024, fragmentTextureUnits: 16 };
  assert.equal(openWaterCapabilityFailure(caps, 64), null);
  assert.equal(openWaterCapabilityFailure({ ...caps, webgl2: false }, 64), 'webgl2-unavailable');
  assert.equal(openWaterCapabilityFailure({ ...caps, floatColorBuffer: false }, 64), 'float-color-buffer-unavailable');
  assert.equal(openWaterCapabilityFailure({ ...caps, maximumDrawBuffers: 1 }, 64), 'multiple-render-targets-unavailable');
  assert.equal(openWaterCapabilityFailure({ ...caps, maximumTextureSize: 16 }, 64), 'texture-size-unavailable');
  assert.equal(openWaterCapabilityFailure({ ...caps, fragmentTextureUnits: 8 }, 64), 'fragment-texture-budget-unavailable');
});

test('PBR patch replaces analytic slopes using exactly four shared textures and retains source transforms/fallback', () => {
  const uniforms: EaldholtOpenWaterUniforms = { surface0: { value: {} }, surface1: { value: {} }, surface2: { value: {} }, surface3: { value: {} },
    lengths: { value: new Float32Array([1800, 117, 21, 3.7]) }, resolution: { value: 32 }, ready: { value: 0 }, slopeVariance: { value: new Float32Array(4) }, windStrength: { value: .5 } };
  for (const profile of ['pond', 'trough', 'river', 'inlet', 'sea'] as const) {
    const frame = { time: { value: 0 }, metresPerWorldUnit: { value: 1 }, worldToSource: { value: {} }, sourceToWorldRotation: { value: {} } };
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
      fragmentShader: '#include <common>\nvoid main() {\n#include <normal_fragment_maps>\n}' };
    patchEaldholtOpenWater(shader, uniforms, frame, profile); const first = shader.fragmentShader; patchEaldholtOpenWater(shader, uniforms, frame, profile);
    assert.equal(shader.fragmentShader, first); assert.equal((first.match(/uniform sampler2D uEaldholtOpenWaterSurface/g) ?? []).length, 4);
    assert.match(first, /ealdholtSlope = ealdholtSpectral.xy;/); assert.match(first, /if \(uEaldholtOpenWaterReady > .5\)/);
    assert.equal(shader.uniforms.uEaldholtWaterWorldToSource, frame.worldToSource); assert.equal(shader.uniforms.uEaldholtWaterSourceRotation, frame.sourceToWorldRotation);
    assert.match(first, /surface\.w \* foamWeight/); assert.match(OPEN_WATER_ASSEMBLE_FRAGMENT, /oSurface = vec4\(s, Dy, foam\)/);
    if (profile === 'pond' || profile === 'trough') assert.match(first, /CROWNFALL_POND_GRAVITY_RIPPLES/);
  }
});

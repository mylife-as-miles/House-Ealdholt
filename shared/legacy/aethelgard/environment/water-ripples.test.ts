import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtWaterMotion, EALDHOLT_POND_GRAVITY_WAVES, patchEaldholtWaterRipples } from './water-ripples';
import { sampleWorldEnvironment } from './world-environment-state';

const time = { absoluteWorldMinute: 720, fractionalMinute: 0, dayIndex: 0, dayMinute: 720, elapsedWorldMinutes: 0, deferredMilliseconds: 0 };

test('water consumes the actual world wind contract, normalizes its bearing and stays calm before a valid sample', () => {
  const motion = createEaldholtWaterMotion();
  motion.update(10000, true); motion.update(10000.05, true);
  assert.equal(motion.windStrength.value, 0);
  const weather = sampleWorldEnvironment(time, 'water-wind-contract', { windStrength: .8 });
  motion.update(10000.1, true, weather);
  assert.ok(motion.windStrength.value > 0 && motion.windStrength.value < weather.windStrength);
  assert.ok(Math.abs(motion.windDirection.value.x - weather.wind[0]) < 1e-12);
  assert.ok(Math.abs(motion.windDirection.value.y - weather.wind[1]) < 1e-12);
  motion.update(10000.15, true, { wind: [0, 100], windStrength: 100 });
  assert.ok(Math.abs(Math.hypot(motion.windDirection.value.x, motion.windDirection.value.y) - 1) < 1e-12);
  assert.ok(motion.windStrength.value <= 1);
});

test('active surface phase is bounded through fallback clock changes, pause, rewind and unavailable time', () => {
  const motion = createEaldholtWaterMotion(), wind = { wind: [1, 0] as const, windStrength: 1 };
  motion.update(4, true, wind); assert.equal(motion.time.value, 0);
  motion.update(4.05, true, wind); assert.ok(Math.abs(motion.time.value - .05) < 1e-12);
  motion.update(100000, true, wind); assert.ok(Math.abs(motion.time.value - .15) < 1e-12, 'a newly available environment clock cannot jump surface phase');
  const phase = motion.time.value, strength = motion.windStrength.value;
  motion.update(100100, false, { wind: [-1, 0], windStrength: 0 });
  motion.update(300000, true, wind);
  assert.equal(motion.time.value, phase); assert.equal(motion.windStrength.value, strength);
  motion.update(300000.05, true, wind); assert.ok(Math.abs(motion.time.value - phase - .05) < 1e-10);
  const beforeRewind = motion.time.value;
  motion.update(0, true, wind); assert.equal(motion.time.value, beforeRewind);
  motion.update(Number.NaN, true, wind); motion.update(1000, true, wind);
  assert.equal(motion.time.value, beforeRewind);
});

test('wind turns smoothly, settles when calm or invalid and never owns downstream current time', () => {
  const motion = createEaldholtWaterMotion();
  motion.update(0, true, { wind: [1, 0], windStrength: 1 });
  for (let tick = 1; tick <= 30; tick++) motion.update(tick / 10, true, { wind: [1, 0], windStrength: 1 });
  assert.ok(motion.windStrength.value > .999);
  motion.update(3.1, true, { wind: [0, 1], windStrength: 1 });
  assert.ok(motion.windDirection.value.x > 0 && motion.windDirection.value.y > 0);
  const strength = motion.windStrength.value, phase = motion.time.value;
  motion.update(3.2, true, { wind: [0, 0], windStrength: 1 });
  assert.ok(motion.windStrength.value < strength);
  motion.update(3.3, true, { wind: [Number.NaN, 1], windStrength: Number.NaN });
  assert.ok(Number.isFinite(motion.windStrength.value));
  for (let tick = 34; tick <= 80; tick++) motion.update(tick / 10, true, null);
  assert.ok(motion.windStrength.value < .00001);
  assert.ok(motion.time.value > phase + 4, 'the authored river current continues with no wind');
});

function rippleShader(pond?: boolean) {
  const shader = { uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>' };
  const motion = createEaldholtWaterMotion();
  const uniforms = { ...motion, metresPerWorldUnit: { value: 1 }, worldToSource: { value: {} }, sourceToWorldRotation: { value: {} } };
  patchEaldholtWaterRipples(shader, uniforms, { pond });
  return { shader, uniforms };
}

/** Evaluate the actual emitted scalar GLSL, with independent vector/scalar
 * primitives, so unit, dispersion and visibility mistakes affect this check. */
function pondScalar(name: string, parameters: string[]) {
  const expression = rippleShader(true).shader.fragmentShader.match(new RegExp(`float ${name} = ([^;]+);`))?.[1];
  assert.ok(expression, `Missing production ${name} expression.`);
  const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1];
  const smoothstep = (a: number, b: number, value: number) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };
  const evaluate = new Function('dot', 'smoothstep', ...parameters, `return ${expression.replace(/\b(sqrt|max|min)\(/g, 'Math.$1(')};`) as (...args: unknown[]) => number;
  return (...values: unknown[]) => evaluate(dot, smoothstep, ...values);
}

test('only opted-in ponds receive gravity ripples; regional bands, shared resources and shader idempotence remain intact', () => {
  const regional = rippleShader(), explicitRegional = rippleShader(false), pond = rippleShader(true);
  assert.equal(regional.shader.vertexShader, pond.shader.vertexShader, 'Physical waves change the PBR normal, never geometry or the authored source frame.');
  assert.equal(regional.shader.fragmentShader, explicitRegional.shader.fragmentShader);
  assert.match(regional.shader.fragmentShader, /float broad =/);
  assert.doesNotMatch(regional.shader.fragmentShader, /CROWNFALL_POND_GRAVITY_RIPPLES/);
  assert.match(pond.shader.fragmentShader, /CROWNFALL_POND_GRAVITY_RIPPLES/);
  assert.doesNotMatch(pond.shader.fragmentShader, /float broad =|point = vec2\(dot\(point, wind\)/);
  assert.equal((pond.shader.fragmentShader.match(/ripples \+= ealdholtPondGravityBand\(/g) ?? []).length, 5);
  assert.equal((pond.shader.fragmentShader.match(/\bsampler\w*\s/g) ?? []).length, 0);
  assert.match(pond.shader.fragmentShader, /roughnessFactor \* roughnessFactor \+ ealdholtRipple\.z/);
  assert.equal(pond.shader.uniforms.uEaldholtRippleTime, pond.uniforms.time);
  assert.equal(pond.shader.uniforms.uEaldholtWaterWindDirection, pond.uniforms.windDirection);
  assert.equal(pond.shader.uniforms.uEaldholtWaterWindStrength, pond.uniforms.windStrength);
  const before = structuredClone(pond.shader);
  patchEaldholtWaterRipples(pond.shader, pond.uniforms, { pond: true });
  assert.deepEqual(pond.shader, before);
});

test('pond bands retain millimetre heights and gravity dispersion with the correct analytic height gradient', () => {
  assert.deepEqual(EALDHOLT_POND_GRAVITY_WAVES.map(wave => [wave.wavelength, wave.height]),
    [[1.9, .0022], [1.1, .0013], [.63, .0007], [.37, .0004], [.21, .00022]]);
  const phase = pondScalar('phase', ['direction', 'point', 'k', 'time']);
  const steepness = pondScalar('steepness', ['height', 'k', 'strength', 'along']);
  for (const wave of EALDHOLT_POND_GRAVITY_WAVES) {
    const k = 2 * Math.PI / wave.wavelength, period = 2 * Math.PI / Math.sqrt(9.81 * k);
    const at = [3.17, -2.43], t = .71, strength = .6;
    assert.ok(Math.abs(phase(wave.direction, at, k, t + period) - phase(wave.direction, at, k, t) + 2 * Math.PI) < 1e-12);
    const amplitude = wave.height * strength * (.25 + .75 * .8 * .8);
    const heightAt = (p: number[]) => amplitude * Math.sin(phase(wave.direction, p, k, t));
    for (let axis = 0; axis < 2; axis++) {
      const before = [...at], after = [...at], h = 1e-5; before[axis] -= h; after[axis] += h;
      const finite = (heightAt(after) - heightAt(before)) / (2 * h);
      const actual = wave.direction[axis] * steepness(wave.height, k, strength, .8) * Math.cos(phase(wave.direction, at, k, t));
      assert.ok(Math.abs(finite - actual) < 1e-9, 'Slope must differentiate physical height, including radians per metre.');
    }
  }
  const totalHeight = EALDHOLT_POND_GRAVITY_WAVES.reduce((sum, wave) => sum + wave.height, 0);
  const totalSlope = EALDHOLT_POND_GRAVITY_WAVES.reduce((sum, wave) => sum + wave.height * 2 * Math.PI / wave.wavelength, 0);
  assert.ok(totalHeight * 1.28 ** 2 < .008, 'Even coincident maximum gust crests stay below eight millimetres.');
  assert.ok(totalSlope * 1.28 ** 2 < .06, 'No broad swell or steep specular spikes are added to the quiet pond.');
});

test('wind weights amplitudes without rotating wave phase; calm and grazing-pixel limits remain bounded', () => {
  const shader = rippleShader(true).shader.fragmentShader;
  const along = pondScalar('along', ['direction', 'wind']);
  const steepness = pondScalar('steepness', ['height', 'k', 'strength', 'along']);
  const shown = pondScalar('shown', ['footprint', 'wavelength']);
  const phaseExpression = shader.match(/float phase = ([^;]+);/)?.[1] ?? '';
  assert.doesNotMatch(phaseExpression, /wind|gust|footprint/);
  assert.equal(along([1, 0], [1, 0]), 1);
  assert.equal(along([1, 0], [0, 1]), 0);
  assert.equal(along([1, 0], [-1, 0]), 0);
  for (const wave of EALDHOLT_POND_GRAVITY_WAVES) {
    const k = 2 * Math.PI / wave.wavelength;
    assert.equal(steepness(wave.height, k, 0, 1), 0, 'No valid wind sample leaves a flat PBR surface.');
    assert.equal(steepness(wave.height, k, 1, 1), steepness(wave.height, k, 1, 0) * 4);
    assert.equal(shown(wave.wavelength * .25, wave.wavelength), 1);
    assert.equal(shown(wave.wavelength * .5, wave.wavelength), 0);
    let previous = 1;
    for (const fraction of [0, .1, .25, .3, .4, .5, 1, 20]) {
      const visibility = shown(wave.wavelength * fraction, wave.wavelength);
      assert.ok(visibility >= 0 && visibility <= previous); previous = visibility;
    }
  }
  assert.match(shader, /\.5 \* steepness \* steepness \* \(1\. - shown \* shown\)/, 'Unresolved slope variance is retained for PBR roughness.');
});

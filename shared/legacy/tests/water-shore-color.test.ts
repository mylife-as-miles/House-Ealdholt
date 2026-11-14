import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtCoastalValleyBuffers } from '../aethelgard/environment/coastal-valley';
import type { EaldholtTerrainEdges } from '../aethelgard/environment/river-valley';
import { createEaldholtCoastalWaterShoreAttributes, ealdholtWaterShoreDistance, EALDHOLT_WATER_SHORE_LOOK, EALDHOLT_WATER_SHORE_CACHE_KEY, patchEaldholtWaterShoreColor } from '../aethelgard/environment/water-shore-color';
import { patchEaldholtWaterRipples } from '../aethelgard/environment/water-ripples';
import { patchEaldholtNeutralFill } from '../aethelgard/environment/neutral-fill';
import { patchWorldEnvironmentMaterial } from '../aethelgard/environment/environment-material-shader';
const fixture = (): EaldholtTerrainEdges => {
  const edge = [[-10, 2], [0, 2.2], [10, 2]] as const;
  return { minX: -10, maxX: 10, minZ: -10, maxZ: 10, west: edge, east: edge, north: edge, south: edge };
};
for (const profile of ['quest', 'desktop'] as const) test(`${profile}: runtime shore attributes own only two scalar floats per vertex and preserve source data`, () => {
  const data = createEaldholtCoastalValleyBuffers(fixture(), profile), before = structuredClone(data);
  const attrs = createEaldholtCoastalWaterShoreAttributes(data.shape, data.channel, data.sea), again = createEaldholtCoastalWaterShoreAttributes(data.shape, data.channel, data.sea);
  assert.deepEqual(data, before);
  assert.equal(attrs.byteLength, (data.channel.positions.length + data.sea.positions.length) / 3 * 8);
  assert.ok(attrs.byteLength < 4096);
  for (const kind of ['channel', 'sea'] as const) for (const field of ['across', 'halfWidth'] as const) {
    assert.equal(attrs[kind][field].length, data[kind].positions.length / 3);
    assert.ok(attrs[kind][field].every(Number.isFinite));
    assert.notEqual(attrs[kind][field].buffer, data[kind].positions.buffer);
    assert.notEqual(attrs[kind][field].buffer, again[kind][field].buffer);
  }
});

test('signed interpolation resolves channel shallows and deep centres across the widened inlet, without an open-end band', () => {
  const data = createEaldholtCoastalValleyBuffers(fixture(), 'quest'), attrs = createEaldholtCoastalWaterShoreAttributes(data.shape, data.channel, data.sea).channel;
  const widths: number[] = [];
  for (let i = 0; i < attrs.across.length; i += 2) {
    const half = attrs.halfWidth[i]; widths.push(half * 2);
    assert.equal(ealdholtWaterShoreDistance(attrs.across[i], half), 0);
    assert.equal(ealdholtWaterShoreDistance(attrs.across[i + 1], half), 0);
    assert.ok(Math.abs(ealdholtWaterShoreDistance((attrs.across[i] + attrs.across[i + 1]) / 2, half) - half) < 1e-6);
    assert.ok(Math.abs(ealdholtWaterShoreDistance(attrs.across[i] * .5, half) - half * .5) < 1e-6);
  }
  assert.ok(widths[0] > widths[widths.length - 1] * 2);
  const last = attrs.across.length - 2;
  assert.ok(ealdholtWaterShoreDistance((attrs.across[last] + attrs.across[last + 1]) / 2, attrs.halfWidth[last]) > 3, 'the longitudinal channel cut is not a bank');
});

test('sea shallows follow genuine coastline, skip the river mouth and ignore open chunk boundaries', () => {
  const data = createEaldholtCoastalValleyBuffers(fixture(), 'quest'), attrs = createEaldholtCoastalWaterShoreAttributes(data.shape, data.channel, data.sea), { shape } = data;
  let trueShores = 0, openMouth = 0;
  for (let i = 0; i < data.sea.positions.length; i += 6) {
    const outer = i / 3, coast = outer + 1, z = data.sea.positions[i + 2];
    assert.equal(attrs.sea.halfWidth[outer], -1); assert.equal(attrs.sea.halfWidth[coast], -1);
    assert.ok(ealdholtWaterShoreDistance(attrs.sea.across[outer], -1) > EALDHOLT_WATER_SHORE_LOOK.endMetres, 'the open sea outer boundary stays deep');
    if (z < shape.mouthLowZ || z > shape.mouthHighZ) { assert.ok(attrs.sea.across[coast] < .0001); trueShores++; }
    if (z > shape.mouthLowZ + 6 && z < shape.mouthHighZ - 6) {
      const half = attrs.channel.halfWidth[0], t = (z - shape.mouthLowZ) / (shape.mouthHighZ - shape.mouthLowZ);
      const across = attrs.channel.across[0] * (1 - t) + attrs.channel.across[1] * t;
      assert.ok(Math.abs(attrs.sea.across[coast] - ealdholtWaterShoreDistance(across, half)) < .0001, 'sea and channel mouth share the same distance to real banks');
      assert.ok(attrs.sea.across[coast] > 6, 'no shallow stripe is invented across the mouth'); openMouth++;
    }
  }
  assert.ok(trueShores > 5 && openMouth > 1);
  for (const start of [0, attrs.sea.across.length - 2]) assert.ok(ealdholtWaterShoreDistance((attrs.sea.across[start] + attrs.sea.across[start + 1]) / 2, -1) > 6, 'open north/south cuts do not become shore bands');
});

test('regional contact optics compose with existing PBR ripple and neutral-light hooks without new samplers or alpha', () => {
  const baseVertex = '#include <common>\n#include <begin_vertex>', chunks = ['common', 'map_fragment', 'color_fragment', 'alphamap_fragment', 'alphatest_fragment', 'roughnessmap_fragment', 'normal_fragment_maps', 'lights_physical_fragment', 'lights_fragment_maps', 'opaque_fragment'];
  for (const first of ['shore', 'ripples'] as const) {
    const retained = { value: 7 }, shader = { uniforms: { retained } as Record<string, { value: unknown }>, vertexShader: baseVertex, fragmentShader: chunks.map(name => `#include <${name}>`).join('\n') };
    const ripples = () => patchEaldholtWaterRipples(shader, { time: { value: 3 }, metresPerWorldUnit: { value: 1 }, worldToSource: { value: {} }, sourceToWorldRotation: { value: {} } });
    if (first === 'shore') { patchEaldholtWaterShoreColor(shader); ripples(); } else { ripples(); patchEaldholtWaterShoreColor(shader); }
    patchEaldholtNeutralFill(shader);
    assert.equal(shader.uniforms.retained, retained);
    assert.match(shader.fragmentShader, /CROWNFALL_POND_RIPPLES/); assert.match(shader.fragmentShader, /CROWNFALL_IBL_NEUTRAL_FILL/);
    assert.match(shader.fragmentShader, /smoothstep\(0\.15, 6\.0, ealdholtShoreDistance\)/, 'float GLSL overloads require a float literal even for an integral metre limit');
    assert.deepEqual(shader.uniforms.uEaldholtShoreContactLinearColor.value, EALDHOLT_WATER_SHORE_LOOK.contactLinearColor);
    assert.match(shader.fragmentShader, /roughnessFactor = mix\(roughnessFactor, max\(roughnessFactor, 0\.62\), ealdholtShoreContact\)/);
    assert.ok(shader.fragmentShader.indexOf('float ealdholtShoreContact') < shader.fragmentShader.indexOf('roughnessFactor = mix('), 'the mask exists before map-less and mapped roughness');
    for (const name of chunks) assert.ok(shader.fragmentShader.includes(`#include <${name}>`));
    assert.equal((shader.vertexShader.match(/attribute float ealdholtWater/g) ?? []).length, 2);
    assert.doesNotMatch(shader.fragmentShader, /discard|gl_FragDepth|diffuseColor\.a\s*=|sampler2D|texture2D/);
    const before = structuredClone(shader); patchEaldholtWaterShoreColor(shader); assert.deepEqual(shader, before);
  }
});

test('only the regional shader reduces the weather sky replacement at the real bank contact, including map-less fallback', () => {
  const vertexShader = '#include <common>\n#include <begin_vertex>\n#include <worldpos_vertex>';
  const fragmentShader = ['common', 'map_fragment', 'color_fragment', 'roughnessmap_fragment', 'normal_fragment_maps', 'lights_physical_fragment', 'lights_fragment_end'].map(name => `#include <${name}>`).join('\n');
  for (const weatherFirst of [false, true]) {
    const shader = {uniforms: {} as Record<string, {value: unknown}>, vertexShader, fragmentShader};
    if (weatherFirst) patchWorldEnvironmentMaterial(shader, {}, false, true);
    patchEaldholtWaterShoreColor(shader);
    if (!weatherFirst) patchWorldEnvironmentMaterial(shader, {}, false, true);
    assert.equal((shader.fragmentShader.match(/^\s*#define CROWNFALL_COASTAL_WATER_SHORE_COLOR\b/gm) ?? []).length, 1, 'a weather #ifdef is not the applied shore #define');
    assert.deepEqual(shader.uniforms.uEaldholtShallowLinearColor?.value, EALDHOLT_WATER_SHORE_LOOK.shallowLinearColor);
    assert.deepEqual(shader.uniforms.uEaldholtShoreContactLinearColor?.value, EALDHOLT_WATER_SHORE_LOOK.contactLinearColor);
    for (const attribute of ['ealdholtWaterAcross', 'ealdholtWaterHalfWidth']) assert.equal((shader.vertexShader.match(new RegExp(`attribute float ${attribute};`, 'g')) ?? []).length, 1);
    assert.equal((shader.vertexShader.match(/varying vec2 vEaldholtWaterShore;/g) ?? []).length, 1);
    assert.equal((shader.fragmentShader.match(/varying vec2 vEaldholtWaterShore;/g) ?? []).length, 1);
    assert.equal((shader.fragmentShader.match(/uniform vec3 uEaldholtShallowLinearColor;/g) ?? []).length, 1);
    assert.equal((shader.fragmentShader.match(/uniform vec3 uEaldholtShoreContactLinearColor;/g) ?? []).length, 1);
    assert.match(shader.fragmentShader, /#ifdef CROWNFALL_COASTAL_WATER_SHORE_COLOR[\s\S]*cfWaterSkyMix\*=1\.-ealdholtShoreContact;/);
    const declaration = shader.fragmentShader.indexOf('float ealdholtShoreContact'), use = shader.fragmentShader.indexOf('cfWaterSkyMix*=1.');
    assert.ok(declaration >= 0 && use >= 0 && declaration < use, 'a present contact mask precedes its use in either patch order');
    const rain = shader.fragmentShader.indexOf('roughnessFactor=mix(roughnessFactor,.31,cfRain*.6)'), floor = shader.fragmentShader.indexOf('roughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.62)'), material = shader.fragmentShader.indexOf('#include <lights_physical_fragment>');
    assert.ok(rain >= 0 && floor > rain && material > floor, 'both orders apply final contact roughness after rain, before physical material assembly');
    assert.match(shader.fragmentShader, /float cfFresnel=pow\(1\.-clamp\(dot\(normal,normalize\(vViewPosition\)\),0\.,1\.\),5\.\)/, 'existing live sky Fresnel remains intact');
    assert.equal((shader.fragmentShader.match(/sampler[23]D/g) ?? []).length, 1, 'only the pre-existing cloud sampler; water contact adds none');
    const before = structuredClone(shader); patchEaldholtWaterShoreColor(shader); assert.deepEqual(shader, before, 'second shore application remains idempotent in both orders');
  }
  const pond = {uniforms: {}, vertexShader, fragmentShader};
  patchWorldEnvironmentMaterial(pond, {}, false, true);
  assert.doesNotMatch(pond.fragmentShader, /#define CROWNFALL_COASTAL_WATER_SHORE_COLOR|float ealdholtShoreContact/);
  assert.equal(EALDHOLT_WATER_SHORE_CACHE_KEY, ':ealdholt-original-shore-colour:v3-contact', 'only the live material program key changes');
});

test('invalid shape and mismatched strips reject without rewriting source or partially patching a shader', () => {
  const data = createEaldholtCoastalValleyBuffers(fixture(), 'quest');
  for (const mutation of ['bank', 'level', 'order', 'sea-bound'] as const) {
    const invalid = structuredClone(data);
    if (mutation === 'bank') invalid.channel.positions[2] += 2;
    if (mutation === 'level') invalid.sea.positions[1] += 1;
    if (mutation === 'order') invalid.shape.coastSamples[2] = invalid.shape.coastSamples[0];
    if (mutation === 'sea-bound') invalid.sea.positions[0] -= 2;
    const before = structuredClone(invalid);
    assert.throws(() => createEaldholtCoastalWaterShoreAttributes(invalid.shape, invalid.channel, invalid.sea), /water|Channel|Sea|Coastal/);
    assert.deepEqual(invalid, before);
  }
  for (const fragmentShader of ['#include <common>\nmissing-colour-seam', '#include <common>\n#include <color_fragment>\nmissing-roughness-seam', '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\nmissing-physical-material-seam']) {
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader }, before = structuredClone(shader);
    assert.throws(() => patchEaldholtWaterShoreColor(shader), /standard PBR/); assert.deepEqual(shader, before, 'validate every required PBR seam before mutating the owned shader');
  }
  for (const values of [[NaN, 1], [1, 0], [1, -2]]) assert.throws(() => ealdholtWaterShoreDistance(values[0], values[1]), /Invalid/);
});

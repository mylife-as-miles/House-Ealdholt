import { applyEaldholtNeutralFill } from './neutral-fill';
import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, EquirectangularReflectionMapping, FloatType, Group, LinearSRGBColorSpace,
  Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Texture, Vector3 } from 'three';
import { applyEaldholtBorrowedPondProbe } from './pond-probe-texture';
import { applyEaldholtWaterLook } from './water-look';
import { skipsEaldholtProbeNeutralFill, type EaldholtPondProbeIdentity } from '../../../../shared/legacy/aethelgard/environment/pond-probe';

const identity: EaldholtPondProbeIdentity = { version: 1, profile: 'quest', modelSha256: 'a'.repeat(64),
  lightingVersion: 'fixture-v1', sourceAxes: true, neutralFillAlreadyBaked: true, realtime: false };
const options = { identity, expected: { profile: identity.profile, modelSha256: identity.modelSha256, lightingVersion: identity.lightingVersion } };
function makeTexture(): Texture {
  const texture = new Texture({ width: 512, height: 256 }); texture.mapping = EquirectangularReflectionMapping;
  texture.type = FloatType; texture.colorSpace = LinearSRGBColorSpace; return texture;
}

test('local probe owns only pond material clones, preserves ripple hooks and returns exact assignments', () => {
  const root = new Group(), geometry = new BoxGeometry(), pondSource = new MeshStandardMaterial(), troughSource = new MeshStandardMaterial();
  pondSource.name = 'Crownfall_Pond_Water_Review'; troughSource.name = 'Crownfall_Trough_Water_Review';
  const pond = new Mesh(geometry, pondSource), mixed = new Mesh(geometry, [troughSource, pondSource]); root.add(pond, mixed);
  const sky = makeTexture(), local = makeTexture(), water = applyEaldholtWaterLook(root, sky);
  const original = pond.material as MeshPhysicalMaterial, originalMixed = mixed.material;
  let borrowedDisposals = 0; sky.addEventListener('dispose', () => borrowedDisposals++); local.addEventListener('dispose', () => borrowedDisposals++);
  original.addEventListener('dispose', () => borrowedDisposals++); geometry.addEventListener('dispose', () => borrowedDisposals++);
  const sourceVersion = local.version, binding = applyEaldholtBorrowedPondProbe(root, local, options);
  const replacement = pond.material as MeshPhysicalMaterial;
  assert.equal(binding.materialCount, 1); assert.notEqual(replacement, original); assert.ok(replacement instanceof MeshPhysicalMaterial);
  assert.equal(replacement.envMap, local); assert.equal(replacement.envMapIntensity, 1); assert.equal(original.envMap, sky); assert.equal(original.envMapIntensity, .16);
  assert.equal(replacement.ior, original.ior); assert.equal(replacement.roughness, original.roughness);
  assert.equal(mixed.material[1], replacement); assert.equal(mixed.material[0], originalMixed[0]);
  assert.equal(replacement.onBeforeCompile, original.onBeforeCompile); assert.equal(replacement.customProgramCacheKey(), original.customProgramCacheKey());
  assert.equal(original.userData.crownfallWaterLook.noRecoveredTreeReflections, true);
  assert.equal(replacement.userData.crownfallWaterLook.localBakedPondProbe, true);
  assert.equal(skipsEaldholtProbeNeutralFill(replacement.userData), true); assert.equal(skipsEaldholtProbeNeutralFill(original.userData), false);
  assert.equal(local.version, sourceVersion); assert.equal(local.mapping, EquirectangularReflectionMapping);
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <normal_fragment_maps>' };
  const sourceShader = { ...shader, uniforms: {} as Record<string, { value: unknown }> };
  original.onBeforeCompile(sourceShader as Parameters<typeof original.onBeforeCompile>[0], {} as Parameters<typeof original.onBeforeCompile>[1]);
  replacement.onBeforeCompile(shader as Parameters<typeof replacement.onBeforeCompile>[0], {} as Parameters<typeof replacement.onBeforeCompile>[1]);
  assert.equal(shader.uniforms.uEaldholtRippleTime, sourceShader.uniforms.uEaldholtRippleTime);
  water.update(3.5, true); assert.equal(shader.uniforms.uEaldholtRippleTime.value, 0, 'late loading anchors the phase');
  water.update(3.55, true); assert.ok(Math.abs(Number(shader.uniforms.uEaldholtRippleTime.value) - .05) < 1e-10);
  const timeUniform = shader.uniforms.uEaldholtRippleTime;
  root.rotation.set(.1, Math.PI / 2, -.06); root.scale.setScalar(.02); root.position.set(8, -.7, -3.8); binding.update();
  const basis = new Matrix4().makeRotationFromEuler(replacement.envMapRotation), expectedBasis = new Matrix4().extractRotation(root.matrixWorld);
  for (const point of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) {
    assert.ok(point.clone().applyMatrix4(basis).distanceTo(point.clone().applyMatrix4(expectedBasis)) < 1e-12);
  }
  assert.equal(shader.uniforms.uEaldholtRippleTime, timeUniform);
  water.update(3.6, true); assert.ok(Math.abs(Number(timeUniform.value) - .1) < 1e-10, 'probe rotation retains the live bounded phase');
  let ownedDisposals = 0; replacement.addEventListener('dispose', () => ownedDisposals++);
  binding.dispose(); binding.dispose(); binding.update();
  assert.equal(ownedDisposals, 1); assert.equal(borrowedDisposals, 0); assert.equal(pond.material, original); assert.equal(mixed.material, originalMixed);
  water.dispose(); geometry.dispose(); pondSource.dispose(); troughSource.dispose(); sky.dispose(); local.dispose();
});

test('isolated flat-normal control preserves borrowed maps and the source ripple clock', () => {
  const root = new Group(), geometry = new BoxGeometry(), source = new MeshStandardMaterial();
  source.name = 'Crownfall_Pond_Water_Review'; source.normalMap = new Texture();
  const pond = new Mesh(geometry, source); root.add(pond);
  const sky = makeTexture(), local = makeTexture(), water = applyEaldholtWaterLook(root, sky);
  const prior = pond.material, binding = applyEaldholtBorrowedPondProbe(root, local, { ...options, flatNormalControl: true });
  const selected = pond.material as MeshPhysicalMaterial;
  assert.equal(selected.normalMap, null); assert.equal((prior as MeshPhysicalMaterial).normalMap, source.normalMap);
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <normal_fragment_maps>\n#include <lights_physical_fragment>' };
  const sourceShader = { ...shader, uniforms: {} as Record<string, { value: unknown }> };
  (prior as MeshPhysicalMaterial).onBeforeCompile(sourceShader as Parameters<typeof selected.onBeforeCompile>[0], {} as Parameters<typeof selected.onBeforeCompile>[1]);
  selected.onBeforeCompile(shader as Parameters<typeof selected.onBeforeCompile>[0], {} as Parameters<typeof selected.onBeforeCompile>[1]);
  assert.ok(shader.fragmentShader.indexOf('nonPerturbedNormal = normal;') > shader.fragmentShader.indexOf('vec2 ealdholtSlope'));
  assert.ok(shader.fragmentShader.indexOf('nonPerturbedNormal = normal;') < shader.fragmentShader.indexOf('#include <lights_physical_fragment>'));
  assert.equal(shader.uniforms.uEaldholtRippleTime, sourceShader.uniforms.uEaldholtRippleTime);
  water.update(2.5, true); assert.equal(shader.uniforms.uEaldholtRippleTime.value, 0, 'flat-normal mode retains the late-load phase anchor');
  water.update(2.55, true); assert.ok(Math.abs(Number(shader.uniforms.uEaldholtRippleTime.value) - .05) < 1e-10);
  binding.dispose(); assert.equal(pond.material, prior); water.dispose(); assert.equal(pond.material, source);
  source.normalMap.dispose(); source.dispose(); geometry.dispose(); sky.dispose(); local.dispose();
});

test('probe binding refuses stale/LDR/second-neutral inputs and leaves newer assignments untouched', () => {
  const root = new Group(), geometry = new BoxGeometry(), source = new MeshStandardMaterial(); source.name = 'Crownfall_Pond_Water_Review';
  const pond = new Mesh(geometry, source); root.add(pond); const texture = makeTexture();
  assert.throws(() => applyEaldholtBorrowedPondProbe(root, texture, { ...options, expected: { ...options.expected, modelSha256: 'b'.repeat(64) } }), /stale/);
  texture.colorSpace = 'srgb'; assert.throws(() => applyEaldholtBorrowedPondProbe(root, texture, options), /linear HDR/); texture.colorSpace = LinearSRGBColorSpace;
  source.userData.crownfallNeutralIbl = { linearMix: .7 };
  assert.throws(() => applyEaldholtBorrowedPondProbe(root, texture, options), /before neutral fill/); assert.equal(pond.material, source);
  delete source.userData.crownfallNeutralIbl;
  const binding = applyEaldholtBorrowedPondProbe(root, texture, options), newer = new MeshStandardMaterial();
  pond.material = newer; binding.dispose(); assert.equal(pond.material, newer);
  newer.dispose(); geometry.dispose(); source.dispose(); texture.dispose();
});

test('partial probe assignment rolls back and disposes only its owned clones after a later material guard fails', () => {
  const root = new Group(), geometry = new BoxGeometry(), first = new MeshStandardMaterial(), second = new MeshStandardMaterial(), texture = makeTexture();
  first.name = second.name = 'Crownfall_Pond_Water_Review'; second.userData.crownfallNeutralIbl = { linearMix: .7 };
  const a = new Mesh(geometry, first), b = new Mesh(geometry, second); root.add(a, b);
  let borrowedDisposals = 0; for (const material of [first, second]) material.addEventListener('dispose', () => borrowedDisposals++);
  texture.addEventListener('dispose', () => borrowedDisposals++);
  assert.throws(() => applyEaldholtBorrowedPondProbe(root, texture, options), /before neutral fill/);
  assert.equal(a.material, first); assert.equal(b.material, second); assert.equal(borrowedDisposals, 0);
  root.remove(a, b); assert.throws(() => applyEaldholtBorrowedPondProbe(root, texture, options), /surface is absent/);
  geometry.dispose(); first.dispose(); second.dispose(); texture.dispose();
});


test('neutral lighting leaves baked pond radiance intact and layer teardown restores exact owners', () => {
  const root = new Group(), geometry = new BoxGeometry(), pondSource = new MeshStandardMaterial(), stoneSource = new MeshStandardMaterial();
  pondSource.name = 'Crownfall_Pond_Water_Review';
  const pond = new Mesh(geometry, pondSource), stone = new Mesh(geometry, stoneSource); root.add(pond, stone);
  const sky = makeTexture(), local = makeTexture(), water = applyEaldholtWaterLook(root, sky), waterMaterial = pond.material;
  let borrowedDisposals = 0; for (const item of [sky, local, pondSource, stoneSource, geometry]) item.addEventListener('dispose', () => borrowedDisposals++);
  const probe = applyEaldholtBorrowedPondProbe(root, local, options), probeMaterial = pond.material;
  const neutral = applyEaldholtNeutralFill(root);
  assert.equal(neutral.materialCount, 1); assert.equal(pond.material, probeMaterial); assert.notEqual(stone.material, stoneSource);
  assert.equal(pond.material.envMap, local); assert.equal(pond.material.userData.crownfallNeutralIbl, undefined);
  neutral.dispose(); assert.equal(pond.material, probeMaterial); assert.equal(stone.material, stoneSource);
  probe.dispose(); assert.equal(pond.material, waterMaterial);
  water.dispose(); assert.equal(pond.material, pondSource); assert.equal(borrowedDisposals, 0);
  geometry.dispose(); pondSource.dispose(); stoneSource.dispose(); sky.dispose(); local.dispose();
});

test('optional calm-pond roughness changes only owned pond clones and preserves default mirror calibration', () => {
  const root = new Group(), geometry = new BoxGeometry(), normal = new Texture();
  const pondSource = new MeshPhysicalMaterial({ roughness: .24, ior: 1.333, normalMap: normal, alphaTest: .2, transparent: true, opacity: .65 });
  const troughSource = new MeshPhysicalMaterial({ roughness: .37 }), riverSource = new MeshPhysicalMaterial({ roughness: .53 });
  pondSource.name = 'Crownfall_Pond_Water_Review'; troughSource.name = 'Crownfall_Trough_Water_Review'; riverSource.name = 'Regional river surface';
  const mesh = new Mesh(geometry, [pondSource, troughSource, riverSource]); root.add(mesh);
  const texture = makeTexture(), assignments = mesh.material;
  let borrowedDisposals = 0;
  for (const borrowed of [geometry, normal, texture, pondSource, troughSource, riverSource]) borrowed.addEventListener('dispose', () => borrowedDisposals++);
  for (const roughness of [NaN, Infinity, -.01, 1.01]) {
    assert.throws(() => applyEaldholtBorrowedPondProbe(root, texture, { ...options, roughness }), /roughness/);
    assert.equal(mesh.material, assignments);
  }
  for (const roughness of [0, .10, 1]) {
    const binding = applyEaldholtBorrowedPondProbe(root, texture, { ...options, roughness });
    const clone = mesh.material[0] as MeshPhysicalMaterial;
    assert.equal(clone.roughness, roughness); assert.equal(pondSource.roughness, .24);
    assert.equal(clone.ior, pondSource.ior); assert.equal(clone.normalMap, normal);
    assert.equal(clone.alphaTest, pondSource.alphaTest); assert.equal(clone.opacity, pondSource.opacity); assert.equal(clone.transparent, pondSource.transparent);
    assert.equal(clone.onBeforeCompile, pondSource.onBeforeCompile); assert.equal(clone.customProgramCacheKey, pondSource.customProgramCacheKey);
    assert.equal(clone.envMapIntensity, 1); assert.equal(mesh.material[1], troughSource); assert.equal(mesh.material[2], riverSource);
    let cloneDisposals = 0; clone.addEventListener('dispose', () => cloneDisposals++);
    binding.dispose(); binding.dispose(); assert.equal(cloneDisposals, 1); assert.equal(mesh.material, assignments); assert.equal(borrowedDisposals, 0);
  }
  pondSource.roughness = 0;
  const mirror = applyEaldholtBorrowedPondProbe(root, texture, options);
  assert.equal((mesh.material[0] as MeshPhysicalMaterial).roughness, 0, 'omitted override retains the calibration mirror');
  mirror.dispose(); assert.equal(mesh.material, assignments); assert.equal(pondSource.roughness, 0); assert.equal(borrowedDisposals, 0);
  geometry.dispose(); normal.dispose(); texture.dispose(); pondSource.dispose(); troughSource.dispose(); riverSource.dispose();
});

test('inherited normal attenuation is pond-clone-only, default preserving, and keeps the analytic ripple clock', () => {
  const root = new Group(), geometry = new BoxGeometry(), normal = new Texture();
  const pondSource = new MeshPhysicalMaterial({ normalMap: normal }), troughSource = new MeshPhysicalMaterial({ normalMap: normal });
  const riverSource = new MeshPhysicalMaterial({ normalMap: normal, roughness: .53 });
  pondSource.name = 'Crownfall_Pond_Water_Review'; troughSource.name = 'Crownfall_Trough_Water_Review'; riverSource.name = 'Regional river surface';
  const mesh = new Mesh(geometry, [pondSource, troughSource, riverSource]); root.add(mesh);
  const sky = makeTexture(), local = makeTexture(), water = applyEaldholtWaterLook(root, sky);
  const assignments = mesh.material, base = assignments[0] as MeshPhysicalMaterial;
  base.normalScale.set(.75, -.5); const sourceScale = base.normalScale.toArray();
  let borrowedDisposals = 0;
  for (const borrowed of [geometry, normal, sky, local, pondSource, troughSource, riverSource, base]) borrowed.addEventListener('dispose', () => borrowedDisposals++);
  for (const normalScaleMultiplier of [NaN, Infinity, -.01, 1.01]) {
    assert.throws(() => applyEaldholtBorrowedPondProbe(root, local, { ...options, normalScaleMultiplier }), /normal-scale/);
    assert.equal(mesh.material, assignments); assert.deepEqual(base.normalScale.toArray(), sourceScale);
  }
  const sourceShader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <normal_fragment_maps>' };
  base.onBeforeCompile(sourceShader as Parameters<typeof base.onBeforeCompile>[0], {} as Parameters<typeof base.onBeforeCompile>[1]);
  water.update(3.5, true); assert.equal(sourceShader.uniforms.uEaldholtRippleTime.value, 0);
  let elapsed = 3.5;
  for (const factor of [undefined, 0, .12, 1]) {
    const binding = applyEaldholtBorrowedPondProbe(root, local, { ...options, roughness: .10, normalScaleMultiplier: factor });
    const clone = mesh.material[0] as MeshPhysicalMaterial, expected = sourceScale.map(value => value * (factor ?? 1));
    assert.equal(binding.normalScaleMultiplier, factor ?? 1); assert.deepEqual(binding.normalScales, [expected]);
    assert.ok(Object.isFrozen(binding.normalScales)); assert.ok(Object.isFrozen(binding.normalScales[0]));
    assert.notEqual(clone.normalScale, base.normalScale); assert.deepEqual(clone.normalScale.toArray(), expected);
    assert.deepEqual(base.normalScale.toArray(), sourceScale); assert.equal(clone.normalMap, normal); assert.equal(clone.ior, base.ior);
    assert.equal(clone.opacity, base.opacity); assert.equal(clone.alphaTest, base.alphaTest); assert.equal(clone.transparent, base.transparent);
    assert.equal(clone.onBeforeCompile, base.onBeforeCompile); assert.equal(clone.envMapIntensity, 1);
    assert.equal(mesh.material[1], assignments[1]); assert.equal(mesh.material[2], riverSource);
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <normal_fragment_maps>' };
    clone.onBeforeCompile(shader as Parameters<typeof clone.onBeforeCompile>[0], {} as Parameters<typeof clone.onBeforeCompile>[1]);
    assert.equal(shader.uniforms.uEaldholtRippleTime, sourceShader.uniforms.uEaldholtRippleTime, 'each probe clone retains the source clock uniform');
    const previousPhase = Number(shader.uniforms.uEaldholtRippleTime.value);
    elapsed += .05; water.update(elapsed, true);
    assert.ok(Math.abs(Number(shader.uniforms.uEaldholtRippleTime.value) - previousPhase - .05) < 1e-10);
    let cloneDisposals = 0; clone.addEventListener('dispose', () => cloneDisposals++);
    binding.dispose(); binding.dispose(); assert.equal(cloneDisposals, 1); assert.equal(borrowedDisposals, 0);
    assert.equal(mesh.material, assignments); assert.deepEqual(base.normalScale.toArray(), sourceScale);
  }
  water.dispose(); geometry.dispose(); normal.dispose(); sky.dispose(); local.dispose(); pondSource.dispose(); troughSource.dispose(); riverSource.dispose();
});

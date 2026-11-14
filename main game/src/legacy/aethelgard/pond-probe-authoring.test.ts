import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Color, DataUtils, Group, Mesh, MeshStandardMaterial, NoToneMapping,
  Vector3, Vector4, type WebGLRenderer } from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { inspectEaldholtPondProbeSurfaces, withEaldholtProbeCaptureState } from './pond-probe-authoring';
import { encodeEaldholtProbeHdr } from '../../../../shared/legacy/aethelgard/environment/pond-probe-hdr';

test('the public Three HDR loader accepts encoded linear radiance and top-down scanlines', () => {
  const rgba = new Float32Array(8 * 2 * 4);
  for (let x = 0; x < 8; x++) { rgba.set([12.5, 2, .5, 1], x * 4); rgba.set([.25, .5, 1, 1], (8 + x) * 4); }
  const bytes = encodeEaldholtProbeHdr(rgba, 8, 2), parsed = new HDRLoader().parse(bytes.buffer as ArrayBuffer);
  assert.equal(parsed.width, 8); assert.equal(parsed.height, 2);
  const data = parsed.data as Uint16Array;
  // The public loader's RGBE-to-half conversion can differ by one mantissa
  // quantum. Check preserved radiance, row orientation and HDR range together.
  for (const [offset, expected] of [[0, .25], [2, 1], [8 * 4, 12.5]]) {
    assert.ok(Math.abs(DataUtils.fromHalfFloat(data[offset]) - expected) < expected * .005);
  }
});

test('capture surface inspection uses actual pond source frame without touching geometry or props', () => {
  const parent = new Group(), root = new Group(); parent.add(root); parent.rotation.set(.1, .9, 0); parent.position.set(3, 4, 5); root.scale.setScalar(.02);
  const geometry = new BoxGeometry(4, .02, 6), pondMaterial = new MeshStandardMaterial(), stone = new MeshStandardMaterial();
  pondMaterial.name = 'Crownfall_Pond_Water_Review'; const pond = new Mesh(geometry, pondMaterial as MeshStandardMaterial | MeshStandardMaterial[]); pond.position.set(10, 1, -12);
  const prop = new Mesh(geometry, stone); prop.position.set(-100, 50, 0); root.add(pond, prop);
  assert.equal(geometry.boundingBox, null); const measured = inspectEaldholtPondProbeSurfaces(root);
  assert.deepEqual(measured.surfaces, [pond]); assert.ok(measured.sourcePosition.distanceTo(new Vector3(10, 1.05, -12)) < 1e-7);
  assert.equal(geometry.boundingBox, null); assert.ok(Math.abs(measured.worldScale - .02) < 1e-12); assert.equal(pond.visible, true); assert.equal(prop.visible, true);
  pond.material = [pondMaterial, stone]; assert.throws(() => inspectEaldholtPondProbeSurfaces(root), /mixed/);
  geometry.dispose(); pondMaterial.dispose(); stone.dispose();
});

test('capture restores public renderer state and exact visibility even when an operation throws', () => {
  const viewport = new Vector4(1, 2, 900, 600), scissor = new Vector4(3, 4, 500, 400), clear = new Color(.2, .3, .4);
  const originalTarget = {}, originalTone = 4; let target: unknown = originalTarget, face = 3, mip = 2, scissorTest = true, alpha = .4;
  const renderer = {
    xr: { enabled: false, isPresenting: false }, toneMapping: originalTone, toneMappingExposure: 1.3, outputColorSpace: 'srgb',
    autoClear: false, autoClearColor: false, autoClearDepth: true, autoClearStencil: false,
    getRenderTarget: () => target, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    getViewport: (out: Vector4) => out.copy(viewport), getScissor: (out: Vector4) => out.copy(scissor), getScissorTest: () => scissorTest,
    getClearColor: (out: Color) => out.copy(clear), getClearAlpha: () => alpha,
    setRenderTarget: (value: unknown, nextFace: number, nextMip: number) => { target = value; face = nextFace; mip = nextMip; },
    setViewport: (out: Vector4) => viewport.copy(out), setScissor: (out: Vector4) => scissor.copy(out), setScissorTest: (value: boolean) => { scissorTest = value; },
    setClearColor: (out: Color, value: number) => { clear.copy(out); alpha = value; },
  };
  const water = new Group(), hiddenWater = new Group(), prop = new Group(); hiddenWater.visible = false;
  assert.throws(() => withEaldholtProbeCaptureState(renderer as unknown as WebGLRenderer, [water, hiddenWater], () => {
    assert.equal(renderer.toneMapping, NoToneMapping); assert.equal(renderer.toneMappingExposure, 1); assert.equal(renderer.outputColorSpace, 'srgb-linear');
    assert.equal(water.visible, false); assert.equal(hiddenWater.visible, false); assert.equal(prop.visible, true);
    viewport.set(0, 0, 128, 128); scissor.set(0, 0, 10, 10); scissorTest = false;
    clear.setRGB(1, 1, 1); target = {}; face = 0; mip = 0; throw Error('fixture readback failure');
  }), /readback failure/);
  assert.equal(target, originalTarget); assert.equal(face, 3); assert.equal(mip, 2);
  assert.deepEqual(viewport.toArray(), [1, 2, 900, 600]); assert.deepEqual(scissor.toArray(), [3, 4, 500, 400]); assert.equal(scissorTest, true);
  assert.deepEqual(clear.toArray(), [.2, .3, .4]); assert.equal(alpha, .4); assert.equal(renderer.toneMapping, originalTone); assert.equal(renderer.outputColorSpace, 'srgb');
  assert.equal(renderer.toneMappingExposure, 1.3); assert.equal(renderer.autoClear, false); assert.equal(renderer.autoClearStencil, false);
  assert.equal(water.visible, true); assert.equal(hiddenWater.visible, false);
  renderer.xr.enabled = true; let called = false;
  assert.throws(() => withEaldholtProbeCaptureState(renderer as unknown as WebGLRenderer, [], () => { called = true; }), /non-XR/); assert.equal(called, false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { DataTexture, Float32BufferAttribute, FloatType, Group, LinearMipmapLinearFilter, Material, Mesh,
  MeshBasicMaterial, MeshDepthMaterial, MeshStandardMaterial, PlaneGeometry, RGBAFormat,
  SRGBColorSpace, Texture, UnsignedByteType } from 'three';
import { applyEaldholtFoliageCoverageMips, readFoliageRgbaPixels, type FoliageRgbaPixels } from './foliage-coverage-mips';
import { applyEaldholtNeutralFill } from './neutral-fill';

function fixture() {
  const rgba = Uint8Array.from({ length: 4 * 4 * 4 }, (_, i) => i % 4 === 3 ? (Math.floor(i / 4) % 3 === 0 ? 255 : 0) : [30, 110, 60][i % 4]);
  const map = new DataTexture(rgba, 4, 4, RGBAFormat, UnsignedByteType); map.name = 'borrowed Forest05 map'; map.colorSpace = SRGBColorSpace;
  map.channel = 2; map.flipY = true; map.wrapS = 1000; map.wrapT = 1002; map.minFilter = LinearMipmapLinearFilter; map.anisotropy = 3;
  map.repeat.set(1.01, 0.99); map.offset.set(0.1, -0.2); map.center.set(0.25, 0.5); map.rotation = 0.17; map.updateMatrix(); map.matrixAutoUpdate = false;
  const material = new MeshStandardMaterial({ map, alphaTest: 0.3333, vertexColors: true }); material.name = 'Elderbloom_material_33';
  const normal = new Texture(); material.normalMap = normal;
  const geometry = new PlaneGeometry(), mesh = new Mesh<PlaneGeometry, Material | Material[]>(geometry, material), root = new Group(); mesh.name = 'SM_BlackAlder_Forest_05_PP3'; root.add(mesh);
  const depth = new MeshDepthMaterial(); mesh.customDepthMaterial = depth; mesh.castShadow = mesh.receiveShadow = true;
  return { root, mesh, map, material, geometry, normal, depth, rgba, pixels: { rgba, width: 4, height: 4, identityScope: 'injected-rgba8' as const },
    cleanup() { geometry.dispose(); material.dispose(); map.dispose(); normal.dispose(); depth.dispose(); } };
}

test('manual RGBA8 mip textures own their Source and preserve borrowed pixels, UV metadata, callbacks and shadows', async () => {
  const f = fixture(), image = f.map.source.data, sourceVersion = f.map.version, imageVersion = f.map.source.version, matrix = f.map.matrix.clone(), before = f.rgba.slice();
  let compiled = 0, rendered = 0, borrowedDisposals = 0;
  f.material.onBeforeCompile = function () { compiled++; }; f.material.onBeforeRender = function () { rendered++; };
  f.material.customProgramCacheKey = function () { return 'fixture:' + this.vertexColors; };
  for (const resource of [f.map, f.material, f.geometry, f.normal, f.depth]) resource.addEventListener('dispose', () => borrowedDisposals++);
  const handle = await applyEaldholtFoliageCoverageMips(f.root), material = f.mesh.material as MeshStandardMaterial, map = material.map as DataTexture;
  assert.deepEqual([handle.materialCount, handle.textureCount, handle.sourceMapCount, handle.mipLevelCount, handle.extraTextureBytes], [1, 1, 1, 3, 84]);
  assert.ok(map instanceof DataTexture); assert.notEqual(map.source, f.map.source); assert.notEqual(map.source.data, image);
  assert.equal(map.format, RGBAFormat); assert.equal(map.type, UnsignedByteType); assert.equal(map.colorSpace, SRGBColorSpace);
  assert.equal(map.generateMipmaps, false); assert.deepEqual(map.mipmaps.map(mip => [mip.width, mip.height]), [[4, 4], [2, 2], [1, 1]]);
  assert.deepEqual(map.image.data, before); assert.notEqual(map.image.data.buffer, f.rgba.buffer);
  assert.equal((map.mipmaps[0] as { data: Uint8Array }).data, map.image.data);
  assert.equal(map.channel, f.map.channel); assert.equal(map.flipY, f.map.flipY); assert.equal(map.minFilter, f.map.minFilter); assert.equal(map.magFilter, f.map.magFilter);
  assert.equal(map.wrapS, f.map.wrapS); assert.equal(map.wrapT, f.map.wrapT); assert.equal(map.anisotropy, 3); assert.equal(map.rotation, f.map.rotation);
  for (const key of ['repeat', 'offset', 'center'] as const) { assert.deepEqual(map[key].toArray(), f.map[key].toArray()); assert.notEqual(map[key], f.map[key]); }
  assert.deepEqual(map.matrix.elements, matrix.elements); assert.equal(map.matrixAutoUpdate, false);
  assert.equal(material.onBeforeCompile, f.material.onBeforeCompile); assert.equal(material.onBeforeRender, f.material.onBeforeRender); assert.equal(material.customProgramCacheKey, f.material.customProgramCacheKey);
  assert.equal(material.customProgramCacheKey(), f.material.customProgramCacheKey()); (material.onBeforeCompile as () => void)(); (material.onBeforeRender as () => void)(); assert.deepEqual([compiled, rendered], [1, 1]);
  assert.equal(material.vertexColors, true); assert.equal(material.normalMap, f.normal); assert.equal(f.mesh.customDepthMaterial, f.depth); assert.equal(f.mesh.castShadow, true); assert.equal(f.mesh.receiveShadow, true);
  assert.equal(f.material.map, f.map); assert.equal(f.map.source.data, image); assert.equal(f.map.version, sourceVersion); assert.equal(f.map.source.version, imageVersion); assert.deepEqual(f.rgba, before);
  let disposedMaterials = 0, disposedMaps = 0; material.addEventListener('dispose', () => disposedMaterials++); map.addEventListener('dispose', () => disposedMaps++);
  handle.dispose(); handle.dispose(); assert.equal(handle.disposed, true); assert.equal(f.mesh.material, f.material);
  assert.deepEqual([disposedMaterials, disposedMaps, borrowedDisposals], [1, 1, 0]); f.cleanup();
});

test('cache is per source-map/cutoff, pixel decode is shared, and non-foliage assignments stay borrowed', async () => {
  const f = fixture(), second = f.material.clone(); second.alphaTest = 0.6;
  const other = new Mesh(f.geometry, f.material); other.name = 'Banner fabric'; f.root.add(other);
  const original = [f.material, second, f.material]; f.mesh.material = original;
  let reads = 0; const handle = await applyEaldholtFoliageCoverageMips(f.root, { readPixels: async () => { reads++; return f.pixels; } });
  const materials = f.mesh.material as MeshStandardMaterial[];
  assert.deepEqual([reads, handle.materialCount, handle.textureCount, handle.sourceMapCount], [1, 2, 2, 1]);
  assert.equal(materials[0], materials[2]); assert.notEqual(materials[0].map, materials[1].map); assert.equal(other.material, f.material);
  handle.dispose(); assert.equal(f.mesh.material, original); assert.equal(other.material, f.material); second.dispose(); f.cleanup();
});

test('disposal restores only owned clones and preserves foreign array edits or complete replacements', async () => {
  const f = fixture(), untouched = new MeshStandardMaterial(), foreign = new MeshStandardMaterial(), another = new Mesh(f.geometry, f.material);
  another.name = f.mesh.name; f.root.add(another); const original = [f.material, untouched, f.material]; f.mesh.material = original;
  const handle = await applyEaldholtFoliageCoverageMips(f.root), assigned = f.mesh.material as Material[];
  assigned[1] = foreign; another.material = foreign;
  handle.dispose(); assert.deepEqual(f.mesh.material, [f.material, foreign, f.material]); assert.equal(another.material, foreign);
  assert.deepEqual(original, [f.material, untouched, f.material]); untouched.dispose(); foreign.dispose(); f.cleanup();
});

test('neutral fill borrows the owned map and unwinds before the coverage owner', async () => {
  const f = fixture(), coverage = await applyEaldholtFoliageCoverageMips(f.root), owned = f.mesh.material as MeshStandardMaterial;
  const neutral = applyEaldholtNeutralFill(f.root), final = f.mesh.material as MeshStandardMaterial;
  let mapDisposals = 0; owned.map!.addEventListener('dispose', () => mapDisposals++);
  assert.notEqual(final, owned); assert.equal(final.map, owned.map);
  neutral.dispose(); assert.equal(f.mesh.material, owned); assert.equal(mapDisposals, 0);
  coverage.dispose(); assert.equal(f.mesh.material, f.material); assert.equal(mapDisposals, 1); f.cleanup();
});

test('unsupported alpha/texture inputs and tainted or invalid readbacks skip with diagnostics and no source changes', async () => {
  for (const fault of ['opacity', 'alphaMap', 'blend', 'vertex-alpha', 'compressed', 'float', 'linear', 'texture-hook', 'taint', 'invalid-rgba'] as const) {
    const f = fixture(); let reads = 0, borrowedDisposals = 0;
    f.map.addEventListener('dispose', () => borrowedDisposals++); f.material.addEventListener('dispose', () => borrowedDisposals++);
    if (fault === 'opacity') f.material.opacity = 0.8;
    if (fault === 'alphaMap') f.material.alphaMap = f.map;
    if (fault === 'blend') f.material.transparent = true;
    if (fault === 'vertex-alpha') {
      const color = new Float32BufferAttribute(new Array(f.geometry.getAttribute('position').count * 4).fill(1), 4);
      color.setW(0, 0.8); f.geometry.setAttribute('color', color);
    }
    if (fault === 'compressed') (f.map as unknown as { isCompressedTexture: boolean }).isCompressedTexture = true;
    if (fault === 'float') f.map.type = FloatType;
    if (fault === 'linear') f.map.colorSpace = '';
    if (fault === 'texture-hook') f.map.onUpdate = () => { throw Error('borrowed hook must not run'); };
    const handle = await applyEaldholtFoliageCoverageMips(f.root, { readPixels: async () => {
      reads++; if (fault === 'taint') throw Object.assign(new Error('Tainted readback'), { name: 'SecurityError' });
      return fault === 'invalid-rgba' ? { ...f.pixels, width: 9 } : f.pixels;
    } });
    assert.equal(handle.materialCount, 0, fault); assert.equal(handle.textureCount, 0, fault); assert.equal(f.mesh.material, f.material, fault);
    assert.ok(handle.diagnostics.length > 0, fault); assert.equal(reads, ['taint', 'invalid-rgba'].includes(fault) ? 1 : 0, fault);
    handle.dispose(); assert.equal(borrowedDisposals, 0, fault); f.cleanup();
  }
});

test('unit RGBA vertex alpha remains eligible without changing color attributes', async () => {
  const f = fixture(), color = new Float32BufferAttribute(new Array(f.geometry.getAttribute('position').count * 4).fill(1), 4);
  f.geometry.setAttribute('color', color); const before = color.array.slice();
  const handle = await applyEaldholtFoliageCoverageMips(f.root);
  assert.equal(handle.materialCount, 1); assert.equal((f.mesh.material as MeshStandardMaterial).vertexColors, true);
  assert.equal(f.geometry.getAttribute('color'), color); assert.deepEqual(color.array, before);
  handle.dispose(); f.cleanup();
});

test('opaque maps skip allocation and explicit selection can keep every material borrowed', async () => {
  const f = fixture(); f.rgba.forEach((_, i) => { if (i % 4 === 3) f.rgba[i] = 255; });
  const opaque = await applyEaldholtFoliageCoverageMips(f.root); assert.equal(opaque.textureCount, 0); assert.equal(opaque.diagnostics[0].code, 'trivial-coverage'); opaque.dispose();
  let reads = 0; const excluded = await applyEaldholtFoliageCoverageMips(f.root, { selectMaterial: () => false, readPixels: async () => { reads++; return f.pixels; } });
  assert.equal(reads, 0); assert.equal(excluded.materialCount, 0); excluded.dispose(); f.cleanup();
});

test('cancellation and concurrent owners leave no late assignments and permit a clean retry', async () => {
  const f = fixture(), controller = new AbortController(); let finish!: (pixels: FoliageRgbaPixels) => void;
  const pending = applyEaldholtFoliageCoverageMips(f.root, { signal: controller.signal, readPixels: () => new Promise(resolve => { finish = resolve; }) });
  assert.equal(f.mesh.material, f.material);
  await assert.rejects(applyEaldholtFoliageCoverageMips(f.root), /ownership is already active/);
  controller.abort(); finish(f.pixels); await assert.rejects(pending, /aborted/i); assert.equal(f.mesh.material, f.material);
  const retry = await applyEaldholtFoliageCoverageMips(f.root); assert.equal(retry.materialCount, 1); retry.dispose(); f.cleanup();
});

test('foreign changes during asynchronous preparation are never overwritten', async () => {
  const f = fixture(), foreign = new MeshStandardMaterial(); let finish!: (pixels: FoliageRgbaPixels) => void;
  const pending = applyEaldholtFoliageCoverageMips(f.root, { readPixels: () => new Promise(resolve => { finish = resolve; }) });
  f.mesh.material = foreign; finish(f.pixels); const handle = await pending;
  assert.equal(handle.materialCount, 0); assert.equal(handle.textureCount, 0); assert.equal(f.mesh.material, foreign);
  assert.ok(handle.diagnostics.some(d => d.code === 'assignment-changed')); handle.dispose(); assert.equal(f.mesh.material, foreign); foreign.dispose(); f.cleanup();
});

test('a material-clone failure rolls back atomically and releases staged owned resources once', async () => {
  const f = fixture(), bad = f.material.clone(), original = [f.material, bad]; f.mesh.material = original;
  let materialDisposals = 0, textureDisposals = 0, borrowedDisposals = 0;
  f.map.addEventListener('dispose', () => borrowedDisposals++); f.material.addEventListener('dispose', () => borrowedDisposals++);
  const clone = f.material.clone.bind(f.material);
  f.material.clone = () => {
    const result = clone(); let map = result.map; result.addEventListener('dispose', () => materialDisposals++);
    Object.defineProperty(result, 'map', { configurable: true, get: () => map, set: (value: Texture) => { map = value; if (value !== f.map) value.addEventListener('dispose', () => textureDisposals++); } }); return result;
  };
  bad.clone = () => { throw Error('clone rejected'); };
  await assert.rejects(applyEaldholtFoliageCoverageMips(f.root), /clone rejected/);
  assert.equal(f.mesh.material, original); assert.deepEqual([materialDisposals, textureDisposals, borrowedDisposals], [1, 1, 0]);
  bad.dispose(); f.cleanup();
});

test('two-row bitmap/HTML replacements preserve effective upload orientation and clean readback on taint', async () => {
  const previous = new Map(['ImageBitmap', 'HTMLImageElement', 'OffscreenCanvas'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let closes = 0, taint = false;
  const bytes = new Uint8ClampedArray([12, 23, 34, 0, 45, 56, 67, 255]);
  class Bitmap { width = 1; height = 2; close() { closes++; } }
  class HtmlImage { width = 1; height = 2; naturalWidth = 1; naturalHeight = 2; complete = true; }
  const bitmap = new Bitmap(), html = new HtmlImage(), canvases: Canvas[] = [];
  class Canvas {
    constructor(public width: number, public height: number) { canvases.push(this); }
    getContext() { return {
      drawImage: (...args: unknown[]) => { assert.ok(args[0] === bitmap || args[0] === html); assert.deepEqual(args.slice(1), [0, 0]); },
      getImageData: () => { if (taint) throw Object.assign(Error('tainted'), { name: 'SecurityError' }); return { data: bytes }; },
    }; }
  }
  try {
    Object.defineProperty(globalThis, 'ImageBitmap', { value: Bitmap, configurable: true });
    Object.defineProperty(globalThis, 'HTMLImageElement', { value: HtmlImage, configurable: true });
    Object.defineProperty(globalThis, 'OffscreenCanvas', { value: Canvas, configurable: true });
    const map = new Texture(); map.source.data = bitmap; map.flipY = true;
    const pixels = await readFoliageRgbaPixels(map);
    assert.deepEqual([pixels.width, pixels.height, pixels.identityScope], [1, 2, 'canvas-srgb-readback']);
    assert.deepEqual([...pixels.rgba], [...bytes]); assert.notEqual(pixels.rgba.buffer, bytes.buffer);
    for (const image of [bitmap, html]) {
      const f = fixture(), source = new Texture(); source.source.data = image; source.flipY = true; source.colorSpace = SRGBColorSpace;
      f.material.map = source;
      const handle = await applyEaldholtFoliageCoverageMips(f.root), owned = (f.mesh.material as MeshStandardMaterial).map as DataTexture;
      assert.equal(handle.textureCount, 1); assert.deepEqual(owned.image.data, new Uint8Array(bytes));
      assert.equal(owned.flipY, image === bitmap ? false : true); assert.equal(source.flipY, true); assert.equal(source.source.data, image);
      handle.dispose(); source.dispose(); f.cleanup();
    }
    taint = true; await assert.rejects(readFoliageRgbaPixels(map), /tainted/);
    assert.equal(closes, 0); assert.equal(map.source.data, bitmap); assert.equal(map.flipY, true);
    assert.deepEqual(canvases.map(canvas => [canvas.width, canvas.height]), [[0, 0], [0, 0], [0, 0], [0, 0]]); map.dispose();
  } finally {
    for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});

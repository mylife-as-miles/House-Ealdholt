import assert from 'node:assert/strict';
import test from 'node:test';
import { assertResidentPreviewTextures } from './resident-preview-textures';

function fixture() {
  const texture = () => ({ isTexture: true, image: { width: 512, height: 512 } });
  const material = { map: texture(), roughnessMap: texture(), metalnessMap: texture(), normalMap: texture() };
  const definition = { pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } }, normalTexture: { index: 2 } };
  const value = { scene: { traverse(callback: (node: unknown) => void) { callback({ isMesh: true, material }); callback({ isMesh: true, material }); } },
    parser: { json: { materials: [definition] }, associations: new Map<unknown, unknown>([[material, { materials: 0 }]]) } };
  return { value, material, definition };
}
test('declared decoded PBR slots are checked once per shared material without changing the decoder data', () => {
  const f = fixture(), before = JSON.stringify(f.material), image = f.material.map.image;
  assert.deepEqual(assertResidentPreviewTextures(f.value), { materials: 1, textureBindings: 4 });
  assert.equal(JSON.stringify(f.material), before); assert.equal(f.material.map.image, image);
});
test('resolved shapes with missing or partially decoded texture maps cannot become ready', () => {
  for (const property of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
    const f = fixture(); (f.material as unknown as Record<string, unknown>)[property] = null;
    assert.throws(() => assertResidentPreviewTextures(f.value), /undecoded/);
  }
  const f = fixture(); f.material.map.image.width = 0; assert.throws(() => assertResidentPreviewTextures(f.value), /undecoded/);
  const noAssociations = fixture(); noAssociations.value.parser.associations.clear();
  assert.throws(() => assertResidentPreviewTextures(noAssociations.value), /association/);
});
test('extension bindings are verified while genuinely untextured default material remains valid', () => {
  const f = fixture(); (f.definition as unknown as Record<string, unknown>).extensions = { KHR_materials_sheen: { sheenColorTexture: { index: 3 } } };
  assert.throws(() => assertResidentPreviewTextures(f.value), /sheenColorMap/);
  (f.material as unknown as Record<string, unknown>).sheenColorMap = f.material.map;
  assert.equal(assertResidentPreviewTextures(f.value).textureBindings, 5);
  const material = { color: 'synthetic' }, value = { scene: { traverse(cb: (node: unknown) => void) { cb({ isMesh: true, material }); } }, parser: { json: {}, associations: new Map() } };
  assert.deepEqual(assertResidentPreviewTextures(value), { materials: 1, textureBindings: 0 });
});
test('iridescence, anisotropy and bump maps cannot silently pass after decode failure', () => {
  for (const [extension, slot, property] of [
    ['KHR_materials_iridescence', 'iridescenceTexture', 'iridescenceMap'],
    ['KHR_materials_iridescence', 'iridescenceThicknessTexture', 'iridescenceThicknessMap'],
    ['KHR_materials_anisotropy', 'anisotropyTexture', 'anisotropyMap'],
    ['EXT_materials_bump', 'bumpTexture', 'bumpMap'],
  ]) {
    const f = fixture(); (f.definition as unknown as Record<string, unknown>).extensions = { [extension]: { [slot]: { index: 3 } } };
    assert.throws(() => assertResidentPreviewTextures(f.value), /undecoded/);
    (f.material as unknown as Record<string, unknown>)[property] = f.material.map;
    assert.equal(assertResidentPreviewTextures(f.value).textureBindings, 5);
  }
});

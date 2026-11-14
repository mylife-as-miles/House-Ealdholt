import assert from "node:assert/strict";
import test from "node:test";
import { applyEaldholtExportRepairsToMeshes, EALDHOLT_SHEEN_ROUGHNESS_FLOOR, isEaldholtZeroSheenRoughnessImage, patchEaldholtSheenRoughnessShader, type EaldholtRepairAdapter } from "../aethelgard/export-repairs";

type Material = { id: number; intensity: number; disposed: boolean };
const WALL = "S_Mossy_Stone_Wall_ukhgdfyga_lod3_Var1";
test("failed material preparation rolls back assignments and disposes only created clones", () => {
  const first = { id: 1, intensity: 1, disposed: false }, second = { id: 2, intensity: 1, disposed: false };
  const meshes = [{ name: WALL, material: first }, { name: WALL, material: second }], clones: Material[] = [];
  const image = { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) };
  const adapter: EaldholtRepairAdapter<Material> = {
    fingerprint: m => ({ materialName: "Elderbloom_material_14", baseImageName: "Elderbloom_surface_41", normalImageName: "Elderbloom_surface_43",
      roughnessImageName: "Elderbloom_surface_42", metalnessImageName: "Elderbloom_surface_42", aoImageName: "Elderbloom_surface_44", channels: [0, 0, 0, 0, 0], aoIntensity: m.intensity }),
    aoImage: () => image,
    clone: m => { if (m.id === 2) throw new Error("clone failure"); const clone = { ...m }; clones.push(clone); return clone; },
    disableAo: m => { m.intensity = 0; }, dispose: m => { m.disposed = true; },
  };
  assert.throws(() => applyEaldholtExportRepairsToMeshes(meshes, adapter), /clone failure/);
  assert.equal(meshes[0].material, first); assert.equal(meshes[1].material, second);
  assert.equal(first.intensity, 1); assert.equal(first.disposed, false); assert.equal(second.disposed, false);
  assert.equal(clones.length, 1); assert.equal(clones[0].disposed, true);
});

test("post-map sheen floor prevents Charlie's zero-roughness singularity while preserving valid roughness", () => {
  // Published Three r185 D_Charlie: zero roughness makes invAlpha infinite.
  function charlie(roughness: number, dotNH: number): number {
    const invAlpha = 1 / (roughness * roughness), sin2h = Math.max(1 - dotNH * dotNH, 0.0078125);
    return (2 + invAlpha) * Math.pow(sin2h, invAlpha * .5) / (2 * Math.PI);
  }
  assert.equal(Number.isFinite(charlie(0, .5)), false);
  for (const roughness of [0, 1e-8, .001, .02, .069, .07, .15, .5, 1]) {
    const guarded = Math.max(roughness, EALDHOLT_SHEEN_ROUGHNESS_FLOOR);
    for (const cosine of [0, .2, .5, .9, 1]) assert.ok(Number.isFinite(charlie(guarded, cosine)));
    if (roughness >= .07) assert.equal(guarded, roughness);
  }
  const shader = { fragmentShader: 'before\n#include <lights_physical_fragment>\nafter' };
  patchEaldholtSheenRoughnessShader(shader);
  const result = shader.fragmentShader;
  assert.ok(result.indexOf('material.sheenRoughness = max') > result.indexOf('#include <lights_physical_fragment>'));
  assert.ok(result.includes('#ifdef USE_SHEEN'));
  patchEaldholtSheenRoughnessShader(shader); assert.equal(shader.fragmentShader, result);
  assert.throws(() => patchEaldholtSheenRoughnessShader({ fragmentShader: 'missing material setup' }), /one physical-light/);
  assert.throws(() => patchEaldholtSheenRoughnessShader({ fragmentShader: '#include <lights_physical_fragment>\n#include <lights_physical_fragment>' }), /one physical-light/);
});

test("only audited-size RGBA sheen maps with real zero alpha need the roughness floor", () => {
  for (const size of [128, 256]) {
    const data = new Uint8Array(size * size * 4).fill(255);
    assert.equal(isEaldholtZeroSheenRoughnessImage({ width: size, height: size, data }), false);
    data[3] = 0;
    assert.equal(isEaldholtZeroSheenRoughnessImage({ width: size, height: size, data }), true);
  }
  assert.equal(isEaldholtZeroSheenRoughnessImage({ width: 1, height: 1, data: new Uint8Array(4) }), false);
  assert.equal(isEaldholtZeroSheenRoughnessImage({ width: 128, height: 128, data: new Uint8Array(4) }), false);
  assert.equal(isEaldholtZeroSheenRoughnessImage(null), false);
});

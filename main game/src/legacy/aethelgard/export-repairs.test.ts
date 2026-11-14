import assert from "node:assert/strict";
import test from "node:test";
import { BufferGeometry, DataTexture, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Texture } from "three";
import { applyEaldholtExportRepairs } from "./export-repairs";
import { isEaldholtZeroAoImage } from "../../../../shared/legacy/aethelgard/export-repairs";
import { matchesEaldholtZeroAoDefect } from "../../../../shared/legacy/aethelgard/export-repair-metadata";

const WALL = "S_Mossy_Stone_Wall_ukhgdfyga_lod3_Var1";
const GRAVE = "S_Mossy_Gravestone_wjuvdeuqx_lod3_Var1";
function texture(name: string): Texture { const texture = new Texture(); texture.name = name; return texture; }
function material(kind: "wall" | "grave" = "wall", native = false): MeshStandardMaterial {
  const ao = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); ao.name = "Elderbloom_surface_44";
  const mr = texture(kind === "wall" ? "Elderbloom_surface_42" : "Elderbloom_surface_80");
  const result = new MeshStandardMaterial({ color: 0x786e52, roughness: 0.87, metalness: 1,
    map: texture(kind === "wall" ? "Elderbloom_surface_41" : "Elderbloom_surface_79"),
    normalMap: texture(kind === "wall" ? "Elderbloom_surface_43" : "Elderbloom_surface_81"),
    roughnessMap: mr, metalnessMap: mr, aoMap: ao });
  result.name = `Elderbloom_material_${kind === "wall" ? native ? 13 : 14 : native ? 25 : 26}`;
  return result;
}
function mesh(name: string, m: MeshStandardMaterial): Mesh { const mesh = new Mesh(new BufferGeometry(), m); mesh.name = name; return mesh; }

test("repairs share owned clones and leave cached material, textures and unrelated meshes untouched", () => {
  const root = new Group(), original = material();
  const a = mesh(`${WALL}_cell_0_1`, original), b = mesh(`${WALL}_cell_1_1`, original), unrelated = mesh("Unrelated wall", original);
  root.add(a, b, unrelated);
  original.onBeforeCompile = () => {};
  original.customProgramCacheKey = () => "preserved-material-hook";
  let originalDisposes = 0, textureDisposes = 0, cloneDisposes = 0;
  original.addEventListener("dispose", () => originalDisposes++);
  for (const value of [original.map, original.normalMap, original.roughnessMap, original.aoMap]) value?.addEventListener("dispose", () => textureDisposes++);
  const handle = applyEaldholtExportRepairs(root), clone = a.material as MeshStandardMaterial;
  assert.equal(handle.ownedReplacementCount, 1); assert.notEqual(clone, original); assert.equal(b.material, clone); assert.equal(unrelated.material, original);
  assert.equal(original.aoMapIntensity, 1); assert.equal(clone.aoMapIntensity, 0);
  assert.equal(clone.onBeforeCompile, original.onBeforeCompile); assert.equal(clone.onBeforeRender, original.onBeforeRender); assert.equal(clone.customProgramCacheKey, original.customProgramCacheKey);
  for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap"] as const) assert.equal(clone[key], original[key]);
  assert.equal(clone.color.getHex(), original.color.getHex()); assert.equal(clone.roughness, original.roughness); assert.equal(clone.metalness, original.metalness);
  clone.addEventListener("dispose", () => cloneDisposes++);
  const duplicate = applyEaldholtExportRepairs(root); assert.equal(duplicate.ownedReplacementCount, 0); duplicate.dispose(); assert.equal(a.material, clone);
  handle.dispose(); handle.dispose();
  assert.equal(a.material, original); assert.equal(b.material, original); assert.equal(cloneDisposes, 1);
  assert.equal(originalDisposes, 0); assert.equal(textureDisposes, 0);
});

test("material arrays restore exact prior identity and preserve unaffected entries", () => {
  const root = new Group(), original = material(), other = new MeshBasicMaterial();
  const assignment = [original, other], wall = new Mesh(new BufferGeometry(), assignment); wall.name = WALL; root.add(wall);
  const handle = applyEaldholtExportRepairs(root);
  assert.notEqual(wall.material, assignment); assert.equal(wall.material[1], other); assert.equal(assignment[0], original);
  handle.dispose(); assert.equal(wall.material, assignment);
});

test("only proven fallback AO with the exact mesh/map/UV binding is repaired", () => {
  for (const mutate of [
    (m: MeshStandardMaterial) => { (m.aoMap!.image as { data: Uint8Array }).data[0] = 1; },
    (m: MeshStandardMaterial) => { m.aoMap!.name = "Actual authored AO"; },
    (m: MeshStandardMaterial) => { m.normalMap!.channel = 1; },
    (m: MeshStandardMaterial) => { m.map!.name = "Different material"; },
    (m: MeshStandardMaterial) => { m.aoMapIntensity = 0.5; },
  ]) {
    const root = new Group(), original = material(), wall = mesh(WALL, original); mutate(original); root.add(wall);
    const handle = applyEaldholtExportRepairs(root); assert.equal(handle.ownedReplacementCount, 0); assert.equal(wall.material, original); handle.dispose();
  }
  assert.equal(isEaldholtZeroAoImage({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) }), true);
  assert.equal(isEaldholtZeroAoImage({ width: 2, height: 1, data: new Uint8Array(8) }), false);
  assert.equal(isEaldholtZeroAoImage({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) }), false);
});

test("Desktop and Native generated bindings repair only the two audited asset families", () => {
  for (const native of [false, true]) {
    const root = new Group(), wallOriginal = material("wall", native), graveOriginal = material("grave", native);
    const wall = mesh(WALL, wallOriginal), grave = mesh(`${GRAVE}_cell_-1_2`, graveOriginal); root.add(wall, grave);
    const handle = applyEaldholtExportRepairs(root); assert.equal(handle.ownedReplacementCount, 2);
    assert.equal((wall.material as MeshStandardMaterial).aoMapIntensity, 0); assert.equal((grave.material as MeshStandardMaterial).aoMapIntensity, 0);
    handle.dispose(); assert.equal(wall.material, wallOriginal); assert.equal(grave.material, graveOriginal);
  }
  assert.equal(matchesEaldholtZeroAoDefect("Unrelated mesh", {
    materialName: "Elderbloom_material_14", baseImageName: "Elderbloom_surface_41", normalImageName: "Elderbloom_surface_43",
    roughnessImageName: "Elderbloom_surface_42", metalnessImageName: "Elderbloom_surface_42", aoImageName: "Elderbloom_surface_44", channels: [0, 0, 0, 0, 0], aoIntensity: 1,
  }), false);
});

test("disposing an older repair never overwrites a newer external assignment", () => {
  const root = new Group(), original = material(), wall = mesh(WALL, original); root.add(wall);
  const handle = applyEaldholtExportRepairs(root), external = new MeshStandardMaterial();
  wall.material = external; handle.dispose(); assert.equal(wall.material, external); assert.equal(original.aoMapIntensity, 1);
});

function sheenMaterial(kind: "wall" | "grave", native = false): MeshPhysicalMaterial {
  const base = material(kind, native), size = native ? 128 : 256;
  const mask = new DataTexture(new Uint8Array(size * size * 4), size, size);
  mask.name = kind === "wall" ? "Elderbloom_surface_46" : "Elderbloom_surface_83";
  const result = new MeshPhysicalMaterial({ color: base.color, map: base.map, normalMap: base.normalMap,
    roughnessMap: base.roughnessMap, metalnessMap: base.metalnessMap, aoMap: base.aoMap,
    sheen: 1, sheenColor: 0xffffff, sheenRoughness: 1,
    sheenColorMap: texture(kind === "wall" ? "Elderbloom_surface_45" : "Elderbloom_surface_82"), sheenRoughnessMap: mask });
  result.name = base.name; base.dispose(); return result;
}

test("both audited sheen families preserve original maps, hooks and shadow reception on owned clones", () => {
  for (const native of [false, true]) for (const kind of ["wall", "grave"] as const) {
    const original = sheenMaterial(kind, native), root = new Group(), wall = mesh(kind === "wall" ? WALL : GRAVE, original);
    wall.receiveShadow = true; root.add(wall); let priorHookCalls = 0, borrowedDisposes = 0;
    original.onBeforeCompile = () => { priorHookCalls++; }; original.customProgramCacheKey = () => "prior-key";
    for (const texture of [original.sheenColorMap, original.sheenRoughnessMap]) texture!.addEventListener("dispose", () => borrowedDisposes++);
    const handle = applyEaldholtExportRepairs(root), clone = wall.material as MeshPhysicalMaterial;
    assert.equal(handle.ownedReplacementCount, 1); assert.equal(handle.sheenRoughnessFloorCount, 1);
    assert.equal(clone.sheen, original.sheen); assert.equal(clone.sheenRoughness, original.sheenRoughness);
    assert.equal(clone.sheenColorMap, original.sheenColorMap); assert.equal(clone.sheenRoughnessMap, original.sheenRoughnessMap);
    assert.equal(wall.receiveShadow, true); assert.ok(clone.customProgramCacheKey().startsWith("prior-key"));
    const shader = { fragmentShader: "#include <lights_physical_fragment>" };
    clone.onBeforeCompile(shader as never, {} as never);
    assert.equal(priorHookCalls, 1); assert.ok(shader.fragmentShader.includes("material.sheenRoughness = max(material.sheenRoughness, 0.07)"));
    assert.throws(() => clone.onBeforeCompile({ fragmentShader: "unrecognized shader" } as never, {} as never), /physical-light/);
    handle.dispose(); assert.equal(wall.material, original); assert.equal(borrowedDisposes, 0);
  }
});

test("unknown, valid nonzero or remapped sheen inputs retain only the existing AO repair", () => {
  for (const mutate of [
    (m: MeshPhysicalMaterial) => { m.sheenRoughnessMap!.name = "Different map"; },
    (m: MeshPhysicalMaterial) => { m.sheenColorMap!.channel = 1; },
    (m: MeshPhysicalMaterial) => { m.sheen = .5; },
    (m: MeshPhysicalMaterial) => { (m.sheenRoughnessMap!.image as { data: Uint8Array }).data.fill(255); },
  ]) {
    const original = sheenMaterial("wall"), root = new Group(), wall = mesh(WALL, original); mutate(original); root.add(wall);
    const handle = applyEaldholtExportRepairs(root), clone = wall.material as MeshPhysicalMaterial;
    assert.equal(handle.ownedReplacementCount, 1); assert.equal(handle.sheenRoughnessFloorCount, 0);
    assert.equal(clone.onBeforeCompile, original.onBeforeCompile); handle.dispose();
  }
});

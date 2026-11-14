import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { prepareBakedMeshes, disposeBakedGroup, flipLightmapRows } from "./environment";

test("uses UV1 lightmaps, parent vertex lighting and hides unbaked moss", () => {
  const root = new THREE.Group();
  const parent = new THREE.Group();
  parent.userData = { cf_vlit: "lit_albedo", cf_vscale: 8 };
  const plant = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ alphaTest: 0.4, side: THREE.DoubleSide }));
  parent.add(plant);
  const stone = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
  const moss = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
  moss.name = "Rock_MossShell_01";
  root.add(parent, stone, moss);
  const lightmap = new THREE.DataTexture();
  prepareBakedMeshes(root, lightmap);
  assert.equal(lightmap.channel, 1);
  assert.equal(lightmap.flipY, false);
  assert.equal(lightmap.colorSpace, THREE.LinearSRGBColorSpace);
  assert.equal(stone.material.lightMap, lightmap);
  assert.equal(stone.material.lightMapIntensity, Math.PI);
  const material = plant.material as unknown as THREE.MeshBasicMaterial;
  assert.equal(material.isMeshBasicMaterial, true);
  assert.equal(material.vertexColors, true);
  assert.equal(material.color.r, 8);
  assert.equal(material.alphaTest, 0.4);
  assert.equal(material.side, THREE.DoubleSide);
  assert.equal(moss.visible, false);
  assert.equal(stone.layers.mask, 2);
});

test("disposes shared GPU resources once on scene release", () => {
  const root = new THREE.Group();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, lightMap: texture });
  const geometry = new THREE.BufferGeometry();
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  const released: string[] = [];
  texture.addEventListener("dispose", () => released.push("texture"));
  material.addEventListener("dispose", () => released.push("material"));
  geometry.addEventListener("dispose", () => released.push("geometry"));
  disposeBakedGroup(root);
  assert.deepEqual(released.sort(), ["geometry", "material", "texture"]);
});

test("turns an EXR lightmap's rows the right way up for glTF's second UV set (A-02)", () => {
  // Three rows of two RGBA texels, as EXRLoader writes them: bottom row first.
  const data = new Uint16Array([1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3]);
  const lightmap = new THREE.DataTexture(data, 2, 3, THREE.RGBAFormat, THREE.HalfFloatType);
  flipLightmapRows(lightmap);
  assert.deepEqual(Array.from(data.filter((_, i) => i % 8 === 0)), [3, 2, 1]);
  assert.equal(data.length, 24);
  flipLightmapRows(new THREE.DataTexture()); // an empty texture is left alone
});

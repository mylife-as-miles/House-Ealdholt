import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { patchShader } from "./arena-kit";

const shader = () => ({ uniforms: {}, vertexShader: "", fragmentShader: "" }) as unknown as THREE.WebGLProgramParametersWithUniforms;

test("a change is made once per key, however many meshes share the material", () => {
  const material = new THREE.MeshStandardMaterial();
  const made: string[] = [];
  for (let mesh = 0; mesh < 10; mesh++) patchShader(material, "cf-look-fog", () => { made.push("fog"); });
  patchShader(material, "cf-surface", () => { made.push("surface"); });
  patchShader(material, "cf-look-fog", () => { made.push("fog again"); });

  assert.equal(material.customProgramCacheKey(), "cf-look-fog|cf-surface");
  material.onBeforeCompile(shader(), {} as THREE.WebGLRenderer);
  assert.deepEqual(made, ["fog", "surface"]);
});

test("two materials given the same changes in the same order share a program key", () => {
  const shared = new THREE.MeshStandardMaterial(), single = new THREE.MeshStandardMaterial();
  for (let mesh = 0; mesh < 4; mesh++) patchShader(shared, "cf-look-fog", () => {});
  patchShader(single, "cf-look-fog", () => {});
  assert.equal(shared.customProgramCacheKey(), single.customProgramCacheKey());
});

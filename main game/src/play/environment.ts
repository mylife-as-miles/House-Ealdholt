import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GamePortSetting } from "../../../shared/play/match";
import { buildBakedAtmosphere } from "./atmosphere";
import { loadExrTexture } from "./exr-texture";
import { createLoadProgress } from "./load-progress";
import { flipRowsInPlace } from "./lightmap-rows";

/**
 * Turns a decoded EXR lightmap the right way up for glTF's second UV set. EXRLoader writes rows bottom-up while the
 * glTF UVs are top-down, so as loaded about half of the lit scenery read a black part of the bake (A-02). The look
 * path has always flipped it; the baked-arena fallback now does too.
 */
export function flipLightmapRows(texture: THREE.DataTexture): void {
  const { data, height } = texture.image as { data: Uint16Array | Float32Array | null; height: number };
  flipRowsInPlace(data, height);
}

/** Layer 1 isolates scenery visibility; the shader excludes gameplay lighting. */
export function prepareBakedMeshes(root: THREE.Object3D, lightmap: THREE.DataTexture): void {
  lightmap.channel = 1;
  lightmap.flipY = false;
  lightmap.colorSpace = THREE.LinearSRGBColorSpace;
  lightmap.needsUpdate = true;
  const replaced = new Set<THREE.Material>();
  root.traverse((object) => {
    if (/MossShell/i.test(object.name)) object.visible = false;
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.layers.set(1);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const data = mesh.userData.cf_vlit ? mesh.userData : mesh.parent?.userData ?? {};
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const prepared = materials.map((source) => {
      const material = source as THREE.MeshStandardMaterial;
      if (data.cf_vlit) {
        const scale = Number(data.cf_vscale ?? 8);
        replaced.add(source);
        return new THREE.MeshBasicMaterial({
          name: material.name, map: material.map, vertexColors: true,
          color: new THREE.Color(scale, scale, scale), side: material.side,
          transparent: material.transparent, opacity: material.opacity, alphaTest: material.alphaTest,
        });
      }
      material.lightMap = lightmap;
      material.lightMapIntensity = Math.PI;
      // Three's light layers filter against the camera, not each mesh. Retain
      // the PBR/lightmap path while excluding the lamps that illuminate pieces.
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <lights_fragment_maps>", "irradiance = vec3(0.0);\n#include <lights_fragment_maps>")
          .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\nreflectedLight.directDiffuse = vec3(0.0);\nreflectedLight.directSpecular = vec3(0.0);\nreflectedLight.indirectSpecular = vec3(0.0);");
      };
      material.customProgramCacheKey = () => "crownfall-baked-only-v1";
      material.needsUpdate = true;
      return material;
    });
    mesh.material = Array.isArray(mesh.material) ? prepared : prepared[0];
  });
  // Maps remain owned by the replacement material, but the old material does not.
  for (const material of replaced) material.dispose();
}

export function disposeBakedGroup(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  for (const texture of textures) {
    const bitmap = texture.source.data as { close?: () => void } | undefined;
    bitmap?.close?.();
    texture.dispose();
  }
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  root.removeFromParent();
}

/**
 * The baked arena (the fallback when the look package is missing). `progress` follows the bytes of its four files;
 * `signal` calls the downloads off. The lightmaps are decoded off the main thread and turned the right way up there
 * (exr-texture.ts).
 */
export async function loadBakedEnvironment(setting: GamePortSetting, progress: (ratio: number) => void, signal?: AbortSignal): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = `gameport-${setting}`;
  // Exported metres -> game units. Board origin, size and indexing stay intact.
  group.scale.setScalar(1 / 2.3);
  const manager = new THREE.LoadingManager();
  const abort = () => manager.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const models = new GLTFLoader(manager);
  const bytes = createLoadProgress(progress);
  // Sequential groups bound peak decoding memory on the uncompressed handoff.
  try {
    for (const part of ["arena", "environment"]) {
      const base = `${import.meta.env.BASE_URL}gameport/${setting}/${part}`;
      const glb = bytes.file(`${base}.glb`, part === "arena" ? 71e6 : 202e6), exr = bytes.file(`${base}.exr`, part === "arena" ? 6e6 : 12e6);
      const results = await Promise.allSettled([
        models.loadAsync(`${base}.glb`, (event) => glb(event.loaded, event.total)),
        loadExrTexture(`${base}.exr`, { signal, flip: true, onProgress: exr }),
      ]);
      const [model, lightmap] = results;
      if (model.status === "rejected" || lightmap.status === "rejected") {
        if (model.status === "fulfilled") disposeBakedGroup(model.value.scene);
        if (lightmap.status === "fulfilled") lightmap.value.dispose();
        if (signal?.aborted) throw new DOMException("The load was called off.", "AbortError");
        const failure = model.status === "rejected" ? { file: `${base}.glb`, cause: model.reason } : lightmap.status === "rejected" ? { file: `${base}.exr`, cause: lightmap.reason } : null;
        console.error("[battlefield] asset failed", failure?.file, failure?.cause);
        throw new Error(`Could not load ${setting}/${part}: ${failure?.cause instanceof Error ? failure.cause.message : String(failure?.cause)}`, { cause: failure?.cause });
      }
      bytes.done(`${base}.glb`); bytes.done(`${base}.exr`);
      prepareBakedMeshes(model.value.scene, lightmap.value);
      group.add(model.value.scene);
    }
    group.add(buildBakedAtmosphere(setting));
    progress(1);
    return group;
  } catch (error) {
    disposeBakedGroup(group);
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

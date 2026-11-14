import * as THREE from "three";

/** What three keeps per material: one program per variant drawn (a bone mesh and a skinned mesh, ...). */
interface MaterialPrograms { programs?: Map<string, { getUniforms(): unknown }> }

/** Every material an object (and what it holds) draws with, collected now: a warm-up may take its stand-ins apart. */
export function materialsOf(object: THREE.Object3D): Set<THREE.Material> {
  const materials = new Set<THREE.Material>();
  object.traverse((node) => {
    const material = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) for (const entry of material) materials.add(entry);
    else if (material) materials.add(material);
  });
  return materials;
}

/**
 * Finishes the programs `compile`/`compileAsync` built for these materials, as their first draw otherwise would:
 * three only asks the driver whether a program linked, and where its uniforms are, on the first frame that draws
 * with it (WebGLProgram's onFirstUse). Without KHR_parallel_shader_compile (SwiftShader, some drivers and
 * browsers) `compileAsync` resolves at once and that question waits for the whole compile and link, on that
 * frame; with it, the question is cheaper but still a round of blocking calls per program (the link logs and one
 * call per uniform: hundreds for a lit material under many lights). Asked here instead, under a loading screen.
 */
export function finishPrograms(renderer: THREE.WebGLRenderer, materials: Iterable<THREE.Material>): void {
  for (const material of materials) {
    const programs = (renderer.properties.get(material) as MaterialPrograms).programs;
    programs?.forEach((program) => program.getUniforms());
  }
}

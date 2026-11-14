/** Read-only static source snapshot. Call before visual LOD/instance compaction
 * begins. Coordinates are source metres; display/tabletop transforms cancel. */
import {Box3, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, SRGBColorSpace, Vector3, type Object3D} from 'three';
import {staticSourceBounds} from './static-source-bounds';
import type {VoxelRegionSource, VoxelTerrainSource} from '../../../../shared/legacy/aethelgard/environment/voxel-source-index';
import type {VoxelSourceProxy} from '../../../../shared/legacy/aethelgard/environment/voxel-volume';
import {isVerifiedEaldholtWater} from '../../../../shared/legacy/aethelgard/environment/water-look';
export const VOXEL_SOURCE_VERSION = 'static-pbr-source-snapshot-v1';
const linear = (v: number) => v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);
const rounded = (v: number) => {const value = Math.round(v * 100000) / 100000; return Object.is(value, -0) ? 0 : value;};
export async function collectVoxelRegionSource(root: Object3D,
  identity: Pick<VoxelRegionSource, 'worldRegion' | 'sourceSha256' | 'generatorVersion' | 'backend'>, signal: AbortSignal) {
  signal.throwIfAborted(); root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert(), frame = new Matrix4(), actor = new Matrix4(), transform = new Matrix4(), point = new Vector3(), box = new Box3();
  const terrain: VoxelTerrainSource[] = [], proxies: VoxelSourceProxy[] = [];
  const meshes: {mesh: Mesh; geometry: Mesh['geometry']; material: MeshStandardMaterial; role: string; frame: Matrix4; matrices: Float32Array | null}[] = [];
  const colours = new Map<MeshStandardMaterial, {albedo: readonly [number, number, number]; coverage: number}>();
  const diagnostics = {meshes: 0, terrainChunks: 0, vertices: 0, proxies: 0, materialFallbacks: 0};
  function excluded(node: Object3D) {
    if ('isSkinnedMesh' in node || node.userData.crownfallTerrainVisualOnly) return true;
    for (let o: Object3D | null = node; o && o !== root; o = o.parent) {
      if (!o.visible || o.userData.crownfallTerrainStreaming) return true;
      // Dynamic hearth/atmosphere is live illumination, never static occupancy.
      if (o.name === 'House Ealdholt Hearth' || o.userData.crownfallVillageFire) return true;
    }
    return false;
  }
  function kind(node: Object3D) {
    for (let o: Object3D | null = node; o && o !== root; o = o.parent) {
      const k = o.userData.crownfallElderbloom?.kind;
      if (k) return k;
      if (/LandscapeComponent/.test(o.name)) return 'terrain';
      if (/Grass|flower|vmcob/i.test(o.name)) return 'groundcover';
      if (/BlackAlder|tree|canopy/i.test(o.name) || o.userData.crownfallRiverWoodland || o.userData.crownfallFarWoodland) return 'tree';
    }
    return 'architecture';
  }
  function reflectance(material: MeshStandardMaterial) {
    const cached = colours.get(material); if (cached) return cached;
    let rgb = [1, 1, 1], coverage = 1, measured = false;
    const texture = material.map, image = texture?.image;
    if (image && typeof document !== 'undefined') {
      try {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
        const context = canvas.getContext('2d', {willReadFrequently: true});
        if (context) {
          context.drawImage(image as CanvasImageSource, 0, 0, 16, 16); const pixels = context.getImageData(0, 0, 16, 16).data;
          const sum = [0, 0, 0]; let alpha = 0, kept = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            const a = pixels[i + 3] / 255; if (a < material.alphaTest) continue;
            kept++; alpha += a; for (let c = 0; c < 3; c++) sum[c] += (texture?.colorSpace === SRGBColorSpace ? linear(pixels[i + c] / 255) : pixels[i + c] / 255) * a;
          }
          if (alpha > 0) rgb = sum.map(n => n / alpha); else rgb = [0, 0, 0]; coverage = kept / 256; measured = true;
        }
      } catch { /* Compressed/opaque image formats retain the PBR base factor. */ }
    }
    if (texture && !measured) diagnostics.materialFallbacks++;
    const diffuse = Math.max(0, 1 - material.metalness), base = [material.color.r, material.color.g, material.color.b];
    const albedo = rgb.map((n, c) => Math.max(0, Math.min(1, n * base[c] * diffuse))) as [number, number, number];
    const value = {albedo, coverage}; colours.set(material, value); return value;
  }
  root.traverse(o => {
    if (o instanceof Mesh && !excluded(o) && o.material instanceof MeshStandardMaterial && !Object.keys(o.geometry.morphAttributes).length && o.geometry.getAttribute('position')) {
      meshes.push({mesh: o, geometry: o.geometry, material: o.material, role: kind(o), frame: new Matrix4().multiplyMatrices(inverse, o.matrixWorld),
        matrices: o instanceof InstancedMesh ? Float32Array.from(o.instanceMatrix.array) : null});
    }
  });
  if (meshes.length > 20000) throw Error('Static voxel source mesh budget exceeded.');
  for (let n = 0; n < meshes.length; n++) {
    signal.throwIfAborted(); const {mesh, material, role, geometry, matrices, frame: frozenFrame} = meshes[n];
    if (role === 'water' || isVerifiedEaldholtWater(material.name) || material.userData.crownfallWaterLook || material.userData.crownfallRiver) continue;
    const p = geometry.getAttribute('position'); frame.copy(frozenFrame);
    if (role === 'terrain') {
      if (mesh instanceof InstancedMesh) throw Error('Instanced terrain needs explicit static voxel ownership.');
      diagnostics.vertices += p.count; if (diagnostics.vertices > 2_000_000) throw Error('Voxel terrain snapshot exceeds its CPU budget.');
      const positions = new Float32Array(p.count * 3); box.makeEmpty();
      for (let start = 0; start < p.count; start += 8192) {
        for (let i = start; i < Math.min(p.count, start + 8192); i++) {
          point.fromBufferAttribute(p, i).applyMatrix4(frame); point.set(rounded(point.x), rounded(point.y), rounded(point.z));
          positions[i * 3] = point.x; positions[i * 3 + 1] = point.y; positions[i * 3 + 2] = point.z;
          point.fromArray(positions, i * 3); box.expandByPoint(point);
        }
        signal.throwIfAborted(); if (start + 8192 < p.count) await new Promise(resolve => setTimeout(resolve, 0));
      }
      const indices = geometry.index ? Uint32Array.from(geometry.index.array) : Uint32Array.from({length: p.count}, (_, i) => i);
      terrain.push({positions, indices, bounds: {min: box.min.toArray(), max: box.max.toArray()}}); diagnostics.terrainChunks++;
    } else {
      const local = staticSourceBounds(geometry), colour = reflectance(material), leaf = material.alphaTest > 0;
      const opacity = Math.max(0, Math.min(1, material.opacity * (leaf ? Math.max(.035, colour.coverage * .45) : role === 'tree' || role === 'vegetation' ? .18 : material.transparent ? .25 : 1)));
      const copies = matrices ? matrices.length / 16 : 1;
      for (let i = 0; i < copies; i++) {
        transform.copy(frame); if (matrices) {actor.fromArray(matrices, i * 16); transform.multiply(actor);}
        box.copy(local).applyMatrix4(transform);
        if (proxies.length >= 131072) throw Error('Static voxel proxy budget exceeded.');
        proxies.push({min: box.min.toArray().map(rounded) as [number, number, number], max: box.max.toArray().map(rounded) as [number, number, number], albedo: colour.albedo, opacity});
      }
    }
    diagnostics.meshes++; if (n % 32 === 31) await new Promise(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted(); diagnostics.proxies = proxies.length;
  return {source: {...identity, generatorVersion: identity.generatorVersion + ':' + VOXEL_SOURCE_VERSION, terrain, proxies} satisfies VoxelRegionSource, diagnostics};
}

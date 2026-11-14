/**
 * Fewer triangles for the arena's heaviest scenery, made when the look loads (zeux/meshoptimizer's simplifier, MIT).
 *
 * The arena is about 2.9 million triangles, and 41 sculpted meshes over 20k triangles carry 2.1 million of them (the
 * giant hand, the skulls, the roots, the abyss banks). On integrated graphics the frame waits on that geometry, not on
 * pixels: the UHD 630 at low quality ran no faster at half resolution. Each heavy mesh gets a new index buffer over its
 * own vertices, collapsing only edges whose loss stays under an error measured in pixels from the play camera: about
 * one pixel at medium, two at low, so its silhouette and its baked light (the lightmap and texture coordinates and the
 * vertex colours are weighed in) hold. Open edges are locked, so neighbouring meshes keep meeting without cracks.
 * Lava, skinned and morphing meshes are left alone. High quality keeps every triangle.
 */
import * as THREE from "three";
import { MeshoptSimplifier } from "meshoptimizer";

export interface SimplifyTier {
  /** Meshes lighter than this keep all their triangles. */
  minTriangles: number;
  /** At most this share of a mesh's triangles is kept (the error budget usually stops it first). */
  ratio: number;
  /** The allowed error, in radians seen from the board: ~0.0011 is one pixel of the play view at 778 rows. */
  angular: number;
}

export const ARENA_SIMPLIFY: Record<"medium" | "low", SimplifyTier> = {
  medium: { minTriangles: 20_000, ratio: 0.3, angular: 0.0011 },
  low: { minTriangles: 12_000, ratio: 0.2, angular: 0.0022 },
};

/** Not simplified: the lava (rebuilt by arena-lava.ts from these meshes) and anything that deforms. */
export function simplifiable(mesh: THREE.Mesh, tier: SimplifyTier): boolean {
  const g = mesh.geometry as THREE.BufferGeometry | undefined;
  if (!g?.index || !g.attributes.position || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return false;
  if (g.morphAttributes.position?.length || /Lava/i.test(`${mesh.name} ${mesh.parent?.name ?? ""}`)) return false;
  return g.index.count / 3 >= tier.minTriangles;
}

/** Ring radii in metres from the board's centre: the board is about 19 m across, the dais around it reaches ~15 m. */
const RINGS = [15, 40, 90];

// Rematches load the same arena: what was worked out once is kept for the page's life.
const made = new Map<string, Uint16Array | Uint32Array>();

/**
 * Simplifies the given meshes in place (their index buffers), yielding to the page between meshes. `root` is the
 * model the meshes belong to, with the board's centre at its origin. Returns the triangles before and after.
 */
export async function simplifyArenaMeshes(root: THREE.Object3D, meshes: THREE.Mesh[], tier: SimplifyTier): Promise<{ before: number; after: number; ms: number }> {
  const started = performance.now();
  let before = 0, after = 0;
  if (!meshes.length || !MeshoptSimplifier.supported) return { before, after, ms: 0 };
  await MeshoptSimplifier.ready;
  root.updateWorldMatrix(true, true);
  const toRoot = root.matrixWorld.clone().invert(), local = new THREE.Matrix4(), centre = new THREE.Vector3();
  for (const mesh of meshes) {
    const g = mesh.geometry as THREE.BufferGeometry, index = g.index!, position = g.attributes.position;
    const count = position.count;
    before += index.count / 3;
    // Where the mesh is, seen from the board's centre (the root's origin), in the root's units (metres).
    local.multiplyMatrices(toRoot, mesh.matrixWorld);
    if (!g.boundingSphere) g.computeBoundingSphere();
    const sphere = g.boundingSphere!, scale = Math.max(1e-6, local.getMaxScaleOnAxis());
    centre.copy(sphere.center).applyMatrix4(local);
    const reach = Math.max(2, centre.length() - sphere.radius * scale);
    const key = `${mesh.name}|${count}|${index.count}|${tier.ratio}|${tier.angular}`;
    let next = made.get(key);
    if (!next) {
      const positions = new Float32Array(count * 3), distance = new Float32Array(count), at = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        positions[i * 3] = position.getX(i); positions[i * 3 + 1] = position.getY(i); positions[i * 3 + 2] = position.getZ(i);
        distance[i] = at.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).applyMatrix4(local).length();
      }
      const channels: [THREE.BufferAttribute | THREE.InterleavedBufferAttribute, number, number][] = [];
      const uv = g.attributes.uv, uv1 = g.attributes.uv1, color = g.attributes.color;
      // How far each kept attribute may drift before it counts as much as the whole position budget: texture
      // coordinates by about four texels, the lightmap's by about one and a half (the baked light is sampled there),
      // the vertex colours (the baked light of vertex-lit meshes) by three percent.
      if (uv) channels.push([uv, 2, 0.004]);
      if (uv1) channels.push([uv1, 2, 0.0015]);
      if (color) channels.push([color, 3, 0.03]);
      const stride = channels.reduce((sum, [, size]) => sum + size, 0);
      const attributes = new Float32Array(Math.max(1, count * stride));
      for (let i = 0; i < count; i++) {
        let o = i * stride;
        for (const [attribute, size] of channels) {
          attributes[o++] = attribute.getX(i);
          attributes[o++] = attribute.getY(i);
          if (size === 3) attributes[o++] = attribute.getZ(i);
        }
      }
      let indices: Uint32Array = Uint32Array.from(index.array as ArrayLike<number>);
      const target = Math.floor((indices.length / 3) * tier.ratio) * 3;
      // In rings: everything nearer than a ring's radius is locked, and the rest may move by the pixel budget seen from
      // that radius. The dais around the board (within the first ring) is never touched; each ring further out is
      // allowed more, as the play camera sees it smaller.
      const lock = new Uint8Array(count);
      let lastFree = -1, lastError = -1;
      for (const radius of RINGS) {
        let free = 0;
        for (let i = 0; i < count; i++) { lock[i] = distance[i] < radius ? 1 : 0; free += 1 - lock[i]; }
        const error = (Math.max(radius, reach) * tier.angular) / scale;
        // nothing free, or the same vertices with the same budget as the ring before: nothing more to gain
        if (!free || (free === lastFree && error === lastError)) continue;
        lastFree = free; lastError = error;
        const weights: number[] = [];
        for (const [, size, tolerance] of channels) for (let k = 0; k < size; k++) weights.push(error / tolerance);
        // a ring before may already have gone a little under the target
        const goal = Math.min(target, indices.length);
        const [result] = stride
          ? MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attributes, stride, weights, lock, goal, error, ["LockBorder", "ErrorAbsolute"])
          : MeshoptSimplifier.simplify(indices, positions, 3, goal, error, ["LockBorder", "ErrorAbsolute"]);
        if (result.length < indices.length) indices = result;
      }
      next = indices.length >= index.count * 0.95 ? (index.array as Uint16Array | Uint32Array) : count < 65536 ? Uint16Array.from(indices) : indices;
      made.set(key, next);
    }
    if (next !== index.array) g.setIndex(new THREE.BufferAttribute(next, 1));
    after += g.index!.count / 3;
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) console.info(`[simplify] ${mesh.name} ${index.count / 3} -> ${g.index!.count / 3} (reach ${reach.toFixed(1)} m)`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { before: Math.round(before), after: Math.round(after), ms: Math.round(performance.now() - started) };
}

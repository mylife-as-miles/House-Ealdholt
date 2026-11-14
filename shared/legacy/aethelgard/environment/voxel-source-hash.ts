import type {VoxelRegionSource} from './voxel-source-index';
/** Content identity for generated surroundings as well as imported assets.
 * Explicit generator versions remain in the key, and an actual source-data
 * digest prevents old bakes surviving a forgotten generator-version bump. */
export async function hashVoxelRegionSource(source: VoxelRegionSource): Promise<string> {
  const hash = async (bytes: Uint8Array) => {
    const owned = Uint8Array.from(bytes);
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', owned)), n => n.toString(16).padStart(2, '0')).join('');
  };
  const chunks: unknown[] = [];
  for (const t of source.terrain) {
    const positions = await hash(new Uint8Array(t.positions.buffer, t.positions.byteOffset, t.positions.byteLength));
    const indices = await hash(new Uint8Array(t.indices.buffer, t.indices.byteOffset, t.indices.byteLength));
    chunks.push([positions, indices, t.bounds]);
  }
  return hash(new TextEncoder().encode(JSON.stringify([source.worldRegion, source.sourceSha256, source.generatorVersion, source.backend, chunks, source.proxies])));
}

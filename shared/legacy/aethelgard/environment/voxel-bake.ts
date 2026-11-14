import {validateVoxelGrid, type StaticVoxelVolume, type VoxelVolumeGrid} from './voxel-volume';
import type {WorldBakeBlob} from './world-bake-cache';
export interface VoxelBakeResult {key: string; volume: StaticVoxelVolume; sourceCounts: {terrain: number; proxies: number}}
/** Only static occupancy/transport is stored. No sun, radiance, GPU handles,
 * clock cursor, character record or imported asset buffer is serialized. */
export function encodeVoxelBake(value: VoxelBakeResult): WorldBakeBlob {
  const {volume, sourceCounts} = value; validateVoxelGrid(volume.grid);
  const count = volume.grid.resolution.reduce((n, v) => n * v, 1), channel = count * 4;
  if (volume.albedoOpacity.length !== channel || volume.transport.length !== channel) throw Error('Incomplete static voxel bake.');
  const data = new Uint8Array(channel * 2); data.set(volume.albedoOpacity); data.set(volume.transport, channel);
  const metadata = JSON.stringify({schema: 1, grid: volume.grid, occupiedVoxels: volume.occupiedVoxels, sourceCounts});
  const blob = {data, metadata}; if (!decodeVoxelBake(blob, value.key, volume.grid)) throw Error('Invalid static voxel bake.');
  return blob;
}
export function decodeVoxelBake(blob: WorldBakeBlob, key: string, expected: VoxelVolumeGrid): VoxelBakeResult | null {
  try {
    validateVoxelGrid(expected); const meta = JSON.parse(blob.metadata); validateVoxelGrid(meta.grid);
    if (meta.schema !== 1 || ['resolution', 'min', 'size'].some(field => meta.grid[field].some((n: number, i: number) => n !== expected[field as keyof VoxelVolumeGrid][i]))) return null;
    const count = expected.resolution.reduce((n, v) => n * v, 1), channel = count * 4;
    if (!(blob.data instanceof Uint8Array) || blob.data.length !== channel * 2 || !Number.isSafeInteger(meta.occupiedVoxels)
      || meta.occupiedVoxels < 0 || meta.occupiedVoxels > count || !meta.sourceCounts
      || !Number.isSafeInteger(meta.sourceCounts.terrain) || meta.sourceCounts.terrain < 0 || meta.sourceCounts.terrain > 256
      || !Number.isSafeInteger(meta.sourceCounts.proxies) || meta.sourceCounts.proxies < 0 || meta.sourceCounts.proxies > 131072) return null;
    // Independent arrays can safely transfer to the renderer without detaching
    // the IDB restoration record or another pending consumer.
    return {key, volume: {grid: expected, occupiedVoxels: meta.occupiedVoxels, albedoOpacity: blob.data.slice(0, channel), transport: blob.data.slice(channel)}, sourceCounts: meta.sourceCounts};
  } catch {return null;}
}

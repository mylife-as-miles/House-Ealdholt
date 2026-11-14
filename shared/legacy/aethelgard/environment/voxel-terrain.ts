import {validateVoxelGrid, type VoxelVolumeGrid} from './voxel-volume';
/** Worker-side samples of existing final terrain triangles, in source metres.
 * No procedural heightfield or reference-world erosion is substituted. The
 * original terrain remains the collision/navigation authority. */
export function sampleVoxelTerrainHeights(grid: VoxelVolumeGrid, surfaces: readonly {
  readonly positions: Float32Array | Float64Array; readonly indices: Uint32Array | Uint16Array;
}[]): Float32Array {
  validateVoxelGrid(grid);
  if (surfaces.length > 256) throw Error('Voxel terrain source count exceeds its budget.');
  const [nx, , nz] = grid.resolution, dx = grid.size[0] / nx, dz = grid.size[2] / nz;
  const heights = new Float32Array(nx * nz).fill(NaN); let work = 0, vertices = 0;
  for (const {positions: p, indices} of surfaces) {
    vertices += p.length / 3;
    if (!p.length || p.length % 3 || vertices > 2_000_000 || !p.every(Number.isFinite)
      || !indices.length || indices.length % 3 || indices.length > 6_000_000 || indices.some(i => i >= p.length / 3)) throw Error('Invalid measured voxel terrain.');
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
      const abx = p[b] - p[a], abz = p[b + 2] - p[a + 2], acx = p[c] - p[a], acz = p[c + 2] - p[a + 2], determinant = abx * acz - acx * abz;
      if (Math.abs(determinant) < 1e-12) continue;
      const lowX = Math.max(0, Math.ceil((Math.min(p[a], p[b], p[c]) - grid.min[0]) / dx - .5));
      const highX = Math.min(nx - 1, Math.floor((Math.max(p[a], p[b], p[c]) - grid.min[0]) / dx - .5));
      const lowZ = Math.max(0, Math.ceil((Math.min(p[a + 2], p[b + 2], p[c + 2]) - grid.min[2]) / dz - .5));
      const highZ = Math.min(nz - 1, Math.floor((Math.max(p[a + 2], p[b + 2], p[c + 2]) - grid.min[2]) / dz - .5));
      for (let z = lowZ; z <= highZ; z++) for (let x = lowX; x <= highX; x++) {
        if (++work > 32_000_000) throw Error('Voxel terrain sampling exceeds its background work budget.');
        const px = grid.min[0] + (x + .5) * dx - p[a], pz = grid.min[2] + (z + .5) * dz - p[a + 2];
        const u = (px * acz - acx * pz) / determinant, v = (abx * pz - px * abz) / determinant;
        if (u < -1e-7 || v < -1e-7 || u + v > 1 + 1e-7) continue;
        const height = p[a + 1] + u * (p[b + 1] - p[a + 1]) + v * (p[c + 1] - p[a + 1]), offset = z * nx + x;
        if (Number.isNaN(heights[offset]) || height > heights[offset]) heights[offset] = height;
      }
    }
  }
  return heights;
}

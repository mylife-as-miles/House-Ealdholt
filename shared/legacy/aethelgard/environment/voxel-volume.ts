/** Static source-metre occupancy/transport, adapted from BakedVoxelLighting's
 * voxel-core.js fractional proxy stamping (MIT; see source notice). No sun,
 * weather, world-clock cursor, NPC state or renderer object belongs here. */
export const VOXEL_OCCUPANCY_VERSION = 'authored-fractional-proxies-ground-v1';
export interface VoxelVolumeGrid {
  readonly resolution: readonly [number, number, number];
  readonly min: readonly [number, number, number];
  readonly size: readonly [number, number, number];
}
export interface VoxelSourceProxy {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly albedo: readonly [number, number, number];
  readonly opacity: number;
}
export interface StaticVoxelVolume {
  readonly grid: VoxelVolumeGrid;
  /** Linear source albedo and fractional occupancy; X then Y then Z. */
  readonly albedoOpacity: Uint8Array;
  /** Encoded bent-sky direction RGB, static sky visibility A. */
  readonly transport: Uint8Array;
  readonly occupiedVoxels: number;
}
export function validateVoxelGrid(g: VoxelVolumeGrid): void {
  if (g.resolution.length !== 3 || g.min.length !== 3 || g.size.length !== 3
    || !g.resolution.every(n => Number.isSafeInteger(n) && n >= 4 && n <= 128)
    || g.resolution.reduce((n, v) => n * v, 1) > 524288 || !g.min.every(Number.isFinite)
    || !g.size.every(n => Number.isFinite(n) && n > 0 && n <= 2048)) throw Error('Invalid bounded voxel volume.');
}
export function centredVoxelGrid(eye: readonly [number, number, number], resolution: VoxelVolumeGrid['resolution'], size: VoxelVolumeGrid['size']): VoxelVolumeGrid {
  if (!eye.every(Number.isFinite)) throw Error('Invalid voxel observer.');
  const min = eye.map((n, i) => Math.floor(n / (size[i] / 4)) * size[i] / 4 - size[i] / 2) as [number, number, number];
  const grid = {resolution, min, size}; validateVoxelGrid(grid); return grid;
}
/** Occupancy identity is deliberately independent of live sunlight. Hashes are
 * verified source-content identities, not filenames, URLs or runtime UUIDs. */
export function voxelOccupancyIdentity(input: {worldRegion: string; sourceSha256: string; generatorVersion: string; backend: string; grid: VoxelVolumeGrid}): string {
  validateVoxelGrid(input.grid);
  if (!/^[a-f0-9]{64}$/.test(input.sourceSha256) || [input.worldRegion, input.generatorVersion, input.backend].some(s => !s || s.length > 256 || /[\u0000-\u001f]/.test(s))) throw Error('Voxel occupancy needs explicit source/version/backend identities.');
  return JSON.stringify([VOXEL_OCCUPANCY_VERSION, input.worldRegion, input.sourceSha256, input.generatorVersion, input.backend,
    input.grid.resolution, input.grid.min, input.grid.size]);
}
/** A compact 2D slice atlas works on r185 WebGL2 without storage textures or a
 * new renderer. Sampling code must address each slice before interpolation. */
export function voxelAtlasLayout(resolution: VoxelVolumeGrid['resolution']) {
  const [x, y, z] = resolution;
  if (!resolution.every(n => Number.isSafeInteger(n) && n >= 4 && n <= 128)) throw Error('Invalid voxel atlas resolution.');
  const columns = Math.max(1, Math.ceil(Math.sqrt(z * y / x))), rows = Math.ceil(z / columns);
  return {columns, rows, width: columns * x, height: rows * y};
}
export function packVoxelAtlas(data: Uint8Array, grid: VoxelVolumeGrid) {
  validateVoxelGrid(grid); const [nx, ny, nz] = grid.resolution, layout = voxelAtlasLayout(grid.resolution);
  if (data.length !== nx * ny * nz * 4) throw Error('Incomplete voxel channels.');
  const pixels = new Uint8Array(layout.width * layout.height * 4);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    const source = (z * ny + y) * nx * 4, target = ((Math.floor(z / layout.columns) * ny + y) * layout.width + z % layout.columns * nx) * 4;
    pixels.set(data.subarray(source, source + nx * 4), target);
  }
  return {pixels, ...layout};
}
/** Heights are measured from actual terrain triangles at voxel column centres.
 * NaN means no authored support; it never invents a floor outside the world. */
export function buildStaticVoxelVolume(input: {grid: VoxelVolumeGrid; proxies: readonly VoxelSourceProxy[];
  terrainHeights?: Float32Array; terrainAlbedo?: readonly [number, number, number]}): StaticVoxelVolume {
  const {grid} = input; validateVoxelGrid(grid);
  const [nx, ny, nz] = grid.resolution, cell = grid.size.map((n, i) => n / grid.resolution[i]);
  if (input.proxies.length > 32768 || input.terrainHeights && input.terrainHeights.length !== nx * nz) throw Error('Voxel source budget exceeded.');
  const colour = input.terrainAlbedo ?? [.1, .08, .05];
  const validColour = (c: readonly number[]) => c.length === 3 && c.every(n => Number.isFinite(n) && n >= 0 && n <= 1);
  if (!validColour(colour)) throw Error('Invalid terrain voxel albedo.');
  const data = new Float32Array(nx * ny * nz * 4); let work = 0;
  if (input.terrainHeights) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const height = input.terrainHeights[z * nx + x]; if (Number.isNaN(height)) continue;
    if (!Number.isFinite(height)) throw Error('Invalid measured voxel terrain height.');
    for (let y = 0; y < ny; y++) {
      const opacity = Math.max(0, Math.min(1, (height - grid.min[1] - y * cell[1]) / cell[1])); if (!opacity) break;
      const offset = (x + nx * (y + ny * z)) * 4; data.set(colour, offset); data[offset + 3] = opacity;
    }
  }
  for (const p of input.proxies) {
    if (p.min.length !== 3 || p.max.length !== 3 || p.min.some((n, i) => !Number.isFinite(n) || !Number.isFinite(p.max[i]) || n > p.max[i])
      || !validColour(p.albedo) || !Number.isFinite(p.opacity) || p.opacity < 0 || p.opacity > 1) throw Error('Invalid authored voxel proxy.');
    const lo = p.min.map((n, i) => Math.max(0, Math.floor((n - grid.min[i]) / cell[i]))), hi = p.max.map((n, i) => Math.min(grid.resolution[i] - 1, Math.floor((n - grid.min[i]) / cell[i])));
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
      if (++work > 32_000_000) throw Error('Voxel stamping work exceeds its background budget.');
      let alpha = p.opacity;
      for (const [i, coordinate] of [x, y, z].entries()) {
        const start = grid.min[i] + coordinate * cell[i]; alpha *= Math.max(0, Math.min(start + cell[i], p.max[i]) - Math.max(start, p.min[i])) / cell[i];
      }
      if (!alpha) continue;
      const offset = (x + nx * (y + ny * z)) * 4, old = data[offset + 3], total = 1 - (1 - old) * (1 - alpha);
      for (let c = 0; c < 3; c++) data[offset + c] = (data[offset + c] * old * (1 - alpha) + p.albedo[c] * alpha) / total;
      data[offset + 3] = total;
    }
  }
  const packed = new Uint8Array(data.length), transport = new Uint8Array(data.length);
  let occupiedVoxels = 0;
  for (let i = 0; i < data.length; i++) packed[i] = Math.round(Math.min(1, Math.max(0, data[i])) * 255);
  const directions = [[0, 1, 0], [.65, 1, 0], [-.65, 1, 0], [0, 1, .65], [0, 1, -.65]];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const offset = (x + nx * (y + ny * z)) * 4; if (packed[offset + 3]) occupiedVoxels++;
    let sky = 0, bx = 0, by = 0, bz = 0;
    for (const d of directions) {
      let visibility = 1;
      for (let step = 1; step <= ny; step++) {
        const xx = Math.floor(x + .5 + d[0] * step * cell[1] / cell[0]), yy = y + step,
          zz = Math.floor(z + .5 + d[2] * step * cell[1] / cell[2]);
        if (xx < 0 || xx >= nx || yy >= ny || zz < 0 || zz >= nz) break;
        visibility *= 1 - packed[(xx + nx * (yy + ny * zz)) * 4 + 3] / 255;
        if (visibility < .005) break;
      }
      sky += visibility; const length = Math.hypot(...d); bx += visibility * d[0] / length; by += visibility * d[1] / length; bz += visibility * d[2] / length;
    }
    const length = Math.hypot(bx, by, bz) || 1;
    transport[offset] = Math.round((bx / length * .5 + .5) * 255); transport[offset + 1] = Math.round((by / length * .5 + .5) * 255);
    transport[offset + 2] = Math.round((bz / length * .5 + .5) * 255); transport[offset + 3] = Math.round(sky / directions.length * 255);
  }
  return {grid, albedoOpacity: packed, transport, occupiedVoxels};
}

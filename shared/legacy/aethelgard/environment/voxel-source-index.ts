import {buildStaticVoxelVolume, voxelOccupancyIdentity, validateVoxelGrid, type VoxelSourceProxy, type VoxelVolumeGrid} from './voxel-volume';
import {sampleVoxelTerrainHeights} from './voxel-terrain';
import type {TerrainBounds} from './terrain-tiles';
export interface VoxelTerrainSource {
  readonly positions: Float32Array; readonly indices: Uint32Array; readonly bounds: TerrainBounds;
}
export interface VoxelRegionSource {
  readonly worldRegion: string; readonly sourceSha256: string; readonly generatorVersion: string; readonly backend: string;
  readonly terrain: readonly VoxelTerrainSource[]; readonly proxies: readonly VoxelSourceProxy[];
}
const overlaps = (a: TerrainBounds, b: TerrainBounds) => a.min.every((n, i) => n <= b.max[i] && a.max[i] >= b.min[i]);
/** Worker-resident static spatial index. Region movement queries nearby source
 * chunks; it never enumerates the entire forest every frame or removes nav. */
export function createVoxelSourceIndex(source: VoxelRegionSource) {
  const cellMetres = 64, proxyIndex = new Map<string, number[]>(), terrainIndex = new Map<string, number[]>();
  let references = 0;
  const wideTerrain:number[]=[];
  if (source.terrain.length > 256 || source.proxies.length > 131072) throw Error('Voxel world source budget exceeded.');
  voxelOccupancyIdentity({...source, grid: {min: [0, 0, 0], size: [4, 4, 4], resolution: [4, 4, 4]}});
  const finiteBounds = (b: TerrainBounds) => b.min.length === 3 && b.max.length === 3 && b.min.every((n, i) => Number.isFinite(n) && Number.isFinite(b.max[i]) && n <= b.max[i]);
  function insert(index: Map<string, number[]>, bounds: TerrainBounds, id: number, wide?:number[]) {
    if (!finiteBounds(bounds)) throw Error('Invalid source-metre voxel bounds.');
    const x0 = Math.floor(bounds.min[0] / cellMetres), x1 = Math.floor(bounds.max[0] / cellMetres), z0 = Math.floor(bounds.min[2] / cellMetres), z1 = Math.floor(bounds.max[2] / cellMetres);
    const cells=(x1-x0+1)*(z1-z0+1);
    // A handful of coarse regional land meshes must not allocate a hash cell
    // for every 64m square across the kingdom. Keep their bounded source IDs
    // separately and test their actual bounds on each local-volume request.
    if(wide&&cells>4096){wide.push(id);references++;return;}
    if (cells + references > 1_000_000) throw Error('Voxel static spatial index exceeds its residency budget.');
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const key = x + ':' + z; let cell = index.get(key); if (!cell) {cell = []; index.set(key, cell);} cell.push(id); references++;
    }
  }
  source.terrain.forEach((t, i) => {
    if (!t.positions.length || t.positions.length % 3 || !t.positions.every(Number.isFinite) || !t.indices.length || t.indices.length % 3
      || t.indices.some(id => id >= t.positions.length / 3)) throw Error('Invalid voxel terrain source chunk.');
    // A supplied bound cannot silently exclude its own source triangles.
    for (let v = 0; v < t.positions.length; v += 3) for (let c = 0; c < 3; c++) if (t.positions[v + c] < t.bounds.min[c] - .0001 || t.positions[v + c] > t.bounds.max[c] + .0001) throw Error('Voxel terrain bounds exclude authored vertices.');
    insert(terrainIndex, t.bounds, i, wideTerrain);
  });
  source.proxies.forEach((p, i) => {
    if (!p.albedo.every(n => Number.isFinite(n) && n >= 0 && n <= 1) || p.albedo.length !== 3 || !Number.isFinite(p.opacity) || p.opacity < 0 || p.opacity > 1) throw Error('Invalid voxel source reflectance.');
    insert(proxyIndex, p, i);
  });
  const bytes = source.terrain.reduce((n, t) => n + t.positions.byteLength + t.indices.byteLength, 0) + source.proxies.length * 88 + references * 4;
  if (bytes > 128 * 1024 * 1024) throw Error('Voxel CPU source residency exceeds its budget.');
  function query(index: Map<string, number[]>, bounds: TerrainBounds, wide:readonly number[]=[]) {
    const ids = new Set<number>(wide);
    for (let z = Math.floor(bounds.min[2] / cellMetres); z <= Math.floor(bounds.max[2] / cellMetres); z++) for (let x = Math.floor(bounds.min[0] / cellMetres); x <= Math.floor(bounds.max[0] / cellMetres); x++) {
      for (const id of index.get(x + ':' + z) ?? []) ids.add(id);
    }
    return [...ids].sort((a, b) => a - b);
  }
  return {
    bytes,
    /** Lookup identity without doing the expensive static bake. Sunlight is
     * absent: the same occupancy can be relit throughout a day/night cycle. */
    key(grid: VoxelVolumeGrid) {return voxelOccupancyIdentity({...source, grid});},
    prepare(grid: VoxelVolumeGrid) {
      validateVoxelGrid(grid);
      const bounds: TerrainBounds = {min: grid.min, max: grid.min.map((n, i) => n + grid.size[i]) as [number, number, number]};
      const terrain = query(terrainIndex, bounds, wideTerrain).map(i => source.terrain[i]).filter(t => overlaps(t.bounds, bounds));
      const proxies = query(proxyIndex, bounds).map(i => source.proxies[i]).filter(p => overlaps(p, bounds));
      const terrainHeights = sampleVoxelTerrainHeights(grid, terrain);
      const volume = buildStaticVoxelVolume({grid, proxies, terrainHeights});
      return {key: voxelOccupancyIdentity({...source, grid}), volume, sourceCounts: {terrain: terrain.length, proxies: proxies.length}};
    },
  };
}

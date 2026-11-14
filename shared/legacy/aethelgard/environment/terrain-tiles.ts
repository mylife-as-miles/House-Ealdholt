/** Authored mesh tiling, adapted from BakedVoxelLighting's terrain tile/retained
 * residency approach (MIT, see BAKED_VOXEL_LIGHTING_SOURCE.md). No reference
 * heights or world dimensions are imported. Collision keeps the source mesh.
 * Assigning whole source triangles avoids resampling UVs, overhangs or shores.
 * Open tile borders are locked when deriving coarser indices, so adjoining
 * levels share exact source positions without lowering the visible surface. */
export const TERRAIN_TILE_VERSION = 'authored-triangles-locked-border-v1';
export interface TerrainBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}
export interface AuthoredTerrainTile {
  readonly id: string;
  readonly column: number;
  readonly row: number;
  /** Source vertex IDs in original winding order. Never a navigation mesh. */
  readonly indices: Uint32Array;
  readonly bounds: TerrainBounds;
  /** Exact source vertices shared by neighbouring pages/open source borders. */
  readonly borderVertices: Uint32Array;
  /** Hydrology/gameplay-sensitive pages retain their authored triangles. */
  readonly preserveDetail: boolean;
}
export interface TerrainTileLayout {
  readonly version: typeof TERRAIN_TILE_VERSION;
  readonly bounds: TerrainBounds;
  readonly cellMetres: number;
  readonly columns: number;
  readonly rows: number;
  readonly tiles: readonly AuthoredTerrainTile[];
  readonly sourceTriangles: number;
}
const overlaps = (a: TerrainBounds, b: TerrainBounds) => a.min.every((v, i) => v <= b.max[i] && a.max[i] >= b.min[i]);
/** The host supplies positions already transformed to its source-metre frame.
 * Buffers remain caller-owned, and no visual result changes them. */
export function partitionAuthoredTerrain(input: {
  positions: Float32Array | Float64Array;
  indices: Uint32Array | Uint16Array;
  cellMetres: number;
  protectedBounds?: readonly TerrainBounds[];
}): TerrainTileLayout {
  const {positions, indices, cellMetres} = input;
  if (!positions.length || positions.length % 3 || positions.length > 6_000_000 || !positions.every(Number.isFinite)
    || !indices.length || indices.length % 3 || indices.length > 12_000_000
    || indices.some(i => i >= positions.length / 3) || !Number.isFinite(cellMetres) || cellMetres < 8 || cellMetres > 512) {
    throw Error('Invalid authored terrain tile input.');
  }
  const guards = input.protectedBounds ?? [];
  if (guards.length > 4096 || guards.some(b => b.min.length !== 3 || b.max.length !== 3
    || b.min.some((n, i) => !Number.isFinite(n) || !Number.isFinite(b.max[i]) || n > b.max[i]))) {
    throw Error('Invalid protected terrain bounds.');
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let c = 0; c < 3; c++) {
    min[c] = Math.min(min[c], positions[i + c]); max[c] = Math.max(max[c], positions[i + c]);
  }
  const columns = Math.max(1, Math.ceil((max[0] - min[0]) / cellMetres)), rows = Math.max(1, Math.ceil((max[2] - min[2]) / cellMetres));
  if (columns * rows > 4096) throw Error('Authored terrain exceeds the tile index budget.');
  const buckets = new Map<number, number[]>();
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const x = (positions[a] + positions[b] + positions[c]) / 3, z = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    const column = Math.min(columns - 1, Math.max(0, Math.floor((x - min[0]) / cellMetres)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((z - min[2]) / cellMetres))), key = row * columns + column;
    let bucket = buckets.get(key); if (!bucket) {bucket = []; buckets.set(key, bucket);}
    bucket.push(indices[t], indices[t + 1], indices[t + 2]);
  }
  const tiles: AuthoredTerrainTile[] = [];
  for (const [key, source] of [...buckets].sort((a, b) => a[0] - b[0])) {
    const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const edges = new Map<string, {a: number; b: number; count: number}>();
    for (let t = 0; t < source.length; t += 3) for (let c = 0; c < 3; c++) {
      const a = source[t + c], b = source[t + (c + 1) % 3], edge = a < b ? `${a}:${b}` : `${b}:${a}`;
      const before = edges.get(edge); if (before) before.count++; else edges.set(edge, {a, b, count: 1});
      for (let axis = 0; axis < 3; axis++) {lo[axis] = Math.min(lo[axis], positions[a * 3 + axis]); hi[axis] = Math.max(hi[axis], positions[a * 3 + axis]);}
    }
    const border = new Set<number>();
    // Non-manifold boundaries also stay locked rather than being "repaired".
    for (const e of edges.values()) if (e.count !== 2) {border.add(e.a); border.add(e.b);}
    const bounds: TerrainBounds = {min: lo, max: hi}, column = key % columns, row = Math.floor(key / columns);
    tiles.push({id: `${column}:${row}`, column, row, indices: new Uint32Array(source), bounds,
      borderVertices: new Uint32Array([...border].sort((a, b) => a - b)), preserveDetail: guards.some(g => overlaps(bounds, g))});
  }
  return {version: TERRAIN_TILE_VERSION, bounds: {min, max}, cellMetres, columns, rows, tiles, sourceTriangles: indices.length / 3};
}

export interface TerrainObserver {
  readonly position: readonly [number, number, number];
  readonly velocity: readonly [number, number, number];
}
export interface TerrainStreamPolicy {
  readonly nearMetres: number;
  readonly middleMetres: number;
  readonly preloadSeconds: number;
  readonly retainMultiplier: number;
}
export const DEFAULT_TERRAIN_STREAM_POLICY: TerrainStreamPolicy = Object.freeze({nearMetres: 260, middleMetres: 850, preloadSeconds: 1.5, retainMultiplier: 1.25});
export type TerrainLevel = 0 | 1 | 2;
export interface TerrainTileDemand {readonly id: string; readonly level: TerrainLevel; readonly distance: number; readonly priority: number; readonly retainFine: boolean;}
const distanceTo = (b: TerrainBounds, p: readonly number[]) => Math.hypot(...p.map((n, i) => Math.max(b.min[i] - n, 0, n - b.max[i])));
/** Rotation never removes residency. Both XR eyes and elevated/teleported
 * cameras participate; predicted movement only preloads and never demotes the
 * surface under the current observer. The far level remains world-continuous. */
export function demandTerrainTiles(layout: {readonly tiles: readonly Pick<AuthoredTerrainTile, 'id' | 'bounds' | 'preserveDetail'>[]}, observers: readonly TerrainObserver[], policy = DEFAULT_TERRAIN_STREAM_POLICY): readonly TerrainTileDemand[] {
  if (!observers.length || observers.length > 4 || observers.some(o => o.position.length !== 3 || o.velocity.length !== 3
    || !o.position.every(Number.isFinite) || !o.velocity.every(Number.isFinite)) || !Number.isFinite(policy.nearMetres) || policy.nearMetres <= 0
    || !Number.isFinite(policy.middleMetres) || policy.middleMetres <= policy.nearMetres
    || !Number.isFinite(policy.preloadSeconds) || policy.preloadSeconds < 0 || policy.preloadSeconds > 5
    || !Number.isFinite(policy.retainMultiplier) || policy.retainMultiplier < 1 || policy.retainMultiplier > 2) throw Error('Invalid terrain stream observers or policy.');
  const predicted = observers.map(o => o.position.map((v, i) => v + Math.max(-100, Math.min(100, o.velocity[i])) * policy.preloadSeconds));
  return layout.tiles.map(tile => {
    let distance = Infinity, preload = Infinity;
    for (let i = 0; i < observers.length; i++) {distance = Math.min(distance, distanceTo(tile.bounds, observers[i].position)); preload = Math.min(preload, distanceTo(tile.bounds, predicted[i]));}
    const detailDistance = Math.min(distance, preload), level: TerrainLevel = tile.preserveDetail || detailDistance < policy.nearMetres ? 0 : detailDistance < policy.middleMetres ? 1 : 2;
    return {id: tile.id, level, distance, priority: distance + (preload < distance ? 0 : policy.nearMetres), retainFine: distance < policy.middleMetres * policy.retainMultiplier || tile.preserveDetail};
  }).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

import type {AuthoredTerrainTile, TerrainLevel} from './terrain-tiles';
import type {VegetationSimplifier} from './vegetation-simplify';
export interface AuthoredTerrainChannels {
  readonly positions: Float32Array;
  readonly attributes: Float32Array;
  readonly channels: readonly {readonly name: string; readonly size: number}[];
}
/** Worker-only derived geometry. Every retained channel is copied from the
 * original vertex, including shoreline masks, projected UV aliases and paint.
 * No height/normal resampling or navigation geometry is returned. */
export async function deriveAuthoredTerrainTile(input: AuthoredTerrainChannels, tile: AuthoredTerrainTile,
  level: TerrainLevel, simplifier: VegetationSimplifier) {
  const stride = input.channels.reduce((n, c) => n + c.size, 0), count = input.positions.length / 3;
  if (!Number.isSafeInteger(count) || count < 3 || count > 2_000_000 || !input.positions.every(Number.isFinite)
    || !input.channels.length || stride > 64 || input.channels.some(c => !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(c.name) || c.name === 'position'
      || !Number.isSafeInteger(c.size) || c.size < 1 || c.size > 4) || new Set(input.channels.map(c => c.name)).size !== input.channels.length
    || input.attributes.length !== count * stride || !input.attributes.every(Number.isFinite)
    || ![0, 1, 2].includes(level) || !tile.indices.length || tile.indices.length % 3
    || tile.indices.length > 1_500_000 || tile.indices.some(i => i >= count) || tile.borderVertices.some(i => i >= count)) throw Error('Invalid authored terrain geometry.');
  // Compact the page before simplifying, so the simplifier sees its open
  // boundary and does not allocate source-world-sized scratch arrays per page.
  const remap = new Map<number, number>(), source: number[] = [], indices = new Uint32Array(tile.indices.length);
  for (let i = 0; i < tile.indices.length; i++) {
    const original = tile.indices[i]; let id = remap.get(original);
    if (id === undefined) {id = source.length; source.push(original); remap.set(original, id);} indices[i] = id;
  }
  const positions = new Float32Array(source.length * 3), attributes = new Float32Array(source.length * stride), locks = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i++) {
    positions.set(input.positions.subarray(source[i] * 3, source[i] * 3 + 3), i * 3);
    attributes.set(input.attributes.subarray(source[i] * stride, (source[i] + 1) * stride), i * stride);
  }
  for (const id of tile.borderVertices) {const local = remap.get(id); if (local !== undefined) locks[local] = 1;}
  let retained: Uint32Array = indices, error = 0;
  if (level !== 0 && !tile.preserveDetail) {
    await simplifier.ready;
    const weights = input.channels.flatMap(c => Array<number>(c.size).fill(c.name === 'normal' ? .1 : c.name.startsWith('uv') ? .2 : .5));
    [retained, error] = simplifier.simplifyWithAttributes(indices, positions, 3, attributes, stride, weights, locks,
      Math.max(3, Math.floor(indices.length * (level === 1 ? .25 : .08) / 3) * 3), level === 1 ? .002 : .008, ['LockBorder']);
    // A locked border is a contract, not a visual best effort.
    const kept = new Set(retained);
    for (let i = 0; i < locks.length; i++) if (locks[i] && !kept.has(i)) throw Error('Derived terrain lost an authored tile border.');
  }
  const kept = new Map<number, number>(), order: number[] = [], outputIndices = new Uint32Array(retained.length);
  for (let i = 0; i < retained.length; i++) {
    const original = retained[i]; let id = kept.get(original);
    if (id === undefined) {id = order.length; order.push(original); kept.set(original, id);} outputIndices[i] = id;
  }
  const outputPositions = new Float32Array(order.length * 3), outputAttributes = input.channels.map(c => ({name: c.name, size: c.size, values: new Float32Array(order.length * c.size)}));
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < order.length; i++) {
    const sourceId = order[i]; let offset = sourceId * stride;
    for (let c = 0; c < 3; c++) {const n = positions[sourceId * 3 + c]; outputPositions[i * 3 + c] = n; bounds[c] = Math.min(bounds[c], n); bounds[c + 3] = Math.max(bounds[c + 3], n);}
    for (const channel of outputAttributes) for (let c = 0; c < channel.size; c++) channel.values[i * channel.size + c] = attributes[offset++];
  }
  return {positions: outputPositions, attributes: outputAttributes, indices: outputIndices, bounds, error,
    sourceTriangles: tile.indices.length / 3, level, preserveDetail: tile.preserveDetail};
}

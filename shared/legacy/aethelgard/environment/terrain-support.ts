import type { EaldholtWoodlandSurface } from './river-woodland';

/** One CPU-only support view of the actual final land owners. Geometry stays
 * separately rendered and owned. Exact coincident seam coordinates are kept so
 * boundary consumers can weld them without changing any source triangle. */
export function mergeEaldholtTerrainSupport(surfaces: readonly EaldholtWoodlandSurface[]): EaldholtWoodlandSurface {
  if (!surfaces.length) throw Error('Terrain support needs an actual land surface.');
  let vertices = 0, indices = 0;
  for (const surface of surfaces) {
    const count = surface.positions.length / 3;
    if (!Number.isSafeInteger(count) || count < 3 || !Number.isSafeInteger(surface.indices.length)
      || surface.indices.length < 3 || surface.indices.length % 3) throw Error('Incomplete terrain-support triangles.');
    for (let i = 0; i < surface.positions.length; i++) if (!Number.isFinite(surface.positions[i])) throw Error('Nonfinite terrain-support position.');
    for (let i = 0; i < surface.indices.length; i++) {
      const id = surface.indices[i];
      if (!Number.isSafeInteger(id) || id < 0 || id >= count) throw Error('Invalid terrain-support index.');
    }
    vertices += count; indices += surface.indices.length;
    if (!Number.isSafeInteger(vertices) || vertices > 0xffffffff || !Number.isSafeInteger(indices)) throw Error('Terrain-support view exceeds its index range.');
  }
  const positions = new Float64Array(vertices * 3), joinedIndices = new Uint32Array(indices);
  let vertexOffset = 0, indexOffset = 0;
  for (const surface of surfaces) {
    positions.set(surface.positions, vertexOffset * 3);
    for (let i = 0; i < surface.indices.length; i++) joinedIndices[indexOffset + i] = surface.indices[i] + vertexOffset;
    vertexOffset += surface.positions.length / 3; indexOffset += surface.indices.length;
  }
  return { positions, indices: joinedIndices };
}

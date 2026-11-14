import {partitionAuthoredTerrain, type TerrainBounds} from './terrain-tiles';
import type {AuthoredTerrainChannels} from './terrain-derived-geometry';
export interface TerrainWorkerSource extends AuthoredTerrainChannels {
  readonly indices: Uint32Array;
  readonly frame: readonly number[];
  readonly cellMetres: number;
  readonly protectedBounds: readonly TerrainBounds[];
}
/** Transform once in the worker for distance/indexing. Render buffers keep
 * original local coordinates; cm exports and tabletop scale stay separate. */
export function prepareTerrainWorkerSource(source: TerrainWorkerSource) {
  const m = source.frame;
  if (m.length !== 16 || !m.every(Number.isFinite) || Math.abs(m[3]) > 1e-9 || Math.abs(m[7]) > 1e-9 || Math.abs(m[11]) > 1e-9 || Math.abs(m[15] - 1) > 1e-9) throw Error('Terrain source needs an affine source-metre frame.');
  const determinant = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  if (Math.abs(determinant) < 1e-15) throw Error('Terrain source frame is singular.');
  const metres = new Float64Array(source.positions.length);
  for (let i = 0; i < source.positions.length; i += 3) {
    const x = source.positions[i], y = source.positions[i + 1], z = source.positions[i + 2];
    for (let c = 0; c < 3; c++) metres[i + c] = m[c] * x + m[4 + c] * y + m[8 + c] * z + m[12 + c];
  }
  return partitionAuthoredTerrain({positions: metres, indices: source.indices, cellMetres: source.cellMetres, protectedBounds: source.protectedBounds});
}

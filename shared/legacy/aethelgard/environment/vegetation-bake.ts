import {vegetationAtlasByteLength, type VegetationAtlasRecord} from './vegetation-atlas';
import type {WorldBakeBlob} from './world-bake-cache';
// Target-pixel capture replaces renderScale/DPR-dependent v2 atlases. Only
// derived vegetation captures rebuild; source geometry and world time do not.
export const VEGETATION_CAPTURE_VERSION = 'unlit-object-normal-coverage-mips-target-pixels-v3';
export function encodeVegetationBake(record: VegetationAtlasRecord): WorldBakeBlob {
  const size = vegetationAtlasByteLength(record.tileSize, record.views), data = new Uint8Array(size);
  let at = 0;
  const mips = record.mips.map(mip => {for (const channel of ['colour', 'normal'] as const) {data.set(mip[channel], at); at += mip[channel].byteLength;} return {width: mip.width, height: mip.height};});
  if (at !== size) throw Error('Incomplete vegetation capture mip chain.');
  const blob = {data, metadata: JSON.stringify({...record, mips})};
  if (!decodeVegetationBake(blob, record.tileSize, record.views)) throw Error('Invalid vegetation capture payload.');
  return blob;
}
export function decodeVegetationBake(blob: WorldBakeBlob, tileSize: number, views: 8 | 16): VegetationAtlasRecord | null {
  try {
    const value = JSON.parse(blob.metadata), bytes = vegetationAtlasByteLength(tileSize, views);
    if (value.schema !== 1 || value.tileSize !== tileSize || value.views !== views || value.columns !== 4 || value.rows !== views / 4
      || !Array.isArray(value.centre) || value.centre.length !== 3 || !value.centre.every(Number.isFinite)
      || !Array.isArray(value.extent) || value.extent.length !== 2 || !value.extent.every((n: number) => Number.isFinite(n) && n > 0 && n < 1e6)
      || !Array.isArray(value.coverage) || value.coverage.length !== views || !value.coverage.every((n: number) => Number.isFinite(n) && n > 0 && n <= 1)
      || !(blob.data instanceof Uint8Array) || blob.data.length !== bytes || !Array.isArray(value.mips)) return null;
    let width = tileSize * 4, height = tileSize * views / 4, at = 0, level = 0;
    const mips: VegetationAtlasRecord['mips'] = [];
    for (;;) {
      const mip = value.mips[level++], length = width * height * 4;
      if (!mip || mip.width !== width || mip.height !== height) return null;
      const colour = blob.data.slice(at, at + length); at += length;
      const normal = blob.data.slice(at, at + length); at += length;
      mips.push({width, height, colour, normal});
      if (width === 1 && height === 1) break;
      width = Math.max(1, width >> 1); height = Math.max(1, height >> 1);
    }
    if (level !== value.mips.length || at !== bytes) return null;
    return {...value, mips};
  } catch {return null;}
}

import { createEaldholtWoodlandSupportIndex, type EaldholtWoodlandSurface } from './river-woodland';
import { sampleEaldholtFarGeography, type EaldholtFarProjectionPacket } from './far-surround';
export const EALDHOLT_FAR_BOUNDARY_SAMPLES = 256;
export interface EaldholtFarBoundary {
  readonly heights: Uint16Array; readonly minimum: number; readonly range: number; readonly transitionMetres: 64;
  readonly mainlandSamples: number; readonly waterSamples: number; readonly maximumQuantizationError: number; readonly setupMilliseconds: number;
}
/** Real source-local terrain only; a missing mainland sample is an intake
 * failure. Water stages come explicitly from the canonical geographic packet. */
export function createEaldholtFarBoundary(packet: EaldholtFarProjectionPacket, terrain: readonly EaldholtWoodlandSurface[]): EaldholtFarBoundary {
  const started = performance.now(), index = createEaldholtWoodlandSupportIndex(terrain), raw = new Float64Array(1024);
  const { min, max } = packet.localBounds; let low = Infinity, high = -Infinity, mainlandSamples = 0, waterSamples = 0;
  for (let edge = 0; edge < 4; edge++) for (let i = 0; i < 256; i++) {
    const t = i / 255, x = edge < 2 ? (edge === 0 ? min[0] : max[0]) : min[0] + (max[0] - min[0]) * t;
    const z = edge < 2 ? min[2] + (max[2] - min[2]) * t : (edge === 2 ? min[2] : max[2]);
    const field = sampleEaldholtFarGeography(packet.geography, x, z); let height = field.level;
    if (field.kind === 'mainland') {
      const support = index.sample(x, z); if (!support) throw Error(`Far boundary mainland terrain missing at edge${edge}/sample${i} (${x},${z}).`);
      height = support.height; mainlandSamples++;
    } else waterSamples++;
    raw[edge * 256 + i] = height; low = Math.min(low, height); high = Math.max(high, height);
  }
  const range = Math.max(high - low, 1e-6), heights = Uint16Array.from(raw, y => Math.round((y - low) / range * 65535));
  let maximumQuantizationError = 0; for (let i = 0; i < 1024; i++) maximumQuantizationError = Math.max(maximumQuantizationError, Math.abs(raw[i] - (low + heights[i] / 65535 * range)));
  return { heights, minimum: low, range, transitionMetres: 64, mainlandSamples, waterSamples, maximumQuantizationError, setupMilliseconds: performance.now() - started };
}
/** Borrowed pixels belong to the atmosphere, not an asset map. R/A stay exact. */
export function packEaldholtFarBoundary(pixels: Uint8Array, boundary: EaldholtFarBoundary): void {
  if (pixels.length < 1024 * 4 || boundary.heights.length !== 1024) throw Error('Incomplete far boundary storage.');
  for (let i = 0; i < 1024; i++) { pixels[i * 4 + 1] = boundary.heights[i] >>> 8; pixels[i * 4 + 2] = boundary.heights[i] & 255; }
}
export function sampleEaldholtFarBoundary(packet: EaldholtFarProjectionPacket, boundary: EaldholtFarBoundary, x: number, z: number): number {
  const { min, max } = packet.localBounds, cx = Math.max(min[0], Math.min(max[0], x)), cz = Math.max(min[2], Math.min(max[2], z));
  const dx = x - cx, dz = z - cz; let edge = Math.abs(dx) >= Math.abs(dz) ? (dx < 0 ? 0 : 1) : (dz < 0 ? 2 : 3);
  if (dx === 0 && dz === 0) { const distances = [x - min[0], max[0] - x, z - min[2], max[2] - z]; edge = distances.indexOf(Math.min(...distances)); }
  const t = edge < 2 ? (cz - min[2]) / (max[2] - min[2]) : (cx - min[0]) / (max[0] - min[0]);
  const f = Math.max(0, Math.min(255, t * 255)), a = Math.floor(f), b = Math.min(a + 1, 255);
  return boundary.minimum + ((boundary.heights[edge * 256 + a] * (1 - f + a) + boundary.heights[edge * 256 + b] * (f - a)) / 65535) * boundary.range;
}
export function sampleEaldholtFarBoundaryField(packet: EaldholtFarProjectionPacket, boundary: EaldholtFarBoundary | undefined, x: number, z: number): ReturnType<typeof sampleEaldholtFarGeography> {
  const field = sampleEaldholtFarGeography(packet.geography, x, z); if (!boundary || field.kind !== 'mainland') return field;
  const { min, max } = packet.localBounds, dx = Math.max(min[0] - x, 0, x - max[0]), dz = Math.max(min[2] - z, 0, z - max[2]);
  let t = Math.min(1, Math.hypot(dx, dz) / boundary.transitionMetres); t = t * t * (3 - 2 * t);
  return { kind: field.kind, level: sampleEaldholtFarBoundary(packet, boundary, x, z) * (1 - t) + field.level * t };
}

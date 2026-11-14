import type { EaldholtLandformRect } from './bank-landform';
import type { EaldholtContinuityBounds } from './coastal-continuity';

export interface EaldholtMainlandRelief {
  readonly kind: 'positive-mainland-rises-v1';
  readonly protectedBoundaryXZ: Float32Array;
  readonly lobes: readonly { readonly x: number; readonly z: number; readonly radiusX: number; readonly radiusZ: number; readonly amplitude: number }[];
  readonly maximumRise: 10;
  readonly contourOffsets: readonly [64, 160];
}

/** Source-relative, modest local rises; these do not locate regional mountains. */
export function createEaldholtMainlandRelief(boundaryXZ: ArrayLike<number>, source: EaldholtLandformRect, local: EaldholtContinuityBounds): EaldholtMainlandRelief {
  const span = Math.max(source.maxX - source.minX, source.maxZ - source.minZ);
  if (boundaryXZ.length < 6 || boundaryXZ.length % 2 || !Number.isFinite(span) || span <= 0) throw Error('Invalid mainland relief boundary.');
  const boundary = Float32Array.from(boundaryXZ);
  if (![...boundary, ...local.min, ...local.max].every(Number.isFinite)) throw Error('Nonfinite mainland relief boundary.');
  const x = (source.minX + source.maxX) / 2, z = (source.minZ + source.maxZ) / 2;
  return { kind: 'positive-mainland-rises-v1', protectedBoundaryXZ: boundary, maximumRise: 10, contourOffsets: [64, 160],
    lobes: [
      { x: x + .15 * span, z: local.min[2] - .8 * span, radiusX: 1.35 * span, radiusZ: 1.1 * span, amplitude: 8.5 },
      { x: local.max[0] + .85 * span, z: z - .2 * span, radiusX: 1.2 * span, radiusZ: 1.4 * span, amplitude: 6.5 },
      { x: x - .2 * span, z: local.max[2] + .7 * span, radiusX: 1.3 * span, radiusZ: 1.1 * span, amplitude: 10 },
    ] };
}
const fade = (v: number, start: number, end: number) => {
  const t = Math.max(0, Math.min(1, (v - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

/** Positive-only addition outside the original completed land boundary. */
export function sampleEaldholtMainlandRelief(form: EaldholtMainlandRelief | undefined, x: number, z: number, coastDistance: number, riverDistance: number): number {
  if (!form) return 0;
  if (![x, z, coastDistance].every(Number.isFinite) || Number.isNaN(riverDistance)) throw Error('Nonfinite mainland relief query.');
  if (coastDistance <= 3.2 || riverDistance <= 6) return 0;
  const b = form.protectedBoundaryXZ; let inside = false, distanceSquared = Infinity;
  for (let i = 0, previous = b.length - 2; i < b.length; previous = i, i += 2) {
    const ax = b[previous], az = b[previous + 1], bx = b[i], bz = b[i + 1];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
    const dx = bx - ax, dz = bz - az, length = dx * dx + dz * dz;
    const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length)) : 0;
    distanceSquared = Math.min(distanceSquared, (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2);
  }
  if (inside || distanceSquared < 1e-10) return 0;
  let remaining = 1;
  for (const lobe of form.lobes) {
    const dx = (x - lobe.x) / lobe.radiusX, dz = (z - lobe.z) / lobe.radiusZ;
    remaining *= 1 - lobe.amplitude / form.maximumRise * Math.exp(-dx * dx - dz * dz);
  }
  return form.maximumRise * (1 - remaining) * fade(Math.sqrt(distanceSquared), 0, 64)
    * fade(coastDistance, 3.2, 48) * fade(riverDistance, 6, 48);
}

/** Resident-LOD handoff adapted from BakedVoxelLighting vegetation-lod.js
 * (SamG-Coder, MIT; see BAKED_VOXEL_LIGHTING_SOURCE.md). No Three dependency.
 * Distance uses source metres, not the tabletop display's scaled world units. */
export type VegetationLevel = 0 | 1 | 2 | 3;
export type VegetationKind = 'tree' | 'grass';
export interface VegetationLodPolicy {
  readonly distances: readonly [number, number, number];
  readonly blendWidths: readonly [number, number, number];
  readonly handoffMilliseconds: number;
}
export const TREE_HLOD: VegetationLodPolicy = {
  distances: [85, 190, 420], blendWidths: [14, 26, 45], handoffMilliseconds: 240,
};
export const GRASS_HLOD: VegetationLodPolicy = {
  distances: [38, 82, 155], blendWidths: [8, 16, 26], handoffMilliseconds: 650,
};
export interface VegetationLodSample {
  /** Source-frame distance, or the orthographic equivalent distance. */
  readonly distanceMetres: number;
  /** tan(actual vertical FOV/2) / tan(60 degrees/2), one for orthographic. */
  readonly projectionScale: number;
  readonly qualityScale: number;
}

export function vegetationLodDistance(sample: VegetationLodSample): number {
  if (!Number.isFinite(sample.distanceMetres) || sample.distanceMetres < 0 ||
      !Number.isFinite(sample.projectionScale) || sample.projectionScale <= 0 ||
      !Number.isFinite(sample.qualityScale) || sample.qualityScale <= 0) {
    throw Error('Invalid source-metre vegetation projection.');
  }
  return sample.distanceMetres * sample.projectionScale / sample.qualityScale;
}

/** Each actor owns four bounded weights. A missing requested level cannot
 * reserve dither pixels: its weight goes to the nearest ready source instead.
 * Rendering/collision/nav ownership remain outside this state machine. */
export function createVegetationHandoff(policy: VegetationLodPolicy, initial: VegetationLevel = 0) {
  if (!policy.distances.every((d, i, a) => Number.isFinite(d) && d > 0 && (i === 0 || d > a[i - 1])) ||
      !policy.blendWidths.every((w, i) => Number.isFinite(w) && w > 0 && w < policy.distances[i]) ||
      !Number.isFinite(policy.handoffMilliseconds) || policy.handoffMilliseconds <= 0 ||
      !Number.isInteger(initial) || initial < 0 || initial > 3) throw Error('Invalid vegetation LOD policy.');
  const weights = new Float32Array(4), targets = new Float32Array(4), ranges = new Float32Array(8);
  weights[initial] = 1;
  let previous: number | null = null;
  const result = {weights, ranges, requested: initial as VegetationLevel, transitioning: false};
  function fallback(level: number, ready: number): number {
    for (let distance = 0; distance < 4; distance++) {
      // Prefer the more detailed ready level for equal-distance fallbacks.
      if (level - distance >= 0 && ready & (1 << (level - distance))) return level - distance;
      if (level + distance < 4 && ready & (1 << (level + distance))) return level + distance;
    }
    throw Error('No resident vegetation fallback.');
  }
  return {
    update(now: number, distance: number, ready: number, reducedMotion = false) {
      if (!Number.isFinite(now) || !Number.isFinite(distance) || distance < 0 ||
          !Number.isInteger(ready) || ready <= 0 || ready > 15) throw Error('Invalid vegetation handoff frame.');
      targets.fill(0);
      let assigned = false;
      for (let i = 0; i < 3; i++) {
        const half = policy.blendWidths[i] / 2, start = policy.distances[i] - half;
        if (distance < start) { targets[fallback(i, ready)] = 1; assigned = true; break; }
        if (distance <= start + half * 2) {
          const t = (distance - start) / (half * 2), smooth = t * t * (3 - 2 * t);
          targets[fallback(i, ready)] += 1 - smooth;
          targets[fallback(i + 1, ready)] += smooth;
          assigned = true; break;
        }
      }
      if (!assigned) targets[fallback(3, ready)] = 1;
      result.requested = (distance < policy.distances[0] ? 0 : distance < policy.distances[1] ? 1 : distance < policy.distances[2] ? 2 : 3);
      // A caller may retire a fully faded level. Never allocate pixels to a
      // nonresident source after cancellation, memory pressure or device loss.
      for (let i = 0; i < 4; i++) if (!(ready & (1 << i)) && weights[i] > 0) {
        weights[fallback(i, ready)] += weights[i]; weights[i] = 0;
      }
      const step = previous === null ? 1 : Math.min(50, Math.max(0, now - previous)) / policy.handoffMilliseconds;
      previous = Math.max(previous ?? now, now);
      let difference = 0;
      for (let i = 0; i < 4; i++) difference = Math.max(difference, Math.abs(targets[i] - weights[i]));
      const alpha = reducedMotion || difference <= step + 1e-7 ? 1 : step / difference;
      let sum = 0;
      for (let i = 0; i < 4; i++) { weights[i] += (targets[i] - weights[i]) * alpha; sum += weights[i]; }
      // Float32 roundoff must not leave holes in the complementary screen door.
      let cursor = 0;
      for (let i = 3; i >= 0; i--) { ranges[i * 2] = cursor; cursor += weights[i] / sum; ranges[i * 2 + 1] = cursor; }
      result.transitioning = alpha !== 1;
      return result;
    },
  };
}

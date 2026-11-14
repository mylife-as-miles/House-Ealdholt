export const VEGETATION_SIMPLIFY_VERSION = 'source-attributes-root-lock-v1';
export interface VegetationSimplifyInput {
  positions: Float32Array; attributes: Float32Array; indices: Uint32Array;
  stride: number; ratio: number; error: number; foliage: boolean; attributeWeights: number[];
}
export interface VegetationSimplifier {
  ready: Promise<void>;
  simplifyWithAttributes(indices: Uint32Array, positions: Float32Array, positionStride: number,
    attributes: Float32Array, attributeStride: number, weights: number[], locks: Uint8Array | null,
    target: number, error: number, flags?: ('LockBorder' | 'Permissive')[]): [Uint32Array, number];
}
/** All retained vertices and UV/normal/tangent channels remain source data.
 * Canopy-card borders remain locked. Wood can simplify across exporter seams,
 * while its lowest source vertices retain exact terrain contact. */
export async function simplifyVegetationIndices(data: VegetationSimplifyInput, simplifier: VegetationSimplifier) {
  if (!data.positions.length || data.positions.length % 3 || data.positions.length > 1500000 ||
      !data.indices.length || data.indices.length % 3 || data.indices.length > 1500000 ||
      data.stride < 1 || data.stride > 32 || data.attributes.length !== data.positions.length / 3 * data.stride ||
      data.attributeWeights.length !== data.stride || !data.attributeWeights.every(n => Number.isFinite(n) && n > 0 && n <= 8) ||
      !data.positions.every(Number.isFinite) || !data.attributes.every(Number.isFinite) ||
      data.indices.some(i => i >= data.positions.length / 3) || !Number.isFinite(data.ratio) || data.ratio <= 0 || data.ratio > 1 ||
      !Number.isFinite(data.error) || data.error <= 0 || data.error > .1 || typeof data.foliage !== 'boolean') throw Error('Invalid derived vegetation geometry budget.');
  await simplifier.ready;
  let minimum = Infinity, maximum = -Infinity;
  for (let i = 1; i < data.positions.length; i += 3) {minimum = Math.min(minimum, data.positions[i]); maximum = Math.max(maximum, data.positions[i]);}
  const roots = new Uint8Array(data.positions.length / 3);
  if (!data.foliage) for (let i = 0; i < roots.length; i++) if (data.positions[i * 3 + 1] <= minimum + (maximum - minimum) * .002) roots[i] = 1;
  const target = Math.max(3, Math.floor(data.indices.length * data.ratio / 3) * 3);
  const [indices, error] = simplifier.simplifyWithAttributes(data.indices, data.positions, 3, data.attributes, data.stride,
    data.attributeWeights, data.foliage ? null : roots, target, data.error, data.foliage ? ['LockBorder'] : ['Permissive']);
  let contact = Infinity;
  for (const index of indices) contact = Math.min(contact, data.positions[index * 3 + 1]);
  if (!data.foliage && Math.abs(contact - minimum) > 1e-5) throw Error('Simplified tree lost its source ground contact.');
  return {indices, error};
}

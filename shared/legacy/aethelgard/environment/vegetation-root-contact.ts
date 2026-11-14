/** Measured wood-only foot ring, in the unchanged imported prototype frame. */
export interface VegetationRootContact {
  readonly baseY: number;
  readonly radius: number;
  readonly points: readonly (readonly [number, number, number])[];
}
export interface RootTerrainSupport { readonly height: number; readonly slope: number }

/** A generated actor owns one grounded Y at every visual LOD. Neither source
 * geometry nor the terrain/collision/navigation surface is moved or deformed. */
export function groundVegetationRoot(input: {
  readonly x: number; readonly z: number; readonly yaw: number; readonly scale: number;
  readonly height: number; readonly contact: VegetationRootContact;
  readonly sample: (x: number, z: number) => RootTerrainSupport | null;
}): { readonly y: number; readonly burial: number } | null {
  const { x, z, yaw, scale, height, contact, sample } = input;
  if (![x, z, yaw, scale, height, contact.baseY, contact.radius].every(Number.isFinite)
    || scale <= 0 || height <= 0 || contact.radius <= 0 || contact.points.length < 3 || contact.points.length > 64)
    throw Error('Unqualified vegetation wood-root contact.');
  const centre = sample(x, z);
  if (!centre || !Number.isFinite(centre.height) || !Number.isFinite(centre.slope) || centre.slope > .72) return null;
  const baseline = centre.height - contact.baseY * scale;
  const cosine = Math.cos(yaw), sine = Math.sin(yaw), soilCover = .08;
  let y = baseline - soilCover;
  for (const point of contact.points) {
    if (point.length !== 3 || !point.every(Number.isFinite)) throw Error('Invalid vegetation root sample.');
    const [px, py, pz] = point;
    const support = sample(x + (px * cosine + pz * sine) * scale, z + (-px * sine + pz * cosine) * scale);
    if (!support || !Number.isFinite(support.height) || !Number.isFinite(support.slope) || support.slope > .72) return null;
    y = Math.min(y, support.height - py * scale - soilCover);
  }
  // Never conceal an unsupported tree by burying metres of its trunk. This
  // budget scales with the measured collar and species height, with a hard cap.
  const budget = Math.min(2, Math.max(.18, height * scale * .13), .18 + contact.radius * scale * .8);
  const burial = baseline - y;
  return burial <= budget + 1e-7 ? { y, burial } : null;
}

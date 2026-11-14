export interface ShoreRockAnchor {
  groundY: number;
  previousAnchorY: number;
  scale: number;
  radius: number;
  localMinY: number;
  localMaxY: number;
  burial?: number;
}

/** Ground an existing source rock without changing its geometry, XZ placement
 * or original collision volume. The old volume is centred at previousAnchorY;
 * a .12m buried base avoids a floating waterline silhouette. When the desired
 * grounding would exceed that volume, retain the safely buried alternative. */
export function sourceShoreRockAnchor(spec: ShoreRockAnchor): number {
  const { groundY, previousAnchorY, scale, radius, localMinY, localMaxY } = spec;
  const burial = spec.burial ?? .12;
  if (![groundY, previousAnchorY, scale, radius, localMinY, localMaxY, burial].every(Number.isFinite) || scale <= 0 || radius <= 0 || burial < 0 || localMaxY < localMinY) throw new Error('Invalid source shore-rock bounds');
  const minimum = previousAnchorY - radius - localMinY * scale;
  const maximum = previousAnchorY + radius - localMaxY * scale;
  if (minimum > maximum) throw new Error('The source rock cannot fit its existing collision volume');
  const grounded = groundY - burial - localMinY * scale;
  return Math.max(minimum, Math.min(maximum, grounded));
}

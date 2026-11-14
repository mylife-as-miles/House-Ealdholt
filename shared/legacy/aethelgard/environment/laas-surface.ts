/**
 * Portable CPU adaptation of the grass/forest/rock mixing and wet-surface
 * response in LAAS's src/render/TerrainMaterial.ts. See provenance.ts and
 * LICENSE.laas.txt. This is preparation for a vertex/texture bake, not a
 * replacement renderer or a claim of LAAS visual parity.
 *
 * Callers must supply measured terrain fields. There is deliberately no
 * Elderbloom mesh-name, coordinate, water-level, palette or biome assumption.
 * Alpine scree, snow, noise synthesis, lighting and displacement are omitted.
 */

export interface VillageSurfaceFields {
  /** Rise/run, as in LAAS Heightfield.normalTex.w; not radians or normal.y. */
  slope: number;
  vegetationDensity: number;
  moisture: number;
  rockExposure: number;
  /** Metres of water above the sampled ground; zero on dry ground. */
  riverDepthMetres: number;
  /** Authored or measured shore mask. Zero where no water margin is known. */
  shoreWetness: number;
}

export interface VillageSurfaceBlend {
  /** Sequential LAAS mix factors flattened into nonnegative weights summing to one. */
  weights: { soil: number; grass: number; forestFloor: number; rock: number };
  /** Multiply linear albedo by this value before platform-specific lighting. */
  wetAlbedoMultiplier: number;
  /** PBR roughness for a lit adapter; a baked/unlit adapter may omit this. */
  roughness: number;
}

const clamp = (value: number, low = 0, high = 1): number => Math.max(low, Math.min(high, value));

/** Handles LAAS's intentionally descending knees explicitly. GLSL smoothstep
 * with edge0 >= edge1 is undefined, so do not copy a reversed GPU call. */
function ramp(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function villageSurfaceBlend(fields: Readonly<VillageSurfaceFields>): VillageSurfaceBlend {
  for (const name of ['slope', 'vegetationDensity', 'moisture', 'rockExposure', 'riverDepthMetres', 'shoreWetness'] as const) {
    if (!Number.isFinite(fields[name])) throw new RangeError(`Terrain field ${name} must be finite.`);
  }
  if (fields.slope < 0 || fields.riverDepthMetres < 0) throw new RangeError('Slope and water depth must be nonnegative.');
  const vegetation = clamp(fields.vegetationDensity);
  const moisture = clamp(fields.moisture);
  const exposure = clamp(fields.rockExposure);
  const shore = clamp(fields.shoreWetness);

  // CPU port of TerrainMaterial.ts's rockW, grassW and forestW, without
  // LAAS-specific karst zone masks. Each original shader mix is preserved.
  const rock = Math.max(ramp(0.62, 1.15, fields.slope), exposure * 0.85);
  const grass = ramp(0.5, 0.22, fields.slope) * vegetation * (1 - rock);
  const forest = vegetation * ramp(0.9, 0.45, fields.slope) * ramp(0.25, 0.6, moisture) * (1 - rock);
  const wet = clamp(ramp(0.55, 0.95, moisture) * 0.5 + fields.riverDepthMetres * 2 + shore * 0.6, 0, 0.75);

  // LAAS mixes soil -> grass -> forest floor -> rock in that order. Merely
  // normalizing the three masks would change coverage and erase bare soil.
  return {
    weights: {
      soil: (1 - grass) * (1 - forest) * (1 - rock),
      grass: grass * (1 - forest) * (1 - rock),
      forestFloor: forest * (1 - rock),
      rock,
    },
    wetAlbedoMultiplier: 1 - wet * 0.55,
    roughness: clamp(0.94 * (1 - rock) + 0.8 * rock - wet * 0.45, 0.25, 1),
  };
}

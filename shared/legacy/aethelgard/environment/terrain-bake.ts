import { normalMatrix, type Mat4 } from '../../environment/kernel/math';
import { villageSurfaceBlend } from './laas-surface';

export type LinearRgb = readonly [number, number, number];
export interface VillageGroundPalette {
  soil: LinearRgb;
  grass: LinearRgb;
  forestFloor: LinearRgb;
  rock: LinearRgb;
}

/** Initial dry-material review palette taken from LAAS TerrainMaterial.ts's
 * neutral soil/rock ranges. These are linear albedos, not approved world lore. */
export const LAAS_DRY_REVIEW_PALETTE: VillageGroundPalette = {
  soil: [0.1975, 0.1575, 0.11],
  grass: [0.048, 0.112, 0.0235],
  forestFloor: [0.18, 0.15, 0.095],
  rock: [0.34, 0.3175, 0.2875],
};

/** Repairs missing ground colour from measured normals and an optional
 * source-placement density sampler. Without one this is explicitly dry soil.
 * No water/road mask is invented. Run offline; no renderer or GPU is needed. */
export function bakeVillageTerrain(
  normals: ArrayLike<number>,
  worldMatrix: Mat4,
  palette: VillageGroundPalette = LAAS_DRY_REVIEW_PALETTE,
  vegetation?: { positions: ArrayLike<number>; densityAt: (x:number,y:number,z:number)=>number },
): { colors: Float32Array; meanRoughness: number; vertices: number; meanVegetationDensity:number; vegetatedVertices:number } {
  if (!normals.length || normals.length % 3) throw new RangeError('Expected nonempty XYZ terrain normals.');
  if (worldMatrix.length !== 16 || !Array.from(worldMatrix).every(Number.isFinite)) throw new RangeError('Expected a finite world matrix.');
  for (const color of Object.values(palette)) {
    if (color.length !== 3 || !color.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new RangeError('Ground palette must contain linear RGB values in [0,1].');
  }
  const transform = normalMatrix(new Float64Array(9), worldMatrix);
  if (!transform.some(value => value !== 0)) throw new RangeError('Terrain transform must not be singular.');
  const colors = new Float32Array(normals.length);
  if(vegetation && vegetation.positions.length!==normals.length) throw new RangeError('Terrain positions must match normals.');
  let roughness = 0, densitySum=0, vegetatedVertices=0;
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i], y = normals[i + 1], z = normals[i + 2];
    if (![x, y, z].every(Number.isFinite)) throw new RangeError('Terrain normal must be finite.');
    const nx = transform[0] * x + transform[3] * y + transform[6] * z;
    const ny = transform[1] * x + transform[4] * y + transform[7] * z;
    const nz = transform[2] * x + transform[5] * y + transform[8] * z;
    if (Math.hypot(nx, ny, nz) < 1e-12) throw new RangeError('Terrain normal must have a direction.');
    const slope = ny > 0 ? Math.hypot(nx, nz) / ny : 1e6;
    let density=0;
    if(vegetation) {
      const px=vegetation.positions[i],py=vegetation.positions[i+1],pz=vegetation.positions[i+2];
      density=vegetation.densityAt(worldMatrix[0]*px+worldMatrix[4]*py+worldMatrix[8]*pz+worldMatrix[12],worldMatrix[1]*px+worldMatrix[5]*py+worldMatrix[9]*pz+worldMatrix[13],worldMatrix[2]*px+worldMatrix[6]*py+worldMatrix[10]*pz+worldMatrix[14]);
    }
    const blend = villageSurfaceBlend({ slope, vegetationDensity: density, moisture: 0, rockExposure: 0, riverDepthMetres: 0, shoreWetness: 0 });
    for (let channel = 0; channel < 3; channel++) {
      colors[i + channel] = palette.soil[channel] * blend.weights.soil + palette.grass[channel] * blend.weights.grass + palette.forestFloor[channel] * blend.weights.forestFloor + palette.rock[channel] * blend.weights.rock;
    }
    densitySum+=density;
    if(density>0.05) vegetatedVertices++;
    roughness += blend.roughness;
  }
  const vertices = normals.length / 3;
  return { colors, meanRoughness: roughness / vertices, vertices, meanVegetationDensity:densitySum/vertices, vegetatedVertices };
}

/** Explicit dry fallback for source terrain whose paint/plant fields are unknown. */
export function bakeDryVillageTerrain(normals:ArrayLike<number>, worldMatrix:Mat4, palette:VillageGroundPalette=LAAS_DRY_REVIEW_PALETTE) {
  return bakeVillageTerrain(normals,worldMatrix,palette);
}

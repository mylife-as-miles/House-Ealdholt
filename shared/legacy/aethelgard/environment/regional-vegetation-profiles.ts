import {REGIONAL_VEGETATION_SOURCE_SHA256} from './regional-assets';
/** Both existing assets share foliage, materials and actor origins. The low
 * asset reduces branches only. Hashes identify the actual GLB used for baking,
 * so Native/Low cannot restore a Desktop-high prototype capture by mistake. */
export const REGIONAL_VEGETATION_PROFILES={
 desktop:{file:'vegetation-desktop.glb',sha256:REGIONAL_VEGETATION_SOURCE_SHA256},
 quest:{file:'vegetation-quest.glb',sha256:'118106d70aff3d4e8f77753342f93c821ad673eb2ec23df2d9e25cf50acfddfe'},
} as const;

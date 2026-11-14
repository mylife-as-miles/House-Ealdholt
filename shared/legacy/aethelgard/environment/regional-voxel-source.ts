import type {VoxelRegionSource,VoxelTerrainSource} from './voxel-source-index';
import type {RegionalWorldLayout,RegionalPrototype} from './regional-world-layout';
import type {VoxelSourceProxy} from './voxel-volume';
/** Stable, coarse canopy transport comes from permanent placement data, never
 * visual billboards/LOD buffers. Original terrain and building proxies remain. */
export function appendRegionalVoxelSource(source:VoxelRegionSource,layout:RegionalWorldLayout,prototypes:readonly RegionalPrototype[],horizon:VoxelTerrainSource):VoxelRegionSource{
 const extra:VoxelSourceProxy[]=[];
 for(let at=0;at<layout.placements.length;at+=6){const [x,y,z,,scale,variant]=layout.placements.subarray(at,at+6),prototype=prototypes[variant];
  if(!prototype)throw Error('Unknown regional GI prototype.');const radius=prototype.canopyRadius*scale,height=prototype.height*scale;
  extra.push({min:[x-radius,y+height*.22,z-radius],max:[x+radius,y+height,z+radius],opacity:prototype.shrub?.16:.20,albedo:variant>=9&&variant<12?[.065,.10,.045]:[.09,.14,.055]});
 }
 for(let at=0;at<layout.rocks.length;at+=6){const[x,y,z,,scale]=layout.rocks.subarray(at,at+6);extra.push({min:[x-scale,y,z-scale],max:[x+scale,y+scale*1.8,z+scale],opacity:.85,albedo:[.30,.28,.24]});}
 for(const landmark of layout.landmarks){const fort=landmark.id==='western-fort';extra.push({min:[landmark.x-(fort?24:11),landmark.y-1,landmark.z-(fort?24:20)],max:[landmark.x+(fort?24:11),landmark.y+(fort?16:10),landmark.z+(fort?24:20)],albedo:[.32,.30,.25],opacity:fort?.7:.35});}
 if(source.proxies.length+extra.length>131072||source.terrain.length>=256)throw Error('Regional GI source exceeds its existing bounded CPU budget.');
 return{...source,generatorVersion:source.generatorVersion+':'+layout.version+':coarse-canopy-v1',terrain:[...source.terrain,horizon],proxies:[...source.proxies,...extra]};
}

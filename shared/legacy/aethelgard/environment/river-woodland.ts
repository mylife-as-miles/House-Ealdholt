import { readEaldholtFoliageDensity, type EaldholtFoliageDensityMetadata } from './foliage-density';

/** Original deterministic woodland, supplied only runtime-private source and
 * generated surfaces. No private source coordinates or actor arrays live here. */
export interface EaldholtWoodlandSurface { positions:ArrayLike<number>;indices:ArrayLike<number> }
export interface EaldholtWoodlandVillage { minX:number;maxX:number;minZ:number;maxZ:number }
export type EaldholtWoodlandRegion = 'source' | 'near' | 'far-fringe' | 'far-deep' | 'mainland';
export interface EaldholtWoodlandPlacement { x:number;y:number;z:number;yaw:number;scale:number;region?:EaldholtWoodlandRegion }
export interface EaldholtWoodlandSupport { height:number;slope:number }
export interface EaldholtWoodlandCrown { x:number;z:number;radius:number }
export interface EaldholtWoodlandSupportIndex { readonly triangles:number;readonly cells:number;readonly lastTriangleTests:number;sample(x:number,z:number):EaldholtWoodlandSupport|null }
/** Stable source-family roles, independent of an importer's display-node names.
 * Grass/flowers and generated woodland metadata never become source trees. */
export function readEaldholtSourceTreeDensityMetadata(value:unknown):EaldholtFoliageDensityMetadata|null {
  if(value===undefined)return null;
  const tag=readEaldholtFoliageDensity(value),expected:Readonly<Record<string,number>>={
    'native-source-field04-v1':4,'native-source-forest05-v1':3,
    'native-source-field02-heroes-v1':3,'native-source-forest01-hero-v1':3,
  };
  if(!Object.prototype.hasOwnProperty.call(expected,tag.family))return null;
  if(tag.components!==expected[tag.family])throw Error('Incomplete authored source-tree family metadata.');
  return tag;
}
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;

/** Broad phase is built once. A candidate tests nearby triangles, never the
 * complete detailed Landscape. Exact barycentric support uses original buffers. */
export function createEaldholtWoodlandSupportIndex(surfaces:readonly EaldholtWoodlandSurface[],cellSize=4):EaldholtWoodlandSupportIndex {
  if(!Number.isFinite(cellSize)||cellSize<=0||cellSize>32)throw Error('Invalid woodland support cell size.');
  const cells=new Map<string,number[]>(),owners:number[]=[],offsets:number[]=[],spill:number[]=[];let last=0;
  for(let s=0;s<surfaces.length;s++){const {positions:p,indices}=surfaces[s];if(p.length%3||indices.length%3)throw Error('Woodland support needs complete XYZ triangles.');
    for(let i=0;i<indices.length;i+=3){const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;if(![a,b,c].every(v=>Number.isSafeInteger(v)&&v>=0&&v+2<p.length)||![p[a],p[a+1],p[a+2],p[b],p[b+1],p[b+2],p[c],p[c+1],p[c+2]].every(Number.isFinite))throw Error('Invalid woodland support triangle.');
      const id=owners.length;owners.push(s);offsets.push(i);const x0=Math.floor(Math.min(p[a],p[b],p[c])/cellSize),x1=Math.floor(Math.max(p[a],p[b],p[c])/cellSize),z0=Math.floor(Math.min(p[a+2],p[b+2],p[c+2])/cellSize),z1=Math.floor(Math.max(p[a+2],p[b+2],p[c+2])/cellSize);
      if((x1-x0+1)*(z1-z0+1)>4096){if(spill.length>=32)throw Error('Too many unbounded support triangles.');spill.push(id);continue;}
      for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const key=`${x},${z}`,list=cells.get(key);if(list)list.push(id);else cells.set(key,[id]);}
    }
  }
  const owner=Int32Array.from(owners),offset=Int32Array.from(offsets);
  return {triangles:owners.length,cells:cells.size,get lastTriangleTests(){return last;},sample(x,z){if(!Number.isFinite(x)||!Number.isFinite(z))return null;let result:EaldholtWoodlandSupport|null=null;last=0;
    const visit=(id:number)=>{last++;const surface=surfaces[owner[id]],p=surface.positions,ix=surface.indices,i=offset[id],a=ix[i]*3,b=ix[i+1]*3,c=ix[i+2]*3,dx1=p[b]-p[a],dz1=p[b+2]-p[a+2],dx2=p[c]-p[a],dz2=p[c+2]-p[a+2],det=dx1*dz2-dx2*dz1;if(Math.abs(det)<1e-9)return;
      const u=((x-p[a])*dz2-(z-p[a+2])*dx2)/det,v=(dx1*(z-p[a+2])-dz1*(x-p[a]))/det;if(u< -1e-5||v< -1e-5||u+v>1+1e-5)return;const dy1=p[b+1]-p[a+1],dy2=p[c+1]-p[a+1],height=p[a+1]+u*dy1+v*dy2,slope=Math.hypot((dy1*dz2-dy2*dz1)/det,(dx1*dy2-dx2*dy1)/det);if(!result||height>result.height)result={height,slope};};
    for(const id of cells.get(`${Math.floor(x/cellSize)},${Math.floor(z/cellSize)}`)??[])visit(id);for(const id of spill)visit(id);return result;
  }};
}
const cached=new WeakMap<EaldholtWoodlandSurface,EaldholtWoodlandSupportIndex>();
/** Existing callers, including shoreline dressing, get the same indexed exact support. */
export function sampleEaldholtWoodlandSupport(surface:EaldholtWoodlandSurface,x:number,z:number){let index=cached.get(surface);if(!index){index=createEaldholtWoodlandSupportIndex([surface]);cached.set(surface,index);}return index.sample(x,z);}
function randomStream(seed=0x6e4d3a29){return()=>{seed=Math.imul(seed^seed>>>15,1|seed);seed^=seed+Math.imul(seed^seed>>>7,61|seed);return((seed^seed>>>14)>>>0)/4294967296;};}

export function createEaldholtWoodlandPlacements(input:{land:EaldholtWoodlandSurface;water:EaldholtWoodlandSurface;village:EaldholtWoodlandVillage;sourceEnvelope?:EaldholtWoodlandVillage;sourceLand?:readonly EaldholtWoodlandSurface[];extraWater?:readonly EaldholtWoodlandSurface[];existingCrowns?:readonly EaldholtWoodlandCrown[];obstacles?:readonly EaldholtWoodlandVillage[];canopyRadius:number;maximumTrees:number;profile:'desktop'|'quest'}):EaldholtWoodlandPlacement[]{
  const{land,water,village,canopyRadius,maximumTrees,profile}=input;if(!Number.isFinite(canopyRadius)||canopyRadius<=0||!Number.isInteger(maximumTrees)||maximumTrees<0||maximumTrees>200)throw Error('Invalid woodland budget or canopy.');
  if(water.positions.length<12||water.positions.length%6)throw Error('Woodland needs paired water banks.');
  const sections:{x:number;low:number;high:number;level:number}[]=[];for(let i=0;i<water.positions.length;i+=6){const p=water.positions,x=(p[i]+p[i+3])/2;if(!Number.isFinite(x)||Math.abs(p[i]-p[i+3])>.001)throw Error('Invalid paired river bank.');sections.push({x,low:Math.min(p[i+2],p[i+5]),high:Math.max(p[i+2],p[i+5]),level:(p[i+1]+p[i+4])/2});}sections.sort((a,b)=>a.x-b.x);
  const west=sections[0].x,east=sections[sections.length-1].x;if(!(east>west))throw Error('River strip has no longitudinal extent.');
  const support=createEaldholtWoodlandSupportIndex([land,...input.sourceLand??[]]),wet=createEaldholtWoodlandSupportIndex([water,...input.extraWater??[]],16),source=input.sourceEnvelope??village;
  const crowns=input.existingCrowns??[],crownCells=new Map<string,number[]>(),crownCell=8;for(let i=0;i<crowns.length;i++){const c=crowns[i];if(![c.x,c.z,c.radius].every(Number.isFinite)||c.radius<0||c.radius>100)throw Error('Invalid existing tree crown.');for(let x=Math.floor((c.x-c.radius)/crownCell);x<=Math.floor((c.x+c.radius)/crownCell);x++)for(let z=Math.floor((c.z-c.radius)/crownCell);z<=Math.floor((c.z+c.radius)/crownCell);z++){const key=`${x},${z}`,list=crownCells.get(key);if(list)list.push(i);else crownCells.set(key,[i]);}}
  function crownConflict(x:number,z:number,r:number){const seen=new Set<number>();for(let cx=Math.floor((x-r)/crownCell);cx<=Math.floor((x+r)/crownCell);cx++)for(let cz=Math.floor((z-r)/crownCell);cz<=Math.floor((z+r)/crownCell);cz++)for(const i of crownCells.get(`${cx},${cz}`)??[]){if(seen.has(i))continue;seen.add(i);const c=crowns[i];if(Math.hypot(c.x-x,c.z-z)<c.radius+r)return true;}return false;}
  function riverAt(x:number){for(let i=1;i<sections.length;i++)if(x>=sections[i-1].x&&x<=sections[i].x){const a=sections[i-1],b=sections[i],t=(x-a.x)/(b.x-a.x);return{low:mix(a.low,b.low,t),high:mix(a.high,b.high,t),level:mix(a.level,b.level,t)};}return null;}
  const result:EaldholtWoodlandPlacement[]=[],bankClusters=[.2,.38,.6,.79];
  const farGroves=[{along:.24,depth:.42},{along:.55,depth:.72},{along:.78,depth:.57}];
  let landMinZ=Infinity,landMaxZ=-Infinity,landMaxX=-Infinity;
  for(let i=0;i<land.positions.length;i+=3){landMinZ=Math.min(landMinZ,land.positions[i+2]);landMaxZ=Math.max(landMaxZ,land.positions[i+2]);landMaxX=Math.max(landMaxX,land.positions[i]);}
  const outer=[{x:mix(source.minX,village.minX,.5),z:mix(source.minZ,source.maxZ,.22)},{x:mix(source.minX,village.minX,.5),z:mix(source.minZ,source.maxZ,.7)},{x:mix(village.maxX,source.maxX,.5),z:mix(source.minZ,source.maxZ,.28)},{x:mix(village.maxX,source.maxX,.5),z:mix(source.minZ,source.maxZ,.76)},{x:mix(source.minX,source.maxX,.28),z:mix(source.minZ,village.minZ,.5)},{x:mix(source.minX,source.maxX,.72),z:mix(source.minZ,village.minZ,.5)},{x:mix(source.minX,source.maxX,.24),z:mix(village.maxZ,source.maxZ,.5)},{x:mix(source.minX,source.maxX,.74),z:mix(village.maxZ,source.maxZ,.5)}];
  const sourceQuota=Math.ceil(maximumTrees*.25),nearQuota=Math.floor(maximumTrees*.25),farQuota=maximumTrees-Math.ceil(maximumTrees*.5)-nearQuota;
  const quotas=[sourceQuota,nearQuota,Math.ceil(farQuota/2),Math.floor(farQuota/2),maximumTrees-sourceQuota-nearQuota-farQuota];
  const labels:readonly EaldholtWoodlandRegion[]=['source','near','far-fringe','far-deep','mainland'];
  const buckets:EaldholtWoodlandPlacement[][]=labels.map(()=>[]),attempts=labels.map(()=>0),quest=profile==='quest';
  // Independent streams keep unsupported far trials from reshuffling near-bank
  // proposals. Accepted shore geometry is reserved before secondary clearings.
  const streams=[0x6e4d3a29,0x6e4d3a2a,0x6e4d3a2b,0x6e4d3a2c,0x6e4d3a2d].map(seed=>randomStream(seed));
  function place(region:number):void{
    const random=streams[region],attempt=attempts[region]++,scale=(quest?.72:.82)+random()*(quest?.4:.43),footprint=canopyRadius*scale;
    let x:number,z:number;
    if(region===0){
      const centre=outer[attempt%outer.length],spread=quest?9:15;
      x=centre.x+(random()+random()-1)*spread;z=centre.z+(random()+random()-1)*spread;
      if(attempt%3===0){x=mix(source.minX,source.maxX,random());z=mix(source.minZ,source.maxZ,random());}
      if(x<source.minX||x>source.maxX||z<source.minZ||z>source.maxZ)return;
    }else if(region===4){
      const north=attempt%2===0,extent=north?source.minZ-landMinZ:landMaxX-source.maxX,inset=footprint+.8;
      if(extent<=inset*2)return;
      const depth=inset+(extent-inset*2)*Math.pow(random(),1.7),cluster=bankClusters[Math.floor(attempt/2)%bankClusters.length],spread=quest?9:16;
      if(north){x=mix(source.minX+inset,source.maxX,cluster)+(random()+random()-1)*spread;z=source.minZ-depth;if(x<source.minX+inset)return;}
      else{x=source.maxX+depth;z=mix(source.minZ,source.maxZ-inset,cluster)+(random()+random()-1)*spread;if(z>source.maxZ-inset)return;}
    }else{
      const grove=farGroves[attempt%farGroves.length],deep=region===3;
      x=mix(west,east,deep?grove.along:bankClusters[attempt%bankClusters.length])+(random()+random()-1)*(quest?9:16);
      const bank=riverAt(x);if(!bank)return;
      const depthSample=random(),inset=footprint+.8;
      if(region===1)z=bank.low-inset-depthSample*(quest?5:11);
      else if(!deep)z=bank.high+inset+depthSample*(quest?5:11);
      else{
        // Merged real terrain is only a proposal ceiling; every root and crown
        // below still needs exact dry support. A few groves leave clearings.
        const deepest=landMaxZ-bank.high-inset;if(deepest<=inset)return;
        const patch=Math.max(0,Math.min(1,grove.depth+(depthSample-.5)*.28));
        z=bank.high+inset+(deepest-inset)*patch;
      }
      if(x>=source.minX&&x<=source.maxX&&z>=source.minZ&&z<=source.maxZ)return;
    }
    const touches=(r:EaldholtWoodlandVillage)=>x-footprint<r.maxX&&x+footprint>r.minX&&z-footprint<r.maxZ&&z+footprint>r.minZ;
    if(touches(village)||(input.obstacles??[]).some(touches)||crownConflict(x,z,footprint))return;
    const root=support.sample(x,z),waterHere=wet.sample(x,z);if(!root||root.slope>.58||waterHere&&root.height<waterHere.height+.18)return;
    let valid=true;for(let edge=0;edge<8&&valid;edge++){const angle=edge*Math.PI/4,sx=x+Math.cos(angle)*footprint,sz=z+Math.sin(angle)*footprint,sample=support.sample(sx,sz),waterAt=wet.sample(sx,sz);if(!sample||sample.slope>.72||Math.abs(sample.height-root.height)>2.8||waterAt&&sample.height<waterAt.height+.18)valid=false;}
    if(!valid||result.some(tree=>Math.hypot(tree.x-x,tree.z-z)<Math.max(3,canopyRadius*(scale+tree.scale)*.68)))return;
    const placement={x,y:root.height,z,scale,yaw:random()*Math.PI*2,region:labels[region]};
    result.push(placement);buckets[region].push(placement);
  }
  // Reserve the near shore first, then its far counterpart. Neither secondary
  // trees nor failed far searches can change the accepted near sequence.
  for(const region of [1,2])for(let attempt=0;attempt<maximumTrees*80&&buckets[region].length<quotas[region];attempt++)place(region);
  const secondary=[0,3,4];
  for(let attempt=0;attempt<maximumTrees*100&&result.length<maximumTrees;attempt++){
    if(secondary.every(region=>buckets[region].length>=quotas[region]))break;
    const region=secondary[attempt%secondary.length];if(buckets[region].length<quotas[region])place(region);
  }
  // Riparian and deep subshares stay capped. Missing supported slots may use
  // source/mainland ground only after shore reservations have been exhausted;
  // labels retain any shortfall rather than presenting fallback as bank trees.
  for(let attempt=0;attempt<maximumTrees*80&&result.length<maximumTrees;attempt++)place(attempt%2===0?0:4);
  const far:EaldholtWoodlandPlacement[]=[],fringe=buckets[2],deep=buckets[3];
  for(let i=0;i<Math.max(fringe.length,deep.length);i++){if(fringe[i])far.push(fringe[i]);if(deep[i])far.push(deep[i]);}
  const regions=[buckets[0],buckets[1],far,buckets[4]],interleaved:EaldholtWoodlandPlacement[]=[];
  for(let i=0;i<Math.max(...regions.map(bucket=>bucket.length));i++)for(const bucket of regions)if(bucket[i])interleaved.push(bucket[i]);
  return interleaved;
}

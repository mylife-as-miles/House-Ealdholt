import { Rng } from '../../environment/kernel';
import { distanceToSettlementPath,settlementHeight,settlementShore,settlementSiteFree } from '../../environment/settlement/layout';
/** Crownfall placements of actual source rock recipes. Conservative bounds
 * contain all source rock LODs and are shared by rendering, walking and editing. */
export function sourceShoreSites(){
 const rng=Rng.fromKey('combined-source-rock-shore-clusters'),sites:{kind:'block'|'slab'|'shard';x:number;z:number;scale:number;yaw:number;radius:number}[]=[];
 // Three to five actual source rocks form each irregular shoreline outcrop,
 // leaving short sandy interruptions instead of a regularly spaced bead line.
 for(let centre=-104;centre<108;centre+=17+rng.next()*7){
  const count=3+Math.floor(rng.next()*3),spread=3.2+rng.next()*2.5;
  for(let i=0;i<count;i++){
   const z=centre+rng.jitter(spread),x=settlementShore(z)+.8+rng.jitter(1.6),scale=i===0?1.6+rng.next()*.65:.65+rng.next()*1.0,radius=2*scale,yaw=rng.next()*Math.PI*2,kind=(i===0?'slab':rng.next()<.55?'block':'shard') as 'block'|'slab'|'shard';
   if(distanceToSettlementPath(x,z)<radius+.7||!settlementSiteFree(x,z,radius+.5))continue;
   sites.push({kind,x,z,scale,yaw,radius});
  }
 }
 return sites;
}
export function sourceShoreObstacles(){return sourceShoreSites().map(site=>({x:site.x,z:site.z,width:site.radius*2,depth:site.radius*2,yaw:0}));}
export function sourceShoreColliders(){return sourceShoreSites().map(site=>({center:[site.x,settlementHeight(site.x,site.z)-.2,site.z] as [number,number,number],halfExtents:[site.radius,site.radius,site.radius] as [number,number,number],yaw:0,landmark:null,blocksCamera:true}));}

import type {BuildingDamageBinding} from './building-damage';
import type {RaidBearing} from './bandit-raid';

export const BUILDING_PARTS_CATALOGUE_VERSION='raid-building-parts-v1';
export type SourcePoint=readonly [number,number,number];
export interface BuildingSourceBounds {readonly min:SourcePoint;readonly max:SourcePoint}
export type BuildingPartKind='door'|'wall'|'gable'|'roof'|'frame';
export interface BuildingSourcePart {
 readonly id:string;readonly kind:BuildingPartKind;readonly bounds:BuildingSourceBounds;readonly supported?:boolean;
 /** Exact authored node/instance correspondence, never a proximity match. */
 readonly sourceActor?:string;readonly sourceOrdinal?:number;readonly sourceWorldMatrix?:readonly number[];
}
export interface SourceBuilding {
 readonly binding:BuildingDamageBinding;readonly bounds:BuildingSourceBounds;
 readonly parts:readonly BuildingSourcePart[];readonly position:SourcePoint;
 readonly outward:SourcePoint;readonly bearing:RaidBearing;
}
export function buildingPartKind(name:string):BuildingPartKind|null {
 if(/Medieval_Modular_Door/i.test(name))return'door';
 if(/Medieval_Modular_Gable/i.test(name))return'gable';
 if(/Medieval_Modular_(Wall|Corner)/i.test(name))return'wall';
 if(/^(?:Wall_400x200|çatı)(?:_cell|$)/u.test(name))return'roof';
 if(/^duvar(?:_cell|$)/.test(name))return'frame';
 return null;
}
const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
const validBounds=(b:BuildingSourceBounds)=>[...b.min,...b.max].every(Number.isFinite)&&b.min.every((v,k)=>v<=b.max[k]);
const touches=(a:BuildingSourceBounds,b:BuildingSourceBounds)=>a.min.every((v,k)=>v<=b.max[k]+.08&&a.max[k]+.08>=b.min[k]);
const midpoint=(b:BuildingSourceBounds):SourcePoint=>b.min.map((v,k)=>(v+b.max[k])/2)as unknown as SourcePoint;
export function containsBuildingPoint(bounds:BuildingSourceBounds,point:SourcePoint):boolean {
 return point.every((v,k)=>Number.isFinite(v)&&v>=bounds.min[k]&&v<=bounds.max[k]);
}
/** Source-module association, not a household/structural/collision certificate.
 * Only existing modular architecture participates; fences, props and terrain do
 * not join buildings. Ambiguous oversized or unsupported components stay whole. */
export function buildSourceBuildingCatalogue(input:{sourceSha256:string;profile:'desktop'|'quest';parts:readonly BuildingSourcePart[]}) {
 if(!/^[a-f0-9]{64}$/.test(input.sourceSha256))throw Error('Building catalogue requires the verified source SHA-256.');
 const ids=new Set<string>();
 for(const part of input.parts){if(!part.id||ids.has(part.id)||!validBounds(part.bounds))throw Error('Invalid or duplicate source building part.');ids.add(part.id);}
 const remaining=new Set(input.parts),components:{parts:BuildingSourcePart[];bounds:BuildingSourceBounds;id:string}[]=[];
 let held=0;
 while(remaining.size){
  const first=remaining.values().next().value!;remaining.delete(first);const parts=[first];
  for(let k=0;k<parts.length;k++)for(const other of remaining)if(touches(parts[k].bounds,other.bounds)){remaining.delete(other);parts.push(other);}
  const doors=parts.filter(p=>p.kind==='door').sort((a,b)=>order(a.id,b.id));
  if(!doors.length)continue;
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const part of parts)for(let k=0;k<3;k++){min[k]=Math.min(min[k],part.bounds.min[k]);max[k]=Math.max(max[k],part.bounds.max[k]);}
  const bounds={min:min as unknown as SourcePoint,max:max as unknown as SourcePoint};
  if(parts.some(p=>p.supported===false)||parts.length>256||parts.length<3||max[0]-min[0]>24||max[2]-min[2]>24||max[1]-min[1]>18
   ||!parts.some(p=>p.kind==='roof'||p.kind==='gable')){held++;continue;}
  components.push({parts:parts.sort((a,b)=>order(a.id,b.id)),bounds,id:'door:'+doors[0].id});
 }
 const middle:SourcePoint=components.length?[components.reduce((s,c)=>s+midpoint(c.bounds)[0],0)/components.length,0,components.reduce((s,c)=>s+midpoint(c.bounds)[2],0)/components.length]:[0,0,0];
 const distance=(c:typeof components[number])=>Math.hypot(midpoint(c.bounds)[0]-middle[0],midpoint(c.bounds)[2]-middle[2]);
 components.sort((a,b)=>distance(b)-distance(a)||order(a.id,b.id));
 const catalogueId=`${BUILDING_PARTS_CATALOGUE_VERSION}:${input.profile}:${input.sourceSha256}`;
 const buildings:SourceBuilding[]=components.map((c,siteIndex)=>{
  const centre=midpoint(c.bounds),dx=centre[0]-middle[0],dz=centre[2]-middle[2],length=Math.hypot(dx,dz)||1;
  const bearing:RaidBearing=Math.abs(dx)>Math.abs(dz)?dx>0?'east':'west':dz<0?'north':'south';
  return Object.freeze({binding:Object.freeze({catalogueId,sourceSha256:input.sourceSha256,profile:input.profile,buildingId:c.id,siteIndex}),
   bounds:Object.freeze({min:Object.freeze(c.bounds.min),max:Object.freeze(c.bounds.max)}),parts:Object.freeze(c.parts),position:Object.freeze([centre[0],c.bounds.min[1],centre[2]])as SourcePoint,outward:Object.freeze([dx/length,0,dz/length])as SourcePoint,bearing});
 });
 return{catalogueId,buildings:Object.freeze(buildings),sites:Object.freeze(buildings.slice(0,Math.max(3,Math.ceil(buildings.length/2)))),held};
}

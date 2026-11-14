/** Source-module rigid collapse. No renderer, replacement scenery or frame clock.
 * Fixed 60 Hz gravity, semi-implicit integration and conservative box contacts.
 * The authored modules are the bodies; their source vertex/index data stays borrowed.
 * This deliberately bounded solver uses module AABBs, not triangle fracture or Jolt.
 * Each episode stops after eight simulated seconds; its contacted ruin is persistent.
 */
import type {BuildingConditionRecord,BuildingDamageBinding} from './building-damage';
import type {BuildingSourceBounds,BuildingSourcePart,SourceBuilding,SourcePoint} from './building-damage-catalogue';

export const BUILDING_COLLAPSE_STEP=1/60;
export const BUILDING_COLLAPSE_MAX_STEPS=480;
export interface BuildingPhysicalDisasterRecord extends Pick<BuildingConditionRecord,'binding'|'condition'|'rebuild'> {
 readonly collapseAtMinute?:number;
 readonly burnedAtMinute?:number;
}
export interface BuildingCollapseCollider {
 readonly id:string;readonly binding:BuildingDamageBinding;readonly sourcePartId:string;
 readonly activeFromAbsoluteMinute:number;readonly bounds:BuildingSourceBounds;readonly state:'source'|'falling'|'settled'|'restored';
}
export interface BuildingCollapseTransform {
 readonly sourcePartId:string;
 /** Source-coordinate rigid delta about the original module centre. */
 readonly translation:SourcePoint;readonly rotation:SourcePoint;readonly centre:SourcePoint;
 readonly state:BuildingCollapseCollider['state'];
}
type V=[number,number,number];
type Body={part:BuildingSourcePart;centre:V;position:V;velocity:V;rotation:V;omega:number;axis:0|2;sign:number;limit:number;contact:boolean;supportFootprint:number[];supportHeight:number;checkpoint:Float64Array;bounds:{min:V;max:V};sweep:{min:V;max:V}|null};
type Episode={building:SourceBuilding;at:number;steps:number;bodies:Body[];repair:number;held:boolean};
type StepMetrics={contacts:number;terrainSamples:number;steps:number};
const key=(b:BuildingDamageBinding)=>JSON.stringify([b.catalogueId,b.sourceSha256,b.profile,b.buildingId,b.siteIndex]);
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const seed=(s:string)=>{let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return(h>>>0)/4294967296;};
const overlaps=(a:BuildingSourceBounds,b:BuildingSourceBounds)=>a.min.every((v,k)=>v<b.max[k]-1e-7&&a.max[k]>b.min[k]+1e-7);
const horizontal=(a:BuildingSourceBounds,b:BuildingSourceBounds)=>a.min[0]<b.max[0]-1e-6&&a.max[0]>b.min[0]+1e-6&&a.min[2]<b.max[2]-1e-6&&a.max[2]>b.min[2]+1e-6;
function bodyBounds(body:Body):void {
 const p=body.part.bounds,h=p.max.map((v,k)=>(v-p.min[k])/2),a=body.rotation[body.axis],c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));
 const half:V=body.axis===0?[h[0],c*h[1]+s*h[2],s*h[1]+c*h[2]]:[c*h[0]+s*h[1],s*h[0]+c*h[1],h[2]];
 for(let k=0;k<3;k++){body.bounds.min[k]=body.position[k]-half[k];body.bounds.max[k]=body.position[k]+half[k];}
 if(body.sweep){
  // A projected contact may move a module more than once within one fixed
  // step. Include every accepted solver pose, not just its final correction.
  const saved=body.checkpoint,from=saved[6+body.axis],to=body.rotation[body.axis];
  const maxCos=from*to<=0?1:Math.max(Math.cos(from),Math.cos(to)),maxSin=Math.max(Math.abs(Math.sin(from)),Math.abs(Math.sin(to)));
  const sweptHalf:V=body.axis===0?[h[0],maxCos*h[1]+maxSin*h[2],maxSin*h[1]+maxCos*h[2]]:[maxCos*h[0]+maxSin*h[1],maxSin*h[0]+maxCos*h[1],h[2]];
  for(let k=0;k<3;k++){body.sweep.min[k]=Math.min(body.sweep.min[k],saved[k]-sweptHalf[k],body.position[k]-sweptHalf[k]);body.sweep.max[k]=Math.max(body.sweep.max[k],saved[k]+sweptHalf[k],body.position[k]+sweptHalf[k]);}
 }
}
function makeEpisode(building:SourceBuilding,at:number):Episode {
 const bodies=building.parts.map(part=>{
  const centre=part.bounds.min.map((v,k)=>(v+part.bounds.max[k])/2)as V,r=seed(part.id),roof=part.kind==='roof'||part.kind==='gable';
  const dx=centre[0]-building.position[0],dz=centre[2]-building.position[2],l=Math.hypot(dx,dz)||1;
  const axis:0|2=part.bounds.max[0]-part.bounds.min[0]>=part.bounds.max[2]-part.bounds.min[2]?0:2;
  const body:Body={part,centre,position:[...centre],velocity:[dx/l*(.12+r*.12),0,dz/l*(.12+r*.12)],rotation:[0,0,0],omega:(r<.5?-1:1)*(roof?.15:.35),axis,sign:r<.5?-1:1,limit:roof?.32:1.48,contact:false,supportFootprint:[],supportHeight:0,checkpoint:new Float64Array(11),bounds:{min:[0,0,0],max:[0,0,0]},sweep:null};
  bodyBounds(body);return body;
 });
 return{building,at,steps:0,bodies,repair:0,held:false};
}
function copyEpisode(source:Episode):Episode {
 const result=makeEpisode(source.building,source.at);result.steps=source.steps;result.repair=source.repair;result.held=source.held;
 for(let i=0;i<result.bodies.length;i++){const body=result.bodies[i],old=source.bodies[i];for(let axis=0;axis<3;axis++){body.position[axis]=old.position[axis];body.velocity[axis]=old.velocity[axis];body.rotation[axis]=old.rotation[axis];}body.omega=old.omega;body.contact=old.contact;bodyBounds(body);}
 return result;
}
const targetSteps=(at:number,minute:number,secondsPerMinute:number)=>clamp(Math.floor((minute-at)*secondsPerMinute/BUILDING_COLLAPSE_STEP+1e-7),0,BUILDING_COLLAPSE_MAX_STEPS);
function repaired(episode:Episode):Set<string> {
 // Actual earned labour restores complete original modules from the foundation up.
 // Finish the bounded fall first. This also makes cold-load/replay independent
 // of the render at which the current earned labour was first observed.
 if(episode.steps<BUILDING_COLLAPSE_MAX_STEPS)return new Set<string>();
 const order=[...episode.bodies].sort((a,b)=>a.part.bounds.min[1]-b.part.bounds.min[1]||a.part.id.localeCompare(b.part.id));
 return new Set(order.slice(0,Math.floor(order.length*episode.repair)).map(b=>b.part.id));
}
export function createBuildingCollapse(input:{readonly buildings:readonly SourceBuilding[];readonly groundHeight?:(x:number,z:number)=>number;readonly secondsPerWorldMinute?:()=>number}) {
 if(input.buildings.length>512||input.buildings.reduce((n,b)=>n+b.parts.length,0)>4096)throw Error('Physical building catalogue exceeds its source-module budget.');
 const catalogue=new Map(input.buildings.map(b=>[key(b.binding),b])),episodes=new Map<string,Episode>();
 let colliders:readonly BuildingCollapseCollider[]=[],obstacles:readonly BuildingCollapseCollider[]=[],transforms:readonly BuildingCollapseTransform[]=[],signature='',revision=0;
 const stats={fixedStep:BUILDING_COLLAPSE_STEP,maxEpisodeSteps:BUILDING_COLLAPSE_MAX_STEPS,activeBuildings:0,fallingParts:0,settledParts:0,restoredParts:0,heldBuildings:0,heldParts:0,supportHolds:0,steps:0,contacts:0,terrainSamples:0,revision:0,contactModel:'source-module-aabb' as const};
 function floor(body:Body,building:SourceBuilding,metrics:StepMetrics=stats):number {
  // Compatibility for callers without terrain data; actual scene callers pass
  // their authoritative sampler and must hold on unavailable source support.
  if(!input.groundHeight)return building.bounds.min[1];
  const minX=body.bounds.min[0],maxX=body.bounds.max[0],minZ=body.bounds.min[2],maxZ=body.bounds.max[2],cached=body.supportFootprint;
  if(cached.length&&Math.abs(minX-cached[0])<=1e-6&&Math.abs(maxX-cached[1])<=1e-6&&Math.abs(minZ-cached[2])<=1e-6&&Math.abs(maxZ-cached[3])<=1e-6)return body.supportHeight;
  // An explicit source sampler is authoritative. A missing corner cannot be
  // replaced with the original foundation or a different finite corner.
  let h=-Infinity;for(const x of[minX,body.position[0],maxX])for(const z of[minZ,body.position[2],maxZ]){
   let v:number;metrics.terrainSamples++;try{v=input.groundHeight(x,z);}catch{cached.length=0;return NaN;}
   if(!Number.isFinite(v)){cached.length=0;return NaN;}h=Math.max(h,v);
  }
  cached[0]=minX;cached[1]=maxX;cached[2]=minZ;cached[3]=maxZ;body.supportHeight=h;return h;
 }
 function rollback(episode:Episode,contacts:number,metrics:StepMetrics):false {
  for(const body of episode.bodies){const saved=body.checkpoint;for(let k=0;k<3;k++){body.position[k]=saved[k];body.velocity[k]=saved[k+3];body.rotation[k]=saved[k+6];}
   body.omega=saved[9];body.contact=!!saved[10];body.supportFootprint.length=0;bodyBounds(body);}
  metrics.contacts=contacts;return false;
 }
 function step(episode:Episode,restored:Set<string>,metrics:StepMetrics=stats):boolean {
  const contacts=metrics.contacts;
  for(const body of episode.bodies){const saved=body.checkpoint;for(let k=0;k<3;k++){saved[k]=body.position[k];saved[k+3]=body.velocity[k];saved[k+6]=body.rotation[k];}saved[9]=body.omega;saved[10]=+body.contact;}
  for(const b of episode.bodies){
   if(restored.has(b.part.id))continue;
   b.contact=false;b.velocity[1]-=9.81*BUILDING_COLLAPSE_STEP;
   b.omega+=b.sign*2.2*Math.max(.08,Math.cos(b.rotation[b.axis]))*BUILDING_COLLAPSE_STEP;
   const old=b.rotation[b.axis];b.rotation[b.axis]=clamp(old+b.omega*BUILDING_COLLAPSE_STEP,-b.limit,b.limit);if(Math.abs(b.rotation[b.axis])===b.limit)b.omega=0;
   for(let k=0;k<3;k++)b.position[k]+=b.velocity[k]*BUILDING_COLLAPSE_STEP;
   // Collapse stays local to its actual source building; no roaming rubble bodies.
   b.position[0]=clamp(b.position[0],b.centre[0]-1.25,b.centre[0]+1.25);b.position[2]=clamp(b.position[2],b.centre[2]-1.25,b.centre[2]+1.25);bodyBounds(b);
  }
  // Three deterministic projected-contact passes over the real falling modules.
  for(let pass=0;pass<3;pass++)for(let i=0;i<episode.bodies.length;i++){
   const a=episode.bodies[i];if(restored.has(a.part.id))continue;
   const ground=floor(a,episode.building,metrics);if(!Number.isFinite(ground))return rollback(episode,contacts,metrics);if(a.bounds.min[1]<ground){a.position[1]+=ground-a.bounds.min[1];a.velocity[1]=0;a.velocity[0]*=.82;a.velocity[2]*=.82;a.contact=true;metrics.contacts++;bodyBounds(a);}
   for(let j=0;j<episode.bodies.length;j++){
    if(i===j)continue;const b=episode.bodies[j],fixed=restored.has(b.part.id),bb=fixed?b.part.bounds:b.bounds;
    if(!overlaps(a.bounds,bb))continue;
    const depth=[Math.min(a.bounds.max[0]-bb.min[0],bb.max[0]-a.bounds.min[0]),Math.min(a.bounds.max[1]-bb.min[1],bb.max[1]-a.bounds.min[1]),Math.min(a.bounds.max[2]-bb.min[2],bb.max[2]-a.bounds.min[2])];
    let axis=depth[0]<depth[2]?0:2;if(depth[1]<depth[axis])axis=1;
    const other=(bb.min[axis]+bb.max[axis])/2,sign=a.position[axis]>=other?1:-1;
    const correction=depth[axis]*(fixed?1:.5)+1e-6;a.position[axis]+=sign*correction;
    if(a.velocity[axis]*sign<0)a.velocity[axis]=0;
    if(axis===1&&sign>0){a.contact=true;a.velocity[0]*=.9;a.velocity[2]*=.9;}
    metrics.contacts++;bodyBounds(a);
   }
   // Other original buildings remain static source contacts. Their buffers,
   // catalogue and transforms never enter this episode's ownership.
   for(const building of input.buildings){if(building===episode.building||!horizontal(a.bounds,building.bounds))continue;for(const part of building.parts){if(!overlaps(a.bounds,part.bounds))continue;const top=part.bounds.max[1];if(a.position[1]>(part.bounds.min[1]+top)/2){a.position[1]+=top-a.bounds.min[1];a.velocity[1]=0;a.contact=true;metrics.contacts++;bodyBounds(a);}}}
  }
  // Pair projection can press a supporting module down a fraction; terrain is
  // the final unilateral contact and must never be penetrated at publication.
  for(const b of episode.bodies){if(restored.has(b.part.id))continue;const support=floor(b,episode.building,metrics);if(!Number.isFinite(support))return rollback(episode,contacts,metrics);if(b.bounds.min[1]<support){b.position[1]+=support-b.bounds.min[1];b.velocity[1]=0;b.contact=true;bodyBounds(b);}}
  episode.steps++;metrics.steps++;return true;
 }
 function supported(episode:Episode,metrics:StepMetrics):boolean {
  if(input.groundHeight)for(const body of episode.bodies){body.supportFootprint.length=0;if(!Number.isFinite(floor(body,episode.building,metrics)))return false;}
  return true;
 }
 function worldSeconds():number {
  const seconds=input.secondsPerWorldMinute?.()??60;
  if(!Number.isFinite(seconds)||seconds<=0||seconds>3600)throw Error('Physical collapse needs the world clock duration, not render-frame time.');
  return seconds;
 }
 function publish():boolean {
  const next:BuildingCollapseCollider[]=[],changes:BuildingCollapseTransform[]=[],dynamic:BuildingCollapseCollider[]=[];let falling=0,settled=0,restoredCount=0;
  for(const building of input.buildings){const episode=episodes.get(key(building.binding)),restored=episode?repaired(episode):new Set<string>();
   for(const part of building.parts){const body=episode?.bodies.find(b=>b.part===part),isRestored=restored.has(part.id),state:BuildingCollapseCollider['state']=!body||episode!.held&&episode!.steps===0?'source':isRestored?'restored':episode!.steps>=BUILDING_COLLAPSE_MAX_STEPS?'settled':'falling';
    const bounds=body&&!isRestored&&state!=='source'?body.bounds:part.bounds;
    const collider:BuildingCollapseCollider=Object.freeze({id:building.binding.buildingId+':'+part.id,binding:building.binding,sourcePartId:part.id,state,activeFromAbsoluteMinute:episode?.at??0,bounds:Object.freeze({min:Object.freeze([...bounds.min])as SourcePoint,max:Object.freeze([...bounds.max])as SourcePoint})});next.push(collider);
    if(episode){dynamic.push(collider);if(state==='falling')falling++;else if(state==='settled')settled++;else if(state==='restored')restoredCount++;}
    changes.push({sourcePartId:part.id,centre:body?.centre??part.bounds.min,translation:body&&!isRestored?body.position.map((v,k)=>v-body.centre[k])as V:[0,0,0],rotation:body&&!isRestored?[...body.rotation]:[0,0,0],state});
   }
  }
  const serial=JSON.stringify([changes,[...episodes.values()].map(e=>[key(e.building.binding),e.at])]);const changed=serial!==signature;if(changed){signature=serial;revision++;colliders=Object.freeze(next);obstacles=Object.freeze(dynamic);transforms=Object.freeze(changes);}let heldBuildings=0,heldParts=0;for(const episode of episodes.values())if(episode.held){heldBuildings++;heldParts+=episode.bodies.length;}Object.assign(stats,{activeBuildings:episodes.size,fallingParts:falling,settledParts:settled,restoredParts:restoredCount,heldBuildings,heldParts,revision});return changed;
 }
 publish();
 return{
  stats,
  update(records:readonly BuildingPhysicalDisasterRecord[],minute:number):boolean {
   if(!Number.isFinite(minute)||minute<0)throw Error('Physical collapse needs a finite source clock minute.');
   const secondsPerMinute=worldSeconds();
   const live=new Set<string>();let changed=false;
   for(const record of [...records].sort((a,b)=>key(a.binding).localeCompare(key(b.binding)))){
    const id=key(record.binding),building=catalogue.get(id);if(!building||live.has(id)||!['burned','rebuilding'].includes(record.condition))continue;
    const at=record.collapseAtMinute??record.burnedAtMinute;if(typeof at!=='number'||!Number.isFinite(at)||at<0||minute<at)continue;live.add(id);
    let episode=episodes.get(id);const target=targetSteps(at,minute,secondsPerMinute);
    const r=record.rebuild,repair=record.condition==='rebuilding'&&r&&Number.isFinite(r.labourDone)&&Number.isFinite(r.labourRequired)&&r.labourRequired>0?clamp(r.labourDone/r.labourRequired,0,1):0;
    if(!episode||episode.at!==at||target<episode.steps){episode=makeEpisode(building,at);episodes.set(id,episode);changed=true;}
    // Recheck source availability once per update; a warm footprint cache must
    // not hide terrain loss when the next scene source query is unavailable.
    if(!supported(episode,stats)){if(!episode.held){episode.held=true;stats.supportHolds++;changed=true;}continue;}
    if(episode.held){episode.held=false;changed=true;}
    if(episode.repair!==repair)changed=true;
    episode.repair=repair;const restored=new Set<string>();while(episode.steps<target){if(!step(episode,restored)){episode.held=true;stats.supportHolds++;changed=true;break;}changed=true;}
   }
   for(const id of episodes.keys())if(!live.has(id)){episodes.delete(id);changed=true;}return changed?publish():false;
  },
  /** Pure interval projection for navigation. Source-bound copies use the same
   * 60 Hz solver, terrain and one clock ratio, without advancing this owner.
   * Every accepted step unions its centre path and rotation-corner envelope;
   * an unsupported tentative step contributes nothing beyond the held pose. */
  sweptObstacles(records:readonly BuildingPhysicalDisasterRecord[],fromMinute:number,toMinute:number):readonly BuildingCollapseCollider[]{
   if(!Number.isFinite(fromMinute)||fromMinute<0||!Number.isFinite(toMinute)||toMinute<fromMinute)throw Error('Physical collapse sweep needs a finite ordered source-clock interval.');
   const seconds=worldSeconds(),seen=new Set<string>(),result:BuildingCollapseCollider[]=[],metrics:StepMetrics={contacts:0,terrainSamples:0,steps:0},none=new Set<string>();
   for(const record of [...records].sort((a,b)=>key(a.binding).localeCompare(key(b.binding)))){
    const id=key(record.binding),building=catalogue.get(id),at=record.collapseAtMinute??record.burnedAtMinute;
    if(!building||seen.has(id)||!['burned','rebuilding'].includes(record.condition)||typeof at!=='number'||!Number.isFinite(at)||at<0||at>toMinute)continue;seen.add(id);
    const from=targetSteps(at,fromMinute,seconds),to=targetSteps(at,toMinute,seconds),cached=episodes.get(id);
    const episode=cached&&cached.at===at&&cached.steps<=from?copyEpisode(cached):makeEpisode(building,at);
    const r=record.rebuild,repair=record.condition==='rebuilding'&&r&&Number.isFinite(r.labourDone)&&Number.isFinite(r.labourRequired)&&r.labourRequired>0?clamp(r.labourDone/r.labourRequired,0,1):0;
    episode.held=!supported(episode,metrics);if(!episode.held){episode.repair=repair;while(episode.steps<from)if(!step(episode,none,metrics)){episode.held=true;break;}}
    const restored=repaired(episode),swept=episode.bodies.filter(body=>!restored.has(body.part.id)).map(body=>{
     const bounds=episode.steps===0?body.part.bounds:body.bounds;
     body.sweep={min:[...bounds.min]as V,max:[...bounds.max]as V};return{body,min:[...bounds.min]as V,max:[...bounds.max]as V,moved:false};
    });
    while(!episode.held&&episode.steps<to){
     for(const entry of swept)for(let axis=0;axis<3;axis++){entry.body.sweep!.min[axis]=entry.body.bounds.min[axis];entry.body.sweep!.max[axis]=entry.body.bounds.max[axis];}
     if(!step(episode,none,metrics)){episode.held=true;break;}
     for(const entry of swept){for(let axis=0;axis<3;axis++){entry.min[axis]=Math.min(entry.min[axis],entry.body.sweep!.min[axis]);entry.max[axis]=Math.max(entry.max[axis],entry.body.sweep!.max[axis]);}entry.moved=true;}
    }
    for(const entry of swept)result.push(Object.freeze({id:building.binding.buildingId+':'+entry.body.part.id,binding:building.binding,sourcePartId:entry.body.part.id,activeFromAbsoluteMinute:at,
     state:entry.moved?'falling':episode.held&&episode.steps===0?'source':episode.steps>=BUILDING_COLLAPSE_MAX_STEPS?'settled':'falling',
     bounds:Object.freeze({min:Object.freeze(entry.min)as SourcePoint,max:Object.freeze(entry.max)as SourcePoint})}));
   }
   return Object.freeze(result);
  },
  colliders:()=>colliders,navigationObstacles:()=>obstacles,transforms:()=>transforms,
  intersects(bounds:BuildingSourceBounds){return colliders.some(c=>overlaps(c.bounds,bounds));},
  clear(){episodes.clear();return publish();},
 };
}

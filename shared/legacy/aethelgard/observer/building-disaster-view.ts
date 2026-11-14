/** Shared, read-only view of the saved disaster at one completed world minute.
 * The source callbacks prove equipment/geometry; neither a rendered mesh nor
 * a current camera grants knowledge, navigation, water or repair credit. */
import type {ObserverSave} from './observer-save';
import {buildingDamageKey,type BuildingDamageBinding} from './building-damage';
import type {SourceBuilding,SourcePoint} from './building-damage-catalogue';
import {buildingFireIncidentId,buildingDisasterConditions,type BuildingLocalRebuildOrder} from './building-disaster-session';
import {BUILDING_CONFLAGRATION_RULES} from './building-conflagration';
import {createBuildingCollapse} from './building-collapse';
import {buildingSourceFingerprint} from './building-source-identity';
import type {VillageSiteLayout} from '../characters/village-site';
import {resolveVillageSiteEndpoint} from '../characters/village-site';
import {validateVillageSiteEmergencyRefuges,scopedVillageEmergencyRefugeSite,villageRefugeClearOfOperations} from '../characters/village-emergency-refuges';
import type {VillagePopulationRuntime} from '../characters/village-population-runtime';
import type {ResidentWorkplaceFrame} from '../characters/resident-workplace-frame';
import {villageLifeObstacleContainsPoint,type VillageLifeNavigationObstacle} from '../characters/village-life-navigation';
import type {ResidentBuildingEmergencyFrame,ResidentBuildingEmergencyStation,ResidentBuildingIncident,ResidentBuildingPlaceAssociation} from '../characters/resident-building-emergency';

/** Existing fire physics adds at most42 structural damage per completed minute
 * (maximum1000 intensity ×.042). Close water contact withdraws three such ticks
 * before the existing700 collapse threshold. This is response tuning, not a
 * change to damage, collapse, obstacle bounds, source geometry or walk speed. */
export const BUILDING_CLOSE_WORK_RETREAT_DAMAGE=BUILDING_CONFLAGRATION_RULES.collapseDamage-3*Math.round(1000*.042);

export interface BuildingFireHazardVolume {readonly id:string;readonly sourcePartId:string;readonly bounds:SourceBuilding['bounds']}
export interface BuildingDisasterViewSource {
 readonly buildings:readonly SourceBuilding[];readonly site:VillageSiteLayout;readonly siteIdentity:string;readonly workplaceFrame?:ResidentWorkplaceFrame|null;
 readonly associations:readonly ResidentBuildingPlaceAssociation[];
 readonly stations:readonly ResidentBuildingEmergencyStation[];
 /** Live display obstacles are diagnostic only. Historical frame assembly
  * projects the saved collapse independently and never mutates scene geometry. */
 readonly obstacles:readonly VillageLifeNavigationObstacle[];
 readonly groundHeight?:(x:number,z:number)=>number;
 /** Original triangles conservatively localized into bounded source volumes. */
 readonly fireHazardsFor?:(binding:BuildingDamageBinding)=>readonly BuildingFireHazardVolume[];
}
export interface BuildingDisasterFrameInput extends BuildingDisasterViewSource {
 readonly absoluteMinute:number;readonly populationSnapshot?:VillagePopulationRuntime|null;
 readonly secondsPerWorldMinute?:number;
}
export type BuildingDisasterFrame=ResidentBuildingEmergencyFrame&{
 readonly siteIdentity:string;readonly repairOrders:readonly BuildingLocalRebuildOrder[];
};
const key=(binding:BuildingDamageBinding)=>buildingDamageKey(binding)+':'+binding.siteIndex;
const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
const whole=(n:number)=>Number.isSafeInteger(n)&&n>=0;
// Authored actor names may be Unicode and several hundred bytes long. Nav IDs
// are bounded ASCII identifiers; exact source binding/part data stays intact.
const obstacleId=(prefix:string,identity:string)=>prefix+buildingSourceFingerprint(new TextEncoder().encode(identity));
const physicalProjections=new WeakMap<readonly SourceBuilding[],{seconds:number;ground:BuildingDisasterViewSource['groundHeight'];owner:ReturnType<typeof createBuildingCollapse>}>();

/** Incidents first, so source station authors can select existing certified
 * equipment before the frame receives its resident-local report recipients. */
export function buildingDisasterIncidents(saved:ObserverSave,absoluteMinute:number):readonly ResidentBuildingIncident[]{
 if(!whole(absoluteMinute))throw Error('Disaster incidents require a completed world minute.');
 if(saved.buildingFire?.status==='invalid'||saved.buildingDamage?.status==='invalid'||saved.localRebuildOrders?.status==='invalid')return[];
 if(saved.buildingFire?.status==='valid'&&saved.buildingFire.state.absoluteMinute>absoluteMinute)throw Error('Future fire state cannot be projected into earlier resident history.');
 const incidents:ResidentBuildingIncident[]=[],seen=new Set<string>();
 if(saved.buildingFire?.status==='valid')for(const fire of saved.buildingFire.state.buildings){
  if(fire.rebuiltAtMinute!==null&&fire.rebuiltAtMinute<=absoluteMinute)seen.add(key(fire.binding));
  const id=buildingFireIncidentId(fire);if(!id||!fire.ignition||fire.ignition.minute>absoluteMinute||fire.phase==='sound')continue;
  seen.add(key(fire.binding));incidents.push({id,binding:fire.binding,burning:fire.phase==='burning',requiresRepair:fire.structuralDamage>0||fire.collapsedAtMinute!==null,unsafeForCloseWork:fire.structuralDamage>=BUILDING_CLOSE_WORK_RETREAT_DAMAGE||fire.collapsedAtMinute!==null,
   observedAbsoluteMinute:fire.ignition.minute,expiresAbsoluteMinute:Math.min(Number.MAX_SAFE_INTEGER,absoluteMinute+2),knownByResidentIds:[],affectedResidentIds:[]});
 }
 // Old recorded ruins remain unsafe without inventing a new ignition or raid.
 if(saved.buildingDamage?.status==='valid')for(const damage of saved.buildingDamage.state.buildings){
  if(damage.condition==='sound'||seen.has(key(damage.binding))||damage.burnedAtMinute>absoluteMinute)continue;
  incidents.push({id:`legacy-building:${damage.lastRaidId}:${damage.binding.siteIndex}:${damage.burnedAtMinute}`,binding:damage.binding,burning:false,requiresRepair:true,
   observedAbsoluteMinute:damage.burnedAtMinute,expiresAbsoluteMinute:Math.min(Number.MAX_SAFE_INTEGER,absoluteMinute+2),knownByResidentIds:[],affectedResidentIds:[]});
 }
 return Object.freeze(incidents.sort((a,b)=>order(a.id,b.id)));
}

/** Audibility rule for the village's explicit ignition alarm. Only an actual
 * source-placed resident (or somebody inside their source-associated home)
 * within this radius can receive it. It is not an omniscient global threat. */
export const BUILDING_FIRE_ALARM_METRES=150;
function pointDistanceSquared(point:SourcePoint,bounds:SourceBuilding['bounds']):number{
 let sum=0;for(let axis=0;axis<3;axis++){const distance=Math.max(bounds.min[axis]-point[axis],0,point[axis]-bounds.max[axis]);sum+=distance*distance;}return sum;
}
function outsideObstacles(point:SourcePoint,site:VillageSiteLayout,obstacles:readonly VillageLifeNavigationObstacle[],minute:number):boolean{
 return obstacles.every(obstacle=>obstacle.sourceSha256!==site.sourceSha256||obstacle.profile!==site.profile||obstacle.activeFromAbsoluteMinute>minute
  ||!villageLifeObstacleContainsPoint(point,site,obstacle));
}
/** Read-only collision projection uses the same source modules, ground sampler
 * and clock ratio as the live adapter. A stale rendered ruin cannot decide a
 * historical evacuation path during catch-up. */
export function projectBuildingDisasterObstacles(saved:ObserverSave,input:Pick<BuildingDisasterFrameInput,'absoluteMinute'|'buildings'|'groundHeight'|'secondsPerWorldMinute'|'populationSnapshot'>):readonly VillageLifeNavigationObstacle[]{
 const records=buildingDisasterConditions(saved);if(!records.length)return[];
 const checkpoint=saved.buildingEmergency?.status==='valid'?saved.buildingEmergency.state:null;
 const seconds=input.secondsPerWorldMinute??(checkpoint?.clock.millisecondsPerWorldMinute??input.populationSnapshot?.clock.millisecondsPerWorldMinute)!/1000;
 if(seconds===undefined||!Number.isFinite(seconds)||seconds<=0)throw Error('Historical collapse requires the saved world clock duration.');
 let projection=physicalProjections.get(input.buildings);
 if(!projection||projection.seconds!==seconds||projection.ground!==input.groundHeight){projection={seconds,ground:input.groundHeight,owner:createBuildingCollapse({buildings:input.buildings,groundHeight:input.groundHeight,secondsPerWorldMinute:()=>seconds})};physicalProjections.set(input.buildings,projection);}
 projection.owner.update(records,input.absoluteMinute);
 // Navigation advances a whole causal minute. Reserve every accepted module
 // position swept during that interval, including intermediate rotation,
 // rather than admitting a lane that a roof reaches before the next sample.
 return projection.owner.sweptObstacles(records,input.absoluteMinute,Math.min(Number.MAX_SAFE_INTEGER,input.absoluteMinute+1)).filter(c=>c.state!=='restored').map(c=>({id:obstacleId('building-debris:',key(c.binding)+':'+c.sourcePartId),sourceSha256:c.binding.sourceSha256,profile:c.binding.profile,
  activeFromAbsoluteMinute:c.activeFromAbsoluteMinute,bounds:c.bounds}));
}

export function createBuildingDisasterFrame(saved:ObserverSave,input:BuildingDisasterFrameInput):BuildingDisasterFrame|null{
 const {site,absoluteMinute:at}=input;if(!whole(at)||!input.siteIdentity)throw Error('Disaster frame requires a source identity and completed world minute.');
 if(saved.buildingFire?.status==='invalid'||saved.buildingEmergency?.status==='invalid'||saved.localRebuildOrders?.status==='invalid')return null;
 const catalogue=new Map(input.buildings.map(building=>[key(building.binding),building]));
 if(input.buildings.some(b=>b.binding.sourceSha256!==site.sourceSha256||b.binding.profile!==site.profile))return null;
 const initial=buildingDisasterIncidents(saved,at),associations=input.associations.filter(a=>catalogue.has(key(a.binding))&&site.residentPlaceBindings.some(b=>b.residentId===a.residentId&&b.placeId===a.placeId&&b.anchorId===a.anchorId&&b.status==='mapped-exterior'));
 const snapshot=input.populationSnapshot,checkpoint=saved.buildingEmergency?.status==='valid'?saved.buildingEmergency.state:null;
 const current=checkpoint?.worldKey===snapshot?.worldKey?checkpoint:snapshot;
 const navigation=current?.navigation.profile===site.profile?current.navigation:current?.navigationOther?.profile===site.profile?current.navigationOther:null;
 const residents=snapshot?.population.residents??[];
 const incidents:ResidentBuildingIncident[]=[];
 for(const original of initial){const building=catalogue.get(key(original.binding));if(!building)continue;
  const affected=associations.filter(a=>key(a.binding)===key(original.binding)&&residents.some(r=>r.id===a.residentId&&(r.homePlaceId===a.placeId||r.workPlaceId===a.placeId))).map(a=>a.residentId);
  const known=new Set<string>();
  for(const person of residents){
   const journey=navigation?.residents.find(row=>row.residentId===person.id);
   // A retained duty is already received knowledge; distance cannot erase it.
   if(current?.buildingEmergency?.duties.some(d=>d.residentId===person.id&&d.incidentId===original.id)){known.add(person.id);continue;}
   if(!journey||journey.sourceSha256!==site.sourceSha256)continue;
   let point=journey.anchorPosition;
   if(journey.route&&!journey.inside){
    const path=journey.route.sourceGroundPolyline;let left=journey.progressMetres;point=path[path.length-1]??null;
    for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],length=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);if(left<=length){const t=length?left/length:0;point=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];break;}left-=length;}
   }
   if(point&&point.every(Number.isFinite)&&pointDistanceSquared(point,building.bounds)<=BUILDING_FIRE_ALARM_METRES**2)known.add(person.id);
   else if(journey.inside&&associations.some(a=>a.residentId===person.id&&a.placeId===person.homePlaceId&&key(a.binding)===key(original.binding)))known.add(person.id);
  }
  incidents.push({...original,knownByResidentIds:Object.freeze([...known].sort(order)),affectedResidentIds:Object.freeze([...new Set(affected)].sort(order))});
 }
 const physical=projectBuildingDisasterObstacles(saved,input);
 // The aggregate catalogue box joins separate walls and a pitched roof. It
 // is not an occupied solid column: extending an overhang to the ground can
 // seal an independently certified exterior lane. Keep each source module's
 // actual height/footprint; no resident, role or station gets an exemption.
 const hazards:VillageLifeNavigationObstacle[]=incidents.filter(i=>i.burning).flatMap(incident=>{const b=catalogue.get(key(incident.binding))!;
  const localized=input.fireHazardsFor?.(b.binding);
  const parts=localized?.length?localized:b.parts.length?b.parts:[{id:'unavailable-source-parts',bounds:b.bounds}];
  return parts.map(part=>({id:obstacleId('building-fire-zone:',key(b.binding)+':'+incident.id+':'+part.id),sourceSha256:b.binding.sourceSha256,profile:b.binding.profile,
   activeFromAbsoluteMinute:incident.observedAbsoluteMinute,bounds:part.bounds,kind:'fire' as const}));});
 const obstacles=Object.freeze([...physical,...hazards]);
 if(obstacles.length>4096)throw Error('Source fire/debris hazards exceed the bounded navigation budget.');
 const repairOrders=saved.localRebuildOrders?.status==='valid'?saved.localRebuildOrders.state.orders.filter(o=>o.orderedAtMinute<=at&&o.completedAtMinute===null&&incidents.some(i=>i.id===o.incidentId&&key(i.binding)===key(o.binding))):[];
 const fireRecords=saved.buildingFire?.status==='valid'?saved.buildingFire.state.buildings:[];
 const stations=input.stations.filter(st=>incidents.some(i=>i.id===st.disasterId)
  &&(st.kind!=='fire'||!incidents.some(i=>i.id===st.disasterId&&i.unsafeForCloseWork)&&!fireRecords.some(f=>buildingDamageKey(f.binding)===st.buildingKey&&f.collapsedAtMinute!==null&&f.collapsedAtMinute<=at))
  &&(st.kind!=='repair'||repairOrders.some(o=>o.incidentId===st.disasterId&&o.workerIds.includes(st.residentId)&&buildingDamageKey(o.binding)===st.buildingKey)));
 const homePlaces=new Set(residents.map(r=>r.homePlaceId)),registered=new Set(snapshot?.population.registry.places.map(p=>p.id)??[]),shelters=new Set<string>();
 for(const binding of site.residentPlaceBindings){if(binding.status!=='mapped-exterior'||homePlaces.has(binding.placeId)||!registered.has(binding.placeId))continue;
  const endpoint=resolveVillageSiteEndpoint(site,binding.placeId,binding.residentId);if(endpoint&&outsideObstacles(endpoint.sourceGroundPoint,site,obstacles,at)&&villageRefugeClearOfOperations(endpoint.sourceGroundPoint,site,input.stations))shelters.add(binding.placeId);}
 const refuges=validateVillageSiteEmergencyRefuges(site).filter(r=>{if(r.proof.siteIdentity!==input.siteIdentity||!residents.some(p=>p.id===r.residentId)||!villageRefugeClearOfOperations(r.proof.sourceGroundPoint,site,input.stations))return false;const scoped=scopedVillageEmergencyRefugeSite(site,{ids:[r.id]},r.residentId);return !!scoped&&outsideObstacles(r.proof.sourceGroundPoint,scoped,obstacles,at);});
 return Object.freeze({siteIdentity:input.siteIdentity,buildings:input.buildings,associations:Object.freeze(associations),incidents:Object.freeze(incidents),stations:Object.freeze(stations),repairOrders:Object.freeze(repairOrders),shelterPlaceIds:Object.freeze([...shelters].sort(order)),...(site.emergencyRefuges?{refuges:Object.freeze(refuges)}:{}),obstacles});
}

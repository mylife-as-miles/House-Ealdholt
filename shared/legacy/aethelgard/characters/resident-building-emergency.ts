/** Physical disaster duties for the existing roster. Facts are supplied by the
 * world; this reducer owns no clock, perception, meshes, storage or life credit.
 * Only a reached source station followed by uninterrupted action earns credit. */
import {placeDataArray,placeDataRecord} from '../place-use';
import {copyObserverJSON} from '../observer/observer-json';
import {buildingDamageKey,type BuildingDamageBinding} from '../observer/building-damage';
import type {SourceBuilding} from '../observer/building-damage-catalogue';
import type {BuildingFirefightingDelivery,BuildingLocalRepairProgress} from '../observer/building-conflagration';
import {resolveVillageSiteEndpoint,resolveVillageSitePath,type VillageSiteLayout,type VillageSitePoint} from './village-site';
import {villageLifeObstacleContainsPoint,villageLifePathClearOfObstacles,resolveVillageEmergencyTraversalPath,villageLifeJourneyCollisionSite,villageLifeNavigationPeerBody,ownsExclusiveVillageLifeExteriorAnchor,type VillageLifeNavigationState,type VillageLifeNavigationObstacle} from './village-life-navigation';
import type {VillageLifeIntent} from './village-life';
import type {PopulationResident} from './village-population';
import type {ResidentSafetySignal} from './resident-safety';
import type {ResidentActionPhysicalStation} from './resident-action-queue';
import {validateVillageSiteWorkplaceRoutes,scopedVillageWorkplaceRouteSite} from './village-workplace-routes';
import {COMMUNITY_WOOD_RESIDENT,COMMUNITY_WOOD_CLIP} from './community-wood-presentation';
import {EALDHOLT_POPULATION_ASSET_SHA256} from './population-asset-integrity';
import {matchesVillageSiteEmergencyStation,villageEmergencyTargetSourceSite} from './village-emergency-targets';
import {findVillageEmergencyTraversal,validateVillageSiteEmergencyTraversals,type VillageEmergencyLocomotionPermit,type VillageEmergencyTraversalRef} from './village-emergency-traversal';
import {validateVillageSiteEmergencyRefuges,scopedVillageEmergencyRefugeSite,sameVillageSiteEmergencyRefuge,villageRefugeClearOfOperations,type VillageSiteEmergencyRefuge,type VillageEmergencyRefugePermit} from './village-emergency-refuges';

export interface ResidentBuildingIncident {
 readonly id:string;readonly binding:BuildingDamageBinding;readonly burning:boolean;readonly requiresRepair:boolean;
 /** Derived from actual structural state before a dangerous close-water approach. */
 readonly unsafeForCloseWork?:boolean;
 readonly observedAbsoluteMinute:number;readonly expiresAbsoluteMinute:number;
 /** A real witness/report/alarm supplies recipients. Catalogue proximity does not. */
 readonly knownByResidentIds:readonly string[];readonly affectedResidentIds:readonly string[];
}
/** Authored against the original triangles and the exact clip+prop swept volume.
 * Coordinates, a route certificate or a role name alone cannot certify contact. */
export interface ResidentBuildingEmergencyStation {
 readonly id:string;readonly disasterId:string;readonly residentId:string;readonly placeId:string;readonly anchorId:string;
 readonly kind:'water'|'fire'|'repair';readonly buildingKey:string|null;readonly sourceActor:string;
 readonly contactPoint:VillageSitePoint;readonly yawRadians:number;
 readonly clip:'idle'|'carry_bucket_walk'|'work_hammer_bench'|'work_chisel';
 readonly operationWorldMinutes:number;readonly waterUnits:number;
 readonly proof:{readonly sourceSha256:string;readonly profile:VillageSiteLayout['profile'];readonly siteIdentity:string;
  readonly originalTriangleClearance:true;readonly wholeFootprintSupported:true;readonly sweptClipAndPropsClear:true;
  readonly contactSourceActor:string;readonly maximumContactDistanceMetres:number;readonly clip:string;
  readonly contactKind?:'published-workpiece';readonly equipmentAssetPath?:string;readonly equipmentSha256?:string};
}
export interface ResidentBuildingPlaceAssociation {
 readonly residentId:string;readonly placeId:string;readonly anchorId:string;readonly binding:BuildingDamageBinding;
 readonly sourceDoorActor:string;readonly sourceDoorOrdinal:number;
}
export interface ResidentBuildingLocalRepairOrder {
 readonly id:string;readonly incidentId:string;readonly binding:BuildingDamageBinding;readonly orderedAtMinute:number;
 readonly workerIds:readonly string[];readonly reservedTimber:12;readonly deliveredTimber:number;readonly completedAtMinute:number|null;
}
export interface ResidentBuildingEmergencyFrame {
 /** Exact verified source-site artifact identity, independent of the terrain support actor. */
 readonly siteIdentity:string;readonly repairOrders?:readonly ResidentBuildingLocalRepairOrder[];
 readonly associations?:readonly ResidentBuildingPlaceAssociation[];
 readonly buildings:readonly SourceBuilding[];readonly incidents:readonly ResidentBuildingIncident[];
 readonly stations:readonly ResidentBuildingEmergencyStation[];
 /** Existing registered safe places; the kernel never invents an offset stand. */
 readonly shelterPlaceIds:readonly string[];
 /** Exact temporary physical destinations, deliberately absent from life registry reports. */
 readonly refuges?:readonly VillageSiteEmergencyRefuge[];
 readonly obstacles:readonly VillageLifeNavigationObstacle[];
}
export interface ResidentBuildingDuty {
 readonly residentId:string;readonly incidentId:string;readonly binding:BuildingDamageBinding;
 readonly kind:'evacuate'|'water'|'repair'|'return';
 readonly phase:'evacuating'|'sheltered'|'to-water'|'drawing-water'|'to-fire'|'delivering-water'|'to-repair'|'repairing'|'returning-home'|'held';
 readonly targetPlaceId:string;readonly stationId:string|null;readonly waterStationId:string|null;readonly fireStationId:string|null;
 readonly issuedAbsoluteMinute:number;readonly actionStartedAbsoluteMinute:number|null;readonly actionArrivalAbsoluteMinute:number|null;
 readonly waterUnits:number;readonly interruptedIntent:VillageLifeIntent;readonly reason:string|null;
}
export interface ResidentBuildingEmergencyState {
 readonly kind:'resident-building-emergency';readonly schemaVersion:1;readonly worldKey:string;readonly absoluteMinute:number;
 readonly nextSequence:number;readonly materialOrderIds:readonly string[];readonly duties:readonly ResidentBuildingDuty[];
 /** Pending receipts survive a save between physical contact and world application. */
 readonly waterDeliveries:readonly BuildingFirefightingDelivery[];readonly repairProgress:readonly BuildingLocalRepairProgress[];
}
/** A pending finite recovery job, bound to its existing authored day work and
 * the exact original-source ordinary station/route. This is not a safety grant:
 * the reducer rechecks geometry, current incidents and the actual routine. */
export interface ResidentBuildingRecoveryWorkPermit {
 readonly residentId:string;readonly incidentId:string;
 readonly routeId:string;readonly routeCertificateSha256:string;
 readonly station:ResidentActionPhysicalStation;
 readonly authoredWork:{readonly startMinute:number;readonly endMinute:number;readonly activity:string;readonly placeId:string};
}
export interface ResidentBuildingEmergencyInput {
 readonly absoluteMinute:number;readonly worldKey:string;readonly residents:readonly PopulationResident[];
 readonly routineIntents:readonly VillageLifeIntent[];readonly navigation:VillageLifeNavigationState;
 readonly site:VillageSiteLayout|null;readonly frame:ResidentBuildingEmergencyFrame|null;
 readonly recoveryWork?:readonly ResidentBuildingRecoveryWorkPermit[];
}
const trusted=new WeakSet<object>(),EPS=1e-7,MAX_RECEIPTS=256;
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER;
const integer=(n:unknown):n is number=>finite(n)&&Number.isSafeInteger(n);
const id=(n:unknown):n is string=>typeof n==='string'&&n.length>0&&n.length<=1200&&!/[\u0000-\u001f\u007f]/u.test(n);
function freeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function finish(s:ResidentBuildingEmergencyState):ResidentBuildingEmergencyState{freeze(s);trusted.add(s);return s;}
function binding(value:unknown):BuildingDamageBinding{
 const b=placeDataRecord(value,['catalogueId','sourceSha256','profile','buildingId','siteIndex']);
 if(!id(b.catalogueId)||!id(b.buildingId)||typeof b.sourceSha256!=='string'||!/^([a-f0-9]{64})$/u.test(b.sourceSha256)||!['desktop','quest'].includes(b.profile as string)||!integer(b.siteIndex))throw Error('Invalid emergency building identity.');
 return value as BuildingDamageBinding;
}
export function createResidentBuildingEmergency(worldKey:string,absoluteMinute:number):ResidentBuildingEmergencyState{
 if(!id(worldKey)||!finite(absoluteMinute))throw Error('Emergency duties need the existing world and clock.');
 return finish({kind:'resident-building-emergency',schemaVersion:1,worldKey,absoluteMinute,nextSequence:0,materialOrderIds:[],duties:[],waterDeliveries:[],repairProgress:[]});
}
export function parseResidentBuildingEmergency(value:unknown):ResidentBuildingEmergencyState{
 if(value&&typeof value==='object'&&trusted.has(value))return value as ResidentBuildingEmergencyState;
 if(typeof value==='string'){if(value.length>512*1024)throw Error('Emergency save exceeds its bounded data budget.');value=JSON.parse(value);}
 const s=copyObserverJSON(value) as ResidentBuildingEmergencyState;
 if(JSON.stringify(s).length>512*1024)throw Error('Emergency save exceeds its bounded data budget.');
 placeDataRecord(s,['kind','schemaVersion','worldKey','absoluteMinute','nextSequence','materialOrderIds','duties','waterDeliveries','repairProgress']);
 if(s.kind!=='resident-building-emergency'||s.schemaVersion!==1||!id(s.worldKey)||!finite(s.absoluteMinute)||!integer(s.nextSequence))throw Error('Invalid emergency snapshot.');
 if(placeDataArray(s.duties).length>100||placeDataArray(s.waterDeliveries).length+placeDataArray(s.repairProgress).length>MAX_RECEIPTS)throw Error('Emergency work exceeds its persistent budget.');
 if(placeDataArray(s.materialOrderIds).length>MAX_RECEIPTS||s.materialOrderIds.some(n=>!id(n))||new Set(s.materialOrderIds).size!==s.materialOrderIds.length)throw Error('Invalid emergency material delivery history.');
 const seen=new Set<string>();
 for(const d of s.duties){placeDataRecord(d,['residentId','incidentId','binding','kind','phase','targetPlaceId','stationId','waterStationId','fireStationId','issuedAbsoluteMinute','actionStartedAbsoluteMinute','actionArrivalAbsoluteMinute','waterUnits','interruptedIntent','reason']);
  if(!id(d.residentId)||seen.has(d.residentId)||!id(d.incidentId)||!id(d.targetPlaceId)||!['evacuate','water','repair','return'].includes(d.kind)
   ||!['evacuating','sheltered','to-water','drawing-water','to-fire','delivering-water','to-repair','repairing','returning-home','held'].includes(d.phase)
   ||!integer(d.issuedAbsoluteMinute)||d.issuedAbsoluteMinute>s.absoluteMinute||!integer(d.waterUnits)||d.waterUnits>1000
   ||d.reason!==null&&!id(d.reason))throw Error('Invalid persisted emergency duty.');seen.add(d.residentId);binding(d.binding);
  for(const key of ['stationId','waterStationId','fireStationId']as const)if(d[key]!==null&&!id(d[key]))throw Error('Invalid emergency station identity.');
  for(const key of ['actionStartedAbsoluteMinute','actionArrivalAbsoluteMinute']as const)if(d[key]!==null&&(!finite(d[key])||d[key]!>s.absoluteMinute))throw Error('Invalid emergency action clock.');
  const i=placeDataRecord(d.interruptedIntent,['residentId','activityKey','targetPlaceId','activity','priority','issuedAbsoluteMinute','indoor','companionIds','reason']);
  if(i.residentId!==d.residentId||!id(i.targetPlaceId)||!id(i.activity)||!integer(i.issuedAbsoluteMinute)||i.issuedAbsoluteMinute>d.issuedAbsoluteMinute||typeof i.indoor!=='boolean'||!finite(i.priority)||!['sleep','meal','work','care','visit','social','patrol','travel','rest','shelter','protect','home'].includes(i.activityKey as string)||!['routine','family-meal','family-care','family-visit','household-protection','weather','needs','safety'].includes(i.reason as string)||placeDataArray(i.companionIds).some(n=>!id(n)))throw Error('Invalid interrupted routine.');
  if(d.kind==='return'&&(d.phase!=='returning-home'||d.stationId!==null||d.waterStationId!==null||d.fireStationId!==null||d.actionStartedAbsoluteMinute!==null)
   ||d.kind==='evacuate'&&(!['evacuating','sheltered','held'].includes(d.phase)||d.stationId!==null||d.waterStationId!==null||d.fireStationId!==null||d.waterUnits!==0||d.actionStartedAbsoluteMinute!==null)
   ||d.kind==='repair'&&(!['to-repair','repairing','held'].includes(d.phase)||!d.stationId||d.waterUnits!==0||d.waterStationId!==null||d.fireStationId!==null)
   ||d.kind==='water'&&(!['to-water','drawing-water','to-fire','delivering-water','held'].includes(d.phase)||!d.stationId||!d.waterStationId||!d.fireStationId||['to-water','drawing-water'].includes(d.phase)&&d.waterUnits!==0||['to-fire','delivering-water'].includes(d.phase)&&d.waterUnits===0))throw Error('Emergency phase contradicts its physical duty.');
  if(d.actionStartedAbsoluteMinute!==null&&!['drawing-water','delivering-water','repairing'].includes(d.phase))throw Error('Only an actual contact phase can retain action time.');
  if((d.actionStartedAbsoluteMinute===null)!==(d.actionArrivalAbsoluteMinute===null)||d.actionStartedAbsoluteMinute!==null&&d.actionStartedAbsoluteMinute<d.actionArrivalAbsoluteMinute!)throw Error('An action needs its exact arrival.');
 }
 const receipts=new Set<string>();
 for(const r of [...s.waterDeliveries,...s.repairProgress]){
  const water='water'in r;placeDataRecord(r,['id','worldKey','binding','atMinute','residentId','proof',water?'water':'labourMinutes',...(water?[]:['timber'])]);binding(r.binding);
  const proof=placeDataRecord(r.proof,['sourceSha256','profile','buildingId','operationId','arrivalId','contactMinute']);
  const receiptSequence=/^resident-building-(\d+)$/u.exec(r.id);
  if(!receiptSequence||!Number.isSafeInteger(Number(receiptSequence[1]))||Number(receiptSequence[1])>=s.nextSequence||!String(proof.operationId).endsWith(`:${receiptSequence[1]}`)||!id(r.id)||receipts.has(r.id)||r.worldKey!==s.worldKey||!id(r.residentId)||!integer(r.atMinute)||r.atMinute>s.absoluteMinute||proof.sourceSha256!==r.binding.sourceSha256||proof.profile!==r.binding.profile||proof.buildingId!==r.binding.buildingId||!id(proof.operationId)||!id(proof.arrivalId)||proof.contactMinute!==r.atMinute
   ||water&&(!integer((r as BuildingFirefightingDelivery).water)||(r as BuildingFirefightingDelivery).water<1||(r as BuildingFirefightingDelivery).water>1000)
   ||!water&&(!integer((r as BuildingLocalRepairProgress).labourMinutes)||(r as BuildingLocalRepairProgress).labourMinutes<1||(r as BuildingLocalRepairProgress).labourMinutes>60||!integer((r as BuildingLocalRepairProgress).timber)||(r as BuildingLocalRepairProgress).timber>12))throw Error('Invalid physical work receipt.');receipts.add(r.id);
 }
 return finish(s);
}
export function acknowledgeResidentBuildingEmergency(value:ResidentBuildingEmergencyState,receiptIds:readonly string[]):ResidentBuildingEmergencyState{
 const s=parseResidentBuildingEmergency(value),ids=new Set(receiptIds);return finish({...s,waterDeliveries:s.waterDeliveries.filter(r=>!ids.has(r.id)),repairProgress:s.repairProgress.filter(r=>!ids.has(r.id))});
}
/** No nearest-door inference: all matching source door names must identify one
 * component. An ambiguous actor name, missing per-person binding or changed
 * geometry remains unmapped. */
export function residentBuildingPlaceBinding(site:VillageSiteLayout,buildings:readonly SourceBuilding[],residentId:string,placeId:string,associations:readonly ResidentBuildingPlaceAssociation[]=[]):SourceBuilding|null{
 const row=site.residentPlaceBindings.find(b=>b.residentId===residentId&&b.placeId===placeId),anchor=resolveVillageSiteEndpoint(site,placeId,residentId);
 if(row?.status!=='mapped-exterior'||!anchor||row.anchorId!==anchor.id)return null;
 const declared=associations.filter(a=>a.residentId===residentId&&a.placeId===placeId&&a.anchorId===anchor.id);
 if(declared.length){if(declared.length!==1)return null;const a=declared[0];const matches=buildings.filter(b=>b.binding.sourceSha256===site.sourceSha256&&b.binding.profile===site.profile&&buildingDamageKey(b.binding)===buildingDamageKey(a.binding)&&b.parts.some(p=>p.kind==='door'&&(p as {sourceActor?:string}).sourceActor===a.sourceDoorActor&&(p as {sourceOrdinal?:number}).sourceOrdinal===a.sourceDoorOrdinal));return matches.length===1?matches[0]:null;}
 const matches=buildings.filter(b=>b.binding.sourceSha256===site.sourceSha256&&b.binding.profile===site.profile&&b.parts.some(part=>part.kind==='door'&&((part as {sourceActor?:string}).sourceActor??part.id)===anchor.sourceActor));
 return matches.length===1?matches[0]:null;
}
function safePoint(p:VillageSitePoint,site:VillageSiteLayout,obstacles:readonly VillageLifeNavigationObstacle[],now:number):boolean{
 return !obstacles.some(o=>o.sourceSha256===site.sourceSha256&&o.profile===site.profile&&o.activeFromAbsoluteMinute<=now&&villageLifeObstacleContainsPoint(p,site,o));
}
export function qualifiedResidentBuildingStation(station:ResidentBuildingEmergencyStation,site:VillageSiteLayout,incident:ResidentBuildingIncident,frame:ResidentBuildingEmergencyFrame,now:number):boolean{
 const sourceSite=villageEmergencyTargetSourceSite(site,station.residentId,station.placeId);if(!sourceSite)return false;site=sourceSite;
 const declared=site.emergencyTargets?.find(t=>t.residentId===station.residentId&&t.placeId===station.placeId);
 if(declared&&!matchesVillageSiteEmergencyStation(declared,station))return false;
 const p=station.proof,anchor=resolveVillageSiteEndpoint(site,station.placeId,station.residentId),row=site.residentPlaceBindings.find(b=>b.residentId===station.residentId&&b.placeId===station.placeId),key=buildingDamageKey(incident.binding);
 return !!anchor&&row?.status==='mapped-exterior'&&row.anchorId===anchor.id&&anchor.id===station.anchorId&&anchor.sourceActor===station.sourceActor
  &&station.disasterId===incident.id&&(station.kind==='water'?station.buildingKey===null:station.buildingKey===key)
  &&(!incident.unsafeForCloseWork||station.kind==='repair')
  &&p.sourceSha256===site.sourceSha256&&p.profile===site.profile&&id(frame.siteIdentity)&&p.siteIdentity===frame.siteIdentity
  &&p.originalTriangleClearance===true&&p.wholeFootprintSupported===true&&p.sweptClipAndPropsClear===true&&p.clip===station.clip
  &&id(p.contactSourceActor)&&id(station.id)&&id(station.residentId)&&id(station.sourceActor)&&Number.isFinite(station.yawRadians)
  &&Array.isArray(station.contactPoint)&&station.contactPoint.length===3&&station.contactPoint.every(Number.isFinite)
  &&finite(p.maximumContactDistanceMetres)&&p.maximumContactDistanceMetres>0&&p.maximumContactDistanceMetres<=4
  &&Math.hypot(...station.contactPoint.map((n,k)=>n-anchor.sourceGroundPoint[k]))<=p.maximumContactDistanceMetres+EPS
  &&integer(station.operationWorldMinutes)&&station.operationWorldMinutes>=1&&station.operationWorldMinutes<=60
  &&integer(station.waterUnits)&&station.waterUnits>=1&&station.waterUnits<=1000
  &&safePoint(anchor.sourceGroundPoint,site,frame.obstacles,now)
  &&(station.kind==='water'||station.kind==='repair'&&p.contactKind==='published-workpiece'
   ?station.kind==='water'||station.clip==='work_chisel'&&p.contactSourceActor==='prop_stone_block'&&typeof p.equipmentAssetPath==='string'&&p.equipmentAssetPath.replace(/^aethelgard\/characters\//u,'')==='crowd-v1/props/crowd-props-workplace-v1.glb'&&p.equipmentSha256===EALDHOLT_POPULATION_ASSET_SHA256['crowd-v1/props/crowd-props-workplace-v1.glb']
   :p.contactKind===undefined&&frame.buildings.some(b=>buildingDamageKey(b.binding)===key&&b.parts.some(part=>part.id===p.contactSourceActor||(part as {sourceActor?:string}).sourceActor===p.contactSourceActor)));
}
export function residentBuildingEmergencyIntents(value:ResidentBuildingEmergencyState,routineIntents:readonly VillageLifeIntent[]):readonly VillageLifeIntent[]{
 const s=parseResidentBuildingEmergency(value),duties=new Map(s.duties.map(d=>[d.residentId,d]));
 return routineIntents.map(i=>{const d=duties.get(i.residentId);if(!d)return i;
  return{...i,targetPlaceId:d.targetPlaceId,activityKey:d.kind==='evacuate'?'shelter':d.kind==='return'?'travel':'work',indoor:false,priority:d.kind==='evacuate'?10000:9000,issuedAbsoluteMinute:d.issuedAbsoluteMinute,reason:'safety',activity:d.kind==='return'?'Returns with the bucket to a safe village place.':d.kind==='evacuate'?(d.phase==='sheltered'?'Waits at a safe exterior refuge.':d.phase==='held'?'Waits for a safe evacuation place.':'Evacuates to a safe exterior refuge.'):d.phase==='to-water'||d.phase==='drawing-water'?'Collects water for the house fire.':d.kind==='water'?'Delivers water to the house fire.':'Rebuilds the damaged house.'};});
}
/** Read-only recovery eligibility. A damaged home stays a forbidden destination;
 * only a distinct, certified exterior job may interrupt its shelter requirement.
 * Other safety reports, weather, family care and nighttime shelter still win. */
export function qualifiedResidentBuildingRecoveryWork(input:ResidentBuildingEmergencyInput,person:PopulationResident,incident:ResidentBuildingIncident):boolean{
 try{
  const {site,frame}=input,now=input.absoluteMinute,minute=Math.floor(now),dayMinute=minute%1440;
  if(!site||!frame||!finite(now)||dayMinute<360||dayMinute>=1080||person.ageYears<18||person.ageYears>=60||person.group==='elders-dependents'
   ||incident.burning||!incident.requiresRepair||incident.observedAbsoluteMinute>now||incident.expiresAbsoluteMinute<=now
   ||!incident.knownByResidentIds.includes(person.id)||incident.binding.sourceSha256!==site.sourceSha256||incident.binding.profile!==site.profile
   ||frame.incidents.some(i=>i.burning&&i.observedAbsoluteMinute<=now&&i.expiresAbsoluteMinute>now))return false;
  const permits=input.recoveryWork?.filter(p=>p.residentId===person.id&&p.incidentId===incident.id)??[];if(permits.length!==1)return false;
  const permit=permits[0],slot=person.registry.routine.find(s=>dayMinute>=s.startMinute&&dayMinute<s.endMinute),authored=permit.authoredWork;
  if(!slot||slot.placeId!==person.workPlaceId||slot.startMinute!==authored.startMinute||slot.endMinute!==authored.endMinute||slot.activity!==authored.activity||slot.placeId!==authored.placeId)return false;
  const home=residentBuildingPlaceBinding(site,frame.buildings,person.id,person.homePlaceId,frame.associations);
  if(!home||buildingDamageKey(home.binding)!==buildingDamageKey(incident.binding))return false;
  const cap=validateVillageSiteWorkplaceRoutes(site).find(cap=>cap.id===permit.routeId&&cap.certificateSha256===permit.routeCertificateSha256&&cap.residentId===person.id),station=permit.station;
  if(!cap||cap.proof.siteIdentity!==frame.siteIdentity||station.residentId!==person.id||station.placeId!==cap.placeId||station.anchorId!==cap.anchorId
   ||station.placeId===person.homePlaceId||station.source.profile!==site.profile||station.source.sha256!==site.sourceSha256||station.source.siteIdentity!==input.navigation.siteIdentity
   ||!/^[a-f0-9]{64}$/u.test(station.certificateSha256)||station.proof.originalTriangleClearance!==true||station.proof.wholeFootprintSupported!==true
   ||station.proof.sweptClipAndPropsClear!==true||!id(station.proof.contactSourceActor)||!person.appearance.motion.roleClips.includes(station.clip)&&!(person.id===COMMUNITY_WOOD_RESIDENT&&cap.purpose==='community-timber'&&station.clip===COMMUNITY_WOOD_CLIP)
   ||!integer(station.durationWorldMinutes)||station.durationWorldMinutes<1||station.durationWorldMinutes>240)return false;
  const journey=input.navigation.residents.find(j=>j.residentId===person.id);
  if(!journey||journey.inside||!journey.anchorPlaceId||!journey.anchorPosition||journey.anchorPlaceId===person.homePlaceId||journey.sourceSha256!==site.sourceSha256||journey.sourceSiteIdentity!==input.navigation.siteIdentity)return false;
  const origin=villageLifeJourneyCollisionSite(journey,site);if(!origin)return false;
  // These scopes only union already-qualified source records. They do not add
  // a waypoint, change a polyline, teleport the worker or grant navigation.
  const recovery=cap.recoveryApproach,fromRefuge=recovery&&journey.emergencyRefuge?.ids.includes(recovery.refugeId)&&journey.emergencyRefuge.certificates?.[recovery.refugeId]===recovery.certificateSha256;
  const ref=journey.workplaceRoute?.id===cap.id&&journey.workplaceRoute.certificateSha256===cap.certificateSha256?journey.workplaceRoute
   :{id:cap.id,certificateSha256:cap.certificateSha256,returnPlaceId:journey.anchorPlaceId,...(fromRefuge?{recoveryRefuge:{id:recovery.refugeId,certificateSha256:recovery.certificateSha256}}:{})};
  const scope=scopedVillageWorkplaceRouteSite(site,ref,person.id);
  const destination=scope&&resolveVillageSiteEndpoint(scope,cap.placeId,person.id),path=scope&&resolveVillageSitePath(scope,journey.anchorPlaceId,cap.placeId,person.id);
  if(!scope||!destination||!path||!safePoint(destination.sourceGroundPoint,scope,frame.obstacles,now))return false;
  const active=frame.obstacles.filter(o=>o.sourceSha256===site.sourceSha256&&o.profile===site.profile&&o.activeFromAbsoluteMinute<=now&&o.exceptResidentId!==person.id);
  // Conservative capsule/AABB slabs check every complete route segment. A
  // safe workstation alone must never allow a route through the ruined home.
  for(const obstacle of active)for(let k=1;k<path.sourceGroundPolyline.length;k++){
   const a=path.sourceGroundPolyline[k-1],b=path.sourceGroundPolyline[k];let lo=0,hi=1;
   for(let axis=0;axis<3&&lo<=hi;axis++){
    const min=obstacle.bounds.min[axis]-(axis===1?scope.capsule.height:scope.capsule.radius),max=obstacle.bounds.max[axis]+(axis===1?0:scope.capsule.radius),delta=b[axis]-a[axis];
    if(Math.abs(delta)<1e-12){if(a[axis]<min||a[axis]>max){lo=1;hi=0;}}else{const x=(min-a[axis])/delta,y=(max-a[axis])/delta;lo=Math.max(lo,Math.min(x,y));hi=Math.min(hi,Math.max(x,y));}
   }
   if(lo<=hi)return false;
  }
  return true;
 }catch{return false;}
}
/** Registered-place safety reports suspend routine counters in the life layer.
 * Disaster-only work destinations never enter the life registry or its counters. */
export function residentBuildingEmergencySafetySignals(input:ResidentBuildingEmergencyInput):readonly ResidentSafetySignal[]{
 const {site,frame}=input;if(!site||!frame)return[];const grouped=new Map<string,ResidentSafetySignal>(),minute=Math.floor(input.absoluteMinute);
 for(const incident of [...frame.incidents].sort((a,b)=>a.id.localeCompare(b.id))){if((!incident.burning&&!incident.requiresRepair)||incident.observedAbsoluteMinute>minute||incident.expiresAbsoluteMinute<=minute)continue;
  for(const person of [...input.residents].sort((a,b)=>a.id.localeCompare(b.id))){if(!incident.knownByResidentIds.includes(person.id)||qualifiedResidentBuildingRecoveryWork(input,person,incident))continue;
   const home=residentBuildingPlaceBinding(site,frame.buildings,person.id,person.homePlaceId,frame.associations),work=residentBuildingPlaceBinding(site,frame.buildings,person.id,person.workPlaceId,frame.associations);
   const bound=buildingDamageKey(incident.binding)===(home&&buildingDamageKey(home.binding))||buildingDamageKey(incident.binding)===(work&&buildingDamageKey(work.binding))||incident.affectedResidentIds.includes(person.id);
   const responder=person.ageYears>=18&&person.ageYears<60&&frame.stations.some(st=>st.residentId===person.id&&st.disasterId===incident.id);if(!bound&&!responder)continue;
   const shelter=frame.shelterPlaceIds.find(place=>place!==person.homePlaceId&&resolveVillageSiteEndpoint(site,place,person.id)&&safePoint(resolveVillageSiteEndpoint(site,place,person.id)!.sourceGroundPoint,site,frame.obstacles,minute));
   const key=JSON.stringify([incident.id,person.homePlaceId,shelter??null]),old=grouped.get(key);
   if(old)grouped.set(key,{...old,knownByResidentIds:[...old.knownByResidentIds,person.id],affectedResidentIds:[...old.affectedResidentIds,person.id]});
   else grouped.set(key,{id:`emergency-${minute}-${grouped.size}`,kind:incident.burning?'fire':'hazard',channel:'report',knownByResidentIds:[person.id],placeId:person.homePlaceId,affectedResidentIds:[person.id],shelterPlaceId:shelter??null,observedAbsoluteMinute:minute,expiresAbsoluteMinute:Math.min(minute+2,incident.expiresAbsoluteMinute)});
  }
 }
 if(grouped.size>64)throw Error('Emergency reports exceed the life incident budget.');return [...grouped.values()];
}
function repairOrder(frame:ResidentBuildingEmergencyFrame,incident:ResidentBuildingIncident,personId:string,now:number):ResidentBuildingLocalRepairOrder|undefined{
 const orders=(frame.repairOrders??[]).filter(o=>o.incidentId===incident.id&&buildingDamageKey(o.binding)===buildingDamageKey(incident.binding)&&o.workerIds.includes(personId)&&id(o.id)&&integer(o.orderedAtMinute)&&o.orderedAtMinute<=now&&o.completedAtMinute===null&&o.reservedTimber===12&&integer(o.deliveredTimber)&&o.deliveredTimber<=12&&o.workerIds.length>0&&o.workerIds.every(id)&&new Set(o.workerIds).size===o.workerIds.length);
 return orders.length===1?orders[0]:undefined;
}
export function advanceResidentBuildingEmergency(value:ResidentBuildingEmergencyState,input:ResidentBuildingEmergencyInput):ResidentBuildingEmergencyState{
 const s=parseResidentBuildingEmergency(value),now=input.absoluteMinute,{site,frame}=input;
 if(input.worldKey!==s.worldKey||!finite(now)||now<s.absoluteMinute||Math.abs(input.navigation.absoluteMinute-now)>EPS)throw Error('Emergency, navigation and world clocks must agree.');
 const intents=new Map(input.routineIntents.map(i=>[i.residentId,i])),prior=new Map(s.duties.map(d=>[d.residentId,d])),duties:ResidentBuildingDuty[]=[];
 let sequence=s.nextSequence;const waterDeliveries=[...s.waterDeliveries],repairProgress=[...s.repairProgress],materialOrderIds=[...s.materialOrderIds],reserved=new Set<string>();
 for(const old of s.duties)if(old.stationId)reserved.add(old.stationId);
 const shelterClaims=new Map<string,VillageSitePoint>();
 const overlapsStand=(a:VillageSitePoint,b:VillageSitePoint,own:VillageSiteLayout['capsule'],peer:VillageSiteLayout['capsule'])=>a[1]<b[1]+peer.height&&a[1]+own.height>b[1]&&Math.hypot(a[0]-b[0],a[2]-b[2])<own.radius+peer.radius-EPS;
 function refugeSite(person:PopulationResident,place:string):VillageSiteLayout|null{
  if(!site||!frame)return null;const journey=input.navigation.residents.find(row=>row.residentId===person.id),declared=frame.refuges?.find(r=>r.residentId===person.id&&r.placeId===place);
  if(declared){const current=validateVillageSiteEmergencyRefuges(site).find(r=>r.id===declared.id);
   if(!current||declared.proof.siteIdentity!==frame.siteIdentity||!sameVillageSiteEmergencyRefuge(current,declared))return null;}
  else if(!frame.shelterPlaceIds.includes(place))return null;
  const ids=[...new Set([...(journey?.emergencyRefuge?.ids??[]),...(declared?[declared.id]:[])])];
  return ids.length?scopedVillageEmergencyRefugeSite(site,{ids},person.id):site;
 }
 function usableRefuge(person:PopulationResident,place:string):{site:VillageSiteLayout;anchor:ReturnType<typeof resolveVillageSiteEndpoint>}|null{
  const scoped=refugeSite(person,place),anchor=scoped&&resolveVillageSiteEndpoint(scoped,place,person.id);
  return scoped&&anchor&&frame&&safePoint(anchor.sourceGroundPoint,scoped,frame.obstacles,now)&&villageRefugeClearOfOperations(anchor.sourceGroundPoint,site!,frame.stations)?{site:scoped,anchor}:null;
 }
 if(site&&frame)for(const old of s.duties)if(old.kind==='evacuate'&&old.phase!=='held'){
  const person=input.residents.find(p=>p.id===old.residentId),refuge=person&&usableRefuge(person,old.targetPlaceId);if(refuge?.anchor)shelterClaims.set(old.residentId,refuge.anchor.sourceGroundPoint);
 }
 function availableRefuge(person:PopulationResident,preferred:string|null):string|null{
  if(!site||!frame)return null;const journey=input.navigation.residents.find(row=>row.residentId===person.id),origin=journey?.anchorPlaceId;
  const places=[...new Set([...frame.shelterPlaceIds,...frame.refuges?.filter(r=>r.residentId===person.id).map(r=>r.placeId)??[]])];
  const candidates=places.filter(place=>place!==person.homePlaceId&&place!==person.workPlaceId).map(place=>{
   const qualified=usableRefuge(person,place),anchor=qualified?.anchor,path=origin&&qualified?resolveVillageSitePath(qualified.site,origin,place,person.id):null;
   if(!anchor||!origin||!path)return null;const p=anchor.sourceGroundPoint,own=qualified!.site.capsule;
   if([...shelterClaims].some(([who,q])=>{if(who===person.id)return false;const peer=input.navigation.residents.find(r=>r.residentId===who),body=peer?villageLifeNavigationPeerBody(peer,site!,input.navigation.siteIdentity):site!.capsule;return overlapsStand(p,q,own,body);}))return null;
   for(const peer of input.navigation.residents){if(peer.residentId===person.id||peer.sourceSha256!==site!.sourceSha256||peer.sourceSiteIdentity!==input.navigation.siteIdentity)continue;
    const peerSite=villageLifeJourneyCollisionSite(peer,site!),target=peer.route?(peer.direction===1?peer.destinationPlaceId:peer.originPlaceId):!peer.inside?peer.anchorPlaceId:null;
    const q=target&&peerSite?resolveVillageSiteEndpoint(peerSite,target,peer.residentId)?.sourceGroundPoint:!peer.inside?peer.anchorPosition:null;
    const peerBody=villageLifeNavigationPeerBody(peer,site!,input.navigation.siteIdentity);if(q&&overlapsStand(p,q,own,peerBody))return null;
    if(peer.route&&peer.route.sourceGroundPolyline.slice(1).some((b,i)=>{const a=peer.route!.sourceGroundPolyline[i],dx=b[0]-a[0],dz=b[2]-a[2],n=dx*dx+dz*dz,t=n?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[2]-a[2])*dz)/n)):0;
      return p[1]<Math.max(a[1],b[1])+peerBody.height&&p[1]+own.height>Math.min(a[1],b[1])&&Math.hypot(p[0]-a[0]-t*dx,p[2]-a[2]-t*dz)<own.radius+peerBody.radius-EPS;}))return null;
   }
   return {place,length:path.lengthMetres};
  }).filter((row):row is {place:string;length:number}=>row!==null).sort((a,b)=>Number(b.place===preferred)-Number(a.place===preferred)||a.length-b.length||a.place.localeCompare(b.place));
  return candidates[0]?.place??null;
 }

 const incidents=(frame?.incidents??[]).filter(i=>i.observedAbsoluteMinute<=now&&i.expiresAbsoluteMinute>now&&(i.burning||i.requiresRepair)).sort((a,b)=>Number(b.burning)-Number(a.burning)||a.id.localeCompare(b.id));
 for(const person of [...input.residents].sort((a,b)=>a.id.localeCompare(b.id))){const routine=intents.get(person.id);if(!routine)throw Error('Every emergency responder needs their actual routine.');let d=prior.get(person.id);
  // Missing/changed source holds saved duties, action credit and the exact
  // navigation cursor. It never becomes an all-clear or a new allocation.
  if(!site||!frame||d&&(d.binding.sourceSha256!==site.sourceSha256||d.binding.profile!==site.profile)){
   if(d)duties.push({...d,actionStartedAbsoluteMinute:null,actionArrivalAbsoluteMinute:null,reason:'emergency-source-unavailable'});continue;
  }
  const known=incidents.filter(i=>i.binding.sourceSha256===site.sourceSha256&&i.binding.profile===site.profile&&i.knownByResidentIds.includes(person.id));
  let incident=d&&known.find(i=>i.id===d!.incidentId&&buildingDamageKey(i.binding)===buildingDamageKey(d!.binding));
  const home=residentBuildingPlaceBinding(site,frame.buildings,person.id,person.homePlaceId,frame.associations),work=residentBuildingPlaceBinding(site,frame.buildings,person.id,person.workPlaceId,frame.associations),journey=input.navigation.residents.find(r=>r.residentId===person.id);
  const transit=site.emergencyTraversals?.find(t=>t.residentId===person.id&&person.ageYears>=18&&person.ageYears<60&&person.appearance.motion.roleClips.includes(t.requiredClip));
  const ref:VillageEmergencyTraversalRef|undefined=transit?{id:transit.id,certificateSha256:transit.certificateSha256,requiredClip:transit.requiredClip}:undefined;
  const refugeOrigin=journey?.emergencyRefuge?scopedVillageEmergencyRefugeSite(site,journey.emergencyRefuge,person.id):null;
  const waterApproach=(place:string)=>!!journey?.anchorPlaceId&&(refugeOrigin?resolveVillageSitePath(refugeOrigin,journey.anchorPlaceId,place,person.id):resolveVillageEmergencyTraversalPath(site,person.id,journey.anchorPlaceId,place,ref));
  const repairApproach=(place:string)=>{const scoped=journey?villageLifeJourneyCollisionSite(journey,site):refugeOrigin??site,path=journey?.anchorPlaceId&&scoped?resolveVillageSitePath(scoped,journey.anchorPlaceId,place,person.id):null;return !!path&&!!scoped&&villageLifePathClearOfObstacles(path,scoped,frame.obstacles);};
  if(d?.kind==='water'&&journey?.emergencyTraversal&&(!incident||!incident.burning||incident.unsafeForCloseWork)){
   for(const stationId of [d.stationId,d.waterStationId,d.fireStationId])if(stationId)reserved.delete(stationId);
   const interrupted=resolveVillageSiteEndpoint(site,d.interruptedIntent.targetPlaceId,person.id),returnToRoutine=!d.interruptedIntent.indoor&&interrupted&&safePoint(interrupted.sourceGroundPoint,site,frame.obstacles,now)&&!!journey.anchorPlaceId&&resolveVillageEmergencyTraversalPath(site,person.id,journey.anchorPlaceId,d.interruptedIntent.targetPlaceId,ref);
   d={...d,kind:'return',phase:'returning-home',targetPlaceId:returnToRoutine?d.interruptedIntent.targetPlaceId:person.homePlaceId,stationId:null,waterStationId:null,fireStationId:null,issuedAbsoluteMinute:Math.floor(now),actionStartedAbsoluteMinute:null,actionArrivalAbsoluteMinute:null,reason:null};
  }
  if(d?.kind==='return'){
   const homeAnchor=resolveVillageSiteEndpoint(site,d.targetPlaceId,person.id),currentAnchor=journey?.anchorPlaceId?resolveVillageSiteEndpoint(site,journey.anchorPlaceId,person.id):null;
   if(journey&&!journey.route&&homeAnchor&&currentAnchor?.id===homeAnchor.id&&journey.anchorPosition?.every((n,k)=>n===homeAnchor.sourceGroundPoint[k]))continue;
   const allowed=ref&&journey?.emergencyTraversal&&findVillageEmergencyTraversal(site,journey.emergencyTraversal,person.id);
   duties.push({...d,reason:allowed?null:'emergency-return-source-unavailable'});continue;
  }

  const recovery=known.find(i=>qualifiedResidentBuildingRecoveryWork(input,person,i));
  const resumedWork=!!recovery&&routine.reason==='routine'&&routine.activityKey==='work'&&!routine.indoor;
  const danger=known.find(i=>(i!==recovery||!resumedWork)&&(i.burning||i.requiresRepair)&&(i.affectedResidentIds.includes(person.id)&&!d&&(!frame.shelterPlaceIds.includes(journey?.anchorPlaceId??'')||!!journey?.anchorPosition&&!villageRefugeClearOfOperations(journey.anchorPosition,site,frame.stations))||home&&buildingDamageKey(home.binding)===buildingDamageKey(i.binding)&&(journey?.anchorPlaceId===person.homePlaceId&&!journey.route||journey?.targetPlaceId===person.homePlaceId)||work&&journey?.inside&&journey.anchorPlaceId===person.workPlaceId&&buildingDamageKey(work.binding)===buildingDamageKey(i.binding)));
  // A certified safe refuge is a real completed evacuation, not a teleport.
  // Qualified adults may then respond; dependants retain their safe shelter.
  if(d?.kind==='evacuate'&&d.phase==='sheltered'&&!danger&&incident&&recovery?.id===incident.id&&resumedWork)d=undefined;
  if(d?.kind==='evacuate'&&d.phase==='sheltered'&&!danger&&incident&&person.ageYears>=18&&person.ageYears<60&&frame.stations.some(st=>st.residentId===person.id&&st.disasterId===incident!.id&&qualifiedResidentBuildingStation(st,site,incident!,frame,now)&&(incident!.burning?st.kind==='water':st.kind==='repair'&&!!repairOrder(frame,incident!,person.id,now))))d=undefined;
  if(d&&incident&&((d.kind==='water'&&!incident.burning)||(d.kind==='repair'&&incident.burning))){for(const stationId of [d.stationId,d.waterStationId,d.fireStationId])if(stationId)reserved.delete(stationId);d=undefined;}
  if(d&&!incident){if(d.stationId)reserved.delete(d.stationId);d=undefined;}
  if(danger&&d?.kind!=='evacuate'){if(d?.stationId)reserved.delete(d.stationId);d=undefined;incident=danger;}
  if(!d){incident=danger??known.find(i=>frame.stations.some(st=>st.residentId===person.id&&st.disasterId===i.id))??known[0];if(!incident)continue;
   if(danger){
    const target=availableRefuge(person,null);
    // Capacity holds keep the actual current source goal. They never invent
    // another stand, claim safety or admit anybody into an unverified interior.
    d={residentId:person.id,incidentId:incident.id,binding:incident.binding,kind:'evacuate',phase:target?'evacuating':'held',targetPlaceId:target??journey?.targetPlaceId??routine.targetPlaceId,stationId:null,waterStationId:null,fireStationId:null,issuedAbsoluteMinute:Math.floor(now),actionStartedAbsoluteMinute:null,actionArrivalAbsoluteMinute:null,waterUnits:0,interruptedIntent:routine,reason:target?null:'emergency-shelter-capacity'};
   }else{
    if(person.ageYears<18||person.ageYears>=60||person.group==='elders-dependents'||!journey?.anchorPlaceId)continue;
    const candidates=frame.stations.filter(st=>st.residentId===person.id&&!reserved.has(st.id)&&qualifiedResidentBuildingStation(st,site,incident!,frame,now)&&(st.clip==='idle'||person.appearance.motion.roleClips.includes(st.clip)));
    const fireCandidates=candidates.filter(st=>st.kind==='fire'&&st.clip==='carry_bucket_walk');
    const water=candidates.find(st=>st.kind==='water'&&st.clip==='carry_bucket_walk'&&waterApproach(st.placeId)&&fireCandidates.some(f=>resolveVillageEmergencyTraversalPath(site,person.id,st.placeId,f.placeId,ref))),fire=water&&fireCandidates.find(f=>resolveVillageEmergencyTraversalPath(site,person.id,water.placeId,f.placeId,ref)),repair=candidates.find(st=>st.kind==='repair'&&['work_hammer_bench','work_chisel'].includes(st.clip)&&repairApproach(st.placeId));
    // Published carry art is required before assigning a bucket duty. Drawing
    // and transfer are explicit timed contacts, never invented fill/throw clips.
    if(incident.burning&&!incident.unsafeForCloseWork&&water&&fire&&person.appearance.motion.roleClips.includes('carry_bucket_walk')&&waterApproach(water.placeId)&&resolveVillageEmergencyTraversalPath(site,person.id,water.placeId,fire.placeId,ref)){
     d={residentId:person.id,incidentId:incident.id,binding:incident.binding,kind:'water',phase:'to-water',targetPlaceId:water.placeId,stationId:water.id,waterStationId:water.id,fireStationId:fire.id,issuedAbsoluteMinute:Math.floor(now),actionStartedAbsoluteMinute:null,actionArrivalAbsoluteMinute:null,waterUnits:0,interruptedIntent:routine,reason:null};reserved.add(water.id);reserved.add(fire.id);
    }else if(!incident.burning&&incident.requiresRepair&&repair&&repairOrder(frame,incident,person.id,now)&&repairApproach(repair.placeId)){
     d={residentId:person.id,incidentId:incident.id,binding:incident.binding,kind:'repair',phase:'to-repair',targetPlaceId:repair.placeId,stationId:repair.id,waterStationId:null,fireStationId:null,issuedAbsoluteMinute:Math.floor(now),actionStartedAbsoluteMinute:null,actionArrivalAbsoluteMinute:null,waterUnits:0,interruptedIntent:routine,reason:null};reserved.add(repair.id);
    }else continue;
   }
  }
  if(d.kind==='evacuate'){
   shelterClaims.delete(person.id);const target=availableRefuge(person,d.phase==='held'?null:d.targetPlaceId);
   if(!target){duties.push({...d,phase:'held',reason:'emergency-shelter-capacity'});continue;}
   if(target!==d.targetPlaceId||d.phase==='held')d={...d,targetPlaceId:target,phase:'evacuating',issuedAbsoluteMinute:Math.floor(now),reason:null};
   const refuge=usableRefuge(person,target)!.anchor!;shelterClaims.set(person.id,refuge.sourceGroundPoint);
   if(journey?.anchorPlaceId===target&&journey.targetPlaceId===target&&journey.arrivalEvidence==='certified-route-arrival'&&!journey.route&&!journey.inside&&ownsExclusiveVillageLifeExteriorAnchor(input.navigation,site,person.id))d={...d,phase:'sheltered',reason:null};
   duties.push(d);continue;
  }
  if(d.kind==='water'&&!incident!.burning||d.kind==='repair'&&(incident!.burning||!repairOrder(frame,incident!,person.id,now))){duties.push({...d,actionStartedAbsoluteMinute:null,actionArrivalAbsoluteMinute:null,reason:'emergency-duty-changed'});continue;}
  const station=frame.stations.find(st=>st.id===d!.stationId&&st.residentId===person.id);
  if(!station||!qualifiedResidentBuildingStation(station,site,incident!,frame,now)){duties.push({...d,actionStartedAbsoluteMinute:null,actionArrivalAbsoluteMinute:null,reason:'emergency-contact-unqualified'});continue;}
  const effective=residentBuildingEmergencyIntents(finish({...s,absoluteMinute:now,duties:[d]}),[routine])[0];
  const reached=!!journey&&station.placeId===d.targetPlaceId&&station.kind===(d.kind==='repair'?'repair':d.waterUnits?'fire':'water')&&journey.targetPlaceId===d.targetPlaceId&&journey.anchorPlaceId===d.targetPlaceId&&journey.activityKey===effective.activityKey&&journey.issuedAbsoluteMinute===d.issuedAbsoluteMinute&&journey.priority===effective.priority&&!journey.route&&!journey.inside&&journey.arrivalEvidence==='certified-route-arrival'&&journey.arrivedAtAbsoluteMinute!==null&&journey.arrivedAtAbsoluteMinute>=d.issuedAbsoluteMinute&&ownsExclusiveVillageLifeExteriorAnchor(input.navigation,site,person.id);
  if(!reached){duties.push({...d,actionStartedAbsoluteMinute:null,actionArrivalAbsoluteMinute:null,reason:null});continue;}
  if(d.actionArrivalAbsoluteMinute!==journey.arrivedAtAbsoluteMinute||d.actionStartedAbsoluteMinute===null){d={...d,phase:d.kind==='repair'?'repairing':d.waterUnits?'delivering-water':'drawing-water',actionStartedAbsoluteMinute:d.reason!==null?now:Math.max(s.absoluteMinute,journey.arrivedAtAbsoluteMinute!),actionArrivalAbsoluteMinute:journey.arrivedAtAbsoluteMinute,reason:null};}
  if(Number.isSafeInteger(now)&&now-d.actionStartedAbsoluteMinute!>=station.operationWorldMinutes&&waterDeliveries.length+repairProgress.length<MAX_RECEIPTS){
   if(d.phase==='drawing-water'){
    const fire=frame.stations.find(st=>st.id===d!.fireStationId&&qualifiedResidentBuildingStation(st,site,incident!,frame,now));
    if(fire)d={...d,phase:'to-fire',targetPlaceId:fire.placeId,stationId:fire.id,waterUnits:station.waterUnits,actionStartedAbsoluteMinute:null,actionArrivalAbsoluteMinute:null};
   }else{
    const receipt={id:`resident-building-${sequence++}`,worldKey:s.worldKey,binding:d.binding,atMinute:now,residentId:person.id,proof:{sourceSha256:site.sourceSha256,profile:site.profile,buildingId:d.binding.buildingId,operationId:`${station.id}:${sequence-1}`,arrivalId:`${person.id}:${d.issuedAbsoluteMinute}:${d.actionArrivalAbsoluteMinute}:${station.anchorId}`,contactMinute:now}};
    if(d.phase==='delivering-water'&&d.waterUnits>0){waterDeliveries.push({...receipt,water:d.waterUnits});const water=frame.stations.find(st=>st.id===d!.waterStationId);
     d={...d,phase:'to-water',targetPlaceId:water?.placeId??d.targetPlaceId,stationId:water?.id??null,waterUnits:0,actionStartedAbsoluteMinute:null,actionArrivalAbsoluteMinute:null};
    }else if(d.phase==='repairing'){
     const order=repairOrder(frame,incident!,person.id,now)!;
     const delivered=order.deliveredTimber===12||materialOrderIds.includes(order.id),carrier=[...order.workerIds].sort()[0]===person.id;
     if(delivered||carrier&&materialOrderIds.length<MAX_RECEIPTS){
      const timber=delivered?0:12;if(timber)materialOrderIds.push(order.id);
      repairProgress.push({...receipt,labourMinutes:station.operationWorldMinutes,timber});
     }else sequence--; // A workstation cannot create unreserved building materials.
     d={...d,actionStartedAbsoluteMinute:now};
    }
   }
  }
  duties.push(d);
 }
 if(!Number.isSafeInteger(sequence))throw Error('Emergency receipt sequence exhausted.');
 return finish({...s,absoluteMinute:now,nextSequence:sequence,materialOrderIds,duties,waterDeliveries,repairProgress});
}

export function residentBuildingEmergencyLocomotionPermits(value:ResidentBuildingEmergencyState,site:VillageSiteLayout|null,residents:readonly PopulationResident[],navigation?:VillageLifeNavigationState):readonly VillageEmergencyLocomotionPermit[]{
 if(!site)return[];const state=parseResidentBuildingEmergency(value),routes=validateVillageSiteEmergencyTraversals(site),permits:VillageEmergencyLocomotionPermit[]=[];
 for(const duty of state.duties){const journey=navigation?.residents.find(r=>r.residentId===duty.residentId);if(journey?.emergencyRefuge)continue;if(duty.kind!=='water'&&duty.kind!=='return'&&!(duty.kind==='evacuate'&&journey?.emergencyTraversal))continue;const person=residents.find(r=>r.id===duty.residentId),route=routes.find(r=>r.residentId===duty.residentId);
  if(person&&route&&person.ageYears>=18&&person.ageYears<60&&person.appearance.motion.roleClips.includes(route.requiredClip))permits.push({residentId:person.id,id:route.id,certificateSha256:route.certificateSha256,requiredClip:route.requiredClip});
 }
 return permits;
}

/** Only actual evacuation duties may open a new scoped refuge branch. A saved
 * active branch remains owned by navigation until a real original-graph return. */
export function residentBuildingEmergencyRefugePermits(value:ResidentBuildingEmergencyState,site:VillageSiteLayout|null):readonly VillageEmergencyRefugePermit[]{
 if(!site)return[];const state=parseResidentBuildingEmergency(value),refuges=validateVillageSiteEmergencyRefuges(site),permits:VillageEmergencyRefugePermit[]=[];
 for(const duty of state.duties)if(duty.kind==='evacuate'){
  const refuge=refuges.find(r=>r.residentId===duty.residentId&&r.placeId===duty.targetPlaceId);if(refuge)permits.push(Object.freeze({residentId:duty.residentId,ids:Object.freeze([refuge.id])}));
 }
 return Object.freeze(permits);
}

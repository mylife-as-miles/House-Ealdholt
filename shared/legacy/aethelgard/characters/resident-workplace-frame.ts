import type {ResidentActionSource} from './resident-action-queue';
import {residentRoutineActionContexts,type ResidentRoutineActionsInput,type ResidentRoutineActionPhysicalContext,type ResidentRoutineActionPhysicalPort} from './resident-routine-actions';
import type {ResidentActionQueues} from './resident-action-queue';
import {createResidentWorkstations,advanceResidentWorkstations,createResidentWorkstationPhysicalPort,
 type ResidentWorkstation,type ResidentWorkstationEntry,type ResidentWorkstationObservation,type ResidentWorkstations} from './resident-workstations';
import {advanceVillageTimberSupply,type VillageTimberCatalogue,type VillageTimberSupply} from '../observer/village-timber-supply';
import type {PopulationMotionClipEvidence} from './population-motion-clearance';
import type {VillageLifeState} from './village-life';
import {ownsExclusiveVillageWorkplaceOperation,type VillageLifeNavigationState,type VillageLifeNavigationObstacle} from './village-life-navigation';
import type {VillageSiteLayout} from './village-site';
import {qualifiedResidentBuildingRecoveryWork,type ResidentBuildingEmergencyFrame,type ResidentBuildingRecoveryWorkPermit} from './resident-building-emergency';

/** A prepared original-source interaction catalogue. This is transient source
 * evidence; durable leases, jobs and finite stock live in the population save. */
export interface ResidentWorkplaceFrame {
 readonly source:ResidentActionSource;
 readonly catalog:readonly ResidentWorkstation[];
 readonly routeCertificates?:Readonly<Record<string,string>>;
 readonly timberCatalogue?:VillageTimberCatalogue;
 readonly observations?:readonly ResidentWorkstationObservation[];
 readonly presentation?:readonly {
  readonly stationId:string;readonly certificateSha256:string;
  readonly body:{readonly radius:number;readonly height:number;readonly margin:number;readonly lift:number};
  readonly clipMeasurement:PopulationMotionClipEvidence;readonly files:Readonly<Record<string,string>>;
  readonly clipMeasurements?:Readonly<Record<string,PopulationMotionClipEvidence>>;
 }[];
 /** Explicit source-bound material-preparation subtasks of an adult's normal
  * working day. They never replace a home, profession or protection duty. */
 readonly assignments?:readonly {
  readonly id:string;readonly residentId:string;readonly placeId:string;readonly routeId:string;
  readonly sourceId:string;readonly activity:string;readonly stockTargetTimber:number;readonly when?:'reconstruction-needed';
 }[];
 /** Evaluates the actual authored clip/template on the shared world clock,
  * including when an actor is outside render residency. No source or pose
  * evidence means no observation and therefore no operational credit. */
 readonly observe?:(context:ResidentRoutineActionPhysicalContext,entry:ResidentWorkstationEntry|null,
  timing:{readonly millisecondsPerWorldMinute:number})=>ResidentWorkstationObservation|null;
}

/** A pending finite material job may request safe post-fire recovery work.
 * The emergency owner independently verifies the actual refuge, source route,
 * workstation, authored work slot and every unrelated hazard. */
export function populationRecoveryWorkPermits(input:Pick<ResidentRoutineActionsInput,'population'|'absoluteMinute'>,frame:ResidentWorkplaceFrame|null,supply:VillageTimberSupply,recoveryFrame:ResidentBuildingEmergencyFrame|null):readonly ResidentBuildingRecoveryWorkPermit[]{
 if(!frame||!recoveryFrame||!frame.assignments?.length)return[];
 return frame.assignments.flatMap(assignment=>{
  const person=input.population.residents.find(person=>person.id===assignment.residentId),resource=supply.sources.find(source=>source.id===assignment.sourceId&&source.profile===frame.source.profile&&source.sourceSha256===frame.source.sha256&&source.siteIdentity===frame.source.siteIdentity),station=frame.catalog.find(station=>station.station.residentId===assignment.residentId&&station.station.placeId===assignment.placeId);
  if(!person||person.ageYears<18||person.ageYears>=60||!resource||resource.remainingUnits<1||supply.availableTimber>=assignment.stockTargetTimber||!station)return[];
  const at=input.absoluteMinute%1440,slot=person.registry.routine.find(slot=>at>=slot.startMinute&&at<slot.endMinute&&slot.placeId===person.workPlaceId);
  if(!slot)return[];
  // The route certificate is pinned by the prepared source catalogue, separate
  // from the workstation's contact certificate.
  const routeId=assignment.routeId,route=frame.timberCatalogue?.sources.find(source=>source.id===assignment.sourceId);
  if(!route)return[];
  const routeCertificateSha256=frame.routeCertificates?.[routeId];if(!routeCertificateSha256)return[];
  return recoveryFrame.incidents.filter(incident=>!incident.burning&&incident.requiresRepair&&incident.affectedResidentIds.includes(person.id)).map(incident=>({residentId:person.id,incidentId:incident.id,routeId,routeCertificateSha256,station:station.station,authoredWork:{startMinute:slot.startMinute,endMinute:slot.endMinute,activity:slot.activity,placeId:slot.placeId}}));
 });
}

export function populationWorkplaceLife(input:ResidentRoutineActionsInput&{readonly recoveryFrame?:ResidentBuildingEmergencyFrame|null},frame:ResidentWorkplaceFrame|null,supply:VillageTimberSupply):VillageLifeState{
 if(!frame?.assignments?.length)return input.life;
 let changed=false;const residents=input.life.residents.map(row=>{
  if(row.intent.reason!=='routine'||row.intent.activityKey!=='work'||row.safety.mode!=='routine')return row;
  const duty=input.buildingEmergency?.duties.find(d=>d.residentId===row.residentId);
  if(duty){const person=input.population.residents.find(person=>person.id===row.residentId),incident=input.recoveryFrame?.incidents.find(incident=>incident.id===duty.incidentId),recoveryWork=populationRecoveryWorkPermits(input,frame,supply,input.recoveryFrame??null);
   if(duty.kind!=='evacuate'||duty.phase!=='sheltered'||!person||!incident||!input.recoveryFrame||!qualifiedResidentBuildingRecoveryWork({absoluteMinute:input.absoluteMinute,worldKey:input.worldKey,residents:input.population.residents,routineIntents:input.life.residents.map(row=>row.intent),navigation:input.navigation,site:input.site,frame:input.recoveryFrame,recoveryWork},person,incident))return row;}
  const person=input.population.residents.find(person=>person.id===row.residentId),assignment=frame.assignments!.find(assignment=>assignment.residentId===row.residentId);
  if(!person||person.ageYears<18||person.ageYears>=60||!assignment||assignment.when==='reconstruction-needed'&&(!input.recoveryFrame?.incidents.some(incident=>incident.requiresRepair)||input.recoveryFrame.incidents.some(incident=>incident.burning))||person.homePlaceId===assignment.placeId
   ||!input.population.registry.places.some(place=>place.id===assignment.placeId)||!Number.isSafeInteger(assignment.stockTargetTimber)||assignment.stockTargetTimber<1||assignment.stockTargetTimber>64
   ||supply.availableTimber>=assignment.stockTargetTimber)return row;
  const resource=supply.sources.find(source=>source.id===assignment.sourceId&&source.profile===frame.source.profile&&source.sourceSha256===frame.source.sha256&&source.siteIdentity===frame.source.siteIdentity);
  if(!resource||resource.remainingUnits<1||!frame.catalog.some(station=>station.station.residentId===row.residentId&&station.station.placeId===assignment.placeId))return row;
  const slot=person.registry.routine.find(slot=>input.absoluteMinute%1440>=slot.startMinute&&input.absoluteMinute%1440<slot.endMinute&&slot.placeId===row.intent.targetPlaceId&&slot.activity===row.intent.activity);
  if(!slot)return row;changed=true;
  return Object.freeze({...row,intent:Object.freeze({...row.intent,targetPlaceId:assignment.placeId,activity:assignment.activity,indoor:false,
   issuedAbsoluteMinute:Math.max(resource.registeredAtMinute,Math.floor(input.absoluteMinute/1440)*1440+slot.startMinute)})});
 });
 return changed?Object.freeze({...input.life,residents:Object.freeze(residents)}):input.life;
}

export interface PopulationWorkplaceState {
 readonly workstations:ResidentWorkstations|null;
 readonly timberSupply:VillageTimberSupply;
}
export function populationWorkplaceOperationObstacles(workstations:ResidentWorkstations|null,frame:ResidentWorkplaceFrame|null,
 navigation:VillageLifeNavigationState,site:VillageSiteLayout|null):readonly VillageLifeNavigationObstacle[]{
 if(!workstations||!frame||!site)return[];
 return workstations.entries.flatMap(entry=>{
  const station=frame.catalog.find(station=>station.station.id===entry.lease.stationId&&station.station.residentId===entry.lease.residentId),proof=frame.presentation?.find(proof=>proof.stationId===entry.lease.stationId&&proof.certificateSha256===entry.stationCertificateSha256);
  if(!station||!proof)return[];const radius=proof.body.radius+proof.body.margin,height=proof.body.height+proof.body.lift+proof.body.margin;
  if(!ownsExclusiveVillageWorkplaceOperation(navigation,site,entry.lease.residentId,{radius,height}))return[];
  const p=station.standPosition;
  return[{id:'ordinary-work:'+entry.lease.id,kind:'solid' as const,sourceSha256:frame.source.sha256,profile:frame.source.profile,
   activeFromAbsoluteMinute:entry.lease.sinceMinute,exceptResidentId:entry.lease.residentId,
   bounds:{min:[p[0]-radius,p[1],p[2]-radius]as const,max:[p[0]+radius,p[1]+height,p[2]+radius]as const}}];
 });
}
const sameSource=(a:ResidentActionSource,b:ResidentActionSource)=>a.profile===b.profile&&a.sha256===b.sha256&&a.siteIdentity===b.siteIdentity;
const retain=<T>(old:T,next:T):T=>JSON.stringify(old)===JSON.stringify(next)?old:next;
/** One clock boundary leases equipment, evaluates actual source observations,
 * and publishes a read-only queue port. No command or inventory is credited here. */
export function preparePopulationWorkplaces(value:PopulationWorkplaceState,input:ResidentRoutineActionsInput&{
 readonly queues:ResidentActionQueues;readonly frame:ResidentWorkplaceFrame|null;readonly millisecondsPerWorldMinute:number;
}):PopulationWorkplaceState&{readonly physical:ResidentRoutineActionPhysicalPort|undefined}{
 const contexts=residentRoutineActionContexts(input.queues,input),frame=input.frame;
 let workstations=value.workstations;const timberSupply=advanceVillageTimberSupply(value.timberSupply,input.absoluteMinute);
 const available=!!frame&&contexts.length>0&&contexts.every(context=>sameSource(context.source,frame.source));
 if(!available){
  if(workstations)workstations=retain(workstations,advanceResidentWorkstations(workstations,{absoluteMinute:input.absoluteMinute,catalog:[],requests:[],observations:[]}));
  return{workstations,timberSupply,physical:undefined};
 }
 if(workstations&&!sameSource(workstations.source,frame.source)){workstations=retain(workstations,advanceResidentWorkstations(workstations,{absoluteMinute:input.absoluteMinute,catalog:[],requests:[],observations:[]}));return{workstations,timberSupply,physical:undefined};}
 const prior=workstations??createResidentWorkstations(input.worldKey,frame.source,input.absoluteMinute);
 // Allocation precedes observation so the evaluator receives the real lease
 // and authored operation start, including on first approach and restore.
 let prepared=advanceResidentWorkstations(prior,{absoluteMinute:input.absoluteMinute,catalog:frame.catalog,requests:contexts,observations:[],mode:'allocate'});
 const clear=(residentId:string,stationId:string)=>{
  const proof=frame.presentation?.find(proof=>proof.stationId===stationId);
  return !!input.site&&!!proof&&ownsExclusiveVillageWorkplaceOperation(input.navigation,input.site,residentId,{radius:proof.body.radius+proof.body.margin,height:proof.body.height+proof.body.lift+proof.body.margin});
 };
 const observations:ResidentWorkstationObservation[]=(frame.observations??[]).filter(observation=>observation.atMinute===input.absoluteMinute&&clear(observation.residentId,observation.stationId));
 if(frame.observe)for(const context of contexts){
  const entry=prepared.entries.find(row=>row.lease.residentId===context.residentId&&row.lease.jobId===context.queue?.jobId)??null;
  if(!entry||!clear(context.residentId,entry.lease.stationId)||observations.some(observation=>observation.residentId===context.residentId))continue;const observation=frame.observe(context,entry,{millisecondsPerWorldMinute:input.millisecondsPerWorldMinute});
  if(observation)observations.push(observation);
 }
 prepared=advanceResidentWorkstations(prepared,{absoluteMinute:input.absoluteMinute,catalog:frame.catalog,requests:contexts,observations});
 workstations=retain(prior,prepared);
 return{workstations,timberSupply,physical:createResidentWorkstationPhysicalPort(workstations,frame.catalog)};
}

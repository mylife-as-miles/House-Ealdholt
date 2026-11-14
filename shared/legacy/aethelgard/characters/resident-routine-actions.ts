/** The existing life/navigation owners feed the source-adapted action queue.
 * This adapter owns no clock, movement, storage, physical lease or work credit.
 * Simulation-only household/place reservations are deliberately not consulted. */
import type {VillagePopulation} from './village-population';
import type {VillageLifeState,VillageLifeIntent} from './village-life';
import type {ResidentBuildingEmergencyState} from './resident-building-emergency';
import {resolveVillageSiteEndpoint,sameVillageSiteNavigationAllocation,type VillageSiteLayout} from './village-site';
import {ownsExclusiveVillageLifeExteriorAnchor,villageLifeJourneyCollisionSite,type VillageLifeNavigationState,type VillageLifeJourney} from './village-life-navigation';
import {createResidentActionQueues,advanceResidentActionQueues,parseResidentActionQueues,residentActionSourceKey,
 type ResidentActionQueue,type ResidentActionQueues,type ResidentActionGoal,type ResidentActionSource,type ResidentActionInterruption,
 type ResidentActionObservation,type ResidentActionArrival} from './resident-action-queue';
import type {ResidentActionWake} from './resident-action-wait';

export interface ResidentRoutineActionPhysicalContext {
 readonly worldKey:string;readonly absoluteMinute:number;readonly residentId:string;readonly goal:ResidentActionGoal;
 readonly source:ResidentActionSource;readonly journey:VillageLifeJourney;readonly arrival:ResidentActionArrival|null;
 readonly queue:ResidentActionQueue|null;
}
export type ResidentRoutineActionPhysicalObservation=Pick<ResidentActionObservation,'station'|'lease'|'facing'|'contacts'|'releases'|'invalidatedTarget'>;
/** A read-only port from a real source-qualified interaction owner. Neither a
 * routine label nor an abstract VillageLifeReservation implements this port. */
export interface ResidentRoutineActionPhysicalPort {
 observe(context:ResidentRoutineActionPhysicalContext):ResidentRoutineActionPhysicalObservation|null;
}
export interface ResidentRoutineActionsInput {
 readonly worldKey:string;readonly absoluteMinute:number;readonly population:VillagePopulation;readonly life:VillageLifeState;
 readonly navigation:VillageLifeNavigationState;readonly navigationOther?:VillageLifeNavigationState|null;readonly site:VillageSiteLayout|null;
 readonly buildingEmergency?:ResidentBuildingEmergencyState;readonly physical?:ResidentRoutineActionPhysicalPort;
 readonly wakes?:readonly ResidentActionWake[];
}
export interface ResidentRoutineActionSummary {
 readonly jobId:string;readonly step:ResidentActionQueue['current'];readonly status:'pending'|'blocked'|'interrupted'|'complete';
 readonly targetPlaceId:string;readonly goalActivity:string;readonly blockedReason:string|null;readonly performedWorldMinutes:number;
}
function sourceContext(input:ResidentRoutineActionsInput):{source:ResidentActionSource|null;navigation:VillageLifeNavigationState|null}{
 const site=input.site;if(!site)return{source:null,navigation:null};
 const identity=site.profile+':'+site.sourceSha256+':'+(site.navigationRevision??'source-site');
 const navigation=[input.navigation,input.navigationOther].find((n):n is VillageLifeNavigationState=>!!n&&n.profile===site.profile&&n.sourceSha256===site.sourceSha256
  &&n.siteIdentity===identity&&n.navigationRevision===site.navigationRevision
  &&(!n.navigationAllocation&&!site.navigationAllocation||!!n.navigationAllocation&&!!site.navigationAllocation&&sameVillageSiteNavigationAllocation(n.navigationAllocation,site.navigationAllocation)))??null;
 if(navigation&&Math.floor(navigation.absoluteMinute)!==input.absoluteMinute)throw Error('Selected routine action source must share the current life minute.');
 return{navigation,source:navigation?Object.freeze({profile:site.profile,sha256:site.sourceSha256,siteIdentity:navigation.siteIdentity!}):null};
}
function intentLineage(intent:VillageLifeIntent):string{return JSON.stringify([intent.residentId,intent.activityKey,intent.targetPlaceId,intent.activity,intent.priority,intent.indoor,intent.reason,intent.companionIds]);}
function goalPayloadMatches(goal:ResidentActionGoal,intent:VillageLifeIntent):boolean{return goal.activityKey===intent.activityKey&&goal.targetPlaceId===intent.targetPlaceId&&goal.activity===intent.activity;}
function ordinaryGoal(intent:VillageLifeIntent,occurrence=intent.issuedAbsoluteMinute):ResidentActionGoal {
 // The authored slot identifies a recurring occurrence. Life can reissue its
 // intent after a threat without turning the interrupted duty into a new job.
 // Nonroutine intentions retain their own issuance. No render clock is used.
 return Object.freeze({key:JSON.stringify([intent.residentId,intent.activityKey,intent.targetPlaceId,intent.activity,occurrence]),
  activityKey:intent.activityKey,activity:intent.activity,targetPlaceId:intent.targetPlaceId,issuedAbsoluteMinute:intent.issuedAbsoluteMinute,lineage:intentLineage(intent)});
}
function requests(input:ResidentRoutineActionsInput,previous?:ResidentActionQueues){
 const prior=new Map(previous?.residents.map(q=>[q.residentId,q])??[]),life=new Map(input.life.residents.map(r=>[r.residentId,r]));
 return input.population.residents.map(person=>{
  const current=life.get(person.id);if(!current)throw Error('Routine actions require all existing resident lives.');
  const duty=input.buildingEmergency?.duties.find(d=>d.residentId===person.id);
  const reason=duty?'emergency':current.intent.reason==='safety'||current.intent.reason==='household-protection'||current.safety.mode!=='routine'?'safety':current.intent.reason==='weather'?'weather':null;
  const paused:ResidentActionInterruption|null=reason?{id:duty?'building:'+duty.incidentId:reason+':'+person.id+':'+current.intent.issuedAbsoluteMinute,
   reason,sinceMinute:duty?.issuedAbsoluteMinute??current.intent.issuedAbsoluteMinute}:null;
  const old=prior.get(person.id),intended=paused?(current.suspendedIntent??current.intent):current.intent;
  let retained=paused?old?.goal:null;
  if(paused&&old&&!old.goal.lineage){const suspended=current.suspendedIntent??current.safety.interruptedIntent;
   if(suspended&&suspended.issuedAbsoluteMinute===old.goal.issuedAbsoluteMinute&&goalPayloadMatches(old.goal,suspended))retained=Object.freeze({...old.goal,lineage:intentLineage(suspended)});
  }
  if(!paused&&old&&intended.reason!=='routine'&&goalPayloadMatches(old.goal,intended)&&old.goal.lineage===intentLineage(intended)){
   const resumed=!!old.interruption&&input.life.journal.some(event=>event.kind==='duty-resumed'&&event.atMinute===intended.issuedAbsoluteMinute&&event.placeId===intended.targetPlaceId&&event.actorIds.includes(person.id))
    &&!input.life.journal.some(event=>(event.kind==='safety-interrupted'||event.kind==='weather-interrupted')&&event.actorIds.includes(person.id)&&event.atMinute>old.interruption!.sinceMinute&&event.atMinute<=intended.issuedAbsoluteMinute);
   if(old.goal.issuedAbsoluteMinute===intended.issuedAbsoluteMinute||resumed)retained=Object.freeze({...old.goal,issuedAbsoluteMinute:intended.issuedAbsoluteMinute});
  }
  const slot=intended.reason==='routine'?person.registry.routine.find(s=>input.absoluteMinute%1440>=s.startMinute&&input.absoluteMinute%1440<s.endMinute&&s.placeId===intended.targetPlaceId&&s.activity===intended.activity):null;
  const occurrence=slot?Math.floor(input.absoluteMinute/1440)*1440+slot.startMinute:intended.issuedAbsoluteMinute;
  return{residentId:person.id,goal:retained??ordinaryGoal(intended,occurrence),interruption:paused};
 });
}
function actualArrival(input:ResidentRoutineActionsInput,source:ResidentActionSource,navigation:VillageLifeNavigationState,
 journey:VillageLifeJourney,goal:ResidentActionGoal):ResidentActionArrival|null{
 const base=input.site!,site=villageLifeJourneyCollisionSite(journey,base);if(!site)return null;const endpoint=resolveVillageSiteEndpoint(site,goal.targetPlaceId,journey.residentId);
 if(!endpoint||journey.inside||journey.route||journey.status!=='at-threshold'||journey.reason!==null||journey.targetPlaceId!==goal.targetPlaceId
  ||journey.anchorPlaceId!==goal.targetPlaceId||journey.arrivalEvidence!=='certified-route-arrival'||journey.arrivedAtAbsoluteMinute===null
  ||journey.arrivedAtAbsoluteMinute>input.absoluteMinute||journey.sourceSha256!==source.sha256||journey.sourceSiteIdentity!==source.siteIdentity
  ||!ownsExclusiveVillageLifeExteriorAnchor(navigation,site,journey.residentId))return null;
 return Object.freeze({id:'resident-arrival:'+journey.residentId+':'+goal.targetPlaceId+':'+journey.arrivedAtAbsoluteMinute,residentId:journey.residentId,
  placeId:goal.targetPlaceId,anchorId:endpoint.id,atMinute:journey.arrivedAtAbsoluteMinute,source,kind:'certified-route-arrival',exclusivelyOwned:true});
}
function validateInput(input:ResidentRoutineActionsInput):void{
 if(input.population.residents.length!==100||input.life.residents.length!==100||input.life.worldKey!==input.worldKey
  ||!Number.isSafeInteger(input.absoluteMinute)||input.absoluteMinute<0||input.life.absoluteMinute!==input.absoluteMinute
  ||Math.floor(input.navigation.absoluteMinute)!==input.absoluteMinute)throw Error('Routine action queues share the existing complete roster and world-minute boundary.');
}
export function createResidentRoutineActions(input:ResidentRoutineActionsInput):ResidentActionQueues{
 validateInput(input);const context=sourceContext(input);
 const pending=createResidentActionQueues(input.worldKey,input.absoluteMinute,requests(input),context.source);
 return advanceResidentRoutineActions(pending,input);
}
/** Source-owned interaction requests, before the command cursor is advanced.
 * Collecting them neither acquires equipment nor invokes a physical provider. */
export function residentRoutineActionContexts(value:ResidentActionQueues,input:ResidentRoutineActionsInput):readonly ResidentRoutineActionPhysicalContext[]{
 validateInput(input);const previous=parseResidentActionQueues(value,{worldKey:input.worldKey,residentIds:input.population.residents.map(r=>r.id),maximumMinute:input.absoluteMinute});
 const context=sourceContext(input);if(!context.source||!context.navigation)return Object.freeze([]);
 const source=context.source,navigation=context.navigation,old=new Map(previous.residents.map(q=>[q.residentId,q]));
 return Object.freeze(requests(input,previous).flatMap(request=>{
  if(request.interruption)return[];const journey=navigation.residents.find(r=>r.residentId===request.residentId);if(!journey)return[];
  const queue=old.get(request.residentId)??null;
  return[Object.freeze({worldKey:input.worldKey,absoluteMinute:input.absoluteMinute,residentId:request.residentId,goal:request.goal,source,journey,
   arrival:actualArrival(input,source,navigation,journey,request.goal),queue:queue?.goal.key===request.goal.key?queue:null})];
 }));
}
export function advanceResidentRoutineActions(value:ResidentActionQueues,input:ResidentRoutineActionsInput):ResidentActionQueues{
 validateInput(input);const previous=parseResidentActionQueues(value,{worldKey:input.worldKey,residentIds:input.population.residents.map(r=>r.id),maximumMinute:input.absoluteMinute});
 const context=sourceContext(input),intents=requests(input,previous),old=new Map(previous.residents.map(q=>[q.residentId,q]));
 const observations:ResidentActionObservation[]=intents.map(request=>{
  const journey=context.navigation?.residents.find(r=>r.residentId===request.residentId),scope=input.site&&journey?villageLifeJourneyCollisionSite(journey,input.site):input.site,endpoint=scope&&resolveVillageSiteEndpoint(scope,request.goal.targetPlaceId,request.residentId);
  const arrival=journey&&context.source&&context.navigation?actualArrival(input,context.source,context.navigation,journey,request.goal):null;
  // Suspension never invokes a physical owner. A provider cannot replace the
  // navigation-derived arrival, destination, source or resident identity.
  const queue=old.get(request.residentId)??null,physical=!request.interruption&&journey&&context.source&&input.physical
   ?input.physical.observe(Object.freeze({worldKey:input.worldKey,absoluteMinute:input.absoluteMinute,residentId:request.residentId,goal:request.goal,
     source:context.source,journey,arrival,queue:queue?.goal.key===request.goal.key?queue:null})):null;
  return{residentId:request.residentId,source:context.source,destinationMapped:!!endpoint,
   navigationReason:journey?.reason??(!context.source?'source-unavailable':!endpoint?'destination-unmapped':null),arrival,
   station:physical?.station??null,lease:physical?.lease??null,facing:physical?.facing??null,contacts:physical?.contacts??[],releases:physical?.releases??[],
   invalidatedTarget:physical?.invalidatedTarget??false};
 });
 const next=advanceResidentActionQueues(previous,{worldKey:input.worldKey,absoluteMinute:input.absoluteMinute,source:context.source,residents:intents,observations,...(input.wakes?{wakes:input.wakes}:{})});
 // Same-minute polls may acquire a source or suspend a job, but identical
 // physical observations must not manufacture a new population generation.
 if(next.absoluteMinute===previous.absoluteMinute&&next.nextSequence===previous.nextSequence
  &&JSON.stringify(next)===JSON.stringify(previous))return previous;
 return next;
}
export function summarizeResidentRoutineAction(queue:ResidentActionQueue):ResidentRoutineActionSummary{
 return Object.freeze({jobId:queue.jobId,step:queue.current,status:queue.interruption?'interrupted':queue.current===null?'complete':queue.wait?'blocked':'pending',
  targetPlaceId:queue.goal.targetPlaceId,goalActivity:queue.goal.activity,blockedReason:queue.interruption?'interrupted:'+queue.interruption.reason:queue.wait?.reason??null,performedWorldMinutes:queue.performedWorldMinutes});
}
export {residentActionSourceKey};

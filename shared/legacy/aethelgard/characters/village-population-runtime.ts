/** The persistent population world: one clock owns recurring simulated lives
 * and separately qualified physical journeys. No storage, timers, renderer or
 * standing writes. Simulated life events never become witnessed travel/work
 * evidence merely because a presenter shows a schedule endpoint. */
import {validateVillagePopulation,type VillagePopulation,type PopulationFidelityTier} from './village-population';
import {resolveVillageSiteEndpoint,resolveVillageSitePath,sameVillageSiteNavigationAllocation,type VillageSiteLayout,type VillageSitePath,type VillageSiteNavigationAllocation} from './village-site';
import {placeDataArray,placeDataRecord,placeId} from '../place-use';
import {createVillageLife,advanceVillageLife,parseVillageLife,validateVillageLifeSafetySignal,type VillageLifeState,type VillageLifeIntent} from './village-life';
import {parseResidentSafetySignal,type ResidentSafetySignal} from './resident-safety';
import {parseResidentActionQueues,type ResidentActionQueues} from './resident-action-queue';
import type {ResidentActionWake} from './resident-action-wait';
import {parseResidentWorkstations,type ResidentWorkstations} from './resident-workstations';
import {preparePopulationWorkplaces,populationWorkplaceLife,populationWorkplaceOperationObstacles,populationRecoveryWorkPermits,type ResidentWorkplaceFrame} from './resident-workplace-frame';
import {createVillageTimberSupply,parseVillageTimberSupply,advanceVillageTimberSupply,consumeCompletedTimberWork,type VillageTimberSupply} from '../observer/village-timber-supply';
import {createResidentRoutineActions,advanceResidentRoutineActions,summarizeResidentRoutineAction,type ResidentRoutineActionPhysicalPort,type ResidentRoutineActionSummary} from './resident-routine-actions';
import {createVillageLifeNavigation,advanceVillageLifeNavigation,parseVillageLifeNavigation,sampleVillageLifeNavigation,ownsExclusiveVillageLifeExteriorAnchor,ownsExclusiveVillageLifeRouteWaitAnchor,ownsExclusiveVillageLifePatrolDwellAnchor,ownsQualifiedVillageLifeTrafficHold,ownsQualifiedVillageWorkplaceTrafficHold,ownsExclusiveVillageWorkplaceOperation,
  matchesVillageLifeSourceJourney,isUnusedVillageLifeEmergencyCarry,villageLifeNavigationPeerBody,qualifiedVillageNeutralReturnMotion,villageLifeJourneyCollisionSite,villageLifeObstacleContainsPoint,type VillageLifeNavigationState,type VillageLifeInitialPlace,type VillageLifeJourney} from './village-life-navigation';
import {sampleWorldEnvironment,type WorldEnvironmentOverride} from '../environment/world-environment-state';
import {copyObserverJSON} from '../observer/observer-json';
import {buildingDamageKey} from '../observer/building-damage';
import {parseVillageSiteEmergencyTargets,validateVillageSiteEmergencyTargets,sameVillageSiteEmergencyTarget,type VillageSiteEmergencyTarget} from './village-emergency-targets';
import {parseVillageSiteEmergencyTraversals,validateVillageSiteEmergencyTraversals,sameVillageSiteEmergencyTraversal,findVillageEmergencyTraversal,type VillageSiteEmergencyTraversal} from './village-emergency-traversal';
import {parseVillageSiteEmergencyRefuges,validateVillageSiteEmergencyRefuges,sameVillageSiteEmergencyRefuge,scopedVillageEmergencyRefugeSite,requiredVillageRefugeMotionClips,type VillageSiteEmergencyRefuge} from './village-emergency-refuges';
import {parseVillageSiteWorkplaceRoutes,validateVillageSiteWorkplaceRoutes,sameVillageSiteWorkplaceRoute,findVillageWorkplaceRoute,scopedVillageWorkplaceRouteSite,requiredVillageWorkplaceMotionClips,type VillageSiteWorkplaceRoute} from './village-workplace-routes';
import {createResidentBuildingEmergency,parseResidentBuildingEmergency,acknowledgeResidentBuildingEmergency,advanceResidentBuildingEmergency,residentBuildingEmergencyIntents,residentBuildingEmergencySafetySignals,qualifiedResidentBuildingStation,residentBuildingEmergencyLocomotionPermits,residentBuildingEmergencyRefugePermits,
 type ResidentBuildingEmergencyState,type ResidentBuildingEmergencyFrame,type ResidentBuildingDuty} from './resident-building-emergency';

export const VILLAGE_POPULATION_RUNTIME_MAX_BYTES=2*1024*1024;
export const VILLAGE_POPULATION_RUNTIME_MAX_FACTS_PER_RESIDENT=64;
export const VILLAGE_POPULATION_MAX_SAFETY_SIGNALS=32;
const MAX_SAFETY_HISTORY=256,MAX_SAFETY_REPLICATED_BYTES=256*1024;
export interface VillagePopulationResidentFacts {
  readonly residentId:string;readonly facts:readonly {readonly id:string;readonly value:boolean}[];
}
export interface VillagePopulationClock {
  readonly createdAt:number;readonly lastObservedAt:number;readonly simulatedElapsedMilliseconds:number;
  readonly pendingMilliseconds:number;readonly initialDayMinute:number;readonly millisecondsPerWorldMinute:number;
}
export interface VillagePopulationRuntime {
  readonly kind:'village-population-runtime';readonly schemaVersion:2;readonly generation:number;
  readonly worldKey:string;readonly contentRevision:string;readonly population:VillagePopulation;
  readonly clock:VillagePopulationClock;readonly walkingSpeedMetresPerSecond:number;
  readonly rosterFacts:readonly VillagePopulationResidentFacts[];
  readonly life:VillageLifeState;
  /** Saved ordinary commands follow the existing life/navigation clock. Their
   * physical proof is independent of abstract routine counters and disasters. */
  readonly routineActions:ResidentActionQueues;
  readonly workstations:ResidentWorkstations|null;
  readonly timberSupply:VillageTimberSupply;
  readonly navigation:VillageLifeNavigationState;
  /** Desktop and Quest source geometry differ. Retain the other platform's
   * cursor instead of treating a platform switch as a new physical arrival. */
  readonly navigationOther:VillageLifeNavigationState|null;
  /** Explicit world evidence only. No renderer, feud headline or Classic match
   * creates incidents. Delivery occurs on the same minutely life clock. */
  readonly safetySignals:readonly ResidentSafetySignal[];
  readonly safetySignalIds:readonly string[];
  readonly buildingEmergency?:ResidentBuildingEmergencyState;
}
export interface VillagePopulationTime {
  readonly absoluteWorldMinute:number;readonly dayIndex:number;readonly dayMinute:number;
  readonly fractionalMinute:number;readonly elapsedWorldMinutes:number;readonly deferredMilliseconds:number;
}
export type VillagePopulationRuntimeResult={readonly ok:true;readonly snapshot:VillagePopulationRuntime;readonly migrated?:boolean}|{readonly ok:false;readonly error:string};
export type VillagePopulationAdvanceResult={readonly ok:true;readonly snapshot:VillagePopulationRuntime;readonly advancedMilliseconds:number;readonly deferredMilliseconds:number}|{readonly ok:false;readonly error:string};
export interface VillagePopulationCreateInput {
  readonly population:VillagePopulation;readonly confirmedEntry:true;readonly worldKey:string;readonly contentRevision:string;
  readonly createdAt:number;readonly initialDayMinute:number;readonly millisecondsPerWorldMinute:number;
  readonly walkingSpeedMetresPerSecond:number;readonly rosterFacts?:readonly VillagePopulationResidentFacts[];
}
export interface VillagePopulationAdvanceInput {
  readonly expectedGeneration:number;readonly worldKey:string;readonly contentRevision:string;
  readonly observedAt:number;readonly maxAdvanceMinutes:number;
  readonly site?:VillageSiteLayout|null;
  readonly buildingEmergencyFrame?:ResidentBuildingEmergencyFrame|null;
  readonly routineActionPhysical?:ResidentRoutineActionPhysicalPort;
  readonly workplaceFrame?:ResidentWorkplaceFrame|null;
  readonly routineActionWakes?:readonly ResidentActionWake[];
}
export interface VillagePopulationExpectedIdentity {readonly worldKey:string;readonly contentRevision:string}
export interface VillagePopulationSafetyInput extends VillagePopulationExpectedIdentity {
  readonly expectedGeneration:number;readonly signals:readonly ResidentSafetySignal[];
}
export type VillagePopulationLocationReason='site-unavailable'|'place-unmapped'|'route-unmapped'|'route-exceeds-slot'|'anchor-conflict'|'navigation-unavailable'|'activity-indoors'|'life-activity-unqualified'|'life-resource-unavailable';
export interface VillagePopulationVisualTravel {
 readonly journey:VillageLifeJourney;readonly profile:VillageSiteLayout['profile'];readonly sourceSha256:string;readonly siteIdentity:string;
 readonly navigationRevision?:string;readonly navigationAllocation?:VillageSiteNavigationAllocation;
 readonly metresPerSecond:number;readonly maximumAdvanceSeconds:number;
}
export interface VillagePopulationResidentState {
  readonly residentId:string;readonly tier:PopulationFidelityTier;
  readonly activity:string;readonly roleClip:null;readonly availableRoleClips:readonly string[];
  readonly scheduledPlaceId:string;readonly placeId:string|null;readonly fromPlaceId:string;
  readonly slotIndex:number;readonly slotStartMinute:number;readonly slotEndMinute:number;
  readonly status:'at-place'|'travelling'|'unmapped'|'blocked';readonly reason:VillagePopulationLocationReason|null;
  readonly position:readonly [number,number,number]|null;readonly yawRadians:number;readonly moving:boolean;readonly presentable:boolean;
  readonly lifeIntent?:VillageLifeIntent;readonly simulatedPlaceId?:string;
  readonly lifeStatus?:'active'|'queued'|'unavailable';
  /** Read-only command cursor; never permission to play a work animation. */
  readonly routineAction?:ResidentRoutineActionSummary;
  /** Presentation only: queued for a logical resource at an exclusively owned
   * certified exterior stand. Never work, equipment use or new arrival proof. */
  readonly waitingForResource?:true;
  /** Presentation only: still outside at its own reached source point while a
   * different destination is blocked. Never that destination's action. */
  readonly waitingForRoute?:true;
  /** Neutral presence after a routine guard journey really reaches its own
   * exclusive exterior goal. This is neither patrol motion nor work. */
  readonly pausingAtDestination?:true;
  /** Read-only physical phase of an explicitly source-authored lane circuit.
   * The canonical life goal and its simulated-routine counters stay separate. */
  readonly patrol?:{readonly planId:string;readonly phase:'travelling'|'dwelling'|'waiting';readonly completedLegs:number;readonly waypointPlaceId:string};
  /** Source ownership only, rechecked against every physical peer/corridor.
   * Clip, prop, floor and transition/blend measurements remain separate. */
  readonly patrolDwell?:{readonly elapsedSeconds:number;readonly durationSeconds:number};
  readonly emergency?:{
    readonly incidentId:string;readonly phase:ResidentBuildingDuty['phase'];readonly stationId:string|null;
    readonly clip:'idle'|'carry_bucket_walk'|'work_hammer_bench'|'work_chisel'|null;
    readonly contactPoint:readonly [number,number,number]|null;readonly contactSourceActor:string|null;
    readonly yawRadians:number|null;readonly actionStartedAbsoluteMinute:number|null;readonly actionElapsedSeconds:number|null;
    readonly waterUnits:number;readonly qualified:boolean;readonly requiredLocomotionClip?:'carry_bucket_walk';readonly traversalId?:string;
  };
  readonly refugeMotion?:{readonly refugeIds:readonly string[];readonly certificates:Readonly<Record<string,string>>;readonly trafficStopped?:true;readonly neutralClips:readonly string[];readonly zeroCrossfade:true};
  readonly neutralReturnMotion?:{readonly id:string;readonly certificateSha256:string;readonly anchorId:string;readonly placeId:string;readonly neutralClips:readonly string[];readonly zeroCrossfade:true};
  readonly workplaceMotion?:{readonly routeId:string;readonly certificateSha256:string;readonly returnPlaceId:string;readonly recoveryRefuge?:{readonly id:string;readonly certificateSha256:string};readonly neutralClips:readonly string[];readonly trafficStopped?:true;readonly zeroCrossfade:true};
  readonly ordinaryWork?:{readonly qualified:true;readonly stationId:string;readonly leaseId:string;readonly certificateSha256:string;readonly source:import('./resident-action-queue').ResidentActionSource;readonly phase:'face'|'perform'|'release';readonly clip:string;readonly yawRadians:number;readonly elapsedSeconds:number;readonly body:{readonly radius:number;readonly height:number;readonly margin:number;readonly lift:number};readonly clipMeasurement:import('./population-motion-clearance').PopulationMotionClipEvidence;readonly clipMeasurements?:Readonly<Record<string,import('./population-motion-clearance').PopulationMotionClipEvidence>>;readonly files:Readonly<Record<string,string>>};
  readonly workPoseQualified?:boolean;
  readonly visualTravel?:VillagePopulationVisualTravel;
  readonly navigationStatus?:string;readonly navigationReason?:string|null;
  readonly arrivalEvidence?:'none'|'initial-placement'|'certified-route-arrival';readonly arrivedAtAbsoluteMinute?:number|null;
}
export interface VillagePopulationSample {
  readonly generation:number;readonly time:VillagePopulationTime;
  readonly observation?:VillagePopulationObservationStatus;
  readonly residents:readonly VillagePopulationResidentState[];
  readonly navigationAuthority?:'resident-life'|'schedule-projection';readonly life?:VillageLifeState;
  readonly navigationCapability?:'complete-home-bindings'|'legacy-incomplete-homes'|'site-unavailable';readonly missingHomeBindings?:number;
  readonly buildingEmergency?:ResidentBuildingEmergencyState;
  /** Read-only presentation bound; no simulation or arrival may cross it. */
  readonly visualAdvanceSeconds?:number;
  readonly counts:{readonly total:100;readonly households:25;readonly major:20;readonly scheduled:80;readonly mapped:number;readonly unmapped:number;readonly moving:number;readonly blocked:number};
}

const validated=new WeakSet<object>();
const observations=new WeakMap<object,VillagePopulationObservationStatus>();
const emergencyFrames=new WeakMap<object,ResidentBuildingEmergencyFrame>();
const workplaceFrames=new WeakMap<object,ResidentWorkplaceFrame>();
const emergencyTargetBindings=new WeakMap<object,readonly VillageSiteEmergencyTarget[]>();
const emergencyTraversalBindings=new WeakMap<object,readonly VillageSiteEmergencyTraversal[]>();
const emergencyRefugeBindings=new WeakMap<object,readonly VillageSiteEmergencyRefuge[]>();
const workplaceRouteBindings=new WeakMap<object,readonly VillageSiteWorkplaceRoute[]>();
type AllocationPolicy={readonly kind:'unbound'|'legacy'|'mixed'}|{readonly kind:'paired';readonly pair:VillageSiteNavigationAllocation};
const UNBOUND:AllocationPolicy=Object.freeze({kind:'unbound'}),LEGACY:AllocationPolicy=Object.freeze({kind:'legacy'}),MIXED:AllocationPolicy=Object.freeze({kind:'mixed'});
/** Historical observer reconstruction cannot erase the source policy of the
 * canonical world. This read-only provenance is never a saved permission. */
const observationAllocationPolicies=new WeakMap<object,AllocationPolicy>();
function combineAllocation(a:AllocationPolicy,b:AllocationPolicy):AllocationPolicy{
  if(a.kind==='unbound')return b;if(b.kind==='unbound')return a;
  if(a.kind==='legacy'&&b.kind==='legacy')return LEGACY;
  if(a.kind==='paired'&&b.kind==='paired'&&sameVillageSiteNavigationAllocation(a.pair,b.pair))return a;
  return MIXED;
}
function allocationPolicy(s:VillagePopulationRuntime):AllocationPolicy{
  let policy=observationAllocationPolicies.get(s)??UNBOUND;
  for(const nav of [s.navigation,s.navigationOther]){
    if(!nav||nav.sourceSha256===null)continue;
    const own:AllocationPolicy=nav.navigationRevision?(nav.navigationAllocation?{kind:'paired',pair:nav.navigationAllocation}:MIXED):LEGACY;
    policy=combineAllocation(policy,own);
  }
  return policy;
}
function compatibleAllocation(s:VillagePopulationRuntime,site:VillageSiteLayout):boolean{
  if(!!site.navigationRevision!==!!site.navigationAllocation)return false;
  const policy=allocationPolicy(s);
  if(policy.kind==='unbound')return true;
  if(policy.kind==='legacy')return !site.navigationRevision&&!site.navigationAllocation;
  return policy.kind==='paired'&&!!site.navigationAllocation
    &&sameVillageSiteNavigationAllocation(policy.pair,site.navigationAllocation)
    &&site.navigationRevision===(site.profile==='desktop'?policy.pair.desktopRevision:policy.pair.questRevision);
}
const fail=(error:string):{readonly ok:false;readonly error:string}=>({ok:false,error});
const safe=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
function integer(v:unknown):number{if(!safe(v))throw Error('Population time and generation must be safe nonnegative integers.');return v;}
function key(v:unknown):string{if(typeof v!=='string'||!v||v.length>2048||v.trim()!==v||/[\u0000-\u001f\u007f]/.test(v))throw Error('An explicit confirmed-entry world key is required.');return v;}
/** Descriptor inspection precedes every read of untrusted save data. */
function ownData(v:unknown,budget={left:300000},depth=0):any{
  if(--budget.left<0||depth>32)throw Error('Population data exceeds its bounded shape budget.');
  if(v===null||typeof v==='boolean'||typeof v==='string'&&v.length<=32768||typeof v==='number'&&Number.isFinite(v))return v;
  if(Array.isArray(v))return Object.freeze(placeDataArray(v).map(item=>ownData(item,budget,depth+1)));
  if(!v||typeof v!=='object')throw Error('Population data must contain plain finite values.');
  const input=placeDataRecord(v,Object.getOwnPropertyNames(v)),out:Record<string,unknown>={};
  for(const name of Object.getOwnPropertyNames(input))Object.defineProperty(out,name,{value:ownData(input[name],budget,depth+1),enumerable:true});
  return Object.freeze(out);
}
function equalData(a:unknown,b:unknown):boolean{
  if(a===b)return true;if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>equalData(v,b[i]));
  const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();return ak.length===bk.length&&ak.every((k,i)=>k===bk[i]&&equalData((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]));
}
function population(value:unknown):VillagePopulation{
  const p=ownData(value) as VillagePopulation,error=validateVillagePopulation(p);if(error)throw Error(error);
  if(p.residents.filter(r=>r.fidelityTier==='major').length!==20||p.residents.filter(r=>r.fidelityTier==='persistent').length!==80)throw Error('This population runtime needs exactly 20 major labels and 80 scheduled labels.');
  if(p.registry.residents.length!==100||p.registry.households.length!==25||p.registry.places.length!==p.places.length)throw Error('Population metadata and life registry counts disagree.');
  for(const r of p.residents){const life=p.registry.residents.find(x=>x.id===r.id),home=p.households.find(h=>h.id===r.householdId);
    if(!life||!home||!equalData(r.registry,life)||r.label!==life.label||r.householdId!==life.homeHouseholdId||r.homePlaceId!==home.homePlaceId||r.influenceSensitivity!==life.influenceSensitivity
      ||r.roleId!==life.role.id||r.roleLabel!==life.role.label||r.purpose!==life.role.purpose)throw Error('Resident identity, role, routine and household must match the persisted registry.');}
  for(const h of p.households)if(!p.registry.households.some(x=>equalData(x,{id:h.id,label:h.label,homePlaceId:h.homePlaceId,memberIds:h.memberIds})))throw Error('Household metadata and registered kin homes disagree.');
  for(const place of p.places)if(!p.registry.places.some(x=>x.id===place.id&&x.label===place.label))throw Error('Population places must match the registered life places.');
  return p;
}
function clock(value:unknown):VillagePopulationClock{
  const c=placeDataRecord(value,['createdAt','lastObservedAt','simulatedElapsedMilliseconds','pendingMilliseconds','initialDayMinute','millisecondsPerWorldMinute']);
  for(const n of Object.values(c))integer(n);
  const v=c as unknown as VillagePopulationClock;
  if(v.initialDayMinute>=1440||v.millisecondsPerWorldMinute<1||!safe(v.millisecondsPerWorldMinute*1440)||v.lastObservedAt<v.createdAt
    ||v.simulatedElapsedMilliseconds>v.lastObservedAt-v.createdAt||v.pendingMilliseconds!==v.lastObservedAt-v.createdAt-v.simulatedElapsedMilliseconds
    ||!safe(v.initialDayMinute+Math.floor(v.simulatedElapsedMilliseconds/v.millisecondsPerWorldMinute)))throw Error('Population clock cursor and elapsed horizon disagree.');
  return Object.freeze({...v});
}
function facts(value:unknown,p:VillagePopulation):readonly VillagePopulationResidentFacts[]{
  const rows=placeDataArray(value),known=new Set(p.residents.map(r=>r.id)),seen=new Set<string>();
  const result=rows.map(v=>{const r=placeDataRecord(v,['residentId','facts']),id=placeId(r.residentId);if(!known.has(id)||seen.has(id))throw Error('Every resident needs exactly one facts record.');seen.add(id);
    const values=placeDataArray(r.facts);if(values.length>VILLAGE_POPULATION_RUNTIME_MAX_FACTS_PER_RESIDENT)throw Error('Resident facts exceed their bounded save budget.');const ids=new Set<string>();
    const owned=values.map(v=>{const f=placeDataRecord(v,['id','value']),id=placeId(f.id);if(id.length>96||ids.has(id)||typeof f.value!=='boolean')throw Error('Resident facts require distinct IDs and boolean values.');ids.add(id);return Object.freeze({id,value:f.value});});
    return Object.freeze({residentId:id,facts:Object.freeze(owned)});
  });if(result.length!==100)throw Error('All 100 resident facts records must persist, including empty histories.');return Object.freeze(result);
}
function absoluteMinute(c:VillagePopulationClock):number{return c.initialDayMinute+c.simulatedElapsedMilliseconds/c.millisecondsPerWorldMinute;}
function lifeConditionsAt(worldKey:string,c:VillagePopulationClock,overrideAt?:(minute:number)=>WorldEnvironmentOverride|undefined){
  return (minute:number)=>{
    const weather=sampleWorldEnvironment({absoluteWorldMinute:minute,dayIndex:Math.floor(minute/1440),dayMinute:minute%1440,
      fractionalMinute:0,elapsedWorldMinutes:minute-c.initialDayMinute,deferredMilliseconds:0},worldKey,overrideAt?.(minute));
    return {weather:weather.weather,daylight:weather.daylight};
  };
}
function lifeIntents(life:VillageLifeState):readonly VillageLifeIntent[]{return life.residents.map(resident=>resident.intent);}
const initialPlaces=new WeakMap<VillagePopulation,readonly VillageLifeInitialPlace[]>();
function populationInitialPlaces(population:VillagePopulation):readonly VillageLifeInitialPlace[]{
  let homes=initialPlaces.get(population);if(!homes){homes=Object.freeze(population.residents.map(resident=>Object.freeze({residentId:resident.id,placeId:resident.homePlaceId,indoor:true})));initialPlaces.set(population,homes);}return homes;
}
function initialNavigation(life:VillageLifeState,c:VillagePopulationClock,speed:number):VillageLifeNavigationState{
  const minute=absoluteMinute(c);
  return advanceVillageLifeNavigation(createVillageLifeNavigation(minute),{absoluteMinute:minute,site:null,intents:lifeIntents(life),
    metresPerWorldMinute:speed*c.millisecondsPerWorldMinute/1000,allowInitialPlacement:true});
}
function ownedNavigation(value:unknown,p:VillagePopulation,c:VillagePopulationClock):VillageLifeNavigationState{
  const navigation=parseVillageLifeNavigation(ownData(value));
  if(Math.abs(navigation.absoluteMinute-absoluteMinute(c))>1e-8)throw Error('Population journey cursor must use the population world clock.');
  const known=new Set(p.residents.map(resident=>resident.id)),seen=new Set<string>();
  for(const row of navigation.residents){if(!known.has(row.residentId)||seen.has(row.residentId))throw Error('Journey records must identify the population exactly once.');seen.add(row.residentId);}
  if(seen.size!==100)throw Error('All 100 resident journey records must persist, including unmapped homes and jobs.');
  return navigation;
}
function safetyFeed(value:unknown,p:VillagePopulation,minute:number):readonly ResidentSafetySignal[]{
  const rows=placeDataArray(value),seen=new Set<string>();
  if(rows.length>VILLAGE_POPULATION_MAX_SAFETY_SIGNALS)throw Error('Safety input exceeds its bounded incident feed.');
  return Object.freeze(rows.map(value=>{
    const error=validateVillageLifeSafetySignal(value,p,minute);if(error)throw Error(error);
    const signal=parseResidentSafetySignal(value);
    if(signal.id.length>48||seen.has(signal.id)||signal.expiresAbsoluteMinute-signal.observedAbsoluteMinute>10080)throw Error('Safety facts need distinct stable IDs and a bounded expiry.');
    seen.add(signal.id);return signal;
  }));
}
function safetyHistory(value:unknown,feed:readonly ResidentSafetySignal[]):readonly string[]{
  const ids=placeDataArray(value).map(value=>placeId(value));
  if(ids.length>MAX_SAFETY_HISTORY||new Set(ids).size!==ids.length||ids.some(id=>id.length>48)||feed.some(signal=>!ids.includes(signal.id)))throw Error('Safety delivery history must retain bounded distinct incident IDs.');
  return Object.freeze(ids);
}
function safetyBudget(feed:readonly ResidentSafetySignal[],life:VillageLifeState):void{
  // JSON repeats a known report for its recipients. Bound that fan-out as
  // well as incident count, so an all-village alarm cannot exhaust the save.
  const reports=new Map<string,ResidentSafetySignal>();
  for(const signal of feed)reports.set(signal.id,signal);
  for(const resident of life.residents)for(const signal of resident.safety.knownSignals)
    if(signal.expiresAbsoluteMinute>life.absoluteMinute&&!reports.has(signal.id))reports.set(signal.id,signal);
  let bytes=0;
  for(const signal of reports.values()){
    bytes+=new TextEncoder().encode(JSON.stringify(signal)).byteLength*(signal.knownByResidentIds.length+1);
    if(bytes>MAX_SAFETY_REPLICATED_BYTES)throw Error('Safety recipient fan-out exceeds the durable save budget.');
  }
}
function ownRuntime(value:unknown):VillagePopulationRuntime{
  if(value&&typeof value==='object'&&validated.has(value))return value as VillagePopulationRuntime;
  const r=placeDataRecord(value,['kind','schemaVersion','generation','worldKey','contentRevision','population','clock','walkingSpeedMetresPerSecond','rosterFacts'],['life','navigation','navigationOther','safetySignals','safetySignalIds','buildingEmergency','routineActions','workstations','timberSupply']);
  if(r.kind!=='village-population-runtime'||r.schemaVersion!==1&&r.schemaVersion!==2)throw Error('Unsupported or future population runtime save.');
  if(r.schemaVersion===1&&('life'in r||'navigation'in r||'navigationOther'in r||'safetySignals'in r||'safetySignalIds'in r||'routineActions'in r||'workstations'in r||'timberSupply'in r)
    ||r.schemaVersion===2&&(!('life'in r)||!('navigation'in r)||!('navigationOther'in r)||!('safetySignals'in r)||!('safetySignalIds'in r)))throw Error('Population life schema and saved fields disagree.');
  const p=population(r.population),c=clock(r.clock),speed=r.walkingSpeedMetresPerSecond,worldKey=key(r.worldKey);
  if(typeof speed!=='number'||!Number.isFinite(speed)||speed<.1||speed>4)throw Error('Population walking speed must be explicit and bounded.');
  // V1 had no recurring-life events. Begin the new layer at its saved cursor;
  // migration preserves the old epoch and never invents pre-migration history.
  const minute=Math.floor(absoluteMinute(c)),life=r.schemaVersion===1?createVillageLife(p,minute,worldKey)
    :parseVillageLife(ownData(r.life),p,{worldKey,absoluteMinute:minute});
  const navigation=r.schemaVersion===1?initialNavigation(life,c,speed):ownedNavigation(r.navigation,p,c);
  const navigationOther=r.schemaVersion===1||r.navigationOther===null?null:ownedNavigation(r.navigationOther,p,c);
  if(navigationOther&&(!navigation.profile||!navigationOther.profile||navigation.profile===navigationOther.profile))throw Error('Saved physical cursors need distinct source profiles.');
  const safetySignals=r.schemaVersion===1?Object.freeze([]):safetyFeed(r.safetySignals,p,minute),safetySignalIds=r.schemaVersion===1?Object.freeze([]):safetyHistory(r.safetySignalIds,safetySignals);
  safetyBudget(safetySignals,life);
  const buildingEmergency=r.buildingEmergency===undefined?undefined:parseResidentBuildingEmergency(r.buildingEmergency);
  if(buildingEmergency&&(buildingEmergency.worldKey!==worldKey||Math.abs(buildingEmergency.absoluteMinute-absoluteMinute(c))>1e-7||buildingEmergency.duties.some(d=>!p.residents.some(person=>person.id===d.residentId))))throw Error('Emergency work belongs to another roster, world or clock.');
  // Old saves acquire pending commands at their saved cursor. No previous
  // travel, contact, work, relationship or personal fact is reconstructed.
  const routineActions=r.routineActions===undefined?createResidentRoutineActions({worldKey,absoluteMinute:minute,population:p,life,navigation,navigationOther,site:null,buildingEmergency})
    :parseResidentActionQueues(r.routineActions,{worldKey,residentIds:p.residents.map(person=>person.id),maximumMinute:minute});
  if(routineActions.absoluteMinute!==minute)throw Error('Ordinary action queues must share the saved life minute.');
  if(routineActions.source&&![navigation,navigationOther].some(nav=>nav?.profile===routineActions.source!.profile&&nav.sourceSha256===routineActions.source!.sha256&&nav.siteIdentity===routineActions.source!.siteIdentity))throw Error('Ordinary actions belong to an absent physical source cursor.');
  const workstations=r.workstations===undefined||r.workstations===null?null:parseResidentWorkstations(r.workstations);
  const timberSupply=r.timberSupply===undefined?createVillageTimberSupply(worldKey,minute):parseVillageTimberSupply(r.timberSupply,worldKey);
  if(timberSupply.absoluteMinute!==minute||workstations&&(workstations.worldKey!==worldKey||workstations.absoluteMinute!==minute||workstations.entries.some(row=>!p.residents.some(person=>person.id===row.lease.residentId))
    ||![navigation,navigationOther].some(nav=>nav?.profile===workstations.source.profile&&nav.sourceSha256===workstations.source.sha256&&nav.siteIdentity===workstations.source.siteIdentity)))throw Error('Physical workplaces or supplies changed their roster, source or clock.');
  const s:VillagePopulationRuntime=Object.freeze({kind:'village-population-runtime',schemaVersion:2,generation:integer(r.generation),worldKey,contentRevision:placeId(r.contentRevision),population:p,clock:c,walkingSpeedMetresPerSecond:speed,rosterFacts:facts(r.rosterFacts,p),life,routineActions,workstations,timberSupply,navigation,navigationOther,safetySignals,safetySignalIds,...(buildingEmergency?{buildingEmergency}:{})});validated.add(s);return s;
}
export function createVillagePopulationRuntime(input:VillagePopulationCreateInput):VillagePopulationRuntimeResult{
  try{
    const r=placeDataRecord(input,['population','confirmedEntry','worldKey','contentRevision','createdAt','initialDayMinute','millisecondsPerWorldMinute','walkingSpeedMetresPerSecond'],['rosterFacts']);
    if(r.confirmedEntry!==true)throw Error('Population creation requires actual confirmed inherited entry supplied by its host.');
    const p=population(r.population),createdAt=integer(r.createdAt);
    // Mark only a final complete snapshot as trusted; this never changes a
    // population/household key or manufactures personal memories.
    return{ok:true,snapshot:ownRuntime({kind:'village-population-runtime',schemaVersion:1,generation:0,worldKey:r.worldKey,contentRevision:r.contentRevision,population:p,
      clock:{createdAt,lastObservedAt:createdAt,simulatedElapsedMilliseconds:0,pendingMilliseconds:0,initialDayMinute:r.initialDayMinute,millisecondsPerWorldMinute:r.millisecondsPerWorldMinute},walkingSpeedMetresPerSecond:r.walkingSpeedMetresPerSecond,
      rosterFacts:r.rosterFacts??p.residents.map(resident=>({residentId:resident.id,facts:[]}))})};
  }catch(error){return fail(error instanceof Error?error.message:'Invalid population creation data.');}
}
export function validateVillagePopulationRuntime(value:unknown):string|null{try{ownRuntime(value);return null;}catch(error){return error instanceof Error?error.message:'Invalid population runtime.';}}
/** Record explicit witnessed/reported world evidence without advancing time.
 * Repeated IDs are idempotent; changing the payload of a pending ID is refused.
 * The host decides canon eligibility before calling this API. */
export function reportVillagePopulationSafetySignals(snapshot:VillagePopulationRuntime,input:VillagePopulationSafetyInput):VillagePopulationRuntimeResult{
  try{
    const s=ownRuntime(snapshot);if(observations.has(s))throw Error('Read-only observer projections cannot accept canonical safety mutations.');placeDataRecord(input,['expectedGeneration','worldKey','contentRevision','signals']);
    if(integer(input.expectedGeneration)!==s.generation||key(input.worldKey)!==s.worldKey||placeId(input.contentRevision)!==s.contentRevision)throw Error('Safety input belongs to a stale or different population world.');
    const raw=placeDataArray(input.signals);if(raw.length>VILLAGE_POPULATION_MAX_SAFETY_SIGNALS)throw Error('Safety input exceeds its bounded incident feed.');
    const incoming=new Map<string,ResidentSafetySignal>();
    for(const value of raw){
      const signal=safetyFeed([value],s.population,s.life.absoluteMinute)[0],prior=incoming.get(signal.id);
      if(prior&&!equalData(prior,signal))throw Error('A stable safety incident ID cannot change its input evidence.');
      incoming.set(signal.id,signal);
    }
    const existing=new Map(s.safetySignals.map(signal=>[signal.id,signal])),seen=new Set(s.safetySignalIds),history=[...s.safetySignalIds];
    let changed=false;
    for(const signal of incoming.values()){
      const prior=existing.get(signal.id);if(prior&&!equalData(prior,signal))throw Error('A stable safety incident ID cannot change its pending evidence.');
      if(seen.has(signal.id))continue;
      existing.set(signal.id,signal);seen.add(signal.id);history.push(signal.id);changed=true;
    }
    if(!changed)return{ok:true,snapshot:s};
    if(existing.size>VILLAGE_POPULATION_MAX_SAFETY_SIGNALS)throw Error('Too many pending safety incidents.');
    const safetySignals=Object.freeze([...existing.values()].sort((a,b)=>a.observedAbsoluteMinute-b.observedAbsoluteMinute||(a.id<b.id?-1:a.id>b.id?1:0)));
    safetyBudget(safetySignals,s.life);
    const next:VillagePopulationRuntime=Object.freeze({...s,generation:integer(s.generation+1),safetySignals,safetySignalIds:Object.freeze([...history.filter(id=>!existing.has(id)).slice(-(MAX_SAFETY_HISTORY-existing.size)),...safetySignals.map(signal=>signal.id)])});
    // Check the complete serialized budget before a report can become state.
    if(new TextEncoder().encode(JSON.stringify(next)).byteLength>VILLAGE_POPULATION_RUNTIME_MAX_BYTES)throw Error('Safety input exceeds the population save budget.');
    validated.add(next);return{ok:true,snapshot:next};
  }catch(error){return fail(error instanceof Error?error.message:'Safety input refused.');}
}
export function advanceVillagePopulationRuntime(snapshot:VillagePopulationRuntime,input:VillagePopulationAdvanceInput):VillagePopulationAdvanceResult{
  if(observations.has(snapshot))return fail('Read-only observer projections cannot enter canonical advancement.');
  return advancePopulation(snapshot,input);
}
function advancePopulation(snapshot:VillagePopulationRuntime,input:VillagePopulationAdvanceInput,observation?:VillagePopulationObservationOptions):VillagePopulationAdvanceResult{
  try{
    const s=ownRuntime(snapshot);placeDataRecord(input,['expectedGeneration','worldKey','contentRevision','observedAt','maxAdvanceMinutes'],['site','buildingEmergencyFrame','routineActionPhysical','routineActionWakes','workplaceFrame']);
    if(integer(input.expectedGeneration)!==s.generation||key(input.worldKey)!==s.worldKey||placeId(input.contentRevision)!==s.contentRevision)throw Error('Population generation or confirmed-entry/content identity changed.');
    const at=integer(input.observedAt),budget=integer(input.maxAdvanceMinutes),c=s.clock;if(at<c.lastObservedAt||budget<1||budget>10080)throw Error('Population time cannot rewind; supply a bounded life catch-up budget of at most one week.');
    const pending=at-c.createdAt-c.simulatedElapsedMilliseconds,advancedMilliseconds=Math.min(pending,budget*c.millisecondsPerWorldMinute);
    const nextClock=clock({...c,lastObservedAt:at,simulatedElapsedMilliseconds:c.simulatedElapsedMilliseconds+advancedMilliseconds,pendingMilliseconds:pending-advancedMilliseconds});
    const requestedSite=input.site??null,capability=requestedSite?siteCache(requestedSite,s.population):null;
    // Older validated source packages contain public stands but no authored
    // homes. They remain a labelled presentation fallback, never a route graph
    // allowed to replace or reset durable physical cursors.
    const site=requestedSite&&capability?.durableHomeBindings?requestedSite:null;
    const allocationHold=allocationPolicy(s).kind==='mixed'||!!site&&!compatibleAllocation(s,site);
    const from=absoluteMinute(c),to=absoluteMinute(nextClock),targetLifeMinute=Math.floor(to),conditionsAt=lifeConditionsAt(s.worldKey,c,observation?.environmentAt);
    const frameAt=(minute:number)=>observation?.buildingEmergencyAt?.(minute)??input.buildingEmergencyFrame??null;
    const safetySignalsAt=(minute:number)=>[...s.safetySignals.filter(signal=>signal.observedAbsoluteMinute<=minute&&signal.expiresAbsoluteMinute>minute),...(observation?.signalsAt?.(minute)??[]),...residentBuildingEmergencySafetySignals({absoluteMinute:minute,worldKey:s.worldKey,residents:s.population.residents,routineIntents:lifeIntents(s.life),navigation,site,frame:frameAt(minute),recoveryWork:populationRecoveryWorkPermits({population:s.population,absoluteMinute:minute},observation?.workplaceFrame??input.workplaceFrame??null,timberSupply,frameAt(minute))})];
    let life=s.life,navigation=s.navigation,navigationOther=s.navigationOther,buildingEmergency=s.buildingEmergency,routineActions=s.routineActions,workstations=s.workstations,timberSupply=s.timberSupply;
    if(site&&!allocationHold&&navigation.profile&&site.profile!==navigation.profile){
      const previous=navigation;
      navigation=navigationOther?.profile===site.profile?navigationOther:initialNavigation(life,c,s.walkingSpeedMetresPerSecond);
      navigationOther=previous;
    }
    const navigate=(minute:number)=>{
      const frame=frameAt(minute),workFrame=observation?.workplaceFrame??input.workplaceFrame??null,physicalLife=populationWorkplaceLife({worldKey:s.worldKey,absoluteMinute:life.absoluteMinute,population:s.population,life,navigation,navigationOther,site,buildingEmergency,recoveryFrame:frame},allocationHold?null:workFrame,timberSupply),routineIntents=lifeIntents(physicalLife);
      const shared={absoluteMinute:minute,metresPerWorldMinute:s.walkingSpeedMetresPerSecond*c.millisecondsPerWorldMinute/1000,allowInitialPlacement:true,initialPlaces:populationInitialPlaces(s.population)};
      const intentions=()=>buildingEmergency?residentBuildingEmergencyIntents(buildingEmergency,routineIntents):routineIntents;
      const disasterHold=!!buildingEmergency?.duties.length&&!frame;
      const move=()=>{navigation=advanceVillageLifeNavigation(navigation,{...shared,intents:intentions(),site,dynamicObstacles:[...(frame?.obstacles??[]),...populationWorkplaceOperationObstacles(workstations,workFrame,navigation,site)],workplacePermits:(workFrame?.assignments??[]).flatMap(assignment=>{const intent=intentions().find(intent=>intent.residentId===assignment.residentId),cap=site?.workplaceRoutes?.find(cap=>cap.id===assignment.routeId&&cap.residentId===assignment.residentId);return intent?.reason==='routine'&&intent.targetPlaceId===assignment.placeId&&cap?[{residentId:assignment.residentId,id:cap.id,certificateSha256:cap.certificateSha256}]:[];}),locomotionPermits:buildingEmergency?residentBuildingEmergencyLocomotionPermits(buildingEmergency,site,s.population.residents,navigation):[],refugePermits:buildingEmergency?residentBuildingEmergencyRefugePermits(buildingEmergency,site):[],...(allocationHold||disasterHold?{sourceAllocationHold:true as const}:{})});};
      move();
      if(frame||buildingEmergency){
        buildingEmergency=advanceResidentBuildingEmergency(buildingEmergency??createResidentBuildingEmergency(s.worldKey,minute),{
          absoluteMinute:minute,worldKey:s.worldKey,residents:s.population.residents,routineIntents,navigation,site:allocationHold?null:site,frame,recoveryWork:populationRecoveryWorkPermits({population:s.population,absoluteMinute:minute},workFrame,timberSupply,frame)});
        move();
      }
      if(navigationOther)navigationOther=advanceVillageLifeNavigation(navigationOther,{...shared,intents:intentions(),site:allocationHold?site:null,...(allocationHold||disasterHold?{sourceAllocationHold:true as const}:{})});
    };
    const actions=()=>{
      const frame=observation?.workplaceFrame??input.workplaceFrame??null,baseContext={worldKey:s.worldKey,absoluteMinute:life.absoluteMinute,population:s.population,life,navigation,navigationOther,site:allocationHold?null:site,buildingEmergency,recoveryFrame:frameAt(life.absoluteMinute)},context={...baseContext,life:populationWorkplaceLife(baseContext,allocationHold?null:frame,timberSupply)};
      const prepared=preparePopulationWorkplaces({workstations,timberSupply},{...context,queues:routineActions,frame:allocationHold?null:frame,millisecondsPerWorldMinute:c.millisecondsPerWorldMinute});
      workstations=prepared.workstations;timberSupply=prepared.timberSupply;
      routineActions=advanceResidentRoutineActions(routineActions,{...context,physical:prepared.physical??observation?.routineActionPhysical??input.routineActionPhysical,wakes:observation?.routineActionWakes??input.routineActionWakes});
      if(!allocationHold&&frame?.timberCatalogue)timberSupply=consumeCompletedTimberWork(timberSupply,{queues:routineActions,catalogue:frame.timberCatalogue,absoluteMinute:life.absoluteMinute}).state;
    };
    // Life decisions, physical routes and ordinary jobs consume the same
    // minutely boundaries even when no mesh is rendered. A large away jump
    // therefore keeps the same job IDs/interruptions as continuous observation.
    navigate(from);actions();
    for(let minute=Math.floor(from)+1;minute<=targetLifeMinute;minute++){
      navigate(minute);life=advanceVillageLife(life,s.population,minute,{conditionsAt,safetySignalsAt});navigate(minute);actions();
    }
    navigate(to);actions();
    if(!advancedMilliseconds&&at===c.lastObservedAt&&life===s.life&&navigation===s.navigation&&navigationOther===s.navigationOther&&buildingEmergency===s.buildingEmergency&&routineActions===s.routineActions&&workstations===s.workstations&&timberSupply===s.timberSupply)return{ok:true,snapshot:s,advancedMilliseconds:0,deferredMilliseconds:c.pendingMilliseconds};
    const safetySignals=Object.freeze(s.safetySignals.filter(signal=>signal.expiresAbsoluteMinute>targetLifeMinute));
    const next:VillagePopulationRuntime=Object.freeze({...s,generation:integer(s.generation+1),clock:nextClock,life,routineActions,workstations,timberSupply,navigation,navigationOther,safetySignals,...(buildingEmergency?{buildingEmergency}:{})});validated.add(next);
    const workFrame=observation?.workplaceFrame??input.workplaceFrame;if(workFrame&&!allocationHold)workplaceFrames.set(next,workFrame);
    emergencyTargetBindings.set(next,capability?.emergencyTargets??emergencyTargetBindings.get(s)??Object.freeze([]));
    const neededWorkplaces=new Set([navigation,navigationOther].flatMap(nav=>nav?.residents.flatMap(row=>row.workplaceRoute?[row.workplaceRoute.id]:[])??[]));
    const workplaceCatalog=site?.workplaceRoutes??workplaceRouteBindings.get(s)??[];
    workplaceRouteBindings.set(next,Object.freeze(workplaceCatalog.filter(cap=>neededWorkplaces.has(cap.id)||routineActions.residents.some(job=>job.residentId===cap.residentId&&job.goal.targetPlaceId===cap.placeId&&job.current!==null))));
    const usedTraversalIds=new Set([navigation,navigationOther].flatMap(nav=>nav?.residents.flatMap(row=>row.emergencyTraversal?[row.emergencyTraversal.id]:row.neutralReturn?[row.neutralReturn.id]:[])??[]));
    emergencyTraversalBindings.set(next,Object.freeze((capability?.emergencyTraversals??emergencyTraversalBindings.get(s)??[]).filter(route=>usedTraversalIds.has(route.id))));
    const priorRefuges=emergencyRefugeBindings.get(s)??[],availableRefuges=[...priorRefuges,...(capability?.emergencyRefuges??[]).filter(r=>!priorRefuges.some(old=>old.id===r.id))],usedRefuges=new Set([navigation,navigationOther].flatMap(nav=>nav?.residents.flatMap(row=>row.emergencyRefuge?.ids??(row.workplaceRoute?.recoveryRefuge?[row.workplaceRoute.recoveryRefuge.id]:[]))??[]));
    for(const cap of workplaceRouteBindings.get(next)??[])if(cap.recoveryApproach)usedRefuges.add(cap.recoveryApproach.refugeId);
    for(const duty of buildingEmergency?.duties??[])if(duty.kind==='evacuate'){const target=availableRefuges.find(r=>r.residentId===duty.residentId&&r.placeId===duty.targetPlaceId);if(target)usedRefuges.add(target.id);}
    emergencyRefugeBindings.set(next,Object.freeze(availableRefuges.filter(refuge=>usedRefuges.has(refuge.id))));
    const emergencyFrame=frameAt(to);if(emergencyFrame)emergencyFrames.set(next,emergencyFrame);
    return{ok:true,snapshot:next,advancedMilliseconds,deferredMilliseconds:next.clock.pendingMilliseconds};
  }catch(error){return fail(error instanceof Error?error.message:'Population advance refused.');}
}
/** A read-only observer owns a bounded, per-visit projection. It never writes
 * the population store. Earlier history is unavailable, so that mode exposes
 * analytic schedules without life journals, physical arrival or work evidence. */
export interface VillagePopulationObservationStatus {
  readonly mode:'forward-projection'|'analytic-history-unavailable';
  readonly requestedMilliseconds:number;readonly completedMilliseconds:number;
  readonly pendingMilliseconds:number;readonly millisecondsPerWorldMinute:number;
}
export interface VillagePopulationObservationOptions {
  readonly preferCanonical?:boolean;
  readonly site?:VillageSiteLayout|null;
  readonly environmentAt?:(absoluteMinute:number)=>WorldEnvironmentOverride|undefined;
  readonly signalsAt?:(absoluteMinute:number)=>readonly ResidentSafetySignal[];
  readonly buildingEmergencyAt?:(absoluteMinute:number)=>ResidentBuildingEmergencyFrame|null;
  readonly emergencyCheckpoint?:VillagePopulationEmergencyCheckpoint;
  readonly acknowledgedEmergencyReceiptIds?:readonly string[];
  readonly routineActionPhysical?:ResidentRoutineActionPhysicalPort;
  readonly workplaceFrame?:ResidentWorkplaceFrame|null;
  readonly routineActionWakes?:readonly ResidentActionWake[];
}
/** A disaster-only branch checkpoint. It retains its actual physical cursors
 * alongside duties; the canonical population store remains read-only. */
export interface VillagePopulationEmergencyCheckpoint {
 readonly kind:'village-population-emergency-checkpoint';readonly schemaVersion:1;
 readonly worldKey:string;readonly contentRevision:string;readonly canonicalGeneration:number;
 readonly canonicalElapsedMilliseconds:number;readonly clock:VillagePopulationClock;
 readonly life:VillageLifeState;readonly routineActions?:ResidentActionQueues;readonly workstations?:ResidentWorkstations|null;readonly timberSupply?:VillageTimberSupply;readonly navigation:VillageLifeNavigationState;
 readonly navigationOther:VillageLifeNavigationState|null;readonly buildingEmergency:ResidentBuildingEmergencyState;
 readonly canonicalEvidence:VillagePopulationEmergencyCanonicalEvidence;readonly emergencyTargets:readonly VillageSiteEmergencyTarget[];readonly emergencyTraversals:readonly VillageSiteEmergencyTraversal[];readonly emergencyRefuges:readonly VillageSiteEmergencyRefuge[];readonly workplaceRoutes?:readonly VillageSiteWorkplaceRoute[];
}
/** Complete stable facts, rather than a lossy fingerprint of the baseline.
 * Naturally advancing clocks/journeys are omitted; explicit changes are not. */
export interface VillagePopulationEmergencyCanonicalEvidence {
 readonly kind:'village-emergency-canonical-evidence';readonly worldKey:string;readonly contentRevision:string;
 readonly clockConfig:{readonly createdAt:number;readonly initialDayMinute:number;readonly millisecondsPerWorldMinute:number};
 readonly walkingSpeedMetresPerSecond:number;readonly population:VillagePopulation;
 readonly rosterFacts:readonly VillagePopulationResidentFacts[];readonly safetySignals:readonly ResidentSafetySignal[];
 readonly safetySignalIds:readonly string[];readonly sourceAllocationKey:string;readonly sourceBindings:readonly string[];
}
export type VillagePopulationEmergencyCheckpointRestore =
 {readonly status:'valid';readonly state:VillagePopulationEmergencyCheckpoint}
 |{readonly status:'invalid';readonly raw:unknown;readonly error:string};
const trustedEmergencyCheckpoints=new WeakSet<object>();
function assertEmergencyCheckpointBudget(value:unknown):void{const json=JSON.stringify(value);if(json.length>VILLAGE_POPULATION_RUNTIME_MAX_BYTES||new TextEncoder().encode(json).byteLength>VILLAGE_POPULATION_RUNTIME_MAX_BYTES)throw Error('Emergency checkpoint exceeds its data budget.');}
const checkpointKeys=['kind','schemaVersion','worldKey','contentRevision','canonicalGeneration','canonicalElapsedMilliseconds','clock','life','navigation','navigationOther','buildingEmergency','canonicalEvidence'] as const;
const evidenceKeys=['kind','worldKey','contentRevision','clockConfig','walkingSpeedMetresPerSecond','population','rosterFacts','safetySignals','safetySignalIds','sourceAllocationKey','sourceBindings'] as const;
function sourceBindingKeys(snapshot:VillagePopulationRuntime):readonly string[]{
 return Object.freeze([snapshot.navigation,snapshot.navigationOther].filter((nav):nav is VillageLifeNavigationState=>!!nav?.profile).map(nav=>JSON.stringify({profile:nav.profile,sourceSha256:nav.sourceSha256,siteIdentity:nav.siteIdentity,navigationRevision:nav.navigationRevision??null,navigationAllocation:nav.navigationAllocation??null})).sort());
}
function canonicalEmergencyEvidence(snapshot:VillagePopulationRuntime):VillagePopulationEmergencyCanonicalEvidence{
 return Object.freeze({kind:'village-emergency-canonical-evidence',worldKey:snapshot.worldKey,contentRevision:snapshot.contentRevision,
  clockConfig:Object.freeze({createdAt:snapshot.clock.createdAt,initialDayMinute:snapshot.clock.initialDayMinute,millisecondsPerWorldMinute:snapshot.clock.millisecondsPerWorldMinute}),
  walkingSpeedMetresPerSecond:snapshot.walkingSpeedMetresPerSecond,population:snapshot.population,rosterFacts:snapshot.rosterFacts,safetySignals:snapshot.safetySignals,safetySignalIds:snapshot.safetySignalIds,
  sourceAllocationKey:JSON.stringify(allocationPolicy(snapshot)),sourceBindings:sourceBindingKeys(snapshot)});
}
function parseCanonicalEmergencyEvidence(value:unknown,elapsed:number):VillagePopulationEmergencyCanonicalEvidence{
 const e=placeDataRecord(value,evidenceKeys),config=placeDataRecord(e.clockConfig,['createdAt','initialDayMinute','millisecondsPerWorldMinute']);
 const c=clock({...config,lastObservedAt:integer(config.createdAt)+elapsed,simulatedElapsedMilliseconds:elapsed,pendingMilliseconds:0});
 const p=population(e.population),worldKey=key(e.worldKey),contentRevision=placeId(e.contentRevision),minute=Math.floor(absoluteMinute(c));
 if(e.kind!=='village-emergency-canonical-evidence'||typeof e.walkingSpeedMetresPerSecond!=='number'||!Number.isFinite(e.walkingSpeedMetresPerSecond)||e.walkingSpeedMetresPerSecond<.1||e.walkingSpeedMetresPerSecond>4
  ||typeof e.sourceAllocationKey!=='string'||e.sourceAllocationKey.length>1024)throw Error('Invalid canonical disaster evidence.');
 const feed=safetyFeed(e.safetySignals,p,minute),history=safetyHistory(e.safetySignalIds,feed),sources=placeDataArray(e.sourceBindings);
 if(sources.length>2||sources.some(value=>typeof value!=='string'||!value||value.length>4096)||new Set(sources).size!==sources.length)throw Error('Invalid canonical source evidence.');
 return Object.freeze({kind:'village-emergency-canonical-evidence',worldKey,contentRevision,clockConfig:Object.freeze({createdAt:c.createdAt,initialDayMinute:c.initialDayMinute,millisecondsPerWorldMinute:c.millisecondsPerWorldMinute}),walkingSpeedMetresPerSecond:e.walkingSpeedMetresPerSecond,
  population:p,rosterFacts:facts(e.rosterFacts,p),safetySignals:feed,safetySignalIds:history,sourceAllocationKey:e.sourceAllocationKey,sourceBindings:Object.freeze([...sources]as string[])});
}
function assertCanonicalEmergencyEvidence(canonical:VillagePopulationRuntime,checkpoint:VillagePopulationEmergencyCheckpoint):void{
 const old=checkpoint.canonicalEvidence,current=canonicalEmergencyEvidence(canonical);
 for(const name of ['worldKey','contentRevision','clockConfig','walkingSpeedMetresPerSecond','population','rosterFacts','safetySignalIds','sourceAllocationKey','sourceBindings']as const)
  if(!equalData(old[name],current[name]))throw Error('Emergency checkpoint canonical explicit facts or source allocation changed: '+name);
 if(canonical.generation<checkpoint.canonicalGeneration||canonical.clock.simulatedElapsedMilliseconds<checkpoint.canonicalElapsedMilliseconds)throw Error('Emergency checkpoint canonical baseline cannot rewind.');
 const minute=Math.floor(absoluteMinute(canonical.clock));
 for(const signal of current.safetySignals)if(!old.safetySignals.some(known=>equalData(signal,known)))throw Error('Emergency checkpoint explicit safety facts changed.');
 for(const signal of old.safetySignals)if(signal.expiresAbsoluteMinute>minute&&!current.safetySignals.some(known=>equalData(signal,known)))throw Error('Emergency checkpoint lost a live safety fact.');
}
/** Validate the entire owned disaster branch before the observer may consider
 * restoring it. Canonical branch/allocation compatibility is checked separately
 * at restoration; this parser never creates a physical arrival or new world. */
export function parseVillagePopulationEmergencyCheckpoint(value:unknown,expectedWorldKey?:string):VillagePopulationEmergencyCheckpoint {
 if(value&&typeof value==='object'&&trustedEmergencyCheckpoints.has(value)){const saved=value as VillagePopulationEmergencyCheckpoint;if(expectedWorldKey!==undefined&&saved.worldKey!==expectedWorldKey)throw Error('Emergency checkpoint world changed.');return saved;}
 if(typeof value==='string'){if(value.length>VILLAGE_POPULATION_RUNTIME_MAX_BYTES||new TextEncoder().encode(value).byteLength>VILLAGE_POPULATION_RUNTIME_MAX_BYTES)throw Error('Emergency checkpoint exceeds its data budget.');value=JSON.parse(value);}
 const owned=ownData(value);assertEmergencyCheckpointBudget(owned);
 const r=placeDataRecord(owned,checkpointKeys,['emergencyTargets','emergencyTraversals','emergencyRefuges','routineActions','workstations','timberSupply','workplaceRoutes']);
 const worldKey=key(r.worldKey),contentRevision=placeId(r.contentRevision),generation=integer(r.canonicalGeneration),elapsed=integer(r.canonicalElapsedMilliseconds),c=clock(r.clock);
 if(r.kind!=='village-population-emergency-checkpoint'||r.schemaVersion!==1||expectedWorldKey!==undefined&&worldKey!==expectedWorldKey||elapsed>c.simulatedElapsedMilliseconds)throw Error('Invalid emergency checkpoint world, schema or baseline clock.');
 const evidence=parseCanonicalEmergencyEvidence(r.canonicalEvidence,elapsed),p=evidence.population,minute=Math.floor(absoluteMinute(c));
 if(evidence.worldKey!==worldKey||evidence.contentRevision!==contentRevision||evidence.clockConfig.createdAt!==c.createdAt||evidence.clockConfig.initialDayMinute!==c.initialDayMinute||evidence.clockConfig.millisecondsPerWorldMinute!==c.millisecondsPerWorldMinute)throw Error('Emergency checkpoint evidence changed its world or epoch.');
 const life=parseVillageLife(r.life,p,{worldKey,absoluteMinute:minute}),navigation=ownedNavigation(r.navigation,p,c),navigationOther=r.navigationOther===null?null:ownedNavigation(r.navigationOther,p,c);
 if(navigationOther&&(!navigation.profile||!navigationOther.profile||navigation.profile===navigationOther.profile))throw Error('Emergency checkpoint physical cursors need distinct source profiles.');
 const emergency=parseResidentBuildingEmergency(r.buildingEmergency),targets=parseVillageSiteEmergencyTargets(r.emergencyTargets??[]),traversals=parseVillageSiteEmergencyTraversals(r.emergencyTraversals??[]),refuges=parseVillageSiteEmergencyRefuges(r.emergencyRefuges??[]),known=new Set(p.residents.map(person=>person.id));
 if(emergency.worldKey!==worldKey||Math.abs(emergency.absoluteMinute-absoluteMinute(c))>1e-7||emergency.duties.some(duty=>!known.has(duty.residentId))||[...emergency.waterDeliveries,...emergency.repairProgress].some(receipt=>!known.has(receipt.residentId)))throw Error('Emergency checkpoint work belongs to another roster, world or clock.');
 for(const nav of [navigation,navigationOther])if(nav)for(const row of nav.residents){
  if(row.emergencyTraversal){const ref=row.emergencyTraversal,cap=traversals.find(t=>t.id===ref.id&&t.certificateSha256===ref.certificateSha256&&t.requiredClip===ref.requiredClip&&t.residentId===row.residentId&&t.sourceSha256===nav.sourceSha256&&t.profile===nav.profile),person=p.residents.find(person=>person.id===row.residentId)!;
   if(!cap||!emergency.duties.some(d=>d.residentId===row.residentId&&(d.kind==='water'||d.kind==='return'))&&!isUnusedVillageLifeEmergencyCarry(row,cap,person.homePlaceId))throw Error('Emergency checkpoint lacks its exact carry route and return obligation.');
  }
  if(row.neutralReturn){const ref=row.neutralReturn;
   if(!traversals.some(t=>t.id===ref.id&&t.certificateSha256===ref.certificateSha256&&t.residentId===row.residentId&&t.sourceSha256===nav.sourceSha256&&t.profile===nav.profile&&t.neutralReturn))throw Error('Emergency checkpoint lacks its exact neutral return source.');
  }
 }
 for(const nav of [navigation,navigationOther])if(nav)for(const row of nav.residents)if(row.emergencyRefuge){
  for(const id of row.emergencyRefuge.ids)if(!refuges.some(t=>t.id===id&&t.certificateSha256===row.emergencyRefuge!.certificates?.[id]&&t.residentId===row.residentId&&t.proof.sourceSha256===nav.sourceSha256&&t.proof.profile===nav.profile))throw Error('Emergency checkpoint lacks its exact refuge source capability.');
 }
 const places=new Set(p.registry.places.map(place=>place.id));
 for(const t of targets)if(!known.has(t.residentId)||places.has(t.placeId)||![navigation,navigationOther].some(nav=>nav?.profile===t.proof.profile&&nav.sourceSha256===t.proof.sourceSha256))throw Error('Emergency checkpoint target changed its roster or bound source.');
 for(const r of refuges)if(!known.has(r.residentId)||places.has(r.placeId)||![navigation,navigationOther].some(nav=>nav?.profile===r.proof.profile&&nav.sourceSha256===r.proof.sourceSha256))throw Error('Emergency refuge changed its roster or bound source.');
 for(const d of emergency.duties)if(!places.has(d.targetPlaceId)){
  if(d.kind==='evacuate'){const refuge=refuges.find(r=>r.residentId===d.residentId&&r.placeId===d.targetPlaceId);if(!refuge||refuge.proof.sourceSha256!==d.binding.sourceSha256||refuge.proof.profile!==d.binding.profile)throw Error('Emergency checkpoint lacks the exact source refuge target.');}
  else{const t=targets.find(t=>t.residentId===d.residentId&&t.placeId===d.targetPlaceId&&t.id===d.stationId);
   if(!t||t.proof.sourceSha256!==d.binding.sourceSha256||t.proof.profile!==d.binding.profile||t.kind!=='water'&&t.buildingKey!==buildingDamageKey(d.binding))throw Error('Emergency checkpoint lacks the exact source action target.');}
 }
 const routineActions=r.routineActions===undefined?createResidentRoutineActions({worldKey,absoluteMinute:minute,population:p,life,navigation,navigationOther,site:null,buildingEmergency:emergency})
  :parseResidentActionQueues(r.routineActions,{worldKey,residentIds:p.residents.map(person=>person.id),maximumMinute:minute});
 if(routineActions.absoluteMinute!==minute||routineActions.source&&![navigation,navigationOther].some(nav=>nav?.profile===routineActions.source!.profile&&nav.sourceSha256===routineActions.source!.sha256&&nav.siteIdentity===routineActions.source!.siteIdentity))throw Error('Emergency checkpoint ordinary actions changed their saved clock or source.');
 const workstations=r.workstations===undefined||r.workstations===null?null:parseResidentWorkstations(r.workstations),timberSupply=r.timberSupply===undefined?createVillageTimberSupply(worldKey,minute):parseVillageTimberSupply(r.timberSupply,worldKey);
 if(timberSupply.absoluteMinute!==minute||workstations&&(workstations.worldKey!==worldKey||workstations.absoluteMinute!==minute||workstations.entries.some(row=>!known.has(row.lease.residentId))||![navigation,navigationOther].some(nav=>nav?.profile===workstations.source.profile&&nav.sourceSha256===workstations.source.sha256&&nav.siteIdentity===workstations.source.siteIdentity)))throw Error('Emergency workplace or timber state changed its source, roster or clock.');
 const workplaceRoutes=parseVillageSiteWorkplaceRoutes(r.workplaceRoutes??[]);
 for(const cap of workplaceRoutes)if(cap.recoveryApproach){const recovery=cap.recoveryApproach,refuge=refuges.find(refuge=>refuge.id===recovery.refugeId&&refuge.certificateSha256===recovery.certificateSha256&&refuge.residentId===cap.residentId&&refuge.proof.sourceSha256===cap.proof.sourceSha256&&refuge.proof.profile===cap.proof.profile);
  if(!refuge||recovery.route.from!==refuge.anchorId||!recovery.route.sourceGroundPolyline[0].every((n,i)=>n===refuge.proof.sourceGroundPoint[i]))throw Error('Emergency checkpoint lacks its exact recovery refuge dependency.');
 }

 for(const nav of[navigation,navigationOther])if(nav)for(const journey of nav.residents)if(journey.workplaceRoute&&!workplaceRoutes.some(cap=>cap.id===journey.workplaceRoute!.id&&cap.certificateSha256===journey.workplaceRoute!.certificateSha256&&cap.residentId===journey.residentId&&cap.proof.sourceSha256===nav.sourceSha256&&cap.proof.profile===nav.profile))throw Error('Emergency checkpoint lacks its source workplace access.');
 safetyBudget([],life);
 const saved=Object.freeze({kind:'village-population-emergency-checkpoint' as const,schemaVersion:1 as const,worldKey,contentRevision,canonicalGeneration:generation,canonicalElapsedMilliseconds:elapsed,clock:c,life,routineActions,workstations,timberSupply,navigation,navigationOther,buildingEmergency:emergency,canonicalEvidence:evidence,emergencyTargets:targets,emergencyTraversals:traversals,emergencyRefuges:refuges,workplaceRoutes});assertEmergencyCheckpointBudget(saved);trustedEmergencyCheckpoints.add(saved);return saved;
}
/** Invalid/future data stays available for repair and cannot silently become an
 * empty population. Raw JSON transport deliberately has no current-schema cap. */
export function restoreVillagePopulationEmergencyCheckpoint(value:unknown,expectedWorldKey?:string):VillagePopulationEmergencyCheckpointRestore {
 try{return{status:'valid',state:parseVillagePopulationEmergencyCheckpoint(value,expectedWorldKey)};}
 catch(error){return{status:'invalid',raw:value,error:error instanceof Error?error.message:String(error)};}
}
export function serializeVillagePopulationEmergencyCheckpointRestore(value:VillagePopulationEmergencyCheckpointRestore):unknown {
 return value.status==='valid'?parseVillagePopulationEmergencyCheckpoint(value.state):copyObserverJSON(value.raw);
}
type EmergencyCheckpointBase={generation:number;elapsed:number;evidence:VillagePopulationEmergencyCanonicalEvidence};
const emergencyCheckpointBases=new WeakMap<object,EmergencyCheckpointBase>();
export function captureVillagePopulationEmergencyCheckpoint(snapshot:VillagePopulationRuntime):VillagePopulationEmergencyCheckpoint|null{
 const s=ownRuntime(snapshot),status=observations.get(s),base=emergencyCheckpointBases.get(s);
 if(!s.buildingEmergency||status?.mode!=='forward-projection'||!base)return null;
 const saved=Object.freeze({kind:'village-population-emergency-checkpoint' as const,schemaVersion:1 as const,worldKey:s.worldKey,contentRevision:s.contentRevision,
  canonicalGeneration:base.generation,canonicalElapsedMilliseconds:base.elapsed,clock:s.clock,life:s.life,routineActions:s.routineActions,workstations:s.workstations,timberSupply:s.timberSupply,navigation:s.navigation,navigationOther:s.navigationOther,buildingEmergency:s.buildingEmergency,canonicalEvidence:base.evidence,emergencyTargets:emergencyTargetBindings.get(s)??Object.freeze([]),emergencyTraversals:emergencyTraversalBindings.get(s)??Object.freeze([]),emergencyRefuges:emergencyRefugeBindings.get(s)??Object.freeze([]),workplaceRoutes:workplaceRouteBindings.get(s)??Object.freeze([])});assertEmergencyCheckpointBudget(saved);trustedEmergencyCheckpoints.add(saved);return saved;
}
/** Commit only an allocation debit from an already-earned supply. The public
 * rebuilding transaction owns eligibility and orders; this boundary cannot
 * add stock, consume new raw input or alter work history. */
export function recordVillagePopulationTimberAllocation(snapshot:VillagePopulationRuntime,value:VillageTimberSupply):VillagePopulationRuntime{
 const s=ownRuntime(snapshot),nextSupply=parseVillageTimberSupply(value,s.worldKey),old=s.timberSupply;
 if(nextSupply===old)return s;
 const delta=nextSupply.allocatedTimber-old.allocatedTimber;
 if(nextSupply.absoluteMinute!==old.absoluteMinute||nextSupply.createdAtMinute!==old.createdAtMinute||delta<=0
  ||nextSupply.producedTimber!==old.producedTimber||nextSupply.availableTimber!==old.availableTimber-delta
  ||JSON.stringify(nextSupply.sources)!==JSON.stringify(old.sources)||JSON.stringify(nextSupply.workWatermarks)!==JSON.stringify(old.workWatermarks)
  ||nextSupply.allocations.length<=old.allocations.length||old.allocations.some((allocation,i)=>JSON.stringify(allocation)!==JSON.stringify(nextSupply.allocations[i])))throw Error('Repair allocation cannot invent materials or replace their physical history.');
 const next=Object.freeze({...s,generation:integer(s.generation+1),timberSupply:nextSupply});
 if(new TextEncoder().encode(JSON.stringify(next)).byteLength>VILLAGE_POPULATION_RUNTIME_MAX_BYTES)throw Error('Allocated materials exceed the population save budget.');
 validated.add(next);
 const observed=observations.get(s);if(observed)observations.set(next,observed);
 const base=emergencyCheckpointBases.get(s);if(base)emergencyCheckpointBases.set(next,base);
 const allocation=observationAllocationPolicies.get(s);if(allocation)observationAllocationPolicies.set(next,allocation);
 const disaster=emergencyFrames.get(s);if(disaster)emergencyFrames.set(next,disaster);
 const work=workplaceFrames.get(s);if(work)workplaceFrames.set(next,work);
 emergencyTargetBindings.set(next,emergencyTargetBindings.get(s)??Object.freeze([]));
 emergencyTraversalBindings.set(next,emergencyTraversalBindings.get(s)??Object.freeze([]));
 emergencyRefugeBindings.set(next,emergencyRefugeBindings.get(s)??Object.freeze([]));workplaceRouteBindings.set(next,workplaceRouteBindings.get(s)??Object.freeze([]));
 return next;
}
function restoreEmergencyCheckpoint(canonical:VillagePopulationRuntime,value:VillagePopulationEmergencyCheckpoint,requested:number,site?:VillageSiteLayout|null):VillagePopulationRuntime{
 const r=parseVillagePopulationEmergencyCheckpoint(value,canonical.worldKey);
 if(r.worldKey!==canonical.worldKey||r.contentRevision!==canonical.contentRevision)throw Error('Emergency checkpoint belongs to a different canonical branch.');
 assertCanonicalEmergencyEvidence(canonical,r);
 if(r.emergencyTargets.length){
  if(!site)throw Error('Emergency checkpoint awaits its source-qualified action target catalogue.');
  const actual=siteCache(site,canonical.population).emergencyTargets;
  if(r.emergencyTargets.some(t=>!actual.some(current=>sameVillageSiteEmergencyTarget(t,current))))throw Error('Emergency checkpoint action target source proof changed.');
 }
 if(r.emergencyTraversals.length){if(!site)throw Error('Emergency checkpoint awaits its exact carry route source.');const actual=siteCache(site,canonical.population).emergencyTraversals;
  if(r.emergencyTraversals.some(t=>!actual.some(current=>sameVillageSiteEmergencyTraversal(t,current))))throw Error('Emergency checkpoint carry route source proof changed.');
  for(const nav of [r.navigation,r.navigationOther])if(nav)for(const journey of nav.residents)if((journey.emergencyTraversal||journey.neutralReturn)&&!matchesVillageLifeSourceJourney(journey,site))throw Error('Emergency checkpoint changed its actual carry journey geometry.');}
 if(r.emergencyRefuges.length){if(!site)throw Error('Emergency checkpoint awaits its exact refuge source.');const actual=siteCache(site,canonical.population).emergencyRefuges;
  if(r.emergencyRefuges.some(saved=>!actual.some(current=>sameVillageSiteEmergencyRefuge(saved,current))))throw Error('Emergency checkpoint refuge source proof changed.');
  for(const nav of [r.navigation,r.navigationOther])if(nav)for(const journey of nav.residents)if(journey.emergencyRefuge&&!matchesVillageLifeSourceJourney(journey,site))throw Error('Emergency checkpoint changed its actual refuge journey geometry.');}
 if(r.workplaceRoutes?.length){if(!site)throw Error('Emergency checkpoint awaits its qualified ordinary workplace source.');const actual=validateVillageSiteWorkplaceRoutes(site);if(r.workplaceRoutes.some(saved=>!actual.some(current=>sameVillageSiteWorkplaceRoute(saved,current))))throw Error('Saved ordinary workplace source proof changed.');}
 const restored=Object.freeze({...canonical,clock:r.clock,life:r.life,routineActions:r.routineActions!,workstations:r.workstations??null,timberSupply:r.timberSupply!,navigation:r.navigation,navigationOther:r.navigationOther,buildingEmergency:r.buildingEmergency});validated.add(restored);emergencyTargetBindings.set(restored,r.emergencyTargets);emergencyTraversalBindings.set(restored,r.emergencyTraversals);emergencyRefugeBindings.set(restored,r.emergencyRefuges);workplaceRouteBindings.set(restored,r.workplaceRoutes??Object.freeze([]));
 if(restored.clock.createdAt!==canonical.clock.createdAt||restored.clock.millisecondsPerWorldMinute!==canonical.clock.millisecondsPerWorldMinute||restored.clock.initialDayMinute!==canonical.clock.initialDayMinute
  ||restored.clock.simulatedElapsedMilliseconds>requested)throw Error('Emergency checkpoint cannot rewind its durable branch or change the population clock.');
 const policy=allocationPolicy(canonical),restoredPolicy=allocationPolicy(restored);
 if(policy.kind!=='unbound'&&(policy.kind!==restoredPolicy.kind||policy.kind==='paired'&&restoredPolicy.kind==='paired'&&!sameVillageSiteNavigationAllocation(policy.pair,restoredPolicy.pair)))throw Error('Emergency checkpoint changed the saved navigation allocation.');
 for(const nav of [canonical.navigation,canonical.navigationOther])if(nav?.profile){const saved=[restored.navigation,restored.navigationOther].find(s=>s?.profile===nav.profile);
  if(!saved||saved.sourceSha256!==nav.sourceSha256||saved.siteIdentity!==nav.siteIdentity)throw Error('Emergency checkpoint changed a bound source.');}
 return restored;
}
export interface VillagePopulationEmergencyAdvanceOptions {
 readonly site:VillageSiteLayout|null;readonly frame:ResidentBuildingEmergencyFrame|null;
 readonly initialObserved?:VillagePopulationRuntime;
 readonly acknowledgedReceiptIds?:readonly string[];
 readonly environmentAt?:(absoluteMinute:number)=>WorldEnvironmentOverride|undefined;
 readonly signalsAt?:(absoluteMinute:number)=>readonly ResidentSafetySignal[];
 readonly routineActionPhysical?:ResidentRoutineActionPhysicalPort;
  readonly workplaceFrame?:ResidentWorkplaceFrame|null;
 readonly routineActionWakes?:readonly ResidentActionWake[];
}
/** One staged physical minute. The caller supplies fire@M, consumes the returned
 * contact receipts, then commits fire@M+1 and this checkpoint atomically. There
 * is no cursor retained between calls and no canonical population write. */
export function advanceVillagePopulationEmergencyCheckpoint(canonicalValue:VillagePopulationRuntime,checkpoint:VillagePopulationEmergencyCheckpoint|null,targetMilliseconds:number,options:VillagePopulationEmergencyAdvanceOptions):{
 readonly snapshot:VillagePopulationRuntime;readonly checkpoint:VillagePopulationEmergencyCheckpoint;readonly sample:VillagePopulationSample;
}{
 const canonical=ownRuntime(canonicalValue),target=integer(targetMilliseconds);
 let base:EmergencyCheckpointBase,start:VillagePopulationRuntime;
 if(checkpoint){
  const parsed=parseVillagePopulationEmergencyCheckpoint(checkpoint,canonical.worldKey);start=restoreEmergencyCheckpoint(canonical,parsed,target,options.site);
  base={generation:parsed.canonicalGeneration,elapsed:parsed.canonicalElapsedMilliseconds,evidence:parsed.canonicalEvidence};
 }else if(options.initialObserved){
  const observed=ownRuntime(options.initialObserved),observedBase=emergencyCheckpointBases.get(observed),status=observations.get(observed);
  if(!observedBase||status?.mode!=='forward-projection'||observed.worldKey!==canonical.worldKey||observed.contentRevision!==canonical.contentRevision)throw Error('Emergency adoption needs an actual matching observed physical snapshot.');
  const adopted=Object.freeze({...observed,buildingEmergency:observed.buildingEmergency??createResidentBuildingEmergency(canonical.worldKey,absoluteMinute(observed.clock))});validated.add(adopted);
  const candidate:VillagePopulationEmergencyCheckpoint={kind:'village-population-emergency-checkpoint',schemaVersion:1,worldKey:adopted.worldKey,contentRevision:adopted.contentRevision,canonicalGeneration:observedBase.generation,canonicalElapsedMilliseconds:observedBase.elapsed,
   clock:adopted.clock,life:adopted.life,routineActions:adopted.routineActions,workstations:adopted.workstations,timberSupply:adopted.timberSupply,navigation:adopted.navigation,navigationOther:adopted.navigationOther,buildingEmergency:adopted.buildingEmergency!,canonicalEvidence:observedBase.evidence,emergencyTargets:emergencyTargetBindings.get(observed)??Object.freeze([]),emergencyTraversals:emergencyTraversalBindings.get(observed)??Object.freeze([]),emergencyRefuges:emergencyRefugeBindings.get(observed)??Object.freeze([]),workplaceRoutes:workplaceRouteBindings.get(observed)??Object.freeze([])};
  start=restoreEmergencyCheckpoint(canonical,candidate,target,options.site);base=observedBase;
 }else{
  start=Object.freeze({...canonical,buildingEmergency:canonical.buildingEmergency??createResidentBuildingEmergency(canonical.worldKey,absoluteMinute(canonical.clock))});validated.add(start);
  base={generation:canonical.generation,elapsed:canonical.clock.simulatedElapsedMilliseconds,evidence:canonicalEmergencyEvidence(canonical)};
 }
 const from=start.clock.simulatedElapsedMilliseconds;
 if(target<from||target-from>start.clock.millisecondsPerWorldMinute)throw Error('Emergency coordination advances at most one monotonic world minute per step.');
 const emergency=options.acknowledgedReceiptIds?.length?acknowledgeResidentBuildingEmergency(start.buildingEmergency!,options.acknowledgedReceiptIds):start.buildingEmergency!;
 // Pending observation horizon is not physical progress. Stage this exact
 // minute so an old larger render request cannot spend future contact time.
 const staged=Object.freeze({...start,clock:clock({...start.clock,lastObservedAt:integer(start.clock.createdAt+from),pendingMilliseconds:0}),buildingEmergency:emergency});validated.add(staged);emergencyTargetBindings.set(staged,emergencyTargetBindings.get(start)??Object.freeze([]));emergencyTraversalBindings.set(staged,emergencyTraversalBindings.get(start)??Object.freeze([]));emergencyRefugeBindings.set(staged,emergencyRefugeBindings.get(start)??Object.freeze([]));workplaceRouteBindings.set(staged,workplaceRouteBindings.get(start)??Object.freeze([]));
 const result=advancePopulation(staged,{expectedGeneration:staged.generation,worldKey:staged.worldKey,contentRevision:staged.contentRevision,observedAt:integer(staged.clock.createdAt+target),maxAdvanceMinutes:1,site:options.site},
  {site:options.site,environmentAt:options.environmentAt,signalsAt:options.signalsAt,buildingEmergencyAt:()=>options.frame,routineActionPhysical:options.routineActionPhysical,routineActionWakes:options.routineActionWakes,workplaceFrame:options.workplaceFrame});
 if(!result.ok)throw Error(result.error);
 const snapshot=result.snapshot;observations.set(snapshot,{mode:'forward-projection',requestedMilliseconds:target,completedMilliseconds:snapshot.clock.simulatedElapsedMilliseconds,pendingMilliseconds:0,millisecondsPerWorldMinute:snapshot.clock.millisecondsPerWorldMinute});
 observationAllocationPolicies.set(snapshot,allocationPolicy(canonical));emergencyCheckpointBases.set(snapshot,base);
 const saved=captureVillagePopulationEmergencyCheckpoint(snapshot);if(!saved)throw Error('Emergency step did not retain its physical checkpoint.');
 return Object.freeze({snapshot,checkpoint:saved,sample:sampleVillagePopulationRuntime(snapshot,options.site)});
}
export function createVillagePopulationObserver(){
  let cursor:VillagePopulationRuntime|null=null,identity:VillagePopulation|null=null,analytic=false,forecast=false,checkpointBase:EmergencyCheckpointBase|null=null;
  return {
    observe(snapshot:VillagePopulationRuntime,requestedMilliseconds:number,options:VillagePopulationObservationOptions={}):VillagePopulationRuntime{
      const canonical=ownRuntime(snapshot);let requested=integer(requestedMilliseconds);
      const canonicalAllocation=allocationPolicy(canonical);
      integer(canonical.clock.createdAt+requested);
      if(!cursor||cursor.worldKey!==canonical.worldKey||identity!==canonical.population){
        identity=canonical.population;analytic=!options.emergencyCheckpoint&&requested<canonical.clock.simulatedElapsedMilliseconds-50;forecast=false;
        const ms=analytic?requested:canonical.clock.simulatedElapsedMilliseconds;
        const c=clock({...canonical.clock,lastObservedAt:canonical.clock.createdAt+ms,simulatedElapsedMilliseconds:ms,pendingMilliseconds:0});
        const life=analytic?createVillageLife(canonical.population,Math.floor(absoluteMinute(c)),canonical.worldKey):canonical.life;
        cursor=Object.freeze({...canonical,clock:c,life,navigation:analytic?initialNavigation(life,c,canonical.walkingSpeedMetresPerSecond):canonical.navigation,
          navigationOther:analytic?null:canonical.navigationOther,...(analytic?{buildingEmergency:undefined,workstations:null,timberSupply:createVillageTimberSupply(canonical.worldKey,life.absoluteMinute),routineActions:createResidentRoutineActions({worldKey:canonical.worldKey,absoluteMinute:life.absoluteMinute,population:canonical.population,life,navigation:initialNavigation(life,c,canonical.walkingSpeedMetresPerSecond),site:null})}:{}),safetySignals:analytic?Object.freeze([]):canonical.safetySignals,safetySignalIds:analytic?Object.freeze([]):canonical.safetySignalIds});
        validated.add(cursor);
        checkpointBase={generation:canonical.generation,elapsed:canonical.clock.simulatedElapsedMilliseconds,evidence:canonicalEmergencyEvidence(canonical)};
        if(!analytic&&options.emergencyCheckpoint){const saved=parseVillagePopulationEmergencyCheckpoint(options.emergencyCheckpoint,canonical.worldKey);cursor=restoreEmergencyCheckpoint(canonical,saved,requested,options.site);checkpointBase={generation:saved.canonicalGeneration,elapsed:saved.canonicalElapsedMilliseconds,evidence:saved.canonicalEvidence};forecast=true;}
      }
      if(cursor.buildingEmergency&&options.acknowledgedEmergencyReceiptIds?.length){
        cursor=Object.freeze({...cursor,buildingEmergency:acknowledgeResidentBuildingEmergency(cursor.buildingEmergency,options.acknowledgedEmergencyReceiptIds)});validated.add(cursor);
      }
      // Millisecond rounding between Date/performance origins must not convert
      // a legitimate pause into a historical seek.
      if(requested<cursor.clock.simulatedElapsedMilliseconds&&cursor.clock.simulatedElapsedMilliseconds-requested<=50)requested=cursor.clock.simulatedElapsedMilliseconds;
      // Explicit external rewinding never reuses later-life events as history.
      const wasAnalytic=analytic;
      if(requested<cursor.clock.simulatedElapsedMilliseconds)analytic=true;
      // History is unavailable only before the settled canonical boundary. On
      // reaching it, discard the analytic reconstruction and continue from the
      // real saved facts, using the same 50 ms origin tolerance as initial
      // observation. Check the original request so cursor rounding cannot add
      // another tolerance interval. Pending catch-up is not a complete boundary.
      const rejoining=analytic&&canonical.clock.pendingMilliseconds===0
        &&requestedMilliseconds>=canonical.clock.simulatedElapsedMilliseconds-50;
      if(rejoining){
        requested=Math.max(requestedMilliseconds,canonical.clock.simulatedElapsedMilliseconds);
        cursor=Object.freeze({...canonical});validated.add(cursor);
        checkpointBase={generation:canonical.generation,elapsed:canonical.clock.simulatedElapsedMilliseconds,evidence:canonicalEmergencyEvidence(canonical)};
        analytic=false;forecast=true;
      }
      observationAllocationPolicies.set(cursor,canonicalAllocation);
      const minute=Math.floor(absoluteMinute(cursor.clock));
      const commanded=!!options.workplaceFrame||!!options.environmentAt?.(minute)||(options.signalsAt?.(minute)?.length??0)>0||!!options.buildingEmergencyAt?.(minute)||!!cursor.buildingEmergency;
      forecast=forecast||commanded||Math.abs(requested-canonical.clock.simulatedElapsedMilliseconds)>50;
      // Ordinary 1x/zero-offset observation follows newly committed facts and
      // alarms. A pause/fast/commanded forecast is a separate read-only branch;
      // later canonical facts cannot be retroactively inserted into its past.
      if(options.preferCanonical&&!analytic&&!forecast&&canonical.clock.pendingMilliseconds===0){
        cursor=Object.freeze({...canonical});validated.add(cursor);
        checkpointBase={generation:canonical.generation,elapsed:canonical.clock.simulatedElapsedMilliseconds,evidence:canonicalEmergencyEvidence(canonical)};emergencyCheckpointBases.set(cursor,checkpointBase);
        observationAllocationPolicies.set(cursor,canonicalAllocation);
        observations.set(cursor,Object.freeze({mode:'forward-projection',requestedMilliseconds:requested,completedMilliseconds:cursor.clock.simulatedElapsedMilliseconds,
          pendingMilliseconds:0,millisecondsPerWorldMinute:cursor.clock.millisecondsPerWorldMinute}));return cursor;
      }
      if(analytic){
        if(requested!==cursor.clock.simulatedElapsedMilliseconds){
          const c=clock({...cursor.clock,lastObservedAt:cursor.clock.createdAt+requested,simulatedElapsedMilliseconds:requested,pendingMilliseconds:0});
          const life=wasAnalytic&&Math.floor(absoluteMinute(c))===cursor.life.absoluteMinute?cursor.life:createVillageLife(cursor.population,Math.floor(absoluteMinute(c)),cursor.worldKey);
          cursor=Object.freeze({...cursor,clock:c,life,navigation:initialNavigation(life,c,cursor.walkingSpeedMetresPerSecond),navigationOther:null,buildingEmergency:undefined,workstations:null,timberSupply:createVillageTimberSupply(cursor.worldKey,life.absoluteMinute),routineActions:createResidentRoutineActions({worldKey:cursor.worldKey,absoluteMinute:life.absoluteMinute,population:cursor.population,life,navigation:initialNavigation(life,c,cursor.walkingSpeedMetresPerSecond),site:null}),safetySignals:Object.freeze([]),safetySignalIds:Object.freeze([])});
          validated.add(cursor);
        }
      }else if(!rejoining||requested>cursor.clock.simulatedElapsedMilliseconds){
        // Two world minutes per 250 ms owner poll permits 16x playback while
        // still yielding during a large saved offset. Read/render is O(1).
        const result=advancePopulation(cursor,{expectedGeneration:cursor.generation,worldKey:cursor.worldKey,contentRevision:cursor.contentRevision,
          observedAt:cursor.clock.createdAt+requested,maxAdvanceMinutes:2,site:options.site},options);
        if(result.ok===false)throw Error(result.error);cursor=result.snapshot;
      }
      const frame=options.buildingEmergencyAt?.(Math.floor(absoluteMinute(cursor.clock)));if(frame)emergencyFrames.set(cursor,frame);
      if(checkpointBase)emergencyCheckpointBases.set(cursor,checkpointBase);
      observations.set(cursor,Object.freeze({mode:analytic?'analytic-history-unavailable':'forward-projection',requestedMilliseconds:requested,
        completedMilliseconds:cursor.clock.simulatedElapsedMilliseconds,pendingMilliseconds:Math.max(0,requested-cursor.clock.simulatedElapsedMilliseconds),millisecondsPerWorldMinute:cursor.clock.millisecondsPerWorldMinute}));
      observationAllocationPolicies.set(cursor,canonicalAllocation);
      return cursor;
    },
    clear(){cursor=null;identity=null;analytic=false;forecast=false;checkpointBase=null;},
  };
}
export function getVillagePopulationObservationStatus(snapshot:VillagePopulationRuntime):VillagePopulationObservationStatus|undefined{return observations.get(snapshot);}
/** Compatibility helper for one bounded observation; live views retain the
 * factory above so pause/fast time never rebuilds a whole history per frame. */
export function observeVillagePopulationAt(snapshot:VillagePopulationRuntime,ms:number):VillagePopulationRuntime{
  return createVillagePopulationObserver().observe(snapshot,ms);
}
export function getVillagePopulationTime(snapshot:VillagePopulationRuntime):VillagePopulationTime{
  const s=ownRuntime(snapshot),c=s.clock,absoluteWorldMinute=c.initialDayMinute+Math.floor(c.simulatedElapsedMilliseconds/c.millisecondsPerWorldMinute);
  return Object.freeze({absoluteWorldMinute,dayIndex:Math.floor(absoluteWorldMinute/1440),dayMinute:absoluteWorldMinute%1440,
    fractionalMinute:(c.simulatedElapsedMilliseconds%c.millisecondsPerWorldMinute)/c.millisecondsPerWorldMinute,elapsedWorldMinutes:c.simulatedElapsedMilliseconds/c.millisecondsPerWorldMinute,deferredMilliseconds:c.pendingMilliseconds});
}
type Path=VillageSitePath&{readonly cumulative:Float64Array};
interface SiteCache{readonly paths:Map<string,Path|null>;readonly durableHomeBindings:boolean;readonly missingHomeBindings:number;readonly emergencyTargets:readonly VillageSiteEmergencyTarget[];readonly emergencyTraversals:readonly VillageSiteEmergencyTraversal[];readonly emergencyRefuges:readonly VillageSiteEmergencyRefuge[]}
const sites=new WeakMap<VillageSiteLayout,WeakMap<VillagePopulation,SiteCache>>();
function siteCache(site:VillageSiteLayout,p:VillagePopulation):SiteCache{
  let byPopulation=sites.get(site);if(!byPopulation){byPopulation=new WeakMap();sites.set(site,byPopulation);}const existing=byPopulation.get(p);if(existing)return existing;
  if(!Object.isFrozen(site)||site.frame!=='source-root-local-metres'||!['desktop','quest'].includes(site.profile)||!/^[a-f0-9]{64}$/.test(site.sourceSha256))throw Error('Population projection needs a frozen validated source-frame village site.');
  const places=new Set(p.registry.places.map(v=>v.id)),people=new Set(p.residents.map(r=>r.id));
  const emergencyRefuges=validateVillageSiteEmergencyRefuges(site);
  for(const r of emergencyRefuges)if(!people.has(r.residentId)||places.has(r.placeId))throw Error('Refuge cannot replace registered people or places.');
  const emergencyTraversals=validateVillageSiteEmergencyTraversals(site);
  for(const t of emergencyTraversals)if(!people.has(t.residentId))throw Error('Carry route belongs to an unknown resident.');
  const patrolPlaces=new Set<string>(),emergencyTargets=validateVillageSiteEmergencyTargets(site),emergencyPlaces=new Set<string>();
  for(const t of emergencyTargets){if(!people.has(t.residentId)||places.has(t.placeId))throw Error('A source action target cannot replace registered household or public data.');emergencyPlaces.add(`${t.residentId}\0${t.placeId}`);}
  for(const plan of site.patrols??[]){
    const resident=p.residents.find(r=>r.id===plan.residentId);
    if(!site.navigationRevision||!resident||!resident.registry.routine.some(slot=>slot.activity===plan.activity&&slot.placeId===plan.routineTargetPlaceId))
      throw Error('Source patrol plan does not match an authored resident responsibility.');
    for(const node of plan.waypoints){if(places.has(node.placeId))throw Error('A local patrol turn cannot relabel a registered household or public place.');patrolPlaces.add(`${plan.residentId}\0${node.placeId}`);}
  }
  for(const b of site.placeBindings)if(!places.has(b.placeId))throw Error('Site binding references an unknown population place.');
  for(const b of site.residentPlaceBindings)if(!people.has(b.residentId)||!places.has(b.placeId)&&!patrolPlaces.has(`${b.residentId}\0${b.placeId}`)&&!emergencyPlaces.has(`${b.residentId}\0${b.placeId}`))throw Error('Site resident/place binding references unknown roster data.');
  const missingHomeBindings=p.residents.reduce((count,resident)=>count+(resolveVillageSiteEndpoint(site,resident.homePlaceId,resident.id)?0:1),0);
  const result={paths:new Map<string,Path|null>(),emergencyTargets,emergencyTraversals,emergencyRefuges,durableHomeBindings:missingHomeBindings===0,missingHomeBindings};byPopulation.set(p,result);return result;
}
function measuredPath(site:VillageSiteLayout,cache:SiteCache,who:string,from:string,to:string):Path|null{
  const id=`${who}\0${from}\0${to}`;if(cache.paths.has(id))return cache.paths.get(id)!;
  const value=resolveVillageSitePath(site,from,to,who);if(!value){cache.paths.set(id,null);return null;}
  const cumulative=new Float64Array(value.sourceGroundPolyline.length);for(let i=1;i<cumulative.length;i++){const a=value.sourceGroundPolyline[i-1],b=value.sourceGroundPolyline[i];cumulative[i]=cumulative[i-1]+Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);}
  const result={...value,cumulative};cache.paths.set(id,result);return result;
}
function samplePath(path:Path,distance:number):{position:readonly[number,number,number];yawRadians:number}{
  const points=path.sourceGroundPolyline;if(points.length===1)return{position:points[0],yawRadians:0};let i=1;
  while(i<points.length-1&&(path.cumulative[i]<distance||path.cumulative[i]-path.cumulative[i-1]<1e-10))i++;
  const a=points[i-1],b=points[i],span=path.cumulative[i]-path.cumulative[i-1],f=span>1e-10?Math.max(0,Math.min(1,(distance-path.cumulative[i-1])/span)):0;
  return{position:Object.freeze([a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f]),yawRadians:Math.atan2(b[0]-a[0],b[2]-a[2])};
}
/** Sample saved physical journeys and effective simulated goals. Visibility,
 * pause and clip support never decide life. Before a source has ever been
 * attached, the legacy schedule projection remains an explicitly labelled
 * presentation fallback; it never creates journey or completed-duty evidence. */
export function sampleVillagePopulationRuntime(snapshot:VillagePopulationRuntime,site:VillageSiteLayout|null):VillagePopulationSample{
  const s=ownRuntime(snapshot),time=getVillagePopulationTime(s),cache=site?siteCache(site,s.population):null,claims=new Map<string,string[]>(),observation=observations.get(s);
  const allocationHold=allocationPolicy(s).kind==='mixed'||!!site&&!compatibleAllocation(s,site);
  const analytic=observation?.mode==='analytic-history-unavailable';
  const physicalLife=populationWorkplaceLife({worldKey:s.worldKey,absoluteMinute:s.life.absoluteMinute,population:s.population,life:s.life,navigation:s.navigation,navigationOther:s.navigationOther,site,buildingEmergency:s.buildingEmergency,recoveryFrame:emergencyFrames.get(s)??null},workplaceFrames.get(s)??null,s.timberSupply);
  const lifeByResident=new Map(physicalLife.residents.map(resident=>[resident.residentId,resident] as const));
  const actionsByResident=new Map(s.routineActions.residents.map(job=>[job.residentId,job] as const));
  const savedNavigation=!analytic&&site&&cache?.durableHomeBindings?(s.navigation.profile===site.profile?s.navigation:s.navigationOther?.profile===site.profile?s.navigationOther:null)
    :!analytic&&!site&&s.navigation.profile?s.navigation:null;
  // A complete-home source mismatch holds physical journeys. Incomplete legacy
  // packages use the explicitly labelled presentation fallback without changing
  // those saved journeys or manufacturing arrival/work evidence.
  const physical=savedNavigation?new Map(sampleVillageLifeNavigation(savedNavigation,site).map(row=>[row.residentId,row] as const)):null;
  const residents=s.population.residents.map(resident=>{
    const routine=resident.registry.routine,index=routine.findIndex(slot=>time.dayMinute>=slot.startMinute&&time.dayMinute<slot.endMinute),slot=routine[index];
    if(!slot)throw Error('Every population resident requires a complete daily routine.');
    let previous=(index+routine.length-1)%routine.length,start=time.dayIndex*1440+slot.startMinute,end=time.dayIndex*1440+slot.endMinute,visited=1;
    while(visited<routine.length&&routine[previous].placeId===slot.placeId){start-=routine[previous].endMinute-routine[previous].startMinute;previous=(previous+routine.length-1)%routine.length;visited++;}
    let following=(index+1)%routine.length,forward=1;while(forward<routine.length&&routine[following].placeId===slot.placeId){end+=routine[following].endMinute-routine[following].startMinute;following=(following+1)%routine.length;forward++;}
    const from=visited===routine.length?slot.placeId:routine[previous].placeId;
    const residentLife=lifeByResident.get(resident.id)!;
    const emergencyDuty=!analytic?s.buildingEmergency?.duties.find(d=>d.residentId===resident.id):undefined;
    const effectiveIntent=emergencyDuty?residentBuildingEmergencyIntents(s.buildingEmergency!,[residentLife.intent])[0]:residentLife.intent;
    const base:VillagePopulationResidentState={residentId:resident.id,tier:resident.fidelityTier,activity:slot.activity,roleClip:null,availableRoleClips:resident.appearance.motion.roleClips,
      scheduledPlaceId:slot.placeId,placeId:null,fromPlaceId:from,slotIndex:index,slotStartMinute:slot.startMinute,slotEndMinute:slot.endMinute,status:'unmapped',reason:'site-unavailable',position:null,yawRadians:0,moving:false,presentable:false,...(!analytic?{routineAction:summarizeResidentRoutineAction(actionsByResident.get(resident.id)!)}:{})};
    if(allocationHold)return{...base,activity:residentLife.intent.activity,scheduledPlaceId:residentLife.intent.targetPlaceId,
      reason:'navigation-unavailable' as const,lifeIntent:residentLife.intent,lifeStatus:residentLife.status,simulatedPlaceId:residentLife.simulatedPlaceId,
      navigationStatus:'unmapped',navigationReason:'source-site-changed',workPoseQualified:false};
    if(physical){
      const row=physical.get(resident.id),journey=savedNavigation!.residents.find(value=>value.residentId===resident.id),intent=effectiveIntent;
      if(!row)throw Error('Physical navigation must retain every resident identity.');
      const trafficStopped=!!site&&!!journey&&ownsQualifiedVillageLifeTrafficHold(savedNavigation!,site,resident.id);
      const refugeMotion=journey?.emergencyRefuge&&site&&scopedVillageEmergencyRefugeSite(site,journey.emergencyRefuge,resident.id)?Object.freeze({refugeIds:journey.emergencyRefuge.ids,...(trafficStopped?{trafficStopped:true as const}:{}),certificates:Object.freeze(Object.fromEntries(journey.emergencyRefuge.ids.map(id=>[id,cache!.emergencyRefuges.find(r=>r.id===id)!.certificateSha256]))),neutralClips:requiredVillageRefugeMotionClips(resident.id),zeroCrossfade:true as const}):undefined;
      const neutralReturnMotion=site&&journey?.neutralReturn&&qualifiedVillageNeutralReturnMotion(journey,site)&&ownsExclusiveVillageLifeExteriorAnchor(savedNavigation!,site,resident.id)?Object.freeze({...journey.neutralReturn,neutralClips:requiredVillageRefugeMotionClips(resident.id),zeroCrossfade:true as const}):undefined;
      const workScope=journey?.workplaceRoute&&site?scopedVillageWorkplaceRouteSite(site,journey.workplaceRoute,resident.id):null;
      const workplaceMotion=workScope&&journey?.workplaceRoute?Object.freeze({routeId:journey.workplaceRoute.id,certificateSha256:journey.workplaceRoute.certificateSha256,returnPlaceId:journey.workplaceRoute.returnPlaceId,...(journey.workplaceRoute.recoveryRefuge?{recoveryRefuge:journey.workplaceRoute.recoveryRefuge}:{}),neutralClips:requiredVillageWorkplaceMotionClips(resident.id),zeroCrossfade:true as const,...(ownsQualifiedVillageWorkplaceTrafficHold(savedNavigation!,site!,resident.id)?{trafficStopped:true as const}:{})}):undefined;
      const workFrame=workplaceFrames.get(s),job=actionsByResident.get(resident.id),entry=s.workstations?.entries.find(entry=>entry.lease.residentId===resident.id&&entry.lease.jobId===job?.jobId),workstation=entry&&workFrame?.catalog.find(station=>station.station.id===entry.lease.stationId&&station.station.residentId===resident.id),workProof=entry&&workFrame?.presentation?.find(proof=>proof.stationId===entry.lease.stationId&&proof.certificateSha256===entry.stationCertificateSha256);
      const working=!emergencyDuty&&!!job&&!job.interruption&&!!entry&&!!workstation&&!!workProof&&!!site&&!row.moving&&row.status==='at-threshold'&&row.reason===null&&row.arrivalEvidence==='certified-route-arrival'&&row.placeId===workstation.station.placeId&&intent.targetPlaceId===workstation.station.placeId&&entry.lease.untilMinute>=time.absoluteWorldMinute&&['reserve','face','perform','release'].includes(job.current??'')&&ownsExclusiveVillageWorkplaceOperation(savedNavigation!,site,resident.id,{radius:workProof.body.radius+workProof.body.margin,height:workProof.body.height+workProof.body.lift+workProof.body.margin});
      const workPhase=job?.current==='release'?'release' as const:job?.current==='perform'?'perform' as const:'face' as const;
      const workStart=workPhase==='perform'?entry?.performStartedAtMinute??entry?.facing?.atMinute??time.absoluteWorldMinute:entry?.phase===job?.current?entry?.phaseStartedAtMinute??entry?.lease.sinceMinute??time.absoluteWorldMinute:workPhase==='release'?job?.proof.lastContactMinute??time.absoluteWorldMinute:entry?.lease.sinceMinute??time.absoluteWorldMinute;
      const ordinaryWork=working?Object.freeze({qualified:true as const,stationId:workstation!.station.id,leaseId:entry!.lease.id,certificateSha256:entry!.stationCertificateSha256,source:workstation!.station.source,phase:workPhase,clip:workstation!.station.clip,yawRadians:workstation!.yawRadians,elapsedSeconds:Math.max(0,(time.absoluteWorldMinute+time.fractionalMinute-workStart)*s.clock.millisecondsPerWorldMinute/1000),body:workProof!.body,clipMeasurement:workProof!.clipMeasurement,...(workProof!.clipMeasurements?{clipMeasurements:workProof!.clipMeasurements}:{}),files:workProof!.files}):undefined;
      const authored=!!emergencyDuty||resident.registry.routine.some(value=>value.activity===intent.activity);
      const indoors=row.status==='indoors',waiting=row.status==='waiting';
      const resourceUnavailable=!emergencyDuty&&!row.moving&&residentLife.status!=='active';
      const waitingForResource=residentLife.status==='queued'&&intent.reason==='routine'&&intent.activityKey==='work'&&!intent.indoor&&authored
        &&ownsExclusiveVillageLifeExteriorAnchor(savedNavigation!,site,resident.id);
      const waitingForRoute=waiting&&!row.moving&&!!row.position&&!!journey
        &&journey.targetPlaceId===intent.targetPlaceId&&journey.activityKey===intent.activityKey&&journey.priority===intent.priority
        &&journey.indoor===intent.indoor&&journey.issuedAbsoluteMinute===intent.issuedAbsoluteMinute
        &&row.placeId===journey.anchorPlaceId&&row.position.every((v,i)=>v===journey.anchorPosition?.[i])
        &&ownsExclusiveVillageLifeRouteWaitAnchor(savedNavigation!,site,resident.id);
      const reachedPath=resident.group==='guards-military'&&journey?.originPlaceId&&journey.destinationPlaceId&&site
        ?resolveVillageSitePath(site,journey.originPlaceId,journey.destinationPlaceId,resident.id):null;
      const pausingAtDestination=resident.group==='guards-military'&&authored&&residentLife.status==='active'
        &&intent.reason==='routine'&&intent.activityKey==='patrol'&&!intent.indoor
        &&row.status==='at-threshold'&&!row.moving&&row.reason===null&&!!row.position&&!!journey
        &&!journey.route&&!journey.patrol&&!journey.patrolEntry
        &&journey.targetPlaceId===intent.targetPlaceId&&journey.activityKey===intent.activityKey&&journey.priority===intent.priority
        &&journey.indoor===intent.indoor&&journey.issuedAbsoluteMinute===intent.issuedAbsoluteMinute
        &&row.placeId===intent.targetPlaceId&&row.placeId===journey.anchorPlaceId
        &&row.position.every((v,i)=>v===journey.anchorPosition?.[i])
        &&(journey.direction===1?journey.destinationPlaceId:journey.originPlaceId)===row.placeId
        &&!!reachedPath&&reachedPath.lengthMetres>1e-7
        &&reachedPath.sourceGroundPolyline[journey.direction===1?reachedPath.sourceGroundPolyline.length-1:0].every((v,i)=>v===row.position?.[i])
        &&row.arrivalEvidence==='certified-route-arrival'&&row.arrivedAtAbsoluteMinute!==null
        &&row.arrivedAtAbsoluteMinute>=intent.issuedAbsoluteMinute
        &&row.arrivedAtAbsoluteMinute<=time.absoluteWorldMinute+time.fractionalMinute
        &&ownsExclusiveVillageLifeExteriorAnchor(savedNavigation!,site,resident.id);
      const patrolPlan=journey?.patrol&&row.position&&site?.patrols?.find(plan=>plan.id===journey.patrol!.planId&&plan.residentId===resident.id
        &&plan.activity===intent.activity&&plan.routineTargetPlaceId===intent.targetPlaceId&&intent.activityKey==='patrol'&&intent.reason==='routine'&&!intent.indoor);
      const patrol=patrolPlan&&journey?.patrol?Object.freeze({planId:patrolPlan.id,phase:row.moving?'travelling' as const:waiting?'waiting' as const:'dwelling' as const,
        completedLegs:journey.patrol.completedLegs,waypointPlaceId:patrolPlan.waypoints[journey.patrol.waypointIndex].placeId}):undefined;
      const patrolDwell=patrol?.phase==='dwelling'&&journey?.arrivedAtAbsoluteMinute!==null&&journey?.arrivedAtAbsoluteMinute!==undefined
        &&row.position?.every((v,i)=>v===journey.anchorPosition?.[i])&&ownsExclusiveVillageLifePatrolDwellAnchor(savedNavigation!,site,intent)
        ?Object.freeze({elapsedSeconds:(time.absoluteWorldMinute+time.fractionalMinute-journey.arrivedAtAbsoluteMinute)*s.clock.millisecondsPerWorldMinute/1000,
          durationSeconds:patrolPlan!.dwellWorldMinutes*s.clock.millisecondsPerWorldMinute/1000}):undefined;
      const frame=emergencyFrames.get(s),incident=emergencyDuty&&frame?.incidents.find(i=>i.id===emergencyDuty.incidentId),station=emergencyDuty&&frame?.stations.find(st=>st.id===emergencyDuty.stationId&&st.residentId===resident.id);
      const stationQualified=!!site&&!!station&&!!incident&&!!frame&&qualifiedResidentBuildingStation(station,site,incident,frame,time.absoluteWorldMinute+time.fractionalMinute);
      const traversal=journey?.emergencyTraversal&&site?findVillageEmergencyTraversal(site,journey.emergencyTraversal,resident.id):null;
      const collisionSite=journey&&site?villageLifeJourneyCollisionSite(journey,site):null;
      const carryHold=!!emergencyDuty&&!!traversal&&!!collisionSite&&!!row.position&&!row.moving&&!journey?.inside
        &&!!frame&&frame.obstacles.every(o=>o.sourceSha256!==site!.sourceSha256||o.profile!==site!.profile||o.activeFromAbsoluteMinute>time.absoluteWorldMinute+time.fractionalMinute||!villageLifeObstacleContainsPoint(row.position!,collisionSite,o));
      const actionQualified=stationQualified&&!row.moving&&row.status==='at-threshold'&&row.reason===null&&row.placeId===emergencyDuty?.targetPlaceId
        &&emergencyDuty.actionStartedAbsoluteMinute!==null&&row.arrivalEvidence==='certified-route-arrival'&&ownsExclusiveVillageLifeExteriorAnchor(savedNavigation!,site,resident.id);
      const visualTravel=row.moving&&row.reason===null&&journey?.route&&site&&savedNavigation!.siteIdentity?Object.freeze({journey,profile:site.profile,sourceSha256:site.sourceSha256,siteIdentity:savedNavigation!.siteIdentity,
        ...(savedNavigation!.navigationRevision?{navigationRevision:savedNavigation!.navigationRevision}:{}),...(savedNavigation!.navigationAllocation?{navigationAllocation:savedNavigation!.navigationAllocation}:{}),
        metresPerSecond:s.walkingSpeedMetresPerSecond,maximumAdvanceSeconds:(1-time.fractionalMinute)*s.clock.millisecondsPerWorldMinute/1000}):undefined;
      const emergency=emergencyDuty?Object.freeze({incidentId:emergencyDuty.incidentId,phase:emergencyDuty.phase,stationId:emergencyDuty.stationId,
        clip:traversal||emergencyDuty.phase==='to-fire'?'carry_bucket_walk' as const:actionQualified?station!.clip:null,
        ...(traversal?{requiredLocomotionClip:'carry_bucket_walk' as const,traversalId:traversal.id}:{}),
        contactPoint:actionQualified?station!.contactPoint:null,contactSourceActor:actionQualified?station!.proof.contactSourceActor:null,
        yawRadians:actionQualified?station!.yawRadians:null,actionStartedAbsoluteMinute:emergencyDuty.actionStartedAbsoluteMinute,actionElapsedSeconds:emergencyDuty.actionStartedAbsoluteMinute===null?null:Math.max(0,time.absoluteWorldMinute+time.fractionalMinute-(emergencyDuty.actionArrivalAbsoluteMinute??emergencyDuty.actionStartedAbsoluteMinute))*s.clock.millisecondsPerWorldMinute/1000,waterUnits:emergencyDuty.waterUnits,
        qualified:row.moving&&row.reason===null||carryHold||!!refugeMotion&&(waitingForRoute||trafficStopped)||actionQualified||emergencyDuty.phase==='sheltered'&&row.status==='at-threshold'&&row.reason===null&&row.placeId===emergencyDuty.targetPlaceId&&row.arrivalEvidence==='certified-route-arrival'&&ownsExclusiveVillageLifeExteriorAnchor(savedNavigation!,site,resident.id)}):undefined;
      const status:VillagePopulationResidentState['status']=row.status==='travelling'?'travelling':row.status==='at-threshold'?'at-place':waiting?'blocked':'unmapped';
      const presentable=row.position!==null&&!indoors&&(!waiting||waitingForRoute)&&(!resourceUnavailable||waitingForResource||waitingForRoute||!!ordinaryWork||!!neutralReturnMotion)&&(row.moving||authored||waitingForRoute||!!ordinaryWork||!!workplaceMotion||!!neutralReturnMotion);
      const reason:VillagePopulationLocationReason|null=resourceUnavailable?'life-resource-unavailable':indoors?'activity-indoors':!row.moving&&!authored&&row.position?'life-activity-unqualified':row.reason||!row.position?'navigation-unavailable':null;
      return {...base,activity:intent.activity,scheduledPlaceId:intent.targetPlaceId,
        placeId:row.placeId,fromPlaceId:journey?.originPlaceId??from,status,reason,position:row.position,yawRadians:ordinaryWork?ordinaryWork.yawRadians:actionQualified?station!.yawRadians:row.yawRadians,
        moving:row.moving,presentable:presentable&&(!emergency||emergency.qualified),...(visualTravel?{visualTravel}:{}),...(refugeMotion?{refugeMotion}:{}),...(workplaceMotion?{workplaceMotion}:{}),...(neutralReturnMotion?{neutralReturnMotion}:{}),...(ordinaryWork?{ordinaryWork}:{}),...(emergency?{emergency}:{}),lifeIntent:intent,lifeStatus:residentLife.status,simulatedPlaceId:residentLife.simulatedPlaceId,
        ...(waitingForResource?{waitingForResource:true as const}:{}),
        ...(waitingForRoute?{waitingForRoute:true as const}:{}),
        ...(pausingAtDestination?{pausingAtDestination:true as const}:{}),
        ...(patrol?{patrol}:{}),
        ...(patrolDwell?{patrolDwell}:{}),
        navigationStatus:row.status,navigationReason:row.reason,arrivalEvidence:row.arrivalEvidence,arrivedAtAbsoluteMinute:row.arrivedAtAbsoluteMinute,
        workPoseQualified:!!ordinaryWork};
    }
    if(!site||!cache)return base;
    const target=resolveVillageSiteEndpoint(site,slot.placeId,resident.id);if(!target)return{...base,reason:'place-unmapped' as const};
    const path=measuredPath(site,cache,resident.id,from,slot.placeId);if(!path)return{...base,reason:'route-unmapped' as const};
    const duration=path.lengthMetres/s.walkingSpeedMetresPerSecond*1000;
    if(visited!==routine.length&&duration>(end-start)*s.clock.millisecondsPerWorldMinute)return{...base,status:'blocked' as const,reason:'route-exceeds-slot' as const};
    const elapsed=(time.absoluteWorldMinute+time.fractionalMinute-start)*s.clock.millisecondsPerWorldMinute;
    if(visited!==routine.length&&elapsed<duration){const pose=samplePath(path,Math.max(0,elapsed)*s.walkingSpeedMetresPerSecond/1000);return{...base,...pose,status:'travelling' as const,reason:null,moving:true,presentable:true};}
    const ids=claims.get(target.id)??[];ids.push(resident.id);claims.set(target.id,ids);const pose=samplePath(path,path.lengthMetres);
    return{...base,...pose,placeId:slot.placeId,status:'at-place' as const,reason:null,presentable:true};
  });
  const conflicted=new Set([...claims.values()].filter(ids=>ids.length>1).flat());
  // Different anchor IDs do not make overlapping stationary proxy volumes
  // safe. Flag their projection; do not invent displacement or queue events.
  const projectedBodies=site?new Map(residents.map(row=>{const journey=savedNavigation?.residents.find(journey=>journey.residentId===row.residentId),body=row.ordinaryWork?{radius:row.ordinaryWork.body.radius+row.ordinaryWork.body.margin,height:row.ordinaryWork.body.height+row.ordinaryWork.body.lift+row.ordinaryWork.body.margin}:journey&&savedNavigation?villageLifeNavigationPeerBody(journey,site,savedNavigation.siteIdentity):site.capsule;return[row.residentId,body]as const;})):null;
  if(site)for(let i=0;i<residents.length;i++)for(let j=i+1;j<residents.length;j++){
    const a=residents[i],b=residents[j];if(a.status!=='at-place'||b.status!=='at-place'||!a.position||!b.position)continue;
    const ab=projectedBodies!.get(a.residentId)!,bb=projectedBodies!.get(b.residentId)!;
    if(a.position[1]<b.position[1]+bb.height&&b.position[1]<a.position[1]+ab.height&&Math.hypot(a.position[0]-b.position[0],a.position[2]-b.position[2])<ab.radius+bb.radius-1e-8){conflicted.add(a.residentId);conflicted.add(b.residentId);}
  }
  const final=residents.map(row=>Object.freeze(conflicted.has(row.residentId)?{...row,status:'blocked' as const,reason:'anchor-conflict' as const,position:null,presentable:false}:row));
  return Object.freeze({generation:s.generation,time,visualAdvanceSeconds:(1-time.fractionalMinute)*s.clock.millisecondsPerWorldMinute/1000,residents:Object.freeze(final),navigationAuthority:physical||allocationHold?'resident-life':'schedule-projection',observation,...(s.buildingEmergency?{buildingEmergency:s.buildingEmergency}:{}),navigationCapability:site?cache!.durableHomeBindings?'complete-home-bindings':'legacy-incomplete-homes':'site-unavailable',missingHomeBindings:cache?.missingHomeBindings??100,life:analytic?undefined:s.life,counts:Object.freeze({total:100,households:25,major:20,scheduled:80,
    mapped:final.filter(r=>r.position!==null).length,unmapped:final.filter(r=>r.status==='unmapped').length,moving:final.filter(r=>r.moving).length,blocked:final.filter(r=>r.status==='blocked').length})});
}
const serializedPopulation=new WeakMap<VillagePopulation,string>(),serializedFacts=new WeakMap<readonly VillagePopulationResidentFacts[],string>();
/** The authored roster is a constant of the content revision. A save may name
 * it instead of copying it (about 830 KB of the old 837 KB save); parsing the
 * same reference rebuilds the identical roster. Saves without a reference, or
 * whose roster differs from the reference, keep the roster inline. */
export interface VillagePopulationReference {readonly id:string;readonly population:VillagePopulation}
export interface VillagePopulationSaveOptions {readonly populationReference?:VillagePopulationReference}
function populationJson(p:VillagePopulation):string{let json=serializedPopulation.get(p);if(json===undefined){json=JSON.stringify(p);serializedPopulation.set(p,json);}return json;}
function referenceId(reference:VillagePopulationReference):string{const id=placeId(reference.id);if(id.length>128)throw Error('Population reference IDs must be short.');return id;}
export function serializeVillagePopulationRuntime(snapshot:VillagePopulationRuntime,options:VillagePopulationSaveOptions={}):{readonly ok:true;readonly json:string}|{readonly ok:false;readonly error:string}{
  try{
    const s=ownRuntime(snapshot);if(observations.has(s))throw Error('Read-only observer projections cannot replace population saves.');
    let population=populationJson(s.population);
    const reference=options.populationReference;
    if(reference&&populationJson(reference.population)===population)population=JSON.stringify({reference:referenceId(reference)});
    let facts=serializedFacts.get(s.rosterFacts);if(facts===undefined){facts=JSON.stringify(s.rosterFacts);serializedFacts.set(s.rosterFacts,facts);}
    // Most bytes are immutable authored roster data. Cache those owned frozen
    // segments; recurring flushes serialize only the changing life cursors.
    const head=JSON.stringify({kind:s.kind,schemaVersion:s.schemaVersion,generation:s.generation,worldKey:s.worldKey,contentRevision:s.contentRevision});
    const clock=JSON.stringify({clock:s.clock,walkingSpeedMetresPerSecond:s.walkingSpeedMetresPerSecond});
    const live=JSON.stringify({life:s.life,routineActions:s.routineActions,workstations:s.workstations,timberSupply:s.timberSupply,navigation:s.navigation,navigationOther:s.navigationOther,safetySignals:s.safetySignals,safetySignalIds:s.safetySignalIds,...(s.buildingEmergency?{buildingEmergency:s.buildingEmergency}:{})});
    const json=`${head.slice(0,-1)},"population":${population},${clock.slice(1,-1)},"rosterFacts":${facts},${live.slice(1)}`;
    if(new TextEncoder().encode(json).byteLength>VILLAGE_POPULATION_RUNTIME_MAX_BYTES)throw Error('Population save exceeds its 2 MiB UTF-8 budget.');return{ok:true,json};
  }catch(error){return fail(error instanceof Error?error.message:'Population serialization refused.');}
}
function isPopulationReferenceRecord(value:unknown):value is {reference:unknown}{
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&'reference'in value;
}
/** `migrated` is true for a V1 save, and for an inline roster when a reference
 * is supplied, so the owner's next explicit flush writes the compact form. */
export function parseVillagePopulationRuntime(json:string,expected:VillagePopulationExpectedIdentity,options:VillagePopulationSaveOptions={}):VillagePopulationRuntimeResult{
  try{
    placeDataRecord(expected,['worldKey','contentRevision']);const worldKey=key(expected.worldKey),revision=placeId(expected.contentRevision);
    if(typeof json!=='string'||new TextEncoder().encode(json).byteLength>VILLAGE_POPULATION_RUNTIME_MAX_BYTES)throw Error('Population save exceeds its bounded JSON budget.');
    const parsed=JSON.parse(json),reference=options.populationReference;let referenced=false;
    if(parsed&&typeof parsed==='object'&&isPopulationReferenceRecord(parsed.population)){
      if(!reference||parsed.population.reference!==referenceId(reference))throw Error('Population save names an authored roster this build does not supply.');
      parsed.population=reference.population;referenced=true;
    }
    const snapshot=ownRuntime(parsed);if(snapshot.worldKey!==worldKey||snapshot.contentRevision!==revision)throw Error('Population save belongs to another entry or content revision; explicit migration is required.');
    return{ok:true,snapshot,migrated:parsed.schemaVersion===1||parsed.routineActions===undefined||parsed.routineActions?.schemaVersion===1||parsed.workstations===undefined||parsed.timberSupply===undefined||!!reference&&!referenced};
  }catch(error){return fail(error instanceof Error?error.message:'Population JSON is invalid.');}
}

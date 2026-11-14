/** A minutely transaction joining fire, actual journeys/actions, raids and the
 * observer save. Rendering reads the result; it never advances this owner. */
import {advanceVillagePopulationEmergencyCheckpoint,getVillagePopulationTime,getVillagePopulationObservationStatus,
 recordVillagePopulationTimberAllocation,captureVillagePopulationEmergencyCheckpoint,sampleVillagePopulationRuntime,
 type VillagePopulationRuntime,type VillagePopulationSample,type VillagePopulationEmergencyCheckpoint} from '../characters/village-population-runtime';
import type {VillageSiteLayout} from '../characters/village-site';
import type {ResidentBuildingEmergencyFrame,ResidentBuildingEmergencyStation} from '../characters/resident-building-emergency';
import type {ResidentSafetySignal} from '../characters/resident-safety';
import type {WorldEnvironmentOverride} from '../environment/world-environment-state';
import type {SourceBuilding} from './building-damage-catalogue';
import type {RaidSiteChoice} from './bandit-raid';
import type {ObserverSave} from './observer-save';
import {advanceObserverRaidRecovery,type ObserverRecoveryStatus} from './observer-recovery-runtime';
import {advanceBuildingDisasterSession} from './building-disaster-session';
import {observerRaidWeatherOverride} from './observer-raid-observation';
import {observerRaidSafetySignals} from './raid-safety';
import type {RealmEvent} from './neighbour-houses';
import {matchesBuildingConflagrationCatalogue} from './building-conflagration';
import {planLocalBuildingRebuilds} from './automatic-building-rebuild';
import type {ResidentWorkplaceFrame} from '../characters/resident-workplace-frame';

export interface BuildingDisasterProjectionSource {
 readonly buildings:readonly SourceBuilding[];readonly site:VillageSiteLayout;
 /** Pure factual projection of fire@M; stations/knowledge belong to their
  * existing source-qualified owners. Never mutate the save in this callback. */
 readonly frameAt:(save:ObserverSave,absoluteMinute:number)=>ResidentBuildingEmergencyFrame|null;
 /** Qualified candidate stands before funding. Runtime frames may hide these
  * until the matching local order exists, so commands need this separate read. */
 readonly repairStationsAt?:(save:ObserverSave,absoluteMinute:number)=>readonly ResidentBuildingEmergencyStation[]|null;
 readonly initialObserved?:VillagePopulationRuntime;
 readonly workplaceFrame?:ResidentWorkplaceFrame|null;
}
export interface BuildingDisasterProjectionInput extends BuildingDisasterProjectionSource {
 readonly canonical:VillagePopulationRuntime;readonly requestedMilliseconds:number;
 readonly sites:readonly RaidSiteChoice[]|null;readonly maxWorldMinutes?:number;
 readonly environmentAt?:(absoluteMinute:number)=>WorldEnvironmentOverride|undefined;
 readonly signalsAt?:(absoluteMinute:number)=>readonly ResidentSafetySignal[];
}
export interface BuildingDisasterProjectionResult {
 readonly save:ObserverSave;readonly snapshot:VillagePopulationRuntime|null;readonly sample:VillagePopulationSample|null;
 readonly checkpoint:VillagePopulationEmergencyCheckpoint|null;
 readonly status:ObserverRecoveryStatus;readonly error:string|null;
 readonly processedMinute:number;readonly targetMinute:number;readonly pendingMinutes:number;
 readonly realmEvents:readonly (RealmEvent&{readonly minute:number})[];
}
/** Each committed interval is:
 * fire@M -> physical movement/action M..M+1 -> contact receipts -> raid/fire@M+1.
 * A failed interval returns the preceding complete composite, never half credit. */
export function advanceBuildingDisasterProjection(saved:ObserverSave,input:BuildingDisasterProjectionInput):BuildingDisasterProjectionResult{
 let current=saved,snapshot:VillagePopulationRuntime|null=null,sample:VillagePopulationSample|null=null;
 const realmEvents:(RealmEvent&{readonly minute:number})[]=[];
 let checkpoint=saved.buildingEmergency?.status==='valid'?saved.buildingEmergency.state:null;
 const c=input.canonical,pace=c.clock.millisecondsPerWorldMinute;
 let targetMinute=saved.raidCursor?.status==='valid'?saved.raidCursor.state.resolvedMinute:0;
 let processedMinute=checkpoint?Math.floor(checkpoint.clock.initialDayMinute+checkpoint.clock.simulatedElapsedMilliseconds/pace):saved.buildingFire?.status==='valid'?saved.buildingFire.state.absoluteMinute:targetMinute;
 const finish=(status:ObserverRecoveryStatus,error:string|null):BuildingDisasterProjectionResult=>({save:current,snapshot,sample,checkpoint,status,error,processedMinute,targetMinute,pendingMinutes:Math.max(0,targetMinute-processedMinute),realmEvents:Object.freeze([...realmEvents])});
 try{
  const budget=input.maxWorldMinutes??60;
  if(!Number.isSafeInteger(input.requestedMilliseconds)||input.requestedMilliseconds<0||!Number.isSafeInteger(budget)||budget<1||budget>240)throw Error('Disaster projection requires a bounded authoritative clock interval.');
  const canonicalTime=getVillagePopulationTime(c);targetMinute=c.clock.initialDayMinute+Math.floor(input.requestedMilliseconds/pace);if(!checkpoint&&!saved.buildingFire)processedMinute=canonicalTime.absoluteWorldMinute;
  if(!input.buildings.length||input.site.sourceSha256!==input.buildings[0].binding.sourceSha256||input.site.profile!==input.buildings[0].binding.profile)return finish('waiting-source','Disaster projection awaits the exact source site and buildings.');
  if(saved.buildingEmergency?.status==='invalid'||saved.buildingFire?.status==='invalid'||saved.localRebuildOrders?.status==='invalid')throw Error('Saved disaster state is invalid; its original record is preserved.');
  if(saved.buildingFire?.status==='valid'&&!matchesBuildingConflagrationCatalogue(saved.buildingFire.state,input.buildings))throw Error('The saved fire catalogue is unavailable in this source.');
  if(!checkpoint&&input.initialObserved&&getVillagePopulationObservationStatus(input.initialObserved)?.mode==='analytic-history-unavailable')
   return finish('waiting-population','Historical view precedes the saved physical world; return or catch up to its actual boundary before building recovery can begin.');
  const initial=input.initialObserved??c;
  let elapsed=checkpoint?.clock.simulatedElapsedMilliseconds??initial.clock.simulatedElapsedMilliseconds;
  if(input.requestedMilliseconds<elapsed)throw Error('The requested clock is behind the persisted physical disaster branch.');
  processedMinute=Math.floor(c.clock.initialDayMinute+elapsed/pace);
  let prepared=current;const adoptionEvents:(RealmEvent&{readonly minute:number})[]=[];
  // Adoption catches up the pre-existing legacy owner first, then starts the
  // new fire model NOW. It never retroactively spreads old burned headlines.
  if(!current.buildingFire){
   const legacy=advanceObserverRaidRecovery(current,{worldKey:c.worldKey,profile:input.site.profile,population:c.population,targetMinute:processedMinute,pendingPopulationMilliseconds:0,sites:input.sites});
   if(legacy.status!=='ready')return finish(legacy.status,legacy.error);
   const adopted=advanceBuildingDisasterSession(legacy.save,{worldKey:c.worldKey,absoluteMinute:processedMinute,buildings:input.buildings});prepared=adopted.save;adoptionEvents.push(...legacy.realmEvents);
  }
  if(prepared.buildingFire?.status!=='valid'||prepared.buildingFire.state.absoluteMinute!==processedMinute||prepared.raidCursor?.status!=='valid'||prepared.raidCursor.state.resolvedMinute!==processedMinute)throw Error('Saved fire, raid and physical cursors need reconciliation.');
  const frame=input.frameAt(prepared,processedMinute);
  if(!frame)return finish('waiting-source','Source-qualified disaster stations are not prepared.');
  const seed=advanceVillagePopulationEmergencyCheckpoint(c,checkpoint,elapsed,{site:input.site,frame,...(!checkpoint?{initialObserved:input.initialObserved}:{}),acknowledgedReceiptIds:prepared.buildingFire.state.deliveryIds,
   workplaceFrame:input.workplaceFrame,environmentAt:input.environmentAt??(minute=>observerRaidWeatherOverride(prepared.weather,minute)),signalsAt:input.signalsAt??(minute=>observerRaidSafetySignals(prepared.raid,minute,c.population))});
  snapshot=seed.snapshot;sample=seed.sample;checkpoint=seed.checkpoint;
  current={...prepared,buildingEmergency:{status:'valid',state:checkpoint}};realmEvents.push(...adoptionEvents);
  let consumed=0;
  while(elapsed<input.requestedMilliseconds&&consumed<budget){
   const absolute=c.clock.initialDayMinute+elapsed/pace;
   const boundary=(Math.floor(absolute)+1-c.clock.initialDayMinute)*pace;
   const nextElapsed=Math.min(input.requestedMilliseconds,boundary);
   const nextMinute=Math.floor(c.clock.initialDayMinute+nextElapsed/pace),prior=current;
   const nextFrame=input.frameAt(prior,processedMinute);if(!nextFrame)return finish('waiting-source','The current disaster work geometry is unavailable.');
   const moved=advanceVillagePopulationEmergencyCheckpoint(c,checkpoint,nextElapsed,{site:input.site,frame:nextFrame,workplaceFrame:input.workplaceFrame,
    acknowledgedReceiptIds:prior.buildingFire?.status==='valid'?prior.buildingFire.state.deliveryIds:[],
    environmentAt:input.environmentAt??(minute=>observerRaidWeatherOverride(prior.weather,minute)),signalsAt:input.signalsAt??(minute=>observerRaidSafetySignals(prior.raid,minute,c.population))});
   const recovered=advanceObserverRaidRecovery(prior,{worldKey:c.worldKey,profile:input.site.profile,population:c.population,targetMinute:nextMinute,pendingPopulationMilliseconds:0,sites:input.sites,
    buildings:input.buildings,emergencyCheckpoint:moved.checkpoint,
    firefighting:moved.sample.buildingEmergency?.waterDeliveries,repairs:moved.sample.buildingEmergency?.repairProgress});
   if(recovered.status!=='ready')return finish(recovered.status,recovered.error);
   // Only publish this complete interval after every source and receipt check.
   let committedSave=recovered.save,committedSnapshot=moved.snapshot;
   if(input.workplaceFrame&&input.repairStationsAt&&committedSnapshot.timberSupply.availableTimber>0){
    const repairFrame=input.frameAt(committedSave,nextMinute),stations=input.repairStationsAt(committedSave,nextMinute);
    if(repairFrame&&stations){
     const planned=planLocalBuildingRebuilds(committedSave,committedSnapshot.timberSupply,{worldKey:c.worldKey,atMinute:nextMinute,siteIdentity:repairFrame.siteIdentity,population:c.population,buildings:input.buildings,stations});
     if(planned.orders.length){committedSnapshot=recordVillagePopulationTimberAllocation(committedSnapshot,planned.supply);committedSave=planned.save;}
    }
   }
   const committedCheckpoint=captureVillagePopulationEmergencyCheckpoint(committedSnapshot);if(!committedCheckpoint)throw Error('Workplace transaction lost its physical checkpoint.');
   current={...committedSave,buildingEmergency:{status:'valid',state:committedCheckpoint}};snapshot=committedSnapshot;sample=committedSnapshot===moved.snapshot?moved.sample:sampleVillagePopulationRuntime(committedSnapshot,input.site);checkpoint=committedCheckpoint;realmEvents.push(...recovered.realmEvents);
   elapsed=nextElapsed;processedMinute=nextMinute;consumed++;
  }
  return finish(elapsed<input.requestedMilliseconds?'catching-up':'ready',null);
 }catch(error){return finish('blocked',error instanceof Error?error.message:'Disaster projection was held.');}
}

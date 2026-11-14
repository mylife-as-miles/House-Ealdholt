/** Saved fire/reconstruction coordination. This owns no renderer, population
 * clock or arrival: it accepts the existing clock and checked physical receipts. */
import {copyObserverJSON} from './observer-json';
import {buildingDamageKey,parseBuildingDamageBinding,parseVillageBuildingDamage,reserveLocalBuildingTimber,
 BUILDING_REBUILD_TIMBER,BUILDING_REBUILD_LABOUR_MINUTES,type BuildingDamageBinding,type BuildingConditionRecord,type BuildingRaidOutcome} from './building-damage';
import {createBuildingConflagration,matchesBuildingConflagrationCatalogue,stepBuildingConflagration,
 sampleBuildingConflagrationWeather,type BuildingConflagrationEvent,type BuildingConflagrationState,type BuildingFireRecord,
 type BuildingFirefightingDelivery,type BuildingLocalRepairProgress} from './building-conflagration';
import {observerRaidWeatherOverride} from './observer-raid-observation';
import type {SourceBuilding} from './building-damage-catalogue';
import {parseVillagePopulationEmergencyCheckpoint,type VillagePopulationEmergencyCheckpoint} from '../characters/village-population-runtime';
import type {ResidentBuildingEmergencyStation} from '../characters/resident-building-emergency';
import type {VillagePopulation} from '../characters/village-population';
import type {ObserverSave} from './observer-save';
import {RAID_APPROACH_MINUTES,RAID_CLASH_MINUTES} from './bandit-raid';
import {parseVillageTimberSupply,advanceVillageTimberSupply,allocateVillageTimber,type VillageTimberSupply} from './village-timber-supply';

export interface BuildingLocalRebuildOrder {
 readonly id:string;readonly incidentId:string;readonly binding:BuildingDamageBinding;
 readonly orderedAtMinute:number;readonly workerIds:readonly string[];readonly reservedTimber:12;
 readonly deliveredTimber:number;readonly completedAtMinute:number|null;
}
export interface BuildingLocalRebuildOrders {
 readonly kind:'building-local-rebuild-orders';readonly schemaVersion:1;readonly worldKey:string;
 readonly orders:readonly BuildingLocalRebuildOrder[];
}
export type BuildingLocalRebuildOrdersRestore={readonly status:'valid';readonly state:BuildingLocalRebuildOrders}|{readonly status:'invalid';readonly raw:unknown;readonly error:string};
const integer=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const id=(v:unknown,max=1200):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&v.trim()===v&&!/[\u0000-\u001f\u007f]/u.test(v);
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(v,k));
const sameBinding=(a:BuildingDamageBinding,b:BuildingDamageBinding)=>buildingDamageKey(a)===buildingDamageKey(b)&&a.siteIndex===b.siteIndex;
function freeze<T>(v:T):T{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;}
export function createBuildingLocalRebuildOrders(worldKey:string):BuildingLocalRebuildOrders{
 if(!id(worldKey,2048))throw Error('Local repairs require the existing world.');
 return freeze({kind:'building-local-rebuild-orders',schemaVersion:1,worldKey,orders:[]});
}
export function parseBuildingLocalRebuildOrders(value:unknown,expectedWorldKey?:string):BuildingLocalRebuildOrders{
 const s=copyObserverJSON(value) as BuildingLocalRebuildOrders;
 if(!exact(s,['kind','schemaVersion','worldKey','orders'])||s.kind!=='building-local-rebuild-orders'||s.schemaVersion!==1||!id(s.worldKey,2048)||expectedWorldKey!==undefined&&s.worldKey!==expectedWorldKey||!Array.isArray(s.orders)||s.orders.length>512)throw Error('Invalid local reconstruction record.');
 const seen=new Set<string>();
 for(const o of s.orders){
  if(!exact(o,['id','incidentId','binding','orderedAtMinute','workerIds','reservedTimber','deliveredTimber','completedAtMinute'])||!id(o.id,500)||!id(o.incidentId,500)||!integer(o.orderedAtMinute)||o.reservedTimber!==BUILDING_REBUILD_TIMBER||!integer(o.deliveredTimber,0,BUILDING_REBUILD_TIMBER)||o.completedAtMinute!==null&&!integer(o.completedAtMinute,o.orderedAtMinute)||!Array.isArray(o.workerIds)||!o.workerIds.length||o.workerIds.length>16||o.workerIds.some(v=>!id(v,160))||new Set(o.workerIds).size!==o.workerIds.length)throw Error('Invalid reserved local repair order.');
  const binding=parseBuildingDamageBinding(o.binding),k=buildingDamageKey(binding);if(seen.has(k))throw Error('A building cannot hold duplicate repair orders.');seen.add(k);
  if(o.completedAtMinute!==null&&o.deliveredTimber!==BUILDING_REBUILD_TIMBER)throw Error('Completed repair lacks its reserved material delivery.');
 }
 return freeze(s);
}
export function restoreBuildingLocalRebuildOrders(value:unknown,worldKey?:string):BuildingLocalRebuildOrdersRestore{
 try{return{status:'valid',state:parseBuildingLocalRebuildOrders(value,worldKey)};}catch(error){return{status:'invalid',raw:value,error:String(error)};}
}
export function serializeBuildingLocalRebuildOrdersRestore(value:BuildingLocalRebuildOrdersRestore):unknown{return value.status==='valid'?parseBuildingLocalRebuildOrders(value.state):copyObserverJSON(value.raw);}
export function buildingFireIncidentId(record:BuildingFireRecord):string|null{
 return record.ignition?`building-fire:${record.ignition.outcome.raidId}:${record.binding.siteIndex}:${record.ignition.minute}`:null;
}
export interface RequestLocalBuildingRebuildInput {
 readonly worldKey:string;readonly binding:BuildingDamageBinding;readonly atMinute:number;
 readonly workerIds:readonly string[];readonly population:VillagePopulation;readonly buildings:readonly SourceBuilding[];
 readonly stations:readonly ResidentBuildingEmergencyStation[];
}
export function requestLocalBuildingRebuild(saved:ObserverSave,input:RequestLocalBuildingRebuildInput):{readonly ok:true;readonly save:ObserverSave}|{readonly ok:false;readonly save:ObserverSave;readonly reason:string}{
 const fail=(reason:string)=>({ok:false as const,save:saved,reason});
 try{
  if(!integer(input.atMinute)||saved.buildingFire?.status!=='valid'||saved.buildingDamage?.status!=='valid'||saved.localRebuildOrders?.status==='invalid'||saved.buildingEmergency?.status==='invalid')return fail('The source-bound village record is not ready.');
  const fire=saved.buildingFire.state,damage=parseVillageBuildingDamage(saved.buildingDamage.state,input.worldKey);
  if(fire.worldKey!==input.worldKey||fire.absoluteMinute!==input.atMinute||damage.absoluteMinute!==input.atMinute||!matchesBuildingConflagrationCatalogue(fire,input.buildings))return fail('Repairs require the current source and completed world minute.');
  const record=fire.buildings.find(b=>sameBinding(b.binding,input.binding)),incident=record?buildingFireIncidentId(record):null;
  if(!record||!incident||record.phase==='sound'||record.phase==='burning')return fail('Only an extinguished damaged building can be rebuilt.');
  const orders=saved.localRebuildOrders?.state??createBuildingLocalRebuildOrders(input.worldKey);
  if(orders.worldKey!==input.worldKey)return fail('Repair orders belong to another world.');
  if(orders.orders.some(o=>sameBinding(o.binding,input.binding)&&o.incidentId===incident))return fail('This incident already has a funded local repair order.');
  if(!input.workerIds.length||input.workerIds.length>16||new Set(input.workerIds).size!==input.workerIds.length)return fail('Select a finite named local repair crew.');
  for(const worker of input.workerIds){
   const person=input.population.residents.find(r=>r.id===worker);
   if(!person||person.ageYears<18||person.ageYears>=60)return fail('A repair crew must use eligible adult residents.');
   if(!input.stations.some(s=>s.kind==='repair'&&s.residentId===worker&&s.disasterId===incident&&s.buildingKey===buildingDamageKey(input.binding)&&s.proof.sourceSha256===input.binding.sourceSha256&&s.proof.profile===input.binding.profile&&s.proof.originalTriangleClearance&&s.proof.wholeFootprintSupported&&s.proof.sweptClipAndPropsClear))return fail('A worker has no source-qualified repair station.');
  }
  if(damage.timber<BUILDING_REBUILD_TIMBER)return fail(`Needs ${BUILDING_REBUILD_TIMBER} timber.`);
  const order:BuildingLocalRebuildOrder={id:`local-rebuild:${incident}`,incidentId:incident,binding:input.binding,orderedAtMinute:input.atMinute,workerIds:[...input.workerIds].sort(),reservedTimber:12,deliveredTimber:0,completedAtMinute:null};
  const nextOrders=parseBuildingLocalRebuildOrders({...orders,orders:[...orders.orders.filter(o=>!sameBinding(o.binding,input.binding)),order]},input.worldKey);
  return{ok:true,save:{...saved,buildingDamage:{status:'valid',state:reserveLocalBuildingTimber(damage)},localRebuildOrders:{status:'valid',state:nextOrders}}};
 }catch(error){return fail(error instanceof Error?error.message:'Local reconstruction was held.');}
}

/** One transaction consumes earned local timber and reserves the existing
 * source-qualified repair order. Its owner persists both returned records in
 * the same emergency checkpoint/observer save; refusal changes neither one. */
export function requestLocalBuildingRebuildFromSupply(saved:ObserverSave,supply:VillageTimberSupply,input:RequestLocalBuildingRebuildInput):
 {readonly ok:true;readonly save:ObserverSave;readonly supply:VillageTimberSupply;readonly allocatedTimber:number}|
 {readonly ok:false;readonly save:ObserverSave;readonly supply:VillageTimberSupply;readonly reason:string}{
 const fail=(reason:string)=>({ok:false as const,save:saved,supply,reason});
 try{
  const stock=parseVillageTimberSupply(supply,input.worldKey);
  if(input.atMinute<stock.absoluteMinute)return fail('Local timber is ahead of the requested repair minute.');
  // Run all ordinary source, actor, eligibility and incident checks first.
  // A material shortage is the only refusal that can be repaired by a transfer.
  const first=requestLocalBuildingRebuild(saved,input);
  if(first.ok)return{ok:true,save:first.save,supply:advanceVillageTimberSupply(stock,input.atMinute),allocatedTimber:0};
  if(first.reason!==`Needs ${BUILDING_REBUILD_TIMBER} timber.`)return fail(first.reason);
  if(saved.buildingDamage?.status!=='valid'||saved.buildingFire?.status!=='valid')return fail('Local repair source is unavailable.');
  const damage=parseVillageBuildingDamage(saved.buildingDamage.state,input.worldKey),record=saved.buildingFire.state.buildings.find(b=>sameBinding(b.binding,input.binding)),incidentId=record&&buildingFireIncidentId(record);
  if(!incidentId)return fail('Local timber needs its current source-bound fire incident.');
  if(stock.allocations.some(a=>a.id===`local-rebuild:${incidentId}`))return fail('Timber was already allocated to this incident; retain its existing order.');
  const amount=BUILDING_REBUILD_TIMBER-damage.timber;
  if(stock.availableTimber<amount)return fail(`Needs ${amount} earned local timber.`);
  const nextSupply=allocateVillageTimber(stock,{incidentId,binding:input.binding,atMinute:input.atMinute,timber:amount});
  const fundedDamage=parseVillageBuildingDamage({...damage,generation:damage.generation+1,timber:damage.timber+amount},input.worldKey);
  const requested=requestLocalBuildingRebuild({...saved,buildingDamage:{status:'valid',state:fundedDamage}},input);
  if(!requested.ok)return fail(requested.reason);
  return{ok:true,save:requested.save,supply:nextSupply,allocatedTimber:amount};
 }catch(error){return fail(error instanceof Error?error.message:'Local timber funding was held.');}
}

export interface AdvanceBuildingDisasterInput {
 readonly worldKey:string;readonly absoluteMinute:number;readonly buildings:readonly SourceBuilding[];
 readonly damageOutcome?:BuildingRaidOutcome|null;readonly emergencyCheckpoint?:VillagePopulationEmergencyCheckpoint|null;
 readonly firefighting?:readonly BuildingFirefightingDelivery[];readonly repairs?:readonly BuildingLocalRepairProgress[];
 readonly maxMinutes?:number;
}
export interface AdvanceBuildingDisasterResult {readonly save:ObserverSave;readonly events:readonly BuildingConflagrationEvent[];readonly processedMinute:number;readonly pendingMinutes:number}
/** All state is returned transactionally; callers save/CAS it before publishing
 * new commands. Physical receipts must be present in the captured nav+duty branch. */
export function advanceBuildingDisasterSession(saved:ObserverSave,input:AdvanceBuildingDisasterInput):AdvanceBuildingDisasterResult{
 if(saved.buildingFire?.status==='invalid'||saved.buildingEmergency?.status==='invalid'||saved.localRebuildOrders?.status==='invalid')throw Error('Saved disaster data is invalid; preserve it until reconciled.');
 if(!integer(input.absoluteMinute)||!input.buildings.length)throw Error('Building disasters await their complete source catalogue.');
 if(input.maxMinutes!==undefined&&!integer(input.maxMinutes,1,1440))throw Error('Disaster catch-up requires a bounded minute budget.');
 let fire=saved.buildingFire?.state;
 if(!fire){
  // Adoption never replays old burned headlines. A genuinely unsettled raid
  // can still finish after the adoption minute.
  let issued=saved.raidSerial;
  if(saved.raid){const serial=Number(/^raid-\d+-(\d+)$/u.exec(saved.raid.id)?.[1]);if(Number.isSafeInteger(serial)&&saved.raid.startMinute+saved.raid.sightedMinutes+RAID_APPROACH_MINUTES+RAID_CLASH_MINUTES>input.absoluteMinute)issued=serial;}
  fire=createBuildingConflagration({worldKey:input.worldKey,absoluteMinute:input.absoluteMinute,seed:input.worldKey,buildings:input.buildings,alreadyIssuedRaids:issued});
 }
 if(fire.worldKey!==input.worldKey||!matchesBuildingConflagrationCatalogue(fire,input.buildings))throw Error('Building fire source changed; its saved catalogue is held.');
 if(input.absoluteMinute<fire.absoluteMinute)throw Error('Building fire cannot rewind.');
 let checkpoint=saved.buildingEmergency?.state;
 if(input.emergencyCheckpoint){const candidate=parseVillagePopulationEmergencyCheckpoint(input.emergencyCheckpoint,input.worldKey);
  if(Math.floor(candidate.buildingEmergency.absoluteMinute)>input.absoluteMinute)throw Error('Physical work checkpoint is ahead of the requested minute.');
  if(!checkpoint||candidate.clock.simulatedElapsedMilliseconds>=checkpoint.clock.simulatedElapsedMilliseconds)checkpoint=candidate;
 }
 const pendingWater=checkpoint?.buildingEmergency.waterDeliveries??[],pendingRepair=checkpoint?.buildingEmergency.repairProgress??[];
 const sameReceipt=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 const water=(input.firefighting??pendingWater).filter(r=>!fire!.deliveryIds.includes(r.id));
 const repairs=(input.repairs??pendingRepair).filter(r=>!fire!.deliveryIds.includes(r.id));
 for(const r of [...water,...repairs])if(r.atMinute>input.absoluteMinute)throw Error('Physical work cannot be applied before its contact minute.');
 for(const r of water)if(!pendingWater.some(p=>sameReceipt(p,r)))throw Error('Water delivery lacks the captured physical work receipt.');
 let orders=saved.localRebuildOrders?.state??createBuildingLocalRebuildOrders(input.worldKey);
 if(orders.worldKey!==input.worldKey)throw Error('Repair orders belong to another world.');
 const nextOrders=orders.orders.map(o=>({...o}));
 for(const r of repairs){
  if(!pendingRepair.some(p=>sameReceipt(p,r)))throw Error('Repair delivery lacks the captured physical work receipt.');
  const b=fire.buildings.find(b=>sameBinding(b.binding,r.binding)),incident=b?buildingFireIncidentId(b):null;
  const o=nextOrders.find(o=>sameBinding(o.binding,r.binding)&&o.incidentId===incident&&o.completedAtMinute===null);
  if(!o||!o.workerIds.includes(r.residentId)||r.atMinute<o.orderedAtMinute||!incident)throw Error('Repair work has no matching funded local crew order.');
  if(r.timber){if(r.residentId!==o.workerIds[0]||o.deliveredTimber+r.timber>o.reservedTimber)throw Error('Repair work exceeds its reserved physical material delivery.');o.deliveredTimber+=r.timber;}
 }
 const to=Math.min(input.absoluteMinute,fire.absoluteMinute+(input.maxMinutes??240)),weather=[];
 for(let at=fire.absoluteMinute;at<to;at++){const override=observerRaidWeatherOverride(saved.weather,at);if(override)weather.push(sampleBuildingConflagrationWeather(input.worldKey,at,override));}
 const result=stepBuildingConflagration(fire,{absoluteMinute:input.absoluteMinute,damageOutcome:input.damageOutcome,firefighting:water,repairs,weather,maxMinutes:input.maxMinutes});
 for(const e of result.events)if(e.kind==='repaired'){const o=nextOrders.find(o=>sameBinding(o.binding,e.binding)&&o.incidentId===buildingFireIncidentId(fire!.buildings.find(b=>sameBinding(b.binding,e.binding))!));if(o)o.completedAtMinute=e.minute;}
 orders=parseBuildingLocalRebuildOrders({...orders,orders:nextOrders},input.worldKey);
 return{save:{...saved,buildingFire:{status:'valid',state:result.state},...(checkpoint?{buildingEmergency:{status:'valid' as const,state:checkpoint}}:{}),localRebuildOrders:{status:'valid',state:orders}},events:result.events,processedMinute:result.state.absoluteMinute,pendingMinutes:result.remainingMinutes};
}

/** Scene projection only: a live fire's earned local progress overrides the old
 * aid-party presentation for that exact source binding, never another house. */
export function buildingDisasterConditions(saved:ObserverSave):readonly (BuildingConditionRecord&{readonly collapseAtMinute?:number})[]{
 const rows=new Map<string,BuildingConditionRecord&{readonly collapseAtMinute?:number}>();
 if(saved.buildingDamage?.status==='valid')for(const r of saved.buildingDamage.state.buildings)rows.set(buildingDamageKey(r.binding),r);
 if(saved.buildingFire?.status!=='valid')return[...rows.values()];
 for(const fire of saved.buildingFire.state.buildings){
  if(!fire.ignition&&fire.rebuiltAtMinute===null)continue;
  const k=buildingDamageKey(fire.binding),old=rows.get(k),order=saved.localRebuildOrders?.status==='valid'?saved.localRebuildOrders.state.orders.find(o=>sameBinding(o.binding,fire.binding)&&o.incidentId===buildingFireIncidentId(fire)):null;
  const sound=fire.phase==='sound',rebuilding=!sound&&!!order&&order.completedAtMinute===null;
  if(sound){rows.delete(k);continue;}
  rows.set(k,{binding:fire.binding,label:old?.label??'Village building',condition:rebuilding?'rebuilding':'burned',burnedAtMinute:fire.ignition!.minute,lastRaidId:fire.ignition!.outcome.raidId,
   rebuild:rebuilding?{crewId:order!.id,startedMinute:order!.orderedAtMinute,labourRequired:BUILDING_REBUILD_LABOUR_MINUTES,labourDone:fire.repairLabour,timberCommitted:12}:null,rebuiltAtMinute:null,
   collapseAtMinute:fire.collapsedAtMinute??Number.MAX_SAFE_INTEGER});
 }
 return[...rows.values()];
}

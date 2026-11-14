/** NPC-initiated reconstruction planning after real local fire response.
 * Funding creates only a work order. Navigation, material delivery, authored
 * contacts and labour remain owned by their existing physical reducers. */
import type {ObserverSave} from './observer-save';
import type {VillagePopulation} from '../characters/village-population';
import type {ResidentBuildingEmergencyStation} from '../characters/resident-building-emergency';
import type {SourceBuilding} from './building-damage-catalogue';
import {parseVillageBuildingDamage,buildingDamageKey} from './building-damage';
import {parseBuildingConflagration,matchesBuildingConflagrationCatalogue} from './building-conflagration';
import {parseVillageTimberSupply,type VillageTimberSupply} from './village-timber-supply';
import {buildingFireIncidentId,parseBuildingLocalRebuildOrders,requestLocalBuildingRebuildFromSupply,type BuildingLocalRebuildOrder} from './building-disaster-session';

export interface AutomaticBuildingRebuildInput {
 readonly worldKey:string;readonly atMinute:number;readonly siteIdentity:string;
 readonly population:VillagePopulation;readonly buildings:readonly SourceBuilding[];
 readonly stations:readonly ResidentBuildingEmergencyStation[];
 /** Bound successful new reservations across repeated polls of this minute. */
 readonly maximumOrders?:number;
}
export interface AutomaticBuildingRebuildResult {
 readonly save:ObserverSave;readonly supply:VillageTimberSupply;
 readonly orders:readonly BuildingLocalRebuildOrder[];
 readonly held:readonly {readonly buildingKey:string|null;readonly reason:string}[];
}
const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
const integer=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const sameBinding=(a:SourceBuilding['binding'],b:SourceBuilding['binding'])=>buildingDamageKey(a)===buildingDamageKey(b)&&a.siteIndex===b.siteIndex;
export function planLocalBuildingRebuilds(saved:ObserverSave,supply:VillageTimberSupply,input:AutomaticBuildingRebuildInput):AutomaticBuildingRebuildResult{
 const hold=(reason:string):AutomaticBuildingRebuildResult=>Object.freeze({save:saved,supply,orders:Object.freeze([]),held:Object.freeze([{buildingKey:null,reason}])});
 try{
  const maximum=input.maximumOrders??1;
  if(!integer(input.atMinute)||!integer(maximum,1,4)||typeof input.siteIdentity!=='string'||!input.siteIdentity)return hold('rebuild-source-or-budget-unavailable');
  if(saved.buildingFire?.status!=='valid'||saved.buildingDamage?.status!=='valid'||saved.localRebuildOrders?.status==='invalid'||saved.buildingEmergency?.status==='invalid')return hold('rebuild-state-unavailable');
  const fire=parseBuildingConflagration(saved.buildingFire.state,input.worldKey),damage=parseVillageBuildingDamage(saved.buildingDamage.state,input.worldKey),stock=parseVillageTimberSupply(supply,input.worldKey);
  if(fire.absoluteMinute!==input.atMinute||damage.absoluteMinute!==input.atMinute||stock.absoluteMinute>input.atMinute)return hold('rebuild-clock-mismatch');
  if(!matchesBuildingConflagrationCatalogue(fire,input.buildings))return hold('rebuild-source-changed');
  // Local rescue and suppression take precedence. This is the active village
  // catalogue, not a global rule that unrelated distant fires stop all work.
  if(fire.buildings.some(b=>b.phase==='burning'))return hold('local-fire-still-active');
  const existing=saved.localRebuildOrders?.state?parseBuildingLocalRebuildOrders(saved.localRebuildOrders.state,input.worldKey).orders:[];
  let remaining=maximum-existing.filter(o=>o.orderedAtMinute===input.atMinute).length;
  if(remaining<=0)return hold('rebuild-minute-order-budget');
  const reserved=new Set(existing.filter(o=>o.completedAtMinute===null).flatMap(o=>o.workerIds));
  const people=new Map(input.population.residents.map(r=>[r.id,r] as const));
  const candidates=fire.buildings.filter(b=>b.ignition&&b.phase!=='sound'&&b.phase!=='burning'&&b.rebuiltAtMinute===null)
   .sort((a,b)=>a.ignition!.minute-b.ignition!.minute||a.binding.siteIndex-b.binding.siteIndex||order(buildingDamageKey(a.binding),buildingDamageKey(b.binding)));
  let nextSave=saved,nextSupply=supply;const funded:BuildingLocalRebuildOrder[]=[],held:{buildingKey:string|null;reason:string}[]=[];
  for(const candidate of candidates){
   if(remaining<=0)break;const key=buildingDamageKey(candidate.binding),incidentId=buildingFireIncidentId(candidate)!;
   if(existing.some(o=>sameBinding(o.binding,candidate.binding)&&o.incidentId===incidentId))continue;
   const stations=input.stations.filter(station=>{
    const person=people.get(station.residentId);
    return station.kind==='repair'&&station.disasterId===incidentId&&station.buildingKey===key&&person&&person.ageYears>=18&&person.ageYears<60&&!reserved.has(person.id)
     &&station.proof.sourceSha256===candidate.binding.sourceSha256&&station.proof.profile===candidate.binding.profile&&station.proof.siteIdentity===input.siteIdentity
     &&station.proof.originalTriangleClearance===true&&station.proof.wholeFootprintSupported===true&&station.proof.sweptClipAndPropsClear===true
     &&station.proof.clip===station.clip&&['work_chisel','work_hammer_bench'].includes(station.clip);
   }).sort((a,b)=>order(a.residentId,b.residentId)||order(a.id,b.id));
   const workerIds=[...new Set(stations.map(s=>s.residentId))].slice(0,16);
   if(!workerIds.length){held.push({buildingKey:key,reason:'no-available-source-qualified-repair-crew'});continue;}
   const result=requestLocalBuildingRebuildFromSupply(nextSave,nextSupply,{worldKey:input.worldKey,binding:candidate.binding,atMinute:input.atMinute,workerIds,population:input.population,buildings:input.buildings,stations});
   if(!result.ok){held.push({buildingKey:key,reason:result.reason});continue;}
   const row=result.save.localRebuildOrders?.status==='valid'?result.save.localRebuildOrders.state.orders.find(o=>sameBinding(o.binding,candidate.binding)&&o.incidentId===incidentId):undefined;
   if(!row)throw Error('Funded local reconstruction did not return its order.');
   nextSave=result.save;nextSupply=result.supply;funded.push(row);for(const worker of row.workerIds)reserved.add(worker);remaining--;
  }
  return Object.freeze({save:nextSave,supply:nextSupply,orders:Object.freeze(funded),held:Object.freeze(held.map(v=>Object.freeze(v)))});
 }catch(error){return hold(error instanceof Error?error.message:'Automatic local reconstruction was held.');}
}

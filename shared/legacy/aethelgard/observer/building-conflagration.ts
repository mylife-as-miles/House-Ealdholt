/** Persistent, source-bound building fire on the completed village minute clock.
 * Geometry, rendering, resident arrivals and work certificates have other owners.
 * This reducer consumes explicit receipts; it never invents a resident action. */
import {sampleWorldEnvironment,type WorldEnvironmentOverride} from '../environment/world-environment-state';
import {buildingDamageKey,parseBuildingDamageBinding,BUILDING_REBUILD_LABOUR_MINUTES,BUILDING_REBUILD_TIMBER,type BuildingDamageBinding,type BuildingRaidOutcome} from './building-damage';
import type {SourceBuilding,BuildingSourceBounds,SourcePoint} from './building-damage-catalogue';
import {copyObserverJSON} from './observer-json';

/** Simulation tuning, not new canonical lore. Every saved v1 record uses these rules. */
export const BUILDING_CONFLAGRATION_RULES=Object.freeze({fuel:1200,ignitionHeat:700,collapseDamage:700,maxGap:12,maxNeighbours:12,defaultMinuteBudget:240,maxMinuteBudget:1440,maxBuildings:512,maxReceipts:8192,maxPending:4096,maxRetainedOutcomes:512});
export interface BuildingConflagrationWeather {readonly atMinute:number;readonly rain:number;readonly windX:number;readonly windZ:number}
export interface BuildingOperationProof {
 readonly sourceSha256:string;readonly profile:'desktop'|'quest';readonly buildingId:string;
 readonly operationId:string;readonly arrivalId:string;readonly contactMinute:number;
}
interface BuildingOperationDelivery {
 readonly id:string;readonly worldKey:string;readonly binding:BuildingDamageBinding;readonly atMinute:number;
 readonly residentId:string;readonly proof:BuildingOperationProof;
}
export interface BuildingFirefightingDelivery extends BuildingOperationDelivery {readonly water:number}
export interface BuildingLocalRepairProgress extends BuildingOperationDelivery {readonly labourMinutes:number;readonly timber:number}
export interface BuildingConflagrationSource {readonly binding:BuildingDamageBinding;readonly bounds:BuildingSourceBounds;readonly position:SourcePoint}
export interface BuildingIgnitionOrigin {readonly outcome:BuildingRaidOutcome;readonly sourceBinding:BuildingDamageBinding|null;readonly minute:number}
export interface BuildingFireRecord {
 readonly binding:BuildingDamageBinding;readonly phase:'sound'|'burning'|'charred'|'extinguished';
 readonly fuelRemaining:number;readonly intensity:number;readonly heat:number;readonly structuralDamage:number;
 readonly ignition:BuildingIgnitionOrigin|null;readonly collapsedAtMinute:number|null;readonly extinguishedAtMinute:number|null;
 readonly repairLabour:number;readonly repairTimber:number;readonly rebuiltAtMinute:number|null;
}
type PendingCommand={readonly kind:'raid';readonly atMinute:number;readonly value:BuildingRaidOutcome}
 |{readonly kind:'firefighting';readonly atMinute:number;readonly value:BuildingFirefightingDelivery}
 |{readonly kind:'repair';readonly atMinute:number;readonly value:BuildingLocalRepairProgress};
export interface RetainedBuildingFireOutcome {readonly reason:'unbound'|'source-unavailable'|'late';readonly outcome:BuildingRaidOutcome}
export interface BuildingConflagrationState {
 readonly kind:'building-conflagration';readonly schemaVersion:1;readonly rulesVersion:1;
 readonly worldKey:string;readonly seed:string;readonly absoluteMinute:number;readonly generation:number;readonly lastRaidSerial:number;
 readonly catalogue:readonly BuildingConflagrationSource[];readonly buildings:readonly BuildingFireRecord[];
 readonly pending:readonly PendingCommand[];readonly weather:readonly BuildingConflagrationWeather[];
 readonly deliveryIds:readonly string[];readonly operationIds:readonly string[];readonly retainedOutcomes:readonly RetainedBuildingFireOutcome[];
}
export interface BuildingConflagrationEvent {
 readonly id:string;readonly kind:'ignition'|'spread'|'extinguishing'|'collapse'|'repaired';readonly minute:number;
 readonly binding:BuildingDamageBinding;readonly sourceBinding:BuildingDamageBinding|null;
 readonly outcome:BuildingRaidOutcome;readonly cause:'raid'|'spread'|'rain'|'fuel'|'firefighting'|'repair';
}
export interface BuildingConflagrationStepInput {
 readonly absoluteMinute:number;readonly damageOutcome?:BuildingRaidOutcome|null;
 /** Exact interval samples [atMinute, atMinute+1). Missing minutes use the same
  * historical seeded sampler as the world. A current frame never covers a gap. */
 readonly weather?:readonly BuildingConflagrationWeather[];
 readonly firefighting?:readonly BuildingFirefightingDelivery[];readonly repairs?:readonly BuildingLocalRepairProgress[];
 readonly maxMinutes?:number;
}
export interface BuildingConflagrationStepResult {readonly state:BuildingConflagrationState;readonly events:readonly BuildingConflagrationEvent[];readonly processedMinutes:number;readonly remainingMinutes:number}

const R=BUILDING_CONFLAGRATION_RULES,MAX_NUMBER=1_000_000_000,trusted=new WeakSet<object>();
const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw Error('Fire data requires bounded integer values.');return value;}
function text(value:unknown,max=200):string {if(typeof value!=='string'||!value||value.length>max||value.trim()!==value||/[\u0000-\u001f\u007f]/u.test(value))throw Error('Fire data requires explicit bounded identities.');return value;}
function keys(value:any,names:readonly string[]):void {if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==names.length||names.some(k=>!Object.prototype.hasOwnProperty.call(value,k)))throw Error('Unknown or missing fire data fields.');}
function own(value:unknown,budget={left:200000},depth=0):any {
 if(--budget.left<0||depth>24)throw Error('Fire data exceeds its finite shape budget.');
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
 if(!value||typeof value!=='object')throw Error('Fire data must contain finite plain JSON.');
 if(Array.isArray(value)){
  if(value.length>R.maxReceipts||Reflect.ownKeys(value).length!==value.length+1)throw Error('Fire array capacity/shape exceeded.');
  return Array.from({length:value.length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!d.enumerable||!('value'in d))throw Error('Fire arrays cannot contain holes/getters.');return own(d.value,budget,depth+1);});
 }
 if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw Error('Fire records must be plain data.');
 const result:Record<string,unknown>={};for(const k of Reflect.ownKeys(value)){if(typeof k!=='string')throw Error('Fire data keys must be strings.');const d=Object.getOwnPropertyDescriptor(value,k)!;if(!d.enumerable||!('value'in d))throw Error('Fire records cannot contain accessors.');Object.defineProperty(result,k,{value:own(d.value,budget,depth+1),enumerable:true,writable:true,configurable:true});}return result;
}
function freeze<T>(value:T):T {if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function finish(value:BuildingConflagrationState):BuildingConflagrationState {trusted.add(value);return freeze(value);}
const equalBinding=(a:BuildingDamageBinding,b:BuildingDamageBinding)=>buildingDamageKey(a)===buildingDamageKey(b)&&a.siteIndex===b.siteIndex;
function raidSerial(value:BuildingRaidOutcome):number {const match=/^raid-(\d+)-(\d+)$/u.exec(value.raidId);if(!match||integer(Number(match[1]))!==value.startMinute)throw Error('Fire ignition must retain the actual raid identity.');return integer(Number(match[2]));}
function parseOutcome(value:any):BuildingRaidOutcome {
 keys(value,['worldKey','raidId','startMinute','settledMinute','outcome','binding','targetLabel']);if(value.worldKey!==null)text(value.worldKey,2048);text(value.raidId,60);text(value.targetLabel,160);
 integer(value.startMinute);integer(value.settledMinute,value.startMinute);if(!['repelled','plundered','burned'].includes(value.outcome))throw Error('Unknown fire raid outcome.');
 if(value.binding!==null)value.binding=parseBuildingDamageBinding(value.binding);if(value.worldKey===null&&value.binding!==null)throw Error('An unknown world cannot own physical ignition.');raidSerial(value);return value;
}
function parseWeather(value:any):BuildingConflagrationWeather {keys(value,['atMinute','rain','windX','windZ']);integer(value.atMinute);integer(value.rain,0,1000);integer(value.windX,-1000,1000);integer(value.windZ,-1000,1000);return value;}
function parseDelivery(value:any,kind:'firefighting'|'repair',worldKey:string):BuildingFirefightingDelivery|BuildingLocalRepairProgress {
 keys(value,['id','worldKey','binding','atMinute','residentId','proof',...(kind==='firefighting'?['water']:['labourMinutes','timber'])]);text(value.id,500);text(value.residentId,160);text(value.worldKey,2048);integer(value.atMinute);
 if(value.worldKey!==worldKey)throw Error('Building operation belongs to another world.');value.binding=parseBuildingDamageBinding(value.binding);
 const p=value.proof;keys(p,['sourceSha256','profile','buildingId','operationId','arrivalId','contactMinute']);text(p.operationId,500);text(p.arrivalId,500);integer(p.contactMinute);
 if(p.sourceSha256!==value.binding.sourceSha256||p.profile!==value.binding.profile||p.buildingId!==value.binding.buildingId||p.contactMinute!==value.atMinute)throw Error('Building operation lacks matching source/contact proof.');
 if(kind==='firefighting')integer(value.water,1,1000);else{integer(value.labourMinutes,0,60);integer(value.timber,0,BUILDING_REBUILD_TIMBER);if(!value.labourMinutes&&!value.timber)throw Error('Repair receipt contains no delivered work/material.');}return value;
}
function parseSource(value:any):BuildingConflagrationSource {
 keys(value,['binding','bounds','position']);value.binding=parseBuildingDamageBinding(value.binding);keys(value.bounds,['min','max']);
 for(const p of[value.bounds.min,value.bounds.max,value.position])if(!Array.isArray(p)||p.length!==3||!p.every((v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1_000_000))throw Error('Fire source geometry requires finite source coordinates.');
 if(!value.bounds.min.every((v:number,i:number)=>v<=value.bounds.max[i]&&value.bounds.max[i]-v<=1000)||!value.position.every((v:number,i:number)=>v>=value.bounds.min[i]&&v<=value.bounds.max[i]))throw Error('Invalid source building bounds/position.');return value;
}
function initialRecord(binding:BuildingDamageBinding):BuildingFireRecord {return{binding,phase:'sound',fuelRemaining:R.fuel,intensity:0,heat:0,structuralDamage:0,ignition:null,collapsedAtMinute:null,extinguishedAtMinute:null,repairLabour:0,repairTimber:0,rebuiltAtMinute:null};}

export function createBuildingConflagration(input:{readonly worldKey:string;readonly absoluteMinute:number;readonly seed:string;readonly buildings:readonly SourceBuilding[];readonly alreadyIssuedRaids?:number}):BuildingConflagrationState {
 const catalogue=input.buildings.map(b=>parseSource(own({binding:b.binding,bounds:b.bounds,position:b.position}))).sort((a,b)=>order(buildingDamageKey(a.binding),buildingDamageKey(b.binding)));
 return parseBuildingConflagration({kind:'building-conflagration',schemaVersion:1,rulesVersion:1,worldKey:text(input.worldKey,2048),seed:text(input.seed,2048),absoluteMinute:integer(input.absoluteMinute),generation:0,lastRaidSerial:integer(input.alreadyIssuedRaids??0)-1,catalogue,buildings:catalogue.map(b=>initialRecord(b.binding)),pending:[],weather:[],deliveryIds:[],operationIds:[],retainedOutcomes:[]});
}

/** Strict parsing does not repair/rebind unknown data. Use restore below to keep
 * rejected future/foreign JSON beside independently advancing observer fields. */
export function parseBuildingConflagration(value:unknown,expectedWorldKey?:string):BuildingConflagrationState {
 if(value&&typeof value==='object'&&trusted.has(value)){const s=value as BuildingConflagrationState;if(expectedWorldKey!==undefined&&s.worldKey!==expectedWorldKey)throw Error('Building fire save belongs to another world.');return s;}
 const s=own(value);keys(s,['kind','schemaVersion','rulesVersion','worldKey','seed','absoluteMinute','generation','lastRaidSerial','catalogue','buildings','pending','weather','deliveryIds','operationIds','retainedOutcomes']);
 if(s.kind!=='building-conflagration'||s.schemaVersion!==1||s.rulesVersion!==1)throw Error('Unsupported building fire version.');text(s.worldKey,2048);text(s.seed,2048);integer(s.absoluteMinute);integer(s.generation);integer(s.lastRaidSerial,-1);
 if(expectedWorldKey!==undefined&&s.worldKey!==expectedWorldKey)throw Error('Building fire save belongs to another world.');
 for(const name of['catalogue','buildings','pending','weather','deliveryIds','operationIds','retainedOutcomes'])if(!Array.isArray(s[name]))throw Error('Missing fire collections.');
 if(s.catalogue.length>R.maxBuildings||s.buildings.length!==s.catalogue.length||s.pending.length>R.maxPending||s.weather.length>R.maxPending||s.deliveryIds.length>R.maxReceipts||s.operationIds.length!==s.deliveryIds.length||s.retainedOutcomes.length>R.maxRetainedOutcomes)throw Error('Building fire capacity exceeded.');
 const sources=new Map<string,BuildingConflagrationSource>();let previous='';const indices=new Set<number>();
 for(const entry of s.catalogue){const b=parseSource(entry),key=buildingDamageKey(b.binding);if(sources.has(key)||previous&&order(previous,key)>=0||indices.has(b.binding.siteIndex))throw Error('Duplicate/unordered source fire catalogue.');
  if(sources.size){const first=s.catalogue[0].binding;if(b.binding.catalogueId!==first.catalogueId||b.binding.sourceSha256!==first.sourceSha256||b.binding.profile!==first.profile)throw Error('Fire catalogue mixes source identities.');}sources.set(key,b);previous=key;indices.add(b.binding.siteIndex);}
 const graph=adjacency(s.catalogue);
 for(let i=0;i<s.buildings.length;i++){
  const b=s.buildings[i];keys(b,['binding','phase','fuelRemaining','intensity','heat','structuralDamage','ignition','collapsedAtMinute','extinguishedAtMinute','repairLabour','repairTimber','rebuiltAtMinute']);b.binding=parseBuildingDamageBinding(b.binding);
  if(!equalBinding(b.binding,s.catalogue[i].binding)||!['sound','burning','charred','extinguished'].includes(b.phase))throw Error('Fire condition lacks its exact source building.');
  integer(b.fuelRemaining,0,R.fuel);integer(b.intensity,0,1000);integer(b.heat,0,R.ignitionHeat-1);integer(b.structuralDamage,0,1000);integer(b.repairLabour,0,BUILDING_REBUILD_LABOUR_MINUTES);integer(b.repairTimber,0,BUILDING_REBUILD_TIMBER);
  for(const key of['collapsedAtMinute','extinguishedAtMinute','rebuiltAtMinute'])if(b[key]!==null)integer(b[key],0,s.absoluteMinute);
  if(b.ignition!==null){keys(b.ignition,['outcome','sourceBinding','minute']);parseOutcome(b.ignition.outcome);integer(b.ignition.minute,b.ignition.outcome.settledMinute,s.absoluteMinute);
   const originBinding=b.ignition.outcome.binding,originSource=originBinding?sources.get(buildingDamageKey(originBinding)):null;
   if(b.ignition.outcome.worldKey!==s.worldKey||b.ignition.outcome.outcome!=='burned'||!originBinding||!originSource||!equalBinding(originSource.binding,originBinding)||raidSerial(b.ignition.outcome)>s.lastRaidSerial)throw Error('Fire origin lacks its saved source/world raid.');
   if(b.ignition.sourceBinding!==null){b.ignition.sourceBinding=parseBuildingDamageBinding(b.ignition.sourceBinding);const source=sources.get(buildingDamageKey(b.ignition.sourceBinding));if(!source||!equalBinding(source.binding,b.ignition.sourceBinding)||!graph[i].some(e=>equalBinding(s.catalogue[e.index].binding,b.ignition.sourceBinding)))throw Error('Spread origin is not a nearby saved source building.');}
   else if(!equalBinding(b.binding,originBinding))throw Error('Root ignition was rebound to a different source building.');}
  if(b.phase==='sound'&&(b.ignition!==null||b.intensity!==0||b.structuralDamage!==0||b.fuelRemaining!==R.fuel||b.collapsedAtMinute!==null||b.extinguishedAtMinute!==null||b.repairLabour!==0||b.repairTimber!==0))throw Error('Sound building contains unrepaired fire damage.');
  if(b.phase!=='sound'&&(b.ignition===null||b.rebuiltAtMinute!==null)||b.phase==='burning'&&(b.intensity===0||b.fuelRemaining===0||b.extinguishedAtMinute!==null||b.heat!==0||b.repairLabour!==0||b.repairTimber!==0)||b.phase!=='burning'&&b.intensity!==0||b.phase==='charred'&&(b.fuelRemaining!==0||b.heat!==0||b.extinguishedAtMinute===null)||b.phase==='extinguished'&&(b.extinguishedAtMinute===null||b.fuelRemaining===0)||b.structuralDamage>=R.collapseDamage&&b.collapsedAtMinute===null||b.collapsedAtMinute!==null&&b.structuralDamage<R.collapseDamage)throw Error('Inconsistent building fire phase/damage.');
 }
 const receipts=new Set<string>();for(const id of s.deliveryIds){text(id,500);if(receipts.has(id))throw Error('Duplicate building operation receipt.');receipts.add(id);}
 const operations=new Set<string>();for(const id of s.operationIds){text(id,1200);let pair:unknown;try{pair=JSON.parse(id);}catch{throw Error('Invalid completed operation identity.');}if(!Array.isArray(pair)||pair.length!==2||JSON.stringify(pair)!==id)throw Error('Invalid completed operation identity.');text(pair[0],160);text(pair[1],500);if(operations.has(id))throw Error('Duplicate completed operation identity.');operations.add(id);}
 const pendingIds=new Set<string>();let lastCommand:PendingCommand|null=null,lastPendingRaid=s.lastRaidSerial;
 for(const c of s.pending){keys(c,['kind','atMinute','value']);integer(c.atMinute,s.absoluteMinute);if(!['raid','firefighting','repair'].includes(c.kind))throw Error('Unknown pending fire command.');
  if(c.kind==='raid'){parseOutcome(c.value);if(c.value.worldKey!==null&&c.value.worldKey!==s.worldKey||c.atMinute!==c.value.settledMinute||raidSerial(c.value)<=lastPendingRaid)throw Error('Invalid pending fire raid.');lastPendingRaid=raidSerial(c.value);}
  else{parseDelivery(c.value,c.kind,s.worldKey);const source=sources.get(buildingDamageKey(c.value.binding));if(c.atMinute!==c.value.atMinute||!source||!equalBinding(source.binding,c.value.binding)||!receipts.has(c.value.id)||!operations.has(operationKey(c.value)))throw Error('Invalid queued source operation.');}
  const id=commandId(c);if(pendingIds.has(id)||lastCommand&&compareCommand(lastCommand,c)>=0)throw Error('Duplicate/unordered pending fire receipt.');pendingIds.add(id);lastCommand=c;
 }
 let lastWeather=-1;for(const w of s.weather){parseWeather(w);if(w.atMinute<s.absoluteMinute||w.atMinute<=lastWeather)throw Error('Historical weather cannot be rewritten.');lastWeather=w.atMinute;}
 const retainedSerials=new Set<number>();for(const r of s.retainedOutcomes){keys(r,['reason','outcome']);if(!['unbound','source-unavailable','late'].includes(r.reason))throw Error('Unknown retained raid reason.');parseOutcome(r.outcome);const serial=raidSerial(r.outcome),binding=r.outcome.binding,source=binding?sources.get(buildingDamageKey(binding)):null;if(serial>s.lastRaidSerial||retainedSerials.has(serial)||r.outcome.settledMinute>s.absoluteMinute||r.outcome.worldKey!==null&&r.outcome.worldKey!==s.worldKey||r.reason==='unbound'&&binding!==null||r.reason==='source-unavailable'&&(!binding||source&&equalBinding(source.binding,binding))||r.reason==='late'&&r.outcome.settledMinute>=s.absoluteMinute)throw Error('Invalid retained fire outcome.');retainedSerials.add(serial);}
 return finish(s);
}

function sourceSnapshot(buildings:readonly SourceBuilding[]):BuildingConflagrationSource[]{return buildings.map(b=>parseSource(own({binding:b.binding,bounds:b.bounds,position:b.position}))).sort((a,b)=>order(buildingDamageKey(a.binding),buildingDamageKey(b.binding)));}
/** Save geometry must match the currently loaded catalogue before visual/nav
 * ownership. Platform/source changes hold the old save; they do not reset it. */
export function matchesBuildingConflagrationCatalogue(value:BuildingConflagrationState,buildings:readonly SourceBuilding[]):boolean {const s=parseBuildingConflagration(value);return JSON.stringify(s.catalogue)===JSON.stringify(sourceSnapshot(buildings));}
export function sampleBuildingConflagrationWeather(worldKey:string,atMinute:number,override?:WorldEnvironmentOverride):BuildingConflagrationWeather {
 const at=integer(atMinute),w=sampleWorldEnvironment({absoluteWorldMinute:at,dayIndex:Math.floor(at/1440),dayMinute:at%1440,fractionalMinute:0,elapsedWorldMinutes:0,deferredMilliseconds:0},text(worldKey,2048),override);
 return Object.freeze({atMinute:at,rain:Math.round(w.rain*1000),windX:Math.round(w.wind[0]*w.windStrength*1000),windZ:Math.round(w.wind[1]*w.windStrength*1000)});
}

interface Edge {readonly index:number;readonly exposure:number;readonly dx:number;readonly dz:number}
const adjacencyCache=new WeakMap<object,readonly (readonly Edge[])[]>();
function adjacency(catalogue:readonly BuildingConflagrationSource[]):readonly (readonly Edge[])[] {
 const cached=adjacencyCache.get(catalogue);if(cached)return cached;
 const edges:Edge[][]=catalogue.map(()=>[]),pairs:{a:number;b:number;gap:number}[]=[];
 for(let a=0;a<catalogue.length;a++)for(let b=a+1;b<catalogue.length;b++){
  const x=catalogue[a].bounds,y=catalogue[b].bounds,dx=Math.max(0,x.min[0]-y.max[0],y.min[0]-x.max[0]),dz=Math.max(0,x.min[2]-y.max[2],y.min[2]-x.max[2]),vertical=Math.max(0,x.min[1]-y.max[1],y.min[1]-x.max[1]),gap=Math.hypot(dx,dz);
  if(gap<=R.maxGap&&vertical<=4)pairs.push({a,b,gap});
 }
 pairs.sort((a,b)=>a.gap-b.gap||a.a-b.a||a.b-b.b);
 for(const p of pairs){if(edges[p.a].length>=R.maxNeighbours||edges[p.b].length>=R.maxNeighbours)continue;
  const a=catalogue[p.a].position,b=catalogue[p.b].position,dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz)||1,exposure=Math.round(1000*(1-p.gap/(R.maxGap+1)));
  edges[p.a].push({index:p.b,exposure,dx:dx/length,dz:dz/length});edges[p.b].push({index:p.a,exposure,dx:-dx/length,dz:-dz/length});}
 const result=edges.map(e=>Object.freeze(e.sort((a,b)=>a.index-b.index)));adjacencyCache.set(catalogue,result);return result;
}
function hash(value:string):number {let h=2166136261;for(let i=0;i<value.length;i++)h=Math.imul(h^value.charCodeAt(i),16777619);return h>>>0;}
function commandId(c:PendingCommand):string {return c.kind==='raid'?`raid:${raidSerial(c.value)}`:`delivery:${c.value.id}`;}
function operationKey(value:BuildingOperationDelivery):string {return JSON.stringify([value.residentId,value.proof.operationId]);}
const commandRank={raid:0,firefighting:1,repair:2};
function compareCommand(a:PendingCommand,b:PendingCommand):number {return a.atMinute-b.atMinute||commandRank[a.kind]-commandRank[b.kind]||(a.kind==='raid'&&b.kind==='raid'?raidSerial(a.value)-raidSerial(b.value):order(commandId(a),commandId(b)));}
function event(kind:BuildingConflagrationEvent['kind'],minute:number,b:BuildingFireRecord,cause:BuildingConflagrationEvent['cause']):BuildingConflagrationEvent {
 if(!b.ignition)throw Error('A building fire event needs an actual ignition.');return{id:JSON.stringify([b.ignition.outcome.raidId,buildingDamageKey(b.binding),kind,minute]),kind,minute,binding:b.binding,sourceBinding:b.ignition.sourceBinding,outcome:b.ignition.outcome,cause};
}
function ignite(b:BuildingFireRecord,minute:number,outcome:BuildingRaidOutcome,sourceBinding:BuildingDamageBinding|null):BuildingFireRecord {return{...b,phase:'burning',intensity:600,heat:0,ignition:{outcome,sourceBinding,minute},extinguishedAtMinute:null,repairLabour:0,repairTimber:0,rebuiltAtMinute:null};}

/** Commands are retained before a bounded pump. Repeated pumps/saves have the
 * same result as minute-by-minute observation, including exact event minutes. */
export function stepBuildingConflagration(value:BuildingConflagrationState,input:BuildingConflagrationStepInput):BuildingConflagrationStepResult {
 const s=parseBuildingConflagration(value),target=integer(input.absoluteMinute,s.absoluteMinute),budget=integer(input.maxMinutes??R.defaultMinuteBudget,1,R.maxMinuteBudget),to=Math.min(target,s.absoluteMinute+budget);
 for(const entries of[input.weather,input.firefighting,input.repairs])if(entries!==undefined&&(!Array.isArray(entries)||entries.length>R.maxPending))throw Error('Building fire input exceeds its bounded collection budget.');
 let generation=s.generation,lastRaidSerial=s.lastRaidSerial;const buildings=s.buildings.map(b=>({...b})),pending=[...s.pending],weather=[...s.weather],deliveryIds=[...s.deliveryIds],operationIds=[...s.operationIds],retainedOutcomes=[...s.retainedOutcomes],events:BuildingConflagrationEvent[]=[];
 const sourceKeys=s.catalogue.map(b=>buildingDamageKey(b.binding)),sourceIndices=new Map(sourceKeys.map((key,i)=>[key,i])),knownReceipts=new Set(deliveryIds),knownOperations=new Set(operationIds),spreadFactors=new Map<string,number>();
 function retain(outcome:BuildingRaidOutcome,reason:RetainedBuildingFireOutcome['reason']) {if(retainedOutcomes.length>=R.maxRetainedOutcomes)throw Error('Retained legacy fire outcome capacity exhausted; preserve this state.');retainedOutcomes.push({reason,outcome});}
 function exactSource(binding:BuildingDamageBinding):number|undefined {const i=sourceIndices.get(buildingDamageKey(binding));return i!==undefined&&equalBinding(binding,s.catalogue[i].binding)?i:undefined;}
 if(input.damageOutcome){const outcome=parseOutcome(own(input.damageOutcome)),serial=raidSerial(outcome);if(outcome.worldKey!==null&&outcome.worldKey!==s.worldKey)throw Error('Building ignition belongs to another world.');
  if(outcome.settledMinute>target)throw Error('Raid ignition has not happened yet.');
  if(serial>lastRaidSerial&&!pending.some(c=>c.kind==='raid'&&raidSerial(c.value)===serial)){
   if(outcome.settledMinute<s.absoluteMinute){if(pending.some(c=>c.kind==='raid'&&raidSerial(c.value)<serial))throw Error('A late raid would supersede an already queued ignition.');lastRaidSerial=serial;generation++;retain(outcome,'late');}else pending.push({kind:'raid',atMinute:outcome.settledMinute,value:outcome});
  }
 }
 for(const kind of['firefighting','repair']as const)for(const raw of kind==='firefighting'?input.firefighting??[]:input.repairs??[]){const d=parseDelivery(own(raw),kind,s.worldKey),operation=operationKey(d);if(knownReceipts.has(d.id)||knownOperations.has(operation))continue;
  if(d.atMinute<s.absoluteMinute||d.atMinute>target)throw Error('Building work cannot be backdated or delivered before arrival.');if(exactSource(d.binding)===undefined)throw Error('Building operation source does not match the saved catalogue.');
  if(deliveryIds.length>=R.maxReceipts)throw Error('Building operation receipt capacity exhausted; preserve this state.');knownReceipts.add(d.id);knownOperations.add(operation);deliveryIds.push(d.id);operationIds.push(operation);pending.push({kind,atMinute:d.atMinute,value:d}as PendingCommand);generation++;
 }
 for(const raw of input.weather??[]){const w=parseWeather(own(raw));if(w.atMinute<s.absoluteMinute)continue;if(w.atMinute>target)throw Error('Weather sample exceeds the requested authored time.');const old=weather.find(v=>v.atMinute===w.atMinute);if(old){if(JSON.stringify(old)!==JSON.stringify(w))throw Error('Conflicting historical weather sample.');}else{weather.push(w);generation++;}}
 if(pending.length>R.maxPending||weather.length>R.maxPending)throw Error('Pending building fire budget exhausted; preserve this state.');pending.sort(compareCommand);weather.sort((a,b)=>a.atMinute-b.atMinute);deliveryIds.sort(order);operationIds.sort(order);
 let serialOrder=lastRaidSerial;for(const c of pending)if(c.kind==='raid'){if(raidSerial(c.value)<=serialOrder)throw Error('Queued raid serials do not follow authored event time.');serialOrder=raidSerial(c.value);}
 function commandsAt(minute:number) {
  while(pending[0]?.atMinute===minute){const c=pending.shift()!;if(c.kind==='raid'){
   const o=c.value,serial=raidSerial(o);if(serial<=lastRaidSerial)continue;lastRaidSerial=serial;generation++;
   if(o.outcome!=='burned')continue;if(!o.binding){retain(o,'unbound');continue;}const i=exactSource(o.binding);if(i===undefined){retain(o,'source-unavailable');continue;}
   const old=buildings[i];if(old.phase==='burning'||old.fuelRemaining===0)continue;const b=ignite(old,minute,o,null);buildings[i]=b;events.push(event('ignition',minute,b,'raid'));
  }else{const i=exactSource(c.value.binding)!;let b=buildings[i];if(c.kind==='firefighting'){
    b={...b,heat:Math.max(0,b.heat-c.value.water*4)};if(b.phase==='burning'){b={...b,intensity:Math.max(0,b.intensity-c.value.water*4)};if(b.intensity===0){b={...b,phase:'extinguished',extinguishedAtMinute:minute};events.push(event('extinguishing',minute,b,'firefighting'));}}buildings[i]=b;
   }else if(b.phase!=='burning'&&b.phase!=='sound'){
    b={...b,repairLabour:Math.min(BUILDING_REBUILD_LABOUR_MINUTES,b.repairLabour+c.value.labourMinutes),repairTimber:Math.min(BUILDING_REBUILD_TIMBER,b.repairTimber+c.value.timber)};
    if(b.repairLabour===BUILDING_REBUILD_LABOUR_MINUTES&&b.repairTimber===BUILDING_REBUILD_TIMBER){events.push(event('repaired',minute,b,'repair'));b={...initialRecord(b.binding),rebuiltAtMinute:minute};}buildings[i]=b;
   }
  }}
 }
 commandsAt(s.absoluteMinute);const graph=adjacency(s.catalogue);
 for(let minute=s.absoluteMinute;minute<to;minute++){
  const w=weather[0]?.atMinute===minute?weather.shift()!:sampleBuildingConflagrationWeather(s.worldKey,minute),old=buildings.map(b=>b),gains=buildings.map(()=>0),origins:(number|null)[]=buildings.map(()=>null),originGains=buildings.map(()=>0);
  for(let i=0;i<old.length;i++){const b=old[i];if(b.phase!=='burning'||!b.ignition)continue;
   for(const edge of graph[i]){const target=old[edge.index];if(target.phase==='burning'||target.fuelRemaining===0)continue;
    const factorKey=`${b.ignition.outcome.raidId}:${i}:${edge.index}`;let jitter=spreadFactors.get(factorKey);if(jitter===undefined){jitter=850+hash(`${s.seed}:${b.ignition.outcome.raidId}:${sourceKeys[i]}:${sourceKeys[edge.index]}`)%301;spreadFactors.set(factorKey,jitter);}const wind=Math.max(300,1000+Math.round((edge.dx*w.windX+edge.dz*w.windZ)*.7));
    const gain=Math.round(150*edge.exposure/1000*b.intensity/1000*(1000-w.rain)/1000*wind/1000*jitter/1000);gains[edge.index]=Math.min(10000,gains[edge.index]+gain);if(gain>originGains[edge.index]){origins[edge.index]=i;originGains[edge.index]=gain;}
   }
  }
  for(let i=0;i<old.length;i++){let b=old[i];if(b.phase==='burning'){
    const intensity=Math.max(0,Math.min(1000,b.intensity+40-Math.round(w.rain*.10))),fuelRemaining=Math.max(0,b.fuelRemaining-15-Math.round(b.intensity*.03)),structuralDamage=Math.min(1000,b.structuralDamage+Math.max(1,Math.round(b.intensity*.042*(1-w.rain/1600))));
    b={...b,intensity,fuelRemaining,structuralDamage};if(b.collapsedAtMinute===null&&structuralDamage>=R.collapseDamage){b={...b,collapsedAtMinute:minute+1};events.push(event('collapse',minute+1,b,'fuel'));}
    if(fuelRemaining===0){b={...b,phase:'charred',intensity:0,heat:0,extinguishedAtMinute:minute+1};events.push(event('extinguishing',minute+1,b,'fuel'));}
    else if(intensity===0){b={...b,phase:'extinguished',heat:0,extinguishedAtMinute:minute+1};events.push(event('extinguishing',minute+1,b,'rain'));}
   }else if(b.fuelRemaining>0){const heat=Math.max(0,b.heat+gains[i]-20-Math.round(w.rain*.08)),source=origins[i];
    if(heat>=R.ignitionHeat&&source!==null){b=ignite(b,minute+1,old[source].ignition!.outcome,old[source].binding);events.push(event('spread',minute+1,b,'spread'));}else b={...b,heat:Math.min(R.ignitionHeat-1,heat)};
   }buildings[i]=b;
  }
  generation++;commandsAt(minute+1);
 }
 const changed=generation!==s.generation||lastRaidSerial!==s.lastRaidSerial||pending.length!==s.pending.length;
 const state=changed?finish({...s,absoluteMinute:to,generation:integer(generation),lastRaidSerial,buildings,pending,weather,deliveryIds,operationIds,retainedOutcomes}):s;
 return freeze({state,events,processedMinutes:to-s.absoluteMinute,remainingMinutes:target-to});
}

export type BuildingConflagrationRestore={readonly status:'valid';readonly state:BuildingConflagrationState}|{readonly status:'invalid';readonly raw:unknown;readonly error:string};
export function restoreBuildingConflagration(value:unknown,expectedWorldKey?:string):BuildingConflagrationRestore {try{return{status:'valid',state:parseBuildingConflagration(value,expectedWorldKey)};}catch(error){return{status:'invalid',raw:value,error:String(error)};}}
export function serializeBuildingConflagrationRestore(value:BuildingConflagrationRestore):unknown {return value.status==='invalid'?copyObserverJSON(value.raw):parseBuildingConflagration(value.state);}

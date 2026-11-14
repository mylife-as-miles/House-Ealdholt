/** Persistent source-bound raid damage and finite neighbouring-house repair aid.
 * This owns no source meshes, population identities, navigation or wall clock.
 * Labour is explicitly the already narrated visiting aid party, not stolen
 * minutes or invented work/arrival from the 100 registered residents. */
import {copyObserverJSON} from './observer-json';
export interface BuildingDamageBinding {
  readonly catalogueId:string;
  readonly sourceSha256:string;
  readonly profile:'desktop'|'quest';
  readonly buildingId:string;
  readonly siteIndex:number;
}
export interface BuildingRebuild {
  readonly crewId:string;
  readonly startedMinute:number;
  readonly labourRequired:number;
  readonly labourDone:number;
  readonly timberCommitted:number;
}
export interface BuildingConditionRecord {
  readonly binding:BuildingDamageBinding;
  readonly label:string;
  readonly condition:'burned'|'rebuilding'|'sound';
  readonly burnedAtMinute:number;
  readonly lastRaidId:string;
  readonly rebuild:BuildingRebuild|null;
  readonly rebuiltAtMinute:number|null;
}
export interface BuildingRepairCrew {
  readonly id:string;
  readonly houseId:string;
  readonly houseLabel:string;
  readonly workers:number;
  readonly labourRemaining:number;
  readonly assignedBuildingKey:string|null;
}
export interface VillageBuildingDamageState {
  readonly kind:'village-building-damage';readonly schemaVersion:1;
  readonly worldKey:string;readonly generation:number;readonly absoluteMinute:number;
  readonly lastRaidSerial:number;readonly lastAidSerial:number;
  readonly lastRaidOutcome:'repelled'|'plundered'|'burned'|null;
  readonly timber:number;
  readonly crews:readonly BuildingRepairCrew[];
  readonly buildings:readonly BuildingConditionRecord[];
}
export interface BuildingRaidOutcome {
  readonly worldKey:string|null;
  readonly raidId:string;readonly startMinute:number;readonly settledMinute:number;
  readonly outcome:'repelled'|'plundered'|'burned';
  readonly binding:BuildingDamageBinding|null;
  readonly targetLabel:string;
}
export interface BuildingAidDelivery {
  readonly worldKey:string;
  readonly raidId:string;readonly deliveredMinute:number;
  readonly houseId:string;readonly houseLabel:string;
  readonly timber:number;readonly workers:number;readonly labourMinutes:number;
}
export const BUILDING_REBUILD_TIMBER=12;
export const BUILDING_REBUILD_LABOUR_MINUTES=180;
export const BUILDING_AID_TIMBER=12;
export const BUILDING_AID_WORKERS=2;
export const BUILDING_AID_LABOUR_MINUTES=240;
export const BUILDING_REBUILD_DAY_START=8*60;
export const BUILDING_REBUILD_DAY_END=18*60;

const MAX_VALUE=1_000_000_000,MAX_BUILDINGS=512,MAX_CREWS=64;
const trusted=new WeakSet<object>();
const integer=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
function requireInteger(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number{if(!integer(v,min,max))throw Error('Building state needs bounded integer values.');return v;}
function text(v:unknown,max=200):string{if(typeof v!=='string'||!v||v.length>max||v.trim()!==v||/[\u0000-\u001f\u007f]/u.test(v))throw Error('Building state needs explicit bounded identities.');return v;}
function freeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function own(value:unknown,budget={left:100000},depth=0):any{
  if(--budget.left<0||depth>16)throw Error('Building save exceeds its bounded data shape.');
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object')throw Error('Building saves contain finite plain data.');
  if(Array.isArray(value)){if(value.length>4096)throw Error('Building array exceeds its budget.');
    if(Reflect.ownKeys(value).some(k=>k!=='length'&&(typeof k!=='string'||!/^(0|[1-9]\d*)$/u.test(k)||Number(k)>=value.length)))throw Error('Unknown building array fields.');
    return Array.from({length:value.length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!('value'in d))throw Error('Building data cannot contain getters/holes.');return own(d.value,budget,depth+1);});}
  const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype&&prototype!==null)throw Error('Building records must be plain data.');
  const out:Record<string,unknown>={};for(const key of Reflect.ownKeys(value)){if(typeof key!=='string')throw Error('Building keys must be strings.');const d=Object.getOwnPropertyDescriptor(value,key)!;if(!d.enumerable||!('value'in d))throw Error('Building data cannot contain accessors.');Object.defineProperty(out,key,{value:own(d.value,budget,depth+1),enumerable:true,writable:true,configurable:true});}return out;
}
function keys(v:any,names:readonly string[]):void{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==names.length||names.some(k=>!Object.prototype.hasOwnProperty.call(v,k)))throw Error('Unknown or missing building data fields.');}
export function parseBuildingDamageBinding(value:unknown):BuildingDamageBinding{
  const b=own(value);keys(b,['catalogueId','sourceSha256','profile','buildingId','siteIndex']);
  text(b.catalogueId,200);text(b.buildingId,500);if(typeof b.sourceSha256!=='string'||!/^[a-f0-9]{64}$/u.test(b.sourceSha256)||!['desktop','quest'].includes(b.profile))throw Error('Building source identity is invalid.');
  requireInteger(b.siteIndex,0,4095);return freeze(b);
}
/** Exact source ownership. The traversal-ranked site index alone is never an identity. */
export function buildingDamageKey(binding:BuildingDamageBinding):string{const b=parseBuildingDamageBinding(binding);return JSON.stringify([b.catalogueId,b.sourceSha256,b.profile,b.buildingId]);}
function raidIdentity(id:unknown):{serial:number;minute:number}{const match=/^raid-(\d+)-(\d+)$/u.exec(text(id,60));if(!match)throw Error('Damage/aid must retain the actual raid identity.');return{minute:requireInteger(Number(match[1])),serial:requireInteger(Number(match[2]))};}

export function createVillageBuildingDamage(worldKey:string,absoluteMinute:number,alreadyIssuedRaids=0):VillageBuildingDamageState{
  const serial=requireInteger(alreadyIssuedRaids)-1;
  const state:VillageBuildingDamageState={kind:'village-building-damage',schemaVersion:1,worldKey:text(worldKey,2048),generation:0,absoluteMinute:requireInteger(absoluteMinute),lastRaidSerial:serial,lastAidSerial:serial,lastRaidOutcome:null,timber:0,crews:[],buildings:[]};
  trusted.add(state);return freeze(state);
}
export function parseVillageBuildingDamage(value:unknown,expectedWorldKey?:string):VillageBuildingDamageState{
  if(value&&typeof value==='object'&&trusted.has(value)){const state=value as VillageBuildingDamageState;if(expectedWorldKey!==undefined&&state.worldKey!==expectedWorldKey)throw Error('Building save belongs to another world.');return state;}
  const s=own(value);keys(s,['kind','schemaVersion','worldKey','generation','absoluteMinute','lastRaidSerial','lastAidSerial','lastRaidOutcome','timber','crews','buildings']);
  if(s.kind!=='village-building-damage'||s.schemaVersion!==1)throw Error('Unsupported building save version.');text(s.worldKey,2048);
  if(expectedWorldKey!==undefined&&s.worldKey!==expectedWorldKey)throw Error('Building save belongs to another world.');
  requireInteger(s.generation);requireInteger(s.absoluteMinute);requireInteger(s.lastRaidSerial,-1);requireInteger(s.lastAidSerial,-1,s.lastRaidSerial);requireInteger(s.timber,0,MAX_VALUE);
  if(s.lastRaidOutcome!==null&&!['repelled','plundered','burned'].includes(s.lastRaidOutcome)||s.lastRaidSerial===-1&&s.lastRaidOutcome!==null)throw Error('Invalid settled raid outcome watermark.');
  if(!Array.isArray(s.crews)||s.crews.length>MAX_CREWS||!Array.isArray(s.buildings)||s.buildings.length>MAX_BUILDINGS)throw Error('Building/crew save capacity exceeded.');
  const crewIds=new Set<string>(),buildingIds=new Set<string>();
  for(const c of s.crews){keys(c,['id','houseId','houseLabel','workers','labourRemaining','assignedBuildingKey']);text(c.id,120);text(c.houseId,120);text(c.houseLabel,160);
    if(c.id!==c.houseId||crewIds.has(c.id)||c.workers!==BUILDING_AID_WORKERS)throw Error('Invalid or duplicate repair crew.');crewIds.add(c.id);requireInteger(c.labourRemaining,0,MAX_VALUE);if(c.assignedBuildingKey!==null)text(c.assignedBuildingKey,1200);}
  for(const b of s.buildings){keys(b,['binding','label','condition','burnedAtMinute','lastRaidId','rebuild','rebuiltAtMinute']);b.binding=parseBuildingDamageBinding(b.binding);text(b.label,160);const key=buildingDamageKey(b.binding);
    if(buildingIds.has(key)||!['burned','rebuilding','sound'].includes(b.condition))throw Error('Invalid or duplicate building condition.');buildingIds.add(key);requireInteger(b.burnedAtMinute,0,s.absoluteMinute);
    const raid=raidIdentity(b.lastRaidId);if(raid.serial>s.lastRaidSerial||raid.minute>b.burnedAtMinute)throw Error('Building damage precedes its raid.');
    if(b.condition==='sound'){if(b.rebuild!==null)throw Error('Sound building cannot retain a running repair.');requireInteger(b.rebuiltAtMinute,b.burnedAtMinute,s.absoluteMinute);}
    else{if(b.rebuiltAtMinute!==null)throw Error('Unrepaired building cannot claim completion.');if(b.condition==='burned'&&b.rebuild!==null)throw Error('Burned building has no active crew.');}
    if(b.condition==='rebuilding'){const r=b.rebuild;keys(r,['crewId','startedMinute','labourRequired','labourDone','timberCommitted']);text(r.crewId,120);requireInteger(r.startedMinute,b.burnedAtMinute,s.absoluteMinute);
      if(r.labourRequired!==BUILDING_REBUILD_LABOUR_MINUTES||r.timberCommitted!==BUILDING_REBUILD_TIMBER)throw Error('Repair costs differ from the published rules.');requireInteger(r.labourDone,0,r.labourRequired-1);
      const crew=s.crews.find((c:BuildingRepairCrew)=>c.id===r.crewId);if(!crew||crew.assignedBuildingKey!==key||crew.labourRemaining<r.labourRequired-r.labourDone)throw Error('Repair crew/capacity is not exclusively reserved.');}
  }
  for(const c of s.crews)if(c.assignedBuildingKey!==null&&!s.buildings.some((b:BuildingConditionRecord)=>buildingDamageKey(b.binding)===c.assignedBuildingKey&&b.condition==='rebuilding'&&b.rebuild?.crewId===c.id))throw Error('Crew holds an absent repair.');
  trusted.add(s);return freeze(s);
}
function next(state:VillageBuildingDamageState,patch:Partial<VillageBuildingDamageState>,generation=1):VillageBuildingDamageState{
  requireInteger(state.generation+generation);const result={...state,...patch,generation:state.generation+generation};trusted.add(result);return freeze(result);
}
/** Number of complete scheduled working minutes before t, independent of render cadence. */
function workingBefore(t:number):number{const days=Math.floor(t/1440),minute=t-days*1440;return days*(BUILDING_REBUILD_DAY_END-BUILDING_REBUILD_DAY_START)+Math.max(0,Math.min(BUILDING_REBUILD_DAY_END-BUILDING_REBUILD_DAY_START,minute-BUILDING_REBUILD_DAY_START));}
function finishMinute(from:number,to:number,workers:number,labour:number):number{let low=from,high=to;while(low<high){const middle=low+Math.floor((high-low)/2);if((workingBefore(middle)-workingBefore(from))*workers>=labour)high=middle;else low=middle+1;}return low;}
/** Finite visiting aid parties work08–18. This never changes registered residents,
 * proves geometry/arrival, or counts paused/overnight time as rebuilding labour. */
export function advanceVillageBuildingDamage(value:VillageBuildingDamageState,absoluteMinute:number):VillageBuildingDamageState{
  const s=parseVillageBuildingDamage(value),at=requireInteger(absoluteMinute);if(at<s.absoluteMinute)throw Error('Building time cannot rewind.');if(at===s.absoluteMinute)return s;
  const crews=s.crews.map(c=>({...c}));
  const buildings=s.buildings.map(b=>{if(b.condition!=='rebuilding'||!b.rebuild)return b;const crew=crews.find(c=>c.id===b.rebuild!.crewId)!;
    const remaining=b.rebuild.labourRequired-b.rebuild.labourDone,minutes=workingBefore(at)-workingBefore(s.absoluteMinute);
    const earned=minutes>=Math.ceil(remaining/crew.workers)?remaining:minutes*crew.workers;if(!earned)return b;
    crew.labourRemaining-=earned;
    if(earned===remaining){crew.assignedBuildingKey=null;return{...b,condition:'sound' as const,rebuild:null,rebuiltAtMinute:finishMinute(s.absoluteMinute,at,crew.workers,remaining)};}
    return{...b,rebuild:{...b.rebuild,labourDone:b.rebuild.labourDone+earned}};
  });
  return next(s,{absoluteMinute:at,crews,buildings},at-s.absoluteMinute);
}

/** Consume an outcome at its authored settlement minute BEFORE catching up repair
 * labour. Serial watermarks survive the six-entry raid-history limit forever. */
export function settleVillageBuildingRaid(value:VillageBuildingDamageState,outcome:BuildingRaidOutcome,absoluteMinute:number):VillageBuildingDamageState{
  const s=parseVillageBuildingDamage(value),at=requireInteger(absoluteMinute),r=own(outcome);keys(r,['worldKey','raidId','startMinute','settledMinute','outcome','binding','targetLabel']);text(r.targetLabel,160);
  if(r.worldKey!==null&&r.worldKey!==s.worldKey||r.worldKey===null&&r.binding!==null)throw Error('Raid damage belongs to another or unknown world.');
  const identity=raidIdentity(r.raidId);if(identity.minute!==r.startMinute||!['repelled','plundered','burned'].includes(r.outcome))throw Error('Invalid settled building raid.');requireInteger(r.startMinute);requireInteger(r.settledMinute,r.startMinute);
  if(r.binding!==null)r.binding=parseBuildingDamageBinding(r.binding);
  if(identity.serial<=s.lastRaidSerial||r.settledMinute>at)return advanceVillageBuildingDamage(s,at);
  if(r.settledMinute<s.absoluteMinute)throw Error('A late new damage outcome cannot rewrite already advanced repair history.');
  let state=advanceVillageBuildingDamage(s,r.settledMinute);const buildings=[...state.buildings],crews=state.crews.map(c=>({...c}));
  if(r.outcome==='burned'&&r.binding){const key=buildingDamageKey(r.binding),index=buildings.findIndex(b=>buildingDamageKey(b.binding)===key),old=buildings[index];
    if(old?.rebuild){const crew=crews.find(c=>c.id===old.rebuild!.crewId)!;crew.assignedBuildingKey=null;}
    const condition:BuildingConditionRecord={binding:r.binding,label:r.targetLabel,condition:'burned',burnedAtMinute:r.settledMinute,lastRaidId:r.raidId,rebuild:null,rebuiltAtMinute:null};
    if(index<0){if(buildings.length>=MAX_BUILDINGS)throw Error('Building condition capacity exhausted; retain existing state.');buildings.push(condition);}else buildings[index]=condition;
  }
  state=next(state,{lastRaidSerial:identity.serial,lastRaidOutcome:r.outcome,buildings,crews});return advanceVillageBuildingDamage(state,at);
}
export function receiveBuildingAid(value:VillageBuildingDamageState,delivery:BuildingAidDelivery):VillageBuildingDamageState{
  const s=parseVillageBuildingDamage(value),d=own(delivery);keys(d,['worldKey','raidId','deliveredMinute','houseId','houseLabel','timber','workers','labourMinutes']);if(d.worldKey!==s.worldKey)throw Error('Repair aid belongs to another world.');const raid=raidIdentity(d.raidId);
  requireInteger(d.deliveredMinute,raid.minute);text(d.houseId,120);text(d.houseLabel,160);
  if(d.timber!==BUILDING_AID_TIMBER||d.workers!==BUILDING_AID_WORKERS||d.labourMinutes!==BUILDING_AID_LABOUR_MINUTES)throw Error('Unknown neighbour repair-aid allocation.');
  if(raid.serial<=s.lastAidSerial)return s;if(raid.serial!==s.lastRaidSerial||s.lastRaidOutcome!=='burned')throw Error('Aid requires its current settled burned-raid receipt first.');
  if(!s.buildings.some(b=>b.lastRaidId===d.raidId))return next(s,{lastAidSerial:raid.serial});
  if(d.deliveredMinute<s.absoluteMinute)throw Error('A late aid delivery cannot backdate work.');const state=advanceVillageBuildingDamage(s,d.deliveredMinute);
  const crews=state.crews.map(c=>({...c})),crew=crews.find(c=>c.id===d.houseId);
  requireInteger(state.timber+d.timber,0,MAX_VALUE);
  if(crew){requireInteger(crew.labourRemaining+d.labourMinutes,0,MAX_VALUE);crew.labourRemaining+=d.labourMinutes;crew.houseLabel=d.houseLabel;}
  else{if(crews.length>=MAX_CREWS)throw Error('Neighbour repair-crew capacity exhausted.');crews.push({id:d.houseId,houseId:d.houseId,houseLabel:d.houseLabel,workers:d.workers,labourRemaining:d.labourMinutes,assignedBuildingKey:null});}
  return next(state,{lastAidSerial:raid.serial,timber:state.timber+d.timber,crews});
}
export type BuildingRebuildResult={readonly ok:true;readonly state:VillageBuildingDamageState}|{readonly ok:false;readonly state:VillageBuildingDamageState;readonly reason:string};
export function buildingRebuildAvailability(value:VillageBuildingDamageState,buildingKey:string,crewId:string):{readonly available:boolean;readonly reason:string|null;readonly timberCost:number;readonly labourCost:number}{
  const s=parseVillageBuildingDamage(value),building=s.buildings.find(b=>buildingDamageKey(b.binding)===buildingKey),crew=s.crews.find(c=>c.id===crewId);
  const fail=(reason:string)=>({available:false,reason,timberCost:BUILDING_REBUILD_TIMBER,labourCost:BUILDING_REBUILD_LABOUR_MINUTES});
  if(!building)return fail('Building is not a saved source-bound raid victim.');if(building.condition!=='burned')return fail(building.condition==='sound'?'Building is already sound.':'Rebuilding is already assigned.');
  if(s.timber<BUILDING_REBUILD_TIMBER)return fail(`Needs ${BUILDING_REBUILD_TIMBER} timber.`);if(!crew)return fail('No named neighbouring repair party is available.');
  if(crew.assignedBuildingKey!==null)return fail('This repair party is already assigned.');if(crew.labourRemaining<BUILDING_REBUILD_LABOUR_MINUTES)return fail(`Needs ${BUILDING_REBUILD_LABOUR_MINUTES} worker-minutes of aid.`);
  return{available:true,reason:null,timberCost:BUILDING_REBUILD_TIMBER,labourCost:BUILDING_REBUILD_LABOUR_MINUTES};
}
export function startBuildingRebuild(value:VillageBuildingDamageState,buildingKey:string,crewId:string):BuildingRebuildResult{
  const s=parseVillageBuildingDamage(value),eligibility=buildingRebuildAvailability(s,buildingKey,crewId);
  if(!eligibility.available)return{ok:false,state:s,reason:eligibility.reason!};
  const building=s.buildings.find(b=>buildingDamageKey(b.binding)===buildingKey)!,crew=s.crews.find(c=>c.id===crewId)!;
  const buildings=s.buildings.map(b=>b!==building?b:{...b,condition:'rebuilding' as const,rebuild:{crewId:crew.id,startedMinute:s.absoluteMinute,labourRequired:BUILDING_REBUILD_LABOUR_MINUTES,labourDone:0,timberCommitted:BUILDING_REBUILD_TIMBER}});
  const crews=s.crews.map(c=>c!==crew?c:{...c,assignedBuildingKey:buildingKey});return{ok:true,state:next(s,{buildings,crews,timber:s.timber-BUILDING_REBUILD_TIMBER})};
}
/** New local work orders reserve existing stock without assigning or accruing
 * an abstract aid crew. The transaction owner must persist its matching order. */
export function reserveLocalBuildingTimber(value:VillageBuildingDamageState):VillageBuildingDamageState{
  const s=parseVillageBuildingDamage(value);
  if(s.timber<BUILDING_REBUILD_TIMBER)throw Error(`Needs ${BUILDING_REBUILD_TIMBER} timber.`);
  return next(s,{timber:s.timber-BUILDING_REBUILD_TIMBER});
}
/** One owner poll: process genuinely reported events chronologically, then catch
 * up finite labour. No callback, render cadence, wall clock or new event exists. */
export function stepVillageBuildingDamage(value:VillageBuildingDamageState,input:{readonly absoluteMinute:number;readonly damageOutcome?:BuildingRaidOutcome|null;readonly rebuildingAid?:BuildingAidDelivery|null}):VillageBuildingDamageState{
  let s=parseVillageBuildingDamage(value);const at=requireInteger(input.absoluteMinute);if(at<s.absoluteMinute)throw Error('Building time cannot rewind.');
  const outcome=input.damageOutcome;if(outcome)s=settleVillageBuildingRaid(s,outcome,Math.max(s.absoluteMinute,Math.min(at,outcome.settledMinute)));
  if(input.rebuildingAid){if(input.rebuildingAid.deliveredMinute>at)throw Error('Neighbour aid has not arrived yet.');s=receiveBuildingAid(s,input.rebuildingAid);}
  return advanceVillageBuildingDamage(s,at);
}
/** No place IDs are derived from bearings, door distances, labels or rank indices.
 * Callers may intersect these source-bound victims with separately certified
 * source-building/place associations; absent that proof, homes/jobs stay held. */
export function unavailableDamagedBuildingBindings(value:VillageBuildingDamageState):readonly BuildingDamageBinding[]{return Object.freeze(parseVillageBuildingDamage(value).buildings.filter(b=>b.condition!=='sound').map(b=>b.binding));}

export type BuildingDamageRestore={readonly status:'valid';readonly state:VillageBuildingDamageState}|{readonly status:'invalid';readonly raw:unknown;readonly error:string};
export function restoreBuildingDamage(value:unknown,expectedWorldKey?:string):BuildingDamageRestore{
  try{return{status:'valid',state:parseVillageBuildingDamage(value,expectedWorldKey)};}catch(error){return{status:'invalid',raw:value,error:String(error)};}
}
/** A corrupt/foreign new field is preserved for recovery, never replaced by an
 * empty village. The caller must hold damage/rebuild commands while invalid. */
export function serializeBuildingDamageRestore(value:BuildingDamageRestore):unknown{return value.status==='invalid'?copyObserverJSON(value.raw):parseVillageBuildingDamage(value.state);}

/** Factual, resident-local interruptions. Knowledge survives visual streaming;
 * it does not grant access to a live enemy transform, player identity, damage,
 * deaths, reputation or a global omniscient threat list. */
import { placeDataArray, placeDataRecord } from '../place-use';
import type { VillageLifeIntent } from './village-life';

export interface ResidentSafetySignal {
  readonly id:string; readonly kind:'fire'|'violence'|'hazard'|'all-clear';
  readonly channel:'witness'|'report'|'alarm'; readonly knownByResidentIds:readonly string[];
  readonly placeId:string; readonly observedAbsoluteMinute:number; readonly expiresAbsoluteMinute:number;
  readonly affectedResidentIds:readonly string[]; readonly shelterPlaceId?:string|null;
  readonly lastKnownPosition?:readonly [number,number,number]; readonly resolvesSignalId?:string;
}
export interface ResidentSafetyState {
  readonly schemaVersion:1; readonly residentId:string; readonly lastAbsoluteMinute:number;
  readonly mode:'routine'|'shelter'|'protect'|'watch'; readonly knownSignals:readonly ResidentSafetySignal[];
  readonly recentSignalIds:readonly string[]; readonly activeSignalId:string|null;
  readonly interruptedIntent:VillageLifeIntent|null; readonly currentIntent:VillageLifeIntent|null;
  readonly nextRepathAbsoluteMinute:number;
}
export interface ResidentSafetyInput {
  readonly state:ResidentSafetyState; readonly absoluteMinute:number;
  readonly resident:{readonly residentId:string;readonly householdId:string;readonly homePlaceId:string;
    readonly ageYears:number;readonly roleId:string;readonly kinIds:readonly string[]};
  readonly routineIntent:VillageLifeIntent; readonly signals:readonly ResidentSafetySignal[];
  readonly unavailablePlaceIds?:readonly string[];
}
export const RESIDENT_SAFETY_REPATH_MINUTES=2;
const MAX_KNOWN=16,MAX_RECENT=64;
const guards=new Set(['guard-captain','guard-serjeant','gate-ward','spearman','night-spearman','lookout-archer','guard-recruit']);
const trusted=new WeakSet<object>();
/** Only our descriptor-checked, deep-frozen owned copies enter this set. An
 * arbitrary caller's Object.freeze() never bypasses source-data validation. */
const trustedSignals=new WeakSet<object>();
const integer=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value&&!/[\u0000-\u001f\u007f]/u.test(value);
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
function ids(value:unknown,max=100):readonly string[] {
  const array=placeDataArray(value);if(array.length>max||array.some(v=>!id(v))||new Set(array).size!==array.length)throw Error('Invalid bounded safety identities.');
  return array as readonly string[];
}
function freeze<T>(value:T):T {
  if(Array.isArray(value))return Object.freeze(value.map(freeze)) as T;
  if(value&&typeof value==='object')return Object.freeze(Object.fromEntries(Object.entries(value).map(([key,item])=>[key,freeze(item)]))) as T;
  return value;
}
function finish(state:ResidentSafetyState):ResidentSafetyState {
  const result=freeze(state);trusted.add(result);for(const known of result.knownSignals)trustedSignals.add(known);return result;
}
function intent(value:unknown,residentId:string,minute:number):VillageLifeIntent {
  const r=placeDataRecord(value,['residentId','activityKey','targetPlaceId','activity','priority','issuedAbsoluteMinute','indoor','companionIds','reason']);
  if(r.residentId!==residentId||!id(r.targetPlaceId)||!['sleep','meal','work','care','visit','social','patrol','travel','rest','shelter','protect','home'].includes(r.activityKey as string)
    ||typeof r.activity!=='string'||r.activity.length>2048||typeof r.priority!=='number'||!Number.isFinite(r.priority)
    ||!integer(r.issuedAbsoluteMinute)||r.issuedAbsoluteMinute>minute||typeof r.indoor!=='boolean'
    ||!['routine','family-meal','family-care','family-visit','household-protection','weather','needs','safety'].includes(r.reason as string))throw Error('Invalid saved safety intent.');
  ids(r.companionIds);return value as VillageLifeIntent;
}
function signal(value:unknown):ResidentSafetySignal {
  if(value&&typeof value==='object'&&trustedSignals.has(value))return value as ResidentSafetySignal;
  const r=placeDataRecord(value,['id','kind','channel','knownByResidentIds','placeId','observedAbsoluteMinute','expiresAbsoluteMinute','affectedResidentIds'],['shelterPlaceId','lastKnownPosition','resolvesSignalId']);
  if(!id(r.id)||!id(r.placeId)||!['fire','violence','hazard','all-clear'].includes(r.kind as string)||!['witness','report','alarm'].includes(r.channel as string)
    ||!integer(r.observedAbsoluteMinute)||!integer(r.expiresAbsoluteMinute)||r.expiresAbsoluteMinute<=r.observedAbsoluteMinute)throw Error('Invalid dated safety fact.');
  ids(r.knownByResidentIds);ids(r.affectedResidentIds);
  for(const key of ['shelterPlaceId','lastKnownPosition','resolvesSignalId'])if(Object.prototype.hasOwnProperty.call(r,key)&&r[key]===undefined)throw Error('Safety reports must contain finite JSON data.');
  if(r.shelterPlaceId!==undefined&&r.shelterPlaceId!==null&&!id(r.shelterPlaceId))throw Error('Invalid shelter identity.');
  if(r.resolvesSignalId!==undefined&&!id(r.resolvesSignalId))throw Error('Invalid resolved incident identity.');
  if(r.kind==='all-clear'&&!id(r.resolvesSignalId))throw Error('An all-clear must identify the incident it resolves.');
  if(r.lastKnownPosition!==undefined){const xyz=placeDataArray(r.lastKnownPosition);if(xyz.length!==3||xyz.some(n=>typeof n!=='number'||!Number.isFinite(n)))throw Error('Invalid last-known safety position.');}
  return value as ResidentSafetySignal;
}
/** Structural validation only. The life kernel additionally owns roster,
 * registered-place and received-clock checks before accepting a world fact. */
export function validateResidentSafetySignal(value:unknown):string|null {
  try{signal(value);return null;}catch(error){return error instanceof Error?error.message:'Invalid resident safety signal.';}
}
export function parseResidentSafetySignal(value:unknown):ResidentSafetySignal {
  if(value&&typeof value==='object'&&trustedSignals.has(value))return value as ResidentSafetySignal;
  const result=freeze(signal(value));trustedSignals.add(result);return result;
}
export function createResidentSafetyState(residentId:string,absoluteMinute:number):ResidentSafetyState {
  if(!id(residentId)||!integer(absoluteMinute))throw Error('Safety requires resident identity and an absolute world minute.');
  return finish({schemaVersion:1,residentId,lastAbsoluteMinute:absoluteMinute,mode:'routine',knownSignals:[],recentSignalIds:[],
    activeSignalId:null,interruptedIntent:null,currentIntent:null,nextRepathAbsoluteMinute:absoluteMinute});
}
export function validateResidentSafetyState(value:unknown,residentId:string,absoluteMinute:number):string|null {
  try {
    if(!integer(absoluteMinute))throw Error('Invalid safety validation minute.');
    const r=placeDataRecord(value,['schemaVersion','residentId','lastAbsoluteMinute','mode','knownSignals','recentSignalIds','activeSignalId','interruptedIntent','currentIntent','nextRepathAbsoluteMinute']);
    if(r.schemaVersion!==1||r.residentId!==residentId||!id(residentId)||!integer(r.lastAbsoluteMinute)||r.lastAbsoluteMinute>absoluteMinute
      ||!integer(r.nextRepathAbsoluteMinute)||!['routine','shelter','protect','watch'].includes(r.mode as string))throw Error('Invalid resident safety identity, clock or mode.');
    if(r.nextRepathAbsoluteMinute<r.lastAbsoluteMinute||r.nextRepathAbsoluteMinute>Math.min(Number.MAX_SAFE_INTEGER,r.lastAbsoluteMinute+RESIDENT_SAFETY_REPATH_MINUTES))throw Error('Saved safety cooldown exceeds the bounded replan interval.');
    const known=placeDataArray(r.knownSignals);if(known.length>MAX_KNOWN)throw Error('Too many remembered safety reports.');
    const seen=new Set<string>();for(const value of known){const s=signal(value);if(s.kind==='all-clear'||s.observedAbsoluteMinute>r.lastAbsoluteMinute||s.expiresAbsoluteMinute<=r.lastAbsoluteMinute||!s.knownByResidentIds.includes(residentId)||seen.has(s.id))throw Error('Safety knowledge lacks a current factual recipient.');seen.add(s.id);}
    ids(r.recentSignalIds,MAX_RECENT);
    if(r.activeSignalId!==null&&(!id(r.activeSignalId)||!seen.has(r.activeSignalId)))throw Error('Active safety incident is not known.');
    if(r.interruptedIntent!==null)intent(r.interruptedIntent,residentId,r.lastAbsoluteMinute);
    if(r.currentIntent!==null){const saved=intent(r.currentIntent,residentId,r.lastAbsoluteMinute);if(saved.reason!=='safety')throw Error('Safety overrides must retain their reason.');}
    if((r.mode==='routine')!==(r.currentIntent===null)||r.mode!=='routine'&&r.activeSignalId===null)throw Error('Inconsistent safety mode and intent.');
    return null;
  }catch(error){return error instanceof Error?error.message:'Invalid resident safety state.';}
}
/** Called by the authoritative minutely life reducer, including distant residents.
 * Signals must be explicit witnessed/reported facts; animation/navigation never
 * creates knowledge. A replan is bounded to once per two world minutes except
 * when the previously selected destination becomes unsafe or unavailable. */
export function advanceResidentSafety(input:ResidentSafetyInput):{state:ResidentSafetyState;intent:VillageLifeIntent|null} {
  const {state,resident,routineIntent}=input,minute=input.absoluteMinute;
  if(!integer(minute)||minute<state.lastAbsoluteMinute||resident.residentId!==state.residentId)throw Error('Safety cannot rewind or exchange resident identities.');
  if(!trusted.has(state)){const error=validateResidentSafetyState(state,resident.residentId,minute);if(error)throw Error(error);}
  const supplied=placeDataArray(input.signals);if(supplied.length>256)throw Error('Safety input exceeds the bounded report budget.');
  // No routine is read or persisted on this path, so it need not be parsed
  // again. This is the common far-simulation path for all 100 inhabitants.
  if(trusted.has(state)&&state.mode==='routine'&&!state.currentIntent&&!state.interruptedIntent
    &&state.knownSignals.length===0&&supplied.length===0){
    const quiet=Object.freeze({...state,lastAbsoluteMinute:minute,nextRepathAbsoluteMinute:minute});trusted.add(quiet);
    return {state:quiet,intent:null};
  }
  intent(routineIntent,resident.residentId,minute);
  const unavailable=new Set(input.unavailablePlaceIds??[]),kin=new Set(resident.kinIds),recent=[...state.recentSignalIds],remembered=new Map(state.knownSignals.filter(s=>s.expiresAbsoluteMinute>minute).map(s=>[s.id,s]));
  // All recipients receive the same order regardless of caller array order.
  const incoming=supplied.map(signal).filter(s=>s.knownByResidentIds.includes(resident.residentId)&&s.observedAbsoluteMinute<=minute&&s.expiresAbsoluteMinute>minute)
    .sort((a,b)=>a.observedAbsoluteMinute-b.observedAbsoluteMinute||Number(a.kind==='all-clear')-Number(b.kind==='all-clear')||compare(a.id,b.id));
  for(const s of incoming){
    if(recent.includes(s.id))continue;recent.push(s.id);
    if(s.kind==='all-clear')remembered.delete(s.resolvesSignalId!);else remembered.set(s.id,{...s,
      // The authoritative feed retains the full report. Resident-local safety
      // snapshots need only their recipient and relevant family identities;
      // copying a 100-person recipient list into every save would be quadratic.
      knownByResidentIds:[resident.residentId],affectedResidentIds:s.affectedResidentIds.filter(person=>person===resident.residentId||kin.has(person))});
  }
  const known=[...remembered.values()].sort((a,b)=>a.observedAbsoluteMinute-b.observedAbsoluteMinute||compare(a.id,b.id)).slice(-MAX_KNOWN);
  const hazardous=new Set(known.map(s=>s.placeId)),isGuard=resident.ageYears>=18&&guards.has(resident.roleId);
  const candidates=known.filter(s=>isGuard||s.affectedResidentIds.some(person=>person===resident.residentId||kin.has(person))
    ||s.placeId===resident.homePlaceId||s.placeId===routineIntent.targetPlaceId||s.placeId===state.currentIntent?.targetPlaceId);
  const score=(s:ResidentSafetySignal)=>(s.affectedResidentIds.includes(resident.residentId)?100:s.affectedResidentIds.some(person=>kin.has(person))?90:s.placeId===resident.homePlaceId?80:60)+(s.kind==='fire'?5:0);
  candidates.sort((a,b)=>score(b)-score(a)||a.observedAbsoluteMinute-b.observedAbsoluteMinute||compare(a.id,b.id));
  const previousStillKnown=state.activeSignalId!==null&&known.some(s=>s.id===state.activeSignalId),currentSafe=!!state.currentIntent
    &&!unavailable.has(state.currentIntent.targetPlaceId)&&!hazardous.has(state.currentIntent.targetPlaceId);
  if(previousStillKnown&&state.currentIntent&&minute<state.nextRepathAbsoluteMinute&&(currentSafe||state.mode==='watch'&&!unavailable.has(state.currentIntent.targetPlaceId))){
    return {state:finish({...state,lastAbsoluteMinute:minute,knownSignals:known,recentSignalIds:recent.slice(-MAX_RECENT)}),intent:state.currentIntent};
  }
  const active=candidates[0];
  if(!active){
    const resumed=state.interruptedIntent&&!unavailable.has(state.interruptedIntent.targetPlaceId)&&!hazardous.has(state.interruptedIntent.targetPlaceId)
      ?{...state.interruptedIntent,issuedAbsoluteMinute:minute}:null;
    return {state:finish({...state,lastAbsoluteMinute:minute,mode:'routine',knownSignals:known,recentSignalIds:recent.slice(-MAX_RECENT),
      activeSignalId:null,currentIntent:null,interruptedIntent:null,nextRepathAbsoluteMinute:minute}),intent:resumed};
  }
  const affectedKin=active.affectedResidentIds.filter(person=>kin.has(person)).sort(compare);
  const protect=resident.ageYears>=18&&affectedKin.length>0;
  const watch=isGuard&&!protect&&active.kind==='violence'&&!unavailable.has(active.placeId);
  const shelter=[active.shelterPlaceId,resident.homePlaceId,routineIntent.indoor?routineIntent.targetPlaceId:null]
    .find((place):place is string=>typeof place==='string'&&!unavailable.has(place)&&!hazardous.has(place));
  // No invented escape building or teleport: wait for a viable authored refuge.
  if(!watch&&!shelter)return {state:finish({...state,lastAbsoluteMinute:minute,mode:'routine',knownSignals:known,recentSignalIds:recent.slice(-MAX_RECENT),
    activeSignalId:null,currentIntent:null,interruptedIntent:state.interruptedIntent??routineIntent,nextRepathAbsoluteMinute:minute}),intent:null};
  const mode=watch?'watch':protect?'protect':'shelter';
  const next:VillageLifeIntent={residentId:resident.residentId,activityKey:watch?'patrol':protect?'protect':'shelter',
    targetPlaceId:watch?active.placeId:shelter!,activity:watch?'Keeps watch at the last reported incident location.':protect?'Helps known family members seek shelter.':'Seeks shelter from a known incident.',
    priority:100,issuedAbsoluteMinute:minute,indoor:!watch,companionIds:protect?affectedKin:[],reason:'safety'};
  return {state:finish({...state,lastAbsoluteMinute:minute,mode,knownSignals:known,recentSignalIds:recent.slice(-MAX_RECENT),activeSignalId:active.id,
    interruptedIntent:state.interruptedIntent??routineIntent,currentIntent:next,nextRepathAbsoluteMinute:Math.min(Number.MAX_SAFE_INTEGER,minute+RESIDENT_SAFETY_REPATH_MINUTES)}),intent:next};
}

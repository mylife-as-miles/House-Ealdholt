import {nightlyRaidMinute} from './bandit-raid';
import {copyObserverJSON} from './observer-json';

/** Which nightly candidates have actually been considered, not the last raid
 * that happened. Absolute world minutes come from the existing village clock. */
export interface ObserverRaidCursor {
  readonly kind:'observer-raid-cursor';readonly schemaVersion:1;
  readonly worldKey:string;readonly resolvedMinute:number;
}
export type ObserverRaidCursorRestore=
  |{readonly status:'valid';readonly state:ObserverRaidCursor}
  |{readonly status:'invalid';readonly raw:unknown;readonly error:string};
export interface ObserverNightlyDue {readonly day:number;readonly minute:number}
export interface ObserverNightlyPlan {
  readonly status:'migrated'|'ready'|'blocked';readonly error:string|null;
  readonly fromMinute:number;readonly processedMinute:number;readonly pendingMinutes:number;
  readonly due:readonly ObserverNightlyDue[];
  /** Proposed only: persist after all raid/aid/damage work through processedMinute
   * succeeds. A caller failure must keep the prior cursor and its pending days. */
  readonly cursor:ObserverRaidCursorRestore|undefined;
}
const MAX_MINUTE=Number.MAX_SAFE_INTEGER-4320;
function minute(v:unknown):v is number{return typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=MAX_MINUTE;}
function world(v:unknown):v is string{return typeof v==='string'&&v.length>0&&v.length<=2048&&v.trim()===v&&!/[\u0000-\u001f\u007f]/u.test(v);}
function copyJson(value:unknown,budget={left:4096},depth=0):unknown{
  if(--budget.left<0||depth>12)throw Error('Nightly cursor exceeds its bounded data shape.');
  if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
  if(typeof value==='string'){if(value.length>16384)throw Error('Nightly cursor string exceeds its budget.');return value;}
  if(!value||typeof value!=='object'||![Object.prototype,null,Array.prototype].includes(Object.getPrototypeOf(value)))throw Error('Nightly cursor requires plain JSON data.');
  const result:unknown[]|Record<string,unknown>=Array.isArray(value)?[]:{};
  for(const key of Object.keys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!('value'in d))throw Error('Nightly cursor cannot contain getters.');Object.defineProperty(result,key,{value:copyJson(d.value,budget,depth+1),enumerable:true,writable:true,configurable:true});}
  return result;
}
function parse(value:unknown,expectedWorldKey:string):ObserverRaidCursor{
  const raw=copyJson(value) as Record<string,unknown>;
  if(!raw||Array.isArray(raw)||Object.keys(raw).sort().join('|')!=='kind|resolvedMinute|schemaVersion|worldKey'||raw.kind!=='observer-raid-cursor'||raw.schemaVersion!==1||!world(raw.worldKey)||raw.worldKey!==expectedWorldKey||!minute(raw.resolvedMinute))throw Error('Nightly cursor is invalid or belongs to another world.');
  return Object.freeze({kind:'observer-raid-cursor',schemaVersion:1,worldKey:raw.worldKey,resolvedMinute:raw.resolvedMinute});
}
export function restoreObserverRaidCursor(value:unknown,expectedWorldKey:string):ObserverRaidCursorRestore{
  try{return{status:'valid',state:parse(value,expectedWorldKey)};}
  catch(error){let raw=value;try{raw=copyObserverJSON(value);}catch{/* Unsafe non-JSON records stay blocked and cannot be serialized. */}return{status:'invalid',raw,error:error instanceof Error?error.message:'Nightly cursor could not be read.'};}
}
export function serializeObserverRaidCursor(value:ObserverRaidCursorRestore):unknown{return value.status==='valid'?parse(value.state,value.state.worldKey):copyObserverJSON(value.raw);}

/** Bounded calendar planner shared by Desktop and Native. It owns no realm,
 * raid outcome, resident, storage, timer or render. Missing legacy cursors anchor
 * NOW, never day0 or lastRaidDay. Future gaps remain deferred until consumed. */
export function planObserverNightlyRaids(input:{readonly worldKey:string;readonly targetMinute:number;readonly cursor?:ObserverRaidCursorRestore;readonly damageMinute?:number;readonly maximumDays?:number}):ObserverNightlyPlan{
  const {worldKey,targetMinute,cursor,damageMinute}=input,maximumDays=input.maximumDays??4;
  const held=(error:string,from=0):ObserverNightlyPlan=>({status:'blocked',error,fromMinute:from,processedMinute:from,pendingMinutes:minute(targetMinute)?Math.max(0,targetMinute-from):0,due:[],cursor});
  if(!world(worldKey)||!minute(targetMinute)||!Number.isInteger(maximumDays)||maximumDays<1||maximumDays>16||damageMinute!==undefined&&!minute(damageMinute))return held('Nightly catch-up needs bounded world time and identity.');
  if(cursor?.status==='invalid')return held('Saved nightly cursor is invalid; its original record is preserved.');
  let state:ObserverRaidCursor|undefined;
  if(cursor)try{state=parse(cursor.state,worldKey);}catch{return held('Saved nightly cursor does not match this world.');}
  if(!state){
    if(damageMinute!==undefined&&damageMinute>targetMinute)return held('Saved building time is ahead of the authoritative clock.');
    const next:ObserverRaidCursor={kind:'observer-raid-cursor',schemaVersion:1,worldKey,resolvedMinute:targetMinute};
    return{status:'migrated',error:null,fromMinute:targetMinute,processedMinute:targetMinute,pendingMinutes:0,due:[],cursor:{status:'valid',state:Object.freeze(next)}};
  }
  const from=state.resolvedMinute;
  if(targetMinute<from)return held('Authoritative clock is behind the saved nightly cursor.',from);
  if(damageMinute!==undefined&&damageMinute>from)return held('Saved building time is ahead of the nightly cursor; reconciliation is required.',from);
  const firstDay=Math.floor((from+1)/1440),lastDay=Math.min(Math.floor(targetMinute/1440),firstDay+maximumDays-1);
  const processedMinute=Math.min(targetMinute,(lastDay+1)*1440-1),due:ObserverNightlyDue[]=[];
  // A night's deterministic time can fall after midnight. Include the prior
  // night's candidate, then filter by exact cursor bounds; never lose that tail.
  for(let day=Math.max(1,firstDay-1);day<=lastDay;day++){const at=nightlyRaidMinute(worldKey,day);if(at!==null&&at>from&&at<=processedMinute)due.push(Object.freeze({day,minute:at}));}
  due.sort((a,b)=>a.minute-b.minute||a.day-b.day);
  return{status:'ready',error:null,fromMinute:from,processedMinute,pendingMinutes:targetMinute-processedMinute,due:Object.freeze(due),cursor:{status:'valid',state:Object.freeze({...state,resolvedMinute:processedMinute})}};
}

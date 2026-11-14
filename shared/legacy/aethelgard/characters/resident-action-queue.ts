/** Saved command ordering and retained-front retry adapted from OpenGothic
 * 14a865a5182f52d596c83f1d99bd1abb4f6afb50, common/world/aiqueue.cpp9-73
 * and common/world/objects/npc.cpp1882,2419-2455,337-367 (MIT, (c)2019 Try).
 * See LICENSE.opengothic.txt. Crownfall adds strict IDs, source/physical guards,
 * bounded persistence and interruption. No Gothic executable or game data is required.
 * The queue owns neither a clock, navigation, leases, animation nor work credit. */
/**
 * @license MIT
 * Copyright (c) 2019 Try
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import {copyObserverJSON} from '../observer/observer-json';
import {placeDataArray,placeDataRecord} from '../place-use';
import {createResidentActionWait,advanceResidentActionWait,parseResidentActionWait,selectResidentActionWake,type ResidentActionWake} from './resident-action-wait';

export const RESIDENT_ACTION_STEPS=['approach','reserve','face','perform','release'] as const;
export type ResidentActionStep=typeof RESIDENT_ACTION_STEPS[number];
export interface ResidentActionSource {readonly profile:'desktop'|'quest';readonly sha256:string;readonly siteIdentity:string}
export interface ResidentActionGoal {readonly key:string;readonly activityKey:string;readonly activity:string;readonly targetPlaceId:string;readonly issuedAbsoluteMinute:number;readonly lineage?:string}
export interface ResidentActionInterruption {readonly id:string;readonly reason:'safety'|'weather'|'emergency';readonly sinceMinute:number}
export type ResidentActionWait=ReturnType<typeof createResidentActionWait>;
export interface ResidentActionQueue {
 readonly residentId:string;readonly jobId:string;readonly goal:ResidentActionGoal;
 readonly current:ResidentActionStep|null;readonly pending:readonly ResidentActionStep[];
 readonly wait:ResidentActionWait|null;readonly waitToken:number;readonly interruption:ResidentActionInterruption|null;
 readonly completedAtMinute:number|null;readonly performedWorldMinutes:number;
 readonly proof:{readonly arrivalId:string|null;readonly stationId:string|null;readonly leaseId:string|null;readonly facingId:string|null;
  readonly durationWorldMinutes:number|null;readonly lastContactMinute:number|null;readonly lastContactSequence:number;readonly usedEventIds:readonly string[];
  readonly stationBinding:ResidentActionPhysicalStation|null;readonly contactCount:number};
}
export interface ResidentActionQueues {
 readonly kind:'resident-action-queues';readonly schemaVersion:2;readonly worldKey:string;readonly absoluteMinute:number;
 readonly source:ResidentActionSource|null;readonly nextSequence:number;readonly residents:readonly ResidentActionQueue[];
}
export interface ResidentActionArrival {readonly id:string;readonly residentId:string;readonly placeId:string;readonly anchorId:string;readonly atMinute:number;
 readonly source:ResidentActionSource;readonly kind:'certified-route-arrival';readonly exclusivelyOwned:true}
export interface ResidentActionPhysicalStation {readonly id:string;readonly residentId:string;readonly placeId:string;readonly anchorId:string;readonly source:ResidentActionSource;
 readonly clip:string;readonly certificateSha256:string;readonly durationWorldMinutes:number;
 readonly proof:{readonly originalTriangleClearance:true;readonly wholeFootprintSupported:true;readonly sweptClipAndPropsClear:true;readonly contactSourceActor:string}}
export interface ResidentActionLease {readonly id:string;readonly residentId:string;readonly jobId:string;readonly stationId:string;readonly source:ResidentActionSource;readonly sinceMinute:number;readonly untilMinute:number}
export interface ResidentActionFacing {readonly id:string;readonly residentId:string;readonly jobId:string;readonly stationId:string;readonly leaseId:string;readonly source:ResidentActionSource;readonly atMinute:number;readonly sourcePoseQualified:true}
export interface ResidentActionContact {readonly id:string;readonly residentId:string;readonly jobId:string;readonly stationId:string;readonly leaseId:string;readonly source:ResidentActionSource;readonly atMinute:number;readonly sequence:number;readonly clip:string;readonly markerId:string;readonly contactSourceActor:string;readonly contactQualified:true}
export interface ResidentActionRelease {readonly id:string;readonly residentId:string;readonly jobId:string;readonly stationId:string;readonly leaseId:string;readonly source:ResidentActionSource;readonly atMinute:number}
/** Produced by the source adapter. These proofs are never inferred from a
 * schedule, a renderer frame, a simulation-only lease or elapsed animation. */
export interface ResidentActionObservation {
 readonly residentId:string;readonly source:ResidentActionSource|null;readonly destinationMapped:boolean;readonly navigationReason:string|null;
 readonly arrival:ResidentActionArrival|null;readonly station:ResidentActionPhysicalStation|null;readonly lease:ResidentActionLease|null;
 readonly facing:ResidentActionFacing|null;readonly contacts:readonly ResidentActionContact[];readonly releases:readonly ResidentActionRelease[];
 readonly invalidatedTarget:boolean;
}
export interface ResidentActionQueueInput {readonly worldKey:string;readonly absoluteMinute:number;readonly source:ResidentActionSource|null;
 readonly residents:readonly {readonly residentId:string;readonly goal:ResidentActionGoal;readonly interruption:ResidentActionInterruption|null}[];
 readonly observations:readonly ResidentActionObservation[];readonly wakes?:readonly ResidentActionWake[]}
const trusted=new WeakSet<object>(),BASE_KEYS=['arrivalId','stationId','leaseId','facingId','durationWorldMinutes','lastContactMinute','lastContactSequence','usedEventIds'] as const,KEYS=[...BASE_KEYS,'stationBinding','contactCount'] as const;
const integer=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const physicalTime=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER;
const id=(s:unknown):s is string=>typeof s==='string'&&s.length>0&&s.length<=2048&&s.trim()===s&&!/[\u0000-\u001f\u007f]/u.test(s);
const sameSource=(a:ResidentActionSource|null,b:ResidentActionSource|null):boolean=>a===b||!!a&&!!b&&a.profile===b.profile&&a.sha256===b.sha256&&a.siteIdentity===b.siteIdentity;
export function residentActionSourceKey(s:ResidentActionSource|null):string|null{return s?`${s.profile}|${s.sha256}|${s.siteIdentity}`:null;}
function freeze<T>(v:T):T{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;}
function source(v:unknown):ResidentActionSource|null{if(v===null)return null;const r=placeDataRecord(v,['profile','sha256','siteIdentity']);if(!['desktop','quest'].includes(r.profile as string)||typeof r.sha256!=='string'||!/^[a-f0-9]{64}$/u.test(r.sha256)||!id(r.siteIdentity))throw Error('Invalid resident action source.');return v as ResidentActionSource;}
function goal(v:unknown,minute:number):ResidentActionGoal{const r=placeDataRecord(v,['key','activityKey','activity','targetPlaceId','issuedAbsoluteMinute'],['lineage']);if(!id(r.key)||!id(r.activityKey)||!id(r.activity)||!id(r.targetPlaceId)||!integer(r.issuedAbsoluteMinute)||r.issuedAbsoluteMinute>minute||r.lineage!==undefined&&(typeof r.lineage!=='string'||!r.lineage||r.lineage.length>32768))throw Error('Invalid resident action goal.');return v as ResidentActionGoal;}
function interruption(v:unknown,minute:number):ResidentActionInterruption|null{if(v===null)return null;const r=placeDataRecord(v,['id','reason','sinceMinute']);if(!id(r.id)||!['safety','weather','emergency'].includes(r.reason as string)||!integer(r.sinceMinute)||r.sinceMinute>minute)throw Error('Invalid resident action interruption.');return v as ResidentActionInterruption;}
const emptyProof=():ResidentActionQueue['proof']=>({arrivalId:null,stationId:null,leaseId:null,facingId:null,durationWorldMinutes:null,lastContactMinute:null,lastContactSequence:0,usedEventIds:[],stationBinding:null,contactCount:0});
function fresh(residentId:string,g:ResidentActionGoal,sequence:number):ResidentActionQueue{return{residentId,jobId:`resident-job:${sequence}:${residentId}`,goal:g,current:'approach',pending:RESIDENT_ACTION_STEPS.slice(1),wait:null,waitToken:0,interruption:null,completedAtMinute:null,performedWorldMinutes:0,proof:emptyProof()};}
export function createResidentActionQueues(worldKey:string,absoluteMinute:number,residents:readonly {readonly residentId:string;readonly goal:ResidentActionGoal}[],inputSource:ResidentActionSource|null=null):ResidentActionQueues{
 if(!id(worldKey)||!integer(absoluteMinute)||!residents.length||residents.length>100||new Set(residents.map(r=>r.residentId)).size!==residents.length)throw Error('Resident action queues need a bounded unique roster and world clock.');
 const queues=[...residents].sort((a,b)=>a.residentId.localeCompare(b.residentId)).map((r,i)=>{if(!id(r.residentId)||r.residentId.length>160)throw Error('Invalid action resident.');return fresh(r.residentId,goal(r.goal,absoluteMinute),i);});
 const result=freeze({kind:'resident-action-queues' as const,schemaVersion:2 as const,worldKey,absoluteMinute,source:source(inputSource),nextSequence:queues.length,residents:queues});trusted.add(result);return result;
}
/** Schema1 never pinned a physical station certificate. Preserve pending jobs
 * and their deadlines; active unbound stations explicitly reacquire at reserve
 * with zero unverified work. Completed legacy physical jobs need an explicit
 * migration rather than silently being repeated or treated as proven. */
export function parseResidentActionQueues(value:unknown,expected?:{readonly worldKey?:string;readonly residentIds?:readonly string[];readonly maximumMinute?:number}):ResidentActionQueues{
 const raw=value&&typeof value==='object'&&trusted.has(value)?value:copyObserverJSON(typeof value==='string'?JSON.parse(value):value);
 const r=placeDataRecord(raw,['kind','schemaVersion','worldKey','absoluteMinute','source','nextSequence','residents']),legacy=r.schemaVersion===1,s=r as unknown as ResidentActionQueues;
 if(s.kind!=='resident-action-queues'||!legacy&&r.schemaVersion!==2||!id(s.worldKey)||expected?.worldKey!==undefined&&s.worldKey!==expected.worldKey||!integer(s.absoluteMinute)||expected?.maximumMinute!==undefined&&s.absoluteMinute>expected.maximumMinute||!integer(s.nextSequence))throw Error('Invalid resident action queue identity/clock.');source(s.source);
 if(placeDataArray(s.residents).length<1||s.residents.length>100)throw Error('Invalid resident action roster size.');const seen=new Set<string>(),jobs=new Set<string>(),rows:ResidentActionQueue[]=[];
 for(const original of s.residents){let q=original;placeDataRecord(q,['residentId','jobId','goal','current','pending','wait','waitToken','interruption','completedAtMinute','performedWorldMinutes','proof']);
  const job=/^resident-job:(\d+):(.+)$/u.exec(q.jobId);
  if(!id(q.residentId)||q.residentId.length>160||seen.has(q.residentId)||!id(q.jobId)||q.jobId.length>500||jobs.has(q.jobId)||!job||!Number.isSafeInteger(Number(job[1]))||Number(job[1])>=s.nextSequence||job[2]!==q.residentId||!integer(q.waitToken)||!integer(q.performedWorldMinutes)||q.performedWorldMinutes>240)throw Error('Invalid resident action record.');seen.add(q.residentId);jobs.add(q.jobId);goal(q.goal,s.absoluteMinute);interruption(q.interruption,s.absoluteMinute);
  let index=q.current===null?RESIDENT_ACTION_STEPS.length:RESIDENT_ACTION_STEPS.indexOf(q.current);if(index<0||JSON.stringify(placeDataArray(q.pending))!==JSON.stringify(RESIDENT_ACTION_STEPS.slice(index+1))||q.completedAtMinute!==null&&(!integer(q.completedAtMinute)||q.completedAtMinute>s.absoluteMinute)||q.current===null!==(q.completedAtMinute!==null))throw Error('Resident action command order contradicts completion.');
  let p=placeDataRecord(q.proof,legacy?BASE_KEYS:KEYS),events=placeDataArray(p.usedEventIds);for(const k of['arrivalId','stationId','leaseId','facingId']as const)if(p[k]!==null&&!id(p[k]))throw Error('Invalid resident action physical reference.');
  if(p.durationWorldMinutes!==null&&(!integer(p.durationWorldMinutes)||p.durationWorldMinutes<1||p.durationWorldMinutes>240)||p.lastContactMinute!==null&&(!integer(p.lastContactMinute)||p.lastContactMinute>s.absoluteMinute)||!integer(p.lastContactSequence)||events.length>64||events.some(v=>!id(v))||new Set(events).size!==events.length)throw Error('Invalid resident action progress evidence.');
  if(index>=1&&!p.arrivalId||index>=2&&(!p.stationId||!p.leaseId||p.durationWorldMinutes===null)||index>=3&&!p.facingId||index>=4&&q.performedWorldMinutes<(p.durationWorldMinutes??Infinity))throw Error('Resident action skipped its physical prerequisites.');
  if(q.wait){const w=parseResidentActionWait(q.wait);if(w.worldKey!==s.worldKey||w.residentId!==q.residentId||w.actionId!==q.jobId+':'+q.current||w.token!==q.waitToken||w.sourceKey!==residentActionSourceKey(s.source)||w.observedAtWorldMinute>s.absoluteMinute||!q.current)throw Error('Resident action wait belongs to another command/source.');}
  if(legacy){
   if(q.performedWorldMinutes>0&&events.length<Math.min(q.performedWorldMinutes+1,64))throw Error('Legacy ordinary progress lacks consumed physical contact history.');
   if(index===5)throw Error('Completed legacy ordinary work needs explicit station-binding migration.');
   if(index>=2||q.performedWorldMinutes>0){
    const oldWait=q.wait,token=nextToken(q.waitToken);q={...q,current:'reserve',pending:RESIDENT_ACTION_STEPS.slice(2),wait:null,waitToken:token,completedAtMinute:null,performedWorldMinutes:0,
     proof:{...emptyProof(),arrivalId:p.arrivalId as string,lastContactSequence:p.lastContactSequence as number,usedEventIds:events as string[]}};
    q=oldWait?{...q,wait:parseResidentActionWait({...oldWait,actionId:q.jobId+':reserve',token,signalKey:q.jobId+':reserve:legacy-station-requalification',reason:'legacy-station-requalification'})}
     :hold(q,s.worldKey,s.source,s.absoluteMinute,'legacy-station-requalification');
   }else q={...q,proof:{...q.proof,stationBinding:null,contactCount:0}};
   p=q.proof as unknown as Record<string,unknown>;events=placeDataArray(p.usedEventIds);index=RESIDENT_ACTION_STEPS.indexOf(q.current!);
  }
  const binding=p.stationBinding===null?null:physicalStation(p.stationBinding);
  if(!integer(p.contactCount)||p.contactCount>(p.lastContactSequence as number)||p.contactCount>0&&(!binding||events.length<Math.min(p.contactCount,64))
   ||binding&&(binding.residentId!==q.residentId||binding.placeId!==q.goal.targetPlaceId||!sameSource(binding.source,s.source))
   ||q.performedWorldMinutes>0&&(!binding||q.performedWorldMinutes>binding.durationWorldMinutes||p.contactCount<q.performedWorldMinutes+1))throw Error('Ordinary progress lacks its exact station binding and contact sequence.');
  if(index===0&&(p.arrivalId!==null||p.stationId!==null||p.leaseId!==null||p.facingId!==null||p.durationWorldMinutes!==null)
   ||index===1&&(p.stationId!==null||p.leaseId!==null||p.facingId!==null||p.durationWorldMinutes!==null)
   ||index===2&&p.facingId!==null||index>=2&&(!binding||p.stationId!==binding.id||p.durationWorldMinutes!==binding.durationWorldMinutes)
   ||p.lastContactMinute!==null&&(index<3||p.contactCount===0)
   ||index>=4&&q.performedWorldMinutes!==binding?.durationWorldMinutes)throw Error('Resident action proof is unreachable from its saved command.');
  rows.push(q);
 }
 if(expected?.residentIds&&(seen.size!==expected.residentIds.length||expected.residentIds.some(id=>!seen.has(id))))throw Error('Resident action queue lost a roster identity.');
 const result=legacy?{...s,schemaVersion:2 as const,residents:rows}:s;freeze(result);trusted.add(result);return result;
}
function nextToken(token:number):number{const next=token+1;if(!integer(next))throw Error('Resident action wait token overflow.');return next;}
function physicalStation(value:unknown):ResidentActionPhysicalStation{
 const s=placeDataRecord(value,['id','residentId','placeId','anchorId','source','clip','certificateSha256','durationWorldMinutes','proof']),p=placeDataRecord(s.proof,['originalTriangleClearance','wholeFootprintSupported','sweptClipAndPropsClear','contactSourceActor']);
 if(!id(s.id)||!id(s.residentId)||!id(s.placeId)||!id(s.anchorId)||!id(s.clip)||typeof s.certificateSha256!=='string'||!/^[a-f0-9]{64}$/u.test(s.certificateSha256)||!integer(s.durationWorldMinutes)||s.durationWorldMinutes<1||s.durationWorldMinutes>240||p.originalTriangleClearance!==true||p.wholeFootprintSupported!==true||p.sweptClipAndPropsClear!==true||!id(p.contactSourceActor))throw Error('Invalid source-qualified ordinary workstation.');source(s.source);return value as ResidentActionPhysicalStation;
}
function sameStation(a:ResidentActionPhysicalStation,b:ResidentActionPhysicalStation):boolean{
 return a.id===b.id&&a.residentId===b.residentId&&a.placeId===b.placeId&&a.anchorId===b.anchorId&&sameSource(a.source,b.source)&&a.clip===b.clip
  &&a.certificateSha256===b.certificateSha256&&a.durationWorldMinutes===b.durationWorldMinutes&&a.proof.contactSourceActor===b.proof.contactSourceActor;
}

function pop(q:ResidentActionQueue,minute:number):ResidentActionQueue{const[current,...pending]=q.pending;return{...q,current:current??null,pending,wait:null,completedAtMinute:current?null:minute};}
function rewind(q:ResidentActionQueue):ResidentActionQueue{return{...q,current:'approach',pending:RESIDENT_ACTION_STEPS.slice(1),wait:null,completedAtMinute:null,
 proof:{...emptyProof(),stationBinding:q.proof.stationBinding,contactCount:q.proof.contactCount,lastContactSequence:q.proof.lastContactSequence,usedEventIds:q.proof.usedEventIds}};}
function dropWork(q:ResidentActionQueue):ResidentActionQueue{return rewind({...q,performedWorldMinutes:0,proof:{...q.proof,stationBinding:null,contactCount:0}});}
function breakContact(q:ResidentActionQueue):ResidentActionQueue{return q.proof.lastContactMinute===null?q:{...q,proof:{...q.proof,lastContactMinute:null}};}
function hold(q:ResidentActionQueue,worldKey:string,s:ResidentActionSource|null,minute:number,reason:string):ResidentActionQueue{
 reason=reason.slice(0,512);
 if(!q.current)return q;const actionId=`${q.jobId}:${q.current}`,sourceKey=residentActionSourceKey(s);
 const existing=q.wait&&q.wait.actionId===actionId&&q.wait.reason===reason&&q.wait.sourceKey===sourceKey?advanceResidentActionWait(q.wait,{atWorldMinute:minute}):null;
 if(existing&&(existing.status==='waiting'||existing.status==='delayed'))return{...q,wait:existing};
 const token=q.waitToken+1;if(!integer(token))throw Error('Resident action wait token overflow.');return{...q,waitToken:token,wait:createResidentActionWait({worldKey,residentId:q.residentId,sourceKey,actionId,token,atWorldMinute:minute,retryAtWorldMinute:minute+1,expiresAtWorldMinute:null,signalKey:`${actionId}:${reason}`,reason})};
}
function matchingProof(p:{readonly residentId:string;readonly jobId:string;readonly stationId:string;readonly leaseId:string;readonly source:ResidentActionSource},q:ResidentActionQueue,s:ResidentActionSource|null):boolean{return p.residentId===q.residentId&&p.jobId===q.jobId&&p.stationId===q.proof.stationId&&p.leaseId===q.proof.leaseId&&sameSource(p.source,s);}
function observation(o:ResidentActionObservation,minute:number):void{
 placeDataRecord(o,['residentId','source','destinationMapped','navigationReason','arrival','station','lease','facing','contacts','releases','invalidatedTarget']);
 if(!id(o.residentId)||typeof o.destinationMapped!=='boolean'||typeof o.invalidatedTarget!=='boolean'||o.navigationReason!==null&&!id(o.navigationReason))throw Error('Invalid resident action observation.');source(o.source);
 if(o.arrival){const a=o.arrival;placeDataRecord(a,['id','residentId','placeId','anchorId','atMinute','source','kind','exclusivelyOwned']);if(!id(a.id)||!id(a.residentId)||!id(a.placeId)||!id(a.anchorId)||!physicalTime(a.atMinute)||a.atMinute>minute||a.kind!=='certified-route-arrival'||a.exclusivelyOwned!==true)throw Error('Invalid witnessed action arrival.');source(a.source);}
 if(o.station)physicalStation(o.station);
 if(o.lease){const l=o.lease;placeDataRecord(l,['id','residentId','jobId','stationId','source','sinceMinute','untilMinute']);if(!id(l.id)||!id(l.residentId)||!id(l.jobId)||!id(l.stationId)||!integer(l.sinceMinute)||!integer(l.untilMinute)||l.untilMinute<l.sinceMinute)throw Error('Invalid physical action lease.');source(l.source);}
 if(o.facing){const f=o.facing;placeDataRecord(f,['id','residentId','jobId','stationId','leaseId','source','atMinute','sourcePoseQualified']);if(!id(f.id)||!id(f.residentId)||!id(f.jobId)||!id(f.stationId)||!id(f.leaseId)||!integer(f.atMinute)||f.atMinute>minute||f.sourcePoseQualified!==true)throw Error('Invalid physical action stance.');source(f.source);}
 if(placeDataArray(o.contacts).length>64||placeDataArray(o.releases).length>16)throw Error('Action event feed exceeds its bounded budget.');
 for(const e of o.contacts){placeDataRecord(e,['id','residentId','jobId','stationId','leaseId','source','atMinute','sequence','clip','markerId','contactSourceActor','contactQualified']);if(!id(e.id)||!id(e.residentId)||!id(e.jobId)||!id(e.stationId)||!id(e.leaseId)||!integer(e.atMinute)||e.atMinute>minute||!integer(e.sequence)||!id(e.clip)||!id(e.markerId)||!id(e.contactSourceActor)||e.contactQualified!==true)throw Error('Invalid physical action contact event.');source(e.source);}
 for(const e of o.releases){placeDataRecord(e,['id','residentId','jobId','stationId','leaseId','source','atMinute']);if(!id(e.id)||!id(e.residentId)||!id(e.jobId)||!id(e.stationId)||!id(e.leaseId)||!integer(e.atMinute)||e.atMinute>minute)throw Error('Invalid physical action release event.');source(e.source);}
}
/** The source protocol's pop→retry-front is immutable here: the current head
 * remains in place on any hold. Only a completed physical prerequisite pops it. */
export function advanceResidentActionQueues(value:ResidentActionQueues,inputValue:ResidentActionQueueInput):ResidentActionQueues{
 const input=copyObserverJSON(inputValue)as ResidentActionQueueInput;
 placeDataRecord(input,['worldKey','absoluteMinute','source','residents','observations'],['wakes']);
 const old=parseResidentActionQueues(value);if(input.worldKey!==old.worldKey||!integer(input.absoluteMinute)||input.absoluteMinute<old.absoluteMinute)throw Error('Resident actions follow the existing monotonic world clock.');source(input.source);
 if(input.residents.length!==old.residents.length||new Set(input.residents.map(r=>r.residentId)).size!==old.residents.length||new Set(input.observations.map(o=>o.residentId)).size!==input.observations.length||input.observations.length>100||input.wakes&&placeDataArray(input.wakes).length>100)throw Error('Action inputs must retain each resident once.');
 for(const o of input.observations)observation(o,input.absoluteMinute);
 const requested=new Map(input.residents.map(r=>[r.residentId,r])),observations=new Map(input.observations.map(o=>[o.residentId,o])),minute=input.absoluteMinute,canProgress=minute>old.absoluteMinute;
 const bound=old.source??input.source;let sequence=old.nextSequence;
 const rows=old.residents.map(previous=>{const person=requested.get(previous.residentId);if(!person)throw Error('Action input lost a resident.');goal(person.goal,minute);const paused=interruption(person.interruption,minute);let q=previous;
  // An unbound job may acquire its first real source without elapsed time.
  // Its old null-source wait cannot survive that admission or consume a wake
  // intended for the former source; preserve the command and all work credit.
  if(old.source===null&&bound&&q.wait&&q.wait.sourceKey!==residentActionSourceKey(bound))q={...q,wait:null,waitToken:nextToken(q.waitToken)};
  // Urgent work owns its separate state machine. Preserve the suspended
  // ordinary wait/deadline/token exactly; it cannot run or earn contact time.
  if(paused){
   // A legacy queue may learn the full already-suspended intent identity from
   // its authoritative life owner, without changing this job or its wait.
   if(q.goal.key===person.goal.key&&q.goal.lineage===undefined&&person.goal.lineage!==undefined&&q.goal.issuedAbsoluteMinute===person.goal.issuedAbsoluteMinute
    &&q.goal.activityKey===person.goal.activityKey&&q.goal.activity===person.goal.activity&&q.goal.targetPlaceId===person.goal.targetPlaceId)q={...q,goal:person.goal};
   return{...q,interruption:q.interruption?.id===paused.id?q.interruption:paused};
  }
  if(q.wait)q={...q,wait:advanceResidentActionWait(q.wait,{atWorldMinute:minute,wake:selectResidentActionWake(q.wait,input.wakes??[],minute)??undefined})};
  if(q.goal.key!==person.goal.key){q=fresh(q.residentId,person.goal,sequence++);}
  else{
   if(q.goal.activityKey!==person.goal.activityKey||q.goal.activity!==person.goal.activity||q.goal.targetPlaceId!==person.goal.targetPlaceId||q.goal.lineage!==undefined&&person.goal.lineage!==undefined&&q.goal.lineage!==person.goal.lineage)throw Error('A resident action goal key changed its payload.');
   // A proven life resume can reissue an intent while retaining the physical
   // job key. Carry that current issuance so later polls need no old journal.
   if(q.goal.issuedAbsoluteMinute!==person.goal.issuedAbsoluteMinute||q.goal.lineage===undefined&&person.goal.lineage!==undefined)q={...q,goal:person.goal};
   if(q.interruption)q={...(q.current===null?q:rewind(q)),interruption:null,wait:null,waitToken:nextToken(q.waitToken)};
  }
  if(!bound||!input.source)return hold(breakContact(q),old.worldKey,bound,minute,'source-unavailable');
  if(!sameSource(bound,input.source))return hold(breakContact(q),old.worldKey,bound,minute,'source-changed');
  if(q.current===null)return q;const o=observations.get(q.residentId);
  if(!o||!sameSource(o.source,bound))return hold(breakContact(q),old.worldKey,bound,minute,'physical-observation-unavailable');
  if(o.invalidatedTarget)return hold(dropWork(q),old.worldKey,bound,minute,'target-invalidated');
  // A zero-time observation can invalidate a previously qualified station
  // or contact interval even though it cannot advance a command or earn work.
  if(q.proof.stationBinding){
   if(o.station&&!sameStation(q.proof.stationBinding,o.station))return hold(dropWork(q),old.worldKey,bound,minute,'workstation-binding-changed');
   if(q.proof.lastContactMinute!==null&&(!o.arrival||o.arrival.id!==q.proof.arrivalId||!o.station
    ||!o.lease||o.lease.id!==q.proof.leaseId||o.lease.residentId!==q.residentId||o.lease.jobId!==q.jobId||o.lease.stationId!==q.proof.stationId||!sameSource(o.lease.source,bound)||o.lease.sinceMinute>minute||o.lease.untilMinute<minute
    ||!o.facing||!matchingProof(o.facing,q,bound)||o.facing.id!==q.proof.facingId))q=breakContact(q);
  }
  // Expiry retires this wait cursor, not the retained command. A new physical
  // guard check may run; a still-false guard arms another bounded retry.
  if(q.wait?.status==='expired')q={...q,wait:null,waitToken:nextToken(q.waitToken)};
  if(q.wait&&q.wait.status!=='ready')return q;
  if(!canProgress)return q;
  const arrived=!!o.arrival&&o.arrival.kind==='certified-route-arrival'&&o.arrival.exclusivelyOwned===true&&o.arrival.residentId===q.residentId&&o.arrival.placeId===q.goal.targetPlaceId&&sameSource(o.arrival.source,bound)&&physicalTime(o.arrival.atMinute)&&o.arrival.atMinute<=minute;
  if(q.current==='approach')return arrived?pop({...q,proof:{...q.proof,arrivalId:o.arrival!.id}},minute):hold(q,old.worldKey,bound,minute,!o.destinationMapped?'destination-unmapped':o.navigationReason??'approach-pending');
  if(!arrived||o.arrival!.id!==q.proof.arrivalId)return hold(rewind(q),old.worldKey,bound,minute,'arrival-no-longer-owned');
  const station=o.station,lease=o.lease;
  const stationValid=!!station&&station.residentId===q.residentId&&station.placeId===q.goal.targetPlaceId&&station.anchorId===o.arrival!.anchorId&&sameSource(station.source,bound)&&/^[a-f0-9]{64}$/u.test(station.certificateSha256)&&integer(station.durationWorldMinutes)&&station.durationWorldMinutes>=1&&station.durationWorldMinutes<=240&&station.proof.originalTriangleClearance===true&&station.proof.wholeFootprintSupported===true&&station.proof.sweptClipAndPropsClear===true&&id(station.proof.contactSourceActor)&&id(station.clip);
  if(!stationValid)return hold(breakContact(q),old.worldKey,bound,minute,'workstation-unqualified');
  const leaseValid=!!lease&&lease.residentId===q.residentId&&lease.jobId===q.jobId&&lease.stationId===station!.id&&sameSource(lease.source,bound)&&integer(lease.sinceMinute)&&integer(lease.untilMinute)&&lease.sinceMinute<=minute&&lease.untilMinute>=minute;
  if(q.current==='reserve')return leaseValid?pop({...q,proof:{...q.proof,stationId:station!.id,leaseId:lease!.id,durationWorldMinutes:station!.durationWorldMinutes,stationBinding:station!}},minute):hold(q,old.worldKey,bound,minute,'physical-lease-pending');
  if(!leaseValid||lease!.id!==q.proof.leaseId||station!.id!==q.proof.stationId||station!.durationWorldMinutes!==q.proof.durationWorldMinutes)return hold(rewind(q),old.worldKey,bound,minute,'physical-lease-no-longer-owned');
  const facing=o.facing,faceValid=!!facing&&matchingProof(facing,q,bound)&&facing.sourcePoseQualified===true&&integer(facing.atMinute)&&facing.atMinute>=lease!.sinceMinute&&facing.atMinute<=minute;
  if(q.current==='face')return faceValid?pop({...q,proof:{...q.proof,facingId:facing!.id}},minute):hold(q,old.worldKey,bound,minute,'facing-unqualified');
  if(!faceValid||facing!.id!==q.proof.facingId)return hold(rewind(q),old.worldKey,bound,minute,'facing-no-longer-qualified');
  if(q.current==='perform'){
   const contact=[...o.contacts].filter(c=>matchingProof(c,q,bound)&&c.contactQualified===true&&c.atMinute===minute&&integer(c.sequence)&&c.sequence>q.proof.lastContactSequence&&c.clip===station!.clip&&c.contactSourceActor===station!.proof.contactSourceActor&&id(c.markerId)&&!q.proof.usedEventIds.includes(c.id)).sort((a,b)=>a.sequence-b.sequence)[0];
   if(!contact)return hold({...q,proof:{...q.proof,lastContactMinute:null}},old.worldKey,bound,minute,'action-contact-pending');
   const earned=q.proof.lastContactMinute===minute-1?1:0,performed=Math.min(q.proof.durationWorldMinutes!,q.performedWorldMinutes+earned),next={...q,performedWorldMinutes:performed,wait:null,proof:{...q.proof,lastContactMinute:minute,lastContactSequence:contact.sequence,contactCount:q.proof.contactCount+1,usedEventIds:[...q.proof.usedEventIds,contact.id].slice(-64)}};
   return performed>=q.proof.durationWorldMinutes!?pop(next,minute):next;
  }
  const released=o.releases.find(r=>matchingProof(r,q,bound)&&r.atMinute===minute&&!q.proof.usedEventIds.includes(r.id));
  return released?pop({...q,proof:{...q.proof,usedEventIds:[...q.proof.usedEventIds,released.id].slice(-64)}},minute):hold(q,old.worldKey,bound,minute,'physical-release-pending');
 });
 if(!integer(sequence))throw Error('Resident action sequence overflow.');
 const result=freeze({kind:'resident-action-queues' as const,schemaVersion:2 as const,worldKey:old.worldKey,absoluteMinute:minute,source:bound,nextSequence:sequence,residents:rows});trusted.add(result);return result;
}

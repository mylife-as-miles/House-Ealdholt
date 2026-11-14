/**
 * World-clock wait bookkeeping adapted from OpenGOAL's original PC runtime:
 * game/system/IOP_Kernel.cpp, updateDelay/WakeupThread/nextWakeup,
 * da5d348676b521d77ebdc63908892afb231383b7. No reconstructed GOAL game code,
 * native coroutine stacks, second clock or work-completion logic is included.
 * Source identity, tokens and strict saved-data checks are Crownfall additions.
 * Full notice is also retained in LICENSE.opengoal.txt beside this module.
 *
 * @license ISC
 * Copyright (c) 2020-2026 OpenGOAL Team
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
import {placeDataArray,placeDataRecord} from '../place-use';

export interface ResidentActionWaitIdentity {
 readonly worldKey:string;readonly residentId:string;readonly sourceKey:string|null;
 readonly actionId:string;readonly token:number;
}
export interface ResidentActionWake extends ResidentActionWaitIdentity {
 readonly signalKey:string;readonly atWorldMinute:number;
}
export interface ResidentActionWait extends ResidentActionWaitIdentity {
 readonly kind:'resident-action-wait';readonly schemaVersion:1;
 readonly status:'ready'|'waiting'|'delayed'|'cancelled'|'expired';readonly reason:string;
 readonly startedAtWorldMinute:number;readonly observedAtWorldMinute:number;
 readonly retryAtWorldMinute:number|null;readonly expiresAtWorldMinute:number|null;
 readonly signalKey:string|null;readonly wokeAtWorldMinute:number|null;readonly endedAtWorldMinute:number|null;
}
export interface CreateResidentActionWaitInput extends ResidentActionWaitIdentity {
 readonly atWorldMinute:number;readonly retryAtWorldMinute:number|null;
 readonly expiresAtWorldMinute:number|null;readonly signalKey:string|null;readonly reason:string;
}
const IDENTITY=['worldKey','residentId','sourceKey','actionId','token'] as const;
const KEYS=[...IDENTITY,'kind','schemaVersion','status','reason','startedAtWorldMinute','observedAtWorldMinute',
 'retryAtWorldMinute','expiresAtWorldMinute','signalKey','wokeAtWorldMinute','endedAtWorldMinute'] as const;
const trusted=new WeakSet<object>();
const text=(v:unknown,max=2048):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&v.trim()===v&&!/[\u0000-\u001f\u007f]/u.test(v);
const time=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER;
const nullableTime=(v:unknown):v is number|null=>v===null||time(v);
function identity(r:Record<string,unknown>):void {
 if(!text(r.worldKey)||!text(r.residentId,160)||!(r.sourceKey===null||text(r.sourceKey,4096))||!text(r.actionId,512)||!Number.isSafeInteger(r.token)||(r.token as number)<0)throw Error('Invalid resident-action wait identity.');
}
function finish(value:ResidentActionWait):ResidentActionWait{Object.freeze(value);trusted.add(value);return value;}
function observed(value:ResidentActionWait,at:unknown):number {
 if(!time(at)||at<value.observedAtWorldMinute)throw Error('Resident-action waits require a monotonic authoritative world minute.');return at;
}
function readWake(value:unknown):ResidentActionWake {
 const r=placeDataRecord(value,[...IDENTITY,'signalKey','atWorldMinute']);identity(r);
 if(!text(r.signalKey,1024)||!time(r.atWorldMinute))throw Error('Invalid resident-action wake data.');
 return Object.freeze({worldKey:r.worldKey,residentId:r.residentId,sourceKey:r.sourceKey,actionId:r.actionId,token:r.token,signalKey:r.signalKey,atWorldMinute:r.atWorldMinute}) as ResidentActionWake;
}
function sameIdentity(a:ResidentActionWaitIdentity,b:ResidentActionWaitIdentity):boolean {
 return a.worldKey===b.worldKey&&a.residentId===b.residentId&&a.sourceKey===b.sourceKey&&a.actionId===b.actionId&&a.token===b.token;
}
function acceptsWake(s:ResidentActionWait,wake:ResidentActionWake,at:number):boolean {
 return (s.status==='waiting'||s.status==='delayed')&&sameIdentity(s,wake)&&s.signalKey===wake.signalKey
  &&wake.atWorldMinute>=s.observedAtWorldMinute&&wake.atWorldMinute>=s.startedAtWorldMinute&&wake.atWorldMinute<=at;
}

/** Own and validate only finite scalar JSON; getters and future fields are not executed or silently discarded. */
export function parseResidentActionWait(value:unknown):ResidentActionWait {
 if(value&&typeof value==='object'&&trusted.has(value))return value as ResidentActionWait;
 if(typeof value==='string'){if(value.length>16*1024)throw Error('Resident-action wait exceeds its saved-data budget.');value=JSON.parse(value);}
 const r=placeDataRecord(value,KEYS);identity(r);const s=r as unknown as ResidentActionWait;
 if(s.kind!=='resident-action-wait'||s.schemaVersion!==1||!['ready','waiting','delayed','cancelled','expired'].includes(s.status)||!text(s.reason,512)
  ||!time(s.startedAtWorldMinute)||!time(s.observedAtWorldMinute)||s.observedAtWorldMinute<s.startedAtWorldMinute
  ||!nullableTime(s.retryAtWorldMinute)||s.retryAtWorldMinute!==null&&s.retryAtWorldMinute<s.startedAtWorldMinute
  ||!nullableTime(s.expiresAtWorldMinute)||s.expiresAtWorldMinute!==null&&s.expiresAtWorldMinute<s.startedAtWorldMinute
  ||!(s.signalKey===null||text(s.signalKey,1024))||s.retryAtWorldMinute===null&&s.signalKey===null
  ||!nullableTime(s.wokeAtWorldMinute)||s.wokeAtWorldMinute!==null&&(s.signalKey===null||s.wokeAtWorldMinute<s.startedAtWorldMinute||s.wokeAtWorldMinute>s.observedAtWorldMinute||s.expiresAtWorldMinute!==null&&s.wokeAtWorldMinute>=s.expiresAtWorldMinute)
  ||!nullableTime(s.endedAtWorldMinute)||s.endedAtWorldMinute!==null&&(s.endedAtWorldMinute<s.startedAtWorldMinute||s.endedAtWorldMinute>s.observedAtWorldMinute))throw Error('Invalid saved resident-action wait.');
 const terminal=s.status==='cancelled'||s.status==='expired',due=s.retryAtWorldMinute!==null&&s.retryAtWorldMinute<=s.observedAtWorldMinute||s.wokeAtWorldMinute!==null;
 if(terminal!==(s.endedAtWorldMinute!==null)
  ||s.status==='expired'&&(s.expiresAtWorldMinute===null||s.observedAtWorldMinute<s.expiresAtWorldMinute||s.endedAtWorldMinute!==s.expiresAtWorldMinute)
  ||s.status==='cancelled'&&(s.expiresAtWorldMinute!==null&&s.endedAtWorldMinute!>=s.expiresAtWorldMinute||s.wokeAtWorldMinute!==null&&s.wokeAtWorldMinute>s.endedAtWorldMinute!)
  ||!terminal&&s.expiresAtWorldMinute!==null&&s.expiresAtWorldMinute<=s.observedAtWorldMinute
  ||s.status==='ready'&&!due||(s.status==='waiting'||s.status==='delayed')&&due
  ||s.status==='waiting'&&s.signalKey===null||s.status==='delayed'&&(s.signalKey!==null||s.retryAtWorldMinute===null))throw Error('Resident-action wait status contradicts its clock or wake.');
 return finish({...s});
}

export function createResidentActionWait(input:CreateResidentActionWaitInput):ResidentActionWait {
 const r=placeDataRecord(input,[...IDENTITY,'atWorldMinute','retryAtWorldMinute','expiresAtWorldMinute','signalKey','reason']);identity(r);
 if(!time(input.atWorldMinute))throw Error('Resident-action wait needs an authoritative world minute.');
 const expired=input.expiresAtWorldMinute!==null&&input.expiresAtWorldMinute<=input.atWorldMinute;
 const ready=input.retryAtWorldMinute!==null&&input.retryAtWorldMinute<=input.atWorldMinute;
 return parseResidentActionWait({kind:'resident-action-wait',schemaVersion:1,worldKey:input.worldKey,residentId:input.residentId,sourceKey:input.sourceKey,actionId:input.actionId,token:input.token,
  status:expired?'expired':ready?'ready':input.signalKey===null?'delayed':'waiting',reason:input.reason,
  startedAtWorldMinute:input.atWorldMinute,observedAtWorldMinute:input.atWorldMinute,retryAtWorldMinute:input.retryAtWorldMinute,expiresAtWorldMinute:input.expiresAtWorldMinute,
  signalKey:input.signalKey,wokeAtWorldMinute:null,endedAtWorldMinute:expired?input.expiresAtWorldMinute:null});
}

/** Select before advancing observation: stale first entries cannot mask a later
 * matching wake. This is one cursor's bounded inbox, not a world scheduler. */
export function selectResidentActionWake(value:ResidentActionWait,wakes:readonly ResidentActionWake[],atWorldMinute:number):ResidentActionWake|null {
 const s=parseResidentActionWait(value),at=observed(s,atWorldMinute),rows=placeDataArray(wakes);
 if(rows.length>100)throw Error('Resident-action wake inbox exceeds its bounded budget.');
 let selected:ResidentActionWake|null=null;
 for(const raw of rows){const wake=readWake(raw);
  if(s.expiresAtWorldMinute!==null&&at>=s.expiresAtWorldMinute)continue;
  if(acceptsWake(s,wake,at)&&(!selected||wake.atWorldMinute<selected.atWorldMinute))selected=wake;
 }
 return selected;
}

/** Ready grants one retry opportunity to the owning queue, never arrival, animation, labour or completion. */
export function advanceResidentActionWait(value:ResidentActionWait,input:{readonly atWorldMinute:number;readonly wake?:ResidentActionWake}):ResidentActionWait {
 const s=parseResidentActionWait(value);placeDataRecord(input,['atWorldMinute'],['wake']);const at=observed(s,input.atWorldMinute),wake=input.wake===undefined?null:readWake(input.wake);
 if(s.status==='cancelled'||s.status==='expired')return at===s.observedAtWorldMinute?s:finish({...s,observedAtWorldMinute:at});
 if(s.expiresAtWorldMinute!==null&&at>=s.expiresAtWorldMinute)return finish({...s,status:'expired',observedAtWorldMinute:at,endedAtWorldMinute:s.expiresAtWorldMinute});
 const accepts=wake!==null&&acceptsWake(s,wake,at);
 const wokeAt=accepts?wake.atWorldMinute:s.wokeAtWorldMinute,ready=s.status==='ready'||wokeAt!==null||s.retryAtWorldMinute!==null&&at>=s.retryAtWorldMinute;
 if(at===s.observedAtWorldMinute&&!accepts&&(!ready||s.status==='ready'))return s;
 return finish({...s,status:ready?'ready':s.status,observedAtWorldMinute:at,wokeAtWorldMinute:wokeAt});
}

export function cancelResidentActionWait(value:ResidentActionWait,input:{readonly atWorldMinute:number;readonly reason:string}):ResidentActionWait {
 placeDataRecord(input,['atWorldMinute','reason']);if(!text(input.reason,512))throw Error('Resident-action cancellation needs a reason.');
 const s=advanceResidentActionWait(value,{atWorldMinute:input.atWorldMinute});
 return s.status==='cancelled'||s.status==='expired'?s:finish({...s,status:'cancelled',reason:input.reason,endedAtWorldMinute:input.atWorldMinute});
}

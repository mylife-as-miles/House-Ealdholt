import test from 'node:test';
import assert from 'node:assert/strict';
import {createResidentActionWait,advanceResidentActionWait,cancelResidentActionWait,parseResidentActionWait,selectResidentActionWake,
 type CreateResidentActionWaitInput,type ResidentActionWake} from './resident-action-wait';

const identity={worldKey:'ealdholt-world',residentId:'ealdholt-smith',sourceKey:'desktop|source-sha|site-identity',actionId:'resident-job-17:approach',token:3};
const input=(extra:Partial<CreateResidentActionWaitInput>={}):CreateResidentActionWaitInput=>({...identity,atWorldMinute:100,retryAtWorldMinute:104,expiresAtWorldMinute:120,signalKey:'forge-released',reason:'equipment-held',...extra});
const wake=(atWorldMinute:number,extra:Partial<ResidentActionWake>={}):ResidentActionWake=>({...identity,signalKey:'forge-released',atWorldMinute,...extra});

test('an authoritative timer only changes eligibility and clock-only delays do not accept resource signals',()=>{
 const delayed=createResidentActionWait(input({signalKey:null}));assert.equal(delayed.status,'delayed');
 const before=advanceResidentActionWait(delayed,{atWorldMinute:102,wake:wake(102)});assert.equal(before.status,'delayed');assert.equal(before.wokeAtWorldMinute,null);
 const due=advanceResidentActionWait(before,{atWorldMinute:104});assert.equal(due.status,'ready');assert.equal(due.wokeAtWorldMinute,null);assert.equal(due.endedAtWorldMinute,null);assert.equal(due.token,3);
 assert.equal(advanceResidentActionWait(due,{atWorldMinute:104}),due,'One poll cannot rearm or manufacture a new retry token.');
 const signalOnly=createResidentActionWait(input({retryAtWorldMinute:null}));assert.equal(advanceResidentActionWait(signalOnly,{atWorldMinute:119}).status,'waiting');
 assert.equal(advanceResidentActionWait(signalOnly,{atWorldMinute:101,wake:wake(101)}).status,'ready');
});

test('only an exact source/action/token wake can make a waiting operation ready before its retry deadline',()=>{
 const waiting=createResidentActionWait(input());assert.equal(waiting.status,'waiting');
 for(const changed of[{worldKey:'other-world'},{residentId:'ealdholt-child'},{sourceKey:null},{sourceKey:'quest|source-sha|site-identity'},
  {actionId:'resident-job-18:approach'},{token:2},{token:4},{signalKey:'different-equipment'}]){
  const next=advanceResidentActionWait(waiting,{atWorldMinute:101,wake:wake(101,changed)});assert.equal(next.status,'waiting');assert.equal(next.wokeAtWorldMinute,null);
 }
 const ready=advanceResidentActionWait(waiting,{atWorldMinute:101,wake:wake(101)});assert.equal(ready.status,'ready');assert.equal(ready.wokeAtWorldMinute,101);assert.equal(ready.retryAtWorldMinute,104);
 assert.equal(advanceResidentActionWait(ready,{atWorldMinute:101,wake:wake(101)}),ready,'A repeated signal cannot change the same cursor twice.');
 assert.equal(advanceResidentActionWait(waiting,{atWorldMinute:100,wake:wake(100)}).status,'ready','The owning queue, not the wait helper, limits same-minute action processing.');
 assert.deepEqual(waiting,createResidentActionWait(input()),'Wake inspection never changes the saved waiting cursor.');
});

test('old or future-dated wake messages cannot rewrite a newer observation or a resumed action',()=>{
 const current=advanceResidentActionWait(createResidentActionWait(input()),{atWorldMinute:102});
 assert.equal(advanceResidentActionWait(current,{atWorldMinute:103,wake:wake(101)}).status,'waiting');
 assert.equal(advanceResidentActionWait(current,{atWorldMinute:103,wake:wake(104)}).status,'waiting');
 assert.equal(advanceResidentActionWait(current,{atWorldMinute:103,wake:wake(102)}).status,'ready');
 const resumed=createResidentActionWait(input({atWorldMinute:103,retryAtWorldMinute:108,token:4}));
 assert.equal(advanceResidentActionWait(resumed,{atWorldMinute:104,wake:wake(104)}).status,'waiting');
 assert.equal(advanceResidentActionWait(resumed,{atWorldMinute:104,wake:wake(104,{token:4})}).status,'ready');
 const unbound=createResidentActionWait(input({sourceKey:null}));
 assert.equal(advanceResidentActionWait(unbound,{atWorldMinute:101,wake:wake(101)}).status,'waiting');
 assert.equal(advanceResidentActionWait(unbound,{atWorldMinute:101,wake:wake(101,{sourceKey:null})}).status,'ready');
});

test('expiry wins over a simultaneous deadline or signal and neither terminal state can be resurrected',()=>{
 const waiting=createResidentActionWait(input({retryAtWorldMinute:105,expiresAtWorldMinute:105}));
 const expired=advanceResidentActionWait(waiting,{atWorldMinute:105,wake:wake(105)});assert.equal(expired.status,'expired');assert.equal(expired.endedAtWorldMinute,105);assert.equal(expired.wokeAtWorldMinute,null);
 assert.equal(advanceResidentActionWait(expired,{atWorldMinute:110,wake:wake(110)}).status,'expired');
 assert.equal(cancelResidentActionWait(expired,{atWorldMinute:110,reason:'late cancellation'}).status,'expired');
 const cancelled=cancelResidentActionWait(waiting,{atWorldMinute:102,reason:'house-fire-interruption'});assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.endedAtWorldMinute,102);
 const later=advanceResidentActionWait(cancelled,{atWorldMinute:130,wake:wake(130)});assert.equal(later.status,'cancelled');assert.equal(later.endedAtWorldMinute,102);assert.equal(later.reason,'house-fire-interruption');
 assert.equal(createResidentActionWait(input({expiresAtWorldMinute:100})).status,'expired');
 assert.equal(createResidentActionWait(input({retryAtWorldMinute:100})).status,'ready');
});

test('bounded wake selection is deterministic and stale first messages cannot hide a valid event',()=>{
 const waiting=createResidentActionWait(input({retryAtWorldMinute:118})),batch=[wake(101,{token:2}),wake(106),wake(110,{sourceKey:null}),wake(104),wake(112),wake(99)];
 const selected=selectResidentActionWake(waiting,batch,110),reversed=selectResidentActionWake(waiting,[...batch].reverse(),110);
 assert.deepEqual(selected,wake(104));assert.deepEqual(reversed,selected);assert.ok(Object.isFrozen(selected));
 assert.equal(waiting.observedAtWorldMinute,100,'Selection cannot consume time before the exact wake is chosen.');
 const next=advanceResidentActionWait(waiting,{atWorldMinute:110,wake:selected!});assert.equal(next.status,'ready');assert.equal(next.wokeAtWorldMinute,104);
 assert.equal(selectResidentActionWake(next,[wake(110)],110),null);
 assert.equal(selectResidentActionWake(waiting,[wake(101)],120),null,'Expired eligibility cannot be resurrected by queued wake messages.');
 assert.equal(selectResidentActionWake(waiting,[],110),null);
});

test('wake inbox bounds and data descriptors are checked without invoking accessors',()=>{
 const waiting=createResidentActionWait(input());assert.throws(()=>selectResidentActionWake(waiting,Array.from({length:101},()=>wake(101)),101));
 assert.throws(()=>selectResidentActionWake(waiting,new Array(2),101));
 let called=0;const hostile={...wake(101)};Object.defineProperty(hostile,'token',{enumerable:true,get(){called++;return 3;}});
 assert.throws(()=>selectResidentActionWake(waiting,[hostile],101));assert.equal(called,0);
 assert.deepEqual(waiting,createResidentActionWait(input()));
});

test('saved waits own finite scalar data and round-trip active, ready, cancelled and expired states',()=>{
 const waiting=createResidentActionWait(input()),ready=advanceResidentActionWait(waiting,{atWorldMinute:101,wake:wake(101)}),cancelled=cancelResidentActionWait(waiting,{atWorldMinute:102,reason:'new-emergency'}),expired=advanceResidentActionWait(ready,{atWorldMinute:130});
 for(const cursor of[waiting,ready,cancelled,expired]){
  const raw=JSON.parse(JSON.stringify(cursor)),restored=parseResidentActionWait(raw);assert.deepEqual(restored,cursor);assert.ok(Object.isFrozen(restored));raw.token=42;assert.equal(restored.token,3);
 }
 const restored=parseResidentActionWait(JSON.stringify(waiting));assert.deepEqual(advanceResidentActionWait(restored,{atWorldMinute:104}),advanceResidentActionWait(waiting,{atWorldMinute:104}));
});

test('clock subdivision and host-wall-clock changes cannot change timer expiry',()=>{
 const cursor=createResidentActionWait(input({retryAtWorldMinute:104,expiresAtWorldMinute:109}));
 const direct=advanceResidentActionWait(cursor,{atWorldMinute:110});let split=cursor;
 for(const at of[101,103.5,104,108,109,110])split=advanceResidentActionWait(split,{atWorldMinute:at});
 assert.deepEqual(split,direct);assert.equal(direct.endedAtWorldMinute,109);
 const original=Date.now;try{Date.now=()=>{throw Error('Host time is unavailable.');};assert.deepEqual(advanceResidentActionWait(cursor,{atWorldMinute:110}),direct);}finally{Date.now=original;}
});

test('strict saved data rejects contradictions, unsafe tokens and accessors without invoking them',()=>{
 const valid=createResidentActionWait(input());
 for(const changed of[{schemaVersion:2},{token:-1},{token:Number.MAX_SAFE_INTEGER+1},{token:1.5},{observedAtWorldMinute:99},{retryAtWorldMinute:99},
  {expiresAtWorldMinute:99},{retryAtWorldMinute:null,signalKey:null},{status:'ready'},{status:'delayed'},{status:'waiting',wokeAtWorldMinute:100},
  {status:'expired',endedAtWorldMinute:105},{status:'cancelled',endedAtWorldMinute:null},{endedAtWorldMinute:100},
  {status:'cancelled',observedAtWorldMinute:125,endedAtWorldMinute:120},
  {status:'cancelled',observedAtWorldMinute:119,endedAtWorldMinute:102,wokeAtWorldMinute:110},{sourceKey:undefined},{reason:''},{unknown:true}])assert.throws(()=>parseResidentActionWait({...valid,...changed}));
 let calls=0;const getter={...valid};Object.defineProperty(getter,'sourceKey',{enumerable:true,get(){calls++;return 'changed';}});
 assert.throws(()=>parseResidentActionWait(getter));assert.equal(calls,0);
 const serial={...valid,toJSON(){calls++;return valid;}};assert.throws(()=>parseResidentActionWait(serial));assert.equal(calls,0);
 assert.throws(()=>parseResidentActionWait(Object.assign(Object.create({}),valid)));
 assert.throws(()=>parseResidentActionWait(' '.repeat(16*1024+1)));
 assert.throws(()=>advanceResidentActionWait(valid,{atWorldMinute:99}));
 assert.throws(()=>advanceResidentActionWait(valid,{atWorldMinute:NaN}));
 assert.throws(()=>advanceResidentActionWait(valid,{atWorldMinute:101,wake:{...wake(101),unknown:true} as ResidentActionWake}));
 assert.throws(()=>cancelResidentActionWait(valid,{atWorldMinute:101,reason:''}));
 assert.deepEqual(valid,createResidentActionWait(input()));
});

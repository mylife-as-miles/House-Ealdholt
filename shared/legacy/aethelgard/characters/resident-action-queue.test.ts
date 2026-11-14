import test from 'node:test';
import assert from 'node:assert/strict';
import {createResidentActionQueues,advanceResidentActionQueues,parseResidentActionQueues,residentActionSourceKey,
 type ResidentActionQueues,type ResidentActionObservation,type ResidentActionGoal,type ResidentActionSource,type ResidentActionInterruption}from './resident-action-queue';
import {createResidentActionWait} from './resident-action-wait';

const worldKey='queue-unit-world',residentId='unit-smith',source:ResidentActionSource={profile:'desktop',sha256:'a'.repeat(64),siteIdentity:'unit-source-site'};
const goal:ResidentActionGoal={key:'day0:smith-work',activityKey:'work',activity:'Mends the household tools.',targetPlaceId:'unit-forge',issuedAbsoluteMinute:0};
function initial(){return createResidentActionQueues(worldKey,0,[{residentId,goal}],source);}
/** Explicit synthetic physical proofs only. Real-source admission belongs to
 * the adapter and enabled original-geometry integration tests. */
function observation(s:ResidentActionQueues,minute:number,options:{contact?:boolean;release?:boolean;arrival?:boolean;station?:boolean;lease?:boolean;facing?:boolean;contactId?:string;sequence?:number}={}):ResidentActionObservation{
 const q=s.residents[0],stationId='unit-forge-stance',leaseId='unit-physical-lease';
 return{residentId,source,destinationMapped:true,navigationReason:null,invalidatedTarget:false,
  arrival:minute>=1&&options.arrival!==false?{id:'unit-actual-arrival',residentId,placeId:goal.targetPlaceId,anchorId:'unit-forge-anchor',atMinute:1,source,kind:'certified-route-arrival',exclusivelyOwned:true}:null,
  station:options.station===false?null:{id:stationId,residentId,placeId:goal.targetPlaceId,anchorId:'unit-forge-anchor',source,clip:'work_hammer',certificateSha256:'b'.repeat(64),durationWorldMinutes:2,
   proof:{originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:'unit-source-anvil'}},
  lease:minute>=2&&options.lease!==false?{id:leaseId,residentId,jobId:q.jobId,stationId,source,sinceMinute:2,untilMinute:100}:null,
  facing:minute>=3&&options.facing!==false?{id:'unit-actual-facing',residentId,jobId:q.jobId,stationId,leaseId,source,atMinute:3,sourcePoseQualified:true}:null,
  contacts:options.contact?[{id:options.contactId??`unit-contact-${minute}`,residentId,jobId:q.jobId,stationId,leaseId,source,atMinute:minute,sequence:options.sequence??minute,clip:'work_hammer',markerId:'unit-authored-strike',contactSourceActor:'unit-source-anvil',contactQualified:true}]:[],
  releases:options.release?[{id:'unit-release',residentId,jobId:q.jobId,stationId,leaseId,source,atMinute:minute}]:[]};
}
function step(s:ResidentActionQueues,minute:number,obs=observation(s,minute),pause:ResidentActionInterruption|null=null,g=goal){return advanceResidentActionQueues(s,{worldKey,absoluteMinute:minute,source,residents:[{residentId,goal:g,interruption:pause}],observations:[obs]});}
function performing(){let s=initial();for(let m=1;m<=3;m++)s=step(s,m);assert.equal(s.residents[0].current,'perform');return s;}

test('exact fractional physical arrivals are observed at the next world boundary without rounding or early work',()=>{
 const s=initial(),at=1.3406664,o=observation(s,2),arrival={...o.arrival!,atMinute:at};
 const next=step(s,2,{...o,arrival});assert.equal(next.residents[0].current,'reserve');assert.equal(next.residents[0].performedWorldMinutes,0);
 assert.equal(arrival.atMinute,at);assert.throws(()=>step(s,1,{...observation(s,1),arrival}),/arrival/);
 assert.equal(s.residents[0].current,'approach');
});

test('source-adapted deque retries the same head and cannot earn work from missing destinations or elapsed waits',()=>{
 let s=initial();const missing={...observation(s,1),destinationMapped:false,navigationReason:'destination-unmapped',arrival:null};s=step(s,1,missing);
 const head=s.residents[0];assert.equal(head.current,'approach');assert.equal(head.wait?.reason,'destination-unmapped');assert.equal(head.waitToken,1);assert.equal(head.performedWorldMinutes,0);
 s=step(s,2,{...missing});assert.equal(s.residents[0].current,'approach');assert.deepEqual(s.residents[0].pending,head.pending);assert.equal(s.residents[0].waitToken,2);assert.equal(s.residents[0].performedWorldMinutes,0);
 const before=JSON.stringify(s);s=step(s,2,missing);assert.equal(JSON.stringify(s),before,'A same-minute poll cannot process another command or spend contact time.');
});

test('actual arrival, physical lease, facing, continuous contact and release each gate their own saved step',()=>{
 let s=initial();s=step(s,1);assert.equal(s.residents[0].current,'reserve');
 s=step(s,2,observation(s,2,{station:false}));assert.equal(s.residents[0].wait?.reason,'workstation-unqualified');
 s=step(s,3,observation(s,3,{lease:false}));assert.equal(s.residents[0].wait?.reason,'physical-lease-pending');
 s=step(s,4);assert.equal(s.residents[0].current,'face');
 s=step(s,5,observation(s,5,{facing:false}));assert.equal(s.residents[0].wait?.reason,'facing-unqualified');
 s=step(s,6);assert.equal(s.residents[0].current,'perform');
 s=step(s,7,observation(s,7,{contact:true}));assert.equal(s.residents[0].performedWorldMinutes,0);
 s=step(s,8,observation(s,8,{contact:true}));assert.equal(s.residents[0].performedWorldMinutes,1);
 s=step(s,9,observation(s,9,{contact:true}));assert.equal(s.residents[0].performedWorldMinutes,2);assert.equal(s.residents[0].current,'release');
 s=step(s,10);assert.equal(s.residents[0].wait?.reason,'physical-release-pending');assert.equal(s.residents[0].completedAtMinute,null);
 s=step(s,11,observation(s,11,{release:true}));assert.equal(s.residents[0].current,null);assert.equal(s.residents[0].completedAtMinute,11);
 s=step(s,12,observation(s,12,{contact:true,release:true}));assert.equal(s.residents[0].performedWorldMinutes,2);assert.equal(s.residents[0].completedAtMinute,11);
});

test('saved contact progress and pending commands reproduce exactly without replay or missed-interval credit',()=>{
 let s=performing();s=step(s,4,observation(s,4,{contact:true,contactId:'already-consumed'}));
 const restored=parseResidentActionQueues(JSON.stringify(s),{worldKey,residentIds:[residentId],maximumMinute:4});assert.deepEqual(restored,s);
 let direct=step(s,5,observation(s,5,{contact:true,contactId:'already-consumed'}));let loaded=step(restored,5,observation(restored,5,{contact:true,contactId:'already-consumed'}));
 assert.deepEqual(loaded,direct);assert.equal(direct.residents[0].performedWorldMinutes,0,'Replayed ID never earns a new interval.');
 for(let minute=6;minute<=8;minute++){direct=step(direct,minute,observation(direct,minute,{contact:true}));loaded=step(loaded,minute,observation(loaded,minute,{contact:true}));assert.deepEqual(loaded,direct);}
 assert.equal(direct.residents[0].current,'release');assert.equal(direct.residents[0].performedWorldMinutes,2);
});

test('emergency suspension preserves the ordinary goal/progress and resumes through a real new approach',()=>{
 let s=performing();s=step(s,4,observation(s,4,{contact:true}));s=step(s,5,observation(s,5,{contact:true}));assert.equal(s.residents[0].performedWorldMinutes,1);
 const interruption:ResidentActionInterruption={id:'unit-local-fire',reason:'emergency',sinceMinute:6};s=step(s,6,observation(s,6,{contact:true}),interruption);
 const job=s.residents[0].jobId;s=step(parseResidentActionQueues(JSON.stringify(s)),7,observation(s,7,{contact:true}),interruption);
 assert.equal(s.residents[0].jobId,job);assert.equal(s.residents[0].performedWorldMinutes,1);assert.equal(s.residents[0].current,'perform');
 s=step(s,8,observation(s,8,{arrival:false}));assert.equal(s.residents[0].current,'approach');assert.equal(s.residents[0].performedWorldMinutes,1);assert.equal(s.residents[0].proof.leaseId,null);assert.equal(s.residents[0].wait?.reason,'approach-pending');
 s=step(s,9);assert.equal(s.residents[0].current,'reserve');assert.equal(s.residents[0].jobId,job);
});

test('source/goal invalidation never transfers a stale physical lease or erases another source cursor',()=>{
 let s=performing();const saved=JSON.stringify(s),changed={...source,sha256:'c'.repeat(64)};
 const held=advanceResidentActionQueues(s,{worldKey,absoluteMinute:4,source:changed,residents:[{residentId,goal,interruption:null}],observations:[{...observation(s,4),source:changed}]});
 assert.equal(held.residents[0].current,'perform');assert.equal(held.residents[0].wait?.reason,'source-changed');assert.equal(held.source!.sha256,source.sha256);assert.equal(JSON.stringify(s),saved);
 const next={...goal,key:'day0:new-job',targetPlaceId:'another-unmapped-workplace',issuedAbsoluteMinute:5};s=step(held,5,{...observation(s,5),arrival:null,destinationMapped:false},null,next);
 assert.equal(s.residents[0].current,'approach');assert.notEqual(s.residents[0].jobId,held.residents[0].jobId);assert.equal(s.residents[0].proof.leaseId,null);assert.equal(s.residents[0].performedWorldMinutes,0);
});

test('the consumed OpenGOAL timer/wake cursor gates retries but cannot satisfy any physical guard',()=>{
 let s=initial();const q=s.residents[0],wait=createResidentActionWait({worldKey,residentId,sourceKey:residentActionSourceKey(source),actionId:`${q.jobId}:approach`,token:1,atWorldMinute:0,retryAtWorldMinute:50,expiresAtWorldMinute:null,signalKey:'unit-source-ready',reason:'approach-pending'});
 s=parseResidentActionQueues({...s,residents:[{...q,wait,waitToken:1}]});s=step(s,1);assert.equal(s.residents[0].current,'approach','A ready physical destination does not bypass a delayed command.');
 const actual=s.residents[0].wait!,wake={worldKey,residentId,sourceKey:actual.sourceKey,actionId:actual.actionId,token:actual.token,signalKey:actual.signalKey!,atWorldMinute:2};
 const stale={...wake,token:0};s=advanceResidentActionQueues(s,{worldKey,absoluteMinute:2,source,residents:[{residentId,goal,interruption:null}],observations:[{...observation(s,2),arrival:null}],wakes:[stale,wake]});
 assert.equal(s.residents[0].current,'approach');assert.equal(s.residents[0].performedWorldMinutes,0);assert.ok(s.residents[0].waitToken>1,'An exact wake retries the still-false guard, then rearms a fresh token.');
 s=step(s,3);assert.equal(s.residents[0].current,'reserve');
});

test('queue saves reject unknown fields, forged phase order, getters, foreign wait identities and future progress',()=>{
 const s=performing(),before=JSON.stringify(s);assert.throws(()=>parseResidentActionQueues({...s,unknown:true}));
 assert.throws(()=>parseResidentActionQueues({...s,residents:[{...s.residents[0],pending:['approach']}]}));
 assert.throws(()=>parseResidentActionQueues({...s,residents:[{...s.residents[0],proof:{...s.residents[0].proof,arrivalId:null}}]}));
 assert.throws(()=>parseResidentActionQueues({...s,residents:[{...s.residents[0],completedAtMinute:100}]}));
 const hostile=Object.defineProperty({},'kind',{enumerable:true,get(){throw Error('Getter executed');}});assert.throws(()=>parseResidentActionQueues(hostile),e=>e instanceof Error&&!/Getter executed/.test(e.message));
 const empty=initial(),wait=createResidentActionWait({worldKey:'foreign-world',residentId,sourceKey:residentActionSourceKey(source),actionId:`${empty.residents[0].jobId}:approach`,token:1,atWorldMinute:0,retryAtWorldMinute:1,expiresAtWorldMinute:null,signalKey:null,reason:'waiting'});
 assert.throws(()=>parseResidentActionQueues({...empty,residents:[{...empty.residents[0],wait,waitToken:1}]}));assert.equal(JSON.stringify(s),before);
});


test('first source admission replaces only an unbound wait token and survives a zero-time save without command progress',()=>{
 let s=createResidentActionQueues(worldKey,0,[{residentId,goal}]);
 s=advanceResidentActionQueues(s,{worldKey,absoluteMinute:0,source:null,residents:[{residentId,goal,interruption:null}],observations:[{...observation(s,0),source:null,arrival:null}]});
 const before=s.residents[0],token=before.waitToken;assert.equal(before.wait!.sourceKey,null);
 s=step(s,0,{...observation(s,0),arrival:null});const q=s.residents[0];
 assert.equal(q.jobId,before.jobId);assert.equal(q.current,'approach');assert.deepEqual(q.pending,before.pending);assert.equal(q.performedWorldMinutes,0);
 assert.equal(q.wait,null);assert.equal(q.waitToken,token+1);assert.equal(s.source?.sha256,source.sha256);assert.deepEqual(parseResidentActionQueues(JSON.stringify(s)),s);
 s=step(s,1);assert.equal(s.residents[0].current,'reserve');
});


test('safety suspension preserves the original saved wait deadline, command cursor and contact history without spending the wait',()=>{
 let s=performing(),q=s.residents[0];
 const wait=createResidentActionWait({worldKey,residentId,sourceKey:residentActionSourceKey(source),actionId:q.jobId+':perform',token:8,atWorldMinute:3,retryAtWorldMinute:50,expiresAtWorldMinute:100,signalKey:'unit-contact-owner',reason:'action-contact-pending'});
 s=parseResidentActionQueues({...s,residents:[{...q,wait,waitToken:8,proof:{...q.proof,usedEventIds:['unit-already-consumed-contact']}}]});q=s.residents[0];
 const pause:ResidentActionInterruption={id:'unit-raid-suspension',reason:'safety',sinceMinute:4};
 for(const minute of [4,20,120]){s=step(parseResidentActionQueues(JSON.stringify(s)),minute,{...observation(s,minute),contacts:[]},pause);const held=s.residents[0];
  assert.deepEqual(held.wait,q.wait);assert.equal(held.waitToken,q.waitToken);assert.equal(held.current,q.current);assert.deepEqual(held.pending,q.pending);assert.deepEqual(held.proof,q.proof);assert.equal(held.performedWorldMinutes,0);}
 s=step(s,121,{...observation(s,121),arrival:null});assert.equal(s.residents[0].current,'approach');assert.equal(s.residents[0].completedAtMinute,null);assert.equal(s.residents[0].performedWorldMinutes,0);assert.deepEqual(s.residents[0].proof.usedEventIds,q.proof.usedEventIds);
});

test('an expired saved wait retries the same retained command without granting its missing physical prerequisite',()=>{
 let s=initial(),q=s.residents[0];const wait=createResidentActionWait({worldKey,residentId,sourceKey:residentActionSourceKey(source),actionId:q.jobId+':approach',token:1,atWorldMinute:0,retryAtWorldMinute:50,expiresAtWorldMinute:2,signalKey:'unit-destination-ready',reason:'approach-pending'});
 s=parseResidentActionQueues({...s,residents:[{...q,wait,waitToken:1}]});const job=q.jobId;
 s=step(s,2,{...observation(s,2),arrival:null});assert.equal(s.residents[0].current,'approach');assert.equal(s.residents[0].jobId,job);assert.equal(s.residents[0].performedWorldMinutes,0);
 assert.equal(s.residents[0].wait?.status,'waiting');assert.equal(s.residents[0].wait?.retryAtWorldMinute,3);assert.ok(s.residents[0].waitToken>1);
 s=step(parseResidentActionQueues(JSON.stringify(s)),3);assert.equal(s.residents[0].current,'reserve');assert.equal(s.residents[0].performedWorldMinutes,0);
});

test('station certificate, clip, source contact actor and duration changes discard old work and requalify before any new contact credit',()=>{
 const mutations=[(s:any)=>s.certificateSha256='d'.repeat(64),(s:any)=>s.clip='work_chisel',(s:any)=>s.proof.contactSourceActor='unit-rebuilt-anvil',(s:any)=>s.durationWorldMinutes=3];
 for(const mutate of mutations){let s=performing();s=step(s,4,observation(s,4,{contact:true}));s=step(s,5,observation(s,5,{contact:true}));assert.equal(s.residents[0].performedWorldMinutes,1);
  const obs=JSON.parse(JSON.stringify(observation(s,6,{contact:true})));mutate(obs.station);obs.contacts[0].clip=obs.station.clip;obs.contacts[0].contactSourceActor=obs.station.proof.contactSourceActor;
  s=step(s,6,obs);assert.equal(s.residents[0].current,'approach');assert.equal(s.residents[0].wait?.reason,'workstation-binding-changed');assert.equal(s.residents[0].performedWorldMinutes,0);assert.equal(s.residents[0].proof.stationBinding,null);
  assert.equal(s.residents[0].proof.lastContactMinute,null);assert.deepEqual(parseResidentActionQueues(JSON.stringify(s)),s);
 }
});

test('same-minute physical invalidation breaks contact continuity and target removal cannot retain old workstation credit',()=>{
 let s=performing();s=step(s,4,observation(s,4,{contact:true}));s=step(s,5,observation(s,5,{contact:true}));
 const held=step(s,5,{...observation(s,5),station:null});assert.equal(held.residents[0].proof.lastContactMinute,null);assert.equal(held.residents[0].performedWorldMinutes,1);
 s=step(held,6,observation(held,6,{contact:true}));assert.equal(s.residents[0].performedWorldMinutes,1,'A qualifier gap never completes a contact interval.');
 const invalid=step(s,6,{...observation(s,6),invalidatedTarget:true});assert.equal(invalid.residents[0].current,'approach');assert.equal(invalid.residents[0].performedWorldMinutes,0);assert.equal(invalid.residents[0].wait?.reason,'target-invalidated');assert.deepEqual(parseResidentActionQueues(JSON.stringify(invalid)),invalid);
});

test('saved physical progress must be reachable from a pinned station, enough accepted contacts and the exact command phase',()=>{
 const impossible=JSON.parse(JSON.stringify(initial()));impossible.residents[0].performedWorldMinutes=239;assert.throws(()=>parseResidentActionQueues(impossible),/station binding/);
 let s=performing();s=step(s,4,observation(s,4,{contact:true}));s=step(s,5,observation(s,5,{contact:true}));
 for(const corrupt of [(q:any)=>q.proof.stationBinding=null,(q:any)=>q.proof.contactCount=1,(q:any)=>q.proof.lastContactSequence=0,
  (q:any)=>q.proof.stationBinding.durationWorldMinutes=1,(q:any)=>q.proof.stationBinding.source.sha256='c'.repeat(64),(q:any)=>q.proof.usedEventIds=[]]){
  const bad=JSON.parse(JSON.stringify(s));corrupt(bad.residents[0]);assert.throws(()=>parseResidentActionQueues(bad));}
 const paused=step(s,6,observation(s,6),{id:'unit-safe-resume',reason:'safety',sinceMinute:6}),resumed=step(paused,7,{...observation(paused,7),arrival:null});
 assert.equal(resumed.residents[0].performedWorldMinutes,1);assert.equal(resumed.residents[0].current,'approach');assert.ok(resumed.residents[0].proof.stationBinding);assert.deepEqual(parseResidentActionQueues(JSON.stringify(resumed)),resumed);
});

function legacy(q:ResidentActionQueues):any{const s=JSON.parse(JSON.stringify(q));s.schemaVersion=1;for(const row of s.residents){delete row.proof.stationBinding;delete row.proof.contactCount;}return s;}
test('schema1 pending jobs migrate with identities, proven approach, waits and original deadlines unchanged',()=>{
 let s=initial();s=step(s,1,{...observation(s,1),arrival:null});let old=legacy(s),migrated=parseResidentActionQueues(old);assert.equal(migrated.schemaVersion,2);
 for(const name of ['jobId','goal','current','pending','wait','waitToken','interruption','performedWorldMinutes'] as const)assert.deepEqual(migrated.residents[0][name],s.residents[0][name]);
 s=step(s,2);old=legacy(s);migrated=parseResidentActionQueues(old);assert.equal(migrated.residents[0].current,'reserve');assert.equal(migrated.residents[0].proof.arrivalId,s.residents[0].proof.arrivalId);assert.equal(migrated.residents[0].performedWorldMinutes,0);assert.deepEqual(parseResidentActionQueues(JSON.stringify(migrated)),migrated);
});
test('schema1 active jobs explicitly reacquire an unpinned station without changing the job, destination or original wait deadline',()=>{
 let s=performing();s=step(s,4,observation(s,4,{contact:true}));s=step(s,5,observation(s,5,{contact:true}));s=step(s,6,observation(s,6,{contact:false}));
 const old=legacy(s),migrated=parseResidentActionQueues(old),q=migrated.residents[0],prior=s.residents[0];
 assert.equal(q.current,'reserve');assert.equal(q.jobId,prior.jobId);assert.deepEqual(q.goal,prior.goal);assert.equal(q.proof.arrivalId,prior.proof.arrivalId);assert.equal(q.performedWorldMinutes,0);assert.equal(q.proof.stationBinding,null);
 assert.equal(q.wait?.reason,'legacy-station-requalification');assert.equal(q.wait?.retryAtWorldMinute,prior.wait?.retryAtWorldMinute);assert.equal(q.wait?.expiresAtWorldMinute,prior.wait?.expiresAtWorldMinute);assert.ok(q.waitToken>prior.waitToken);assert.deepEqual(q.proof.usedEventIds,prior.proof.usedEventIds);
 const restored=parseResidentActionQueues(JSON.stringify(migrated));assert.deepEqual(restored,migrated);assert.equal(step(restored,7).residents[0].current,'face');
 const fabricated=legacy(initial());fabricated.residents[0].performedWorldMinutes=239;assert.throws(()=>parseResidentActionQueues(fabricated),/contact history/);
});

test('completed schema1 work stays explicitly rejected until its missing station proof has a supported migration',()=>{
 let s=performing();for(let minute=4;minute<=6;minute++)s=step(s,minute,observation(s,minute,{contact:true}));s=step(s,7,observation(s,7,{release:true}));assert.equal(s.residents[0].current,null);assert.deepEqual(parseResidentActionQueues(JSON.stringify(s)),s);
 const old=legacy(s),before=JSON.stringify(old);assert.throws(()=>parseResidentActionQueues(old),/explicit station-binding migration/);assert.equal(JSON.stringify(old),before,'Unsupported historical work is preserved for migration, never replayed or silently erased.');
});

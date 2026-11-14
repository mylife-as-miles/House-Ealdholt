import assert from 'node:assert/strict';
import test from 'node:test';
import {acquireWorldGeometryReader,bindWorldGeometryOwner,isWorldGeometryReaderActive} from './world-geometry-readers';
import {createWorldOwnerRetirement} from './world-owner-retirement';

const deferred=()=>{let resolve!:()=>void,reject!:(reason:unknown)=>void;return{promise:new Promise<void>((yes,no)=>{resolve=yes;reject=no;}),resolve,reject};};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

test('prepared binding publication accepts raw source but rejects every nonactive private geometry phase',async()=>{
 assert.equal(isWorldGeometryReaderActive({}),true);
 for(const failure of[false,true]){const geometry={},producer=deferred(),gpu=deferred(),cleanup=deferred();
  const owner=createWorldOwnerRetirement({stop(){},producer:()=>producer.promise,fence:()=>gpu.promise,releaseOwned:()=>cleanup.promise,releaseCredit(){}});bindWorldGeometryOwner(geometry,owner);assert.equal(isWorldGeometryReaderActive(geometry),true);assert.equal(owner.stats.acquired,0,'A readonly readiness gate must not allocate a reader.');
  const done=owner.retire();assert.equal(owner.stats.phase,'draining');assert.equal(isWorldGeometryReaderActive(geometry),false);producer.resolve();await flush();assert.equal(owner.stats.phase,'fencing');assert.equal(isWorldGeometryReaderActive(geometry),false);
  if(failure){gpu.reject(Error('Held context fence.'));await assert.rejects(done,/Held context/);assert.equal(owner.stats.phase,'held');assert.equal(isWorldGeometryReaderActive(geometry),false);}
  else{gpu.resolve();await flush();assert.equal(owner.stats.phase,'releasing');assert.equal(isWorldGeometryReaderActive(geometry),false);cleanup.resolve();await done;assert.equal(owner.stats.phase,'retired');assert.equal(isWorldGeometryReaderActive(geometry),false);}
 }
});

test('admission registers a private geometry reader before retirement and holds views, raw refs and credit through its completion',async()=>{
 const geometry={},reader=deferred(),gpu=deferred(),events:string[]=[];
 const owner=createWorldOwnerRetirement({stop:()=>{events.push('stop');},producer:()=>Promise.resolve(),fence:()=>{events.push('fence');return gpu.promise;},releaseOwned:()=>{events.push('views');},releaseCredit:()=>{events.push('credit');}});
 bindWorldGeometryOwner(geometry,owner);
 const lease=acquireWorldGeometryReader(geometry,()=>{events.push('clone-enqueue');return{ready:reader.promise,release:()=>{events.push('reader-ref');}};});assert.ok(lease);
 lease.release();const done=owner.retire();await flush();assert.deepEqual(events,['clone-enqueue','stop']);
 let late=0;assert.equal(acquireWorldGeometryReader(geometry,()=>{late++;return{ready:Promise.resolve(),release(){}};}),null);assert.equal(late,0,'No detached clone or late job may be allocated.');
 reader.resolve();await flush();assert.deepEqual(events,['clone-enqueue','stop','fence']);gpu.resolve();await done;
 assert.deepEqual(events,['clone-enqueue','stop','fence','views','reader-ref','credit']);
 assert.equal(acquireWorldGeometryReader(geometry,()=>{late++;return{ready:Promise.resolve(),release(){}};}),null);assert.equal(late,0,'The private geometry remains tagged after cleanup.');
});

test('source/global geometry keeps its existing caller-owned barrier and does not join a different near owner',async()=>{
 const source={},a={},b={},pending=deferred();let globalCalls=0,creditA=0,creditB=0;
 const make=(credit:()=>void)=>createWorldOwnerRetirement({stop(){},producer:()=>Promise.resolve(),fence:async()=>{},releaseOwned(){},releaseCredit:credit});
 const first=make(()=>{creditA++;}),second=make(()=>{creditB++;});bindWorldGeometryOwner(a,first);bindWorldGeometryOwner(b,second);
 acquireWorldGeometryReader(b,()=>({ready:pending.promise,release(){}}));
 const raw=acquireWorldGeometryReader(source,()=>{globalCalls++;return{ready:Promise.resolve(),release(){}};});assert.ok(raw);assert.equal(globalCalls,1);
 await first.retire();const done=second.retire();await flush();assert.equal(creditA,1);assert.equal(creditB,0);
 pending.resolve();await done;assert.equal(creditB,1);assert.throws(()=>bindWorldGeometryOwner(a,second),/already has an owner/);
});

test('cancelled or failed related jobs settle before the fresh fence; a failed fence retains ownership',async()=>{
 for(const failFence of[false,true]){const geometry={},reader=deferred(),events:string[]=[];
  const owner=createWorldOwnerRetirement({stop(){},producer:()=>Promise.resolve(),fence:async()=>{events.push('fence');if(failFence)throw Error('Context fence unavailable.');},releaseOwned:()=>{events.push('views');},releaseCredit:()=>{events.push('credit');}});
  bindWorldGeometryOwner(geometry,owner);acquireWorldGeometryReader(geometry,()=>({ready:reader.promise,release:()=>{events.push('reader-ref');}}));const done=owner.retire();await flush();assert.deepEqual(events,[]);
  reader.reject(Error('Cancelled related compile.'));if(failFence)await assert.rejects(done,/Context fence unavailable/);else await done;
  assert.deepEqual(events,failFence?['fence']:['fence','views','reader-ref','credit']);assert.equal(owner.stats.readyRejected,1);
 }
});

test('bounded admission rejects before the external factory runs and preserves real factory errors',async()=>{
 const geometry={},owner=createWorldOwnerRetirement({maximumLeases:1,stop(){},producer:()=>Promise.resolve(),fence:async()=>{},releaseOwned(){},releaseCredit(){}});
 bindWorldGeometryOwner(geometry,owner);let factories=0;
 assert.throws(()=>acquireWorldGeometryReader(geometry,()=>{throw Error('Real clone failure.');}),/Real clone failure/);
 acquireWorldGeometryReader(geometry,()=>({ready:Promise.resolve(),release(){}}));
 assert.equal(acquireWorldGeometryReader(geometry,()=>{factories++;return{ready:Promise.resolve(),release(){}};}),null);assert.equal(factories,0);await owner.retire();
});

test('synchronous retirement inside admission still waits for the returned related readiness without a cycle',async()=>{
 const geometry={},reader=deferred(),events:string[]=[];let done:Promise<void>|undefined;
 const owner=createWorldOwnerRetirement({stop(){},producer:()=>Promise.resolve(),fence:async()=>{events.push('fence');},releaseOwned:()=>owner.fenced.then(()=>{events.push('views');}),releaseCredit:()=>{events.push('credit');}});
 bindWorldGeometryOwner(geometry,owner);
 acquireWorldGeometryReader(geometry,()=>{done=owner.retire();return{ready:reader.promise,release(){}};});await flush();assert.deepEqual(events,[]);
 reader.resolve();await done;assert.deepEqual(events,['fence','views','credit']);
});

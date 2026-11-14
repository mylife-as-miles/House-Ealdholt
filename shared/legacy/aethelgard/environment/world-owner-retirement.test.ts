import assert from 'node:assert/strict';
import test from 'node:test';
import {assertWorldOwnerQuiescence,createWorldOwnerRetirement} from './world-owner-retirement';
import {createVegetationResourcePool} from './vegetation-resource-pool';

const deferred=<T=void>()=>{let resolve!:(value:T|PromiseLike<T>)=>void,reject!:(cause:unknown)=>void;
  return{promise:new Promise<T>((yes,no)=>{resolve=yes;reject=no;}),resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

test('a complete producer and every late acquired readiness precede the fresh fence and credit',async()=>{
  const producer=deferred(),first=deferred(),late=deferred(),gpu=deferred(),events:string[]=[];
  const owner=createWorldOwnerRetirement({stop:()=>{events.push('detach-abort');},producer:()=>producer.promise,
    fence:proof=>{assertWorldOwnerQuiescence(proof);events.push('fence');return gpu.promise;},
    releaseOwned:()=>{events.push('views');},releaseCredit:()=>{events.push('credit');}});
  const lease=owner.acquire(()=>({ready:first.promise,release:()=>{events.push('first-ref');}}));
  lease.release();const retirement=owner.retire();assert.equal(owner.retire(),retirement);
  assert.deepEqual(events,['detach-abort']);first.resolve();await flush();assert.equal(owner.stats.pendingReady,0);
  assert.equal(owner.stats.phase,'draining','A temporary empty queue/readiness set cannot seal the running producer.');
  owner.acquire(()=>({ready:late.promise,release:()=>{events.push('late-ref');}}));
  producer.resolve();await flush();assert.deepEqual(events,['detach-abort']);late.resolve();await flush();
  assert.deepEqual(events,['detach-abort','fence']);assert.equal(owner.stats.released,0);
  let illegalFactories=0;assert.throws(()=>owner.acquire(()=>{illegalFactories++;return{ready:Promise.resolve(),release(){}};}),/sealed/);
  assert.equal(illegalFactories,0,'The scope rejects a late acquisition before asking the raw pool to allocate it.');
  gpu.resolve();await retirement;assert.deepEqual(events,['detach-abort','fence','views','first-ref','late-ref','credit']);
  assert.equal(owner.stats.released,2);assert.equal(owner.stats.phase,'retired');lease.release();await owner.retire();
  assert.equal(events.filter(e=>e==='credit').length,1);
});

test('producer abort/failure still drains tracked children, including a child that rejects later',async()=>{
  const producer=deferred(),child=deferred(),events:string[]=[];
  const owner=createWorldOwnerRetirement({stop(){},producer:()=>producer.promise,
    fence:async()=>{events.push('fence');},releaseOwned(){},releaseCredit:()=>{events.push('credit');}});
  owner.acquire(()=>({ready:child.promise,release:()=>{events.push('ref');}}));
  const done=owner.retire();producer.reject(Error('Owner aborted.'));await flush();assert.deepEqual(events,[]);
  child.reject(Error('Cancelled compilation settled.'));await done;
  assert.deepEqual(events,['fence','ref','credit']);assert.equal(owner.stats.producerRejected,true);assert.equal(owner.stats.readyRejected,1);
});

test('readiness continuations may acquire a late child after the producer fails, without escaping the drain',async()=>{
  const producer=deferred(),first=deferred(),late=deferred(),events:string[]=[];
  const owner=createWorldOwnerRetirement({stop(){},producer:()=>producer.promise,fence:async()=>{events.push('fence');},
    releaseOwned(){},releaseCredit:()=>{events.push('credit');}});
  owner.acquire(()=>({ready:first.promise,release:()=>{events.push('first-ref');}}));
  void first.promise.then(()=>{owner.acquire(()=>({ready:late.promise,release:()=>{events.push('late-ref');}}));});
  const done=owner.retire();producer.reject(Error('Sibling preparation failed.'));await flush();
  first.resolve();await flush();assert.deepEqual(events,[]);assert.equal(owner.stats.pendingReady,1);
  late.resolve();await done;assert.deepEqual(events,['fence','first-ref','late-ref','credit']);
});

test('the separate fenced gate permits dependent owned-view cleanup without a producer/retirement cycle',async()=>{
  const producer=deferred(),gpu=deferred(),events:string[]=[];let views:Promise<void>;
  const owner=createWorldOwnerRetirement({stop:()=>{events.push('stop');views=producer.promise.then(()=>owner.fenced).then(()=>{events.push('views');});},
    producer:()=>producer.promise,fence:()=>gpu.promise,releaseOwned:()=>views,releaseCredit:()=>{events.push('credit');}});
  const done=owner.retire();producer.resolve();await flush();assert.deepEqual(events,['stop']);
  gpu.resolve();await done;assert.deepEqual(events,['stop','views','credit']);
});

test('a failed GPU fence retains all resources and credit and never resolves the dependent view gate',async()=>{
  let refs=0,credits=0,views=0,fenced=false;
  const owner=createWorldOwnerRetirement({stop(){},producer:()=>Promise.resolve(),fence:async()=>{throw Error('GPU fence failed.');},
    releaseOwned:()=>{views++;},releaseCredit:()=>{credits++;}});
  owner.acquire(()=>({ready:Promise.resolve(),release:()=>{refs++;}}));void owner.fenced.then(()=>{fenced=true;});
  const result=owner.retire();await assert.rejects(result,/GPU fence failed/);await flush();
  assert.equal(owner.stats.phase,'held');assert.equal(owner.stats.error,'GPU fence failed.');
  assert.equal(refs+credits+views,0);assert.equal(fenced,false);assert.equal(owner.retire(),result);
});

test('retiring one owner cannot evict another live owner’s shared resource reference',async()=>{
  let disposed=0,credits=0;const pool=createVegetationResourcePool<{bytes:number;dispose():void}>(1024);
  const build=async()=>({bytes:20,dispose:()=>{disposed++;}});
  const owner=createWorldOwnerRetirement({stop(){},producer:()=>Promise.resolve(),fence:async()=>{},releaseOwned(){},releaseCredit:()=>{credits++;}});
  const first=owner.acquire(()=>pool.acquire('shared',20,build)),peer=pool.acquire('shared',20,build);
  await Promise.all([first.ready,peer.ready]);first.release();pool.trim();assert.equal(disposed,0);
  await owner.retire();pool.trim();assert.equal(credits,1);assert.equal(disposed,0,'The peer still owns its paid reference.');
  peer.release();pool.trim();assert.equal(disposed,1);pool.dispose();assert.equal(disposed,1);
});

test('only ready explicitly never-submitted geometry can bypass retirement, once, using the real pool',async()=>{
  let disposed=0;const ready=deferred<{bytes:number;dispose():void}>(),pool=createVegetationResourcePool<{bytes:number;dispose():void}>(1024);
  const owner=createWorldOwnerRetirement({stop(){},producer:()=>Promise.resolve(),fence:async()=>{},releaseOwned(){},releaseCredit(){}});
  const lease=owner.acquire(()=>{const base=pool.acquire('rejected-l2',20,()=>ready.promise);return{...base,releaseUnsubmitted:base.release};});
  assert.throws(()=>lease.releaseUnsubmitted!(),/Only a ready/);pool.trim();assert.equal(disposed,0);
  ready.resolve({bytes:20,dispose:()=>{disposed++;}});await lease.ready;
  lease.releaseUnsubmitted!();lease.releaseUnsubmitted!();pool.trim();assert.equal(disposed,1,'Rejected-ready geometry is reclaimable while its former owner lives.');
  await owner.retire();assert.equal(owner.stats.released,1);assert.equal(owner.stats.unsubmittedReleased,1);
  pool.dispose();assert.equal(disposed,1);
});

test('normal release cannot free a pending raw lease, and child readiness registration stays bounded',async()=>{
  const ready=deferred();let released=0,factories=0;
  const owner=createWorldOwnerRetirement({maximumLeases:1,stop(){},producer:()=>Promise.resolve(),fence:async()=>{},releaseOwned(){},releaseCredit(){}});
  const lease=owner.acquire(()=>({ready:ready.promise,release:()=>{released++;}}));lease.release();assert.equal(released,0);
  assert.throws(()=>owner.acquire(()=>{factories++;return{ready:Promise.resolve(),release(){}};}),/bounded/);assert.equal(factories,0);
  assert.throws(()=>owner.trackReady(Promise.resolve()),/bounded/);
  const done=owner.retire();await flush();assert.equal(released,0);ready.resolve();await done;assert.equal(released,1);
});

test('failed synchronous stop holds ownership and reentrant stop sees the same retirement promise',async()=>{
  let released=0,producer=0;const failure=Error('Detach failed.');
  const held=createWorldOwnerRetirement({stop:()=>{throw failure;},producer:()=>{producer++;return Promise.resolve();},fence:async()=>{},releaseOwned(){},releaseCredit:()=>{released++;}});
  await assert.rejects(held.retire(),/Detach failed/);assert.equal(held.stats.phase,'held');assert.equal(producer+released,0);
  let nested:Promise<void>|undefined;
  const owner=createWorldOwnerRetirement({stop:()=>{nested=owner.retire();},producer:()=>Promise.resolve(),fence:async()=>{},releaseOwned(){},releaseCredit(){}});
  const done=owner.retire();assert.equal(nested,done);await done;
  for(const limit of[0,-1,1.5,4097])assert.throws(()=>createWorldOwnerRetirement({maximumLeases:limit,stop(){},producer:()=>Promise.resolve(),fence:async()=>{},releaseOwned(){},releaseCredit(){}}),/Invalid/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {createRegionLifecycle,type RegionRequest,type RegionPhase} from './region-lifecycle';
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(overrides:{maxDetached?:number;idleMs?:number;maxFailures?:number;retryDelayMs?:number}={}){
 type Resource={name:string};
 const jobs:{request:RegionRequest;resolve:(r:Resource)=>void;reject:(cause:Error)=>void}[]=[],events:string[]=[],phases:RegionPhase[]=[];
 let time=0;
 const manager=createRegionLifecycle<Resource>({keys:['fort:far','fort:full','temple:full'],maxDetached:1,idleMs:1_000,maxFailures:3,retryDelayMs:100,...overrides,
  now:()=>time,load(request){return new Promise((resolve,reject)=>jobs.push({request,resolve,reject}));},
  attach(r){events.push('attach:'+r.name);},detach(r){events.push('detach:'+r.name);},release(r){events.push('release:'+r.name);},
  changed(){if(manager)for(const r of manager.records)phases.push(r.phase);},
 });
 return{manager,jobs,events,phases,time:(value:number)=>{time=value;}};
}

test('a current preparation attaches, detaches, then becomes independently evictable',async t=>{
 const f=fixture();t.after(()=>f.manager.dispose());const request=f.manager.request('fort:far','source-owner')!;
 assert.equal(request.isCurrent(),true);assert.equal(f.manager.records[0].phase,'loading');await settle();
 f.jobs[0].resolve({name:'far'});await settle();assert.equal(f.manager.records[0].phase,'prepared');
 assert.equal(f.manager.attach('fort:far','wrong-owner'),false);assert.equal(f.manager.attach('fort:far','source-owner'),true);
 f.manager.unretain('fort:far','source-owner');f.manager.sweep();assert.equal(f.manager.records[0].phase,'attached','attached content is never selected for cache eviction');
 f.time(100);f.manager.detach('fort:far','source-owner');assert.equal(f.manager.records[0].lastUsedMs,100);
 f.time(1_100);f.manager.sweep();assert.equal(f.manager.records[0].phase,'evicted');assert.equal(request.signal.aborted,true);
 assert.ok(f.phases.includes('evictable'));assert.deepEqual(f.events,['attach:far','detach:far','release:far']);
 assert.equal(f.manager.records[0].resident,false);assert.equal(f.manager.records[0].currentRequest?.cancelled,true);
});

test('owner replacement rejects late completion and stale attachment handles',async t=>{
 const f=fixture();t.after(()=>f.manager.dispose());const old=f.manager.request('fort:full','source-A')!;await settle();
 const fresh=f.manager.request('fort:full','source-B')!;await settle();
 assert.equal(old.signal.aborted,true);assert.equal(old.isCurrent(),false);assert.ok(fresh.generation>old.generation);
 f.jobs[1].resolve({name:'new'});await settle();assert.equal(f.manager.attach('fort:full','source-B'),true);
 f.jobs[0].resolve({name:'obsolete'});await settle();
 assert.equal(f.manager.attach('fort:full','source-A'),false);assert.equal(f.manager.records[0].owner,'source-B');
 assert.equal(f.manager.records[0].currentRequest?.generation,fresh.generation);
 assert.deepEqual(f.events,['attach:new','release:obsolete']);
});

test('retreat and immediate return use a fresh generation when an uncancellable load finishes late',async t=>{
 const f=fixture();t.after(()=>f.manager.dispose());const old=f.manager.request('fort:full','same-owner')!;await settle();
 f.manager.unretain('fort:full','same-owner');assert.equal(f.manager.records[0].phase,'cancelled');
 const fresh=f.manager.request('fort:full','same-owner')!;await settle();
 f.jobs[0].resolve({name:'old'});await settle();assert.equal(f.manager.resource('fort:full','same-owner'),null);
 f.jobs[1].resolve({name:'returned'});await settle();assert.equal(f.manager.attach('fort:full','same-owner'),true);
 assert.equal(fresh.isCurrent(),true);assert.equal(old.isCurrent(),false);assert.deepEqual(f.events,['release:old','attach:returned']);
});

test('dispose cancels all current owners and releases each preparation once despite late completions',async()=>{
 const f=fixture();const prepared=f.manager.request('fort:far','a')!,late=f.manager.request('fort:full','a')!;await settle();
 f.jobs[0].resolve({name:'ready'});await settle();f.manager.attach('fort:far','a');f.manager.dispose();f.manager.dispose();
 f.jobs[1].resolve({name:'late'});await settle();assert.equal(prepared.signal.aborted,true);assert.equal(late.signal.aborted,true);
 assert.deepEqual(f.events,['attach:ready','detach:ready','release:ready','release:late']);assert.equal(f.manager.request('fort:far','b'),null);
});

test('detached residency has an LRU slot bound while retained fallback and attached content survive',async t=>{
 const f=fixture();t.after(()=>f.manager.dispose());
 for(const key of ['fort:far','fort:full','temple:full']){f.manager.request(key,'owner');await settle();f.jobs[f.jobs.length-1].resolve({name:key});await settle();f.manager.attach(key,'owner');}
 f.manager.detach('fort:far','owner'); // retained fallback is protected
 f.manager.unretain('fort:full','owner');f.manager.detach('fort:full','owner');f.time(10);
 f.manager.unretain('temple:full','owner');f.manager.detach('temple:full','owner');f.manager.sweep();
 assert.equal(f.manager.records.find(r=>r.key==='fort:full')!.phase,'evicted');
 assert.equal(f.manager.records.find(r=>r.key==='temple:full')!.phase,'detached');
 assert.equal(f.manager.records.find(r=>r.key==='fort:far')!.phase,'detached');
 assert.deepEqual(f.events.filter(x=>x.startsWith('release:')),['release:fort:full']);
});

test('failed loads have backoff and a finite budget; frame requests never rearm exhaustion',async t=>{
 const f=fixture({maxFailures:2});t.after(()=>f.manager.dispose());f.manager.request('fort:full','owner');await settle();
 f.jobs[0].reject(Error('first'));await settle();
 for(let i=0;i<100;i++)f.manager.request('fort:full','owner');await settle();assert.equal(f.jobs.length,1);
 f.time(100);f.manager.request('fort:full','owner');await settle();f.jobs[1].reject(Error('second'));await settle();
 f.time(100_000);for(let i=0;i<100;i++)f.manager.request('fort:full','owner');await settle();assert.equal(f.jobs.length,2);
 assert.equal(f.manager.records[0].retryExhausted,true);assert.equal(f.manager.records[0].error,'Error: second');
 f.manager.retry('fort:full','owner');const recovered=f.manager.request('fort:full','owner')!;await settle();f.jobs[2].resolve({name:'recovered'});await settle();
 assert.equal(recovered.isCurrent(),true);assert.equal(f.manager.records[0].failures,0);assert.equal(f.manager.records[0].retryExhausted,false);
});

test('a retry emits an ordinary owner wake and idle preparations expire without frame polling',async t=>{
 const f=fixture({idleMs:10,retryDelayMs:10});t.after(()=>f.manager.dispose());f.manager.request('fort:far','owner');await settle();
 f.jobs[0].reject(Error('temporary'));await settle();const before=f.phases.length;
 await new Promise(resolve=>setTimeout(resolve,25));assert.ok(f.phases.length>before,'retry deadline wakes the existing caller');
 f.time(25);f.manager.request('fort:far','owner');await settle();f.jobs[1].resolve({name:'expired'});await settle();
 f.manager.unretain('fort:far','owner');await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(f.manager.records[0].phase,'evicted');assert.deepEqual(f.events,['release:expired']);
});

test('a fixed inventory rejects arbitrary camera keys and invalid policies',()=>{
 const f=fixture();try{assert.throws(()=>f.manager.request('invented-coordinate','owner'),/inventory key/);}finally{f.manager.dispose();}
 assert.throws(()=>fixture({maxDetached:-1}),/policy/);assert.throws(()=>fixture({maxFailures:0}),/policy/);
});

test('a prepared observer can dispose its owner before the attachment callback is admitted',async()=>{
 let resolve!:(value:{name:string})=>void,prepared=0,released=0;
 const manager=createRegionLifecycle<{name:string}>({keys:['fort:far'],maxDetached:0,idleMs:10,maxFailures:1,retryDelayMs:10,
  load:()=>new Promise(done=>{resolve=done;}),attach(){throw Error('unexpected attachment');},detach(){},release(){released++;},
  changed(){if(manager.records[0]?.phase==='prepared')manager.dispose();},prepared(){prepared++;},
 });
 manager.request('fort:far','owner');await settle();resolve({name:'cancelled-at-publication'});await settle();
 assert.equal(prepared,0);assert.equal(released,1);assert.equal(manager.records[0].phase,'evicted');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorldBakeCache,type WorldBakeRecord,type WorldBakeStore} from './world-bake-cache';

const key='v1:vegetation-atlas:'+'a'.repeat(64),blob={metadata:'{}',data:new Uint8Array([1,2,3])};
const deferred=<T>()=>{let resolve!:(value:T)=>void,reject!:(cause:unknown)=>void;
  return{promise:new Promise<T>((yes,no)=>{resolve=yes;reject=no;}),resolve,reject};};
const bare:WorldBakeStore={async get(){return undefined;},async put(record){return{bytes:record.bytes,entries:1,evicted:0};},async remove(){},async clear(){},close(){}};
async function seed(){
  let record!:WorldBakeRecord;const writer=createWorldBakeCache({store:{...bare,async put(value){record=value;return{bytes:value.bytes,entries:1,evicted:0};}}});
  assert.equal(await writer.put(key,blob),true);writer.close();return record;
}
const timeout=()=>Error('Environment cache transaction timed out.');

test('a failed lookup keeps health false when a different in-flight valid hit completes',async()=>{
  const record=await seed(),failure=deferred<WorldBakeRecord|undefined>(),success=deferred<WorldBakeRecord|undefined>();let gets=0,puts=0;
  const cache=createWorldBakeCache({store:{...bare,get(){return++gets===1?failure.promise:success.promise;},async put(value,limits){puts++;return bare.put(value,limits);}}});
  const a=cache.get(key,()=>true),b=cache.get(key,()=>true);assert.equal(gets,2);
  failure.reject(timeout());assert.equal(await a,null);assert.equal(cache.stats.available,false);
  success.resolve(record);assert.deepEqual(await b,blob);assert.equal(cache.stats.hits,1);assert.equal(cache.stats.available,false);
  assert.equal(cache.stats.warning,'Environment cache transaction timed out.');
  assert.deepEqual(cache.stats.lastFailure,{operation:'get',context:'get',kind:'vegetation-atlas'});
  assert.ok(Object.isFrozen(cache.stats.lastFailure));assert.ok(!JSON.stringify(cache.stats.lastFailure).includes(key));assert.ok(!JSON.stringify(cache.stats.lastFailure).includes('a'.repeat(64)));
  assert.equal(await cache.get(key,()=>true),null);assert.equal(await cache.put(key,blob),false);assert.equal(gets,2);assert.equal(puts,0,'The existing failure latch still suppresses new I/O.');
  cache.close();
});

test('a late in-flight miss cannot report a failed store as available',async()=>{
  const a=deferred<WorldBakeRecord|undefined>(),b=deferred<WorldBakeRecord|undefined>();let calls=0;
  const cache=createWorldBakeCache({store:{...bare,get(){return++calls===1?a.promise:b.promise;}}});
  const first=cache.get(key,()=>true),second=cache.get(key,()=>true);a.reject(timeout());await first;b.resolve(undefined);assert.equal(await second,null);
  assert.equal(cache.stats.misses,2);assert.equal(cache.stats.available,false);assert.equal(cache.stats.lastFailure?.operation,'get');cache.close();
});

test('a failed usage scan is labelled separately and a concurrent warm hit cannot reopen health',async()=>{
  const record=await seed(),first=deferred<{bytes:number;entries:number}>(),second=deferred<{bytes:number;entries:number}>(),both=deferred<void>();let usages=0,gets=0;
  const cache=createWorldBakeCache({store:{...bare,async get(){gets++;return record;},usage(){const n=++usages;if(n===2)both.resolve();return n===1?first.promise:second.promise;}}});
  const a=cache.get(key,()=>true),b=cache.get(key,()=>true);await both.promise;
  first.reject(timeout());assert.equal(await Promise.race([a,b]),null);assert.equal(cache.stats.available,false);
  second.resolve({bytes:record.bytes,entries:1});const results=await Promise.all([a,b]);assert.equal(results.filter(Boolean).length,1);
  assert.equal(cache.stats.hits,1);assert.equal(cache.stats.bytes,record.bytes);assert.equal(cache.stats.entries,1);assert.equal(cache.stats.available,false);
  assert.deepEqual(cache.stats.lastFailure,{operation:'usage',context:'get',kind:'vegetation-atlas'});assert.equal(cache.stats.warning,'Environment cache transaction timed out.');
  await cache.get(key,()=>true);assert.equal(gets,2);assert.equal(usages,2);cache.close();
});

test('an in-flight successful write retains its accounting after a concurrent write failure, with health still held',async()=>{
  const first=deferred<{bytes:number;entries:number;evicted:number}>(),second=deferred<{bytes:number;entries:number;evicted:number}>(),both=deferred<void>();let calls=0;
  const cache=createWorldBakeCache({store:{...bare,put(){const n=++calls;if(n===2)both.resolve();return n===1?first.promise:second.promise;}}});
  const a=cache.put(key,blob),b=cache.put(key,blob);await both.promise;first.reject(timeout());assert.equal(await Promise.race([a,b]),false);
  second.resolve({bytes:5,entries:1,evicted:0});const results=await Promise.all([a,b]);assert.deepEqual(results.sort(),[false,true]);
  assert.equal(cache.stats.writes,1);assert.equal(cache.stats.available,false);assert.deepEqual(cache.stats.lastFailure,{operation:'put',context:'put',kind:'vegetation-atlas'});
  assert.equal(await cache.put(key,blob),false);assert.equal(calls,2);cache.close();
});

test('invalid-record removal, clear and close failures retain exact operation context without changing fallback policy',async()=>{
  const record=await seed(),invalid={...record,schema:2}as unknown as WorldBakeRecord;
  const cache=createWorldBakeCache({store:{...bare,async get(){return invalid;},async remove(){throw timeout();}}});
  assert.equal(await cache.get(key,()=>true),null);assert.deepEqual(cache.stats.lastFailure,{operation:'remove',context:'get',kind:'vegetation-atlas'});
  assert.equal(cache.stats.invalid,1);assert.equal(cache.stats.available,false);
  assert.equal(await cache.clear(),true);assert.equal(cache.stats.lastFailure,null);assert.equal(cache.stats.warning,'');assert.equal(cache.stats.available,true);cache.close();
  const clearing=createWorldBakeCache({store:{...bare,async clear(){throw timeout();},close(){throw Error('Close failed.');}}});
  assert.equal(await clearing.clear(),false);assert.deepEqual(clearing.stats.lastFailure,{operation:'clear',context:'clear',kind:null});
  assert.doesNotThrow(()=>clearing.close());assert.deepEqual(clearing.stats.lastFailure,{operation:'close',context:'close',kind:null});assert.equal(clearing.stats.available,false);
});

test('obsolete failures and late success from a cleared generation cannot overwrite its new health metadata',async()=>{
  const first=deferred<WorldBakeRecord|undefined>(),second=deferred<WorldBakeRecord|undefined>();let calls=0;
  const cache=createWorldBakeCache({store:{...bare,get(){return++calls===1?first.promise:second.promise;}}});
  const a=cache.get(key,()=>true),b=cache.get(key,()=>true);await cache.clear();first.reject(timeout());second.resolve(undefined);await Promise.all([a,b]);
  assert.equal(cache.stats.available,true);assert.equal(cache.stats.lastFailure,null);assert.equal(cache.stats.warning,'');cache.close();
});

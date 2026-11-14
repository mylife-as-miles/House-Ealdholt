import assert from 'node:assert/strict';
import test from 'node:test';
import {PerspectiveCamera,Scene,type WebGLRenderer} from 'three';
import {scopeOwnedVegetationResources} from './owned-vegetation-resources';
import type {VegetationPrototypeResources} from './vegetation-prototype';
import {createWorldOwnerRetirement} from '../../../../shared/legacy/aethelgard/environment/world-owner-retirement';
import {createVegetationResourcePool} from '../../../../shared/legacy/aethelgard/environment/vegetation-resource-pool';
import {createWorldResourceRetirementFence} from './world-resource-retirement';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};

test('raw scoped leases drain late complete production, fence submitted work, clean private buffers, then return bytes/credit despite unrelated busy queue',async()=>{
 const pool=createVegetationResourcePool<{bytes:number;dispose():void}>(65536,20);let queueIdle!:()=>void,idleCalls=0,producerDone=false,fences=0,cleanup=false,credit=0,stopped=false,late!:()=>void;
 const busy=new Promise<void>(resolve=>{queueIdle=resolve;}),queue={whenIdle(){idleCalls++;return busy;}}as unknown as WorldPreparationQueue;
 const gl={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,TIMEOUT_EXPIRED:3,WAIT_FAILED:4,isContextLost:()=>false,fenceSync(){assert.equal(producerDone,true);fences++;return{};},flush(){},clientWaitSync:()=>2,deleteSync(){}};
 const fence=createWorldResourceRetirementFence({getContext:()=>gl}as unknown as WebGLRenderer,queue),production=new Promise<void>(resolve=>{late=resolve;});
 const base={stats:pool.stats,ownerBuffers:(key:string,bytes:number)=>pool.acquire('buffers:'+key,bytes,async()=>({bytes,dispose(){}})),compile:(key:string)=>pool.acquire('compile:'+key,1,async()=>({bytes:1,dispose(){}})),dispose(){assert.fail('local facade must not dispose the world pool');}}as unknown as VegetationPrototypeResources;
 const reservation=base.ownerBuffers('private',32768);let resources:VegetationPrototypeResources;
 const owner=createWorldOwnerRetirement({stop(){stopped=true;},producer:async()=>{await production;const job=resources.compile('late-child',[],new PerspectiveCamera(),new Scene());await job.ready;producerDone=true;},fence:proof=>fence.afterOwnerQuiescent(proof),async releaseOwned(){await owner.fenced;cleanup=true;},releaseCredit(){assert.equal(cleanup,true);pool.trim();assert.equal(pool.stats.bytes,32768,'raw refs return before byte credit');reservation.release();pool.trim();assert.equal(pool.stats.bytes,0);credit++;}});
 resources=scopeOwnedVegetationResources(base,owner);owner.trackReady(reservation.ready);await reservation.ready;const normal=resources.compile('initial',[],new PerspectiveCamera(),new Scene());await normal.ready;normal.release();
 const retirement=owner.retire();await tick();assert.equal(stopped,true);assert.equal(credit,0);assert.equal(pool.stats.bytes,32769);assert.equal(fences,0);
 late();await retirement;assert.equal(fences,1);assert.equal(idleCalls,0,'local owner must never wait for unrelated global idleness');assert.equal(credit,1);pool.trim();assert.equal(pool.stats.bytes,0);resources.dispose();
 const global=fence();await tick();assert.equal(idleCalls,1);assert.equal(fence.stats.completed,1,'whole-view barrier is still pending');queueIdle();await global;assert.equal(fence.stats.completed,2);pool.dispose();
});

test('active related raw leases protect shared geometry while ready never-submitted rejects become evictable immediately',async()=>{
 const pool=createVegetationResourcePool<{bytes:number;dispose():void}>(400,10);let deleted=0,done=0;
 const lease=(key:string)=>pool.acquire(key,100,async()=>({bytes:100,dispose(){deleted++;}}));
 const base={stats:pool.stats,geometry:()=>{const raw=lease('wood');return{...raw,releaseUnsubmitted:raw.release};},dispose(){}}as unknown as VegetationPrototypeResources;
 const make=()=>createWorldOwnerRetirement({stop(){},producer:()=>Promise.resolve(),fence:()=>Promise.resolve(),releaseOwned(){},releaseCredit(){done++;}});
 const a=make(),b=make(),left=scopeOwnedVegetationResources(base,a),right=scopeOwnedVegetationResources(base,b),one=left.geometry({}as never),two=right.geometry({}as never);await Promise.all([one.ready,two.ready]);
 one.release();await a.retire();pool.trim();assert.equal(deleted,0,'second live owner still has a paid reference');assert.equal(done,1);two.release();await b.retire();pool.trim();assert.equal(deleted,1);
 const c=make(),scoped=scopeOwnedVegetationResources(base,c),reject=scoped.geometry({}as never);await reject.ready;reject.releaseUnsubmitted!();pool.trim();assert.equal(pool.stats.bytes,0);assert.equal(deleted,2,'ready unused derivative is evictable before owner disposal');await c.retire();assert.equal(deleted,2);pool.dispose();
});

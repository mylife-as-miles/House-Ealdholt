import assert from 'node:assert/strict';
import test from 'node:test';
import type {WebGLRenderer} from 'three';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import {createWorldResourceRetirementFence} from './world-resource-retirement';
import {createWorldOwnerRetirement,type WorldOwnerQuiescence} from '../../../../shared/legacy/aethelgard/environment/world-owner-retirement';

test('retirement waits for preparation and the previously submitted world commands without blocking or discarding an unsignalled fence',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let finish!:()=>void,signalled=false,created=0,deleted=0,failed=false;
 const idle=new Promise<void>(resolve=>{finish=resolve;}),gl={TIMEOUT_EXPIRED:1,WAIT_FAILED:2,SYNC_GPU_COMMANDS_COMPLETE:3,isContextLost:()=>false,fenceSync:()=>{created++;return{};},flush(){},clientWaitSync:(_sync:unknown,flags:number,timeout:number)=>{assert.equal(flags,0);assert.equal(timeout,0);return failed?2:signalled?4:1;},deleteSync(){deleted++;}};
 const retire=createWorldResourceRetirementFence({getContext:()=>gl}as unknown as WebGLRenderer,{whenIdle:()=>idle}as unknown as WorldPreparationQueue);let completed=false;
 const result=retire().then(()=>{completed=true;});assert.equal(created,0);finish();await Promise.resolve();assert.equal(created,1);assert.equal(completed,false);t.mock.timers.tick(16);assert.equal(deleted,0);
 failed=true;t.mock.timers.tick(16);assert.equal(completed,false);assert.equal(retire.stats.retries,1);failed=false;signalled=true;t.mock.timers.tick(16);await result;assert.equal(created,2);assert.equal(deleted,2);assert.equal(retire.stats.pending,0);assert.equal(retire.stats.completed,1);
});

test('a quiescent owner fences its submitted commands while unrelated queue work remains pending, without weakening default teardown',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let idle!:()=>void,queueWaits=0,created=0,deleted=0,signalled=false,refs=0,credits=0;
 const unrelated=new Promise<void>(resolve=>{idle=resolve;}),gl={TIMEOUT_EXPIRED:1,WAIT_FAILED:2,SYNC_GPU_COMMANDS_COMPLETE:3,
  isContextLost:()=>false,fenceSync:()=>{created++;return{};},flush(){},clientWaitSync:()=>signalled?4:1,deleteSync(){deleted++;}};
 const fence=createWorldResourceRetirementFence({getContext:()=>gl}as unknown as WebGLRenderer,{whenIdle:()=>{queueWaits++;return unrelated;}}as unknown as WorldPreparationQueue);
 assert.throws(()=>fence.afterOwnerQuiescent({}as WorldOwnerQuiescence),/quiescent/);assert.equal(created,0);
 const whole=fence();let finishProducer!:()=>void,finishReady!:()=>void;
 const producer=new Promise<void>(resolve=>{finishProducer=resolve;}),ready=new Promise<void>(resolve=>{finishReady=resolve;});
 const owner=createWorldOwnerRetirement({stop(){},producer:()=>producer,fence:proof=>fence.afterOwnerQuiescent(proof),releaseOwned(){},releaseCredit:()=>{credits++;}});
 owner.acquire(()=>({ready,release:()=>{refs++;}}));const done=owner.retire();finishProducer();
 for(let i=0;i<12;i++)await Promise.resolve();assert.equal(created,0);assert.equal(queueWaits,1);
 finishReady();for(let i=0;i<12;i++)await Promise.resolve();assert.equal(created,1);assert.equal(refs+credits,0);
 assert.equal(fence.stats.waitingForQueue,1);assert.equal(fence.stats.waitingForGPU,1);
 t.mock.timers.tick(16);assert.equal(refs+credits,0);signalled=true;t.mock.timers.tick(16);await done;
 assert.equal(refs,1);assert.equal(credits,1);assert.equal(deleted,1);assert.equal(queueWaits,1,'Owner retirement does not wait for unrelated new cells.');
 assert.equal(fence.stats.completed,1);assert.equal(fence.stats.pending,1,'Whole-view teardown still waits for all queue work.');
 idle();await whole;assert.equal(created,2);assert.equal(deleted,2);assert.equal(fence.stats.pending,0);
 assert.equal(fence.stats.ownerScoped,1);assert.equal(fence.stats.waitingForQueue+fence.stats.waitingForGPU,0);
});

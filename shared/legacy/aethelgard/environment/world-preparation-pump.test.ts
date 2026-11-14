import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {createWorldPreparationQueue} from './world-preparation-queue';
import {createWorldPreparationPump} from './world-preparation-pump';

function fixture(t:TestContext){
 t.mock.timers.enable({apis:['setTimeout']});
 let time=0,allowed=true,gpuReady=true,gpuQueries=0,pump:ReturnType<typeof createWorldPreparationPump>|null=null;
 const queue=createWorldPreparationQueue(()=>pump?.wake(),64,1024);
 pump=createWorldPreparationPump({queue,allowed:()=>allowed,gpuReady:()=>{gpuQueries++;return gpuReady;},intervalMilliseconds:16,now:()=>time});
 t.after(()=>{pump?.dispose();queue.dispose();});
 return{queue,pump,get gpuQueries(){return gpuQueries;},set allowed(value:boolean){allowed=value;},set gpuReady(value:boolean){gpuReady=value;},
  async tick(milliseconds:number){time+=milliseconds;t.mock.timers.tick(milliseconds);await new Promise<void>(resolve=>setImmediate(resolve));}};
}
test('preparation progresses without RAF while timer and frame callers share one upload cadence',{timeout:2000},async t=>{
 const f=fixture(t),order:number[]=[],signal=new AbortController().signal;
 // A step runs synchronous jobs until the frame's upload budget (1024 bytes here) is spent (L-10): two 512-byte jobs, then the third next step.
 const jobs=[0,1,2].map(i=>f.queue.enqueue({bytes:512,signal,priority:()=>i,work:()=>{order.push(i);}}));
 await f.tick(0);assert.deepEqual(order,[0,1]);assert.equal(f.pump.step(),false,'A frame caller cannot bypass the timer cadence.');
 await f.tick(15);assert.deepEqual(order,[0,1]);await f.tick(1);await Promise.all(jobs);
 assert.deepEqual(order,[0,1,2]);assert.equal(f.queue.stats.bytesSubmitted,1536);assert.equal(f.pump.stats.steps,2);assert.equal(f.pump.stats.tasks,2);
 await f.tick(16);assert.equal(f.pump.stats.timerPending,false,'An empty queue must not keep requesting task turns.');
});
test('GPU readiness and active/paused/view gates block all work and resume only on an explicit wake',{timeout:2000},async t=>{
 const f=fixture(t);f.gpuReady=false;let work=0;
 const result=f.queue.enqueue({bytes:0,signal:new AbortController().signal,priority:()=>0,work:()=>{work++;}});
 await f.tick(0);assert.equal(work,0);assert.equal(f.pump.stats.gpuWaits,1);
 await f.tick(16);assert.equal(work,0);assert.equal(f.pump.stats.gpuWaits,2);
 f.allowed=false;await f.tick(16);const queries=f.gpuQueries;assert.equal(f.pump.stats.timerPending,false);
 await f.tick(1000);assert.equal(f.gpuQueries,queries,'Inactive/paused/authoring/XR owners must not poll or service.');
 f.allowed=true;f.gpuReady=true;f.pump.wake();await f.tick(0);await result;assert.equal(work,1);
});
test('in-flight atlas/compile promises wait for completion wakes rather than timer polling',{timeout:2000},async t=>{
 const f=fixture(t),signal=new AbortController().signal;let release!:()=>void,work=0;
 const first=f.queue.enqueue({bytes:0,signal,priority:()=>0,work:()=>{work++;return new Promise<void>(resolve=>{release=resolve;});}});
 await f.tick(0);assert.equal(f.queue.running,true);assert.equal(f.pump.stats.timerPending,false);
 const second=f.queue.enqueue({bytes:0,signal,priority:()=>1,work:()=>{work++;}});
 assert.equal(f.pump.step(),false);await f.tick(1000);assert.equal(work,1);assert.equal(f.gpuQueries,1);
 release();await first;await new Promise<void>(resolve=>setImmediate(resolve));await f.tick(0);await second;assert.equal(work,2);assert.equal(f.queue.running,false);
 assert.equal(f.pump.stats.timerPending,false);
});
test('view disposal cancels old timers and cannot publish retired work into a new queue',{timeout:2000},async t=>{
 const f=fixture(t);let retired=0,fresh=0;
 const old=f.queue.enqueue({bytes:0,signal:new AbortController().signal,priority:()=>0,work:()=>{retired++;}}),rejected=assert.rejects(old,/disposed/);
 f.pump.dispose();f.queue.dispose();await rejected;
 let next:ReturnType<typeof createWorldPreparationPump>|null=null;const queue=createWorldPreparationQueue(()=>next?.wake());
 next=createWorldPreparationPump({queue,allowed:()=>true,gpuReady:()=>true,now:()=>0});
 try{const result=queue.enqueue({bytes:0,signal:new AbortController().signal,priority:()=>0,work:()=>{fresh++;}});await f.tick(0);await result;assert.equal(retired,0);assert.equal(fresh,1);}
 finally{next.dispose();queue.dispose();}
});
test('a held-error job remains rejected without a runaway empty-queue retry loop',{timeout:2000},async t=>{
 const f=fixture(t);let attempts=0;
 const result=f.queue.enqueue({bytes:0,signal:new AbortController().signal,priority:()=>0,work:()=>{attempts++;throw Error('atlas shader held');}}),rejected=assert.rejects(result,/held/);
 await f.tick(0);await rejected;await f.tick(1000);
 assert.equal(attempts,1);assert.equal(f.queue.stats.failed,1);assert.equal(f.pump.stats.timerPending,false);assert.equal(f.queue.pending,false);
});

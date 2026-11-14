import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorldGpuFrameGate} from './world-gpu-frame';
import {createWorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import {createWorldPreparationPump} from '../../../../shared/legacy/aethelgard/environment/world-preparation-pump';
test('task-driven preparation waits for the actual world-frame gate without requiring another render',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let time=0,signalled=false,uploads=0,pump:ReturnType<typeof createWorldPreparationPump>|null=null;
 const gl={TIMEOUT_EXPIRED:1,WAIT_FAILED:2,SYNC_GPU_COMMANDS_COMPLETE:3,ALREADY_SIGNALED:4,CONDITION_SATISFIED:5,fenceSync:()=>({}),flush(){},deleteSync(){},clientWaitSync(){return signalled?4:1;}};
 const gate=createWorldGpuFrameGate(gl as unknown as WebGL2RenderingContext),queue=createWorldPreparationQueue(()=>pump?.wake());
 pump=createWorldPreparationPump({queue,allowed:()=>true,gpuReady:()=>gate.ready(),intervalMilliseconds:16,now:()=>time});
 try{
  gate.submitted();const result=queue.enqueue({bytes:32,signal:new AbortController().signal,priority:()=>0,work:()=>{uploads++;}});
  t.mock.timers.tick(0);assert.equal(uploads,0);assert.equal(gate.stats.pending,true);
  time=16;t.mock.timers.tick(16);assert.equal(uploads,0);assert.equal(pump.stats.gpuWaits,2);
  signalled=true;time=32;t.mock.timers.tick(16);await result;await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(uploads,1);assert.equal(gate.stats.completed,1);assert.equal(gate.stats.submitted,1,'The task pump never submits another world frame.');
  assert.equal(pump.stats.steps,1);assert.equal(pump.stats.timerPending,false);
 }finally{pump.dispose();queue.dispose();gate.dispose();}
});
test('bounded preparation can finish while the previous world frame remains in flight',async()=>{
 let signalled=false,uploads=0,deleted=0,flushed=0;
 const gl={TIMEOUT_EXPIRED:1,WAIT_FAILED:2,SYNC_GPU_COMMANDS_COMPLETE:3,ALREADY_SIGNALED:4,CONDITION_SATISFIED:5,fenceSync:()=>({}),flush(){flushed++;},deleteSync(){deleted++;},clientWaitSync(){return signalled?4:1;}};
 const gate=createWorldGpuFrameGate(gl as unknown as WebGL2RenderingContext),queue=createWorldPreparationQueue(()=>{});
 const prepared=queue.enqueue({bytes:32,priority:()=>0,signal:new AbortController().signal,work:()=>{uploads++;}});
 gate.submitted();assert.equal(gate.ready(()=>queue.step()),false);await prepared;
 assert.equal(uploads,1);assert.equal(queue.stats.completed,1);assert.equal(gate.stats.completed,0);assert.equal(gate.stats.submitted,1);assert.equal(gate.stats.pending,true);
 assert.throws(()=>gate.submitted(),/already in flight/);assert.equal(flushed,1);
 gate.ready(()=>queue.step());assert.equal(uploads,1,'A waiting tick cannot repeat a finished upload.');signalled=true;assert.equal(gate.ready(()=>{throw Error('Ready frames must not call the waiting service.');}),true);
 assert.equal(gate.stats.completed,1);assert.equal(gate.stats.preparationPolls,2);gate.dispose();queue.dispose();assert.equal(deleted,1);
});
test('pending frames defer duplicate submissions through zero-timeout polling and dispose exactly once', () => {
  let ready = false, deleted = 0, flushed = 0;
  const fake = {TIMEOUT_EXPIRED: 1, WAIT_FAILED: 2, SYNC_GPU_COMMANDS_COMPLETE: 3, ALREADY_SIGNALED:4, CONDITION_SATISFIED:5,
    fenceSync: () => ({}), flush() {flushed++;}, deleteSync() {deleted++;},
    clientWaitSync(_sync: unknown, flags: number, timeout: number) {assert.equal(flags, 0); assert.equal(timeout, 0); return ready ? 4 : 1;}};
  const gate = createWorldGpuFrameGate(fake as unknown as WebGL2RenderingContext);
  assert.equal(gate.ready(), true); gate.submitted(); assert.equal(gate.ready(), false);
  assert.throws(() => gate.submitted(), /already in flight/); assert.equal(flushed, 1);
  ready = true; assert.equal(gate.ready(), true); assert.equal(deleted, 1); assert.equal(gate.stats.completed, 1);
  gate.submitted(); gate.dispose(); gate.dispose(); assert.equal(deleted, 2); assert.equal(gate.ready(), false);
});
test('a terminal failed fence leaves no pending frame or preparation retry timer',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let failed=false,pump:ReturnType<typeof createWorldPreparationPump>|null=null;
 const gl={TIMEOUT_EXPIRED:1,WAIT_FAILED:2,SYNC_GPU_COMMANDS_COMPLETE:3,ALREADY_SIGNALED:4,CONDITION_SATISFIED:5,
  fenceSync:()=>({}),flush(){},deleteSync(){},clientWaitSync(){return failed?2:1;}};
 const gate=createWorldGpuFrameGate(gl as unknown as WebGL2RenderingContext),queue=createWorldPreparationQueue(()=>pump?.wake());
 pump=createWorldPreparationPump({queue,allowed:()=>!gate.terminalFailure,gpuReady:()=>gate.ready()});
 const prepared=queue.enqueue({bytes:1,signal:new AbortController().signal,priority:()=>0,work:()=>{throw Error('A failed context must not upload.');}}).catch(()=>undefined);
 try{
  gate.submitted();failed=true;t.mock.timers.tick(0);
  assert.equal(gate.terminalFailure,true);assert.equal(gate.stats.pending,false,'Completion RAF admission has no pending frame to poll.');
  assert.equal(pump.stats.timerPending,false);const tasks=pump.stats.tasks;t.mock.timers.tick(10000);assert.equal(pump.stats.tasks,tasks);
 }finally{pump.dispose();queue.dispose();gate.dispose();await prepared;}
});

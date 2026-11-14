import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorldGpuFrameGate} from './world-gpu-frame';
import {createWorldGlDiagnostics} from './world-gl-diagnostics';
const identity={canvasFrame:4,rendererFrame:37};
function fixture(){
 let status=1,lost=false,reads=0;const codes:number[]=[];
 const gl={TIMEOUT_EXPIRED:1,WAIT_FAILED:2,SYNC_GPU_COMMANDS_COMPLETE:3,ALREADY_SIGNALED:4,CONDITION_SATISFIED:5,NO_ERROR:0 as const,
  fenceSync:()=>({}),flush(){},deleteSync(){},clientWaitSync(_f:unknown,flags:number,timeout:number){assert.equal(flags,0);assert.equal(timeout,0);return status;},
  isContextLost:()=>lost,getError(){reads++;return codes.shift()??0;}};
 const diagnostics=createWorldGlDiagnostics(gl),gate=createWorldGpuFrameGate(gl as unknown as WebGL2RenderingContext,{onTerminal:event=>diagnostics.terminal(event)});
 return{gl,diagnostics,gate,codes,set status(value:number){status=value;},set lost(value:boolean){lost=value;},get reads(){return reads;},submit(){diagnostics.submitted(identity);gate.submitted(identity);}};
}
test('every readiness caller drains diagnostics only after the actual fence and before further shared-context work',()=>{
 const f=fixture(),initial=f.diagnostics.report;assert.equal(f.gate.ready(),true);assert.equal(initial.completed,null);f.submit();assert.equal(f.reads,0);
 assert.equal(f.gate.ready(),false);assert.equal(f.reads,0);assert.deepEqual(f.diagnostics.report.pending,identity);
 f.status=4;let prepared=false;
 if(f.gate.ready()){assert.equal(f.reads,1);assert.equal(f.diagnostics.report.completed?.status,'clean');prepared=true;}
 assert.equal(prepared,true);assert.deepEqual(f.diagnostics.report.completed,{...identity,status:'clean',errors:[],reason:null});f.gate.dispose();
});
test('a final demand-render frame completes through a bounded non-render poll',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();f.submit();t.mock.timers.tick(16);assert.equal(f.reads,0);
 f.status=5;t.mock.timers.tick(16);assert.equal(f.diagnostics.report.completed?.status,'clean');assert.equal(f.gate.stats.completed,1);assert.equal(f.gate.stats.pending,false);
 t.mock.timers.tick(1000);assert.equal(f.reads,1,'A completed frame has no continuing diagnostic poll.');f.gate.dispose();
});
test('failed, unknown and lost-context fences never read errors or become clean proof',()=>{
 for(const status of [2,99]){const f=fixture();f.submit();f.status=status;assert.equal(f.gate.ready(),false);assert.equal(f.reads,0);assert.equal(f.diagnostics.report.completed?.status,'failed');assert.equal(f.gate.stats.failures,1);f.gate.dispose();}
 const f=fixture();f.submit();f.lost=true;assert.equal(f.gate.ready(),false);assert.equal(f.reads,0);assert.equal(f.diagnostics.report.completed?.status,'failed');f.gate.dispose();
});
test('WebGL1, null fences, renderer failure and disposal remain explicitly uncertified',()=>{
 const f=fixture();f.diagnostics.submitted(identity);const unsupported=createWorldGpuFrameGate({} as WebGLRenderingContext,{onTerminal:e=>f.diagnostics.terminal(e)});
 unsupported.submitted(identity);assert.equal(f.diagnostics.report.completed?.status,'unsupported');assert.equal(f.reads,0);unsupported.dispose();
 const nullFence={...f.gl,fenceSync:()=>null};f.diagnostics.submitted(identity);const noFence=createWorldGpuFrameGate(nullFence as unknown as WebGL2RenderingContext,{onTerminal:e=>f.diagnostics.terminal(e)});
 noFence.submitted(identity);assert.equal(f.diagnostics.report.completed?.status,'failed');assert.equal(noFence.stats.failures,1);noFence.dispose();
 f.diagnostics.failed(identity,'renderer-threw');assert.equal(f.diagnostics.report.completed?.status,'failed');
 f.submit();f.gate.dispose();assert.equal(f.diagnostics.report.completed?.reason,'disposed-before-completion');assert.equal(f.reads,0);
});
test('a next pending frame retains the exact previous completion; observed errors stay accumulated',()=>{
 const f=fixture();f.submit();f.status=4;f.gate.ready();const first=f.diagnostics.report.completed;
 const next={canvasFrame:5,rendererFrame:38};f.diagnostics.submitted(next);assert.equal(f.diagnostics.report.completed,first);assert.deepEqual(f.diagnostics.report.pending,next);
 f.gate.submitted(next);f.codes.push(1282);f.gate.ready();assert.equal(f.diagnostics.report.completed?.status,'error');assert.deepEqual(f.diagnostics.report.errors,[1282]);
 const third={canvasFrame:6,rendererFrame:39};f.diagnostics.submitted(third);f.gate.submitted(third);f.gate.ready();assert.equal(f.diagnostics.report.completed?.status,'error','A later empty queue cannot erase an earlier observed graphics error.');f.gate.dispose();
});

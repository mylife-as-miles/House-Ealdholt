import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { actualWorldCanvasExpression,decodeActualWorldCanvasResult,captureActualWorldCanvas } from './actual-world-canvas-readback.mjs';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHMkAAAAASUVORK5CYII=';
const clean=(canvasFrame=4,rendererFrame=37)=>({version:'completed-world-frame-gl-errors-v1',pending:null,completed:{canvasFrame,rendererFrame,status:'clean',errors:[],reason:null},errors:[]});
function fixture(){
 let observer,reads=0,disconnected=false;
 const world={dataset:{modelReady:'true',renderFrames:'3',selectedView:'overview',worldGpuFrame:'{"submitted":4,"completed":3}',worldGlDiagnostics:JSON.stringify(clean())},
  querySelector:()=>({width:1,height:1,toDataURL(){reads++;return png;}})};
 class Observer{constructor(callback){this.callback=callback;observer=this;}observe(target,options){assert.equal(target,world);assert.deepEqual(options.attributeFilter,['data-render-frames','data-world-gl-diagnostics']);}disconnect(){disconnected=true;}}
 const execute=()=>new Function('document','MutationObserver','setTimeout','clearTimeout','return '+actualWorldCanvasExpression(1000))({querySelector:()=>world},Observer,setTimeout,clearTimeout);
 return{world,execute,notify:()=>observer.callback(),get reads(){return reads;},get disconnected(){return disconnected;}};
}
test('fallback waits for a new actual frame and does not request a render or change view/time',async()=>{
 const f=fixture(),before={...f.world.dataset},result=f.execute();
 f.notify();assert.equal(f.reads,0);f.world.dataset.renderFrames='4';f.notify();f.notify();
 const value=await result;assert.equal(value.frame,4);assert.equal(f.reads,1);assert.equal(f.disconnected,true);
 assert.equal(value.evidence,'actual-application-canvas-after-existing-render-without-ui');
 assert.deepEqual(f.world.dataset,{...before,renderFrames:'4'});
 assert.equal(decodeActualWorldCanvasResult(value).bytes.length,68);
});
test('a changed view refuses the readback and releases its observer',async()=>{
 const f=fixture(),result=f.execute();f.world.dataset.selectedView='well';f.world.dataset.renderFrames='4';f.notify();
 await assert.rejects(result,/View changed/);assert.equal(f.reads,0);assert.equal(f.disconnected,true);
});
test('resident metadata stays bound to the captured frame while later village activity continues',async()=>{
 const f=fixture();f.world.dataset.populationDrawn='1';f.world.dataset.populationSnapshot='{"visualRevision":9}';
 const result=f.execute();f.world.dataset.renderFrames='4';f.notify();
 f.world.dataset.populationDrawn='2';f.world.dataset.populationSnapshot='{"visualRevision":10}';
 const captured=await result;
 assert.equal(captured.frame,4);assert.equal(captured.populationDrawn,1);assert.equal(captured.populationVisualRevision,9);
 assert.equal(JSON.parse(f.world.dataset.populationSnapshot).visualRevision,10,'The readback must not pause or restore the village.');
 assert.equal(f.world.dataset.populationDrawn,'2');assert.equal(f.reads,1);
});
test('malformed or inconsistent image evidence cannot be reported as a canvas capture',()=>{
 const valid={dataUrl:png,frame:4,width:1,height:1,evidence:'actual-application-canvas-after-existing-render-without-ui',glDiagnostics:clean()};
 for(const patch of [{dataUrl:'data:image/png;base64,YmFk'},{frame:NaN},{width:2},{evidence:'compositor'}])assert.throws(()=>decodeActualWorldCanvasResult({...valid,...patch}));
});
test('selected body and submission costs are captured atomically without equating renderer and canvas frame counters',async()=>{
 const f=fixture(),trace={residentId:'guard',body:'qualified',bodyReady:true,rendererFrame:37,canvasFrame:4,availabilityFrame:37,submittedResidentId:'guard',submittedFrame:37,submissionCamera:'main'};
 f.world.dataset.worldResidentFollow=JSON.stringify(trace);
 f.world.dataset.worldDrawAttribution=JSON.stringify({frame:37,status:'ready',counts:{triangles:123}});
 const pending=f.execute();f.world.dataset.renderFrames='4';f.notify();
 f.world.dataset.worldResidentFollow=JSON.stringify({...trace,rendererFrame:38,canvasFrame:5});
 f.world.dataset.worldDrawAttribution=JSON.stringify({frame:38,counts:{triangles:456}});
 const captured=await pending;assert.deepEqual(captured.residentFollow,trace);
 assert.equal(captured.frame,4);assert.equal(captured.drawAttribution.frame,37);assert.equal(captured.drawAttribution.counts.triangles,123);
});
test('a selected-resident trace from another canvas pass rejects capture rather than claiming visible-body evidence',async()=>{
 const f=fixture();f.world.dataset.worldResidentFollow=JSON.stringify({canvasFrame:3,submittedResidentId:'guard'});
 const pending=f.execute();f.world.dataset.renderFrames='4';f.notify();
 await assert.rejects(pending,/different canvas frame/);assert.equal(f.disconnected,true);
});
test('bound bank program evidence stays with the same captured draw while later programs change',async()=>{
 const f=fixture(),bank={frame:37,status:'ready',materials:[{stageKnots:2,stageUniformOwned:true}]};
 f.world.dataset.worldBankMaterial=JSON.stringify(bank);
 const pending=f.execute();f.world.dataset.renderFrames='4';f.notify();
 f.world.dataset.worldBankMaterial=JSON.stringify({frame:38,status:'held',materials:[]});
 const captured=await pending;assert.deepEqual(captured.bankMaterial,bank);
 assert.equal(decodeActualWorldCanvasResult(captured).evidence.bankMaterial.frame,37);
});
test('bank material evidence from another renderer submission cannot certify the captured pixels',async()=>{
 const f=fixture();f.world.dataset.worldBankMaterial=JSON.stringify({frame:36,status:'ready',materials:[]});
 const pending=f.execute();f.world.dataset.renderFrames='4';f.notify();
 await assert.rejects(pending,/frozen bank material evidence differ/);assert.equal(f.disconnected,true);
 const valid={dataUrl:png,frame:4,width:1,height:1,evidence:'actual-application-canvas-after-existing-render-without-ui',glDiagnostics:clean()};
 assert.throws(()=>decodeActualWorldCanvasResult({...valid,bankMaterial:{frame:38,status:'ready'}}));
});
test('a clean non-bank view may retain a waiting optional bank observer without claiming bank proof',async()=>{
 const f=fixture(),waiting={frame:-1,status:'waiting',materials:[]};
 f.world.dataset.worldBankMaterial=JSON.stringify(waiting);
 const pending=f.execute();f.world.dataset.renderFrames='4';f.notify();
 const captured=await pending;assert.deepEqual(captured.bankMaterial,waiting);
 assert.equal(decodeActualWorldCanvasResult(captured).evidence.frame,4);
});
test('browser readback exceptions do not write an image or claim a successful compositor',async()=>{
 await assert.rejects(captureActualWorldCanvas({send:async()=>({exceptionDetails:{text:'Context disappeared'}})},'/unwritten.png',1000),/Context disappeared/);
});
test('a busy frame may delay command dispatch before the bounded next-frame response',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});
 const dir=await mkdtemp(join(tmpdir(),'crownfall-canvas-dispatch-')),file=join(dir,'actual.png');
 const value={dataUrl:png,frame:4,width:1,height:1,evidence:'actual-application-canvas-after-existing-render-without-ui',glDiagnostics:clean()};
 try{
  const pending=captureActualWorldCanvas({send:()=>new Promise(resolve=>setTimeout(()=>resolve({result:{value}}),6500))},file,1000);
  context.mock.timers.tick(6000);await new Promise(resolve=>setImmediate(resolve));
  context.mock.timers.tick(500);const evidence=await pending;
  assert.equal(evidence.frame,4);assert.equal((await readFile(file)).length,68);
 }finally{context.mock.timers.reset();await rm(dir,{recursive:true,force:true});}
});
test('pixels are read immediately once, then frozen until that exact GPU frame completes cleanly',async()=>{
 const f=fixture();f.world.dataset.worldGlDiagnostics=JSON.stringify({version:'completed-world-frame-gl-errors-v1',pending:{canvasFrame:4,rendererFrame:37},completed:null,errors:[]});
 f.world.dataset.populationDrawn='1';const pending=f.execute();let settled=false;pending.then(()=>{settled=true;});
 f.world.dataset.renderFrames='4';f.notify();assert.equal(f.reads,1);await Promise.resolve();assert.equal(settled,false);
 // Another submitted frame does not replace the already captured PNG/metadata.
 f.world.dataset.renderFrames='5';f.world.dataset.populationDrawn='2';f.notify();assert.equal(f.reads,1);
 f.world.dataset.worldGlDiagnostics=JSON.stringify({...clean(),pending:{canvasFrame:5,rendererFrame:38}});f.notify();
 const result=await pending;assert.equal(result.frame,4);assert.equal(result.populationDrawn,1);assert.equal(result.glDiagnostics.completed.canvasFrame,4);
 assert.equal(decodeActualWorldCanvasResult(result).bytes.length,68);
});
test('pending empty diagnostics or clean results for another frame never certify captured pixels',async()=>{
 const valid={dataUrl:png,frame:4,width:1,height:1,evidence:'actual-application-canvas-after-existing-render-without-ui',glDiagnostics:clean()};
 for(const diagnostics of [null,{...clean(),completed:null},clean(3),clean(5),{...clean(),completed:{...clean().completed,status:'failed'}},
  {...clean(),completed:{...clean().completed,status:'error',errors:[1282]}},{...clean(),errors:[1285]}])assert.throws(()=>decodeActualWorldCanvasResult({...valid,glDiagnostics:diagnostics}));
 const f=fixture();f.world.dataset.worldGlDiagnostics=JSON.stringify(clean(5));const pending=f.execute();f.world.dataset.renderFrames='4';f.notify();await assert.rejects(pending,/different canvas frame/);
});

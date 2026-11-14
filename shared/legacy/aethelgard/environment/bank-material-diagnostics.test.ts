import test from'node:test';import assert from'node:assert/strict';
import{bankStageDiagnosticSignature,createBankMaterialDrawDiagnostics,unsupportedBankMaterialReport}from'./bank-material-diagnostics';
import{createLegacyMainPassDrawDiagnostics}from'../../draw-diagnostics';
import{createEaldholtAuthoredBankKnots,EALDHOLT_BANK_KNOT_PROGRAM_KEY}from'./authored-bank-knots';
const version='grounded-bank-earth-grass-rock-v5-local-stage';
const fragment=`// ${version}\n#define USE_MAP\n#define CROWNFALL_BANK_SOURCE_CONTACT\n#define CROWNFALL_WORLD_ENVIRONMENT\nforestCover*=1.-ealdholtContactReach*max(ealdholtEdge.y,.65*smoothstep(.3,.7,ealdholtFine)*ealdholtMeadowW);`;
function fixture(source=fragment){let sourceReads=0,uniformReads=0;const data=Float32Array.of(0,.7,20,1.9),program={},shader={},material={uuid:'actual-owned-material',name:'Bank_Neutral_Floor_Weather',version:0,userData:{crownfallRiverSurface:{version,channelStageKnots:2,channelStageSignature:bankStageDiagnosticSignature(data)},crownfallFloorOwner:'owned-floor'}};
 const gl={CURRENT_PROGRAM:1,SHADER_TYPE:2,FRAGMENT_SHADER:3,ACTIVE_UNIFORMS:4,LINK_STATUS:5,getParameter:()=>program,getAttachedShaders:()=>[shader],getShaderParameter:()=>3,getShaderSource:()=>{sourceReads++;return source;},getProgramParameter:(_program:unknown,key:number)=>key===4?1:true,getActiveUniform:()=>({name:'uEaldholtValleyWaterStages[0]',size:2}),getUniformLocation:(_program:unknown,name:string)=>({index:Number(name.match(/\[(\d+)\]/)![1])}),getUniform:(_program:unknown,location:{index:number})=>{uniformReads++;return data.subarray(location.index*2,location.index*2+2);}};
 const renderer={getContext:()=>gl,info:{render:{frame:4}}};return{material,renderer,gl,data,get sourceReads(){return sourceReads;},get uniformReads(){return uniformReads;}};
}
test('only actual observed bank materials report bound linked v5/stage/floor/weather evidence, with immutable metadata and cached program reads',()=>{
 const f=fixture(),trace=createBankMaterialDrawDiagnostics(f.renderer),before=JSON.stringify(f.material);assert.equal(trace.report.materials.length,0);trace.begin();assert.equal(trace.report.status,'waiting');
 trace.observe(f.material);trace.observe(f.material);assert.equal(trace.report.status,'ready');assert.equal(trace.report.frame,4);assert.equal(trace.report.drawCalls,2);assert.equal(trace.report.materials.length,1);const row=trace.report.materials[0];
 assert.equal(row.material,f.material.uuid);assert.equal(row.drawCalls,2);for(const field of['linked','versionMatches','bankMarker','stageCountMatches','stageUniformOwned','mapEnabled','floorOwned','floorGuard','weather']as const)assert.equal(row[field],true,field);assert.equal(row.stageKnots,2);assert.equal(f.sourceReads,1);assert.equal(JSON.stringify(f.material),before);
 f.renderer.info.render.frame=5;trace.begin();assert.equal(trace.report.materials.length,0);trace.observe(f.material);assert.equal(trace.report.materials[0].frame,5);assert.equal(f.sourceReads,1);assert.equal(f.uniformReads,2);trace.dispose();trace.dispose();trace.observe(f.material);assert.equal(trace.report.status,'disposed');assert.equal(trace.report.materials.length,0);
});
test('source-uniform ownership is reread only on program owner/version changes, retaining weak material ownership',()=>{
 const f=fixture(),trace=createBankMaterialDrawDiagnostics(f.renderer),other={...f.material,uuid:'different-owner'};trace.begin();trace.observe(f.material);trace.observe(f.material);assert.equal(f.uniformReads,2);trace.observe(other);assert.equal(f.uniformReads,4);trace.observe(f.material);assert.equal(f.uniformReads,6);assert.equal(f.sourceReads,1);
 f.data[1]+=.1;f.material.version++;trace.observe(f.material);assert.equal(f.uniformReads,8);assert.equal(trace.report.materials[0].stageUniformOwned,false);trace.dispose();
});
const authoredSource=fragment+`\n#define CROWNFALL_BANK_AUTHORED_KNOTS\n#define CROWNFALL_BANK_AUTHORED_KNOT_COUNT 54\n// ${EALDHOLT_BANK_KNOT_PROGRAM_KEY}\n`;
function authoredFixture(source=authoredSource,vectors=41){
 const f=fixture(source),knots=createEaldholtAuthoredBankKnots(Float32Array.from(Array.from({length:54},(_,i)=>[i,-5-i/20,7+i/20,.5]).flat())),meta=f.material.userData.crownfallRiverSurface as unknown as Record<string,unknown>;
 Object.assign(meta,{channelBankKnots:54,channelBankLookupVersion:EALDHOLT_BANK_KNOT_PROGRAM_KEY,channelBankSignature:bankStageDiagnosticSignature(knots.data)});let reads=0;
 Object.assign(f.gl,{getProgramParameter:(_program:unknown,key:number)=>key===4?2:true,getActiveUniform:(_program:unknown,index:number)=>index?{name:'uEaldholtValleyBankKnots[0]',size:vectors}:{name:'uEaldholtValleyWaterStages[0]',size:2},
  getUniformLocation:(_program:unknown,name:string)=>({index:Number(name.match(/\[(\d+)\]/)![1]),bank:name.includes('BankKnots')}),getUniform:(_program:unknown,location:{index:number;bank?:boolean})=>{reads++;return location.bank?knots.data.subarray(location.index*4,location.index*4+4):f.data.subarray(location.index*2,location.index*2+2);}});
 return{...f,meta,knots,get sourceReads(){return f.sourceReads;},get reads(){return reads;}};
}
test('actual authored-bank evidence compares all164 uploaded floats with its own metadata and keeps reads cached across frames',()=>{
 const f=authoredFixture(),trace=createBankMaterialDrawDiagnostics(f.renderer),before=JSON.stringify(f.material);trace.begin();trace.observe(f.material);const row=trace.report.materials[0];
 for(const flag of['bankAuthoredMarker','bankLookupVersionMatches','bankPackedCountMatches','bankUniformOwned','stageUniformOwned','floorGuard','versionMatches']as const)assert.equal(row[flag],true,flag);
 assert.equal(row.bankSourceKnots,54);assert.equal(row.expectedBankSourceKnots,54);assert.equal(row.bankPackedVectors,41);assert.equal(row.expectedBankPackedVectors,41);assert.equal(row.bankUniformSignature,f.meta.channelBankSignature);assert.equal(row.expectedBankUniformSignature,f.meta.channelBankSignature);assert.equal(row.bankLookupVersion,EALDHOLT_BANK_KNOT_PROGRAM_KEY);assert.equal(f.reads,43);
 for(let i=0;i<1000;i++)trace.observe(f.material);f.renderer.info.render.frame++;trace.begin();trace.observe(f.material);assert.equal(row.frame,5);assert.equal(f.reads,43);assert.equal(f.sourceReads,1);assert.equal(JSON.stringify(f.material),before);
 f.knots.data[4]+=.25;f.material.version++;trace.observe(f.material);assert.equal(f.reads,86);assert.equal(row.stageUniformOwned,true);assert.equal(row.bankUniformOwned,false);assert.notEqual(row.bankUniformSignature,row.expectedBankUniformSignature);
 f.meta.channelBankSignature=bankStageDiagnosticSignature(f.knots.data);trace.observe(f.material);assert.equal(f.reads,129);assert.equal(row.bankUniformOwned,true);assert.equal(row.expectedBankUniformSignature,f.meta.channelBankSignature,'Expected proof comes from current owner metadata, never compiled cached bytes.');
 const other={...f.material,uuid:'other-packed-owner'};trace.observe(other);trace.observe(f.material);assert.equal(f.reads,215);trace.dispose();trace.observe(f.material);assert.equal(f.reads,215);
});
test('wrong packed source values, marker, version, source count and active array count cannot use the old v5 proof as exact-bank evidence',()=>{
 for(const variant of['values','marker','version','source-count','active-count']as const){
  const source=variant==='marker'?authoredSource.replace('#define CROWNFALL_BANK_AUTHORED_KNOTS','// #define CROWNFALL_BANK_AUTHORED_KNOTS'):variant==='version'?authoredSource.replace(EALDHOLT_BANK_KNOT_PROGRAM_KEY,':authored-bank-knots-v999'):authoredSource;
  const f=authoredFixture(source,variant==='active-count'?40:41);if(variant==='values')f.knots.data[160]+=.125;if(variant==='source-count')f.meta.channelBankKnots=55;
  const trace=createBankMaterialDrawDiagnostics(f.renderer);trace.begin();trace.observe(f.material);const row=trace.report.materials[0];assert.equal(row.stageUniformOwned,true);assert.equal(row.versionMatches,true);assert.equal(row.bankUniformOwned,false,variant);
  if(variant==='marker')assert.equal(row.bankAuthoredMarker,false);if(variant==='version')assert.equal(row.bankLookupVersionMatches,false);if(variant==='source-count'||variant==='active-count')assert.equal(row.bankPackedCountMatches,false);if(variant==='values')assert.notEqual(row.bankUniformSignature,row.expectedBankUniformSignature);trace.dispose();
 }
 const f=fixture(),trace=createBankMaterialDrawDiagnostics(f.renderer);trace.begin();trace.observe(f.material);assert.equal(trace.report.materials[0].stageUniformOwned,true);assert.equal(trace.report.materials[0].bankUniformOwned,false);assert.equal(trace.report.materials[0].bankAuthoredMarker,false);
});
test('comment-only markers, unsupported GL and compile-only metadata never become submitted shader proof',()=>{
 const f=fixture(fragment.replace('#define CROWNFALL_BANK_SOURCE_CONTACT','// #define CROWNFALL_BANK_SOURCE_CONTACT')),trace=createBankMaterialDrawDiagnostics(f.renderer);trace.begin();assert.equal(trace.report.drawCalls,0);trace.observe({userData:{}});assert.equal(trace.report.drawCalls,0);trace.observe(f.material);assert.equal(trace.report.materials[0].bankMarker,false);assert.equal(trace.report.materials[0].floorGuard,false);
 const unsupported=createBankMaterialDrawDiagnostics({info:{render:{frame:0}},getContext:()=>({})});unsupported.begin();unsupported.observe(f.material);assert.equal(unsupported.report.status,'unsupported');assert.equal(unsupported.report.materials.length,0);assert.equal(unsupportedBankMaterialReport('SDK main-pass ownership unobserved').status,'unsupported');
});
test('the existing draw wrapper observes only successful main/default draws and preserves receiver, return, counters and disposal',()=>{
 const camera={},scene={},other={},material={},object={name:'LandscapeComponent_0',userData:{}},seen:unknown[]=[];let target:object|null=null,receiver:unknown,fail=false;
 const renderer={info:{autoReset:true,render:{frame:0,calls:0,triangles:0,lines:0,points:0}},getRenderTarget:()=>target,renderBufferDirect(this:unknown){receiver=this;renderer.info.render.calls++;renderer.info.render.triangles+=2;if(fail)throw Error('draw failed');return'token';}};
 const original=renderer.renderBufferDirect,trace=createLegacyMainPassDrawDiagnostics({renderer,scene,camera,enabled:true,observeMainDraw:(m,o)=>seen.push([m,o])});trace.begin();renderer.info.render.frame=1;
 const draw=renderer.renderBufferDirect as unknown as(camera:object,scene:object,geometry:object,material:object,sourceObject:typeof object,group:null)=>unknown;
 assert.equal(draw.call(renderer,camera,scene,{},material,object,null),'token');target={};draw.call(renderer,camera,scene,{},material,object,null);target=null;draw.call(renderer,other,scene,{},material,object,null);draw.call(renderer,camera,other,{},material,object,null);trace.end();assert.equal(receiver,renderer);assert.deepEqual(seen,[[material,object]]);assert.ok(trace.report.reconciled);assert.equal(trace.report.counts.calls,1);assert.equal(trace.report.excluded.calls,3);
 renderer.info.render.calls=renderer.info.render.triangles=0;trace.begin();renderer.info.render.frame=2;fail=true;assert.throws(()=>draw.call(renderer,camera,scene,{},material,object,null));trace.end(false);assert.equal(seen.length,1);trace.dispose();assert.equal(renderer.renderBufferDirect,original);
});

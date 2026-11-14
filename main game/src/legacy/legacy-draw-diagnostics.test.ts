import assert from 'node:assert/strict';
import test from 'node:test';
import {BoxGeometry,Group,Mesh,MeshStandardMaterial,PerspectiveCamera,Scene} from 'three';
import {createLegacyMainPassDrawDiagnostics,type LegacyDrawCounts,type LegacyDrawRenderer,type LegacyDrawObject} from '../../../shared/legacy/draw-diagnostics';

const fields=['calls','triangles','lines','points'] as const;
const counts=():LegacyDrawCounts=>({calls:0,triangles:0,lines:0,points:0});
function fixture(autoReset=true){
 const scene=new Scene(),camera=new PerspectiveCamera(),geometry=new BoxGeometry(),material=new MeshStandardMaterial(),mesh=new Mesh(geometry,material);scene.add(mesh);
 let target:unknown=null,receiver:unknown,args:unknown[]=[],error:Error|undefined;
 const token=Symbol('original return');
 const renderer:LegacyDrawRenderer={info:{autoReset,render:{frame:7,...counts()}},getRenderTarget(){return target;},renderBufferDirect:function(this:unknown,...input:unknown[]){
  receiver=this;args=input;const payload=input[5] as Partial<LegacyDrawCounts>;for(const field of fields)renderer.info.render[field]+=payload[field]??(field==='calls'?1:0);if(error)throw error;return token;
 }};
 const original=renderer.renderBufferDirect;
 const trace=createLegacyMainPassDrawDiagnostics({renderer,scene,camera,enabled:true});
 const begin=()=>{trace.begin();renderer.info.render.frame++;if(renderer.info.autoReset)for(const field of fields)renderer.info.render[field]=0;};
 const draw=(object:LegacyDrawObject=mesh,payload:Partial<LegacyDrawCounts>={triangles:12},passScene:unknown=scene,passCamera:unknown=camera,thisValue:unknown=renderer)=>{
  return (renderer.renderBufferDirect as (this:unknown,...args:unknown[])=>unknown).call(thisValue,passCamera,passScene,geometry,material,object,payload);
 };
 return{renderer,scene,camera,geometry,material,mesh,trace,begin,draw,original,token,setTarget:(value:unknown)=>{target=value;},getReceiver:()=>receiver,getArgs:()=>args,setError:(value:Error)=>{error=value;},dispose(){trace.dispose();geometry.dispose();material.dispose();}};
}

test('real public method wrapper preserves callback identities, receiver, arguments, return and actual counter deltas',()=>{
 const f=fixture(),descriptor=Object.getOwnPropertyDescriptor(f.renderer,'renderBufferDirect'),events:string[]=[],payload={calls:2,triangles:12345,lines:4,points:7};
 const before=f.mesh.onBeforeRender=function(){events.push('object-before');};
 const after=f.mesh.onAfterRender=function(){events.push('object-after');};
 const materialBefore=f.material.onBeforeRender=function(){events.push('material-before');};
 f.mesh.userData.crownfallElderbloom={kind:'architecture'};const matrix=f.mesh.matrix.clone(),positions=f.geometry.attributes.position.array.slice();
 try{
  const objectArgs=[f.renderer,f.scene,f.camera,f.geometry,f.material,payload] as unknown as Parameters<typeof f.mesh.onBeforeRender>;
  const materialArgs=[f.renderer,f.scene,f.camera,f.geometry,f.mesh,payload] as unknown as Parameters<typeof f.material.onBeforeRender>;
  f.begin();f.mesh.onBeforeRender.apply(f.mesh,objectArgs);f.material.onBeforeRender.apply(f.material,materialArgs);
  assert.equal(f.draw(f.mesh,payload),f.token);f.mesh.onAfterRender.apply(f.mesh,objectArgs);f.trace.end();
  assert.equal(f.getReceiver(),f.renderer);assert.deepEqual(f.getArgs(),[f.camera,f.scene,f.geometry,f.material,f.mesh,payload]);assert.deepEqual(events,['object-before','material-before','object-after']);
  assert.equal(f.mesh.onBeforeRender,before);assert.equal(f.mesh.onAfterRender,after);assert.equal(f.material.onBeforeRender,materialBefore);
  assert.deepEqual(f.trace.report.counts,payload);assert.equal(f.trace.report.categories.find(row=>row.category==='authored-architecture')!.triangles,12345,'Use real counter increments, not the box geometry or an estimated instance count.');
  assert.equal(f.trace.report.reconciled,true);assert.equal(f.trace.report.frame,8);assert.equal(f.trace.report.pass,1);assert.ok(f.mesh.matrix.equals(matrix));assert.deepEqual(f.geometry.attributes.position.array,positions);assert.equal(f.mesh.material,f.material);
  f.trace.dispose();assert.equal(f.renderer.renderBufferDirect,f.original);assert.deepEqual(Object.getOwnPropertyDescriptor(f.renderer,'renderBufferDirect'),{...descriptor,value:f.original});assert.equal(f.trace.report.hookRestored,true);
 }finally{f.dispose();}
});

test('main categories plus separately excluded submissions reconcile actual renderer totals',()=>{
 const f=fixture();try{
  f.draw(f.mesh,{triangles:999});assert.equal(f.trace.report.counts.calls,0,'Unbracketed preparation/reflection/compile work is never observed.');
  f.begin();f.draw(f.mesh,{triangles:10});
  f.setTarget({});f.draw(f.mesh,{triangles:100});f.setTarget(null);
  f.draw(f.mesh,{triangles:200},f.scene,new PerspectiveCamera());
  f.draw(f.mesh,{triangles:300},new Scene(),f.camera);
  const receiver={owner:'previous wrapper'};f.draw(f.mesh,{triangles:400},f.scene,f.camera,receiver);assert.equal(f.getReceiver(),receiver);
  f.trace.end();const report=f.trace.report;
  assert.equal(report.status,'ready');assert.equal(report.counts.triangles,10);assert.equal(report.excluded.triangles,1000);assert.equal(report.renderer.triangles,1010);assert.equal(report.reconciled,true);
  assert.deepEqual(report.excludedReasons,{offscreen:1,otherCamera:1,otherScene:1,foreignReceiver:1});assert.deepEqual(report.unattributed,counts());
  const snapshot=structuredClone(report);f.draw(f.mesh,{triangles:10000});assert.deepEqual(report,snapshot,'Later unbracketed work cannot overwrite the last completed main-pass observation.');
 }finally{f.dispose();}
});

test('authored/generated ancestry is cached without mislabeling borrowed regional source trees or the source pond',()=>{
 const f=fixture(),draw=(name:string,data:Record<string,unknown>,parent:Group|Scene=f.scene)=>{const mesh=new Mesh(f.geometry,f.material);mesh.name=name;mesh.userData=data;parent.add(mesh);f.draw(mesh,{triangles:13});return mesh;};
 try{
  f.begin();draw('LandscapeComponent_0',{});draw('door',{crownfallElderbloom:{kind:'architecture'}});draw('S_Grass_Clumps_original',{});draw('barrel',{crownfallElderbloom:{kind:'prop'}});draw('pond',{crownfallElderbloom:{kind:'water'}});
  const near=new Group();near.name='Regional detail 2,4';f.scene.add(near);draw('borrowed trunk',{crownfallElderbloom:{kind:'tree'}},near);
  draw('Regional L3 tree-oak-1',{});
  for(const [key,category] of [['crownfallRegionalGroundcover','regional-grass'],['crownfallRegionalRocks','regional-rocks'],['crownfallRegionalLandmarks','regional-landmarks'],['crownfallRegionalHorizon','regional-terrain'],['crownfallRiverWoodland','local-woodland'],['crownfallWoodlandUnderstory','local-undergrowth'],['crownfallAtmosphere','sky-clouds']] as const){const parent=new Group();parent.name=category;parent.userData[key]={};f.scene.add(parent);draw('part',{},parent);}
  const valley=new Group();valley.name='Actual river valley';valley.userData.crownfallRiverValley={};f.scene.add(valley);draw('sea',{crownfallElderbloom:{kind:'water'}},valley);
  const residents=new Group();residents.name='Ealdholt resident actors';f.scene.add(residents);draw('body',{},residents);draw('Ealdholt local rain',{});draw('unclassified-prop',{});f.trace.end();
  for(const row of f.trace.report.categories)assert.equal(row.calls,1,'Each proven owner has exactly one actual draw: '+row.category);
  assert.equal(f.trace.report.unknownObjects,1);assert.deepEqual(f.trace.report.unknownNames,['unclassified-prop']);assert.equal(f.trace.report.reconciled,true);
  assert.ok(f.trace.report.topObjects.some(row=>row.category==='regional-near-vegetation'&&row.name==='borrowed trunk'&&row.owner==='Regional detail 2,4'));
 }finally{f.dispose();}
});

test('streamed reparenting and owner metadata changes refresh cached labels, and report storage stays bounded',()=>{
 const f=fixture(),near=new Group(),rocks=new Group();near.name='Regional detail first';rocks.userData.crownfallRegionalRocks={};f.scene.add(near,rocks);near.add(f.mesh);
 try{
  f.begin();f.draw();f.trace.end();assert.equal(f.trace.report.categories.find(r=>r.category==='regional-near-vegetation')!.calls,1);
  rocks.add(f.mesh);f.begin();f.draw();f.trace.end();assert.equal(f.trace.report.categories.find(r=>r.category==='regional-rocks')!.calls,1);
  delete rocks.userData.crownfallRegionalRocks;rocks.userData.crownfallRegionalLandmarks={};f.begin();f.draw();f.trace.end();assert.equal(f.trace.report.categories.find(r=>r.category==='regional-landmarks')!.calls,1);
  const rowObjects=[...f.trace.report.categories];f.begin();for(let i=0;i<100;i++){const mesh=new Mesh(f.geometry,f.material);mesh.name='unknown-'+i;f.scene.add(mesh);f.draw(mesh,{triangles:i+1});}f.trace.end();
  assert.equal(f.trace.report.topObjects.length,24);assert.equal(f.trace.report.unknownNames.length,8);assert.equal(f.trace.report.unknownObjects,100);assert.equal(f.trace.report.topObjects[0].triangles,100);assert.ok(f.trace.report.categories.every((r,i)=>r===rowObjects[i]));assert.equal(f.trace.report.reconciled,true);
 }finally{f.dispose();}
});

test('autoReset=false retains an explicit prior baseline instead of presenting pass deltas as raw renderer totals',()=>{
 const f=fixture(false);try{f.draw(f.mesh,{calls:3,triangles:900});f.begin();f.draw(f.mesh,{triangles:15,points:2});f.trace.end();assert.equal(f.trace.report.baseline.triangles,900);assert.equal(f.trace.report.renderer.triangles,915);assert.equal(f.trace.report.counts.triangles,15);assert.equal(f.trace.report.reconciled,true);}finally{f.dispose();}
});

test('ownership changes within a pass keep per-draw categories exact and explicitly mark aggregate object labels mixed',()=>{
 const f=fixture();try{f.mesh.userData.crownfallElderbloom={kind:'architecture'};f.begin();f.draw();delete f.mesh.userData.crownfallElderbloom;f.draw();f.trace.end();assert.equal(f.trace.report.categories.find(r=>r.category==='authored-architecture')!.calls,1);assert.equal(f.trace.report.categories.find(r=>r.category==='unknown')!.calls,1);assert.equal(f.trace.report.unknownObjects,1);assert.equal(f.trace.report.topObjects[0].category,'mixed');assert.equal(f.trace.report.reconciled,true);}finally{f.dispose();}
});

test('multiple real submissions of one object aggregate without replaying its callbacks, and fixed report slots are reused',()=>{
 const f=fixture();let after=0;const callback=f.mesh.onAfterRender=()=>{after++;};try{
  f.begin();f.draw(f.mesh,{triangles:13});f.draw(f.mesh,{triangles:17});assert.equal(after,0);f.trace.end();assert.equal(f.trace.report.counts.calls,2);assert.equal(f.trace.report.counts.triangles,30);assert.equal(f.trace.report.topObjects[0].triangles,30);assert.equal(f.mesh.onAfterRender,callback);
  const slot=f.trace.report.topObjects[0];f.begin();f.draw(f.mesh,{triangles:7});f.trace.end();assert.equal(f.trace.report.topObjects[0],slot);assert.equal(slot.triangles,7);assert.equal(f.trace.report.reconciled,true);
  f.begin();f.trace.end();assert.equal(f.trace.report.counts.calls,0);assert.equal(f.trace.report.topObjects.length,0);assert.equal(f.trace.report.status,'ready','A genuinely empty main pass is distinct from an unsupported/unobserved pass.');
 }finally{f.dispose();}
});

test('unobserved submissions, resets, nested frames and unfinished renders are reported as accounting failures',()=>{
 for(const fault of ['unobserved','reset','nested-frame','unfinished'] as const){const f=fixture();try{
  f.begin();f.draw(f.mesh,{triangles:30});
  if(fault==='unobserved')(f.original as (...args:unknown[])=>unknown)(f.camera,f.scene,f.geometry,f.material,f.mesh,{triangles:10});
  if(fault==='reset'){f.renderer.info.render.calls=0;f.renderer.info.render.triangles=0;}
  if(fault==='nested-frame')f.renderer.info.render.frame++;
  f.trace.end(fault!=='unfinished');assert.equal(f.trace.report.status,'invalid');assert.equal(f.trace.report.reconciled,false);assert.ok(f.trace.report.reason);
  if(fault==='unobserved')assert.equal(f.trace.report.unattributed.triangles,10);
 }finally{f.dispose();}}
});

test('original draw exceptions propagate identically and diagnostic classification errors never change rendering',()=>{
 const f=fixture(),error=new Error('original direct failure');try{f.begin();f.setError(error);assert.throws(()=>f.draw(),value=>value===error);f.trace.end(false);assert.equal(f.trace.report.status,'invalid');}finally{f.dispose();}
 const g=fixture();try{Object.defineProperty(g.mesh,'userData',{get(){throw Error('unreadable metadata');},configurable:true});g.begin();assert.equal(g.draw(),g.token);g.trace.end();assert.equal(g.trace.report.counts.calls,1);assert.equal(g.trace.report.categories.find(r=>r.category==='unknown')!.calls,1);assert.equal(g.trace.report.classificationErrors,1);assert.equal(g.trace.report.reconciled,true);}finally{g.dispose();}
});

test('hook ownership is reversible and does not clobber a later public wrapper or an existing diagnostic owner',()=>{
 const f=fixture();try{
  const second=createLegacyMainPassDrawDiagnostics({renderer:f.renderer,scene:f.scene,camera:f.camera,enabled:true});assert.equal(second.report.status,'unsupported');assert.match(second.report.reason,/already-owned/);second.dispose();
  const wrapped=f.renderer.renderBufferDirect as (this:unknown,...args:unknown[])=>unknown;
  const later=function(this:unknown,...args:unknown[]){return wrapped.apply(this,args);};f.renderer.renderBufferDirect=later;f.trace.dispose();assert.equal(f.renderer.renderBufferDirect,later);assert.equal(f.trace.report.hookRestored,false);assert.match(f.trace.report.reason,/another-render-hook/);assert.equal(f.draw(),f.token);
 }finally{f.dispose();}
 const prototype={renderBufferDirect(){return 17;}},renderer=Object.assign(Object.create(prototype),{info:{autoReset:true,render:{frame:0,...counts()}},getRenderTarget(){return null;}}) as LegacyDrawRenderer;
 const inherited=createLegacyMainPassDrawDiagnostics({renderer,scene:{},camera:{},enabled:true});assert.equal(Object.hasOwn(renderer,'renderBufferDirect'),true);inherited.dispose();assert.equal(Object.hasOwn(renderer,'renderBufferDirect'),false);assert.equal(renderer.renderBufferDirect,prototype.renderBufferDirect);
});

test('disabled, unavailable and non-writable backends remain untouched with explicit unsupported reports',()=>{
 const disabled=Object.defineProperty({},'renderBufferDirect',{get(){throw Error('disabled tracing must not inspect renderer');}}) as LegacyDrawRenderer;
 const off=createLegacyMainPassDrawDiagnostics({renderer:disabled,scene:{},camera:{},enabled:false});off.begin();off.end();assert.equal(off.report.reason,'trace-disabled');off.dispose();
 const unsupported=createLegacyMainPassDrawDiagnostics({renderer:{} as LegacyDrawRenderer,scene:{},camera:{},enabled:true});assert.equal(unsupported.report.status,'unsupported');assert.match(unsupported.report.reason,/unavailable/);unsupported.dispose();
 const renderer={info:{autoReset:true,render:{frame:0,...counts()}},getRenderTarget(){return null;}} as LegacyDrawRenderer;Object.defineProperty(renderer,'renderBufferDirect',{value:()=>undefined,writable:false});const original=renderer.renderBufferDirect;
 const frozen=createLegacyMainPassDrawDiagnostics({renderer,scene:{},camera:{},enabled:true});assert.equal(frozen.report.reason,'public-draw-hook-not-writable');frozen.dispose();assert.equal(renderer.renderBufferDirect,original);
 let writes=0;const accessor=Object.defineProperty({},'renderBufferDirect',{get:()=>()=>undefined,set:()=>{writes++;}}),inherited=Object.assign(Object.create(accessor),{info:{autoReset:true,render:{frame:0,...counts()}},getRenderTarget(){return null;}}) as LegacyDrawRenderer;
 const guarded=createLegacyMainPassDrawDiagnostics({renderer:inherited,scene:{},camera:{},enabled:true});assert.equal(guarded.report.reason,'public-draw-hook-not-writable');assert.equal(writes,0);guarded.dispose();
});

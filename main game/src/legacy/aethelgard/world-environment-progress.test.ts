import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BoxGeometry,DirectionalLight,Group,Mesh,MeshStandardMaterial,PerspectiveCamera,Scene,type WebGLRenderer} from 'three';
import {createWorldEnvironment} from './world-environment';
import {createWorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import {createWorldEnvironmentChangeHandler,type WorldEnvironmentChangeReason} from '../../../../shared/legacy/aethelgard/environment/environment-change';
import {createObservationDemandRender} from './observation-demand-render';

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(context:TestContext,compile?:()=>Promise<void>,cancelCompile=()=>{}){
 const priorWorker=Object.getOwnPropertyDescriptor(globalThis,'Worker');
 // Keep unrelated cloud baking pending; disposal cancels this real owner path.
 class PendingCloud {onmessage:unknown;onerror:unknown;postMessage(){}terminate(){}}
 Object.defineProperty(globalThis,'Worker',{configurable:true,value:PendingCloud});
 const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera(),geometry=new BoxGeometry();scene.add(sourceRoot,atmosphere,sun);
 const materials:MeshStandardMaterial[]=[],notices:WorldEnvironmentChangeReason[]=[];
 let dirty=false,progress=0,compiles=0,clockReads=0,renderCalls=0;
 const notify=createWorldEnvironmentChangeHandler({prepare(){progress++;},render(){dirty=true;}});
 const queue=createWorldPreparationQueue(()=>{}),renderer={debug:{onShaderError:undefined},shadowMap:{enabled:false},render(){renderCalls++;throw Error('CPU owner regression must not render.');},async compileAsync(){compiles++;await compile?.();}} as unknown as WebGLRenderer;
 const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,renderer,queue,signal:new AbortController().signal,quality:()=> 'low',reducedMotion:()=>true,
  readClock(){clockReads++;return {time:{absoluteWorldMinute:540,fractionalMinute:0,dayIndex:0,dayMinute:540,elapsedWorldMinutes:540,deferredMilliseconds:0},worldKey:'paused-preparation',animationSeconds:0};},
  changed(reason='visual'){notices.push(reason);notify(reason);},setSunDirection(){}});
 function plant(visible:boolean,material=new MeshStandardMaterial()){
  if(!materials.includes(material))materials.push(material);
  const mesh=new Mesh(geometry,material);mesh.visible=visible;mesh.userData.crownfallVegetationWind={root:[0,-.5,0],tip:[0,.5,0],grass:false};sourceRoot.add(mesh);return mesh;
 }
 async function service(){for(let i=0;queue.pending&&i<32;i++){queue.step();await flush();}assert.equal(queue.pending,false,'Bounded owner jobs must drain without a world render.');await flush();}
 context.after(async()=>{environment.dispose();queue.dispose();cancelCompile();await queue.whenIdle();await flush();geometry.dispose();for(const material of materials)material.dispose();if(priorWorker)Object.defineProperty(globalThis,'Worker',priorWorker);else Reflect.deleteProperty(globalThis,'Worker');});
 return {environment,queue,sourceRoot,notices,plant,service,resetDirty(){dirty=false;},get dirty(){return dirty;},get progress(){return progress;},get compiles(){return compiles;},get clockReads(){return clockReads;},get renderCalls(){return renderCalls;}};
}

test('dormant compilation services all batches without visual dirtiness, then wakes once for the final graph',async context=>{
 const f=fixture(context),plants=Array.from({length:6},()=>f.plant(false)),originals=plants.map(mesh=>mesh.material);
 assert.equal(f.environment.prepare(0),true);assert.equal(f.environment.stats.materialProgramsPending,2);
 for(let scan=1;scan<10;scan++){await f.service();assert.equal(f.dirty,false,'A ready dormant program alone must not dirty the world.');f.environment.prepare(scan*16);if(!f.environment.stats.materialGraphPending)break;}
 assert.equal(f.compiles,6);assert.equal(f.progress,6);assert.deepEqual(f.notices,['preparation','preparation','preparation','preparation','preparation','preparation','ready']);
 assert.ok(plants.every((mesh,i)=>mesh.material!==originals[i]),'Every dormant program is still installed for its later LOD.');assert.equal(f.environment.stats.materialProgramsPending,0);assert.equal(f.environment.stats.materialGraphPending,false);assert.equal(f.environment.stats.surfaceWeather,'wind-only-lighting-fallback');
 assert.equal(f.dirty,true);f.resetDirty();for(const now of [6000,12000,18000])f.environment.prepare(now);
 assert.equal(f.dirty,false,'A settled graph cannot create a repeated ready redraw.');assert.equal(f.notices.filter(reason=>reason==='ready').length,1);assert.equal(f.clockReads,0);assert.equal(f.renderCalls,0);
});

test('the final clock-free scan publishes visible wind materials through a held observer gate exactly once',async context=>{
 const f=fixture(context),plants=[f.plant(true),f.plant(true)],originals=plants.map(mesh=>mesh.material),demand=createObservationDemandRender();demand.update(true,50000,4000);
 f.environment.prepare(0);await f.service();
 assert.equal(f.environment.stats.windProgramsReady,2);assert.equal(f.environment.stats.materialProgramsPending,0);assert.equal(f.environment.stats.activeWindReadyMaterialSlots,0);assert.equal(f.environment.stats.activeWindMaterialSlots,2);assert.equal(f.environment.stats.surfaceWeather,'compiling');
 assert.equal(f.dirty,false);assert.equal(demand.allowCompletionPollDraw(f.dirty),false,'Without the final scan the completed programs stay unassigned indefinitely.');
 // This is the caller's actual new order: clock-free prepare BEFORE the gate.
 f.environment.prepare(16);assert.equal(f.clockReads,0);assert.equal(f.environment.stats.activeWindReadyMaterialSlots,2);assert.ok(plants.every((mesh,i)=>mesh.material!==originals[i]));assert.equal(f.environment.stats.surfaceWeather,'wind-only-lighting-fallback');
 assert.equal(demand.allowCompletionPollDraw(f.dirty),true,'Actual material publication is explicit preparation dirtiness.');assert.deepEqual(f.notices,['preparation','preparation','ready']);
 f.resetDirty();f.environment.prepare(32);assert.equal(demand.allowCompletionPollDraw(f.dirty),false);assert.equal(f.renderCalls,0);
 const caller=readFileSync(new URL('./village-view.ts',import.meta.url),'utf8'),start=caller.indexOf('function render(now: number)');
 const prepare=caller.indexOf('if(modelPresented&&worldEnvironment?.prepare(now))',start),gate=caller.indexOf('observationDemand.allowCompletionPollDraw(dirty)',start);
 assert.ok(prepare>start&&gate>prepare,'The real caller must retain this ordering.');
});

test('a pending variant prepared by a dormant creator wakes an active sharing consumer when installed',async context=>{
 let release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;}),f=fixture(context,()=>hold,()=>release()),material=new MeshStandardMaterial(),creator=f.plant(false,material),consumer=f.plant(false,material);f.plant(false);
 f.environment.prepare(0);f.queue.step();await flush();consumer.visible=true;
 assert.equal(consumer.material,material);assert.equal(f.dirty,false);release();await flush();await flush();f.environment.prepare(16);
 assert.equal(consumer.material,material,'The original valid PBR remains assigned while the bounded colour cohort is pending.');assert.equal(creator.material,material);assert.equal(f.environment.stats.activeWindMaterialSlots,1);assert.equal(f.environment.stats.activeWindReadyMaterialSlots,0,'A private ready shared variant is not assigned coverage.');assert.equal(f.dirty,false);assert.equal(f.renderCalls,0);assert.deepEqual(f.notices,['preparation']);
 await f.service();f.environment.prepare(32);assert.notEqual(consumer.material,material);assert.equal(consumer.material,creator.material);assert.equal(f.environment.stats.activeWindReadyMaterialSlots,1);assert.equal(f.dirty,true);assert.deepEqual(f.notices,['preparation','preparation','ready']);assert.equal(f.notices.filter(reason=>reason==='ready').length,1);
});

test('a newly published graph retains the current material until ready and emits one additional final wake',async context=>{
 const f=fixture(context),mesh=f.plant(true);f.environment.prepare(0);await f.service();f.environment.prepare(16);f.resetDirty();
 const next=new MeshStandardMaterial({roughness:.42});mesh.material=next;f.environment.prepare(17,true);assert.equal(mesh.material,next);assert.equal(f.environment.stats.materialGraphPending,true);assert.equal(f.dirty,false);
 await f.service();assert.equal(mesh.material,next);assert.equal(f.dirty,false);f.environment.prepare(18);assert.notEqual(mesh.material,next);assert.equal(mesh.material.roughness,.42);assert.equal(f.notices.filter(reason=>reason==='ready').length,2);next.dispose();
});

test('disposed owners never send a late preparation or final-ready wake',async context=>{
 let release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;}),f=fixture(context,()=>hold,()=>release());f.plant(true);f.environment.prepare(0);f.queue.step();await flush();
 f.environment.dispose();const before=f.notices.slice();release();await f.service();assert.deepEqual(f.notices,before);assert.equal(f.environment.stats.status,'disposed');assert.equal(f.dirty,false);
});

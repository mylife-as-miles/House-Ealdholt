import test,{type TestContext}from'node:test';
import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import{BoxGeometry,DirectionalLight,Group,Mesh,MeshDepthMaterial,MeshDistanceMaterial,MeshStandardMaterial,PerspectiveCamera,Scene,Texture,type WebGLRenderer}from'three';
import{createWorldEnvironment}from'./world-environment';
import{createWorldPreparationQueue}from'../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import{createWorldEnvironmentChangeHandler,type WorldEnvironmentChangeReason}from'../../../../shared/legacy/aethelgard/environment/environment-change';
import{createVegetationHandoff,TREE_HLOD}from'../../../../shared/legacy/aethelgard/environment/vegetation-hlod';
import{createObservationDemandRender}from'./observation-demand-render';

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(context:TestContext,count=6,failShadow=false,failColour=false){
 const prior=Object.getOwnPropertyDescriptor(globalThis,'Worker');class PendingCloud{onmessage:unknown;onerror:unknown;postMessage(){}terminate(){}}Object.defineProperty(globalThis,'Worker',{configurable:true,value:PendingCloud});
 const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera(),geometry=new BoxGeometry(),map=new Texture(),colour=new MeshStandardMaterial({map,alphaTest:.3});scene.add(sourceRoot,atmosphere,sun);
 const originals=Array.from({length:count},()=>({depth:new MeshDepthMaterial({map,alphaTest:.3}),distance:new MeshDistanceMaterial({map,alphaTest:.3})}));
 const meshes=originals.map(original=>{const mesh=new Mesh(geometry,colour);mesh.castShadow=true;mesh.customDepthMaterial=original.depth;mesh.customDistanceMaterial=original.distance;mesh.userData.crownfallVegetationWind={root:[0,-.5,0],tip:[0,.5,0],grass:false};sourceRoot.add(mesh);return mesh;});
 const notices:WorldEnvironmentChangeReason[]=[],queue=createWorldPreparationQueue(()=>{});let dirty=false,clockReads=0,worldRenders=0,shadowCompiles=0,borrowedDisposals=0;
 const shadowMap={enabled:true,autoUpdate:false,needsUpdate:false};
 for(const resource of[geometry,map,colour,...originals.flatMap(row=>[row.depth,row.distance])])resource.addEventListener('dispose',()=>borrowedDisposals++);
 const renderer={debug:{onShaderError:undefined},shadowMap,render(){worldRenders++;throw Error('This is a CPU owner/gate test, not a rendered scene.');},async compileAsync(preview:Mesh){if(!(preview.material instanceof MeshStandardMaterial)){shadowCompiles++;if(failShadow)throw Error('held shadow shader error');}else if(failColour&&(preview.material as MeshStandardMaterial).name==='failed dormant colour')throw Error('held unrelated colour shader error');}}as unknown as WebGLRenderer;
 const notify=createWorldEnvironmentChangeHandler({prepare(){},render(){dirty=true;}}),environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,renderer,queue,signal:new AbortController().signal,quality:()=> 'high',reducedMotion:()=>true,readClock(){clockReads++;return null;},changed(reason='visual'){notices.push(reason);notify(reason);},setSunDirection(){}});
 async function one(){assert.equal(queue.pending,true);queue.step();await flush();await flush();}
 async function colourReady(){environment.prepare(0);await one();environment.prepare(16);assert.equal(environment.stats.windProgramsReady,1);assert.equal(dirty,true);dirty=false;notices.length=0;}
 function originalBindings(){return meshes.every((mesh,i)=>mesh.customDepthMaterial===originals[i].depth&&mesh.customDistanceMaterial===originals[i].distance);}
 const extraMaterials:MeshStandardMaterial[]=[];
 function dormant(name:string){const material=new MeshStandardMaterial({name}),mesh=new Mesh(geometry,material);extraMaterials.push(material);mesh.visible=false;mesh.userData.crownfallVegetationWind={root:[0,-.5,0],tip:[0,.5,0],grass:false};sourceRoot.add(mesh);return mesh;}
 context.after(async()=>{environment.dispose();queue.dispose();await queue.whenIdle();await flush();geometry.dispose();map.dispose();colour.dispose();for(const material of extraMaterials)material.dispose();for(const row of originals){row.depth.dispose();row.distance.dispose();}if(prior)Object.defineProperty(globalThis,'Worker',prior);else Reflect.deleteProperty(globalThis,'Worker');});
 return{environment,queue,sourceRoot,meshes,originals,map,colour,notices,shadowMap,one,colourReady,originalBindings,dormant,resetDirty(){dirty=false;},get dirty(){return dirty;},get clockReads(){return clockReads;},get worldRenders(){return worldRenders;},get shadowCompiles(){return shadowCompiles;},get borrowedDisposals(){return borrowedDisposals;}};
}

test('all successful shadow jobs finish without world redraws; settled bindings refresh cached shadows once',async context=>{
 const f=fixture(context);await f.colourReady();assert.equal(f.originalBindings(),true);assert.equal(f.shadowMap.needsUpdate,false);
 for(let turn=0;turn<20&&f.environment.stats.materialGraphPending;turn++){
  await f.one();assert.equal(f.dirty,false,'An unbound successful shadow program cannot request a heavy world frame.');assert.equal(f.originalBindings(),true,'The previous valid shadow pair stays assigned between private compiles.');assert.equal(f.shadowMap.needsUpdate,false);
  f.environment.prepare(32+turn*16);if(f.environment.stats.materialGraphPending){assert.equal(f.dirty,false);assert.equal(f.originalBindings(),true);}
 }
 assert.equal(f.shadowCompiles,12);assert.equal(f.environment.stats.windShadowProgramsReady,12);assert.equal(f.environment.stats.materialProgramsPending,0);assert.equal(f.environment.stats.materialGraphPending,false);assert.equal(f.queue.pending,false);
 for(const [i,mesh]of f.meshes.entries()){assert.notEqual(mesh.customDepthMaterial,f.originals[i].depth);assert.notEqual(mesh.customDistanceMaterial,f.originals[i].distance);for(const material of[mesh.customDepthMaterial!,mesh.customDistanceMaterial!]){assert.ok(material.userData.crownfallWindBinding);assert.equal((material as MeshDepthMaterial).map,f.map);assert.equal((material as MeshDepthMaterial).alphaTest,.3);}}
 assert.deepEqual(f.notices,[...Array(12).fill('preparation'),'ready']);assert.equal(f.dirty,true);assert.equal(f.shadowMap.needsUpdate,true,'The actual caller has autoUpdate=false, so final bindings must invalidate the cached shadow map.');
 f.resetDirty();f.shadowMap.needsUpdate=false;for(const now of[6000,12000])f.environment.prepare(now);assert.equal(f.dirty,false);assert.equal(f.shadowMap.needsUpdate,false);assert.equal(f.clockReads,0);assert.equal(f.worldRenders,0);
});

test('a shadow compile failure retains the old bindings and explicit visual fallback, never false readiness',async context=>{
 const f=fixture(context,1,true);await f.colourReady();await f.one();assert.equal(f.dirty,true);assert.deepEqual(f.notices,['visual']);f.environment.prepare(32);assert.equal(f.originalBindings(),true);assert.equal(f.shadowMap.needsUpdate,false);assert.match(f.environment.stats.surfaceWeatherError,/held shadow shader error/);assert.equal(f.environment.stats.windShadowProgramsReady,0);assert.equal(f.environment.stats.materialGraphPending,true);assert.equal(f.notices.includes('ready'),false);
});

test('removing a caster and disposing during staging cannot publish or dispose borrowed shadow resources',async context=>{
 const f=fixture(context,2);await f.colourReady();await f.one();f.meshes[1].castShadow=false;f.environment.prepare(32);assert.equal(f.originalBindings(),true);
 f.environment.dispose();const notices=f.notices.slice();while(f.queue.pending)await f.one();await f.queue.whenIdle();await flush();assert.deepEqual(f.notices,notices);assert.equal(f.originalBindings(),true);assert.equal(f.borrowedDisposals,0);assert.equal(f.shadowMap.needsUpdate,false);assert.equal(f.environment.stats.status,'disposed');
});

test('the admitted shadow cohort publishes despite a genuine384-material colour budget hold',async context=>{
 const f=fixture(context,1);f.meshes[0].castShadow=false;await f.colourReady();for(let i=0;i<385;i++)f.dormant('dormant budget colour '+i);
 f.environment.prepare(32,true);for(let turn=0;turn<400;turn++){if(!f.queue.pending)f.environment.prepare(48+turn*16);if(!f.queue.pending)break;await f.one();f.environment.prepare(48+turn*16);}
 assert.equal(f.environment.stats.ownedColourMaterials,384);assert.equal(f.environment.stats.colourBudgetHeld,true);assert.equal(f.environment.stats.materialGraphPending,true);assert.equal(f.queue.pending,false);
 f.resetDirty();f.notices.length=0;f.meshes[0].castShadow=true;f.environment.prepare(10000,true);assert.equal(f.originalBindings(),true);
 for(let turn=0;f.queue.pending&&turn<4;turn++){await f.one();assert.equal(f.dirty,false);f.environment.prepare(10016+turn*16);}
 assert.equal(f.shadowCompiles,2);assert.equal(f.environment.stats.shadowMaterialProgramsPending,0);assert.equal(f.environment.stats.materialGraphPending,true,'Unadmitted colour remains held, not falsely ready.');assert.notEqual(f.meshes[0].customDepthMaterial,f.originals[0].depth);assert.notEqual(f.meshes[0].customDistanceMaterial,f.originals[0].distance);assert.equal(f.shadowMap.needsUpdate,true);assert.deepEqual(f.notices,['preparation','preparation','visual']);
});

test('a terminal unrelated colour error cannot starve a successful shadow pair or falsely settle the graph',async context=>{
 const f=fixture(context,1,false,true);f.meshes[0].castShadow=false;await f.colourReady();f.dormant('failed dormant colour');f.environment.prepare(32,true);await f.one();f.environment.prepare(48);assert.match(f.environment.stats.surfaceWeatherError,/held unrelated colour/);
 f.resetDirty();f.notices.length=0;f.meshes[0].castShadow=true;f.environment.prepare(64,true);
 for(let turn=0;f.queue.pending&&turn<4;turn++){await f.one();assert.equal(f.dirty,false);f.environment.prepare(80+turn*16);}
 assert.equal(f.shadowCompiles,2);assert.equal(f.environment.stats.shadowMaterialProgramsPending,0);assert.notEqual(f.meshes[0].customDepthMaterial,f.originals[0].depth);assert.equal(f.shadowMap.needsUpdate,true);assert.deepEqual(f.notices,['preparation','preparation','visual']);assert.equal(f.environment.stats.materialGraphPending,true);assert.match(f.environment.stats.surfaceWeatherError,/held unrelated colour/);
});

test('detached and re-enrolled casters are resolved from the live scan without stale staged bindings',async context=>{
 const f=fixture(context,2);await f.colourReady();f.sourceRoot.remove(f.meshes[1]);
 for(let turn=0;f.queue.pending&&turn<5;turn++){await f.one();f.environment.prepare(32+turn*16);}
 assert.notEqual(f.meshes[0].customDepthMaterial,f.originals[0].depth);assert.equal(f.meshes[1].customDepthMaterial,f.originals[1].depth);const first=f.meshes[0].customDepthMaterial;
 f.resetDirty();f.shadowMap.needsUpdate=false;f.notices.length=0;f.sourceRoot.add(f.meshes[1]);f.environment.prepare(128,true);assert.equal(f.meshes[1].customDepthMaterial,f.originals[1].depth);
 for(let turn=0;f.queue.pending&&turn<5;turn++){await f.one();assert.equal(f.dirty,false);f.environment.prepare(144+turn*16);}
 assert.equal(f.meshes[0].customDepthMaterial,first);assert.notEqual(f.meshes[1].customDepthMaterial,f.originals[1].depth);assert.equal(f.shadowMap.needsUpdate,true);assert.equal(f.environment.stats.shadowMaterialProgramsPending,0);assert.deepEqual(f.notices,['preparation','preparation','ready']);
});

test('disabling and re-enabling shadows retains authored bindings and reuses prepared pairs with one refresh',async context=>{
 const f=fixture(context,1);await f.colourReady();f.shadowMap.enabled=false;f.environment.prepare(32,true);assert.equal(f.originalBindings(),true);
 while(f.queue.pending){await f.one();assert.equal(f.dirty,false,'A late successful private compile must not dirty a disabled shadow view.');assert.equal(f.originalBindings(),true);}
 assert.equal(f.shadowCompiles,2);assert.equal(f.shadowMap.needsUpdate,false);f.notices.length=0;f.shadowMap.enabled=true;f.environment.prepare(48,true);
 assert.equal(f.originalBindings(),false);assert.equal(f.shadowMap.needsUpdate,true);assert.equal(f.dirty,true);assert.deepEqual(f.notices,['ready']);const depth=f.meshes[0].customDepthMaterial,distance=f.meshes[0].customDistanceMaterial;
 f.resetDirty();f.shadowMap.needsUpdate=false;f.notices.length=0;f.shadowMap.enabled=false;f.environment.prepare(64,true);assert.equal(f.originalBindings(),true);assert.equal(f.dirty,false);assert.equal(f.shadowMap.needsUpdate,false);
 f.shadowMap.enabled=true;f.environment.prepare(80,true);assert.equal(f.meshes[0].customDepthMaterial,depth);assert.equal(f.meshes[0].customDistanceMaterial,distance);assert.equal(f.shadowCompiles,2,'The prepared pair is reused without another GPU compile.');assert.equal(f.shadowMap.needsUpdate,true);assert.deepEqual(f.notices,['visual']);assert.equal(f.clockReads,0);
});

test('the actual village draw predicate permits prep-only RAF turns and still honours publication, input and real transitions',async context=>{
 const caller=readFileSync(new URL('./village-view.ts',import.meta.url),'utf8'),start=caller.indexOf('function render(now: number)'),body=caller.slice(start),expression=body.match(/if \((dirty \|\| changed \|\| environmentChanged[^\n]+)\) \{/)?.[1];assert.ok(expression);
 const names=['dirty','changed','environmentChanged','transitioning','animateFire','animateGarden','animateRaid','animateResident','animatePopulation','vegetationTransition'],draw=Function(...names,'return '+expression+';')as(...values:boolean[])=>boolean;
 const flags=Array(names.length).fill(false)as boolean[];assert.equal(draw(...flags),false);assert.match(body, /vegetationQueue\.pending && !options\.authorPondProbe && !planarPond/,'The queue keeps its RAF/pump continuation.');assert.doesNotMatch(expression,/pending|preparing|retiring/,'A nonvisual preparation/retirement state is not a world-draw condition.');
 const handoff=createVegetationHandoff(TREE_HLOD);for(const now of[0,16,32])assert.equal(handoff.update(now,150,1,true).transitioning,false,'A missing LOD uses its ready source; pending is not an alpha transition.');
 for(let i=0;i<flags.length;i++){const active=flags.slice();active[i]=true;assert.equal(draw(...active),true,names[i]+' retains its real draw.');}
 const f=fixture(context,1),demand=createObservationDemandRender();demand.update(true,50000,4000);await f.colourReady();let draws=0;
 for(let turn=0;turn<8&&f.environment.stats.materialGraphPending;turn++){await f.one();assert.equal(draw(f.dirty,...flags.slice(1)),false);assert.equal(demand.allowCompletionPollDraw(f.dirty),false);f.environment.prepare(32+turn*16);if(demand.allowCompletionPollDraw(f.dirty)&&draw(f.dirty,...flags.slice(1)))draws++;}
 assert.equal(draws,1);assert.equal(f.shadowMap.needsUpdate,true);assert.equal(f.environment.stats.materialGraphPending,false);assert.equal(f.worldRenders,0);
});

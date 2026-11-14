import test,{type TestContext}from'node:test';
import assert from'node:assert/strict';
import{BoxGeometry,DirectionalLight,Group,Mesh,MeshStandardMaterial,PerspectiveCamera,Scene,Texture,type WebGLRenderer}from'three';
import{createWorldEnvironment}from'./world-environment';
import{createWorldPreparationQueue}from'../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import{createWorldEnvironmentChangeHandler,type WorldEnvironmentChangeReason}from'../../../../shared/legacy/aethelgard/environment/environment-change';
import{bindWorldGeometryOwner}from'../../../../shared/legacy/aethelgard/environment/world-geometry-readers';
import{createWorldOwnerRetirement}from'../../../../shared/legacy/aethelgard/environment/world-owner-retirement';

const native=false;
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(context:TestContext,count:number,configuration:{fail?:string;queueSize?:number;plant?:boolean;envMap?:boolean;clock?:Parameters<typeof createWorldEnvironment>[0]['readClock'];compile?:(mesh:Mesh)=>Promise<void>;cancel?():void}={}){
 const prior=Object.getOwnPropertyDescriptor(globalThis,'Worker');class PendingCloud{onmessage:unknown;onerror:unknown;postMessage(){}terminate(){}}Object.defineProperty(globalThis,'Worker',{configurable:true,value:PendingCloud});
 const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera(),geometry=new BoxGeometry(),texture=new Texture();scene.add(sourceRoot,atmosphere,sun);
 const originals=Array.from({length:count},(_,i)=>new MeshStandardMaterial({name:'colour-'+i,map:texture,roughness:.42,metalness:.12,alphaTest:.333,envMap:configuration.envMap?texture:null,envMapIntensity:1.7}));
 const meshes=originals.map(material=>{const mesh=new Mesh(geometry,material);if(configuration.plant!==false)mesh.userData.crownfallVegetationWind={root:[0,-.5,0],tip:[0,.5,0],grass:false};sourceRoot.add(mesh);return mesh;});
 let quality:'low'|'medium'|'high'='high',now=0,clockReads=0,compiles=0,draws=0,dirty=false,borrowedDisposals=0;
 const notices:WorldEnvironmentChangeReason[]=[],queue=createWorldPreparationQueue(()=>{},configuration.queueSize??64),notify=createWorldEnvironmentChangeHandler({prepare(){},render(){dirty=true;}});
 const previews:MeshStandardMaterial[]=[];
 const renderer={debug:{onShaderError:undefined},shadowMap:{enabled:false},render(){draws++;throw Error('CPU lifecycle test must not render a world.');},async compileAsync(preview:Mesh){compiles++;const material=preview.material as MeshStandardMaterial;previews.push(material);if(material.name===configuration.fail)throw Error('terminal colour compile failure');await configuration.compile?.(preview);}}as unknown as WebGLRenderer;
 const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,renderer,queue,signal:new AbortController().signal,native,quality:()=>quality,reducedMotion:()=>true,readClock(){clockReads++;return configuration.clock?.()??null;},setSunDirection(){},changed(reason='visual'){notices.push(reason);notify(reason);}});
 for(const resource of[geometry,texture,...originals])resource.addEventListener('dispose',()=>borrowedDisposals++);
 function scan(force=false){return environment.prepare(now+=16,force);}
 async function one(){for(let i=0;i<2&&queue.pending;i++){queue.step();await tick();await tick();}scan();}
 context.after(async()=>{environment.dispose();queue.dispose();configuration.cancel?.();await queue.whenIdle();await tick();assert.equal(borrowedDisposals,0);geometry.dispose();texture.dispose();for(const material of originals)material.dispose();if(prior)Object.defineProperty(globalThis,'Worker',prior);else Reflect.deleteProperty(globalThis,'Worker');});
 return{environment,queue,sourceRoot,meshes,originals,texture,previews,notices,scan,one,setQuality(value:typeof quality){quality=value;},resetDirty(){dirty=false;},get dirty(){return dirty;},get compiles(){return compiles;},get clockReads(){return clockReads;},get draws(){return draws;}};
}

test('seventy visible colour variants publish32/32/6 with old valid bindings between bounded cohorts',async context=>{
 const f=fixture(context,70);f.scan();const cohorts:number[]=[];let installed=0;
 for(let turn=0;turn<100&&(f.queue.pending||f.environment.stats.materialGraphPending);turn++){
  assert.ok(f.environment.stats.materialProgramsPending<=2);await f.one();
  const actual=f.meshes.filter((mesh,i)=>mesh.material!==f.originals[i]).length;
  if(actual!==installed){cohorts.push(actual-installed);installed=actual;}
  if(f.compiles<32){assert.equal(actual,0,'Private ready previews must not publish a full High frame every one or two jobs.');assert.equal(f.environment.stats.activeWindReadyMaterialSlots,0);}
  assert.equal(f.environment.stats.activeWindReadyMaterialSlots,actual,'Coverage counts assigned draw materials, not private compiled candidates.');
 }
 assert.equal(f.compiles,70);assert.deepEqual(cohorts,[32,32,6]);assert.equal(installed,70);assert.equal(f.environment.stats.materialGraphPending,false);assert.equal(f.environment.stats.materialProgramsPending,0);assert.equal(f.notices.filter(reason=>reason!=='preparation').length,3);assert.equal(f.notices.filter(reason=>reason==='ready').length,1);
 for(const mesh of f.meshes){const material=mesh.material as MeshStandardMaterial;assert.equal(material.map,f.texture);assert.equal(material.roughness,.42);assert.equal(material.metalness,.12);assert.equal(material.alphaTest,.333);}
 f.resetDirty();f.scan(true);assert.equal(f.dirty,false);assert.equal(f.clockReads,0);assert.equal(f.draws,0);
});

test('dormant cohorts continue preparation across an empty queue without inventing visible frames',async context=>{
 const f=fixture(context,70);for(const mesh of f.meshes)mesh.visible=false;f.scan();
 for(let turn=0;turn<100&&(f.queue.pending||f.environment.stats.materialGraphPending);turn++){await f.one();if(f.environment.stats.materialGraphPending)assert.equal(f.dirty,false);}
 assert.equal(f.compiles,70);assert.equal(f.environment.stats.colourPublicationBatches,3);assert.equal(f.environment.stats.activeWindMaterialSlots,0);assert.equal(f.environment.stats.activeWindReadyMaterialSlots,0);assert.equal(f.environment.stats.materialGraphPending,false);assert.equal(f.notices.filter(reason=>reason!=='preparation').length,1);assert.equal(f.notices[f.notices.length-1],'ready');assert.equal(f.clockReads,0);
});

test('shared and multi-slot nodes charge unique variants and preserve every old slot until its cohort is ready',async context=>{
 const f=fixture(context,34),main=f.meshes[0] as Mesh<BoxGeometry,MeshStandardMaterial|MeshStandardMaterial[]>,authored=f.originals.slice();main.material=authored;for(const mesh of f.meshes.slice(1))mesh.removeFromParent();const shared=[new Mesh(main.geometry,[f.originals[0],f.originals[1]]),new Mesh(main.geometry,[f.originals[0],f.originals[1]])];for(const mesh of shared){mesh.userData.crownfallVegetationWind=main.userData.crownfallVegetationWind;f.sourceRoot.add(mesh);}f.scan();
 for(let turn=0;turn<60&&(f.queue.pending||f.environment.stats.materialGraphPending);turn++){await f.one();assert.ok(f.environment.stats.materialProgramsPending<=2);assert.ok(f.environment.stats.colourMaterialsStaged+f.environment.stats.materialProgramsPending-f.environment.stats.shadowMaterialProgramsPending<=32);for(const [i,material]of authored.entries())assert.equal(material,f.originals[i]);}
 assert.equal(f.compiles,34);assert.equal(f.environment.stats.ownedColourMaterials,34);assert.equal(f.environment.stats.colourPublicationBatches,2);assert.equal(f.environment.stats.activeWindMaterialSlots,38);assert.equal(f.environment.stats.activeWindReadyMaterialSlots,38);assert.ok(Array.isArray(main.material));for(const mesh of shared){assert.ok(Array.isArray(mesh.material));assert.equal(mesh.material[0],main.material[0]);assert.equal(mesh.material[1],main.material[1]);}assert.equal(f.environment.stats.materialGraphPending,false);
});

test('cached-ready overflow has one bounded continuation per publication and bypasses the5second scan throttle',async context=>{
 const f=fixture(context,70);f.scan();for(let turn=0;turn<100&&(f.queue.pending||f.environment.stats.materialGraphPending);turn++)await f.one();const first=f.meshes.map(mesh=>mesh.material);
 for(const mesh of f.meshes)mesh.userData.crownfallVegetationWind={root:[1,-.5,0],tip:[1,.5,0],grass:false};f.scan(true);for(let turn=0;turn<100&&(f.queue.pending||f.environment.stats.materialGraphPending);turn++)await f.one();assert.equal(f.compiles,140);assert.ok(f.meshes.every((mesh,i)=>mesh.material!==first[i]));
 for(const mesh of f.meshes)mesh.userData.crownfallVegetationWind={root:[0,-.5,0],tip:[0,.5,0],grass:false};const notices=f.notices.length;f.scan(true);assert.equal(f.meshes.filter((mesh,i)=>mesh.material===first[i]).length,32);assert.equal(f.queue.pending,false);assert.equal(f.environment.stats.colourReadyUnpublished,38);assert.equal(f.environment.stats.colourMaterialsStaged,32);f.scan();assert.equal(f.meshes.filter((mesh,i)=>mesh.material===first[i]).length,64);f.scan();assert.ok(f.meshes.every((mesh,i)=>mesh.material===first[i]));assert.equal(f.compiles,140);assert.equal(f.environment.stats.materialGraphPending,false);assert.deepEqual(f.notices.slice(notices),['visual','visual','ready']);f.resetDirty();f.scan();assert.equal(f.dirty,false);assert.equal(f.environment.stats.colourReadyUnpublished,0);
});

test('a terminal rejected last colour job flushes its successful neighbour without false readiness or repeated wakes',async context=>{
 const f=fixture(context,2,{fail:'colour-1'});f.scan();await f.one();assert.notEqual(f.meshes[0].material,f.originals[0]);assert.equal(f.meshes[1].material,f.originals[1]);assert.equal(f.environment.stats.activeWindReadyMaterialSlots,1);assert.equal(f.environment.stats.materialProgramsPending,0);assert.equal(f.queue.pending,false);assert.equal(f.environment.stats.materialGraphPending,true);assert.match(f.environment.stats.surfaceWeatherError,/terminal colour/);assert.deepEqual(f.notices,['preparation','preparation','visual']);f.resetDirty();for(let i=0;i<4;i++)f.scan(true);assert.equal(f.dirty,false);assert.equal(f.compiles,2);assert.equal(f.notices.includes('ready'),false);
});

test('a real queue admission refusal gets one drain and flush, preserves fallback and remains retryable',async context=>{
 const f=fixture(context,2,{queueSize:1});f.scan();await tick();await tick();assert.equal(f.environment.stats.ownedColourMaterials,1);await f.one();assert.equal(f.compiles,1);assert.notEqual(f.meshes[0].material,f.originals[0]);assert.equal(f.meshes[1].material,f.originals[1]);assert.equal(f.queue.pending,false);assert.equal(f.environment.stats.materialProgramsPending,0);assert.equal(f.environment.stats.activeWindReadyMaterialSlots,1);assert.equal(f.environment.stats.surfaceWeatherError,'');const notices=f.notices.length;assert.equal(f.scan(),true,'Actual partial publication must buy one clock-free continuation even when the queue is empty.');assert.equal(f.queue.pending,true);for(let i=0;i<4;i++)f.scan();assert.equal(f.compiles,1);assert.equal(f.notices.length,notices,'Waiting for an admitted compile cannot create repeated publication wakes.');await f.one();assert.equal(f.compiles,2);assert.equal(f.environment.stats.ownedColourMaterials,2);assert.equal(f.environment.stats.activeWindReadyMaterialSlots,2);assert.equal(f.environment.stats.materialGraphPending,false);
});

test('publication-driven retry quiesces under permanent refusal without a timer or a5second forced scan',async context=>{
 const f=fixture(context,2),enqueue=f.queue.enqueue.bind(f.queue);let admissions=0,refused=0;
 f.queue.enqueue=(options=>{if(admissions++===0)return enqueue(options);refused++;return Promise.reject(Error('World preparation exceeds the bounded job/upload budget.'));})as typeof f.queue.enqueue;
 f.scan();await tick();await tick();let serviced=0,turns=0;
 // Consume only real queue work and notifier-scheduled turns. No clock read,
 // forced prepare, time leap or materialGraphPending polling supplies a wake.
 for(;turns<12;turns++){
  if(f.queue.pending){await f.one();serviced=f.notices.length-1;continue;}
  if(serviced>=f.notices.length)break;serviced=f.notices.length;f.scan();await tick();await tick();
 }
 assert.ok(turns<12);assert.equal(f.compiles,1);assert.equal(refused,2,'One actual ready publication buys one retry; repeated refusal alone buys none.');assert.equal(f.queue.pending,false);assert.equal(f.environment.stats.materialProgramsPending,0);assert.equal(f.environment.stats.activeWindReadyMaterialSlots,1);assert.equal(f.meshes[1].material,f.originals[1]);const notices=f.notices.length;for(let i=0;i<4;i++)assert.equal(f.scan(),false);assert.equal(f.notices.length,notices);assert.equal(refused,2);assert.equal(f.clockReads,0);
});

test('unadmitted384material budget rows do not starve the final ready cohort or claim full coverage',async context=>{
 const f=fixture(context,386);f.scan();for(let turn=0;turn<450&&(f.queue.pending||!f.environment.stats.colourBudgetHeld);turn++)await f.one();while(f.queue.pending)await f.one();assert.equal(f.compiles,384);assert.equal(f.environment.stats.ownedColourMaterials,384);assert.equal(f.environment.stats.colourBudgetHeld,true);assert.equal(f.environment.stats.materialGraphPending,true);assert.equal(f.environment.stats.activeWindMaterialSlots,386);assert.equal(f.environment.stats.activeWindReadyMaterialSlots,384);assert.ok(f.meshes.slice(384).every((mesh,i)=>mesh.material===f.originals[384+i]));assert.equal(f.environment.stats.colourReadyUnpublished,0);assert.equal(f.notices.includes('ready'),false);f.resetDirty();f.scan(true);assert.equal(f.dirty,false);assert.equal(f.queue.pending,false);
});

test('a ready partial cohort does not wait for an unrelated queued world job',async context=>{
 const f=fixture(context,1);f.scan();let unrelated=false;const external=f.queue.enqueue({bytes:0,signal:new AbortController().signal,priority:()=>200,work(){unrelated=true;}});f.queue.step();await tick();await tick();f.scan();assert.notEqual(f.meshes[0].material,f.originals[0]);assert.equal(f.environment.stats.activeWindReadyMaterialSlots,1);assert.equal(f.environment.stats.materialGraphPending,false);assert.equal(f.queue.pending,true);assert.equal(unrelated,false);f.queue.step();await external;
});

test('removed nodes and replaced source materials cannot receive stale deferred candidates',async context=>{
 const f=fixture(context,6);f.scan();f.queue.step();await tick();await tick();const detached=f.meshes[0];detached.removeFromParent();const replacement=new MeshStandardMaterial({roughness:.93,map:f.texture,alphaTest:.17});f.meshes[1].material=replacement;context.after(()=>replacement.dispose());for(let turn=0;turn<30&&(f.queue.pending||f.environment.stats.materialGraphPending);turn++)await f.one();assert.equal(detached.material,f.originals[0]);assert.notEqual(f.meshes[1].material,f.originals[1]);assert.notEqual(f.meshes[1].material,replacement);assert.equal((f.meshes[1].material as MeshStandardMaterial).roughness,.93);assert.equal((f.meshes[1].material as MeshStandardMaterial).alphaTest,.17);assert.equal(f.environment.stats.activeWindMaterialSlots,5);assert.equal(f.environment.stats.activeWindReadyMaterialSlots,5);assert.equal(f.environment.stats.materialGraphPending,false);
});

test('quality changes and disabled wind publish only the currently requested variant',async context=>{
 const f=fixture(context,2);f.scan();f.queue.step();await tick();await tick();f.setQuality('low');for(const mesh of f.meshes)delete mesh.userData.crownfallVegetationWind;f.scan(true);while(f.queue.pending)await f.one();f.scan(true);assert.ok(f.meshes.every((mesh,i)=>mesh.material===f.originals[i]));assert.equal(f.environment.stats.activeWindMaterialSlots,0);assert.equal(f.environment.stats.activeWindReadyMaterialSlots,0);assert.equal(f.environment.stats.materialGraphPending,false);assert.equal(f.compiles,2,'Late High/wind success cannot invent an unwanted Low variant or replace PBR.');
});

test('newly published PBR uses the latest sampled state while wind uniform objects stay live',async context=>{
 let minute=0;const f=fixture(context,4,{envMap:true,clock:()=>({time:{absoluteWorldMinute:minute,fractionalMinute:0,dayIndex:0,dayMinute:minute,elapsedWorldMinutes:minute,deferredMilliseconds:0},worldKey:'cpu-latest-colour',animationSeconds:minute})});f.environment.update(0);f.queue.step();await tick();await tick();minute=720;f.environment.update(6000);const latest=f.environment.state!;const reads=f.clockReads;for(let turn=0;turn<20&&(f.queue.pending||f.environment.stats.materialGraphPending);turn++)await f.one();assert.equal(f.clockReads,reads,'Preparation cannot reread or advance the world clock.');assert.equal(f.environment.state,latest);for(const mesh of f.meshes){const material=mesh.material as MeshStandardMaterial,expected=native?1.7:1.7*(.045+.955*latest.daylight)*latest.cloudTransmission;assert.ok(Math.abs(material.envMapIntensity-expected)<1e-12);}
 const shaders=f.previews.map(material=>{const shader={uniforms:{},vertexShader:'#include <common>\n#include <defaultnormal_vertex>\n#include <begin_vertex>\n#include <worldpos_vertex>\n#include <morphtarget_vertex>',fragmentShader:'#include <common>'};material.onBeforeCompile(shader as never,{}as WebGLRenderer);return shader as unknown as{uniforms:Record<string,{value:unknown}>};});assert.ok(shaders.length>=2);assert.equal(shaders[0].uniforms.cfDaylight,shaders[shaders.length-1]!.uniforms.cfDaylight);assert.equal(shaders[0].uniforms.cfDaylight.value,latest.daylight);
});

test('retired private geometry cannot consume a cached-ready deferred material on late reattachment',async context=>{
 const f=fixture(context,2),mesh=f.meshes[0],privateGeometry=mesh.geometry.clone();mesh.geometry=privateGeometry;let credit=1;const owner=createWorldOwnerRetirement({stop(){mesh.removeFromParent();},producer:()=>Promise.resolve(),fence:async()=>{},releaseOwned(){for(const key of Object.keys(privateGeometry.attributes))privateGeometry.deleteAttribute(key);privateGeometry.setIndex(null);privateGeometry.dispose();},releaseCredit(){credit=0;}});bindWorldGeometryOwner(privateGeometry,owner);f.scan();f.queue.step();await tick();await tick();assert.equal(mesh.material,f.originals[0]);await owner.retire();assert.equal(credit,0);assert.equal(privateGeometry.getAttribute('position'),undefined);f.sourceRoot.add(mesh);f.scan(true);assert.equal(mesh.material,f.originals[0]);assert.equal(owner.stats.phase,'retired');assert.equal(owner.stats.acquired,1);assert.equal(f.environment.stats.activeWindReadyMaterialSlots,0);while(f.queue.pending)await f.one();assert.equal(mesh.material,f.originals[0]);assert.equal(owner.stats.acquired,1,'No candidate lookup or clone admission may reopen the retired source.');
});

test('disposing while a private colour compile is pending leaves borrowed assets intact and suppresses late publication',async context=>{
 let release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;}),f=fixture(context,2,{compile:()=>hold,cancel:()=>release()});f.scan();f.queue.step();await tick();const notices=f.notices.slice();f.environment.dispose();assert.ok(f.meshes.every((mesh,i)=>mesh.material===f.originals[i]));release();while(f.queue.pending){f.queue.step();await tick();await tick();}await f.queue.whenIdle();assert.deepEqual(f.notices,notices);assert.equal(f.environment.stats.status,'disposed');assert.equal(f.environment.stats.materialProgramsPending,0);assert.ok(f.meshes.every((mesh,i)=>mesh.material===f.originals[i]));
});

import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,DirectionalLight,Group,InstancedMesh,Mesh,SkinnedMesh,MeshDepthMaterial,MeshStandardMaterial,PerspectiveCamera,Scene,ShaderMaterial,Texture,Vector3,type WebGLRenderer} from 'three';
import {VEGETATION_WIND_SHADER_VERSION} from '../../../../shared/legacy/aethelgard/environment/vegetation-wind';
import {createWorldEnvironment} from './world-environment';
import {createWorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import {describeVillageWorld,type VillageWorldStatus} from '../../../../shared/legacy/aethelgard/environment/world-status';

test('cloud phase advances between weather samples, pauses with the clock and respects reduced motion without rebaking',async()=>{
 const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera();scene.add(sourceRoot,atmosphere,sun);
 const queue=createWorldPreparationQueue(()=>{});let seconds=1200,reduced=false,fraction=0;
 const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,queue,renderer:{} as WebGLRenderer,signal:new AbortController().signal,
  quality:()=> 'low',reducedMotion:()=>reduced,readClock:()=>({time:{absoluteWorldMinute:720,fractionalMinute:fraction,dayIndex:0,dayMinute:720,elapsedWorldMinutes:720,deferredMilliseconds:0},worldKey:'cloud-test',animationSeconds:seconds}),changed(){},setSunDirection(){}});
 try{
  environment.update(0);const phase=environment.stats.cloudOffset.slice(),builds=environment.stats.cloudDensityBuilds;
  seconds+=.016;fraction=.001;assert.equal(environment.update(16),true);assert.equal(environment.animationSeconds,seconds);assert.notDeepEqual(environment.stats.cloudOffset,phase,'Per-frame movement must not wait for the .015-world-minute weather threshold.');
  const stopped=environment.stats.cloudOffset.slice();assert.equal(environment.update(32),false);assert.deepEqual(environment.stats.cloudOffset,stopped);
  reduced=true;environment.update(48);assert.equal(environment.animationSeconds,0);assert.deepEqual(environment.stats.cloudOffset,[0,0]);
  reduced=false;environment.update(64);assert.equal(environment.animationSeconds,seconds);assert.deepEqual(environment.stats.cloudOffset,stopped);assert.equal(environment.stats.cloudDensityBuilds,builds,'Live advection never regenerates static density.');
 }finally{environment.dispose();await queue.whenIdle();queue.dispose();}
});

test('the HUD publishes the saved village time only when its displayed minute or weather changes',async()=>{
 const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera();scene.add(sourceRoot,atmosphere,sun);
 const queue=createWorldPreparationQueue(()=>{}),updates:VillageWorldStatus[]=[];let minute=720,fraction=0,clockAvailable=false;
 const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,queue,renderer:{} as WebGLRenderer,signal:new AbortController().signal,
  quality:()=> 'low',reducedMotion:()=>false,statusChanged:status=>updates.push(status),
  readClock:()=>clockAvailable?{time:{absoluteWorldMinute:minute,fractionalMinute:fraction,dayIndex:Math.floor(minute/1440),dayMinute:minute%1440,elapsedWorldMinutes:minute,deferredMilliseconds:0},worldKey:'hud-test',animationSeconds:minute*4}:null,changed(){},setSunDirection(){}});
 try{
  environment.update(0);assert.equal(updates.length,0,'A preview must not invent a clock before confirmed entry.');
  clockAvailable=true;environment.update(1);assert.equal(updates.length,1);assert.equal(describeVillageWorld(updates[0]).time,'12:00');
  for(let i=1;i<20;i++){fraction=i*.02;environment.update(i*16);}
  assert.equal(updates.length,1,'Moving clouds and sub-minute sunlight must not repaint the HUD each frame.');
  minute=721;fraction=0;environment.update(400);assert.equal(updates.length,2);assert.equal(describeVillageWorld(updates[1]).time,'12:01');
  minute=1440;environment.update(500);assert.match(describeVillageWorld(updates.at(-1)!).accessible,/Day 2, 00:00/);
  const count=updates.length;environment.update(600);assert.equal(updates.length,count,'A stopped clock retains its displayed time.');
  environment.dispose();minute=1441;environment.update(700);assert.equal(updates.length,count,'Disposed worlds must not update a stale screen.');
 }finally{environment.dispose();await queue.whenIdle();queue.dispose();}
});

test('temporary upload pressure retries weather materials without losing source resources or retrying every frame',async()=>{
 const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera();scene.add(sourceRoot,atmosphere,sun);
 const geometry=new BoxGeometry(),map=new Texture(),original=new MeshStandardMaterial({map}),mesh=new Mesh(geometry,original);sourceRoot.add(mesh);
 let borrowedDisposals=0,attempts=0,retiredPreviews=0;
 for(const resource of [geometry,map,original])resource.addEventListener('dispose',()=>borrowedDisposals++);
 const queue=createWorldPreparationQueue(()=>{},1),signal=new AbortController().signal;
 const blocker=queue.enqueue({bytes:0,signal,priority:()=>0,work:()=>{}});
 const renderer={debug:{onShaderError:undefined},async compileAsync(preview:Mesh){attempts++;(preview.material as MeshStandardMaterial).addEventListener('dispose',()=>retiredPreviews++);}} as unknown as WebGLRenderer;
 const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,queue,renderer,signal,
  quality:()=> 'medium',reducedMotion:()=>false,readClock:()=>({time:{absoluteWorldMinute:720,fractionalMinute:0,dayIndex:0,dayMinute:720,elapsedWorldMinutes:720,deferredMilliseconds:0},worldKey:'material-pressure',animationSeconds:1200}),changed(){},setSunDirection(){}});
 const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
 try{
  environment.update(0);await settle();assert.equal(mesh.material,original);assert.equal(environment.stats.materialProgramsPending,0);
  assert.equal(environment.stats.surfaceWeatherError,'','A bounded queue is temporary pressure, not a broken shader.');
  queue.step();await blocker;await settle();
  for(let frame=1;frame<50;frame++)environment.update(frame*16);
  assert.equal(queue.stats.pending,0,'Retry must retain the existing five-second scan interval.');
  environment.update(6000);assert.equal(queue.stats.pending,1,'A later scan must retry the temporarily refused material.');
  queue.step();await queue.whenIdle();await settle();environment.update(6016);
  assert.equal(attempts,1);assert.notEqual(mesh.material,original);assert.equal(mesh.material.map,map);
  assert.match(mesh.material.customProgramCacheKey(),/queued-world-environment/);assert.equal(borrowedDisposals,0);
  environment.dispose();await queue.whenIdle();await settle();assert.equal(mesh.material,original);assert.equal(retiredPreviews,1);
  assert.equal(borrowedDisposals,0,'World disposal must not dispose GLB-owned maps, geometry or materials.');
 }finally{environment.dispose();queue.dispose();await blocker.catch(()=>{});geometry.dispose();map.dispose();original.dispose();}
});

test('a permanent weather shader error retains the source material and explicit fallback without compile storms',async()=>{
 const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera();scene.add(sourceRoot,atmosphere,sun);
 const geometry=new BoxGeometry(),original=new MeshStandardMaterial(),mesh=new Mesh(geometry,original);sourceRoot.add(mesh);
 const queue=createWorldPreparationQueue(()=>{},1),signal=new AbortController().signal;let attempts=0,blocker:Promise<void>|undefined;const laterOriginal=new MeshStandardMaterial();
 const renderer={debug:{onShaderError:undefined},async compileAsync(){attempts++;throw Error('unsupported weather shader');}} as unknown as WebGLRenderer;
 const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,queue,renderer,signal,
  quality:()=> 'medium',reducedMotion:()=>false,readClock:()=>({time:{absoluteWorldMinute:720,fractionalMinute:0,dayIndex:0,dayMinute:720,elapsedWorldMinutes:720,deferredMilliseconds:0},worldKey:'material-failure',animationSeconds:1200}),changed(){},setSunDirection(){}});
 try{
  environment.update(0);queue.step();await queue.whenIdle();await new Promise<void>(resolve=>setImmediate(resolve));
  for(const now of [6000,12000,18000])environment.update(now);
  assert.equal(attempts,1);assert.equal(mesh.material,original);assert.equal(environment.stats.surfaceWeather,'fallback-shader');
  assert.match(environment.stats.surfaceWeatherError,/unsupported weather shader/);assert.equal(queue.stats.pending,0);
  sourceRoot.add(new Mesh(geometry,laterOriginal));blocker=queue.enqueue({bytes:0,signal,priority:()=>0,work:()=>{}});
  environment.update(24000);await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(environment.stats.surfaceWeather,'fallback-shader','A later queue refusal must not hide a real shader failure.');
  queue.step();await blocker;await queue.whenIdle();
 }finally{environment.dispose();queue.dispose();await blocker?.catch(()=>{});await queue.whenIdle();geometry.dispose();original.dispose();laterOriginal.dispose();}
});

test('cloud uploads retain one baked density through queue pressure and cancel pending retry work on world disposal',async context=>{
 const previousWorker=Object.getOwnPropertyDescriptor(globalThis,'Worker');let bakes=0,uploads=0;
 const payloads:Uint8Array[]=[];
 context.mock.timers.enable({apis:['setTimeout']});
 const scheduled=context.mock.method(globalThis,'setTimeout'),cancelled=context.mock.method(globalThis,'clearTimeout');
 // Key hashing is not the subject of this scheduling test. Preserve real
 // SHA-256 bytes while avoiding an unrelated libuv/WebCrypto completion race.
 const digest=context.mock.method(crypto.subtle,'digest',async(algorithm:Parameters<typeof crypto.subtle.digest>[0],input:Parameters<typeof crypto.subtle.digest>[1])=>{
  assert.equal(typeof algorithm==='string'?algorithm:algorithm.name,'SHA-256');
  const bytes=ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):new Uint8Array(input);
  return Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer;
 });
 class DensityWorker{
  onmessage:((event:{data:{data:Uint8Array;backend:string}})=>void)|null=null;
  postMessage({width,height}:{width:number;height:number}){bakes++;const data=new Uint8Array(width*height*width*2);for(let z=0;z<width;z++)for(let x=0;x<width;x++)for(let y=0;y<height;y++){const at=((z*height+y)*width+x)*2;data[at]=y===Math.floor(height/2)?128:0;data[at+1]=Math.round(x/(width-1)*255);}payloads.push(data);queueMicrotask(()=>this.onmessage?.({data:{data,backend:'test-worker'}}));}
  terminate(){}
 }
 Object.defineProperty(globalThis,'Worker',{configurable:true,writable:true,value:DensityWorker});
 const signal=new AbortController().signal;
 function fixture(){
  const notices:string[]=[];
  const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera();scene.add(sourceRoot,atmosphere,sun);
  const queue=createWorldPreparationQueue(()=>{},1),blocker=queue.enqueue({bytes:0,signal,priority:()=>0,work:()=>{}});
  const renderer={initTexture(texture:{image:{data:Uint8Array}}){uploads++;assert.equal(texture.image.data,payloads[payloads.length-1],'The retry uploads the exact retained worker density.');}} as unknown as WebGLRenderer;
  const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,queue,renderer,signal,
   quality:()=> 'low',reducedMotion:()=>false,readClock:()=>null,changed(reason='visual'){notices.push(reason);},setSunDirection(){}});
  return {environment,queue,blocker,notices};
 }
 const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
 async function until(check:()=>boolean,service=()=>{}){for(let turn=0;!check()&&turn<32;turn++){service();await flush();}assert.ok(check(),'Cloud preparation completed within bounded asynchronous turns.');}
 let active:ReturnType<typeof fixture>|undefined;
 try{
  active=fixture();await until(()=>active!.environment.stats.cloudUploadRetries===1);
  assert.deepEqual(active.notices,['preparation'],'A refused upload changes readiness metadata, not the sky texture.');
  assert.equal(active.environment.stats.status,'waiting-for-cloud-upload');assert.equal(bakes,1);assert.equal(uploads,0);assert.equal(scheduled.mock.callCount(),1);
  active.queue.step();await active.blocker;await flush();
  context.mock.timers.tick(999);await flush();assert.equal(uploads,0,'The retained upload waits for its authored retry delay.');assert.equal(bakes,1);
  context.mock.timers.tick(1);await until(()=>active!.environment.stats.status==='ready',()=>active!.queue.step());
  assert.equal(uploads,1);assert.equal(bakes,1,'Retrying uploads must not regenerate cloud density.');
  assert.deepEqual(active.notices,['preparation','visual'],'Publishing the actual density must retain its visual wake.');
  assert.equal(active.environment.stats.cloudDensityBuilds,1);assert.equal(active.environment.stats.cloudUploadRetries,1);
  active.environment.dispose();active.queue.dispose();active=fixture();
  await until(()=>active!.environment.stats.cloudUploadRetries===1);assert.equal(bakes,2);assert.equal(uploads,1);assert.equal(scheduled.mock.callCount(),2);
  const retryTimer=scheduled.mock.calls[scheduled.mock.calls.length-1].result;
  active.environment.dispose();active.queue.dispose();await active.blocker.catch(()=>{});await flush();
  assert.ok(cancelled.mock.calls.some(call=>call.arguments[0]===retryTimer),'Disposal must clear the actual pending retry timer.');
  const retiredBakes=bakes,retiredUploads=uploads;
  context.mock.timers.tick(10000);await flush();
  assert.equal(active.environment.stats.status,'disposed');assert.equal(active.environment.stats.cloudUploadRetries,1);
  assert.equal(active.queue.stats.pending,0);assert.equal(bakes,retiredBakes);assert.equal(uploads,retiredUploads,'Disposed worlds must not submit the retained texture later.');assert.equal(scheduled.mock.callCount(),2,'Advancing past disposal must not schedule another retry.');
 }finally{
  active?.environment.dispose();active?.queue.dispose();await active?.blocker.catch(()=>{});
  scheduled.mock.restore();cancelled.mock.restore();digest.mock.restore();context.mock.timers.reset();
  if(previousWorker)Object.defineProperty(globalThis,'Worker',previousWorker);else Reflect.deleteProperty(globalThis,'Worker');
 }
});


test('Low and Native compile wind-only foliage plus matching shadow variants, follow clock pause and restore borrowed materials',async()=>{
 for(const native of [false,true]){
  const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera();scene.add(sourceRoot,atmosphere,sun);
  const geometry=new BoxGeometry(),original=new MeshStandardMaterial({name:'Imported foliage'}),mesh=new Mesh(geometry,original);mesh.castShadow=true;
  mesh.userData.crownfallVegetationWind={root:[0,-.5,0],tip:[0,.5,0],grass:false};sourceRoot.add(mesh);
  const queue=createWorldPreparationQueue(()=>{});let seconds=1200,reduced=false,retired=0;
  const programs:{vertex:string;fragment:string;uniforms:Record<string,{value:unknown}>}[]=[];
  const renderer={debug:{onShaderError:undefined},shadowMap:{enabled:true},async compileAsync(preview:Mesh){
   const material=preview.material as MeshStandardMaterial;material.addEventListener('dispose',()=>retired++);
   const shader={uniforms:{},vertexShader:'#include <common>\n#include <defaultnormal_vertex>\n#include <begin_vertex>\n#include <morphtarget_vertex>',fragmentShader:'#include <common>'};
   material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0],this as unknown as WebGLRenderer);
   programs.push({vertex:shader.vertexShader,fragment:shader.fragmentShader,uniforms:shader.uniforms});
  }} as unknown as WebGLRenderer;
  const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,queue,renderer,signal:new AbortController().signal,native,
   quality:()=> 'low',reducedMotion:()=>reduced,readClock:()=>({time:{absoluteWorldMinute:720,fractionalMinute:0,dayIndex:0,dayMinute:720,elapsedWorldMinutes:720,deferredMilliseconds:0},worldKey:'wind-low',animationSeconds:seconds}),changed(){},setSunDirection(){}});
  const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
  try{
   for(let scan=0;scan<8;scan++){environment.update(scan*6000);for(let work=0;queue.pending&&work<8;work++){queue.step();await settle();}await queue.whenIdle();await settle();}
   assert.notEqual(mesh.material,original);assert.equal(environment.stats.windProgramsReady,1);assert.equal(environment.stats.windShadowProgramsReady,2);
   assert.ok(mesh.material.customProgramCacheKey().includes(VEGETATION_WIND_SHADER_VERSION));
   assert.ok(mesh.customDepthMaterial!.customProgramCacheKey().includes(VEGETATION_WIND_SHADER_VERSION));assert.ok(mesh.customDistanceMaterial!.customProgramCacheKey().includes(VEGETATION_WIND_SHADER_VERSION));
   assert.equal(programs.length,3);for(const program of programs){assert.match(program.vertex,/CROWNFALL_VEGETATION_WIND/);assert.doesNotMatch(program.fragment,/CROWNFALL_WORLD_ENVIRONMENT|sampler3D/);}
   assert.ok(mesh.customDepthMaterial);assert.ok(mesh.customDistanceMaterial);assert.ok(environment.stats.windStrength>0);
   const program=programs[0],phase=program.uniforms.cfEnvironmentSeconds.value;environment.update(50000);assert.equal(program.uniforms.cfEnvironmentSeconds.value,phase,'A stopped observed clock also stops wind.');
   seconds+=.02;environment.update(50016);assert.equal(program.uniforms.cfEnvironmentSeconds.value,seconds);
   reduced=true;environment.update(50032);assert.equal(program.uniforms.cfWindStrength.value,0);assert.equal(environment.stats.windStrength,0);
   assert.equal(mesh.geometry,geometry);environment.dispose();await queue.whenIdle();assert.equal(mesh.material,original);assert.equal(mesh.customDepthMaterial,undefined);assert.equal(mesh.customDistanceMaterial,undefined);assert.equal(retired,3);
  }finally{environment.dispose();await queue.whenIdle();queue.dispose();geometry.dispose();original.dispose();}
 }
});


test('wind-only GLSL failures retain the source and never count a failed Low/Native program as ready',async()=>{
 const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera();scene.add(sourceRoot,atmosphere,sun);
 const geometry=new BoxGeometry(),original=new MeshStandardMaterial({name:'grass'}),mesh=new Mesh(geometry,original);sourceRoot.add(mesh);
 mesh.userData.crownfallVegetationWind={root:[0,-.5,0],tip:[0,.5,0],grass:true};
 const queue=createWorldPreparationQueue(()=>{});let attempts=0;
 const renderer={debug:{onShaderError:undefined},async compileAsync(){
  attempts++;
  type ErrorArguments=Parameters<NonNullable<WebGLRenderer['debug']['onShaderError']>>;
  const vertex:ErrorArguments[2]={},fragment:ErrorArguments[3]={};
  const gl:Pick<ErrorArguments[0],'getShaderSource'|'getProgramInfoLog'>={
   getShaderSource(shader){return shader===vertex?'#define CROWNFALL_VEGETATION_WIND':'plain fragment';},getProgramInfoLog(){return 'bad wind vertex';}
  };
  const program:ErrorArguments[1]={name:'wind-test',id:0,cacheKey:'wind-test',usedTimes:1,program:null,vertexShader:vertex,fragmentShader:fragment,
   getUniforms(){throw Error('The shader-error path must not read uniforms');},getAttributes(){return {};},destroy(){}};
  renderer.debug.onShaderError?.(gl as ErrorArguments[0],program,vertex,fragment);
 }} as unknown as WebGLRenderer;
 const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,queue,renderer,signal:new AbortController().signal,native:true,
  quality:()=> 'low',reducedMotion:()=>false,readClock:()=>({time:{absoluteWorldMinute:720,fractionalMinute:0,dayIndex:0,dayMinute:720,elapsedWorldMinutes:720,deferredMilliseconds:0},worldKey:'wind-failure',animationSeconds:1200}),changed(){},setSunDirection(){}});
 try{
  environment.update(0);queue.step();await queue.whenIdle();await new Promise<void>(resolve=>setImmediate(resolve));
  for(const now of [6000,12000,18000])environment.update(now);
  assert.equal(attempts,1);assert.equal(mesh.material,original);assert.equal(environment.stats.windProgramsReady,0);
  assert.match(environment.stats.surfaceWeatherError,/bad wind vertex/);assert.equal(environment.stats.surfaceWeather,'fallback-shader');
 }finally{environment.dispose();await queue.whenIdle();queue.dispose();geometry.dispose();original.dispose();}
});


for(const shadowsEnabled of [false,true])test(`${shadowsEnabled?'Enabled':'Disabled'} shadow rendering cannot exhaust wind colour residency in a many-node woodland`,async()=>{
 for(const native of [false,true]){
  const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera();scene.add(sourceRoot,atmosphere,sun);
  const geometry=new BoxGeometry(),original=new MeshStandardMaterial({name:'Woodland foliage'}),borrowedDepth=new MeshDepthMaterial(),nodes:Mesh[]=[];
  for(let i=0;i<260;i++){
   const mesh=new Mesh(geometry,original);mesh.castShadow=i%2===0;if(!mesh.castShadow)mesh.customDepthMaterial=borrowedDepth;
   mesh.userData.crownfallVegetationWind={root:[0,0,0],tip:[0,1+i*.01,0],grass:false};nodes.push(mesh);sourceRoot.add(mesh);
  }
  const queue=createWorldPreparationQueue(()=>{});let colourCompiles=0,shadowCompiles=0;
  const renderer={debug:{onShaderError:undefined},shadowMap:{enabled:false},async compileAsync(preview:Mesh){
   if(preview.material instanceof MeshStandardMaterial)colourCompiles++;else shadowCompiles++;
  }} as unknown as WebGLRenderer;
  const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,queue,renderer,signal:new AbortController().signal,native,
   quality:()=> 'low',reducedMotion:()=>false,readClock:()=>({time:{absoluteWorldMinute:720,fractionalMinute:0,dayIndex:0,dayMinute:720,elapsedWorldMinutes:720,deferredMilliseconds:0},worldKey:'wind-residency',animationSeconds:1200}),changed(){},setSunDirection(){}});
  const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
  try{
   for(let scan=0;scan<420;scan++){
    if(shadowsEnabled&&scan===150){assert.equal(colourCompiles,nodes.length);renderer.shadowMap.enabled=true;}
    environment.update(scan*6000);
    for(let work=0;queue.pending&&work<8;work++){queue.step();await settle();}
   }
   assert.equal(environment.stats.materialProgramsPending,0);
   assert.equal(colourCompiles,nodes.length,`native=${native}: every valid colour binding must prepare within the existing 512-material budget`);
   assert.equal(environment.stats.windProgramsReady,nodes.length);
   assert.equal(environment.stats.ownedColourMaterials,nodes.length);assert.equal(environment.stats.ownedShadowMaterials,shadowsEnabled?128:0);assert.equal(environment.stats.colourBudgetHeld,false);
   if(shadowsEnabled)assert.equal(shadowCompiles,64,'Enabling shadows after colour preparation fills the separate 128-material budget with ready bases and variants, without starving it on unused bases');
   else assert.equal(shadowCompiles,0,'Dormant shadow passes must allocate and compile no environment variants');
   for(const mesh of nodes){assert.notEqual(mesh.material,original);if(!shadowsEnabled||!mesh.castShadow){assert.equal(mesh.customDepthMaterial,mesh.castShadow?undefined:borrowedDepth);assert.equal(mesh.customDistanceMaterial,undefined);}}
  }finally{environment.dispose();for(let work=0;queue.pending&&work<8;work++){queue.step();await settle();}await queue.whenIdle();queue.dispose();borrowedDepth.dispose();geometry.dispose();original.dispose();}
 }
});


test('quality changes retain valid wind while weather compiles, then reuse Low without a paused-clock stall',async()=>{
 const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera();scene.add(sourceRoot,atmosphere,sun);
 const geometry=new BoxGeometry(),original=new MeshStandardMaterial({name:'foliage'}),mesh=new Mesh(geometry,original);sourceRoot.add(mesh);
 mesh.userData.crownfallVegetationWind={root:[0,-.5,0],tip:[0,.5,0],grass:false};
 const queue=createWorldPreparationQueue(()=>{});let quality:'low'|'medium'|'high'='low';
 const shaders:{vertexShader:string;fragmentShader:string;uniforms:Record<string,{value:unknown}>}[]=[];
 const renderer={debug:{onShaderError:undefined},shadowMap:{enabled:false},async compileAsync(preview:Mesh){
  const shader={uniforms:{},vertexShader:'#include <common>\n#include <defaultnormal_vertex>\n#include <begin_vertex>\n#include <morphtarget_vertex>\n#include <worldpos_vertex>',fragmentShader:'#include <common>\n#include <normal_fragment_maps>\n#include <roughnessmap_fragment>\n#include <lights_fragment_end>'};
  const material=preview.material as MeshStandardMaterial;material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0],this as unknown as WebGLRenderer);shaders.push(shader);
 }} as unknown as WebGLRenderer;
 const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,queue,renderer,signal:new AbortController().signal,
  quality:()=>quality,reducedMotion:()=>false,readClock:()=>({time:{absoluteWorldMinute:720,fractionalMinute:0,dayIndex:0,dayMinute:720,elapsedWorldMinutes:720,deferredMilliseconds:0},worldKey:'wind-quality',animationSeconds:1200}),changed(){},setSunDirection(){}});
 const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
 try{
  environment.update(0);queue.step();await queue.whenIdle();await settle();environment.update(1);
  const low=mesh.material;assert.notEqual(low,original);assert.equal(shaders.length,1);assert.doesNotMatch(shaders[0].fragmentShader,/CROWNFALL_WORLD_ENVIRONMENT/);
  quality='medium';environment.update(2);assert.equal(mesh.material,low,'Keep the valid wind-only program during asynchronous weather preparation');
  assert.equal(environment.stats.activeWindMaterialSlots,1);assert.equal(environment.stats.activeWindReadyMaterialSlots,1,'A valid assigned wind variant remains ready while weather prepares');
  queue.step();await queue.whenIdle();await settle();environment.update(3);
  const medium=mesh.material;assert.notEqual(medium,low);assert.equal(shaders.length,2);assert.match(shaders[1].fragmentShader,/CROWNFALL_WORLD_ENVIRONMENT/);
  assert.equal(shaders[1].uniforms.cfSurfaceWeatherEnabled.value,1,'Quality changes update surface uniforms even while the authoritative clock is paused');
  quality='low';environment.update(4);assert.equal(mesh.material,low);assert.equal(shaders.length,2,'Returning to a prepared Low variant must not recompile it');
  assert.equal(environment.animationSeconds,1200);assert.equal(shaders[0].uniforms.cfSurfaceWeatherEnabled.value,0);
 }finally{environment.dispose();await queue.whenIdle();queue.dispose();geometry.dispose();original.dispose();}
});


test('plant-looking material names never animate terrain, rocks or water without verified vegetation ownership',async()=>{
 for(const quality of ['low','medium'] as const){
  const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera();scene.add(sourceRoot,atmosphere,sun);
  const geometry=new BoxGeometry(2,3,2),ground=new MeshStandardMaterial({name:'grass'}),plantMaterial=new MeshStandardMaterial({name:'Unlabelled PBR'});
  const rigid:Mesh[]=[];
  for(const kind of [undefined,'terrain','rock','water','debris']){
   const mesh=new Mesh(geometry,ground);if(kind)mesh.userData.crownfallElderbloom={kind};
   // Explicit non-plant semantics override an accidentally copied plant grant.
   if(kind)mesh.userData.crownfallVegetationWind={root:[0,-1.5,0],tip:[0,1.5,0],grass:true};
   sourceRoot.add(mesh);rigid.push(mesh);
  }
  const plant=new Mesh(geometry,plantMaterial);plant.userData.crownfallVegetationWind={root:[0,-1.5,0],tip:[0,1.5,0],grass:true};sourceRoot.add(plant);
  const positions=Array.from(geometry.getAttribute('position').array),queue=createWorldPreparationQueue(()=>{});
  const renderer={debug:{onShaderError:undefined},shadowMap:{enabled:false},async compileAsync(preview:Mesh){
   const shader={uniforms:{},vertexShader:'#include <common>\n#include <defaultnormal_vertex>\n#include <begin_vertex>\n#include <morphtarget_vertex>\n#include <worldpos_vertex>',fragmentShader:'#include <common>\n#include <normal_fragment_maps>\n#include <roughnessmap_fragment>\n#include <lights_fragment_end>'};
   const material=preview.material as MeshStandardMaterial;material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0],this as unknown as WebGLRenderer);
   assert.equal(shader.vertexShader.includes('CROWNFALL_VEGETATION_WIND'),Boolean(preview.userData.crownfallVegetationWind&&!preview.userData.crownfallElderbloom),'Only the verified plant may deform');
  }} as unknown as WebGLRenderer;
  const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,queue,renderer,signal:new AbortController().signal,
   quality:()=>quality,reducedMotion:()=>false,readClock:()=>({time:{absoluteWorldMinute:720,fractionalMinute:0,dayIndex:0,dayMinute:720,elapsedWorldMinutes:720,deferredMilliseconds:0},worldKey:'rigid-ground',animationSeconds:1200}),changed(){},setSunDirection(){}});
  const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
  try{
   for(let scan=0;scan<12;scan++){environment.update(scan*6000);for(let work=0;queue.pending&&work<8;work++){queue.step();await settle();}}
   assert.equal(environment.stats.windProgramsReady,1);assert.equal(environment.stats.surfaceWeatherError,'');assert.equal(environment.stats.activeWindMaterialSlots,1);assert.equal(environment.stats.activeWindReadyMaterialSlots,1);
   for(const mesh of rigid){assert.equal((mesh.material as MeshStandardMaterial).userData.crownfallWindBinding,undefined);if(quality==='low')assert.equal(mesh.material,ground);}
   assert.deepEqual(Array.from(geometry.getAttribute('position').array),positions,'Wind ownership never mutates source geometry or collision data');
  }finally{environment.dispose();await queue.whenIdle();queue.dispose();geometry.dispose();ground.dispose();plantMaterial.dispose();}
 }
});


test('fence-time preparation prioritizes live plant draws and progresses without reading clocks or rendering the world',async()=>{
 const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera();scene.add(sourceRoot,atmosphere,sun);
 const geometry=new BoxGeometry(),zeroGeometry=new BoxGeometry(),original=new MeshStandardMaterial(),hidden=new Group();hidden.visible=false;sourceRoot.add(hidden);
 const bind=(mesh:Mesh,name:string,height:number)=>{mesh.name=name;mesh.userData.crownfallVegetationWind={root:[0,0,0],tip:[0,height,0],grass:true};return mesh;};
 for(let i=0;i<20;i++)hidden.add(bind(new Mesh(geometry,original),'future-cell-'+i,2+i*.1));
 const zeroCount=bind(new InstancedMesh(geometry,original,1),'zero-count-source',5);(zeroCount as InstancedMesh).count=0;sourceRoot.add(zeroCount);
 zeroGeometry.setDrawRange(0,0);sourceRoot.add(bind(new Mesh(zeroGeometry,original),'inactive-lod-source',6));
 const wood=new Mesh(geometry,original);wood.name='static-wood';sourceRoot.add(wood,bind(new SkinnedMesh(geometry,original),'skinned-resident-with-stray-grant',8));
 const liveA=bind(new Mesh(geometry,original),'visible-current-a',1),liveB=bind(new Mesh(geometry,original),'visible-current-b',1.1);sourceRoot.add(liveA,liveB);
 const queue=createWorldPreparationQueue(()=>{}),compiled:string[]=[];let forbidClock=false,clockReads=0,sunUpdates=0;
 const renderer={debug:{onShaderError:undefined},shadowMap:{enabled:false},render(){throw Error('Preparation must not submit the world');},async compileAsync(preview:Mesh){compiled.push(preview.name);}} as unknown as WebGLRenderer;
 const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,queue,renderer,signal:new AbortController().signal,
  quality:()=> 'low',reducedMotion:()=>false,readClock:()=>{clockReads++;if(forbidClock)throw Error('Preparation must not read the world clock');return {time:{absoluteWorldMinute:720,fractionalMinute:0,dayIndex:0,dayMinute:720,elapsedWorldMinutes:720,deferredMilliseconds:0},worldKey:'fenced-preparation',animationSeconds:1200};},changed(){},setSunDirection(){sunUpdates++;}});
 const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
 const service=async()=>{for(let work=0;queue.pending&&work<8;work++){assert.ok(environment.stats.materialProgramsPending<=2);queue.step();await settle();}};
 try{
  assert.equal(environment.prepare(0),true);assert.equal(clockReads,0,'Material prewarming cannot read or invent an unconfirmed world clock');assert.equal(environment.state,null);
  environment.update(0);await service();assert.deepEqual(compiled,['visible-current-a','visible-current-b'],'Hidden cells and inactive LODs precede these in the scene, but cannot consume their preparation slots');
  assert.equal(environment.stats.activeWindMaterialSlots,2);assert.equal(environment.stats.activeWindReadyMaterialSlots,0,'Compiled previews do not count until their materials are assigned to live draws');
  const state=environment.state;forbidClock=true;
  environment.prepare(16);assert.equal(environment.stats.activeWindMaterialSlots,2);assert.equal(environment.stats.activeWindReadyMaterialSlots,0,'Private previews cannot claim published wind coverage.');assert.equal(liveA.material,original);assert.equal(liveB.material,original);assert.equal(environment.stats.materialProgramsPending,2,'Bounded colour preparation continues while the original active PBR remains valid');await service();
  for(let step=2;step<16;step++){environment.prepare(step*16);await service();}
  assert.equal(environment.stats.activeWindMaterialSlots,2);assert.equal(environment.stats.activeWindReadyMaterialSlots,2,'Background preparation must not inflate active coverage');
  assert.ok(compiled.length>2,'Background variants continue preparing without another expensive world update/render');
  assert.notEqual(liveA.material,original);assert.notEqual(liveB.material,original);assert.equal(clockReads,1);assert.equal(sunUpdates,1);assert.equal(environment.state,state);assert.equal(environment.animationSeconds,1200);
  assert.equal(environment.stats.materialProgramsPending,0);assert.equal(environment.stats.colourBudgetHeld,false);
 }finally{environment.dispose();await service();await queue.whenIdle();queue.dispose();geometry.dispose();zeroGeometry.dispose();original.dispose();(zeroCount as InstancedMesh).dispose();}
});

test('shared HLOD materials do not allocate colour variants for tiny actor-frame binding noise',async()=>{
 const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera();scene.add(sourceRoot,atmosphere,sun);
 const geometry=new BoxGeometry(),original=new MeshStandardMaterial();let compiles=0;
 for(let i=0;i<100;i++){const mesh=new Mesh(geometry,original),noise=i*1e-14;mesh.userData.crownfallVegetationWind={root:[noise,.176+noise,-noise],tip:[noise,8.176-noise,-noise],grass:false};sourceRoot.add(mesh);}
 const queue=createWorldPreparationQueue(()=>{}),renderer={debug:{onShaderError:undefined},shadowMap:{enabled:false},async compileAsync(){compiles++;}} as unknown as WebGLRenderer;
 const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,queue,renderer,signal:new AbortController().signal,
  quality:()=> 'low',reducedMotion:()=>false,readClock:()=>({time:{absoluteWorldMinute:720,fractionalMinute:0,dayIndex:0,dayMinute:720,elapsedWorldMinutes:720,deferredMilliseconds:0},worldKey:'shared-hlod-noise',animationSeconds:1200}),changed(){},setSunDirection(){}});
 try{
  environment.update(0);queue.step();await queue.whenIdle();await new Promise<void>(resolve=>setImmediate(resolve));environment.prepare(16);
  assert.equal(compiles,1);assert.equal(environment.stats.ownedColourMaterials,1);assert.equal(environment.stats.windProgramsReady,1);assert.equal(environment.stats.colourBudgetHeld,false);
  assert.equal(new Set(sourceRoot.children.filter(mesh=>mesh instanceof Mesh).map(mesh=>(mesh as Mesh).material)).size,1);
 }finally{environment.dispose();await queue.whenIdle();queue.dispose();geometry.dispose();original.dispose();}
});


test('loading prewarms live shader variants before any clock state, ahead of ordinary preparation, with live uniform references',async()=>{
 const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera();scene.add(sourceRoot,atmosphere,sun);
 const geometry=new BoxGeometry(),map=new Texture(),original=new MeshStandardMaterial({map}),sourceUniform={value:13};
 original.onBeforeCompile=shader=>{shader.uniforms.authoredPbrUniform=sourceUniform;};
 for(let i=0;i<2;i++){const mesh=new Mesh(geometry,original);mesh.name='loading-plant-'+i;mesh.userData.crownfallVegetationWind={root:[0,-.5,0],tip:[0,.5+i*.1,0],grass:false};sourceRoot.add(mesh);}
 const queue=createWorldPreparationQueue(()=>{}),order:string[]=[],shaders:Record<string,{value:unknown}>[]=[];let clockReads=0;
 const signal=new AbortController().signal;
 const ordinary=queue.enqueue({bytes:0,signal,priority:()=>80,work:()=>{order.push('ordinary');}}),critical=queue.enqueue({bytes:0,signal,priority:()=>30,work:()=>{order.push('critical');}});
 const renderer={debug:{onShaderError:undefined},shadowMap:{enabled:false},render(){throw Error('Loading prewarm must never render the world');},async compileAsync(preview:Mesh){
  order.push(preview.name);
  const shader={uniforms:{} as Record<string,{value:unknown}>,vertexShader:'#include <common>\n#include <defaultnormal_vertex>\n#include <begin_vertex>\n#include <morphtarget_vertex>\n#include <worldpos_vertex>',fragmentShader:'#include <common>\n#include <normal_fragment_maps>\n#include <roughnessmap_fragment>\n#include <lights_fragment_end>'};
  const material=preview.material as MeshStandardMaterial;assert.equal(material.map,map);material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0],this as unknown as WebGLRenderer);shaders.push(shader.uniforms);
 }} as unknown as WebGLRenderer;
 const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,queue,renderer,signal,
  quality:()=> 'medium',reducedMotion:()=>false,readClock(){clockReads++;throw Error('No village clock exists during asset loading');},changed(){},statusChanged(){throw Error('Loading preparation cannot publish a world time');},setSunDirection(){throw Error('Loading preparation cannot move the sun');}});
 const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
 const service=async()=>{for(let work=0;queue.pending&&work<12;work++){assert.ok(environment.stats.materialProgramsPending<=2);queue.step();await settle();}};
 try{
  assert.equal(environment.prepare(0),true);assert.equal(environment.state,null);assert.equal(environment.animationSeconds,0);await service();await Promise.all([ordinary,critical]);
  assert.deepEqual(order,['critical','loading-plant-0','loading-plant-1','ordinary']);
  environment.prepare(16);assert.equal(clockReads,0);assert.equal(environment.state,null);assert.equal(environment.animationSeconds,0);assert.equal(environment.stats.activeWindReadyMaterialSlots,2);
  assert.equal(shaders.length,2);assert.equal(shaders[0].cfEnvironmentSeconds,shaders[1].cfEnvironmentSeconds);assert.equal(shaders[0].cfEnvironmentToSource,shaders[1].cfEnvironmentToSource);
  for(const uniforms of shaders){assert.equal(uniforms.authoredPbrUniform,sourceUniform);assert.equal(uniforms.authoredPbrUniform.value,13);assert.equal(uniforms.cfEnvironmentSeconds.value,0);assert.equal(uniforms.cfSurfaceWeatherEnabled.value,0,'Weather stays inactive until a real clock sample arrives');}
  for(const mesh of sourceRoot.children.filter(node=>node instanceof Mesh)){assert.equal((mesh as Mesh).geometry,geometry);assert.equal(((mesh as Mesh).material as MeshStandardMaterial).map,map);}
 }finally{environment.dispose();await service();await queue.whenIdle();queue.dispose();geometry.dispose();map.dispose();original.dispose();}
});


test('a forced final-graph scan discovers a published material at unchanged time without reading the clock',async()=>{
 const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera();scene.add(sourceRoot,atmosphere,sun);
 const geometry=new BoxGeometry(),original=new MeshStandardMaterial(),publishedMap=new Texture(),published=new MeshStandardMaterial({map:publishedMap,roughness:.42}),mesh=new Mesh(geometry,original);sourceRoot.add(mesh);
 mesh.userData.crownfallVegetationWind={root:[0,-.5,0],tip:[0,.5,0],grass:false};
 const queue=createWorldPreparationQueue(()=>{});let clockReads=0,compiles=0;
 const renderer={debug:{onShaderError:undefined},shadowMap:{enabled:false},render(){throw Error('Final-graph preparation must not render');},async compileAsync(){compiles++;}} as unknown as WebGLRenderer;
 const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,queue,renderer,signal:new AbortController().signal,
  quality:()=> 'low',reducedMotion:()=>false,readClock(){clockReads++;throw Error('Final-graph preparation must not read a clock');},changed(){},setSunDirection(){throw Error('Final-graph preparation must not relight');}});
 const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
 const service=async()=>{for(let work=0;queue.pending&&work<8;work++){assert.ok(environment.stats.materialProgramsPending<=2);queue.step();await settle();}};
 try{
  environment.prepare(0);await service();environment.prepare(10);assert.equal(compiles,1);assert.notEqual(mesh.material,original);
  mesh.material=published;assert.equal(environment.prepare(10),false,'Normal background scans retain their throttle');assert.equal(queue.pending,false);assert.equal(mesh.material,published);
  assert.equal(environment.prepare(10,true),true,'Source owners can request one final-graph scan without inventing elapsed time');assert.equal(environment.stats.materialProgramsPending,1);assert.equal(mesh.material,published,'The newly published PBR remains valid while its wind variant prepares');
  await service();environment.prepare(10);assert.equal(compiles,2);assert.notEqual(mesh.material,published);assert.equal(mesh.material.map,publishedMap);assert.equal(mesh.material.roughness,.42);
  assert.equal(environment.stats.activeWindMaterialSlots,1);assert.equal(environment.stats.activeWindReadyMaterialSlots,1);assert.equal(environment.stats.materialProgramsPending,0);
  assert.equal(clockReads,0);assert.equal(environment.state,null);assert.equal(environment.animationSeconds,0);assert.equal(mesh.geometry,geometry);
 }finally{environment.dispose();await service();await queue.whenIdle();queue.dispose();geometry.dispose();publishedMap.dispose();original.dispose();published.dispose();}
});

test('versioned RG8 publication updates frozen-clock sunlight once and live weather never rebakes the field',async context=>{

 // Keep the real SHA-256 bytes but remove unrelated libuv/WebCrypto completion
 // timing from this bounded worker/upload lifecycle regression.
 context.mock.method(crypto.subtle,'digest',async(algorithm:Parameters<typeof crypto.subtle.digest>[0],input:Parameters<typeof crypto.subtle.digest>[1])=>{
  assert.equal(typeof algorithm==='string'?algorithm:algorithm.name,'SHA-256');
  const bytes=ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):new Uint8Array(input);
  return Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer;
 });
 const previous=Object.getOwnPropertyDescriptor(globalThis,'Worker');let bakes=0,uploads=0;
 class DensityWorker{
  onmessage:((event:{data:{data:Uint8Array;backend:string}})=>void)|null=null;
  postMessage({width,height}:{width:number;height:number}){bakes++;const data=new Uint8Array(width*height*width*2);for(let z=0;z<width;z++)for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=((z*height+y)*width+x)*2;data[at]=y===Math.floor(height/2)?255:0;data[at+1]=Math.round(x/(width-1)*255);}queueMicrotask(()=>this.onmessage?.({data:{data,backend:'test-rg8'}}));}
  terminate(){}
 }
 Object.defineProperty(globalThis,'Worker',{configurable:true,value:DensityWorker});
 const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera();scene.add(sourceRoot,atmosphere,sun);
 const queue=createWorldPreparationQueue(()=>{});let seconds=10,coverage=0;
 const renderer={initTexture(){uploads++;}} as unknown as WebGLRenderer;
 const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,queue,renderer,signal:new AbortController().signal,
  quality:()=> 'medium',reducedMotion:()=>false,readClock:()=>({time:{absoluteWorldMinute:720,fractionalMinute:0,dayIndex:0,dayMinute:720,elapsedWorldMinutes:720,deferredMilliseconds:0},worldKey:'cloud-publication',animationSeconds:seconds}),override:()=>({cloudCoverage:coverage}),changed(){},setSunDirection(){}});
 const fallback=environment.cloudField.texture;
 try{
  assert.equal(environment.cloudField.enabled,false);environment.update(0);
  for(let i=0;i<64&&environment.stats.status!=='ready';i++){queue.step();await new Promise<void>(resolve=>setImmediate(resolve));}
  assert.equal(environment.stats.status,'ready','Unavailable IndexedDB must not prevent a usable GPU field.');assert.equal(bakes,1);assert.equal(uploads,1);
  const field=environment.cloudField;assert.notEqual(field.texture,fallback);assert.equal(field.enabled,true);assert.match(field.revision,/rg8-v3/);
  let disposals=0;field.texture.addEventListener('dispose',()=>disposals++);
  for(const next of [0,.22,.5,.91,1]){
   coverage=next;seconds+=60;environment.update(100+next*100);assert.equal(environment.cloudField.texture,field.texture);
   assert.equal(environment.cloudField.coverage,next);assert.equal(sun.intensity,environment.state!.sunIntensity,'Unprepared materials retain the global weather baseline; ready PBR/GI replaces it with a relative local factor.');assert.equal(environment.cloudField.globalTransmission,environment.state!.cloudTransmission);
  }
  assert.equal(bakes,1);assert.equal(uploads,1);assert.equal(environment.stats.cloudDensityBuilds,1);assert.equal(environment.stats.cache.writes,0);
  assert.equal(disposals,0);environment.dispose();await queue.whenIdle();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(disposals,1);
 }finally{environment.dispose();await queue.whenIdle();queue.dispose();if(previous)Object.defineProperty(globalThis,'Worker',previous);else Reflect.deleteProperty(globalThis,'Worker');}
});

test('cloud eye, sun and rays use world coordinates while the borrowed GI descriptor preserves source placement',async()=>{
 const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),sunFrame=new Group(),camera=new PerspectiveCamera();
 sourceRoot.position.set(300,40,-700);sourceRoot.rotation.y=.7;sourceRoot.scale.set(2,3,.5);
 sunFrame.rotation.y=.4;sunFrame.add(sun,sun.target);scene.add(sourceRoot,atmosphere,sunFrame,camera);camera.position.set(120,25,340);
 const geometry=new BoxGeometry(),sky=new ShaderMaterial({vertexShader:'varying vec3 vEaldholtCloudDirection;void main(){vEaldholtCloudDirection=normalize(position);gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'void main(){gl_FragColor=vec4(1.);}' });atmosphere.add(new Mesh(geometry,sky));
 const queue=createWorldPreparationQueue(()=>{}),environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,queue,renderer:{} as WebGLRenderer,signal:new AbortController().signal,
 quality:()=> 'low',reducedMotion:()=>true,readClock:()=>({time:{absoluteWorldMinute:720,fractionalMinute:0,dayIndex:0,dayMinute:720,elapsedWorldMinutes:720,deferredMilliseconds:0},worldKey:'nonidentity-cloud-frame',animationSeconds:0}),changed(){},setSunDirection(direction){sun.position.copy(sun.target.position).addScaledVector(direction,100);}});
 try{
  environment.update(0);const field=environment.cloudField,expectedSun=sun.getWorldPosition(new Vector3()).sub(sun.target.getWorldPosition(new Vector3())).normalize();
  assert.deepEqual((sky.uniforms.cfCloudEye.value as Vector3).toArray(),camera.getWorldPosition(new Vector3()).toArray(),'Cloud eye must not accidentally be transformed into authored GLB coordinates.');
  assert.deepEqual(field.sourceToWorld,sourceRoot.matrixWorld.elements);assert.deepEqual(field.sunDirection,expectedSun.toArray());
  assert.deepEqual((sky.uniforms.cfCloudSourceToWorld.value as {elements:number[]}).elements,field.sourceToWorld);
  assert.match(sky.vertexShader,/cfCloudWorldRay=\(modelMatrix\*vec4\(position,1\.\)\)\.xyz-cameraPosition/);
  assert.match(sky.fragmentShader,/cfSky\(normalize\(cfCloudWorldRay\)\)/);
  sourceRoot.position.x+=123;sourceRoot.updateWorldMatrix(true,false);assert.notDeepEqual(field.sourceToWorld,sourceRoot.matrixWorld.elements,'A retained descriptor must not observe a later root transform during asynchronous GI preparation.');assert.equal(field.sourceToWorld[12],300);
 }finally{environment.dispose();await queue.whenIdle();queue.dispose();geometry.dispose();sky.dispose();}
});

test('ready cloud density retains the weather baseline on pending and failed PBR materials, then Low fallback',{timeout:15_000},async context=>{

 // Keep the real SHA-256 bytes but remove unrelated libuv/WebCrypto completion
 // timing from this bounded worker/upload lifecycle regression.
 context.mock.method(crypto.subtle,'digest',async(algorithm:Parameters<typeof crypto.subtle.digest>[0],input:Parameters<typeof crypto.subtle.digest>[1])=>{
  assert.equal(typeof algorithm==='string'?algorithm:algorithm.name,'SHA-256');
  const bytes=ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):new Uint8Array(input);
  return Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer;
 });
 const previous=Object.getOwnPropertyDescriptor(globalThis,'Worker');let bakes=0,entered=false,rejectWeather:((cause:Error)=>void)|undefined,coverage=.91;
 class DensityWorker{
  onmessage:((event:{data:{data:Uint8Array}})=>void)|null=null;
  postMessage({width,height}:{width:number;height:number}){bakes++;const data=new Uint8Array(width*height*width*2);for(let z=0;z<width;z++)for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=((z*height+y)*width+x)*2;data[at]=y===Math.floor(height/2)?255:0;data[at+1]=Math.round(x/(width-1)*255);}queueMicrotask(()=>this.onmessage?.({data:{data}}));}
  terminate(){}
 }
 Object.defineProperty(globalThis,'Worker',{configurable:true,value:DensityWorker});
 const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),camera=new PerspectiveCamera(),geometry=new BoxGeometry(),original=new MeshStandardMaterial(),mesh=new Mesh(geometry,original);mesh.visible=false;sourceRoot.add(mesh);scene.add(sourceRoot,atmosphere,sun);
 // One job per step (no CPU budget past the first): this test checks the environment's own order, step by step;
 // the queue's batching of synchronous jobs (L-10) is covered by world-preparation-queue.test.ts.
 const queue=createWorldPreparationQueue(()=>{},64,1024*1024,0);let quality:'low'|'medium'='medium';
 const renderer={debug:{onShaderError:undefined},shadowMap:{enabled:false},initTexture(){},compileAsync(){entered=true;return new Promise<void>((_resolve,reject)=>{rejectWeather=reject;});}} as unknown as WebGLRenderer;
 const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,camera,queue,renderer,signal:new AbortController().signal,
  quality:()=>quality,reducedMotion:()=>false,readClock:()=>({time:{absoluteWorldMinute:720,fractionalMinute:0,dayIndex:0,dayMinute:720,elapsedWorldMinutes:720,deferredMilliseconds:0},worldKey:'cloud-material-fallback',animationSeconds:10}),override:()=>({cloudCoverage:coverage}),changed(){},setSunDirection(){}});
 const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
 try{
  environment.update(0);
  for(let i=0;i<64&&bakes===0;i++)await settle();assert.equal(bakes,1);await settle();
  for(let i=0;i<64&&!environment.cloudField.enabled;i++){queue.step();await settle();}
  assert.equal(environment.cloudField.enabled,true);mesh.visible=true;environment.update(1);assert.equal(entered,false,'Density upload precedes an ordinary weather-program compile.');
  assert.equal(mesh.material,original);assert.equal(sun.intensity,environment.state!.sunIntensity);assert.ok(sun.intensity<2.6);assert.equal(environment.stats.materialProgramsPending,1);
  queue.step();await settle();assert.equal(entered,true);assert.equal(mesh.material,original);assert.equal(sun.intensity,environment.state!.sunIntensity,'A pending shader may not remove fallback dimming.');
  rejectWeather!(Error('weather shader unsupported'));await queue.whenIdle();await settle();environment.update(6000);
  assert.equal(environment.stats.surfaceWeather,'fallback-shader');assert.equal(mesh.material,original);
  for(const next of [0,1,.91]){coverage=next;environment.update(7000+next);assert.equal(sun.intensity,environment.state!.sunIntensity,'A failed shader keeps the global baseline even with ready cloud data.');assert.equal(environment.cloudField.globalTransmission,environment.state!.cloudTransmission);}
  quality='low';environment.update(9000);assert.equal(environment.cloudField.enabled,false);assert.equal(mesh.material,original);assert.equal(sun.intensity,environment.state!.sunIntensity);assert.equal(bakes,1);
 }finally{rejectWeather?.(Error('test teardown'));environment.dispose();queue.dispose();await queue.whenIdle();geometry.dispose();original.dispose();if(previous)Object.defineProperty(globalThis,'Worker',previous);else Reflect.deleteProperty(globalThis,'Worker');}
});

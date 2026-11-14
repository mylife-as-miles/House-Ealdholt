import{test}from'node:test';import assert from'node:assert/strict';
import{PerspectiveCamera,Scene,type WebGLRenderer}from'three';
import{createNaturalRiparianPlants}from'./natural-riparian-plants';import{prepareNaturalRiparianAsset,type NaturalRiparianPreparedSource}from'./natural-riparian-source';import{naturalRiparianTestFixture,naturalRiparianRendererFixture}from'./natural-riparian-test-fixture';
import{createWorldPreparationQueue}from'../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function pump(owner:ReturnType<typeof createNaturalRiparianPlants>,queue:ReturnType<typeof createWorldPreparationQueue>){const deadline=performance.now()+2500;while(performance.now()<deadline){queue.step();await new Promise(resolve=>setTimeout(resolve,1));if(['loading','preparing'].includes(owner.stats.status))assert.equal(owner.object.children.length,0,'No partial material reaches the world environment owner.');if(['ready','fallback','disposed'].includes(owner.stats.status)&&!queue.pending)return;}throw Error('Bounded CPU source preparation did not settle.');}
for(const native of[false,true])test((native?'Native':'Desktop')+' real source upload queue publishes atomically and keeps all submitted geometry/maps alive through the unresolved fence',async()=>{
 const f=await naturalRiparianTestFixture(native),queue=createWorldPreparationQueue(()=>{}),gpu=naturalRiparianRendererFixture(),uploaded=gpu.uploads;let finish!:()=>void,fences=0,ownDisposals=0,originalDisposals=0;
 const fence=new Promise<void>(resolve=>finish=resolve),renderer=gpu.renderer;
 for(const m of f.root.children){m.addEventListener('removed',()=>originalDisposals++);}
 const prepare:typeof prepareNaturalRiparianAsset=async(...args)=>{const source=await prepareNaturalRiparianAsset(...args);for(const p of source.plants)for(const resource of[p.geometry,p.material,p.map])resource.addEventListener('dispose',()=>ownDisposals++);return source;};
 const owner=createNaturalRiparianPlants({renderer,scene:new Scene(),camera:new PerspectiveCamera(),queue,signal:new AbortController().signal,native,load:async()=>f.asset,changed(){},retirementFence:()=>{fences++;return fence;}},prepare);
 try{assert.equal(Boolean(owner.source),false);await pump(owner,queue);assert.equal(owner.stats.status,'ready');assert.equal(uploaded.length,6);assert.equal(owner.meshes.length,2);assert.ok(owner.meshes.every(m=>m.count===0&&!m.visible));assert.equal(owner.source?.plants.length,2);
  owner.dispose();owner.dispose();await turn();assert.equal(fences,1);assert.equal(ownDisposals,0);assert.equal(originalDisposals,0);assert.equal(Boolean(owner.source),false);assert.equal(owner.stats.retiring,true);
  finish();await owner.whenRetired();assert.equal(ownDisposals,6);assert.equal(owner.meshes.length,0);assert.equal(owner.stats.retired,true);assert.equal(originalDisposals,0);
 }finally{owner.dispose();finish();await owner.whenRetired();queue.dispose();f.dispose();}
});
test('partial upload failure keeps fallback and retires submitted wrappers once; a rejected unsubmitted source does not wait on a GPU fence',async()=>{
 for(const submitted of[false,true]){const f=await naturalRiparianTestFixture(),queue=createWorldPreparationQueue(()=>{},64,submitted?1024**2:64);let calls=0,fences=0,finished!:()=>void,disposed=0;const fence=new Promise<void>(resolve=>finished=resolve);
  const prepare:typeof prepareNaturalRiparianAsset=async(...args)=>{const source=await prepareNaturalRiparianAsset(...args);source.plants[0].geometry.addEventListener('dispose',()=>disposed++);return source;};
  const renderer=naturalRiparianRendererFixture({failUploadAt:2}).renderer;
  const owner=createNaturalRiparianPlants({renderer,scene:new Scene(),camera:new PerspectiveCamera(),queue,signal:new AbortController().signal,load:async()=>f.asset,changed(){},retirementFence:()=>{fences++;return fence;}},prepare);
  try{await pump(owner,queue);assert.equal(owner.stats.status,'fallback');assert.equal(Boolean(owner.source),false);assert.equal(fences,submitted?1:0);assert.equal(disposed,submitted?0:1);owner.dispose();finished();await owner.whenRetired();assert.equal(disposed,1);assert.equal(fences,submitted?1:0);
  }finally{owner.dispose();finished();await owner.whenRetired();queue.dispose();f.dispose();}
 }
});
test('immediate abort and late original models cannot create source wrappers or upload GPU work',async()=>{
 for(const late of[false,true]){const f=await naturalRiparianTestFixture(),queue=createWorldPreparationQueue(()=>{}),controller=new AbortController();let resolve!:(value:typeof f.asset)=>void,prepared=0,uploads=0,loads=0;
  const deferred=new Promise<typeof f.asset>(done=>resolve=done),gpu=naturalRiparianRendererFixture(),owner=createNaturalRiparianPlants({renderer:gpu.renderer,scene:new Scene(),camera:new PerspectiveCamera(),queue,signal:controller.signal,load(){loads++;return deferred;},changed(){},retirementFence:async()=>{}},async(...args)=>{prepared++;return prepareNaturalRiparianAsset(...args);});
  try{if(late)await turn();controller.abort();resolve(f.asset);await pump(owner,queue);assert.equal(owner.stats.status,'disposed');assert.equal(gpu.uploads.length,0);assert.equal(prepared,late?1:0);assert.equal(loads,late?1:0);assert.equal(owner.meshes.length,0);assert.equal(Boolean(owner.source),false);
  }finally{owner.dispose();queue.dispose();f.dispose();}
 }
});
test('unsupported renderer retains the original grass without fetching or allocating plant source resources',()=>{
 const queue=createWorldPreparationQueue(()=>{});let loads=0;
 const owner=createNaturalRiparianPlants({renderer:{}as WebGLRenderer,scene:new Scene(),camera:new PerspectiveCamera(),queue,signal:new AbortController().signal,load:async()=>{loads++;throw Error('No load expected.');},changed(){}});
 assert.equal(owner.stats.status,'fallback');assert.match(owner.stats.error,/unsupported/);assert.equal(loads,0);assert.equal(owner.meshes.length,0);assert.equal(Boolean(owner.source),false);assert.equal(queue.pending,false);owner.dispose();queue.dispose();
});
test('resolving silent shader errors and latent failed LINK_STATUS retain fallback until submitted resources retire',async()=>{
 for(const silent of[true,false]){const f=await naturalRiparianTestFixture(),gpu=naturalRiparianRendererFixture({silentError:silent,linked:silent}),queue=createWorldPreparationQueue(()=>{});let previousCalls=0,disposed=0,finish!:()=>void;const fence=new Promise<void>(resolve=>finish=resolve),previous=()=>{previousCalls++;};gpu.renderer.debug.onShaderError=previous;
  const prepare:typeof prepareNaturalRiparianAsset=async(...args)=>{const source=await prepareNaturalRiparianAsset(...args);source.plants[0].geometry.addEventListener('dispose',()=>disposed++);return source;};
  const owner=createNaturalRiparianPlants({renderer:gpu.renderer,scene:new Scene(),camera:new PerspectiveCamera(),queue,signal:new AbortController().signal,load:async()=>f.asset,changed(){},retirementFence:()=>fence},prepare);
  try{await pump(owner,queue);assert.equal(owner.stats.status,'fallback');assert.equal(Boolean(owner.source),false);assert.match(owner.stats.error,/source link failure/);assert.equal(owner.object.children.length,0);assert.equal(gpu.renderer.debug.onShaderError,previous);assert.equal(gpu.renderer.debug.checkShaderErrors,false);assert.equal(previousCalls,silent?2:0);if(!silent)assert.ok(gpu.linkQueries>0);assert.equal(disposed,0);owner.dispose();finish();await owner.whenRetired();assert.equal(disposed,1);
  }finally{owner.dispose();finish();await owner.whenRetired();queue.dispose();f.dispose();}
 }
});
test('unrelated shader callbacks chain and restore, while every source program must still prove successful linking',async()=>{
 const f=await naturalRiparianTestFixture(),gpu=naturalRiparianRendererFixture({unrelatedError:true}),queue=createWorldPreparationQueue(()=>{});let calls=0;const previous=()=>{calls++;};gpu.renderer.debug.onShaderError=previous;
 const owner=createNaturalRiparianPlants({renderer:gpu.renderer,scene:new Scene(),camera:new PerspectiveCamera(),queue,signal:new AbortController().signal,load:async()=>f.asset,changed(){},retirementFence:async()=>{}});
 try{await pump(owner,queue);assert.equal(owner.stats.status,'ready');assert.equal(calls,2);assert.equal(gpu.linkQueries,2);assert.equal(gpu.renderer.debug.onShaderError,previous);assert.equal(gpu.renderer.debug.checkShaderErrors,false);}finally{owner.dispose();await owner.whenRetired();queue.dispose();f.dispose();}
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {BoxGeometry,DataTexture,DoubleSide,Group,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,PerspectiveCamera,Scene,type WebGLRenderer} from 'three';
import {createVegetationCellHlod} from './vegetation-cell-hlod';
import {scopeRealisticTreeResources} from './realistic-regional-woodland';
import {createEaldholtTreeHlod} from './vegetation-hlod';
import {createEaldholtWoodlandVisibility} from './woodland-visibility';
import type {VegetationPrototypeResources} from './vegetation-prototype';
import type {VegetationPreparationWorker} from './vegetation-worker';
import {createVegetationResourcePool} from '../../../../shared/legacy/aethelgard/environment/vegetation-resource-pool';
import {createWorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import {acceptVegetationBranchL2,VEGETATION_BRANCH_L2} from '../../../../shared/legacy/aethelgard/environment/vegetation-branch-l2';

test('branch-only L2 requires a bounded error and a real saving over the unchanged L1 derivative',()=>{
 assert.equal(acceptVegetationBranchL2(1000,350,120,.008),true);
 for(const [source,l1,l2,error]of [[1000,350,349,.006],[1000,350,120,.009],[1000,350,0,.006],[1000,350,120,NaN]])assert.equal(acceptVegetationBranchL2(source,l1,l2,error),false);
 assert.ok(VEGETATION_BRANCH_L2.error<.015);
});

for(const kind of ['cell','forest']as const)for(const rejected of ['unavailable','unsaving']as const)for(const scoped of kind==='cell'?[false,true]:[false])test((scoped?'shared-scope ':'')+kind+' '+rejected+' L2 retains complete L1 while branches prepare; a rejected component falls back without losing canopy or borrowed buffers',async()=>{
 const geometry=new BoxGeometry(1,8,1);geometry.clearGroups();const originalIndex=Array.from(geometry.index!.array);geometry.setIndex(Array.from({length:25},()=>originalIndex).flat());const bark=new MeshStandardMaterial({name:'Bark',roughness:.81}),leaf=new MeshStandardMaterial({name:'TwoSided',side:DoubleSide}),decor=new MeshStandardMaterial({name:'Decoration'});
 const root=new Group(),sources=[bark,leaf,decor].map((material,i)=>{const mesh=new InstancedMesh(geometry,material,1);mesh.setMatrixAt(0,new Matrix4().makeTranslation(0,i*.01,-250));root.add(mesh);return mesh;});
 root.userData.crownfallRiverWoodland={wholeTree:true};root.userData.crownfallFoliageDensity={counts:{low:1,medium:1,high:1}};
 const before=sources.map(m=>Array.from(m.instanceMatrix.array)),maps=[new DataTexture(),new DataTexture()]as const,owned:MeshStandardMaterial[]=[],derivatives:BoxGeometry[]=[],captures:number[]=[];
 let finish!:()=>void,requests=0,borrowedDisposed=0,releases=0,branchDisposals=0;
 const branchPool=createVegetationResourcePool<{bytes:number;geometry:BoxGeometry;sourceTriangles:number;triangles:number;error:number;dispose():void}>(1024,8);geometry.addEventListener('dispose',()=>borrowedDisposed++);bark.addEventListener('dispose',()=>borrowedDisposed++);
 const packed=(triangles=3)=>{const g=geometry.clone();g.setIndex(Array.from(geometry.index!.array).slice(0,triangles*3));derivatives.push(g);return{bytes:123,geometry:g,sourceTriangles:300,triangles,error:.006,dispose(){branchDisposals++;g.dispose();}};};
 const resources={stats:{},indices:(_key:string,input:{indices:Uint32Array})=>({ready:Promise.resolve({indices:input.indices.slice(0,27),error:.01}),release(){releases++;}}),
  material:(_key:string,build:()=>MeshStandardMaterial)=>{const material=build();owned.push(material);return{ready:Promise.resolve({material}),release(){releases++;}};},
  geometry:(part:{geometry:BoxGeometry},detail?:string)=>{if(detail==='l2-branches'){const request=++requests;const lease=branchPool.acquire('branch:'+request,123,async()=>{if(request===1){await new Promise<void>(resolve=>{finish=resolve;});return packed();}if(rejected==='unavailable')throw Error('bounded pool full');return packed(9);});return{...lease,releaseUnsubmitted:lease.release};}
   const g=part.geometry.clone();g.setIndex(Array.from(g.index!.array).slice(0,27));derivatives.push(g);return{ready:Promise.resolve({geometry:g,sourceTriangles:300,triangles:9,error:.01}),release(){releases++;}};},
  atlas:(_parts:unknown,_tile:number,views:number)=>{captures.push(views);return{ready:Promise.resolve({bytes:1,maps,record:{views,columns:4,rows:views/4,tileSize:64,centre:[0,0,0],extent:[8,8],mips:[{width:256,height:64*views/4}],coverage:Array(views).fill(.5)}}),release(){releases++;}};},
  compile:()=>({ready:Promise.resolve({}),release(){releases++;}}),dispose(){},trim(){},
 }as unknown as VegetationPrototypeResources;
 const queue=createWorldPreparationQueue(()=>{}),camera=new PerspectiveCamera(60,1,.1,2000);camera.updateMatrixWorld();
 let finishFence!:()=>void;const fence=new Promise<void>(resolve=>{finishFence=resolve;}),scope=scoped?scopeRealisticTreeResources(resources,()=>fence):null,activeResources=scope?.resources??resources;
 const renderer={compileAsync:async()=>{}}as unknown as WebGLRenderer,signal=new AbortController().signal,visibility=kind==='forest'?createEaldholtWoodlandVisibility(root):null;
 const hlod=kind==='cell'?createVegetationCellHlod(root,{resources:activeResources,renderer,scene:new Scene(),camera,signal,changed(){},tileSize:64,retirementFence:scoped?()=>fence:undefined}):createEaldholtTreeHlod(root,visibility!,{resources,renderer,scene:new Scene(),camera,queue,worker:{}as VegetationPreparationWorker,signal,changed(){}});
 const drive=async(check:()=>boolean)=>{for(let tick=0;tick<300&&!check();tick++){if(queue.pending&&!queue.running)queue.step();await new Promise<void>(resolve=>setImmediate(resolve));}assert.equal(check(),true);};
 try{await drive(()=>requests>0);assert.equal(hlod.stats.readyMask,3,'the new branch job cannot publish partial L2');visibility?.update([camera],'medium');hlod.update(0,camera,'medium',true);assert.equal(hlod.stats.levels[1],1);
  finish();let done=false;void hlod.preparation.then(()=>{done=true;});await drive(()=>done);assert.equal(hlod.stats.readyMask,15);assert.equal(hlod.stats.l1BranchTriangles,18);assert.equal(hlod.stats.l2BranchTriangles,12);assert.equal(hlod.stats.l2BranchFallbacks,1);assert.equal(hlod.stats.l2BranchError,.006);assert.equal(hlod.stats.l2BranchSelectedBytes,123);assert.deepEqual(captures,[16,8]);
  branchPool.trim();assert.equal(branchPool.stats.entries,1,'only the accepted ready branch remains leased while the HLOD lives');assert.equal(branchPool.stats.bytes,123);assert.equal(branchDisposals,rejected==='unsaving'?1:0,'a ready candidate with no useful saving must be reclaimable immediately');
  visibility?.update([camera],'medium');hlod.update(1000,camera,'medium',true);assert.equal(hlod.stats.levels[2],1);
  const group=root.getObjectByName(kind==='cell'?'Authored cell source HLOD':'Source-derived tree HLOD')!,draws=group.children.filter(n=>n instanceof Mesh&&(kind==='cell'?n.visible:(n as InstancedMesh).count>0))as Mesh[];
  assert.equal(draws.length,3,'two real wood components and the same-source canopy stay paired');assert.ok(draws.some(m=>m.geometry.index!.count===9));assert.ok(draws.some(m=>m.geometry.index!.count===27));assert.ok(draws.some(m=>m.geometry.index!.count===6));
  assert.deepEqual(sources.map(m=>Array.from(m.instanceMatrix.array)),before);hlod.dispose();await hlod.preparation;await queue.whenIdle();await new Promise<void>(r=>setImmediate(r));assert.equal(borrowedDisposed,0);if(scoped){branchPool.trim();assert.equal(branchPool.stats.entries,1,'the accepted branch was actually compiled and remains leased while the GPU fence is unresolved');assert.equal(releases,0);scope!.resources.dispose();finishFence();await scope!.disposed;}else assert.ok(releases>0);branchPool.trim();assert.equal(branchPool.stats.entries,0);assert.equal(branchDisposals,rejected==='unsaving'?2:1,'later owner retirement must not double release the rejected lease');assert.ok(derivatives.every(g=>g.hasAttribute('position')&&g.index),'a draw wrapper must not delete borrowed derivative bindings');
 }finally{finishFence();hlod.dispose();scope?.resources.dispose();if(scope)await scope.disposed;visibility?.dispose();queue.dispose();branchPool.dispose();for(const m of sources)m.dispose();for(const g of derivatives)g.dispose();for(const m of owned)m.dispose();for(const m of maps)m.dispose();geometry.dispose();bark.dispose();leaf.dispose();decor.dispose();}
});

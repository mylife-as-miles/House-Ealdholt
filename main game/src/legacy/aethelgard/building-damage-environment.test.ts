import test from'node:test';import assert from'node:assert/strict';
import{BoxGeometry,DirectionalLight,Group,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,PerspectiveCamera,Scene,ShaderLib,type WebGLRenderer}from'three';
import{createBuildingDamageVisuals}from'./building-damage';import{createWorldEnvironment}from'./world-environment';
import{createWorldPreparationQueue}from'../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
const tick=()=>new Promise<void>(r=>setImmediate(r));

test('real environment weather publication keeps damage bindings live, then restores them before fenced disposal',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'Worker');Object.defineProperty(globalThis,'Worker',{value:undefined,configurable:true,writable:true});
 const root=new Group(),scene=new Scene(),atmosphere=new Group(),sun=new DirectionalLight(),camera=new PerspectiveCamera(),geometry=new BoxGeometry(4,2,.2),roofGeometry=new BoxGeometry(4.4,.4,3.4),sourceMaterial=new MeshStandardMaterial({envMapIntensity:1.7}),nodes:InstancedMesh[]=[];
 for(const[name,g,y,z]of[['S_Medieval_Modular_Door_fixture',geometry,1,0],['S_Medieval_Modular_Wall_fixture',geometry,1,3],['Wall_400x200_cell_fixture',roofGeometry,2.2,1.5]]as const){const mesh=new InstancedMesh(g,sourceMaterial,1);mesh.name=name;mesh.setMatrixAt(0,new Matrix4().makeTranslation(0,y,z));root.add(mesh);nodes.push(mesh);}
 scene.add(root,atmosphere,sun);let borrowedDisposals=0,compiles=0,fenceCalls=0;
 for(const item of[geometry,roofGeometry,sourceMaterial])item.addEventListener('dispose',()=>borrowedDisposals++);
 const queue=createWorldPreparationQueue(()=>{},64),damage=createBuildingDamageVisuals({sourceRoot:root,sourceSha256:'3'.repeat(64),profile:'desktop',retirementFence:async()=>{await queue.whenIdle();fenceCalls++;}}),damageMaterials=nodes.map(n=>n.material);
 const renderer={debug:{onShaderError:undefined},shadowMap:{enabled:false},async compileAsync(){compiles++;},render(){throw Error('CPU integration test must not draw.');}}as unknown as WebGLRenderer;
 const environment=createWorldEnvironment({sourceRoot:root,atmosphere,scene,sun,camera,renderer,queue,signal:new AbortController().signal,native:false,quality:()=> 'high',reducedMotion:()=>true,readClock:()=>null,setSunDirection(){},changed(){}});
 try{
  for(let turn=0;turn<80&&(turn===0||environment.stats.materialGraphPending||queue.pending);turn++){
   environment.prepare(turn*32,true);if(queue.pending)queue.step();await tick();await tick();
  }
  environment.prepare(10_000,true);assert.ok(compiles>0);assert.ok(nodes.every((n,i)=>n.material!==damageMaterials[i]),'The actual environment owner publishes its own material clones.');
  damage.update([{binding:damage.sites()[0].buildingBinding,condition:'burned',rebuild:null}]);assert.equal(damage.stats.damagedBuildings,1);assert.ok(damage.stats.collapsedParts>0);assert.equal(damage.stats.error,'');
  for(const node of nodes){const material=node.material as MeshStandardMaterial,shader={uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader as never,renderer);assert.equal(shader.vertexShader.split('#define CROWNFALL_SOURCE_BUILDING_DAMAGE').length,2);assert.match(shader.fragmentShader,/cfSurfaceWeatherEnabled/);assert.ok(node.geometry.hasAttribute('cfBuildingChar'));}
  assert.equal(borrowedDisposals,0);environment.dispose();queue.dispose();await queue.whenIdle();assert.ok(nodes.every((n,i)=>n.material===damageMaterials[i]));
  damage.dispose();await damage.whenRetired;assert.equal(fenceCalls,1);assert.equal(damage.stats.retirement,'retired');assert.equal(borrowedDisposals,0);assert.ok(nodes.every(n=>n.material===sourceMaterial));
 }finally{
  environment.dispose();queue.dispose();await queue.whenIdle();damage.dispose();await damage.whenRetired;geometry.dispose();roofGeometry.dispose();sourceMaterial.dispose();for(const mesh of nodes)mesh.dispose();if(prior)Object.defineProperty(globalThis,'Worker',prior);else Reflect.deleteProperty(globalThis,'Worker');
 }
});

import test from'node:test';
import assert from'node:assert/strict';
import{BoxGeometry,Group,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,ShaderLib,Texture,Vector3,Raycaster,type Material}from'three';
import{createBuildingDamageVisuals}from'./building-damage';
import{patchBuildingDamageShader,BUILDING_DAMAGE_PROGRAM_KEY}from'../../../../shared/legacy/aethelgard/observer/building-damage-shader';
import type{BuildingConditionRecord}from'../../../../shared/legacy/aethelgard/observer/building-damage';
const sha='3'.repeat(64),identity=[1,0,0,0,0,1,0,0,0,0,1,0];
const turn=()=>new Promise<void>(r=>setImmediate(r));
function fixture(fence:()=>Promise<void>=async()=>{},before?:(root:Group)=>void){
 const root=new Group(),texture=new Texture(),material=new MeshStandardMaterial({map:texture,normalMap:texture,roughnessMap:texture,metalnessMap:texture,aoMap:texture,roughness:.43,metalness:.12,alphaTest:.3});
 const wallGeometry=new BoxGeometry(4,2,.2),roofGeometry=new BoxGeometry(4.4,.4,3.4),door=new InstancedMesh(wallGeometry,material,2),back=new InstancedMesh(wallGeometry,material,2),roof=new InstancedMesh(roofGeometry,material,2);
 door.name='S_Medieval_Modular_Door_fixture';back.name='S_Medieval_Modular_Wall_fixture';roof.name='Wall_400x200_cell_fixture';
 for(let i=0;i<2;i++){door.setMatrixAt(i,new Matrix4().makeTranslation(i*15,1,0));back.setMatrixAt(i,new Matrix4().makeTranslation(i*15,1,3));roof.setMatrixAt(i,new Matrix4().makeTranslation(i*15,2.2,1.5));}
 root.add(door,back,roof);before?.(root);const rawMatrices=[door,back,roof].map(m=>Float32Array.from(m.instanceMatrix.array));
 const borrowed=[wallGeometry,roofGeometry,material,texture];let disposals=0;for(const r of borrowed)r.addEventListener('dispose',()=>disposals++);
 const owner=createBuildingDamageVisuals({sourceRoot:root,sourceSha256:sha,profile:'desktop',retirementFence:fence});
 const condition=(kind:'burned'|'rebuilding'|'sound'='burned',labourDone=0):BuildingConditionRecord=>({binding:owner.sites()[0].buildingBinding,label:'Source-bound unit fixture',condition:kind,burnedAtMinute:100,lastRaidId:'real-fixture-raid',rebuiltAtMinute:kind==='sound'?300:null,rebuild:kind==='rebuilding'?{crewId:'neighbour',startedMinute:200,labourRequired:180,labourDone,timberCommitted:12}:null});
 return{root,texture,material,wallGeometry,roofGeometry,door,back,roof,owner,condition,rawMatrices,get disposals(){return disposals;},async close(){owner.dispose();await owner.whenRetired;for(const r of borrowed)r.dispose();for(const m of[door,back,roof])m.dispose();}};
}
function rowAt(mesh:InstancedMesh,ordinal:number){return[0,1,2].flatMap(row=>Array.from(mesh.geometry.getAttribute('cfBuildingRow'+row).array).slice(ordinal*4,ordinal*4+4));}

test('source actors retain exact CPU buffers/ordinals, sibling PBR and picking while one building stays burned',async()=>{
 const f=fixture();try{
  assert.equal(f.owner.stats.sourceBuildings,2);assert.equal(f.owner.stats.sourceParts,6);assert.equal(f.owner.stats.collisionChanged,false);
  assert.equal(f.roof.geometry.getAttribute('position'),f.roofGeometry.getAttribute('position'));assert.equal(f.roof.geometry.index,f.roofGeometry.index);
  const material=f.roof.material as MeshStandardMaterial;assert.notEqual(material,f.material);for(const key of['map','normalMap','roughnessMap','metalnessMap','aoMap']as const)assert.equal(material[key],f.material[key]);
  const record=f.condition(),saved=JSON.stringify(record);assert.equal(f.owner.update([record]),true);assert.equal(f.owner.update([record]),false);
  const chars=Array.from(f.roof.geometry.getAttribute('cfBuildingChar').array);assert.equal(chars.filter(v=>v===1).length,1);assert.equal(chars.filter(v=>v===0).length,1);
  for(const m of[f.door,f.back,f.roof])assert.deepEqual(m.instanceMatrix.array,f.rawMatrices[[f.door,f.back,f.roof].indexOf(m)]);
  const sibling=chars.indexOf(0),burned=chars.indexOf(1);assert.deepEqual(rowAt(f.roof,sibling),identity);assert.notDeepEqual(rowAt(f.roof,burned),identity);
  assert.equal(f.owner.stats.collapsedParts,1);assert.equal(f.owner.containsSourcePoint(f.owner.raidSites()[0].position),true);assert.equal(f.owner.containsSourcePoint([999,0,999]),false);
  assert.equal(material.roughness,.43);assert.equal(material.metalness,.12);assert.equal(material.alphaTest,.3);assert.equal(JSON.stringify(record),saved);assert.equal(f.disposals,0);
 }finally{await f.close();}
});

test('persistent rebuild progress reverses the same source roof and sound restores every weight without new material programs',async()=>{
 const f=fixture();try{const material=f.roof.material,geometry=f.roof.geometry;f.owner.update([f.condition()]);const before=Array.from(f.roof.geometry.getAttribute('cfBuildingRow1').array);
  f.owner.update([f.condition('rebuilding',90)]);assert.equal(f.roof.material,material);assert.equal(f.roof.geometry,geometry);assert.notDeepEqual(Array.from(f.roof.geometry.getAttribute('cfBuildingRow1').array),before);
  assert.ok(Array.from(f.roof.geometry.getAttribute('cfBuildingChar').array).includes(.625));assert.equal(f.owner.stats.damagedBuildings,1);
  f.owner.update([f.condition('sound')]);assert.deepEqual(rowAt(f.roof,0),identity);assert.deepEqual(rowAt(f.roof,1),identity);assert.deepEqual(Array.from(f.roof.geometry.getAttribute('cfBuildingChar').array),[0,0]);assert.equal(f.owner.stats.damagedBuildings,0);
 }finally{await f.close();}
});

test('all source binding fields are authoritative and legacy raid indices cannot burn a body',async()=>{
 const f=fixture();try{const record=f.condition();for(const patch of[{sourceSha256:'4'.repeat(64)},{profile:'quest'},{catalogueId:'old'},{buildingId:'nearest-house'},{siteIndex:99}]){
  f.owner.update([{...record,binding:{...record.binding,...patch}as typeof record.binding}]);assert.equal(f.owner.stats.damagedBuildings,0);assert.equal(f.owner.stats.collapsedParts,0);
 }assert.equal(f.owner.stats.sourceBuildings,2);}finally{await f.close();}
});

test('retirement waits a fresh owned fence, restores only its bindings, never disposes shared buffers/maps',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;}),f=fixture(()=>gate),wrapper=f.roof.geometry;let freed=0;wrapper.addEventListener('dispose',()=>{freed++;assert.equal(wrapper.index,null);assert.deepEqual(Object.keys(wrapper.attributes).sort(),['cfBuildingChar','cfBuildingRow0','cfBuildingRow1','cfBuildingRow2']);});
 f.owner.update([f.condition()]);f.owner.dispose();f.owner.dispose();await turn();assert.equal(freed,0);assert.equal(f.roof.geometry,wrapper);assert.equal(f.disposals,0);assert.equal(f.owner.update([]),false);
 release();await f.owner.whenRetired;assert.equal(freed,1);assert.equal(f.roof.geometry,f.roofGeometry);assert.equal(f.roof.material,f.material);assert.equal(f.roof.customDepthMaterial,undefined);assert.equal(f.roof.customDistanceMaterial,undefined);assert.equal(f.disposals,0);assert.equal(f.owner.stats.retirement,'retired');
 await f.close();
});

test('failed fences and later material readers hold owned resources instead of releasing their inputs',async()=>{
 for(const kind of['fence','reader']as const){const f=fixture(kind==='fence'?async()=>{throw Error('GPU unavailable');}:async()=>{}),wrapper=f.roof.geometry;let freed=0;wrapper.addEventListener('dispose',()=>freed++);
  if(kind==='reader')f.roof.material=new MeshStandardMaterial();
  f.owner.dispose();await f.owner.whenRetired;assert.equal(f.owner.stats.retirement,'held-error');assert.equal(freed,0);assert.equal(f.roof.geometry,wrapper);assert.equal(f.disposals,0);
 }
});

test('actual installed Standard/Physical/depth/distance shader seams accept the same positive affine',()=>{
 for(const name of['standard','physical','depth','distance']as const)for(const instanced of[false,true]){
  const library=ShaderLib[name],shader={vertexShader:library.vertexShader,fragmentShader:library.fragmentShader};
  const shadow=name==='depth'||name==='distance';patchBuildingDamageShader(shader,instanced,shadow);assert.match(shader.vertexShader,/#define CROWNFALL_SOURCE_BUILDING_DAMAGE/);assert.match(shader.vertexShader,/cfBuildingRow0/);
  if(!shadow){assert.match(shader.vertexShader,/cross\(cfBuildingA\[1\]/);assert.ok(shader.fragmentShader.indexOf('roughnessFactor=max')<shader.fragmentShader.indexOf('#include <lights_physical_fragment>'));assert.match(shader.fragmentShader,/\.085,\.072,\.058/);}
  const once=structuredClone(shader);patchBuildingDamageShader(shader,instanced,shadow);assert.deepEqual(shader,once);
 }
 const shader={vertexShader:'unknown',fragmentShader:'unknown'},before=structuredClone(shader);assert.throws(()=>patchBuildingDamageShader(shader,true,false),/exactly one/);assert.deepEqual(shader,before);assert.match(BUILDING_DAMAGE_PROGRAM_KEY,/affine-char-v1/);
});

test('nonidentity root transforms keep damage in the original source building frame',async()=>{
 const f=fixture();try{
  f.root.position.set(100,20,-50);f.root.rotation.set(.2,.4,0);f.root.scale.set(2,3,1.5);f.root.updateMatrixWorld(true);
  f.owner.update([f.condition()]);const c=Array.from(f.roof.geometry.getAttribute('cfBuildingChar').array).indexOf(1),v=rowAt(f.roof,c),a=new Matrix4().set(v[0],v[1],v[2],v[3],v[4],v[5],v[6],v[7],v[8],v[9],v[10],v[11],0,0,0,1),m=new Matrix4();f.roof.getMatrixAt(c,m);
  const b=f.owner.damagedBounds()[0].bounds,p=f.roofGeometry.getAttribute('position');for(let i=0;i<p.count;i++){const q=new Vector3().fromBufferAttribute(p,i).applyMatrix4(a).applyMatrix4(m);for(let k=0;k<3;k++)assert.ok(q.getComponent(k)>=b.min[k]-1e-5&&q.getComponent(k)<=b.max[k]+1e-5);}
 }finally{await f.close();}
});

test('mutating a source instance after catalogue creation cannot relocate damage onto an unbound actor',async()=>{
 const f=fixture();try{f.owner.update([f.condition()]);f.roof.setMatrixAt(0,new Matrix4().makeTranslation(400,4,0));f.owner.update([{...f.condition()}]);assert.equal(f.owner.stats.damagedBuildings,0);assert.match(f.owner.stats.error,/Source building/);assert.deepEqual(Array.from(f.roof.geometry.getAttribute('cfBuildingChar').array),[0,0]);}finally{await f.close();}
});

test('existing source compile/render hooks and map samplers survive the colour and paired shadow hooks',async()=>{
 const root=new Group(),geometry=new BoxGeometry(4,2,.2),roofGeometry=new BoxGeometry(4.4,.4,3.4),material=new MeshStandardMaterial(),door=new Mesh(geometry,material),back=new Mesh(geometry,material),roof=new Mesh(roofGeometry,material);let calls=0;
 material.onBeforeCompile=shader=>{calls++;shader.vertexShader='// authored hook\n'+shader.vertexShader;};material.customProgramCacheKey=()=>':authored';const render=()=>{};material.onBeforeRender=render;
 door.name='S_Medieval_Modular_Door_fixture';back.name='S_Medieval_Modular_Wall_fixture';roof.name='Wall_400x200_cell_fixture';door.position.set(0,1,0);back.position.set(0,1,3);roof.position.set(0,2.2,1.5);door.scale.x=-1;root.add(door,back,roof);
 const owner=createBuildingDamageVisuals({sourceRoot:root,sourceSha256:sha,profile:'quest',retirementFence:async()=>{}});
 try{assert.equal(owner.stats.sourceBuildings,1);assert.equal(door.scale.x,-1);const m=roof.material as MeshStandardMaterial;assert.equal(m.onBeforeRender,render);assert.match(m.customProgramCacheKey(),/:authored:crownfall-building-burn/);
  const shader={...ShaderLib.standard,uniforms:{}};m.onBeforeCompile(shader as never,{}as never);assert.equal(calls,1);assert.match(shader.vertexShader,/authored hook/);assert.ok('cfBuildingRow0'in shader.uniforms);
  for(const shadow of[roof.customDepthMaterial!,roof.customDistanceMaterial!]){const lib=shadow.type==='MeshDepthMaterial'?ShaderLib.depth:ShaderLib.distance,s={...lib,uniforms:{}};shadow.onBeforeCompile(s as never,{}as never);assert.match(s.vertexShader,/CROWNFALL_SOURCE_BUILDING_DAMAGE/);assert.ok('cfBuildingRow1'in s.uniforms);}
 }finally{owner.dispose();await owner.whenRetired;geometry.dispose();roofGeometry.dispose();material.dispose();}
});


test('repeat loads, unrelated helper insertion, source sibling reordering and root display transforms preserve bindings',async()=>{
 const a=fixture(),b=fixture(async()=>{},root=>{root.children.reverse();root.add(new Group());root.position.set(31,7,-15);root.rotation.set(.2,.6,-.1);root.scale.set(2,3,4);});
 try{assert.deepEqual(a.owner.sites(),b.owner.sites());const record=a.condition();assert.equal(b.owner.update([record]),true);assert.equal(b.owner.stats.damagedBuildings,1);assert.equal(b.owner.stats.collapsedParts,1);}finally{await a.close();await b.close();}
});

test('duplicate actor name/frame/geometry/ordinal keys hold both components rather than inventing new identities',async()=>{
 const f=fixture(async()=>{},root=>{root.add(root.children[0].clone());});try{assert.equal(f.owner.stats.sourceBuildings,0);assert.equal(f.owner.stats.heldComponents,2);assert.equal(f.owner.sites().length,0);assert.equal(f.owner.stats.ownedMaterials,0);assert.equal(f.roof.geometry,f.roofGeometry);}finally{await f.close();}
});


test('source raycast triangles and original instance IDs remain exact beneath a collapsed rendered roof',async()=>{
 const f=fixture();try{const site=f.owner.raidSites()[0],ray=new Raycaster(new Vector3(site.position[0],20,1.5),new Vector3(0,-1,0),0,50),sample=()=>ray.intersectObjects([f.door,f.back,f.roof],false).map(h=>({instanceId:h.instanceId,distance:h.distance,point:h.point.toArray()}));
  const before=sample();assert.ok(before.length);f.owner.update([f.condition()]);assert.deepEqual(sample(),before);
 }finally{await f.close();}
});

test('a partial material clone failure rolls back before publishing any source wrapper',()=>{
 const root=new Group(),g=new BoxGeometry(4,2,.2),r=new BoxGeometry(4.4,.4,3.4),source=new MeshStandardMaterial(),bad=new MeshStandardMaterial(),door=new Mesh(g,source),wall=new Mesh(g,bad),roof=new Mesh(r,source);let borrowed=0,owned=0;
 source.addEventListener('dispose',()=>borrowed++);g.addEventListener('dispose',()=>borrowed++);r.addEventListener('dispose',()=>borrowed++);const clone=source.clone.bind(source);source.clone=()=>{const m=clone();m.addEventListener('dispose',()=>owned++);return m;};bad.clone=()=>{throw Error('clone rejected');};
 door.name='S_Medieval_Modular_Door_fixture';wall.name='S_Medieval_Modular_Wall_fixture';roof.name='Wall_400x200_cell_fixture';door.position.set(0,1,0);wall.position.set(0,1,3);roof.position.set(0,2.2,1.5);root.add(door,wall,roof);
 assert.throws(()=>createBuildingDamageVisuals({sourceRoot:root,sourceSha256:sha,profile:'desktop',retirementFence:async()=>{}}),/clone rejected/);assert.equal(door.geometry,g);assert.equal(door.material,source);assert.equal(door.customDepthMaterial,undefined);assert.equal(wall.geometry,g);assert.equal(borrowed,0);assert.ok(owned>0);g.dispose();r.dispose();source.dispose();bad.dispose();
});

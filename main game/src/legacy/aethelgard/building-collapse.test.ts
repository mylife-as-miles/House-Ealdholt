import test from'node:test';import assert from'node:assert/strict';
import{BoxGeometry,Group,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,Raycaster,Vector3}from'three';
import{createBuildingDamageVisuals}from'./building-damage';
function fixture(instanced=true,fence:()=>Promise<void>=async()=>{}){
 const root=new Group(),g=new BoxGeometry(4,2,.2),r=new BoxGeometry(4.4,.4,3.4),material=new MeshStandardMaterial({roughness:.43}),nodes:Mesh[]=[],borrowed=[g,r,material];let disposals=0;
 for(const item of borrowed)item.addEventListener('dispose',()=>disposals++);
 for(const[name,geometry,y,z]of[['S_Medieval_Modular_Door_fixture',g,1,0],['S_Medieval_Modular_Wall_fixture',g,1,3],['Wall_400x200_cell_fixture',r,2.2,1.5]]as const){
  const mesh=instanced?new InstancedMesh(geometry,material,2):new Mesh(geometry,material);mesh.name=name;
  if(mesh instanceof InstancedMesh)for(let i=0;i<2;i++)mesh.setMatrixAt(i,new Matrix4().makeTranslation(i*15,y,z));else mesh.position.set(0,y,z);root.add(mesh);nodes.push(mesh);
 }
 root.updateMatrixWorld(true);const attributes=nodes.map(m=>m instanceof InstancedMesh?m.instanceMatrix:null),matrices=attributes.map(a=>a?Float32Array.from(a.array):null),local=nodes.map(m=>m.matrix.clone());
 const owner=createBuildingDamageVisuals({sourceRoot:root,sourceSha256:'3'.repeat(64),profile:'desktop',retirementFence:fence,physicalCollapse:{groundHeight:()=>0}}),building=owner.buildings()[0],record={binding:building.binding,condition:'burned'as const,rebuild:null,collapseAtMinute:100};
 return{root,nodes,g,r,material,attributes,matrices,local,owner,record,building,get disposals(){return disposals;},async close(){owner.dispose();await owner.whenRetired;for(const b of borrowed)b.dispose();for(const m of nodes)if(m instanceof InstancedMesh)m.dispose();}};
}
test('opt-in physical collapse changes actual source picking/collision while preserving buffers, PBR and sibling ordinals',async()=>{
 const f=fixture();try{
  const roof=f.nodes[2]as InstancedMesh,ordinal=f.building.parts.find(p=>p.kind==='roof')!.sourceOrdinal!,sibling=ordinal===0?1:0,ray=new Raycaster(new Vector3(f.building.position[0],20,1.5),new Vector3(0,-1,0),0,50);
  const sample=()=>ray.intersectObject(roof,false).map(h=>({distance:h.distance,instanceId:h.instanceId,point:h.point.toArray()})),before=sample();assert.ok(before.length);
  assert.notEqual(roof.instanceMatrix,f.attributes[2]);assert.equal(roof.geometry.getAttribute('position'),f.r.getAttribute('position'));assert.equal(roof.geometry.index,f.r.index);assert.equal((roof.material as MeshStandardMaterial).roughness,.43);
  const original=f.owner.physicalColliders().find(c=>c.sourcePartId===f.building.parts.find(p=>p.kind==='roof')!.id)!;
  f.owner.updateDisasters([f.record],100+.3/60);assert.equal(f.owner.stats.fallingParts,3);assert.notDeepEqual(sample(),before);assert.notDeepEqual(f.owner.physicalColliders().find(c=>c.id===original.id)!.bounds,original.bounds);
  assert.deepEqual(Array.from(roof.instanceMatrix.array).slice(sibling*16,sibling*16+16),Array.from(f.matrices[2]!).slice(sibling*16,sibling*16+16));assert.deepEqual(f.attributes[2]!.array,f.matrices[2]);assert.equal(f.disposals,0);
  f.owner.updateDisasters([f.record],101);assert.equal(f.owner.stats.settledParts,3);assert.equal(f.owner.stats.collisionChanged,true);assert.equal(f.owner.navigationObstacles().length,3);assert.equal(f.owner.stats.error,'');
  const at=f.owner.physicalColliders().find(c=>c.id===original.id)!;assert.ok(f.owner.intersectsSourceBounds(at.bounds));
  assert.deepEqual(Array.from(roof.geometry.getAttribute('cfBuildingRow1').array),[0,1,0,0,0,1,0,0],'Physical transforms must never double-apply shader roof shrinking.');
 }finally{await f.close();}
});
test('earned repair restores exact authored source modules and picking, with no replacement material',async()=>{
 const f=fixture();try{const roof=f.nodes[2]as InstancedMesh,material=roof.material;f.owner.updateDisasters([f.record],101);
  f.owner.updateDisasters([{...f.record,condition:'rebuilding',rebuild:{crewId:'real',startedMinute:101,labourRequired:180,labourDone:60,timberCommitted:12}}],101);assert.equal(f.owner.stats.restoredParts,1);assert.equal(f.owner.stats.settledParts,2);
  f.owner.updateDisasters([{...f.record,condition:'sound'}],102);for(let i=0;i<f.nodes.length;i++)assert.deepEqual((f.nodes[i]as InstancedMesh).instanceMatrix.array,f.matrices[i]);assert.equal(roof.material,material);assert.equal(f.owner.navigationObstacles().length,0);assert.equal(f.owner.stats.collisionChanged,false);
 }finally{await f.close();}
});
test('non-instanced and mirrored source modules physically move and restore their exact local matrices',async()=>{
 const f=fixture(false);try{const original=f.nodes.map(m=>m.matrix.clone());f.root.position.set(80,4,-20);f.root.scale.set(2,3,1);f.root.updateMatrixWorld(true);
  f.owner.updateDisasters([f.record],101);assert.ok(f.nodes.some((m,i)=>!m.matrix.equals(original[i])));f.owner.updateDisasters([{...f.record,condition:'sound'}],102);for(let i=0;i<f.nodes.length;i++){assert.deepEqual(f.nodes[i].matrix.elements,original[i].elements);assert.equal(f.nodes[i].matrixAutoUpdate,true);}assert.equal(f.owner.stats.error,'');
 }finally{await f.close();}
});
test('physical retirement is fenced and restores borrowed instance storage without disposal',async()=>{
 let release!:()=>void;const f=fixture(true,()=>new Promise<void>(r=>{release=r;}));f.owner.updateDisasters([f.record],101);f.owner.dispose();await new Promise<void>(r=>setImmediate(r));assert.notEqual((f.nodes[0]as InstancedMesh).instanceMatrix,f.attributes[0]);assert.equal(f.disposals,0);release();await f.owner.whenRetired;
 for(let i=0;i<f.nodes.length;i++)assert.equal((f.nodes[i]as InstancedMesh).instanceMatrix,f.attributes[i]);assert.equal(f.owner.stats.retirement,'retired');assert.equal(f.disposals,0);await f.close();
});
test('nested mirrored source modules use one absolute physical pose and exact restoration',async()=>{
 const root=new Group(),wallGeometry=new BoxGeometry(4,2,.2),roofGeometry=new BoxGeometry(4.4,.4,3.4),m=new MeshStandardMaterial(),door=new Mesh(wallGeometry,m),wall=new Mesh(wallGeometry,m),roof=new Mesh(roofGeometry,m);
 door.name='S_Medieval_Modular_Door_nested';wall.name='S_Medieval_Modular_Wall_nested';roof.name='Wall_400x200_cell_nested';door.position.set(0,1,0);wall.position.set(0,1,3);roof.position.set(0,1.2,-1.5);roof.scale.x=-1;root.add(door,wall);wall.add(roof);root.updateMatrixWorld(true);const local=roof.matrix.clone();
 const owner=createBuildingDamageVisuals({sourceRoot:root,sourceSha256:'3'.repeat(64),profile:'desktop',physicalCollapse:{groundHeight:()=>0},retirementFence:async()=>{}}),binding=owner.buildings()[0].binding,record={binding,condition:'burned'as const,rebuild:null,collapseAtMinute:100};
 try{assert.doesNotThrow(()=>JSON.stringify(owner.buildings()));owner.updateDisasters([record],101);assert.equal(owner.stats.error,'');const collider=owner.physicalColliders().find(c=>c.sourcePartId===owner.buildings()[0].parts.find(p=>p.kind==='roof')!.id)!,p=roof.geometry.getAttribute('position');
  for(let i=0;i<p.count;i++){const v=new Vector3().fromBufferAttribute(p,i).applyMatrix4(roof.matrixWorld);for(let k=0;k<3;k++)assert.ok(v.getComponent(k)>=collider.bounds.min[k]-1e-5&&v.getComponent(k)<=collider.bounds.max[k]+1e-5,'Actual nested source vertices must match the conservative physical collider.');}
  owner.updateDisasters([{...record,condition:'sound'}],102);assert.deepEqual(roof.matrix.elements,local.elements);assert.equal(roof.scale.x,-1);
 }finally{owner.dispose();await owner.whenRetired;wallGeometry.dispose();roofGeometry.dispose();m.dispose();}
});
test('foreign physical matrix edits are held without resetting or overwriting the later owner',async()=>{
 const f=fixture();f.owner.updateDisasters([f.record],101);const mesh=f.nodes[2]as InstancedMesh;mesh.setMatrixAt(0,new Matrix4().makeTranslation(400,5,0));const foreign=Float32Array.from(mesh.instanceMatrix.array);
 assert.equal(f.owner.updateDisasters([],102),false);assert.deepEqual(mesh.instanceMatrix.array,foreign);assert.match(f.owner.stats.error,/physical collapse held/);f.owner.dispose();await f.owner.whenRetired;assert.equal(f.owner.stats.retirement,'held-error');assert.deepEqual(mesh.instanceMatrix.array,foreign);
 // Held resources deliberately remain owned until the later source reader retires.
});

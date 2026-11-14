import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BufferAttribute, BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { collectEaldholtWoodlandSurfaces,createEaldholtFarWoodland,markEaldholtFarWoodlandMaterialIdentity,createEaldholtBorrowedFarWoodlandPrototype } from './far-woodland';
import { readEaldholtFarWoodlandConfig,validateEaldholtFarWoodlandGlb,loadEaldholtFarWoodlandLod } from './far-woodland-lod';
import { applyEaldholtNeutralFill } from './neutral-fill';
import { createEaldholtFarGeography } from '../../../../shared/legacy/aethelgard/environment/far-surround';
function geometry(triangles:number){const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(new Float32Array([-1,0,-1,1,0,-1,0,10,1]),3));g.setIndex(Array.from({length:triangles*3},(_,i)=>i%3));return g;}
function fixture(){
  const root=new Group(),landGeometry=new BufferGeometry();landGeometry.setAttribute('position',new BufferAttribute(new Float32Array([-500,1,-500,500,1,-500,-500,1,500,500,1,500]),3));landGeometry.setIndex([0,2,1,1,2,3]);
  const land=new Mesh(landGeometry,new MeshStandardMaterial());land.userData.crownfallElderbloom={kind:'terrain'};root.add(land);
  const mats=['bark','canopy','decoration'].map(name=>{const m=new MeshStandardMaterial();m.name=name;root.add(new Mesh(geometry(1),m));return m;});
  const parts=[180,200,145].map((triangles,i)=>({geometry:geometry(triangles),targetMaterialName:mats[i].name,semanticID:['ealdholt-far-lod-bark','ealdholt-far-lod-canopy','ealdholt-far-lod-decoration'][i]}));
  const prototype={parts,bounds:new Box3(new Vector3(-1,0,-1),new Vector3(1,10,1)),canopyRadius:Math.SQRT2,groundContactLocalY:0,triangles:525 as const,geometryBytes:3000,referencedGeometryBytes:3000,sha256:'a'.repeat(64),kind:'private-native-lod' as const,ownership:'owned' as const,sourceFamily:'private-test',dispose(){}};
  const geography=createEaldholtFarGeography({seaPositions:[-500,0,-500,-200,0,-500,-500,0,500,-200,0,500],channelPositions:[20,0,40,20,0,60,500,0,40,500,0,60],sourceEnvelope:{minX:-10,maxX:10,minZ:-10,maxZ:10},riverFarX:1000});
  const existingPlacements=[{x:20,y:1,z:-60,scale:1,yaw:0},{x:60,y:1,z:-30,scale:1,yaw:0},{x:60,y:1,z:100,scale:1,yaw:0},{x:20,y:1,z:100,scale:1,yaw:0}];
  return {root,land,mats,prototype,options:{prototype,landOwners:[land],geography,existingPlacements,existingCanopyRadius:3,maximumTrees:96}};
}
test('far woodland preserves source buffers/materials, reports full bounds and owns instance buffers only',()=>{
  const f=fixture(),source=f.land.geometry.getAttribute('position').array.slice(),before=f.root.children.slice();
  const h=createEaldholtFarWoodland(f.root,f.options);assert.equal(h.object.parent,null);assert.equal(h.instanceCount,96);assert.equal(h.triangles,50400);assert.equal(h.drawCalls,3);assert.equal(h.extraTextureBytes,0);
  assert.equal(h.instanceBytes,96*64*3);assert.equal(h.bufferBytes,h.geometryBytes+h.instanceBytes);assert.deepEqual(f.root.children,before);assert.deepEqual(f.land.geometry.getAttribute('position').array,source);
  const children=h.object.children as InstancedMesh[];let materialDisposals=0,geometryDisposals=0;
  for(let i=0;i<3;i++){assert.equal(children[i].geometry,f.prototype.parts[i].geometry);assert.equal(children[i].material,f.mats[i]);f.mats[i].addEventListener('dispose',()=>materialDisposals++);f.prototype.parts[i].geometry.addEventListener('dispose',()=>geometryDisposals++);}
  const matrix=new Matrix4(),p=new Vector3();for(let id=0;id<h.instanceCount;id++){children[0].getMatrixAt(id,matrix);p.set(0,0,0).applyMatrix4(matrix);assert.ok(Math.abs(p.y-1)<1e-6);}
  assert.ok(h.bounds);assert.equal(h.object.userData.crownfallFarSurround.fullBoundsRequired,true);
  h.setQuality('low');assert.equal(h.activeActors,32);assert.ok(children.every(c=>c.count===32));const fixed=children[0].instanceMatrix.array.slice();
  h.setQuality('medium');assert.equal(h.activeActors,64);h.setQuality('high');assert.equal(h.activeActors,96);assert.deepEqual(children[0].instanceMatrix.array,fixed);
  h.dispose();h.dispose();assert.equal(geometryDisposals,0);assert.equal(materialDisposals,0);
});
test('source display transforms cancel without mutating borrowed geometry bounds',()=>{
  const a=fixture(),b=fixture(),first=createEaldholtFarWoodland(a.root,a.options);b.root.position.set(31,12,-5);b.root.scale.setScalar(.02);b.root.rotation.set(.4,.8,-.1);
  const transformed=createEaldholtFarWoodland(b.root,b.options);assert.equal(transformed.instanceCount,first.instanceCount);
  for(let i=0;i<first.placements.length;i++){const x=first.placements[i],y=transformed.placements[i];assert.ok(Math.abs(x.y-y.y)<1e-9);assert.equal(x.x,y.x);assert.equal(x.z,y.z);}
  assert.equal(b.land.geometry.boundingBox,null);assert.equal(b.prototype.parts[0].geometry.boundingBox,null);first.dispose();transformed.dispose();
});
test('incomplete, ambiguous materials and unqualified Native allocation reject explicitly',()=>{
  const f=fixture();assert.throws(()=>createEaldholtFarWoodland(f.root,{...f.options,profile:'quest'}),/Native/);
  f.mats[0].name='missing';assert.throws(()=>createEaldholtFarWoodland(f.root,f.options),/exact existing material/);f.mats[0].name='bark';
  const duplicate=f.mats[0].clone();f.root.add(new Mesh(geometry(1),duplicate));assert.throws(()=>createEaldholtFarWoodland(f.root,f.options),/exact existing material/);
});
test('private asset configuration opts out when absent and rejects mutable or off-origin inputs',()=>{
  assert.equal(readEaldholtFarWoodlandConfig(undefined),null);const sha256='a'.repeat(64);
  assert.deepEqual(readEaldholtFarWoodlandConfig(JSON.stringify({url:'/tree.glb',sha256}),'https://crownfall.test/'),{url:'https://crownfall.test/tree.glb',sha256});
  for(const url of ['https://elsewhere.test/tree.glb','http://localhost/tree.glb?token=secret','http://user:pass@localhost/tree.glb','file:///tree.glb'])assert.throws(()=>readEaldholtFarWoodlandConfig(JSON.stringify({url,sha256}),'https://crownfall.test/'));
  assert.throws(()=>readEaldholtFarWoodlandConfig('{}'));assert.throws(()=>validateEaldholtFarWoodlandGlb(new ArrayBuffer(16)),/size budget/);
});
function container(mutate:(j:any)=>void=()=>{}) {
  const j:any={asset:{version:'2.0'},buffers:[{byteLength:4}],bufferViews:[{buffer:0,byteOffset:0,byteLength:4}],
    meshes:[0,1,2].map(i=>({primitives:[{indices:i,attributes:{POSITION:3}}]})),accessors:[540,600,435].map(count=>({count,componentType:5123,type:'SCALAR'})),nodes:[]};
  mutate(j);const raw=new TextEncoder().encode(JSON.stringify(j)),length=Math.ceil(raw.length/4)*4,result=new ArrayBuffer(20+length+12),v=new DataView(result);
  v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,result.byteLength,true);v.setUint32(12,length,true);v.setUint32(16,0x4e4f534a,true);
  new Uint8Array(result,20,length).fill(32);new Uint8Array(result,20,raw.length).set(raw);v.setUint32(20+length,4,true);v.setUint32(24+length,0x004e4942,true);return result;
}
test('geometry container gate blocks external resources and extensions before parser execution',()=>{
  assert.doesNotThrow(()=>validateEaldholtFarWoodlandGlb(container()));
  for(const mutate of [(j:any)=>{j.images=[{uri:'https://remote.test/a.png'}];},(j:any)=>{j.materials=[{}];},
    (j:any)=>{j.buffers[0].uri='external.bin';},(j:any)=>{j.meshes[0].primitives[0].material=0;},
    (j:any)=>{j.meshes[0].primitives[0].extensions={KHR_draco_mesh_compression:{}};},(j:any)=>{j.accessors[0].count=3;}])
    assert.throws(()=>validateEaldholtFarWoodlandGlb(container(mutate)));
});
test('configured loader rejects oversize, wrong hash and cancellation before material/geometry parsing',async()=>{
  const cfg={url:'http://127.0.0.1/tree.glb',sha256:'a'.repeat(64)},signal=new AbortController().signal;
  await assert.rejects(loadEaldholtFarWoodlandLod(cfg,{signal,fetcher:async()=>new Response(new Uint8Array(4),{headers:{'content-length':'131073'}})}),/size budget/);
  await assert.rejects(loadEaldholtFarWoodlandLod(cfg,{signal,fetcher:async()=>new Response(new Uint8Array([1,2,3]))}),/SHA-256/);
  const cancelled=new AbortController();cancelled.abort();let fetched=false;
  await assert.rejects(loadEaldholtFarWoodlandLod(cfg,{signal:cancelled.signal,fetcher:async()=>{fetched=true;return new Response();}}));assert.equal(fetched,false);
});

test('stable material identity survives the real neutral-fill clone and borrows adapted refs only',()=>{
  const f=fixture();markEaldholtFarWoodlandMaterialIdentity(f.root);const fill=applyEaldholtNeutralFill(f.root);
  const h=createEaldholtFarWoodland(f.root,f.options),meshes=h.object.children as InstancedMesh[];
  let borrowedDisposals=0;
  for(let part=0;part<3;part++){
    const material=meshes[part].material as MeshStandardMaterial;
    assert.notEqual(material,f.mats[part]);assert.equal(material.name,f.mats[part].name+'_NeutralFill');
    assert.equal(material.userData.crownfallSourceMaterialName,f.mats[part].name);
    assert.equal(material.userData.crownfallNeutralIbl.luminancePreserved,true);
    material.addEventListener('dispose',()=>borrowedDisposals++);
  }
  h.dispose();assert.equal(borrowedDisposals,0);fill.dispose();assert.equal(borrowedDisposals,3);
  assert.equal((f.root.children.find(o=>o instanceof Mesh&&(o.material as MeshStandardMaterial).name==='bark') as Mesh).material,f.mats[0]);
});
function detailedFixture(){
  const f=fixture(),object=new Group();object.name='Existing detailed local woodland';f.root.add(object);
  const placements=f.options.existingPlacements.map((p,i)=>({...p,yaw:i===0?.61:0,scale:i===0?1.13:1}));
  const frames=[new Matrix4(),new Matrix4().makeTranslation(.4,1.5,-.1),new Matrix4().makeRotationY(.13).setPosition(-.4,3,.2)];
  const components=[1000,8345,538].map((count,part)=>{
    const mesh=new InstancedMesh(geometry(count),f.mats[part],placements.length);mesh.name='Detailed source part '+part;
    mesh.position.set(.2,0,-.3);mesh.rotation.y=-.14;mesh.updateMatrix();const inversePart=mesh.matrix.clone().invert();
    placements.forEach((p,id)=>{
      const actor=new Matrix4().compose(new Vector3(p.x,p.y,p.z),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),p.yaw),new Vector3().setScalar(p.scale));
      mesh.setMatrixAt(id,new Matrix4().multiplyMatrices(inversePart,actor).multiply(frames[part]));
    });object.add(mesh);return mesh;
  });
  return {...f,components,source:{object,placements,sourceFamily:'Detailed source fixture',trianglesPerTree:9883},options:{...f.options,existingPlacements:placements}};
}
test('borrowed detailed prototype reconstructs every original part frame without touching source buffers or bounds',()=>{
  const f=detailedFixture();f.root.position.set(31,12,-5);f.root.scale.setScalar(.02);f.root.rotation.set(.4,.8,-.1);f.root.updateMatrixWorld(true);
  const original=f.components.map(m=>({geometry:m.geometry,matrix:m.matrix.clone(),instances:m.instanceMatrix.array.slice(),positions:m.geometry.getAttribute('position').array.slice(),indices:m.geometry.index!.array.slice(),material:m.material}));
  for(const m of f.components){m.geometry.computeBoundingBox=()=>{throw Error('Borrowed geometry bound mutation');};m.geometry.computeBoundingSphere=()=>{throw Error('Borrowed geometry sphere mutation');};}
  const p=createEaldholtBorrowedFarWoodlandPrototype(f.root,f.source),first=f.source.placements[0],actor=new Matrix4().compose(new Vector3(first.x,first.y,first.z),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),first.yaw),new Vector3().setScalar(first.scale));
  assert.equal(p.kind,'borrowed-detailed');assert.equal(p.ownership,'borrowed');assert.equal(p.triangles,9883);assert.equal(p.sha256,null);assert.equal(p.geometryBytes,0);assert.ok(p.referencedGeometryBytes>0);assert.ok(Math.abs(p.bounds.min.y)<1e-5);assert.equal(p.groundContactLocalY,0);
  let geometryDisposed=0,materialDisposed=0;
  for(let part=0;part<3;part++){
    const source=f.components[part],prototype=p.parts[part],position=source.geometry.getAttribute('position'),instance=new Matrix4();source.getMatrixAt(0,instance);
    const sourceWorld=new Matrix4().multiplyMatrices(source.matrixWorld,instance),recreated=new Matrix4().multiplyMatrices(f.root.matrixWorld,actor).multiply(prototype.localMatrix!);
    for(let vertex=0;vertex<position.count;vertex++)assert.ok(new Vector3().fromBufferAttribute(position,vertex).applyMatrix4(sourceWorld).distanceTo(new Vector3().fromBufferAttribute(position,vertex).applyMatrix4(recreated))<1e-9);
    assert.equal(prototype.geometry,source.geometry);assert.equal(prototype.material,source.material);assert.equal(source.geometry.boundingBox,null);assert.equal(source.geometry.boundingSphere,null);
    assert.deepEqual(source.matrix,original[part].matrix);assert.deepEqual(source.instanceMatrix.array,original[part].instances);assert.deepEqual(position.array,original[part].positions);assert.deepEqual(source.geometry.index!.array,original[part].indices);
    source.geometry.addEventListener('dispose',()=>geometryDisposed++);(source.material as MeshStandardMaterial).addEventListener('dispose',()=>materialDisposed++);
  }
  p.dispose();p.dispose();assert.equal(geometryDisposed,0);assert.equal(materialDisposed,0);assert.equal(f.source.object.children.length,3);
});
test('detailed far trees apply component frames after placement, retain full bounds and allocate only instance matrices',()=>{
  const f=detailedFixture();markEaldholtFarWoodlandMaterialIdentity(f.root);const fill=applyEaldholtNeutralFill(f.root);
  const prototype=createEaldholtBorrowedFarWoodlandPrototype(f.root,f.source),h=createEaldholtFarWoodland(f.root,{...f.options,prototype,maximumTrees:48});
  assert.equal(h.instanceCount,48);assert.equal(h.triangles,474384);assert.deepEqual(h.counts,{low:16,medium:32,high:48});assert.equal(h.trianglesPerTree,9883);
  assert.equal(h.geometryBytes,0);assert.equal(h.referencedGeometryBytes,prototype.referencedGeometryBytes);assert.equal(h.instanceBytes,9216);assert.equal(h.bufferBytes,9216);assert.equal(h.extraTextureBytes,0);
  const full=new Box3(new Vector3(...h.bounds!.min),new Vector3(...h.bounds!.max)),matrix=new Matrix4();let disposed=0;
  for(let part=0;part<3;part++){
    const mesh=h.object.children[part] as InstancedMesh;assert.equal(mesh.geometry,f.components[part].geometry);assert.equal(mesh.material,f.components[part].material);
    mesh.geometry.addEventListener('dispose',()=>disposed++);
    const positions=mesh.geometry.getAttribute('position');
    for(let actor=0;actor<mesh.count;actor++){mesh.getMatrixAt(actor,matrix);for(let vertex=0;vertex<positions.count;vertex++)assert.ok(full.containsPoint(new Vector3().fromBufferAttribute(positions,vertex).applyMatrix4(matrix)));}
  }
  h.setQuality('low');assert.equal(h.activeActors,16);h.setQuality('medium');assert.equal(h.activeActors,32);h.setQuality('high');assert.equal(h.activeActors,48);
  h.dispose();prototype.dispose();assert.equal(disposed,0);assert.equal(f.components[0].geometry.boundingBox,null);assert.equal(f.components[0].geometry.boundingSphere,null);fill.dispose();
});
test('detailed source actor, triangle and cross-model ownership budgets fail before allocation',()=>{
  const f=detailedFixture(),prototype=createEaldholtBorrowedFarWoodlandPrototype(f.root,f.source);
  assert.throws(()=>createEaldholtFarWoodland(f.root,{...f.options,prototype,maximumTrees:49}),/budget/);
  assert.throws(()=>createEaldholtFarWoodland(f.root,{...f.options,prototype,maximumTrees:48,existingPlacements:Array.from({length:220},(_,i)=>f.source.placements[i%4])}),/Combined generated woodland triangle budget/);
  assert.throws(()=>createEaldholtFarWoodland(new Group(),{...f.options,prototype,maximumTrees:48}),/prototype/);
  assert.throws(()=>createEaldholtBorrowedFarWoodlandPrototype(f.root,{...f.source,trianglesPerTree:1}),/complete grounded tree/);
});

test('transferring worker support snapshots never detaches authored render/collision index buffers',()=>{
 const f=fixture(),geometry=f.land.geometry,index=geometry.index!,positions=geometry.getAttribute('position');
 const originalIndex=Array.from(index.array),originalPositions=Array.from(positions.array);
 const surfaces=collectEaldholtWoodlandSurfaces(f.root,[f.land],'terrain');
 assert.equal(surfaces.length,1);assert.notEqual((surfaces[0].indices as Uint32Array).buffer,index.array.buffer);
 const input=surfaces[0];structuredClone(input,{transfer:[(input.positions as Float64Array).buffer,(input.indices as Uint32Array).buffer]});
 assert.deepEqual(Array.from(index.array),originalIndex);assert.deepEqual(Array.from(positions.array),originalPositions);
 f.root.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();if(!Array.isArray(o.material))o.material.dispose();}});
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {BoxGeometry,DataTexture,DoubleSide,Group,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,PerspectiveCamera,Scene,Vector3,type Camera,type InstancedBufferAttribute,type WebGLRenderer} from 'three';
import {createVegetationCellHlod,readVegetationSourceTriangles} from './vegetation-cell-hlod';
import type {VegetationPrototypeResources} from './vegetation-prototype';

function fixture(pending=false) {
 const root=new Group(),sourceRoot=new Group();sourceRoot.add(root);
 const geometry=new BoxGeometry(2,8,2);geometry.translate(0,4,0);geometry.clearGroups();
 const bark=new MeshStandardMaterial({name:'bark',roughness:.7}),foliage=new MeshStandardMaterial({name:'foliage',side:DoubleSide,alphaTest:.35});
 const ids=[101,202,303,404],original=[new Matrix4(),new Matrix4().makeTranslation(0,0,-500),new Matrix4().makeTranslation(1000,0,0),new Matrix4().makeTranslation(-1000,0,0)];
 const sources=[bark,foliage].map(material=>{const mesh=new InstancedMesh(geometry,material,ids.length);mesh.userData.crownfallOwnedRegionalBatch=true;
  original.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));root.add(mesh);return mesh;});
 let resume!:()=>void;const gate=pending?new Promise<void>(resolve=>resume=resolve):Promise.resolve();
 const materials=new Map<string,MeshStandardMaterial>(),maps=[new DataTexture(),new DataTexture()] as const;
 const resources={geometry:(part:{geometry:typeof geometry})=>({ready:gate.then(()=>({geometry:part.geometry,sourceTriangles:12,triangles:12})),release(){}}),
  material:(key:string,build:()=>MeshStandardMaterial)=>{if(!materials.has(key))materials.set(key,build());return{ready:Promise.resolve({material:materials.get(key)!}),release(){}};},
  atlas:(_parts:unknown,_tile:unknown,views:number)=>({ready:Promise.resolve({bytes:1,maps,record:{views,columns:4,rows:views/4,tileSize:64,centre:[0,4,0],extent:[3,8],mips:[{width:256,height:64*views/4}],coverage:Array(views).fill(.5)}}),release(){}}),
  compile:()=>({ready:Promise.resolve({}),release(){}})} as unknown as VegetationPrototypeResources;
 const camera=new PerspectiveCamera(60,1,.1,2000);camera.position.set(0,4,20);camera.lookAt(0,4,0);camera.updateMatrixWorld();
 const config={resources,renderer:{} as WebGLRenderer,scene:new Scene(),camera,sourceRoot,signal:new AbortController().signal,tileSize:64 as const,changed(){}};
 return {root,sourceRoot,sources,ids,original,camera,config,resume:()=>resume(),cleanup(){for(const m of materials.values())m.dispose();for(const s of sources)s.dispose();geometry.dispose();bark.dispose();foliage.dispose();for(const m of maps)m.dispose();}};
}
function draws(root:Group){const result:InstancedMesh[]=[];root.traverse(node=>{if(node instanceof InstancedMesh&&node.visible&&node.count)result.push(node);});return result;}
function ids(mesh:InstancedMesh){return Array.from((mesh.userData.crownfallHlodActorIds as Uint32Array).slice(0,mesh.count));}
function uploads(root:Group){
 const result=new Map<InstancedMesh,{matrixVersion:number;rangeVersion:number;matrix:ArrayLike<number>;range:ArrayLike<number>}>();
 root.traverse(mesh=>{if(mesh instanceof InstancedMesh){const range=mesh.geometry.getAttribute('crownfallLodRange') as InstancedBufferAttribute;
  result.set(mesh,{matrixVersion:mesh.instanceMatrix.version,rangeVersion:range.version,matrix:mesh.instanceMatrix.array,range:range.array});}});
 return result;
}
function unchangedUploads(before:ReturnType<typeof uploads>){
 for(const [mesh,value]of before){const range=mesh.geometry.getAttribute('crownfallLodRange') as InstancedBufferAttribute;
  assert.equal(mesh.instanceMatrix.version,value.matrixVersion,'Unchanged matrix data must not request another GPU upload.');
  assert.equal(range.version,value.rangeVersion,'Unchanged fade data must not request another GPU upload.');
  assert.equal(mesh.instanceMatrix.array,value.matrix);assert.equal(range.array,value.range);
 }
}

test('actual family batches draw near/far actors in independent ready levels and omit off-camera instances',async()=>{
 const f=fixture(),before=f.sources.map(source=>Array.from(source.instanceMatrix.array));
 const cell=createVegetationCellHlod(f.root,{...f.config,actorBatch:{ids:f.ids}});
 try{await cell.preparation;cell.update(1,f.camera,'medium',true);
  assert.deepEqual(cell.stats.levels,[1,0,0,1]);assert.equal(cell.stats.visibleActors,2);assert.equal(cell.stats.culledActors,2);
  const list=draws(f.root);assert.deepEqual(ids(f.sources[0]),[101]);assert.ok(list.some(m=>m.userData.crownfallHlodLevel===3&&ids(m).includes(202)));
  for(const mesh of list){assert.ok(!ids(mesh).includes(303)&&!ids(mesh).includes(404));for(let n=0;n<mesh.count;n++){
   const id=ids(mesh)[n],matrix=new Matrix4();mesh.getMatrixAt(n,matrix);assert.deepEqual(matrix.elements,f.original[f.ids.indexOf(id)].elements);
  }}
  assert.equal(readVegetationSourceTriangles(f.sources[0]),48,'Full source cost remains independent of visual packing.');
  cell.restore();for(let i=0;i<f.sources.length;i++){assert.equal(f.sources[i].count,4);assert.deepEqual(Array.from(f.sources[i].instanceMatrix.array),before[i]);assert.equal(f.sources[i].userData.crownfallHlodActorIds,undefined);}
  cell.update(2,f.camera,'medium',true);
 }finally{cell.dispose();for(let i=0;i<f.sources.length;i++){assert.equal(f.sources[i].count,4);assert.deepEqual(Array.from(f.sources[i].instanceMatrix.array),before[i]);}f.cleanup();}
});

test('pending derivatives retain per-actor L0 fallback and camera turns/teleports refresh buffers without waiting for cell service',async()=>{
 const f=fixture(true),cell=createVegetationCellHlod(f.root,{...f.config,actorBatch:{ids:f.ids}});
 try{cell.update(1,f.camera,'medium',true);assert.deepEqual(ids(f.sources[0]),[101,202]);assert.deepEqual(cell.stats.levels,[2,0,0,0]);
  const storage=f.sources[0].instanceMatrix.array;
  f.camera.lookAt(1000,4,0);f.camera.updateMatrixWorld();cell.update(2,f.camera,'medium',true);assert.ok(ids(f.sources[0]).includes(303));assert.ok(!ids(f.sources[0]).includes(202));
  f.camera.position.set(-1000,4,20);f.camera.lookAt(-1000,4,0);f.camera.updateMatrixWorld();cell.update(3,f.camera,'medium',true);assert.deepEqual(ids(f.sources[0]),[404]);assert.equal(f.sources[0].instanceMatrix.array,storage);
  f.resume();await cell.preparation;cell.update(4,f.camera,'medium',true);assert.deepEqual(cell.stats.levels,[1,0,0,0]);
 }finally{f.resume();await cell.preparation;cell.dispose();f.cleanup();}
});

test('a two-eye union keeps actors seen by either actual camera, with complementary per-actor transitions',async()=>{
 const f=fixture(),right=f.camera.clone();right.lookAt(1000,4,0);right.updateMatrixWorld();
 const views:Camera[]=[f.camera,right],cell=createVegetationCellHlod(f.root,{...f.config,actorBatch:{ids:f.ids,cameras:()=>views}});
 try{await cell.preparation;cell.update(1,f.camera,'medium',true);assert.ok(draws(f.root).some(m=>ids(m).includes(303)));assert.ok(draws(f.root).some(m=>ids(m).includes(202)));
  cell.setCoverage(.4);f.camera.position.z=200;f.camera.updateMatrixWorld();right.position.z=200;right.updateMatrixWorld();
  cell.update(2,f.camera,'medium',false);
  const widths=new Map<number,number>();
  for(const mesh of draws(f.root)){
   if(mesh!==f.sources[0]&&mesh.material===f.sources[1].material)continue;
   // One representative part per level; bark and foliage share the same fade.
   const level=mesh.userData.crownfallHlodLevel;if(draws(f.root).find(m=>m.userData.crownfallHlodLevel===level)!==mesh)continue;
   const range=mesh.geometry.getAttribute('crownfallLodRange');ids(mesh).forEach((id,i)=>widths.set(id,(widths.get(id)??0)+range.getY(i)-range.getX(i)));
  }
  for(const sum of widths.values())assert.ok(Math.abs(sum-.4)<1e-6);
  assert.ok(widths.has(101)&&widths.has(303));
 }finally{cell.dispose();f.cleanup();}
});

test('source frame scale and part transforms preserve source-metres selection and exact L0 matrices',async()=>{
 const f=fixture();f.sourceRoot.position.set(20,7,-30);f.sourceRoot.rotation.y=.3;f.sourceRoot.scale.setScalar(.01);
 f.root.position.set(2,0,3);f.sources.forEach(source=>source.position.set(.3,0,.2));f.sourceRoot.updateMatrixWorld(true);
 const eye=f.sourceRoot.localToWorld(new Vector3(2,4,23)),target=f.sourceRoot.localToWorld(new Vector3(2,4,3));
 f.camera.position.copy(eye);f.camera.lookAt(target);f.camera.near=.001;f.camera.far=2000;f.camera.updateProjectionMatrix();f.camera.updateMatrixWorld();
 const originals=f.sources.map(source=>Array.from(source.instanceMatrix.array));
 const cell=createVegetationCellHlod(f.root,{...f.config,actorBatch:{ids:f.ids}});
 try{await cell.preparation;cell.update(1,f.camera,'medium',true);assert.deepEqual(cell.stats.levels,[1,0,0,1]);
  assert.deepEqual(Array.from(f.sources[0].instanceMatrix.array).slice(0,16),originals[0].slice(0,16));
 }finally{cell.dispose();f.cleanup();}
});

test('opt-in refuses unowned, shadow-casting and non-instanced source inputs before changing source art',()=>{
 const f=fixture();try{
  delete f.sources[0].userData.crownfallOwnedRegionalBatch;
  assert.throws(()=>createVegetationCellHlod(f.root,{...f.config,actorBatch:{ids:f.ids}}),/owned non-shadow/);
  f.sources[0].userData.crownfallOwnedRegionalBatch=true;f.sources[0].castShadow=true;
  assert.throws(()=>createVegetationCellHlod(f.root,{...f.config,actorBatch:{ids:f.ids}}),/owned non-shadow/);
  const root=new Group();root.add(new Mesh(f.sources[0].geometry,f.sources[0].material));
  assert.throws(()=>createVegetationCellHlod(root,{...f.config,actorBatch:{ids:[1]}}),/owned non-shadow/);
 }finally{f.cleanup();}
});

test('L2 retains the correct woody part frame when foliage is the first source part',async()=>{
 const f=fixture();f.root.remove(...f.sources);f.root.add(f.sources[1],f.sources[0]);
 f.sources[0].position.set(.3,.2,.1);f.sources[1].position.set(-.4,0,-.2);
 f.camera.position.z=300;f.camera.lookAt(0,4,0);f.camera.updateMatrixWorld();
 const cell=createVegetationCellHlod(f.root,{...f.config,actorBatch:{ids:f.ids}});
 try{await cell.preparation;cell.update(1,f.camera,'medium',true);
  const wood=draws(f.root).find(mesh=>mesh.userData.crownfallHlodLevel===2&&(mesh.material as MeshStandardMaterial).name==='bark');
  assert.ok(wood);const index=ids(wood).indexOf(101);assert.ok(index>=0);
  const matrix=new Matrix4();wood.getMatrixAt(index,matrix);
  assert.deepEqual(matrix.elements,new Matrix4().makeTranslation(.3,.2,.1).elements.map(Math.fround));
 }finally{cell.dispose();f.cleanup();}
});

test('cancellation restores original matrices, counts, art and metadata before pending derivatives finish',async()=>{
 const f=fixture(true),arrays=f.sources.map(mesh=>Array.from(mesh.instanceMatrix.array)),oldIds=new Uint32Array([77]);
 f.sources[0].userData.crownfallHlodActorIds=oldIds;f.sources[0].userData.crownfallHlodLevel=42;
 const originalGeometry=f.sources[0].geometry,originalMaterial=f.sources[0].material;
 let borrowedDisposals=0;originalGeometry.addEventListener('dispose',()=>borrowedDisposals++);
 originalMaterial.addEventListener('dispose',()=>borrowedDisposals++);
 const cell=createVegetationCellHlod(f.root,{...f.config,actorBatch:{ids:f.ids}});
 f.ids[0]=999;cell.update(1,f.camera,'medium',true);assert.equal(ids(f.sources[0])[0],101,'Actor identity is immutable after construction.');cell.dispose();
 assert.equal(f.sources[0].geometry,originalGeometry);assert.equal(f.sources[0].material,originalMaterial);
 assert.equal(f.sources[0].userData.crownfallHlodActorIds,oldIds);assert.equal(f.sources[0].userData.crownfallHlodLevel,42);
 f.sources.forEach((source,i)=>{assert.equal(source.count,4);assert.deepEqual(Array.from(source.instanceMatrix.array),arrays[i]);});
 f.resume();await cell.preparation;assert.equal(borrowedDisposals,0);f.cleanup();
});

test('complete source bounds retain an offscreen root whose crown crosses the real frustum; all level buffers are reused',async()=>{
 const f=fixture();f.original[0].makeTranslation(12,0,0);for(const source of f.sources)source.setMatrixAt(0,f.original[0]);
 const cell=createVegetationCellHlod(f.root,{...f.config,actorBatch:{ids:f.ids}});
 try{await cell.preparation;const buffers=new Map<InstancedMesh,ArrayLike<number>>();f.root.traverse(node=>{if(node instanceof InstancedMesh)buffers.set(node,node.instanceMatrix.array);});
  cell.update(1,f.camera,'medium',true);assert.ok(draws(f.root).some(mesh=>ids(mesh).includes(101)));
  f.camera.position.z=200;f.camera.lookAt(0,4,0);f.camera.updateMatrixWorld();cell.update(2,f.camera,'medium',true);
  for(const [mesh,buffer]of buffers)assert.equal(mesh.instanceMatrix.array,buffer);
 }finally{cell.dispose();f.cleanup();}
});

test('repeated settled updates preserve every matrix/range version, including fractional coverage',async()=>{
 const f=fixture();f.camera.position.z=85;f.camera.updateMatrixWorld();
 const cell=createVegetationCellHlod(f.root,{...f.config,actorBatch:{ids:f.ids}});
 try{await cell.preparation;cell.setCoverage(.4);cell.update(1,f.camera,'medium',true);
  assert.deepEqual(cell.stats.levels,[1,1,0,1],'The near actor remains in a settled fractional L0/L1 blend.');
  const before=uploads(f.root),arrays=[...before].map(([mesh])=>[Array.from(mesh.instanceMatrix.array),Array.from(mesh.geometry.getAttribute('crownfallLodRange').array)]);
  for(const now of [2,100,1000,10000]){cell.update(now,f.camera,'medium',true);unchangedUploads(before);}
  [...before].forEach(([mesh],i)=>{assert.deepEqual(Array.from(mesh.instanceMatrix.array),arrays[i][0]);assert.deepEqual(Array.from(mesh.geometry.getAttribute('crownfallLodRange').array),arrays[i][1]);});
 }finally{cell.dispose();f.cleanup();}
});

test('eye changes and teleports update only the necessary packed levels while count-only removal needs no upload',async()=>{
 const f=fixture();f.original[0].elements[2]=-0;for(const source of f.sources)source.setMatrixAt(0,f.original[0]);
 const views:Camera[]=[f.camera],cell=createVegetationCellHlod(f.root,{...f.config,actorBatch:{ids:f.ids,cameras:()=>views}});
 try{await cell.preparation;cell.update(1,f.camera,'medium',true);
  const first=uploads(f.root),right=f.camera.clone();right.lookAt(1000,4,0);right.updateMatrixWorld();views.push(right);
  cell.update(2,f.camera,'medium',true);
  assert.equal(f.sources[0].instanceMatrix.version,first.get(f.sources[0])!.matrixVersion,'An unchanged near level needs no upload when only the far set grows.');
  const far=draws(f.root).find(mesh=>mesh.userData.crownfallHlodLevel===3)!;
  assert.deepEqual(ids(far),[202,303]);assert.ok(far.instanceMatrix.version>first.get(far)!.matrixVersion);
  const union=uploads(f.root);views.pop();cell.update(3,f.camera,'medium',true);assert.deepEqual(ids(far),[202]);unchangedUploads(union);
  f.camera.position.set(1000,4,20);f.camera.lookAt(1000,4,0);f.camera.updateMatrixWorld();cell.update(4,f.camera,'medium',true);
  assert.deepEqual(ids(f.sources[0]),[303]);assert.ok(f.sources[0].instanceMatrix.version>union.get(f.sources[0])!.matrixVersion);
  assert.equal(Object.is(f.sources[0].instanceMatrix.array[2],0),true,'Packing preserves the new actor matrix bits, including signed zero.');
  const teleported=uploads(f.root);cell.update(5,f.camera,'medium',true);unchangedUploads(teleported);
 }finally{cell.dispose();f.cleanup();}
});

test('derivative readiness and coverage/fade progress refresh required data, then stop stationary uploads',async()=>{
 const f=fixture(true),cell=createVegetationCellHlod(f.root,{...f.config,actorBatch:{ids:f.ids}});
 try{cell.update(1,f.camera,'medium',true);const pending=uploads(f.root);cell.update(2,f.camera,'medium',true);unchangedUploads(pending);
  f.resume();await cell.preparation;cell.update(3,f.camera,'medium',true);assert.deepEqual(cell.stats.levels,[1,0,0,1]);
  const ready=uploads(f.root);cell.setCoverage(.4);cell.update(4,f.camera,'medium',true);
  for(const mesh of draws(f.root)){const before=ready.get(mesh)!;assert.equal(mesh.instanceMatrix.version,before.matrixVersion);
   assert.ok((mesh.geometry.getAttribute('crownfallLodRange') as InstancedBufferAttribute).version>before.rangeVersion);}
  const covered=uploads(f.root);cell.update(5,f.camera,'medium',true);unchangedUploads(covered);
  f.camera.position.z=200;f.camera.updateMatrixWorld();cell.update(6,f.camera,'medium',false);assert.equal(cell.stats.transitioning,true);
  const moving=uploads(f.root);cell.update(56,f.camera,'medium',false);
  let fadeChanged=false;for(const [mesh,before]of moving){assert.equal(mesh.instanceMatrix.version,before.matrixVersion);
   fadeChanged ||= (mesh.geometry.getAttribute('crownfallLodRange') as InstancedBufferAttribute).version>before.rangeVersion;}
  assert.equal(fadeChanged,true,'Time must continue an existing fade even when the camera stops.');
  for(let now=106;now<=1006;now+=50)cell.update(now,f.camera,'medium',false);
  assert.equal(cell.stats.transitioning,false);const settled=uploads(f.root);cell.update(2006,f.camera,'medium',false);unchangedUploads(settled);
 }finally{f.resume();await cell.preparation;cell.dispose();f.cleanup();}
});

test('quality and source/root frame changes are evaluated even when previous level buffers were clean',async()=>{
 const f=fixture();f.camera.position.z=95;f.camera.updateMatrixWorld();
 const cell=createVegetationCellHlod(f.root,{...f.config,actorBatch:{ids:f.ids}});
 try{await cell.preparation;cell.update(1,f.camera,'medium',true);assert.equal(cell.stats.levels[1],1);
  f.root.position.x=1000;cell.update(2,f.camera,'high',true);assert.deepEqual(ids(f.sources[0]),[404]);
  const selected=uploads(f.root);f.sourceRoot.scale.setScalar(.01);f.camera.position.multiplyScalar(.01);f.camera.near=.001;
  f.camera.updateProjectionMatrix();f.camera.updateMatrixWorld();cell.update(3,f.camera,'high',true);assert.deepEqual(ids(f.sources[0]),[404]);unchangedUploads(selected);
  cell.update(4,f.camera,'medium',true);assert.equal(f.sources[0].count,0);
  assert.ok(draws(f.root).some(mesh=>mesh.userData.crownfallHlodLevel===1&&ids(mesh).includes(404)));
 }finally{cell.dispose();f.cleanup();}
});

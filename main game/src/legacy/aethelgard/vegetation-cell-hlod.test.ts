import assert from 'node:assert/strict';
import test from 'node:test';
import {BoxGeometry, DataTexture, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene,
  type WebGLRenderer} from 'three';
import {createVegetationCellHlod, readVegetationSourceTriangles, readAuthoredVegetationGeometry, readAuthoredVegetationMaterial} from './vegetation-cell-hlod';
import {createVegetationPrototypeResources, type VegetationPrototypeResources} from './vegetation-prototype';
import {createWorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {VegetationPreparationWorker} from './vegetation-worker';
import {buildPackedVegetationGeometry} from '../../../../shared/legacy/aethelgard/environment/vegetation-packed-geometry';
import type {VegetationSimplifier} from '../../../../shared/legacy/aethelgard/environment/vegetation-simplify';

test('near source trees remain drawable while derived geometry is pending, including a failed preparation', async () => {
 const geometry=new BoxGeometry(2,8,2);geometry.clearGroups();const material=new MeshStandardMaterial({side:DoubleSide});
 const source=new InstancedMesh(geometry,material,2);source.setMatrixAt(0,new Matrix4());source.setMatrixAt(1,new Matrix4().makeTranslation(8,0,0));
 const root=new Group();root.add(source);let reject!: (cause:Error)=>void;
 const resources={geometry:()=>({ready:new Promise((_resolve,fail)=>{reject=fail;}),release(){}})} as unknown as VegetationPrototypeResources;
 const camera=new PerspectiveCamera(60,1,.1,2000);camera.position.set(0,90,90);camera.updateMatrixWorld();
 const cell=createVegetationCellHlod(root,{resources,renderer:{} as WebGLRenderer,scene:new Scene(),camera,tileSize:64,signal:new AbortController().signal,changed(){}});
 try{
  cell.update(1,camera,'low',true);assert.equal(cell.stats.readyMask,1);assert.deepEqual(cell.stats.levels,[2,0,0,0]);
  assert.equal(source.visible,true);assert.equal(source.geometry.drawRange.count,Infinity);assert.equal(cell.triangleCost,24);
  reject(Error('preparation unavailable'));await cell.preparation;cell.update(2,camera,'low',true);
  assert.equal(cell.stats.status,'error');assert.deepEqual(cell.stats.levels,[2,0,0,0]);assert.equal(source.geometry.drawRange.count,Infinity);
 }finally{cell.dispose();source.dispose();geometry.dispose();material.dispose();}
});

test('authored single/instanced cells keep exact transforms, PBR sources and independent shadows across all levels', async () => {
  const geometry = new BoxGeometry(2, 8, 2), material = new MeshStandardMaterial({side: DoubleSide, alphaTest: .35, roughness: .8});
  geometry.clearGroups();
  let borrowedDisposed = 0; geometry.addEventListener('dispose', () => borrowedDisposed++); material.addEventListener('dispose', () => borrowedDisposed++);
  const maps = [new DataTexture(), new DataTexture()] as const;
  const sharedMaterials = new Map<string, MeshStandardMaterial>();
  const resources = {
    material: (key: string, build: () => MeshStandardMaterial) => {if (!sharedMaterials.has(key)) sharedMaterials.set(key, build());
      return {ready: Promise.resolve({material: sharedMaterials.get(key)!}), release() {}};},
    geometry: () => ({ready: Promise.resolve({geometry, sourceTriangles: 12, triangles: 12}), release() {}}),
    atlas: (_parts: unknown, _tile: unknown, views: 8 | 16) => ({ready: Promise.resolve({bytes: 1, maps,
      record: {views, columns: 4, rows: views / 4, tileSize: 64, centre: [0, 0, 0], extent: [2, 8],
        mips: [{width: 256, height: 64 * views / 4}], coverage: Array(views).fill(.5)}}), release() {}}),
    compile: () => ({ready: Promise.resolve({}), release() {}}),
  } as unknown as VegetationPrototypeResources;
  for (const instanced of [false, true]) {
    const root = new Group(); root.position.set(20, 3, -10); root.scale.set(2, 1.5, 2); root.rotation.y = .4;
    const source = instanced ? new InstancedMesh(geometry, material, 2) : new Mesh(geometry, material);
    if (source instanceof InstancedMesh) for (let i = 0; i < 2; i++) source.setMatrixAt(i, new Matrix4().makeTranslation(i * 5, 0, 0));
    const matrices = source instanceof InstancedMesh ? Array.from(source.instanceMatrix.array) : null;
    source.position.set(1, .2, 1); root.add(source); root.updateMatrixWorld(true); const frame = source.matrixWorld.clone();
    const cell = createVegetationCellHlod(root, {resources, renderer: {} as WebGLRenderer, scene: new Scene(), camera: new PerspectiveCamera(),
      signal: new AbortController().signal, changed() {}, tileSize: 64});
    await cell.preparation; assert.equal(cell.stats.readyMask, 15); assert.equal(cell.stats.status, 'ready');
    const camera = new PerspectiveCamera(60, 1, .1, 2000); camera.position.set(20, 3, 1800); camera.updateMatrixWorld();
    cell.update(1, camera, 'medium', true); assert.equal(cell.stats.levels[3], instanced ? 2 : 1);
    assert.equal(source.geometry.drawRange.count, 0, 'fully faded L0 skips its colour geometry without hiding a shared material');
    assert.equal(source.material.visible, true); assert.equal(geometry.drawRange.count, Infinity, 'borrowed source draw range stays unchanged');
    cell.setCoverage(.35);cell.update(1.1,camera,'medium',true);
    root.traverse(node=>{if(node instanceof Mesh){const range=node.geometry.getAttribute('crownfallLodRange');if(range)assert.ok(range.getY(0)<=.350001,'all four derived levels stay inside their outer source handoff domain');}});
    cell.setCoverage(0);cell.update(1.2,camera,'medium',true);assert.deepEqual(cell.stats.levels,[0,0,0,0]);
    assert.throws(()=>cell.setCoverage(-.1),/coverage/);assert.throws(()=>cell.setCoverage(NaN),/coverage/);
    cell.setCoverage(1);cell.update(1.3,camera,'medium',true);
    assert.equal(readVegetationSourceTriangles(source), instanced ? 24 : 12, 'shadow budgets retain the full source cost');
    assert.equal(readAuthoredVegetationMaterial(source),material,'Added grass must borrow the source PBR rather than an HLOD fade clone');
    assert.equal(readAuthoredVegetationGeometry(source), geometry, 'visual fading does not replace the authored collision/navigation source');
    source.castShadow = true; cell.update(2, camera, 'medium', true); assert.equal(source.geometry.drawRange.count, Infinity, 'near shadow ownership remains independent of colour LOD');
    assert.ok(source.matrixWorld.equals(frame)); assert.equal(source.geometry.getAttribute('position'), geometry.getAttribute('position'));
    if (source instanceof InstancedMesh) assert.deepEqual(Array.from(source.instanceMatrix.array), matrices);
    cell.restore(); assert.equal(source.geometry.drawRange.count, Infinity); cell.dispose(); await cell.preparation;
    assert.equal(source.material, material); assert.equal(source.geometry, geometry); assert.equal(borrowedDisposed, 0); assert.equal(root.children.length, 1);
    if (source instanceof InstancedMesh) source.dispose();
  }
  const elevatedRoot=new Group(),elevatedSource=new InstancedMesh(geometry,material,1);elevatedSource.setMatrixAt(0,new Matrix4());elevatedRoot.add(elevatedSource);
  const elevatedCamera=new PerspectiveCamera(60,1,.1,2000);elevatedCamera.position.set(0,250,0);elevatedCamera.lookAt(0,0,0);elevatedCamera.updateMatrixWorld();
  const elevated=createVegetationCellHlod(elevatedRoot,{resources,renderer:{} as WebGLRenderer,scene:new Scene(),camera:elevatedCamera,signal:new AbortController().signal,changed(){},tileSize:64,solidOverhead:true});
  await elevated.preparation;elevated.update(1,elevatedCamera,'low',true);assert.equal(elevated.stats.readyMask,15);assert.deepEqual(elevated.stats.levels,[0,1,0,0],'Ready near cells keep simplified 3D crowns from above rather than collapsing back to upright cards');elevated.dispose();elevatedSource.dispose();
  const meshRoot = new Mesh(geometry, material); meshRoot.visible = false;
  const cell = createVegetationCellHlod(meshRoot, {resources, renderer: {} as WebGLRenderer, scene: new Scene(), camera: new PerspectiveCamera(),
    signal: new AbortController().signal, changed() {}, tileSize: 64});
  assert.equal(cell.triangleCost, 12, 'a root culled last frame must retain its real admission cost');
  await cell.preparation; cell.dispose();
  const centimetreGeometry = new BoxGeometry(200, 800, 200); centimetreGeometry.clearGroups();
  const sourceRoot = new Group(), centimetreTree = new Mesh(centimetreGeometry, material); centimetreTree.scale.setScalar(.01); sourceRoot.add(centimetreTree);
  const scaled = createVegetationCellHlod(centimetreTree, {resources, renderer: {} as WebGLRenderer, scene: new Scene(), camera: new PerspectiveCamera(),
    signal: new AbortController().signal, changed() {}, tileSize: 64, sourceRoot});
  await scaled.preparation; const observer = new PerspectiveCamera(60, 1, .1, 2000); observer.position.z = 50; observer.updateMatrixWorld();
  scaled.update(0, observer, 'medium', true); assert.equal(scaled.stats.levels[0], 1, 'centimetre source-node scale must not turn a 50m tree into a far impostor');
  centimetreTree.scale.set(.01, .03, .01); scaled.update(1, observer, 'medium', true);
  assert.equal(scaled.stats.levels[0], 1, 'vertical stretch must not multiply horizontal observer distance');
  scaled.dispose(); centimetreGeometry.dispose();
  sharedMaterials.forEach(material => material.dispose()); maps.forEach(map => map.dispose()); geometry.dispose(); material.dispose();
});

test('source geometry preparation is shared, compacted and released without disposing borrowed attributes', async () => {
  const queue = createWorldPreparationQueue(() => {}), source = new BoxGeometry(2, 8, 2), material = new MeshStandardMaterial();
  let calls = 0, sourceDisposals = 0; source.addEventListener('dispose', () => sourceDisposals++);
  const worker = {simplify: async () => {throw Error('unused');}, packed: async input => {
    calls++; const result = await buildPackedVegetationGeometry(input, {ready: Promise.resolve(), simplifyWithAttributes: indices => [indices, 0]} as VegetationSimplifier);
    structuredClone(input, {transfer: [input.positions.buffer, input.attributes.buffer, input.indices.buffer]}); return result;},
    foliageNormals: async () => {throw Error('unused');}, ground: async () => {throw Error('unused');}, mips: async () => {throw Error('unused');}, dispose() {}} as VegetationPreparationWorker;
  const gl = {COPY_WRITE_BUFFER: 1, COPY_WRITE_BUFFER_BINDING: 2, STATIC_DRAW: 3, FLOAT: 4, UNSIGNED_SHORT: 5, UNSIGNED_INT: 6,
    VERTEX_ARRAY_BINDING: 7, ELEMENT_ARRAY_BUFFER: 8, createVertexArray: () => ({}), bindVertexArray() {}, deleteVertexArray() {},
    createBuffer: () => ({}), deleteBuffer() {}, getParameter() {return null;}, bindBuffer() {}, bufferData() {}, bufferSubData() {}};
  const resources = createVegetationPrototypeResources({getContext: () => gl} as unknown as WebGLRenderer, queue, worker, 1024 * 1024);
  const part = {geometry: source, material, frame: new Matrix4(), foliage: false}, first = resources.geometry(part);
  const second = resources.geometry({...part, frame: new Matrix4().makeTranslation(1e-14, 0, 0)});
  let done = false; const pending = Promise.all([first.ready, second.ready]).then(result => {done = true; return result;});
  for (let i = 0; i < 80 && !done; i++) {queue.step(); await new Promise(resolve => setTimeout(resolve, 0));}
  const [a, b] = await pending; assert.equal(a, b); assert.equal(calls, 1);
  assert.equal(a.sourceTriangles, 12, 'transfer detachment must not erase source diagnostics');
  assert.equal(a.geometry.getAttribute('position').count, 24); assert.notEqual(a.geometry.getAttribute('position'), source.getAttribute('position'));
  const l2 = resources.geometry(part, 'l2-branches'); let l2Done = false;
  const l2Pending = l2.ready.then(value => {l2Done = true; return value;});
  for (let i = 0; i < 80 && !l2Done; i++) {queue.step(); await new Promise(resolve => setTimeout(resolve, 0));}
  const branch = await l2Pending; assert.notEqual(branch, a, 'a versioned L2 derivative must not restore the cached L1 geometry'); assert.equal(calls, 2);
  assert.equal(branch.error, 0); assert.throws(() => resources.geometry({...part, foliage: true}, 'l2-branches'), /nonfoliage/);
  l2.release(); resources.trim(); assert.equal(resources.stats.entries, 1);
  first.release(); resources.trim(); assert.equal(resources.stats.entries, 1);
  second.release(); resources.trim(); assert.equal(resources.stats.entries, 0); assert.equal(sourceDisposals, 0);
  resources.dispose(); queue.dispose(); source.dispose(); material.dispose();
});

test('MASK bark stays 3D at L2; a cutout flag alone never classifies the trunk as canopy',async()=>{
 const bark=new MeshStandardMaterial({alphaTest:.5}),leaf=new MeshStandardMaterial({alphaTest:.5,side:DoubleSide});
 bark.name='MASK bark';leaf.name='leaves';const barkGeometry=new BoxGeometry(1,8,1).translate(0,4,0),leafGeometry=new BoxGeometry(6,6,6).translate(0,8,0);
 barkGeometry.clearGroups();leafGeometry.clearGroups();const root=new Group();root.position.z=-250;root.add(new Mesh(barkGeometry,bark),new Mesh(leafGeometry,leaf));
 const maps=[new DataTexture(),new DataTexture()] as const,materials:MeshStandardMaterial[]=[],captures:boolean[][]=[];
 const resources={material:(_key:string,build:()=>MeshStandardMaterial)=>{const material=build();materials.push(material);return{ready:Promise.resolve({material}),release(){}};},
  geometry:(part:{geometry:BoxGeometry})=>({ready:Promise.resolve({geometry:part.geometry,sourceTriangles:12,triangles:12}),release(){}}),
  compile:()=>({ready:Promise.resolve({}),release(){}}),atlas:(parts:{foliage:boolean}[],_tile:number,views:number)=>{captures.push(parts.map(p=>p.foliage));return{ready:Promise.resolve({bytes:1,maps,record:{views,columns:4,rows:views/4,tileSize:64,centre:[0,5,0],extent:[8,12],mips:[{width:256,height:64*views/4}],coverage:Array(views).fill(.5)}}),release(){}};},
 } as unknown as VegetationPrototypeResources;
 const camera=new PerspectiveCamera(60,1,.1,2000);camera.updateMatrixWorld();
 const cell=createVegetationCellHlod(root,{resources,renderer:{} as WebGLRenderer,scene:new Scene(),camera,tileSize:64,signal:new AbortController().signal,changed(){}});
 try{await cell.preparation;assert.equal(cell.stats.readyMask,15);assert.deepEqual(captures[0],[false,true]);
  assert.equal(root.children[0].userData.crownfallVegetationWind,undefined,'Wood remains static even when its material is alpha-masked');
  assert.deepEqual(root.children[1].userData.crownfallVegetationWind.root,[0,0,0],'Canopy bending is anchored at the complete actor root, not the leaf geometry base');
  cell.update(0,camera,'medium',true);assert.equal(cell.stats.levels[2],1);
  const shown=root.getObjectByName('Authored cell source HLOD')!.children.filter(o=>o.visible) as Mesh[];
  assert.equal(shown.length,2,'L2 draws its real branch geometry and its canopy card');
  assert.deepEqual(shown.find(mesh=>mesh.userData.crownfallVegetationWind)?.userData.crownfallVegetationWind.root,[0,0,0],'The captured LOD retains the same actor root as its detailed foliage');
  assert.ok(shown.some(m=>m.geometry.getAttribute('position').count===barkGeometry.getAttribute('position').count));
 }finally{cell.dispose();maps.forEach(m=>m.dispose());materials.forEach(m=>m.dispose());barkGeometry.dispose();leafGeometry.dispose();bark.dispose();leaf.dispose();}
});

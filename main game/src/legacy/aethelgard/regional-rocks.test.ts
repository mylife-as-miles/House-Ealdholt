import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {BoxGeometry,Group,PerspectiveCamera,Mesh,Vector2} from 'three';
import {createRegionalRocks} from './regional-rocks';
import type {RegionalWorldLayout} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';

async function scan(detail:'near'|'far'){
 const file='rocks-'+(detail==='near'?'desktop':'far')+'.glb';
 const bytes=await readFile(process.env.CROWNFALL_REGIONAL_ROCK_SOURCE_DIR?resolve(process.env.CROWNFALL_REGIONAL_ROCK_SOURCE_DIR,file):new URL('../../../public/assets/legacy/environment/aethelgard/namaqualand-rocks-v1/'+file,import.meta.url));
 const length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length).toString()),bin=bytes.subarray(28+length);
 json.images=[];json.textures=[];json.materials=[];for(const mesh of json.meshes)for(const primitive of mesh.primitives)delete primitive.material;
 const raw=Buffer.from(JSON.stringify(json)),padded=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),out=Buffer.alloc(28+padded.length+bin.length);
 out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(padded.length,12);out.writeUInt32LE(0x4e4f534a,16);padded.copy(out,20);out.writeUInt32LE(bin.length,20+padded.length);out.writeUInt32LE(0x004e4942,24+padded.length);bin.copy(out,28+padded.length);
 return(await new GLTFLoader().parseAsync(out.buffer.slice(out.byteOffset,out.byteOffset+out.byteLength),'')).scene;
}
test('actual Namaqualand scans keep their placement through LOD changes and cull without disposing loader resources',async()=>{
 const models={near:await scan('near'),far:await scan('far')},root=new Group(),camera=new PerspectiveCamera(60,1,.1,10000),abort=new AbortController();let disposals=0;
 for(const template of Object.values(models))template.traverse(node=>{if(node instanceof Mesh)node.geometry.addEventListener('dispose',()=>disposals++);});
 const rocks=createRegionalRocks({sourceRoot:root,camera,signal:abort.signal,load:async detail=>models[detail],changed(){}});root.add(rocks.object);
 const layout:RegionalWorldLayout={version:'test',treeCount:0,shrubCount:0,placements:new Float32Array(),rocks:new Float32Array([0,0,0,.7,1,0]),cells:[],landmarks:[],species:[],attempts:0,rejected:{}};
 await new Promise(resolve=>setImmediate(resolve));
 const view=(z:number,now:number,away=false)=>{camera.position.set(0,3,z);camera.lookAt(0,0,away?z+100:0);camera.updateMatrixWorld(true);rocks.update(layout,camera,now,'low');};
 view(10,0);assert.equal(rocks.stats.status,'ready');assert.equal(rocks.stats.near,1);assert.equal(rocks.stats.far,0);
 const before=rocks.object.children.find(node=>node instanceof Mesh&&node.name.endsWith(':near')) as Mesh;const matrix=Array.from((before as any).instanceMatrix.array).slice(0,16);
 view(200,200);assert.equal(rocks.stats.far,1);const after=rocks.object.children.find(node=>node instanceof Mesh&&node.name.endsWith(':far')) as Mesh;assert.deepEqual(Array.from((after as any).instanceMatrix.array).slice(0,16),matrix);
 view(5000,400);assert.equal(rocks.stats.visible,0);view(10,600,true);assert.equal(rocks.stats.visible,0);view(10,800);assert.equal(rocks.stats.visible,1);
 rocks.dispose();assert.equal(disposals,0);assert.equal(root.children.length,0);
});

test('actual resident scan LODs reduce tiny-rock submitted triangles without moving its contact transform',async()=>{
 const models={near:await scan('near'),far:await scan('far')},root=new Group(),camera=new PerspectiveCamera(60,1.6,.1,10000),abort=new AbortController();
 const rocks=createRegionalRocks({sourceRoot:root,camera,signal:abort.signal,renderer:{getDrawingBufferSize(target:Vector2){return target.set(480,300);}},load:async detail=>models[detail],changed(){}});root.add(rocks.object);
 const points=Float32Array.from([0,-.03,0,.7,.25,0]),before=points.slice(),layout:RegionalWorldLayout={version:'test',treeCount:0,shrubCount:0,placements:new Float32Array(),rocks:points,cells:[],landmarks:[],species:[],attempts:0,rejected:{}};
 await new Promise(resolve=>setImmediate(resolve));let clock=0;
 const view=(distance:number)=>{camera.position.set(0,1,distance);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);rocks.update(layout,camera,clock+=200,'low');};
 try{view(50);assert.equal(rocks.stats.far,1);assert.equal(rocks.stats.triangles,948,'Use the measured far file, not its unmet280-triangle generation target.');
  const far=rocks.object.children.find(node=>node.name==='namaqualand_boulder_02:far') as Mesh;const matrix=Array.from((far as any).instanceMatrix.array).slice(0,16);
  view(10);assert.equal(rocks.stats.near,1);assert.equal(rocks.stats.triangles,1800);const near=rocks.object.children.find(node=>node.name==='namaqualand_boulder_02:near') as Mesh;
  assert.deepEqual(Array.from((near as any).instanceMatrix.array).slice(0,16),matrix);assert.deepEqual(points,before);view(50);assert.equal(rocks.stats.far,1);assert.equal(rocks.stats.triangles,948);
 }finally{rocks.dispose();}
});
test('a still camera re-uploads no rock instances; a moved camera uploads only what changed (L-14)',async()=>{
 const template=(detail:string)=>{const root=new Group();for(const id of ['namaqualand_boulder_02','namaqualand_boulder_04','namaqualand_boulder_06']){const node=new Group();node.name=id;node.add(new Mesh(new BoxGeometry(1,1,1)));root.add(node);}root.name=detail;return root;};
 const models={near:template('near'),far:template('far')},root=new Group(),camera=new PerspectiveCamera(60,1,.1,10000),abort=new AbortController();
 const rocks=createRegionalRocks({sourceRoot:root,camera,signal:abort.signal,load:async detail=>models[detail],changed(){}});root.add(rocks.object);
 const rocksData:number[]=[];for(let i=0;i<60;i++)rocksData.push((i%10)*6-27,0,Math.floor(i/10)*6-15,i*.3,1,i%3);
 const layout:RegionalWorldLayout={version:'test',treeCount:0,shrubCount:0,placements:new Float32Array(),rocks:new Float32Array(rocksData),cells:[],landmarks:[],species:[],attempts:0,rejected:{}};
 await new Promise(resolve=>setImmediate(resolve));
 const view=(x:number,now:number)=>{camera.position.set(x,40,60);camera.lookAt(x,0,0);camera.updateMatrixWorld(true);rocks.update(layout,camera,now,'high');};
 view(0,0);assert.equal(rocks.stats.status,'ready');assert.ok(rocks.stats.visible>0);const first=rocks.stats.instanceFloatsQueued;assert.ok(first>0);
 for(let tick=1;tick<=10;tick++)view(0,tick*200);
 assert.equal(rocks.stats.instanceFloatsQueued,first,'ten service ticks with a still camera queue no upload');
 view(30,3000);assert.ok(rocks.stats.instanceFloatsQueued>first,'a moved camera that changes the visible set uploads again');
 abort.abort();
});

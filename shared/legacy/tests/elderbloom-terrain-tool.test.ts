import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bakeElderbloomTerrain } from '../../../scripts/bake-elderbloom-terrain';

function fixture() {
  const binary=Buffer.alloc(72);
  [0,0,0,1,0,0,0,0,1,0,1,0,0,1,0,0,1,0].forEach((n,i)=>binary.writeFloatLE(n,i*4));
  const primitive={attributes:{POSITION:0,NORMAL:1},material:0};
  const gltf={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,1]}],nodes:[{mesh:0},{mesh:1}],
    buffers:[{byteLength:72}],bufferViews:[{buffer:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:36}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'},{bufferView:1,componentType:5126,count:3,type:'VEC3'}],
    materials:[{name:'LAndscapepaint',pbrMetallicRoughness:{baseColorFactor:[0,0,0,1]}},{name:'Existing_PavedPath',pbrMetallicRoughness:{baseColorFactor:[0.3,0.3,0.3,1]}}],
    meshes:[{name:'LandscapeComponent_0',primitives:[primitive]},{name:'PavedPath',primitives:[{...primitive,material:1}]}]};
  let json=JSON.stringify(gltf);json+=' '.repeat((4-Buffer.byteLength(json)%4)%4);
  const bytes=Buffer.alloc(28+Buffer.byteLength(json)+binary.length);
  bytes.writeUInt32LE(0x46546c67,0);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);
  bytes.writeUInt32LE(Buffer.byteLength(json),12);bytes.writeUInt32LE(0x4e4f534a,16);bytes.write(json,20);
  const at=20+Buffer.byteLength(json);bytes.writeUInt32LE(binary.length,at);bytes.writeUInt32LE(0x004e4942,at+4);binary.copy(bytes,at+8);
  return {bytes,gltf,binary};
}

test('actual GLB terrain pass appends colour without touching original bytes or path material', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'crownfall-terrain-'));
  try {
    const source=fixture(),input=join(dir,'crop.glb'),output=join(dir,'ground.glb');
    await writeFile(input,source.bytes);
    const report=await bakeElderbloomTerrain(input,output),result=await readFile(output);
    const jsonBytes=result.readUInt32LE(12),json=JSON.parse(result.subarray(20,20+jsonBytes).toString('utf8'));
    assert.equal(report.terrainVertices,3);assert.equal(report.terrainPrimitives,1);
    assert.deepEqual(await readFile(input),source.bytes);
    assert.deepEqual(json.meshes[1],source.gltf.meshes[1]);
    assert.deepEqual(json.materials[1],source.gltf.materials[1]);
    assert.equal(json.meshes[0].primitives[0].attributes.COLOR_0,2);
    assert.deepEqual(json.materials[2].pbrMetallicRoughness.baseColorFactor,[1,1,1,1]);
    const binaryStart=28+jsonBytes;
    assert.deepEqual(result.subarray(binaryStart,binaryStart+source.binary.length),source.binary);
    await assert.rejects(bakeElderbloomTerrain(output,join(dir,'rebake.glb')),/existing surface treatment/);
    await assert.rejects(bakeElderbloomTerrain(input,input),/separate output/);
    await assert.rejects(bakeElderbloomTerrain(input,output),/EEXIST/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

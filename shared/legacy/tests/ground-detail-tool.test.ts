import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bakeElderbloomGroundDetail } from '../../../scripts/bake-elderbloom-ground-detail';

function fixture() {
  const positions=Float32Array.from([0,0,0,0,0,1,1,0,0, 0,0,0,0,1,0,0,0,1, 0,0,0,1,0,0,0,1,0]);
  const normals=Float32Array.from([0,1,0,0,1,0,0,1,0, 1,0,0,1,0,0,1,0,0, 0,0,1,0,0,1,0,0,1]);
  const uv0=new Float32Array(18),uv1=new Float32Array(18),indices=Uint32Array.from([0,1,2,3,4,5,6,7,8]);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  const buffers=[Buffer.from(positions.buffer),Buffer.from(normals.buffer),Buffer.from(uv0.buffer),Buffer.from(uv1.buffer),Buffer.from(indices.buffer),png];
  let offset=0;const views=buffers.map((b,i)=>{const view={buffer:0,byteOffset:offset,byteLength:b.length,...(i<5?{target:i===4?34963:34962}:{})};offset+=b.length;return view;});
  const binary=Buffer.concat([...buffers,Buffer.alloc((4-offset%4)%4)]);
  const primitive={attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2,TEXCOORD_1:3},indices:4,material:0};
  const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,1]}],nodes:[{mesh:0,translation:[8,2,12]},{mesh:1}],buffers:[{byteLength:binary.length}],bufferViews:views,
    accessors:[{bufferView:0,componentType:5126,count:9,type:'VEC3'},{bufferView:1,componentType:5126,count:9,type:'VEC3'},
      {bufferView:2,componentType:5126,count:9,type:'VEC2'},{bufferView:3,componentType:5126,count:9,type:'VEC2'},{bufferView:4,componentType:5125,count:9,type:'SCALAR'}],
    materials:[{name:'Crownfall_LAAS_BakedGround_Review',pbrMetallicRoughness:{baseColorTexture:{index:0,texCoord:1},metallicFactor:0,roughnessFactor:.94},extras:{crownfallTerrainRepair:'test generated atlas'}},{name:'ExistingStone',pbrMetallicRoughness:{baseColorFactor:[.4,.4,.4,1]}}],
    samplers:[],textures:[{source:0}],images:[{bufferView:5,mimeType:'image/png'}],
    meshes:[{name:'LandscapeComponent_0',primitives:[primitive]},{name:'ExistingWall',primitives:[{...primitive,material:1}]}]};
  let text=Buffer.from(JSON.stringify(json));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,0x20)]);
  const bytes=Buffer.alloc(28+text.length+binary.length);
  bytes.writeUInt32LE(0x46546c67,0);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(text.length,12);bytes.writeUInt32LE(0x4e4f534a,16);text.copy(bytes,20);
  const at=20+text.length;bytes.writeUInt32LE(binary.length,at);bytes.writeUInt32LE(0x004e4942,at+4);binary.copy(bytes,at+8);
  return {bytes,json,binary};
}

test('ground detail preserves source and architecture while projecting vertical rock without XZ collapse',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'crownfall-ground-detail-'));
  try {
    const input=join(directory,'input.glb'),output=join(directory,'detail.glb'),source=fixture();await writeFile(input,source.bytes);
    const report=await bakeElderbloomGroundDetail(input,output),result=await readFile(output),length=result.readUInt32LE(12);
    const json=JSON.parse(result.subarray(20,20+length).toString('utf8')),binary=result.subarray(28+length);
    assert.deepEqual(await readFile(input),source.bytes);
    assert.deepEqual(binary.subarray(0,source.binary.length),source.binary);
    assert.deepEqual(json.materials.slice(0,2),source.json.materials);
    assert.deepEqual(json.meshes[1],source.json.meshes[1]);
    assert.deepEqual(report.trianglesByAxis,{x:1,y:1,z:1});assert.equal(report.terrainTriangles,3);assert.equal(report.uvChannel,2);
    const sortedIndices=[];
    for(const primitive of json.meshes[0].primitives){
      for(const [attribute,index] of Object.entries(source.json.meshes[0].primitives[0].attributes))assert.equal(primitive.attributes[attribute],index);
      const a=json.accessors[primitive.indices],v=json.bufferViews[a.bufferView];
      for(let i=0;i<a.count;i++)sortedIndices.push(binary.readUInt32LE(v.byteOffset+i*4));
      const material=json.materials[primitive.material],uvAccessor=json.accessors[primitive.attributes.TEXCOORD_2];
      assert.equal(material.normalTexture.texCoord,2);assert.equal(material.pbrMetallicRoughness.metallicRoughnessTexture.texCoord,2);
      assert.equal(uvAccessor.count,9);assert.deepEqual(material.pbrMetallicRoughness.baseColorTexture,{index:0,texCoord:1});
    }
    assert.deepEqual(sortedIndices.sort((a,b)=>a-b),[0,1,2,3,4,5,6,7,8]);
    const xPrimitive=json.meshes[0].primitives[0],uv=json.accessors[xPrimitive.attributes.TEXCOORD_2],view=json.bufferViews[uv.bufferView];
    // X-facing triangles receive Z/Y coordinates. Their vertical1m edge must
    // span a nonzero UV distance rather than collapsing under XZ projection.
    assert.ok(Math.abs(binary.readFloatLE(view.byteOffset+4*8+4)-binary.readFloatLE(view.byteOffset+3*8+4))>.1);
    assert.ok(report.addedGpuBufferAndTextureBytesEstimate<6*1024*1024);
    await assert.rejects(bakeElderbloomGroundDetail(input,input),/separate output/);
    await assert.rejects(bakeElderbloomGroundDetail(input,output),/EEXIST/);
    await assert.rejects(bakeElderbloomGroundDetail(output,join(directory,'rebaked.glb')),/already has detail maps/);
  } finally {await rm(directory,{recursive:true,force:true});}
});

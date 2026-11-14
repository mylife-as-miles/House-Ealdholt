import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { resizeElderbloomGroundAtlas } from './resize-elderbloom-ground-atlas.mjs';

function glb(json,binary) {
  let text=Buffer.from(JSON.stringify(json));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);
  const b=Buffer.alloc(28+text.length+binary.length),at=20+text.length;
  b.writeUInt32LE(0x46546c67,0);b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);
  b.writeUInt32LE(text.length,12);b.writeUInt32LE(0x4e4f534a,16);text.copy(b,20);
  b.writeUInt32LE(binary.length,at);b.writeUInt32LE(0x004e4942,at+4);binary.copy(b,at+8);return b;
}
function parse(b){const at=20+b.readUInt32LE(12);return {json:JSON.parse(b.subarray(20,at).toString()),binary:b.subarray(at+8)};}
test('private atlas resize preserves every original geometry byte and unrelated metadata; refuses overwrite and unknown atlas',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ealdholt-atlas-'));
  try {
    const png=await sharp({create:{width:2048,height:2048,channels:4,background:'#635a42'}}).png().toBuffer();
    const geometry=Buffer.from(Array.from({length:64},(_,i)=>i*3)),binary=Buffer.concat([geometry,png,Buffer.alloc((4-png.length%4)%4)]);
    const json={buffers:[{byteLength:binary.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:geometry.length,target:34962},{buffer:0,byteOffset:geometry.length,byteLength:png.length}],
      images:[{name:'Crownfall_AethelgardGroundAtlas',mimeType:'image/png',bufferView:1}],textures:[{source:0}],
      materials:[{name:'Crownfall_LAAS_BakedGround_Review',pbrMetallicRoughness:{baseColorTexture:{index:0,texCoord:1}},extras:{crownfallTerrainRepair:'fixture'}}],
      nodes:[{matrix:[1,0,0,0,0,1,0,0,0,0,1,0,3,5,7,1]}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],accessors:[{bufferView:0,componentType:5126,count:4,type:'VEC3'}]};
    const input=join(directory,'input.glb'),output=join(directory,'output.glb'),bytes=glb(json,binary);await writeFile(input,bytes);
    const report=await resizeElderbloomGroundAtlas(input,output),after=parse(await readFile(output));
    assert.equal(report.freedTextureBytes,16777216);assert.equal(report.allGeometryMaterialsNodesAndTransformsPreserved,true);
    assert.deepEqual(await readFile(input),bytes);assert.deepEqual(after.binary.subarray(0,binary.length),binary);
    assert.deepEqual(after.json.nodes,json.nodes);assert.deepEqual(after.json.meshes,json.meshes);assert.deepEqual(after.json.materials,json.materials);assert.deepEqual(after.json.accessors,json.accessors);
    const atlasView=after.json.bufferViews[after.json.images[0].bufferView],metadata=await sharp(after.binary.subarray(atlasView.byteOffset,atlasView.byteOffset+atlasView.byteLength)).metadata();
    assert.equal(metadata.width,1024);assert.equal(metadata.height,1024);
    const outputBefore=await readFile(output);await assert.rejects(()=>resizeElderbloomGroundAtlas(input,output),/Output exists/);assert.deepEqual(await readFile(output),outputBefore);
    const unknown=structuredClone(json);unknown.images[0].name='original-purchased-texture';const unverified=join(directory,'unknown.glb');await writeFile(unverified,glb(unknown,binary));
    await assert.rejects(()=>resizeElderbloomGroundAtlas(unverified,join(directory,'unexpected.glb')),/verified generated ground atlas/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

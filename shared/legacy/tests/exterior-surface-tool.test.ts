import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { distanceFromProtectedSamples, exteriorSurfaceAlbedo, rebakeElderbloomExteriorSurface } from '../../../scripts/rebake-elderbloom-exterior-surface';
const sharp=createRequire(new URL('../../../main-game-vr/package.json',import.meta.url))('sharp');
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(badUv=false){
  const j:any={asset:{version:'2.0',extras:{crownfallExteriorDisplayCandidate:{version:2,protectedVillageAndPond:true}}},buffers:[{}],bufferViews:[],accessors:[],materials:[],meshes:[],nodes:[],images:[],textures:[{source:0,sampler:0}],samplers:[{magFilter:9729,minFilter:9987,wrapS:33071,wrapT:33071}],scenes:[{nodes:[0,1,2,3,4]}],scene:0};
  const chunks:Buffer[]=[];let length=0;
  function append(bytes:Buffer,target?:number){const padding=(4-length%4)%4;if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}const view=j.bufferViews.length;j.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length,...(target?{target}:{})});chunks.push(bytes);length+=bytes.length;return view;}
  function attr(data:Float32Array|Uint16Array,width:number,component=5126,target=34962){const index=j.accessors.length;j.accessors.push({bufferView:append(Buffer.from(data.buffer),target),componentType:component,count:data.length/width,type:width===1?'SCALAR':`VEC${width}`});return index;}
  const pos:number[]=[],nor:number[]=[],uv:number[]=[],earthUv:number[]=[],rockUv:number[]=[],earth:number[]=[],rock:number[]=[];
  for(let z=0;z<9;z++)for(let x=0;x<9;x++){const wx=-20+x*5,wz=-20+z*5;pos.push(wx,1,wz);nor.push(0,1,0);uv.push(x/8,z/8);earthUv.push(wx/4,-wz/4);rockUv.push(wz/6,1/6);}
  if(badUv)uv[0]+=.1;
  for(let z=0;z<8;z++)for(let x=0;x<8;x++){const a=z*9+x,b=a+1,c=a+9,d=c+1;earth.push(a,c,b);rock.push(b,c,d);}
  const p=attr(Float32Array.from(pos),3),n=attr(Float32Array.from(nor),3),u=attr(Float32Array.from(uv),2),eu=attr(Float32Array.from(earthUv),2),ru=attr(Float32Array.from(rockUv),2);
  for(const kind of['earth','rock'])j.materials.push({name:`Crownfall_LAAS_BakedGround_Review_${kind}_Microdetail`,pbrMetallicRoughness:{baseColorTexture:{index:0,texCoord:1},roughnessFactor:.94,metallicFactor:0},extras:{crownfallTerrainRepair:'synthetic fixture',crownfallGroundDetail:{kind,tileMetres:kind==='earth'?4:6,uvChannel:2}}});
  j.materials.push({name:'fixture house'},{name:'Crownfall_Pond_Water_Review'},{name:'fixture source grass'},{name:'fixture source tree'});
  j.meshes.push({name:'LandscapeComponent_0',primitives:[{attributes:{POSITION:p,NORMAL:n,TEXCOORD_1:u,TEXCOORD_2:eu},indices:attr(Uint16Array.from(earth),1,5123,34963),material:0},{attributes:{POSITION:p,NORMAL:n,TEXCOORD_1:u,TEXCOORD_2:ru},indices:attr(Uint16Array.from(rock),1,5123,34963),material:1}]});
  const house=attr(new Float32Array([-3,0,-2,3,0,-2,0,5,2]),3),pond=attr(new Float32Array([-6.5,.9,-5.5,-5.5,.9,-5.5,-6,.9,-4.5]),3),grass=attr(new Float32Array([-.2,0,0,.2,0,0,0,.3,0]),3),tree=attr(new Float32Array([-3,0,-3,3,0,3,0,8,0]),3);
  j.meshes.push({name:'fixture_house',primitives:[{attributes:{POSITION:house},material:2}]},{name:'fixture_pond',primitives:[{attributes:{POSITION:pond},material:3}]},{name:'S_Grass_Clumps_fixture',primitives:[{attributes:{POSITION:grass},material:4}]},{name:'SM_BlackAlder_fixture',primitives:[{attributes:{POSITION:tree},material:5}]});
  j.nodes.push({mesh:0},{mesh:1},{mesh:2},{mesh:3,extensions:{EXT_mesh_gpu_instancing:{attributes:{TRANSLATION:attr(new Float32Array([0,1,0,15,1,0]),3)}}}},{mesh:4,translation:[-15,1,0]});
  const originalPng:Buffer=await sharp({create:{width:1024,height:1024,channels:4,background:{r:96,g:92,b:96,alpha:1}}}).png().toBuffer();j.images.push({name:'Crownfall_AethelgardGroundAtlas',mimeType:'image/png',bufferView:append(originalPng)});
  const padding=(4-length%4)%4;if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}j.buffers[0].byteLength=length;const binary=Buffer.concat(chunks);let text=Buffer.from(JSON.stringify(j));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);const b=Buffer.alloc(28+text.length+binary.length),at=20+text.length;b.writeUInt32LE(0x46546c67,0);b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(text.length,12);b.writeUInt32LE(0x4e4f534a,16);text.copy(b,20);b.writeUInt32LE(binary.length,at);b.writeUInt32LE(0x004e4942,at+4);binary.copy(b,at+8);return{bytes:b,json:j,binary,originalPng};
}
function parse(bytes:Buffer){const at=20+bytes.readUInt32LE(12);return{json:JSON.parse(bytes.subarray(20,at).toString()),binary:bytes.subarray(at+8)};}
function accessor(file:ReturnType<typeof parse>,index:number,width:number){const a=file.json.accessors[index],v=file.json.bufferViews[a.bufferView],start=(v.byteOffset??0)+(a.byteOffset??0),size=a.componentType===5123?2:4;return Array.from({length:a.count*width},(_,i)=>a.componentType===5126?file.binary.readFloatLE(start+i*4):size===2?file.binary.readUInt16LE(start+i*2):file.binary.readUInt32LE(start+i*4));}
function image(file:ReturnType<typeof parse>,i:number){const v=file.json.bufferViews[file.json.images[i].bufferView];return file.binary.subarray(v.byteOffset,v.byteOffset+v.byteLength);}
test('surface-only v3 preserves protected atlas bytes/mips, complete geometry/actors and exact per-profile projections while qualifying exterior splits',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ealdholt-exterior-surface-'));
  try{
    const source=await fixture(),input=join(directory,'v2.glb'),output=join(directory,'v3.glb');await writeFile(input,source.bytes);const report=await rebakeElderbloomExteriorSurface(input,output,{expectedSha256:hash(source.bytes),atlasSize:1024}),result=parse(await readFile(output)),before=parse(source.bytes);
    assert.deepEqual(await readFile(input),source.bytes);assert.deepEqual(result.binary.subarray(0,source.binary.length),source.binary);assert.deepEqual(image(result,0),source.originalPng);
    for(const key of['nodes','samplers','scenes'])assert.deepEqual(result.json[key],source.json[key]);for(const key of['materials','images','textures','accessors','bufferViews'])assert.deepEqual(result.json[key].slice(0,source.json[key].length),source.json[key]);for(let i=1;i<source.json.meshes.length;i++)assert.deepEqual(result.json.meshes[i],source.json.meshes[i]);
    const oldFaces=new Map<string,{material:number;attributes:any}>(),newFaces=new Map<string,{material:number;attributes:any}>();
    for(const [file,map]of[[before,oldFaces],[result,newFaces]] as const)for(const p of file.json.meshes[0].primitives){const ix=accessor(file,p.indices,1);for(let i=0;i<ix.length;i+=3){const id=ix.slice(i,i+3).join(',');assert.equal(map.has(id),false);map.set(id,{material:p.material,attributes:p.attributes});}}
    assert.deepEqual([...newFaces.keys()].sort(),[...oldFaces.keys()].sort());const p=accessor(before,before.json.meshes[0].primitives[0].attributes.POSITION,3),r=report.protectedFootprint,protectedVertices=new Set<number>();
    for(const id of oldFaces.keys()){const ix=id.split(',').map(Number),xs=ix.map(i=>p[i*3]),zs=ix.map(i=>p[i*3+2]);if(Math.max(...xs)>=r.minX&&Math.min(...xs)<=r.maxX&&Math.max(...zs)>=r.minZ&&Math.min(...zs)<=r.maxZ)ix.forEach(i=>protectedVertices.add(i));}
    let protectedCount=0,outsideCount=0;for(const[id,old]of oldFaces){const after=newFaces.get(id)!;assert.deepEqual(after.attributes,old.attributes);if(id.split(',').map(Number).some(i=>protectedVertices.has(i))){assert.equal(after.material,old.material);protectedCount++;}else{assert.ok(after.material>=source.json.materials.length);assert.equal(result.json.materials[after.material].pbrMetallicRoughness.baseColorTexture.index,report.atlas.texture);outsideCount++;}}
    assert.equal(report.terrain.verifiedProtectedFaces,protectedCount);assert.equal(report.terrain.exteriorFaces,outsideCount);assert.equal(report.terrain.additionalDraws,2);assert.equal(report.terrain.newMaterials,2);assert.ok(report.atlas.worldUvMaxError<1e-6);assert.equal(report.atlas.moisture,'unknown; zero');assert.equal(report.preservation.protectedAtlasAndMipChainExact,true);
    const raw:Buffer=await sharp(image(result,report.atlas.image)).ensureAlpha().raw().toBuffer(),size=1024,pixel=(x:number,z:number)=>{const ix=Math.floor((x+20)/40*size),iz=Math.floor((z+20)/40*size);return Array.from(raw.subarray((iz*size+ix)*4,(iz*size+ix)*4+3));};
    const near=pixel(r.maxX+.02,0);assert.ok(near.every((v,i)=>Math.abs(v-[96,92,96][i])<=1),'small exterior band meets original boundary colour');const edge=pixel(19.98,0);assert.ok(edge[1]>edge[0]&&edge[1]>edge[2],'outer edge meets meadow rather than inherited slate');assert.ok(report.atlas.measuredGrassPixels>0);assert.ok(report.atlas.treeFootprintPixels>0);
    await assert.rejects(()=>rebakeElderbloomExteriorSurface(input,output,{expectedSha256:hash(source.bytes)}),/Output exists/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('shared repaired field supports a smaller Native atlas without changing original geometry or UVs',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ealdholt-exterior-native-surface-'));
  try{const source=await fixture(),input=join(directory,'v2.glb'),field=join(directory,'desktop-field.glb'),output=join(directory,'v3.glb');await writeFile(input,source.bytes);await writeFile(field,source.bytes);const report=await rebakeElderbloomExteriorSurface(input,output,{expectedSha256:hash(source.bytes),fieldSourcePath:field,expectedFieldSha256:hash(source.bytes),atlasSize:512}),result=parse(await readFile(output)),metadata=await sharp(image(result,report.atlas.image)).metadata();assert.equal(metadata.width,512);assert.equal(report.memory.additionalAtlasBytesWithMips,Math.ceil(512*512*4*4/3));assert.equal(report.preservation.fieldInputUnchanged,true);assert.equal(report.terrain.geometryPositionsNormalsUVsAndTransformsExact,true);assert.deepEqual(await readFile(field),source.bytes);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('exterior re-bake rejects a wrong hash, mismatched source UV frame and repository output without mutation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ealdholt-exterior-surface-guards-'));
  try{const source=await fixture(true),input=join(directory,'bad-frame.glb');await writeFile(input,source.bytes);await assert.rejects(()=>rebakeElderbloomExteriorSurface(input,join(directory,'wrong-hash.glb'),{expectedSha256:'0'.repeat(64)}),/SHA-256/);await assert.rejects(()=>rebakeElderbloomExteriorSurface(input,join(directory,'bad-frame-out.glb'),{expectedSha256:hash(source.bytes)}),/world-XZ frame/);await assert.rejects(()=>rebakeElderbloomExteriorSurface(input,new URL('../../../scripts/forbidden-private-surface.glb',import.meta.url).pathname,{expectedSha256:hash(source.bytes)}),/PRIVATE output/);assert.deepEqual(await readFile(input),source.bytes);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('original surface layer responds to actual slope/grass/canopy without inventing wetness or accepting invalid fields',()=>{
  const meadow=exteriorSurfaceAlbedo(3,1,8,0,.9,0),forest=exteriorSurfaceAlbedo(3,1,8,0,.9,1),steep=exteriorSurfaceAlbedo(3,1,8,2,.9,0);assert.ok(meadow[1]>meadow[0]);assert.ok(forest[0]>meadow[0]);assert.ok(steep[2]>meadow[2]);assert.ok([...meadow,...forest,...steep].every(v=>v>=0&&v<=1));assert.throws(()=>exteriorSurfaceAlbedo(0,NaN,0,0,1,1),/finite/);
});

test('protected-face feather uses actual irregular coverage and metric spacing',()=>{const mask=new Uint8Array(25);mask[12]=1;mask[13]=1;const d=distanceFromProtectedSamples(mask,5,2,3);assert.equal(d[12],0);assert.equal(d[13],0);assert.equal(d[11],2);assert.equal(d[7],3);assert.ok(Math.abs(d[6]-Math.hypot(2,3))<1e-6);assert.throws(()=>distanceFromProtectedSamples(new Uint8Array(25),5,2,3),/empty/);});

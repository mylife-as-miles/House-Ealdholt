import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { adaptElderbloomExterior } from '../../../scripts/adapt-elderbloom-exterior';

function fixture(surface?:'valid'|'bad-uv'|'bad-atlas'){
  const j:any={asset:{version:'2.0'},buffers:[{}],bufferViews:[],accessors:[],materials:[{name:'Crownfall_LAAS_fixture',extras:{crownfallTerrainRepair:'fixture'}},{name:'fixture house'},{name:'Crownfall_Pond_Water_Review'},{name:'fixture grass'}],meshes:[],nodes:[],scenes:[{nodes:[0,1,2,3,4]}],scene:0};
  const pieces:Buffer[]=[];let length=0;
  function append(data:Float32Array|Uint16Array,width:number,component=5126,target=34962){const pad=(4-length%4)%4;if(pad){pieces.push(Buffer.alloc(pad));length+=pad;}const bytes=Buffer.from(data.buffer,data.byteOffset,data.byteLength),view=j.bufferViews.length;j.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length,target});pieces.push(bytes);length+=bytes.length;const index=j.accessors.length;j.accessors.push({bufferView:view,componentType:component,count:data.length/width,type:width===1?'SCALAR':`VEC${width}`});return index;}
  const positions:number[]=[],normals:number[]=[],uv:number[]=[],ix:number[]=[];
  for(let z=0;z<9;z++)for(let x=0;x<9;x++){const px=-20+x*5,pz=-20+z*5,ring=Math.max(Math.abs(px),Math.abs(pz));positions.push(px,ring>=15?24:px===-5&&pz===-5?.4:1,pz);normals.push(0,1,0);uv.push(x/8,z/8);}
  for(let z=0;z<8;z++)for(let x=0;x<8;x++){const a=z*9+x,b=a+1,c=a+9,d=c+1;ix.push(a,c,b,b,c,d);}
  const p=append(Float32Array.from(positions),3),n=append(Float32Array.from(normals),3),u=append(Float32Array.from(uv),2),indices=append(Uint16Array.from(ix),1,5123,34963);
  const terrainPrimitives:any[]=[{attributes:{POSITION:p,NORMAL:n,TEXCOORD_0:u},indices,material:0}];
  if(surface){
    const earthUv=positions.flatMap((value,i)=>i%3===0?[value/4,-positions[i+2]/4]:[]),rockUv=positions.flatMap((value,i)=>i%3===0?[value/6,positions[i+1]/6]:[]);
    if(surface==='bad-uv')earthUv[0]+=.2;
    const e=append(Float32Array.from(earthUv),2),r=append(Float32Array.from(rockUv),2),earthIndex=append(Uint16Array.from(ix.slice(0,3)),1,5123,34963),rockIndex=append(Uint16Array.from(ix.slice(3)),1,5123,34963);
    const base={baseColorTexture:{index:0,texCoord:0},baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:.94,metallicRoughnessTexture:{index:2,texCoord:2}};
    j.materials[0]={name:'fixture rock',pbrMetallicRoughness:{...base,baseColorTexture:{index:surface==='bad-atlas'?1:0,texCoord:0}},normalTexture:{index:1,texCoord:2},extras:{crownfallTerrainRepair:'fixture',crownfallGroundDetail:{kind:'rock',uvChannel:2,tileMetres:6}}};
    const earthMaterial=j.materials.length;j.materials.push({name:'fixture earth',pbrMetallicRoughness:base,normalTexture:{index:1,texCoord:2},extras:{crownfallTerrainRepair:'fixture',crownfallGroundDetail:{kind:'earth',uvChannel:2,tileMetres:4}}});
    terrainPrimitives.splice(0,1,{attributes:{POSITION:p,NORMAL:n,TEXCOORD_0:u,TEXCOORD_2:r},indices:rockIndex,material:0},{attributes:{POSITION:p,NORMAL:n,TEXCOORD_0:u,TEXCOORD_2:e},indices:earthIndex,material:earthMaterial});
  }
  j.meshes.push({name:'LandscapeComponent_0',primitives:terrainPrimitives});
  const house=append(new Float32Array([-3,0,-2,3,0,-2,0,5,2]),3),pond=append(new Float32Array([-6.5,.9,-5.5,-5.5,.9,-5.5,-6,.9,-4.5]),3),grass=append(new Float32Array([-.2,0,0,.2,0,0,0,.3,0]),3);
  j.meshes.push({name:'fixture_house',primitives:[{attributes:{POSITION:house},material:1}]},{name:'fixture_pond',primitives:[{attributes:{POSITION:pond},material:2}]},{name:'S_Grass_Clumps_fixture',primitives:[{attributes:{POSITION:grass},material:3}]});
  const translations=append(new Float32Array([0,1,0,15,24,0]),3);j.nodes.push({name:'LandscapeComponent_0',mesh:0},{name:'house',mesh:1},{name:'pond',mesh:2},{name:'grass',mesh:3,extras:{crownfallElderbloom:{kind:'groundcover',cellX:0,cellZ:0,cellSize:8}},extensions:{EXT_mesh_gpu_instancing:{attributes:{TRANSLATION:translations}}}},{name:'ordinary grass',mesh:3,translation:[0,24,15]});
  const pad=(4-length%4)%4;if(pad){pieces.push(Buffer.alloc(pad));length+=pad;}j.buffers[0].byteLength=length;
  const binary=Buffer.concat(pieces);let text=Buffer.from(JSON.stringify(j));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);const b=Buffer.alloc(28+text.length+binary.length),at=20+text.length;
  b.writeUInt32LE(0x46546c67,0);b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(text.length,12);b.writeUInt32LE(0x4e4f534a,16);text.copy(b,20);b.writeUInt32LE(binary.length,at);b.writeUInt32LE(0x004e4942,at+4);binary.copy(b,at+8);return{bytes:b,json:j,binary};
}
function parse(b:Buffer){const at=20+b.readUInt32LE(12);return{json:JSON.parse(b.subarray(20,at).toString()),binary:b.subarray(at+8)};}
test('private exterior candidate preserves complete village/pond triangles and topology while lowering exterior and supporting only outside foliage',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ealdholt-exterior-'));
  try{
    const source=fixture(),input=join(directory,'source.glb'),output=join(directory,'candidate.glb');await writeFile(input,source.bytes);const expectedSha256=createHash('sha256').update(source.bytes).digest('hex');
    const report=await adaptElderbloomExterior(input,output,{expectedSha256}),result=parse(await readFile(output));
    assert.deepEqual(await readFile(input),source.bytes);assert.deepEqual(result.binary.subarray(0,source.binary.length),source.binary);
    assert.equal(report.terrain.protectedPositionNormalHashAfter,report.terrain.protectedPositionNormalHashBefore);assert.equal(report.terrain.sourceXZHashAfter,report.terrain.sourceXZHashBefore);
    assert.ok(report.terrain.alteredExteriorVertices>0);assert.equal(report.terrain.remainingOutsideVerticesAbove18m,0);assert.ok(report.terrain.afterHeightRange[1]<18);assert.ok(report.terrain.maxSharedEdgeHeightDeviation<.001);
    for(const index of [1,2]){assert.deepEqual(result.json.nodes[index],source.json.nodes[index]);assert.deepEqual(result.json.meshes[index],source.json.meshes[index]);}
    const before=source.json.meshes[0].primitives[0],after=result.json.meshes[0].primitives[0];assert.equal(after.indices,before.indices);assert.equal(after.attributes.TEXCOORD_0,before.attributes.TEXCOORD_0);assert.deepEqual(result.json.materials,source.json.materials);
    assert.equal(report.foliage.protectedRoots,1);assert.equal(report.foliage.movedRoots,2);assert.equal(report.foliage.missingSupportRoots,0);assert.ok(report.foliage.maximumPreservedOffsetError<1e-4);
    const a=result.json.accessors[result.json.nodes[3].extensions.EXT_mesh_gpu_instancing.attributes.TRANSLATION],view=result.json.bufferViews[a.bufferView],t=Array.from({length:6},(_,i)=>result.binary.readFloatLE(view.byteOffset+i*4));
    assert.deepEqual(t.slice(0,3),[0,1,0]);assert.equal(t[3],15);assert.equal(t[5],0);assert.ok(t[4]<10);assert.equal(a.min[1],1);assert.ok(a.max[1]<10);
    assert.deepEqual(result.json.nodes[3].extras.crownfallElderbloom,source.json.nodes[3].extras.crownfallElderbloom);assert.ok(result.json.nodes[3].extras.crownfallExteriorAdaptation.worldBounds);
    assert.equal(report.memory.activeGeometryByteChange,0);assert.equal(report.memory.texturesUnchanged,true);assert.equal(report.preservation.allArchitecturePropsAndPondActors,true);
    await assert.rejects(()=>adaptElderbloomExterior(input,output,{expectedSha256}),/Output exists/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('exterior adaptation rejects an unqualified hash or repository output before writing a candidate',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ealdholt-exterior-guards-'));
  try{const source=fixture(),input=join(directory,'source.glb');await writeFile(input,source.bytes);
    await assert.rejects(()=>adaptElderbloomExterior(input,join(directory,'wrong.glb'),{expectedSha256:'0'.repeat(64)}),/SHA-256/);
    await assert.rejects(()=>adaptElderbloomExterior(input,new URL('../../../scripts/forbidden-private-candidate.glb',import.meta.url).pathname,{expectedSha256:'0'.repeat(64)}),/PRIVATE output/);
    assert.deepEqual(await readFile(input),source.bytes);
  }finally{await rm(directory,{recursive:true,force:true});}
});

function readAccessor(file:ReturnType<typeof parse>,index:number,width:number){const a=file.json.accessors[index],v=file.json.bufferViews[a.bufferView],size=a.componentType===5123?2:4,stride=v.byteStride??width*size,start=(v.byteOffset??0)+(a.byteOffset??0);return Array.from({length:a.count*width},(_,i)=>{const at=start+Math.floor(i/width)*stride+i%width*size;return a.componentType===5126?file.binary.readFloatLE(at):size===2?file.binary.readUInt16LE(at):file.binary.readUInt32LE(at);});}
function faceAssignments(file:ReturnType<typeof parse>){return file.json.meshes[0].primitives.flatMap((p:any)=>{const ix=readAccessor(file,p.indices,1);return Array.from({length:ix.length/3},(_,i)=>({id:ix.slice(i*3,i*3+3).join(','),indices:ix.slice(i*3,i*3+3),material:p.material,uv:p.attributes.TEXCOORD_2}));});}
test('v2 protected-edge relief removes the inherited berm and reuses verified earth UVs only for exterior faces without adding draws',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ealdholt-exterior-earth-'));
  try{
    const source=fixture('valid'),input=join(directory,'source.glb'),output=join(directory,'v2.glb');await writeFile(input,source.bytes);
    const expectedSha256=createHash('sha256').update(source.bytes).digest('hex'),report=await adaptElderbloomExterior(input,output,{expectedSha256,coastalRelief:.25,eastRelief:1.2,transitionMode:'protected-edge',exteriorSurface:'earth'}),result=parse(await readFile(output)),before=parse(source.bytes);
    assert.deepEqual(await readFile(input),source.bytes);assert.deepEqual(result.binary.subarray(0,source.binary.length),source.binary);
    assert.ok(report.terrain.unprotectedMaxY<=2.2);assert.ok(report.terrain.farExteriorMaxY<=2.2);assert.equal(report.terrain.remainingOutsideVerticesAbove18m,0);assert.equal(report.terrain.protectedPeaks.edgeAbove18m,0);
    assert.ok(report.terrain.exteriorEarthFaces>0);assert.ok(report.terrain.surfaceReports.every((r:any)=>r.maximumUvError<=1e-5&&r.newUvBuffers===0&&r.newDrawCalls===0));
    assert.equal(result.json.meshes[0].primitives.length,before.json.meshes[0].primitives.length);assert.deepEqual(result.json.materials,before.json.materials);
    const oldFaces=faceAssignments(before),newFaces=faceAssignments(result),newById=new Map(newFaces.map(f=>[f.id,f]));assert.deepEqual(newFaces.map(f=>f.id).sort(),oldFaces.map(f=>f.id).sort());
    const oldP=readAccessor(before,before.json.meshes[0].primitives[0].attributes.POSITION,3),r=report.protectedFootprint;
    let protectedRock=0,changedEarth=0;
    for(const face of oldFaces){const isProtected=face.indices.some(v=>{const x=oldP[v*3],z=oldP[v*3+2];return x>=r.minX-5&&x<=r.maxX+5&&z>=r.minZ-5&&z<=r.maxZ+5;});const after=newById.get(face.id)!;
      if(isProtected&&face.material===0){assert.equal(after.material,face.material);assert.equal(after.uv,face.uv);protectedRock++;}
      if(after.material!==face.material){assert.equal(after.material,4);assert.equal(after.uv,before.json.meshes[0].primitives[1].attributes.TEXCOORD_2);changedEarth++;}
    }
    assert.ok(protectedRock>0);assert.equal(changedEarth,report.terrain.exteriorEarthFaces);assert.equal(report.terrain.verifiedFaces,oldFaces.length);assert.ok(report.terrain.verifiedProtectedFaces>0);
    assert.equal(report.preservation.protectedFaceMaterialAndUVAssignmentsExact,true);assert.equal(report.preservation.allTopologyAndUVBuffers,true);assert.equal(report.foliage.missingSupportRoots,0);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('earth surface reassignment rejects mismatched UV projection and base atlas before writing',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ealdholt-exterior-earth-guards-'));
  try{for(const mode of ['bad-uv','bad-atlas'] as const){const source=fixture(mode),input=join(directory,mode+'.glb'),output=join(directory,mode+'-candidate.glb');await writeFile(input,source.bytes);const expectedSha256=createHash('sha256').update(source.bytes).digest('hex');
    await assert.rejects(()=>adaptElderbloomExterior(input,output,{expectedSha256,coastalRelief:.25,eastRelief:1.2,transitionMode:'protected-edge',exteriorSurface:'earth'}),mode==='bad-uv'?/world-XZ projection/:/source atlas/);assert.deepEqual(await readFile(input),source.bytes);
    await assert.rejects(()=>readFile(output),/ENOENT/);
  }}finally{await rm(directory,{recursive:true,force:true});}
});

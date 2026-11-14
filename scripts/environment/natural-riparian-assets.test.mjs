import{test}from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{join}from'node:path';import sharp from'sharp';
import{alphaCoverage,mapSha}from'./riparian-plant-maps.mjs';
const root=process.env.CROWNFALL_NATURAL_RIPARIAN_ASSETS;
if(root)for(const profile of['desktop','native'])test(profile+' actual canonical source geometry/PBR/alpha mip identity and complete memory reservation',async()=>{
 const manifest=JSON.parse(await readFile(join(root,'manifest.json'))),expected=manifest.profiles[profile],bytes=await readFile(join(root,expected.file));
 assert.equal(mapSha(bytes),expected.sha256);assert.equal(bytes.length,expected.bytes);assert.equal(bytes.readUInt32LE(0),0x46546c67);const size=bytes.readUInt32LE(12),g=JSON.parse(bytes.subarray(20,20+size).toString()),bin=bytes.subarray(20+size+8);
 const data=index=>{const v=g.bufferViews[index];return bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);};
 assert.deepEqual(g.asset.extras,expected.identity);assert.equal(g.meshes.length,2);assert.equal(g.materials.length,2);assert.ok(expected.accountedBytes<=expected.reservationBytes);assert.equal(expected.accountedBytes,Object.values(expected.accounting).reduce((a,b)=>a+b,0));
 for(let i=0;i<2;i++){const plant=expected.identity.plants[i],p=g.meshes[i].primitives[0],material=g.materials[p.material];
  assert.equal(g.nodes.filter(n=>n.mesh===i).length,1);assert.ok(g.nodes.filter(n=>n.mesh===i).every(n=>!n.matrix&&!n.scale&&!n.translation));
  for(const[name,key]of[['position','POSITION'],['normal','NORMAL'],['uv','TEXCOORD_0']])assert.equal(mapSha(data(g.accessors[p.attributes[key]].bufferView)),plant.hashes[name]);
  assert.equal(mapSha(data(g.accessors[p.indices].bufferView)),plant.hashes.index);assert.equal(g.accessors[p.indices].count,plant.triangles*3);
  assert.equal(material.alphaMode,'MASK');assert.equal(material.alphaCutoff,.5);assert.equal(material.doubleSided,true);assert.equal(material.pbrMetallicRoughness.metallicFactor,0);assert.equal(mapSha(Buffer.from(JSON.stringify(material))),plant.canonicalMaterialSha256);
  const tex=material.pbrMetallicRoughness.baseColorTexture.index,albedo=g.images[g.textures[tex].source];const{data:rgba,info}=await sharp(data(albedo.bufferView)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,expected.size);assert.equal(mapSha(rgba),plant.albedoMips[0].sha256);assert.ok(alphaCoverage(rgba)<.3);assert.ok(rgba.some((a,at)=>at%4===3&&a===0));assert.ok(rgba.some((a,at)=>at%4===3&&a>=128));
  assert.equal(plant.albedoMips.length,Math.log2(expected.size)+1);
  for(const mip of plant.albedoMips){const raw=data(mip.bufferView);assert.equal(raw.length,mip.width*mip.height*4);assert.equal(mapSha(raw),mip.sha256);assert.equal(alphaCoverage(raw),mip.coverage);assert.ok(Math.abs(mip.coverage-plant.sourceAlphaCoverage)<=Math.max(.01,2/(mip.width*mip.height)));}
  assert.equal(plant.albedoMips.at(-1).coverage,0);
  const maps=[['normal',material.normalTexture.index,plant.normalRgbaSha256],['orm',material.pbrMetallicRoughness.metallicRoughnessTexture.index,plant.ormRgbaSha256]];
  for(const[role,index,sha]of maps){const image=g.images[g.textures[index].source],decoded=await sharp(data(image.bufferView)).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(decoded.info.width,expected.dataSize);assert.equal(mapSha(decoded.data),sha);
   if(role==='normal')for(let at=0;at<decoded.data.length;at+=4)assert.ok(Math.abs(Math.hypot(decoded.data[at]/127.5-1,decoded.data[at+1]/127.5-1,decoded.data[at+2]/127.5-1)-1)<.015);
  }
 }
});

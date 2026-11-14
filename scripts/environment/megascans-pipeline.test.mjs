import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {compressTextures,verifyRetainedViews,validateMegascans,SCHEMA,alphaCoverage,comparePixels,confined,coverageScale,privateOutput,nextMip,textureRoles,compressGeometry,packGlb,parseGlb,semanticIdentity,verifyPrimitive,dracoModules,convertMegascans,digest} from './megascans-pipeline.mjs';

test('private outputs and external image paths cannot overwrite or escape into the repository/network',()=>{
 assert.throws(()=>privateOutput(resolve('main game/public/should-not-exist')),/outside the repository/);
 for(const path of ['../escape.png','%2e%2e/escape.png','%2e%2e%5cescape.png','https://example.com/image.png','/absolute.png','image.png?token=secret'])assert.throws(()=>confined('/private/source',path));
 assert.equal(confined('/private/source','textures/albedo.png'),'/private/source/textures/albedo.png');
});
test('colour, normal and ORM roles stay explicit; incompatible reuse fails before conversion',()=>{
 const json={textures:[{source:0},{source:1},{source:2}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0},metallicRoughnessTexture:{index:2}},normalTexture:{index:1},occlusionTexture:{index:2},alphaMode:'MASK',alphaCutoff:.5}]};
 const roles=textureRoles(json);assert.deepEqual([...roles.get(0).roles],['srgb']);assert.deepEqual([...roles.get(1).roles],['normal']);assert.deepEqual([...roles.get(2).roles],['orm']);assert.deepEqual(roles.get(0).cutoffs,[.5]);
 json.materials[0].normalTexture.index=0;assert.throws(()=>textureRoles(json),/incompatible colour\/data/);
});
test('mips filter sRGB in linear light, renormalize normals and average independent ORM channels',()=>{
 const rgba=Buffer.from([0,0,0,255,255,255,255,255,0,0,0,255,255,255,255,255]);
 const colour=nextMip({width:2,height:2,data:rgba},'srgb'),data=nextMip({width:2,height:2,data:rgba},'orm');
 assert.ok(colour.data[0]>=187&&colour.data[0]<=189);assert.equal(data.data[0],128);
 const normal=nextMip({width:2,height:2,data:Buffer.from([128,128,255,255,255,128,128,255,128,128,255,255,255,128,128,255])},'normal');
 const vector=[...normal.data.subarray(0,3)].map(v=>v/127.5-1);assert.ok(Math.abs(Math.hypot(...vector)-1)<.01);assert.ok(vector[0]>.7&&vector[2]>.7);
});
test('alpha-tested mips retain source coverage and a lossy alpha/normal change fails the validation gate',()=>{
 const source=Buffer.from([255,255,255,255,255,255,255,0,255,255,255,255,255,255,255,0]);assert.equal(alphaCoverage(source),.5);
 let mip={width:2,height:2,data:source,baseCoverage:.5};mip=nextMip(mip,'srgb',[.5]);assert.ok(Math.abs(alphaCoverage(mip.data)-.5)<=1/(mip.width*mip.height));
 const tied=Buffer.alloc(4*4*4,128);const tiedScaled=coverageScale(tied,.5,.5);assert.equal(alphaCoverage(tiedScaled),.5,'equal-alpha mip ties must not double cutout coverage');
 const scaled=coverageScale(Buffer.from([10,20,30,100,10,20,30,200]),.5,.5);assert.equal(alphaCoverage(scaled),.5);
 const damaged=Buffer.from(source);damaged[3]=0;assert.throws(()=>comparePixels(source,damaged,'srgb',[.5]),/compression|coverage/);
 const a=Buffer.from([128,128,255,255]),b=Buffer.from([255,128,128,255]);assert.throws(()=>comparePixels(a,b,'normal'),/compression/);
 assert.throws(()=>nextMip({width:2,height:2,data:source},'srgb',[.3,.7]),/multiple cutoffs/);
});
test('missing rights, source hash mismatch and authoring brushes cannot create a derivative',async()=>{
 const root=await mkdtemp(join(tmpdir(),'megascans-safety-')),input=join(root,'original.glb'),provenance=join(root,'source.json');await writeFile(input,'authored-input');
 try{const base={assetKind:'mesh',sourceUrl:'https://polyhaven.com/a/example',license:'CC0-1.0',sourceSha256:digest(Buffer.from('authored-input')),rights:{confirmed:true}};
 for(const patch of [{rights:{confirmed:false}},{sourceSha256:'0'.repeat(64)},{assetKind:'brush'}]){await writeFile(provenance,JSON.stringify({...base,...patch}));await assert.rejects(convertMegascans({input,provenance,output:join(root,'derived'),dracoModule:'/missing',ktxBin:'/missing'}),/rights|Brushes/);await assert.rejects(access(join(root,'derived')));}
 assert.equal(await readFile(input,'utf8'),'authored-input');}finally{await rm(root,{recursive:true,force:true});}
});

test('actual Draco round trip preserves indexed tangent/UV/skin/morph/animation/instancing semantics without quantization', {skip:!process.env.CROWNFALL_DRACO_MODULE},async()=>{
 const chunks=[],json={asset:{version:'2.0'},scenes:[{nodes:[0,2]}],scene:0,nodes:[{mesh:0,skin:0,children:[1]},{name:'joint'},{mesh:0,extensions:{EXT_mesh_gpu_instancing:{attributes:{}}}}],meshes:[{primitives:[]}],accessors:[],bufferViews:[],buffers:[{byteLength:0}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.1,.2,.3,.7],metallicFactor:.4,roughnessFactor:.6},alphaMode:'MASK',alphaCutoff:.4,doubleSided:true}],skins:[{joints:[1]}],animations:[{samplers:[],channels:[]}],extensionsUsed:['EXT_mesh_gpu_instancing']};
 function accessor(values,type,componentType){const view=json.bufferViews.length;json.bufferViews.push({buffer:0,byteLength:values.byteLength});chunks.push(Buffer.from(values.buffer,values.byteOffset,values.byteLength));const index=json.accessors.length;json.accessors.push({bufferView:view,componentType,type,count:values.length/{SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[type]});return index;}
 const position=accessor(new Float32Array([0,0,0,1,0,0,0,1,0,1,1,0]),'VEC3',5126),uv=accessor(new Float32Array([.123,.23,.333,.456,.654,.789,.987,.998]),'VEC2',5126),normal=accessor(new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]),'VEC3',5126),tangent=accessor(new Float32Array([1,0,0,-1,1,0,0,-1,1,0,0,-1,1,0,0,-1]),'VEC4',5126),joint=accessor(new Uint16Array(16),'VEC4',5123),weight=accessor(new Float32Array([1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0]),'VEC4',5126),colour=accessor(new Uint8Array([255,128,4,255,2,255,8,128,5,8,255,255,128,6,255,255]),'VEC4',5121);json.accessors[colour].normalized=true;
 const indices=accessor(new Uint16Array([0,1,2,2,1,3]),'SCALAR',5123),morph=accessor(new Float32Array(12).fill(.01),'VEC3',5126),ticks=accessor(new Float32Array([0,1]),'SCALAR',5126),translations=accessor(new Float32Array([0,0,0,.1,0,0]),'VEC3',5126),bind=accessor(new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),'MAT4',5126);
 json.meshes[0].primitives=[{attributes:{POSITION:position,NORMAL:normal,TEXCOORD_0:uv,TANGENT:tangent,JOINTS_0:joint,WEIGHTS_0:weight,COLOR_0:colour},indices,material:0,targets:[{POSITION:morph}]}];json.meshes[0].weights=[0];json.nodes[2].extensions.EXT_mesh_gpu_instancing.attributes.TRANSLATION=position;json.skins[0].inverseBindMatrices=bind;json.animations[0].samplers=[{input:ticks,output:translations,interpolation:'LINEAR'}];json.animations[0].channels=[{sampler:0,target:{node:0,path:'translation'}}];
 const source=parseGlb(packGlb(json,chunks)),unchanged=JSON.stringify(source.json),modules=await dracoModules(process.env.CROWNFALL_DRACO_MODULE),derived=compressGeometry(source,modules.encoder),output=parseGlb(packGlb(derived.json,derived.chunks));
 const proof=verifyPrimitive(source,source.json.meshes[0].primitives[0],output,output.json.meshes[0].primitives[0],modules.decoder);assert.equal(proof.indicesExact,true);assert.equal(proof.attributes.TANGENT.maxError,0);assert.equal(proof.attributes.JOINTS_0.maxError,0);assert.equal(proof.attributes.COLOR_0.normalized,true);
 assert.deepEqual(semanticIdentity(output.json,source.json),semanticIdentity(source.json));assert.equal(JSON.stringify(source.json),unchanged);assert.ok(output.json.accessors[position].bufferView!==undefined,'instanced translation accessor must retain its raw backing bytes');assert.ok(output.json.accessors[morph].bufferView!==undefined);verifyRetainedViews(source,output);const broken=parseGlb(packGlb(derived.json,derived.chunks));delete broken.json.accessors[position].bufferView;assert.throws(()=>verifyRetainedViews(source,broken),/Retained data buffer missing/);
});


test('manifest validation rejects changed derivative bytes before invoking any decoder',async()=>{
 const root=await mkdtemp(join(tmpdir(),'megascans-integrity-'));try{await writeFile(join(root,'asset.glb'),'changed');const manifest={schema:SCHEMA,files:[{path:'asset.glb',bytes:7,sha256:'0'.repeat(64)}],geometry:[],textures:[],source:{provenance:{assetKind:'mesh',rights:{confirmed:true}}}};await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));await assert.rejects(validateMegascans({manifest:join(root,'manifest.json'),dracoModule:'/missing',ktxBin:'/missing'}),/integrity mismatch/);}finally{await rm(root,{recursive:true,force:true});}
});
test('real KTX2 encode/decode verifies cutout alpha and sRGB metadata; rejects losses through an explicit original fallback',{skip:!process.env.CROWNFALL_KTX_BIN},async()=>{
 const root=await mkdtemp(join(tmpdir(),'megascans-alpha-'));try{const output=join(root,'derived');await mkdir(output);const data=Buffer.alloc(8*8*4);for(let i=0;i<64;i++){data[i*4]=32;data[i*4+1]=90;data[i*4+2]=20;data[i*4+3]=i%2?0:255;}await sharp(data,{raw:{width:8,height:8,channels:4}}).png().toFile(join(root,'cutout.png'));await writeFile(join(output,'cutout.png'),await readFile(join(root,'cutout.png')));const json={images:[{uri:'cutout.png'}],textures:[{source:0}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}},alphaMode:'MASK',alphaCutoff:.5}]};const result=await compressTextures({json},JSON.parse(JSON.stringify(json)),root,output,process.env.CROWNFALL_KTX_BIN),texture=result.textures[0];assert.equal(texture.transferFunction,2);if(texture.encoding==='uastc-ktx2'){assert.equal(texture.levels,4);for(const e of texture.evidence)for(const c of e.coverage)assert.ok(Math.abs(c.source-c.decoded)<=Math.max(.005,1/(e.width*e.height)));}else{assert.equal(texture.encoding,'lossless-png');assert.deepEqual(await sharp(join(output,'cutout.png')).ensureAlpha().raw().toBuffer(),data);assert.match(texture.fallbackReason,/coverage|compression/);}}finally{await rm(root,{recursive:true,force:true});}
});

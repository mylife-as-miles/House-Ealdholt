/** Standalone authoring/runtime maps: no mesh, material geometry, scene or renderer is fabricated. */
import{readFile,writeFile,mkdir,lstat,realpath}from'node:fs/promises';
import{resolve,dirname,basename,join,relative,isAbsolute}from'node:path';
import assert from'node:assert/strict';import sharp from'sharp';
import{SCHEMA,digest,boundedRead,privateOutput,confined,compressTextures,verifyTextureEvidence}from'./megascans-pipeline.mjs';
export const TEXTURE_SET_SCHEMA='crownfall-texture-set-v1';
const KINDS=new Set(['material','decal','atlas','brush']),ROLES=new Set(['srgb','linear','orm','normal']);
const contained=(root,path)=>{const r=relative(root,path);return!isAbsolute(r)&&r!=='..'&&!r.startsWith('../');};
export function textureSetPlan(descriptor){
 if(descriptor?.schema!==TEXTURE_SET_SCHEMA||!KINDS.has(descriptor.assetKind)||!Array.isArray(descriptor.maps)||!descriptor.maps.length||descriptor.maps.length>64)throw Error('An explicit bounded material/decal/atlas/brush descriptor is required.');
 const seen=new Set(),images=[],roles=new Map();
 for(let i=0;i<descriptor.maps.length;i++){
  const map=descriptor.maps[i];if(!map||typeof map.path!=='string'||seen.has(map.path)||!ROLES.has(map.role)||!['opaque','mask','blend'].includes(map.alphaMode)||!['uint8','uint16','float32'].includes(map.precision)||!Number.isSafeInteger(map.bytes)||map.bytes<1||!/^([a-f\d]{64})$/.test(map.sha256))throw Error('Each map needs an explicit unique path, hash, size, role, alpha mode and precision.');seen.add(map.path);
  if(map.role==='normal'&&!['opengl','directx'].includes(map.normalOrientation??descriptor.normalOrientation))throw Error('Normal orientation must be declared, never guessed.');
  if(descriptor.assetKind==='brush'&&map.role!=='linear'&&!(map.role==='srgb'&&map.purpose==='colour'))throw Error('Scalar brush data must be linear; colour brushes must be explicitly declared.');
  if(map.alphaMode==='mask'&&(!Number.isFinite(map.alphaCutoff)||map.alphaCutoff<=0||map.alphaCutoff>1))throw Error('Masked maps require an explicit alpha cutoff.');
  images.push({uri:map.path});roles.set(i,{roles:new Set([map.role]),cutoffs:map.alphaMode==='mask'?[map.alphaCutoff]:[]});
 }
 return{source:{json:{images,textures:[]}},roles};
}
async function sourceSet(input,provenance,assetRoot){
 input=await realpath(resolve(input));assetRoot=await realpath(resolve(assetRoot));const bytes=await boundedRead(input),descriptor=JSON.parse(bytes),metadata=JSON.parse(await boundedRead(resolve(provenance))),plan=textureSetPlan(descriptor);
 if(metadata.assetKind!==descriptor.assetKind||metadata.sourceSha256!==digest(bytes)||metadata.rights?.confirmed!==true||!metadata.sourceUrl||!metadata.license)throw Error('Exact descriptor hash, matching kind, source licence and confirmed project rights are required.');
 for(const map of descriptor.maps){const path=await realpath(confined(assetRoot,map.path));if(!contained(assetRoot,path))throw Error('Linked map escapes the explicit asset root.');const raw=await boundedRead(path),image=await sharp(raw,{limitInputPixels:4096*4096}).metadata(),precision={uchar:'uint8',ushort:'uint16',float:'float32'}[image.depth];if(raw.length!==map.bytes||digest(raw)!==map.sha256)throw Error('Source map hash/size mismatch: '+map.path);if(precision!==map.precision)throw Error('Declared map precision does not match original: '+map.path);}
 return{input,assetRoot,bytes,descriptor,metadata,...plan};
}
export async function convertTextureSet({input,provenance,assetRoot,output,ktxBin}){
 if(!assetRoot)throw Error('Standalone maps require an explicit --asset-root.');const set=await sourceSet(input,provenance,assetRoot);output=privateOutput(output);output=privateOutput(join(await realpath(dirname(output)),basename(output)));
 try{await lstat(output);throw Error('Output directory exists; choose a new private version.');}catch(error){if(error.code!=='ENOENT')throw error;}
 await mkdir(output,{recursive:false});try{
  const files=[];for(const map of set.descriptor.maps){const raw=await boundedRead(confined(set.assetRoot,map.path)),target=confined(output,map.path);await mkdir(dirname(target),{recursive:true});await writeFile(target,raw,{flag:'wx'});files.push({path:map.path,bytes:raw.length,sha256:digest(raw),kind:'unchanged-source-image'});}
  // This internal image/role adapter never creates or writes glTF geometry or a scene.
  const result=await compressTextures(set.source,{images:[...set.source.json.images],textures:[]},set.assetRoot,output,resolve(ktxBin),set.roles);
  for(const texture of result.textures){const map=set.descriptor.maps[texture.sourceImage],raw=await boundedRead(confined(set.assetRoot,map.path));if(digest(raw)!==map.sha256||texture.sourceSha256!==map.sha256)throw Error('Source map changed during conversion.');const file={path:texture.output,bytes:texture.bytes,sha256:texture.sha256,kind:'derived-'+texture.encoding},old=files.findIndex(f=>f.path===file.path);if(old<0)files.push(file);else files[old]=file;}
  if(digest(await boundedRead(set.input))!==digest(set.bytes))throw Error('Source descriptor changed during conversion.');
  const derived={schema:TEXTURE_SET_SCHEMA,assetKind:set.descriptor.assetKind,sourceDescriptor:set.descriptor,maps:result.textures.map((t,i)=>({...set.descriptor.maps[i],derivedPath:t.output,encoding:t.encoding,derivedSha256:t.sha256,derivedBytes:t.bytes}))};
  const derivedBytes=Buffer.from(JSON.stringify(derived,null,2)+'\n');await writeFile(join(output,'derived-texture-set.json'),derivedBytes,{flag:'wx'});files.push({path:'derived-texture-set.json',bytes:derivedBytes.length,sha256:digest(derivedBytes),kind:'derived-texture-descriptor'});
  const manifest={schema:SCHEMA,assetKind:set.descriptor.assetKind,source:{path:set.input,imageRoot:set.assetRoot,bytes:set.bytes.length,sha256:digest(set.bytes),provenance:set.metadata},sourceDescriptor:set.descriptor,tools:{ktx:result.version},runtime:{authoringOnly:set.descriptor.assetKind==='brush',geometry:false,integration:'Explicit material/decal/atlas assignment is still required; this package creates no scene.',normalOrientation:'Preserved from descriptor without channel inversion.'},textures:result.textures,files,metrics:{sourceTextureBytes:result.textures.reduce((sum,t)=>sum+t.sourceBytes,0),derivedTextureBytes:result.textures.reduce((sum,t)=>sum+t.bytes,0),ktx2Textures:result.textures.filter(t=>t.encoding==='uastc-ktx2').length,losslessOrOriginalTextures:result.textures.filter(t=>t.encoding!=='uastc-ktx2').length}};
  await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});return manifest;
 }catch(error){await writeFile(join(output,'FAILED.txt'),String(error)+'\n',{flag:'wx'}).catch(()=>{});throw error;}
}
export async function validateTextureSet({manifest:manifestPath,ktxBin}){
 const path=await realpath(resolve(manifestPath)),directory=dirname(path),manifest=JSON.parse(await boundedRead(path));if(manifest.schema!==SCHEMA||!KINDS.has(manifest.assetKind)||!Array.isArray(manifest.files)||manifest.files.length>130||new Set(manifest.files.map(f=>f.path)).size!==manifest.files.length)throw Error('Unsupported standalone manifest/inventory.');
 for(const file of manifest.files){const raw=await boundedRead(confined(directory,file.path));if(raw.length!==file.bytes||digest(raw)!==file.sha256)throw Error('Derivative integrity mismatch: '+file.path);}
 const bytes=await boundedRead(manifest.source.path);if(digest(bytes)!==manifest.source.sha256||manifest.source.provenance.sourceSha256!==manifest.source.sha256||manifest.source.provenance.rights?.confirmed!==true||manifest.source.provenance.assetKind!==manifest.assetKind)throw Error('Standalone source identity/rights mismatch.');
 const descriptor=JSON.parse(bytes),plan=textureSetPlan(descriptor);assert.deepEqual(manifest.sourceDescriptor,descriptor,'Physical size/UV/normal/channel metadata changed.');if(manifest.textures.length!==descriptor.maps.length)throw Error('Incomplete standalone texture inventory.');
 const derived=JSON.parse(await boundedRead(join(directory,'derived-texture-set.json')));assert.deepEqual(derived.sourceDescriptor,descriptor);assert.deepEqual(derived.maps,manifest.textures.map((t,i)=>({...descriptor.maps[i],derivedPath:t.output,encoding:t.encoding,derivedSha256:t.sha256,derivedBytes:t.bytes})));
 for(let i=0;i<descriptor.maps.length;i++){const map=descriptor.maps[i],raw=await boundedRead(confined(manifest.source.imageRoot,map.path)),texture=manifest.textures[i];if(texture.sourceImage!==i||texture.sourceSha256!==map.sha256||digest(raw)!==map.sha256||raw.length!==map.bytes)throw Error('Original standalone map changed.');}
 await verifyTextureEvidence({source:plan.source,inputDir:manifest.source.imageRoot,directory,textures:manifest.textures,ktxBin,declaredRoles:plan.roles});
 return{schema:SCHEMA,assetKind:manifest.assetKind,valid:true,geometry:false,textures:manifest.textures.length,files:manifest.files.length,metrics:manifest.metrics};
}

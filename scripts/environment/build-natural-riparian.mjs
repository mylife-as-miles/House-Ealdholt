// Exact selected CC0 originals -> a small canonical plant pair. Never overwrites.
import{readFile,writeFile,mkdir}from'node:fs/promises';import{resolve,join}from'node:path';import{pathToFileURL}from'node:url';import{createRequire}from'node:module';
import sharp from'sharp';import{createStaticGlb}from'./glb-writer.mjs';import{readRiparianPlantSource}from'./riparian-plant-source.mjs';
import{buildRiparianColourMips,mapSha}from'./riparian-plant-maps.mjs';import{reducePhotographicMap}from'../prepare-aethelgard-photographic-ground.mjs';
export const NATURAL_RIPARIAN_GENERATOR='crownfall-verdant-natural-bank-pbr-alpha16-v1';
export async function buildNaturalRiparian(directory,output){
 const source=resolve(directory),out=resolve(output);if(source===out)throw Error('Choose a new canonical output directory.');
 const require=createRequire(resolve('main game/package.json')),T=await import(pathToFileURL(require.resolve('three')).href);
 const plants=[];for(const id of['grass_medium_02','shrub_03'])plants.push(await readRiparianPlantSource(source,id,T));
 const license=await readFile(join(source,'CC0-1.0-legalcode.txt'));if(!license.includes('CC0 1.0 Universal'))throw Error('Missing original CC0 legal code.');
 await mkdir(out,{recursive:false});const files={},profiles={};
 for(const[profile,size,dataSize,reservation,limit]of[['desktop',256,128,6*1024**2,24],['native',128,64,2*1024**2,6]]){
  const writer=createStaticGlb([]),json=writer.json;json.images=[];json.textures=[];json.samplers=[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}];
  const records=[],encodedImages=[];let mipBytes=0,geometryBytes=0,pngBytes=0;
  async function image(rgba,width=size){const data=await sharp(Buffer.from(rgba),{raw:{width,height:width,channels:4}}).png().toBuffer(),bufferView=writer.blob(data),index=json.images.length;
   json.images.push({bufferView,mimeType:'image/png'});json.textures.push({source:index,sampler:0});encodedImages[index]={texture:index,bufferView,sha256:mapSha(data),bytes:data.length};pngBytes+=data.length;return index;}
  for(const plant of plants){
   const colour=buildRiparianColourMips(plant.maps.albedo,plant.alpha,size);if(colour.mips[0].error>.01)throw Error('Canonical alpha base loses source coverage.');
   const albedo=await image(colour.mips[0].rgba),mips=colour.mips.map(m=>({width:m.width,height:m.height,bufferView:writer.blob(m.rgba),sha256:m.sha256,coverage:m.coverage,error:m.error}));
   const normal=reducePhotographicMap({size:1024,values:Float32Array.from(plant.maps.normal,n=>n/255)},dataSize,'normal');
   const orm=reducePhotographicMap({size:1024,values:Float32Array.from(plant.maps.orm,n=>n/255)},dataSize,'data');
   const normalTexture=await image(normal,dataSize),ormTexture=await image(orm,dataSize),material=json.materials.length;
   json.materials.push({name:plant.variant+' original PBR cutout',alphaMode:'MASK',alphaCutoff:.5,doubleSided:true,normalTexture:{index:normalTexture},pbrMetallicRoughness:{baseColorTexture:{index:albedo},metallicFactor:0,roughnessFactor:1,metallicRoughnessTexture:{index:ormTexture}}});
   const parent=writer.group(plant.variant+'_source',{sourceVariant:plant.variant});writer.mesh(parent,plant.variant,plant.geometry,material);
   records.push({sourceAsset:plant.id,variant:plant.variant,sourceGltfSha256:plant.record.files.find(f=>f.file.endsWith('.gltf')).sha256,sourceAlphaSha256:plant.record.files.find(f=>f.file.includes('/supplemental/')).sha256,
    ...plant.measured,sourceMaterialSha256:mapSha(Buffer.from(JSON.stringify(plant.sourceMaterial))),canonicalMaterialSha256:mapSha(Buffer.from(JSON.stringify(json.materials[material]))),sourceAlphaCoverage:colour.target,normalRgbaSha256:mapSha(normal),ormRgbaSha256:mapSha(orm),encodedImages:[encodedImages[albedo],encodedImages[normalTexture],encodedImages[ormTexture]],albedoMips:mips});
   mipBytes+=colour.bytes;geometryBytes+=plant.measured.geometryBytes;
  }
  const identity={version:NATURAL_RIPARIAN_GENERATOR,profile,size,dataSize,plants:records};json.asset.extras=identity;json.scenes[0].extras={naturalRiparian:identity};
  const filename=`natural-bank-${profile}-v1.glb`;await writer.save(join(out,filename));const bytes=await readFile(join(out,filename));
  // Retained raw model, decoded borrowed bitmaps, custom alpha CPU+GPU chains,
  // normal/ARM GPU chains, complete source CPU+GPU geometry, buffers and staging.
  let dataMipBytes=0;for(let n=dataSize;n>=1;n>>=1)dataMipBytes+=n*n*4;
  const accounting={sourceModelBytes:bytes.length,sourceImageBitmapBytes:plants.length*(size*size+2*dataSize*dataSize)*4,alphaCpuBytes:mipBytes,alphaGpuBytes:mipBytes,normalOrmGpuBytes:plants.length*2*dataMipBytes,geometryCpuGpuBytes:geometryBytes*3,instanceCpuGpuBytes:plants.length*limit*16*4*2,encodedImageStagingBytes:pngBytes,uploadStagingBytes:size*size*4,metadataAllowanceBytes:65536};
  const total=Object.values(accounting).reduce((a,b)=>a+b,0);if(total>reservation)throw Error(`${profile} source residency ${total} exceeds carved ${reservation}.`);
  profiles[profile]={file:filename,bytes:bytes.length,sha256:mapSha(bytes),size,dataSize,reservationBytes:reservation,maximumDetail:limit,accounting,accountedBytes:total,identity};files[filename]={bytes:bytes.length,sha256:mapSha(bytes)};
 }
 const manifest={schema:1,generator:NATURAL_RIPARIAN_GENERATOR,licence:'CC0-1.0',sourceIntakeSha256:mapSha(await readFile(join(source,'source-intake.json'))),profiles,files};
 await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});await writeFile(join(out,'CC0-1.0.txt'),license,{flag:'wx'});
 await writeFile(join(out,'SOURCES.md'),'# Natural bank plants\n\nPoly Haven A Verdant Trail, Rico Cilliers, CC0-1.0: https://polyhaven.com/a/grass_medium_02 and https://polyhaven.com/a/shrub_03 . Official licence: https://polyhaven.com/license . Only grass_medium_02_e and shrub_03_b are included. No demonstration world or original settlement data is imported.\n\nGeometry, normals and UVs retain exact source accessor values and natural uniform proportions. Catalogue display offsets are omitted. Provider16-bit Alpha PNGs normalize by round(value/257), then join the matching JPEG albedo. Colour filters in alpha-weighted linear light; original OpenGL normals renormalize and ARM filters linearly. All map rows retain source orientation, glTF flipY=false. Runtime uses explicit coverage-preserving RGBA mip views; MASK0.5 deliberately replaces original grass BLEND for cutout rendering. Tiny final mips choose the closest possible coverage, including transparent rather than opaque1x1 cards. No colour tint, generated anatomy or novel plant geometry.\n\nDesktop256px and Native128px are separate derivatives. Original files, official size/MD5 and SHA256 evidence remain in the private source intake; public source hashes, material/accessor/mip hashes and conservative source CPU/GPU residency estimates are in manifest.json. These are accounting estimates, not hardware measurements.\n\nRebuild: node scripts/environment/build-natural-riparian.mjs PRIVATE_SOURCE_INTAKE NEW_OUTPUT_DIRECTORY .\n',{flag:'wx'});
 await writeFile(join(out,'natural-riparian-asset-data.ts'),'// Generated by scripts/environment/build-natural-riparian.mjs; do not hand-edit.\nexport const NATURAL_RIPARIAN_DATA='+JSON.stringify({generator:manifest.generator,profiles},null,2)+' as const;\n',{flag:'wx'});
 return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(process.argv.length!==4)throw Error('Usage: build-natural-riparian.mjs PRIVATE_SOURCE NEW_OUTPUT');buildNaturalRiparian(process.argv[2],process.argv[3]).then(m=>console.log(JSON.stringify(Object.fromEntries(Object.entries(m.profiles).map(([k,v])=>[k,{file:v.file,bytes:v.bytes,sha256:v.sha256,accountedBytes:v.accountedBytes,reservationBytes:v.reservationBytes}]))))).catch(e=>{console.error(e);process.exitCode=1;});}

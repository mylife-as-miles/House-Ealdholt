// Deterministic offline Poly Haven CC0 preparation. Input downloads and official
// API snapshots stay outside Git. Writes a NEW canonical directory only.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const hash=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
export const linearFromSrgb=value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4;
const srgbFromLinear=value=>value<=.0031308?value*12.92:1.055*value**(1/2.4)-.055;
const byte=value=>Math.round(Math.max(0,Math.min(1,value))*255);
const assets={earth:'stony_dirt_path',rock:'rock_surface'};
const provenance='Poly Haven CC0 photographic terrain reconstruction for Crownfall';

export function verifyPolyHavenSource(bytes,entry,asset) {
  if(!entry?.url?.startsWith(`https://dl.polyhaven.org/file/ph-assets/Textures/png/1k/${asset}/`)||entry.size!==bytes.length||hash(bytes,'md5')!==entry.md5)throw Error('Poly Haven source URL, byte size or official MD5 mismatch.');
  return {url:entry.url,bytes:bytes.length,md5:entry.md5,sha256:hash(bytes)};
}

export async function decodePhotographicSource(bytes) {
  // Sharp otherwise converts to8-bit sRGB before its ushort output cast.
  // Explicit rgb16 keeps the actual16-bit PNG samples instead of0..255 data
  // mislabeled by a16-bit buffer and subsequently divided by65535.
  const {data,info}=await sharp(bytes).toColourspace('rgb16').raw({depth:'ushort'}).toBuffer({resolveWithObject:true});
  if(info.width!==1024||info.height!==1024||![1,3,4].includes(info.channels))throw Error('Expected bounded official1k source maps.');
  const values=new Float32Array(info.width*info.height*3);
  for(let i=0;i<info.width*info.height;i++)for(let c=0;c<3;c++)values[i*3+c]=data.readUInt16LE((i*info.channels+Math.min(c,info.channels-1))*2)/65535;
  return {size:info.width,values};
}

/** Exact box reduction: sRGB albedo averages in linear light; OpenGL normals
 * average as vectors and renormalize. Data maps remain linear throughout. */
export function reducePhotographicMap(source,size,kind) {
  if(!['albedo','normal','data'].includes(kind)||!Number.isSafeInteger(size)||size<1||source.size%size)throw Error('Expected an integer source reduction.');
  const factor=source.size/size,output=new Uint8Array(size*size*4),count=factor*factor;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const sum=[0,0,0];
    for(let dy=0;dy<factor;dy++)for(let dx=0;dx<factor;dx++){
      const at=((y*factor+dy)*source.size+x*factor+dx)*3;
      for(let c=0;c<3;c++){const value=source.values[at+c];sum[c]+=kind==='albedo'?linearFromSrgb(value):kind==='normal'?value*2-1:value;}
    }
    if(kind==='normal'){
      const length=Math.hypot(...sum);if(length<1e-8){sum[0]=0;sum[1]=0;sum[2]=1;}else for(let c=0;c<3;c++)sum[c]/=length;
    }
    const at=(y*size+x)*4;
    for(let c=0;c<3;c++)output[at+c]=byte(kind==='normal'?sum[c]*.5+.5:kind==='albedo'?srgbFromLinear(sum[c]/count):sum[c]/count);
    output[at+3]=255;
  }
  return output;
}

export function packPhotographicOrm(ao,roughness) {
  if(ao.length!==roughness.length||ao.length%4)throw Error('Mismatched AO/roughness maps.');
  const output=new Uint8Array(ao.length);
  for(let i=0;i<ao.length;i+=4){output[i]=ao[i];output[i+1]=roughness[i];output[i+2]=0;output[i+3]=255;}
  return output;
}

export function meanLinearLuminance(rgba) {
  let sum=0;for(let i=0;i<rgba.length;i+=4)sum+=.2126*linearFromSrgb(rgba[i]/255)+.7152*linearFromSrgb(rgba[i+1]/255)+.0722*linearFromSrgb(rgba[i+2]/255);
  return sum/(rgba.length/4);
}

export async function prepareAethelgardPhotographicGround(sourceDirectory,outputDirectory) {
  const input=resolve(sourceDirectory),output=resolve(outputDirectory);if(input===output)throw Error('Use a separate new output directory.');
  const licence=await readFile(join(input,'CC0-1.0.txt')),licensePage=await readFile(join(input,'polyhaven-license.html'));
  if(!licence.includes('CC0 1.0 Universal')||!licensePage.includes('Our assets are all licensed as')||!licensePage.includes('CC0'))throw Error('Missing verified official CC0 evidence.');
  // Exclusive directory creation keeps current assets and earlier builds safe.
  await mkdir(output,{recursive:false});
  const manifest={version:2,provenance,licence:'CC0-1.0',generator:'scripts/prepare-aethelgard-photographic-ground.mjs',
    colour:{albedo:'sRGB; measured linear luminance after quantization',normal:'OpenGL +Y, linear data',orm:'R=source AO; G=source roughness; B=0 dielectric',orientation:'All files preserve source rows; configure flipY=false together'},sets:{},gpuBytesWithMipsEstimate:{desktop:0,quest:0}};
  const evidence={licence:{spdx:'CC0-1.0',officialUrl:'https://polyhaven.com/license',legalCodeUrl:'https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt',
    officialPageSha256:hash(licensePage),legalCodeSha256:hash(licence),quote:'Our assets are all licensed as CC0',credit:'Powered by Poly Haven'},assets:{},files:[]};
  for(const [kind,asset] of Object.entries(assets)){
    const infoBytes=await readFile(join(input,asset+'-info.json')),filesBytes=await readFile(join(input,asset+'-files.json'));
    const info=JSON.parse(infoBytes),files=JSON.parse(filesBytes),maps={},sources={};
    if(info.type!==1||!info.authors||typeof info.name!=='string')throw Error('Unexpected official texture metadata.');
    for(const [map,key] of Object.entries({albedo:'Diffuse',normal:'nor_gl',ao:'AO',roughness:'Rough'})){
      const entry=files[key]?.['1k']?.png;if(!entry)throw Error('Missing required official1k PNG entry.');
      const bytes=await readFile(join(input,entry.url.split('/').at(-1)));sources[map]=verifyPolyHavenSource(bytes,entry,asset);maps[map]=await decodePhotographicSource(bytes);
    }
    evidence.assets[kind]={assetId:asset,name:info.name,authors:info.authors,sourceUrl:`https://polyhaven.com/a/${asset}`,
      infoApi:`https://api.polyhaven.com/info/${asset}`,filesApi:`https://api.polyhaven.com/files/${asset}`,
      infoSha256:hash(infoBytes),filesSha256:hash(filesBytes),apiDimensions:info.dimensions,sourceDownloads:sources};
    const set={assetId:asset,sourceUrl:`https://polyhaven.com/a/${asset}`,authors:info.authors,licence:'CC0-1.0',profiles:{}};
    for(const [profile,albedoSize,dataSize]of [['desktop',1024,1024],['quest',512,256]]){
      const albedo=reducePhotographicMap(maps.albedo,albedoSize,'albedo'),normal=reducePhotographicMap(maps.normal,dataSize,'normal');
      const orm=packPhotographicOrm(reducePhotographicMap(maps.ao,dataSize,'data'),reducePhotographicMap(maps.roughness,dataSize,'data'));
      const entry={meanLuminance:meanLinearLuminance(albedo),files:{}};
      for(const [map,pixels,size,extension]of [['albedo',albedo,albedoSize,'webp'],['normal',normal,dataSize,'png'],['orm',orm,dataSize,'png']]){
        const file=`${kind}-${profile}-${map}-${size}.${extension}`,image=sharp(Buffer.from(pixels),{raw:{width:size,height:size,channels:4}});
        const encoded=extension==='webp'?await image.removeAlpha().webp({lossless:true,effort:6}).toBuffer():await image.png({compressionLevel:9,adaptiveFiltering:false}).toBuffer();
        await writeFile(join(output,file),encoded,{flag:'wx'});const record={file,size,bytes:encoded.length,sha256:hash(encoded)};
        entry.files[map]=record;evidence.files.push(record);manifest.gpuBytesWithMipsEstimate[profile]+=Math.ceil(size*size*4*4/3);
      }
      set.profiles[profile]=entry;
    }
    manifest.sets[kind]=set;
  }
  await writeFile(join(output,'CC0-1.0.txt'),licence,{flag:'wx'});
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');await writeFile(join(output,'manifest.json'),manifestBytes,{flag:'wx'});
  evidence.files.push({file:'CC0-1.0.txt',bytes:licence.length,sha256:hash(licence)},{file:'manifest.json',bytes:manifestBytes.length,sha256:hash(manifestBytes)});
  const sourceText=`# Aethelgard photographic terrain reconstruction\n\nPowered by Poly Haven. These two photographic PBR sets are CC0 1.0 assets. This replaces missing landscape surface treatment; it does not recover Elderbloom's Unreal landscape painting. Existing procedural fallback textures remain separate.\n\n- Stony Dirt Path — eye-candy.xyz: https://polyhaven.com/a/stony_dirt_path\n- Rock Surface — Amal Kumar: https://polyhaven.com/a/rock_surface\n\nOfficial asset licence: https://polyhaven.com/license . CC0 legal code is included in CC0-1.0.txt. Source API/download URLs, authors, official MD5 checks, original/derived SHA-256 hashes and processing metadata are recorded in provenance.json and manifest.json. No ArtStation or other showcase images are redistributed.\n\nOffline preparation preserves image row orientation, linearly downsamples sRGB albedo, renormalizes OpenGL normals, and packs source AO/Roughness into R/G with dielectric metallic B=0. Desktop uses 1024px maps. Quest uses 512px albedo and 256px data maps. Generated UV1 atlas colour/masks and source terrain geometry are not changed. Shader detail should preserve atlas hue and use the matching profile's measured linear mean.\n\nReproduce with: node scripts/prepare-aethelgard-photographic-ground.mjs SOURCE_DOWNLOAD_DIRECTORY NEW_OUTPUT_DIRECTORY\n\nTexture sizes and memory figures are metadata estimates, not a physical Quest performance pass.\n`;
  await writeFile(join(output,'SOURCES.md'),sourceText,{flag:'wx'});evidence.files.push({file:'SOURCES.md',bytes:Buffer.byteLength(sourceText),sha256:hash(Buffer.from(sourceText))});
  await writeFile(join(output,'provenance.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
  return manifest;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length!==4){console.error('Usage: node scripts/prepare-aethelgard-photographic-ground.mjs PRIVATE_SOURCE_DIRECTORY NEW_CANONICAL_TEXTURE_DIRECTORY');process.exitCode=1;}
  else prepareAethelgardPhotographicGround(process.argv[2],process.argv[3]).then(manifest=>console.log(JSON.stringify({sets:Object.keys(manifest.sets),gpuBytesWithMipsEstimate:manifest.gpuBytesWithMipsEstimate}))).catch(error=>{console.error(error.stack??error.message);process.exitCode=1;});
}

// Offline, bounded CC0 preparation. Inputs remain private; output must be NEW.
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { reducePhotographicMap,meanLinearLuminance } from './prepare-aethelgard-photographic-ground.mjs';
const hash=(data,kind='sha256')=>createHash(kind).update(data).digest('hex');
// Public CC0 download identities, not private model identities. A changed
// official revision requires an intentional source/provenance update.
export const EALDHOLT_GRASS_SOURCES={
  albedo:{key:'Diffuse',suffix:'diff',bytes:1195394,md5:'0dbc071e91d6905edfcfbe8eb785a1ab'},
  normal:{key:'nor_gl',suffix:'nor_gl',bytes:1466049,md5:'8279e096e204ea326d57a318869f99df'},
  orm:{key:'arm',suffix:'arm',bytes:1010081,md5:'44fb4e40ef0f3425a7d1a14bc328e4d8'},
};
export function verifyEaldholtGrassSource(bytes,entry,role){
  const expected=EALDHOLT_GRASS_SOURCES[role];if(!expected)throw Error('Invalid grass source role.');
  const url=`https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/leafy_grass/leafy_grass_${expected.suffix}_1k.jpg`;
  if(entry?.url!==url||entry.size!==expected.bytes||entry.md5!==expected.md5||bytes.length!==expected.bytes||hash(bytes,'md5')!==expected.md5)throw Error('Grass official source URL, size or fixed MD5 mismatch.');
  return{url,bytes:bytes.length,md5:expected.md5,sha256:hash(bytes)};
}
export function grassTextureMipBytes(size){if(size!==512&&size!==1024)throw Error('Invalid canonical grass size.');let total=0;for(let n=size;n>=1;n/=2)total+=n*n*4;return total*3;}
export async function decodeEaldholtGrassSource(bytes){
  // These frozen inputs are8-bit JPEG. Decode their actual8-bit RGB directly;
  // an rgb16 cast can alter the source normalization by one encoded level.
  const{data,info}=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
  if(info.width!==1024||info.height!==1024||info.channels!==3)throw Error('Expected official1024px RGB grass source.');
  return{size:1024,values:Float32Array.from(data,value=>value/255),originalRgb:data};
}
export async function prepareEaldholtGrassGround(sourceDirectory,outputDirectory){
  const input=resolve(sourceDirectory),output=resolve(outputDirectory);if(input===output)throw Error('Use a separate new output directory.');
  const[infoBytes,filesBytes,licence,licensePage]=await Promise.all(['metadata/leafy_grass-info.json','metadata/leafy_grass-files.json','licenses/CC0-1.0-legalcode.txt','licenses/polyhaven-license.html'].map(file=>readFile(join(input,file))));
  const info=JSON.parse(infoBytes),files=JSON.parse(filesBytes);
  if(info.type!==1||info.name!=='Leafy Grass'||!info.authors||!Array.isArray(info.dimensions)||info.dimensions.length!==2||info.dimensions.some(v=>v!==2000)||!licence.includes('CC0 1.0 Universal')||!licensePage.includes('CC0'))throw Error('Missing official grass identity/dimensions/CC0 evidence.');
  const decoded={},sources={};
  for(const[role,expected]of Object.entries(EALDHOLT_GRASS_SOURCES)){
    const bytes=await readFile(join(input,'source',`leafy_grass_${expected.suffix}_1k.jpg`));sources[role]=verifyEaldholtGrassSource(bytes,files[expected.key]?.['1k']?.jpg,role);decoded[role]=await decodeEaldholtGrassSource(bytes);sources[role].decodedRgbSha256=hash(decoded[role].originalRgb);
  }
  await mkdir(output,{recursive:false});
  const manifest={version:1,assetId:'leafy_grass',sourceUrl:'https://polyhaven.com/a/leafy_grass',licence:'CC0-1.0',authors:info.authors,tileMetres:2,
    colour:{albedo:'sRGB RGB; opaque, untinted source photograph',normal:'OpenGL tangent-space +Y; linear; vectors renormalized',orm:'Linear R=source AO,G=source roughness,B=source metallic',orientation:'Source rows preserved; configure flipY=false for all three maps'},profiles:{}};
  const evidence={assetId:'leafy_grass',licence:{spdx:'CC0-1.0',officialUrl:'https://polyhaven.com/license',legalCodeUrl:'https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt',officialPageSha256:hash(licensePage),legalCodeSha256:hash(licence)},
    sourceUrl:manifest.sourceUrl,authors:info.authors,infoApi:'https://api.polyhaven.com/info/leafy_grass',filesApi:'https://api.polyhaven.com/files/leafy_grass',infoSha256:hash(infoBytes),filesSha256:hash(filesBytes),sources,
    processing:'No tint, source-geometry or material changes. Linear-light box reduction for albedo; linear ARM reduction; normal vectors averaged and renormalized. Deterministic lossless WebP from decoded RGB. Opaque surface, not an alpha blade or displaced grass mesh.',files:[]};
  for(const[profile,size]of[['desktop',1024],['quest',512]]){
    const entry={size,meanLuminance:0,files:{},gpuBytesWithMipsEstimate:grassTextureMipBytes(size)};
    for(const role of['albedo','normal','orm']){
      const pixels=reducePhotographicMap(decoded[role],size,role==='orm'?'data':role),bytes=await sharp(Buffer.from(pixels),{raw:{width:size,height:size,channels:4}}).removeAlpha().webp({lossless:true,effort:6}).toBuffer();
      if(size===1024&&role!=='normal'){const rgb=Buffer.alloc(size*size*3);for(let i=0;i<size*size;i++)for(let c=0;c<3;c++)rgb[i*3+c]=pixels[i*4+c];if(!rgb.equals(decoded[role].originalRgb))throw Error('Grass source RGB must remain exact at1024px.');}
      const result=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});if(result.info.width!==size||result.info.height!==size||!result.data.equals(Buffer.from(pixels)))throw Error('Lossless grass image round-trip mismatch.');
      if(role==='albedo')entry.meanLuminance=meanLinearLuminance(pixels);
      const file=`grass-${profile}-${role}-${size}.webp`,record={file,size,bytes:bytes.length,sha256:hash(bytes)};await writeFile(join(output,file),bytes,{flag:'wx'});entry.files[role]=record;evidence.files.push(record);
    }
    manifest.profiles[profile]=entry;
  }
  await writeFile(join(output,'CC0-1.0.txt'),licence,{flag:'wx'});
  await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  await writeFile(join(output,'provenance.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
  await writeFile(join(output,'SOURCES.md'),'# Leafy Grass ground material\n\nPowered by Poly Haven. Leafy Grass — Charlotte Baglioni: https://polyhaven.com/a/leafy_grass . CC0-1.0; official licence https://polyhaven.com/license . Legal code is included in CC0-1.0.txt.\n\nActual trampled grass with scattered brown litter, photographed as a2m tile. This is optional original outside-valley ground treatment, not recovered village landscape painting. Albedo chroma is retained. Desktop uses1024px maps, Quest512px maps; OpenGL normals and linear ARM stay aligned. Full mip-chain RGBA8 byte figures are added owned estimates, not physical GPU or net-memory measurements.\n\nSource URLs, fixed official MD5/size checks and source/derived SHA256 hashes are in provenance.json/manifest.json. Original downloads remain outside the repository. Reproduce with node scripts/prepare-ealdholt-grass-ground.mjs PRIVATE_INTAKE_DIRECTORY NEW_OUTPUT_DIRECTORY . No runtime requests occur unless the caller invokes the canonical grass-map loader.\n',{flag:'wx'});
  return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length!==4){console.error('Usage: node scripts/prepare-ealdholt-grass-ground.mjs PRIVATE_INTAKE_DIRECTORY NEW_OUTPUT_DIRECTORY');process.exitCode=1;}
  else prepareEaldholtGrassGround(process.argv[2],process.argv[3]).then(manifest=>console.log(JSON.stringify(manifest.profiles))).catch(error=>{console.error(error.stack??error.message);process.exitCode=1;});
}

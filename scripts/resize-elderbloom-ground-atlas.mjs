// Private derivative only: replace the verified generated atlas image, preserving
// all geometry, source texture bytes, materials, instances and source transforms.
import { readFile, writeFile, stat, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function parse(bytes) {
  if(bytes.length<28||bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)throw Error('Expected GLB2 JSON+BIN.');
  const at=20+bytes.readUInt32LE(12);
  if(at+8>bytes.length||bytes.readUInt32LE(at+4)!==0x004e4942||at+8+bytes.readUInt32LE(at)!==bytes.length)throw Error('Invalid GLB binary chunk.');
  return {json:JSON.parse(bytes.subarray(20,at).toString('utf8')),binary:bytes.subarray(at+8)};
}
function encode(json,binary) {
  let text=Buffer.from(JSON.stringify(json));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,0x20)]);
  const output=Buffer.alloc(28+text.length+binary.length),at=20+text.length;
  output.writeUInt32LE(0x46546c67,0);output.writeUInt32LE(2,4);output.writeUInt32LE(output.length,8);
  output.writeUInt32LE(text.length,12);output.writeUInt32LE(0x4e4f534a,16);text.copy(output,20);
  output.writeUInt32LE(binary.length,at);output.writeUInt32LE(0x004e4942,at+4);binary.copy(output,at+8);return output;
}
function imageBytes(g,image) {
  const view=g.json.bufferViews[image.bufferView];
  if(!view||view.buffer!==0||image.uri||(view.byteOffset??0)+view.byteLength>g.binary.length)throw Error('Expected bounded embedded images.');
  return g.binary.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);
}
async function gpuEstimate(g) {
  let textureBytes=0;
  for(const image of g.json.images??[]) {
    const m=await sharp(imageBytes(g,image)).metadata();if(!m.width||!m.height)throw Error('Unknown image dimensions.');
    textureBytes+=Math.ceil(m.width*m.height*4*4/3);
  }
  const geometryBytes=g.json.bufferViews.filter(v=>v.target===34962||v.target===34963).reduce((n,v)=>n+v.byteLength,0);
  return {textureBytes,geometryBytes,combined:textureBytes+geometryBytes};
}
export async function resizeElderbloomGroundAtlas(inputPath,outputPath) {
  const input=await realpath(inputPath),output=resolve(outputPath),parent=await realpath(dirname(output));
  if(input===output||parent===repository||parent.startsWith(repository+'/'))throw Error('Use a separate private output outside the repository.');
  try{await stat(output);throw Error('Output exists; earlier derivatives must remain unchanged.');}catch(error){if(error.code!=='ENOENT')throw error;}
  if((await stat(input)).size>256*1024*1024)throw Error('Expected optimized derivative below256MiB, not the original GLB.');
  const bytes=await readFile(input),g=parse(bytes),before=await gpuEstimate(g),j=g.json;
  const indices=(j.images??[]).flatMap((image,index)=>image.name==='Crownfall_AethelgardGroundAtlas'?[index]:[]);
  if(indices.length!==1)throw Error('Expected exactly one verified generated ground atlas.');
  const index=indices[0],image=j.images[index],source=imageBytes(g,image),metadata=await sharp(source).metadata();
  if(metadata.width!==2048||metadata.height!==2048||image.mimeType!=='image/png')throw Error('Expected original2048px generated PNG atlas.');
  const imageTextures=new Set(j.textures.flatMap((t,i)=>t.source===index?[i]:[]));
  const references=j.materials.filter(m=>imageTextures.has(m.pbrMetallicRoughness?.baseColorTexture?.index));
  if(!references.length||references.some(m=>!m.name?.startsWith('Crownfall_LAAS_')||!m.extras?.crownfallTerrainRepair))throw Error('Atlas has an unverified material use.');
  const png=await sharp(source).resize(1024,1024,{kernel:'lanczos3'}).png({compressionLevel:9,adaptiveFiltering:true}).toBuffer();
  const start=g.binary.length+(4-g.binary.length%4)%4,pad=(4-png.length%4)%4;
  const binary=Buffer.concat([g.binary,Buffer.alloc(start-g.binary.length),png,Buffer.alloc(pad)]);
  const oldView=image.bufferView;image.bufferView=j.bufferViews.length;
  j.bufferViews.push({buffer:0,byteOffset:start,byteLength:png.length});j.buffers[0].byteLength=binary.length;
  const outputBytes=encode(j,binary),after=await gpuEstimate({json:j,binary});
  if(!binary.subarray(0,g.binary.length).equals(g.binary))throw Error('Source binary prefix changed.');
  const old=parse(bytes),normalized=structuredClone(j);normalized.images[index].bufferView=oldView;
  normalized.bufferViews.pop();normalized.buffers[0].byteLength=old.json.buffers[0].byteLength;
  if(JSON.stringify(normalized)!==JSON.stringify(old.json))throw Error('Unrelated GLB metadata changed.');
  const report={input,output,bytes:outputBytes.length,sha256:sha(outputBytes),sourceSha256:sha(bytes),
    atlas:{image:index,beforeSize:2048,afterSize:1024,sourceSha256:sha(source),sha256:sha(png)},
    before,after,freedTextureBytes:before.textureBytes-after.textureBytes,
    allGeometryMaterialsNodesAndTransformsPreserved:true,originalBinaryPrefixPreserved:true,
    limits:'Only the generated macro atlas is downsampled. Conservative metadata texture+geometry estimates are not measured GPU or headset performance. Earlier source/derivatives remain unchanged.'};
  await writeFile(output,outputBytes,{flag:'wx'});await writeFile(output+'.atlas-resize.json',JSON.stringify(report,null,2),{flag:'wx'});return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.length!==4){console.error('Usage: node scripts/resize-elderbloom-ground-atlas.mjs private-input.glb separate-private-output.glb');process.exitCode=1;}
  else resizeElderbloomGroundAtlas(process.argv[2],process.argv[3]).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.stack??e.message);process.exitCode=1;});
}

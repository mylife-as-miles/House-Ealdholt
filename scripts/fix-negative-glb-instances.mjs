// Offline GLB correctness repair. Geometry, materials and original BIN bytes are
// retained; negative-scale instances become ordinary mesh children of their node.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const widths={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
const sizes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
function decode(bytes){
 if(bytes.length<28||bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)throw new Error('Expected complete GLB2.');
 const jsonLength=bytes.readUInt32LE(12),binHeader=20+jsonLength;
 if(bytes.readUInt32LE(16)!==0x4e4f534a||binHeader+8>bytes.length||bytes.readUInt32LE(binHeader+4)!==0x004e4942||binHeader+8+bytes.readUInt32LE(binHeader)!==bytes.length)throw new Error('Expected one JSON and one BIN chunk.');
 const json=JSON.parse(bytes.subarray(20,binHeader).toString('utf8')),bin=bytes.subarray(binHeader+8);
 if(json.buffers?.length!==1||json.buffers[0].uri)throw new Error('Expected one embedded buffer.');
 return {json,bin};
}
function accessorSource(json,bin,index){
 const a=json.accessors[index],view=json.bufferViews[a?.bufferView],size=sizes[a?.componentType],width=widths[a?.type];
 if(!a||!view||!size||!width||a.sparse||view.buffer!==0)throw new Error('Unsupported instancing accessor.');
 const elementBytes=size*width,stride=view.byteStride??elementBytes,offset=(view.byteOffset??0)+(a.byteOffset??0);
 if(!Number.isSafeInteger(a.count)||a.count<1||offset+(a.count-1)*stride+elementBytes>bin.length)throw new Error('Invalid instancing accessor bounds.');
 return {a,view,size,width,elementBytes,stride,offset};
}
function readValues(json,bin,index){
 const r=accessorSource(json,bin,index),values=[];
 const methods={5120:'readInt8',5121:'readUInt8',5122:'readInt16LE',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'};
 for(let i=0;i<r.a.count;i++)for(let j=0;j<r.width;j++)values.push(bin[methods[r.a.componentType]](r.offset+i*r.stride+j*r.size));
 return values;
}
function totals(json){let instances=0,triangles=0;for(const n of json.nodes??[]){if(n.mesh===undefined)continue;const attrs=n.extensions?.EXT_mesh_gpu_instancing?.attributes,count=attrs?json.accessors[Object.values(attrs)[0]].count:1;instances+=count;triangles+=(json.meshes[n.mesh].primitives??[]).reduce((sum,p)=>{const count=json.accessors[p.indices??p.attributes.POSITION].count,mode=p.mode??4;return sum+(mode===4?count/3:mode===5||mode===6?Math.max(0,count-2):0);},0)*count;}return {instances,triangles};}
export function repairNegativeGlbInstances(input){
 const {json,bin}=decode(input),out=structuredClone(json),before=totals(json),chunks=[bin],repairs=[];let length=bin.length;
 function compactAccessor(index,keep){
  const r=accessorSource(json,bin,index),packed=Buffer.alloc(keep.length*r.elementBytes);for(let i=0;i<keep.length;i++)bin.copy(packed,i*r.elementBytes,r.offset+keep[i]*r.stride,r.offset+keep[i]*r.stride+r.elementBytes);
  const padding=(4-length%4)%4;if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}
  const viewIndex=out.bufferViews.length;out.bufferViews.push({buffer:0,byteOffset:length,byteLength:packed.length,...(r.view.target?{target:r.view.target}:{})});chunks.push(packed);length+=packed.length;
  const accessor={...r.a,bufferView:viewIndex,count:keep.length};delete accessor.byteOffset;delete accessor.min;delete accessor.max;
  const result=out.accessors.length;out.accessors.push(accessor);return result;
 }
 for(let nodeIndex=0;nodeIndex<json.nodes.length;nodeIndex++){
  const original=json.nodes[nodeIndex],attributes=original.extensions?.EXT_mesh_gpu_instancing?.attributes;if(!attributes)continue;
  if(original.mesh===undefined)throw new Error('Instancing node has no mesh.');
  if(Object.keys(attributes).some(name=>!['TRANSLATION','ROTATION','SCALE'].includes(name)))throw new Error('Custom instance attributes need an explicit ordinary-mesh adaptation.');
  const count=json.accessors[Object.values(attributes)[0]].count;for(const id of Object.values(attributes))if(json.accessors[id].count!==count)throw new Error('Instance attribute counts differ.');
  const scale=attributes.SCALE!==undefined?readValues(json,bin,attributes.SCALE):Array(count*3).fill(1),positive=[],negative=[];
  for(let i=0;i<count;i++){const product=scale[i*3]*scale[i*3+1]*scale[i*3+2];if(!Number.isFinite(product)||product===0)throw new Error('Nonfinite or zero instance determinant.');(product<0?negative:positive).push(i);}
  if(!negative.length)continue;
  const node=out.nodes[nodeIndex],translation=attributes.TRANSLATION!==undefined?readValues(json,bin,attributes.TRANSLATION):null,rotation=attributes.ROTATION!==undefined?readValues(json,bin,attributes.ROTATION):null,fallbackNodes=[];
  for(const instanceIndex of negative){const child={name:`${original.name??'Mesh'}_NegativeScale_${instanceIndex}`,mesh:original.mesh,scale:scale.slice(instanceIndex*3,instanceIndex*3+3)};if(translation)child.translation=translation.slice(instanceIndex*3,instanceIndex*3+3);if(rotation)child.rotation=rotation.slice(instanceIndex*4,instanceIndex*4+4);fallbackNodes.push(out.nodes.length);out.nodes.push(child);}
  node.children=[...(node.children??[]),...fallbackNodes];
  if(positive.length){const compact={};for(const[name,id]of Object.entries(attributes))compact[name]=compactAccessor(id,positive);node.extensions.EXT_mesh_gpu_instancing.attributes=compact;}
  else {delete node.mesh;delete node.extensions.EXT_mesh_gpu_instancing;if(!Object.keys(node.extensions).length)delete node.extensions;}
  repairs.push({nodeIndex,name:original.name??null,originalInstances:count,positiveInstances:positive.length,ordinaryNegativeInstances:negative.length,sourceNegativeIndices:negative,fallbackNodes});
 }
 if(!repairs.length)return {bytes:input,report:{changed:false,repairs,before,after:before,originalBinaryPrefixPreserved:true}};
 const hasInstances=out.nodes.some(n=>n.extensions?.EXT_mesh_gpu_instancing);if(!hasInstances){out.extensionsUsed=out.extensionsUsed?.filter(name=>name!=='EXT_mesh_gpu_instancing');out.extensionsRequired=out.extensionsRequired?.filter(name=>name!=='EXT_mesh_gpu_instancing');}
 const after=totals(out);if(before.instances!==after.instances||before.triangles!==after.triangles)throw new Error('Repair changed geometry instance or triangle totals.');
 const padding=(4-length%4)%4;if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}out.buffers[0].byteLength=length;
 const rawJSON=Buffer.from(JSON.stringify(out)),jsonPadding=(4-rawJSON.length%4)%4,jsonChunk=Buffer.concat([rawJSON,Buffer.alloc(jsonPadding,0x20)]),header=Buffer.alloc(20),binHeader=Buffer.alloc(8);
 header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+jsonChunk.length+length,8);header.writeUInt32LE(jsonChunk.length,12);header.writeUInt32LE(0x4e4f534a,16);binHeader.writeUInt32LE(length,0);binHeader.writeUInt32LE(0x004e4942,4);
 const bytes=Buffer.concat([header,jsonChunk,binHeader,...chunks]),repaired=decode(bytes);if(!repaired.bin.subarray(0,bin.length).equals(bin))throw new Error('Original binary geometry prefix changed.');
 let negativeInstancedScales=0;for(const n of repaired.json.nodes){const id=n.extensions?.EXT_mesh_gpu_instancing?.attributes?.SCALE;if(id===undefined)continue;const scale=readValues(repaired.json,repaired.bin,id);for(let i=0;i<scale.length;i+=3)if(scale[i]*scale[i+1]*scale[i+2]<=0)negativeInstancedScales++;}if(negativeInstancedScales)throw new Error('Unsupported instance scales remain.');
 return {bytes,report:{changed:true,repairs,before,after,negativeInstancedScales,ordinaryNegativeMeshesCreated:repairs.reduce((n,r)=>n+r.ordinaryNegativeInstances,0),originalBinaryPrefixPreserved:true,appendedBinaryBytes:length-bin.length}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(!process.argv[2]||!process.argv[3])throw new Error('Usage: node scripts/fix-negative-glb-instances.mjs input.glb output.glb');
 const source=resolve(process.argv[2]),destination=resolve(process.argv[3]);if(source===destination)throw new Error('Use a separate output file.');
 const original=await readFile(source),result=repairNegativeGlbInstances(original),report={source,destination,sourceBytes:original.length,outputBytes:result.bytes.length,sourceSHA256:createHash('sha256').update(original).digest('hex'),outputSHA256:createHash('sha256').update(result.bytes).digest('hex'),...result.report};await mkdir(dirname(destination),{recursive:true});await writeFile(destination,result.bytes,{flag:'wx'});await writeFile(destination+'.negative-instance-report.json',JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report,null,2));
}

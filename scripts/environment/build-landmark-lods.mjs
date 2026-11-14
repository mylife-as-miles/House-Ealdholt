// Static far-scenery index LODs. Keep every source vertex/UV and embedded PBR
// image byte; only drawing indices change. Meshoptimizer is WASM, build-time only.
import {MeshoptSimplifier} from 'meshoptimizer';
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';
import {readSource} from '../prepare-ealdholt-tree-lod.mjs';
const input=resolve(process.argv[2]??'main game/public/assets/legacy/environment/aethelgard/regional-v1'),output=resolve(process.argv[3]??input);await mkdir(output,{recursive:true});await MeshoptSimplifier.ready;
const report={source:'Solstice MIT recipes / Poly Haven CC0 models',generator:'crownfall-landmark-index-lod-v1',files:{}};
for(const id of ['western-fort','temple-ruins']){
 const name=id+'-quest.glb',source=await readSource(join(input,name));
 try{const bytes=await readFile(join(input,name)),j=structuredClone(source.j),length=bytes.readUInt32LE(12),binary=bytes.subarray(28+length,28+length+j.buffers[0].byteLength);const parts=[binary];let offset=binary.length,original=0,triangles=0;
 for(const mesh of j.meshes)for(const primitive of mesh.primitives){const indices=Uint32Array.from(await source.values(primitive.indices)),positions=Float32Array.from(await source.values(primitive.attributes.POSITION));
  const [result,error]=MeshoptSimplifier.simplify(indices,positions,3,Math.max(6,Math.floor(indices.length*.12/3)*3),.018);original+=indices.length/3;triangles+=result.length/3;
  if(error>.019||result.length>indices.length||!result.length)throw Error('Unqualified landmark simplification.');
  const pad=(4-offset%4)%4;if(pad){parts.push(Buffer.alloc(pad));offset+=pad;}
  const data=Buffer.from(result.buffer,result.byteOffset,result.byteLength),view=j.bufferViews.length;j.bufferViews.push({buffer:0,byteOffset:offset,byteLength:data.length,target:34963});parts.push(data);offset+=data.length;
  primitive.indices=j.accessors.length;j.accessors.push({bufferView:view,byteOffset:0,componentType:5125,count:result.length,type:'SCALAR'});
 }
 j.asset.generator='Crownfall distant landmark index LOD (meshoptimizer WASM)';j.buffers[0].byteLength=offset;
 const text=Buffer.from(JSON.stringify(j)),jsonPadding=(4-text.length%4)%4,json=Buffer.concat([text,Buffer.alloc(jsonPadding,32)]),bin=Buffer.concat([...parts,Buffer.alloc((4-offset%4)%4)]),head=Buffer.alloc(20),bh=Buffer.alloc(8);
 head.writeUInt32LE(0x46546c67);head.writeUInt32LE(2,4);head.writeUInt32LE(28+json.length+bin.length,8);head.writeUInt32LE(json.length,12);head.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);
 const data=Buffer.concat([head,json,bh,bin]),target=id+'-far.glb';await writeFile(join(output,target),data);report.files[target]={bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),sourceSha256:createHash('sha256').update(bytes).digest('hex'),triangles,originalTriangles:original};
 }finally{await source.close();}
}
await writeFile(join(output,'landmark-lods.manifest.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));

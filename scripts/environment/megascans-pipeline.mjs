/** Offline-only private derivatives. No downloads, purchases, scene writes or asset substitution. */
import {readFile,writeFile,mkdir,lstat,realpath,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,dirname,basename,relative,isAbsolute,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import sharp from 'sharp';

export const SCHEMA='crownfall-megascans-derived-v1';
const REPO=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const MAX_BYTES=128*1024*1024,MAX_PIXELS=4096*4096,MAX_VERTICES=2_000_000;
const WIDTH={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
const COMPONENT={5120:[1,'getInt8'],5121:[1,'getUint8'],5122:[2,'getInt16'],5123:[2,'getUint16'],5125:[4,'getUint32'],5126:[4,'getFloat32']};
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const inside=(root,path)=>{const r=relative(root,path);return r===''||!isAbsolute(r)&&r!=='..'&&!r.startsWith('../');};
export function privateOutput(path){const p=resolve(path);if(inside(REPO,p))throw Error('Derived binaries must remain outside the repository.');return p;}
export function confined(root,uri){
 if(typeof uri!=='string'||!uri||/^[a-z][a-z\d+.-]*:|[?#\u0000-\u001f]/i.test(uri)||isAbsolute(uri))throw Error('External resources must be relative local files.');
 const decoded=decodeURIComponent(uri);if(/[\\\u0000-\u001f]/.test(decoded))throw Error('Resource URI must use safe forward-slash paths.');const path=resolve(root,decoded);if(!inside(root,path))throw Error('External resource escapes its source directory.');return path;
}
export async function boundedRead(path){const s=await lstat(path);if(s.isSymbolicLink()||!s.isFile()||s.size>MAX_BYTES)throw Error('Unsupported, linked or oversized input: '+path);return readFile(path);}
export function parseGlb(bytes){
 if(bytes.length<28||bytes.length>MAX_BYTES||bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)throw Error('Expected a bounded complete GLB2.');
 const size=bytes.readUInt32LE(12),offset=20+size;if(size%4||offset+8>bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a||bytes.readUInt32LE(offset+4)!==0x004e4942||offset+8+bytes.readUInt32LE(offset)!==bytes.length)throw Error('Invalid GLB chunk boundaries.');
 const json=JSON.parse(bytes.toString('utf8',20,offset)),bin=bytes.subarray(offset+8);
 if(json.asset?.version!=='2.0'||json.buffers?.length!==1||json.buffers[0].uri||json.buffers[0].byteLength>bin.length)throw Error('Requires a single embedded glTF2 buffer.');
 for(const view of json.bufferViews??[])if(view.buffer!==0||!Number.isSafeInteger(view.byteLength)||view.byteLength<0||(view.byteOffset??0)<0||(view.byteOffset??0)+view.byteLength>bin.length)throw Error('Invalid source buffer view.');
 return{json,bin};
}
export function readAccessor(glb,index){
 const a=glb.json.accessors?.[index],v=glb.json.bufferViews?.[a?.bufferView],size=COMPONENT[a?.componentType]?.[0],width=WIDTH[a?.type];
 if(!a||!v||a.sparse||!size||!width||width>4||!Number.isSafeInteger(a.count)||a.count<1||a.count>MAX_VERTICES)throw Error('Compression needs a bounded, ordinary scalar/vector accessor.');
 const stride=v.byteStride??size*width,start=(v.byteOffset??0)+(a.byteOffset??0),end=start+(a.count-1)*stride+width*size;
 if(stride<size*width||end>(v.byteOffset??0)+v.byteLength)throw Error('Accessor exceeds its buffer view.');
 const values=a.componentType===5126?new Float32Array(a.count*width):new Int32Array(a.count*width),data=new DataView(glb.bin.buffer,glb.bin.byteOffset,glb.bin.byteLength),method=COMPONENT[a.componentType][1];
 for(let i=0;i<a.count;i++)for(let c=0;c<width;c++){const x=data[method](start+i*stride+c*size,true);if(!Number.isFinite(x)||a.componentType===5125&&x>0x7fffffff)throw Error('Nonfinite/out-of-range vertex data.');values[i*width+c]=x;}
 return{accessor:a,values,width};
}
export async function dracoModules(modulePath){
 const require=createRequire(import.meta.url),entry=await realpath(resolve(modulePath)),pkg=JSON.parse(await readFile(join(dirname(entry),'package.json'),'utf8'));
 if(pkg.name!=='draco3d'||pkg.version!=='1.5.7')throw Error('Use the explicitly supplied pinned draco3d@1.5.7 module entry.');
 const api=require(entry);return{encoder:await api.createEncoderModule({}),decoder:await api.createDecoderModule({}),version:pkg.version,entrySha256:digest(await readFile(entry))};
}
function decodedPrimitive(glb,primitive,decoder){
 const ext=primitive.extensions?.KHR_draco_mesh_compression,view=glb.json.bufferViews[ext?.bufferView];if(!ext||!view)throw Error('Missing compressed primitive.');
 const dec=new decoder.Decoder(),buffer=new decoder.DecoderBuffer(),mesh=new decoder.Mesh(),face=new decoder.DracoInt32Array();
 try{
  const raw=glb.bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);buffer.Init(new Int8Array(raw.buffer,raw.byteOffset,raw.length),raw.length);
  const status=dec.DecodeBufferToMesh(buffer,mesh);if(!status.ok())throw Error('Draco decode failed: '+status.error_msg());
  const indices=new Int32Array(mesh.num_faces()*3);for(let i=0;i<mesh.num_faces();i++){dec.GetFaceFromMesh(mesh,i,face);for(let c=0;c<3;c++)indices[i*3+c]=face.GetValue(c);}
  const attributes={};for(const[semantic,id]of Object.entries(ext.attributes)){
   const accessor=glb.json.accessors[primitive.attributes[semantic]],attribute=dec.GetAttributeByUniqueId(mesh,id),isFloat=accessor.componentType===5126;
   const array=isFloat?new decoder.DracoFloat32Array():new decoder.DracoInt32Array();
   try{const ok=isFloat?dec.GetAttributeFloatForAllPoints(mesh,attribute,array):dec.GetAttributeIntForAllPoints(mesh,attribute,array);if(!ok)throw Error('Unable to decode attribute '+semantic);attributes[semantic]=isFloat?Float32Array.from({length:array.size()},(_,i)=>array.GetValue(i)):Int32Array.from({length:array.size()},(_,i)=>array.GetValue(i));}finally{decoder.destroy(array);}
  }
  return{indices,attributes,vertices:mesh.num_points()};
 }finally{decoder.destroy(face);decoder.destroy(mesh);decoder.destroy(buffer);decoder.destroy(dec);}
}
export function verifyPrimitive(source,sourcePrimitive,output,primitive,decoder){
 const decoded=decodedPrimitive(output,primitive,decoder),position=readAccessor(source,sourcePrimitive.attributes.POSITION);
 assert.equal(decoded.vertices,position.accessor.count,'Draco must preserve vertex order/count for morph/skin/instancing safety.');
 const indices=sourcePrimitive.indices===undefined?Int32Array.from({length:position.accessor.count},(_,i)=>i):readAccessor(source,sourcePrimitive.indices).values;
 assert.deepEqual(decoded.indices,Int32Array.from(indices),'Triangle winding/order must be exact.');
 const evidence={vertices:decoded.vertices,triangles:indices.length/3,indicesExact:true,attributes:{}};
 for(const[semantic,index]of Object.entries(sourcePrimitive.attributes)){
  const expected=readAccessor(source,index).values;assert.deepEqual(decoded.attributes[semantic],expected,'Draco changed '+semantic);
  evidence.attributes[semantic]={componentType:source.json.accessors[index].componentType,normalized:source.json.accessors[index].normalized??false,values:expected.length,maxError:0};
 }
 return evidence;
}
export function compressGeometry(source,encoder){
 if((source.json.meshes??[]).reduce((sum,m)=>sum+m.primitives.length,0)>256||(source.json.images?.length??0)>64||(source.json.nodes?.length??0)>10000)throw Error('Asset exceeds the bounded primitive/image/node inventory.');
 if((source.json.extensionsUsed??[]).some(x=>['KHR_draco_mesh_compression','EXT_meshopt_compression'].includes(x)))throw Error('Provide the uncompressed original, not a precompressed model.');
 const json=clone(source.json),chunks=(source.json.bufferViews??[]).map(v=>source.bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength)),encodedAccessors=new Set(),protectedAccessors=new Set(),records=[];
 for(const animation of json.animations??[])for(const s of animation.samplers??[]){protectedAccessors.add(s.input);protectedAccessors.add(s.output);}
 for(const skin of json.skins??[])if(skin.inverseBindMatrices!==undefined)protectedAccessors.add(skin.inverseBindMatrices);
 for(const node of json.nodes??[])for(const i of Object.values(node.extensions?.EXT_mesh_gpu_instancing?.attributes??{}))protectedAccessors.add(i);
 for(const mesh of json.meshes??[])for(const p of mesh.primitives){for(const target of p.targets??[])for(const i of Object.values(target))protectedAccessors.add(i);if((p.mode??4)!==4){for(const i of Object.values(p.attributes))protectedAccessors.add(i);if(p.indices!==undefined)protectedAccessors.add(p.indices);}}
 for(let mi=0;mi<(json.meshes?.length??0);mi++)for(let pi=0;pi<json.meshes[mi].primitives.length;pi++){
  const p=json.meshes[mi].primitives[pi];if((p.mode??4)!==4){records.push({mesh:mi,primitive:pi,compressed:false,reason:'non-triangle primitive retained'});continue;}
  const position=readAccessor(source,p.attributes.POSITION),builder=new encoder.MeshBuilder(),mesh=new encoder.Mesh(),enc=new encoder.Encoder(),bytes=new encoder.DracoInt8Array(),attributes={};
  try{
   for(const[semantic,index]of Object.entries(p.attributes)){
    const a=readAccessor(source,index);if(a.accessor.count!==position.accessor.count)throw Error('Mismatched primitive attribute counts.');
    const type=semantic==='POSITION'?encoder.POSITION:semantic==='NORMAL'?encoder.NORMAL:semantic.startsWith('TEXCOORD_')?encoder.TEX_COORD:semantic.startsWith('COLOR_')?encoder.COLOR:encoder.GENERIC;
    const id=a.accessor.componentType===5126?builder.AddFloatAttributeToMesh(mesh,type,a.accessor.count,a.width,a.values):builder.AddInt32AttributeToMesh(mesh,type,a.accessor.count,a.width,a.values);
    if(id<0)throw Error('Draco rejected '+semantic);if(a.accessor.normalized)builder.SetNormalizedFlagForAttribute(mesh,id,true);attributes[semantic]=id;encodedAccessors.add(index);
   }
   let indices;if(p.indices===undefined){indices=Int32Array.from({length:position.accessor.count},(_,i)=>i);p.indices=json.accessors.length;json.accessors.push({componentType:5125,count:indices.length,type:'SCALAR'});}else{indices=readAccessor(source,p.indices).values;encodedAccessors.add(p.indices);}
   if(indices.length%3||indices.some(i=>i<0||i>=position.accessor.count))throw Error('Invalid triangle indices.');
   builder.AddFacesToMesh(mesh,indices.length/3,indices);enc.SetSpeedOptions(5,5);enc.SetEncodingMethod(encoder.MESH_SEQUENTIAL_ENCODING);
   // No quantization: exact UV/tangent/weight and vertex/triangle order are verified after decoding.
   const count=enc.EncodeMeshToDracoBuffer(mesh,bytes);if(count<1)throw Error('Draco encoding failed.');
   const data=Buffer.from(Int8Array.from({length:count},(_,i)=>bytes.GetValue(i)));const view=json.bufferViews.length;json.bufferViews.push({buffer:0,byteLength:data.length});chunks.push(data);
   p.extensions={...p.extensions,KHR_draco_mesh_compression:{bufferView:view,attributes}};records.push({mesh:mi,primitive:pi,compressed:true,encodedBytes:data.length});
  }finally{encoder.destroy(bytes);encoder.destroy(enc);encoder.destroy(mesh);encoder.destroy(builder);}
 }
 if(!records.some(r=>r.compressed))throw Error('No compressible triangle geometry.');
 for(const index of encodedAccessors)if(!protectedAccessors.has(index)){delete json.accessors[index].bufferView;delete json.accessors[index].byteOffset;}
 json.extensionsUsed=[...new Set([...(json.extensionsUsed??[]),'KHR_draco_mesh_compression'])];json.extensionsRequired=[...new Set([...(json.extensionsRequired??[]),'KHR_draco_mesh_compression'])];
 return{json,chunks,records};
}
export function packGlb(json,chunks){
 json=clone(json);const used=new Set();function visit(value,collect){if(!value||typeof value!=='object')return;for(const[k,v]of Object.entries(value)){if(k==='bufferView'&&Number.isInteger(v)){if(collect)used.add(v);else value[k]=map.get(v);}else visit(v,collect);}}
 visit(json,true);const map=new Map(),views=[],parts=[];let length=0;
 for(const old of [...used].sort((a,b)=>a-b)){const bytes=chunks[old];if(!bytes)throw Error('Unknown referenced buffer view.');const pad=(4-length%4)%4;if(pad){parts.push(Buffer.alloc(pad));length+=pad;}map.set(old,views.length);views.push({...json.bufferViews[old],buffer:0,byteOffset:length,byteLength:bytes.length});parts.push(bytes);length+=bytes.length;}
 visit(json,false);json.bufferViews=views;json.buffers=[{byteLength:length}];
 const text=Buffer.from(JSON.stringify(json)),jp=(4-text.length%4)%4,bp=(4-length%4)%4,header=Buffer.alloc(20),bh=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+text.length+jp+length+bp,8);header.writeUInt32LE(text.length+jp,12);header.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(length+bp);bh.writeUInt32LE(0x004e4942,4);
 return Buffer.concat([header,text,Buffer.alloc(jp,32),bh,...parts,Buffer.alloc(bp)]);
}
export function semanticIdentity(json,original){
 const j=clone(json);delete j.buffers;delete j.bufferViews;
 for(const a of j.accessors??[]){delete a.bufferView;delete a.byteOffset;}
 for(const mesh of j.meshes??[])for(const p of mesh.primitives){if(p.extensions){delete p.extensions.KHR_draco_mesh_compression;if(!Object.keys(p.extensions).length)delete p.extensions;}}
 for(const key of ['extensionsUsed','extensionsRequired']){j[key]=(j[key]??[]).filter(x=>!['KHR_draco_mesh_compression','KHR_texture_basisu'].includes(x));if(!j[key].length)delete j[key];}
 for(const texture of j.textures??[])if(texture.extensions){delete texture.extensions.KHR_texture_basisu;if(!Object.keys(texture.extensions).length)delete texture.extensions;}
 function stripViews(value){if(!value||typeof value!=='object')return;for(const key of Object.keys(value))if(key==='bufferView')delete value[key];else stripViews(value[key]);}stripViews(j);
 if(original){if(original.images)j.images=(j.images??[]).slice(0,original.images.length);else delete j.images;j.accessors=j.accessors.slice(0,original.accessors.length);for(let m=0;m<j.meshes.length;m++)for(let p=0;p<j.meshes[m].primitives.length;p++)if(original.meshes[m].primitives[p].indices===undefined)delete j.meshes[m].primitives[p].indices;}
 return j;
}
export function textureRoles(json){
 const textureRoles=new Map(),add=(texture,role,cutoff)=>{if(!texture)return;const entry=textureRoles.get(texture.index)??{roles:new Set(),cutoffs:[]};entry.roles.add(role);if(cutoff!==undefined)entry.cutoffs.push(cutoff);textureRoles.set(texture.index,entry);};
 for(const material of json.materials??[]){const p=material.pbrMetallicRoughness??{};add(p.baseColorTexture,'srgb',material.alphaMode==='MASK'?(material.alphaCutoff??.5)/(p.baseColorFactor?.[3]??1):undefined);add(material.emissiveTexture,'srgb');add(p.metallicRoughnessTexture,'orm');add(material.occlusionTexture,'orm');add(material.normalTexture,'normal');
  for(const extension of Object.values(material.extensions??{}))for(const[k,v]of Object.entries(extension??{}))if(k.endsWith('Texture'))add(v,/ColorTexture|diffuseTexture|specularGlossinessTexture/.test(k)?'srgb':/normalTexture/i.test(k)?'normal':'linear');
 }
 const result=new Map();for(const[index,entry]of textureRoles){const texture=json.textures?.[index],image=texture?.extensions?.EXT_texture_webp?.source??texture?.source;if(!Number.isInteger(image))throw Error('Missing ordinary source image.');const current=result.get(image)??{roles:new Set(),cutoffs:[]};for(const role of entry.roles)current.roles.add(role);current.cutoffs.push(...entry.cutoffs);result.set(image,current);}
 for(const entry of result.values())if(entry.roles.has('srgb')&&entry.roles.size>1||entry.roles.has('normal')&&entry.roles.size>1)throw Error('An image has incompatible colour/data roles; author separate source images.');
 return result;
}
const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4,srgb=v=>v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055;
export function alphaCoverage(data,cutoff=.5){let count=0;for(let i=3;i<data.length;i+=4)if(data[i]/255>=cutoff)count++;return count/(data.length/4);}
export function coverageScale(data,target,cutoff){
 let best=Buffer.from(data),error=Math.abs(alphaCoverage(best,cutoff)-target),low=0,high=8;
 for(let step=0;step<24;step++){const scale=(low+high)/2,candidate=Buffer.from(data);for(let i=3;i<candidate.length;i+=4)candidate[i]=Math.min(255,Math.round(data[i]*scale));const coverage=alphaCoverage(candidate,cutoff),e=Math.abs(coverage-target);if(e<error){best=candidate;error=e;}if(coverage<target)low=scale;else high=scale;}
 const count=data.length/4;if(error<=1/count)return best;
 // Equal-alpha ties cannot be solved by scaling alone (e.g. a distant patch
 // of fine cutout leaves). Break only that tied mip-level coverage evenly;
 // preserve the opacity ranking and never edit the source/base level.
 const histogram=new Uint32Array(256);for(let i=3;i<data.length;i+=4)histogram[data[i]]++;
 const wanted=Math.round(target*count);let above=0,boundary=255;for(;boundary>0;boundary--){if(above+histogram[boundary]>=wanted)break;above+=histogram[boundary];}
 const needed=wanted-above,total=histogram[boundary],threshold=Math.ceil(cutoff*255);let seen=0;
 for(let i=3;i<best.length;i+=4){const alpha=data[i];let visible=alpha>boundary;if(alpha===boundary){visible=Math.floor((seen+1)*needed/total)>Math.floor(seen*needed/total);seen++;}best[i]=visible?Math.max(best[i],threshold):Math.min(best[i],threshold-1);}
 return best;
}
export function nextMip(level,role,cutoffs=[]){
 const width=Math.max(1,Math.floor(level.width/2)),height=Math.max(1,Math.floor(level.height/2)),data=Buffer.alloc(width*height*4),source=level.data;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const sums=[0,0,0,0];let count=0,weight=0;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const sx=Math.min(level.width-1,x*2+dx),sy=Math.min(level.height-1,y*2+dy),at=(sy*level.width+sx)*4,a=source[at+3]/255;count++;sums[3]+=a;
   if(role==='normal'){for(let c=0;c<3;c++)sums[c]+=source[at+c]/127.5-1;}
   else for(let c=0;c<3;c++)sums[c]+=(role==='srgb'?linear(source[at+c]/255):source[at+c]/255)*(role==='srgb'?a:1);
   weight+=role==='srgb'?a:1;
  }
  const at=(y*width+x)*4;if(role==='normal'){const length=Math.hypot(...sums.slice(0,3));for(let c=0;c<3;c++)data[at+c]=Math.round(((length?sums[c]/length:c===2?1:0)+1)*127.5);}else for(let c=0;c<3;c++){const v=weight?sums[c]/weight:0;data[at+c]=Math.round(Math.max(0,Math.min(1,role==='srgb'?srgb(v):v))*255);}data[at+3]=Math.round(sums[3]/count*255);
 }
 if(cutoffs.length>1&&new Set(cutoffs.map(v=>v.toFixed(8))).size>1)throw Error('Shared alpha-mask images with multiple cutoffs require authored separate atlases.');
 return{width,height,data:cutoffs.length?coverageScale(data,level.baseCoverage??alphaCoverage(level.data,cutoffs[0]),cutoffs[0]):data,baseCoverage:level.baseCoverage};
}
export function comparePixels(source,decoded,role,cutoffs=[]){
 if(source.length!==decoded.length)throw Error('Texture dimensions changed.');const sum=[0,0,0,0],maximum=[0,0,0,0];let angleSquares=0,angleMax=0;
 for(let i=0;i<source.length;i+=4){for(let c=0;c<4;c++){const error=Math.abs(source[i+c]-decoded[i+c]);sum[c]+=error*error;maximum[c]=Math.max(maximum[c],error);}if(role==='normal'){const a=[source[i]/127.5-1,source[i+1]/127.5-1,source[i+2]/127.5-1],b=[decoded[i]/127.5-1,decoded[i+1]/127.5-1,decoded[i+2]/127.5-1],length=Math.hypot(...a)*Math.hypot(...b),angle=length?Math.acos(Math.max(-1,Math.min(1,a.reduce((s,v,c)=>s+v*b[c],0)/length)))*180/Math.PI:0;angleSquares+=angle*angle;angleMax=Math.max(angleMax,angle);}}
 const rmse=sum.map(v=>Math.sqrt(v/(source.length/4))),normalRmsDegrees=Math.sqrt(angleSquares/(source.length/4));
 if(rmse.slice(0,3).some(e=>e>4)||rmse[3]>2||maximum[3]>12||role==='normal'&&(normalRmsDegrees>3||angleMax>20))throw Error('Texture compression exceeds bounded colour/channel/normal error: '+JSON.stringify({role,rmse,maximum,normalRmsDegrees,normalMaxDegrees:angleMax}));
 const coverage=cutoffs.map(cutoff=>({cutoff,source:alphaCoverage(source,cutoff),decoded:alphaCoverage(decoded,cutoff)}));for(const c of coverage)if(Math.abs(c.source-c.decoded)>Math.max(.005,1/(source.length/4)))throw Error('Alpha coverage changed beyond a pixel/0.5% budget.');
 return{rmse,maximum,normalRmsDegrees:role==='normal'?normalRmsDegrees:null,normalMaxDegrees:role==='normal'?angleMax:null,coverage};
}
export function inspectKtx(bytes){
 if(bytes.length<80||bytes.subarray(0,12).toString('hex')!=='ab4b5458203230bb0d0a1a0a')throw Error('Expected KTX2 texture.');const dfd=bytes.readUInt32LE(48),levels=bytes.readUInt32LE(40);if(dfd+16>bytes.length||!levels||levels>14)throw Error('Invalid KTX2 metadata.');return{width:bytes.readUInt32LE(20),height:bytes.readUInt32LE(24),levels,transferFunction:bytes[dfd+14],supercompression:bytes.readUInt32LE(44)};
}
function tool(executable,args){const result=spawnSync(executable,args,{encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']});if(result.error)throw result.error;if(result.status!==0)throw Error('Offline encoder failed: '+(result.stderr||result.stdout));return(result.stdout??'')+(result.stderr??'');}
export async function imageBytes(source,index,inputDir){const image=source.json.images[index];if(image.bufferView!==undefined){const v=source.json.bufferViews[image.bufferView];return source.bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);}const path=confined(inputDir,image.uri);const actual=await realpath(path);if(!inside(inputDir,actual))throw Error('Linked image escapes source directory.');return boundedRead(actual);}
export async function compressTextures(source,json,inputDir,outputDir,ktxBin,declaredRoles){
 const version=tool(join(ktxBin,'toktx'),['--version']).trim();if(version!=='toktx v4.4.2')throw Error('Use pinned official KTX-Software4.4.2.');const results=[],roles=declaredRoles??textureRoles(source.json),work=await mkdtemp(join(tmpdir(),'crownfall-ktx-'));
 try{for(const[index,entry]of roles){
  const role=[...entry.roles][0],raw=await imageBytes(source,index,inputDir),metadata=await sharp(raw,{limitInputPixels:MAX_PIXELS}).metadata();
  if((metadata.pages??1)>1)throw Error('Multiframe images need an explicit reviewed atlas/export first.');
  if(metadata.depth!=='uchar'){const original=source.json.images[index];if(!original.uri)throw Error('Non-eight-bit embedded maps need reviewed external originals.');results.push({sourceImage:index,role,sourceBytes:raw.length,sourceSha256:digest(raw),output:original.uri,bytes:raw.length,sha256:digest(raw),encoding:'precision-original',fallbackReason:'Preserve '+metadata.depth+' source data; UASTC is an eight-bit runtime format.',width:metadata.width,height:metadata.height,levels:1,transferFunction:role==='srgb'?2:1,supercompression:null,decodedRgbaBytes:null,evidence:[]});continue;}
  const image=await rgba8(raw),{width,height,channels}=image.info;if(channels!==4||width<1||height<1)throw Error('Invalid source image.');
  // Odd source dimensions need footprint-weighted authoring; never silently crop a scan.
  if((width&(width-1))||(height&(height-1)))throw Error('Provide reviewed power-of-two runtime textures; original remains unchanged.');
  const cutoffs=[...new Set(entry.cutoffs)].filter(c=>Number.isFinite(c)&&c>0&&c<=1),base={data:image.data,width,height,baseCoverage:cutoffs.length?alphaCoverage(image.data,cutoffs[0]):undefined},levels=[base],paths=[];
  while(levels.at(-1).width>1||levels.at(-1).height>1)levels.push(nextMip(levels.at(-1),role,cutoffs));
  for(let level=0;level<levels.length;level++){const p=join(work,`${index}-${level}.png`),m=levels[level];await sharp(m.data,{raw:{width:m.width,height:m.height,channels:4}}).png().toFile(p);paths.push(p);}
  const filename=`textures/image-${index}-${role}.ktx2`,output=join(outputDir,filename);await mkdir(dirname(output),{recursive:true});
  tool(join(ktxBin,'toktx'),['--t2','--encode','uastc','--uastc_quality','2','--zcmp','18','--threads','2','--assign_oetf',role==='srgb'?'srgb':'linear','--assign_primaries','bt709','--mipmap',output,...paths]);
  tool(join(ktxBin,'ktx'),['validate',output]);const encoded=await boundedRead(output),header=inspectKtx(encoded);if(header.width!==width||header.height!==height||header.levels!==levels.length||header.transferFunction!==(role==='srgb'?2:1))throw Error('KTX2 dimensions, mips or colour space mismatch.');
  let evidence=[];try{for(let level=0;level<levels.length;level++){const extracted=join(work,`decoded-${index}-${level}.raw`);tool(join(ktxBin,'ktx'),['extract','--raw','--transcode','rgba8','--level',String(level),output,extracted]);const decoded=await readFile(extracted);evidence.push({level,width:levels[level].width,height:levels[level].height,...comparePixels(levels[level].data,decoded,role,cutoffs)});}}catch(error){
   if(!/Texture compression|Alpha coverage/.test(String(error)))throw error;
   await rm(output);const image=source.json.images[index];if(!image.uri)throw Error('Rejected embedded texture needs a reviewed external lossless fallback: '+error);
   const fallback=confined(outputDir,image.uri),png=extname(image.uri).toLowerCase()==='.png';
   let candidate=sharp(base.data,{raw:{width,height,channels:4}});if(!metadata.hasAlpha)candidate=candidate.removeAlpha();const recompressed=png?await candidate.png({compressionLevel:9,effort:10,palette:false}).toBuffer():raw,data=recompressed.length<raw.length?recompressed:raw,changed=data!==raw;
   const pixels=(await rgba8(data)).data;assert.deepEqual(pixels,base.data,'Lossless fallback changed source pixels.');await writeFile(fallback,data);
   results.push({sourceImage:index,role,sourceBytes:raw.length,sourceSha256:digest(raw),output:relative(outputDir,fallback),bytes:data.length,sha256:digest(data),encoding:changed?'lossless-png':'unchanged-original',fallbackReason:String(error),width,height,levels:1,transferFunction:role==='srgb'?2:1,supercompression:null,decodedRgbaBytes:levels.reduce((sum,l)=>sum+l.data.length,0),evidence:[{level:0,width,height,...comparePixels(base.data,pixels,role,cutoffs)}]});continue;
  }
  const newImage=json.images.length;json.images.push({uri:filename,mimeType:'image/ktx2'});for(let texture=0;texture<source.json.textures.length;texture++){const t=source.json.textures[texture],original=t.extensions?.EXT_texture_webp?.source??t.source;if(original===index)json.textures[texture].extensions={...json.textures[texture].extensions,KHR_texture_basisu:{source:newImage}};}
  results.push({sourceImage:index,role,sourceBytes:raw.length,sourceSha256:digest(raw),output:filename,bytes:encoded.length,sha256:digest(encoded),encoding:'uastc-ktx2',...header,decodedRgbaBytes:levels.reduce((sum,l)=>sum+l.data.length,0),evidence});
 }}finally{await rm(work,{recursive:true,force:true});}
 if(results.length)json.extensionsUsed=[...new Set([...(json.extensionsUsed??[]),'KHR_texture_basisu'])];return{version,textures:results};
}
async function copyExternalImages(source,inputDir,outputDir){const files=[],copied=new Set();for(let index=0;index<(source.json.images?.length??0);index++){const image=source.json.images[index];if(!image.uri)continue;const from=await realpath(confined(inputDir,image.uri)),to=confined(outputDir,image.uri);if(!inside(inputDir,from))throw Error('Linked image escapes source directory.');if(copied.has(to))continue;copied.add(to);const data=await boundedRead(from);await mkdir(dirname(to),{recursive:true});await writeFile(to,data,{flag:'wx'});files.push({path:relative(outputDir,to),bytes:data.length,sha256:digest(data),kind:'unchanged-source-image'});}return files;}
export async function convertMegascans({input,provenance,output,dracoModule,ktxBin}){
 input=await realpath(resolve(input));output=privateOutput(output);output=privateOutput(join(await realpath(dirname(output)),basename(output)));const metadata=JSON.parse(await boundedRead(resolve(provenance))),bytes=await boundedRead(input),sourceSha=digest(bytes);
 if(metadata.assetKind==='brush')throw Error('Brushes are authoring inputs, never Draco runtime meshes.');
 if(metadata.assetKind!=='mesh'||metadata.rights?.confirmed!==true||!metadata.sourceUrl||!metadata.license||metadata.sourceSha256!==sourceSha)throw Error('Need exact source SHA, official provenance, licence and confirmed project rights for a mesh input.');
 if(extname(input).toLowerCase()!=='.glb')throw Error('Author and review FBX/OBJ/material/decal imports as glTF PBR before this runtime geometry stage.');
 try{await lstat(output);throw Error('Output directory exists; use a new versioned derivative directory.');}catch(error){if(error.code!=='ENOENT')throw error;}
 const source=parseGlb(bytes),modules=await dracoModules(dracoModule),derived=compressGeometry(source,modules.encoder);await mkdir(output,{recursive:false});
 try{
  const files=await copyExternalImages(source,dirname(input),output),textures=await compressTextures(source,derived.json,dirname(input),output,resolve(ktxBin)),glb=packGlb(derived.json,derived.chunks),decoded=parseGlb(glb),geometry=[];
  for(const record of derived.records)if(record.compressed)geometry.push({...record,...verifyPrimitive(source,source.json.meshes[record.mesh].primitives[record.primitive],decoded,decoded.json.meshes[record.mesh].primitives[record.primitive],modules.decoder)});else geometry.push(record);
  assert.deepEqual(semanticIdentity(decoded.json,source.json),semanticIdentity(source.json),'Scene/PBR/animation/skin/instancing semantics changed.');verifyRetainedViews(source,decoded);
  if(digest(await boundedRead(input))!==sourceSha)throw Error('Source changed during compression.');
  for(const texture of textures.textures){if(digest(await imageBytes(source,texture.sourceImage,dirname(input)))!==texture.sourceSha256)throw Error('Source texture changed during compression.');if(texture.encoding==='uastc-ktx2'&&source.json.images[texture.sourceImage].uri&&digest(await boundedRead(confined(output,source.json.images[texture.sourceImage].uri)))!==texture.sourceSha256)throw Error('Original texture fallback does not match its source.');}
  await writeFile(join(output,'asset-draco-ktx2.glb'),glb,{flag:'wx'});files.push({path:'asset-draco-ktx2.glb',bytes:glb.length,sha256:digest(glb),kind:'derived-runtime-model'});for(const t of textures.textures){const entry={path:t.output,bytes:t.bytes,sha256:t.sha256,kind:'derived-'+t.encoding},old=files.findIndex(f=>f.path===t.output);if(old>=0)files[old]=entry;else files.push(entry);}
  const manifest={schema:SCHEMA,source:{path:input,bytes:bytes.length,sha256:sourceSha,provenance:metadata},tools:{draco:{version:modules.version,entrySha256:modules.entrySha256,method:'sequential, no quantization'},ktx:textures.version},runtime:{required:['KHR_draco_mesh_compression'],optional:['KHR_texture_basisu'],geometryFallback:'Unchanged original input, including its original image files; do not replace bound source GLB identities.',textureFallback:'Original bytes retained, except rejected PNG maps may be losslessly recompressed with identical pixels. Originals remain untouched at their input paths.',textureEncoding:'UASTC quality2+Zstd18 where per-map gates pass; lossless PNG/original fallback when rejected. sRGB colour, linear normal/ORM; source dimensions and alpha-tested mips retained.'},geometry,textures:textures.textures,files,metrics:{sourceGlbBytes:bytes.length,derivedGlbBytes:glb.length,sourceTextureBytes:textures.textures.reduce((s,t)=>s+t.sourceBytes,0),ktx2TextureBytes:textures.textures.filter(t=>t.encoding==='uastc-ktx2').reduce((s,t)=>s+t.bytes,0),derivedTextureBytes:textures.textures.reduce((s,t)=>s+t.bytes,0),ktx2Textures:textures.textures.filter(t=>t.encoding==='uastc-ktx2').length,losslessOrOriginalTextures:textures.textures.filter(t=>t.encoding!=='uastc-ktx2').length,sourceDecodedRgbaMipBytes:textures.textures.reduce((s,t)=>s+(t.decodedRgbaBytes??0),0),preferredPayloadBytes:glb.length+textures.textures.reduce((s,t)=>s+t.bytes,0)}};
  await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});return manifest;
 }catch(error){await writeFile(join(output,'FAILED.txt'),String(error)+'\n',{flag:'wx'}).catch(()=>{});throw error;}
}
export function verifyRetainedViews(source,output){
 const compressed=new Set();for(const mesh of output.json.meshes??[])for(const p of mesh.primitives)if(p.extensions?.KHR_draco_mesh_compression){for(const i of Object.values(p.attributes))compressed.add(i);if(p.indices!==undefined)compressed.add(p.indices);}
 const required=new Set();for(const animation of source.json.animations??[])for(const sampler of animation.samplers??[]){required.add(sampler.input);required.add(sampler.output);}for(const skin of source.json.skins??[])if(skin.inverseBindMatrices!==undefined)required.add(skin.inverseBindMatrices);for(const node of source.json.nodes??[])for(const i of Object.values(node.extensions?.EXT_mesh_gpu_instancing?.attributes??{}))required.add(i);for(const mesh of source.json.meshes??[])for(const p of mesh.primitives)for(const target of p.targets??[])for(const i of Object.values(target))required.add(i);
 function walk(a,b,path=[]){if(!a||typeof a!=='object')return;for(const[k,v]of Object.entries(a)){if(path.length===0&&['buffers','bufferViews'].includes(k))continue;if(k==='bufferView'){
   if(b?.[k]===undefined){if(path[0]==='accessors'&&compressed.has(Number(path[1]))&&!required.has(Number(path[1])))continue;throw Error('Retained data buffer missing.');}
   const av=source.json.bufferViews[v],bv=output.json.bufferViews[b[k]];if(!av||!bv)throw Error('Invalid retained data reference.');assert.deepEqual(output.bin.subarray(bv.byteOffset??0,(bv.byteOffset??0)+bv.byteLength),source.bin.subarray(av.byteOffset??0,(av.byteOffset??0)+av.byteLength),'Nongeometry source buffer changed: '+path.join('.'));
  }else if(k!=='KHR_draco_mesh_compression'&&k!=='KHR_texture_basisu')walk(v,b?.[k],[...path,k]);}}
 walk(source.json,output.json);
}
export async function validateMegascans({manifest:manifestPath,dracoModule,ktxBin}){
 const path=await realpath(resolve(manifestPath)),directory=dirname(path),manifest=JSON.parse(await boundedRead(path));if(manifest.schema!==SCHEMA||!Array.isArray(manifest.files)||manifest.files.length>512||!Array.isArray(manifest.geometry)||manifest.geometry.length>256||!Array.isArray(manifest.textures)||manifest.textures.length>64||manifest.source?.provenance?.rights?.confirmed!==true||manifest.source.provenance.assetKind!=='mesh')throw Error('Unsupported manifest schema, unbounded inventory or unconfirmed source rights.');
 if(new Set(manifest.files.map(f=>f.path)).size!==manifest.files.length)throw Error('Duplicate manifest paths.');
 for(const f of manifest.files){const data=await boundedRead(confined(directory,f.path));if(data.length!==f.bytes||digest(data)!==f.sha256)throw Error('Derivative integrity mismatch: '+f.path);}
 const raw=await boundedRead(manifest.source.path);if(digest(raw)!==manifest.source.sha256||manifest.source.provenance.sourceSha256!==manifest.source.sha256)throw Error('Original source identity changed.');
 const source=parseGlb(raw),output=parseGlb(await boundedRead(join(directory,'asset-draco-ktx2.glb'))),modules=await dracoModules(dracoModule);assert.deepEqual(semanticIdentity(output.json,source.json),semanticIdentity(source.json));verifyRetainedViews(source,output);
 const expected=[];for(let mesh=0;mesh<(source.json.meshes?.length??0);mesh++)for(let primitive=0;primitive<source.json.meshes[mesh].primitives.length;primitive++)expected.push({mesh,primitive,compressed:(source.json.meshes[mesh].primitives[primitive].mode??4)===4});assert.deepEqual(manifest.geometry.map(({mesh,primitive,compressed})=>({mesh,primitive,compressed})),expected,'Incomplete geometry inventory.');
 for(const r of manifest.geometry)if(r.compressed)assert.deepEqual({...r,...verifyPrimitive(source,source.json.meshes[r.mesh].primitives[r.primitive],output,output.json.meshes[r.mesh].primitives[r.primitive],modules.decoder)},r);
 await verifyTextureEvidence({source,inputDir:dirname(manifest.source.path),directory,textures:manifest.textures,ktxBin});
 return{schema:SCHEMA,valid:true,geometry:manifest.geometry.length,textures:manifest.textures.length,files:manifest.files.length,metrics:manifest.metrics};
}

export async function verifyTextureEvidence({source,inputDir,directory,textures,ktxBin,declaredRoles}){
 if(tool(join(resolve(ktxBin),'toktx'),['--version']).trim()!=='toktx v4.4.2')throw Error('Use pinned official KTX-Software4.4.2.');
 const roles=declaredRoles??textureRoles(source.json),work=await mkdtemp(join(tmpdir(),'crownfall-ktx-verify-'));try{for(const t of textures){
  const entry=roles.get(t.sourceImage);if(!entry||![...entry.roles].includes(t.role))throw Error('Texture role does not match the original PBR material.');
  const original=await imageBytes(source,t.sourceImage,inputDir);if(digest(original)!==t.sourceSha256)throw Error('Original texture identity changed.');
  if(original.length!==t.sourceBytes)throw Error('Original texture size changed.');
  if(t.encoding==='precision-original'){if(digest(await boundedRead(confined(directory,t.output)))!==digest(original))throw Error('High-precision source data changed.');continue;}
  const decodedSource=await rgba8(original),cutoffs=[...new Set(entry.cutoffs)].filter(c=>Number.isFinite(c)&&c>0&&c<=1);let level={data:decodedSource.data,width:decodedSource.info.width,height:decodedSource.info.height,baseCoverage:cutoffs.length?alphaCoverage(decodedSource.data,cutoffs[0]):undefined};
  if(t.encoding==='uastc-ktx2'){
   if(source.json.images[t.sourceImage].uri&&digest(await boundedRead(confined(directory,source.json.images[t.sourceImage].uri)))!==t.sourceSha256)throw Error('Original texture fallback changed.');
   const header=inspectKtx(await boundedRead(confined(directory,t.output)));if(header.width!==t.width||header.height!==t.height||header.levels!==t.levels||header.transferFunction!==(t.role==='srgb'?2:1))throw Error('Invalid texture colour/mip metadata.');
   for(let i=0;i<t.levels;i++){const extracted=join(work,`image-${t.sourceImage}-${i}.raw`);tool(join(resolve(ktxBin),'ktx'),['extract','--raw','--transcode','rgba8','--level',String(i),confined(directory,t.output),extracted]);const evidence={level:i,width:level.width,height:level.height,...comparePixels(level.data,await readFile(extracted),t.role,cutoffs)};assert.deepEqual(evidence,t.evidence[i],'Texture evidence changed.');if(i<t.levels-1)level=nextMip(level,t.role,cutoffs);}
  }else{const pixels=(await rgba8(await boundedRead(confined(directory,t.output)))).data;assert.deepEqual(pixels,level.data,'Fallback source pixels changed.');}
 }}finally{await rm(work,{recursive:true,force:true});}
}

export async function rgba8(bytes){
 const decoded=await sharp(bytes,{limitInputPixels:MAX_PIXELS}).raw().toBuffer({resolveWithObject:true}),{width,height,channels}=decoded.info;
 if(channels===4)return decoded;if(channels<1||channels>4)throw Error('Unsupported image channel count.');
 const data=Buffer.alloc(width*height*4);for(let p=0;p<width*height;p++){if(channels<=2){data[p*4]=data[p*4+1]=data[p*4+2]=decoded.data[p*channels];data[p*4+3]=channels===2?decoded.data[p*channels+1]:255;}else{for(let c=0;c<3;c++)data[p*4+c]=decoded.data[p*3+c];data[p*4+3]=255;}}
 return{data,info:{...decoded.info,channels:4}};
}

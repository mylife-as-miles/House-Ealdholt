// Poly Haven Namaqualand CC0 scans, with offline index LODs and compact PBR maps.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {MeshoptSimplifier} from 'meshoptimizer';
import {createStaticGlb} from './glb-writer.mjs';
const output=resolve(process.argv[2]??'main game/public/assets/legacy/environment/aethelgard/namaqualand-rocks-v1');
const work=resolve(process.argv[3]??'/workspace/private-assets/crownfall/namaqualand-rocks-source');
await mkdir(output,{recursive:true});await mkdir(work,{recursive:true});await mkdir(output+'/textures',{recursive:true});await MeshoptSimplifier.ready;
const require=createRequire(resolve('main game/package.json')),T=await import(pathToFileURL(require.resolve('three')).href);
const sha=b=>createHash('sha256').update(b).digest('hex'),materials=[],images=[],sources=[],geometries=[];
async function download(entry,path){
 const url=new URL(entry.url);if(url.protocol!=='https:'||!['api.polyhaven.com','dl.polyhaven.org'].includes(url.hostname))throw Error('Unexpected source host.');
 await mkdir(dirname(path),{recursive:true});let data;try{data=await readFile(path);}catch{}
 if(!data||entry.md5&&createHash('md5').update(data).digest('hex')!==entry.md5){execFileSync('curl',['-fsSL',url.href,'-o',path]);data=await readFile(path);}
 if(entry.size&&data.length!==entry.size||entry.md5&&createHash('md5').update(data).digest('hex')!==entry.md5)throw Error('Source checksum mismatch: '+url.href);
 return data;
}
for(const id of ['namaqualand_boulder_02','namaqualand_boulder_04','namaqualand_boulder_06']){
 const meta=JSON.parse(await download({url:'https://api.polyhaven.com/files/'+id},work+'/'+id+'-files.json'));
 const entry=meta.gltf['1k'].gltf,folder=work+'/'+id;const gltf=JSON.parse(await download(entry,folder+'/source.gltf')),sourceFiles=[];
 for(const[name,file]of Object.entries(entry.include)){if(name.includes('..')||name.startsWith('/'))throw Error('Unexpected source path.');const bytes=await download(file,folder+'/'+name);sourceFiles.push({path:name,...file,sha256:sha(bytes)});}
 const bin=await readFile(folder+'/'+gltf.buffers[0].uri);
 function attribute(index,width){const a=gltf.accessors[index],v=gltf.bufferViews[a.bufferView],size=a.componentType===5126||a.componentType===5125?4:a.componentType===5123?2:1;
  const data=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),out=width===1?new Uint32Array(a.count):new Float32Array(a.count*width),stride=v.byteStride??size*width,offset=(v.byteOffset??0)+(a.byteOffset??0);
  if(a.sparse||offset+stride*(a.count-1)+width*size>bin.length)throw Error('Invalid scan accessor.');
  for(let i=0;i<a.count;i++)for(let c=0;c<width;c++){const at=offset+i*stride+c*size;out[i*width+c]=a.componentType===5126?data.getFloat32(at,true):size===4?data.getUint32(at,true):size===2?data.getUint16(at,true):data.getUint8(at);}return out;}
 const node=gltf.nodes.find(n=>n.mesh!==undefined),primitive=gltf.meshes[node.mesh].primitives[0],geometry=new T.BufferGeometry();
 for(const[key,attributeName,width]of [['position','POSITION',3],['normal','NORMAL',3],['uv','TEXCOORD_0',2]])geometry.setAttribute(key,new T.BufferAttribute(attribute(primitive.attributes[attributeName],width),width));
 geometry.setIndex(new T.BufferAttribute(attribute(primitive.indices,1),1));
 const frame=node.matrix?new T.Matrix4().fromArray(node.matrix):new T.Matrix4().compose(new T.Vector3(...(node.translation??[0,0,0])),new T.Quaternion(...(node.rotation??[0,0,0,1])),new T.Vector3(...(node.scale??[1,1,1])));
 geometry.applyMatrix4(frame);geometry.computeBoundingBox();const bounds=geometry.boundingBox,size=bounds.getSize(new T.Vector3()),centre=bounds.getCenter(new T.Vector3());
 geometry.translate(-centre.x,-bounds.min.y,-centre.z);const unit=2/Math.max(size.x,size.y,size.z);geometry.scale(unit,unit,unit);
 const textureIds={};for(const[channel,suffix]of [['albedo','diff'],['normal','nor_gl'],['orm','arm']]){
  const filename='textures/'+id+'_'+suffix+'_512.'+(channel==='albedo'?'webp':'png'),src=folder+'/textures/'+id+'_'+suffix+'_1k.jpg';
  let image=sharp(await readFile(src)).resize(512,512);const data=await(channel==='albedo'?image.webp({quality:94}):image.png()).toBuffer();await writeFile(output+'/'+filename,data);textureIds[channel]=images.length;images.push(filename);
 }
 const material=materials.length;materials.push({name:id+' scanned PBR stone',pbrMetallicRoughness:{baseColorTexture:{index:textureIds.albedo},metallicRoughnessTexture:{index:textureIds.orm},metallicFactor:0,roughnessFactor:1},normalTexture:{index:textureIds.normal},occlusionTexture:{index:textureIds.orm}});
 sources.push({id,url:'https://polyhaven.com/a/'+id,license:'CC0-1.0',filesApi:'https://api.polyhaven.com/files/'+id,gltf:{url:entry.url,md5:entry.md5},files:sourceFiles,sourceTriangles:geometry.index.count/3,normalization:unit});geometries.push({id,geometry,material});
}
const files={};
for(const[detail,target]of [['desktop',1800],['quest',700],['far',280]]){
 const writer=createStaticGlb(materials,images),triangles=[];
 for(const{id,geometry,material}of geometries){const positions=geometry.getAttribute('position').array,indices=Uint32Array.from(geometry.index.array);
  const[simplified]=MeshoptSimplifier.simplify(indices,positions,3,Math.min(indices.length,target*3),.02,['LockBorder']);
  const compact=new T.BufferGeometry(),ids=new Map(),next=[];for(const index of simplified){if(!ids.has(index))ids.set(index,ids.size);next.push(ids.get(index));}
  for(const[name,attribute]of Object.entries(geometry.attributes)){const values=new Float32Array(ids.size*attribute.itemSize);for(const[original,id]of ids)for(let c=0;c<attribute.itemSize;c++)values[id*attribute.itemSize+c]=attribute.getComponent(original,c);compact.setAttribute(name,new T.BufferAttribute(values,attribute.itemSize));}compact.setIndex(next);
  writer.mesh(writer.group(id),id,compact,material);triangles.push(compact.index.count/3);compact.dispose();
 }
 const name='rocks-'+detail+'.glb';await writer.save(output+'/'+name);const data=await readFile(output+'/'+name);files[name]={bytes:data.length,sha256:sha(data),triangles};
}
for(const file of images){const data=await readFile(output+'/'+file);files[file]={bytes:data.length,sha256:sha(data)};}
await writeFile(output+'/manifest.json',JSON.stringify({schema:1,generator:'crownfall-scanned-rock-lods-v1',sources,files},null,2)+'\n');
await writeFile(output+'/SOURCES.md','# Namaqualand boulder scans\n\nPoly Haven models `namaqualand_boulder_02`, `_04`, `_06`, from the requested Namaqualand collection. CC0: https://polyhaven.com/license . Source file URLs, provider MD5 checks, SHA-256 digests and derived file sizes are recorded in manifest.json. Geometry is recentered to ground contact, normalized to a two-metre maximum dimension and simplified offline. Original UVs and scanned albedo, OpenGL normal and ARM maps are preserved at 512 pixels. No reference world or settlement geometry is imported. Rebuild: `node scripts/environment/build-regional-rocks.mjs`.\n');
console.log(JSON.stringify(files,null,2));

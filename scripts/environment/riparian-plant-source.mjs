import{readFile}from'node:fs/promises';
import{join}from'node:path';
import{createHash}from'node:crypto';
import sharp from'sharp';
import{decodeRiparianAlpha,mapSha}from'./riparian-plant-maps.mjs';
export const RIPARIAN_PLANT_SOURCE_PINS={
 grass_medium_02:{variant:'grass_medium_02_e',gltf:'7037f8d2dfc6aeec0bf72f4eeb96cfa3f6b3a5e6c6f0bc5de537c055b2fd5d04',bin:'aa8493bc1544a89e08bf440c7ba361042bfe6ea48b1fefc7e4af2dfff42fdf4a',alpha:'15976877b3dbd22cd496a9549f1eb7d86710846a3631fb87eedbf046519e339f',alpha8:'949610b5a0bf0f8a32c562d392e8c661ed60039a5dfd28b022a4993e83598e31'},
 shrub_03:{variant:'shrub_03_b',gltf:'b76d7c14bc027e834e82d3f984c32b5d060e62908aa90ff9420a637ca253a8ea',bin:'bf4df21e6d2a2bc5f00b4c9142f776171fe7da00cf960001825748067af542b6',alpha:'daef00278879a024fd05216aaa1376067a5f25f1b911d08d9bbdc50fda4a0d66',alpha8:'1b68735db60e45b38f05dc7f4930713e300859cb3b2e626458fc37c303fe20bb'},
};
export async function readRiparianPlantSource(directory,id,T){
 const pin=RIPARIAN_PLANT_SOURCE_PINS[id];if(!pin)throw Error('Unselected plant source.');
 const intake=JSON.parse(await readFile(join(directory,'source-intake.json'))),record=intake.assets.find(a=>a.id===id);
 if(record?.license!=='CC0-1.0'||record?.collection!=='verdant_trail')throw Error('Missing official source licence/collection.');
 async function verified(file,expected){const bytes=await readFile(join(directory,file));const r=record.files.find(r=>r.file===file);
  if(!r||new URL(r.url).hostname!=='dl.polyhaven.org'||bytes.length!==r.bytes||mapSha(bytes)!==r.sha256||createHash('md5').update(bytes).digest('hex')!==r.md5||expected&&mapSha(bytes)!==expected)throw Error('Original plant source checksum mismatch.');return bytes;}
 const gltfBytes=await verified(id+'/'+id+'_1k.gltf',pin.gltf),g=JSON.parse(gltfBytes),bin=await verified(id+'/'+id+'.bin',pin.bin);
 if(g.buffers.length!==1||g.buffers[0].byteLength!==bin.length)throw Error('Unsupported original plant buffer.');
 function attribute(index,width){const a=g.accessors[index],v=g.bufferViews[a.bufferView],sizes={5126:4,5125:4,5123:2},size=sizes[a.componentType],start=(v.byteOffset??0)+(a.byteOffset??0),stride=v.byteStride??width*size;
  if(!size||a.sparse||a.normalized||start+(a.count-1)*stride+width*size>bin.length)throw Error('Unsupported source plant accessor.');
  const out=width===1?new Uint32Array(a.count):new Float32Array(a.count*width);
  for(let i=0;i<a.count;i++)for(let c=0;c<width;c++){const at=start+i*stride+c*size;out[i*width+c]=a.componentType===5126?bin.readFloatLE(at):size===4?bin.readUInt32LE(at):bin.readUInt16LE(at);}return out;}
 const node=g.nodes.find(n=>n.name===pin.variant);if(!node||node.matrix||node.rotation||node.scale)throw Error('Changed plant source frame.');
 const mesh=g.meshes[node.mesh];if(mesh.primitives.length!==1)throw Error('Changed plant source mesh.');const p=mesh.primitives[0];
 const geometry=new T.BufferGeometry();for(const[name,key,width]of[['position','POSITION',3],['normal','NORMAL',3],['uv','TEXCOORD_0',2]])geometry.setAttribute(name,new T.BufferAttribute(attribute(p.attributes[key],width),width));
 geometry.setIndex(new T.BufferAttribute(attribute(p.indices,1),1));geometry.computeBoundingBox();
 const positions=geometry.attributes.position,normals=geometry.attributes.normal,uv=geometry.attributes.uv,bounds=geometry.boundingBox;let radius=0,bottomRadius=0;
 for(let i=0;i<positions.count;i++){if(![positions.getX(i),positions.getY(i),positions.getZ(i),normals.getX(i),normals.getY(i),normals.getZ(i),uv.getX(i),uv.getY(i)].every(Number.isFinite))throw Error('Invalid source plant attribute.');
  const r=Math.hypot(positions.getX(i),positions.getZ(i));radius=Math.max(radius,r);if(positions.getY(i)<=bounds.min.y+.03)bottomRadius=Math.max(bottomRadius,r);}
 for(const index of geometry.index.array)if(index>=positions.count)throw Error('Invalid source plant index.');
 const maps={};for(const[role,suffix]of[['albedo','diff'],['normal','nor_gl'],['orm','arm']]){
  const bytes=await verified(`${id}/textures/${id}_${suffix}_1k.jpg`),{data,info}=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
  if(info.width!==1024||info.height!==1024||info.channels!==3)throw Error('Changed source plant map shape.');maps[role]=data;
 }
 const alpha=await decodeRiparianAlpha(await verified(`${id}/supplemental/${id}_alpha_1k.png`,pin.alpha),pin.alpha8);
 const hashes=Object.fromEntries(Object.entries(geometry.attributes).map(([key,a])=>[key,mapSha(Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength))]));hashes.index=mapSha(Buffer.from(geometry.index.array.buffer));
 return{id,variant:pin.variant,geometry,maps,alpha,record,sourceMaterial:g.materials[p.material],measured:{minimumY:bounds.min.y,maximumY:bounds.max.y,height:bounds.max.y-bounds.min.y,radius,bottomRadius,triangles:geometry.index.count/3,vertices:positions.count,geometryBytes:Object.values(geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0)+geometry.index.array.byteLength,hashes}};
}

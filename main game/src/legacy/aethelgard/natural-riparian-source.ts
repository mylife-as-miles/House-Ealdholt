import{DataTexture,DoubleSide,LinearFilter,LinearMipmapLinearFilter,Matrix4,Mesh,MeshStandardMaterial,NoColorSpace,RepeatWrapping,RGBAFormat,SRGBColorSpace,TangentSpaceNormalMap,Texture,UnsignedByteType,type BufferGeometry}from'three';
import type{GLTF}from'three/addons/loaders/GLTFLoader.js';
import{naturalRiparianAsset,naturalRiparianReservation}from'../../../../shared/legacy/aethelgard/environment/natural-riparian-policy';
import{worldBakeDigest}from'../../../../shared/legacy/aethelgard/environment/world-bake-cache';
import{markNaturalRiparianMaterial}from'./natural-riparian-program';
export interface NaturalRiparianPreparedPlant{variant:string;geometry:BufferGeometry;material:MeshStandardMaterial;map:DataTexture;height:number;minimumY:number;maximumY:number;radius:number;triangles:number}
export interface NaturalRiparianPreparedSource{plants:NaturalRiparianPreparedPlant[];sourceSha256:string;accountedBytes:number;dispose():void}
/** Exact canonical loader contract. Catalogue frames are absent; source
 * arrays/images remain read-only; geometry and texture/material wrappers are
 * cloned so a loader retiring its original GLB cannot dispose live GPU draws. */
export async function prepareNaturalRiparianAsset(asset:GLTF,native=false,signal?:AbortSignal):Promise<NaturalRiparianPreparedSource>{
 const expected=naturalRiparianAsset(native),plants:NaturalRiparianPreparedPlant[]=[];
 if(JSON.stringify(asset.asset.extras)!==JSON.stringify(expected.identity)||expected.accountedBytes>naturalRiparianReservation(native))throw Error('Natural bank asset metadata/reservation mismatch.');
 asset.scene.updateWorldMatrix(true,true);const inverse=asset.scene.matrixWorld.clone().invert(),identity=new Matrix4(),meshes:Mesh[]=[];
 asset.scene.traverse(node=>{if(node instanceof Mesh)meshes.push(node);});if(meshes.length!==expected.identity.plants.length)throw Error('Natural bank source mesh count mismatch.');
 const retire=()=>{for(const p of plants){const textures=new Set<Texture>();for(const value of Object.values(p.material))if(value instanceof Texture)textures.add(value);p.geometry.dispose();p.material.dispose();for(const texture of textures)texture.dispose();p.map.mipmaps.length=0;p.map.image={data:new Uint8Array(),width:0,height:0};}plants.length=0;};
 try{for(const[sourceIndex,source]of expected.identity.plants.entries()){signal?.throwIfAborted();const mesh=meshes.find(m=>m.name===source.variant),g=mesh?.geometry,m=mesh?.material;
  if(!mesh||!g||!(m instanceof MeshStandardMaterial)||!g.index||g.groups.length>1||Object.keys(g.morphAttributes).length||'isSkinnedMesh'in mesh||!m.visible||!m.depthTest||!m.depthWrite||m.emissive.getHex()!==0||m.alphaTest!==.5||m.transparent||m.side!==DoubleSide||m.opacity!==1||m.color.getHex()!==0xffffff||m.metalness!==0||m.roughness!==1||!m.map||!m.normalMap||!m.roughnessMap||m.roughnessMap!==m.metalnessMap||m.aoMap)throw Error('Natural bank geometry/PBR mismatch.');
  const references=asset.parser.associations as Map<object,{materials?:number;textures?:number;meshes?:number;primitives?:number}>,materialIndex=references?.get(m)?.materials,materialJson=materialIndex===undefined?null:asset.parser.json.materials?.[materialIndex],meshReference=references?.get(mesh),primitive=meshReference?.meshes===undefined?null:asset.parser.json.meshes?.[meshReference.meshes]?.primitives?.[meshReference.primitives??-1];
  // These exact canonical files have POSITION/NORMAL/UV and no TANGENT. The
  // real r185 GLTFLoader clones their material and flips normalScale.y for
  // derivative tangents; accepting either sign would hide a changed frame.
  if(meshReference?.meshes!==sourceIndex||meshReference.primitives!==0||!primitive||primitive.material!==sourceIndex||materialIndex!==sourceIndex||primitive.indices!==sourceIndex*4+3||Object.keys(primitive.attributes??{}).sort().join(',')!=='NORMAL,POSITION,TEXCOORD_0'||Object.keys(g.attributes).sort().join(',')!=='normal,position,uv'||(primitive.mode??4)!==4||primitive.targets)throw Error('Natural bank canonical tangent/accessor contract mismatch.');
  for(const[slot,semantic,key,width,type]of[[0,'POSITION','position',3,'VEC3'],[1,'NORMAL','normal',3,'VEC3'],[2,'TEXCOORD_0','uv',2,'VEC2'],[3,null,'index',1,'SCALAR']]as const){const accessorIndex=sourceIndex*4+slot,a=asset.parser.json.accessors?.[accessorIndex],attribute=key==='index'?g.index:g.getAttribute(key);
   if((semantic!==null&&primitive.attributes[semantic]!==accessorIndex)||!a||a.componentType!==(key==='index'?5125:5126)||a.type!==type||a.count!==(key==='index'?source.triangles*3:source.vertices)||a.normalized||(a.byteOffset??0)!==0||a.sparse||!attribute||attribute.itemSize!==width||attribute.normalized||!(attribute.array instanceof(key==='index'?Uint32Array:Float32Array)))throw Error('Natural bank canonical tangent/accessor contract mismatch.');
  }
  if(!materialJson||await worldBakeDigest(new TextEncoder().encode(JSON.stringify(materialJson)))!==source.canonicalMaterialSha256||!materialJson.normalTexture||(materialJson.normalTexture.scale??1)!==1||m.normalMapType!==TangentSpaceNormalMap||m.normalScale.x!==1||m.normalScale.y!==-1||m.flatShading||m.vertexColors)throw Error('Natural bank canonical material binding mismatch.');
  const bindings=[m.map,m.normalMap,m.roughnessMap];
  for(let i=0;i<bindings.length;i++){const texture=bindings[i];if(references.get(texture)?.textures!==source.encodedImages[i].texture||texture.channel!==0||texture.offset.x!==0||texture.offset.y!==0||texture.repeat.x!==1||texture.repeat.y!==1||texture.rotation!==0||!texture.matrixAutoUpdate)throw Error('Natural bank texture/UV binding mismatch.');
   if(texture.colorSpace!==(i===0?SRGBColorSpace:NoColorSpace)||texture.wrapS!==RepeatWrapping||texture.wrapT!==RepeatWrapping||texture.minFilter!==LinearMipmapLinearFilter||texture.magFilter!==LinearFilter||!texture.generateMipmaps||texture.premultiplyAlpha)throw Error('Natural bank texture colour-space/sampler mismatch.');
  }
  const textures=new Set<Texture>();for(const value of Object.values(m))if(value instanceof Texture)textures.add(value);if(textures.size!==3)throw Error('Unsupported extra natural bank PBR texture.');
  const frame=inverse.clone().multiply(mesh.matrixWorld);if(frame.elements.some((v,i)=>Math.abs(v-identity.elements[i])>1e-8))throw Error('Natural bank source frame changed.');
  for(const[key,sha]of Object.entries(source.hashes)){const a=key==='index'?g.index:g.getAttribute(key);if(!a||'isInterleavedBufferAttribute'in a||await worldBakeDigest(new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength))!==sha)throw Error('Natural bank source accessor mismatch.');}
  if(g.index.count!==source.triangles*3||g.getAttribute('position').count!==source.vertices)throw Error('Natural bank topology changed.');
  const textureSize=(texture:Texture,size:number)=>{const image=texture.image as{width?:number;height?:number}|null;return image?.width===size&&image?.height===size&&!texture.flipY;};
  if(!textureSize(m.map,expected.size)||!textureSize(m.normalMap,expected.dataSize)||!textureSize(m.roughnessMap,expected.dataSize))throw Error('Natural bank source texture shape/orientation mismatch.');
  for(const image of source.encodedImages){signal?.throwIfAborted();const bytes=await asset.parser.getDependency('bufferView',image.bufferView)as ArrayBuffer;if(!(bytes instanceof ArrayBuffer)||bytes.byteLength!==image.bytes||await worldBakeDigest(new Uint8Array(bytes))!==image.sha256)throw Error('Natural bank original PBR image checksum mismatch.');}
  const mipmaps:{data:Uint8Array;width:number;height:number}[]=[];
  for(const mip of source.albedoMips){signal?.throwIfAborted();const bytes=await asset.parser.getDependency('bufferView',mip.bufferView)as ArrayBuffer;
   if(!(bytes instanceof ArrayBuffer)||bytes.byteLength!==mip.width*mip.height*4)throw Error('Natural bank alpha mip size mismatch.');const data=new Uint8Array(bytes);if(await worldBakeDigest(data)!==mip.sha256)throw Error('Natural bank alpha mip checksum mismatch.');mipmaps.push({data,width:mip.width,height:mip.height});}
  signal?.throwIfAborted();const map=new DataTexture(mipmaps[0].data,expected.size,expected.size,RGBAFormat,UnsignedByteType);map.mipmaps=mipmaps;map.generateMipmaps=false;map.flipY=false;map.premultiplyAlpha=false;map.colorSpace=SRGBColorSpace;map.minFilter=LinearMipmapLinearFilter;map.magFilter=LinearFilter;map.wrapS=m.map.wrapS;map.wrapT=m.map.wrapT;map.unpackAlignment=1;map.needsUpdate=true;
  const material=m.clone();material.map=map;material.normalMap=m.normalMap.clone();material.normalMap.needsUpdate=true;material.roughnessMap=m.roughnessMap.clone();material.roughnessMap.needsUpdate=true;material.metalnessMap=material.roughnessMap;material.name='Natural bank '+source.variant;material.customProgramCacheKey=()=>':natural-bank-source-alpha-mips-v1:'+expected.sha256+':'+source.variant;
  markNaturalRiparianMaterial(material);
  plants.push({variant:source.variant,geometry:g.clone(),material,map,height:source.height,minimumY:source.minimumY,maximumY:source.maximumY,radius:source.radius,triangles:source.triangles});
 }}catch(cause){retire();throw cause;}
 let disposed=false;return{plants,sourceSha256:expected.sha256,accountedBytes:expected.accountedBytes,dispose(){if(disposed)return;disposed=true;retire();}};
}

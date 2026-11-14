import{readFile}from'node:fs/promises';
import{BufferAttribute,BufferGeometry,DataTexture,DoubleSide,Group,LinearFilter,LinearMipmapLinearFilter,Mesh,MeshStandardMaterial,RepeatWrapping,RGBAFormat,SRGBColorSpace,UnsignedByteType,type Camera,type Object3D,type Scene,type Texture,type WebGLRenderer}from'three';
import type{GLTF}from'three/addons/loaders/GLTFLoader.js';
import sharp from'sharp';
import{naturalRiparianAsset,NATURAL_RIPARIAN_ASSET_PATH}from'../../../../shared/legacy/aethelgard/environment/natural-riparian-policy';
import{NATURAL_RIPARIAN_SHADER_MARKER}from'./natural-riparian-program';
/** Read actual canonical vertex/PBR images without a renderer or fake world. */
export async function naturalRiparianTestFixture(native=false){
 const expected=naturalRiparianAsset(native),bytes=await readFile(new URL('../../../../main game/public/'+NATURAL_RIPARIAN_ASSET_PATH+expected.file,import.meta.url)),size=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+size).toString()),bin=bytes.subarray(28+size),root=new Group();
 const data=(index:number)=>{const v=json.bufferViews[index];return bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);},associations=new Map<object,{textures?:number;materials?:number;meshes?:number;primitives?:number}>();
 function attribute(index:number,width:number){const a=json.accessors[index],raw=data(a.bufferView),values=a.componentType===5126?new Float32Array(a.count*width):new Uint32Array(a.count*width);for(let i=0;i<values.length;i++)values[i]=a.componentType===5126?raw.readFloatLE(i*4):raw.readUInt32LE(i*4);return new BufferAttribute(values,width);}
 async function texture(index:number,colour=false){const image=json.images[json.textures[index].source],{data:rgba,info}=await sharp(data(image.bufferView)).ensureAlpha().raw().toBuffer({resolveWithObject:true}),texture=new DataTexture(Uint8Array.from(rgba),info.width,info.height,RGBAFormat,UnsignedByteType);texture.flipY=false;texture.wrapS=texture.wrapT=RepeatWrapping;texture.minFilter=LinearMipmapLinearFilter;texture.magFilter=LinearFilter;texture.generateMipmaps=true;if(colour)texture.colorSpace=SRGBColorSpace;associations.set(texture,{textures:index});return texture;}
 for(let i=0;i<json.meshes.length;i++){const source=expected.identity.plants[i],p=json.meshes[i].primitives[0],g=new BufferGeometry(),material=json.materials[p.material];for(const[key,name,width]of[['position','POSITION',3],['normal','NORMAL',3],['uv','TEXCOORD_0',2]]as const)g.setAttribute(key,attribute(p.attributes[name],width));g.setIndex(attribute(p.indices,1));
  const map=await texture(material.pbrMetallicRoughness.baseColorTexture.index,true),normalMap=await texture(material.normalTexture.index),orm=await texture(material.pbrMetallicRoughness.metallicRoughnessTexture.index),m=new MeshStandardMaterial({map,normalMap,roughnessMap:orm,metalnessMap:orm,alphaTest:.5,side:DoubleSide,metalness:0,roughness:1}),mesh=new Mesh(g,m);m.normalScale.y=-1;associations.set(m,{materials:p.material});associations.set(mesh,{meshes:i,primitives:0});mesh.name=source.variant;root.add(mesh);
 }
 const asset={scene:root,scenes:[root],animations:[],cameras:[],asset:json.asset,userData:{},parser:{json,associations,getDependency:async(kind:string,index:number)=>{if(kind!=='bufferView')throw Error('Unexpected fixture dependency.');const b=data(index);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}}}as unknown as GLTF;
 return{asset,root,json,bytes,dispose(){for(const mesh of root.children as Mesh[]){mesh.geometry.dispose();const m=mesh.material as MeshStandardMaterial,textures=new Set<Texture>();for(const v of Object.values(m))if(v&&typeof v==='object'&&'isTexture'in v)textures.add(v as Texture);for(const t of textures)t.dispose();m.dispose();}root.clear();}};
}
/** GL contract fixture only: actual canonical materials supply cache keys and
 * the real marker hook; no GPU, render or world is fabricated as evidence. */
export function naturalRiparianRendererFixture(options:{linked?:boolean;silentError?:boolean;unrelatedError?:boolean;failUploadAt?:number}={}){
 type Program={linked:boolean};const programs:{cacheKey:string;program:Program}[]=[],uploads:Texture[]=[];let queries=0;
 const gl={LINK_STATUS:0x8b82,isContextLost:()=>false,getProgramParameter(program:Program,key:number){if(key!==0x8b82)throw Error('Unexpected GL query.');queries++;return program.linked;},getProgramInfoLog:()=> 'Controlled natural source link failure.',getShaderSource:(shader:{source:string})=>shader.source};
 const debug={checkShaderErrors:false,onShaderError:null as WebGLRenderer['debug']['onShaderError']};
 const renderer={debug,info:{programs,render:{frame:0}},getContext:()=>gl,initTexture(texture:Texture){uploads.push(texture);if(uploads.length===options.failUploadAt)throw Error('Actual upload refused.');},async compileAsync(root:Object3D,_camera:Camera,_scene:Scene){
  const materials=new Set<MeshStandardMaterial>();root.traverse(node=>{if(node instanceof Mesh&&node.material instanceof MeshStandardMaterial)materials.add(node.material);});
  for(const material of materials){const shader={uniforms:{},vertexShader:'void main(){}',fragmentShader:'void main(){}'};material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0],renderer as unknown as WebGLRenderer);if(!shader.vertexShader.includes(NATURAL_RIPARIAN_SHADER_MARKER))throw Error('Actual source marker was not compiled.');
   const program={linked:options.linked!==false};programs.push({cacheKey:'fixture,'+material.customProgramCacheKey(),program});
   if(options.silentError||options.unrelatedError){const source=options.unrelatedError?'UNRELATED_SOURCE':shader.vertexShader;debug.onShaderError?.(gl as unknown as WebGL2RenderingContext,program as unknown as Parameters<NonNullable<WebGLRenderer['debug']['onShaderError']>>[1],{source}as unknown as WebGLShader,{source}as unknown as WebGLShader);}
  }return materials;
 }}as unknown as WebGLRenderer;
 return{renderer,uploads,get linkQueries(){return queries;}};
}

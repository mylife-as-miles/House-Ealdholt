import { LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, type Material, type Object3D, type Texture } from 'three';
import { EALDHOLT_GROUND_ALBEDO_CACHE_KEY, patchEaldholtGroundAlbedoShader, readEaldholtGroundAlbedoManifest, type EaldholtGroundKind } from '../../../../shared/legacy/aethelgard/environment/ground-albedo-detail';
import { isGeneratedEaldholtGroundDetail } from '../../../../shared/legacy/aethelgard/environment/ground-look';

export type EaldholtGroundAlbedoMaps = Record<EaldholtGroundKind,{texture:Texture;meanLuminance:number;normalTexture?:Texture;ormTexture?:Texture;albedoSize?:512|1024;dataSize?:256|1024;source?:string;photographic?:boolean}>;
export type EaldholtBorrowedSurfaceMaps = { albedo:Texture;normal?:Texture;orm?:Texture;meanLuminance?:number;sourceAssetId?:string;tileMetres?:number;targetLuminance?:number };
export interface EaldholtGroundAlbedoDetail { readonly materialCount:number;readonly textureCount:number;readonly extraTextureBytesWithMipsEstimate:number;readonly surfaceMaps:Partial<Record<EaldholtGroundKind,EaldholtBorrowedSurfaceMaps>>;dispose():void }

/** Base textures are borrowed by this synchronous adapter. Only configured
 * clones and material instances are owned; atlas/AO/normal maps stay intact. */
export function applyEaldholtGroundAlbedoDetail(root:Object3D,maps:EaldholtGroundAlbedoMaps):EaldholtGroundAlbedoDetail {
  const materials=new Map<Material,MeshStandardMaterial>(),textures=new Map<string,Texture>();let extraTextureBytes=0;
  // Borrowers must finish before this handle disposes its configured maps.
  const surfaceMaps:Partial<Record<EaldholtGroundKind,EaldholtBorrowedSurfaceMaps>>={};
  const assignments:{mesh:Mesh;original:Material|Material[];assigned:Material|Material[]}[]=[];
  for(const kind of ['earth','rock'] as const)if(!Number.isFinite(maps[kind].meanLuminance)||maps[kind].meanLuminance<=0||maps[kind].meanLuminance>1)throw Error('Invalid linear ground albedo mean.');
  function adapt(original:Material):Material {
    if(!(original instanceof MeshStandardMaterial)||!isGeneratedEaldholtGroundDetail(original.name.replace(/_CavityAo$/,''))||!original.map||!original.roughnessMap)return original;
    const detail=original.userData.crownfallGroundDetail;
    if(!detail||!['earth','rock'].includes(detail.kind)||![2,3].includes(detail.uvChannel)||original.roughnessMap.channel!==detail.uvChannel)return original;
    const cached=materials.get(original);if(cached)return cached;
    const kind=detail.kind as EaldholtGroundKind,coordinateMap=original.roughnessMap;
    function configured(role:'albedo'|'normal'|'orm',base:Texture):Texture{
      const key=`${kind}:${role}:${detail.uvChannel}`;let texture=textures.get(key);if(texture)return texture;
      texture=base.clone();texture.colorSpace=role==='albedo'?SRGBColorSpace:NoColorSpace;texture.flipY=false;texture.wrapS=texture.wrapT=RepeatWrapping;
      if(role==='albedo'){texture.repeat.set(1,1);texture.offset.set(0,0);texture.rotation=0;}
      else{texture.channel=detail.uvChannel;texture.repeat.copy(coordinateMap.repeat);texture.offset.copy(coordinateMap.offset);texture.center.copy(coordinateMap.center);texture.rotation=coordinateMap.rotation;}
      texture.generateMipmaps=true;texture.minFilter=LinearMipmapLinearFilter;texture.anisotropy=4;texture.needsUpdate=true;textures.set(key,texture);
      const size=role==='albedo'?(maps[kind].albedoSize??512):(maps[kind].dataSize??512);extraTextureBytes+=Math.ceil(size*size*4*4/3);return texture;
    }
    const texture=configured('albedo',maps[kind].texture);
    const material=original.clone(),previous=original.onBeforeCompile,previousKey=original.customProgramCacheKey;
    if(maps[kind].normalTexture){
      material.normalMap=configured('normal',maps[kind].normalTexture!);
      // The replaced procedural normal used an authored attenuation. The
      // photographed OpenGL map carries its own relief; retain axis direction
      // while restoring its unit magnitude on this owned material only.
      if(maps[kind].photographic===true)material.normalScale.set(
        original.normalScale.x < 0 ? -1 : 1, original.normalScale.y < 0 ? -1 : 1);
    }
    if(maps[kind].ormTexture){const orm=configured('orm',maps[kind].ormTexture!);material.roughnessMap=material.metalnessMap=material.aoMap=orm;material.aoMapIntensity=1;}
    surfaceMaps[kind]??={albedo:texture,meanLuminance:maps[kind].meanLuminance,normal:maps[kind].normalTexture?material.normalMap??undefined:undefined,orm:maps[kind].ormTexture?material.roughnessMap??undefined:undefined};
    const ownedTexture=texture,mean=maps[kind].meanLuminance,photographic=maps[kind].photographic===true;
    material.name=original.name+'_OwnedAlbedo';
    material.onBeforeCompile=function(shader,renderer){previous.call(this,shader,renderer);patchEaldholtGroundAlbedoShader(shader,ownedTexture,mean,photographic,kind);};
    material.customProgramCacheKey=function(){return previousKey.call(this)+EALDHOLT_GROUND_ALBEDO_CACHE_KEY+(photographic?':photographic-pbr-v2:'+kind:'');};
    material.userData.crownfallGroundAlbedoDetail={kind,meanLuminance:mean,source:maps[kind].source??'Original Crownfall512px procedural albedo',uv:'Existing transformed roughness UV',linearLuminance:true,photographic};
    material.needsUpdate=true;materials.set(original,material);return material;
  }
  root.traverse(object=>{if(!(object instanceof Mesh))return;const original=object.material,assigned=Array.isArray(original)?original.map(adapt):adapt(original);
    const changed=Array.isArray(original)&&Array.isArray(assigned)?original.some((material,index)=>material!==assigned[index]):assigned!==original;
    if(changed){object.material=assigned;assignments.push({mesh:object,original,assigned});}});
  let disposed=false;
  return {materialCount:materials.size,textureCount:textures.size,extraTextureBytesWithMipsEstimate:extraTextureBytes,surfaceMaps,dispose(){
    if(disposed)return;disposed=true;for(const {mesh,original,assigned}of assignments)if(mesh.material===assigned)mesh.material=original;
    for(const material of materials.values())material.dispose();for(const texture of textures.values())texture.dispose();materials.clear();textures.clear();assignments.length=0;
  }};
}

/** Loads only the existing canonical owned maps. The caller supplies its
 * BASE_URL-aware texture directory; no URL or licence is inferred remotely. */
/** `profile` 'quest' loads the smaller 512/256 px maps (Low, audit L-22). */
export async function loadEaldholtGroundAlbedoDetail(root:Object3D,baseUrl:string,signal?:AbortSignal,profile:'desktop'|'quest'='desktop'):Promise<EaldholtGroundAlbedoDetail> {
  const directory=baseUrl.endsWith('/')?baseUrl:baseUrl+'/';
  const response=await fetch(directory+'manifest.json',{signal});if(!response.ok)throw Error('Owned ground texture manifest unavailable.');
  const manifest=readEaldholtGroundAlbedoManifest(await response.json(),profile),loader=new TextureLoader(),kinds=['earth','rock'] as const;
  const jobs=kinds.flatMap(kind=>[{kind,role:'albedo',file:manifest[kind].file},...(manifest[kind].normal?[{kind,role:'normal',file:manifest[kind].normal!.file}]:[]),...(manifest[kind].orm?[{kind,role:'orm',file:manifest[kind].orm!.file}]:[])]);
  const settled=await Promise.allSettled(jobs.map(job=>loader.loadAsync(directory+job.file)));
  const bases=settled.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
  const release=()=>{const images=new Set<ImageBitmap>();for(const texture of bases){const image:unknown=texture.source?.data;if(typeof ImageBitmap!=='undefined'&&image instanceof ImageBitmap)images.add(image);texture.dispose();}for(const image of images)image.close();};
  try {
    for(const result of settled)if(result.status==='rejected')throw result.reason;
    signal?.throwIfAborted();
    const loaded=new Map(jobs.map((job,index)=>[`${job.kind}:${job.role}`,bases[index]]));
    const maps=Object.fromEntries(kinds.map(kind=>[kind,{texture:loaded.get(`${kind}:albedo`)!,normalTexture:loaded.get(`${kind}:normal`),ormTexture:loaded.get(`${kind}:orm`),meanLuminance:manifest[kind].meanLuminance,albedoSize:manifest[kind].size,dataSize:manifest[kind].normal?.size,source:manifest[kind].source,photographic:manifest[kind].photographic}])) as EaldholtGroundAlbedoMaps;
    const look=applyEaldholtGroundAlbedoDetail(root,maps);let disposed=false;
    return {...look,dispose(){if(disposed)return;disposed=true;look.dispose();release();}};
  }catch(error){release();throw error;}
}

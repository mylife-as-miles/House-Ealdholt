/** Owned normal RGB for the pinned generated regional sprays only. This never
 * edits imported GLB objects, complete-tree/scanned materials, or source art. */
import {Color,DataTexture,DoubleSide,LinearFilter,LinearMipmapLinearFilter,MeshStandardMaterial,NoColorSpace,RGBAFormat,RepeatWrapping,SRGBColorSpace,TangentSpaceNormalMap,UnsignedByteType,type Texture,type WebGLRenderer} from 'three';
import {GENERATED_FOLIAGE_MAPS,GENERATED_FOLIAGE_NORMAL_SCALE,GENERATED_FOLIAGE_NORMAL_STRENGTH,GENERATED_FOLIAGE_NORMAL_VERSION,generatedFoliageMapForPrototype,generatedFoliageNormalBudget,generatedFoliageNormalBytes,generatedFoliageNormalSize,type GeneratedFoliageMap} from '../../../../shared/legacy/aethelgard/environment/generated-foliage-normal';
import {REGIONAL_VEGETATION_PROFILES} from '../../../../shared/legacy/aethelgard/environment/regional-vegetation-profiles';
import {REGIONAL_VEGETATION_PROTOTYPES} from '../../../../shared/legacy/aethelgard/environment/regional-assets';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import {readFoliageRgbaPixels,type FoliageRgbaPixels} from './foliage-coverage-mips';
import type {VegetationCapturePart} from './vegetation-atlas-capture';
import type {VegetationPreparationWorker} from './vegetation-worker';
import type {VegetationPrototypeResources} from './vegetation-prototype';

const cards=[373,533,573,453,613,693,413,573,613,247,338,377,240,330,300] as const;
interface Variant {id:string;parts:VegetationCapturePart[]}
interface Assignment {parts:VegetationCapturePart[];index:number;original:VegetationCapturePart;assigned?:VegetationCapturePart;material:MeshStandardMaterial;map:Texture;mapVersion:number;materialVersion:number;stamp:string;key:GeneratedFoliageMap}
interface OwnedMap {texture:DataTexture;identity:string;bytes:number}
type MaterialLease=ReturnType<VegetationPrototypeResources['material']>;
const sourceColour=new Color(0xf4f5ec);
function mapStamp(map:Texture){return JSON.stringify([map.channel,map.flipY,map.wrapS,map.wrapT,map.minFilter,map.magFilter,map.anisotropy,map.premultiplyAlpha,map.colorSpace,map.offset.toArray(),map.repeat.toArray(),map.center.toArray(),map.rotation,map.matrixAutoUpdate,map.matrix.elements]);}
function supportedMap(map:Texture){
 const image=map.source.data as {width?:unknown;height?:unknown};
 const flags=map as Texture&Record<string,unknown>;
 return !['isCompressedTexture','isCubeTexture','isData3DTexture','isDataArrayTexture','isVideoTexture','isRenderTargetTexture','isDepthTexture'].some(k=>flags[k])
  &&map.format===RGBAFormat&&map.type===UnsignedByteType&&map.colorSpace===SRGBColorSpace&&map.channel===0&&!map.flipY&&!map.premultiplyAlpha
  &&map.wrapS===RepeatWrapping&&map.wrapT===RepeatWrapping&&map.minFilter===LinearMipmapLinearFilter&&map.magFilter===LinearFilter
  &&Number.isFinite(map.anisotropy)&&map.anisotropy>=1&&map.anisotropy<=16&&image?.width===512&&image.height===512
  &&map.offset.x===0&&map.offset.y===0&&map.repeat.x===1&&map.repeat.y===1&&map.center.x===0&&map.center.y===0&&map.rotation===0
  &&(map.matrixAutoUpdate||map.matrix.elements.every((v,i)=>v===(i%4===0?1:0)));
}
/** Exact family/count/UV/material gate before any clone or normal allocation.
 * Pixel provenance is additionally checked inside the actual worker boundary. */
export function qualifyGeneratedRegionalFoliage(variants:readonly Variant[],profile:'desktop'|'quest',sourceSha256:string):Assignment[]{
 if(sourceSha256!==REGIONAL_VEGETATION_PROFILES[profile]?.sha256||variants.length!==15)throw Error('Generated foliage source profile does not match the pinned regional asset.');
 const assignments:Assignment[]=[];
 for(let family=0;family<15;family++){
  const variant=variants[family],key=generatedFoliageMapForPrototype(variant.id);
  if(variant.id!==REGIONAL_VEGETATION_PROTOTYPES[family].id||!key||variant.parts.length!==2||variant.parts.filter(p=>p.foliage).length!==1)throw Error('Generated foliage family/parts do not match the pinned regional asset.');
  const index=variant.parts.findIndex(p=>p.foliage),original=variant.parts[index],{material,geometry}=original,map=material.map,position=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
  if(!(material instanceof MeshStandardMaterial)||material.name!==key+' foliage'||material.normalMap||material.aoMap||material.alphaMap||material.normalMapType!==TangentSpaceNormalMap||material.transparent||material.opacity!==1||material.side!==DoubleSide||material.alphaTest!==.4||!material.vertexColors||Math.abs(material.roughness-.86)>1e-7||material.metalness!==0||material.color.toArray().some((v,i)=>Math.abs(v-sourceColour.toArray()[i])>1e-6)||!map||!supportedMap(map))throw Error('Generated foliage material/map is unsupported or already authored.');
  if(!position||position.count!==cards[family]*4||!uv||uv.count!==position.count||uv.itemSize!==2||geometry.index?.count!==cards[family]*6||geometry.groups.length||Object.keys(geometry.morphAttributes).length)throw Error('Generated foliage topology does not match the pinned spray source.');
  for(let at=0;at<uv.count;at++)if(uv.getX(at)!==(at%2)||uv.getY(at)!==(at%4<2?0:1))throw Error('Generated foliage UVs do not align with its colour/alpha source.');
  assignments.push({parts:variant.parts,index,original,material,map,mapVersion:map.version,materialVersion:material.version,stamp:mapStamp(map),key});
 }
 const maps=new Map<GeneratedFoliageMap,Texture>();for(const row of assignments){const old=maps.get(row.key);if(old&&old!==row.map)throw Error('Generated foliage species has multiple unqualified map sources.');maps.set(row.key,row.map);}
 if(maps.size!==6)throw Error('Generated foliage map set is incomplete.');
 return assignments;
}
function normalTexture(map:Texture,mips:Awaited<ReturnType<VegetationPreparationWorker['foliageNormals']>>['mips']){
 const base=mips[0],texture=new DataTexture(base.rgba,base.width,base.height,RGBAFormat,UnsignedByteType);
 texture.name='Crownfall generated regional normal RGB';texture.colorSpace=NoColorSpace;texture.generateMipmaps=false;
 texture.mipmaps=mips.map(mip=>({data:mip.rgba,width:mip.width,height:mip.height}));
 texture.channel=map.channel;texture.flipY=map.flipY;texture.wrapS=map.wrapS;texture.wrapT=map.wrapT;texture.magFilter=map.magFilter;texture.minFilter=map.minFilter;texture.anisotropy=map.anisotropy;
 texture.offset.copy(map.offset);texture.repeat.copy(map.repeat);texture.center.copy(map.center);texture.rotation=map.rotation;texture.matrixAutoUpdate=map.matrixAutoUpdate;texture.matrix.copy(map.matrix);
 texture.premultiplyAlpha=false;texture.unpackAlignment=map.unpackAlignment;texture.needsUpdate=true;return texture;
}
export function createGeneratedRegionalFoliageNormals(options:{
 variants:readonly Variant[];profile:'desktop'|'quest';sourceSha256:string;native?:boolean;signal:AbortSignal;
 renderer:WebGLRenderer;queue:WorldPreparationQueue;worker:VegetationPreparationWorker;resources:VegetationPrototypeResources;
 retirementFence():Promise<void>;changed():void;
},readPixels:(map:Texture,signal?:AbortSignal)=>Promise<FoliageRgbaPixels>=readFoliageRgbaPixels){
 const size=generatedFoliageNormalSize(options.native),maximum=generatedFoliageNormalBudget(options.native),maps=new Map<GeneratedFoliageMap,OwnedMap>(),leases:MaterialLease[]=[];
 const stats={generator:GENERATED_FOLIAGE_NORMAL_VERSION,status:'awaiting-preparation',error:'',size,maps:0,materials:0,textureBytes:0,retainedBufferBytes:0,maximumRetainedBufferBytes:maximum,sourceDecodedBytes:0,sourceTextureBytesEstimate:0,sourcePixels:[] as {map:GeneratedFoliageMap;png:string;canonical:string;decoded:string}[]};
 const controller=new AbortController(),signal=controller.signal;let assignments:Assignment[]=[],disposed=false,submitted=false,preparation:Promise<void>|null=null,cleanup:Promise<void>|null=null;
 let finishRetirement!:()=>void;const retired=new Promise<void>(resolve=>{finishRetirement=resolve;});
 function restore(){for(const row of assignments)if(row.assigned&&row.parts[row.index]===row.assigned)row.parts[row.index]=row.original;}
 function retireOwned(){
  if(cleanup)return cleanup;
  cleanup=(async()=>{
   const materials=await Promise.allSettled(leases.map(lease=>lease.ready));if(submitted)await options.retirementFence();
   // Clones belong to the base material pool; its own entries retain their
   // charge. Detach our data only after every compiler/draw has retired.
   for(const material of materials)if(material.status==='fulfilled')material.value.material.normalMap=null;
   for(const lease of leases)lease.release();leases.length=0;
   for(const {texture} of maps.values()){texture.dispose();texture.mipmaps=[];texture.image={data:new Uint8Array(0),width:0,height:0};}
   maps.clear();stats.maps=stats.materials=stats.textureBytes=stats.retainedBufferBytes=0;
  })();
  return cleanup;
 }
 function dispose(){if(disposed)return;disposed=true;controller.abort();restore();options.signal.removeEventListener('abort',dispose);stats.status='disposed';
  void Promise.resolve(preparation).catch(()=>{}).then(retireOwned).then(finishRetirement);
 }
 options.signal.addEventListener('abort',dispose,{once:true});if(options.signal.aborted)dispose();
 async function build(){
  try{
   signal.throwIfAborted();assignments=qualifyGeneratedRegionalFoliage(options.variants,options.profile,options.sourceSha256);
   stats.status='preparing';options.changed();
   const unique=new Map(assignments.map(row=>[row.key,row]));
   for(const [key,row] of unique){
    signal.throwIfAborted();const pixels=await readPixels(row.map,signal);signal.throwIfAborted();
    const record=await options.worker.foliageNormals({map:key,rgba:pixels.rgba,width:pixels.width,height:pixels.height,size});signal.throwIfAborted();
    const bytes=generatedFoliageNormalBytes(size);
    if(record.bytes!==bytes||record.canonicalSha256!==GENERATED_FOLIAGE_MAPS[key].rgba||record.mips.length!==Math.log2(size)+1||record.mips.some((mip,i)=>mip.width!==size>>i||mip.height!==size>>i||mip.rgba.length!==mip.width*mip.height*4)||stats.retainedBufferBytes+bytes*2>maximum)throw Error('Generated foliage normal result exceeded its exact mip/residency contract.');
    const texture=normalTexture(row.map,record.mips),identity=JSON.stringify([GENERATED_FOLIAGE_NORMAL_VERSION,options.sourceSha256,key,GENERATED_FOLIAGE_MAPS[key].png,record.canonicalSha256,record.sourcePixelSha256,size,GENERATED_FOLIAGE_NORMAL_STRENGTH,GENERATED_FOLIAGE_NORMAL_SCALE,'srgb-linear-alpha-height;source-texel;uv0;flipY=false;normal-rgb;coverage-alpha',options.native?'iwsdk-r185':'three-r185']);
    maps.set(key,{texture,identity,bytes});stats.maps=maps.size;stats.textureBytes+=bytes;stats.retainedBufferBytes+=bytes*2;stats.sourceDecodedBytes+=pixels.width*pixels.height*4;stats.sourceTextureBytesEstimate+=generatedFoliageNormalBytes(512);
    stats.sourcePixels.push({map:key,png:GENERATED_FOLIAGE_MAPS[key].png,canonical:record.canonicalSha256,decoded:record.sourcePixelSha256});
    submitted=true;await options.queue.enqueue({bytes,signal,priority:()=>85,work:()=>options.renderer.initTexture(texture)});signal.throwIfAborted();options.changed();
   }
   const clones=new Map<MeshStandardMaterial,MeshStandardMaterial>();
   for(const row of assignments){
    if(clones.has(row.material))continue;
    const map=maps.get(row.key)!;
    const lease=options.resources.material('generated-foliage-normal:'+row.material.uuid+':'+map.identity,()=>{
     const material=row.material.clone();material.onBeforeCompile=row.material.onBeforeCompile;material.onBeforeRender=row.material.onBeforeRender;const key=row.material.customProgramCacheKey;
     material.customProgramCacheKey=()=>key.call(row.material)+':'+GENERATED_FOLIAGE_NORMAL_VERSION;
     material.normalMap=map.texture;material.normalMapType=TangentSpaceNormalMap;material.normalScale.set(GENERATED_FOLIAGE_NORMAL_SCALE,GENERATED_FOLIAGE_NORMAL_SCALE);
     material.userData.crownfallGeneratedFoliageNormalIdentity=map.identity;return material;
    });leases.push(lease);clones.set(row.material,(await lease.ready).material);signal.throwIfAborted();
   }
   qualifyGeneratedRegionalFoliage(options.variants,options.profile,options.sourceSha256);
   for(const row of assignments)if(row.parts[row.index]!==row.original||row.material.map!==row.map||row.material.version!==row.materialVersion||row.map.version!==row.mapVersion||mapStamp(row.map)!==row.stamp)throw Error('Generated foliage source changed during preparation; retain the existing source.');
   signal.throwIfAborted();
   for(const row of assignments){row.assigned={...row.original,material:clones.get(row.material)!};row.parts[row.index]=row.assigned;}
   stats.materials=clones.size;stats.status='ready';options.changed();
  }catch(cause){restore();await retireOwned();if(!disposed){stats.status='fallback';stats.error=cause instanceof Error?cause.message:String(cause);options.changed();}}
 }
 return{stats,prepare(){if(disposed)return Promise.resolve();return preparation??=build();},dispose,whenRetired:()=>retired};
}

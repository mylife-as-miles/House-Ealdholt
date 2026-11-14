import {DataTexture,LinearFilter,LinearMipmapLinearFilter,Matrix4,Mesh,MeshStandardMaterial,RGBAFormat,RepeatWrapping,SRGBColorSpace,Texture,Vector4,type Object3D} from 'three';
import {regionalForestFloorField,patchRegionalForestFloor,REGIONAL_FOREST_FLOOR_VERSION,REGIONAL_FOREST_FLOOR_MATERIAL_VERSION} from '../../../../shared/legacy/aethelgard/environment/regional-forest-floor';
import {packRegionalForestFloor,REGIONAL_FOREST_FLOOR_TEXTURE_VERSION,type RegionalForestLitterPixels} from '../../../../shared/legacy/aethelgard/environment/regional-forest-floor-pack';
import type {RegionalWorldLayout,RegionalPrototype} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
import type {EaldholtFarGeography} from '../../../../shared/legacy/aethelgard/environment/far-surround';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';

/** Read source pixels without mutating cached images or their Source.version.
 * ImageBitmap orientation is already decoded; WebGL ignores its flipY flag. */
export function readRegionalForestLitterPixels(source:Texture):RegionalForestLitterPixels{
 const image=source.image as CanvasImageSource&{width?:number;height?:number},size=image?.width;
 if(!Number.isInteger(size)||!size||size<2||size>1024||image.height!==size)throw Error('Unsupported forest litter image dimensions.');
 if(source.magFilter!==LinearFilter||(source.minFilter!==LinearFilter&&source.minFilter!==LinearMipmapLinearFilter))throw Error('Forest litter requires linear filtering for shared cover sampling.');
 const canvas=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(size,size):Object.assign(document.createElement('canvas'),{width:size,height:size});
 const context=canvas.getContext('2d',{willReadFrequently:true}) as CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D|null;
 if(!context)throw Error('Forest litter pixels are unavailable.');
 context.drawImage(image,0,0);const data=context.getImageData(0,0,size,size).data;
 return{size,data,flipY:source.flipY&&!(typeof ImageBitmap!=='undefined'&&image instanceof ImageBitmap)};
}
export function createRegionalForestFloor(options:{sourceRoot:Object3D;owners:readonly Object3D[];geography:EaldholtFarGeography;prototypes:readonly RegionalPrototype[];queue:WorldPreparationQueue;signal:AbortSignal;borrowedSource?:boolean;load():Promise<Texture>;changed():void}){
 const stats={status:'loading',error:'',materials:0,fieldBytes:0,textureBytes:0,samplers:0,coverageVersion:REGIONAL_FOREST_FLOOR_VERSION,textureVersion:REGIONAL_FOREST_FLOOR_TEXTURE_VERSION},owner='floor-'+Math.random().toString(36).slice(2),materials=new Map<MeshStandardMaterial,MeshStandardMaterial>(),originals=new Map<string,MeshStandardMaterial>();
 let texture:DataTexture|null=null,pixels:RegionalForestLitterPixels|null=null,disposed=false;
 let filtering:{min:Texture['minFilter'];mag:Texture['magFilter'];mips:boolean;anisotropy:number}|null=null;
 const sourceFrame={value:new Matrix4()},bounds={value:new Vector4()},packed={value:null as Texture|null};
 function restore(){for(const root of options.owners)root.traverse(node=>{if(!(node instanceof Mesh))return;const list=Array.isArray(node.material)?node.material:[node.material],next=list.map(m=>m.userData.crownfallFloorOwner===owner?originals.get(m.userData.crownfallFloorOriginal)??m:m);if(next.some((m,i)=>m!==list[i]))node.material=Array.isArray(node.material)?next:next[0];});}
 function dispose(){if(disposed)return;disposed=true;options.signal.removeEventListener('abort',dispose);pixels=null;restore();
  void options.queue.whenIdle().then(()=>{texture?.dispose();for(const material of materials.values())material.dispose();});stats.status='disposed';
 }
 const fail=(cause:unknown)=>{if(!disposed){stats.status='held-error';stats.error=String(cause);options.changed();}};
 options.signal.addEventListener('abort',dispose,{once:true});if(options.signal.aborted)dispose();
 if(!disposed)void options.load().then(source=>{try{
  if(disposed)return;pixels=readRegionalForestLitterPixels(source);filtering={min:source.minFilter,mag:source.magFilter,mips:source.generateMipmaps,anisotropy:source.anisotropy};stats.status='awaiting-layout';options.changed();
 }finally{if(!options.borrowedSource)source.dispose();}}).catch(fail);
 return{stats,update(layout:RegionalWorldLayout){
  if(disposed||!pixels||!filtering||texture||stats.status==='held-error')return;
  try{
  const grid=regionalForestFloorField(options.geography,layout,options.prototypes),data=packRegionalForestFloor(pixels,grid.data,grid.size);
  texture=new DataTexture(data,grid.size,grid.size,RGBAFormat);texture.colorSpace=SRGBColorSpace;texture.flipY=false;texture.premultiplyAlpha=false;
  texture.wrapS=texture.wrapT=RepeatWrapping;texture.minFilter=filtering.min;texture.magFilter=filtering.mag;texture.generateMipmaps=filtering.mips;texture.anisotropy=filtering.anisotropy;texture.unpackAlignment=1;texture.needsUpdate=true;
  packed.value=texture;bounds.value.fromArray(grid.bounds);stats.fieldBytes=grid.data.byteLength;stats.textureBytes=data.byteLength;stats.samplers=1;pixels=null;
  for(const root of options.owners)root.traverse(node=>{if(!(node instanceof Mesh)||node.userData.crownfallElderbloom?.kind!=='terrain')return;const list=Array.isArray(node.material)?node.material:[node.material];
   const next=list.map(original=>{if(!(original instanceof MeshStandardMaterial))return original;const prior=materials.get(original);if(prior)return prior;
    const material=original.clone(),compile=original.onBeforeCompile,key=original.customProgramCacheKey;
    material.onBeforeCompile=function(shader,renderer){compile.call(this,shader,renderer);patchRegionalForestFloor(shader,{cfForestToSource:sourceFrame,cfForestBounds:bounds,cfForestLitterCover:packed});
    };material.customProgramCacheKey=()=>key.call(original)+':regional-'+REGIONAL_FOREST_FLOOR_VERSION+':'+REGIONAL_FOREST_FLOOR_TEXTURE_VERSION+':'+REGIONAL_FOREST_FLOOR_MATERIAL_VERSION;material.userData.crownfallFloorOwner=owner;material.userData.crownfallFloorOriginal=original.uuid;materials.set(original,material);originals.set(original.uuid,original);return material;
   });node.material=Array.isArray(node.material)?next:next[0];
  });stats.materials=materials.size;stats.status='ready';options.changed();
  }catch(cause){restore();fail(cause);}
 },refreshFrame(){options.sourceRoot.updateWorldMatrix(true,false);sourceFrame.value.copy(options.sourceRoot.matrixWorld).invert();},dispose};
}
export type RegionalForestFloor=ReturnType<typeof createRegionalForestFloor>;

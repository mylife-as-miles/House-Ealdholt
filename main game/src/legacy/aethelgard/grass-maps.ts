import { LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three';
import { readEaldholtValleyGrassManifest, type EaldholtValleyGrassProfile } from '../../../../shared/legacy/aethelgard/environment/grass-maps';
import type { EaldholtBorrowedSurfaceMaps } from './ground-albedo-detail';

export interface EaldholtValleyGrassMaps {
  readonly surfaceMaps:EaldholtBorrowedSurfaceMaps;readonly profile:EaldholtValleyGrassProfile;readonly textureCount:3;
  readonly downloadBytes:number;readonly extraTextureBytesWithMipsEstimate:number;
  dispose():void;
}
/** Explicit lazy load only. The caller disposes valley borrowers before this
 * owner. Abort/failure releases every completed texture, including late loads;
 * TextureLoader's in-flight image requests settle before cleanup completes. */
export async function loadEaldholtValleyGrassMaps(baseUrl:string,profile:EaldholtValleyGrassProfile,signal?:AbortSignal):Promise<EaldholtValleyGrassMaps> {
  signal?.throwIfAborted();
  const directory=baseUrl.endsWith('/')?baseUrl:baseUrl+'/',response=await fetch(directory+'manifest.json',{signal});
  if(!response.ok)throw Error('Canonical grass texture manifest unavailable.');
  const manifest=readEaldholtValleyGrassManifest(await response.json(),profile);signal?.throwIfAborted();
  const loader=new TextureLoader(),roles=['albedo','normal','orm']as const;
  const settled=await Promise.allSettled(roles.map(role=>loader.loadAsync(directory+manifest.files[role].file)));
  const textures=settled.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);let disposed=false;
  const release=()=>{if(disposed)return;disposed=true;for(const texture of new Set(textures))texture.dispose();};
  try{
    for(const result of settled)if(result.status==='rejected')throw result.reason;
    signal?.throwIfAborted();
    for(let i=0;i<textures.length;i++){
      const texture=textures[i],image=texture.image as {width?:number;height?:number}|null;
      if(image?.width!==manifest.size||image.height!==manifest.size)throw Error('Canonical grass image dimensions differ from the selected profile.');
      texture.colorSpace=roles[i]==='albedo'?SRGBColorSpace:NoColorSpace;texture.flipY=false;
      texture.wrapS=texture.wrapT=RepeatWrapping;texture.channel=0;texture.repeat.set(1,1);texture.offset.set(0,0);texture.rotation=0;
      texture.generateMipmaps=true;texture.minFilter=LinearMipmapLinearFilter;texture.magFilter=LinearFilter;texture.anisotropy=4;texture.needsUpdate=true;
    }
    return{surfaceMaps:{albedo:textures[0],normal:textures[1],orm:textures[2],meanLuminance:manifest.meanLuminance,sourceAssetId:manifest.assetId,tileMetres:manifest.tileMetres},profile,textureCount:3,
      downloadBytes:manifest.downloadBytes,extraTextureBytesWithMipsEstimate:manifest.gpuBytesWithMipsEstimate,dispose:release};
  }catch(error){release();throw error;}
}

import { ClampToEdgeWrapping, DataTexture, LinearFilter, Mesh, NoColorSpace, NormalBlending, PlaneGeometry,
  RGBAFormat, ShaderMaterial, UnsignedByteType, Vector2, Vector3, type WebGLRenderer } from 'three';
import { createProceduralFireField, type ProceduralFireWeather } from '../../../../shared/legacy/aethelgard/environment/procedural-fire-field';
import { createProceduralFireBlackbodyLut, proceduralFireBlackbody } from '../../../../shared/legacy/aethelgard/environment/procedural-fire-blackbody';
import { PROCEDURAL_FIRE_CARD_FRAGMENT, PROCEDURAL_FIRE_CARD_VERTEX } from '../../../../shared/legacy/aethelgard/environment/procedural-fire-shader';
export type { ProceduralFireWeather } from '../../../../shared/legacy/aethelgard/environment/procedural-fire-field';
export interface ProceduralFireRuntimeOptions { readonly renderer?: Pick<WebGLRenderer,'capabilities'|'getContext'> }

/** One bounded presentation field for all hearths/torches/raid cards in a view.
 * No renderer/device/task/animation clock is created. RGBA8 slice textures are
 * the compatibility fallback for the reference's full WebGPU volume solver. */
export function createProceduralFireRuntime(options:ProceduralFireRuntimeOptions={}) {
  const field=createProceduralFireField(), maximum=options.renderer?.capabilities.maxTextureSize??4096;
  const supported=maximum>=24, collapsed=maximum<96, width=supported?(collapsed?16:64):1,height=supported?(collapsed?24:96):1;
  const bytes=new Uint8Array(width*height*4), lut=supported?createProceduralFireBlackbodyLut(Math.min(128,maximum)):{data:new Uint8Array([255,128,32,255]),width:1,height:1};
  // The sampled source starts as hot pyrolysis gas, not a luminous flame.
  // Evolve a finite presentation-only burn before publishing its first atlas;
  // a first Hold/reduced-motion frame then freezes actual reacted hot gas.
  const prewarmSteps=supported?24:0;
  for(let step=0;step<prewarmSteps;step++)field.step(1/12);
  if(supported)field.writeAtlas(bytes,collapsed);
  const texture=new DataTexture(bytes,width,height,RGBAFormat,UnsignedByteType);
  const blackbody=new DataTexture(lut.data,lut.width,lut.height,RGBAFormat,UnsignedByteType);
  for(const image of [texture,blackbody]){image.minFilter=LinearFilter;image.magFilter=LinearFilter;image.wrapS=ClampToEdgeWrapping;
    image.wrapT=ClampToEdgeWrapping;image.generateMipmaps=false;image.colorSpace=NoColorSpace;image.needsUpdate=true;}
  const color=proceduralFireBlackbody(1500), uniforms={cfFireAtlas:{value:texture},cfFireBlackbody:{value:blackbody},
    cfFireGrid:{value:new Vector3(supported?16:1,supported?24:1,collapsed?1:16)},cfFireTiles:{value:new Vector2(collapsed?1:4,collapsed?1:4)},
    cfFireSupported:{value:supported?1:0},cfFireFallbackColor:{value:new Vector3(color[0],color[1],color[2])}};
  const geometry=new PlaneGeometry(1,1);geometry.translate(0,.5,0);
  const materials=new Set<ShaderMaterial>();let disposed=false,uploads=1,contextHeld=false;
  function createMaterial(spec:{readonly intensity?:number;readonly phase?:number}={}) {
    if(disposed)throw Error('Procedural fire runtime is disposed.');
    const material=new ShaderMaterial({name:'Leon Lin combustion slice card',uniforms:{...uniforms,
      cfFireIntensity:{value:Number.isFinite(spec.intensity)?Math.max(0,Math.min(4,spec.intensity!)):1},
      cfFirePhase:{value:Number.isFinite(spec.phase)?spec.phase!:0}},vertexShader:PROCEDURAL_FIRE_CARD_VERTEX,
      fragmentShader:PROCEDURAL_FIRE_CARD_FRAGMENT,transparent:true,blending:NormalBlending,premultipliedAlpha:true,
      depthTest:true,depthWrite:false,toneMapped:true});
    materials.add(material);return material;
  }
  return {
    uniforms,createMaterial,
    createFlame(spec:{readonly width:number;readonly height:number;readonly intensity?:number;readonly phase?:number}) {
      if(!Number.isFinite(spec.width)||!Number.isFinite(spec.height)||spec.width<=0||spec.height<=0)throw Error('Fire cards need finite positive source-metre dimensions.');
      const mesh=new Mesh(geometry,createMaterial(spec));mesh.name='Combustion slice card';mesh.scale.set(spec.width,spec.height,1);
      mesh.castShadow=false;mesh.receiveShadow=false;mesh.frustumCulled=false;
      mesh.userData.iwsdkPreviewBounds='exclude';mesh.userData.fireRepresentation='slice-card-2.5d';return mesh;
    },
    update(time:number,reducedMotion:boolean,weather?:ProceduralFireWeather|null):boolean {
      if(disposed)return false;
      contextHeld=!!options.renderer?.getContext().isContextLost();
      const changed=field.advance(time,reducedMotion||contextHeld||!supported,weather);
      if(changed){field.writeAtlas(bytes,collapsed);texture.needsUpdate=true;uploads++;}return changed;
    },
    get diagnostics(){return Object.freeze({...field.diagnostics,representation:'slice-card-2.5d' as const,
      occlusion:'depth-tested-card-plane' as const,capability:supported?(collapsed?'collapsed-rgba8':'slice-atlas-rgba8'):'static-pilot',
      atlasWidth:width,atlasHeight:height,atlasBytes:bytes.byteLength,prewarmSteps,uploads,contextHeld,materials:materials.size,disposed});},
    dispose(){if(disposed)return;disposed=true;field.dispose();geometry.dispose();texture.dispose();blackbody.dispose();
      for(const material of materials)material.dispose();materials.clear();},
  };
}
export type ProceduralFireRuntime=ReturnType<typeof createProceduralFireRuntime>;

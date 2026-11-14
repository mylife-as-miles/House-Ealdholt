/**
 * Golden Temple grounds adapted for Crownfall, from Leon Lin's MIT-licensed
 * 97fd9ec35ee5c0f02769addb4e35cb5e22f951dd. See LICENSE and SOURCES files here.
 * Original campus composition and architecture; no upstream UI, camera loop,
 * offline film renderer, music or SDF religious statue.
 */
import * as THREE from 'crownfall-world-three';
import { createTerrainHubs, createSourceClearance } from '../exploration';
import { MeshBVH } from 'crownfall-world-bvh';
import { applySourceLodSliced } from './lod.js';
import { ENV, G, sunDir } from './upstream/core/env.js';
import { createSky } from './upstream/core/sky.js';
import { materials, patch, std, phys, glow, PROC, depthMaterialFor } from './upstream/core/materials.js';
import * as geom from './upstream/core/geom.js';
import { rng } from './upstream/core/rng.js';
import { L as sourceLayout } from './upstream/layout.js';
import * as terrain from './upstream/world/terrain.js';
import * as pond from './upstream/world/pond.js';
import * as hall from './upstream/world/hall.js';
import * as pagoda from './upstream/world/pagoda.js';
import * as bridge from './upstream/world/bridge.js';
import * as buildings from './upstream/world/buildings.js';
import * as props from './upstream/world/props.js';
import { setPropGeometryProfile } from './upstream/world/props-geo.js';
import * as vegetation from './upstream/world/vegetation.js';

const MODULES = [['terrain',terrain],['pond',pond],['hall',hall],['pagoda',pagoda],['bridge',bridge],['buildings',buildings],['props',props],['vegetation',vegetation]];
const yieldTask = () => new Promise(resolve => setTimeout(resolve,0));

export async function buildWorld(options) {
  if(options.THREE && !(new THREE.Group() instanceof options.THREE.Object3D))throw new Error('Golden Temple Three namespace does not match the consuming renderer');
  const profile=options.profile==='quest'?'quest':'desktop';
  setPropGeometryProfile(profile);
  const root=new THREE.Group();root.name='Crownfall Temple Terraces — Golden Temple source grounds';
  const staging=new THREE.Scene();
  const sourceCamera=new THREE.PerspectiveCamera(44,1,.1,6000);
  sourceCamera.position.set(91,47,101);sourceCamera.lookAt(4,6,-4);sourceCamera.updateMatrixWorld();
  const layout=structuredClone(sourceLayout);layout.crownfallProfile=profile;
  const updates=[], built=[], modules={};
  const ctx={THREE,renderer:options.renderer,scene:staging,camera:sourceCamera,L:layout,G,ENV,sunDir,geom,rng,quality:'preview',crownfallProfile:profile,
    M:materials(),mat:{patch,std,phys,glow,PROC,depthMaterialFor},modules,
    onUpdate:fn=>updates.push(fn),
    // Source finalize() IBL captures are offline-film work and are not invoked.
    captureEnv:()=>null,
  };
  G.uTime.value=37;G.uShot.value=-1;G.uWindStrength.value=profile==='quest'?0:1;
  const resources={targets:[],disposed:false};
  const sourceLights = new Map();
  try {
    for(const [name,module] of MODULES){
      options.onProgress?.(`Building temple ${name}`);
      await yieldTask();
      // A disposed pending view can abort between module slices. Its thrown
      // progress callback is caught below and releases the internal staging.
      options.onProgress?.(`Building temple ${name}`);
      const result=await module.build(ctx);
      if(!result?.object)throw new Error(`Golden Temple ${name} did not return its source geometry`);
      result.object.name=`Temple ${name}`;root.add(result.object);
      modules[name]=result;built.push(result);
      if(result.update)updates.push(result.update);
    }
    // The source corridors publish lantern/bell attachment points. Retain them;
    // Crownfall's actual house standards are installed by the owning adapter.
    const anchors={hangingLanterns:[],bells:[],smallBells:[]};
    for(const result of built)if(result.anchors)for(const [key,list]of Object.entries(result.anchors)){
      if(Array.isArray(list))(anchors[key]??=[]).push(...list);
    }
    const anchored=props.placeAnchors(ctx,anchors);if(anchored)root.add(anchored.isObject3D?anchored:anchored.object);
    // Source props can append practical lights to their staging scene.
    for(const child of [...staging.children])root.add(child);
    const sky=createSky();sky.name='Temple source sky';root.add(sky);
    if(profile==='quest')root.traverse(object=>{
      if(!object.isMesh)return;
      object.castShadow=false;
      // Full silhouette and the shared source terrain remain. Source foliage
      // already uses deterministic card thinning and coarser terrain sampling.

    });
    // PERFORMANCE.md forbids a long unbroken freeze while loading; a disposed pending view aborts here too.
    resources.lod = await applySourceLodSliced(root,profile,async()=>{options.onProgress?.('Reducing temple geometry');await yieldTask();});
    root.traverse(object=>{if(object.isPointLight||object.isSpotLight)sourceLights.set(object,{intensity:object.intensity,distance:object.distance});});
    root.updateMatrixWorld(true);
  }catch(error){dispose();throw error;}

  function setSourceTransform(inverseRootMatrix,sourceCameraPosition){
    if(inverseRootMatrix){
      G.uCrownfallSourceInverse.value.copy(inverseRootMatrix);
      G.uCrownfallSourceRoot.value.copy(inverseRootMatrix).invert();
      const e=inverseRootMatrix.elements;
      G.uCrownfallSourceScale.value=1/Math.max(1e-9,Math.hypot(e[0],e[1],e[2]));
    }else{G.uCrownfallSourceInverse.value.identity();G.uCrownfallSourceRoot.value.identity();G.uCrownfallSourceScale.value=1;}
    if(sourceCameraPosition){G.uCrownfallSourceCamera.value.copy(sourceCameraPosition);sourceCamera.position.copy(sourceCameraPosition);sourceCamera.updateMatrixWorld();}
    for(const [light,source]of sourceLights){light.intensity=source.intensity*G.uCrownfallSourceScale.value**2;light.distance=source.distance*G.uCrownfallSourceScale.value;}
  }
  setSourceTransform(null,sourceCamera.position);
  function update(timeSeconds,deltaSeconds){
    if(resources.disposed)return;
    const time=37+timeSeconds;G.uTime.value=time;G.uFrame.value++;
    // The original updates animate water, koi and local practical lights. The
    // host owns the clock and pause/reduced-motion policy; no extra RAF exists.
    for(const [light,source]of sourceLights){light.intensity=source.intensity;light.distance=source.distance;}
    for(const callback of updates)callback(time,ctx,deltaSeconds);
    for(const [light,source]of sourceLights){source.intensity=light.intensity;light.intensity=source.intensity*G.uCrownfallSourceScale.value**2;light.distance=source.distance*G.uCrownfallSourceScale.value;}
  }
  function dispose(){
    if(resources.disposed)return;resources.disposed=true;
    for(const result of built)result.dispose?.();
    const geometries=new Set(),mats=new Set(),textures=new Set();
    root.traverse(object=>{
      object.onBeforeRender=()=>{};
      if(object.geometry)geometries.add(object.geometry);
      for(const material of object.material?(Array.isArray(object.material)?object.material:[object.material]):[]){
        mats.add(material);
        for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
        for(const uniform of Object.values(material.uniforms??{}))if(uniform?.value?.isTexture)textures.add(uniform.value);
        for(const uniform of Object.values(material.userData?.patch?.uniforms??{}))if(uniform?.value?.isTexture)textures.add(uniform.value);
      }
      if(object.customDepthMaterial)mats.add(object.customDepthMaterial);
    });
    for(const geometry of geometries)geometry.dispose();for(const material of mats)material.dispose();for(const texture of textures)texture.dispose();
    root.clear();staging.clear();updates.length=0;sourceLights.clear();props.releaseSourceState();
    ctx.modules={};ctx.renderer=null;ctx.camera=null;
  }
  const landmarks=[{id:'banner-hall',position:[10,5,-6]},{id:'muster-grounds',position:[10,1,0]},{id:'war-record',position:[-32,3,-1]},{id:'heralds-station',position:[10,2,46]}];
  options.onProgress?.('Validating temple walking areas');
  const clearAt=createSourceClearance(THREE,root,landmarks,MeshBVH),field=modules.terrain.field;
  const exploration=createTerrainHubs({groundAt:field.heightAt,dryAt:(x,z)=>field.sdPondEff(x,z)>.8,clearAt,cameraColliders:clearAt.colliders,landmarks});
  return {
    root,update,dispose,setSourceTransform,exploration,
    reflectionTarget:()=>resources.disposed||!ctx.pondReflection?null:[ctx.pondReflection.width,ctx.pondReflection.height],
    stats: { lod: resources.lod },
    view:{position:[91,47,101],target:[4,6,-4],fov:44},
    landmarks:[
      {id:'banner-hall',position:[10,5,-6]},
      {id:'muster-grounds',position:[10,1,0]},
      {id:'war-record',position:[-32,3,-1]},
      {id:'heralds-station',position:[10,2,46]},
    ],
    extent:{center:[8,12,-1],width:160,depth:150,height:58},
    lighting:{sunDirection:sunDir.toArray(),sunColor:'#ffcf98',skyColor:'#b9c5d6',groundColor:'#5b6553',exposure:1.05},
    source:{project:'Leonxlnx/golden-temple',commit:'97fd9ec35ee5c0f02769addb4e35cb5e22f951dd',modules:MODULES.map(x=>x[0]),profile},
  };
}

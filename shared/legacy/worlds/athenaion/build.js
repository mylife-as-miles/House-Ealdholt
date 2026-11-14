/** Athenaion → Crownfall whole-world adapter. Source MIT notice: ./LICENSE.
 * Keeps source heightfield, acropolis, temples, stairs, aqueducts, city and trees.
 * The film engine, source UI, CSM/global shader patches, religion and owl banners
 * are replaced by Crownfall's renderer, interaction and real house heraldry.
 */
import * as THREE from 'crownfall-world-three';
import { createTerrainHubs, createSourceClearance } from '../exploration';
import { MeshBVH } from 'crownfall-world-bvh';
import { heightAt } from './vendor/world/heightfield.js';
import { createGeometryCompactor } from './compact.js';
import { mergeStaticMeshes } from './merge.js';
import { patchSourceMaterial } from './coordinates.js';
import { releaseOwnedWorld } from './lifecycle.js';
import { Footprints } from './vendor/core/footprints.js';
import { RNG } from './vendor/core/rng.js';
import { ATMO, ATMO_GLSL } from './vendor/core/atmosphere.js';
import { SKY, createSky, ensureCloudTextures } from './vendor/core/sky.js';
import { SUN } from './vendor/core/lighting.js';
import { SHOTS } from './vendor/world/shots.js';
import * as L from './vendor/world/layout.js';
import { build as terrain } from './vendor/modules/terrain.js';
import { build as water } from './vendor/modules/water.js';
import { build as temple } from './vendor/modules/temple.js';
import { build as acropolis } from './vendor/modules/acropolis.js';
import { build as aqueducts } from './vendor/modules/aqueducts.js';
import { build as city } from './vendor/modules/city.js';
import { build as vegetation } from './vendor/modules/vegetation.js';
import { build as waterfalls } from './vendor/modules/waterfalls.js';
import { build as birds } from './vendor/modules/birds.js';

const yieldBuild=()=>new Promise(resolve=>setTimeout(resolve,0));
// Unmoving architecture. Birds, boats, water and trees keep their own draws.
const MERGED_MODULES=new Set(['temple','acropolis','aqueducts','city']);
// These two place their pieces with transforms, animate nothing and shade in world space.
const BAKED_MODULES=new Set(['temple','acropolis']);

export async function buildWorld(ctx) {
  if(!ctx.THREE||!(new THREE.Group() instanceof ctx.THREE.Object3D))throw Error('Athenaion must use the Crownfall platform Three namespace');
  const quest=ctx.profile==='quest';
  const compactGeometry=createGeometryCompactor(THREE,ctx.profile);
  const root=new THREE.Group();root.name='Crownfall_Athenaion_World';
  const staging=ctx.scene,initialChildren=new Set(ctx.scene.children),resources=new Set(),releasers=new Set();
  let disposed=false;
  const updates=[],shotHooks=[],moduleRoots={};
  const sourceCamera=ctx.camera.clone();
  sourceCamera.position.set(...SHOTS[2].pos);sourceCamera.lookAt(new THREE.Vector3(...SHOTS[2].target));sourceCamera.updateMatrixWorld(true);
  const sourceFromWorld={value:new THREE.Matrix4()},worldFromSource={value:new THREE.Matrix4()},sourceEye={value:sourceCamera.position.clone()};
  const seenMaterials=new WeakSet(),materialCopies=new Map();
  const ownMaterial=material=>{
    if(!material)return material;
    if(materialCopies.has(material))return materialCopies.get(material);
    const copy=material.clone();
    copy.onBeforeCompile=material.onBeforeCompile;
    copy.customProgramCacheKey=material.customProgramCacheKey;
    copy.userData=material.userData;
    if(material.isShaderMaterial)copy.uniforms=material.uniforms;
    materialCopies.set(material,copy);
    patchSourceMaterial(copy,sourceFromWorld,worldFromSource,sourceEye,seenMaterials,ATMO,ATMO_GLSL);
    return copy;
  };
  const engine={
    scene:staging,renderer:ctx.renderer,camera:sourceCamera,width:512,height:384,time:0,
    crownfallProfile:ctx.profile,
    quality:{name:'preview',spp:1,msaa:0,detail:quest?.16:.4,density:quest?.07:.18,terrainRes:quest?.2:.4,cloudSteps:quest?8:12},
    params:new URLSearchParams('shot=3&floraDbg=noheroes'),
    footprints:new Footprints(),slots:{banner:[],brazier:[],statue:[],ivy:[],urn:[],planter:[],lamp:[]},registry:{},stats:{},moduleRoots,
    rng:label=>new RNG(String(label)),onUpdate:fn=>updates.push(fn),onShot:fn=>shotHooks.push(fn),
    add(object,{castShadow=true,receiveShadow=true}={}){object.traverse(o=>{if(o.isMesh){o.castShadow=o.userData.castShadow??castShadow;o.receiveShadow=o.userData.receiveShadow??receiveShadow;}});staging.add(object);return object;},
    patchMaterial(material){ownMaterial(material);},
    crownfallMaterial:ownMaterial,
    ownResource(resource){if(resource)resources.add(resource);return resource;},
    onDispose(release){if(release)releasers.add(release);},
  };
  const dispose=()=>{
    if(disposed)return;disposed=true;
    releaseOwnedWorld({root,staging,initialChildren,materials:materialCopies.values(),resources,releasers});
    updates.length=0;shotHooks.length=0;resources.clear();releasers.clear();materialCopies.clear();engine.registry={};
  };
  const modules=[['terrain',terrain],['water',water],['temple',temple],['acropolis',acropolis],['aqueducts',aqueducts],['city',city],['vegetation',vegetation],['waterfalls',waterfalls],['birds',birds]];
  try {
    for(const [name,build] of modules){
      ctx.onProgress?.(`Building citadel ${name}`);
      const before=new Set(staging.children);
      try {await build(engine);} catch(error){throw new Error(`Athenaion ${name}: ${error?.message??error}`,{cause:error});}
      moduleRoots[name]=staging.children.filter(o=>!before.has(o));
      for(const group of moduleRoots[name])group.traverse(object=>{
        if(object.isMesh&&object.geometry&&!object.material?.isShaderMaterial)object.geometry=compactGeometry(object.geometry,object.name);
      });
      // After compaction, whose cluster size follows each piece's own span. The desktop camera can
      // close in on one landmark, so it keeps coarse spatial groups for culling: at the banner hall
      // 2.38M triangles in view, against 2.67M with none and 2.47M from the source's fine chunks.
      if(MERGED_MODULES.has(name))mergeStaticMeshes(THREE,moduleRoots[name],{ignoreShadows:quest,bakeTransforms:BAKED_MODULES.has(name),cell:quest?Infinity:384});
      await yieldBuild();
    }
    // Recast the three source deity pedestals as neutral chess-king monuments.
    const monuments=new THREE.Group();monuments.name='Crownfall_Chess_Monuments';
    const stone=new THREE.MeshStandardMaterial({color:'#c9bea1',roughness:.76});
    for(const spec of L.COLOSSI){
      const[x,y,z]=spec.pos;
      const h=spec.height, profile=[[.34,0],[.38,.06],[.27,.12],[.20,.16],[.12,.45],[.20,.55],[.16,.64],[.21,.68],[.23,.82],[.17,.88],[.16,.96]].map(([r,y])=>new THREE.Vector2(r*h,y*h));
      const pedestal=new THREE.Mesh(new THREE.BoxGeometry(h*.8,spec.pedestal,h*.7).translate(x,y+spec.pedestal/2,z),stone);
      const king=new THREE.Mesh(new THREE.LatheGeometry(profile,quest?12:24).translate(x,y+spec.pedestal,z),stone);
      const crown=new THREE.Mesh(new THREE.CylinderGeometry(h*.18,h*.15,h*.10,8,1,true).translate(x,y+spec.pedestal+h*.97,z),stone);
      monuments.add(pedestal,king,crown);
    }
    mergeStaticMeshes(THREE,[monuments],{ignoreShadows:quest});
    staging.add(monuments);
    // Source sky deliberately bypasses model transforms; use original camera
    // position for cloud altitude while retaining the actual XR viewing rotation.
    SKY.uCloudSteps.value=quest?8:12;SKY.uFrame.value=0;
    if(ctx.renderer)engine.onDispose(await ensureCloudTextures(ctx.renderer,ctx.profile,true));
    const sky=createSky();
    // Each asset retains its own texture wrappers while a replacement is building.
    sky.material.uniforms=Object.fromEntries(Object.entries(sky.material.uniforms).map(([name,uniform])=>[name,{...uniform}]));
    staging.add(sky);
    for(const child of [...staging.children]){if(!initialChildren.has(child)&&child!==ctx.camera&&!child.isCamera)root.add(child);}
    root.traverse(object=>{
      if(object.material)object.material=Array.isArray(object.material)?object.material.map(ownMaterial):ownMaterial(object.material);
      if(object.customDepthMaterial)object.customDepthMaterial=ownMaterial(object.customDepthMaterial);
    });
    // Planar reflection would require an extra full scene render per eye and
    // source-space camera treatment. Preserve analytic reflection/glint on both
    // platforms; the source water's depth/foam/waves remain.
    const reflection=engine.registry.water?.reflection;
    if(reflection){reflection.enabled=false;reflection.uniforms.uReflOn.value=0;}
    for(const variant of engine.registry.vegetation?.variants??[])for(const key of Object.keys(variant.materials))variant.materials[key]=ownMaterial(variant.materials[key]);
    if(quest&&engine.registry.vegetation)engine.registry.vegetation.forceLod=3;
    engine.registry.vegetation?.update(sourceCamera);
    const landmarks=[{id:'banner-hall',position:[20,72,-29]},{id:'muster-grounds',position:[24,55,-7]},{id:'war-record',position:[-14,15,128]},{id:'heralds-station',position:[24,8,104]}];
    ctx.onProgress?.('Validating citadel walking areas');
    const clearAt=createSourceClearance(THREE,root,landmarks,MeshBVH);
    const exploration=createTerrainHubs({groundAt:heightAt,dryAt:(x,z)=>heightAt(x,z)>1,clearAt:(x,y,z)=>engine.footprints.isFree(x,z,.48,['stair','road','path'])&&clearAt(x,y,z),cameraColliders:clearAt.colliders,landmarks});
    return {
      root,exploration,
      view:{position:[210,125,320],target:[12,43,-24],fov:44},
      landmarks:[{id:'banner-hall',position:[20,72,-29]},{id:'muster-grounds',position:[24,55,-7]},{id:'war-record',position:[-14,15,128]},{id:'heralds-station',position:[24,8,104]}],
      extent:{center:[15,25,20],width:580,depth:620,height:155},
      lighting:{sunDirection:[-.7,.35,.6],sunColor:'#ffdcaf',skyColor:'#b6c8ce',groundColor:'#4e5548',exposure:.75},
      source:{repository:'https://github.com/Leonxlnx/athenaion',commit:'9b8bd23b39c458a50fb1201037360047781c45b5',modules:modules.map(([name])=>name),religiousStatues:'Recast as Crownfall chess-king monuments',planarReflection:false},
      setSourceTransform(inverseRootMatrix,sourceCameraPosition){
        if(disposed)return;
        sourceFromWorld.value.copy(inverseRootMatrix);worldFromSource.value.copy(inverseRootMatrix).invert();
        if(sourceCameraPosition){sourceEye.value.copy(sourceCameraPosition);sourceCamera.position.copy(sourceCameraPosition);sourceCamera.lookAt(new THREE.Vector3(12,43,-24));sourceCamera.updateMatrixWorld(true);engine.registry.vegetation?.maybeUpdate(sourceCamera);}
      },
      update(time,delta){if(disposed)return;engine.time=time;ATMO.uAtmoTime.value=time;SKY.uSkyTime.value=time;SKY.uFrame.value++;for(const fn of updates)fn(time,delta);},
      dispose,
    };
  } catch(error) {
    dispose();
    throw error;
  }
}

/** Crownfall integration of the actual Monolith Wilds world (MIT).
 * Upstream 02dbcd3e790c21861dfecb47f4d9e23cccee35ec; see LICENSE/PROVENANCE.md.
 * No upstream UI, camera controller, audio or render loop is loaded. */
import * as THREE from 'crownfall-world-three';
import { createTerrainHubs, createSourceClearance } from '../exploration';
import { MeshBVH } from 'crownfall-world-bvh';
import * as layout from './src/core/layout.js';
import * as noise from './src/core/noise.js';
import { heightAt,normalAt,slopeAt,surfaceAt,canyonDistance,cliffLineZ } from './src/core/terrain-height.js';
import { atmo,atmosphereUniforms,fogUniforms } from './src/core/atmosphere.js';
import { createMaterialLibrary } from './src/core/materials.js';
import { createEnvironment } from './src/core/environment.js';
import { createSourceTransform } from './source-transform.js';
import { applySourceLod } from './source-lod.js';
import { disposeGeneratedWorld } from './dispose-world.js';
import { yieldToMain as yieldMain } from './src/core/yield.js';

const WORLDS=[['sky',()=>import('./src/world/sky.js')],['terrain',()=>import('./src/world/terrain.js')],['water',()=>import('./src/world/water.js')],['rocks',()=>import('./src/world/rocks.js')],['vegetation',()=>import('./src/world/vegetation.js')],['ruins',()=>import('./src/world/ruins.js')],['life',()=>import('./src/world/life.js')]];
const MONUMENTS={loom:()=>import('./src/landmarks/loom.js'),wardens:()=>import('./src/landmarks/wardens.js'),observatory:()=>import('./src/landmarks/observatory.js'),stair:()=>import('./src/landmarks/stair.js'),choir:()=>import('./src/landmarks/choir.js'),needles:()=>import('./src/landmarks/needles.js'),span:()=>import('./src/landmarks/span.js'),temple:()=>import('./src/landmarks/temple.js'),orrery:()=>import('./src/landmarks/orrery.js'),monastery:()=>import('./src/landmarks/monastery.js'),isles:()=>import('./src/landmarks/isles.js')};

export async function buildWorld(input){
  if(THREE.Object3D!==input.THREE.Object3D)throw Error('Monolith Wilds Three namespace mismatch');
  const quest=input.profile==='quest',root=input.scene;
  root.name='Crownfall / Monolith Wilds';
  root.fog=new THREE.FogExp2('#9897a0',.00025);
  const view={position:[layout.SPAWN.position[0],heightAt(layout.SPAWN.position[0],layout.SPAWN.position[2])+layout.SPAWN.heightAboveGround,layout.SPAWN.position[2]],target:[...layout.SPAWN.lookAt],fov:55};
  // Analysis-only camera: never changes the renderer's camera or the XR viewer.
  const camera=input.camera.clone();camera.position.set(...view.position);camera.near=1;camera.far=20000;camera.fov=view.fov;camera.updateProjectionMatrix?.();camera.lookAt(...view.target);camera.updateMatrixWorld(true);
  const updates=[],disposers=[],handlers=new Map();
  const quality={level:'low',pixelRatio:1,shadows:false,shadowSize:1024,shadowExtent:650,vegetation:quest?.12:.35,terrainDetail:quest?.3:.5,drawDistance:16000,bloom:false,ssao:false,godrays:false,reflections:false};
  const ctx={THREE,renderer:input.renderer,scene:root,camera,canvas:input.renderer.domElement,quality,profile:input.profile,params:{q:'low',hour:17.6,cam:view.position,look:view.target,modules:null,skip:[],shot:false,debug:false},layout,noise,heightAt,normalAt,slopeAt,surfaceAt,canyonDistance,cliffLineZ,atmo,atmosphereUniforms,fogUniforms,materials:createMaterialLibrary(),landmarks:[],camState:{mode:'fixed'},onUpdate(fn,order=0){const record={fn,order};updates.push(record);return()=>{const i=updates.indexOf(record);if(i>=0)updates.splice(i,1);};},onResize(){},onDispose(fn){disposers.push(fn);},events:{on(name,fn){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(fn);},emit(name,payload){for(const fn of handlers.get(name)||[])fn(payload);}}};
  ctx.env=createEnvironment(ctx);
  const jobs=[...WORLDS.map(([id,loader])=>({id,loader})),...layout.LANDMARKS.map(site=>({id:`landmark:${site.id}`,loader:MONUMENTS[site.id],site}))];
  const built=[];let disposed=false,lodReport,setSourceTransform;
  const cleanup=()=>{if(disposed)return;disposed=true;updates.length=0;for(const dispose of disposers.splice(0)){try{dispose();}catch{}}disposeGeneratedWorld(root,ctx);};
  try{
    for(let i=0;i<jobs.length;i++){
      const job=jobs[i];input.onProgress?.(i/jobs.length,job.id);await yieldMain();
      const mod=await job.loader();const result=await mod.build(ctx,job.site);
      if(!result&&job.site)throw Error(`${job.id} returned no world geometry`);
      if(result?.update)updates.push({fn:result.update,order:result.order??0});
      if(result?.dispose)disposers.push(()=>result.dispose());
      if(job.site)ctx.landmarks.push({site:job.site,object:result.object??null,viewpoints:result.viewpoints??[]});
      built.push(job.id);
    }
    lodReport=await applySourceLod(root,input.profile);
  updates.sort((a,b)=>a.order-b.order);
  setSourceTransform=createSourceTransform(root,camera);
  setSourceTransform(new THREE.Matrix4(),camera.position);
  // The ready event performs contact-foam renders. Every source material must
  // already have its local atmosphere declarations before that first draw.
  ctx.events.emit('ready');
    input.onProgress?.(1,'ready');
  }catch(error){cleanup();throw error;}
  const anchor=(id,siteId,dy=4)=>{const s=layout.LANDMARK_BY_ID[siteId];return{id,position:[s.x,heightAt(s.x,s.z)+dy,s.z]};};
  const landmarks=[anchor('banner-hall','observatory',50),anchor('muster-grounds','wardens',12),anchor('war-record','monastery',80),anchor('heralds-station','temple',20)];
  input.onProgress?.('Validating wilds walking areas');
  const clearAt=createSourceClearance(THREE,root,landmarks,MeshBVH);
  const exploration=createTerrainHubs({groundAt:heightAt,dryAt:(x,z)=>heightAt(x,z)>1,clearAt,cameraColliders:clearAt.colliders,landmarks});
  return{root,view,landmarks,exploration,extent:{center:[0,250,0],width:5200,depth:5200,height:1800},fullExtent:{center:[0,250,0],width:9200,depth:9200,height:2400},lighting:{sunDirection:ctx.env.sunDir.toArray(),sunColor:'#ffb56e',skyColor:'#9aaccc',groundColor:'#5e4c3a',exposure:ctx.env.palette.exposure},setSourceTransform,builtModules:built,
    lodReport,sourceStats(){
      const terrain=ctx.terrain?.stats?.()??{};let meshes=0,instanced=0,triangles=terrain.tris??0,drawables=0;const byPart={},byMesh={};
      root.traverse(o=>{if(!o.isMesh)return;meshes++;if(o.isBatchedMesh&&o.name.startsWith('terrain-'))return;const g=o.geometry,count=o.isBatchedMesh?o.instanceCount:o.isInstancedMesh?o.count:g.isInstancedBufferGeometry?g.instanceCount:1;if(!Number.isFinite(count))throw Error(`Unbounded instance count for ${o.name}`);const t=o.isBatchedMesh?batchedTriangles(o):(g.index?g.index.count:g.attributes.position.count)/3*count;triangles+=t;instanced+=count>1?count:0;drawables+=Array.isArray(o.material)?o.material.length:1;const key=(o.name||'unnamed').split(':')[0];byPart[key]=(byPart[key]||0)+t;byMesh[o.name||'unnamed']=(byMesh[o.name||'unnamed']||0)+t;});
      return{triangles,meshes,instances:instanced,potentialDrawCalls:drawables+2,terrain,trianglesByPart:byPart,trianglesByMesh:byMesh};
    },
    update(time,delta){if(disposed)return;if(!quest){camera.copy(input.camera);camera.updateMatrixWorld(true);}atmo.time.x=time;for(const u of updates)u.fn(delta,time);ctx.env.update(delta,camera);},
    dispose:cleanup,
  };
}

/** The orrery's parts share one batch per material. Terrain's batches report through ctx.terrain.stats(). */
const batchedTriangles=o=>{let t=0;for(let i=0;i<o.instanceCount;i++)if(o.getVisibleAt(i))t+=o.getGeometryRangeAt(o.getGeometryIdAt(i)).count/3;return t;};

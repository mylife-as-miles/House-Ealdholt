import {createWorldResourceRetirementFence} from './world-resource-retirement';
import {Box3,Frustum, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, PlaneGeometry, Quaternion, Vector2, Vector3,
 type Camera,type Object3D,type Scene,type WebGLRenderer} from 'three';
import type {NormalizedScannedShrubSource} from './scanned-shrub-source';
import {createVegetationCellHlod,type VegetationCellHlod} from './vegetation-cell-hlod';
import {createVegetationPrototypeResources,type PreparedVegetationAtlas} from './vegetation-prototype';
import type {VegetationPreparationWorker} from './vegetation-worker';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {RegionalWorldLayout} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
import {SCANNED_SHRUB_COHORT_VERSION,SCANNED_SHRUB_COHORT_LIMIT,scannedShrubDerivativeBudget,scannedShrubDetailLimit,scannedShrubSourceContract} from '../../../../shared/legacy/aethelgard/environment/scanned-shrub-policy';
import {patchVegetationFade,patchVegetationImpostor} from '../../../../shared/legacy/aethelgard/environment/vegetation-shaders';
import {worldHazeDistance,type WorldEnvironmentState} from '../../../../shared/legacy/aethelgard/environment/world-environment-state';

type NearTree={group:Group;level:VegetationCellHlod;meshes:InstancedMesh[];coverage:number;last:number};
type FarTree={mesh:InstancedMesh;material:MeshStandardMaterial;geometry:PlaneGeometry;ranges:InstancedBufferAttribute;atlas:PreparedVegetationAtlas};

/** A small visual lease over existing regional actor IDs. Terrain, navigation,
 * source art and population state have no ownership dependency on this owner.
 * The original bramble remains the fallback until both scanned-source
 * captures are ready; the selected cohort never changes source while moving. */
export function createScannedRegionalShrubs(options:{source:NormalizedScannedShrubSource;sourceRoot:Object3D;renderer:WebGLRenderer;
 scene:Scene;camera:Camera;queue:WorldPreparationQueue;worker:VegetationPreparationWorker;signal:AbortSignal;
 native?:boolean;conditions?:()=>WorldEnvironmentState|null;retirementFence?:()=>Promise<void>;changed():void},prepareResources=createVegetationPrototypeResources){
 const object=new Group();object.name='Ealdholt bounded scanned soft undergrowth';object.userData.iwsdkPreviewBounds='exclude';object.userData.crownfallRegionalShrub={softFoliage:true,nonSolid:true,navigationAuthority:false};
 const gpuRetirement=createWorldResourceRetirementFence(options.renderer,options.queue),retirementFence=options.retirementFence??gpuRetirement;
 const source=options.source,controller=new AbortController(),signal=controller.signal;
 const resources=prepareResources(options.renderer,options.queue,options.worker,scannedShrubDerivativeBudget(options.native),
  {worldRegion:SCANNED_SHRUB_COHORT_VERSION+':'+source.family,sourceSha256:source.sourceSha256,backend:options.native?'iwsdk-r185-webgl2-soft-shrub-v1':'three-r185-webgl2-soft-shrub-v1'});
 const stats={sourceTextureBytes:source.textureBytes,sourceGeometryBytes:source.geometryBytes,softFoliage:true,navigationAuthority:false,gpuRetirement:gpuRetirement.stats,status:'unavailable' as 'unavailable'|'preparing'|'ready'|'fallback'|'disposed',sourceFamily:source.family,sourceSha256:source.sourceSha256,
  cohortVersion:SCANNED_SHRUB_COHORT_VERSION,eligible:0,examined:0,rejectedRoots:0,detailed:0,preparing:0,retiring:0,visible:0,far:0,canopies:0,error:'',
  levels:[0,0,0,0],detailLimit:scannedShrubDetailLimit(options.native),maximumSourceTriangles:scannedShrubDetailLimit(options.native)*source.triangles,maximumTransitionTriangles:2*scannedShrubDetailLimit(options.native)*source.triangles,memoryBudgetBytes:scannedShrubDerivativeBudget(options.native),sourceTrianglesPerShrub:source.triangles};
 const candidates:{id:number;distance:number}[]=[],candidateRows=new Map<number,{id:number;distance:number}>(),wanted=new Set<number>();
 const retirements=new Set<Promise<void>>();
 const ids=new Set<number>(),failed=new Set<number>(),near=new Map<number,NearTree>(),leases:{release():void}[]=[];
 let disposed=false,began=false,layout:RegionalWorldLayout|null=null,far:FarTree|null=null,canopy:FarTree|null=null,preparation:Promise<void>|null=null;
 const point=new Vector3(),position=new Vector3(),scale=new Vector3(),up=new Vector3(0,1,0),rotation=new Quaternion(),matrix=new Matrix4(),inverse=new Matrix4(),box=new Box3(),viewProjection=new Matrix4(),frustum=new Frustum();
 const actor=(id:number,normalised=true)=>{const p=layout!.placements,at=id*6;matrix.compose(position.set(p[at],p[at+1],p[at+2]),rotation.setFromAxisAngle(up,p[at+3]),scale.setScalar(p[at+4]));return normalised?matrix.multiply(source.normalization):matrix;};
 function retire(id:number){const tree=near.get(id);if(!tree)return;near.delete(id);tree.group.removeFromParent();const presented=tree.level.stats.readyMask===15;if(!presented)tree.level.dispose();
  // The wrapper's GPU instance buffers are ours; source PBR and vertex buffers
  // are borrowed. A pending compilation cannot observe disposed wrappers.
  const retirement=Promise.all([tree.level.preparation,retirementFence()]).then(()=>{if(presented)tree.level.dispose();for(const mesh of tree.meshes)mesh.dispose();tree.group.clear();}).finally(()=>{retirements.delete(retirement);stats.retiring=retirements.size;if(!disposed)options.changed();});retirements.add(retirement);stats.retiring=retirements.size;
 }
 function makeFar(atlas:PreparedVegetationAtlas,top:boolean):FarTree{
  const record=atlas.record,eye={value:new Vector3()},sourceInverse=new Matrix4(),elevated={value:1},centre={value:new Vector3(...(top&&far?far.atlas.record.centre:record.centre))};
  const foliage=source.parts.find(part=>part.foliage)!.material;
  const material=new MeshStandardMaterial({name:'Scanned Shrub02b relit '+(top?'crown':'full shrub'),map:atlas.maps[0],roughness:foliage.roughness,
   metalness:foliage.metalness,envMap:foliage.envMap,envMapIntensity:foliage.envMapIntensity,alphaTest:82/255,side:2,fog:false});
  const haze={value:options.scene.fog?.color??new Vector3(.57,.64,.67)},metric={value:1},length={value:18000};
  material.onBeforeCompile=shader=>{
   Object.assign(shader.uniforms,{crownfallSourceEye:eye,crownfallElevatedEnabled:elevated,crownfallElevationCentre:centre,
    crownfallAtlasNormalMap:{value:atlas.maps[1]},crownfallAtlasCentre:{value:new Vector3(...record.centre)},crownfallAtlasExtent:{value:new Vector2(...record.extent)},
    crownfallAtlasViews:{value:record.views},crownfallAtlasGrid:{value:new Vector2(record.columns,record.rows)},crownfallAtlasPixels:{value:new Vector2(record.mips[0].width,record.mips[0].height)},crownfallAtlasMaximumMip:{value:Math.max(0,Math.log2(record.tileSize)-2)},cfAuthoredHaze:haze,cfAuthoredMetric:metric,cfAuthoredHazeLength:length});
   patchVegetationImpostor(shader,true,{canopy:top,coverage:true});patchVegetationFade(shader);
   shader.fragmentShader='uniform vec3 cfAuthoredHaze; uniform float cfAuthoredMetric; uniform float cfAuthoredHazeLength;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <tonemapping_fragment>','float authoredHaze=clamp(1.-exp(-length(vViewPosition)*cfAuthoredMetric/cfAuthoredHazeLength),0.,.72); gl_FragColor.rgb=mix(gl_FragColor.rgb,cfAuthoredHaze,authoredHaze);\n#include <tonemapping_fragment>');
  };
  material.customProgramCacheKey=()=>':scanned-shrub02b-relit-elevation-haze-v1:'+top;
  const geometry=new PlaneGeometry(1,1),ranges=new InstancedBufferAttribute(new Float32Array(ids.size*2),2);geometry.setAttribute('crownfallLodRange',ranges);
  const mesh=new InstancedMesh(geometry,material,ids.size);mesh.count=0;mesh.frustumCulled=false;mesh.raycast=()=>{};mesh.receiveShadow=true;
  const normalScale=source.normalization.elements[5],base=source.originalBaseY;
  mesh.userData.crownfallVegetationWind={root:[0,base,0],tip:[0,base+source.height/normalScale,0],grass:false};
  mesh.onBeforeRender=(_renderer,_scene,camera)=>{length.value=worldHazeDistance(options.conditions?.()??null);metric.value=1/Math.max(1e-7,options.sourceRoot.matrixWorld.getMaxScaleOnAxis());camera.getWorldPosition(eye.value).applyMatrix4(sourceInverse.copy(mesh.matrixWorld).invert());};
  object.add(mesh);return{mesh,material,geometry,ranges,atlas};
 }
 function makeNear(id:number,now:number){
  const group=new Group();group.name='Scanned regional shrub '+id;group.matrixAutoUpdate=false;group.matrix.copy(actor(id));group.visible=false;object.add(group);
  const meshes:InstancedMesh[]=[];
  try{for(const part of source.parts){const mesh=new InstancedMesh(part.geometry,part.material,1);mesh.userData.crownfallVegetationActorWind={root:[0,source.originalBaseY,0],tip:[0,source.originalBaseY+source.height,0],grass:false};mesh.setMatrixAt(0,part.frame);mesh.instanceMatrix.needsUpdate=true;mesh.castShadow=false;mesh.receiveShadow=true;mesh.raycast=()=>{};group.add(mesh);meshes.push(mesh);}
   const level=createVegetationCellHlod(group,{renderer:options.renderer,scene:options.scene,camera:options.camera,resources,signal,changed:options.changed,native:options.native,solidOverhead:true,tileSize:64,sourceRoot:options.sourceRoot,retirementFence,captureInCellFrame:true,detailScale:Math.min(1,source.height/18)});
   level.setCoverage(0);near.set(id,{group,level,meshes,coverage:0,last:now});
  }catch(cause){group.removeFromParent();for(const mesh of meshes)mesh.dispose();failed.add(id);stats.error=String(cause);}
 }
 async function prepare(value:RegionalWorldLayout){
  if(disposed||began)return preparation;began=true;layout=value;const cohort=value.scannedShrubs;
  if(!cohort||cohort.version!==SCANNED_SHRUB_COHORT_VERSION||cohort.sourceSha256!==source.sourceSha256||cohort.sourceContract!==scannedShrubSourceContract(source)||!cohort.ids.length||cohort.ids.length>SCANNED_SHRUB_COHORT_LIMIT||new Set(cohort.ids).size!==cohort.ids.length||cohort.ids.some(id=>id>=value.placements.length/6||value.placements[id*6+5]!==source.variant)){stats.status='fallback';stats.error='Missing, stale or empty measured soft-shrub cohort; retain original bramble.';options.changed();return;}
  for(const id of cohort.ids){ids.add(id);candidateRows.set(id,{id,distance:0});}stats.eligible=ids.size;stats.examined=cohort.examined;stats.rejectedRoots=cohort.rejectedRoot;stats.status='preparing';
  preparation=(async()=>{try{
    const fullLease=resources.atlas(source.parts,64,8,false);leases.push(fullLease);const full=await fullLease.ready;signal.throwIfAborted();far=makeFar(full,false);
    const crownLease=resources.atlas(source.parts,64,8,true,true);leases.push(crownLease);const crown=await crownLease.ready;signal.throwIfAborted();canopy=makeFar(crown,true);
    const compiled=resources.compile('scanned-shrub02b-global-captures-v1',[far.mesh,canopy.mesh],options.camera,options.scene);leases.push(compiled);await compiled.ready;signal.throwIfAborted();stats.status='ready';options.changed();
   }catch(cause){if(disposed||signal.aborted)return;ids.clear();if(far)far.mesh.visible=false;if(canopy)canopy.mesh.visible=false;stats.status='fallback';stats.error=String(cause);options.changed();}
  })();return preparation;
 }
 function dispose(){if(disposed)return;disposed=true;controller.abort();options.signal.removeEventListener('abort',dispose);for(const id of near.keys())retire(id);object.removeFromParent();for(const lease of leases)lease.release();
  void Promise.all(retirements).then(()=>retirementFence()).then(()=>{for(const draw of [far,canopy])if(draw){draw.mesh.dispose();draw.geometry.dispose();draw.material.dispose();}resources.dispose();object.clear();});stats.status='disposed';
 }
 options.signal.addEventListener('abort',dispose,{once:true});if(options.signal.aborted)dispose();
 return{object,stats,resources:resources.stats,prepare,owns(id:number){return stats.status==='ready'&&ids.has(id);},
  update(camera:Camera,now:number,quality:'low'|'medium'|'high',reducedMotion:boolean,visibleIds:ReadonlySet<number>){
   if(disposed||stats.status!=='ready'||!layout||!far||!canopy)return false;
   options.sourceRoot.updateWorldMatrix(true,false);point.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse.copy(options.sourceRoot.matrixWorld).invert());viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(options.sourceRoot.matrixWorld);frustum.setFromProjectionMatrix(viewProjection);
   candidates.length=0;for(const id of ids){if(!visibleIds.has(id))continue;box.copy(source.bounds).applyMatrix4(actor(id,false)).expandByScalar(source.windReach*layout.placements[id*6+4]);if(!frustum.intersectsBox(box))continue;const distance=box.distanceToPoint(point);if(distance<(options.native?70:100)&&!failed.has(id)){const row=candidateRows.get(id)!;row.distance=distance;candidates.push(row);}}
   candidates.sort((a,b)=>a.distance-b.distance||a.id-b.id);wanted.clear();for(let i=0;i<Math.min(candidates.length,stats.detailLimit);i++)wanted.add(candidates[i].id);let transition=false;
   for(const [id,tree]of near){const ready=tree.level.stats.readyMask===15,desired=wanted.has(id)&&ready;
    if(tree.level.stats.status==='error'){failed.add(id);stats.error=tree.level.stats.error;retire(id);continue;}
    const delta=Math.min(250,Math.max(0,now-tree.last));tree.last=now;const target=desired?1:0;
    tree.coverage=reducedMotion?target:Math.max(0,Math.min(1,tree.coverage+(target?1:-1)*delta/250));
    tree.group.visible=ready&&tree.coverage>0;tree.level.setCoverage(tree.coverage);if(tree.group.visible)transition=tree.level.update(now,camera,quality,reducedMotion)||transition;
    if(tree.coverage!==target)transition=true;if(!wanted.has(id)&&tree.coverage===0)retire(id);
   }
   let preparing=0;for(const tree of near.values())if(tree.level.stats.readyMask!==15)preparing++;
   if(near.size+retirements.size<stats.detailLimit&&preparing<2){const next=candidates.find(row=>wanted.has(row.id)&&!near.has(row.id));if(next){makeNear(next.id,now);options.changed();}}
   stats.detailed=stats.preparing=0;for(const tree of near.values()){if(tree.group.visible)stats.detailed++;if(tree.level.stats.readyMask!==15)stats.preparing++;}
   far.mesh.count=canopy.mesh.count=0;stats.visible=0;
   for(const id of ids){if(!visibleIds.has(id))continue;box.copy(source.bounds).applyMatrix4(actor(id,false)).expandByScalar(source.windReach*layout.placements[id*6+4]);if(!frustum.intersectsBox(box))continue;const coverage=near.get(id)?.coverage??0;stats.visible++;if(coverage>=1)continue;
    const at=far.mesh.count++;far.mesh.setMatrixAt(at,actor(id));far.ranges.setXY(at,coverage,1);
    // The elevation shader performs the complementary full/crown handoff.
    canopy.mesh.setMatrixAt(canopy.mesh.count, matrix);canopy.ranges.setXY(canopy.mesh.count++,coverage,1);
   }
   for(const draw of [far,canopy]){draw.mesh.visible=draw.mesh.count>0;if(draw.mesh.count){draw.mesh.instanceMatrix.needsUpdate=true;draw.ranges.needsUpdate=true;}}
   stats.levels.fill(0);for(const tree of near.values())if(tree.group.visible)for(let level=0;level<4;level++)stats.levels[level]+=tree.level.stats.levels[level];stats.levels[3]+=far.mesh.count;
   stats.far=far.mesh.count;stats.canopies=canopy.mesh.count;return transition;
  },dispose};
}
export type ScannedRegionalShrubs=ReturnType<typeof createScannedRegionalShrubs>;

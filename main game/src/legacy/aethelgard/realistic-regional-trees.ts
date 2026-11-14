import {createWorldOwnerRetirement,type WorldOwnerRetirement,type WorldOwnerQuiescence} from '../../../../shared/legacy/aethelgard/environment/world-owner-retirement';
import {scopeOwnedVegetationResources} from './owned-vegetation-resources';
import {FOREST01_DENSITY_WALKING} from '../../../../shared/legacy/aethelgard/environment/forest01-density-walking-data';
import {FOREST01_DENSITY_LOD,matchesForest01DensityNormalization} from '../../../../shared/legacy/aethelgard/environment/forest01-density-lod';
import type {RealisticTreeDetailRole,RealisticTreeBudgetLease} from '../../../../shared/legacy/aethelgard/environment/realistic-tree-budget';
import {createWorldResourceRetirementFence} from './world-resource-retirement';
import {Box3, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, PlaneGeometry, Quaternion, Vector2, Vector3,
 type Camera,type Object3D,type Scene,type WebGLRenderer} from 'three';
import {REALISTIC_FOREST01_FAMILY,type NormalizedRealisticTreeSource} from './realistic-tree-source';
import {createVegetationCellHlod,type VegetationCellHlod} from './vegetation-cell-hlod';
import {createVegetationPrototypeResources,type PreparedVegetationAtlas,type VegetationPrototypeResources} from './vegetation-prototype';
import type {VegetationPreparationWorker} from './vegetation-worker';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {RegionalWorldLayout} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
import {REALISTIC_TREE_COHORT_VERSION,REALISTIC_TREE_COHORT_LIMIT} from '../../../../shared/legacy/aethelgard/environment/realistic-tree-cohort';
import {REALISTIC_TREE_WALKING_VERSION} from '../../../../shared/legacy/aethelgard/environment/realistic-tree-walking';
import {patchVegetationFade,patchVegetationImpostor} from '../../../../shared/legacy/aethelgard/environment/vegetation-shaders';
import {worldHazeDistance,type WorldEnvironmentState} from '../../../../shared/legacy/aethelgard/environment/world-environment-state';

export const realisticTreeMemoryBudget=(native=false)=> (native?8:16)*1024**2;
export const realisticTreeDetailLimit=(native=false)=>native?3:8;
type NearTree={owner:WorldOwnerRetirement|null;reservation:ReturnType<VegetationPrototypeResources['ownerBuffers']>|null;role:RealisticTreeDetailRole;group:Group;level:VegetationCellHlod;meshes:InstancedMesh[];coverage:number;last:number;budget:RealisticTreeBudgetLease|null};
type FarTree={mesh:InstancedMesh;material:MeshStandardMaterial;geometry:PlaneGeometry;ranges:InstancedBufferAttribute;atlas:PreparedVegetationAtlas};

/** A small visual lease over existing regional actor IDs. Terrain, navigation,
 * source art and population state have no ownership dependency on this owner.
 * The original regional source remains the fallback until both authored-source
 * captures are ready; the selected cohort never changes source while moving. */
export function createRealisticRegionalTrees(options:{source:NormalizedRealisticTreeSource;sourceRoot:Object3D;renderer:WebGLRenderer;
 scene:Scene;camera:Camera;queue:WorldPreparationQueue;worker:VegetationPreparationWorker;signal:AbortSignal;
 native?:boolean;ownedNearResources?:VegetationPrototypeResources;ownerRetirementFence?:(proof:WorldOwnerQuiescence)=>Promise<void>;detailLimit?:()=>number;detailBudget?:{acquire(id:number,role?:RealisticTreeDetailRole):RealisticTreeBudgetLease|null};densityRole?:{primaryReady():boolean;canPrepare():boolean};cohortKey?:'realisticTrees'|'realisticForest01Trees';conditions?:()=>WorldEnvironmentState|null;retirementFence?:()=>Promise<void>;changed():void},prepareResources=createVegetationPrototypeResources){
 const object=new Group();object.name='Ealdholt bounded authored near woodland';object.userData.iwsdkPreviewBounds='exclude';
 const gpuRetirement=createWorldResourceRetirementFence(options.renderer,options.queue),retirementFence=options.retirementFence??gpuRetirement;
 const source=options.source,controller=new AbortController(),signal=controller.signal;
 const resources=prepareResources(options.renderer,options.queue,options.worker,realisticTreeMemoryBudget(options.native),
  {worldRegion:REALISTIC_TREE_COHORT_VERSION+':'+source.family,sourceSha256:source.sourceSha256,backend:options.native?'iwsdk-r185-webgl2-complete-tree-v1':'three-r185-webgl2-complete-tree-v1'});
 const stats={gpuRetirement:gpuRetirement.stats,status:'unavailable' as 'unavailable'|'preparing'|'ready'|'fallback'|'disposed',sourceFamily:source.family,sourceSha256:source.sourceSha256,
  cohortVersion:REALISTIC_TREE_COHORT_VERSION,eligible:0,examined:0,rejectedRoots:0,rejectedWalking:0,heldWalkingUncertain:0,walkingGuardVersion:'',detailed:0,preparing:0,retiring:0,visible:0,far:0,canopies:0,error:'',
  ownerLifetime:{active:0,draining:0,fencing:0,releasing:0,retired:0,held:0,pendingReady:0,acquired:0},
  fullActorIds:[]as number[],densityActorIds:[]as number[],densityEligible:0,densityFailures:0,densityError:'',densityProofSha256:'',densityProfileVersion:options.densityRole&&!options.native?FOREST01_DENSITY_LOD.version:'',densityAllowedReadyMask:options.densityRole&&!options.native?14:0,densityRequiredReadyMask:options.densityRole&&!options.native?14:0,primarySettled:false,
  levels:[0,0,0,0],detailLimit:options.detailLimit?.()??realisticTreeDetailLimit(options.native),maximumSourceTriangles:(options.detailLimit?.()??realisticTreeDetailLimit(options.native))*source.triangles,maximumTransitionTriangles:2*(options.detailLimit?.()??realisticTreeDetailLimit(options.native))*source.triangles,memoryBudgetBytes:realisticTreeMemoryBudget(options.native),sourceTrianglesPerTree:source.triangles};
 const candidates:{id:number;distance:number}[]=[],candidateRows=new Map<number,{id:number;distance:number}>(),wanted=new Map<number,RealisticTreeDetailRole>();
 const retirements=new Set<Promise<void>>(),localOwners=new Set<WorldOwnerRetirement>(),ownerCounterKeys=['active','draining','fencing','releasing','retired','held','pendingReady','acquired']as const;
 const ids=new Set<number>(),failed=new Set<number>(),failedDensity=new Set<number>(),densityIds=new Set<number>(),near=new Map<number,NearTree>(),leases:{release():void}[]=[];
 let retiringFull=0;let disposed=false,began=false,layout:RegionalWorldLayout|null=null,far:FarTree|null=null,canopy:FarTree|null=null,preparation:Promise<void>|null=null;
 const point=new Vector3(),position=new Vector3(),scale=new Vector3(),up=new Vector3(0,1,0),rotation=new Quaternion(),matrix=new Matrix4(),inverse=new Matrix4(),box=new Box3();
 const actor=(id:number,normalised=true)=>{const p=layout!.placements,at=id*6;matrix.compose(position.set(p[at],p[at+1],p[at+2]),rotation.setFromAxisAngle(up,p[at+3]),scale.setScalar(p[at+4]));return normalised?matrix.multiply(source.normalization):matrix;};
 function reportOwners(){for(const key of ownerCounterKeys)stats.ownerLifetime[key]=0;for(const owner of localOwners){stats.ownerLifetime[owner.stats.phase]++;stats.ownerLifetime.pendingReady+=owner.stats.pendingReady;stats.ownerLifetime.acquired+=owner.stats.acquired;}}
 function primaryStable(){if(retiringFull)return false;for(const[id,role]of wanted)if(role==='full'){const tree=near.get(id);if(!tree||tree.role!=='full'||tree.level.stats.readyMask!==15||tree.coverage<1)return false;}return true;}
 function retire(id:number){
  const tree=near.get(id);if(!tree)return;near.delete(id);tree.budget?.retire();if(tree.role==='full')retiringFull++;
  let work:Promise<void>;
  if(tree.owner)work=tree.owner.retire();
  else{tree.group.removeFromParent();const presented=tree.level.stats.readyMask===(tree.role==='density'?14:15);if(!presented)tree.level.dispose();
   work=tree.level.preparation.then(()=>retirementFence()).then(async()=>{if(presented)tree.level.dispose();await tree.level.whenRetired;for(const mesh of tree.meshes)mesh.dispose();tree.group.clear();tree.reservation?.release();tree.budget?.release();});
  }
  const retirement=work.then(()=>{if(tree.role==='full')retiringFull--;if(tree.owner)localOwners.delete(tree.owner);}).catch(cause=>{
   stats.error=String(cause);options.changed();return new Promise<void>(()=>{}); // Unsafe GPU cleanup keeps its credits and source references held.
  }).finally(()=>{retirements.delete(retirement);stats.retiring=retirements.size;reportOwners();if(!disposed)options.changed();});
  retirements.add(retirement);stats.retiring=retirements.size;
 }
 function makeFar(atlas:PreparedVegetationAtlas,top:boolean):FarTree{
  const record=atlas.record,eye={value:new Vector3()},sourceInverse=new Matrix4(),elevated={value:1},centre={value:new Vector3(...(top&&far?far.atlas.record.centre:record.centre))};
  const foliage=source.parts.find(part=>part.foliage)!.material;
  const material=new MeshStandardMaterial({name:'Authored BlackAlder relit '+(top?'crown':'full tree'),map:atlas.maps[0],roughness:foliage.roughness,
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
  material.customProgramCacheKey=()=>':authored-alder-relit-elevation-haze-v1:'+top;
  const geometry=new PlaneGeometry(1,1),ranges=new InstancedBufferAttribute(new Float32Array(ids.size*2),2);geometry.setAttribute('crownfallLodRange',ranges);
  const mesh=new InstancedMesh(geometry,material,ids.size);mesh.count=0;mesh.frustumCulled=false;mesh.raycast=()=>{};mesh.receiveShadow=true;
  const normalScale=source.normalization.elements[5],base=(source.contact.baseY-source.normalization.elements[13])/normalScale;
  mesh.userData.crownfallVegetationWind={root:[0,base,0],tip:[0,base+source.height/normalScale,0],grass:false};
  mesh.onBeforeRender=(_renderer,_scene,camera)=>{length.value=worldHazeDistance(options.conditions?.()??null);metric.value=1/Math.max(1e-7,options.sourceRoot.matrixWorld.getMaxScaleOnAxis());camera.getWorldPosition(eye.value).applyMatrix4(sourceInverse.copy(mesh.matrixWorld).invert());};
  object.add(mesh);return{mesh,material,geometry,ranges,atlas};
 }
 function makeNear(id:number,now:number,role:RealisticTreeDetailRole='full'){
  const budget=options.detailBudget?.acquire(id,role)??null;if(options.detailBudget&&!budget)return false;
  const raw=options.ownedNearResources;let reservation:NearTree['reservation']=null;
  if(role==='density')try{reservation=(raw??resources).ownerBuffers(source.family+':'+id+':density',FOREST01_DENSITY_LOD.ownerBufferBytes);}catch(cause){stats.densityError=String(cause);budget?.release();return false;}
  const group=new Group();group.name='Authored regional tree '+id;group.matrixAutoUpdate=false;group.matrix.copy(actor(id));group.visible=false;object.add(group);
  const meshes:InstancedMesh[]=[];let level:VegetationCellHlod|undefined,owner:WorldOwnerRetirement|null=null;
  if(raw){owner=createWorldOwnerRetirement({
   stop(){group.removeFromParent();level?.dispose();},producer:()=>level?.preparation??Promise.resolve(),
   fence:proof=>options.ownerRetirementFence?options.ownerRetirementFence(proof):gpuRetirement.afterOwnerQuiescent(proof),
   async releaseOwned(){await level?.whenRetired;for(const mesh of meshes)mesh.dispose();group.clear();},
   releaseCredit(){reservation?.release();budget?.release();},
  });localOwners.add(owner);if(reservation)owner.trackReady(reservation.ready);}
  const owned=raw&&owner?scopeOwnedVegetationResources(raw,owner):resources;
  try{for(const part of source.parts){const mesh=new InstancedMesh(part.geometry,part.material,1);mesh.setMatrixAt(0,part.frame);mesh.instanceMatrix.needsUpdate=true;mesh.castShadow=false;mesh.receiveShadow=true;mesh.raycast=()=>{};group.add(mesh);meshes.push(mesh);}
   level=createVegetationCellHlod(group,{renderer:options.renderer,scene:options.scene,camera:options.camera,resources:owned,preparationOwner:owner??undefined,signal,changed:options.changed,native:options.native,solidOverhead:true,tileSize:64,sourceRoot:options.sourceRoot,retirementFence:owner?()=>owner!.fenced:retirementFence,detailScale:Math.min(1,source.height/18),...(role==='density'?{representation:'forest01-density' as const,ownedBufferReservation:reservation!}:{})});
   level.setCoverage(0);near.set(id,{owner,reservation,role,group,level,meshes,coverage:0,last:now,budget});if(role==='density')stats.densityError='';return true;
  }catch(cause){(role==='density'?failedDensity:failed).add(id);stats.densityFailures=failedDensity.size;if(role==='density')stats.densityError=String(cause);else stats.error=String(cause);
   if(owner){budget?.retire();const failedOwner=owner;const retirement=failedOwner.retire().then(()=>{localOwners.delete(failedOwner);}).finally(()=>{retirements.delete(retirement);stats.retiring=retirements.size;options.changed();});retirements.add(retirement);stats.retiring=retirements.size;}
   else{group.removeFromParent();for(const mesh of meshes)mesh.dispose();if(budget){budget.retire();void retirementFence().then(()=>{reservation?.release();budget.release();});}}
  }
 }
 async function prepare(value:RegionalWorldLayout){
  if(disposed||began)return preparation;began=true;layout=value;const cohort=value[options.cohortKey??'realisticTrees'];
  if(!cohort||cohort.version!==REALISTIC_TREE_COHORT_VERSION||cohort.walkingGuardVersion!==REALISTIC_TREE_WALKING_VERSION||cohort.sourceSha256!==source.sourceSha256||!cohort.ids.length||cohort.ids.length>REALISTIC_TREE_COHORT_LIMIT||new Set(cohort.ids).size!==cohort.ids.length||cohort.ids.some(id=>id>=value.placements.length/6||value.placements[id*6+5]!==source.variant)){stats.status='fallback';return;}
  for(const id of cohort.ids){ids.add(id);candidateRows.set(id,{id,distance:0});}
  const density=cohort.density;if(!options.native&&options.densityRole&&options.detailBudget&&source.variant===1&&source.family===REALISTIC_FOREST01_FAMILY&&source.sourceSha256===FOREST01_DENSITY_LOD.sourceSha256&&matchesForest01DensityNormalization(source.normalization.elements)&&source.parts.every(part=>part.frame.equals(new Matrix4()))&&density?.version===FOREST01_DENSITY_LOD.version&&density.proofSha256===FOREST01_DENSITY_WALKING.sha256&&density.proofTriangles===FOREST01_DENSITY_WALKING.triangles&&density.producer===FOREST01_DENSITY_WALKING.producer&&matchesForest01DensityNormalization(density.normalization)&&density.walkingGuardVersion===REALISTIC_TREE_WALKING_VERSION&&density.ids.length<=ids.size&&new Set(density.ids).size===density.ids.length&&density.ids.every(id=>ids.has(id)))for(const id of density.ids)densityIds.add(id);
  if(densityIds.size)stats.densityProofSha256=FOREST01_DENSITY_WALKING.sha256;stats.densityEligible=densityIds.size;stats.eligible=ids.size;stats.examined=cohort.examined;stats.rejectedRoots=cohort.rejectedRoot;stats.rejectedWalking=cohort.rejectedWalking??0;stats.heldWalkingUncertain=cohort.heldWalkingUncertain??0;stats.walkingGuardVersion=cohort.walkingGuardVersion??'';stats.status='preparing';
  preparation=(async()=>{try{
    const fullLease=resources.atlas(source.parts,64,8,false);leases.push(fullLease);const full=await fullLease.ready;signal.throwIfAborted();far=makeFar(full,false);
    const crownLease=resources.atlas(source.parts,64,8,true,true);leases.push(crownLease);const crown=await crownLease.ready;signal.throwIfAborted();canopy=makeFar(crown,true);
    const compiled=resources.compile('complete-alder-global-captures-v1'+(source.variant===1?':'+source.family:''),[far.mesh,canopy.mesh],options.camera,options.scene);leases.push(compiled);await compiled.ready;signal.throwIfAborted();stats.status='ready';options.changed();
   }catch(cause){if(disposed||signal.aborted)return;ids.clear();if(far)far.mesh.visible=false;if(canopy)canopy.mesh.visible=false;stats.status='fallback';stats.error=String(cause);options.changed();}
  })();return preparation;
 }
 function dispose(){if(disposed)return;disposed=true;controller.abort();options.signal.removeEventListener('abort',dispose);for(const id of near.keys())retire(id);object.removeFromParent();
  void Promise.all(retirements).then(()=>retirementFence()).then(()=>{for(const lease of leases)lease.release();for(const draw of [far,canopy])if(draw){draw.mesh.dispose();draw.geometry.dispose();draw.material.dispose();}resources.dispose();object.clear();});stats.status='disposed';
 }
 options.signal.addEventListener('abort',dispose,{once:true});if(options.signal.aborted)dispose();
 return{object,stats,resources:resources.stats,prepare,owns(id:number){return stats.status==='ready'&&ids.has(id);},
  get primarySettled(){return stats.primarySettled;},
  hasNearCandidate(camera:Camera,visibleIds:ReadonlySet<number>){
   if(disposed||stats.status!=='ready'||!layout)return false;options.sourceRoot.updateWorldMatrix(true,false);point.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse.copy(options.sourceRoot.matrixWorld).invert());
   for(const id of ids){if(!visibleIds.has(id)||failed.has(id))continue;box.copy(source.bounds).applyMatrix4(actor(id,false));if(box.distanceToPoint(point)<(options.native?70:100))return true;}return false;
  },
  update(camera:Camera,now:number,quality:'low'|'medium'|'high',reducedMotion:boolean,visibleIds:ReadonlySet<number>){
   if(disposed||stats.status!=='ready'||!layout||!far||!canopy)return false;
   options.sourceRoot.updateWorldMatrix(true,false);point.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse.copy(options.sourceRoot.matrixWorld).invert());
   const primaryLimit=options.detailLimit?.()??realisticTreeDetailLimit(options.native);stats.detailLimit=primaryLimit+(densityIds.size?1:0);stats.maximumSourceTriangles=primaryLimit*source.triangles+(densityIds.size?FOREST01_DENSITY_LOD.triangles:0);stats.maximumTransitionTriangles=stats.maximumSourceTriangles*2;
   candidates.length=0;for(const id of ids){if(!visibleIds.has(id))continue;box.copy(source.bounds).applyMatrix4(actor(id,false));const distance=box.distanceToPoint(point);if(distance<(options.native?70:100)&&!failed.has(id)){const row=candidateRows.get(id)!;row.distance=distance;candidates.push(row);}}
   candidates.sort((a,b)=>a.distance-b.distance||a.id-b.id);wanted.clear();for(let i=0;i<Math.min(candidates.length,primaryLimit);i++)wanted.set(candidates[i].id,'full');let transition=false;
   const primaryWasStable=primaryStable();
   if(densityIds.size&&primaryWasStable&&options.densityRole?.primaryReady()){
    const extra=candidates.find(row=>!wanted.has(row.id)&&densityIds.has(row.id)&&!failedDensity.has(row.id));if(extra)wanted.set(extra.id,'density');
   }
   for(const[id,tree]of near){const ready=tree.level.stats.readyMask===(tree.role==='density'?14:15),desired=wanted.get(id)===tree.role&&ready;
    if(tree.level.stats.status==='error'){if(tree.role!=='density'||!tree.level.stats.retryableError)(tree.role==='density'?failedDensity:failed).add(id);stats.densityFailures=failedDensity.size;if(tree.role==='density')stats.densityError=tree.level.stats.error;else stats.error=tree.level.stats.error;retire(id);continue;}
    const delta=Math.min(250,Math.max(0,now-tree.last));tree.last=now;const target=desired?1:0;
    tree.coverage=reducedMotion?target:Math.max(0,Math.min(1,tree.coverage+(target?1:-1)*delta/250));
    tree.group.visible=ready&&tree.coverage>0;tree.level.setCoverage(tree.coverage);if(tree.group.visible)transition=tree.level.update(now,camera,quality,reducedMotion)||transition;
    if(tree.coverage!==target)transition=true;if(wanted.get(id)!==tree.role&&tree.coverage===0)retire(id);
   }
   let primaryCount=retiringFull,preparing=0;for(const tree of near.values())if(tree.role==='full'){primaryCount++;if(tree.level.stats.readyMask!==15)preparing++;}
   if(primaryCount<primaryLimit&&preparing<2){const next=candidates.find(row=>wanted.get(row.id)==='full'&&!near.has(row.id));if(next&&makeNear(next.id,now))options.changed();}
   stats.primarySettled=primaryStable();
   if(stats.primarySettled&&options.densityRole?.primaryReady()&&options.densityRole.canPrepare()){
    const next=candidates.find(row=>wanted.get(row.id)==='density'&&!near.has(row.id));if(next&&makeNear(next.id,now,'density'))options.changed();
    // Reduced Motion can finish primary coverage after this frame's wanted
    // set was chosen. Request one admission frame, not permanent polling:
    // a later budget refusal keeps its source atlas until another real wake.
    if(!primaryWasStable&&candidates.some(row=>!wanted.has(row.id)&&!near.has(row.id)&&densityIds.has(row.id)&&!failedDensity.has(row.id)))transition=true;
   }
   stats.detailed=stats.preparing=0;stats.fullActorIds.length=stats.densityActorIds.length=0;
   for(const[id,tree]of near){if(tree.group.visible){stats.detailed++;(tree.role==='full'?stats.fullActorIds:stats.densityActorIds).push(id);}if(tree.level.stats.readyMask!==(tree.role==='density'?14:15))stats.preparing++;}
   far.mesh.count=canopy.mesh.count=0;stats.visible=0;
   for(const id of ids){if(!visibleIds.has(id))continue;const coverage=near.get(id)?.coverage??0;stats.visible++;if(coverage>=1)continue;
    const at=far.mesh.count++;far.mesh.setMatrixAt(at,actor(id));far.ranges.setXY(at,coverage,1);
    // The elevation shader performs the complementary full/crown handoff.
    canopy.mesh.setMatrixAt(canopy.mesh.count, matrix);canopy.ranges.setXY(canopy.mesh.count++,coverage,1);
   }
   for(const draw of [far,canopy]){draw.mesh.visible=draw.mesh.count>0;if(draw.mesh.count){draw.mesh.instanceMatrix.needsUpdate=true;draw.ranges.needsUpdate=true;}}
   stats.levels.fill(0);for(const tree of near.values())if(tree.group.visible)for(let level=0;level<4;level++)stats.levels[level]+=tree.level.stats.levels[level];stats.levels[3]+=far.mesh.count;
   stats.far=far.mesh.count;stats.canopies=canopy.mesh.count;reportOwners();return transition;
  },dispose};
}
export type RealisticRegionalTrees=ReturnType<typeof createRealisticRegionalTrees>;

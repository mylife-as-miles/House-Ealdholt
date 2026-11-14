import {forest01DensityWalkingSource} from './forest01-density-source';
import {createGeneratedRegionalFoliageNormals} from './generated-foliage-normals';
import {regionalBaseBudgetWithFoliageNormals} from '../../../../shared/legacy/aethelgard/environment/generated-foliage-normal';
import {createWorldResourceRetirementFence} from './world-resource-retirement';
import {createScannedUndergrowth} from './scanned-undergrowth';
import {scannedShrubCohortSource} from '../../../../shared/legacy/aethelgard/environment/scanned-shrub-assets';
import {scannedShrubDerivativeBudget} from '../../../../shared/legacy/aethelgard/environment/scanned-shrub-policy';
import {naturalRiparianReservation,naturalRiparianSource} from '../../../../shared/legacy/aethelgard/environment/natural-riparian-policy';
import type {GLTF}from'three/addons/loaders/GLTFLoader.js';
import {realisticTreeMemoryBudget} from './realistic-regional-trees';
import {createRealisticRegionalWoodland} from './realistic-regional-woodland';
import type {NormalizedRealisticTreeSource} from './realistic-tree-source';
import {REGIONAL_ROOT_CONTACTS} from '../../../../shared/legacy/aethelgard/environment/regional-root-contact-data';
import {REGIONAL_VEGETATION_PROFILES} from '../../../../shared/legacy/aethelgard/environment/regional-vegetation-profiles';
import {compareRegionalDetailCells,regionalDetailFocus,regionalTreePriority} from '../../../../shared/legacy/aethelgard/environment/regional-detail-focus';
import {createRegionalDetailService,regionalDetailCellProgress,REGIONAL_DETAIL_SERVICE_MILLISECONDS} from '../../../../shared/legacy/aethelgard/environment/regional-detail-service';
import {createRegionalGroundcover} from './regional-groundcover';
import {collectRegionalVillageSource} from './regional-village-source';
import {regionalVillageEdgeDistance} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
import {worldHazeDistance,type WorldEnvironmentState} from '../../../../shared/legacy/aethelgard/environment/world-environment-state';
import {createRegionalRocks} from './regional-rocks';
import {createRegionalForestFloor} from './regional-forest-floor';
import type {VoxelTerrainSource} from '../../../../shared/legacy/aethelgard/environment/voxel-source-index';
import {Box3, Frustum, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion, Vector2, Vector3,
 type Camera,type Object3D,type Scene,type Texture,type WebGLRenderer} from 'three';
import {EALDHOLT_REGIONAL_WORLD as POLICY} from '../../../../shared/legacy/aethelgard/environment/regional-world-policy';
import {REGIONAL_VEGETATION_PROTOTYPES as PROTOTYPES} from '../../../../shared/legacy/aethelgard/environment/regional-assets';
import type {RegionalCell,RegionalWorldLayout} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
import type {EaldholtFarGeography} from '../../../../shared/legacy/aethelgard/environment/far-surround';
import type {EaldholtWoodlandSurface} from '../../../../shared/legacy/aethelgard/environment/river-woodland';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import {patchVegetationFade,patchVegetationImpostor} from '../../../../shared/legacy/aethelgard/environment/vegetation-shaders';
import {createVegetationPrototypeResources,type PreparedVegetationAtlas} from './vegetation-prototype';
import {createVegetationCellHlod,type VegetationCellHlod} from './vegetation-cell-hlod';
import {createInstanceMatrixUploads} from '../../../../shared/legacy/aethelgard/environment/instance-matrix-writer';
import type {VegetationPreparationWorker} from './vegetation-worker';
import type {VegetationCapturePart} from './vegetation-atlas-capture';

/** Source actors are permanent data; only bounded near detail and culled far
 * instance buffers are resident. No forest draw owns collision or NPC state. */
export function createRegionalForest(options:{sourceRoot:Object3D;prototypes:Object3D;geography:EaldholtFarGeography;
 land:readonly EaldholtWoodlandSurface[];renderer:WebGLRenderer;scene:Scene;camera:Camera;queue:WorldPreparationQueue;
 worker:VegetationPreparationWorker;signal:AbortSignal;changed():void;landOwners?:readonly Object3D[];conditions?:()=>WorldEnvironmentState|null;loadScannedShrub?:()=>Promise<Object3D>;loadNaturalRiparian?:()=>Promise<GLTF>;loadRocks?:(detail:'near'|'far')=>Promise<Object3D>;loadLitter?:()=>Promise<Texture>;realisticTreeSource?:NormalizedRealisticTreeSource|null;realisticForest01Source?:NormalizedRealisticTreeSource|null;native?:boolean;geometryProfile?:'desktop'|'quest';active():boolean}){
 const object=new Group();object.name='Ealdholt 56k regional mixed woodland';object.userData.iwsdkPreviewBounds='exclude';
 object.userData.crownfallFarSurround={schema:1,ownedSurface:'woodland',localPlacementEligible:false};
 const prototypeProfile=options.geometryProfile??(options.native?'quest':'desktop'),prototypeSource=REGIONAL_VEGETATION_PROFILES[prototypeProfile];
 const villageSource=collectRegionalVillageSource(options.sourceRoot);
 const controller=new AbortController(),signal=controller.signal;
 const groundcover=createRegionalGroundcover({...options,signal,cameras:camera=>activeDetailCameras(camera)});object.add(groundcover.object);
 const resources=createVegetationPrototypeResources(options.renderer,options.queue,options.worker,regionalBaseBudgetWithFoliageNormals(!!options.native,options.realisticTreeSource?realisticTreeMemoryBudget(options.native):0,options.loadScannedShrub?scannedShrubDerivativeBudget(options.native):0,options.loadNaturalRiparian?naturalRiparianReservation(options.native):0),
 {worldRegion:'ealdholt-bvl-species-v1',sourceSha256:prototypeSource.sha256,backend:options.native?'iwsdk-r185-webgl2-regional-v1':'three-r185-webgl2-regional-v1'});
 const realistic=options.realisticTreeSource?createRealisticRegionalWoodland({...options,source:options.realisticTreeSource,forest01Source:options.realisticForest01Source,signal}):null;if(realistic)object.add(realistic.object);
 const rocks=options.loadRocks?createRegionalRocks({sourceRoot:options.sourceRoot,camera:options.camera,native:options.native,signal,renderer:options.renderer,cameras:camera=>activeDetailCameras(camera),load:options.loadRocks,changed:options.changed}):null;if(rocks)object.add(rocks.object);
 const forestFloor=options.loadLitter&&options.landOwners?createRegionalForestFloor({sourceRoot:options.sourceRoot,owners:options.landOwners,geography:options.geography,prototypes:PROTOTYPES,queue:options.queue,signal,borrowedSource:!!options.native,load:options.loadLitter,changed:options.changed}):null;
 const stats={instanceFloatsQueued:0,generatedFoliageNormals:null as ReturnType<typeof createGeneratedRegionalFoliageNormals>['stats']|null,scannedShrubs:null as ReturnType<typeof createScannedUndergrowth>['stats']|null,realisticTrees:realistic?.stats??null,prototypeProfile,prototypeSourceSha256:prototypeSource.sha256,groundcover:groundcover.stats,rocks:rocks?.stats??null,forestFloor:forestFloor?.stats??null,status:'loading-layout',error:'',placementVersion:'',detailFocus:[0,0,0],villageFootprint:villageSource.village??options.geography.sourceEnvelope,treesWithin20mOfVillage:0,actors:0,shrubs:0,totalInstances:0,cells:0,visibleActors:0,visibleTrees:0,visibleShrubs:0,renderedFarTrees:0,renderedFarShrubs:0,submittedRendererFrame:-1,detailCells:0,sourceFallbackCells:0,detailRequestedCells:0,detailReadyCells:0,detailPendingCells:0,detailHeldCells:0,detailError:'',detailReady:false,readyPrototypes:0,readyCanopies:0,canopyPreparation:'pending',canopyError:'',renderedCanopies:0,nearPreparing:0,levels:[0,0,0,0],placementsBytes:0,impostorBytes:0,drawCalls:0,species:[] as number[],landmarks:[] as RegionalWorldLayout['landmarks'],residentLimit:(options.native?POLICY.maximumResidentDetailCells.native:POLICY.maximumResidentDetailCells.desktop) as number};
 const variants:{parts:VegetationCapturePart[];atlas:PreparedVegetationAtlas|null;far:InstancedMesh|null;ids:number[];material:MeshStandardMaterial|null;cap:InstancedMesh|null;capMaterial:MeshStandardMaterial|null;elevated:{value:number};elevationCentre:{value:Vector3};renderedFrame:number}[]=[];
 const leases:{release():void}[]=[],planes:PlaneGeometry[]=[],near=new Map<string,{group:Group;levels:VegetationCellHlod[];meshes:InstancedMesh[];ready:boolean;handled:Set<number>}>();
 let lightingTerrain:VoxelTerrainSource|null=null;let disposed=false,suspended=false,layout:RegionalWorldLayout|null=null,worker:Worker|null=null,started=false,lastUpdate=-Infinity,realisticTransition=false,scannedTransition=false,scannedEpoch=0;
 const scanned=options.loadScannedShrub?createScannedUndergrowth({...options,signal,load:options.loadScannedShrub,changed(){lastUpdate=-Infinity;options.changed();}}):null;if(scanned){object.add(scanned.object);stats.scannedShrubs=scanned.stats;}
 const detailService=createRegionalDetailService(options.changed);
 const matrix=new Matrix4(),inverse=new Matrix4(),frustum=new Frustum(),viewProjection=new Matrix4(),point=new Vector3(),focus=new Vector3(),forward=new Vector3(),position=new Vector3(),scale=new Vector3(),rotation=new Quaternion(),up=new Vector3(0,1,0);
 const frame=(id:number)=>{const p=layout!.placements,at=id*6;return matrix.compose(position.set(p[at],p[at+1],p[at+2]),rotation.setFromAxisAngle(up,p[at+3]),scale.setScalar(p[at+4]));};
 options.prototypes.updateWorldMatrix(true,true);const prototypeInverse=options.prototypes.matrixWorld.clone().invert();
 for(const prototype of PROTOTYPES){const root=options.prototypes.getObjectByName(prototype.id);if(!root)throw Error('Missing regional GLB family: '+prototype.id);
 const parts:VegetationCapturePart[]=[];root.traverse(node=>{if(node instanceof Mesh){if(!(node.material instanceof MeshStandardMaterial))throw Error('Regional prototype requires PBR materials.');
 parts.push({geometry:node.geometry,material:node.material,frame:prototypeInverse.clone().multiply(node.matrixWorld),foliage:node.material.side===2});}});
 if(!parts.length||parts.length>8||!parts.some(p=>p.foliage))throw Error('Incomplete regional prototype.');variants.push({parts,atlas:null,far:null,ids:[],material:null,cap:null,capMaterial:null,elevated:{value:0},elevationCentre:{value:new Vector3()},renderedFrame:-1});}
 const normalRetirement=createWorldResourceRetirementFence(options.renderer,options.queue);
 const generatedNormals=createGeneratedRegionalFoliageNormals({variants:variants.map((v,i)=>({id:PROTOTYPES[i].id,parts:v.parts})),profile:prototypeProfile,sourceSha256:prototypeSource.sha256,native:options.native,signal,renderer:options.renderer,queue:options.queue,worker:options.worker,resources,retirementFence:normalRetirement,changed:options.changed});stats.generatedFoliageNormals=generatedNormals.stats;
 function fail(cause:unknown){if(disposed||signal.aborted)return;detailService.cancel();stats.status='held-error';stats.error=cause instanceof Error?cause.message:String(cause);options.changed();}
 function retireCell(id:string){const cell=near.get(id);if(!cell)return;for(const level of cell.levels)level.dispose();cell.group.removeFromParent();for(const mesh of cell.meshes)mesh.dispose();near.delete(id);}
 function dispose(){if(disposed)return;disposed=true;detailService.dispose();controller.abort();worker?.terminate();worker=null;options.signal.removeEventListener('abort',dispose);
 scanned?.dispose();realistic?.dispose();rocks?.dispose();forestFloor?.dispose();for(const id of near.keys())retireCell(id);object.removeFromParent();object.clear();for(const lease of leases)lease.release();
 const retire=()=>{groundcover.dispose();for(const variant of variants){variant.far?.dispose();variant.material?.dispose();variant.cap?.dispose();variant.capMaterial?.dispose();}for(const plane of planes)plane.dispose();resources.dispose();};
 void Promise.all([options.queue.whenIdle(),generatedNormals.whenRetired(),groundcover.whenRetired()]).then(retire);stats.status='disposed';}
 options.signal.addEventListener('abort',dispose,{once:true});if(options.signal.aborted)dispose();
 function makeFar(index:number,atlas:PreparedVegetationAtlas,canopy=false){
  const v=variants[index],source=v.parts.find(p=>p.foliage)!.material,record=atlas.record;
  const sourceEye={value:new Vector3()},sourceInverse=new Matrix4();
  const material=new MeshStandardMaterial({name:'Regional relit '+PROTOTYPES[index].id,map:atlas.maps[0],roughness:.93,alphaTest:82/255,side:2,fog:false});
  material.onBeforeCompile=shader=>{Object.assign(shader.uniforms,{crownfallSourceEye:sourceEye,crownfallElevatedEnabled:v.elevated,crownfallElevationCentre:v.elevationCentre,crownfallAtlasNormalMap:{value:atlas.maps[1]},crownfallAtlasCentre:{value:new Vector3(...record.centre)},crownfallAtlasExtent:{value:new Vector2(...record.extent)},crownfallAtlasViews:{value:record.views},crownfallAtlasGrid:{value:new Vector2(record.columns,record.rows)},crownfallAtlasPixels:{value:new Vector2(record.mips[0].width,record.mips[0].height)},crownfallAtlasMaximumMip:{value:Math.max(0,Math.log2(record.tileSize)-2)}});patchVegetationImpostor(shader,true,{canopy});patchVegetationFade(shader);};
  const originalCompile=material.onBeforeCompile;
  const hazeColour={value:options.scene.fog?.color??new Vector3(.57,.64,.67)},distanceScale={value:1},hazeLength={value:18000};
  material.onBeforeCompile=(shader,renderer)=>{originalCompile.call(material,shader,renderer);shader.uniforms.cfRegionalHaze=hazeColour;shader.uniforms.cfRegionalMetric=distanceScale;shader.uniforms.cfForestHazeLength=hazeLength;
   shader.fragmentShader='uniform vec3 cfRegionalHaze; uniform float cfRegionalMetric; uniform float cfForestHazeLength;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <tonemapping_fragment>',`float regionalHaze=clamp(1.-exp(-length(vViewPosition)*cfRegionalMetric/cfForestHazeLength),0.,.72);gl_FragColor.rgb=mix(gl_FragColor.rgb,cfRegionalHaze,regionalHaze);\n#include <tonemapping_fragment>`);};
  material.customProgramCacheKey=()=>':regional-relit-8-view-elevation-haze-v3:'+canopy;material.envMap=source.envMap;material.envMapIntensity=source.envMapIntensity;
  const plane=new PlaneGeometry(1,1),ranges=new InstancedBufferAttribute(new Float32Array(v.ids.length*2),2);for(let i=0;i<v.ids.length;i++)ranges.setXY(i,0,1);
  plane.setAttribute('crownfallLodRange',ranges);planes.push(plane);const far=new InstancedMesh(plane,material,v.ids.length);far.count=0;far.frustumCulled=false;far.raycast=()=>{};far.name='Regional L3 '+PROTOTYPES[index].id+(canopy?' overhead crown':'');
  far.userData.crownfallVegetationWind={root:[0,REGIONAL_ROOT_CONTACTS[PROTOTYPES[index].id].baseY,0],tip:[0,REGIONAL_ROOT_CONTACTS[PROTOTYPES[index].id].baseY+PROTOTYPES[index].height,0],grass:false};
  far.onBeforeRender=(_renderer,_scene,camera)=>{hazeLength.value=worldHazeDistance(options.conditions?.()??null);distanceScale.value=1/Math.max(1e-7,options.sourceRoot.matrixWorld.getMaxScaleOnAxis());camera.getWorldPosition(sourceEye.value).applyMatrix4(sourceInverse.copy(far.matrixWorld).invert());};
  far.onAfterRender=(renderer,_scene,camera)=>{if(camera!==options.camera)return;const frame=renderer.info.render.frame;if(frame!==stats.submittedRendererFrame){stats.submittedRendererFrame=frame;stats.renderedFarTrees=stats.renderedFarShrubs=stats.renderedCanopies=0;}if(canopy)stats.renderedCanopies+=far.count;if(v.renderedFrame===frame)return;v.renderedFrame=frame;if(index<12)stats.renderedFarTrees+=v.far?.count??far.count;else stats.renderedFarShrubs+=v.far?.count??far.count;};
  if(canopy){v.cap=far;v.capMaterial=material;}else{v.atlas=atlas;v.far=far;v.material=material;v.elevationCentre.value.fromArray(record.centre);stats.readyPrototypes++;}object.add(far);stats.impostorBytes+=atlas.bytes;return far;
 }
 // Upright atlases cannot cover an overhead view. Keep existing draws alive,
 // but publish initial readiness only after crown captures have compiled.
 async function prepareCanopies(){
  stats.canopyPreparation='preparing';
  for(let i=0;i<variants.length;i++){
   if(disposed||signal.aborted)return;const v=variants[i];
   try{const lease=resources.atlas(v.parts,64,8,true,true);leases.push(lease);const atlas=await lease.ready;signal.throwIfAborted();const cap=makeFar(i,atlas,true);
    const compiled=resources.compile('regional-overhead-v1:'+i,[cap],options.camera,options.scene);leases.push(compiled);await compiled.ready;signal.throwIfAborted();v.elevated.value=1;stats.readyCanopies++;
   }catch(cause){
    if(disposed||signal.aborted)return;
    // An empty source capture or rejected shader belongs to this species.
    // Retain its upright fallback and still prepare the remaining species.
    if(v.cap)v.cap.visible=false;v.elevated.value=0;
    const error=PROTOTYPES[i].id+': '+String(cause);stats.canopyError=stats.canopyError?stats.canopyError+'; '+error:error;
   }
   lastUpdate=-Infinity;options.changed();
  }
  stats.canopyPreparation=stats.readyCanopies===variants.length?'ready':'failed';options.changed();
 }
 async function prepare(){
  if(started||!layout||disposed)return;started=true;stats.status='preparing-impostors';
  try{await generatedNormals.prepare();signal.throwIfAborted();for(let i=0;i<15;i++){signal.throwIfAborted();const lease=resources.atlas(variants[i].parts,64,8,false);leases.push(lease);const atlas=await lease.ready;signal.throwIfAborted();makeFar(i,atlas);options.changed();}
   const lease=resources.compile('regional-far-v1',variants.flatMap(v=>v.far?[v.far]:[]),options.camera,options.scene);leases.push(lease);await lease.ready;signal.throwIfAborted();await realistic?.prepare(layout!);signal.throwIfAborted();stats.status='ready';options.changed();void prepareCanopies();
  }catch(cause){fail(cause);}
 }
 const detailCameras:Camera[]=[options.camera],detailFrusta=[frustum,new Frustum()],detailCameraInverse=new Matrix4();
 const activeDetailCameras=(camera:Camera):readonly Camera[]=>{
  const xr=options.renderer.xr;
  if(options.native&&xr?.isPresenting){const stereo=xr.getCamera();
   if(stereo.cameras.length===2){detailCameras[0]=stereo.cameras[0];detailCameras[1]=stereo.cameras[1];detailCameras.length=2;}
   else{detailCameras[0]=stereo;detailCameras.length=1;}
  }else{detailCameras[0]=camera;detailCameras.length=1;}
  return detailCameras;
 };
 function makeCell(cell:RegionalCell){
  const group=new Group();group.name='Regional detail '+cell.id;group.visible=false;object.add(group);
  const levels:VegetationCellHlod[]=[],meshes:InstancedMesh[]=[],entry={group,levels,meshes,ready:false,handled:new Set<number>()};near.set(cell.id,entry);
  try{for(let variant=0;variant<15;variant++){
   const ids=Array.from(cell.ids).filter(id=>layout!.placements[id*6+5]===variant&&!realistic?.owns(id)&&!scanned?.owns(id));if(!ids.length)continue;for(const id of ids)entry.handled.add(id);
   const v=variants[variant],family=new Group();family.name=cell.id+':'+PROTOTYPES[variant].id;group.add(family);
   for(const part of v.parts){const mesh=new InstancedMesh(part.geometry,part.material,ids.length);mesh.castShadow=false;mesh.receiveShadow=true;mesh.raycast=()=>{};mesh.userData.crownfallOwnedRegionalBatch=true;
    const windBase=REGIONAL_ROOT_CONTACTS[PROTOTYPES[variant].id].baseY,windReference=v.parts[0].frame.clone().invert();
    mesh.userData.crownfallVegetationActorWind={root:new Vector3(0,windBase,0).applyMatrix4(windReference).toArray(),tip:new Vector3(0,windBase+PROTOTYPES[variant].height,0).applyMatrix4(windReference).toArray(),grass:false};
    ids.forEach((id,i)=>mesh.setMatrixAt(i,frame(id).multiply(part.frame)));mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();family.add(mesh);meshes.push(mesh);}
   levels.push(createVegetationCellHlod(family,{renderer:options.renderer,scene:options.scene,camera:options.camera,resources,signal,tileSize:64,sourceRoot:options.sourceRoot,native:options.native,solidOverhead:true,actorBatch:{ids,cameras:activeDetailCameras},detailScale:Math.max(.35,Math.min(1,PROTOTYPES[variant].height/18)),changed:options.changed}));
  }}catch(cause){retireCell(cell.id);fail(cause);}
 }
 try{
  if(!disposed){worker=new Worker(new URL('./regional-world.worker.ts',import.meta.url),{type:'module'});
   worker.onerror=e=>{worker?.terminate();worker=null;fail(e.message);};
   worker.onmessage=(event:MessageEvent<{layout?:RegionalWorldLayout;horizon?:VoxelTerrainSource;error?:string}>)=>{worker?.terminate();worker=null;if(disposed)return;
    if(!event.data.layout){fail(event.data.error??'No regional layout.');return;}layout=event.data.layout;scanned?.setLayout(layout);lightingTerrain=event.data.horizon??null;
    stats.placementVersion=layout.version;for(let id=0;id<layout.placements.length/6;id++){const at=id*6,variant=layout.placements[at+5];variants[variant].ids.push(id);if(variant<12&&regionalVillageEdgeDistance(villageSource.village??options.geography.sourceEnvelope,layout.placements[at],layout.placements[at+2])<=20)stats.treesWithin20mOfVillage++;}
    Object.assign(stats,{status:'awaiting-preparation',actors:layout.treeCount,shrubs:layout.shrubCount,totalInstances:layout.placements.length/6,cells:layout.cells.length,placementsBytes:layout.placements.byteLength,species:layout.species,landmarks:layout.landmarks});if(options.active())void prepare();options.changed();};
   const transfer:Transferable[]=[];for(const surface of [...options.land,...villageSource.villageLand])for(const array of [surface.positions,surface.indices])if(ArrayBuffer.isView(array)&&array.buffer instanceof ArrayBuffer&&!transfer.includes(array.buffer))transfer.push(array.buffer);
   worker.postMessage({naturalRiparianSource:options.loadNaturalRiparian?naturalRiparianSource(!!options.native):undefined,scannedShrubSource:options.loadScannedShrub?scannedShrubCohortSource(!!options.native):undefined,geography:options.geography,land:options.land,...villageSource,prototypes:PROTOTYPES,realisticTreeSource:options.realisticTreeSource?{variant:options.realisticTreeSource.variant,height:options.realisticTreeSource.height,canopyRadius:options.realisticTreeSource.canopyRadius,contact:options.realisticTreeSource.contact,sourceSha256:options.realisticTreeSource.sourceSha256,walkingTriangles:options.realisticTreeSource.walkingTriangles}:undefined,realisticForest01Source:!options.native&&options.realisticForest01Source?{variant:options.realisticForest01Source.variant,height:options.realisticForest01Source.height,canopyRadius:options.realisticForest01Source.canopyRadius,contact:options.realisticForest01Source.contact,sourceSha256:options.realisticForest01Source.sourceSha256,walkingTriangles:options.realisticForest01Source.walkingTriangles,densityWalking:forest01DensityWalkingSource(options.realisticForest01Source)}:undefined,profile:options.geometryProfile??(options.native?'quest':'desktop'),projected:!!options.native},transfer);
  }
 }catch(cause){fail(cause);}
 const bounds=new Map<string,Box3>();
 // Service-tick scratch, reused so the update allocates no per-tick lists (Q-22).
 const visibleCells:RegionalCell[]=[],wantedCells:RegionalCell[]=[],cellDistance=new Map<string,number>(),cellPriority=new Map<string,number>(),wantedIds=new Set<string>();
 const realisticVisible=new Set<number>(),visibleShrubs=new Set<number>();
 // Unchanged far/canopy instance lists upload nothing; changes upload only their span (L-14).
 const uploads=createInstanceMatrixUploads();
 const compareWanted=(a:RegionalCell,b:RegionalCell)=>compareRegionalDetailCells(cellDistance.get(a.id)!,cellPriority.get(a.id)!,cellDistance.get(b.id)!,cellPriority.get(b.id)!)||a.id.localeCompare(b.id);
 const levelDrawable=(level:VegetationCellHlod)=>(level.stats.readyMask&1)!==0;
 function preparingCells(){let count=0;for(const cell of near.values())if(regionalDetailCellProgress(cell.levels).preparing)count++;return count;}
 return{object,stats,beginFrame(){groundcover.beginFrame();rocks?.beginFrame();stats.renderedFarTrees=stats.renderedFarShrubs=stats.renderedCanopies=0;stats.submittedRendererFrame=-1;},resources:resources.stats,get preparationReady(){return stats.status==='held-error'||stats.status==='ready'&&(stats.readyCanopies===variants.length||stats.canopyPreparation==='failed');},get layout(){return layout;},get lightingTerrain(){return lightingTerrain;},
  update(camera:Camera,now:number,quality:'low'|'medium'|'high',reducedMotion:boolean){
   if(disposed||suspended||!layout)return false;groundcover.update(layout,camera,now,quality);forestFloor?.update(layout);forestFloor?.refreshFrame();rocks?.update(layout,camera,now,quality);if(options.active()){scanned?.service();void prepare();}if(stats.status!=='ready')return false;
   if(scanned&&scannedEpoch!==scanned.stats.ownershipEpoch){scannedEpoch=scanned.stats.ownershipEpoch;for(const [id,entry]of near)if([...entry.handled].some(actor=>scanned.owns(actor)))retireCell(id);}
   let transition=false;for(const entry of near.values()){
    entry.ready=regionalDetailCellProgress(entry.levels).ready;
    // L0 is already resident. Keep these bounded near cells visible while
    // derived geometry/atlases prepare; the handoff selects ready levels only.
    entry.group.visible=entry.levels.length>0&&entry.levels.every(levelDrawable);
    if(entry.group.visible)for(const level of entry.levels)transition=level.update(now,camera,quality,reducedMotion)||transition;
   }
   if(now-lastUpdate<REGIONAL_DETAIL_SERVICE_MILLISECONDS&&!transition&&!realisticTransition&&!scannedTransition){detailService.schedule(lastUpdate+REGIONAL_DETAIL_SERVICE_MILLISECONDS);return false;}
   detailService.cancel();lastUpdate=now;
   options.sourceRoot.updateWorldMatrix(true,false);inverse.copy(options.sourceRoot.matrixWorld).invert();point.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse);
   const cameras=activeDetailCameras(camera);for(let eye=0;eye<cameras.length;eye++){viewProjection.multiplyMatrices(cameras[eye].projectionMatrix,detailCameraInverse.copy(cameras[eye].matrixWorld).invert()).multiply(options.sourceRoot.matrixWorld);detailFrusta[eye].setFromProjectionMatrix(viewProjection);}
   const visible=visibleCells,distance=cellDistance;visible.length=0;distance.clear();
   for(const cell of layout.cells){let b=bounds.get(cell.id);if(!b){b=new Box3();for(const id of cell.ids){const at=id*6,p=layout.placements,height=PROTOTYPES[p[at+5]].height*p[at+4];b.expandByPoint(position.set(p[at]-18,p[at+1],p[at+2]-18));b.expandByPoint(position.set(p[at]+18,p[at+1]+height,p[at+2]+18));}bounds.set(cell.id,b);}
    if(detailFrusta[0].intersectsBox(b)||cameras.length===2&&detailFrusta[1].intersectsBox(b)){visible.push(cell);distance.set(cell.id,b.distanceToPoint(point));}}
   stats.residentLimit=options.native?POLICY.maximumResidentDetailCells.native:quality==='low'?3:quality==='medium'?8:POLICY.maximumResidentDetailCells.desktop;
   camera.getWorldDirection(forward).transformDirection(inverse);regionalDetailFocus(focus,point,forward,options.geography.seaLevel+2);stats.detailFocus[0]=focus.x;stats.detailFocus[1]=focus.y;stats.detailFocus[2]=focus.z;
   cellPriority.clear();for(const cell of visible)cellPriority.set(cell.id,regionalTreePriority(layout.placements,cell.ids,focus));
   const wanted=wantedCells;wanted.length=0;for(const c of visible)if((distance.get(c.id)??Infinity)<(options.native?270:520)&&point.y-bounds.get(c.id)!.max.y<90)wanted.push(c);
   wanted.sort(compareWanted);if(wanted.length>stats.residentLimit)wanted.length=stats.residentLimit;
   wantedIds.clear();for(const c of wanted)wantedIds.add(c.id);for(const id of near.keys())if(!wantedIds.has(id))retireCell(id);
   // Only one new spatial cell starts per service tick; existing far draws stay
   // active until that cell has a drawable source fallback.
   let next:RegionalCell|null=null,readyCells=0;for(const c of wanted){const entry=near.get(c.id);if(!entry){next??=c;}else if(entry.ready)readyCells++;}
   if(next&&preparingCells()<2)makeCell(next);
   stats.detailRequestedCells=wanted.length;stats.detailReadyCells=readyCells;
   stats.detailPendingCells=stats.detailRequestedCells-stats.detailReadyCells;stats.detailReady=stats.detailPendingCells===0;
   stats.detailHeldCells=0;stats.detailError='';
   for(const cell of wanted){const entry=near.get(cell.id);if(!entry)continue;const progress=regionalDetailCellProgress(entry.levels);if(progress.held)stats.detailHeldCells++;
    if(progress.error&&stats.detailError.length<700)stats.detailError+=(stats.detailError?'; ':'')+cell.id+': '+progress.error;}
   // Active derivatives already wake their owner when they publish. Only an
   // uncreated, startable cell needs another bounded service deadline here.
   let startable=false;for(const c of wanted)if(!near.has(c.id)){startable=true;break;}
   if(stats.status==='ready'&&startable&&preparingCells()<2)detailService.schedule(now+REGIONAL_DETAIL_SERVICE_MILLISECONDS);
   for(const v of variants){if(v.far)v.far.count=0;if(v.cap)v.cap.count=0;}
   stats.visibleActors=stats.visibleTrees=stats.visibleShrubs=0;stats.levels.fill(0);stats.detailCells=0;stats.sourceFallbackCells=0;stats.nearPreparing=0;
   for(const cell of visible){const entry=near.get(cell.id);
    if(entry&&regionalDetailCellProgress(entry.levels).preparing)stats.nearPreparing++;
    if(entry?.group.visible){stats.detailCells++;if(!entry.ready)stats.sourceFallbackCells++;for(const level of entry.levels)for(let i=0;i<4;i++)stats.levels[i]+=level.stats.levels[i];stats.visibleActors+=entry.handled.size;for(const id of entry.handled)if(layout.placements[id*6+5]<12)stats.visibleTrees++;else stats.visibleShrubs++;}
    for(const id of cell.ids){if(entry?.group.visible&&entry.handled.has(id))continue;if(realistic?.owns(id)||scanned?.owns(id)){stats.visibleActors++;if(layout.placements[id*6+5]<12)stats.visibleTrees++;else stats.visibleShrubs++;continue;}const variant=layout.placements[id*6+5];if(variant>=12&&(distance.get(cell.id)??Infinity)>(options.native?220:550))continue;const v=variants[variant],far=v.far;if(!far)continue;uploads.write(far.instanceMatrix,far.count++,frame(id).elements);if(v.cap&&v.elevated.value>0){const at=id*6,p=layout.placements,ratio=(point.y-p[at+1]-v.elevationCentre.value.y*p[at+4])/Math.max(1,Math.hypot(point.x-p[at],point.z-p[at+2]));if(ratio>.25)uploads.write(v.cap.instanceMatrix,v.cap.count++,matrix.elements);}stats.visibleActors++;if(variant<12)stats.visibleTrees++;else stats.visibleShrubs++;stats.levels[3]++;}}
   realisticVisible.clear();for(const cell of visible)for(const id of cell.ids)if(realistic?.owns(id))realisticVisible.add(id);
   realisticTransition=realistic?.update(camera,now,quality,reducedMotion,realisticVisible)??false;transition=realisticTransition||transition;if(realistic)for(let i=0;i<4;i++)stats.levels[i]+=realistic.stats.levels[i];
   if(scanned){visibleShrubs.clear();for(const cell of visible)for(const id of cell.ids)if(scanned.owns(id))visibleShrubs.add(id);scannedTransition=scanned.update(camera,now,quality,reducedMotion,visibleShrubs);transition=scannedTransition||transition;if(scanned.stats.detail)for(let i=0;i<4;i++)stats.levels[i]+=scanned.stats.detail.levels[i];}
   stats.drawCalls=0;for(const v of variants){const far=v.far,cap=v.cap;if(far){far.visible=far.count>0;if(far.count)stats.drawCalls++;}if(cap){cap.visible=cap.count>0;if(cap.count)stats.drawCalls++;}}
   stats.instanceFloatsQueued+=uploads.commit();
   // No per-tick trim (L-15): the pool already evicts unused entries by budget,
   // so a variant's near-detail resources survive its last cell leaving view.
   return transition;
  },suspend(){suspended=true;object.visible=false;detailService.suspend();},resume(){if(disposed)return;suspended=false;object.visible=true;detailService.resume();},dispose};
}
export type RegionalForest=ReturnType<typeof createRegionalForest>;

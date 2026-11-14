import {Box3,Frustum,Group,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,Quaternion,Vector3,type BufferGeometry,type Camera,type Object3D,type Scene,type WebGLRenderer} from 'three';
import type{GLTF}from'three/addons/loaders/GLTFLoader.js';
import type{WorldPreparationQueue}from'../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import{NATURAL_RIPARIAN_COHORT_VERSION,naturalRiparianContract,naturalRiparianLimit,naturalRiparianSource}from'../../../../shared/legacy/aethelgard/environment/natural-riparian-policy';
import{createNaturalRiparianPlants}from'./natural-riparian-plants';
import {createInstanceMatrixUploads} from '../../../../shared/legacy/aethelgard/environment/instance-matrix-writer';
import {ealdholtPlantTriangleBudget} from '../../../../shared/legacy/aethelgard/environment/plant-triangle-budget';
import {readAuthoredVegetationGeometry,readAuthoredVegetationMaterial} from './vegetation-cell-hlod';
import type {RegionalWorldLayout} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
import {validRegionalGroundcoverSource,type RegionalGroundcoverSource} from '../../../../shared/legacy/aethelgard/environment/regional-groundcover-policy';
import{createNaturalRiparianCoverage,NATURAL_RIPARIAN_COVERAGE_VERSION}from'../../../../shared/legacy/aethelgard/environment/natural-riparian-coverage';

/** Read-only qualification shared by rendering and the terrain worker packet. */
function readRegionalGrassFamilies(root:Object3D){
 const families:{geometry:BufferGeometry;material:MeshStandardMaterial;triangles:number;minimumY:number;maximumY:number;radius:number;name:string}[]=[],seen=new Set<BufferGeometry>(),sourcePoint=new Vector3();
 root.traverse(node=>{if(!(node instanceof Mesh)||!/Grass_Clumps/i.test(node.name))return;
  const geometry=readAuthoredVegetationGeometry(node),material=readAuthoredVegetationMaterial(node),p=geometry.getAttribute('position');
  if(!material||!p||seen.has(geometry))return;seen.add(geometry);
  const box=new Box3();let radius=0;for(let i=0;i<p.count;i++){sourcePoint.set(p.getX(i),p.getY(i),p.getZ(i));box.expandByPoint(sourcePoint);radius=Math.max(radius,Math.hypot(sourcePoint.x,sourcePoint.z));}const triangles=(geometry.index?.count??p.count)/3;
  if(box.max.y-box.min.y>.7||box.max.y-box.min.y<=0||triangles>256||geometry.groups.length>1)return;
  families.push({geometry,material,triangles,minimumY:box.min.y,maximumY:box.max.y,radius,name:node.name});
 });
 return families.sort((a,b)=>a.triangles-b.triangles||a.name.localeCompare(b.name)).slice(0,3);
}
export function measureRegionalGroundcoverSource(root:Object3D):RegionalGroundcoverSource|undefined{
 const families=readRegionalGrassFamilies(root);if(!families.length)return;
 const source={radius:Math.max(...families.map(f=>f.radius)),minimumHeight:Math.min(...families.map(f=>f.maximumY-f.minimumY)),maximumHeight:Math.max(...families.map(f=>f.maximumY-f.minimumY)),families:families.map(f=>f.name)};
 return validRegionalGroundcoverSource(source)?source:undefined;
}

/** Reuse complete original grass families, independent of their currently
 * culled visual count or HLOD material. Added scenery owns only instance buffers
 * and material clones; source meshes, navigation and saves stay untouched. */
export function createRegionalGroundcover(options:{sourceRoot:Object3D;camera:Camera;native?:boolean;renderer?:WebGLRenderer;scene?:Scene;queue?:WorldPreparationQueue;signal?:AbortSignal;changed?:()=>void;loadNaturalRiparian?:()=>Promise<GLTF>;cameras?:(camera:Camera)=>readonly Camera[]},naturalFactory=createNaturalRiparianPlants){
 const object=new Group();object.name='Ealdholt clearing-edge source grass';object.userData.iwsdkPreviewBounds='exclude';
 object.userData.crownfallRegionalGroundcover={nonSolid:true,sourceActorsUntouched:true};
 const stats={status:'awaiting-layout',error:'',placed:0,visible:0,renderedGrass:0,triangles:0,triangleBudget:0,drawCalls:0,submittedRendererFrame:-1,placementVersion:'',riparian:0,riparianHeightQualified:0,sourceFamilies:[] as string[],natural:null as ReturnType<typeof createNaturalRiparianPlants>['stats']|null,naturalEligible:0,naturalVisible:0,naturalTriangles:0,naturalRendered:0,naturalSelectedIds:[] as number[],naturalFallbackIds:[] as number[],naturalHeld:'',naturalSelectionPolicy:NATURAL_RIPARIAN_COVERAGE_VERSION,instanceFloatsQueued:0};
 // Unchanged instance lists upload nothing; changes upload only their span (L-14).
 const uploads=createInstanceMatrixUploads();
 const families:{geometry:BufferGeometry;material:MeshStandardMaterial;triangles:number;minimumY:number;maximumY:number;radius:number;name:string;mesh:InstancedMesh|null}[]=[];
 for(const source of readRegionalGrassFamilies(options.sourceRoot)){
  const owned=source.material.clone();owned.name='Ealdholt regional grass '+source.material.name;owned.onBeforeCompile=source.material.onBeforeCompile;owned.customProgramCacheKey=source.material.customProgramCacheKey.bind(source.material);
  families.push({...source,material:owned,mesh:null});
 }
 stats.sourceFamilies=families.map(f=>f.name);
 const inverse=new Matrix4(),projection=new Matrix4(),matrix=new Matrix4(),cameraInverse=new Matrix4(),frusta=[new Frustum(),new Frustum()],eyes=[new Vector3(),new Vector3()],actorBox=new Box3(),point=new Vector3(),rotation=new Quaternion(),scale=new Vector3(),up=new Vector3(0,1,0);
 const cells:{box:Box3;ids:number[];distance:number}[]=[],visible:typeof cells=[];
 const naturalFamilies=new Uint8Array(options.loadNaturalRiparian?8192:0),admitted=new Uint8Array(options.loadNaturalRiparian?8192:0),coverage=options.loadNaturalRiparian?createNaturalRiparianCoverage(naturalRiparianLimit(options.native)):null;
 let layout:RegionalWorldLayout|null=null,lastUpdate=-Infinity,disposed=false,naturalCallbacks=false;
 const natural=options.loadNaturalRiparian&&options.renderer&&options.scene&&options.queue&&options.signal?naturalFactory({renderer:options.renderer,scene:options.scene,camera:options.camera,queue:options.queue,signal:options.signal,native:options.native,load:options.loadNaturalRiparian,changed(){lastUpdate=-Infinity;options.changed?.();}}):null;
 if(natural){object.add(natural.object);stats.natural=natural.stats;}
 const renderCamera=(camera:Camera)=>camera===options.camera||!!options.cameras?.(options.camera).includes(camera);
 function recordDraw(renderer:WebGLRenderer,camera:Camera,count:number,naturalDraw=false){if(!renderCamera(camera))return;const frame=renderer.info.render.frame;if(frame!==stats.submittedRendererFrame){stats.submittedRendererFrame=frame;stats.renderedGrass=stats.naturalRendered=0;}stats.renderedGrass+=count;if(naturalDraw)stats.naturalRendered+=count;}
 function assemble(next:RegionalWorldLayout){
  if(layout)return;layout=next;const p=layout.groundcover??new Float32Array();stats.placed=p.length/6;stats.placementVersion=next.groundcoverVersion??'clearing-edge-v1';stats.riparian=next.groundcoverRiparian??0;stats.riparianHeightQualified=next.groundcoverDiagnostics?.heightQualification?.enlarged??0;
  if(!families.length){stats.status='source-unavailable';stats.error='No complete bounded source grass family.';return;}
  const index=new Map<string,typeof cells[number]>();for(let at=0;at<p.length;at+=6){const key=Math.floor(p[at]/16)+','+Math.floor(p[at+2]/16);let cell=index.get(key);if(!cell){cell={box:new Box3(),ids:[],distance:0};index.set(key,cell);cells.push(cell);}cell.ids.push(at);
   const f=families[p[at+5]%families.length],height=(f.maximumY-f.minimumY)*p[at+4],radius=f.radius*p[at+4]+.11*height;
   cell.box.expandByPoint(point.set(p[at]-radius,p[at+1]+.003,p[at+2]-radius));cell.box.expandByPoint(point.set(p[at]+radius,p[at+1]+height+.005,p[at+2]+radius));}
  families.forEach((f,variant)=>{let capacity=0;for(let at=5;at<p.length;at+=6)if(p[at]%families.length===variant)capacity++;
   const mesh=new InstancedMesh(f.geometry,f.material,capacity);mesh.name='Clearing-edge grass '+variant;mesh.count=0;mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=true;mesh.raycast=()=>{};
   mesh.userData.crownfallVegetationWind={root:[0,f.minimumY,0],tip:[0,f.maximumY,0],grass:true};
   mesh.onAfterRender=(renderer,_scene,camera)=>recordDraw(renderer,camera,mesh.count);
   f.mesh=mesh;object.add(mesh);
  });
  const cohort=next.naturalRiparian,source=naturalRiparianSource(options.native);
  if(natural&&cohort){const count=p.length/6,first=count-(next.groundcoverRiparian??0);let valid=cohort.version===NATURAL_RIPARIAN_COHORT_VERSION&&cohort.sourceSha256===source.sourceSha256&&cohort.sourceContract===naturalRiparianContract(source)&&cohort.ids.length===cohort.families.length&&cohort.ids.length<=1536;
   for(let i=0;valid&&i<cohort.ids.length;i++){const id=cohort.ids[i];valid=id>=first&&id<count&&cohort.families[i]<2&&!naturalFamilies[id];if(valid)naturalFamilies[id]=cohort.families[i]+1;}
   if(!valid){naturalFamilies.fill(0);stats.naturalHeld='Missing, stale or malformed source-qualified bank cohort.';}else{stats.naturalEligible=cohort.ids.length;
    for(const cell of cells)for(const at of cell.ids){const family=naturalFamilies[at/6];if(!family)continue;const plant=source.plants[family-1],radius=plant.radius+plant.height*.11;cell.box.expandByPoint(point.set(p[at]-radius,p[at+1]+.003,p[at+2]-radius));cell.box.expandByPoint(point.set(p[at]+radius,p[at+1]+plant.height+.005,p[at+2]+radius));}
   }
  }
  stats.status='ready';
 }
 return{object,stats,whenRetired:()=>natural?.whenRetired()??Promise.resolve(),beginFrame(){stats.renderedGrass=stats.naturalRendered=0;stats.submittedRendererFrame=-1;},update(next:RegionalWorldLayout,camera:Camera,now:number,quality:'low'|'medium'|'high'){
  if(disposed)return;assemble(next);if(stats.status!=='ready'||now-lastUpdate<180)return;lastUpdate=now;
  options.sourceRoot.updateWorldMatrix(true,false);inverse.copy(options.sourceRoot.matrixWorld).invert();
  const cameras=options.cameras?.(camera)??[camera],views=Math.min(2,cameras.length);for(let i=0;i<views;i++){eyes[i].setFromMatrixPosition(cameras[i].matrixWorld).applyMatrix4(inverse);cameraInverse.copy(cameras[i].matrixWorld).invert();projection.multiplyMatrices(cameras[i].projectionMatrix,cameraInverse).multiply(options.sourceRoot.matrixWorld);frusta[i].setFromProjectionMatrix(projection);}
  const visibleDistance=(box:Box3)=>{let distance=Infinity;for(let i=0;i<views;i++)if(frusta[i].intersectsBox(box))distance=Math.min(distance,box.distanceToPoint(eyes[i]));return distance;};
  const range=options.native?100:quality==='low'?180:quality==='medium'?250:320,budget=options.native?24000:ealdholtPlantTriangleBudget('regionalGroundcover',quality);
  stats.triangleBudget=budget;stats.visible=stats.triangles=stats.drawCalls=stats.naturalVisible=stats.naturalTriangles=0;stats.naturalSelectedIds.length=stats.naturalFallbackIds.length=0;visible.length=0;admitted.fill(0);for(const f of families)f.mesh!.count=0;for(const mesh of natural?.meshes??[]){mesh.count=0;mesh.visible=false;}
  for(const cell of cells){cell.distance=visibleDistance(cell.box);if(cell.distance<range)visible.push(cell);}visible.sort((a,b)=>a.distance-b.distance);
  const p=layout!.groundcover!;
  const source=natural?.source;
  if(stats.naturalEligible){
   if(source&&!naturalCallbacks){for(const mesh of natural!.meshes){const previous=mesh.onAfterRender;mesh.onAfterRender=function(renderer,scene,camera,geometry,material,group){previous.call(this,renderer,scene,camera,geometry,material,group);recordDraw(renderer,camera,mesh.count,true);};}naturalCallbacks=true;}
   const descriptors=naturalRiparianSource(options.native).plants;
   coverage!.reset();for(const id of layout!.naturalRiparian!.ids){const family=naturalFamilies[id]-1;if(family<0)continue;const plant=descriptors[family],at=id*6,radius=plant.radius+plant.height*.11;
    actorBox.min.set(p[at]-radius,p[at+1]+.003,p[at+2]-radius);actorBox.max.set(p[at]+radius,p[at+1]+plant.height+.005,p[at+2]+radius);const distance=visibleDistance(actorBox);if(distance>=range)continue;
    coverage!.consider(id,family,distance,p[at],p[at+2]);
   }
   const count=coverage!.finish();for(let i=0;i<count;i++){const{id,family}=coverage!.rows[i],at=id*6;
    const plant=source&&source.sourceSha256===layout!.naturalRiparian?.sourceSha256?source.plants[family]:null,fallback=families[p[at+5]%families.length],mesh=plant?natural!.meshes[family]:fallback.mesh!,triangles=plant?.triangles??fallback.triangles;
    if(stats.triangles+triangles>budget)continue;const size=plant?1:p[at+4],minimumY=plant?.minimumY??fallback.minimumY;
    matrix.compose(point.set(p[at],p[at+1]-minimumY*size+.004,p[at+2]),rotation.setFromAxisAngle(up,p[at+3]),scale.setScalar(size));uploads.write(mesh.instanceMatrix,mesh.count++,matrix.elements);admitted[id]=1;stats.visible++;stats.triangles+=triangles;
    if(plant){stats.naturalSelectedIds.push(id);stats.naturalVisible++;stats.naturalTriangles+=triangles;}else stats.naturalFallbackIds.push(id);
   }
  }
  for(const cell of visible)for(const at of cell.ids){const f=families[p[at+5]%families.length];if(stats.triangles+f.triangles>budget)continue;
   if(admitted[at/6])continue;
   matrix.compose(point.set(p[at],p[at+1]-f.minimumY*p[at+4]+.004,p[at+2]),rotation.setFromAxisAngle(up,p[at+3]),scale.setScalar(p[at+4]));uploads.write(f.mesh!.instanceMatrix,f.mesh!.count++,matrix.elements);stats.triangles+=f.triangles;stats.visible++;
  }
  for(const f of families){f.mesh!.visible=f.mesh!.count>0;if(f.mesh!.count)stats.drawCalls++;}
  for(const mesh of natural?.meshes??[]){mesh.visible=mesh.count>0;if(mesh.count)stats.drawCalls++;}
  stats.instanceFloatsQueued+=uploads.commit();
 },dispose(){if(disposed)return;disposed=true;natural?.dispose();object.removeFromParent();for(const f of families){f.mesh?.dispose();f.material.dispose();}object.clear();naturalFamilies.fill(0);admitted.fill(0);stats.naturalSelectedIds.length=stats.naturalFallbackIds.length=0;stats.status='disposed';}};
}

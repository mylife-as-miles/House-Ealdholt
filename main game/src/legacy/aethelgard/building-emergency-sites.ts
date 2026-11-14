import {Box3,BufferGeometry,DoubleSide,InstancedMesh,Matrix4,Mesh,MeshBasicMaterial,Raycaster,Triangle,Vector3,type Object3D} from 'three';
import {resolveVillageSitePath,type VillageSiteLayout,type VillageSiteAnchor,type VillageSitePoint,type VillageSiteEmergencyTraversal} from '../../../../shared/legacy/aethelgard/characters/village-site';
import type {ResidentBuildingEmergencyStation,ResidentBuildingIncident,ResidentBuildingPlaceAssociation} from '../../../../shared/legacy/aethelgard/characters/resident-building-emergency';
import type {SourceBuilding,BuildingSourceBounds} from '../../../../shared/legacy/aethelgard/observer/building-damage-catalogue';
import {emergencyBucketPose0,emergencyWorkpieceSocket,type EmergencyActionStation,type EmergencyRepairEquipment,type EmergencyWorkpiece} from './emergency-action-visuals';
import {buildingDamageKey} from '../../../../shared/legacy/aethelgard/observer/building-damage';
import {parsePopulationMotionEvidence,type PopulationMotionEvidence} from '../../../../shared/legacy/aethelgard/characters/population-motion-clearance';
import {staticSourceBounds} from './static-source-bounds';
import {prepareSourceTerrainRaycastIndex,type SourceTerrainRaycastIndex} from './source-terrain-raycast';
import {copyObserverJSON} from '../../../../shared/legacy/aethelgard/observer/observer-json';
import {getPopulationArt} from '../../../../shared/legacy/aethelgard/characters/village-population-art';
import {EALDHOLT_POPULATION_ASSET_SHA256} from '../../../../shared/legacy/aethelgard/characters/population-asset-integrity';
import {EALDHOLT_SWINE_CARRY_ROUTE_CANDIDATE as carryRoute} from '../../../../shared/legacy/aethelgard/characters/ealdholt-emergency-route-candidate';
import {recoveryWorkParkingObstruction} from '../../../../shared/legacy/aethelgard/characters/village-recovery-work-parking';
import {EALDHOLT_BREWSTER_FIRE_RESPONSE_CANDIDATE as brewsterResponse} from '../../../../shared/legacy/aethelgard/characters/ealdholt-brewster-fire-response-candidate';
import {qualifySourceEmergencyRoute,sourceRouteBoxesOverlap,sourceRouteSegmentBox,sourceRouteTriangleBox,type SourceRouteTriangle,type SourceRouteBox,type SourceRouteBody} from '../../../../shared/legacy/aethelgard/characters/emergency-source-route-clearance';
import {parseVillageSiteEmergencyTraversals,validateVillageSiteEmergencyTraversals,scopedVillageEmergencyTraversalSite} from '../../../../shared/legacy/aethelgard/characters/village-emergency-traversal';
import {parseVillageSiteEmergencyTargets,validateVillageSiteEmergencyTargets} from '../../../../shared/legacy/aethelgard/characters/village-emergency-targets';
import {EALDHOLT_SOURCE_REFUGE_CANDIDATE as refugeCandidate} from '../../../../shared/legacy/aethelgard/characters/ealdholt-emergency-refuge-candidate';
import {qualifySourceEmergencyRefuge} from '../../../../shared/legacy/aethelgard/characters/emergency-source-refuge-clearance';
import {requiredVillageRefugeMotionClips,deriveVillageRefugeBody,parseVillageSiteEmergencyRefuges,validateVillageSiteEmergencyRefuges,villageRefugeClearOfOperations,type VillageSiteEmergencyRefuge} from '../../../../shared/legacy/aethelgard/characters/village-emergency-refuges';
import {requiredPopulationMotionFiles} from '../../../../shared/legacy/aethelgard/characters/population-motion-clearance';

export interface BuildingEmergencySitesInput {
 readonly sourceRoot:Object3D;readonly sourceSha256:string;readonly profile:'desktop'|'quest';
 readonly site:VillageSiteLayout;readonly siteIdentity:string;readonly sourceMetadata:unknown;
 readonly motionEvidence:unknown;readonly buildings:readonly SourceBuilding[];
 readonly repairEquipment?:readonly EmergencyRepairEquipment[];
 readonly workpieceFor?:(residentId:string)=>EmergencyWorkpiece|null;
}
export interface SourceOperationRequest {
 readonly routePoints:readonly VillageSitePoint[];readonly routeBody:SourceRouteBody;
 readonly workPoint:VillageSitePoint;readonly workBody:SourceRouteBody;readonly expectedGroundActor:string;
}
export interface SourceOperationProof {
 readonly sourceSha256:string;readonly profile:'desktop'|'quest';readonly groundActor:string;readonly routeKnots:number;
 readonly sourceOriginalBuffersUnchanged:true;readonly originalTriangleClearance:true;readonly wholeFootprintSupported:true;readonly architectureOverheadClear:true;
}
export interface SourceOperationActor {
 readonly sourceActor:string;readonly sourceOrdinal:number;readonly sourceWorldMatrix:readonly number[];
 readonly bounds:BuildingSourceBounds;readonly node:Object3D;
}
export interface BuildingEmergencySites {
 readonly site:VillageSiteLayout;readonly associations:readonly ResidentBuildingPlaceAssociation[];
 /** Retained original-source geometry only; no placement, clock or work credit. */
 sourceActors(name:string):readonly SourceOperationActor[];
 qualifySourceOperation(request:SourceOperationRequest,options?:{readonly signal?:AbortSignal;readonly yieldControl?:()=>Promise<void>}):Promise<SourceOperationProof>;
 stationsFor(incidents:readonly ResidentBuildingIncident[]):readonly ResidentBuildingEmergencyStation[];
 contactFor(stationId:string):EmergencyActionStation|null;
 groundHeight(x:number,z:number):number;
 fireHazardsFor(binding:SourceBuilding['binding']):readonly SourceBuildingFireHazard[];
 readonly diagnostics:{readonly sourceInstances:number;readonly associations:number;readonly waterStations:number;readonly fireStations:number;readonly repairStations:number;readonly emergencyTraversals:number;readonly emergencyRefuges:number;readonly held:readonly string[]};
 dispose():void;
}
export interface SourceBuildingFireHazard {readonly id:string;readonly sourcePartId:string;readonly bounds:BuildingSourceBounds}

type Point=readonly[number,number,number];
interface SourceInstance {actor:Mesh;ordinal:number;frame:Matrix4;bounds:Box3;ground:boolean;proxy:Mesh|null;nonRigidVegetation?:boolean;treeFamily?:boolean}
interface SourceDoor {sourceActor:string;instance:number;min:Point;max:Point;sourceWorldMatrix:readonly number[]}
interface Prepared {station:Omit<ResidentBuildingEmergencyStation,'disasterId'>;contact:EmergencyActionStation;equipment?:EmergencyRepairEquipment}
const EPS=1e-5,MAX_INSTANCES=65536,MAX_STATIONS=512;
const finitePoint=(v:unknown):v is Point=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n));
const near=(a:readonly number[],b:readonly number[],epsilon=EPS)=>a.length===b.length&&a.every((v,k)=>Number.isFinite(v)&&Math.abs(v-b[k])<=epsilon);
function door(value:unknown):SourceDoor|null {
 if(!value||typeof value!=='object')return null;const d=value as SourceDoor;
 return typeof d.sourceActor==='string'&&Number.isSafeInteger(d.instance)&&d.instance>=0&&finitePoint(d.min)&&finitePoint(d.max)&&Array.isArray(d.sourceWorldMatrix)&&d.sourceWorldMatrix.length===16&&d.sourceWorldMatrix.every(Number.isFinite)?d:null;
}
function fingerprint(value:string):string {let h=2166136261;for(let i=0;i<value.length;i++)h=Math.imul(h^value.charCodeAt(i),16777619);return(h>>>0).toString(36);}
type HullPlane=readonly[number,number,number,number];
/** Convex envelope from the already measured complete clip cylinder to the
 * padded source endpoint. A corner of its AABB is not itself a rope corridor. */
function transferHull(stand:Point,contact:Point,radius:number,height:number):readonly HullPlane[]{
 const vertices:number[][]=[];for(const y of[stand[1]+.25,stand[1]+height+.08])for(let i=0;i<12;i++){const a=i*Math.PI/6;vertices.push([stand[0]+Math.cos(a)*(radius+.08),y,stand[2]+Math.sin(a)*(radius+.08)]);}
 for(const x of[-.09,.09])for(const y of[-.09,.09])for(const z of[-.09,.09])vertices.push([contact[0]+x,contact[1]+y,contact[2]+z]);
 const result:HullPlane[]=[],seen=new Set<string>();
 for(let a=0;a<vertices.length;a++)for(let b=a+1;b<vertices.length;b++)for(let c=b+1;c<vertices.length;c++){
  const p=vertices[a],u=vertices[b].map((n,k)=>n-p[k]),v=vertices[c].map((n,k)=>n-p[k]);let x=u[1]*v[2]-u[2]*v[1],y=u[2]*v[0]-u[0]*v[2],z=u[0]*v[1]-u[1]*v[0],length=Math.hypot(x,y,z);if(length<1e-9)continue;x/=length;y/=length;z/=length;let d=-(x*p[0]+y*p[1]+z*p[2]),positive=false,negative=false;
  for(const q of vertices){const distance=x*q[0]+y*q[1]+z*q[2]+d;if(distance>1e-7)positive=true;else if(distance< -1e-7)negative=true;if(positive&&negative)break;}
  if(positive&&negative||!positive&&!negative)continue;if(positive){x=-x;y=-y;z=-z;d=-d;}const key=[x,y,z,d].map(n=>Math.round(n*1e6)).join(':');if(seen.has(key))continue;seen.add(key);result.push([x,y,z,d]);
 }
 return result;
}
function triangleMeetsHull(triangle:Triangle,planes:readonly HullPlane[]):boolean {
 let polygon:number[][]=[triangle.a.toArray(),triangle.b.toArray(),triangle.c.toArray()];
 for(const p of planes){const next:number[][]=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],da=p[0]*a[0]+p[1]*a[1]+p[2]*a[2]+p[3],db=p[0]*b[0]+p[1]*b[1]+p[2]*b[2]+p[3];if(da<=1e-7)next.push(a);if(da<=1e-7!== (db<=1e-7)){const t=da/(da-db);next.push(a.map((n,k)=>n+(b[k]-n)*t));}}if(!next.length)return false;polygon=next;}return true;
}
function tubeHull(from:Point,to:Point,padding:number):readonly HullPlane[]{
 const direction=new Vector3().fromArray(to).sub(new Vector3().fromArray(from)).normalize(),side=new Vector3().crossVectors(direction,Math.abs(direction.y)<.99?new Vector3(0,1,0):new Vector3(1,0,0)).normalize(),up=new Vector3().crossVectors(direction,side).normalize(),start=new Vector3().fromArray(from),end=new Vector3().fromArray(to),result:HullPlane[]=[];
 for(const axis of[side,up]){const d=axis.dot(start);result.push([axis.x,axis.y,axis.z,-d-padding],[-axis.x,-axis.y,-axis.z,d-padding]);}result.push([direction.x,direction.y,direction.z,-direction.dot(end)-padding],[-direction.x,-direction.y,-direction.z,direction.dot(start)-padding]);return result;
}
function measuredClip(evidence:PopulationMotionEvidence,sourceEvidence:PopulationMotionEvidence,residentId:string,clip:string,site:VillageSiteLayout):{radius:number;height:number}|null {
 const art=getPopulationArt(residentId),level=evidence.residents[residentId]?.levels.crowd,sourceLevel=sourceEvidence.residents[residentId]?.levels.crowd,c=level?.clips[clip];if(!art||art.kind!=='crowd'||!level||!c||!sourceLevel?.clips[clip]||JSON.stringify(c)!==JSON.stringify(sourceLevel.clips[clip])||!art.motions.roleClips.includes(clip))return null;
 const paths=[art.levels[0].path,art.manifest,art.clipLibrary?.path,'aethelgard/characters/crowd-v1/props/crowd-props-'+(clip==='carry_bucket_walk'?'everyday':'workplace')+'-v1.glb','aethelgard/characters/crowd-v1/props/crowd-props-'+(clip==='carry_bucket_walk'?'everyday':'craft')+'-v1.glb','aethelgard/characters/crowd-v1/props/kits.json'];
 for(const path of paths){if(!path)return null;const relative=path.replace(/^aethelgard\/characters\//u,'');if(!EALDHOLT_POPULATION_ASSET_SHA256[relative]||level.files[relative]!==EALDHOLT_POPULATION_ASSET_SHA256[relative]||sourceLevel.files[relative]!==level.files[relative])return null;}
 if(c.placedBelowGround||c.minimumBodyYMetres<-.005||c.radiusMetres>site.capsule.radius-.005||c.heightMetres>site.capsule.height-.005)return null;
 return{radius:c.radiusMetres,height:c.heightMetres};
}

/** CPU raycasts borrow original attributes in private wrappers. Source draw
 * ranges, instance counts and visibility never own contact qualification. */
export function createBuildingEmergencySites(input:BuildingEmergencySitesInput):BuildingEmergencySites {
 const task=authorBuildingEmergencySites(input);let step=task.next();while(!step.done)step=task.next();return step.value;
}
/** Runtime admission yields between bounded CPU cohorts and can be cancelled
 * when the source/view retires. This scheduler never advances a world clock. */
export async function createBuildingEmergencySitesAsync(input:BuildingEmergencySitesInput,options:{readonly signal?:AbortSignal;readonly yieldControl?:()=>Promise<void>}={}):Promise<BuildingEmergencySites>{
 const task=authorBuildingEmergencySites(input),yieldControl=options.yieldControl??(()=>new Promise<void>(resolve=>setTimeout(resolve,0)));let started=performance.now(),firstYield=true;
 try{while(true){if(options.signal?.aborted)throw Error('Emergency source authoring cancelled.');const step=task.next();if(step.done)return step.value;if(firstYield||performance.now()-started>=6){firstYield=false;await yieldControl();started=performance.now();}}}finally{task.return(undefined as never);}
}
function* authorBuildingEmergencySites(input:BuildingEmergencySitesInput):Generator<void,BuildingEmergencySites,unknown> {
 const original=input.site,held:string[]=[],instances:SourceInstance[]=[],wrappers:BufferGeometry[]=[],material=new MeshBasicMaterial({side:DoubleSide}),ray=new Raycaster(),point=new Vector3(),instanceMatrix=new Matrix4(),baseBounds=new Map<BufferGeometry,Box3>(),triangle=new Triangle();
 const region=new Box3();for(const anchor of original.anchors)region.expandByPoint(point.fromArray(anchor.sourceGroundPoint));if(input.profile==='desktop'&&input.sourceSha256===refugeCandidate.sourceSha256&&input.siteIdentity===refugeCandidate.siteSha256)for(const route of refugeCandidate.routes)for(const p of route.points)region.expandByPoint(point.fromArray(p));if(input.profile==='desktop'&&input.sourceSha256===brewsterResponse.sourceSha256&&input.siteIdentity===brewsterResponse.siteSha256){for(const p of brewsterResponse.sourceGroundPolyline)region.expandByPoint(point.fromArray(p));for(const p of brewsterResponse.fireOperation.route.sourceGroundPolyline)region.expandByPoint(point.fromArray(p));}region.expandByScalar(8);region.min.y=-Infinity;region.max.y=Infinity;
 let taggedSource=false;input.sourceRoot.traverse(node=>{const source=node.userData.crownfallElderbloom;if(Number.isFinite(source?.cellX)&&Number.isFinite(source?.cellZ))taggedSource=true;});
 const referencedActors=new Set(input.buildings.flatMap(b=>b.parts.flatMap(p=>p.sourceActor?[p.sourceActor]:[])));
 let disposed=false,complete=false,sourceWork=0,stationWork=0,terrainIndex:SourceTerrainRaycastIndex|null=null;
 try {
 function* collect(node:Object3D,parent:Matrix4,isRoot=false):Generator<void,void,unknown> {
  const frame=isRoot?new Matrix4():parent.clone().multiply(node.matrix);
  let authored=!taggedSource||/^LandscapeComponent/u.test(node.name)||referencedActors.has(node.name);for(let parent:Object3D|null=node;parent&&!authored;parent=parent.parent){const source=parent.userData.crownfallElderbloom;authored=Number.isFinite(source?.cellX)&&Number.isFinite(source?.cellZ);}
  if(authored&&node instanceof Mesh&&node.geometry.getAttribute('position')&&!('isSkinnedMesh'in node)&&!Object.keys(node.geometry.morphAttributes).length){
   let box=baseBounds.get(node.geometry);if(!box){box=staticSourceBounds(node.geometry);baseBounds.set(node.geometry,box);}
   const count=node instanceof InstancedMesh?node.instanceMatrix.count:1;
   for(let ordinal=0;ordinal<count;ordinal++){
    if(++sourceWork%128===0)yield;
    const placed=frame.clone();if(node instanceof InstancedMesh){node.getMatrixAt(ordinal,instanceMatrix);placed.multiply(instanceMatrix);}const bounds=box.clone().applyMatrix4(placed);
    if(!bounds.intersectsBox(region))continue;if(instances.length>=MAX_INSTANCES)throw Error('Emergency source inspection exceeds its bounded instance budget.');
    let groundcover=false,treeFamily=false;for(let parent:Object3D|null=node;parent;parent=parent.parent){groundcover ||= parent.userData.crownfallElderbloom?.kind==='groundcover';treeFamily ||= parent.userData.crownfallElderbloom?.kind==='tree'||/^SM_BlackAlder_/iu.test(parent.name);}
    instances.push({actor:node,ordinal,frame:placed,bounds,ground:/^LandscapeComponent/u.test(node.name),proxy:null,nonRigidVegetation:groundcover||/Grass|flower|Daisy|Poppy|Shrub|Leaves/iu.test(node.name),treeFamily});
   }
  }
  for(const child of node.children)yield*collect(child,frame);
 }
 yield*collect(input.sourceRoot,new Matrix4(),true);yield;
 const sourceRows=new Map<string,SourceInstance[]>(),buildingRows=new Map<string,readonly SourceInstance[]>();for(const row of instances){const key=row.actor.name+'\u0000'+row.ordinal,list=sourceRows.get(key)??[];list.push(row);sourceRows.set(key,list);}
 function rowsForBuilding(building:SourceBuilding):readonly SourceInstance[]{const key=buildingDamageKey(building.binding),old=buildingRows.get(key);if(old)return old;const rows=new Set<SourceInstance>();for(const part of building.parts){if(part.sourceActor===undefined||part.sourceOrdinal===undefined||!part.sourceWorldMatrix){buildingRows.set(key,[]);return[];}const matches=(sourceRows.get(part.sourceActor+'\u0000'+part.sourceOrdinal)??[]).filter(row=>near(row.frame.elements,part.sourceWorldMatrix!)&&near(row.bounds.min.toArray(),part.bounds.min)&&near(row.bounds.max.toArray(),part.bounds.max));if(matches.length!==1){buildingRows.set(key,[]);return[];}rows.add(matches[0]);}const result=[...rows];buildingRows.set(key,result);return result;}
 function proxy(row:SourceInstance):Mesh {
  if(row.proxy)return row.proxy;const source=row.actor.geometry,g=new BufferGeometry();for(const[name,a]of Object.entries(source.attributes))g.setAttribute(name,a);g.setIndex(source.index);
  g.setDrawRange(0,source.index?.count??source.getAttribute('position').count);g.boundingBox=baseBounds.get(source)!.clone();g.computeBoundingSphere();wrappers.push(g);
  const mesh=new Mesh(g,material);mesh.matrixAutoUpdate=false;mesh.matrixWorld.copy(row.frame);row.proxy=mesh;return mesh;
 }
 function matches(d:SourceDoor):SourceInstance[] {return instances.filter(row=>row.actor.name===d.sourceActor&&row.ordinal===d.instance&&near(row.frame.elements,d.sourceWorldMatrix)&&near(row.bounds.min.toArray(),d.min)&&near(row.bounds.max.toArray(),d.max));}
 function intersectsSourceBox(row:SourceInstance,box:Box3,hull:readonly HullPlane[]):boolean {
  if(!row.bounds.intersectsBox(box))return false;const g=row.actor.geometry,p=g.getAttribute('position'),index=g.index,count=index?.count??p.count;
  const materials=Array.isArray(row.actor.material)?row.actor.material:[row.actor.material],groups=g.groups.length?g.groups:[{start:0,count,materialIndex:0}];
  for(const group of groups){const material=materials[group.materialIndex??0];if(!material||row.nonRigidVegetation||row.treeFamily&&material.side===DoubleSide||/BlackAlder.*TwoSided/iu.test(material.name)||material.transparent&&material.opacity<.99||/water|pond|sea/iu.test(material.name))continue;
   for(let i=group.start;i+2<Math.min(count,group.start+group.count);i+=3){triangle.a.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(row.frame);triangle.b.fromBufferAttribute(p,index?index.getX(i+1):i+1).applyMatrix4(row.frame);triangle.c.fromBufferAttribute(p,index?index.getX(i+2):i+2).applyMatrix4(row.frame);if(box.intersectsTriangle(triangle)&&triangleMeetsHull(triangle,hull))return true;}}return false;
 }
 function firstHit(from:Point,to:Point,rows:readonly SourceInstance[],verticalTerrain=false):{point:Point;row:SourceInstance}|null {
  ray.set(new Vector3().fromArray(from),new Vector3().fromArray(to).sub(new Vector3().fromArray(from)).normalize());ray.near=0;ray.far=Math.hypot(...to.map((n,k)=>n-from[k]));let distance=Infinity,result:{point:Point;row:SourceInstance}|null=null;
  for(const row of rows){if(!ray.ray.intersectsBox(row.bounds))continue;const full=proxy(row),mesh=verticalTerrain?terrainIndex?.meshFor(row,from[0],from[2],full)??(terrainIndex?null:full):full;if(!mesh)continue;const hit=ray.intersectObject(mesh,false)[0];if(hit&&hit.distance<distance){distance=hit.distance;result={point:hit.point.toArray()as[number,number,number],row};}}
  return result;
 }
 function tubeClear(points:readonly Point[],allowed:readonly SourceInstance[]):boolean {
  const ignored=new Set(allowed);for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],box=new Box3(new Vector3().fromArray(a),new Vector3().fromArray(a)).expandByPoint(new Vector3().fromArray(b)).expandByScalar(.12),hull=tubeHull(a,b,.08);
   for(const row of instances)if(!row.ground&&!ignored.has(row)&&intersectsSourceBox(row,box,hull))return false;}return true;
 }
 const terrain=instances.filter(row=>row.ground),groundCache=new Map<string,number>();
 terrainIndex=yield*prepareSourceTerrainRaycastIndex(terrain);
 function groundHeight(x:number,z:number):number {
  if(disposed||!Number.isFinite(x)||!Number.isFinite(z))return NaN;const key=`${x}:${z}`,cached=groundCache.get(key);if(cached!==undefined)return cached;
  const candidates=terrain.filter(row=>x>=row.bounds.min.x-EPS&&x<=row.bounds.max.x+EPS&&z>=row.bounds.min.z-EPS&&z<=row.bounds.max.z+EPS);let y=NaN;
  if(candidates.length){const max=Math.max(...candidates.map(row=>row.bounds.max.y)),min=Math.min(...candidates.map(row=>row.bounds.min.y)),hit=firstHit([x,max+1,z],[x,min-1,z],candidates,true);if(hit)y=hit.point[1];}
  if(groundCache.size>=2048)groundCache.delete(groundCache.keys().next().value!);groundCache.set(key,y);return y;
 }
 function* qualifyOperation(request:SourceOperationRequest):Generator<void,SourceOperationProof,unknown>{
  const{routePoints,routeBody,workPoint,workBody,expectedGroundActor}=request;
  if(disposed||!valid||routePoints.length<2||routePoints.length>4096||!finitePoint(workPoint)||routePoints.some(p=>!finitePoint(p))||!expectedGroundActor
   ||[routeBody,workBody].some(b=>!b||![b.radius,b.height,b.margin,b.lift].every(Number.isFinite)||b.radius<=0||b.radius>4||b.height<=0||b.height>8||b.margin!==.005||b.lift!==.02))throw Error('Operation needs finite bounded original-source bodies and route.');
  const queryPoints=[...routePoints,workPoint],radius=Math.max(routeBody.radius,workBody.radius)+.005;
  const patch:SourceRouteBox={min:[Math.min(...queryPoints.map(p=>p[0]))-radius-2,-Infinity,Math.min(...queryPoints.map(p=>p[2]))-radius-2],max:[Math.max(...queryPoints.map(p=>p[0]))+radius+2,Infinity,Math.max(...queryPoints.map(p=>p[2]))+radius+2]};
  if(patch.min[0]<region.min.x||patch.max[0]>region.max.x||patch.min[2]<region.min.z||patch.max[2]>region.max.z)throw Error('Operation leaves retained original source coverage.');
  const boxes=routePoints.slice(1).map((b,i)=>sourceRouteSegmentBox(routePoints[i],b,routeBody.radius+.005,Math.min(routePoints[i][1],b[1])+.005,Math.max(routePoints[i][1],b[1])+routeBody.height+.025));
  boxes.push(sourceRouteSegmentBox(workPoint,workPoint,workBody.radius+.005,workPoint[1]+.005,workPoint[1]+workBody.height+.025));
  const overheadBoxes=routePoints.slice(1).map((b,i)=>sourceRouteSegmentBox(routePoints[i],b,routeBody.radius+.005,Math.min(routePoints[i][1],b[1])+.005,Infinity));overheadBoxes.push(sourceRouteSegmentBox(workPoint,workPoint,workBody.radius+.005,workPoint[1]+.005,Infinity));
  const ground:SourceRouteTriangle[]=[],rigid:SourceRouteTriangle[]=[],architecture:SourceRouteTriangle[]=[],water:SourceRouteBox[]=[];let visited=0;
  for(const row of instances){yield;const rowBox:SourceRouteBox={min:row.bounds.min.toArray()as[number,number,number],max:row.bounds.max.toArray()as[number,number,number]};if(!sourceRouteBoxesOverlap(rowBox,patch))continue;
   const geometry=row.actor.geometry,position=geometry.getAttribute('position'),index=geometry.index,count=index?.count??position.count,materials=Array.isArray(row.actor.material)?row.actor.material:[row.actor.material],groups=geometry.groups.length?geometry.groups:[{start:0,count,materialIndex:0}];
   for(const group of groups){const mat=materials[group.materialIndex??0];if(!mat)throw Error('Operation source material is unavailable.');const isWater=/water|pond|sea/iu.test(mat.name),isRigid=!row.ground&&!isWater&&!row.nonRigidVegetation&&!(row.treeFamily&&mat.side===DoubleSide)&&!/BlackAlder.*TwoSided/iu.test(mat.name)&&!(mat.transparent&&mat.opacity<.99),isArchitecture=isRigid&&!row.treeFamily;
    if(!row.ground&&!isWater&&(!isRigid||!boxes.some(b=>sourceRouteBoxesOverlap(rowBox,b))&&(!isArchitecture||!overheadBoxes.some(b=>sourceRouteBoxesOverlap(rowBox,b)))))continue;
    const waterMin:[number,number,number]=[Infinity,Infinity,Infinity],waterMax:[number,number,number]=[-Infinity,-Infinity,-Infinity];
    for(let i=group.start;i+2<Math.min(count,group.start+group.count);i+=3){if(++visited%512===0)yield;if(visited>3000000)throw Error('Operation original-triangle visit budget exceeded.');const t=[0,1,2].map(k=>new Vector3().fromBufferAttribute(position,index?index.getX(i+k):i+k).applyMatrix4(row.frame).toArray()as[number,number,number])as unknown as SourceRouteTriangle,box=sourceRouteTriangleBox(t);
     if(isWater){for(let k=0;k<3;k++){waterMin[k]=Math.min(waterMin[k],box.min[k]);waterMax[k]=Math.max(waterMax[k],box.max[k]);}}
     else if(row.ground){if(sourceRouteBoxesOverlap(box,patch))ground.push(t);}
     else{if(isRigid&&boxes.some(b=>sourceRouteBoxesOverlap(box,b)))rigid.push(t);if(isArchitecture&&overheadBoxes.some(b=>sourceRouteBoxesOverlap(box,b)))architecture.push(t);}
     if(ground.length+rigid.length>250000||architecture.length>250000)throw Error('Operation source proof triangle budget exceeded.');
    }
    if(isWater&&Number.isFinite(waterMin[0]))water.push({min:waterMin,max:waterMax});
   }
  }
  const certify=function*(points:readonly VillageSitePoint[],body:SourceRouteBody):Generator<void,void,unknown>{for(let first=0;first<points.length-1;first+=255){const proof=qualifySourceEmergencyRefuge({ground,rigid,architecture,water,points:points.slice(first,first+256),body});let step=proof.next();while(!step.done){yield;step=proof.next();}}};
  yield*certify(routePoints,routeBody);yield*certify([workPoint,workPoint],workBody);
  const candidates=terrain.filter(row=>workPoint[0]>=row.bounds.min.x-EPS&&workPoint[0]<=row.bounds.max.x+EPS&&workPoint[2]>=row.bounds.min.z-EPS&&workPoint[2]<=row.bounds.max.z+EPS);if(!candidates.length)throw Error('Operation original ground is unavailable.');
  const hit=firstHit([workPoint[0],Math.max(...candidates.map(r=>r.bounds.max.y))+1,workPoint[2]],[workPoint[0],Math.min(...candidates.map(r=>r.bounds.min.y))-1,workPoint[2]],candidates,true);
  if(!hit||hit.row.actor.name!==expectedGroundActor||Math.abs(hit.point[1]-workPoint[1])>1e-8)throw Error('Operation source ground identity changed.');
  return Object.freeze({sourceSha256:input.sourceSha256,profile:input.profile,groundActor:hit.row.actor.name,routeKnots:routePoints.length,sourceOriginalBuffersUnchanged:true,originalTriangleClearance:true,wholeFootprintSupported:true,architectureOverheadClear:true});
 }
 let raw:any,motion:PopulationMotionEvidence|null=null,sourceMotion:PopulationMotionEvidence|null=null,valid=true;
 try{
  raw=copyObserverJSON(input.sourceMetadata);motion=parsePopulationMotionEvidence(input.motionEvidence);sourceMotion=parsePopulationMotionEvidence(raw.motionEvidence);
  const proof=original.sourceProof,b=raw.binding,c=raw.certificate;
  if(original.sourceSha256!==input.sourceSha256||original.profile!==input.profile||typeof input.siteIdentity!=='string'||!input.siteIdentity||input.siteIdentity.length>2048||b?.sourceSha256!==input.sourceSha256||b.profile!==input.profile||b.frame!==original.frame||b.capsule?.radius!==original.capsule.radius||b.capsule?.height!==original.capsule.height||c?.sourceSha256!==input.sourceSha256||c.profile!==input.profile||c.qualified!==true||c.sourceOriginalBuffersUnchanged!==true||raw.lifeSite?.sourceModelSha256!==input.sourceSha256||raw.lifeSite.sourceOriginalBuffersUnchanged!==true||!proof?.originalTriangleNarrowphase||proof.coordinateRoundingMetres!==0||proof.maximumMeasuredSeamGapMetres>proof.seamPairClosureToleranceMetres)throw Error('Exact source/site/whole-footprint evidence is unavailable.');
 }catch(error){valid=false;held.push(String(error));}
 const declared=new Map<string,{binding:SourceBuilding['binding'];sourceDoor:SourceDoor;building:SourceBuilding}>(),associations:ResidentBuildingPlaceAssociation[]=[],prepared:Prepared[]=[],contacts=new Map<string,EmergencyActionStation>(),aliases:VillageSiteLayout['residentPlaceBindings'][number][]=[];
 if(valid){
  for(const entry of raw.lifeSite.qualifiedExteriorEntrances??[]){const d=door(entry.sourceDoor);if(!d||typeof entry.anchorId!=='string'||matches(d).length!==1)continue;
   const candidates=input.buildings.filter(b=>b.binding.sourceSha256===input.sourceSha256&&b.binding.profile===input.profile&&b.parts.some(p=>p.kind==='door'&&p.sourceActor===d.sourceActor&&p.sourceOrdinal===d.instance&&p.sourceWorldMatrix&&near(p.sourceWorldMatrix,d.sourceWorldMatrix)&&near(p.bounds.min,d.min)&&near(p.bounds.max,d.max)));
   if(candidates.length===1&&!declared.has(entry.anchorId))declared.set(entry.anchorId,{binding:candidates[0].binding,sourceDoor:d,building:candidates[0]});else declared.delete(entry.anchorId);
  }
  for(const row of original.residentPlaceBindings){if(row.status!=='mapped-exterior'||!row.anchorId)continue;const match=declared.get(row.anchorId);if(match&&raw.lifeSite.households.some((h:any)=>h.anchorId===row.anchorId&&h.placeId===row.placeId&&door(h.sourceDoor)&&near(h.sourceDoor.sourceWorldMatrix,match.sourceDoor.sourceWorldMatrix)&&h.sourceDoor.sourceActor===match.sourceDoor.sourceActor&&h.sourceDoor.instance===match.sourceDoor.instance))associations.push({residentId:row.residentId,placeId:row.placeId,anchorId:row.anchorId,binding:match.binding,sourceDoorActor:match.sourceDoor.sourceActor,sourceDoorOrdinal:match.sourceDoor.instance});}
 }
 function corridor(anchor:VillageSiteAnchor,contact:Point,allowed:readonly SourceInstance[],radius:number,height:number):BuildingSourceBounds|null {
  const min:[number,number,number]=[Math.min(anchor.sourceGroundPoint[0]-radius-.08,contact[0]-.09),Math.min(anchor.sourceGroundPoint[1]+.25,contact[1]-.09),Math.min(anchor.sourceGroundPoint[2]-radius-.08,contact[2]-.09)];
  const max:[number,number,number]=[Math.max(anchor.sourceGroundPoint[0]+radius+.08,contact[0]+.09),Math.max(anchor.sourceGroundPoint[1]+height+.08,contact[1]+.09),Math.max(anchor.sourceGroundPoint[2]+radius+.08,contact[2]+.09)],box=new Box3(new Vector3().fromArray(min),new Vector3().fromArray(max));
  const allowedSet=new Set(allowed),hull=transferHull(anchor.sourceGroundPoint,contact,radius,height);
  // Conservative admission: no unrelated original opaque actor may intersect
  // the complete transfer box. No nearby obstacle is waived by a role name.
  for(const row of instances){if(row.ground||allowedSet.has(row)||!row.bounds.intersectsBox(box))continue;const materials=Array.isArray(row.actor.material)?row.actor.material:[row.actor.material];if(materials.every(m=>m.transparent&&m.opacity<.99)||!intersectsSourceBox(row,box,hull))continue;const reason='Transfer corridor meets original actor: '+row.actor.name;if(held.length<64&&!held.includes(reason))held.push(reason);return null;}
  return{min,max};
 }
 function add(residentId:string,kind:'water'|'fire',anchor:VillageSiteAnchor,contact:Point,row:SourceInstance,building:SourceBuilding|null,envelope:{radius:number;height:number},allowed:readonly SourceInstance[],operation?:{yaw:number;points:readonly Point[];id?:string},privateAnchor=false):void {
  if(prepared.length>=MAX_STATIONS)throw Error('Emergency stations exceed their bounded authored capacity.');const distance=Math.hypot(...contact.map((v,k)=>v-anchor.sourceGroundPoint[k]));if(distance>4)return;
  let transferBounds:BuildingSourceBounds|null;if(operation){if(!tubeClear(operation.points,allowed))return;const box=new Box3();for(const p of operation.points)box.expandByPoint(new Vector3().fromArray(p));box.expandByScalar(.1);transferBounds={min:box.min.toArray()as[number,number,number],max:box.max.toArray()as[number,number,number]};}else transferBounds=corridor(anchor,contact,allowed,envelope.radius,envelope.height);if(!transferBounds)return;
  const id=operation?.id??`disaster-${residentId}-${kind}-${fingerprint(anchor.id+':'+(building?.binding.buildingId??row.actor.name))}`,station:Prepared['station']={id,residentId,placeId:id,anchorId:anchor.id,kind,buildingKey:building?buildingDamageKey(building.binding):null,sourceActor:anchor.sourceActor,contactPoint:contact,yawRadians:operation?.yaw??Math.atan2(contact[0]-anchor.sourceGroundPoint[0],contact[2]-anchor.sourceGroundPoint[2]),clip:'carry_bucket_walk',operationWorldMinutes:1,waterUnits:20,proof:{sourceSha256:input.sourceSha256,profile:input.profile,siteIdentity:input.siteIdentity,originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:row.actor.name,maximumContactDistanceMetres:4,clip:'carry_bucket_walk'}};
  const visual:EmergencyActionStation={id,sourceId:`${input.sourceSha256}:${row.actor.name}:${row.ordinal}:${fingerprint(JSON.stringify(row.frame.elements))}`,frame:input.sourceRoot,sourceActor:row.actor,kind:kind==='water'?'water-source':'fire-surface',position:contact,residentStandPosition:anchor.sourceGroundPoint,maxStandDistanceMetres:.15,maxToolReachMetres:kind==='water'?4:.65,clearanceQualified:true,transferBounds,...(kind==='water'&&operation?{sourceStartPoint:operation.points[0],sourceWaypoints:operation.points.slice(1,-1)}:{})};
  prepared.push({station,contact:visual});contacts.set(id,visual);if(!privateAnchor)aliases.push({residentId,placeId:id,anchorId:anchor.id,status:'mapped-exterior'});
 }
 if(valid&&motion&&sourceMotion){
  // Actual pinned clip/prop evidence selects responders. A role name alone
  // cannot qualify a body, but a nearer measured adult is not excluded by ID.
  const responderIds=[...new Set(['ealdholt-brewster','ealdholt-swineherd',...Object.keys(motion.residents)])].filter(id=>getPopulationArt(id)?.motions.roleClips.includes('carry_bucket_walk'));
  for(const residentId of responderIds){
   const envelope=measuredClip(motion,sourceMotion,residentId,'carry_bucket_walk',original),pose=emergencyBucketPose0(residentId,motion.residents[residentId]?.levels.crowd?.files??{});if(!envelope||!pose){held.push(`${residentId}:source-bound carry envelope unavailable`);continue;}
   for(const item of raw.lifeSite.functionalObjectInventory??[]){const d=door(item);if(!d||!/S_Old_Stone_Well/u.test(d.sourceActor))continue;const exact=matches(d);if(exact.length!==1){held.push(d.sourceActor+':exact well source instance unavailable');continue;}const row=exact[0],cx=(d.min[0]+d.max[0])/2,cz=(d.min[2]+d.max[2])/2,top=d.max[1];
    // A real open central 24cm aperture, measured below the original rim.
    // The opening plane is a rope destination, not an invented water depth.
    let aperture=true;for(const [dx,dz]of[[0,0],[.12,0],[-.12,0],[0,.12],[0,-.12]])if(firstHit([cx+dx,top+.05,cz+dz],[cx+dx,top-.25,cz+dz],[row]))aperture=false;
    if(!aperture){held.push(`${d.sourceActor}:well aperture not proven`);continue;}
    const contents=instances.filter(other=>other!==row&&!other.ground&&other.bounds.min.x>=d.min[0]-EPS&&other.bounds.max.x<=d.max[0]+EPS&&other.bounds.min.z>=d.min[2]-EPS&&other.bounds.max.z<=d.max[2]+EPS&&other.bounds.max.y<top-.08&&other.bounds.max.y-other.bounds.min.y<=.2),water=firstHit([cx,top-.05,cz],[cx,d.min[1],cz],contents);if(!water){held.push(d.sourceActor+':original inner water surface unavailable');continue;}
    for(const anchor of original.anchors){if(++stationWork%32===0)yield;const dx=anchor.sourceGroundPoint[0]-cx,dz=anchor.sourceGroundPoint[2]-cz,horizontal=Math.hypot(dx,dz);if(horizontal>3.4||horizontal<1.5||!anchor.id.includes('well'))continue;
     const yaw=Math.atan2(-dx,-dz)-Math.atan2(pose.handle[0],pose.handle[2]),placed=new Matrix4().makeTranslation(...anchor.sourceGroundPoint).multiply(new Matrix4().makeRotationY(yaw)),start=new Vector3().fromArray(pose.handle).applyMatrix4(placed).toArray()as[number,number,number];let rim:{point:Point;row:SourceInstance}|null=null;
     for(const radius of[1.3,1.15,1,.85,.7]){const x=cx+dx/horizontal*radius,z=cz+dz/horizontal*radius,hit=firstHit([x,top+.1,z],[x,top-.25,z],[row]);if(hit&&(!rim||hit.point[1]>rim.point[1]))rim=hit;}
     if(!rim)continue;const overRim:Point=[rim.point[0],rim.point[1]+.13,rim.point[2]],overOpening:Point=[cx,rim.point[1]+.13,cz],points:Point[]=[start,overRim,overOpening,water.point],length=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(...p.map((v,k)=>v-points[i][k])),0);if(length<=4)add(residentId,'water',anchor,water.point,water.row,null,envelope,[water.row],{yaw,points});
    }
   }
   for(const building of input.buildings){if(building.binding.sourceSha256!==input.sourceSha256||building.binding.profile!==input.profile)continue;const candidates=rowsForBuilding(building);let accepted=0;
    for(const anchor of original.anchors){if(++stationWork%32===0)yield;const [x,y,z]=anchor.sourceGroundPoint,b=building.bounds,gap=Math.hypot(Math.max(0,b.min[0]-x,x-b.max[0]),Math.max(0,b.min[2]-z,z-b.max[2]));if(gap>1.2||accepted>=3)continue;
     const from:Point=[x,y+pose.mouth[1]-.04,z];let hit:{point:Point;row:SourceInstance}|null=null;for(const candidate of candidates){if(from[1]<candidate.bounds.min.y-EPS||from[1]>candidate.bounds.max.y+EPS)continue;const target:Point=[Math.max(candidate.bounds.min.x,Math.min(candidate.bounds.max.x,x)),from[1],Math.max(candidate.bounds.min.z,Math.min(candidate.bounds.max.z,z))],direction=new Vector3().fromArray(target).sub(new Vector3().fromArray(from));if(direction.length()<1e-8)continue;const end=new Vector3().fromArray(target).addScaledVector(direction.normalize(),.05).toArray()as[number,number,number],next=firstHit(from,end,[candidate]);if(next&&(!hit||Math.hypot(next.point[0]-x,next.point[2]-z)<Math.hypot(hit.point[0]-x,hit.point[2]-z)))hit=next;}
     if(!hit)continue;const yaw=Math.atan2(hit.point[0]-x,hit.point[2]-z)-Math.atan2(pose.mouth[0],pose.mouth[2]),placement=new Matrix4().makeTranslation(x,y,z).multiply(new Matrix4().makeRotationY(yaw)),mouth=new Vector3().fromArray(pose.mouth).applyMatrix4(placement).toArray()as[number,number,number];
     if(hit&&Math.hypot(hit.point[0]-x,hit.point[2]-z)>=original.capsule.radius+.005&&hit.point[1]<=mouth[1]-.03&&Math.hypot(...hit.point.map((v,k)=>v-mouth[k]))<=.65){const before=prepared.length;add(residentId,'fire',anchor,hit.point,hit.row,building,envelope,candidates,{yaw,points:[mouth,hit.point]});if(prepared.length>before)accepted++;}
    }
   }
  }
  for(const equipment of input.repairEquipment??[]){
   if(equipment.residentId!=='ealdholt-master-mason')continue;
   const envelope=measuredClip(motion,sourceMotion,equipment.residentId,'work_chisel',original),art=getPopulationArt(equipment.residentId)!,socket=emergencyWorkpieceSocket('stone-block',equipment.sourceSha256),path=equipment.assetPath.replace(/^aethelgard\/characters\//u,''),level=motion.residents[equipment.residentId]?.levels.crowd;
   if(!envelope||!socket||equipment.template.name!==socket.nodeName||equipment.clipId!==socket.clipId||!near(equipment.localContactPoint,socket.point,1e-8)||!near(equipment.contactMarkerSeconds,socket.impactSeconds,1e-8)||equipment.placementScale!==art.placementScale||equipment.localPlacementMatrix.length!==16||!equipment.localPlacementMatrix.every(Number.isFinite)||EALDHOLT_POPULATION_ASSET_SHA256[path]!==equipment.sourceSha256||level?.files[path]!==equipment.sourceSha256){held.push('Mason source workpiece identity/placement proof unavailable.');continue;}
   const required=[art.manifest,art.levels[0].path,art.clipLibrary!.path,equipment.assetPath].map(p=>p.replace(/^aethelgard\/characters\//u,''));
   if(required.some(p=>!Object.entries(equipment.files).some(([key,sha])=>key.replace(/^aethelgard\/characters\//u,'')===p&&sha===EALDHOLT_POPULATION_ASSET_SHA256[p]&&sha===level.files[p]))){held.push('Mason source workpiece files do not match measured clip.');continue;}
   // Preserve published doorway stations, then add a finite set of actual
   // exterior construction staging stands. A ruin may bury its old doorway;
   // work on the same measured stone block can continue outside that rubble.
   const placements=[...declared],stagedBuildings=new Set<string>();
   const components=new Map(original.anchors.map(a=>[a.id,a.id]));const component=(id:string):string=>{while(components.get(id)!==id)id=components.get(id)!;return id;};for(const route of original.routes){const a=component(route.from),b=component(route.to);if(a!==b)components.set(a,b);}
   for(const match of declared.values()){const key=buildingDamageKey(match.binding);if(stagedBuildings.has(key))continue;stagedBuildings.add(key);const bounds=match.building.bounds,used=new Set<string>(),chosen:VillageSiteAnchor[]=[];
    const candidates=original.anchors.map(anchor=>{const p=anchor.sourceGroundPoint,gap=Math.hypot(Math.max(bounds.min[0]-p[0],0,p[0]-bounds.max[0]),Math.max(bounds.min[2]-p[2],0,p[2]-bounds.max[2]));return{anchor,gap};}).filter(row=>row.gap>=3&&row.gap<=8&&!placements.some(([id,m])=>id===row.anchor.id&&buildingDamageKey(m.binding)===key)).sort((a,b)=>Math.abs(a.gap-6)-Math.abs(b.gap-6)||a.anchor.id.localeCompare(b.anchor.id));
    for(const row of candidates){const group=component(row.anchor.id);if(used.has(group))continue;used.add(group);chosen.push(row.anchor);if(chosen.length===3)break;}
    for(const row of candidates){if(chosen.length===3)break;if(!chosen.includes(row.anchor))chosen.push(row.anchor);}for(const anchor of chosen)placements.push([anchor.id,match]);
   }
   for(const[anchorId,match]of placements){yield;const anchor=original.anchors.find(a=>a.id===anchorId);if(!anchor)continue;
    const yaw=Math.atan2(match.building.position[0]-anchor.sourceGroundPoint[0],match.building.position[2]-anchor.sourceGroundPoint[2]),placement=new Matrix4().makeTranslation(...anchor.sourceGroundPoint).multiply(new Matrix4().makeRotationY(yaw)).scale(new Vector3().setScalar(equipment.placementScale)).multiply(new Matrix4().fromArray(equipment.localPlacementMatrix)),rows:SourceInstance[]=[];
    function piece(node:Object3D,parent:Matrix4,isRoot=false):void {const frame=isRoot?parent:parent.clone().multiply(node.matrix);if(node instanceof Mesh){const bounds=staticSourceBounds(node.geometry);baseBounds.set(node.geometry,bounds);rows.push({actor:node,ordinal:0,frame,bounds:bounds.clone().applyMatrix4(frame),ground:false,proxy:null});}for(const child of node.children)piece(child,frame);}
    piece(equipment.template,placement,true);const contact=new Vector3().fromArray(equipment.localContactPoint).applyMatrix4(placement).toArray()as[number,number,number],hit=firstHit([contact[0],contact[1]+.05,contact[2]],[contact[0],contact[1]-.05,contact[2]],rows);
    if(!hit||!near(hit.point,contact,.003)){held.push('Mason workpiece contact does not meet original published triangles.');continue;}
    const allowed=rowsForBuilding(match.building),transferBounds=corridor(anchor,contact,allowed,envelope.radius,envelope.height);if(!transferBounds)continue;
    const id=`disaster-${equipment.residentId}-repair-${fingerprint(anchor.id+':'+match.binding.buildingId)}`,proof={sourceSha256:input.sourceSha256,profile:input.profile,siteIdentity:input.siteIdentity,originalTriangleClearance:true as const,wholeFootprintSupported:true as const,sweptClipAndPropsClear:true as const,contactSourceActor:equipment.template.name,maximumContactDistanceMetres:4,clip:'work_chisel',contactKind:'published-workpiece' as const,equipmentAssetPath:equipment.assetPath,equipmentSha256:equipment.sourceSha256};
    const station:Prepared['station']={id,residentId:equipment.residentId,placeId:id,anchorId:anchor.id,kind:'repair',buildingKey:buildingDamageKey(match.binding),sourceActor:anchor.sourceActor,contactPoint:contact,yawRadians:yaw,clip:'work_chisel',operationWorldMinutes:1,waterUnits:1,proof};
    const visual:EmergencyActionStation={id,sourceId:equipment.assetPath+'@'+equipment.sourceSha256,frame:input.sourceRoot,sourceActor:equipment.template,kind:'repair-surface',position:contact,residentStandPosition:anchor.sourceGroundPoint,maxStandDistanceMetres:.15,maxToolReachMetres:.12,clearanceQualified:true,transferBounds};
    prepared.push({station,contact:visual,equipment});contacts.set(id,visual);aliases.push({residentId:equipment.residentId,placeId:id,anchorId:anchor.id,status:'mapped-exterior'});
   }
  }
 }
 const emergencyTraversals:VillageSiteEmergencyTraversal[]=[];
 // These20measured points are a proposal. Rebuild their proof from the current
 // original source buffers; cached renderer/certificate flags cannot admit it.
 if(valid&&input.profile==='desktop'&&input.sourceSha256===carryRoute.sourceSha256){
  try{
   const clip=motion!.residents[carryRoute.residentId]?.levels.crowd,sourceClip=sourceMotion!.residents[carryRoute.residentId]?.levels.crowd;
   if(input.siteIdentity!==carryRoute.siteSha256||JSON.stringify(clip?.clips[carryRoute.requiredClip])!==JSON.stringify(carryRoute.clipMeasurement)||JSON.stringify(sourceClip?.clips[carryRoute.requiredClip])!==JSON.stringify(carryRoute.clipMeasurement)||motion!.paddingMetres!==.05||sourceMotion!.paddingMetres!==.05||Object.entries(carryRoute.files).some(([path,sha])=>EALDHOLT_POPULATION_ASSET_SHA256[path]!==sha||clip?.files[path]!==sha||sourceClip?.files[path]!==sha))throw Error('Worker route source artifact/clip identity differs.');
   const from=original.anchors.find(a=>a.id===carryRoute.fromAnchorId),to=original.anchors.find(a=>a.id===carryRoute.toAnchorId),points=carryRoute.sourceGroundPolyline;
   if(!from||!to||!near(from.sourceGroundPoint,points[0],1e-9)||!near(to.sourceGroundPoint,points[points.length-1],1e-9)||!original.residentPlaceBindings.some(r=>r.residentId===carryRoute.residentId&&r.anchorId===from.id)||!prepared.some(p=>p.station.residentId===carryRoute.residentId&&p.station.kind==='water'&&p.station.anchorId===to.id))throw Error('Worker route exact existing endpoints are unavailable.');
   const body=carryRoute.body,bodyBoxes=points.slice(1).map((b,i)=>sourceRouteSegmentBox(points[i],b,body.radius+body.margin,Math.min(points[i][1],b[1])+.005,Math.max(points[i][1],b[1])+body.height+body.lift+body.margin));
   const patch:SourceRouteBox={min:[Math.min(...points.map(p=>p[0]))-2,-Infinity,Math.min(...points.map(p=>p[2]))-2],max:[Math.max(...points.map(p=>p[0]))+2,Infinity,Math.max(...points.map(p=>p[2]))+2]},ground:SourceRouteTriangle[]=[],rigid:SourceRouteTriangle[]=[],water:SourceRouteBox[]=[];let visited=0;
   for(const row of instances){yield;const rowBox:SourceRouteBox={min:row.bounds.min.toArray()as[number,number,number],max:row.bounds.max.toArray()as[number,number,number]};if(!sourceRouteBoxesOverlap(rowBox,patch))continue;
    const geometry=row.actor.geometry,position=geometry.getAttribute('position'),index=geometry.index,count=index?.count??position.count,materials=Array.isArray(row.actor.material)?row.actor.material:[row.actor.material],groups=geometry.groups.length?geometry.groups:[{start:0,count,materialIndex:0}];
    for(const group of groups){const material=materials[group.materialIndex??0];if(!material)throw Error('Worker route source material is unavailable.');const isWater=/water|pond|sea/iu.test(material.name),isRigid=!row.ground&&!isWater&&!row.nonRigidVegetation&&!(row.treeFamily&&material.side===DoubleSide)&&!/BlackAlder.*TwoSided/iu.test(material.name)&&!(material.transparent&&material.opacity<.99);if(!row.ground&&!isWater&&(!isRigid||!bodyBoxes.some(box=>sourceRouteBoxesOverlap(rowBox,box))))continue;
     const waterMin:[number,number,number]=[Infinity,Infinity,Infinity],waterMax:[number,number,number]=[-Infinity,-Infinity,-Infinity];
     for(let i=group.start;i+2<Math.min(count,group.start+group.count);i+=3){if(++visited%512===0)yield;if(visited>2000000)throw Error('Worker route source triangle visit budget exceeded.');const t=[0,1,2].map(k=>new Vector3().fromBufferAttribute(position,index?index.getX(i+k):i+k).applyMatrix4(row.frame).toArray()as[number,number,number])as unknown as SourceRouteTriangle,box=sourceRouteTriangleBox(t);
      if(isWater){for(let k=0;k<3;k++){waterMin[k]=Math.min(waterMin[k],box.min[k]);waterMax[k]=Math.max(waterMax[k],box.max[k]);}}else if(row.ground){if(sourceRouteBoxesOverlap(box,patch))ground.push(t);}else if(isRigid&&bodyBoxes.some(b=>sourceRouteBoxesOverlap(box,b)))rigid.push(t);if(ground.length+rigid.length>250000)throw Error('Worker route source triangle proof budget exceeded.');
     }
     if(isWater&&Number.isFinite(waterMin[0]))water.push({min:waterMin,max:waterMax});
    }
   }
   const proof=qualifySourceEmergencyRoute({ground,rigid,water,points,body});let step=proof.next();while(!step.done){yield;step=proof.next();}
   emergencyTraversals.push(Object.freeze({id:'ealdholt-swine-carry-home-well-v1',residentId:carryRoute.residentId,profile:'desktop',sourceSha256:input.sourceSha256,siteIdentity:input.siteIdentity,certificateSha256:carryRoute.certificateSha256,fromAnchorId:from.id,toAnchorId:to.id,reversible:true,requiredClip:carryRoute.requiredClip,sourceGroundPolyline:points,capsuleBottomPolyline:Object.freeze(points.map(p=>Object.freeze([p[0],p[1]+body.lift,p[2]])as Point)),lengthMetres:carryRoute.lengthMetres,body,files:carryRoute.files,proof:Object.freeze({sourceOriginalBuffersUnchanged:true,originalTriangleClearance:true,wholeFootprintSupported:true,publicExteriorOnly:true,carryLoopAndFixedPose0:true,unmeasuredTransitions:false})}));
  }catch(error){held.push('Worker-specific emergency route held: '+String(error));}
 }
 // A nearer actual responder retains its exact source-body and private work
 // stand. Both route and action geometry are requalified, never base aliases.
 if(valid&&motion&&sourceMotion&&input.profile==='desktop'&&input.sourceSha256===brewsterResponse.sourceSha256){
  try{
   const c=brewsterResponse,level=motion.residents[c.residentId]?.levels.crowd,authored=sourceMotion.residents[c.residentId]?.levels.crowd,pose=emergencyBucketPose0(c.residentId,level?.files??{}),envelope=measuredClip(motion,sourceMotion,c.residentId,c.requiredClip,original),op=c.fireOperation;
   if(input.siteIdentity!==c.siteSha256||!pose||!envelope||JSON.stringify(level?.clips[c.requiredClip])!==JSON.stringify(c.clipMeasurement)||JSON.stringify(authored?.clips[c.requiredClip])!==JSON.stringify(c.clipMeasurement)||motion.paddingMetres!==.05||sourceMotion.paddingMetres!==.05||Object.entries(c.files).some(([file,sha])=>EALDHOLT_POPULATION_ASSET_SHA256[file]!==sha||level?.files[file]!==sha||authored?.files[file]!==sha))throw Error('Brewster source body, bucket or clip identity changed.');
   const from=original.anchors.find(a=>a.id===c.fromAnchorId),to=original.anchors.find(a=>a.id===c.toAnchorId),connection=original.anchors.find(a=>a.id===op.route.from),courtyard=original.anchors.find(a=>a.id===c.courtyardOperation.fromAnchorId);
   if(!courtyard||courtyard.sourceActor!==c.courtyardOperation.fromSourceActor||!near(courtyard.sourceGroundPoint,c.courtyardOperation.fromSourceGroundPoint,1e-9)||!original.residentPlaceBindings.some(b=>b.residentId===c.residentId&&b.placeId==='village-courtyard'&&b.anchorId===courtyard.id))throw Error('Brewster current-routine courtyard connection changed its exact source.');
   if(!from||!to||!connection||!near(from.sourceGroundPoint,c.sourceGroundPolyline[0],1e-9)||!near(to.sourceGroundPoint,c.sourceGroundPolyline[c.sourceGroundPolyline.length-1],1e-9)||!near(connection.sourceGroundPoint,op.route.sourceGroundPolyline[0],1e-9)||!original.residentPlaceBindings.some(b=>b.residentId===c.residentId&&b.anchorId===from.id)||!prepared.some(p=>p.station.residentId===c.residentId&&p.station.kind==='water'&&p.station.anchorId===to.id))throw Error('Brewster route lost its exact original endpoints.');
   yield*qualifyOperation({routePoints:c.sourceGroundPolyline,routeBody:c.body,workPoint:to.sourceGroundPoint,workBody:c.body,expectedGroundActor:to.sourceActor});
   yield*qualifyOperation({routePoints:op.route.sourceGroundPolyline,routeBody:c.body,workPoint:op.anchor.sourceGroundPoint,workBody:c.body,expectedGroundActor:op.anchor.sourceActor});
   const neutral=c.neutralReturn,neutralLevel=neutral.motionEvidence.residents[c.residentId].levels.crowd;for(const [name,clip]of Object.entries(neutralLevel.clips))if(JSON.stringify(level?.clips[name])!==JSON.stringify(clip)||JSON.stringify(authored?.clips[name])!==JSON.stringify(clip))throw Error('Brewster source-neutral return motion changed.');
   yield*qualifyOperation({routePoints:[courtyard.sourceGroundPoint,courtyard.sourceGroundPoint],routeBody:neutral.body,workPoint:courtyard.sourceGroundPoint,workBody:neutral.body,expectedGroundActor:courtyard.sourceActor});
   for(const route of c.courtyardOperation.routes)yield*qualifyOperation({routePoints:route.sourceGroundPolyline,routeBody:c.body,workPoint:c.courtyardOperation.anchor.sourceGroundPoint,workBody:c.body,expectedGroundActor:c.courtyardOperation.anchor.sourceActor});
   const building=input.buildings.find(b=>b.binding.buildingId===op.targetBuildingId&&b.binding.sourceSha256===input.sourceSha256&&b.binding.profile===input.profile);if(!building)throw Error('Brewster target source building changed.');
   const rows=rowsForBuilding(building),yaw=op.yawRadians,placement=new Matrix4().makeTranslation(...op.anchor.sourceGroundPoint).multiply(new Matrix4().makeRotationY(yaw)),mouth=new Vector3().fromArray(pose.mouth).applyMatrix4(placement).toArray()as[number,number,number],direction=new Vector3().fromArray(op.contactPoint).sub(new Vector3().fromArray(mouth)),end=new Vector3().fromArray(op.contactPoint).addScaledVector(direction.clone().normalize(),.002).toArray()as[number,number,number],hit=firstHit(mouth,end,rows);
   if(!hit||hit.row.actor.name!==op.contactSourceActor||!near(hit.point,op.contactPoint,.003)||Math.hypot(...hit.point.map((v,k)=>v-mouth[k]))>.65||hit.point[1]>mouth[1]-.03)throw Error('Brewster original bucket mouth cannot reach the first actual source surface: '+JSON.stringify({mouth,actualActor:hit?.row.actor.name,actualPoint:hit?.point,expectedPoint:op.contactPoint,reach:hit?Math.hypot(...hit.point.map((v,k)=>v-mouth[k])):null}));
   const cap=parseVillageSiteEmergencyTraversals([{id:'ealdholt-brewster-carry-home-well-v1',residentId:c.residentId,profile:'desktop',sourceSha256:input.sourceSha256,siteIdentity:input.siteIdentity,certificateSha256:c.certificateSha256,fromAnchorId:from.id,toAnchorId:to.id,reversible:true,requiredClip:c.requiredClip,sourceGroundPolyline:c.sourceGroundPolyline,capsuleBottomPolyline:c.sourceGroundPolyline.map(p=>[p[0],p[1]+c.body.lift,p[2]]as Point),lengthMetres:c.lengthMetres,body:c.body,files:c.files,neutralReturn:c.neutralReturn,proof:{sourceOriginalBuffersUnchanged:true,originalTriangleClearance:true,wholeFootprintSupported:true,publicExteriorOnly:true,carryLoopAndFixedPose0:true,unmeasuredTransitions:false},topology:{anchors:[op.anchor,c.courtyardOperation.anchor],routes:[op.route,...c.courtyardOperation.routes],residentPlaceBindings:[{residentId:c.residentId,placeId:op.stationId,anchorId:op.anchor.id,status:'mapped-exterior'}]}}])[0];
   const before=prepared.length;add(c.residentId,'fire',op.anchor,hit.point,hit.row,building,envelope,rows,{id:op.stationId,yaw,points:[mouth,hit.point]},true);if(prepared.length===before)throw Error('Brewster actual transfer tube is obstructed.');emergencyTraversals.push(cap);
  }catch(error){held.push('Brewster source response held: '+String(error));}
 }
 const actionSite=aliases.length||emergencyTraversals.length?Object.freeze({...original,residentPlaceBindings:Object.freeze([...original.residentPlaceBindings,...aliases]),emergencyTargets:parseVillageSiteEmergencyTargets(prepared.map(p=>p.station)),...(emergencyTraversals.length?{emergencyTraversals:parseVillageSiteEmergencyTraversals(emergencyTraversals)}:{})}):original;
 validateVillageSiteEmergencyTargets(actionSite);validateVillageSiteEmergencyTraversals(actionSite);
 const emergencyRefuges:VillageSiteEmergencyRefuge[]=[];
 if(valid&&motion&&sourceMotion&&input.profile==='desktop'&&input.sourceSha256===refugeCandidate.sourceSha256){
  try{
   if(input.siteIdentity!==refugeCandidate.siteSha256||refugeCandidate.assignments.length!==15||refugeCandidate.routes.length!==15)throw Error('Refuge source layout identity is unavailable.');
   const proposals:VillageSiteEmergencyRefuge[]=[];
   for(const assignment of refugeCandidate.assignments){
    const path=refugeCandidate.routes.find(r=>r.id===assignment.routeId),art=getPopulationArt(assignment.residentId);
    if(!path||!art||art.kind!=='crowd'||path.points.length>256)throw Error('Refuge candidate lost its exact route or published actor.');
    const originalAnchor=original.anchors.find(a=>a.id===path.fromAnchorId),points=path.points;
    if(!originalAnchor||!points[0].every((v,k)=>v===originalAnchor.sourceGroundPoint[k]))throw Error('Refuge path lost its exact original connection.');
    const required=requiredVillageRefugeMotionClips(assignment.residentId),expected=assignment.motionEvidence.residents[assignment.residentId]?.levels.crowd;
    const current=motion.residents[assignment.residentId]?.levels.crowd,authored=sourceMotion.residents[assignment.residentId]?.levels.crowd;
    if(!expected||!current||!authored||Object.keys(expected.clips).sort().join('|')!==[...required].sort().join('|'))throw Error('Refuge neutral clip proposal is incomplete.');
    for(const name of required)if(JSON.stringify(current.clips[name])!==JSON.stringify(expected.clips[name])||JSON.stringify(authored.clips[name])!==JSON.stringify(expected.clips[name]))throw Error('Refuge raw neutral measurements changed: '+assignment.residentId+'/'+name);
    for(const file of requiredPopulationMotionFiles(art,'crowd'))if(expected.files[file]!==EALDHOLT_POPULATION_ASSET_SHA256[file]||current.files[file]!==expected.files[file]||authored.files[file]!==expected.files[file])throw Error('Refuge source body/props/clip bytes changed: '+file);
    const body=deriveVillageRefugeBody(assignment.motionEvidence,assignment.residentId);
    if(JSON.stringify(body)!==JSON.stringify(assignment.body)||body.radius+.005>original.capsule.radius||body.height+.025>original.capsule.height)throw Error('Refuge measured body changed or exceeds its original source budget.');
    const end=points[points.length-1],pointHit=firstHit([end[0],end[1]+.5,end[2]],[end[0],end[1]-.5,end[2]],terrain,true);
    const recoveryObstruction=recoveryWorkParkingObstruction(end,body,assignment.residentId,input.sourceSha256,input.profile);if(recoveryObstruction)throw Error('Refuge parking blocks published recovery work: '+assignment.residentId+'/'+recoveryObstruction);
    if(!pointHit||pointHit.row.actor.name!==path.sourceActor||Math.abs(pointHit.point[1]-end[1])>.00002)throw Error('Refuge endpoint no longer meets its original terrain actor.');
    if(!villageRefugeClearOfOperations(end,actionSite))throw Error('Refuge endpoint occupies an operational station or carry corridor.');
    const anchorId=path.id+'-stand',bottom=Object.freeze(points.map(p=>Object.freeze([p[0],p[1]+body.lift,p[2]])as Point)),id='ealdholt-refuge-'+assignment.residentId;
    proposals.push({id,residentId:assignment.residentId,placeId:id,anchorId,sourceActor:path.sourceActor,certificateSha256:assignment.certificateSha256,body,
     proof:{sourceSha256:input.sourceSha256,profile:input.profile,siteIdentity:input.siteIdentity,sourceGroundPoint:end,capsuleBottomPoint:bottom[bottom.length-1],originalTriangleClearance:true,wholeFootprintSupported:true,sweptIdleAndWalkClear:true,motionEvidence:assignment.motionEvidence},
     topology:{anchor:{id:anchorId,sourceActor:path.sourceActor,standingOnly:true,sourceGroundPoint:end,capsuleBottomPoint:bottom[bottom.length-1]},route:{id:path.id+'-route',from:originalAnchor.id,to:anchorId,reversible:true,sourceGroundPolyline:points,capsuleBottomPolyline:bottom,lengthMetres:path.lengthMetres}}});
   }
   // The layout is jointly admitted: a route cannot park another current,
   // exactly measured evacuee inside its source-certified swept corridor.
   const distanceToSegment=(p:Point,a:Point,b:Point)=>{const dx=b[0]-a[0],dz=b[2]-a[2],n=dx*dx+dz*dz,t=n?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[2]-a[2])*dz)/n)):0;return Math.hypot(p[0]-a[0]-t*dx,p[2]-a[2]-t*dz);};
   // Parking stays outside every original approach in the connected
   // household/lane component, including prefixes belonging to residents
   // who have not yet departed. The loaded declarations are checked here.
   const connected=new Set(proposals.map(p=>p.topology!.route.from)),queue=[...connected],adjacency=new Map<string,string[]>();
   for(const route of original.routes){adjacency.set(route.from,[...adjacency.get(route.from)??[],route.to]);adjacency.set(route.to,[...adjacency.get(route.to)??[],route.from]);}
   for(let i=0;i<queue.length;i++)for(const next of adjacency.get(queue[i])??[])if(!connected.has(next)){connected.add(next);queue.push(next);}
   for(const proposal of proposals)for(const route of original.routes)if(connected.has(route.from)&&connected.has(route.to)&&route.sourceGroundPolyline.slice(1).some((q,i)=>distanceToSegment(proposal.proof.sourceGroundPoint,route.sourceGroundPolyline[i],q)<2*original.capsule.radius-1e-7))throw Error('Refuge endpoint parks inside an original household/lane approach.');
   for(const a of proposals)for(const b of proposals)if(a!==b){
    const p=b.proof.sourceGroundPoint,line=a.topology!.route.sourceGroundPolyline;
    if(Math.hypot(a.proof.sourceGroundPoint[0]-p[0],a.proof.sourceGroundPoint[2]-p[2])<1.7-1e-7||line.slice(1).some((q,i)=>distanceToSegment(p,line[i],q)<a.body.radius+b.body.radius+a.body.margin+b.body.margin-1e-7))throw Error('Refuge layout lost its measured standing/connector separation.');
   }
   for(const proposal of proposals){
    yield;const points=proposal.topology!.route.sourceGroundPolyline,body=proposal.body;
    const patch:SourceRouteBox={min:[Math.min(...points.map(p=>p[0]))-2,-Infinity,Math.min(...points.map(p=>p[2]))-2],max:[Math.max(...points.map(p=>p[0]))+2,Infinity,Math.max(...points.map(p=>p[2]))+2]};
    const boxes=points.slice(1).map((b,i)=>sourceRouteSegmentBox(points[i],b,body.radius+body.margin,Math.min(points[i][1],b[1])+.005,Math.max(points[i][1],b[1])+body.height+body.lift+body.margin));
    const columns=boxes.map(b=>({min:b.min,max:[b.max[0],Infinity,b.max[2]]as Point})),bins=new Map<string,number[]>();
    for(let i=0;i<boxes.length;i++){const b=boxes[i];for(let x=Math.floor(b.min[0]/4);x<=Math.floor(b.max[0]/4);x++)for(let z=Math.floor(b.min[2]/4);z<=Math.floor(b.max[2]/4);z++){const key=x+':'+z,list=bins.get(key)??[];list.push(i);bins.set(key,list);}}
    const nearby=(box:SourceRouteBox,overhead=false):boolean=>{const x0=Math.floor(box.min[0]/4),x1=Math.floor(box.max[0]/4),z0=Math.floor(box.min[2]/4),z1=Math.floor(box.max[2]/4),candidates=overhead?columns:boxes;
     if((x1-x0+1)*(z1-z0+1)>128)return candidates.some(b=>sourceRouteBoxesOverlap(box,b));
     for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++)for(const i of bins.get(x+':'+z)??[])if(sourceRouteBoxesOverlap(box,candidates[i]))return true;return false;};
    const ground:SourceRouteTriangle[]=[],rigid:SourceRouteTriangle[]=[],architecture:SourceRouteTriangle[]=[],water:SourceRouteBox[]=[];let visited=0;
    const min:[number,number,number]=[0,0,0],max:[number,number,number]=[0,0,0],box:SourceRouteBox={min,max};
    for(const row of instances){yield;const rowBox:SourceRouteBox={min:row.bounds.min.toArray()as Point,max:row.bounds.max.toArray()as Point};if(!sourceRouteBoxesOverlap(rowBox,patch))continue;
     const geometry=row.actor.geometry,position=geometry.getAttribute('position'),index=geometry.index,count=index?.count??position.count,materials=Array.isArray(row.actor.material)?row.actor.material:[row.actor.material],groups=geometry.groups.length?geometry.groups:[{start:0,count,materialIndex:0}];
     for(const group of groups){const material=materials[group.materialIndex??0];if(!material)throw Error('Refuge source material is unavailable.');const isWater=/water|pond|sea/iu.test(material.name),isRigid=!row.ground&&!isWater&&!row.nonRigidVegetation&&!(row.treeFamily&&material.side===DoubleSide)&&!/BlackAlder.*TwoSided/iu.test(material.name)&&!(material.transparent&&material.opacity<.99),isArchitecture=isRigid&&!row.treeFamily;
      if(!row.ground&&!isWater&&(!isRigid||!nearby(rowBox,isArchitecture)))continue;
      const waterMin:[number,number,number]=[Infinity,Infinity,Infinity],waterMax:[number,number,number]=[-Infinity,-Infinity,-Infinity];
      for(let n=group.start;n+2<Math.min(count,group.start+group.count);n+=3){if(++visited%512===0)yield;
       triangle.a.fromBufferAttribute(position,index?index.getX(n):n).applyMatrix4(row.frame);triangle.b.fromBufferAttribute(position,index?index.getX(n+1):n+1).applyMatrix4(row.frame);triangle.c.fromBufferAttribute(position,index?index.getX(n+2):n+2).applyMatrix4(row.frame);
       for(let k=0;k<3;k++){min[k]=Math.min(triangle.a.getComponent(k),triangle.b.getComponent(k),triangle.c.getComponent(k));max[k]=Math.max(triangle.a.getComponent(k),triangle.b.getComponent(k),triangle.c.getComponent(k));}
       if(isWater){for(let k=0;k<3;k++){waterMin[k]=Math.min(waterMin[k],min[k]);waterMax[k]=Math.max(waterMax[k],max[k]);}continue;}
       const onGround=row.ground&&sourceRouteBoxesOverlap(box,patch),bodyHit=isRigid&&nearby(box),roofHit=isArchitecture&&nearby(box,true);if(!onGround&&!bodyHit&&!roofHit)continue;
       const t:SourceRouteTriangle=[triangle.a.toArray()as Point,triangle.b.toArray()as Point,triangle.c.toArray()as Point];if(onGround)ground.push(t);if(bodyHit)rigid.push(t);if(roofHit)architecture.push(t);
       if(ground.length+rigid.length>250000||architecture.length>250000)throw Error('Refuge exact source triangle proof budget exceeded.');
      }
      if(isWater&&Number.isFinite(waterMin[0]))water.push({min:waterMin,max:waterMax});
     }
    }
    const proof=qualifySourceEmergencyRefuge({ground,rigid,architecture,water,points,body});let step=proof.next();while(!step.done){yield;step=proof.next();}
   }
   emergencyRefuges.push(...parseVillageSiteEmergencyRefuges(proposals));
  }catch(error){held.push('Source-qualified emergency refuges held: '+String(error));}
 }
 const site=emergencyRefuges.length?Object.freeze({...actionSite,emergencyRefuges:Object.freeze(emergencyRefuges)}):actionSite;
 validateVillageSiteEmergencyRefuges(site);

 const fireHazards=new Map<string,readonly SourceBuildingFireHazard[]>();let totalHazards=0;
 const overlapsPath=(bounds:BuildingSourceBounds,path:readonly Point[]):boolean=>{
  for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i];let low=0,high=1;for(let k=0;k<3;k++){const min=bounds.min[k]-(k===1?original.capsule.height:original.capsule.radius),max=bounds.max[k]+(k===1?0:original.capsule.radius),delta=b[k]-a[k];if(Math.abs(delta)<1e-7){if(a[k]<min||a[k]>max){low=2;break;}}else{const first=(min-a[k])/delta,last=(max-a[k])/delta;low=Math.max(low,Math.min(first,last));high=Math.min(high,Math.max(first,last));}}if(low<=high&&low<=1&&high>=0)return true;}return false;
 };
 type TriBounds={min:Point;max:Point;vertices:readonly Point[]};type FireGroup={partId:string;bounds:BuildingSourceBounds;triangles:TriBounds[]|null};
 const triangleBounds=(vertices:readonly Point[]):TriBounds=>({min:[Math.min(...vertices.map(p=>p[0])),Math.min(...vertices.map(p=>p[1])),Math.min(...vertices.map(p=>p[2]))],max:[Math.max(...vertices.map(p=>p[0])),Math.max(...vertices.map(p=>p[1])),Math.max(...vertices.map(p=>p[2]))],vertices});
 const union=(triangles:readonly TriBounds[]):BuildingSourceBounds=>{const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];for(const t of triangles)for(let k=0;k<3;k++){min[k]=Math.min(min[k],t.min[k]);max[k]=Math.max(max[k],t.max[k]);}return{min,max};};
 // Every output box still contains its complete original triangle subset.
 // Refine only empty source space near already certified response routes;
 // the exact same resulting volumes apply to every resident and role.
 for(const building of input.buildings){yield;const key=buildingDamageKey(building.binding),references:readonly Point[][]=prepared.filter(p=>p.station.kind==='fire'&&p.station.buildingKey===key).flatMap(f=>prepared.filter(w=>w.station.kind==='water'&&w.station.residentId===f.station.residentId).flatMap(w=>{const route=site.emergencyTraversals?.find(r=>r.residentId===f.station.residentId),scope=route?scopedVillageEmergencyTraversalSite(site,{id:route.id,certificateSha256:route.certificateSha256,requiredClip:route.requiredClip},route.residentId):site,path=scope&&resolveVillageSitePath(scope,w.station.placeId,f.station.placeId,f.station.residentId);return path?[Array.from(path.sourceGroundPolyline)]:[];})),rows=rowsForBuilding(building),groups:FireGroup[]=building.parts.map(p=>({partId:p.id,bounds:p.bounds,triangles:null}));
  let triangleBudget=200000;
  if(valid&&references.length)for(const group of groups){if(!references.some(path=>overlapsPath(group.bounds,path)))continue;const part=building.parts.find(p=>p.id===group.partId)!,row=rows.find(r=>r.actor.name===part.sourceActor&&r.ordinal===part.sourceOrdinal&&part.sourceWorldMatrix&&near(r.frame.elements,part.sourceWorldMatrix));if(!row)continue;
   const g=row.actor.geometry,position=g.getAttribute('position'),index=g.index,count=index?.count??position.count,triangles:TriBounds[]=[];if(count/3>triangleBudget)continue;
   for(let i=0;i+2<count;i+=3){if(i%1536===0)yield;const vertices=[i,i+1,i+2].map(n=>new Vector3().fromBufferAttribute(position,index?index.getX(n):n).applyMatrix4(row.frame).toArray()as[number,number,number]);triangles.push(triangleBounds(vertices));}
   triangleBudget-=triangles.length;group.triangles=triangles;group.bounds=union(triangles);
  }
  while(groups.length<128&&totalHazards+groups.length<3500){yield;let selected=-1,score=-1;for(let i=0;i<groups.length;i++){const group=groups[i];if(!group.triangles||!group.triangles.length||!references.some(path=>overlapsPath(group.bounds,path)))continue;const size=Math.max(...group.bounds.max.map((v,k)=>v-group.bounds.min[k]));if(size>.01&&size>score){score=size;selected=i;}}
   if(selected<0)break;const group=groups[selected],triangles=group.triangles!;let left:TriBounds[],right:TriBounds[];
   if(triangles.length===1){const v=triangles[0].vertices,lengths=[0,1,2].map(k=>Math.hypot(...v[k].map((n,j)=>n-v[(k+1)%3][j]))),edge=lengths.indexOf(Math.max(...lengths)),a=v[edge],b=v[(edge+1)%3],c=v[(edge+2)%3],middle:Point=[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2];left=[triangleBounds([a,middle,c])];right=[triangleBounds([middle,b,c])];}
   else{const mins=[Infinity,Infinity,Infinity],maxs=[-Infinity,-Infinity,-Infinity];for(const t of triangles)for(let k=0;k<3;k++){const centre=(t.min[k]+t.max[k])/2;mins[k]=Math.min(mins[k],centre);maxs[k]=Math.max(maxs[k],centre);}const spreads=maxs.map((v,k)=>v-mins[k]),axis=spreads.indexOf(Math.max(...spreads));triangles.sort((a,b)=>(a.min[axis]+a.max[axis])-(b.min[axis]+b.max[axis]));const half=Math.floor(triangles.length/2);left=triangles.slice(0,half);right=triangles.slice(half);}
   groups.splice(selected,1,{partId:group.partId,bounds:union(left),triangles:left},{partId:group.partId,bounds:union(right),triangles:right});
  }
  const admitted=groups.length<=128&&totalHazards+groups.length<=3500?groups:[{partId:'source-building:'+building.binding.buildingId,bounds:building.bounds,triangles:null}];
  const volumes=Object.freeze(admitted.map((g,i)=>Object.freeze({id:`source-fire-${fingerprint(key+':'+g.partId)}-${i}`,sourcePartId:g.partId,bounds:Object.freeze({min:Object.freeze([...g.bounds.min])as unknown as Point,max:Object.freeze([...g.bounds.max])as unknown as Point})})));fireHazards.set(key,volumes);totalHazards+=volumes.length;
 }
 const diagnostics=Object.freeze({sourceInstances:instances.length,associations:associations.length,waterStations:prepared.filter(p=>p.station.kind==='water').length,fireStations:prepared.filter(p=>p.station.kind==='fire').length,repairStations:prepared.filter(p=>p.station.kind==='repair').length,emergencyTraversals:emergencyTraversals.length,emergencyRefuges:emergencyRefuges.length,held:Object.freeze(held)});
 complete=true;
 return{site,associations:Object.freeze(associations),diagnostics,groundHeight,sourceActors(name){if(disposed)return[];return Object.freeze(instances.filter(row=>row.actor.name===name).map(row=>Object.freeze({sourceActor:row.actor.name,sourceOrdinal:row.ordinal,sourceWorldMatrix:Object.freeze([...row.frame.elements]),bounds:Object.freeze({min:Object.freeze(row.bounds.min.toArray())as Point,max:Object.freeze(row.bounds.max.toArray())as Point}),node:row.actor})));},async qualifySourceOperation(request,options={}){const task=qualifyOperation(copyObserverJSON(request)as unknown as SourceOperationRequest),yieldControl=options.yieldControl??(()=>new Promise<void>(resolve=>setTimeout(resolve,0)));let since=performance.now();try{while(true){if(options.signal?.aborted||disposed)throw Error('Original-source operation qualification cancelled.');const step=task.next();if(step.done)return step.value;if(performance.now()-since>=6){await yieldControl();since=performance.now();}}}finally{task.return(undefined as never);}},fireHazardsFor(binding){return disposed?[]:fireHazards.get(buildingDamageKey(binding))??[];},stationsFor(incidents){if(disposed)return[];const result:ResidentBuildingEmergencyStation[]=[];for(const incident of incidents)if(incident.binding.sourceSha256===input.sourceSha256&&incident.binding.profile===input.profile)for(const p of prepared)if((p.station.kind==='repair'?incident.requiresRepair&&!incident.burning:incident.burning)&&(p.station.kind==='water'||p.station.buildingKey===buildingDamageKey(incident.binding)))result.push(Object.freeze({...p.station,disasterId:incident.id}));return Object.freeze(result);},contactFor(id){if(disposed)return null;const item=prepared.find(p=>p.station.id===id);if(!item?.equipment)return contacts.get(id)??null;const actual=input.workpieceFor?.(item.station.residentId);return actual&&actual.sourceAssetId===item.contact.sourceId&&actual.clipId==='work_chisel'&&actual.node.name===item.equipment.template.name?{...item.contact,sourceActor:actual.node,workpiece:actual}:null;},dispose(){if(disposed)return;disposed=true;terrainIndex?.dispose();for(const g of wrappers)g.dispose();material.dispose();groundCache.clear();contacts.clear();fireHazards.clear();}};
 }finally{if(!complete){disposed=true;terrainIndex?.dispose();for(const g of wrappers)g.dispose();material.dispose();}}
}

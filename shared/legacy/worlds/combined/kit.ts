import { createArchitectureKit } from './architecture.js';
import { createMonolithKit } from './monolith.js';
import { batchFixedCity } from './batch.js';
import { createEstateContact } from './contact';
import { createCrownfallEstateWater } from './alpine.js';
import { createSourceGroundCover } from './ground-cover.js';
import { COMBINED_WORLD_SOURCES } from './provenance';
import type { CombinedBuildingKind,CombinedBuildingSpec,CombinedSourceInfo } from './provenance';
import { AUTUMN_SETTLEMENT_BUILDINGS,settlementShore } from '../../environment/settlement/layout';
import { settlementTreeSites } from '../../environment/settlement/nature';
import { SETTLEMENT_LIGHTING,SETTLEMENT_SUN_DIRECTION } from '../../environment/settlement/lighting';

export interface CombinedWorldKitOptions {THREE:any;profile:'desktop'|'quest';quality?:'low'|'medium'|'high';groundAt:(x:number,z:number)=>number;/** Actual platform-uploaded static meshes; mixed batches are filtered by landmarkId=1. */hostManorObjects?:()=>readonly any[]}
/** One compact source asset kit in the current estate. The app retains its
 * renderer, loop, camera, house state and navigation. No full upstream world,
 * upstream menu, streamer or audio system is started. */
export function createCombinedWorldKit(options:CombinedWorldKitOptions){
 const T=options.THREE,root=new T.Group();root.name='Crownfall combined source estate';
 if(options.profile==='quest'){const light=SETTLEMENT_LIGHTING.native,hemi=new T.HemisphereLight(light.skyColour,light.groundColour,light.hemisphereIntensity),sun=new T.DirectionalLight(SETTLEMENT_LIGHTING.sun.colour,light.keyIntensity);sun.position.fromArray(SETTLEMENT_SUN_DIRECTION).multiplyScalar(light.keyDistance);sun.target.position.set(0,0,0);sun.castShadow=false;root.add(hemi,sun,sun.target);}
 const architecture=createArchitectureKit({THREE:T,profile:options.profile});
 const water=createCrownfallEstateWater({THREE:T,profile:options.profile,waterLevel:.55});root.add(water.root);
 const nature=createMonolithKit({...options,shoreAt:settlementShore,treeSites:settlementTreeSites()});root.add(nature.root);
 const groundCover=createSourceGroundCover({THREE:T,groundAt:options.groundAt});root.add(groundCover.root);
 const buildBuilding=(spec:CombinedBuildingSpec):any=>{
  const group=spec.kind==='ruin-arch'?nature.buildRuin(spec):architecture.build(spec);group.name=`Source estate ${spec.kind} / ${spec.id}`;
  group.userData.combinedBuilding={...spec};return group;
 };
 for(const building of AUTUMN_SETTLEMENT_BUILDINGS){
  const kind:CombinedBuildingKind=building.landmark==='banner-hall'?'hall':building.landmark==='war-record'?'archive':building.landmark==='heralds-station'?'herald':building.id==='muster-lodge'?'storehouse':'cottage';
  if(kind==='archive')continue; // The actual Monolith masonry ruin owns this lot.
  // The dominant Banner Hall is the original Crownfall compound manor emitted
  // by the worker. Only its open court shelter comes from the Temple source;
  // the full source hall factory remains available without duplicating the manor.
  const court=kind==='hall',group=buildBuilding({id:building.id,kind:court?'pavilion':kind,width:court?4:building.width,depth:court?4:building.depth,height:court?4.25:building.eaves+building.roofHeight});
  const localX=court?6.55:0,localZ=court?4.12:0,c=Math.cos(building.yaw),s=Math.sin(building.yaw),x=building.x+c*localX+s*localZ,z=building.z-s*localX+c*localZ;
  group.position.set(x,options.groundAt(x,z),z);group.rotation.y=building.yaw;group.userData.landmark=building.landmark;
  if(court){group.name='Golden Temple source shelter / Crownfall manor court';group.userData.sourceCourtyardOf='banner-hall';group.userData.sourceCourtyardOffset=[localX,localZ];group.userData.sourceHostLot={width:building.width,depth:building.depth};}
  root.add(group);
 }
 batchFixedCity(T,root,options.profile);
 const treeLimit=options.profile==='quest'?330:options.quality==='low'?530:760,contact=createEstateContact(T,AUTUMN_SETTLEMENT_BUILDINGS,settlementTreeSites().slice(0,treeLimit),options.groundAt);root.add(contact.root);
 const inverse=new T.Matrix4(),forward=new T.Matrix4(),eye=new T.Vector3();let disposed=false;
 /** This is measured from actual uploaded host geometry, never its blueprint.
  * Native tabletop transforms are cancelled into the source root's metre frame.
  * The host retains geometry/material ownership; this diagnostic only reads. */
 function hostManorRecord(){
  if(!options.hostManorObjects)return null;
  const frame=new T.Matrix4().copy(root.matrixWorld).invert(),bounds=new T.Box3(),point=new T.Vector3(),numberBytes=new DataView(new ArrayBuffer(8));
  let hash=0x811c9dc5;const byte=(value:number)=>{hash=Math.imul(hash^value,0x01000193)>>>0;},text=(value:string)=>{for(let i=0;i<value.length;i++)byte(value.charCodeAt(i)&255);},number=(value:number)=>{numberBytes.setFloat64(0,value,true);for(let i=0;i<8;i++)byte(numberBytes.getUint8(i));};
  const parts:any[]=[];let triangles=0;
  for(const object of options.hostManorObjects()){
   const geometry=object?.geometry,position=geometry?.getAttribute('position'),mask=geometry?.getAttribute('landmarkId');
   if(!object?.isMesh||object.isInstancedMesh||!position||!mask)continue;
   object.updateWorldMatrix(true,false);const matrix=new T.Matrix4().multiplyMatrices(frame,object.matrixWorld),partBounds=new T.Box3(),index=geometry.index,faces=index?.count??position.count,attrs=Object.entries(geometry.attributes).sort(([a],[b])=>a.localeCompare(b));
   let selected=0;const startHash=hash;
   for(let i=0;i<faces;i+=3){const ids=[index?index.getX(i):i,index?index.getX(i+1):i+1,index?index.getX(i+2):i+2];if(!ids.every(id=>mask.getX(id)===1))continue;
    if(!selected){text(object.name);for(const [name,attribute]of attrs){text(name);number((attribute as any).itemSize);}}
    for(const id of ids){point.fromBufferAttribute(position,id).applyMatrix4(matrix);partBounds.expandByPoint(point);for(const [,attribute]of attrs)for(let c=0;c<(attribute as any).itemSize;c++)number((attribute as any).getComponent(id,c));}
    selected++;
   }
   if(!selected){hash=startHash;continue;}bounds.union(partBounds);triangles+=selected;
   parts.push({name:object.name,triangles:selected,matrix:matrix.toArray(),bounds:{min:partBounds.min.toArray(),max:partBounds.max.toArray()}});
  }
  if(!triangles)return null;
  return{name:'Original Crownfall compound Banner Hall',assetId:'crownfall-original-compound-manor',ownership:'Crownfall',landmark:'banner-hall',sources:[],position:null,rotation:null,matrix:null,batched:true,sourceInstances:[],geometryHash:`fnv1a32:${hash.toString(16).padStart(8,'0')}`,triangles,meshCount:parts.length,coordinateSpace:'source root blueprint metres',bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},parts};
 }
 function getInfo(){
  const bySource=new Map<string,CombinedSourceInfo>();
  root.traverse((object:any)=>{
   if(!object.isMesh||!object.geometry?.attributes?.position)return;
   let ancestor=object,source:any=null;while(ancestor&&!source){source=ancestor.userData?.sourceAsset??ancestor.userData?.sourceProvenance?.[0];ancestor=ancestor.parent;}
   const repository=source?.repository??'unattributed',generator=source?.generator??'source architecture',key=repository+'|'+generator;
   const info=bySource.get(key)??{source:repository,generator,objects:0,meshes:0,triangles:0,instances:0};
   const count=object.isInstancedMesh?object.count:object.geometry.isInstancedBufferGeometry?object.geometry.instanceCount:1;
   info.meshes++;info.objects+=count;info.instances+=count>1?count:0;info.triangles+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3*count;bySource.set(key,info);
  });
  root.updateWorldMatrix(true,true);
  const fixed=root.children.flatMap((node:any)=>node===nature.root?[...node.children]:[node]).filter((node:any)=>node.userData.sourceAssetId||node.userData.combinedBuilding).map((node:any)=>{const bounds=new T.Box3().setFromObject(node);return{name:node.name,assetId:node.userData.sourceAssetId??null,landmark:node.userData.landmark??null,sources:node.userData.sourceProvenance??[],position:node.position.toArray(),rotation:node.rotation.toArray(),matrix:node.matrix.toArray(),batched:node.userData.sourceGeometryBatched??false,sourceInstances:node.userData.sourceInstances??[],bounds:node.userData.sourceRenderedBounds??{min:bounds.min.toArray(),max:bounds.max.toArray()}};});
  const manor=hostManorRecord();if(manor)fixed.push(manor);
  const alpine=water.getInfo(),entries=[...bySource.values()];return{sources:COMBINED_WORLD_SOURCES,components:entries,fixed,triangles:entries.reduce((n,e)=>n+e.triangles,0),drawCalls:entries.reduce((n,e)=>n+e.meshes,0),architecture:architecture.stats(),groundCover:groundCover.getInfo(),alpine,alpineIncluded:false,...({waterIncluded:alpine.included&&water.root.parent===root} as {waterIncluded?:boolean})};
 }
 return{root,buildBuilding,getInfo,update(delta:number,camera?:any){if(disposed)return;root.updateWorldMatrix(true,false);forward.copy(root.matrixWorld);inverse.copy(forward).invert();if(camera){camera.getWorldPosition(eye);eye.applyMatrix4(inverse);}architecture.setSourceTransform?.(inverse,forward,eye);nature.update(delta,camera);groundCover.update(delta,camera);water.update(delta,camera);},setReducedMotion(value:boolean){nature.setReducedMotion(value);groundCover.setReducedMotion(value);water.setReducedMotion(value);},dispose(){if(disposed)return;disposed=true;water.dispose();contact.dispose();nature.dispose();groundCover.dispose();const geometries=new Set<any>();root.traverse((object:any)=>{if(object.geometry)geometries.add(object.geometry);});root.removeFromParent();root.clear();for(const geometry of geometries)geometry.dispose();architecture.dispose();}};
}
export type CombinedWorldKit=ReturnType<typeof createCombinedWorldKit>;
export type CombinedWorldKitInfo=ReturnType<CombinedWorldKit['getInfo']>;

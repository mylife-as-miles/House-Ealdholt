import {readEaldholtMatureRegionalTree} from './regional-tree-source';
import {Box3,Group,InstancedMesh,Matrix4,Quaternion,Sphere,Vector3,type Camera,type Material,type Object3D} from 'three';
import type {EaldholtFarWoodlandLayout} from '../../../../shared/legacy/aethelgard/environment/far-woodland';
import type {EaldholtFarGeography} from '../../../../shared/legacy/aethelgard/environment/far-surround';
import type {EaldholtWoodlandPlacement,EaldholtWoodlandSurface} from '../../../../shared/legacy/aethelgard/environment/river-woodland';
import {createEaldholtWoodlandVisibility,readAuthoredWoodlandMatrix} from './woodland-visibility';
import {createEaldholtTreeHlod,type EaldholtTreeHlod} from './vegetation-hlod';

export type EaldholtRegionalWoodland=Awaited<ReturnType<typeof loadEaldholtRegionalWoodland>>;
/** Authored source parts and live materials are borrowed, never duplicated or
 * disposed here. Only independent placement/draw buffers belong to this owner. */
export async function loadEaldholtRegionalWoodland(options:{sourceRoot:Object3D;sourceWoodland:Object3D;
  sourcePlacement:EaldholtWoodlandPlacement;canopyRadius:number;existing:readonly EaldholtWoodlandPlacement[];
  geography:EaldholtFarGeography;land?:readonly EaldholtWoodlandSurface[];water?:readonly EaldholtWoodlandSurface[];
  native?:boolean;signal:AbortSignal}){
  options.signal.throwIfAborted();
  const mature=options.native?null:readEaldholtMatureRegionalTree(options.sourceRoot);
  const treeSource=mature?.object??options.sourceWoodland,sourcePlacement=mature?.placement??options.sourcePlacement,canopyRadius=mature?.canopyRadius??options.canopyRadius;
  const parts=treeSource.children.filter((o):o is InstancedMesh=>o instanceof InstancedMesh);
  if(parts.length!==3||parts.some(p=>Array.isArray(p.material)||p.instanceMatrix.count<1))throw Error('Regional forest requires a complete existing tree family.');
  const input={land:options.land??[],water:options.water??[],geography:options.geography,existingPlacements:options.existing,
    existingCanopyRadius:options.canopyRadius,canopyRadius,maximumTrees:options.native?512:1024,projected:Boolean(options.native)};
  const layout=await new Promise<EaldholtFarWoodlandLayout>((resolve,reject)=>{
    const worker=new Worker(new URL('./regional-woodland.worker.ts',import.meta.url),{type:'module'});
    const finish=()=>{worker.terminate();options.signal.removeEventListener('abort',cancel);};
    const cancel=()=>{finish();reject(options.signal.reason??Error('Regional planting cancelled.'));};
    options.signal.addEventListener('abort',cancel,{once:true});
    worker.onerror=e=>{finish();reject(Error(e.message));};
    worker.onmessage=(e:MessageEvent<{layout?:EaldholtFarWoodlandLayout;error?:string}>)=>{finish();if(e.data.layout)resolve(e.data.layout);else reject(Error(e.data.error??'No regional planting result.'));};
    // New support snapshots are transferable; authored geometry remains intact.
    const transfer:Transferable[]=[];
    for(const surface of [...input.land,...input.water])for(const a of [surface.positions,surface.indices])if(ArrayBuffer.isView(a)&&a.buffer instanceof ArrayBuffer&&!transfer.includes(a.buffer))transfer.push(a.buffer);
    try{worker.postMessage(input,transfer);}catch(cause){finish();reject(cause);}
  });
  options.signal.throwIfAborted();
  const count=layout.placements.length;if(!count)throw Error('Regional forest has no qualified dry terrain placements.');
  const object=new Group();object.name='Ealdholt regional woodland scenery';object.visible=false;
  object.userData.iwsdkPreviewBounds='exclude';
  object.userData.crownfallFarSurround={schema:1,ownedSurface:'woodland',localPlacementEligible:false,fullBoundsRequired:!options.native};
  const counts={low:Math.min(options.native?256:512,count),medium:Math.min(options.native?384:768,count),high:count};
  object.userData.crownfallFarWoodland={schema:1,counts,completeSourceFamily:true,sourceActorsUntouched:true,nonSolid:Boolean(options.native)};
  options.sourceRoot.updateWorldMatrix(true,true);
  const p=sourcePlacement,actor=new Matrix4().compose(new Vector3(p.x,p.y,p.z),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),p.yaw),new Vector3().setScalar(p.scale));
  const undo=actor.clone().invert(),inverse=options.sourceRoot.matrixWorld.clone().invert(),matrix=new Matrix4(),rotation=new Quaternion(),position=new Vector3(),scale=new Vector3(),up=new Vector3(0,1,0),box=new Box3();
  const owned:InstancedMesh[]=[];
  try{for(const source of parts){
    readAuthoredWoodlandMatrix(source,0,matrix);
    const partFrame=undo.clone().multiply(inverse).multiply(source.matrixWorld).multiply(matrix);
    const mesh=new InstancedMesh(source.geometry,source.material as Material,count);mesh.name='Regional '+source.name;mesh.castShadow=false;mesh.receiveShadow=source.receiveShadow;
    const local=new Box3(),points=source.geometry.getAttribute('position');for(let i=0;i<points.count;i++)local.expandByPoint(position.fromBufferAttribute(points,i));
    const bounds=new Box3();
    layout.placements.forEach((p,id)=>{matrix.compose(position.set(p.x,p.y,p.z),rotation.setFromAxisAngle(up,p.yaw),scale.setScalar(p.scale)).multiply(partFrame);mesh.setMatrixAt(id,matrix);bounds.union(local.clone().applyMatrix4(matrix));});
    mesh.instanceMatrix.needsUpdate=true;mesh.boundingBox=bounds;mesh.boundingSphere=bounds.getBoundingSphere(new Sphere());mesh.raycast=()=>{};
    mesh.userData.crownfallElderbloom={kind:'vegetation',completeSourceFamily:true};mesh.userData.iwsdkPreviewBounds='exclude';
    mesh.userData.crownfallFarSurround=object.userData.crownfallFarSurround;object.add(mesh);owned.push(mesh);box.union(bounds);
  }}catch(cause){for(const mesh of owned)mesh.dispose();throw cause;}
  const stats={sourceFamily:treeSource.name,canopyRadius,placementVersion:'interlocking-canopies-v2',status:'awaiting-hlod',error:'',actors:count,activeActors:0,counts,levels:[0,0,0,0],readyMask:0,
    geometryBytes:0,atlasBytes:0,sourceTriangles:0,simplifiedTriangles:0,
    instanceBytes:owned.reduce((n,m)=>n+m.instanceMatrix.array.byteLength,0),groves:layout.acceptedPerGrove,rejected:layout.rejected,
    bounds:box.isEmpty()?null:{min:box.min.toArray(),max:box.max.toArray()},support:options.native?'non-solid-analytic-projection':'actual-terrain-triangles',collision:'unchanged; scenery is not navigation authority'};
  const visibility=count?createEaldholtWoodlandVisibility(object):null;
  let hlod:EaldholtTreeHlod|null=null,disposed=false;
  function dispose(){if(disposed)return;disposed=true;hlod?.dispose();visibility?.dispose();object.removeFromParent();object.clear();for(const mesh of owned)mesh.dispose();options.signal.removeEventListener('abort',dispose);stats.status='disposed';}
  options.signal.addEventListener('abort',dispose,{once:true});
  return {object,stats,placements:layout.placements,
    get preparationReady(){return !hlod||hlod.stats.readyMask===15||hlod.stats.status==='error';},
    /** Freeze original static occupancy before any render compaction. */
    snapshot<T>(read:()=>T):T{object.visible=true;try{return read();}finally{object.visible=false;}},
    start(options:Parameters<typeof createEaldholtTreeHlod>[2]){if(disposed||hlod||!visibility)return;hlod=createEaldholtTreeHlod(object,visibility,options);},
    update(cameras:readonly Camera[],now:number,quality:'low'|'medium'|'high',reduced=false){
      if(disposed||!hlod||!visibility)return false;stats.readyMask=hlod.stats.readyMask;stats.geometryBytes=hlod.stats.geometryBytes;stats.atlasBytes=hlod.stats.atlasBytes;
      stats.sourceTriangles=hlod.stats.sourceTriangles;stats.simplifiedTriangles=hlod.stats.simplifiedTriangles;
      if(hlod.stats.status==='error'){stats.status='held-error';stats.error=hlod.stats.error;object.visible=false;return false;}
      // Never render the entire raw high-detail pool while atlases prepare.
      if(stats.readyMask!==15){object.visible=false;stats.status='preparing-hlod';return false;}
      visibility.update(cameras,quality);const moving=hlod.update(now,cameras[0],quality,reduced);
      object.visible=true;stats.status='ready';stats.activeActors=visibility.stats.visibleActors;
      for(let i=0;i<4;i++)stats.levels[i]=hlod.stats.levels[i];return moving;
    },suspend(){object.visible=false;},dispose};
}

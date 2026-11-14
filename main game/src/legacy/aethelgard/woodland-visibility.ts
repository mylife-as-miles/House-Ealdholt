import {Box3,Frustum,InstancedMesh,Matrix4,Vector3,type Camera,type Object3D} from 'three';
import {createWoodlandSpatialIndex,type WoodlandBounds} from '../../../../shared/legacy/aethelgard/environment/woodland-spatial-index';
const snapshots=new WeakMap<InstancedMesh,Float32Array>();
/** Source ordinal access remains valid after the owned render buffer compacts. */
export function readAuthoredWoodlandMatrix(mesh:InstancedMesh,id:number,target:Matrix4):Matrix4{
 const original=snapshots.get(mesh);if(original)return target.fromArray(original,id*16);mesh.getMatrixAt(id,target);return target;
}
/** Only the generated woodland's three owned instance buffers may be compacted.
 * Borrowed geometry/materials, full framing bounds and source actors stay intact. */
export function createEaldholtWoodlandVisibility(root:Object3D,viewerClearanceMetres=0){
 if(!Number.isFinite(viewerClearanceMetres)||viewerClearanceMetres<0||viewerClearanceMetres>2)throw Error('Invalid woodland viewer clearance.');
 const marker=root.userData.crownfallRiverWoodland??root.userData.crownfallFarWoodland;
 const counts=root.userData.crownfallFoliageDensity?.counts??root.userData.crownfallFarWoodland?.counts;
 if(!marker||!counts)throw Error('Spatial visibility requires an owned woodland root.');
 const parts=root.children.filter((o):o is InstancedMesh=>o instanceof InstancedMesh),total=counts.high as number;
 if(parts.length!==3||!Number.isSafeInteger(total)||total<0||Object.values(counts).some(v=>!Number.isSafeInteger(v)||Number(v)<0||Number(v)>total))throw Error('Incomplete woodland visibility family.');
 const original=parts.map(mesh=>{if(mesh.parent!==root||mesh.castShadow||mesh.instanceColor||mesh.morphTexture||mesh.instanceMatrix.count!==total||!(mesh.instanceMatrix.array instanceof Float32Array)||snapshots.has(mesh)
  ||Object.values(mesh.geometry.attributes).some(a=>(a as {isInstancedBufferAttribute?:boolean}).isInstancedBufferAttribute))throw Error('Woodland visibility supports complete static uncoloured non-shadow instance families only.');return new Float32Array(mesh.instanceMatrix.array);});
 const actorBounds=Array.from({length:total},()=>new Box3()),point=new Vector3(),matrix=new Matrix4(),frame=new Matrix4();
 const partFrames=parts.map((mesh,part)=>{mesh.updateMatrix();const transform=mesh.matrix.clone(),local=new Box3(),positions=mesh.geometry.getAttribute('position');for(let i=0;i<positions.count;i++)local.expandByPoint(point.fromBufferAttribute(positions,i));if(local.isEmpty())throw Error('Missing whole-tree geometry bounds.');
  for(let id=0;id<total;id++){matrix.fromArray(original[part],id*16);frame.multiplyMatrices(transform,matrix);actorBounds[id].union(local.clone().applyMatrix4(frame));}return transform;});
 const index=createWoodlandSpatialIndex(actorBounds.map(b=>[b.min.x,b.min.y,b.min.z,b.max.x,b.max.y,b.max.z] as WoodlandBounds));
 const safeIds=new Uint32Array(total),worldActorBox=new Box3(),viewerEye=new Vector3();
 const frusta=[new Frustum(),new Frustum(),new Frustum()],planeStorage=[new Float64Array(24),new Float64Array(24),new Float64Array(24)],worldPlanes=[planeStorage[0],planeStorage[1],planeStorage[2]],cameraMatrix=new Matrix4(),inverse=new Matrix4();
 const stats={coverage:'camera-only' as 'camera-only'|'camera-and-shadow'|'full-quality-fallback',total,qualityActors:total,visibleActors:total,culledActors:0,cells:index.cellCount,testedCells:0,testedActors:0,viewerHeldActors:0,instanceUploads:0,cpuMatrixSnapshotBytes:original.reduce((n,a)=>n+a.byteLength,0)};
 let visibleIds:Uint32Array|null=null,visibleCount=total;
 let disposed=false;parts.forEach((mesh,i)=>snapshots.set(mesh,original[i]));
 function limitFor(quality:'low'|'medium'|'high'){if(!Object.prototype.hasOwnProperty.call(counts,quality))throw Error('Invalid woodland quality.');return counts[quality] as number;}
 function upload(ids:Uint32Array|null,count:number){for(let part=0;part<parts.length;part++){const dst=parts[part].instanceMatrix.array as Float32Array,src=original[part];for(let out=0;out<count;out++){const start=(ids?ids[out]:out)*16;for(let i=0;i<16;i++)dst[out*16+i]=src[start+i];}parts[part].count=count;parts[part].instanceMatrix.needsUpdate=true;}stats.instanceUploads++;}
 return{stats,
  sourceOrdinalForDrawSlot(slot:number):number|null {return disposed||!Number.isSafeInteger(slot)||slot<0||slot>=visibleCount?null:visibleIds?visibleIds[slot]:slot;},
  update(cameras:readonly Camera[],quality:'low'|'medium'|'high',lastCameraIsShadow=false){
   if(disposed)return;if(cameras.length<1||cameras.length>3||lastCameraIsShadow&&cameras.length<2)throw Error('Woodland visibility requires actual view/eye cameras and explicit shadow coverage.');
   const casts=parts.some(part=>part.castShadow),limit=limitFor(quality);
   if(casts&&viewerClearanceMetres>0)throw Error('Viewer-clearance scenery cannot become a shadow caster.');
   if(casts&&!lastCameraIsShadow){if(visibleIds!==null||visibleCount!==limit){upload(null,limit);visibleIds=null;visibleCount=limit;index.invalidate();}else for(const part of parts)part.count=limit;stats.coverage='full-quality-fallback';stats.qualityActors=limit;stats.visibleActors=limit;stats.culledActors=0;stats.testedCells=0;stats.testedActors=0;return;}
   stats.coverage=casts?'camera-and-shadow':'camera-only';
   const cameraCount=cameras.length-(lastCameraIsShadow&&!casts?1:0);root.updateWorldMatrix(true,false);worldPlanes.length=cameraCount;
   for(let f=0;f<cameraCount;f++){const camera=cameras[f];inverse.copy(camera.matrixWorld).invert();cameraMatrix.multiplyMatrices(camera.projectionMatrix,inverse);frusta[f].setFromProjectionMatrix(cameraMatrix);
    worldPlanes[f]=planeStorage[f];const values=worldPlanes[f];for(let j=0;j<6;j++){const plane=frusta[f].planes[j];values[j*4]=plane.normal.x;values[j*4+1]=plane.normal.y;values[j*4+2]=plane.normal.z;values[j*4+3]=plane.constant;}}
   for(let i=0;i<parts.length;i++){if(parts[i].matrixAutoUpdate)parts[i].updateMatrix();if(!parts[i].matrix.equals(partFrames[i]))throw Error('Woodland part frame changed after indexing.');}
   const selected=index.select(worldPlanes,root.matrixWorld.elements,limit);
   let ids=selected.ids,count=selected.count,membershipChanged=selected.changed;stats.viewerHeldActors=0;
   if(viewerClearanceMetres>0){
    count=0;membershipChanged ||= visibleIds!==safeIds;
    const viewerCount=cameras.length-(lastCameraIsShadow?1:0);
    for(let slot=0;slot<selected.count;slot++){
     const id=selected.ids[slot];worldActorBox.copy(actorBounds[id]).applyMatrix4(root.matrixWorld);let near=false;
     for(let eye=0;eye<viewerCount;eye++){viewerEye.setFromMatrixPosition(cameras[eye].matrixWorld);if(worldActorBox.distanceToPoint(viewerEye)<viewerClearanceMetres){near=true;break;}}
     if(near){stats.viewerHeldActors++;continue;}
     if(safeIds[count]!==id)membershipChanged=true;safeIds[count++]=id;
    }
    membershipChanged ||= count!==visibleCount;ids=safeIds;
   }
   visibleIds=ids;visibleCount=count;
   if(membershipChanged)upload(ids,count);else for(const part of parts)part.count=count;
   stats.qualityActors=limit;stats.visibleActors=count;stats.culledActors=limit-count;stats.testedCells=selected.testedCells;stats.testedActors=selected.testedActors;
  },
  restore(quality:'low'|'medium'|'high'='high'){if(disposed)return;const limit=limitFor(quality);if(visibleIds!==null||visibleCount!==limit)upload(null,limit);else for(const part of parts)part.count=limit;visibleIds=null;visibleCount=limit;index.invalidate();stats.coverage='full-quality-fallback';stats.qualityActors=limit;stats.visibleActors=limit;stats.culledActors=0;stats.testedCells=0;stats.testedActors=0;},
  dispose(){if(disposed)return;upload(null,total);for(const part of parts)snapshots.delete(part);index.invalidate();disposed=true;},
 };
}
export type EaldholtWoodlandVisibility=ReturnType<typeof createEaldholtWoodlandVisibility>;

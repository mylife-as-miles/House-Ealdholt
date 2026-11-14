/** Existing Athenaion source concatenation preserves every custom facade/roof
 * channel. Only fixed non-landmark objects are transformed/batched here. */
import { mergeStaticMeshes } from '../athenaion/merge.js';
export function batchFixedCity(T,root,profile){
 root.updateMatrixWorld(true);
 const batches=new T.Group();batches.name='Batched actual Athenaion fixed cottages';batches.userData.sourceAssetId='athenaion-fixed-city-batches';
 const lots=[];
 for(const lot of [...root.children]){
  if(!lot.userData.combinedBuilding||lot.userData.landmark)continue;
  const local=new T.Box3();lot.traverse(mesh=>{if(mesh.isMesh){mesh.geometry.computeBoundingBox();local.union(mesh.geometry.boundingBox);}});
  const world=new T.Box3().setFromObject(lot),source=lot.userData.sourceProvenance??[];
  lots.push({id:lot.userData.combinedBuilding.id,assetId:lot.userData.sourceAssetId,sources:source,bounds:{min:world.min.toArray(),max:world.max.toArray()},localBounds:{min:local.min.toArray(),max:local.max.toArray()},matrix:lot.matrixWorld.toArray()});
  lot.userData.sourceGeometryBatched=true;lot.userData.sourceLocalBounds={min:local.min.toArray(),max:local.max.toArray()};lot.userData.sourceRenderedBounds={min:world.min.toArray(),max:world.max.toArray()};
  const meshes=[];lot.traverse(mesh=>{if(mesh.isMesh)meshes.push(mesh);});
  for(const mesh of meshes){mesh.geometry.applyMatrix4(mesh.matrixWorld);mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();mesh.removeFromParent();mesh.position.set(0,0,0);mesh.quaternion.identity();mesh.scale.set(1,1,1);mesh.updateMatrix();batches.add(mesh);}
 }
 batches.userData.sourceProvenance=lots.flatMap(lot=>lot.sources).filter((source,index,all)=>all.findIndex(other=>source.id===other.id)===index);batches.userData.sourceInstances=lots;
 root.add(batches);root.updateMatrixWorld(true);
 const result=mergeStaticMeshes(T,[batches],{bakeTransforms:true,ignoreShadows:profile==='quest'});
 batches.userData.sourceBatchReport={before:result.before,after:result.after,lots:lots.length};return batches;
}

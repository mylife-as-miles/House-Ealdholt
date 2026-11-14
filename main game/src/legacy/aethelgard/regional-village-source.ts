import {Box3,InstancedMesh,Matrix4,Mesh,Vector3,type Object3D} from 'three';
import type {EaldholtWoodlandSurface} from '../../../../shared/legacy/aethelgard/environment/river-woodland';
import {measureRegionalGroundcoverSource} from './regional-groundcover';
/** Read the authored settlement, not its much larger Landscape tile. Source
 * geometry/transforms stay borrowed; worker support arrays are owned copies. */
export function collectRegionalVillageSource(root:Object3D){
 root.updateWorldMatrix(true,true);const inverse=root.matrixWorld.clone().invert(),frame=new Matrix4(),instance=new Matrix4(),point=new Vector3(),bounds=new Box3(),land:EaldholtWoodlandSurface[]=[];
 root.traverse(node=>{if(!(node instanceof Mesh))return;const kind=node.userData.crownfallElderbloom?.kind,positions=node.geometry.getAttribute('position');if(!positions)return;
  frame.multiplyMatrices(inverse,node.matrixWorld);
  if(kind==='architecture'){
   const box=node.geometry.boundingBox?.clone()??new Box3().setFromBufferAttribute(positions);
   if(node instanceof InstancedMesh)for(let i=0;i<node.instanceMatrix.count;i++){node.getMatrixAt(i,instance);bounds.union(box.clone().applyMatrix4(new Matrix4().multiplyMatrices(frame,instance)));}
   else bounds.union(box.applyMatrix4(frame));
  }else if(kind==='terrain'&&/^LandscapeComponent_\d/.test(node.name)&&!(node instanceof InstancedMesh)){
   const out=new Float64Array(positions.count*3);for(let i=0;i<positions.count;i++){point.fromBufferAttribute(positions,i).applyMatrix4(frame);out.set([point.x,point.y,point.z],i*3);}land.push({positions:out,indices:node.geometry.index?Uint32Array.from(node.geometry.index.array):Uint32Array.from({length:positions.count},(_,i)=>i)});
  }
 });
 bounds.expandByScalar(2);
 return{groundcoverSource:measureRegionalGroundcoverSource(root),village:bounds.isEmpty()||!land.length?undefined:{minX:bounds.min.x,maxX:bounds.max.x,minZ:bounds.min.z,maxZ:bounds.max.z},villageLand:land};
}

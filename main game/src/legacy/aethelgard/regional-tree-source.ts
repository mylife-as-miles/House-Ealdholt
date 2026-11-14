import {Box3,InstancedMesh,Matrix4,MeshStandardMaterial,Vector3,type Object3D} from 'three';
import {staticSourceBounds} from './static-source-bounds';
import {readAuthoredWoodlandMatrix} from './woodland-visibility';
/** Borrow a mature canopy already present in the full asset. No source actor,
 * geometry, material or instance buffer is changed. Compact models retain the
 * existing qualified woodland prototype when this source family is absent. */
export interface MatureRegionalTree {object:Object3D;placement:{x:number;y:number;z:number;scale:number;yaw:number;region:'mainland'};canopyRadius:number}
export function readEaldholtMatureRegionalTree(root:Object3D):MatureRegionalTree|null{
 root.updateWorldMatrix(true,true);const inverse=root.matrixWorld.clone().invert(),instance=new Matrix4(),frame=new Matrix4(),point=new Vector3(),box=new Box3();
 let result:MatureRegionalTree|null=null;
 root.traverse(node=>{
  if(result||!/^SM_BlackAlder_Field_02(?:_|$)/i.test(node.name)||node.userData.crownfallElderbloom?.kind!=='tree')return;
  const parts=node.children.filter((o):o is InstancedMesh=>o instanceof InstancedMesh);
  if(parts.length!==3||parts.some(p=>!(p.material instanceof MeshStandardMaterial)||p.instanceMatrix.count<1||Object.keys(p.geometry.morphAttributes).length))return;
  const leaves=parts.find(p=>!Array.isArray(p.material)&&p.material.side===2);if(!leaves||(leaves.geometry.index?.count??0)<60000)return;
  readAuthoredWoodlandMatrix(parts[0],0,instance);frame.multiplyMatrices(inverse,parts[0].matrixWorld).multiply(instance);point.setFromMatrixPosition(frame);
  const origin=point.clone(),local=new Matrix4().makeTranslation(-origin.x,-origin.y,-origin.z);box.makeEmpty();
  for(const p of parts){readAuthoredWoodlandMatrix(p,0,instance);frame.multiplyMatrices(inverse,p.matrixWorld).multiply(instance).premultiply(local);
   // These authored cells are upright. Reject a tilted/sheared Y frame rather
   // than infer a floating contact from transformed box corners.
   if(Math.abs(frame.elements[1])>1e-6||Math.abs(frame.elements[9])>1e-6||frame.elements[5]<=0)return;
   box.union(staticSourceBounds(p.geometry).clone().applyMatrix4(frame));
  }
  const height=box.max.y-box.min.y,radius=Math.hypot(Math.max(Math.abs(box.min.x),Math.abs(box.max.x)),Math.max(Math.abs(box.min.z),Math.abs(box.max.z)));
  if(height<8||height>40||radius<3||radius>25)return;
  result={object:node,placement:{x:origin.x,y:origin.y+box.min.y,z:origin.z,scale:1,yaw:0,region:'mainland'},canopyRadius:radius};
 });return result;
}

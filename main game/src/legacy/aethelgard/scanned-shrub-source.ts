import {Box3,DoubleSide,Matrix4,Mesh,MeshStandardMaterial,Texture,Vector3,type Object3D} from 'three';
import type {VegetationCapturePart} from './vegetation-atlas-capture';
import {SCANNED_SHRUB_ASSETS,SCANNED_SHRUB_MEASURED,scannedShrubCohortSource} from '../../../../shared/legacy/aethelgard/environment/scanned-shrub-assets';
import type {ScannedShrubCohortSource} from '../../../../shared/legacy/aethelgard/environment/scanned-shrub-policy';

export interface NormalizedScannedShrubSource extends ScannedShrubCohortSource {
 readonly family:string;readonly parts:readonly VegetationCapturePart[];readonly bounds:Box3;
 readonly originalBaseY:number;readonly normalization:Matrix4;readonly triangles:number;
 readonly textureBytes:number;readonly geometryBytes:number;
}

/** Borrow the complete, metadata-verified scan without changing imported TRS,
 * vertex/index buffers, material factors, texture samplers or alpha. The entire
 * one-material mesh is soft foliage; no wood/collision proof is inferred. */
export function borrowScannedShrubSource(root:Object3D,native=false):NormalizedScannedShrubSource|null {
 root.updateWorldMatrix(true,true);const inverse=root.matrixWorld.clone().invert(),frame=new Matrix4(),point=new Vector3(),bounds=new Box3();
 const meshes:Mesh[]=[];root.traverse(node=>{if(node instanceof Mesh)meshes.push(node);});
 if(meshes.length!==1)return null;const mesh=meshes[0],g=mesh.geometry,m=mesh.material,index=g.index,p=g.getAttribute('position');
 const measured=SCANNED_SHRUB_MEASURED,expected=SCANNED_SHRUB_ASSETS[native?'native':'desktop'];
 if(!(m instanceof MeshStandardMaterial)||!p||!index||p.count!==measured.vertices||index.count!==measured.triangles*3
  ||g.groups.length>1||Object.keys(g.morphAttributes).length||'isSkinnedMesh'in mesh||!g.hasAttribute('normal')||!g.hasAttribute('uv')
  ||!m.map||!m.normalMap||!m.roughnessMap||!m.metalnessMap||!m.aoMap||m.alphaTest!==.5||m.transparent||m.side!==DoubleSide)return null;
 frame.multiplyMatrices(inverse,mesh.matrixWorld);if(!frame.elements.every(Number.isFinite)||Math.abs(frame.determinant())<1e-10)return null;
 const used=new Set<number>(),positions:[number,number,number][]=[];let radius=0;
 for(let at=0;at<index.count;at++){const id=index.getX(at);if(!Number.isInteger(id)||id<0||id>=p.count)return null;if(used.has(id))continue;used.add(id);
  point.fromBufferAttribute(p,id).applyMatrix4(frame);if(!point.toArray().every(Number.isFinite))return null;positions.push(point.toArray());bounds.expandByPoint(point);radius=Math.max(radius,Math.hypot(point.x,point.z));
 }
 const near=(a:number,b:number)=>Math.abs(a-b)<=1e-5;
 if(bounds.isEmpty()||!bounds.min.toArray().every((v,i)=>near(v,measured.min[i]))||!bounds.max.toArray().every((v,i)=>near(v,measured.max[i]))||!near(radius,measured.canopyRadius))return null;
 const bottom=positions.filter(p=>p[1]<=bounds.min.y+.03+1e-7),contact=scannedShrubCohortSource(native);
 if(bottom.length!==53||measured.points.some(p=>!bottom.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2])<=1e-5))
  ||bottom.some(p=>Math.hypot(p[0],p[2])>contact.contact.radius+1e-5))return null;
 const textures=new Set<Texture>();for(const value of Object.values(m))if(value instanceof Texture)textures.add(value);
 let textureBytes=0;for(const texture of textures){const image=texture.image as {width?:number;height?:number}|null;
  const width=image?.width??0,height=image?.height??0,maximum=native?512:1024;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width!==maximum||height!==maximum)return null;
  let size=width;while(size>=1){textureBytes+=size*size*4;size=Math.floor(size/2);}
 }
 if(textures.size!==3||textureBytes>expected.textureBytes)return null;
 const normalization=new Matrix4().makeTranslation(0,contact.contact.baseY-bounds.min.y,0);
 return{...contact,family:'PolyHaven_shrub_02_b',originalBaseY:bounds.min.y,normalization,bounds:bounds.clone().applyMatrix4(normalization),
  parts:[{geometry:g,material:m,frame:frame.clone(),foliage:true}],triangles:measured.triangles,textureBytes,geometryBytes:expected.geometryBytes};
}

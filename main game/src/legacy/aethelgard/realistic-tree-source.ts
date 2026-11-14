import {Box3, InstancedMesh, Matrix4, MeshStandardMaterial, Vector3, type Object3D} from 'three';
import type {VegetationCapturePart} from './vegetation-atlas-capture';
import type {EaldholtRiverWoodland} from './river-woodland';
import type {VegetationRootContact} from '../../../../shared/legacy/aethelgard/environment/vegetation-root-contact';
import {REGIONAL_VEGETATION_PROTOTYPES} from '../../../../shared/legacy/aethelgard/environment/regional-assets';
import {REGIONAL_ROOT_CONTACTS} from '../../../../shared/legacy/aethelgard/environment/regional-root-contact-data';

export const REALISTIC_TREE_FAMILY='SM_BlackAlder_Forest_05_PP3';
export const REALISTIC_FOREST01_FAMILY='SM_BlackAlder_Forest_01';
export const REALISTIC_TREE_SOURCES={
 desktop:'3b02834505642a5a9e7535e92812df8e565b99005e9921d41be83be4f5da3b28',
 quest:'71ed6b23e363e26369164aec387d68e6178850a861eadd8d9b5482f1e50f8e67',
} as const;
export interface BorrowedRealisticTreeSource {
 readonly family:string; readonly sourceSha256:string; readonly parts:readonly VegetationCapturePart[];
 readonly bounds:Box3; readonly contact:VegetationRootContact; readonly triangles:number;
}
export interface NormalizedRealisticTreeSource extends BorrowedRealisticTreeSource {readonly variant:1|2;readonly height:number;readonly canopyRadius:number;readonly trunkRadius:number;readonly walkingTriangles:Float64Array;readonly normalization:Matrix4}

/** Read the complete family already qualified by river-woodland, before lighting
 * or HLOD clones are installed. Nothing here changes source buffers, materials,
 * maps, draw ranges, visibility or actor transforms; none are ours to dispose. */
export function borrowRealisticTreeSource(woodland:Pick<EaldholtRiverWoodland,'borrowedPrototype'>,sourceSha256:string|undefined):BorrowedRealisticTreeSource|null{
 const family=woodland.borrowedPrototype;
 if(!sourceSha256||!Object.values<string>(REALISTIC_TREE_SOURCES).includes(sourceSha256)||!family||family.name!==REALISTIC_TREE_FAMILY+'_ExteriorPrototype'||family.components.length!==3)return null;
 return borrowFamily(family.components,sourceSha256,REALISTIC_TREE_FAMILY,9883);
}

/** The original Forest01 mesh has three primitives in one canonical mesh-local
 * frame. Validate every original actor's component transforms before sharing
 * identity frames; never cancel a Float32 actor into a new capture identity. */
export function borrowForest01TreeSource(root:Object3D,sourceSha256:string|undefined):BorrowedRealisticTreeSource|null{
 if(sourceSha256!==REALISTIC_TREE_SOURCES.desktop)return null;
 root.updateWorldMatrix(true,true);const matches:Object3D[]=[];
 root.traverse(node=>{if(/^SM_BlackAlder_Forest_01(?:_cell_.*)?$/.test(node.name)&&node.userData.crownfallElderbloom?.kind==='tree')matches.push(node);});
 let components:{source:InstancedMesh;frame:Matrix4}[]|null=null;const matrix=new Matrix4(),reference=new Matrix4();
 for(const node of matches){const parts:InstancedMesh[]=[];node.traverse(child=>{if(child instanceof InstancedMesh)parts.push(child);});
  if(parts.length!==3||parts.some(part=>Array.isArray(part.material)))return null;
  const count=parts[0].instanceMatrix.count;if(!Number.isInteger(count)||count<=0||count>16||parts.some(part=>part.instanceMatrix.count!==count))return null;
  for(let actor=0;actor<count;actor++){parts[0].getMatrixAt(actor,reference);reference.premultiply(parts[0].matrixWorld);
   for(const part of parts){part.getMatrixAt(actor,matrix);matrix.premultiply(part.matrixWorld);if(matrix.elements.some((v,k)=>!Number.isFinite(v)||Math.abs(v-reference.elements[k])>1e-4))return null;}
  }
  if(!components)components=parts.map(source=>({source,frame:new Matrix4()}));
  else if(parts.some((part,i)=>part.geometry!==components![i].source.geometry||part.material!==components![i].source.material))return null;
 }
 return components?borrowFamily(components,sourceSha256,REALISTIC_FOREST01_FAMILY,58411):null;
}
function borrowFamily(components:readonly {source:InstancedMesh;frame:Matrix4}[],sourceSha256:string,family:string,expectedTriangles:number):BorrowedRealisticTreeSource|null{
 const point=new Vector3(),bounds=new Box3(),records:{part:VegetationCapturePart;points:[number,number,number][];minY:number;maxY:number;triangles:number}[]=[];
 for(const component of components){
  const mesh=component.source,geometry=mesh.geometry,material=mesh.material,position=geometry.getAttribute('position'),index=geometry.index;
  if(!(material instanceof MeshStandardMaterial)||!position||!index||index.count%3||Object.keys(geometry.morphAttributes).length||geometry.groups.length>1||!component.frame.elements.every(Number.isFinite)||Math.abs(component.frame.determinant())<1e-10)return null;
  if(!['normal','tangent','uv','uv1','uv2'].every(name=>geometry.hasAttribute(name))||!material.map||!material.normalMap||!material.aoMap||!material.roughnessMap||material.alphaTest<=0||material.transparent)return null;
  const points:[number,number,number][]=[],used=new Set<number>();let minY=Infinity,maxY=-Infinity;
  // Measure referenced vertices, not a shared accessor's unused positions and
  // never the current visual drawRange or source instance count.
  for(let i=0;i<index.count;i++){const id=index.getX(i);if(used.has(id))continue;used.add(id);if(id<0||id>=position.count)return null;
   point.fromBufferAttribute(position,id).applyMatrix4(component.frame);if(!point.toArray().every(Number.isFinite))return null;
   bounds.expandByPoint(point);points.push(point.toArray());minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);
  }
  records.push({part:{geometry,material,frame:component.frame.clone(),foliage:material.side===2},points,minY,maxY,triangles:index.count/3});
 }
 const wood=records.filter(record=>!record.part.foliage&&record.minY<=.1).sort((a,b)=>(b.maxY-b.minY)-(a.maxY-a.minY))[0];
 const triangles=records.reduce((sum,r)=>sum+r.triangles,0);
 if(!wood||!records.some(record=>record.part.foliage)||bounds.isEmpty()||triangles!==expectedTriangles)return null;
 const foot=wood.points.filter(point=>point[1]<=wood.minY+.03),sorted=[...foot].sort((a,b)=>a[0]-b[0]||a[2]-b[2]);
 const cross=(a:readonly number[],b:readonly number[],c:readonly number[])=>(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
 const lower:typeof foot=[],upper:typeof foot=[];
 for(const p of sorted){while(lower.length>1&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);}
 for(const p of [...sorted].reverse()){while(upper.length>1&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);}
 const points=[...lower.slice(0,-1),...upper.slice(0,-1)];if(points.length<3||points.length>64)return null;
 return{family,sourceSha256,parts:[wood,...records.filter(r=>r!==wood)].map(r=>r.part),bounds,contact:{baseY:wood.minY,radius:Math.max(...points.map(p=>Math.hypot(p[0],p[2]))),points},triangles};
}

/** A bounded broadleaf presentation cohort, not a replacement species
 * library. Uniformly fit inside the selected medium/mature slot's crown/root/height
 * envelopes. Actor matrices, contact base and protected clearances stay fixed. */
export function normalizeRealisticTreeSource(source:BorrowedRealisticTreeSource):NormalizedRealisticTreeSource|null{
 if(source.family!==REALISTIC_TREE_FAMILY&&source.family!==REALISTIC_FOREST01_FAMILY)return null;
 const variant=source.family===REALISTIC_FOREST01_FAMILY?1:2,prototype=REGIONAL_VEGETATION_PROTOTYPES[variant],original=REGIONAL_ROOT_CONTACTS[prototype.id];
 const height=source.bounds.max.y-source.contact.baseY,sourceRadius=Math.hypot(Math.max(Math.abs(source.bounds.min.x),Math.abs(source.bounds.max.x)),Math.max(Math.abs(source.bounds.min.z),Math.abs(source.bounds.max.z)));
 if(!Number.isFinite(height)||height<=0||!Number.isFinite(sourceRadius)||sourceRadius<=0)return null;
 const factor=Math.min(prototype.height/height,prototype.canopyRadius/sourceRadius,original.radius/source.contact.radius);
 // Reject an ill-fitting family instead of disguising it with anisotropic scale.
 if(factor*height<prototype.height*.85)return null;
 const transform=new Matrix4().makeScale(factor,factor,factor);transform.setPosition(0,original.baseY-source.contact.baseY*factor,0);
 const point=new Vector3(),points=source.contact.points.map(p=>point.fromArray(p).applyMatrix4(transform).toArray()),bounds=source.bounds.clone().applyMatrix4(transform);
 const contact={baseY:original.baseY,radius:source.contact.radius*factor,points};
 // Measure the unburied prototype at scale one for source qualification only.
 // Actual actors separately qualify against terrain-relative walking volumes.
 // A branch crossing the boundary is measured at its edge intersection, not
 // missed because its outer vertex happens to sit above the capsule.
 let trunkRadius=0;const walkingTriangles:number[]=[];
 for(const part of source.parts){if(part.foliage)continue;const p=part.geometry.getAttribute('position'),index=part.geometry.index,frame=transform.clone().multiply(part.frame);
  if(!index)return null;
  for(let i=0;i<index.count;i+=3){let polygon=[0,1,2].map(k=>new Vector3().fromBufferAttribute(p,index.getX(i+k)).applyMatrix4(frame));
   if(polygon.some(point=>Math.hypot(point.x,point.z)>original.radius+1e-7))for(const point of polygon)walkingTriangles.push(point.x,point.y,point.z);
   for(const [height,above]of [[original.baseY,true],[original.baseY+3.5,false]]as const){const clipped:Vector3[]=[];
    for(let at=0;at<polygon.length;at++){const a=polygon[at],b=polygon[(at+1)%polygon.length],keep=above?a.y>=height:a.y<=height,next=above?b.y>=height:b.y<=height;if(keep)clipped.push(a);if(keep!==next)clipped.push(a.clone().lerp(b,(height-a.y)/(b.y-a.y)));}polygon=clipped;
   }
   for(const vertex of polygon)trunkRadius=Math.max(trunkRadius,Math.hypot(vertex.x,vertex.z));
  }
 }
 if(!Number.isFinite(trunkRadius)||trunkRadius<=0||trunkRadius>original.radius+1e-6)return null;
 return{...source,variant,normalization:transform,bounds,contact,height:height*factor,canopyRadius:sourceRadius*factor,trunkRadius,walkingTriangles:Float64Array.from(walkingTriangles)};
}

import { readAuthoredWoodlandMatrix } from './woodland-visibility';
import { Box3, Group, InterleavedBufferAttribute, InstancedMesh, Matrix4, Mesh, Quaternion, Sphere, Vector3, type Material, type Object3D } from 'three';
import { createEaldholtFarWoodlandLayout, EALDHOLT_FAR_WOODLAND_BUDGET, EALDHOLT_FAR_WOODLAND_LOD_BUDGET, type EaldholtFarGrove, type EaldholtFarWoodlandPlacement } from '../../../../shared/legacy/aethelgard/environment/far-woodland';
import type { EaldholtFarGeography } from '../../../../shared/legacy/aethelgard/environment/far-surround';
import type { EaldholtWoodlandPlacement, EaldholtWoodlandSurface } from '../../../../shared/legacy/aethelgard/environment/river-woodland';
import type { EaldholtRiverWoodland } from './river-woodland';
import type { EaldholtFarWoodlandLod } from './far-woodland-lod';
export { readEaldholtFarWoodlandConfig, loadEaldholtFarWoodlandLod } from './far-woodland-lod';
export type { EaldholtFarWoodlandConfig, EaldholtFarWoodlandLod } from './far-woodland-lod';
export interface EaldholtFarWoodland {
  readonly object:Object3D;readonly placements:readonly EaldholtFarWoodlandPlacement[];
  readonly instanceCount:number;readonly triangles:number;readonly drawCalls:number;readonly bufferBytes:number;
  readonly geometryBytes:number;readonly referencedGeometryBytes:number;readonly instanceBytes:number;readonly extraTextureBytes:0;
  readonly prototypeKind:EaldholtFarWoodlandLod['kind'];readonly ownership:EaldholtFarWoodlandLod['ownership'];readonly sourceFamily:string;
  readonly counts:Readonly<{low:number;medium:number;high:number}>;readonly trianglesPerTree:number;
  readonly bounds:{min:readonly[number,number,number];max:readonly[number,number,number]}|null;
  readonly activeActors:number;readonly activeTriangles:number;
  readonly layout:ReturnType<typeof createEaldholtFarWoodlandLayout>;
  setQuality(quality:'low'|'medium'|'high'):void;dispose():void;
}
function isAttached(root:Object3D,o:Object3D) {for(let p:Object3D|null=o;p;p=p.parent)if(p===root)return true;return false;}
export function collectEaldholtWoodlandSurfaces(root:Object3D,owners:readonly Object3D[],kind:'terrain'|'water'):EaldholtWoodlandSurface[] {
  root.updateWorldMatrix(true,true);const inverse=root.matrixWorld.clone().invert(),identity=new Matrix4(),point=new Vector3(),seen=new Set<Mesh>(),result:EaldholtWoodlandSurface[]=[];
  for(const owner of owners) {
    owner.updateWorldMatrix(true,true);const undo=isAttached(root,owner)?inverse:identity;
    if(owner.parent&&!isAttached(root,owner))throw Error('Far woodland support belongs to another source frame.');
    owner.traverse(o=>{
      if(!(o instanceof Mesh)||o instanceof InstancedMesh||seen.has(o))return;
      const role=o.userData.crownfallElderbloom?.kind;if(role!==kind&&!(owner===o&&role===undefined))return;
      const pos=o.geometry.getAttribute('position');if(!pos)return;seen.add(o);
      const frame=new Matrix4().multiplyMatrices(undo,o.matrixWorld),positions=new Float64Array(pos.count*3);
      for(let i=0;i<pos.count;i++){point.fromBufferAttribute(pos,i).applyMatrix4(frame);positions[i*3]=point.x;positions[i*3+1]=point.y;positions[i*3+2]=point.z;}
      result.push({positions,indices:o.geometry.index?Uint32Array.from(o.geometry.index.array):Uint32Array.from({length:pos.count},(_,i)=>i)});
    });
  }return result;
}
/** Mark freshly loaded runtime materials before repair/lighting adapters clone
 * them. Three Material.clone preserves userData, so later name suffixes never
 * force the far layer to bind an unadapted source material. */
export function markEaldholtFarWoodlandMaterialIdentity(root:Object3D):void {
  const seen=new Set<Material>();
  root.traverse(o=>{if(o instanceof Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){
    if(seen.has(m))continue;seen.add(m);
    const previous=m.userData.crownfallSourceMaterialName;
    if(previous===undefined&&m.name)m.userData={...m.userData,crownfallSourceMaterialName:m.name};
    else if(previous!==undefined&&(typeof previous!=='string'||!previous))throw Error('Invalid original material identity.');
  }});
}
/** Reconstruct the same detailed tree already rendered by the local woodland.
 * P is its ground-root frame; partToTree removes only that actor placement.
 * Geometry, live materials, source transforms and borrowed bounds stay intact. */
export function createEaldholtBorrowedFarWoodlandPrototype(privateModel:Object3D,
  woodland:Pick<EaldholtRiverWoodland,'object'|'placements'|'sourceFamily'|'trianglesPerTree'>):EaldholtFarWoodlandLod {
  if(!isAttached(privateModel,woodland.object)||!woodland.placements?.length)throw Error('Detailed far woodland requires the existing attached local family.');
  const first=woodland.placements[0];
  if(![first.x,first.y,first.z,first.scale,first.yaw].every(Number.isFinite)||first.scale<=0)throw Error('Invalid detailed source tree placement.');
  privateModel.updateWorldMatrix(true,true);
  if(Math.abs(privateModel.matrixWorld.determinant())<1e-12)throw Error('Detailed far woodland source frame is singular.');
  const inverseRoot=privateModel.matrixWorld.clone().invert(),actor=new Matrix4().compose(new Vector3(first.x,first.y,first.z),
    new Quaternion().setFromAxisAngle(new Vector3(0,1,0),first.yaw),new Vector3().setScalar(first.scale)),undoActor=actor.clone().invert();
  const components:InstancedMesh[]=[];
  woodland.object.traverse(o=>{if(o instanceof InstancedMesh)components.push(o);});
  if(components.length!==3||components.some(m=>m.instanceMatrix.count<woodland.placements!.length))throw Error('Detailed source family requires all three complete HIGH component pools.');
  const point=new Vector3(),instance=new Matrix4(),bounds=new Box3();let triangles=0;
  const byteRanges=new Map<ArrayBufferLike,[number,number][]>();
  const reference=(array:ArrayBufferView)=>{const intervals=byteRanges.get(array.buffer)??[];intervals.push([array.byteOffset,array.byteOffset+array.byteLength]);byteRanges.set(array.buffer,intervals);};
  const parts=components.map((mesh,index)=>{
    const geometry=mesh.geometry,position=geometry.getAttribute('position'),count=Math.min(geometry.index?.count??position?.count??0,geometry.drawRange.count);
    if(!position||position.itemSize!==3||geometry.drawRange.start!==0||!Number.isInteger(count)||count<=0||count%3)throw Error('Incomplete detailed source component.');
    const material=Array.isArray(mesh.material)?(mesh.material.length===1?mesh.material[0]:null):mesh.material;
    if(!material||geometry.groups.length>1)throw Error('Detailed source component requires one live material/draw.');
    readAuthoredWoodlandMatrix(mesh,0,instance);
    const sourceInstanceFrame=new Matrix4().multiplyMatrices(inverseRoot,mesh.matrixWorld).multiply(instance);
    const localMatrix=new Matrix4().multiplyMatrices(undoActor,sourceInstanceFrame);
    if(!localMatrix.elements.every(Number.isFinite))throw Error('Nonfinite detailed source frame.');
    for(let vertex=0;vertex<position.count;vertex++){
      point.fromBufferAttribute(position,vertex).applyMatrix4(localMatrix);
      if(![point.x,point.y,point.z].every(Number.isFinite))throw Error('Nonfinite detailed source geometry.');bounds.expandByPoint(point);
    }
    for(const attribute of Object.values(geometry.attributes))reference(attribute instanceof InterleavedBufferAttribute?attribute.data.array:attribute.array);
    if(geometry.index)reference(geometry.index.array);triangles+=count/3;
    return {geometry,material,localMatrix,targetMaterialName:typeof material.userData.crownfallSourceMaterialName==='string'?material.userData.crownfallSourceMaterialName:material.name,
      semanticID:'ealdholt-far-detailed-part-'+index};
  });
  if(triangles!==woodland.trianglesPerTree||bounds.isEmpty()||Math.abs(bounds.min.y)>1e-4)throw Error('Detailed source family is not a complete grounded tree.');
  let referencedGeometryBytes=0;
  for(const intervals of byteRanges.values()){
    intervals.sort((a,b)=>a[0]-b[0]);let low=-1,high=-1;
    for(const [a,b]of intervals){if(a>high){if(high>=0)referencedGeometryBytes+=high-low;low=a;high=b;}else high=Math.max(high,b);}
    if(high>=0)referencedGeometryBytes+=high-low;
  }
  const canopyRadius=Math.hypot(Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x)),Math.max(Math.abs(bounds.min.z),Math.abs(bounds.max.z)));
  return {parts,bounds,canopyRadius,groundContactLocalY:0,triangles,geometryBytes:0,referencedGeometryBytes,sha256:null,
    kind:'borrowed-detailed',ownership:'borrowed',sourceFamily:woodland.sourceFamily,sourceOwner:privateModel,dispose(){/* All referenced resources remain owned by the existing local model. */}};
}
function borrowedMaterials(root:Object3D,names:readonly string[]) {
  const candidates=new Map<string,Set<Material>>();for(const name of names)candidates.set(name,new Set());
  root.traverse(o=>{if(o instanceof Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])candidates.get(typeof m.userData.crownfallSourceMaterialName==='string'?m.userData.crownfallSourceMaterialName:m.name)?.add(m);});
  return names.map(name=>{const set=candidates.get(name)!;if(set.size!==1)throw Error('Far woodland requires one exact existing material binding: '+name);return set.values().next().value!;});
}
/** New instance buffers only. The caller retains and disposes the imported
 * prototype AFTER this owner; local actors, geometry and materials stay intact. */
export function createEaldholtFarWoodland(privateModel:Object3D,options:{
  readonly prototype:EaldholtFarWoodlandLod;readonly materialRoot?:Object3D;readonly landOwners:readonly Object3D[];readonly waterOwners?:readonly Object3D[];
  readonly geography:EaldholtFarGeography;readonly existingPlacements:readonly EaldholtWoodlandPlacement[];
  readonly existingCanopyRadius:number;readonly maximumTrees?:number;readonly profile?:'desktop'|'quest';
  readonly quality?:'low'|'medium'|'high';readonly groves?:readonly EaldholtFarGrove[];
}):EaldholtFarWoodland {
  if(options.profile==='quest')throw Error('Far woodland is not qualified outside the Native miniature.');
  const prototype=options.prototype,detailed=prototype.kind==='borrowed-detailed';
  const budget=detailed?EALDHOLT_FAR_WOODLAND_BUDGET:EALDHOLT_FAR_WOODLAND_LOD_BUDGET;
  const actualTriangles=prototype.parts.reduce((n,p)=>n+Math.min(p.geometry.index?.count??p.geometry.getAttribute('position')?.count??0,p.geometry.drawRange.count)/3,0);
  if(prototype.parts.length!==3||!Number.isInteger(prototype.triangles)||prototype.triangles<=0||actualTriangles!==prototype.triangles||prototype.bounds.isEmpty()
    ||(detailed?(prototype.ownership!=='borrowed'||prototype.geometryBytes!==0||prototype.sourceOwner!==privateModel)
      :(prototype.kind!=='private-native-lod'||prototype.ownership!=='owned'||prototype.triangles!==525||prototype.geometryBytes>128*1024)))throw Error('Incomplete far woodland prototype.');
  const maximum=options.maximumTrees??(detailed?48:96);
  if(!Number.isInteger(maximum)||maximum<0||maximum>budget.actors||maximum*prototype.triangles>budget.triangles)throw Error('Far woodland triangle/actor budget exceeded.');
  if(options.existingPlacements.length+maximum>budget.combinedActors)throw Error('Combined woodland actor budget exceeded.');
  if(detailed&&(options.existingPlacements.length+maximum)*prototype.triangles>budget.combinedTriangles)throw Error('Combined generated woodland triangle budget exceeded.');
  const materialRoot=options.materialRoot??privateModel;
  if(!isAttached(privateModel,materialRoot))throw Error('Far woodland material owner belongs to another source model.');
  const materials=detailed?prototype.parts.map(p=>{if(!p.material)throw Error('Detailed far woodland requires its actual live source materials.');return p.material;})
    :borrowedMaterials(materialRoot,prototype.parts.map(p=>p.targetMaterialName));
  const land=collectEaldholtWoodlandSurfaces(privateModel,options.landOwners,'terrain'),water=collectEaldholtWoodlandSurfaces(privateModel,options.waterOwners??options.landOwners,'water');
  if(!land.length)throw Error('Far woodland requires actual owned land support.');
  const layout=createEaldholtFarWoodlandLayout({land,water,geography:options.geography,existingPlacements:options.existingPlacements,
    existingCanopyRadius:options.existingCanopyRadius,canopyRadius:prototype.canopyRadius,maximumTrees:maximum,groves:options.groves});
  const placements=layout.placements,object=new Group();object.name='House Ealdholt Complete Far Woodland';
  const owned:InstancedMesh[]=[],bounds=new Box3(),point=new Vector3(),scale=new Vector3(),rotation=new Quaternion(),up=new Vector3(0,1,0),matrix=new Matrix4(),actorFrame=new Matrix4(),identity=new Matrix4();
  try {
    for(let part=0;part<prototype.parts.length;part++) {
      if(!placements.length)break;
      const source=prototype.parts[part],mesh=new InstancedMesh(source.geometry,materials[part],placements.length),partBounds=new Box3(),partFrame=source.localMatrix??identity;
      mesh.name='Ealdholt far woodland '+source.semanticID;mesh.castShadow=false;mesh.receiveShadow=true;
      const local=new Box3(),pos=source.geometry.getAttribute('position');for(let i=0;i<pos.count;i++)local.expandByPoint(point.fromBufferAttribute(pos,i));
      placements.forEach((p,id)=>{point.set(p.x,p.y-prototype.groundContactLocalY*p.scale,p.z);scale.setScalar(p.scale);rotation.setFromAxisAngle(up,p.yaw);actorFrame.compose(point,rotation,scale);matrix.multiplyMatrices(actorFrame,partFrame);mesh.setMatrixAt(id,matrix);mesh.getMatrixAt(id,matrix);partBounds.union(local.clone().applyMatrix4(matrix));});
      mesh.instanceMatrix.needsUpdate=true;mesh.boundingBox=partBounds;mesh.boundingSphere=partBounds.getBoundingSphere(new Sphere());
      mesh.userData.crownfallFarSurround={schema:1,ownedSurface:'woodland',localPlacementEligible:false,fullBoundsRequired:true};
      mesh.userData.crownfallElderbloom={kind:'vegetation',completeSourceFamily:true,prototypeKind:prototype.kind};object.add(mesh);owned.push(mesh);bounds.union(partBounds);
    }
  }catch(error){for(const mesh of owned)mesh.dispose();object.clear();throw error;}
  const instanceBytes=owned.reduce((sum,m)=>sum+m.instanceMatrix.array.byteLength,0),bufferBytes=prototype.geometryBytes+instanceBytes;
  const high=placements.length,counts={low:Math.min(detailed?16:32,high),medium:Math.min(detailed?32:64,high),high};
  const actualBounds=bounds.isEmpty()?null:{min:bounds.min.toArray() as[number,number,number],max:bounds.max.toArray() as[number,number,number]};
  let active=0,disposed=false;
  const metadata={schema:1,completeSourceFamily:true,prototypeKind:prototype.kind,ownership:prototype.ownership,sourceFamily:prototype.sourceFamily,sourceSha256:prototype.sha256,trianglesPerActor:prototype.triangles,highActors:high,activeActors:0,
    triangles:high*prototype.triangles,activeTriangles:0,drawCalls:owned.length,geometryBytes:prototype.geometryBytes,referencedGeometryBytes:prototype.referencedGeometryBytes,instanceBytes,bufferBytes,
    extraTextureBytes:0,sourceActorsUntouched:true,borrowedMaterialsAndMaps:true,localPlacementEligible:false,
    fullBoundsRequired:true,bounds:actualBounds,counts,groves:layout.groves,acceptedPerGrove:layout.acceptedPerGrove,rejected:layout.rejected,
    budgets:budget};
  object.userData.crownfallFarSurround={schema:1,ownedSurface:'woodland',localPlacementEligible:false,fullBoundsRequired:true};object.userData.crownfallFarWoodland=metadata;
  const setQuality=(quality:'low'|'medium'|'high')=>{if(disposed)return;if(!Object.prototype.hasOwnProperty.call(counts,quality))throw Error('Invalid far woodland quality.');active=counts[quality];for(const mesh of owned)mesh.count=active;metadata.activeActors=active;metadata.activeTriangles=active*prototype.triangles;};
  setQuality(options.quality??'high');
  return {object,placements,instanceCount:high,triangles:high*prototype.triangles,drawCalls:owned.length,bufferBytes,geometryBytes:prototype.geometryBytes,referencedGeometryBytes:prototype.referencedGeometryBytes,instanceBytes,
    extraTextureBytes:0,counts,trianglesPerTree:prototype.triangles,prototypeKind:prototype.kind,ownership:prototype.ownership,sourceFamily:prototype.sourceFamily,bounds:actualBounds,layout,get activeActors(){return active;},get activeTriangles(){return active*prototype.triangles;},setQuality,
    dispose(){if(disposed)return;disposed=true;object.removeFromParent();for(const mesh of owned)mesh.dispose();object.clear();},
  };
}

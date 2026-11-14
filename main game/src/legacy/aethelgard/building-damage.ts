import {Box3,BufferGeometry,InstancedBufferAttribute,InstancedMesh,InterleavedBufferAttribute,Matrix4,Mesh,MeshDepthMaterial,MeshDistanceMaterial,MeshStandardMaterial,
 RGBADepthPacking,Vector3,Vector4,type Material,type Object3D}from'three';
import type{BuildingConditionRecord}from'../../../../shared/legacy/aethelgard/observer/building-damage';
import{buildSourceBuildingCatalogue,buildingPartKind,containsBuildingPoint,type BuildingSourcePart,type SourceBuilding,type SourcePoint}from'../../../../shared/legacy/aethelgard/observer/building-damage-catalogue';
import{BUILDING_DAMAGE_PROGRAM_KEY,patchBuildingDamageShader}from'../../../../shared/legacy/aethelgard/observer/building-damage-shader';
import{buildingSourceFingerprint,buildingSourcePartId}from'../../../../shared/legacy/aethelgard/observer/building-source-identity';
import{staticSourceBounds}from'./static-source-bounds';
import{createBuildingCollapse,type BuildingPhysicalDisasterRecord}from'../../../../shared/legacy/aethelgard/observer/building-collapse';

type Part=Omit<BuildingSourcePart,'id'|'supported'>&{id:string;supported:boolean;mesh:Mesh;ordinal:number;frame:Matrix4;meshFrame:Matrix4};
type Uniforms={cfBuildingRow0:{value:Vector4};cfBuildingRow1:{value:Vector4};cfBuildingRow2:{value:Vector4};cfBuildingChar:{value:number}};
const identityRows=[1,0,0,0,0,1,0,0,0,0,1,0];
const attributeNames=['cfBuildingRow0','cfBuildingRow1','cfBuildingRow2','cfBuildingChar','cfBuildingPhysicalMatrix'];
const version=(geometry:BufferGeometry)=>{const p=geometry.getAttribute('position');return p instanceof InterleavedBufferAttribute?p.data.version:p.version;};
const sameMaterials=(a:Mesh['material'],b:Mesh['material'])=>a===b||Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((m,i)=>m===b[i]);
const materials=(mesh:Mesh)=>Array.isArray(mesh.material)?mesh.material:[mesh.material];
const rows=(matrix:Matrix4)=>{const e=matrix.elements;return[e[0],e[4],e[8],e[12],e[1],e[5],e[9],e[13],e[2],e[6],e[10],e[14]];};
const equalBinding=(a:SourceBuilding['binding'],b:SourceBuilding['binding'])=>a.catalogueId===b.catalogueId&&a.sourceSha256===b.sourceSha256&&a.profile===b.profile&&a.buildingId===b.buildingId&&a.siteIndex===b.siteIndex;

/** Read-only extraction from the loaded source, including every real instance
 * and negative-scale repair child. Call before render-scoped count changes. */
function sourceParts(root:Object3D):Part[]{
 root.updateWorldMatrix(true,true);const parts:Part[]=[],geometryKeys=new Map<BufferGeometry,string>();
 function visit(node:Object3D,parentFrame:Matrix4,isRoot=false){
  const authoredFrame=isRoot?new Matrix4():parentFrame.clone().multiply(node.matrix);
  const kind=buildingPartKind(node.name);
  if(node instanceof Mesh&&kind){
   const geometry=node.geometry,p=geometry.getAttribute('position');
   if(p){
    const base=staticSourceBounds(geometry),frame=authoredFrame,instance=new Matrix4();
    let geometryKey=geometryKeys.get(geometry);if(!geometryKey){
     const keys:string[]=[];for(const name of Object.keys(geometry.attributes).sort()){const a=geometry.getAttribute(name),data=a instanceof InterleavedBufferAttribute?a.data.array:a.array;keys.push(name+':'+a.itemSize+':'+a.normalized+':'+data.constructor.name+':'+(a instanceof InterleavedBufferAttribute?a.offset+':'+a.data.stride:'packed')+':'+buildingSourceFingerprint(new Uint8Array(data.buffer,data.byteOffset,data.byteLength)));}
     if(geometry.index){const data=geometry.index.array;keys.push('index:'+buildingSourceFingerprint(new Uint8Array(data.buffer,data.byteOffset,data.byteLength)));}
     const encoded=new TextEncoder().encode(JSON.stringify(keys));geometryKey=buildingSourceFingerprint(encoded);geometryKeys.set(geometry,geometryKey);
    }
    const supported=!('isSkinnedMesh'in node)&&!Object.keys(geometry.morphAttributes).length
     &&materials(node).every(m=>m instanceof MeshStandardMaterial&&!m.displacementMap)
     &&(!node.customDepthMaterial||node.customDepthMaterial instanceof MeshDepthMaterial)&&(!node.customDistanceMaterial||node.customDistanceMaterial instanceof MeshDistanceMaterial)
     &&!attributeNames.some(name=>geometry.hasAttribute(name))
     &&Object.keys(geometry.attributes).reduce((n,key)=>n+Math.ceil(geometry.getAttribute(key).itemSize/4),node instanceof InstancedMesh?8+(node.instanceColor?1:0):0)<=16;
    const count=node instanceof InstancedMesh?node.instanceMatrix.count:1;
    if(parts.length+count>4096)throw Error('Source building catalogue exceeds its bounded4096-part admission.');
    for(let ordinal=0;ordinal<count;ordinal++){
     const placed=frame.clone();if(node instanceof InstancedMesh){node.getMatrixAt(ordinal,instance);placed.multiply(instance);}
     const b=base.clone().applyMatrix4(placed),finite=placed.elements.every(Number.isFinite)&&Math.abs(placed.determinant())>1e-10;
     parts.push({id:buildingSourcePartId(node.name,geometryKey,placed.elements,ordinal),kind,bounds:{min:b.min.toArray()as SourcePoint,max:b.max.toArray()as SourcePoint},supported:supported&&finite,sourceActor:node.name,sourceOrdinal:ordinal,sourceWorldMatrix:Object.freeze([...placed.elements]),mesh:node,ordinal,frame:placed,meshFrame:frame});
    }
   }
  }
  node.children.forEach(child=>visit(child,authoredFrame));
 }
 visit(root,new Matrix4(),true);
 const ids=new Map<string,Part[]>();for(const part of parts){const list=ids.get(part.id)??[];list.push(part);ids.set(part.id,list);}
 for(const list of ids.values())if(list.length>1)list.forEach((part,index)=>{part.supported=false;part.id+=':held-duplicate-'+index;});
 return parts;
}
interface Entry{
 mesh:Mesh;sourceVersion:number;sourceFrame:Matrix4;sourceInstances:Float32Array|null;originalGeometry:BufferGeometry;geometry:BufferGeometry;originalMaterial:Mesh['material'];assigned:Mesh['material'];
 originalDepth:Mesh['customDepthMaterial'];originalDistance:Mesh['customDistanceMaterial'];depth:MeshDepthMaterial;distance:MeshDistanceMaterial;
 rowAttributes:InstancedBufferAttribute[];uniforms:Uniforms;values:Float32Array;chars:Float32Array;
 originalBox:Box3|null|undefined;originalSphere:InstancedMesh['boundingSphere']|undefined;ownedBox:Box3|null|undefined;ownedSphere:InstancedMesh['boundingSphere']|undefined;
 sourceLocal:Matrix4;expectedFrame:Matrix4;sourceAutoUpdate:boolean;
 originalInstanceAttribute:InstancedBufferAttribute|null;ownedInstanceAttribute:InstancedBufferAttribute|null;expectedInstances:Float32Array|null;
}
export interface BuildingDamageVisualOptions{
 readonly sourceRoot:Object3D;readonly sourceSha256:string;readonly profile:'desktop'|'quest';
 /** Explicit source-module gravity/contact mode. Coordinates are in source metres. */
 /** Use the saved world's clock duration; the accelerated village minute is
  * not necessarily sixty real seconds. Terrain queries stay source-local. */
 readonly physicalCollapse?:{readonly groundHeight?:(x:number,z:number)=>number;readonly secondsPerWorldMinute?:()=>number};
 /** Whole-view preparation drain THEN a fresh GPU fence; rejected fences hold
  * borrowed-buffer wrappers and their program resources rather than freeing early. */
 readonly retirementFence:()=>Promise<void>;
}
export function createBuildingDamageVisuals(options:BuildingDamageVisualOptions){
 const parts=sourceParts(options.sourceRoot),catalogue=buildSourceBuildingCatalogue({...options,parts:parts.map(p=>Object.freeze({id:p.id,kind:p.kind,bounds:p.bounds,supported:p.supported,sourceActor:p.sourceActor,sourceOrdinal:p.sourceOrdinal,sourceWorldMatrix:p.sourceWorldMatrix}))});
 const collapse=options.physicalCollapse?createBuildingCollapse({buildings:catalogue.buildings,groundHeight:options.physicalCollapse.groundHeight,secondsPerWorldMinute:options.physicalCollapse.secondsPerWorldMinute}):null;
 const byId=new Map(parts.map(p=>[p.id,p])),entries=new Map<Mesh,Entry>(),ownedMaterials=new Set<Material>(),ownedGeometry=new Set<BufferGeometry>(),damaged=new Map<string,SourceBuilding>();
 const sharedClones=new Map<Material,Material>(),defaultDepth=new MeshDepthMaterial({depthPacking:RGBADepthPacking}),defaultDistance=new MeshDistanceMaterial();let disposed=false,retired:Promise<void>=Promise.resolve(),lastRecords:readonly Pick<BuildingConditionRecord,'binding'|'condition'|'rebuild'>[]|null=null;
 let physicalCharSignature='';
 const stats={catalogueId:catalogue.catalogueId,sourceBuildings:catalogue.buildings.length,raidSites:catalogue.sites.length,heldComponents:catalogue.held,
  sourceParts:catalogue.buildings.reduce((n,b)=>n+b.parts.length,0),damagedBuildings:0,collapsedParts:0,ownedMaterials:0,ownedAttributeBytes:0,sourceGeometryUntouched:true,collisionChanged:false,navigationChanged:false,physicalCollapse:!!collapse,physicalRevision:0,physicalSteps:0,physicalContacts:0,fallingParts:0,settledParts:0,restoredParts:0,contactModel:collapse?.stats.contactModel??null,retirement:'active',error:''};
 function cloneMaterial<T extends Material>(original:T,instanced:boolean,shadow:boolean,uniforms:Uniforms):T{
  const cached=instanced?sharedClones.get(original):undefined;if(cached)return cached as T;
  const clone=original.clone(),compile=original.onBeforeCompile,key=original.customProgramCacheKey;
  clone.onBeforeRender=original.onBeforeRender;
  clone.onBeforeCompile=function(shader,renderer){compile.call(this,shader,renderer);patchBuildingDamageShader(shader,instanced,shadow);if(!instanced)Object.assign(shader.uniforms,uniforms);};
  clone.customProgramCacheKey=function(){return key.call(this)+BUILDING_DAMAGE_PROGRAM_KEY+':'+instanced+':'+shadow;};
  clone.userData.crownfallBuildingDamage={version:1,sourceSha256:options.sourceSha256,visualOnly:!collapse};
  ownedMaterials.add(clone);if(instanced)sharedClones.set(original,clone);return clone;
 }
 function attach(mesh:Mesh):Entry{
  const originalGeometry=mesh.geometry,geometry=new BufferGeometry();ownedGeometry.add(geometry);
  for(const[name,a]of Object.entries(originalGeometry.attributes))geometry.setAttribute(name,a);
  geometry.setIndex(originalGeometry.index);geometry.groups=originalGeometry.groups.map(g=>({...g}));geometry.setDrawRange(originalGeometry.drawRange.start,originalGeometry.drawRange.count);
  geometry.boundingBox=originalGeometry.boundingBox?.clone()??staticSourceBounds(originalGeometry);geometry.boundingSphere=originalGeometry.boundingSphere?.clone()??null;
  const count=mesh instanceof InstancedMesh?mesh.instanceMatrix.count:1,values=new Float32Array(count*12),chars=new Float32Array(count);
  const uniforms:Uniforms={cfBuildingRow0:{value:new Vector4(1,0,0,0)},cfBuildingRow1:{value:new Vector4(0,1,0,0)},cfBuildingRow2:{value:new Vector4(0,0,1,0)},cfBuildingChar:{value:0}};
  const rowAttributes:InstancedBufferAttribute[]=[];
  for(let i=0;i<count;i++)values.set(identityRows,i*12);
  if(mesh instanceof InstancedMesh){
   for(let row=0;row<3;row++){const data=new Float32Array(count*4);for(let i=0;i<count;i++)data.set(identityRows.slice(row*4,row*4+4),i*4);const a=new InstancedBufferAttribute(data,4);rowAttributes.push(a);geometry.setAttribute(attributeNames[row],a);}
   geometry.setAttribute('cfBuildingChar',new InstancedBufferAttribute(chars,1));stats.ownedAttributeBytes+=count*13*4;
  }
  const originalMaterial=mesh.material,assigned=Array.isArray(originalMaterial)?originalMaterial.map(m=>cloneMaterial(m,mesh instanceof InstancedMesh,false,uniforms)):cloneMaterial(originalMaterial,mesh instanceof InstancedMesh,false,uniforms);
  const originalDepth=mesh.customDepthMaterial,originalDistance=mesh.customDistanceMaterial;
  const depthBase=originalDepth??defaultDepth,distanceBase=originalDistance??defaultDistance;
  const depth=cloneMaterial(depthBase,mesh instanceof InstancedMesh,true,uniforms)as MeshDepthMaterial,distance=cloneMaterial(distanceBase,mesh instanceof InstancedMesh,true,uniforms)as MeshDistanceMaterial;
  const entry:Entry={mesh,sourceVersion:version(originalGeometry),sourceFrame:parts.find(p=>p.mesh===mesh)!.meshFrame.clone(),sourceInstances:mesh instanceof InstancedMesh?Float32Array.from(mesh.instanceMatrix.array):null,originalGeometry,geometry,originalMaterial,assigned,originalDepth,originalDistance,depth,distance,uniforms,values,chars,rowAttributes,
   originalBox:mesh instanceof InstancedMesh?mesh.boundingBox:undefined,originalSphere:mesh instanceof InstancedMesh?mesh.boundingSphere:undefined,ownedBox:undefined,ownedSphere:undefined,
   sourceLocal:mesh.matrix.clone(),expectedFrame:parts.find(p=>p.mesh===mesh)!.meshFrame.clone(),sourceAutoUpdate:mesh.matrixAutoUpdate,
   originalInstanceAttribute:mesh instanceof InstancedMesh?mesh.instanceMatrix:null,ownedInstanceAttribute:collapse&&mesh instanceof InstancedMesh?mesh.instanceMatrix.clone()as InstancedBufferAttribute:null,expectedInstances:collapse&&mesh instanceof InstancedMesh?Float32Array.from(mesh.instanceMatrix.array):null};
  if(mesh instanceof InstancedMesh&&entry.ownedInstanceAttribute){mesh.instanceMatrix=entry.ownedInstanceAttribute;geometry.setAttribute('cfBuildingPhysicalMatrix',entry.ownedInstanceAttribute);stats.ownedAttributeBytes+=entry.ownedInstanceAttribute.array.byteLength;}
  mesh.geometry=geometry;mesh.material=assigned;mesh.customDepthMaterial=depth;mesh.customDistanceMaterial=distance;entries.set(mesh,entry);return entry;
 }
 // Install zero-weight hooks before the environment clones materials. Rebuilds
 // update small owned attributes/uniforms and never make another program variant.
 try{for(const building of catalogue.buildings)for(const source of building.parts){const p=byId.get(source.id)!;if(!entries.has(p.mesh))attach(p.mesh);}}
 catch(cause){
  // Construction is synchronous and no private view has been submitted. Roll
  // back partial clone failure before the caller can publish this owner.
  for(const e of entries.values()){e.mesh.geometry=e.originalGeometry;e.mesh.material=e.originalMaterial;e.mesh.customDepthMaterial=e.originalDepth;e.mesh.customDistanceMaterial=e.originalDistance;if(e.mesh instanceof InstancedMesh&&e.originalInstanceAttribute)e.mesh.instanceMatrix=e.originalInstanceAttribute;}
  for(const g of ownedGeometry){g.index=null;for(const name of Object.keys(g.attributes))if(!attributeNames.includes(name))g.deleteAttribute(name);g.dispose();}
  for(const m of ownedMaterials)m.dispose();defaultDepth.dispose();defaultDistance.dispose();throw cause;
 }
 defaultDepth.dispose();defaultDistance.dispose();stats.ownedMaterials=ownedMaterials.size;
 function sourceStillValid(entry:Entry):boolean{
  return entry.mesh.geometry===entry.geometry&&entry.originalGeometry.getAttribute('position')===entry.geometry.getAttribute('position')&&version(entry.originalGeometry)===entry.sourceVersion
   &&new Matrix4().copy(options.sourceRoot.matrixWorld).invert().multiply(entry.mesh.matrixWorld).elements.every((v,i)=>Math.abs(v-entry.expectedFrame.elements[i])<=1e-8*Math.max(1,Math.abs(entry.expectedFrame.elements[i])))
   &&!(collapse&&entry.originalInstanceAttribute&&!entry.sourceInstances?.every((v,i)=>v===entry.originalInstanceAttribute!.array[i]))
   &&!(entry.mesh instanceof InstancedMesh&&(entry.mesh.instanceMatrix.count!==entry.chars.length||collapse&&entry.mesh.instanceMatrix!==entry.ownedInstanceAttribute||!(entry.expectedInstances??entry.sourceInstances)?.every((v,i)=>v===(entry.mesh as InstancedMesh).instanceMatrix.array[i])));
 }
 function boundsForCurrentDisplay(entry:Entry):void{
  const box=staticSourceBounds(entry.originalGeometry);entry.geometry.boundingBox=box.clone();
  for(let i=0;i<entry.chars.length;i++){
   const v=entry.values.subarray(i*12,i*12+12),a=new Matrix4().set(v[0],v[1],v[2],v[3],v[4],v[5],v[6],v[7],v[8],v[9],v[10],v[11],0,0,0,1);
   entry.geometry.boundingBox.union(box.clone().applyMatrix4(a));
  }
  entry.geometry.computeBoundingSphere();
  if(entry.mesh instanceof InstancedMesh){entry.mesh.boundingBox=null;entry.mesh.boundingSphere=null;entry.mesh.computeBoundingBox();entry.mesh.computeBoundingSphere();entry.ownedBox=entry.mesh.boundingBox;entry.ownedSphere=entry.mesh.boundingSphere;}
 }
 function applyPhysical():boolean{
  if(!collapse)return false;
  let changed=false;
  const deltas=new Map<string,Matrix4>(),desired=new Map<Mesh,Matrix4>();
  for(const t of collapse.transforms()){
   const p=byId.get(t.sourcePartId)!,c=t.centre,d=t.translation,r=t.rotation;
   const delta=t.state==='source'||t.state==='restored'?new Matrix4():new Matrix4().makeTranslation(c[0]+d[0],c[1]+d[1],c[2]+d[2]).multiply(new Matrix4().makeRotationZ(r[2])).multiply(new Matrix4().makeRotationX(r[0])).multiply(new Matrix4().makeTranslation(-c[0],-c[1],-c[2]));
   deltas.set(p.id,delta);if(!(p.mesh instanceof InstancedMesh))desired.set(p.mesh,delta.clone().multiply(p.frame));
  }
  // Compute parent-relative matrices from absolute source poses. Repair children
  // and mirrored modules may be nested below another falling source module;
  // applying two independent world deltas as local transforms would move twice.
  function place(node:Object3D,parent:Matrix4,isRoot=false):void{
   const e=node instanceof Mesh?entries.get(node):undefined;
   let frame=isRoot?new Matrix4():parent.clone().multiply(e?.sourceLocal??node.matrix);
   if(e){
    const target=desired.get(e.mesh);
    if(target){
     const local=target.equals(e.sourceFrame)&&parent.clone().multiply(e.sourceLocal).equals(e.sourceFrame)?e.sourceLocal.clone():parent.clone().invert().multiply(target);
     if(!e.mesh.matrix.equals(local)){changed=true;e.mesh.matrix.copy(local);e.mesh.matrixWorldNeedsUpdate=true;}
     e.mesh.matrixAutoUpdate=local.equals(e.sourceLocal)?e.sourceAutoUpdate:false;frame=target;
    }
    e.expectedFrame.copy(frame);
    if(e.mesh instanceof InstancedMesh){
     const values=Float32Array.from(e.sourceInstances!),inverse=frame.clone().invert();
     for(const p of parts)if(p.mesh===e.mesh){const delta=deltas.get(p.id);if(frame.equals(e.sourceFrame)&&(!delta||delta.equals(new Matrix4())))continue;const target=inverse.clone().multiply(delta??new Matrix4()).multiply(p.frame);values.set(target.elements,p.ordinal*16);}
     if(!e.expectedInstances!.every((v,i)=>v===values[i])){changed=true;e.expectedInstances!.set(values);e.ownedInstanceAttribute!.array.set(values);e.ownedInstanceAttribute!.needsUpdate=true;boundsForCurrentDisplay(e);}
    }
   }
   for(const child of node.children)place(child,frame);
  }
  place(options.sourceRoot,new Matrix4(),true);options.sourceRoot.updateWorldMatrix(true,true);
  Object.assign(stats,{physicalRevision:collapse.stats.revision,physicalSteps:collapse.stats.steps,physicalContacts:collapse.stats.contacts,fallingParts:collapse.stats.fallingParts,settledParts:collapse.stats.settledParts,restoredParts:collapse.stats.restoredParts,collapsedParts:collapse.stats.fallingParts+collapse.stats.settledParts,collisionChanged:collapse.stats.activeBuildings>0,navigationChanged:collapse.stats.activeBuildings>0});
  return changed;
 }
 const api={
  stats,
  /** Complete original-source catalogue, including interior spread targets. */
  buildings(){return catalogue.buildings;},
  sites(){return catalogue.sites.map(b=>({index:b.binding.siteIndex,bearing:b.bearing,buildingBinding:b.binding}));},
  raidSites(){return catalogue.sites.map(b=>({index:b.binding.siteIndex,bearing:b.bearing,buildingBinding:b.binding,position:b.position,outward:b.outward}));},
  damagedBounds(){return[...damaged.values()].map(b=>({binding:b.binding,bounds:b.bounds}));},
  physicalColliders(){return collapse?.colliders()??[];},
  navigationObstacles(){return collapse?.navigationObstacles()??[];},
  intersectsSourceBounds(bounds:BuildingSourcePart['bounds']){return collapse?.intersects(bounds)??false;},
  containsSourcePoint(point:SourcePoint){if(collapse)return collapse.navigationObstacles().some(c=>containsBuildingPoint(c.bounds,point));for(const b of damaged.values())if(containsBuildingPoint(b.bounds,point))return true;return false;},
  updateDisasters(records:readonly BuildingPhysicalDisasterRecord[],minute:number):boolean{
   if(disposed||!collapse)return false;
   options.sourceRoot.updateWorldMatrix(true,true);
   // A later source owner cannot be reset, relocated or silently adopted by a
   // physical update, including when its original building is currently sound.
   if([...entries.values()].some(e=>!sourceStillValid(e))){stats.error='Source building geometry changed; physical collapse held.';return false;}
   const valid=records.filter(record=>catalogue.buildings.some(b=>equalBinding(b.binding,record.binding)));
   // Char uses the same existing environment/PBR shader hooks. Affine shader
   // rows remain identity: actual source transforms own physical movement.
   const charSignature=JSON.stringify(valid.map(r=>[r.binding,r.condition,r.rebuild]));let visualChanged=false;if(charSignature!==physicalCharSignature){visualChanged=api.update(valid);physicalCharSignature=charSignature;}
   const simulated=collapse.update(valid,minute),moved=simulated?applyPhysical():false;return visualChanged||moved||simulated;
  },
  update(records:readonly Pick<BuildingConditionRecord,'binding'|'condition'|'rebuild'>[]):boolean{
   if(disposed||records===lastRecords)return false;lastRecords=records;
   const next=new Map<Mesh,{values:Float32Array;chars:Float32Array}>();for(const e of entries.values()){const values=new Float32Array(e.values.length);for(let i=0;i<e.chars.length;i++)values.set(identityRows,i*12);next.set(e.mesh,{values,chars:new Float32Array(e.chars.length)});}
   damaged.clear();let collapsed=0;
   const seen=new Set<string>();
   for(const record of records){
    const building=catalogue.buildings.find(b=>equalBinding(b.binding,record.binding));
    if(!building||!['burned','rebuilding'].includes(record.condition)||seen.has(building.binding.buildingId))continue;
    seen.add(building.binding.buildingId);
    const all=building.parts.map(p=>byId.get(p.id)!);if(all.some(p=>!sourceStillValid(entries.get(p.mesh)!))){stats.error='Source building geometry changed; damage presentation held.';continue;}
    const required=record.rebuild?.labourRequired,done=record.rebuild?.labourDone;
    const repair=record.condition==='rebuilding'&&typeof required==='number'&&required>0&&typeof done==='number'&&Number.isFinite(done)?Math.max(0,Math.min(1,done/required)):0;
    const strength=1-repair,char=record.condition==='rebuilding'?1-.75*repair:1;
    damaged.set(building.binding.buildingId,building);
    const floor=building.bounds.min[1],height=building.bounds.max[1]-floor;
    const roof=all.filter(p=>(p.kind==='roof'||p.kind==='gable')&&(p.bounds.min[1]+p.bounds.max[1])/2>floor+height*.45);
    for(const p of all){
     const target=next.get(p.mesh)!;target.chars[p.ordinal]=char;
     const roofIndex=roof.indexOf(p);if(collapse||roofIndex<0||strength===0)continue;
     // Lower the actual authored upper component within its building envelope;
     // no replacement rubble, new mesh topology or collision opening is invented.
     const weight=strength*(roofIndex%2===0?1:.45),scale=1-.65*weight,pivot=floor+.7;
     const sourceAffine=new Matrix4().makeScale(1,scale,1);sourceAffine.elements[13]=pivot*(1-scale);
     const local=p.frame.clone().invert().multiply(sourceAffine).multiply(p.frame);
     target.values.set(rows(local),p.ordinal*12);collapsed++;
    }
   }
   let changed=false;
   for(const e of entries.values()){
    if(e.mesh.geometry!==e.geometry)continue;const n=next.get(e.mesh)!;
    if(e.chars.every((v,i)=>v===n.chars[i])&&e.values.every((v,i)=>v===n.values[i]))continue;
    changed=true;e.values.set(n.values);e.chars.set(n.chars);
    if(e.mesh instanceof InstancedMesh){for(let r=0;r<3;r++){const a=e.rowAttributes[r];for(let i=0;i<e.chars.length;i++)(a.array as Float32Array).set(e.values.subarray(i*12+r*4,i*12+r*4+4),i*4);a.needsUpdate=true;}(e.geometry.getAttribute('cfBuildingChar')as InstancedBufferAttribute).needsUpdate=true;}
    else{e.uniforms.cfBuildingRow0.value.fromArray(e.values,0);e.uniforms.cfBuildingRow1.value.fromArray(e.values,4);e.uniforms.cfBuildingRow2.value.fromArray(e.values,8);e.uniforms.cfBuildingChar.value=e.chars[0];}
    boundsForCurrentDisplay(e);
   }
   stats.damagedBuildings=damaged.size;if(!collapse)stats.collapsedParts=collapsed;return changed;
  },
  dispose(){
   if(disposed)return;disposed=true;damaged.clear();stats.retirement='fencing';
   retired=Promise.resolve().then(options.retirementFence).then(()=>{
    // Environment/GI owners must restore their clones first. Unknown later
    // bindings are never overwritten or freed out from under another reader.
    if([...entries.values()].some(e=>e.mesh.geometry===e.geometry&&(!sameMaterials(e.mesh.material,e.assigned)||(e.mesh.customDepthMaterial!==e.depth&&e.mesh.customDepthMaterial!==e.originalDepth)||(e.mesh.customDistanceMaterial!==e.distance&&e.mesh.customDistanceMaterial!==e.originalDistance))))throw Error('Building damage is still borrowed by a later material owner.');
    options.sourceRoot.updateWorldMatrix(true,true);
    if(collapse&&[...entries.values()].some(e=>!sourceStillValid(e)))throw Error('Building collapse source transforms are still held by another owner.');
    for(const e of entries.values()){
     if(e.mesh.geometry===e.geometry)e.mesh.geometry=e.originalGeometry;
     if(sameMaterials(e.mesh.material,e.assigned))e.mesh.material=e.originalMaterial;
     if(e.mesh.customDepthMaterial===e.depth)e.mesh.customDepthMaterial=e.originalDepth;
     if(e.mesh.customDistanceMaterial===e.distance)e.mesh.customDistanceMaterial=e.originalDistance;
     if(e.mesh instanceof InstancedMesh){if(e.mesh.instanceMatrix===e.ownedInstanceAttribute&&e.originalInstanceAttribute)e.mesh.instanceMatrix=e.originalInstanceAttribute;if(e.mesh.boundingBox===e.ownedBox)e.mesh.boundingBox=e.originalBox??null;if(e.mesh.boundingSphere===e.ownedSphere)e.mesh.boundingSphere=e.originalSphere??null;}
     else if(new Matrix4().copy(options.sourceRoot.matrixWorld).invert().multiply(e.mesh.matrixWorld).elements.every((v,i)=>Math.abs(v-e.expectedFrame.elements[i])<=1e-8*Math.max(1,Math.abs(e.expectedFrame.elements[i])))){e.mesh.matrix.copy(e.sourceLocal);e.mesh.matrixAutoUpdate=e.sourceAutoUpdate;e.mesh.matrixWorldNeedsUpdate=true;}
     e.geometry.index=null;for(const name of Object.keys(e.geometry.attributes))if(!attributeNames.includes(name))e.geometry.deleteAttribute(name);e.geometry.dispose();
    }
    for(const m of ownedMaterials)m.dispose();entries.clear();ownedMaterials.clear();ownedGeometry.clear();stats.ownedMaterials=0;stats.ownedAttributeBytes=0;stats.damagedBuildings=0;stats.collapsedParts=0;stats.retirement='retired';
    collapse?.clear();stats.collisionChanged=false;stats.navigationChanged=false;stats.fallingParts=0;stats.settledParts=0;stats.restoredParts=0;
   }).catch(cause=>{stats.retirement='held-error';stats.error=String(cause).slice(0,220);});
  },
  get whenRetired(){return retired;},
 };return api;
}
export type BuildingDamageVisuals=ReturnType<typeof createBuildingDamageVisuals>;

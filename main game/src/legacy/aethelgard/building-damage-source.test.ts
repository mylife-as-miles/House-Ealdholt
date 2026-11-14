/** Optional exact-source metadata test. Runtime meshes below are CPU-only
 * original source buffers/frames, never replacement scenery or screenshot evidence.
 * Reads GLB JSON + only modular-actor geometry/TRS ranges; no textures or full-world parse. */
import test from'node:test';import assert from'node:assert/strict';
import{open}from'node:fs/promises';import{createHash}from'node:crypto';
import{Box3,BufferAttribute,BufferGeometry,InterleavedBuffer,InterleavedBufferAttribute,Group,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,Quaternion,Vector3}from'three';
import{buildingPartKind}from'../../../../shared/legacy/aethelgard/observer/building-damage-catalogue';
import{createBuildingDamageVisuals}from'./building-damage';
const profiles=[{profile:'desktop'as const,path:process.env.CROWNFALL_BUILDING_DESKTOP_SOURCE_GLB,sha:'3b02834505642a5a9e7535e92812df8e565b99005e9921d41be83be4f5da3b28',json:'fb9887f83c5ae189df52674e07bc9bc68bcb8d1a6757c8fccc6c770e6a92251e',parts:282},
 {profile:'quest'as const,path:process.env.CROWNFALL_BUILDING_QUEST_SOURCE_GLB,sha:'71ed6b23e363e26369164aec387d68e6178850a861eadd8d9b5482f1e50f8e67',json:'16a7cb58bd9812d82d91a02e2613aa77b91ed0e8ba5684fefc6a2cb50837ca0b',parts:279}];
for(const source of profiles)test(source.profile+': pinned source actor ordinals give 19 modular components without changing any source buffers',{skip:!source.path},async()=>{
 const f=await open(source.path!,'r');let readBytes=0;
 const read=async(n:number,at:number)=>{const b=Buffer.alloc(n),r=await f.read(b,0,n,at);assert.equal(r.bytesRead,n);readBytes+=n;return b;};
 try{
  const h=await read(20,0);assert.equal(h.readUInt32LE(0),0x46546c67);const size=h.readUInt32LE(12);assert.ok(size<3*1024*1024);const bytes=await read(size,20),jsonHash=createHash('sha256').update(bytes).digest('hex');if(source.json)assert.equal(jsonHash,source.json);
  const j=JSON.parse(bytes.toString()),bin=28+size,material=new MeshStandardMaterial(),geometries:BufferGeometry[]=[],meshes:Mesh[]=[],raw:Float32Array[]=[];
  const values=async(id:number,width:number)=>{const a=j.accessors[id],v=j.bufferViews[a.bufferView];assert.equal(a.componentType,5126);assert.equal(a.sparse,undefined);const stride=v.byteStride??width*4,b=await read(a.count*stride,bin+(v.byteOffset??0)+(a.byteOffset??0));return Array.from({length:a.count},(_,i)=>Array.from({length:width},(_,k)=>b.readFloatLE(i*stride+4*k)));};
  const attributes=new Map<number,BufferAttribute|InterleavedBufferAttribute>();
  async function attribute(id:number):Promise<BufferAttribute|InterleavedBufferAttribute>{
   const cached=attributes.get(id);if(cached)return cached;const a=j.accessors[id],v=j.bufferViews[a.bufferView],width=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4}as Record<string,number>)[a.type];assert.ok(width);assert.equal(a.sparse,undefined);
   const Ctor=({5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array}as const)[a.componentType as 5126];assert.ok(Ctor);const unit=Ctor.BYTES_PER_ELEMENT;
   const interleaved=v.byteStride&&v.byteStride!==width*unit,start=interleaved?Math.floor((a.byteOffset??0)/v.byteStride)*v.byteStride:(a.byteOffset??0),length=a.count*(interleaved?v.byteStride:width*unit),raw=await read(length,bin+(v.byteOffset??0)+start),data=new Ctor(Uint8Array.from(raw).buffer);
   const out=interleaved?new InterleavedBufferAttribute(new InterleavedBuffer(data,v.byteStride/unit),width,((a.byteOffset??0)-start)/unit,Boolean(a.normalized)):new BufferAttribute(data,width,Boolean(a.normalized));attributes.set(id,out);return out;
  }
  async function node(id:number):Promise<Group|Mesh>{const n=j.nodes[id];let out:Group|Mesh=new Group();
   if(n.mesh!==undefined&&buildingPartKind(n.name??'')){
    const geometry=new BufferGeometry(),primitives=j.meshes[n.mesh].primitives;assert.equal(primitives.length,1);const primitive=primitives[0];
    const names:Record<string,string>={POSITION:'position',NORMAL:'normal',TANGENT:'tangent',TEXCOORD_0:'uv',TEXCOORD_1:'uv1',COLOR_0:'color'};
    for(const[semantic,id]of Object.entries(primitive.attributes)){assert.ok(names[semantic],semantic);geometry.setAttribute(names[semantic],await attribute(id as number));}
    if(primitive.indices!==undefined)geometry.setIndex(await attribute(primitive.indices)as BufferAttribute);
    const a=j.accessors[primitive.attributes.POSITION];geometry.boundingBox=new Box3(new Vector3().fromArray(a.min),new Vector3().fromArray(a.max));geometries.push(geometry);
    const ext=n.extensions?.EXT_mesh_gpu_instancing?.attributes;
    if(ext){const count=j.accessors[Object.values(ext)[0]as number].count,t=ext.TRANSLATION===undefined?null:await values(ext.TRANSLATION,3),r=ext.ROTATION===undefined?null:await values(ext.ROTATION,4),s=ext.SCALE===undefined?null:await values(ext.SCALE,3);const instanced=new InstancedMesh(geometry,material,count);
     for(let i=0;i<count;i++)instanced.setMatrixAt(i,new Matrix4().compose(new Vector3().fromArray(t?.[i]??[0,0,0]),new Quaternion().fromArray(r?.[i]??[0,0,0,1]),new Vector3().fromArray(s?.[i]??[1,1,1])));out=instanced;raw.push(Float32Array.from(instanced.instanceMatrix.array));
    }else out=new Mesh(geometry,material);meshes.push(out as Mesh);
   }
   out.name=n.name??'';if(n.matrix)out.applyMatrix4(new Matrix4().fromArray(n.matrix));else{out.position.fromArray(n.translation??[0,0,0]);out.quaternion.fromArray(n.rotation??[0,0,0,1]);out.scale.fromArray(n.scale??[1,1,1]);}
   for(const child of n.children??[])out.add(await node(child));return out;
  }
  const root=new Group();for(const id of j.scenes[j.scene??0].nodes)root.add(await node(id));
  const owner=createBuildingDamageVisuals({sourceRoot:root,sourceSha256:source.sha,profile:source.profile,retirementFence:async()=>{}});
  try{assert.equal(owner.stats.sourceBuildings,19);assert.equal(owner.stats.sourceParts,source.parts);assert.equal(owner.stats.heldComponents,0);assert.equal(owner.sites().length,10);
   for(const site of owner.sites()){assert.equal(site.buildingBinding.sourceSha256,source.sha);assert.equal(site.buildingBinding.profile,source.profile);assert.match(site.buildingBinding.buildingId,/^door:S_Medieval_Modular_Door_/u);}
   const binding=owner.sites()[0].buildingBinding;owner.update([{binding,condition:'burned',rebuild:null}]);assert.equal(owner.stats.damagedBuildings,1);assert.ok(owner.stats.collapsedParts>0);assert.ok(readBytes<8*1024*1024);
   let i=0;for(const mesh of meshes)if(mesh instanceof InstancedMesh)assert.deepEqual(mesh.instanceMatrix.array,raw[i++]);
   owner.dispose();await owner.whenRetired;
   const originalFrames=meshes.map(mesh=>mesh.matrixWorld.clone()),originals=meshes.map(mesh=>mesh instanceof InstancedMesh?mesh.instanceMatrix:null),physical=createBuildingDamageVisuals({sourceRoot:root,sourceSha256:source.sha,profile:source.profile,retirementFence:async()=>{},physicalCollapse:{}});
   try{
    const building=physical.buildings()[0],sourceMesh=(part:typeof building.parts[number])=>meshes.find((mesh,index)=>{if(mesh.name!==part.sourceActor)return false;const frame=originalFrames[index].clone();if(mesh instanceof InstancedMesh){if(part.sourceOrdinal!>=originals[index]!.count)return false;frame.multiply(new Matrix4().fromArray(originals[index]!.array,part.sourceOrdinal!*16));}return frame.elements.every((v,k)=>Math.abs(v-part.sourceWorldMatrix![k])<1e-7*Math.max(1,Math.abs(v)));}),record={binding:building.binding,condition:'burned'as const,rebuild:null,collapseAtMinute:100};
    assert.equal(physical.buildings().length,19);assert.equal(physical.physicalColliders().length,source.parts);physical.updateDisasters([record],101);assert.equal(physical.stats.error,'');assert.ok(physical.stats.settledParts>0);assert.ok(physical.stats.physicalContacts>0);
    for(const part of building.parts){assert.ok(part.sourceActor);assert.ok(part.sourceWorldMatrix?.length===16);const mesh=sourceMesh(part)!;assert.ok(mesh);const p=mesh.geometry.getAttribute('position'),matrix=mesh.matrixWorld.clone();if(mesh instanceof InstancedMesh){const instance=new Matrix4();mesh.getMatrixAt(part.sourceOrdinal!,instance);matrix.multiply(instance);}const collider=physical.physicalColliders().find(c=>c.sourcePartId===part.id)!;
     for(const index of[0,Math.floor(p.count/3),Math.floor(p.count*2/3),p.count-1]){const v=new Vector3().fromBufferAttribute(p,index).applyMatrix4(matrix);for(let k=0;k<3;k++)assert.ok(v.getComponent(k)>=collider.bounds.min[k]-1e-4&&v.getComponent(k)<=collider.bounds.max[k]+1e-4,'Original authored transformed vertices must stay within their current physical collider: '+JSON.stringify({actor:part.sourceActor,ordinal:part.sourceOrdinal,index,axis:k,actual:v.getComponent(k),min:collider.bounds.min[k],max:collider.bounds.max[k]}));}
    }
    let at=0;for(const mesh of meshes)if(mesh instanceof InstancedMesh){const source=raw[at++];assert.deepEqual(originals[meshes.indexOf(mesh)]!.array,source);for(let ordinal=0;ordinal<mesh.instanceMatrix.count;ordinal++)if(!building.parts.some(p=>sourceMesh(p)===mesh&&p.sourceOrdinal===ordinal))assert.deepEqual(Array.from(mesh.instanceMatrix.array).slice(ordinal*16,ordinal*16+16),Array.from(source).slice(ordinal*16,ordinal*16+16));}
    physical.updateDisasters([{...record,condition:'sound'}],102);at=0;for(const mesh of meshes)if(mesh instanceof InstancedMesh)assert.deepEqual(mesh.instanceMatrix.array,raw[at++]);
   }finally{physical.dispose();await physical.whenRetired;assert.equal(physical.stats.retirement,'retired');for(let index=0;index<meshes.length;index++)if(meshes[index]instanceof InstancedMesh)assert.equal((meshes[index]as InstancedMesh).instanceMatrix,originals[index]);}
   console.log(JSON.stringify({profile:source.profile,jsonHash,metadataBytesRead:readBytes,components:owner.stats.sourceBuildings,sourceParts:owner.stats.sourceParts,sites:owner.sites().map(s=>s.buildingBinding.buildingId)}));
  }finally{owner.dispose();await owner.whenRetired;for(const g of geometries)g.dispose();for(const m of meshes)if(m instanceof InstancedMesh)m.dispose();material.dispose();}
 }finally{await f.close();}
});

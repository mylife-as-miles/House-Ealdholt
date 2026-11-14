import{test}from'node:test';import assert from'node:assert/strict';
import{BufferAttribute,ClampToEdgeWrapping,LinearFilter,Mesh,MeshStandardMaterial,NearestFilter,NoColorSpace,ObjectSpaceNormalMap,SRGBColorSpace}from'three';
import{naturalRiparianTestFixture}from'./natural-riparian-test-fixture';import{prepareNaturalRiparianAsset}from'./natural-riparian-source';
import{naturalRiparianReservation}from'../../../../shared/legacy/aethelgard/environment/natural-riparian-policy';
for(const native of[false,true])test((native?'Native':'Desktop')+' actual source preparation pins canonical PBR/UV/alpha, owns GPU wrappers and preserves all original arrays/materials',async()=>{
 const f=await naturalRiparianTestFixture(native),original=f.root.children as Mesh[],before=original.map(m=>Array.from(m.geometry.attributes.position.array));let originalDisposals=0;
 for(const m of original){m.geometry.addEventListener('dispose',()=>originalDisposals++);(m.material as MeshStandardMaterial).addEventListener('dispose',()=>originalDisposals++);}
 try{const source=await prepareNaturalRiparianAsset(f.asset,native);assert.equal(source.plants.length,2);assert.ok(source.accountedBytes<naturalRiparianReservation(native));
  for(let i=0;i<2;i++){const p=source.plants[i],old=original[i],m=old.material as MeshStandardMaterial;assert.notEqual(p.geometry,old.geometry);assert.deepEqual(Array.from(p.geometry.attributes.position.array),before[i]);assert.notEqual(p.material,m);assert.notEqual(p.material.normalMap,m.normalMap);assert.equal(p.material.normalMap!.source,m.normalMap!.source);assert.notEqual(p.material.roughnessMap,m.roughnessMap);assert.notEqual(p.map,m.map);assert.equal(p.map.generateMipmaps,false);assert.equal(p.map.flipY,false);assert.equal(p.map.mipmaps.length,native?8:9);assert.equal(p.material.transparent,false);assert.equal(p.material.alphaTest,.5);assert.deepEqual(p.material.normalScale.toArray(),[1,-1]);assert.deepEqual(m.normalScale.toArray(),[1,-1]);assert.ok(p.map.image.data!.some((v,at)=>at%4===3&&v===0));}
  source.dispose();source.dispose();assert.equal(originalDisposals,0);assert.deepEqual(original.map(m=>Array.from(m.geometry.attributes.position.array)),before);
 }finally{f.dispose();}
});
for(const native of[false,true])test((native?'Native':'Desktop')+' canonical derivative-tangent handedness rejects unexpected attributes, accessor semantics and sign changes',async()=>{
 for(const kind of['positiveY','negativeX','otherY','objectSpace','tangent','colour','uv1','primitiveTangent','primitiveAccessor','primitiveMaterial','accessorNormalized','accessorType','runtimeNormalized','runtimeWidth']as const){const f=await naturalRiparianTestFixture(native);
  try{const mesh=f.root.children[0]as Mesh,g=mesh.geometry,m=mesh.material as MeshStandardMaterial,p=f.json.meshes[0].primitives[0];
   assert.deepEqual(m.normalScale.toArray(),[1,-1]);
   if(kind==='positiveY')m.normalScale.y=1;if(kind==='negativeX')m.normalScale.x=-1;if(kind==='otherY')m.normalScale.y=-.5;if(kind==='objectSpace')m.normalMapType=ObjectSpaceNormalMap;
   if(kind==='tangent')g.setAttribute('tangent',new BufferAttribute(new Float32Array(g.attributes.position.count*4),4));if(kind==='colour')g.setAttribute('color',g.attributes.normal.clone());if(kind==='uv1')g.setAttribute('uv1',g.attributes.uv.clone());
   if(kind==='primitiveTangent')p.attributes.TANGENT=p.attributes.NORMAL;if(kind==='primitiveAccessor')p.attributes.NORMAL=p.attributes.POSITION;if(kind==='primitiveMaterial')p.material=1;
   if(kind==='accessorNormalized')f.json.accessors[p.attributes.NORMAL].normalized=true;if(kind==='accessorType')f.json.accessors[p.attributes.NORMAL].type='VEC4';if(kind==='runtimeNormalized')g.attributes.normal.normalized=true;if(kind==='runtimeWidth')g.attributes.normal.itemSize=2;
   await assert.rejects(()=>prepareNaturalRiparianAsset(f.asset,native),/canonical (?:material binding|tangent\/accessor contract) mismatch/,kind);
  }finally{f.dispose();}
 }
});
test('canonical image/material/accessor pins cannot excuse changed diffuse, normal or ARM colour-space/sampler state',async()=>{
 for(const role of['map','normalMap','roughnessMap']as const)for(const mutation of['colour','wrapS','wrapT','min','mag','mips']as const){const f=await naturalRiparianTestFixture();
  try{const m=(f.root.children[0]as Mesh).material as MeshStandardMaterial,t=m[role]!;
   if(mutation==='colour')t.colorSpace=role==='map'?NoColorSpace:SRGBColorSpace;if(mutation==='wrapS')t.wrapS=ClampToEdgeWrapping;if(mutation==='wrapT')t.wrapT=ClampToEdgeWrapping;if(mutation==='min')t.minFilter=LinearFilter;if(mutation==='mag')t.magFilter=NearestFilter;if(mutation==='mips')t.generateMipmaps=false;
   await assert.rejects(()=>prepareNaturalRiparianAsset(f.asset),/colour-space\/sampler/);
  }finally{f.dispose();}
 }
 const f=await naturalRiparianTestFixture();try{for(const node of f.root.children){const m=(node as Mesh).material as MeshStandardMaterial;m.map!.anisotropy=m.normalMap!.anisotropy=m.roughnessMap!.anisotropy=4;}const source=await prepareNaturalRiparianAsset(f.asset);source.dispose();}finally{f.dispose();}
});
test('changed geometry, encoded PBR image, cutout mip and aborted owners fail closed before presentation',async()=>{
 for(const kind of['geometry','image','mip','binding','uv','cancel']as const){const f=await naturalRiparianTestFixture(),controller=new AbortController();
  try{if(kind==='geometry')(f.root.children[0]as Mesh).geometry.attributes.position.setX(0,999);
   if(kind==='image'||kind==='mip'){const parser=f.asset.parser,original=parser.getDependency.bind(parser),target=kind==='image'?f.json.asset.extras.plants[0].encodedImages[1].bufferView:f.json.asset.extras.plants[0].albedoMips[0].bufferView;parser.getDependency=async(type:string,index:number)=>{const b=await original(type,index)as ArrayBuffer;if(type==='bufferView'&&index===target){const changed=b.slice(0);new Uint8Array(changed)[0]^=1;return changed;}return b;};}
   const material=(f.root.children[0]as Mesh).material as MeshStandardMaterial;if(kind==='binding')material.normalMap=material.roughnessMap;if(kind==='uv')material.normalMap!.repeat.y=2;
   if(kind==='cancel')controller.abort();await assert.rejects(()=>prepareNaturalRiparianAsset(f.asset,false,controller.signal));
  }finally{f.dispose();}
 }
});

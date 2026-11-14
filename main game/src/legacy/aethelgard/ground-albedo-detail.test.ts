import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, NoColorSpace, SRGBColorSpace, Texture } from 'three';
import { applyEaldholtGroundAlbedoDetail } from './ground-albedo-detail';
import { EALDHOLT_GROUND_ALBEDO_CACHE_KEY } from '../../../../shared/legacy/aethelgard/environment/ground-albedo-detail';

test('owned albedo layer composes hooks and AO while restoring materials and disposing only configured clones',()=>{
  const root=new Group(),earth=new Texture(),rock=new Texture(),atlas=new Texture(),orm=new Texture(),normal=new Texture();orm.channel=2;
  const source=new MeshStandardMaterial({map:atlas,roughnessMap:orm,aoMap:orm,normalMap:normal});source.normalScale.set(.45,.45);source.aoMapIntensity=1;
  source.name='Crownfall_LAAS_BakedGround_Review_earth_Microdetail_CavityAo';source.userData.crownfallGroundDetail={kind:'earth',uvChannel:2};
  let calls=0;source.onBeforeCompile=function(shader){calls++;shader.fragmentShader+='\n// preserved hook';};source.customProgramCacheKey=()=>'original-cache-key';
  const geometry=new BoxGeometry(),ground=new Mesh(geometry,source),shared=new Mesh(geometry,source);root.add(ground,shared);
  let borrowedDisposals=0;for(const texture of [earth,rock,atlas,orm,normal])texture.addEventListener('dispose',()=>borrowedDisposals++);
  source.addEventListener('dispose',()=>borrowedDisposals++);
  const look=applyEaldholtGroundAlbedoDetail(root,{earth:{texture:earth,meanLuminance:.0432},rock:{texture:rock,meanLuminance:.0311}});
  const replacement=ground.material;assert.equal(look.materialCount,1);assert.equal(look.textureCount,1);assert.equal(shared.material,replacement);assert.notEqual(replacement,source);
  assert.equal(replacement.map,atlas);assert.equal(replacement.aoMap,orm);assert.equal(replacement.roughnessMap,orm);assert.equal(replacement.normalMap,normal);assert.deepEqual(replacement.normalScale.toArray(),[.45,.45]);
  const shader={uniforms:{} as Record<string,{value:unknown}>,fragmentShader:'#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>'};
  replacement.onBeforeCompile(shader as never,null as never);assert.equal(calls,1);assert.match(shader.fragmentShader,/preserved hook/);
  const configured=shader.uniforms.uEaldholtGroundAlbedoDetail.value as Texture;
  assert.notEqual(configured,earth);assert.equal(configured.source,earth.source);assert.equal(configured.colorSpace,SRGBColorSpace);assert.equal(configured.flipY,false);
  assert.equal(earth.flipY,true);assert.notEqual(earth.colorSpace,SRGBColorSpace);assert.equal(source.name,'Crownfall_LAAS_BakedGround_Review_earth_Microdetail_CavityAo');
  assert.equal(replacement.customProgramCacheKey(),'original-cache-key'+EALDHOLT_GROUND_ALBEDO_CACHE_KEY);
  let disposed=0;configured.addEventListener('dispose',()=>disposed++);replacement.addEventListener('dispose',()=>disposed++);
  look.dispose();look.dispose();assert.equal(disposed,2);assert.equal(borrowedDisposals,0);assert.equal(ground.material,source);assert.equal(shared.material,source);
  geometry.dispose();source.dispose();for(const texture of [earth,rock,atlas,orm,normal])texture.dispose();
});

test('photographic optional PBR maps share UV orientation and remain clone-owned',()=>{
  const root=new Group(),albedo=new Texture(),normal=new Texture(),orm=new Texture(),atlas=new Texture(),old=new Texture();old.channel=2;old.repeat.set(2,3);old.offset.set(.1,.2);
  const source=new MeshStandardMaterial({map:atlas,roughnessMap:old,normalMap:old,aoMap:old});source.name='Crownfall_LAAS_BakedGround_Review_earth_Microdetail_CavityAo';source.userData.crownfallGroundDetail={kind:'earth',uvChannel:2};
  source.normalScale.set(.45,-.75);
  const geometry=new BoxGeometry(),mesh=new Mesh(geometry,source);root.add(mesh);let borrowed=0;
  for(const t of [albedo,normal,orm,atlas,old])t.addEventListener('dispose',()=>borrowed++);
  const entry={texture:albedo,normalTexture:normal,ormTexture:orm,meanLuminance:.05,albedoSize:1024 as const,dataSize:1024 as const,photographic:true};
  const look=applyEaldholtGroundAlbedoDetail(root,{earth:entry,rock:entry}),replacement=mesh.material;
  assert.equal(look.textureCount,3);assert.equal(look.extraTextureBytesWithMipsEstimate,16777218);assert.equal(replacement.aoMap,replacement.roughnessMap);assert.equal(replacement.metalnessMap,replacement.roughnessMap);
  assert.deepEqual(replacement.normalScale.toArray(),[1,-1]);assert.deepEqual(source.normalScale.toArray(),[.45,-.75]);
  assert.match(replacement.customProgramCacheKey(),/:photographic-pbr-v2:(earth|rock)$/);assert.equal(replacement.userData.crownfallGroundAlbedoDetail.photographic,true);
  assert.notEqual(replacement.normalMap,normal);assert.notEqual(replacement.roughnessMap,orm);assert.equal(replacement.normalMap!.colorSpace,NoColorSpace);
  assert.equal(replacement.normalMap!.flipY,false);assert.equal(replacement.roughnessMap!.flipY,false);assert.equal(replacement.normalMap!.channel,2);
  assert.deepEqual(replacement.normalMap!.repeat.toArray(),[2,3]);assert.deepEqual(replacement.roughnessMap!.offset.toArray(),[.1,.2]);assert.equal(source.normalMap,old);
  look.dispose();assert.equal(borrowed,0);assert.equal(mesh.material,source);
  geometry.dispose();source.dispose();for(const t of [albedo,normal,orm,atlas,old])t.dispose();
});


test('photographic albedo without a replacement normal retains authored normal strength',()=>{
  const root=new Group(),atlas=new Texture(),oldNormal=new Texture(),oldOrm=new Texture(),photo=new Texture();oldOrm.channel=2;
  const source=new MeshStandardMaterial({map:atlas,normalMap:oldNormal,roughnessMap:oldOrm});
  source.name='Crownfall_LAAS_BakedGround_Review_earth_Microdetail';source.userData.crownfallGroundDetail={kind:'earth',uvChannel:2};source.normalScale.set(.45,-.45);
  const geometry=new BoxGeometry(),mesh=new Mesh(geometry,source);root.add(mesh);
  const entry={texture:photo,meanLuminance:.12,photographic:true};
  const look=applyEaldholtGroundAlbedoDetail(root,{earth:entry,rock:entry});
  assert.equal(mesh.material.normalMap,oldNormal);assert.deepEqual(mesh.material.normalScale.toArray(),[.45,-.45]);
  assert.deepEqual(source.normalScale.toArray(),[.45,-.45]);look.dispose();assert.equal(mesh.material,source);
  geometry.dispose();source.dispose();for(const t of [atlas,oldNormal,oldOrm,photo])t.dispose();
});

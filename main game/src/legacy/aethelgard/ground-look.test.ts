import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { applyEaldholtGroundAo } from './ground-look';

test('ground AO reuses authored ORM channel without changing albedo, normals or cached materials',()=>{
  const root=new Group(),orm=new Texture(),atlas=new Texture(),normal=new Texture();orm.channel=2;orm.repeat.set(3,5);
  const source=new MeshStandardMaterial({map:atlas,roughnessMap:orm,normalMap:normal});source.normalScale.set(.45,.45);
  source.name='Crownfall_LAAS_BakedGround_Review_earth_Microdetail';source.userData.crownfallGroundDetail={kind:'earth',uvChannel:2};
  const hook=()=>{},key=()=>'preserved';source.onBeforeCompile=hook;source.customProgramCacheKey=key;
  const excluded=source.clone();excluded.name='ExistingPath';
  const authored=source.clone();authored.aoMap=normal;
  const geometry=new BoxGeometry(),ground=new Mesh(geometry,source),mixed=new Mesh(geometry,[source,excluded,authored]);root.add(ground,mixed);const array=mixed.material;
  let borrowedDisposals=0;source.addEventListener('dispose',()=>borrowedDisposals++);orm.addEventListener('dispose',()=>borrowedDisposals++);
  const result=applyEaldholtGroundAo(root),replacement=ground.material;assert.equal(result.materialCount,1);
  assert.notEqual(replacement,source);assert.equal(mixed.material[0],replacement);assert.equal(mixed.material[1],excluded);assert.equal(mixed.material[2],authored);
  assert.equal(replacement.aoMap,orm);assert.equal(replacement.aoMapIntensity,1);assert.equal(replacement.map,atlas);assert.equal(replacement.normalMap,normal);
  assert.deepEqual(replacement.normalScale.toArray(),[.45,.45]);assert.equal(replacement.roughnessMap,orm);assert.equal(orm.channel,2);assert.deepEqual(orm.repeat.toArray(),[3,5]);
  assert.equal(replacement.onBeforeCompile,hook);assert.equal(replacement.customProgramCacheKey,key);assert.equal(source.aoMap,null);
  let disposed=0;replacement.addEventListener('dispose',()=>disposed++);result.dispose();result.dispose();
  assert.equal(disposed,1);assert.equal(borrowedDisposals,0);assert.equal(ground.material,source);assert.equal(mixed.material,array);
  geometry.dispose();source.dispose();excluded.dispose();authored.dispose();orm.dispose();atlas.dispose();normal.dispose();
});

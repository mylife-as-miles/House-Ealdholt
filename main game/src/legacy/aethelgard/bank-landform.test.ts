import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BoxGeometry, BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { createEaldholtBankLandform } from './bank-landform';
import { createEaldholtRiverValley } from './river-valley';
import { createEaldholtRiverWoodland } from './river-woodland';
import { createEaldholtWoodlandSupportIndex } from '../../../../shared/legacy/aethelgard/environment/river-woodland';
const profile='desktop'as const;
function fixture(){
  const root=new Group(),ground=new PlaneGeometry(150,150,12,12).rotateX(-Math.PI/2),material=new MeshStandardMaterial({alphaTest:.3}),terrain=new Mesh(ground,material);
  terrain.name='LandscapeComponent_0';terrain.position.set(25,2,25);root.add(terrain);
  const prototype=new Group();prototype.name='SM_BlackAlder_Forest_05_PP3_ExteriorPrototype';prototype.userData.crownfallWoodlandPrototype={schema:1,family:'SM_BlackAlder_Forest_05_PP3',hidden:true,components:3};root.add(prototype);
  const geometries=[new BoxGeometry(.4,5,.4).translate(0,2.5,0),new BoxGeometry(3,3,3).translate(0,5,0),new BoxGeometry(.2,3,.2).translate(0,1.5,0)];
  for(const geometry of geometries){const part=new InstancedMesh(geometry,material,1);part.setMatrixAt(0,new Matrix4());prototype.add(part);}
  const valley=createEaldholtRiverValley(root,undefined,{profile});root.add(valley.object);
  const woodland=createEaldholtRiverWoodland(root,valley.object,{profile});
  return{root,ground,material,geometries,valley,woodland,dispose(){woodland.dispose();valley.dispose();for(const g of [ground,...geometries])g.dispose();material.dispose();}};
}
const snapshot=(g:BufferGeometry)=>({indices:Array.from(g.index!.array),attributes:Object.fromEntries(Object.entries(g.attributes).map(([name,a])=>[name,Array.from(a.array)]))});
const support=(g:BufferGeometry)=>createEaldholtWoodlandSupportIndex([{positions:g.getAttribute('position').array,indices:g.index!.array}]);
test('landform derives whole-tree guards, conserves all baseline support and owns only its installed geometry',()=>{
  const f=fixture(),land=f.valley.object.children[0]as Mesh,original=land.geometry,before=snapshot(original),oldSupport=support(original);
  const actorMatrices=f.woodland.object.children.map(o=>Array.from((o as InstancedMesh).instanceMatrix.array));
  const source=Array.from(f.ground.getAttribute('position').array),water=f.valley.object.children.slice(1).map(o=>snapshot((o as Mesh).geometry));
  let borrowedDisposals=0;for(const o of f.valley.object.children){const m=o as Mesh;m.geometry.addEventListener('dispose',()=>borrowedDisposals++);if(!Array.isArray(m.material))m.material.addEventListener('dispose',()=>borrowedDisposals++);}
  const h=createEaldholtBankLandform(f.root,f.valley.object,f.woodland,{profile}),nextSupport=support(land.geometry);
  assert.equal(h.riparianCorridor,undefined);assert.equal(h.protectedFootprints.length,f.woodland.instanceCount);assert.equal(h.drawCallsAdded,0);assert.ok(h.trianglesAdded>0&&h.trianglesAdded<=(profile==='desktop'?4000:1500));assert.ok(h.movedVertices>20&&h.maximumRaise>.5);
  assert.deepEqual(snapshot(original),before);assert.deepEqual(Array.from(f.ground.getAttribute('position').array),source);assert.deepEqual(f.valley.object.children.slice(1).map(o=>snapshot((o as Mesh).geometry)),water);
  assert.deepEqual(f.woodland.object.children.map(o=>Array.from((o as InstancedMesh).instanceMatrix.array)),actorMatrices);
  let probes=0;for(const r of h.protectedFootprints)for(let x=r.minX;x<=r.maxX;x+=1)for(let z=r.minZ;z<=r.maxZ;z+=1){const a=oldSupport.sample(x,z),b=nextSupport.sample(x,z);if(!a)continue;assert.ok(b);assert.ok(Math.abs(a.height-b.height)<.00002&&Math.abs(a.slope-b.slope)<.00002);probes++;}
  assert.ok(probes>100);assert.deepEqual(land.geometry.boundingBox!.min.toArray(),h.bounds.min);assert.deepEqual(land.geometry.boundingBox!.max.toArray(),h.bounds.max);
  assert.equal(land.userData.iwsdkPreviewBounds,undefined);assert.ok(new Box3().setFromObject(f.root).containsBox(land.geometry.boundingBox!));
  const clone=land.geometry;let ownedDisposals=0;clone.addEventListener('dispose',()=>ownedDisposals++);h.dispose();h.dispose();assert.equal(land.geometry,original);assert.equal(ownedDisposals,1);assert.equal(borrowedDisposals,0);
  f.dispose();
});
test('miniature/display transforms cancel, nested ownership remains noncumulative and later owners survive teardown',()=>{
  const f=fixture(),land=f.valley.object.children[0]as Mesh,base=land.geometry;
  const a=createEaldholtBankLandform(f.root,f.valley.object,f.woodland.object,{profile}),first=land.geometry,expected=snapshot(first);
  f.root.scale.setScalar(.02);f.root.position.set(3,4,-2);f.root.rotation.set(.1,.4,.05);
  const b=createEaldholtBankLandform(f.root,f.valley.object,f.woodland,{profile}),second=land.geometry;
  assert.notEqual(second,first);assert.deepEqual(snapshot(second),expected,'display transform cannot change the runtime landform');
  a.dispose();assert.equal(land.geometry,second);b.dispose();assert.equal(land.geometry,base);
  const c=createEaldholtBankLandform(f.root,f.valley.object,f.woodland,{profile}),replacement=base.clone();land.geometry=replacement;c.dispose();assert.equal(land.geometry,replacement);land.geometry=base;replacement.dispose();f.dispose();
});
test('missing woodland and mismatched profiles reject before replacing a surface',()=>{
  const f=fixture(),land=f.valley.object.children[0]as Mesh,original=land.geometry;
  assert.throws(()=>createEaldholtBankLandform(f.root,f.valley.object,new Group(),{profile}),/woodland/);
  assert.throws(()=>createEaldholtBankLandform(f.root,f.valley.object,f.woodland,{profile:profile==='desktop'?'quest':'desktop'}),/profile/);
  assert.equal(land.geometry,original);f.dispose();
});

test('explicit null shapes final terrain before woodland while preserving real source and every exterior HIGH actor support',()=>{
  const f=fixture(),land=f.valley.object.children[0]as Mesh,base=land.geometry,before=snapshot(base),oldSupport=support(base);
  const actorGeometry=new BoxGeometry(2,2,2),actors=new InstancedMesh(actorGeometry,f.material,3);actors.name='authored exterior supports';
  const locations=[[50,50],[110,20],[115,60]];
  locations.forEach(([x,z],i)=>actors.setMatrixAt(i,new Matrix4().makeTranslation(x,(oldSupport.sample(x,z)?.height??2)+1,z)));
  actors.count=1;f.root.add(actors);const matrices=Array.from(actors.instanceMatrix.array),source=snapshot(f.ground);
  const water=f.valley.object.children.slice(1).map(o=>snapshot((o as Mesh).geometry));
  let borrowedDisposals=0;actorGeometry.addEventListener('dispose',()=>borrowedDisposals++);base.addEventListener('dispose',()=>borrowedDisposals++);
  const a=createEaldholtBankLandform(f.root,f.valley.object,null,{profile}),nextSupport=support(land.geometry),expected=snapshot(land.geometry);
  assert.equal(a.protectedFootprints.length,3,'one real Landscape envelope and two exterior HIGH actors');
  assert.equal(land.geometry.userData.crownfallBankLandform.woodlandSupport,'final-terrain');
  assert.deepEqual(a.riparianCorridor,{width:26,blendWidth:12});
  assert.equal(land.geometry.userData.crownfallBankLandform.authoredActorGuards,2);
  assert.deepEqual(a.protectedFootprints[0],{minX:-50,maxX:100,minZ:-50,maxZ:100});
  assert.ok(a.movedVertices>20&&a.maximumRaise>.5);assert.equal(a.drawCallsAdded,0);
  for(const r of a.protectedFootprints.slice(1))for(let x=r.minX;x<=r.maxX;x+=.5)for(let z=r.minZ;z<=r.maxZ;z+=.5){
    const old=oldSupport.sample(x,z),next=nextSupport.sample(x,z);assert.ok(old&&next);assert.ok(Math.abs(old.height-next.height)<.00002&&Math.abs(old.slope-next.slope)<.00002);
  }
  assert.deepEqual(snapshot(base),before);assert.deepEqual(snapshot(f.ground),source);assert.deepEqual(Array.from(actors.instanceMatrix.array),matrices);assert.equal(actors.count,1);
  assert.deepEqual(f.valley.object.children.slice(1).map(o=>snapshot((o as Mesh).geometry)),water);
  const footprint=a.protectedFootprints;a.dispose();assert.equal(land.geometry,base);
  f.root.scale.setScalar(.02);f.root.rotation.set(.1,.4,.05);f.root.position.set(3,4,-2);
  const b=createEaldholtBankLandform(f.root,f.valley.object,null,{profile});
  assert.deepEqual(b.protectedFootprints,footprint);assert.deepEqual(snapshot(land.geometry),expected,'display transforms cannot change final-terrain support');
  b.dispose();b.dispose();assert.equal(land.geometry,base);assert.equal(borrowedDisposals,0);
  actors.removeFromParent();actors.dispose();actorGeometry.dispose();f.dispose();
});

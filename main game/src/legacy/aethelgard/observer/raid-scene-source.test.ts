import test from'node:test';import assert from'node:assert/strict';
import{Group,PerspectiveCamera}from'three';import{createRaidScene,type RaidVisual,type SourceRaidSite}from'./raid-scene';
const binding={catalogueId:'raid-building-parts-v1:desktop:'+'3'.repeat(64),sourceSha256:'3'.repeat(64),profile:'desktop'as const,buildingId:'door:actual-source-actor',siteIndex:0};
const site:SourceRaidSite={index:0,bearing:'north',position:[40,1,-30],outward:[0,0,-1],buildingBinding:binding};
function fixture(){const root=new Group(),door=new Group();door.name='S_Medieval_Modular_Door_legacy';door.position.set(-20,1,10);root.add(door);const scene=createRaidScene(root,new PerspectiveCamera(),[site]);return{root,scene};}
const visual=(buildingBinding?:typeof binding):RaidVisual=>({siteIndex:0,phase:'clash',progress:.8,outcome:'burned',size:8,seed:10,allies:null,buildingBinding});
test('bound source sites and legacy unbound FX retain distinct identities at the same index',()=>{
 const f=fixture();try{assert.deepEqual(f.scene.sites(),[{index:0,bearing:'north',buildingBinding:binding}]);f.scene.update(visual(binding),null,0,true);assert.equal(f.scene.stats.active,true);
  let match=0;f.root.traverse(o=>{if('geometry'in o){const attr=(o as import('three').Mesh).geometry.getAttribute('cfPoint');if(attr&&attr.getX(0)===40&&attr.getZ(0)===-30)match++;}});assert.ok(match>=2,'Actual fire and smoke use the provided source building.');
  f.scene.update(visual(),null,0,true);match=0;f.root.traverse(o=>{if('geometry'in o){const attr=(o as import('three').Mesh).geometry.getAttribute('cfPoint');if(attr&&attr.getX(0)===-20&&attr.getZ(0)===10)match++;}});assert.ok(match>=2,'An old unbound index still uses its old legacy FX site.');
  f.scene.update(visual({...binding,sourceSha256:'4'.repeat(64)}),null,0,true);assert.equal(f.scene.stats.active,false);
 }finally{f.scene.dispose();}
});

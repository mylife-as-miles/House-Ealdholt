import test from 'node:test';
import assert from 'node:assert/strict';
import {groundVegetationRoot,type VegetationRootContact} from '../aethelgard/environment/vegetation-root-contact';
import {REGIONAL_ROOT_CONTACTS} from '../aethelgard/environment/regional-root-contact-data';
import {REGIONAL_VEGETATION_PROTOTYPES} from '../aethelgard/environment/regional-assets';

const contact:VegetationRootContact={baseY:0,radius:1,points:[[-1,0,0],[0,0,-1],[1,0,0],[0,0,1]]};
const base={x:10,z:20,yaw:0,scale:1,height:12,contact};
const flat=()=>({height:5,slope:0});
test('actual bramble wood root is grounded despite its foliage-derived positive source offset',()=>{
 const profile=REGIONAL_ROOT_CONTACTS.bramble;
 assert.ok(profile.baseY>.17,'The measured unchanged GLBs retain the original positive stem offset.');
 for(const scale of [.55,.95]){
  const result=groundVegetationRoot({...base,scale,height:1.634,contact:profile,sample:flat});assert.ok(result);
  for(const point of profile.points)assert.ok(result.y+point[1]*scale<=5-.079999);
  assert.ok(result.burial<.18,'Correcting the asset-frame offset is not counted as unlimited trunk burial.');
 }
});
test('a slope grounds the downhill root ring rather than only the tree centre',()=>{
 const sample=(x:number)=>({height:5+(x-base.x)*.7,slope:.7});
 const result=groundVegetationRoot({...base,sample});assert.ok(result);
 assert.ok(Math.abs(result.y-4.22)<1e-10);
 for(const [x,y] of contact.points)assert.ok(result.y+y<=sample(base.x+x).height-.079999);
});
test('source-frame yaw and scale are applied to root support samples',()=>{
 const samples:number[][]=[];
 const result=groundVegetationRoot({...base,scale:.75,yaw:Math.PI/2,sample:(x,z)=>{samples.push([x,z]);return flat();}});assert.ok(result);
 assert.ok(samples.some(([x,z])=>Math.abs(x-10)<1e-9&&Math.abs(z-20.75)<1e-9));
 assert.deepEqual([base.x,base.z,base.yaw,base.scale],[10,20,0,1]);
});
test('missing support beneath any root rejects an otherwise supported centre',()=>{
 assert.equal(groundVegetationRoot({...base,sample:(x,z)=>x===9&&z===20?null:flat()}),null);
});
test('excessive burial or steep local root support rejects the generated candidate',()=>{
 assert.equal(groundVegetationRoot({...base,sample:x=>({height:x===9?0:5,slope:0})}),null);
 assert.equal(groundVegetationRoot({...base,sample:x=>({height:5,slope:x===9?.9:0})}),null);
});
test('every measured species shares a valid contact placement between Desktop and Quest',()=>{
 for(const prototype of REGIONAL_VEGETATION_PROTOTYPES){
  const profile=REGIONAL_ROOT_CONTACTS[prototype.id];assert.ok(profile);
  assert.ok(profile.points.length>=3&&profile.points.length<=64);
  const input={...base,height:prototype.height,contact:profile,sample:flat},a=groundVegetationRoot(input),b=groundVegetationRoot(input);
  assert.deepEqual(a,b);assert.ok(a,prototype.id);
  for(const point of profile.points)assert.ok(a.y+point[1]<=5-.079999,prototype.id);
 }
});
test('invalid root evidence cannot fabricate contact',()=>{
 assert.throws(()=>groundVegetationRoot({...base,scale:NaN,sample:flat}),/Unqualified/);
 assert.throws(()=>groundVegetationRoot({...base,contact:{...contact,points:[]},sample:flat}),/Unqualified/);
 assert.throws(()=>groundVegetationRoot({...base,contact:{...contact,points:[[NaN,0,0],[1,0,0],[0,0,1]]},sample:flat}),/Invalid/);
});

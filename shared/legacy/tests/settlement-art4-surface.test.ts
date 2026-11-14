import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSettlementNature} from '../environment/settlement/nature';
import {settlementGroundTint,settlementRoadRow} from '../environment/settlement/surface';
import {AUTUMN_SETTLEMENT_PATHS,settlementHeight} from '../environment/settlement/layout';

test('ART4 ground keeps the authored heightfield and supplies actual metre-space texture coordinates',()=>{
 const ground=buildSettlementNature(true,0).meshes.find(m=>m.material==='settlement-ground')!;assert.ok(ground);
 assert.equal(ground.indices.length/3,12800);assert.equal(ground.positions.length/3,81*81);
 const colourKeys=new Set<string>();for(let i=0;i<ground.positions.length/3;i++){
  const x=ground.positions[i*3],y=ground.positions[i*3+1],z=ground.positions[i*3+2];
  assert.ok(Math.abs(y-settlementHeight(x,z))<.00001);assert.equal(ground.uvs[i*2],x);assert.equal(ground.uvs[i*2+1],z);
  const colour=settlementGroundTint(x,z);assert.ok(colour.every(v=>Number.isFinite(v)&&v>0&&v<1));colourKeys.add(colour.map(v=>v.toFixed(2)).join(','));
 }assert.ok(colourKeys.size>150,'localized warm earth, leaf litter, olive and shore tints remain varied');
 // Continuous tint avoids cell boundaries in the existing coarse terrain.
 for(let x=-80;x<80;x+=4)for(let z=-80;z<80;z+=4){const a=settlementGroundTint(x,z),b=settlementGroundTint(x+.001,z+.001);assert.ok(a.every((v,i)=>Math.abs(v-b[i])<.001));}
});
test('ART4 worn road geometry stays inside the original full corridor and adds only one centre cross-row',()=>{
 let steps=0;for(const road of AUTUMN_SETTLEMENT_PATHS)for(let k=1;k<road.points.length;k++){
  const a=road.points[k-1],b=road.points[k],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),n=Math.ceil(length/1.2);steps+=n;
  for(let i=0;i<=n;i++){const t=i/n,x=a[0]+dx*t,z=a[1]+dz*t,row=settlementRoadRow(x,z,-dz/length,dx/length,road.width);assert.equal(row.length,3);assert.equal(row[1].offset,0);
   for(const point of row){assert.ok(Math.abs(point.offset)<=road.width/2);assert.ok(Math.abs(Math.hypot(...point.normal)-1)<1e-9);assert.equal(point.y,settlementHeight(point.x,point.z)+.045);}
   assert.ok(row[0].tint[0]<row[1].tint[0]);assert.ok(row[2].tint[0]<row[1].tint[0]);
  }
 }
 const paths=buildSettlementNature(true,0).meshes.filter(m=>m.material==='settlement-path');assert.equal(steps,509);assert.equal(paths.reduce((n,m)=>n+m.indices.length/3,0),steps*4);assert.equal(steps*2,1018,'increment over the old two-vertex road is bounded');
});

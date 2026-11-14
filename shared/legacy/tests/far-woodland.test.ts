import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtFarWoodlandLayout, EALDHOLT_FAR_WOODLAND_BUDGET, EALDHOLT_FAR_WOODLAND_LOD_BUDGET } from '../aethelgard/environment/far-woodland';
import { createEaldholtFarGeography } from '../aethelgard/environment/far-surround';
import type { EaldholtWoodlandSurface } from '../aethelgard/environment/river-woodland';
const geography=()=>createEaldholtFarGeography({seaPositions:[-500,0,-500,-200,0,-500,-500,0,500,-200,0,500],
  channelPositions:[20,0,40,20,0,60,500,0,40,500,0,60],sourceEnvelope:{minX:-10,maxX:10,minZ:-10,maxZ:10},riverFarX:1000});
const roots=[{x:20,y:2,z:-60,scale:1,yaw:0},{x:60,y:2,z:-30,scale:1,yaw:0},{x:60,y:2,z:100,scale:1,yaw:0},{x:20,y:2,z:100,scale:1,yaw:0}];
const height=(x:number,z:number)=>2+x*.003-z*.002;
function quad(minX:number,maxX:number,minZ:number,maxZ:number,fn=height):EaldholtWoodlandSurface {
  return {positions:[minX,fn(minX,minZ),minZ,maxX,fn(maxX,minZ),minZ,minX,fn(minX,maxZ),maxZ,maxX,fn(maxX,maxZ),maxZ],indices:[0,2,1,1,2,3]};
}
const input=()=>({land:[quad(-500,500,-500,500)],water:[quad(20,500,40,60,()=>0)],geography:geography(),existingPlacements:roots,existingCanopyRadius:3,canopyRadius:4.5507252079777825,maximumTrees:96});
test('far woodland uses actual triangle heights, coherent deterministic interleaved groves and dry footprints',()=>{
  const a=input(),snapshot=JSON.stringify(a),layout=createEaldholtFarWoodlandLayout(a);
  assert.equal(layout.placements.length,96);assert.deepEqual(layout.acceptedPerGrove,[24,24,24,24]);
  assert.deepEqual(layout,createEaldholtFarWoodlandLayout(a));assert.equal(JSON.stringify(a),snapshot);
  assert.deepEqual(layout.placements.slice(0,4).map(p=>p.grove),[0,1,2,3]);
  for(const p of layout.placements){
    assert.ok(Math.abs(p.y-height(p.x,p.z))<1e-10,'actual plane, not analytic geography, supplies root height');
    const radius=a.canopyRadius*p.scale;
    for(let edge=0;edge<8;edge++){
      const angle=edge*Math.PI/4,x=p.x+Math.cos(angle)*radius,z=p.z+Math.sin(angle)*radius;
      assert.ok(x>-200);assert.ok(x<20||z<40||z>60);
    }
    assert.ok(roots.every(r=>Math.hypot(r.x-p.x,r.z-p.z)>=radius+3*r.scale));
  }
  assert.ok(layout.attempted<96*400);
});
test('unavailable or steep support never falls back to analytic land',()=>{
  const a=input();const absent=createEaldholtFarWoodlandLayout({...a,land:[]});assert.equal(absent.placements.length,0);
  const steep=createEaldholtFarWoodlandLayout({...a,land:[quad(-500,500,-500,500,(x)=>x)]});assert.equal(steep.placements.length,0);
  const wet=createEaldholtFarWoodlandLayout({...a,water:[quad(-500,500,-500,500,()=>0)]});assert.equal(wet.placements.length,0);
});
test('support holes are respected across the whole crown and budgets reject excess requests',()=>{
  const a=input(),land=[quad(-500,80,-500,500),quad(120,500,-500,500),quad(80,120,-500,-60),quad(80,120,-20,500)];
  const result=createEaldholtFarWoodlandLayout({...a,land});
  assert.ok(result.placements.length>0);
  for(const p of result.placements)for(let edge=0;edge<8;edge++){
    const r=a.canopyRadius*p.scale,t=edge*Math.PI/4,x=p.x+Math.cos(t)*r,z=p.z+Math.sin(t)*r;
    assert.ok(x<=80||x>=120||z<=-60||z>=-20);
  }
  assert.throws(()=>createEaldholtFarWoodlandLayout({...a,maximumTrees:129}),/budget/);
  assert.throws(()=>createEaldholtFarWoodlandLayout({...a,existingPlacements:[]}),/unchanged/);
  assert.equal(EALDHOLT_FAR_WOODLAND_LOD_BUDGET.actors*525,EALDHOLT_FAR_WOODLAND_LOD_BUDGET.triangles);
  assert.ok(EALDHOLT_FAR_WOODLAND_BUDGET.actors*9883<=EALDHOLT_FAR_WOODLAND_BUDGET.triangles);
});
test('continuous crown disks reject a narrow water edge between all eight rim probes',()=>{
  const a=input(),first=createEaldholtFarWoodlandLayout({...a,maximumTrees:1,water:[]}).placements[0];
  assert.ok(first);const radius=a.canopyRadius*first.scale,angle=Math.PI/8,n={x:Math.cos(angle),z:Math.sin(angle)},t={x:-n.z,z:n.x};
  const vertices=[[-5,.98],[-5,6],[5,.98],[5,6]].flatMap(([along,out])=>[first.x+t.x*along*radius+n.x*out*radius,0,first.z+t.z*along*radius+n.z*out*radius]);
  const strip={positions:vertices,indices:[0,2,1,1,2,3]};
  // Both centre and all eight old probes lie on the dry side of this edge.
  for(let edge=0;edge<8;edge++)assert.ok(n.x*Math.cos(edge*Math.PI/4)+n.z*Math.sin(edge*Math.PI/4)<.98);
  const guarded=createEaldholtFarWoodlandLayout({...a,maximumTrees:1,water:[strip]});
  assert.ok(guarded.rejected.water>0);
  assert.ok(!guarded.placements.some(p=>p.x===first.x&&p.z===first.z),'the original intersecting full crown is rejected');
});

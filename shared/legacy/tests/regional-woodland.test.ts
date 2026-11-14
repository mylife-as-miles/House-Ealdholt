import assert from 'node:assert/strict';
import test from 'node:test';
import {createEaldholtFarWoodlandLayout,createEaldholtRegionalWoodlandLayout,createEaldholtWoodlandSupportIndex} from '../aethelgard/environment/far-woodland';
import {createEaldholtFarGeography,sampleEaldholtFarGeography} from '../aethelgard/environment/far-surround';
import {createEaldholtProjectedWoodlandSupport} from '../aethelgard/environment/regional-woodland-support';
const geography=()=>createEaldholtFarGeography({seaPositions:[-500,0,-500,-200,0,-500,-500,0,500,-200,0,500],
 channelPositions:[20,0,40,20,0,60,500,0,40,500,0,60],sourceEnvelope:{minX:-10,maxX:10,minZ:-10,maxZ:10},riverFarX:1000});
const roots=[{x:20,y:2,z:-60,scale:1,yaw:0},{x:60,y:2,z:-30,scale:1,yaw:0}];
test('regional forest extends four stable groves with exact terrain contact, full crown clearance and unchanged raw-tree limits',()=>{
 const g=geography(),height=(x:number,z:number)=>2+x*.003-z*.002;
 const input={geography:g,existingPlacements:roots,existingCanopyRadius:3,canopyRadius:4.55,maximumTrees:1024,
  land:[{positions:[-1000,height(-1000,-1000),-1000,1000,height(1000,-1000),-1000,-1000,height(-1000,1000),1000,1000,height(1000,1000),1000],indices:[0,2,1,1,2,3]}],
  water:[{positions:[20,0,40,1000,0,40,20,0,60,1000,0,60],indices:[0,2,1,1,2,3]}]};
 assert.throws(()=>createEaldholtFarWoodlandLayout(input),/budget/);
 const a=createEaldholtRegionalWoodlandLayout(input),b=createEaldholtRegionalWoodlandLayout(input);
 assert.deepEqual(a,b);assert.equal(a.placements.length,1024);assert.deepEqual(a.acceptedPerGrove,[256,256,256,256]);
 assert.deepEqual(a.placements.slice(0,4).map(p=>p.grove),[0,1,2,3]);
 for(const p of a.placements){assert.ok(Math.abs(p.y-height(p.x,p.z))<1e-10);assert.equal(sampleEaldholtFarGeography(g,p.x,p.z).kind,'mainland');
  assert.ok(p.x-4.55*p.scale>14||p.x+4.55*p.scale< -14||p.z-4.55*p.scale>14||p.z+4.55*p.scale< -14);}
 for(let i=0;i<a.placements.length;i++)for(let j=0;j<i;j++){const p=a.placements[i],q=a.placements[j];assert.ok(Math.hypot(p.x-q.x,p.z-q.z)>=.65*4.55*(p.scale+q.scale));}
 assert.equal(createEaldholtRegionalWoodlandLayout({...input,land:[]}).placements.length,0);
 assert.throws(()=>createEaldholtRegionalWoodlandLayout({...input,maximumTrees:2049}),/budget/);
});
test('Native far scenery follows its analytic projection and continuously excludes river/sea footprints',()=>{
 const g=geography(),support=createEaldholtProjectedWoodlandSupport(g),result=createEaldholtRegionalWoodlandLayout({...support,geography:g,existingPlacements:roots,existingCanopyRadius:3,canopyRadius:4.55,maximumTrees:512});
 assert.equal(result.placements.length,512);
 const water=createEaldholtWoodlandSupportIndex(support.water,{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000});
 for(const p of result.placements){assert.ok(Math.abs(p.y-sampleEaldholtFarGeography(g,p.x,p.z).level)<.02);assert.equal(water.intersectsDisk(p.x,p.z,4.55*p.scale+.35),false);}
});

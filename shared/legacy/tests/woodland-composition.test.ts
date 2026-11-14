import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtClusteredWoodlandPlacements } from '../aethelgard/environment/woodland-composition';
import { createEaldholtWoodlandPlacements, createEaldholtWoodlandSupportIndex, type EaldholtWoodlandPlacement } from '../aethelgard/environment/river-woodland';
const plane=(minX:number,maxX:number,minZ:number,maxZ:number,y:number)=>({positions:new Float64Array([minX,y,minZ,maxX,y,minZ,minX,y,maxZ,maxX,y,maxZ]),indices:new Uint32Array([0,2,1,1,2,3])});
function fixture(){return{land:plane(-100,100,-80,100,2),sourceLand:[plane(-30,30,-30,30,2)],
 water:{positions:new Float64Array([-100,1.3,40,-100,1.3,55,100,1.3,40,100,1.3,55]),indices:new Uint32Array([0,1,2,1,3,2])},
 sourceEnvelope:{minX:-30,maxX:30,minZ:-30,maxZ:30},village:{minX:-8,maxX:8,minZ:-8,maxZ:8},canopyRadius:2.2,maximumTrees:76,profile:'quest'as const};}
const counts=(list:readonly EaldholtWoodlandPlacement[])=>Object.fromEntries(['source','near','far-fringe','far-deep','mainland'].map(region=>[region,list.filter(p=>p.region===region).length]));
test('composition retains exact anchor pools, slot labels/scale/yaw and all quality prefixes deterministically',()=>{
 const input=fixture(),before=structuredClone(input),baseline=createEaldholtWoodlandPlacements(input),a=createEaldholtClusteredWoodlandPlacements(input),b=createEaldholtClusteredWoodlandPlacements(input);
 assert.deepEqual(a,b);assert.deepEqual(input,before);assert.equal(a.placements.length,baseline.length);
 baseline.forEach((p,i)=>{const q=a.placements[i];assert.equal(q.region,p.region);assert.equal(q.scale,p.scale);assert.equal(q.yaw,p.yaw);
  if(p.region!=='far-deep'&&p.region!=='mainland')assert.deepEqual(q,p);});
 for(const count of [38,56,76])assert.deepEqual(counts(a.placements.slice(0,count)),counts(baseline.slice(0,count)));
 assert.ok(a.metrics.anchorsPreserved&&a.metrics.ordinalsScaleYawPreserved);assert.equal(a.metrics.spacingUnchanged,true);
 const movable=baseline.filter(p=>p.region==='far-deep'||p.region==='mainland').length;
 assert.equal(a.metrics.clusterStage.moved+a.metrics.clusterStage.fallback+a.metrics.clusterStage.seedActors,movable);
 assert.ok(a.metrics.moved>0);assert.ok(a.metrics.mainlandPreservedFromClusteredPool);
 assert.equal(a.metrics.satelliteStage.moved+a.metrics.satelliteStage.fallback,baseline.filter(p=>p.region==='far-deep').length);
 assert.match(a.metrics.candidateConnectivity.scope,/Conservative crown circles/);
});
test('clustered roots retain original terrain, water, architecture, authored-crown and pair-spacing guards',()=>{
 const input={...fixture(),existingCrowns:[{x:48,z:-48,radius:6}],obstacles:[{minX:48,maxX:59,minZ:63,maxZ:74}]};
 const result=createEaldholtClusteredWoodlandPlacements(input),floor=createEaldholtWoodlandSupportIndex([input.land,...input.sourceLand]),water=createEaldholtWoodlandSupportIndex([input.water]);
 for(const p of result.placements){const r=input.canopyRadius*p.scale,root=floor.sample(p.x,p.z)!;assert.equal(p.y,root.height);
  const touches=(box:typeof input.village)=>p.x-r<box.maxX&&p.x+r>box.minX&&p.z-r<box.maxZ&&p.z+r>box.minZ;
  assert.ok(!touches(input.village)&&!input.obstacles.some(touches));assert.ok(Math.hypot(p.x-48,p.z+48)>=r+6);
  for(let i=0;i<8;i++){const angle=i*Math.PI/4,x=p.x+Math.cos(angle)*r,z=p.z+Math.sin(angle)*r,h=floor.sample(x,z),w=water.sample(x,z);
   assert.ok(h&&h.slope<=.72&&Math.abs(h.height-p.y)<=2.8);if(w)assert.ok(h.height>=w.height+.18);}
 }
 for(let i=0;i<result.placements.length;i++)for(let j=i+1;j<result.placements.length;j++){
  const p=result.placements[i],q=result.placements[j];assert.ok(Math.hypot(p.x-q.x,p.z-q.z)>=Math.max(3,input.canopyRadius*(p.scale+q.scale)*.68));}
});
test('a source-only or empty pool is an exact no-op without creating replacement trees',()=>{
 const input={...fixture(),land:plane(-30,30,-30,30,2)},baseline=createEaldholtWoodlandPlacements(input),result=createEaldholtClusteredWoodlandPlacements(input);
 assert.ok(baseline.every(p=>p.region==='source'));assert.deepEqual(result.placements,baseline);assert.equal(result.metrics.moved,0);assert.equal(result.metrics.clusterStage.fallback,0);assert.equal(result.metrics.satelliteStage.fallback,0);
 const empty=createEaldholtClusteredWoodlandPlacements({...input,maximumTrees:0});assert.deepEqual(empty.placements,[]);assert.equal(empty.metrics.candidateConnectivity.components,0);
});

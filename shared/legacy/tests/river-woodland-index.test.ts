import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtWoodlandSupportIndex, createEaldholtWoodlandPlacements, readEaldholtSourceTreeDensityMetadata, type EaldholtWoodlandSurface } from '../aethelgard/environment/river-woodland';
function plane(minX:number,maxX:number,minZ:number,maxZ:number,y:number):EaldholtWoodlandSurface{return{positions:new Float64Array([minX,y,minZ,maxX,y,minZ,minX,y,maxZ,maxX,y,maxZ]),indices:new Uint32Array([0,2,1,1,2,3])};}
test('support broad phase samples exact highest original/generated triangles and avoids a full detailed-landscape scan',()=>{
  const count=180,p:number[]=[],ix:number[]=[];for(let z=0;z<=count;z++)for(let x=0;x<=count;x++)p.push(x,x*.1+z*.2,z);for(let z=0;z<count;z++)for(let x=0;x<count;x++){const a=z*(count+1)+x,b=a+1,c=a+count+1;ix.push(a,c,b,b,c,c+1);}
  const source={positions:Float64Array.from(p),indices:Uint32Array.from(ix)},index=createEaldholtWoodlandSupportIndex([source,plane(0,180,0,180,-1)]),hit=index.sample(73.25,42.75)!;
  assert.ok(Math.abs(hit.height-(73.25*.1+42.75*.2))<1e-8);assert.ok(Math.abs(hit.slope-Math.hypot(.1,.2))<1e-8);assert.equal(index.triangles,count*count*2+2);assert.ok(index.lastTriangleTests<100,'nearby-cell tests, not all 64,802 triangles');assert.equal(index.sample(-1,0),null);assert.equal(index.sample(NaN,0),null);
  assert.throws(()=>createEaldholtWoodlandSupportIndex([{positions:[0,0,0],indices:[0,1,2]}]),/Invalid woodland support triangle/);
});
test('new forest includes supported source exterior, protects buildings/props/crowns/water, and returns reproducible whole-tree prefixes',()=>{
  const source=plane(-30,30,-30,30,2),land=plane(-48,48,-48,48,1),water={positions:new Float64Array([-48,3,35,-48,3,43,48,3,35,48,3,43]),indices:new Uint32Array([0,1,2,1,3,2])},sea=plane(-48,-35,-48,48,1.3),village={minX:-8,maxX:8,minZ:-8,maxZ:8},crown={x:-19,z:-10,radius:4},obstacle={minX:14,maxX:20,minZ:-18,maxZ:-12};
  const input={land,water,extraWater:[sea],sourceLand:[source],sourceEnvelope:{minX:-30,maxX:30,minZ:-30,maxZ:30},village,existingCrowns:[crown],obstacles:[obstacle],canopyRadius:2.2,maximumTrees:76,profile:'quest' as const},trees=createEaldholtWoodlandPlacements(input),support=createEaldholtWoodlandSupportIndex([land,source]),wet=createEaldholtWoodlandSupportIndex([water,sea]);
  assert.ok(trees.length>30&&trees.length<=76);assert.deepEqual(trees,createEaldholtWoodlandPlacements(input));assert.ok(trees.filter(t=>Math.abs(t.x)<30&&Math.abs(t.z)<30).length>10,'former source exterior is available');
  for(const t of trees){const radius=input.canopyRadius*t.scale,touches=(r:typeof village)=>t.x-radius<r.maxX&&t.x+radius>r.minX&&t.z-radius<r.maxZ&&t.z+radius>r.minZ;assert.equal(touches(village),false);assert.equal(touches(obstacle),false);assert.ok(Math.hypot(t.x-crown.x,t.z-crown.z)>=radius+crown.radius);assert.ok(Math.abs(support.sample(t.x,t.z)!.height-t.y)<1e-8);
    for(let k=0;k<9;k++){const x=t.x+(k===8?0:Math.cos(k*Math.PI/4)*radius),z=t.z+(k===8?0:Math.sin(k*Math.PI/4)*radius),floor=support.sample(x,z)!,waterAt=wet.sample(x,z);assert.ok(floor);if(waterAt)assert.ok(floor.height>=waterAt.height+.18);}
  }
  assert.deepEqual(Array.from(source.positions),[-30,2,-30,30,2,-30,-30,2,30,30,2,30]);
});

test('finite woodland capacity connects northern/eastern shoulders and both banks in quality prefixes',()=>{
  const source=plane(-30,30,-30,30,2),land=plane(-100,100,-80,100,2),water={positions:new Float64Array([-100,1.3,40,-100,1.3,55,100,1.3,40,100,1.3,55]),indices:new Uint32Array([0,1,2,1,3,2])};
  const input={land,water,sourceLand:[source],sourceEnvelope:{minX:-30,maxX:30,minZ:-30,maxZ:30},village:{minX:-8,maxX:8,minZ:-8,maxZ:8},canopyRadius:2.2,maximumTrees:76,profile:'quest' as const};
  const trees=createEaldholtWoodlandPlacements(input),region=(t:typeof trees[number])=>Math.abs(t.x)<=30&&Math.abs(t.z)<=30?'source':t.z< -30||t.x>30&&t.z<=30?'mainland':t.z<40?'near':'far';
  const counts=(values:typeof trees)=>values.reduce((out,t)=>{out[region(t)]++;return out;},{source:0,near:0,far:0,mainland:0});
  assert.equal(trees.length,76);assert.deepEqual(trees,createEaldholtWoodlandPlacements(input));
  assert.deepEqual(counts(trees),{source:19,near:19,far:19,mainland:19},'retain both bank shares inside the same total budget');
  assert.deepEqual(counts(createEaldholtWoodlandPlacements({...input,maximumTrees:38})),{source:10,near:9,far:10,mainland:9},'triangle-limited caps preserve the former near/far bank shares too');
  assert.ok(trees.some(t=>t.z< -30)&&trees.some(t=>t.x>30&&t.z>= -30&&t.z<=30),'both supported mainland shoulders receive complete trees');
  const far=trees.filter(t=>region(t)==='far');
  assert.ok(far.filter(t=>t.z>80).length>=3&&far.filter(t=>t.z<72).length>=3,'same far quota spans shallow and deep mainland patches instead of a narrow shore hedge');
  for(const t of far)assert.ok(t.z+input.canopyRadius*t.scale+.8<=100,'outer canopy inset uses actual land, not the water or model envelope');
  const prefixTrees=trees.slice(0,24),prefix=counts(prefixTrees);assert.ok(prefix.source>=2&&prefix.near>=2&&prefix.far>=2&&prefix.mainland>=2,'lower quality prefixes retain all four landscape regions');
  assert.ok(prefixTrees.some(t=>t.z< -30)&&prefixTrees.some(t=>t.x>30&&t.z>= -30&&t.z<=30),'lower quality retains north and east context');
  const support=createEaldholtWoodlandSupportIndex([land,source]),wet=createEaldholtWoodlandSupportIndex([water]);
  for(const t of trees)for(let edge=0;edge<8;edge++){
    const radius=input.canopyRadius*t.scale,x=t.x+Math.cos(edge*Math.PI/4)*radius,z=t.z+Math.sin(edge*Math.PI/4)*radius,floor=support.sample(x,z),waterAt=wet.sample(x,z);
    assert.ok(floor);if(waterAt)assert.ok(floor.height>=waterAt.height+.18);
  }
});

test('a missing opposite bank is reported by zero placements there rather than forced unsupported crowns',()=>{
  const source=plane(-30,30,-30,30,2),land=plane(-100,100,-80,55,2),water={positions:new Float64Array([-100,1.3,40,-100,1.3,55,100,1.3,40,100,1.3,55]),indices:new Uint32Array([0,1,2,1,3,2])};
  const input={land,water,sourceLand:[source],sourceEnvelope:{minX:-30,maxX:30,minZ:-30,maxZ:30},village:{minX:-8,maxX:8,minZ:-8,maxZ:8},canopyRadius:2.2,maximumTrees:76,profile:'quest' as const};
  const trees=createEaldholtWoodlandPlacements(input),support=createEaldholtWoodlandSupportIndex([land,source]);
  assert.ok(trees.length>38&&trees.length<=76);assert.equal(trees.filter(t=>t.z>55).length,0);
  for(const t of trees){assert.ok(support.sample(t.x,t.z));for(let edge=0;edge<8;edge++)assert.ok(support.sample(t.x+Math.cos(edge*Math.PI/4)*input.canopyRadius*t.scale,t.z+Math.sin(edge*Math.PI/4)*input.canopyRadius*t.scale));}
});

test('source tree roles validate density metadata without treating grass, flowers or generated woodland as trees',()=>{
  assert.equal(readEaldholtSourceTreeDensityMetadata(undefined),null);
  for(const [family,components]of [['native-source-field04-v1',4],['native-source-forest05-v1',3],['native-source-field02-heroes-v1',3],['native-source-forest01-hero-v1',3]]as const){const tag=readEaldholtSourceTreeDensityMetadata({schema:1,family,components,counts:{low:0,medium:1,high:2}})!;assert.equal(tag.family,family);assert.equal(tag.counts.high,2);}
  for(const family of ['native-source-grass1-v1','native-source-poppy-v1','native-source-daisy-v1','native-source-lupine-v1','exterior-woodland-pp3-v1'])assert.equal(readEaldholtSourceTreeDensityMetadata({schema:1,family,components:3,counts:{low:0,medium:1,high:2}}),null);
  assert.throws(()=>readEaldholtSourceTreeDensityMetadata({schema:1,family:'native-source-field04-v1',components:3,counts:{low:0,medium:1,high:2}}),/source-tree/);
  assert.throws(()=>readEaldholtSourceTreeDensityMetadata({schema:1,family:'native-source-field04-v1',components:4,counts:{low:3,medium:1,high:2}}),/increase/);
});

test('independent shore RNG and bank-first reservation keep near trees unchanged when the opposite bank is unsupported',()=>{
  const source=plane(-30,30,-30,30,2),near=plane(-100,100,-80,55,2),far=plane(-100,100,55,100,2);
  const positions=Float64Array.from([...Array.from(near.positions),...Array.from(far.positions)]);
  const complete={positions,indices:Uint32Array.from([...Array.from(near.indices),...Array.from(far.indices,id=>id+4)])};
  const unsupported={positions,indices:Uint32Array.from(near.indices)},water={positions:new Float64Array([-100,1.3,40,-100,1.3,55,100,1.3,40,100,1.3,55]),indices:new Uint32Array([0,1,2,1,3,2])};
  const input={land:complete,water,sourceLand:[source],sourceEnvelope:{minX:-30,maxX:30,minZ:-30,maxZ:30},village:{minX:-8,maxX:8,minZ:-8,maxZ:8},canopyRadius:2.2,maximumTrees:76,profile:'quest' as const};
  const a=createEaldholtWoodlandPlacements(input),b=createEaldholtWoodlandPlacements({...input,land:unsupported});
  assert.equal(a.filter(p=>p.region==='near').length,19);
  assert.deepEqual(a.filter(p=>p.region==='near'),b.filter(p=>p.region==='near'),'far failure consumes no near random stream and secondary trees cannot steal its reserved ground');
  assert.equal(b.filter(p=>p.region==='far-fringe'||p.region==='far-deep').length,0,'unused far-coordinate extrema are not proof of support');
  assert.ok(b.every(p=>p.region&&p.z<=55));assert.ok(b.length<=76);
});
test('far subshares stay capped and alternate inside geographically balanced quality prefixes',()=>{
  const source=plane(-30,30,-30,30,2),land=plane(-100,100,-80,100,2),water={positions:new Float64Array([-100,1.3,40,-100,1.3,55,100,1.3,40,100,1.3,55]),indices:new Uint32Array([0,1,2,1,3,2])};
  const input={land,water,sourceLand:[source],sourceEnvelope:{minX:-30,maxX:30,minZ:-30,maxZ:30},village:{minX:-8,maxX:8,minZ:-8,maxZ:8},canopyRadius:2.2,maximumTrees:76,profile:'quest' as const};
  const all=createEaldholtWoodlandPlacements(input),counts=(list:typeof all)=>({source:list.filter(p=>p.region==='source').length,near:list.filter(p=>p.region==='near').length,farFringe:list.filter(p=>p.region==='far-fringe').length,farDeep:list.filter(p=>p.region==='far-deep').length,mainland:list.filter(p=>p.region==='mainland').length});
  assert.deepEqual(counts(all),{source:19,near:19,farFringe:10,farDeep:9,mainland:19});
  assert.deepEqual(counts(createEaldholtWoodlandPlacements({...input,maximumTrees:38})),{source:10,near:9,farFringe:5,farDeep:5,mainland:9});
  assert.deepEqual(counts(all.slice(0,24)),{source:6,near:6,farFringe:3,farDeep:3,mainland:6});
  const fringes=all.filter(p=>p.region==='far-fringe'),deeps=all.filter(p=>p.region==='far-deep');
  for(const p of fringes){const depth=p.z-55-input.canopyRadius*p.scale-.8;assert.ok(depth>=-1e-8&&depth<=5+1e-8);}
  assert.ok(Math.min(...deeps.map(p=>p.z))>Math.min(...fringes.map(p=>p.z)),'the deep share reaches beyond riparian geometry');
  const far=all.filter(p=>p.region==='far-fringe'||p.region==='far-deep');
  for(let i=0;i<far.length;i++)assert.equal(far[i].region,i%2===0?'far-fringe':'far-deep');
});

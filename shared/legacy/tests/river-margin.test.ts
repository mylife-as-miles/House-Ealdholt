import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtRiverValleyBuffers } from '../aethelgard/environment/river-valley';
import { createEaldholtRiverMarginPlacements, createEaldholtRiverOutcropBuffers, EALDHOLT_RIVER_MARGIN } from '../aethelgard/environment/river-margin';
import { sampleEaldholtWoodlandSupport } from '../aethelgard/environment/river-woodland';

test('shore margin leaves irregular gaps, roots on actual dry support and no source-village or outer-edge scatter',()=>{
  const edge=[[-10,2],[10,2]]as const,data=createEaldholtRiverValleyBuffers({minX:-10,maxX:10,minZ:-10,maxZ:10,west:edge,east:edge,north:edge,south:edge},'quest');
  const input={land:{positions:data.land.positions,indices:data.land.indices},water:{positions:data.water.positions,indices:data.water.indices},village:{minX:-10,maxX:10,minZ:-10,maxZ:10},grassRadius:.58,maximumGrass:10,maximumStones:4,profile:'quest'as const};
  const a=createEaldholtRiverMarginPlacements(input),b=createEaldholtRiverMarginPlacements(input);assert.deepEqual(a,b);assert.ok(a.grass.length>0&&a.grass.length<=10);assert.ok(a.stones.length>0&&a.stones.length<=4);
  for(const [kind,list]of Object.entries(a))for(const p of list){
    const support=sampleEaldholtWoodlandSupport(input.land,p.x,p.z)!;assert.ok(support);assert.equal(sampleEaldholtWoodlandSupport(input.water,p.x,p.z),null);
    assert.ok(p.x-p.footprint>data.bounds.min[0]+2&&p.x+p.footprint<data.bounds.max[0]-2);assert.ok(p.z-p.footprint>data.bounds.min[2]+2&&p.z+p.footprint<data.bounds.max[2]-2);
    assert.ok(p.x+p.footprint<=-10||p.x-p.footprint>=10||p.z+p.footprint<=-10||p.z-p.footprint>=10);
    if(kind==='grass')assert.ok(Math.abs(p.y-support.height)<1e-9);else assert.ok(p.y<=support.height+1e-9);
    for(let i=0;i<8;i++){const angle=i*Math.PI/4,x=p.x+Math.cos(angle)*p.footprint,z=p.z+Math.sin(angle)*p.footprint;assert.ok(sampleEaldholtWoodlandSupport(input.land,x,z));assert.equal(sampleEaldholtWoodlandSupport(input.water,x,z),null);}
  }
  assert.ok(new Set(a.grass.map(p=>p.yaw.toFixed(2))).size>6);assert.ok(new Set(a.grass.map(p=>p.z.toFixed(1))).size>6);
  assert.ok(a.grass.every(p=>{const t=(p.x-data.bounds.min[0])/(data.bounds.max[0]-data.bounds.min[0]);return!(t>.495&&t<.515)&&!(t>.685&&t<.705);}));
  assert.throws(()=>createEaldholtRiverMarginPlacements({...input,maximumGrass:121}),/bounded/);
});

test('the original outcrop has three closed distinct low-profile forms with coherent facets and bounded buffers',()=>{
  const a=createEaldholtRiverOutcropBuffers(),b=createEaldholtRiverOutcropBuffers();assert.deepEqual(a,b);
  assert.equal(a.forms,3);assert.equal(a.triangles,180);assert.equal(a.indices.length/3,180);assert.equal(a.byteLength,18360);
  assert.equal(a.positions.length,a.normals.length);assert.equal(a.uv.length/2,a.positions.length/3);
  const width=a.bounds.max[0]-a.bounds.min[0],depth=a.bounds.max[2]-a.bounds.min[2],height=a.bounds.max[1]-a.bounds.min[1];
  assert.ok(Math.max(width,depth)*1.03<2.5);assert.ok(Math.max(width,depth)*.72>1.4);assert.ok(height>.6&&height<.8);
  const volumes:number[]=[],heights:number[]=[];
  for(let form=0;form<3;form++){
    let volume=0,highest=-Infinity;const edges=new Map<string,number>();
    for(let triangle=form*60;triangle<(form+1)*60;triangle++){
      const points=[0,1,2].map(c=>Array.from(a.positions.slice(a.indices[triangle*3+c]*3,a.indices[triangle*3+c]*3+3)));
      const [p,q,r]=points,cross=[q[1]*r[2]-q[2]*r[1],q[2]*r[0]-q[0]*r[2],q[0]*r[1]-q[1]*r[0]];volume+=(p[0]*cross[0]+p[1]*cross[1]+p[2]*cross[2])/6;
      for(let c=0;c<3;c++){
        highest=Math.max(highest,points[c][1]);const edge=[points[c].join(','),points[(c+1)%3].join(',')].sort().join('|');edges.set(edge,(edges.get(edge)??0)+1);
        const offset=a.indices[triangle*3+c]*3;assert.ok(Math.abs(Math.hypot(...a.normals.slice(offset,offset+3))-1)<1e-6);
      }
    }
    assert.ok(volume>0,'each closed form has outward winding and real volume');assert.ok([...edges.values()].every(count=>count===2),'no open seams or missing underside');volumes.push(volume);heights.push(highest);
  }
  assert.equal(new Set(volumes.map(v=>v.toFixed(4))).size,3);assert.equal(new Set(heights.map(v=>v.toFixed(3))).size,3);
});

test('unsupported land returns an empty margin instead of forcing floating groups, with explicit profile budgets',()=>{
  const edge=[[-10,2],[10,2]]as const,data=createEaldholtRiverValleyBuffers({minX:-10,maxX:10,minZ:-10,maxZ:10,west:edge,east:edge,north:edge,south:edge},'quest');
  const result=createEaldholtRiverMarginPlacements({land:{positions:new Float32Array(),indices:new Uint16Array()},water:data.water,village:{minX:-10,maxX:10,minZ:-10,maxZ:10},grassRadius:.5,maximumGrass:10,maximumStones:4,profile:'quest'});
  assert.deepEqual(result,{grass:[],stones:[]});assert.equal(EALDHOLT_RIVER_MARGIN.desktop.maximumTriangles,12000);assert.equal(EALDHOLT_RIVER_MARGIN.quest.maximumTriangles,3000);
});

test('Native searches an actual dry shoulder on either bank without reducing its whole outcrop footprint',()=>{
  // Only the southern shoulder has land. The narrow shore strip itself is
  // unsupported, so a valid group needs the farther shoulder search.
  const land={positions:new Float32Array([0,1,-20,0,1,-3,100,1,-3,100,1,-20]),indices:new Uint16Array([0,1,2,0,2,3])};
  const positions:number[]=[],indices:number[]=[];
  for(let i=0;i<=10;i++){
    const x=i*10,center=.4*Math.sin(i);positions.push(x,0,center-2,x,0,center+2);
    if(i){const a=(i-1)*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  }
  const water={positions:Float32Array.from(positions),indices:Uint16Array.from(indices)},outcrop=createEaldholtRiverOutcropBuffers();
  const result=createEaldholtRiverMarginPlacements({land,water,village:{minX:-100,maxX:-90,minZ:-100,maxZ:-90},grassRadius:0,
    stoneRadius:outcrop.footprintRadius,maximumGrass:0,maximumStones:4,profile:'quest'});
  assert.ok(result.stones.length>=2&&result.stones.length<=4);assert.equal(result.grass.length,0);
  for(const group of result.stones){
    assert.ok(group.scale>=.72&&group.scale<=1.03);assert.equal(group.footprint,outcrop.footprintRadius*group.scale);
    assert.ok(group.z+group.footprint<=-5,'the complete group clears the unsupported near-shore strip and outer land edge');
    for(let i=0;i<8;i++){const angle=i*Math.PI/4,x=group.x+Math.cos(angle)*group.footprint,z=group.z+Math.sin(angle)*group.footprint;
      assert.ok(sampleEaldholtWoodlandSupport(land,x,z));assert.equal(sampleEaldholtWoodlandSupport(water,x,z),null);}
  }
});

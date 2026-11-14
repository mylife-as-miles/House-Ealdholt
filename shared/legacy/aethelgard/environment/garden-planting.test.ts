import assert from 'node:assert/strict';
import test from 'node:test';
import { qualifyEaldholtPondShore } from './pond-shore';
import { GARDEN_SPECIES, GARDEN_LIMITS, createGardenBotanicalGeometry, gardenPondDistance, gardenTerrainSupport,
  planEaldholtGarden } from './garden-planting';

function plane(size:number,y:number){return[-size,y,-size,-size,y,size,size,y,size,-size,y,-size,size,y,size,size,y,-size];}
const outline=qualifyEaldholtPondShore(plane(10,0));
const terrain=plane(24,.2);
test('deterministic non-grid beds preserve exact source terrain and avoid complete authored obstacles',()=>{
  const blockers=[{minX:-17,maxX:-8,minZ:-18,maxZ:18}],input={outline,terrain,blockers,canopies:[{x:13,z:0,radius:20}]};
  const before=terrain.slice(),a=planEaldholtGarden(input),b=planEaldholtGarden(input);
  assert.deepEqual(a,b);assert.deepEqual(terrain,before);assert.ok(a.placements.length>15);assert.ok(a.placements.length<=GARDEN_LIMITS.desktop.plants);
  assert.ok(a.placements.some(p=>p.habitat==='shade'));assert.ok(a.placements.some(p=>p.habitat==='sunny'));
  for(const p of a.placements){assert.ok(p.x+p.radius<=-17||p.x-p.radius>=-8||p.z+p.radius<=-18||p.z-p.radius>=18);
    if(p.habitat!=='margin'){assert.equal(p.y,.194);assert.ok(gardenPondDistance(outline,p.x,p.z)<-p.radius);}}
  assert.ok(a.placements.some(p=>Math.abs(p.x*4-Math.round(p.x*4))>.05),'darts do not fall on a repeated lattice');
  const quest=planEaldholtGarden({...input,profile:'quest'});assert.ok(quest.placements.length<=GARDEN_LIMITS.quest.plants);
  assert.ok(quest.placements.length<a.placements.length);
});

test('whole support detects a narrow source hole between footprint probes and never invents outside terrain',()=>{
  const raw:number[]=[],add=(x:number,z:number,w:number,h:number)=>{raw.push(x,.2,z,x,.2,z+h,x+w,.2,z+h,x,.2,z,x+w,.2,z+h,x+w,.2,z);};
  add(-4,-4,8,4.12);add(-4,.2,8,3.8);add(-4,.12,4.18,.08);add(.22,.12,3.78,.08);
  const support=gardenTerrainSupport(raw);assert.ok(support.at(0,0));assert.equal(support.covered(0,0,.6),false);
  assert.equal(support.at(10,0),null);assert.equal(support.covered(10,0,.1),false);
  const empty=planEaldholtGarden({outline,terrain:plane(1,.2)});assert.equal(empty.placements.length,0);
});

test('lily rafts require the actual entire supported underwater footprint and stay on original water height',()=>{
  const wet=planEaldholtGarden({outline,terrain:plane(24,-.45)}),dry=planEaldholtGarden({outline,terrain});
  const lilies=wet.placements.filter(p=>p.habitat==='water');assert.ok(lilies.length>5);
  for(const p of lilies){assert.equal(p.y,0);assert.ok(gardenPondDistance(outline,p.x,p.z)>p.radius);}
  assert.equal(dry.placements.filter(p=>p.habitat==='water').length,0);
  assert.ok(wet.placements.filter(p=>p.habitat==='sunny'||p.habitat==='shade').every(p=>gardenPondDistance(outline,p.x,p.z)<-p.radius),
    'terrain below the cap height is still dry where there is no source water cap');
});

test('original shallow source water qualifies white and pink rafts without inventing bathymetry',()=>{
  const shallow=planEaldholtGarden({outline,terrain:plane(24,-.06968311)}),occluded=planEaldholtGarden({outline,terrain:plane(24,.002)});
  assert.ok(shallow.placements.some(p=>p.species==='white-lily'));assert.ok(shallow.placements.some(p=>p.species==='pink-lily'));
  assert.ok(shallow.water.visibleWater>0);assert.ok(shallow.water.raftInset>0);assert.ok(shallow.water.acceptedRafts>0);
  assert.ok(Math.abs(shallow.water.maximumDepth!-.06968311)<1e-8);assert.equal(occluded.water.visibleWater,0);
  assert.equal(occluded.water.acceptedRafts,0);assert.ok(occluded.water.terrainOccluded>0);
});

test('all botanical profiles have finite curved PBR surfaces, valid indices and bounded reusable geometry',()=>{
  let triangles=0;
  for(const species of GARDEN_SPECIES){const a=createGardenBotanicalGeometry(species),b=createGardenBotanicalGeometry(species);
    assert.deepEqual(a,b);assert.equal(a.positions.length,a.colours.length);assert.ok(a.positions.every(Number.isFinite));
    assert.ok(a.indices.every(i=>i<a.positions.length/3));assert.ok(a.height>.02&&a.height<1.6);assert.ok(a.triangles<6000);
    for(let i=0;i<a.indices.length;i+=3){const p=a.positions,A=a.indices[i]*3,B=a.indices[i+1]*3,C=a.indices[i+2]*3,
      ux=p[B]-p[A],uy=p[B+1]-p[A+1],uz=p[B+2]-p[A+2],vx=p[C]-p[A],vy=p[C+1]-p[A+1],vz=p[C+2]-p[A+2];
      assert.ok(Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)>1e-12,species+' has no zero-area botanical faces');}
    triangles+=a.triangles;
  }
  assert.ok(triangles<35_000);
});

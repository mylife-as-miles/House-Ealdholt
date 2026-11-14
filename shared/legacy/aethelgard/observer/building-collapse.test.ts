import test from'node:test';import assert from'node:assert/strict';
import{createBuildingCollapse,BUILDING_COLLAPSE_MAX_STEPS,BUILDING_COLLAPSE_STEP}from'./building-collapse';
import{buildSourceBuildingCatalogue,type BuildingSourcePart}from'./building-damage-catalogue';
const parts:BuildingSourcePart[]=[];
for(let i=0;i<2;i++)for(const[id,kind,min,max]of[
 ['door','door',[-2,0,-.1],[2,2,.1]],['back','wall',[-2,0,2.9],[2,2,3.1]],['roof','roof',[-2.2,2,-.2],[2.2,2.4,3.2]],
]as const)parts.push({id:id+i,kind,bounds:{min:[min[0]+i*15,min[1],min[2]],max:[max[0]+i*15,max[1],max[2]]}});
const catalogue=buildSourceBuildingCatalogue({parts,sourceSha256:'3'.repeat(64),profile:'desktop'});
const record={binding:catalogue.buildings[0].binding,condition:'burned'as const,rebuild:null,collapseAtMinute:100};
test('collapse follows the configured world-minute duration rather than assuming sixty real seconds',()=>{
 const physics=createBuildingCollapse({buildings:catalogue.buildings,secondsPerWorldMinute:()=>4});
 physics.update([record],100.25);
 assert.equal(physics.stats.steps,60,'One world-quarter-minute is one physical second in the current clock preset.');
 assert.ok(physics.transforms().some(t=>t.translation[1]<-.1));
 physics.update([record],102);assert.equal(physics.stats.steps,480);
 assert.throws(()=>createBuildingCollapse({buildings:catalogue.buildings,secondsPerWorldMinute:()=>0}).update([record],101),/clock duration/);
});
test('real fixed-step gravity drops original modules, makes contacts and retains the settled ruin',()=>{
 const physics=createBuildingCollapse({buildings:catalogue.buildings,groundHeight:()=>0}),source=structuredClone(physics.colliders());
 physics.update([record],100);assert.equal(physics.stats.steps,0);physics.update([record],100+1/60);
 assert.equal(physics.stats.steps,60);assert.ok(physics.transforms().some(t=>t.translation[1]<-.1),'Gravity must lower a source body before settlement.');
 physics.update([record],101);assert.equal(physics.stats.steps,BUILDING_COLLAPSE_MAX_STEPS);assert.ok(physics.stats.contacts>0);assert.equal(physics.stats.fallingParts,0);assert.equal(physics.stats.settledParts,3);
 for(const c of physics.navigationObstacles()){assert.equal(c.activeFromAbsoluteMinute,100);assert.ok(c.bounds.min[1]>=-1e-5,'No ruin body may settle below actual terrain.');}
 assert.notDeepEqual(physics.colliders(),source);const settled=physics.colliders();assert.equal(physics.update([record],10000),false);assert.equal(physics.colliders(),settled);assert.equal(physics.stats.steps,480);
});
test('source-qualified identity, unrelated siblings, cadence and cold replay are deterministic',()=>{
 const a=createBuildingCollapse({buildings:catalogue.buildings}),b=createBuildingCollapse({buildings:catalogue.buildings});
 const sibling=a.colliders().filter(c=>c.binding.buildingId!==record.binding.buildingId);for(let i=0;i<=15;i++)a.update([record],100+i/100);b.update([record],100.15);
 assert.deepEqual(a.colliders(),b.colliders());assert.deepEqual(a.colliders().filter(c=>c.binding.buildingId!==record.binding.buildingId),sibling);
 b.update([{...record,binding:{...record.binding,siteIndex:99}}],101);assert.equal(b.navigationObstacles().length,0);
});
test('only actual labour restores complete original modules progressively and sound restores exact shape',()=>{
 const physics=createBuildingCollapse({buildings:catalogue.buildings}),source=physics.colliders().map(c=>c.bounds);physics.update([record],101);
 const ruin=physics.transforms();physics.update([{...record,condition:'rebuilding',rebuild:{crewId:'real',startedMinute:100,labourRequired:180,labourDone:60,timberCommitted:12}}],101);
 assert.equal(physics.stats.restoredParts,1);assert.equal(physics.stats.settledParts,2);assert.ok(physics.transforms().some(t=>t.state==='restored'&&t.translation.every(n=>n===0)&&t.rotation.every(n=>n===0)));assert.notDeepEqual(physics.transforms(),ruin);
 physics.update([{...record,condition:'sound'}],101);assert.equal(physics.navigationObstacles().length,0);assert.deepEqual(physics.colliders().map(c=>c.bounds),source);assert.equal(physics.stats.activeBuildings,0);
});
test('terrain supports are real source-coordinate contacts and pausing never adds physical steps',()=>{
 const physics=createBuildingCollapse({buildings:catalogue.buildings,groundHeight:()=>.25});physics.update([record],101);const steps=physics.stats.steps,snapshot=physics.colliders();
 assert.ok(physics.navigationObstacles().every(c=>c.bounds.min[1]>=.25-1e-5));physics.update([record],101);assert.equal(physics.stats.steps,steps);assert.equal(physics.colliders(),snapshot);assert.throws(()=>physics.update([record],NaN),/finite/);
});
test('earned repair observed during the brief fall is cadence independent and restores only after contact settlement',()=>{
 const a=createBuildingCollapse({buildings:catalogue.buildings}),b=createBuildingCollapse({buildings:catalogue.buildings}),repair={...record,condition:'rebuilding'as const,rebuild:{crewId:'real',startedMinute:100,labourRequired:180,labourDone:60,timberCommitted:12}};
 a.update([record],100.05);a.update([repair],100.1);b.update([repair],100.1);assert.deepEqual(a.colliders(),b.colliders());assert.equal(a.stats.restoredParts,0);
 a.update([repair],101);b.update([repair],101);assert.deepEqual(a.colliders(),b.colliders());assert.equal(a.stats.restoredParts,1);
});
test('an unavailable explicit ground source holds original modules instead of inventing a foundation',()=>{
 for(const groundHeight of[()=>NaN,(x:number)=>x>0?NaN:0,()=>{throw Error('source unavailable');}]){
  const physics=createBuildingCollapse({buildings:catalogue.buildings,groundHeight}),original=physics.colliders().map(c=>c.bounds);
  physics.update([record],101);assert.equal(physics.stats.steps,0);assert.equal(physics.stats.contacts,0);
  assert.equal(physics.stats.heldBuildings,1);assert.equal(physics.stats.heldParts,3);assert.equal(physics.stats.supportHolds,1);
  assert.deepEqual(physics.colliders().map(c=>c.bounds),original);assert.ok(physics.colliders().every(c=>c.state==='source'));
  assert.ok(physics.transforms().every(t=>t.translation.every(n=>n===0)&&t.rotation.every(n=>n===0)));
  physics.update([record],102);assert.equal(physics.stats.steps,0);assert.equal(physics.stats.supportHolds,1,'Repeated unavailable samples retain the same hold.');
 }
});
test('terrain loss retains the last qualified fall and repair state; restored source resumes deterministic catchup',()=>{
 let available=true;const physics=createBuildingCollapse({buildings:catalogue.buildings,groundHeight:()=>available?0:NaN}),reference=createBuildingCollapse({buildings:catalogue.buildings,groundHeight:()=>0});
 physics.update([record],100.01);const steps=physics.stats.steps,colliders=physics.colliders(),transforms=physics.transforms();available=false;
 const repair={...record,condition:'rebuilding'as const,rebuild:{crewId:'real',startedMinute:100,labourRequired:180,labourDone:180,timberCommitted:12}};
 physics.update([repair],101);assert.equal(physics.stats.steps,steps);assert.equal(physics.stats.heldBuildings,1);assert.equal(physics.stats.restoredParts,0);
 assert.equal(physics.colliders(),colliders);assert.equal(physics.transforms(),transforms);
 available=true;physics.update([repair],101);reference.update([repair],101);assert.equal(physics.stats.heldBuildings,0);assert.deepEqual(physics.colliders(),reference.colliders());
});
test('support disappearing during a proposed step rolls it back without a partial transform or contact receipt',()=>{
 let calls=0;const physics=createBuildingCollapse({buildings:catalogue.buildings,groundHeight:()=>++calls<=27?0:NaN}),original=physics.colliders().map(c=>c.bounds);
 physics.update([record],101);assert.ok(calls>27,'Initial source footprint is qualified before the proposed motion.');
 assert.equal(physics.stats.steps,0);assert.equal(physics.stats.contacts,0);assert.equal(physics.stats.heldBuildings,1);
 assert.deepEqual(physics.colliders().map(c=>c.bounds),original);assert.ok(physics.transforms().every(t=>t.translation.every(n=>n===0)&&t.rotation.every(n=>n===0)));
});
test('interval obstacle projection is pure, source-bound and cannot advance a live fall twice',()=>{
 const physics=createBuildingCollapse({buildings:catalogue.buildings,groundHeight:()=>0,secondsPerWorldMinute:()=>4});physics.update([record],100.25);
 const stats=structuredClone(physics.stats),poses=physics.transforms(),colliders=physics.colliders(),obstacles=physics.navigationObstacles();
 const swept=physics.sweptObstacles([record],100.25,101);assert.equal(swept.length,3);assert.ok(swept.every(c=>c.binding===record.binding&&c.activeFromAbsoluteMinute===100));
 assert.equal(physics.transforms(),poses);assert.equal(physics.colliders(),colliders);assert.equal(physics.navigationObstacles(),obstacles);assert.deepEqual(physics.stats,stats);
 assert.deepEqual(physics.sweptObstacles([record],100.25,101),swept);assert.deepEqual(physics.stats,stats);
 const cold=createBuildingCollapse({buildings:catalogue.buildings,groundHeight:()=>0,secondsPerWorldMinute:()=>4});assert.deepEqual(cold.sweptObstacles([record],100.25,101),swept);assert.equal(cold.stats.steps,0);
 physics.update([record],101);cold.update([record],101);assert.equal(physics.stats.steps,240);assert.deepEqual(physics.colliders(),cold.colliders());
 assert.deepEqual(physics.sweptObstacles([{...record,binding:{...record.binding,siteIndex:99}}],100,101),[]);
 assert.deepEqual(physics.sweptObstacles([{...record,collapseAtMinute:102}],100,101),[]);
});
test('swept source bounds contain every accepted step and intermediate rotating module corner',()=>{
 const queried:[number,number][]=[];let capture=true;
 const input={buildings:catalogue.buildings,groundHeight:(x:number,z:number)=>{if(capture)queried.push([x,z]);return 0;},secondsPerWorldMinute:()=>4},physics=createBuildingCollapse(input),reference=createBuildingCollapse(input);
 const swept=physics.sweptObstacles([record],100,101),byPart=new Map(swept.map(c=>[c.sourcePartId,c.bounds]));capture=false;
 for(const[x,z]of queried)assert.ok(swept.some(c=>x>=c.bounds.min[0]-1e-8&&x<=c.bounds.max[0]+1e-8&&z>=c.bounds.min[2]-1e-8&&z<=c.bounds.max[2]+1e-8),'Every source contact-correction footprint must be inside the sweep.');
 reference.update([record],100);
 const building=catalogue.buildings[0];let prior=reference.transforms();
 for(let step=1;step<=240;step++){
  reference.update([record],100+step*BUILDING_COLLAPSE_STEP/4);const current=reference.transforms();
  for(const part of building.parts){const bounds=byPart.get(part.id)!;assert.ok(bounds);
   const a=prior.find(t=>t.sourcePartId===part.id)!,b=current.find(t=>t.sourcePartId===part.id)!;
   for(const fraction of[0,.25,.5,.75,1]){
    const centre=part.bounds.min.map((n,k)=>(n+part.bounds.max[k])/2+a.translation[k]+(b.translation[k]-a.translation[k])*fraction);
    const rx=a.rotation[0]+(b.rotation[0]-a.rotation[0])*fraction,rz=a.rotation[2]+(b.rotation[2]-a.rotation[2])*fraction;
    for(let corner=0;corner<8;corner++){
     const p=part.bounds.min.map((n,k)=>((corner&(1<<k))?part.bounds.max[k]:n)-(n+part.bounds.max[k])/2);
     const x=p[0],y=p[1]*Math.cos(rx)-p[2]*Math.sin(rx),z=p[1]*Math.sin(rx)+p[2]*Math.cos(rx);
     const world=[x*Math.cos(rz)-y*Math.sin(rz)+centre[0],x*Math.sin(rz)+y*Math.cos(rz)+centre[1],z+centre[2]];
     for(let k=0;k<3;k++)assert.ok(world[k]>=bounds.min[k]-1e-8&&world[k]<=bounds.max[k]+1e-8,`step${step} ${part.id} corner${corner} axis${k} escaped swept debris`);
    }
   }
  }
  prior=current;
 }
});
test('unavailable sweep terrain preserves the qualified pose without adding unsupported motion or changing owner diagnostics',()=>{
 let available=true;const physics=createBuildingCollapse({buildings:catalogue.buildings,groundHeight:()=>available?0:NaN,secondsPerWorldMinute:()=>4});physics.update([record],100.1);
 const current=physics.navigationObstacles(),stats=structuredClone(physics.stats);available=false;
 const held=physics.sweptObstacles([record],100.1,101);assert.deepEqual(held.map(c=>c.bounds),current.map(c=>c.bounds));assert.deepEqual(physics.stats,stats);
 const cold=createBuildingCollapse({buildings:catalogue.buildings,groundHeight:()=>NaN});const source=cold.colliders().filter(c=>c.binding.buildingId===record.binding.buildingId);
 assert.deepEqual(cold.sweptObstacles([record],100,101).map(c=>c.bounds),source.map(c=>c.bounds));assert.equal(cold.stats.steps,0);assert.equal(cold.stats.heldBuildings,0);
});
test('sweeps omit restored modules and bound distant catchup to the same eight-second episode and one clock sample',()=>{
 let reads=0,samples=0;const physics=createBuildingCollapse({buildings:catalogue.buildings,groundHeight:()=>{samples++;return 0;},secondsPerWorldMinute:()=>{reads++;return 4;}});
 const far=physics.sweptObstacles([record],100,1e9);assert.equal(reads,1);assert.equal(physics.stats.steps,0);assert.ok(samples<100000,'Catch-up never runs beyond480 fixed steps.');assert.equal(far.length,3);
 const repair={...record,condition:'rebuilding'as const,rebuild:{crewId:'real',startedMinute:100,labourRequired:180,labourDone:180,timberCommitted:12}};
 physics.update([repair],102);assert.deepEqual(physics.sweptObstacles([repair],102,103),[]);
 for(const interval of[[NaN,101],[-1,101],[101,100],[100,Infinity]])assert.throws(()=>physics.sweptObstacles([record],interval[0],interval[1]),/finite ordered/);
});

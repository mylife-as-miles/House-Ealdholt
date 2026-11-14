import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,symlinkSync,rmSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {SOURCE_PROXY,sourceClearanceProxy,terrainInterval,projectTerrainProfile,cylinderIntersectsTriangle,measureSourceTopology,createSourceGeometryOracle} from './village-source-geometry.mts';
import {validateFreshSourceOptions,privateSourceOutput,measureReleasedVillageGeometry,RELEASED_SOURCE_SHA256} from './village-source-authoring.mts';
import {createEaldholtVillageSite,validateVillageSiteRigidClearance,applyVillageSiteRigidClearance} from '../../shared/legacy/aethelgard/characters/village-site.ts';
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const loadThree=()=>import(new URL('../../main game/node_modules/three/build/three.module.js',import.meta.url).href);

test('terrain projection follows an actual ridge between endpoints and rejects an unsupported hole',()=>{
 const a=[-2,0,0],b=[2,0,0],triangles=[
  [[-2,0,-2],[0,.3,-2],[-2,0,2]],[[0,.3,-2],[0,.3,2],[-2,0,2]],
  [[0,.3,-2],[2,0,-2],[0,.3,2]],[[2,0,-2],[2,0,2],[0,.3,2]],
 ];
 const projected=projectTerrainProfile(a,b,triangles.map(t=>terrainInterval(a,b,t)));
 assert.ok(projected);assert.ok(projected.points.some(p=>Math.abs(p[0])<1e-9&&Math.abs(p[1]-.3)<1e-9));
 assert.ok(Math.abs(projected.maximumUnsplitDeviationMetres-.3)<1e-9);assert.ok(projected.maximumEmittedDeviationMetres<1e-9);
 const missing=triangles.filter((_,i)=>i!==1);assert.equal(projectTerrainProfile(a,b,missing.map(t=>terrainInterval(a,b,t))),null);
 const stacked=triangles.concat(triangles.map(t=>t.map(p=>[p[0],p[1]+1,p[2]])));
 assert.equal(projectTerrainProfile(a,b,stacked.map(t=>terrainInterval(a,b,t))),null,'overlapping terrain layers cannot supply an invented height');
});

test('original rigid triangles block the complete capsule, and an overhead roof excludes interiors',()=>{
 const wall=[[0,0,-2],[0,4,-2],[0,0,2]],a=[-2,0,0],b=[2,0,0];
 assert.equal(cylinderIntersectsTriangle(a,b,wall,.85,.005,2.1),true);
 assert.equal(cylinderIntersectsTriangle([-2,0,3],[2,0,3],wall,.85,.005,2.1),false);
 const roof=[[-4,4,-4],[4,4,-4],[0,4,4]];
 assert.equal(cylinderIntersectsTriangle([0,0,0],[0,0,0],roof,.85,.005,2.1),false);
 assert.equal(cylinderIntersectsTriangle([0,0,0],[0,0,0],roof,.85,.005,30),true);
});

test('fresh clearance height has an explicit bounded override and cannot reduce existing margins',async()=>{
 assert.deepEqual(sourceClearanceProxy(),SOURCE_PROXY);const tall=sourceClearanceProxy(3.5);
 assert.deepEqual(tall,{...SOURCE_PROXY,height:3.5});assert.ok(Object.isFrozen(tall));assert.equal(SOURCE_PROXY.height,2.1);
 for(const height of [2.099999999,3.500000001,NaN,Infinity,'3.5'])assert.throws(()=>sourceClearanceProxy(height as any),/between 2.1 and 3.5/);
 const three=await loadThree(),{MeshBVH}=await import('../../main game/node_modules/three-mesh-bvh/src/index.js');
 const ground=[-5,0,-5,5,0,-5,-5,0,5,5,0,-5,5,0,5,-5,0,5],beam=[-4,3,-4,4,3,-4,0,3,4],topology=measureSourceTopology(ground);
 const inputs={three,MeshBVH,ground,groundActors:['LandscapeComponent_0','LandscapeComponent_0'],solid:beam,water:[],proofBox:new three.Box3(new three.Vector3(-10,-2,-10),new three.Vector3(10,6,10)),topology};
 const normal=createSourceGeometryOracle(inputs),armed=createSourceGeometryOracle({...inputs,proxy:tall});
 try{assert.equal(normal.solidClear([0,0,0],[0,0,0]),true);assert.equal(armed.solidClear([0,0,0],[0,0,0]),false,'the actual triangle at3m must obstruct the taller body');
  assert.equal(normal.stand([0,0,0]),false);assert.equal(armed.stand([0,0,0]),false,'exterior roof exclusion stays active at both heights');
 }finally{normal.dispose();armed.dispose();}
});

test('whole footprint support rejects source boundaries and water rather than trusting a centre ray',async()=>{
 const three=await loadThree();
 const {MeshBVH}=await import('../../main game/node_modules/three-mesh-bvh/src/index.js');
 const ground=[-5,0,-5,5,0,-5,-5,0,5,5,0,-5,5,0,5,-5,0,5],solid=[20,0,20,20,3,20,20,0,23];
 const topology=measureSourceTopology(ground),water=[new three.Box3(new three.Vector3(1,-1,-1),new three.Vector3(3,1,1))];
 const oracle=createSourceGeometryOracle({three,MeshBVH,ground,groundActors:['LandscapeComponent_0','LandscapeComponent_0'],solid,water,proofBox:new three.Box3(new three.Vector3(-10,-2,-10),new three.Vector3(10,6,10)),topology});
 try{assert.ok(oracle.floor(4.8,0));assert.equal(oracle.stand([4.8,0,0]),false,'centre support cannot authorize a cylinder past the terrain edge');
  assert.equal(oracle.stand([1.5,0,0]),false,'a water surface keeps the actual standing footprint held');assert.ok(oracle.stand([-2,0,0]));
 }finally{oracle.dispose();}
});

test('duplicate terrain faces cannot pair away a boundary and authorize an unsupported footprint',async()=>{
 const triangle=[0,0,0,4,0,0,0,0,4],original=[...triangle],three=await loadThree(),{MeshBVH}=await import('../../main game/node_modules/three-mesh-bvh/src/index.js');
 const topology=measureSourceTopology(triangle);assert.equal(topology.boundaries.length,3);
 const oracle=createSourceGeometryOracle({three,MeshBVH,ground:triangle,groundActors:['LandscapeComponent_0'],solid:[20,0,20,20,3,20,20,0,23],water:[],proofBox:new three.Box3(new three.Vector3(-5,-2,-5),new three.Vector3(10,6,10)),topology});
 try{assert.ok(oracle.floor(.2,.2));assert.equal(oracle.stand([.2,0,.2]),false,'radius0.85 cannot fit0.2m from the real boundary');}finally{oracle.dispose();}
 assert.throws(()=>measureSourceTopology([...triangle,...triangle]),/Duplicate canonical source terrain faces/);
 assert.throws(()=>measureSourceTopology([...triangle,...triangle.map((v,i)=>i%3===0?v+.000005:v)]),/Duplicate canonical source terrain faces/);
 assert.deepEqual(triangle,original,'source coordinates remain unchanged');
});

test('inconsistent shared-edge directions and collapsed canonical faces fail before support evidence',()=>{
 const invertedNeighbour=[-2,0,-2,2,0,-2,-2,0,2,2,0,-2,-2,0,2,2,0,2];
 assert.throws(()=>measureSourceTopology(invertedNeighbour),/Inconsistent directed source terrain edge incidence/);
 assert.throws(()=>measureSourceTopology([0,0,0,.000001,0,0,0,0,4]),/Degenerate canonical source terrain face/);
 assert.throws(()=>measureSourceTopology([0,0,0,2,0,0,4,0,0]),/Degenerate canonical source terrain face/);
});

test('fresh authoring refuses old approval claims, wrong release identity and checkout output',()=>{
 assert.throws(()=>validateFreshSourceOptions({'base-site':'old.json'}),/previous certified base/);
 assert.throws(()=>validateFreshSourceOptions({'source-model':'x',profile:'desktop','output-dir':'/tmp/new-site','recast-root':'/tmp','candidate-id':'new-v1','source-sha256':'a'.repeat(64)}),/exact released profile/);
 assert.throws(()=>privateSourceOutput(resolve('artifacts/new-site')),/outside the checkout/);
 const base={'source-model':'x',profile:'desktop','output-dir':'/tmp/new-site','recast-root':'/tmp','candidate-id':'new-v1','source-sha256':RELEASED_SOURCE_SHA256.desktop};
 for(const height of ['2.0999999','3.500000001','NaN','Infinity'])assert.throws(()=>validateFreshSourceOptions({...base,'clearance-height':height}),/between 2.1 and 3.5/);
 const existing={...base,'source-model':fileURLToPath(import.meta.url)};
 assert.equal(validateFreshSourceOptions(existing).proxy.height,2.1);
 assert.equal(validateFreshSourceOptions({...existing,'clearance-height':'3.5'}).proxy.height,3.5);
});

test('clearance override cannot relabel a prior source-bound CLI input',()=>{
 const result=spawnSync(process.execPath,[resolve(repository,'main-game-vr/node_modules/tsx/dist/cli.mjs'),resolve(repository,'scripts/characters/build-village-life-sites.mts'),'--clearance-height','3.5'],{encoding:'utf8',timeout:30000});
 assert.notEqual(result.status,0);assert.match(result.stderr,/requires explicit --bootstrap-candidate/);
});

test('private output rejects dot-prefixed checkout children and resolves aliases before containment',()=>{
 const outside=mkdtempSync(resolve(tmpdir(),'crownfall-source-output-'));
 try{
  assert.throws(()=>privateSourceOutput(resolve(repository,'..private-assets')),/outside the checkout/);
  assert.throws(()=>privateSourceOutput(resolve(repository,'..private-assets','nested','not-created')),/outside the checkout/);
  assert.throws(()=>privateSourceOutput(resolve(repository,'artifacts','nonexistent-source-output','nested')),/outside the checkout/);
  const alias=resolve(outside,'checkout-alias');symlinkSync(repository,alias,'dir');
  assert.throws(()=>privateSourceOutput(resolve(alias,'..private-assets','nested','not-created')),/outside the checkout/);
  assert.throws(()=>privateSourceOutput(resolve(alias,'scripts','characters','not-created')),/outside the checkout/);
  assert.equal(privateSourceOutput(resolve(outside,'..private-assets','nested','not-created')),resolve(outside,'..private-assets','nested','not-created'));
 }finally{rmSync(outside,{recursive:true,force:true});}
});

const model=process.env.CROWNFALL_SOURCE_SITE_MODEL;
const candidate=process.env.CROWNFALL_SOURCE_SITE_CANDIDATE;
test('actual released source remeasures emitted routes, doors and failed clearances',
 {skip:!model||!candidate?'Set CROWNFALL_SOURCE_SITE_MODEL and CROWNFALL_SOURCE_SITE_CANDIDATE for original-geometry checks.':false},async()=>{
 const bytes=readFileSync(model!),sha=createHash('sha256').update(bytes).digest('hex');assert.equal(sha,RELEASED_SOURCE_SHA256.desktop);
 const data=JSON.parse(readFileSync(candidate!,'utf8'));assert.equal(data.authoringCandidate.status,'new-measured-candidate');assert.equal(data.authoringCandidate.previousPackageRecovered,false);assert.equal(data.authoringCandidate.freshWorldsOnly,true);
 assert.equal('motionEvidence'in data,false);assert.equal(data.lifeSite.households.length,25);assert.equal(data.residentPlaceBindings.filter((r:any)=>data.lifeSite.households.some((h:any)=>h.placeId===r.placeId)&&r.status==='mapped-exterior').length>=100,true);
 const unfiltered=createEaldholtVillageSite({profile:'desktop',modelSha256:sha,...data}),site=applyVillageSiteRigidClearance(unfiltered,validateVillageSiteRigidClearance(unfiltered,data.rigidSourceClearance));
 assert.ok(site.anchors.length>25);assert.ok(site.routes.length>25);
 const source=await measureReleasedVillageGeometry(model!,'desktop',sha,undefined,site.capsule.height);
 try{
  assert.equal(source.measurement.clearanceProxy.height,site.capsule.height);assert.equal(source.measurement.clearanceProxy.radius,site.capsule.radius);
  if(site.capsule.height>3){const settings=data.authoringCandidate.recastSettings;assert.equal(data.authoringCandidate.sourceMeasurement.clearanceProxy.height,site.capsule.height);assert.equal(settings.ch,.025);assert.equal(settings.walkableHeight,Math.ceil(site.capsule.height/settings.ch));if(site.capsule.height===3.5)assert.equal(settings.walkableHeight,140);}
  assert.equal(source.measurement.sourceOriginalBuffersUnchanged,true);assert.ok(source.measurement.frame.positionValuesCompared>1000);assert.ok(source.measurement.frame.transformedVerticesCompared>1000);
  assert.ok(source.measurement.frame.sourceFrameMatchesMaximumMetres<=1e-8);assert.equal(source.functional.filter((r:any)=>/Old_Stone_Well/.test(r.sourceActor)).length,2);
  assert.equal(source.measurement.seamTopology.canonicalFaceCount,source.measurement.terrainTriangles);assert.equal(source.measurement.seamTopology.duplicateCanonicalFaces,0);assert.equal(source.measurement.seamTopology.inconsistentDirectedEdgePairs,0);
  for(const home of data.lifeSite.households){assert.ok(source.doors.some((door:any)=>door.sourceActor===home.sourceDoor.sourceActor&&door.instance===home.sourceDoor.instance));const anchor=site.anchors.find(a=>a.id===home.anchorId)!;assert.ok(source.oracle.stand(anchor.sourceGroundPoint));}
  for(const anchor of site.anchors)assert.ok(source.oracle.stand(anchor.sourceGroundPoint),anchor.id);
  for(const route of site.routes)for(let i=1;i<route.sourceGroundPolyline.length;i++){const measured=source.oracle.leg(route.sourceGroundPolyline[i-1],route.sourceGroundPolyline[i]);assert.ok(measured,route.id);assert.ok(measured.maximumEmittedDeviationMetres<=SOURCE_PROXY.seamTolerance+1e-8);}
  const well=source.functional.find((r:any)=>/Old_Stone_Well/.test(r.sourceActor)),x=(well.min[0]+well.max[0])/2,z=(well.min[2]+well.max[2])/2,hit=source.oracle.floor(x,z);assert.ok(hit);assert.equal(source.oracle.stand(hit.point),false,'actual well walls are not a standing point');
  assert.equal(source.oracle.stand([-12,1,5]),false,'proof-box boundary cannot contain a full cylinder');
 }finally{source.dispose();}
 assert.equal(createHash('sha256').update(readFileSync(model!)).digest('hex'),sha);
});

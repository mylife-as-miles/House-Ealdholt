import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environmentFixture } from '../environment/fixtures';
import { buildAutumnSettlement,settlementBlueprint } from '../environment/settlement/build';
import { AUTUMN_LANDMARK_FOOTPRINTS,AUTUMN_SETTLEMENT_BUILDINGS,AUTUMN_SETTLEMENT_PATHS,AUTUMN_WATER_LEVEL,settlementHeight } from '../environment/settlement/layout';
import { AUTUMN_DEFAULT_PLACEMENTS,AUTUMN_SETTLEMENT_SURFACE,SettlementEnvironmentController } from '../environment/settlement/controller';
import { settlementTreeSites } from '../environment/settlement/nature';
import { createMaterialLibrary } from '../environment/materials/library';
import { estimateBudget,PLATFORM_BUDGETS } from '../environment/build/budget';
import { validatePlacement } from '../settlement/validation';
import { bannerholdRoutes } from '../exploration/bannerhold';
import { compileRouteNetwork,planAuthoredRoute } from '../exploration/navigation';
import { sourceShoreSites } from '../worlds/combined/shore-layout';
import { distanceToSettlementPath } from '../environment/settlement/layout';
import { atlasUv } from '../environment/heraldry/atlas';
const state=environmentFixture('founded');

test('settlement scaffold preserves semantic landmarks, protected foundations and finite original terrain',()=>{
 const before=JSON.stringify(state),build=buildAutumnSettlement({state,quality:'quest'}),lib=createMaterialLibrary(state.nationId);
 assert.deepEqual(build.landmarks.map(l=>l.id).sort(),AUTUMN_LANDMARK_FOOTPRINTS.map(p=>p.id).sort());
 for(const mesh of [...build.meshes,...build.instances.flatMap(i=>i.prototypes)]){
  assert.equal(lib.resolve(mesh.material),mesh.material,`material ${mesh.material} must not use an unrelated fallback`);
  assert.equal(mesh.positions.length,mesh.normals.length);
  assert.ok(mesh.positions.every(Number.isFinite));assert.ok(mesh.normals.every(Number.isFinite));
  assert.ok(mesh.indices.every(index=>index<mesh.positions.length/3));
 }
 // Architecture is native runtime source geometry, not a duplicate generic
 // worker mesh. Its actual vertices/attrs/bounds are checked by combined/verify-cpu.
 for(const landmark of build.landmarks)assert.ok(build.colliders.some(collider=>collider.landmark===landmark.id));
 assert.equal(JSON.stringify(state),before);
});

test('full road widths stay on dry ground outside every real rotated foundation',()=>{
 const build=buildAutumnSettlement({state,quality:'quest'});
 for(const path of AUTUMN_SETTLEMENT_PATHS)for(let i=1;i<path.points.length;i++){
  const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),steps=Math.ceil(length*2);
  for(let sample=0;sample<=steps;sample++)for(const offset of [-path.width/2,0,path.width/2]){
   const t=sample/steps,x=a[0]+dx*t-dz/length*offset,z=a[1]+dz*t+dx/length*offset;
   assert.ok(settlementHeight(x,z)>AUTUMN_WATER_LEVEL+.2,`${path.id} must stay above water`);
   for(const box of build.colliders){const xx=x-box.center[0],zz=z-box.center[2],co=Math.cos(box.yaw),si=Math.sin(box.yaw);assert.equal(Math.abs(co*xx-si*zz)<box.halfExtents[0]+.18&&Math.abs(si*xx+co*zz)<box.halfExtents[2]+.18,false,`${path.id} intersects a real foundation`);}
  }
 }
 const routes=bannerholdRoutes(state,build.colliders,settlementBlueprint(state.nationId),settlementHeight),compiled=compileRouteNetwork(routes.graph,routes.safety);assert.equal(compiled.ok,true);
 if(compiled.ok)for(const landmark of build.landmarks)assert.equal(planAuthoredRoute(compiled.network,routes.startNode,routes.destinations[landmark.id]).ok,true,`${landmark.id} must have a safe walking approach`);
});

test('the village starts without farm placements and fits documented baseline platform budgets',()=>{
 assert.deepEqual(AUTUMN_DEFAULT_PLACEMENTS,[]);
 for(const quality of ['quest','desktop-low'] as const){const budget=estimateBudget(buildAutumnSettlement({state,quality}));assert.ok(budget.triangles<PLATFORM_BUDGETS[quality].triangles);assert.ok(budget.drawCalls<PLATFORM_BUDGETS[quality].drawCalls);}
});

test('editor retains cosmetic edits across match/status updates and isolates banners and fixtures',()=>{
 const presentation={...state,bannerId:'test-banner'},before=JSON.stringify(presentation),controller=new SettlementEnvironmentController(presentation,'bannerhold',AUTUMN_SETTLEMENT_SURFACE,AUTUMN_DEFAULT_PLACEMENTS);
 assert.equal(controller.getSettlementSnapshot().placements.length,0);assert.equal(controller.setSettlementTool('cottage'),true);assert.equal(controller.getSettlementSnapshot().preview!.valid,true);assert.equal(controller.commitSettlementPlacement(),true);
 controller.setState({...presentation,chronicleCount:3,unreadNotices:0});assert.equal(controller.getSettlementSnapshot().placements.length,1);assert.equal(controller.getSettlementSnapshot().storageError,null);assert.equal(JSON.stringify(presentation),before);
 controller.setState({...presentation,bannerId:'another-banner'});assert.equal(controller.getSettlementSnapshot().placements.length,0);controller.dispose();
 const tree=settlementTreeSites().find(t=>Math.abs(t.x)<75&&Math.abs(t.z)<75)!;
 assert.ok(validatePlacement({id:'probe',kind:'cottage',x:tree.x,z:tree.z,width:8,depth:7,rotation:0,crop:null},AUTUMN_SETTLEMENT_SURFACE,AUTUMN_DEFAULT_PLACEMENTS),'a cottage cannot be rendered through an existing trunk');
});

test('authored starter ground and rendered source shoreline agree with estate and route safety',()=>{
 for(const p of [{id:'cottage-probe',kind:'cottage' as const,x:4,z:7,width:8,depth:7,rotation:0 as const,crop:null},{id:'pavilion-probe',kind:'pavilion' as const,x:32,z:56,width:4,depth:4,rotation:0 as const,crop:null}])assert.equal(validatePlacement(p,AUTUMN_SETTLEMENT_SURFACE,AUTUMN_DEFAULT_PLACEMENTS),null);
 const rocks=sourceShoreSites();assert.ok(rocks.length>20);
 for(const rock of rocks)assert.ok(distanceToSettlementPath(rock.x,rock.z)>=rock.radius+.7,'the full road ribbon stays clear of every rendered source boulder bound');
 const build=buildAutumnSettlement({state,quality:'quest'});assert.equal(build.colliders.length,AUTUMN_SETTLEMENT_BUILDINGS.length+rocks.length,'all rendered shore footprints participate in actual scene collisions');
});

test('fortified manor retains upper plaster and actual front standards without obstructing its roads',()=>{
 const build=buildAutumnSettlement({state,quality:'quest'}),hall=AUTUMN_SETTLEMENT_BUILDINGS.find(building=>building.landmark==='banner-hall')!,baseY=settlementHeight(hall.x,hall.z),plaster=build.meshes.find(mesh=>mesh.landmark==='banner-hall'&&mesh.material==='settlement-plaster');
 assert.ok(plaster);for(let i=1;i<plaster.positions.length;i+=3)assert.ok(plaster.positions[i]-baseY>=2.49,'plaster begins above the fortified ground storey');
 const mounts=settlementBlueprint(state.nationId).slots.bannerMounts;assert.deepEqual(mounts.map(mount=>[mount.id,mount.kind,mount.heraldry,mount.minHallTier]),[['player-hall','standard','player',0],['crown-hall','standard','crown',0]]);
 const cloth=build.meshes.filter(mesh=>mesh.part==='heraldry'&&mesh.material==='cloth-heraldry');assert.equal(cloth.length,1,'both real crests share the existing cloth material bucket');
 const playerUV=atlasUv('player','banner'),crownUV=atlasUv('crown','banner');let player=0,crown=0;
 for(const mesh of cloth){assert.equal(mesh.motion?.kind,'cloth');for(let i=0;i<mesh.uvs.length;i+=2){const u=mesh.uvs[i],v=mesh.uvs[i+1],isPlayer=u>=playerUV[0]-1e-6&&u<=playerUV[2]+1e-6,isCrown=u>=crownUV[0]-1e-6&&u<=crownUV[2]+1e-6;assert.ok(isPlayer||isCrown,'cloth reads the correct live heraldry atlas column');assert.ok(v>=playerUV[1]-1e-6&&v<=playerUV[3]+1e-6);if(isPlayer)player++;else crown++;}
  for(let i=0;i<mesh.positions.length;i+=3){const x=mesh.positions[i],z=mesh.positions[i+2],dx=x-hall.x,dz=z-hall.z,c=Math.cos(hall.yaw),s=Math.sin(hall.yaw),localX=c*dx-s*dz,localZ=s*dx+c*dz;assert.ok(Math.abs(localX)<10.5&&Math.abs(localZ)+.16<7.5,'actual cloth plus wind reserve remains inside the protected hall plot');assert.ok(localZ>6.3,'standards are in front of the wall');assert.ok(distanceToSettlementPath(x,z)>.65,'standards retain complete road clearance');}
 }
 assert.equal(player,35);assert.equal(crown,35);
});

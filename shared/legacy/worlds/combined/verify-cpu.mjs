/** CPU geometry/material ownership verification, not shader/FPS/headset evidence.
 * Run with tsx import + golden-temple/cpu-loader.mjs namespace resolver. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import * as THREE from '../../../../main game/node_modules/three/build/three.module.js';
import { createCombinedWorldKit } from './kit.ts';
import { buildAutumnSettlement } from '../../environment/settlement/build.ts';
import { settlementHeight,AUTUMN_SETTLEMENT_BUILDINGS } from '../../environment/settlement/layout.ts';
import { environmentFixture } from '../../environment/fixtures.ts';
import { estimateBudget,PLATFORM_BUDGETS } from '../../environment/build/budget.ts';
import { AUTUMN_DEFAULT_PLACEMENTS } from '../../environment/settlement/controller.ts';
import { SETTLEMENT_TOOLS } from '../../settlement/contract.ts';
import { buildSettlementBuilding } from '../../environment/settlement/buildings.ts';

const report={kind:'actual-source-cpu',pixelShaderVerified:false,physicalQuestVerified:false,profiles:[]};
for(const profile of ['desktop','quest']){
 const quality=profile==='quest'?'quest':'desktop-low',state=environmentFixture('founded'),before=JSON.stringify(state),start=performance.now();
 const hostMeshes=[],kit=createCombinedWorldKit({THREE,profile,quality:'low',groundAt:settlementHeight,hostManorObjects:()=>hostMeshes}),camera=new THREE.PerspectiveCamera();camera.position.set(-88,130,118);kit.update(.016,camera);
 assert.equal(AUTUMN_DEFAULT_PLACEMENTS.length,0,'the field-free estate starts without crop plots');
 const scaffold=buildAutumnSettlement({state,quality}),budget=estimateBudget(scaffold),hostScene=new THREE.Group(),hostMaterial=new THREE.MeshBasicMaterial();
 // Build actual BufferGeometry from emitted worker buffers, and put unrelated
 // landmark vertices in the same batch. Only mask1 may enter the physical record.
 const expectedManorBounds=new THREE.Box3();let expectedManorTriangles=0;
 for(const mesh of scaffold.meshes.filter(mesh=>mesh.landmark==='banner-hall'&&mesh.name.endsWith('|banner-hall'))){
  const positions=new Float32Array(mesh.positions.length+9);positions.set(mesh.positions);positions.set([1000,1000,1000,1001,1000,1000,1000,1001,1000],mesh.positions.length);
  const mask=new Uint8Array(positions.length/3);mask.fill(1,0,mesh.positions.length/3);mask.fill(2,mesh.positions.length/3);
  const indices=new Uint32Array(mesh.indices.length+3);indices.set(mesh.indices);indices.set([mesh.positions.length/3,mesh.positions.length/3+1,mesh.positions.length/3+2],mesh.indices.length);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('landmarkId',new THREE.BufferAttribute(mask,1));geometry.setIndex(new THREE.BufferAttribute(indices,1));
  const object=new THREE.Mesh(geometry,hostMaterial);object.name=mesh.name;hostMeshes.push(object);hostScene.add(object);expectedManorTriangles+=mesh.indices.length/3;
  for(let i=0;i<mesh.positions.length;i+=3)expectedManorBounds.expandByPoint(new THREE.Vector3(mesh.positions[i],mesh.positions[i+1],mesh.positions[i+2]));
 }
 assert.equal(hostMeshes.length,5,'actual original manor buffers were converted');
 hostScene.add(kit.root);hostScene.position.set(3,.6,-2);hostScene.scale.setScalar(.0105);hostScene.rotation.y=.2;
 const info=kit.getInfo(),physicalManor=info.fixed.find(node=>node.ownership==='Crownfall'&&node.landmark==='banner-hall');
 assert.ok(physicalManor);assert.equal(physicalManor.triangles,expectedManorTriangles,'mixed landmark triangles are excluded');assert.match(physicalManor.geometryHash,/^fnv1a32:[a-f0-9]{8}$/);assert.equal(physicalManor.sources.length,0);
 for(const name of ['min','max'])for(let i=0;i<3;i++)assert.ok(Math.abs(physicalManor.bounds[name][i]-expectedManorBounds[name].getComponent(i))<1e-6,'tabletop transforms normalize to actual blueprint metre bounds');
 const hallLot=AUTUMN_SETTLEMENT_BUILDINGS.find(b=>b.landmark==='banner-hall'),court=kit.root.children.find(node=>node.userData.sourceCourtyardOf==='banner-hall');
 assert.ok(court,'the real source pavilion is placed in the original manor court');
 assert.equal(court.userData.combinedBuilding.kind,'pavilion');assert.equal(court.userData.landmark,'banner-hall');
 assert.deepEqual([court.userData.combinedBuilding.width,court.userData.combinedBuilding.depth],[4,4]);
 assert.ok(court.userData.sourceProvenance.some(source=>source.repository.endsWith('/golden-temple')));
 assert.equal(kit.root.children.filter(node=>node.userData.combinedBuilding?.id==='banner-hall').length,1,'no second source hall duplicates the original manor');
 const originalHall=buildSettlementBuilding(hallLot),manorMeshes=originalHall.map(expected=>{const mesh=scaffold.meshes.find(mesh=>mesh.name===expected.name);assert.ok(mesh,'original manor mesh '+expected.name);assert.deepEqual(mesh.positions,expected.positions,'the worker reproduces the approved Crownfall compound-manor geometry');assert.equal(mesh.landmark,'banner-hall');return mesh;});
 assert.deepEqual(scaffold.landmarks.map(mark=>mark.id).sort(),['banner-hall','heralds-station','muster-grounds','war-record']);
 const hallMatrix=new THREE.Matrix4().compose(new THREE.Vector3(hallLot.x,settlementHeight(hallLot.x,hallLot.z),hallLot.z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),hallLot.yaw),new THREE.Vector3(1,1,1)),hallInverse=hallMatrix.clone().invert(),sourceInverse=kit.root.matrixWorld.clone().invert(),courtBounds=new THREE.Box3(),point=new THREE.Vector3();
 court.updateWorldMatrix(true,true);court.traverse(object=>{if(!object.isMesh)return;const position=object.geometry.attributes.position;for(let i=0;i<position.count;i++)courtBounds.expandByPoint(point.fromBufferAttribute(position,i).applyMatrix4(object.matrixWorld).applyMatrix4(sourceInverse).applyMatrix4(hallInverse));});
 assert.ok(courtBounds.min.x>3.4&&courtBounds.max.x<hallLot.width/2,'the full shelter clears the original main mass and remains inside the right lot edge');
 assert.ok(courtBounds.min.z>2.1&&courtBounds.max.z<hallLot.depth/2,'the full shelter clears the lower wing and remains inside the front lot edge');
 assert.ok(courtBounds.max.y<4.5,'court shelter stays below4.5m relative to the manor ground datum');
 let checkedManorTriangles=0;
 for(const mesh of manorMeshes)for(let i=0;i<mesh.indices.length;i+=3){const triangle=new THREE.Box3();for(let j=0;j<3;j++){const v=mesh.indices[i+j];triangle.expandByPoint(point.set(mesh.positions[v*3],mesh.positions[v*3+1],mesh.positions[v*3+2]).applyMatrix4(hallInverse));}if(triangle.max.y<=1.2)continue;checkedManorTriangles++;assert.equal(triangle.intersectsBox(courtBounds),false,'the real shelter does not intersect an original manor wall or roof');}
 assert.ok(checkedManorTriangles>100,'clearance was checked against actual emitted manor geometry');
 const manorProof={originalWorkerMeshes:manorMeshes.length,originalWorkerTriangles:manorMeshes.reduce((n,mesh)=>n+mesh.indices.length/3,0),physicalMaskedRecord:physicalManor,checkedWallRoofTriangles:checkedManorTriangles,courtBounds:{min:courtBounds.min.toArray(),max:courtBounds.max.toArray()},semanticLandmarks:scaffold.landmarks.length,sourceCourtLandmark:court.userData.landmark};
 const actualSources=new Set(info.components.map(c=>c.source));
 for(const name of ['golden-temple','monolithwilds','athenaion'])assert.ok(actualSources.has('https://github.com/Leonxlnx/'+name),'actual '+name+' source executes in the same root');
 assert.equal(info.alpineIncluded,false);assert.equal(info.sources.alpine.status,'not-included');assert.equal(info.sources.alpine.publicationBlocked,true);assert.equal(info.waterIncluded,true);assert.equal(info.alpine.permissionRecordPending,false);assert.equal(info.alpine.usesUpstreamAlpineCode,false,'public water must not execute restricted Alpine code');
 let attributeCount=0;
 kit.root.traverse(object=>{
  if(!object.isMesh)return;assert.ok(object instanceof THREE.Mesh,'objects use consumer namespace');
  const geometry=object.geometry;for(const attribute of Object.values(geometry.attributes)){assert.ok(Array.from(attribute.array).every(Number.isFinite));attributeCount++;}
  assert.ok(Array.from(geometry.index?.array??[]).every(i=>i<geometry.attributes.position.count));
  if(object.name.includes('Athenaion source plaster'))assert.ok(geometry.attributes.aFac&&geometry.attributes.aSty,'source facade payload survives');
  if(object.name.includes('edge forest'))assert.ok(geometry.attributes.aVeg&&geometry.attributes.aVeg2&&geometry.attributes.aInstA&&geometry.attributes.aInstB,'source wind/instancing payload survives');
  let ancestor=object,source=null;while(ancestor&&!source){source=ancestor.userData.sourceAsset??ancestor.userData.sourceProvenance?.[0];ancestor=ancestor.parent;}if(source?.repository?.includes('golden-temple')){const normal=geometry.attributes.normal;for(let i=0;i<normal.count;i++)assert.ok(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i))>.5,'source Temple LOD never uploads zero-length normal frames');}
 });
 assert.ok(attributeCount>50);
 for(const building of AUTUMN_SETTLEMENT_BUILDINGS.filter(b=>b.landmark!=='war-record')){
  const node=kit.root.children.find(n=>n.userData.combinedBuilding?.id===building.id);assert.ok(node,'fixed source building '+building.id);
  const local=node.userData.sourceGeometryBatched?new THREE.Box3(new THREE.Vector3(...node.userData.sourceLocalBounds.min),new THREE.Vector3(...node.userData.sourceLocalBounds.max)):new THREE.Box3();if(!node.userData.sourceGeometryBatched)node.traverse(o=>{if(o.isMesh){o.geometry.computeBoundingBox();local.union(o.geometry.boundingBox);}});
  assert.ok(local.min.x>=-building.width/2-.001&&local.max.x<=building.width/2+.001,'source roof stays in protected width');assert.ok(local.min.z>=-building.depth/2-.001&&local.max.z<=building.depth/2+.001,'source roof stays in protected depth');
 }
 const fixedBefore=JSON.stringify(kit.getInfo().fixed),dynamic=[];
 for(const kind of ['cottage','storehouse','pavilion','ruin-arch']){
  const {width,depth}=SETTLEMENT_TOOLS.find(tool=>tool.id===kind),spec={id:'estate-'+kind+'-4-7',kind,width,depth},a=kit.buildBuilding(spec),b=kit.buildBuilding(spec);
  assert.equal(a.parent,null);assert.equal(b.parent,null);assert.ok(a.userData.sourceAssetId);assert.ok(a.userData.sourceProvenance.length);
  const aa=[],bb=[];a.traverse(o=>{if(o.isMesh)aa.push(o);});b.traverse(o=>{if(o.isMesh)bb.push(o);});assert.ok(aa.length);assert.equal(aa.length,bb.length);
  for(let i=0;i<aa.length;i++){assert.notEqual(aa[i].geometry,bb[i].geometry,'caller owns each geometry');assert.equal(aa[i].material,bb[i].material,'source materials are cached');assert.deepEqual(aa[i].geometry.attributes.position.array,bb[i].geometry.attributes.position.array,'preview and commit source recipe is deterministic');}
  const bounds=new THREE.Box3().setFromObject(a);assert.ok(bounds.min.x>=-width/2-.001&&bounds.max.x<=width/2+.001);assert.ok(bounds.min.z>=-depth/2-.001&&bounds.max.z<=depth/2+.001);
  if(kind==='pavilion')assert.ok(aa.reduce((n,o)=>n+(o.geometry.index?.count??o.geometry.attributes.position.count)/3,0)<=24000,'normal-safe source pavilion stays within the canonical24k placement allowance');
  dynamic.push({kind,assetId:a.userData.sourceAssetId,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},triangles:aa.reduce((n,o)=>n+(o.geometry.index?.count??o.geometry.attributes.position.count)/3,0)});
  for(const group of [a,b])group.traverse(o=>o.geometry?.dispose());
 }
 assert.equal(JSON.stringify(kit.getInfo().fixed),fixedBefore,'adding/removing source placeables cannot alter fixed world');
 assert.equal(JSON.stringify(state),before,'source scene does not mutate house presentation');
 const totalTriangles=budget.triangles+info.triangles,totalDraws=budget.drawCalls+info.drawCalls;
 assert.ok(totalTriangles<=PLATFORM_BUDGETS[quality].triangles,`${profile} combined triangles ${totalTriangles} exceed documented budget`);
 assert.ok(totalDraws<=PLATFORM_BUDGETS[quality].drawCalls,`${profile} combined draws ${totalDraws} exceed documented budget`);
 const recognised=environmentFixture('recognised'),fullState={...recognised,hallTier:3,levy:Array.from({length:8},(_,i)=>({memberId:'capacity-'+i,name:'Development capacity fixture',status:'available'})),honours:Array.from({length:6},(_,i)=>({...recognised.honours[0],id:'capacity-honour-'+i})),matchMarkers:Array.from({length:8},(_,i)=>({...recognised.matchMarkers[0],matchId:'capacity-match-'+i})),unreadNotices:4};
 const capacity=estimateBudget(buildAutumnSettlement({state:fullState,quality})),reservedTriangles=capacity.triangles+info.triangles+80000+24000,reservedDraws=capacity.drawCalls+info.drawCalls+40+9+3;
 assert.ok(reservedTriangles<=PLATFORM_BUDGETS[quality].triangles,`${profile} maximum static slots plus estate/ghost reserve ${reservedTriangles} exceed documented budget`);
 assert.ok(reservedDraws<=PLATFORM_BUDGETS[quality].drawCalls,`${profile} maximum static slots plus estate/ghost reserve ${reservedDraws} exceed documented draw budget`);
 kit.setReducedMotion(true);kit.update(.1,camera);kit.setReducedMotion(false);kit.update(.016,camera);
 report.profiles.push({profile,cpuMs:Math.round(performance.now()-start),sourceTriangles:info.triangles,sourceDraws:info.drawCalls,scaffold:budget,totalTriangles,totalDraws,capacityScaffold:capacity,reservedTriangles,reservedDraws,components:info.components,manorProof,dynamic});
 kit.dispose();kit.dispose();for(const mesh of hostMeshes)mesh.geometry.dispose();hostMaterial.dispose();
}
if(process.env.CROWNFALL_COMBINED_REPORT)await writeFile(process.env.CROWNFALL_COMBINED_REPORT,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));

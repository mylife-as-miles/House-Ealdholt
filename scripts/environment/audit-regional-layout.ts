import {createRegionalProjectedGround} from '../../shared/legacy/aethelgard/environment/regional-projected-ground';
import {createEaldholtRiverMargin} from '../../main game/src/legacy/aethelgard/river-margin';
import {createEaldholtWoodlandUnderstory} from '../../main game/src/legacy/aethelgard/woodland-understory';
import assert from 'node:assert/strict';
// @ts-expect-error The CPU audit explicitly selects Desktop's runtime, not the Native Three alias.
import * as auditThree from '../../main game/node_modules/three/build/three.module.js';
const {Box3,Frustum,InstancedMesh,Matrix4,Mesh,PerspectiveCamera,Quaternion,Vector3}=auditThree as typeof import('three');
import {scannedShrubCohortSource,SCANNED_SHRUB_MEASURED} from '../../shared/legacy/aethelgard/environment/scanned-shrub-assets';
import {naturalRiparianSource}from'../../shared/legacy/aethelgard/environment/natural-riparian-policy';
import {auditNaturalRiparian}from'./audit-natural-riparian.mjs';
// Read real model geometry without textures or rendering a stand-in scene.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
// @ts-expect-error This source-only import selects the matching Desktop loader.
import {GLTFLoader as AuditGLTFLoader} from '../../main game/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
const GLTFLoader=AuditGLTFLoader as typeof import('three/examples/jsm/loaders/GLTFLoader.js').GLTFLoader;
import {createEaldholtRiverValley} from '../../main game/src/legacy/aethelgard/river-valley';
import {createEaldholtRiverWoodland} from '../../main game/src/legacy/aethelgard/river-woodland';
import {createEaldholtFarSurround,createEaldholtFarSurroundBridge} from '../../main game/src/legacy/aethelgard/far-surround';
import {createEaldholtBankLandform} from '../../main game/src/legacy/aethelgard/bank-landform';
import {createEaldholtCoastalContinuity} from '../../main game/src/legacy/aethelgard/coastal-continuity';
import {createEaldholtOuterContinuation} from '../../main game/src/legacy/aethelgard/outer-continuation';
import {collectEaldholtWoodlandSurfaces} from '../../main game/src/legacy/aethelgard/far-woodland';
import {collectRegionalVillageSource} from '../../main game/src/legacy/aethelgard/regional-village-source';
import {readAuthoredVegetationGeometry} from '../../main game/src/legacy/aethelgard/vegetation-cell-hlod';
import {createEaldholtWoodlandSupportIndex} from '../../shared/legacy/aethelgard/environment/far-woodland';
import {createRegionalWorldLayout,regionalVillageEdgeDistance} from '../../shared/legacy/aethelgard/environment/regional-world-layout';
import type {RegionalWorldLayout} from '../../shared/legacy/aethelgard/environment/regional-world-layout';
import {EALDHOLT_REGIONAL_WORLD as worldPolicy} from '../../shared/legacy/aethelgard/environment/regional-world-policy';
import {REGIONAL_RIPARIAN_GROUNDCOVER as grassPolicy} from '../../shared/legacy/aethelgard/environment/regional-groundcover-policy';
import {createEaldholtRegionalHorizon} from '../../shared/legacy/aethelgard/environment/regional-horizon';
import {REGIONAL_VEGETATION_PROTOTYPES as prototypes} from '../../shared/legacy/aethelgard/environment/regional-assets';
const input=resolve(process.argv[2]),output=process.argv[3],profile=process.argv[4]==='high'?'desktop':'quest',scanned=process.argv.includes('--scanned-undergrowth'),nativeWorld=process.argv.includes('--native-world'),localProfile=nativeWorld?'quest':'desktop';
const bytes=await readFile(input),jsonLength=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+jsonLength).toString()),binary=bytes.subarray(28+jsonLength);
if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(8)!==bytes.length)throw Error('Invalid source GLB.');
json.images=[];json.textures=[];for(const material of json.materials??[]){for(const key of ['normalTexture','occlusionTexture','emissiveTexture'])delete material[key];if(material.pbrMetallicRoughness){delete material.pbrMetallicRoughness.baseColorTexture;delete material.pbrMetallicRoughness.metallicRoughnessTexture;}delete material.extensions;}
// Keep material kind/alpha/side while dropping only image references; the
// borrowed grass family qualifier must see the same PBR source family.
const raw=Buffer.from(JSON.stringify(json)),padded=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),glb=Buffer.alloc(28+padded.length+binary.length);
glb.writeUInt32LE(0x46546c67,0);glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(padded.length,12);glb.writeUInt32LE(0x4e4f534a,16);padded.copy(glb,20);
glb.writeUInt32LE(binary.length,20+padded.length);glb.writeUInt32LE(0x004e4942,24+padded.length);binary.copy(glb,28+padded.length);
const root=(await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'')).scene;
root.updateWorldMatrix(true,true);const authoredTransformHash=createHash('sha256');root.traverse(node=>{
 authoredTransformHash.update(node.name);authoredTransformHash.update(Float64Array.from(node.matrixWorld.elements));
 if(node instanceof InstancedMesh)authoredTransformHash.update(node.instanceMatrix.array);
});const sourceAuthoredTransformsSha256=authoredTransformHash.digest('hex');
const valley=createEaldholtRiverValley(root,undefined,{profile:localProfile});root.add(valley.object);
const bank=createEaldholtBankLandform(root,valley.object,null,{profile:localProfile});
const continuity=createEaldholtCoastalContinuity(root,valley.object,bank,{profile:localProfile});
const outer=createEaldholtOuterContinuation(root,valley.object,{profile:localProfile});valley.object.add(outer.object);
// Match the actual village composition: original local woodland belongs to
// completeLocalBounds before the far surround measures its owned coverage.
const woodland=createEaldholtRiverWoodland(root,valley.object,{profile:localProfile});root.add(woodland.object);
if(nativeWorld){root.add(createEaldholtRiverMargin(root,valley.object,undefined,{profile:'quest'}).object);root.add(createEaldholtWoodlandUnderstory(root,valley.object,{profile:'quest',woodlandPlacements:woodland.placements??[],canopyRadius:woodland.canopyRadius??0}).object);}
const far=nativeWorld?createEaldholtFarSurroundBridge(root,valley.object,{profile:'quest'}):createEaldholtFarSurround(root,valley.object,{profile:'desktop',layeredMainland:true,coverage:{farDistance:11000}});root.add(far.object);
const geography=far.projectionPacket.geography,horizon=createEaldholtRegionalHorizon(geography,profile);
const villageSource=collectRegionalVillageSource(root);
const preparationStarted=performance.now();
const worldLand=[...(nativeWorld?[createRegionalProjectedGround(geography)]:collectEaldholtWoodlandSurfaces(root,[valley.object,far.object],'terrain')),{positions:horizon.positions,indices:horizon.indices}];
const natural=process.argv.includes('--natural-riparian');
const layout=createRegionalWorldLayout({naturalRiparianSource:natural?naturalRiparianSource(nativeWorld):undefined,scannedShrubSource:scanned?scannedShrubCohortSource(nativeWorld):undefined,geography,prototypes,...villageSource,land:worldLand});
const layoutPreparationMs=performance.now()-preparationStarted;
const domain={minX:geography.sourceEnvelope.minX-450,maxX:geography.sourceEnvelope.maxX+worldPolicy.forestExtent.east,minZ:geography.sourceEnvelope.minZ-worldPolicy.forestExtent.north,maxZ:geography.sourceEnvelope.maxZ+worldPolicy.forestExtent.south};
const actualGrassSupport=createEaldholtWoodlandSupportIndex(worldLand,domain),grassSource=villageSource.groundcoverSource;
const grassFamilies=(grassSource?.families??[]).map(name=>{
 let geometry:ReturnType<typeof readAuthoredVegetationGeometry>|undefined;
 root.traverse(node=>{if(!geometry&&node instanceof Mesh&&node.name===name)geometry=readAuthoredVegetationGeometry(node);});
 assert.ok(geometry,'Measured source family must resolve to the actual borrowed geometry.');
 const p=geometry.getAttribute('position'),vertices:number[][]=[];let minimumY=Infinity,maximumY=-Infinity;
 for(let i=0;i<p.count;i++){vertices.push([p.getX(i),p.getY(i),p.getZ(i)]);minimumY=Math.min(minimumY,p.getY(i));maximumY=Math.max(maximumY,p.getY(i));}
 return{name,vertices,minimumY,height:maximumY-minimumY,geometrySha256:createHash('sha256').update(Float64Array.from(vertices.flat())).digest('hex')};
});
function inspectRiparian(view:RegionalWorldLayout){
 const p=view.groundcover!,count=view.groundcoverRiparian??0,rows:{id:number;scale:number;standingHeight:number;supportBurialSpan:number;conservativeExposedHeight:number;actualMaximumVertexHeightAboveGround:number;footprintRadius:number;windEnvelope:number}[]=[];
 for(let at=p.length-count*6;at<p.length;at+=6){
  const x=p[at],y=p[at+1],z=p[at+2],yaw=p[at+3],scale=p[at+4],f=grassFamilies[p[at+5]%grassFamilies.length];assert.ok(f&&grassSource);
  const radius=grassSource.radius*scale,support=actualGrassSupport.groundcoverFootprint(x,z,radius+.001);
  assert.ok(support,'Every accepted Float32 placement must retain complete actual-triangle support.');
  let maximumAboveGround=-Infinity;for(const [vx,vy,vz]of f.vertices){
   const px=x+scale*(vx*Math.cos(yaw)+vz*Math.sin(yaw)),pz=z+scale*(-vx*Math.sin(yaw)+vz*Math.cos(yaw)),ground=actualGrassSupport.sample(px,pz);
   assert.ok(ground,'Every source vertex must remain on the actual supporting land.');
   maximumAboveGround=Math.max(maximumAboveGround,y+.004+(vy-f.minimumY)*scale-ground.height);
  }
  rows.push({id:at/6,scale,standingHeight:f.height*scale,supportBurialSpan:support.maximumHeight-support.minimumHeight,
   conservativeExposedHeight:f.height*scale-(support.maximumHeight-support.minimumHeight),actualMaximumVertexHeightAboveGround:maximumAboveGround,
   footprintRadius:radius,windEnvelope:radius+.11*grassSource.maximumHeight*scale});
 }
 const range=(field:keyof typeof rows[number],subset=rows)=>subset.length?{minimum:Math.min(...subset.map(row=>row[field])),maximum:Math.max(...subset.map(row=>row[field]))}:null;
 const readable=rows.filter(row=>row.conservativeExposedHeight>=grassPolicy.minimumExposedHeightMetres-1e-5&&row.actualMaximumVertexHeightAboveGround<=grassPolicy.maximumExposedHeightMetres+1e-5);
 return{count,families:grassFamilies.map(({name,height,geometrySha256})=>({name,height,geometrySha256})),scale:range('scale'),standingHeightMetres:range('standingHeight'),
  supportBurialSpanMetres:range('supportBurialSpan'),conservativeExposedHeightMetres:range('conservativeExposedHeight'),
  actualMaximumVertexHeightAboveGroundMetres:range('actualMaximumVertexHeightAboveGround'),footprintRadiusMetres:range('footprintRadius'),windEnvelopeMetres:range('windEnvelope'),
  projectedGroundAreaSquareMetres:rows.reduce((sum,row)=>sum+Math.PI*row.footprintRadius**2,0),
  readableLayer:{count:readable.length,conservativeExposedHeightMetres:range('conservativeExposedHeight',readable),actualMaximumVertexHeightAboveGroundMetres:range('actualMaximumVertexHeightAboveGround',readable)},
  interpretation:'CPU source/actual-terrain qualification; summed disk areas overlap and do not prove visible coverage, rendered frames or navigation.',rows};
}
const riparianPhysicalAudit=inspectRiparian(layout),baselineAt=process.argv.indexOf('--baseline-layout');let riparianComparison:unknown;
if(baselineAt>=0){
 assert.ok(process.argv[baselineAt+1],'--baseline-layout requires the independent previous generator module.');
 const previous=await import(pathToFileURL(resolve(process.argv[baselineAt+1])).href),baseline:RegionalWorldLayout=previous.createRegionalWorldLayout({geography,prototypes,...villageSource,land:worldLand});
 for(const key of ['version','treeCount','shrubCount','placements','rocks','cells','landmarks','species','attempts','rejected']as const)assert.deepEqual(layout[key],baseline[key],key+' must remain unchanged.');
 assert.equal(layout.groundcover!.length,baseline.groundcover!.length);
 assert.equal(layout.groundcoverRiparian,baseline.groundcoverRiparian,'Every existing qualified bank patch must be retained.');
 const selected=Math.max(layout.groundcoverRiparian??0,baseline.groundcoverRiparian??0),prefix=layout.groundcover!.length-selected*6;
 assert.ok(selected<=Math.floor(layout.groundcover!.length/6*grassPolicy.maximumFraction));
 assert.deepEqual(layout.groundcover!.subarray(0,prefix),baseline.groundcover!.subarray(0,prefix),'All unselected grass rows must remain byte-identical.');
 const changedRows:number[]=[];for(let at=0;at<layout.groundcover!.length;at+=6){
  const current=layout.groundcover!,old=baseline.groundcover!;
  for(const lane of [0,2,3,5])assert.equal(current[at+lane],old[at+lane],'Every grass position/yaw/family must remain unchanged.');
  if(current[at+1]!==old[at+1]||current[at+4]!==old[at+4]){assert.ok(at>=prefix&&current[at+4]>old[at+4]);changedRows.push(at/6);}
 }
 assert.equal(changedRows.length,layout.groundcoverDiagnostics?.heightQualification?.enlarged??0);
 const hash=(buffer:Float32Array)=>createHash('sha256').update(buffer).digest('hex');
 riparianComparison={independentBaselineModule:resolve(process.argv[baselineAt+1]),baselineVersion:baseline.groundcoverVersion,baseline:inspectRiparian(baseline),
  baselineGrassSha256:hash(baseline.groundcover!),currentGrassSha256:hash(layout.groundcover!),preservedUnselectedRows:layout.groundcover!.length/6-changedRows.length,preservedPrefixRows:prefix/6,changedRows,
  unchangedSourceAuthoredTransformsSha256:sourceAuthoredTransformsSha256,unchangedTreeShrubSha256:hash(layout.placements),unchangedRockSha256:hash(layout.rocks)};
}
const s=geography.sourceEnvelope,cx=(s.minX+s.maxX)/2,cz=(s.minZ+s.maxZ)/2;
const bands=[250,500,1000,2000].map(radius=>{let trees=0,shrubs=0;for(let at=0;at<layout.placements.length;at+=6)if(Math.hypot(layout.placements[at]-cx,layout.placements[at+2]-cz)<=radius){if(layout.placements[at+5]<12)trees++;else shrubs++;}return{radius,trees,shrubs};});
const edgeBands=[12,20,40,60,100].map(distance=>{let trees=0,shrubs=0;for(let at=0;at<layout.placements.length;at+=6)if(regionalVillageEdgeDistance(villageSource.village??s,layout.placements[at],layout.placements[at+2])<=distance){if(layout.placements[at+5]<12)trees++;else shrubs++;}let rocks=0,grass=0;for(let at=0;at<layout.rocks.length;at+=6)if(regionalVillageEdgeDistance(villageSource.village??s,layout.rocks[at],layout.rocks[at+2])<=distance)rocks++;for(let at=0;at<(layout.groundcover?.length??0);at+=6)if(regionalVillageEdgeDistance(villageSource.village??s,layout.groundcover![at],layout.groundcover![at+2])<=distance)grass++;return{distanceFromVillageBoundary:distance,trees,shrubs,rocks,grass};});
const riparianBounds={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};for(let at=layout.groundcover!.length-(layout.groundcoverRiparian??0)*6;at<layout.groundcover!.length;at+=6){riparianBounds.minX=Math.min(riparianBounds.minX,layout.groundcover![at]);riparianBounds.maxX=Math.max(riparianBounds.maxX,layout.groundcover![at]);riparianBounds.minZ=Math.min(riparianBounds.minZ,layout.groundcover![at+2]);riparianBounds.maxZ=Math.max(riparianBounds.maxZ,layout.groundcover![at+2]);}
const observer=valley.viewpoint.position;const observerCamera=new PerspectiveCamera(valley.viewpoint.fov,1.6,.1,11000);observerCamera.position.fromArray(observer);observerCamera.lookAt(new Vector3(...valley.viewpoint.target));observerCamera.updateMatrixWorld();const frustum=new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(observerCamera.projectionMatrix,observerCamera.matrixWorldInverse));const measured=scannedShrubCohortSource(nativeWorld),normalisedBounds=new Box3(new Vector3(...SCANNED_SHRUB_MEASURED.min),new Vector3(...SCANNED_SHRUB_MEASURED.max)).translate(new Vector3(0,measured.contact.baseY-SCANNED_SHRUB_MEASURED.min[1],0));const eligible=Array.from(layout.scannedShrubs?.ids??[]).map(id=>{const at=id*6,p=layout.placements;const matrix=new Matrix4().compose(new Vector3(p[at],p[at+1],p[at+2]),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),p[at+3]),new Vector3().setScalar(p[at+4]));const box=normalisedBounds.clone().applyMatrix4(matrix).expandByScalar(measured.windReach*p[at+4]);return{id,yaw:p[at+3],inRiversideFrustum:frustum.intersectsBox(box),position:Array.from(p.subarray(at,at+3)),scale:p[at+4],villageEdgeDistance:regionalVillageEdgeDistance(villageSource.village??s,p[at],p[at+2]),riversideEyeDistance:Math.hypot(p[at]-observer[0],p[at+1]-observer[1],p[at+2]-observer[2])};});
let baselinePreserved: boolean|undefined;if(scanned&&process.argv.includes('--compare-baseline')){const baseline=createRegionalWorldLayout({naturalRiparianSource:natural?naturalRiparianSource(nativeWorld):undefined,geography,prototypes,...villageSource,land:worldLand});assert.deepEqual({...layout,scannedShrubs:undefined},baseline);baselinePreserved=true;}
const naturalAudit=natural?await auditNaturalRiparian({layout,baseline:createRegionalWorldLayout({scannedShrubSource:scanned?scannedShrubCohortSource(nativeWorld):undefined,geography,prototypes,...villageSource,land:worldLand}),native:nativeWorld,support:actualGrassSupport,observer:Array.from(observer),frustum}):undefined;
const report={naturalRiparian:naturalAudit,nativeWorld,riparianPhysicalAudit,riparianComparison,sourceAuthoredTransformsSha256,scannedShrubs:scanned?{...layout.scannedShrubs,ids:eligible,baselinePreserved,frustumEligible:eligible.filter(p=>p.inRiversideFrustum).length,nearFrustum:eligible.filter(p=>p.inRiversideFrustum&&p.riversideEyeDistance<100).length,observer:Array.from(observer),observerKind:'existing source-space Riverside inspection view',nearestToRiverside:[...eligible].sort((a,b)=>a.riversideEyeDistance-b.riversideEyeDistance).slice(0,16),nearVillage:[10,20,40,60,100,180].map(distance=>({distance,count:eligible.filter(row=>row.villageEdgeDistance<=distance).length}))}:undefined,preparation:{order:['source','river-valley','bank-landform','coastal-continuity','outer-continuation','original-river-woodland','far-surround','regional-horizon','regional-layout'],localWoodlandFamily:woodland.sourceFamily,localWoodlandActors:woodland.placements?.length??0,farLocalBounds:far.localBounds},villageFootprint:villageSource.village,edgeBands,source:basename(input),layoutPreparationMs,sourceSha256:createHash('sha256').update(bytes).digest('hex'),profile,version:layout.version,groundcoverVersion:layout.groundcoverVersion,riparianGrass:layout.groundcoverRiparian,groundcoverDiagnostics:layout.groundcoverDiagnostics,riparianBounds:layout.groundcoverRiparian?riparianBounds:null,groundcoverSource:villageSource.groundcoverSource,sourceEnvelope:s,trees:layout.treeCount,shrubs:layout.shrubCount,grass:layout.groundcover!.length/6,cells:layout.cells.length,bands,landmarks:layout.landmarks,attempts:layout.attempts,rejected:layout.rejected,placementsSha256:createHash('sha256').update(layout.placements).digest('hex'),rocksSha256:createHash('sha256').update(layout.rocks).digest('hex'),groundcoverSha256:createHash('sha256').update(layout.groundcover!).digest('hex')};
if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
far.dispose();woodland.dispose();valley.dispose();

// @ts-nocheck
/** Private, CPU-only verification against unchanged released GLBs. No renderer,
 * screenshots, decoded images, saved worlds or generated model files. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRegionalWorldLayout} from '../../shared/legacy/aethelgard/environment/regional-world-layout.ts';
import {createEaldholtRegionalHorizon} from '../../shared/legacy/aethelgard/environment/regional-horizon.ts';
import {createRegionalProjectedGround} from '../../shared/legacy/aethelgard/environment/regional-projected-ground.ts';
import {REGIONAL_VEGETATION_PROTOTYPES as prototypes} from '../../shared/legacy/aethelgard/environment/regional-assets.ts';
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const load=path=>import(pathToFileURL(path).href);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

function cpuBytes(raw){
 const length=raw.readUInt32LE(12),json=JSON.parse(raw.subarray(20,20+length).toString());
 function strip(value){if(!value||typeof value!=='object')return;for(const key of Object.keys(value))if(/Texture$/.test(key))delete value[key];else strip(value[key]);}
 delete json.images;delete json.textures;delete json.samplers;for(const material of json.materials??[])strip(material);
 let bytes=Buffer.from(JSON.stringify(json));bytes=Buffer.concat([bytes,Buffer.alloc((4-bytes.length%4)%4,32)]);const tail=raw.subarray(20+length),copy=Buffer.alloc(20+bytes.length+tail.length);
 raw.copy(copy,0,0,12);copy.writeUInt32LE(copy.length,8);copy.writeUInt32LE(bytes.length,12);copy.writeUInt32LE(0x4e4f534a,16);bytes.copy(copy,20);tail.copy(copy,20+bytes.length);
 return copy.buffer.slice(copy.byteOffset,copy.byteOffset+copy.length);
}

export async function verifyRealisticReleasedSource(file,profile){
 if(!['desktop','quest'].includes(profile))throw Error('Use exact released Desktop or Quest source profile.');
 const app=profile==='quest'?'main-game-vr':'main game',path=relative=>resolve(repository,app,relative);
 const runtime=profile==='quest'?'node_modules/three/build/three.module.js':'node_modules/three/build/three.module.js';
 const [three,{GLTFLoader},sourceAdapter,river,bank,continuity,outer,woodlandAdapter,farAdapter,farWoodland,villageAdapter]=await Promise.all([
  load(path(runtime)),load(path('node_modules/three/examples/jsm/loaders/GLTFLoader.js')),
  ...['realistic-tree-source','river-valley','bank-landform','coastal-continuity','outer-continuation','river-woodland','far-surround','far-woodland','regional-village-source'].map(name=>profile==='quest'&&name==='far-woodland'?Promise.resolve(null):load(path('src/legacy/aethelgard/'+name+'.ts'))),
 ]);
 const bytes=fs.readFileSync(file),sha=digest(bytes);assert.equal(sha,sourceAdapter.REALISTIC_TREE_SOURCES[profile]);
 const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString()),prototype=json.nodes.find(node=>node.extras?.crownfallWoodlandPrototype?.family===sourceAdapter.REALISTIC_TREE_FAMILY);
 if(!prototype&&profile==='quest'){
  const ordinary=json.nodes.find(node=>node.name===sourceAdapter.REALISTIC_TREE_FAMILY);assert.ok(ordinary);const triangles=json.meshes[ordinary.mesh].primitives.reduce((n,p)=>n+json.accessors[p.indices].count/3,0);assert.equal(triangles,525);
  assert.equal(sourceAdapter.borrowRealisticTreeSource({borrowedPrototype:undefined},sha),null);
  return{profile,sourceSha256:sha,status:'held-missing-complete-prototype',sourceFamily:sourceAdapter.REALISTIC_TREE_FAMILY,ordinarySourceTriangles:triangles,requiredCompleteTriangles:9883,reason:'The exact Quest release contains only the original 525-triangle family, with no qualified hidden complete ExteriorPrototype. Existing Native forest visuals and 32 MiB regional derivative budget are retained.',decodedImagePixels:0,renderedVisualVerification:false};
 }
 assert.ok(prototype);const primitives=json.meshes[prototype.mesh].primitives;assert.equal(primitives.length,3);
 for(const primitive of primitives){const m=json.materials[primitive.material];assert.equal(m.alphaMode,'MASK');assert.ok(Math.abs(m.alphaCutoff-.3333)<1e-6);assert.ok(m.pbrMetallicRoughness.baseColorTexture&&m.pbrMetallicRoughness.metallicRoughnessTexture&&m.normalTexture&&m.occlusionTexture&&m.extensions.KHR_materials_specular.specularTexture);assert.ok(primitive.attributes.TANGENT!==undefined&&primitive.attributes.TEXCOORD_2!==undefined);}
 globalThis.self=globalThis;const gltf=await new GLTFLoader().parseAsync(cpuBytes(bytes),''),model=gltf.scene;
 // Source image/UV/PBR-role references were verified above in the raw JSON.
 // Empty CPU texture handles satisfy the adapter's presence guard without
 // decoding or reading a single image pixel. They are never rendered or saved.
 const cpuMaps=new three.DataTexture(),hidden=model.getObjectByName(sourceAdapter.REALISTIC_TREE_FAMILY+'_ExteriorPrototype');
 hidden.traverse(node=>{if(node instanceof three.Mesh){for(const material of Array.isArray(node.material)?node.material:[node.material]){material.map=cpuMaps;material.normalMap=cpuMaps;material.aoMap=cpuMaps;material.roughnessMap=cpuMaps;}}});
 const valley=river.createEaldholtRiverValley(model,undefined,{profile});model.add(valley.object);
 const landform=bank.createEaldholtBankLandform(model,valley.object,null,{profile});
 const coastal=continuity.createEaldholtCoastalContinuity(model,valley.object,landform,{profile});
 const extension=outer.createEaldholtOuterContinuation(model,valley.object,{profile});valley.object.add(extension.object);
 const woodland=woodlandAdapter.createEaldholtRiverWoodland(model,valley.object,{profile});model.add(woodland.object);
 const borrowed=sourceAdapter.borrowRealisticTreeSource(woodland,sha);assert.ok(borrowed,'The complete released family must pass actual source qualification.');
 const source=sourceAdapter.normalizeRealisticTreeSource(borrowed);assert.ok(source,'The complete family must fit existing broadleaf envelopes.');
 const far=profile==='quest'?farAdapter.createEaldholtFarSurroundBridge(model,valley.object,{profile}):farAdapter.createEaldholtFarSurround(model,valley.object,{profile,layeredMainland:true,coverage:{farDistance:11000}});model.add(far.object);
 const geography=far.projectionPacket.geography,geometryProfile='quest',horizon=createEaldholtRegionalHorizon(geography,geometryProfile),village=villageAdapter.collectRegionalVillageSource(model);
 const land=profile==='quest'?[createRegionalProjectedGround(geography),horizon]:[...farWoodland.collectEaldholtWoodlandSurfaces(model,[valley.object,far.object],'terrain'),horizon];
 const input={geography,land,prototypes,...village},baseline=createRegionalWorldLayout(input),qualified=createRegionalWorldLayout({...input,realisticTreeSource:{variant:source.variant,height:source.height,canopyRadius:source.canopyRadius,contact:source.contact,sourceSha256:source.sourceSha256,walkingTriangles:source.walkingTriangles}});
 for(const key of ['placements','rocks','groundcover'])assert.deepEqual(qualified[key],baseline[key],key+' must remain byte-identical');assert.equal(qualified.version,baseline.version);assert.deepEqual(qualified.cells,baseline.cells);assert.deepEqual(qualified.landmarks,baseline.landmarks);
 assert.ok(qualified.realisticTrees.ids.length>0,'A source path with no actual qualified regional actors cannot be reported as working coverage.');
 const report={profile,geometryProfile,sourceSha256:sha,sourceTriangles:source.triangles,rawBounds:[borrowed.bounds.min.toArray(),borrowed.bounds.max.toArray()],rawWoodRadius:borrowed.contact.radius,
  normalizedBounds:[source.bounds.min.toArray(),source.bounds.max.toArray()],normalizedRootRadius:source.contact.radius,walkingTrunkRadius:source.trunkRadius,rootPoints:source.contact.points.length,normalizedHeight:source.height,
  trees:qualified.treeCount,placementsUnchanged:true,placementsSha256:digest(Buffer.from(qualified.placements.buffer)),sourceCohort:{eligible:qualified.realisticTrees.ids.length,examined:qualified.realisticTrees.examined,rejectedRoots:qualified.realisticTrees.rejectedRoot,rejectedWalking:qualified.realisticTrees.rejectedWalking,heldWalkingUncertain:qualified.realisticTrees.heldWalkingUncertain,walkingGuardVersion:qualified.realisticTrees.walkingGuardVersion,firstIds:Array.from(qualified.realisticTrees.ids.subarray(0,8))},rawPbrRolesVerified:true,decodedImagePixels:0,renderedVisualVerification:false};
 far.dispose();woodland.dispose();extension.dispose();coastal.dispose();landform.dispose();valley.dispose();cpuMaps.dispose();return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [profile,file]=process.argv.slice(2);if(!file)throw Error('Usage: tsx scripts/environment/verify-realistic-tree-source.mts desktop|quest PRIVATE_RELEASED_GLB');
 console.log(JSON.stringify(await verifyRealisticReleasedSource(resolve(file),profile),null,2));
}

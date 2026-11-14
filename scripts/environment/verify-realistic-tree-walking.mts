// @ts-nocheck
/** Replay immutable actual inputs. No world regeneration, rendering, image
 * decode, source modifications, saved state or writes to the evidence folder. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as three from '../../main game/node_modules/three/build/three.module.js';
import {GLTFLoader} from '../../main game/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {borrowRealisticTreeSource,normalizeRealisticTreeSource,REALISTIC_TREE_SOURCES} from '../../main game/src/legacy/aethelgard/realistic-tree-source';
import {createEaldholtWoodlandSupportIndex} from '../../shared/legacy/aethelgard/environment/far-woodland';
import {qualifyRealisticTreeCohort} from '../../shared/legacy/aethelgard/environment/realistic-tree-cohort';
import {REGIONAL_ASSET_PATH,REGIONAL_VEGETATION_PROTOTYPES} from '../../shared/legacy/aethelgard/environment/regional-assets';
import {REGIONAL_VEGETATION_PROFILES} from '../../shared/legacy/aethelgard/environment/regional-vegetation-profiles';
const [modelFile,auditFile]=process.argv.slice(2);if(!auditFile)throw Error('Usage: tsx scripts/environment/verify-realistic-tree-walking.mts PRIVATE_RELEASED_GLB PRIVATE_ACTUAL123_AUDIT_JSON');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),auditBytes=fs.readFileSync(auditFile),audit=JSON.parse(auditBytes),directory=path.dirname(path.resolve(auditFile));
assert.equal(sha(auditBytes),'d11d19c893def3551086787e2b276f3346a0e80843aca53d5160ac683549daf6','Use the exact independently checked actual123 audit.');
const raw=fs.readFileSync(modelFile);assert.equal(sha(raw),REALISTIC_TREE_SOURCES.desktop);assert.equal(audit.sourceSha256,sha(raw));
function cpuBytes(bytes){const n=bytes.readUInt32LE(12),j=JSON.parse(bytes.subarray(20,20+n).toString());
 function strip(v){if(!v||typeof v!=='object')return;for(const k of Object.keys(v))if(/Texture$/.test(k))delete v[k];else strip(v[k]);}
 delete j.images;delete j.textures;delete j.samplers;for(const m of j.materials??[])strip(m);
 let text=Buffer.from(JSON.stringify(j));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);const tail=bytes.subarray(20+n),copy=Buffer.alloc(20+text.length+tail.length);bytes.copy(copy,0,0,12);copy.writeUInt32LE(copy.length,8);copy.writeUInt32LE(text.length,12);copy.writeUInt32LE(0x4e4f534a,16);text.copy(copy,20);tail.copy(copy,20+text.length);return copy.buffer.slice(copy.byteOffset,copy.byteOffset+copy.length);
}
globalThis.self=globalThis;const model=(await new GLTFLoader().parseAsync(cpuBytes(raw),'')).scene;model.updateWorldMatrix(true,true);
const hidden=model.getObjectByName(audit.sourceFamily+'_ExteriorPrototype'),parts=[],map=new three.DataTexture();
assert.ok(hidden);hidden.traverse(node=>{if(node instanceof three.InstancedMesh){node.material.map=map;node.material.normalMap=map;node.material.aoMap=map;node.material.roughnessMap=map;parts.push(node);}});assert.equal(parts.length,3);
const instance=new three.Matrix4(),inverse=model.matrixWorld.clone().invert(),primary=parts.find(p=>p.material.side!==three.DoubleSide&&p.geometry.boundingBox.min.y<0);assert.ok(primary);
primary.getMatrixAt(0,instance);const undo=inverse.clone().multiply(primary.matrixWorld).multiply(instance).invert();
const components=parts.map(source=>{source.getMatrixAt(0,instance);return{source,frame:undo.clone().multiply(inverse).multiply(source.matrixWorld).multiply(instance)};});
const borrowed=borrowRealisticTreeSource({borrowedPrototype:{name:hidden.name,components}},sha(raw));assert.ok(borrowed);const source=normalizeRealisticTreeSource(borrowed);assert.ok(source);
const typed={Float32Array,Float64Array,Uint32Array},read=entry=>{assert.equal(path.basename(entry.file),entry.file);const bytes=fs.readFileSync(path.join(directory,entry.file));assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256);const Type=typed[entry.typedArray??(entry.file.endsWith('.f32')?'Float32Array':'Uint32Array')];return new Type(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));};
const placements=read(audit.inputManifest.find(e=>e.file==='actual-placements.f32')),before=sha(Buffer.from(placements.buffer));assert.equal(before,audit.placementSha256);
function surfaces(kind){const list=[];for(const entry of audit.inputManifest.filter(e=>e.kind===kind)){list[entry.surface]??={};list[entry.surface][entry.attribute]=read(entry);}return list;}
const outer=createEaldholtWoodlandSupportIndex(surfaces('outer'),audit.policyDomain),village=createEaldholtWoodlandSupportIndex(surfaces('village'),audit.inputSourceEnvelope),s=audit.inputSourceEnvelope;
const sample=(x,z)=>x>=s.minX&&x<=s.maxX&&z>=s.minZ&&z<=s.maxZ?village.sample(x,z)??outer.sample(x,z):outer.sample(x,z);
const cohort=qualifyRealisticTreeCohort({placements,source,village:audit.inputVillageFootprint,sample,terrain:bounds=>[...outer.projectedTriangles(bounds),...village.projectedTriangles(bounds)]});
const rejected=new Set(audit.summary.nonfoliageViolatingActorIds),expected=audit.cohortIds.filter(id=>!rejected.has(id));assert.deepEqual(Array.from(cohort.ids),expected);assert.equal(cohort.ids.length,27);assert.equal(cohort.rejectedWalking,96);assert.equal(cohort.heldWalkingUncertain,0);assert.equal(cohort.rejectedRoot,6);assert.equal(sha(Buffer.from(placements.buffer)),before);
// The current Low renderer's original family remains installed for every held
// promotion. This validates availability, not a rendered fallback screenshot.
const fallbackFile=new URL('../../main game/public/'+REGIONAL_ASSET_PATH+REGIONAL_VEGETATION_PROFILES.quest.file,import.meta.url),fallbackBytes=fs.readFileSync(fallbackFile);assert.equal(sha(fallbackBytes),REGIONAL_VEGETATION_PROFILES.quest.sha256);
const fallback=JSON.parse(fallbackBytes.subarray(20,20+fallbackBytes.readUInt32LE(12)).toString());for(const p of REGIONAL_VEGETATION_PROTOTYPES)assert.ok(fallback.nodes.some(n=>n.name===p.id));
const oak=fallback.nodes.find(n=>n.name==='tree-oak-2');assert.ok(oak.children.length>=2);for(const id of rejected)assert.equal(placements[id*6+5],2);
console.log(JSON.stringify({sourceSha256:sha(raw),auditSha256:sha(auditBytes),placementSha256:before,placementBuffersUnchanged:true,originalSourceActors:placements.length/6,originalAuditedCohort:123,guardedCohort:cohort.ids.length,retainedIds:Array.from(cohort.ids),rejectedWalking:cohort.rejectedWalking,rejectedRoot:cohort.rejectedRoot,heldWalkingUncertain:cohort.heldWalkingUncertain,walkingGuardVersion:cohort.walkingGuardVersion,walkingProfileTriangles:source.walkingTriangles.length/9,
 fallback:{file:REGIONAL_VEGETATION_PROFILES.quest.file,sha256:sha(fallbackBytes),allOriginalFamiliesPresent:true,matureOakParts:oak.children.length,heldActorOrdinalsPreserved:rejected.size},sourceAssetFilesChanged:false,cpuParsingTextureHandlesOnly:true,worldRegenerated:false,decodedImagePixels:0,renderedVisualVerification:false},null,2));map.dispose();

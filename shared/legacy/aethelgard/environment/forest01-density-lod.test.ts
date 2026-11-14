import {FOREST01_DENSITY_WALKING} from './forest01-density-walking-data';
import assert from 'node:assert/strict';
import test from 'node:test';
import {FOREST01_DENSITY_DATA} from './forest01-density-data';
import {FOREST01_DENSITY_LOD,decode,forest01DensityWoodIndices,selectForest01DensityIndices,validPackedVegetationResult} from './forest01-density-lod';
import {worldBakeDigest} from './world-bake-cache';
import {buildPackedVegetationGeometry} from './vegetation-packed-geometry';
import {qualifyRealisticTreeCohort,type RealisticTreeCohortSource} from './realistic-tree-cohort';
import {REALISTIC_TREE_WALKING_VERSION} from './realistic-tree-walking';

test('fixed index manifests are hash-bound, aligned, bounded and independent of clock or actor position',async()=>{
 const mask=decode(FOREST01_DENSITY_DATA.parts[2].originalTriangleSelection);let faces=0;for(let at=0;at<FOREST01_DENSITY_LOD.sourceLeafTriangles;at++)if(mask[at>>3]&(1<<(at&7)))faces++;
 assert.equal(faces,31845);assert.equal(mask.length,Math.ceil(50471/8));assert.equal(mask[mask.length-1]&128,0,'unused final mask bit cannot request a nonexistent triangle');
 for(const part of[0,1]as const){const indices=forest01DensityWoodIndices(part),data=FOREST01_DENSITY_DATA.parts[part];assert.equal(indices.length,data.triangles*3);assert.ok(indices.every(i=>i<data.sourceVertices));assert.equal(await worldBakeDigest(new Uint8Array(indices.buffer)),data.sourceVertexIndexSha256);}
});

test('density profile rejects wrong source and unknown profile before any additional simplification',async()=>{
 const input={positions:Float32Array.from([0,0,0,1,0,0,0,1,0]),indices:Uint32Array.from([0,1,2]),attributes:new Float32Array(6),stride:2,channels:[{name:'uv',size:2}],ratio:.6,error:.008,foliage:true,attributeWeights:[.2,.2]};let calls=0;
 const simplifier={ready:Promise.resolve(),simplifyWithAttributes(indices:Uint32Array):[Uint32Array,number]{calls++;return[indices,0];}};
 await assert.rejects(()=>selectForest01DensityIndices(input),/Unqualified/);
 await assert.rejects(()=>buildPackedVegetationGeometry({...input,profile:FOREST01_DENSITY_LOD.version},simplifier),/Unqualified/);assert.equal(calls,0);
 await assert.rejects(()=>buildPackedVegetationGeometry({...input,profile:'future' as typeof FOREST01_DENSITY_LOD.version},simplifier),/Unknown/);assert.equal(calls,0);
 const normal=await buildPackedVegetationGeometry(input,simplifier);assert.equal(calls,1);assert.equal(normal.indices.length,3);assert.deepEqual(normal.positions,input.positions);
});

test('worker/cache publication rejects inflated, out-of-source, duplicate-channel and invalid-bound results',()=>{
 const result={positions:Float32Array.from([0,0,0,1,0,0,0,1,0]),indices:Uint32Array.from([0,1,2]),attributes:[{name:'uv',size:2,values:new Float32Array(6)}],bounds:[0,0,0,1,1,0],sourceTriangles:1,error:0};
 assert.equal(validPackedVegetationResult(result,1),true);
 for(const invalid of[{...result,indices:Uint32Array.from([0,1,2,0,1,2])},{...result,indices:Uint32Array.from([0,1,3])},{...result,bounds:[0,0,0,2,1,0]},{...result,attributes:[...result.attributes,...result.attributes]},{...result,sourceTriangles:2},{...result,error:NaN},{...result,attributes:[{name:'uv',size:2,values:new Float32Array(5)}]}])assert.equal(validPackedVegetationResult(invalid,1),false);
});

test('exact reduced-wood proof rejects empty, partial, mutated, stale or wrong-frame bytes without changing primary IDs',()=>{
 const placements=Float32Array.from([120,-.08,50,0,1,1]),before=placements.slice(),sample=()=>({height:0,slope:0}),terrain=()=>[{vertices:[[0,0,0],[200,0,0],[0,0,200]]as const},{vertices:[[200,0,0],[200,0,200],[0,0,200]]as const}],village={minX:0,maxX:100,minZ:0,maxZ:100};
 const source:RealisticTreeCohortSource={walkingTriangles:new Float64Array(),variant:1,height:14.7,canopyRadius:4.4,sourceSha256:FOREST01_DENSITY_LOD.sourceSha256,contact:{baseY:0,radius:.37,points:[[-.3,0,-.2],[.3,0,-.2],[0,0,.37]]}};
 const run=(value:RealisticTreeCohortSource)=>qualifyRealisticTreeCohort({placements,source:value,village,sample,terrain});
 const original=run(source);assert.deepEqual([...original.ids],[0]);assert.equal(original.density,undefined);
 const bytes=decode(FOREST01_DENSITY_WALKING.bytes),proof={version:FOREST01_DENSITY_LOD.version,producer:FOREST01_DENSITY_WALKING.producer,normalization:[...FOREST01_DENSITY_WALKING.normalization],triangles:new Float64Array(bytes.buffer)},mutated=proof.triangles.slice();mutated[0]+=.0001;
 const accepted=run({...source,densityWalking:proof});assert.deepEqual(accepted.density!.ids,original.ids);assert.equal(accepted.density!.walkingGuardVersion,REALISTIC_TREE_WALKING_VERSION);
 for(const bad of[{...proof,triangles:new Float64Array()},{...proof,triangles:proof.triangles.slice(9)},{...proof,triangles:mutated},{...proof,version:'old'},{...proof,producer:'other'},{...proof,normalization:proof.normalization.map((n,i)=>i===13?n+.001:n)}]){const result=run({...source,densityWalking:bad});assert.equal(result.density,undefined);assert.deepEqual(result.ids,original.ids);}
 assert.deepEqual(placements,before);
});

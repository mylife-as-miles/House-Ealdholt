import assert from 'node:assert/strict';
import test from 'node:test';
import {realisticTreeWalkingClearance,type WalkingTerrainTriangle} from './realistic-tree-walking';
import {createEaldholtWoodlandSupportIndex} from './far-woodland';
import {qualifyRealisticTreeCohort,type RealisticTreeCohortSource} from './realistic-tree-cohort';
const terrain:readonly WalkingTerrainTriangle[]=[{vertices:[[-10,0,-10],[10,0,-10],[-10,0,10]]},{vertices:[[10,0,-10],[10,0,10],[-10,0,10]]}];
const base={x:0,y:0,z:0,yaw:0,scale:1,reservedRadius:2,sample:()=>({height:0,slope:0}),terrain:()=>terrain};
const branch=Float64Array.from([2.3,3.8,0,2.5,4,.2,2.3,4.1,-.2]);

test('walking-volume clipping accounts for actual burial, actor scale and source edge intersections',()=>{
 assert.equal(realisticTreeWalkingClearance({...base,triangles:branch}),'clear','unburied scale-one wood above3.5 m remains outside the walking volume');
 assert.equal(realisticTreeWalkingClearance({...base,triangles:branch,y:-.5}),'overflow','burial lowers real wood into the walking volume');
 assert.equal(realisticTreeWalkingClearance({...base,triangles:branch,y:-.08,scale:.9}),'overflow','a smaller actor reaches more source height within the same3.5 m walking interval');
 assert.equal(realisticTreeWalkingClearance({...base,triangles:branch,y:-.08,scale:1.15}),'clear');
 const crossing=Float64Array.from([1,2.5,0,3,3.8,0,3,3.8,.2]);
 assert.equal(realisticTreeWalkingClearance({...base,triangles:crossing}),'overflow','only clipped edge intersections exceed the old radius below3.5 m');
 assert.equal(realisticTreeWalkingClearance({...base,triangles:branch,yaw:Math.PI,y:-.5}),'overflow','yaw does not change a circular reservation');
});

test('the walking interval follows terrain under the branch instead of only a centre-height slab',()=>{
 const slope:readonly WalkingTerrainTriangle[]=[{vertices:[[-10,-2.5,-10],[10,2.5,-10],[-10,-2.5,10]]},{vertices:[[10,2.5,-10],[10,2.5,10],[-10,-2.5,10]]}];
 assert.equal(realisticTreeWalkingClearance({...base,triangles:branch,y:-.2}),'clear');
 assert.equal(realisticTreeWalkingClearance({...base,triangles:branch,y:-.2,terrain:()=>slope,sample:x=>({height:x*.25,slope:.25})}),'overflow');
 assert.equal(realisticTreeWalkingClearance({...base,triangles:branch,y:-.5,terrain:undefined}),'uncertain');
 assert.equal(realisticTreeWalkingClearance({...base,triangles:branch,y:-.5,sample:()=>({height:10,slope:0})}),'uncertain','overlapping/occluded support cannot become a false clearance certificate');
 assert.equal(realisticTreeWalkingClearance({...base,triangles:Float64Array.from([NaN,0,0])}),'uncertain');
});

test('one-time qualification rejects only the unsafe source promotion and preserves every original actor record and fallback ordinal',()=>{
 const surface={positions:Float64Array.from([0,0,0,200,0,0,0,0,100,200,0,100]),indices:Uint32Array.from([0,2,1,1,2,3])},support=createEaldholtWoodlandSupportIndex([surface],{minX:0,maxX:200,minZ:0,maxZ:100});
 const source:RealisticTreeCohortSource={variant:2,height:17.2,canopyRadius:7.4,sourceSha256:'a'.repeat(64),contact:{baseY:0,radius:.47,points:[[-.4,0,-.2],[.4,.03,-.2],[0,.02,.47]]},walkingTriangles:branch};
 const placements=Float32Array.from([120,-.08,50,0,.9,2,140,-.08,50,0,1.15,2]),before=placements.slice(),landBefore=surface.positions.slice();
 const result=qualifyRealisticTreeCohort({placements,source,village:{minX:0,maxX:100,minZ:0,maxZ:100},sample:support.sample,terrain:support.projectedTriangles});
 assert.deepEqual(Array.from(result.ids),[1]);assert.equal(result.rejectedRoot,0);assert.equal(result.rejectedWalking,1);assert.equal(result.heldWalkingUncertain,0);assert.deepEqual(placements,before);assert.deepEqual(surface.positions,landBefore);
 const promoted=new Set(result.ids),fallback=Array.from({length:placements.length/6},(_,id)=>id).filter(id=>!promoted.has(id));assert.deepEqual(fallback,[0]);assert.equal(placements[fallback[0]*6+5],2,'the original mature-oak variant remains available at its unchanged actor transform');
});

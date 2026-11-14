import assert from 'node:assert/strict';
import test from 'node:test';
import {qualifyRealisticTreeCohort,realisticTreeRootFits,REALISTIC_TREE_COHORT_LIMIT,type RealisticTreeCohortSource} from './realistic-tree-cohort';
import {createRegionalWorldLayout} from './regional-world-layout';
import {createEaldholtFarGeography} from './far-surround';
import {createRegionalProjectedGround} from './regional-projected-ground';
import {REGIONAL_VEGETATION_PROTOTYPES as prototypes} from './regional-assets';
import {patchVegetationFade,patchVegetationImpostor} from './vegetation-shaders';
const source:RealisticTreeCohortSource={walkingTriangles:new Float64Array(),variant:2,height:17.2,canopyRadius:7.4,sourceSha256:'a'.repeat(64),contact:{baseY:0,radius:.47,points:[[-.4,0,-.2],[.4,.03,-.2],[0,.02,.47]]}};
const sample=()=>({height:0,slope:0}),village={minX:0,maxX:100,minZ:0,maxZ:100};

test('new roots must fit the existing Y without floating, excessive burial, unsupported feet or a changed protected envelope',()=>{
 const input={x:120,y:-.08,z:50,yaw:.7,scale:1,source,sample};
 assert.equal(realisticTreeRootFits(input),true);
 assert.equal(realisticTreeRootFits({...input,y:0}),false);
 assert.equal(realisticTreeRootFits({...input,y:-1}),false);
 assert.equal(realisticTreeRootFits({...input,sample:(x,z)=>Math.hypot(x-120,z-50)>.3?null:sample()}),false,'centre support alone cannot qualify the complete wood footprint');
 assert.equal(realisticTreeRootFits({...input,sample:()=>({height:0,slope:.73})}),false);
 assert.equal(realisticTreeRootFits({...input,sample:(x)=>({height:x>120?-.2:0,slope:.2})}),false,'a downhill foot cannot be left above the real ground');
 const placements=Float32Array.from([120,-.08,50,.7,1,2]);
 for(const changed of [{...source,height:18},{...source,canopyRadius:10},{...source,contact:{...source.contact,radius:3}},{...source,variant:11}])assert.throws(()=>qualifyRealisticTreeCohort({placements,source:changed as RealisticTreeCohortSource,village,sample}),/envelope/);
});

test('the deterministic small cohort keeps original transforms and rejects conifers, distant actors and failed root support',()=>{
 const values:number[]=[];for(let i=0;i<220;i++)values.push(113+i*.5,-.08,50,Math.fround(i*.01),1,2);
 values.push(114,-.08,48,0,1,11,400,-.08,50,0,1,2,115,-1,50,0,1,2);
 const placements=Float32Array.from(values),before=placements.slice(),a=qualifyRealisticTreeCohort({placements,source,village,sample}),b=qualifyRealisticTreeCohort({placements,source,village,sample});
 assert.equal(a.ids.length,REALISTIC_TREE_COHORT_LIMIT);assert.deepEqual(a,b);assert.deepEqual(placements,before);assert.deepEqual(Array.from(a.ids),Array.from({length:128},(_,i)=>i));
 const rejected=qualifyRealisticTreeCohort({placements:Float32Array.from([120,-1,50,0,1,2]),source,village,sample});assert.equal(rejected.ids.length,0);assert.equal(rejected.rejectedRoot,1);
});

test('optional source qualification leaves the regional placement, shrub, rock, grass, cell and landmark streams byte-identical',()=>{
 const geography=createEaldholtFarGeography({sourceEnvelope:village,seaPositions:[-100,0,-100,-50,0,-100,-100,0,200,-50,0,200],channelPositions:[-50,0,120,-50,0,150,200,0,120,200,0,150],riverFarX:30000});
 const input={geography,land:[createRegionalProjectedGround(geography)],prototypes,maximumTrees:600},a=createRegionalWorldLayout(input),b=createRegionalWorldLayout({...input,realisticTreeSource:source,realisticForest01Source:{...source,variant:1,height:14.7,canopyRadius:4.4}});
 assert.equal(a.version,b.version);assert.deepEqual(a.placements,b.placements);assert.deepEqual(a.rocks,b.rocks);assert.deepEqual(a.groundcover,b.groundcover);assert.deepEqual(a.cells,b.cells);assert.deepEqual(a.landmarks,b.landmarks);assert.deepEqual(a.species,b.species);assert.deepEqual(a.rejected,b.rejected);assert.ok(b.realisticTrees);assert.ok(b.realisticTrees.ids.length>0);assert.ok(b.realisticTrees.ids.length<=128);assert.ok(b.realisticForest01Trees);assert.ok(b.realisticForest01Trees.ids.length>0);assert.ok(b.realisticTrees.ids.length+b.realisticForest01Trees.ids.length<=REALISTIC_TREE_COHORT_LIMIT);for(const id of b.realisticForest01Trees.ids)assert.equal(b.placements[id*6+5],1,'the second source qualifies existing medium-broadleaf rows only');
});

test('elevated full/crown captures subdivide their outer fade domain rather than overwriting the near-tree handoff',()=>{
 for(const canopy of [false,true]){const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <alphatest_fragment>\n#include <map_fragment>\n#include <normal_fragment_maps>'};
  patchVegetationImpostor(shader,true,{canopy,coverage:true});patchVegetationFade(shader);
  assert.ok(shader.vertexShader.includes('mix(crownfallLodRange.x,crownfallLodRange.y,crownfallCanopyWeight)'));
  assert.ok(shader.vertexShader.includes(canopy?'vec2(crownfallLodRange.x,mix':'crownfallCanopyWeight),crownfallLodRange.y)'));
  assert.ok(shader.fragmentShader.includes('crownfallDoor<vCrownfallLodRange.x||crownfallDoor>=vCrownfallLodRange.y'));
 }
});

test('a second qualified source uses only the remaining cohort slots and never changes original actor rows',()=>{
 const medium:RealisticTreeCohortSource={...source,variant:1,height:14.7,canopyRadius:4.4},placements=Float32Array.from(Array.from({length:20},(_,i)=>[113+i*.5,-.08,50,.01*i,1,1]).flat()),before=placements.slice();
 const a=qualifyRealisticTreeCohort({placements,source:medium,village,sample,limit:3});assert.deepEqual(Array.from(a.ids),[0,1,2]);assert.deepEqual(placements,before);assert.equal(qualifyRealisticTreeCohort({placements,source:medium,village,sample,limit:0}).ids.length,0);for(const limit of[-1,129,1.5])assert.throws(()=>qualifyRealisticTreeCohort({placements,source:medium,village,sample,limit}),/budget/);
});

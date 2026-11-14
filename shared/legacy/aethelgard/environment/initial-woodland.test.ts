import assert from 'node:assert/strict';import test from 'node:test';
import {initialWoodlandProgress,initialWoodlandReadiness,initialWoodlandReady} from './initial-woodland';
test('the first full-source frame waits for every tree capture while grass can continue in the background',()=>{
 const tree=Object.freeze({kind:'tree' as const,readyMask:15,status:'ready'}),grass=Object.freeze({kind:'grass' as const,readyMask:1,status:'preparing'});
 assert.equal(initialWoodlandReady([tree,null],[tree,grass]),true);
 for(const mask of [1,3,7]){const pending=Object.freeze({readyMask:mask,status:'preparing'});
  assert.equal(initialWoodlandReady([pending],[tree,grass]),false);
  assert.equal(initialWoodlandReady([tree],[{...pending,kind:'tree'},grass]),false);}
 assert.equal(initialWoodlandReady([tree],[tree,grass],false),false,'the regional addition has its own publication gate');
 assert.equal(tree.readyMask,15);assert.equal(grass.readyMask,1);
});
test('unavailable derived trees keep their original fallback instead of blocking startup forever',()=>{
 const failed=Object.freeze({kind:'tree' as const,readyMask:3,status:'error'});
 assert.equal(initialWoodlandReady([failed],[failed]),true);assert.equal(initialWoodlandReady([],[]),true);
});
test('resident captures can draw with their current PBR while progressive material programs prepare',()=>{
 const tree=Object.freeze({kind:'tree',readyMask:15,status:'ready'});
 for(const materialProgramsPending of [1,2,1774]){
  const materials=Object.freeze({materialProgramsPending,materialGraphPending:true});
  assert.deepEqual(initialWoodlandReadiness([tree],[tree],true,materials),{drawable:true,prepared:false});
  assert.equal(materials.materialProgramsPending,materialProgramsPending,'Readiness cannot consume or relabel real preparation work');
 }
 assert.deepEqual(initialWoodlandReadiness([tree],[tree],true,{materialProgramsPending:0,materialGraphPending:true}),{drawable:true,prepared:false},'A gap between bounded cohorts is not complete preparation');
 assert.deepEqual(initialWoodlandReadiness([tree],[tree],true,{materialProgramsPending:0,materialGraphPending:false}),{drawable:true,prepared:true});
});
test('drawable readiness retains the distant-tree capture gate and regional ownership gate',()=>{
 const tree=Object.freeze({kind:'tree',readyMask:15,status:'ready'}),materials=Object.freeze({materialProgramsPending:0,materialGraphPending:false});
 for(const readyMask of [0,1,3,7]){
  const pending=Object.freeze({kind:'tree',readyMask,status:'preparing'});
  assert.deepEqual(initialWoodlandReadiness([pending],[tree],true,materials),{drawable:false,prepared:false});
  assert.deepEqual(initialWoodlandReadiness([tree],[pending],true,materials),{drawable:false,prepared:false});
 }
 assert.deepEqual(initialWoodlandReadiness([tree],[tree],false,materials),{drawable:false,prepared:false});
});
test('background grass and failed source fallback remain drawable without claiming full preparation',()=>{
 const tree=Object.freeze({kind:'tree',readyMask:15,status:'ready'}),grass=Object.freeze({kind:'grass',readyMask:1,status:'preparing'}),failed=Object.freeze({kind:'tree',readyMask:3,status:'error'});
 assert.deepEqual(initialWoodlandReadiness([tree],[tree,grass]),{drawable:true,prepared:false});
 assert.deepEqual(initialWoodlandReadiness([failed],[failed]),{drawable:true,prepared:false});
 assert.deepEqual(initialWoodlandReadiness([],[]),{drawable:true,prepared:true});
});
test('single-use source iterators are inspected once without source mutation',()=>{
 const tree=Object.freeze({kind:'tree',readyMask:15,status:'ready'});
 function* generated(){yield tree;yield null;}function* authored(){yield tree;}
 assert.deepEqual(initialWoodlandReadiness(generated(),authored()),{drawable:true,prepared:true});
 assert.deepEqual(tree,{kind:'tree',readyMask:15,status:'ready'});
});
test('the loading bar reads the same preparation as a share, reaching one exactly when the gate opens',()=>{
 const tree=Object.freeze({kind:'tree' as const,readyMask:15,status:'ready'}),grass=Object.freeze({kind:'grass' as const,readyMask:1,status:'preparing'});
 const failed=Object.freeze({kind:'tree' as const,readyMask:3,status:'error'});
 assert.equal(initialWoodlandProgress([],[]),1);assert.equal(initialWoodlandProgress([],[],false),0);
 assert.equal(initialWoodlandProgress([tree,null],[tree,grass]),1,'grass and absent woodlands do not count');
 assert.equal(initialWoodlandProgress([failed],[failed]),1,'a failed derivation keeps its fallback and counts as done');
 assert.equal(initialWoodlandProgress([tree],[tree],false),2/3);
 let previous=-1;
 for(const mask of [0,1,3,7,15]){const state={readyMask:mask,status:mask===15?'ready':'preparing'};
  const share=initialWoodlandProgress([state],[{...state,kind:'tree'},grass]);
  assert.ok(share>previous,String(mask));previous=share;
  assert.equal(share===1,initialWoodlandReady([state],[{...state,kind:'tree'},grass]),String(mask));}
 assert.equal(initialWoodlandProgress([{readyMask:5,status:'preparing'}],[]),.75,'any two of the four parts are half of that woodland');
});

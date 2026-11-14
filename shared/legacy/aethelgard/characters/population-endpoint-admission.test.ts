import assert from 'node:assert/strict';
import test from 'node:test';
import {createPopulationEndpointAdmission} from './population-endpoint-admission';
import type {VillageSiteLayout} from './village-site';
import type {VillagePopulationResidentState,VillagePopulationSample} from './village-population-runtime';
const site:VillageSiteLayout=Object.freeze({profile:'desktop',sourceSha256:'a'.repeat(64),frame:'source-root-local-metres',capsule:{radius:.6,height:2.1},
 anchors:Object.freeze(['court','well'].map((id,i)=>({id,sourceActor:'synthetic-test-ground',standingOnly:true as const,sourceGroundPoint:[i*10,0,0] as const,capsuleBottomPoint:[i*10,.02,0] as const}))),
 routes:[],residentPlaceBindings:[],placeBindings:['court','well'].map(id=>({placeId:id,anchorId:id,status:'mapped-exterior' as const}))});
function sample(place='court',generation=1):VillagePopulationSample{
 const row:VillagePopulationResidentState={residentId:'synthetic-resident',tier:'persistent',activity:'Synthetic test activity.',roleClip:null,availableRoleClips:[],scheduledPlaceId:place,placeId:null,fromPlaceId:'unmapped-home',slotIndex:1,slotStartMinute:480,slotEndMinute:600,status:'unmapped',reason:'route-unmapped',position:null,yawRadians:0,moving:false,presentable:false};
 return{generation,time:{absoluteWorldMinute:540+generation,dayIndex:0,dayMinute:540+generation,fractionalMinute:0,elapsedWorldMinutes:generation,deferredMilliseconds:0},residents:[row],counts:{total:100,households:25,major:20,scheduled:80,mapped:0,unmapped:1,moving:0,blocked:0}};
}
test('a never-presented resident can initially occupy a measured endpoint without claiming arrival',()=>{
 const controller=createPopulationEndpointAdmission(site),input=sample(),before=JSON.stringify(input),result=controller.sample(input,100,new Set());
 assert.deepEqual(result.residents[0].position,[0,0,0]);assert.equal(result.residents[0].routeCertified,false);assert.equal(result.residents[0].workPoseQualified,false);assert.equal(JSON.stringify(input),before);
});
test('visible resident keeps a continuous endpoint but cannot jump to a different destination',()=>{
 const controller=createPopulationEndpointAdmission(site),visible=new Set(['synthetic-resident']);controller.sample(sample(),0,new Set());
 assert.deepEqual(controller.sample(sample('court',2),100,visible).residents[0].position,[0,0,0]);
 const changed=controller.sample(sample('well',3),200,visible);assert.equal(changed.residents[0].position,null);assert.equal(changed.residents[0].projectionHeldReason,'abstract-visible-transition-held');
});
test('previously visible resident waits two whole seconds offscreen before a new abstract endpoint',()=>{
 const controller=createPopulationEndpointAdmission(site),visible=new Set(['synthetic-resident']);controller.sample(sample(),0,new Set());controller.sample(sample('court',2),100,visible);
 assert.equal(controller.sample(sample('well',3),2099,new Set()).residents[0].position,null);
 assert.deepEqual(controller.sample(sample('well',4),2100,new Set()).residents[0].position,[10,0,0]);
});
test('reappearing visibility resets the offscreen interval and presentation time cannot rewind',()=>{
 const controller=createPopulationEndpointAdmission(site),visible=new Set(['synthetic-resident']);controller.sample(sample(),0,new Set());controller.sample(sample('court',2),100,visible);
 controller.sample(sample('court',3),1900,visible);assert.equal(controller.sample(sample('well',4),2100,new Set()).residents[0].position,null);
 assert.throws(()=>controller.sample(sample('well',5),2099,new Set()),/monotonic/);
 assert.deepEqual(controller.sample(sample('well',6),3900,new Set()).residents[0].position,[10,0,0]);
});
test('clearing a disposed world drops its presentation history',()=>{
 const controller=createPopulationEndpointAdmission(site);controller.sample(sample(),9000,new Set(['synthetic-resident']));controller.clear();
 assert.deepEqual(controller.sample(sample('well'),0,new Set()).residents[0].position,[10,0,0]);
});

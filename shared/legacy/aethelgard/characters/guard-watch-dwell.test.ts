import assert from 'node:assert/strict';
import test from 'node:test';
import {isCertifiedPatrolDwell,selectGuardWatchPhase} from './guard-watch-dwell';
import {EALDHOLT_VILLAGE_POPULATION as population} from './village-population';
import type {VillagePopulationResidentState} from './village-population-runtime';
import {resolvePopulationPresentation} from './village-activity-presentation';
import {qualifyPopulationMotion} from './population-motion-clearance';
import type {VillageSiteLayout} from './village-site';

const guard=population.residents.find(r=>r.id==='ealdholt-garrison-spearman')!;
const slot=guard.registry.routine.find(s=>s.placeId==='proposed-lanes'&&s.startMinute===780)!;
function sample():VillagePopulationResidentState{
 return{residentId:guard.id,tier:guard.fidelityTier,activity:slot.activity,roleClip:null,availableRoleClips:guard.appearance.motion.roleClips,
  scheduledPlaceId:slot.placeId,placeId:'registered-lane-turn',fromPlaceId:slot.placeId,slotIndex:guard.registry.routine.indexOf(slot),
  slotStartMinute:slot.startMinute,slotEndMinute:slot.endMinute,status:'at-place',reason:null,position:[4,0,8],yawRadians:0,moving:false,presentable:true,
  lifeIntent:{residentId:guard.id,activityKey:'patrol',activity:slot.activity,targetPlaceId:slot.placeId,priority:60,issuedAbsoluteMinute:780,indoor:false,companionIds:[],reason:'routine'},
  lifeStatus:'active',workPoseQualified:false,navigationStatus:'at-threshold',navigationReason:null,arrivalEvidence:'certified-route-arrival',arrivedAtAbsoluteMinute:781,
  patrol:{planId:'registered-lane-patrol',phase:'dwelling',completedLegs:1,waypointPlaceId:'registered-lane-turn'},patrolDwell:{elapsedSeconds:.5,durationSeconds:4}};
}
test('a measured watch needs coherent current dwell facts; it never grants work or a watch-post arrival',()=>{
 const s=sample(),before=JSON.stringify(s);assert.equal(isCertifiedPatrolDwell(s),true);
 for(const change of [{patrolDwell:undefined},{moving:true},{status:'travelling'},{lifeStatus:'queued'},{reason:'life-resource-unavailable'},
   {waitingForResource:true},{waitingForRoute:true},{presentable:false},{arrivalEvidence:'initial-placement'},{arrivedAtAbsoluteMinute:null},
   {position:null},{placeId:'proposed-watch-post'},{navigationReason:'corridor-reserved'},{workPoseQualified:true}]){
  const changed={...s,...change} as VillagePopulationResidentState;
  assert.equal(isCertifiedPatrolDwell(changed),false,JSON.stringify(change));
 }
 assert.equal(isCertifiedPatrolDwell({...s,lifeIntent:{...s.lifeIntent!,reason:'weather'}}),false);
 assert.equal(isCertifiedPatrolDwell({...s,lifeIntent:{...s.lifeIntent!,indoor:true}}),false);
 assert.equal(JSON.stringify(s),before);assert.equal(s.workPoseQualified,false);assert.equal(s.patrol?.completedLegs,1);
});
test('enter, original loop and exit use a bounded world-clock timeline with no loop when the dwell is too short',()=>{
 assert.deepEqual(selectGuardWatchPhase(.6,4,1.2,.12),{motion:'workEnter',animationTimeSeconds:.6,fadeSeconds:.12});
 assert.deepEqual(selectGuardWatchPhase(2,4,1.2,.12),{motion:'work',animationTimeSeconds:.8,fadeSeconds:.12});
 const exit=selectGuardWatchPhase(3,4,1.2,.12)!;assert.equal(exit.motion,'workExit');assert.ok(Math.abs(exit.animationTimeSeconds-.2)<1e-12);assert.equal(exit.fadeSeconds,.12);
 for(const args of [[0,2,1.2,.12],[4,4,1.2,.12],[-1,4,1.2,.12],[NaN,4,1.2,.12],[0,4,-1,.12],[0,4,1.2,.5]])
  assert.equal(selectGuardWatchPhase(...args as [number,number,number,number]),null);
 const restored=JSON.parse(JSON.stringify(sample()));
 assert.deepEqual(selectGuardWatchPhase(restored.patrolDwell.elapsedSeconds,4,1.2,.12),selectGuardWatchPhase(.5,4,1.2,.12));
});
test('only qualified lane dwell resolves the measured watch; work, watch-post, missing motion and source waits remain distinct',()=>{
 const s=sample(),before=JSON.stringify(s),p=resolvePopulationPresentation(s);
 assert.equal(p.presentable,true);assert.equal(p.guardWatch,true);assert.equal(p.motion,'workEnter');assert.equal(p.activity.roleClip,'guard_stand_watch_d');
 const site={profile:'desktop',sourceSha256:'a'.repeat(64),frame:'source-root-local-metres',capsule:{radius:.85,height:3.5}} as VillageSiteLayout;
 assert.equal(qualifyPopulationMotion(s,p,site,null,'desktop').presentable,true,'the separate real-addon proof supplies these new clip/prop/blend measurements');
 assert.equal(qualifyPopulationMotion(s,p,site,null,'quest',{profile:'quest',sha256:'a'.repeat(64)}).reason,'motion-site-unavailable');
 assert.equal(qualifyPopulationMotion(s,{...p,guardWatch:undefined},site,null,'desktop').reason,'motion-presentation-mismatch');
 for(const change of [{patrolDwell:undefined},{placeId:'proposed-watch-post'},{lifeStatus:'queued'},{waitingForRoute:true,status:'blocked'}])
  assert.equal(resolvePopulationPresentation({...s,...change} as VillagePopulationResidentState).presentable,false);
 const generic={...s,patrol:undefined,patrolDwell:undefined};assert.equal(resolvePopulationPresentation(generic).reason,'locomotion-requires-moving-state');
 assert.equal(JSON.stringify(s),before);assert.equal(s.workPoseQualified,false);assert.equal(s.patrol?.completedLegs,1);
});

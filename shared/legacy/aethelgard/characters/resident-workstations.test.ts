import test from 'node:test';
import assert from 'node:assert/strict';
import {createResidentActionQueues,advanceResidentActionQueues,type ResidentActionQueue,type ResidentActionQueues,type ResidentActionSource} from './resident-action-queue';
import type {ResidentRoutineActionPhysicalContext} from './resident-routine-actions';
import {createResidentWorkstations,parseResidentWorkstations,advanceResidentWorkstations,createResidentWorkstationPhysicalPort,type ResidentWorkstation,type ResidentWorkstationObservation,type ResidentWorkstations} from './resident-workstations';

/** Explicit synthetic contracts: owner/queue behavior, not real asset evidence. */
const source:ResidentActionSource={profile:'desktop',sha256:'a'.repeat(64),siteIdentity:'unit-original-source'},world='unit-work-owner';
const goal={key:'unit-wood-work',activityKey:'work',activity:'Splits a finite original log.',targetPlaceId:'unit-woodland',issuedAbsoluteMinute:0};
function catalog(residentId='worker'):ResidentWorkstation{return{station:{id:'unit-station-'+residentId,residentId,placeId:goal.targetPlaceId,anchorId:'unit-work-stand',source,clip:'work_chop_wood',certificateSha256:'b'.repeat(64),durationWorldMinutes:1,proof:{originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:'unit-original-log'}},resourceId:'unit-one-log-block',standPosition:[0,0,0],yawRadians:0,maximumStandDistanceMetres:.02,maximumFacingErrorRadians:.04,contactPoint:[0,1,.5],maximumToolContactDistanceMetres:.02,markerIds:['impactSeconds:0']};}
const arrival=(id='worker')=>({id:'unit-arrival-'+id,residentId:id,placeId:goal.targetPlaceId,anchorId:'unit-work-stand',atMinute:1,source,kind:'certified-route-arrival' as const,exclusivelyOwned:true as const});
function context(q:ResidentActionQueue,minute:number):ResidentRoutineActionPhysicalContext{return{worldKey:world,absoluteMinute:minute,residentId:q.residentId,goal:q.goal,source,queue:q,arrival:arrival(q.residentId),journey:{residentId:q.residentId,inside:false,route:null,arrivalEvidence:'certified-route-arrival',targetPlaceId:goal.targetPlaceId}as ResidentRoutineActionPhysicalContext['journey']};}
function pose(q:ResidentActionQueue,minute:number,options:{contact?:boolean;released?:boolean;loop?:number;station?:ResidentWorkstation}={}):ResidentWorkstationObservation{
 const station=options.station??catalog(q.residentId);return{residentId:q.residentId,jobId:q.jobId,stationId:station.station.id,atMinute:minute,source,stationCertificateSha256:station.station.certificateSha256,position:[0,0,0],yawRadians:0,poseSourceQualified:true,fullyWeighted:true,activeClip:options.released?'idle':station.station.clip,equipmentReleased:!!options.released,contact:options.contact?{event:{ownerId:q.residentId,requestId:1,motion:'work',clipId:station.station.clip,kind:'marker',state:'playing',seconds:minute,loop:options.loop??minute,hold:'none',markerId:'impactSeconds:0',markerName:'impactSeconds',markerKind:'contact'},toolPoint:[0,1,.5],targetPoint:[0,1,.5],contactSourceActor:'unit-original-log'}:null};
}
function start(ids=['worker']){return createResidentActionQueues(world,0,ids.map(residentId=>({residentId,goal})),source);}
function advance(queue:ResidentActionQueues,owner:ResidentWorkstations,minute:number,observations:readonly ResidentWorkstationObservation[],rows=queue.residents.map(q=>catalog(q.residentId))){
 const requests=queue.residents.map(q=>context(q,minute)),next=advanceResidentWorkstations(owner,{absoluteMinute:minute,catalog:rows,requests,observations}),port=createResidentWorkstationPhysicalPort(next,rows);
 const queued=advanceResidentActionQueues(queue,{worldKey:world,absoluteMinute:minute,source,residents:queue.residents.map(q=>({residentId:q.residentId,goal:q.goal,interruption:null})),observations:requests.map(c=>({residentId:c.residentId,source,destinationMapped:true,navigationReason:null,arrival:c.arrival,...port.observe(c)!}))});return{queue:queued,owner:next};
}

test('real owner consumes approach, exclusive lease, stable facing, authored contacts and equipment release in saved queue order',()=>{
 let queue=start(),owner=createResidentWorkstations(world,source,0);
 for(let minute=1;minute<=6;minute++){
  const q=queue.residents[0],step=advance(queue,owner,minute,[pose(q,minute,{contact:q.current==='perform',released:q.current==='release'})]);queue=step.queue;owner=step.owner;
  if(minute===2){assert.equal(queue.residents[0].current,'face');assert.equal(owner.entries.length,1);}
  if(minute===3)assert.equal(queue.residents[0].current,'perform');
  if(minute===4){assert.equal(queue.residents[0].performedWorldMinutes,0);assert.equal(owner.entries[0].performStartedAtMinute,3);assert.equal(owner.entries[0].phase,'perform');assert.equal(owner.entries[0].phaseStartedAtMinute,3);}
 }
 const done=queue.residents[0];assert.equal(done.current,null);assert.equal(done.performedWorldMinutes,1);assert.equal(done.proof.contactCount,2);assert.ok(done.proof.usedEventIds.some(id=>id.startsWith('work-release:')));
 const cleaned=advanceResidentWorkstations(owner,{absoluteMinute:7,catalog:[catalog()],requests:[context(done,7)],observations:[]});assert.equal(cleaned.entries.length,0);assert.equal(cleaned.releases.length,0);
});

test('one physical object cannot be leased to two person-specific stations at the same time',()=>{
 let queue=start(['a','b']),owner=createResidentWorkstations(world,source,0);({queue,owner}=advance(queue,owner,1,[]));({queue,owner}=advance(queue,owner,2,[]));
 assert.equal(owner.entries.length,1);assert.equal(owner.entries[0].lease.residentId,'a');assert.equal(queue.residents.find(q=>q.residentId==='b')!.wait?.reason,'physical-lease-pending');
});

test('a schedule, missing actual pose or incorrect tool contact never earns work',()=>{
 let queue=start(),owner=createResidentWorkstations(world,source,0);({queue,owner}=advance(queue,owner,1,[]));({queue,owner}=advance(queue,owner,2,[]));
 ({queue,owner}=advance(queue,owner,3,[]));assert.equal(queue.residents[0].current,'face');assert.equal(queue.residents[0].performedWorldMinutes,0);
 ({queue,owner}=advance(queue,owner,4,[pose(queue.residents[0],4)]));assert.equal(queue.residents[0].current,'perform');
 const bad=pose(queue.residents[0],5,{contact:true});({queue,owner}=advance(queue,owner,5,[{...bad,contact:{...bad.contact!,toolPoint:[5,1,.5]}}]));assert.equal(owner.entries[0].contact,null);assert.equal(queue.residents[0].performedWorldMinutes,0);
});

test('duplicate actual marker and same-time polling do not create additional contact or progress',()=>{
 let queue=start(),owner=createResidentWorkstations(world,source,0);for(let minute=1;minute<=4;minute++)({queue,owner}=advance(queue,owner,minute,[pose(queue.residents[0],minute,{contact:minute===4,loop:1})]));
 const before=owner.entries[0].nextContactSequence,duplicate=pose(queue.residents[0],5,{contact:true,loop:1});({queue,owner}=advance(queue,owner,5,[duplicate]));assert.equal(owner.entries[0].contact,null);assert.equal(owner.entries[0].nextContactSequence,before);assert.equal(queue.residents[0].performedWorldMinutes,0);
 ({queue,owner}=advance(queue,owner,5,[pose(queue.residents[0],5,{contact:true,loop:2})]));assert.equal(queue.residents[0].performedWorldMinutes,0,'Zero elapsed world time cannot earn a work interval.');
});

test('saved ownership restores exclusivity, marker deduplication and actual interaction progress',()=>{
 let queue=start(),owner=createResidentWorkstations(world,source,0);for(let minute=1;minute<=4;minute++)({queue,owner}=advance(queue,owner,minute,[pose(queue.residents[0],minute,{contact:minute===4})]));
 const restored=parseResidentWorkstations(JSON.stringify(owner),{worldKey:world,source});assert.deepEqual(restored,owner);
 const direct=advance(queue,owner,5,[pose(queue.residents[0],5,{contact:true})]),loaded=advance(queue,restored,5,[pose(queue.residents[0],5,{contact:true})]);assert.deepEqual(loaded,direct);
 assert.throws(()=>parseResidentWorkstations({...owner,entries:[owner.entries[0],owner.entries[0]]}),/duplicate owners/);
});

test('allocation then identical same-minute observation retains its real contact and immutable owner',()=>{
 let queue=start(),owner=createResidentWorkstations(world,source,0);for(let minute=1;minute<=4;minute++)({queue,owner}=advance(queue,owner,minute,[pose(queue.residents[0],minute,{contact:minute===4})]));
 const request=context(queue.residents[0],4),allocated=advanceResidentWorkstations(owner,{absoluteMinute:4,mode:'allocate',catalog:[catalog()],requests:[request],observations:[]});
 assert.strictEqual(allocated,owner);assert.ok(allocated.entries[0].contact);
 const observed=advanceResidentWorkstations(allocated,{absoluteMinute:4,catalog:[catalog()],requests:[request],observations:[pose(queue.residents[0],4,{contact:true})]});assert.strictEqual(observed,owner);
 const missing=advanceResidentWorkstations(observed,{absoluteMinute:4,catalog:[catalog()],requests:[request],observations:[]});assert.equal(missing.entries[0].contact,null);assert.equal(missing.entries[0].facing,null);
 const nextMinute=advanceResidentWorkstations(owner,{absoluteMinute:5,mode:'allocate',catalog:[catalog()],requests:[context(queue.residents[0],5)],observations:[]});assert.equal(nextMinute.entries[0].contact,null);assert.equal(nextMinute.entries[0].facing,null);
});

test('source/target drift, lost actual arrival and expired ownership release equipment without granting work',()=>{
 let queue=start(),owner=createResidentWorkstations(world,source,0);({queue,owner}=advance(queue,owner,1,[]));({queue,owner}=advance(queue,owner,2,[]));
 const contextLost={...context(queue.residents[0],3),arrival:null};const lost=advanceResidentWorkstations(owner,{absoluteMinute:3,catalog:[catalog()],requests:[contextLost],observations:[]});assert.equal(lost.entries.length,0);
 const expired=advanceResidentWorkstations(owner,{absoluteMinute:20,catalog:[catalog()],requests:[],observations:[]});assert.equal(expired.entries.length,0);assert.equal(expired.releases.length,0);
 assert.throws(()=>advanceResidentWorkstations(owner,{absoluteMinute:3,catalog:[{...catalog(),station:{...catalog().station,source:{...source,sha256:'f'.repeat(64)}}}],requests:[],observations:[]}),/source\/pose\/contact/);
});

test('unqualified, paused, blended or wrong-source observations cannot satisfy facing or contact',()=>{
 let queue=start(),owner=createResidentWorkstations(world,source,0);({queue,owner}=advance(queue,owner,1,[]));({queue,owner}=advance(queue,owner,2,[]));
 for(const change of [{fullyWeighted:false},{poseSourceQualified:false},{yawRadians:1},{position:[1,0,0]as const},{stationCertificateSha256:'c'.repeat(64)}]){
  const result=advance(queue,owner,3,[{...pose(queue.residents[0],3),...change}]);assert.equal(result.owner.entries[0].facing,null);assert.equal(result.queue.residents[0].current,'face');
 }
});

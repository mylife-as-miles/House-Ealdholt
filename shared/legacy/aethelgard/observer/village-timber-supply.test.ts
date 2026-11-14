import test from 'node:test';
import assert from 'node:assert/strict';
import {createResidentActionQueues,advanceResidentActionQueues,parseResidentActionQueues,type ResidentActionQueues,type ResidentActionObservation} from '../characters/resident-action-queue';
import {createVillageTimberSupply,parseVillageTimberSupply,advanceVillageTimberSupply,registerVillageTimberSources,consumeCompletedTimberWork,parseVillageTimberCatalogue,allocateVillageTimber,type VillageTimberCatalogue} from './village-timber-supply';
import {createVillageBuildingDamage,settleVillageBuildingRaid,buildingDamageKey} from './building-damage';
import {buildSourceBuildingCatalogue} from './building-damage-catalogue';
import {createBuildingConflagration,stepBuildingConflagration} from './building-conflagration';
import {requestLocalBuildingRebuildFromSupply,requestLocalBuildingRebuild,buildingFireIncidentId,advanceBuildingDisasterSession} from './building-disaster-session';
import {EMPTY_OBSERVER_SAVE,type ObserverSave} from './observer-save';
import {EALDHOLT_VILLAGE_POPULATION as population} from '../characters/village-population';
import type {ResidentBuildingEmergencyStation} from '../characters/resident-building-emergency';

const world='timber-production-unit',residentId='unit-woodcutter',sha='a'.repeat(64),source={profile:'desktop' as const,sha256:sha,siteIdentity:'unit-source-site'};
const goal={key:'unit-woodcut-day0',activityKey:'work',activity:'Splits finite raw timber.',targetPlaceId:'unit-timber-yard',issuedAbsoluteMinute:0};
const catalogue:VillageTimberCatalogue=parseVillageTimberCatalogue({sources:[{id:'unit-chopped-wood-pile',profile:'desktop',sourceSha256:sha,siteIdentity:source.siteIdentity,sourceActor:'unit-original-pile',sourceInstance:'unit-node-1298',transformSha256:'c'.repeat(64),certificateSha256:'d'.repeat(64),rawUnits:1,timberPerUnit:12}],operations:[{sourceId:'unit-chopped-wood-pile',residentId,stationId:'unit-chopping-station',placeId:goal.targetPlaceId,stationCertificateSha256:'b'.repeat(64),clip:'work_chop_wood',contactSourceActor:'unit-original-block',requiredWorldMinutes:2}]});
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function initial(){return createResidentActionQueues(world,0,[{residentId,goal}],source);}
/** Explicit synthetic source/animation fixtures only. They exercise production
 * queues and resource reducers, never assert actual village qualification. */
function observation(q:ResidentActionQueues,at:number,contact=true,release=true):ResidentActionObservation{
 const job=q.residents[0],stationId='unit-chopping-station',leaseId='unit-exclusive-timber-lease:'+job.jobId,issued=job.goal.issuedAbsoluteMinute;
 return{residentId,source,destinationMapped:true,navigationReason:null,invalidatedTarget:false,
  arrival:at>=issued+1?{id:'unit-certified-route-arrival:'+issued,residentId,placeId:goal.targetPlaceId,anchorId:'unit-timber-stand',atMinute:issued+1,source,kind:'certified-route-arrival',exclusivelyOwned:true}:null,
  station:{id:stationId,residentId,placeId:goal.targetPlaceId,anchorId:'unit-timber-stand',source,clip:'work_chop_wood',certificateSha256:'b'.repeat(64),durationWorldMinutes:2,proof:{originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:'unit-original-block'}},
  lease:at>=issued+2?{id:leaseId,residentId,jobId:job.jobId,stationId,source,sinceMinute:issued+2,untilMinute:100}:null,
  facing:at>=issued+3?{id:'unit-qualified-facing:'+issued,residentId,jobId:job.jobId,stationId,leaseId,source,atMinute:issued+3,sourcePoseQualified:true}:null,
  contacts:contact?[{id:`unit-timber-contact-${at}`,residentId,jobId:job.jobId,stationId,leaseId,source,atMinute:at,sequence:at,clip:'work_chop_wood',markerId:'unit-authored-contact',contactSourceActor:'unit-original-block',contactQualified:true}]:[],
  releases:release?[{id:`unit-release-${at}`,residentId,jobId:job.jobId,stationId,leaseId,source,atMinute:at}]:[]};
}
function step(q:ResidentActionQueues,at:number,contact=true,release=true,pause=false,g=q.residents[0].goal){return advanceResidentActionQueues(q,{worldKey:world,absoluteMinute:at,source,residents:[{residentId,goal:g,interruption:pause?{id:'unit-fire-interruption',reason:'emergency',sinceMinute:at}:null}],observations:[observation(q,at,contact,release)]});}
function completed(){let q=initial();for(let at=1;at<=7;at++)q=step(q,at);assert.equal(q.residents[0].current,null);return q;}
function earned(){const q=completed();return consumeCompletedTimberWork(createVillageTimberSupply(world,0),{queues:q,catalogue,absoluteMinute:q.absoluteMinute}).state;}

test('raw source registration and clock catch-up never create depot timber or work',()=>{
 const start=createVillageTimberSupply(world,0),registered=registerVillageTimberSources(start,catalogue),later=advanceVillageTimberSupply(registered,10000);
 assert.equal(start.sources.length,0);assert.equal(registered.sources[0].remainingUnits,1);assert.equal(later.availableTimber,0);assert.equal(later.producedTimber,0);assert.equal(later.allocatedTimber,0);
 assert.strictEqual(registerVillageTimberSources(registered,catalogue),registered);assert.throws(()=>advanceVillageTimberSupply(later,9999),/rewind/);
});

test('only actual completion through arrival, exclusive lease, facing, consecutive contacts and release yields timber',()=>{
 let q=initial(),stock=createVillageTimberSupply(world,0);
 for(let at=1;at<=6;at++){q=step(q,at);const result=consumeCompletedTimberWork(stock,{queues:q,catalogue,absoluteMinute:at});stock=result.state;assert.equal(stock.availableTimber,0);assert.equal(result.receipts.length,0);}
 assert.equal(q.residents[0].current,'release');q=step(q,7,true,false);stock=consumeCompletedTimberWork(stock,{queues:q,catalogue,absoluteMinute:7}).state;assert.equal(stock.availableTimber,0);
 q=step(q,8);const accepted=consumeCompletedTimberWork(stock,{queues:q,catalogue,absoluteMinute:8});assert.equal(accepted.state.availableTimber,12);assert.equal(accepted.state.sources[0].remainingUnits,0);assert.equal(accepted.receipts.length,1);assert.equal(accepted.receipts[0].completedAtMinute,8);assert.equal(stock.availableTimber,0);
});

test('a genuine release transition can clear its live contact latch without erasing completed work',()=>{
 let q=initial();for(let at=1;at<=6;at++)q=step(q,at);
 assert.equal(q.residents[0].current,'release');assert.equal(q.residents[0].proof.contactCount,3);
 const transition=observation(q,6,false,false);
 // The animation changes from the working loop to an unweighted exit pose at
 // the same world-minute boundary. No extra time or contact is manufactured.
 q=advanceResidentActionQueues(q,{worldKey:world,absoluteMinute:6,source,residents:[{residentId,goal,interruption:null}],observations:[{...transition,facing:null}]});
 assert.equal(q.residents[0].current,'release');assert.equal(q.residents[0].proof.lastContactMinute,null);
 q=step(q,7,false,true);assert.equal(q.residents[0].current,null);assert.equal(q.residents[0].proof.lastContactMinute,null);
 const stock=registerVillageTimberSources(createVillageTimberSupply(world,0),catalogue),result=consumeCompletedTimberWork(stock,{queues:parseResidentActionQueues(JSON.stringify(q)),catalogue,absoluteMinute:7});
 assert.equal(result.state.availableTimber,12);assert.equal(result.state.sources[0].remainingUnits,0);assert.equal(result.receipts.length,1);
 assert.equal(consumeCompletedTimberWork(result.state,{queues:q,catalogue,absoluteMinute:7}).receipts.length,0);
});

test('a completed source-qualified job debits finite raw material once through repeated polls and save/reload',()=>{
 const q=completed(),first=consumeCompletedTimberWork(createVillageTimberSupply(world,0),{queues:q,catalogue,absoluteMinute:7}),restored=parseVillageTimberSupply(JSON.stringify(first.state),world);
 assert.deepEqual(restored,first.state);const replay=consumeCompletedTimberWork(restored,{queues:parseResidentActionQueues(JSON.stringify(q)),catalogue,absoluteMinute:7});assert.equal(replay.state.availableTimber,12);assert.equal(replay.receipts.length,0);assert.equal(replay.held[0].reason,'work-already-consumed');assert.equal(replay.state.sources[0].remainingUnits,0);
});

test('new ledger/source adoption does not retrospectively credit an earlier completed job',()=>{
 let q=completed();q=step(q,100);assert.equal(q.residents[0].completedAtMinute,7);
 const result=consumeCompletedTimberWork(createVillageTimberSupply(world,100),{queues:q,catalogue,absoluteMinute:100});
 assert.equal(result.state.availableTimber,0);assert.equal(result.state.sources[0].remainingUnits,1);assert.equal(result.receipts.length,0);assert.equal(result.held[0].reason,'work-before-source-adoption');
});

test('changing a station source, certificate, operation contact, clip or duration cannot consume production',()=>{
 const q=completed();for(const change of [(c:any)=>c.sources[0].sourceSha256='e'.repeat(64),(c:any)=>c.operations[0].stationCertificateSha256='e'.repeat(64),(c:any)=>c.operations[0].contactSourceActor='another-source-object',(c:any)=>c.operations[0].requiredWorldMinutes=3]){
  const modified=copy(catalogue);change(modified);const result=consumeCompletedTimberWork(createVillageTimberSupply(world,0),{queues:q,catalogue:modified,absoluteMinute:7});assert.equal(result.receipts.length,0);assert.equal(result.state.availableTimber,0);assert.equal(result.state.sources[0].remainingUnits,1);assert.equal(result.held[0].reason,'timber-operation-unqualified');
 }
 const wrongClip=copy(catalogue) as any;wrongClip.operations[0].clip='work_hammer';assert.throws(()=>parseVillageTimberCatalogue(wrongClip),/operation/);
});

test('interrupting a productive job cannot earn missing contact time, and restored work resumes coherently',()=>{
 let direct=initial();for(let at=1;at<=5;at++)direct=step(direct,at);assert.equal(direct.residents[0].performedWorldMinutes,1);
 direct=step(direct,6,true,true,true);let loaded=parseResidentActionQueues(JSON.stringify(direct));
 for(let at=7;at<=14;at++){direct=step(direct,at);loaded=step(loaded,at);assert.deepEqual(loaded,direct);}
 assert.equal(direct.residents[0].current,null);const result=consumeCompletedTimberWork(registerVillageTimberSources(createVillageTimberSupply(world,0),catalogue),{queues:loaded,catalogue,absoluteMinute:14});assert.equal(result.state.availableTimber,12);assert.equal(result.receipts.length,1);
});

test('a different completed job cannot process a depleted pile or refill it under a renamed source',()=>{
 const stock=earned();let next=completed();next=step(next,8,true,true,false,{...goal,key:'unit-next-woodcut',issuedAbsoluteMinute:8});for(let at=9;at<=16;at++)next=step(next,at);assert.equal(next.residents[0].current,null);
 const result=consumeCompletedTimberWork(stock,{queues:next,catalogue,absoluteMinute:16});assert.equal(result.state.availableTimber,12);assert.equal(result.receipts.length,0);assert.equal(result.held[0].reason,'raw-timber-depleted');
 const renamed=copy(catalogue) as any;renamed.sources[0].id='renamed-same-actor';renamed.operations[0].sourceId='renamed-same-actor';assert.throws(()=>registerVillageTimberSources(stock,renamed),/changed identity/);
 renamed.sources[0].transformSha256='f'.repeat(64);assert.throws(()=>registerVillageTimberSources(stock,renamed),/changed identity/,'A transform change cannot turn the same depleted source actor into new material.');
 const increased=copy(catalogue) as any;increased.sources[0].rawUnits=2;assert.throws(()=>registerVillageTimberSources(stock,increased),/changed identity/);
});

test('strict ledger parsing rejects minted stock, duplicated actors, bad consumption and foreign worlds',()=>{
 const stock=earned(),before=JSON.stringify(stock);
 for(const change of [(s:any)=>s.availableTimber++,(s:any)=>s.producedTimber++,(s:any)=>s.sources[0].remainingUnits=1,(s:any)=>s.sources.push({...s.sources[0],id:'alias'}),(s:any)=>s.workWatermarks=[]]){const bad=copy(stock);change(bad);assert.throws(()=>parseVillageTimberSupply(bad,world));}
 assert.throws(()=>parseVillageTimberSupply(stock,'foreign'));assert.throws(()=>consumeCompletedTimberWork(stock,{queues:completed(),catalogue,absoluteMinute:6}));assert.equal(JSON.stringify(stock),before);
});

const buildings=buildSourceBuildingCatalogue({sourceSha256:sha,profile:'desktop',parts:[{id:'door',kind:'door',bounds:{min:[0,0,0],max:[4,2,.2]}},{id:'wall',kind:'wall',bounds:{min:[0,0,3],max:[4,2,3.2]}},{id:'roof',kind:'roof',bounds:{min:[-.2,2,-.2],max:[4.2,2.4,3.4]}}]}).buildings;
const building=buildings[0],mason=population.residents.find(r=>r.id==='ealdholt-master-mason')!;
function ruin(){const outcome={worldKey:world,raidId:'raid-0-0',startMinute:0,settledMinute:0,outcome:'burned' as const,binding:building.binding,targetLabel:'Explicit synthetic resource fixture'};
 const fire=stepBuildingConflagration(createBuildingConflagration({worldKey:world,absoluteMinute:0,seed:world,buildings}),{absoluteMinute:100,damageOutcome:outcome,weather:Array.from({length:100},(_,atMinute)=>({atMinute,rain:0,windX:0,windZ:0}))}).state;
 const damage=settleVillageBuildingRaid(createVillageBuildingDamage(world,0),outcome,100),saved:ObserverSave={...EMPTY_OBSERVER_SAVE,raidSerial:1,buildingDamage:{status:'valid',state:damage},buildingFire:{status:'valid',state:fire}};
 const incident=buildingFireIncidentId(fire.buildings[0])!,station:ResidentBuildingEmergencyStation={id:'unit-qualified-repair',disasterId:incident,residentId:mason.id,placeId:mason.workPlaceId,anchorId:'unit-repair-anchor',kind:'repair',buildingKey:buildingDamageKey(building.binding),sourceActor:'unit-ground',contactPoint:[6,1,0],yawRadians:0,clip:'work_chisel',operationWorldMinutes:1,waterUnits:1,proof:{sourceSha256:sha,profile:'desktop',siteIdentity:source.siteIdentity,originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:'unit-original-workpiece',maximumContactDistanceMetres:1,clip:'work_chisel'}};
 return{saved,input:{worldKey:world,binding:building.binding,atMinute:100,workerIds:[mason.id],population,buildings,stations:[station]}};
}

test('an unfunded rebuilding request preserves both worlds and does not create stock or an order',()=>{
 const{saved,input}=ruin(),stock=createVillageTimberSupply(world,100),before=JSON.stringify(saved);
 assert.equal(requestLocalBuildingRebuild(saved,input).ok,false);const result=requestLocalBuildingRebuildFromSupply(saved,stock,input);assert.equal(result.ok,false);if(result.ok)assert.fail();assert.match(result.reason,/12 earned local timber/);assert.strictEqual(result.save,saved);assert.strictEqual(result.supply,stock);assert.equal(JSON.stringify(saved),before);assert.equal(stock.availableTimber,0);
});

test('completed local wood work funds the real12-timber order atomically and never supplies labour from elapsed time',()=>{
 const{saved,input}=ruin(),stock=advanceVillageTimberSupply(earned(),100),before=JSON.stringify(saved),result=requestLocalBuildingRebuildFromSupply(saved,stock,input);assert.ok(result.ok,result.ok?'':result.reason);if(!result.ok)assert.fail();
 const damage=result.save.buildingDamage,orders=result.save.localRebuildOrders;if(damage?.status!=='valid'||orders?.status!=='valid')assert.fail('Funded local repair must keep valid damage and order data.');
 assert.equal(result.allocatedTimber,12);assert.equal(result.supply.availableTimber,0);assert.equal(result.supply.allocatedTimber,12);assert.equal(damage.state.timber,0);assert.equal(orders.state.orders[0].reservedTimber,12);assert.equal(orders.state.orders[0].deliveredTimber,0);assert.equal(JSON.stringify(saved),before);assert.equal(stock.availableTimber,12);
 const restored=parseVillageTimberSupply(JSON.stringify(result.supply),world),retry=requestLocalBuildingRebuildFromSupply(result.save,restored,input);assert.equal(retry.ok,false);assert.strictEqual(retry.save,result.save);assert.strictEqual(retry.supply,restored);assert.equal(restored.allocatedTimber,12);
 const later=advanceBuildingDisasterSession(result.save,{worldKey:world,absoluteMinute:120,buildings}),fire=later.save.buildingFire;if(fire?.status!=='valid')assert.fail('Local repair retains valid fire state.');assert.equal(fire.state.buildings[0].repairLabour,0);assert.notEqual(fire.state.buildings[0].phase,'sound');
});

test('ineligible or changed-source repairs cannot spend earned supplies or leave a partial funding transfer',()=>{
 const{saved,input}=ruin(),stock=advanceVillageTimberSupply(earned(),100),before=JSON.stringify(stock);
 for(const bad of [{...input,workerIds:[]},{...input,stations:[]},{...input,worldKey:'foreign'},{...input,atMinute:99}]){const result=requestLocalBuildingRebuildFromSupply(saved,stock,bad);assert.equal(result.ok,false);assert.strictEqual(result.save,saved);assert.strictEqual(result.supply,stock);assert.equal(JSON.stringify(stock),before);}
 const allocated=allocateVillageTimber(stock,{incidentId:'unit-other-incident',binding:building.binding,atMinute:100,timber:12});assert.equal(allocated.availableTimber,0);assert.strictEqual(allocateVillageTimber(allocated,{incidentId:'unit-other-incident',binding:building.binding,atMinute:100,timber:12}),allocated);assert.throws(()=>allocateVillageTimber(allocated,{incidentId:'unit-third-incident',binding:building.binding,atMinute:100,timber:12}),/earned local timber/);
});

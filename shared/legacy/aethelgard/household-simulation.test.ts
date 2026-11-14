import assert from 'node:assert/strict';
import test from 'node:test';
import { createPeopleLifeEventsSnapshot, getPeopleLifeBelief, recordPeopleLifeFamilyRevision } from './people-life-events';
import type { PeopleLifeRegistry as Registry } from './people-life';
import { createHouseholdSimulation, advanceHouseholdSimulation, applyHouseholdCommand, serializeHouseholdSimulation, parseHouseholdSimulation, validateHouseholdSimulation,
  type HouseholdSimulation, type HouseholdSimulationResult, type HouseholdDefinition, type HouseholdCommand } from './household-simulation';

// Entirely synthetic ordinary roles/routes. These tests do not place residents,
// establish canon, or prove navigation/visibility inside Elderbloom geometry.
const START=1000000,STEP=10,A='test-a',B='test-b',C='test-c',D='test-d',all=[A,B,C,D];
const HOME='test-home',WORK='test-work';
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function accepted(result:HouseholdSimulationResult):HouseholdSimulation {assert.ok(result.ok,result.ok?'':result.error);return result.snapshot;}
function content():{events:Parameters<typeof createHouseholdSimulation>[0];definition:HouseholdDefinition}{
  const registry:Registry={places:[{id:HOME,label:'Synthetic home'},{id:WORK,label:'Synthetic workplace'}],households:[{id:'test-household',label:'Synthetic household',homePlaceId:HOME,memberIds:all}],
    residents:all.map((id,i)=>({id,label:`Synthetic resident ${i}`,identityNote:'Test-only ordinary resident.',influenceSensitivity:i%2?'persistent':'occasional',role:{id:'test-ordinary-role',label:'Synthetic role',purpose:'Exercise the same resident capabilities.'},homeHouseholdId:'test-household',
      family:{kind:'local-kin',ties:all.filter(other=>other!==id).map(residentId=>({residentId,kind:'sibling',description:'Synthetic reciprocal sibling fixture.'}))},socialTies:all.filter(other=>other!==id).map(residentId=>({residentId,description:'Synthetic reciprocal social connection.'})),decisionMemory:{source:'inherited-story-choices'},
      routine:[{startMinute:0,endMinute:480,activity:'Synthetic home interval',placeId:HOME,companionIds:[]},{startMinute:480,endMinute:1020,activity:'Synthetic work interval',placeId:WORK,companionIds:[]},{startMinute:1020,endMinute:1440,activity:'Synthetic home interval',placeId:HOME,companionIds:[]}]}))};
  const factIds=['test-a-work','test-b-work','test-a-return','test-b-return'];
  const created=createPeopleLifeEventsSnapshot(registry,{facts:factIds.map(id=>({id,subjectIds:all,initialValue:false,initiallyKnownTo:[]})),eventTypes:[{id:'test-completion',factIds,allowsFamilyRevision:false},{id:'test-family-revision',factIds:[],allowsFamilyRevision:true}],familyRules:[]},{startedAt:START,stepMilliseconds:STEP,seed:123});assert.ok(created.ok);
  const definition:HouseholdDefinition={revision:'test-household-v1',proof:'abstract-route-fixture',catalog:{schema:1,anchors:['test-home-anchor','test-work-anchor'],residents:all.map(id=>({id,householdId:'test-household'})),households:[{id:'test-household',homePlaceId:HOME}],
    places:[{id:HOME,kind:'home',anchorId:'test-home-anchor',hours:[]},{id:WORK,kind:'workplace',anchorId:'test-work-anchor',hours:[]}],resources:[
      {id:'test-door',placeId:HOME,anchorId:'test-home-anchor',kind:'entry',capacity:4,access:{kind:'public'},hours:[]},
      {id:'test-beds',placeId:HOME,anchorId:'test-home-anchor',kind:'sleep',capacity:4,access:{kind:'public'},hours:[]},
      {id:'test-seats',placeId:HOME,anchorId:'test-home-anchor',kind:'seat',capacity:4,access:{kind:'public'},hours:[]},
      {id:'test-work-slot',placeId:WORK,anchorId:'test-work-anchor',kind:'stance',capacity:1,access:{kind:'public'},hours:[]}],uses:[
      {id:'test-work-use',placeId:WORK,kind:'work',requires:[{resourceId:'test-work-slot',units:1}]},
      {id:'test-home-use',placeId:HOME,kind:'meet',requires:[{resourceId:'test-seats',units:1}]}]},
    routes:[{id:'test-out',fromPlaceId:HOME,toPlaceId:WORK,travelMinutes:3},{id:'test-back',fromPlaceId:WORK,toPlaceId:HOME,travelMinutes:2}],
    initialPlaces:all.map(residentId=>({residentId,placeId:residentId===C?WORK:HOME})),tasks:[
      {id:'test-a-job',residentId:A,routeId:'test-out',useId:'test-work-use',startsAt:1,workMinutes:4,completion:{eventId:'test-a-done',typeId:'test-completion',effects:[{factId:'test-a-work',value:true}],witnesses:[{residentId:A,knowledgeId:'test-a-self'},{residentId:C,knowledgeId:'test-c-saw-a'},{residentId:D,knowledgeId:'test-d-absent'}]}},
      {id:'test-b-job',residentId:B,routeId:'test-out',useId:'test-work-use',startsAt:1,workMinutes:2,completion:{eventId:'test-b-done',typeId:'test-completion',effects:[{factId:'test-b-work',value:true}],witnesses:[{residentId:B,knowledgeId:'test-b-self'},{residentId:C,knowledgeId:'test-c-saw-b'}]}},
      ...[A,B].map((residentId,i)=>({id:`test-${i?'b':'a'}-home`,residentId,routeId:'test-back',useId:'test-home-use',startsAt:12,workMinutes:1,completion:{eventId:`test-${i?'b':'a'}-returned`,typeId:'test-completion',effects:[{factId:`test-${i?'b':'a'}-return`,value:true}],witnesses:[{residentId,knowledgeId:`test-${i?'b':'a'}-return-self`}]}}))]};
  return{events:created.snapshot,definition};
}
function fixture(){const c=content();return accepted(createHouseholdSimulation(c.events,c.definition));}
function advance(s:HouseholdSimulation,minute:number,budget=1440){return accepted(advanceHouseholdSimulation(s,{expectedGeneration:s.generation,observedAt:START+minute*STEP,maxSteps:budget}));}
function send(s:HouseholdSimulation,c:HouseholdCommand){return accepted(applyHouseholdCommand(s,{expectedGeneration:s.generation,command:c}));}
function roundtrip(s:HouseholdSimulation){const encoded=serializeHouseholdSimulation(s);assert.ok(encoded.ok);return accepted(parseHouseholdSimulation(encoded.json,'test-household-v1'));}
const action=(s:HouseholdSimulation,id='test-a-job')=>s.actions.find(a=>a.id===id)!;

test('explicit abstract travel, capacity-one queue and sustained work precede exactly one completion',()=>{
  let s=advance(fixture(),2);assert.equal(action(s).status,'travelling');assert.equal(action(s).routeProgress,1);assert.equal(s.actors.find(a=>a.residentId===A)?.placeId,null);assert.equal(s.reservations.requests.length,0);
  assert.equal(s.events.events.length,0,'a projected home/work routine never completes work');
  s=advance(roundtrip(s),4);assert.equal(action(s).status,'working');assert.equal(action(s).workProgress,0);assert.equal(action(s,'test-b-job').status,'queued');
  assert.equal(s.reservations.requests.filter(r=>r.status==='held').length,1);assert.equal(s.events.events.length,0,'arrival and a grant still are not completion');
  s=advance(s,7);assert.equal(action(s).workProgress,3);assert.equal(s.events.events.length,0);
  s=advance(s,8);assert.equal(action(s).status,'completed');assert.equal(action(s).completedAt,8);assert.equal(action(s,'test-b-job').status,'working');
  assert.equal(s.events.events.filter(e=>e.id==='test-a-done').length,1);assert.equal(getPeopleLifeBelief(s.events,C,'test-a-work')?.basis,'witness');assert.equal(getPeopleLifeBelief(s.events,D,'test-a-work'),null);
  assert.equal(getPeopleLifeBelief(s.events,B,'test-a-work'),null,'presence alone is not an authored observation opportunity');
  s=advance(roundtrip(s),10);assert.equal(action(s,'test-b-job').completedAt,10);assert.equal(s.events.events.length,2);assert.equal(validateHouseholdSimulation(s),null);
});

test('mid-work interruption atomically resets progress/releases claim; retry does not double-complete',()=>{
  let s=roundtrip(advance(fixture(),6));assert.equal(action(s).workProgress,2);const before=JSON.stringify(s);
  s=send(s,{id:'test-interrupt',kind:'interrupt',taskId:'test-a-job'});assert.equal(action(s).status,'interrupted');assert.equal(action(s).workProgress,0);
  assert.equal(s.reservations.requests.find(r=>r.id==='test-a-job:lease:1')?.status,'cancelled');assert.equal(action(s,'test-b-job').status,'working');assert.notEqual(JSON.stringify(s),before);
  const same=send(s,{id:'test-interrupt',kind:'interrupt',taskId:'test-a-job'});assert.deepEqual(same,s,'exact command retry is idempotent');
  s=advance(roundtrip(s),9);assert.equal(s.events.events.some(e=>e.id==='test-a-done'),false);assert.equal(action(s,'test-b-job').status,'completed');
  s=send(s,{id:'test-resume',kind:'resume',taskId:'test-a-job'});assert.equal(action(s).leaseAttempt,2);assert.equal(action(s).status,'working');
  s=advance(s,13);assert.equal(action(s).completedAt,13);assert.equal(s.events.events.filter(e=>e.id==='test-a-done').length,1);
  assert.equal(s.reservations.requests.find(r=>r.id==='test-a-job:lease:2')?.status,'released');assert.ok(Object.isFrozen(s.actions[0]));
});

test('interrupting mid-route preserves transit position and never teleports or reserves',()=>{
  let s=advance(fixture(),2);s=send(s,{id:'test-route-stop',kind:'interrupt',taskId:'test-a-job'});s=advance(roundtrip(s),6);
  assert.equal(action(s).routeProgress,1);assert.equal(s.actors.find(a=>a.residentId===A)?.placeId,null);assert.equal(action(s).leaseAttempt,0);
  s=send(s,{id:'test-route-go',kind:'resume',taskId:'test-a-job'});s=advance(s,7);assert.equal(action(s).routeProgress,2);assert.equal(action(s).status,'travelling');
  s=advance(s,8);assert.equal(action(s).routeProgress,3);assert.equal(s.actors.find(a=>a.residentId===A)?.placeId,WORK);assert.equal(s.events.events.some(e=>e.id==='test-a-done'),false);
});

test('reports require actual endpoint contact; repeat reports cannot add knowledge/effects',()=>{
  let s=advance(fixture(),8);const report:HouseholdCommand={id:'test-report',kind:'report',knowledgeId:'test-d-report',recipientId:D,sourceKnowledgeId:'test-a-self',mode:'report',contactPlaceId:HOME};
  const before=JSON.stringify(s);assert.equal(applyHouseholdCommand(s,{expectedGeneration:s.generation,command:report}).ok,false);assert.equal(JSON.stringify(s),before);
  s=advance(roundtrip(s),15);assert.equal(s.actors.find(a=>a.residentId===A)?.placeId,HOME);s=send(s,report);assert.equal(getPeopleLifeBelief(s.events,D,'test-a-work')?.basis,'report');
  assert.deepEqual(s.commands[0].contact,{senderId:A,recipientId:D,placeId:HOME});
  const knowledgeCount=s.events.knowledge.length,eventCount=s.events.events.length;s=send(s,report);assert.equal(s.events.knowledge.length,knowledgeCount);
  s=send(s,{...report,id:'test-report-again',knowledgeId:'test-d-repeat'});assert.equal(s.events.knowledge.length,knowledgeCount);assert.equal(s.events.events.length,eventCount);
  assert.equal('trust'in s,false);assert.equal('standing'in s,false);assert.equal('reputation'in s,false);
});

test('a full synthetic day is identical across continuous steps, bounded away catch-up and reloads',()=>{
  const initial=fixture();let continuous=initial;for(let minute=1;minute<=1440;minute++)continuous=advance(continuous,minute,1);
  let away=advance(roundtrip(initial),1440,17);assert.equal(away.events.world.elapsedSteps,17);assert.equal(away.events.world.pendingMilliseconds,(1440-17)*STEP);
  while(away.events.world.elapsedSteps<1440)away=roundtrip(advance(away,1440,113));
  assert.deepEqual(away,continuous);assert.equal(away.events.events.length,4);assert.equal(away.reservations.requests.length,4);assert.ok(away.actions.every(a=>a.status==='completed'));
  const unchanged=advance(away,1440);assert.deepEqual(unchanged,away,'reopening at the same horizon creates no duplicate completion');
});

test('generation CAS rejects a stale second writer and forged command rewrites without partial changes',()=>{
  const initial=advance(fixture(),6),stale=initial.generation;let s=send(initial,{id:'test-writer-one',kind:'interrupt',taskId:'test-a-job'}),before=JSON.stringify(s);
  assert.equal(applyHouseholdCommand(s,{expectedGeneration:stale,command:{id:'test-writer-two',kind:'resume',taskId:'test-a-job'}}).ok,false);
  assert.equal(advanceHouseholdSimulation(s,{expectedGeneration:stale,observedAt:START+7*STEP,maxSteps:1}).ok,false);assert.equal(JSON.stringify(s),before);
  assert.equal(applyHouseholdCommand(s,{expectedGeneration:s.generation,command:{id:'test-writer-one',kind:'resume',taskId:'test-a-job'}}).ok,false);
  assert.equal(advanceHouseholdSimulation(s,{expectedGeneration:s.generation,observedAt:START+5*STEP,maxSteps:1}).ok,false);assert.equal(JSON.stringify(s),before);
  s=roundtrip(s);assert.equal(s.generation,stale+1,'the CAS generation survives restore; this does not implement a storage lock');
});

test('resource closing interrupts work and releases it instead of completing through unavailable access',()=>{
  const c=content(),d=copy(c.definition) as any;d.catalog.places[1].hours=[{start:0,end:6}];let s=accepted(createHouseholdSimulation(c.events,d));
  s=advance(s,5);assert.equal(action(s).workProgress,1);s=advance(s,6);assert.equal(action(s).status,'interrupted');assert.equal(action(s).workProgress,0);assert.equal(s.events.events.length,0);
  assert.equal(s.reservations.requests.find(r=>r.id===action(s).reservationId)?.status,'cancelled');assert.equal(action(s,'test-b-job').status,'queued');
});

test('restore rejects cross-domain clocks, orphan claims, forged progress/completion, future/revised content and hooks',()=>{
  const s=advance(fixture(),6),mutations=[
    (v:any)=>v.schemaVersion=2,(v:any)=>v.reservations.lastWorldMinute--,(v:any)=>v.reservations.schema=2,
    (v:any)=>v.actors[0].placeId=HOME,(v:any)=>v.actions[0].routeProgress=0,(v:any)=>v.actions[0].leaseAttempt=Number.MAX_SAFE_INTEGER,
    (v:any)=>v.actions[0].status='completed',(v:any)=>v.actions[1].workProgress=1,(v:any)=>v.actions.push(copy(v.actions[0])),
    (v:any)=>v.reservations.requests[0].id='test-orphan',(v:any)=>v.definition.proof='real-elderbloom-navigation',
    (v:any)=>v.actors[0].sourceKnown=true,(v:any)=>v.standing=10,
    (v:any)=>v.actors[3].placeId=WORK,
  ];
  for(const mutate of mutations){const v=copy(s);mutate(v);assert.notEqual(validateHouseholdSimulation(v),null);}
  const encoded=serializeHouseholdSimulation(s);assert.ok(encoded.ok);assert.equal(parseHouseholdSimulation(encoded.json,'another-content-revision').ok,false);assert.equal(parseHouseholdSimulation('{').ok,false);
  let reads=0;const poisoned=copy(s) as any;Object.defineProperty(poisoned,'generation',{enumerable:true,get(){reads++;return 1;}});assert.notEqual(validateHouseholdSimulation(poisoned),null);
  const input:any={observedAt:START+7*STEP,maxSteps:1};Object.defineProperty(input,'expectedGeneration',{enumerable:true,get(){reads++;return s.generation;}});assert.equal(advanceHouseholdSimulation(s,input).ok,false);
  const hook=copy(s) as any;hook.toJSON=()=>{reads++;return{};};assert.equal(serializeHouseholdSimulation(hook).ok,false);assert.equal(reads,0,'untrusted getters/serialization hooks never execute');
});

test('creation copies caller content, preserves original life state, and rejects missing route/access links',()=>{
  const c=content(),before=JSON.stringify(c),s=accepted(createHouseholdSimulation(c.events,c.definition));assert.equal(JSON.stringify(c),before);assert.equal(Object.isFrozen(c.definition),false);assert.ok(Object.isFrozen(s.definition.catalog.resources[0]));
  const bad=copy(c.definition) as any;bad.routes[0].toPlaceId=HOME;assert.equal(createHouseholdSimulation(c.events,bad).ok,false);
  const privateUse=copy(c.definition) as any;privateUse.catalog.resources[3].access={kind:'residents',ids:[C]};assert.equal(createHouseholdSimulation(c.events,privateUse).ok,false);
  assert.equal(s.definition.proof,'abstract-route-fixture');assert.equal(s.events.world.elapsedSteps,0);assert.equal(s.events.events.length,0);
});

test('saved contact evidence and route histories remain part of the same validated aggregate',()=>{
  let s=advance(fixture(),15);s=send(s,{id:'test-contact-proof',kind:'report',knowledgeId:'test-delivered',recipientId:D,sourceKnowledgeId:'test-a-self',mode:'report',contactPlaceId:HOME});assert.deepEqual(roundtrip(s),s);
  for(const mutate of [(v:any)=>v.commands[0].contact.senderId=B,(v:any)=>v.commands[0].contact.placeId=WORK,(v:any)=>v.commands[0].atMinute=1,(v:any)=>v.actions.find((a:any)=>a.id==='test-a-home').completedAt=9]){
    const bad=copy(s);mutate(bad);assert.notEqual(validateHouseholdSimulation(bad),null);
  }
  const interrupted=send(advance(fixture(),6),{id:'test-proof-stop',kind:'interrupt',taskId:'test-a-job'}),bad=copy(interrupted) as any;
  bad.actions[0].routeProgress=1;bad.actors[0].placeId=null;assert.notEqual(validateHouseholdSimulation(bad),null,'a previous lease cannot be kept as fabricated transit history');
});

test('paired contact relabels, backdating and forged motion cannot bypass historical endpoint evidence',()=>{
  let s=advance(fixture(),15);s=send(s,{id:'test-historical-report',kind:'report',knowledgeId:'test-history-delivered',recipientId:D,sourceKnowledgeId:'test-a-self',mode:'report',contactPlaceId:HOME});
  const mutations=[(v:any)=>{v.commands[0].command.contactPlaceId=WORK;v.commands[0].contact.placeId=WORK;},
    (v:any)=>v.commands[0].atMinute=10,(v:any)=>v.motion[0].atMinute=3,(v:any)=>v.motion.splice(v.motion.findIndex((m:any)=>m.taskId==='test-a-job'&&m.kind==='arrive'),1),
    (v:any)=>v.events.events.find((e:any)=>e.id==='test-a-done').presence.find((p:any)=>p.residentId===D).placeId=WORK];
  for(const mutate of mutations){const v=copy(s);mutate(v);assert.notEqual(validateHouseholdSimulation(v),null);}
});

test('current household access changes require catalog migration; unrelated kin-only revision remains supported',()=>{
  const c=content(),revision=copy(c.events.registry) as any;
  revision.households[0].memberIds=all.filter(id=>id!==D);revision.households.push({id:'test-other-household',label:'Synthetic revised household',homePlaceId:HOME,memberIds:[D]});revision.residents[3].homeHouseholdId='test-other-household';
  const moved=recordPeopleLifeFamilyRevision(c.events,{id:'test-household-move',typeId:'test-family-revision',atStep:0,actorIds:[D],placeId:HOME,effects:[],presence:[{residentId:D,placeId:HOME}],witnesses:[]},revision);assert.ok(moved.ok);
  assert.equal(createHouseholdSimulation(moved.snapshot,c.definition).ok,false,'old home/access catalog cannot authorize the new membership');
  const initial=fixture(),stale=copy(initial) as any;stale.events=moved.snapshot;assert.notEqual(validateHouseholdSimulation(stale),null,'restore cannot retain stale household permissions either');
  const kin=copy(c.events.registry) as any;kin.residents[0].family.ties.find((t:any)=>t.residentId===B).kind='other';kin.residents[1].family.ties.find((t:any)=>t.residentId===A).kind='other';
  const related=recordPeopleLifeFamilyRevision(c.events,{id:'test-kin-revision',typeId:'test-family-revision',atStep:0,actorIds:[A,B],placeId:HOME,effects:[],presence:[{residentId:A,placeId:HOME},{residentId:B,placeId:HOME}],witnesses:[]},kin);assert.ok(related.ok);
  const supported=accepted(createHouseholdSimulation(related.snapshot,c.definition));assert.equal(validateHouseholdSimulation(advance(supported,10)),null);
});

test('a fresh live command cannot be backdated into still-deferred away time',()=>{
  const pending=advance(fixture(),1440,3),before=JSON.stringify(pending);assert.equal(pending.events.world.elapsedSteps,3);
  const rejected=applyHouseholdCommand(pending,{expectedGeneration:pending.generation,command:{id:'test-future-input',kind:'interrupt',taskId:'test-a-job'}});
  assert.equal(rejected.ok,false);assert.equal(JSON.stringify(pending),before);
});

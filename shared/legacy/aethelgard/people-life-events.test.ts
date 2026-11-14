import assert from 'node:assert/strict';
import test from 'node:test';
import { createPeopleLifeEventsSnapshot, catchUpPeopleLifeEvents, recordPeopleLifeOccurrence, recordPeopleLifeFamilyRevision, transmitPeopleLifeKnowledge, recordPeopleLifeFamilyDecision,
  selectPeopleLifeFamilyIntent, getPeopleLifeBelief, getPeopleLifeWorldPlan, getPeopleLifeEventsRegistry, getPeopleLifePerceivedRegistry, getPeopleLifeCatchupStatus, validatePeopleLifeEventsSnapshot,
  type PeopleLifeEventsSnapshot, type PeopleLifeEventsResult, type PeopleLifeEventModel, type PeopleLifeOccurrenceCommand } from './people-life-events';
import { serializePeopleLifeEventsSnapshot, parsePeopleLifeEventsSnapshot } from './people-life-events-snapshot';
import type { PeopleLifeRegistry } from './people-life';
// Synthetic connected household/workplace proof only, never a proposed roster.
const A='test-a',B='test-b',C='test-c',all=[A,B,C],START=1000000,STEP=10;
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function registry():PeopleLifeRegistry {
  return{places:[{id:'test-home',label:'Synthetic home'},{id:'test-work',label:'Synthetic workplace'},{id:'test-other-home',label:'Synthetic second home'}],
    households:[{id:'test-household',label:'Synthetic household',homePlaceId:'test-home',memberIds:all}],residents:all.map((id,i)=>({id,label:`Synthetic ${i}`,identityNote:'Test-only resident identity.',influenceSensitivity:i===1?'persistent':'occasional',role:{id:'test-role',label:'Synthetic role',purpose:'Test ordinary resident behavior.'},homeHouseholdId:'test-household',
      family:{kind:'local-kin',ties:all.filter(p=>p!==id).map(other=>({residentId:other,kind:id===A?'child':other===A?'parent':'sibling',description:'Synthetic reciprocal kin relation.'}))},
      socialTies:all.filter(p=>p!==id).map(residentId=>({residentId,description:'Synthetic reciprocal social connection.'})),decisionMemory:{source:'inherited-story-choices'},routine:[
        {startMinute:0,endMinute:480,activity:'At home',placeId:'test-home',companionIds:[]},{startMinute:480,endMinute:1020,activity:'At work',placeId:'test-work',companionIds:[]},{startMinute:1020,endMinute:1440,activity:'At home',placeId:'test-home',companionIds:[]},
      ]}))};
}
function model():PeopleLifeEventModel {return{
  facts:[{id:'test-care-needed',subjectIds:[B],initialValue:false,initiallyKnownTo:all}],
  eventTypes:[{id:'test-care-event',factIds:['test-care-needed'],allowsFamilyRevision:false},{id:'test-household-event',factIds:[],allowsFamilyRevision:true}],
  familyRules:[{id:'test-care-rule',residentId:A,relativeId:B,relation:'kin',purpose:'care',placeId:'test-home',startMinute:0,endMinute:1440,conditions:[{factId:'test-care-needed',value:true,certainty:'witness-or-report'}]},
    {id:'test-meal-rule',residentId:B,relativeId:C,relation:'household',purpose:'shared-meal',placeId:'test-home',startMinute:720,endMinute:780,conditions:[]},
    {id:'test-visit-rule',residentId:A,relativeId:C,relation:'kin',purpose:'visit',placeId:'test-other-home',startMinute:1200,endMinute:1260,conditions:[{factId:'test-care-needed',value:false,certainty:'witness-or-report'}]}],
};}
function accepted(r:PeopleLifeEventsResult):PeopleLifeEventsSnapshot {assert.ok(r.ok,r.ok?'':r.error);return r.snapshot;}
const fixture=()=>accepted(createPeopleLifeEventsSnapshot(registry(),model(),{startedAt:START,stepMilliseconds:STEP,seed:123}));
function advance(s:PeopleLifeEventsSnapshot,minute:number,budget=1440){return accepted(catchUpPeopleLifeEvents(s,START+minute*STEP,budget));}
function occurrence(s:PeopleLifeEventsSnapshot,id:string,value:boolean):PeopleLifeOccurrenceCommand {return{id,typeId:'test-care-event',atStep:s.world.elapsedSteps,actorIds:[B],placeId:'test-home',effects:[{factId:'test-care-needed',value}],presence:[{residentId:B,placeId:'test-home'}],witnesses:[{knowledgeId:`${id}-witness`,residentId:B}]};}
function inform(s:PeopleLifeEventsSnapshot,id:string,recipientId:string,sourceKnowledgeId:string,mode:'report'|'rumor'='report'){return accepted(transmitPeopleLifeKnowledge(s,{id,recipientId,sourceKnowledgeId,mode,atStep:s.world.elapsedSteps}));}
function roundtrip(s:PeopleLifeEventsSnapshot){const encoded=serializePeopleLifeEventsSnapshot(s);assert.ok(encoded.ok);return accepted(parsePeopleLifeEventsSnapshot(encoded.json));}
test('occurred truth is separate from witness/report/rumor knowledge and never silently updates beliefs',()=>{
  let s=advance(fixture(),600);const before=JSON.stringify(s),command=occurrence(s,'care-start',true);s=accepted(recordPeopleLifeOccurrence(s,command));
  assert.equal(s.facts[0].value,true);assert.equal(getPeopleLifeBelief(s,A,'test-care-needed')?.value,false);assert.equal(selectPeopleLifeFamilyIntent(s,A),null);
  assert.equal(getPeopleLifeWorldPlan(s,A)?.placeId,'test-work');s=inform(s,'rumor-a',A,'care-start-witness','rumor');
  assert.equal(getPeopleLifeBelief(s,A,'test-care-needed')?.value,false);assert.equal(getPeopleLifeBelief(s,A,'test-care-needed',true)?.basis,'rumor');assert.equal(selectPeopleLifeFamilyIntent(s,A),null);
  const bad=transmitPeopleLifeKnowledge(s,{id:'rumor-promoted',recipientId:C,sourceKnowledgeId:'rumor-a',mode:'report',atStep:600});assert.equal(bad.ok,false);
  s=inform(s,'report-a',A,'care-start-witness');assert.equal(selectPeopleLifeFamilyIntent(s,A)?.purpose,'care');
  const eventCount=s.events.length,truth=JSON.stringify(s.facts);s=accepted(recordPeopleLifeFamilyDecision(s,{id:'care-intent',residentId:A,atStep:600}));
  assert.equal(s.events.length,eventCount);assert.equal(JSON.stringify(s.facts),truth,'choosing care does not complete care or create an event');
  s=advance(s,660);s=accepted(recordPeopleLifeOccurrence(s,occurrence(s,'care-clear',false)));
  assert.equal(s.facts[0].value,false);assert.equal(selectPeopleLifeFamilyIntent(s,A)?.purpose,'care','unknown newer truth is not omniscient knowledge');
  s=inform(s,'clear-report-a',A,'care-clear-witness');assert.equal(selectPeopleLifeFamilyIntent(s,A),null);assert.notEqual(JSON.stringify(s),before);
  assert.equal(validatePeopleLifeEventsSnapshot(s),null);assert.deepEqual(roundtrip(s),s);
});
test('witnesses require explicit evidence; projected routine co-location proves nothing',()=>{
  const s=fixture(),command=occurrence(s,'test-event',true),before=JSON.stringify(s);
  assert.equal(recordPeopleLifeOccurrence(s,{...command,witnesses:[{knowledgeId:'fake-witness',residentId:A}]}).ok,false);
  assert.equal(recordPeopleLifeOccurrence(s,{...command,presence:[]}).ok,false);
  assert.equal(recordPeopleLifeOccurrence(s,{...command,effects:[{factId:'unregistered',value:true}]}).ok,false);
  assert.equal(recordPeopleLifeOccurrence(s,{...command,typeId:'unregistered'}).ok,false);
  assert.equal(transmitPeopleLifeKnowledge(s,{id:'fake-report',recipientId:A,sourceKnowledgeId:'missing',mode:'report',atStep:0}).ok,false);
  assert.equal(JSON.stringify(s),before);
});
function revisedRegistry(s:PeopleLifeEventsSnapshot):PeopleLifeRegistry {
  const r=copy(getPeopleLifeEventsRegistry(s))as any;r.households[0].memberIds=[A,B];r.households.push({id:'test-second-household',label:'Synthetic second household',homePlaceId:'test-other-home',memberIds:[C]});
  const c=r.residents.find((p:any)=>p.id===C);c.homeHouseholdId='test-second-household';c.routine=c.routine.map((slot:any)=>({...slot,placeId:slot.placeId==='test-home'?'test-other-home':slot.placeId}));return r;
}
function revisionCommand(s:PeopleLifeEventsSnapshot):PeopleLifeOccurrenceCommand {return{id:'family-change',typeId:'test-household-event',atStep:s.world.elapsedSteps,actorIds:[C],placeId:'test-other-home',effects:[],presence:[{residentId:C,placeId:'test-other-home'}],witnesses:[{knowledgeId:'family-change-witness',residentId:C}]};}
test('one connected household/workplace full day: interruption, revised home ties, away catch-up and exact save/reload',()=>{
  let s=advance(fixture(),600);s=accepted(recordPeopleLifeOccurrence(s,occurrence(s,'day-care-start',true)));s=inform(s,'day-care-report',A,'day-care-start-witness');
  s=accepted(recordPeopleLifeFamilyDecision(s,{id:'day-care-intent',residentId:A,atStep:600}));assert.equal(selectPeopleLifeFamilyIntent(s,A)?.purpose,'care');
  s=advance(s,660);s=accepted(recordPeopleLifeOccurrence(s,occurrence(s,'day-care-clear',false)));s=inform(s,'day-clear-report',A,'day-care-clear-witness');
  s=advance(s,730);assert.equal(selectPeopleLifeFamilyIntent(s,B)?.purpose,'shared-meal');s=accepted(recordPeopleLifeFamilyDecision(s,{id:'day-meal-intent',residentId:B,atStep:730}));
  const revision=revisedRegistry(s),command=revisionCommand(s);s=accepted(recordPeopleLifeFamilyRevision(s,command,revision));
  assert.equal(getPeopleLifeEventsRegistry(s).residents.find(r=>r.id===C)?.homeHouseholdId,'test-second-household');
  assert.equal(selectPeopleLifeFamilyIntent(s,B)?.purpose,'shared-meal','unknown household change does not telepathically change another person plan');
  s=inform(s,'day-family-report',B,'family-change-witness');assert.equal(selectPeopleLifeFamilyIntent(s,B),null,'known changed co-residence changes the family choice');
  assert.deepEqual(roundtrip(s),s);assert.equal(recordPeopleLifeFamilyRevision(s,command,revision).ok,true,'an exact prior revision retries idempotently');
  const baseline=s,continuous=advance(baseline,1440),away=catchUpPeopleLifeEvents(baseline,START+1440*STEP,55);assert.ok(away.ok);assert.equal(away.processedSteps,55);assert.equal(away.deferredSteps,655);assert.equal(away.deferredMilliseconds,6550);
  s=roundtrip(away.snapshot);const atVisit=catchUpPeopleLifeEvents(s,START+1440*STEP,420);assert.ok(atVisit.ok);s=atVisit.snapshot;
  assert.equal(s.world.elapsedSteps,1205);assert.equal(selectPeopleLifeFamilyIntent(s,A)?.purpose,'visit','the world routine/intent progresses during absence');
  assert.equal(getPeopleLifeWorldPlan(s,C)?.placeId,'test-other-home');
  while(getPeopleLifeCatchupStatus(s).deferredSteps){const next=catchUpPeopleLifeEvents(s,START+1440*STEP,80);assert.ok(next.ok);s=roundtrip(next.snapshot);}
  assert.deepEqual(s,continuous);assert.equal(s.world.elapsedSteps,1440);assert.equal(s.world.pendingMilliseconds,0);assert.equal(s.world.seed,123);
  assert.equal(s.events.length,3,'clock advancement does not fabricate completed actions/events');assert.equal(s.decisions.length,2);assert.ok(Object.isFrozen(s.events[0].presence[0]));
});
test('catch-up retains every deferred/fractional millisecond and rejects backward or unbounded time',()=>{
  const base=fixture(),capped=catchUpPeopleLifeEvents(base,START+50005,3);assert.ok(capped.ok);assert.equal(capped.snapshot.world.elapsedSteps,3);assert.equal(capped.deferredMilliseconds,49975);assert.equal(capped.fractionalMilliseconds,5);
  const reloaded=roundtrip(capped.snapshot);assert.deepEqual(getPeopleLifeCatchupStatus(reloaded),getPeopleLifeCatchupStatus(capped.snapshot));
  for(const [at,budget]of [[START-1,1],[START,0],[START,1441],[Infinity,1],[START,1.5]])assert.equal(catchUpPeopleLifeEvents(base,at,budget).ok,false);
  assert.equal(catchUpPeopleLifeEvents(reloaded,START+50004,3).ok,false);assert.equal(base.world.elapsedSteps,0);
});
test('events, knowledge and selected intents are immutable, idempotent and atomically reject rewrites',()=>{
  let s=advance(fixture(),600);const command=occurrence(s,'once',true);s=accepted(recordPeopleLifeOccurrence(s,command));const before=JSON.stringify(s);
  assert.equal(accepted(recordPeopleLifeOccurrence(s,command)),s);assert.equal(recordPeopleLifeOccurrence(s,{...command,effects:[{factId:'test-care-needed',value:false}]}).ok,false);
  s=inform(s,'once-report',A,'once-witness');const withReport=JSON.stringify(s);assert.equal(inform(s,'once-report',A,'once-witness'),s);
  assert.equal(transmitPeopleLifeKnowledge(s,{id:'once-report',recipientId:C,sourceKnowledgeId:'once-witness',mode:'report',atStep:600}).ok,false);assert.equal(JSON.stringify(s),withReport);
  s=accepted(recordPeopleLifeFamilyDecision(s,{id:'once-decision',residentId:A,atStep:600}));assert.equal(accepted(recordPeopleLifeFamilyDecision(s,{id:'once-decision',residentId:A,atStep:600})),s);
  assert.equal(recordPeopleLifeFamilyDecision(s,{id:'once-decision',residentId:B,atStep:600}).ok,false);assert.notEqual(JSON.stringify(s),before);
});
test('family changes preserve identity, ordinary-role capabilities, registered places and explicit participants',()=>{
  const s=advance(fixture(),730),revision=revisedRegistry(s),command=revisionCommand(s),before=JSON.stringify(s);
  const bad=copy(revision)as any;bad.residents[2].role.label='Different role';assert.equal(recordPeopleLifeFamilyRevision(s,command,bad).ok,false);
  assert.equal(recordPeopleLifeFamilyRevision(s,{...command,actorIds:[B],presence:[{residentId:B,placeId:'test-other-home'},{residentId:C,placeId:'test-other-home'}]},revision).ok,false);
  const unknown=copy(revision)as any;unknown.residents[2].sourceKnown=true;assert.equal(recordPeopleLifeFamilyRevision(s,command,unknown).ok,false);
  assert.equal(JSON.stringify(s),before);
});
test('snapshot round-trip rejects corrupt/future/inherited/progression data without executing hooks',()=>{
  let s=advance(fixture(),600);s=accepted(recordPeopleLifeOccurrence(s,occurrence(s,'parsed',true)));
  for(const change of [(v:any)=>v.schemaVersion=2,(v:any)=>v.world.pendingMilliseconds++,(v:any)=>v.facts[0].value=false,
    (v:any)=>v.knowledge[0].sourceKnowledgeId='fictional-source',(v:any)=>v.events[0].witnesses[0].residentId=A,(v:any)=>v.standing=20,(v:any)=>v.world.currency=5]){
    const value=copy(s);change(value);assert.equal(parsePeopleLifeEventsSnapshot(JSON.stringify(value)).ok,false);
  }
  assert.equal(parsePeopleLifeEventsSnapshot('{bad').ok,false);assert.equal(parsePeopleLifeEventsSnapshot(JSON.stringify({kind:'inherited-aethelgard',schemaVersion:1})).ok,false);
  const value=copy(s)as any;let reads=0;Object.defineProperty(value.facts[0],'value',{enumerable:true,get(){reads++;return true;}});assert.equal(serializePeopleLifeEventsSnapshot(value).ok,false);assert.equal(reads,0);
  const sparse=copy(s)as any;delete sparse.events[0].presence[0];assert.equal(validatePeopleLifeEventsSnapshot(sparse)!==null,true);
  const functionFact=copy(s)as any;functionFact.facts[0].id={toJSON(){reads++;return'test-care-needed';}};assert.equal(serializePeopleLifeEventsSnapshot(functionFact).ok,false);assert.equal(reads,0);
});

test('witnessing a later family revision does not disclose an unrelated earlier unknown revision',()=>{
  let s=advance(fixture(),730);s=accepted(recordPeopleLifeFamilyRevision(s,revisionCommand(s),revisedRegistry(s)));
  const next=copy(getPeopleLifeEventsRegistry(s))as any;next.residents.find((r:any)=>r.id===B).routine[1].activity='Synthetic changed workplace intention';
  s=accepted(recordPeopleLifeFamilyRevision(s,{id:'later-revision',typeId:'test-household-event',atStep:730,actorIds:[B],placeId:'test-home',effects:[],
    presence:[{residentId:A,placeId:'test-home'},{residentId:B,placeId:'test-home'}],witnesses:[{knowledgeId:'later-revision-witness',residentId:A}]},next));
  const view=getPeopleLifePerceivedRegistry(s,A);assert.equal(view.residents.find(r=>r.id===C)?.homeHouseholdId,'test-household');
  assert.equal(view.residents.find(r=>r.id===B)?.routine[1].activity,'Synthetic changed workplace intention');
  assert.equal(getPeopleLifeEventsRegistry(s).residents.find(r=>r.id===C)?.homeHouseholdId,'test-second-household');assert.deepEqual(roundtrip(s),s);
});

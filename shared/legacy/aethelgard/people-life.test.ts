import assert from 'node:assert/strict';
import test from 'node:test';
import { createPeopleLifeRegistry, validatePeopleLifeRegistry, getPeopleLifeDecisionMemory, getPeopleLifeRoutine, findPeopleLifeResident, PEOPLE_LIFE_COMPATIBILITY_PERSON_IDS, PEOPLE_LIFE_INFLUENCE_SOURCE, type PeopleLifeRegistry } from './people-life';
import { EALDHOLT_PEOPLE_DRAFT, createEaldholtDraftChoice } from './people-draft';
// Synthetic test data only: no proposed roster, names, families or world canon.
function fixture():PeopleLifeRegistry {
  const ids=['test-resident-a','test-resident-b'];
  return{places:[{id:'test-home',label:'Test home'},{id:'test-work',label:'Test workplace'}],households:[{id:'test-household',label:'Test household',homePlaceId:'test-home',memberIds:ids}],residents:ids.map((id,i)=>({
    id,label:`Test person ${i}`,identityNote:'Authored synthetic identity for validation only.',influenceSensitivity:'occasional',role:{id:'test-role',label:'Test role',purpose:'A supplied purpose for this synthetic role.'},homeHouseholdId:'test-household',
    family:{kind:'local-kin',ties:[{residentId:ids[1-i],kind:i===0?'parent':'child',description:'Synthetic reciprocal family relation.'}]},socialTies:[{residentId:ids[1-i],description:'Synthetic social connection with its own authored description.'}],
    routine:[{startMinute:0,endMinute:480,activity:'At home',placeId:'test-home',companionIds:[]},{startMinute:480,endMinute:960,activity:'At the workplace',placeId:'test-work',companionIds:[]},{startMinute:960,endMinute:1440,activity:'At home',placeId:'test-home',companionIds:[]}],decisionMemory:{source:'inherited-story-choices'},
  }))};
}
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
test('complete authored registry is copied/frozen and routines project exact interval boundaries',()=>{
  const input=fixture(),before=JSON.stringify(input),result=createPeopleLifeRegistry(input);assert.ok(result.ok);
  assert.equal(JSON.stringify(input),before);assert.notEqual(result.registry,input);assert.ok(Object.isFrozen(result.registry.residents[0].routine[0]));assert.ok(!Object.isFrozen(input));
  const id=input.residents[0].id;assert.equal(getPeopleLifeRoutine(result.registry,id,479.99)?.placeId,'test-home');assert.equal(getPeopleLifeRoutine(result.registry,id,480)?.placeId,'test-work');assert.equal(getPeopleLifeRoutine(result.registry,id,960)?.placeId,'test-home');
  for(const minute of [-1,1440,NaN,Infinity])assert.equal(getPeopleLifeRoutine(result.registry,id,minute),null);
  assert.equal(findPeopleLifeResident(result.registry,'unregistered'),null);assert.equal(getPeopleLifeRoutine(result.registry,'unregistered',0),null);
});
test('missing life fields, anonymous fallbacks and progression extras are rejected',()=>{
  for(const field of ['id','label','identityNote','influenceSensitivity','role','homeHouseholdId','family','socialTies','routine','decisionMemory']){
    const value=copy(fixture())as any;delete value.residents[0][field];assert.ok(validatePeopleLifeRegistry(value),field);
  }
  for(const [field,value]of [['label',''],['socialTies',[]],['routine',[]],['decisionMemory',{source:'invented-trust'}],['standing',99]]as const){const input=copy(fixture())as any;input.residents[0][field]=value;assert.ok(validatePeopleLifeRegistry(input));}
  const input=copy(fixture())as any;input.currency=100;assert.ok(validatePeopleLifeRegistry(input));
});
test('home membership, kin and social references must be consistent and explicit',()=>{
  const invalid=[(v:any)=>v.residents.push(v.residents[0]),(v:any)=>v.households[0].memberIds.pop(),(v:any)=>v.households[0].memberIds.push('missing'),
    (v:any)=>v.residents[0].homeHouseholdId='missing',(v:any)=>v.residents[0].family.ties[0].kind='sibling',(v:any)=>v.residents[0].family.ties[0].residentId=v.residents[0].id,
    (v:any)=>v.residents[0].socialTies[0].residentId='missing',(v:any)=>v.residents[0].socialTies.push(v.residents[0].socialTies[0])];
  for(const change of invalid){const value=copy(fixture());change(value);assert.ok(validatePeopleLifeRegistry(value));}
});
test('authored family absence permits unmarried/solitary residents without inventing relatives',()=>{
  const input=copy(fixture())as any;for(const r of input.residents)r.family={kind:'no-local-kin',explanation:'This synthetic person has no local relatives and maintains the listed social tie.'};
  assert.equal(validatePeopleLifeRegistry(input),null);
  for(const explanation of ['', 'unknown','TBD','not established']){input.residents[0].family.explanation=explanation;assert.ok(validatePeopleLifeRegistry(input));}
});
test('routines reject gaps, overlap, unregistered places and contradictory companionship',()=>{
  for(const change of [(v:any)=>v.residents[0].routine[1].startMinute=479,(v:any)=>v.residents[0].routine[1].startMinute=481,(v:any)=>v.residents[0].routine[2].endMinute=1439,
    (v:any)=>v.residents[0].routine[0].placeId='missing',(v:any)=>v.residents[0].routine[0].companionIds=['missing'],(v:any)=>v.residents[0].routine[0].companionIds=[v.residents[1].id]]){
    const input=copy(fixture());change(input);assert.ok(validatePeopleLifeRegistry(input));
  }
  const input=copy(fixture())as any;input.residents.forEach((r:any,i:number)=>{r.routine[0].companionIds=[input.residents[1-i].id];});assert.equal(validatePeopleLifeRegistry(input),null);
});
test('content validation refuses accessors/sparse arrays without executing them or mutating input',()=>{
  const input=copy(fixture())as any;let calls=0;Object.defineProperty(input.residents[0],'label',{enumerable:true,get(){calls++;return'fake';}});assert.ok(validatePeopleLifeRegistry(input));assert.equal(calls,0);
  const sparse=copy(fixture())as any;delete sparse.residents[0].routine[0];assert.ok(validatePeopleLifeRegistry(sparse));
});
test('three existing IDs are compatibility metadata within an unrestricted equal-capability resident registry',()=>{
  assert.deepEqual(PEOPLE_LIFE_COMPATIBILITY_PERSON_IDS,EALDHOLT_PEOPLE_DRAFT.map(p=>p.id));
  assert.equal(validatePeopleLifeRegistry({places:[],households:[],residents:[]}),null,'preparation does not silently populate the village');
  const input=copy(fixture())as any,template=input.residents[0],ids=Array.from({length:43},(_,i)=>`synthetic-${i}`);input.households[0].memberIds=ids;
  input.residents=ids.map((id,i)=>({...copy(template),id,label:`Synthetic ${i}`,family:{kind:'no-local-kin',explanation:'Synthetic family absence supplied for this test.'},socialTies:[{residentId:ids[(i+1)%ids.length],description:'Synthetic neighboring connection.'},{residentId:ids[(i+ids.length-1)%ids.length],description:'Synthetic neighboring connection from the other side.'}]}));
  assert.equal(validatePeopleLifeRegistry(input),null,'test count is not a product population recommendation or limit');
});
test('decision memory reads real selected options and participants without writing session or registry',()=>{
  const input=copy(fixture())as any,person=EALDHOLT_PEOPLE_DRAFT[0],oldId=input.residents[0].id;input.residents[0].id=person.id;input.households[0].memberIds[0]=person.id;
  input.residents[1].family.ties[0].residentId=person.id;input.residents[1].socialTies[0].residentId=person.id;
  const made=createPeopleLifeRegistry(input);assert.ok(made.ok);assert.notEqual(oldId,person.id);
  const built=createEaldholtDraftChoice(person.id,person.decision.options[0].id,'2026-11-06T12:00:00.000Z');assert.ok(built.ok);
  const session={choices:[built.choice]},before=JSON.stringify({session,registry:made.registry});
  const memories=getPeopleLifeDecisionMemory(made.registry,person.id,session);assert.equal(memories?.length,1);assert.equal(memories?.[0].responseLabel,person.decision.options[0].label);assert.ok(Object.isFrozen(memories?.[0]));
  assert.deepEqual(getPeopleLifeDecisionMemory(made.registry,person.id,null),[]);assert.deepEqual(getPeopleLifeDecisionMemory(made.registry,person.id,{choices:[{...built.choice,optionId:'unknown'}]}),[]);
  assert.deepEqual(getPeopleLifeDecisionMemory(made.registry,person.id,{choices:[{...built.choice,personIds:[]}]}),[]);assert.equal(getPeopleLifeDecisionMemory(made.registry,'missing',session),null);
  const ordinaryId=made.registry.residents[1].id,sharedRecord={choices:[{...built.choice,personIds:[person.id,ordinaryId]}]};
  assert.deepEqual(getPeopleLifeDecisionMemory(made.registry,ordinaryId,sharedRecord),getPeopleLifeDecisionMemory(made.registry,person.id,sharedRecord),
    'ordinary and compatibility-ID participants have identical memory capabilities');
  assert.equal(JSON.stringify({session,registry:made.registry}),before);
});

test('reciprocal family labels cannot disguise a parent/child ancestry cycle',()=>{
  const input=copy(fixture())as any,template=input.residents[0],ids=['synthetic-cycle-a','synthetic-cycle-b','synthetic-cycle-c'];input.households[0].memberIds=ids;
  input.residents=ids.map((id,i)=>({...copy(template),id,family:{kind:'local-kin',ties:[{residentId:ids[(i+1)%3],kind:'child',description:'Synthetic cycle edge.'},{residentId:ids[(i+2)%3],kind:'parent',description:'Synthetic reciprocal cycle edge.'}]},socialTies:[{residentId:ids[(i+1)%3],description:'Synthetic tie.'},{residentId:ids[(i+2)%3],description:'Synthetic reciprocal tie.'}]}));
  assert.match(validatePeopleLifeRegistry(input)!,/ancestry.*cycle/);
});

test('sensitivity is required and role-neutral while source identification and player-resident fields stay unavailable',()=>{
  assert.equal(PEOPLE_LIFE_INFLUENCE_SOURCE,'unknown');
  for(const sensitivity of ['occasional','persistent']){
    const input=copy(fixture())as any;for(const resident of input.residents)resident.influenceSensitivity=sensitivity;
    const result=createPeopleLifeRegistry(input);assert.ok(result.ok);assert.ok(result.registry.residents.every(r=>r.influenceSensitivity===sensitivity));
  }
  for(const sensitivity of [undefined,null,'never','known-source','seer',true]){
    const input=copy(fixture())as any;input.residents[0].influenceSensitivity=sensitivity;assert.ok(validatePeopleLifeRegistry(input));
  }
  for(const [field,value]of [['influenceSource','player'],['sourceKnown',true],['playerAsResident',true],['isPlayer',true],['awareness','knows-player']]as const){
    const input=copy(fixture())as any;input.residents[0][field]=value;assert.ok(validatePeopleLifeRegistry(input));
  }
});

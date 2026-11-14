import assert from 'node:assert/strict';
import test from 'node:test';
import { createPeopleLifeClock, stepPeopleLifeClock, getPeopleLifeDay, PEOPLE_LIFE_MAX_STEP_MILLISECONDS } from './people-life-clock';
import { createPeopleLifeRegistry, getPeopleLifeRoutine } from './people-life';
test('clock consumes only explicit active visit time and ignores arbitrarily long absence',()=>{
  let clock=createPeopleLifeClock(144000);const before=JSON.stringify(clock);assert.deepEqual(getPeopleLifeDay(clock),{dayIndex:0,dayMinute:0});
  for(const state of ['paused','hidden','away']as const){const held=stepPeopleLifeClock(clock,{state,elapsedMilliseconds:86400000});assert.deepEqual(held,clock);assert.ok(Object.isFrozen(held));}
  assert.equal(JSON.stringify(clock),before);
  clock=stepPeopleLifeClock(clock,{state:'active',elapsedMilliseconds:750});assert.deepEqual(getPeopleLifeDay(clock),{dayIndex:0,dayMinute:7.5});
  clock=stepPeopleLifeClock(clock,{state:'paused',elapsedMilliseconds:750});clock=stepPeopleLifeClock(clock,{state:'active',elapsedMilliseconds:250});
  assert.equal(clock.activeMilliseconds,1000);assert.equal(getPeopleLifeDay(clock).dayMinute,10);
});
test('day wrap and equivalent active frame partitions are deterministic without generated events',()=>{
  let a=createPeopleLifeClock(1440),b=createPeopleLifeClock(1440);
  a=stepPeopleLifeClock(a,{state:'active',elapsedMilliseconds:1000});a=stepPeopleLifeClock(a,{state:'active',elapsedMilliseconds:500});
  for(let i=0;i<15;i++)b=stepPeopleLifeClock(b,{state:'active',elapsedMilliseconds:100});
  assert.deepEqual(a,b);assert.deepEqual(getPeopleLifeDay(a),{dayIndex:1,dayMinute:60});
  assert.deepEqual(Object.keys(a).sort(),['activeMilliseconds','dayLengthMilliseconds']);assert.deepEqual(Object.keys(getPeopleLifeDay(a)).sort(),['dayIndex','dayMinute']);
});
test('routine selection can change at active-time boundary while paused projection remains unchanged',()=>{
  const ids=['clock-test-a','clock-test-b'];
  const registry=createPeopleLifeRegistry({places:[{id:'place-a',label:'Synthetic home'},{id:'place-b',label:'Synthetic workplace'}],households:[{id:'household-test',label:'Synthetic household',homePlaceId:'place-a',memberIds:ids}],
    residents:ids.map((id,i)=>({id,label:`Synthetic ${i}`,identityNote:'Clock test fixture only.',influenceSensitivity:'occasional',role:{id:'synthetic-role',label:'Synthetic role',purpose:'Test projection.'},homeHouseholdId:'household-test',family:{kind:'no-local-kin',explanation:'No local kin in this synthetic fixture.'},socialTies:[{residentId:ids[1-i],description:'Synthetic reciprocal acquaintance.'}],decisionMemory:{source:'inherited-story-choices'},routine:[
      {startMinute:0,endMinute:600,activity:'At home',placeId:'place-a',companionIds:[]},{startMinute:600,endMinute:1440,activity:'At work',placeId:'place-b',companionIds:[]},
    ]}))});assert.ok(registry.ok);
  const at=(clock:ReturnType<typeof createPeopleLifeClock>)=>getPeopleLifeRoutine(registry.registry,ids[0],getPeopleLifeDay(clock).dayMinute)?.placeId;
  let clock=createPeopleLifeClock(1440);clock=stepPeopleLifeClock(clock,{state:'active',elapsedMilliseconds:599});assert.equal(at(clock),'place-a');
  clock=stepPeopleLifeClock(clock,{state:'away',elapsedMilliseconds:999999});assert.equal(at(clock),'place-a');clock=stepPeopleLifeClock(clock,{state:'active',elapsedMilliseconds:1});assert.equal(at(clock),'place-b');
});
test('invalid/huge active ticks, unsafe counters, accessors and unrelated state fail without leaking fields',()=>{
  const clock=createPeopleLifeClock(144000),before=JSON.stringify(clock);
  for(const value of [-1,1.5,NaN,Infinity,PEOPLE_LIFE_MAX_STEP_MILLISECONDS+1])assert.throws(()=>stepPeopleLifeClock(clock,{state:'active',elapsedMilliseconds:value}));
  for(const duration of [0,1439,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>createPeopleLifeClock(duration));
  assert.throws(()=>stepPeopleLifeClock(clock,{state:'farming'as never,elapsedMilliseconds:1}));
  assert.throws(()=>stepPeopleLifeClock({...clock,standing:1}as never,{state:'paused',elapsedMilliseconds:1}));
  assert.throws(()=>stepPeopleLifeClock({activeMilliseconds:Number.MAX_SAFE_INTEGER,dayLengthMilliseconds:1440},{state:'active',elapsedMilliseconds:1}));
  let reads=0;const bad={dayLengthMilliseconds:1440};Object.defineProperty(bad,'activeMilliseconds',{enumerable:true,get(){reads++;return 0;}});assert.throws(()=>getPeopleLifeDay(bad as never));assert.equal(reads,0);
  assert.equal(JSON.stringify(clock),before);
});

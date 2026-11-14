import test from 'node:test';
import assert from 'node:assert/strict';
import { createResidentSafetyState,advanceResidentSafety,validateResidentSafetyState,validateResidentSafetySignal,parseResidentSafetySignal,type ResidentSafetySignal } from './resident-safety';
import type { VillageLifeIntent } from './village-life';
const resident={residentId:'smith',householdId:'smith-family',homePlaceId:'smith-home',ageYears:41,roleId:'smith',kinIds:['child']};
const routine:VillageLifeIntent={residentId:'smith',activityKey:'work',targetPlaceId:'forge',activity:'Works at the forge.',priority:20,issuedAbsoluteMinute:0,indoor:true,companionIds:[],reason:'routine'};
const report=(overrides:Partial<ResidentSafetySignal>={}):ResidentSafetySignal=>({id:'incident-1',kind:'violence',channel:'report',knownByResidentIds:['smith'],
  placeId:'square',observedAbsoluteMinute:1,expiresAbsoluteMinute:20,affectedResidentIds:['child'],shelterPlaceId:'smith-home',lastKnownPosition:[4,0,3],...overrides});
const input=(minute=1,signals:readonly ResidentSafetySignal[]=[report()])=>({state:createResidentSafetyState('smith',0),absoluteMinute:minute,resident,routineIntent:routine,signals});
test('reported kin threat interrupts duty with a safe family intent, retaining duty for recovery',()=>{
  const result=advanceResidentSafety(input());assert.equal(result.intent?.activityKey,'protect');assert.equal(result.intent?.reason,'safety');
  assert.deepEqual(result.intent?.companionIds,['child']);assert.equal(result.intent?.targetPlaceId,'smith-home');
  assert.deepEqual(result.state.interruptedIntent,routine);assert.equal(validateResidentSafetyState(result.state,'smith',1),null);
});
test('unaware residents do not react and distant named people grant no omniscience',()=>{
  assert.equal(advanceResidentSafety(input(1,[report({knownByResidentIds:['someone-else']})])).intent,null);
  const unrelated=advanceResidentSafety(input(1,[report({affectedResidentIds:['stranger']})]));
  assert.equal(unrelated.intent,null);assert.equal(unrelated.state.knownSignals.length,1);
});
test('guard watches last-known place while a child seeks shelter, with identical factual input',()=>{
  const threat=report({affectedResidentIds:[]});
  const guard=advanceResidentSafety({...input(1,[threat]),resident:{...resident,roleId:'spearman'}});
  assert.equal(guard.intent?.activityKey,'patrol');assert.equal(guard.intent?.targetPlaceId,'square');assert.equal(guard.state.mode,'watch');
  const child=advanceResidentSafety({...input(1,[report({placeId:'forge',affectedResidentIds:[]})]),resident:{...resident,ageYears:12,roleId:'guard-recruit'}});
  assert.equal(child.intent?.activityKey,'shelter');assert.equal(child.intent?.targetPlaceId,'smith-home');
  assert.deepEqual(guard.state.knownSignals[0].lastKnownPosition,[4,0,3]);
});
test('explicit all-clear resumes interrupted intent once without creating deaths or changing role',()=>{
  const first=advanceResidentSafety(input());
  const clear=report({id:'clear-1',kind:'all-clear',resolvesSignalId:'incident-1',observedAbsoluteMinute:2});
  const resumed=advanceResidentSafety({...input(2,[clear]),state:first.state});assert.equal(resumed.intent?.activityKey,'work');
  assert.equal(resumed.state.mode,'routine');assert.equal(resumed.state.interruptedIntent,null);
  assert.equal(advanceResidentSafety({...input(3,[]),state:resumed.state}).intent,null);
});
test('reports expire, future reports are unknown, and clears cannot resolve another incident',()=>{
  const first=advanceResidentSafety(input(1,[report({expiresAbsoluteMinute:3})]));
  assert.equal(advanceResidentSafety({...input(3,[]),state:first.state}).intent?.activityKey,'work');
  assert.equal(advanceResidentSafety(input(1,[report({observedAbsoluteMinute:2})])).intent,null);
  const wrong=report({id:'other-clear',kind:'all-clear',resolvesSignalId:'other',observedAbsoluteMinute:2});
  assert.equal(advanceResidentSafety({...input(2,[wrong]),state:first.state}).state.mode,'protect');
});
test('replanning is bounded and shelters never route into a known fire or closed building',()=>{
  const first=advanceResidentSafety(input());
  const held=advanceResidentSafety({...input(2,[]),state:first.state});assert.equal(held.intent?.issuedAbsoluteMinute,1);
  const redirected=advanceResidentSafety({...input(2,[report({id:'home-fire',kind:'fire',placeId:'smith-home',shelterPlaceId:'hall',observedAbsoluteMinute:2})]),state:first.state});
  assert.equal(redirected.intent?.targetPlaceId,'hall');
  const blocked=advanceResidentSafety({...input(),unavailablePlaceIds:['smith-home','forge']});assert.equal(blocked.intent,null);
});
test('safety saves round-trip with no live targets and rejects accessors, nonfinite positions and foreign residents',()=>{
  const first=advanceResidentSafety(input());const saved=JSON.parse(JSON.stringify(first.state));assert.equal(validateResidentSafetyState(saved,'smith',1),null);
  assert.notEqual(validateResidentSafetyState(saved,'someone-else',1),null);
  assert.notEqual(validateResidentSafetyState({...saved,nextRepathAbsoluteMinute:99999},'smith',1),null);
  let reads=0;Object.defineProperty(saved,'currentIntent',{get(){reads++;return null;},enumerable:true});
  assert.notEqual(validateResidentSafetyState(saved,'smith',1),null);assert.equal(reads,0);
  assert.throws(()=>advanceResidentSafety(input(1,[report({lastKnownPosition:[Infinity,0,0]})])));
});
test('minutely safety replay and save/reload reproduce uninterrupted results',()=>{
  let state=createResidentSafetyState('smith',0);for(let minute=1;minute<=8;minute++)state=advanceResidentSafety({...input(minute,minute===1?[report({expiresAbsoluteMinute:6})]:[]),state}).state;
  let restored=createResidentSafetyState('smith',0);for(let minute=1;minute<=8;minute++){
    restored=advanceResidentSafety({...input(minute,minute===1?[report({expiresAbsoluteMinute:6})]:[]),state:restored}).state;
    if(minute===3)restored=JSON.parse(JSON.stringify(restored));
  }assert.deepEqual(state,restored);
});
test('signal intake owns frozen finite plain snapshots and same-minute all-clear supersedes its incident',()=>{
  const original=report(),parsed=parseResidentSafetySignal(original);assert.notStrictEqual(parsed,original);assert.equal(Object.isFrozen(parsed),true);
  assert.equal(Object.isFrozen(parsed.knownByResidentIds),true);
  assert.strictEqual(parseResidentSafetySignal(parsed),parsed,'owned immutable parsed reports are reusable across100 recipients');
  assert.notEqual(validateResidentSafetySignal(Object.freeze({...original,lastKnownPosition:[NaN,0,0]})),null,'arbitrary frozen data never gains trusted status');
  assert.notEqual(validateResidentSafetySignal({...original,lastKnownPosition:undefined}),null);
  assert.notEqual(validateResidentSafetySignal({...original,kind:'all-clear'}),null);
  const clear=report({id:'a-clear',kind:'all-clear',resolvesSignalId:original.id});
  const result=advanceResidentSafety(input(1,[clear,original]));assert.equal(result.intent,null);assert.equal(result.state.knownSignals.length,0);
});

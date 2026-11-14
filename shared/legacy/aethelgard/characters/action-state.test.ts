import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterActionState,beginCharacterAction,advanceCharacterAction,characterActionPhase,
  characterStaminaAt,claimCharacterContact,interruptCharacterAction,characterGuardFaces,type CharacterActionSpec } from './action-state';
const attack:CharacterActionSpec={id:'spear',staminaCost:30,windupSeconds:0.4,activeSeconds:0.4,recoverySeconds:0.2,cooldownSeconds:2,
  windows:[{id:'bash',opensAt:0.4,closesAt:0.5},{id:'thrust',opensAt:0.7,closesAt:0.8}]};
test('action phases follow authoritative time, including dropped frames',()=>{
  const started=beginCharacterAction(createCharacterActionState('smith'),attack,0);assert.equal(started.accepted,true);
  assert.equal(characterActionPhase(started.state,0.2),'windup');assert.equal(characterActionPhase(started.state,0.5),'active');
  assert.equal(characterActionPhase(started.state,0.9),'recovery');assert.equal(advanceCharacterAction(started.state,10).active,null);
});
test('failed action is atomic: cannot cancel an attack, spend or reset its timers',()=>{
  const started=beginCharacterAction(createCharacterActionState('guard'),attack,0).state;
  const busy=beginCharacterAction(started,{...attack,id:'dodge',staminaCost:200},0.5);
  assert.equal(busy.accepted,false);assert.strictEqual(busy.state,started);assert.equal(busy.state.active?.spec.id,'spear');
  const ended=advanceCharacterAction(started,1);const denied=beginCharacterAction(ended,{...attack,id:'dodge',staminaCost:200},1);
  assert.equal(denied.reason,'stamina');assert.strictEqual(denied.state,ended);
});
test('cooldown permission is checked before a new action mutates state',()=>{
  const ended=advanceCharacterAction(beginCharacterAction(createCharacterActionState('guard'),attack,0).state,1);
  const denied=beginCharacterAction(ended,attack,1);assert.equal(denied.reason,'cooldown');assert.strictEqual(denied.state,ended);
  assert.equal(beginCharacterAction(ended,attack,2).accepted,true);
});
test('stamina regeneration is identical for bulk and subdivided time',()=>{
  const base=beginCharacterAction(createCharacterActionState('guard'),attack,0).state;
  let sliced=base;for(let tick=1;tick<=120;tick++)sliced=advanceCharacterAction(sliced,tick/60);
  const bulk=advanceCharacterAction(base,2);assert.deepEqual(sliced,bulk);assert.equal(characterStaminaAt(bulk,2),100);
  assert.equal(characterStaminaAt(base,0.5),70);assert.equal(characterStaminaAt(base,1),76.25);
});
test('contacts require an authored window and deduplicate target per swing',()=>{
  const base=beginCharacterAction(createCharacterActionState('guard'),attack,0).state;
  assert.equal(claimCharacterContact(base,{windowId:'bash',targetId:'opponent',atSeconds:0.2}).reason,'outside-window');
  const bash=claimCharacterContact(base,{windowId:'bash',targetId:'opponent',atSeconds:0.4});assert.equal(bash.accepted,true);
  assert.equal(claimCharacterContact(bash.state,{windowId:'bash',targetId:'opponent',atSeconds:0.45}).reason,'duplicate');
  assert.equal(claimCharacterContact(bash.state,{windowId:'thrust',targetId:'opponent',atSeconds:0.7}).accepted,true);
  assert.equal(claimCharacterContact(base,{windowId:'bash',targetId:'guard',atSeconds:0.4}).accepted,false);
});
test('stagger cancels pending attack contacts and a spent cost stays spent',()=>{
  const base=beginCharacterAction(createCharacterActionState('guard'),attack,0).state;
  const staggered=interruptCharacterAction(base,0.2,'stagger');assert.equal(staggered.active,null);
  assert.equal(staggered.interruption?.actionId,'spear');assert.equal(characterStaminaAt(staggered,0.2),70);
  assert.equal(claimCharacterContact(staggered,{windowId:'bash',targetId:'opponent',atSeconds:0.4}).reason,'inactive');
});
test('facing guard rejects rear and degenerate strikes',()=>{
  const guard={position:{x:0,z:0},forward:{x:0,z:1}};
  assert.equal(characterGuardFaces({...guard,incomingFrom:{x:0,z:2}}),true);
  assert.equal(characterGuardFaces({...guard,incomingFrom:{x:0,z:-2}}),false);
  assert.equal(characterGuardFaces({...guard,incomingFrom:{x:2,z:0}}),false);
  assert.equal(characterGuardFaces({...guard,incomingFrom:{x:0,z:0}}),false);
});
test('invalid windows/times are rejected without mutation and cannot grow unbounded',()=>{
  const base=createCharacterActionState('guard');assert.equal(beginCharacterAction(base,{...attack,windows:[{id:'late',opensAt:4,closesAt:5}]},0).reason,'invalid');
  assert.throws(()=>beginCharacterAction(base,attack,NaN));assert.throws(()=>advanceCharacterAction(base,-1));
  assert.equal(beginCharacterAction(base,{...attack,staminaCost:Infinity},0).accepted,false);
});

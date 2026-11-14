import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineCombatStage,type StageHost,type StageFigure,type StageContactResolved } from '../../web/src/scene/combat/engineStage';
import { CombatControl,runCombat } from '../../web/src/scene/combat/runner';
import { directCombat,type CombatPlan } from '../../web/src/scene/combat/director';
import { pawnDuelInput } from '../../web/src/scene/combat/pawnDuel';
import { CATALOG } from '../../web/src/scene/combat/sequences/index';

function fixture(sequence='pawn.thrust-block') {
  const input=pawnDuelInput({color:'w',from:'e4',to:'d5',victim:'d5',armies:{w:'ivory',b:'sun'},sanMoves:['e4','d5','exd5']});
  const plan=directCombat(input,CATALOG.filter(s=>s.id===sequence)) as CombatPlan;assert.equal(plan.kind,'sequence');
  let time=0,impacts=0,falls=0,strikes=0;
  const events:StageContactResolved[]=[],moves:(()=>boolean)[]=[];
  const figure=(x:number,forwardX:number):StageFigure=>({
    position:()=>({x,y:0,z:0}),forward:()=>({x:forwardX,y:0,z:0}),
    clip:id=>({id,duration:1.5,events:{contact:0.8,impact:0.8,clash:0.4,guard:0.3,evade:0.3,hit:0.15,land:1.3}}),
    play(){},brace(){},flinch(){},place(){},travel(_to,_options,live){moves.push(live);},face(){},
    anchor:()=>({x,y:0.8,z:0}),aimWeapon(){},
  });
  const host:StageHost={clock:{now:()=>time,wait:async seconds=>{time+=seconds;}},attacker:figure(0,1),defender:figure(1,-1),
    reference:()=>({x:0,y:0,z:0}),offset:()=>({x:0,y:0,z:0}),pan:()=>0,
    sounds:{kill(){strikes++;},whoosh(){},bodyFall(){},cue(){return true;}},camera(){},effect(){},
    impact(){impacts++;},fall:async()=>{falls++;},clear:async()=>{},claim:async()=>{},finish(){},contactResolved:event=>events.push(event)};
  const stage=new EngineCombatStage(host);
  const sample=(index:number)=>{const cue=plan.contacts[index];assert.ok(cue);stage.sampleContact(cue,{from:host[cue.from.actor].anchor(cue.from.anchor),to:host[cue.to.actor].anchor(cue.to.anchor)});};
  return {plan,host,stage,sample,events,moves,get impacts(){return impacts;},get falls(){return falls;},get strikes(){return strikes;}};
}
test('authored contact events carry actual socket samples, stable seed and facing, exactly once per window/target',()=>{
  const f=fixture();f.stage.begin(f.plan);f.sample(0);f.sample(0);
  assert.equal(f.events.length,1);assert.equal(f.events[0].id,f.plan.contacts[0].id);assert.equal(f.events[0].seed,f.plan.seed);
  assert.deepEqual(f.events[0].from,{x:0,y:0.8,z:0});assert.deepEqual(f.events[0].to,{x:1,y:0.8,z:0});
  if(f.events[0].toAnchor==='shieldFace')assert.equal(f.events[0].facingGuard,true);
  assert.equal(f.impacts,0);assert.equal(f.strikes,0);
  for(let index=1;index<f.plan.contacts.length;index++)f.sample(index);
  assert.equal(f.events.length,f.plan.contacts.length,'a later authored thrust may contact the same defender');
});
test('rear shield and absent facing are reported honestly without changing chess outcome',()=>{
  const f=fixture();f.host.defender.forward=()=>({x:1,y:0,z:0});f.stage.begin(f.plan);f.sample(0);
  assert.equal(f.events[0].toAnchor,'shieldFace');assert.equal(f.events[0].facingGuard,false);
  f.stage.decisive(f.plan.resolution,f.plan);f.stage.decisive(f.plan.resolution,f.plan);assert.equal(f.impacts,1);
  const noFacing=fixture();delete noFacing.host.defender.forward;noFacing.stage.begin(noFacing.plan);noFacing.sample(0);
  assert.equal(noFacing.events[0].facingGuard,null);
});
test('a true contact with coincident sockets still uses the actual attacker direction for guard facing',()=>{
  const f=fixture();f.stage.begin(f.plan);const cue=f.plan.contacts[0];
  f.stage.sampleContact(cue,{from:{x:1,y:0.8,z:0},to:{x:1,y:0.8,z:0}});
  assert.equal(f.events[0].facingGuard,true);assert.deepEqual(f.events[0].from,f.events[0].to);
});
test('stagger cancels stale movement and outgoing contacts; next authored attack can resume',()=>{
  const f=fixture();f.stage.begin(f.plan);
  f.stage.attacker.move({ref:'origin',file:0,rank:0},{duration:1,gait:'step',arc:0});assert.equal(f.moves[0](),true);
  f.stage.attacker.pose('stagger',{strength:1,hold:0.2,toward:null,drive:'auto'});assert.equal(f.moves[0](),false);f.sample(0);assert.equal(f.events.length,0);
  f.stage.attacker.play({id:'attack.thrust',duration:1.4,events:{contact:0.8}},{rate:1,fade:0.1});f.sample(0);assert.equal(f.events.length,1);
  f.stage.decisive(f.plan.resolution,f.plan);assert.equal(f.impacts,1);
});
test('finished/cancelled stages emit no delayed contacts and malformed/old samples do not reopen windows',()=>{
  const f=fixture();f.stage.begin(f.plan);
  f.stage.sampleContact({...f.plan.contacts[0],id:'invented'},{from:{x:0,y:0,z:0},to:{x:1,y:0,z:0}});assert.equal(f.events.length,0);
  for(let index=0;index<f.plan.contacts.length;index++)f.sample(index);
  f.sample(0);assert.equal(f.events.length,f.plan.contacts.length);
  f.stage.finish('cancelled');f.sample(0);f.stage.decisive(f.plan.resolution,f.plan);assert.equal(f.impacts,0);
  assert.equal(f.events.length,f.plan.contacts.length);
});
test('observational VFX failure cannot undo a legal decisive strike or create duplicate side effects',async()=>{
  const f=fixture();f.host.contactResolved=()=>{throw Error('Context unavailable');};
  const outcome=await runCombat(f.plan,f.stage);await f.stage.aftermath();assert.equal(outcome.killed,true);
  assert.equal(f.impacts,1);assert.equal(f.falls,1);assert.equal(f.strikes,1);assert.ok(f.stage.status.contactFailures>0);
});
test('runner uses the same authored sample for diagnostics and hook; skip has no historical callbacks',async()=>{
  const f=fixture(),control=new CombatControl();control.skip();
  const outcome=await runCombat(f.plan,f.stage,control);await f.stage.aftermath();
  assert.equal(outcome.killed,true);assert.equal(f.impacts,1);assert.equal(f.falls,1);assert.equal(f.strikes,1);
  assert.deepEqual(f.events.map(event=>event.id),outcome.contacts.map(event=>event.id));
  assert.ok(f.events.length<=f.plan.contacts.length);
  assert.ok(f.events.every(event=>event.from!==null&&event.to!==null));
});

for (const shieldless of [false, true]) test(`the ${shieldless ? 'weapon parry' : 'shield block'} owns exactly one material cue and requires adjacent genuine sockets`, () => {
  const f = fixture(); let effects = 0, sounds = 0;
  f.host.effect = () => { effects++; }; f.host.sounds.cue = () => { sounds++; return true; };
  f.host.attacker.anchor = () => ({ x: .95, y: .8, z: 0 });
  f.host.defender.anchor = anchor => shieldless && anchor === 'shieldFace' ? null : ({ x: 1, y: .8, z: 0 });
  f.stage.begin(f.plan);
  const cue = { at: 0, fx: 'sparks', where: { actor: 'defender', anchor: 'shieldFace' }, strength: 1 } as const;
  f.stage.effect(cue); f.stage.audio('clash.parry.steel', { volume: 1, from: 'defender' });
  assert.equal(effects, 1); assert.equal(sounds, 1);
  f.host.attacker.anchor = () => null;
  f.stage.effect(cue); f.stage.audio('clash.parry.steel', { volume: 1, from: 'defender' });
  assert.equal(effects, 1); assert.equal(sounds, 1, 'an absent tip does not fabricate a clash');
  f.host.attacker.anchor = () => ({ x: 0, y: .8, z: 0 });
  f.stage.effect(cue); f.stage.audio('clash.parry.steel', { volume: 1, from: 'defender' });
  assert.equal(effects, 1); assert.equal(sounds, 1, 'separated weapons do not clash');
  f.host.attacker.anchor = () => ({ x: .95, y: .8, z: 0 });
  if (!shieldless) {
    f.host.defender.forward = () => ({ x: 1, y: 0, z: 0 });
    f.stage.effect(cue); f.stage.audio('clash.parry.steel', { volume: 1, from: 'defender' });
    assert.equal(effects, 1); assert.equal(sounds, 1, 'a rear shield does not stop the blow');
  }
});

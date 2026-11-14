import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceVillageBuildingDamage,buildingDamageKey,buildingRebuildAvailability,createVillageBuildingDamage,parseVillageBuildingDamage,
  parseBuildingDamageBinding,
  receiveBuildingAid,settleVillageBuildingRaid,startBuildingRebuild,stepVillageBuildingDamage,unavailableDamagedBuildingBindings,
  type BuildingDamageBinding,type BuildingRaidOutcome,type BuildingAidDelivery,type VillageBuildingDamageState,
} from '../aethelgard/observer/building-damage';
import {copyObserverJSON} from '../aethelgard/observer/observer-json';
import {advanceRaid,startRaid,raidEndMinute,parseRaid,type RaidRoster} from '../aethelgard/observer/bandit-raid';
import {afterRaid,createRealm} from '../aethelgard/observer/neighbour-houses';
import {EMPTY_OBSERVER_SAVE,parseObserverSave,serializeObserverSave} from '../aethelgard/observer/observer-save';

const WORLD='test-real-building-world';
// Source-shaped identity fixtures only. No model, new coordinate, household or
// actual building/site certificate is created by these reducer tests.
const binding=(index=0,profile:'desktop'|'quest'='desktop'):BuildingDamageBinding=>({catalogueId:`test-building-catalogue-v1:${profile}`,sourceSha256:(profile==='desktop'?'a':'b').repeat(64),profile,buildingId:`test-source-door-${index}`,siteIndex:index});
const outcome=(serial=0,index=0,minute=480,profile:'desktop'|'quest'='desktop'):BuildingRaidOutcome=>({worldKey:WORLD,raidId:`raid-${minute-80}-${serial}`,startMinute:minute-80,settledMinute:minute,outcome:'burned',binding:binding(index,profile),targetLabel:`the test farmstead ${index}`});
const delivery=(o:BuildingRaidOutcome,minute=o.settledMinute):BuildingAidDelivery=>({worldKey:WORLD,raidId:o.raidId,deliveredMinute:minute,houseId:'house-holtmere',houseLabel:'House Holtmere',timber:12,workers:2,labourMinutes:240});
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
function burned(){return settleVillageBuildingRaid(createVillageBuildingDamage(WORLD,0),outcome(),480);}
function funded(){return receiveBuildingAid(burned(),delivery(outcome()));}
function rebuilding(){const r=startBuildingRebuild(funded(),buildingDamageKey(binding()),'house-holtmere');assert.ok(r.ok);return r.state;}

test('a bound burned raid remains burned indefinitely until explicitly funded labour finishes',()=>{
  const s=burned(),later=advanceVillageBuildingDamage(s,480+1440*120);
  assert.equal(later.buildings[0].condition,'burned');assert.equal(later.buildings[0].lastRaidId,outcome().raidId);
  assert.equal(later.timber,0);assert.equal(later.crews.length,0);assert.equal(s.absoluteMinute,480);
  const held=startBuildingRebuild(later,buildingDamageKey(binding()),'house-holtmere');assert.equal(held.ok,false);assert.match(!held.ok?held.reason:'',/timber/);
});

test('the actual raid-to-neighbour-aid path yields one finite named delivery and usable rebuild command',()=>{
  const roster:RaidRoster={person:()=>null,placeKind:()=>null};let raidReturn:ReturnType<typeof startRaid>|null=null,stepReturn:ReturnType<typeof advanceRaid>|null=null;
  for(let n=0;n<30;n++){
    const raid=startRaid({worldKey:`real-raid-branch-${n}`,minute:1320,serial:0,provoked:false,watchAtPost:false,sites:[{index:0,bearing:'east',buildingBinding:binding()}]});
    const step=advanceRaid(raid,{minute:raidEndMinute(raid),residents:[],roster,storm:false});if(step.record?.outcome==='burned'){raidReturn=raid;stepReturn=step;break;}
  }
  assert.ok(raidReturn&&stepReturn?.damageOutcome&&stepReturn.record);
  const word=afterRaid(createRealm(),stepReturn.record,raidEndMinute(raidReturn));assert.ok(word.rebuildingAid);assert.ok(word.events.some(e=>e.text.includes('hands and timber')));
  const s=stepVillageBuildingDamage(createVillageBuildingDamage(raidReturn.worldKey!,0),{absoluteMinute:raidEndMinute(raidReturn),damageOutcome:stepReturn.damageOutcome,rebuildingAid:word.rebuildingAid});
  assert.equal(s.buildings[0].condition,'burned');assert.equal(s.timber,12);assert.equal(s.crews[0].houseLabel,word.rebuildingAid.houseLabel);assert.equal(s.crews[0].labourRemaining,240);
  const started=startBuildingRebuild(s,buildingDamageKey(binding()),word.rebuildingAid.houseId);assert.ok(started.ok);assert.equal(started.state.timber,0);assert.equal(started.state.buildings[0].condition,'rebuilding');
  assert.equal(advanceVillageBuildingDamage(started.state,started.state.absoluteMinute+1440).buildings[0].condition,'sound');
});

test('aid and rebuild clicks are idempotent; night/pause alone cannot repair; one crew earns finite day labour',()=>{
  let s=funded();assert.equal(receiveBuildingAid(s,delivery(outcome())),s);
  const before=JSON.stringify(s),started=startBuildingRebuild(s,buildingDamageKey(binding()),'house-holtmere');assert.ok(started.ok);s=started.state;
  assert.equal(startBuildingRebuild(s,buildingDamageKey(binding()),'house-holtmere').ok,false);assert.equal(advanceVillageBuildingDamage(s,480),s);
  let t=advanceVillageBuildingDamage(s,510);assert.equal(t.buildings[0].rebuild?.labourDone,60);assert.equal(t.crews[0].labourRemaining,180);
  t=advanceVillageBuildingDamage(t,570);assert.equal(t.buildings[0].condition,'sound');assert.equal(t.buildings[0].rebuiltAtMinute,570);assert.equal(t.crews[0].labourRemaining,60);assert.equal(t.crews[0].assignedBuildingKey,null);
  assert.equal(t.timber,0);assert.equal(JSON.stringify(funded()),before);
  const nightOutcome=outcome(0,0,1200);let night=receiveBuildingAid(settleVillageBuildingRaid(createVillageBuildingDamage(WORLD,0),nightOutcome,1200),delivery(nightOutcome));
  const assigned=startBuildingRebuild(night,buildingDamageKey(binding()),'house-holtmere');assert.ok(assigned.ok);night=advanceVillageBuildingDamage(assigned.state,1440+480);
  assert.equal(night.buildings[0].rebuild?.labourDone,0);assert.equal(advanceVillageBuildingDamage(night,1440+481).buildings[0].rebuild?.labourDone,2);
});

test('whole, sliced and saved offline catchup produce identical clock, stock, crew, condition and completion',()=>{
  const initial=rebuilding(),whole=advanceVillageBuildingDamage(initial,2200);let sliced=initial;
  for(const minute of [481,500,510,550,570,700,1440,2200])sliced=advanceVillageBuildingDamage(parseVillageBuildingDamage(copy(sliced),WORLD),minute);
  assert.deepEqual(sliced,whole);assert.equal(whole.buildings[0].rebuiltAtMinute,570);assert.throws(()=>advanceVillageBuildingDamage(whole,2199),/rewind/);
});

test('a new burning interrupts repair without refunding spent material/labour or restoring another source building',()=>{
  const partially=advanceVillageBuildingDamage(rebuilding(),510),again=outcome(1,0,510);
  const interrupted=settleVillageBuildingRaid(partially,again,510);assert.equal(interrupted.buildings[0].condition,'burned');assert.equal(interrupted.timber,0);
  assert.equal(interrupted.crews[0].labourRemaining,180);assert.equal(interrupted.crews[0].assignedBuildingKey,null);
  const withOther=settleVillageBuildingRaid(interrupted,outcome(2,1,520,'quest'),520);
  assert.equal(withOther.buildings.length,2);assert.equal(unavailableDamagedBuildingBindings(withOther).length,2);
  assert.notEqual(buildingDamageKey(binding(1,'quest')),buildingDamageKey(binding(1,'desktop')));
});

test('one named repair party cannot be double booked even with enough timber for two victims',()=>{
  const second=outcome(1,1,480);let s=receiveBuildingAid(settleVillageBuildingRaid(funded(),second,480),delivery(second));assert.equal(s.timber,24);
  const first=startBuildingRebuild(s,buildingDamageKey(binding()),'house-holtmere');assert.ok(first.ok);s=first.state;
  assert.equal(buildingRebuildAvailability(s,buildingDamageKey(binding(1)),'house-holtmere').available,false);
  const rejected=startBuildingRebuild(s,buildingDamageKey(binding(1)),'house-holtmere');assert.equal(rejected.ok,false);assert.equal(rejected.state,s);assert.equal(s.timber,12);
  s=advanceVillageBuildingDamage(s,570);assert.equal(startBuildingRebuild(s,buildingDamageKey(binding(1)),'house-holtmere').ok,true);
});

test('serial receipts survive raid-history eviction and cannot reburn an already rebuilt building on replay',()=>{
  let s=advanceVillageBuildingDamage(rebuilding(),570);
  for(let serial=1;serial<=12;serial++)s=settleVillageBuildingRaid(s,{...outcome(serial,1,570+serial),outcome:'repelled'},570+serial);
  const before=JSON.stringify(s);assert.equal(settleVillageBuildingRaid(s,outcome(),s.absoluteMinute),s);assert.equal(receiveBuildingAid(s,delivery(outcome())),s);
  assert.equal(stepVillageBuildingDamage(s,{absoluteMinute:s.absoluteMinute,damageOutcome:outcome(),rebuildingAid:delivery(outcome())}),s);
  assert.equal(s.buildings[0].condition,'sound');assert.equal(s.timber,0);assert.equal(JSON.stringify(s),before);
});

test('unbound old targets/history remain unbound, and old saves gain no retrospective supplies or damage',()=>{
  const legacy=createVillageBuildingDamage(WORLD,5000,40);assert.equal(legacy.lastRaidSerial,39);assert.equal(legacy.timber,0);assert.deepEqual(legacy.buildings,[]);
  const old={...outcome(39,0,480),worldKey:null,binding:null};assert.equal(settleVillageBuildingRaid(legacy,old,5000),legacy);
  const freshUnbound={...outcome(40,0,5100),binding:null};const processed=settleVillageBuildingRaid(legacy,freshUnbound,5100);assert.deepEqual(processed.buildings,[]);
  const oldWord=afterRaid(createRealm(),{outcome:'burned',aidHouseId:null},5100);assert.equal(oldWord.rebuildingAid,null);
  assert.equal(afterRaid(createRealm(),{id:freshUnbound.raidId,worldKey:WORLD,outcome:'burned',aidHouseId:null},5100).rebuildingAid,null);
  assert.equal(receiveBuildingAid(processed,delivery(freshUnbound,5100)).timber,0,'An unbound narrative raid cannot farm free physical rebuilding supplies.');
});

test('source/world/clock/input failures preserve the old state and never mint stock or guess a building',()=>{
  const s=burned(),before=JSON.stringify(s);
  assert.throws(()=>receiveBuildingAid(s,{...delivery(outcome()),worldKey:'foreign'}),/another world/);
  assert.throws(()=>settleVillageBuildingRaid(s,{...outcome(1,1,490),worldKey:'foreign'},490),/another or unknown world/);
  assert.throws(()=>settleVillageBuildingRaid(s,{...outcome(1,1,490),worldKey:null},490),/unknown world/);
  assert.throws(()=>receiveBuildingAid(s,{...delivery(outcome()),timber:120000}),/allocation/);
  assert.throws(()=>stepVillageBuildingDamage(s,{absoluteMinute:490,rebuildingAid:{...delivery(outcome()),deliveredMinute:491}}),/not arrived/);
  assert.throws(()=>settleVillageBuildingRaid(advanceVillageBuildingDamage(s,600),outcome(1,0,590),600),/late new damage/);
  assert.equal(JSON.stringify(s),before);
});

test('new source targets are captured once; malformed/mismatched bindings and foreign fields never authorize visuals',()=>{
  const raid=startRaid({worldKey:WORLD,minute:1320,serial:0,provoked:false,watchAtPost:false,sites:[{index:0,bearing:'west',buildingBinding:binding()}]});
  assert.deepEqual(parseRaid(copy(raid))?.target.buildingBinding,binding());
  const old=copy(raid) as any;delete old.worldKey;delete old.target.buildingBinding;assert.equal(parseRaid(old)?.target.buildingBinding,undefined);
  const wrong=copy(raid);(wrong.target as any).buildingBinding.siteIndex=2;assert.equal(parseRaid(wrong)?.target.buildingBinding,undefined);
  assert.throws(()=>startRaid({worldKey:WORLD,minute:1320,serial:0,provoked:false,watchAtPost:false,sites:[{index:1,bearing:'west',buildingBinding:binding()}]}),/index differ/);
});

test('raid outcome night is the authored clash time, independent of a later sunrise catchup poll',()=>{
  const roster:RaidRoster={person:()=>null,placeKind:()=>null};
  for(let serial=0;serial<20;serial++){
    const raid=startRaid({worldKey:WORLD,minute:300,serial,provoked:true,watchAtPost:false,sites:[{index:0,bearing:'north',buildingBinding:binding()}]});
    const clash=advanceRaid(raid,{minute:335,residents:[],roster,storm:false});assert.ok(clash.raid);assert.equal(clash.damageOutcome,null);
    const walked=advanceRaid(clash.raid,{minute:raidEndMinute(raid),residents:[],roster,storm:false}),jumped=advanceRaid(raid,{minute:raidEndMinute(raid),residents:[],roster,storm:false});
    assert.equal(walked.record?.outcome,jumped.record?.outcome);assert.deepEqual(walked.damageOutcome,jumped.damageOutcome);
  }
});

test('corrupt/foreign new damage data is preserved and blocked rather than reset to sound on observer save',()=>{
  const state=rebuilding(),base={...EMPTY_OBSERVER_SAVE,offsetMilliseconds:12345,buildingDamage:{status:'valid' as const,state}};
  const wire=serializeObserverSave(base),restored=parseObserverSave(wire,WORLD);assert.equal(restored.buildingDamage?.status,'valid');
  if(restored.buildingDamage?.status==='valid')assert.deepEqual(restored.buildingDamage.state,state);
  const corrupt=JSON.parse(wire);corrupt.buildingDamage.timber=-1;const loaded=parseObserverSave(JSON.stringify(corrupt),WORLD);
  assert.equal(loaded.offsetMilliseconds,12345);assert.equal(loaded.buildingDamage?.status,'invalid');assert.deepEqual(JSON.parse(serializeObserverSave(loaded)).buildingDamage,corrupt.buildingDamage);
  assert.equal(parseObserverSave(wire,'another-world').buildingDamage?.status,'invalid');
  const old=serializeObserverSave(EMPTY_OBSERVER_SAVE);assert.equal(parseObserverSave(old).buildingDamage,undefined);
  const oldRoundtrip=JSON.parse(serializeObserverSave(parseObserverSave(old)));assert.deepEqual(oldRoundtrip,JSON.parse(old));assert.equal(Object.prototype.hasOwnProperty.call(oldRoundtrip,'buildingDamage'),false);
});

test('strict restore rejects invalid stock, duplicate conditions/crews, orphaned assignments and getters without reading them',()=>{
  const s=rebuilding();for(const edit of [(v:any)=>v.timber=-1,(v:any)=>v.buildings.push(copy(v.buildings[0])),(v:any)=>v.crews.push(copy(v.crews[0])),
    (v:any)=>v.buildings[0].rebuild.labourDone=180,(v:any)=>v.crews[0].assignedBuildingKey='another-building',(v:any)=>v.buildings[0].binding.sourceSha256='bad',
    (v:any)=>v.buildings[0].rebuiltAtMinute=600,(v:any)=>v.lastAidSerial=99,(v:any)=>v.crews.unknown=42]){const wrong=copy(s);edit(wrong);assert.throws(()=>parseVillageBuildingDamage(wrong,WORLD));}
  let reads=0;const accessor=copy(s);Object.defineProperty(accessor,'timber',{enumerable:true,get(){reads++;return 10;}});assert.throws(()=>parseVillageBuildingDamage(accessor));assert.equal(reads,0);
  assert.deepEqual(parseVillageBuildingDamage(copy(s),WORLD),s);assert.equal(Object.isFrozen(s.buildings[0].rebuild),true);
});

test('rejected future JSON survives whole observer saves while unrelated progress continues',()=>{
  const futureArray={schemaVersion:2,extension:Array(4097).fill(0)};
  const deepFuture=Array.from({length:18}).reduce<unknown>(value=>({next:value}),{});
  for(const future of [futureArray,deepFuture]){
    const original=JSON.stringify({...EMPTY_OBSERVER_SAVE,offsetMilliseconds:12345,buildingDamage:future}),loaded=parseObserverSave(original,WORLD);
    assert.equal(loaded.buildingDamage?.status,'invalid');
    const progressed=serializeObserverSave({...loaded,offsetMilliseconds:12468,speed:4});
    const stored=JSON.parse(progressed);assert.deepEqual(stored.buildingDamage,future);assert.equal(stored.offsetMilliseconds,12468);assert.equal(stored.speed,4);
    const readAgain=parseObserverSave(progressed,WORLD);assert.equal(readAgain.buildingDamage?.status,'invalid');assert.equal(readAgain.offsetMilliseconds,12468);
  }
});

test('source hashes must be actual strings, never RegExp-coercible arrays or objects',()=>{
  for(const sourceSha256 of [['a'.repeat(64)],123,null,{value:'a'.repeat(64)}]){
    const wrong={...binding(),sourceSha256};assert.throws(()=>parseBuildingDamageBinding(wrong),/source identity/);
    assert.throws(()=>buildingDamageKey(wrong as unknown as BuildingDamageBinding));
    const saved=copy(burned()) as any;saved.buildings[0].binding.sourceSha256=sourceSha256;assert.throws(()=>parseVillageBuildingDamage(saved,WORLD));
  }
  assert.equal(parseBuildingDamageBinding(binding()).sourceSha256,'a'.repeat(64));
});

test('future-field transport still rejects accessors/cycles and safely preserves prototype-looking JSON keys',()=>{
  let reads=0;const accessor={};Object.defineProperty(accessor,'future',{enumerable:true,get(){reads++;return 0;}});
  assert.throws(()=>copyObserverJSON(accessor),/accessors/);assert.equal(reads,0);
  const cyclic:any={};cyclic.self=cyclic;assert.throws(()=>copyObserverJSON(cyclic),/cycles/);
  assert.throws(()=>copyObserverJSON(new Date()),/plain JSON/);
  const raw=JSON.parse('{"__proto__":{"future":true},"extension":[0,1]}');assert.deepEqual(copyObserverJSON(raw),raw);assert.equal(({} as any).future,undefined);
});

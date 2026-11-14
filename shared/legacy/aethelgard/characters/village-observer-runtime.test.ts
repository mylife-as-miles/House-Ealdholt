import test from 'node:test';
import assert from 'node:assert/strict';
import { EALDHOLT_VILLAGE_POPULATION as population } from './village-population';
import { advanceVillagePopulationRuntime, createVillagePopulationObserver, createVillagePopulationRuntime,
  getVillagePopulationTime, parseVillagePopulationRuntime, reportVillagePopulationSafetySignals, sampleVillagePopulationRuntime, serializeVillagePopulationRuntime } from './village-population-runtime';
import { observerRaidSafetySignals } from '../observer/raid-safety';
import { startRaid } from '../observer/bandit-raid';

const worldKey='observer-coherence-test',contentRevision='test-observer-v2',createdAt=1000;
function create(){const result=createVillagePopulationRuntime({population,confirmedEntry:true,worldKey,contentRevision,createdAt,
  initialDayMinute:540,millisecondsPerWorldMinute:1000,walkingSpeedMetresPerSecond:.8});assert.ok(result.ok);return result.snapshot;}
function coherent(value:ReturnType<typeof create>){
  const time=getVillagePopulationTime(value);
  assert.equal(value.life.absoluteMinute,time.absoluteWorldMinute);
  assert.ok(Math.abs(value.navigation.absoluteMinute-time.absoluteWorldMinute-time.fractionalMinute)<1e-8);
  assert.ok(parseVillagePopulationRuntime(JSON.stringify(value),{worldKey,contentRevision}).ok,'all v2 cursors satisfy the real restore validator');
}
test('observer forward time advances lives and journey cursors together without changing canonical save bytes',()=>{
  const canonical=create(),before=serializeVillagePopulationRuntime(canonical),observer=createVillagePopulationObserver();
  let projected=observer.observe(canonical,0);
  for(let requested=1000;requested<=16000;requested+=1000){projected=observer.observe(canonical,requested);coherent(projected);}
  assert.equal(getVillagePopulationTime(projected).absoluteWorldMinute,556);
  assert.equal(sampleVillagePopulationRuntime(projected,null).observation?.mode,'forward-projection');
  assert.equal(serializeVillagePopulationRuntime(projected).ok,false,'a read-only projected visit cannot replace the saved town');
  assert.deepEqual(serializeVillagePopulationRuntime(canonical),before);
  assert.equal(canonical.life.absoluteMinute,540);
  assert.equal(advanceVillagePopulationRuntime(projected,{expectedGeneration:projected.generation,worldKey,contentRevision,observedAt:createdAt+17000,maxAdvanceMinutes:1}).ok,false);
  assert.equal(reportVillagePopulationSafetySignals(projected,{expectedGeneration:projected.generation,worldKey,contentRevision,signals:[]}).ok,false);
});
test('ordinary lived observation adopts fresh canonical facts and safety without turning the actual save read-only',()=>{
  const canonical=create(),observer=createVillagePopulationObserver();observer.observe(canonical,0,{preferCanonical:true});
  const advance=advanceVillagePopulationRuntime(canonical,{expectedGeneration:0,worldKey,contentRevision,observedAt:createdAt+1000,maxAdvanceMinutes:1});assert.ok(advance.ok);
  const current=observer.observe(advance.snapshot,1000,{preferCanonical:true});assert.equal(current.life,advance.snapshot.life);
  assert.equal(current.rosterFacts,advance.snapshot.rosterFacts);assert.equal(current.safetySignals,advance.snapshot.safetySignals);
  assert.equal(serializeVillagePopulationRuntime(current).ok,false);assert.equal(serializeVillagePopulationRuntime(advance.snapshot).ok,true);
});
test('large saved observer offsets have a bounded catchup cursor used by both NPCs and lighting',()=>{
  const canonical=create(),observer=createVillagePopulationObserver(),first=observer.observe(canonical,60000);
  const sample=sampleVillagePopulationRuntime(first,null);
  assert.equal(first.clock.simulatedElapsedMilliseconds,2000);
  assert.equal(sample.time.absoluteWorldMinute,542);
  assert.equal(sample.observation?.pendingMilliseconds,58000);
  const next=observer.observe(canonical,60000);assert.equal(next.clock.simulatedElapsedMilliseconds,4000);coherent(next);
});
test('holding observed time holds the same lives while the canonical town keeps progressing',()=>{
  const canonical=create(),observer=createVillagePopulationObserver(),paused=observer.observe(canonical,1000);
  const advance=advanceVillagePopulationRuntime(canonical,{expectedGeneration:canonical.generation,worldKey,contentRevision,observedAt:createdAt+30000,maxAdvanceMinutes:60});assert.ok(advance.ok);
  const held=observer.observe(advance.snapshot,1000);
  assert.equal(held.clock.simulatedElapsedMilliseconds,1000);assert.deepEqual(held.life,paused.life);assert.deepEqual(held.navigation,paused.navigation);
  assert.equal(advance.snapshot.life.absoluteMinute,570);
});
test('unavailable earlier history remains a labelled analytic schedule with no journal or arrival proof',()=>{
  const initial=create(),advance=advanceVillagePopulationRuntime(initial,{expectedGeneration:0,worldKey,contentRevision,observedAt:createdAt+60000,maxAdvanceMinutes:60});assert.ok(advance.ok);
  const observer=createVillagePopulationObserver(),past=observer.observe(advance.snapshot,15000),sample=sampleVillagePopulationRuntime(past,null);
  assert.equal(sample.time.absoluteWorldMinute,555);assert.equal(sample.observation?.mode,'analytic-history-unavailable');
  assert.equal(sample.navigationAuthority,'schedule-projection');assert.equal(sample.life,undefined);
  assert.ok(sample.residents.every(row=>row.arrivalEvidence===undefined&&row.workPoseQualified!==true));
  assert.equal(observer.observe(advance.snapshot,15000),past,'pause remains functional in the analytic observation');coherent(past);
  assert.equal(serializeVillagePopulationRuntime(past).ok,false);
});
test('the observer sky interrupts projected outdoor duties at the same minute without changing canonical weather/lives',()=>{
  const canonical=create(),observer=createVillagePopulationObserver(),projected=observer.observe(canonical,1000,{environmentAt:()=>({weather:'rain',rain:1})});
  assert.ok(projected.life.residents.some(row=>row.intent.reason==='weather'&&row.intent.activityKey==='shelter'));
  assert.equal(canonical.life.journal.length,0);
  assert.ok(projected.life.journal.some(row=>row.kind==='weather-interrupted'));
});
test('only the authored raid bell reports danger to projected resident lives; sighting alone grants no omniscience',()=>{
  const canonical=create(),observer=createVillagePopulationObserver(),raid=startRaid({worldKey,minute:540,serial:0,provoked:true,watchAtPost:false,sites:[]});
  assert.deepEqual(observerRaidSafetySignals(raid,540,population),[]);
  const atBell=540+raid.sightedMinutes,signals=observerRaidSafetySignals(raid,atBell,population);
  assert.equal(signals.length,1);assert.equal(signals[0].channel,'alarm');assert.deepEqual(signals[0].affectedResidentIds,[]);
  let projected=observer.observe(canonical,0);
  for(let requested=1000;requested<=(raid.sightedMinutes+2)*1000;requested+=1000)projected=observer.observe(canonical,requested,{signalsAt:minute=>observerRaidSafetySignals(raid,minute,population)});
  assert.ok(projected.life.residents.some(row=>row.intent.reason==='safety'&&row.safety.knownSignals.some(signal=>signal.channel==='alarm')));
  assert.ok(canonical.life.residents.every(row=>row.safety.knownSignals.length===0));coherent(projected);
});

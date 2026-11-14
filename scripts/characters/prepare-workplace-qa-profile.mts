/** Creates a separate QA import artifact from a future actual CPU replay.
 * Reads originals only. No source model, rendered pose, actor, material,
 * event receipt, save/profile or game code is altered. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {parseInheritedSession} from '../../shared/legacy/aethelgard/inherited-session.ts';
import {parseVillagePopulationRuntime,serializeVillagePopulationRuntime,parseVillagePopulationEmergencyCheckpoint} from '../../shared/legacy/aethelgard/characters/village-population-runtime.ts';
import {parseObserverSave,serializeObserverSave} from '../../shared/legacy/aethelgard/observer/observer-save.ts';
import {startObserverClock,setObserverSpeed,observerOffset,observedMilliseconds} from '../../shared/legacy/aethelgard/observer/observer-time.ts';
const[inputFile,configFile,outputFile,origin='http://127.0.0.1:4191']=process.argv.slice(2);
if(!inputFile||!configFile||!outputFile)throw Error('Usage: tsx scripts/characters/prepare-workplace-qa-profile.mts <actual-replay.json> <normal-entry-config.json> <new-output.json> [origin]');
assert.notEqual(outputFile,inputFile);assert.notEqual(outputFile,configFile);
const config=JSON.parse(fs.readFileSync(configFile,'utf8')),originalBytes=fs.readFileSync(inputFile),input=JSON.parse(originalBytes.toString());
const inherited=parseInheritedSession(config.entryStorage.value);if(!inherited.ok)throw Error(inherited.error);
assert.equal(JSON.stringify([inherited.session.house.id,inherited.session.entry.at,inherited.session.banner]),config.worldKey,'Normal inherited entry must select this exact CPU world; namespace rewriting is forbidden.');
const parsed=parseVillagePopulationRuntime(JSON.stringify(input.canonical),{worldKey:config.worldKey,contentRevision:config.contentRevision});if(!parsed.ok)throw Error(parsed.error);
const canonical=parsed.snapshot,encoded=serializeVillagePopulationRuntime(canonical);if(!encoded.ok)throw Error(encoded.error);
const saved=parseObserverSave(serializeObserverSave(input.save),config.worldKey);for(const field of['buildingEmergency','buildingFire','buildingDamage','raidCursor','localRebuildOrders']as const)assert.equal(saved[field]?.status,'valid',`${field} must decode normally before capture.`);
if(saved.buildingEmergency?.status!=='valid')throw Error('Actual physical checkpoint absent.');
const checkpoint=parseVillagePopulationEmergencyCheckpoint(saved.buildingEmergency.state,config.worldKey);
assert.equal(checkpoint.contentRevision,config.contentRevision);assert.equal(checkpoint.canonicalEvidence.contentRevision,config.contentRevision);assert.equal(checkpoint.clock.createdAt,canonical.clock.createdAt);assert.equal(checkpoint.canonicalEvidence.clockConfig.createdAt,canonical.clock.createdAt);
// Public observer controls describe the saved actual time and hold it while
// shaders/assets prepare. They change no canonical/physical world fact.
const C=canonical.clock.simulatedElapsedMilliseconds,E=checkpoint.clock.simulatedElapsedMilliseconds;
const resumed=startObserverClock(C,E-C,0,saved.speed),held=setObserverSpeed(resumed,0,0);
assert.equal(observedMilliseconds(held,600000),E);
const qaSave={...saved,speed:held.speed,offsetMilliseconds:observerOffset(held,C,0)},observerJSON=serializeObserverSave(qaSave),readback=parseObserverSave(observerJSON,config.worldKey);
assert.deepEqual(readback.buildingEmergency,saved.buildingEmergency);assert.deepEqual(readback.buildingFire,saved.buildingFire);assert.deepEqual(readback.buildingDamage,saved.buildingDamage);assert.deepEqual(readback.localRebuildOrders,saved.localRebuildOrders);
assert.deepEqual(fs.readFileSync(inputFile),originalBytes,'QA transport never rewrites the CPU replay.');
const result={scope:'Actual saved CPU test world through normal inherited/population/observer decoders. Separate QA profile only; observer hold/offset are transport controls, not generated actors, poses, resources, receipts or outcomes.',inputFile,configFile,origin,worldKey:config.worldKey,contentRevision:config.contentRevision,pageClockFixedTime:canonical.clock.lastObservedAt,sourceWorldMinute:checkpoint.clock.initialDayMinute+E/checkpoint.clock.millisecondsPerWorldMinute,observerTransport:{originalSpeed:saved.speed,originalOffset:saved.offsetMilliseconds,heldSpeed:qaSave.speed,resumeOffset:qaSave.offsetMilliseconds},storageState:{cookies:[],origins:[{origin,localStorage:[config.entryStorage,{name:config.populationStorageKey,value:encoded.json},{name:config.observerStorageKey,value:observerJSON},{name:'crownfall.main-game.preferences',value:JSON.stringify({quality:'high',renderScale:75,motion:true,volume:20})}]}]}};
fs.writeFileSync(outputFile,JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({outputFile,worldMinute:result.sourceWorldMinute,fixedDateNow:result.pageClockFixedTime,observer:result.observerTransport,keys:result.storageState.origins[0].localStorage.map(v=>v.name)}));

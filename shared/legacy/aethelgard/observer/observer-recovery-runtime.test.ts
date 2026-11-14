import test from 'node:test';import assert from 'node:assert/strict';
import {EALDHOLT_VILLAGE_POPULATION as population} from '../characters/village-population';
import {EMPTY_OBSERVER_SAVE,parseObserverSave,serializeObserverSave} from './observer-save';
import {createVillageChronicle} from './village-chronicle';
import {createPopulationRaidRoster,startRaid} from './bandit-raid';
import {advanceObserverRaidRecovery,projectObserverRecoveryResidents} from './observer-recovery-runtime';
const worldKey='shared-observer-recovery-world',site={index:0,bearing:'east' as const,buildingBinding:{catalogueId:'test-desktop-source',sourceSha256:'a'.repeat(64),profile:'desktop' as const,buildingId:'test-door-0',siteIndex:0}};
const input={worldKey,profile:'desktop' as const,population,targetMinute:800,pendingPopulationMilliseconds:0,sites:[site]};
test('Desktop uses the same pure engine and retains caller chronicle bookkeeping without a second clock',()=>{
 const chronicle={...createVillageChronicle(),lastSlots:{'test-speaker':4},lastWeather:'rain' as const,serial:500},result=advanceObserverRaidRecovery(EMPTY_OBSERVER_SAVE,{...input,chronicle});
 assert.equal(result.status,'ready');assert.deepEqual(result.chronicle.lastSlots,chronicle.lastSlots);assert.equal(result.chronicle.lastWeather,'rain');assert.ok(result.chronicle.serial>=500);assert.equal(result.save.entries,result.chronicle.entries);assert.equal(result.processedMinute,800);assert.equal(result.residents?.length,100);
 assert.equal(advanceObserverRaidRecovery(result.save,{...input,profile:['desktop'] as unknown as 'desktop',chronicle:result.chronicle}).status,'blocked');
});
test('a known sky command is retained until its chronological window is processed, even when target time is later',()=>{
 const adopted=advanceObserverRaidRecovery(EMPTY_OBSERVER_SAVE,input).save,weather={kind:'storm' as const,untilMinute:5*1440};
 const first=advanceObserverRaidRecovery({...adopted,weather},{...input,targetMinute:12*1440});assert.equal(first.status,'catching-up');assert.ok(first.processedMinute<weather.untilMinute);assert.deepEqual(first.save.weather,weather);
 assert.ok(first.realmEvents.length>0);assert.ok(first.realmEvents.every(event=>Number.isSafeInteger(event.minute)&&event.minute>=input.targetMinute&&event.minute<=first.processedMinute));assert.ok(first.realmEvents.some(event=>event.houseId));
 const second=advanceObserverRaidRecovery(parseObserverSave(serializeObserverSave(first.save),worldKey),{...input,targetMinute:12*1440});assert.ok(second.processedMinute>=weather.untilMinute);assert.equal(second.save.weather,null);
});
test('current dialogue overlays decorate the caller live sample without overwriting canonical facts or inventing bodies',()=>{
 const raid=startRaid({worldKey,minute:1300,serial:0,provoked:false,watchAtPost:false,sites:[site]}),resident=population.residents.find(row=>row.group!=='guards-military')!;
 const live=[{residentId:resident.id,activity:'Asleep at home.',scheduledPlaceId:resident.homePlaceId,slotIndex:0}],before=JSON.stringify(live),projected=projectObserverRecoveryResidents({realm:EMPTY_OBSERVER_SAVE.realm,raid},1310,live,createPopulationRaidRoster(population));
 assert.equal(JSON.stringify(live),before);assert.equal(projected[0].alarm,true);assert.equal('position'in projected[0],false);assert.notEqual(projected[0].activity,live[0].activity);
});

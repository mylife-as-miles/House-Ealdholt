import test from 'node:test';import assert from 'node:assert/strict';
import {EALDHOLT_VILLAGE_POPULATION as population} from '../characters/village-population';
import {createPopulationRealmRoster,outingForDay} from './neighbour-houses';
import {startRaid,RAID_APPROACH_MINUTES,raidEndMinute} from './bandit-raid';
import {sampleObserverRaidResidents,sampleObserverRaidWeather,observerRaidWeatherOverride,observerRaidRealmCheckpoints,observerRaidPhaseCheckpoints} from './observer-raid-observation';
test('event residents are only stable authored routines and never current life, position or arrival facts',()=>{
 const before=JSON.stringify(population),first=sampleObserverRaidResidents(population,1300),later=sampleObserverRaidResidents(population,1300+1440);
 assert.deepEqual(first,later);assert.equal(first.length,100);assert.equal(JSON.stringify(population),before);
 for(const row of first){assert.deepEqual(Object.keys(row).sort(),['activity','residentId','scheduledPlaceId','slotIndex']);const resident=population.residents.find(person=>person.id===row.residentId)!;assert.equal(row.activity,resident.registry.routine[row.slotIndex].activity);assert.ok(Object.isFrozen(row));}
 assert.notDeepEqual(first,sampleObserverRaidResidents(population,600));assert.throws(()=>sampleObserverRaidResidents(population,-1));
});
test('seeded weather and a known command use the exact event minute without backdating a later command',()=>{
 const command={kind:'storm' as const,untilMinute:1500};assert.equal(observerRaidWeatherOverride(command,1259),undefined);assert.ok(observerRaidWeatherOverride(command,1260));assert.equal(observerRaidWeatherOverride(command,1500),undefined);
 assert.deepEqual(sampleObserverRaidWeather('world',1259,command),sampleObserverRaidWeather('world',1259));assert.equal(sampleObserverRaidWeather('world',1260,command).storm,true);assert.equal(sampleObserverRaidWeather('world',1499,command).weather,'rain');assert.deepEqual(sampleObserverRaidWeather('world',1500,command),sampleObserverRaidWeather('world',1500));
 assert.equal(sampleObserverRaidWeather('world',1400,{kind:'clear',untilMinute:1500}).storm,false);
});
test('bounded realm checkpoints preserve outings, returns, day edges and phase rain sampling',()=>{
 const roster=createPopulationRealmRoster(population),from=1440,to=4*1440,points=observerRaidRealmCheckpoints('world',from,to,roster),outing=outingForDay('world',1,roster)!;
 assert.ok(points.includes(outing.startMinute));assert.ok(points.includes(outing.endMinute));assert.ok(points.includes(2*1440));assert.equal(points[points.length-1],to);assert.ok(points.length<40);assert.equal(new Set(points).size,points.length);assert.ok(points.every((at,i)=>at>from&&(!i||at>points[i-1])));
 const raid=startRaid({worldKey:'world',minute:1300,serial:0,provoked:false,watchAtPost:true,sites:[]}),phase=observerRaidPhaseCheckpoints(raid,1300,raidEndMinute(raid));
 for(let minute=1301;minute<=1300+raid.sightedMinutes+RAID_APPROACH_MINUTES;minute++)assert.ok(phase.includes(minute));assert.ok(phase.includes(raidEndMinute(raid)));assert.ok(phase.length<=53);
 assert.ok(observerRaidPhaseCheckpoints({...raid,stormed:true},1300,raidEndMinute(raid)).length<=4);assert.throws(()=>observerRaidRealmCheckpoints('world',0,17*1440,roster));assert.throws(()=>observerRaidPhaseCheckpoints({...raid,sightedMinutes:100000},1300,2000));
});

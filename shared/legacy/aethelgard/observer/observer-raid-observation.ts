import type {VillagePopulation} from '../characters/village-population';
import {sampleWorldEnvironment} from '../environment/world-environment-state';
import {OBSERVER_WEATHER_MINUTES,weatherOverride,type ObserverWeatherCommand} from './observer-time';
import type {ChronicleResident} from './village-chronicle';
import {outingForDay,realmCandidates,type RealmRoster} from './neighbour-houses';
import {RAID_APPROACH_MINUTES,RAID_CLASH_MINUTES,RAID_SIGHTED_MINUTES,raidEndMinute,type BanditRaid} from './bandit-raid';

/** Narrative event projection only. The authored routine determines guards'
 * expected watch/sleep state identically for bulk and sliced catch-up. These
 * rows contain no position, journey, arrival, employment or labour evidence. */
export function sampleObserverRaidResidents(population:VillagePopulation,absoluteMinute:number):readonly ChronicleResident[]{
  if(!Number.isSafeInteger(absoluteMinute)||absoluteMinute<0)throw Error('Raid observation needs an absolute whole world minute.');
  const dayMinute=absoluteMinute%1440;
  return Object.freeze(population.residents.map(resident=>{const slotIndex=resident.registry.routine.findIndex(slot=>slot.startMinute<=dayMinute&&dayMinute<slot.endMinute),slot=resident.registry.routine[slotIndex];
    if(!slot)throw Error('Raid observation needs a complete authored resident routine.');
    return Object.freeze({residentId:resident.id,activity:slot.activity,scheduledPlaceId:slot.placeId,slotIndex});}));
}
/** The current saved sky command records its240-minute lifetime, not a complete
 * weather-command history. Never project a later command into an earlier raid. */
export function observerRaidWeatherOverride(command:ObserverWeatherCommand|null|undefined,absoluteMinute:number){
  return command&&absoluteMinute>=command.untilMinute-OBSERVER_WEATHER_MINUTES?weatherOverride(command,absoluteMinute):undefined;
}
export function sampleObserverRaidWeather(worldKey:string,absoluteMinute:number,command?:ObserverWeatherCommand|null){
  if(!Number.isSafeInteger(absoluteMinute)||absoluteMinute<0||!worldKey)throw Error('Raid weather needs world identity and absolute time.');
  const time={absoluteWorldMinute:absoluteMinute,fractionalMinute:0,dayIndex:Math.floor(absoluteMinute/1440),dayMinute:absoluteMinute%1440,elapsedWorldMinutes:absoluteMinute,deferredMilliseconds:0};
  const environment=sampleWorldEnvironment(time,worldKey,observerRaidWeatherOverride(command,absoluteMinute));
  return{weather:environment.weather,storm:environment.weather==='rain'};
}

/** Source-time narrative checkpoints stop a long poll skipping an outing's
 * return/regard or the realm's existing two-day history clamp. No travel proof. */
export function observerRaidRealmCheckpoints(worldKey:string,from:number,to:number,roster:RealmRoster):readonly number[]{
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from||to-from>16*1440)throw Error('Realm checkpoint window must be bounded and monotonic.');
  const points=new Set<number>([to]),add=(at:number)=>{if(at>from&&at<=to)points.add(at);};
  for(let day=Math.floor(from/1440);day<=Math.floor(to/1440);day++){add(day*1440);for(const candidate of realmCandidates(worldKey,day))add(candidate.minute);const outing=outingForDay(worldKey,day,roster);if(outing){add(outing.startMinute);add(outing.endMinute);}}
  return Object.freeze([...points].sort((a,b)=>a-b));
}
/** Check all previously unseen whole-minute rain during the at-most50-minute
 * sighting/approach interval, then exact phase edges. Bulk and sliced polls
 * therefore latch the same extinguishing rain and choose the same clash time. */
export function observerRaidPhaseCheckpoints(raid:BanditRaid,from:number,to:number):readonly number[]{
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from||to-from>16*1440||!Number.isSafeInteger(raid.startMinute)||raid.startMinute<0||![RAID_SIGHTED_MINUTES.manned,RAID_SIGHTED_MINUTES.unmanned].includes(raid.sightedMinutes as 20|5))throw Error('Raid phase window must retain qualified bounded times.');
  const approach=raid.startMinute+raid.sightedMinutes,clash=approach+RAID_APPROACH_MINUTES,settled=clash+RAID_CLASH_MINUTES;
  const points=new Set<number>(),add=(at:number)=>{if(at>from&&at<=to)points.add(at);};
  if(!raid.stormed&&raid.outcome===null)for(let at=Math.max(Math.floor(from)+1,raid.startMinute);at<=Math.min(to,clash);at++)add(at);
  for(const at of[approach,clash,settled,raidEndMinute(raid)])add(at);
  return Object.freeze([...points].sort((a,b)=>a-b));
}

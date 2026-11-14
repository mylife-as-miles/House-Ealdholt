import type {VillagePopulation} from '../characters/village-population';
import {advanceRaid,createPopulationRaidRoster,startRaid,watchPostManned,raidResident,RAID_HISTORY_LIMIT,type RaidSiteChoice,type RaidRoster} from './bandit-raid';
import {advanceRealm,afterRaid,createPopulationRealmRoster,raidAid,outingResident,type RealmEvent} from './neighbour-houses';
import {createVillageChronicle,recordEvents,rememberAll,type VillageChronicle,type ChronicleResident} from './village-chronicle';
import {createVillageBuildingDamage,stepVillageBuildingDamage,parseBuildingDamageBinding} from './building-damage';
import {planObserverNightlyRaids} from './observer-raid-cursor';
import {sampleObserverRaidResidents,sampleObserverRaidWeather,observerRaidRealmCheckpoints,observerRaidPhaseCheckpoints} from './observer-raid-observation';
import type {ObserverSave} from './observer-save';
import {advanceBuildingDisasterSession,type AdvanceBuildingDisasterInput} from './building-disaster-session';
import type {BuildingConflagrationEvent} from './building-conflagration';

export type ObserverRecoveryStatus='ready'|'catching-up'|'waiting-population'|'waiting-source'|'blocked';

function observationAt(population:VillagePopulation,worldKey:string,at:number,saved:ObserverSave){return{residents:sampleObserverRaidResidents(population,at),...sampleObserverRaidWeather(worldKey,at,saved.weather)};}
export function observerRecoverySitesReady(sites:readonly RaidSiteChoice[]|null,profile:'desktop'|'quest'):sites is readonly RaidSiteChoice[]{
  return!!sites&&sites.length>0&&sites.length<=512&&sites.every(site=>{try{const b=parseBuildingDamageBinding(site.buildingBinding);return b.profile===profile&&b.siteIndex===site.index;}catch{return false;}});
}
export interface ObserverRaidRecoveryInput {
 readonly worldKey:string;readonly profile:'desktop'|'quest';readonly population:VillagePopulation;readonly targetMinute:number;
 readonly pendingPopulationMilliseconds:number;readonly sites:readonly RaidSiteChoice[]|null;readonly chronicle?:VillageChronicle;
 /** Optional capability: once adopted it cannot silently fall back to an
  * older recovery owner that does not know the complete source catalogue. */
 readonly buildings?:AdvanceBuildingDisasterInput['buildings'];
 readonly emergencyCheckpoint?:AdvanceBuildingDisasterInput['emergencyCheckpoint'];
 readonly firefighting?:AdvanceBuildingDisasterInput['firefighting'];readonly repairs?:AdvanceBuildingDisasterInput['repairs'];
}
export function advanceObserverRaidRecovery(saved:ObserverSave,input:ObserverRaidRecoveryInput):{save:ObserverSave;status:ObserverRecoveryStatus;error:string|null;processedMinute:number;targetMinute:number;pendingMinutes:number;chronicle:VillageChronicle;residents:readonly ChronicleResident[]|null;realmEvents:readonly (RealmEvent&{readonly minute:number})[];fireEvents?:readonly BuildingConflagrationEvent[]}{
  const {worldKey,population,sites,targetMinute,profile}=input;
  const held=(status:ObserverRecoveryStatus,error:string|null)=>{const processedMinute=saved.raidCursor?.status==='valid'?saved.raidCursor.state.resolvedMinute:targetMinute;return{save:saved,status,error,processedMinute,targetMinute,pendingMinutes:Math.max(0,targetMinute-processedMinute),chronicle:input.chronicle??createVillageChronicle(saved),residents:null,realmEvents:[]};};
  if(profile!=='desktop'&&profile!=='quest')return held('blocked','Recovery requires the exact source platform.');
  if(saved.buildingDamage?.status==='invalid')return held('blocked','Saved building damage is invalid; its original record is preserved.');
  if(saved.buildingFire?.status==='invalid'||saved.buildingEmergency?.status==='invalid'||saved.localRebuildOrders?.status==='invalid')return held('blocked','Saved disaster work is invalid; its original record is preserved.');
  if((saved.buildingFire||input.buildings!==undefined)&&!input.buildings?.length)return held('waiting-source','Building fire awaits its complete source catalogue.');
  if(!saved.raidCursor&&input.pendingPopulationMilliseconds>0)return held('waiting-population',null);
  const plan=planObserverNightlyRaids({worldKey,targetMinute,cursor:saved.raidCursor,damageMinute:saved.buildingDamage?.state.absoluteMinute});
  if(plan.status==='blocked')return held('blocked',plan.error);
  if(saved.realm.resolvedMinute>plan.fromMinute||plan.status!=='migrated'&&saved.realm.resolvedMinute!==plan.fromMinute)return held('blocked','Realm and nightly records need reconciliation.');
  // A verified platform catalogue must exist before future candidates are
  // consumed. Old foreign bindings remain saved, never mapped by site index.
  if(plan.due.length&&!observerRecoverySitesReady(sites,profile))return held('waiting-source',null);
  let alreadySettled=saved.raidSerial;
  if(saved.raid&&saved.raid.outcome===null){const serial=Number(/^raid-\d+-(\d+)$/u.exec(saved.raid.id)?.[1]);if(Number.isSafeInteger(serial))alreadySettled=serial;}
  let damage=saved.buildingDamage?.state??createVillageBuildingDamage(worldKey,plan.fromMinute,alreadySettled);
  let disasterSave=saved,firePending=0;const fireEvents:BuildingConflagrationEvent[]=[];
  if(input.buildings){const initialized=advanceBuildingDisasterSession(disasterSave,{worldKey,absoluteMinute:plan.fromMinute,buildings:input.buildings});disasterSave=initialized.save;firePending=initialized.pendingMinutes;}
  let raid=saved.raid,raids=saved.raids,serial=saved.raidSerial,lastRaidDay=saved.lastRaidDay;
  // First feature adoption anchors new random realm happenings at this same
  // explicit migration minute. Existing houses, commands, outings and news stay.
  let realm=plan.status==='migrated'?{...saved.realm,resolvedMinute:plan.fromMinute}:saved.realm;
  let chronicle=input.chronicle??createVillageChronicle(saved),at=plan.fromMinute,shown:readonly ChronicleResident[]|null=null;const realmEvents:(RealmEvent&{readonly minute:number})[]=[];
  const raidRoster=createPopulationRaidRoster(population),realmRoster=createPopulationRealmRoster(population);
  const stepAt=(minute:number)=>{
    const sample=observationAt(population,worldKey,minute,saved),beyond=advanceRealm(realm,{worldKey,minute,residents:sample.residents,roster:realmRoster});realm=beyond.realm;shown=beyond.residents;
    for(const event of beyond.events){chronicle=recordEvents(chronicle,minute,event.kind,[event]);realmEvents.push({...event,minute});}chronicle=rememberAll(chronicle,beyond.memories);
    let outcome:Parameters<typeof stepVillageBuildingDamage>[1]['damageOutcome']=null,aid:Parameters<typeof stepVillageBuildingDamage>[1]['rebuildingAid']=null;
    if(raid){const step=advanceRaid(raid,{minute,residents:beyond.residents,roster:raidRoster,storm:sample.storm,aid:raidAid(realm)});raid=step.raid;outcome=step.damageOutcome;shown=step.residents;
      chronicle=rememberAll(recordEvents(chronicle,minute,'threat',step.events),step.memories);
      if(step.record){raids=[...raids,step.record].slice(-RAID_HISTORY_LIMIT);const word=afterRaid(realm,step.record,minute);realm=word.realm;aid=word.rebuildingAid;chronicle=recordEvents(chronicle,minute,'realm',word.events);for(const event of word.events)realmEvents.push({...event,minute});}}
    damage=stepVillageBuildingDamage(damage,{absoluteMinute:minute,damageOutcome:outcome,rebuildingAid:aid});
    if(input.buildings){
      const checkpoint=input.emergencyCheckpoint&&Math.floor(input.emergencyCheckpoint.buildingEmergency.absoluteMinute)<=minute?input.emergencyCheckpoint:undefined;
      const fire=advanceBuildingDisasterSession({...disasterSave,raid,raidSerial:serial,buildingDamage:{status:'valid',state:damage}},{worldKey,absoluteMinute:minute,buildings:input.buildings,damageOutcome:outcome,
        emergencyCheckpoint:checkpoint,firefighting:input.firefighting?.filter(r=>r.atMinute<=minute),repairs:input.repairs?.filter(r=>r.atMinute<=minute),maxMinutes:1440});
      disasterSave=fire.save;firePending=fire.pendingMinutes;fireEvents.push(...fire.events);
      for(const event of fire.events){const text=event.kind==='spread'?'Fire spreads to another village building.':event.kind==='collapse'?'A burning building loses its supports and falls.':event.kind==='extinguishing'?'The building fire dies down.':event.kind==='repaired'?'The local repair crew finishes restoring the building.':'A village building catches fire.';
        chronicle=recordEvents(chronicle,event.minute,'threat',[{text}]);}
    }
    at=minute;
  };
  const until=(minute:number)=>{
    const startAt=at,realmPoints=observerRaidRealmCheckpoints(worldKey,at,minute,realmRoster);
    while(at<minute){const nextRealm=realmPoints.find(point=>point>at)??minute,nextRaid=raid?observerRaidPhaseCheckpoints(raid,at,minute)[0]??minute:minute;stepAt(Math.min(nextRealm,nextRaid));}
    if(startAt===minute)stepAt(minute);
  };
  // Migration consumes no old nightly candidates; legacy raid serials seed the
  // damage watermarks, so old narrative history cannot mint burns/resources.
  for(const due of plan.due){until(due.minute);if(!raid){const sample=observationAt(population,worldKey,due.minute,saved);raid=startRaid({worldKey,minute:due.minute,serial:serial++,provoked:false,watchAtPost:watchPostManned(sample.residents,raidRoster),sites:sites!});lastRaidDay=due.day;stepAt(due.minute);}}
  until(plan.processedMinute);
  const processedMinute=firePending&&disasterSave.buildingFire?.status==='valid'?Math.min(plan.processedMinute,disasterSave.buildingFire.state.absoluteMinute):plan.processedMinute,pendingMinutes=Math.max(plan.pendingMinutes,targetMinute-processedMinute);
  return{save:{...disasterSave,raid,raids,raidSerial:serial,lastRaidDay,realm,weather:saved.weather&&plan.processedMinute>=saved.weather.untilMinute?null:saved.weather,entries:chronicle.entries,memories:chronicle.memories,buildingDamage:{status:'valid',state:damage},raidCursor:plan.cursor},status:pendingMinutes?'catching-up':'ready',error:null,processedMinute,targetMinute,pendingMinutes,chronicle,residents:shown,realmEvents:Object.freeze(realmEvents),...(input.buildings?{fireEvents:Object.freeze(fireEvents)}:{})};
}

/** Apply the current logical raid/outing overlay to the caller's OWN live
 * sample for dialogue once caught up. Never replace physical population data
 * with the historical routine-only residents returned by the engine. */
export function projectObserverRecoveryResidents(saved:Pick<ObserverSave,'realm'|'raid'>,minute:number,residents:readonly ChronicleResident[],roster:RaidRoster):readonly ChronicleResident[]{
  return residents.map(resident=>{const away=outingResident(saved.realm.outing,minute,resident);return saved.raid?raidResident(saved.raid,minute,away,roster):away;});
}

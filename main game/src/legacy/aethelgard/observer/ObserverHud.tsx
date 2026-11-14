import {applyNearMarketDelivery,applyPracticeMarketAction,marketVillagePricing} from '../../../../../shared/legacy/aethelgard/observer/market-village';
import {NearMarket} from './NearMarket';
import {ResidentConversation} from './ResidentConversation';
import {createMarket,marketPrices,quote,type MarketAction} from '../../../../../shared/legacy/aethelgard/observer/market-economy';
import {advanceObserverRaidRecovery,projectObserverRecoveryResidents,type ObserverRecoveryStatus} from '../../../../../shared/legacy/aethelgard/observer/observer-recovery-runtime';
import {buildingDamageKey,startBuildingRebuild} from '../../../../../shared/legacy/aethelgard/observer/building-damage';
import {BuildingRebuildPanel} from './BuildingRebuildPanel';
import {BuildingFirePanel} from './BuildingFirePanel';
import {advanceBuildingDisasterProjection} from '../../../../../shared/legacy/aethelgard/observer/building-disaster-projection';
import {buildingDisasterConditions,requestLocalBuildingRebuild} from '../../../../../shared/legacy/aethelgard/observer/building-disaster-session';
import {buildingDisasterIncidents,createBuildingDisasterFrame} from '../../../../../shared/legacy/aethelgard/observer/building-disaster-view';
/**
 * My Legacy's observer over House Ealdholt (the creator's direction of 10 November 2026): the player is an unseen
 * presence who watches the village live its own life and reaches in to change it. This is the observer's on-screen
 * hand: time (hold, as lived, faster), the sky (clear, cloud, rain, storm, or let it be), bandit raids (lure one, or
 * warn the village when one comes on its own), the neighbouring houses of Aethelgard (HousesPanel.tsx), the chronicle
 * of what the village does while it is watched, and one villager followed through their day with what they remember.
 * What the villagers say aloud floats up over the village as speech bubbles (speech-bubbles.ts, village-voices.ts); the
 * written chronicle starts folded away.
 *
 * It wears the Local Duel setup screen's design (play/MatchSetup.css): the same blurred panel under an orange rule,
 * quiet uppercase headings with small orange glyphs, large tiles with condensed numerals, rows with a colour stripe,
 * a diamond medallion, key chips and the same reveal.
 *
 * The villagers' routines, the population save and the seeded weather belong to the village (village-view.ts,
 * shared/legacy/aethelgard/characters). The observer only lays its clock and sky over them (VillageObserverLink) and
 * keeps its own record beside the population save (shared/legacy/aethelgard/observer).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EALDHOLT_VILLAGE_POPULATION } from "../../../../../shared/legacy/aethelgard/characters/village-population";
import type { VillagePopulationSample, VillagePopulationRuntime } from "../../../../../shared/legacy/aethelgard/characters/village-population-runtime";
import type {BuildingDamageBinding} from '../../../../../shared/legacy/aethelgard/observer/building-damage';
import { residentFollowAvailabilityText } from "../../../../../shared/legacy/aethelgard/observer/resident-watch";
import type { VillageResidentAvailability } from "../../../../../shared/legacy/aethelgard/characters/village-resident-availability";
import { displayPopulationActivity } from "../../../../../shared/legacy/aethelgard/characters/village-activity-presentation";
import {
  activeWeather, commandWeather, observedMilliseconds, observerOffset, OBSERVER_SPEEDS, OBSERVER_WEATHER_MINUTES, OBSERVER_WEATHERS,
  setObserverSpeed, startObserverClock, weatherOverride,
  type ObserverClock, type ObserverSpeed, type ObserverWeather, type ObserverWeatherCommand,
} from "../../../../../shared/legacy/aethelgard/observer/observer-time";
import {
  createVillageChronicle, formatChronicleTime, observeVillage, placePhrase, predicate, recordPower,
  type ChronicleKind, type ChronicleResident, type ChronicleRoster, type VillageChronicle,
} from "../../../../../shared/legacy/aethelgard/observer/village-chronicle";
import { observerRaidSafetySignals } from "../../../../../shared/legacy/aethelgard/observer/raid-safety";
import {
  createPopulationRaidRoster, raidDefenders, raidPhase, startRaid, watchPostManned, RAID_PHASES,
  type BanditRaid, type RaidOutcome, type RaidPhase, type RaidRecord,
} from "../../../../../shared/legacy/aethelgard/observer/bandit-raid";
import { EMPTY_OBSERVER_SAVE, observerSaveKey, parseObserverSave, serializeObserverSave, type ObserverSave } from "../../../../../shared/legacy/aethelgard/observer/observer-save";
import type { VillageWorldStatus } from "../../../../../shared/legacy/aethelgard/environment/world-status";
import type { EaldholtVillageView, VillageObserverLink } from "../village-view";
import type { RaidVisual } from "./raid-scene";
import {
  actOnHouse, messengerDestination, raidAid,
  type RealmAct, type RealmState,
} from "../../../../../shared/legacy/aethelgard/observer/neighbour-houses";
import { HousesPanel } from "./HousesPanel";
import { createVoices, speakVillage, type VoiceLine, type VoiceRoster, type VoiceState } from "../../../../../shared/legacy/aethelgard/observer/village-voices";
import { neighbourHouse } from "../../../../../shared/legacy/aethelgard/observer/neighbour-houses";
import { createSpeechBubbles, type SpeechBubbles } from "./speech-bubbles";
import { Glyph, tint } from "./glyphs";
import { ResidentWatchList } from "./ResidentWatchList";
import "./observer-hud.css";

const PEOPLE = new Map(EALDHOLT_VILLAGE_POPULATION.residents.map(resident => [resident.id, resident]));
const HOUSEHOLD_LABELS = new Map(EALDHOLT_VILLAGE_POPULATION.households.map(h => [h.id, h.label]));
const PLACES = new Map(EALDHOLT_VILLAGE_POPULATION.places.map(place => [place.id, place]));
const ROSTER: ChronicleRoster = {
  person: id => { const resident = PEOPLE.get(id); return resident ? { label: resident.label, major: resident.fidelityTier === "major" } : null; },
  place: id => { const place = PLACES.get(id); return place ? { label: place.label, kind: place.kind } : null; },
};
const RAID_ROSTER = createPopulationRaidRoster(EALDHOLT_VILLAGE_POPULATION);
const VOICE_ROSTER: VoiceRoster = {
  person: id => { const resident = PEOPLE.get(id); return resident ? { label: resident.label, guard: resident.group === "guards-military", major: resident.fidelityTier === "major",
    young: resident.ageBand === "child" || resident.ageBand === "adolescent", elder: resident.ageBand === "elder" } : null; },
  placeKind: id => PLACES.get(id)?.kind ?? null,
};
/** The chronicle is folded away unless the player has opened it (remembered on this device). */
const CHRONICLE_PREFERENCE = "crownfall.ealdholt.observer.chronicle";
const chronicleOpen = () => { try { return globalThis.localStorage?.getItem(CHRONICLE_PREFERENCE) === "open"; } catch { return false; } };
/** What the bubbles keep clear of. */
const BUBBLE_OBSTACLES = ".obs-chronicle, .obs-panel, .wf-house-identity, .wf-global-actions, .wf-village-dock, .obs-keys, .wf-tool-drawer";
const POLL_MILLISECONDS = 1000;
const SAVE_EVERY_POLLS = 5;

// ------------------------------------------------------------------ words
const SPEED_TILE: Record<ObserverSpeed, { value: string; unit: string; label: string }> = {
  0: { value: "", unit: "hold", label: "Hold time" },
  1: { value: "1×", unit: "lived", label: "Time as it is lived" },
  4: { value: "4×", unit: "swift", label: "Time at four times" },
  16: { value: "16×", unit: "fleet", label: "Time at sixteen times" },
};
const SPEED_POWER: Record<ObserverSpeed, string> = {
  0: "You hold time still over Ealdholt.",
  1: "You let time run as it is lived.",
  4: "You hurry the days along.",
  16: "You send the days racing past.",
};
const SKY: Record<ObserverWeather, { label: string; tint: string; power: string }> = {
  clear: { label: "Clear", tint: "#f2b84b", power: "You part the clouds over Ealdholt." },
  overcast: { label: "Cloud", tint: "#a9aeb2", power: "You draw cloud across the sky." },
  rain: { label: "Rain", tint: "#6f9be0", power: "You call rain down on Ealdholt." },
  storm: { label: "Storm", tint: "#9a7cff", power: "You call a storm down on Ealdholt." },
};
const KIND: Record<ChronicleKind, { label: string; tint: string }> = {
  power: { label: "You", tint: "#f87b00" },
  life: { label: "Followed", tint: "#f6c48a" },
  worship: { label: "Temple", tint: "#e7d39a" },
  journey: { label: "Road", tint: "#9fb38a" },
  gathering: { label: "Village", tint: "#b5b2ac" },
  sky: { label: "Sky", tint: "#8fb0c8" },
  threat: { label: "Raid", tint: "#e0533d" },
  realm: { label: "Houses", tint: "#56c2a6" },
};
const RAID_TINT = "#e0533d";
const PHASE_LABEL: Record<RaidPhase, string> = { sighted: "Sighted", approach: "Approach", clash: "Clash", aftermath: "After" };
const OUTCOME_LABEL: Record<RaidOutcome, string> = { repelled: "Driven off", plundered: "Plundered", burned: "Burned" };
const OUTCOME_PAST: Record<RaidOutcome, (target: string) => string> = {
  repelled: () => "were driven off", plundered: target => `plundered ${target}`, burned: target => `burned ${target}`,
};
const asleep = (activity: string) => /^asleep\b/i.test(activity.trim());

// ------------------------------------------------------------------ the record
function readSaveRecord(worldKey:string):{save:ObserverSave;raw:string|null;writable:boolean} {
  try {
    const storage=globalThis.localStorage;
    if(!storage)return{save:EMPTY_OBSERVER_SAVE,raw:null,writable:false};
    const raw=storage.getItem(observerSaveKey(worldKey));
    if(raw!==null){const value=JSON.parse(raw);if(!value||value.version!==1)return{save:EMPTY_OBSERVER_SAVE,raw,writable:false};}
    return{save:parseObserverSave(raw,worldKey),raw,writable:true};
  }catch{return{save:EMPTY_OBSERVER_SAVE,raw:null,writable:false};}
}

/** Drifting motes over the village, as on the menu and the setup screen; fixed so every visit looks the same. */
const MOTES = Array.from({ length: 16 }, (_, index) => {
  const seed = Math.sin(index * 91.7) * 43758.5453, unit = seed - Math.floor(seed);
  return { left: `${(index * 61 + 7) % 100}%`, size: 1.5 + unit * 2.5, duration: 14 + ((index * 7) % 11), delay: -((index * 13) % 23),
    drift: `${Math.round((unit - .5) * 140)}px`, color: index % 4 === 0 ? "#f7d58a" : "#f87b00" };
});

export type ObserverPanel = "powers" | "watch" | "houses" | "market";
export interface ObserverHudProps {
  /** The village view, once its world is ready; null until then. */
  view: EaldholtVillageView | null;
  /** Clock restoration may precede graphics; raids still require loaded source sites. */
  sourceReady: boolean;
  /** The confirmed entry's world key: the observer's record is kept per village. Remount the HUD when it changes. */
  worldKey: string;
  /** The sky as the village shows it now (the observer's command included). */
  sky: VillageWorldStatus["weather"] | null;
  /** What the panel shows: the observer's powers, the Watch list or the neighbouring houses (the last two open from the dock). */
  panel: ObserverPanel;
  onPanel(next: ObserverPanel): void;
  /** False while one of the village's own drawers (Views, Camera) has the right-hand side. */
  rightPanelFree: boolean;
  reducedMotion: boolean;
}

export function ObserverHud({ view, sourceReady, worldKey, sky, panel, onPanel, rightPanelFree, reducedMotion }: ObserverHudProps) {
  const initialRecord=useMemo(()=>readSaveRecord(worldKey),[worldKey]);
  const saved=initialRecord.save;
  const expectedStored=useRef(initialRecord.raw),storageWritable=useRef(initialRecord.writable);
  const disasterSaved=useRef(saved);
  const [disasterState,setDisasterState]=useState(saved);
  const projectedPopulation=useRef<VillagePopulationRuntime|null>(null);
  const sourceReadyRef = useRef(sourceReady); sourceReadyRef.current = sourceReady;
  const clock = useRef<ObserverClock | null>(null);
  const speedRef = useRef<ObserverSpeed>(saved.speed);
  const weather = useRef<ObserverWeatherCommand | null>(saved.weather);
  const minute = useRef<number | null>(null);
  const storeMilliseconds = useRef(0);
  const skyRef = useRef(sky); skyRef.current = sky;
  const chronicleRef = useRef<VillageChronicle | null>(null);
  chronicleRef.current ??= createVillageChronicle(saved);
  const followRef = useRef<string | null>(null);
  const [speed, setSpeed] = useState<ObserverSpeed>(saved.speed);
  const [command, setCommand] = useState<ObserverWeatherCommand | null>(saved.weather);
  const [chronicle, setChronicle] = useState<VillageChronicle>(chronicleRef.current);
  const [sample, setSample] = useState<VillagePopulationSample | null>(null);
  const [followId, setFollowId] = useState<string | null>(null);
  const [feedOpen, setFeedOpen] = useState(chronicleOpen);
  // Voices: what is being said, the bubbles it is shown in, and a neighbouring house's people in the village.
  const bubbleHost = useRef<HTMLDivElement>(null), bubbles = useRef<SpeechBubbles | null>(null);
  const voices = useRef<VoiceState>(createVoices()), visitors = useRef<{ kind: "traders" | "pilgrims" | "kin"; seat: string; until: number } | null>(null);
  const reduced = useRef(reducedMotion); reduced.current = reducedMotion;
  const [followAvailability, setFollowAvailability] = useState<VillageResidentAvailability | null>(null);
  // Bandits: the raid under way, past raids, and what each villager is doing while a raid holds them.
  const raidRef = useRef<BanditRaid | null>(saved.raid), raidsRef = useRef<readonly RaidRecord[]>(saved.raids);
  const raidSerial = useRef(saved.raidSerial), lastRaidDay = useRef(saved.lastRaidDay);
  const [raid, setRaid] = useState<BanditRaid | null>(saved.raid), [raids, setRaids] = useState<readonly RaidRecord[]>(saved.raids);
  const [shown, setShown] = useState<readonly ChronicleResident[]>([]);
  // The observed minute between polls, so torches move smoothly even at 16x.
  const tick = useRef({ minute: Number.NaN, observed: 0, perMinute: 4000 });
  // The neighbouring houses: how each regards Ealdholt and fares, and anyone out on the road to them.
  const realmRef = useRef<RealmState>(saved.realm);
  const [realm, setRealm] = useState<RealmState>(saved.realm);
  const roster = useMemo<ChronicleRoster>(() => ({ ...ROSTER, roadTo: (_residentId, day) => messengerDestination(realmRef.current, day)?.seat ?? null }), []);
  const beginRaidRef = useRef<((provoked: boolean, at: number, day: number, residents: readonly ChronicleResident[]) => boolean) | null>(null);
  const damageSaved=useRef(saved.buildingDamage),raidCursor=useRef(saved.raidCursor);
  const recoveryStatus=useRef<ObserverRecoveryStatus>('waiting-population');
  const [recovery,setRecovery]=useState<{status:ObserverRecoveryStatus;error:string|null;pending:number}>({status:'waiting-population',error:null,pending:0});
  const [damage,setDamage]=useState(saved.buildingDamage),[saveFailed,setSaveFailed]=useState(!initialRecord.writable);
  const [marketMode,setMarketMode]=useState<'practice'|'testnet'>('practice');
  const [marketMessage,setMarketMessage]=useState("Trade, keep your energy up, and supply 12 timber to the village repair stores.");
  const persistRef=useRef<(()=>void)|null>(null),refreshRecoveryRef=useRef<(()=>boolean)|null>(null),saveFailedRef=useRef(!initialRecord.writable);
  const rebindObserverRef=useRef<(()=>void)|null>(null);
  const emptyBuildings=useMemo(()=>Object.freeze([]),[]);
  const currentSave=():ObserverSave=>({
    ...disasterSaved.current,
    version:1,speed:speedRef.current,weather:weather.current,entries:chronicleRef.current!.entries,memories:chronicleRef.current!.memories,
    raid:raidRef.current,raids:raidsRef.current,raidSerial:raidSerial.current,lastRaidDay:lastRaidDay.current,realm:realmRef.current,
    buildingDamage:damageSaved.current,raidCursor:raidCursor.current,
    offsetMilliseconds:clock.current?observerOffset(clock.current,storeMilliseconds.current,performance.now()):saved.offsetMilliseconds,
  });
  const writeOwnedSave=(next:ObserverSave):boolean=>{
    try{
      const storage=globalThis.localStorage,key=observerSaveKey(worldKey);
      if(!storageWritable.current||!storage||storage.getItem(key)!==expectedStored.current){storageWritable.current=false;return false;}
      const encoded=serializeObserverSave(next);storage.setItem(key,encoded);
      if(storage.getItem(key)!==encoded){storageWritable.current=false;return false;}
      expectedStored.current=encoded;return true;
    }catch{return false;}
  };
  const sourceAvailable=(binding:Parameters<typeof buildingDamageKey>[0])=>!!view?.raidSites().some(site=>site.buildingBinding&&buildingDamageKey(site.buildingBinding)===buildingDamageKey(binding));


  // The observed clock and sky, lent to the village view. The clock starts the first time the view asks, from the
  // village's own clock plus the offset the observer left last time.
  useEffect(() => {
    if (!view) return;
    const now = () => performance.now();
    const link: VillageObserverLink = {
      simulatedMilliseconds(store) {
        storeMilliseconds.current = store;
        clock.current ??= startObserverClock(store, saved.offsetMilliseconds, now(), speedRef.current);
        return observedMilliseconds(clock.current, now());
      },
      override: at => at === undefined && minute.current === null ? undefined : weatherOverride(weather.current, at ?? minute.current!),
      speed: () => speedRef.current,
      runtimeSnapshot:()=>projectedPopulation.current,
      buildingDisasterConditions:()=>buildingDisasterConditions(currentSave()),
      buildingFires:()=>disasterSaved.current.buildingFire?.status==='valid'?disasterSaved.current.buildingFire.state.buildings:null,
      safetySignals: at => observerRaidSafetySignals(raidRef.current, at, EALDHOLT_VILLAGE_POPULATION),
      buildingConditions:()=>damageSaved.current?.status==='valid'?damageSaved.current.state.buildings:emptyBuildings,
      raid: (absoluteMinute): RaidVisual | null => {
        const current = raidRef.current;
        if (!current || !clock.current || !Number.isFinite(tick.current.minute)) return null;
        const at = absoluteMinute ?? tick.current.minute + (observedMilliseconds(clock.current, now()) - tick.current.observed) / tick.current.perMinute;
        const state = raidPhase(current, at);
        return state ? { siteIndex: current.target.siteIndex, buildingBinding:current.target.buildingBinding, phase: state.phase, progress: state.progress, outcome: current.outcome, size: current.size, seed: current.seed,
          allies: current.allies ? { count: current.allies.riders, bearing: current.allies.bearing } : null } : null;
      },
    };
    const persist = () => {
      view.sampleResidents(); // refreshes the village's own clock reading before the offset is taken
      saveFailedRef.current=!writeOwnedSave(currentSave());setSaveFailed(saveFailedRef.current);
    };
    persistRef.current=persist;
    rebindObserverRef.current=()=>view.setObserver(link);
    view.setObserver(link);
    let polls = 0;
    // Speech bubbles over the village: each speaker's own position when their figure is placed, else their place in the village.
    const speech = bubbleHost.current ? createSpeechBubbles(bubbleHost.current, {
      project: (point, out) => view.project(point, out), reducedMotion: () => reduced.current,
      obstacles: () => [...(bubbleHost.current?.closest(".ealdholt-preview")?.querySelectorAll(BUBBLE_OBSTACLES) ?? [])],
    }) : null;
    bubbles.current = speech;
    const timers = new Set<number>();
    const show = (line: VoiceLine, sample: VillagePopulationSample, delay: number) => {
      const person = PEOPLE.get(line.residentId), placed = sample.residents.find(resident => resident.residentId === line.residentId)?.position;
      const anchor = placed ? [placed[0], placed[1] + 1.9, placed[2]] as const : view.voiceAnchor(line.placeId, line.residentId);
      if (!speech || !person || !anchor) return;
      const timer = window.setTimeout(() => { timers.delete(timer); speech.say({ speaker: line.residentId, name: person.label, text: line.text, tone: line.tone }, anchor); }, delay);
      timers.add(timer);
    };
    const beginRaid = (provoked: boolean, at: number, day: number, residents: readonly ChronicleResident[]) => {
      const sites = view.raidSites();
      if (!sourceReadyRef.current || !sites.some(site => !!site.buildingBinding)) return false;
      raidRef.current = startRaid({ worldKey, minute: at, serial: raidSerial.current++, provoked, watchAtPost: watchPostManned(residents, RAID_ROSTER), sites });
      lastRaidDay.current = day; setRaid(raidRef.current);
      return true;
    };
    beginRaidRef.current = beginRaid;
    const poll = () => {
      if(!storageWritable.current){
        saveFailedRef.current=true;setSaveFailed(true);recoveryStatus.current='blocked';
        setRecovery({status:'blocked',error:'The saved village changed or storage is unavailable. Reload to reconcile it.',pending:0});return false;
      }
      const canonical=view.readCanonicalPopulation();
      // Read the canonical cursor before computing the observer offset. Taking
      // the save first would accumulate a stale offset at each poll.
      const requested=canonical?Math.round(link.simulatedMilliseconds(canonical.clock.simulatedElapsedMilliseconds)):null;
      const beforeSave=currentSave(),sites=view.raidSites();
      let next:VillagePopulationSample|null=null,result:ReturnType<typeof advanceObserverRaidRecovery>,compositeCommitted=false;
      try{
        const source=view.buildingDisasterSource([]);
        if(canonical&&source){
          const observed=view.readObservedPopulation();
          const projected=advanceBuildingDisasterProjection(beforeSave,{
            canonical,requestedMilliseconds:requested!,sites,
            buildings:source.buildings,site:source.site,workplaceFrame:source.workplaceFrame,...(observed?{initialObserved:observed}:{}),maxWorldMinutes:4,
            repairStationsAt:(staged,absoluteMinute)=>view.buildingDisasterSource(buildingDisasterIncidents(staged,absoluteMinute))?.stations??null,
            frameAt:(staged,absoluteMinute)=>{
              const exact=view.buildingDisasterSource(buildingDisasterIncidents(staged,absoluteMinute));
              return exact?createBuildingDisasterFrame(staged,{...exact,absoluteMinute,populationSnapshot:canonical,
                secondsPerWorldMinute:canonical.clock.millisecondsPerWorldMinute/1000}):null;
            },
          });
          // Persist the entire causal interval before publishing its new
          // population, damage or work receipts to the scene.
          if(!writeOwnedSave(projected.save)){
            saveFailedRef.current=true;setSaveFailed(true);recoveryStatus.current='blocked';
            setRecovery({status:'blocked',error:'Building recovery could not be saved; this interval is held.',pending:projected.pendingMinutes});return false;
          }
          saveFailedRef.current=false;setSaveFailed(false);
          compositeCommitted=true;
          if(projected.snapshot)projectedPopulation.current=projected.snapshot;
          next=projected.sample;
          result={...projected,chronicle:createVillageChronicle(projected.save),residents:null,realmEvents:projected.realmEvents};
        }else{
          if(canonical||beforeSave.buildingFire){recoveryStatus.current='waiting-source';setRecovery({status:'waiting-source',error:'Waiting for the saved building source.',pending:0});return false;}
          next=view.sampleResidents();if(!next)return false;
          result=advanceObserverRaidRecovery(beforeSave,{worldKey,profile:sites[0]?.buildingBinding?.profile??'desktop',population:EALDHOLT_VILLAGE_POPULATION,
            targetMinute:next.time.absoluteWorldMinute,pendingPopulationMilliseconds:next.observation?.pendingMilliseconds??next.time.deferredMilliseconds,sites,chronicle:chronicleRef.current!});
        }
      }catch{recoveryStatus.current='blocked';setRecovery({status:'blocked',error:'Village recovery is held; the existing record is preserved.',pending:0});return false;}
      if(!next){recoveryStatus.current=result.status;setRecovery({status:result.status,error:result.error,pending:result.pendingMinutes});return false;}
      const at=next.time.absoluteWorldMinute;minute.current=at;
      if(clock.current){const observed=next.observation?.completedMilliseconds??observedMilliseconds(clock.current,now());
        tick.current={minute:at+next.time.fractionalMinute,observed,perMinute:next.observation?.millisecondsPerWorldMinute??4000};}
      disasterSaved.current=result.save;setDisasterState(result.save);
      recoveryStatus.current=result.status;setRecovery({status:result.status,error:result.error,pending:result.pendingMinutes});
      chronicleRef.current=result.chronicle;realmRef.current=result.save.realm;raidRef.current=result.save.raid;raidsRef.current=result.save.raids;
      raidSerial.current=result.save.raidSerial;lastRaidDay.current=result.save.lastRaidDay;
      damageSaved.current=result.save.buildingDamage;raidCursor.current=result.save.raidCursor;weather.current=result.save.weather;
      setDamage(damageSaved.current);setRaid(raidRef.current);setRaids(raidsRef.current);setCommand(weather.current);setChronicle(chronicleRef.current);
      for(const event of result.realmEvents){
        const seat=event.houseId?neighbourHouse(event.houseId)?.seat:undefined;
        if(seat&&at<event.minute+75&&(event.happening==='traders'||event.happening==='pilgrims'||event.happening==='kin'))visitors.current={kind:event.happening,seat,until:event.minute+75};
      }
      const residents=result.status==='ready'?projectObserverRecoveryResidents(result.save,at,next.residents,RAID_ROSTER):next.residents;
      if(!compositeCommitted&&(result.save.buildingFire!==beforeSave.buildingFire||result.save.buildingEmergency!==beforeSave.buildingEmergency||result.save.raid!==beforeSave.raid||
        (result.save.buildingDamage?.status==='valid'?result.save.buildingDamage.state:null)!==(beforeSave.buildingDamage?.status==='valid'?beforeSave.buildingDamage.state:null)))persist();
      // The chronicle reads the sky as the village actually shows it; until the view reports one, it waits.
      if (skyRef.current&&result.status==='ready') {
        chronicleRef.current = observeVillage(chronicleRef.current!, {
          minute: at, residents, weather: skyRef.current, storm: weather.current?.kind === "storm", followId: followRef.current,
        }, roster);
        setChronicle(chronicleRef.current);
      }
      // What the villagers say aloud, as bubbles over the village. A reply follows its opener a moment later.
      if (visitors.current && at >= visitors.current.until) visitors.current = null;
      const phase = raidRef.current ? raidPhase(raidRef.current, at) : null;
      const voiced = result.status==='ready'?speakVillage(voices.current, { worldKey, minute: at, residents, followId: followRef.current, memories: chronicleRef.current!.memories,
        sky: activeWeather(weather.current, at)?.kind === "storm" ? "storm" : skyRef.current ?? "clear", visitors: visitors.current,
        raid: raidRef.current && phase ? { phase: phase.phase, outcome: raidRef.current.outcome, allies: raidRef.current.allies?.house ?? null } : null,
        maxLines: speedRef.current > 1 ? 1 : 2 }, VOICE_ROSTER):{state:voices.current,lines:[]};
      voices.current = voiced.state;
      let openers = 0;
      for (const line of voiced.lines) show(line, next, line.replyTo ? 1500 + openers * 450 : openers++ * 450);
      setRealm(realmRef.current);
      setSample(next); setShown(residents);
      if (followRef.current) setFollowAvailability(view.residentAvailability(followRef.current));
      if (++polls % SAVE_EVERY_POLLS === 0&&!compositeCommitted) persist();
      return result.status==='ready'&&!saveFailedRef.current;
    };
    refreshRecoveryRef.current=poll;
    poll();
    const timer = window.setInterval(poll, POLL_MILLISECONDS);
    const storageChanged=(event:StorageEvent)=>{
      if(event.key!==null&&event.key!==observerSaveKey(worldKey))return;
      try{if(globalThis.localStorage?.getItem(observerSaveKey(worldKey))===expectedStored.current)return;}catch{/* held below */}
      storageWritable.current=false;saveFailedRef.current=true;setSaveFailed(true);
      recoveryStatus.current='blocked';setRecovery({status:'blocked',error:'The saved village changed in another tab. Reload before issuing orders.',pending:0});
    };
    globalThis.addEventListener('storage',storageChanged);
    globalThis.addEventListener("pagehide", persist);
    return () => {
      window.clearInterval(timer); globalThis.removeEventListener("pagehide", persist);
      globalThis.removeEventListener('storage',storageChanged);
      persist();persistRef.current=null;refreshRecoveryRef.current=null;rebindObserverRef.current=null; view.follow(null); view.setObserver(null); beginRaidRef.current = null;
      for (const timer of timers) window.clearTimeout(timer);
      speech?.dispose(); bubbles.current = null;
    };
  }, [view, worldKey, saved, roster]);

  const power = (text: string) => {
    chronicleRef.current = recordPower(chronicleRef.current!, minute.current ?? 0, text);
    setChronicle(chronicleRef.current);persistRef.current?.();
  };
  const chooseSpeed = (next: ObserverSpeed) => {
    if (next === speedRef.current) return;
    if (clock.current) clock.current = setObserverSpeed(clock.current, next, performance.now());
    speedRef.current = next; setSpeed(next); power(SPEED_POWER[next]);
  };
  const returnToPresent=()=>{
    const canonical=view?.readCanonicalPopulation();
    // An earlier analytic view has no recorded physical arrivals. This is an
    // explicit observation command, never a rewrite or rewind of world facts.
    if(!canonical||disasterSaved.current.buildingEmergency||disasterSaved.current.buildingFire||!storageWritable.current)return;
    const next={...currentSave(),offsetMilliseconds:0,speed:1 as const};
    if(!writeOwnedSave(next)){saveFailedRef.current=true;setSaveFailed(true);return;}
    disasterSaved.current=next;setDisasterState(next);
    storeMilliseconds.current=canonical.clock.simulatedElapsedMilliseconds;
    clock.current=startObserverClock(storeMilliseconds.current,0,performance.now(),1);
    speedRef.current=1;setSpeed(1);
    // Discard only the old analytic observation cursor. Reuse the normal view
    // link so the next projection starts at the actual saved source boundary.
    rebindObserverRef.current?.();refreshRecoveryRef.current?.();
  };
  const chooseSky = (next: ObserverWeather | null) => {
    if (minute.current === null||recoveryStatus.current!=='ready') return;
    if (next === null) {
      if (!weather.current) return;
      weather.current = null; setCommand(null); power("You give the sky back to itself.");
      return;
    }
    weather.current = commandWeather(next, minute.current); setCommand(weather.current); power(SKY[next].power);
  };
  const lureBandits = () => {
    if (recoveryStatus.current!=='ready'||raidRef.current || minute.current === null || !sample || !beginRaidRef.current) return;
    if (!beginRaidRef.current(true, minute.current, Math.floor(minute.current / 1440), shown.length ? shown : sample.residents)) return;
    power("You whisper of Ealdholt's full granary to the outlaws in the Marches.");
  };
  const warnVillage = () => {
    const current = raidRef.current, state = current && minute.current !== null ? raidPhase(current, minute.current) : null;
    if (recoveryStatus.current!=='ready'||!current || current.warned || !state || (state.phase !== "sighted" && state.phase !== "approach")) return;
    raidRef.current = { ...current, warned: true }; setRaid(raidRef.current);
    power("You send the guard captain a dream of torches on the road.");
  };
  const actOn = (houseId: string, act: RealmAct) => {
    if (minute.current === null||recoveryStatus.current!=='ready') return;
    const result = actOnHouse(realmRef.current, houseId, act, minute.current);
    if (!result) return;
    realmRef.current = result.realm; setRealm(result.realm); power(result.text);
  };
  const follow = (residentId: string | null) => {
    followRef.current = residentId; setFollowId(residentId);
    view?.follow(residentId);
    setFollowAvailability(residentId && view ? view.residentAvailability(residentId) : null);
    if (panel !== "powers") onPanel("powers");
  };

  const rebuild=(key:string,crewId:string)=>{
    if(refreshRecoveryRef.current?.()!==true)return; // Assign from the completed ledger at the actual command time.
    const envelope=damageSaved.current;if(recoveryStatus.current!=='ready'||saveFailedRef.current||envelope?.status!=='valid')return;
    const building=envelope.state.buildings.find(row=>buildingDamageKey(row.binding)===key);if(!building||!sourceAvailable(building.binding))return;
    if(disasterSaved.current.buildingFire?.status==='valid'&&disasterSaved.current.buildingFire.state.buildings.some(row=>
      buildingDamageKey(row.binding)===key&&(!!row.ignition||row.rebuiltAtMinute!==null)))return;
    const result=startBuildingRebuild(envelope.state,key,crewId);if(!result.ok)return;
    damageSaved.current={status:'valid',state:result.state};setDamage(damageSaved.current);
    power(`A neighbouring repair party begins rebuilding ${building.label}.`);
  };
  const localRebuild=(binding:BuildingDamageBinding,workerIds:readonly string[])=>{
    if(refreshRecoveryRef.current?.()!==true||minute.current===null||!view)return;
    const before=currentSave(),source=view.buildingDisasterSource(buildingDisasterIncidents(before,minute.current));
    const population=view.readCanonicalPopulation()?.population;
    if(!source||!population||saveFailedRef.current||recoveryStatus.current!=='ready')return;
    const result=requestLocalBuildingRebuild(before,{worldKey,binding,atMinute:minute.current,workerIds,
      population,buildings:source.buildings,stations:source.stations});
    if(!result.ok)return;
    if(!writeOwnedSave(result.save)){saveFailedRef.current=true;setSaveFailed(true);return;}
    disasterSaved.current=result.save;setDisasterState(result.save);
    damageSaved.current=result.save.buildingDamage;setDamage(damageSaved.current);
    power('Timber is set aside for the local builders. They must reach the worksite before repairs begin.');
  };
  const market = disasterState.market?.status === 'valid' ? disasterState.market.state : disasterState.market ? null : createMarket();
  const localPricing=useMemo(()=>marketVillagePricing({...disasterState,buildingDamage:damage},worldKey),[disasterState,damage,worldKey]);
  const commitMarket=(result:ReturnType<typeof applyPracticeMarketAction>)=>{
    if(!result.ok){setMarketMessage(result.message);return;}
    if(!writeOwnedSave(result.save)){saveFailedRef.current=true;setSaveFailed(true);setMarketMessage('The market could not be saved. Nothing was committed.');return;}
    disasterSaved.current=result.save;setDisasterState(result.save);damageSaved.current=result.save.buildingDamage;setDamage(result.save.buildingDamage);setMarketMessage(result.message);
  };
  const trade=(action:MarketAction,expectedPrice?:number)=>{
    if(saveFailedRef.current||recoveryStatus.current!=='ready'){setMarketMessage('The saved village is not ready for a market action.');return;}
    commitMarket(applyPracticeMarketAction(currentSave(),worldKey,action,expectedPrice));
  };
  const claimNearDelivery=(id:string)=>{
    if(saveFailedRef.current||recoveryStatus.current!=='ready'){setMarketMessage('Village repair stores are not ready. The delivery remains unclaimed.');return;}
    commitMarket(applyNearMarketDelivery(currentSave(),worldKey,id));
  };
  const fireState=disasterState.buildingFire?.status==='valid'?disasterState.buildingFire.state:null;
  const fireOrders=disasterState.localRebuildOrders?.status==='valid'?disasterState.localRebuildOrders.state.orders:[];
  const fireSource=view&&minute.current!==null?view.buildingDisasterSource(buildingDisasterIncidents(disasterState,minute.current)):null;
  const buildingLabel=(binding:BuildingDamageBinding)=>{
    const key=buildingDamageKey(binding),association=fireSource?.associations.find(row=>buildingDamageKey(row.binding)===key);
    return (association?PLACES.get(association.placeId)?.label:null)
      ??(damage?.status==='valid'?damage.state.buildings.find(row=>buildingDamageKey(row.binding)===key)?.label:null)
      ??'Village building';
  };
  // Once a fire owns a building, including a completed rebuild, the old
  // abstract aid ledger must never offer a second repair for that incident.
  const fireOwned=new Set(fireState?.buildings.filter(row=>row.ignition||row.rebuiltAtMinute!==null).map(row=>buildingDamageKey(row.binding))??[]);
  const legacyDamage=damage?.status==='valid'?{...damage.state,buildings:damage.state.buildings.filter(row=>!fireOwned.has(buildingDamageKey(row.binding)))}:null;
  const at = sample?.time ?? null;
  const ready = at !== null&&recovery.status==='ready'&&!saveFailed;
  const liveCommand = command && minute.current !== null ? activeWeather(command, minute.current) : null;
  const remaining = liveCommand && minute.current !== null ? Math.max(0, liveCommand.untilMinute - minute.current) : 0;
  const shownSky: ObserverWeather | null = liveCommand?.kind === "storm" ? "storm" : sky;
  const daylight = at ? at.dayMinute >= 6 * 60 && at.dayMinute < 19 * 60 : true;
  const followed = followId ? PEOPLE.get(followId) : undefined;
  const followedState = followId ? sample?.residents.find(resident => resident.residentId === followId) : undefined;
  const followedShown = followId ? shown.find(resident => resident.residentId === followId) : undefined;
  const raidState = raid && minute.current !== null ? raidPhase(raid, minute.current) : null;
  const raidIndex = raidState ? RAID_PHASES.indexOf(raidState.phase) : -1;
  const alarm = raidState?.phase === "approach" || raidState?.phase === "clash";
  const watchAwake = (sample?.residents ?? []).filter(resident => RAID_ROSTER.person(resident.residentId)?.guard && !asleep(resident.activity)).length;
  const watchCount = raid ? raid.defenders ?? raidDefenders(raid, sample?.residents ?? [], RAID_ROSTER) : 0;
  const lastRaid = raids.at(-1);
  const aid = raidAid(realm);
  const followedAway = !!followedShown?.away;
  const followAvailabilityText = followedAway ? null : residentFollowAvailabilityText(followAvailability);
  const followedPlace = followedShown ? PLACES.get(followedShown.scheduledPlaceId) : followedState ? PLACES.get(followedState.scheduledPlaceId) : undefined;
  const memories = followId ? chronicle.memories[followId] ?? [] : [];
  const feed = [...chronicle.entries].reverse().slice(0, 40);
  const stateOf = (residentId: string) => sample?.residents.find(resident => resident.residentId === residentId);
  const clockText = at ? `${String(Math.floor(at.dayMinute / 60)).padStart(2, "0")}:${String(at.dayMinute % 60).padStart(2, "0")}` : "--:--";

  return <div className={`obs${reducedMotion ? " is-reduced" : ""}`} data-observer>
    {!reducedMotion && <div className="obs-motes" aria-hidden="true">{MOTES.map((mote, index) => <i key={index} style={{
      left: mote.left, width: mote.size, height: mote.size, animationDuration: `${mote.duration}s`, animationDelay: `${mote.delay}s`,
      "--mote-drift": mote.drift, "--mote-color": mote.color } as CSSProperties} />)}</div>}

    <div ref={bubbleHost} className="obs-bubble-host" data-observer-bubbles />

    {/* ------------------------------------------------------------ the chronicle, under the house's name */}
    <section className={`obs-chronicle${feedOpen ? "" : " is-folded"}`} data-observer-chronicle aria-labelledby="obs-chronicle-title">
      <header className="obs-legend-row">
        <h3 id="obs-chronicle-title" className="obs-legend"><Glyph name="chronicle" className="obs-legend-icon" />Chronicle</h3>
        <button type="button" className="obs-link" data-nav data-observer-feed-toggle aria-expanded={feedOpen} onClick={() => setFeedOpen(value => { try { globalThis.localStorage?.setItem(CHRONICLE_PREFERENCE, value ? "folded" : "open"); } catch { /* remembered only where storage allows */ } return !value; })}>{feedOpen ? "Fold" : "Unfold"}</button>
      </header>
      {feedOpen && (feed.length ? <ol className="obs-feed" aria-live="polite">{feed.map(entry => <li key={entry.id} data-kind={entry.kind} style={tint(KIND[entry.kind].tint)}>
        <Glyph name={entry.kind} className="obs-feed-icon" />
        <div>
          <span className="obs-feed-meta"><b>{KIND[entry.kind].label}</b>{formatChronicleTime(entry.minute)}</span>
          {entry.residentId && entry.residentId !== followId
            ? <button type="button" className="obs-feed-text" data-nav data-observer-follow-from={entry.residentId} title="Follow" onClick={() => follow(entry.residentId!)}>{entry.text}</button>
            : <span className="obs-feed-text">{entry.text}</span>}
        </div>
      </li>)}</ol>
        : <p className="obs-quiet">The village goes about its day. What happens while you watch is written here.</p>)}
    </section>

    {/* ------------------------------------------------------------ the observer's panel, where the setup screen keeps its terms */}
    {rightPanelFree && <section className="obs-panel" data-observer-panel={panel} data-raid={raidState?.phase}
      aria-label={panel === "watch" ? "Watch" : panel === "houses" ? "Houses of Aethelgard" : panel === "market" ? "Village market" : "Your hand over Ealdholt"}>
      {panel === "market" ? <>
        <header className="obs-legend-row"><h3 className="obs-legend">Village market</h3><button type="button" className="obs-icon-button" data-nav aria-label="Close market" onClick={() => onPanel("powers")}><Glyph name="close" /></button></header>
        <div role="group" aria-label="Market mode"><button type="button" data-nav aria-pressed={marketMode==='practice'} onClick={()=>setMarketMode('practice')}>Local market</button><button type="button" data-nav aria-pressed={marketMode==='testnet'} onClick={()=>setMarketMode('testnet')}>NEAR testnet</button></div>
        {marketMode==='testnet' ? <><NearMarket worldKey={worldKey} claims={disasterState.nearClaims?.status==='invalid'?null:disasterState.nearClaims?.ids??[]} onClaim={claimNearDelivery}/><p role="status" className="obs-quiet">{marketMessage}</p></> : <><p className="obs-quiet">Local market · game coins, not NEAR tokens. Supply runs and stall activity are abstract; they do not claim a villager performed physical work. Market days do not change the village clock.</p>
        {!market ? <p role="alert">The saved market is invalid and has been preserved. Trading is held.</p> : <>
          <p className="obs-quiet" role="status" data-market-message>{marketMessage}</p>
          <p className="obs-quiet" data-market-wallet>Day {market.day} · Wallet: <b>{market.coins}</b> coins · {market.timber} timber · {market.bread} bread · {market.energy}/8 energy</p>
          <p className="obs-quiet">Commons: {market.forest} timber remaining. Supply runs use 1 energy and yield 2 timber; 2 regrow per market day, up to 24.</p>
          <button className="obs-row" type="button" data-nav data-market-action="gather" disabled={!ready} onClick={()=>trade('gather')}>Gather 2 timber</button>
          <h4>{PEOPLE.get("ealdholt-woodcutter")?.label ?? "Woodcutter"} · timber stall</h4><p className="obs-quiet">Stock {market.merchantTimber}/20 · budget {market.merchantCoins} coins. Stock adjustment {quote(5,market.merchantTimber,6,market.timberDemand).stockAdjustment}% · demand +{quote(5,market.merchantTimber,6,market.timberDemand).demandAdjustment}%.</p>
          <button className="obs-row" type="button" data-nav data-market-action="sell-timber" disabled={!ready||!localPricing.available} onClick={()=>trade('sell-timber',localPricing.prices.timberSell)}>Sell timber · {localPricing.prices.timberSell} coins</button>
          <button className="obs-row" type="button" data-nav data-market-action="buy-timber" disabled={!ready||!localPricing.available} onClick={()=>trade('buy-timber',localPricing.prices.timberBuy)}>Buy timber · {localPricing.prices.timberBuy} coins</button>
          <h4>{PEOPLE.get("ealdholt-baker")?.label ?? "Baker"} · bread stall</h4><p className="obs-quiet">Bread {market.bakeryBread}/20 · budget {market.bakeryCoins} coins. Stock adjustment {quote(4,market.bakeryBread,8,market.breadDemand).stockAdjustment}% · demand +{quote(4,market.bakeryBread,8,market.breadDemand).demandAdjustment}%.</p>
          <button className="obs-row" type="button" data-nav data-market-action="buy-bread" disabled={!ready} onClick={()=>trade('buy-bread')}>Buy bread · {marketPrices(market).bread} coins</button>
          <button className="obs-row" type="button" data-nav data-market-action="sell-bread" disabled={!ready} onClick={()=>trade('sell-bread')}>Sell bread · {marketPrices(market).breadSell} coins</button>
          <button className="obs-row" type="button" data-nav data-market-action="bake" disabled={!ready} onClick={()=>trade('bake')}>Bake 2 bread · 1 timber + 3 coins</button>
          <button className="obs-row" type="button" data-nav data-market-action="broker-bakery" disabled={!ready} onClick={()=>trade('broker-bakery')}>Baker buys fuel and bakes · {marketPrices(market).timberBuy} coins from bakery</button>
          <button className="obs-row" type="button" data-nav data-market-action="eat" disabled={!ready} onClick={()=>trade('eat')}>Eat bread · restore 2 energy</button>
          <button className="obs-row" type="button" data-nav data-market-action="next-day" disabled={!ready} onClick={()=>trade('next-day')}>Next market day</button>
          <h4>Household wallets</h4><p className="obs-quiet">Last market day: {market.lastFed} households bought a bread ration; {market.lastUnfed} could not. These are ledger events, not physical villager interactions.</p>
          <details><summary data-nav>View 25 household balances</summary><ul>{market.households.map(h=><li key={h.id}>{HOUSEHOLD_LABELS.get(h.id) ?? h.id}: {h.coins} coins · {h.meals} rations bought · {h.missed} missed</li>)}</ul></details>
          <h4>Repair stores</h4><p className="obs-quiet">{localPricing.available ? `Damaged buildings: ${localPricing.damagedBuildings} · unreserved repair timber: ${damage?.status==='valid'?damage.state.timber:0} · shortfall: ${localPricing.timberShortfall}. Player timber trades include +${localPricing.demandBonus} coins per unit for repair demand; the bakery uses its normal quote.` : 'Village damage records are unavailable; player timber trading is held.'}</p><p className="obs-quiet">Your deliveries: {market.donatedTimber} timber. The existing rebuilding system still requires a damaged building, qualified workers and 12 timber.</p>
          <button className="obs-row" type="button" data-nav data-market-action="donate-timber" disabled={!ready} onClick={()=>trade('donate-timber')}>Deliver 12 timber</button>
        </>}</>}
      </> : panel === "houses" ? <HousesPanel realm={realm} minute={ready?minute.current:null} aid={aid} onAct={actOn} onClose={() => onPanel("powers")} />
      : panel === "watch" ? <>
        <header className="obs-legend-row">
          <h3 className="obs-legend"><Glyph name="eye" className="obs-legend-icon" />Watch</h3>
          <button type="button" className="obs-icon-button" data-nav data-ealdholt-drawer-close aria-label="Close" onClick={() => onPanel("powers")}><Glyph name="close" /></button>
        </header>
        <p className="obs-quiet">Choose someone to follow through their day. They will never know you are there.</p>
        <ResidentWatchList followId={followId} stateOf={stateOf} overlayFor={id => shown.find(row => row.residentId === id)} onFollow={follow} />
      </> : <>
        {/* The hour and the sky, as a medallion like the setup screen's kingdoms. */}
        <div className="obs-readout" style={tint(alarm ? RAID_TINT : shownSky ? SKY[shownSky].tint : "#b5b2ac")} data-observer-readout>
          <span className="obs-medal"><Glyph name={!daylight && (shownSky === "clear" || !shownSky) ? "moon" : shownSky ?? "clear"} className="obs-medal-icon" /></span>
          <div><strong>{clockText}</strong><small>Day {at ? at.dayIndex + 1 : "—"} · {shownSky ? SKY[shownSky].label : "—"}</small></div>
          <span className={`obs-flow${speed === 0 ? " is-held" : ""}${alarm ? " is-alarm" : ""}`}>{alarm ? "Raid" : speed === 0 ? "Held" : `${speed}× time`}</span>
        </div>

        <fieldset className="obs-group" data-observer-time>
          <legend className="obs-legend"><Glyph name="clock" className="obs-legend-icon" />Time</legend>
          <div className="obs-tiles">{OBSERVER_SPEEDS.map(value => <button key={value} type="button" className="obs-tile" data-nav data-observer-speed={value} aria-pressed={speed === value} aria-label={SPEED_TILE[value].label} onClick={() => chooseSpeed(value)}>
            {value === 0 ? <Glyph name="hold" className="obs-tile-glyph" /> : <strong>{SPEED_TILE[value].value}</strong>}<span>{SPEED_TILE[value].unit}</span>
          </button>)}</div>
        </fieldset>

        <fieldset className="obs-group" data-observer-sky-group>
          <legend className="obs-legend"><Glyph name="sky" className="obs-legend-icon" />Sky</legend>
          <div className="obs-sky">{OBSERVER_WEATHERS.map(value => <button key={value} type="button" className="obs-row obs-sky-row" style={tint(SKY[value].tint)} data-nav data-observer-sky={value} disabled={!ready} aria-pressed={liveCommand?.kind === value} onClick={() => chooseSky(value)}>
            <Glyph name={value} className="obs-row-icon" /><span className="obs-row-name">{SKY[value].label}</span>
          </button>)}</div>
          {liveCommand ? <div className="obs-hold" style={tint(SKY[liveCommand.kind].tint)} data-observer-sky-remaining={remaining}>
            <span className="obs-hold-bar"><i style={{ width: `${(remaining / OBSERVER_WEATHER_MINUTES) * 100}%` }} /></span>
            <span className="obs-hold-text">{SKY[liveCommand.kind].label} holds {Math.floor(remaining / 60)} h {String(remaining % 60).padStart(2, "0")}</span>
            <button type="button" className="obs-link" data-nav data-observer-sky="release" onClick={() => chooseSky(null)}><Glyph name="release" className="obs-link-icon" />Let it be</button>
          </div> : !raid ? <p className="obs-quiet obs-sky-note">The sky goes its own way until you command it.</p> : null}
        </fieldset>

        <section className="obs-group obs-raid" data-observer-raid={raidState?.phase ?? "none"} aria-labelledby="obs-raid-title" style={tint(RAID_TINT)}>
          <h3 id="obs-raid-title" className="obs-legend"><Glyph name="threat" className="obs-legend-icon obs-legend-icon--raid" />Bandits</h3>
          {raid && raidState ? <div className="obs-raid-live">
            <div className="obs-raid-head"><div><strong>{raid.band}</strong><small>{raid.size} strong · {raid.target.label}</small></div>
              {raid.outcome && <span className="obs-raid-outcome" data-outcome={raid.outcome}>{OUTCOME_LABEL[raid.outcome]}</span>}</div>
            <ol className="obs-raid-track">{RAID_PHASES.map((phase, index) => <li key={phase} data-state={index < raidIndex ? "done" : index === raidIndex ? "now" : "next"}>
              <span className="obs-raid-bar"><i style={{ width: `${index < raidIndex ? 100 : index === raidIndex ? Math.round(raidState.progress * 100) : 0}%` }} /></span>{PHASE_LABEL[phase]}
            </li>)}</ol>
            <div className="obs-raid-odds"><span><b>{watchCount}</b> of the watch</span><span className="obs-raid-vs">against</span><span><b>{raid.size}</b> outlaws</span></div>
            {raid.allies && <p className="obs-raid-allies" data-observer-allies={raid.allies.houseId}><Glyph name="beacon" className="obs-link-icon" />
              <span><b>{raid.allies.riders}</b> riders of {raid.allies.house} answer the beacon</span></p>}
            {(raidState.phase === "sighted" || raidState.phase === "approach") && <button type="button" className="obs-row obs-warn" style={tint("#f2b84b")} data-nav data-observer-warn disabled={raid.warned} aria-pressed={raid.warned} onClick={warnVillage}>
              <Glyph name="bell" className="obs-row-icon" /><span className="obs-row-name">{raid.warned ? "The village is warned" : "Warn the village"}</span>
            </button>}
          </div> : <>
            <button type="button" className="obs-row obs-lure" data-nav data-observer-lure disabled={!ready || !sourceReady || !view?.raidSites().some(site => !!site.buildingBinding)} onClick={lureBandits}>
              <Glyph name="torch" className="obs-row-icon" /><span className="obs-row-name">Lure bandits to Ealdholt</span><Glyph name="arrow" className="obs-lure-arrow" />
            </button>
            <p className="obs-quiet">{watchAwake} of the watch {watchAwake === 1 ? "is" : "are"} awake at this hour. {lastRaid
              ? `Day ${lastRaid.day}: ${lastRaid.band} ${OUTCOME_PAST[lastRaid.outcome](lastRaid.target)}.`
              : "Outlaws roam the Marches; some nights they come on their own."} {aid ? `${aid.house} would ride to the beacon.` : "No neighbouring house would ride to the beacon yet."}</p>
          </>}
        </section>

        {recovery.status!=='ready'&&<p className="obs-quiet" data-observer-recovery-status={recovery.status} data-observer-recovery-error={recovery.error??undefined}>{recovery.status==='blocked'?`Village recovery is held. ${recovery.error??''}`:recovery.status==='waiting-source'?'Waiting for the village buildings.':'Catching up village life…'}</p>}
        {recovery.status==='waiting-population'&&recovery.error?.startsWith('Historical view')&&<button type="button" className="obs-row" data-nav data-observer-return-present onClick={returnToPresent}>Return to the village’s present</button>}
        {saveFailed&&<p className="obs-quiet" role="status">This visit could not be saved. Repairs are held.</p>}
        <BuildingFirePanel fire={fireState} orders={fireOrders} timber={damage?.status==='valid'?damage.state.timber:0}
          pending={!ready} unavailable={disasterState.buildingFire?.status==='invalid'||disasterState.buildingEmergency?.status==='invalid'||disasterState.localRebuildOrders?.status==='invalid'}
          label={buildingLabel} workerName={id=>PEOPLE.get(id)?.label??'Local builder'}
          workers={binding=>[...new Set(fireSource?.stations.filter(station=>station.kind==='repair'&&station.buildingKey===buildingDamageKey(binding))
            .map(station=>station.residentId).filter(id=>{const person=PEOPLE.get(id);return !!person&&person.ageYears>=18&&person.ageYears<60;})??[])]}
          onInspect={binding=>{view?.inspectBuilding(binding);}} onRebuild={localRebuild}/>
        <BuildingRebuildPanel state={legacyDamage} unavailable={damage?.status==='invalid'||recovery.status==='blocked'||saveFailed} pending={!ready} canReach={sourceAvailable} onRebuild={rebuild}/>
        <section className="obs-group" data-observer-follow={followed?.id ?? ""} aria-labelledby="obs-follow-title">
          <h3 id="obs-follow-title" className="obs-legend"><Glyph name="eye" className="obs-legend-icon" />{followed ? "Following" : "Watch"}</h3>
          {followed ? <div className="obs-follow">
            <div className="obs-follow-head">
              <div><strong>{followed.label}</strong><small>{followed.roleLabel !== followed.label && `${followed.roleLabel} · `}{followed.ageYears} years</small></div>
              <button type="button" className="obs-link" data-nav data-observer-unfollow onClick={() => follow(null)}>Let go</button>
            </div>
            {followedState && <p className="obs-follow-now" data-observer-follow-now data-alarm={followedShown?.alarm || undefined} data-away={followedAway || undefined}>
              <span>{displayPopulationActivity(followedState, followedShown)}</span>
              {followedPlace && !followedAway && <small>{followedState.status === "travelling" ? "On the way to" : "At"} {placePhrase(followedPlace.label)}</small>}
              {followedAway && <small>Away from Ealdholt</small>}
            </p>}
            {followAvailabilityText && <p className="obs-quiet" data-observer-follow-availability={followAvailability?.body ?? "pending"}
              data-observer-follow-unplaced={followAvailability?.body === "held" && !followAvailability.position || undefined}>{followAvailabilityText}</p>}
            <ResidentConversation key={followed.id} residentId={followed.id} residentLabel={followed.label} />
            <h4 className="obs-sub">Remembers</h4>
            {memories.length ? <ul className="obs-memories" data-observer-memories={memories.length}>{memories.map(memory => <li key={memory.key}>{memory.text}</li>)}</ul>
              : <p className="obs-quiet">Nothing yet. Prayer, the road, and weather that caught them out of doors will stay with them.</p>}
          </div> : <button type="button" className="obs-cta" data-nav data-observer-open-watch onClick={() => onPanel("watch")}>
            <span>Follow a villager</span><Glyph name="arrow" className="obs-cta-arrow" />
          </button>}
        </section>
      </>}
    </section>}

    {alarm && <div className="obs-alarm" data-phase={raidState?.phase} aria-hidden="true" />}

    {/* ------------------------------------------------------------ the menu's key chips */}
    <div className="obs-keys" aria-hidden="true">
      <span><kbd>Enter</kbd>Select</span><span><kbd>Esc</kbd>Back</span><span><kbd>Drag</kbd>Look</span>
    </div>
  </div>;
}

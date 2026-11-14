/**
 * Bandit raids on House Ealdholt (the creator's direction of 10 November 2026: bandits rather than war). Outlaws come
 * up the road at night now and then of their own accord, or because the observer lures them; the village sees them
 * (or does not), rings the bell, shelters, and its watch meets them. What happens is decided by who is actually on
 * duty at that hour in the villagers' own routines, by whether the watch post was manned, by the observer's warning,
 * and by the weather the observer commands. The raid is written into the chronicle and into the memories of the
 * people who fought, hid, or carried water.
 *
 * Pure and deterministic: every roll is a hash of the world key and the raid, so a raid replays the same way.
 * Phases run on the observed village clock (absolute world minutes).
 */
import { type ChronicleResident, type ResidentMemory } from "./village-chronicle";
import type { VillagePopulation } from "../characters/village-population";
import type { RaidAid } from "./neighbour-houses";
import { parseBuildingDamageBinding, type BuildingDamageBinding, type BuildingRaidOutcome } from "./building-damage";

export type RaidPhase = "sighted" | "approach" | "clash" | "aftermath";
export type RaidOutcome = "repelled" | "plundered" | "burned";
export type RaidBearing = "north" | "east" | "south" | "west";
export const RAID_PHASES: readonly RaidPhase[] = ["sighted", "approach", "clash", "aftermath"];
export const RAID_BEARINGS: readonly RaidBearing[] = ["north", "east", "south", "west"];
/** Seen early from a manned watch post; barely seen at all from an empty one. */
export const RAID_SIGHTED_MINUTES = { manned: 20, unmanned: 5 } as const;
export const RAID_APPROACH_MINUTES = 30;
export const RAID_CLASH_MINUTES = 30;
export const RAID_AFTERMATH_MINUTES = 120;
/** After a burning, neighbours carry water for this long. */
const WATER_MINUTES = 40;
export const RAID_HISTORY_LIMIT = 6;

export interface RaidTarget {
  /** The outlying building the view chose (null when the village view could not offer one). */
  readonly siteIndex: number | null;
  readonly bearing: RaidBearing;
  readonly label: string;
  /** Captured only from the current source owner when a NEW raid starts. Old
   * rank-only targets and old history never acquire an inferred building. */
  readonly buildingBinding?:BuildingDamageBinding;
}
export interface BanditRaid {
  /** New raids retain their actual world; old saves remain unbound. */
  readonly worldKey?:string;
  readonly id: string;
  readonly seed: number;
  readonly band: string;
  readonly size: number;
  readonly target: RaidTarget;
  readonly startMinute: number;
  readonly sightedMinutes: number;
  readonly provoked: boolean;
  readonly warned: boolean;
  readonly stormed: boolean;
  readonly outcome: RaidOutcome | null;
  readonly defenders: number | null;
  readonly loot: string | null;
  /** The neighbouring house riding to Ealdholt's beacon (neighbour-houses.ts), once the beacon is lit. */
  readonly allies: RaidAid | null;
  /** Phases already written into the chronicle. */
  readonly written: readonly RaidPhase[];
}
export interface RaidRecord {
  readonly worldKey?:string;
  readonly buildingBinding?:BuildingDamageBinding;
  readonly id: string; readonly band: string; readonly day: number; readonly outcome: RaidOutcome;
  readonly target: string; readonly provoked: boolean; readonly defenders: number;
  /** The house whose riders came, if any. */
  readonly aidHouseId: string | null;
}
/** An outlying building the village view offers as a target. */
export interface RaidSiteChoice { readonly index: number; readonly bearing: RaidBearing;readonly buildingBinding?:BuildingDamageBinding }
/** How the raid knows the villagers; supplied from the village population. */
export interface RaidRoster {
  person(residentId: string): { readonly label: string; readonly guard: boolean; readonly young: boolean; readonly elder: boolean; readonly homePlaceId: string } | null;
  placeKind(placeId: string): "home" | "workplace" | "social" | "service" | "travel" | null;
}
export interface RaidEvent { readonly text: string; readonly residentId?: string }

/** The raid's view of the village population: the watch is its guards-and-military group. */
export function createPopulationRaidRoster(population: VillagePopulation): RaidRoster {
  const people = new Map(population.residents.map(resident => [resident.id, Object.freeze({
    label: resident.label, guard: resident.group === "guards-military", homePlaceId: resident.homePlaceId,
    young: resident.ageBand === "child" || resident.ageBand === "adolescent", elder: resident.ageBand === "elder",
  })]));
  const places = new Map(population.places.map(place => [place.id, place.kind]));
  return { person: id => people.get(id) ?? null, placeKind: id => places.get(id) ?? null };
}

// Original outlaw bands and spoils.
const BANDS = ["the Hollow Wolves", "the Ashfen Cutthroats", "the Brackenmoor Knives", "Red Maud's band", "the Gallowmere Men", "the Thornwick Outlaws"];
const LOOT = ["six sacks of grain", "two goats and a cask of ale", "the week's flour", "a cart of firewood and the smith's iron", "the hall's salted pork"];
const SHELTER_IN_CHURCH = new Set(["churchyard", "proposed-church", "proposed-green"]);
const WATCH_POST = "proposed-watch-post";
const GUARD_YARD = "proposed-guard-yard";

function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const roll = (raid: BanditRaid, salt: string) => hash01(`${raid.seed}|${salt}`);
const capital = (text: string) => text[0].toUpperCase() + text.slice(1);
const asleep = (activity: string) => /^asleep\b/i.test(activity.trim());
const dayOf = (minute: number) => Math.floor(minute / 1440) + 1;
export const isNight = (absoluteMinute: number) => { const m = ((absoluteMinute % 1440) + 1440) % 1440; return m < 6 * 60 || m >= 21 * 60; };

export function startRaid(input: { worldKey: string; minute: number; serial: number; provoked: boolean; watchAtPost: boolean; sites: readonly RaidSiteChoice[] }): BanditRaid {
  const id = `raid-${Math.floor(input.minute)}-${input.serial}`, seed = Math.floor(hash01(`${input.worldKey}|${id}`) * 1e9);
  const pick = (salt: string) => hash01(`${seed}|${salt}`);
  const site = input.sites.length ? input.sites[Math.floor(pick("site") * input.sites.length)] : null;
  const bearing = site?.bearing ?? RAID_BEARINGS[Math.floor(pick("bearing") * 4)];
  const buildingBinding=site?.buildingBinding?parseBuildingDamageBinding(site.buildingBinding):undefined;
  if(buildingBinding&&buildingBinding.siteIndex!==site?.index)throw Error('Raid target and source-bound building index differ.');
  return {
    worldKey:input.worldKey,
    id, seed, band: BANDS[Math.floor(pick("band") * BANDS.length)], size: 6 + Math.floor(pick("size") * 9),
    target: { siteIndex: site?.index ?? null, bearing, label: `the ${bearing} farmstead`,...(buildingBinding?{buildingBinding}:{}) },
    startMinute: Math.floor(input.minute), sightedMinutes: input.watchAtPost ? RAID_SIGHTED_MINUTES.manned : RAID_SIGHTED_MINUTES.unmanned,
    provoked: input.provoked, warned: false, stormed: false, outcome: null, defenders: null, loot: null, allies: null, written: [],
  };
}

/** The phase at an absolute observed minute, with how far through it the raid is; null once the raid is over. */
export function raidPhase(raid: BanditRaid, minute: number): { readonly phase: RaidPhase; readonly progress: number } | null {
  let at = minute - raid.startMinute;
  const spans: [RaidPhase, number][] = [["sighted", raid.sightedMinutes], ["approach", RAID_APPROACH_MINUTES], ["clash", RAID_CLASH_MINUTES], ["aftermath", RAID_AFTERMATH_MINUTES]];
  if (at < 0) return { phase: "sighted", progress: 0 };
  for (const [phase, span] of spans) { if (at < span) return { phase, progress: at / span }; at -= span; }
  return null;
}
export function raidEndMinute(raid: BanditRaid): number {
  return raid.startMinute + raid.sightedMinutes + RAID_APPROACH_MINUTES + RAID_CLASH_MINUTES + RAID_AFTERMATH_MINUTES;
}

/** Whether anyone of the watch is awake at the watch post to see the band coming. */
export function watchPostManned(residents: readonly ChronicleResident[], roster: RaidRoster): boolean {
  return residents.some(resident => resident.scheduledPlaceId === WATCH_POST && !asleep(resident.activity) && !!roster.person(resident.residentId)?.guard);
}
/** A guard joins the watch if awake, if the observer's warning woke them, or (otherwise) if the bell does. */
function joinsWatch(raid: BanditRaid, resident: ChronicleResident): boolean {
  return !asleep(resident.activity) || raid.warned || roll(raid, `wake|${resident.residentId}`) < .5;
}
export function raidDefenders(raid: BanditRaid, residents: readonly ChronicleResident[], roster: RaidRoster): number {
  return residents.filter(resident => roster.person(resident.residentId)?.guard && joinsWatch(raid, resident)).length;
}

/** The odds the watch holds: its numbers, an early sighting, the observer's warning and a storm against the band. */
export function raidOdds(raid: BanditRaid, defenders: number, night: boolean, storm: boolean): number {
  const defence = defenders + (raid.allies?.riders ?? 0) + (raid.warned ? 4 : 0) + (raid.sightedMinutes === RAID_SIGHTED_MINUTES.manned ? 2 : 0) + (storm ? 3 : 0);
  const attack = raid.size + (night ? 3 : 0);
  return 1 / (1 + Math.exp(-(defence - attack) / 2.5));
}
export function decideRaid(raid: BanditRaid, defenders: number, night: boolean, storm: boolean): { readonly outcome: RaidOutcome; readonly loot: string | null } {
  if (roll(raid, "clash") < raidOdds(raid, defenders, night, storm)) return { outcome: "repelled", loot: null };
  // Rain puts out torches: no burning in a storm.
  if (!storm && roll(raid, "fire") < (night ? .55 : .3)) return { outcome: "burned", loot: null };
  return { outcome: "plundered", loot: LOOT[Math.floor(roll(raid, "loot") * LOOT.length)] };
}

/** What each villager does while the raid holds them: the watch musters, everyone else shelters. Their own routine
 * comes back once the danger passes (or, after a burning, once the water has been carried). */
export function raidResident(raid: BanditRaid, minute: number, resident: ChronicleResident, roster: RaidRoster): ChronicleResident {
  const state = raidPhase(raid, minute), person = roster.person(resident.residentId);
  // Anyone away on an outing is beyond the bell.
  if (!state || !person || resident.away) return resident;
  const phaseIndex = RAID_PHASES.indexOf(state.phase), slot = (variant: number) => 1000 + phaseIndex * 10 + variant;
  const as = (activity: string, scheduledPlaceId: string, variant: number): ChronicleResident =>
    ({ ...resident, activity, scheduledPlaceId, slotIndex: slot(variant), alarm: true });
  if (state.phase === "approach" || state.phase === "clash") {
    if (person.guard) {
      if (!joinsWatch(raid, resident)) return resident;
      return asleep(resident.activity) ? as("Wakes to the bell and runs to join the watch.", GUARD_YARD, 1) : as(`Stands with the watch at ${raid.target.label}.`, GUARD_YARD, 2);
    }
    if (asleep(resident.activity)) return as("Wakes to the bell and bars the door.", person.homePlaceId, 3);
    if (roster.placeKind(resident.scheduledPlaceId) === "home") return as("Bars the door and waits.", resident.scheduledPlaceId, 4);
    if (SHELTER_IN_CHURCH.has(resident.scheduledPlaceId)) return as("Takes shelter in the church.", "proposed-church", 5);
    return as(person.young || person.elder ? "Is hurried indoors." : "Runs home and bars the door.", person.homePlaceId, 6);
  }
  if (state.phase === "aftermath" && raid.outcome === "burned" && (minute - aftermathStart(raid)) < WATER_MINUTES
    && !asleep(resident.activity) && !person.young && !person.elder) return as(`Carries water to the fire at ${raid.target.label}.`, resident.scheduledPlaceId, 7);
  return resident;
}
const aftermathStart = (raid: BanditRaid) => raid.startMinute + raid.sightedMinutes + RAID_APPROACH_MINUTES + RAID_CLASH_MINUTES;

export interface RaidStep {
  readonly raid: BanditRaid | null;
  readonly record: RaidRecord | null;
  readonly events: readonly RaidEvent[];
  readonly memories: readonly (readonly [string, ResidentMemory])[];
  /** The villagers as the raid holds them, for the chronicle and the followed villager. */
  readonly residents: readonly ChronicleResident[];
  /** Repeated read-only receipt: persistent building rules dedupe the raid
   * serial. Also emitted on catch-up past the end, before the raid disappears. */
  readonly damageOutcome:BuildingRaidOutcome|null;
}

/** One look at the raid: phases the clock has passed are written in order (a 16x jump still reads in sequence). */
export function advanceRaid(raid: BanditRaid, input: { minute: number; residents: readonly ChronicleResident[]; roster: RaidRoster; storm: boolean;
  /** The house that would ride to the beacon now, if any (neighbour-houses.ts raidAid). */
  aid?: RaidAid | null }): RaidStep {
  const { minute, roster } = input, state = raidPhase(raid, minute), day = dayOf(minute);
  const events: RaidEvent[] = [], memories: [string, ResidentMemory][] = [];
  let next: BanditRaid = raid;
  const Band = capital(raid.band);
  if (input.storm && !raid.stormed && (!state || state.phase === "sighted" || state.phase === "approach")) {
    next = { ...next, stormed: true };
    if (state) events.push({ text: `Rain lashes the road and ${raid.band}'s torches gutter.` });
  }
  const reached = state ? RAID_PHASES.indexOf(state.phase) : RAID_PHASES.length - 1;
  for (let index = 0; index <= reached; index++) {
    const phase = RAID_PHASES[index];
    if (next.written.includes(phase)) continue;
    if (phase === "sighted") {
      events.push({ text: next.sightedMinutes === RAID_SIGHTED_MINUTES.manned
        ? `The lookout at the watch post sees torches on the road: ${raid.band}, ${raid.size} strong.`
        : `Torches on the road, and no one at the watch post to see them: ${raid.band}, ${raid.size} strong.` });
    } else if (phase === "approach") {
      events.push({ text: next.warned ? "The village is already moving when the bell rings: your warning reached them."
        : "The church bell rings. Doors are barred and the watch musters." });
      // There is time to light the beacon only if the band was seen early or the observer warned the village.
      if (next.warned || next.sightedMinutes === RAID_SIGHTED_MINUTES.manned) {
        if (input.aid) {
          next = { ...next, allies: input.aid };
          events.push({ text: `The beacon is lit. Riders of ${input.aid.house} set out from ${input.aid.seat}.` });
        } else events.push({ text: "The beacon is lit, but no neighbouring house rides for Ealdholt." });
      }
    } else if (phase === "clash") {
      const defenders = raidDefenders(next, input.residents, roster), storm = next.stormed || input.storm;
      const decided = decideRaid(next, defenders, isNight(next.startMinute+next.sightedMinutes+RAID_APPROACH_MINUTES), storm);
      next = { ...next, defenders, outcome: decided.outcome, loot: decided.loot };
      events.push({ text: `${Band} fall on ${raid.target.label}.` });
      const stand = next.allies ? `${defenders} of the watch and ${next.allies.riders} riders of ${next.allies.house}` : `${defenders} of the watch`;
      if (next.allies) for (const resident of input.residents) if (roster.person(resident.residentId)?.guard && joinsWatch(next, resident)) {
        memories.push([resident.residentId, { key: `raid-aid:${raid.id}`, minute, text: `Stood beside the riders of ${next.allies.house} on day ${day}.` }]);
      }
      events.push({ text: decided.outcome === "repelled" ? `${stand} drive ${raid.band} back into the dark.`
        : decided.outcome === "burned" ? `${Band} set ${raid.target.label} alight and flee into the dark.`
        : `${Band} carry off ${decided.loot} from ${raid.target.label}.` });
      for (const resident of input.residents) {
        const person = roster.person(resident.residentId);
        if (!person) continue;
        if (person.guard && joinsWatch(next, resident)) {
          memories.push([resident.residentId, { key: `raid:${raid.id}`, minute, text: decided.outcome === "repelled"
            ? `Drove off ${raid.band} at ${raid.target.label} on day ${day}.` : `Fought ${raid.band} at ${raid.target.label} on day ${day}, and could not hold them.` }]);
        } else if (!person.guard) {
          memories.push([resident.residentId, { key: `raid:${raid.id}`, minute, text: `Hid from ${raid.band} on day ${day}.` }]);
        }
      }
    } else if (phase === "aftermath") {
      events.push({ text: next.outcome === "repelled" ? "The watch walks the road until the last torch is gone."
        : next.outcome === "burned" ? "Neighbours carry water until the fire is out." : "Ealdholt counts what it lost." });
      if (next.outcome === "burned") for (const resident of input.residents) {
        const shown = raidResident(next, minute, resident, roster);
        if (shown.activity.startsWith("Carries water")) memories.push([resident.residentId, { key: `raid-water:${raid.id}`, minute, text: `Carried water to the fire at ${raid.target.label} on day ${day}.` }]);
      }
    }
    next = { ...next, written: [...next.written, phase] };
  }
  if (!state) {
    const record: RaidRecord = { ...(raid.worldKey?{worldKey:raid.worldKey}:{}),...(raid.worldKey&&raid.target.buildingBinding?{buildingBinding:raid.target.buildingBinding}:{}),id: raid.id, band: raid.band, day: dayOf(raid.startMinute), outcome: next.outcome ?? "plundered",
      target: raid.target.label, provoked: raid.provoked, defenders: next.defenders ?? 0, aidHouseId: next.allies?.houseId ?? null };
    return { raid: null, record, events, memories, residents: input.residents,damageOutcome:raidBuildingDamageOutcome(next,minute) };
  }
  return { raid: next, record: null, events, memories, residents: input.residents.map(resident => raidResident(next, minute, resident, roster)),damageOutcome:raidBuildingDamageOutcome(next,minute) };
}

export function raidBuildingDamageOutcome(raid:BanditRaid,minute:number):BuildingRaidOutcome|null{
  const settledMinute=aftermathStart(raid);if(!raid.outcome||minute<settledMinute)return null;
  return{worldKey:raid.worldKey??null,raidId:raid.id,startMinute:raid.startMinute,settledMinute,outcome:raid.outcome,binding:raid.worldKey?raid.target.buildingBinding??null:null,targetLabel:raid.target.label};
}

/** Some nights outlaws come of their own accord (never on the house's first day). */
export function nightlyRaidMinute(worldKey: string, day: number): number | null {
  if (day < 1 || hash01(`${worldKey}|night|${day}`) > .22) return null;
  return day * 1440 + 21 * 60 + 30 + Math.floor(hash01(`${worldKey}|night-hour|${day}`) * 240);
}

// ------------------------------------------------------------------ the record
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown, limit = 160): value is string => typeof value === "string" && value.length > 0 && value.length <= limit;
const OUTCOMES = new Set(["repelled", "plundered", "burned"]);

export function parseRaid(value: unknown): BanditRaid | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>, t = r.target as Record<string, unknown> | undefined;
  if (!text(r.id, 60) || !finite(r.seed) || !text(r.band) || !finite(r.size) || !t || typeof t !== "object"
    || !(t.siteIndex === null || finite(t.siteIndex)) || !RAID_BEARINGS.includes(t.bearing as RaidBearing) || !text(t.label)
    || !finite(r.startMinute) || !finite(r.sightedMinutes) || typeof r.provoked !== "boolean" || typeof r.warned !== "boolean"
    || typeof r.stormed !== "boolean" || !(r.outcome === null || OUTCOMES.has(r.outcome as string))
    || !(r.defenders === null || finite(r.defenders)) || !(r.loot === null || text(r.loot)) || !Array.isArray(r.written)
    || r.written.some(phase => !RAID_PHASES.includes(phase as RaidPhase))) return null;
  const a = r.allies as Record<string, unknown> | null | undefined;
  const allies: RaidAid | null = a && typeof a === "object" && text(a.houseId, 60) && text(a.house) && text(a.seat) && finite(a.riders)
    && RAID_BEARINGS.includes(a.bearing as RaidBearing) ? { houseId: a.houseId, house: a.house, seat: a.seat, riders: a.riders, bearing: a.bearing as RaidBearing } : null;
  let buildingBinding:BuildingDamageBinding|undefined;
  const worldKey=text(r.worldKey,2048)?r.worldKey:undefined;
  if(worldKey&&t.buildingBinding!==undefined)try{const binding=parseBuildingDamageBinding(t.buildingBinding);if(binding.siteIndex===t.siteIndex)buildingBinding=binding;}catch{/* Retain the old raid/label but hold an invalid source target unbound. */}
  const kept={...r};delete kept.worldKey;
  return { ...(kept as unknown as BanditRaid),...(worldKey?{worldKey}:{}),target:{siteIndex:t.siteIndex as number|null,bearing:t.bearing as RaidBearing,label:t.label as string,...(buildingBinding?{buildingBinding}:{})}, allies };
}
export function parseRaidRecords(value: unknown): readonly RaidRecord[] {
  return (Array.isArray(value) ? value : []).filter((r): r is RaidRecord => !!r && typeof r === "object"
    && text((r as RaidRecord).id, 60) && text((r as RaidRecord).band) && finite((r as RaidRecord).day)
    && OUTCOMES.has((r as RaidRecord).outcome) && text((r as RaidRecord).target) && typeof (r as RaidRecord).provoked === "boolean"
    && finite((r as RaidRecord).defenders)).map(r => {
      const kept={...r,aidHouseId:text(r.aidHouseId,60)?r.aidHouseId:null};delete kept.buildingBinding;
      if(text(r.worldKey,2048)&&r.buildingBinding)try{kept.buildingBinding=parseBuildingDamageBinding(r.buildingBinding);}catch{/* Corrupt source identity stays unbound. */}
      return kept;
    }).slice(-RAID_HISTORY_LIMIT);
}

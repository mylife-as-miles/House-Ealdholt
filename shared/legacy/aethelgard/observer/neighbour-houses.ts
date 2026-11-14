/**
 * The neighbouring houses of Aethelgard (the creator's direction of 10 November 2026: the neighbouring towns are other
 * houses of Aethelgard, and the observer influences their lives too). Four houses share the marches with Ealdholt:
 * the Great House at Stanhyrst Barrow and the frontier house at Hildmere Ford (both from shared/legacy/content/houses),
 * the market town of Holtmere and the hill kin of Thornhallow (names from the Aethelgard pool in content/names).
 *
 * Life passes between them without anyone's command: traders, pilgrims, kin, riders with word, gifts, requests for
 * help and boundary quarrels come to Ealdholt according to how each house regards it and how it fares; on set days
 * villagers walk out to market, to kin, and on pilgrimage to the Barrow-stones. The observer can reach into a
 * neighbour's life (bless or blight its year, turn its lord's heart toward Ealdholt or against it), once a village day
 * for each house. A friendly house rides to Ealdholt's beacon when bandits come (bandit-raid.ts).
 *
 * Pure and deterministic: every roll is a hash of the world key, the day and the house. All times are absolute
 * observed world minutes.
 */
import type { Heraldry } from "../../types";
import { getExternalHouse } from "../../content/houses";
import type { ChronicleResident, ResidentMemory } from "./village-chronicle";
import type { RaidBearing, RaidOutcome } from "./bandit-raid";
import type { VillagePopulation } from "../characters/village-population";
import {BUILDING_AID_TIMBER,BUILDING_AID_WORKERS,BUILDING_AID_LABOUR_MINUTES,parseBuildingDamageBinding,type BuildingDamageBinding,type BuildingAidDelivery} from './building-damage';

export type RealmHappeningKind = "traders" | "pilgrims" | "kin" | "envoy" | "gift" | "need" | "quarrel" | "outlaws";
export type RealmAct = "bless" | "blight" | "befriend" | "estrange";
export const REALM_ACTS: readonly RealmAct[] = ["bless", "blight", "befriend", "estrange"];
export type RegardBand = "feud" | "cold" | "wary" | "warm" | "sworn";
export type FortuneBand = "lean" | "steady" | "thriving";
export type OutingKind = "market" | "kin" | "pilgrimage";

export interface NeighbourHouse {
  readonly id: string;
  readonly name: string;
  /** The seat's short name, as villagers say it. */
  readonly seat: string;
  readonly seatLine: string;
  readonly temperament: string;
  readonly bearing: RaidBearing;
  readonly hoursByRoad: number;
  readonly heraldry: Heraldry;
  /** Riders it sends to a friend's beacon. */
  readonly riders: number;
  readonly initial: { readonly regard: number; readonly fortune: number };
  /** Who comes from there, as a memory names them. */
  readonly folk: string;
  readonly happenings: Readonly<Record<RealmHappeningKind, string>>;
  readonly acts: Readonly<Record<"bless" | "blight", string>>;
}

const stanhyrst = getExternalHouse("house-stanhyrst"), hildmere = getExternalHouse("house-hildmere");
if (!stanhyrst || !hildmere) throw new Error("Legacy content is missing Aethelgard's houses.");

export const NEIGHBOUR_HOUSES: readonly NeighbourHouse[] = Object.freeze([
  {
    id: stanhyrst.id, name: stanhyrst.name, seat: "Stanhyrst Barrow", seatLine: stanhyrst.seat,
    temperament: "The Great House of these marches, one of the oldest clans of the Blood-Throne. It calls Ealdholt a sapling and counts its dues.",
    bearing: "north", hoursByRoad: 5, heraldry: stanhyrst.heraldry, riders: 5, initial: { regard: 10, fortune: 68 },
    folk: "the barrow-wardens of Stanhyrst",
    happenings: {
      traders: "Barrow-wardens of Stanhyrst trade honey and carved bone by the well.",
      pilgrims: "Pilgrims from Stanhyrst Barrow stop to pray at Ealdholt's church on their way home.",
      kin: "A Stanhyrst elder sits at the hall's high table and is given the first cup.",
      envoy: "A rider from Stanhyrst Barrow brings the Great House's summons to the Old Fire.",
      gift: "House Stanhyrst sends a brand from the Old Fire to light Ealdholt's hearths.",
      need: "Stanhyrst asks for hands to raise a fallen stone; the reeve sends six with ropes.",
      quarrel: "Stanhyrst's steward comes to count Ealdholt's dues, and finds them short.",
      outlaws: "Word comes that outlaws robbed pilgrims on the Stanhyrst road.",
    },
    acts: { bless: "You fatten the barley around Stanhyrst Barrow.", blight: "You send rust into the barley around Stanhyrst Barrow." },
  },
  {
    id: hildmere.id, name: hildmere.name, seat: "Hildmere Ford", seatLine: hildmere.seat,
    temperament: "A hard-bitten frontier house with a garrison at the ford. It tests every banner, and rides hard for the few it trusts.",
    bearing: "east", hoursByRoad: 3, heraldry: hildmere.heraldry, riders: 6, initial: { regard: -22, fortune: 46 },
    folk: "the ford-riders of Hildmere",
    happenings: {
      traders: "Ford-riders of Hildmere sell hides and river salt by the well.",
      pilgrims: "Spearmen's wives from Hildmere Ford come to light candles in Ealdholt's church.",
      kin: "Hildmere's spearmen share ale with the watch in the guard yard.",
      envoy: "A rider from Hildmere Ford brings word of the river's height and the toll at the ford.",
      gift: "House Hildmere sends two hounds from the ford kennels for Ealdholt's watch.",
      need: "Hildmere asks for oats for the garrison's horses; the reeve loads a cart.",
      quarrel: "Hildmere's herdsmen drive cattle across Ealdholt's east boundary.",
      outlaws: "Word comes that outlaws tried the ford at Hildmere by night.",
    },
    acts: { bless: "You send a soft spring to Hildmere's water-meadows.", blight: "You bring the river over Hildmere's water-meadows." },
  },
  {
    id: "house-holtmere", name: "House Holtmere", seat: "Holtmere Market", seatLine: "A market town of guild halls where three roads meet",
    temperament: "A house of merchants and toll-keepers. It is friendly while trade is good, and remembers every unpaid toll.",
    bearing: "south", hoursByRoad: 2, riders: 3, initial: { regard: 16, fortune: 66 },
    heraldry: { division: "per-fess", field: ["azure", "or"], ordinary: "none", ordinaryTincture: "argent", charge: "key", chargeTincture: "argent" },
    folk: "the Holtmere traders",
    happenings: {
      traders: "Holtmere traders set out salt, needles and dyed cloth by the well.",
      pilgrims: "A Holtmere merchant's household comes to give thanks at Ealdholt's church.",
      kin: "Holtmere guildsmen dine in the hall and talk of prices until dark.",
      envoy: "A rider from Holtmere Market cries the day and the tolls of the next fair.",
      gift: "House Holtmere sends a cask of market ale for Ealdholt's hall.",
      need: "Holtmere asks for timber after a fire in the market row; the carpenter sends a load.",
      quarrel: "Holtmere's toll-keepers turn back an Ealdholt cart on the south road.",
      outlaws: "Word comes that outlaws waylaid carts on the Holtmere road.",
    },
    acts: { bless: "You hang Holtmere's orchards heavy with fruit.", blight: "You send blight through Holtmere's orchards." },
  },
  {
    id: "house-thornhallow", name: "House Thornhallow", seat: "Thornhallow", seatLine: "A stone hall and sheepfolds high on the western hills",
    temperament: "A poor hill house of shepherds, kin to Ealdholt by marriage. It gives freely in good years and asks freely in bad ones.",
    bearing: "west", hoursByRoad: 4, riders: 4, initial: { regard: 32, fortune: 30 },
    heraldry: { division: "per-chevron", field: ["vert", "argent"], ordinary: "none", ordinaryTincture: "or", charge: "mullet", chargeTincture: "or" },
    folk: "the Thornhallow shepherds",
    happenings: {
      traders: "Thornhallow shepherds bring fleeces and ewes' cheese to the well.",
      pilgrims: "Thornhallow hill-folk walk down to pray at Ealdholt's church.",
      kin: "Thornhallow kin come down for a betrothal feast on the green.",
      envoy: "A rider from Thornhallow brings news of births, lambing and an old aunt's health.",
      gift: "House Thornhallow sends a ram and three fleeces to its Ealdholt kin.",
      need: "Thornhallow asks for seed grain after a thin year; the reeve loads a cart.",
      quarrel: "Thornhallow shepherds graze their flock on Ealdholt's west common.",
      outlaws: "Word comes that outlaws lifted sheep from the Thornhallow folds.",
    },
    acts: { bless: "You give Thornhallow's ewes twin lambs.", blight: "You send murrain among Thornhallow's flocks." },
  },
] satisfies NeighbourHouse[]);
const HOUSE = new Map(NEIGHBOUR_HOUSES.map(house => [house.id, house]));
export const neighbourHouse = (id: string): NeighbourHouse | null => HOUSE.get(id) ?? null;

// ------------------------------------------------------------------ state
export interface HouseState {
  /** How the house regards Ealdholt, -100 (feud) to 100 (sworn friends). */
  readonly regard: number;
  /** How the house fares, 0 (ruin) to 100 (plenty). */
  readonly fortune: number;
  /** The village day the observer last reached into this house (-1: never). */
  readonly actedDay: number;
  /** What the observer's act brings about, and when. */
  readonly due: { readonly kind: RealmHappeningKind; readonly minute: number } | null;
  readonly news: { readonly text: string; readonly minute: number } | null;
}
export interface Outing {
  readonly kind: OutingKind;
  readonly houseId: string;
  readonly day: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly residentIds: readonly string[];
}
export interface RealmState {
  readonly houses: Readonly<Record<string, HouseState>>;
  /** Everything up to this minute has been resolved (-1: a new realm). */
  readonly resolvedMinute: number;
  readonly outing: Outing | null;
  readonly lastOutingDay: number;
}
/** `residentId` (one of the travellers) lets the chronicle offer to follow them. */
export interface RealmEvent { readonly kind: "realm" | "journey"; readonly text: string; readonly houseId?: string; readonly residentId?: string;
  /** What came down the road, on the first line of each happening (the village's talk follows it: village-voices.ts). */
  readonly happening?: RealmHappeningKind }
export interface RealmRoster {
  person(residentId: string): { readonly guard: boolean; readonly young: boolean; readonly leader: boolean } | null;
  ids(): readonly string[];
}
export interface RaidAid { readonly houseId: string; readonly house: string; readonly seat: string; readonly riders: number; readonly bearing: RaidBearing }

export function createPopulationRealmRoster(population: VillagePopulation): RealmRoster {
  const people = new Map(population.residents.map(resident => [resident.id, Object.freeze({
    guard: resident.group === "guards-military", leader: resident.group === "leaders-clergy-specialists",
    young: resident.ageBand === "child" || resident.ageBand === "adolescent",
  })]));
  const ids = Object.freeze(population.residents.map(resident => resident.id));
  return { person: id => people.get(id) ?? null, ids: () => ids };
}

export function createRealm(): RealmState {
  const houses: Record<string, HouseState> = {};
  for (const house of NEIGHBOUR_HOUSES) houses[house.id] = { regard: house.initial.regard, fortune: house.initial.fortune, actedDay: -1, due: null, news: null };
  return { houses, resolvedMinute: -1, outing: null, lastOutingDay: -1 };
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, Math.round(value)));
export function regardBand(regard: number): RegardBand {
  return regard <= -50 ? "feud" : regard <= -16 ? "cold" : regard < 16 ? "wary" : regard < 50 ? "warm" : "sworn";
}
export function fortuneBand(fortune: number): FortuneBand { return fortune < 35 ? "lean" : fortune < 65 ? "steady" : "thriving"; }

function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const dayOf = (minute: number) => Math.floor(minute / 1440);
const asleep = (activity: string) => /^asleep\b/i.test(activity.trim());
const COUNT = ["No one", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
function touch(realm: RealmState, houseId: string, change: Partial<HouseState> & { regardBy?: number; fortuneBy?: number }): RealmState {
  const state = realm.houses[houseId];
  if (!state) return realm;
  const { regardBy = 0, fortuneBy = 0, ...rest } = change;
  return { ...realm, houses: { ...realm.houses, [houseId]: { ...state, ...rest, regard: clamp(state.regard + regardBy, -100, 100), fortune: clamp(state.fortune + fortuneBy, 0, 100) } } };
}

// ------------------------------------------------------------------ what comes down the road
export interface RealmCandidate { readonly houseId: string; readonly minute: number; readonly roll: number }
/** Each day, each house has an even chance of sending something to Ealdholt between 07:00 and 18:00. */
export function realmCandidates(worldKey: string, day: number): readonly RealmCandidate[] {
  const out: RealmCandidate[] = [];
  for (const house of NEIGHBOUR_HOUSES) {
    if (hash01(`${worldKey}|realm|${day}|${house.id}`) >= .5) continue;
    out.push({ houseId: house.id, minute: day * 1440 + 420 + Math.floor(hash01(`${worldKey}|realm-hour|${day}|${house.id}`) * 660),
      roll: hash01(`${worldKey}|realm-kind|${day}|${house.id}`) });
  }
  return out.sort((a, b) => a.minute - b.minute);
}
/** What a house sends depends on how it regards Ealdholt and how it fares. */
export function chooseHappening(state: HouseState, roll: number): RealmHappeningKind {
  const band = regardBand(state.regard), lean = fortuneBand(state.fortune) === "lean";
  if (roll < .07) return "outlaws";
  if (lean && roll < .5) return band === "feud" || band === "cold" ? "quarrel" : "need";
  switch (band) {
    case "feud": return "quarrel";
    case "cold": return roll < .6 ? "quarrel" : "traders";
    case "wary": return roll < .45 ? "traders" : roll < .65 ? "pilgrims" : roll < .87 ? "envoy" : "quarrel";
    case "warm": return roll < .35 ? "traders" : roll < .55 ? "pilgrims" : roll < .75 ? "kin" : roll < .9 && !lean ? "gift" : "envoy";
    case "sworn": return roll < .25 ? "traders" : roll < .45 ? "pilgrims" : roll < .7 ? "kin" : lean ? "envoy" : "gift";
  }
}
const EFFECT: Readonly<Record<RealmHappeningKind, { readonly regard: number; readonly fortune: number }>> = {
  traders: { regard: 2, fortune: 2 }, pilgrims: { regard: 3, fortune: 0 }, kin: { regard: 6, fortune: 0 }, envoy: { regard: 1, fortune: 0 },
  gift: { regard: 4, fortune: -3 }, need: { regard: 8, fortune: 10 }, quarrel: { regard: -6, fortune: 0 }, outlaws: { regard: 0, fortune: -15 },
};
const AT_WELL = new Set(["village-well", "village-courtyard"]);
const AT_CHURCH = new Set(["churchyard", "proposed-church"]);
const AT_TABLE = new Set(["proposed-green", "proposed-house-hall", "proposed-guard-yard", "village-courtyard"]);
const STEWARD = "ealdholt-house-steward", REEVE = "ealdholt-village-reeve", PRIEST = "ealdholt-parish-priest";

function happen(realm: RealmState, houseId: string, kind: RealmHappeningKind, minute: number, residents: readonly ChronicleResident[], roster: RealmRoster):
  { realm: RealmState; events: RealmEvent[]; memories: [string, ResidentMemory][] } {
  const house = HOUSE.get(houseId), state = realm.houses[houseId];
  if (!house || !state) return { realm, events: [], memories: [] };
  const day = dayOf(minute) + 1, events: RealmEvent[] = [{ kind: "realm", text: house.happenings[kind], houseId, happening: kind }];
  const memories: [string, ResidentMemory][] = [], key = `realm:${houseId}:${kind}:${day}`;
  const remember = (ids: readonly string[], text: string) => { for (const id of ids) memories.push([id, { key, minute, text }]); };
  const awakeAt = (places: ReadonlySet<string>) => residents.filter(r => places.has(r.scheduledPlaceId) && !asleep(r.activity) && !r.away).map(r => r.residentId);
  let effect = EFFECT[kind], news = house.happenings[kind];
  if (kind === "traders") remember(awakeAt(AT_WELL), `Traded with ${house.folk} by the well on day ${day}.`);
  else if (kind === "pilgrims") remember([...new Set([...awakeAt(AT_CHURCH), PRIEST])], `Prayed beside pilgrims from ${house.seat} on day ${day}.`);
  else if (kind === "kin") remember(awakeAt(AT_TABLE), `Shared a cup with ${house.name}'s people on day ${day}.`);
  else if (kind === "envoy" || kind === "gift") remember([STEWARD], kind === "gift" ? `Received ${house.name}'s gift on day ${day}.` : `Heard out the rider from ${house.seat} on day ${day}.`);
  else if (kind === "need") remember([REEVE], `Sent help to ${house.seat} on day ${day}.`);
  else if (kind === "quarrel") remember([REEVE], `Argued Ealdholt's case against ${house.name} on day ${day}.`);
  else {
    // Outlaws strike a neighbour: a warm house's call is answered by Ealdholt's watch; otherwise the doors stay barred.
    const friends = regardBand(state.regard) === "warm" || regardBand(state.regard) === "sworn";
    const riders = friends ? residents.filter(r => roster.person(r.residentId)?.guard && !asleep(r.activity)).slice(0, 6).map(r => r.residentId) : [];
    if (riders.length) {
      effect = { regard: 10, fortune: -8 };
      events.push({ kind: "realm", text: `${COUNT[riders.length]} of Ealdholt's watch ride to ${house.seat} and help run them off.`, houseId });
      remember(riders, `Rode to ${house.seat} against outlaws on day ${day}.`);
      news = `Ealdholt's watch rode to ${house.seat} against outlaws.`;
    } else {
      effect = { regard: friends ? 0 : -3, fortune: -15 };
      events.push({ kind: "realm", text: friends ? "Ealdholt's watch is abed and no one rides." : "Ealdholt bars its own doors and does not ride.", houseId });
    }
  }
  return { realm: touch(realm, houseId, { regardBy: effect.regard, fortuneBy: effect.fortune, news: { text: news, minute } }), events, memories };
}

// ------------------------------------------------------------------ the observer's hand
export const ACT_LABEL: Readonly<Record<RealmAct, string>> = {
  bless: "Bless their year", blight: "Send a hard season", befriend: "A dream of friendship", estrange: "An old slight",
};
/** The observer reaches into a neighbour's life, once a village day for each house; null when already done today. */
export function actOnHouse(realm: RealmState, houseId: string, act: RealmAct, minute: number): { readonly realm: RealmState; readonly text: string } | null {
  const house = HOUSE.get(houseId), state = realm.houses[houseId], day = dayOf(minute);
  if (!house || !state || state.actedDay >= day) return null;
  // What follows arrives the next morning, between 08:00 and 10:00.
  const dueMinute = (day + 1) * 1440 + 480 + Math.floor(hash01(`${houseId}|due|${day}`) * 120);
  const friendly = state.regard > -16;
  switch (act) {
    case "bless": return { text: house.acts.bless, realm: touch(realm, houseId, { fortuneBy: 30, actedDay: day, due: friendly ? { kind: "gift", minute: dueMinute } : null }) };
    case "blight": return { text: house.acts.blight, realm: touch(realm, houseId, { fortuneBy: -30, actedDay: day, due: { kind: friendly ? "need" : "quarrel", minute: dueMinute } }) };
    case "befriend": return { text: `You send the lord of ${house.seat} a dream of an old kindness done by Ealdholt.`,
      realm: touch(realm, houseId, { regardBy: 15, actedDay: day, due: { kind: "envoy", minute: dueMinute } }) };
    case "estrange": return { text: `You whisper an old slight against Ealdholt into the hall at ${house.seat}.`,
      realm: touch(realm, houseId, { regardBy: -15, actedDay: day, due: { kind: "quarrel", minute: dueMinute } }) };
  }
}

// ------------------------------------------------------------------ villagers on the road
const OUTINGS: Readonly<Record<number, { readonly kind: OutingKind; readonly houseId: string; readonly start: number; readonly end: number; readonly people: number }>> = {
  1: { kind: "market", houseId: "house-holtmere", start: 7 * 60, end: 15 * 60 + 30, people: 6 },
  3: { kind: "kin", houseId: "house-thornhallow", start: 8 * 60, end: 16 * 60 + 30, people: 4 },
  5: { kind: "pilgrimage", houseId: "house-stanhyrst", start: 6 * 60 + 30, end: 17 * 60 + 30, people: 8 },
};
const OUTING_PLACE: Readonly<Record<OutingKind, (house: NeighbourHouse) => string>> = {
  market: house => house.seat, kin: house => house.seat, pilgrimage: () => "the Barrow-stones of Stanhyrst",
};
/** Market on the second day of each week, kin on the fourth, pilgrimage to the Barrow-stones on the sixth. */
export function outingForDay(worldKey: string, day: number, roster: RealmRoster): Outing | null {
  const plan = OUTINGS[((day % 7) + 7) % 7];
  if (!plan || day < 1) return null;
  const residentIds = roster.ids().filter(id => { const person = roster.person(id); return !!person && !person.guard && !person.young && !person.leader; })
    .map(id => [hash01(`${worldKey}|outing|${day}|${id}`), id] as const).sort((a, b) => a[0] - b[0]).slice(0, plan.people).map(([, id]) => id);
  return { kind: plan.kind, houseId: plan.houseId, day, startMinute: day * 1440 + plan.start, endMinute: day * 1440 + plan.end, residentIds };
}
/** A villager on an outing: on the road, there, or walking home. Everyone else is unchanged. */
export function outingResident(outing: Outing | null, minute: number, resident: ChronicleResident): ChronicleResident {
  if (!outing || minute < outing.startMinute || minute >= outing.endMinute || !outing.residentIds.includes(resident.residentId)) return resident;
  const house = HOUSE.get(outing.houseId);
  if (!house) return resident;
  const third = Math.min(2, Math.floor(((minute - outing.startMinute) / (outing.endMinute - outing.startMinute)) * 3)), place = OUTING_PLACE[outing.kind](house);
  const activity = third === 0 ? (outing.kind === "pilgrimage" ? `Walks the ${house.bearing} road with the pilgrims.` : `Walks the ${house.bearing} road to ${place}.`)
    : third === 2 ? `Walks home from ${place}.`
    : outing.kind === "market" ? `Sells and haggles at ${place}.` : outing.kind === "kin" ? `Sits with kin at ${place}.` : `Prays at ${place}.`;
  return { ...resident, activity, scheduledPlaceId: "proposed-road-beyond", slotIndex: 2000 + third, away: true };
}
/** Where the house messenger's road leads on a given day: each house in turn, never one at feud with Ealdholt. */
export function messengerDestination(realm: RealmState, day: number): NeighbourHouse | null {
  for (let step = 0; step < NEIGHBOUR_HOUSES.length; step++) {
    const house = NEIGHBOUR_HOUSES[(((day + step) % NEIGHBOUR_HOUSES.length) + NEIGHBOUR_HOUSES.length) % NEIGHBOUR_HOUSES.length];
    if (regardBand(realm.houses[house.id]?.regard ?? 0) !== "feud") return house;
  }
  return null;
}

// ------------------------------------------------------------------ one look at the realm
export interface RealmStep {
  readonly realm: RealmState;
  readonly events: readonly RealmEvent[];
  readonly memories: readonly (readonly [string, ResidentMemory])[];
  /** The villagers with anyone on an outing shown on the road. */
  readonly residents: readonly ChronicleResident[];
}
/** Resolves everything between the last look and now, in order. A long absence is caught up over its last two days. */
export function advanceRealm(realm: RealmState, input: { worldKey: string; minute: number; residents: readonly ChronicleResident[]; roster: RealmRoster }): RealmStep {
  const { worldKey, minute, roster } = input, events: RealmEvent[] = [], memories: [string, ResidentMemory][] = [];
  const first = realm.resolvedMinute < 0, from = first ? minute : Math.max(realm.resolvedMinute, minute - 2880);
  let next = realm;
  type Due = { readonly minute: number; run(): void };
  const queue: Due[] = [];
  const apply = (result: { realm: RealmState; events: RealmEvent[]; memories: [string, ResidentMemory][] }) => { next = result.realm; events.push(...result.events); memories.push(...result.memories); };
  if (!first) for (let day = dayOf(from); day <= dayOf(minute); day++) for (const candidate of realmCandidates(worldKey, day)) {
    if (candidate.minute <= from || candidate.minute > minute) continue;
    queue.push({ minute: candidate.minute, run: () => { const state = next.houses[candidate.houseId]; if (state) apply(happen(next, candidate.houseId, chooseHappening(state, candidate.roll), candidate.minute, input.residents, roster)); } });
  }
  for (const house of NEIGHBOUR_HOUSES) {
    const due = realm.houses[house.id]?.due;
    if (due && due.minute <= minute) queue.push({ minute: due.minute, run: () => { next = touch(next, house.id, { due: null }); apply(happen(next, house.id, due.kind, due.minute, input.residents, roster)); } });
  }
  queue.sort((a, b) => a.minute - b.minute).forEach(item => item.run());

  // Outings: home again first, then today's setting out.
  if (next.outing && minute >= next.outing.endMinute) {
    const outing = next.outing, house = HOUSE.get(outing.houseId)!, place = OUTING_PLACE[outing.kind](house), day = outing.day + 1;
    events.push({ kind: "journey", houseId: house.id, text: outing.kind === "pilgrimage" ? "The pilgrims come home from the Barrow-stones at dusk."
      : outing.kind === "market" ? `The market-goers come home from ${place} with full baskets.` : `The visitors come home from ${place}.` });
    for (const id of outing.residentIds) memories.push([id, { key: `outing:${outing.kind}:${day}`, minute: outing.endMinute,
      text: outing.kind === "pilgrimage" ? `Walked to ${place} on day ${day}.` : outing.kind === "market" ? `Went to market at ${place} on day ${day}.` : `Visited kin at ${place} on day ${day}.` }]);
    next = touch({ ...next, outing: null }, house.id, { regardBy: 2 });
  }
  const today = dayOf(minute);
  if (!next.outing && next.lastOutingDay < today) {
    const plan = outingForDay(worldKey, today, roster);
    if (plan && minute >= plan.startMinute) {
      next = { ...next, lastOutingDay: today };
      const house = HOUSE.get(plan.houseId)!;
      if (minute >= plan.endMinute) { /* The day was skipped over: nobody is written as having gone. */ }
      else if (regardBand(next.houses[house.id]?.regard ?? 0) === "feud") {
        events.push({ kind: "journey", houseId: house.id, text: `No one walks to ${house.seat} today: Ealdholt is at feud with ${house.name}.` });
      } else {
        next = { ...next, outing: plan };
        events.push({ kind: "journey", houseId: house.id, residentId: plan.residentIds[0], text: `${COUNT[plan.residentIds.length] ?? plan.residentIds.length} of Ealdholt set out for ${OUTING_PLACE[plan.kind](house)}.` });
      }
    }
  }
  next = { ...next, resolvedMinute: minute };
  return { realm: next, events, memories, residents: input.residents.map(resident => outingResident(next.outing, minute, resident)) };
}

// ------------------------------------------------------------------ bandits and the beacon
/** The friendliest house that would ride to Ealdholt's beacon (regard 40 or more), if any. */
export function raidAid(realm: RealmState): RaidAid | null {
  let best: NeighbourHouse | null = null;
  for (const house of NEIGHBOUR_HOUSES) {
    const regard = realm.houses[house.id]?.regard ?? -100;
    if (regard >= 40 && (!best || regard > (realm.houses[best.id]?.regard ?? -100))) best = house;
  }
  return best ? { houseId: best.id, house: best.name, seat: best.seat, riders: best.riders, bearing: best.bearing } : null;
}
/** After a raid on Ealdholt: riders who came are bound closer; a burning brings help from the warmest house. */
export function afterRaid(realm: RealmState, raid: { readonly id?:string;readonly worldKey?:string;readonly buildingBinding?:BuildingDamageBinding;readonly outcome: RaidOutcome; readonly aidHouseId: string | null }, minute: number): { readonly realm: RealmState; readonly events: readonly RealmEvent[];readonly rebuildingAid:BuildingAidDelivery|null } {
  const events: RealmEvent[] = [];
  let rebuildingAid:BuildingAidDelivery|null=null;
  let next = realm;
  const ally = raid.aidHouseId ? HOUSE.get(raid.aidHouseId) : undefined;
  if (ally) {
    const text = `Ealdholt and ${ally.name} stood together against the outlaws. It will be remembered at ${ally.seat}.`;
    next = touch(next, ally.id, { regardBy: 6, news: { text, minute } }); events.push({ kind: "realm", text, houseId: ally.id });
  }
  if (raid.outcome === "repelled") for (const house of NEIGHBOUR_HOUSES) next = touch(next, house.id, { regardBy: 2 });
  if (raid.outcome === "burned") {
    const warmest = [...NEIGHBOUR_HOUSES].sort((a, b) => (next.houses[b.id]?.regard ?? 0) - (next.houses[a.id]?.regard ?? 0))[0];
    if (warmest && (next.houses[warmest.id]?.regard ?? 0) >= 16) {
      const text = `${warmest.name} sends hands and timber to raise what the outlaws burned.`;
      next = touch(next, warmest.id, { regardBy: 4, news: { text, minute } }); events.push({ kind: "realm", text, houseId: warmest.id });
      // Quantify only a NEW identified raid's existing delivery. Old history
      // labels cannot mint a stockpile or invent a damaged source building.
      if(raid.id&&raid.worldKey&&raid.buildingBinding&&/^raid-\d+-\d+$/u.test(raid.id)&&Number.isSafeInteger(minute)&&minute>=0)try{
        parseBuildingDamageBinding(raid.buildingBinding);rebuildingAid={worldKey:raid.worldKey,raidId:raid.id,deliveredMinute:minute,
          houseId:warmest.id,houseLabel:warmest.name,timber:BUILDING_AID_TIMBER,workers:BUILDING_AID_WORKERS,labourMinutes:BUILDING_AID_LABOUR_MINUTES};
      }catch{/* An unbound narrative burning cannot mint materials for a real source building. */}
    }
  }
  return { realm: next, events,rebuildingAid };
}

// ------------------------------------------------------------------ the record
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown, limit = 240): value is string => typeof value === "string" && value.length > 0 && value.length <= limit;
const KINDS = new Set<string>(["traders", "pilgrims", "kin", "envoy", "gift", "need", "quarrel", "outlaws"]);
const OUTING_KINDS = new Set<string>(["market", "kin", "pilgrimage"]);
/** Reads a saved realm defensively: anything malformed falls back to that house's (or the realm's) beginning. */
export function parseRealm(value: unknown): RealmState {
  const fresh = createRealm();
  if (!value || typeof value !== "object") return fresh;
  const r = value as Record<string, unknown>, saved = r.houses && typeof r.houses === "object" ? r.houses as Record<string, unknown> : {};
  const houses: Record<string, HouseState> = {};
  for (const house of NEIGHBOUR_HOUSES) {
    const s = saved[house.id] as Record<string, unknown> | undefined, base = fresh.houses[house.id];
    if (!s || typeof s !== "object" || !finite(s.regard) || !finite(s.fortune)) { houses[house.id] = base; continue; }
    const due = s.due as Record<string, unknown> | null | undefined, news = s.news as Record<string, unknown> | null | undefined;
    houses[house.id] = {
      regard: clamp(s.regard, -100, 100), fortune: clamp(s.fortune, 0, 100), actedDay: finite(s.actedDay) ? Math.floor(s.actedDay) : -1,
      due: due && typeof due === "object" && KINDS.has(due.kind as string) && finite(due.minute) ? { kind: due.kind as RealmHappeningKind, minute: due.minute } : null,
      news: news && typeof news === "object" && text(news.text) && finite(news.minute) ? { text: news.text, minute: news.minute } : null,
    };
  }
  const o = r.outing as Record<string, unknown> | null | undefined;
  const outing: Outing | null = o && typeof o === "object" && OUTING_KINDS.has(o.kind as string) && HOUSE.has(o.houseId as string) && finite(o.day)
    && finite(o.startMinute) && finite(o.endMinute) && Array.isArray(o.residentIds) && o.residentIds.length <= 24 && o.residentIds.every(id => text(id, 120))
    ? { kind: o.kind as OutingKind, houseId: o.houseId as string, day: o.day, startMinute: o.startMinute, endMinute: o.endMinute, residentIds: o.residentIds as string[] } : null;
  return { houses, outing, resolvedMinute: finite(r.resolvedMinute) ? r.resolvedMinute : -1, lastOutingDay: finite(r.lastOutingDay) ? Math.floor(r.lastOutingDay) : -1 };
}

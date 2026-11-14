/**
 * The observer's chronicle of House Ealdholt: what the village does while it is watched, and what its people remember.
 *
 * The villagers keep their own daily routines (village-population.ts) whether or not anyone watches; this module only
 * notices them. Each observation compares where everyone is in their day with the last one and writes down what is
 * worth reading: a walk to the church, a journey out along the road, neighbours gathering to trade news, and every
 * step of the one villager the observer is following. The sky changing, and the observer's own interventions, are
 * written down too; villagers caught out of doors by a storm the observer called remember it, as do those who went to
 * pray. The memory model (a short, newest-first list per person, de-duplicated) follows hello-world's
 * simulation/relationships.ts (addMemory, MAX_MEMORIES), with the creator's leave.
 */

/** One resident's place in their day, as the population runtime samples it (site positions are not needed). */
export interface ChronicleResident {
  readonly residentId: string;
  readonly activity: string;
  readonly scheduledPlaceId: string;
  readonly slotIndex: number;
  /** Held by a raid (sheltering, mustering): only the followed villager's moments are written down. */
  readonly alarm?: boolean;
  /** Away on an outing beyond the village (market, kin, pilgrimage): likewise only written when followed. */
  readonly away?: boolean;
}

export interface ChronicleObservation {
  /** Absolute observed world minute. */
  readonly minute: number;
  readonly residents: readonly ChronicleResident[];
  /** The sky as it actually stands now ('rain' includes a storm). */
  readonly weather: "clear" | "overcast" | "rain";
  /** True while the observer's storm command holds. */
  readonly storm: boolean;
  /** The villager the observer is following, if any. */
  readonly followId: string | null;
}

export type ChronicleKind = "life" | "worship" | "journey" | "gathering" | "sky" | "power" | "threat" | "realm";

export interface ChronicleEntry {
  readonly id: string;
  readonly minute: number;
  readonly kind: ChronicleKind;
  readonly text: string;
  readonly residentId?: string;
}

export interface ResidentMemory {
  readonly key: string;
  readonly minute: number;
  readonly text: string;
}

export interface VillageChronicle {
  readonly entries: readonly ChronicleEntry[];
  readonly memories: Readonly<Record<string, readonly ResidentMemory[]>>;
  /** Where everyone stood at the last observation; not saved (the first look after a load writes nothing). */
  readonly lastSlots: Readonly<Record<string, number>>;
  readonly lastWeather: "clear" | "overcast" | "rain" | "storm" | null;
  readonly serial: number;
}

/** How the chronicle names people and places; supplied from the village population. */
export interface ChronicleRoster {
  person(residentId: string): { readonly label: string; readonly major: boolean } | null;
  place(placeId: string): { readonly label: string; readonly kind: "home" | "workplace" | "social" | "service" | "travel" } | null;
  /** Where the road leads for someone setting out today (a neighbouring house's seat), when the realm knows. */
  roadTo?(residentId: string, day: number): string | null;
}

export const CHRONICLE_ENTRY_LIMIT = 80;
export const MEMORY_LIMIT = 8;
/** Gatherings are frequent; at most this many make the chronicle per observation. */
const GATHERING_LIMIT = 2;

const WORSHIP_PLACES = new Set(["proposed-church", "churchyard"]);
/** Being at the church is not worship: the mason builds there and the keeper sweeps. Only devotion counts. */
const WORSHIP_WORDS = /\b(pray|prays|prayers|office|mass|service|bless|blesses|blessing|vespers|matins|psalms?|hymns?|sermon|confess|confession|worship|kneels|bell)\b/i;
const JOURNEY_PLACES = new Set(["proposed-road-beyond"]);
const GATHERING_WORDS = /\b(news|stories|gossip|trades|plays|games)\b/i;

export function createVillageChronicle(saved?: Partial<Pick<VillageChronicle, "entries" | "memories">>): VillageChronicle {
  return {
    entries: Array.isArray(saved?.entries) ? saved!.entries.slice(-CHRONICLE_ENTRY_LIMIT) : [],
    memories: saved?.memories && typeof saved.memories === "object" ? saved.memories : {},
    lastSlots: {}, lastWeather: null, serial: Array.isArray(saved?.entries) ? saved!.entries.length : 0,
  };
}

/** "Village smith" -> "The village smith"; "Lights the forge." -> "lights the forge." */
export function subject(label: string): string {
  const trimmed = label.trim();
  return /^(the|a|an)\s/i.test(trimmed) ? trimmed[0].toUpperCase() + trimmed.slice(1) : `The ${trimmed[0].toLowerCase()}${trimmed.slice(1)}`;
}
export function predicate(activity: string): string {
  const trimmed = activity.trim().replace(/\.$/, "");
  return trimmed ? trimmed[0].toLowerCase() + trimmed.slice(1) : "";
}
/** One villager's moment as a sentence. Most routine activities begin with a verb ("Lights the forge."); a few are
 * noun phrases ("Midday meal with the household.", "Asleep at home.") and are written so they still read. */
export function lifeLine(who: string, activity: string): string {
  const what = predicate(activity);
  const first = activity.trim().split(/\s+/)[0]?.replace(/,$/, "") ?? "";
  if (/^[A-Z][a-z]*s$/.test(first)) return `${who} ${what}.`;
  if (first === "Asleep") return `${who} is ${what}.`;
  return `${who}: ${what}.`;
}
/** "Parish church interior (proposed placeholder)" -> "the parish church interior". */
export function placePhrase(label: string): string {
  const bare = label.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return /^the\s/i.test(bare) ? bare[0].toLowerCase() + bare.slice(1) : `the ${bare[0]?.toLowerCase() ?? ""}${bare.slice(1)}`;
}

export function formatChronicleTime(minute: number): string {
  const whole = Math.max(0, Math.floor(minute)), day = Math.floor(whole / 1440) + 1, inDay = whole % 1440;
  return `Day ${day} · ${String(Math.floor(inDay / 60)).padStart(2, "0")}:${String(inDay % 60).padStart(2, "0")}`;
}

function remember(memories: Record<string, readonly ResidentMemory[]>, residentId: string, memory: ResidentMemory): void {
  const list = memories[residentId] ?? [];
  if (list.some(item => item.key === memory.key)) return;
  memories[residentId] = [memory, ...list].slice(0, MEMORY_LIMIT);
}

function append(entries: ChronicleEntry[], serial: number, entry: Omit<ChronicleEntry, "id">): number {
  entries.push({ ...entry, id: `c${serial}` });
  return serial + 1;
}

/** The observer reached in: written down at once, whatever the villagers are doing. */
export function recordPower(chronicle: VillageChronicle, minute: number, text: string): VillageChronicle {
  const entries = [...chronicle.entries];
  const serial = append(entries, chronicle.serial, { minute, kind: "power", text });
  return { ...chronicle, entries: entries.slice(-CHRONICLE_ENTRY_LIMIT), serial };
}

/** Events from outside the villagers' routines (a raid), written down in order. */
export function recordEvents(chronicle: VillageChronicle, minute: number, kind: ChronicleKind,
  events: readonly { readonly text: string; readonly residentId?: string }[]): VillageChronicle {
  if (!events.length) return chronicle;
  const entries = [...chronicle.entries];
  let serial = chronicle.serial;
  for (const event of events) serial = append(entries, serial, { minute, kind, text: event.text, ...(event.residentId ? { residentId: event.residentId } : {}) });
  return { ...chronicle, entries: entries.slice(-CHRONICLE_ENTRY_LIMIT), serial };
}
/** Memories from outside the routines (fought, hid, carried water), each kept once per person. */
export function rememberAll(chronicle: VillageChronicle, memories: readonly (readonly [string, ResidentMemory])[]): VillageChronicle {
  if (!memories.length) return chronicle;
  const next: Record<string, readonly ResidentMemory[]> = { ...chronicle.memories };
  for (const [residentId, memory] of memories) remember(next, residentId, memory);
  return { ...chronicle, memories: next };
}

const SKY_TEXT: Record<"clear" | "overcast" | "rain" | "storm", string> = {
  clear: "The sky clears over Ealdholt.",
  overcast: "Cloud closes over Ealdholt.",
  rain: "Rain comes down over Ealdholt.",
  storm: "A storm breaks over Ealdholt.",
};

export function observeVillage(chronicle: VillageChronicle, observation: ChronicleObservation, roster: ChronicleRoster): VillageChronicle {
  const entries = [...chronicle.entries];
  const memories: Record<string, readonly ResidentMemory[]> = { ...chronicle.memories };
  const lastSlots: Record<string, number> = {};
  let serial = chronicle.serial, gatherings = 0;
  const first = Object.keys(chronicle.lastSlots).length === 0;
  const day = Math.floor(observation.minute / 1440);

  for (const resident of observation.residents) {
    lastSlots[resident.residentId] = resident.slotIndex;
    if (first || chronicle.lastSlots[resident.residentId] === resident.slotIndex) continue;
    const person = roster.person(resident.residentId), place = roster.place(resident.scheduledPlaceId);
    if (!person) continue;
    const who = subject(person.label), what = predicate(resident.activity);
    if (!what) continue;
    const followed = resident.residentId === observation.followId;
    if (resident.alarm || resident.away) {
      if (followed) serial = append(entries, serial, { minute: observation.minute, kind: "life", text: lifeLine(who, resident.activity), residentId: resident.residentId });
    } else if (WORSHIP_PLACES.has(resident.scheduledPlaceId) && WORSHIP_WORDS.test(resident.activity)) {
      serial = append(entries, serial, { minute: observation.minute, kind: "worship", text: lifeLine(who, resident.activity), residentId: resident.residentId });
      remember(memories, resident.residentId, { key: `worship:${day}`, minute: observation.minute, text: `Went to ${place ? placePhrase(place.label) : "the church"} on day ${day + 1}.` });
    } else if (JOURNEY_PLACES.has(resident.scheduledPlaceId)) {
      const seat = roster.roadTo?.(resident.residentId, day) ?? null;
      serial = append(entries, serial, { minute: observation.minute, kind: "journey", residentId: resident.residentId,
        text: seat ? `${who} takes the road to ${seat}.` : `${who} sets out on the road beyond the village.` });
      remember(memories, resident.residentId, { key: `journey:${day}`, minute: observation.minute,
        text: seat ? `Took the road to ${seat} on day ${day + 1}.` : `Took the road beyond the village on day ${day + 1}.` });
    } else if (followed) {
      serial = append(entries, serial, { minute: observation.minute, kind: "life", text: lifeLine(who, resident.activity), residentId: resident.residentId });
    } else if (GATHERING_WORDS.test(resident.activity) && place && place.kind === "social" && gatherings < GATHERING_LIMIT) {
      gatherings++;
      serial = append(entries, serial, { minute: observation.minute, kind: "gathering", text: lifeLine(who, resident.activity), residentId: resident.residentId });
    }
  }

  // The sky: written down when it turns, remembered by whoever it caught out of doors.
  const sky = observation.storm ? "storm" : observation.weather;
  if (!first && chronicle.lastWeather !== null && sky !== chronicle.lastWeather) {
    serial = append(entries, serial, { minute: observation.minute, kind: "sky", text: SKY_TEXT[sky] });
    if (sky === "rain" || sky === "storm") {
      for (const resident of observation.residents) {
        const place = roster.place(resident.scheduledPlaceId);
        if (!place || place.kind === "home") continue;
        remember(memories, resident.residentId, {
          key: `${sky}:${Math.floor(observation.minute / 60)}`, minute: observation.minute,
          text: `Caught by the ${sky === "storm" ? "storm" : "rain"} at ${placePhrase(place.label)} on day ${day + 1}.`,
        });
      }
    }
  }

  return { entries: entries.slice(-CHRONICLE_ENTRY_LIMIT), memories, lastSlots, lastWeather: sky, serial };
}

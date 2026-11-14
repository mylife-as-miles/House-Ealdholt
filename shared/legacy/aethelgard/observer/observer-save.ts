/**
 * What the observer leaves behind in one village, saved beside (never inside) the population save: the offset of the
 * observed clock, the sky command still in force, the chronicle and the villagers' memories. Keyed by the same world
 * key as the population, so a new house founding starts a new record.
 */
import { CHRONICLE_ENTRY_LIMIT, MEMORY_LIMIT, type ChronicleEntry, type ResidentMemory } from "./village-chronicle";
import { isObserverSpeed, isObserverWeather, type ObserverSpeed, type ObserverWeatherCommand } from "./observer-time";
import { parseRaid, parseRaidRecords, RAID_HISTORY_LIMIT, type BanditRaid, type RaidRecord } from "./bandit-raid";
import { createRealm, parseRealm, type RealmState } from "./neighbour-houses";
import {restoreBuildingDamage,serializeBuildingDamageRestore,type BuildingDamageRestore} from './building-damage';
import {restoreObserverRaidCursor,serializeObserverRaidCursor,type ObserverRaidCursorRestore} from './observer-raid-cursor';
import {restoreBuildingConflagration,serializeBuildingConflagrationRestore,type BuildingConflagrationRestore} from './building-conflagration';
import {restoreVillagePopulationEmergencyCheckpoint,serializeVillagePopulationEmergencyCheckpointRestore,type VillagePopulationEmergencyCheckpointRestore} from '../characters/village-population-runtime';
import {restoreBuildingLocalRebuildOrders,serializeBuildingLocalRebuildOrdersRestore,type BuildingLocalRebuildOrdersRestore} from './building-disaster-session';

export const OBSERVER_SAVE_PREFIX = "crownfall.ealdholt.observer.v1:";

export interface ObserverSave {
  readonly version: 1;
  readonly offsetMilliseconds: number;
  readonly speed: ObserverSpeed;
  readonly weather: ObserverWeatherCommand | null;
  readonly entries: readonly ChronicleEntry[];
  readonly memories: Readonly<Record<string, readonly ResidentMemory[]>>;
  /** The raid under way, if any; past raids, newest last; the serial for raid ids; the last village day bandits came. */
  readonly raid: BanditRaid | null;
  readonly raids: readonly RaidRecord[];
  readonly raidSerial: number;
  readonly lastRaidDay: number;
  /** The neighbouring houses: how each regards Ealdholt and fares, and any outing under way. */
  readonly realm: RealmState;
  /** Absent in old saves. Invalid new data remains preserved and explicitly
   * blocked, rather than being replaced by a sound/empty village. */
  readonly buildingDamage?:BuildingDamageRestore;
  /** Nightly checks resolved after explicit migration, independent of whether
   * any raid actually happened. Unknown records remain preserved and blocked. */
  readonly raidCursor?:ObserverRaidCursorRestore;
  /** New disaster state is source-locked. Unknown data remains recoverable. */
  readonly buildingFire?:BuildingConflagrationRestore;
  readonly buildingEmergency?:VillagePopulationEmergencyCheckpointRestore;
  readonly localRebuildOrders?:BuildingLocalRebuildOrdersRestore;
}

export const EMPTY_OBSERVER_SAVE: ObserverSave = Object.freeze({ version: 1, offsetMilliseconds: 0, speed: 1, weather: null, entries: [], memories: {},
  raid: null, raids: [], raidSerial: 0, lastRaidDay: -1, realm: createRealm() });

const KINDS = new Set(["life", "worship", "journey", "gathering", "sky", "power", "threat", "realm"]);
const text = (value: unknown, limit = 400): value is string => typeof value === "string" && value.length > 0 && value.length <= limit;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Reads a save defensively: anything malformed falls back to a clean record rather than breaking the village. */
export function parseObserverSave(json: string | null,worldKey?:string): ObserverSave {
  if (!json) return EMPTY_OBSERVER_SAVE;
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return EMPTY_OBSERVER_SAVE; }
  if (!raw || typeof raw !== "object") return EMPTY_OBSERVER_SAVE;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return EMPTY_OBSERVER_SAVE;
  const weather = r.weather && typeof r.weather === "object" && isObserverWeather((r.weather as Record<string, unknown>).kind)
    && finite((r.weather as Record<string, unknown>).untilMinute) ? r.weather as ObserverWeatherCommand : null;
  const entries = (Array.isArray(r.entries) ? r.entries : []).filter((entry): entry is ChronicleEntry => !!entry && typeof entry === "object"
    && text((entry as ChronicleEntry).id, 40) && finite((entry as ChronicleEntry).minute) && KINDS.has((entry as ChronicleEntry).kind)
    && text((entry as ChronicleEntry).text)).slice(-CHRONICLE_ENTRY_LIMIT);
  const memories: Record<string, readonly ResidentMemory[]> = {};
  if (r.memories && typeof r.memories === "object") {
    for (const [id, list] of Object.entries(r.memories as Record<string, unknown>)) {
      if (!text(id, 120) || !Array.isArray(list)) continue;
      const kept = list.filter((m): m is ResidentMemory => !!m && typeof m === "object" && text((m as ResidentMemory).key, 80)
        && finite((m as ResidentMemory).minute) && text((m as ResidentMemory).text)).slice(0, MEMORY_LIMIT);
      if (kept.length) memories[id] = kept;
    }
  }
  return {
    version: 1,
    offsetMilliseconds: finite(r.offsetMilliseconds) ? r.offsetMilliseconds : 0,
    speed: isObserverSpeed(r.speed) ? r.speed : 1,
    weather, entries, memories,
    raid: parseRaid(r.raid), raids: parseRaidRecords(r.raids),
    raidSerial: finite(r.raidSerial) && r.raidSerial >= 0 ? Math.floor(r.raidSerial) : 0,
    lastRaidDay: finite(r.lastRaidDay) ? Math.floor(r.lastRaidDay) : -1,
    realm: parseRealm(r.realm),
    ...(Object.prototype.hasOwnProperty.call(r,'buildingDamage')?{buildingDamage:restoreBuildingDamage(r.buildingDamage,worldKey)}:{}),
    ...(Object.prototype.hasOwnProperty.call(r,'raidCursor')?{raidCursor:restoreObserverRaidCursor(r.raidCursor,worldKey??'')}:{}),
    ...(Object.prototype.hasOwnProperty.call(r,'buildingFire')?{buildingFire:restoreBuildingConflagration(r.buildingFire,worldKey)}:{}),
    ...(Object.prototype.hasOwnProperty.call(r,'buildingEmergency')?{buildingEmergency:restoreVillagePopulationEmergencyCheckpoint(r.buildingEmergency,worldKey)}:{}),
    ...(Object.prototype.hasOwnProperty.call(r,'localRebuildOrders')?{localRebuildOrders:restoreBuildingLocalRebuildOrders(r.localRebuildOrders,worldKey)}:{})
  };
}

export function serializeObserverSave(save: ObserverSave): string {
  return JSON.stringify({ version: 1, offsetMilliseconds: Math.round(save.offsetMilliseconds), speed: save.speed, weather: save.weather,
    entries: save.entries.slice(-CHRONICLE_ENTRY_LIMIT), memories: save.memories,
    raid: save.raid, raids: save.raids.slice(-RAID_HISTORY_LIMIT), raidSerial: save.raidSerial, lastRaidDay: save.lastRaidDay, realm: save.realm,
    ...(save.buildingDamage!==undefined?{buildingDamage:serializeBuildingDamageRestore(save.buildingDamage)}:{}),
    ...(save.raidCursor!==undefined?{raidCursor:serializeObserverRaidCursor(save.raidCursor)}:{}),
    ...(save.buildingFire!==undefined?{buildingFire:serializeBuildingConflagrationRestore(save.buildingFire)}:{}),
    ...(save.buildingEmergency!==undefined?{buildingEmergency:serializeVillagePopulationEmergencyCheckpointRestore(save.buildingEmergency)}:{}),
    ...(save.localRebuildOrders!==undefined?{localRebuildOrders:serializeBuildingLocalRebuildOrdersRestore(save.localRebuildOrders)}:{}) });
}

export function observerSaveKey(worldKey: string): string {
  return OBSERVER_SAVE_PREFIX + worldKey;
}

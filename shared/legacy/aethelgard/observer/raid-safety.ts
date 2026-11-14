/** The raid's authored bell/report informs observed lives. This adapter has no
 * renderer positions, canonical deaths, building damage or population writes. */
import type { VillagePopulation } from '../characters/village-population';
import type { ResidentSafetySignal } from '../characters/resident-safety';
import { createPopulationRaidRoster, raidPhase, raidResident, RAID_APPROACH_MINUTES, RAID_CLASH_MINUTES, type BanditRaid } from './bandit-raid';

export function observerRaidSafetySignals(raid: BanditRaid | null, minute: number, population: VillagePopulation): readonly ResidentSafetySignal[] {
  if (!raid || !Number.isFinite(minute)) return [];
  const phase = raidPhase(raid, minute)?.phase;
  if (phase !== 'approach' && phase !== 'clash') return [];
  const roster = createPopulationRaidRoster(population), id = `observer-${raid.id}`;
  if (id.length > 48) return [];
  const dayMinute = ((minute % 1440) + 1440) % 1440;
  const knownByResidentIds = population.residents.filter(resident => {
    const slot = resident.registry.routine.find(slot => slot.startMinute <= dayMinute && dayMinute < slot.endMinute);
    return !!slot && raidResident(raid, minute, { residentId: resident.id, activity: slot.activity, scheduledPlaceId: slot.placeId, slotIndex: 0 }, roster).alarm;
  }).map(resident => resident.id).sort();
  if (!knownByResidentIds.length) return [];
  return [{ id, kind: 'violence', channel: 'alarm', knownByResidentIds,
    // The road is an authored logical place. A visual farmstead index does not
    // establish which household owns it, so no family is invented as a victim.
    placeId: 'proposed-road-beyond', affectedResidentIds: [],
    observedAbsoluteMinute: Math.floor(raid.startMinute + raid.sightedMinutes),
    expiresAbsoluteMinute: Math.ceil(raid.startMinute + raid.sightedMinutes + RAID_APPROACH_MINUTES + RAID_CLASH_MINUTES) }];
}

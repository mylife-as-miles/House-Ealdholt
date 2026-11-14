import { EALDHOLT_VILLAGE_POPULATION } from '../characters/village-population';
import type { VillageResidentAvailability } from '../characters/village-resident-availability';

/** The complete registered roster supplies identity, labels and stable order. */
export const EALDHOLT_WATCH_RESIDENTS = EALDHOLT_VILLAGE_POPULATION.residents;

/** Camera following is available only for the adapter's qualified source point.
 * Selecting a held resident still follows their life in the ordinary panel. */
export function qualifiedResidentFollowPosition(value: VillageResidentAvailability | null): readonly [number, number, number] | null {
  return value?.body === 'qualified' ? value.position : null;
}

export function residentFollowAvailabilityText(value: VillageResidentAvailability | null): string | null {
  if (!value || value.body === 'pending') return 'Their figure is still being checked. Their day is followed here.';
  if (value.body === 'unknown') return 'This villager is not registered in this copy of the village.';
  if (!value.position) return 'Their figure is not placed in this copy of the village, so the view cannot go with them. Their day is still followed here.';
  if (value.body === 'held') return 'Their location is known, but their figure is unavailable for this activity. Their day is still followed here.';
  if (!value.bodyReady) return 'Their location is known. Their figure is still preparing.';
  if (value.renderFrame === null) return 'Their location is known. Their figure is not yet confirmed in the current view.';
  if (value.drawnFrame === null) return 'Their location is known. Their figure has not been drawn in the current frame.';
  return null;
}

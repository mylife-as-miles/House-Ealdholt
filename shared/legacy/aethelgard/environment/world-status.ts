import type { WorldEnvironmentState } from './world-environment-state';

/** Read-only presentation of the existing clock. Never advances a save. */
export type VillageWorldStatus = Pick<WorldEnvironmentState, 'hour' | 'minute' | 'dayIndex' | 'weather'>;
const WEATHER = { clear: 'Clear', overcast: 'Overcast', rain: 'Rain' } as const;
export function describeVillageWorld(status: VillageWorldStatus) {
  const time = `${String(status.hour).padStart(2, '0')}:${String(status.minute).padStart(2, '0')}`;
  const weather = WEATHER[status.weather];
  return { time, weather, compact: `${time} · ${weather}`, accessible: `Day ${status.dayIndex + 1}, ${time}, ${weather}` };
}

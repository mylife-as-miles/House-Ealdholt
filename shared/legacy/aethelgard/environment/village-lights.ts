import type { WorldEnvironmentState } from './world-environment-state';

/** A pure projection of the saved world clock, including paused/reloaded nights.
 * Weather alone never switches lamps on; reduced motion never suppresses them. */
export function villageNightLightStrength(state: Pick<WorldEnvironmentState, 'daylight'> | null): number {
  if (!state || !Number.isFinite(state.daylight)) return 0;
  const dusk = Math.max(0, Math.min(1, (.65 - state.daylight) / .5));
  return dusk * dusk * (3 - 2 * dusk);
}

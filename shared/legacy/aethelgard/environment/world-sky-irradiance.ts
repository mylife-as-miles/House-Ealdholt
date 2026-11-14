import { EALDHOLT_VILLAGE_DAYLIGHT } from './daylight';
import type { WorldEnvironmentState } from './world-environment-state';

/** Scene-linear sky fill, already attenuated by the calendar and cloud cover
 * in skyHorizon. Apply its authored energy once. The hemisphere and its existing
 * GI reader must not apply daylight a second time to this radiance. */
export function worldSkyIrradiance(state: Pick<WorldEnvironmentState, 'skyHorizon'>): [number, number, number] {
  const gain = EALDHOLT_VILLAGE_DAYLIGHT.hemisphereIntensity;
  return [state.skyHorizon[0] * gain, state.skyHorizon[1] * gain, state.skyHorizon[2] * gain];
}

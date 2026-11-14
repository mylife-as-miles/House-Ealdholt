import { EALDHOLT_NEUTRAL_HEMISPHERE_SKY_LINEAR } from './neutral-fill';

/** Authored daylight in the original village frame. This is a visual setup,
 * independent of campaign time, geographic survey data and saved world state. */
export const EALDHOLT_VILLAGE_DAYLIGHT = {
  sourceTarget: [25, 1, 25],
  sunOffset: [65, 109, 50],
  sunColor: '#fff0da',
  sunIntensity: 2.6,
  hemisphereSkyLinear: EALDHOLT_NEUTRAL_HEMISPHERE_SKY_LINEAR,
  hemisphereGround: '#514a37',
  hemisphereIntensity: .18,
} as const;

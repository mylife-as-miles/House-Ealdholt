/**
 * Whether a death is given to the ragdoll.
 *
 * This is the one place the ragdoll reads the settings. It stands in for the
 * shared decision in `death/deathStyle.ts` (which answers clip, fade, burn,
 * ragdoll or explode from the cause of death): when that lands, `knockDown()`
 * asks it instead and this file goes.
 */
import type { GoreIntensity } from "../../gore/GoreTypes";

export function ragdollWanted(intensity: GoreIntensity, reducedMotion: boolean): boolean {
  // Minimal keeps its short, clean death; reduced motion keeps the calmer hand-animated fall.
  return !reducedMotion && (intensity === "cinematic" || intensity === "full");
}

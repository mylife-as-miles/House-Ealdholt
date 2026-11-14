/**
 * Budgets: graphics preset times Violence Intensity. The two are independent
 * settings. Quality bounds cost; intensity chooses how much is shown. Neither
 * ever changes what a capture does on the board.
 *
 * Starting numbers from the creator's brief (desktop high: 30 to 80 droplets
 * per major hit, 2 to 5 ground marks per capture), to be reset by profiling.
 */
import type { QualityPreset } from "../quality";
import type { GoreIntensity } from "./GoreTypes";

export interface GoreBudget {
  /** Flying droplets for a blow of power 1 (scaled by power, never past `maxDroplets`). */
  droplets: number;
  maxDroplets: number;
  mist: number;
  /** New board stains per capture, the contact stain included. */
  stains: number;
  /** Largest stain radius, in squares. */
  stainRadius: number;
  /** Slow drops from the wound during the stagger and fall. */
  drips: number;
  wound: boolean;
  pool: boolean;
  /** False: the pool appears at its full size instead of spreading. */
  poolAnimated: boolean;
  /** Pool radius in squares for a blow of power 1. */
  poolRadius: number;
  /** A second, weaker pulse after the first spray. */
  spurt: boolean;
  weaponStain: "none" | "brief" | "lingering";
  /** The wound is projected onto the skinned body and bound to its skeleton (else a quad on the bone). */
  skinWound: boolean;
  /** Decals on the weapon and the attacker's armour per capture. Geometry is built per impact, so this stays small. */
  splashes: number;
}

/** GPU pool sizes. Fixed per preset: nothing grows during a match. */
export interface GoreCapacity {
  /** Instances in the droplet mesh: two overlapping captures at full intensity. */
  particles: number;
  /** Board marks (stains and pools) kept per match; past it the oldest fade. */
  decals: number;
  /** Wounds and weapon stains alive at once. */
  wounds: number;
}

const BASE: Readonly<Record<QualityPreset, GoreBudget>> = {
  low: { droplets: 8, maxDroplets: 12, mist: 0, stains: 2, stainRadius: 0.13, drips: 0, wound: true, pool: true, poolAnimated: false, poolRadius: 0.27, spurt: false, weaponStain: "brief", skinWound: false, splashes: 0 },
  medium: { droplets: 22, maxDroplets: 32, mist: 2, stains: 3, stainRadius: 0.15, drips: 2, wound: true, pool: true, poolAnimated: true, poolRadius: 0.3, spurt: false, weaponStain: "brief", skinWound: true, splashes: 2 },
  high: { droplets: 40, maxDroplets: 60, mist: 4, stains: 4, stainRadius: 0.16, drips: 3, wound: true, pool: true, poolAnimated: true, poolRadius: 0.33, spurt: false, weaponStain: "brief", skinWound: true, splashes: 3 },
  ultra: { droplets: 52, maxDroplets: 80, mist: 5, stains: 4, stainRadius: 0.17, drips: 4, wound: true, pool: true, poolAnimated: true, poolRadius: 0.34, spurt: false, weaponStain: "brief", skinWound: true, splashes: 3 },
};
const FULL_MIST: Readonly<Record<QualityPreset, number>> = { low: 0, medium: 4, high: 8, ultra: 10 };

export const GORE_CAPACITY: Readonly<Record<QualityPreset, GoreCapacity>> = {
  low: { particles: 48, decals: 24, wounds: 2 },
  medium: { particles: 128, decals: 48, wounds: 4 },
  high: { particles: 256, decals: 96, wounds: 6 },
  ultra: { particles: 320, decals: 160, wounds: 8 },
};

export function goreBudget(quality: QualityPreset, intensity: GoreIntensity): GoreBudget {
  const base = BASE[quality];
  if (intensity === "minimal") {
    return { ...base, droplets: 0, maxDroplets: 0, mist: 0, stains: 1, stainRadius: 0.07, drips: 0, wound: false, pool: false, spurt: false, weaponStain: "none", skinWound: false, splashes: 0 };
  }
  if (intensity === "cinematic") return { ...base };
  return {
    ...base,
    droplets: Math.round(base.droplets * 1.5),
    maxDroplets: Math.min(80, Math.round(base.maxDroplets * 1.5)),
    mist: FULL_MIST[quality],
    stains: Math.min(5, base.stains + 1),
    drips: base.drips + (quality === "low" ? 0 : 1),
    poolRadius: base.poolRadius * 1.25,
    spurt: quality !== "low",
    weaponStain: "lingering",
  };
}

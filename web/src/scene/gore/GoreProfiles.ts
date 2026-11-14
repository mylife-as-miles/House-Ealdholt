/**
 * Injury style by weapon. Milestone 01 authors the Pawn's spear: a small
 * puncture and a brief, narrow spray carried along the thrust. The other
 * weapons borrow its spray until their own milestone; since Milestone 03 each
 * opens its own kind of wound in the figure's mask (woundMaskPlan.ts): a
 * sword or an axe cuts, a mace, a staff or a fist crushes, a ball pierces.
 */
import type { GoreWeapon } from "./GoreTypes";
import { WEAPON_WOUND, type GoreWoundKind } from "./woundMaskPlan";

export interface GoreProfile {
  /** The wound it opens, unless its source names another (GoreEvent `wound`). */
  wound: GoreWoundKind;
  /** Cone axis weights: along the blow, out of the surface, and up. */
  along: number; out: number; up: number;
  /** Cone half-angle, radians. */
  spread: number;
  /** Launch speed range, world units per second, for a blow of power 1. */
  speed: readonly [number, number];
  /** Droplet radius range, in squares. */
  size: readonly [number, number];
  /** Wound radius in squares, for a blow of power 1. */
  woundSize: number;
  /** Multiplies the budget's pool radius. */
  pool: number;
}

const SPEAR: GoreProfile = {
  wound: "stab", along: 0.7, out: 0.15, up: 0.45, spread: 0.42,
  speed: [1.3, 3.4], size: [0.007, 0.02], woundSize: 0.06, pool: 1,
};

const borrowing = (weapon: GoreWeapon): GoreProfile => ({ ...SPEAR, wound: WEAPON_WOUND[weapon] });

export const GORE_PROFILES: Readonly<Record<GoreWeapon, GoreProfile>> = {
  spear: SPEAR, lance: borrowing("lance"), sword: borrowing("sword"), axe: borrowing("axe"), mace: borrowing("mace"),
  staff: borrowing("staff"), musket: borrowing("musket"), fist: borrowing("fist"),
};

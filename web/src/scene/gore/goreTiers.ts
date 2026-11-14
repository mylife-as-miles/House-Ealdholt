/**
 * The three gore tiers (the creator's design of 11 November 2026): how much of a kill is shown, decided by what kind of
 * moment it is, then capped by the Violence setting and scaled by the quality preset.
 *
 * | Tier | The moment | What it shows | Cost |
 * | --- | --- | --- | --- |
 * | 1 ordinary combat | every capture fight, and every soldier a summon brings | weapon cuts (wound masks), blood splashes, fabric damage, body reactions, persistent stains | low: built for a board, or a battlefield, full of fights |
 * | 2 severe wounds and executions | a heavy weapon's kill, the fall of a major piece (Knight, Bishop, Rook, Queen), anything a Queen casts or summons | tier 1, and detached limbs, exposed wound interiors, physical body reactions, blood trails, lingering effects | medium to high |
 * | 3 cinematic fatalities | rare and directed: a capture that gives mate, a Queen taking a Queen, a side's last piece beside its King | tier 2, and custom anatomy, close-up skeletal damage, internal views, detailed fluid blood, a directed sequence | the highest |
 *
 * Caps:
 * - Minimal shows no gore at all (tier 0).
 * - Cinematic allows tier 2's trails and lingering, but nothing is severed or opened and no fatality plays.
 * - Full allows all three.
 * - Reduced motion and capture cinematics turned off allow tier 1 at most: nothing thrown, no sequence.
 * - The flat map and the menu's background board show none (tier 0), as they show no death of their own.
 *
 * The quality preset scales each tier's budget ({@link goreBudget}); on Low a fatality plays without its fluid.
 * Kings are never captured: a King as the victim shows nothing.
 *
 * Every system that draws gore asks this one place ({@link goreShow}): the wound masks, the sprays and stains,
 * dismemberment, the opened wounds, the trails, the lingering, and the fatality director.
 *
 * Pure, no three.js: shared/play/gore-tiers.test.ts.
 */
import type { PieceKind } from "../../core/types";
import type { QualityPreset } from "../quality";
import type { GoreIntensity, GoreWeapon } from "./GoreTypes";

export type GoreTier = 0 | 1 | 2 | 3;

/** What kind of kill it is: who takes whom, and how. */
export interface KillMoment {
  attacker: PieceKind;
  victim: PieceKind;
  /** How the blow is dealt: steel, powder, a spell, or a Queen's summon. */
  style: "melee" | "gun" | "spell" | "summon";
  /** The weapon of a blow, where the gore system knows it (GoreTypes): a mace or an axe executes. */
  weapon?: GoreWeapon;
  /** The capture gives checkmate. */
  mate?: boolean;
  /** The victim is the last piece its side has beside its King. */
  last?: boolean;
}

export interface TierSettings {
  violence: GoreIntensity;
  reducedMotion: boolean;
  /** Whether capture fights are staged at all (the player's setting). */
  captureCinematics: boolean;
  /** The flat overhead map. */
  tactical?: boolean;
  /** The menu's background game, an attract loop, or any board that is not a real match. */
  menuBoard?: boolean;
}

/** Weapons whose killing blow is an execution. */
export const HEAVY_WEAPONS: readonly GoreWeapon[] = ["mace", "axe"];

/** The major pieces: their fall is an execution. */
const MAJOR: readonly PieceKind[] = ["n", "b", "r", "q"];

/** The tier the moment itself calls for, before any setting caps it. 0 only for a King, who is never taken. */
export function naturalTier(kill: KillMoment): GoreTier {
  if (kill.victim === "k") return 0;
  if (kill.mate || kill.last || (kill.attacker === "q" && kill.victim === "q")) return 3;
  if (MAJOR.includes(kill.victim) || kill.attacker === "q" || kill.style === "summon") return 2;
  if (kill.weapon && HEAVY_WEAPONS.includes(kill.weapon)) return 2;
  return 1;
}

/** The tier shown: the moment's, capped by the settings. */
export function goreTier(kill: KillMoment, settings: TierSettings): GoreTier {
  if (settings.tactical || settings.menuBoard || settings.violence === "minimal") return 0;
  const natural = naturalTier(kill);
  if (natural === 0) return 0;
  if (settings.reducedMotion || !settings.captureCinematics) return 1;
  if (settings.violence === "cinematic") return Math.min(natural, 2) as GoreTier;
  return natural;
}

/** How much of each tier a quality preset can afford. */
export interface GoreBudget {
  /** Side of a figure's wound mask, in texels (a power of two). */
  mask: number;
  /** Limbs that may be severed in one kill. */
  severs: number;
  /** Blood trails that may run at once from one body and what came off it. */
  trails: number;
  /** Particles of a fatality's fluid blood (0: none, the plain sprays stand in). */
  fluid: number;
}

const BUDGETS: Readonly<Record<Exclude<GoreTier, 0>, Readonly<Record<QualityPreset, GoreBudget>>>> = {
  1: {
    low: { mask: 64, severs: 0, trails: 0, fluid: 0 },
    medium: { mask: 64, severs: 0, trails: 0, fluid: 0 },
    high: { mask: 128, severs: 0, trails: 0, fluid: 0 },
    ultra: { mask: 128, severs: 0, trails: 0, fluid: 0 },
  },
  2: {
    low: { mask: 64, severs: 1, trails: 1, fluid: 0 },
    medium: { mask: 128, severs: 1, trails: 2, fluid: 0 },
    high: { mask: 128, severs: 1, trails: 3, fluid: 0 },
    ultra: { mask: 256, severs: 2, trails: 4, fluid: 0 },
  },
  3: {
    low: { mask: 128, severs: 1, trails: 2, fluid: 0 },
    medium: { mask: 256, severs: 2, trails: 3, fluid: 4096 },
    high: { mask: 256, severs: 2, trails: 4, fluid: 8192 },
    ultra: { mask: 256, severs: 3, trails: 6, fluid: 16384 },
  },
};

const NONE: GoreBudget = { mask: 0, severs: 0, trails: 0, fluid: 0 };

/** A tier's budget on a quality preset. Tier 0 affords nothing. */
export function goreBudget(tier: GoreTier, quality: QualityPreset): GoreBudget {
  return tier === 0 ? NONE : BUDGETS[tier][quality];
}

/** What one kill shows, system by system, and what it may spend. */
export interface GoreShow {
  tier: GoreTier;
  /** Tier 1. Weapon cuts on the body (the wound masks), blood splashes, stains that stay, and cloth torn where the body is. */
  cuts: boolean;
  splash: boolean;
  stains: boolean;
  fabric: boolean;
  /** Tier 2. Blood trails off the body and what came off it, and what lingers after (drips, spreading pools). */
  trails: boolean;
  linger: boolean;
  /** Tier 2 at Full. Limbs come away, and wounds open to what is inside. */
  sever: boolean;
  interiors: boolean;
  /** Tier 3. A directed sequence with the anatomy inside, close-up skeletal damage and internal views; fluid blood where the preset affords it. */
  fatality: boolean;
  fluid: boolean;
  budget: GoreBudget;
}

/** Everything one kill shows, for every system that draws gore to ask. */
export function goreShow(kill: KillMoment, settings: TierSettings, quality: QualityPreset): GoreShow {
  const tier = goreTier(kill, settings);
  const full = settings.violence === "full";
  const budget = goreBudget(tier, quality);
  const severe = tier >= 2;
  return {
    tier,
    cuts: tier >= 1, splash: tier >= 1, stains: tier >= 1, fabric: tier >= 1,
    trails: severe, linger: severe,
    sever: severe && full && budget.severs > 0, interiors: severe && full,
    fatality: tier === 3, fluid: tier === 3 && budget.fluid > 0,
    budget,
  };
}

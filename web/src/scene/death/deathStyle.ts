/**
 * How a captured piece dies: one decision, made once per kill, from what killed it and the Violence setting.
 *
 * The creator's table:
 *
 * | Violence  | fire kill (spell, field gun)                    | any other kill (steel, musket ball) |
 * |-----------|--------------------------------------------------|-------------------------------------|
 * | Minimal   | `fade`: a short flash and the body fades         | `clip`: the authored death          |
 * | Cinematic | `burn`: the body burns                           | `ragdoll`, else `clip`              |
 * | Full      | `explode` for the biggest blasts, else `burn`    | `ragdoll`, else `clip`              |
 *
 * A fire kill is a kill that leaves a burn mark on the stone (vfx/scorchPlan.ts): every spell but one that runs the
 * piece through (vfx/spells/spell.ts SpellDeath `pierce`, a cold spell's blades), and the field
 * gun. A musket ball, a pistol ball, a rifle bullet and steel leave none and are not fire. The biggest
 * blasts are the field gun and the Queen's spell. `ragdoll` and `explode` need the physics deaths
 * (death/physics); without them the kill falls back to `burn` or `clip`, and so it does under reduced motion,
 * which never throws a body about. The flat tactical map and the menu's background board show no death
 * presentation of their own: they keep `clip`.
 *
 * Kings are never captured and never reach this. No Three.js in here, so the node tests reach it
 * (shared/play/death-style.test.ts).
 */
import type { PieceKind } from "../../core/types";
import type { GoreIntensity } from "../gore/GoreTypes";

/** What dealt the killing blow. */
export type DeathSource = "melee" | "musket" | "fieldGun" | "spell";

export interface DeathCause {
  source: DeathSource;
  /** The rank that dealt it: the Queen's spell is a bigger blast than the Bishop's. */
  by: PieceKind;
}

export type DeathStyle = "clip" | "fade" | "burn" | "ragdoll" | "explode";
export const DEATH_STYLES: readonly DeathStyle[] = ["clip", "fade", "burn", "ragdoll", "explode"];

export interface DeathSettings {
  /** The Violence setting. */
  intensity: GoreIntensity;
  reducedMotion: boolean;
  /** Whether the physics deaths (ragdoll, exploding body) are loaded and allowed. */
  physics: boolean;
  /** The flat overhead map: figures are counters, nothing burns. */
  tactical?: boolean;
  /** The menu's background game. */
  menuBoard?: boolean;
}

/** How a rank's attack kills, as the scene stages it: `wave` is the field gun's mark on the stone. */
export function deathCause(style: "melee" | "spell" | "gun", by: PieceKind, fieldGun = false): DeathCause {
  return { source: style === "spell" ? "spell" : style === "gun" ? (fieldGun ? "fieldGun" : "musket") : "melee", by };
}

/** A kill that leaves a burn mark: a spell or the field gun. */
export function isFireKill(cause: DeathCause): boolean {
  return cause.source === "spell" || cause.source === "fieldGun";
}

/** The blasts big enough to take a body apart: the field gun and the Queen's spell. */
export function isBigBlast(cause: DeathCause): boolean {
  return cause.source === "fieldGun" || (cause.source === "spell" && cause.by === "q");
}

export function deathStyle(cause: DeathCause, settings: DeathSettings): DeathStyle {
  if (settings.tactical || settings.menuBoard) return "clip";
  const physics = settings.physics && !settings.reducedMotion;
  if (isFireKill(cause)) {
    if (settings.intensity === "minimal") return "fade";
    if (settings.intensity === "full" && physics && isBigBlast(cause)) return "explode";
    return "burn";
  }
  if (settings.intensity === "minimal") return "clip";
  return physics ? "ragdoll" : "clip";
}

/** Whether this build presents a style itself. `ragdoll` and `explode` belong to death/physics. */
export function burnsOrFades(style: DeathStyle): style is "burn" | "fade" {
  return style === "burn" || style === "fade";
}

/** How a Queen's summon kills (rites/rite.ts RiteDeath). */
export type RiteDeathKind = "held" | "held-burn" | "burn" | "burst" | "thrown";

/**
 * The Violence setting's form of a summon's kill. `held` (limp in the rite's grip, carried) stays itself except
 * where nothing may be carried: under reduced motion, on the map and on the menu's board it is the authored
 * death. `held-burn` (carried and set alight in the grip) is carried burning at Cinematic and Full and carried
 * unburnt at Minimal; where nothing may be carried it is the Queen's fire kill where the piece stands. A burning is
 * a fire kill by the Queen. A tearing apart bursts the body at Full, throws it down at
 * Cinematic, and is the authored death at Minimal. A throw is steel.
 */
export function riteDeathStyle(kind: RiteDeathKind, settings: DeathSettings): DeathStyle | "held" | "held-burn" {
  if (settings.tactical || settings.menuBoard) return "clip";
  if (kind === "held") return settings.reducedMotion ? "clip" : "held";
  if (kind === "held-burn") {
    if (settings.reducedMotion) return deathStyle({ source: "spell", by: "q" }, settings);
    return settings.intensity === "minimal" ? "held" : "held-burn";
  }
  if (kind === "burn") return deathStyle({ source: "spell", by: "q" }, settings);
  if (kind === "burst") {
    const physics = settings.physics && !settings.reducedMotion;
    if (settings.intensity === "minimal" || !physics) return "clip";
    return settings.intensity === "full" ? "explode" : "ragdoll";
  }
  return deathStyle({ source: "melee", by: "q" }, settings);
}

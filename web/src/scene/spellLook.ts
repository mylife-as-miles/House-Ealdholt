/**
 * How each army's magic burns: the colours of the ball of fire a caster
 * gathers and throws (spells.ts draws it), by the caster's army.
 *
 * Plain data with no Three.js, so the node tests reach it
 * (shared/play/spell-look.test.ts). The burst the ball breaks into is chosen
 * and tinted by the same army in vfx/wiring.ts (`SPELL_BURST`,
 * `SPELL_BURST_COLOUR`); the two are checked against each other there.
 */
import type { Faction } from "../core/types";
import type { VfxArmy } from "./vfx/wiring";

/** How one civilisation's magic burns. */
export interface SpellLook {
  /** The hot centre of the ball. */
  core: number;
  /** The envelope around it; also the ring a sorceress's blast rolls across the stone. */
  flame: number;
  /** Motes shed while it gathers, flies and breaks. */
  ember: number;
  /** Colour it throws into the room, and into the square it strikes. */
  light: number;
  /** What the bolt leaves hanging on the air behind it and over the body. */
  smoke: number;
}

/**
 * The look of a spell, by the caster's army. Never by its side of the board:
 * Solforiz throws the same sun as White that it throws as Black.
 *
 * - Solforiz (`sun`): a small sun. A gold core inside a red-orange envelope, so the ball reads gold to orange
 *   at its heart and red-orange at its edge.
 * - Aethelgard (`ivory`): cold witchfire off a crystal staff, pale cyan-white.
 * - Kwind-09 (`kwind`): an arc discharge, electric blue-violet.
 * - Korvenia (`empire`): arcane violet. Nobody in that army casts today (its Queen and Bishop fire powder);
 *   the entry is here so a Korvenian caster has a look the day one exists.
 */
export const SPELL_LOOK: Readonly<Record<VfxArmy, SpellLook>> = {
  sun: { core: 0xffd772, flame: 0xff4a14, ember: 0xff8a2c, light: 0xff7a2a, smoke: 0x8a7d6e },
  ivory: { core: 0xf2feff, flame: 0x7fe6ff, ember: 0xc8f6ff, light: 0x9be8ff, smoke: 0x9fb2ba },
  kwind: { core: 0xe6e0ff, flame: 0x6b40ff, ember: 0x9d8cff, light: 0x7a5cff, smoke: 0x6f6a8c },
  empire: { core: 0xf3dcff, flame: 0xb43cff, ember: 0xd08cff, light: 0xb860ff, smoke: 0x7a688c },
};

/** The spell look of whichever army is playing `side`. */
export function spellLookFor(armies: Readonly<Record<Faction, VfxArmy>>, side: Faction): SpellLook {
  return SPELL_LOOK[armies[side]];
}

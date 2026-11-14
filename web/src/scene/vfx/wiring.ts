/**
 * Which flipbook effect a moment of a capture gets, and how much of it.
 *
 * sceneEngine.ts asks {@link vfxCue} at each moment (a body landing, a foot
 * going down, a musket firing, a spell landing, the floor taking a blow) and
 * plays what comes back through its one FlipbookSystem. Everything that
 * decides whether smoke or dust appears is here, as plain data and arithmetic
 * with no Three.js, so the node tests reach it (shared/play/vfx-wiring.test.ts).
 *
 * The rules, in the order they are applied:
 *  - the tactical map shows nothing;
 *  - reduced motion shows nothing that moves: a body landing and a floor slam
 *    keep one still puff (a held frame that fades in and out), the rest is off;
 *  - the menu's background board keeps smoke and dust but less of it, and no
 *    step dust, mist or powder blast;
 *  - the low preset plays fewer sprites, smaller, and no step dust or mist;
 *  - Violence Intensity is not consulted: none of this is blood.
 */
import type { QualityPreset } from "../quality";
import { FLIPBOOK_BUDGET, type FlipbookBudget } from "./flipbookCore";
import { DUST_SHADE, STEP_DUST_SHADE, VFX_RECIPES, type VfxEffectId, type VfxRecipeId, type VfxStone } from "./library";

/** The four armies, as `ArmySkinId` in assets/generated.ts names them. */
export type VfxArmy = "ivory" | "sun" | "empire" | "kwind";

export type VfxMoment =
  /** A body reaching the stone. */
  | "fall"
  /** A foot set down in a directed duel: a step, a dodge, the hop back off a bash. */
  | "step"
  /** Shield meeting shield: the feet under it. */
  | "bash"
  /** A powder weapon firing, at the muzzle. */
  | "musket"
  /** A spell breaking on its target. */
  | "spell"
  /** Mist round a caster's feet while the spell is gathered. */
  | "mist"
  /** A blow that carries into the floor (the ground wave). */
  | "slam";

export interface VfxFlags {
  quality: QualityPreset;
  reducedMotion: boolean;
  tactical: boolean;
  /** The menu's background board (attract mode, the title tableau). */
  menuBoard: boolean;
}

export interface VfxDetail {
  /** The army of the figure the effect belongs to: the caster for a spell or mist. */
  army?: VfxArmy;
  /** How hard: a strike's power, a gun's calibre, a spell's blast, a dust cue's strength. About 0 to 1.6. */
  power?: number;
  /** What sent the wave through the floor. */
  source?: "melee" | "gun";
  /** How long the moment lasts (the gather a mist curls through). */
  seconds?: number;
}

export interface VfxCue {
  recipe: VfxRecipeId;
  /** Multiplies the recipe's sizes. */
  scale: number;
  /** Multiplies the recipe's alphas. */
  alpha: number;
  /** How many of the recipe's sprites play, from the first. */
  parts: number;
  /** A held frame with no drift, growth or spin (reduced motion). */
  still: boolean;
  /** Seconds the sprites live; 0 leaves the recipe's own. */
  life: number;
  /** Recolours every sprite of the recipe (a spell burst in its army's colour); null leaves the recipe's tints. */
  colour: VfxTint | null;
}

/** Linear red, green and blue. */
export type VfxTint = readonly [number, number, number];

/**
 * The burst a spell breaks into, by the caster's army.
 *
 * - Solforiz (`sun`) throws a piece of the sun: fire.
 * - Aethelgard (`ivory`) burns cold, "witchfire off a crystal staff" (spellLook.ts): arcane, tinted pale cyan.
 * - Kwind-09 (`kwind`) is arc-tech under sodium lamps: its discharge is the arcane burst in blue-violet.
 * - Korvenia (`empire`) is arcane by the creator's theme.
 *
 * Only the plain bolt bursts like this. Every army's casters now draw from a page of built library spells
 * (spells/spellbook.ts), and a library spell draws its own blow, so no match plays these today.
 */
export const SPELL_BURST: Readonly<Record<VfxArmy, "spellBurst" | "arcaneBurst">> = {
  sun: "spellBurst",
  ivory: "arcaneBurst",
  kwind: "arcaneBurst",
  empire: "arcaneBurst",
};

/**
 * The colour of each army's burst, in linear light with its strongest channel at 1: the same colour as the
 * orb that broke (spellLook.ts). Null keeps the recipe's own colours: Solforiz's burst is real fire, and the
 * flame frames are already the gold, orange and red of its sun.
 *
 * The arcane recipe is three additive layers reduced to brightness, so its colour is whatever it is given.
 * Each layer takes this colour at its own brightness (`VfxPlayOptions.colour`), so the whole burst is one
 * hue from its edge to its core. The recipe's own violet-blue stacked to a lavender-white heart whichever
 * army threw it; here the weak channels are held down so the core stays a colour (see {@link burstCore})
 * even in a dark arena, where a burst is drawn up to {@link VFX_GLOW_EXPOSURE} times as bright.
 *
 * - Aethelgard: pale cyan witchfire.
 * - Kwind-09: electric blue-violet.
 * - Korvenia: arcane violet.
 *
 * A spell's burning body takes the same colour (death/burn/burnPlan.ts), and that is where it is seen today.
 */
export const SPELL_BURST_COLOUR: Readonly<Record<VfxArmy, VfxTint | null>> = {
  sun: null,
  ivory: [0.3, 0.82, 1],
  kwind: [0.22, 0.1, 1],
  empire: [0.5, 0.12, 1],
};

/**
 * A recipe's colour where all its layers stack (its core), in linear light: each layer's tint by its alpha,
 * summed. With a `colour`, each layer is that colour at the brightness of its own tint, as the renderer
 * draws it. A channel past about 1.3 clips to white.
 */
export function burstCore(recipe: VfxRecipeId, colour: VfxTint | null = null): [number, number, number] {
  const sum: [number, number, number] = [0, 0, 0];
  for (const part of VFX_RECIPES[recipe]) {
    const bright = Math.max(...part.tint), alpha = part.alpha ?? 1;
    for (let c = 0; c < 3; c++) sum[c] += (colour ? colour[c] * bright : part.tint[c]) * alpha;
  }
  return sum;
}

/** The army whose casters stand in dark mist while they gather. */
export const MIST_ARMY: VfxArmy = "sun";

/**
 * How much of the older procedural smoke (effects.ts sprite lobes) is still drawn at a moment the flipbook
 * also covers. The flash, sparks and embers are never thinned.
 */
export const PROCEDURAL_SHARE = 0.4;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const SCRATCH: VfxCue = { recipe: "fallDust", scale: 1, alpha: 1, parts: 1, still: false, life: 0, colour: null };

/**
 * What to play at `moment`, or null for nothing. The result is written into `out` (one shared object by
 * default), so asking allocates nothing: read it before the next call.
 */
export function vfxCue(moment: VfxMoment, flags: VfxFlags, detail: VfxDetail = {}, out: VfxCue = SCRATCH): VfxCue | null {
  if (flags.tactical) return null;
  const low = flags.quality === "low";
  const power = detail.power ?? 1;
  out.scale = 1; out.alpha = 1; out.still = false; out.life = 0; out.colour = null;

  switch (moment) {
    case "fall":
      out.recipe = "fallDust";
      break;
    case "step":
      if (low || flags.menuBoard || flags.reducedMotion) return null;
      out.recipe = "stepDust";
      out.scale = clamp(0.75 + 0.45 * power, 0.75, 1.3);
      break;
    case "bash":
      if (low || flags.menuBoard || flags.reducedMotion) return null;
      out.recipe = "stepDust";
      out.scale = 1.15; out.alpha = 1.15;
      break;
    case "musket":
      if (flags.reducedMotion) return null;
      out.recipe = "musketSmoke";
      // A pistol lock to a field gun: calibre runs from under 0.1 to 1.
      out.scale = clamp(0.5 + 0.7 * power, 0.5, 1.3);
      break;
    case "spell":
      if (flags.reducedMotion || !detail.army) return null;
      out.recipe = SPELL_BURST[detail.army];
      out.colour = SPELL_BURST_COLOUR[detail.army];
      out.scale = clamp(0.75 + 0.3 * power, 0.8, 1.3);
      break;
    case "mist":
      if (low || flags.menuBoard || flags.reducedMotion || detail.army !== MIST_ARMY) return null;
      out.recipe = "solforizMist";
      // Round the feet, not the figure: the recipe is sized for a standing pyre.
      out.scale = 0.42; out.alpha = 0.6;
      out.life = clamp((detail.seconds ?? 1) + 0.6, 1, 3);
      break;
    case "slam":
      if (detail.source === "gun" && !flags.menuBoard && !flags.reducedMotion) {
        out.recipe = "blast";
        out.scale = clamp(0.5 + 0.25 * power, 0.55, 0.95);
        // The soot column is cut short: the shooter is about to walk through it.
        out.life = 1.3;
      } else {
        out.recipe = "fallDust";
        out.scale = clamp(0.9 + 0.4 * power, 1, 1.7);
        out.alpha = 1.15;
      }
      break;
  }

  out.parts = VFX_RECIPES[out.recipe].length;
  if (flags.reducedMotion) {
    // Only "fall" and "slam" reach here: one puff, held still.
    out.still = true; out.parts = 1; out.alpha *= 0.8; out.life = 0;
  }
  // A burst keeps its body and loses its last flare; everything else is down to its first sprite.
  const fewer = moment === "spell" ? Math.max(1, VFX_RECIPES[out.recipe].length - 1) : 1;
  if (flags.menuBoard) { out.scale *= 0.8; out.alpha *= 0.6; out.parts = Math.min(out.parts, fewer); }
  if (low) { out.scale *= 0.85; out.parts = Math.min(out.parts, fewer); }
  return out;
}

/**
 * Which stone a point on the board lies on: the colour of its square, a1 dark as on any board (board.ts
 * `isLightSquare`; the scorch shader tells the squares apart by the same arithmetic). Null off the board.
 */
export function stoneUnder(x: number, z: number, tile: number): VfxStone | null {
  const file = Math.round(x / tile + 3.5), rank = Math.round(3.5 - z / tile);
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return (file + rank) % 2 === 1 ? "light" : "dark";
}

/**
 * The shade a recipe takes from the stone under it, multiplying its tint (library.ts `DUST_SHADE`, and
 * `STEP_DUST_SHADE` for a footfall's puff): fall and step dust only. Null for anything else, and for dust off the
 * board, which keeps its recipe's cream.
 */
export function dustShade(recipe: VfxRecipeId, stone: VfxStone | null): VfxTint | null {
  if (!stone) return null;
  return recipe === "stepDust" ? STEP_DUST_SHADE[stone] : recipe === "fallDust" ? DUST_SHADE[stone] : null;
}

/** How many sprite slots of each atlas a cue takes: what a budget is checked against. */
export function vfxCost(cue: VfxCue | null, into: Partial<Record<VfxEffectId, number>> = {}): Partial<Record<VfxEffectId, number>> {
  if (!cue) return into;
  const parts = VFX_RECIPES[cue.recipe];
  for (let i = 0; i < Math.min(cue.parts, parts.length); i++) into[parts[i].effect] = (into[parts[i].effect] ?? 0) + 1;
  return into;
}

/** The budget a preset gives the scene's FlipbookSystem. */
export function vfxBudget(quality: QualityPreset): FlipbookBudget {
  return FLIPBOOK_BUDGET[quality];
}

export interface Point3 { x: number; y: number; z: number }

/**
 * Whether a sprite spawned at `spawn` (its foot: the visible puff stands above it) would lie between the
 * eye and `contact`, the point a killing blow enters. The duel camera closes in on that point, so a puff
 * of dust in front of it hides the kill.
 *
 * `size` is the sprite's width in world units; the puff is treated as a ball of half that, centred a
 * third of the size above the spawn point.
 */
export function hidesContact(eye: Point3, contact: Point3, spawn: Point3, size: number): boolean {
  const radius = size * 0.5;
  const cx = contact.x - eye.x, cy = contact.y - eye.y, cz = contact.z - eye.z;
  const length2 = cx * cx + cy * cy + cz * cz;
  if (length2 < 1e-9) return false;
  const px = spawn.x - eye.x, py = spawn.y + size / 3 - eye.y, pz = spawn.z - eye.z;
  // How far along the sight line the puff sits: behind the eye or past the contact (plus its own radius) is clear.
  const along = (px * cx + py * cy + pz * cz) / length2;
  if (along <= 0 || along >= 1 + radius / Math.sqrt(length2)) return false;
  const t = Math.min(1, along);
  const dx = px - cx * t, dy = py - cy * t, dz = pz - cz * t;
  return dx * dx + dy * dy + dz * dz < radius * radius;
}

/**
 * Moves a ground point `distance` along the floor directly away from the eye (towards it when negative),
 * in place. Dust is seated behind the figure it belongs to: the body stands whole in front of it instead of
 * the sprite's plane slicing through the body, and the sprite cannot cover a wound. A spell burst is
 * seated in front, so the fire is whole.
 */
export function seatFromEye<T extends Point3>(point: T, eye: Point3, distance: number): T {
  const dx = point.x - eye.x, dz = point.z - eye.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return point;
  point.x += dx / length * distance;
  point.z += dz / length * distance;
  return point;
}

/**
 * How bright the scene's light makes smoke and dust, from the renderer's exposure. The atlases were lit by a
 * white sky at exposure 1. A dark arena is drawn with its exposure pushed up (the baked battlefields run at
 * about 5), and a sprite left at full white there is several times brighter than the stone it rises from: it
 * reads as a cut-out, not as dust. This brings it back to the stone's level, and never above the baked look.
 * The near-black mist is brought down with the rest: left alone it shows as a pale violet glow, not as dark mist.
 */
export function vfxLight(exposure: number, moment?: VfxMoment): number {
  const light = exposure > 0 ? clamp(VFX_LIGHT_EXPOSURE / exposure, 0.22, 1) : 1;
  // Powder smoke is the one white thing on the board: it keeps more of its brightness than stone dust does.
  return moment === "musket" ? Math.pow(light, 0.75) : light;
}

/**
 * The same for sprites that are light themselves (the fire of a burst): exposure multiplies them too, and at 5
 * a flame's core clips to white. They are held a little brighter than lit smoke would be, so fire still glows.
 */
export function vfxGlow(exposure: number): number {
  return exposure > 0 ? clamp(VFX_GLOW_EXPOSURE / exposure, 0.22, 1) : 1;
}
/** The exposure at which fire is drawn as baked. */
export const VFX_GLOW_EXPOSURE = 1.75;
/** The exposure at which smoke and dust are drawn as baked. */
export const VFX_LIGHT_EXPOSURE = 2.5;

/** Seconds between two step puffs from one figure: a shuffle of both feet is one puff, not a trail. */
export const STEP_DUST_GAP = 0.16;

/**
 * The flipbook atlases Crownfall ships and the recipes that combine them.
 *
 * Fire, flare and explosion are baked from JangaFX's CC0 EmberGen simulations. Dust, the scuff, powder
 * smoke and the ground mist are Crownfall's own Mantaflow simulations (scripts/vfx/sim_gas.py). Sources,
 * hashes, presets and render settings are in `main game/public/assets/play/vfx/manifest.json`
 * and docs/play/VFX_LIBRARY.md. {@link VFX_ATLASES} must agree with that
 * manifest (shared/play/vfx-flipbook.test.ts checks it).
 *
 * No Three.js in here: sizes are in world units (a board square is 1.02).
 */
import type { FlipbookClip, FlipbookTier } from "./flipbookCore";

export type VfxEffectId = "fire" | "smoke" | "flare" | "explosion" | "dust" | "scuff" | "smokePuff";

export interface VfxAtlas extends FlipbookClip {
  id: VfxEffectId;
  cols: number;
  rows: number;
  /** Where the spawn point sits in a cell: u from the left, v up from the bottom. */
  pivot: readonly [number, number];
  /** Default blend: 0 composites as smoke, 1 adds as light. */
  additive: number;
  /** File per tier, relative to the atlas folder. */
  files: Readonly<Record<FlipbookTier, string>>;
  /** Draw order among transparent objects: light-emitting layers after the smoke they sit in. */
  renderOrder: number;
}

export const VFX_ATLASES: Readonly<Record<VfxEffectId, VfxAtlas>> = {
  /** A standing campfire flame. Loops. Emissive: no smoke baked in. */
  fire: { id: "fire", frames: 64, cols: 8, rows: 8, fps: 24, loop: true, pivot: [0.5, 0.0596], additive: 1, files: { desktop: "fire-256.webp", quest: "fire-128.webp" }, renderOrder: 12 },
  /** A low ground mist creeping outward, densest at the floor, lit white so a tint decides its colour. Loops. */
  smoke: { id: "smoke", frames: 40, cols: 8, rows: 5, fps: 12, loop: true, pivot: [0.5, 0.0216], additive: 0, files: { desktop: "smoke-256.webp", quest: "smoke-128.webp" }, renderOrder: 10 },
  /** A gout of flame that erupts from the ground and tears apart as it rises. One-shot, emissive. */
  flare: { id: "flare", frames: 48, cols: 8, rows: 6, fps: 30, loop: false, pivot: [0.5, 0.0625], additive: 1, files: { desktop: "flare-256.webp", quest: "flare-128.webp" }, renderOrder: 12 },
  /** A ground explosion: flash, fireball, then a sooty column. One-shot. */
  explosion: { id: "explosion", frames: 48, cols: 8, rows: 6, fps: 24, loop: false, pivot: [0.5, 0.0448], additive: 0.35, files: { desktop: "explosion-256.webp", quest: "explosion-128.webp" }, renderOrder: 11 },
  /** A thin sheet of fine dust thrown out along the floor from an impact, which curls at its rim and thins. One-shot. */
  dust: { id: "dust", frames: 32, cols: 8, rows: 4, fps: 24, loop: false, pivot: [0.5, 0.0212], additive: 0, files: { desktop: "dust-256.webp", quest: "dust-128.webp" }, renderOrder: 10 },
  /** A foot's scuff: one small low smear of dust. One-shot. */
  scuff: { id: "scuff", frames: 16, cols: 8, rows: 2, fps: 30, loop: false, pivot: [0.5, 0.0231], additive: 0, files: { desktop: "scuff-256.webp", quest: "scuff-128.webp" }, renderOrder: 10 },
  /**
   * A powder discharge seen down the line of the shot: a jet that blooms and rolls, then hangs as haze.
   * One-shot. The pivot is the muzzle, in the middle of the cell.
   */
  smokePuff: { id: "smokePuff", frames: 48, cols: 8, rows: 6, fps: 13, loop: false, pivot: [0.5, 0.5], additive: 0, files: { desktop: "smokePuff-256.webp", quest: "smokePuff-128.webp" }, renderOrder: 10 },
};

/** One sprite of a recipe. Lengths are in world units and scale with the caller's `scale`. */
export interface VfxPart {
  effect: VfxEffectId;
  /** World units across the whole cell. */
  size: number;
  /** Linear RGB multiplied into the frame. Values above 1 feed bloom. */
  tint: readonly [number, number, number];
  alpha?: number;
  additive?: number;
  delay?: number;
  fps?: number;
  life?: number;
  frameOffset?: number;
  /** Raise the spawn point. */
  lift?: number;
  /** Upward drift in units per second. */
  rise?: number;
  /** Drift along the caller's direction, in units per second. */
  push?: number;
  growth?: number;
  rotation?: number;
  spin?: number;
  flip?: boolean;
  fadeIn?: number;
  fadeOut?: number;
  /** Distance over which the sprite fades into the board. */
  soft?: number;
  /** 1 reduces the frame to brightness before tinting (recolouring fire). */
  mono?: number;
}

export type VfxRecipeId =
  | "musketSmoke"
  | "solforizFire"
  | "solforizMist"
  | "spellBurst"
  | "arcaneBurst"
  | "blast"
  | "fallDust"
  | "stepDust";

/**
 * Starting looks for the moments the game needs. They are data, so the duel
 * builder can retune them without touching the renderer. Looping recipes
 * (fire, mist) run until `FlipbookSystem.release`.
 */
export const VFX_RECIPES: Readonly<Record<VfxRecipeId, readonly VfxPart[]>> = {
  /**
   * Korvenia's riflemen: powder smoke thrown down the line of the shot, which then hangs. Pass the barrel
   * direction. The atlas is the discharge seen end on, so it is right for a shot in any direction; the three
   * sprites travel at different speeds, which draws the jet out along the barrel. The first is the body and
   * the haze that lingers (the only one the low preset and the menu board play).
   */
  musketSmoke: [
    { effect: "smokePuff", size: 1.45, tint: [0.84, 0.84, 0.82], alpha: 0.6, fps: 13, push: 0.3, rise: 0.05, growth: 0.16, fadeIn: 0.04, fadeOut: 1.6, soft: 0.14 },
    // The front of the jet: small, fast, gone in a second.
    { effect: "smokePuff", size: 0.8, tint: [0.9, 0.88, 0.85], alpha: 0.55, fps: 30, life: 1.1, push: 1.5, growth: 0.9, flip: true, fadeOut: 0.6, soft: 0.04 },
    { effect: "smokePuff", size: 1.05, tint: [0.86, 0.85, 0.82], alpha: 0.45, fps: 20, life: 2.0, push: 0.8, rise: 0.04, growth: 0.4, rotation: 2.1, fadeOut: 1.0, soft: 0.12 },
  ],
  /** Solforiz fire: a looping flame with a second, redder one behind it for body. */
  solforizFire: [
    { effect: "fire", size: 2.3, tint: [0.95, 0.85, 0.75], fadeIn: 0.25, soft: 0.06 },
    { effect: "fire", size: 1.8, tint: [1.0, 0.55, 0.35], alpha: 0.8, frameOffset: 23, flip: true, fps: 20, fadeIn: 0.25, soft: 0.06 },
  ],
  /**
   * Solforiz dark mist: the ground mist tinted near-black with a violet cast, three layers at different
   * rates, the widest creeping outward. Alpha-blended, never added: it darkens what it lies over. The tints
   * are far below the stone's own brightness on purpose: in a dark arena drawn at exposure 5 anything
   * brighter than about 0.03 comes out paler than the floor and reads as a violet glow. Loops.
   */
  solforizMist: [
    // The board fade is long for so low an effect, on purpose: it feathers the line where the card meets the
    // stone, which from the high match camera is otherwise a ruled edge under a flat band.
    { effect: "smoke", size: 4.4, tint: [0.012, 0.008, 0.02], alpha: 1.1, fps: 12, growth: 0.06, fadeIn: 0.5, fadeOut: 0.6, soft: 0.09 },
    { effect: "smoke", size: 3.6, tint: [0.02, 0.012, 0.034], alpha: 0.9, fps: 9, frameOffset: 17, flip: true, fadeIn: 0.5, fadeOut: 0.6, soft: 0.07 },
    { effect: "smoke", size: 5.4, tint: [0.008, 0.005, 0.014], alpha: 0.8, fps: 7, frameOffset: 29, growth: 0.12, fadeIn: 0.7, fadeOut: 0.6, soft: 0.1 },
  ],
  /** A fiery spell capture: the blast's fireball, played fast and small, with a gout of flame through it. */
  spellBurst: [
    { effect: "explosion", size: 1.7, tint: [0.95, 0.9, 0.85], additive: 0.6, fps: 40, life: 0.95, fadeOut: 0.35, soft: 0.12 },
    { effect: "flare", size: 1.5, tint: [0.9, 0.8, 0.7], delay: 0.05, fps: 40, fadeOut: 0.2, soft: 0.08 },
  ],
  /**
   * An arcane capture: the same frames reduced to brightness, added as pure light and tinted violet-blue.
   * Three additive layers stack in the core, so no channel's sum may pass about 1.3 there or it clips to
   * white: blue carries it (0.95 * 0.32 + 0.95 * 0.44 + 0.9 * 0.4 = 1.08) and red and green stay under 0.45.
   */
  arcaneBurst: [
    { effect: "explosion", size: 1.6, tint: [0.3, 0.18, 0.95], additive: 1, mono: 1, alpha: 0.32, fps: 34, life: 1.1, fadeOut: 0.5, soft: 0.12 },
    { effect: "flare", size: 1.8, tint: [0.36, 0.22, 0.95], mono: 1, alpha: 0.44, fps: 30, fadeOut: 0.25, soft: 0.08 },
    { effect: "flare", size: 1.1, tint: [0.2, 0.46, 0.9], mono: 1, alpha: 0.4, delay: 0.08, fps: 42, flip: true, fadeOut: 0.2, soft: 0.08 },
  ],
  /** A powder blast on the board: cannon shot, petard, siege capture. */
  blast: [
    { effect: "explosion", size: 2.4, tint: [0.95, 0.92, 0.9], fps: 28, fadeOut: 0.5, soft: 0.15 },
  ],
  /**
   * A body hitting the stone: a thin sheet of fine dust driven out along the floor from under it, curling at
   * its rim and gone in about 1.3 s. It is low (a tenth of its width), so it lies round the body and cannot
   * rise over a wound. The tint is the pale stone's own cream, not grey: grey dust over a light square reads
   * as smoke.
   */
  fallDust: [
    // Joined two frames in: the first frames are the band before it has broken up, which reads as a slab.
    // The atlas's own alpha averages about a quarter where there is dust, so at 0.34 the sheet was barely there.
    { effect: "dust", size: 2.0, tint: [0.7, 0.64, 0.54], alpha: 0.55, fps: 24, frameOffset: 2, fadeIn: 0.08, fadeOut: 0.6, soft: 0.05 },
    // The same sheet mirrored, a little later and slower: it breaks the first one's outline.
    { effect: "dust", size: 1.6, tint: [0.64, 0.59, 0.5], alpha: 0.36, delay: 0.06, fps: 19, frameOffset: 3, flip: true, fadeIn: 0.08, fadeOut: 0.6, soft: 0.05 },
  ],
  /**
   * A footfall in a fight (a step, a dodge, a hop back): a small puff of dust kicked up off the stone, rising round the
   * foot and gone in under a second, in the stone's own shade (`STEP_DUST_SHADE`). It was a scuff, a smear a sixth of its
   * cell's height and a sixth opaque, and filmed close at the duel camera (with the scuff drawn in bright magenta to
   * find it) it was a strip about ten pixels high behind the heel: at its real tint not one footfall could be seen.
   * The powder puff's frames are a soft ball that blooms; its pivot is the ball's middle, so spawned on the floor the
   * stone hides the lower half and what stands is a dome of dust rising off the stone. It is seated behind the foot
   * (sceneEngine.ts `VFX_SEAT.step`), so the foot stands in front of it, and it stays under the shin: at its densest
   * (a fifth of a second in) its top is about 0.15 over the stone, and by the time it has grown taller it has thinned.
   * The ball's own alpha averages about a quarter, thinning to nothing at its rim: at alpha 1 a puff filmed in a duel
   * changed the stone it stood on by about 2 %. Its alpha is raised past 1 (the renderer holds each pixel at 1), which
   * thickens the body and the rim and leaves the core opaque. One sprite: a second would not fit the medium budget.
   */
  stepDust: [
    { effect: "smokePuff", size: 0.5, tint: [0.7, 0.64, 0.54], alpha: 2.2, fps: 40, life: 0.75, rise: 0.04, growth: 0.3, fadeIn: 0.04, fadeOut: 0.4, soft: 0.04 },
  ],
};

/** The board's two stones: its pale squares and its dark ones (`stoneUnder` in wiring.ts). */
export type VfxStone = "light" | "dark";

/**
 * The shade dust takes from the stone it rises from, multiplying its recipe's tint (fall and step dust alike;
 * `dustShade` in wiring.ts). In the pale stone's cream everywhere, dust had nothing to show against on a pale
 * square. Over a pale square it is now a darker warm grey, the grit and shadow in it; over a dark square it is a
 * pale cream, a little lighter than the recipe's own.
 */
export const DUST_SHADE: Readonly<Record<VfxStone, readonly [number, number, number]>> = {
  light: [0.38, 0.36, 0.34],
  dark: [1.15, 1.13, 1.1],
};

/**
 * The shade of a footfall's puff (`stepDust`): as {@link DUST_SHADE} over dark stone, darker over pale. A puff is unlit,
 * and in the fall dust's grey it came out as bright as the lit marble it stood on: in a close still of puffs on pale
 * squares they could hardly be told from the stone. Grit and shadow a good deal darker than the marble read as dust
 * kicked up off it; the pale cream over dark stone already did.
 */
export const STEP_DUST_SHADE: Readonly<Record<VfxStone, readonly [number, number, number]>> = {
  light: [0.3, 0.28, 0.25],
  dark: DUST_SHADE.dark,
};

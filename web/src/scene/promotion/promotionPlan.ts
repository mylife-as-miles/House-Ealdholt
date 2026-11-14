/**
 * The promotion, as a timeline: what the sequence that remakes a Pawn on the far rank is doing at each moment, and
 * which form of it a board gets. No Three.js in here, so the node tests reach it (shared/play/promotion-sequence.test.ts);
 * sceneEngine.ts plays what this decides (the Pawn's figure, the new figure, the column, the camera, the sound).
 *
 * The move is already made when any of this plays: the sequence only shows it. In order:
 *
 *   arrive   the Pawn reaches the far square and the camera comes in on it (before the timeline starts: its walk, or its fight)
 *   ignite   a column of its kingdom's light stands up round it from the stone
 *   rise     the Pawn is lifted in the column
 *   unmake   its figure burns away from the soles up, in its kingdom's ember
 *   form     the chosen figure burns in from the same light, the kingdom's sigil under it and its motes round it
 *   hold     it hangs whole in the light; the light flares and lets go
 *   fall     it drops onto the square
 *   land     the weight of it: dust, a ring over the board, the stone shaking, the witnesses turning; it speaks
 *   settle   the camera holds on it, then goes home
 *
 * The forms:
 *  - full: all of it (the camera only with capture cinematics on);
 *  - brief: a fight the player hurried past, or the move hurried: the same light at about a third of the length, no camera;
 *  - calm: reduced motion: a crossfade on the square, nothing moves, under 0.6 s;
 *  - plain: the menu's background board and the tactical map: the old swap. A replay plays the full sequence (it is
 *    deterministic, so it replays the same); a replay's skip is hurried and gets the brief form.
 * On the low preset the full form keeps its timing but draws less: no kingdom motes, no extra light, fewer particles.
 */
import type { QualityPreset } from "../quality";

/** The four armies, as `ArmySkinId` in assets/generated.ts names them. */
export type PromotionArmy = "ivory" | "sun" | "empire" | "kwind";
export type PromotionRank = "q" | "r" | "b" | "n";
export type PromotionSide = "w" | "b";
export type PromotionMode = "full" | "brief" | "calm" | "plain";
export interface PromotionPoint { x: number; y: number; z: number }

export interface PromotionContext {
  /** The kingdom of the side that promotes: the colour and manner of its light. */
  army: PromotionArmy;
  /** What the Pawn becomes. */
  rank: PromotionRank;
  side: PromotionSide;
  quality: QualityPreset;
  reducedMotion: boolean;
  /** The flat tactical map. */
  tactical: boolean;
  /** The menu's background board (the attract game, the title tableau). */
  menuBoard: boolean;
  /** A replay being played back. */
  replay: boolean;
  /** The Capture Cinematics setting: off, the camera stays where the player has it. */
  cinematics: boolean;
  /** The move is being hurried: a skipped fight, a replay's skip. */
  hurried: boolean;
  /** The Pawn took a piece on the far rank: its fight has played first. */
  capture: boolean;
}

/** A stretch of the timeline, in seconds from its start. */
export interface PromotionSpan { from: number; to: number }

export type PromotionCue = "promote" | "charge" | "stand" | "land" | "speak";

export interface PromotionLook {
  /** The kingdom, for the reader. */
  kingdom: string;
  /** The column's white-hot heart, the colour round it, and the motes it sheds (sRGB). */
  core: number;
  glow: number;
  ember: number;
  /** The burning edge of the figure going and the figure coming (sRGB), and how hard it burns. */
  burn: number;
  burnGain: number;
  /** How hard the landing shakes the stone, against the others (Solforiz comes down hardest, Korvenia lightest). */
  weight: number;
}

export interface PromotionPlan {
  mode: PromotionMode;
  /** Why this form: for traces and tests. */
  reason: string;
  /** The camera comes in close and goes home after. */
  camera: boolean;
  /** The column of light, and the ring it throws at the landing. */
  column: boolean;
  /** The kingdom's sigil inscribed under the forming figure. */
  sigil: boolean;
  /** The kingdom's motes round the forming figure (musterEffects). */
  motes: boolean;
  /** A light borrowed from the spell-light pool. */
  light: boolean;
  /** Embers thrown at the landing, and the column's motes and sparks, by the preset. */
  particles: { landing: number; stand: number; budget: QualityPreset };
  /** How high the figure is lifted, in board units. */
  lift: number;
  ignite: PromotionSpan;
  rise: PromotionSpan;
  unmake: PromotionSpan;
  form: PromotionSpan;
  hold: PromotionSpan;
  fall: PromotionSpan;
  settle: PromotionSpan;
  /** The moment the new figure meets the stone. */
  landAt: number;
  /** When the camera lets go, to ease home over {@link PROMOTION_TIMING}.home. */
  release: number;
  /** How long the move waits on the sequence. */
  total: number;
  /** Sounds and lines, at their moments. */
  cues: readonly { at: number; cue: PromotionCue }[];
  /** The strength of the landing (scene landOn weight) and the extra camera shake it adds. */
  weight: number;
  shake: number;
  look: PromotionLook;
}

/**
 * The full form's timing, in seconds. The Pawn's going and the new figure's coming overlap, so that something is
 * always standing in the light; the figure hangs whole a beat before it drops, and the drop is short and hard.
 */
export const PROMOTION_TIMING = {
  ignite: [0, 0.4],
  rise: [0.2, 1.1],
  unmake: [0.75, 1.7],
  form: [1.3, 2.45],
  hold: [2.45, 2.72],
  fall: [2.72, 2.98],
  settle: [2.98, 3.75],
  /** The camera starts home a little before the move lets go, and takes this long to get there. */
  release: 3.5,
  home: 1.2,
  /** Seconds the camera takes to come in on the square, when it has to (after a fight, or for the computer's move). */
  easeIn: 0.85,
  /**
   * After a fight the camera has to come in from wherever the fight (or its claim) left it: the light waits this long for
   * it, so the column is not stood up across the camera's way in. A walk onto the square covers the same ease.
   */
  comeIn: 0.7,
} as const;

/** The brief form runs the full one at this share of its length. */
export const BRIEF_SHARE = 0.32;
/** The calm form: the Pawn fades out over the first stretch, the new figure in over the second, both on the square. */
export const CALM_TIMING = { unmake: [0, 0.3], form: [0.14, 0.5] } as const;
/** How high the figure is lifted (board units), and how far for the brief form. */
export const PROMOTION_LIFT = 0.5;

/**
 * Each kingdom's light (the creator's art direction, as musterEffects.ts MUSTER_STYLES has it: the burning edge here is
 * its ember, so the figure burns in exactly as its army took the field).
 *  - Aethelgard: a column of gold round a heart of white, witchfire-blue motes.
 *  - Solforiz: furnace fire, copper sparks; it comes down hardest.
 *  - Korvenia: academy violet round silver, star-white motes; it comes down lightest, as a thing of glass.
 *  - Kwind-09: arc-tech cyan, sodium-amber sparks.
 */
export const PROMOTION_LOOK: Readonly<Record<PromotionArmy, PromotionLook>> = {
  ivory: { kingdom: "Aethelgard", core: 0xfff4dc, glow: 0xffb847, ember: 0x9fd0ff, burn: 0xffc35a, burnGain: 1, weight: 1 },
  sun: { kingdom: "Solforiz", core: 0xffeacc, glow: 0xff5a14, ember: 0xffb050, burn: 0xff5a14, burnGain: 1.6, weight: 1.15 },
  empire: { kingdom: "Korvenia", core: 0xf2ecff, glow: 0x9466ff, ember: 0xe6e0ff, burn: 0xa66cff, burnGain: 1.5, weight: 0.9 },
  kwind: { kingdom: "Kwind-09", core: 0xe8fdff, glow: 0x3fe0ff, ember: 0xffb04a, burn: 0x46e6ff, burnGain: 1, weight: 1 },
};

/** How heavy each rank comes down: the Queen and the Rook are the heaviest figures of the four. */
export const RANK_WEIGHT: Readonly<Record<PromotionRank, number>> = { q: 1.3, r: 1.25, b: 1.05, n: 1.15 };

/** Embers thrown at the landing and as the figure stands, by preset. */
const PARTICLES: Readonly<Record<QualityPreset, { landing: number; stand: number }>> = {
  low: { landing: 10, stand: 0 },
  medium: { landing: 26, stand: 18 },
  high: { landing: 36, stand: 26 },
  ultra: { landing: 44, stand: 32 },
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** Hermite ease, as GLSL's smoothstep. */
const smooth = (from: number, to: number, value: number) => {
  if (to <= from) return value >= to ? 1 : 0;
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};
const span = (pair: readonly [number, number], share = 1): PromotionSpan => ({ from: pair[0] * share, to: pair[1] * share });

/** Which form a board gets, and why. */
export function promotionMode(context: PromotionContext): { mode: PromotionMode; reason: string } {
  if (context.menuBoard) return { mode: "plain", reason: "menu-board" };
  if (context.tactical) return { mode: "plain", reason: "tactical" };
  if (context.reducedMotion) return { mode: "calm", reason: "reduced-motion" };
  if (context.hurried) return { mode: "brief", reason: "hurried" };
  return { mode: "full", reason: context.capture ? "after-capture" : "promotion" };
}

/** The sequence a promotion plays: its form, its timing, what it draws and the kingdom's look. */
export function planPromotion(context: PromotionContext): PromotionPlan {
  const { mode, reason } = promotionMode(context);
  const look = PROMOTION_LOOK[context.army];
  const low = context.quality === "low";
  const weight = RANK_WEIGHT[context.rank] * look.weight;
  const none: PromotionSpan = { from: 0, to: 0 };
  const base = {
    mode, reason, look, camera: false, column: false, sigil: false, motes: false, light: false,
    particles: { landing: 0, stand: 0, budget: context.quality }, lift: 0,
  };
  if (mode === "plain" || mode === "calm") {
    // No light and no lift: the old swap (its fade, its burst), or the crossfade on the square.
    const unmake = mode === "calm" ? span(CALM_TIMING.unmake) : { from: 0, to: 0.44 };
    const form = mode === "calm" ? span(CALM_TIMING.form) : { from: 0, to: 0.44 };
    const end = form.to;
    return {
      ...base, ignite: none, rise: none, unmake, form, hold: { from: end, to: end }, fall: { from: end, to: end },
      settle: { from: end, to: end }, landAt: end, release: end, total: end,
      cues: [{ at: 0, cue: "promote" }, { at: end, cue: "land" }, { at: end, cue: "speak" }],
      weight: mode === "calm" ? 0.8 : 1.3, shake: 0,
    };
  }
  const share = mode === "brief" ? BRIEF_SHARE : 1;
  const ignite = span(PROMOTION_TIMING.ignite, share), rise = span(PROMOTION_TIMING.rise, share), unmake = span(PROMOTION_TIMING.unmake, share);
  const form = span(PROMOTION_TIMING.form, share), hold = span(PROMOTION_TIMING.hold, share), fall = span(PROMOTION_TIMING.fall, share);
  const settle = span(PROMOTION_TIMING.settle, share);
  const full = mode === "full";
  const particles = PARTICLES[context.quality];
  return {
    ...base,
    camera: full && context.cinematics,
    column: true,
    sigil: full,
    motes: full && !low,
    light: full && !low,
    particles: { landing: full ? particles.landing : Math.round(particles.landing * 0.5), stand: full ? particles.stand : 0, budget: context.quality },
    lift: full ? PROMOTION_LIFT : PROMOTION_LIFT * 0.5,
    ignite, rise, unmake, form, hold, fall, settle,
    landAt: fall.to,
    release: full ? PROMOTION_TIMING.release : settle.to,
    total: settle.to,
    cues: [
      { at: ignite.from, cue: "promote" },
      ...(full ? [{ at: ignite.from, cue: "charge" as const }] : []),
      { at: form.to, cue: "stand" },
      { at: fall.to, cue: "land" },
      { at: fall.to, cue: "speak" },
    ],
    weight: Math.min(1.6, weight * (full ? 1.15 : 0.9)),
    shake: full ? 0.05 * weight : 0.02 * weight,
  };
}

/** The cues whose moment falls in (from, to]: what to sound between two frames of the sequence's clock (start from -1). */
export function cuesBetween(plan: PromotionPlan, from: number, to: number): PromotionCue[] {
  return plan.cues.filter((entry) => entry.at > from && entry.at <= to).map((entry) => entry.cue);
}

/** How strong the column stands at `t`, 0 to 1: up as it ignites, a flare as the figure stands whole, gone as it lands. */
export function columnPower(plan: PromotionPlan, t: number): number {
  if (!plan.column) return 0;
  const up = smooth(plan.ignite.from, plan.ignite.to, t);
  const flare = t >= plan.form.to ? 0.45 * Math.exp(-(t - plan.form.to) * 9) : 0;
  const down = 1 - smooth(plan.hold.to, plan.landAt + 0.2 * (plan.mode === "brief" ? BRIEF_SHARE : 1), t);
  return Math.max(0, up * down + flare * down);
}

/** How far the Pawn has burnt away, 0 to 1. */
export function pawnUnmade(plan: PromotionPlan, t: number): number {
  return smooth(plan.unmake.from, plan.unmake.to, t);
}

/** How far the new figure has formed, 0 to 1. */
export function figureFormed(plan: PromotionPlan, t: number): number {
  return smooth(plan.form.from, plan.form.to, t);
}

/** How high the Pawn stands above its square at `t`. */
export function pawnLift(plan: PromotionPlan, t: number): number {
  return plan.lift * smooth(plan.rise.from, plan.rise.to, t);
}

/**
 * How high the new figure stands above its square at `t`: at the lift while it forms and hangs, then dropped as a
 * weight falls (slow off the top, fastest as it meets the stone), on the square from the landing on.
 */
export function figureLift(plan: PromotionPlan, t: number): number {
  if (t >= plan.landAt) return 0;
  if (t <= plan.fall.from) return plan.lift;
  const u = clamp01((t - plan.fall.from) / Math.max(1e-6, plan.fall.to - plan.fall.from));
  return plan.lift * (1 - u * u);
}

/** The landing's push, 0 to 1 over the settle: a quick squash on impact and the figure drawing itself up after. */
export function landingSquash(plan: PromotionPlan, t: number): number {
  if (t < plan.landAt || plan.mode === "plain" || plan.mode === "calm") return 0;
  const age = t - plan.landAt;
  return Math.exp(-age * 14) * Math.min(1, age * 40);
}

/**
 * The picker's close shot while the player chooses (the existing picker, staged over the far square): only where a
 * full sequence could follow with its camera. The tactical map keeps its flat picker over the board.
 */
export function choiceStaged(context: Pick<PromotionContext, "reducedMotion" | "tactical" | "menuBoard" | "cinematics" | "replay">): boolean {
  return context.cinematics && !context.reducedMotion && !context.tactical && !context.menuBoard && !context.replay;
}

/**
 * The flat direction the close shots look from, out from the square: from the promoting player's own side, and a
 * little toward the middle of the board, so a corner square is seen across the board rather than from off its edge.
 */
export function promotionFacing(side: PromotionSide, squareX: number): { x: number; z: number } {
  const back = side === "w" ? 1 : -1;
  // Toward the middle: at least a quarter turn's worth of lean, more toward the edge files.
  const lean = Math.max(0.32, Math.min(0.62, Math.abs(squareX) * 0.18)) * (squareX > 0 ? -1 : 1);
  const length = Math.hypot(lean, back);
  return { x: lean / length, z: back / length };
}

/** A figure standing on the board, as the close shots look past it: where it stands and how tall it is. */
export interface PromotionObstacle { x: number; z: number; height: number }

/** How far the close shots stand off the square across the board (about what riteShot settles on), and how near the
 * line from the eye to the square a standing figure may be before it is in the way. */
export const SHOT_REACH = 3.2;
const IN_THE_WAY = 1.0;
const LEANS = [1, 0.5, 0, -0.5, -1] as const;

/**
 * The flat direction the close shots look from, chosen among a few leans either side of {@link promotionFacing} for the
 * one whose line of sight to the square passes clearest of the figures standing round it (the far rank is crowded: a
 * Rook beside the square can stand square in front of it). Taller figures in the way cost more; past that, the lean
 * nearest the plain one wins. Figures on the square itself are not counted.
 */
export function clearestFacing(side: PromotionSide, square: { x: number; z: number }, obstacles: readonly PromotionObstacle[]): { x: number; z: number } {
  const back = side === "w" ? 1 : -1;
  const plain = promotionFacing(side, square.x);
  const plainLean = plain.x / Math.abs(plain.z);
  let best = plain, bestCost = Infinity;
  for (const step of LEANS) {
    // Leans from the plain one round to as far the other way: 1 is the plain lean, -1 its mirror.
    const lean = plainLean * step;
    const length = Math.hypot(lean, 1);
    const facing = { x: lean / length, z: back / length };
    const eye = { x: square.x + facing.x * SHOT_REACH, z: square.z + facing.z * SHOT_REACH };
    let cost = 0.12 * (1 - step);
    for (const other of obstacles) {
      const dx = other.x - square.x, dz = other.z - square.z;
      const along = (dx * (eye.x - square.x) + dz * (eye.z - square.z)) / (SHOT_REACH * SHOT_REACH);
      if (along <= 0.08 || along >= 1) continue;
      const off = Math.hypot(dx - (eye.x - square.x) * along, dz - (eye.z - square.z) * along);
      if (off < IN_THE_WAY) cost += (IN_THE_WAY - off) / IN_THE_WAY * (0.5 + other.height) * (1.2 - along);
    }
    if (cost < bestCost - 1e-9) { best = facing; bestCost = cost; }
  }
  return best;
}

/**
 * What the arrival shot keeps in frame: the square, and the column over it up past the head of the figure the Pawn
 * becomes (`height`, the tallest, a Queen's, if not given), standing at the lift. The column itself rises out of the top.
 */
export function arrivalFrame(square: { x: number; z: number }, boardTop: number, lift = PROMOTION_LIFT, height = 1.32): PromotionPoint[] {
  const top = boardTop + lift + height + 0.16;
  return [
    { x: square.x, y: boardTop - 0.12, z: square.z },
    { x: square.x, y: top, z: square.z },
    { x: square.x - 0.36, y: boardTop + 0.6, z: square.z },
    { x: square.x + 0.36, y: boardTop + 0.6, z: square.z },
  ];
}

/** The picker's size in this staging, against the size it floats at over the middle of the board. */
export const CHOICE_SCALE = 0.7;
/** The candidates' spacing on the staged picker, and their size on their pedestals (over the board: 1.35 and 0.78). */
export const CHOICE_SPACING = 1.15;
export const CHOICE_FIGURE = 1;
/** Half the staged picker's width at size 1 (four slots CHOICE_SPACING apart, each a pedestal half a unit round). */
export const PICKER_HALF_WIDTH = 1.5 * CHOICE_SPACING + 0.5;
/** How high the staged picker floats over the stone, and how high its tallest candidate (a Queen, lifted in focus) stands on it. */
const CHOICE_HEIGHT = 1.45;
const CHOICE_TOP = (1.32 * CHOICE_FIGURE + 0.22) * CHOICE_SCALE;

/**
 * Where the picker floats while the player chooses: over the far square and a little beyond it, high enough that the
 * Pawn (a rank nearer the player) stands clear under it, and kept wholly over the board (an edge file's picker slides
 * in toward the middle). With what the shot keeps in frame: the Pawn, the square and the four candidates, framed as
 * close as the screen's width allows: the row runs across the frame, where a wide screen has room to spare, so it is
 * counted at the share of its width the screen's height would give it (`aspect`, the frame's width over its height).
 */
export function choiceStage(input: { pawn: { x: number; z: number }; square: { x: number; z: number }; side: PromotionSide; boardTop: number; edge: number; facing?: { x: number; z: number }; aspect?: number }): {
  anchor: PromotionPoint; scale: number; frame: PromotionPoint[]; facing: { x: number; z: number };
} {
  const away = input.side === "w" ? -1 : 1;
  const half = PICKER_HALF_WIDTH * CHOICE_SCALE;
  const limit = Math.max(0, input.edge - half);
  const anchor = { x: Math.max(-limit, Math.min(limit, input.square.x)), y: input.boardTop + CHOICE_HEIGHT, z: input.square.z + away * 0.3 };
  const facing = input.facing ?? promotionFacing(input.side, input.square.x);
  // Across the shot: square to the way it looks.
  const across = { x: facing.z, z: -facing.x };
  const wide = half * Math.min(1, 1 / Math.max(1, input.aspect ?? 1));
  const top = anchor.y + CHOICE_TOP + 0.06, bottom = anchor.y - 0.16 * CHOICE_SCALE;
  const frame: PromotionPoint[] = [
    // Kept off the bottom edge, where a narrower screen's HUD lays the picker's panel.
    { x: input.pawn.x, y: input.boardTop - 0.2, z: input.pawn.z },
    { x: input.pawn.x, y: input.boardTop + 0.85, z: input.pawn.z },
    { x: input.square.x, y: input.boardTop, z: input.square.z },
    { x: anchor.x + across.x * wide, y: top, z: anchor.z + across.z * wide },
    { x: anchor.x - across.x * wide, y: top, z: anchor.z - across.z * wide },
    { x: anchor.x + across.x * wide, y: bottom, z: anchor.z + across.z * wide },
    { x: anchor.x - across.x * wide, y: bottom, z: anchor.z - across.z * wide },
  ];
  return { anchor, scale: CHOICE_SCALE, frame, facing };
}

/**
 * The Knight's vault: the finisher a Knight plays on some of its melee captures, as plain data. No Three.js in here, so
 * the node tests reach it (shared/play/knight-vault.test.ts); sceneEngine.ts plays what this decides (the figures, the
 * camera, the sound) and finisher/knightVaultVfx.ts draws its light and ink.
 *
 * In order, from the moment the Knight stands in front of the piece it takes (its charge in, under the wide shot,
 * comes before the timeline starts):
 *
 *   spin     a whirling slash: the Knight turns once on the spot, its blade leaving a crescent of its kingdom's light,
 *            and the piece staggers in a burst of flakes
 *   crouch   the spring is loaded
 *   vault    a straight cut to a low, moving shot: the Knight springs up and over the piece, weapon held overhead,
 *            body arched, two brush-stroke wings of ink sweeping up either side of it and streaks of light across it
 *   apex     two lines of blade-light cross in an X over it: a cut to the close shot over the strike
 *   land     it comes down behind the piece, turned back to it, and drives the blade through
 *   strike   the kill (the existing death, blood and wound systems), a spray of flakes that hangs in the hit-stop
 *   pose     a close shot from in front: it wrenches the blade free and turns to the eye, the body falling behind it
 *   ring     back to a wide shot: flakes swirl at its feet and a thin ring of its light runs out over the stone and fades,
 *            and it relaxes into its stance
 *
 * Then the move ends as every capture does: the body is claimed and the Knight takes the square it captured.
 *
 * The forms:
 *  - full: all of it, with its camera, on a live board with capture cinematics on;
 *  - calm: reduced motion: the Knight's ordinary leap onto the square, then a slow, dim ring and a few flakes settling
 *    round it; no camera, no flash, no shake, under a second;
 *  - none: anything else (the menu's background board, the tactical map, capture cinematics off, a capture that is not
 *    a Knight's own melee kill, a capture the Combat Director fights, or a capture the rule passes over).
 * On the low preset the full form keeps its timing and draws less: fewer flakes, shorter wings, fewer streaks, no light.
 */
import type { QualityPreset } from "../quality";
import { FLOURISH_LOOK, type FlourishLook } from "../vfx/flourish/flourishPlan";

/** The four armies, as `ArmySkinId` in assets/generated.ts names them. */
export type VaultArmy = "ivory" | "sun" | "empire" | "kwind";
export type VaultSide = "w" | "b";
export type VaultKind = "p" | "n" | "b" | "r" | "q" | "k";
export type VaultMode = "full" | "calm" | "none";
export interface VaultPoint { x: number; y: number; z: number }

/** A move of the game before the capture, as the snapshot's history keeps it (replay-show.ts HistoryMove). */
export interface VaultHistoryMove { color: VaultSide; kind: VaultKind; capture: boolean; captured?: VaultKind | null }

export interface VaultContext {
  attacker: VaultKind;
  victim: VaultKind;
  side: VaultSide;
  /** How the attacker opens a fight (sceneEngine attackStyle). */
  style: "melee" | "spell" | "gun";
  /** The Combat Director has a duel for this capture (a Knight taking a Knight or a Rook). */
  directed: boolean;
  /** A Queen's summon (never a Knight's, but the rule says so itself). */
  summon: boolean;
  /** The menu's background board (attract mode, the title tableau). */
  menuBoard: boolean;
  tactical: boolean;
  /** The Capture Cinematics setting. */
  cinematics: boolean;
  reducedMotion: boolean;
  quality: QualityPreset;
  /** The moves before this capture, oldest first. */
  history: readonly VaultHistoryMove[];
  /** One draw of the match's show dice for this ply (sceneEngine showDice), 0 to 1. */
  roll: number;
}

/** The share of a side's later Knight captures that get the vault: about one in three. */
export const VAULT_CHANCE = 1 / 3;

/**
 * Whether this capture is one the vault could be: a Knight's own melee kill, not fought by the Combat Director, not a
 * summon, a gun or a spell, on a board that shows capture cinematics at all.
 */
export function vaultEligible(context: VaultContext): { eligible: boolean; reason: string } {
  if (context.menuBoard) return { eligible: false, reason: "menu-board" };
  if (context.tactical) return { eligible: false, reason: "tactical" };
  if (!context.cinematics) return { eligible: false, reason: "cinematics-off" };
  if (context.attacker !== "n") return { eligible: false, reason: "not-a-knight" };
  if (context.style !== "melee" || context.summon) return { eligible: false, reason: "not-melee" };
  if (context.directed || directedVictim(context.victim)) return { eligible: false, reason: "directed-duel" };
  if (context.victim === "k") return { eligible: false, reason: "king" };
  return { eligible: true, reason: "knight-capture" };
}

/** A Knight taking a Knight or a Rook is a rank duel the Combat Director fights (combat/rankDuel.ts directRankDuel). */
function directedVictim(victim: VaultKind): boolean {
  return victim === "n" || victim === "r";
}

/**
 * How many of `side`'s Knight captures before this one could have been a vault: its Knights' kills of a Pawn, a Bishop
 * or a Queen (a Knight or a Rook is the Director's duel).
 */
export function earlierKnightCaptures(history: readonly VaultHistoryMove[], side: VaultSide): number {
  let count = 0;
  for (const move of history) if (move.color === side && move.kind === "n" && move.capture && !directedVictim(move.captured ?? "p")) count += 1;
  return count;
}

/**
 * The rule: each side's first such Knight capture of the match always plays the vault, so a player meets it the first
 * time a Knight of theirs kills; after that about a third do, as the match's own show dice fall for that ply. The same
 * game always plays it on the same captures (a replay, an Undo and redo), and another game on others.
 */
export function vaultChosen(context: VaultContext): { chosen: boolean; reason: string } {
  const gate = vaultEligible(context);
  if (!gate.eligible) return { chosen: false, reason: gate.reason };
  if (earlierKnightCaptures(context.history, context.side) === 0) return { chosen: true, reason: "first-knight-capture" };
  const roll = Number.isFinite(context.roll) ? context.roll : 1;
  return roll < VAULT_CHANCE ? { chosen: true, reason: "show-dice" } : { chosen: false, reason: "passed-over" };
}

/** Which form a capture gets, and why. */
export function vaultMode(context: VaultContext): { mode: VaultMode; reason: string } {
  const choice = vaultChosen(context);
  if (!choice.chosen) return { mode: "none", reason: choice.reason };
  return context.reducedMotion ? { mode: "calm", reason: "reduced-motion" } : { mode: "full", reason: choice.reason };
}

// ------------------------------------------------------------------------------------------------------------ timing

/** A stretch of the timeline, in seconds from its start. */
export interface VaultSpan { from: number; to: number }

/**
 * The full form's timing (board seconds; the hit-stop holds the board's clock, so it stretches what follows the blow
 * without moving any of it). Timed to the creator's reference clip (6.2 s), beat for beat: 1.33 s of lead-in, the
 * whirl at 0, the cut low at 0.54, the X as it rises at 0.84, the blade in at about 1.8, the pose at about 2.1, the cut
 * back wide at about 2.5, the ring running out from about 2.8 and the wide shot holding on the Knight to about 4.9.
 */
export const VAULT_TIMING = {
  /**
   * Seconds from the move's start to the whirl, under the wide shot: the Knight leaps in, squares up and holds its
   * guard (the reference's own lead-in before the slash is 1.33 s). The leap and the plea count towards it; whatever
   * is left the Knight spends standing in its guard.
   */
  leadIn: 1.33,
  spin: [0, 0.5],
  /** The crescent passes through the piece: it staggers. */
  staggerAt: 0.27,
  crouch: [0.5, 0.66],
  vault: [0.66, 1.5],
  /** After the spring, the X of blade-light (the reference crosses its blades as it rises, not at the top). */
  crossAfter: 0.18,
  /** After the top of the vault, the cut to the close shot over the strike (the X is seen in the low shot first). */
  strikeCut: 0.32,
  /** From the landing to the blade going in: the clip's own drive, retimed into this (see strikeTiming). */
  strikeLead: 0.28,
  /** After the blade goes in, the close shot holds the strike and its hit-stop this long before the pose. */
  strikeHold: 0.32,
  pose: 0.36,
  /** The ring beat: flakes swirl, then the ring runs out and fades, and the wide shot holds on the Knight after it. */
  swirl: [0, 0.34],
  expand: [0.34, 1.2],
  ring: 2.37,
  /** The camera starts home (or hands over to the Claiming) this long before the ring beat ends. */
  release: 0.3,
  /** Seconds the wide shot takes to come in from the player's view while the Knight charges. */
  easeIn: 0.6,
  /** Seconds the camera takes home after. */
  home: 1.2,
} as const;

/** The calm form: one slow, dim ring and a few flakes settling round the square after the ordinary leap. */
export const CALM_TIMING = { ring: [0, 0.75], total: 0.75 } as const;

export type VaultShotName = "wide" | "vault" | "drift" | "strike" | "pose" | "ring";
/** One camera beat: at `at` seconds the camera goes to `shot`, cutting (`ease` 0) or moving over `ease` seconds. */
export interface VaultCameraBeat { at: number; shot: VaultShotName; ease: number }

export type VaultCue = "whoosh.light" | "stagger" | "effort.heavy" | "whoosh.heavy" | "blade-light" | "strike" | "ring";

export interface VaultBudget {
  /** Cuts along each ink wing. */
  wingSegments: number;
  /** Light streaks drawn across the vault (the X of blade-light is two more). */
  streaks: number;
  /** Flakes swirling at the Knight's feet in the ring beat. */
  ringFlakes: number;
  /** Flakes in the spray that hangs from the strike, and in the stagger's. */
  sprayFlakes: number;
  staggerFlakes: number;
  /** Slots in the vault's one flake pool: every flake it throws shares it. */
  flakePool: number;
  /** Slots for streaks (the vault's and the X's). */
  streakPool: number;
  /** A borrowed point light at the X and the strike. */
  light: boolean;
}

/**
 * What each preset may spend. The flake pool holds a stagger, a strike's spray and the ring's swirl at once, which is
 * the most the timeline ever has in the air together. The kill's own shards (vfx/flourish shatter) come out of the
 * flourishes' budget, not this one.
 */
export const VAULT_BUDGET: Readonly<Record<QualityPreset, VaultBudget>> = Object.freeze({
  low: { wingSegments: 14, streaks: 3, ringFlakes: 10, sprayFlakes: 8, staggerFlakes: 5, flakePool: 24, streakPool: 6, light: false },
  medium: { wingSegments: 24, streaks: 6, ringFlakes: 22, sprayFlakes: 16, staggerFlakes: 10, flakePool: 48, streakPool: 10, light: true },
  high: { wingSegments: 32, streaks: 8, ringFlakes: 28, sprayFlakes: 22, staggerFlakes: 12, flakePool: 64, streakPool: 12, light: true },
  ultra: { wingSegments: 40, streaks: 10, ringFlakes: 34, sprayFlakes: 28, staggerFlakes: 14, flakePool: 80, streakPool: 14, light: true },
});

/** The calm form's few flakes, by preset (it keeps to the pool all the same). */
const CALM_FLAKES: Readonly<Record<QualityPreset, number>> = { low: 4, medium: 8, high: 10, ultra: 12 };

export interface VaultPlan {
  mode: VaultMode;
  reason: string;
  /** The camera takes the shots below and goes home (or to the Claiming) after. */
  camera: boolean;
  spin: VaultSpan;
  staggerAt: number;
  crouch: VaultSpan;
  vault: VaultSpan;
  apexAt: number;
  /** The X of blade-light, as it rises. */
  crossAt: number;
  landAt: number;
  /** The blade goes in: the kill, its blood and its hit-stop. */
  strikeAt: number;
  pose: VaultSpan;
  ring: VaultSpan;
  swirl: VaultSpan;
  expand: VaultSpan;
  /** When the camera lets go. */
  release: number;
  /** How long the move waits on the timeline before the body is claimed. */
  total: number;
  cameraBeats: readonly VaultCameraBeat[];
  cues: readonly { at: number; cue: VaultCue }[];
  /** What is drawn. */
  fx: {
    crescent: boolean; wings: boolean; streaks: number; cross: boolean; staggerFlakes: number; sprayFlakes: number;
    ringFlakes: number; ring: boolean; light: boolean; flash: boolean; shake: boolean; calm: boolean;
  };
  budget: VaultBudget;
}

const span = (pair: readonly [number, number], offset = 0): VaultSpan => ({ from: pair[0] + offset, to: pair[1] + offset });

/**
 * The finisher a capture plays: its form, its timing, its camera, its sounds and what it draws. `strikeLead` is the
 * Knight's own drive from the landing to the blade going in, where its clip gives one (strikeTiming).
 */
export function planKnightVault(context: VaultContext, strikeLead: number = VAULT_TIMING.strikeLead): VaultPlan {
  const { mode, reason } = vaultMode(context);
  const budget = VAULT_BUDGET[context.quality];
  const low = context.quality === "low";
  const none: VaultSpan = { from: 0, to: 0 };
  const quiet = {
    crescent: false, wings: false, streaks: 0, cross: false, staggerFlakes: 0, sprayFlakes: 0, ringFlakes: 0, ring: false,
    light: false, flash: false, shake: false, calm: false,
  };
  if (mode !== "full") {
    const ring = mode === "calm" ? span(CALM_TIMING.ring) : none;
    const total = mode === "calm" ? CALM_TIMING.total : 0;
    return {
      mode, reason, camera: false, spin: none, staggerAt: 0, crouch: none, vault: none, apexAt: 0, crossAt: 0, landAt: 0, strikeAt: 0,
      pose: none, ring, swirl: ring, expand: ring, release: total, total, cameraBeats: [], cues: [],
      fx: mode === "calm" ? { ...quiet, ring: true, ringFlakes: CALM_FLAKES[context.quality], calm: true } : quiet,
      budget,
    };
  }
  const lead = Math.min(0.45, Math.max(0.16, Number.isFinite(strikeLead) ? strikeLead : VAULT_TIMING.strikeLead));
  const spin = span(VAULT_TIMING.spin), crouch = span(VAULT_TIMING.crouch), vault = span(VAULT_TIMING.vault);
  const apexAt = (vault.from + vault.to) / 2, crossAt = vault.from + VAULT_TIMING.crossAfter, landAt = vault.to, strikeAt = landAt + lead;
  const pose = { from: strikeAt + VAULT_TIMING.strikeHold, to: strikeAt + VAULT_TIMING.strikeHold + VAULT_TIMING.pose };
  const ring = { from: pose.to, to: pose.to + VAULT_TIMING.ring };
  const swirl = span(VAULT_TIMING.swirl, ring.from), expand = span(VAULT_TIMING.expand, ring.from);
  const release = ring.to - VAULT_TIMING.release;
  return {
    mode, reason, camera: true, spin, staggerAt: VAULT_TIMING.staggerAt, crouch, vault, apexAt, crossAt, landAt, strikeAt, pose, ring, swirl, expand,
    release, total: ring.to,
    cameraBeats: [
      // The wide shot comes in while the Knight charges (before the timeline's start).
      { at: -VAULT_TIMING.easeIn, shot: "wide", ease: VAULT_TIMING.easeIn },
      // A straight cut to the low shot as it springs, which then moves with it through the air.
      { at: crouch.from + 0.04, shot: "vault", ease: 0 },
      { at: vault.from, shot: "drift", ease: apexAt - vault.from },
      // The X of blade-light as it rises, seen from below; on the way down, a cut to the close shot over the strike.
      { at: apexAt + VAULT_TIMING.strikeCut, shot: "strike", ease: 0 },
      { at: pose.from, shot: "pose", ease: 0 },
      { at: ring.from, shot: "ring", ease: 0 },
    ],
    cues: [
      { at: spin.from, cue: "whoosh.light" },
      { at: VAULT_TIMING.staggerAt, cue: "stagger" },
      { at: crouch.from, cue: "effort.heavy" },
      { at: vault.from, cue: "whoosh.heavy" },
      { at: crossAt, cue: "blade-light" },
      { at: strikeAt, cue: "strike" },
      { at: expand.from, cue: "ring" },
    ],
    fx: {
      crescent: true, wings: true, streaks: budget.streaks, cross: true, staggerFlakes: budget.staggerFlakes,
      sprayFlakes: budget.sprayFlakes, ringFlakes: budget.ringFlakes, ring: true, light: budget.light && !low, flash: true, shake: true, calm: false,
    },
    budget,
  };
}

/** The cues whose moment falls in (from, to]: what to sound between two reads of the timeline's clock (start from -Infinity). */
export function vaultCuesBetween(plan: VaultPlan, from: number, to: number): VaultCue[] {
  return plan.cues.filter(entry => entry.at > from && entry.at <= to).map(entry => entry.cue);
}

/**
 * The most flakes the timeline has in the air at once, against the pool: the stagger's are still drifting when the
 * strike's spray is thrown, and both may still hang when the ring's swirl begins.
 */
export function vaultFlakePeak(plan: VaultPlan): number {
  return plan.fx.staggerFlakes + plan.fx.sprayFlakes + plan.fx.ringFlakes;
}

/** The most streaks at once: the vault's, and the X's two. */
export function vaultStreakPeak(plan: VaultPlan): number {
  return plan.fx.streaks + (plan.fx.cross ? 2 : 0);
}

// ---------------------------------------------------------------------------------------------------- the figure

/**
 * How the Knight's own strike is fitted to the landing, from its clip's markers (clip seconds): the weapon is held
 * overhead through the vault at `hold` (the clip's `clash`, its blade raised, else part way from `ready` to the
 * contact), and from the landing the clip runs on from there at `rate` so the blade goes in `lead` seconds later.
 */
export function strikeTiming(events: Readonly<Record<string, number>>, duration: number, wanted: number = VAULT_TIMING.strikeLead): { hold: number; rate: number; lead: number; contact: number } {
  const contact = events.contact ?? events.impact ?? duration * 0.58;
  const ready = Math.min(contact, events.ready ?? 0);
  const clash = events.clash;
  const hold = clash !== undefined && clash > ready && clash < contact ? clash : ready + (contact - ready) * 0.45;
  const drive = Math.max(1e-3, contact - hold);
  const rate = Math.min(2.6, Math.max(0.8, drive / Math.max(0.05, wanted)));
  return { hold, rate, lead: drive / rate, contact };
}

/**
 * Where the Knight is at a share `u` (0 to 1) of its vault: how far along the line from its take-off to its landing,
 * how high its feet are (a thrown body's parabola, its top over the piece), how far its body is arched back, and how
 * far it has turned round to face back at the piece it is coming down behind (1: all the way round).
 */
export function vaultPose(u: number, lift: number): { progress: number; height: number; arch: number; turn: number } {
  const t = Math.min(1, Math.max(0, u));
  // Mostly the even pace of a thrown body, eased a little off the ground and onto it.
  const progress = 0.6 * t + 0.4 * (0.5 - 0.5 * Math.cos(Math.PI * t));
  const height = Math.max(0, lift) * 4 * t * (1 - t);
  const arch = Math.sin(Math.PI * Math.min(1, t * 1.15));
  const turn = smooth(0.48, 0.94, t);
  return { progress, height, arch, turn };
}

/** How high the Knight's feet go: clear over the head of the piece it vaults. */
export function vaultLift(victimHeight: number): number {
  return Math.max(0.7, victimHeight + 0.14);
}

/** A standing figure the vault must not land in, or a shot must look past. */
export interface VaultObstacle { x: number; z: number; radius: number; height: number }

/**
 * Where the Knight comes down: `reach` behind the piece along the line it vaulted, or turned off it where another
 * figure stands there or the board ends (the Knight never lands in another figure, and keeps to the board where it
 * can). `edge` is half the board's width. Same input, same landing.
 */
export function vaultLanding(input: {
  standoff: VaultPoint; victim: VaultPoint; reach: number; edge: number; obstacles: readonly VaultObstacle[];
}): { point: VaultPoint; turn: number } {
  let bx = input.victim.x - input.standoff.x, bz = input.victim.z - input.standoff.z;
  const length = Math.hypot(bx, bz);
  if (length < 1e-6) { bx = 0; bz = -1; } else { bx /= length; bz /= length; }
  const reach = Math.max(0.3, input.reach);
  let best = { point: { x: input.victim.x + bx * reach, y: input.victim.y, z: input.victim.z + bz * reach }, turn: 0 }, bestCost = Infinity;
  for (const turn of LANDING_TURNS) {
    const c = Math.cos(turn), s = Math.sin(turn);
    const dx = bx * c - bz * s, dz = bx * s + bz * c;
    const point = { x: input.victim.x + dx * reach, y: input.victim.y, z: input.victim.z + dz * reach };
    let cost = 0.25 * Math.abs(turn);
    for (const other of input.obstacles) {
      const gap = Math.hypot(other.x - point.x, other.z - point.z) - other.radius;
      if (gap < 0.36) cost += (0.36 - gap) * 6;
    }
    const over = Math.max(0, Math.abs(point.x) - input.edge, Math.abs(point.z) - input.edge);
    if (over > 0) cost += 1.5 + over * 4;
    if (cost < bestCost - 1e-9) { best = { point, turn }; bestCost = cost; }
  }
  return best;
}
const LANDING_TURNS = [0, 0.45, -0.45, 0.85, -0.85, 1.25, -1.25] as const;

// ---------------------------------------------------------------------------------------------------- the camera

export interface VaultShotView { position: VaultPoint; target: VaultPoint; fov: number }

export interface FitOptions {
  /** The flat direction from what is framed out to the eye (need not be of unit length). */
  facing: { x: number; z: number };
  /** Degrees the eye stands above what it frames (negative: below it, looking up). */
  elevation: number;
  /** The lens (degrees, vertical) and the frame's width over its height. */
  fov: number;
  aspect: number;
  /** The share of the half frame every point must lie within. */
  fill: number;
  near: number;
  far: number;
  /** The lowest the eye may stand, and how far from the hall's centre. */
  floor: number;
  radius: number;
  /** What the eye looks at, in place of the middle of the points. */
  target?: VaultPoint;
  /** The widest the lens may open where the hall's wall keeps the eye near. */
  widest?: number;
}

const DEG = Math.PI / 180;
const UP = { x: 0, y: 1, z: 0 };
const sub = (a: VaultPoint, b: VaultPoint): VaultPoint => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: VaultPoint, b: VaultPoint) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: VaultPoint, b: VaultPoint): VaultPoint => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: VaultPoint): VaultPoint => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const smooth = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** Where `point` lies in a view, as a share of the half frame across and up (beyond 1 is out of it); null behind the eye. */
export function frameShare(view: VaultShotView, point: VaultPoint, aspect: number): { x: number; y: number } | null {
  const forward = unit(sub(view.target, view.position));
  let right = cross(forward, UP);
  if (Math.hypot(right.x, right.y, right.z) < 1e-6) right = { x: 1, y: 0, z: 0 };
  right = unit(right);
  const up = cross(right, forward);
  const v = sub(point, view.position), depth = dot(v, forward);
  if (depth <= 0.05) return null;
  const half = Math.tan((view.fov / 2) * DEG);
  return { x: dot(v, right) / depth / (half * aspect), y: dot(v, up) / depth / half };
}

/** Whether every point lies within `fill` of the half frame. */
function fits(view: VaultShotView, points: readonly VaultPoint[], aspect: number, fill: number): boolean {
  for (const point of points) {
    const at = frameShare(view, point, aspect);
    if (!at || Math.abs(at.x) > fill || Math.abs(at.y) > fill) return false;
  }
  return true;
}

/**
 * The nearest view, from the side and height asked for, that keeps every point within `fill` of the frame: stepped
 * out from `near` until they fit, never past the hall's wall or below `floor` (kept nearer by the wall, the lens
 * opens instead). Same input, same view. `points` must not be empty.
 */
export function fitShot(points: readonly VaultPoint[], options: FitOptions): VaultShotView & { confined: boolean } {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const target = options.target ?? { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
  let fx = options.facing.x, fz = options.facing.z;
  const flat = Math.hypot(fx, fz);
  if (flat < 1e-6) { fx = 0; fz = 1; } else { fx /= flat; fz /= flat; }
  const e = options.elevation * DEG;
  const direction = { x: fx * Math.cos(e), y: Math.sin(e), z: fz * Math.cos(e) };
  let walled = false;
  const place = (distance: number): VaultPoint => {
    const eye = { x: target.x + direction.x * distance, y: target.y + direction.y * distance, z: target.z + direction.z * distance };
    eye.y = Math.max(options.floor, eye.y);
    const ground = Math.hypot(eye.x, eye.z);
    if (ground > options.radius) { eye.x *= options.radius / ground; eye.z *= options.radius / ground; walled = true; }
    return eye;
  };
  const step = Math.max(0.05, (options.far - options.near) / 120);
  let distance = options.near, view: VaultShotView = { position: place(distance), target, fov: options.fov };
  for (; distance <= options.far + 1e-9; distance += step) {
    view = { position: place(distance), target, fov: options.fov };
    if (fits(view, points, options.aspect, options.fill)) return { ...view, confined: walled };
    // At the wall the eye goes no further back (nor up over it): the lens opens from there.
    if (walled) break;
  }
  // The wall (or the far limit) kept it near: the lens opens until they fit, as far as it may.
  const widest = options.widest ?? 70;
  for (let fov = options.fov; fov <= widest + 1e-9; fov += 1) {
    const wider = { position: view.position, target, fov };
    if (fits(wider, points, options.aspect, options.fill)) return { ...wider, confined: true };
  }
  return { position: view.position, target, fov: widest, confined: true };
}

/**
 * The share of the sight lines from `eye` to `points` that a standing figure cuts (each an upright cylinder from the
 * stone to its height), 0 to 1.
 */
export function sightBlocked(eye: VaultPoint, points: readonly VaultPoint[], obstacles: readonly VaultObstacle[], boardTop = 0): number {
  if (points.length === 0) return 0;
  let blocked = 0;
  for (const point of points) {
    const dx = point.x - eye.x, dz = point.z - eye.z, run = dx * dx + dz * dz;
    for (const other of obstacles) {
      const s = run < 1e-9 ? 0 : Math.min(1, Math.max(0, ((other.x - eye.x) * dx + (other.z - eye.z) * dz) / run));
      // The figure at the end of the line is what is looked at, not in front of it.
      if (s > 0.97) continue;
      const cx = eye.x + dx * s - other.x, cz = eye.z + dz * s - other.z;
      const height = eye.y + (point.y - eye.y) * s;
      if (cx * cx + cz * cz < other.radius * other.radius && height < boardTop + other.height) { blocked += 1; break; }
    }
  }
  return blocked / points.length;
}

/** The vault's geometry, as the camera frames it. Points on the stone have the stone's height. */
export interface VaultStage {
  /** Where the Knight set off from, where it stood to whirl, where the piece stands and where the Knight lands. */
  start: VaultPoint; standoff: VaultPoint; victim: VaultPoint; landing: VaultPoint;
  attackerHeight: number; victimHeight: number;
  /** How high its feet go (vaultLift). */
  lift: number;
  /** The player's view: the wide shots are taken from its side. */
  home: { position: VaultPoint; target: VaultPoint };
  aspect: number; fov: number; boardTop: number;
  /** How far from the hall's centre the eye may stand. */
  radius: number;
  /** Every other figure standing (never the two fighters). */
  obstacles: readonly VaultObstacle[];
}

/** The ring's radius round the Knight's feet in the last beat (board units). */
export const VAULT_RING_RADIUS = 0.9;

/** How each shot is taken: its elevation, how much of the frame the points may fill, how near and far, how low. */
export const VAULT_SHOT = {
  wide: { elevation: 26, fill: 0.62, near: 3.4, far: 13, floor: 1.4 },
  vault: { elevation: -10, fill: 0.8, near: 1.5, far: 5, floor: 0.4 },
  drift: { elevation: -16, fill: 0.8, near: 1.5, far: 5, floor: 0.4 },
  strike: { elevation: 15, fill: 0.68, near: 1.8, far: 5.5, floor: 0.6 },
  pose: { elevation: 8, fill: 0.78, near: 1.7, far: 4.5, floor: 0.6 },
  ring: { elevation: 27, fill: 0.62, near: 3, far: 11, floor: 1.4 },
  /** How far the low shot stands round from straight behind the Knight's take-off (radians), and how much more it moves. */
  vaultLean: [0.62, 0.95] as const, driftTurn: 0.32,
  /** How far the front shot of the pose stands round from straight in front of the Knight. */
  poseLean: 0.42,
  /** What a blocked sight line costs, against the order of preference of the sides (a step each). */
  blocked: 8,
  /** How much wider than a figure's own footprint a sight line must pass it to count as clear. */
  margin: 0.14,
  /** Degrees higher than its own a close shot may stand to see over a crowd round the square (each costs a little). */
  rises: [0, 16, 30] as const,
} as const;

const rotate = (v: { x: number; z: number }, angle: number) => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: v.x * c - v.z * s, z: v.x * s + v.z * c };
};
const flatUnit = (v: { x: number; z: number }) => { const l = Math.hypot(v.x, v.z); return l < 1e-6 ? { x: 0, z: 1 } : { x: v.x / l, z: v.z / l }; };
const at = (p: VaultPoint, y: number): VaultPoint => ({ x: p.x, y, z: p.z });

/** Whether `eye` stands inside a figure (or so near it that the lens would be in its body). */
function eyeInside(eye: VaultPoint, obstacles: readonly VaultObstacle[], boardTop: number): boolean {
  for (const other of obstacles) if (Math.hypot(eye.x - other.x, eye.z - other.z) < other.radius + 0.22 && eye.y < boardTop + other.height + 0.25) return true;
  return false;
}

/**
 * Of the sides and heights a shot may be taken from (in order of preference: every height of the first side, then the
 * next side), the one whose sight lines to what it must see the fewest figures cut, never with its eye inside a figure.
 * A crowded square is seen from higher up, over the figures round it, before it is seen through them. Same input, same
 * shot.
 */
function clearest(points: readonly VaultPoint[], sights: readonly VaultPoint[], facings: readonly { x: number; z: number }[], options: Omit<FitOptions, "facing">, stage: VaultStage, rises: readonly number[] = VAULT_SHOT.rises): VaultShotView {
  let best: VaultShotView = fitShot(points, { ...options, facing: facings[0] }), bestCost = Infinity;
  const widened = stage.obstacles.map(other => ({ ...other, radius: other.radius + VAULT_SHOT.margin, height: other.height + 0.1 }));
  const bodies = [...stage.obstacles, { x: stage.victim.x, z: stage.victim.z, radius: 0.27, height: stage.victimHeight }];
  for (let index = 0; index < facings.length; index += 1) {
    for (let step = 0; step < rises.length; step += 1) {
      const view = fitShot(points, { ...options, elevation: options.elevation + rises[step], facing: facings[index] });
      const cost = sightBlocked(view.position, sights, widened, stage.boardTop) * VAULT_SHOT.blocked + index * 0.5 + step * 0.9
        + (view.confined ? 1 : 0) + (eyeInside(view.position, bodies, stage.boardTop) ? 20 : 0);
      if (cost < bestCost - 1e-9) { best = { position: view.position, target: view.target, fov: view.fov }; bestCost = cost; }
    }
  }
  return best;
}

/**
 * Every shot of the vault, framed for this board: the wide shot of the whirl, the low shot as it springs and where
 * that shot moves to through the air, the close shot over the strike, the front shot of the pose and the wide shot of
 * the ring. The wide shots are taken from the player's side; the close ones from whichever side is clearest of the
 * figures standing round, on the player's side where that is as clear.
 */
export function vaultShots(stage: VaultStage): Record<VaultShotName, VaultShotView> {
  const top = stage.boardTop, ah = stage.attackerHeight, vh = stage.victimHeight;
  const blow = flatUnit(sub(stage.victim, stage.standoff));
  const across = { x: -blow.z, z: blow.x };
  const home = flatUnit(sub(stage.home.position, stage.home.target));
  // The player's side of the line of the vault first.
  const near = across.x * home.x + across.z * home.z >= 0 ? across : { x: -across.x, z: -across.z };
  const far = { x: -near.x, z: -near.z };
  const base = (name: keyof typeof VAULT_SHOT & VaultShotName) => {
    const shot = VAULT_SHOT[name];
    return { elevation: shot.elevation, fov: stage.fov, aspect: stage.aspect, fill: shot.fill, near: shot.near, far: shot.far, floor: top + shot.floor, radius: stage.radius };
  };
  const apex = { x: (stage.standoff.x + stage.landing.x) / 2, y: top + stage.lift + ah, z: (stage.standoff.z + stage.landing.z) / 2 };

  // The whirl, wide: the charge, the Knight and the piece.
  const widePoints = [at(stage.start, top), at(stage.start, top + ah), at(stage.standoff, top + ah + 0.15), at(stage.victim, top), at(stage.victim, top + vh + 0.1)];
  const wide = clearest(widePoints, [at(stage.standoff, top + ah * 0.6), at(stage.victim, top + vh * 0.6)],
    [home, rotate(home, 0.4), rotate(home, -0.4)], base("wide"), stage);

  // The vault, low, from behind the take-off and round to one side, looking up at it going over.
  const behind = { x: -blow.x, z: -blow.z };
  // It springs: the Knight with its weapon going up, and the head of the piece it is about to clear.
  const vaultPoints = [at(stage.standoff, top), at(stage.standoff, top + ah + 0.45), at(stage.victim, top + vh)];
  // Over the top: the Knight in the air, its weapon overhead, the piece under it.
  const driftPoints = [at(apex, apex.y - ah), at(apex, apex.y + 0.5), at(stage.victim, top + vh * 0.5)];
  const sideOf = (side: { x: number; z: number }) => side.x * behind.z - side.z * behind.x >= 0 ? 1 : -1;
  const lean = (side: { x: number; z: number }, amount: number) => rotate(behind, amount * sideOf(side));
  const vaultFacings = [lean(near, VAULT_SHOT.vaultLean[0]), lean(far, VAULT_SHOT.vaultLean[0]), lean(near, VAULT_SHOT.vaultLean[1]), lean(far, VAULT_SHOT.vaultLean[1])];
  const vault = clearest(vaultPoints, [...vaultPoints, apex], vaultFacings, base("vault"), stage);
  // It moves on round the same way as the Knight flies.
  const vaultFacing = flatUnit(sub(vault.position, vault.target));
  const turnWay = vaultFacing.x * behind.z - vaultFacing.z * behind.x >= 0 ? 1 : -1;
  const drift = clearest(driftPoints, driftPoints,
    [rotate(vaultFacing, VAULT_SHOT.driftTurn * turnWay), rotate(vaultFacing, VAULT_SHOT.driftTurn * turnWay * 0.5), vaultFacing], base("drift"), stage);

  // The strike, close, across the line of the blow.
  const landingHead = at(stage.landing, top + ah + 0.08);
  // Coming down on it (the cut is made on the way down) as well as landing and striking.
  const descent = vaultPose(0.8, stage.lift);
  const falling = { x: stage.standoff.x + (stage.landing.x - stage.standoff.x) * descent.progress, z: stage.standoff.z + (stage.landing.z - stage.standoff.z) * descent.progress };
  const strikePoints = [at(stage.landing, top), landingHead, at(stage.victim, top), at(stage.victim, top + vh + 0.05), { x: falling.x, y: top + descent.height + ah, z: falling.z }];
  const strike = clearest(strikePoints, [at(stage.landing, top + ah * 0.6), at(stage.victim, top + vh * 0.6), landingHead, at(stage.victim, top + vh), at(stage.landing, top + 0.15)],
    [rotate(near, 0.25 * sideOf(near)), rotate(far, 0.25 * sideOf(far)), near, far], base("strike"), stage);

  // The pose, close, from in front of the Knight: the piece falls behind it.
  const front = flatUnit(sub(stage.landing, stage.victim));
  const posePoints = [at(stage.landing, top + ah + 0.15), at(stage.landing, top + ah * 0.2), at(stage.victim, top + vh * 0.5)];
  const poseTarget = at(stage.landing, top + ah * 0.62);
  const homeWay = front.x * home.z - front.z * home.x >= 0 ? -1 : 1;
  const pose = clearest(posePoints, [at(stage.landing, top + ah * 0.75), at(stage.landing, top + ah * 0.4), at(stage.landing, top + ah + 0.1)],
    [rotate(front, VAULT_SHOT.poseLean * homeWay), rotate(front, -VAULT_SHOT.poseLean * homeWay), front], { ...base("pose"), target: poseTarget }, stage);

  // The ring, wide: the Knight, the ring round its feet and the body.
  const r = VAULT_RING_RADIUS;
  const ringPoints = [
    at(stage.landing, top + ah + 0.1),
    { x: stage.landing.x + r, y: top, z: stage.landing.z }, { x: stage.landing.x - r, y: top, z: stage.landing.z },
    { x: stage.landing.x, y: top, z: stage.landing.z + r }, { x: stage.landing.x, y: top, z: stage.landing.z - r },
    at(stage.victim, top + 0.2),
  ];
  const ring = clearest(ringPoints, [at(stage.landing, top + ah * 0.6)], [home, rotate(home, 0.4), rotate(home, -0.4)], base("ring"), stage);

  const plain = (view: VaultShotView): VaultShotView => ({ position: view.position, target: view.target, fov: view.fov });
  return { wide: plain(wide), vault: plain(vault), drift: plain(drift), strike: plain(strike), pose: plain(pose), ring: plain(ring) };
}

/** What each shot must keep in frame, for the checks (the same points vaultShots frames). */
export function vaultShotPoints(stage: VaultStage): Record<VaultShotName, VaultPoint[]> {
  const top = stage.boardTop, ah = stage.attackerHeight, vh = stage.victimHeight, r = VAULT_RING_RADIUS;
  const apex = { x: (stage.standoff.x + stage.landing.x) / 2, y: top + stage.lift + ah, z: (stage.standoff.z + stage.landing.z) / 2 };
  return {
    wide: [at(stage.start, top), at(stage.standoff, top + ah), at(stage.victim, top), at(stage.victim, top + vh)],
    vault: [at(stage.standoff, top), at(stage.standoff, top + ah), at(stage.victim, top + vh)],
    drift: [at(apex, apex.y - ah), apex, at(stage.victim, top + vh * 0.5)],
    strike: [at(stage.landing, top), at(stage.landing, top + ah), at(stage.victim, top), at(stage.victim, top + vh)],
    pose: [at(stage.landing, top + ah), at(stage.landing, top + ah * 0.35)],
    ring: [at(stage.landing, top + ah), { x: stage.landing.x + r, y: top, z: stage.landing.z }, { x: stage.landing.x - r, y: top, z: stage.landing.z }],
  };
}

// ---------------------------------------------------------------------------------------------------- the look

/** The colours of a kingdom's vault (sRGB hex): its ink, the bright edge on the ink, the white-hot heart and its flakes. */
export interface VaultLook { ink: number; edge: number; core: number; flake: number; flakeAccent: number }

/** `hex` scaled toward black (`value` of its own brightness kept) or toward white (`white` of the way there). */
function shade(hex: number, value: number, white = 0): number {
  const channel = (shift: number) => {
    const c = ((hex >> shift) & 255) * value;
    return Math.round(Math.min(255, c + (255 - c) * white));
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/**
 * A kingdom's vault, from its flourish colours (vfx/flourish/flourishPlan.ts FLOURISH_LOOK): the ink is the kingdom's
 * deep colour taken nearly to black, so the wings read as dark brush strokes with the kingdom's own colour along their
 * edge; the light is its white-hot heart and its edge colour; the flakes are its own, paled toward white like torn
 * paper, with its accent among them.
 */
export function vaultLookOf(look: FlourishLook): VaultLook {
  return { ink: shade(look.deep, 0.3), edge: look.edge, core: look.core, flake: shade(look.flake, 1, 0.55), flakeAccent: look.flakeAccent };
}

export const VAULT_LOOK: Readonly<Record<VaultArmy, VaultLook>> = Object.freeze({
  sun: vaultLookOf(FLOURISH_LOOK.sun), ivory: vaultLookOf(FLOURISH_LOOK.ivory), kwind: vaultLookOf(FLOURISH_LOOK.kwind), empire: vaultLookOf(FLOURISH_LOOK.empire),
});

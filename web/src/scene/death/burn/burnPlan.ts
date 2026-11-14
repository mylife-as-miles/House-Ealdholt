/**
 * The burning body: what a fire kill (death/deathStyle.ts) does to the figure, as numbers.
 *
 * Fire catches where the piece was hit and spreads over the body; the surface chars black behind the front
 * with embers in its cracks; the figure staggers and flails, collapses, and lies smouldering as a husk over
 * its burn mark (vfx/scorch.ts); when the square is taken the husk crumbles to ash and embers.
 *
 * Everything that decides how long each part lasts, how far the char has spread, where the flames sit, how
 * the figure lurches and what a preset or reduced motion drops is here as plain data and arithmetic with no
 * Three.js, so the node tests reach it (shared/play/burn-plan.test.ts). burningBodies.ts draws what this
 * plans; charShader.ts is the char itself.
 *
 * The cheaper versions:
 *
 *  - Low preset: three flames at a time where High has six (it has 12 flipbook slots), no light thrown on
 *    the stone, no embers shed while the figure flails (only at ignition, landing and the crumble), half
 *    the smoke, a shorter smoulder (0.8 s where High has 1.4 s).
 *  - Reduced motion (`calm`): no stagger and no flailing, no flame sprites, no flash, no flicker in the
 *    embers and no travelling fire front: the char comes over the whole body at once in under half a
 *    second, the figure falls as it does today, one slow wisp of smoke rises, and the husk fades out
 *    through the same ember edge without throwing anything.
 */
import { mulberry32 } from "../../combat/director";
import type { QualityPreset } from "../../quality";
import { SCORCH_LOOK, scorchKind, type ScorchSource } from "../../vfx/scorchPlan";
import { SPELL_BURST_COLOUR, type VfxArmy, type VfxTint } from "../../vfx/wiring";

export interface BurnInputs {
  quality: QualityPreset;
  reducedMotion: boolean;
  /** A spell burns in its army's colour; the field gun's fire is natural. */
  source: ScorchSource;
  /** The army of the caster or the gun crew. */
  army: VfxArmy;
  /** The victim's standing height in world units. */
  height: number;
  /** The same game burns the same way: from the move record, as the fights are. */
  seed: number;
  /**
   * Set alight in something's grip (a phoenix's talons, rites/rite.ts `held-burn`): it neither flails nor falls
   * here, since whatever holds it moves it, and its flames stand larger, seen from further off under what carries it.
   */
  held?: boolean;
}

export interface BurnBudget {
  /** Flames alight on the body at once. */
  flames: number;
  /** Seconds one flame sprite lives, and between two sprites from one seat. */
  flameLife: number;
  flameEvery: number;
  /** Embers shed per puff while the figure burns on its feet (0: none). */
  embers: number;
  /** Smoke lobes per wisp. */
  smoke: number;
  /** Whether the fire lights the stone round it (a borrowed spell light). */
  light: boolean;
  /** Seconds the husk smoulders before the square may be taken. */
  smoulder: number;
}

export const BURN_BUDGET: Readonly<Record<QualityPreset, BurnBudget>> = {
  low: { flames: 3, flameLife: 0.5, flameEvery: 0.25, embers: 0, smoke: 1, light: false, smoulder: 0.8 },
  medium: { flames: 4, flameLife: 0.5, flameEvery: 0.2, embers: 3, smoke: 2, light: true, smoulder: 1.2 },
  high: { flames: 6, flameLife: 0.55, flameEvery: 0.16, embers: 5, smoke: 2, light: true, smoulder: 1.4 },
  ultra: { flames: 8, flameLife: 0.55, flameEvery: 0.14, embers: 7, smoke: 3, light: true, smoulder: 1.4 },
};

/** Most flame sprites one burning body can have alive: what the flipbook's `fire` atlas must have room for. */
export function flameSprites(budget: BurnBudget): number {
  return budget.flames * (Math.ceil(budget.flameLife / budget.flameEvery) + 1);
}

/** Natural fire: the baked frames as they are. */
export const NATURAL_FLAME: VfxTint = [0.95, 0.85, 0.75];
/** What a body's embers glow: the colour of the mark the same blast leaves on the stone. */
export function emberColour(source: ScorchSource, army: VfxArmy): VfxTint {
  return SCORCH_LOOK[scorchKind(source, army)].glow;
}
/** How much of the baked fire's heat a spell's recoloured flames keep (BurnPlan.flameHeat): all of it. */
export const SPELL_FLAME_HEAT = 1;
/** The flames' colour: null is natural fire (the field gun, Solforiz); a spell's is its army's burst colour. */
export function flameColour(source: ScorchSource, army: VfxArmy): VfxTint | null {
  return source === "gun" ? null : SPELL_BURST_COLOUR[army];
}

/**
 * The smoke off a burning body: soot, whatever lit it. Near black on purpose: in a dark arena drawn at exposure 5
 * a mid grey comes out as a pale cloud, and a pale cloud over the body hides the char.
 */
export const SOOT = 0x1b1917;

/** The char's own colour: black, whatever lit it (linear albedo; the scene's light does the rest). */
export const CHAR_ALBEDO: VfxTint = [0.012, 0.011, 0.01];
/** The radius the char starts at, round the point of impact. */
export const IGNITE_RADIUS = 0.07;
/** How far the front wanders off a clean sphere, and how wide its burning edge is, in world units. */
export const CHAR_JITTER = 0.2;
export const CHAR_EDGE = 0.09;
/** A front this far out has passed every part of any figure and what it carries. */
export const CHAR_FULL = 64;
/** How far a burning figure may lurch off the middle of its square, in squares: the husk lies on its mark. */
export const LURCH_REACH = 0.16;

export interface BurnPlan {
  /** `calm` is the reduced-motion version. */
  variant: "full" | "calm";
  budget: BurnBudget;
  /** Seconds from ignition for the char to cover the body. */
  spread: number;
  /** Seconds the figure burns on its feet before it collapses (0: it falls at once). */
  flail: number;
  /** Seconds the husk smoulders before it may be cleared. */
  smoulder: number;
  /** Seconds the husk takes to crumble. */
  crumble: number;
  /** World radius at which the front has covered the standing figure. */
  reach: number;
  /** Flame seats alight at once, and the size of one flame sprite in world units. */
  flames: number;
  flameSize: number;
  /** null: natural fire. */
  flame: VfxTint | null;
  /**
   * How much of the baked fire's heat a recoloured flame keeps (vfx/flipbookCore.ts `mono` past 1), 0..1: a spell's
   * flames take a white heart, with their edges in the army's colour, so they read as fire and not as a coloured haze;
   * natural fire is drawn as baked and needs none.
   */
  flameHeat: number;
  ember: VfxTint;
  /** The smoke off the body, as a hex colour. */
  smoke: number;
  /** Whether the embers flicker and the edge of the front glows. */
  flicker: boolean;
  seed: number;
}

export function planBurn(input: BurnInputs): BurnPlan {
  const calm = input.reducedMotion;
  const budget = BURN_BUDGET[input.quality];
  const height = Math.max(0.4, input.height);
  return {
    variant: calm ? "calm" : "full",
    budget,
    spread: calm ? 0.4 : 1.8,
    flail: calm || input.held ? 0 : 1.6,
    smoulder: calm ? 0.4 : budget.smoulder,
    crumble: calm ? 0.5 : 1.2,
    // From the chest to the crown or the soles, and a little of what the hands hold.
    reach: height * 0.75 + 0.3,
    flames: calm ? 0 : budget.flames,
    // Small enough that the figure shows through its own fire: the char is what is being watched.
    flameSize: (0.36 + height * 0.26) * (input.held && !calm ? HELD_FLAME : 1),
    flame: flameColour(input.source, input.army),
    flameHeat: flameColour(input.source, input.army) ? SPELL_FLAME_HEAT : 0,
    ember: emberColour(input.source, input.army),
    smoke: SOOT,
    flicker: !calm,
    seed: input.seed >>> 0,
  };
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * How far the char has spread from the point of impact, `t` seconds after ignition, in world units. It
 * catches slowly and then runs; once `spread` is up the whole figure is charred, weapons and all.
 */
export function charFront(plan: BurnPlan, t: number): number {
  if (t <= 0) return 0;
  if (t >= plan.spread) return CHAR_FULL;
  return IGNITE_RADIUS + (plan.reach - IGNITE_RADIUS) * Math.pow(clamp01(t / plan.spread), 1.5);
}

/** When the front reaches a point `distance` from the point of impact: {@link charFront} read the other way. */
export function frontTime(plan: BurnPlan, distance: number): number {
  if (distance <= IGNITE_RADIUS) return 0;
  return plan.spread * Math.pow(clamp01((distance - IGNITE_RADIUS) / (plan.reach - IGNITE_RADIUS)), 1 / 1.5);
}

/**
 * How hot the embers in the cracks are: full while the body burns, cooling to a dull glow over the
 * smoulder. `sinceLanding` is negative until the body is down.
 */
export function charHeat(plan: BurnPlan, t: number, sinceLanding: number): number {
  const lit = clamp01(t / 0.25);
  if (sinceLanding <= 0) return lit;
  return lit * (EMBER_FLOOR + (1 - EMBER_FLOOR) * Math.exp(-sinceLanding / Math.max(0.2, plan.smoulder * 0.8)));
}
/** What the embers cool to while the husk lies there. */
export const EMBER_FLOOR = 0.35;

/** How large the flames stand: they grow as they catch, and sink to a lick once the body is down. */
export function flameLevel(plan: BurnPlan, sinceLit: number, sinceLanding: number): number {
  if (sinceLit <= 0) return 0;
  const grown = 0.45 + 0.55 * clamp01(sinceLit / 0.5);
  if (sinceLanding <= 0) return grown;
  return grown * Math.max(0, 0.55 - 0.5 * clamp01(sinceLanding / Math.max(0.2, plan.smoulder)));
}

export interface FlameSeat {
  /** Index into the points given. */
  index: number;
  /** Seconds after ignition at which the front reaches it and it lights. */
  at: number;
}

interface Point { x: number; y: number; z: number }
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** How much a higher bone is preferred for a flame, per world unit of height. */
const RISE_BIAS = 0.12;

/**
 * Which of a figure's bones (or stand-in points) carry a flame, and when each lights. The first is the one
 * nearest the point of impact; each next one is the point furthest from those already chosen, so a handful
 * of flames covers the body from head to foot (between two equally far, the higher: fire climbs, and a
 * burning head reads). They light in the order the front reaches them.
 */
export function flameSeats(plan: BurnPlan, points: readonly Point[], origin: Point): FlameSeat[] {
  const count = Math.min(plan.flames, points.length);
  if (count <= 0) return [];
  const gap = points.map(point => distance(point, origin));
  let next = 0;
  for (let i = 1; i < points.length; i++) if (gap[i] < gap[next]) next = i;
  const chosen: number[] = [];
  const nearest = points.map(() => Infinity);
  for (let n = 0; n < count; n++) {
    chosen.push(next);
    let best = -1;
    for (let i = 0; i < points.length; i++) {
      nearest[i] = Math.min(nearest[i], distance(points[i], points[next]));
      if (!chosen.includes(i) && (best < 0 || nearest[i] + points[i].y * RISE_BIAS > nearest[best] + points[best].y * RISE_BIAS)) best = i;
    }
    if (best < 0) break;
    next = best;
  }
  return chosen.map(index => ({ index, at: frontTime(plan, gap[index]) })).sort((a, b) => a.at - b.at || a.index - b.index);
}

export interface Lurch {
  /** Offset from the middle of the square, in squares, across and along the board. */
  x: number;
  z: number;
  /** Turn about the vertical and lean forward (positive) or back, in radians. */
  yaw: number;
  tilt: number;
}

/**
 * The stagger laid over whatever the skeleton is doing while the figure burns on its feet: it reels off its
 * mark and back, twists and doubles over. Nothing at ignition and nothing at the collapse, so the body goes
 * down where it stood, over its burn mark. Never further than {@link LURCH_REACH} from the middle.
 */
export function lurchAt(plan: BurnPlan, t: number, out: Lurch = { x: 0, z: 0, yaw: 0, tilt: 0 }): Lurch {
  out.x = 0; out.z = 0; out.yaw = 0; out.tilt = 0;
  if (plan.flail <= 0 || t <= 0 || t >= plan.flail) return out;
  const random = mulberry32(plan.seed ^ 0x5bd1e995);
  const p = t / plan.flail;
  // In fast, out late: it is thrown off balance at once and only gathers itself to fall.
  const envelope = Math.sin(Math.PI * Math.pow(p, 0.7));
  const a = random() * Math.PI * 2, b = random() * Math.PI * 2, c = random() * Math.PI * 2, d = random() * Math.PI * 2;
  const side = random() < 0.5 ? -1 : 1;
  const reach = LURCH_REACH / Math.SQRT2;
  out.x = reach * envelope * Math.sin(t * 4.1 + a) * side;
  out.z = reach * envelope * Math.sin(t * 3.3 + b);
  out.yaw = 0.55 * envelope * Math.sin(t * 5.2 + c);
  out.tilt = 0.24 * envelope * Math.sin(t * 6.4 + d);
  return out;
}

/** How much larger the flames on a body carried burning stand. */
export const HELD_FLAME = 1.3;
/** Seconds a body set alight in a grip jerks in it as the fire bites, before it hangs still. */
export const HELD_WRITHE = 1.4;

/** The moments at which a body burning in a grip jerks in it: the flail's jolts, over {@link HELD_WRITHE}. None when calm. */
export function heldJolts(plan: BurnPlan): number[] {
  return plan.variant === "calm" ? [] : flinchTimes({ ...plan, flail: HELD_WRITHE });
}

/** The moments in the flail at which the body is jolted again, as the fire bites: seconds after ignition. */
export function flinchTimes(plan: BurnPlan): number[] {
  const times: number[] = [];
  if (plan.flail <= 0) return times;
  const random = mulberry32(plan.seed ^ 0x2545f491);
  for (let t = 0.12 + random() * 0.1; t < plan.flail - 0.15; t += 0.24 + random() * 0.16) times.push(t);
  return times;
}

/** The staggers a figure with the Pawn clip library reels through while it burns, in order. */
export const FLAIL_CLIPS = ["hit.stagger-heavy", "hit.head", "hit.stagger-light", "hit.recoil"] as const;
/** How a burning figure goes down, best first: its knees give, or it pitches forward. */
export const COLLAPSE_CLIPS = ["death.collapse", "death.forward"] as const;

/**
 * The stagger clips to chain, each with when it starts, for a rig that carries them (every kingdom's Pawn).
 * `length` gives a clip's seconds, or 0 when the rig has no such clip; the chain stops when the flail is
 * filled. A rig with none gets an empty list and staggers on {@link lurchAt} and {@link flinchTimes} alone.
 */
export function flailClips(plan: BurnPlan, length: (id: string) => number): { id: string; at: number }[] {
  const chain: { id: string; at: number }[] = [];
  let at = 0;
  for (const id of FLAIL_CLIPS) {
    const seconds = length(id);
    if (seconds <= 0 || at >= plan.flail - 0.2) continue;
    chain.push({ id, at });
    // The next stagger cuts in before this one has recovered: the figure never finds its feet.
    at += seconds * 0.8;
  }
  return chain;
}

/** The death clip a burning figure falls on, or null for the rig's own. */
export function collapseClip(has: (id: string) => boolean): string | null {
  return COLLAPSE_CLIPS.find(id => has(id)) ?? null;
}

/** The Minimal death: a short flash, and the body fades where it stands. */
export interface FadePlan {
  /** Size of the flash, in the units of the scene's flashes (0: none). */
  flash: number;
  /** Seconds the flash lasts, and the body takes to fade. */
  flashSeconds: number;
  fade: number;
}

export function planFade(reducedMotion: boolean): FadePlan {
  return reducedMotion ? { flash: 0, flashSeconds: 0, fade: 0.3 } : { flash: 1.6, flashSeconds: 0.14, fade: 0.5 };
}

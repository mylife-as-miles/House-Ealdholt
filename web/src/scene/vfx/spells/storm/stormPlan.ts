// Adapted from LinearAbiltyCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The Storm bolt, as a timeline: what Kwind-09's arc is doing at each moment, how large it is and what it is drawn
 * with. No Three.js in here, so the node tests reach it (shared/play/spell-storm.test.ts); storm/storm.ts draws
 * what this decides.
 *
 * The reference (Storm Lance) draws nine filaments out behind a front, re-rolls all of them twenty-four times a
 * second for 0.45 s and fades. Ours is one discharge with the order a real one has:
 *
 *   gather    arcs crackle round the hand and a knot of light tightens there; one faint feeler stabs out toward
 *             the victim in steps, and over the victim a leader starts down out of the air
 *   front     the strike front leaves the hand and draws the bundle of filaments out behind it
 *   strike    the front and the leader meet on the victim (`strikeAt`): the return stroke goes up the leader's
 *             channel far brighter than anything before it, the charge runs out across the stone in arcs
 *   hold      the bundle gutters and re-strikes: its heaviest filament keeps the channel it burnt for a few
 *             strikes and only then finds a new one, while the thin ones round it are new every time
 *   blow-out  one last surge, the fan flies open, the filaments break into dashes and let go from the hand
 *   after     the burnt channel hangs as a dull trail that lifts and thins, sparks skitter out, smoke stands
 *             where it earthed
 *
 * The brief form is for fast play and reduced motion: the bundle is there whole and steady, it does not strobe,
 * nothing comes down out of the air, and nothing shakes.
 */
import type { QualityPreset } from "../../../quality";
import { smooth, type Point } from "../../mystic/beamPlan";
import { dice, hash1 } from "../shared/ribbonPlan";
import { strikeTimeline, type StrikeTimeline } from "../shared/lightningPlan";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export interface StormBudget {
  /** Filaments in the bundle; the first is the channel. */
  filaments: number;
  /** Cuts along each filament. */
  segments: number;
  /** Sparks shed along the bolt and thrown where it lands. */
  sparks: number;
  /** Halvings of the leader's channel: it has 2^levels + 1 points. */
  levels: number;
  /** Forks off the leader. */
  forks: number;
  /** Arcs crackling round the hand. */
  crackle: number;
  /** Arcs the charge runs out across the stone in. */
  earth: number;
  /** Puffs of smoke where it earthed: the one layer that is matter, not light. */
  smoke: number;
  /** Leaders that come down on the victim. A Queen's bolt calls two. */
  strikes: number;
}

/** What a Bishop's bolt is drawn with at each tier. The lowest has no bloom: the halo pass carries its glow. */
export const STORM_BUDGET: Readonly<Record<QualityPreset, StormBudget>> = {
  low: { filaments: 3, segments: 48, sparks: 28, levels: 4, forks: 2, crackle: 2, earth: 2, smoke: 6, strikes: 1 },
  medium: { filaments: 5, segments: 72, sparks: 64, levels: 5, forks: 3, crackle: 3, earth: 3, smoke: 10, strikes: 1 },
  high: { filaments: 7, segments: 96, sparks: 110, levels: 5, forks: 4, crackle: 4, earth: 4, smoke: 14, strikes: 1 },
  ultra: { filaments: 9, segments: 128, sparks: 160, levels: 5, forks: 5, crackle: 5, earth: 6, smoke: 18, strikes: 1 },
};

/** From this power up a cast has a Queen's extras: a second leader, more forks, more arcs across the stone. */
export const QUEEN_POWER = 1.4;

/** What a bolt of `power` is drawn with. */
export function stormCounts(quality: QualityPreset, power: number): StormBudget {
  const base = STORM_BUDGET[quality], more = clamp01((power - 1) / 0.75), queen = power >= QUEEN_POWER;
  return {
    filaments: base.filaments + Math.round(2 * more), segments: base.segments, sparks: Math.round(base.sparks * (1 + 0.6 * more)), levels: base.levels,
    forks: base.forks + (queen ? 2 : 0), crackle: base.crackle + (queen ? 1 : 0), earth: base.earth + (queen ? 2 : 0), smoke: Math.round(base.smoke * (1 + 0.4 * more)),
    strikes: queen ? 2 : 1,
  };
}

export interface StormSize {
  /** Half a filament's width, in board units. */
  filament: number;
  /** How far the outermost filament stands off the axis at the middle of the cast. */
  fan: number;
  /** How far a kink throws a filament. */
  kink: number;
  /** The radius of the knot at the hand, and of the shell of lit air where it lands. */
  knot: number;
  shell: number;
  /** Half the leader's width, and how high above the stone it starts. */
  leader: number;
  height: number;
  /** How far the charge runs out across the stone. */
  earth: number;
}

/** How large a bolt of `power` is, in board units where a square is `tile` across. */
export function stormSize(power: number, tile = 1.02): StormSize {
  const girth = Math.max(0.5, power) ** 0.6, unit = tile / 1.02;
  return {
    filament: 0.017 * girth * unit, fan: 0.17 * girth * unit, kink: 0.15 * girth * unit, knot: 0.26 * girth * unit, shell: 0.6 * girth * unit,
    leader: 0.026 * girth * unit, height: (4.6 + 1.6 * clamp01((power - 1) / 0.75)) * unit, earth: Math.min(1.7, 1.05 * girth) * unit,
  };
}

/** Board units a second the strike front travels at. */
export const STORM_SPEED = 70;
/** Re-strikes a second, and how many the channel is kept for. */
export const STORM_RATE = 24;
export const STORM_KEEP = 4;

export interface StormTimeline {
  /** The strike front leaves the hand. Everything before it is the gather. */
  front: number;
  /** The front reaches the victim and the leader connects. */
  strikeAt: number;
  /** The blow-out begins. */
  blow: number;
  /** The bundle has let go. */
  out: number;
  /** Nothing is left. */
  total: number;
  brief: boolean;
}

/** The timeline of a cast `distance` board units long. */
export function stormTimeline(distance: number, power: number, brief = false): StormTimeline {
  if (brief) return { front: 0.1, strikeAt: 0.4, blow: 0.9, out: 1.15, total: 1.6, brief: true };
  const more = clamp01((power - 1) / 0.75);
  const front = 0.42 + 0.06 * more;
  const strikeAt = front + clamp(distance / STORM_SPEED, 0.05, 0.14);
  const blow = strikeAt + 0.45 + 0.15 * more;
  const out = blow + 0.2;
  return { front: +front.toFixed(3), strikeAt: +strikeAt.toFixed(3), blow: +blow.toFixed(3), out: +out.toFixed(3), total: +(out + 0.9).toFixed(3), brief: false };
}

/** The leader that comes down on the victim: when it leaves, when it connects, and its strokes. */
export function stormStrike(timeline: StormTimeline, seed: number, power: number, which = 0): StrikeTimeline {
  // a second leader lands a beat after the first, with fewer strokes
  const late = which === 0 ? 0 : 0.11;
  return strikeTimeline(seed + which * 977, {
    leaderStart: timeline.front - 0.2 + late, connect: timeline.strikeAt + late, steps: 6,
    restrikes: which === 0 ? (power >= QUEEN_POWER ? 4 : 3) : 2, gap: 0.085, afterglow: 0.42,
  });
}

/**
 * How bright the bundle is on the re-strike clock: a stroke, then dimmer gutterings down the same channel, then a
 * new stroke. It is quantised: lightning stutters between brightnesses, it does not breathe.
 */
export function stormFlicker(seed: number, clock: number, rate = STORM_RATE, keep = STORM_KEEP): { tick: number; bright: number } {
  const at = Math.max(0, clock) * rate, tick = Math.floor(at), within = at - tick, since = tick % keep;
  const peak = since === 0 ? 1.05 + 0.25 * hash1(seed + tick * 3.77) : (0.5 + 0.35 * hash1(seed + tick * 3.77)) * 0.85 ** since;
  // each tick decays a little before the next snaps in
  return { tick, bright: peak * (1 - 0.3 * within) };
}

export interface StormState {
  /** The knot of light at the hand, and the arcs crackling round it, 0..1 and a little over. */
  knot: number;
  crackle: number;
  /** How far the faint feeler has stabbed out toward the victim, 0..1, and how bright it is. */
  feeler: number;
  feelerGlow: number;
  /** How far the strike front has come, and how much of the hand's end has let go, 0..1 along the bolt. */
  reach: number;
  tail: number;
  /** The bundle's brightness, with its stutter. */
  power: number;
  /** The re-strike it is on. */
  tick: number;
  /** How wide the fan stands against its size at rest, and how far the filaments have broken into dashes, 0..1. */
  spread: number;
  breakup: number;
  /** The burnt channel left hanging: its brightness 0..1, and how far it has lifted, in board units. */
  trail: number;
  drift: number;
  /** The shell of lit air where it lands, 0 and up. */
  shell: number;
  /** Seconds since the blow and since the blow-out began; -1 before each. */
  sinceStrike: number;
  sinceBlow: number;
  /** The smoke where it earthed, 0..1. */
  smoke: number;
  struck: boolean;
  done: boolean;
  /** Camera shake, 0 for none; the light it throws, where 1 is the bolt at rest; and where: 0 the hand, 1 the victim. */
  shake: number;
  light: number;
  lightAt: number;
}

/** What the bolt is doing `seconds` after the cast. */
export function stormState(timeline: StormTimeline, seconds: number, power = 1, seed = 0): StormState {
  const { front, strikeAt, blow, out, total, brief } = timeline;
  const struck = seconds >= strikeAt, sinceStrike = struck ? seconds - strikeAt : -1, sinceBlow = seconds >= blow ? seconds - blow : -1;
  const done = seconds >= total;
  if (brief) {
    // one steady swell and ebb: the bundle is whole from the start, on one shape, and nothing travels or strobes
    const swell = smooth(0, strikeAt, seconds) * (1 - smooth(blow, out, seconds));
    const after = 1 - smooth(out, total, seconds);
    return {
      knot: 0.6 * swell, crackle: 0, feeler: 1, feelerGlow: 0, reach: 1, tail: 0, power: 0.5 * swell, tick: 0, spread: 1, breakup: 0,
      trail: 0.5 * smooth(blow, out, seconds) * after, drift: 0.08 * smooth(out, total, seconds), shell: 0.4 * swell * smooth(strikeAt - 0.2, strikeAt + 0.2, seconds),
      sinceStrike, sinceBlow: -1, smoke: 0.6 * smooth(strikeAt, strikeAt + 0.4, seconds) * after, struck, done, shake: 0, light: done ? 0 : 0.7 * swell, lightAt: smooth(0, strikeAt, seconds),
    };
  }
  const gathered = smooth(0, front, seconds);
  const reach = seconds < front ? 0 : clamp01((seconds - front) / (strikeAt - front));
  // the re-strike clock starts on the blow, so the blow is always a stroke, down the channel the front drew
  const flicker = stormFlicker(seed, seconds - strikeAt);
  const blowing = sinceBlow < 0 ? 0 : clamp01(sinceBlow / (out - blow));
  // the blow: sharp, and gone in under a tenth of a second; the surge that opens the blow-out is a smaller one
  const hit = struck ? Math.exp(-sinceStrike / 0.07) : 0;
  const surge = sinceBlow < 0 ? 0 : Math.exp(-sinceBlow / 0.06);
  const lit = seconds >= front && seconds < out;
  // the feeler stabs out in five steps during the gather, each a pause and a jump
  const probe = clamp01((seconds - 0.1) / Math.max(1e-6, front - 0.14)), step = probe * 5, jump = clamp01((step - Math.floor(step) - 0.6) / 0.4);
  const after = sinceBlow < 0 ? 0 : clamp01((seconds - blow) / (total - blow));
  return {
    knot: seconds < front ? gathered * (0.8 + 0.2 * hash1(Math.floor(seconds * 30) + seed)) : lit ? (0.9 + 0.5 * hit + 0.5 * surge) * (1 - blowing) : 0,
    crackle: seconds < front ? smooth(0.03, 0.2, seconds) : lit ? 1 - blowing : 0,
    feeler: seconds >= front ? 1 : probe >= 1 ? 1 : (Math.floor(step) + jump * jump * (3 - 2 * jump)) / 5,
    feelerGlow: seconds < front ? 0.5 * smooth(0.1, 0.16, seconds) : 0,
    reach, tail: blowing ** 1.5,
    power: lit ? (seconds < strikeAt ? 0.85 : flicker.bright * (1 + 0.8 * hit) + 1.1 * surge) * (1 - 0.6 * blowing) : 0,
    // after the bundle has let go the trail keeps the last channel it burnt
    tick: seconds < out ? flicker.tick : stormFlicker(seed, out - strikeAt - 1e-4).tick,
    spread: 1 + 0.25 * hit + 2.4 * blowing * blowing, breakup: blowing,
    trail: sinceBlow < 0 ? 0 : smooth(0, 0.12, sinceBlow) * (1 - after) ** 1.6, drift: sinceBlow < 0 ? 0 : 0.42 * after,
    shell: struck ? (0.35 * (lit ? flicker.bright : 0) + 1.2 * hit + 0.7 * surge) * (1 - blowing) : 0,
    sinceStrike, sinceBlow, smoke: struck ? smooth(strikeAt, strikeAt + 0.25, seconds) * (1 - smooth(total - 0.5, total, seconds)) : 0,
    struck, done,
    shake: done ? 0 : Math.min(0.8, 0.5 * Math.sqrt(power) * hit + 0.22 * surge + (lit && struck ? 0.03 : 0)),
    light: done ? 0 : seconds < front ? 0.6 * gathered : seconds < strikeAt ? 1.4 : lit ? flicker.bright * (1 - 0.5 * blowing) + 4 * hit + 1.5 * surge : 0.3 * (1 - after),
    lightAt: seconds < front ? 0 : struck ? 1 : reach,
  };
}

/**
 * Where a leader starts: high over the victim and off to one side, so it comes down on a slant and is never a
 * plumb line. `which` is the leader's number; a second one comes from the other side.
 */
export function stormSky(stone: Point, seed: number, power: number, tile = 1.02, which = 0): Point {
  const random = dice(seed ^ (0x2f1d + which * 7919));
  const turn = random() * Math.PI * 2 + which * Math.PI * (0.8 + 0.4 * random()), out = (0.7 + 0.8 * random()) * tile;
  return { x: stone.x + Math.cos(turn) * out, y: stone.y + stormSize(power, tile).height * (0.9 + 0.2 * random()), z: stone.z + Math.sin(turn) * out };
}

/**
 * Where the charge runs out to across the stone: `count` points round the victim's square, on a stride that never
 * makes a regular star, at uneven distances.
 */
export function stormEarth(stone: Point, seed: number, count: number, reach: number): Point[] {
  const random = dice(seed ^ 0x77e1), first = random() * Math.PI * 2, out: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    // the golden angle: every new arc falls in the widest gap the others have left
    const turn = first + i * 2.39996323 + (random() - 0.5) * 0.5, far = reach * (0.55 + 0.45 * random());
    out.push({ x: stone.x + Math.cos(turn) * far, y: stone.y, z: stone.z + Math.sin(turn) * far });
  }
  return out;
}

export interface StormSparks {
  /** Per spark: where on the bolt it is shed (0..1), when (seconds from the cast), how long it lives, how fast it leaves. */
  birth: Float32Array;
  /** Per spark: the way it is thrown, a unit vector. */
  away: Float32Array;
}

/**
 * The sparks of one cast: shed along the bolt from the moment the front passes, thrown hard where it lands on the
 * blow and on each stroke after it, and showered from the whole length when it blows out.
 */
export function stormSparks(seed: number, count: number, timeline: StormTimeline, strokes: readonly number[]): StormSparks {
  const random = dice(seed ^ 0x1b873593), birth = new Float32Array(count * 4), away = new Float32Array(count * 3);
  const { front, strikeAt, blow, brief } = timeline;
  for (let i = 0; i < count; i += 1) {
    const kind = random(), turn = random() * Math.PI * 2;
    let u: number, when: number, lift: number, speed: number;
    if (brief) {
      // a few slow ones off the landing, and no more
      u = 1; when = i % 3 === 0 ? strikeAt + random() * 0.4 : -1; lift = 0.3 + 0.5 * random(); speed = 0.6 + 0.5 * random();
    } else if (kind < 0.4) {
      // thrown out low across the stone where it lands, on the blow or on a stroke after it
      u = 1; when = strokes[Math.floor(random() * random() * strokes.length)] + random() * 0.03; lift = 0.1 + 0.8 * random() * random(); speed = 2.2 + 3.4 * random();
    } else if (kind < 0.8) {
      // shed along the bolt while it stands
      u = 0.06 + 0.9 * random(); when = front + u * (strikeAt - front) + random() * (blow - strikeAt); lift = -0.2 + 1.1 * random(); speed = 0.9 + 1.8 * random();
    } else {
      // the shower when it blows out
      u = 0.05 + 0.95 * random(); when = blow + random() * 0.09; lift = -0.3 + 1.2 * random(); speed = 1.6 + 2.8 * random();
    }
    const flat = Math.sqrt(Math.max(0, 1 - lift * lift));
    birth[i * 4] = u; birth[i * 4 + 1] = when; birth[i * 4 + 2] = 0.35 + 0.55 * random(); birth[i * 4 + 3] = speed;
    away[i * 3] = Math.cos(turn) * flat; away[i * 3 + 1] = lift; away[i * 3 + 2] = Math.sin(turn) * flat;
  }
  return { birth, away };
}

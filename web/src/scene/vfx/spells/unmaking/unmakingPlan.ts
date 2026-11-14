// Adapted from SoldierThirdPersonThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The Unmaking, as arithmetic: Korvenia's Bishop and Queen write a rune under the victim and something comes up
 * through it. No Three.js in here, so the node tests reach it (shared/play/spell-unmaking.test.ts);
 * unmaking/unmaking.ts draws what this decides.
 *
 * One clock, in order:
 *
 *   write    the caster's hand writes a small ring of gilt script in the air, and the rune under the victim is
 *            written in step with it by a pen that leaves the side facing the caster; the rune irises out as it is
 *            written and turns
 *   beat     the rune is whole and stops turning; the stone inside it goes dark. Nothing moves
 *   inhale   the last third of a second of the beat: everything is drawn in. Grit and dust slide inward over the
 *            stone, the rune tightens, its light runs inward from the rim and goes out
 *   strike   the void column comes up through the rune (`strikeAt`), at half its height in three frames, fat at
 *            its foot; a ring is thrown across the stone and sparks go up with it
 *   hold     the column stands, breathing; gilt cords race up it, grains of light climb it, and the rune's own
 *            script lifts off the stone glyph by glyph and is carried up the column, unwritten as it rises; dark
 *            flakes of what is being unmade climb with it. The match's own death burns the body in the column's
 *            violet: the Unmaking builds to the blow and hands over to it, it does not do the death itself
 *   close    the column narrows to a thread and the thread is drawn down into the rune; the cords are flung off
 *   cool     the rune takes the last of the light, its ink burns out from the rim inward and its strokes cool from
 *            gilt to red to dark in a charred disc; embers lift off it and smoke rises
 *
 * From the reference's Unmaking (its RunicBeam and SummonSeal): a seal written by a pen before anything comes,
 * a beat, an open tube lit down its axis with matter falling through it, a head and a foot and a ragged crown,
 * helical cords widened across the screen, and grains that climb on loops of their own so nothing is re-emitted.
 * Ours: the caster's hand writes in step with the rune; the beat ends in an inhale, so the column is anticipated
 * before it comes; the rune's script is what rises up the column; the column has a sheath of dark round its light;
 * it ends by being drawn back down into the rune, not by fading; it leaves a charred disc and cooling strokes; and
 * reduced motion has its own gentler form.
 */
import type { QualityPreset } from "../../../quality";
import { smooth, type Point } from "../../mystic/beamPlan";
import { PARTICLE_KIND, byPower, scatter, sequence, type Particle } from "../shared/particlePlan";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const round = (value: number) => +value.toFixed(3);
const TAU = Math.PI * 2;

export interface UnmakingBudget {
  /** Gilt cords wound round the column, and the cuts along each. */
  cords: number;
  segments: number;
  /** Four-pointed grains of light climbing the column. */
  grains: number;
  /** Glyphs of the rune's script that lift off the stone and are carried up. At most {@link RUNE_CELLS}. */
  glyphs: number;
  /** Sparks, glints and embers: the pen, the inhale, the blow, the close. */
  sparks: number;
  /** Puffs of dust drawn in over the stone and thrown up the column, and the smoke off the char. */
  dust: number;
  /** Dark flakes that climb the column while it stands: the one layer of it that is matter. */
  ash: number;
  /** Faces round the column. */
  radial: number;
}

/** What a Bishop's Unmaking is drawn with at each tier; a Queen's has more. The lowest has no bloom: halos carry the glow. */
export const UNMAKING_BUDGET: Readonly<Record<QualityPreset, UnmakingBudget>> = {
  low: { cords: 2, segments: 48, grains: 28, glyphs: 10, sparks: 30, dust: 8, ash: 12, radial: 24 },
  medium: { cords: 3, segments: 64, grains: 64, glyphs: 14, sparks: 60, dust: 14, ash: 26, radial: 32 },
  high: { cords: 3, segments: 96, grains: 110, glyphs: 20, sparks: 96, dust: 20, ash: 40, radial: 40 },
  ultra: { cords: 4, segments: 128, grains: 160, glyphs: 20, sparks: 130, dust: 26, ash: 56, radial: 48 },
};

/** From this power up a cast has a Queen's extras: a second ring on the stone, a binding ring round the victim, two more cords. */
export const QUEEN_POWER = 1.4;

/** What an Unmaking of `power` is drawn with. */
export function unmakingCounts(quality: QualityPreset, power: number): UnmakingBudget {
  const base = UNMAKING_BUDGET[quality], queen = power >= QUEEN_POWER;
  return {
    cords: base.cords + (queen ? 2 : 0), segments: base.segments, grains: byPower(base.grains, power), glyphs: Math.min(RUNE_CELLS, base.glyphs + (queen ? 4 : 0)),
    sparks: byPower(base.sparks, power), dust: byPower(base.dust, power), ash: byPower(base.ash, power), radial: base.radial,
  };
}

/** The cells round the rune's band of script: the same twenty as the kit's rune ring. */
export const RUNE_CELLS = 20;
/** The middle of that band, as a share of the rune's radius: where a glyph sits before it lifts. */
export const GLYPH_RING = 0.7225;

export interface UnmakingSize {
  /** The rune on the stone. */
  rune: number;
  /** The column's radius, and how high it stands before its crown is lost. */
  column: number;
  height: number;
  /** How far the cords stand off the column's axis. */
  cord: number;
  /** Half a glyph, and half a grain. */
  glyph: number;
  grain: number;
  /** The ring of script under the hand. */
  hand: number;
  /** How far the ring thrown at the blow runs over the stone. */
  shock: number;
  /** The Queen's binding ring round the victim: its radius at rest. */
  bind: number;
  /** How high the column's foot thins once it has come, so the body it unmakes is seen (UnmakingState.clear). */
  clear: number;
}

/**
 * How large an Unmaking of `power` is, in board units where a square is `tile` across. A Bishop's rune fits the
 * victim's square; a Queen's spills over it. The column stands about twice a figure's height and is wide enough
 * to hold one.
 */
export function unmakingSize(power: number, tile = 1.02): UnmakingSize {
  const more = clamp01((power - 1) / 0.75), unit = tile / 1.02, rune = mix(0.5, 0.68, more) * tile;
  return {
    rune, column: mix(0.32, 0.42, more) * unit, height: mix(3.4, 4.5, more) * unit, cord: mix(0.37, 0.5, more) * unit,
    glyph: rune * 0.125, grain: mix(0.034, 0.042, more) * unit, hand: 0.17 * unit, shock: rune * mix(2.4, 2.8, more), bind: mix(0.42, 0.52, more) * unit,
    clear: 1.5 * unit,
  };
}

export interface UnmakingTimeline {
  /** The pens write the ring under the hand and the rune under the victim. */
  write: readonly [number, number];
  /** The held beat: from the rune whole to the blow. */
  beat: readonly [number, number];
  /** The end of the beat, in which everything is drawn in. */
  inhale: readonly [number, number];
  /** The column comes up through the rune. */
  strikeAt: number;
  /** Seconds the column takes to stand at its full height. */
  rise: number;
  /** The column narrows and is drawn down into the rune. */
  close: readonly [number, number];
  duration: number;
  brief: boolean;
}

/**
 * The timeline of a cast. It does not depend on how far away the caster stands: the rune is written where the
 * victim is. A Queen's beat is a little longer and her column stands longer. The brief form (reduced motion, fast
 * play) brings the rune up whole and the column up softly: nothing is drawn in and nothing erupts.
 */
export function unmakingTimeline(power: number, brief: boolean): UnmakingTimeline {
  if (brief) return { write: [0, 0.4], beat: [0.4, 0.75], inhale: [0.75, 0.75], strikeAt: 0.75, rise: 0.6, close: [1.65, 2.15], duration: 2.6, brief: true };
  const more = clamp01((power - 1) / 0.75), strikeAt = round(1.3 + 0.1 * more), hold = 1.15 + 0.3 * more;
  const close: [number, number] = [round(strikeAt + hold), round(strikeAt + hold + 0.45)];
  return { write: [0.06, 0.62], beat: [0.62, strikeAt], inhale: [round(strikeAt - 0.32), strikeAt], strikeAt, rise: 0.22, close, duration: round(close[1] + 0.95), brief: false };
}

/** A spring past its mark and back: 0 at 0, 1 at 1, about 1.08 at its height. */
function outBack(t: number): number {
  const u = clamp01(t) - 1, back = 1.4;
  return 1 + (back + 1) * u * u * u + back * u * u;
}

/**
 * How far round the rune has turned `seconds` into the cast, in radians. It turns as it is written, slows to a
 * stop once it is whole and holds still through the beat; the blow ratchets it on, and it turns slowly back the
 * other way while the column stands. In the brief form it turns slowly and evenly throughout.
 */
export function runeTurn(timeline: UnmakingTimeline, seconds: number): number {
  const s = Math.max(0, seconds);
  if (timeline.brief) return 0.15 * s;
  const [w0, w1] = timeline.write, rate = 0.9, settle = 0.35;
  let angle = rate * clamp(s - w0, 0, w1 - w0);
  if (s > w1) { const u = Math.min(s - w1, settle); angle += rate * (u - (u * u) / (2 * settle)); }
  if (s > timeline.strikeAt) { const since = s - timeline.strikeAt; angle += 0.2 * outBack(since / 0.14) - 0.4 * since; }
  return angle;
}

export interface UnmakingState {
  /** The light in the caster's hand, and how much of the ring under it its pen has written, 0..1. */
  hand: number;
  handDrawn: number;
  /** How much of the rune its pen has written, 0..1, and a factor on its radius: it irises out, tightens, and kicks. */
  drawn: number;
  scale: number;
  /** How brightly the rune's ink burns: about 0.8 written, out in the inhale, white at the blow. */
  ink: number;
  /** How far round the rune has turned, radians. */
  turn: number;
  /** How dark the stone inside the rune is, 0..1: the void before the blow, the char after it. */
  dark: number;
  /** How far the inhale has come, 0..1; 0 again from the blow. */
  inhale: number;
  /** How far up its height the column stands, 0..1; it sinks back to 0 as it closes. */
  reach: number;
  /** A factor on the column's radius: fat as it erupts, breathing as it stands, narrowing to a thread. */
  girth: number;
  /** The column's brightness, 0 and up: about 1 standing, more on the blow. */
  column: number;
  /**
   * How far the column's foot has thinned, 0..1: narrower, dimmer and without its sheath of dark up to UnmakingSize.clear,
   * so the body burning in it is seen. It comes up whole through the rune; once it has stood a moment it lets the body be seen.
   */
  clear: number;
  /** The cords' brightness, and how far they are flung off as it closes, 0..1. */
  cords: number;
  fling: number;
  /** The grains' brightness, 0..1. */
  grains: number;
  /** How far the column has closed, 0..1. */
  closing: number;
  /** Seconds since the blow, and since the column was swallowed by the rune; -1 before each. */
  sinceStrike: number;
  sinceSwallow: number;
  /** The flash of the blow, 0..1, gone in a quarter of a second. Never in the brief form. */
  flash: number;
  /** How far the rune's ink has burnt out from its rim inward, 0..1, and how cold what is left is, 0..1. */
  burnt: number;
  cold: number;
  struck: boolean;
  done: boolean;
  /** Camera shake, 0 in the brief form. */
  shake: number;
  /** The light it throws, about 1 standing and several at the blow; and where it is, 0 on the stone to 1 at the chest. */
  light: number;
  lightAt: number;
}

/** What the spell is doing `seconds` after the cast. */
export function unmakingState(timeline: UnmakingTimeline, seconds: number, power = 1): UnmakingState {
  const { write, beat, inhale: [i0, i1], strikeAt, rise, close: [c0, c1], duration, brief } = timeline;
  const struck = seconds >= strikeAt, since = struck ? seconds - strikeAt : -1, done = seconds >= duration;
  const sinceSwallow = seconds >= c1 ? seconds - c1 : -1;
  const closing = clamp01((seconds - c0) / (c1 - c0)), turn = runeTurn(timeline, seconds);
  if (brief) {
    // one slow swell: the rune is there whole, the column rises at a walk and sinks the same way
    const shown = smooth(0, write[1], seconds), gone = smooth(c1, duration, seconds);
    const reach = smooth(strikeAt - 0.4, strikeAt + 0.3, seconds) * (1 - smooth(c0, c1, seconds));
    return {
      hand: 0.7 * smooth(0, 0.3, seconds) * (1 - smooth(strikeAt - 0.2, strikeAt + 0.3, seconds)), handDrawn: 1, drawn: 1, scale: 1,
      ink: done ? 0 : 0.6 * shown * (1 - 0.5 * gone), turn, dark: done ? 0 : 0.35 * smooth(beat[0], c0, seconds) * (1 - gone), inhale: 0,
      reach, girth: 0.9, column: 0.6 * smooth(strikeAt - 0.4, strikeAt + 0.2, seconds) * (1 - smooth(c0, c1, seconds)), clear: struck ? smooth(0.15, 0.45, since) : 0,
      cords: 0.7 * reach, fling: 0, grains: 0.7 * reach, closing, sinceStrike: since, sinceSwallow, flash: 0,
      burnt: smooth(c1, duration - 0.1, seconds), cold: gone, struck, done, shake: 0,
      light: done ? 0 : 0.35 * shown * (1 - gone) + 0.7 * reach, lightAt: smooth(strikeAt - 0.4, strikeAt + 0.2, seconds),
    };
  }
  const written = clamp01((seconds - write[0]) / (write[1] - write[0]));
  const inhale = struck ? 0 : smooth(i0, i1, seconds);
  const flash = struck ? Math.exp(-since / 0.1) : 0;
  const swallow = sinceSwallow >= 0 ? Math.exp(-sinceSwallow / 0.14) : 0;
  // out of the stone at speed and slowing as it arrives: half its height in the first tenth of its rise
  const erupted = struck ? (since >= rise ? 1 : (1 - 2 ** (-10 * (since / rise))) / (1 - 2 ** -10)) : 0;
  // drawn down into the rune: slowly at first, then fast into the stone
  const sunk = closing * closing;
  const standing = struck && seconds < c0 ? 1 : 0;
  const breathe = Math.sin(since * 9) * standing;
  const burnt = smooth(c1 - 0.05, c1 + 0.55, seconds), cold = smooth(c1 + 0.1, duration - 0.1, seconds);
  return {
    hand: smooth(0, 0.22, seconds) * (0.8 + 0.2 * inhale) * (1 - smooth(strikeAt - 0.12, strikeAt + 0.06, seconds)),
    handDrawn: smooth(write[0], write[1], seconds), drawn: smooth(write[0], write[1], seconds),
    scale: (seconds < write[0] ? 0.62 : 0.62 + 0.38 * outBack(written)) * (1 - 0.1 * inhale * inhale) * (1 + 0.08 * flash),
    ink: done ? 0 : seconds < write[0] ? 0 : struck
      ? (0.85 + 0.9 * flash + 0.08 * breathe) * (1 - burnt) + 0.9 * swallow
      : (0.72 + 0.18 * smooth(beat[0], i0, seconds)) * (1 - 0.82 * inhale),
    turn,
    dark: done ? 0 : struck ? (0.6 + 0.15 * smooth(c0, c1, seconds)) * (1 - smooth(duration - 0.45, duration, seconds)) : 0.5 * smooth(beat[0], i1, seconds) + 0.25 * inhale,
    inhale,
    reach: erupted * (1 - sunk),
    girth: struck ? (seconds < c0 ? 1 + 0.45 * (1 - clamp01(since / rise)) ** 2 + 0.05 * breathe : 1 - 0.9 * smooth(0, 0.75, closing)) : 0,
    column: struck ? (1 + 0.25 * flash) * (1 - smooth(0.55, 1, closing)) : 0,
    clear: struck ? smooth(0.15, 0.45, since) : 0,
    cords: struck ? smooth(0, 0.12, since) * (1 - smooth(0.1, 0.75, closing)) : 0, fling: closing,
    grains: struck ? smooth(0.02, 0.25, since) * (1 - smooth(0.25, 0.95, closing)) : 0,
    closing, sinceStrike: since, sinceSwallow, flash, burnt, cold, struck, done,
    shake: done ? 0 : Math.min(1, struck ? 0.55 * (0.7 + 0.3 * power) * Math.exp(-since / 0.18) + (seconds < c0 ? 0.035 : 0) + 0.12 * swallow : 0.03 * inhale),
    light: done ? 0 : struck
      ? (1.5 + 0.15 * breathe) * (1 - smooth(0.4, 1, closing)) * (seconds < c1 ? 1 : 0) + 3.4 * flash + 1.2 * swallow + 0.25 * (1 - cold) * (1 - burnt * 0.5) * (seconds >= c1 ? 1 : 0)
      : 0.45 * smooth(0, 0.3, seconds) + 0.35 * smooth(write[0], write[1], seconds) * (1 - 0.7 * inhale),
    lightAt: struck && seconds < c1 ? 1 : 0,
  };
}

/** The angle, about the stone, of the side of the rune facing the caster: where its pen starts. */
export function penStart(cast: { stone: Point; hand: Point }): number {
  return Math.atan2(cast.hand.z - cast.stone.z, cast.hand.x - cast.stone.x);
}

/**
 * When each cell of the rune's script lifts off the stone, in seconds after the blow, or -1 for a cell that stays
 * written. `glyphs` cells lift, spread evenly round the ring and in a seeded order, all within the first
 * three quarters of a second of the column standing.
 */
export function glyphPeels(seed: number, glyphs: number): number[] {
  const count = clamp(Math.round(glyphs), 0, RUNE_CELLS), dice = sequence(seed ^ 0x9e11), peels = new Array<number>(RUNE_CELLS).fill(-1);
  const order = Array.from({ length: count }, (_, i) => i);
  // a seeded shuffle of the moments, so the script comes away in no readable order
  for (let i = order.length - 1; i > 0; i -= 1) { const j = Math.floor(dice() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (let i = 0; i < count; i += 1) {
    const cell = Math.floor(((i + 0.5) * RUNE_CELLS) / Math.max(1, count)) % RUNE_CELLS;
    peels[cell] = round(0.04 + (0.7 * order[i]) / Math.max(1, count - 1) + 0.03 * dice());
  }
  return peels;
}

/** Seconds a glyph takes from lifting off the stone to being lost at the column's crown. */
export const GLYPH_CLIMB = 1.1;

export interface GlyphFlight {
  /** Its bearing about the column's axis, its distance from it and its height above the stone. */
  angle: number;
  radius: number;
  height: number;
  /** A factor on its size, and how much of its script is left, 0..1: it is unwritten stroke by stroke as it climbs. */
  scale: number;
  ink: number;
}

/**
 * Where a lifted glyph is `age` seconds after it left the stone at bearing `start`. It peels up off the stone,
 * is pulled in to the column and climbs it in a loose spiral, faster as it goes, shrinking, and its strokes are
 * taken one by one until nothing of it is left near the crown. The vertex shader evaluates the same path.
 */
export function glyphFlight(size: UnmakingSize, start: number, age: number): GlyphFlight {
  const u = clamp01(age / GLYPH_CLIMB);
  return {
    angle: start + 2.6 * u * u + 0.9 * u,
    radius: mix(size.rune * GLYPH_RING, size.column * 1.08, smooth(0, 0.42, u)),
    height: 0.02 + size.height * 0.8 * u ** 1.5 + 0.12 * smooth(0, 0.12, u),
    scale: (0.75 + 0.25 * smooth(0, 0.1, u)) * (1 - 0.5 * u),
    ink: age <= 0 ? 1 : 1 - smooth(0.35, 0.95, u),
  };
}

/** A grain of light's loop, in turns of its own clock: it climbs, opens outward and is gone at the top, and climbs again. */
export function grainLoop(seconds: number, rate: number, phase: number): number {
  const at = Math.max(0, seconds) * rate + phase;
  return at - Math.floor(at);
}

export interface UnmakingCast {
  stone: Point;
  /** Where the hand is when the cast is made: anchored particles are placed relative to it. */
  hand: Point;
  timeline: UnmakingTimeline;
  size: UnmakingSize;
  counts: UnmakingBudget;
  power: number;
  seed: number;
  tile: number;
}

export interface UnmakingParticles {
  /** Glints, sparks, motes, embers and the drawn glow: added light. */
  light: Particle[];
  /** Dust, ash and smoke: it covers what is behind it. */
  matter: Particle[];
}

/**
 * Everything loose in a cast, with its birth times, written once. Particles marked `anchored` are placed relative
 * to the caster's hand and follow it.
 */
export function unmakingParticles(cast: UnmakingCast): UnmakingParticles {
  const { stone, timeline, size, counts, power, tile } = cast, dice = sequence(cast.seed ^ 0x0a11), unit = tile / 1.02, brief = timeline.brief;
  const { strikeAt, write, inhale, close, duration } = timeline, zero = { x: 0, y: 0, z: 0 };
  const light: Particle[] = [], matter: Particle[] = [];
  const sparks = counts.sparks, start = penStart(cast);
  const around = (angle: number, radius: number, lift: number) => ({ x: stone.x + Math.cos(angle) * radius, y: stone.y + lift, z: stone.z + Math.sin(angle) * radius });

  // the hand: a glow, a small light in it, and motes drawn in to it while it writes
  light.push({ kind: PARTICLE_KIND.halo, origin: zero, velocity: zero, birth: 0, life: strikeAt + 0.06, size: 0.32 * unit, tone: 0.55, anchored: true, fadeIn: 0.3 });
  light.push({ kind: PARTICLE_KIND.mote, origin: zero, velocity: zero, birth: 0.04, life: strikeAt, size: 0.08 * unit, tone: 0.9, anchored: true, fadeIn: 0.4 });
  if (!brief) {
    for (let i = 0; i < Math.round(sparks * 0.1); i += 1) {
      const from = scatter(dice), far = (0.28 + 0.18 * dice()) * unit, pull = 7;
      // its launch speed is exactly what the air lets it spend on the way to the hand
      light.push({ kind: PARTICLE_KIND.glint, origin: { x: from.x * far, y: from.y * far, z: from.z * far }, velocity: { x: -from.x * far * pull, y: -from.y * far * pull, z: -from.z * far * pull }, birth: dice() * (strikeAt - 0.45), life: 0.34, size: 0.03 * unit, drag: pull, tone: 0.75, anchored: true, fadeIn: 0.3 });
    }
    // the pen: sparks off its nib as it cuts the rune into the stone
    for (let i = 0; i < Math.round(sparks * 0.16); i += 1) {
      const share = dice(), birth = write[0] + share * (write[1] - write[0]), angle = start + share * TAU + runeTurn(timeline, birth), way = scatter(dice, 0.3, 0.95), speed = 0.35 + 0.8 * dice();
      light.push({ kind: i % 2 === 0 ? PARTICLE_KIND.streak : PARTICLE_KIND.glint, origin: around(angle, size.rune * (0.62 + 0.38 * share), 0.02), velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth, life: 0.22 + 0.25 * dice(), size: (0.012 + 0.01 * dice()) * unit, drag: 1, gravity: 3, tone: 0.75 + 0.25 * dice() });
    }
    // the inhale: grit on the stone streaks in to the middle, and dies as the column comes
    for (let i = 0; i < Math.round(sparks * 0.3); i += 1) {
      const angle = dice() * TAU, far = size.rune * (1.05 + 1.2 * dice()), birth = inhale[0] - 0.14 + dice() * (inhale[1] - inhale[0] - 0.04), age = strikeAt - birth;
      const pull = -Math.log(0.06) / Math.max(0.1, age);
      light.push({ kind: PARTICLE_KIND.streak, origin: around(angle, far, 0.03), velocity: { x: -Math.cos(angle) * far * pull, y: 0, z: -Math.sin(angle) * far * pull }, birth, life: age + 0.01, size: (0.015 + 0.012 * dice()) * unit, drag: pull, tone: 0.5 + 0.4 * dice(), fadeIn: 0.25 });
    }
    for (let i = 0; i < Math.round(counts.dust * 0.4); i += 1) {
      const angle = dice() * TAU, far = size.rune * (1.2 + 0.9 * dice()), birth = inhale[0] - 0.2 + 0.15 * dice(), age = strikeAt - birth + 0.04;
      const pull = -Math.log(0.15) / age;
      matter.push({ kind: PARTICLE_KIND.puff, origin: around(angle, far, 0.06 * unit), velocity: { x: -Math.cos(angle) * far * pull, y: 0, z: -Math.sin(angle) * far * pull }, birth, life: age, size: (0.14 + 0.08 * dice()) * unit, drag: pull, tone: 0.3 + 0.3 * dice(), grow: 0.7, fadeIn: 0.3 });
    }
  }

  // the blow: a flash at the foot of the column, sparks thrown up with it, dust thrown up the column
  const foot = { x: stone.x, y: stone.y + 0.35 * unit, z: stone.z };
  // the air round the column, lit violet: drawn, because the lowest tier has no bloom to make it
  light.push({ kind: PARTICLE_KIND.halo, origin: { x: stone.x, y: stone.y + 0.9 * unit, z: stone.z }, velocity: zero, birth: brief ? strikeAt - 0.3 : strikeAt, life: close[1] - strikeAt + (brief ? 0.3 : 0), size: size.column * 4.2, tone: 0.06, fadeIn: brief ? 0.35 : 0.05 });
  if (!brief) {
    light.push({ kind: PARTICLE_KIND.halo, origin: foot, velocity: zero, birth: strikeAt, life: 0.3, size: size.rune * 2.6, tone: 0.4, fadeIn: 0.08 });
    light.push({ kind: PARTICLE_KIND.mote, origin: foot, velocity: zero, birth: strikeAt, life: 0.18, size: 0.32 * unit, tone: 0.95, fadeIn: 0.1 });
    for (let i = 0; i < Math.round(sparks * 0.34); i += 1) {
      const way = scatter(dice, 0.35, 0.98), speed = (2.4 + 3.8 * dice()) * unit * (0.85 + 0.15 * power), angle = Math.atan2(way.z, way.x);
      light.push({ kind: PARTICLE_KIND.streak, origin: around(angle, size.column * (0.6 + 0.5 * dice()), 0.05), velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: strikeAt + 0.03 * dice(), life: 0.35 + 0.45 * dice(), size: (0.014 + 0.01 * dice()) * unit, drag: 1.3, gravity: 6.5, tone: 0.7 + 0.3 * dice() });
    }
  }
  for (let i = 0; i < Math.round(counts.dust * (brief ? 0.3 : 0.6)); i += 1) {
    const angle = dice() * TAU, out = size.column * (0.4 + 0.8 * dice()), rise = brief ? 0.25 : (1.3 + 1.6 * dice()) * unit;
    matter.push({ kind: PARTICLE_KIND.puff, origin: around(angle, out, 0.1 * unit), velocity: { x: Math.cos(angle) * (brief ? 0.05 : 0.5), y: rise, z: Math.sin(angle) * (brief ? 0.05 : 0.5) }, birth: (brief ? strikeAt - 0.3 : strikeAt) + 0.06 * dice(), life: 1.1 + 0.7 * dice(), size: (0.16 + 0.1 * dice()) * unit, drag: 1.8, gravity: -0.4, tone: 0.2 + 0.4 * dice(), grow: 2.4, fadeIn: 0.15, wander: 0.08 });
  }

  // the hold: dark flakes of what is being unmade climb the column with the light
  const hold = Math.max(0.2, close[0] - strikeAt);
  for (let i = 0; i < counts.ash; i += 1) {
    const angle = dice() * TAU, out = size.column * 0.85 * Math.sqrt(dice()), birth = strikeAt + 0.04 + hold * dice() ** 1.3;
    matter.push({
      kind: i % 3 === 0 ? PARTICLE_KIND.mote : PARTICLE_KIND.streak, origin: around(angle, out, (0.15 + 1.5 * dice()) * unit),
      velocity: { x: Math.cos(angle + 1.2) * 0.25, y: (brief ? 0.35 : 0.8 + 1.4 * dice()) * unit, z: Math.sin(angle + 1.2) * 0.25 },
      birth, life: 0.8 + 0.8 * dice(), size: (0.01 + 0.012 * dice()) * unit, drag: 0.7, gravity: -0.9, tone: 0.15 + 0.35 * dice(), wander: 0.07, fadeIn: 0.15,
    });
  }

  // the close: a breath of glints as the thread is swallowed, then embers off the burning strokes, the rim's first
  if (!brief) for (let i = 0; i < Math.round(sparks * 0.08); i += 1) {
    const way = scatter(dice, 0.15, 0.9), speed = 0.6 + 1.2 * dice();
    light.push({ kind: PARTICLE_KIND.glint, origin: { x: stone.x, y: stone.y + 0.05, z: stone.z }, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: close[1] + 0.02 * dice(), life: 0.45 + 0.35 * dice(), size: 0.03 * unit, drag: 2.2, gravity: 1.2, tone: 0.8 });
  }
  for (let i = 0; i < Math.round(sparks * 0.18); i += 1) {
    const r = 0.55 + 0.43 * dice(), angle = dice() * TAU;
    light.push({ kind: PARTICLE_KIND.mote, origin: around(angle, size.rune * r, 0.02), velocity: { x: 0, y: (brief ? 0.1 : 0.15 + 0.3 * dice()) * unit, z: 0 }, birth: close[1] + (1 - r) * 1.1 + 0.08 * dice(), life: 0.8 + 0.6 * dice(), size: (0.012 + 0.01 * dice()) * unit, drag: 1.2, gravity: -0.4, tone: 0.55 + 0.35 * dice(), wander: 0.05, fadeIn: 0.1 });
  }
  for (let i = 0; i < Math.round(counts.dust * 0.4); i += 1) {
    const angle = dice() * TAU, out = size.rune * 0.8 * Math.sqrt(dice());
    matter.push({ kind: PARTICLE_KIND.puff, origin: around(angle, out, 0.08 * unit), velocity: { x: (dice() - 0.5) * 0.2, y: (0.25 + 0.3 * dice()) * unit, z: (dice() - 0.5) * 0.2 }, birth: close[1] + 0.5 * dice(), life: 1.2 + 0.6 * dice(), size: (0.15 + 0.08 * dice()) * unit, drag: 0.8, gravity: -0.3, tone: 0.1 + 0.3 * dice(), grow: 2.6, fadeIn: 0.25, wander: 0.15 });
  }
  // nothing outlives the spell, and nothing is born in its last moment
  const within = (list: Particle[]) => list.filter((particle) => particle.birth < duration - 0.06).map((particle) => ({ ...particle, life: Math.min(particle.life, duration - particle.birth) }));
  return { light: within(light), matter: within(matter) };
}

/** Where along its height a cord has been drawn, 0..1: it races up just behind the column's head. */
export function cordHead(reach: number, since: number): number {
  return since < 0 ? 0 : Math.min(reach, clamp01((since - 0.015) / 0.2) ** 0.6);
}

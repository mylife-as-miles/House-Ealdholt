// Adapted from LinearAbiltyCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The Glacial crown, as arithmetic: Aethelgard's Bishop and Queen send a cold front to the victim, freeze the stone
 * under it, raise a crown of ice blades round it and shatter it. No Three.js in here, so the node tests reach it
 * (shared/play/spell-glacial-crown.test.ts); glacial/glacialCrown.ts draws what this decides.
 *
 * One clock, in order:
 *
 *   gather   cold gathers in the caster's hand and is thrown down at its feet
 *   front    a cold front races along the stone to the victim's square, frost behind it and vapour rolling off it
 *   freeze   the disc round the victim freezes outward from its feet, in plates with rime in their seams
 *   crown    a ring of blades tears up round the victim: the blade nearest the caster first, the wave running round
 *            both sides to meet behind; each blade crystallises upward in jumps, as fast freezing does, and a skirt
 *            of shards banks up against their feet
 *   strike   as the crown closes (`strikeAt`), two to four blades thrust up out of the frozen disc at a slant and
 *            run the victim through, in at the belly and out of the back or a shoulder; the air inside the crown
 *            freezes. The piece is not burnt: it dies on the blades (vfx/spells/spell.ts `pierce`) and the match
 *            draws the wounds this reports through its gore system
 *   hold     the crown stands glinting with the body held up on it (`pinned`); blood runs down the blades and soaks
 *            into the ice under it; at Full the blades twist in the body and it bleeds again; cold vapour spills off
 *            the rim, snow falls inside; near the end the blades creak, their cracks lighting
 *   shatter  the blades in the body break first and let it fall; then from where the crown closed, back round to the
 *            near side, each blade loses its plates one after another and they skid and melt on the stone
 *   thaw     the sheet draws back toward the middle and leaves the stone wet, then dry
 *
 * From the reference's Glacial Crown: a front to a point, a disc that freezes out to its boundary, a ring of blades
 * seated in a band with the middle left open, leaning outward and fanned off their own radius so they cross, an
 * uneven crest from two harmonics of the bearing, the sweep that starts on the near side and closes behind, a skirt
 * against the feet, glass carried by its edges rather than milky stone, a freeze front up each blade and a shatter
 * by plates. Ours: the blades grow in jumps; the crown's closing is the blow, and its blades run the piece through
 * (shared/piercePlan.ts); it is one crown round one figure on one square; the shatter runs back from where it closed
 * and leaves loose plates on the stone instead of sinking into it; the sheet leaves wet stone; and reduced motion has
 * its own form. At Minimal the thrusting blades close round the body instead of entering it, and nothing bleeds.
 */
import type { QualityPreset } from "../../../quality";
import { smooth, type Point } from "../../mystic/beamPlan";
import { PARTICLE_KIND, byPower, scatter, sequence, type Particle } from "../shared/particlePlan";
import { bloodOf, bloodReachesStone, crownThrusts, leanOf, pierceWounds, torsoFrame, twistWounds, type PierceLine, type PierceWound, type Violence } from "../shared/piercePlan";
import type { Solid } from "../shared/solidPlan";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const round = (value: number) => +value.toFixed(3);
const TAU = Math.PI * 2;

export interface GlacialBudget {
  /** Blades in the ring, and shards in the skirt against their feet. */
  ring: number;
  skirt: number;
  /** Cuts the blades are shared between: one draw each. */
  cuts: number;
  /** Loose plates the shatter throws down. */
  plates: number;
  /** Glints, chips and snow. */
  sparks: number;
  /** Puffs of vapour and mist: the matter that covers. */
  mist: number;
  /** Blades that thrust up through the victim at the blow. */
  impalers: number;
}

/** What a Bishop's Glacial crown is drawn with at each tier; a Queen's has more blades and more of the rest. */
export const GLACIAL_BUDGET: Readonly<Record<QualityPreset, GlacialBudget>> = {
  low: { ring: 10, skirt: 4, cuts: 1, plates: 10, sparks: 50, mist: 10, impalers: 2 },
  medium: { ring: 16, skirt: 8, cuts: 2, plates: 20, sparks: 110, mist: 18, impalers: 2 },
  high: { ring: 22, skirt: 12, cuts: 3, plates: 32, sparks: 190, mist: 28, impalers: 3 },
  ultra: { ring: 28, skirt: 16, cuts: 3, plates: 44, sparks: 280, mist: 38, impalers: 3 },
};

/** From this power up a cast has a Queen's extras: a wider, taller crown with more blades. */
export const QUEEN_POWER = 1.4;

/** What a Glacial crown of `power` is drawn with. */
export function glacialCounts(quality: QualityPreset, power: number): GlacialBudget {
  const base = GLACIAL_BUDGET[quality], queen = power >= QUEEN_POWER;
  return {
    ring: base.ring + (queen ? 6 : 0), skirt: base.skirt + (queen ? 4 : 0), cuts: base.cuts, plates: byPower(base.plates, power), sparks: byPower(base.sparks, power), mist: byPower(base.mist, power),
    impalers: Math.min(4, base.impalers + (queen ? 1 : 0)),
  };
}

export interface GlacialSize {
  /** Where the blades are seated round the victim, and how far the frozen sheet reaches. */
  seat: number;
  sheet: number;
  /** A blade: its height before the crest's waves, its radius at the foot. */
  blade: number;
  girth: number;
  /** How far the blades lean outward and are fanned off their own radius, radians. */
  lean: number;
  fan: number;
  /** The front's half-width at the caster's feet and at the crown. */
  near: number;
  far: number;
}

/**
 * How large a Glacial crown of `power` is, in board units where a square is `tile` across. A Bishop's blades are
 * seated inside the victim's square; a Queen's crown is wider and taller and spills over it. The crown stands about as
 * high as the victim's chest, its crest uneven, so the body run through on the impalers stands up out of it and is
 * seen: their points, and the blood on them, are above the blades round it.
 */
export function glacialSize(power: number, tile = 1.02): GlacialSize {
  const more = clamp01((power - 1) / 0.75), unit = tile / 1.02;
  return {
    seat: mix(0.42, 0.58, more) * tile, sheet: mix(0.78, 1.0, more) * tile, blade: mix(0.6, 0.72, more) * unit, girth: mix(0.064, 0.076, more) * unit,
    lean: 0.36, fan: 0.55, near: 0.07 * tile, far: mix(0.16, 0.2, more) * tile,
  };
}

/** The front's line on the stone: from in front of the caster's feet to the near side of the crown. */
export interface GlacialLine {
  from: Point;
  to: Point;
  length: number;
  /** The bearing about the stone of the side facing the caster: where the crown starts to close. */
  entry: number;
}

/** The line a cast from `hand` to `stone` runs: half a square out from under the hand to the crown's seat. */
export function glacialLine(hand: Point, stone: Point, seat: number, tile: number): GlacialLine {
  const dx = stone.x - hand.x, dz = stone.z - hand.z, reach = Math.hypot(dx, dz);
  const ax = reach > 1e-5 ? dx / reach : 0, az = reach > 1e-5 ? dz / reach : -1, lead = Math.min(0.5 * tile, 0.3 * reach), stop = Math.max(lead, reach - seat);
  const from = { x: hand.x + ax * lead, y: stone.y, z: hand.z + az * lead }, to = { x: hand.x + ax * stop, y: stone.y, z: hand.z + az * stop };
  return { from, to, length: Math.hypot(to.x - from.x, to.z - from.z), entry: Math.atan2(-az, -ax) };
}

export interface GlacialTimeline {
  /** Cold gathers in the hand. */
  gather: readonly [number, number];
  /** The front runs from the caster's feet to the crown. */
  front: readonly [number, number];
  /** The sheet freezes out from the victim's feet. */
  freeze: readonly [number, number];
  /** The crown's wave runs round from the near side to the far. */
  crown: readonly [number, number];
  strikeAt: number;
  /** At Full, the moment the blades in the body twist in it, and it bleeds again. */
  twist: number;
  /** The shatter runs back round, and the last plate has fallen. The blades in the body break first, and let it go. */
  shatter: readonly [number, number];
  /** The sheet draws back, and is gone. */
  thaw: readonly [number, number];
  duration: number;
  brief: boolean;
}

/** Board units a second the front runs at, and seconds a blade takes to crystallise. */
export const FRONT_SPEED = 13;
export const BLADE_RISE = 0.17;
/** Seconds the wave takes to run round the ring, and the shatter to run back. */
export const SWEEP_TIME = 0.4;
export const BREAK_SWEEP = 0.45;
/** Seconds one blade takes to lose all its plates. */
export const BREAK_TIME = 0.38;
/**
 * Seconds the crown holds the body up on its blades before the shatter starts (a Queen's a little longer): long enough
 * for the match's shot to come in close and stay on the wound while its blood runs.
 */
export const GLACIAL_HOLD = 1.7;

/**
 * The timeline of a cast whose front runs `length` board units. A longer front arrives later, within limits. A
 * Queen's crown stands longer. The brief form (reduced motion, fast play) has no front: the sheet frosts in place
 * and the blades rise together, slowly, and melt away instead of shattering.
 */
export function glacialTimeline(length: number, power: number, brief: boolean): GlacialTimeline {
  if (brief) return { gather: [0, 0.2], front: [0.2, 0.2], freeze: [0.1, 0.6], crown: [0.3, 0.3], strikeAt: 0.95, twist: 1.45, shatter: [1.9, 2.4], thaw: [2.0, 2.7], duration: 2.8, brief: true };
  const more = clamp01((power - 1) / 0.75), gather = 0.38, arrive = round(gather + clamp(length / FRONT_SPEED, 0.2, 0.62));
  const crown: [number, number] = [round(arrive + 0.06), round(arrive + 0.06 + SWEEP_TIME)], strikeAt = round(crown[1] + BLADE_RISE);
  const breaking = round(strikeAt + GLACIAL_HOLD + 0.3 * more), broken = round(breaking + BREAK_SWEEP + BREAK_TIME + 0.05);
  return {
    gather: [0, gather], front: [gather, arrive], freeze: [arrive, round(arrive + 0.24)], crown, strikeAt, twist: round(strikeAt + 0.5), shatter: [breaking, broken],
    thaw: [round(breaking + 0.25), round(broken + 0.95)], duration: round(broken + 1.05), brief: false,
  };
}

/** Steps a blade crystallises in, in the full form. */
export const GROWTH_STEPS = 4;

/**
 * How far up its own height a blade has frozen, 0..1, `age` seconds after it began: in jumps, holding between them,
 * as fast freezing does. With no steps (the brief form) it eases up smoothly. The vertex shader evaluates the same.
 */
export function bladeGrowth(age: number, rise: number, steps: number): number {
  if (age <= 0) return 0;
  const u = clamp01(age / Math.max(0.02, rise));
  if (steps < 1) return u * u * (3 - 2 * u);
  const at = u * steps, whole = Math.floor(at), part = at - whole;
  return Math.min(1, (whole + smooth(0.55, 1, part)) / steps);
}

/** Seconds an impaler takes to thrust its whole length up out of the stone. */
export const THRUST_RISE = 0.13;

/**
 * How much of its length an impaler has thrust up out of the stone, 0..1, `age` seconds after it began: a punch,
 * fastest as it leaves the stone and slowing as it runs on through; in the brief form it eases up and stops. The
 * vertex shader evaluates the same.
 */
export function bladeThrust(age: number, rise: number, brief: boolean): number {
  if (age <= 0) return 0;
  const u = clamp01(age / Math.max(0.02, rise));
  return brief ? u * u * (3 - 2 * u) : 1 - (1 - u) ** 3;
}

/** Seconds after it began until an impaler has thrust `share` of its length out of the stone: the inverse of bladeThrust. */
export function thrustTime(share: number, rise: number, brief: boolean): number {
  const s = clamp01(share);
  const u = brief ? 0.5 - Math.sin(Math.asin(1 - 2 * s) / 3) : 1 - (1 - s) ** (1 / 3);
  return u * Math.max(0.02, rise);
}

/** The signed angle from `b` to `a`, -π..π. */
export function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export interface GlacialState {
  /** The cold in the hand, 0..1. */
  hand: number;
  /** How far the front has run, 0 at the caster's feet to 1 at the crown. */
  front: number;
  /** How far the sheet has frozen out, 0..1 of its reach, and how much frost there is on the front's line, 0..1. */
  freeze: number;
  frost: number;
  /** True from the moment the crown closes. */
  struck: boolean;
  sinceStrike: number;
  /** True while the blades hold the body up on them: from the blow until the shatter starts. */
  pinned: boolean;
  /** The flash freeze inside the crown, 0..1, gone in a third of a second. Never in the brief form. */
  flash: number;
  /** How white the air and the sheet inside the crown have gone, 0..1. */
  rime: number;
  /** How far the sheet has thawed back, 0..1, and how wet the stone it left is, 0..1. */
  thaw: number;
  wet: number;
  /** Camera shake, 0 in the brief form. */
  shake: number;
  /** The light it throws, and where: 0 the hand, 1 the front's head, 2 the crown. */
  light: number;
  lightAt: number;
  done: boolean;
}

/** What the spell is doing `seconds` after the cast. At Full the blades twist in the body during the hold, a jolt. */
export function glacialState(timeline: GlacialTimeline, seconds: number, power = 1, violence: Violence = "cinematic"): GlacialState {
  const { gather, front, freeze, crown, strikeAt, shatter, thaw, duration, brief } = timeline;
  const struck = seconds >= strikeAt, since = struck ? seconds - strikeAt : -1, done = seconds >= duration, pinned = struck && seconds < shatter[0];
  const thawed = smooth(thaw[0], thaw[1], seconds), ending = smooth(duration - 0.4, duration, seconds);
  const wet = done ? 0 : smooth(thaw[0] + 0.15, thaw[1], seconds) * (1 - ending);
  if (brief) {
    const frozen = smooth(freeze[0], freeze[1], seconds);
    return {
      hand: 0.6 * smooth(0, 0.2, seconds) * (1 - smooth(0.4, 0.8, seconds)), front: 1, freeze: frozen, frost: 0, struck, sinceStrike: since, pinned, flash: 0,
      rime: 0.5 * smooth(strikeAt - 0.4, strikeAt + 0.3, seconds) * (1 - thawed), thaw: thawed, wet, shake: 0,
      light: done ? 0 : (0.4 * frozen + 0.5 * smooth(0.3, strikeAt, seconds)) * (1 - thawed), lightAt: 2, done,
    };
  }
  const run = clamp01((seconds - front[0]) / (front[1] - front[0]));
  const flash = struck ? Math.exp(-since / 0.12) : 0;
  const standing = struck && seconds < shatter[0];
  // the twist at Full: a jolt, no light
  const twisted = violence === "full" && seconds >= timeline.twist ? 0.2 * Math.exp(-(seconds - timeline.twist) / 0.1) : 0;
  const closing = seconds >= crown[0] && !struck ? smooth(crown[0], strikeAt, seconds) : 0;
  return {
    hand: smooth(0, gather[1] * 0.7, seconds) * (1 - smooth(gather[1], gather[1] + 0.15, seconds)),
    // the sheet stays frozen out to its reach: its thaw draws it back inward, which the drawing does by `thaw`
    front: seconds < front[0] ? 0 : run ** 1.4, freeze: smooth(freeze[0], freeze[1], seconds), frost: seconds < front[0] ? 0 : 1 - thawed,
    struck, sinceStrike: since, pinned, flash, rime: struck ? smooth(0, 0.18, since) * (1 - smooth(shatter[0], shatter[1], seconds)) : 0,
    thaw: thawed, wet,
    shake: done ? 0 : Math.min(1, (struck ? 0.42 * (0.7 + 0.3 * power) * Math.exp(-since / 0.16) : 0) + twisted + 0.06 * closing + (seconds >= shatter[0] && seconds < shatter[1] ? 0.12 : 0) + 0.03 * run * (seconds < front[1] ? 1 : 0)),
    // the blow is a cold snap, not a blast: its light must not hide what the blades have done
    light: done ? 0 : seconds < front[0] ? 0.6 * smooth(0, 0.25, seconds) : seconds < crown[0] ? 0.8 : (0.9 + 0.5 * closing + 2.2 * flash + (standing ? 0.35 : 0)) * (1 - smooth(shatter[0], shatter[1] + 0.3, seconds)) + 0.2 * (1 - ending) * (seconds >= shatter[1] ? 1 : 0),
    lightAt: seconds < front[0] ? 0 : seconds < crown[0] ? 1 : 2,
    done,
  };
}

/** A blade of the crown, with what the drawing needs beyond its shape. */
export interface GlacialBlade {
  /** `ring` stands in the crown; `skirt` is banked against its feet; an `impaler` thrusts up through the victim. */
  role: "ring" | "skirt" | "impaler";
  /** Where it breaks the stone, its foot's radius and its height, the way it leans (radians toward +x and +z) and its yaw. */
  root: Point;
  radius: number;
  height: number;
  lean: { x: number; z: number };
  yaw: number;
  seed: number;
  /** Its bearing about the stone. */
  bearing: number;
  /** Seconds from the cast until it starts to freeze, and how long it takes. */
  birth: number;
  rise: number;
  /** When it starts to break, and how long it takes to lose all its plates. */
  breakAt: number;
  breakTime: number;
  /**
   * An impaler only: it thrusts up its own axis out of the stone (glacialPlan.bladeThrust) instead of freezing up in
   * place, for `birth`..`birth + rise`. Where along it (0..1) it entered and left the body, 0 for both when it rose
   * beside it (Minimal), and the moment its tip came out.
   */
  through?: { entry: number; exit: number; at: number };
}

export interface GlacialCast {
  stone: Point;
  /** The victim's chest: the torso the impalers run through is in proportion to its height (shared/piercePlan.ts). */
  chest: Point;
  line: GlacialLine;
  timeline: GlacialTimeline;
  size: GlacialSize;
  counts: GlacialBudget;
  power: number;
  seed: number;
  tile: number;
  /** The Violence setting: at Minimal the impalers rise beside the body and open nothing. */
  violence: Violence;
}

/** An impaler's radius at its foot: slimmer than a blade of the ring, so it reads as a spike through the body. */
export const impalerRadius = (size: GlacialSize) => size.girth * 0.92;

/** A blade that runs the victim through: its line (shared/piercePlan.ts), and the moment its tip comes out of the body. */
export interface GlacialThrust { line: PierceLine; at: number }

/**
 * The impalers of a cast, `counts.impalers` of them: up out of the frozen disc inside the crown, through the victim's
 * torso and out of its back and shoulders, the first as the crown closes and the rest within a tenth of a second.
 */
export function glacialThrusts(cast: GlacialCast): GlacialThrust[] {
  const { stone, chest, line, timeline, size, counts, seed, violence } = cast;
  const frame = torsoFrame(stone, line.from, chest);
  return crownThrusts(frame, counts.impalers, size.seat * 0.95, seed, violence, impalerRadius(size))
    .map((thrust, i) => ({ line: thrust, at: round(timeline.strikeAt + (timeline.brief ? 0.06 : 0.035) * i) }));
}

/**
 * The blades of a cast, the ring's first and then the skirt's, so a tier that cuts the list keeps the crown. Each
 * ring blade is stepped round the circle with a jittered stride, its height set by two harmonics of its bearing so
 * the crest is uneven, leaning out and fanned off its radius. It freezes as the wave reaches its bearing, and breaks
 * as the shatter comes back round to it.
 */
export function glacialBlades(cast: GlacialCast): GlacialBlade[] {
  const { stone, line, timeline, size, counts, power } = cast, dice = sequence(cast.seed ^ 0x61ac), brief = timeline.brief;
  const blades: GlacialBlade[] = [], phase = dice() * TAU;
  const lean = (bearing: number, by: number) => ({ x: Math.cos(bearing) * by, z: Math.sin(bearing) * by });
  const around = (bearing: number) => Math.abs(angleDelta(bearing, line.entry)) / Math.PI;
  for (let i = 0; i < counts.ring; i += 1) {
    const bearing = ((i + (dice() - 0.5) * 0.7) / counts.ring) * TAU, r = size.seat * (1 + (dice() - 0.5) * 0.22);
    const crest = Math.sin(bearing * 3 + phase) * 0.62 + Math.sin(bearing * 5 - phase * 2.1) * 0.38;
    const height = size.blade * (1 + 0.42 * crest) * (0.8 + 0.4 * dice()) * (brief ? 0.75 : 1);
    const fanned = bearing + (dice() - 0.5) * 2 * size.fan, by = size.lean * (0.6 + 0.8 * dice());
    const way = around(bearing);
    blades.push({
      role: "ring", root: { x: stone.x + Math.cos(bearing) * r, y: stone.y, z: stone.z + Math.sin(bearing) * r }, radius: size.girth * (0.8 + 0.45 * dice()) * (0.9 + 0.1 * power), height,
      lean: lean(fanned, by), yaw: dice() * TAU, seed: dice(), bearing,
      birth: brief ? 0.3 + 0.12 * dice() : timeline.crown[0] + way * SWEEP_TIME + 0.03 * dice(), rise: brief ? 0.6 : BLADE_RISE * (0.85 + 0.3 * dice()),
      breakAt: brief ? timeline.shatter[0] + 0.1 * dice() : timeline.shatter[0] + (1 - way) * BREAK_SWEEP + 0.04 * dice(), breakTime: brief ? 0.4 : BREAK_TIME * (0.8 + 0.2 * dice()),
    });
  }
  for (let i = 0; i < counts.skirt; i += 1) {
    const bearing = dice() * TAU, out = dice() < 0.5 ? -1 : 1, r = size.seat * (1 + out * (0.14 + 0.16 * dice()));
    const height = size.blade * (0.24 + 0.24 * dice()) * (brief ? 0.75 : 1), way = around(bearing);
    blades.push({
      role: "skirt", root: { x: stone.x + Math.cos(bearing) * r, y: stone.y, z: stone.z + Math.sin(bearing) * r }, radius: size.girth * (0.9 + 0.5 * dice()), height,
      lean: lean(bearing + (dice() - 0.5) * 1.2, size.lean * (out > 0 ? 1.3 : 0.8) * (0.6 + 0.8 * dice())), yaw: dice() * TAU, seed: dice(), bearing,
      birth: brief ? 0.4 + 0.15 * dice() : timeline.crown[0] + way * SWEEP_TIME + 0.06 + 0.06 * dice(), rise: brief ? 0.6 : BLADE_RISE * 0.8,
      breakAt: brief ? timeline.shatter[0] + 0.1 * dice() : timeline.shatter[0] + (1 - way) * BREAK_SWEEP - 0.05 + 0.04 * dice(), breakTime: brief ? 0.4 : BREAK_TIME * 0.7,
    });
  }
  // the impalers: each thrust so its tip comes out of the body at its moment, and broken first, to let the body go
  const spare = sequence(cast.seed ^ 0x1f9d), rise = brief ? 0.55 : THRUST_RISE;
  for (const { line: thrust, at } of glacialThrusts(cast)) {
    const out = Math.hypot(thrust.exit.x - thrust.root.x, thrust.exit.y - thrust.root.y, thrust.exit.z - thrust.root.z) / thrust.length;
    blades.push({
      role: "impaler", root: thrust.root, radius: impalerRadius(size), height: thrust.length, lean: leanOf(thrust), yaw: spare() * TAU, seed: spare(),
      bearing: Math.atan2(thrust.root.z - stone.z, thrust.root.x - stone.x), birth: at - thrustTime(out, rise, brief), rise,
      breakAt: timeline.shatter[0] - (brief ? 0.1 : 0.12), breakTime: brief ? 0.4 : 0.24, through: { entry: thrust.entryAt, exit: thrust.exitAt, at },
    });
  }
  return blades;
}

/** One of the wounds a cast opens, and when: the match draws them through its gore system (vfx/spells/spell.ts). */
export interface GlacialWounds { at: number; wounds: PierceWound[] }

/**
 * The wounds of a cast, in order: each impaler's two, where it went in and where it came out, as its tip comes out;
 * and at Full a second burst from every exit as the blades twist in the body (not in the brief form, where nothing
 * jolts). None at Minimal.
 */
export function glacialWounds(cast: GlacialCast, thrusts: readonly GlacialThrust[]): GlacialWounds[] {
  const events = thrusts.map((thrust) => ({ at: thrust.at, wounds: pierceWounds([thrust.line], cast.violence) })).filter((event) => event.wounds.length > 0);
  const twist = cast.timeline.brief ? [] : twistWounds(thrusts.map((thrust) => thrust.line), cast.violence);
  if (twist.length > 0) events.push({ at: cast.timeline.twist, wounds: twist });
  return events;
}

/** Where blood soaks into the sheet: offset from the stone's centre, seconds after the blow it starts, and how far it spreads. */
export interface IceBlood { x: number; z: number; delay: number; size: number }

/**
 * The blood in the ice of a cast, by the Violence setting (none at Minimal): a pool under the body from what drips off
 * it, spreading from just after the blow, and a smaller one at the foot of each impaler once the blood running down
 * it has reached the stone. More, and darker, at Full.
 */
export function glacialBlood(cast: GlacialCast, thrusts: readonly GlacialThrust[]): { amount: number; pools: IceBlood[] } {
  const amount = bloodOf(cast.violence);
  if (amount <= 0) return { amount: 0, pools: [] };
  const { stone, line, timeline } = cast, toward = { x: Math.cos(line.entry), z: Math.sin(line.entry) }, more = amount - 1;
  const pools: IceBlood[] = [{ x: -toward.x * 0.04, z: -toward.z * 0.04, delay: 0.12, size: 0.3 + 0.12 * more }];
  for (const { line: thrust, at } of thrusts) {
    if (thrust.exitAt <= 0) continue;
    pools.push({ x: thrust.root.x - stone.x, z: thrust.root.z - stone.z, delay: round(at - timeline.strikeAt + bloodReachesStone(thrust, amount)), size: 0.075 + 0.04 * more });
  }
  return { amount, pools };
}

/**
 * One blade, as loose triangles wound outward: a blunt wedge rather than a needle, a thick foot narrowing to about a
 * third near its point, so each facet is broad enough to catch a flash. Unit space: the foot lies on y = 0 inside a
 * radius of 0.5 and the point is at y = 1. There is no underside: a blade stands in the stone.
 */
export function bladeGeometry(seed: number, sides = 6): Float32Array {
  const dice = sequence(seed), n = Math.max(4, Math.round(sides));
  const angles = Array.from({ length: n }, (_, i) => ((i + (dice() - 0.5) * 0.4) / n) * TAU);
  const levels = [{ y: 0, r: 0.5, twist: 0 }, { y: 0.45 + 0.1 * dice(), r: 0.38 + 0.06 * dice(), twist: 0.1 }, { y: 0.82 + 0.06 * dice(), r: 0.16 + 0.05 * dice(), twist: 0.22 }];
  const rings = levels.map((level) => angles.map((angle) => {
    const r = level.r * (0.9 + 0.2 * dice()), a = angle + level.twist;
    return [Math.cos(a) * r, level.y, Math.sin(a) * r];
  }));
  const tip = [(dice() - 0.5) * 0.06, 1, (dice() - 0.5) * 0.06], out: number[] = [];
  for (let ring = 0; ring < rings.length - 1; ring += 1) for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n, a = rings[ring][i], b = rings[ring][j], c = rings[ring + 1][i], d = rings[ring + 1][j];
    out.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  const top = rings[rings.length - 1];
  for (let i = 0; i < n; i += 1) out.push(...top[i], ...tip, ...top[(i + 1) % n]);
  return new Float32Array(out);
}

/** The unit axis a blade stands along, from its lean. */
export function bladeAxis(blade: { lean: { x: number; z: number } }): Point {
  const tilt = Math.hypot(blade.lean.x, blade.lean.z);
  if (tilt < 1e-5) return { x: 0, y: 1, z: 0 };
  return { x: (blade.lean.x / tilt) * Math.sin(tilt), y: Math.cos(tilt), z: (blade.lean.z / tilt) * Math.sin(tilt) };
}

/**
 * The loose plates the shatter throws down: two from each impaler first, from below the body and from the tip beyond
 * it, as they break and let it go; then from along each ring blade as it breaks; outward from the victim and down, to
 * skid and melt where they stop. None in the brief form, where the blades melt away.
 */
export function glacialPlates(cast: GlacialCast, blades: readonly GlacialBlade[]): Solid[] {
  if (cast.timeline.brief) return [];
  const dice = sequence(cast.seed ^ 0x9a7e), plates: Solid[] = [], ring = blades.filter((blade) => blade.role === "ring");
  const impalers = blades.filter((blade) => blade.role === "impaler"), first = impalers.length * 2;
  if (ring.length === 0) return plates;
  for (let i = 0; i < cast.counts.plates; i += 1) {
    const blade = i < first ? impalers[i % impalers.length] : ring[(i - first) % ring.length], axis = bladeAxis(blade);
    const through = blade.through, low = dice() < 0.5;
    // never out of the body itself: from the length below where it went in, or the tip beyond where it came out
    const up = through && through.exit > 0 ? (low ? 0.12 + (through.entry - 0.12) * dice() : through.exit + (1 - through.exit) * dice()) : 0.2 + 0.7 * dice(), reach = blade.height * up;
    const from = { x: blade.root.x + axis.x * reach, y: blade.root.y + axis.y * reach, z: blade.root.z + axis.z * reach };
    const away = Math.hypot(from.x - cast.stone.x, from.z - cast.stone.z), out = away > 1e-4 ? { x: (from.x - cast.stone.x) / away, z: (from.z - cast.stone.z) / away } : { x: Math.cos(blade.bearing), z: Math.sin(blade.bearing) };
    const speed = 0.4 + 1.2 * dice(), size = blade.radius * (blade.role === "impaler" ? 0.8 + 0.4 * dice() : 0.55 + 0.35 * dice());
    const birth = blade.breakAt + (0.2 + 0.8 * dice()) * blade.breakTime;
    plates.push({
      loose: true, root: from,
      radius: size, height: size * (1.6 + dice()), lean: { x: 0, z: 0 }, spin: (4 + 8 * dice()) * (dice() < 0.5 ? -1 : 1), yaw: dice() * TAU, seed: dice(),
      birth, rise: 0.5, breakAt: 0, end: Math.min(cast.timeline.duration, birth + 1.1 + 0.6 * dice()),
      fling: { x: (out.x + (dice() - 0.5) * 0.8) * speed, y: 0.3 + 1.2 * dice(), z: (out.z + (dice() - 0.5) * 0.8) * speed },
    });
  }
  return plates;
}

export interface GlacialParticles {
  /** Glints, chips, snow and the drawn glow: added light. */
  light: Particle[];
  /** Vapour and mist: it covers what is behind it. */
  mist: Particle[];
}

/**
 * Everything loose in a cast, with its birth times, written once. `hand` is where the hand is when the cast is made;
 * particles marked `anchored` are placed relative to it and follow it.
 */
export function glacialParticles(cast: GlacialCast, blades: readonly GlacialBlade[], hand: Point): GlacialParticles {
  const { stone, line, timeline, size, counts, power, tile } = cast, dice = sequence(cast.seed ^ 0x3c1d), unit = tile / 1.02, brief = timeline.brief;
  const { gather, front, strikeAt, shatter, duration } = timeline, zero = { x: 0, y: 0, z: 0 };
  const light: Particle[] = [], mist: Particle[] = [], sparks = counts.sparks, puffs = counts.mist;
  const onLine = (along: number, offset: number, lift: number) => {
    const ax = line.to.x - line.from.x, az = line.to.z - line.from.z, l = Math.hypot(ax, az) || 1;
    return { x: line.from.x + ax * along - (az / l) * offset, y: stone.y + lift, z: line.from.z + az * along + (ax / l) * offset };
  };
  const passes = (along: number) => front[0] + along ** (1 / 1.4) * (front[1] - front[0]);

  // the hand: a glow, a cold light in it, glints drawn in, and the cold thrown down at the caster's feet
  light.push({ kind: PARTICLE_KIND.halo, origin: zero, velocity: zero, birth: 0, life: gather[1] + 0.2, size: 0.36 * unit, tone: 0.5, anchored: true, fadeIn: 0.5 });
  light.push({ kind: PARTICLE_KIND.mote, origin: zero, velocity: zero, birth: 0, life: gather[1] + 0.1, size: 0.1 * unit, tone: 0.9, anchored: true, fadeIn: 0.6 });
  if (!brief) {
    for (let i = 0; i < Math.round(sparks * 0.05); i += 1) {
      const from = scatter(dice), far = (0.28 + 0.2 * dice()) * unit, pull = 7;
      light.push({ kind: PARTICLE_KIND.glint, origin: { x: from.x * far, y: from.y * far, z: from.z * far }, velocity: { x: -from.x * far * pull, y: -from.y * far * pull, z: -from.z * far * pull }, birth: dice() * (gather[1] - 0.3), life: 0.32, size: 0.032 * unit, drag: pull, tone: 0.75, anchored: true, fadeIn: 0.3 });
    }
    const fall = 0.12;
    light.push({ kind: PARTICLE_KIND.streak, origin: zero, velocity: { x: (line.from.x - hand.x) / fall, y: (line.from.y - hand.y) / fall, z: (line.from.z - hand.z) / fall }, birth: gather[1] - fall, life: fall + 0.02, size: 0.06 * unit, tone: 1, anchored: true, fadeIn: 0.1 });
    // the front: glints thrown up off its running edge, and vapour rolling off the frost behind it
    for (let i = 0; i < Math.round(sparks * 0.16); i += 1) {
      const along = dice(), at = onLine(along, (dice() - 0.5) * 2 * mix(size.near, size.far, along), 0.03);
      light.push({ kind: i % 3 === 0 ? PARTICLE_KIND.streak : PARTICLE_KIND.glint, origin: at, velocity: { x: (dice() - 0.5) * 0.6, y: 0.4 + 1.2 * dice(), z: (dice() - 0.5) * 0.6 }, birth: passes(along) + 0.02 * dice(), life: 0.4 + 0.5 * dice(), size: (0.022 + 0.02 * dice()) * unit, drag: 2, gravity: 2.2, tone: 0.5 + 0.5 * dice() });
    }
    for (let i = 0; i < Math.round(puffs * 0.25); i += 1) {
      const along = (i + dice()) / Math.max(1, Math.round(puffs * 0.25)), side = dice() < 0.5 ? -1 : 1;
      const ax = line.to.x - line.from.x, az = line.to.z - line.from.z, l = Math.hypot(ax, az) || 1;
      mist.push({ kind: PARTICLE_KIND.puff, origin: onLine(along, 0, 0.08 * unit), velocity: { x: (-az / l) * side * 0.35 + (ax / l) * 0.3, y: 0.04, z: (ax / l) * side * 0.35 + (az / l) * 0.3 }, birth: passes(along) + 0.04 * dice(), life: 1.4 + 0.7 * dice(), size: (0.18 + 0.1 * dice()) * unit, drag: 1.6, tone: 0.45 + 0.45 * dice(), grow: 2.4, fadeIn: 0.2, wander: 0.08 });
    }
  }

  // each blade of the crown throws chips and glints off its tip as it grows (the impalers have their own, below)
  const ring = blades.filter((blade) => blade.role === "ring"), crown = blades.filter((blade) => blade.role !== "impaler");
  const each = Math.max(1, Math.round((sparks * 0.18) / Math.max(1, crown.length)));
  for (const blade of crown) {
    const axis = bladeAxis(blade);
    for (let i = 0; i < each; i += 1) {
      const up = (Math.floor(dice() * 4) + 1) / 4, tip = { x: blade.root.x + axis.x * blade.height * up, y: blade.root.y + axis.y * blade.height * up, z: blade.root.z + axis.z * blade.height * up };
      const way = scatter(dice, 0.1, 1), speed = brief ? 0.15 : 0.6 + 1.4 * dice();
      light.push({ kind: brief || i % 2 === 0 ? PARTICLE_KIND.glint : PARTICLE_KIND.streak, origin: tip, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: blade.birth + blade.rise * up * (brief ? 1 : 0.9), life: 0.35 + 0.4 * dice(), size: (0.016 + 0.016 * dice()) * unit, drag: 2.2, gravity: brief ? 0.2 : 3, tone: 0.6 + 0.4 * dice() });
    }
  }

  // the blow: the disc freezes white under the feet, glints burst out, and the drawn glow of the crown stands. It is
  // a cold snap and not a blast, and kept low: nothing may hide the body on the blades
  const heart = { x: stone.x, y: stone.y + 0.2 * unit, z: stone.z };
  // the crown's own glow, until a moment after it closes: in the hold it would wash out the blood in the ice
  light.push({ kind: PARTICLE_KIND.halo, origin: { x: stone.x, y: stone.y + 0.5 * size.blade, z: stone.z }, velocity: zero, birth: brief ? 0.4 : timeline.crown[0], life: strikeAt + 0.4 - (brief ? 0.4 : timeline.crown[0]), size: size.seat * 2.3, tone: 0.2, fadeIn: brief ? 0.4 : 0.15 });
  if (!brief) {
    light.push({ kind: PARTICLE_KIND.halo, origin: heart, velocity: zero, birth: strikeAt, life: 0.25, size: 0.9 * unit * (0.8 + 0.25 * power), tone: 0.4, fadeIn: 0.08 });
    for (let i = 0; i < Math.round(sparks * 0.1); i += 1) {
      const way = scatter(dice, -0.1, 0.9), speed = (1.6 + 3 * dice()) * unit, out = size.seat * (0.6 + 0.4 * dice());
      light.push({ kind: PARTICLE_KIND.streak, origin: { x: stone.x + way.x * out, y: stone.y + (0.05 + 0.4 * dice()) * unit, z: stone.z + way.z * out }, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: strikeAt + 0.03 * dice(), life: 0.3 + 0.35 * dice(), size: (0.013 + 0.01 * dice()) * unit, drag: 1.4, gravity: 5, tone: 0.75 + 0.25 * dice() });
    }
    // each impaler bursts out of the disc in chips, and its tip comes out of the body in splinters of ice
    for (const blade of blades) {
      if (blade.role !== "impaler" || !blade.through) continue;
      const axis = bladeAxis(blade), exit = blade.through.exit > 0 ? blade.through.exit : 0.85, tip = { x: blade.root.x + axis.x * blade.height * exit, y: blade.root.y + axis.y * blade.height * exit, z: blade.root.z + axis.z * blade.height * exit };
      for (let i = 0; i < 3; i += 1) {
        const way = scatter(dice, 0.3, 1), speed = 0.8 + 1.2 * dice();
        light.push({ kind: PARTICLE_KIND.glint, origin: { x: blade.root.x, y: blade.root.y + 0.02, z: blade.root.z }, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: blade.birth + 0.01 * dice(), life: 0.3 + 0.3 * dice(), size: (0.016 + 0.012 * dice()) * unit, drag: 2, gravity: 4, tone: 0.6 + 0.4 * dice() });
      }
      for (let i = 0; i < 4; i += 1) {
        const way = scatter(dice, -0.4, 1), speed = (1.2 + 1.8 * dice()) * unit;
        light.push({ kind: PARTICLE_KIND.streak, origin: tip, velocity: { x: (axis.x + way.x * 0.6) * speed, y: (axis.y + way.y * 0.6) * speed, z: (axis.z + way.z * 0.6) * speed }, birth: blade.through.at + 0.015 * dice(), life: 0.22 + 0.25 * dice(), size: (0.012 + 0.008 * dice()) * unit, drag: 1.6, gravity: 6, tone: 0.7 + 0.3 * dice() });
      }
    }
  }
  // the air at the crown's rim freezes and rises, outside the body
  for (let i = 0; i < Math.round(puffs * 0.2); i += 1) {
    const angle = dice() * TAU, out = size.seat * (0.72 + 0.22 * dice()), rise = brief ? 0.2 : (0.55 + 0.45 * dice()) * unit;
    mist.push({ kind: PARTICLE_KIND.puff, origin: { x: stone.x + Math.cos(angle) * out, y: stone.y + (0.05 + 0.25 * dice()) * unit, z: stone.z + Math.sin(angle) * out }, velocity: { x: Math.cos(angle) * 0.3, y: rise, z: Math.sin(angle) * 0.3 }, birth: (brief ? strikeAt - 0.3 : strikeAt) + 0.05 * dice(), life: 1.2 + 0.7 * dice(), size: (0.16 + 0.1 * dice()) * unit, drag: 2.6, gravity: -0.1, tone: 0.6 + 0.4 * dice(), grow: 2.0, fadeIn: 0.12, wander: 0.1 });
  }

  // the hold: snow falling inside the crown, and cold air spilling off its rim and rolling out over the stone
  const hold = Math.max(0.3, shatter[0] - strikeAt);
  for (let i = 0; i < Math.round(sparks * 0.18); i += 1) {
    const angle = dice() * TAU, out = size.seat * Math.sqrt(dice());
    light.push({ kind: PARTICLE_KIND.glint, origin: { x: stone.x + Math.cos(angle) * out, y: stone.y + (1.0 + 1.1 * dice()) * size.blade, z: stone.z + Math.sin(angle) * out }, velocity: { x: 0, y: -0.15, z: 0 }, birth: strikeAt + 0.1 + hold * dice(), life: 1.2 + 0.8 * dice(), size: (0.018 + 0.016 * dice()) * unit, drag: 1.5, gravity: 0.35, tone: 0.5 + 0.5 * dice(), wander: 0.12 });
  }
  for (let i = 0; i < Math.round(puffs * 0.3); i += 1) {
    const blade = ring[i % Math.max(1, ring.length)], angle = blade ? blade.bearing : dice() * TAU, push = (brief ? 0.2 + 0.2 * dice() : 0.35 + 0.4 * dice()) * unit;
    mist.push({ kind: PARTICLE_KIND.puff, origin: { x: stone.x + Math.cos(angle) * size.seat * 1.05, y: stone.y + 0.1 * unit, z: stone.z + Math.sin(angle) * size.seat * 1.05 }, velocity: { x: Math.cos(angle) * push, y: brief ? 0 : -0.02, z: Math.sin(angle) * push }, birth: strikeAt + 0.15 + hold * dice(), life: 1.5 + 0.8 * dice(), size: (0.16 + 0.1 * dice()) * unit, drag: 0.9, gravity: 0.05, tone: 0.5 + 0.4 * dice(), grow: 2.6, fadeIn: 0.25, wander: 0.08 });
  }

  // the shatter: a breath of glints and mist off each blade as its plates go
  for (const blade of ring) {
    const axis = bladeAxis(blade);
    for (let i = 0; i < Math.max(1, Math.round((sparks * 0.1) / Math.max(1, ring.length))); i += 1) {
      const up = dice(), way = scatter(dice, -0.2, 0.8), speed = brief ? 0.15 : 0.8 + 1.2 * dice();
      light.push({ kind: PARTICLE_KIND.glint, origin: { x: blade.root.x + axis.x * blade.height * up, y: blade.root.y + axis.y * blade.height * up, z: blade.root.z + axis.z * blade.height * up }, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: blade.breakAt + blade.breakTime * dice(), life: 0.6 + 0.6 * dice(), size: (0.02 + 0.016 * dice()) * unit, drag: 2, gravity: brief ? 0.2 : 2.4, tone: 0.5 + 0.5 * dice() });
    }
  }
  for (let i = 0; i < puffs - Math.round(puffs * 0.25) * (brief ? 0 : 1) - Math.round(puffs * 0.2) - Math.round(puffs * 0.3); i += 1) {
    const blade = ring[Math.floor(dice() * Math.max(1, ring.length))];
    if (!blade) break;
    mist.push({ kind: PARTICLE_KIND.puff, origin: { x: blade.root.x, y: blade.root.y + 0.2 * unit, z: blade.root.z }, velocity: { x: (dice() - 0.5) * 0.4, y: 0.12, z: (dice() - 0.5) * 0.4 }, birth: blade.breakAt + 0.5 * blade.breakTime, life: 1.1 + 0.6 * dice(), size: (0.18 + 0.1 * dice()) * unit, drag: 1.4, tone: 0.5 + 0.5 * dice(), grow: 2.2, fadeIn: 0.2, wander: 0.08 });
  }
  // nothing outlives the spell, and nothing is born in its last moment
  const within = (list: Particle[]) => list.filter((particle) => particle.birth < duration - 0.06).map((particle) => ({ ...particle, life: Math.min(particle.life, duration - particle.birth) }));
  return { light: within(light), mist: within(mist) };
}

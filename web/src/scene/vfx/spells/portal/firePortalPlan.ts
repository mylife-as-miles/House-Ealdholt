// Adapted from LinearAbilityExtThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The Fire portal, as arithmetic: Solforiz's Bishop and Queen strike a ring of fire in the air over the victim, a
 * black way through opens in it, and fire comes through. No Three.js in here, so the node tests reach it
 * (shared/play/spell-fire-portal.test.ts); portal/firePortal.ts draws what this decides. The portal itself, its
 * clock and its sparks, are portal/portalPlan.ts, which a summon can use without this spell.
 *
 * One clock, in order:
 *
 *   gather   heat gathers in the caster's hand, and it flicks a spark up to where the portal will hang
 *   scribe   the spark is struck at the foot of the circle and runs once round it, the ring white-hot behind it and
 *            cooling, sparks thrown off it on a tangent, the heavy ones falling to the board and skipping
 *   open     the way through irises open inside the ring: a black disc with a warm lip
 *   stir     something moves in the dark: embers far down, a heart of fire that grows, the ring flaring with it
 *   breath   the fire comes through: a jet out of the aperture down onto the victim (`strikeAt` is when its head
 *            reaches the chest) and on to the stone, where it splashes and spreads; it roars, guttering, for most of
 *            a second
 *   close    the breath stops and its tail leaves the portal; the way through irises shut with a last puff; the
 *            ring cools from orange to red to dark and breaks up into embers that fall
 *   after    the stone it burnt smokes and cools
 *
 * The portal hangs above and behind the victim, on the side away from the caster, and looks down at its chest, so
 * from the caster's side its face is seen behind the victim and the fire comes toward the eye.
 */
import type { QualityPreset } from "../../../quality";
import { smooth, type Point } from "../../mystic/beamPlan";
import { PARTICLE_KIND, byPower, scatter, sequence, type Particle } from "../shared/particlePlan";
import { portalAperture, portalFacing, portalScribe, portalSparks, ringPoint, type PortalPlacement } from "./portalPlan";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const round = (value: number) => +value.toFixed(3);

export interface FirePortalBudget {
  /** Sparks off the ring while it is struck and while it stands. */
  sparks: number;
  /** Puffs of flame in the breath. */
  flames: number;
  /** Strands in the breath's hot core, and the cuts along each. */
  strands: number;
  segments: number;
  /** Embers thrown off the splash, and off the ring as it breaks up. */
  embers: number;
  /** Puffs of smoke: the one layer of it that is matter. */
  smoke: number;
}

/** What a Bishop's Fire portal is drawn with at each tier; a Queen's has more. The lowest has no bloom: halos carry the glow. */
export const FIRE_PORTAL_BUDGET: Readonly<Record<QualityPreset, FirePortalBudget>> = {
  low: { sparks: 60, flames: 40, strands: 2, segments: 32, embers: 20, smoke: 6 },
  medium: { sparks: 130, flames: 80, strands: 3, segments: 48, embers: 40, smoke: 12 },
  high: { sparks: 220, flames: 130, strands: 4, segments: 64, embers: 64, smoke: 18 },
  ultra: { sparks: 320, flames: 180, strands: 5, segments: 80, embers: 90, smoke: 24 },
};

/** From this power up a cast has a Queen's extras: a second ring struck the other way round, a longer breath. */
export const QUEEN_POWER = 1.4;

/** What a Fire portal of `power` is drawn with. */
export function firePortalCounts(quality: QualityPreset, power: number): FirePortalBudget {
  const base = FIRE_PORTAL_BUDGET[quality];
  return {
    sparks: byPower(base.sparks, power), flames: byPower(base.flames, power), strands: base.strands + (power >= QUEEN_POWER ? 1 : 0), segments: base.segments,
    embers: byPower(base.embers, power), smoke: byPower(base.smoke, power),
  };
}

export interface FirePortalSize {
  /** The portal's clear radius, how high its centre hangs over the stone and how far behind the victim. */
  radius: number;
  height: number;
  back: number;
  /** How far below level its face is tipped: the way the breath leaves it. */
  tilt: number;
  /** Half the breath's width as it leaves the portal and where it lands. */
  mouth: number;
  spread: number;
  /** How far the fire spreads over the stone where it lands. */
  splash: number;
}

/**
 * How large a Fire portal of `power` is, in board units where a square is `tile` across. It hangs high enough that
 * its foot clears the head of a piece on the square behind the victim.
 */
export function firePortalSize(power: number, tile = 1.02): FirePortalSize {
  const more = clamp01((power - 1) / 0.75), unit = tile / 1.02;
  return {
    radius: mix(0.5, 0.68, more) * unit, height: mix(2.35, 2.75, more) * unit, back: mix(0.8, 0.88, more) * tile, tilt: 25 * (Math.PI / 180),
    mouth: mix(0.07, 0.1, more) * unit, spread: mix(0.22, 0.3, more) * unit, splash: mix(0.55, 0.75, more) * unit,
  };
}

/**
 * The breath's path: a stream thrown out of the portal along its face that falls as it goes, through the victim's
 * chest and on to the stone in front of it. It is a parabola, as anything thrown is, written as a quadratic curve.
 */
export interface PortalJet {
  /** Where it leaves the portal, the control of its curve, and where it comes down on the stone. */
  source: Point;
  control: Point;
  splash: Point;
  /** Where along the curve (0..1) it passes through the chest. */
  chestAt: number;
  /** How long it is, near enough. */
  length: number;
}

/** The point at `u` (0..1) along the breath. */
export function jetPoint(jet: PortalJet, u: number): Point {
  const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u, { source, control, splash } = jet;
  return { x: a * source.x + b * control.x + c * splash.x, y: a * source.y + b * control.y + c * splash.y, z: a * source.z + b * control.z + c * splash.z };
}

/** The way the breath runs at `u`, as a unit vector. */
export function jetTangent(jet: PortalJet, u: number): Point {
  const { source, control, splash } = jet;
  const x = 2 * (1 - u) * (control.x - source.x) + 2 * u * (splash.x - control.x), y = 2 * (1 - u) * (control.y - source.y) + 2 * u * (splash.y - control.y);
  const z = 2 * (1 - u) * (control.z - source.z) + 2 * u * (splash.z - control.z), length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

/**
 * Where the portal hangs for a cast and the path its breath takes: over the victim's square, behind it on the side
 * away from the caster, its face tipped `tilt` below level toward the caster, so its face is seen from the caster's
 * side and from the players' high seat alike. The stream leaves along the face and falls through the chest.
 */
export function firePortalGeometry(stone: Point, hand: Point, chest: Point, size: FirePortalSize): { placement: PortalPlacement; jet: PortalJet } {
  const dx = stone.x - hand.x, dz = stone.z - hand.z, far = Math.hypot(dx, dz), ax = far > 1e-5 ? dx / far : 0, az = far > 1e-5 ? dz / far : -1;
  const source = { x: stone.x + ax * size.back, y: stone.y + size.height, z: stone.z + az * size.back };
  // in the upright plane through the stream: across is toward the caster from the portal, and it falls as a parabola
  // y = H - s·x - k·x², which leaves at the tilt and passes through the chest `back` across
  const H = source.y - stone.y, drop = H - (chest.y - stone.y), slope = Math.tan(size.tilt), across = size.back;
  const k = Math.max(0.05, (drop - slope * across) / (across * across));
  const land = (-slope + Math.sqrt(slope * slope + 4 * k * H)) / (2 * k);
  const control = { x: source.x - ax * land * 0.5, y: source.y - slope * land * 0.5, z: source.z - az * land * 0.5 };
  const splash = { x: source.x - ax * land, y: stone.y, z: source.z - az * land };
  const jet: PortalJet = { source, control, splash, chestAt: clamp01(across / land), length: 0 };
  let length = 0, last = source;
  for (let i = 1; i <= 16; i += 1) { const next = jetPoint(jet, i / 16); length += Math.hypot(next.x - last.x, next.y - last.y, next.z - last.z); last = next; }
  jet.length = length;
  return { placement: portalFacing(source, control, size.radius), jet };
}

export interface FirePortalTimeline {
  /** Heat gathers in the hand; the flicked spark flies to the portal's foot. */
  gather: readonly [number, number];
  flick: readonly [number, number];
  /** The spark is struck and runs round the ring. */
  scribe: readonly [number, number];
  /** The way through opens; something stirs in it. */
  open: readonly [number, number];
  stir: readonly [number, number];
  /** The fire comes through: its head leaves the portal, and its last leaves it. */
  breath: readonly [number, number];
  strikeAt: number;
  /** The way through shuts; the ring cools and breaks up. */
  shut: readonly [number, number];
  crumble: readonly [number, number];
  duration: number;
  brief: boolean;
}

/** Seconds the spark takes to run round the ring, and the way through to iris open. */
export const SCRIBE_TIME = 0.55;
export const APERTURE_TIME = 0.42;
/** Seconds the breath's head takes from the portal to the chest. */
export const BREATH_HEAD = 0.1;

/**
 * The timeline of a cast `distance` board units long: only the flicked spark depends on it. A Queen's breath is
 * longer. The brief form (reduced motion, fast play) has no flick and no running spark: the ring comes up whole,
 * the way through opens slowly, and the fire pours through at a walk.
 */
export function firePortalTimeline(distance: number, power: number, brief: boolean): FirePortalTimeline {
  if (brief) return { gather: [0, 0.3], flick: [0.3, 0.3], scribe: [0, 0.5], open: [0.35, 0.85], stir: [0.6, 0.9], breath: [0.9, 1.9], strikeAt: 1.25, shut: [1.95, 2.45], crumble: [2.2, 2.75], duration: 2.9, brief: true };
  const more = clamp01((power - 1) / 0.75), struck = round(0.3 + clamp(distance / 26, 0.14, 0.32));
  const scribe: [number, number] = [struck, round(struck + SCRIBE_TIME)], opens = round(struck + SCRIBE_TIME * 0.76);
  const leaves = round(struck + 0.95 + 0.05 * more), strikeAt = round(leaves + BREATH_HEAD), last = round(strikeAt + 0.75 + 0.3 * more);
  return {
    gather: [0, 0.38], flick: [0.3, struck], scribe, open: [opens, round(opens + APERTURE_TIME)], stir: [round(struck + 0.62), leaves], breath: [leaves, last], strikeAt,
    shut: [round(last + 0.1), round(last + 0.48)], crumble: [round(last + 0.35), round(last + 1.05)], duration: round(last + 1.5), brief: false,
  };
}

/** How the fire gutters: two beats at unrelated rates, never a shimmer. 1 at its fullest. */
export function gutter(seconds: number): number {
  return 1 - 0.28 * (0.5 + 0.5 * Math.sin(seconds * 11.3) * Math.sin(seconds * 4.1 + 1.3));
}

export interface FirePortalState {
  /** The heat in the caster's hand, 0..1, and how far the flicked spark has flown, 0..1 (-1 when there is none). */
  hand: number;
  flick: number;
  /** The portal: how far round the spark has run (and a Queen's second), how lit the ring is, the spark's own brightness. */
  scribe: number;
  scribe2: number;
  open: number;
  head: number;
  /** How open the way through is, what stirs in it, and the blaze of what comes through, each 0..1. */
  aperture: number;
  stir: number;
  blaze: number;
  /** The breath: how far its head and its tail have run along it, 0 at the portal and 1 on the stone; how it roars. */
  jetHead: number;
  jetTail: number;
  jet: number;
  /** How far the ring has cooled and broken up, each 0..1. */
  cool: number;
  crumble: number;
  /** Seconds since the fire reached the stone, and the burning there, each -1 / 0 before it. */
  sinceSplash: number;
  burn: number;
  /** How charred the stone is, 0..1. It lifts at the very end: the match's own burn mark is what stays. */
  scorch: number;
  struck: boolean;
  sinceStrike: number;
  /** The flash of the blow, 0..1. Never in the brief form. */
  flash: number;
  done: boolean;
  /** Camera shake, 0 in the brief form. */
  shake: number;
  /** The light it throws, and where: 0 the hand, 1 the portal, 2 where the fire lands. */
  light: number;
  lightAt: number;
}

/** What the spell is doing `seconds` after the cast; `jet` is the breath's path (firePortalGeometry). */
export function firePortalState(timeline: FirePortalTimeline, jet: { chestAt: number }, seconds: number, power = 1): FirePortalState {
  const { gather, flick, scribe, open, stir, breath, strikeAt, shut, crumble, duration, brief } = timeline;
  const struck = seconds >= strikeAt, since = struck ? seconds - strikeAt : -1, done = seconds >= duration;
  // the head reaches the chest on the blow and runs on to the stone at the same pace; the tail follows it out
  const pace = jet.chestAt / Math.max(0.05, strikeAt - breath[0]);
  const jetHead = seconds < breath[0] ? 0 : clamp01((seconds - breath[0]) * pace);
  const jetTail = seconds < breath[1] ? 0 : clamp01((seconds - breath[1]) * pace * 0.8);
  const landed = breath[0] + 1 / pace, sinceSplash = seconds >= landed ? seconds - landed : -1;
  const cooled = smooth(breath[1], crumble[1] - 0.1, seconds), ending = smooth(duration - 0.45, duration, seconds);
  const roar = gutter(seconds);
  const burning = sinceSplash < 0 ? 0 : smooth(0, brief ? 0.6 : 0.12, sinceSplash) * (1 - smooth(breath[1] + 0.15, breath[1] + 0.9, seconds));
  if (brief) {
    const shown = smooth(scribe[0], scribe[1], seconds);
    return {
      hand: 0.6 * smooth(0, 0.3, seconds) * (1 - smooth(0.5, 0.9, seconds)), flick: -1, scribe: 1, scribe2: 1, open: shown * (1 - cooled) * 0.8, head: 0,
      aperture: smooth(open[0], open[1], seconds) * (1 - smooth(shut[0], shut[1], seconds)), stir: smooth(stir[0], stir[1], seconds) * (1 - smooth(breath[1] - 0.3, breath[1], seconds)),
      blaze: 0.6 * smooth(breath[0], breath[0] + 0.3, seconds) * (1 - smooth(breath[1] - 0.2, breath[1] + 0.1, seconds)),
      jetHead, jetTail, jet: 0.6 * (jetHead > 0 && jetTail < 1 ? 1 : 0), cool: cooled, crumble: smooth(crumble[0], crumble[1], seconds),
      sinceSplash, burn: 0.6 * burning, scorch: done ? 0 : 0.5 * smooth(landed, landed + 0.5, seconds) * (1 - ending), struck, sinceStrike: since, flash: 0, done, shake: 0,
      light: done ? 0 : 0.5 * shown * (1 - cooled) + 0.9 * burning, lightAt: seconds < breath[0] ? 1 : 2,
    };
  }
  const flight = seconds < flick[0] || seconds >= flick[1] ? -1 : (seconds - flick[0]) / (flick[1] - flick[0]);
  const scribed = portalScribe(seconds - scribe[0], SCRIBE_TIME), striking = seconds >= scribe[0];
  const flash = struck ? Math.exp(-since / 0.1) : 0;
  const swell = smooth(stir[0], stir[1], seconds) * (seconds < breath[1] ? 1 : 0);
  return {
    hand: smooth(0, 0.25, seconds) * (1 - smooth(flick[0], flick[0] + 0.15, seconds)), flick: flight,
    scribe: striking ? scribed : 0, scribe2: striking ? portalScribe(seconds - scribe[0] - SCRIBE_TIME * 0.4, SCRIBE_TIME) : 0,
    open: striking ? smooth(scribe[0], scribe[0] + 0.15, seconds) * (1 + 0.35 * swell + 0.25 * burning * roar) * (1 - smooth(crumble[1] - 0.15, crumble[1], seconds)) : 0,
    head: striking && scribed < 1 ? 1 - scribed * scribed : 0,
    aperture: portalAperture(seconds - scribe[0], SCRIBE_TIME, APERTURE_TIME) * (striking ? 1 : 0) * (1 - smooth(shut[0], shut[1], seconds) ** 2),
    stir: swell, blaze: seconds < breath[0] - 0.05 ? 0 : smooth(breath[0] - 0.05, breath[0] + 0.05, seconds) * roar * (1 - smooth(breath[1] - 0.05, breath[1] + 0.12, seconds)),
    jetHead, jetTail, jet: jetHead > 0 && jetTail < 1 ? (0.85 + 0.3 * flash) * roar : 0,
    cool: cooled, crumble: smooth(crumble[0], crumble[1], seconds),
    sinceSplash, burn: burning * roar, scorch: done ? 0 : smooth(landed, landed + 0.3, seconds) * (1 - ending),
    struck, sinceStrike: since, flash, done,
    shake: done ? 0 : Math.min(1, (struck ? 0.5 * (0.7 + 0.3 * power) * Math.exp(-since / 0.18) : 0) + (seconds > breath[0] && seconds < breath[1] ? 0.06 * roar : 0) + 0.04 * swell),
    light: done ? 0 : seconds < flick[1] ? 0.6 * smooth(0, 0.25, seconds) : seconds < breath[0] ? 0.5 + 0.6 * scribed + 0.6 * swell : (2 * burning * roar + 3.2 * flash + 0.6) * (1 - cooled * 0.85),
    lightAt: seconds < flick[1] ? 0 : seconds < breath[0] ? 1 : 2,
  };
}

export interface FirePortalCast {
  stone: Point;
  hand: Point;
  placement: PortalPlacement;
  jet: PortalJet;
  timeline: FirePortalTimeline;
  size: FirePortalSize;
  counts: FirePortalBudget;
  power: number;
  seed: number;
  tile: number;
}

export interface FirePortalParticles {
  /** Sparks, flame, embers and the drawn glow: added light. */
  light: Particle[];
  /** Smoke: it covers what is behind it. */
  matter: Particle[];
}

/**
 * Everything loose in a cast, with its birth times, written once. Particles marked `anchored` are placed relative to
 * the caster's hand and follow it.
 */
export function firePortalParticles(cast: FirePortalCast): FirePortalParticles {
  const { stone, hand, placement, jet, timeline, size, counts, power, tile } = cast, dice = sequence(cast.seed ^ 0xf1e9), unit = tile / 1.02, brief = timeline.brief;
  const { gather, flick, scribe, breath, strikeAt, shut, crumble, duration } = timeline, zero = { x: 0, y: 0, z: 0 };
  const light: Particle[] = [], matter: Particle[] = [];
  const foot = ringPoint(placement, 0), floor = stone.y;

  // the hand: heat gathering in it, and the spark it flicks up to the foot of the circle
  light.push({ kind: PARTICLE_KIND.halo, origin: zero, velocity: zero, birth: 0, life: gather[1] + 0.15, size: 0.3 * unit, tone: 0.6, anchored: true, fadeIn: 0.4 });
  light.push({ kind: PARTICLE_KIND.mote, origin: zero, velocity: zero, birth: 0.03, life: gather[1] + 0.05, size: 0.07 * unit, tone: 0.95, anchored: true, fadeIn: 0.5 });
  if (!brief) {
    for (let i = 0; i < Math.round(counts.embers * 0.15); i += 1) {
      const way = scatter(dice, 0.4, 1);
      light.push({ kind: PARTICLE_KIND.mote, origin: { x: way.x * 0.05, y: 0, z: way.z * 0.05 }, velocity: { x: way.x * 0.25, y: 0.5 + 0.6 * dice(), z: way.z * 0.25 }, birth: dice() * gather[1], life: 0.35 + 0.3 * dice(), size: 0.016 * unit, drag: 1, gravity: -1.2, tone: 0.85, anchored: true });
    }
    // flicked: it flies free, under a little gravity, and arrives at the foot as the spark is struck there
    const t = flick[1] - flick[0], g = 2.5;
    light.push({ kind: PARTICLE_KIND.streak, origin: hand, velocity: { x: (foot.x - hand.x) / t, y: (foot.y - hand.y) / t + 0.5 * g * t, z: (foot.z - hand.z) / t }, birth: flick[0], life: t, size: 0.022 * unit, gravity: g, tone: 1, fadeIn: 0.05 });
    // struck: a crack of sparks off the foot of the circle
    for (let i = 0; i < Math.round(counts.sparks * 0.06); i += 1) {
      const way = scatter(dice), speed = (1.2 + 2.2 * dice()) * unit;
      light.push({ kind: PARTICLE_KIND.streak, origin: foot, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: scribe[0] + 0.02 * dice(), life: 0.15 + 0.2 * dice(), size: 0.012 * unit, drag: 2.2, gravity: 4, tone: 0.95 });
    }
    light.push({ kind: PARTICLE_KIND.halo, origin: foot, velocity: zero, birth: scribe[0], life: 0.22, size: 0.45 * unit, tone: 0.9, fadeIn: 0.1 });
  }
  // the ring throws sparks off itself while it is struck and while it stands lit, and the heavy ones skip on the board
  const thrown = brief ? [] : portalSparks(placement, { struck: scribe[0], scribeTime: SCRIBE_TIME, until: breath[1] + 0.1, running: Math.round(counts.sparks * 0.42), standing: Math.round(counts.sparks * 0.4), floor }, dice, size.radius / 0.55);
  light.push(...thrown);
  // (the portal's light on the air round it is the ring's own: a sprite there would be cut by the way through's depth)

  // the breath: flame born along the stream as it runs, most near its head, billowing off it, slowing and rising as
  // it burns; where the stream reaches the stone the flame is thrown out along it
  const rate = jet.chestAt / Math.max(0.05, strikeAt - breath[0]), landed = breath[0] + 1 / rate, out = jetTangent(jet, 0), source = jet.source;
  for (let i = 0; i < counts.flames; i += 1) {
    const birth = breath[0] + 0.01 + (breath[1] - breath[0]) * ((i + dice()) / counts.flames), head = Math.min(1, (birth - breath[0]) * rate);
    const u = head < 1 ? head * (1 - 0.4 * dice() * dice()) : dice() < 0.3 ? 0.85 + 0.15 * dice() : dice() ** 0.8;
    const at = jetPoint(jet, u), way = jetTangent(jet, u), spill = scatter(dice), wide = size.mouth + (size.spread - size.mouth) * u;
    const fast = (brief ? 0.4 : 2.6) * (1 - 0.6 * u) * unit, onStone = at.y - floor < 0.12, loose = brief ? 0.15 : 0.4;
    light.push({
      kind: PARTICLE_KIND.puff, origin: { x: at.x + spill.x * wide * 0.5, y: Math.max(floor + 0.04, at.y + spill.y * wide * 0.5), z: at.z + spill.z * wide * 0.5 },
      velocity: onStone ? { x: (way.x + spill.x * 0.8) * fast * 1.2, y: 0.15, z: (way.z + spill.z * 0.8) * fast * 1.2 } : { x: way.x * fast + spill.x * loose, y: way.y * fast + spill.y * loose, z: way.z * fast + spill.z * loose },
      birth, life: (brief ? 0.8 : 0.32) + 0.25 * dice(), size: wide * (0.8 + 0.5 * dice()), drag: 3, gravity: brief ? -0.5 : -2.6, tone: 0.95 - 0.35 * u + 0.05 * dice(), grow: 2.4 + 1.2 * dice(), fadeIn: 0.08, wander: 0.05,
    });
  }
  // the splash: a glow pooled where it lands, a flash at the chest on the blow, and embers kicked off the stone
  const ahead = { x: jet.splash.x - jet.control.x, z: jet.splash.z - jet.control.z }, level = Math.hypot(ahead.x, ahead.z) || 1;
  light.push({ kind: PARTICLE_KIND.halo, origin: { x: jet.splash.x, y: floor + 0.25 * unit, z: jet.splash.z }, velocity: zero, birth: landed, life: breath[1] - landed + 0.4, size: size.splash * 2.2, tone: 0.55, fadeIn: brief ? 0.4 : 0.1 });
  if (!brief) {
    light.push({ kind: PARTICLE_KIND.halo, origin: { x: stone.x, y: floor + 0.95 * unit, z: stone.z }, velocity: zero, birth: strikeAt, life: 0.3, size: 1.5 * unit * (0.8 + 0.25 * power), tone: 0.75, fadeIn: 0.08 });
    for (let i = 0; i < Math.round(counts.embers * 0.5); i += 1) {
      const way = scatter(dice, 0.15, 0.85), push = (1.2 + 2.6 * dice()) * unit;
      light.push({ kind: PARTICLE_KIND.streak, origin: { x: jet.splash.x + (dice() - 0.5) * 0.2, y: floor + 0.04, z: jet.splash.z + (dice() - 0.5) * 0.2 }, velocity: { x: (way.x + (ahead.x / level) * 0.6) * push, y: way.y * push, z: (way.z + (ahead.z / level) * 0.6) * push }, birth: landed + (breath[1] - landed) * dice(), life: 0.3 + 0.4 * dice(), size: (0.01 + 0.008 * dice()) * unit, drag: 1.4, gravity: 6, tone: 0.75 + 0.25 * dice() });
    }
  }
  // the close: a last breath of flame out of the way through while it shuts, and the ring's embers falling as it breaks
  if (!brief) for (let i = 0; i < Math.round(counts.flames * 0.06); i += 1) {
    light.push({ kind: PARTICLE_KIND.puff, origin: source, velocity: { x: out.x * 0.9 + (dice() - 0.5) * 0.4, y: out.y * 0.9 + 0.3, z: out.z * 0.9 + (dice() - 0.5) * 0.4 }, birth: shut[0] + 0.4 * (shut[1] - shut[0]) + 0.05 * dice(), life: 0.3, size: size.mouth * 1.1, drag: 3, gravity: -1.5, tone: 0.55, grow: 2.4, fadeIn: 0.1 });
  }
  for (let i = 0; i < Math.round(counts.embers * 0.4); i += 1) {
    const turn = dice(), at = ringPoint(placement, turn);
    light.push({ kind: PARTICLE_KIND.mote, origin: at, velocity: { x: (dice() - 0.5) * 0.3, y: brief ? -0.05 : 0.1 * dice(), z: (dice() - 0.5) * 0.3 }, birth: crumble[0] + (crumble[1] - crumble[0]) * dice(), life: 0.7 + 0.6 * dice(), size: (0.012 + 0.012 * dice()) * unit, drag: 1.6, gravity: brief ? 0.3 : 1.6, tone: 0.55 + 0.3 * dice(), fadeIn: 0.05, wander: 0.05 });
  }

  // matter: smoke off the burning stone, and the last puff out of the portal
  for (let i = 0; i < counts.smoke; i += 1) {
    const late = i % 4 === 3, a = dice() * Math.PI * 2, r = size.splash * 0.7 * Math.sqrt(dice());
    matter.push(late
      ? { kind: PARTICLE_KIND.puff, origin: source, velocity: { x: out.x * 0.5, y: 0.3, z: out.z * 0.5 }, birth: shut[1] - 0.05 + 0.1 * dice(), life: 1.2 + 0.5 * dice(), size: size.mouth * 1.6, drag: 1.2, gravity: -0.35, tone: 0.2 + 0.3 * dice(), grow: 2.8, fadeIn: 0.2, wander: 0.12 }
      : { kind: PARTICLE_KIND.puff, origin: { x: jet.splash.x + Math.cos(a) * r, y: floor + 0.12 * unit, z: jet.splash.z + Math.sin(a) * r }, velocity: { x: (dice() - 0.5) * 0.3, y: (brief ? 0.25 : 0.45 + 0.5 * dice()) * unit, z: (dice() - 0.5) * 0.3 }, birth: landed + 0.1 + (duration - 0.9 - landed) * dice(), life: 1.1 + 0.6 * dice(), size: (0.16 + 0.1 * dice()) * unit, drag: 0.8, gravity: -0.4, tone: 0.1 + 0.3 * dice(), grow: 2.7, fadeIn: 0.25, wander: 0.15 });
  }
  // nothing outlives the spell, and nothing is born in its last moment
  const within = (list: Particle[]) => list.filter((particle) => particle.birth < duration - 0.06).map((particle) => ({ ...particle, life: Math.min(particle.life, duration - particle.birth) }));
  return { light: within(light), matter: within(matter) };
}

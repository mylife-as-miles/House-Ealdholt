// Adapted from LinearAbiltyCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The Snare, as arithmetic: a caster of the arc (Kwind-09) or of the occult (Korvenia) throws a cage of current over
 * the victim and crushes it. No Three.js in here, so the node tests reach it (shared/play/spell-snare.test.ts);
 * snare/snare.ts draws what this decides. Its colours are the kingdom's (`cast.look`).
 *
 * One clock, in order:
 *
 *   gather   current crackles round the caster's hand and a knot of light tightens in it
 *   leash    the hand whips a leash of current down onto the stone and along it to the victim's square, leaving
 *            embers lying where it ran
 *   snap     the leash is dropped and a ring snaps open round the victim, past its radius and back onto it; the
 *            disc inside it burns in
 *   climb    a cage of filaments tears up out of the ring round the victim, twisting as it climbs
 *   reach    tendrils crawl up out of the ring to the victim's ankles, wrists and throat and coil round them
 *   bind     the tendrils pull taut and the cage closes in, in three ratchets, each sooner than the last
 *   crush    everything closes at once (`strikeAt`): the coils clench, a surge runs up every filament, the cage
 *            is at its tightest
 *   hold     the cage stands re-striking while the body burns: its heaviest filaments keep their channels for a
 *            few strikes, the thin ones are new every time; arcs run round the ring; the tendrils slacken
 *   collapse the tendrils let go and are drawn back into the ring, the cage sinks into it as a thread, and the
 *            ring burns out
 *   cool     the disc it burnt cools and smokes
 *
 * From the reference's Voltaic Snare: a leash whipped across the floor that plants it; a ring that slams open past
 * its radius and pulls back onto it; a column, tendrils and rim arcs that are all one instanced strip whose role is
 * decided per strand; kinks of value noise joined by straight lines, so the corners stay sharp; re-strikes on a
 * quantised clock; a disc of veins burnt into the floor. Ours: the tendrils go to the victim's limbs and bind them,
 * so it reads as a restraint; it tightens in ratchets and the crush is the blow; the channels are kept for a few
 * strikes as lightning's are; it is a cage round one figure on one square, not a field; it leaves a scorched disc;
 * and reduced motion has its own steady form.
 */
import type { QualityPreset } from "../../../quality";
import { smooth, type Point } from "../../mystic/beamPlan";
import { PARTICLE_KIND, byPower, scatter, sequence, type Particle } from "../shared/particlePlan";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const round = (value: number) => +value.toFixed(3);
const TAU = Math.PI * 2;

export interface SnareBudget {
  /** Filaments in the cage round the victim. */
  column: number;
  /** Arcs running round the ring. */
  rim: number;
  /** Filaments in the leash. */
  leash: number;
  /** Cuts along every filament. */
  segments: number;
  /** Tendrils that bind a limb. */
  tendrils: number;
  /** Sparks and embers: the leash's track, the snap, the coils, the crush, the collapse. */
  sparks: number;
  /** Puffs of dust thrown by the snap and smoke off the scorched disc: the one layer that is matter. */
  smoke: number;
  /** Arcs crackling round the hand while it gathers. */
  crackle: number;
}

/** What a Bishop's Snare is drawn with at each tier; a Queen's binds more limbs and has more of the rest. */
export const SNARE_BUDGET: Readonly<Record<QualityPreset, SnareBudget>> = {
  low: { column: 4, rim: 3, leash: 2, segments: 40, tendrils: 4, sparks: 30, smoke: 6, crackle: 1 },
  medium: { column: 6, rim: 4, leash: 3, segments: 56, tendrils: 5, sparks: 60, smoke: 10, crackle: 2 },
  high: { column: 8, rim: 6, leash: 3, segments: 72, tendrils: 5, sparks: 100, smoke: 14, crackle: 3 },
  ultra: { column: 10, rim: 8, leash: 4, segments: 96, tendrils: 5, sparks: 140, smoke: 18, crackle: 3 },
};

/** From this power up a cast has a Queen's extras: knees and waist bound too, a wider ring, more filaments. */
export const QUEEN_POWER = 1.4;

/** The limbs a tendril may bind, in the order they are given out: ankles, wrists, throat, then knees and waist. */
export const LIMBS = ["ankle-l", "ankle-r", "wrist-l", "wrist-r", "throat", "knee-l", "knee-r", "waist"] as const;

/** What a Snare of `power` is drawn with. */
export function snareCounts(quality: QualityPreset, power: number): SnareBudget {
  const base = SNARE_BUDGET[quality], queen = power >= QUEEN_POWER;
  return {
    column: base.column + (queen ? 2 : 0), rim: base.rim + (queen ? 2 : 0), leash: base.leash, segments: base.segments,
    tendrils: Math.min(LIMBS.length, base.tendrils + (queen ? 3 : 0)), sparks: byPower(base.sparks, power), smoke: byPower(base.smoke, power), crackle: base.crackle,
  };
}

export interface SnareSize {
  /** The ring round the victim, on the stone. */
  ring: number;
  /** The cage: its radius at the stone and at its top, and how high it stands. */
  throat: number;
  crown: number;
  height: number;
  /** Half a filament's width, by role. */
  filament: number;
  /** How far a kink throws a filament, by role. */
  kink: number;
  /** The radius of a coil round a limb. */
  coil: number;
  /** How high the rim arcs hop. */
  hop: number;
}

/**
 * How large a Snare of `power` is, in board units where a square is `tile` across. A Bishop's ring stands just
 * outside the victim's square; a Queen's reaches into its neighbours. The cage stands close round the figure and
 * opens out above its head.
 */
export function snareSize(power: number, tile = 1.02): SnareSize {
  const more = clamp01((power - 1) / 0.75), unit = tile / 1.02;
  return {
    ring: mix(0.56, 0.78, more) * tile, throat: mix(0.3, 0.36, more) * unit, crown: mix(0.62, 0.86, more) * unit, height: mix(2.5, 3.3, more) * unit,
    filament: mix(0.013, 0.016, more) * unit, kink: mix(0.06, 0.075, more) * unit, coil: 0.09 * unit, hop: mix(0.22, 0.3, more) * unit,
  };
}

export interface SnareTimeline {
  /** Current gathers in the hand. */
  gather: readonly [number, number];
  /** The leash runs from the hand to the victim's square. */
  leash: readonly [number, number];
  /** The ring snaps open. */
  snap: number;
  /** The cage climbs; the tendrils crawl to the limbs. */
  climb: readonly [number, number];
  reach: readonly [number, number];
  /** The tendrils pull taut in ratchets, until the crush. */
  bind: readonly [number, number];
  /** The crush. */
  strikeAt: number;
  /** The tendrils let go and the cage sinks into the ring. */
  collapse: readonly [number, number];
  duration: number;
  brief: boolean;
}

/** Board units a second the leash's tip runs at along the stone. */
export const LEASH_SPEED = 22;
/** Seconds the ring takes to snap open, overshoot and all. */
export const SNAP_TIME = 0.16;

/**
 * The timeline of a cast `distance` board units long. Only the leash depends on it: a long whip lands later. A
 * Queen binds a little longer and holds longer. The brief form (reduced motion, fast play) has no whip: the ring
 * comes up where it stands and the cage rises slowly round the victim.
 */
export function snareTimeline(distance: number, power: number, brief: boolean): SnareTimeline {
  if (brief) return { gather: [0, 0.2], leash: [0.2, 0.2], snap: 0.2, climb: [0.25, 0.85], reach: [0.35, 0.95], bind: [0.95, 1.25], strikeAt: 1.25, collapse: [2.2, 2.8], duration: 3.2, brief: true };
  const more = clamp01((power - 1) / 0.75), gather = 0.42, snap = round(gather + clamp(distance / LEASH_SPEED, 0.12, 0.38));
  const strikeAt = round(snap + 0.86 + 0.08 * more), hold = 0.85 + 0.25 * more;
  const collapse: [number, number] = [round(strikeAt + hold), round(strikeAt + hold + 0.55)];
  return {
    gather: [0, gather], leash: [gather, snap], snap, climb: [round(snap + 0.03), round(snap + 0.3)], reach: [round(snap + 0.1), round(snap + 0.44)],
    bind: [round(snap + 0.44), strikeAt], strikeAt, collapse, duration: round(collapse[1] + 0.9), brief: false,
  };
}

/** The three ratchets of the bind, as shares of it: each comes sooner after the last. */
export const RATCHETS = [0.18, 0.55, 0.8] as const;

/** A spring past its mark and back: 0 at 0, 1 at 1, about 1.1 at its height. */
function outBack(t: number): number {
  const u = clamp01(t) - 1, back = 1.7;
  return 1 + (back + 1) * u * u * u + back * u * u;
}

/**
 * How far open the ring is `since` seconds after it landed, as a factor on its radius: it slams open past its
 * radius and pulls back onto it, the reference's out-cubic times a late bump.
 */
export function ringOpen(since: number): number {
  if (since <= 0) return 0;
  const t = clamp01(since / SNAP_TIME), bump = Math.sin(Math.PI * t ** 1.7);
  const out = 1 - (1 - t) ** 3;
  return out * (1 + 0.16 * bump);
}

/** How far the bind has closed, 0..1, `share` of the way through it: three ratchets, each a jerk and a hold. */
export function ratchet(share: number): number {
  let closed = 0;
  for (const at of RATCHETS) closed += 0.26 * smooth(at - 0.02, at + 0.06, share);
  return closed;
}

export interface SnareState {
  /** The light and the crackle at the hand, 0..1. */
  hand: number;
  /** How far the leash's tip has run, 0 at the caster's feet to 1 at the ring; and how bright the leash is. */
  front: number;
  leash: number;
  /** A factor on the ring's radius (it overshoots), and how brightly its band burns. */
  open: number;
  ring: number;
  /** How far the cage has climbed, 0..1, and how bright it is. */
  climb: number;
  cage: number;
  /** How far the tendrils have crawled, 0..1 (each has its own stagger), and how bright they are. */
  reach: number;
  tendrils: number;
  /** How taut they are, 0..1: kinks flatten, and how far the cage and the coils have closed in, 0..1. */
  taut: number;
  squeeze: number;
  /** The arcs running round the ring, 0..1. */
  rim: number;
  /** Seconds since the crush, and since the snap; -1 before each. */
  sinceStrike: number;
  sinceSnap: number;
  /** The flash of the crush, 0..1, and of each ratchet, 0..1. Neither in the brief form. */
  flash: number;
  jerk: number;
  /** Re-strikes a second: 0 for none (the brief form is steady). */
  restrike: number;
  /** How far the cage has collapsed, 0..1. */
  collapse: number;
  /** How burnt the disc is, and how hot what is burnt still is, each 0..1. */
  scorch: number;
  heat: number;
  struck: boolean;
  done: boolean;
  /** Camera shake, 0 in the brief form. */
  shake: number;
  /** The light it throws, about 1 standing and several at the crush, and where: 0 the hand, 1 the leash's tip, 2 the victim. */
  light: number;
  lightAt: number;
}

/** What the spell is doing `seconds` after the cast. */
export function snareState(timeline: SnareTimeline, seconds: number, power = 1): SnareState {
  const { gather, leash, snap, climb, reach, bind, strikeAt, collapse, duration, brief } = timeline;
  const struck = seconds >= strikeAt, since = struck ? seconds - strikeAt : -1, done = seconds >= duration;
  const sinceSnap = seconds >= snap ? seconds - snap : -1;
  const collapsed = smooth(collapse[0], collapse[1], seconds), ending = smooth(duration - 0.5, duration, seconds);
  const scorch = done ? 0 : sinceSnap < 0 ? 0 : smooth(snap, strikeAt, seconds) * 0.75 * (1 - ending);
  if (brief) {
    const up = smooth(0, 0.5, seconds), cage = smooth(climb[0], climb[1], seconds) * (1 - collapsed);
    const closed = smooth(bind[0], bind[1] + 0.3, seconds) * (1 - collapsed);
    return {
      hand: 0.6 * smooth(0, 0.2, seconds) * (1 - smooth(0.4, 0.9, seconds)), front: 1, leash: 0, open: up, ring: 0.6 * up * (1 - collapsed) * (1 - ending),
      climb: smooth(climb[0], climb[1], seconds) * (1 - collapsed), cage: 0.65 * cage, reach: smooth(reach[0], reach[1], seconds) * (1 - collapsed),
      tendrils: 0.65 * smooth(reach[0], reach[1], seconds) * (1 - collapsed), taut: closed, squeeze: 0.6 * closed, rim: 0.5 * cage,
      sinceStrike: since, sinceSnap, flash: 0, jerk: 0, restrike: 0, collapse: collapsed, scorch: done ? 0 : 0.4 * up * (1 - ending), heat: 0.4 * cage,
      struck, done, shake: 0, light: done ? 0 : 0.4 * up * (1 - ending) + 0.6 * cage, lightAt: 2,
    };
  }
  const front = seconds < leash[0] ? 0 : clamp01((seconds - leash[0]) / (leash[1] - leash[0])) ** 1.15;
  const share = clamp01((seconds - bind[0]) / (bind[1] - bind[0]));
  const ratchetAt = RATCHETS.map((at) => bind[0] + at * (bind[1] - bind[0]));
  const jerk = struck ? 0 : ratchetAt.reduce((most, at) => (seconds >= at ? Math.max(most, Math.exp(-(seconds - at) / 0.06)) : most), 0);
  const flash = struck ? Math.exp(-since / 0.09) : 0;
  // once the body is taken the tendrils slacken: their kinks come back and the cage opens a little
  const slack = struck ? smooth(0.15, 0.7, since) : 0;
  const closing = seconds < bind[0] ? 0 : struck ? 1 - 0.35 * slack : ratchet(share);
  const standing = struck && seconds < collapse[0];
  return {
    hand: smooth(0, 0.18, seconds) * (1 - smooth(leash[0], leash[0] + 0.12, seconds)) + 0.3 * smooth(leash[0], leash[1], seconds) * (1 - smooth(snap, snap + 0.2, seconds)),
    front, leash: seconds < leash[0] ? 0 : 1 - smooth(snap, snap + 0.1, seconds),
    open: sinceSnap < 0 ? 0 : ringOpen(sinceSnap) * (1 - 0.12 * closing) * (1 - 0.85 * collapsed),
    ring: sinceSnap < 0 || done ? 0 : (1 + 0.8 * Math.exp(-sinceSnap / 0.1) + 0.5 * jerk + 0.6 * flash) * (1 - collapsed) * (1 - ending),
    climb: smooth(climb[0], climb[1], seconds) * (1 - collapsed * collapsed),
    // the cage steps back while the tendrils bind, so it is they that are watched, and flares with the crush
    cage: sinceSnap < 0 ? 0 : (0.8 - 0.3 * smooth(bind[0] - 0.1, bind[0] + 0.1, seconds) * (struck ? 0 : 1) + 0.3 * jerk + 0.9 * flash) * smooth(climb[0], climb[0] + 0.08, seconds) * (1 - smooth(0.4, 1, collapsed)),
    reach: smooth(reach[0], reach[1], seconds) * (1 - smooth(0, 0.6, collapsed)),
    tendrils: seconds < reach[0] ? 0 : (0.95 + 0.6 * jerk + 1.1 * flash) * (1 - 0.4 * slack) * (1 - smooth(0.3, 0.8, collapsed)),
    taut: seconds < bind[0] ? 0 : struck ? 1 - 0.7 * slack : 0.35 + 0.65 * share,
    squeeze: closing,
    rim: sinceSnap < 0 ? 0 : smooth(snap + 0.08, snap + 0.3, seconds) * (standing || !struck ? 1 : 1 - collapsed) * (1 - smooth(0.2, 0.7, collapsed)),
    sinceStrike: since, sinceSnap, flash, jerk, restrike: 21, collapse: collapsed, scorch,
    heat: sinceSnap < 0 ? 0 : (struck ? 0.6 + 0.4 * flash : 0.5) * (1 - smooth(collapse[1], duration - 0.2, seconds)),
    struck, done,
    shake: done ? 0 : Math.min(1, 0.2 * (sinceSnap >= 0 ? Math.exp(-sinceSnap / 0.1) : 0) + 0.1 * jerk + (struck ? 0.55 * (0.7 + 0.3 * power) * Math.exp(-since / 0.15) : 0) + (standing ? 0.03 : 0)),
    light: done ? 0 : seconds < leash[0] ? 0.6 * smooth(0, 0.2, seconds) : seconds < snap ? 1 : (1.1 + 0.6 * jerk + 3.6 * flash) * (1 - smooth(0.3, 1, collapsed)) + 0.3 * (1 - ending) * collapsed,
    lightAt: seconds < leash[0] ? 0 : seconds < snap ? 1 : 2,
  };
}

/**
 * Where on the victim each limb a tendril binds is: the figure stands on `stone` facing `toward` (the caster), and
 * `chest` is the height of its chest above the stone. Ankles, wrists and throat first, then knees and waist.
 */
export function snareLimbs(stone: Point, toward: Point, chest: number, count: number): Point[] {
  const dx = toward.x - stone.x, dz = toward.z - stone.z, far = Math.hypot(dx, dz);
  const fx = far > 1e-5 ? dx / far : 0, fz = far > 1e-5 ? dz / far : 1, rx = -fz, rz = fx, scale = Math.max(0.4, chest) / 0.95;
  // across, forward, up, as a figure about 1.75 tall stands
  const places: Record<(typeof LIMBS)[number], [number, number, number]> = {
    "ankle-l": [-0.11, 0.02, 0.09], "ankle-r": [0.11, 0.02, 0.09], "wrist-l": [-0.3, 0.1, 0.92], "wrist-r": [0.3, 0.1, 0.92], throat: [0, 0.02, 1.38],
    "knee-l": [-0.12, 0.05, 0.46], "knee-r": [0.12, 0.05, 0.46], waist: [0, 0, 0.8],
  };
  return LIMBS.slice(0, clamp(Math.round(count), 0, LIMBS.length)).map((limb) => {
    const [across, forward, up] = places[limb];
    return { x: stone.x + (rx * across + fx * forward) * scale, y: stone.y + up * scale, z: stone.z + (rz * across + fz * forward) * scale };
  });
}

/** The bearing about the stone a tendril leaves the ring at, for the limb at `limb`: straight out under it, nudged by a die. */
export function tendrilRoot(stone: Point, limb: Point, die: number): number {
  const angle = Math.atan2(limb.z - stone.z, limb.x - stone.x), out = Math.hypot(limb.x - stone.x, limb.z - stone.z);
  // a limb on the figure's middle line (the throat, the waist) is reached from either side, by the die
  return (out < 0.03 ? die * TAU : angle) + (die - 0.5) * 0.7;
}

/**
 * How far along its path tendril `index` of `count` has crawled when the tendrils together are `reach` of the way:
 * they leave one after another, the ankles first.
 */
export function tendrilHead(reach: number, index: number, count: number): number {
  const stagger = count > 1 ? (index / (count - 1)) * 0.3 : 0;
  return clamp01((reach - stagger) / 0.7);
}

export interface SnareCast {
  stone: Point;
  /** Where the hand is when the cast is made, and the line the leash runs: from the caster's feet to the ring. */
  hand: Point;
  limbs: readonly Point[];
  timeline: SnareTimeline;
  size: SnareSize;
  counts: SnareBudget;
  power: number;
  seed: number;
  tile: number;
}

/** Where the leash meets the stone, and where it reaches the ring: half a square out from the caster, to the ring's near edge. */
export function leashLine(cast: { stone: Point; hand: Point; size: SnareSize; tile: number }): { from: Point; to: Point; length: number } {
  const { stone, hand, size, tile } = cast, dx = stone.x - hand.x, dz = stone.z - hand.z, reach = Math.hypot(dx, dz);
  const ax = reach > 1e-5 ? dx / reach : 0, az = reach > 1e-5 ? dz / reach : -1, lead = Math.min(0.5 * tile, 0.3 * reach), stop = Math.max(lead, reach - size.ring);
  const from = { x: hand.x + ax * lead, y: stone.y, z: hand.z + az * lead }, to = { x: hand.x + ax * stop, y: stone.y, z: hand.z + az * stop };
  return { from, to, length: Math.hypot(to.x - from.x, to.z - from.z) };
}

export interface SnareParticles {
  /** Sparks, embers and the drawn glow: added light. */
  light: Particle[];
  /** Dust and smoke: it covers what is behind it. */
  matter: Particle[];
}

/**
 * Everything loose in a cast, with its birth times, written once. Particles marked `anchored` are placed relative
 * to the caster's hand and follow it.
 */
export function snareParticles(cast: SnareCast): SnareParticles {
  const { stone, limbs, timeline, size, counts, power, tile } = cast, dice = sequence(cast.seed ^ 0x5a4e), unit = tile / 1.02, brief = timeline.brief;
  const { gather, leash, snap, bind, strikeAt, collapse, duration } = timeline, zero = { x: 0, y: 0, z: 0 };
  const light: Particle[] = [], matter: Particle[] = [], sparks = counts.sparks;
  const line = leashLine(cast), chest = { x: stone.x, y: stone.y + 0.95 * unit, z: stone.z };

  // the hand: a knot of light that tightens, and sparks spat off it
  light.push({ kind: PARTICLE_KIND.halo, origin: zero, velocity: zero, birth: 0, life: gather[1] + 0.25, size: 0.3 * unit, tone: 0.5, anchored: true, fadeIn: 0.4 });
  light.push({ kind: PARTICLE_KIND.mote, origin: zero, velocity: zero, birth: 0.05, life: gather[1] + 0.1, size: 0.075 * unit, tone: 0.95, anchored: true, fadeIn: 0.5 });
  if (!brief) {
    for (let i = 0; i < Math.round(sparks * 0.08); i += 1) {
      const way = scatter(dice), speed = 0.8 + 1.4 * dice();
      light.push({ kind: PARTICLE_KIND.streak, origin: { x: way.x * 0.06, y: way.y * 0.06, z: way.z * 0.06 }, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: dice() * gather[1], life: 0.12 + 0.12 * dice(), size: 0.01 * unit, drag: 3, gravity: 2, tone: 0.8 + 0.2 * dice(), anchored: true });
    }
    // the leash's track: sparks thrown up as its tip passes, and embers left lying where it ran, cooling
    for (let i = 0; i < Math.round(sparks * 0.16); i += 1) {
      const along = dice(), at = { x: line.from.x + (line.to.x - line.from.x) * along, y: stone.y + 0.02, z: line.from.z + (line.to.z - line.from.z) * along };
      const passes = leash[0] + along ** (1 / 1.15) * (leash[1] - leash[0]), way = scatter(dice, 0.2, 0.9), speed = 0.6 + 1.6 * dice();
      const ember = i % 2 === 0;
      light.push(ember
        ? { kind: PARTICLE_KIND.mote, origin: { x: at.x + (dice() - 0.5) * 0.06, y: at.y, z: at.z + (dice() - 0.5) * 0.06 }, velocity: zero, birth: passes, life: 0.5 + 0.6 * dice(), size: (0.012 + 0.01 * dice()) * unit, tone: 0.85, fadeIn: 0.05 }
        : { kind: PARTICLE_KIND.streak, origin: at, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: passes, life: 0.18 + 0.2 * dice(), size: 0.011 * unit, drag: 1.5, gravity: 5, tone: 0.75 + 0.25 * dice() });
    }
    // the snap: sparks thrown low off the ring as it slams open
    for (let i = 0; i < Math.round(sparks * 0.18); i += 1) {
      const angle = dice() * TAU, way = scatter(dice, 0.05, 0.45), speed = (1.5 + 2.5 * dice()) * unit, out = Math.hypot(way.x, way.z) || 1;
      light.push({ kind: PARTICLE_KIND.streak, origin: { x: stone.x + Math.cos(angle) * size.ring, y: stone.y + 0.03, z: stone.z + Math.sin(angle) * size.ring }, velocity: { x: (Math.cos(angle) * out) * speed, y: way.y * speed, z: (Math.sin(angle) * out) * speed }, birth: snap + 0.04 * dice(), life: 0.2 + 0.3 * dice(), size: (0.011 + 0.008 * dice()) * unit, drag: 1.4, gravity: 6, tone: 0.7 + 0.3 * dice() });
    }
    // each ratchet: a spit of sparks off every coil
    for (const at of RATCHETS) {
      const moment = bind[0] + at * (bind[1] - bind[0]);
      for (const limb of limbs) for (let i = 0; i < Math.max(1, Math.round(sparks * 0.012)); i += 1) {
        const way = scatter(dice, -0.3, 0.8), speed = 0.7 + 1.3 * dice();
        light.push({ kind: PARTICLE_KIND.streak, origin: limb, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: moment + 0.02 * dice(), life: 0.15 + 0.15 * dice(), size: 0.009 * unit, drag: 2, gravity: 4, tone: 0.85 });
      }
    }
    // the crush: a flash at the chest, and sparks burst off every coil
    light.push({ kind: PARTICLE_KIND.halo, origin: chest, velocity: zero, birth: strikeAt, life: 0.32, size: 1.5 * unit * (0.8 + 0.25 * power), tone: 0.6, fadeIn: 0.08 });
    light.push({ kind: PARTICLE_KIND.mote, origin: chest, velocity: zero, birth: strikeAt, life: 0.2, size: 0.42 * unit, tone: 1, fadeIn: 0.1 });
    for (let i = 0; i < Math.round(sparks * 0.3); i += 1) {
      const limb = limbs[i % Math.max(1, limbs.length)] ?? chest, way = scatter(dice, -0.2, 0.9), speed = (1.4 + 2.8 * dice()) * unit;
      light.push({ kind: PARTICLE_KIND.streak, origin: limb, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: strikeAt + 0.03 * dice(), life: 0.25 + 0.35 * dice(), size: (0.011 + 0.008 * dice()) * unit, drag: 1.6, gravity: 6, tone: 0.75 + 0.25 * dice() });
    }
  }
  // the glow of the cage, drawn, because the lowest tier has no bloom to make it
  const shown = brief ? timeline.climb[0] : snap;
  light.push({ kind: PARTICLE_KIND.halo, origin: { x: stone.x, y: stone.y + 0.8 * unit, z: stone.z }, velocity: zero, birth: shown, life: collapse[1] - shown, size: size.ring * 2.6, tone: 0.2, fadeIn: 0.12 });
  // the hold: sparks shed off the coils and the ring while it stands
  const hold = Math.max(0.2, collapse[0] - strikeAt);
  for (let i = 0; i < Math.round(sparks * 0.12); i += 1) {
    const onRing = i % 2 === 0, angle = dice() * TAU, limb = limbs[i % Math.max(1, limbs.length)] ?? chest, way = scatter(dice, 0.1, 0.9), speed = brief ? 0.25 : 0.5 + 1.0 * dice();
    const origin = onRing ? { x: stone.x + Math.cos(angle) * size.ring, y: stone.y + 0.03, z: stone.z + Math.sin(angle) * size.ring } : limb;
    light.push({ kind: brief ? PARTICLE_KIND.mote : PARTICLE_KIND.streak, origin, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: strikeAt + 0.05 + hold * dice(), life: 0.2 + 0.3 * dice(), size: 0.01 * unit, drag: 1.5, gravity: brief ? 0 : 4, tone: 0.7 + 0.3 * dice() });
  }
  // the collapse: a breath of sparks off the ring as it burns out, then embers lying in the scorched disc
  for (let i = 0; i < Math.round(sparks * 0.14); i += 1) {
    const angle = dice() * TAU, r = size.ring * (0.3 + 0.7 * Math.sqrt(dice()));
    light.push({ kind: PARTICLE_KIND.mote, origin: { x: stone.x + Math.cos(angle) * r, y: stone.y + 0.02, z: stone.z + Math.sin(angle) * r }, velocity: { x: 0, y: (brief ? 0.08 : 0.12 + 0.25 * dice()) * unit, z: 0 }, birth: collapse[0] + (collapse[1] - collapse[0]) * dice(), life: 0.6 + 0.7 * dice(), size: (0.01 + 0.01 * dice()) * unit, drag: 1.2, gravity: -0.3, tone: 0.6 + 0.3 * dice(), wander: 0.04 });
  }

  // matter: the snap throws dust out along the stone; the scorched disc smokes from the crush to the end
  const thrown = brief ? 0 : Math.round(counts.smoke * 0.4);
  for (let i = 0; i < thrown; i += 1) {
    const angle = (i / Math.max(1, thrown)) * TAU + dice() * 0.5, push = (1.6 + 1.6 * dice()) * unit;
    matter.push({ kind: PARTICLE_KIND.puff, origin: { x: stone.x + Math.cos(angle) * size.ring * 0.95, y: stone.y + (0.07 + 0.08 * dice()) * unit, z: stone.z + Math.sin(angle) * size.ring * 0.95 }, velocity: { x: Math.cos(angle) * push, y: 0.12, z: Math.sin(angle) * push }, birth: snap + 0.03 * dice(), life: 0.9 + 0.6 * dice(), size: (0.14 + 0.08 * dice()) * unit, drag: 3.2, tone: 0.35 + 0.4 * dice(), grow: 2.3, fadeIn: 0.12, wander: 0.05 });
  }
  for (let i = 0; i < counts.smoke - thrown; i += 1) {
    const angle = dice() * TAU, r = size.ring * 0.85 * Math.sqrt(dice()), from = brief ? timeline.bind[0] : strikeAt;
    matter.push({ kind: PARTICLE_KIND.puff, origin: { x: stone.x + Math.cos(angle) * r, y: stone.y + 0.1 * unit, z: stone.z + Math.sin(angle) * r }, velocity: { x: (dice() - 0.5) * 0.25, y: (brief ? 0.2 : 0.35 + 0.45 * dice()) * unit, z: (dice() - 0.5) * 0.25 }, birth: from + (duration - 0.8 - from) * dice(), life: 1.1 + 0.7 * dice(), size: (0.15 + 0.1 * dice()) * unit, drag: 0.8, gravity: -0.35, tone: 0.1 + 0.35 * dice(), grow: 2.6, fadeIn: 0.25, wander: 0.15 });
  }
  // nothing outlives the spell, and nothing is born in its last moment
  const within = (list: Particle[]) => list.filter((particle) => particle.birth < duration - 0.06).map((particle) => ({ ...particle, life: Math.min(particle.life, duration - particle.birth) }));
  return { light: within(light), matter: within(matter) };
}

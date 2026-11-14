// Adapted from SoldierThirdPersonThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The sun pillar, as arithmetic: Solforiz's Bishop and Queen call sunlight down on the victim. No Three.js in
 * here, so the node tests reach it (shared/play/spell-sun-pillar.test.ts); sun/sunPillar.ts draws what this
 * decides.
 *
 * One clock, in order:
 *
 *   gather    the caster's raised hand fills with light
 *   pen       two pens leave the side of the victim's square nearest the caster and draw a ring round the victim,
 *             meeting at the far side
 *   warn      the ring brightens in quickening pulses, the stone inside it warms, motes lift off it, and a thread
 *             of sunlight comes down from the sky and finds it
 *   fall      the column's head comes down the thread, faster and faster; `strikeAt` is the moment it lands
 *   burn      a white-hot core in a golden sheath stands on the square with heat climbing it; a shock runs out
 *             along the stone, which cracks hot behind it, and sparks, dust and grit are thrown
 *   collapse  the column thins and comes apart from the top down into strands, and the strands into embers that
 *             drift and cool
 *   cool      the ring and the cracks in the stone go from gold through red to dark
 *
 * From the reference's Ascendance (a sigil at the feet, a shaft out of the sky with a descending front, motes):
 * the order of a mark and then a shaft, and a shaft whose head travels. Ours: it is a blow, not a blessing, so
 * the ring warns before it lands; a thread comes first for the column to come down; the column burns for about
 * a second and collapses instead of standing ten; a Queen's has a corona of lesser shafts that close round the
 * victim first; and reduced motion has its own gentler form.
 */
import type { QualityPreset } from "../../../quality";
import { smooth, type Point } from "../../mystic/beamPlan";
import { PARTICLE_KIND, byPower, scatter, sequence, type Particle } from "../shared/particlePlan";
import type { Solid } from "../shared/solidPlan";

export interface SunBudget {
  /** Embers the column lifts while it burns and sheds as it collapses. */
  embers: number;
  /** Sparks: off the pens, and thrown along the stone by the blow. */
  sparks: number;
  /** Motes that lift off the stone inside the ring while it warns. */
  motes: number;
  /** Puffs of dust and smoke. */
  dust: number;
  /** Hot grit thrown off the stone: lit solids. */
  grit: number;
  /** Faces round the column. */
  radial: number;
  /** Heat cracks drawn in the stone: 0 for none. */
  cracks: number;
}

/** What a Bishop's sun pillar is drawn with at each quality tier; a Queen's is larger by her power. */
export const SUN_BUDGET: Readonly<Record<QualityPreset, SunBudget>> = {
  low: { embers: 60, sparks: 30, motes: 14, dust: 10, grit: 0, radial: 20, cracks: 0 },
  medium: { embers: 130, sparks: 60, motes: 26, dust: 18, grit: 8, radial: 28, cracks: 9 },
  high: { embers: 220, sparks: 100, motes: 40, dust: 28, grit: 14, radial: 40, cracks: 13 },
  ultra: { embers: 320, sparks: 140, motes: 56, dust: 38, grit: 20, radial: 48, cracks: 17 },
};

/** A Queen's cast, from this power up, has a corona of lesser shafts round the ring. */
export const CORONA_POWER = 1.4;

export interface SunSizes {
  /** The ring drawn on the stone. */
  ring: number;
  /** The golden sheath and the white core inside it. */
  column: number;
  core: number;
  /** How high the column stands before it is lost in the sky. */
  height: number;
  /** How far the shock runs along the stone. */
  reach: number;
  /** How many lesser shafts stand on the ring. */
  corona: number;
  /** How high the column's foot thins once it has struck, so the body burning in it is seen (SunState.clear). */
  clear: number;
}

/** The sizes of a cast: the ring fits the victim's square for a Bishop and spills a little over it for a Queen. */
export function sunSizes(power: number, tile: number): SunSizes {
  const ring = 0.46 * tile * (1 + 0.24 * (power - 1));
  return { ring, column: ring * 0.8, core: ring * 0.3, height: 14 * (tile / 1.02), reach: ring * (3.2 + 0.6 * (power - 1)), corona: power >= CORONA_POWER ? 6 : 0, clear: 1.5 * (tile / 1.02) };
}

export interface SunTimeline {
  /** The hand fills with light. */
  gather: readonly [number, number];
  /** The pens draw the ring. */
  pen: readonly [number, number];
  /** The ring warns, until the column lands. */
  warn: readonly [number, number];
  /** The column's head leaves the sky, and reaches the stone. */
  fall: readonly [number, number];
  strikeAt: number;
  /** The column starts to come apart, and is gone. */
  collapse: readonly [number, number];
  duration: number;
  brief: boolean;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const round = (value: number) => +value.toFixed(3);

/**
 * The timeline of a cast. It does not depend on how far away the caster stands: the light comes from above. A
 * Queen's burns longer. The brief form (reduced motion, fast play) brings the ring up whole and the column up
 * softly where it stands: nothing falls.
 */
export function sunTimeline(power: number, brief: boolean): SunTimeline {
  if (brief) return { gather: [0, 0.3], pen: [0, 0.5], warn: [0.3, 0.8], fall: [0.5, 0.8], strikeAt: 0.8, collapse: [1.6, 2.3], duration: 2.5, brief: true };
  const strikeAt = 1.52, burn = 0.9 + 0.35 * (power - 1), collapse = strikeAt + burn;
  return { gather: [0, 0.45], pen: [0.15, 0.75], warn: [0.75, strikeAt], fall: [1.3, strikeAt], strikeAt, collapse: [round(collapse), round(collapse + 1.2)], duration: round(collapse + 2.1), brief: false };
}

/** How long before the column's own head a Queen's corona may begin to fall. */
const CORONA_LEAD = 0.3;

/** When the ring pulses during the warning, as shares of the warning: closer together as the column nears. */
export const WARN_PULSES = [0.2, 0.5, 0.72, 0.87, 0.96] as const;

export interface SunState {
  /** The light in the caster's hand, 0..1. */
  hand: number;
  /** How much of the ring the pens have drawn, 0..1. */
  drawn: number;
  /** How brightly the ring burns: 0.6 as it is drawn, 1 at the end of the warning, more in a pulse and at the blow. */
  ring: number;
  /** How far the warning has built, 0..1. */
  warn: number;
  /** The thread of sunlight that finds the ring, 0..1. */
  thread: number;
  /** Seconds since the column's head left the sky; negative before it (a Queen's corona falls a little earlier). */
  sinceFall: number;
  /** The column's strength, 0..1. */
  column: number;
  /** A factor on the column's radius: it swells as it lands and narrows as it collapses. */
  width: number;
  /** How far the column has come apart, 0..1. */
  erode: number;
  /**
   * How far the column's foot has thinned since it landed, 0..1: narrower and dimmer up to SunSizes.clear, so the body
   * burning in it is seen. At the blow it stands whole and swallows the square; a beat later it lets the kill be seen.
   */
  clear: number;
  /** True from the moment the column lands. */
  struck: boolean;
  /** Seconds since then, or -1 before it. */
  sinceStrike: number;
  /** The flash of the blow, 0..1, gone in a quarter of a second. */
  flash: number;
  /** How hot the stone is, 0..1: it warms through the warning, is white at the blow, and cools to nothing. */
  heat: number;
  /** How charred the stone is, 0..1. It lifts at the very end: the match's own burn mark is what stays. */
  scorch: number;
  /** Camera shake, 0 in the brief form. */
  shake: number;
  /** The light it throws: about 1 warning, several at the blow. */
  glow: number;
  done: boolean;
}

/** What the spell is doing `seconds` after the cast. */
export function sunState(timeline: SunTimeline, seconds: number, power = 1): SunState {
  const { gather, pen, warn, fall, strikeAt, collapse, duration, brief } = timeline;
  const struck = seconds >= strikeAt, since = struck ? seconds - strikeAt : -1;
  const warned = clamp((seconds - warn[0]) / (warn[1] - warn[0]), 0, 1), warning = brief ? smooth(warn[0], warn[1], seconds) : warned ** 1.5;
  const drawn = brief ? 1 : clamp((seconds - pen[0]) / (pen[1] - pen[0]), 0, 1);
  const shown = brief ? smooth(pen[0], pen[1], seconds) : 1;
  const pulse = brief || struck || seconds < warn[0] ? 0 : WARN_PULSES.reduce((most, at) => Math.max(most, Math.exp(-(((warned - at) / 0.035) ** 2))), 0);
  const erode = smooth(collapse[0], collapse[1], seconds), ending = smooth(duration - 0.5, duration, seconds);
  const flash = brief || !struck ? 0 : Math.exp(-since / 0.1);
  const standing = brief ? smooth(fall[0], fall[1] + 0.25, seconds) : seconds >= fall[0] - CORONA_LEAD ? 1 : 0;
  const column = standing * (1 - smooth(collapse[0] + 0.3 * (collapse[1] - collapse[0]), collapse[1], seconds));
  const cooled = struck ? Math.exp(-Math.max(0, since - 0.25) / 0.95) : 0;
  return {
    hand: smooth(gather[0], gather[1], seconds) * (1 - smooth(strikeAt, strikeAt + 0.35, seconds)),
    drawn, warn: warning,
    ring: shown * (struck ? (0.5 + 0.9 * cooled) * (1 - ending) : (drawn > 0 ? 0.6 : 0) + 0.4 * warning + 0.6 * pulse),
    thread: brief ? 0 : smooth(warn[0] + 0.1, warn[0] + 0.3, seconds) * (1 - smooth(fall[0], strikeAt, seconds)),
    sinceFall: seconds - fall[0],
    column, width: (1 + 0.3 * flash) * (1 - 0.5 * erode), erode, clear: struck ? smooth(0.08, 0.35, since) : 0,
    struck, sinceStrike: since, flash,
    heat: (struck ? Math.max(cooled, 0.8 * column) : 0.3 * warning) * (1 - ending),
    scorch: struck ? smooth(0, 0.3, since) * (1 - smooth(duration - 0.45, duration, seconds)) : 0,
    shake: brief || !struck ? 0 : 0.6 * (0.7 + 0.3 * power) * Math.exp(-since / 0.2) + (seconds < collapse[0] ? 0.06 : 0),
    glow: brief ? 1.3 * column + 0.4 * smooth(warn[0], warn[1], seconds) * (1 - erode) : (struck ? 0 : 0.3 * drawn + 0.7 * warning + 0.5 * pulse) + 3 * flash + 1.6 * (struck ? column : 0) + 0.5 * cooled * (1 - ending),
    done: seconds >= duration,
  };
}

/** How far down the column's head has come `sinceFall` seconds after it left the sky: 0 in the sky, 1 on the stone. */
export function headFallen(timeline: SunTimeline, sinceFall: number, delay = 0): number {
  if (timeline.brief) return 1;
  const fell = clamp((sinceFall - delay) / (timeline.fall[1] - timeline.fall[0]), 0, 1);
  return fell * fell;
}

/** One shaft of the column: the sheath, the core, the thread that comes first, or a lesser shaft of a Queen's corona. */
export interface SunShaft {
  kind: "sheath" | "core" | "thread" | "corona";
  /** Where it stands, from the centre of the ring, and how wide it is. */
  x: number;
  z: number;
  radius: number;
  /** Seconds after the main column's head leaves the sky that this one's does; negative is before. */
  delay: number;
}

/** The shafts of a cast. A Queen's corona lands first, one shaft after another round the ring, and the column inside it. */
export function sunShafts(sizes: SunSizes, timeline: SunTimeline): SunShaft[] {
  const shafts: SunShaft[] = [
    { kind: "sheath", x: 0, z: 0, radius: sizes.column, delay: 0 },
    { kind: "core", x: 0, z: 0, radius: sizes.core, delay: 0 },
    { kind: "thread", x: 0, z: 0, radius: 0.04 * (sizes.ring / 0.47), delay: 0 },
  ];
  const fall = timeline.fall[1] - timeline.fall[0];
  for (let i = 0; i < sizes.corona; i += 1) {
    const turn = (i / sizes.corona) * Math.PI * 2 + 0.5;
    shafts.push({ kind: "corona", x: Math.cos(turn) * sizes.ring, z: Math.sin(turn) * sizes.ring, radius: sizes.ring * 0.11, delay: timeline.brief ? 0 : -fall * (1.1 - 0.12 * i) });
  }
  return shafts;
}

export interface SunCast {
  stone: Point;
  /** Where the hand is when the cast is made: the pens start on the side of the ring that faces it. */
  hand: Point;
  timeline: SunTimeline;
  sizes: SunSizes;
  budget: SunBudget;
  power: number;
  seed: number;
  tile: number;
}

/** The angle, about the stone, of the side of the ring nearest the caster: where the pens start. */
export function penStart(cast: { stone: Point; hand: Point }): number {
  return Math.atan2(cast.hand.z - cast.stone.z, cast.hand.x - cast.stone.x);
}

export interface SunParticles {
  /** Sparks, motes, embers and the drawn glow: added light. */
  light: Particle[];
  /** Dust and smoke: it covers what is behind it and is lit by the column. */
  dust: Particle[];
}

/**
 * Everything loose in a cast, with its birth times, written once. Particles marked `anchored` are placed relative
 * to the caster's hand and follow it.
 */
export function sunParticles(cast: SunCast): SunParticles {
  const { stone, timeline, sizes, budget, power, tile } = cast, dice = sequence(cast.seed ^ 0x5a17), unit = tile / 1.02, brief = timeline.brief;
  const { strikeAt, collapse, warn, pen, duration } = timeline, zero = { x: 0, y: 0, z: 0 };
  const light: Particle[] = [], dust: Particle[] = [];
  const sparks = byPower(budget.sparks, power), embers = byPower(budget.embers, power), motes = byPower(budget.motes, power), puffs = byPower(budget.dust, power);
  const inRing = (share: number, lift: number) => { const turn = dice() * 6.283, out = sizes.ring * share * Math.sqrt(dice()); return { x: stone.x + Math.cos(turn) * out, y: stone.y + lift, z: stone.z + Math.sin(turn) * out }; };

  // the hand: a glow, a small sun in it, and sparks that climb off it
  light.push({ kind: PARTICLE_KIND.halo, origin: zero, velocity: zero, birth: 0, life: strikeAt + 0.4, size: 0.4 * unit, tone: 0.6, anchored: true, fadeIn: 0.25 });
  light.push({ kind: PARTICLE_KIND.mote, origin: zero, velocity: zero, birth: 0, life: strikeAt + 0.25, size: 0.12 * unit, tone: 0.95, anchored: true, fadeIn: 0.3 });
  if (!brief) for (let i = 0; i < Math.round(sparks * 0.08); i += 1) {
    const way = scatter(dice, 0.5, 1);
    light.push({ kind: PARTICLE_KIND.mote, origin: { x: way.x * 0.05, y: 0, z: way.z * 0.05 }, velocity: { x: way.x * 0.3, y: 0.5 + 0.8 * dice(), z: way.z * 0.3 }, birth: dice() * strikeAt * 0.9, life: 0.4 + 0.3 * dice(), size: 0.018 * unit, drag: 1, gravity: -1.2, tone: 0.8, anchored: true });
  }

  // the pens: sparks where they cut the stone
  if (!brief) {
    const start = penStart(cast);
    for (let i = 0; i < Math.round(sparks * 0.22); i += 1) {
      const share = dice(), turn = start + (i % 2 === 0 ? 1 : -1) * Math.PI * share, way = scatter(dice, 0.3, 0.95), speed = 0.4 + 0.9 * dice();
      light.push({ kind: PARTICLE_KIND.streak, origin: { x: stone.x + Math.cos(turn) * sizes.ring, y: stone.y + 0.02, z: stone.z + Math.sin(turn) * sizes.ring }, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: pen[0] + share * (pen[1] - pen[0]) + 0.02 * dice(), life: 0.22 + 0.25 * dice(), size: 0.012 * unit, drag: 1, gravity: 3, tone: 0.75 + 0.25 * dice() });
    }
  }

  // the warning: motes lift off the warming stone, more of them as the column nears
  for (let i = 0; i < motes; i += 1) {
    light.push({ kind: PARTICLE_KIND.mote, origin: inRing(0.92, 0.02), velocity: { x: 0, y: (brief ? 0.15 : 0.3) + (brief ? 0.3 : 0.5) * dice(), z: 0 }, birth: warn[0] + (warn[1] - warn[0]) * dice() ** 0.6 * (brief ? 2.4 : 1), life: 0.6 + 0.5 * dice(), size: (0.02 + 0.016 * dice()) * unit, drag: 0.8, gravity: -0.7, tone: 0.5 + 0.4 * dice(), wander: 0.05 });
  }

  // the blow: a flash drawn round the foot of the column, and sparks thrown low along the stone
  const foot = { x: stone.x, y: stone.y + 0.5 * unit, z: stone.z };
  light.push({ kind: PARTICLE_KIND.halo, origin: { x: stone.x, y: stone.y + 0.9 * unit, z: stone.z }, velocity: zero, birth: brief ? timeline.fall[0] : strikeAt, life: collapse[0] + 0.5 * (collapse[1] - collapse[0]) - (brief ? timeline.fall[0] : strikeAt), size: sizes.ring * 3.4, tone: 0.5, fadeIn: brief ? 0.4 : 0.05 });
  if (!brief) {
    light.push({ kind: PARTICLE_KIND.halo, origin: foot, velocity: zero, birth: strikeAt, life: 0.3, size: sizes.ring * 3.4, tone: 0.6, fadeIn: 0.1 });
    for (let i = 0; i < Math.round(sparks * 0.7); i += 1) {
      const way = scatter(dice, 0.03, 0.5), speed = (3 + 5.5 * dice()) * unit * (0.85 + 0.15 * power), turn = Math.atan2(way.z, way.x);
      light.push({ kind: PARTICLE_KIND.streak, origin: { x: stone.x + Math.cos(turn) * sizes.column, y: stone.y + 0.05 + 0.2 * dice(), z: stone.z + Math.sin(turn) * sizes.column }, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: strikeAt + 0.03 * dice(), life: 0.3 + 0.45 * dice(), size: (0.016 + 0.012 * dice()) * unit, drag: 1.2, gravity: 9, tone: 0.75 + 0.25 * dice() });
    }
  }

  // the burn: embers caught in the column and carried up it
  const lifted = Math.round(embers * 0.42), from = brief ? timeline.fall[0] + 0.2 : strikeAt, until = collapse[0] + 0.3;
  for (let i = 0; i < lifted; i += 1) {
    const origin = inRing(0.7, (0.05 + 2.4 * dice() * dice()) * unit), fast = !brief && i % 3 === 0;
    light.push({ kind: fast ? PARTICLE_KIND.streak : PARTICLE_KIND.mote, origin, velocity: { x: (origin.x - stone.x) * 0.6, y: (brief ? 0.5 : 1.4 + 3.2 * dice()) * unit, z: (origin.z - stone.z) * 0.6 }, birth: from + (until - from) * dice(), life: 0.7 + 0.7 * dice(), size: (0.012 + 0.024 * dice() * dice()) * unit, drag: 0.9, gravity: -1.6, tone: 0.45 + 0.4 * dice(), wander: 0.12 });
  }
  // the collapse: the strands of the column break into embers, the top's first, which drift off and cool
  const span = collapse[1] - collapse[0];
  for (let i = 0; i < embers - lifted; i += 1) {
    const up = dice() * dice(), high = 4.5 * unit * up, way = scatter(dice, -0.2, 0.6), speed = (brief ? 0.2 : 0.25 + 0.75 * dice()) * unit;
    const origin = inRing(0.75, 0.1 * unit + high);
    light.push({ kind: PARTICLE_KIND.mote, origin, velocity: { x: way.x * speed, y: (brief ? 0.1 : 0.2 + 0.6 * dice()) * unit, z: way.z * speed }, birth: collapse[0] + span * (0.1 + 0.55 * (1 - up) + 0.25 * dice()), life: 1 + 0.9 * dice(), size: (0.01 + 0.03 * dice() * dice()) * unit, drag: 1.4, gravity: -0.35, tone: 0.3 + 0.35 * dice(), wander: 0.25, fadeIn: 0.05 });
  }

  // matter: dust driven out along the stone by the blow, and smoke off the scorched square as the column lets go
  const ring = brief ? 0 : Math.round(puffs * 0.6);
  for (let i = 0; i < ring; i += 1) {
    const turn = (i / ring) * 6.283 + dice() * 0.5, push = (2.4 + 2.2 * dice()) * unit;
    dust.push({ kind: PARTICLE_KIND.puff, origin: { x: stone.x + Math.cos(turn) * sizes.ring * 0.9, y: stone.y + (0.1 + 0.14 * dice()) * unit, z: stone.z + Math.sin(turn) * sizes.ring * 0.9 }, velocity: { x: Math.cos(turn) * push, y: 0.25, z: Math.sin(turn) * push }, birth: strikeAt + 0.04 * dice(), life: 1.3 + 0.8 * dice(), size: (0.24 + 0.14 * dice()) * unit, drag: 3, tone: 0.35 + 0.5 * dice(), grow: 2.7, fadeIn: 0.12, wander: 0.08 });
  }
  for (let i = 0; i < puffs - ring; i += 1) {
    dust.push({ kind: PARTICLE_KIND.puff, origin: inRing(0.9, 0.12 * unit), velocity: { x: (dice() - 0.5) * 0.3, y: (0.45 + 0.5 * dice()) * unit * (brief ? 0.5 : 1), z: (dice() - 0.5) * 0.3 }, birth: collapse[0] + span * dice(), life: 1.1 + 0.6 * dice(), size: (0.2 + 0.12 * dice()) * unit, drag: 0.6, gravity: -0.4, tone: 0.1 + 0.4 * dice(), grow: 2.8, fadeIn: 0.25, wander: 0.2 });
  }
  const within = (list: Particle[]) => list.map((particle) => ({ ...particle, life: Math.min(particle.life, Math.max(0.05, duration - particle.birth)) }));
  return { light: within(light), dust: within(dust) };
}

/** The grit the blow throws off the stone: small hot pieces that fly, skid and burn out. None in the brief form. */
export function sunGrit(cast: SunCast): Solid[] {
  const { stone, timeline, sizes, budget, power, tile } = cast;
  if (timeline.brief) return [];
  const dice = sequence(cast.seed ^ 0x9d3), unit = tile / 1.02, grit: Solid[] = [];
  for (let i = 0; i < byPower(budget.grit, power); i += 1) {
    const turn = dice() * 6.283, out = sizes.ring * (0.7 + 0.4 * dice()), speed = (1.2 + 2.2 * dice()) * unit, size = (0.022 + 0.03 * dice()) * unit, birth = timeline.strikeAt + 0.03 * dice();
    grit.push({
      loose: true, root: { x: stone.x + Math.cos(turn) * out, y: stone.y + 0.08 * unit, z: stone.z + Math.sin(turn) * out }, radius: size, height: size * (1 + 0.8 * dice()),
      lean: { x: 0, z: 0 }, spin: (5 + 9 * dice()) * (dice() < 0.5 ? -1 : 1), yaw: dice() * 6.283, seed: dice(), birth, rise: 0.4, breakAt: 0, end: Math.min(timeline.duration, birth + 1.6 + 0.9 * dice()),
      fling: { x: Math.cos(turn) * speed, y: (1.4 + 2.2 * dice()) * unit, z: Math.sin(turn) * speed },
    });
  }
  return grit;
}

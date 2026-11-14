// Adapted from LinearAbiltyCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The frost line, as arithmetic: Aethelgard's Bishop and Queen send a line of frost along the stone to the victim.
 * No Three.js in here, so the node tests reach it (shared/play/spell-frost-line.test.ts); frost/frostLine.ts draws
 * what this decides.
 *
 * One clock, in order:
 *
 *   gather   cold light collects in the caster's hand and is thrown down at its feet
 *   travel   rime runs along the stone, slowly at first and then fast, and a row of spikes erupts behind it, each
 *            taller than the last
 *   strike   the great spike breaks through at the end of the line, a cluster with it, and runs the victim through:
 *            up out of the stone in front of it, in at the belly and out of the back (shared/piercePlan.ts);
 *            `strikeAt` is the moment its point comes out. The piece is not burnt: it dies on the spike
 *            (vfx/spells/spell.ts `pierce`) and the match draws the wounds this reports through its gore system
 *   hold     the body hangs on the spike (`pinned`) for nearly two seconds while its blood runs down it and soaks into
 *            the rime; at Full the spike cracks in the body and it bleeds again; the field stands in its own mist
 *   shatter  the cracks in each spike light, and from the caster's end onward each breaks from its tip downward
 *            into pieces that fly, skid and melt where they stop; the great spike goes last, and lets the body fall
 *   thaw     the rime draws back from its edges and leaves the stone wet, then dry
 *
 * From the reference's Frost Lance: a front that runs a line with a field of crystals behind it, small near the
 * caster and tall at the far end, and a cluster at the point of impact; and a spike kept as dice, not as metres.
 * Ours: the rime runs ahead of the spikes instead of with them; the front accelerates into the victim; there is
 * one great spike, and the blow is the moment it runs the victim through; the field is a single row that widens, not
 * a carpet, because a chessboard has neighbours; a Queen's also raises a crown round the victim; it ends by
 * shattering in a wave, not by sinking; and reduced motion has its own gentler form. At Minimal the great spike comes
 * up beside the body instead of through it, and nothing bleeds.
 */
import type { QualityPreset } from "../../../quality";
import { smooth, type Point } from "../../mystic/beamPlan";
import { PARTICLE_KIND, between, byPower, scatter, sequence, type Particle } from "../shared/particlePlan";
import { bloodOf, bloodReachesStone, leanOf, pierceWounds, spikeThrust, torsoFrame, twistWounds, type PierceLine, type PierceWound, type Violence } from "../shared/piercePlan";
import { emergence, type Solid } from "../shared/solidPlan";

export interface FrostBudget {
  /** Spikes for each unit of the line, and the most the line may have. */
  density: number;
  line: number;
  /** Spikes thrown up round the victim, besides the great one. */
  cluster: number;
  /** Broken pieces that fly and skid. */
  chunks: number;
  /** Glitter, splinters and motes of light. */
  sparks: number;
  /** Puffs of mist. */
  mist: number;
  /** Crystal cuts the spikes are shared between: one draw each. */
  cuts: number;
}

/** What a Bishop's frost line is drawn with at each quality tier; a Queen's is larger by her power. */
export const FROST_BUDGET: Readonly<Record<QualityPreset, FrostBudget>> = {
  low: { density: 2.0, line: 8, cluster: 3, chunks: 12, sparks: 70, mist: 12, cuts: 1 },
  medium: { density: 2.8, line: 14, cluster: 5, chunks: 26, sparks: 150, mist: 22, cuts: 2 },
  high: { density: 3.6, line: 20, cluster: 6, chunks: 44, sparks: 260, mist: 34, cuts: 3 },
  ultra: { density: 4.4, line: 26, cluster: 8, chunks: 60, sparks: 380, mist: 46, cuts: 3 },
};

/** A Queen's cast, from this power up, raises a crown of spikes round the victim as well. */
export const CROWN_POWER = 1.4;

/** The line on the stone: from in front of the caster's feet to the stone under the victim. */
export interface FrostLine {
  from: Point;
  to: Point;
  length: number;
  /** The way it runs, and the way across it, on the board (x, z). */
  along: { x: number; z: number };
  across: { x: number; z: number };
}

/** The line a cast from `hand` to `stone` runs: it starts on the board half a square out from under the hand. */
export function frostLine(hand: Point, stone: Point, boardTop: number, tile: number): FrostLine {
  const dx = stone.x - hand.x, dz = stone.z - hand.z, reach = Math.hypot(dx, dz);
  const along = reach > 1e-5 ? { x: dx / reach, z: dz / reach } : { x: 0, z: -1 };
  const lead = Math.min(0.5 * tile, 0.3 * reach);
  const from = { x: hand.x + along.x * lead, y: boardTop, z: hand.z + along.z * lead };
  return { from, to: { x: stone.x, y: boardTop, z: stone.z }, length: Math.max(0.05, reach - lead), along, across: { x: -along.z, z: along.x } };
}

export interface FrostTimeline {
  /** The cold gathers in the hand. */
  gather: readonly [number, number];
  /** The line leaves the caster's feet, and reaches the victim. */
  travel: readonly [number, number];
  /** The great spike's point comes out of the victim's back. */
  strikeAt: number;
  /** At Full, the moment the great spike cracks in the body, and it bleeds again. */
  crack: number;
  /** The great spike has broken through the body and lets it fall. */
  release: number;
  /** The first spike breaks, and the last has finished breaking. */
  shatter: readonly [number, number];
  /** The rime starts to draw back, and is gone. */
  thaw: readonly [number, number];
  duration: number;
  brief: boolean;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const round = (value: number) => +value.toFixed(3);

/** How the front and the rime run the line: the rime leads, and both hurry as they near the victim. */
const FRONT_POWER = 1.7, RIME_POWER = 1.25;

/**
 * The timeline of a cast along a line `length` long. A longer line takes longer to run, within limits: a cast
 * across the whole board still lands inside a second and three quarters. The body hangs on the great spike for nearly
 * two seconds (a Queen's a little longer) while the row breaks from the caster's end toward it; then the great spike
 * breaks from its tip down and lets it fall. The brief form (reduced motion, fast play) is short and even: the rime
 * comes up along the whole line at once and the spikes ease out of it and sink back.
 */
export function frostTimeline(length: number, power: number, brief: boolean): FrostTimeline {
  if (brief) return { gather: [0, 0.15], travel: [0.15, 0.6], strikeAt: 0.6, crack: 1.1, release: 1.6, shatter: [1.5, 2.1], thaw: [1.45, 2.4], duration: 2.4, brief: true };
  const gather = 0.5, run = clamp(0.4 + 0.07 * length, 0.5, 1.1), strikeAt = gather + run;
  const breaking = strikeAt + FROST_HOLD + 0.2 * (power - 1), broken = breaking + KING_WAIT + KING_BREAK;
  const duration = broken + 1.3;
  return {
    gather: [0, gather], travel: [gather, round(strikeAt)], strikeAt: round(strikeAt), crack: round(strikeAt + 0.6), release: round(breaking + KING_WAIT + 0.6 * KING_BREAK),
    shatter: [round(breaking), round(broken)], thaw: [round(breaking + 0.25), round(duration - 0.05)], duration: round(duration), brief: false,
  };
}
/** How long after the row starts to break the great spike does, and how long it takes to break from its tip to the stone. */
const KING_WAIT = 0.55, KING_BREAK = 0.42;
/**
 * Seconds from the blow until the row starts to break (a Queen's a little later). The body hangs on the great spike
 * until the break reaches it, about 1.85 s: long enough for the match's shot to come in close and stay on the wound.
 */
export const FROST_HOLD = 1.05;

export interface FrostState {
  /** The cold in the hand, 0..1. */
  hand: number;
  /** How far along the line the rime has run, 0 at the caster's feet to 1 under the victim. It leads the spikes. */
  rime: number;
  /** How far along the line the spikes have erupted, 0..1. */
  front: number;
  /** How much of the rime there is, 0..1: the brief form brings it up whole instead of running it. */
  frost: number;
  /** True from the moment the great spike's point comes out of the victim. */
  struck: boolean;
  /** Seconds since then, or -1 before it. */
  sinceStrike: number;
  /** True while the body hangs on the great spike: from the blow until the spike has broken through it. */
  pinned: boolean;
  /** The cold light thrown on the stone by the blow, 0..1, gone in a quarter of a second. */
  flash: number;
  /** How far the rime has drawn back, 0..1. */
  thaw: number;
  /** Camera shake, 0 in the brief form. */
  shake: number;
  /** The light it throws: about 1 at rest, several at the blow. */
  glow: number;
  /** Where that light is, along the line: it rides the front and stays on the victim. */
  glowAt: number;
  done: boolean;
}

/** What the spell is doing `seconds` after the cast. */
export function frostState(timeline: FrostTimeline, seconds: number, power = 1, violence: Violence = "cinematic"): FrostState {
  const { gather, travel, strikeAt, shatter, thaw, duration, brief } = timeline;
  const run = clamp((seconds - travel[0]) / (travel[1] - travel[0]), 0, 1), struck = seconds >= strikeAt;
  const since = struck ? seconds - strikeAt : -1;
  const front = brief ? smooth(travel[0], travel[1], seconds) : run ** FRONT_POWER;
  const rime = brief ? 1 : seconds < travel[0] ? 0 : Math.min(1, (run * 1.12 + 0.04) ** RIME_POWER);
  const leaving = smooth(shatter[0], shatter[1] + 0.3, seconds);
  const hand = smooth(gather[0], gather[1] * 0.7, seconds) * (1 - smooth(gather[1], gather[1] + 0.15, seconds));
  const flash = brief || !struck ? 0 : Math.exp(-since / 0.09);
  const standing = smooth(travel[0], travel[1], seconds) * (1 - leaving);
  // at Full the spike cracks in the body: a jolt, no light
  const cracked = !brief && violence === "full" && seconds >= timeline.crack && seconds < timeline.crack + 0.5 ? 0.18 * Math.exp(-(seconds - timeline.crack) / 0.1) : 0;
  return {
    hand, rime, front, frost: brief ? smooth(0, travel[1], seconds) : 1,
    struck, sinceStrike: since, pinned: struck && seconds < timeline.release, flash, thaw: smooth(thaw[0], thaw[1], seconds),
    shake: brief ? 0 : (struck ? 0.5 * (0.7 + 0.3 * power) * Math.exp(-since / 0.16) : 0.05 * front) * (since > 0.6 ? 0 : 1) + cracked,
    // the blow is a cold snap, not a blast: its light must not hide what the spike has done
    glow: brief ? 0.8 * standing : 0.5 * hand + 0.9 * standing + 2.4 * flash,
    glowAt: front, done: seconds >= duration,
  };
}

/** When the rime reaches `along` (0..1) of the line: the inverse of the rime's run. */
export function rimeArrives(timeline: FrostTimeline, along: number): number {
  if (timeline.brief) return 0;
  const run = clamp((clamp(along, 0, 1) ** (1 / RIME_POWER) - 0.04) / 1.12, 0, 1);
  return timeline.travel[0] + run * (timeline.travel[1] - timeline.travel[0]);
}
/** When the front of spikes reaches `along` (0..1) of the line. */
export function frontArrives(timeline: FrostTimeline, along: number): number {
  return timeline.travel[0] + clamp(along, 0, 1) ** (1 / FRONT_POWER) * (timeline.travel[1] - timeline.travel[0]);
}

/** A spike of the field, with what the drawing needs beyond the solid itself. */
export interface FrostSpike extends Solid {
  /** `king` is the great spike under the victim, `cluster` stands round it, `crown` is a Queen's ring, `line` runs to it. */
  role: "king" | "cluster" | "crown" | "line";
  /** Where on the line it stands, 0..1. */
  along: number;
}

export interface FrostCast {
  line: FrostLine;
  /** The victim's chest: the torso the great spike runs through is in proportion to its height (shared/piercePlan.ts). */
  chest: Point;
  timeline: FrostTimeline;
  budget: FrostBudget;
  power: number;
  seed: number;
  tile: number;
  /** The Violence setting: at Minimal the great spike comes up beside the body and opens nothing. */
  violence: Violence;
}

/** The great spike's radius at its foot: slim enough to run a body through and read as a spike in it. */
export const kingRadius = (power: number, tile: number) => 0.075 * (tile / 1.02) * (1 + 0.15 * (power - 1));

/** Seconds after it broke the stone until a spike rising by solidPlan.emergence first stands `share` of its height. */
export function emergenceReaches(share: number, rise: number, bounce: number): number {
  const goal = Math.min(1, Math.max(0, share));
  let low = 0, high = rise * 4;
  for (let t = 0; t <= rise * 4; t += rise / 200) if (emergence(t, rise, bounce) >= goal) { high = t; break; }
  low = Math.max(0, high - rise / 200);
  for (let i = 0; i < 30; i += 1) { const mid = (low + high) / 2; if (emergence(mid, rise, bounce) >= goal) high = mid; else low = mid; }
  return high;
}

/**
 * The line the great spike runs: up out of the stone in front of the victim, at the end of the line the frost ran,
 * through the torso and out of its back (beside it at Minimal), as long as a great spike of this power stands.
 */
export function kingThrust(cast: FrostCast): PierceLine {
  const { line, chest, power, tile, violence } = cast, unit = tile / 1.02;
  return spikeThrust(torsoFrame(line.to, line.from, chest), cast.seed, violence, (1.95 + 0.75 * (power - 1)) * unit, kingRadius(power, tile));
}

/**
 * The spikes of a cast, the ones that matter most first (the great spike, the cluster, a Queen's crown, then the
 * line from the caster's end), so a field cut short keeps the blow.
 */
export function frostSpikes(cast: FrostCast): FrostSpike[] {
  const { line, timeline, budget, power, tile } = cast, dice = sequence(cast.seed ^ 0x51c3), unit = tile / 1.02, brief = timeline.brief;
  const [breaking] = timeline.shatter;
  const spikes: FrostSpike[] = [];
  const leanBy = (forward: number, sideways: number) => ({ x: line.along.x * forward + line.across.x * sideways, z: line.along.z * forward + line.across.z * sideways });

  // the great spike: timed so its point comes out of the victim's back at the blow, and broken last
  const thrust = kingThrust(cast), rise = brief ? 0.55 : 0.2, out = Math.hypot(thrust.exit.x - thrust.root.x, thrust.exit.y - thrust.root.y, thrust.exit.z - thrust.root.z) / thrust.length;
  spikes.push({
    role: "king", along: 1, loose: false, root: thrust.root, radius: kingRadius(power, tile), height: thrust.length, lean: leanOf(thrust), yaw: dice() * 6.283, seed: dice(),
    birth: timeline.strikeAt - emergenceReaches(out, rise, brief ? 0 : SPIKE_BOUNCE), rise, breakAt: breaking + (brief ? 0.1 : KING_WAIT), end: brief ? 0.5 : KING_BREAK,
    ...(thrust.exitAt > 0 ? { blood: { entry: thrust.entryAt, exit: thrust.exitAt } } : {}),
  });

  // the cluster: a coprime stride round the great spike, taller the nearer it stands, leaning out
  const cluster = byPower(budget.cluster, power);
  for (let i = 0; i < cluster; i += 1) {
    const turn = i * 2.39996 + dice() * 0.5, out = (0.24 + 0.26 * ((i + dice()) / cluster)) * tile;
    // no higher than the victim's chest, so the body on the great spike stands up out of them and is seen
    const height = lerp(0.85, 0.45, out / (0.5 * tile)) * (0.85 + 0.3 * dice()) * unit * (0.92 + 0.14 * (power - 1));
    spikes.push({
      role: "cluster", along: 1, loose: false, root: { x: line.to.x + Math.cos(turn) * out, y: line.to.y, z: line.to.z + Math.sin(turn) * out },
      radius: height * (0.15 + 0.06 * dice()), height, lean: { x: Math.cos(turn) * (0.28 + 0.3 * dice()), z: Math.sin(turn) * (0.28 + 0.3 * dice()) }, yaw: dice() * 6.283, seed: dice(),
      birth: brief ? 0.32 + 0.1 * dice() : timeline.strikeAt + 0.015 + 0.08 * dice(), rise: brief ? 0.55 : 0.13 + 0.07 * height,
      breakAt: breaking + (brief ? 0.05 * dice() : 0.42 + 0.1 * dice()), end: brief ? 0.5 : 0.14 + 0.12 * height,
    });
  }

  // a Queen's crown: a ring that closes round the victim a breath after the blow, one spike after another
  if (power >= CROWN_POWER) {
    const crown = 7;
    for (let i = 0; i < crown; i += 1) {
      const turn = (i / crown) * 6.283 + 0.4, out = 0.74 * tile, height = (0.72 + 0.22 * dice()) * unit;
      spikes.push({
        role: "crown", along: 1, loose: false, root: { x: line.to.x + Math.cos(turn) * out, y: line.to.y, z: line.to.z + Math.sin(turn) * out },
        radius: height * 0.17, height, lean: { x: Math.cos(turn) * 0.5, z: Math.sin(turn) * 0.5 }, yaw: dice() * 6.283, seed: dice(),
        birth: brief ? 0.4 + 0.02 * i : timeline.strikeAt + 0.1 + 0.022 * i, rise: brief ? 0.55 : 0.16,
        breakAt: breaking + (brief ? 0.05 : 0.34 + 0.02 * i), end: brief ? 0.5 : 0.2,
      });
    }
  }

  // the line: one row, alternating sides, crowding and growing toward the victim, stopping short of its square
  const room = Math.max(0, line.length - 0.5 * tile), last = room / line.length;
  const count = Math.round(Math.min(byPower(budget.line, power), budget.density * room) * (brief ? 0.5 : 1));
  for (let i = 0; i < count; i += 1) {
    const along = ((i + 0.3 + 0.5 * dice()) / count) ** 0.7 * last, rubble = i % 3 === 1 && i < count - 2, side = i % 2 === 0 ? 1 : -1;
    const height = lerp(0.2, 1.05, along ** 1.3) * (0.8 + 0.4 * dice()) * unit * (0.92 + 0.14 * (power - 1)) * (rubble ? 0.55 : 1) * (brief ? 0.65 : 1);
    const offset = side * (0.04 + 0.2 * dice() * (0.4 + 0.6 * along)) * tile * (power >= CROWN_POWER ? 1.3 : 1);
    const at = along * line.length;
    spikes.push({
      role: "line", along, loose: false,
      root: { x: line.from.x + line.along.x * at + line.across.x * offset, y: line.from.y, z: line.from.z + line.along.z * at + line.across.z * offset },
      radius: Math.min(0.24 * tile, height * (0.17 + 0.07 * dice()) * (rubble ? 1.35 : 1)), height, lean: leanBy(0.12 + 0.26 * dice(), side * (0.08 + 0.24 * dice()) * (rubble ? 1.6 : 1)), yaw: dice() * 6.283, seed: dice(),
      birth: brief ? 0.3 + 0.15 * dice() : frontArrives(timeline, along) + 0.03 * dice(), rise: brief ? 0.5 : 0.11 + 0.1 * height,
      breakAt: breaking + (brief ? 0.08 * dice() : 0.4 * along + 0.05 * dice()), end: brief ? 0.45 : 0.12 + 0.12 * height,
    });
  }
  return spikes;
}

/** The unit axis a rooted spike stands along, from its lean. */
export function spikeAxis(spike: Solid): Point {
  const tilt = Math.hypot(spike.lean.x, spike.lean.z);
  if (tilt < 1e-5) return { x: 0, y: 1, z: 0 };
  return { x: (spike.lean.x / tilt) * Math.sin(tilt), y: Math.cos(tilt), z: (spike.lean.z / tilt) * Math.sin(tilt) };
}

/**
 * The pieces the spikes break into: thrown from along each spike as the break comes down it, the tip's first.
 * The great spike is served first, so a small budget still has its fall; its pieces come from the length standing
 * out of the body and below it, never from inside it. None in the brief form, where the spikes sink.
 */
export function frostChunks(cast: FrostCast, spikes: readonly FrostSpike[]): Solid[] {
  if (cast.timeline.brief) return [];
  const dice = sequence(cast.seed ^ 0x77a1), total = byPower(cast.budget.chunks, cast.power), chunks: Solid[] = [];
  // the great spike has its share first; then every other spike gets one before any gets a second
  const wanted = spikes.map((spike) => (spike.role === "king" ? Math.min(8, Math.ceil(total * 0.2)) : Math.max(1, Math.min(4, Math.round(spike.height * 3)))));
  const order: [number, number][] = [];
  for (let pass = 0; pass < wanted[0]; pass += 1) order.push([0, pass]);
  for (let pass = 0; pass < 4; pass += 1) for (let i = 1; i < spikes.length; i += 1) if (pass < wanted[i]) order.push([i, pass]);
  for (const [i, pass] of order.slice(0, total)) {
    const spike = spikes[i], axis = spikeAxis(spike), up = (pass + 0.5 + 0.4 * (dice() - 0.5)) / wanted[i];
    let share = 0.2 + 0.75 * up;
    if (spike.blood) {
      // the length below the body, then the length standing out of its back, laid end to end: the body is skipped
      const below = Math.max(0, spike.blood.entry - 0.1), beyond = 1 - spike.blood.exit, at = up * (below + beyond);
      share = at < below ? 0.08 + at : spike.blood.exit + (at - below);
    }
    const reach = spike.height * share, turn = dice() * 6.283, speed = 0.5 + 1.7 * dice();
    const size = Math.max(spike.role === "king" ? 0.035 * (cast.tile / 1.02) : 0, spike.radius * (0.45 - 0.25 * up) * (0.7 + 0.6 * dice()));
    const birth = spike.breakAt + (1 - share) * spike.end;
    chunks.push({
      loose: true, root: { x: spike.root.x + axis.x * reach, y: spike.root.y + axis.y * reach, z: spike.root.z + axis.z * reach },
      radius: size, height: size * (1.3 + 0.9 * dice()), lean: { x: 0, z: 0 }, spin: between(dice, 4, 13) * (dice() < 0.5 ? -1 : 1), yaw: dice() * 6.283, seed: dice(),
      birth, rise: 0.45, breakAt: 0, end: Math.min(cast.timeline.duration, birth + 0.95 + 0.6 * dice()),
      fling: { x: Math.cos(turn) * speed + axis.x * 0.8, y: 0.4 + 1.9 * dice(), z: Math.sin(turn) * speed + axis.z * 0.8 },
    });
  }
  return chunks;
}

export interface FrostParticles {
  /** Glitter, splinters, motes and the drawn glow: added light. */
  light: Particle[];
  /** Mist: it covers what is behind it. */
  mist: Particle[];
}

/**
 * Everything loose in a cast, with its birth times, written once. `hand` is where the hand is when the cast is
 * made; particles marked `anchored` are placed relative to it and follow it.
 */
export function frostParticles(cast: FrostCast, spikes: readonly FrostSpike[], hand: Point): FrostParticles {
  const { line, timeline, budget, power, tile } = cast, dice = sequence(cast.seed ^ 0x2e11), unit = tile / 1.02, brief = timeline.brief;
  const light: Particle[] = [], mist: Particle[] = [];
  const zero = { x: 0, y: 0, z: 0 }, strike = timeline.strikeAt, king = spikes[0];
  const sparks = byPower(budget.sparks, power), puffs = byPower(budget.mist, power);
  const onLine = (along: number, offset: number, lift: number) => ({ x: line.from.x + line.along.x * along * line.length + line.across.x * offset, y: line.from.y + lift, z: line.from.z + line.along.z * along * line.length + line.across.z * offset });

  // the hand: a glow that swells, motes drawn into it, and the cold thrown down at the caster's feet
  light.push({ kind: PARTICLE_KIND.halo, origin: zero, velocity: zero, birth: 0, life: timeline.gather[1] + 0.2, size: 0.42 * unit, tone: 0.55, anchored: true, fadeIn: 0.6 });
  light.push({ kind: PARTICLE_KIND.mote, origin: zero, velocity: zero, birth: 0, life: timeline.gather[1] + 0.12, size: 0.13 * unit, tone: 0.9, anchored: true, fadeIn: 0.7 });
  if (!brief) {
    for (let i = 0; i < Math.round(sparks * 0.05); i += 1) {
      const from = scatter(dice), far = (0.3 + 0.2 * dice()) * unit, pull = 7;
      // drawn in: its launch speed is exactly what the air lets it spend on the way to the hand
      light.push({ kind: PARTICLE_KIND.glint, origin: { x: from.x * far, y: from.y * far, z: from.z * far }, velocity: { x: -from.x * far * pull, y: -from.y * far * pull, z: -from.z * far * pull }, birth: dice() * (timeline.gather[1] - 0.32), life: 0.34, size: 0.035 * unit, drag: pull, tone: 0.7, anchored: true, fadeIn: 0.3 });
    }
    const fall = 0.13;
    light.push({ kind: PARTICLE_KIND.streak, origin: zero, velocity: { x: (line.from.x - hand.x) / fall, y: (line.from.y - hand.y) / fall, z: (line.from.z - hand.z) / fall }, birth: timeline.gather[1] - fall, life: fall + 0.02, size: 0.07 * unit, tone: 1, anchored: true, fadeIn: 0.1 });
  }

  // the rime's edge glitters as it runs
  for (let i = 0; i < Math.round(sparks * (brief ? 0.12 : 0.2)); i += 1) {
    const along = dice(), width = (0.1 + 0.25 * along) * tile;
    light.push({ kind: PARTICLE_KIND.glint, origin: onLine(along, (dice() - 0.5) * 2 * width, 0.03), velocity: { x: 0, y: brief ? 0.05 : 0.2 + 0.5 * dice(), z: 0 }, birth: brief ? 0.2 + 0.5 * dice() : rimeArrives(timeline, along) + 0.05 * dice(), life: 0.5 + 0.6 * dice(), size: (0.028 + 0.03 * dice()) * unit, drag: 2, gravity: 0.5, tone: 0.5 + 0.5 * dice() });
  }

  // each spike of the line throws chips and glitter as it breaks the stone, and breathes mist from its foot
  const row = spikes.filter((spike) => spike.role !== "king");
  const each = Math.max(1, Math.round((sparks * 0.25) / Math.max(1, row.length)));
  for (const spike of row) {
    const axis = spikeAxis(spike);
    for (let i = 0; i < each; i += 1) {
      const way = scatter(dice, 0.3, 1), speed = (1 + 2.2 * spike.height) * (0.5 + dice()), chip = !brief && i % 3 === 0;
      light.push({
        kind: chip ? PARTICLE_KIND.streak : PARTICLE_KIND.glint, origin: { x: spike.root.x, y: spike.root.y + 0.05, z: spike.root.z },
        velocity: brief ? { x: way.x * 0.15, y: 0.25, z: way.z * 0.15 } : { x: (way.x + axis.x) * speed * 0.6, y: way.y * speed, z: (way.z + axis.z) * speed * 0.6 },
        birth: spike.birth + (brief ? 0.4 * dice() : 0.02 + 0.05 * dice()), life: chip ? 0.35 + 0.3 * dice() : 0.7 + 0.7 * dice(), size: (chip ? 0.016 : 0.032 + 0.02 * dice()) * unit,
        drag: chip ? 0.8 : 1.8, gravity: chip ? 7 : 2.2, tone: 0.5 + 0.5 * dice(),
      });
    }
  }

  // the blow: a cold flash low in the cluster and a glow that lingers a moment, splinters thrown wide from the foot of
  // the great spike and out of the victim's back with its point, and glitter that hangs and falls. Kept low, soft and
  // short: nothing may hide the body on the spike, nor wash out the blood in the rime
  const foot = { x: line.to.x, y: line.to.y + 0.3 * unit, z: line.to.z }, axis = spikeAxis(king);
  const exit = king.blood ? king.blood.exit : 0.6, point = { x: king.root.x + axis.x * king.height * exit, y: king.root.y + axis.y * king.height * exit, z: king.root.z + axis.z * king.height * exit };
  light.push({ kind: PARTICLE_KIND.halo, origin: foot, velocity: zero, birth: brief ? 0.35 : strike, life: 0.5, size: 0.95 * unit * (0.85 + 0.2 * power), tone: 0.18, fadeIn: brief ? 0.3 : 0.04 });
  if (!brief) {
    light.push({ kind: PARTICLE_KIND.halo, origin: foot, velocity: zero, birth: strike, life: 0.22, size: 0.85 * unit * (0.8 + 0.25 * power), tone: 0.38, fadeIn: 0.1 });
    for (let i = 0; i < Math.round(sparks * 0.16); i += 1) {
      const way = scatter(dice, 0.08, 0.92), speed = (2.4 + 4.6 * dice()) * unit * (0.85 + 0.15 * power);
      light.push({ kind: PARTICLE_KIND.streak, origin: { x: king.root.x, y: king.root.y + (0.05 + 0.3 * dice()) * unit, z: king.root.z }, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: king.birth + 0.03 * dice(), life: 0.4 + 0.5 * dice(), size: (0.017 + 0.012 * dice()) * unit, drag: 0.7, gravity: 9, tone: 0.7 + 0.3 * dice() });
    }
    // the point comes out of the back in a spray of ice, and at Full the spike cracks in the body and spits more
    const bursts = [strike, ...(cast.violence === "full" ? [timeline.crack] : [])];
    for (const at of bursts) for (let i = 0; i < 6; i += 1) {
      const way = scatter(dice, -0.4, 1), speed = (1.2 + 1.8 * dice()) * unit;
      light.push({ kind: PARTICLE_KIND.streak, origin: point, velocity: { x: (axis.x + way.x * 0.6) * speed, y: (axis.y + way.y * 0.6) * speed, z: (axis.z + way.z * 0.6) * speed }, birth: at + 0.015 * dice(), life: 0.22 + 0.25 * dice(), size: (0.012 + 0.008 * dice()) * unit, drag: 1.6, gravity: 6, tone: 0.7 + 0.3 * dice() });
    }
  }
  for (let i = 0; i < Math.round(sparks * (brief ? 0.2 : 0.25)); i += 1) {
    const way = scatter(dice, -0.1, 1), speed = brief ? 0.2 : (0.7 + 2.6 * dice()) * unit, turn = dice() * 6.283, out = 0.4 * tile * Math.sqrt(dice());
    light.push({
      kind: PARTICLE_KIND.glint, origin: { x: line.to.x + Math.cos(turn) * out, y: line.to.y + (0.25 + 1.5 * dice()) * unit, z: line.to.z + Math.sin(turn) * out },
      velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: (brief ? 0.5 : strike) + (brief ? 0.6 : 0.08) * dice(), life: 1.3 + 1.3 * dice(), size: (0.03 + 0.028 * dice()) * unit,
      drag: 2.6, gravity: brief ? 0.25 : 1.3, tone: 0.4 + 0.6 * dice(), wander: 0.16,
    });
  }
  // the breaking: a breath of glitter off each spike as it goes
  if (!brief) for (const spike of spikes) {
    const axis = spikeAxis(spike), gone = Math.max(1, Math.round((sparks * 0.05) / spikes.length) + (spike.role === "king" ? 5 : 0));
    for (let i = 0; i < gone; i += 1) {
      const up = dice(), way = scatter(dice, -0.2, 0.8);
      light.push({ kind: PARTICLE_KIND.glint, origin: { x: spike.root.x + axis.x * spike.height * up, y: spike.root.y + axis.y * spike.height * up, z: spike.root.z + axis.z * spike.height * up }, velocity: { x: way.x * 1.1, y: way.y * 1.1, z: way.z * 1.1 }, birth: spike.breakAt + (1 - up) * spike.end, life: 0.7 + 0.7 * dice(), size: (0.03 + 0.02 * dice()) * unit, drag: 2.2, gravity: 2, tone: 0.4 + 0.6 * dice() });
    }
  }

  // mist: breathed along the line, pushed out in a low ring by the blow, and let go again by the breaking; kept low
  // and thin round the victim, so the body on the spike is not veiled
  const alongLine = Math.round(puffs * 0.4), ring = Math.round(puffs * 0.3), late = puffs - alongLine - ring;
  for (let i = 0; i < alongLine && row.length > 0; i += 1) {
    const spike = row[Math.floor((i * row.length) / alongLine)], side = dice() < 0.5 ? -1 : 1, drift = (0.12 + 0.3 * dice()) * (brief ? 0.4 : 1);
    mist.push({ kind: PARTICLE_KIND.puff, origin: { x: spike.root.x, y: spike.root.y + 0.1 * unit, z: spike.root.z }, velocity: { x: line.across.x * side * drift + line.along.x * 0.2, y: 0.03, z: line.across.z * side * drift + line.along.z * 0.2 }, birth: spike.birth + 0.05 * dice(), life: 1.8 + dice(), size: (0.34 + 0.16 * dice()) * unit, drag: 1.2, tone: 0.4 + 0.6 * dice(), grow: 2.3, fadeIn: 0.25, wander: 0.1 });
  }
  for (let i = 0; i < ring; i += 1) {
    // the brief form lays it where the blow would have pushed it, and lets it lie
    const turn = (i / ring) * 6.283 + dice() * 0.6, push = (brief ? 0.25 : 1.3 + 1.3 * dice()) * unit, out = (brief ? 0.25 + 0.6 * dice() : 0.22) * tile;
    mist.push({ kind: PARTICLE_KIND.puff, origin: { x: line.to.x + Math.cos(turn) * out, y: line.to.y + (0.06 + 0.1 * dice()) * unit, z: line.to.z + Math.sin(turn) * out }, velocity: { x: Math.cos(turn) * push, y: 0.02, z: Math.sin(turn) * push }, birth: (brief ? 0.45 : strike) + (brief ? 0.4 : 0.05) * dice(), life: 1.6 + 1.0 * dice(), size: (0.28 + 0.12 * dice()) * unit, drag: 2.4, tone: 0.4 + 0.6 * dice(), grow: 2.0, fadeIn: 0.2, wander: 0.1 });
  }
  for (let i = 0; i < late; i += 1) {
    const spike = spikes[Math.floor(dice() * spikes.length)], axis = spikeAxis(spike), up = 0.5 * dice();
    mist.push({ kind: PARTICLE_KIND.puff, origin: { x: spike.root.x + axis.x * spike.height * up, y: spike.root.y + 0.1 * unit + axis.y * spike.height * up, z: spike.root.z + axis.z * spike.height * up }, velocity: { x: (dice() - 0.5) * 0.5, y: 0.12, z: (dice() - 0.5) * 0.5 }, birth: spike.breakAt + 0.5 * spike.end, life: 1.1 + 0.6 * dice(), size: (0.24 + 0.14 * dice()) * unit, drag: 1.5, tone: 0.5 + 0.5 * dice(), grow: 2.2, fadeIn: 0.2, wander: 0.08 });
  }
  // nothing outlives the spell
  const within = (list: Particle[]) => list.map((particle) => ({ ...particle, life: Math.min(particle.life, Math.max(0.05, timeline.duration - particle.birth)) }));
  return { light: within(light), mist: within(mist) };
}

/** Wounds the great spike opens, and when: the match draws them through its gore system (vfx/spells/spell.ts). */
export interface FrostWounds { at: number; wounds: PierceWound[] }

/**
 * The wounds of a cast, in order: where the great spike went in and where it came out, as its point comes out; and at
 * Full a second burst from the exit as it cracks in the body (not in the brief form, where nothing jolts). None at
 * Minimal.
 */
export function frostWounds(cast: FrostCast, thrust: PierceLine): FrostWounds[] {
  const events: FrostWounds[] = [];
  const opened = pierceWounds([thrust], cast.violence), again = cast.timeline.brief ? [] : twistWounds([thrust], cast.violence);
  if (opened.length > 0) events.push({ at: cast.timeline.strikeAt, wounds: opened });
  if (again.length > 0) events.push({ at: cast.timeline.crack, wounds: again });
  return events;
}

/** Where blood soaks into the rime: on the board (x, z), seconds after the blow it starts, and how far it spreads. */
export interface RimeBlood { x: number; z: number; delay: number; size: number }

/**
 * The blood in the rime, by the Violence setting (none at Minimal): a pool under the body from what drips off it,
 * spreading from just after the blow; smaller ones under each wound, where it drips straight down; and one at the foot
 * of the great spike once the blood running down it has reached the stone. More, and darker, at Full.
 */
export function frostBlood(cast: FrostCast, thrust: PierceLine): { amount: number; pools: RimeBlood[] } {
  const amount = bloodOf(cast.violence);
  if (amount <= 0 || thrust.exitAt <= 0) return { amount: 0, pools: [] };
  const { line } = cast, more = amount - 1;
  return {
    amount,
    pools: [
      { x: line.to.x + line.along.x * 0.04, z: line.to.z + line.along.z * 0.04, delay: 0.12, size: 0.3 + 0.12 * more },
      { x: thrust.root.x, z: thrust.root.z, delay: round(bloodReachesStone(thrust, amount)), size: 0.09 + 0.04 * more },
      { x: thrust.exit.x, z: thrust.exit.z, delay: 0.3, size: 0.09 + 0.04 * more },
      { x: thrust.entry.x, z: thrust.entry.z, delay: 0.25, size: 0.07 + 0.03 * more },
    ],
  };
}

/** How high the great spike stands `seconds` into the cast: what the blow is timed against. */
export function kingHeight(spikes: readonly FrostSpike[], seconds: number, brief: boolean): number {
  const king = spikes[0];
  return king.height * emergence(seconds - king.birth, king.rise, brief ? 0 : SPIKE_BOUNCE);
}
/** How far a spike overshoots its height as it comes up. */
export const SPIKE_BOUNCE = 0.16;

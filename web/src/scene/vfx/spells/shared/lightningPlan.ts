// Adapted from AbilityCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The arithmetic of a lightning strike: the channel it burns, the forks off it, and what it is doing at each
 * moment. No Three.js in here, so the node tests reach it (shared/play/spell-lightning.test.ts);
 * shared/lightning.ts draws what this decides.
 *
 * The channel is the reference's `LightningBolt.js`: midpoint displacement, which halves every span and pushes the
 * new point off its chord, less at each halving, so the path has large doglegs with smaller ones on them. What is
 * changed here:
 *
 * - The dice are seeded. A strike is the same on every machine and in every capture.
 * - A strike has the life a high-speed camera shows. A dim leader comes down in steps, each a pause and a jump.
 *   The moment it connects, the return stroke lights the whole channel far brighter. Re-strikes follow down the
 *   same channel, each dimmer than the last and unevenly spaced; the path is kept for `keep` strokes and only then
 *   found again. The reference solved a new path on every re-strike, which reads as several bolts, not one.
 * - Forks leave the channel at its sharpest corners, lean the way the caller says (down, for a strike out of the
 *   air), are lit by the leader and the first stroke and by nothing after: the later strokes take the burnt
 *   channel and leave the forks dark, as they do in a photograph.
 * - It ends by cooling: after the last stroke the channel holds a dull glow that dies away.
 */
import type { Point } from "../../mystic/beamPlan";
import { dice } from "./ribbonPlan";

export interface ChannelOptions {
  /** Halvings of the main channel: it has 2^levels + 1 points. */
  levels: number;
  /** How far the first midpoint is pushed off its chord, as a fraction of the channel's length. */
  jag: number;
  /** Each halving pushes this fraction as far as the one before it. */
  roughness?: number;
  /** Forks off the main channel. */
  forks?: number;
  /** Halvings of a fork. */
  forkLevels?: number;
  /** Bows the whole channel by this fraction of its length along `bow`. */
  arch?: number;
  bow?: Point;
  /** The way forks lean (need not be unit) and how strongly, 0..1. */
  lean?: Point;
  leaning?: number;
  /** Nothing of the channel goes below this height: a fork that would is turned to run along the stone. */
  floor?: number;
}

export interface ChannelStrip {
  /** The first point of the strip in {@link Channel.points}, and how many it has. */
  start: number;
  count: number;
  /** Its width and brightness against the main channel's. */
  width: number;
  bright: number;
  /** Where on the main channel it leaves, 0..1; 0 for the main channel itself. */
  along: number;
  /** How much further the leader must go, as a fraction of the main channel, before the whole strip is lit. */
  span: number;
  fork: boolean;
}

export interface Channel {
  /** x, y, z of every point, strip after strip. */
  points: Float32Array;
  strips: ChannelStrip[];
  /** The straight distance between its ends. */
  length: number;
}

/** How many points a channel of these options has room for. */
export function channelCapacity(levels: number, forks = 0, forkLevels = 3): number {
  return (1 << levels) + 1 + forks * ((1 << forkLevels) + 1);
}

function displace(points: Float32Array, start: number, count: number, a: Point, b: Point, push: number, roughness: number, random: () => number): void {
  const set = (i: number, p: Point) => { points[(start + i) * 3] = p.x; points[(start + i) * 3 + 1] = p.y; points[(start + i) * 3 + 2] = p.z; };
  set(0, a); set(count - 1, b);
  let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const length = Math.hypot(dx, dy, dz) || 1e-6;
  dx /= length; dy /= length; dz /= length;
  for (let size = count - 1; size > 1; size >>= 1) {
    const half = size >> 1;
    for (let i = half; i < count - 1; i += size) {
      const before = (start + i - half) * 3, after = (start + i + half) * 3, at = (start + i) * 3;
      // a direction square to the channel, by throwing a die and taking off what lies along it
      let rx = random() - 0.5, ry = random() - 0.5, rz = random() - 0.5;
      const along = rx * dx + ry * dy + rz * dz;
      rx -= along * dx; ry -= along * dy; rz -= along * dz;
      let size2 = Math.hypot(rx, ry, rz);
      if (size2 < 1e-6) { rx = dy; ry = -dx; rz = 0; size2 = Math.hypot(rx, ry, rz) || 1; }
      const by = ((random() - 0.5) * 2 * push) / size2;
      points[at] = (points[before] + points[after]) / 2 + rx * by;
      points[at + 1] = (points[before + 1] + points[after + 1]) / 2 + ry * by;
      points[at + 2] = (points[before + 2] + points[after + 2]) / 2 + rz * by;
    }
    push *= roughness;
  }
}

/**
 * Solves a channel from `from` to `to`. Its ends are exactly the two points; the same seed and options give the
 * same channel.
 */
export function solveChannel(seed: number, from: Point, to: Point, options: ChannelOptions): Channel {
  const random = dice(seed);
  const roughness = options.roughness ?? 0.55, forkLevels = options.forkLevels ?? 3, forks = Math.max(0, Math.round(options.forks ?? 0));
  const main = (1 << options.levels) + 1, fork = (1 << forkLevels) + 1;
  const points = new Float32Array((main + forks * fork) * 3);
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  displace(points, 0, main, from, to, length * options.jag, roughness, random);
  if (options.arch && options.bow) {
    for (let i = 1; i < main - 1; i += 1) {
      const lift = Math.sin((i / (main - 1)) * Math.PI) * options.arch * length;
      points[i * 3] += options.bow.x * lift; points[i * 3 + 1] += options.bow.y * lift; points[i * 3 + 2] += options.bow.z * lift;
    }
  }
  const floor = options.floor;
  const strips: ChannelStrip[] = [{ start: 0, count: main, width: 1, bright: 1, along: 0, span: 1, fork: false }];

  // forks leave at the channel's sharpest corners: rank every inner point by how hard the channel turns there
  const turn = (i: number) => {
    const ax = points[i * 3] - points[(i - 1) * 3], ay = points[i * 3 + 1] - points[(i - 1) * 3 + 1], az = points[i * 3 + 2] - points[(i - 1) * 3 + 2];
    const bx = points[(i + 1) * 3] - points[i * 3], by = points[(i + 1) * 3 + 1] - points[i * 3 + 1], bz = points[(i + 1) * 3 + 2] - points[i * 3 + 2];
    return 1 - (ax * bx + ay * by + az * bz) / ((Math.hypot(ax, ay, az) || 1e-6) * (Math.hypot(bx, by, bz) || 1e-6));
  };
  const corners: { at: number; turn: number }[] = [];
  for (let i = 2; i < main - 3; i += 1) corners.push({ at: i, turn: turn(i) * (0.6 + 0.8 * random()) });
  corners.sort((a, b) => b.turn - a.turn);
  const taken: number[] = [];
  const lean = options.lean, leaning = options.leaning ?? 0;
  for (let f = 0; f < forks; f += 1) {
    // the sharpest corner not within two points of a fork already taken
    const corner = corners.find((c) => taken.every((t) => Math.abs(t - c.at) > 2)) ?? corners[f % Math.max(1, corners.length)];
    const at = corner ? corner.at : Math.max(1, Math.min(main - 2, 1 + f));
    taken.push(at);
    if (corner) corners.splice(corners.indexOf(corner), 1);
    const here = { x: points[at * 3], y: points[at * 3 + 1], z: points[at * 3 + 2] };
    // it runs on the way the channel was going before the corner, kicked off it, and leaning
    let tx = points[at * 3] - points[(at - 1) * 3], ty = points[at * 3 + 1] - points[(at - 1) * 3 + 1], tz = points[at * 3 + 2] - points[(at - 1) * 3 + 2];
    const tl = Math.hypot(tx, ty, tz) || 1e-6; tx /= tl; ty /= tl; tz /= tl;
    let kx = random() - 0.5, ky = random() - 0.5, kz = random() - 0.5;
    const kd = kx * tx + ky * ty + kz * tz; kx -= kd * tx; ky -= kd * ty; kz -= kd * tz;
    const kl = Math.hypot(kx, ky, kz) || 1e-6, kick = 0.5 + 0.6 * random();
    let vx = tx + (kx / kl) * kick, vy = ty + (ky / kl) * kick, vz = tz + (kz / kl) * kick;
    if (lean && leaning > 0) {
      const ll = Math.hypot(lean.x, lean.y, lean.z) || 1e-6;
      vx += (lean.x / ll) * leaning * 1.6; vy += (lean.y / ll) * leaning * 1.6; vz += (lean.z / ll) * leaning * 1.6;
    }
    const vl = Math.hypot(vx, vy, vz) || 1e-6;
    // forks near the far end are shorter: there is less charge left to carry
    const along = at / (main - 1);
    const reach = length * (0.14 + 0.2 * random()) * (1 - 0.5 * along);
    const end = { x: here.x + (vx / vl) * reach, y: here.y + (vy / vl) * reach, z: here.z + (vz / vl) * reach };
    if (floor !== undefined && end.y < floor + 0.02) end.y = floor + 0.02;
    const start = main + f * fork;
    displace(points, start, fork, here, end, reach * options.jag * 1.3, roughness, random);
    strips.push({ start, count: fork, width: 0.42 + 0.2 * random(), bright: 0.4 + 0.25 * random(), along, span: Math.min(0.3, reach / Math.max(1e-6, length)), fork: true });
  }
  if (floor !== undefined) for (let i = 1; i < points.length / 3; i += 1) if (points[i * 3 + 1] < floor + 0.015) points[i * 3 + 1] = floor + 0.015;
  // the ends are where the caller asked, whatever the floor did
  points[0] = from.x; points[1] = from.y; points[2] = from.z;
  points[(main - 1) * 3] = to.x; points[(main - 1) * 3 + 1] = to.y; points[(main - 1) * 3 + 2] = to.z;
  return { points, strips, length };
}

/** Several channels as one, so a handful of small arcs is one draw. */
export function mergeChannels(channels: readonly Channel[]): Channel {
  const total = channels.reduce((sum, channel) => sum + channel.points.length, 0);
  const points = new Float32Array(total), strips: ChannelStrip[] = [];
  let at = 0, length = 0;
  for (const channel of channels) {
    points.set(channel.points, at);
    for (const strip of channel.strips) strips.push({ ...strip, start: strip.start + at / 3 });
    at += channel.points.length; length = Math.max(length, channel.length);
  }
  return { points, strips, length };
}

/**
 * How far a stepped leader has come when it is `progress` (0..1) of the way through its descent, in `steps`: it
 * waits, then jumps a step's length, so its head is seen to stab forward rather than slide.
 */
export function steppedReach(progress: number, steps: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const at = progress * steps, whole = Math.floor(at), within = at - whole;
  // the first two thirds of a step are the pause; the jump takes the rest
  const jump = Math.min(1, Math.max(0, (within - 0.66) / 0.34));
  return (whole + jump * jump * (3 - 2 * jump)) / steps;
}

export interface StrikeOptions {
  /** When the leader leaves, and when it connects: the return stroke is on that instant. */
  leaderStart: number;
  connect: number;
  /** Steps the leader comes down in. */
  steps?: number;
  /** Strokes after the return stroke. */
  restrikes?: number;
  /** Seconds between strokes, give or take: real ones are some hundredths of a second apart and never even. */
  gap?: number;
  /** Strokes a path is kept for before a new one is found. At least the number of strokes keeps it throughout. */
  keep?: number;
  /** Seconds the channel takes to cool after the last stroke. */
  afterglow?: number;
}

export interface StrikeTimeline {
  leader: readonly [number, number];
  steps: number;
  /** When each stroke lands (the first is the return stroke) and how bright it is at its peak. */
  strokes: readonly number[];
  peaks: readonly number[];
  keep: number;
  /** When nothing is left of it. */
  end: number;
}

/** How bright the leader is against a return stroke of 1. */
export const LEADER_BRIGHT = 0.22;
/** Seconds a stroke takes to fall to a third of its peak. */
export const STROKE_DECAY = 0.038;

/** When each thing in a strike happens. Stroke gaps are seeded. */
export function strikeTimeline(seed: number, options: StrikeOptions): StrikeTimeline {
  const random = dice(seed ^ 0x5f3c);
  const restrikes = Math.max(0, Math.round(options.restrikes ?? 3)), gap = options.gap ?? 0.07;
  const strokes = [options.connect], peaks = [1];
  for (let i = 1; i <= restrikes; i += 1) {
    strokes.push(+(strokes[i - 1] + gap * (0.6 + 0.9 * random())).toFixed(4));
    peaks.push(+(0.78 * 0.74 ** (i - 1)).toFixed(4));
  }
  return {
    leader: [Math.min(options.leaderStart, options.connect), options.connect], steps: options.steps ?? 6, strokes, peaks,
    keep: Math.max(1, Math.round(options.keep ?? restrikes + 1)), end: +(strokes[strokes.length - 1] + (options.afterglow ?? 0.35)).toFixed(4),
  };
}

export interface StrikeState {
  /** How far along the channel the leader has come, 0..1; 1 from the moment it connects. */
  head: number;
  /** The channel's brightness: {@link LEADER_BRIGHT} while the leader descends, 1 on the return stroke. */
  bright: number;
  /** The forks' brightness: with the leader and the first stroke only. */
  forks: number;
  /** How much wider than the leader the channel is drawn, 0..1: the return stroke is a thick cord. */
  swell: number;
  /** Which path it is on; the caller solves a new channel when this changes. */
  path: number;
  /** The stroke it is in the decay of, or -1 before the first. */
  stroke: number;
  /** True from the return stroke. */
  connected: boolean;
  done: boolean;
}

/** What the strike is doing at `seconds`. */
export function strikeState(timeline: StrikeTimeline, seconds: number): StrikeState {
  const { leader, strokes, peaks, keep, end, steps } = timeline;
  const connect = strokes[0];
  if (seconds < connect) {
    const span = leader[1] - leader[0];
    const progress = span > 0 ? (seconds - leader[0]) / span : seconds >= leader[0] ? 1 : 0;
    const head = steppedReach(Math.min(progress, 0.999), steps);
    const lit = progress > 0 ? LEADER_BRIGHT : 0;
    return { head, bright: lit, forks: lit, swell: 0, path: 0, stroke: -1, connected: false, done: false };
  }
  let stroke = 0;
  while (stroke + 1 < strokes.length && seconds >= strokes[stroke + 1]) stroke += 1;
  const last = strokes[strokes.length - 1];
  // each stroke decays from its peak; between strokes a little current keeps the channel lit
  const pulse = peaks[stroke] * Math.exp(-(seconds - strokes[stroke]) / STROKE_DECAY);
  const cooling = end > last ? Math.max(0, 1 - (seconds - last) / (end - last)) : 0;
  const ember = seconds < last ? 0.14 : 0.14 * cooling * cooling;
  const bright = seconds >= end ? 0 : Math.max(pulse, ember);
  return {
    head: 1, bright, forks: seconds >= end ? 0 : Math.exp(-(seconds - connect) / (STROKE_DECAY * 1.4)),
    swell: Math.min(1, pulse), path: Math.floor(stroke / keep), stroke, connected: true, done: seconds >= end,
  };
}

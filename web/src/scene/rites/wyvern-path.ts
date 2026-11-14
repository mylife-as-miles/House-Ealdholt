/**
 * The Wyvern Run: the flight path of the Aethelgard queen's bonded wyvern.
 *
 * Pure maths, no three.js and no clock. Everything here is a function of the
 * plan, the seed and the run time `t` in seconds, so the match can schedule
 * sound and the victim's death cry off the same numbers the creature flies.
 *
 * The run has four legs:
 *   approach  one banking, circling sweep out of the sky behind the queen
 *   dive      wings swept back, bottoming out level exactly on the victim
 *   carry     heavy climbing flaps with the body in the talons
 *   leave     the climb away into the eclipse (after the drop, if any)
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * What becomes of the victim:
 *   "eat"   it is carried to a hover, bitten, torn and the remains dropped (the queen's rite; the default)
 *   "drop"  it is carried up and dropped from height
 *   "away"  it is carried off into the eclipse
 */
export type WyvernCarry = "drop" | "away" | "eat";

/** Leg lengths in seconds. The beat times below are sums of these. */
export const WYVERN_TIMING = {
  approach: 1.5,
  dive: 0.8,
  carry: 1.2,
  leave: 1.3,
  /** How long before the strike the wings and legs are thrown forward. */
  flare: 0.34,
  /** The screech starts this long before the dive. */
  screechLead: 0.3,
  /** How long the jaw stays open. */
  screechHold: 0.75,
  /** "eat" only: strike to the hover, hover to the bite, between bite and tears, last tear to the release, release to the triumph screech. */
  climb: 0.9,
  toBite: 0.4,
  tear: 0.3,
  tears: 2,
  toRelease: 0.35,
  toTriumph: 0.3,
} as const;

/** "eat" only: how high above the floor the body hovers while it feeds, and how far past the strike. */
export const WYVERN_HOVER = { height: 5.6, run: 3.2 } as const;

/** The top of the board in world units. Mirrors BOARD_TOP in board.ts (a unit test keeps them equal). */
export const WYVERN_FLOOR = 0;

/** The body never flies lower than this above the floor, so talons and wings stay clear of the board. */
export const WYVERN_MIN_ALTITUDE = 2.0;

/** Where the body is, relative to the talons, at the instant of the strike. */
export const WYVERN_GRIP = { up: 1.64, back: 0.5 } as const;

export interface WyvernWingbeat {
  /** Run time at which the downstroke starts. */
  time: number;
  /** Length of the whole beat (down and up) in seconds. */
  period: number;
  /** 1 is a cruising beat; the carry beats are larger. */
  power: number;
}

export interface WyvernBeats {
  /** The jaw opens and the screech starts. */
  screech: number;
  /** The wings sweep back and the dive begins. */
  dive: number;
  /** Wings and legs are thrown forward. */
  flare: number;
  /** The talons close on the victim's chest. */
  strike: number;
  /** "eat" only: the climb ends in a laboured hover. Otherwise null. */
  hover: number | null;
  /** "eat" only: the jaws clamp on the victim. Otherwise null. */
  bite: number | null;
  /** "eat" only: each violent shake of the head. Otherwise empty. */
  tears: readonly number[];
  /** The victim (or what is left of it) is let go. Null only for "away". */
  release: number | null;
  /** "eat" only: the screech of triumph as it climbs away. Otherwise null. */
  triumph: number | null;
  /** The wyvern has left the arena; the run resolves. */
  gone: number;
  /** Same as `gone`. */
  duration: number;
  /** Every downstroke of the run, in order. */
  wingbeats: readonly WyvernWingbeat[];
}

export interface WyvernPathPlan {
  from: Vec3Like;
  target: Vec3Like;
  away: Vec3Like;
  /** Defaults to "eat". */
  carry?: WyvernCarry;
  seed?: number;
  /** "eat" only: where the body hovers while it feeds. Defaults to WYVERN_HOVER past the strike. */
  hover?: Vec3Like;
  /** "eat" only: a point the wyvern turns to face while it feeds (the camera, say). Defaults to `from`: it feeds facing its queen. */
  face?: Vec3Like;
  /** Top of the board. Defaults to WYVERN_FLOOR. */
  floor?: number;
  /** Where the body rides relative to the talons at the strike. Defaults to WYVERN_GRIP (a 14 m wingspan); scale it with the beast. */
  grip?: { up: number; back: number };
}

export interface WyvernPath {
  readonly beats: WyvernBeats;
  readonly seed: number;
  /** +1 or -1: which way the approach circles. Chosen by the seed. */
  readonly side: number;
  /** Unit horizontal heading of the body at the strike. */
  readonly strikeHeading: Vec3Like;
  /** "eat" only: where the body hovers while it feeds. Otherwise null. */
  readonly hover: Vec3Like | null;
  /** "eat" only: unit horizontal direction the body faces while it feeds. Otherwise null. */
  readonly hoverFacing: Vec3Like | null;
  /** Body position at run time t (clamped to the run). Writes into `out` when given. */
  position<T extends Vec3Like>(t: number, out?: T): T;
  /** Body velocity (units per second) at run time t. */
  velocity<T extends Vec3Like>(t: number, out?: T): T;
  /** Body acceleration at run time t. Not continuous across legs; smooth it before use. */
  acceleration<T extends Vec3Like>(t: number, out?: T): T;
  /** Where the talon socket is aimed: the body position minus the grip offset. Equals the target at the strike. */
  grip<T extends Vec3Like>(t: number, out?: T): T;
}

/** Small, fast, well distributed PRNG. Same seed, same stream. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The beat times of a run. They do not depend on the plan's positions or seed. */
export function wyvernBeats(carry: WyvernCarry = "eat"): WyvernBeats {
  const T = WYVERN_TIMING;
  const dive = T.approach;
  const strike = dive + T.dive;
  const eat = carry === "eat";
  const hover = round3(strike + T.climb);
  const bite = round3(hover + T.toBite);
  const tears: number[] = [];
  if (eat) for (let i = 1; i <= T.tears; i += 1) tears.push(round3(bite + T.tear * i));
  const release = eat ? round3(tears[tears.length - 1] + T.toRelease) : strike + T.carry;
  const gone = round3(release + T.leave);
  const wingbeats: WyvernWingbeat[] = [
    // Two cruising beats on the approach, then it glides into the dive.
    { time: 0.1, period: 0.6, power: 1 },
    { time: 0.7, period: 0.6, power: 0.9 },
  ];
  // Heavy beats under load from just after the strike to the release...
  const heavy = 0.6;
  let t = strike + 0.07;
  let index = 0;
  while (t + heavy * 0.5 < gone) {
    const loaded = carry === "away" || t < release - 0.05;
    // Holding height over the board with a load is the hardest flying of the run: faster and deeper.
    const hovering = eat && t > hover - 0.3 && t < release;
    const period = hovering ? 0.5 : heavy;
    wingbeats.push({ time: round3(t), period, power: hovering ? 1.35 : loaded ? 1.25 : 1.05 });
    t += period;
    index += 1;
    if (index > 12) break;
  }
  return {
    screech: round3(dive - T.screechLead),
    dive,
    flare: round3(strike - T.flare),
    strike,
    hover: eat ? hover : null,
    bite: eat ? bite : null,
    tears,
    release: carry === "away" ? null : release,
    triumph: eat ? round3(release + T.toTriumph) : null,
    gone,
    duration: gone,
    wingbeats,
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export interface WyvernFlap {
  /** 0 gliding, 1 fully into the beat. Eases in before a beat and out after the last. */
  amount: number;
  /** 0..1 through the current beat: 0 is the top of the stroke, the downstroke runs to DOWNSTROKE. */
  phase: number;
  power: number;
  /** Index into beats.wingbeats of the current (or coming) beat, -1 when none. */
  index: number;
  /** True while the wings are lifting into a coming beat (rather than settling out of the last one). */
  rising: boolean;
}

/** Fraction of a beat spent on the downstroke. */
export const WYVERN_DOWNSTROKE = 0.44;

/** Where the wings are in their beat at run time t. */
export function wyvernFlap(beats: WyvernBeats, t: number, out: WyvernFlap = { amount: 0, phase: 0, power: 1, index: -1, rising: false }): WyvernFlap {
  const RAISE = 0.26; // the wings lift to the top of the stroke before a beat
  const SETTLE = 0.24; // and settle back to the glide after the last of a group
  out.amount = 0;
  out.phase = 0;
  out.power = 1;
  out.index = -1;
  out.rising = false;
  const list = beats.wingbeats;
  let previous = -1;
  let next = -1;
  for (let i = 0; i < list.length; i += 1) {
    const beat = list[i];
    if (t >= beat.time && t < beat.time + beat.period) {
      out.amount = 1;
      out.phase = (t - beat.time) / beat.period;
      out.power = beat.power;
      out.index = i;
      return out;
    }
    if (beat.time + beat.period <= t) previous = i;
    else if (next < 0) next = i;
  }
  // Between beats the wings sit at the top of the stroke (phase 0), blended toward the glide.
  if (previous >= 0) {
    const end = list[previous].time + list[previous].period;
    const settle = 1 - smooth((t - end) / SETTLE);
    if (settle > out.amount) {
      out.amount = settle;
      out.power = list[previous].power;
      out.index = previous;
    }
  }
  if (next >= 0) {
    const raise = smooth((t - (list[next].time - RAISE)) / RAISE);
    if (raise > out.amount) {
      out.amount = raise;
      out.power = list[next].power;
      out.index = next;
      out.rising = true;
    }
  }
  return out;
}

function smooth(x: number): number {
  const c = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}

interface Knot {
  t: number;
  p: [number, number, number];
  v: [number, number, number];
}

/**
 * Builds the flight path for one run. Piecewise cubic Hermite through six
 * knots, so position and velocity are continuous everywhere and the body is
 * exactly over the target, flying level, at the strike.
 */
export function createWyvernPath(plan: WyvernPathPlan): WyvernPath {
  const carry = plan.carry ?? "eat";
  const beats = wyvernBeats(carry);
  const seed = (plan.seed ?? 1) >>> 0;
  const random = mulberry32(seed);
  const floor = plan.floor ?? WYVERN_FLOOR;
  const minY = floor + WYVERN_MIN_ALTITUDE;

  // Seeded character of this run. Drawn in a fixed order so the stream is stable.
  const side = random() < 0.5 ? -1 : 1;
  const bulge = 0.85 + random() * 0.3;
  const steep = 0.92 + random() * 0.16;
  const runIn = 0.92 + random() * 0.16;
  const lift = 0.94 + random() * 0.12;

  const T: [number, number, number] = [plan.target.x, plan.target.y, plan.target.z];
  const F: [number, number, number] = [plan.from.x, Math.max(plan.from.y, minY), plan.from.z];
  const A: [number, number, number] = [plan.away.x, Math.max(plan.away.y, minY), plan.away.z];

  // Horizontal directions: in from the sky, and out toward the exit.
  const inDir = horizontal(T[0] - F[0], T[2] - F[2], 0, 1);
  const outDir = horizontal(A[0] - T[0], A[2] - T[2], inDir[0], inDir[1]);
  // The strike heading leans toward the exit so the carry needs no hairpin.
  const g = horizontal(inDir[0] * 0.4 + outDir[0] * 0.6, inDir[1] * 0.4 + outDir[1] * 0.6, outDir[0], outDir[1]);

  // Body position at the strike: above and a little behind the victim's chest.
  const gripBack = plan.grip?.back ?? WYVERN_GRIP.back;
  const gripUp = Math.max(plan.grip?.up ?? WYVERN_GRIP.up, minY - T[1]);
  const S: [number, number, number] = [T[0] - g[0] * gripBack, T[1] + gripUp, T[2] - g[1] * gripBack];
  const strikeSpeed = 8.5;

  // Top of the dive.
  const diveBack = 7.2 * runIn;
  const diveHeight = 7.6 * steep;
  const D: [number, number, number] = [S[0] - g[0] * diveBack, S[1] + diveHeight, S[2] - g[1] * diveBack];

  // The approach bows out to one side between the sky and the top of the dive.
  const chord: [number, number, number] = [D[0] - F[0], D[1] - F[1], D[2] - F[2]];
  const chordLength = Math.hypot(chord[0], chord[2]);
  const chordDir = horizontal(chord[0], chord[2], g[0], g[1]);
  const swing = Math.min(7, Math.max(3, chordLength * 0.3)) * bulge;
  const P: [number, number, number] = [
    (F[0] + D[0]) / 2 + -chordDir[1] * side * swing,
    Math.max(minY, (F[1] + D[1]) / 2 + 0.4),
    (F[2] + D[2]) / 2 + chordDir[0] * side * swing,
  ];

  // End of the carry: partway to the exit and well up.
  const exit: [number, number, number] = [A[0] - S[0], A[1] - S[1], A[2] - S[2]];
  const exitFlat = Math.hypot(exit[0], exit[2]);
  const carryRun = Math.min(exitFlat * 0.6, Math.max(exitFlat * 0.25, 6));
  const carryRise = Math.min(8, Math.max(5, exit[1] * 0.5)) * lift;
  const R: [number, number, number] = [S[0] + outDir[0] * carryRun, S[1] + carryRise, S[2] + outDir[1] * carryRun];

  const Tm = WYVERN_TIMING;
  const tP = Tm.approach * 0.52;
  const knots: Knot[] = [
    { t: 0, p: F, v: scale(sub(P, F), 0.95 / tP) },
    { t: tP, p: P, v: scale(chord, 1.05 / Tm.approach) },
    { t: beats.dive, p: D, v: [g[0] * 8, -11.5, g[1] * 8] },
    { t: beats.strike, p: S, v: [g[0] * strikeSpeed, 0, g[1] * strikeSpeed] },
  ];
  let hover: [number, number, number] | null = null;
  let facing: [number, number] | null = null;
  if (beats.hover !== null && beats.release !== null) {
    // Eat: brake into a hover just past the strike, hold it through the feed, then go.
    hover = plan.hover
      ? [plan.hover.x, Math.max(plan.hover.y, minY), plan.hover.z]
      : [S[0] + g[0] * WYVERN_HOVER.run, Math.max(S[1] + 2.5, floor + WYVERN_HOVER.height * lift), S[2] + g[1] * WYVERN_HOVER.run];
    const toward = plan.face ?? plan.from;
    facing = horizontal(toward.x - hover[0], toward.z - hover[2], -g[0], -g[1]);
    // It drifts a little while it feeds, toward the way out.
    const drift: [number, number, number] = [hover[0] + outDir[0] * 0.5, hover[1] + 0.4, hover[2] + outDir[1] * 0.5];
    knots.push(
      { t: beats.hover, p: hover, v: [g[0] * 0.5, 0.5, g[1] * 0.5] },
      { t: beats.release, p: drift, v: scale(sub(A, drift), 1 / Math.max(1e-6, Math.hypot(A[0] - drift[0], A[1] - drift[1], A[2] - drift[2]))) },
      { t: beats.gone, p: A, v: scale(sub(A, drift), 1.6 / Tm.leave) },
    );
  } else {
    knots.push(
      { t: beats.strike + Tm.carry, p: R, v: scale(sub(A, R), 0.85 / Tm.leave) },
      { t: beats.gone, p: A, v: scale(sub(A, R), 1.3 / Tm.leave) },
    );
    // The climb out of the strike keeps some forward speed but must not sag.
    knots[4].v[1] = Math.max(knots[4].v[1], 1.2);
  }

  const segment = (t: number): number => {
    for (let i = knots.length - 2; i >= 0; i -= 1) if (t >= knots[i].t) return i;
    return 0;
  };

  function sample<V extends Vec3Like>(t: number, order: 0 | 1 | 2, out: V): V {
    const clamped = t <= 0 ? 0 : t >= beats.duration ? beats.duration : t;
    const i = segment(clamped);
    const a = knots[i];
    const b = knots[i + 1];
    const h = b.t - a.t;
    const u = (clamped - a.t) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    let h00: number, h10: number, h01: number, h11: number, k: number;
    if (order === 0) {
      h00 = 2 * u3 - 3 * u2 + 1; h10 = u3 - 2 * u2 + u; h01 = -2 * u3 + 3 * u2; h11 = u3 - u2; k = 1;
    } else if (order === 1) {
      h00 = 6 * u2 - 6 * u; h10 = 3 * u2 - 4 * u + 1; h01 = -6 * u2 + 6 * u; h11 = 3 * u2 - 2 * u; k = 1 / h;
    } else {
      h00 = 12 * u - 6; h10 = 6 * u - 4; h01 = -12 * u + 6; h11 = 6 * u - 2; k = 1 / (h * h);
    }
    out.x = (h00 * a.p[0] + h10 * h * a.v[0] + h01 * b.p[0] + h11 * h * b.v[0]) * k;
    out.y = (h00 * a.p[1] + h10 * h * a.v[1] + h01 * b.p[1] + h11 * h * b.v[1]) * k;
    out.z = (h00 * a.p[2] + h10 * h * a.v[2] + h01 * b.p[2] + h11 * h * b.v[2]) * k;
    return out;
  }

  const fresh = <V extends Vec3Like>(): V => ({ x: 0, y: 0, z: 0 }) as V;

  function position<V extends Vec3Like>(t: number, out?: V): V {
    const result = sample(t, 0, out ?? fresh<V>());
    // The knots already keep the body up; this is the hard guarantee.
    if (result.y < minY) result.y = minY;
    return result;
  }

  return {
    beats,
    seed,
    side,
    strikeHeading: { x: g[0], y: 0, z: g[1] },
    hover: hover ? { x: hover[0], y: hover[1], z: hover[2] } : null,
    hoverFacing: facing ? { x: facing[0], y: 0, z: facing[1] } : null,
    position,
    velocity: (t, out) => sample(t, 1, out ?? fresh()),
    acceleration: (t, out) => sample(t, 2, out ?? fresh()),
    grip(t, out) {
      const result = position(t, out);
      result.x += g[0] * gripBack;
      result.y -= gripUp;
      result.z += g[1] * gripBack;
      return result;
    },
  };
}

function horizontal(x: number, z: number, fallbackX: number, fallbackZ: number): [number, number] {
  const length = Math.hypot(x, z);
  if (length < 1e-4) return [fallbackX, fallbackZ];
  return [x / length, z / length];
}

function sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: [number, number, number], k: number): [number, number, number] {
  return [a[0] * k, a[1] * k, a[2] * k];
}

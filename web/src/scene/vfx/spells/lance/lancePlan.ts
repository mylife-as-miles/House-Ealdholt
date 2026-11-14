// Adapted from AbilityCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The Lance, as a timeline: what Korvenia's lance of light is doing at each moment, how large it is and what it is
 * drawn with. No Three.js in here, so the node tests reach it (shared/play/spell-lance.test.ts); lance/lance.ts
 * draws what this decides.
 *
 * The reference (Starbreaker Lance) is a show on an empty stage: circles under the caster, a star between the
 * palms, a straight beam that drives a dummy down the line. Ours is one cast in a match, on one clock:
 *
 *   gather    a small ring of script is written in front of the hand and ticks round like an escapement; motes
 *             are drawn in; a star swells at the hand. On the stone under the victim a sigil is being written.
 *   fire      the lance leaves: a front runs to the victim, drawing a hot core, a sheath and the streamers behind it
 *   strike    the front arrives (`strikeAt`): a star where it lands, a ring thrown across the stone, the sigil lit
 *   hold      the lance stands, beating; rings of script threaded on it turn against each other
 *   collapse  the hand lets go: the tail runs down the lance into the star, the streamers are flung off, and the
 *             star is drawn in to a point and throws a last ring
 *   cool      the sigil cools into the stone as embers, motes rise off it, the dust settles
 *
 * So nothing arrives switched on and nothing ends by fading: the lance is drawn out, stands, and is pulled through.
 * The brief form is for fast play and reduced motion: the lance is there whole and dim, swells and ebbs, and
 * nothing rushes, flashes or shakes.
 */
import type { QualityPreset } from "../../../quality";
import { smooth } from "../../mystic/beamPlan";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Korvenia's second colour: the gilt of its clockwork. The violet comes from the kingdom's spell look. */
export const LANCE_GOLD = 0xffc45e;
/** The gilt at white heat, for the heart of the sigil and the star's rays. */
export const LANCE_GOLD_HOT = 0xfff0cf;

export interface LanceBudget {
  /** Streamers wound round the lance. */
  streamers: number;
  /** Cuts along each ribbon. */
  segments: number;
  /** Rings of script threaded on the lance, besides the one in front of the hand. */
  gears: number;
  /** Motes drawn into the hand, and flung out when the star goes in. */
  motes: number;
  /** Sparks thrown where it lands. */
  sparks: number;
  /** Puffs of dust the blow lifts off the stone: the one layer that is matter, not light. */
  dust: number;
  /** Arcs crawling on the lance. Only a Queen's has them. */
  arcs: number;
  /** Rings thrown across the stone at the blow. */
  rings: number;
}

/** What a Bishop's lance is drawn with at each tier. The lowest has no bloom: the halo pass carries its glow. */
export const LANCE_BUDGET: Readonly<Record<QualityPreset, LanceBudget>> = {
  low: { streamers: 2, segments: 40, gears: 2, motes: 36, sparks: 24, dust: 8, arcs: 0, rings: 1 },
  medium: { streamers: 4, segments: 64, gears: 3, motes: 90, sparks: 56, dust: 14, arcs: 0, rings: 1 },
  high: { streamers: 6, segments: 96, gears: 4, motes: 160, sparks: 96, dust: 20, arcs: 0, rings: 1 },
  ultra: { streamers: 8, segments: 128, gears: 5, motes: 240, sparks: 140, dust: 26, arcs: 0, rings: 1 },
};

/** Arcs a Queen's lance carries at each tier. */
const QUEEN_ARCS: Readonly<Record<QualityPreset, number>> = { low: 0, medium: 2, high: 3, ultra: 4 };

/** From this power up a cast has a Queen's extras: arcs on the lance, another ring of script, a second thrown ring. */
export const QUEEN_POWER = 1.4;

/** What a lance of `power` is drawn with: a Queen's has more streamers, another gear, arcs, and a second ring. */
export function lanceCounts(quality: QualityPreset, power: number): LanceBudget {
  const base = LANCE_BUDGET[quality], more = clamp01((power - 1) / 0.75), queen = power >= QUEEN_POWER;
  return {
    streamers: Math.round(base.streamers * (1 + 0.3 * more)), segments: base.segments, gears: base.gears + (queen ? 1 : 0),
    motes: Math.round(base.motes * (1 + 0.4 * more)), sparks: Math.round(base.sparks * (1 + 0.5 * more)), dust: Math.round(base.dust * (1 + 0.4 * more)),
    arcs: queen ? QUEEN_ARCS[quality] : 0, rings: queen ? 2 : 1,
  };
}

export interface LanceSize {
  /** Half the core's width, and half the sheath's, in board units. */
  core: number;
  sheath: number;
  /** How far the streamers stand off the lance. */
  wind: number;
  /** The radius of the star at the hand, and of the star where it lands. */
  star: number;
  impact: number;
  /**
   * How far behind the victim's chest, seen from the eye, the star where it lands stands: moved level along the floor,
   * away from the eye, so it keeps its height. At the chest its white heart and glow covered the body at the kill; behind
   * it, the body stands whole against its light, its heart shows between the head and the shoulders and its rays break
   * round the body's edges, as if the lance had gone through. (Moved along the line of sight it sank toward the stone
   * behind the hips, where the body and its shield hid nearly all of it.)
   */
  behind: number;
  /** The radius of the ring of script in front of the hand, and of the sigil on the stone. */
  muzzle: number;
  sigil: number;
}

/**
 * How large a lance of `power` is, in board units where a square is `tile` across. A Queen's is about two fifths
 * wider than a Bishop's, not three quarters: it must still read as a lance and stay inside a square.
 */
export function lanceSize(power: number, tile = 1.02): LanceSize {
  const girth = Math.max(0.5, power) ** 0.6, unit = tile / 1.02;
  return {
    core: 0.02 * girth * unit, sheath: 0.075 * girth * unit, wind: 0.15 * girth * unit, star: 0.3 * girth * unit, impact: 0.7 * girth * unit, behind: 0.34 * unit,
    muzzle: 0.27 * girth * unit, sigil: Math.min(0.72, 0.5 * girth) * unit,
  };
}

/** Board units a second the front travels at: a ten-square cast crosses in about a quarter of a second. */
export const LANCE_SPEED = 34;

export interface LanceTimeline {
  /** The moment the lance leaves the hand. Everything before it is the gather. */
  fire: number;
  /** The moment the front reaches the victim. */
  strikeAt: number;
  /** The hand lets go. */
  release: number;
  /** The tail has run into the star, the star has gone in and thrown its last ring. */
  gone: number;
  /** Nothing is left. */
  total: number;
  brief: boolean;
}

/** The timeline of a cast `distance` board units long. */
export function lanceTimeline(distance: number, power: number, brief = false): LanceTimeline {
  if (brief) return { fire: 0.15, strikeAt: 0.45, release: 0.95, gone: 1.2, total: 1.7, brief: true };
  const more = clamp01((power - 1) / 0.75);
  const fire = 0.62 + 0.08 * more;
  const strikeAt = fire + clamp(distance / LANCE_SPEED, 0.08, 0.26);
  const release = strikeAt + 0.5 + 0.2 * more;
  const gone = release + 0.34;
  return { fire: +fire.toFixed(3), strikeAt: +strikeAt.toFixed(3), release: +release.toFixed(3), gone: +gone.toFixed(3), total: +(gone + 0.95).toFixed(3), brief: false };
}

export interface LanceState {
  /** The star at the hand, 0..1 and a little over as it lets fly. */
  star: number;
  /** How far the motes drawn into the hand have come, 0..1, and how bright they are. */
  inflow: number;
  inflowGlow: number;
  /** The ring of script in front of the hand: how much the pen has drawn, and how brightly it burns. */
  muzzleDrawn: number;
  muzzleGlow: number;
  /** The sigil on the stone under the victim: the same two. */
  sigilDrawn: number;
  sigilGlow: number;
  /** How far the front has come, and how far the tail has followed it, 0..1 along the lance. */
  head: number;
  tail: number;
  /** The lance's brightness (it beats while it stands) and how thick it is drawn against its size at rest. */
  power: number;
  girth: number;
  /** How far the streamers stand off, against their radius at rest: wound tight, then flung; and how bright they are. */
  wind: number;
  streamers: number;
  /** The star where it lands, 0 and up; about 1 while the lance stands, more on the blow. */
  impact: number;
  /** Seconds since the blow, since the hand let go and since the star went in; -1 before each. */
  sinceStrike: number;
  sinceRelease: number;
  sinceGone: number;
  /** The motes rising off the sigil, and the shaft of light over it, 0..1. */
  rise: number;
  shaft: number;
  struck: boolean;
  done: boolean;
  /** Camera shake, 0 for none; and the light it throws, where 1 is the lance at rest. */
  shake: number;
  light: number;
  /** Where the light is: 0 at the hand, 1 at the victim. */
  lightAt: number;
}

/** What the lance is doing `seconds` after the cast. `power` is the caster's. */
export function lanceState(timeline: LanceTimeline, seconds: number, power = 1): LanceState {
  const { fire, strikeAt, release, gone, total, brief } = timeline;
  const struck = seconds >= strikeAt, sinceStrike = struck ? seconds - strikeAt : -1;
  const sinceRelease = seconds >= release ? seconds - release : -1, sinceGone = seconds >= gone ? seconds - gone : -1;
  const done = seconds >= total;
  if (brief) {
    // one slow swell and ebb: the lance is whole from the start, and no part of it travels
    const swell = smooth(0, strikeAt, seconds) * (1 - smooth(release, gone, seconds));
    const ember = 1 - smooth(gone, total, seconds);
    return {
      star: 0.6 * swell, inflow: 1, inflowGlow: 0, muzzleDrawn: 1, muzzleGlow: 0.6 * swell, sigilDrawn: 1, sigilGlow: (0.25 + 0.5 * swell) * ember * smooth(0, 0.2, seconds),
      head: 1, tail: 0, power: 0.55 * swell, girth: 0.8, wind: 1, streamers: 1, impact: 0.45 * swell * smooth(strikeAt - 0.2, strikeAt + 0.2, seconds),
      sinceStrike, sinceRelease: -1, sinceGone: -1, rise: 0.5 * smooth(strikeAt, strikeAt + 0.4, seconds) * ember, shaft: 0.35 * swell,
      struck, done, shake: 0, light: done ? 0 : 0.7 * swell, lightAt: smooth(0, strikeAt, seconds),
    };
  }
  const gathered = smooth(0.05, fire, seconds);
  // the blow: sharp, and gone in a tenth of a second
  const blow = struck ? Math.exp(-sinceStrike / 0.09) : 0;
  // it beats while it stands, a little over three times a second, and each beat is felt in its girth
  const beat = struck && sinceRelease < 0 ? Math.abs(Math.sin(Math.PI * 3.2 * sinceStrike)) : 0;
  const leaving = sinceRelease < 0 ? 0 : clamp01(sinceRelease / (gone - release));
  // the tail starts slowly out of the hand and is fastest into the star
  const tail = leaving ** 1.7;
  // the star where it lands swells on the blow, stands, takes the tail in, and is drawn to a point
  const drawnIn = sinceRelease < 0 ? 0 : smooth(release + 0.6 * (gone - release), gone, seconds);
  const flung = sinceGone < 0 ? 0 : Math.exp(-sinceGone / 0.12);
  const cooled = smooth(gone, total, seconds);
  const front = seconds < fire ? 0 : clamp01((seconds - fire) / (strikeAt - fire));
  return {
    star: seconds < fire ? gathered * (0.85 + 0.15 * Math.sin(seconds * 21)) : Math.max(0, (1.25 - 0.45 * smooth(fire, fire + 0.12, seconds)) * (1 - smooth(release, release + 0.16, seconds))),
    inflow: clamp01(seconds / fire), inflowGlow: smooth(0, 0.15, seconds) * (1 - smooth(fire - 0.08, fire + 0.05, seconds)),
    muzzleDrawn: smooth(0.04, fire * 0.62, seconds), muzzleGlow: (0.35 + 0.65 * smooth(fire - 0.1, fire, seconds)) * (1 - smooth(release, release + 0.2, seconds)),
    sigilDrawn: smooth(fire * 0.3, strikeAt - 0.02, seconds),
    sigilGlow: done ? 0 : Math.max(0.12 * smooth(fire * 0.3, fire, seconds), struck ? (0.75 + 0.25 * beat + 0.6 * blow) * (1 - 0.45 * leaving) * (1 - cooled) + 0.5 * flung : 0),
    // it leaves the hand fast and does not slow: a lance is thrown, not poured
    head: front, tail,
    power: seconds < fire ? 0 : (seconds < strikeAt ? 0.9 : 0.88 + 0.12 * beat + 0.5 * blow) * (sinceGone < 0 ? 1 : 0),
    girth: (1 + 0.55 * blow + 0.1 * beat) * (1 - 0.5 * leaving),
    wind: 1 + 0.35 * blow + 1.5 * leaving * leaving, streamers: 1 - 0.85 * leaving * leaving,
    impact: struck ? (1 + 0.9 * blow + 0.12 * beat + 0.5 * Math.sin(Math.PI * leaving) * leaving) * (1 - drawnIn) + 1.5 * flung : 0,
    sinceStrike, sinceRelease, sinceGone,
    rise: struck ? smooth(strikeAt, strikeAt + 0.3, seconds) * (1 - smooth(gone + 0.3, total, seconds)) : 0,
    shaft: struck ? smooth(strikeAt, strikeAt + 0.15, seconds) * (1 - smooth(release, gone, seconds)) : 0,
    struck, done,
    shake: done ? 0 : Math.min(0.8, 0.42 * Math.sqrt(power) * blow + (struck && sinceRelease < 0 ? 0.035 : 0) + 0.2 * flung),
    light: done ? 0 : seconds < fire ? 0.7 * gathered : seconds < strikeAt ? 1.2 : (1 + 0.2 * beat + 3.2 * blow) * (1 - drawnIn) + 2 * flung + 0.25 * (1 - cooled) * (sinceGone < 0 ? 0 : 1),
    lightAt: seconds < fire ? 0 : struck ? 1 : front,
  };
}

/**
 * How far round a wheel of the clockwork has turned after `seconds`, in turns of one tooth: it stands, then ticks
 * a tooth on with a little overshoot, `rate` times a second, as an escapement lets a wheel go.
 */
export function gearTurn(seconds: number, rate: number): number {
  const at = Math.max(0, seconds) * rate, whole = Math.floor(at), within = at - whole;
  // the last third of a beat is the tick
  const t = clamp01((within - 0.66) / 0.34);
  const back = 1.9, eased = 1 + (back + 1) * (t - 1) ** 3 + back * (t - 1) ** 2;
  return whole + (t <= 0 ? 0 : eased);
}

/** Where gear `index` of `count` is threaded on the lance, 0..1 along it: evenly, clear of the hand and the star. */
export function gearStation(index: number, count: number): number {
  return 0.2 + (0.62 * (index + 0.5)) / Math.max(1, count);
}

/**
 * How far the lance may stray from its line at `u`, as a fraction of `amplitude`: nothing at the hand or the
 * victim, most a little past the middle. It wavers under its own power; it does not wander.
 */
export function lanceWaver(u: number, amplitude: number): number {
  const t = clamp01(u);
  return amplitude * Math.sin(Math.PI * t) ** 1.5 * (0.7 + 0.3 * t);
}

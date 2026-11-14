/**
 * What a witnessed moment means to each witness, as body language in the existing observer overlay. The meaning comes
 * from the battle memory (shared/play/battle-memory.ts, through battleBonds.ts): who the fallen was, and what each
 * witness was to it. BoardReactionDirector asks this module how far a feeling reaches a witness and how its cue reads;
 * the director keeps the budgets, cooldowns, line of sight, field of view and primary actors. LivingPieceRig plays the
 * cue within its bounds: upper body only, the sampled pose restored exactly, feet and board anchors untouched.
 *
 * | Witness                                   | Pose       | Looks at        | Reach                     |
 * |-------------------------------------------|------------|-----------------|---------------------------|
 * | a companion of the fallen (Pawn, Bishop,   | grief      | the body        | 3.1 squares + 3.5 x bond  |
 * | Queen, King)                              |            |                 |                           |
 * | a companion who is a Knight or Rook        | rage       | the killer      | same                      |
 * | an old comrade                            | mourn      | the body        | same                      |
 * | the King, when his guard falls            | dread      | the body        | the whole field           |
 * | anyone of the army, a veteran or the Queen | dread      | killer / body   | the whole field           |
 * | a stranger                                | glance     | as before       | 3.1 squares               |
 * | the killer's army, a veteran or the Queen  | resolve    | the body        | 4.2 squares               |
 * | the enemies of a figure that took a        | wary       | where it goes   | 3.6 squares               |
 * | veteran or a Queen, as it moves            |            |                 |                           |
 * | the avenger of a companion, once it lands  | vindicated | where they fell | itself                    |
 * | those who knew the avenged                 | resolve    | the avenger     | 3.1 squares + 3 x bond    |
 *
 * Pure: no three.js, no clocks, no randomness. The same memory and the same board give the same cues.
 */
import { COMPANION, COMRADE, type LossKind } from "../../../shared/play/battle-memory";
import type { Faction, PieceKind } from "../core/types";
import type { BoardObserver, BoardReactionCue, BoardReactionEventKind, ReactionPoint } from "./boardReactionDirector";

/** What a witnessed moment means, read from the battle memory. Without it a reaction is the plain one. */
export interface ReactionMeaning {
  /** The fall witnessed (capture-impact, ally-fallen): what it is to its army. */
  readonly loss?: LossKind;
  /** Each witness's bond to the fallen (for "avenged": to the avenged), 0 to 1, by observer id. Absent: a stranger. */
  readonly bonds?: Readonly<Record<string, number>>;
  /** The fallen's renown, 0 to 1. */
  readonly renown?: number;
  /** The observer id of the fallen's King, when the fallen stood at his side. */
  readonly king?: string;
  /** move-started: the mover took a veteran or a Queen, and `side` is its army: the other army watches it. */
  readonly feared?: boolean;
  readonly side?: Faction;
  /** avenged: the avenger's observer id, and whether it was the avenged one's companion. */
  readonly avenger?: string;
  readonly companion?: boolean;
  /** check: how much of his guard the King has lost, 0 to 1. His tension grows with it. */
  readonly guardLost?: number;
}

export type EmotionPose = "grief" | "mourn" | "glance" | "rage" | "dread" | "resolve" | "wary" | "vindicated";

/** Squares: a feeling with this reach is felt by everyone in the army who can see it. */
export const WHOLE_FIELD = 11.5;
/** Memory bonds are scaled into 0..1 by this: a bond of 3 or more is as close as two figures get. */
export const BOND_SCALE = 3;
const COMPANION_BOND = COMPANION / BOND_SCALE;
const COMRADE_BOND = COMRADE / BOND_SCALE;

interface Profile {
  readonly gaze: number;
  readonly flinch: number;
  /** Arms: positive raises the guard, negative lets them fall. */
  readonly grip: number;
  /** Chest: positive leans in or slumps, negative draws back. */
  readonly posture: number;
  /** Head: positive bows it, negative lifts the chin. */
  readonly bow: number;
  /** A slow deep breath through the hold. */
  readonly sigh: number;
  readonly onset: number;
  readonly release: number;
  readonly duration: number;
}

/** Radians and seconds, before each rank's temperament. */
export const EMOTION_PROFILES: Readonly<Record<Exclude<EmotionPose, "glance">, Profile>> = {
  // Head bowed, shoulders falling, the gaze held on the body; slow to come, slow to leave.
  grief: { gaze: 1, flinch: .05, grip: -.09, posture: .065, bow: .17, sigh: .022, onset: .55, release: 1.1, duration: 4.2 },
  mourn: { gaze: .85, flinch: .04, grip: -.05, posture: .035, bow: .09, sigh: .012, onset: .4, release: .8, duration: 2.8 },
  // The weapon comes up and the chest turns into the killer.
  rage: { gaze: 1, flinch: 0, grip: .16, posture: .045, bow: -.04, sigh: 0, onset: .22, release: .6, duration: 2.4 },
  // A recoil, the guard tightening, the weight drawn back.
  dread: { gaze: .9, flinch: .13, grip: .08, posture: -.035, bow: .05, sigh: .01, onset: .2, release: .7, duration: 2.6 },
  resolve: { gaze: .8, flinch: 0, grip: .07, posture: -.04, bow: -.06, sigh: 0, onset: .3, release: .7, duration: 2.2 },
  wary: { gaze: .9, flinch: 0, grip: .1, posture: -.02, bow: 0, sigh: 0, onset: .25, release: .5, duration: 2 },
  // Chin up, chest out, a long breath let go.
  vindicated: { gaze: .8, flinch: 0, grip: .04, posture: -.05, bow: -.08, sigh: .02, onset: .4, release: .9, duration: 2.8 },
};

/** How much of a feeling each rank lets the body show, and how long it holds it. */
const TEMPER: Readonly<Record<PieceKind, { body: number; flinch: number; hold: number }>> = {
  p: { body: 1, flinch: 1, hold: 1 },
  n: { body: 1, flinch: .6, hold: .9 },
  b: { body: .8, flinch: .4, hold: 1.05 },
  r: { body: .9, flinch: .5, hold: 1 },
  q: { body: .6, flinch: 0, hold: 1.15 },
  k: { body: .75, flinch: .2, hold: 1.1 },
};

export interface Feeling {
  /** null: the plain reaction, felt from farther off. */
  readonly pose: EmotionPose | null;
  /** Squares from the event at which the witness still feels it. */
  readonly reach: number;
  /** The witness's bond to the fallen, 0 to 1. */
  readonly bond: number;
  /** The event's point (the body, where a companion fell, where a feared figure goes), its focus (the killer, the avenger), or the plain reaction's. */
  readonly look: "point" | "focus" | "plain";
  /** The least strength at any distance within reach. */
  readonly strength: number;
  /** Added to the director's score: a companion wins the budget over a stranger. */
  readonly score: number;
  /** A stranger already reacting keeps the look it has rather than turning again. */
  readonly keep: boolean;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** What a moment is to one witness, or null when the meaning changes nothing for it. */
export function feel(type: BoardReactionEventKind, meaning: ReactionMeaning, actor: BoardObserver, allied: boolean, base: number): Feeling | null {
  const bond = clamp01(meaning.bonds?.[actor.id] ?? 0);
  switch (type) {
    case "capture-impact": {
      // The blow lands: the plain flinch, but a companion feels it from farther off, and the whole army a great one.
      if (!allied) return null;
      const field = meaning.loss === "royal" || meaning.loss === "veteran" || meaning.king === actor.id;
      return { pose: null, reach: Math.max(base + 3.5 * bond, field ? WHOLE_FIELD : 0), bond, look: "plain", strength: bond >= COMRADE_BOND ? .7 : field ? .4 : 0, score: 12 * bond, keep: false };
    }
    case "ally-fallen": return fallen(meaning, actor, allied, base, bond);
    case "move-started":
      if (!meaning.feared || !meaning.side || actor.color === meaning.side) return null;
      return { pose: "wary", reach: Math.max(base, 3.6), bond: 0, look: "point", strength: .55, score: 3, keep: false };
    case "avenged":
      if (actor.id === meaning.avenger) return { pose: meaning.companion ? "vindicated" : "resolve", reach: WHOLE_FIELD, bond, look: "point", strength: 1, score: 500, keep: false };
      // Only those who knew the avenged answer the vengeance.
      if (!allied || bond < COMRADE_BOND) return null;
      return { pose: "resolve", reach: base + 3 * bond, bond, look: "focus", strength: .7, score: 12 * bond, keep: false };
    default:
      return null;
  }
}

function fallen(meaning: ReactionMeaning, actor: BoardObserver, allied: boolean, base: number, bond: number): Feeling | null {
  const loss = meaning.loss ?? "stranger", great = loss === "royal" || loss === "veteran";
  if (!allied) return great ? { pose: "resolve", reach: Math.max(base, 4.2), bond: 0, look: "point", strength: .5, score: 1, keep: false } : null;
  const guarded = meaning.king === actor.id;
  const reach = Math.max(base + 3.5 * bond, great || guarded ? WHOLE_FIELD : 0);
  if (bond >= COMPANION_BOND) {
    // Warriors turn on the killer; the rest grieve over the body.
    const fury = actor.kind === "n" || actor.kind === "r";
    return { pose: fury ? "rage" : "grief", reach, bond, look: fury ? "focus" : "point", strength: .8, score: 12 * bond + 2, keep: false };
  }
  if (guarded) return { pose: "dread", reach, bond, look: "point", strength: 1, score: loss === "last-guard" ? 12 : 8, keep: false };
  if (bond >= COMRADE_BOND) return { pose: "mourn", reach, bond, look: "point", strength: .6, score: 12 * bond, keep: false };
  if (great) return { pose: "dread", reach, bond, look: loss === "veteran" ? "focus" : "point", strength: .45, score: 2, keep: false };
  return { pose: "glance", reach: base, bond, look: "plain", strength: 0, score: 0, keep: true };
}

/** A feeling whose look cannot be had (the killer hidden behind a figure): rage becomes grief, any other look goes to the point. */
export function lookAway(feeling: Feeling): Feeling {
  return feeling.pose === "rage" ? { ...feeling, pose: "grief", look: "point" } : { ...feeling, look: "point" };
}

/**
 * The cue a feeling gives, from the plain one the director would have played. `strength` is the director's distance
 * falloff (already floored by the feeling); `target` is where the look goes; `sees` is false when the target is behind
 * the witness (the avenger's own moment): it lifts its chin without turning its head.
 */
export function emotionalCue(plain: BoardReactionCue, feeling: Feeling, actor: BoardObserver, distance: number, strength: number, target: ReactionPoint, sees = true): BoardReactionCue {
  if (!feeling.pose) return plain;
  if (feeling.pose === "glance") {
    // A stranger's fall: a look, and back to the line.
    return { ...plain, gaze: plain.gaze * .8, grip: plain.grip * .6, posture: plain.posture * .6,
      duration: Math.min(plain.duration, actor.kind === "q" || actor.kind === "k" ? 1.6 : 1.15), onset: .16, release: .3 };
  }
  const p = EMOTION_PROFILES[feeling.pose], temper = TEMPER[actor.kind], body = temper.body * strength;
  const d = Math.max(0, distance);
  const delay = feeling.pose === "grief" ? Math.min(.75, .3 + d * .06) : feeling.pose === "mourn" ? Math.min(.6, .22 + d * .05)
    : feeling.pose === "rage" ? .12 : feeling.pose === "dread" ? Math.min(.5, .08 + d * .05) : feeling.pose === "resolve" ? Math.min(.6, .25 + d * .04)
    : feeling.pose === "wary" ? .1 + Math.min(.2, d * .04) : .45;
  return {
    target: { x: target.x, y: target.y, z: target.z }, pose: feeling.pose,
    gaze: sees ? p.gaze * strength : 0, flinch: p.flinch * temper.flinch * strength,
    grip: p.grip * body, posture: p.posture * body, bow: p.bow * body, sigh: p.sigh * temper.body,
    onset: p.onset, release: p.release, duration: p.duration * temper.hold, delay, sustained: false, headOnly: plain.headOnly,
  };
}

/**
 * The cue's weight at `t` seconds after it was given: it waits out its delay, eases in over its onset, holds, and eases
 * out over its release before its duration ends. A sustained cue holds until it is let go.
 */
export function cueEnvelope(cue: Pick<BoardReactionCue, "delay" | "duration" | "sustained" | "onset" | "release">, t: number): number {
  const local = t - cue.delay;
  if (!(local >= 0)) return 0;
  const rise = smooth(local / Math.max(1e-3, cue.onset ?? .18));
  return cue.sustained ? rise : rise * smooth((cue.duration - local) / Math.max(1e-3, cue.release ?? .35));
}

/**
 * The weight of a cue being let go, `since` seconds after: it holds where it stood (`from`) until the next cue's delay
 * has passed, then fades over `fade` seconds while the next one comes in. With no next cue the delay is 0.
 */
export function partingWeight(from: number, since: number, delay: number, fade: number): number {
  return from * (1 - smooth((since - delay) / Math.max(1e-3, fade)));
}

/** Hermite smoothstep of a 0..1 parameter (clamped): zero slope at both ends, so nothing starts or stops with a jolt. */
function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

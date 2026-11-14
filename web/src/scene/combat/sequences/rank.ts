/**
 * Knights, Rooks and Kings taking a Knight or a Rook: the fights played on the
 * rank libraries (web/src/assets/chess/combat-ranks, one per figure's rig;
 * scripts/chess/build_rank_combat_library.py). Every figure brings its own
 * strike, cut round the blow with motion-derived markers, and its own death.
 * The facts the timings rest on (seconds at rate 1):
 *   Charged Slash (Aethelgard, Solforiz and Korvenia Knights)  2.0   clash 0.47 (forehand)  contact 1.17 (backhand)
 *   Heavy Hammer Swing (Aethelgard and Solforiz Rooks)        1.85  contact 1.5-1.57, ends on the stone
 *   Sword Judgment (the three Kings)                           1.66  contact 1.0, a leaping overhead cut
 *   Lunge Roundhouse Kick (Kwind-09 Knight)                    2.53  contact 1.6
 *   Charged Ground Slam (Kwind-09 Rook)                        2.3   contact 1.6
 *   defend.block (bought for the Solforiz Knight, moved to the Aethelgard Knight)  guard 0.5
 * A rig without a guard or a hit clip gets the procedural block, recoil or
 * stagger in its place (rankDuel.ts keeps only the clips each rig holds).
 *
 * The way the attacker comes in decides the fight (rankDuel.ts `approachOf`):
 * from in front the defender squares up and guards, from the side or behind he
 * never turns, and the blow lands where it comes from. The hit and the fall
 * follow that side (deathWeight.ts `directionalReaction`).
 *
 * A King is never captured (choreography.ts refuses it), so no fight here has
 * one as the defender.
 */
import {
  at, type ActorAction, type At, type AudioAction, type ContactAction, type Cue, type DuelPoint, type Kind, type Sequence,
} from "../choreography";
import { HERS, HIS, ORIGIN, ground, standoff } from "./parts";

type ActorCue = Cue<ActorAction<DuelPoint, At>>;
export const COMBAT_RANK_LIBRARY = "crownfall-rank-combat-1" as const;
export type Approach = "front" | "side" | "back";

const DEFENDERS = ["n", "r"] as const;
const STRIKE = { role: "attack", prefer: ["attack.strike"], required: true } as const;
/** A guard clip by preference, the procedural block when the rig has none. */
const GUARDS = ["defend.block", "defend.block-mid", "defend.parry"] as const;
const guard = (from: At, on: At): ActorCue =>
  ({ at: from, do: "clip", clip: { role: "block", prefer: GUARDS, fallbacks: [{ pose: "block", strength: 1 }] }, sync: { events: ["guard"], to: on }, fade: 0.16 });
/** Steel stopped by whatever the defender holds. */
const stopped = (moment: At): Cue<AudioAction>[] => [
  { at: moment, cue: "clash.shield.wood", from: "defender", when: { defenderShield: "wood" } },
  { at: moment, cue: "clash.shield.iron", from: "defender", when: { defenderShield: "iron" } },
  { at: moment, cue: "clash.parry.steel", from: "defender", when: { defenderShield: "none" } },
];
const kill: Cue<ContactAction> = { at: at("decisive"), id: "kill", from: HIS.weapon, to: HERS.torso, lead: 0.2, hold: 0.16 };
const resolution = (power: number, weight: "light" | "heavy"): Sequence["resolution"] => ({
  power, weight,
  hit: { role: "hit", prefer: ["hit.front", "hit.heavy"], fallbacks: [{ pose: "stagger" }] },
  death: { role: "death", prefer: ["death.backward", "death.forward", "death.collapse", "death.front"] },
  claim: { gait: "walk" },
});
/** How each class closes: a Knight leaps the last of it, the rest walk in. */
const GAIT: Readonly<Record<"n" | "r" | "k", "leap" | "walk">> = { n: "leap", r: "walk", k: "walk" };
const approachMove = (kind: "n" | "r" | "k", duration: number, along = -0.04): ActorCue =>
  ({ at: at("approach"), do: "move", to: standoff(along), duration, gait: GAIT[kind], ...(kind === "n" ? { arc: 0.7 } : {}) });
const faceHim: ActorCue = { at: at("approach", 0.05), do: "face", toward: HERS.torso, duration: 0.25 };
/**
 * How long before its blow each class's strike starts, so it plays near its own speed: the courier's kick and a
 * Rook's swing need a long run-up, a King's leap a short one. A Knight caught off guard is cut with the Charged
 * Slash's backhand (its forehand passes in the air).
 */
const LEAD: Readonly<Record<"n" | "r" | "k", number>> = { n: 1.2, r: 1.5, k: 1.0 };
const KICK_LEAD = 1.55;
const strike = (lead: number): ActorCue =>
  ({ at: at("decisive", -lead), do: "clip", clip: STRIKE, sync: { events: ["impact", "contact"], to: at("decisive") }, fade: 0.14 });

// ------------------------------------------------------------------ from in front

/**
 * The Charged Slash swings twice: the forehand is turned on the guard, the
 * backhand goes round it. One clip carries both blows (`via`).
 */
function parried(kind: "n"): Sequence {
  return {
    version: 1, id: "rank.parried", tier: "standard", weight: 3, animationLibrary: COMBAT_RANK_LIBRARY,
    fits: { attacker: [kind], defender: DEFENDERS, attackerKingdom: ["ivory", "sun", "empire"], style: ["melee"] },
    requires: { attacker: ["attack.strike"] },
    budget: { seconds: 2.7, max: 3.3 },
    markers: { approach: 0, ready: 0.5, clash: 0.95, recoil: 1.05, counter: 1.4, decisive: 2.05, fall: 2.17, settle: 2.4 },
    note: "The forehand is caught on the guard; the backhand comes round it while the arm is still up.",
    tracks: {
      attacker: [
        approachMove(kind, 0.5),
        faceHim,
        // Forehand on `clash`, a held breath, the backhand on `decisive`.
        { at: at("ready", -0.1), do: "clip", clip: STRIKE, sync: { events: ["impact", "contact"], to: at("decisive") },
          via: { event: "clash", to: at("clash"), follow: 0.08, resume: at("counter"), crawl: 0.18 }, fade: 0.14 },
      ],
      defender: [
        { at: at("approach"), do: "face", toward: ORIGIN, duration: 0.25 },
        { at: at("approach", 0.1), do: "pose", pose: "brace", strength: 0.8, hold: 0.3, toward: HIS.torso },
        guard(at("clash", -0.5), at("clash")),
        { at: at("clash"), do: "pose", pose: "block", strength: 1, hold: 0.25, toward: HIS.weapon, drive: "ik" },
        { at: at("recoil"), do: "move", to: ground(0.1), duration: 0.22, gait: "step" },
        { at: at("recoil"), do: "pose", pose: "recoil", strength: 0.6, hold: 0.25 },
      ],
      camera: [
        { at: at("approach"), framing: "duel", fov: -2, duration: 0.4 },
        { at: at("clash"), framing: "contact", fov: -4, duration: 0.1 },
        { at: at("recoil", 0.1), framing: "duel", fov: -2, duration: 0.3 },
        { at: at("decisive", -0.15), framing: "contact", fov: -6, duration: 0.15 },
        { at: at("fall", 0.1), framing: "victor", fov: 0, duration: 0.35 },
      ],
      effects: [
        { at: at("clash"), fx: "sparks", where: HERS.shield, strength: 1 },
        { at: at("clash"), fx: "hitstop", where: HERS.shield, strength: 0.06 },
        { at: at("decisive"), fx: "slash", where: HERS.torso, strength: 1 },
      ],
      audio: [
        { at: at("approach", 0.05), cue: "effort.light", from: "attacker" },
        { at: at("clash", -0.15), cue: "whoosh.light", from: "attacker" },
        ...stopped(at("clash")),
        { at: at("recoil", 0.05), cue: "recoil", from: "defender" },
        { at: at("decisive", -0.2), cue: "whoosh.heavy", from: "attacker" },
        { at: at("decisive"), cue: "decisive" },
        { at: at("fall", 0.3), cue: "fall.light", from: "defender" },
      ],
    },
    contacts: [
      { at: at("clash"), id: "turned", from: HIS.weapon, to: HERS.shield, lead: 0.12, hold: 0.08, when: { defenderShield: "any" } },
      { at: at("clash"), id: "turned-parry", from: HIS.weapon, to: HERS.weapon, lead: 0.12, hold: 0.08, when: { defenderShield: "none" } },
      kill,
    ],
    resolution: resolution(1.15, "light"),
  };
}

/**
 * One blow, seen coming: the defender gets the guard up just in time and it is
 * not enough. The weight of a Rook's hammer, a King's leaping cut or the
 * courier's kick goes through it.
 */
function throughGuard(kind: "n" | "r" | "k"): Sequence {
  const heavy = kind !== "n";
  return {
    version: 1, id: `rank.through-guard.${kind}`, tier: "standard", weight: 2, animationLibrary: COMBAT_RANK_LIBRARY,
    fits: { attacker: [kind], defender: DEFENDERS, ...(kind === "n" ? { attackerKingdom: ["kwind"] } : {}), style: ["melee"] },
    requires: { attacker: ["attack.strike"] },
    budget: { seconds: 2.6, max: 3.2 },
    markers: { approach: 0, ready: 0.55, clash: 1.6, recoil: 1.65, counter: 1.75, decisive: 1.95, fall: 2.07, settle: 2.3 },
    note: "The guard comes up as the blow falls and the blow goes through it.",
    tracks: {
      attacker: [
        approachMove(kind, 0.55),
        faceHim,
        strike(kind === "n" ? KICK_LEAD : LEAD[kind]),
      ],
      defender: [
        { at: at("approach"), do: "face", toward: ORIGIN, duration: 0.25 },
        { at: at("approach", 0.1), do: "pose", pose: "brace", strength: 0.9, hold: 0.4, toward: HIS.torso },
        // Up a breath before the blow: the guard is set when it lands, and it is driven in.
        guard(at("clash", -0.55), at("clash")),
        { at: at("clash"), do: "pose", pose: "block", strength: 1, hold: 0.3, toward: HIS.weapon, drive: "ik" },
      ],
      camera: [
        { at: at("approach"), framing: "attacker", fov: 0, duration: 0.45 },
        { at: at("ready", 0.2), framing: "duel", fov: -2, duration: 0.35 },
        { at: at("decisive", -0.18), framing: "contact", fov: heavy ? -7 : -6, duration: 0.16 },
        { at: at("fall", 0.1), framing: "victor", fov: 0, duration: 0.4 },
      ],
      effects: [
        { at: at("decisive"), fx: "sparks", where: HERS.shield, strength: heavy ? 1.4 : 1 },
        { at: at("decisive"), fx: "shake", where: HERS.shield, strength: heavy ? 0.12 : 0.06 },
        { at: at("decisive"), fx: "slash", where: HERS.torso, strength: 1 },
        ...(heavy ? [{ at: at("decisive", 0.02), fx: "dust" as const, where: HERS.feet, strength: 0.8, when: { detail: true as const } }] : []),
      ],
      audio: [
        { at: at("approach", 0.05), cue: heavy ? "effort.heavy" : "effort.light", from: "attacker" },
        { at: at("clash", -0.1), cue: "brace", from: "defender" },
        { at: at("decisive", -0.22), cue: heavy ? "whoosh.heavy" : "whoosh.light", from: "attacker" },
        ...stopped(at("decisive", -0.02)),
        { at: at("decisive"), cue: "decisive" },
        { at: at("fall", 0.3), cue: heavy ? "fall.heavy" : "fall.light", from: "defender" },
      ],
    },
    contacts: [kill],
    resolution: resolution(heavy ? 1.4 : 1.15, heavy ? "heavy" : "light"),
  };
}

// ------------------------------------------------------------------ from the side and from behind

/**
 * Taken from the flank or from behind: the defender is still facing his own
 * front when the blow arrives and never turns to it. Only the head goes round,
 * too late.
 */
function unseen(kind: "n" | "r" | "k", approach: "side" | "back", kick = false): Sequence {
  const heavy = kind !== "n";
  // The Knights split by what they swing: the Charged Slash's backhand, or the Kwind-09 courier's kick with its long
  // run-up (KICK_LEAD), so each strike plays near its own speed.
  const knights = kind === "n" ? { attackerKingdom: kick ? ["kwind" as const] : ["ivory" as const, "sun" as const, "empire" as const] } : {};
  return {
    version: 1, id: `rank.${approach === "side" ? "flank" : "behind"}.${kind}${kick ? "-kick" : ""}`, tier: "standard", weight: 2, animationLibrary: COMBAT_RANK_LIBRARY,
    fits: { attacker: [kind], defender: DEFENDERS, ...knights, style: ["melee"] },
    requires: { attacker: ["attack.strike"] },
    budget: { seconds: 2.5, max: 3.1 },
    markers: { approach: 0, ready: 0.55, clash: 1.2, recoil: 1.3, counter: 1.5, decisive: 1.85, fall: 1.97, settle: 2.2 },
    note: approach === "side" ? "Cut down from the flank before he can turn." : "Struck from behind: he pitches forward without seeing it.",
    tracks: {
      attacker: [
        approachMove(kind, 0.55, -0.02),
        faceHim,
        strike(kick ? KICK_LEAD : LEAD[kind]),
      ],
      defender: [
        // He hears it: the head and shoulders go round towards it, the feet do not.
        { at: at("counter"), do: "pose", pose: "brace", strength: approach === "side" ? 0.7 : 0.45, hold: 0.3, toward: HIS.torso },
      ],
      camera: [
        { at: at("approach"), framing: "attacker", fov: 0, duration: 0.45 },
        { at: at("ready", 0.25), framing: "duel", fov: -2, duration: 0.35 },
        { at: at("decisive", -0.15), framing: "contact", fov: -6, duration: 0.15 },
        { at: at("fall", 0.1), framing: "victor", fov: 0, duration: 0.4 },
      ],
      effects: [
        { at: at("decisive"), fx: "slash", where: HERS.torso, strength: 1 },
        ...(heavy ? [{ at: at("decisive"), fx: "shake" as const, where: HERS.torso, strength: 0.08 }] : []),
      ],
      audio: [
        { at: at("approach", 0.05), cue: heavy ? "effort.heavy" : "effort.light", from: "attacker" },
        { at: at("decisive", -0.2), cue: heavy ? "whoosh.heavy" : "whoosh.light", from: "attacker" },
        { at: at("decisive"), cue: "decisive" },
        { at: at("fall", 0.3), cue: heavy ? "fall.heavy" : "fall.light", from: "defender" },
      ],
    },
    contacts: [kill],
    resolution: resolution(heavy ? 1.35 : 1.1, heavy ? "heavy" : "light"),
  };
}

const KINDS = ["n", "r", "k"] as const;
export const RANK_SEQUENCES: readonly Sequence[] = [
  parried("n"),
  ...KINDS.map(throughGuard),
  ...KINDS.map(kind => unseen(kind, "side")),
  unseen("n", "side", true),
  ...KINDS.map(kind => unseen(kind, "back")),
  unseen("n", "back", true),
];

/** Which way of coming in each fight is for. */
export const RANK_APPROACH: Readonly<Record<string, Approach>> = Object.fromEntries(RANK_SEQUENCES.map(sequence => [
  sequence.id, sequence.id.startsWith("rank.flank") ? "side" : sequence.id.startsWith("rank.behind") ? "back" : "front",
]));

/** Classes that fight on a rank library as the attacker. */
export const RANK_ATTACKERS: readonly Kind[] = KINDS;

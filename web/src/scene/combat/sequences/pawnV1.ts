/** Retained combat-v1 choreography for its recorded tuples and current bp/ep/kp rigs. */
/**
 * Pawn: a desperate soldier. Fast, messy, thrusts and shield work.
 *
 * Three variations on the 32 baked Pawn clips (combat-v1/wp.json, bp.json; the
 * two armies share ids and marker times), each with an underdog form for a
 * Pawn that kills a Rook or a Queen. Clip facts the timings are built on:
 *   attack.thrust       1.4 s  contact 0.80
 *   attack.bash-thrust  2.2 s  clash 0.67  contact 1.50
 *   attack.feint-step   2.4 s  feint 0.67  contact 1.63
 *   defend.block/parry  1.2 s  guard 0.47      defend.evade 1.4 s  evade 0.53
 *   hit.light/medium/heavy     hit 0.17 / 0.23 / 0.30
 * A clip is started so that its authored contact lands on the sequence marker
 * (`sync`), which is what puts spear and shield on the same frame.
 *
 * A rig without the baked library still plays these on its generic `attack`
 * clip (one swing per thrust) with procedural blocks; a rig with no attack
 * clip at all falls back to today's cinematic.
 */
import {
  at, type ActorAction, type At, type AudioAction, type ClipRequest, type ContactAction, type Cue, type DuelPoint,
  type EffectAction, type Sequence,
} from "../choreography";
import { HERS, HIS, ground, standoff } from "./parts";

type ActorCue = Cue<ActorAction<DuelPoint, At>>;
const strike = (id: string): ClipRequest => ({ role: "attack", prefer: [id], required: true });
/** An attack clip started at `from`, its contact landing on `on`. */
const attack = (id: string, from: At, on: At, events: readonly string[] = ["impact", "contact"]): ActorCue =>
  ({ at: from, do: "clip", clip: strike(id), sync: { events, to: on } });
/** The defender's guard, its authored guard frame landing on `on`. */
const guard = (prefer: readonly string[], from: At, on: At): ActorCue =>
  ({ at: from, do: "clip", clip: { role: "block", prefer, fallbacks: [{ pose: "block", strength: 1 }] }, sync: { events: ["guard", "evade"], to: on } });

/** Weapon stopped by whatever the defender holds: shield (by material) or weapon. */
const stopped = (moment: At, volume = 1): Cue<AudioAction>[] => [
  { at: moment, cue: "clash.shield.wood", volume, from: "defender", when: { defenderShield: "wood" } },
  { at: moment, cue: "clash.shield.iron", volume, from: "defender", when: { defenderShield: "iron" } },
  { at: moment, cue: "clash.parry.steel", volume, from: "defender", when: { defenderShield: "none" } },
];
const stoppedContact = (id: string, moment: At): Cue<ContactAction>[] => [
  { at: moment, id, from: HIS.weapon, to: HERS.shield, lead: 0.12, hold: 0.08, when: { defenderShield: "any" } },
  { at: moment, id: `${id}-parry`, from: HIS.weapon, to: HERS.weapon, lead: 0.12, hold: 0.08, when: { defenderShield: "none" } },
];
const sparks = (moment: At, strength = 0.9): Cue<EffectAction<DuelPoint>>[] => [
  { at: moment, fx: "sparks", where: HERS.shield, strength },
  { at: moment, fx: "shake", where: HERS.shield, strength: 0.04 * strength },
];
const killContact: Cue<ContactAction> = { at: at("decisive"), id: "kill", from: HIS.weapon, to: HERS.torso, lead: 0.18, hold: 0.16 };
/** One clip, two blows: `first` lands on `on`, the clip is held through a beat until `resume`, and its contact lands on `kill`. */
const twoBlows = (id: string, from: At, first: string, on: At, resume: At, kill: At, follow = 0.12, crawl = 0.12): ActorCue =>
  ({ at: from, do: "clip", clip: strike(id), sync: { events: ["impact", "contact"], to: kill }, via: { event: first, to: on, follow, resume, crawl }, fade: 0.18 });
const PAWN_BLOCK = ["defend.block", "defend.parry"] as const;
/** A clip blended in from the pose before it over `fade` seconds, where the two differ too much to cut. */
const blended = (cue: ActorCue, fade: number): ActorCue => cue.do === "clip" ? { ...cue, fade } : cue;

// ------------------------------------------------------------------ (a) thrust, block, recoil, follow-through

const thrustBlock: Sequence = {
  version: 1, id: "pawn.thrust-block", tier: "standard", weight: 3,
  fits: { attacker: ["p"], defender: ["p"], style: ["melee"] },
  budget: { seconds: 3, max: 3.6 },
  // Both thrusts run at the clip's own speed (contact 0.80 s in): the first is stopped, the second is a new blow 1.3 s later.
  markers: { approach: 0, ready: 0.45, clash: 1, recoil: 1.12, counter: 1.45, decisive: 2.3, fall: 2.4, settle: 2.6 },
  performance: { attack: "attack.thrust", defense: "defend.parry", hit: "hit.light", death: "death.front" },
  tracks: {
    attacker: [
      { at: at("approach"), do: "move", to: standoff(), duration: 0.45, gait: "run" },
      blended(attack("attack.thrust", at("clash", -0.8), at("clash")), 0.18),
      // Stopped dead on the shield: a breath where neither moves, then he gives a step.
      { at: at("recoil"), do: "pose", pose: "recoil", strength: 0.6, hold: 0.2 },
      { at: at("recoil"), do: "move", to: standoff(-0.2), duration: 0.3, gait: "step" },
      // The shove catches him; he gives ground and comes round the shield.
      { at: at("counter", 0.05), do: "pose", pose: "stagger", strength: 0.5, hold: 0.22 },
      { at: at("counter", 0.05), do: "move", to: standoff(-0.32, 0.24), duration: 0.38, gait: "step" },
      blended(attack("attack.thrust", at("decisive", -0.8), at("decisive")), 0.22),
      { at: at("counter", 0.4), do: "face", toward: HERS.torso, duration: 0.16 },
      // The last step lands before the spear does, so the thrust is thrown from planted feet.
      { at: at("decisive", -0.38), do: "move", to: standoff(0.04, 0.12), duration: 0.26, gait: "step" },
    ],
    defender: [
      { at: at("approach"), do: "face", toward: { point: { ref: "origin" } }, duration: 0.25 },
      { at: at("approach", 0.05), do: "pose", pose: "brace", strength: 0.8, hold: 0.3, toward: HIS.torso },
      blended(guard(PAWN_BLOCK, at("clash", -0.47), at("clash")), 0.18),
      { at: at("clash"), do: "pose", pose: "block", strength: 1, hold: 0.12, toward: HIS.weapon, drive: "ik" },
      // The thrust drives him back half a pace on his heels.
      { at: at("clash", 0.02), do: "move", to: ground(0.12), duration: 0.24, gait: "step" },
      // The counter: he puts his weight behind the shield and shoves.
      { at: at("counter"), do: "move", to: ground(-0.06), duration: 0.26, gait: "step" },
      { at: at("counter"), do: "pose", pose: "block", strength: 0.9, hold: 0.25, toward: HIS.torso },
      { at: at("counter", 0.45), do: "face", toward: HIS.torso, duration: 0.24 },
      // The shove has carried his shield wide: the second thrust finds the gap it left.
      { at: at("decisive", -0.24), do: "pose", pose: "recoil", strength: 0.3, hold: 0.2 },
    ],
    camera: [
      { at: at("approach"), framing: "duel", fov: -2, duration: 0.4 },
      { at: at("clash"), framing: "contact", fov: -4, duration: 0.1 },
      { at: at("recoil", 0.1), framing: "duel", fov: -2, duration: 0.3 },
      { at: at("decisive", -0.15), framing: "contact", fov: -6, duration: 0.15 },
      { at: at("fall", 0.1), framing: "victor", fov: 0, duration: 0.35 },
    ],
    effects: [
      ...sparks(at("clash")),
      { at: at("clash"), fx: "hitstop", where: HERS.shield, strength: 0.06 },
      { at: at("counter", 0.1), fx: "dust", where: HIS.feet, strength: 0.5, when: { detail: true } },
    ],
    audio: [
      { at: at("approach", 0.05), cue: "effort.light", from: "attacker" },
      { at: at("approach", 0.12), cue: "brace", from: "defender" },
      { at: at("clash", -0.15), cue: "whoosh.light", from: "attacker" },
      ...stopped(at("clash")),
      { at: at("recoil", 0.05), cue: "recoil", from: "attacker" },
      { at: at("counter"), cue: "effort.light", from: "defender" },
      { at: at("counter", 0.12), cue: "stagger", from: "attacker" },
      { at: at("decisive", -0.2), cue: "whoosh.light", from: "attacker" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.3), cue: "fall.light", from: "defender" },
    ],
  },
  contacts: [...stoppedContact("first", at("clash")), killContact],
  resolution: {
    power: 0.85, weight: "light",
    hit: { role: "hit", prefer: ["hit.light"], fallbacks: [{ pose: "recoil" }] },
    death: { role: "death", prefer: ["death.front"] },
    claim: { gait: "walk", clip: { role: "idle", prefer: ["recovery.stance"] } },
  },
};

const thrustBlockUnderdog: Sequence = {
  version: 1, id: "pawn.thrust-block.underdog", family: "pawn.thrust-block", tier: "underdog", weight: 3,
  fits: { attacker: ["p"], defender: ["r", "q"], style: ["melee"], minGap: 4 },
  budget: { seconds: 4.1, max: 4.8 },
  markers: { approach: 0, ready: 0.5, clash: 1, recoil: 1.15, counter: 1.5, decisive: 3.3, fall: 3.5, settle: 3.75 },
  note: "Three thrusts. The first is swatted away, the second stopped; only the third, from a new angle, gets through.",
  tracks: {
    attacker: [
      // He stops short: this is not a fight he expects to win.
      { at: at("approach"), do: "move", to: standoff(-0.12), duration: 0.5, gait: "run" },
      attack("attack.thrust", at("ready", -0.1), at("clash")),
      { at: at("recoil"), do: "pose", pose: "recoil", strength: 0.9, hold: 0.3 },
      { at: at("recoil"), do: "move", to: standoff(-0.38), duration: 0.3, gait: "step" },
      { at: at("counter", 0.05), do: "pose", pose: "stagger", strength: 1, hold: 0.45 },
      { at: at("counter", 0.05), do: "move", to: standoff(-0.6, 0.12), duration: 0.45, gait: "step" },
      // Scrambles back in for a second try.
      { at: at("counter", 0.55), do: "move", to: standoff(-0.05, 0.1), duration: 0.4, gait: "run" },
      attack("attack.thrust", at("counter", 0.55), at("counter", 1.1)),
      { at: at("counter", 1.2), do: "pose", pose: "recoil", strength: 0.6, hold: 0.2 },
      { at: at("counter", 1.25), do: "move", to: standoff(-0.2, 0.42), duration: 0.35, gait: "step" },
      attack("attack.thrust", at("decisive", -0.55), at("decisive")),
      { at: at("decisive", -0.45), do: "face", toward: HERS.torso, duration: 0.12 },
      { at: at("decisive", -0.3), do: "move", to: standoff(0.06, 0.3), duration: 0.26, gait: "step" },
    ],
    defender: [
      { at: at("approach", 0.15), do: "face", toward: { point: { ref: "origin" } }, duration: 0.35 },
      guard(PAWN_BLOCK, at("ready"), at("clash")),
      { at: at("clash"), do: "pose", pose: "block", strength: 1, hold: 0.2, toward: HIS.weapon, drive: "ik" },
      // Barely moved. It answers by walking him down.
      { at: at("counter"), do: "move", to: ground(-0.2), duration: 0.35, gait: "walk" },
      { at: at("counter"), do: "pose", pose: "block", strength: 1, hold: 0.4, toward: HIS.torso },
      { at: at("counter", 0.5), do: "pose", pose: "brace", strength: 0.7, hold: 0.5, toward: HIS.weapon },
      guard(PAWN_BLOCK, at("counter", 0.63), at("counter", 1.1)),
      // The second stop costs it its balance, and its guard swings wide.
      { at: at("counter", 1.15), do: "pose", pose: "recoil", strength: 0.7, hold: 0.3 },
      { at: at("counter", 1.2), do: "move", to: ground(-0.08), duration: 0.25, gait: "step" },
      { at: at("counter", 1.45), do: "face", toward: HIS.torso, duration: 0.3 },
      { at: at("counter", 1.5), do: "pose", pose: "brace", strength: 0.5, hold: 0.25, toward: HIS.weapon },
    ],
    camera: [
      { at: at("approach"), framing: "duel", fov: -1, duration: 0.5 },
      { at: at("clash"), framing: "contact", fov: -4, duration: 0.1 },
      { at: at("recoil", 0.1), framing: "attacker", fov: -2, duration: 0.4 },
      { at: at("counter", 0.6), framing: "duel", fov: -3, duration: 0.4 },
      { at: at("counter", 1.1), framing: "contact", fov: -5, duration: 0.1 },
      { at: at("counter", 1.3), framing: "duel", fov: -3, duration: 0.3 },
      { at: at("decisive", -0.2), framing: "contact", fov: -8, duration: 0.2 },
      { at: at("fall", 0.15), framing: "victor", fov: -2, duration: 0.5 },
    ],
    effects: [
      ...sparks(at("clash"), 1),
      { at: at("counter", 0.3), fx: "dust", where: HIS.feet, strength: 0.8 },
      ...sparks(at("counter", 1.1), 1.2),
      { at: at("counter", 1.1), fx: "hitstop", where: HERS.shield, strength: 0.05 },
      { at: at("decisive", -0.3), fx: "dust", where: HIS.feet, strength: 0.6, when: { detail: true } },
    ],
    audio: [
      { at: at("approach", 0.1), cue: "effort.light", from: "attacker" },
      { at: at("clash", -0.15), cue: "whoosh.light", from: "attacker" },
      ...stopped(at("clash")),
      { at: at("recoil"), cue: "recoil", from: "attacker" },
      { at: at("counter"), cue: "whoosh.heavy", from: "defender" },
      { at: at("counter", 0.15), cue: "stagger", from: "attacker" },
      { at: at("counter", 0.6), cue: "effort.light", from: "attacker" },
      { at: at("counter", 0.95), cue: "whoosh.light", from: "attacker" },
      ...stopped(at("counter", 1.1), 1),
      { at: at("counter", 1.2), cue: "recoil", from: "defender" },
      { at: at("decisive", -0.4), cue: "effort.heavy", from: "attacker" },
      { at: at("decisive", -0.18), cue: "whoosh.light", from: "attacker" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.35), cue: "fall.heavy", from: "defender" },
      { at: at("settle", 0.15), cue: "effort.heavy", volume: 0.8, from: "attacker" },
    ],
  },
  contacts: [...stoppedContact("first", at("clash")), ...stoppedContact("second", at("counter", 1.1)), killContact],
  resolution: {
    power: 1.15, weight: "heavy",
    hit: { role: "hit", prefer: ["hit.heavy"], fallbacks: [{ pose: "stagger" }] },
    death: { role: "death", prefer: ["death.dramatic"] },
    claim: { gait: "walk", clip: { role: "idle", prefer: ["recovery.victory"] } },
  },
};

// ------------------------------------------------------------------ (b) feint, sidestep, finishing strike

const feintSidestep: Sequence = {
  version: 1, id: "pawn.feint-sidestep", tier: "standard", weight: 2,
  fits: { attacker: ["p"], defender: ["p"], style: ["melee"] },
  budget: { seconds: 2.85, max: 3.4 },
  // One clip carries feint, step and finish (0.67 -> 1.63 authored). The feint lands on `clash`, the clip hangs a
  // moment while the defender bites, and the finish lands on `decisive`: both halves run near the clip's own speed.
  markers: { approach: 0, ready: 0.4, clash: 1, recoil: 1.15, counter: 1.4, decisive: 2.15, fall: 2.25, settle: 2.45 },
  performance: { attack: "attack.feint-step", defense: "defend.evade", hit: "hit.heavy", death: "death.dramatic" },
  note: "`clash` is the feint: nothing touches. The defender dodges a blow that never comes and is caught moving.",
  tracks: {
    attacker: [
      // He stops a pace short, so the false start has somewhere to go.
      { at: at("approach"), do: "move", to: standoff(-0.34), duration: 0.4, gait: "run" },
      twoBlows("attack.feint-step", at("clash", -0.69), "feint", at("clash"), at("recoil", 0.08), at("decisive"), 0.1, 0.3),
      // The false start: a whole committed step in behind the spear.
      { at: at("clash", -0.32), do: "move", to: standoff(-0.02), duration: 0.3, gait: "step" },
      { at: at("recoil"), do: "pose", pose: "recoil", strength: 0.3, hold: 0.1 },
      // Steps across to cut off the side the defender fled to.
      { at: at("counter"), do: "move", to: standoff(0.02, 0.3), duration: 0.4, gait: "step" },
      { at: at("counter", 0.34), do: "face", toward: HERS.torso, duration: 0.16 },
    ],
    defender: [
      { at: at("approach"), do: "face", toward: { point: { ref: "origin" } }, duration: 0.25 },
      { at: at("approach", 0.05), do: "pose", pose: "brace", strength: 0.7, hold: 0.3, toward: HIS.torso },
      // Bites on the feint and throws himself aside.
      { at: at("clash", -0.53), do: "clip", clip: { role: "block", prefer: ["defend.evade", "defend.block"], fallbacks: [{ pose: "recoil", strength: 0.8 }] }, sync: { events: ["evade", "guard"], to: at("clash") }, fade: 0.18 },
      // A real dodge: a third of a square, clear of where the spear was pointed.
      { at: at("clash", -0.14), do: "move", to: ground(0.06, 0.32), duration: 0.32, gait: "step" },
      { at: at("recoil", 0.05), do: "pose", pose: "stagger", strength: 0.4, hold: 0.2 },
      { at: at("counter", 0.25), do: "face", toward: HIS.torso, duration: 0.3 },
    ],
    camera: [
      { at: at("approach"), framing: "duel", fov: -2, duration: 0.35 },
      { at: at("clash", -0.1), framing: "defender", fov: -3, duration: 0.2 },
      { at: at("counter"), framing: "duel", fov: -3, duration: 0.3 },
      { at: at("decisive", -0.15), framing: "contact", fov: -6, duration: 0.15 },
      { at: at("fall", 0.1), framing: "victor", fov: 0, duration: 0.35 },
    ],
    effects: [
      { at: at("clash"), fx: "dust", where: HERS.feet, strength: 0.6 },
      { at: at("counter", 0.1), fx: "dust", where: HIS.feet, strength: 0.4, when: { detail: true } },
    ],
    audio: [
      { at: at("approach", 0.05), cue: "effort.light", from: "attacker" },
      { at: at("clash", -0.3), cue: "effort.light", from: "attacker" },
      { at: at("clash", -0.12), cue: "whoosh.light", from: "attacker" },
      { at: at("clash"), cue: "recoil", from: "defender" },
      { at: at("recoil", 0.08), cue: "stagger", from: "defender" },
      { at: at("counter", 0.05), cue: "effort.light", from: "attacker" },
      { at: at("decisive", -0.2), cue: "whoosh.light", from: "attacker" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.3), cue: "fall.light", from: "defender" },
    ],
  },
  contacts: [killContact],
  resolution: {
    power: 1.05, weight: "light",
    hit: { role: "hit", prefer: ["hit.heavy"], fallbacks: [{ pose: "stagger" }] },
    // The recorded tuple (`performance`) still names death.dramatic, so old games replay and new ones record as before.
    // On the stage a spear thrust does not throw a man a square through the air: he goes down backward, with weight.
    death: { role: "death", prefer: ["death.backward", "death.dramatic"] },
    claim: { gait: "walk", clip: { role: "idle", prefer: ["recovery.stance"] } },
  },
};

const feintSidestepUnderdog: Sequence = {
  version: 1, id: "pawn.feint-sidestep.underdog", family: "pawn.feint-sidestep", tier: "underdog", weight: 2,
  fits: { attacker: ["p"], defender: ["r", "q"], style: ["melee"], minGap: 4 },
  budget: { seconds: 4, max: 4.8 },
  markers: { approach: 0, ready: 0.5, clash: 1.1, recoil: 1.25, counter: 1.5, decisive: 3.2, fall: 3.4, settle: 3.65 },
  note: "The feint is read. The follow-up is stopped and he is thrown back; a second, lower feint and a sidestep finally open the line.",
  tracks: {
    attacker: [
      { at: at("approach"), do: "move", to: standoff(-0.12), duration: 0.5, gait: "run" },
      // Feint at `clash`, its finishing thrust arriving, and stopped, at counter + 0.55.
      attack("attack.feint-step", at("ready", -0.07), at("counter", 0.55)),
      { at: at("counter", 0.05), do: "move", to: standoff(0, -0.18), duration: 0.4, gait: "step" },
      { at: at("counter", 0.62), do: "pose", pose: "stagger", strength: 1, hold: 0.45 },
      { at: at("counter", 0.65), do: "move", to: standoff(-0.55, -0.1), duration: 0.45, gait: "step" },
      // Up again. A short feint low, then round the other side.
      { at: at("counter", 1.15), do: "pose", pose: "brace", strength: 0.5, hold: 0.2 },
      { at: at("counter", 1.2), do: "move", to: standoff(-0.12, 0.4), duration: 0.4, gait: "run" },
      attack("attack.thrust", at("decisive", -0.5), at("decisive")),
      { at: at("decisive", -0.42), do: "face", toward: HERS.torso, duration: 0.12 },
      { at: at("decisive", -0.28), do: "move", to: standoff(0.06, 0.32), duration: 0.24, gait: "step" },
    ],
    defender: [
      { at: at("approach", 0.15), do: "face", toward: { point: { ref: "origin" } }, duration: 0.35 },
      // It does not bite: a small lean, no more.
      { at: at("clash", -0.1), do: "pose", pose: "brace", strength: 0.5, hold: 0.4, toward: HIS.weapon },
      guard(PAWN_BLOCK, at("counter", 0.08), at("counter", 0.55)),
      { at: at("counter", 0.55), do: "pose", pose: "block", strength: 1, hold: 0.25, toward: HIS.weapon, drive: "ik" },
      { at: at("counter", 0.6), do: "move", to: ground(-0.16), duration: 0.3, gait: "step" },
      { at: at("counter", 1.25), do: "pose", pose: "block", strength: 0.8, hold: 0.3, toward: HIS.weapon },
      // Guards the wrong line, then turns too late.
      { at: at("decisive", -0.25), do: "face", toward: HIS.torso, duration: 0.25 },
      { at: at("decisive", -0.2), do: "pose", pose: "recoil", strength: 0.4, hold: 0.2 },
    ],
    camera: [
      { at: at("approach"), framing: "duel", fov: -1, duration: 0.5 },
      { at: at("clash", -0.1), framing: "defender", fov: -2, duration: 0.25 },
      { at: at("counter", 0.5), framing: "contact", fov: -5, duration: 0.1 },
      { at: at("counter", 0.75), framing: "attacker", fov: -2, duration: 0.4 },
      { at: at("counter", 1.2), framing: "duel", fov: -3, duration: 0.35 },
      { at: at("decisive", -0.2), framing: "contact", fov: -8, duration: 0.2 },
      { at: at("fall", 0.15), framing: "victor", fov: -2, duration: 0.5 },
    ],
    effects: [
      ...sparks(at("counter", 0.55), 1.1),
      { at: at("counter", 0.9), fx: "dust", where: HIS.feet, strength: 0.8 },
      { at: at("decisive", -0.3), fx: "dust", where: HIS.feet, strength: 0.5, when: { detail: true } },
    ],
    audio: [
      { at: at("approach", 0.1), cue: "effort.light", from: "attacker" },
      { at: at("clash", -0.12), cue: "whoosh.light", volume: 0.8, from: "attacker" },
      { at: at("clash", 0.05), cue: "brace", from: "defender" },
      { at: at("counter", 0.38), cue: "whoosh.light", from: "attacker" },
      ...stopped(at("counter", 0.55)),
      { at: at("counter", 0.62), cue: "whoosh.heavy", from: "defender" },
      { at: at("counter", 0.75), cue: "stagger", from: "attacker" },
      { at: at("counter", 1.2), cue: "effort.light", from: "attacker" },
      { at: at("decisive", -0.4), cue: "effort.heavy", from: "attacker" },
      { at: at("decisive", -0.18), cue: "whoosh.light", from: "attacker" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.35), cue: "fall.heavy", from: "defender" },
      { at: at("settle", 0.15), cue: "effort.heavy", volume: 0.8, from: "attacker" },
    ],
  },
  contacts: [...stoppedContact("stopped", at("counter", 0.55)), killContact],
  resolution: {
    power: 1.15, weight: "heavy",
    hit: { role: "hit", prefer: ["hit.heavy"], fallbacks: [{ pose: "stagger" }] },
    death: { role: "death", prefer: ["death.dramatic"] },
    claim: { gait: "walk", clip: { role: "idle", prefer: ["recovery.victory"] } },
  },
};

// ------------------------------------------------------------------ (c) shield bash, then thrust

const bashThrust: Sequence = {
  version: 1, id: "pawn.bash-thrust", tier: "standard", weight: 2,
  fits: { attacker: ["p"], defender: ["p"], style: ["melee"], attackerShield: true },
  budget: { seconds: 2.8, max: 3.4 },
  // One clip carries both blows (clash 0.67, contact 1.50 authored), but they are two actions here: the bash lands on
  // `clash`, the clip is held while he gives a step and sets himself, and the thrust is thrown from `counter`.
  markers: { approach: 0, ready: 0.4, clash: 0.9, recoil: 1.05, counter: 1.42, decisive: 2.05, fall: 2.15, settle: 2.35 },
  performance: { attack: "attack.bash-thrust", defense: "defend.block", hit: "hit.medium", death: "death.backward" },
  tracks: {
    attacker: [
      // Closer than spear range: he means to hit with the shield.
      { at: at("approach"), do: "move", to: standoff(0.09), duration: 0.4, gait: "run" },
      twoBlows("attack.bash-thrust", at("clash", -0.69), "clash", at("clash"), at("counter"), at("decisive"), 0.14),
      // The bash has landed. He rides it for a moment, then steps back off the shield and sets his feet.
      { at: at("recoil"), do: "move", to: standoff(-0.22), duration: 0.3, gait: "step" },
      { at: at("recoil", 0.06), do: "pose", pose: "brace", strength: 0.5, hold: 0.25 },
      // A separate blow: the step in lands before the spear does.
      { at: at("decisive", -0.38), do: "move", to: standoff(0.04), duration: 0.26, gait: "step" },
    ],
    defender: [
      { at: at("approach"), do: "face", toward: { point: { ref: "origin" } }, duration: 0.25 },
      { at: at("approach", 0.05), do: "pose", pose: "brace", strength: 1, hold: 0.45, toward: HIS.torso },
      blended(guard(PAWN_BLOCK, at("clash", -0.47), at("clash")), 0.18),
      { at: at("clash"), do: "pose", pose: "stagger", strength: 0.9, hold: 0.35 },
      { at: at("clash", 0.02), do: "move", to: ground(0.22), duration: 0.32, gait: "step" },
      // Not the clip the killing blow will play: the same clip cannot be blended into itself.
      { at: at("clash", 0.1), do: "clip", clip: { role: "stagger", prefer: ["hit.light", "hit.heavy"], fallbacks: [{ pose: "stagger" }] }, fade: 0.2 },
      // Tries to get the shield back between them, and is still doing it when the spear comes.
      { at: at("counter", 0.05), do: "face", toward: HIS.torso, duration: 0.25 },
    ],
    camera: [
      { at: at("approach"), framing: "duel", fov: -2, duration: 0.35 },
      { at: at("clash"), framing: "contact", fov: -5, duration: 0.1 },
      { at: at("recoil", 0.1), framing: "duel", fov: -2, duration: 0.3 },
      { at: at("decisive", -0.15), framing: "contact", fov: -6, duration: 0.15 },
      { at: at("fall", 0.1), framing: "victor", fov: 0, duration: 0.35 },
    ],
    effects: [
      { at: at("clash"), fx: "flash", where: HERS.shield, strength: 0.7 },
      { at: at("clash"), fx: "shake", where: HERS.shield, strength: 0.08 },
      { at: at("clash"), fx: "hitstop", where: HIS.shield, strength: 0.07 },
      { at: at("recoil", 0.1), fx: "dust", where: HERS.feet, strength: 0.7 },
    ],
    audio: [
      { at: at("approach", 0.05), cue: "effort.heavy", from: "attacker" },
      { at: at("approach", 0.12), cue: "brace", from: "defender" },
      { at: at("clash", -0.12), cue: "whoosh.heavy", from: "attacker" },
      { at: at("clash"), cue: "bash.shield", from: "defender" },
      { at: at("clash", 0.14), cue: "stagger", from: "defender" },
      { at: at("recoil", 0.05), cue: "recoil", from: "attacker" },
      { at: at("counter", 0.05), cue: "effort.light", from: "attacker" },
      { at: at("decisive", -0.2), cue: "whoosh.light", from: "attacker" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.3), cue: "fall.light", from: "defender" },
    ],
  },
  contacts: [
    { at: at("clash"), id: "bash", from: HIS.shield, to: HERS.shield, lead: 0.14, hold: 0.1, when: { defenderShield: "any" } },
    { at: at("clash"), id: "bash-body", from: HIS.shield, to: HERS.torso, lead: 0.14, hold: 0.1, when: { defenderShield: "none" } },
    killContact,
  ],
  resolution: {
    power: 0.95, weight: "light",
    hit: { role: "hit", prefer: ["hit.medium"], fallbacks: [{ pose: "recoil" }] },
    death: { role: "death", prefer: ["death.backward"] },
    claim: { gait: "walk", clip: { role: "idle", prefer: ["recovery.stance"] } },
  },
};

const bashThrustUnderdog: Sequence = {
  version: 1, id: "pawn.bash-thrust.underdog", family: "pawn.bash-thrust", tier: "underdog", weight: 2,
  fits: { attacker: ["p"], defender: ["r", "q"], style: ["melee"], attackerShield: true, minGap: 4 },
  budget: { seconds: 4.2, max: 4.9 },
  markers: { approach: 0, ready: 0.45, clash: 1, recoil: 1.15, counter: 1.5, decisive: 3.4, fall: 3.6, settle: 3.85 },
  note: "The first bash bounces off and it is the Pawn who is thrown back. The second, with everything he has, finally moves it; the thrust follows.",
  tracks: {
    attacker: [
      { at: at("approach"), do: "move", to: standoff(0.1), duration: 0.45, gait: "run" },
      attack("attack.bash-thrust", at("ready", -0.12), at("clash"), ["clash", "impact", "contact"]),
      // He rebounds off it; the clip's own thrust never happens.
      { at: at("recoil"), do: "clip", clip: { role: "stagger", prefer: ["hit.light"], fallbacks: [{ pose: "recoil", strength: 1 }] } },
      { at: at("recoil"), do: "move", to: standoff(-0.3), duration: 0.3, gait: "step" },
      { at: at("counter", 0.05), do: "pose", pose: "stagger", strength: 1, hold: 0.3 },
      { at: at("counter", 0.05), do: "move", to: standoff(-0.55, 0.1), duration: 0.35, gait: "step" },
      // The whole charge again: bash at counter + 1.05, thrust on the decisive marker.
      attack("attack.bash-thrust", at("counter", 0.36), at("decisive")),
      { at: at("counter", 0.5), do: "move", to: standoff(0.12), duration: 0.5, gait: "run" },
      { at: at("counter", 1.3), do: "move", to: standoff(-0.02), duration: 0.2, gait: "step" },
      { at: at("decisive", -0.25), do: "move", to: standoff(0.1), duration: 0.2, gait: "step" },
    ],
    defender: [
      { at: at("approach", 0.15), do: "face", toward: { point: { ref: "origin" } }, duration: 0.3 },
      { at: at("clash", -0.3), do: "pose", pose: "brace", strength: 1, hold: 0.5, toward: HIS.torso },
      { at: at("counter"), do: "pose", pose: "block", strength: 1, hold: 0.35, toward: HIS.torso },
      { at: at("counter"), do: "move", to: ground(-0.14), duration: 0.3, gait: "walk" },
      guard(PAWN_BLOCK, at("counter", 0.58), at("counter", 1.05)),
      { at: at("counter", 1.05), do: "pose", pose: "stagger", strength: 0.8, hold: 0.4 },
      { at: at("counter", 1.05), do: "move", to: ground(0.12), duration: 0.3, gait: "step" },
      { at: at("counter", 1.5), do: "pose", pose: "brace", strength: 0.4, hold: 0.3, toward: HIS.weapon },
    ],
    camera: [
      { at: at("approach"), framing: "duel", fov: -1, duration: 0.45 },
      { at: at("clash"), framing: "contact", fov: -4, duration: 0.1 },
      { at: at("recoil", 0.1), framing: "attacker", fov: -2, duration: 0.4 },
      { at: at("counter", 0.5), framing: "duel", fov: -3, duration: 0.4 },
      { at: at("counter", 1.05), framing: "contact", fov: -6, duration: 0.1 },
      { at: at("counter", 1.3), framing: "duel", fov: -3, duration: 0.3 },
      { at: at("decisive", -0.2), framing: "contact", fov: -8, duration: 0.2 },
      { at: at("fall", 0.15), framing: "victor", fov: -2, duration: 0.5 },
    ],
    effects: [
      { at: at("clash"), fx: "flash", where: HERS.torso, strength: 0.5 },
      { at: at("recoil", 0.2), fx: "dust", where: HIS.feet, strength: 0.8 },
      { at: at("counter", 1.05), fx: "flash", where: HERS.torso, strength: 1 },
      { at: at("counter", 1.05), fx: "shake", where: HERS.torso, strength: 0.12 },
      { at: at("counter", 1.05), fx: "hitstop", where: HIS.shield, strength: 0.07 },
      { at: at("counter", 1.2), fx: "dust", where: HERS.feet, strength: 0.9 },
    ],
    audio: [
      { at: at("approach", 0.05), cue: "effort.heavy", from: "attacker" },
      { at: at("clash", -0.12), cue: "whoosh.heavy", from: "attacker" },
      { at: at("clash"), cue: "bash.shield", volume: 0.8, from: "defender" },
      { at: at("recoil"), cue: "recoil", from: "attacker" },
      { at: at("counter"), cue: "whoosh.heavy", from: "defender" },
      { at: at("counter", 0.15), cue: "stagger", from: "attacker" },
      { at: at("counter", 0.55), cue: "effort.heavy", from: "attacker" },
      { at: at("counter", 0.93), cue: "whoosh.heavy", from: "attacker" },
      { at: at("counter", 1.05), cue: "bash.shield", from: "defender" },
      { at: at("counter", 1.12), cue: "stagger", from: "defender" },
      { at: at("decisive", -0.18), cue: "whoosh.light", from: "attacker" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.35), cue: "fall.heavy", from: "defender" },
      { at: at("settle", 0.15), cue: "effort.heavy", volume: 0.8, from: "attacker" },
    ],
  },
  contacts: [
    { at: at("clash"), id: "bash", from: HIS.shield, to: HERS.torso, lead: 0.12, hold: 0.08 },
    { at: at("counter", 1.05), id: "bash-again", from: HIS.shield, to: HERS.torso, lead: 0.12, hold: 0.1 },
    killContact,
  ],
  resolution: {
    power: 1.2, weight: "heavy",
    hit: { role: "hit", prefer: ["hit.heavy"], fallbacks: [{ pose: "stagger" }] },
    death: { role: "death", prefer: ["death.backward", "death.dramatic"] },
    claim: { gait: "walk", clip: { role: "idle", prefer: ["recovery.victory"] } },
  },
};

export const PAWN_V1_SEQUENCES: readonly Sequence[] = [
  thrustBlock, feintSidestep, bashThrust,
  thrustBlockUnderdog, feintSidestepUnderdog, bashThrustUnderdog,
];

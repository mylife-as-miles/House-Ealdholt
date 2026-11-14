/**
 * Knight: an explosive duellist. Leaps in, twists in the air, lands with
 * momentum; sweeping strikes and sudden reversals.
 *
 * These need authored clips that do not exist yet (`requires`), so until an
 * animator ships them the director answers "fallback" and today's cinematic
 * runs. The clip contract, with the events each must carry:
 *   attack.leap-strike   launch, land, contact      one leap ending in a downward cut
 *   attack.charge-break  clash, contact             shoulder/shield break, then a sweep
 *   attack.riposte       evade, contact             a twist away that turns into the kill
 */
import { at, type Sequence } from "../choreography";
import { HERS, HIS, ORIGIN, blow, ground, guard, hitBy, standoff } from "./parts";

const ANYONE = ["p", "n", "b", "r", "q"] as const;

const aerialStrike: Sequence = {
  version: 1, id: "knight.aerial-strike", tier: "standard", weight: 3,
  fits: { attacker: ["n"], defender: ANYONE, style: ["melee"] },
  requires: { attacker: ["attack.leap-strike"] },
  budget: { seconds: 2.6, max: 3.2 },
  markers: { approach: 0, ready: 0.55, clash: 0.95, recoil: 1.05, counter: 1.3, decisive: 1.9, fall: 2.05, settle: 2.25 },
  note: "A: lands beside the defender, the first sweep is stopped, then a second leap straight up and down through the guard.",
  tracks: {
    attacker: [
      { at: at("approach"), do: "move", to: standoff(-0.05, 0.3), duration: 0.55, gait: "leap", arc: 1.1 },
      { at: at("ready", -0.1), do: "clip", clip: { role: "attack", required: true }, sync: { events: ["impact"], to: at("clash") } },
      { at: at("recoil"), do: "pose", pose: "recoil", strength: 0.5, hold: 0.15 },
      { at: at("counter"), do: "move", to: standoff(0, -0.2), duration: 0.5, gait: "leap", arc: 0.7 },
      blow("attack.leap-strike", at("counter", -0.05), at("decisive")),
    ],
    defender: [
      { at: at("approach", 0.1), do: "face", toward: HIS.torso, duration: 0.3 },
      { at: at("approach", 0.2), do: "pose", pose: "brace", strength: 0.9, hold: 0.4, toward: HIS.head },
      guard(at("ready"), at("clash")),
      { at: at("recoil"), do: "move", to: ground(0.08, -0.08), duration: 0.15, gait: "step" },
      { at: at("counter", 0.1), do: "pose", pose: "block", strength: 0.8, hold: 0.4, toward: HIS.weapon },
      { at: at("counter", 0.2), do: "face", toward: HIS.torso, duration: 0.25 },
    ],
    camera: [
      { at: at("approach"), framing: "wide", fov: 2, duration: 0.3 },
      { at: at("ready", -0.1), framing: "duel", fov: -2, duration: 0.25 },
      { at: at("clash"), framing: "contact", fov: -4, duration: 0.1 },
      { at: at("counter"), framing: "attacker", fov: 0, duration: 0.3 },
      { at: at("decisive", -0.15), framing: "contact", fov: -7, duration: 0.15 },
      { at: at("fall", 0.1), framing: "victor", fov: 0, duration: 0.4 },
    ],
    effects: [
      { at: at("ready"), fx: "dust", where: HIS.feet, strength: 1 },
      { at: at("ready"), fx: "shake", where: HIS.feet, strength: 0.06 },
      { at: at("clash"), fx: "sparks", where: HERS.shield, strength: 1 },
      { at: at("decisive"), fx: "slash", where: HERS.torso, strength: 1.2 },
    ],
    audio: [
      { at: at("approach", 0.05), cue: "effort.heavy", from: "attacker" },
      { at: at("ready", -0.2), cue: "whoosh.heavy", from: "attacker" },
      { at: at("ready", 0.02), cue: "brace", from: "defender" },
      { at: at("clash", -0.12), cue: "whoosh.light", from: "attacker" },
      { at: at("clash"), cue: "clash.shield.wood", from: "defender", when: { defenderShield: "wood" } },
      { at: at("clash"), cue: "clash.shield.iron", from: "defender", when: { defenderShield: "iron" } },
      { at: at("clash"), cue: "clash.parry.steel", from: "defender", when: { defenderShield: "none" } },
      { at: at("recoil"), cue: "recoil", from: "defender" },
      { at: at("counter"), cue: "effort.light", from: "attacker" },
      { at: at("decisive", -0.2), cue: "whoosh.heavy", from: "attacker" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.3), cue: "fall.light", from: "defender" },
    ],
  },
  contacts: [
    { at: at("clash"), id: "sweep", from: HIS.weapon, to: HERS.shield, when: { defenderShield: "any" } },
    { at: at("clash"), id: "sweep-parry", from: HIS.weapon, to: HERS.weapon, when: { defenderShield: "none" } },
    { at: at("decisive"), id: "kill", from: HIS.weapon, to: HERS.head },
  ],
  resolution: { power: 1.15, weight: "light", hit: hitBy(["hit.heavy"]), death: { role: "death", prefer: ["death.dramatic"] }, claim: { gait: "step" } },
};

const shieldBreaker: Sequence = {
  version: 1, id: "knight.shield-breaker", tier: "standard", weight: 2,
  fits: { attacker: ["n"], defender: ANYONE, style: ["melee"], defenderShield: true },
  requires: { attacker: ["attack.charge-break"] },
  budget: { seconds: 2.5, max: 3.1 },
  markers: { approach: 0, ready: 0.5, clash: 0.8, recoil: 0.9, counter: 1.15, decisive: 1.75, fall: 1.9, settle: 2.1 },
  note: "B: lands at a run and goes straight through the shield; the defender is turned half round and cut down on the reversal.",
  tracks: {
    attacker: [
      { at: at("approach"), do: "move", to: standoff(-0.5), duration: 0.5, gait: "leap", arc: 0.9 },
      { at: at("ready"), do: "move", to: standoff(0.12), duration: 0.3, gait: "run" },
      blow("attack.charge-break", at("ready", -0.15), at("decisive")),
      { at: at("counter"), do: "move", to: standoff(0.05, 0.3), duration: 0.3, gait: "step" },
      { at: at("counter", 0.25), do: "face", toward: HERS.torso, duration: 0.1 },
    ],
    defender: [
      { at: at("approach", 0.1), do: "face", toward: ORIGIN, duration: 0.3 },
      { at: at("approach", 0.25), do: "pose", pose: "brace", strength: 1, hold: 0.5, toward: HIS.torso },
      guard(at("ready", -0.17), at("clash"), ["defend.block"]),
      { at: at("clash"), do: "pose", pose: "stagger", strength: 1, hold: 0.4 },
      { at: at("clash"), do: "move", to: ground(0.2, -0.12), duration: 0.25, gait: "step" },
      { at: at("counter", 0.1), do: "pose", pose: "recoil", strength: 0.6, hold: 0.3 },
    ],
    camera: [
      { at: at("approach"), framing: "wide", fov: 2, duration: 0.3 },
      { at: at("ready"), framing: "duel", fov: -3, duration: 0.2 },
      { at: at("clash"), framing: "contact", fov: -6, duration: 0.1 },
      { at: at("counter"), framing: "duel", fov: -3, duration: 0.25 },
      { at: at("decisive", -0.15), framing: "contact", fov: -7, duration: 0.15 },
      { at: at("fall", 0.1), framing: "victor", fov: 0, duration: 0.4 },
    ],
    effects: [
      { at: at("ready"), fx: "dust", where: HIS.feet, strength: 0.9 },
      { at: at("clash"), fx: "flash", where: HERS.shield, strength: 1.2 },
      { at: at("clash"), fx: "sparks", where: HERS.shield, strength: 1.4 },
      { at: at("clash"), fx: "shake", where: HERS.shield, strength: 0.12 },
      { at: at("clash"), fx: "hitstop", where: HERS.shield, strength: 0.06 },
      { at: at("decisive"), fx: "slash", where: HERS.torso, strength: 1 },
    ],
    audio: [
      { at: at("approach", 0.05), cue: "effort.heavy", from: "attacker" },
      { at: at("ready", 0.05), cue: "brace", from: "defender" },
      { at: at("clash", -0.15), cue: "whoosh.heavy", from: "attacker" },
      { at: at("clash"), cue: "bash.shield", from: "defender" },
      { at: at("clash", 0.02), cue: "clash.shield.wood", from: "defender", when: { defenderShield: "wood" } },
      { at: at("clash", 0.02), cue: "clash.shield.iron", from: "defender", when: { defenderShield: "iron" } },
      { at: at("recoil", 0.05), cue: "stagger", from: "defender" },
      { at: at("decisive", -0.2), cue: "whoosh.light", from: "attacker" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.3), cue: "fall.light", from: "defender" },
    ],
  },
  contacts: [
    { at: at("clash"), id: "break", from: HIS.weapon, to: HERS.shield },
    { at: at("decisive"), id: "kill", from: HIS.weapon, to: HERS.torso },
  ],
  resolution: { power: 1.25, weight: "light", hit: hitBy(["hit.heavy"]), death: { role: "death", prefer: ["death.backward"] }, claim: { gait: "step" } },
};

const counterattack: Sequence = {
  version: 1, id: "knight.counterattack", tier: "standard", weight: 2,
  fits: { attacker: ["n"], defender: ANYONE, style: ["melee"], defenderArmed: true },
  requires: { attacker: ["attack.riposte"] },
  budget: { seconds: 2.6, max: 3.2 },
  markers: { approach: 0, ready: 0.6, clash: 0.9, recoil: 1, counter: 1.25, decisive: 1.85, fall: 2, settle: 2.2 },
  note: "C: the defender strikes first as the Knight lands. He twists off the line and the same turn brings his blade round.",
  tracks: {
    attacker: [
      { at: at("approach"), do: "move", to: standoff(-0.1), duration: 0.6, gait: "leap", arc: 1 },
      { at: at("clash", -0.1), do: "pose", pose: "block", strength: 0.8, hold: 0.25, toward: HERS.weapon },
      { at: at("recoil"), do: "move", to: standoff(-0.2, -0.1), duration: 0.2, gait: "step" },
      // The defender's swing arrives at `counter`; the riposte clip evades it and kills.
      blow("attack.riposte", at("counter", -0.2), at("decisive")),
      { at: at("counter"), do: "move", to: standoff(0, 0.35), duration: 0.35, gait: "step" },
      { at: at("counter", 0.3), do: "face", toward: HERS.torso, duration: 0.1 },
    ],
    defender: [
      { at: at("approach", 0.1), do: "face", toward: ORIGIN, duration: 0.3 },
      { at: at("ready", -0.2), do: "clip", clip: { role: "attack", fallbacks: [{ pose: "block", strength: 1 }] }, sync: { events: ["impact", "contact"], to: at("clash") } },
      { at: at("recoil"), do: "pose", pose: "recoil", strength: 0.4, hold: 0.15 },
      { at: at("counter", -0.45), do: "clip", clip: { role: "attack", fallbacks: [{ pose: "brace", strength: 1 }] }, sync: { events: ["impact", "contact"], to: at("counter", 0.1) } },
      { at: at("counter", 0.2), do: "pose", pose: "stagger", strength: 0.5, hold: 0.3 },
    ],
    camera: [
      { at: at("approach"), framing: "wide", fov: 2, duration: 0.3 },
      { at: at("ready"), framing: "defender", fov: -2, duration: 0.2 },
      { at: at("clash"), framing: "contact", fov: -4, duration: 0.1 },
      { at: at("counter"), framing: "duel", fov: -3, duration: 0.25 },
      { at: at("decisive", -0.15), framing: "contact", fov: -7, duration: 0.15 },
      { at: at("fall", 0.1), framing: "victor", fov: 0, duration: 0.4 },
    ],
    effects: [
      { at: at("ready"), fx: "dust", where: HIS.feet, strength: 1 },
      { at: at("clash"), fx: "sparks", where: HIS.weapon, strength: 1 },
      { at: at("counter", 0.1), fx: "dust", where: HIS.feet, strength: 0.6, when: { detail: true } },
      { at: at("decisive"), fx: "slash", where: HERS.torso, strength: 1.1 },
    ],
    audio: [
      { at: at("approach", 0.05), cue: "effort.heavy", from: "attacker" },
      { at: at("clash", -0.15), cue: "whoosh.light", from: "defender" },
      { at: at("clash"), cue: "clash.parry.steel", from: "attacker" },
      { at: at("recoil"), cue: "recoil", from: "attacker" },
      { at: at("counter", -0.05), cue: "whoosh.heavy", from: "defender" },
      { at: at("counter", 0.05), cue: "effort.light", from: "attacker" },
      { at: at("decisive", -0.2), cue: "whoosh.light", from: "attacker" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.3), cue: "fall.light", from: "defender" },
    ],
  },
  contacts: [
    { at: at("clash"), id: "parried", from: HERS.weapon, to: HIS.weapon },
    { at: at("decisive"), id: "kill", from: HIS.weapon, to: HERS.torso },
  ],
  resolution: { power: 1.1, weight: "light", hit: hitBy(["hit.medium"]), death: { role: "death", prefer: ["death.front"] }, claim: { gait: "step" } },
};

export const KNIGHT_SEQUENCES: readonly Sequence[] = [aerialStrike, shieldBreaker, counterattack];

/**
 * Rook: an unstoppable guardian. Heavy steps, braced stances, shield impacts
 * and hammer blows; the defender may stop the first and is overwhelmed by the
 * second.
 *
 * Clip contract (not yet authored; without it the director falls back):
 *   attack.hammer-double  clash, contact   two overhead blows, the second from higher
 *   attack.shield-drive   clash, contact   a walking shield slam, then a short hammer
 */
import { at, type Sequence } from "../choreography";
import { HERS, HIS, ORIGIN, blow, ground, guard, hitBy, standoff } from "./parts";

const ANYONE = ["p", "n", "b", "r", "q"] as const;

const hammerOverwhelm: Sequence = {
  version: 1, id: "rook.hammer-overwhelm", tier: "standard", weight: 3,
  fits: { attacker: ["r"], defender: ANYONE, style: ["melee"] },
  requires: { attacker: ["attack.hammer-double"] },
  budget: { seconds: 3, max: 3.6 },
  markers: { approach: 0, ready: 0.7, clash: 1.2, recoil: 1.35, counter: 1.6, decisive: 2.25, fall: 2.4, settle: 2.65 },
  note: "It does not hurry. The first blow is stopped and drives the defender down; the second goes through the guard.",
  tracks: {
    attacker: [
      { at: at("approach"), do: "move", to: standoff(), duration: 0.7, gait: "walk" },
      { at: at("ready"), do: "pose", pose: "brace", strength: 1, hold: 0.3 },
      blow("attack.hammer-double", at("ready", -0.05), at("decisive")),
      { at: at("counter"), do: "move", to: standoff(0.1), duration: 0.4, gait: "walk" },
    ],
    defender: [
      { at: at("approach", 0.1), do: "face", toward: ORIGIN, duration: 0.4 },
      { at: at("approach", 0.3), do: "pose", pose: "brace", strength: 1, hold: 0.6, toward: HIS.weapon },
      guard(at("ready", 0.03), at("clash")),
      { at: at("clash"), do: "pose", pose: "block", strength: 1, hold: 0.25, toward: HIS.weapon, drive: "ik" },
      { at: at("recoil"), do: "pose", pose: "stagger", strength: 0.8, hold: 0.4 },
      { at: at("recoil"), do: "move", to: ground(0.15), duration: 0.25, gait: "step" },
      // The counter is all it has left: the guard comes up again, lower.
      { at: at("counter", 0.15), do: "pose", pose: "block", strength: 0.6, hold: 0.45, toward: HIS.weapon },
    ],
    camera: [
      { at: at("approach"), framing: "attacker", fov: 0, duration: 0.6 },
      { at: at("ready"), framing: "duel", fov: -2, duration: 0.3 },
      { at: at("clash"), framing: "contact", fov: -5, duration: 0.1 },
      { at: at("recoil", 0.1), framing: "defender", fov: -3, duration: 0.3 },
      { at: at("decisive", -0.2), framing: "contact", fov: -8, duration: 0.2 },
      { at: at("fall", 0.1), framing: "victor", fov: 0, duration: 0.5 },
    ],
    effects: [
      { at: at("approach", 0.3), fx: "shake", where: HIS.feet, strength: 0.03 },
      { at: at("approach", 0.6), fx: "shake", where: HIS.feet, strength: 0.04 },
      { at: at("clash"), fx: "sparks", where: HERS.shield, strength: 1.3 },
      { at: at("clash"), fx: "shake", where: HERS.shield, strength: 0.14 },
      { at: at("clash"), fx: "hitstop", where: HERS.shield, strength: 0.08 },
      { at: at("recoil"), fx: "ring", where: HERS.feet, strength: 0.7 },
      { at: at("decisive"), fx: "ring", where: HERS.feet, strength: 1.4 },
    ],
    audio: [
      { at: at("ready"), cue: "brace", from: "attacker" },
      { at: at("ready", 0.1), cue: "brace", volume: 0.8, from: "defender" },
      { at: at("clash", -0.25), cue: "effort.heavy", from: "attacker" },
      { at: at("clash", -0.18), cue: "whoosh.heavy", from: "attacker" },
      { at: at("clash"), cue: "clash.shield.wood", from: "defender", when: { defenderShield: "wood" } },
      { at: at("clash"), cue: "clash.shield.iron", from: "defender", when: { defenderShield: "iron" } },
      { at: at("clash"), cue: "clash.parry.steel", from: "defender", when: { defenderShield: "none" } },
      { at: at("recoil", 0.05), cue: "stagger", from: "defender" },
      { at: at("decisive", -0.22), cue: "whoosh.heavy", from: "attacker" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.3), cue: "fall.heavy", from: "defender" },
    ],
  },
  contacts: [
    { at: at("clash"), id: "first", from: HIS.weapon, to: HERS.shield, when: { defenderShield: "any" } },
    { at: at("clash"), id: "first-parry", from: HIS.weapon, to: HERS.weapon, when: { defenderShield: "none" } },
    { at: at("decisive"), id: "kill", from: HIS.weapon, to: HERS.head },
  ],
  resolution: { power: 1.5, weight: "heavy", hit: hitBy(["hit.heavy"]), death: { role: "death", prefer: ["death.front"] }, claim: { gait: "walk" } },
};

const shieldDrive: Sequence = {
  version: 1, id: "rook.shield-drive", tier: "standard", weight: 2,
  fits: { attacker: ["r"], defender: ANYONE, style: ["melee"], attackerShield: true },
  requires: { attacker: ["attack.shield-drive"] },
  budget: { seconds: 2.9, max: 3.5 },
  markers: { approach: 0, ready: 0.6, clash: 1, recoil: 1.1, counter: 1.4, decisive: 2.15, fall: 2.3, settle: 2.55 },
  note: "Walks its shield into the defender and keeps walking. The hammer comes only once the defender is off its feet.",
  tracks: {
    attacker: [
      { at: at("approach"), do: "move", to: standoff(-0.25), duration: 0.6, gait: "walk" },
      blow("attack.shield-drive", at("ready"), at("decisive")),
      { at: at("ready", 0.1), do: "move", to: standoff(0.15), duration: 0.35, gait: "walk" },
      { at: at("counter"), do: "move", to: standoff(0.3), duration: 0.5, gait: "walk" },
    ],
    defender: [
      { at: at("approach", 0.1), do: "face", toward: ORIGIN, duration: 0.4 },
      { at: at("ready", -0.2), do: "pose", pose: "brace", strength: 1, hold: 0.6, toward: HIS.shield },
      guard(at("ready", 0.05), at("clash"), ["defend.block"]),
      { at: at("clash"), do: "move", to: ground(0.2), duration: 0.3, gait: "step" },
      { at: at("recoil"), do: "pose", pose: "stagger", strength: 1, hold: 0.5 },
      // Shoves back with everything, and moves nothing.
      { at: at("counter"), do: "pose", pose: "block", strength: 1, hold: 0.4, toward: HIS.shield },
      { at: at("counter", 0.1), do: "move", to: ground(0.34), duration: 0.45, gait: "step" },
    ],
    camera: [
      { at: at("approach"), framing: "attacker", fov: 0, duration: 0.5 },
      { at: at("clash", -0.1), framing: "duel", fov: -3, duration: 0.2 },
      { at: at("clash"), framing: "contact", fov: -5, duration: 0.1 },
      { at: at("counter"), framing: "defender", fov: -3, duration: 0.35 },
      { at: at("decisive", -0.2), framing: "contact", fov: -8, duration: 0.2 },
      { at: at("fall", 0.1), framing: "victor", fov: 0, duration: 0.5 },
    ],
    effects: [
      { at: at("clash"), fx: "flash", where: HERS.shield, strength: 0.9 },
      { at: at("clash"), fx: "shake", where: HERS.shield, strength: 0.12 },
      { at: at("counter", 0.2), fx: "dust", where: HERS.feet, strength: 1 },
      { at: at("decisive"), fx: "ring", where: HERS.feet, strength: 1.3 },
    ],
    audio: [
      { at: at("ready"), cue: "brace", from: "defender" },
      { at: at("clash", -0.2), cue: "effort.heavy", from: "attacker" },
      { at: at("clash", -0.14), cue: "whoosh.heavy", from: "attacker" },
      { at: at("clash"), cue: "bash.shield", from: "defender" },
      { at: at("recoil", 0.05), cue: "stagger", from: "defender" },
      { at: at("counter"), cue: "effort.light", from: "defender" },
      { at: at("counter", 0.3), cue: "recoil", from: "defender" },
      { at: at("decisive", -0.22), cue: "whoosh.heavy", from: "attacker" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.3), cue: "fall.heavy", from: "defender" },
    ],
  },
  contacts: [
    { at: at("clash"), id: "drive", from: HIS.shield, to: HERS.shield, when: { defenderShield: "any" } },
    { at: at("clash"), id: "drive-body", from: HIS.shield, to: HERS.torso, when: { defenderShield: "none" } },
    { at: at("decisive"), id: "kill", from: HIS.weapon, to: HERS.torso },
  ],
  resolution: { power: 1.4, weight: "heavy", hit: hitBy(["hit.heavy"]), death: { role: "death", prefer: ["death.backward"] }, claim: { gait: "walk" } },
};

export const ROOK_SEQUENCES: readonly Sequence[] = [hammerOverwhelm, shieldDrive];

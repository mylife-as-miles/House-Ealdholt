/**
 * King: never captured. Here he is only ever the attacker.
 *
 * Checkmate is not a combat sequence. The engine's playEndCinematic hands it
 * to CheckmatePresentation, and the mated king's pose comes from the
 * "checkmate" board reaction; nothing in this catalog may name a king as a
 * defender (the validator refuses it).
 *
 * `king.command` is the king taking a piece himself and waits for one clip:
 *   attack.command   contact   a short, contemptuous cut from a guarded stance
 */
import { at, type Sequence } from "../choreography";
import { HERS, HIS, ORIGIN, blow, ground, guard, hitBy, standoff } from "./parts";

const ANYONE = ["p", "n", "b", "r", "q"] as const;

const command: Sequence = {
  version: 1, id: "king.command", tier: "standard", weight: 1,
  fits: { attacker: ["k"], defender: ANYONE, style: ["melee"] },
  requires: { attacker: ["attack.command"] },
  budget: { seconds: 2.5, max: 3.1 },
  markers: { approach: 0, ready: 0.6, clash: 0.95, recoil: 1.05, counter: 1.25, decisive: 1.8, fall: 1.95, settle: 2.15 },
  note: "He walks. The defender strikes first and is turned aside without the king breaking stride.",
  tracks: {
    attacker: [
      { at: at("approach"), do: "move", to: standoff(-0.1), duration: 0.6, gait: "walk" },
      { at: at("clash", -0.15), do: "pose", pose: "block", strength: 1, hold: 0.3, toward: HERS.weapon, drive: "ik" },
      { at: at("counter"), do: "move", to: standoff(0.05), duration: 0.3, gait: "walk" },
      blow("attack.command", at("counter"), at("decisive")),
    ],
    defender: [
      { at: at("approach", 0.1), do: "face", toward: ORIGIN, duration: 0.3 },
      { at: at("ready", -0.2), do: "clip", clip: { role: "attack", fallbacks: [{ pose: "brace", strength: 1 }] }, sync: { events: ["impact", "contact"], to: at("clash") } },
      { at: at("recoil"), do: "pose", pose: "recoil", strength: 0.8, hold: 0.25 },
      { at: at("recoil"), do: "move", to: ground(0.12), duration: 0.2, gait: "step" },
      guard(at("counter", 0.05), at("decisive", -0.05)),
    ],
    camera: [
      { at: at("approach"), framing: "attacker", fov: 0, duration: 0.5 },
      { at: at("clash"), framing: "contact", fov: -4, duration: 0.1 },
      { at: at("counter"), framing: "duel", fov: -2, duration: 0.3 },
      { at: at("decisive", -0.15), framing: "contact", fov: -6, duration: 0.15 },
      { at: at("fall", 0.1), framing: "victor", fov: 0, duration: 0.5 },
    ],
    effects: [
      { at: at("clash"), fx: "sparks", where: HIS.weapon, strength: 1 },
      { at: at("decisive"), fx: "slash", where: HERS.torso, strength: 1 },
    ],
    audio: [
      { at: at("clash", -0.15), cue: "whoosh.light", from: "defender" },
      { at: at("clash"), cue: "clash.parry.steel", from: "attacker" },
      { at: at("recoil"), cue: "recoil", from: "defender" },
      { at: at("decisive", -0.2), cue: "whoosh.heavy", from: "attacker" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.3), cue: "fall.light", from: "defender" },
    ],
  },
  contacts: [
    { at: at("clash"), id: "turned", from: HERS.weapon, to: HIS.weapon },
    { at: at("decisive"), id: "kill", from: HIS.weapon, to: HERS.torso },
  ],
  resolution: { power: 1.2, weight: "light", hit: hitBy(["hit.medium"]), death: { role: "death", prefer: ["death.front"] }, claim: { gait: "walk" } },
};

export const KING_SEQUENCES: readonly Sequence[] = [command];

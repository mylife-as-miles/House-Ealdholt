/**
 * Named characters. A signature outranks the class catalog for that character
 * only (`fits.identity`), and changes no rule: the same markers, the same
 * resolution, the same fallbacks.
 */
import { at, type Sequence } from "../choreography";
import { HERS, HIS, ORIGIN, blow, guard, hitBy, standoff } from "./parts";

/** Cael: lowland-trained. He lets the first blow come and answers inside it.
 * Waits for one authored clip, `attack.cael-riposte` (events: evade, contact). */
const caelRiposte: Sequence = {
  version: 1, id: "cael.lowland-riposte", tier: "signature", weight: 1,
  fits: { attacker: ["p", "n", "r", "k"], defender: ["p", "n", "b", "r", "q"], identity: ["cael"], style: ["melee"], defenderArmed: true },
  requires: { attacker: ["attack.cael-riposte"] },
  budget: { seconds: 2.4, max: 3 },
  markers: { approach: 0, ready: 0.5, clash: 0.9, recoil: 1, counter: 1.15, decisive: 1.7, fall: 1.85, settle: 2.05 },
  tracks: {
    attacker: [
      { at: at("approach"), do: "move", to: standoff(-0.15), duration: 0.5, gait: "walk" },
      { at: at("clash", -0.15), do: "pose", pose: "block", strength: 0.9, hold: 0.25, toward: HERS.weapon, drive: "ik" },
      blow("attack.cael-riposte", at("recoil"), at("decisive")),
      { at: at("counter"), do: "move", to: standoff(0.05, 0.25), duration: 0.3, gait: "step" },
    ],
    defender: [
      { at: at("approach", 0.1), do: "face", toward: ORIGIN, duration: 0.3 },
      { at: at("ready", -0.1), do: "clip", clip: { role: "attack", fallbacks: [{ pose: "brace", strength: 1 }] }, sync: { events: ["impact", "contact"], to: at("clash") } },
      { at: at("recoil"), do: "pose", pose: "recoil", strength: 0.5, hold: 0.2 },
      guard(at("counter", 0.05), at("decisive", -0.03)),
    ],
    camera: [
      { at: at("approach"), framing: "attacker", fov: -1, duration: 0.4 },
      { at: at("clash"), framing: "contact", fov: -4, duration: 0.1 },
      { at: at("decisive", -0.15), framing: "contact", fov: -7, duration: 0.15 },
      { at: at("fall", 0.1), framing: "victor", fov: -1, duration: 0.4 },
    ],
    effects: [
      { at: at("clash"), fx: "sparks", where: HIS.weapon, strength: 1 },
      { at: at("decisive"), fx: "slash", where: HERS.torso, strength: 1.1 },
    ],
    audio: [
      { at: at("clash", -0.15), cue: "whoosh.light", from: "defender" },
      { at: at("clash"), cue: "clash.parry.steel", from: "attacker" },
      { at: at("counter"), cue: "effort.light", from: "attacker" },
      { at: at("decisive", -0.18), cue: "whoosh.light", from: "attacker" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.3), cue: "fall.light", from: "defender" },
    ],
  },
  contacts: [
    { at: at("clash"), id: "taken", from: HERS.weapon, to: HIS.weapon },
    { at: at("decisive"), id: "kill", from: HIS.weapon, to: HERS.torso },
  ],
  resolution: { power: 1.1, weight: "light", hit: hitBy(["hit.medium"]), death: { role: "death", prefer: ["death.front"] }, claim: { gait: "walk" } },
};

export const NAMED_SEQUENCES: readonly Sequence[] = [caelRiposte];

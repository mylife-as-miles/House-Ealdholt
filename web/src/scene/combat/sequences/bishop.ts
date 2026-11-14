/**
 * Bishop: a tactical caster who kills from where it stands. The defender may
 * shield, evade the first projectile, or resist before the final impact.
 *
 * Needs a stage that can fly a projectile between two anchors (`projectile`;
 * the adapter should build it on spells.ts) and one authored clip:
 *   cast.bolt-double   release, cast_release   two casts, the second the larger
 * Until both exist the director falls back to today's playSpellCinematic.
 */
import { at, type Sequence } from "../choreography";
import { HERS, HIS, ORIGIN, ground, guard, hitBy } from "./parts";

const ANYONE = ["p", "n", "b", "r", "q"] as const;
const cast = (from: ReturnType<typeof at>, on: ReturnType<typeof at>) =>
  ({ at: from, do: "clip", clip: { role: "attack", prefer: ["cast.bolt-double"], required: true }, sync: { events: ["cast_release", "impact"], to: on } }) as const;

const evadedBolt: Sequence = {
  version: 1, id: "bishop.evaded-bolt", tier: "standard", weight: 3,
  fits: { attacker: ["b"], defender: ANYONE, style: ["spell"] },
  requires: { attacker: ["cast.bolt-double"], stage: ["projectile"] },
  budget: { seconds: 3, max: 3.6 },
  markers: { approach: 0, ready: 0.5, clash: 0.85, recoil: 0.95, counter: 1.2, decisive: 1.9, fall: 2.05, settle: 2.4 },
  note: "The first bolt is dodged and bursts on the stone behind. The defender starts forward; the second is already in the air.",
  tracks: {
    attacker: [
      { at: at("approach"), do: "face", toward: HERS.torso, duration: 0.25 },
      // Released 0.3 s before it lands.
      cast(at("approach", 0.1), at("decisive", -0.3)),
    ],
    defender: [
      { at: at("approach", 0.1), do: "face", toward: ORIGIN, duration: 0.3 },
      { at: at("ready", -0.15), do: "pose", pose: "brace", strength: 0.8, hold: 0.4, toward: HIS.weapon },
      { at: at("ready", 0.05), do: "clip", clip: { role: "block", prefer: ["defend.evade"], fallbacks: [{ pose: "recoil", strength: 0.9 }] }, sync: { events: ["evade", "guard"], to: at("clash") } },
      { at: at("clash", -0.12), do: "move", to: ground(0, 0.3), duration: 0.22, gait: "step" },
      { at: at("counter"), do: "move", to: ground(-0.25, 0.15), duration: 0.45, gait: "run" },
      { at: at("counter", 0.4), do: "pose", pose: "block", strength: 0.7, hold: 0.3, toward: HIS.weapon },
    ],
    camera: [
      { at: at("approach"), framing: "attacker", fov: 0, duration: 0.4 },
      { at: at("ready"), framing: "wide", fov: 1, duration: 0.3 },
      { at: at("clash", -0.1), framing: "defender", fov: -3, duration: 0.2 },
      { at: at("counter", 0.3), framing: "duel", fov: -2, duration: 0.3 },
      { at: at("decisive", -0.15), framing: "contact", fov: -7, duration: 0.15 },
      { at: at("fall", 0.1), framing: "victor", fov: 0, duration: 0.5 },
    ],
    effects: [
      { at: at("ready"), fx: "projectile", where: HIS.weapon, target: { point: ground(0.6) }, duration: 0.35, strength: 0.8 },
      { at: at("clash"), fx: "flash", where: { point: ground(0.6) }, strength: 0.7 },
      { at: at("clash"), fx: "dust", where: HERS.feet, strength: 0.6 },
      { at: at("decisive", -0.3), fx: "projectile", where: HIS.weapon, target: HERS.torso, duration: 0.3, strength: 1.3 },
      { at: at("decisive"), fx: "ring", where: HERS.feet, strength: 1 },
    ],
    audio: [
      { at: at("ready", -0.1), cue: "effort.light", from: "attacker" },
      { at: at("ready"), cue: "whoosh.light", from: "attacker" },
      { at: at("clash"), cue: "recoil", from: "defender" },
      { at: at("counter"), cue: "effort.light", from: "defender" },
      { at: at("decisive", -0.3), cue: "whoosh.heavy", from: "attacker" },
      { at: at("decisive", -0.12), cue: "brace", from: "defender" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.3), cue: "fall.light", from: "defender" },
    ],
  },
  resolution: { power: 1.1, weight: "light", hit: hitBy(["hit.heavy"]), death: { role: "death", prefer: ["death.backward"] }, claim: { gait: "walk" } },
};

const shieldResist: Sequence = {
  version: 1, id: "bishop.shield-resist", tier: "standard", weight: 2,
  fits: { attacker: ["b"], defender: ANYONE, style: ["spell"], defenderShield: true },
  requires: { attacker: ["cast.bolt-double"], stage: ["projectile"] },
  budget: { seconds: 3, max: 3.6 },
  markers: { approach: 0, ready: 0.5, clash: 0.85, recoil: 0.95, counter: 1.15, decisive: 1.95, fall: 2.1, settle: 2.45 },
  note: "The shield takes the first bolt and holds. The defender leans into the second, is pushed back a hand at a time, and the shield gives.",
  tracks: {
    attacker: [
      { at: at("approach"), do: "face", toward: HERS.torso, duration: 0.25 },
      cast(at("approach", 0.1), at("counter", 0.15)),
    ],
    defender: [
      { at: at("approach", 0.1), do: "face", toward: ORIGIN, duration: 0.3 },
      guard(at("ready", -0.12), at("clash"), ["defend.block"]),
      { at: at("clash"), do: "pose", pose: "block", strength: 1, hold: 0.25, toward: HIS.weapon, drive: "ik" },
      { at: at("recoil"), do: "move", to: ground(0.08), duration: 0.15, gait: "step" },
      // Resisting: the shield stays up while the feet lose ground.
      { at: at("counter", 0.15), do: "pose", pose: "block", strength: 1, hold: 0.65, toward: HIS.weapon, drive: "ik" },
      { at: at("counter", 0.2), do: "move", to: ground(0.3), duration: 0.55, gait: "step" },
      { at: at("decisive", -0.1), do: "pose", pose: "stagger", strength: 0.8, hold: 0.1 },
    ],
    camera: [
      { at: at("approach"), framing: "attacker", fov: 0, duration: 0.4 },
      { at: at("clash", -0.1), framing: "defender", fov: -3, duration: 0.2 },
      { at: at("counter", 0.15), framing: "contact", fov: -5, duration: 0.6 },
      { at: at("decisive", -0.1), framing: "contact", fov: -8, duration: 0.1 },
      { at: at("fall", 0.1), framing: "victor", fov: 0, duration: 0.5 },
    ],
    effects: [
      { at: at("ready"), fx: "projectile", where: HIS.weapon, target: HERS.shield, duration: 0.35, strength: 0.8 },
      { at: at("clash"), fx: "sparks", where: HERS.shield, strength: 1.2 },
      { at: at("clash"), fx: "shake", where: HERS.shield, strength: 0.06 },
      { at: at("counter", 0.15), fx: "projectile", where: HIS.weapon, target: HERS.shield, duration: 0.65, strength: 1.4 },
      { at: at("counter", 0.4), fx: "sparks", where: HERS.shield, strength: 0.8, when: { detail: true } },
      { at: at("decisive"), fx: "flash", where: HERS.shield, strength: 1.5 },
      { at: at("decisive"), fx: "ring", where: HERS.feet, strength: 1.1 },
    ],
    audio: [
      { at: at("ready"), cue: "whoosh.light", from: "attacker" },
      { at: at("clash", -0.1), cue: "brace", from: "defender" },
      { at: at("clash"), cue: "clash.shield.wood", from: "defender", when: { defenderShield: "wood" } },
      { at: at("clash"), cue: "clash.shield.iron", from: "defender", when: { defenderShield: "iron" } },
      { at: at("recoil"), cue: "recoil", from: "defender" },
      { at: at("counter", 0.15), cue: "whoosh.heavy", from: "attacker" },
      { at: at("counter", 0.3), cue: "effort.heavy", from: "defender" },
      { at: at("decisive", -0.1), cue: "stagger", from: "defender" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.3), cue: "fall.light", from: "defender" },
    ],
  },
  resolution: { power: 1.2, weight: "light", hit: hitBy(["hit.heavy"]), death: { role: "death", prefer: ["death.backward"] }, claim: { gait: "walk" } },
};

export const BISHOP_SEQUENCES: readonly Sequence[] = [evadedBolt, shieldResist];

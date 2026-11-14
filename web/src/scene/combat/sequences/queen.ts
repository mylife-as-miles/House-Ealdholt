/**
 * Queen: a terrifying powerhouse. Restraints, several projectiles, spectacular
 * finishers, and never painfully long: nothing here runs past 3.6 s except a
 * kingdom rite.
 *
 * Stage abilities: `restraint`, `projectile`; the rite needs `rite`.
 * Clip contract (not yet authored; without it the director falls back):
 *   cast.bind-volley   bind, cast_release   a binding gesture, three flicks, a closing fist
 *   cast.sunder        cast_release         one slow raised hand
 *
 * Kingdom rites plug in exactly like `queen.wyvern-run` below: a catalog entry
 * limited to a kingdom, whose effects track hands the spectacle to a rite by
 * id while this timeline keeps the markers, the kill and the claim.
 */
import { at, type Sequence } from "../choreography";
import { HERS, HIS, ORIGIN, ground, hitBy } from "./parts";

const ANYONE = ["p", "n", "b", "r", "q"] as const;

const bindVolley: Sequence = {
  version: 1, id: "queen.bind-volley", tier: "standard", weight: 3,
  fits: { attacker: ["q"], defender: ANYONE, style: ["spell"] },
  requires: { attacker: ["cast.bind-volley"], stage: ["restraint", "projectile"] },
  budget: { seconds: 3.1, max: 3.6 },
  markers: { approach: 0, ready: 0.45, clash: 0.9, recoil: 1, counter: 1.25, decisive: 2, fall: 2.2, settle: 2.5 },
  note: "Bound where it stands. Two bolts are taken on the guard while it strains at the bonds; the third is the finisher.",
  tracks: {
    attacker: [
      { at: at("approach"), do: "face", toward: HERS.torso, duration: 0.2 },
      { at: at("approach", 0.05), do: "clip", clip: { role: "attack", prefer: ["cast.bind-volley"], required: true }, sync: { events: ["cast_release", "impact"], to: at("decisive", -0.25) } },
    ],
    defender: [
      { at: at("approach", 0.1), do: "face", toward: ORIGIN, duration: 0.3 },
      { at: at("ready"), do: "pose", pose: "stagger", strength: 0.6, hold: 0.3 },
      { at: at("clash", -0.2), do: "pose", pose: "block", strength: 1, hold: 0.35, toward: HIS.weapon },
      { at: at("recoil"), do: "pose", pose: "recoil", strength: 0.7, hold: 0.2 },
      // Strains forward against the bonds, and is knocked back into them.
      { at: at("counter"), do: "move", to: ground(-0.12), duration: 0.3, gait: "step" },
      { at: at("counter", 0.05), do: "pose", pose: "brace", strength: 1, hold: 0.3, toward: HIS.weapon },
      { at: at("counter", 0.35), do: "pose", pose: "stagger", strength: 0.9, hold: 0.3 },
      { at: at("counter", 0.35), do: "move", to: ground(0.05), duration: 0.2, gait: "step" },
    ],
    camera: [
      { at: at("approach"), framing: "attacker", fov: -1, duration: 0.35 },
      { at: at("ready"), framing: "defender", fov: -3, duration: 0.3 },
      { at: at("clash"), framing: "contact", fov: -4, duration: 0.1 },
      { at: at("counter"), framing: "duel", fov: -2, duration: 0.3 },
      { at: at("decisive", -0.25), framing: "contact", fov: -9, duration: 0.25 },
      { at: at("fall", 0.1), framing: "victor", fov: 0, duration: 0.5 },
    ],
    effects: [
      { at: at("ready"), fx: "restraint", where: HERS.feet, duration: 1.55, strength: 1 },
      { at: at("clash", -0.3), fx: "projectile", where: HIS.weapon, target: HERS.shield, duration: 0.3, strength: 0.7 },
      { at: at("clash"), fx: "sparks", where: HERS.shield, strength: 1 },
      { at: at("counter", 0.05), fx: "projectile", where: HIS.weapon, target: HERS.shield, duration: 0.3, strength: 0.8 },
      { at: at("counter", 0.35), fx: "flash", where: HERS.shield, strength: 0.9 },
      { at: at("decisive", -0.25), fx: "projectile", where: HIS.weapon, target: HERS.torso, duration: 0.25, strength: 1.6 },
      { at: at("decisive"), fx: "ring", where: HERS.feet, strength: 1.5 },
      { at: at("decisive"), fx: "shake", where: HERS.torso, strength: 0.14 },
    ],
    audio: [
      { at: at("ready"), cue: "stagger", from: "defender" },
      { at: at("clash", -0.3), cue: "whoosh.light", from: "attacker" },
      { at: at("clash", -0.15), cue: "brace", from: "defender" },
      { at: at("clash"), cue: "clash.shield.wood", from: "defender", when: { defenderShield: "wood" } },
      { at: at("clash"), cue: "clash.shield.iron", from: "defender", when: { defenderShield: "iron" } },
      { at: at("clash"), cue: "clash.parry.steel", from: "defender", when: { defenderShield: "none" } },
      { at: at("counter"), cue: "effort.heavy", from: "defender" },
      { at: at("counter", 0.05), cue: "whoosh.light", from: "attacker" },
      { at: at("counter", 0.35), cue: "recoil", from: "defender" },
      { at: at("decisive", -0.25), cue: "whoosh.heavy", from: "attacker" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.3), cue: "fall.light", from: "defender" },
    ],
  },
  resolution: { power: 1.6, weight: "light", hit: hitBy(["hit.heavy"]), death: { role: "death", prefer: ["death.dramatic"] }, claim: { gait: "walk" } },
};

const sunder: Sequence = {
  version: 1, id: "queen.sunder", tier: "standard", weight: 2,
  fits: { attacker: ["q"], defender: ANYONE, style: ["spell"] },
  requires: { attacker: ["cast.sunder"], stage: ["projectile"] },
  budget: { seconds: 2.7, max: 3.3 },
  markers: { approach: 0, ready: 0.5, clash: 0.9, recoil: 1, counter: 1.15, decisive: 1.7, fall: 1.9, settle: 2.15 },
  note: "She does not bother to bind it. It guards, finds nothing coming, starts forward, and she raises one hand.",
  tracks: {
    attacker: [
      { at: at("approach"), do: "face", toward: HERS.torso, duration: 0.3 },
      { at: at("counter", -0.2), do: "clip", clip: { role: "attack", prefer: ["cast.sunder"], required: true }, sync: { events: ["cast_release", "impact"], to: at("decisive", -0.12) } },
    ],
    defender: [
      { at: at("approach", 0.1), do: "face", toward: ORIGIN, duration: 0.3 },
      { at: at("ready"), do: "pose", pose: "brace", strength: 1, hold: 0.45, toward: HIS.weapon },
      { at: at("clash"), do: "pose", pose: "block", strength: 0.8, hold: 0.2, toward: HIS.weapon },
      { at: at("counter"), do: "move", to: ground(-0.3), duration: 0.4, gait: "run" },
      { at: at("decisive", -0.12), do: "pose", pose: "recoil", strength: 0.6, hold: 0.12 },
    ],
    camera: [
      { at: at("approach"), framing: "attacker", fov: -1, duration: 0.4 },
      { at: at("ready"), framing: "defender", fov: -2, duration: 0.3 },
      { at: at("counter"), framing: "duel", fov: -2, duration: 0.3 },
      { at: at("decisive", -0.15), framing: "contact", fov: -9, duration: 0.15 },
      { at: at("fall", 0.1), framing: "victor", fov: 0, duration: 0.5 },
    ],
    effects: [
      { at: at("decisive", -0.12), fx: "projectile", where: HIS.weapon, target: HERS.torso, duration: 0.12, strength: 2 },
      { at: at("decisive"), fx: "flash", where: HERS.torso, strength: 1.8 },
      { at: at("decisive"), fx: "ring", where: HERS.feet, strength: 1.6 },
      { at: at("decisive"), fx: "shake", where: HERS.torso, strength: 0.16 },
    ],
    audio: [
      { at: at("ready"), cue: "brace", from: "defender" },
      { at: at("counter"), cue: "effort.light", from: "defender" },
      { at: at("decisive", -0.15), cue: "whoosh.heavy", from: "attacker" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.3), cue: "fall.light", from: "defender" },
    ],
  },
  resolution: { power: 1.7, weight: "light", hit: hitBy(["hit.heavy"]), death: { role: "death", prefer: ["death.backward"] }, claim: { gait: "walk" } },
};

/** Aethelgard's bonded beast. Timed on WYVERN_TIMING of rites/wyvern-path.ts:
 * dive at 1.5 s, strike at 2.3 s, release at 3.5 s, gone at 4.8 s. */
const wyvernRun: Sequence = {
  version: 1, id: "queen.wyvern-run", tier: "rite", weight: 1,
  fits: { attacker: ["q"], defender: ANYONE, attackerKingdom: ["ivory"], minDistance: 2 },
  requires: { stage: ["rite"] },
  budget: { seconds: 4.8, max: 5.6 },
  markers: { approach: 0, ready: 1.2, clash: 1.5, recoil: 1.9, counter: 2, decisive: 2.3, fall: 3.5, settle: 3.9 },
  note: "The queen only commands. The wyvern rite owns the beast, its sounds and the carry; this timeline keeps the kill and the claim.",
  tracks: {
    attacker: [
      { at: at("approach"), do: "face", toward: HERS.torso, duration: 0.3 },
      { at: at("approach", 0.6), do: "clip", clip: { role: "attack" }, sync: { events: ["cast_release", "impact"], to: at("ready") } },
    ],
    defender: [
      { at: at("ready"), do: "pose", pose: "brace", strength: 0.6, hold: 0.4 },
      { at: at("clash", 0.1), do: "pose", pose: "block", strength: 1, hold: 0.6, toward: { point: ground(-0.4) } },
      { at: at("counter"), do: "pose", pose: "recoil", strength: 1, hold: 0.3 },
    ],
    camera: [
      { at: at("approach"), framing: "attacker", fov: -1, duration: 0.5 },
      { at: at("ready"), framing: "wide", fov: 4, duration: 0.5 },
      { at: at("counter"), framing: "defender", fov: -2, duration: 0.3 },
      { at: at("fall", -0.3), framing: "wide", fov: 2, duration: 0.5 },
      { at: at("settle"), framing: "victor", fov: 0, duration: 0.6 },
    ],
    effects: [
      { at: at("approach"), fx: "rite", id: "aethelgard.queen.wyvern-run", where: HERS.torso, duration: 4.8 },
      { at: at("decisive"), fx: "shake", where: HERS.feet, strength: 0.18 },
    ],
    audio: [
      { at: at("ready", 0.1), cue: "brace", from: "defender" },
      { at: at("decisive"), cue: "decisive" },
      { at: at("fall", 0.05), cue: "fall.heavy", from: "defender" },
    ],
  },
  resolution: { power: 1.8, weight: "heavy", hit: hitBy(["hit.heavy"]), death: { role: "death", prefer: ["death.dramatic"] }, claim: { gait: "walk" } },
};

export const QUEEN_SEQUENCES: readonly Sequence[] = [bindVolley, sunder, wyvernRun];

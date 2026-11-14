/**
 * Pawn takes Pawn: the first capture the Combat Director plays in a live
 * match. Everything else still gets the Pawn foundation's selector and today's
 * cinematics, untouched.
 *
 * Pure: the controller calls {@link directPawnDuel} where the move is
 * committed, and the engine calls {@link missingClips} against the real rigs
 * before it lets the plan near the stage.
 */
import { KINGDOM_SHIELD, type ClipRequest, type Kingdom } from "./choreography";
import {
  combatSeed, directCombat, planFromRecord, rememberCombat,
  type CombatDirection, type CombatInput, type CombatMemory, type CombatPlan, type Combatant,
} from "./director";

/** Army skin ids (`ArmySkinId`, the `ArmyId` of shared/play/match.ts) per side. */
export type DuelArmies = Readonly<Record<"w" | "b", Kingdom>>;

/**
 * The clips the two baked Pawn rigs hold, by the ids the catalog asks for: the combat-v2 library the duels are
 * played on (web/src/assets/chess/combat-v2, 30 CC0 clips per rig) and the combat-v1 clips kept beside it.
 */
export const PAWN_LIBRARY_V2_CLIPS = [
  "attack.thrust", "attack.jab", "attack.bash", "ready.windup", "ready.feint", "ready.guard",
  "defend.block-mid", "defend.block-high", "defend.block-impact", "defend.parry", "defend.dodge-left", "defend.dodge-right", "defend.dodge-back",
  "hit.recoil", "hit.stagger-light", "hit.stagger-heavy", "hit.front", "hit.head", "hit.back", "hit.left", "hit.right",
  "ready.step-forward", "ready.step-back", "death.forward", "death.backward", "death.collapse", "death.left", "death.right",
  "recovery.victory", "recovery.settle",
] as const;
export const PAWN_LIBRARY_V1_CLIPS = [
  "attack.thrust", "attack.bash-thrust", "attack.feint-step", "defend.block", "defend.parry", "defend.evade",
  "hit.light", "hit.medium", "hit.heavy", "death.front", "death.backward", "death.dramatic", "recovery.stance", "recovery.victory",
] as const;
export const PAWN_LIBRARY_CLIPS = [...PAWN_LIBRARY_V1_CLIPS,
  ...PAWN_LIBRARY_V2_CLIPS.filter(id => !PAWN_LIBRARY_V1_CLIPS.includes(id as typeof PAWN_LIBRARY_V1_CLIPS[number])),
] as const;
const GENERIC_CLIPS = ["attack", "death", "idle", "walk", "run"] as const;

/**
 * What a kingdom's Pawn brings to a fight. Mirrors `COMBAT_ARCHETYPES` in
 * pieces.ts: every kingdom's Pawn rig has its own combat libraries, v2 for
 * the duel over v1 (Aethelgard wp, Solforiz bp, Korvenia ep, Kwind-09 kp).
 * Korvenia's line infantry fixes bayonets when Pawn meets Pawn; its other
 * captures still fire the musket (`attackStyle` in sceneEngine.ts). Kwind-09's
 * levy carries no shield: it guards with the pike haft and the forearm. The
 * engine still checks the real rigs with {@link missingClips}.
 */
export function pawnCombatant(side: "w" | "b", army: Kingdom): Combatant {
  const clips = PAWN_LIBRARY_CLIPS;
  return {
    // Korvenia's line carries the musket and nothing on the other arm (`LOADOUTS` in weapons.ts), whatever its
    // heavier troops hold: a blow at it is parried, not blocked, and it has no shield to bash with.
    kind: "p", side, kingdom: army, armed: true, shield: army === "empire" ? null : KINGDOM_SHIELD[army],
    style: "melee",
    clips: [...clips, ...GENERIC_CLIPS],
  };
}

/** The authored clips a plan cannot be performed without, per fighter. */
export function neededClips(plan: CombatPlan): { attacker: string[]; defender: string[] } {
  const first = (request: ClipRequest | undefined) => request?.prefer?.[0];
  const attacker = new Set<string>(), defender = new Set<string>();
  for (const cue of plan.attacker) if (cue.do === "clip" && cue.clip.required && first(cue.clip)) attacker.add(first(cue.clip)!);
  // The defender's guard may be any of its preferred clips, but the ending is
  // the Pawn foundation's: takeHit and playDeath play exactly these two.
  for (const id of [first(plan.resolution.hit), first(plan.resolution.death)]) if (id) defender.add(id);
  return { attacker: [...attacker], defender: [...defender] };
}

/** Null when both rigs hold what the plan needs, else what is missing. */
export function missingClips(plan: CombatPlan, held: { attacker(id: string): boolean; defender(id: string): boolean }): string | null {
  const needed = neededClips(plan);
  for (const actor of ["attacker", "defender"] as const) {
    const id = needed[actor].find(clip => !held[actor](clip));
    if (id) return `${actor} lacks ${id}`;
  }
  for (const cue of plan.defender) {
    if (cue.do === "clip" && cue.clip.role === "block" && cue.clip.prefer?.length && !cue.clip.prefer.some(id => held.defender(id))) return `defender lacks ${cue.clip.prefer[0]}`;
  }
  return null;
}

export interface PawnDuelMove {
  /** The capturing side. */
  color: "w" | "b";
  from: string; to: string;
  /** The captured Pawn's square (not `to` in en passant). */
  victim: string;
  check?: boolean;
  armies: DuelArmies;
  /** Earlier fights of this game, oldest first. */
  history?: readonly CombatMemory[];
  /** The game's SAN list up to and including this move. */
  sanMoves: readonly string[];
  /** The move's PGN comment, when it already carries a record (replay, import). */
  comment?: string | null;
}

export interface PawnDuel {
  input: CombatInput;
  /** A plan both kingdoms' rigs can perform, or "fallback" for today's cinematic. */
  direction: CombatDirection;
  /** `history` with this fight added. */
  history: CombatMemory[];
}

export function pawnDuelInput(move: PawnDuelMove): CombatInput {
  const other = move.color === "w" ? "b" : "w";
  return {
    attacker: pawnCombatant(move.color, move.armies[move.color]),
    defender: pawnCombatant(other, move.armies[other]),
    geometry: { from: move.from, to: move.to, ...(move.victim !== move.to ? { victim: move.victim } : {}) },
    context: { check: !!move.check, history: move.history ?? [] },
    seed: combatSeed(move.sanMoves),
  };
}

/**
 * The fight for a Pawn capturing a Pawn. A comment that already carries a
 * combat record is replayed from it; otherwise the director chooses. The same
 * move list, armies and history always give the same fight, so Undo followed
 * by the same capture, and any replay, perform it again move for move.
 */
export function directPawnDuel(move: PawnDuelMove): PawnDuel {
  const input = pawnDuelInput(move);
  const recorded = move.comment && /\[%cfcombat/.test(move.comment) ? planFromRecord(move.comment, input) : null;
  let direction: CombatDirection = recorded?.kind === "sequence" ? recorded : directCombat(input);
  if (direction.kind === "sequence") {
    const held = (clips: readonly string[] | undefined) => (id: string) => !clips || clips.includes(id);
    const missing = missingClips(direction, { attacker: held(input.attacker.clips), defender: held(input.defender.clips) });
    if (missing) direction = { kind: "fallback", reason: `clips missing: ${missing}`, record: "" };
  }
  return { input, direction, history: rememberCombat(move.history ?? [], input, direction) };
}

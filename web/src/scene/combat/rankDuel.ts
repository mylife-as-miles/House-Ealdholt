/**
 * A Knight, a Rook or a King taking a Knight or a Rook: the second kind of
 * capture the Combat Director plays in a live match, on the rank libraries
 * (web/src/assets/chess/combat-ranks, one per figure's rig). Pawn takes Pawn
 * stays with pawnDuel.ts; every other capture keeps today's cinematic.
 *
 * Pure, like pawnDuel.ts: the controller calls {@link directRankDuel} where the
 * move is committed, and the engine checks the real rigs with `missingClips`
 * before the plan reaches the stage.
 */
import { createCatalog, type ClipRequest, type Kind, type Kingdom, type ShieldMaterial } from "./choreography";
import {
  combatSeed, directCombat, planFromRecord, rememberCombat,
  type CombatDirection, type CombatInput, type CombatMemory, type CombatPlan, type Combatant,
} from "./director";
import { missingClips, type DuelArmies, type PawnDuel } from "./pawnDuel";
import { RANK_APPROACH, RANK_ATTACKERS, RANK_SEQUENCES, type Approach } from "./sequences/rank";

export const RANK_CATALOG = createCatalog(RANK_SEQUENCES);

/** The rank library each figure fights with, by kingdom and class. Mirrors `COMBAT_ARCHETYPES` in pieces.ts. Korvenia's
 * Rook and King fight with powder (`attackStyle` in sceneEngine.ts) and have none. */
export const RANK_ARCHETYPES: Readonly<Record<Kingdom, Partial<Record<Kind, string>>>> = {
  ivory: { n: "wn", r: "wr", k: "wk" },
  sun: { n: "bn", r: "br", k: "bk" },
  empire: { n: "en" },
  kwind: { n: "kn", r: "kr", k: "kk" },
};

/** The clips each library holds, as its manifest lists them (combat-library-ranks.test.ts keeps the two in step). */
const OWN = ["attack.strike"] as const;
const BOUGHT = ["defend.block", "hit.front", "hit.back", "death.forward", "hit.left", "hit.right"] as const;
export const RANK_LIBRARY_CLIPS: Readonly<Record<string, readonly string[]>> = {
  wn: [...OWN, "death.backward", ...BOUGHT],
  wr: [...OWN, "death.backward"],
  wk: [...OWN, "death.forward"],
  bn: [...OWN, "death.backward", ...BOUGHT],
  br: [...OWN, "death.backward"],
  bk: [...OWN, "death.forward"],
  en: [...OWN, "death.backward"],
  kn: [...OWN, "death.backward"],
  kr: [...OWN, "death.forward"],
  kk: [...OWN, "death.forward"],
};
const GENERIC_CLIPS = ["attack", "death", "idle", "walk", "run"] as const;

/** What each figure holds on its off arm (`LOADOUT` in weapons.ts): the heater and tower shields of Aethelgard, the
 * riveted buckler and furnace plate of Solforiz. Korvenia's sabre and Kwind-09's kick and maul go without. */
const SHIELDS: Readonly<Record<string, ShieldMaterial>> = { wn: "iron", wr: "iron", bn: "iron", br: "iron" };

/** A figure as the director sees it, or null when its rig has no rank library. */
export function rankCombatant(side: "w" | "b", kingdom: Kingdom, kind: Kind): Combatant | null {
  const archetype = RANK_ARCHETYPES[kingdom]?.[kind];
  if (!archetype) return null;
  return {
    kind, side, kingdom, armed: true, shield: SHIELDS[archetype] ?? null, style: "melee",
    clips: [...RANK_LIBRARY_CLIPS[archetype], ...GENERIC_CLIPS],
  };
}

/**
 * Which way the attacker comes at the defender, from the defender's own front: White faces the eighth rank and
 * Black the first, and every figure turns back to that facing after it moves. Within 60 degrees of it is in front,
 * beyond 120 is behind (the same bands as deathWeight.ts `blowSide`).
 */
export function approachOf(squares: { from: string; to: string; victim?: string }, defender: "w" | "b"): Approach {
  const victim = squares.victim ?? squares.to;
  const file = (square: string) => square.charCodeAt(0) - 97, rank = (square: string) => Number(square[1]) - 1;
  // From the defender towards where the attacker started.
  const df = file(squares.from) - file(victim), dr = rank(squares.from) - rank(victim);
  const facing = defender === "w" ? 1 : -1;
  const degrees = Math.abs(Math.atan2(df, dr * facing)) * 180 / Math.PI;
  return degrees <= 60 ? "front" : degrees >= 120 ? "back" : "side";
}

/** The plan with every clip request cut down to what the two rigs hold, so a rig without a guard or a hit is given
 * the procedural one (the request's fallback) instead of the whole fight being refused. */
function fitToRigs(plan: CombatPlan, input: CombatInput): CombatPlan {
  const holds = (actor: "attacker" | "defender") => (id: string) => !input[actor].clips || input[actor].clips!.includes(id);
  const keep = (request: ClipRequest, has: (id: string) => boolean): ClipRequest =>
    request.prefer ? { ...request, prefer: request.prefer.filter(has) } : request;
  const actor = (role: "attacker" | "defender") => plan[role].map(cue => cue.do === "clip" ? { ...cue, clip: keep(cue.clip, holds(role)) } : cue);
  return {
    ...plan,
    attacker: actor("attacker"),
    defender: actor("defender"),
    resolution: { ...plan.resolution, hit: keep(plan.resolution.hit, holds("defender")), death: keep(plan.resolution.death, holds("defender")) },
  };
}

export interface RankDuelMove {
  /** The capturing side. */
  color: "w" | "b";
  from: string; to: string;
  /** The captured piece's square. */
  victim: string;
  attacker: Kind;
  defender: Kind;
  check?: boolean;
  armies: DuelArmies;
  /** Earlier fights of this game, oldest first. */
  history?: readonly CombatMemory[];
  /** The game's SAN list up to and including this move. */
  sanMoves: readonly string[];
  /** The move's PGN comment, when it already carries a record (replay, import). */
  comment?: string | null;
}

/**
 * The fight for a rank capture, or undefined when this capture is not one (the caller keeps today's path). A comment
 * that already carries a record is replayed from it; otherwise the director chooses among the fights for the way the
 * attacker comes in. The same move list, armies and history always give the same fight.
 */
export function directRankDuel(move: RankDuelMove): PawnDuel | undefined {
  if (!RANK_ATTACKERS.includes(move.attacker) || (move.defender !== "n" && move.defender !== "r")) return undefined;
  const other = move.color === "w" ? "b" : "w";
  const attacker = rankCombatant(move.color, move.armies[move.color], move.attacker);
  const defender = rankCombatant(other, move.armies[other], move.defender);
  if (!attacker || !defender) return undefined;
  const input: CombatInput = {
    attacker, defender,
    geometry: { from: move.from, to: move.to, ...(move.victim !== move.to ? { victim: move.victim } : {}) },
    context: { check: !!move.check, history: move.history ?? [] },
    seed: combatSeed(move.sanMoves),
  };
  const approach = approachOf(input.geometry, other);
  const recorded = move.comment && /\[%cfcombat/.test(move.comment) ? planFromRecord(move.comment, input, RANK_CATALOG) : null;
  let direction: CombatDirection = recorded?.kind === "sequence" ? recorded
    : directCombat(input, RANK_CATALOG.filter(sequence => RANK_APPROACH[sequence.id] === approach));
  if (direction.kind === "sequence") {
    direction = fitToRigs(direction, input);
    const held = (clips: readonly string[] | undefined) => (id: string) => !clips || clips.includes(id);
    const missing = missingClips(direction, { attacker: held(input.attacker.clips), defender: held(input.defender.clips) });
    if (missing) direction = { kind: "fallback", reason: `clips missing: ${missing}`, record: "" };
  }
  return { input, direction, history: rememberCombat(move.history ?? [], input, direction) };
}

/** Visual performance data only. Chess legality and capture results are owned
 * by the game controller; defenses never cancel a committed legal capture. */
export const COMBAT_LIBRARY_VERSION = "crownfall-pawn-combat-1";
export const PAWN_ATTACKS = ["attack.thrust", "attack.bash-thrust", "attack.feint-step"] as const;
export const PAWN_DEFENSES = ["defend.parry", "defend.block", "defend.evade"] as const;
export const PAWN_HITS = ["hit.light", "hit.medium", "hit.heavy"] as const;
export const PAWN_DEATHS = ["death.front", "death.backward", "death.dramatic"] as const;

export interface CombatSequence {
  version: 1;
  library: typeof COMBAT_LIBRARY_VERSION;
  attack: typeof PAWN_ATTACKS[number];
  defense: typeof PAWN_DEFENSES[number];
  hit: typeof PAWN_HITS[number];
  death: typeof PAWN_DEATHS[number];
}

export interface CombatCircumstances {
  attacker: string;
  defender: string;
  from: string;
  to: string;
  enPassant: boolean;
  recent?: readonly CombatSequence[];
}

// Each technique has a compatible mid-height defense, force and final fall.
const PERFORMANCES: readonly CombatSequence[] = PAWN_ATTACKS.map((attack, i) => ({
  version: 1, library: COMBAT_LIBRARY_VERSION, attack,
  defense: PAWN_DEFENSES[i], hit: PAWN_HITS[i], death: PAWN_DEATHS[i],
}));

export function selectCombatSequence(context: CombatCircumstances): CombatSequence | undefined {
  if (context.attacker !== "p" || context.defender !== "p") return undefined;
  const diagonal = context.from[0] !== context.to[0];
  const distance = Math.abs(Number(context.to[1]) - Number(context.from[1]));
  const scores = [distance <= 1 ? 2 : 1, context.enPassant ? -1 : 2, diagonal ? 3 : 1];
  // Prefer a fresh compatible technique without making a random choice. Both
  // the circumstances and preceding recorded performances determine the pick.
  const recent = context.recent ?? [];
  for (let i = 0; i < recent.length; i++) {
    const index = PAWN_ATTACKS.indexOf(recent[recent.length - 1 - i].attack);
    if (index >= 0) scores[index] -= Math.max(0, 4 - i);
  }
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  return { ...PERFORMANCES[best] };
}

export function validCombatSequence(value: unknown): value is CombatSequence {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return PERFORMANCES.some(p => p.version === record.version && p.library === record.library && p.attack === record.attack
    && p.defense === record.defense && p.hit === record.hit && p.death === record.death);
}

/** PGN comments preserve the selected choreography through existing replay
 * storage/import/export, including clients that ignore this optional token. */
export function combatComment(sequence: CombatSequence): string {
  if (!validCombatSequence(sequence)) throw new Error("Unknown combat sequence");
  return `[%cfcombat 1 ${sequence.library} ${sequence.attack} ${sequence.defense} ${sequence.hit} ${sequence.death}]`;
}

export function combatSequenceFromComment(comment: string): CombatSequence | undefined {
  const match = /\[%cfcombat\s+1\s+([a-z0-9.-]+)\s+([a-z.-]+)\s+([a-z.-]+)\s+([a-z.-]+)\s+([a-z.-]+)\s*\]/.exec(comment);
  if (!match) return undefined;
  const sequence = { version: 1, library: match[1], attack: match[2], defense: match[3], hit: match[4], death: match[5] };
  return validCombatSequence(sequence) ? sequence : undefined;
}

import type { Difficulty } from "../core/types";

/**
 * What the main thread and the search worker say to each other, and how long a
 * search may take. Shared by both sides, so it must stay free of DOM and worker
 * globals.
 */

export interface EngineRequest {
  id: number;
  fen: string;
  difficulty: Difficulty;
  /** Time left on the searching side's clock, or null in an untimed game. */
  remainingMs?: number | null;
}

/**
 * Every reply carries the id of the request it answers, so a stale reply can
 * never settle a newer request. No move (the position is over, or the search
 * failed) is all-null squares with depth 0.
 */
export interface EngineReply {
  id: number;
  from: string | null;
  to: string | null;
  promotion: string | null;
  score: number;
  depth: number;
}

/** Wall-clock budget for one search before the clock caps it. Easy does not search. */
export const SEARCH_BUDGET_MS: Record<Difficulty, number> = { easy: 0, medium: 700, hard: 3200 };
/** Deepest iteration of the iterative deepening. */
export const MAX_DEPTH: Record<Difficulty, number> = { easy: 1, medium: 3, hard: 5 };
/** Whether leaves are resolved by a capture search (quiescence). */
export const QUIESCENCE: Record<Difficulty, boolean> = { easy: false, medium: false, hard: true };

/** A search takes at most this fraction of the side's remaining clock. */
export const CLOCK_SHARE = 30;
/** Even in time trouble a search gets this long, so it still finds a legal and sensible move. */
export const MIN_BUDGET_MS = 30;

/** How long one search may run: the difficulty's budget, capped by a share of the clock in a timed game. */
export function searchBudget(difficulty: Difficulty, remainingMs?: number | null): number {
  const budget = SEARCH_BUDGET_MS[difficulty];
  if (remainingMs === null || remainingMs === undefined || !Number.isFinite(remainingMs)) return budget;
  return Math.min(budget, Math.max(MIN_BUDGET_MS, remainingMs / CLOCK_SHARE));
}

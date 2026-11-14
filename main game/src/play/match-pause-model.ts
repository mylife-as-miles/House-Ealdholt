/**
 * What the pause menu (MatchPause.tsx) decides without drawing anything: the match's figures for its Stats page, and
 * how its list and the Settings grid are walked. Only what the game records is counted: the move list (who moved,
 * what was taken, what gave check, which captures the Combat Director staged as a duel), the pieces taken, the time
 * each side has spent and the clocks.
 */
import type { CapturedPiece, ElapsedState, ClockState, Faction, LedgerMove } from "../../../web/src/core/types";
import { capturedBy, capturedWorth, materialLead, type CapturedGroup } from "./match-hud-model";

export interface SideStats {
  /** Moves this side has made. */
  moves: number;
  /** What it has taken from the other, the most valuable kind first, and those pieces' worth in pawns. */
  taken: CapturedGroup[];
  takenCount: number;
  takenWorth: number;
  /** How many pawns' worth it is ahead by (0 when level or behind). */
  lead: number;
  /** Its moves that gave check (the mating move counts). */
  checks: number;
  /** The duels it won: its Pawn-takes-Pawn captures the Combat Director staged as a fight. */
  duelsWon: number;
  /** Time it has spent on its moves. */
  thinkingMs: number;
  /** Its clock, or null in an untimed match. */
  clockMs: number | null;
}

export interface MatchStats {
  /** Half-moves played, and the move number they reach. */
  plies: number;
  fullMoves: number;
  /** The length of the match so far (both sides' time together). */
  playedMs: number;
  /** Duels fought, by either side. */
  duels: number;
  timed: boolean;
  sides: Record<Faction, SideStats>;
}

type StatsSnapshot = { moves: readonly LedgerMove[]; captured: readonly CapturedPiece[]; materialDiff: number; elapsed: ElapsedState; clock: ClockState };

export function matchStats(snapshot: StatsSnapshot): MatchStats {
  const side = (color: Faction): SideStats => {
    const mine = snapshot.moves.filter((move) => move.color === color);
    const taken = capturedBy(snapshot.captured, color);
    return {
      moves: mine.length,
      taken,
      takenCount: taken.reduce((sum, group) => sum + group.count, 0),
      takenWorth: capturedWorth(taken),
      lead: materialLead(snapshot.materialDiff, color),
      checks: mine.filter((move) => move.check || move.mate).length,
      duelsWon: mine.filter((move) => !!move.choreography).length,
      thinkingMs: color === "w" ? snapshot.elapsed.whiteMs : snapshot.elapsed.blackMs,
      clockMs: snapshot.clock.enabled ? (color === "w" ? snapshot.clock.whiteMs : snapshot.clock.blackMs) : null,
    };
  };
  const plies = snapshot.moves.length;
  return {
    plies,
    fullMoves: Math.ceil(plies / 2),
    playedMs: snapshot.elapsed.totalMs,
    duels: snapshot.moves.filter((move) => !!move.choreography).length,
    timed: snapshot.clock.enabled,
    sides: { w: side("w"), b: side("b") },
  };
}

/** The pause menu's list, top to bottom. */
export const PAUSE_ITEMS = ["resume", "settings", "stats", "exit"] as const;
export type PauseItem = (typeof PAUSE_ITEMS)[number];

/** Up and down the list, stopping at its ends (as the main menu's lists do). */
export function stepPauseItem(current: PauseItem, direction: "up" | "down"): PauseItem {
  const index = PAUSE_ITEMS.indexOf(current) + (direction === "up" ? -1 : 1);
  return PAUSE_ITEMS[Math.max(0, Math.min(PAUSE_ITEMS.length - 1, index))]!;
}

/**
 * A step across the Settings grid (three tiles by two, as App.tsx walks it). Left from its first column leaves the grid
 * for the pause list: that is returned as null.
 */
export function stepSettingsTile(index: number, direction: "left" | "right" | "up" | "down"): number | null {
  const column = index % 3, row = Math.floor(index / 3);
  if (direction === "left" && column === 0) return null;
  const nextColumn = Math.max(0, Math.min(2, column + (direction === "left" ? -1 : direction === "right" ? 1 : 0)));
  const nextRow = Math.max(0, Math.min(1, row + (direction === "up" ? -1 : direction === "down" ? 1 : 0)));
  return nextRow * 3 + nextColumn;
}

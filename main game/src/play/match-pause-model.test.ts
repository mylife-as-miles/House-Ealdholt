import assert from "node:assert/strict";
import test from "node:test";
import type { CapturedPiece, LedgerMove } from "../../../web/src/core/types";
import { matchStats, PAUSE_ITEMS, stepPauseItem, stepSettingsTile } from "./match-pause-model";

const move = (ply: number, san: string, extra: Partial<LedgerMove> = {}): LedgerMove => ({
  ply, number: Math.floor(ply / 2) + 1, color: ply % 2 ? "b" : "w", kind: "p", san, from: "a1", to: "a2",
  capture: false, castle: false, promotion: null, check: false, mate: false, ...extra,
});
const duel = { attack: "a" } as unknown as LedgerMove["choreography"];
const clock = { enabled: true, initialMs: 300000, whiteMs: 281000, blackMs: 290500 };
const elapsed = { whiteMs: 19000, blackMs: 9500, totalMs: 28500 };

test("a fresh match has nothing to count, and an untimed one no clocks", () => {
  const stats = matchStats({ moves: [], captured: [], materialDiff: 0, elapsed: { whiteMs: 0, blackMs: 0, totalMs: 0 }, clock: { ...clock, enabled: false } });
  assert.equal(stats.plies, 0);
  assert.equal(stats.fullMoves, 0);
  assert.equal(stats.duels, 0);
  assert.equal(stats.timed, false);
  for (const side of ["w", "b"] as const) {
    assert.deepEqual(stats.sides[side], { moves: 0, taken: [], takenCount: 0, takenWorth: 0, lead: 0, checks: 0, duelsWon: 0, thinkingMs: 0, clockMs: null });
  }
});

test("each side's moves, captures, checks and duels are counted from the move list", () => {
  // e4 d5 exd5 (a Pawn duel) Qxd5 Nc3 Qe5+
  const moves = [
    move(0, "e4"), move(1, "d5"),
    move(2, "exd5", { capture: true, choreography: duel }),
    move(3, "Qxd5", { kind: "q", capture: true }),
    move(4, "Nc3", { kind: "n" }),
    move(5, "Qe5+", { kind: "q", check: true }),
  ];
  const captured: CapturedPiece[] = [{ kind: "p", color: "b" }, { kind: "p", color: "w" }];
  const stats = matchStats({ moves, captured, materialDiff: 0, elapsed, clock });
  assert.equal(stats.plies, 6);
  assert.equal(stats.fullMoves, 3);
  assert.equal(stats.duels, 1);
  assert.equal(stats.playedMs, 28500);
  assert.equal(stats.timed, true);
  assert.deepEqual(stats.sides.w, { moves: 3, taken: [{ kind: "p", count: 1 }], takenCount: 1, takenWorth: 1, lead: 0, checks: 0, duelsWon: 1, thinkingMs: 19000, clockMs: 281000 });
  assert.deepEqual(stats.sides.b, { moves: 3, taken: [{ kind: "p", count: 1 }], takenCount: 1, takenWorth: 1, lead: 0, checks: 1, duelsWon: 0, thinkingMs: 9500, clockMs: 290500 });
});

test("the side ahead in material shows its lead, and a mate counts as a check", () => {
  const moves = [move(0, "f3"), move(1, "e5"), move(2, "g4"), move(3, "Qh4#", { kind: "q", mate: true, check: true })];
  const stats = matchStats({ moves, captured: [{ kind: "q", color: "w" }, { kind: "p", color: "w" }, { kind: "n", color: "b" }], materialDiff: -7, elapsed, clock });
  assert.equal(stats.sides.b.checks, 1);
  assert.equal(stats.sides.b.lead, 7);
  assert.equal(stats.sides.w.lead, 0);
  assert.deepEqual(stats.sides.b.taken, [{ kind: "q", count: 1 }, { kind: "p", count: 1 }]);
  assert.equal(stats.sides.b.takenWorth, 10);
  assert.equal(stats.sides.w.takenCount, 1);
});

test("the pause list stops at its ends", () => {
  assert.deepEqual([...PAUSE_ITEMS], ["resume", "settings", "stats", "exit"]);
  assert.equal(stepPauseItem("resume", "up"), "resume");
  assert.equal(stepPauseItem("resume", "down"), "settings");
  assert.equal(stepPauseItem("stats", "down"), "exit");
  assert.equal(stepPauseItem("exit", "down"), "exit");
});

test("the Settings grid is walked three by two, and left from its first column leaves it", () => {
  assert.equal(stepSettingsTile(0, "right"), 1);
  assert.equal(stepSettingsTile(2, "right"), 2);
  assert.equal(stepSettingsTile(1, "down"), 4);
  assert.equal(stepSettingsTile(4, "down"), 4);
  assert.equal(stepSettingsTile(5, "up"), 2);
  assert.equal(stepSettingsTile(4, "left"), 3);
  assert.equal(stepSettingsTile(0, "left"), null);
  assert.equal(stepSettingsTile(3, "left"), null);
});

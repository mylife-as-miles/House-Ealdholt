import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { MIN_BUDGET_MS, SEARCH_BUDGET_MS, searchBudget } from "./protocol";
import { answerRequest, pickEasyMove, searchPosition } from "./search";

/** chess.js's own internals, as search.ts drives them. */
interface Raw {
  _moves(options: { legal?: boolean }): { from: number; to: number; promotion?: string }[];
  _makeMove(move: unknown): void;
  _undoMove(): unknown;
  _isKingAttacked(side: "w" | "b"): boolean;
  _turn: "w" | "b";
  _hash: bigint;
}

const POSITIONS = [
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", // castling both ways, pins, en passant chances
  "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
  "r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2Q1RK1 w - - 0 9",
  "4k3/1P6/8/8/8/8/6p1/4K3 w - - 0 1", // promotions for both sides
  "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3", // en passant available
];

/** Leaf count to `depth` plies through the internals the search uses: pseudo-legal moves filtered by king safety. */
function rawPerft(chess: Chess, depth: number): number {
  const raw = chess as unknown as Raw;
  if (depth === 0) return 1;
  let total = 0;
  for (const move of raw._moves({ legal: false })) {
    const side = raw._turn;
    raw._makeMove(move);
    if (!raw._isKingAttacked(side)) total += rawPerft(chess, depth - 1);
    raw._undoMove();
  }
  return total;
}

/** The same count through the public API. */
function publicPerft(chess: Chess, depth: number): number {
  if (depth === 0) return 1;
  let total = 0;
  for (const move of chess.moves({ verbose: true })) {
    chess.move(move);
    total += publicPerft(chess, depth - 1);
    chess.undo();
  }
  return total;
}

function legal(fen: string, from: string, to: string, promotion: string | null): boolean {
  try {
    new Chess(fen).move({ from, to, promotion: promotion ?? undefined });
    return true;
  } catch {
    return false;
  }
}

describe("the computer opponent's search (M-08)", () => {
  it("drives chess.js's internals exactly as the public API counts moves, and leaves the board as it found it", () => {
    for (const fen of POSITIONS) {
      const chess = new Chess(fen);
      const before = (chess as unknown as Raw)._hash;
      expect(rawPerft(chess, 2), fen).toBe(publicPerft(new Chess(fen), 2));
      expect(chess.fen()).toBe(fen);
      expect((chess as unknown as Raw)._hash).toBe(before);
    }
  });

  it("always answers with a legal move, at every difficulty", () => {
    for (const fen of POSITIONS) {
      for (const quiescence of [false, true]) {
        const result = searchPosition(fen, { maxDepth: 3, quiescence, budgetMs: 200 });
        expect(result, fen).not.toBeNull();
        expect(legal(fen, result!.from, result!.to, result!.promotion), `${fen} ${result!.from}${result!.to}`).toBe(true);
      }
      const easy = pickEasyMove(fen, () => 0.3);
      expect(legal(fen, easy!.from, easy!.to, easy!.promotion)).toBe(true);
    }
  });

  it("finds mate in one and mate in two, and takes a hanging queen", () => {
    const mateInOne = searchPosition("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", { maxDepth: 3, quiescence: false, budgetMs: 500 });
    expect(`${mateInOne!.from}${mateInOne!.to}`).toBe("a1a8");
    // Two rooks against a bare king: no check mates at once (the king walks to g7), but 1. Rb7 Kg8 2. Ra8# does.
    const ladder = "7k/8/8/8/8/8/R7/1R5K w - - 0 1";
    const board = new Chess(ladder);
    expect(board.moves({ verbose: true }).some((move) => { board.move(move); const mate = board.isCheckmate(); board.undo(); return mate; })).toBe(false);
    const mateInTwo = searchPosition(ladder, { maxDepth: 5, quiescence: true, budgetMs: 3000 });
    expect(mateInTwo!.score).toBeGreaterThan(90000);
    const hanging = searchPosition("4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1", { maxDepth: 3, quiescence: false, budgetMs: 500 });
    expect(`${hanging!.from}${hanging!.to}`).toBe("d1d5");
  });

  it("has nothing to say in a finished position", () => {
    expect(searchPosition("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", { maxDepth: 3, quiescence: true, budgetMs: 100 })).toBeNull();
    expect(searchPosition("7k/5Q2/5K2/8/8/8/8/8 b - - 0 1", { maxDepth: 3, quiescence: true, budgetMs: 100 })).toBeNull();
    expect(answerRequest({ id: 9, fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", difficulty: "hard" }))
      .toEqual({ id: 9, from: null, to: null, promotion: null, score: 0, depth: 0 });
  });

  it("reaches depth 4 or more on Hard inside its budget in a middlegame, with no large overshoot", () => {
    const fen = POSITIONS[3];
    const started = performance.now();
    const result = searchPosition(fen, { maxDepth: 5, quiescence: true, budgetMs: SEARCH_BUDGET_MS.hard });
    const elapsed = performance.now() - started;
    expect(result!.depth).toBeGreaterThanOrEqual(4);
    expect(elapsed).toBeLessThan(SEARCH_BUDGET_MS.hard + 250);
  });

  it("stops near a short budget once one full iteration has given a move", () => {
    const started = performance.now();
    const result = searchPosition(POSITIONS[3], { maxDepth: 30, quiescence: true, budgetMs: 40 });
    expect(performance.now() - started).toBeLessThan(400);
    expect(result!.depth).toBeGreaterThanOrEqual(1);
    const reply = answerRequest({ id: 3, fen: POSITIONS[3], difficulty: "hard", remainingMs: 600 });
    expect(reply.depth).toBeGreaterThanOrEqual(1);
    expect(legal(POSITIONS[3], reply.from!, reply.to!, reply.promotion)).toBe(true);
  });

  it("caps the budget by a share of the clock in a timed game", () => {
    expect(searchBudget("hard")).toBe(SEARCH_BUDGET_MS.hard);
    expect(searchBudget("hard", null)).toBe(SEARCH_BUDGET_MS.hard);
    expect(searchBudget("hard", 600_000)).toBe(SEARCH_BUDGET_MS.hard);
    expect(searchBudget("hard", 30_000)).toBe(1000);
    expect(searchBudget("medium", 300)).toBe(MIN_BUDGET_MS);
    expect(searchBudget("easy", 30_000)).toBe(0);
  });
});

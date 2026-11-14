import { describe, expect, it } from "vitest";

import { Chess, type Square } from "chess.js";

import { cursorHome, heldTapOutcome, premoveReach, stepCursor, tapAction, type TapContext } from "./boardInput";

const tap = (context: Partial<TapContext>) =>
  tapAction({ phase: "open", mover: "w", square: null, piece: null, selected: null, legal: false, moves: 0, held: null, ...context });

describe("a press on the board", () => {
  it("picks up a piece of the side to move", () => {
    expect(tap({ square: "g1", piece: "w", moves: 2 })).toEqual({ type: "select", square: "g1" });
  });

  it("changes to another of the mover's pieces in one press", () => {
    expect(tap({ selected: "g1", square: "e2", piece: "w", moves: 2 })).toEqual({ type: "select", square: "e2" });
  });

  it("plays a legal destination, a capture included", () => {
    expect(tap({ selected: "g1", square: "f3", legal: true })).toEqual({ type: "move", from: "g1", to: "f3" });
    expect(tap({ selected: "e4", square: "d5", piece: "b", legal: true })).toEqual({ type: "move", from: "e4", to: "d5" });
  });

  it("lets the piece go on a second press, or on a press off the board", () => {
    expect(tap({ selected: "g1", square: "g1", piece: "w", moves: 2 })).toEqual({ type: "deselect" });
    expect(tap({ selected: "g1", square: null })).toEqual({ type: "deselect" });
    expect(tap({ square: null })).toEqual({ type: "none" });
  });

  it("refuses a square the piece cannot go to, and an enemy it cannot take", () => {
    expect(tap({ selected: "g1", square: "g5" })).toEqual({ type: "reject", from: "g1" });
    expect(tap({ selected: "g1", square: "d8", piece: "b" })).toEqual({ type: "reject", from: "g1" });
  });

  it("does nothing on an empty square or an enemy with nothing in hand", () => {
    expect(tap({ square: "e4" })).toEqual({ type: "none" });
    expect(tap({ square: "e7", piece: "b" })).toEqual({ type: "none" });
  });

  it("has a piece with no legal move refuse, keeping what is in hand", () => {
    expect(tap({ square: "e1", piece: "w", moves: 0 })).toEqual({ type: "stuck", square: "e1" });
    expect(tap({ selected: "g1", square: "a1", piece: "w", moves: 0 })).toEqual({ type: "stuck", square: "a1" });
  });

  it("holds the next mover's piece while a move is on stage, instead of dropping the press", () => {
    expect(tap({ phase: "waiting", mover: "b", square: "g8", piece: "b" })).toEqual({ type: "hold", square: "g8" });
    // Another piece replaces it; the same piece again, or a press off the board, lets it go.
    expect(tap({ phase: "waiting", mover: "b", square: "b8", piece: "b", held: "g8" })).toEqual({ type: "hold", square: "b8" });
    expect(tap({ phase: "waiting", mover: "b", square: "g8", piece: "b", held: "g8" })).toEqual({ type: "release" });
    expect(tap({ phase: "waiting", mover: "b", square: null, held: "g8" })).toEqual({ type: "release" });
    // The side that has just moved cannot queue anything, and nothing is played while waiting.
    expect(tap({ phase: "waiting", mover: "b", square: "e2", piece: "w" })).not.toMatchObject({ type: "hold" });
    expect(tap({ phase: "waiting", mover: "b", selected: "g8", square: "f6", legal: true })).not.toMatchObject({ type: "move" });
  });

  it("queues a whole move while waiting: the held piece, then where it is to go", () => {
    const waiting = { phase: "waiting", mover: "b", held: "g8" } as const;
    expect(tap({ ...waiting, square: "f6", reach: true })).toEqual({ type: "queue", from: "g8", to: "f6" });
    // A capture is queued the same way: an enemy stands on the square.
    expect(tap({ ...waiting, square: "h6", piece: "w", reach: true })).toEqual({ type: "queue", from: "g8", to: "h6" });
    // Another square changes where it goes; the piece itself again, or a press off the board, calls the move off.
    expect(tap({ ...waiting, queued: "f6", square: "h6", reach: true })).toEqual({ type: "queue", from: "g8", to: "h6" });
    expect(tap({ ...waiting, queued: "f6", square: "g8", piece: "b" })).toEqual({ type: "release" });
    expect(tap({ ...waiting, queued: "f6", square: null })).toEqual({ type: "release" });
    // Another of the mover's pieces takes its place, with nowhere to go yet.
    expect(tap({ ...waiting, queued: "f6", square: "b8", piece: "b" })).toEqual({ type: "hold", square: "b8" });
  });

  it("refuses a square the held piece could never reach, and lets it go", () => {
    expect(tap({ phase: "waiting", mover: "b", held: "g8", square: "g4", reach: false })).toEqual({ type: "reject", from: "g8" });
    expect(tap({ phase: "waiting", mover: "b", held: "g8", queued: "f6", square: "a1", piece: "w", reach: false })).toEqual({ type: "reject", from: "g8" });
  });

  it("refuses a piece known to have no move while the other side's move is shown, and holds it while that is not known", () => {
    expect(tap({ phase: "waiting", mover: "b", square: "e8", piece: "b", moves: 0, sure: true })).toEqual({ type: "stuck", square: "e8" });
    expect(tap({ phase: "waiting", mover: "b", square: "g8", piece: "b", moves: 2, sure: true })).toEqual({ type: "hold", square: "g8" });
    // The computer is still thinking: what will be legal is not known, so the piece is held.
    expect(tap({ phase: "waiting", mover: "w", square: "e1", piece: "w", moves: 0 })).toEqual({ type: "hold", square: "e1" });
  });

  it("hurries the move on stage with a press that asks for nothing else", () => {
    // Nothing held: an empty square, an enemy, a press off the board.
    expect(tap({ phase: "waiting", mover: "b", square: "e4" })).toEqual({ type: "hurry" });
    expect(tap({ phase: "waiting", mover: "b", square: "e2", piece: "w" })).toEqual({ type: "hurry" });
    expect(tap({ phase: "waiting", mover: "b", square: null })).toEqual({ type: "hurry" });
    // A move already queued, pressed again where it is going.
    expect(tap({ phase: "waiting", mover: "b", held: "g8", queued: "f6", square: "f6", reach: true })).toEqual({ type: "hurry" });
    // Never while the board is free or closed: there a press has its own meaning, or none.
    expect(tap({ square: "e4" })).toEqual({ type: "none" });
    expect(tap({ phase: "closed", square: "e4" })).toEqual({ type: "none" });
  });

  it("does nothing once the game is closed to input", () => {
    expect(tap({ phase: "closed", square: "g1", piece: "w", moves: 2 })).toEqual({ type: "none" });
    expect(tap({ phase: "closed", selected: "g1", square: "f3", legal: true })).toEqual({ type: "none" });
  });
});

describe("a held piece when the move has settled", () => {
  it("is picked up when its player may move", () => {
    expect(heldTapOutcome("open", "b", "b", 2)).toBe("select");
  });

  it("is kept while the wait goes on: the player's own move settled and the computer moves next", () => {
    expect(heldTapOutcome("waiting", "w", "w", 0)).toBe("keep");
  });

  it("is dropped if it was taken meanwhile, cannot move, or the game is closed", () => {
    expect(heldTapOutcome("open", "b", null, 0)).toBe("drop");
    expect(heldTapOutcome("open", "b", "w", 3)).toBe("drop");
    expect(heldTapOutcome("open", "b", "b", 0)).toBe("drop");
    expect(heldTapOutcome("closed", "b", "b", 2)).toBe("drop");
  });
});

describe("a queued move when the move has settled", () => {
  it("is played if it is legal in the position now on the board", () => {
    expect(heldTapOutcome("open", "b", "b", 2, "legal")).toBe("play");
  });

  it("is refused if it is not legal now, or its piece was taken meanwhile", () => {
    expect(heldTapOutcome("open", "b", "b", 2, "illegal")).toBe("refuse");
    expect(heldTapOutcome("open", "b", "b", 0, "illegal")).toBe("refuse");
    expect(heldTapOutcome("open", "b", null, 0, "illegal")).toBe("refuse");
    expect(heldTapOutcome("open", "b", "w", 3, "illegal")).toBe("refuse");
  });

  it("is kept while the wait goes on, and neither played nor refused over a closed board", () => {
    expect(heldTapOutcome("waiting", "w", "w", 0, "illegal")).toBe("keep");
    expect(heldTapOutcome("closed", "b", "b", 2, "legal")).toBe("drop");
    expect(heldTapOutcome("closed", "b", null, 0, "illegal")).toBe("drop");
  });
});

describe("where a piece may be sent before the position is known", () => {
  const sorted = (squares: string[]) => [...squares].sort();

  it("gives a Pawn the square ahead, two from its own rank, and both squares it takes on", () => {
    expect(sorted(premoveReach("p", "w", "e2"))).toEqual(["d3", "e3", "e4", "f3"]);
    expect(sorted(premoveReach("p", "b", "a7"))).toEqual(["a5", "a6", "b6"]);
    expect(sorted(premoveReach("p", "w", "h5"))).toEqual(["g6", "h6"]);
    expect(sorted(premoveReach("p", "b", "d2"))).toEqual(["c1", "d1", "e1"]);
  });

  it("gives a King its neighbours, and from its own square the two it castles to", () => {
    expect(sorted(premoveReach("k", "w", "e1"))).toEqual(["c1", "d1", "d2", "e2", "f1", "f2", "g1"]);
    expect(sorted(premoveReach("k", "b", "e8"))).toEqual(["c8", "d7", "d8", "e7", "f7", "f8", "g8"]);
    expect(premoveReach("k", "w", "e2")).not.toContain("g2");
    // Black's King on White's square castles nowhere.
    expect(premoveReach("k", "b", "e1")).not.toContain("g1");
  });

  it("lets nothing that stands in the way now count against a line piece or a Knight", () => {
    expect(premoveReach("r", "w", "a1")).toHaveLength(14);
    expect(premoveReach("b", "w", "c1")).toHaveLength(7);
    expect(premoveReach("q", "b", "d8")).toHaveLength(21);
    expect(sorted(premoveReach("n", "w", "g1"))).toEqual(["e2", "f3", "h3"]);
    expect(premoveReach("q", "w", "d4")).not.toContain("d4");
  });

  it("covers every move that is legal for the piece in any position it is tried in", () => {
    // Positions with castling both ways, captures in passing, promotions and pinned pieces.
    const positions = [
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      "r3k2r/pppq1ppp/2npbn2/2b1p3/2B1P3/2NPBN2/PPPQ1PPP/R3K2R w KQkq - 6 8",
      "r3k2r/pppq1ppp/2npbn2/2b1p3/2B1P3/2NPBN2/PPPQ1PPP/R3K2R b KQkq - 6 8",
      "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3",
      "rnbqkbnr/pppp1ppp/8/8/3Pp3/5N2/PPP1PPPP/RNBQKB1R b KQkq d3 0 3",
      "4k3/P6P/8/8/8/8/p6p/4K3 w - - 0 1",
      "4k3/P6P/8/8/8/8/p6p/4K3 b - - 0 1",
      "4r1k1/8/8/8/8/8/4B3/4K3 w - - 0 1",
    ];
    for (const fen of positions) {
      const chess = new Chess(fen);
      for (const move of chess.moves({ verbose: true })) {
        expect(premoveReach(move.piece, move.color, move.from), `${fen}: ${move.san}`).toContain(move.to);
      }
      // ...and never the square the piece stands on.
      for (const row of chess.board()) for (const cell of row) if (cell) expect(premoveReach(cell.type, cell.color, cell.square as Square)).not.toContain(cell.square);
    }
  });
});

describe("the keyboard's cursor", () => {
  // Where the camera looks along the ground from each seat (files along +x, ranks along -z).
  const WHITE = [0, -1] as const, BLACK = [0, 1] as const, EAST = [-1, 0] as const, WEST = [1, 0] as const;

  it("moves in White's directions from White's seat", () => {
    expect(stepCursor("e2", "up", ...WHITE)).toBe("e3");
    expect(stepCursor("e2", "down", ...WHITE)).toBe("e1");
    expect(stepCursor("e2", "right", ...WHITE)).toBe("f2");
    expect(stepCursor("e2", "left", ...WHITE)).toBe("d2");
  });

  it("moves as Black sees the board from Black's seat", () => {
    expect(stepCursor("e7", "up", ...BLACK)).toBe("e6");
    expect(stepCursor("e7", "down", ...BLACK)).toBe("e8");
    expect(stepCursor("e7", "right", ...BLACK)).toBe("d7");
    expect(stepCursor("e7", "left", ...BLACK)).toBe("f7");
  });

  it("runs along a rank when the board is seen from its side", () => {
    // From the h-file's side, looking toward the a-file: Up goes down the files, Right up the ranks.
    expect(stepCursor("e4", "up", ...EAST)).toBe("d4");
    expect(stepCursor("e4", "right", ...EAST)).toBe("e5");
    expect(stepCursor("e4", "up", ...WEST)).toBe("f4");
    expect(stepCursor("e4", "right", ...WEST)).toBe("e3");
  });

  it("goes by the nearest side for a view from a corner, and by White's seat when there is nothing to go by", () => {
    expect(stepCursor("e4", "up", -0.3, -0.9)).toBe("e5");
    expect(stepCursor("e4", "up", -0.9, 0.3)).toBe("d4");
    expect(stepCursor("e4", "up", 0, 0)).toBe("e5");
  });

  it("stops at the edge of the board", () => {
    expect(stepCursor("a1", "left", ...WHITE)).toBe("a1");
    expect(stepCursor("a1", "down", ...WHITE)).toBe("a1");
    expect(stepCursor("h8", "up", ...WHITE)).toBe("h8");
    expect(stepCursor("h8", "left", ...BLACK)).toBe("h8");
  });

  it("is undone by the opposite step from every seat", () => {
    const seats: readonly (readonly [number, number])[] = [WHITE, BLACK, EAST, WEST];
    for (const forward of seats) {
      expect(stepCursor(stepCursor("d4", "up", ...forward), "down", ...forward)).toBe("d4");
      expect(stepCursor(stepCursor("d4", "left", ...forward), "right", ...forward)).toBe("d4");
    }
  });

  it("starts in front of each side's King", () => {
    expect(cursorHome("w")).toBe("e2");
    expect(cursorHome("b")).toBe("e7");
  });
});

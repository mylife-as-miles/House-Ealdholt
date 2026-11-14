import { Chess, type Move } from "chess.js";

import type { Difficulty } from "../core/types";
import { MAX_DEPTH, QUIESCENCE, searchBudget, type EngineReply, type EngineRequest } from "./protocol";

/**
 * The computer opponent's search. Negamax with alpha-beta, MVV-LVA and killer
 * move ordering, quiescence on captures and iterative deepening under a
 * wall-clock budget. It runs in the search worker (engine.worker.ts).
 *
 * Inside the tree it works on chess.js's internal move generator, which is
 * fifty times cheaper than `moves({ verbose: true })`; the adapter below names
 * everything it relies on. chess.js is pinned at 1.4.0 (package.json), and
 * web/src/ai/search.test.ts holds this adapter to the public API.
 */

type Side = "w" | "b";

/** chess.js 1.4.0's internal move: 0x88 squares and bit flags. */
interface RawMove {
  color: Side;
  from: number;
  to: number;
  piece: string;
  captured?: string;
  promotion?: string;
  flags: number;
}

/** The parts of a chess.js 1.4.0 game the search reads and drives. */
interface RawBoard {
  /** 0x88 board: index = (8 - rank) * 16 + file. */
  _board: ({ type: string; color: Side } | undefined)[];
  _turn: Side;
  _halfMoves: number;
  /** Zobrist key, kept up to date by `_makeMove` and `_undoMove`. */
  _hash: bigint;
  /** `legal: false` gives pseudo-legal moves; the search tests legality only for the moves it tries. */
  _moves(options: { legal?: boolean }): RawMove[];
  _makeMove(move: RawMove): void;
  _undoMove(): RawMove | null;
  _isKingAttacked(side: Side): boolean;
}

function rawBoard(chess: Chess): RawBoard {
  const raw = chess as unknown as RawBoard;
  if (
    typeof raw._moves !== "function" ||
    typeof raw._makeMove !== "function" ||
    typeof raw._undoMove !== "function" ||
    typeof raw._isKingAttacked !== "function" ||
    !Array.isArray(raw._board)
  ) {
    throw new Error("The chess.js internals the search relies on have changed; check the pinned version.");
  }
  return raw;
}

/** chess.js's move flag bits. */
const KSIDE_CASTLE = 32;
const QSIDE_CASTLE = 64;

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

// Piece-square tables from white's point of view, index 0 = a8 .. 63 = h1.
const PST: Record<string, number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15,
    20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10,
    5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10,
    -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0,
    0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0,
    -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10,
    -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40,
    -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20,
    -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20,
  ],
  kEnd: [
    -50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30,
    -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0,
    0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50,
  ],
};

const MATE = 100000;
/** Plies of captures searched past the horizon. */
const QUIESCENCE_DEPTH = 4;
/** The clock is read every this many nodes (a power of two). */
const NODES_PER_CLOCK_CHECK = 16;
/** Ordering bonus for the two quiet moves that last refuted a sibling: above castling, below captures. */
const KILLER_BONUS = [90, 80];

/** Static evaluation in centipawns, positive = good for white. */
function evaluate(board: RawBoard["_board"]): number {
  let score = 0;
  let material = 0;
  let whiteKing = -1;
  let blackKing = -1;
  let heavy = 0;
  let minors = 0;
  for (let square = 0; square < 120; square += 1) {
    if (square & 0x88) {
      square += 7;
      continue;
    }
    const piece = board[square];
    if (!piece) continue;
    const row = square >> 4;
    const file = square & 7;
    const index = piece.color === "w" ? row * 8 + file : (7 - row) * 8 + file;
    if (piece.type === "k") {
      if (piece.color === "w") whiteKing = index;
      else blackKing = index;
      continue;
    }
    if (piece.type === "n" || piece.type === "b") minors += 1;
    else heavy += 1;
    if (piece.type !== "p") material += VALUE[piece.type];
    const value = VALUE[piece.type] + PST[piece.type][index];
    score += piece.color === "w" ? value : -value;
  }
  // Bare kings, or a lone knight or bishop: nobody can win.
  if (heavy === 0 && minors <= 1) return 0;
  const kings = material < 1500 ? PST.kEnd : PST.k;
  if (whiteKing >= 0) score += VALUE.k + kings[whiteKing];
  if (blackKing >= 0) score -= VALUE.k + kings[blackKing];
  return score;
}

/** Captures by most valuable victim and least valuable attacker, then promotions, then castling. */
function orderScore(move: RawMove): number {
  let score = 0;
  if (move.captured) score += 10 * VALUE[move.captured] - VALUE[move.piece];
  if (move.promotion) score += VALUE[move.promotion];
  if (move.flags & (KSIDE_CASTLE | QSIDE_CASTLE)) score += 60;
  return score;
}

function moveKey(move: RawMove): number {
  return move.from | (move.to << 7) | ((move.promotion ? "qrbn".indexOf(move.promotion) + 1 : 0) << 14);
}

function algebraic(square: number): string {
  return `${"abcdefgh"[square & 7]}${8 - (square >> 4)}`;
}

/** Moves the best-scored remaining move to `index` and returns it (selection sort, so a cutoff skips the rest). */
function takeBest(moves: RawMove[], scores: number[], index: number): RawMove {
  let best = index;
  for (let i = index + 1; i < moves.length; i += 1) if (scores[i] > scores[best]) best = i;
  if (best !== index) {
    const move = moves[index];
    moves[index] = moves[best];
    moves[best] = move;
    const score = scores[index];
    scores[index] = scores[best];
    scores[best] = score;
  }
  return moves[index];
}

export interface SearchResult {
  from: string;
  to: string;
  promotion: string | null;
  score: number;
  /** Deepest iteration that completed. */
  depth: number;
  nodes: number;
}

class Search {
  private readonly board: RawBoard;
  private readonly deadline: number;
  private nodes = 0;
  private aborted = false;
  /** The clock may stop the search only once one full iteration has given a move worth trusting. */
  private mayAbort = false;
  /** Two killer moves per ply. */
  private readonly killers: number[] = [];
  /** Zobrist keys of the positions from the root to the current node, for repetition. */
  private readonly path: bigint[] = [];

  constructor(
    fen: string,
    budgetMs: number,
    private readonly quiescent: boolean,
  ) {
    this.board = rawBoard(new Chess(fen));
    this.deadline = performance.now() + budgetMs;
  }

  /** Counts a node; reads the clock every few nodes. */
  private outOfTime(): boolean {
    this.nodes += 1;
    if (this.mayAbort && !this.aborted && (this.nodes & (NODES_PER_CLOCK_CHECK - 1)) === 0 && performance.now() > this.deadline) {
      this.aborted = true;
    }
    return this.aborted;
  }

  /** Evaluation from the side to move's point of view. */
  private relative(): number {
    const score = evaluate(this.board._board);
    return this.board._turn === "w" ? score : -score;
  }

  /** The current position already occurred on the way here since the last capture or pawn move. */
  private repeated(): boolean {
    const hash = this.board._hash;
    const last = this.path.length - 1;
    const stop = Math.max(0, last - this.board._halfMoves);
    for (let i = last - 2; i >= stop; i -= 2) if (this.path[i] === hash) return true;
    return false;
  }

  private hasLegalMove(moves: RawMove[], side: Side): boolean {
    const board = this.board;
    for (const move of moves) {
      board._makeMove(move);
      const legal = !board._isKingAttacked(side);
      board._undoMove();
      if (legal) return true;
    }
    return false;
  }

  private quiescence(alpha: number, beta: number, depth: number, generated?: RawMove[]): number {
    if (this.outOfTime()) return 0;
    const standPat = this.relative();
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (depth <= 0) return alpha;

    const board = this.board;
    const side = board._turn;
    const moves: RawMove[] = [];
    const scores: number[] = [];
    for (const move of generated ?? board._moves({ legal: false })) {
      // Captures (en passant included) and queen promotions.
      if (move.captured || move.promotion === "q") {
        moves.push(move);
        scores.push(orderScore(move));
      }
    }
    for (let i = 0; i < moves.length; i += 1) {
      const move = takeBest(moves, scores, i);
      board._makeMove(move);
      if (board._isKingAttacked(side)) {
        board._undoMove();
        continue;
      }
      const score = -this.quiescence(-beta, -alpha, depth - 1);
      board._undoMove();
      if (this.aborted) return 0;
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number): number {
    if (this.outOfTime()) return 0;
    const board = this.board;
    if (board._halfMoves >= 100 || this.repeated()) return 0;

    const side = board._turn;
    const moves = board._moves({ legal: false });
    if (depth <= 0) {
      // Mate and stalemate are seen at the horizon too.
      if (!this.hasLegalMove(moves, side)) return board._isKingAttacked(side) ? -MATE - depth : 0;
      return this.quiescent ? this.quiescence(alpha, beta, QUIESCENCE_DEPTH, moves) : this.relative();
    }

    const first = this.killers[ply * 2];
    const second = this.killers[ply * 2 + 1];
    const scores = moves.map((move) => {
      const key = moveKey(move);
      return orderScore(move) + (key === first ? KILLER_BONUS[0] : key === second ? KILLER_BONUS[1] : 0);
    });

    let best = -Infinity;
    let legal = 0;
    for (let i = 0; i < moves.length; i += 1) {
      const move = takeBest(moves, scores, i);
      board._makeMove(move);
      if (board._isKingAttacked(side)) {
        board._undoMove();
        continue;
      }
      legal += 1;
      this.path.push(board._hash);
      const score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      this.path.pop();
      board._undoMove();
      if (this.aborted) return 0;
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) {
        if (!move.captured && !move.promotion) {
          const key = moveKey(move);
          if (key !== first) {
            this.killers[ply * 2 + 1] = first;
            this.killers[ply * 2] = key;
          }
        }
        break;
      }
    }
    if (legal === 0) return board._isKingAttacked(side) ? -MATE - depth : 0;
    return best;
  }

  /** Iterative deepening; returns the best move found before the budget ran out. */
  run(maxDepth: number): SearchResult | null {
    const board = this.board;
    // Stable sort: equal moves keep the generator's order, so ties resolve the same way every time.
    const rootMoves = board._moves({ legal: true }).sort((a, b) => orderScore(b) - orderScore(a));
    if (rootMoves.length === 0) return null;
    this.path.push(board._hash);

    let bestMove = rootMoves[0];
    let bestScore = -Infinity;
    let reachedDepth = 0;

    for (let depth = 1; depth <= maxDepth; depth += 1) {
      let alpha = -Infinity;
      let localBest: RawMove | null = null;
      let localScore = -Infinity;

      for (const move of rootMoves) {
        board._makeMove(move);
        this.path.push(board._hash);
        const score = -this.negamax(depth - 1, -Infinity, -alpha, 1);
        this.path.pop();
        board._undoMove();
        if (this.aborted) break;
        if (score > localScore) {
          localScore = score;
          localBest = move;
        }
        if (score > alpha) alpha = score;
      }

      if (this.aborted) {
        // The previous best is searched first, so any move that finished this
        // iteration ahead of it is a better choice than the last full iteration.
        if (localBest) {
          bestMove = localBest;
          bestScore = localScore;
        }
        break;
      }
      bestMove = localBest ?? bestMove;
      bestScore = localScore;
      reachedDepth = depth;
      this.mayAbort = true;
      // Re-order root moves so the previous best is searched first next iteration.
      rootMoves.sort((a, b) => (a === bestMove ? -1 : b === bestMove ? 1 : 0));
      if (Math.abs(bestScore) > 90000) break;
    }

    return {
      from: algebraic(bestMove.from),
      to: algebraic(bestMove.to),
      promotion: bestMove.promotion ?? null,
      score: bestScore === -Infinity ? 0 : bestScore,
      depth: reachedDepth,
      nodes: this.nodes,
    };
  }
}

/** Easy: random, but it grabs a hanging piece or delivers mate when it is obvious. */
export function pickEasyMove(fen: string, random: () => number = Math.random): SearchResult | null {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true }) as Move[];
  if (moves.length === 0) return null;
  const result = (move: Move): SearchResult => ({
    from: move.from,
    to: move.to,
    promotion: move.promotion ?? null,
    score: 0,
    depth: 1,
    nodes: moves.length,
  });

  for (const move of moves) {
    chess.move(move as unknown as { from: string; to: string; promotion?: string });
    const mate = chess.isCheckmate();
    chess.undo();
    if (mate) return result(move);
  }
  const captures = moves.filter((move) => Boolean(move.captured));
  if (captures.length > 0 && random() < 0.6) {
    return result(captures[Math.floor(random() * captures.length)]);
  }
  return result(moves[Math.floor(random() * moves.length)]);
}

/** One iterative-deepening search of a position; null when the side to move has no legal move. */
export function searchPosition(fen: string, options: { maxDepth: number; quiescence: boolean; budgetMs: number }): SearchResult | null {
  return new Search(fen, options.budgetMs, options.quiescence).run(options.maxDepth);
}

/** The computer's move at a difficulty, searching for at most `budgetMs`; null when the side to move has none. */
export function searchBestMove(fen: string, difficulty: Difficulty, budgetMs: number): SearchResult | null {
  if (difficulty === "easy") return pickEasyMove(fen);
  return searchPosition(fen, { maxDepth: MAX_DEPTH[difficulty], quiescence: QUIESCENCE[difficulty], budgetMs });
}

/** A reply that says there is no move: the position is over, or the search failed. */
export function noMoveReply(id: number): EngineReply {
  return { id, from: null, to: null, promotion: null, score: 0, depth: 0 };
}

/** The worker's whole job: one request in, one reply out, always carrying the request's id. */
export function answerRequest(request: EngineRequest): EngineReply {
  const { id, fen, difficulty, remainingMs } = request;
  try {
    const best = searchBestMove(fen, difficulty, searchBudget(difficulty, remainingMs));
    if (!best) return noMoveReply(id);
    return { id, from: best.from, to: best.to, promotion: best.promotion, score: best.score, depth: Math.max(1, best.depth) };
  } catch (error) {
    console.error("[engine] search failed", error);
    return noMoveReply(id);
  }
}

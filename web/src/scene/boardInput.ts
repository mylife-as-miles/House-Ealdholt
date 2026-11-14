import type { Faction, PieceKind, SquareId } from "../core/types";

/**
 * What a press on the board means. One reading for the pointer, the keyboard and a controller (which presses the
 * keyboard's keys), kept apart from the scene so it can be checked without one.
 *
 * `open`: a player may move now. `waiting`: a move is still on stage, or the computer is thinking, and a player
 * moves next. `closed`: nothing can be played (the game is over, it is being watched, it is paused, a pawn waits to
 * be promoted).
 *
 * A press made while waiting used to be dropped. Now the piece pressed is held: it answers at once, and it is
 * selected, with its moves lit, the moment the board is free (SceneEngine.releaseHeldTap).
 *
 * A second press while waiting gives the held piece its destination: the whole move is queued, shown on the board,
 * and played the moment the board is free if it is legal then; if it is not, it is refused as any other move is.
 * A press that asks for nothing of the kind (an empty square or an enemy with nothing held, the destination already
 * chosen) asks the move on stage to hurry instead (SceneEngine.hurryMove).
 */
export type InputPhase = "open" | "waiting" | "closed";

export interface TapContext {
  phase: InputPhase;
  /** The side whose pieces may be picked up: the side to move, or while waiting the player who moves next. */
  mover: Faction;
  /** The square pressed; null for a press off the board. */
  square: SquareId | null;
  /** Whose figure stands on it, if any. */
  piece: Faction | null;
  /** The piece in hand. */
  selected: SquareId | null;
  /** The square pressed is a legal destination of the piece in hand. */
  legal: boolean;
  /** How many legal moves the piece pressed has. Read for the mover's own piece while `open`, and while waiting if `sure`. */
  moves: number;
  /** The piece held while waiting. */
  held: SquareId | null;
  /** Waiting: where the held piece has been told to go, if anywhere yet. */
  queued?: SquareId | null;
  /** Waiting: the square pressed is one the held piece may be sent to (its legal moves if `sure`, else premoveReach). */
  reach?: boolean;
  /**
   * Waiting: the position the mover will play from is already on the board (the other side's move is being shown),
   * so what is legal is known now. Not so while the computer thinks, or while the player's own move is on stage.
   */
  sure?: boolean;
}

export type TapAction =
  | { type: "none" }
  /** Pick the piece up and light its moves. */
  | { type: "select"; square: SquareId }
  /** A piece of the mover's that has no legal move: it refuses, and nothing is picked up. */
  | { type: "stuck"; square: SquareId }
  | { type: "move"; from: SquareId; to: SquareId }
  /** Let the piece in hand go. */
  | { type: "deselect" }
  /** Not a square the piece in hand can go to: it refuses and is let go. */
  | { type: "reject"; from: SquareId }
  /** Waiting: remember this piece until the board is free. */
  | { type: "hold"; square: SquareId }
  /** Waiting: the held piece is told where to go. The move is played when the board is free, if it is legal then. */
  | { type: "queue"; from: SquareId; to: SquareId }
  /** Waiting: forget the piece held, and where it was to go. */
  | { type: "release" }
  /** Waiting: the press asks for nothing else, so it asks the move on stage to get on with it. */
  | { type: "hurry" };

const NONE: TapAction = { type: "none" };

export function tapAction(context: TapContext): TapAction {
  const { phase, mover, square, piece, selected, held } = context;
  if (phase === "closed") return NONE;
  if (phase === "waiting") {
    if (square && piece === mover) {
      if (held === square) return { type: "release" };
      // Known to have no move: it refuses now, as it would with the board free.
      return context.sure && context.moves === 0 ? { type: "stuck", square } : { type: "hold", square };
    }
    if (!held) return { type: "hurry" };
    if (!square) return { type: "release" };
    // Pressed again where the piece is already going: nothing to change, so the press hurries the wait.
    if (square === context.queued) return { type: "hurry" };
    return context.reach ? { type: "queue", from: held, to: square } : { type: "reject", from: held };
  }
  if (!square) return selected ? { type: "deselect" } : NONE;
  if (selected === square) return { type: "deselect" };
  if (selected && context.legal) return { type: "move", from: selected, to: square };
  if (piece === mover) return context.moves > 0 ? { type: "select", square } : { type: "stuck", square };
  return selected ? { type: "reject", from: selected } : NONE;
}

/**
 * What becomes of a held piece when a move has settled: it is picked up if its player may now move and it still
 * stands (it may have been taken meanwhile), kept if the wait goes on (the player's own move settled and the
 * computer is about to think), and dropped otherwise.
 *
 * `aim` says whether it was also told where to go, and whether that move is legal in the position now on the board.
 * A queued move is played if it is, and refused if it is not or if its piece is gone. Nothing is played or refused
 * over a board that is closed (the game ended, or is paused): the queue is only forgotten.
 */
export type QueuedAim = "none" | "legal" | "illegal";
export function heldTapOutcome(phase: InputPhase, mover: Faction, piece: Faction | null, moves: number, aim: QueuedAim = "none"): "select" | "play" | "refuse" | "keep" | "drop" {
  if (phase === "closed") return "drop";
  if (piece !== mover) return aim === "none" ? "drop" : "refuse";
  if (phase === "waiting") return "keep";
  if (aim === "none") return moves > 0 ? "select" : "drop";
  return aim === "legal" ? "play" : "refuse";
}

const FILES = "abcdefgh";

/**
 * Every square a piece of this kind could be sent to from where it stands, whatever else is on the board: the reach
 * of a move queued before the position it will be played in is known (the computer is still thinking, or the
 * player's own move is still on stage). The other side's reply can open a line, or put a piece where a Pawn can take
 * it, so nothing that stands in the way now is held against the move; whether it is legal is settled when the board
 * is free. A Pawn reaches the square ahead, two from its own rank, and both squares it takes on; a King its
 * neighbours and, from its own square, the two it castles to.
 */
export function premoveReach(kind: PieceKind, color: Faction, from: SquareId): SquareId[] {
  const file = FILES.indexOf(from[0]), rank = Number(from[1]);
  const reach: SquareId[] = [];
  const add = (f: number, r: number): boolean => {
    if (f < 0 || f > 7 || r < 1 || r > 8) return false;
    reach.push(`${FILES[f]}${r}`);
    return true;
  };
  const rays = (steps: readonly (readonly [number, number])[]): void => {
    for (const [df, dr] of steps) for (let n = 1; add(file + df * n, rank + dr * n); n += 1);
  };
  const STRAIGHT = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const, DIAGONAL = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
  if (kind === "p") {
    const ahead = color === "w" ? 1 : -1;
    add(file, rank + ahead);
    if (rank === (color === "w" ? 2 : 7)) add(file, rank + ahead * 2);
    add(file - 1, rank + ahead);
    add(file + 1, rank + ahead);
  } else if (kind === "n") {
    for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) add(file + df, rank + dr);
  } else if (kind === "k") {
    for (const [df, dr] of [...STRAIGHT, ...DIAGONAL]) add(file + df, rank + dr);
    if (from === (color === "w" ? "e1" : "e8")) { add(file + 2, rank); add(file - 2, rank); }
  } else {
    if (kind !== "b") rays(STRAIGHT);
    if (kind !== "r") rays(DIAGONAL);
  }
  return reach;
}

/* ------------------------------------------------------------------ the keyboard's cursor */

export type CursorDirection = "left" | "right" | "up" | "down";

/**
 * One step of the keyboard's (and a controller's) cursor, as the player sees the board. `forwardX`, `forwardZ` is
 * where the camera looks along the ground, in the board's own axes (files run along +x, ranks along -z). It is
 * taken to the nearest of the four sides, so Up is always away from the player and Right is always to their right:
 * from White's seat Up is toward the eighth rank, from Black's toward the first, and from the side of the board it
 * runs along a rank. The arrows used to move in White's directions wherever the camera stood, so for Black, and
 * after Flip board, every arrow went the wrong way.
 *
 * A view straight down has no forward along the ground; the scene then passes the top of its picture instead.
 */
export function stepCursor(square: SquareId, direction: CursorDirection, forwardX: number, forwardZ: number): SquareId {
  // Ties and a missing direction fall to White's seat.
  const along = Math.abs(forwardX) > Math.abs(forwardZ);
  const fx = along ? Math.sign(forwardX) : 0;
  const fz = along ? 0 : forwardZ > 0 ? 1 : -1;
  // To the right of forward, seen from above: (x, z) turns to (-z, x).
  const [dx, dz] = direction === "up" ? [fx, fz] : direction === "down" ? [-fx, -fz] : direction === "right" ? [-fz, fx] : [fz, -fx];
  const file = Math.min(7, Math.max(0, FILES.indexOf(square[0]) + dx));
  const rank = Math.min(8, Math.max(1, Number(square[1]) - dz));
  return `${FILES[file]}${rank}`;
}

/** Where a side's cursor starts: in front of its King. */
export function cursorHome(side: Faction): SquareId {
  return side === "w" ? "e2" : "e7";
}

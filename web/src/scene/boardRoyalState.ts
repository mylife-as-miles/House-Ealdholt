import { Chess, type Square } from "chess.js";
import type { Faction } from "../core/types";

/** Read the authoritative legal position. No inferred attack rays, synthetic
 * moves or persistent emotion facts; undo/replay naturally restore history. */
export function boardRoyalThreat(fen: string, moves: readonly { color: Faction; check: boolean }[]) {
  const game = new Chess(fen);
  if (!game.isCheck()) return null;
  const color = game.turn(), enemy = color === "w" ? "b" : "w";
  let square: Square | null = null;
  for (const row of game.board()) for (const cell of row) if (cell?.type === "k" && cell.color === color) square = cell.square;
  if (!square) return null;
  const kingSquare = square as Square;
  const attackers = game.attackers(kingSquare, enemy).sort((a, b) => {
    const d = (s: string) => Math.hypot(s.charCodeAt(0)-kingSquare.charCodeAt(0), Number(s[1])-Number(kingSquare[1]));
    return d(a)-d(b) || a.localeCompare(b);
  });
  return { color, kingSquare, attackers, checks: moves.filter(move => move.color === enemy && move.check).length, mate: game.isCheckmate() };
}

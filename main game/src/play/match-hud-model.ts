/**
 * What the match HUD shows, worked out from the game's snapshot (MatchHud.tsx draws it). Kept apart from the drawing
 * so it can be checked without a browser.
 */
import type { MatchConfig } from "../../../shared/play/match";
import { PIECE_VALUE, type CapturedPiece, type EndReason, type Faction, type GameResult, type GameSnapshot, type PieceKind } from "../../../web/src/core/types";
import type { TapAction } from "../../../web/src/scene/boardInput";
import type { InputDevice } from "../input-prompts";

/** A clock or a length of time as minutes and seconds. */
export const formatClock = (ms: number) => `${Math.floor(Math.max(0, ms) / 60000)}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, "0")}`;

/**
 * How much of the HUD a stage of this size holds open. The board fills the lower part of every screen and reaches the
 * side edges on 4:3 and on phones, so only a wide stage has room beside it for the whole row of actions and an open
 * move record; elsewhere those fold under a button. A phone in landscape (the game pillarboxes it to 16:9, about 700
 * by 390) also drops the labels.
 */
export type HudTier = "wide" | "mid" | "small";
export function hudTier(width: number, height: number): HudTier {
  if (height < 520 || width < 760) return "small";
  return width >= 1260 && height >= 660 ? "wide" : "mid";
}
/** The stage's size for a window: the game pillarboxes windows 2:1 or wider to 16:9 (styles.css). */
export function stageSize(width: number, height: number): [number, number] {
  return width >= height * 2 ? [Math.min(width, height * 1.7927), height] : [width, height];
}

export interface MovePair { number: number; white: string; black: string | null }
/** The move record as numbered pairs: White's move, then Black's reply once it is made. */
export function movePairs(sanList: readonly string[]): MovePair[] {
  const pairs: MovePair[] = [];
  for (let ply = 0; ply < sanList.length; ply += 2) pairs.push({ number: ply / 2 + 1, white: sanList[ply]!, black: sanList[ply + 1] ?? null });
  return pairs;
}

export interface CapturedGroup { kind: PieceKind; count: number }
const CAPTURE_ORDER: readonly PieceKind[] = ["q", "r", "b", "n", "p"];
/** What a side has taken from the other, the most valuable kind first, each kind once with how many. */
export function capturedBy(captured: readonly CapturedPiece[], side: Faction): CapturedGroup[] {
  return CAPTURE_ORDER
    .map((kind) => ({ kind, count: captured.filter((piece) => piece.color !== side && piece.kind === kind).length }))
    .filter((group) => group.count > 0);
}
/** The worth of what a side has taken, in pawns. */
export const capturedWorth = (groups: readonly CapturedGroup[]) => groups.reduce((sum, group) => sum + PIECE_VALUE[group.kind] * group.count, 0);
/** How many pawns' worth a side is ahead by; 0 when level or behind. `materialDiff` is positive when White leads. */
export const materialLead = (materialDiff: number, side: Faction) => Math.max(0, side === "w" ? materialDiff : -materialDiff);

export type SideRole = "You" | "Computer" | "Player 1" | "Player 2";
/** Who leads a side: you and the computer in Classic, the two players of a duel, the computer twice in an AI battle. */
export function sideRole(config: Pick<MatchConfig, "mode" | "playerColor">, side: Faction): SideRole {
  if (config.mode === "classic") return side === config.playerColor ? "You" : "Computer";
  if (config.mode === "ai-battle") return "Computer";
  return side === "w" ? "Player 1" : "Player 2";
}

/** What a side's plate says of it: its move (thinking, in check or held), waiting for the other, or how it ended. */
export type SideState = "move" | "thinking" | "check" | "paused" | "waiting" | "won" | "lost" | "drawn";
type StateSnapshot = Pick<GameSnapshot, "status" | "turn" | "result" | "thinking" | "inCheck" | "paused">;
export function sideState(snapshot: StateSnapshot | null, side: Faction): SideState {
  if (!snapshot) return "waiting";
  if (snapshot.result) return snapshot.result.winner === null ? "drawn" : snapshot.result.winner === side ? "won" : "lost";
  if (snapshot.status !== "playing" || snapshot.turn !== side) return "waiting";
  // A computer that failed is held until it is retried; so is a paused AI battle.
  return snapshot.paused ? "paused" : snapshot.thinking ? "thinking" : snapshot.inCheck ? "check" : "move";
}
/** The side whose plate is lit: the one to move, or the winner once the game is over. */
export function activeSide(snapshot: StateSnapshot | null): Faction | null {
  if (!snapshot) return null;
  if (snapshot.result) return snapshot.result.winner;
  return snapshot.status === "playing" ? snapshot.turn : null;
}

/** The sentence that says where the game stands, and what qualifies it. Each part is translated on its own. */
export function statusLine(snapshot: Pick<GameSnapshot, "turn" | "result" | "thinking" | "inCheck"> | null, nameOf: (side: Faction) => string): { headline: string; note: "Thinking…" | "Check" | null } {
  const result = snapshot?.result;
  if (result) return { headline: result.winner ? `${nameOf(result.winner)} wins` : "Draw", note: null };
  return { headline: `${nameOf(snapshot?.turn ?? "w")} to move`, note: snapshot?.thinking ? "Thinking…" : snapshot?.inCheck ? "Check" : null };
}

const REASON_LABEL: Record<EndReason, string> = {
  checkmate: "Checkmate", stalemate: "Stalemate", resignation: "Resignation", timeout: "Time out", threefold: "Threefold repetition",
  insufficient: "Insufficient material", fiftymove: "Fifty-move rule", objective: "Objective met", draw: "Draw agreed",
};
/** Who won and why, for the result panel: the reason as a heading, the outcome, and one line that says what happened. */
export function resultSummary(result: GameResult, nameOf: (side: Faction) => string): { reason: string; title: string; line: string } {
  const reason = REASON_LABEL[result.reason] ?? result.reason;
  if (!result.winner) {
    const line = result.reason === "stalemate" ? "No legal move remains." : result.reason === "threefold" ? "The same position came three times."
      : result.reason === "insufficient" ? "Neither side can force checkmate." : result.reason === "fiftymove" ? "Fifty moves passed without a capture or a pawn move."
      : "Neither side wins.";
    return { reason, title: "Draw", line };
  }
  const winner = nameOf(result.winner), loser = nameOf(result.winner === "w" ? "b" : "w");
  const line = result.reason === "checkmate" ? `${loser} is checkmated.` : result.reason === "resignation" ? `${loser} resigned.`
    : result.reason === "timeout" ? `${loser} ran out of time.` : result.reason === "objective" ? `${winner} met the objective.` : `${winner} defeats ${loser}.`;
  return { reason, title: `${winner} wins`, line };
}

/**
 * What the board's screen-reader line says after Enter (or a controller's select) on a square: what the press did,
 * from the board's own answer (web/src/scene/boardInput.ts). It used to read "E2 selected." whatever happened.
 * `pieceAt` names the figure on a square, or null; `moves` is how many legal moves a piece just picked up has.
 */
export function tapAnnouncement(action: TapAction, cursor: string, pieceAt: (square: string) => string | null, moves: number, inCheck: boolean): string {
  const at = (square: string) => square.toUpperCase();
  const check = inCheck ? " Your King is in check." : "";
  switch (action.type) {
    case "select": return `${pieceAt(action.square) ?? "Piece"} on ${at(action.square)} selected. ${moves} legal ${moves === 1 ? "move" : "moves"}.`;
    case "move": return `${at(action.from)} to ${at(action.to)}.`;
    case "deselect": case "release": return "Selection cleared.";
    case "reject": return `${at(cursor)} is not a legal move.${check}`;
    case "stuck": return `${pieceAt(action.square) ?? "Piece"} on ${at(action.square)} has no legal move.${check}`;
    case "hold": return `${pieceAt(action.square) ?? "Piece"} on ${at(action.square)} will be selected when the board is free. Choose a square now to queue its move.`;
    case "queue": return `${pieceAt(action.from) ?? "Piece"} on ${at(action.from)} to ${at(action.to)} queued. It is played when the board is free, if it is legal then.`;
    case "none": case "hurry": return `${at(cursor)}, ${pieceAt(cursor) ?? "empty"}.`;
  }
}

/** What the screen-reader line says when a queued move is played or refused as the board comes free; nothing when it was only let go. */
export function queuedAnnouncement(ended: "played" | "refused" | "let-go" | undefined): string | null {
  return ended === "played" ? "The queued move is played." : ended === "refused" ? "The queued move is not legal now. Nothing is played." : null;
}

/**
 * The controls that turn the view, as the device in use shows them (MatchExperience reads the keys, useMatchGamepad
 * the controller): the keys or buttons of each, and what it does. `chord` keys are held together. The HUD shows them
 * as its key chips until the view has been turned once, and the pause menu always.
 */
export interface ViewHint {
  keys: readonly string[];
  chord?: boolean;
  label: "Turn and tilt" | "Zoom" | "Reset view" | "Press to reset view";
}
export function viewHints(device: InputDevice): ViewHint[] {
  if (device === "keyboard") return [
    { keys: ["Shift", "← ↑ ↓ →"], chord: true, label: "Turn and tilt" },
    { keys: ["+", "−"], label: "Zoom" },
    { keys: ["R"], label: "Reset view" },
  ];
  // The right stick, the two triggers and a press on the stick, as each maker names them.
  const pad = device === "playstation" ? { stick: "R", out: "L2", in: "R2", press: "R3" }
    : device === "nintendo" ? { stick: "R", out: "ZL", in: "ZR", press: null }
    : { stick: "RS", out: "LT", in: "RT", press: null };
  return [
    { keys: [pad.stick], label: "Turn and tilt" },
    { keys: [pad.out, pad.in], label: "Zoom" },
    pad.press ? { keys: [pad.press], label: "Reset view" } : { keys: [pad.stick], label: "Press to reset view" },
  ];
}

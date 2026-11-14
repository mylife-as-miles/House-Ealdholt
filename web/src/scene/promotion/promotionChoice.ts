/**
 * The promotion picker's focus: which of the four candidates the player is about to choose, how the keys move it, and
 * how a focused candidate stands against the others. No Three.js in here, so the node tests reach it
 * (shared/play/promotion-sequence.test.ts); sceneEngine.ts draws it on the board's picker and the HUD highlights the
 * same row (MatchHud's "Promote pawn" panel).
 *
 * Q, R, B and N still choose at once. The arrows (and the controller's d-pad or left stick, which press them) move the
 * focus round the four, wrapping at either end; Enter or Space (the controller's select) chooses the one in focus;
 * Escape (its back) backs out, as it always has. A pointer over a figure, its pedestal or its row focuses it.
 */

/** The candidates, in the order the picker stands them and the panel lists them. */
export const PROMOTION_ORDER = ["q", "r", "b", "n"] as const;
export type PromotionChoice = (typeof PROMOTION_ORDER)[number];
/** The picker opens on the Queen, as the panel's first row is its primary. */
export const DEFAULT_PROMOTION_FOCUS: PromotionChoice = "q";

export function isPromotionChoice(kind: string): kind is PromotionChoice {
  return (PROMOTION_ORDER as readonly string[]).includes(kind);
}

/** The candidate `step` places along from `current` (negative: back toward the Queen), wrapping round the four. */
export function stepPromotionFocus(current: PromotionChoice, step: number): PromotionChoice {
  const count = PROMOTION_ORDER.length;
  const at = PROMOTION_ORDER.indexOf(current);
  const next = (((at + Math.trunc(step)) % count) + count) % count;
  return PROMOTION_ORDER[next]!;
}

export type PromotionKeyAction =
  | { type: "choose"; kind: PromotionChoice }
  | { type: "move"; step: -1 | 1 }
  | { type: "confirm" }
  | { type: "back" };

/**
 * What a key does while the picker is up (KeyboardEvent.key), or null for a key it leaves alone. The panel's rows run
 * down a wide screen and across a narrow one, so up and left both go back, down and right both go on.
 */
export function promotionKeyAction(key: string): PromotionKeyAction | null {
  const lower = key.length === 1 ? key.toLowerCase() : key;
  if (isPromotionChoice(lower)) return { type: "choose", kind: lower };
  if (key === "ArrowLeft" || key === "ArrowUp") return { type: "move", step: -1 };
  if (key === "ArrowRight" || key === "ArrowDown") return { type: "move", step: 1 };
  if (key === "Enter" || key === " " || key === "Spacebar") return { type: "confirm" };
  if (key === "Escape") return { type: "back" };
  return null;
}

/** How a candidate stands: raised, turned off the camera (radians), how solid it is, and how its pedestal glows. */
export interface PromotionFocusLook { lift: number; turn: number; opacity: number; glow: number }

/**
 * The focused candidate lifts a little off its pedestal and turns full to the camera, its pedestal glowing in the
 * kingdom's colour; the others stand turned a quarter away, a little dimmed. Where motion is reduced nothing lifts or
 * turns: the glow and the dimming say it alone.
 */
export function promotionFocusLook(focused: boolean, reducedMotion: boolean): PromotionFocusLook {
  if (focused) return { lift: reducedMotion ? 0 : 0.22, turn: 0, opacity: 1, glow: 1 };
  return { lift: 0, turn: reducedMotion ? 0 : 0.6, opacity: 0.62, glow: 0 };
}

/** How far toward its look a candidate eases in `seconds` (all of it at once where motion is reduced). */
export function focusEase(seconds: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  return 1 - Math.exp(-Math.max(0, seconds) * 12);
}

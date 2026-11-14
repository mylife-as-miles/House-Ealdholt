/**
 * The Unmaking: Korvenia's rune and the void column, for its Bishop and Queen. unmaking/unmakingPlan.ts is its
 * clock and budget (tested in shared/play/spell-unmaking.test.ts); unmaking/unmaking.ts draws it.
 */
import type { SpellEntry } from "../spell";
import { makeUnmaking } from "./unmaking";

export { makeUnmaking } from "./unmaking";
export { UNMAKING_BUDGET, unmakingCounts, unmakingSize, unmakingState, unmakingTimeline } from "./unmakingPlan";

/**
 * The entry for the library's registry. Its id is the spellbook's. The rune it leaves is the spell's own; the match
 * lays its burn as well, under the char.
 */
export const unmaking: SpellEntry = { id: "unmaking", name: "Unmaking", make: makeUnmaking, mark: "burn" };

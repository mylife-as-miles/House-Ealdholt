/**
 * The Lance: Korvenia's lance of light, for its Bishop and Queen. lance/lancePlan.ts is its clock and budget
 * (tested in shared/play/spell-lance.test.ts); lance/lance.ts draws it.
 */
import type { SpellEntry } from "../spell";
import { makeLance } from "./lance";

export { makeLance } from "./lance";
export { LANCE_BUDGET, lanceCounts, lanceSize, lanceState, lanceTimeline } from "./lancePlan";

/** The entry for the library's registry. Its id is the spellbook's. */
export const lance: SpellEntry = { id: "lance", name: "Lance", make: makeLance, mark: "burn", travels: true };

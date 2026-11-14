/**
 * The Snare: a cage of current thrown over the victim and crushed shut, for Kwind-09's casters in its arc and
 * Korvenia's in its violet. snare/snarePlan.ts is its clock and budget (tested in shared/play/spell-snare.test.ts);
 * snare/snare.ts draws it.
 */
import type { SpellEntry } from "../spell";
import { makeSnare } from "./snare";

export { makeSnare } from "./snare";
export { SNARE_BUDGET, snareCounts, snareSize, snareState, snareTimeline } from "./snarePlan";

/** The entry for the library's registry. Its id is the spellbook's. */
export const snare: SpellEntry = { id: "snare", name: "Snare", make: makeSnare, mark: "burn" };

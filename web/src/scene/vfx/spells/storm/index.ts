/**
 * The Storm bolt: Kwind-09's arc, for its Bishop and Queen. storm/stormPlan.ts is its clock and budget (tested in
 * shared/play/spell-storm.test.ts); storm/storm.ts draws it.
 */
import type { SpellEntry } from "../spell";
import { makeStormBolt } from "./storm";

export { makeStormBolt } from "./storm";
export { STORM_BUDGET, stormCounts, stormSize, stormState, stormTimeline } from "./stormPlan";

/** The entry for the library's registry. Its id is the spellbook's. */
export const stormBolt: SpellEntry = { id: "storm-bolt", name: "Storm bolt", make: makeStormBolt, mark: "burn", travels: true };

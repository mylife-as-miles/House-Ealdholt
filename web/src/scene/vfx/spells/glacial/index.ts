/**
 * The Glacial crown: Aethelgard's second spell, a crown of ice blades raised round the victim and shattered, for its
 * Bishop and Queen. glacial/glacialPlan.ts is its clock and budget (tested in shared/play/spell-glacial-crown.test.ts);
 * glacial/glacialCrown.ts draws it.
 */
import type { SpellEntry } from "../spell";
import { makeGlacialCrown } from "./glacialCrown";

export { makeGlacialCrown } from "./glacialCrown";
export { GLACIAL_BUDGET, glacialCounts, glacialSize, glacialState, glacialTimeline } from "./glacialPlan";

/**
 * The entry for the library's registry. Its id is the spellbook's. Ice never burns: the piece dies run through on the
 * blades, held up on them and bleeding (vfx/spells/spell.ts `pierce`). As the sheet melts off the stone it leaves
 * Aethelgard's witchfire sear where it lay (spell.ts `thaw`, vfx/scorchPlan.ts `frost`).
 */
export const GLACIAL_CROWN: SpellEntry = { id: "glacial-crown", name: "Glacial crown", make: makeGlacialCrown, mark: "thaw", death: "pierce" };

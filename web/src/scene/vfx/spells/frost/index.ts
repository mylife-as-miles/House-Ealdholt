/**
 * Aethelgard's spells: winter, pale blue-white, clean and cold. The library builds its registry from here.
 */
import type { SpellEntry } from "../spell";
import { frostLine } from "./frostLine";

export { frostLine } from "./frostLine";
export { FROST_BUDGET } from "./frostPlan";

/**
 * The frost line: rime runs the stone to the victim, a row of ice spikes erupts behind it, and the last bursts up
 * through the victim. Ice never burns: the piece dies run through on the great spike, held up on it and bleeding
 * (vfx/spells/spell.ts `pierce`). As the rime melts off the stone it leaves Aethelgard's witchfire sear under the
 * victim (spell.ts `thaw`, vfx/scorchPlan.ts `frost`).
 */
export const FROST_LINE: SpellEntry = { id: "frost-line", name: "Frost line", make: frostLine, mark: "thaw", death: "pierce", row: true };

export const FROST_SPELLS: readonly SpellEntry[] = [FROST_LINE];

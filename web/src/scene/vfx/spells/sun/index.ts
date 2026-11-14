/**
 * Solforiz's spells: the sun, in gold, white-hot and amber. The library builds its registry from here.
 */
import type { SpellEntry } from "../spell";
import { sunPillar } from "./sunPillar";

export { sunPillar } from "./sunPillar";
export { SUN_BUDGET } from "./sunPlan";

/** The sun pillar: a ring is drawn round the victim and warns, and a column of sunlight comes down on it. */
export const SUN_PILLAR: SpellEntry = { id: "sun-pillar", name: "Sun pillar", make: sunPillar, mark: "burn", air: 2.2 };

export const SUN_SPELLS: readonly SpellEntry[] = [SUN_PILLAR];

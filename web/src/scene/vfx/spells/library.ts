/**
 * The spells that are built: what the spellbook's names (spells/spellbook.ts) are made by.
 *
 * The book may name a spell before it is here. A cast asks {@link canMake} first and only draws a spell that is;
 * a caster whose page has nothing built yet throws the match's plain bolt, as before the library.
 */
import { FROST_LINE } from "./frost";
import { GLACIAL_CROWN } from "./glacial";
import { lance } from "./lance";
import { firePortal } from "./portal";
import { snare } from "./snare";
import type { SpellEntry } from "./spell";
import type { SpellId } from "./spellbook";
import { stormBolt } from "./storm";
import { SUN_PILLAR } from "./sun";
import { unmaking } from "./unmaking";

/** Every built spell, by its name in the book. A spell is added here when its folder lands. */
export const SPELL_LIBRARY: Partial<Record<SpellId, SpellEntry>> = {
  lance,
  unmaking,
  "storm-bolt": stormBolt,
  snare,
  "fire-portal": firePortal,
  "sun-pillar": SUN_PILLAR,
  "frost-line": FROST_LINE,
  "glacial-crown": GLACIAL_CROWN,
};

export const canMake = (id: SpellId): boolean => SPELL_LIBRARY[id] !== undefined;

export function spellEntry(id: SpellId): SpellEntry | null {
  return SPELL_LIBRARY[id] ?? null;
}

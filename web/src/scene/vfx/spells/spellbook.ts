/**
 * Which spells each kingdom's casters may draw, and which one a given cast gets. No Three.js in here, so the node
 * tests reach it (shared/play/spellbook.test.ts).
 *
 * A kingdom has its own magic and a caster draws from its own page: the same capture should not look the same
 * twice running, and a Queen's page is longer than a Bishop's. The book may list a spell before it is built; a
 * cast only ever draws one the library can make.
 *
 * - Korvenia (`empire`): the occult. Its Bishop and Queen cast; the rest of the army keeps powder and steel.
 * - Kwind-09 (`kwind`): the arc.
 * - Solforiz (`sun`): sun and fire.
 * - Aethelgard (`ivory`): cold witchfire.
 */
import type { PieceKind } from "../../../core/types";
import type { VfxArmy } from "../wiring";

/** Every spell the book names. A spell not yet in the library is skipped when one is drawn. */
export const SPELL_IDS = ["lance", "unmaking", "storm-bolt", "snare", "fire-portal", "sun-pillar", "frost-line", "glacial-crown"] as const;
export type SpellId = (typeof SPELL_IDS)[number];

export interface SpellChoice {
  id: SpellId;
  /** How often it comes up against the others on the page. */
  weight: number;
}

type Page = readonly SpellChoice[];

/** The pages. Only ranks that cast have one. */
export const SPELLBOOK: Readonly<Record<VfxArmy, Readonly<Partial<Record<PieceKind, Page>>>>> = {
  empire: {
    b: [{ id: "lance", weight: 3 }, { id: "unmaking", weight: 2 }],
    q: [{ id: "lance", weight: 2 }, { id: "unmaking", weight: 2 }, { id: "snare", weight: 1 }],
  },
  kwind: {
    b: [{ id: "storm-bolt", weight: 3 }, { id: "snare", weight: 1 }],
    q: [{ id: "storm-bolt", weight: 2 }, { id: "snare", weight: 2 }],
  },
  sun: {
    b: [{ id: "sun-pillar", weight: 2 }, { id: "fire-portal", weight: 2 }],
    q: [{ id: "sun-pillar", weight: 2 }, { id: "fire-portal", weight: 2 }],
  },
  ivory: {
    b: [{ id: "frost-line", weight: 3 }, { id: "glacial-crown", weight: 2 }],
    q: [{ id: "frost-line", weight: 2 }, { id: "glacial-crown", weight: 2 }],
  },
};

/** A 0..1 number from a seed: the same seed always gives the same draw. */
function unit(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * The spell this cast gets, or null when the caster has no page or nothing on it can be made yet (the match then
 * plays its plain bolt). `last` is the spell this kingdom cast before: it is not drawn again while the page offers
 * anything else.
 */
export function chooseSpell(army: VfxArmy, caster: PieceKind, seed: number, options: { last?: SpellId | null; canMake?(id: SpellId): boolean } = {}): SpellId | null {
  const page = (SPELLBOOK[army][caster] ?? []).filter((choice) => options.canMake?.(choice.id) ?? true);
  if (page.length === 0) return null;
  const fresh = page.filter((choice) => choice.id !== options.last);
  const from = fresh.length > 0 ? fresh : page;
  const total = from.reduce((sum, choice) => sum + choice.weight, 0);
  let at = unit(seed) * total;
  for (const choice of from) { at -= choice.weight; if (at < 0) return choice.id; }
  return from[from.length - 1].id;
}

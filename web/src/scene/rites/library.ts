/**
 * The summons that are built: one per kingdom, for its Queen (rites/rite.ts).
 *
 * A Queen whose kingdom has none yet casts a spell from her page instead, as her Bishop does.
 */
import type { VfxArmy } from "../vfx/wiring";
import { PHOENIX_RITE } from "./phoenix/phoenixRite";
import type { RiteEntry } from "./rite";
import { SHADOW_RITE } from "./shadow/shadowRite";
import { UNDEAD_RITE } from "./undead/undeadRite";
import { WYVERN_RITE } from "./wyvernRite";

export const RITES: Partial<Record<VfxArmy, RiteEntry>> = {
  ivory: WYVERN_RITE,
  sun: PHOENIX_RITE,
  empire: SHADOW_RITE,
  kwind: UNDEAD_RITE,
};

export function riteFor(army: VfxArmy): RiteEntry | null {
  return RITES[army] ?? null;
}

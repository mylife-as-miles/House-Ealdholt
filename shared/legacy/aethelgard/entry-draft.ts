import { findHeraldryPreset, validateHeraldry } from "../content/heraldry";
import type { Heraldry } from "../types";
import { EALDHOLT_HOUSE, type InheritedAethelgardHouseId } from "./house";

/** Unsaved player design, not the house's historical crest. Identity lives in
 * approved content and has no name or kingdom edit in this draft. This contract
 * neither founds a banner nor creates a LegacyState or changes house standing. */
export interface InheritedBannerDraft {
  readonly houseId: InheritedAethelgardHouseId;
  readonly heraldry: Readonly<Heraldry> | null;
}

export type InheritedBannerDraftResult =
  | { ok: true; draft: InheritedBannerDraft }
  | { ok: false; draft: InheritedBannerDraft; errors: readonly string[] };

/** No inherited crest has been approved, so opening the designer does not pick
 * a national default or call it the house's existing banner. */
export function createInheritedBannerDraft(): InheritedBannerDraft {
  return Object.freeze({ houseId: EALDHOLT_HOUSE.id, heraldry: null });
}

function freezeHeraldry(heraldry: Heraldry): Readonly<Heraldry> {
  Object.freeze(heraldry.field);
  return Object.freeze(heraldry);
}

/** Validates and copies the proposed design; extra candidate fields cannot
 * rename the house, change its kingdom, or import progression into the draft. */
export function chooseInheritedBannerDesign(draft: InheritedBannerDraft, proposed: unknown): InheritedBannerDraftResult {
  if (draft.houseId !== EALDHOLT_HOUSE.id) return { ok: false, draft, errors: ["The inherited house identity cannot be changed."] };
  const validation = validateHeraldry(proposed);
  if (validation.ok === false) return { ok: false, draft, errors: validation.errors };
  return { ok: true, draft: Object.freeze({ houseId: EALDHOLT_HOUSE.id, heraldry: freezeHeraldry(validation.heraldry) }) };
}

/** An explicit player choice of existing design artwork, never an inherited
 * history or an automatic opening selection. */
export function chooseInheritedBannerPreset(draft: InheritedBannerDraft, presetId: string): InheritedBannerDraftResult {
  const preset = findHeraldryPreset(EALDHOLT_HOUSE.nationId, presetId);
  return preset
    ? chooseInheritedBannerDesign(draft, preset.heraldry)
    : { ok: false, draft, errors: ["Choose an available banner design."] };
}

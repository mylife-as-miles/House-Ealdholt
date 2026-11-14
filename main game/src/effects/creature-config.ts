import { MENU_SORCERER_MODEL } from "../../../shared/menu/derived-assets";

// User-supplied Crownfall_Sorcerer_Digits_v3_1(1).glb. The menu loads its generated copy with only the Idle clip
// and lighter maps (shared/menu/derived-assets.ts, U-05); matches load the full model with every clip.
// ?model=/models/alternate.glb previews another model; ?model=none previews fallback.
export const CREATURE_MODEL_URL = `${import.meta.env.BASE_URL}${MENU_SORCERER_MODEL}`;

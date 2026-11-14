import type { LegacyState, NationId } from "../types";

/** Candidate rules for the replacement experience. The existing presentation,
 * save parser and match launchers do not consume this module yet. */
export const INITIAL_LEGACY_KINGDOM: NationId = "aethelgard";
export const INITIAL_STORY_KINGDOM: NationId = "aethelgard";

export type KingdomSelectionContext = "legacy" | "story" | "classic" | "local-duel" | "online-duel";
export type InitialKingdomAccess =
  | { available: true; reason: null }
  | { available: false; reason: "aethelgard-only" | "online-unlock-rules-pending" };

/** An online mode is not itself an unlock. No unlock criteria or entitlements
 * are invented here; other kingdoms remain unavailable until that contract exists.
 * This is kingdom availability, not a claim that the requested mode is implemented. */
export function initialKingdomAccess(nationId: NationId, context: KingdomSelectionContext): InitialKingdomAccess {
  if (nationId === INITIAL_LEGACY_KINGDOM) return { available: true, reason: null };
  return { available: false, reason: context === "online-duel" ? "online-unlock-rules-pending" : "aethelgard-only" };
}

export type AethelgardPredecessorKind = "no-house" | "same-kingdom-predecessor" | "other-kingdom-predecessor";

/** Classify an already validated predecessor without changing it. An old
 * Aethelgard house is still player-founded; sharing a kingdom does not make it
 * compatible with the replacement's inherited house or authorize conversion. */
export function classifyAethelgardPredecessor(state: Pick<LegacyState, "banner">): AethelgardPredecessorKind {
  if (state.banner === null) return "no-house";
  return state.banner.nationId === INITIAL_LEGACY_KINGDOM ? "same-kingdom-predecessor" : "other-kingdom-predecessor";
}

import assert from "node:assert/strict";
import test from "node:test";
import { initialKingdomAccess, classifyAethelgardPredecessor, type KingdomSelectionContext } from "../aethelgard/policy";
import { createLegacyState } from "../domain/state";
import { reduceLegacy } from "../domain/reducer";
import { defaultHeraldry } from "../content/heraldry";
import type { NationId } from "../types";

test("online selection never grants an unspecified kingdom unlock", () => {
  const contexts: KingdomSelectionContext[] = ["legacy", "story", "classic", "local-duel", "online-duel"];
  for (const context of contexts) {
    assert.equal(initialKingdomAccess("aethelgard", context).available, true);
    for (const nation of ["korvenia", "solforiz", "kwind-09"] as const) {
      assert.deepEqual(initialKingdomAccess(nation, context), {
        available: false,
        reason: context === "online-duel" ? "online-unlock-rules-pending" : "aethelgard-only",
      });
    }
  }
});

test("replacement compatibility inspection preserves every existing house and its history", () => {
  const fresh = createLegacyState();
  assert.equal(classifyAethelgardPredecessor(fresh), "no-house");
  for (const nationId of ["aethelgard", "korvenia", "solforiz", "kwind-09"] satisfies NationId[]) {
    const result = reduceLegacy(fresh, {
      type: "found-banner", name: "House Ashwell", nationId, heraldry: defaultHeraldry(nationId),
      at: "2026-11-05T12:00:00.000Z", seed: 11,
    });
    assert.equal(result.error, null);
    const before = JSON.stringify(result.state);
    assert.equal(classifyAethelgardPredecessor(result.state), nationId === "aethelgard" ? "same-kingdom-predecessor" : "other-kingdom-predecessor");
    assert.equal(JSON.stringify(result.state), before);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseInheritedBannerDesign, chooseInheritedBannerPreset, createInheritedBannerDraft,
} from "../aethelgard/entry-draft";
import { EALDHOLT_HOUSE } from "../aethelgard/house";
import { defaultHeraldry, findHeraldryPreset } from "../content/heraldry";
import { reduceLegacy } from "../domain/reducer";
import { createLegacyState } from "../domain/state";

test("inherited identity stays fixed and the opening draft invents no historical crest or progression", () => {
  const draft = createInheritedBannerDraft();
  assert.equal(EALDHOLT_HOUSE.name, "House Ealdholt");
  assert.equal(EALDHOLT_HOUSE.nationId, "aethelgard");
  assert.equal(draft.houseId, EALDHOLT_HOUSE.id);
  assert.equal(draft.heraldry, null);
  assert.deepEqual(Object.keys(draft).sort(), ["heraldry", "houseId"]);
  assert.equal(Reflect.set(EALDHOLT_HOUSE, "name", "Another house"), false);
  assert.equal(Reflect.set(EALDHOLT_HOUSE, "nationId", "korvenia"), false);
  assert.equal(Reflect.set(draft, "houseId", "another-house"), false);
});

test("a chosen banner is validated, copied and immutable without changing the earlier draft or input", () => {
  const draft = createInheritedBannerDraft();
  const design = defaultHeraldry("aethelgard");
  const before = JSON.stringify(design);
  const result = chooseInheritedBannerDesign(draft, design);
  assert.equal(result.ok, true);
  assert.equal(draft.heraldry, null);
  if (!result.ok) assert.fail("valid banner refused");
  assert.notEqual(result.draft.heraldry, design);
  assert.deepEqual(result.draft.heraldry, design);
  assert.equal(JSON.stringify(design), before);
  assert.ok(result.draft.heraldry);
  assert.equal(Reflect.set(result.draft.heraldry, "charge", "crown"), false);
  assert.equal(Reflect.set(result.draft.heraldry.field, "0", "azure"), false);
});

test("malformed design edits leave the prior selection intact", () => {
  const selected = chooseInheritedBannerPreset(createInheritedBannerDraft(), "ancestral-oak");
  assert.equal(selected.ok, true);
  const snapshot = JSON.stringify(selected.draft);
  for (const proposed of [null, [], {}, { ...defaultHeraldry("aethelgard"), charge: "unapproved-symbol" }, { ...defaultHeraldry("aethelgard"), field: ["or"] }]) {
    const result = chooseInheritedBannerDesign(selected.draft, proposed);
    assert.equal(result.ok, false);
    assert.equal(result.draft, selected.draft);
    assert.equal(JSON.stringify(selected.draft), snapshot);
  }
  const unavailable = chooseInheritedBannerPreset(selected.draft, "eclipse-vigil");
  assert.equal(unavailable.ok, false, "a preset from another kingdom is not presented as an Aethelgard preset");
  assert.equal(unavailable.draft, selected.draft);
});

test("extra design fields cannot rename the inherited house, change its kingdom or introduce house standing", () => {
  const result = chooseInheritedBannerDesign(createInheritedBannerDraft(), {
    ...defaultHeraldry("aethelgard"), houseId: "another-house", name: "Another house", nationId: "solforiz",
    standing: { rank: "great-house", recognition: 999 }, members: [{ name: "Unapproved character" }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.draft.houseId, EALDHOLT_HOUSE.id);
  assert.deepEqual(Object.keys(result.draft).sort(), ["heraldry", "houseId"]);
  assert.deepEqual(Object.keys(result.draft.heraldry ?? {}).sort(), ["charge", "chargeTincture", "division", "field", "ordinary", "ordinaryTincture"]);
  assert.equal(EALDHOLT_HOUSE.name, "House Ealdholt");
  assert.equal(EALDHOLT_HOUSE.nationId, "aethelgard");
});

test("explicit preset choice never changes preset content or an existing saved house", () => {
  const founded = reduceLegacy(createLegacyState(), {
    type: "found-banner", name: "House Ashwell", nationId: "korvenia", heraldry: defaultHeraldry("korvenia"),
    at: "2026-11-05T12:00:00.000Z", seed: 11,
  });
  assert.equal(founded.error, null);
  const oldSave = JSON.stringify(founded.state);
  const preset = findHeraldryPreset("aethelgard", "cairn-blade");
  assert.ok(preset);
  const presetBefore = JSON.stringify(preset);
  const result = chooseInheritedBannerPreset(createInheritedBannerDraft(), "cairn-blade");
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(preset), presetBefore);
  assert.equal(JSON.stringify(founded.state), oldSave);
  assert.equal(founded.state.banner?.nationId, "korvenia");
  assert.notEqual(result.draft.heraldry, preset.heraldry);
});

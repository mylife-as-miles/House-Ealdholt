import { test } from "node:test";
import assert from "node:assert/strict";
import { SPELLBOOK, SPELL_IDS, chooseSpell, type SpellId } from "../../web/src/scene/vfx/spells/spellbook";

const armies = ["empire", "kwind", "sun", "ivory"] as const;

test("every kingdom's Bishop and Queen have a page, and nobody else casts", () => {
  for (const army of armies) {
    assert.deepEqual(Object.keys(SPELLBOOK[army]).sort(), ["b", "q"], army);
    for (const page of Object.values(SPELLBOOK[army])) {
      assert.ok(page.length >= 1);
      for (const choice of page) { assert.ok(SPELL_IDS.includes(choice.id)); assert.ok(choice.weight > 0); }
      assert.equal(new Set(page.map((choice) => choice.id)).size, page.length, "a page lists a spell once");
    }
    for (const kind of ["p", "n", "r", "k"] as const) assert.equal(chooseSpell(army, kind, 7), null);
  }
});

test("every spell the book names is on somebody's page", () => {
  const used = new Set(armies.flatMap((army) => Object.values(SPELLBOOK[army]).flatMap((page) => page.map((choice) => choice.id))));
  assert.deepEqual([...used].sort(), [...SPELL_IDS].sort());
});

test("the same seed draws the same spell, and different seeds cover the page by its weights", () => {
  assert.equal(chooseSpell("empire", "b", 1234), chooseSpell("empire", "b", 1234));
  const counts = new Map<SpellId, number>();
  for (let seed = 0; seed < 4000; seed += 1) { const id = chooseSpell("empire", "b", seed)!; counts.set(id, (counts.get(id) ?? 0) + 1); }
  assert.deepEqual([...counts.keys()].sort(), ["lance", "unmaking"]);
  const share = counts.get("lance")! / 4000;
  assert.ok(Math.abs(share - 0.6) < 0.04, `lance is drawn three times in five (${share.toFixed(3)})`);
});

test("a kingdom does not cast the same spell twice running while its page offers another", () => {
  for (let seed = 0; seed < 500; seed += 1) {
    assert.notEqual(chooseSpell("empire", "q", seed, { last: "lance" }), "lance");
    assert.notEqual(chooseSpell("kwind", "b", seed, { last: "storm-bolt" }), "storm-bolt");
    assert.notEqual(chooseSpell("ivory", "q", seed, { last: "frost-line" }), "frost-line", "Aethelgard has a second spell now");
  }
  assert.equal(chooseSpell("ivory", "b", 3, { last: "frost-line", canMake: (id) => id === "frost-line" }), "frost-line", "a page with one spell built repeats it");
});

test("a spell that is not built yet is never drawn, and a page with nothing built gives the plain bolt", () => {
  const built = new Set<SpellId>(["unmaking"]);
  for (let seed = 0; seed < 200; seed += 1) assert.equal(chooseSpell("empire", "q", seed, { canMake: (id) => built.has(id) }), "unmaking");
  assert.equal(chooseSpell("sun", "b", 5, { canMake: () => false }), null);
  assert.equal(chooseSpell("empire", "q", 5, { last: "unmaking", canMake: (id) => built.has(id) }), "unmaking");
});

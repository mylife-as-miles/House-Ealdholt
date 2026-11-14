import assert from "node:assert/strict";
import test from "node:test";
import { ealdholtVisitMode } from "../../../shared/legacy/aethelgard/visit-route";
const mode = (search: string, development: boolean) => ealdholtVisitMode(development, search);

test("private Ealdholt routes cannot replace the production Legacy screen", () => {
  for (const query of ["", "?ealdholt-preview=1", "?ealdholt-house=1", "?ealdholt-house=1&ealdholt-preview=1"]) {
    assert.equal(mode(query, false), null, query);
  }
});

test("development inherited entry is explicit, while the original preview wins both flag orders", () => {
  assert.equal(mode("", true), null);
  assert.equal(mode("?ealdholt-preview=1", true), "preview");
  assert.equal(mode("?ealdholt-house=1", true), "inherited");
  assert.equal(mode("?ealdholt-house=1&ealdholt-preview=1", true), "preview");
  assert.equal(mode("?ealdholt-preview=1&ealdholt-house=1", true), "preview");
  assert.equal(mode("?ealdholt-preview=0&ealdholt-house=1", true), "inherited");
  for (const query of ["?ealdholt-house", "?ealdholt-house=true", "?ealdholt-house=0", "?ealdholt-preview=0"]) {
    assert.equal(mode(query, true), null, query);
  }
});

test("a release build that bundled the village opens it inherited; without it, the Legacy screen stays", () => {
  for (const query of ["", "?ealdholt-preview=1", "?ealdholt-house=0", "?legacy=fresh"]) {
    assert.equal(ealdholtVisitMode(false, query, false, true), "inherited", query);
    assert.equal(ealdholtVisitMode(false, query, false, false), null, query);
  }
});

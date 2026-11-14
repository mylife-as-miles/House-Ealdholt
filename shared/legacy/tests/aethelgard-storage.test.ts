import assert from "node:assert/strict";
import test from "node:test";
import {
  AETHELGARD_STORAGE_KEY, PRE_AETHELGARD_ARCHIVE_KEY, archivePreviousLegacySave,
  createAethelgardStorageAdapter, loadAethelgardSave,
} from "../aethelgard/storage";
import { defaultHeraldry } from "../content/heraldry";
import { LEGACY_STORAGE_KEY, clearLegacy, saveLegacy, type LegacyStorageLike } from "../domain/persistence";
import { reduceLegacy } from "../domain/reducer";
import { createLegacyState } from "../domain/state";
import type { NationId } from "../types";

class MemoryStorage implements LegacyStorageLike {
  readonly items = new Map<string, string>();
  readonly writes: string[] = [];
  failWrites = false;
  failReads = false;
  ignoreWrites = false;
  getItem(key: string): string | null {
    if (this.failReads) throw new Error("blocked");
    return this.items.get(key) ?? null;
  }
  setItem(key: string, raw: string): void {
    this.writes.push(`set:${key}`);
    if (this.failWrites) throw new Error("quota");
    if (!this.ignoreWrites) this.items.set(key, raw);
  }
  removeItem(key: string): void { this.writes.push(`remove:${key}`); this.items.delete(key); }
}

// Existing schema fixtures exercise the storage boundary only. They do not define
// the inherited house or authorize founding-based replacement onboarding.
function house(nationId: NationId) {
  const result = reduceLegacy(createLegacyState(), {
    type: "found-banner", name: "House Ashwell", nationId, heraldry: defaultHeraldry(nationId),
    at: "2026-11-05T12:00:00.000Z", seed: 11,
  });
  assert.equal(result.error, null);
  return result.state;
}

test("archiving preserves the raw previous save including whitespace, and repeated visits do not rewrite it", () => {
  for (const nation of ["korvenia", "solforiz", "kwind-09", "aethelgard"] as const) {
    const storage = new MemoryStorage();
    const raw = `\n${JSON.stringify(house(nation), null, 2)}\n`;
    storage.items.set(LEGACY_STORAGE_KEY, raw);
    assert.equal(archivePreviousLegacySave(storage).ok, true);
    const again = archivePreviousLegacySave(storage);
    assert.equal(again.ok && again.status, "already-archived");
    assert.equal(storage.items.get(LEGACY_STORAGE_KEY), raw);
    assert.equal(storage.items.get(PRE_AETHELGARD_ARCHIVE_KEY), raw);
    assert.deepEqual(storage.writes, [`set:${PRE_AETHELGARD_ARCHIVE_KEY}`]);
  }
});

test("an existing differing archive cannot be overwritten or used to discard the current predecessor", () => {
  const storage = new MemoryStorage();
  const raw = JSON.stringify(house("korvenia"));
  storage.items.set(LEGACY_STORAGE_KEY, raw);
  storage.items.set(PRE_AETHELGARD_ARCHIVE_KEY, "older raw data");
  const result = archivePreviousLegacySave(storage);
  assert.equal(!result.ok && result.reason, "archive-conflict");
  assert.equal(saveLegacy(createAethelgardStorageAdapter(storage), house("aethelgard")).ok, false);
  assert.equal(storage.items.get(LEGACY_STORAGE_KEY), raw);
  assert.equal(storage.items.get(PRE_AETHELGARD_ARCHIVE_KEY), "older raw data");
  assert.equal(storage.items.has(AETHELGARD_STORAGE_KEY), false);
  assert.deepEqual(storage.writes, []);
});

test("the separate slot saves and resets without changing the predecessor or its archive", () => {
  const storage = new MemoryStorage();
  const original = JSON.stringify(house("korvenia"));
  const candidate = house("aethelgard");
  storage.items.set(LEGACY_STORAGE_KEY, original);
  const slot = createAethelgardStorageAdapter(storage);
  assert.deepEqual(storage.writes, [], "adapter construction is inert");
  assert.equal(loadAethelgardSave(storage).status, "empty");
  assert.equal(saveLegacy(slot, candidate).ok, true);
  const loaded = loadAethelgardSave(storage);
  assert.equal(loaded.status, "loaded");
  assert.deepEqual(loaded.status === "loaded" && loaded.state, candidate);
  assert.equal(clearLegacy(slot).ok, true);
  assert.equal(storage.items.has(AETHELGARD_STORAGE_KEY), false);
  assert.equal(storage.items.get(LEGACY_STORAGE_KEY), original);
  assert.equal(storage.items.get(PRE_AETHELGARD_ARCHIVE_KEY), original);
});

test("corrupt, future and preview predecessors are preserved verbatim but cannot silently start a replacement", () => {
  const valid = house("solforiz");
  for (const raw of ["{not json", JSON.stringify({ ...valid, schemaVersion: 99 }), JSON.stringify({ ...valid, mode: "preview", previewId: "test" })]) {
    const storage = new MemoryStorage();
    storage.items.set(LEGACY_STORAGE_KEY, raw);
    const result = archivePreviousLegacySave(storage);
    assert.equal(result.ok && result.previous.kind, "recovery-required");
    assert.equal(saveLegacy(createAethelgardStorageAdapter(storage), house("aethelgard")).ok, false);
    assert.equal(storage.items.has(AETHELGARD_STORAGE_KEY), false);
    assert.equal(storage.items.get(LEGACY_STORAGE_KEY), raw);
    assert.equal(storage.items.get(PRE_AETHELGARD_ARCHIVE_KEY), raw);
  }
});

test("storage read, quota and failed readback preserve the original and block replacement writes", () => {
  for (const failure of ["failReads", "failWrites", "ignoreWrites"] as const) {
    const storage = new MemoryStorage();
    const original = JSON.stringify(house("korvenia"));
    storage.items.set(LEGACY_STORAGE_KEY, original);
    storage[failure] = true;
    const result = archivePreviousLegacySave(storage);
    assert.equal(result.ok, false);
    assert.equal(saveLegacy(createAethelgardStorageAdapter(storage), house("aethelgard")).ok, false);
    assert.equal(storage.items.get(LEGACY_STORAGE_KEY), original);
    assert.equal(storage.items.has(AETHELGARD_STORAGE_KEY), false);
  }
});

test("a changed predecessor is not converted and never overwrites an earlier snapshot", () => {
  const original = JSON.stringify(house("korvenia"));
  const changed = `${original}\n`;
  const storage = new MemoryStorage();
  storage.items.set(LEGACY_STORAGE_KEY, original);
  let reads = 0;
  const baseRead = storage.getItem.bind(storage);
  storage.getItem = (key) => {
    if (key === LEGACY_STORAGE_KEY && ++reads === 2) storage.items.set(key, changed);
    return baseRead(key);
  };
  const result = archivePreviousLegacySave(storage);
  assert.equal(!result.ok && result.reason, "source-changed");
  assert.equal(storage.items.get(LEGACY_STORAGE_KEY), changed);
  assert.deepEqual(storage.writes, []);
});

test("slot writes reject other kingdoms, empty states and unknown keys before touching storage", () => {
  const storage = new MemoryStorage();
  const slot = createAethelgardStorageAdapter(storage);
  assert.equal(saveLegacy(slot, house("korvenia")).ok, false);
  assert.equal(saveLegacy(slot, createLegacyState()).ok, false);
  for (const method of [() => slot.getItem(PRE_AETHELGARD_ARCHIVE_KEY), () => slot.setItem(PRE_AETHELGARD_ARCHIVE_KEY, "data"), () => slot.removeItem(PRE_AETHELGARD_ARCHIVE_KEY)]) {
    assert.throws(method, /only the Legacy save key/);
  }
  assert.deepEqual(storage.writes, []);
});

test("malformed incoming writes cannot create an archive or change any slot", () => {
  const storage = new MemoryStorage();
  const original = JSON.stringify(house("korvenia"));
  storage.items.set(LEGACY_STORAGE_KEY, original);
  const slot = createAethelgardStorageAdapter(storage);
  const valid = house("aethelgard");
  for (const raw of ["{broken", JSON.stringify({ ...valid, schemaVersion: 99 }), JSON.stringify({ ...valid, mode: "preview", previewId: "test" })]) {
    assert.throws(() => slot.setItem(LEGACY_STORAGE_KEY, raw));
  }
  assert.equal(storage.items.get(LEGACY_STORAGE_KEY), original);
  assert.equal(storage.items.has(AETHELGARD_STORAGE_KEY), false);
  assert.equal(storage.items.has(PRE_AETHELGARD_ARCHIVE_KEY), false);
  assert.deepEqual(storage.writes, []);
});

test("a candidate write failure retains the previous candidate, original and verified archive", () => {
  const storage = new MemoryStorage();
  const original = JSON.stringify(house("korvenia"));
  const previousCandidate = JSON.stringify(house("aethelgard"));
  storage.items.set(LEGACY_STORAGE_KEY, original);
  storage.items.set(AETHELGARD_STORAGE_KEY, previousCandidate);
  const baseWrite = storage.setItem.bind(storage);
  storage.setItem = (key, raw) => {
    if (key === AETHELGARD_STORAGE_KEY) throw new Error("candidate quota");
    baseWrite(key, raw);
  };
  assert.equal(saveLegacy(createAethelgardStorageAdapter(storage), house("aethelgard")).ok, false);
  assert.equal(storage.items.get(LEGACY_STORAGE_KEY), original);
  assert.equal(storage.items.get(PRE_AETHELGARD_ARCHIVE_KEY), original);
  assert.equal(storage.items.get(AETHELGARD_STORAGE_KEY), previousCandidate);
});

test("the replacement reader rejects foreign, corrupt and future slot data without modifying any slot", () => {
  for (const raw of [JSON.stringify(house("solforiz")), "{broken", JSON.stringify({ schemaVersion: 99 })]) {
    const storage = new MemoryStorage();
    storage.items.set(AETHELGARD_STORAGE_KEY, raw);
    assert.equal(loadAethelgardSave(storage).status, "invalid");
    assert.equal(storage.items.get(AETHELGARD_STORAGE_KEY), raw);
    assert.deepEqual(storage.writes, []);
  }
});

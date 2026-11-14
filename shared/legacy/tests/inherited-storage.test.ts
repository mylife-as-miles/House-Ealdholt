import assert from "node:assert/strict";
import test from "node:test";
import {
  createInheritedSessionStore, INHERITED_PREDECESSOR_ARCHIVE_PREFIX,
  INHERITED_SESSION_STORAGE_KEY, type SerializeInheritedOperation,
} from "../aethelgard/inherited-storage";
import {
  createInheritedSession, type InheritedEntry, type InheritedStoryChoice,
} from "../aethelgard/inherited-session";
import { chooseInheritedBannerDesign, createInheritedBannerDraft } from "../aethelgard/entry-draft";
import { EALDHOLT_HOUSE } from "../aethelgard/house";
import { AETHELGARD_STORAGE_KEY, PRE_AETHELGARD_ARCHIVE_KEY } from "../aethelgard/storage";
import { LEGACY_STORAGE_KEY, type LegacyStorageLike } from "../domain/persistence";
import { createLegacyState } from "../domain/state";

const ENTRY_AT = "2026-11-06T10:00:00.000Z";
const CHOICE_AT = "2026-11-06T10:01:00.000Z";
const LATER_AT = "2026-11-06T10:02:00.000Z";

class MemoryStorage implements LegacyStorageLike {
  readonly items = new Map<string, string>();
  readonly writes: { key: string; raw: string }[] = [];
  readonly reads: string[] = [];
  failReads = new Set<string>();
  failWrites = new Set<string>();
  ignoreWrites = new Set<string>();
  getItem(key: string): string | null {
    this.reads.push(key);
    if (this.failReads.has(key)) throw new Error("blocked");
    return this.items.get(key) ?? null;
  }
  setItem(key: string, raw: string): void {
    this.writes.push({ key, raw });
    if (this.failWrites.has(key)) throw new Error("quota");
    if (!this.ignoreWrites.has(key)) this.items.set(key, raw);
  }
  removeItem(): void { assert.fail("Inherited storage must never remove any key."); }
}

/** Test queue shared by store instances. It models operation ownership within
 * one process; it does not claim to supply a browser cross-tab lock. */
function serialization(): SerializeInheritedOperation {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => T): Promise<T> => {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  };
}

// Only test IDs and facts, with no character names, roles or invented history.
function entry(): InheritedEntry {
  const chosen = chooseInheritedBannerDesign(createInheritedBannerDraft(), {
    division: "per-pale", field: ["azure", "argent"], ordinary: "none",
    ordinaryTincture: "or", charge: "key", chargeTincture: "sable",
  });
  assert.ok(chosen.ok);
  return {
    type: "enter-inherited-house", origin: "inherited", houseId: EALDHOLT_HOUSE.id,
    nationId: EALDHOLT_HOUSE.nationId, bannerDraft: chosen.draft, bannerConfirmed: true,
    at: ENTRY_AT,
    cast: [{ id: "test-person-a", relationshipFacts: [{ id: "test-relation-a", value: false }] }],
    storyFacts: [{ id: "test-story-a", value: false }],
  };
}

function choice(overrides: Partial<InheritedStoryChoice> = {}): InheritedStoryChoice {
  return {
    type: "story-choice", choiceId: "test-decision-a", optionId: "test-option-a", at: CHOICE_AT,
    personIds: ["test-person-a"],
    relationshipEffects: [{ personId: "test-person-a", factId: "test-relation-a", value: true }],
    storyEffects: [{ factId: "test-story-a", value: true }],
    ...overrides,
  };
}

function sessionRaw(): string {
  const created = createInheritedSession(entry());
  assert.ok(created.ok);
  return JSON.stringify(created.session);
}

function legacyRaw(): string {
  // An existing-schema persistence fixture; not an inherited content source.
  return `\n${JSON.stringify(createLegacyState({ at: ENTRY_AT }), null, 2)}\n`;
}

function protectedKeys(storage: MemoryStorage): Map<string, string> {
  storage.items.set(AETHELGARD_STORAGE_KEY, "untouched earlier LegacySave experiment");
  storage.items.set("crownfall.estate.save", "untouched estate data");
  storage.items.set("crownfall.estate.archive", "untouched estate snapshot");
  storage.items.set("unrelated.key", "untouched other data");
  return new Map(storage.items);
}

function assertRetained(storage: MemoryStorage, original: ReadonlyMap<string, string>): void {
  for (const [key, raw] of original) assert.equal(storage.items.get(key), raw, `Retained ${key} verbatim`);
}

test("construction and repeated loads read only the separate namespace and never archive or write", () => {
  const storage = new MemoryStorage();
  storage.items.set(LEGACY_STORAGE_KEY, "{retired-corrupt");
  const original = protectedKeys(storage);
  const store = createInheritedSessionStore(storage, serialization());
  assert.deepEqual(storage.reads, []);
  assert.deepEqual(store.load(), { status: "empty" });
  assert.deepEqual(store.load(), { status: "empty" });
  assert.deepEqual(storage.reads, [INHERITED_SESSION_STORAGE_KEY, INHERITED_SESSION_STORAGE_KEY]);
  assert.deepEqual(storage.writes, []);
  assert.deepEqual(storage.items, original);
  assert.notEqual(INHERITED_SESSION_STORAGE_KEY, AETHELGARD_STORAGE_KEY);
});

test("operation serialization is mandatory and its rejection has no storage effects", async () => {
  const storage = new MemoryStorage();
  assert.throws(() => createInheritedSessionStore(storage, undefined as unknown as SerializeInheritedOperation), /serialization/);
  assert.deepEqual(storage.reads, []);
  const rejected: SerializeInheritedOperation = async () => { throw new Error("lock unavailable"); };
  const store = createInheritedSessionStore(storage, rejected);
  assert.equal((await store.enter(entry())).ok, false);
  assert.equal((await store.choose(choice())).ok, false);
  assert.deepEqual(storage.reads, []);
  assert.deepEqual(storage.writes, []);
});

test("explicit confirmed entry archives exact predecessor bytes and writes a separate resumable session", async () => {
  const storage = new MemoryStorage();
  const raw = legacyRaw();
  storage.items.set(LEGACY_STORAGE_KEY, raw);
  const original = protectedKeys(storage);
  const store = createInheritedSessionStore(storage, serialization());
  const result = await store.enter(entry());
  assert.ok(result.ok && result.status === "entered");
  assert.deepEqual(result.predecessor, { status: "archived", key: PRE_AETHELGARD_ARCHIVE_KEY, previous: "valid" });
  assert.equal(storage.items.get(PRE_AETHELGARD_ARCHIVE_KEY), raw);
  assertRetained(storage, original);
  assert.deepEqual(storage.writes.map(({ key }) => key), [PRE_AETHELGARD_ARCHIVE_KEY, INHERITED_SESSION_STORAGE_KEY]);
  const loaded = createInheritedSessionStore(storage, serialization()).load();
  assert.ok(loaded.status === "loaded");
  assert.deepEqual(loaded.session, result.session);
  assert.equal(Object.isFrozen(loaded.session.cast[0].relationshipFacts), true);
  assert.equal(loaded.session.house.name, EALDHOLT_HOUSE.name);
  assert.equal(loaded.session.entry.type, "inherited-entry");
  for (const key of ["standing", "chess", "members", "chronicle", "seed", "foundedAt"]) assert.equal(key in loaded.session, false);
});

test("entry without a predecessor writes only the new namespace, and identical entry retry writes nothing", async () => {
  const storage = new MemoryStorage();
  const original = protectedKeys(storage);
  const store = createInheritedSessionStore(storage, serialization());
  const first = await store.enter(entry());
  assert.ok(first.ok && first.status === "entered");
  assert.deepEqual(first.predecessor, { status: "no-previous-save" });
  assert.equal(storage.items.has(PRE_AETHELGARD_ARCHIVE_KEY), false);
  const again = await store.enter(entry());
  assert.ok(again.ok && again.status === "already-entered");
  assert.deepEqual(storage.writes.map(({ key }) => key), [INHERITED_SESSION_STORAGE_KEY]);
  assertRetained(storage, original);
});

test("existing matching fixed archives are reused without rewriting them", async () => {
  const storage = new MemoryStorage();
  storage.items.set(LEGACY_STORAGE_KEY, legacyRaw());
  storage.items.set(PRE_AETHELGARD_ARCHIVE_KEY, legacyRaw());
  const original = protectedKeys(storage);
  const result = await createInheritedSessionStore(storage, serialization()).enter(entry());
  assert.ok(result.ok && result.status === "entered");
  assert.deepEqual(result.predecessor, { status: "already-archived", key: PRE_AETHELGARD_ARCHIVE_KEY, previous: "valid" });
  assertRetained(storage, original);
  assert.deepEqual(storage.writes.map(({ key }) => key), [INHERITED_SESSION_STORAGE_KEY]);
});

test("a differing fixed archive and all older snapshots are retained while current raw data is appended", async () => {
  const storage = new MemoryStorage();
  const raw = legacyRaw();
  storage.items.set(LEGACY_STORAGE_KEY, raw);
  storage.items.set(PRE_AETHELGARD_ARCHIVE_KEY, "older fixed snapshot\n");
  storage.items.set(`${INHERITED_PREDECESSOR_ARCHIVE_PREFIX}1`, "older appended snapshot\n");
  const original = protectedKeys(storage);
  const result = await createInheritedSessionStore(storage, serialization()).enter(entry());
  assert.ok(result.ok && result.status === "entered");
  const key = `${INHERITED_PREDECESSOR_ARCHIVE_PREFIX}2`;
  assert.deepEqual(result.predecessor, { status: "archived", key, previous: "valid" });
  assert.equal(storage.items.get(key), raw);
  assertRetained(storage, original);
  assert.deepEqual(storage.writes.map(({ key }) => key), [key, INHERITED_SESSION_STORAGE_KEY]);
});

test("a matching appended snapshot is verified and reused, including after a partial quota failure", async () => {
  const storage = new MemoryStorage();
  storage.items.set(LEGACY_STORAGE_KEY, legacyRaw());
  storage.items.set(PRE_AETHELGARD_ARCHIVE_KEY, "older fixed snapshot");
  storage.failWrites.add(INHERITED_SESSION_STORAGE_KEY);
  const store = createInheritedSessionStore(storage, serialization());
  const failed = await store.enter(entry());
  assert.ok(!failed.ok && failed.reason === "unavailable");
  assert.match(failed.error, /archive may remain/);
  const key = `${INHERITED_PREDECESSOR_ARCHIVE_PREFIX}1`;
  assert.equal(storage.items.get(key), legacyRaw());
  assert.equal(storage.items.has(INHERITED_SESSION_STORAGE_KEY), false);
  storage.failWrites.clear();
  const result = await store.enter(entry());
  assert.ok(result.ok && result.status === "entered");
  assert.deepEqual(result.predecessor, { status: "already-archived", key, previous: "valid" });
  assert.equal(storage.writes.filter((write) => write.key === key).length, 1);
  assert.equal(storage.items.get(PRE_AETHELGARD_ARCHIVE_KEY), "older fixed snapshot");
  assert.equal(storage.items.get(LEGACY_STORAGE_KEY), legacyRaw());
});

test("corrupt, future and preview predecessors need no repair once their exact raw bytes are verified", async () => {
  for (const [raw, reason] of [
    ["\n{not-json\n", "corrupt"],
    [JSON.stringify({ schemaVersion: 99, untouched: "future data" }), "future-version"],
    [JSON.stringify({ ...createLegacyState({ at: ENTRY_AT }), mode: "preview", previewId: "test-preview" }), "preview"],
  ] as const) for (const conflictingArchive of [false, true]) {
    const storage = new MemoryStorage();
    storage.items.set(LEGACY_STORAGE_KEY, raw);
    if (conflictingArchive) storage.items.set(PRE_AETHELGARD_ARCHIVE_KEY, "earlier data");
    const original = protectedKeys(storage);
    const result = await createInheritedSessionStore(storage, serialization()).enter(entry());
    assert.ok(result.ok && result.status === "entered");
    assert.ok(result.predecessor.status !== "no-previous-save" && result.predecessor.previous === "raw-only");
    assert.equal(result.predecessor.reason, reason);
    assert.equal(storage.items.get(result.predecessor.key), raw);
    assertRetained(storage, original);
    assert.equal(result.session.cast.length, entry().cast.length, "No predecessor state supplies inherited content");
  }
});

test("invalid, founding, renamed and unconfirmed entry attempts do not even read storage", async () => {
  const storage = new MemoryStorage();
  storage.items.set(LEGACY_STORAGE_KEY, legacyRaw());
  const original = protectedKeys(storage);
  const store = createInheritedSessionStore(storage, serialization());
  for (const candidate of [
    null, createLegacyState(), { ...entry(), type: "found-banner" },
    { ...entry(), origin: "founded" }, { ...entry(), houseId: "new-house" },
    { ...entry(), nationId: "korvenia" }, { ...entry(), name: "Renamed house" },
    { ...entry(), bannerConfirmed: false }, { ...entry(), bannerDraft: createInheritedBannerDraft() },
    { ...entry(), cast: [] }, { ...entry(), standing: { rank: "great-house" } },
  ]) assert.equal((await store.enter(candidate)).ok, false);
  assert.deepEqual(storage.items, original);
  assert.deepEqual(storage.reads, []);
  assert.deepEqual(storage.writes, []);
});

test("future, corrupt, wrong-house and LegacySave replacement data are refused without overwrite or archive writes", async () => {
  const initial = JSON.parse(sessionRaw());
  for (const raw of [
    "{broken", JSON.stringify({ ...initial, schemaVersion: 99 }),
    JSON.stringify({ ...initial, house: { ...initial.house, id: "new-house" } }),
    JSON.stringify({ ...initial, house: { ...initial.house, origin: "founded" } }),
    JSON.stringify({ ...initial, kind: "new-house" }), legacyRaw(),
  ]) {
    const storage = new MemoryStorage();
    storage.items.set(INHERITED_SESSION_STORAGE_KEY, raw);
    storage.items.set(LEGACY_STORAGE_KEY, legacyRaw());
    const original = protectedKeys(storage);
    const store = createInheritedSessionStore(storage, serialization());
    assert.equal(store.load().status, "invalid");
    assert.equal((await store.enter(entry())).ok, false);
    assert.equal((await store.choose(choice())).ok, false);
    assert.deepEqual(storage.items, original);
    assert.deepEqual(storage.writes, []);
  }
});

test("an occupied valid inherited session cannot be replaced by another entry or reset after story progress", async () => {
  const storage = new MemoryStorage();
  const store = createInheritedSessionStore(storage, serialization());
  assert.equal((await store.enter(entry())).ok, true);
  const different = { ...entry(), at: LATER_AT };
  const conflict = await store.enter(different);
  assert.ok(!conflict.ok && conflict.reason === "conflict");
  assert.equal((await store.choose(choice())).ok, true);
  const progressed = storage.items.get(INHERITED_SESSION_STORAGE_KEY);
  const reset = await store.enter(entry());
  assert.ok(!reset.ok && reset.reason === "conflict");
  assert.equal(storage.items.get(INHERITED_SESSION_STORAGE_KEY), progressed);
  assert.equal(storage.writes.length, 2);
});

test("story choices resume current data, change only registered facts and never write predecessor or archives", async () => {
  const storage = new MemoryStorage();
  storage.items.set(LEGACY_STORAGE_KEY, legacyRaw());
  const store = createInheritedSessionStore(storage, serialization());
  assert.equal((await store.enter(entry())).ok, true);
  const original = new Map(storage.items);
  storage.writes.length = 0;
  const applied = await store.choose(choice());
  assert.ok(applied.ok && applied.status === "applied");
  assert.equal(applied.session.cast[0].relationshipFacts[0].value, true);
  assert.equal(applied.session.storyFacts[0].value, true);
  assert.equal(applied.session.choices.length, 1);
  const old = JSON.parse(original.get(INHERITED_SESSION_STORAGE_KEY)!);
  assert.deepEqual(applied.session.house, old.house);
  assert.deepEqual(applied.session.banner, old.banner);
  assert.deepEqual(applied.session.entry, old.entry);
  assert.deepEqual(applied.session.cast.map((person) => person.id), old.cast.map((person: { id: string }) => person.id));
  original.delete(INHERITED_SESSION_STORAGE_KEY);
  assertRetained(storage, original);
  assert.deepEqual(storage.writes.map(({ key }) => key), [INHERITED_SESSION_STORAGE_KEY]);
  assert.equal(createInheritedSessionStore(storage, serialization()).load().status, "loaded");
});

test("same-choice retry after later progress writes nothing and cannot reapply old effects", async () => {
  const storage = new MemoryStorage();
  const store = createInheritedSessionStore(storage, serialization());
  await store.enter(entry());
  await store.choose(choice());
  await store.choose(choice({ choiceId: "test-decision-b", at: LATER_AT, relationshipEffects: [], storyEffects: [{ factId: "test-story-a", value: false }] }));
  const previousRaw = storage.items.get(INHERITED_SESSION_STORAGE_KEY);
  storage.writes.length = 0;
  const again = await store.choose(choice({ at: LATER_AT }));
  assert.ok(again.ok && again.status === "already-applied");
  assert.equal(again.session.storyFacts[0].value, false);
  assert.equal(again.session.choices.length, 2);
  assert.equal(storage.items.get(INHERITED_SESSION_STORAGE_KEY), previousRaw);
  assert.deepEqual(storage.writes, []);
  const changed = await store.choose(choice({ optionId: "test-option-b" }));
  assert.ok(!changed.ok && changed.reason === "invalid-choice");
  assert.deepEqual(storage.writes, []);
});

test("unknown people, facts, progression fields and choices before entry cannot write", async () => {
  const storage = new MemoryStorage();
  const store = createInheritedSessionStore(storage, serialization());
  const absent = await store.choose(choice());
  assert.ok(!absent.ok && absent.reason === "conflict");
  assert.deepEqual(storage.writes, []);
  await store.enter(entry());
  const original = new Map(storage.items);
  storage.writes.length = 0;
  for (const candidate of [
    { ...choice(), personIds: ["new-person"] },
    { ...choice(), relationshipEffects: [{ personId: "test-person-a", factId: "new-fact", value: true }] },
    { ...choice(), storyEffects: [{ factId: "new-story", value: true }] },
    { ...choice(), houseId: "new-house" }, { ...choice(), standing: { rank: "great-house" } },
    { ...choice(), chess: { wins: 1 } }, { ...choice(), type: "record-match" },
  ]) {
    const refused = await store.choose(candidate);
    assert.ok(!refused.ok && refused.reason === "invalid-choice");
  }
  assert.deepEqual(storage.items, original);
  assert.deepEqual(storage.writes, []);
});

test("unavailable reads and archive quota failures block entry and retain all original data", async () => {
  for (const blocked of [INHERITED_SESSION_STORAGE_KEY, LEGACY_STORAGE_KEY, PRE_AETHELGARD_ARCHIVE_KEY]) {
    const storage = new MemoryStorage();
    storage.items.set(LEGACY_STORAGE_KEY, legacyRaw());
    const original = protectedKeys(storage);
    storage.failReads.add(blocked);
    const store = createInheritedSessionStore(storage, serialization());
    if (blocked === INHERITED_SESSION_STORAGE_KEY) assert.equal(store.load().status, "invalid");
    const result = await store.enter(entry());
    assert.ok(!result.ok && result.reason === "unavailable");
    assert.deepEqual(storage.items, original);
    assert.deepEqual(storage.writes, []);
  }
  for (const conflicting of [false, true]) {
    const storage = new MemoryStorage();
    storage.items.set(LEGACY_STORAGE_KEY, legacyRaw());
    if (conflicting) storage.items.set(PRE_AETHELGARD_ARCHIVE_KEY, "older snapshot");
    const original = protectedKeys(storage);
    const archiveKey = conflicting ? `${INHERITED_PREDECESSOR_ARCHIVE_PREFIX}1` : PRE_AETHELGARD_ARCHIVE_KEY;
    storage.failWrites.add(archiveKey);
    const result = await createInheritedSessionStore(storage, serialization()).enter(entry());
    assert.ok(!result.ok && result.reason === "unavailable");
    assert.deepEqual(storage.items, original);
    assert.deepEqual(storage.writes.map(({ key }) => key), [archiveKey]);
  }
});

test("failed archive byte verification blocks entry for fixed and appended snapshots", async () => {
  for (const conflicting of [false, true]) {
    const storage = new MemoryStorage();
    storage.items.set(LEGACY_STORAGE_KEY, legacyRaw());
    if (conflicting) storage.items.set(PRE_AETHELGARD_ARCHIVE_KEY, "older snapshot");
    const original = protectedKeys(storage);
    const archiveKey = conflicting ? `${INHERITED_PREDECESSOR_ARCHIVE_PREFIX}1` : PRE_AETHELGARD_ARCHIVE_KEY;
    storage.ignoreWrites.add(archiveKey);
    const result = await createInheritedSessionStore(storage, serialization()).enter(entry());
    assert.ok(!result.ok && result.reason === "verification-failed");
    assert.deepEqual(storage.items, original);
    assert.deepEqual(storage.writes.map(({ key }) => key), [archiveKey]);
  }
});

test("entry slot quota or verification failure reports failure with its verified predecessor archive retained", async () => {
  for (const failure of ["failWrites", "ignoreWrites"] as const) {
    const storage = new MemoryStorage();
    storage.items.set(LEGACY_STORAGE_KEY, legacyRaw());
    const original = protectedKeys(storage);
    storage[failure].add(INHERITED_SESSION_STORAGE_KEY);
    const result = await createInheritedSessionStore(storage, serialization()).enter(entry());
    assert.ok(!result.ok && result.reason === (failure === "failWrites" ? "unavailable" : "verification-failed"));
    assert.equal(storage.items.has(INHERITED_SESSION_STORAGE_KEY), false);
    assert.equal(storage.items.get(PRE_AETHELGARD_ARCHIVE_KEY), legacyRaw());
    assertRetained(storage, original);
    assert.deepEqual(storage.writes.map(({ key }) => key), [PRE_AETHELGARD_ARCHIVE_KEY, INHERITED_SESSION_STORAGE_KEY]);
  }
});

test("choice quota and failed byte verification preserve the last stored session without reporting success", async () => {
  for (const failure of ["failWrites", "ignoreWrites"] as const) {
    const storage = new MemoryStorage();
    const store = createInheritedSessionStore(storage, serialization());
    await store.enter(entry());
    const original = new Map(storage.items);
    storage[failure].add(INHERITED_SESSION_STORAGE_KEY);
    const result = await store.choose(choice());
    assert.ok(!result.ok && result.reason === (failure === "failWrites" ? "unavailable" : "verification-failed"));
    assert.deepEqual(storage.items, original);
    storage[failure].clear();
    assert.equal((await store.choose(choice())).ok, true, "A failed write does not mutate an in-memory stored session");
  }
});

test("unexpected readback bytes are retained after failed verification instead of unsafe rollback", async () => {
  const storage = new MemoryStorage();
  const store = createInheritedSessionStore(storage, serialization());
  await store.enter(entry());
  const baseWrite = storage.setItem.bind(storage);
  storage.setItem = (key, raw) => {
    baseWrite(key, raw);
    if (key === INHERITED_SESSION_STORAGE_KEY) storage.items.set(key, "unexpected competing bytes");
  };
  const result = await store.choose(choice());
  assert.ok(!result.ok && result.reason === "verification-failed");
  assert.equal(storage.items.get(INHERITED_SESSION_STORAGE_KEY), "unexpected competing bytes");
  const writes = storage.writes.length;
  assert.equal(store.load().status, "invalid");
  assert.equal((await store.choose(choice())).ok, false);
  assert.equal((await store.enter(entry())).ok, false);
  assert.equal(storage.writes.length, writes);
});

test("a choice whose write succeeded but readback threw can be retried without another write", async () => {
  const storage = new MemoryStorage();
  const store = createInheritedSessionStore(storage, serialization());
  await store.enter(entry());
  storage.writes.length = 0;
  const baseWrite = storage.setItem.bind(storage);
  const baseRead = storage.getItem.bind(storage);
  let failNextRead = false;
  storage.setItem = (key, raw) => {
    baseWrite(key, raw);
    if (key === INHERITED_SESSION_STORAGE_KEY) failNextRead = true;
  };
  storage.getItem = (key) => {
    if (key === INHERITED_SESSION_STORAGE_KEY && failNextRead) {
      failNextRead = false;
      throw new Error("readback unavailable");
    }
    return baseRead(key);
  };
  const uncertain = await store.choose(choice());
  assert.ok(!uncertain.ok && uncertain.reason === "unavailable");
  const retry = await store.choose(choice({ at: LATER_AT }));
  assert.ok(retry.ok && retry.status === "already-applied");
  assert.equal(retry.session.choices.length, 1);
  assert.equal(storage.writes.length, 1);
});

test("a changing predecessor is detected before archive and before inherited entry, without overwriting snapshots", async () => {
  for (const mutateAt of [2, 3, 4, 5, 6]) {
    const storage = new MemoryStorage();
    const raw = legacyRaw();
    const changed = `${raw}changed`;
    storage.items.set(LEGACY_STORAGE_KEY, raw);
    const baseRead = storage.getItem.bind(storage);
    let sourceReads = 0;
    storage.getItem = (key) => {
      if (key === LEGACY_STORAGE_KEY && ++sourceReads === mutateAt) storage.items.set(key, changed);
      return baseRead(key);
    };
    const result = await createInheritedSessionStore(storage, serialization()).enter(entry());
    assert.ok(!result.ok && result.reason === "source-changed", `Source change on read ${mutateAt}`);
    assert.equal(storage.items.get(LEGACY_STORAGE_KEY), changed);
    assert.equal(storage.items.has(INHERITED_SESSION_STORAGE_KEY), false);
    if (storage.items.has(PRE_AETHELGARD_ARCHIVE_KEY)) {
      assert.equal(storage.items.get(PRE_AETHELGARD_ARCHIVE_KEY), mutateAt === 2 ? changed : raw);
    }
    assert.equal(storage.writes.some(({ key }) => key === INHERITED_SESSION_STORAGE_KEY), false);
  }
});

test("a changing predecessor during append retains every existing archive and refuses entry", async () => {
  const storage = new MemoryStorage();
  const raw = legacyRaw();
  const changed = `${raw}changed`;
  storage.items.set(LEGACY_STORAGE_KEY, raw);
  storage.items.set(PRE_AETHELGARD_ARCHIVE_KEY, "older fixed archive");
  storage.items.set(`${INHERITED_PREDECESSOR_ARCHIVE_PREFIX}1`, "older appended archive");
  const before = new Map(storage.items);
  const baseRead = storage.getItem.bind(storage);
  const appended = `${INHERITED_PREDECESSOR_ARCHIVE_PREFIX}2`;
  storage.getItem = (key) => {
    if (key === appended) storage.items.set(LEGACY_STORAGE_KEY, changed);
    return baseRead(key);
  };
  const result = await createInheritedSessionStore(storage, serialization()).enter(entry());
  assert.ok(!result.ok && result.reason === "source-changed");
  before.delete(LEGACY_STORAGE_KEY);
  assertRetained(storage, before);
  assert.equal(storage.items.get(LEGACY_STORAGE_KEY), changed);
  assert.deepEqual(storage.writes, []);
});

test("an archive changed after preservation is detected before inherited entry", async () => {
  const storage = new MemoryStorage();
  storage.items.set(LEGACY_STORAGE_KEY, legacyRaw());
  const baseRead = storage.getItem.bind(storage);
  let slotReads = 0;
  storage.getItem = (key) => {
    if (key === INHERITED_SESSION_STORAGE_KEY && ++slotReads === 2) storage.items.set(PRE_AETHELGARD_ARCHIVE_KEY, "changed by another writer");
    return baseRead(key);
  };
  const result = await createInheritedSessionStore(storage, serialization()).enter(entry());
  assert.ok(!result.ok && result.reason === "verification-failed");
  assert.equal(storage.items.get(PRE_AETHELGARD_ARCHIVE_KEY), "changed by another writer");
  assert.equal(storage.items.get(LEGACY_STORAGE_KEY), legacyRaw());
  assert.equal(storage.items.has(INHERITED_SESSION_STORAGE_KEY), false);
});

test("a conflicting inherited slot appearing during entry or choice is never overwritten", async () => {
  for (const operation of ["enter", "choose"] as const) {
    const storage = new MemoryStorage();
    if (operation === "choose") storage.items.set(INHERITED_SESSION_STORAGE_KEY, sessionRaw());
    const future = JSON.stringify({ kind: "inherited-aethelgard", schemaVersion: 99, data: "other writer" });
    const baseRead = storage.getItem.bind(storage);
    let slotReads = 0;
    storage.getItem = (key) => {
      if (key === INHERITED_SESSION_STORAGE_KEY && ++slotReads === 2) storage.items.set(key, future);
      return baseRead(key);
    };
    const store = createInheritedSessionStore(storage, serialization());
    const result = operation === "enter" ? await store.enter(entry()) : await store.choose(choice());
    assert.ok(!result.ok && result.reason === "conflict");
    assert.equal(storage.items.get(INHERITED_SESSION_STORAGE_KEY), future);
    assert.deepEqual(storage.writes, []);
  }
});

test("an appended archive slot acquired by another writer is never overwritten", async () => {
  const storage = new MemoryStorage();
  storage.items.set(LEGACY_STORAGE_KEY, legacyRaw());
  storage.items.set(PRE_AETHELGARD_ARCHIVE_KEY, "older fixed snapshot");
  const archiveKey = `${INHERITED_PREDECESSOR_ARCHIVE_PREFIX}1`;
  const baseRead = storage.getItem.bind(storage);
  let archiveReads = 0;
  storage.getItem = (key) => {
    if (key === archiveKey && ++archiveReads === 2) storage.items.set(key, "other writer snapshot");
    return baseRead(key);
  };
  const result = await createInheritedSessionStore(storage, serialization()).enter(entry());
  assert.ok(!result.ok && result.reason === "conflict");
  assert.equal(storage.items.get(archiveKey), "other writer snapshot");
  assert.equal(storage.items.get(LEGACY_STORAGE_KEY), legacyRaw());
  assert.equal(storage.items.has(INHERITED_SESSION_STORAGE_KEY), false);
  assert.deepEqual(storage.writes, []);
});

test("a full append-only archive refuses entry without replacing any snapshot", async () => {
  const storage = new MemoryStorage();
  storage.items.set(LEGACY_STORAGE_KEY, legacyRaw());
  storage.items.set(PRE_AETHELGARD_ARCHIVE_KEY, "older fixed snapshot");
  for (let index = 1; index <= 1024; index++) storage.items.set(`${INHERITED_PREDECESSOR_ARCHIVE_PREFIX}${index}`, `older snapshot ${index}`);
  const original = new Map(storage.items);
  const result = await createInheritedSessionStore(storage, serialization()).enter(entry());
  assert.ok(!result.ok && result.reason === "conflict");
  assert.deepEqual(storage.items, original);
  assert.deepEqual(storage.writes, []);
});

test("serialized store instances preserve competing choices and refuse a competing response to the same decision", async () => {
  const storage = new MemoryStorage();
  const serialize = serialization();
  const first = createInheritedSessionStore(storage, serialize);
  const second = createInheritedSessionStore(storage, serialize);
  const entries = await Promise.all([first.enter(entry()), second.enter(entry())]);
  assert.deepEqual(entries.map((result) => result.ok && result.status), ["entered", "already-entered"]);
  storage.writes.length = 0;
  const choices = await Promise.all([
    first.choose(choice()),
    second.choose(choice({ choiceId: "test-decision-b", at: LATER_AT, storyEffects: [{ factId: "test-story-a", value: false }] })),
  ]);
  assert.deepEqual(choices.map((result) => result.ok && result.status), ["applied", "applied"]);
  const loaded = first.load();
  assert.ok(loaded.status === "loaded");
  assert.deepEqual(loaded.session.choices.map((record) => record.choiceId), ["test-decision-a", "test-decision-b"]);
  assert.equal(loaded.session.storyFacts[0].value, false);
  const retries = await Promise.all([
    first.choose(choice({ at: LATER_AT })),
    second.choose(choice({ optionId: "test-option-b", at: LATER_AT })),
  ]);
  assert.ok(retries[0].ok && retries[0].status === "already-applied");
  assert.ok(!retries[1].ok && retries[1].reason === "invalid-choice");
  assert.equal(storage.writes.length, 2, "Exactly one slot write per applied decision");
});

import assert from "node:assert/strict";
import test from "node:test";
import { chooseInheritedBannerDesign, createInheritedBannerDraft, type InheritedBannerDraft } from "../aethelgard/entry-draft";
import { EALDHOLT_HOUSE } from "../aethelgard/house";
import { createInheritedSession, type InheritedEntry } from "../aethelgard/inherited-session";
import {
  createInheritedSessionStore, INHERITED_SESSION_STORAGE_KEY,
  type InheritedSessionStore, type SerializeInheritedOperation,
} from "../aethelgard/inherited-storage";
import { createInheritedVisit, type InheritedVisitSnapshot } from "../aethelgard/inherited-visit";
import { EALDHOLT_DRAFT_CAST, EALDHOLT_DRAFT_STORY_FACTS, EALDHOLT_PEOPLE_DRAFT, getEaldholtDraftDialogue } from "../aethelgard/people-draft";
import { PRE_AETHELGARD_ARCHIVE_KEY } from "../aethelgard/storage";
import { LEGACY_STORAGE_KEY, type LegacyStorageLike } from "../domain/persistence";

const ENTRY_AT = "2026-11-06T10:00:00.000Z";
const CHOICE_AT = "2026-11-06T10:01:00.000Z";
const LATER_AT = "2026-11-06T10:02:00.000Z";
const PERSON = EALDHOLT_PEOPLE_DRAFT[0];

class MemoryStorage implements LegacyStorageLike {
  readonly items = new Map<string, string>();
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  failWrites = false;
  getItem(key: string): string | null { this.reads.push(key); return this.items.get(key) ?? null; }
  setItem(key: string, raw: string): void {
    this.writes.push(key);
    if (this.failWrites) throw new Error("quota");
    this.items.set(key, raw);
  }
  removeItem(): void { assert.fail("No controller command may remove a key."); }
}

// A process-local test scheduler only; production injects the browser helper's
// shared navigator.locks store and never uses this scheduler as a fallback.
const immediate: SerializeInheritedOperation = async (operation) => operation();

function draft(): InheritedBannerDraft {
  const chosen = chooseInheritedBannerDesign(createInheritedBannerDraft(), {
    division: "per-pale", field: ["azure", "argent"], ordinary: "none",
    ordinaryTincture: "or", charge: "key", chargeTincture: "sable",
  });
  assert.ok(chosen.ok);
  return chosen.draft;
}

function entry(): InheritedEntry {
  return {
    type: "enter-inherited-house", origin: "inherited", houseId: EALDHOLT_HOUSE.id,
    nationId: EALDHOLT_HOUSE.nationId, bannerDraft: draft(), bannerConfirmed: true,
    at: ENTRY_AT, cast: EALDHOLT_DRAFT_CAST, storyFacts: EALDHOLT_DRAFT_STORY_FACTS,
  };
}

function sessionRaw(): string {
  const result = createInheritedSession(entry());
  assert.ok(result.ok);
  return JSON.stringify(result.session);
}

function clock(...values: string[]) {
  let calls = 0;
  return { at: () => values[Math.min(calls++, values.length - 1)], calls: () => calls };
}

function forbiddenStore(): InheritedSessionStore {
  return {
    load() { assert.fail("Preview must not read a saved session."); },
    async enter() { assert.fail("Preview must not save entry."); },
    async choose() { assert.fail("Preview must not save a story choice."); },
  };
}

function heldSerialization() {
  let release!: () => void;
  let submitted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { submitted = resolve; });
  const serialize: SerializeInheritedOperation = async (operation) => { submitted(); await gate; return operation(); };
  return { serialize, release, started };
}

test("preview construction/load are inert, immutable and do not consult store or timestamp", () => {
  const supplied = clock(ENTRY_AT);
  const visit = createInheritedVisit({ mode: "preview", store: forbiddenStore(), at: supplied.at });
  const initial = visit.getSnapshot();
  assert.deepEqual(initial, { mode: "preview", busy: false, bannerDraft: createInheritedBannerDraft(), session: null, error: null });
  assert.equal(Object.isFrozen(initial), true);
  assert.equal(Reflect.set(initial, "mode", "inherited"), false);
  assert.equal(visit.load(), true);
  assert.equal(visit.getSnapshot(), initial);
  assert.equal(supplied.calls(), 0);
});

test("inherited construction and explicit reload read only the separate slot and restore its fixed banner", async () => {
  const storage = new MemoryStorage();
  storage.items.set(INHERITED_SESSION_STORAGE_KEY, sessionRaw());
  storage.items.set(LEGACY_STORAGE_KEY, "untouched retired raw save");
  const before = new Map(storage.items);
  const supplied = clock(ENTRY_AT);
  const visit = createInheritedVisit({ mode: "inherited", store: createInheritedSessionStore(storage, immediate), at: supplied.at });
  assert.ok(visit.getSnapshot().session);
  assert.deepEqual(visit.getSnapshot().bannerDraft, draft());
  assert.equal(visit.load(), true);
  assert.equal(visit.chooseBanner(createInheritedBannerDraft()), false);
  assert.equal(await visit.confirmBanner(), true);
  assert.equal(supplied.calls(), 0);
  assert.deepEqual(storage.reads, [INHERITED_SESSION_STORAGE_KEY, INHERITED_SESSION_STORAGE_KEY]);
  assert.deepEqual(storage.writes, []);
  assert.deepEqual(storage.items, before);
});

test("inherited mode without a locked store fails closed and never silently enters a memory session", async () => {
  const supplied = clock(ENTRY_AT);
  const visit = createInheritedVisit({ mode: "inherited", store: null, at: supplied.at });
  assert.match(visit.getSnapshot().error!, /Saving is unavailable/);
  assert.equal(visit.load(), false);
  assert.equal(visit.chooseBanner(draft()), true);
  assert.equal(await visit.confirmBanner(), false);
  assert.equal(visit.getSnapshot().session, null);
  assert.equal(supplied.calls(), 0);
});

test("an explicit chosen banner is required; role inspection cannot implicitly enter or consume a timestamp", async () => {
  const supplied = clock(ENTRY_AT);
  const visit = createInheritedVisit({ mode: "preview", store: forbiddenStore(), at: supplied.at });
  assert.equal(await visit.confirmBanner(), false);
  assert.match(visit.getSnapshot().error!, /Choose a banner/);
  assert.equal(visit.chooseBanner(createInheritedBannerDraft()), false);
  assert.equal(visit.chooseBanner({ ...draft(), houseId: "renamed-house" } as unknown as InheritedBannerDraft), false);
  assert.equal(await visit.chooseResponse(PERSON.id, PERSON.decision.options[0].id), false);
  assert.equal(getEaldholtDraftDialogue(PERSON.id, visit.getSnapshot().session)?.recordedOptionId, null);
  assert.equal(visit.getSnapshot().session, null);
  assert.equal(supplied.calls(), 0);
});

test("preview confirms supplied draft content and known choices in memory, even if a store was injected", async () => {
  const supplied = clock(ENTRY_AT, CHOICE_AT);
  const visit = createInheritedVisit({ mode: "preview", store: forbiddenStore(), at: supplied.at });
  const chosen = draft();
  assert.equal(visit.chooseBanner(chosen), true);
  assert.notEqual(visit.getSnapshot().bannerDraft, chosen);
  assert.equal(await visit.confirmBanner(), true);
  const initial = visit.getSnapshot().session!;
  assert.deepEqual(initial.cast, EALDHOLT_DRAFT_CAST);
  assert.deepEqual(initial.storyFacts, EALDHOLT_DRAFT_STORY_FACTS);
  assert.equal(visit.chooseBanner(draft()), false, "Confirmation fixes the banner for this session");
  assert.equal(await visit.chooseResponse(PERSON.id, PERSON.decision.options[0].id), true);
  const current = visit.getSnapshot().session!;
  assert.equal(current.choices.length, 1);
  assert.deepEqual(current.house, initial.house);
  assert.deepEqual(current.banner, initial.banner);
  assert.deepEqual(current.entry, initial.entry);
  assert.equal(getEaldholtDraftDialogue(PERSON.id, current)?.recordedOptionId, PERSON.decision.options[0].id);
  assert.equal(supplied.calls(), 2);
  for (const key of ["standing", "chess", "rank", "foundedAt", "members", "chronicle"]) assert.equal(key in current, false);
});

test("only registered role responses are available and repeated choices do not rewrite a decision", async () => {
  const supplied = clock(ENTRY_AT, CHOICE_AT, LATER_AT);
  const visit = createInheritedVisit({ mode: "preview", store: null, at: supplied.at });
  visit.chooseBanner(draft());
  await visit.confirmBanner();
  for (const [personId, optionId] of [["unknown", "unknown"], [PERSON.id, "unknown"], [PERSON.id, EALDHOLT_PEOPLE_DRAFT[1].decision.options[0].id]]) {
    assert.equal(await visit.chooseResponse(personId, optionId), false);
    assert.equal(visit.getSnapshot().session!.choices.length, 0);
  }
  assert.equal(await visit.chooseResponse(PERSON.id, PERSON.decision.options[0].id), true);
  const first = visit.getSnapshot().session;
  assert.equal(await visit.chooseResponse(PERSON.id, PERSON.decision.options[0].id), true);
  assert.equal(visit.getSnapshot().session, first);
  assert.equal(await visit.chooseResponse(PERSON.id, PERSON.decision.options[1].id), false);
  assert.equal(visit.getSnapshot().session, first);
});

test("saved explicit confirmation archives retired bytes and role responses continue on a later visit", async () => {
  const storage = new MemoryStorage();
  const retired = "\n{retired data that needs recovery\n";
  storage.items.set(LEGACY_STORAGE_KEY, retired);
  storage.items.set("crownfall.estate.save", "estate stays intact");
  const supplied = clock(ENTRY_AT, CHOICE_AT);
  const store = createInheritedSessionStore(storage, immediate);
  const visit = createInheritedVisit({ mode: "inherited", store, at: supplied.at });
  assert.equal(storage.writes.length, 0);
  assert.equal(visit.chooseBanner(draft()), true);
  assert.equal(await visit.confirmBanner(), true);
  assert.equal(storage.items.get(LEGACY_STORAGE_KEY), retired);
  assert.equal(storage.items.get(PRE_AETHELGARD_ARCHIVE_KEY), retired);
  assert.equal(storage.items.get("crownfall.estate.save"), "estate stays intact");
  assert.equal(await visit.chooseResponse(PERSON.id, PERSON.decision.options[0].id), true);
  const written = [...storage.writes];
  const returned = createInheritedVisit({ mode: "inherited", store, at: () => { assert.fail("Read-only return must not read time."); } });
  assert.equal(getEaldholtDraftDialogue(PERSON.id, returned.getSnapshot().session)?.recordedOptionId, PERSON.decision.options[0].id);
  assert.deepEqual(storage.writes, written);
});

test("corrupt and future inherited data remain unchanged through load, confirmation and attempted response", async () => {
  for (const raw of ["{corrupt", JSON.stringify({ kind: "inherited-aethelgard", schemaVersion: 99 })]) {
    const storage = new MemoryStorage();
    storage.items.set(INHERITED_SESSION_STORAGE_KEY, raw);
    storage.items.set(LEGACY_STORAGE_KEY, "retired original");
    const before = new Map(storage.items);
    const visit = createInheritedVisit({ mode: "inherited", store: createInheritedSessionStore(storage, immediate), at: () => ENTRY_AT });
    assert.equal(visit.load(), false);
    assert.equal(typeof visit.getSnapshot().error, "string");
    visit.chooseBanner(draft());
    assert.equal(await visit.confirmBanner(), false);
    assert.equal(await visit.chooseResponse(PERSON.id, PERSON.decision.options[0].id), false);
    assert.equal(visit.getSnapshot().session, null);
    assert.deepEqual(storage.items, before);
    assert.deepEqual(storage.writes, []);
  }
});

test("a bad supplied timestamp fails without writing and a corrected timestamp can retry", async () => {
  const storage = new MemoryStorage();
  const supplied = clock("not-a-timestamp", ENTRY_AT);
  const visit = createInheritedVisit({ mode: "inherited", store: createInheritedSessionStore(storage, immediate), at: supplied.at });
  visit.chooseBanner(draft());
  assert.equal(await visit.confirmBanner(), false);
  assert.deepEqual(storage.writes, []);
  assert.equal(await visit.confirmBanner(), true);
  assert.equal(visit.getSnapshot().session!.entry.at, ENTRY_AT);
  assert.equal(supplied.calls(), 2);
});

test("busy ownership coalesces duplicate clicks and rejects competing commands or reloads", async () => {
  const storage = new MemoryStorage();
  const held = heldSerialization();
  const supplied = clock(ENTRY_AT);
  const visit = createInheritedVisit({ mode: "inherited", store: createInheritedSessionStore(storage, held.serialize), at: supplied.at });
  visit.chooseBanner(draft());
  const first = visit.confirmBanner();
  const duplicate = visit.confirmBanner();
  assert.equal(first, duplicate);
  assert.equal(visit.getSnapshot().busy, true);
  assert.equal(visit.chooseBanner(draft()), false);
  assert.equal(await visit.chooseResponse(PERSON.id, PERSON.decision.options[0].id), false);
  const readCount = storage.reads.length;
  assert.equal(visit.load(), false);
  assert.equal(storage.reads.length, readCount);
  await held.started;
  held.release();
  assert.equal(await first, true);
  assert.equal(await duplicate, true);
  assert.equal(visit.getSnapshot().busy, false);
  assert.equal(supplied.calls(), 1);
  assert.deepEqual(storage.writes, [INHERITED_SESSION_STORAGE_KEY]);
});

test("duplicate response clicks share one write and a competing role cannot consume its choice", async () => {
  const storage = new MemoryStorage();
  storage.items.set(INHERITED_SESSION_STORAGE_KEY, sessionRaw());
  const held = heldSerialization();
  const supplied = clock(CHOICE_AT);
  const visit = createInheritedVisit({ mode: "inherited", store: createInheritedSessionStore(storage, held.serialize), at: supplied.at });
  const first = visit.chooseResponse(PERSON.id, PERSON.decision.options[0].id);
  assert.equal(visit.chooseResponse(PERSON.id, PERSON.decision.options[0].id), first);
  assert.equal(await visit.chooseResponse(EALDHOLT_PEOPLE_DRAFT[1].id, EALDHOLT_PEOPLE_DRAFT[1].decision.options[0].id), false);
  await held.started;
  held.release();
  assert.equal(await first, true);
  assert.equal(visit.getSnapshot().session!.choices.length, 1);
  assert.equal(supplied.calls(), 1);
  assert.deepEqual(storage.writes, [INHERITED_SESSION_STORAGE_KEY]);
});

test("an entry quota retry retains its original confirmed timestamp instead of manufacturing a second entry", async () => {
  const storage = new MemoryStorage();
  const supplied = clock(ENTRY_AT, LATER_AT);
  const visit = createInheritedVisit({ mode: "inherited", store: createInheritedSessionStore(storage, immediate), at: supplied.at });
  visit.chooseBanner(draft());
  storage.failWrites = true;
  assert.equal(await visit.confirmBanner(), false);
  assert.equal(visit.getSnapshot().session, null);
  storage.failWrites = false;
  assert.equal(await visit.confirmBanner(), true);
  assert.equal(visit.getSnapshot().session!.entry.at, ENTRY_AT);
  assert.equal(supplied.calls(), 1);
});

test("an uncertain successful entry is observed read-only and retry never writes a new banner", async () => {
  const storage = new MemoryStorage();
  const supplied = clock(ENTRY_AT, LATER_AT);
  const visit = createInheritedVisit({ mode: "inherited", store: createInheritedSessionStore(storage, immediate), at: supplied.at });
  visit.chooseBanner(draft());
  const baseWrite = storage.setItem.bind(storage);
  const baseRead = storage.getItem.bind(storage);
  let unreadable = false;
  storage.setItem = (key, raw) => { baseWrite(key, raw); if (key === INHERITED_SESSION_STORAGE_KEY) unreadable = true; };
  storage.getItem = (key) => {
    if (key === INHERITED_SESSION_STORAGE_KEY && unreadable) { unreadable = false; throw new Error("readback unavailable"); }
    return baseRead(key);
  };
  assert.equal(await visit.confirmBanner(), false, "The failed verification is still reported");
  assert.ok(visit.getSnapshot().session, "Read-only recovery observes the actual stored session");
  assert.ok(visit.getSnapshot().error);
  assert.equal(visit.chooseBanner(draft()), false);
  assert.equal(await visit.confirmBanner(), true);
  assert.equal(visit.getSnapshot().error, null);
  assert.equal(supplied.calls(), 1);
  assert.deepEqual(storage.writes, [INHERITED_SESSION_STORAGE_KEY]);
});

test("subscriptions expose busy/result snapshots, isolate observer errors and unsubscribe cleanly", async () => {
  const visit = createInheritedVisit({ mode: "preview", store: null, at: () => ENTRY_AT });
  const seen: InheritedVisitSnapshot[] = [];
  visit.subscribe(() => { throw new Error("observer failure"); });
  const unsubscribe = visit.subscribe((snapshot) => { seen.push(snapshot); });
  assert.equal(seen.length, 0, "Subscribe does not emit an implicit command or initial state");
  visit.chooseBanner(draft());
  assert.equal(await visit.confirmBanner(), true);
  assert.deepEqual(seen.map((snapshot) => snapshot.busy), [false, true, false]);
  assert.equal(seen[2].session!.entry.at, ENTRY_AT);
  unsubscribe();
  const count = seen.length;
  visit.load();
  await visit.confirmBanner();
  assert.equal(seen.length, count);
});

test("disposing before submission cancels new work and suppresses all later host notifications", async () => {
  const storage = new MemoryStorage();
  const supplied = clock(ENTRY_AT);
  const visit = createInheritedVisit({ mode: "inherited", store: createInheritedSessionStore(storage, immediate), at: supplied.at });
  visit.chooseBanner(draft());
  let notifications = 0;
  visit.subscribe(() => { notifications++; });
  const pending = visit.confirmBanner();
  assert.equal(notifications, 1);
  visit.dispose();
  const disposedSnapshot = visit.getSnapshot();
  assert.equal(await pending, false);
  assert.equal(await visit.confirmBanner(), false);
  assert.equal(await visit.chooseResponse(PERSON.id, PERSON.decision.options[0].id), false);
  assert.equal(visit.chooseBanner(draft()), false);
  assert.equal(visit.load(), false);
  assert.equal(visit.getSnapshot(), disposedSnapshot);
  assert.equal(visit.getSnapshot().busy, false);
  assert.equal(supplied.calls(), 0);
  assert.equal(notifications, 1);
  assert.deepEqual(storage.writes, []);
});

test("an already submitted authorized save may complete after disposal but cannot update the old host", async () => {
  const storage = new MemoryStorage();
  const held = heldSerialization();
  const visit = createInheritedVisit({ mode: "inherited", store: createInheritedSessionStore(storage, held.serialize), at: () => ENTRY_AT });
  visit.chooseBanner(draft());
  const pending = visit.confirmBanner();
  await held.started;
  visit.dispose();
  const disposedSnapshot = visit.getSnapshot();
  held.release();
  assert.equal(await pending, false);
  assert.equal(visit.getSnapshot(), disposedSnapshot);
  assert.equal(visit.getSnapshot().session, null);
  assert.deepEqual(storage.writes, [INHERITED_SESSION_STORAGE_KEY]);
  const returned = createInheritedVisit({ mode: "inherited", store: createInheritedSessionStore(storage, immediate), at: () => LATER_AT });
  assert.equal(returned.getSnapshot().session!.entry.at, ENTRY_AT);
});

test("controller instances sharing the serialized store retain independent registered story decisions", async () => {
  const storage = new MemoryStorage();
  storage.items.set(INHERITED_SESSION_STORAGE_KEY, sessionRaw());
  let tail: Promise<unknown> = Promise.resolve();
  const serialize: SerializeInheritedOperation = (operation) => {
    const next = tail.then(operation);
    tail = next.catch(() => undefined);
    return next;
  };
  const store = createInheritedSessionStore(storage, serialize);
  const first = createInheritedVisit({ mode: "inherited", store, at: () => CHOICE_AT });
  const second = createInheritedVisit({ mode: "inherited", store, at: () => LATER_AT });
  assert.deepEqual(await Promise.all([
    first.chooseResponse(PERSON.id, PERSON.decision.options[0].id),
    second.chooseResponse(EALDHOLT_PEOPLE_DRAFT[1].id, EALDHOLT_PEOPLE_DRAFT[1].decision.options[0].id),
  ]), [true, true]);
  assert.equal(first.load(), true);
  assert.equal(first.getSnapshot().session!.choices.length, 2);
  assert.equal(first.getSnapshot().session!.house.name, EALDHOLT_HOUSE.name);
  assert.deepEqual(storage.writes, [INHERITED_SESSION_STORAGE_KEY, INHERITED_SESSION_STORAGE_KEY]);
});

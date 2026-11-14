import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserInheritedSessionStore } from "../aethelgard/inherited-browser-store";
import { chooseInheritedBannerPreset, createInheritedBannerDraft } from "../aethelgard/entry-draft";
import { EALDHOLT_DRAFT_CAST, EALDHOLT_DRAFT_STORY_FACTS } from "../aethelgard/people-draft";
import { INHERITED_SESSION_STORAGE_KEY } from "../aethelgard/inherited-storage";
import { LEGACY_STORAGE_KEY } from "../domain/persistence";
import { HERALDRY_PRESETS } from "../content/heraldry";

test("browser store requires a cross-tab lock and creates no probe writes", async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let reads = 0;
  const values = new Map<string, string>([[LEGACY_STORAGE_KEY, "unmodified predecessor"]]);
  const writes: string[] = [];
  const lockNames: string[] = [];
  let tail = Promise.resolve();
  try {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { reads++; throw Error("blocked"); } });
    assert.equal(createBrowserInheritedSessionStore(), null);
    assert.equal(reads, 0, "no local storage access without the required lock");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: {
      request(name: string, options: { mode: string }, operation: () => unknown) {
        assert.equal(options.mode, "exclusive");
        lockNames.push(name);
        const result = tail.then(operation);
        tail = result.then(() => undefined, () => undefined);
        return result;
      },
    } } });
    assert.equal(createBrowserInheritedSessionStore(), null, "blocked storage fails closed");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem(key: string) { reads++; return values.get(key) ?? null; },
      setItem(key: string, value: string) { writes.push(key); values.set(key, value); },
      removeItem() { assert.fail("the inherited route must not remove earlier saves"); },
    } });
    const first = createBrowserInheritedSessionStore()!;
    const second = createBrowserInheritedSessionStore()!;
    assert.deepEqual(writes, []);
    assert.deepEqual(lockNames, []);
    assert.equal(first.load().status, "empty");
    assert.deepEqual(writes, []);
    const banner = chooseInheritedBannerPreset(createInheritedBannerDraft(), HERALDRY_PRESETS.aethelgard[0].id);
    assert.ok(banner.ok);
    const entry = { type: "enter-inherited-house", origin: "inherited", houseId: "house-ealdholt", nationId: "aethelgard", bannerDraft: banner.draft,
      bannerConfirmed: true, at: "2026-11-06T00:00:00.000Z", cast: EALDHOLT_DRAFT_CAST, storyFacts: EALDHOLT_DRAFT_STORY_FACTS };
    const results = await Promise.all([first.enter(entry), second.enter(entry)]);
    assert.deepEqual(results.map(result => result.ok && result.status), ["entered", "already-entered"]);
    assert.equal(writes.filter(key => key === INHERITED_SESSION_STORAGE_KEY).length, 1);
    assert.equal(values.get(LEGACY_STORAGE_KEY), "unmodified predecessor");
    assert.equal(new Set(lockNames).size, 1, "separate adapters coordinate through one origin lock");
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

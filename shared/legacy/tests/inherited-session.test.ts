import assert from "node:assert/strict";
import test from "node:test";
import { chooseInheritedBannerDesign, createInheritedBannerDraft } from "../aethelgard/entry-draft";
import { EALDHOLT_HOUSE } from "../aethelgard/house";
import {
  applyInheritedStoryChoice, createInheritedSession, INHERITED_SESSION_SCHEMA_VERSION,
  parseInheritedSession, validateInheritedSession,
  type InheritedEntry, type InheritedSession, type InheritedStoryChoice,
} from "../aethelgard/inherited-session";
import { createLegacyState } from "../domain/state";
import type { Heraldry } from "../types";

const ENTRY_AT = "2026-11-06T10:00:00.000Z";
const CHOICE_AT = "2026-11-06T10:01:00.000Z";
const LATER_AT = "2026-11-06T10:02:00.000Z";

// Test-only IDs and facts carry no character names, roles or historical claims.
function entry(): InheritedEntry {
  const heraldry: Heraldry = { division: "per-pale", field: ["azure", "argent"], ordinary: "none", ordinaryTincture: "or", charge: "key", chargeTincture: "sable" };
  const chosen = chooseInheritedBannerDesign(createInheritedBannerDraft(), heraldry);
  assert.ok(chosen.ok);
  return {
    type: "enter-inherited-house", origin: "inherited", houseId: EALDHOLT_HOUSE.id,
    nationId: EALDHOLT_HOUSE.nationId, bannerDraft: chosen.draft, bannerConfirmed: true, at: ENTRY_AT,
    cast: [
      { id: "test-person-a", relationshipFacts: [{ id: "test-fact-a", value: false }] },
      { id: "test-person-b", relationshipFacts: [] },
    ],
    storyFacts: [{ id: "test-story-a", value: false }, { id: "test-story-b", value: true }],
  };
}

function session(): InheritedSession {
  const result = createInheritedSession(entry());
  assert.ok(result.ok);
  return result.session;
}

function choice(overrides: Partial<InheritedStoryChoice> = {}): InheritedStoryChoice {
  return {
    type: "story-choice", choiceId: "test-decision-a", optionId: "test-option-a", at: CHOICE_AT,
    personIds: ["test-person-a"],
    relationshipEffects: [{ personId: "test-person-a", factId: "test-fact-a", value: true }],
    storyEffects: [{ factId: "test-story-a", value: true }],
    ...overrides,
  };
}

function jsonCopy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

test("explicit inherited entry retains only the approved house, player banner and supplied continuing cast", () => {
  const supplied = entry();
  const before = JSON.stringify(supplied);
  const result = createInheritedSession(supplied);
  assert.ok(result.ok);
  const state = result.session;
  assert.deepEqual(state.house, { id: "house-ealdholt", name: "House Ealdholt", nationId: "aethelgard", origin: "inherited" });
  assert.deepEqual(state.entry, { type: "inherited-entry", at: ENTRY_AT });
  assert.deepEqual(state.cast, supplied.cast);
  assert.deepEqual(state.storyFacts, supplied.storyFacts);
  assert.deepEqual(state.banner, { confirmed: true, heraldry: supplied.bannerDraft.heraldry });
  assert.deepEqual(state.choices, []);
  for (const key of ["standing", "members", "chronicle", "seed", "foundedAt", "chess", "currency"]) assert.equal(key in state, false);
  assert.notEqual(state.cast, supplied.cast);
  assert.notEqual(state.cast[0].relationshipFacts, supplied.cast[0].relationshipFacts);
  assert.notEqual(state.banner.heraldry, supplied.bannerDraft.heraldry);
  assert.equal(JSON.stringify(supplied), before);
  assert.equal(Object.isFrozen(supplied.cast), false, "entry does not take ownership or freeze caller content");
  assert.equal(Reflect.set(state.house, "origin", "founded"), false);
  assert.equal(Reflect.set(state.banner.heraldry.field, "0", "gules"), false);
  assert.equal(Reflect.set(state.cast[0], "id", "replacement-person"), false);
});

test("entry refuses founding, identity changes, unconfirmed/invalid banners and missing content without altering inputs", () => {
  const original = entry();
  const invalid: unknown[] = [
    { ...original, type: "found-banner" }, { ...original, origin: "founded" },
    { ...original, houseId: "another-house" }, { ...original, nationId: "korvenia" },
    { ...original, name: "Another house" }, { ...original, bannerConfirmed: false },
    { ...original, bannerDraft: createInheritedBannerDraft() },
    { ...original, bannerDraft: { ...original.bannerDraft, houseId: "another-house" } },
    { ...original, bannerDraft: { ...original.bannerDraft, heraldry: { ...original.bannerDraft.heraldry, charge: "unknown" } } },
    { ...original, cast: [] }, { ...original, cast: undefined },
    { ...original, at: "2026-02-30T10:00:00.000Z" }, { ...original, at: "not-a-time" },
    createLegacyState({ at: ENTRY_AT }), null,
  ];
  for (const candidate of invalid) {
    const before = JSON.stringify(candidate);
    assert.equal(createInheritedSession(candidate).ok, false, before);
    assert.equal(JSON.stringify(candidate), before);
  }
  assert.equal(Object.isFrozen(original.cast), false);
});

test("registered cast and fact IDs must be stable, distinct and explicit, without supplied biographies or rank", () => {
  const original = entry();
  for (const cast of [
    [original.cast[0], original.cast[0]],
    [{ id: "test-person-a", relationshipFacts: [{ id: "same", value: false }, { id: "same", value: true }] }],
    [{ id: "test-person-a", relationshipFacts: [], biography: "invented" }],
    [{ id: "", relationshipFacts: [] }],
    [{ id: "test-person-a", relationshipFacts: [{ id: "score", value: 100 }] }],
  ]) assert.equal(createInheritedSession({ ...original, cast }).ok, false);
  assert.equal(createInheritedSession({ ...original, storyFacts: [{ id: "same", value: true }, { id: "same", value: false }] }).ok, false);
  assert.equal(createInheritedSession({ ...original, standing: { rank: "minor-banner" } }).ok, false);
});

test("the separate schema round-trips without migrating or accepting an old founded save", () => {
  const original = session();
  const parsed = parseInheritedSession(JSON.stringify(original));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.session, original);
  assert.notEqual(parsed.session, original);
  assert.equal(validateInheritedSession(parsed.session), null);
  assert.equal(Reflect.set(parsed.session.storyFacts[0], "value", true), false);
  const old = JSON.stringify({ ...createLegacyState({ at: ENTRY_AT }), banner: { name: "An old player-founded house", nationId: "aethelgard" } });
  const rejected = parseInheritedSession(old);
  assert.ok(!rejected.ok);
  assert.equal(rejected.reason, "incompatible");
  assert.equal(old.includes("An old player-founded house"), true);
});

test("the parser rejects future, corrupt, wrong-house, wrong-kingdom and founding data without repair", () => {
  const original = session();
  const future = parseInheritedSession(JSON.stringify({ ...original, schemaVersion: INHERITED_SESSION_SCHEMA_VERSION + 1 }));
  assert.ok(!future.ok);
  assert.equal(future.reason, "future-version");
  for (const candidate of [
    { ...original, schemaVersion: 0 }, { ...original, schemaVersion: "1" },
    { ...original, house: { ...original.house, id: "another-house" } },
    { ...original, house: { ...original.house, name: "Renamed house" } },
    { ...original, house: { ...original.house, nationId: "solforiz" } },
    { ...original, house: { ...original.house, origin: "founded" } },
    { ...original, entry: { type: "founding", at: ENTRY_AT } },
    { ...original, banner: { ...original.banner, confirmed: false } },
    { ...original, banner: { ...original.banner, heraldry: { ...original.banner.heraldry, rank: "great-house" } } },
    { ...original, chess: { recognition: 999 } },
    { ...original, updatedAt: CHOICE_AT }, [], null,
  ]) {
    const raw = JSON.stringify(candidate);
    assert.equal(parseInheritedSession(raw).ok, false, raw);
    assert.equal(JSON.stringify(candidate), raw);
  }
  assert.equal(parseInheritedSession("{broken").ok, false);
});

test("story choices update registered facts and retain the same cast, banner and entry through continuation", () => {
  const initial = session();
  const initialData = JSON.stringify(initial);
  const suppliedChoice = choice();
  const suppliedData = JSON.stringify(suppliedChoice);
  const first = applyInheritedStoryChoice(initial, suppliedChoice);
  assert.ok(first.ok);
  assert.equal(first.status, "applied");
  assert.deepEqual(first.session.house, initial.house);
  assert.deepEqual(first.session.banner, initial.banner);
  assert.deepEqual(first.session.entry, initial.entry);
  assert.deepEqual(first.session.cast.map((person) => person.id), initial.cast.map((person) => person.id));
  assert.equal(first.session.cast[0].relationshipFacts[0].value, true);
  assert.deepEqual(first.session.cast[1], initial.cast[1]);
  assert.deepEqual(first.session.storyFacts.map((fact) => fact.value), [true, true]);
  assert.deepEqual(first.session.choices, [suppliedChoice]);
  assert.equal(first.session.updatedAt, CHOICE_AT);
  assert.equal(JSON.stringify(initial), initialData);
  assert.equal(JSON.stringify(suppliedChoice), suppliedData);
  assert.equal(Object.isFrozen(suppliedChoice), false);
  assert.equal(Reflect.set(first.session.choices[0].relationshipEffects[0], "value", false), false);
  const resumed = parseInheritedSession(JSON.stringify(first.session));
  assert.ok(resumed.ok);
  const next = applyInheritedStoryChoice(resumed.session, choice({ choiceId: "test-decision-b", at: LATER_AT, relationshipEffects: [], storyEffects: [{ factId: "test-story-a", value: false }] }));
  assert.ok(next.ok);
  assert.equal(next.session.choices.length, 2);
  assert.equal(next.session.cast[0].relationshipFacts[0].value, true);
  assert.equal(next.session.storyFacts[0].value, false);
  assert.equal(validateInheritedSession(next.session), null);
  const oldRetry = applyInheritedStoryChoice(next.session, suppliedChoice);
  assert.ok(oldRetry.ok);
  assert.equal(oldRetry.status, "already-applied");
  assert.equal(oldRetry.session, next.session, "retrying an earlier decision cannot reapply its effects over later story choices");
  assert.equal(oldRetry.session.storyFacts[0].value, false);
});

test("retrying a decision is idempotent, while a different response or effects cannot rewrite it", () => {
  const first = applyInheritedStoryChoice(session(), choice({ personIds: ["test-person-a", "test-person-b"] }));
  assert.ok(first.ok);
  const repeated = applyInheritedStoryChoice(first.session, choice({ at: LATER_AT, personIds: ["test-person-b", "test-person-a"] }));
  assert.ok(repeated.ok);
  assert.equal(repeated.status, "already-applied");
  assert.equal(repeated.session, first.session);
  for (const retry of [choice({ optionId: "test-option-b" }), choice({ storyEffects: [] })]) {
    const rejected = applyInheritedStoryChoice(first.session, retry);
    assert.ok(!rejected.ok);
    assert.equal(rejected.session, first.session);
  }
  assert.equal(first.session.choices.length, 1);
});

test("unknown people/facts and duplicated effects are rejected atomically", () => {
  const initial = session();
  const before = JSON.stringify(initial);
  for (const candidate of [
    choice({ personIds: ["unregistered"] }), choice({ personIds: ["test-person-a", "test-person-a"] }),
    choice({ personIds: [] }),
    choice({ relationshipEffects: [{ personId: "test-person-b", factId: "test-fact-a", value: true }] }),
    choice({ relationshipEffects: [{ personId: "test-person-a", factId: "new-fact", value: true }] }),
    choice({ relationshipEffects: [...choice().relationshipEffects, ...choice().relationshipEffects] }),
    choice({ storyEffects: [{ factId: "new-story", value: true }] }),
    choice({ storyEffects: [{ factId: "test-story-a", value: true }, { factId: "test-story-a", value: false }] }),
    choice({ at: "2026-11-06T09:00:00.000Z" }), choice({ at: "invalid" }),
  ]) {
    const result = applyInheritedStoryChoice(initial, candidate);
    assert.ok(!result.ok, JSON.stringify(candidate));
    assert.equal(result.session, initial);
    assert.equal(JSON.stringify(initial), before);
  }
});

test("extra story-event fields cannot edit identity, banner, cast definitions or chess state", () => {
  const initial = session();
  for (const candidate of [
    { ...choice(), house: { id: "another-house" } }, { ...choice(), banner: { confirmed: true } },
    { ...choice(), standing: { rank: "great-house" } }, { ...choice(), chess: { advantage: 1 } },
    { ...choice(), cast: [] }, { ...choice(), type: "record-match" },
    { ...choice(), relationshipEffects: [{ ...choice().relationshipEffects[0], name: "replacement" }] },
    { ...choice(), storyEffects: [{ factId: "test-story-a", value: true, recognition: 1 }] },
  ]) {
    const before = JSON.stringify(candidate);
    const result = applyInheritedStoryChoice(initial, candidate);
    assert.ok(!result.ok);
    assert.equal(result.session, initial);
    assert.equal(JSON.stringify(candidate), before);
    assert.equal(Object.isFrozen(candidate), false);
  }
  assert.deepEqual(initial.choices, []);
});

test("saved choice history must reference the continuing cast, remain unique and agree with current facts", () => {
  const applied = applyInheritedStoryChoice(session(), choice());
  assert.ok(applied.ok);
  const changed = jsonCopy(applied.session);
  const invalid = [
    { ...changed, choices: [changed.choices[0], changed.choices[0]] },
    { ...changed, cast: [changed.cast[1]] },
    { ...changed, cast: [{ ...changed.cast[0], relationshipFacts: [{ id: "test-fact-a", value: false }] }, changed.cast[1]] },
    { ...changed, storyFacts: [{ id: "test-story-a", value: false }, changed.storyFacts[1]] },
    { ...changed, choices: [{ ...changed.choices[0], at: ENTRY_AT }], updatedAt: CHOICE_AT },
  ];
  for (const candidate of invalid) {
    assert.equal(parseInheritedSession(JSON.stringify(candidate)).ok, false);
    const result = applyInheritedStoryChoice(candidate as InheritedSession, choice({ choiceId: "new-decision", at: LATER_AT }));
    assert.ok(!result.ok);
    assert.equal(result.session, candidate, "a corrupt session is preserved, never repaired during a story transition");
  }
});

type ArrayPath = readonly (string | number)[];

function arrayAt(value: unknown, path: ArrayPath): unknown[] {
  let child = value;
  for (const key of path) child = (child as Record<string | number, unknown>)[key];
  assert.ok(Array.isArray(child));
  return child;
}

// Each mutation models caller behavior that must never run during validation,
// copying or a failed transition. Fresh fixtures keep corruptions independent.
const arrayCorruptions: readonly [string, (array: unknown[], handler: () => unknown) => void][] = [
  ["serialization hook", (array, handler) => Object.defineProperty(array, "toJSON", { value: handler })],
  ["serialization getter", (array, handler) => Object.defineProperty(array, "toJSON", { get: handler })],
  ["own iterator", (array, handler) => Object.defineProperty(array, Symbol.iterator, { value: handler })],
  ["iterator getter", (array, handler) => Object.defineProperty(array, Symbol.iterator, { get: handler })],
  ["index getter", (array, handler) => Object.defineProperty(array, "0", { get: handler, enumerable: true, configurable: true })],
  ["extra property", (array) => Object.defineProperty(array, "extra", { value: true })],
  ["extra symbol", (array) => Object.defineProperty(array, Symbol("extra"), { value: true })],
  ["sparse indices", (array) => { array.length = Math.max(array.length, 1); delete array[0]; }],
  ["hidden index", (array) => Object.defineProperty(array, "0", { value: array[0], enumerable: false, configurable: true })],
  ["custom prototype", (array, handler) => {
    const prototype = Object.create(Array.prototype);
    Object.defineProperty(prototype, Symbol.iterator, { get: handler });
    Object.defineProperty(prototype, "toJSON", { value: handler });
    Object.setPrototypeOf(array, prototype);
  }],
  ["null prototype", (array) => { Object.setPrototypeOf(array, null); }],
];

function rejectArrayCorruptions<T>(source: T, paths: readonly ArrayPath[], reject: (value: T, label: string) => void): void {
  for (const path of paths) for (const [name, corrupt] of arrayCorruptions) {
    const candidate = jsonCopy(source);
    const array = arrayAt(candidate, path);
    let calls = 0;
    corrupt(array, () => { calls++; return []; });
    const before = Object.getOwnPropertyDescriptors(array);
    const prototype = Object.getPrototypeOf(array);
    const label = `${path.join(".")}: ${name}`;
    reject(candidate, label);
    assert.equal(calls, 0, `${label}: caller handler did not run`);
    assert.deepEqual(Object.getOwnPropertyDescriptors(array), before, `${label}: input descriptors unchanged`);
    assert.equal(Object.getPrototypeOf(array), prototype, `${label}: input prototype unchanged`);
    assert.equal(Object.isFrozen(array), false, `${label}: rejected input was not frozen`);
  }
}

test("entry rejects behavioral or sparse arrays at every input position without invoking handlers", () => {
  rejectArrayCorruptions(entry(), [
    ["bannerDraft", "heraldry", "field"], ["cast"], ["cast", 0, "relationshipFacts"],
    ["cast", 1, "relationshipFacts"], ["storyFacts"],
  ], (candidate, label) => assert.equal(createInheritedSession(candidate).ok, false, label));
});

test("story choices reject behavioral arrays before iteration and preserve the current session", () => {
  const current = session();
  rejectArrayCorruptions(choice(), [["personIds"], ["relationshipEffects"], ["storyEffects"]], (candidate, label) => {
    const result = applyInheritedStoryChoice(current, candidate);
    assert.equal(result.ok, false, label);
    assert.equal(result.session, current, label);
  });
});

test("saved sessions reject behavioral arrays including nested recorded choices before invoking handlers", () => {
  const applied = applyInheritedStoryChoice(session(), choice());
  assert.ok(applied.ok);
  rejectArrayCorruptions(applied.session, [
    ["banner", "heraldry", "field"], ["cast"], ["cast", 0, "relationshipFacts"],
    ["cast", 1, "relationshipFacts"], ["storyFacts"], ["choices"],
    ["choices", 0, "personIds"], ["choices", 0, "relationshipEffects"], ["choices", 0, "storyEffects"],
  ], (candidate, label) => {
    assert.notEqual(validateInheritedSession(candidate), null, label);
    const result = applyInheritedStoryChoice(candidate, choice({ choiceId: "test-decision-b", at: LATER_AT }));
    assert.equal(result.ok, false, label);
    assert.equal(result.session, candidate, label);
  });
});

test("every successful constructor, parser and transition result revalidates independently of caller mutations", () => {
  const supplied = jsonCopy(entry());
  const created = createInheritedSession(supplied);
  assert.ok(created.ok);
  assert.equal(validateInheritedSession(created.session), null);
  Object.defineProperty(supplied.cast, "toJSON", { value: () => [] });
  (supplied.cast[0] as { id: string }).id = "changed-after-entry";
  assert.equal(validateInheritedSession(created.session), null);
  assert.equal(created.session.cast[0].id, "test-person-a");
  const parsed = parseInheritedSession(JSON.stringify(created.session));
  assert.ok(parsed.ok);
  assert.equal(validateInheritedSession(parsed.session), null);
  const suppliedChoice = jsonCopy(choice());
  const applied = applyInheritedStoryChoice(parsed.session, suppliedChoice);
  assert.ok(applied.ok);
  assert.equal(validateInheritedSession(applied.session), null);
  Object.defineProperty(suppliedChoice.storyEffects, "toJSON", { value: () => [] });
  (suppliedChoice.storyEffects[0] as { value: boolean }).value = false;
  assert.equal(validateInheritedSession(applied.session), null);
  assert.equal(applied.session.choices[0].storyEffects[0].value, true);
  const retry = applyInheritedStoryChoice(applied.session, choice({ at: LATER_AT }));
  assert.ok(retry.ok);
  assert.equal(retry.status, "already-applied");
  assert.equal(retry.session, applied.session);
  assert.equal(validateInheritedSession(retry.session), null);
});

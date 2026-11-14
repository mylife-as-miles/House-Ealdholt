import assert from "node:assert/strict";
import test from "node:test";
import { chooseInheritedBannerDesign, createInheritedBannerDraft } from "../aethelgard/entry-draft";
import { EALDHOLT_HOUSE } from "../aethelgard/house";
import {
  applyInheritedStoryChoice, createInheritedSession, parseInheritedSession, validateInheritedSession,
  type InheritedSession,
} from "../aethelgard/inherited-session";
import {
  createEaldholtDraftChoice, EALDHOLT_DRAFT_CAST, EALDHOLT_DRAFT_STORY_FACTS,
  EALDHOLT_PEOPLE_DRAFT, EALDHOLT_PEOPLE_DRAFT_STATUS, findEaldholtDraftPerson, getEaldholtDraftDialogue,
} from "../aethelgard/people-draft";

const ENTRY_AT = "2026-11-06T10:00:00.000Z";
const CHOICE_AT = "2026-11-06T10:01:00.000Z";
const LATER_AT = "2026-11-06T10:02:00.000Z";

function session(): InheritedSession {
  const banner = chooseInheritedBannerDesign(createInheritedBannerDraft(), {
    division: "per-pale", field: ["azure", "argent"], ordinary: "none",
    ordinaryTincture: "or", charge: "key", chargeTincture: "sable",
  });
  assert.ok(banner.ok);
  const result = createInheritedSession({
    type: "enter-inherited-house", origin: "inherited", houseId: EALDHOLT_HOUSE.id,
    nationId: EALDHOLT_HOUSE.nationId, bannerDraft: banner.draft, bannerConfirmed: true,
    at: ENTRY_AT, cast: EALDHOLT_DRAFT_CAST, storyFacts: EALDHOLT_DRAFT_STORY_FACTS,
  });
  assert.ok(result.ok);
  return result.session;
}

function identityAndStructure(state: InheritedSession) {
  const { cast, storyFacts, choices, updatedAt, ...unchanged } = state;
  return {
    ...unchanged,
    cast: cast.map((person) => ({ id: person.id, factIds: person.relationshipFacts.map((fact) => fact.id) })),
    storyFactIds: storyFacts.map((fact) => fact.id),
  };
}

test("the replaceable draft registers only three roles and explicit unselected facts", () => {
  assert.equal(EALDHOLT_PEOPLE_DRAFT_STATUS, "working-draft");
  assert.deepEqual(EALDHOLT_PEOPLE_DRAFT.map((person) => [person.id, person.roleLabel]), [
    ["ealdholt-house-steward", "House steward"],
    ["ealdholt-village-smith", "Village smith"],
    ["ealdholt-house-messenger", "House messenger"],
  ]);
  assert.deepEqual(EALDHOLT_DRAFT_CAST.map((person) => person.id), EALDHOLT_PEOPLE_DRAFT.map((person) => person.id));
  assert.equal(new Set(EALDHOLT_PEOPLE_DRAFT.map((person) => person.decision.id)).size, 3);
  assert.equal(new Set(EALDHOLT_DRAFT_STORY_FACTS.map((fact) => fact.id)).size, 3);
  for (const person of EALDHOLT_PEOPLE_DRAFT) {
    assert.equal(person.decision.options.length, 2);
    assert.equal(new Set(person.decision.options.map((option) => option.id)).size, 2);
    const cast = EALDHOLT_DRAFT_CAST.find((candidate) => candidate.id === person.id);
    assert.ok(cast);
    assert.deepEqual(cast.relationshipFacts, person.decision.options.map((option) => ({ id: option.relationshipFactId, value: false })));
    assert.ok(EALDHOLT_DRAFT_STORY_FACTS.some((fact) => fact.id === person.decision.storyFactId && fact.value === false));
    assert.equal(findEaldholtDraftPerson(person.id), person);
  }
  assert.equal(Reflect.set(EALDHOLT_PEOPLE_DRAFT[0], "roleLabel", "Replacement"), false);
  assert.equal(Reflect.set(EALDHOLT_PEOPLE_DRAFT[0].decision.options[0], "relationshipFactId", "unknown"), false);
  assert.equal(Reflect.set(EALDHOLT_DRAFT_CAST[0].relationshipFacts[0], "value", true), false);
  assert.equal(Reflect.set(EALDHOLT_DRAFT_STORY_FACTS[0], "value", true), false);
});

for (const person of EALDHOLT_PEOPLE_DRAFT) for (const option of person.decision.options) {
  test(`${person.roleLabel}: ${option.id} applies registered facts, persists and remains a once-only choice`, () => {
    const initial = session();
    const before = JSON.stringify(initial);
    const initialData = JSON.stringify([EALDHOLT_DRAFT_CAST, EALDHOLT_DRAFT_STORY_FACTS]);
    const open = getEaldholtDraftDialogue(person.id, initial);
    assert.ok(open);
    assert.equal(open.greeting, person.greeting);
    assert.equal(open.prompt, person.decision.prompt);
    assert.equal(open.options.length, 2);
    assert.equal(open.recordedOptionId, null);
    assert.equal(open.returnToBoardLabel, "Return to the board");

    const built = createEaldholtDraftChoice(person.id, option.id, CHOICE_AT);
    assert.ok(built.ok);
    assert.equal(built.choice.at, CHOICE_AT);
    assert.deepEqual(built.choice.personIds, [person.id]);
    for (const effect of built.choice.relationshipEffects) {
      assert.ok(initial.cast.some((candidate) => candidate.id === effect.personId
        && candidate.relationshipFacts.some((fact) => fact.id === effect.factId)));
    }
    for (const effect of built.choice.storyEffects) assert.ok(initial.storyFacts.some((fact) => fact.id === effect.factId));
    assert.deepEqual(Object.keys(built.choice).sort(), ["at", "choiceId", "optionId", "personIds", "relationshipEffects", "storyEffects", "type"]);
    assert.equal(Reflect.set(built.choice.relationshipEffects[0], "value", false), false);

    const applied = applyInheritedStoryChoice(initial, built.choice);
    assert.ok(applied.ok);
    assert.equal(applied.status, "applied");
    assert.equal(validateInheritedSession(applied.session), null);
    assert.deepEqual(identityAndStructure(applied.session), identityAndStructure(initial));
    assert.equal(applied.session.updatedAt, CHOICE_AT);
    assert.equal(applied.session.choices.length, 1);
    for (const cast of applied.session.cast) {
      if (cast.id !== person.id) {
        assert.deepEqual(cast, initial.cast.find((candidate) => candidate.id === cast.id));
      } else {
        for (const fact of cast.relationshipFacts) assert.equal(fact.value, fact.id === option.relationshipFactId);
      }
    }
    for (const fact of applied.session.storyFacts) assert.equal(fact.value, fact.id === person.decision.storyFactId);
    assert.equal(Reflect.set(applied.session.house, "name", "Replacement"), false);
    assert.equal(Reflect.set(applied.session.banner.heraldry.field, "0", "gules"), false);
    for (const key of ["chess", "standing", "rank", "matches", "currency", "members", "foundedAt"]) {
      assert.equal(key in applied.session, false);
      assert.equal(key in built.choice, false);
    }

    const parsed = parseInheritedSession(JSON.stringify(applied.session));
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.session, applied.session);
    const resumedData = JSON.stringify(parsed.session);
    const returned = getEaldholtDraftDialogue(person.id, parsed.session);
    assert.ok(returned);
    assert.equal(returned.greeting, option.returnGreeting);
    assert.notEqual(returned.greeting, open.greeting);
    assert.equal(returned.recordedOptionId, option.id);
    assert.equal(returned.prompt, null);
    assert.deepEqual(returned.options, []);
    assert.equal(returned.returnToBoardLabel, "Return to the board");
    assert.deepEqual(getEaldholtDraftDialogue(person.id, parsed.session), returned);
    assert.equal(JSON.stringify(parsed.session), resumedData, "revisiting never records or consumes a choice");

    const retry = createEaldholtDraftChoice(person.id, option.id, LATER_AT);
    assert.ok(retry.ok);
    const replay = applyInheritedStoryChoice(parsed.session, retry.choice);
    assert.ok(replay.ok);
    assert.equal(replay.status, "already-applied");
    assert.equal(replay.session, parsed.session);
    const alternate = person.decision.options.find((candidate) => candidate.id !== option.id);
    assert.ok(alternate);
    const changed = createEaldholtDraftChoice(person.id, alternate.id, LATER_AT);
    assert.ok(changed.ok);
    const refused = applyInheritedStoryChoice(parsed.session, changed.choice);
    assert.ok(!refused.ok);
    assert.equal(refused.session, parsed.session);
    assert.equal(JSON.stringify(initial), before);
    assert.equal(JSON.stringify([EALDHOLT_DRAFT_CAST, EALDHOLT_DRAFT_STORY_FACTS]), initialData);
  });
}

test("all three independent conversations continue together without changing identity, banner or other fields", () => {
  const original = session();
  let current = original;
  for (const [index, person] of EALDHOLT_PEOPLE_DRAFT.entries()) {
    const built = createEaldholtDraftChoice(person.id, person.decision.options[index % 2].id, `2026-11-06T10:0${index + 1}:00.000Z`);
    assert.ok(built.ok);
    const applied = applyInheritedStoryChoice(current, built.choice);
    assert.ok(applied.ok);
    const parsed = parseInheritedSession(JSON.stringify(applied.session));
    assert.ok(parsed.ok);
    current = parsed.session;
    assert.deepEqual(identityAndStructure(current), identityAndStructure(original));
    assert.equal(current.choices.length, index + 1);
    assert.equal(current.storyFacts.filter((fact) => fact.value).length, index + 1);
  }
  for (const person of EALDHOLT_PEOPLE_DRAFT) {
    const dialogue = getEaldholtDraftDialogue(person.id, current);
    assert.ok(dialogue?.recordedOptionId);
    assert.equal(dialogue.options.length, 0);
  }
  assert.deepEqual(Object.keys(current).sort(), Object.keys(original).sort());
  assert.deepEqual(original.choices, []);
});

test("unknown roles, cross-role options, unavailable saved responses and invalid timestamps fail without creating entry", () => {
  for (const id of ["", "unknown", "__proto__", "constructor"]) {
    assert.equal(findEaldholtDraftPerson(id), undefined);
    assert.equal(getEaldholtDraftDialogue(id, null), undefined);
    assert.equal(createEaldholtDraftChoice(id, "individual-concerns", CHOICE_AT).ok, false);
  }
  const person = EALDHOLT_PEOPLE_DRAFT[0];
  for (const optionId of ["", "unknown", EALDHOLT_PEOPLE_DRAFT[1].decision.options[0].id]) {
    assert.equal(createEaldholtDraftChoice(person.id, optionId, CHOICE_AT).ok, false);
  }
  for (const at of ["", "invalid", "2026-02-30T10:00:00.000Z", "2026-11-06T10:01:00Z", "2026-11-06T10:01:00.000+00:00"]) {
    assert.equal(createEaldholtDraftChoice(person.id, person.decision.options[0].id, at).ok, false);
  }
  const built = createEaldholtDraftChoice(person.id, person.decision.options[0].id, CHOICE_AT);
  assert.ok(built.ok);
  assert.equal(getEaldholtDraftDialogue(person.id, { choices: [{ ...built.choice, optionId: "replaced-option" }] }), undefined);
  const unsaved = getEaldholtDraftDialogue(person.id, null);
  assert.ok(unsaved);
  assert.equal(unsaved.recordedOptionId, null);
  assert.equal(unsaved.options.length, 2);
  assert.equal("session" in unsaved, false);
  assert.equal("bannerConfirmed" in unsaved, false);
  assert.ok(EALDHOLT_DRAFT_CAST.every((cast) => cast.relationshipFacts.every((fact) => fact.value === false)));
  assert.ok(EALDHOLT_DRAFT_STORY_FACTS.every((fact) => fact.value === false));
});

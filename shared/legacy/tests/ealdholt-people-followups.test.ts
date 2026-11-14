import assert from "node:assert/strict";
import test from "node:test";
import { chooseInheritedBannerDesign, createInheritedBannerDraft } from "../aethelgard/entry-draft";
import { EALDHOLT_HOUSE } from "../aethelgard/house";
import {
  applyInheritedStoryChoice, createInheritedSession, parseInheritedSession, validateInheritedSession,
  type InheritedSession,
} from "../aethelgard/inherited-session";
import { createEaldholtDraftChoice, EALDHOLT_DRAFT_CAST, EALDHOLT_DRAFT_STORY_FACTS, EALDHOLT_PEOPLE_DRAFT } from "../aethelgard/people-draft";
import { EALDHOLT_PEOPLE_FOLLOWUPS, EALDHOLT_PEOPLE_FOLLOWUPS_STATUS, getEaldholtDraftFollowup } from "../aethelgard/people-followups";

function session(): InheritedSession {
  const banner = chooseInheritedBannerDesign(createInheritedBannerDraft(), {
    division: "per-pale", field: ["azure", "argent"], ordinary: "none",
    ordinaryTincture: "or", charge: "key", chargeTincture: "sable",
  });
  assert.ok(banner.ok);
  const created = createInheritedSession({
    type: "enter-inherited-house", origin: "inherited", houseId: EALDHOLT_HOUSE.id,
    nationId: EALDHOLT_HOUSE.nationId, bannerDraft: banner.draft, bannerConfirmed: true,
    at: "2026-11-06T10:00:00.000Z", cast: EALDHOLT_DRAFT_CAST, storyFacts: EALDHOLT_DRAFT_STORY_FACTS,
  });
  assert.ok(created.ok);
  return created.session;
}

test("the working registry covers exactly the six known role responses with read-only question/reply content", () => {
  assert.equal(EALDHOLT_PEOPLE_FOLLOWUPS_STATUS, "working-draft");
  assert.deepEqual(Object.keys(EALDHOLT_PEOPLE_FOLLOWUPS), EALDHOLT_PEOPLE_DRAFT.map(person => person.id));
  const questions = new Set<string>(), replies = new Set<string>();
  for (const person of EALDHOLT_PEOPLE_DRAFT) {
    const followups = EALDHOLT_PEOPLE_FOLLOWUPS[person.id];
    assert.deepEqual(Object.keys(followups), person.decision.options.map(option => option.id));
    assert.equal(Object.isFrozen(followups), true);
    for (const followup of Object.values(followups)) {
      assert.deepEqual(Object.keys(followup).sort(), ["question", "reply"]);
      assert.ok(followup.question.endsWith("?"));
      assert.ok(followup.question.length <= 70);
      assert.ok(followup.reply.length <= 140);
      assert.equal(Object.isFrozen(followup), true);
      questions.add(followup.question); replies.add(followup.reply);
    }
  }
  assert.equal(questions.size, 6);
  assert.equal(replies.size, 6);
  assert.equal(Reflect.set(EALDHOLT_PEOPLE_FOLLOWUPS, "another-role", {}), false);
});

for (const person of EALDHOLT_PEOPLE_DRAFT) for (const option of person.decision.options) {
  test(`${person.roleLabel}: ${option.id} reveals only its recorded follow-up and survives reload unchanged`, () => {
    const initial = session();
    assert.equal(getEaldholtDraftFollowup(person.id, initial), null);
    const built = createEaldholtDraftChoice(person.id, option.id, "2026-11-06T10:01:00.000Z");
    assert.ok(built.ok);
    const applied = applyInheritedStoryChoice(initial, built.choice);
    assert.ok(applied.ok);
    const parsed = parseInheritedSession(JSON.stringify(applied.session));
    assert.ok(parsed.ok);
    const state = parsed.session;
    const before = JSON.stringify(state);
    const facts = [state.cast, state.storyFacts, state.choices, state.house, state.banner];
    const followup = getEaldholtDraftFollowup(person.id, state);
    assert.ok(followup);
    assert.equal(followup, EALDHOLT_PEOPLE_FOLLOWUPS[person.id][option.id]);
    assert.equal(Reflect.set(followup, "reply", "A replacement"), false);
    for (let visit = 0; visit < 4; visit++) assert.equal(getEaldholtDraftFollowup(person.id, state), followup);
    for (const other of EALDHOLT_PEOPLE_DRAFT.filter(candidate => candidate.id !== person.id)) {
      assert.equal(getEaldholtDraftFollowup(other.id, state), null);
    }
    assert.equal(JSON.stringify(state), before, "following up never writes or consumes the saved choice");
    assert.deepEqual([state.cast, state.storyFacts, state.choices, state.house, state.banner], facts);
    assert.equal(state.choices.length, 1);
    assert.equal(state.updatedAt, built.choice.at);
    assert.equal(validateInheritedSession(state), null);
    assert.deepEqual(Object.keys(followup).sort(), ["question", "reply"], "a follow-up carries no new effects, timestamp or action");
  });
}

test("unknown roles, unrecorded choices, wrong-role records and unknown saved options reveal nothing", () => {
  const initial = session();
  for (const personId of ["", "unknown", "__proto__", "constructor", ...EALDHOLT_PEOPLE_DRAFT.map(person => person.id)]) {
    assert.equal(getEaldholtDraftFollowup(personId, null), null);
    assert.equal(getEaldholtDraftFollowup(personId, initial), null);
  }
  const person = EALDHOLT_PEOPLE_DRAFT[0];
  const built = createEaldholtDraftChoice(person.id, person.decision.options[0].id, "2026-11-06T10:01:00.000Z");
  assert.ok(built.ok);
  for (const record of [
    { ...built.choice, optionId: "retired-option" },
    { ...built.choice, optionId: EALDHOLT_PEOPLE_DRAFT[1].decision.options[0].id },
    { ...built.choice, choiceId: "unknown-decision" },
    { ...built.choice, personIds: [EALDHOLT_PEOPLE_DRAFT[1].id] },
    { ...built.choice, personIds: [] },
  ]) {
    const supplied = { choices: [record] };
    const before = JSON.stringify(supplied);
    assert.equal(getEaldholtDraftFollowup(person.id, supplied), null);
    assert.equal(JSON.stringify(supplied), before);
    assert.equal(Object.isFrozen(supplied), false, "the selector does not take ownership of caller data");
  }
  const factsOnly = {
    ...initial,
    cast: initial.cast.map(cast => ({ ...cast, relationshipFacts: cast.relationshipFacts.map(fact => ({ ...fact, value: true })) })),
    storyFacts: initial.storyFacts.map(fact => ({ ...fact, value: true })),
  };
  assert.equal(getEaldholtDraftFollowup(person.id, factsOnly), null, "boolean facts do not manufacture a recorded decision");
});

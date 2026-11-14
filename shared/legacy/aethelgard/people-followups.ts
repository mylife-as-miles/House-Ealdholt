// Replaceable working dialogue only. These optional follow-ups read an existing
// direction; they create no choice, fact, task, event or progression of their own.
import type { InheritedSession } from "./inherited-session";
import { findEaldholtDraftPerson, type EaldholtDraftPersonId } from "./people-draft";

export interface EaldholtDraftFollowup {
  readonly question: string;
  readonly reply: string;
}

export const EALDHOLT_PEOPLE_FOLLOWUPS_STATUS = "working-draft" as const;

export const EALDHOLT_PEOPLE_FOLLOWUPS: Readonly<Record<EaldholtDraftPersonId, Readonly<Record<string, EaldholtDraftFollowup>>>> = Object.freeze({
  "ealdholt-house-steward": Object.freeze({
    "private-hearing": Object.freeze({
      question: "How can others answer a concern heard in private?",
      reply: "A private word can start the discussion. If a concern affects others, I would make room to hear them together.",
    }),
    "open-discussion": Object.freeze({
      question: "What if someone will not speak before the household?",
      reply: "I would leave room for a private word. An open discussion need not force anyone to speak.",
    }),
  }),
  "ealdholt-village-smith": Object.freeze({
    "shared-correction": Object.freeze({
      question: "What if the help is not wanted?",
      reply: "I would ask what they want to put right on their own, and where they would welcome help.",
    }),
    "explanation-first": Object.freeze({
      question: "What if the words are hard to find?",
      reply: "I would let them begin with what went wrong. The reason can wait until they are ready to say it.",
    }),
  }),
  "ealdholt-house-messenger": Object.freeze({
    "relay-uncertainty": Object.freeze({
      question: "What if there is only one account?",
      reply: "I would make clear that it comes from one source. I would not give one account the weight of several.",
    }),
    "clarification-first": Object.freeze({
      question: "What if the accounts still disagree?",
      reply: "I would bring both, with the remaining disagreement clear. Clarification need not end in agreement.",
    }),
  }),
});

/** The recorded decision, registered option and participating role must agree.
 * Facts alone never imply that a choice occurred. Repeated reads return the
 * same immutable content without consuming or adding anything to the session. */
export function getEaldholtDraftFollowup(personId: string, session: Pick<InheritedSession, "choices"> | null): EaldholtDraftFollowup | null {
  const person = findEaldholtDraftPerson(personId);
  if (!person || !session) return null;
  const recorded = session.choices.find(choice => choice.choiceId === person.decision.id);
  if (!recorded || !recorded.personIds.includes(person.id)
    || !person.decision.options.some(option => option.id === recorded.optionId)) return null;
  return EALDHOLT_PEOPLE_FOLLOWUPS[person.id as EaldholtDraftPersonId][recorded.optionId] ?? null;
}

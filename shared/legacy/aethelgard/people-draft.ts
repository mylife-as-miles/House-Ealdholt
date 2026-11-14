// Replaceable working fiction for the continuing cast. These are role IDs and
// labels only: names, appearances and histories remain undecided. Importing this
// module neither creates an inherited session nor confirms entry or a banner.
import type { InheritedCastPerson, InheritedFact, InheritedSession, InheritedStoryChoice } from "./inherited-session";

export const EALDHOLT_PEOPLE_DRAFT_STATUS = "working-draft" as const;

export interface EaldholtDraftOption {
  readonly id: string;
  readonly label: string;
  readonly response: string;
  readonly returnGreeting: string;
  /** Records the direction selected, never a completed task or a trust score. */
  readonly relationshipFactId: string;
}

export interface EaldholtDraftPerson {
  readonly id: string;
  readonly roleLabel: string;
  readonly greeting: string;
  readonly decision: {
    readonly id: string;
    readonly prompt: string;
    readonly storyFactId: string;
    readonly options: readonly [EaldholtDraftOption, EaldholtDraftOption];
  };
}

/** Internal content/new output only; never freezes caller-owned session data. */
function freezeDraft<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeDraft(child);
    Object.freeze(value);
  }
  return value;
}

export const EALDHOLT_PEOPLE_DRAFT = freezeDraft([
  {
    id: "ealdholt-house-steward",
    roleLabel: "House steward",
    greeting: "Some concerns are hard to raise before others. Should they be heard privately, or discussed together?",
    decision: {
      id: "ealdholt-household-hearings",
      prompt: "How should the house hear concerns?",
      storyFactId: "household-hearings-direction-selected",
      options: [
        {
          id: "private-hearing",
          label: "Offer a private hearing.",
          response: "In private, then. Some words are easier without an audience.",
          returnGreeting: "You chose private hearings. There is room for words that are difficult to say before others.",
          relationshipFactId: "private-hearing-selected",
        },
        {
          id: "open-discussion",
          label: "Invite an open household discussion.",
          response: "Together, then. A shared discussion gives others a chance to answer.",
          returnGreeting: "You chose open discussion. Other voices have a place in how a concern is understood.",
          relationshipFactId: "open-discussion-selected",
        },
      ],
    },
  },
  {
    id: "ealdholt-village-smith",
    roleLabel: "Village smith",
    greeting: "When someone admits an error, what should come first: help putting it right, or a chance to explain?",
    decision: {
      id: "ealdholt-smith-admitted-error",
      prompt: "What should come first after an error?",
      storyFactId: "smith-admitted-error-direction-selected",
      options: [
        {
          id: "shared-correction",
          label: "Start with a shared correction.",
          response: "Put it right together, then. An error need not be carried alone.",
          returnGreeting: "Shared correction comes first, as you asked. The conversation can begin with what would help.",
          relationshipFactId: "shared-correction-selected",
        },
        {
          id: "explanation-first",
          label: "Give them room to explain first.",
          response: "Hear them out first. The reason may matter as much as the mistake.",
          returnGreeting: "Explanation comes first, as you asked. I want to understand the cause before offering an answer.",
          relationshipFactId: "explanation-first-selected",
        },
      ],
    },
  },
  {
    id: "ealdholt-house-messenger",
    roleLabel: "House messenger",
    greeting: "Two accounts can disagree without either telling the whole story. Should I relay the uncertainty, or seek clarification first?",
    decision: {
      id: "ealdholt-messenger-conflicting-accounts",
      prompt: "How should conflicting accounts be handled?",
      storyFactId: "messenger-conflicting-accounts-direction-selected",
      options: [
        {
          id: "relay-uncertainty",
          label: "Relay both, with the uncertainty clear.",
          response: "Both accounts, with the gap left visible. Uncertainty should not sound like certainty.",
          returnGreeting: "You asked to hear uncertainty plainly. Questions can travel with the account.",
          relationshipFactId: "relay-uncertainty-selected",
        },
        {
          id: "clarification-first",
          label: "Seek clarification before relaying them.",
          response: "Clarification first. A disagreement deserves more than a tidy summary.",
          returnGreeting: "You asked for clarification first. The gaps matter as much as what seems settled.",
          relationshipFactId: "clarification-first-selected",
        },
      ],
    },
  },
] as const satisfies readonly EaldholtDraftPerson[]);

export type EaldholtDraftPersonId = typeof EALDHOLT_PEOPLE_DRAFT[number]["id"];

/** Explicit initial data, supplied only after the UI confirms inherited entry.
 * All facts start false; no greeting or prior choice is assumed to have occurred. */
export const EALDHOLT_DRAFT_CAST: readonly InheritedCastPerson[] = freezeDraft(
  EALDHOLT_PEOPLE_DRAFT.map((person) => ({
    id: person.id,
    relationshipFacts: person.decision.options.map((option) => ({ id: option.relationshipFactId, value: false })),
  })),
);

export const EALDHOLT_DRAFT_STORY_FACTS: readonly InheritedFact[] = freezeDraft(
  EALDHOLT_PEOPLE_DRAFT.map((person) => ({ id: person.decision.storyFactId, value: false })),
);

export function findEaldholtDraftPerson(personId: string): EaldholtDraftPerson | undefined {
  return EALDHOLT_PEOPLE_DRAFT.find((person) => person.id === personId);
}

export interface EaldholtDraftDialogue {
  readonly personId: string;
  readonly roleLabel: string;
  readonly greeting: string;
  readonly prompt: string | null;
  readonly options: readonly EaldholtDraftOption[];
  readonly recordedOptionId: string | null;
  readonly returnToBoardLabel: "Return to the board";
}

/** null permits unsaved content inspection, with no implicit session entry.
 * A recorded decision is acknowledged without offering another decision.
 * Unknown saved options fail lookup so replaced content cannot invent a reply. */
export function getEaldholtDraftDialogue(personId: string, session: Pick<InheritedSession, "choices"> | null): EaldholtDraftDialogue | undefined {
  const person = findEaldholtDraftPerson(personId);
  if (!person) return undefined;
  const previous = session?.choices.find((choice) => choice.choiceId === person.decision.id);
  const selected = previous && person.decision.options.find((option) => option.id === previous.optionId);
  if (previous && !selected) return undefined;
  return freezeDraft({
    personId: person.id,
    roleLabel: person.roleLabel,
    greeting: selected?.returnGreeting ?? person.greeting,
    prompt: selected ? null : person.decision.prompt,
    options: selected ? [] : person.decision.options,
    recordedOptionId: selected?.id ?? null,
    returnToBoardLabel: "Return to the board",
  });
}

export type EaldholtDraftChoiceResult =
  | { readonly ok: true; readonly choice: InheritedStoryChoice }
  | { readonly ok: false; readonly error: string };

/** Constructs registered effects only. The inherited core owns validation,
 * application and once-only/idempotent decisions; the caller owns time and I/O. */
export function createEaldholtDraftChoice(personId: string, optionId: string, at: string): EaldholtDraftChoiceResult {
  const person = findEaldholtDraftPerson(personId);
  if (!person) return { ok: false, error: "Choose a registered draft role." };
  const option = person.decision.options.find((candidate) => candidate.id === optionId);
  if (!option) return { ok: false, error: "Choose an available response for this role." };
  // Parsing the supplied timestamp reads no current clock.
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at)
    || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) {
    return { ok: false, error: "Supply a canonical UTC timestamp for this choice." };
  }
  return {
    ok: true,
    choice: freezeDraft({
      type: "story-choice",
      choiceId: person.decision.id,
      optionId: option.id,
      at,
      personIds: [person.id],
      relationshipEffects: person.decision.options.map((candidate) => ({
        personId: person.id, factId: candidate.relationshipFactId, value: candidate.id === option.id,
      })),
      storyEffects: [{ factId: person.decision.storyFactId, value: true }],
    }),
  };
}

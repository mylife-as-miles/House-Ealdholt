// Engine-independent data contract used by the opt-in inherited DEV experience. This
// is deliberately not a LegacySave: entry neither founds Ealdholt nor supplies
// historical rank, generated relatives, a crest, or chess progression.
import { validateHeraldry } from "../content/heraldry";
import type { Heraldry } from "../types";
import type { InheritedBannerDraft } from "./entry-draft";
import { EALDHOLT_HOUSE } from "./house";

export const INHERITED_SESSION_KIND = "inherited-aethelgard" as const;
export const INHERITED_SESSION_SCHEMA_VERSION = 1 as const;

/** IDs and initial values come from approved, replaceable content. There are no
 * default people, relationship scores, biographies, or story facts here. */
export interface InheritedFact {
  readonly id: string;
  readonly value: boolean;
}

export interface InheritedCastPerson {
  readonly id: string;
  readonly relationshipFacts: readonly InheritedFact[];
}

export interface InheritedEntry {
  readonly type: "enter-inherited-house";
  readonly origin: "inherited";
  readonly houseId: typeof EALDHOLT_HOUSE.id;
  readonly nationId: typeof EALDHOLT_HOUSE.nationId;
  readonly bannerDraft: InheritedBannerDraft;
  readonly bannerConfirmed: true;
  /** Canonical UTC ISO timestamp from the caller; this module reads no clock. */
  readonly at: string;
  readonly cast: readonly InheritedCastPerson[];
  readonly storyFacts: readonly InheritedFact[];
}

export interface InheritedStoryChoice {
  readonly type: "story-choice";
  /** A decision can be recorded once; optionId identifies its chosen response. */
  readonly choiceId: string;
  readonly optionId: string;
  readonly at: string;
  readonly personIds: readonly string[];
  readonly relationshipEffects: readonly { readonly personId: string; readonly factId: string; readonly value: boolean }[];
  readonly storyEffects: readonly { readonly factId: string; readonly value: boolean }[];
}

export interface InheritedSession {
  readonly kind: typeof INHERITED_SESSION_KIND;
  readonly schemaVersion: typeof INHERITED_SESSION_SCHEMA_VERSION;
  readonly house: {
    readonly id: typeof EALDHOLT_HOUSE.id;
    readonly name: typeof EALDHOLT_HOUSE.name;
    readonly nationId: typeof EALDHOLT_HOUSE.nationId;
    readonly origin: "inherited";
  };
  /** A newly confirmed player design, with no claim about a historical crest. */
  readonly banner: { readonly confirmed: true; readonly heraldry: Readonly<Heraldry> };
  /** A factual session entry, never a founding or an account of inheritance. */
  readonly entry: { readonly type: "inherited-entry"; readonly at: string };
  readonly updatedAt: string;
  readonly cast: readonly InheritedCastPerson[];
  readonly storyFacts: readonly InheritedFact[];
  readonly choices: readonly InheritedStoryChoice[];
}

export type InheritedSessionResult =
  | { ok: true; session: InheritedSession }
  | { ok: false; reason: "incompatible" | "future-version" | "corrupt"; error: string };

export type InheritedStoryChoiceResult =
  | { ok: true; session: InheritedSession; status: "applied" | "already-applied" }
  | { ok: false; session: InheritedSession; error: string };

type Data = Record<string, unknown>;

function object(value: unknown): value is Data {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Refuse unknown fields instead of allowing a story event to carry identity,
 * banner, standing or chess edits. Only plain enumerable data is accepted. */
function shape(value: unknown, keys: readonly string[]): value is Data {
  return object(value) && Reflect.ownKeys(value).length === keys.length && keys.every((key) => {
    const field = Object.getOwnPropertyDescriptor(value, key);
    return field?.enumerable === true && "value" in field;
  });
}

/** Check descriptors before reading elements or using an iterator. A normal
 * dense data array has only its own indices and length, including when frozen. */
function dataArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (!length || !("value" in length) || !Number.isInteger(length.value) || length.value < 0
    || length.enumerable !== false || length.configurable !== false) return false;
  if (Reflect.ownKeys(value).length !== length.value + 1) return false;
  for (let index = 0; index < length.value; index++) {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (!item || !("value" in item) || item.enumerable !== true) return false;
  }
  return true;
}

function id(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value);
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function heraldryError(value: unknown): string | null {
  if (!shape(value, ["division", "field", "ordinary", "ordinaryTincture", "charge", "chargeTincture"])) return "The banner design has unexpected or missing fields.";
  if (!dataArray(value.field) || value.field.length !== 2) return "The banner field needs exactly two plain data tinctures.";
  const result = validateHeraldry(value);
  return result.ok === true ? null : result.errors.join(" ");
}

function factsError(value: unknown, path: string): string | null {
  if (!dataArray(value)) return `${path} must be a dense plain data array.`;
  const seen = new Set<string>();
  for (const fact of value) {
    if (!shape(fact, ["id", "value"]) || !id(fact.id) || typeof fact.value !== "boolean") return `${path} needs fact IDs and boolean values only.`;
    if (seen.has(fact.id)) return `${path} has a duplicate fact ID.`;
    seen.add(fact.id);
  }
  return null;
}

function castError(value: unknown): string | null {
  if (!dataArray(value) || value.length === 0) return "Supply the fixed cast IDs explicitly in a dense plain data array.";
  const seen = new Set<string>();
  for (const person of value) {
    if (!shape(person, ["id", "relationshipFacts"]) || !id(person.id)) return "Each cast person needs an ID and relationshipFacts only.";
    if (seen.has(person.id)) return "The fixed cast has a duplicate person ID.";
    seen.add(person.id);
    const problem = factsError(person.relationshipFacts, `cast.${person.id}.relationshipFacts`);
    if (problem) return problem;
  }
  return null;
}

function choiceError(value: unknown, cast: readonly InheritedCastPerson[], storyFacts: readonly InheritedFact[]): string | null {
  if (!shape(value, ["type", "choiceId", "optionId", "at", "personIds", "relationshipEffects", "storyEffects"]) || value.type !== "story-choice") return "A story choice has unexpected or missing fields.";
  if (!id(value.choiceId) || !id(value.optionId) || !timestamp(value.at)) return "A story choice needs valid decision, option and timestamp values.";
  if (!dataArray(value.personIds) || new Set(value.personIds).size !== value.personIds.length) return "A story choice needs distinct registered person IDs in a dense plain data array.";
  for (const personId of value.personIds) {
    if (!id(personId) || !cast.some((person) => person.id === personId)) return "A story choice refers to an unregistered person.";
  }
  if (!dataArray(value.relationshipEffects) || !dataArray(value.storyEffects)) return "Story choice effects must be dense plain data arrays.";
  const relationships = new Set<string>();
  for (const effect of value.relationshipEffects) {
    if (!shape(effect, ["personId", "factId", "value"]) || !id(effect.personId) || !id(effect.factId) || typeof effect.value !== "boolean") return "A relationship effect needs personId, factId and a boolean value only.";
    const person = cast.find((candidate) => candidate.id === effect.personId);
    if (!value.personIds.includes(effect.personId) || !person?.relationshipFacts.some((fact) => fact.id === effect.factId)) return "A relationship effect refers to an unregistered person or relationship fact.";
    const key = `${effect.personId}/${effect.factId}`;
    if (relationships.has(key)) return "A story choice repeats a relationship effect.";
    relationships.add(key);
  }
  const stories = new Set<string>();
  for (const effect of value.storyEffects) {
    if (!shape(effect, ["factId", "value"]) || !id(effect.factId) || typeof effect.value !== "boolean") return "A story effect needs factId and a boolean value only.";
    if (!storyFacts.some((fact) => fact.id === effect.factId)) return "A story effect refers to an unregistered story fact.";
    if (stories.has(effect.factId)) return "A story choice repeats a story effect.";
    stories.add(effect.factId);
  }
  return null;
}

/** Validate the separate current schema without coercing an old founded save,
 * migrating it, mutating it, or filling missing content. */
export function validateInheritedSession(value: unknown): string | null {
  if (!shape(value, ["kind", "schemaVersion", "house", "banner", "entry", "updatedAt", "cast", "storyFacts", "choices"])) return "The inherited session has unexpected or missing fields.";
  if (value.kind !== INHERITED_SESSION_KIND || value.schemaVersion !== INHERITED_SESSION_SCHEMA_VERSION) return "The inherited session schema is unsupported.";
  if (!shape(value.house, ["id", "name", "nationId", "origin"]) || value.house.id !== EALDHOLT_HOUSE.id || value.house.name !== EALDHOLT_HOUSE.name || value.house.nationId !== EALDHOLT_HOUSE.nationId || value.house.origin !== "inherited") return "The approved inherited house identity cannot be changed.";
  if (!shape(value.banner, ["confirmed", "heraldry"]) || value.banner.confirmed !== true) return "The inherited session needs an explicitly confirmed banner.";
  const bannerProblem = heraldryError(value.banner.heraldry);
  if (bannerProblem) return bannerProblem;
  if (!shape(value.entry, ["type", "at"]) || value.entry.type !== "inherited-entry" || !timestamp(value.entry.at)) return "The session needs a factual inherited entry and valid timestamp.";
  if (!timestamp(value.updatedAt)) return "The session update timestamp is invalid.";
  const contentProblem = castError(value.cast) ?? factsError(value.storyFacts, "storyFacts");
  if (contentProblem) return contentProblem;
  if (!dataArray(value.choices)) return "Story choices must be a dense plain data array.";
  const cast = value.cast as readonly InheritedCastPerson[];
  const storyFacts = value.storyFacts as readonly InheritedFact[];
  const seen = new Set<string>();
  const lastRelationships = new Map<string, boolean>();
  const lastStories = new Map<string, boolean>();
  let lastAt = value.entry.at;
  for (const choice of value.choices) {
    const problem = choiceError(choice, cast, storyFacts);
    if (problem) return problem;
    const record = choice as InheritedStoryChoice;
    if (seen.has(record.choiceId)) return "The session has a duplicate story choice.";
    if (record.at < lastAt) return "Story choice timestamps are out of order.";
    seen.add(record.choiceId);
    lastAt = record.at;
    for (const effect of record.relationshipEffects) lastRelationships.set(`${effect.personId}/${effect.factId}`, effect.value);
    for (const effect of record.storyEffects) lastStories.set(effect.factId, effect.value);
  }
  if (value.updatedAt !== lastAt) return "The update timestamp must match the latest session record.";
  for (const person of cast) for (const fact of person.relationshipFacts) {
    const last = lastRelationships.get(`${person.id}/${fact.id}`);
    if (last !== undefined && last !== fact.value) return "A relationship fact disagrees with the recorded choices.";
  }
  for (const fact of storyFacts) {
    const last = lastStories.get(fact.id);
    if (last !== undefined && last !== fact.value) return "A story fact disagrees with the recorded choices.";
  }
  return null;
}

/** Only validated plain data reaches this copy. Read descriptors directly and
 * construct fresh containers; never call caller serialization hooks. */
function copyFrozenData<T>(value: T): T {
  if (Array.isArray(value)) {
    const copied: unknown[] = [];
    for (let index = 0; index < value.length; index++) copied.push(copyFrozenData(Object.getOwnPropertyDescriptor(value, String(index))!.value));
    return Object.freeze(copied) as T;
  }
  if (typeof value === "object" && value !== null) {
    const copied: Data = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(copied, key, { value: copyFrozenData(Object.getOwnPropertyDescriptor(value, key)!.value), enumerable: true });
    }
    return Object.freeze(copied) as T;
  }
  return value;
}

/** Only validated plain data reaches this helper; callers retain ownership of
 * every supplied object, while returned sessions are independently immutable. */
function ownSession(value: InheritedSession): InheritedSession {
  return copyFrozenData(value);
}

export function createInheritedSession(entry: unknown): InheritedSessionResult {
  if (!shape(entry, ["type", "origin", "houseId", "nationId", "bannerDraft", "bannerConfirmed", "at", "cast", "storyFacts"]) || entry.type !== "enter-inherited-house" || entry.origin !== "inherited") return { ok: false, reason: "incompatible", error: "Supply an explicit inherited-house entry; founding is not supported." };
  if (entry.houseId !== EALDHOLT_HOUSE.id || entry.nationId !== EALDHOLT_HOUSE.nationId) return { ok: false, reason: "incompatible", error: "Entry requires the approved Aethelgard house." };
  if (!shape(entry.bannerDraft, ["houseId", "heraldry"]) || entry.bannerDraft.houseId !== EALDHOLT_HOUSE.id || entry.bannerConfirmed !== true) return { ok: false, reason: "corrupt", error: "Confirm a valid banner for the inherited house before entry." };
  const session = {
    kind: INHERITED_SESSION_KIND,
    schemaVersion: INHERITED_SESSION_SCHEMA_VERSION,
    house: { id: EALDHOLT_HOUSE.id, name: EALDHOLT_HOUSE.name, nationId: EALDHOLT_HOUSE.nationId, origin: "inherited" },
    banner: { confirmed: true, heraldry: entry.bannerDraft.heraldry },
    entry: { type: "inherited-entry", at: entry.at },
    updatedAt: entry.at,
    cast: entry.cast,
    storyFacts: entry.storyFacts,
    choices: [],
  };
  const problem = validateInheritedSession(session);
  return problem ? { ok: false, reason: "corrupt", error: problem } : { ok: true, session: ownSession(session as InheritedSession) };
}

/** No storage access or migration. An incompatible or future save remains the
 * caller's data to preserve and recover; no replacement session is returned. */
export function parseInheritedSession(raw: string): InheritedSessionResult {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { ok: false, reason: "corrupt", error: "The inherited session is not valid JSON." }; }
  if (object(value) && value.kind !== INHERITED_SESSION_KIND) return { ok: false, reason: "incompatible", error: "This is not an inherited Aethelgard session." };
  if (object(value) && typeof value.schemaVersion === "number" && Number.isInteger(value.schemaVersion) && value.schemaVersion > INHERITED_SESSION_SCHEMA_VERSION) return { ok: false, reason: "future-version", error: "This inherited session needs a newer version." };
  const problem = validateInheritedSession(value);
  return problem ? { ok: false, reason: "corrupt", error: problem } : { ok: true, session: ownSession(value as InheritedSession) };
}

function choiceSignature(choice: InheritedStoryChoice): string {
  // Array ordering and a later retry timestamp do not make a second decision.
  return JSON.stringify([
    choice.optionId, [...choice.personIds].sort(),
    choice.relationshipEffects.map((effect) => [effect.personId, effect.factId, effect.value]).sort(),
    choice.storyEffects.map((effect) => [effect.factId, effect.value]).sort(),
  ]);
}

/** Only supplied, registered relationship/story facts can change. Chess results
 * and standing belong to a separate future contract, never to these effects. */
export function applyInheritedStoryChoice(session: InheritedSession, choice: unknown): InheritedStoryChoiceResult {
  const problem = validateInheritedSession(session) ?? choiceError(choice, session.cast, session.storyFacts);
  if (problem) return { ok: false, session, error: problem };
  const record = choice as InheritedStoryChoice;
  const previous = session.choices.find((item) => item.choiceId === record.choiceId);
  if (previous) return choiceSignature(previous) === choiceSignature(record)
    ? { ok: true, session, status: "already-applied" }
    : { ok: false, session, error: "This story decision already has a different recorded choice." };
  if (record.at < session.updatedAt) return { ok: false, session, error: "A story choice cannot precede the latest session record." };
  return {
    ok: true, status: "applied",
    session: ownSession({
      ...session,
      updatedAt: record.at,
      cast: session.cast.map((person) => ({ ...person, relationshipFacts: person.relationshipFacts.map((fact) => {
        const effect = record.relationshipEffects.find((item) => item.personId === person.id && item.factId === fact.id);
        return effect ? { id: fact.id, value: effect.value } : fact;
      }) })),
      storyFacts: session.storyFacts.map((fact) => {
        const effect = record.storyEffects.find((item) => item.factId === fact.id);
        return effect ? { id: fact.id, value: effect.value } : fact;
      }),
      choices: [...session.choices, record],
    }),
  };
}

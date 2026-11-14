// Opt-in persistence for the separate inherited DEV experience in both apps.
// This is not a LegacySave adapter, migration, reset or founding path.
import {
  LEGACY_STORAGE_KEY, parseLegacySave, type LegacyRefusalReason, type LegacyStorageLike,
} from "../domain/persistence";
import { archivePreviousLegacySave, PRE_AETHELGARD_ARCHIVE_KEY } from "./storage";
import {
  applyInheritedStoryChoice, createInheritedSession, parseInheritedSession,
  validateInheritedSession, type InheritedSession,
} from "./inherited-session";

// Deliberately distinct from crownfall.legacy.aethelgard.save, which contains
// earlier LegacySave experiments and cannot establish inherited identity.
export const INHERITED_SESSION_STORAGE_KEY = "crownfall.legacy.aethelgard.inherited-session";
export const INHERITED_PREDECESSOR_ARCHIVE_PREFIX = `${INHERITED_SESSION_STORAGE_KEY}.predecessor.`;

/** The caller MUST serialize the entire callback against every writer of the
 * archive and inherited slots. A shared cross-tab lock (for example Web Locks
 * in both app adapters) can do that; a per-instance promise queue cannot.
 * Original-save writers may continue independently: this store never changes
 * their bytes. Source checks detect observed changes, rather than claiming the
 * archived snapshot is the latest original at the instant entry is committed.
 *
 * No default is supplied: localStorage has no compare-and-swap or transaction.
 * The synchronous callback checks for intervening changes and verifies writes,
 * but cannot close a race between its last read and setItem without this lock.
 * Do not resolve until the callback completes; invoke it exactly once. */
export type SerializeInheritedOperation = <T>(operation: () => T) => Promise<T>;

export type InheritedStorageFailureReason =
  | "incompatible" | "future-version" | "corrupt" | "invalid-choice"
  | "unavailable" | "conflict" | "source-changed" | "verification-failed";

export interface InheritedStorageFailure {
  readonly ok: false;
  readonly reason: InheritedStorageFailureReason;
  readonly error: string;
}

export type InheritedSessionLoadResult =
  | { status: "empty" }
  | { status: "loaded"; session: InheritedSession }
  | { status: "invalid"; reason: InheritedStorageFailureReason; error: string };

/** Preservation verifies an exact observed snapshot; the original may change
 * independently afterward. no-previous-save means absence was observed.
 * raw-only does not mean the old save was repaired or converted to an empty
 * state. Its recovery is independent of this house. */
export type InheritedPredecessorPreservation =
  | { status: "no-previous-save" }
  | { status: "archived" | "already-archived"; key: string; previous: "valid" }
  | { status: "archived" | "already-archived"; key: string; previous: "raw-only"; reason: LegacyRefusalReason; error: string };

export type InheritedEntryStorageResult =
  | { ok: true; status: "entered"; session: InheritedSession; predecessor: InheritedPredecessorPreservation }
  | { ok: true; status: "already-entered"; session: InheritedSession }
  | InheritedStorageFailure;

export type InheritedChoiceStorageResult =
  | { ok: true; status: "applied" | "already-applied"; session: InheritedSession }
  | InheritedStorageFailure;

export interface InheritedSessionStore {
  /** One read only. Opening this store or loading it never archives or writes. */
  load(): InheritedSessionLoadResult;
  /** Accepts only the explicit, confirmed inherited entry contract. */
  enter(entry: unknown): Promise<InheritedEntryStorageResult>;
  /** Reads the current session inside the caller lock; never writes a UI copy. */
  choose(choice: unknown): Promise<InheritedChoiceStorageResult>;
}

function failure(reason: InheritedStorageFailureReason, error: string): InheritedStorageFailure {
  return { ok: false, reason, error };
}

function unavailable(): InheritedStorageFailure {
  return failure("unavailable", "Storage or operation serialization was unavailable. Existing saves were not removed or reset; a verified archive may remain after a failed entry.");
}

type Preservation =
  | { ok: true; source: string | null; predecessor: InheritedPredecessorPreservation }
  | InheritedStorageFailure;

/** Use the existing conservative raw-copy helper first. If its fixed archive
 * holds another snapshot, append to the first unused numbered slot instead of
 * overwriting either snapshot. A bounded scan refuses entry when full. */
function preservePredecessor(storage: LegacyStorageLike): Preservation {
  const source = storage.getItem(LEGACY_STORAGE_KEY);
  const archived = archivePreviousLegacySave(storage);
  if (!archived.ok && archived.reason !== "archive-conflict") return failure(archived.reason, archived.error);
  if (storage.getItem(LEGACY_STORAGE_KEY) !== source) {
    return failure("source-changed", "The predecessor changed during preservation. Its snapshots and current save were left in place; retry after other save activity settles.");
  }
  if (archived.ok && archived.previous.kind === "none") {
    return { ok: true, source, predecessor: { status: "no-previous-save" } };
  }

  let key = PRE_AETHELGARD_ARCHIVE_KEY;
  let status: "archived" | "already-archived";
  let previous: Exclude<Extract<ReturnType<typeof archivePreviousLegacySave>, { ok: true }>["previous"], { kind: "none" }>;
  if (archived.ok && archived.previous.kind !== "none") {
    status = archived.status as "archived" | "already-archived";
    previous = archived.previous;
  } else {
    // A conflicting fixed archive implies a non-null source. Classify its raw
    // snapshot without migration writes or a synthetic empty Legacy state.
    const parsed = parseLegacySave(source!);
    previous = parsed.ok ? { kind: "valid", parsed } : { kind: "recovery-required", parsed };
    let found = false;
    status = "already-archived";
    for (let index = 1; index <= 1024; index++) {
      key = `${INHERITED_PREDECESSOR_ARCHIVE_PREFIX}${index}`;
      const snapshot = storage.getItem(key);
      if (snapshot !== null && snapshot !== source) continue;
      if (storage.getItem(LEGACY_STORAGE_KEY) !== source) return failure("source-changed", "The predecessor changed before it could be preserved. All existing snapshots were retained.");
      if (storage.getItem(key) !== snapshot) return failure("conflict", "The archive slot changed during preservation. It was not overwritten.");
      if (snapshot === null) {
        storage.setItem(key, source!);
        status = "archived";
      }
      if (storage.getItem(key) !== source) return failure("verification-failed", "The predecessor archive bytes could not be verified. Entry was stopped; the current predecessor was retained.");
      found = true;
      break;
    }
    if (!found) return failure("conflict", "The predecessor archive slots are full. Existing snapshots and the current predecessor were retained.");
  }
  if (storage.getItem(LEGACY_STORAGE_KEY) !== source) return failure("source-changed", "The predecessor changed after preservation. Its earlier snapshot and current save were retained.");
  const predecessor: InheritedPredecessorPreservation = previous.kind === "valid"
    ? { status, key, previous: "valid" }
    : { status, key, previous: "raw-only", reason: previous.parsed.reason, error: previous.parsed.error };
  return { ok: true, source, predecessor };
}

/** Validation happens before any preservation/write. Re-read the expected
 * slot and predecessor immediately before committing. Failed verification is
 * reported without rollback: rollback could overwrite a competing writer. */
function writeVerified(storage: LegacyStorageLike, expected: string | null, session: InheritedSession, predecessor?: Preservation & { ok: true }): InheritedStorageFailure | null {
  const problem = validateInheritedSession(session);
  if (problem) return failure("corrupt", problem);
  const raw = JSON.stringify(session);
  if (storage.getItem(INHERITED_SESSION_STORAGE_KEY) !== expected) return failure("conflict", "The inherited slot changed during this operation. It was not overwritten.");
  if (predecessor && storage.getItem(LEGACY_STORAGE_KEY) !== predecessor.source) return failure("source-changed", "The predecessor changed before entry. The preserved snapshot and current save were retained.");
  if (predecessor && predecessor.predecessor.status !== "no-previous-save"
    && storage.getItem(predecessor.predecessor.key) !== predecessor.source) return failure("verification-failed", "The predecessor archive changed before entry. The current predecessor was retained.");
  storage.setItem(INHERITED_SESSION_STORAGE_KEY, raw);
  return storage.getItem(INHERITED_SESSION_STORAGE_KEY) === raw ? null
    : failure("verification-failed", "The inherited session bytes could not be verified. Reload before retrying; existing saves and archives were not removed or reset.");
}

/** Construction is inert. The caller provides storage and operation ownership;
 * no global localStorage, clock, app, renderer or default serialization exists.
 * Earlier Aethelgard experiments and every estate key remain untouched. */
export function createInheritedSessionStore(storage: LegacyStorageLike, serialize: SerializeInheritedOperation): InheritedSessionStore {
  if (typeof serialize !== "function") throw new TypeError("Supply operation serialization covering all archive and inherited slot writers.");
  return {
    load() {
      try {
        const raw = storage.getItem(INHERITED_SESSION_STORAGE_KEY);
        if (raw === null) return { status: "empty" };
        const parsed = parseInheritedSession(raw);
        return parsed.ok ? { status: "loaded", session: parsed.session }
          : { status: "invalid", reason: parsed.reason, error: parsed.error };
      } catch {
        const refused = unavailable();
        return { status: "invalid", reason: refused.reason, error: refused.error };
      }
    },
    async enter(entry) {
      const candidate = createInheritedSession(entry);
      if (!candidate.ok) return candidate;
      try {
        return await serialize<InheritedEntryStorageResult>(() => {
          const expected = storage.getItem(INHERITED_SESSION_STORAGE_KEY);
          if (expected !== null) {
            const existing = parseInheritedSession(expected);
            if (!existing.ok) return existing;
            return JSON.stringify(existing.session) === JSON.stringify(candidate.session)
              ? { ok: true, status: "already-entered", session: existing.session }
              : failure("conflict", "An inherited session already occupies this slot. Load it to continue; entry cannot replace it.");
          }
          const preservation = preservePredecessor(storage);
          if (!preservation.ok) return preservation;
          const refused = writeVerified(storage, expected, candidate.session, preservation);
          return refused ?? { ok: true, status: "entered", session: candidate.session, predecessor: preservation.predecessor };
        });
      } catch { return unavailable(); }
    },
    async choose(choice) {
      try {
        return await serialize<InheritedChoiceStorageResult>(() => {
          const expected = storage.getItem(INHERITED_SESSION_STORAGE_KEY);
          if (expected === null) return failure("conflict", "Enter the inherited house explicitly before recording a story choice.");
          const loaded = parseInheritedSession(expected);
          if (!loaded.ok) return loaded;
          const applied = applyInheritedStoryChoice(loaded.session, choice);
          if (!applied.ok) return failure("invalid-choice", applied.error);
          if (applied.status === "already-applied") return { ok: true, status: "already-applied", session: applied.session };
          const refused = writeVerified(storage, expected, applied.session);
          return refused ?? { ok: true, status: "applied", session: applied.session };
        });
      } catch { return unavailable(); }
    },
  };
}

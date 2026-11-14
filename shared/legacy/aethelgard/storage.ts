// Preparation for the replacement experience; neither app consumes this adapter
// yet. The original save and its archive are never edited or removed here.
import {
  LEGACY_STORAGE_KEY, loadLegacy, parseLegacySave,
  type LegacyLoadResult, type LegacyParseResult, type LegacyStorageLike,
} from "../domain/persistence";

export const AETHELGARD_STORAGE_KEY = "crownfall.legacy.aethelgard.save";
export const PRE_AETHELGARD_ARCHIVE_KEY = "crownfall.legacy.pre-aethelgard.archive";

type PreviousSave =
  | { kind: "none" }
  | { kind: "valid"; parsed: Extract<LegacyParseResult, { ok: true }> }
  | { kind: "recovery-required"; parsed: Extract<LegacyParseResult, { ok: false }> };

export type PreviousSaveArchiveResult =
  | { ok: true; status: "no-previous-save"; previous: Extract<PreviousSave, { kind: "none" }> }
  | { ok: true; status: "archived" | "already-archived"; previous: Exclude<PreviousSave, { kind: "none" }> }
  | { ok: false; reason: "unavailable" | "archive-conflict" | "source-changed" | "verification-failed"; error: string };

/** Preserve the exact stored string, even when it needs recovery. An unreadable
 * predecessor is not converted into an empty state or silently discarded. This
 * helper copies only; it does not initialize or activate the replacement.
 * Web Storage has no cross-tab transaction: live callers must also serialize
 * source/archive/slot operations before this is wired into either app. */
export function archivePreviousLegacySave(storage: LegacyStorageLike): PreviousSaveArchiveResult {
  try {
    const raw = storage.getItem(LEGACY_STORAGE_KEY);
    if (raw === null) return { ok: true, status: "no-previous-save", previous: { kind: "none" } };
    const parsed = parseLegacySave(raw);
    const previous: Exclude<PreviousSave, { kind: "none" }> = parsed.ok
      ? { kind: "valid", parsed }
      : { kind: "recovery-required", parsed };
    const archived = storage.getItem(PRE_AETHELGARD_ARCHIVE_KEY);
    if (archived !== null && archived !== raw) {
      return { ok: false, reason: "archive-conflict", error: "An archive already preserves a different previous save. Both it and the current save were left unchanged." };
    }
    if (storage.getItem(LEGACY_STORAGE_KEY) !== raw) {
      return { ok: false, reason: "source-changed", error: "The previous save changed during preservation. It was left unchanged." };
    }
    if (archived === raw) return { ok: true, status: "already-archived", previous };
    storage.setItem(PRE_AETHELGARD_ARCHIVE_KEY, raw);
    if (storage.getItem(PRE_AETHELGARD_ARCHIVE_KEY) !== raw) {
      return { ok: false, reason: "verification-failed", error: "The archive could not be verified. The previous save was left unchanged." };
    }
    if (storage.getItem(LEGACY_STORAGE_KEY) !== raw) {
      return { ok: false, reason: "source-changed", error: "The previous save changed during preservation. Its earlier snapshot was archived; the current save was left unchanged." };
    }
    return { ok: true, status: "archived", previous };
  } catch {
    return { ok: false, reason: "unavailable", error: "The previous save could not be preserved in storage. It was not edited or removed." };
  }
}

function assertExpectedKey(key: string): void {
  if (key !== LEGACY_STORAGE_KEY) throw new Error("This adapter accepts only the Legacy save key.");
}

/** An opt-in slot adapter for existing persistence functions. Construction has no
 * storage effects. It cannot read, reset or overwrite the original slot through
 * the normal Legacy API. Writes require a valid Aethelgard house and a verified
 * predecessor copy. Schema and kingdom checks cannot establish an inherited
 * identity: the caller must supply approved house data through an explicit entry
 * contract rather than passing a synthetic founding off as that house's history. */
export function createAethelgardStorageAdapter(storage: LegacyStorageLike): LegacyStorageLike {
  return {
    getItem(key) {
      assertExpectedKey(key);
      return storage.getItem(AETHELGARD_STORAGE_KEY);
    },
    setItem(key, value) {
      assertExpectedKey(key);
      const candidate = parseLegacySave(value);
      if (!candidate.ok) throw new Error(candidate.error);
      if (candidate.state.banner?.nationId !== "aethelgard") throw new Error("The replacement slot requires an Aethelgard house.");
      const preservation = archivePreviousLegacySave(storage);
      if (!preservation.ok) throw new Error(preservation.error);
      if (preservation.previous.kind === "recovery-required") {
        throw new Error("The previous save has been preserved but needs recovery before replacement can continue.");
      }
      storage.setItem(AETHELGARD_STORAGE_KEY, value);
    },
    removeItem(key) {
      assertExpectedKey(key);
      storage.removeItem(AETHELGARD_STORAGE_KEY);
    },
  };
}

/** A separate slot does not convert an old Aethelgard house into an inherited
 * one. Only reads the replacement slot; absence still needs approved house data. */
export function loadAethelgardSave(storage: LegacyStorageLike): LegacyLoadResult {
  const loaded = loadLegacy(createAethelgardStorageAdapter(storage));
  if (loaded.status === "loaded" && loaded.state.banner?.nationId !== "aethelgard") {
    return { status: "invalid", reason: "corrupt", error: "The replacement slot does not contain an Aethelgard house." };
  }
  return loaded;
}

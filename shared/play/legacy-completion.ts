import { loadLegacy, saveLegacy, type LegacyStorageLike } from '../legacy/domain/persistence';
import { reduceLegacy } from '../legacy/domain/reducer';
import type { LegacyMatchRecord } from '../legacy/types';

/** Only original, explicitly linked engine matches call this boundary. Replay code never imports it. */
export function commitOriginalLegacyMatch(storage: LegacyStorageLike | null, record: LegacyMatchRecord): { ok: boolean; message: string } {
  if (!storage) return { ok: false, message: 'Legacy could not be saved on this device.' };
  const loaded = loadLegacy(storage);
  if (loaded.status !== 'loaded') return { ok: false, message: 'The Legacy save could not be read. Its data is unchanged.' };
  if (loaded.state.processedMatchIds.includes(record.matchId)) return { ok: true, message: 'Legacy already recorded for this match.' };
  const transition = reduceLegacy(loaded.state, { type: 'record-match', record });
  if (transition.error) return { ok: false, message: transition.error };
  const saved = saveLegacy(storage, transition.state);
  return saved.ok ? { ok: true, message: 'Legacy recorded for this match.' } : { ok: false, message: saved.error };
}

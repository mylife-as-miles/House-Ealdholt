import { createMusterRecorder, type MusterMatchSetup, type MusterGameSource } from '../../../web/src/legacy/musterBridge';
import { commitOriginalLegacyMatch } from '../../../shared/play/legacy-completion';
import { getLegacyStorage } from '../legacy/storage';

export function beginOriginalLegacyMatch(game: MusterGameSource, setup: MusterMatchSetup, onNotice: (message: string) => void) {
  const recorder = createMusterRecorder(game, setup, { now: () => new Date().toISOString() });
  void recorder.whenComplete().then(record => onNotice(commitOriginalLegacyMatch(getLegacyStorage(), record).message)).catch(error => onNotice(error.message));
  return recorder;
}

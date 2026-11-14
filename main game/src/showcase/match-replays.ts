import type { ReplayEntry } from '../../../shared/showcase/types';
import { sessionForPage } from './useShowcaseSession';

/**
 * Saves a finished match's replay to the Showcase archive. The entry is added to the archive only: whatever replay the
 * Showcase has open stays open (M-22). The session is woken just long enough to read its archive, and left as it was.
 */
export async function saveMatchReplay(entry: ReplayEntry) {
  const session = sessionForPage();
  const wasSuspended = session.isSuspended;
  session.setSuspended(false);
  try {
    await session.ready;
    return await session.archive(entry);
  } finally {
    if (wasSuspended) session.setSuspended(true);
  }
}

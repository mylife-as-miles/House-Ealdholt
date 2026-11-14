import { useState } from 'react';
import type { MusterMatchSetup } from '../../../web/src/legacy/musterBridge';
import { loadLegacy } from '../../../shared/legacy/domain/persistence';
import { LEGACY_COPY } from '../../../shared/legacy/content/copy';
import { NATIONS } from '../../../shared/legacy/content/nations';
import { getLegacyStorage } from '../legacy/storage';

/** Explicit house stakes are reviewed before loading or starting a linked match. */
export default function LegacyMatchReview({ setup, onAccept, onBack }: { setup: MusterMatchSetup; onAccept(): void; onBack(): void }) {
  const [loaded] = useState(() => { const storage = getLegacyStorage(); return storage ? loadLegacy(storage) : null; });
  const state = loaded?.status === 'loaded' ? loaded.state : null;
  const challenge = state?.notices.find(n => n.id === setup.challengeId);
  const eligible = !!state?.banner && (setup.stakes !== 'muster' || challenge?.status === 'accepted');
  const stakes = LEGACY_COPY.stakes[setup.stakes];
  return <section className="match-setup" aria-label="Legacy match stakes">
    <h1>{stakes.label}</h1><h2>{state?.banner?.name ?? 'Legacy unavailable'}</h2>
    <p>Opponent: {NATIONS[setup.opponentNationId].name}</p><p>{stakes.description}</p>
    {challenge?.wager && <p>{challenge.wager}</p>}
    <p>{eligible ? 'These stakes apply once when the original match ends. Watching or saving its replay adds no consequences.' : 'Return to My Legacy to review this challenge before starting.'}</p>
    <footer><button onClick={onBack}>Back</button><button disabled={!eligible} onClick={onAccept}>Accept stakes and start</button></footer>
  </section>;
}

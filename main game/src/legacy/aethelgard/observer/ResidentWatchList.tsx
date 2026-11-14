import React from 'react';
import { EALDHOLT_WATCH_RESIDENTS } from '../../../../../shared/legacy/aethelgard/observer/resident-watch';
import type { ChronicleResident } from '../../../../../shared/legacy/aethelgard/observer/village-chronicle';
import { predicate } from '../../../../../shared/legacy/aethelgard/observer/village-chronicle';
import { displayPopulationActivity } from '../../../../../shared/legacy/aethelgard/characters/village-activity-presentation';
import type { VillagePopulationResidentState } from '../../../../../shared/legacy/aethelgard/characters/village-population-runtime';

/** Existing Watch rows and scrolling remain unchanged; the shared registry owns
 * every selectable identity and label, including ordinary residents. */
export function ResidentWatchList({ followId, stateOf, overlayFor, onFollow }: {
  followId: string | null;
  stateOf(id: string): VillagePopulationResidentState | undefined;
  overlayFor(id: string): ChronicleResident | undefined;
  onFollow(id: string): void;
}) {
  return <div className="obs-watch-list" role="group" aria-label="Villagers">
    {EALDHOLT_WATCH_RESIDENTS.map((resident, index) => {
      const state = stateOf(resident.id);
      return <button key={resident.id} type="button" className="obs-row" data-nav data-nav-default={index === 0 || undefined}
        data-observer-watch={resident.id} aria-pressed={followId === resident.id} onClick={() => onFollow(resident.id)}>
        <span className="obs-row-name">{resident.label}</span>
        {state && <span className="obs-row-note">{predicate(displayPopulationActivity(state, overlayFor(resident.id)))}</span>}
      </button>;
    })}
  </div>;
}

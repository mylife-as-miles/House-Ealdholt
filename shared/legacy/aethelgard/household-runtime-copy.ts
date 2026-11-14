import type { HouseholdRuntimeSnapshot } from './household-runtime';
import type { HouseholdSimulation } from './household-simulation';
import { getPeopleLifeEventsRegistry } from './people-life-events';
import { getPeopleLifeRoutine } from './people-life';

/** Shared wording for the opt-in, finite household experiment. This is separate
 * from villagers' dialogue and never claims a continuously running server. */
export const HOUSEHOLD_RUNTIME_COPY = Object.freeze({
  loading: 'Loading household activity…',
  error: 'Household activity is unavailable. Reopen People to retry.',
  catchingUp: 'Catching up household activity…',
});
export function describeHouseholdRuntime(snapshot: {
  readonly phase: string; readonly completedTasks: number; readonly totalTasks: number;
  readonly deferredSteps: number;
} | null): string | null {
  if (!snapshot || ['disabled', 'entry-required', 'disposed'].includes(snapshot.phase)) return null;
  if (snapshot.phase === 'unavailable') return HOUSEHOLD_RUNTIME_COPY.error;
  if (snapshot.deferredSteps > 0 || snapshot.phase === 'running') return HOUSEHOLD_RUNTIME_COPY.catchingUp;
  return `Household prototype · ${snapshot.completedTasks} of ${snapshot.totalTasks} activities recorded.`;
}

export const HOUSEHOLD_ACTIVITY_COPY = Object.freeze({
  heading: 'Household activity',
  prototypeNote: 'Work in progress. Planned routines are separate from recorded activity.',
  recordedActivity: 'Recorded activity',
  plannedRoutine: 'Planned routine',
  household: 'Household',
  role: 'Role',
  resident: 'Resident',
  family: 'Family',
  socialTies: 'Relationships',
  latestEvent: 'Latest recorded event',
  previous: 'Previous resident',
  next: 'Next resident',
  details: 'Next detail',
  open: 'Household activity',
  close: 'Back to People',
});

export interface HouseholdResidentActivity {
  readonly id: string;
  readonly label: string;
  readonly role: string;
  readonly household: string;
  readonly family: readonly string[];
  readonly socialTies: readonly string[];
  readonly recordedActivity: string;
  readonly plannedRoutine: string;
  readonly latestEvent: string | null;
}
export interface HouseholdActivityPanel {
  readonly residents: readonly HouseholdResidentActivity[];
}

const clockTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const activityKind = (kind: string) => kind === 'meet' ? 'Meeting' : kind === 'service' ? 'Service' : 'Activity';

/** Read-only projection of an accepted runtime snapshot. Recorded endpoints,
 * task phases and occurred events never come from intended routine locations.
 * These abstract records are not evidence of rendered movement or witnessing. */
export function getHouseholdActivityPanel(snapshot: HouseholdRuntimeSnapshot | null): HouseholdActivityPanel | null {
  if (!snapshot?.simulation || !['ready', 'deferred', 'running'].includes(snapshot.phase)) return null;
  const simulation: HouseholdSimulation = snapshot.simulation;
  const registry = getPeopleLifeEventsRegistry(simulation.events);
  const personLabel = (id: string) => registry.residents.find(person => person.id === id)!.label;
  const placeLabel = (id: string) => registry.places.find(place => place.id === id)!.label;
  const minute = simulation.events.world.elapsedSteps % 1440;
  const residents = registry.residents.map(person => {
    const actor = simulation.actors.find(actor => actor.residentId === person.id)!;
    const action = actor.actionId ? simulation.actions.find(action => action.id === actor.actionId) : undefined;
    const task = action ? simulation.definition.tasks.find(task => task.id === action.id) : undefined;
    const use = task ? simulation.definition.catalog.uses.find(use => use.id === task.useId) : undefined;
    let recordedActivity = actor.placeId ? `At ${placeLabel(actor.placeId)}; no activity in progress.` : 'No current location recorded.';
    if (action && task && use) {
      const destination = placeLabel(use.placeId);
      if (action.status === 'travelling') recordedActivity = `Travelling toward ${destination}.`;
      else if (action.status === 'queued') recordedActivity = `Waiting for ${activityKind(use.kind).toLowerCase()} at ${destination}.`;
      else if (action.status === 'working') recordedActivity = `${activityKind(use.kind)} in progress at ${destination}.`;
      else if (action.status === 'interrupted') recordedActivity = actor.placeId
        ? `Activity interrupted at ${placeLabel(actor.placeId)}.` : `Journey toward ${destination} interrupted.`;
    }
    const routine = getPeopleLifeRoutine(registry, person.id, minute);
    const plannedRoutine = routine
      ? `${clockTime(routine.startMinute)}-${clockTime(routine.endMinute)}: ${routine.activity} at ${placeLabel(routine.placeId)}.`
      : 'No routine planned for this time.';
    const occurred = simulation.events.events.reduce<(typeof simulation.events.events)[number] | null>((latest, event) =>
      event.actorIds.includes(person.id) && (!latest || event.atStep >= latest.atStep) ? event : latest, null);
    let latestEvent: string | null = null;
    if (occurred) {
      const completed = simulation.definition.tasks.find(task => task.completion.eventId === occurred.id);
      const completedUse = completed && simulation.definition.catalog.uses.find(use => use.id === completed.useId);
      latestEvent = `${completedUse ? `${activityKind(completedUse.kind)} completed` : 'Event recorded'} at ${placeLabel(occurred.placeId)}.`;
    }
    return Object.freeze({
      id: person.id, label: person.label, role: person.role.label,
      household: registry.households.find(household => household.id === person.homeHouseholdId)!.label,
      family: Object.freeze(person.family.kind === 'local-kin'
        ? person.family.ties.map(tie => `${personLabel(tie.residentId)}: ${tie.description}`)
        : [person.family.explanation]),
      socialTies: Object.freeze(person.socialTies.map(tie => `${personLabel(tie.residentId)}: ${tie.description}`)),
      recordedActivity, plannedRoutine, latestEvent,
    });
  });
  return residents.length ? Object.freeze({ residents: Object.freeze(residents) }) : null;
}

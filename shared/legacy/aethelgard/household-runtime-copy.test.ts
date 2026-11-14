import assert from 'node:assert/strict';
import test from 'node:test';
import { createPeopleLifeEventsSnapshot } from './people-life-events';
import { advanceHouseholdSimulation, applyHouseholdCommand, createHouseholdSimulation, type HouseholdSimulation } from './household-simulation';
import type { HouseholdRuntimeSnapshot } from './household-runtime';
import { getHouseholdActivityPanel } from './household-runtime-copy';

const START = 1000000, STEP = 1000, A = 'test-panel-a', B = 'test-panel-b', HOME = 'test-panel-home', WELL = 'test-panel-well';
function initial(): HouseholdSimulation {
  const ids = [A, B];
  const events = createPeopleLifeEventsSnapshot({
    places: [{ id: HOME, label: 'Test home' }, { id: WELL, label: 'Test well' }],
    households: [{ id: 'test-panel-household', label: 'Test household', homePlaceId: HOME, memberIds: ids }],
    residents: ids.map((id, index) => ({ id, label: `Test adult ${index + 1}`, identityNote: 'An ordinary synthetic adult.',
      role: { id: 'test-panel-duty', label: 'Test role', purpose: 'A synthetic activity projection.' },
      influenceSensitivity: 'occasional' as const, homeHouseholdId: 'test-panel-household',
      family: { kind: 'local-kin' as const, ties: [{ residentId: ids[1 - index], kind: 'sibling' as const, description: 'A reciprocal test sibling.' }] },
      socialTies: [{ residentId: ids[1 - index], description: 'A reciprocal test friendship.' }],
      routine: [{ startMinute: 0, endMinute: 1440, activity: 'Planned rest', placeId: HOME, companionIds: [] }],
      decisionMemory: { source: 'inherited-story-choices' as const },
    })),
  }, { facts: [], eventTypes: [{ id: 'test-panel-event', factIds: [], allowsFamilyRevision: false }], familyRules: [] },
  { startedAt: START, stepMilliseconds: STEP, seed: 7 });
  assert.ok(events.ok);
  const result = createHouseholdSimulation(events.snapshot, {
    revision: 'test-panel-v1', proof: 'abstract-route-fixture',
    catalog: { schema: 1, anchors: ['test-panel-home-anchor', 'test-panel-well-anchor'],
      residents: ids.map(id => ({ id, householdId: 'test-panel-household' })),
      households: [{ id: 'test-panel-household', homePlaceId: HOME }],
      places: [{ id: HOME, kind: 'home', anchorId: 'test-panel-home-anchor', hours: [] }, { id: WELL, kind: 'service', anchorId: 'test-panel-well-anchor', hours: [] }],
      resources: [{ id: 'test-panel-stance', placeId: WELL, anchorId: 'test-panel-well-anchor', kind: 'service', capacity: 1, access: { kind: 'public' }, hours: [] }],
      uses: [{ id: 'test-panel-use', placeId: WELL, kind: 'service', requires: [{ resourceId: 'test-panel-stance', units: 1 }] }],
    },
    routes: [{ id: 'test-panel-route', fromPlaceId: HOME, toPlaceId: WELL, travelMinutes: 2 }],
    initialPlaces: ids.map(residentId => ({ residentId, placeId: HOME })),
    tasks: ids.map((residentId, index) => ({ id: `test-panel-task-${index}`, residentId, routeId: 'test-panel-route', useId: 'test-panel-use', startsAt: 1, workMinutes: 3,
      completion: { eventId: `test-panel-event-${index}`, typeId: 'test-panel-event', effects: [], witnesses: [{ residentId: ids[1 - index], knowledgeId: `test-panel-witness-${index}` }] },
    })),
  });
  assert.ok(result.ok); return result.snapshot;
}
function at(simulation: HouseholdSimulation, minute: number): HouseholdSimulation {
  const result = advanceHouseholdSimulation(simulation, { expectedGeneration: simulation.generation, observedAt: START + minute * STEP, maxSteps: 1440 });
  assert.ok(result.ok); return result.snapshot;
}
function snapshot(simulation: HouseholdSimulation, phase: HouseholdRuntimeSnapshot['phase'] = 'ready'): HouseholdRuntimeSnapshot {
  return { phase, simulation, busy: false, deferredSteps: 0, completedTasks: simulation.actions.filter(action => action.status === 'completed').length,
    totalTasks: simulation.actions.length, finite: true, error: null, reason: null };
}

test('plans do not replace recorded locations or fabricate performed work', () => {
  const simulation = at(initial(), 3), before = JSON.stringify(simulation);
  const panel = getHouseholdActivityPanel(snapshot(simulation)); assert.ok(panel);
  assert.equal(panel.residents.length, 2);
  assert.match(panel.residents[0].recordedActivity, /Service in progress at Test well/);
  assert.match(panel.residents[1].recordedActivity, /Waiting for service at Test well/);
  for (const resident of panel.residents) { assert.match(resident.plannedRoutine, /Planned rest at Test home/); assert.equal(resident.latestEvent, null); }
  assert.equal(JSON.stringify(simulation), before);
});

test('initial residents retain identities, family perspectives and household without claiming scheduled tasks happened', () => {
  const panel = getHouseholdActivityPanel(snapshot(initial())); assert.ok(panel);
  assert.equal(panel.residents[0].label, 'Test adult 1');
  assert.equal(panel.residents[0].household, 'Test household');
  assert.deepEqual(panel.residents[0].family, ['Test adult 2: A reciprocal test sibling.']);
  assert.deepEqual(panel.residents[1].socialTies, ['Test adult 1: A reciprocal test friendship.']);
  assert.match(panel.residents[0].recordedActivity, /At Test home; no activity in progress/);
  assert.ok(Object.isFrozen(panel) && Object.isFrozen(panel.residents) && Object.isFrozen(panel.residents[0].family));
});

test('travel and interruption use action records rather than an intended destination as a current endpoint', () => {
  const travelling = at(initial(), 2);
  assert.equal(getHouseholdActivityPanel(snapshot(travelling))?.residents[0].recordedActivity, 'Travelling toward Test well.');
  const interrupted = applyHouseholdCommand(travelling, { expectedGeneration: travelling.generation, command: { id: 'test-panel-stop', kind: 'interrupt', taskId: 'test-panel-task-0' } });
  assert.ok(interrupted.ok);
  assert.equal(getHouseholdActivityPanel(snapshot(interrupted.snapshot))?.residents[0].recordedActivity, 'Journey toward Test well interrupted.');
});

test('latest event requires actual participation; witnessing another person does not become their completed work', () => {
  const simulation = at(initial(), 6), panel = getHouseholdActivityPanel(snapshot(simulation)); assert.ok(panel);
  assert.ok(simulation.events.knowledge.some(knowledge => knowledge.residentId === B));
  assert.equal(panel.residents[0].latestEvent, 'Service completed at Test well.');
  assert.equal(panel.residents[1].latestEvent, null);
  assert.match(panel.residents[1].recordedActivity, /Service in progress/);
  const reopened = JSON.parse(JSON.stringify(simulation)) as HouseholdSimulation;
  assert.deepEqual(getHouseholdActivityPanel(snapshot(reopened)), panel);
});

test('unsupported, suspended and failed runtime phases hide old activity data', () => {
  const simulation = initial(); assert.equal(getHouseholdActivityPanel(null), null);
  for (const phase of ['disabled', 'entry-required', 'idle', 'unavailable', 'suspended', 'disposed'] as const)
    assert.equal(getHouseholdActivityPanel(snapshot(simulation, phase)), null);
  for (const phase of ['ready', 'deferred', 'running'] as const)
    assert.equal(getHouseholdActivityPanel(snapshot(simulation, phase))?.residents.length, 2);
});

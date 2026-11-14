import assert from 'node:assert/strict';
import test from 'node:test';
import { createPeopleLifeEventsSnapshot } from './people-life-events';
import { createHouseholdSimulation, advanceHouseholdSimulation, applyHouseholdCommand, parseHouseholdSimulation, serializeHouseholdSimulation,
  type HouseholdSimulation, type HouseholdDefinition } from './household-simulation';
import { createResidentRoutePresentation, type ResidentRoutePresentationOptions, type ResidentRoutePhase } from './route-presentation';

// Synthetic coordinates/identities only. These fixtures are not Elderbloom
// geometry, animation qualification, household canon or physical walk proof.
const MODEL = 'a'.repeat(64), ACTOR = 'b'.repeat(64), START = 1000, STEP = 100;
const A = 'test-a', B = 'test-b', C = 'test-c', HOME = 'test-home', WELL = 'test-well', REST = 'test-rest';
const HA = 'test-home-approach', WA = 'test-well-approach', RA = 'test-rest-approach';
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function fixture(): HouseholdSimulation {
  const people = [A, B, C], registry = { places: [HOME, WELL, REST].map(id => ({ id, label: 'Synthetic exterior place' })),
    households: [{ id: 'test-household', label: 'Synthetic household', homePlaceId: HOME, memberIds: people }],
    residents: people.map(id => ({ id, label: 'Synthetic adult', identityNote: 'Synthetic ordinary resident.', influenceSensitivity: 'occasional' as const,
      role: { id: 'test-role', label: 'Synthetic role', purpose: 'Exercise ordinary resident capabilities.' }, homeHouseholdId: 'test-household',
      family: { kind: 'local-kin' as const, ties: people.filter(p => p !== id).map(residentId => ({ residentId, kind: 'sibling' as const, description: 'Synthetic reciprocal tie.' })) },
      socialTies: people.filter(p => p !== id).map(residentId => ({ residentId, description: 'Synthetic reciprocal social connection.' })), decisionMemory: { source: 'inherited-story-choices' as const },
      routine: [{ startMinute: 0, endMinute: 1440, activity: 'Synthetic exterior interval', placeId: HOME, companionIds: [] }] })) };
  const events = createPeopleLifeEventsSnapshot(registry, { facts: [{ id: 'test-done', subjectIds: people, initialValue: false, initiallyKnownTo: [] }],
    eventTypes: [{ id: 'test-completion', factIds: ['test-done'], allowsFamilyRevision: false }], familyRules: [] }, { startedAt: START, stepMilliseconds: STEP, seed: 1 });
  assert.ok(events.ok, events.ok ? '' : events.error);
  const definition: HouseholdDefinition = { revision: 'test-routes-v1', proof: 'abstract-route-fixture',
    catalog: { schema: 1, anchors: [HA, WA, RA], residents: people.map(id => ({ id, householdId: 'test-household' })), households: [{ id: 'test-household', homePlaceId: HOME }],
      places: [{ id: HOME, kind: 'home', anchorId: HA, hours: [] }, { id: WELL, kind: 'service', anchorId: WA, hours: [] }, { id: REST, kind: 'social', anchorId: RA, hours: [] }],
      resources: [{ id: 'test-well-slot', placeId: WELL, anchorId: WA, kind: 'service', capacity: 1, access: { kind: 'public' }, hours: [] },
        { id: 'test-rest-slot', placeId: REST, anchorId: RA, kind: 'stance', capacity: 1, access: { kind: 'public' }, hours: [] }],
      uses: [{ id: 'test-service', placeId: WELL, kind: 'service', requires: [{ resourceId: 'test-well-slot', units: 1 }] },
        { id: 'test-meet', placeId: REST, kind: 'meet', requires: [{ resourceId: 'test-rest-slot', units: 1 }] }] },
    routes: [{ id: 'test-out', fromPlaceId: HOME, toPlaceId: WELL, travelMinutes: 3 }, { id: 'test-across', fromPlaceId: WELL, toPlaceId: REST, travelMinutes: 2 }],
    initialPlaces: people.map(residentId => ({ residentId, placeId: residentId === B ? REST : HOME })), tasks: [
      { id: 'test-service-task', residentId: A, routeId: 'test-out', useId: 'test-service', startsAt: 1, workMinutes: 2,
        completion: { eventId: 'test-service-done', typeId: 'test-completion', effects: [{ factId: 'test-done', value: true }], witnesses: [] } },
      { id: 'test-meet-task', residentId: A, routeId: 'test-across', useId: 'test-meet', startsAt: 8, workMinutes: 2,
        completion: { eventId: 'test-meet-done', typeId: 'test-completion', effects: [], witnesses: [] } }] };
  const result = createHouseholdSimulation(events.snapshot, definition); assert.ok(result.ok); return result.snapshot;
}
function advance(s: HouseholdSimulation, minute: number, maxSteps = 100): HouseholdSimulation {
  const r = advanceHouseholdSimulation(s, { expectedGeneration: s.generation, observedAt: START + minute * STEP, maxSteps }); assert.ok(r.ok); return r.snapshot;
}
function command(s: HouseholdSimulation, kind: 'interrupt' | 'resume', id: string): HouseholdSimulation {
  const r = applyHouseholdCommand(s, { expectedGeneration: s.generation, command: { id, kind, taskId: 'test-service-task' } }); assert.ok(r.ok); return r.snapshot;
}
function options(simulation = fixture()): ResidentRoutePresentationOptions {
  const paths: Record<string, number[][]> = { 'test-home-well': [[0, 0, 0], [2, 0, 0], [2, 0, 4]], 'test-home-rest': [[0, 0, 0], [0, 0, -2]] };
  const ends: Record<string, string> = { 'test-home-well': WA, 'test-home-rest': RA }, routes: Record<string, any> = {}, proofs: any[] = [];
  for (const [id, p] of Object.entries(paths)) {
    const body = p.map(([x, y, z]) => [x, y + .015, z]), length = id === 'test-home-well' ? 6 : 2;
    routes[id] = { from: HA, to: ends[id], reversible: true, sourceGroundPolyline: p, capsuleBottomPolyline: body, lengthMetres: length, corridorRefs: [1, 2] };
    proofs.push({ from: HA, to: ends[id], sourceGroundPolyline: p, capsuleBottomPolyline: body, capsuleBottomLiftMetres: .015, lengthMetres: length, corridor: [1, 2],
      groundEdgeClearanceLowerBound: 1, slopeLipschitzUpperBound: 0, allSourceSolidEnvelopesClear: true, groundWholeFootprintSupported: true,
      waterAndInteriorsExcluded: true, findPathStatus: 1073741824, partialPathAccepted: false });
  }
  const anchors = Object.fromEntries([[HA, [0, 0, 0]], [WA, [2, 0, 4]], [RA, [0, 0, -2]]].map(([id, value]) => {
    const p = value as number[]; return [id, { sourceGroundPoint: p, capsuleBottomPoint: [p[0], .015, p[2]], sourceActor: 'test-source-actor', standingOnly: true }];
  }));
  return { simulation, profile: 'desktop', modelSha256: MODEL, actorModelSha256: ACTOR, walkClipId: 'test-qualified-walk',
    binding: { schema: 1, profile: 'desktop', sourceSha256: MODEL, frame: 'source-root-local-metres', capsule: { height: 1.8, radius: .28 }, anchors, routes, scope: 'Synthetic certificate fixture only.' },
    certificate: { schema: 1, profile: 'desktop', qualified: true, sourceSha256: MODEL, frame: 'source-root-local-metres', capsule: { height: 1.8, radius: .28 }, routes: proofs,
      sourceOriginalBuffersUnchanged: true, sameHomeAnchorForEveryRoute: true, capsuleClearanceMargin: .005, groundBoundaryRoundingMaxMetres: 1e-8 },
    routeBindings: [{ routeId: 'test-out', legs: [{ certifiedRouteId: 'test-home-well', reverse: false }] },
      { routeId: 'test-across', legs: [{ certifiedRouteId: 'test-home-well', reverse: true }, { certifiedRouteId: 'test-home-rest', reverse: false }] }],
    renderedResidentIds: [A], actorEnvelopes: [{ residentId: A, min: [-.04, .29, -.04], max: [.04, 1.49, .04], footAnchor: [0, 0, 0] }],
    walkCapability: { status: 'visually-qualified', actorModelSha256: ACTOR, clipId: 'test-qualified-walk', capsuleCompatibility: { height: 1.8, radius: .28, qualified: true } } };
}
const phase = (s: HouseholdSimulation, fraction = 0): ResidentRoutePhase => ({ generation: s.generation, worldMinute: s.events.world.elapsedSteps,
  fractionalMinute: fraction, clockSeconds: s.events.world.elapsedSteps + fraction, paused: false, reducedMotion: false });
const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `${v} != ${b[i]}`));

test('committed progress uses metre arc length, preserves corners and smooths facing without future arrival', () => {
  let s = fixture(); const p = createResidentRoutePresentation(options(s)); s = advance(s, 1); assert.equal(p.handoff(s), true);
  s = advance(s, 2); assert.equal(p.handoff(s), true); assert.equal(p.update(phase(s, .5)), true); close(p.frame.residents[0].position, [1, 0, 0]);
  s = advance(s, 3); p.handoff(s); p.update(phase(s)); close(p.frame.residents[0].position, [2, 0, 0]); assert.ok(Math.abs(p.frame.residents[0].yawRadians - Math.PI / 4) < 1e-6);
  p.update(phase(s, .5)); close(p.frame.residents[0].position, [2, 0, 1]);
  s = advance(s, 4); p.handoff(s); const before = JSON.stringify(s); p.update(phase(s, .5));
  assert.equal(s.actors[0].placeId, WELL); close(p.frame.residents[0].position, [2, 0, 3]); assert.equal(JSON.stringify(s), before, 'display lag does not write arrival/action/witness truth');
});

test('same-minute interruption/resume preserves the committed interpolation window', () => {
  let s = fixture(); const p = createResidentRoutePresentation(options(s)); s = advance(s, 1); p.handoff(s); s = advance(s, 2); p.handoff(s); p.update(phase(s, .4));
  s = command(s, 'interrupt', 'test-stop'); assert.equal(p.handoff(s), true); p.update(phase(s, .8)); close(p.frame.residents[0].position, [1.6, 0, 0]);
  assert.equal(s.actions[0].routeProgress, 1); s = advance(s, 3); p.handoff(s); p.update(phase(s)); close(p.frame.residents[0].position, [2, 0, 0]);
  s = command(s, 'resume', 'test-go'); p.handoff(s); p.update(phase(s, .5)); close(p.frame.residents[0].position, [2, 0, 0]);
  s = advance(s, 4); p.handoff(s); p.update(phase(s, .5)); close(p.frame.residents[0].position, [2, 0, 1]);
});

test('missing walk never feeds moving positions to the renderer idle fallback, including later arrival', () => {
  let s = fixture(); const input = { ...options(s), walkCapability: { status: 'unavailable' as const }, walkClipId: null }, p = createResidentRoutePresentation(input);
  const initial = [...p.frame.residents[0].position]; s = advance(s, 1); p.handoff(s); assert.equal(p.reason, 'walk-unavailable'); assert.equal(p.update(phase(s)), false);
  s = advance(s, 4); p.handoff(s); assert.equal(p.update(phase(s)), false); close(p.frame.residents[0].position, initial); assert.equal(p.frame.residents[0].motion, 'idle');
});

test('actual actor identity, complete envelope and foot anchor independently gate clearance', () => {
  const wrong = copy(options()) as any; wrong.actorModelSha256 = 'c'.repeat(64); assert.throws(() => createResidentRoutePresentation(wrong), /qualification/);
  const clip = copy(options()) as any; clip.walkClipId = 'test-other-clip'; assert.throws(() => createResidentRoutePresentation(clip), /qualification/);
  for (const edit of [(e: any) => e.max[0] = .4, (e: any) => e.max[1] = 2, (e: any) => e.footAnchor[0] = 1, (e: any) => e.min[1] = 0]) {
    const input = copy(options()) as any; edit(input.actorEnvelopes[0]); const p = createResidentRoutePresentation(input); assert.equal(p.available, false); assert.equal(p.reason, 'actor-envelope-unqualified');
  }
  const shifted = copy(options()) as any; const foot = [.05, .1, .02]; shifted.actorEnvelopes[0].footAnchor = foot;
  for (let i = 0; i < 3; i++) { shifted.actorEnvelopes[0].min[i] += foot[i]; shifted.actorEnvelopes[0].max[i] += foot[i]; }
  const p = createResidentRoutePresentation(shifted); assert.equal(p.available, true); close(p.frame.residents[0].position, [-.05, -.1, -.02]);
});

test('profile/model/units, malformed geometry, partial corridors and unqualified uses fail closed', () => {
  const mutations = [(v: any) => v.modelSha256 = 'c'.repeat(64), (v: any) => v.profile = 'quest', (v: any) => v.binding.frame = 'centimetres',
    (v: any) => v.binding.routes['test-home-well'].sourceGroundPolyline[1][0] = 20,
    (v: any) => v.certificate.routes[0].partialPathAccepted = true, (v: any) => v.certificate.routes[0].findPathStatus += 64,
    (v: any) => v.certificate.routes[0].waterAndInteriorsExcluded = false, (v: any) => v.binding.capsule.radius = .1,
    (v: any) => v.routeBindings[1].legs.reverse(), (v: any) => v.renderedResidentIds = []];
  for (const mutate of mutations) { const input = copy(options()) as any; mutate(input); assert.throws(() => createResidentRoutePresentation(input)); }
  const input = copy(options()) as any; input.routeBindings[0].legs[0].certifiedRouteId = 'test-forge'; assert.throws(() => createResidentRoutePresentation(input), /certified endpoint/);
});

test('unused place identity grants no route/use and cannot disguise a forge or displaced service slot', () => {
  const input = copy(options()) as any;
  input.simulation.definition.catalog.anchors.push('test-unqualified-anchor');
  input.simulation.definition.catalog.places.push({ id: 'test-unqualified-place', kind: 'workplace', anchorId: 'test-unqualified-anchor', hours: [] });
  input.simulation.events.registry.places.push({ id: 'test-unqualified-place', label: 'Synthetic unresolved identity' });
  assert.equal(createResidentRoutePresentation(input).available, true);
  const forge = copy(options()) as any; forge.simulation.definition.catalog.uses[0].kind = 'work'; forge.simulation.definition.catalog.resources[0].kind = 'stance';
  assert.throws(() => createResidentRoutePresentation(forge), /standing exterior/);
  const displaced = copy(options()) as any; displaced.simulation.definition.catalog.resources[0].anchorId = RA;
  assert.throws(() => createResidentRoutePresentation(displaced), /certified stance/);
  const slots = copy(options()) as any; slots.simulation.definition.catalog.resources[0].capacity = 3;
  assert.throws(() => createResidentRoutePresentation(slots), /single certified stance/);
});

test('input hooks/getters never run; successful construction owns caller route data', () => {
  let calls = 0; const getter = options() as any; Object.defineProperty(getter.binding.routes['test-home-well'].sourceGroundPolyline, '0', { get() { calls++; return [0, 0, 0]; }, enumerable: true });
  assert.throws(() => createResidentRoutePresentation(getter)); const hook = options() as any; hook.certificate.toJSON = () => { calls++; return {}; }; assert.throws(() => createResidentRoutePresentation(hook)); assert.equal(calls, 0);
  let s = fixture(); const input = options(s), before = JSON.stringify(input), p = createResidentRoutePresentation(input); assert.equal(JSON.stringify(input), before);
  (input.binding as any).routes['test-home-well'].sourceGroundPolyline[1][0] = 200;
  s = advance(s, 1); p.handoff(s); s = advance(s, 2); p.handoff(s); p.update(phase(s, .5)); close(p.frame.residents[0].position, [1, 0, 0]);
});

test('pause/reduced motion leave world time untouched and require hidden restore after missed presentation', () => {
  let s = fixture(); const p = createResidentRoutePresentation(options(s)); s = advance(s, 1); p.handoff(s); s = advance(s, 2); p.handoff(s); p.update(phase(s, .4));
  const position = [...p.frame.residents[0].position]; p.update({ ...phase(s, .4), paused: true }); s = advance(s, 3); p.handoff(s); const before = JSON.stringify(s);
  assert.equal(p.update(phase(s, .5)), false); assert.equal(p.reason, 'restore-required'); close(p.frame.residents[0].position, position); assert.equal(JSON.stringify(s), before);
  const encoded = serializeHouseholdSimulation(s); assert.ok(encoded.ok); const restored = parseHouseholdSimulation(encoded.json); assert.ok(restored.ok);
  const fresh = createResidentRoutePresentation(options(restored.snapshot)); fresh.update(phase(s)); close(fresh.frame.residents[0].position, [2, 0, 2]);
  const reduced = createResidentRoutePresentation(options(s)); const at = [...reduced.frame.residents[0].position]; assert.equal(reduced.update({ ...phase(s, .5), reducedMotion: true }), false);
  assert.equal(reduced.reason, 'reduced-motion-transit'); close(reduced.frame.residents[0].position, at); assert.equal(JSON.stringify(s), before);
});

test('stale phases, fractional rewinds and whole-step catch-up cannot start a live trajectory', () => {
  let s = fixture(); const p = createResidentRoutePresentation(options(s)); s = advance(s, 1); p.handoff(s); s = advance(s, 2); p.handoff(s); p.update(phase(s, .5)); const before = [...p.frame.residents[0].position];
  for (const bad of [{ ...phase(s, .7), generation: s.generation - 1 }, { ...phase(s, .7), worldMinute: 99 }, phase(s, .4), phase(s, 1), phase(s, NaN)]) assert.equal(p.update(bad), false);
  close(p.frame.residents[0].position, before); const deferred = advance(fixture(), 100, 1), waiting = createResidentRoutePresentation(options(deferred));
  assert.equal(waiting.reason, 'catchup-pending'); assert.equal(waiting.update(phase(deferred, .5)), false);
  assert.equal(p.handoff(fixture()), false); close(p.frame.residents[0].position, before);
});

test('all supplied actor envelopes enter full swept bounds; unproved crowds cannot stack', () => {
  const input = options(), p = createResidentRoutePresentation(input); assert.ok(p.bounds.min[2] < -2); assert.ok(p.bounds.max[0] > 2); assert.ok(p.bounds.max[1] >= 1.49);
  const crowd = { ...input, renderedResidentIds: [A, B], actorEnvelopes: [...input.actorEnvelopes, { ...input.actorEnvelopes[0], residentId: B }] };
  const q = createResidentRoutePresentation(crowd); assert.equal(q.frame.residents.length, 2); assert.equal(q.reason, 'crowd-unqualified'); assert.equal(q.available, false);
  assert.ok(q.bounds.min[2] < q.frame.residents[1].position[2]);
});

test('frame/tuples stay reused, chained reverse legs stay certified, disposal is inert', () => {
  let s = fixture(); const p = createResidentRoutePresentation(options(s)), frame = p.frame, rows = frame.residents, position = rows[0].position;
  for (let minute = 1; minute <= 8; minute++) { s = advance(s, minute); assert.equal(p.handoff(s), true); assert.equal(p.update(phase(s, .9)), true); }
  s = advance(s, 9); p.handoff(s); p.update(phase(s, .5)); close(position, [2, 0, 2]);
  const dto = { ...phase(s, .5) }; for (let i = 0; i < 1000; i++) { dto.fractionalMinute = .5 + i / 2001; p.update(dto); }
  assert.equal(p.frame, frame); assert.equal(p.frame.residents, rows); assert.equal(p.frame.residents[0].position, position);
  const at = [...position]; p.dispose(); assert.equal(p.reason, 'disposed'); assert.equal(p.update(dto), false); assert.equal(p.handoff(s), false); close(position, at);
});

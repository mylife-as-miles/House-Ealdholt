import assert from 'node:assert/strict';
import test from 'node:test';
import { admitVillagePopulationEndpoints as admit, projectVillagePopulationEndpoints as project } from './village-population-projection';
import type { VillagePopulationResidentState, VillagePopulationSample } from './village-population-runtime';
import type { VillageSiteLayout } from './village-site';

// Synthetic, certificate-shaped layout tests only. No Elderbloom coordinates,
// physical arrival, clip qualification or completed work are established here.
function site(points: readonly (readonly [string, number, number, number])[], hash = 'a'.repeat(64)): VillageSiteLayout {
  const anchors = points.map(([id, x, y, z]) => Object.freeze({ id, sourceActor: `test-${id}`, standingOnly: true as const,
    sourceGroundPoint: Object.freeze([x, y, z]) as readonly [number, number, number],
    capsuleBottomPoint: Object.freeze([x, y + .16, z]) as readonly [number, number, number] }));
  return Object.freeze({ profile: 'desktop' as const, sourceSha256: hash, frame: 'source-root-local-metres' as const,
    capsule: Object.freeze({ height: 2.1, radius: .6 }), anchors: Object.freeze(anchors), routes: Object.freeze([]),
    placeBindings: Object.freeze(points.map(([id]) => Object.freeze({ placeId: id, anchorId: id, status: 'mapped-exterior' as const }))),
    residentPlaceBindings: Object.freeze([]) });
}
function row(id: string, target = 'work', patch: Partial<VillagePopulationResidentState> = {}): VillagePopulationResidentState {
  return Object.freeze({ residentId: id, tier: 'persistent', activity: 'Synthetic authored activity.', roleClip: null,
    availableRoleClips: Object.freeze([]), scheduledPlaceId: target, placeId: null, fromPlaceId: 'unmapped-home', slotIndex: 2,
    slotStartMinute: 480, slotEndMinute: 600, status: 'unmapped', reason: 'route-unmapped', position: null,
    yawRadians: 2, moving: false, presentable: false, ...patch });
}
function sample(rows: readonly VillagePopulationResidentState[], generation = 1, minute = 540): VillagePopulationSample {
  return Object.freeze({ generation, time: Object.freeze({ absoluteWorldMinute: minute, dayIndex: 0, dayMinute: minute,
    fractionalMinute: 0, elapsedWorldMinutes: minute - 540, deferredMilliseconds: 0 }), residents: Object.freeze([...rows]),
    counts: Object.freeze({ total: 100, households: 25, major: 20, scheduled: 80, mapped: rows.filter(r => r.position).length,
      unmapped: rows.filter(r => r.status === 'unmapped').length, moving: rows.filter(r => r.moving).length,
      blocked: rows.filter(r => r.status === 'blocked').length }) });
}
const eligible = (...ids: string[]) => ({ eligibleResidentIds: new Set(ids), visibleResidentIds: new Set<string>() });

test('legacy projection never inherits a durable work-pose qualification', () => {
  const source = sample([row('strict', 'work', { workPoseQualified: true,
    status: 'at-place', reason: null, position: [10, 0, 0], presentable: true })]);
  const projection = project(source, site([['work', 10, 0, 0]]));
  assert.equal(projection.sample.residents[0].workPoseQualified, false);
  assert.equal(admit(projection, eligible()).residents[0].workPoseQualified, false);
  assert.equal(source.residents[0].workPoseQualified, true, 'the saved input remains immutable');
});

test('only strict route-unmapped rows at certified current destinations receive neutral abstract candidates', () => {
  const source = sample([row('a'), row('b', 'absent'), row('c', 'work', { reason: 'place-unmapped' }),
    row('d', 'work', { status: 'blocked', reason: 'anchor-conflict' }),
    row('e', 'work', { status: 'blocked', reason: 'route-exceeds-slot' })]);
  const before = JSON.stringify(source), result = project(source, site([['work', 10, 1, 5]]));
  assert.equal(result.candidates.length, 1); const candidate = result.candidates[0];
  assert.equal(candidate.residentId, 'a'); assert.equal(candidate.projectionProvenance, 'abstract-schedule-endpoint');
  assert.equal(candidate.routeCertified, false); assert.equal(candidate.workPoseQualified, false);
  assert.equal(candidate.orientationProvenance, 'neutral-unqualified'); assert.equal(candidate.yawRadians, 0);
  assert.equal(candidate.moving, false); assert.equal(candidate.status, 'at-place'); assert.deepEqual(candidate.position, [10, 1, 5]);
  assert.equal(result.sample.residents[0].position, null); assert.equal(result.sample.residents[0].reason, 'route-unmapped');
  assert.equal(JSON.stringify(source), before); assert.ok(Object.isFrozen(candidate.position));
});

test('fresh endpoint admission requires explicit eligibility and current visibility vetoes it', () => {
  const projection = project(sample([row('a')]), site([['work', 10, 0, 0]]));
  const held = admit(projection, eligible());
  assert.equal(held.residents[0].position, null); assert.equal(held.residents[0].projectionHeldReason, 'abstract-admission-required');
  const visible = admit(projection, { ...eligible('a'), visibleResidentIds: new Set(['a']) });
  assert.equal(visible.residents[0].position, null); assert.equal(visible.residents[0].projectionHeldReason, 'abstract-visible-transition-held');
  const initial = admit(projection, eligible('a'));
  assert.deepEqual(initial.residents[0].position, [10, 0, 0]); assert.equal(initial.projectionCounts.abstractEndpoints, 1);
  assert.equal(initial.projectionCounts.certifiedRouteSamples, 0); assert.equal(initial.projectionCounts.heldAbstractCandidates, 0);
});

test('unchanged visible abstract endpoint remains continuous, but a changed visible target never teleports', () => {
  const layout = site([['work', 10, 0, 0], ['rest', 20, 0, 0]]);
  const previous = admit(project(sample([row('a')]), layout), eligible('a'));
  const same = admit(project(sample([row('a')], 2, 541), layout), { ...eligible(), visibleResidentIds: new Set(['a']), previousSample: previous });
  assert.deepEqual(same.residents[0].position, [10, 0, 0]);
  const changed = project(sample([row('a', 'rest')], 3, 542), layout);
  const visible = admit(changed, { ...eligible('a'), visibleResidentIds: new Set(['a']), previousSample: same });
  assert.equal(visible.residents[0].position, null); assert.equal(visible.residents[0].projectionHeldReason, 'abstract-visible-transition-held');
  const hiddenButUnqualified = admit(changed, { ...eligible(), previousSample: same });
  assert.equal(hiddenButUnqualified.residents[0].position, null);
  const hiddenEligible = admit(changed, { ...eligible('a'), previousSample: same });
  assert.deepEqual(hiddenEligible.residents[0].position, [20, 0, 0]); assert.equal(hiddenEligible.residents[0].moving, false);
});

test('strict route samples take precedence; overlapping abstract endpoint is held without displacement', () => {
  const strict = row('strict', 'work', { status: 'travelling', reason: null, presentable: true, moving: true,
    position: Object.freeze([10.9, 0, 0]), yawRadians: .8 });
  const result = admit(project(sample([strict, row('a')]), site([['work', 10, 0, 0]])), eligible('a'));
  assert.deepEqual(result.residents[0].position, strict.position); assert.equal(result.residents[0].moving, true);
  assert.equal(result.residents[0].projectionProvenance, 'certified-route-sample'); assert.equal(result.residents[0].routeCertified, true);
  assert.equal(result.residents[1].position, null); assert.equal(result.residents[1].projectionHeldReason, 'abstract-proxy-conflict');
  assert.deepEqual(result.projectionCounts, { certifiedRouteSamples: 1, abstractCandidates: 1, abstractEndpoints: 0, heldAbstractCandidates: 1 });
});

test('different anchor IDs do not permit stacking; all conflicting abstract endpoints are held', () => {
  const result = admit(project(sample([row('a', 'one'), row('b', 'two')]), site([['one', 10, 0, 0], ['two', 10.9, 0, 0]])), eligible('a', 'b'));
  assert.ok(result.residents.every(r => r.position === null && r.projectionHeldReason === 'abstract-proxy-conflict'));
  assert.equal(result.projectionCounts.abstractEndpoints, 0); assert.equal(result.projectionCounts.heldAbstractCandidates, 2);
  const separated = admit(project(sample([row('a', 'one'), row('b', 'two')]), site([['one', 10, 0, 0], ['two', 11.3, 0, 0]])), eligible('a', 'b'));
  assert.equal(separated.projectionCounts.abstractEndpoints, 2);
});

test('missing site or endpoint cannot fabricate coordinates, and caller data is not changed', () => {
  const input = sample([row('a')]), raw = JSON.stringify(input);
  assert.equal(project(input, null).candidates.length, 0);
  assert.equal(project(input, site([['other', 10, 0, 0]])).candidates.length, 0);
  const ids = new Set(['a']), result = admit(project(input, site([['work', 10, 0, 0]])), { eligibleResidentIds: ids, visibleResidentIds: new Set() });
  assert.deepEqual([...ids], ['a']); assert.equal(JSON.stringify(input), raw); assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.residents)); assert.ok(Object.isFrozen(result.projectionCounts));
});

test('source changes and clock rewind cannot reuse prior visible admission as endpoint proof', () => {
  const previous = admit(project(sample([row('a')], 5, 550), site([['work', 10, 0, 0]])), eligible('a'));
  const sourceChange = project(sample([row('a')], 6, 551), site([['work', 10, 0, 0]], 'b'.repeat(64)));
  const held = admit(sourceChange, { ...eligible('a'), visibleResidentIds: new Set(['a']), previousSample: previous });
  assert.equal(held.residents[0].position, null); assert.equal(held.residents[0].projectionHeldReason, 'abstract-visible-transition-held');
  const rewind = admit(project(sample([row('a')], 4, 549), site([['work', 10, 0, 0]])), { ...eligible('a'), previousSample: previous });
  assert.equal(rewind.residents[0].position, null); assert.equal(rewind.residents[0].projectionHeldReason, 'abstract-clock-rewind-held');
});

test('forged projection and unowned previous admission are rejected', () => {
  const projection = project(sample([row('a')]), site([['work', 10, 0, 0]]));
  assert.throws(() => admit({ ...projection }, eligible('a')), /generated projection/);
  assert.throws(() => admit(projection, { ...eligible('a'), previousSample: projection.sample }), /Previous endpoint admission/);
});

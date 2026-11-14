import assert from 'node:assert/strict';
import test from 'node:test';
import { Object3D, PerspectiveCamera } from 'three';

import { createEaldholtVillagePopulationView, describeEaldholtPopulationLife, qualifyEaldholtWorkplacePose, createEaldholtPopulationDiagnosticsCache } from './village-population-view';
import { EALDHOLT_VILLAGE_POPULATION as POPULATION } from '../../../../shared/legacy/aethelgard/characters/village-population';
import { createVillageLife } from '../../../../shared/legacy/aethelgard/characters/village-life';
import type { VillagePopulationSample } from '../../../../shared/legacy/aethelgard/characters/village-population-runtime';
import type { VillageSiteLayout } from '../../../../shared/legacy/aethelgard/characters/village-site';
import { getPopulationArt } from '../../../../shared/legacy/aethelgard/characters/village-population-art';
import { parsePopulationMotionEvidence, qualifyPopulationMotion, type PopulationMotionEvidence } from '../../../../shared/legacy/aethelgard/characters/population-motion-clearance';
import {deriveVillageRefugeBody,parseVillageSiteEmergencyRefuges,requiredVillageRefugeMotionClips} from '../../../../shared/legacy/aethelgard/characters/village-emergency-refuges';
import {resolvePopulationPresentation} from '../../../../shared/legacy/aethelgard/characters/village-activity-presentation';
import { EALDHOLT_POPULATION_ASSET_SHA256 as HASHES } from '../../../../shared/legacy/aethelgard/characters/population-asset-integrity';
import type { ResidentProcessingScheduler } from '../../../../shared/legacy/aethelgard/characters/resident-processing-budget';

const residentLife = createVillageLife(POPULATION, 540, 'presentation-test-world');
const measuredSite: VillageSiteLayout = {
  profile: 'desktop', sourceSha256: 'a'.repeat(64), frame: 'source-root-local-metres',
  capsule: { radius: .6, height: 2.1 }, routes: [], residentPlaceBindings: [],
  anchors: [{ id: 'well-test-stand', sourceActor: 'synthetic-unit-test-ground', standingOnly: true,
    sourceGroundPoint: [10, 0, 0], capsuleBottomPoint: [10, .02, 0] }],
  placeBindings: [{ placeId: 'village-well', anchorId: 'well-test-stand', status: 'mapped-exterior' }],
};
Object.freeze(measuredSite);
function lifeSample(authority: VillagePopulationSample['navigationAuthority'] = 'resident-life'): VillagePopulationSample {
  return { generation: 1, navigationAuthority: authority, life: residentLife,
    time: { absoluteWorldMinute: 540, dayIndex: 0, dayMinute: 540, fractionalMinute: 0,
      elapsedWorldMinutes: 0, deferredMilliseconds: 0 },
    residents: POPULATION.residents.map((resident, index) => ({ residentId: resident.id, tier: resident.fidelityTier,
      activity: resident.registry.routine[0].activity, roleClip: null, availableRoleClips: [],
      scheduledPlaceId: index === 0 ? 'village-well' : resident.homePlaceId,
      placeId: null, fromPlaceId: resident.homePlaceId, slotIndex: 0, slotStartMinute: 0, slotEndMinute: 1440,
      status: 'unmapped', reason: 'route-unmapped', position: null, yawRadians: 0, moving: false, presentable: false,
      lifeIntent: residentLife.residents[index].intent, simulatedPlaceId: residentLife.residents[index].simulatedPlaceId,
      navigationStatus: 'waiting', navigationReason: 'no-certified-route', arrivalEvidence: 'none', arrivedAtAbsoluteMinute: null })),
    counts: { total: 100, households: 25, major: 20, scheduled: 80, mapped: 0, unmapped: 100, moving: 0, blocked: 0 } };
}

function inactiveView(readFrame: () => { sample: VillagePopulationSample; clockSeconds: number }, motionEvidence: PopulationMotionEvidence | null = null, processingScheduler?: ResidentProcessingScheduler, onPresentationChanged?: () => void) {
  const sourceRoot = new Object3D(), camera = new PerspectiveCamera();
  return createEaldholtVillagePopulationView({ camera, viewportHeight: () => 720, sourceIdentity: { profile: 'desktop', sha256: 'a'.repeat(64) },
    sourceRoot, root: 'https://assets.invalid/characters/', integritySha256: {}, site: measuredSite,
    motionEvidence, readFrame, processingScheduler, onPresentationChanged });
}

/** Synthetic contract fixture only; these flags establish no real-source
 * clearance. The enabled original-geometry replay supplies that separate proof. */
function refugeFixture(){
 const person=POPULATION.residents.find(r=>r.id==='ealdholt-baker')!,neutral=requiredVillageRefugeMotionClips(person.id);
 const clips=Object.fromEntries(neutral.map(name=>[name,{radiusMetres:.45,heightMetres:1.8,minimumBodyYMetres:-.008,placedBelowGround:false}]));
 const motion=parsePopulationMotionEvidence({schemaVersion:1,method:'cpu-sampled-skin-and-props-v1',fps:60,paddingMetres:.05,residents:{[person.id]:{levels:{crowd:{files:{...HASHES},clips}}}}});
 const anchor={id:'unit-refuge-stand',sourceActor:'synthetic-unit-test-ground',standingOnly:true as const,sourceGroundPoint:[13,0,0]as const,capsuleBottomPoint:[13,.02,0]as const};
 const refuges=parseVillageSiteEmergencyRefuges([{id:'unit-refuge-capability',residentId:person.id,placeId:'unit-emergency-refuge',anchorId:anchor.id,sourceActor:anchor.sourceActor,certificateSha256:'c'.repeat(64),body:deriveVillageRefugeBody(motion,person.id),
  proof:{sourceSha256:measuredSite.sourceSha256,profile:measuredSite.profile,siteIdentity:'unit-site-artifact',sourceGroundPoint:anchor.sourceGroundPoint,capsuleBottomPoint:anchor.capsuleBottomPoint,originalTriangleClearance:true,wholeFootprintSupported:true,sweptIdleAndWalkClear:true,motionEvidence:motion},
  topology:{anchor,route:{id:'unit-refuge-route',from:measuredSite.anchors[0].id,to:anchor.id,reversible:true,sourceGroundPolyline:[measuredSite.anchors[0].sourceGroundPoint,anchor.sourceGroundPoint],capsuleBottomPolyline:[measuredSite.anchors[0].capsuleBottomPoint,anchor.capsuleBottomPoint],lengthMetres:3}}}]);
 return{person,neutral,motion,refuges,site:Object.freeze({...measuredSite,emergencyRefuges:refuges})};
}

test('refuge capabilities reach the presenter without replacing original homes, aliases or topology',t=>{
 t.mock.timers.enable({apis:['setInterval']});const f=refugeFixture(),before=JSON.stringify(measuredSite),view=inactiveView(()=>({sample:lifeSample(),clockSeconds:0}));
 try{
  view.setEmergencySite(f.site);assert.strictEqual(view.readSite(),f.site);assert.equal(JSON.stringify(measuredSite),before);
  assert.strictEqual(f.site.anchors,measuredSite.anchors);assert.strictEqual(f.site.routes,measuredSite.routes);assert.strictEqual(f.site.residentPlaceBindings,measuredSite.residentPlaceBindings);
  for(const changed of[{...f.site,emergencyRefuges:undefined},{...f.site,emergencyRefuges:[{...f.refuges[0],certificateSha256:'d'.repeat(64)}]},{...f.site,sourceSha256:'b'.repeat(64)},{...f.site,emergencyRefuges:[{...f.refuges[0],placeId:'village-well'}]},
   {...f.site,emergencyRefuges:[{...f.refuges[0],body:{...f.refuges[0].body,radius:.1}}]},
   {...f.site,emergencyRefuges:[{...f.refuges[0],topology:{...f.refuges[0].topology!,route:{...f.refuges[0].topology!.route,from:'invented-connection'}}}]}])assert.throws(()=>view.setEmergencySite(changed));
  assert.strictEqual(view.readSite(),f.site);assert.equal(view.snapshot.crowd.loading,0);assert.equal(view.snapshot.error,'');
 }finally{view.dispose();}
});

test('a constrained refuge journey uses only exact measured neutral motion with zero blending',()=>{
 const f=refugeFixture(),base=lifeSample().residents.find(r=>r.residentId===f.person.id)!;
 const state={...base,status:'travelling' as const,reason:null,position:[11,0,0]as const,moving:true,presentable:true,navigationStatus:'travelling',navigationReason:null,
  refugeMotion:{refugeIds:[f.refuges[0].id],certificates:{[f.refuges[0].id]:f.refuges[0].certificateSha256},neutralClips:f.neutral,zeroCrossfade:true as const}};
 const plan=resolvePopulationPresentation(state);assert.equal(plan.motion,'walk');assert.equal(plan.fadeSeconds,0);assert.equal(plan.activity.roleClip,undefined);
 assert.equal(qualifyPopulationMotion(state,plan,f.site,f.motion,'desktop').presentable,true);
 const drifted=Object.freeze({...f.site,emergencyRefuges:parseVillageSiteEmergencyRefuges([{...f.refuges[0],certificateSha256:'d'.repeat(64)}])});
 assert.equal(qualifyPopulationMotion(state,plan,drifted,f.motion,'desktop').presentable,false,'A sampled pose cannot transfer to a different refuge certificate.');
 assert.equal(qualifyPopulationMotion(state,{...plan,fadeSeconds:.15},f.site,f.motion,'desktop').presentable,false);
 assert.equal(qualifyPopulationMotion(state,{...plan,activity:{roleClip:'work_chisel'}},f.site,f.motion,'desktop').presentable,false);
 const clips={...f.motion.residents[f.person.id].levels.crowd!.clips},name=f.neutral[0];clips[name]={...clips[name],radiusMetres:.46};
 const changed=parsePopulationMotionEvidence({...f.motion,residents:{[f.person.id]:{levels:{crowd:{files:{...HASHES},clips}}}}});
 assert.equal(qualifyPopulationMotion(state,plan,f.site,changed,'desktop').presentable,false,'An envelope that merely fits is not the source-pinned refuge proof.');
 const stopped={...state,moving:false,navigationReason:'traffic-peer-held',arrivalEvidence:'none' as const,refugeMotion:{...state.refugeMotion,trafficStopped:true as const}};
 const idle=resolvePopulationPresentation(stopped);assert.equal(idle.presentable,true);assert.equal(idle.motion,'idle');assert.equal(idle.fadeSeconds,0);assert.equal(idle.activity.roleClip,undefined);
 assert.equal(qualifyPopulationMotion(stopped,idle,f.site,f.motion,'desktop').presentable,true);
 assert.equal(resolvePopulationPresentation({...stopped,refugeMotion:state.refugeMotion}).presentable,false,'An arbitrary route stop has no ownership permission.');
 assert.equal(resolvePopulationPresentation({...stopped,arrivalEvidence:'initial-placement'}).presentable,false,'A stop cannot invent initial or final arrival.');
 const initial={...state,moving:false,status:'at-place' as const,navigationStatus:'at-threshold',arrivalEvidence:'initial-placement' as const};
 assert.equal(resolvePopulationPresentation(initial).presentable,false,'Initial placement cannot become a witnessed refuge arrival.');
});

test('observer pause freezes actual presenter clocks and fast time scales the existing animation frame', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let now=1000,paused=true;
  t.mock.method(performance,'now',()=>now);
  const sample=lifeSample(),view=inactiveView(()=>({sample,clockSeconds:4,paused,animationRate:4}));
  try {
    view.setActive(true);t.mock.timers.tick(250);now+=100;view.update(.1,false);
    assert.equal(view.snapshot.animationPaused,true);assert.equal(view.snapshot.animationClockSeconds,4);
    paused=false;t.mock.timers.tick(250);now+=100;view.update(.1,false);
    assert.equal(view.snapshot.animationPaused,false);assert.equal(view.snapshot.animationRate,4);
    assert.ok(Math.abs(view.snapshot.animationClockSeconds-4.4)<1e-8);
  }finally{view.dispose();}
});

test('hidden presentation polls saved lives without inventing an arrival or loading actors, and disposal cancels polling', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let reads = 0;
  const sample = lifeSample(), before = JSON.stringify(sample);
  const view = inactiveView(() => { reads++; return { sample, clockSeconds: 0 }; });
  try {
    t.mock.timers.tick(1000);
    assert.equal(reads, 4, 'population sampling remains bounded to 4 Hz while hidden');
    assert.equal(view.snapshot.life?.summary.residents, 100);
    assert.equal(Object.keys(view.snapshot.life!.residents).length, 100);
    assert.equal(view.snapshot.counts?.mapped, 0);
    assert.equal(view.snapshot.life?.residents[POPULATION.residents[0].id].presentation.position, null,
      'a measured destination cannot teleport a resident off its saved journey');
    assert.equal(view.snapshot.life?.navigationAuthority, 'resident-life');
    assert.equal(view.snapshot.life?.residents[POPULATION.residents[0].id].presentation.arrivalEvidence, 'none');
    assert.equal(view.snapshot.selected, 0); assert.equal(view.snapshot.crowd.loading, 0);
    assert.equal(view.snapshot.household.loading, 0); assert.equal(view.object.visible, false);
    assert.equal(JSON.stringify(sample), before, 'the presenter cannot mutate simulation or journey cursors');
    assert.strictEqual(view.object.userData.crownfallPopulationLife, view.snapshot.life);
    view.dispose(); t.mock.timers.tick(1000);
    assert.equal(reads, 4); assert.equal(view.object.userData.crownfallPopulationLife, undefined);
  } finally { view.dispose(); }
});

test('legacy endpoint admission remains available only for schedule projections', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let sample = lifeSample('schedule-projection');
  const view = inactiveView(() => ({ sample, clockSeconds: 0 }));
  try {
    t.mock.timers.tick(250);
    assert.deepEqual(view.snapshot.life?.residents[POPULATION.residents[0].id].presentation.position, [10, 0, 0]);
    sample = lifeSample('resident-life'); t.mock.timers.tick(250);
    assert.equal(view.snapshot.life?.residents[POPULATION.residents[0].id].presentation.position, null,
      'switching to saved navigation discards any presentation-only endpoint history');
  } finally { view.dispose(); }
});

test('life diagnostics expose each real household, job and simulated event without granting physical work evidence', () => {
  const sample = lifeSample(), details = describeEaldholtPopulationLife(sample)!;
  assert.equal(details.counterProvenance, 'simulated-routine');
  assert.equal(details.summary.households, 25); assert.equal(details.households.length, 25);
  for (const registered of POPULATION.residents) {
    const row = details.residents[registered.id];
    assert.equal(row.householdId, registered.householdId); assert.equal(row.homePlaceId, registered.homePlaceId);
    assert.equal(row.workPlaceId, registered.workPlaceId); assert.equal(row.roleId, registered.roleId);
    assert.equal(row.presentation.sourcePlacePresentable, false); assert.equal(row.latestEvent, null);
  }
});

test('read-only presentation labels a coherent queue as waiting while retaining the canonical work intention', () => {
  const sample = lifeSample(), person = POPULATION.residents.find(r => r.registry.role.id === 'brewster')!;
  const intent = sample.life!.residents.find(r => r.residentId === person.id)!.intent;
  const projected: VillagePopulationSample = { ...sample,
    life: { ...sample.life!, residents: sample.life!.residents.map(row => row.residentId === person.id ? { ...row, status: 'queued' } : row) },
    residents: sample.residents.map(row => row.residentId === person.id ? {
    ...row, activity: intent.activity, availableRoleClips: person.appearance.motion.roleClips,
    scheduledPlaceId: intent.targetPlaceId, placeId: intent.targetPlaceId, status: 'at-place',
    reason: 'life-resource-unavailable', lifeStatus: 'queued', waitingForResource: true, workPoseQualified: false,
    position: [10, 0, 0], presentable: true, navigationStatus: 'at-threshold', navigationReason: null,
  } : row) };
  const before = JSON.stringify(projected), row = describeEaldholtPopulationLife(projected)!.residents[person.id];
  assert.equal(row.presentation.activity, 'Waits to begin work.');
  assert.equal(row.status, 'queued');
  assert.equal(row.intent.activity, intent.activity);
  assert.equal(JSON.stringify(projected), before, 'wording changes neither the canonical intent nor life records');
});

test('read-only patrol diagnostics keep physical phase separate from the canonical goal and simulated duty counters',()=>{
  const sample=lifeSample(),person=POPULATION.residents.find(r=>r.registry.role.id==='spearman'&&r.registry.routine.some(s=>s.activity.startsWith('Patrols the lanes')))!;
  const slot=person.registry.routine.find(s=>s.activity.startsWith('Patrols the lanes'))!,old=sample.life!.residents.find(r=>r.residentId===person.id)!;
  const intent={...old.intent,activityKey:'patrol' as const,activity:slot.activity,targetPlaceId:slot.placeId,reason:'routine' as const,indoor:false};
  const patrol=Object.freeze({planId:'source-authored-lane-plan',phase:'travelling' as const,completedLegs:3,waypointPlaceId:'source-local-lane-turn'});
  const frame={...sample,life:{...sample.life!,residents:sample.life!.residents.map(r=>r.residentId===person.id?{...r,intent}:r)},residents:sample.residents.map(r=>r.residentId===person.id?{...r,activity:slot.activity,scheduledPlaceId:slot.placeId,lifeIntent:intent,
    moving:true,presentable:true,status:'travelling' as const,navigationStatus:'travelling',navigationReason:null,position:[1,0,2] as const,patrol}:r)};
  const before=JSON.stringify(frame),details=describeEaldholtPopulationLife(frame)!,shown=details.residents[person.id];
  assert.equal(shown.presentation.activity,'Patrols the lane.');assert.deepEqual(shown.presentation.patrol,patrol);
  assert.equal(shown.intent.activity,slot.activity);assert.equal(shown.intent.targetPlaceId,slot.placeId);
  assert.deepEqual(shown.counters,old.counters);assert.equal(details.counterProvenance,'simulated-routine');assert.equal(JSON.stringify(frame),before);
});
test('a standing endpoint authorizes household work only at its validated station and orientation', () => {
  const resident = POPULATION.residents.find(row => row.appearance.kind === 'existing-set')!;
  const original = lifeSample().residents.find(row => row.residentId === resident.id)!;
  const state = { ...original, position: [10, 0, 0] as const, yawRadians: .5, status: 'at-place' as const,
    placeId: resident.workPlaceId, workPoseQualified: false, presentable: true,
    lifeIntent: { ...original.lifeIntent!, activityKey: 'work' as const, targetPlaceId: resident.workPlaceId } };
  const anchors = { [resident.id]: { position: [10, 0, 0] as const, yawRadians: .5 } };
  assert.equal(qualifyEaldholtWorkplacePose(state, undefined).workPoseQualified, false);
  assert.equal(qualifyEaldholtWorkplacePose(state, anchors).workPoseQualified, true);
  assert.equal(qualifyEaldholtWorkplacePose({ ...state, waitingForResource: true, lifeStatus: 'queued' }, anchors).workPoseQualified, false, 'a queued wait cannot authorize equipment use');
  assert.equal(state.workPoseQualified, false, 'certification never mutates saved navigation');
  assert.equal(qualifyEaldholtWorkplacePose({ ...state, position: [10.1, 0, 0] }, anchors).workPoseQualified, false);
  assert.equal(qualifyEaldholtWorkplacePose({ ...state, yawRadians: .7 }, anchors).workPoseQualified, false);
  assert.equal(qualifyEaldholtWorkplacePose({ ...state, placeId: resident.homePlaceId }, anchors).workPoseQualified, false);
  assert.equal(qualifyEaldholtWorkplacePose({ ...state, lifeIntent: { ...state.lifeIntent, activityKey: 'shelter' } }, anchors).workPoseQualified, false);
  assert.equal(qualifyEaldholtWorkplacePose({ ...state, moving: true }, anchors).workPoseQualified, false);
  assert.equal(qualifyEaldholtWorkplacePose({ ...state, yawRadians: NaN }, anchors).workPoseQualified, false);
});

test('a life interruption invalidates reduced-motion presentation even inside the same schedule slot', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let sample = lifeSample();
  const view = inactiveView(() => ({ sample, clockSeconds: 0 }));
  try {
    t.mock.timers.tick(250); const revision = view.snapshot.visualRevision;
    const first = sample.residents[0];
    sample = { ...sample, residents: [{ ...first, lifeIntent: { ...first.lifeIntent!,
      activityKey: 'shelter', issuedAbsoluteMinute: 541, reason: 'weather' } }, ...sample.residents.slice(1)] };
    t.mock.timers.tick(250); assert.equal(view.snapshot.visualRevision, revision + 1);
  } finally { view.dispose(); }
});

test('life summary caching follows immutable time and resident-fact changes and clears on teardown', () => {
  const cache = createEaldholtPopulationDiagnosticsCache();
  const first = cache.read(residentLife); assert.strictEqual(cache.read(residentLife), first);
  const laterLife = createVillageLife(POPULATION, 541, 'presentation-test-world');
  const later = cache.read(laterLife); assert.notStrictEqual(later, first);
  assert.equal(later?.summary.absoluteMinute, 541);
  const changedFacts = { ...laterLife, residents: laterLife.residents.map((row, index) => index ? row
    : { ...row, counters: { ...row.counters, completedDuties: row.counters.completedDuties + 1 } }) };
  const changed = cache.read(changedFacts); assert.notStrictEqual(changed, later);
  assert.equal(changed!.summary.completedDuties, later!.summary.completedDuties + 1);
  cache.clear(); assert.notStrictEqual(cache.read(changedFacts), changed);
  assert.equal(cache.read(null), null);
});

test('diagnostic serialization caches large resident records while clock and changed intent stay current', () => {
  const cache = createEaldholtPopulationDiagnosticsCache(), details = describeEaldholtPopulationLife(lifeSample())!;
  let encodes = 0;
  const life = { ...details, toJSON() { encodes++; return details; } };
  const first = JSON.parse(cache.serializeSnapshot({ time: { dayMinute: 540, fractionalMinute: 0 }, life }));
  const clock = JSON.parse(cache.serializeSnapshot({ time: { dayMinute: 540, fractionalMinute: .5 }, life }));
  assert.equal(encodes, 1, 'preparing multiple frames reuses the large immutable JSON segment');
  assert.equal(first.time.fractionalMinute, 0); assert.equal(clock.time.fractionalMinute, .5);
  const id = POPULATION.residents[0].id, resident = details.residents[id];
  const changed = { ...details, residents: { ...details.residents, [id]: { ...resident,
    intent: { ...resident.intent, activityKey: 'shelter' as const, reason: 'weather' as const } } } };
  const next = JSON.parse(cache.serializeSnapshot({ time: { dayMinute: 541 }, life: changed }));
  assert.equal(next.life.residents[id].intent.activityKey, 'shelter');
  assert.equal(next.life.residents[id].intent.reason, 'weather');
  cache.clear(); cache.serializeSnapshot({ life }); assert.equal(encodes, 2);
});

test('a changed life lease invalidates reduced-motion presentation without changing the activity or schedule slot', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let sample = lifeSample();
  const view = inactiveView(() => ({ sample, clockSeconds: 0 }));
  try {
    t.mock.timers.tick(250); const revision = view.snapshot.visualRevision;
    sample = { ...sample, residents: sample.residents.map((row, index) => index ? row
      : { ...row, lifeStatus: 'queued', reason: 'life-resource-unavailable' }) };
    t.mock.timers.tick(250); assert.equal(view.snapshot.visualRevision, revision + 1);
  } finally { view.dispose(); }
});


test('pre-cull availability covers all100 identities while a known thatcher point stays held and life/navigation facts stay read-only', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const person = POPULATION.residents.find(row => row.id === 'ealdholt-thatcher')!;
  const base = lifeSample(), slotIndex = person.registry.routine.findIndex(slot => slot.activity === 'Patches a roof with fresh thatch.'), slot = person.registry.routine[slotIndex];
  const sample: VillagePopulationSample = { ...base, residents: base.residents.map(row => row.residentId === person.id ? { ...row,
    activity: slot.activity, scheduledPlaceId: slot.placeId, placeId: slot.placeId, slotIndex, slotStartMinute: slot.startMinute, slotEndMinute: slot.endMinute,
    status: 'at-place', reason: null, position: [10, 0, 0], moving: false, presentable: true, lifeIntent: undefined, workPoseQualified: false } : row) };
  const before = JSON.stringify(sample), view = inactiveView(() => ({ sample, clockSeconds: 0 }));
  try {
    assert.equal(view.residentAvailability(person.id).body, 'pending');
    assert.equal(view.residentAvailability('unregistered-person').body, 'unknown');
    t.mock.timers.tick(250);
    assert.equal(view.sample, sample, 'availability and the observer sample share the exact adapter frame');
    for (const resident of POPULATION.residents) {
      const availability = view.residentAvailability(resident.id);
      assert.equal(availability.residentId, resident.id); assert.equal(availability.body, 'held');
      assert.equal(availability.bodyReady, false); assert.equal(availability.drawnFrame, null);
    }
    assert.deepEqual(view.residentAvailability(person.id).position, [10, 0, 0]);
    assert.equal(view.snapshot.selected, 0); assert.equal(view.snapshot.crowd.loading, 0); assert.equal(view.snapshot.household.loading, 0);
    assert.equal(JSON.stringify(sample), before, 'availability does not advance life or change source-bound journeys or arrival evidence');
  } finally { view.dispose(); }
  assert.equal(view.residentAvailability(person.id).body, 'pending');
});


test('a genuinely motion-qualified row remains qualified before camera selection without claiming a loaded or drawn figure', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const person = POPULATION.residents.find(row => row.id === 'ealdholt-thatcher')!, art = getPopulationArt(person.id)!, base = lifeSample();
  const sample: VillagePopulationSample = { ...base, residents: base.residents.map(row => row.residentId === person.id ? { ...row,
    status: 'travelling', reason: null, position: [10, 0, 0], moving: true, presentable: true, lifeIntent: undefined,
    navigationStatus: 'travelling', navigationReason: null } : row) };
  // Synthetic unit envelopes only; no runtime source certificate is manufactured.
  const clips = Object.fromEntries([art.motions.idle, art.motions.walk, `${art.motions.walk}_start`, `${art.motions.walk}_stop`].map(name => [name,
    { radiusMetres: .45, heightMetres: 1.8, minimumBodyYMetres: 0, placedBelowGround: false }]));
  const evidence = parsePopulationMotionEvidence({ schemaVersion: 1, method: 'cpu-sampled-skin-and-props-v1', fps: 60, paddingMetres: .05,
    residents: { [person.id]: { levels: { crowd: { files: { ...HASHES }, clips } } } } });
  const before = JSON.stringify(sample), view = inactiveView(() => ({ sample, clockSeconds: 0 }), evidence);
  try {
    t.mock.timers.tick(250);
    const availability = view.residentAvailability(person.id);
    assert.equal(availability.body, 'qualified'); assert.equal(availability.bodyReady, false); assert.equal(availability.drawnFrame, null);
    assert.equal(view.snapshot.selected, 0); assert.equal(view.object.visible, false);
    assert.equal(view.snapshot.crowd.loading, 0); assert.equal(view.snapshot.household.loading, 0);
    assert.equal(JSON.stringify(sample), before);
  } finally { view.dispose(); }
});


test('Desktop defers a 100-resident changed frame atomically, reuses exact rows and cancels pending work on disposal', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const queued: Array<{ callback: () => void; cancelled: boolean }> = [];
  const scheduler: ResidentProcessingScheduler = { schedule(callback) {
    const task = { callback, cancelled: false }; queued.push(task); return { cancel() { task.cancelled = true; } };
  } };
  const drain = () => { let tasks = 0; while (queued.length) {
    const task = queued.shift()!; if (!task.cancelled) task.callback(); assert.ok(++tasks < 100);
  } };
  const initial = lifeSample(); let sample = initial;
  let clockSeconds = 0, paused = false, animationRate = 1;
  const view = inactiveView(() => ({ sample, clockSeconds, paused, animationRate }), null, scheduler);
  try {
    t.mock.timers.tick(250); assert.strictEqual(view.sample, initial);
    const oldLife = view.snapshot.life;
    sample = { ...initial, residents: initial.residents.map(row => ({ ...row, status: 'travelling', reason: null,
      position: [10, 0, 0], presentable: true, moving: true, lifeIntent: undefined, navigationStatus: 'travelling', navigationReason: null })) };
    clockSeconds = 37; paused = true; animationRate = 0;
    const before = JSON.stringify(sample);
    t.mock.timers.tick(250);
    assert.ok(view.snapshot.processing.backlog > 0); assert.ok(view.snapshot.processing.maximumQualificationsInTask <= 16);
    assert.strictEqual(view.sample, initial, 'no partial physical frame is observable');
    assert.strictEqual(view.snapshot.life, oldLife, 'diagnostics remain paired with the committed physical frame');
    drain(); assert.strictEqual(view.sample, sample); assert.equal(view.snapshot.processing.backlog, 0);
    assert.equal(view.snapshot.processing.qualifications, 100);
    assert.equal(view.snapshot.animationClockSeconds, 37);
    assert.equal(view.snapshot.animationPaused, true); assert.equal(view.snapshot.animationRate, 0);
    assert.equal(JSON.stringify(sample), before, 'qualification never mutates the runtime sample');
    const qualifiedLife = view.snapshot.life;
    const qualifications = view.snapshot.processing.qualifications;
    sample = { ...sample, residents: sample.residents.map(row => ({ ...row })) };
    t.mock.timers.tick(250);
    assert.strictEqual(view.sample, sample); assert.equal(view.snapshot.processing.qualifications, qualifications);
    assert.strictEqual(view.snapshot.life, qualifiedLife, 'immutable life and equal physical facts reuse the large diagnostics');
    sample = { ...sample, residents: sample.residents.map(row => ({ ...row, position: [11, 0, 0] })) };
    t.mock.timers.tick(250); assert.ok(view.snapshot.processing.backlog > 0);
    const late = queued[queued.length - 1].callback; view.dispose(); late(); drain();
    assert.equal(view.sample, null); assert.equal(view.snapshot.processing.taskPending, false);
    assert.equal(view.object.userData.crownfallPopulationLife, undefined);
  } finally { view.dispose(); }
});


test('Desktop keeps latest safety revocations through three ticks and an older frame publication', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const queued: Array<{ callback: () => void; cancelled: boolean }> = [];
  const scheduler: ResidentProcessingScheduler = { schedule(callback) {
    const task = { callback, cancelled: false }; queued.push(task); return { cancel() { task.cancelled = true; } };
  } };
  const step = () => { const task = queued.shift()!; if (!task.cancelled) task.callback(); };
  const person = POPULATION.residents.find(row => row.id === 'ealdholt-thatcher')!, art = getPopulationArt(person.id)!, base = lifeSample();
  const clips = Object.fromEntries([art.motions.idle, art.motions.walk, `${art.motions.walk}_start`, `${art.motions.walk}_stop`].map(name => [name,
    { radiusMetres: .45, heightMetres: 1.8, minimumBodyYMetres: 0, placedBelowGround: false }]));
  const evidence = parsePopulationMotionEvidence({ schemaVersion: 1, method: 'cpu-sampled-skin-and-props-v1', fps: 60, paddingMetres: .05,
    residents: { [person.id]: { levels: { crowd: { files: { ...HASHES }, clips } } } } });
  const walking = (row: typeof base.residents[number], x: number): typeof row => ({ ...row, status: 'travelling', reason: null,
    position: [x, 0, -10], presentable: true, moving: true, lifeIntent: undefined, navigationStatus: 'travelling', navigationReason: null });
  for (const initiallyQualified of [true, false]) {
    const initial = { ...base, residents: base.residents.map(row => initiallyQualified && row.residentId === person.id ? walking(row, 0) : row) };
    let sample: VillagePopulationSample = initial;
    const view = inactiveView(() => ({ sample, clockSeconds: 0 }), evidence, scheduler);
    try {
      t.mock.timers.tick(250); assert.equal(view.residentAvailability(person.id).body, initiallyQualified ? 'qualified' : 'held');
      // A is still processing while B and C revoke its walk. No mesh has loaded:
      // a future cold actor needs the same protection as a previously visible one.
      const a: VillagePopulationSample = { ...base, residents: base.residents.map((row, index) => walking(row, index + 1)) };
      sample = a; t.mock.timers.tick(250); assert.ok(view.snapshot.processing.backlog > 0);
      const b: VillagePopulationSample = { ...a, residents: a.residents.map(row => row.residentId === person.id
        ? { ...row, status: 'unmapped', presentable: false, moving: false, reason: 'activity-indoors', navigationStatus: 'indoors' } : row) };
      sample = b; t.mock.timers.tick(250);
      assert.equal(view.residentAvailability(person.id).body, 'held', 'B immediately revokes the previously qualified walk');
      sample = { ...b }; t.mock.timers.tick(250);
      assert.equal(view.residentAvailability(person.id).body, 'held', 'C retains the hold even though the actor is invisible');
      let tasks = 0;
      while (view.sample !== a) { assert.ok(queued.length && ++tasks < 100); step(); }
      assert.equal(view.residentAvailability(person.id).body, 'held', 'older A publication cannot resurrect its superseded action');
      assert.equal(view.snapshot.processingPending, true);
      while (queued.length) { assert.ok(++tasks < 100); step(); }
      assert.strictEqual(view.sample, sample); assert.equal(view.residentAvailability(person.id).body, 'held');
      sample = { ...a }; t.mock.timers.tick(250);
      assert.strictEqual(view.sample, sample); assert.equal(view.residentAvailability(person.id).body, 'qualified',
        'only a complete latest frame may release the safety hold');
      assert.equal(view.snapshot.crowd.loading, 0); assert.equal(view.snapshot.household.loading, 0);
    } finally { view.dispose(); }
  }
});


test('Desktop wakes a static renderer for deferred visible poses and one immediate hold, while cache and clock ticks stay quiet', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  // Keep real presenter intake pending: this regression exercises actual
  // selection and deferred publication without loading or fabricating a model.
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>(() => {}));
  const queued: Array<{ callback: () => void; cancelled: boolean }> = [];
  const scheduler: ResidentProcessingScheduler = { schedule(callback) {
    const task = { callback, cancelled: false }; queued.push(task); return { cancel() { task.cancelled = true; } };
  } };
  const drain = async () => { let tasks = 0; while (queued.length) {
    await new Promise<void>(resolve => setImmediate(resolve));
    const task = queued.shift()!; if (!task.cancelled) task.callback(); assert.ok(++tasks < 100);
  } };
  const person = POPULATION.residents.find(row => row.id === 'ealdholt-thatcher')!, art = getPopulationArt(person.id)!, base = lifeSample();
  const clips = Object.fromEntries([art.motions.idle, art.motions.walk, `${art.motions.walk}_start`, `${art.motions.walk}_stop`].map(name => [name,
    { radiusMetres: .45, heightMetres: 1.8, minimumBodyYMetres: 0, placedBelowGround: false }]));
  const evidence = parsePopulationMotionEvidence({ schemaVersion: 1, method: 'cpu-sampled-skin-and-props-v1', fps: 60, paddingMetres: .05,
    residents: { [person.id]: { levels: { crowd: { files: { ...HASHES }, clips } } } } });
  let sample = base, clockSeconds = 0, wakes = 0;
  const view = inactiveView(() => ({ sample, clockSeconds }), evidence, scheduler, () => wakes++);
  try {
    view.setActive(true); assert.equal(wakes, 0, 'empty static presentation has nothing new to draw');
    sample = { ...base, residents: base.residents.map(row => ({ ...row, status: 'travelling', reason: null,
      position: [0, 0, -10], presentable: true, moving: true, lifeIntent: undefined, navigationStatus: 'travelling', navigationReason: null })) };
    t.mock.timers.tick(250); assert.ok(view.snapshot.processing.backlog > 0); assert.equal(wakes, 0);
    await drain(); assert.equal(view.snapshot.selected, 1); assert.equal(wakes, 1, 'CPU-task commit wakes without any RAF/update call');
    const qualifications = view.snapshot.processing.qualifications;
    clockSeconds = 10; sample = { ...sample, time: { ...sample.time, fractionalMinute: .5 } };
    t.mock.timers.tick(250); assert.equal(wakes, 1, 'metadata and animation clocks alone do not wake a static renderer');
    assert.equal(view.snapshot.processing.qualifications, qualifications);
    sample = { ...sample, residents: sample.residents.map(row => ({ ...row, position: [.25, 0, -10] })) };
    t.mock.timers.tick(250); assert.equal(wakes, 1); await drain(); assert.equal(wakes, 2, 'a deferred physical pose change wakes once');
    sample = { ...sample, residents: sample.residents.map(row => ({ ...row, position: [.5, 0, -10] })) };
    t.mock.timers.tick(250); assert.ok(view.snapshot.processing.backlog > 0); assert.equal(wakes, 2);
    sample = { ...sample, residents: sample.residents.map(row => row.residentId === person.id
      ? { ...row, status: 'unmapped', reason: 'activity-indoors', navigationStatus: 'indoors', presentable: false, moving: false } : row) };
    t.mock.timers.tick(250); assert.equal(wakes, 3, 'latest safety revocation wakes immediately');
    t.mock.timers.tick(250); assert.equal(wakes, 3, 'an already revoked actor does not wake again');
    await drain(); assert.equal(wakes, 3, 'older and final held publications cannot duplicate the safety wake');
    t.mock.timers.tick(250); assert.equal(wakes, 3, 'stable held polling stays quiet');
  } finally { view.dispose(); }
});


test('disaster stations extend only the observed presenter graph and cannot replace source homes or allocation',async t=>{
 t.mock.timers.enable({apis:['setInterval']});const view=inactiveView(()=>({sample:lifeSample(),clockSeconds:0}));
 const resident=POPULATION.residents[0],alias={residentId:resident.id,placeId:`disaster-${resident.id}-water-fixture`,anchorId:measuredSite.anchors[0].id,status:'mapped-exterior' as const};
 const certificate={id:alias.placeId,residentId:alias.residentId,placeId:alias.placeId,anchorId:alias.anchorId,kind:'water' as const,buildingKey:null,sourceActor:'synthetic-unit-test-ground',contactPoint:[10,1,0]as const,yawRadians:0,clip:'carry_bucket_walk' as const,operationWorldMinutes:1,waterUnits:20,proof:{sourceSha256:measuredSite.sourceSha256,profile:measuredSite.profile,siteIdentity:'unit-site-artifact',originalTriangleClearance:true as const,wholeFootprintSupported:true as const,sweptClipAndPropsClear:true as const,contactSourceActor:'unit-source-well',maximumContactDistanceMetres:2,clip:'carry_bucket_walk'}};
 const original=JSON.stringify(measuredSite),derived=Object.freeze({...measuredSite,residentPlaceBindings:Object.freeze([...measuredSite.residentPlaceBindings,alias]),emergencyTargets:Object.freeze([certificate])});
 try{
  view.setEmergencySite(derived);assert.strictEqual(view.readSite(),derived);assert.equal(JSON.stringify(measuredSite),original);assert.equal(view.snapshot.error,'');
  assert.equal(view.emergencyPropFor(resident.id,'bucket'),null);assert.equal(view.emergencyWorkpieceFor(resident.id),null);assert.equal(view.emergencyContactEventFor(resident.id),null);
  assert.equal(await view.loadEmergencyWorkpieceTemplate('unknown-resident'),null,'no actor or prop is fabricated for an unknown resident');
  for(const changed of [{...derived,sourceSha256:'b'.repeat(64)},{...derived,capsule:{...derived.capsule,radius:2}},{...derived,residentPlaceBindings:[{...alias,anchorId:'fabricated-anchor'}]},
    {...derived,residentPlaceBindings:[{...alias,placeId:resident.homePlaceId}]},{...derived,anchors:[]},{...derived,navigationRevision:'unapproved-reallocation'}])assert.throws(()=>view.setEmergencySite(changed),/source graph|resident station|action target/);
  assert.throws(()=>view.setEmergencySite({...derived,emergencyTargets:undefined}),/resident station|action target/,'a disaster prefix never authorizes an unknown place');
  assert.strictEqual(view.readSite(),derived);assert.equal(view.snapshot.crowd.loading,0);assert.equal(view.snapshot.household.loading,0);
 }finally{view.dispose();}
});


test('repeated unchanged composite polls retain a smooth bounded presentation clock; pause and actual rewind stay explicit',t=>{
 t.mock.timers.enable({apis:['setInterval']});let now=1000,paused=false,sourceSeconds=4;
 t.mock.method(performance,'now',()=>now);const sample={...lifeSample(),visualAdvanceSeconds:.75},view=inactiveView(()=>({sample,clockSeconds:sourceSeconds,paused,animationRate:1}));
 try{
  view.setActive(true);view.update(0,false);now=1200;view.update(.2,false);assert.ok(Math.abs(view.snapshot.animationClockSeconds-4.2)<1e-8);
  now=1250;t.mock.timers.tick(250);view.update(0,false);assert.ok(Math.abs(view.snapshot.animationClockSeconds-4.25)<1e-8,'a4Hz repoll cannot rewind the unchanged1Hz composite');
  now=1400;view.update(.15,false);assert.ok(Math.abs(view.snapshot.animationClockSeconds-4.4)<1e-8);
  now=4000;view.update(2.6,false);assert.equal(view.snapshot.animationClockSeconds,4.75,'uncommitted future world minutes cannot be predicted');
  paused=true;t.mock.timers.tick(250);now=5000;view.update(1,false);assert.equal(view.snapshot.animationClockSeconds,4.75);
  sourceSeconds=5;paused=false;t.mock.timers.tick(250);now=5100;view.update(.1,false);assert.ok(Math.abs(view.snapshot.animationClockSeconds-5.1)<1e-8);
  sourceSeconds=2;t.mock.timers.tick(250);view.update(0,false);assert.equal(view.snapshot.animationClockSeconds,2,'an explicit source rewind resets presentation rather than retaining future pose time');
  assert.equal(view.snapshot.error,'');
 }finally{view.dispose();}
});

test('measured carry sidecar stays separate from the presenter source graph and cannot alter original clearance or anchors',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const {EALDHOLT_SWINE_CARRY_ROUTE_CANDIDATE:source}=await import('../../../../shared/legacy/aethelgard/characters/ealdholt-emergency-route-candidate');
 const {parseVillageSiteEmergencyTraversals}=await import('../../../../shared/legacy/aethelgard/characters/village-emergency-traversal');
 // Contract-only scene fixture. Actual original-triangle proof is a separate
 // source-helper test; no scene geometry or residents are fabricated here.
 const ground=[[10,0,0],[13,0,0]]as const,bottom=[[10,.02,0],[13,.02,0]]as const;
 const base=Object.freeze({...measuredSite,capsule:Object.freeze({radius:.85,height:3.5}),anchors:[...measuredSite.anchors,{id:'carry-other-existing-anchor',sourceActor:'synthetic-unit-test-ground',standingOnly:true as const,sourceGroundPoint:ground[1],capsuleBottomPoint:bottom[1]}]});
 const routes=parseVillageSiteEmergencyTraversals([{id:'unit-measured-carry',residentId:source.residentId,profile:'desktop',sourceSha256:base.sourceSha256,siteIdentity:'unit-source-site',certificateSha256:source.certificateSha256,fromAnchorId:base.anchors[0].id,toAnchorId:base.anchors[1].id,reversible:true,requiredClip:source.requiredClip,sourceGroundPolyline:ground,capsuleBottomPolyline:bottom,lengthMetres:3,body:source.body,files:source.files,proof:{sourceOriginalBuffersUnchanged:true,originalTriangleClearance:true,wholeFootprintSupported:true,publicExteriorOnly:true,carryLoopAndFixedPose0:true,unmeasuredTransitions:false}}]);
 const view=createEaldholtVillagePopulationView({camera:new PerspectiveCamera(),viewportHeight:()=>720,sourceIdentity:{profile:'desktop',sha256:base.sourceSha256},sourceRoot:new Object3D(),root:'https://assets.invalid/characters/',integritySha256:{},site:base,motionEvidence:null,readFrame:()=>({sample:lifeSample(),clockSeconds:0})});
 const before=JSON.stringify(base),derived=Object.freeze({...base,emergencyTraversals:routes});
 try{view.setEmergencySite(derived);assert.strictEqual(view.readSite(),derived);assert.equal(JSON.stringify(base),before);assert.strictEqual(derived.routes,base.routes);assert.strictEqual(derived.capsule,base.capsule);
  assert.throws(()=>view.setEmergencySite({...derived,anchors:[]}),/source anchors|source graph/);
  assert.throws(()=>view.setEmergencySite({...derived,capsule:{radius:.63,height:1.93}}),/source graph/);
  assert.throws(()=>view.setEmergencySite({...derived,emergencyTraversals:[{...routes[0],requiredClip:'walk' as any}]}),/carry contract/);
  assert.strictEqual(view.readSite(),derived);assert.equal(view.snapshot.crowd.loading,0);
 }finally{view.dispose();}
});

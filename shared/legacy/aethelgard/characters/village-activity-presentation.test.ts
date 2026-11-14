import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { EALDHOLT_VILLAGE_POPULATION as POP, getPopulationClip, type PopulationResident } from './village-population';
import { getPopulationArt } from './village-population-art';
import { HOUSEHOLD_ART_LEVELS, HOUSEHOLD_ART_SETS, getHouseholdArtSet, householdArtFile, householdArtFolder } from './household-art-sets';
import { isWalkLikeClip, parseCrowdResidentMeta, planCrowdClips } from './crowd-binding';
import { POPULATION_ACTIVITY_PRESENTATION, POPULATION_ACTIVITY_ROLE_OVERRIDES, resolvePopulationPresentation, populationPresentationHeldReason, displayPopulationActivity } from './village-activity-presentation';
import { createVillageLife, advanceVillageLife, type VillageLifeIntent } from './village-life';
import type { ResidentSafetySignal } from './resident-safety';
import type { VillagePopulationResidentState } from './village-population-runtime';
const ROOT = new URL('../../../../main game/public/assets/legacy/environment/', import.meta.url);
function actualClips(path: string): ReadonlySet<string> {
  const bytes = fs.readFileSync(new URL(path, ROOT)); assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
  return new Set((json.animations ?? []).map((a: { name: string }) => a.name));
}
const libraries = new Map(POP.clipLibraries.map(l => [l.archetype, actualClips(`aethelgard/characters/crowd-v1/clips/${l.file}`)] as const));
function state(r: PopulationResident, activity: string, patch: Partial<VillagePopulationResidentState> = {}): VillagePopulationResidentState {
  const slotIndex = r.registry.routine.findIndex(s => s.activity === activity), slot = r.registry.routine[slotIndex];
  return { residentId: r.id, tier: r.fidelityTier, activity, roleClip: null,
    availableRoleClips: r.appearance.motion.roleClips, scheduledPlaceId: slot?.placeId ?? r.homePlaceId,
    placeId: slot?.placeId ?? r.homePlaceId, fromPlaceId: r.homePlaceId, slotIndex,
    slotStartMinute: slot?.startMinute ?? 0, slotEndMinute: slot?.endMinute ?? 1440,
    status: 'at-place', reason: null, position: [0, 0, 0], yawRadians: 0, moving: false, presentable: true, ...patch };
}
function residentFor(activity: string, clip?: string): PopulationResident {
  const r = POP.residents.find(r => r.appearance.kind === 'crowd'
    && r.registry.routine.some(s => s.activity === activity) && (!clip || r.appearance.motion.roleClips.includes(clip)));
  assert.ok(r, `${activity}/${clip}: published resident must exercise case`); return r;
}

test('a qualified resource queue explicitly waits; active work and completed travel never become idle substitutes',()=>{
  for(const r of POP.residents){
    const activity=r.registry.routine.find(slot=>resolvePopulationPresentation(state(r,slot.activity)).motion==='work')?.activity;
    if(!activity)continue;
    const slot=r.registry.routine.find(slot=>slot.activity===activity)!;
    const intent:VillageLifeIntent={residentId:r.id,targetPlaceId:slot.placeId,activityKey:'work',activity,priority:40,issuedAbsoluteMinute:540,indoor:false,companionIds:[],reason:'routine'};
    const waiting=state(r,activity,{waitingForResource:true,lifeStatus:'queued',lifeIntent:intent,
      navigationStatus:'at-threshold',navigationReason:null,reason:'life-resource-unavailable',workPoseQualified:false});
    assert.deepEqual(resolvePopulationPresentation(waiting),{motion:'idle',activity:{},presentable:true,reason:null,waitingForResource:true},r.id);
    for(const patch of [
      {lifeStatus:'active' as const},{lifeStatus:'unavailable' as const},{status:'blocked' as const},
      {moving:true},{position:null},{navigationStatus:'waiting'},{navigationStatus:'indoors'},
      {navigationReason:'source-site-changed'},{reason:null},{placeId:'unmapped-place'},
      {lifeIntent:{...intent,indoor:true}},{lifeIntent:{...intent,residentId:'other-person'}},
      {lifeIntent:{...intent,reason:'needs' as const}},{lifeIntent:{...intent,activityKey:'patrol' as const}},
    ])assert.equal(resolvePopulationPresentation({...waiting,...patch}).presentable,false,`${r.id}: ${JSON.stringify(patch)}`);
  }
  const roof=residentFor('Patches a roof with fresh thatch.'),activity='Patches a roof with fresh thatch.';
  const intent:VillageLifeIntent={residentId:roof.id,targetPlaceId:roof.workPlaceId,activityKey:'work',activity,priority:40,issuedAbsoluteMinute:540,indoor:false,companionIds:[],reason:'routine'};
  const unsupported=state(roof,activity,{placeId:roof.workPlaceId,scheduledPlaceId:roof.workPlaceId,waitingForResource:true,lifeStatus:'queued',lifeIntent:intent,
    navigationStatus:'at-threshold',navigationReason:null,reason:'life-resource-unavailable',workPoseQualified:false});
  assert.equal(resolvePopulationPresentation(unsupported).reason,'waiting-activity-unqualified');
  assert.equal(resolvePopulationPresentation({...unsupported,waitingForResource:undefined,lifeStatus:'active'}).presentable,false);
});

test('current display labels distinguish a genuine work wait while preserving ordinary, raid and away wording and canonical intent',()=>{
  const activity='Sells ale from the stall in the courtyard.',person=residentFor(activity,'work_sell');
  const intent:VillageLifeIntent={residentId:person.id,targetPlaceId:person.workPlaceId,activityKey:'work',activity,
    priority:40,issuedAbsoluteMinute:540,indoor:false,companionIds:[],reason:'routine'};
  const waiting=state(person,activity,{placeId:person.workPlaceId,scheduledPlaceId:person.workPlaceId,
    lifeIntent:intent,waitingForResource:true,lifeStatus:'queued',navigationStatus:'at-threshold',navigationReason:null,
    reason:'life-resource-unavailable',workPoseQualified:false});
  const before=JSON.stringify(waiting),shown={residentId:person.id,activity,scheduledPlaceId:person.workPlaceId};
  assert.equal(displayPopulationActivity(waiting),'Waits to begin work.');
  assert.equal(displayPopulationActivity(waiting,shown),'Waits to begin work.');
  for(const patch of [
    {waitingForResource:undefined},{lifeStatus:'active' as const},{lifeStatus:'unavailable' as const},
    {position:null},{presentable:false},{navigationStatus:'indoors'},{navigationReason:'source-site-changed'},
    {lifeIntent:{...intent,activityKey:'patrol' as const}},{lifeIntent:{...intent,indoor:true}},
  ])assert.equal(displayPopulationActivity({...waiting,...patch}),activity,'a display helper cannot authorize a held or ordinary activity');
  assert.equal(displayPopulationActivity(waiting,{...shown,alarm:true,activity:'Shelters from the raiders.'}),'Shelters from the raiders.');
  assert.equal(displayPopulationActivity(waiting,{...shown,away:true,activity:'Travels to the market.'}),'Travels to the market.');
  assert.equal(displayPopulationActivity(waiting,{...shown,alarm:true}),activity);
  assert.equal(displayPopulationActivity(waiting,{...shown,away:true}),activity);
  assert.equal(displayPopulationActivity(waiting,{...shown,scheduledPlaceId:person.homePlaceId}),activity);
  assert.equal(displayPopulationActivity(waiting,{...shown,activity:'Returns to the household.'}),'Returns to the household.');
  assert.equal(displayPopulationActivity(waiting,{...shown,residentId:'another-resident',activity:'Unrelated activity.'}),'Waits to begin work.');
  assert.equal(waiting.activity,activity);assert.equal(waiting.lifeIntent?.activity,activity);
  assert.equal(JSON.stringify(waiting),before,'only the display string changes; canonical intention, history and counters are untouched');
});
test('physical lane patrol wording describes the actual phase without changing intention or authorizing idle, work or overrides',()=>{
  const resident=POP.residents.find(r=>r.registry.role.id==='spearman'&&r.registry.routine.some(s=>s.activity.startsWith('Patrols the lanes')))!;
  const slot=resident.registry.routine.find(s=>s.activity.startsWith('Patrols the lanes'))!;
  const intent:VillageLifeIntent={residentId:resident.id,targetPlaceId:slot.placeId,activityKey:'patrol',activity:slot.activity,priority:60,issuedAbsoluteMinute:780,indoor:false,companionIds:[],reason:'routine'};
  const moving=state(resident,slot.activity,{status:'travelling',placeId:null,moving:true,lifeIntent:intent,lifeStatus:'active',workPoseQualified:false,
    navigationStatus:'travelling',navigationReason:null,arrivalEvidence:'none',patrol:{planId:'actual-lane-plan',phase:'travelling',completedLegs:3,waypointPlaceId:'local-lane-turn'}});
  const before=JSON.stringify(moving);assert.equal(displayPopulationActivity(moving),'Patrols the lane.');assert.equal(resolvePopulationPresentation(moving).activity.roleClip,'guard_patrol_walk');
  const paused={...moving,status:'at-place' as const,moving:false,placeId:'local-lane-turn',navigationStatus:'at-threshold',arrivalEvidence:'certified-route-arrival' as const,patrol:{...moving.patrol!,phase:'dwelling' as const}};
  assert.equal(displayPopulationActivity(paused),'Pauses on the lane.');assert.equal(resolvePopulationPresentation(paused).reason,'locomotion-requires-moving-state','a reached patrol does not borrow idle or work');
  const waiting={...paused,status:'blocked' as const,navigationStatus:'waiting',navigationReason:'corridor-reserved',patrol:{...moving.patrol!,phase:'waiting' as const}};
  assert.equal(displayPopulationActivity(waiting),'Waits on the patrol route.');assert.equal(resolvePopulationPresentation(waiting).presentable,false);
  assert.equal(displayPopulationActivity({...waiting,navigationReason:'source-site-changed'}),slot.activity);
  assert.equal(displayPopulationActivity({...moving,patrol:undefined}),slot.activity);
  assert.equal(displayPopulationActivity({...moving,lifeIntent:{...intent,residentId:'someone-else'}}),slot.activity);
  const overlay={residentId:resident.id,scheduledPlaceId:slot.placeId,activity:'Seeks shelter from a known incident.',alarm:true};
  assert.equal(displayPopulationActivity(moving,overlay),overlay.activity);assert.equal(displayPopulationActivity(moving,{...overlay,alarm:false,away:true}),overlay.activity);
  assert.equal(JSON.stringify(moving),before);assert.equal(moving.lifeIntent?.activity,slot.activity);
});
test('an explicitly qualified guard arrival presents neutral idle and honest pause wording, never stationary patrol motion',()=>{
  const guard=POP.residents.find(r=>r.id==='ealdholt-guard-serjeant')!,activity='Walks the rounds of the watch in the lanes.';
  const slot=guard.registry.routine.find(s=>s.activity===activity)!;
  const intent:VillageLifeIntent={residentId:guard.id,targetPlaceId:slot.placeId,activityKey:'patrol',activity,priority:60,
    issuedAbsoluteMinute:600,indoor:false,companionIds:[],reason:'routine'};
  const paused=state(guard,activity,{pausingAtDestination:true,lifeStatus:'active',lifeIntent:intent,workPoseQualified:false,
    navigationStatus:'at-threshold',navigationReason:null,arrivalEvidence:'certified-route-arrival',arrivedAtAbsoluteMinute:602});
  const before=JSON.stringify(paused),presentation=resolvePopulationPresentation(paused);
  assert.deepEqual(presentation,{motion:'idle',activity:{},presentable:true,reason:null,pausingAtDestination:true});
  assert.equal(displayPopulationActivity(paused),'Pauses on the route.');
  assert.equal(displayPopulationActivity(paused,{residentId:guard.id,scheduledPlaceId:slot.placeId,activity}),'Pauses on the route.');
  for(const patch of [
    {pausingAtDestination:undefined},{moving:true},{status:'blocked' as const},{navigationStatus:'waiting'},
    {navigationReason:'source-site-changed'},{lifeStatus:'queued' as const},{workPoseQualified:true},
    {arrivalEvidence:'initial-placement' as const},{arrivedAtAbsoluteMinute:null},{placeId:guard.homePlaceId},
    {lifeIntent:{...intent,activityKey:'work' as const}},{lifeIntent:{...intent,reason:'safety' as const}},
    {lifeIntent:{...intent,residentId:'someone-else'}},{lifeIntent:{...intent,targetPlaceId:guard.homePlaceId}},
    {lifeIntent:{...intent,issuedAbsoluteMinute:603}},
    {patrol:{planId:'physical-patrol',phase:'dwelling' as const,completedLegs:1,waypointPlaceId:slot.placeId}},
  ])assert.notEqual(resolvePopulationPresentation({...paused,...patch}).motion,'idle',JSON.stringify(patch));
  assert.equal(displayPopulationActivity({...paused,pausingAtDestination:undefined}),activity);
  assert.equal(displayPopulationActivity(paused,{residentId:guard.id,scheduledPlaceId:slot.placeId,activity:'Shelters from danger.',alarm:true}),'Shelters from danger.');
  assert.equal(displayPopulationActivity(paused,{residentId:guard.id,scheduledPlaceId:slot.placeId,activity:'Travels away.',away:true}),'Travels away.');
  const work='Drills recruits and spearmen.';
  assert.equal(resolvePopulationPresentation({...state(guard,work),...paused,activity:work,lifeIntent:{...intent,activity:work}}).presentable,false,'an unavailable occupation cannot borrow the pause');
  assert.equal(JSON.stringify(paused),before,'sampled presentation leaves the canonical patrol intention untouched');
});

test('all 1,164 routine slots have an explicit authored binding or an explicit held reason', () => {
  let slots = 0, shown = 0, held = 0;
  for (const r of POP.residents) for (const slot of r.registry.routine) {
    slots++; const set = getHouseholdArtSet(r.id);
    assert.ok(set ? set.activityPresentation[slot.activity]
      : POPULATION_ACTIVITY_ROLE_OVERRIDES[r.registry.role.id]?.[slot.activity] ?? POPULATION_ACTIVITY_PRESENTATION[slot.activity],
    `${r.id}: ${slot.activity} must be authored, including unsupported activities`);
    const p = resolvePopulationPresentation(state(r, slot.activity));
    if (!p.presentable) {
      held++; assert.equal(p.motion, null); assert.ok(p.reason); assert.equal(p.activity.roleClip, undefined);
      assert.notEqual(p.reason, 'activity-unmapped'); assert.notEqual(p.reason, 'household-activity-unmapped'); continue;
    }
    shown++; assert.notEqual(p.motion, null); assert.equal(p.reason, null); const art = getPopulationArt(r.id)!;
    if (set) {
      const binding = set.activityPresentation[slot.activity];
      if (binding.kind === 'work') assert.equal(p.motion, 'work');
      assert.notEqual(binding.kind, 'unpresentable'); assert.notEqual(binding.kind, 'indoors');
    } else if (p.activity.roleClip) {
      const clip = p.activity.roleClip;
      assert.ok(r.appearance.motion.roleClips.includes(clip) && art.motions.roleClips.includes(clip));
      assert.ok(libraries.get(r.appearance.archetype)!.has(clip), `${r.id}: actual GLB contains ${clip}`);
      assert.equal(getPopulationClip(clip)?.loop, true); assert.equal(isWalkLikeClip(clip), false);
      assert.equal(p.motion, 'work', 'Role work never becomes idle/talk');
    } else {
      assert.ok(p.motion === 'talk' || p.motion === 'sit');
      assert.ok(libraries.get(r.appearance.archetype)!.has(p.motion === 'talk' ? art.motions.talk : 'sit'));
    }
  }
  assert.equal(slots, 1164); assert.ok(shown > 100 && held > 100);
});
test('all 100 residents travel with a published walk; carries are explicit owned role plans', () => {
  for (const r of POP.residents) {
    const p = resolvePopulationPresentation(state(r, r.registry.routine[0].activity, { moving: true, status: 'travelling' }));
    assert.equal(p.presentable, true); assert.equal(p.motion, 'walk'); const set = getHouseholdArtSet(r.id), art = getPopulationArt(r.id)!;
    const clips = set ? actualClips(`${householdArtFolder(set)}/${householdArtFile(set, 'desktop-lod1')}`) : libraries.get(r.appearance.archetype)!;
    assert.ok(clips.has(set?.actorMotions.walk ?? art.motions.walk));
  }
  const activity = 'Carries grain sacks into the mill.', r = residentFor(activity, 'carry_sack_walk');
  const moving = resolvePopulationPresentation(state(r, activity, { moving: true, status: 'travelling' }));
  assert.equal(moving.motion, 'walk'); assert.equal(moving.activity.roleClip, 'carry_sack_walk');
  const art = getPopulationArt(r.id)!, meta = parseCrowdResidentMeta(JSON.parse(fs.readFileSync(new URL(art.manifest, ROOT), 'utf8')));
  const plan = planCrowdClips(meta, libraries.get(r.appearance.archetype)!, moving.activity);
  assert.equal(plan.unpresentable, null); assert.equal(plan.clips.walk, 'carry_sack_walk'); assert.equal(plan.walkIsOverlay, true);
  const stopped = resolvePopulationPresentation(state(r, activity));
  assert.equal(stopped.presentable, false); assert.equal(stopped.reason, 'locomotion-requires-moving-state');
});

test('an actual needs-generated rest intent keeps its ordinary gait while the measured journey is still travelling', () => {
  const r = POP.residents.find(resident => resident.id === 'ealdholt-thatcher')!;
  const initial = createVillageLife(POP, 1040, 'generated-rest-gait');
  const life = advanceVillageLife(initial, POP, 1041, { conditionsAt: () => ({ weather: 'clear', daylight: 1, careNeededResidentIds: [r.id] }) });
  const intent = life.residents.find(resident => resident.residentId === r.id)!.intent;
  assert.equal(intent.activityKey, 'rest'); assert.equal(intent.activity, 'Rests indoors.');
  assert.equal(r.registry.routine.some(slot => slot.activity === intent.activity), false);
  const travelling = state(r, intent.activity, { scheduledPlaceId: intent.targetPlaceId, status: 'travelling', moving: true,
    navigationStatus: 'travelling', navigationReason: null, lifeIntent: intent, workPoseQualified: false });
  assert.deepEqual(resolvePopulationPresentation(travelling), { motion: 'walk', activity: {}, presentable: true, reason: null });
  assert.equal(resolvePopulationPresentation({ ...travelling, moving: false, status: 'at-place', navigationStatus: 'at-threshold' }).presentable, false);
});

test('generated shelter/care/visit travel selects no action substitute and needs coherent source-journey fields', () => {
  for (const r of [POP.residents.find(person => person.id === 'ealdholt-thatcher')!, POP.residents.find(person => person.id === 'ealdholt-village-smith')!]) {
    for (const [activityKey, reason, activity] of [['shelter', 'weather', 'Shelters indoors.'], ['care', 'family-care', 'Cares for a relative or household neighbour.'], ['visit', 'family-visit', 'Visits an older relative.']] as const) {
      const intent: VillageLifeIntent = { residentId: r.id, activityKey, targetPlaceId: r.homePlaceId, activity, priority: 70,
        issuedAbsoluteMinute: 600, indoor: true, companionIds: [], reason };
      const travel = state(r, activity, { scheduledPlaceId: intent.targetPlaceId, status: 'travelling', moving: true,
        navigationStatus: 'travelling', navigationReason: null, lifeIntent: intent, workPoseQualified: false });
      const shown = resolvePopulationPresentation(travel); assert.equal(shown.motion, 'walk'); assert.deepEqual(shown.activity, {});
      for (const patch of [
        { moving: false, status: 'at-place' as const }, { presentable: false }, { status: 'blocked' as const },
        { navigationStatus: undefined }, { navigationStatus: 'waiting' }, { navigationReason: 'corridor-reserved' },
        { lifeIntent: undefined }, { activity: 'Unrelated unsupported activity.' },
        { lifeIntent: { ...intent, residentId: 'unknown' } }, { lifeIntent: { ...intent, targetPlaceId: 'unmapped-place' } },
        { lifeIntent: { ...intent, reason: 'routine' as const } }, { lifeIntent: { ...intent, indoor: false } },
      ]) assert.equal(resolvePopulationPresentation({ ...travel, ...patch }).presentable, false);
    }
  }
});

test('actual family-meal and reported household-protection journeys walk without inventing their destination performance', () => {
  const initial = createVillageLife(POP, 719, 'generated-meal-gait');
  const meal = advanceVillageLife(initial, POP, 720).residents.find(row => row.intent.activityKey === 'meal')!;
  assert.ok(meal); assert.equal(meal.intent.reason, 'family-meal');
  const person = POP.residents.find(row => row.id === meal.residentId)!;
  const movingMeal = state(person, meal.intent.activity, { scheduledPlaceId: meal.intent.targetPlaceId, status: 'travelling', moving: true,
    navigationStatus: 'travelling', navigationReason: null, lifeIntent: meal.intent, workPoseQualified: false });
  assert.deepEqual(resolvePopulationPresentation(movingMeal), { motion: 'walk', activity: {}, presentable: true, reason: null });

  const smith = POP.residents.find(row => row.id === 'ealdholt-village-smith')!, child = POP.residents.find(row => row.id === 'ealdholt-smithy-child')!;
  const alarm: ResidentSafetySignal = { id: 'presenter-household-fire', kind: 'fire', channel: 'report', knownByResidentIds: [smith.id],
    placeId: 'village-well', observedAbsoluteMinute: 601, expiresAbsoluteMinute: 620, affectedResidentIds: [child.id], shelterPlaceId: smith.homePlaceId };
  const threatened = advanceVillageLife(createVillageLife(POP, 600, 'generated-protection-gait'), POP, 601, { safetySignalsAt: () => [alarm] });
  const protectedIntent = threatened.residents.find(row => row.residentId === smith.id)!.intent;
  assert.equal(protectedIntent.activityKey, 'protect'); assert.equal(protectedIntent.reason, 'safety');
  const protecting = state(smith, protectedIntent.activity, { scheduledPlaceId: protectedIntent.targetPlaceId, status: 'travelling', moving: true,
    navigationStatus: 'travelling', navigationReason: null, lifeIntent: protectedIntent, workPoseQualified: false });
  assert.deepEqual(resolvePopulationPresentation(protecting), { motion: 'walk', activity: {}, presentable: true, reason: null });
  assert.equal(resolvePopulationPresentation({ ...protecting, moving: false, status: 'at-place', navigationStatus: 'at-threshold' }).presentable, false);
});

test('incident-watch travel uses ordinary gait but an authored armed patrol never receives that fallback', () => {
  const guard = POP.residents.find(person => person.id === 'ealdholt-guard-serjeant')!;
  const report: ResidentSafetySignal = { id: 'presenter-incident-watch', kind: 'violence', channel: 'report', knownByResidentIds: [guard.id],
    placeId: 'village-well', observedAbsoluteMinute: 601, expiresAbsoluteMinute: 620, affectedResidentIds: [] };
  const life = advanceVillageLife(createVillageLife(POP, 600, 'generated-watch-gait'), POP, 601, { safetySignalsAt: () => [report] });
  const intent = life.residents.find(row => row.residentId === guard.id)!.intent;
  assert.equal(intent.activityKey, 'patrol'); assert.equal(intent.reason, 'safety'); assert.equal(intent.indoor, false);
  const travel = state(guard, intent.activity, { scheduledPlaceId: intent.targetPlaceId, status: 'travelling', moving: true,
    navigationStatus: 'travelling', navigationReason: null, lifeIntent: intent, workPoseQualified: false });
  assert.deepEqual(resolvePopulationPresentation(travel), { motion: 'walk', activity: {}, presentable: true, reason: null });
  const patrolSlot = guard.registry.routine.find(slot => resolvePopulationPresentation(state(guard, slot.activity, { status: 'travelling', moving: true })).activity.roleClip === 'guard_patrol_walk')!;
  assert.ok(patrolSlot);
  const armedPatrol = resolvePopulationPresentation(state(guard, patrolSlot.activity, { status: 'travelling', moving: true }));
  assert.equal(armedPatrol.activity.roleClip, 'guard_patrol_walk');
});

test('held diagnostics distinguish location/activity constraints from genuine motion evidence failures', () => {
  const r = POP.residents.find(person => person.id === 'ealdholt-thatcher')!;
  const sleeping = state(r, 'Asleep at home.', { presentable: false, status: 'unmapped', reason: 'activity-indoors', navigationStatus: 'indoors' });
  const generic = { presentable: false, reason: 'motion-presentation-held' };
  assert.equal(populationPresentationHeldReason(sleeping, resolvePopulationPresentation(sleeping), generic), 'activity-indoors');
  const waiting = { ...sleeping, status: 'blocked' as const, reason: 'navigation-unavailable' as const, navigationStatus: 'waiting', navigationReason: 'destination-reserved' };
  assert.equal(populationPresentationHeldReason(waiting, resolvePopulationPresentation(waiting), generic), 'destination-reserved');
  const apprentice = POP.residents.find(person => person.id === 'ealdholt-carpenter-apprentice')!;
  const arrived = state(apprentice, 'Runs errands for the master in the lanes.');
  assert.equal(populationPresentationHeldReason(arrived, resolvePopulationPresentation(arrived), generic), 'locomotion-requires-moving-state');
  const walking = state(r, 'Asleep at home.', { moving: true, status: 'travelling' }), presentation = resolvePopulationPresentation(walking);
  assert.equal(populationPresentationHeldReason(walking, presentation, { presentable: false, reason: 'motion-floor-unqualified:crowd:walk_c' }), 'motion-floor-unqualified:crowd:walk_c');
  assert.equal(populationPresentationHeldReason(walking, presentation, { presentable: true, reason: null }), null);
});
test('household work uses each existing set’s exact authored work and published embedded clip', () => {
  for (const set of HOUSEHOLD_ART_SETS) {
    const r = POP.residents.find(r => r.id === set.residentId)!;
    const activity = r.registry.routine.find(s => set.activityPresentation[s.activity].kind === 'work')!.activity;
    const p = resolvePopulationPresentation(state(r, activity)); assert.equal(p.motion, 'work'); assert.equal(p.presentable, true);
    for (const level of HOUSEHOLD_ART_LEVELS) {
      const clips = actualClips(`${householdArtFolder(set)}/${householdArtFile(set, level)}`);
      assert.ok(clips.has(set.actorMotions.work)); assert.ok(clips.has(set.actorMotions.walk));
    }
    const missing = r.registry.routine.find(s => set.activityPresentation[s.activity].kind === 'unpresentable')!;
    assert.equal(resolvePopulationPresentation(state(r, missing.activity)).presentable, false);
  }
});
test('missing or borrowed crowd role loops stay held rather than falling back to idle/talk', () => {
  const activity = 'Ploughs, hoes or sows the arable strips.', farmer = residentFor(activity, 'work_hoe');
  const good = resolvePopulationPresentation(state(farmer, activity)); assert.equal(good.presentable, true); assert.equal(good.motion, 'work');
  const absent = resolvePopulationPresentation(state(farmer, activity, { availableRoleClips: [] }));
  assert.equal(absent.presentable, false); assert.equal(absent.motion, null); assert.match(absent.reason!, /^role-clip-unavailable:/);
  const sweep = 'Clears and sweeps the workshop.', artisan = residentFor(sweep, 'work_plane');
  const borrowed = resolvePopulationPresentation(state(artisan, sweep, { availableRoleClips: ['work_sweep'] }));
  assert.equal(borrowed.presentable, false); assert.equal(borrowed.motion, null);
});
test('guard variants remain authentic loops; the one-shot challenge is not repeated as hours of work', () => {
  const activity = 'Stands the morning watch at the approach.';
  const guard = POP.residents.find(r => r.registry.routine.some(s => s.activity === activity)
    && r.appearance.motion.roleClips.some(c => c === 'guard_stand_watch_b' || c === 'guard_stand_watch_c' || c === 'guard_stand_watch_d'))!;
  assert.ok(guard); const p = resolvePopulationPresentation(state(guard, activity));
  assert.equal(p.presentable, true); assert.equal(p.motion, 'work'); assert.ok(guard.appearance.motion.roleClips.includes(p.activity.roleClip!));
  const challenge = 'Keeps the approach and questions travellers.', sentry = residentFor(challenge, 'guard_challenge');
  const held = resolvePopulationPresentation(state(sentry, challenge));
  assert.equal(held.presentable, false); assert.equal(held.reason, 'role-clip-is-not-a-sustained-loop');
});
test('the three shared doorstep activities use explicit role-specific seated work', () => {
  for (const [role, clip] of [['lame-craftsman', 'work_mend_seated'], ['failing-sight', 'work_card_wool'], ['convalescent', 'work_shell_peas']]) {
    const r = POP.residents.find(r => r.registry.role.id === role)!;
    const p = resolvePopulationPresentation(state(r, 'Seated work at the doorstep.'));
    assert.equal(p.presentable, true); assert.equal(p.motion, 'work'); assert.equal(p.activity.roleClip, clip); assert.equal(p.activity.seated, true);
  }
});
test('unmapped locations, invalid positions and unknown English labels cannot select work', () => {
  const r = residentFor('Ploughs, hoes or sows the arable strips.', 'work_hoe'), activity = r.registry.routine[2].activity;
  for (const patch of [
    { presentable: false }, { status: 'unmapped' as const, reason: 'site-unavailable' as const },
    { status: 'blocked' as const, reason: 'anchor-conflict' as const }, { position: null }, { position: [NaN, 0, 0] as const },
    { residentId: 'unknown-resident' }, { activity: 'Somehow hoeing and forging while greeting people.' },
  ]) {
    const p = resolvePopulationPresentation(state(r, activity, patch)); assert.equal(p.presentable, false); assert.equal(p.motion, null); assert.ok(p.reason);
  }
  assert.ok(Object.isFrozen(POPULATION_ACTIVITY_PRESENTATION));
  assert.ok(Object.isFrozen(POPULATION_ACTIVITY_PRESENTATION['Ploughs, hoes or sows the arable strips.']));
});

test('an abstract endpoint never qualifies equipment work by supplying a neutral facing',()=>{
 let checked=0;
 for(const resident of POP.residents)for(const slot of resident.registry.routine){
  const strict=state(resident,slot.activity),normal=resolvePopulationPresentation(strict);
  if(!normal.presentable||normal.motion!=='work'||normal.activity.roleClip&&!normal.activity.roleClip.startsWith('work_'))continue;
  const abstract={...strict,workPoseQualified:false as const};
  const held=resolvePopulationPresentation(abstract);assert.equal(held.presentable,false);assert.equal(held.reason,'workplace-orientation-unqualified');checked++;
 }
 assert.ok(checked>30,'actual household and crowd equipment plans exercise the orientation guard');
});

test('source-qualified returned carrier remains neutral and cannot start an unmeasured selling or stirring animation',()=>{
 const r=POP.residents.find(r=>r.id==='ealdholt-brewster')!,activity=r.registry.routine.find(slot=>slot.placeId===r.workPlaceId)!.activity;
 const neutral=state(r,activity,{navigationStatus:'at-threshold',navigationReason:'neutral-return-clearance-required',arrivalEvidence:'certified-route-arrival',neutralReturnMotion:{id:'source-return',certificateSha256:'a'.repeat(64),anchorId:'original-courtyard',placeId:'village-courtyard',neutralClips:['idle_a','walk_b','start','stop'],zeroCrossfade:true}});
 const plan=resolvePopulationPresentation(neutral);assert.equal(plan.motion,'idle');assert.ok(!plan.activity.roleClip);assert.equal(plan.fadeSeconds,0);
 assert.equal(resolvePopulationPresentation({...neutral,moving:true}).motion,null);assert.equal(resolvePopulationPresentation({...neutral,arrivalEvidence:'initial-placement'}).motion,null);
});

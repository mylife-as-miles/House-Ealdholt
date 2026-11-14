import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { EALDHOLT_POPULATION_ASSET_SHA256 as HASHES } from './population-asset-integrity';
import { EALDHOLT_VILLAGE_POPULATION as POP, type PopulationResident } from './village-population';
import { getPopulationArt } from './village-population-art';
import { getHouseholdArtSet } from './household-art-sets';
import { resolvePopulationPresentation, type PopulationPresentation } from './village-activity-presentation';
import { parsePopulationMotionEvidence, qualifyPopulationMotion, type PopulationMotionClipEvidence } from './population-motion-clearance';
import type { VillagePopulationResidentState } from './village-population-runtime';
import type { VillageSiteLayout } from './village-site';
import { createVillageLife, advanceVillageLife } from './village-life';

const BOUND: PopulationMotionClipEvidence = { radiusMetres: .45, heightMetres: 1.8, minimumBodyYMetres: -.02, placedBelowGround: false };
const ROOT = new URL('../../../../main game/public/assets/legacy/environment/aethelgard/characters/crowd-v1/clips/', import.meta.url);
const actualLibraryClips = new Map(POP.clipLibraries.map(library => {
  const bytes = fs.readFileSync(new URL(library.file, ROOT)); assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), HASHES[`crowd-v1/clips/${library.file}`]);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  return [library.archetype, (json.animations as { name: string }[]).map(row => row.name)] as const;
}));
const site = (profile: 'desktop' | 'quest' = 'desktop'): VillageSiteLayout => ({ profile, sourceSha256: 'a'.repeat(64),
  frame: 'source-root-local-metres', capsule: { height: 2.1, radius: .6 }, anchors: [], routes: [], placeBindings: [], residentPlaceBindings: [] });
function state(resident: PopulationResident, activity = resident.registry.routine[0].activity,
  patch: Partial<VillagePopulationResidentState> = {}): VillagePopulationResidentState {
  const slotIndex = resident.registry.routine.findIndex(slot => slot.activity === activity), slot = resident.registry.routine[slotIndex];
  return { residentId: resident.id, tier: resident.fidelityTier, activity, roleClip: null, availableRoleClips: resident.appearance.motion.roleClips,
    scheduledPlaceId: slot.placeId, placeId: slot.placeId, fromPlaceId: resident.homePlaceId, slotIndex,
    slotStartMinute: slot.startMinute, slotEndMinute: slot.endMinute, status: 'at-place', reason: null,
    position: [0, 0, 0], yawRadians: 0, moving: false, presentable: true, ...patch };
}
function crowd(motion: 'work' | 'talk' | 'sit' | 'walk', carry = false, workTransitions = false): { state: VillagePopulationResidentState; presentation: PopulationPresentation } {
  for (const resident of POP.residents.filter(row => row.appearance.kind === 'crowd')) for (const slot of resident.registry.routine) {
    const s = state(resident, slot.activity, motion === 'walk' ? { moving: true, status: 'travelling' } : {}), p = resolvePopulationPresentation(s);
    const library = actualLibraryClips.get(resident.appearance.archetype)!;
    if (p.presentable && p.motion === motion && (motion !== 'walk' || !!p.activity.roleClip === carry)
      && (!workTransitions || library.includes(`${p.activity.roleClip}_enter`) && library.includes(`${p.activity.roleClip}_exit`))) return { state: s, presentation: p };
  }
  throw Error(`No published fixture for ${motion}/${carry}.`);
}
function household(motion: 'work' | 'walk') {
  const resident = POP.residents.find(row => row.appearance.kind === 'existing-set')!, set = getHouseholdArtSet(resident.id)!;
  const activity = motion === 'work' ? resident.registry.routine.find(slot => set.activityPresentation[slot.activity].kind === 'work')!.activity
    : resident.registry.routine[0].activity;
  const s = state(resident, activity, motion === 'walk' ? { moving: true, status: 'travelling' } : {}), p = resolvePopulationPresentation(s);
  assert.equal(p.motion, motion); return { state: s, presentation: p };
}
function rawProof(s: VillagePopulationResidentState): any {
  const art = getPopulationArt(s.residentId)!, set = getHouseholdArtSet(s.residentId);
  const names = set ? [...new Set([set.actorMotions.idle, set.actorMotions.walk, set.actorMotions.talk, set.actorMotions.work,
    ...Object.values(set.actorMotions.extra), ...(set.actorMotions.sit ? [set.actorMotions.sit] : [])])]
    : actualLibraryClips.get(art.archetype)!;
  const levels = Object.fromEntries(art.levels.map(level => [level.level, { files: { ...HASHES },
    clips: Object.fromEntries(names.map(name => [name, { ...BOUND }])) }]));
  return { schemaVersion: 1, method: 'cpu-sampled-skin-and-props-v1', fps: 60, paddingMetres: .05, residents: { [s.residentId]: { levels } } };
}
function level(raw: any, s: VillagePopulationResidentState, name = 'crowd'): any { return raw.residents[s.residentId].levels[name]; }
function qualify(s: VillagePopulationResidentState, raw: unknown, p = resolvePopulationPresentation(s), profile: 'desktop' | 'quest' = 'desktop') {
  return qualifyPopulationMotion(s, p, site(profile), parsePopulationMotionEvidence(raw), profile);
}

test('an explicit resource wait measures only its genuine idle, with the same source and floor gates',()=>{
  for(const original of [crowd('work').state,household('work').state]){
    const intent={residentId:original.residentId,targetPlaceId:original.scheduledPlaceId,activityKey:'work' as const,
      activity:original.activity,priority:40,issuedAbsoluteMinute:540,indoor:false,companionIds:[],reason:'routine' as const};
    const s={...original,waitingForResource:true as const,lifeStatus:'queued' as const,lifeIntent:intent,
      navigationStatus:'at-threshold',navigationReason:null,reason:'life-resource-unavailable' as const,workPoseQualified:false};
    const p=resolvePopulationPresentation(s),raw=rawProof(s),art=getPopulationArt(s.residentId)!,set=getHouseholdArtSet(s.residentId);
    assert.equal(p.motion,'idle');assert.equal(p.waitingForResource,true);assert.deepEqual(p.activity,{});
    const idle=set?.actorMotions.idle??art.motions.idle;
    for(const level of Object.values(raw.residents[s.residentId].levels) as any[])level.clips={[idle]:{...BOUND}};
    assert.equal(qualify(s,raw,p).presentable,true,'no unpublished work or transition is asserted by waiting');
    assert.equal(qualifyPopulationMotion(s,p,site(),null,'desktop').reason,'motion-evidence-unavailable');
    assert.equal(qualify(s,raw,{...p,waitingForResource:undefined}).reason,'motion-presentation-mismatch');
    const absent=JSON.parse(JSON.stringify(raw));
    for(const level of Object.values(absent.residents[s.residentId].levels) as any[])delete level.clips[idle];
    assert.match(qualify(s,absent,p).reason!,/motion-clip-evidence-missing/);
    const unsafe=JSON.parse(JSON.stringify(raw));
    for(const level of Object.values(unsafe.residents[s.residentId].levels) as any[])level.clips[idle].radiusMetres=.61;
    assert.match(qualify(s,unsafe,p).reason!,/motion-proxy-budget-exceeded/);
  }
});

test('a qualified guard arrival uses its exact idle evidence and retains source, floor, file and marker checks',()=>{
  const guard=POP.residents.find(r=>r.id==='ealdholt-guard-serjeant')!,activity='Walks the rounds of the watch in the lanes.';
  const slot=guard.registry.routine.find(slot=>slot.activity===activity)!;
  const s=state(guard,activity,{pausingAtDestination:true,lifeStatus:'active',workPoseQualified:false,navigationStatus:'at-threshold',navigationReason:null,
    arrivalEvidence:'certified-route-arrival',arrivedAtAbsoluteMinute:602,lifeIntent:{residentId:guard.id,targetPlaceId:slot.placeId,
      activityKey:'patrol',activity,priority:60,issuedAbsoluteMinute:600,indoor:false,companionIds:[],reason:'routine'}});
  const p=resolvePopulationPresentation(s),raw=rawProof(s),idle=getPopulationArt(s.residentId)!.motions.idle;
  for(const level of Object.values(raw.residents[s.residentId].levels) as any[])level.clips={[idle]:{...BOUND}};
  assert.equal(p.motion,'idle');assert.equal(qualify(s,raw,p).presentable,true,'idle requires no armed-patrol or work clip');
  assert.equal(qualify(s,raw,{...p,pausingAtDestination:undefined}).reason,'motion-presentation-mismatch');
  assert.equal(qualifyPopulationMotion(s,p,site(),parsePopulationMotionEvidence(raw),'desktop',{profile:'desktop',sha256:'b'.repeat(64)}).reason,'motion-site-unavailable');
  for(const [field,value,reason]of [['radiusMetres',.61,'motion-proxy-budget-exceeded'],['heightMetres',2.2,'motion-proxy-budget-exceeded'],['minimumBodyYMetres',-.031,'motion-floor-unqualified'],['placedBelowGround',true,'motion-floor-unqualified']] as const){
    const unsafe=JSON.parse(JSON.stringify(raw));level(unsafe,s).clips[idle][field]=value;assert.match(qualify(s,unsafe,p).reason!,new RegExp(reason));
  }
  const absent=JSON.parse(JSON.stringify(raw));delete level(absent,s).clips[idle];assert.match(qualify(s,absent,p).reason!,/motion-clip-evidence-missing/);
  const missing=JSON.parse(JSON.stringify(raw));delete level(missing,s).files['crowd-v1/residents/ealdholt-guard-serjeant.glb'];assert.match(qualify(s,missing,p).reason!,/motion-source-evidence-missing/);
  const forged={...s,pausingAtDestination:undefined};assert.equal(qualify(forged,raw,p).reason,'motion-presentation-mismatch');
});

test('evidence is owned and deeply frozen; source mutation cannot change a qualified plan', () => {
  const { state: s, presentation: p } = crowd('walk'), raw = rawProof(s), parsed = parsePopulationMotionEvidence(raw);
  const art = getPopulationArt(s.residentId)!;
  level(raw, s).clips[art.motions.walk].radiusMetres = 9;
  assert.equal(parsed.residents[s.residentId].levels.crowd!.clips[art.motions.walk].radiusMetres, .45);
  assert.ok(Object.isFrozen(parsed.residents[s.residentId].levels.crowd!.clips[art.motions.walk]));
  assert.deepEqual(qualifyPopulationMotion(s, p, site(), parsed, 'desktop'), { presentable: true, reason: null });
});

test('needs-generated travel still requires the exact source, clip transitions and measured envelope', () => {
  const resident = POP.residents.find(person => person.id === 'ealdholt-thatcher')!;
  const life = advanceVillageLife(createVillageLife(POP, 1040, 'generated-rest-motion'), POP, 1041,
    { conditionsAt: () => ({ weather: 'clear', daylight: 1, careNeededResidentIds: [resident.id] }) });
  const intent = life.residents.find(person => person.residentId === resident.id)!.intent;
  const s = state(resident, resident.registry.routine[0].activity, { activity: intent.activity, scheduledPlaceId: intent.targetPlaceId, moving: true, status: 'travelling',
    navigationStatus: 'travelling', navigationReason: null, lifeIntent: intent, workPoseQualified: false });
  const p = resolvePopulationPresentation(s), raw = rawProof(s), art = getPopulationArt(resident.id)!;
  assert.equal(p.motion, 'walk'); assert.equal(qualify(s, raw, p).presentable, true);
  const absent = rawProof(s); delete level(absent, s).clips[`${art.motions.walk}_start`];
  assert.match(qualify(s, absent, p).reason!, /motion-clip-evidence-missing/);
  const oversized = rawProof(s); level(oversized, s).clips[art.motions.walk].heightMetres = 2.2;
  assert.match(qualify(s, oversized, p).reason!, /motion-proxy-budget-exceeded/);
  const belowGround = rawProof(s); level(belowGround, s).clips[art.motions.walk].minimumBodyYMetres = -.031;
  assert.match(qualify(s, belowGround, p).reason!, /motion-floor-unqualified/);
  assert.equal(qualifyPopulationMotion(s, p, site(), parsePopulationMotionEvidence(raw), 'desktop', { profile: 'desktop', sha256: 'b'.repeat(64) }).reason,
    'motion-site-unavailable');
});

test('all six pinned actual libraries include their transition/support clip proofs without inferred names', () => {
  for (const [archetype, names] of actualLibraryClips) {
    const resident = POP.residents.find(row => row.appearance.kind === 'crowd' && row.appearance.archetype === archetype)!;
    const parsed = parsePopulationMotionEvidence(rawProof(state(resident)));
    assert.deepEqual(Object.keys(parsed.residents[resident.id].levels.crowd!.clips).sort(), [...names].sort());
  }
});

test('parser rejects method drift, getters, unknown data, invalid bounds and mismatched raw-byte identities', () => {
  const { state: s } = crowd('walk');
  for (const patch of [{ schemaVersion: 2 }, { fps: 30 }, { paddingMetres: 0 }, { method: 'rest-pose-only' }, { extra: true }]) {
    assert.throws(() => parsePopulationMotionEvidence({ ...rawProof(s), ...patch }));
  }
  let read = false; const input = rawProof(s); Object.defineProperty(input, 'fps', { enumerable: true, get() { read = true; return 60; } });
  assert.throws(() => parsePopulationMotionEvidence(input)); assert.equal(read, false);
  const wrongHash = rawProof(s), path = Object.keys(HASHES)[0]; level(wrongHash, s).files[path] = '0'.repeat(64);
  assert.throws(() => parsePopulationMotionEvidence(wrongHash), /identity mismatch/);
  const foreignFile = rawProof(s); level(foreignFile, s).files['../other.glb'] = '0'.repeat(64);
  assert.throws(() => parsePopulationMotionEvidence(foreignFile), /identity mismatch/);
  const unknownResident = rawProof(s); unknownResident.residents.other = unknownResident.residents[s.residentId];
  assert.throws(() => parsePopulationMotionEvidence(unknownResident), /Unregistered/);
  const foreignLevel = rawProof(s); foreignLevel.residents[s.residentId].levels.quest = level(foreignLevel, s);
  assert.throws(() => parsePopulationMotionEvidence(foreignLevel), /Unregistered/);
  const badClip = rawProof(s); level(badClip, s).clips['made_up_clip'] = { ...BOUND };
  assert.throws(() => parsePopulationMotionEvidence(badClip), /Invalid motion-evidence clip/);
  const invalid = rawProof(s); level(invalid, s).clips[getPopulationArt(s.residentId)!.motions.walk].radiusMetres = NaN;
  assert.throws(() => parsePopulationMotionEvidence(invalid), /invalid measured bound/);
});

test('missing or unparsed evidence, missing residents and incomplete source identities are held', () => {
  const { state: s, presentation: p } = crowd('walk'), raw = rawProof(s);
  assert.equal(qualifyPopulationMotion(s, p, site(), null, 'desktop').presentable, false);
  assert.equal(qualifyPopulationMotion(s, p, site(), raw, 'desktop').presentable, false);
  const empty = { ...raw, residents: {} };
  assert.match(qualify(s, empty).reason!, /resident-evidence-missing/);
  const art = getPopulationArt(s.residentId)!, rootless = (path: string) => path.replace(/^aethelgard\/characters\//, '');
  const required = [rootless(art.levels[0].path), rootless(art.manifest), rootless(art.clipLibrary!.path), 'crowd-v1/clips/manifest.json',
    ...art.props.map(prop => rootless(prop.file)), ...Object.keys(HASHES).filter(path => /^crowd-v1\/props\/[^/]+\.glb$/.test(path)),
    'crowd-v1/props/kits.json'];
  for (const path of new Set(required)) {
    const partial = rawProof(s); delete level(partial, s).files[path];
    assert.match(qualify(s, partial).reason!, /source-evidence-missing/, path);
  }
});

test('resolved work needs its exact loop, and forged idle cannot replace unavailable work', () => {
  const { state: s, presentation: p } = crowd('work'), raw = rawProof(s), role = p.activity.roleClip!;
  assert.ok(role); assert.equal(qualify(s, raw).presentable, true);
  delete level(raw, s).clips[role];
  assert.match(qualify(s, raw).reason!, /clip-evidence-missing/);
  assert.equal(qualifyPopulationMotion(s, { ...p, motion: 'idle', activity: {} }, site(), parsePopulationMotionEvidence(raw), 'desktop').reason,
    'motion-presentation-mismatch');
});

test('carry uses the actual prop-bearing clip rather than a safe generic walk', () => {
  const { state: s, presentation: p } = crowd('walk', true), raw = rawProof(s), role = p.activity.roleClip!;
  assert.ok(role); assert.equal(qualify(s, raw).presentable, true);
  level(raw, s).clips[role].radiusMetres = .61;
  assert.match(qualify(s, raw).reason!, new RegExp(`proxy-budget-exceeded:crowd:${role}$`));
  const art = getPopulationArt(s.residentId)!; assert.equal(level(raw, s).clips[art.motions.walk].radiusMetres, .45);
  delete level(raw, s).clips[role]; assert.match(qualify(s, raw).reason!, /clip-evidence-missing/);
});

test('reachable work entry and exit, walk start/stop and seated transitions must each fit', () => {
  for (const motion of ['work', 'walk', 'sit'] as const) {
    const { state: s, presentation: p } = crowd(motion, false, motion === 'work'), art = getPopulationArt(s.residentId)!;
    const names = motion === 'work' ? [`${p.activity.roleClip}_enter`, `${p.activity.roleClip}_exit`]
      : motion === 'walk' ? [`${art.motions.walk}_start`, `${art.motions.walk}_stop`] : ['sit_down', 'stand_up'];
    for (const name of names) {
      const raw = rawProof(s); assert.ok(level(raw, s).clips[name], `${motion} publishes ${name}`);
      level(raw, s).clips[name].radiusMetres = .61;
      assert.match(qualify(s, raw).reason!, new RegExp(`proxy-budget-exceeded:crowd:${name}$`));
      delete level(raw, s).clips[name]; assert.match(qualify(s, raw).reason!, /clip-evidence-missing/);
    }
  }
});

test('body floor tolerance, placed-prop floor and vertical/radial proxy budgets are independent gates', () => {
  const { state: s } = crowd('walk'), name = getPopulationArt(s.residentId)!.motions.walk;
  for (const [field, value, expected] of [['minimumBodyYMetres', -.030001, 'floor-unqualified'], ['placedBelowGround', true, 'floor-unqualified'],
    ['heightMetres', 2.10001, 'proxy-budget-exceeded'], ['radiusMetres', .60001, 'proxy-budget-exceeded']] as const) {
    const raw = rawProof(s); level(raw, s).clips[name][field] = value; assert.match(qualify(s, raw).reason!, new RegExp(expected));
  }
  const boundary = rawProof(s); Object.assign(level(boundary, s).clips[name], { minimumBodyYMetres: -.03, heightMetres: 2.1, radiusMetres: .6 });
  assert.equal(qualify(s, boundary).presentable, true);
});

test('Desktop household gates both actual LODs; Quest independently gates its body and props files', () => {
  const { state: s } = household('walk'), raw = rawProof(s), set = getHouseholdArtSet(s.residentId)!;
  assert.equal(qualify(s, raw).presentable, true);
  level(raw, s, 'desktop-lod0').clips[set.actorMotions.walk].radiusMetres = .7;
  assert.match(qualify(s, raw).reason!, /proxy-budget-exceeded:desktop-lod0/);
  assert.equal(qualify(s, raw, resolvePopulationPresentation(s), 'quest').presentable, true);
  delete raw.residents[s.residentId].levels['desktop-lod0']; assert.match(qualify(s, raw).reason!, /level-evidence-missing:desktop-lod0/);
  const quest = rawProof(s), props = getPopulationArt(s.residentId)!.propsFiles!.quest.replace(/^aethelgard\/characters\//, '');
  delete level(quest, s, 'quest').files[props]; assert.match(qualify(s, quest, resolvePopulationPresentation(s), 'quest').reason!, /source-evidence-missing/);
});

test('unrelated oversized work/station clips do not suppress a safe household walk, but actual work remains held', () => {
  const walk = household('walk'), work = household('work'), raw = rawProof(walk.state), set = getHouseholdArtSet(walk.state.residentId)!;
  for (const levelName of ['desktop-lod0', 'desktop-lod1', 'quest']) {
    for (const clip of [set.actorMotions.work, set.workTransitions.enter, set.workTransitions.exit]) {
      level(raw, walk.state, levelName).clips[clip].radiusMetres = 2;
    }
  }
  assert.equal(qualify(walk.state, raw).presentable, true);
  assert.match(qualify(work.state, raw).reason!, /proxy-budget-exceeded/);
});

test('site/profile mismatches and held locations remain unavailable without fallback', () => {
  const { state: s, presentation: p } = crowd('talk'), evidence = parsePopulationMotionEvidence(rawProof(s));
  assert.equal(qualifyPopulationMotion(s, p, null, evidence, 'desktop').reason, 'motion-site-unavailable');
  assert.equal(qualifyPopulationMotion(s, p, site('quest'), evidence, 'desktop').reason, 'motion-site-unavailable');
  assert.equal(qualifyPopulationMotion({ ...s, presentable: false }, p, site(), evidence, 'desktop').reason, 'motion-presentation-held');
});

test('Desktop characters on the compact source require its exact identity and Desktop motion evidence', () => {
  const {state: s, presentation: p} = crowd('talk');
  const evidence = parsePopulationMotionEvidence(rawProof(s)), compact = site('quest');
  const source = {profile: 'quest' as const, sha256: compact.sourceSha256};
  assert.equal(qualifyPopulationMotion(s, p, compact, evidence, 'desktop', source).presentable, true);
  assert.equal(qualifyPopulationMotion(s, p, compact, evidence, 'desktop', {...source, sha256: 'b'.repeat(64)}).reason, 'motion-site-unavailable');
  assert.equal(qualifyPopulationMotion(s, p, compact, evidence, 'desktop', {...source, profile: 'desktop'}).reason, 'motion-site-unavailable');
  const body = household('walk'), raw = rawProof(body.state);
  delete raw.residents[body.state.residentId].levels['desktop-lod0'];
  assert.match(qualifyPopulationMotion(body.state, body.presentation, compact, parsePopulationMotionEvidence(raw), 'desktop', source).reason!, /motion-level-evidence-missing:desktop-lod0/);
  assert.equal(qualifyPopulationMotion({...s, presentable: false}, p, compact, evidence, 'desktop', source).reason, 'motion-presentation-held');
});

test('neutral return display metadata is separated from the exact source-reference parser',()=>{
 const r=POP.residents.find(r=>r.id==='ealdholt-brewster')!,s=state(r,undefined,{navigationStatus:'at-threshold',arrivalEvidence:'certified-route-arrival',neutralReturnMotion:{id:'unknown-source-return',certificateSha256:'a'.repeat(64),anchorId:'original-courtyard',placeId:'village-courtyard',neutralClips:['idle_a','walk_b','walk_b_start','walk_b_stop'],zeroCrossfade:true}});
 const p=resolvePopulationPresentation(s);assert.equal(p.motion,'idle');
 let result:ReturnType<typeof qualifyPopulationMotion>|undefined;assert.doesNotThrow(()=>{result=qualifyPopulationMotion(s,p,site(),null,'desktop');});
 assert.equal(result?.presentable,false);assert.equal(result?.reason,'neutral-return-motion-unqualified');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HOUSEHOLD_ART_LEVELS, HOUSEHOLD_ART_SETS, HOUSEHOLD_ART_SETS_STATUS, getHouseholdArtSet, householdArtFile, householdArtFolder,
  householdPropsFileFor, selectHouseholdArtLevels, selectHouseholdArtLevelsDetailed, HOUSEHOLD_LEVEL_DISTANCES,
  validateHouseholdArtSets, type HouseholdArtSet,
} from './household-art-sets';
import { EALDHOLT_HOUSEHOLD_CASTING } from './household-casting';

const clone = (): HouseholdArtSet[] => JSON.parse(JSON.stringify(HOUSEHOLD_ART_SETS));

test('published household art sets validate against the casting', () => {
  assert.equal(HOUSEHOLD_ART_SETS_STATUS, 'working-placeholder');
  assert.equal(validateHouseholdArtSets(), null);
  assert.ok(Object.isFrozen(HOUSEHOLD_ART_SETS) && Object.isFrozen(HOUSEHOLD_ART_SETS[0].actorMotions));
});

test('every household member has exactly one set and the smith keeps its compatibility ID', () => {
  const members = EALDHOLT_HOUSEHOLD_CASTING.registry.households[0].memberIds;
  assert.deepEqual([...HOUSEHOLD_ART_SETS.map(s => s.residentId)].sort(), [...members].sort());
  assert.equal(getHouseholdArtSet('ealdholt-village-smith')?.set, 'village-smith-v1');
  assert.equal(getHouseholdArtSet('nobody'), null);
});

test('file and folder names follow the published layout', () => {
  const elder = getHouseholdArtSet('ealdholt-smithy-elder')!;
  assert.deepEqual(HOUSEHOLD_ART_LEVELS.map(l => householdArtFile(elder, l)),
    ['smithy-elder-desktop-lod0.glb', 'smithy-elder-desktop-lod1.glb', 'smithy-elder-quest.glb']);
  assert.equal(householdArtFile(elder, 'props'), 'smithy-elder-props.glb');
  assert.equal(householdArtFile(elder, householdPropsFileFor('quest')), 'smithy-elder-props-quest.glb');
  assert.equal(householdPropsFileFor('desktop-lod1'), 'props');
  assert.equal(householdArtFolder(elder), 'aethelgard/characters/smithy-elder-v1');
});

test('roles read through distinct work clips at registered workplaces', () => {
  const work = HOUSEHOLD_ART_SETS.map(s => s.actorMotions.work);
  assert.equal(new Set(work).size, work.length);
  for (const set of HOUSEHOLD_ART_SETS) assert.match(set.actorMotions.work, /^work_/);
  assert.equal(getHouseholdArtSet('ealdholt-smithy-elder')!.actorMotions.sit, 'sit');
});

test('talking or idle clips cannot stand in for work or walking', () => {
  const sets = clone();
  sets[1] = { ...sets[1], actorMotions: { ...sets[1].actorMotions, work: 'talk' } };
  assert.match(validateHouseholdArtSets(sets) ?? '', /cannot stand in for work/);
  const walking = clone();
  walking[2] = { ...walking[2], actorMotions: { ...walking[2].actorMotions, walk: 'idle' } };
  assert.match(validateHouseholdArtSets(walking) ?? '', /cannot stand in for walking/);
});

test('work places must be in the resident routine and props must be prop nodes', () => {
  const place = clone();
  place[2] = { ...place[2], workPlaceId: 'churchyard-bell' };
  assert.match(validateHouseholdArtSets(place) ?? '', /not in the resident's routine/);
  const prop = clone();
  prop[0] = { ...prop[0], propsByClip: { work_hammer: [{ node: 'hammer', bone: 'hand_r' }] } };
  assert.match(validateHouseholdArtSets(prop) ?? '', /is not a prop/);
});

test('missing, duplicated and miscalibrated sets are rejected', () => {
  assert.match(validateHouseholdArtSets(clone().slice(1)) ?? '', /exactly one art set/);
  const dup = clone();
  dup[3] = { ...dup[3], residentId: dup[2].residentId };
  assert.match(validateHouseholdArtSets(dup) ?? '', /more than one art set/);
  const face = clone();
  face[1] = { ...face[1], faceCalibration: { ...face[1].faceCalibration, upperLidClosed: -0.2 } };
  assert.match(validateHouseholdArtSets(face) ?? '', /Lid closure/);
});

test('level selection fills levels by conversation and distance up to the budgeted counts', () => {
  const req = (id: string, d: number, talk = false, current: any = null) => ({ residentId: id, distanceMetres: d, inConversation: talk, current });
  const desk = selectHouseholdArtLevels([req('a', 2), req('b', 3), req('c', 3.5), req('d', 30), req('e', 10, true)], 'desktop');
  // two close residents at most: the one in conversation first, then the nearest
  assert.equal(desk.e, 'desktop-lod0');
  assert.equal(desk.a, 'desktop-lod0');
  assert.equal(desk.b, 'desktop-lod1');
  assert.equal(desk.c, 'desktop-lod1');
  assert.equal(desk.d, null);
  // over capacity a resident is demoted to the cheapest built level and flagged, never dropped (round 2)
  const many = selectHouseholdArtLevelsDetailed(Array.from({ length: 12 }, (_, i) => req(`r${String(i).padStart(2, '0')}`, 5 + i)), 'desktop');
  assert.equal(Object.values(many.levels).filter(l => l === 'desktop-lod1').length, 12);
  assert.deepEqual(many.overCapacity, ['r08', 'r09', 'r10', 'r11']);
  const quest = selectHouseholdArtLevelsDetailed(Array.from({ length: 6 }, (_, i) => req(`q${i}`, 1 + i)), 'quest');
  assert.equal(Object.values(quest.levels).filter(l => l === 'quest').length, 6);
  assert.deepEqual(quest.overCapacity, ['q4', 'q5']);
  assert.equal(selectHouseholdArtLevels([req('far', 40)], 'quest').far, null);
});

test('no resident inside the last built level\'s enter distance is ever dropped, at any crowd size', () => {
  const req = (id: string, d: number, talk = false) => ({ residentId: id, distanceMetres: d, inConversation: talk, current: null });
  for (const platform of ['desktop', 'quest'] as const) {
    const last = platform === 'quest' ? HOUSEHOLD_LEVEL_DISTANCES.quest : HOUSEHOLD_LEVEL_DISTANCES['desktop-lod1'];
    for (const count of [1, 5, 12, 20]) {
      const crowd = Array.from({ length: count }, (_, i) => req(`p${String(i).padStart(2, '0')}`, ((i * 7) % 97) / 97 * (last.enter - 0.01), i % 5 === 0));
      const pick = selectHouseholdArtLevels(crowd, platform);
      for (const r of crowd) assert.notEqual(pick[r.residentId], null, `${platform} ${count}: ${r.residentId} at ${r.distanceMetres.toFixed(2)} m`);
    }
  }
});

test('level selection keeps a level until its exit distance (hysteresis) and is deterministic', () => {
  const lod0 = HOUSEHOLD_LEVEL_DISTANCES['desktop-lod0'];
  const d = (lod0.enter + lod0.exit) / 2;
  const kept = selectHouseholdArtLevels([{ residentId: 'a', distanceMetres: d, inConversation: false, current: 'desktop-lod0' }], 'desktop');
  const fresh = selectHouseholdArtLevels([{ residentId: 'a', distanceMetres: d, inConversation: false, current: 'desktop-lod1' }], 'desktop');
  assert.equal(kept.a, 'desktop-lod0');
  assert.equal(fresh.a, 'desktop-lod1');
  const input = [{ residentId: 'x', distanceMetres: 3, inConversation: false, current: null }, { residentId: 'w', distanceMetres: 3, inConversation: false, current: null },
    { residentId: 'v', distanceMetres: 3, inConversation: false, current: null }];
  assert.deepEqual(selectHouseholdArtLevels(input, 'desktop'), selectHouseholdArtLevels([...input].reverse(), 'desktop'));
  assert.equal(selectHouseholdArtLevels(input, 'desktop').x, 'desktop-lod1');  // ties break on ID: v and w take the two close slots
});

test('every routine slot of every resident is presented honestly: work, a genuine clip, indoors or unpresentable', () => {
  const kinds: Record<string, number> = {};
  for (const set of HOUSEHOLD_ART_SETS) {
    const resident = EALDHOLT_HOUSEHOLD_CASTING.registry.residents.find(r => r.id === set.residentId)!;
    for (const slot of resident.routine) {
      const pres = set.activityPresentation[slot.activity];
      assert.ok(pres, `${set.set}: "${slot.activity}" has no presentation`);
      kinds[pres.kind] = (kinds[pres.kind] ?? 0) + 1;
      if (pres.kind === 'work') assert.equal(slot.placeId, set.workPlaceId, `${set.set}: work shown away from the work place`);
      if (pres.kind === 'clip' && (pres.motion === 'idle' || pres.motion === 'talk')) assert.ok(pres.reason === 'conversation' || pres.reason === 'waiting');
      if (pres.kind === 'unpresentable') assert.ok(pres.planned.length > 0);
    }
  }
  // the role loops cover the forging, spinning, bellows and carving slots; the rest stay honest about what is missing
  assert.ok(kinds.work >= 6 && kinds.unpresentable >= 10, JSON.stringify(kinds));
  const smith = getHouseholdArtSet('ealdholt-village-smith')!;
  assert.equal(smith.activityPresentation['Heavy forging with hammer and tongs at the anvil.'].kind, 'work');
  assert.equal(smith.activityPresentation['Fetches water and trades news at the well.'].kind, 'unpresentable');
});

test('idle, talk or a seat cannot stand in for routine work, and every slot needs a presentation', () => {
  const missing = clone();
  const spinner = missing[1] as any;
  spinner.activityPresentation = { ...spinner.activityPresentation };
  delete spinner.activityPresentation['Tends the dye vat beside the house.'];
  assert.match(validateHouseholdArtSets(missing) ?? '', /has no presentation/);
  const standIn = clone();
  (standIn[2] as any).activityPresentation = { ...standIn[2].activityPresentation, 'Gathers kindling at the woodland edge.': { kind: 'clip', motion: 'idle', reason: 'travel' } };
  assert.match(validateHouseholdArtSets(standIn) ?? '', /cannot be shown with idle/);
  const away = clone();
  (away[0] as any).activityPresentation = { ...away[0].activityPresentation, 'Fetches water and trades news at the well.': { kind: 'work' } };
  assert.match(validateHouseholdArtSets(away) ?? '', /must happen at its work place/);
  const extra = clone();
  (extra[3] as any).activityPresentation = { ...extra[3].activityPresentation, 'Juggles at the fair.': { kind: 'indoors' } };
  assert.match(validateHouseholdArtSets(extra) ?? '', /not in the routine/);
});

test('work entry and exit hand every changing prop over exactly once each way, with a resting copy', () => {
  for (const set of HOUSEHOLD_ART_SETS) {
    const t = set.workTransitions;
    assert.equal(t.enter, 'work_enter'); assert.equal(t.exit, 'work_exit');
    assert.equal(set.workstation.node, 'workplace');
    for (const list of Object.values(t.swaps)) for (const sw of list) assert.ok(set.restingProps[sw.node], `${set.set} ${sw.node} has a rest`);
  }
  assert.equal(getHouseholdArtSet('ealdholt-smithy-elder')!.workTransitions.from, 'sit');
  const dropped = clone();
  (dropped[0] as any).workTransitions = { ...dropped[0].workTransitions, swaps: { work_enter: [dropped[0].workTransitions.swaps.work_enter[0]], work_exit: dropped[0].workTransitions.swaps.work_exit } };
  assert.match(validateHouseholdArtSets(dropped) ?? '', /must change over once/);
  const backwards = clone();
  (backwards[3] as any).workTransitions = { ...backwards[3].workTransitions, swaps: { ...backwards[3].workTransitions.swaps,
    work_enter: backwards[3].workTransitions.swaps.work_enter.map(s => s.node === 'prop_stick' ? { ...s, to: 'hand' } : s) } };
  assert.match(validateHouseholdArtSets(backwards) ?? '', /must change over once/);
  const noRest = clone();
  (noRest[1] as any).restingProps = { prop_spindle: noRest[1].restingProps.prop_spindle, prop_spindle_yarn: [] };
  assert.match(validateHouseholdArtSets(noRest) ?? '', /without a resting copy/);
  const floating = clone();
  (floating[0] as any).restingProps = { ...floating[0].restingProps, prop_hammer: [{ node: 'prop_hammer_rest', bone: 'hand_r' }] };
  assert.match(validateHouseholdArtSets(floating) ?? '', /must sit on the workstation or a girdle/);
  const noStation = clone();
  (noStation[2] as any).workstation = { node: 'anvil' };
  assert.match(validateHouseholdArtSets(noStation) ?? '', /workstation/);
});

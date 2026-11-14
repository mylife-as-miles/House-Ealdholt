import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  EALDHOLT_HOUSEHOLD_CASTING,
  HOUSEHOLD_CASTING_MEMBER_RANGE,
  HOUSEHOLD_CASTING_POLYHAVEN,
  HOUSEHOLD_CASTING_SOURCES,
  HOUSEHOLD_LOD_BUDGETS,
  INFLUENCE_SENSITIVITY_PRESENTATION,
  getHouseholdCastingProfile,
  validateHouseholdCasting,
  type HouseholdCasting,
} from './household-casting';
import {
  PEOPLE_LIFE_COMPATIBILITY_PERSON_IDS,
  createPeopleLifeRegistry,
  getPeopleLifeDecisionMemory,
  getPeopleLifeRoutine,
} from '../people-life';
import { createPeopleLifeEventsSnapshot } from '../people-life-events';
import { EALDHOLT_PEOPLE_DRAFT, createEaldholtDraftChoice } from '../people-draft';

const SMITH = 'ealdholt-village-smith', SPINNER = 'ealdholt-smithy-spinner', CHILD = 'ealdholt-smithy-child', ELDER = 'ealdholt-smithy-elder';
// Mutable JSON copy for negative cases; the exported casting stays frozen.
const copy = (): any => JSON.parse(JSON.stringify(EALDHOLT_HOUSEHOLD_CASTING));
const reject = (mutate: (c: any) => void, pattern?: RegExp) => {
  const c = copy(); mutate(c);
  const error = validateHouseholdCasting(c as HouseholdCasting);
  assert.ok(error, 'mutation should be rejected');
  if (pattern) assert.match(error!, pattern);
};
const profile = (c: any, id: string) => c.profiles.find((p: any) => p.residentId === id);
const resident = (c: any, id: string) => c.registry.residents.find((r: any) => r.id === id);

test('casting validates, stays frozen and is marked working-placeholder', () => {
  assert.equal(validateHouseholdCasting(EALDHOLT_HOUSEHOLD_CASTING), null);
  assert.equal(EALDHOLT_HOUSEHOLD_CASTING.status, 'working-placeholder');
  assert.equal(EALDHOLT_HOUSEHOLD_CASTING.houseStandingEffect, 'none');
  for (const value of [EALDHOLT_HOUSEHOLD_CASTING, EALDHOLT_HOUSEHOLD_CASTING.registry.residents[0].routine[0],
    EALDHOLT_HOUSEHOLD_CASTING.profiles[0].clothing[0], EALDHOLT_HOUSEHOLD_CASTING.eventModel.facts[0], HOUSEHOLD_CASTING_SOURCES[0], HOUSEHOLD_LOD_BUDGETS[0]])
    assert.ok(Object.isFrozen(value));
  assert.equal(validateHouseholdCasting(EALDHOLT_HOUSEHOLD_CASTING), validateHouseholdCasting(copy()), 'deterministic on a plain copy');
});

test('registry is accepted by the people-life kernel and routines project the planned day', () => {
  const made = createPeopleLifeRegistry(copy().registry);
  assert.ok(made.ok);
  const at = (id: string, minute: number) => getPeopleLifeRoutine(made.registry, id, minute);
  assert.equal(at(SMITH, 800)?.placeId, 'smithy-forge');
  assert.deepEqual(at(CHILD, 620)?.companionIds, [SMITH]);
  assert.equal(at(SPINNER, 600)?.placeId, 'riverside-bank');
  assert.equal(at(ELDER, 1000)?.placeId, 'churchyard');
  for (const id of [SMITH, SPINNER, CHILD, ELDER]) {
    assert.equal(at(id, 740)?.placeId, 'smithy-house', 'shared midday meal');
    assert.equal(at(id, 100)?.placeId, 'smithy-house', 'everyone sleeps at home');
  }
});

test('the proposed event model is accepted without recording any occurrence', () => {
  const result = createPeopleLifeEventsSnapshot(EALDHOLT_HOUSEHOLD_CASTING.registry, EALDHOLT_HOUSEHOLD_CASTING.eventModel, { startedAt: 0, stepMilliseconds: 60000, seed: 7 });
  assert.ok(result.ok);
  assert.equal(result.snapshot.events.length, 0);
  assert.ok(result.snapshot.facts.every(f => f.value === false && f.eventId === null), 'no consequence is assumed to have happened');
});

test('one connected household with reciprocal family and social ties', () => {
  const { registry } = EALDHOLT_HOUSEHOLD_CASTING;
  assert.equal(registry.households.length, 1);
  const members = registry.households[0].memberIds;
  assert.ok(members.length >= HOUSEHOLD_CASTING_MEMBER_RANGE.min && members.length <= HOUSEHOLD_CASTING_MEMBER_RANGE.max);
  for (const r of registry.residents) {
    assert.equal(r.family.kind, 'local-kin');
    if (r.family.kind !== 'local-kin') continue;
    assert.deepEqual(r.family.ties.map(t => t.residentId).sort(), members.filter(m => m !== r.id).sort(), 'every member is kin to every other member');
    assert.deepEqual(r.socialTies.map(t => t.residentId).sort(), members.filter(m => m !== r.id).sort());
    assert.ok(r.role.id && r.role.purpose && r.homeHouseholdId === registry.households[0].id);
  }
  const smith = registry.residents.find(r => r.id === SMITH)!;
  assert.ok(smith.family.kind === 'local-kin' && smith.family.ties.some(t => t.residentId === ELDER && t.kind === 'parent'));
  assert.ok(registry.residents.some(r => r.influenceSensitivity === 'persistent') && registry.residents.some(r => r.influenceSensitivity === 'occasional'));
});

test('the smith keeps its compatibility ID and existing inherited decisions still read', () => {
  assert.ok(PEOPLE_LIFE_COMPATIBILITY_PERSON_IDS.includes(SMITH));
  const person = EALDHOLT_PEOPLE_DRAFT.find(p => p.id === SMITH)!;
  const presented = getHouseholdCastingProfile(EALDHOLT_HOUSEHOLD_CASTING, SMITH)!.decisionPresentations;
  assert.deepEqual(presented.map(d => d.optionId).sort(), person.decision.options.map(o => o.id).sort());
  const choice = createEaldholtDraftChoice(SMITH, person.decision.options[1].id, '2026-11-06T12:00:00.000Z');
  assert.ok(choice.ok);
  const memories = getPeopleLifeDecisionMemory(EALDHOLT_HOUSEHOLD_CASTING.registry, SMITH, { choices: [choice.choice] });
  assert.equal(memories?.length, 1);
  assert.equal(memories?.[0].optionId, person.decision.options[1].id);
  reject(c => { profile(c, SPINNER).decisionPresentations = [{ decisionId: person.decision.id, optionId: person.decision.options[0].id, presentation: 'Borrowed decision.' }]; }, /existing inherited decision/);
  reject(c => { profile(c, SMITH).decisionPresentations[0].optionId = 'invented-option'; }, /existing inherited decision/);
});

test('residents are individual: faces, hair, silhouettes, layered clothing and role items differ', () => {
  const profiles = EALDHOLT_HOUSEHOLD_CASTING.profiles;
  assert.equal(new Set(profiles.map(p => p.makehuman.faceTargets.map(t => t.target).sort().join())).size, profiles.length);
  assert.equal(new Set(profiles.map(p => p.hair.style)).size, profiles.length);
  assert.equal(new Set(profiles.map(p => p.makehuman.baseSkin + p.makehuman.eyeTexture)).size, profiles.length);
  assert.equal(new Set(profiles.map(p => p.equipment[0].item)).size, profiles.length, 'roles read through different tools');
  const child = getHouseholdCastingProfile(EALDHOLT_HOUSEHOLD_CASTING, CHILD)!;
  assert.ok(child.makehuman.ageYears < 16 && /not a scaled adult/.test(child.silhouette), 'child proportions, never a shrunken adult');
  reject(c => { profile(c, SPINNER).makehuman.faceTargets = profile(c, SMITH).makehuman.faceTargets; }, /individual/);
  reject(c => { profile(c, CHILD).hair.style = profile(c, ELDER).hair.style; profile(c, CHILD).hair.colour = profile(c, ELDER).hair.colour; }, /differ/);
  reject(c => { profile(c, ELDER).clothing = profile(c, ELDER).clothing.filter((l: any) => l.slot !== 'feet'); }, /layered clothing/);
  reject(c => { profile(c, SMITH).possessions = []; }, /possessions/);
  reject(c => { profile(c, SMITH).makehuman.ageYears = 25; }, /age band/);
});

test('motion plans use real walk, idle and work loops; talking or idle never substitutes', () => {
  for (const p of EALDHOLT_HOUSEHOLD_CASTING.profiles) {
    for (const kind of ['walk', 'idle', 'work']) assert.ok(p.motion.some(m => m.kind === kind), `${p.residentId} ${kind}`);
    for (const m of p.motion.filter(x => x.kind === 'work')) assert.ok(m.placeId && !/_ID$/.test(m.source));
  }
  reject(c => { profile(c, SPINNER).motion.find((m: any) => m.kind === 'work').source = '100style:Neutral_ID'; }, /cannot stand in/);
  reject(c => { const work = profile(c, SMITH).motion.find((m: any) => m.kind === 'work'); work.id = 'smith-talk-loop'; }, /cannot stand in/);
  reject(c => { profile(c, CHILD).motion.find((m: any) => m.kind === 'walk').source = '100style:Neutral_ID'; }, /walking/);
  reject(c => { profile(c, ELDER).motion = profile(c, ELDER).motion.filter((m: any) => m.kind !== 'work'); }, /work motion/);
  reject(c => { profile(c, SPINNER).motion.find((m: any) => m.kind === 'work').placeId = 'smithy-forge'; }, /routine/);
});

test('every source is verified at asset level; conditional sources need a fallback; forbidden sources fail', () => {
  for (const s of HOUSEHOLD_CASTING_SOURCES) {
    assert.ok(s.assetLevelEvidence.length > 20 && s.url.startsWith('http'));
    if (s.licence === 'CC-BY-4.0' || s.redistribution !== 'allowed') assert.ok(s.attribution, `${s.id} needs attribution text`);
  }
  assert.ok(HOUSEHOLD_CASTING_POLYHAVEN.every(a => a.authors.length > 0));
  const cmuMotions = EALDHOLT_HOUSEHOLD_CASTING.profiles.flatMap(p => p.motion).filter(m => m.source.startsWith('cmu:'));
  assert.ok(cmuMotions.length > 0 && cmuMotions.every(m => m.fallback === 'project-original:keyframe'));
  reject(c => { profile(c, SMITH).motion.find((m: any) => m.source.startsWith('cmu:')).fallback = null; }, /fallback/);
  reject(c => { profile(c, SMITH).equipment[0].source = 'polyhaven:not_listed_asset'; }, /Unlisted/);
  reject(c => { profile(c, SMITH).motion[0].source = 'mixamo:walking'; }, /Forbidden/);
  reject(c => { profile(c, ELDER).clothing[0].material = 'fab:linen'; }, /Forbidden/);
});

test('unseen-player and chess-only standing invariants hold', () => {
  const text = JSON.stringify(EALDHOLT_HOUSEHOLD_CASTING);
  assert.ok(!/\bplayer\b|\bavatar\b/i.test(text));
  for (const description of Object.values(INFLUENCE_SENSITIVITY_PRESENTATION)) assert.match(description, /no (gesture toward|knowledge of) any source/i);
  reject(c => { c.houseStandingEffect = 'raises'; }, /standing/);
  reject(c => { c.eventModel.facts.push({ id: 'smithy-house-standing-raised', subjectIds: [SMITH], initialValue: false, initiallyKnownTo: [] }); }, /standing/);
  reject(c => { resident(c, CHILD).identityNote = 'Working placeholder: senses the player behind events.'; }, /unseen player/);
  reject(c => { resident(c, SMITH).isPlayer = true; }, /Registry/);
  for (const p of EALDHOLT_HOUSEHOLD_CASTING.profiles) assert.ok(p.bannerPresentation.beforeBannerConfirmed.length > 0, 'banner colours are presentation only');
});

test('resident-facing text uses role labels only', () => {
  reject(c => { resident(c, SMITH).identityNote = 'Working placeholder: Aldric keeps the forge.'; }, /role labels/);
  reject(c => { resident(c, CHILD).family.ties[2].description = 'Grandparent on the Smith side.'; }, /role labels/);
  reject(c => { profile(c, ELDER).face.shape = 'Narrow face like Granny Weatherwax.'; }, /proper names/);
  reject(c => { c.status = 'approved'; }, /working-placeholder/);
});

test('one household is proven before expansion', () => {
  reject(c => {
    c.registry.places.push({ id: 'test-cottage', label: 'Test cottage' });
    c.registry.households.push({ id: 'test-household', label: 'Second household', homePlaceId: 'test-cottage', memberIds: ['test-neighbour'] });
    c.registry.residents.push({ id: 'test-neighbour', label: 'Neighbour', identityNote: 'Synthetic neighbour for validation.', influenceSensitivity: 'occasional',
      role: { id: 'test-role', label: 'Neighbour', purpose: 'Synthetic purpose.' }, homeHouseholdId: 'test-household',
      family: { kind: 'no-local-kin', explanation: 'Synthetic neighbour without local relatives.' }, socialTies: [{ residentId: SMITH, description: 'Synthetic tie.' }],
      routine: [{ startMinute: 0, endMinute: 1440, activity: 'At home.', placeId: 'test-cottage', companionIds: [] }], decisionMemory: { source: 'inherited-story-choices' } });
    resident(c, SMITH).socialTies.push({ residentId: 'test-neighbour', description: 'Synthetic tie back.' });
    c.profiles.push({ ...JSON.parse(JSON.stringify(profile(c, SMITH))), residentId: 'test-neighbour' });
  }, /exactly one connected household/);
  reject(c => { resident(c, SMITH).family.ties[0].kind = 'sibling'; }, /Registry/);
  reject(c => { c.profiles.pop(); }, /art profile/);
});

test('lasting consequences are tied to proposed facts and visible changes', () => {
  for (const p of EALDHOLT_HOUSEHOLD_CASTING.profiles) {
    assert.ok(p.consequences.length > 0 && p.consequences.every(c => c.visuals.length > 0));
    assert.ok(EALDHOLT_HOUSEHOLD_CASTING.eventModel.facts.some(f => f.subjectIds.includes(p.residentId)));
  }
  reject(c => { profile(c, SPINNER).consequences[0].factId = 'unknown-fact'; }, /not a proposed fact/);
  reject(c => { profile(c, SPINNER).consequences[1].basis = 'own-fact'; }, /subject/);
  reject(c => { profile(c, CHILD).consequences[0].visuals = []; }, /visible change/);
});

test('LOD plans stay within budgets for close-up, normal distance and Quest', () => {
  const budget = (id: string) => HOUSEHOLD_LOD_BUDGETS.find(b => b.id === id)!;
  assert.equal(budget('desktop-lod0').maxTriangles, 25000);
  assert.equal(budget('desktop-lod1').maxTriangles, 8000);
  // round 2: the Quest level carries the face morphs too (blink, visemes, expressions), within the same morph cap
  assert.ok(budget('quest-near').maxTriangles <= 6000 && budget('quest-near').maxMorphTargets <= budget('desktop-lod0').maxMorphTargets,
    'Quest faces stay inside the close-up morph cap');
  assert.ok(HOUSEHOLD_LOD_BUDGETS.reduce((n, b) => Math.max(n, b.maxSimultaneous), 0) >= 20, 'every resident can stay present at a cheap level');
  reject(c => { profile(c, SMITH).lods[0].triangles = 30000; }, /budget/);
  reject(c => { profile(c, CHILD).lods.find((l: any) => l.id === 'quest-near').morphTargets = 80; }, /budget/);
  reject(c => { profile(c, ELDER).lods = profile(c, ELDER).lods.filter((l: any) => l.id !== 'quest-near'); }, /Quest/);
});

test('external relationships stay unregistered proposals to the existing cast', () => {
  for (const rel of EALDHOLT_HOUSEHOLD_CASTING.externalRelationships) {
    assert.ok(PEOPLE_LIFE_COMPATIBILITY_PERSON_IDS.includes(rel.compatibilityPersonId));
    assert.ok(!EALDHOLT_HOUSEHOLD_CASTING.registry.residents.some(r => r.id === rel.compatibilityPersonId));
  }
  reject(c => { c.externalRelationships[0].compatibilityPersonId = CHILD; }, /unregistered existing cast/);
});

test('module source stays pure, deterministic and renderer free', () => {
  const source = fs.readFileSync(new URL('./household-casting.ts', import.meta.url), 'utf8');
  for (const banned of ['Date.now', 'new Date', 'Math.random', 'setTimeout', 'setInterval', "from 'three'", '@iwsdk/core', 'window.', 'document.', 'fetch(', 'localStorage'])
    assert.ok(!source.includes(banned), banned);
});

test('every profile\'s makehuman block matches its build recipe (no casting/recipe drift)', () => {
  const dir = new URL('../../../../scripts/characters/recipes/', import.meta.url);
  const recipes = new Map<string, any>();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const recipe = JSON.parse(fs.readFileSync(new URL(file, dir), 'utf8'));
    recipes.set(recipe.residentId, recipe);
  }
  for (const profile of EALDHOLT_HOUSEHOLD_CASTING.profiles) {
    const recipe = recipes.get(profile.residentId);
    assert.ok(recipe, `no build recipe for ${profile.residentId}`);
    const mh = profile.makehuman;
    for (const key of ['gender', 'ageYears', 'muscle', 'weight', 'height', 'proportions'] as const) {
      assert.equal(mh[key], recipe.macro[key], `${profile.residentId} ${key}`);
    }
    assert.deepEqual({ ...mh.macroShapeFamilies }, recipe.macro.macroShapeFamilies, `${profile.residentId} shape families`);
    assert.equal(mh.baseSkin, recipe.parts.skin, `${profile.residentId} base skin`);
    assert.equal(mh.eyeTexture, recipe.parts.eyeTexture, `${profile.residentId} eye texture`);
    for (const { target, weight } of mh.faceTargets) {
      assert.equal(recipe.detailTargets[target], weight, `${profile.residentId} ${target}`);
    }
  }
});

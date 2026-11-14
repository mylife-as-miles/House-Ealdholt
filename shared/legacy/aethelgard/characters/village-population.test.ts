import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CROWD_LEVEL_BUDGET,
  EALDHOLT_VILLAGE_POPULATION as POP,
  POPULATION_ARCHETYPE_SPECS,
  POPULATION_CLIPS,
  POPULATION_GROUPS,
  POPULATION_OUTFIT_KITS,
  POPULATION_PROPS,
  VILLAGE_PERFORMANCE_MODEL,
  VILLAGE_POPULATION_GROUP_COUNTS,
  createVillagePopulation,
  crowdClipLibraryFile,
  crowdResidentFile,
  getArchetypeSpec,
  getOutfitKit,
  getPopulationClip,
  getPopulationProp,
  getPopulationResident,
  validateVillagePopulation,
  type VillagePopulation,
  ROLE_LOOP_VARIANTS,
} from './village-population';
import { EALDHOLT_HOUSEHOLD_CASTING, HOUSEHOLD_CASTING_POLYHAVEN } from './household-casting';
import { PEOPLE_LIFE_COMPATIBILITY_PERSON_IDS, createPeopleLifeRegistry, getPeopleLifeRoutine, type PeopleLifeKinKind } from '../people-life';

const SMITHY = ['ealdholt-village-smith', 'ealdholt-smithy-spinner', 'ealdholt-smithy-child', 'ealdholt-smithy-elder'];
const copy = (): any => JSON.parse(JSON.stringify(POP));
const reject = (mutate: (p: any) => void, pattern?: RegExp) => {
  const p = copy(); mutate(p);
  const error = validateVillagePopulation(p as VillagePopulation);
  assert.ok(error, 'mutation should be rejected');
  if (pattern) assert.match(error!, pattern);
};
const crowd = POP.residents.filter(r => r.appearance.kind === 'crowd');

test('population validates, is frozen, deterministic and marked working-placeholder', () => {
  assert.equal(validateVillagePopulation(POP), null);
  assert.equal(POP.status, 'working-placeholder');
  assert.equal(POP.houseStandingEffect, 'none');
  for (const v of [POP, POP.residents[50], POP.residents[50].appearance.macro, POP.residents[50].registry.routine[3], POP.households[3], POP.clipLibraries[0]])
    assert.ok(Object.isFrozen(v));
  assert.deepEqual(JSON.parse(JSON.stringify(createVillagePopulation())), copy(), 'every build returns the same data');
  assert.equal(validateVillagePopulation(copy()), null, 'validates as plain data too');
});

test('exactly the creator\'s groups: 100 residents in 25 households', () => {
  assert.equal(POP.residents.length, 100);
  assert.equal(POP.households.length, 25);
  for (const g of POPULATION_GROUPS) assert.equal(POP.residents.filter(r => r.group === g).length, VILLAGE_POPULATION_GROUP_COUNTS[g], g);
  assert.deepEqual({ ...VILLAGE_POPULATION_GROUP_COUNTS }, {
    'farmers-artisans-merchants': 45, 'children-apprentices': 20, 'guards-military': 15, 'elders-dependents': 12, 'leaders-clergy-specialists': 8,
  });
  const sizes = POP.households.map(h => h.memberIds.length);
  assert.equal(sizes.reduce((a, b) => a + b, 0), 100);
  assert.ok(Math.min(...sizes) >= 3 && Math.max(...sizes) <= 6, `household sizes ${sizes}`);
  const members = POP.households.flatMap(h => h.memberIds);
  assert.equal(new Set(members).size, 100, 'everyone lives in exactly one household');
  for (const r of POP.residents) assert.ok(POP.households.find(h => h.id === r.householdId)!.memberIds.includes(r.id));
  // the composition of an established village: apprentices are adolescents placed with masters, children are 5 to 11
  const kids = POP.residents.filter(r => r.group === 'children-apprentices');
  assert.ok(kids.every(r => r.ageYears >= 5 && r.ageYears <= 17));
  assert.ok(kids.filter(r => r.ageYears >= 12).length >= 6, 'apprentices');
  const elders = POP.residents.filter(r => r.group === 'elders-dependents');
  assert.ok(elders.filter(r => r.ageYears >= 60).length >= 8 && elders.some(r => r.ageYears < 58), 'elders and adult dependents');
});

test('fidelity tiers follow the performance model', () => {
  const major = POP.residents.filter(r => r.fidelityTier === 'major');
  const m = VILLAGE_PERFORMANCE_MODEL;
  assert.ok(major.length >= m.deeplySimulatedMajor.min && major.length <= m.deeplySimulatedMajor.max);
  assert.ok(100 - major.length >= m.scheduleDrivenPersistent.min && 100 - major.length <= m.scheduleDrivenPersistent.max);
  for (const id of SMITHY) assert.equal(getPopulationResident(id)!.fidelityTier, 'major', id);
  for (const r of POP.residents.filter(x => x.group === 'leaders-clergy-specialists')) assert.equal(r.fidelityTier, 'major', r.id);
  assert.ok(major.some(r => r.group === 'guards-military') && major.some(r => r.group === 'farmers-artisans-merchants') && major.some(r => r.group === 'children-apprentices'),
    'major characters are ordinary villagers from several groups, not a leaders-only class');
});

test('the built smithy household keeps its IDs, routines and art sets; compatibility IDs are kept', () => {
  const household = POP.households.find(h => h.id === 'ealdholt-smithy-household')!;
  assert.deepEqual([...household.memberIds], SMITHY);
  for (const id of SMITHY) {
    const r = getPopulationResident(id)!, base = EALDHOLT_HOUSEHOLD_CASTING.registry.residents.find(x => x.id === id)!;
    assert.deepEqual(r.registry.routine, base.routine, `${id} routine unchanged`);
    assert.deepEqual(r.registry.family, base.family, `${id} family unchanged`);
    for (const tie of base.socialTies) assert.ok(r.registry.socialTies.some(t => t.residentId === tie.residentId && t.description === tie.description));
    assert.equal(r.appearance.kind, 'existing-set');
    assert.equal(crowdResidentFile(r), null);
  }
  assert.deepEqual(POP.residents.filter(r => r.appearance.kind === 'existing-set').map(r => r.appearance.existingSet),
    ['village-smith-v1', 'smithy-spinner-v1', 'smithy-child-v1', 'smithy-elder-v1']);
  // the casting's external relationship proposals are now registered ties
  for (const p of EALDHOLT_HOUSEHOLD_CASTING.externalRelationships)
    assert.ok(getPopulationResident(p.residentId)!.registry.socialTies.some(t => t.residentId === p.compatibilityPersonId && t.description === p.description));
  for (const id of PEOPLE_LIFE_COMPATIBILITY_PERSON_IDS) assert.ok(getPopulationResident(id), `${id} kept`);
  assert.equal(getPopulationResident('ealdholt-house-steward')!.roleId, 'house-steward');
  assert.equal(getPopulationResident('ealdholt-house-messenger')!.roleId, 'house-messenger');
});

test('the registry passes the people-life kernel; family and social ties are reciprocal; the village is connected', () => {
  const made = createPeopleLifeRegistry(copy().registry);
  assert.ok(made.ok, made.ok ? '' : made.error);
  const byId = new Map(POP.registry.residents.map(r => [r.id, r]));
  const opposite: Record<PeopleLifeKinKind, PeopleLifeKinKind> = { parent: 'child', child: 'parent', sibling: 'sibling', partner: 'partner', other: 'other' };
  let kinTies = 0, noKin = 0;
  for (const r of POP.registry.residents) {
    if (r.family.kind === 'local-kin') {
      for (const t of r.family.ties) {
        kinTies++;
        const back = byId.get(t.residentId)!;
        assert.ok(back.family.kind === 'local-kin' && back.family.ties.some(b => b.residentId === r.id && b.kind === opposite[t.kind]), `${r.id} -> ${t.residentId}`);
      }
    } else { noKin++; assert.ok(r.family.explanation.length > 20); }
    assert.ok(r.socialTies.length >= 2, `${r.id} has a few social ties`);
    for (const t of r.socialTies) assert.ok(byId.get(t.residentId)!.socialTies.some(b => b.residentId === r.id), `${r.id} ~ ${t.residentId}`);
  }
  assert.ok(kinTies > 200 && noKin >= 2 && noKin <= 5, `${kinTies} kin ties, ${noKin} authored circumstances`);
  // one social component: every household is linked to the rest of the village
  const seen = new Set<string>([POP.registry.residents[0].id]), queue = [POP.registry.residents[0].id];
  while (queue.length) for (const t of byId.get(queue.pop()!)!.socialTies) if (!seen.has(t.residentId)) { seen.add(t.residentId); queue.push(t.residentId); }
  assert.equal(seen.size, 100);
  for (const h of POP.households) {
    const outside = h.memberIds.some(id => byId.get(id)!.socialTies.some(t => !h.memberIds.includes(t.residentId)));
    assert.ok(outside, `${h.id} has ties beyond its walls`);
  }
  // apprentices placed with masters keep kin in their birth household
  for (const id of ['ealdholt-carpenter-apprentice', 'ealdholt-weaver-apprentice', 'ealdholt-healer-apprentice', 'ealdholt-miller-apprentice']) {
    const r = getPopulationResident(id)!, fam = r.registry.family;
    assert.ok(fam.kind === 'local-kin' && fam.ties.some(t => t.kind === 'parent' && getPopulationResident(t.residentId)!.householdId !== r.householdId), id);
  }
});

test('routines cover the day, use registered places and agree on shared meals', () => {
  const made = createPeopleLifeRegistry(copy().registry);
  if (!made.ok) throw new Error(made.error);
  const registry = made.registry;
  const placeIds = new Set(POP.places.map(p => p.id));
  for (const r of POP.residents) {
    const at100 = getPeopleLifeRoutine(registry, r.id, 100)!;
    if (r.roleId === 'night-spearman') assert.equal(at100.placeId, 'proposed-watch-post', `${r.id} on the night watch`);
    else assert.equal(at100.placeId, r.homePlaceId, `${r.id} asleep at home`);
    for (const s of r.registry.routine) assert.ok(placeIds.has(s.placeId));
    const breakfast = getPeopleLifeRoutine(registry, r.id, 370)!;
    assert.equal(breakfast.placeId, r.homePlaceId, `${r.id} breakfasts at home`);
    for (const c of breakfast.companionIds) assert.equal(getPopulationResident(c)!.householdId, r.householdId);
  }
  assert.ok(POP.residents.filter(r => r.group === 'guards-military').some(r => getPeopleLifeRoutine(registry, r.id, 500)!.placeId === 'proposed-watch-post'));
  assert.equal(getPeopleLifeRoutine(registry, 'ealdholt-parish-priest', 400)!.placeId, 'proposed-church');
  assert.equal(getPeopleLifeRoutine(registry, 'ealdholt-miller', 500)!.placeId, 'proposed-mill');
});

test('places: casting places reused, everything else is a marked proposed placeholder', () => {
  const castingPlaces = new Set(EALDHOLT_HOUSEHOLD_CASTING.registry.places.map(p => p.id));
  for (const p of POP.places) {
    if (castingPlaces.has(p.id)) assert.equal(p.status, 'household-casting-place');
    else { assert.equal(p.status, 'proposed-placeholder'); assert.ok(p.id.startsWith('proposed-') && /proposed placeholder/.test(p.label), p.id); }
  }
  for (const id of castingPlaces) assert.ok(POP.places.some(p => p.id === id));
  assert.equal(new Set(POP.places.map(p => p.id)).size, POP.places.length);
});

test('ids and labels are unique role labels; no proper names', () => {
  assert.equal(new Set(POP.residents.map(r => r.id)).size, 100);
  assert.equal(new Set(POP.residents.map(r => r.label)).size, 100);
  for (const r of POP.residents) assert.match(r.id, /^ealdholt-[a-z0-9-]+$/);
  reject(p => { p.residents[60].label = p.residents[61].label; }, /Duplicate resident label/);
  reject(p => { p.registry.residents[60].identityNote = 'Working placeholder: friend of Aldric the miller.'; }, /proper name/);
});

test('archetypes: one skeleton and clip library each, covering every resident with measured residuals', () => {
  assert.equal(POPULATION_ARCHETYPE_SPECS.length, 6);
  for (const spec of POPULATION_ARCHETYPE_SPECS) {
    const m = spec.measuredResidualCm;
    assert.ok(m.spanCore <= m.spanAll && m.spanAll <= 3.0, `${spec.id}: shared skeleton within 3 cm of every body in its span`);
    assert.ok(m.residentsCoreMax <= 2.6 && m.residentsCoreMean <= m.residentsCoreMax, `${spec.id}: actual residents within 2.6 cm`);
    assert.ok(spec.measuredScaleRange[0] < 1 && spec.measuredScaleRange[1] > 1);
    assert.ok(spec.residentScaleRange[0] >= spec.measuredScaleRange[0] && spec.residentScaleRange[1] <= spec.measuredScaleRange[1]);
  }
  for (const r of POP.residents) {
    const spec = getArchetypeSpec(r.appearance.archetype);
    assert.ok(spec.sexes.includes(r.sex) && r.ageYears >= spec.ageYears[0] && r.ageYears <= spec.ageYears[1], r.id);
  }
  for (const r of crowd) {
    const a = r.appearance, spec = getArchetypeSpec(a.archetype);
    assert.ok(Math.abs(a.macro.height - spec.reference.height) <= spec.heightMacroSpread);
    assert.ok(a.faceTargets.length >= 2, `${r.id} has an individual face`);
    assert.ok(a.faceTargets.every(t => !/^(torso|hip|arms|legs|hands|neck)\//.test(t.target)), 'face targets never move body joints');
    assert.equal(a.motion.library, `crowd-clips-${a.archetype}-v1`);
    assert.equal(crowdResidentFile(r), `crowd-v1/residents/${r.id}.glb`);
  }
  assert.equal(crowdClipLibraryFile('elder-female'), 'crowd-v1/clips/crowd-clips-elder-female-v1.glb');
  for (const archetype of ['adult-male', 'adult-female', 'adolescent', 'child', 'elder-male', 'elder-female'] as const)
    assert.ok(crowd.some(r => r.appearance.archetype === archetype), `${archetype} is used`);
});

test('families look related: children inherit the family mix of their in-village parents', () => {
  let checked = 0;
  for (const r of crowd) {
    const fam = r.registry.family;
    if (fam.kind !== 'local-kin') continue;
    const parents = fam.ties.filter(t => t.kind === 'parent').map(t => getPopulationResident(t.residentId)!).filter(p => p.appearance.kind === 'crowd');
    if (parents.length !== 2) continue;
    for (const f of ['african', 'asian'] as const) {
      const avg = (parents[0].appearance.macro.macroShapeFamilies[f] + parents[1].appearance.macro.macroShapeFamilies[f]) / 2;
      assert.ok(Math.abs(r.appearance.macro.macroShapeFamilies[f] - avg) < 0.002, `${r.id} ${f}`);
    }
    assert.ok(parents.some(p => p.appearance.eyes === r.appearance.eyes), `${r.id} has a parent's eyes`);
    checked++;
  }
  assert.ok(checked >= 20, `${checked} children checked`);
});

test('nobody is a clone: unique visible signatures, varied households, varied gaits', () => {
  // the signature is what renders (art fixer, 8 November): the cut, the headwear's shape and built colour, and hair
  // only where no full cover hides it
  const fullCover = ['coif', 'padded-coif', 'hood', 'head-cloth', 'veil-wimple'];
  const sig = (r: typeof crowd[number]) => {
    const a = r.appearance, shows = !fullCover.includes(a.headwear);
    return [a.outfit.kit, a.outfit.cut, a.outfit.palette.main, a.outfit.palette.secondary, a.outfit.palette.accent, a.headwear,
      a.headwearStyle.shape, a.headwearStyle.colour ?? '-', shows ? a.hair.style : '-', shows || a.hair.facialHair !== 'none' ? a.hair.colour : '-',
      a.hair.facialHair].join('|');
  };
  assert.equal(new Set(crowd.map(sig)).size, crowd.length);
  // kits of five or more are spread over at least three cuts, no cut dresses more than 40 percent of a kit, and
  // residents of one role in one kit never share both cut and headwear
  for (const kit of POPULATION_OUTFIT_KITS) {
    const members = crowd.filter(r => r.appearance.outfit.kit === kit.id);
    for (const r of members) assert.ok(kit.cuts.some(c => c.id === r.appearance.outfit.cut), `${r.id} cut`);
    if (members.length < 5) continue;
    assert.ok(kit.cuts.length >= 3, `${kit.id} has cut variants`);
    const counts = new Map<string, number>();
    for (const r of members) counts.set(r.appearance.outfit.cut, (counts.get(r.appearance.outfit.cut) ?? 0) + 1);
    assert.ok(counts.size >= 3, `${kit.id} uses ${counts.size} cuts`);
    assert.ok(Math.max(...counts.values()) <= Math.ceil(members.length * 0.4), `${kit.id}: one cut dresses too many`);
  }
  const looks = new Set<string>();
  for (const r of crowd) {
    const k = [r.roleId, r.appearance.outfit.kit, r.appearance.outfit.cut, r.appearance.headwear, r.appearance.headwearStyle.shape].join('|');
    assert.ok(!looks.has(k), `${r.id} shares cut and headwear with another ${r.roleId}`); looks.add(k);
  }
  const healer = crowd.find(r => r.roleId === 'healer-herbalist')!, midwife = crowd.find(r => r.roleId === 'midwife')!;
  assert.notEqual(healer.appearance.outfit.cut, midwife.appearance.outfit.cut, 'the healer and the midwife are told apart');
  assert.notEqual(healer.appearance.headwear, midwife.appearance.headwear);
  // headwear tones: linen covers come in several tones, felt caps never in the wearer's hair colour slot (accent)
  const linenTones = new Set(crowd.filter(r => ['head-cloth', 'veil-wimple', 'coif'].includes(r.appearance.headwear)).map(r => r.appearance.headwearStyle.colour));
  assert.ok(linenTones.size >= 5, `${linenTones.size} linen headwear colours`);
  for (const r of crowd.filter(x => x.appearance.headwear === 'felt-cap')) assert.notEqual(r.appearance.headwearStyle.tone, 'accent', r.id);
  assert.ok(crowd.filter(r => r.build.frame === 'stout').length >= 3, 'a few residents read as stout');
  for (const h of POP.households) {
    const members = crowd.filter(r => r.householdId === h.id);
    const mains = members.map(r => r.appearance.outfit.palette.main);
    assert.ok(new Set(mains).size >= Math.min(members.length, 2), `${h.id} members read as different people`);
  }
  const guards = crowd.filter(r => r.group === 'guards-military');
  assert.ok(new Set(guards.map(r => r.appearance.headwear)).size >= 3 && new Set(guards.map(r => r.appearance.outfit.palette.main)).size >= 3, 'the watch is not a row of clones');
  const rates = crowd.map(r => r.appearance.motion.rate);
  assert.ok(new Set(rates).size > 50 && Math.max(...rates) - Math.min(...rates) > 0.09, 'playback rates vary');
  for (const archetype of ['adult-male', 'adult-female'] as const) {
    const walks = new Set(crowd.filter(r => r.appearance.archetype === archetype).map(r => r.appearance.motion.walk));
    assert.ok(walks.size >= 3, `${archetype} walk variety`);
  }
});

test('kits, palettes and props are valid for every crowd resident', () => {
  for (const r of crowd) {
    const kit = getOutfitKit(r.appearance.outfit.kit);
    assert.ok(kit.archetypes.includes(r.appearance.archetype), `${r.id} ${kit.id}`);
    assert.ok(kit.dyes.main.includes(r.appearance.outfit.palette.main));
    for (const p of r.appearance.props) assert.ok(getPopulationProp(p.id), `${r.id} prop ${p.id}`);
  }
  for (const kit of POPULATION_OUTFIT_KITS) if (kit.bannerPresentation) assert.match(kit.bannerPresentation, /undyed before|as in the household casting/i);
  // every Poly Haven prop is one of the CC0 models whose licence the household casting verified at asset level
  for (const spec of POPULATION_PROPS) {
    if (spec.source === 'project-original' || spec.source === 'household-set') continue;
    const slug = spec.source.replace(/^polyhaven:/, '');
    assert.ok(HOUSEHOLD_CASTING_POLYHAVEN.some(a => a.id === slug && a.type === 'model'), `${spec.id}: ${spec.source} is a verified model`);
  }
  assert.ok(POPULATION_PROPS.every(p => p.trianglesBudget > 0 && p.trianglesBudget <= 900));
});

test('motion: libraries carry every clip their residents use, and the creator\'s motion list is covered', () => {
  for (const lib of POP.clipLibraries) {
    for (const base of ['idle', 'walk', 'walk_start', 'walk_stop', 'talk', 'look_around', 'sit_down', 'sit', 'stand_up']) assert.ok(lib.clips.includes(base), `${lib.archetype} ${base}`);
    for (const c of lib.clips) assert.ok(getPopulationClip(c), c);
    assert.ok(lib.clips.length <= 50, `${lib.archetype} library stays small (${lib.clips.length} clips)`);
  }
  for (const r of crowd) {
    const lib = POP.clipLibraries.find(l => l.archetype === r.appearance.archetype)!;
    for (const c of [r.appearance.motion.walk, r.appearance.motion.idle, r.appearance.motion.talk, ...r.appearance.motion.roleClips]) assert.ok(lib.clips.includes(c), `${r.id} ${c}`);
    if (r.group !== 'elders-dependents') assert.ok(r.appearance.motion.roleClips.length >= 1, `${r.id} has a role loop`);
  }
  const uses = (clips: readonly string[]) => crowd.some(r => r.appearance.motion.roleClips.some(c => clips.includes(c)));
  const required: Record<string, readonly string[]> = {
    hoeing: ['work_hoe'], sowing: ['work_sow'], 'carrying sacks or water': ['carry_sack_walk', 'carry_yoke_walk', 'carry_bucket_walk'],
    'sawing or planing': ['work_saw', 'work_plane'], 'weaving or spinning': ['work_weave', 'work_spin_distaff'], hammering: ['work_hammer_bench', 'work_chisel'],
    'selling or haggling': ['work_sell'], 'standing watch': ['guard_stand_watch'], 'patrolling with a spear': ['guard_patrol_walk'],
    'children playing': ['play_chase', 'play_toss'], 'children fetching': ['fetch_carry'], 'elders seated work': ['work_shell_peas', 'work_whittle', 'work_card_wool'],
    'clergy praying or reading': ['work_pray', 'work_read'], 'healer grinding herbs': ['work_grind_herbs'], 'leader addressing people': ['work_address'],
  };
  for (const [motion, clips] of Object.entries(required)) assert.ok(uses(clips), motion);
  assert.ok(crowd.some(r => r.appearance.motion.walk === 'walk_stick'), 'elders walk with a stick');
  for (const r of crowd.filter(x => x.group === 'guards-military')) assert.ok(r.appearance.motion.roleClips.some(c => c.startsWith('guard_')), r.id);
  // every child plays a chase variant (ROLE_LOOP_VARIANTS: the base chase, the travelling chase or tag)
  for (const r of crowd.filter(x => x.ageBand === 'child')) assert.ok(ROLE_LOOP_VARIANTS.play_chase.variants.some(v => r.appearance.motion.roleClips.includes(v)), r.id);
  for (const c of POPULATION_CLIPS) assert.ok(/^100style:[A-Za-z]+_(FW|FR|ID|TR1)$/.test(c.source) || c.source.startsWith('project-original:'), c.id);
});

test('the validator rejects broken proposals', () => {
  reject(p => { p.residents.find((r: any) => r.group === 'farmers-artisans-merchants').group = 'guards-military'; }, /Group/);
  reject(p => { p.residents[71].id = p.residents[72].id; }, /Duplicate resident/);
  reject(p => { for (const r of p.residents.filter((x: any) => x.fidelityTier === 'persistent').slice(0, 8)) r.fidelityTier = 'major'; }, /Major residents/);
  reject(p => { p.residents.find((r: any) => r.roleId === 'parish-priest').fidelityTier = 'persistent'; }, /major characters/);
  reject(p => { p.residents.find((r: any) => r.id === 'ealdholt-smithy-child').householdId = 'ealdholt-hall-household'; }, /smithy/);
  reject(p => {
    const r = p.registry.residents.find((x: any) => x.id === 'ealdholt-village-reeve');
    r.socialTies = r.socialTies.filter((t: any) => t.residentId !== 'ealdholt-house-steward');
  }, /reciprocal/);
  reject(p => { const r = p.residents.find((x: any) => x.appearance.kind === 'crowd'); r.appearance.outfit.palette.main = 'oak-gall-black'; r.appearance.outfit.kit = 'field-kirtle'; }, /kit|palette/);
  reject(p => { p.places.find((x: any) => x.status === 'proposed-placeholder').id = 'great-hall'; }, /./);
  reject(p => { p.houseStandingEffect = 'raises'; }, /standing/);
  reject(p => { const r = p.residents.find((x: any) => x.appearance.kind === 'crowd'); r.appearance.motion.roleClips = ['work_juggle']; }, /clip/);
});

test('nothing reads or writes house standing, currencies, loot, experience or health', () => {
  const text = JSON.stringify(POP).toLowerCase();
  assert.equal(text.split('standing').length - 1, 1, 'only houseStandingEffect mentions standing');
  for (const word of ['coin', 'currency', 'loot', ' xp', 'experience points', 'health bar', 'hit points', 'gold']) assert.ok(!text.includes(word), word);
});

test('crowd level budget fits the Quest budget and the repository target', () => {
  const b = CROWD_LEVEL_BUDGET;
  assert.ok(b.triangles.nominal >= 3000 && b.triangles.max <= 4500 && b.triangles.headMin < b.triangles.nominal);
  assert.equal(b.morphTargets, 0);
  assert.equal(b.clipsInResidentFile, 0);
  assert.equal(b.joints, 64);
  // 15 visible residents stay well inside the Quest scene budget of 250k triangles and 120 draws (CODEX_HANDOFF.md)
  assert.ok(b.questVisible.trianglesMax <= 0.3 * 250000 && b.questVisible.drawsMax <= 0.4 * 120);
  // 96 crowd residents at the file maximum plus six libraries of about 1 MiB stay under the hard cap
  const crowdResidents = POP.residents.filter(r => r.appearance.kind === 'crowd').length;
  assert.equal(crowdResidents, 96);
  assert.ok(crowdResidents * b.file.maxMiB + 6 * 1 <= b.committed.hardCapMiB);
  assert.ok(b.committed.hardCapMiB < 80);
});

// motion fixer, 8 November (critic finding 6): residents sharing a role do not play one loop in unison
test('motion: no single role loop or role-clip set dominates a group', () => {
  const walkLike = (c: string) => { const k = getPopulationClip(c)?.kind; return k === 'carry' || k === 'locomotion' || c === 'guard_patrol_walk' || !!getPopulationClip(c)?.travels; };
  const groups = new Map<string, typeof crowd>();
  for (const r of crowd) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  for (const [group, members] of groups) {
    if (members.length < 5) continue;
    const limit = Math.ceil(members.length * 0.4);
    const only = new Map<string, number>(), uses = new Map<string, number>(), sets = new Map<string, number>();
    for (const r of members) {
      const loops = r.appearance.motion.roleClips.filter(c => !walkLike(c));
      if (loops.length === 1) only.set(loops[0], (only.get(loops[0]) ?? 0) + 1);
      for (const c of loops) uses.set(c, (uses.get(c) ?? 0) + 1);
      const key = r.appearance.motion.roleClips.join('+');
      sets.set(key, (sets.get(key) ?? 0) + 1);
    }
    for (const [c, n] of only) assert.ok(n <= limit, `${group}: ${c} is the only loop of ${n} of ${members.length}`);
    for (const [c, n] of uses) assert.ok(n <= limit, `${group}: ${c} is played by ${n} of ${members.length}`);
    for (const [k, n] of sets) assert.ok(n <= limit, `${group}: ${n} of ${members.length} share the role clips ${k}`);
  }
  // the variants exist in the catalogue, travelling ones are flagged, and a role with the challenge keeps the base watch
  for (const spec of Object.values(ROLE_LOOP_VARIANTS)) for (const v of spec.variants) assert.ok(getPopulationClip(v), v);
  assert.equal(getPopulationClip('play_chase_b')?.travels, true);
  for (const r of crowd) if (r.appearance.motion.roleClips.includes('guard_challenge')) assert.ok(r.appearance.motion.roleClips.includes('guard_stand_watch'), r.id);
});

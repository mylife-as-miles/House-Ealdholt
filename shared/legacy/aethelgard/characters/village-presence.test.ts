import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VILLAGE_LEVEL_COSTS,
  VILLAGE_PRESENCE_CAPS,
  estimatePresentationCost,
  estimatedStatureMetres,
  lowRateDue,
  presenceCadenceSeconds,
  proposedSimulationLevel,
  selectVillageArtLevels,
  selectVillagePresence,
  validatePresenceCaps,
  type PresenceMode,
  type PresenceRequest,
  type PresenceViewer,
  type VillageArtLevel,
  CROWD_PROP_COSTS, isGuaranteedPresence, presenceRefreshDue,
} from './village-presence';
import { EALDHOLT_VILLAGE_POPULATION as POP, OUTDOOR_PLACE_CAP } from './village-population';
import { getPeopleLifeRoutine } from '../people-life';

const QUEST: PresenceViewer = { platform: 'quest', position: [0, 1.6, 0], forward: [0, -1], halfFovDegrees: 52, pixelsPerDegree: 25 };
const DESK_WELL: PresenceViewer = { platform: 'desktop-isometric', position: [0, 4, 8], forward: [0, -1], halfFovDegrees: 38, pixelsPerDegree: 24 };
// The overview camera of village-views.ts sits about 90 m up and 65 m back from its ground target (here the origin).
const DESK_OVERVIEW: PresenceViewer = { platform: 'desktop-isometric', position: [0, 90, 65], forward: [0, -1], halfFovDegrees: 38, pixelsPerDegree: 24 };
/** A resident on the ground at an offset from the overview target, inside the caller's frustum test. */
const ground = (id: string, x: number, z: number, extra: Partial<PresenceRequest> = {}): PresenceRequest =>
  ({ residentId: id, tier: 'persistent', position: [x, 0, z], heightMetres: 1.7, presentable: true, moving: false, interaction: 'none', current: null, inFrustum: true, ...extra });

/** A resident standing at a bearing (degrees from the viewer's forward, -z) and distance on the ground. */
function at(id: string, bearing: number, distance: number, extra: Partial<PresenceRequest> = {}): PresenceRequest {
  const a = bearing * Math.PI / 180;
  return { residentId: id, tier: 'persistent', position: [Math.sin(a) * distance, 0, -Math.cos(a) * distance], heightMetres: 1.7,
    presentable: true, moving: false, interaction: 'none', current: null, ...extra };
}
const modeOf = (sel: ReturnType<typeof selectVillagePresence>, id: string): PresenceMode => sel.decisions[id].mode;

test('caps are consistent and Quest stays inside the creator\'s 8 to 15 visible residents', () => {
  for (const caps of Object.values(VILLAGE_PRESENCE_CAPS)) assert.equal(validatePresenceCaps(caps), null, caps.platform);
  const q = VILLAGE_PRESENCE_CAPS.quest;
  assert.ok(q.maxDrawn >= 8 && q.maxDrawn <= 15);
  assert.match(validatePresenceCaps({ ...q, maxDrawn: 20 })!, /8 to 15/);
  assert.match(validatePresenceCaps({ ...q, maxDrawn: 6 })!, /8 to 15/);
  assert.match(validatePresenceCaps({ ...q, drawExitMetres: 20 })!, /Hysteresis/);
  assert.match(validatePresenceCaps({ ...q, maxFullRate: 13 })!, /Full-rate/);
  assert.throws(() => selectVillagePresence(QUEST, [], VILLAGE_PRESENCE_CAPS['desktop-isometric']), /same platform/);
});

test('explicit miniature focus keeps a hard draw and animation cap even for a packed engaged near ring', () => {
  const viewer: PresenceViewer = { ...QUEST, mode: 'miniature-focus' };
  const requests = Array.from({ length: 100 }, (_, i) => at(`mini-${String(i).padStart(3, '0')}`, 0, 2,
    { inFrustum: true, interaction: 'engaged', moving: true }));
  const selection = selectVillagePresence(viewer, requests);
  assert.equal(Object.keys(selection.decisions).length, 100);
  assert.equal(selection.drawn.length, 12);
  assert.equal(selection.counts.animated, 8);
  assert.equal(selection.counts.lowRate, 4);
  assert.equal(selection.counts.hidden, 88);
  assert.equal(Object.values(selection.decisions).filter(d => d.keepLoaded).length, 12, 'miniature asset loads share the draw cap');
  assert.deepEqual(selection.overCapacity, []);
  assert.deepEqual(selection, selectVillagePresence(viewer, [...requests].reverse()));
  assert.equal(selectVillagePresence(QUEST, requests).drawn.length, 100, 'room-scale guarantees remain unchanged');
});

test('miniature source-focus priority never lets offscreen or indoor residents consume visible slots', () => {
  const viewer: PresenceViewer = { ...QUEST, mode: 'miniature-focus' };
  const offscreen = Array.from({ length: 30 }, (_, i) => at(`off-${i}`, 0, 1,
    { interaction: 'engaged', inFrustum: false, current: 'animated' }));
  const visible = Array.from({ length: 12 }, (_, i) => at(`visible-${i}`, 0, 20, { inFrustum: true }));
  const selection = selectVillagePresence(viewer, [...offscreen, ...visible, at('indoor', 0, 1, { inFrustum: true, presentable: false })]);
  assert.equal(selection.drawn.length, 12);
  assert.ok(selection.drawn.every(id => id.startsWith('visible-')));
  for (const row of offscreen) {
    assert.equal(selection.decisions[row.residentId].reason, 'out-of-view');
    assert.equal(selection.decisions[row.residentId].keepLoaded, false, 'a physical head turn releases hidden miniature assets');
  }
  assert.equal(selection.decisions.indoor.reason, 'indoors');
  assert.throws(() => selectVillagePresence(viewer, [at('missing-head-proof', 0, 5)]), /actual head frustum/);
  assert.throws(() => selectVillagePresence({ ...DESK_WELL, mode: 'miniature-focus' }, []), /Quest/);
});

test('Quest with the whole village around the viewer draws at most the cap, nearest in front first', () => {
  const requests = POP.residents.map((r, i) => at(r.id, (i * 137.5) % 360 - 180, 2 + (i % 25) * 1.6,
    { tier: r.fidelityTier, heightMetres: estimatedStatureMetres(r) }));
  const sel = selectVillagePresence(QUEST, requests);
  const q = VILLAGE_PRESENCE_CAPS.quest;
  const guaranteed = sel.drawn.filter(id => ['near-in-front', 'near-over-cap', 'near-out-of-view', 'engaged'].includes(sel.decisions[id].reason));
  assert.ok(guaranteed.length > 0);
  // past the cap only guaranteed residents are drawn, and each is reported
  assert.ok(sel.drawn.length <= q.maxDrawn + sel.overCapacity.length);
  for (const id of sel.overCapacity) assert.ok(guaranteed.includes(id), id);
  assert.equal(sel.counts.animated + sel.counts.lowRate + sel.counts.posed, sel.drawn.length);
  assert.equal(sel.counts.hidden, 100 - sel.drawn.length);
  for (const id of sel.drawn) assert.ok(sel.decisions[id].inView || sel.decisions[id].reason !== 'priority');
  // nobody near and in front is hidden
  for (const r of requests) {
    const d = sel.decisions[r.residentId];
    if (d.distanceMetres <= q.nearGuaranteeMetres && Math.abs(((Math.atan2(r.position[0], -r.position[2]) * 180 / Math.PI))) <= q.frontHalfAngleDegrees)
      assert.notEqual(d.mode, 'hidden', r.residentId);
  }
  // every resident keeps a decision and a persistent identity even when hidden
  assert.equal(Object.keys(sel.decisions).length, 100);
});

test('a nearby resident in front is never silently hidden, even when the cap is full of major characters', () => {
  const majors = Array.from({ length: 20 }, (_, i) => at(`major-${String(i).padStart(2, '0')}`, -40 + i * 4, 8 + i * 0.3, { tier: 'major', current: 'animated' }));
  const near = at('persistent-near', 10, 3);
  const sel = selectVillagePresence(QUEST, [...majors, near]);
  assert.equal(modeOf(sel, 'persistent-near'), 'animated');
  assert.equal(sel.decisions['persistent-near'].reason, 'near-in-front');
  assert.equal(sel.drawn.length, VILLAGE_PRESENCE_CAPS.quest.maxDrawn);
  // fourteen people crowding round the viewer: all drawn, the two past the cap are reported, not dropped; those beyond
  // the view (the omnidirectional near ring) are drawn at the low rate and fill after the ones in view
  const crowd = Array.from({ length: 14 }, (_, i) => at(`crowd-${String(i).padStart(2, '0')}`, -60 + i * 9, 2 + (i % 4) * 0.8));
  const packed = selectVillagePresence(QUEST, crowd);
  assert.equal(packed.drawn.length, 14);
  assert.equal(packed.overCapacity.length, 2);
  for (const id of packed.overCapacity) assert.ok(['near-over-cap', 'near-out-of-view'].includes(packed.decisions[id].reason), id);
  for (const r of crowd) assert.equal(modeOf(packed, r.residentId), packed.decisions[r.residentId].inView ? 'animated' : 'low-rate', r.residentId);
});

test('priority: engagement, then major tier and view direction, then distance', () => {
  const requests = [
    ...Array.from({ length: 12 }, (_, i) => at(`front-${String(i).padStart(2, '0')}`, -30 + i * 5, 12 + i)),
    at('behind-near', 180, 8), at('engaged-far', 0, 28, { interaction: 'engaged' }), at('engaged-behind', 170, 15, { interaction: 'engaged' }),
    at('major-mid', 5, 20, { tier: 'major' }), at('nearby-talk', -10, 22, { interaction: 'nearby' }),
  ];
  const sel = selectVillagePresence(QUEST, requests);
  assert.equal(modeOf(sel, 'engaged-far'), 'animated');
  assert.equal(modeOf(sel, 'engaged-behind'), 'animated', 'engaged residents stay drawn even when the viewer looks away');
  assert.equal(sel.decisions['behind-near'].mode, 'hidden');
  assert.equal(sel.decisions['behind-near'].reason, 'out-of-view');
  assert.ok(sel.decisions['behind-near'].keepLoaded, 'stays loaded for a head turn');
  assert.notEqual(modeOf(sel, 'major-mid'), 'hidden', 'a major character outranks nearer persistent residents');
  assert.notEqual(modeOf(sel, 'nearby-talk'), 'hidden');
  assert.equal(sel.drawn[0], 'engaged-far', 'both engaged; the one in view ranks first');
  assert.equal(sel.decisions['front-11'].reason, 'cap');
});

test('hysteresis: distance, view cone, cap membership and full-rate size', () => {
  const inBand = (current: PresenceMode | null) => selectVillagePresence(QUEST, [at('r', 0, 32, { current })]).decisions.r;
  assert.equal(inBand(null).reason, 'far');
  assert.notEqual(inBand('low-rate').mode, 'hidden', 'kept between the enter and exit distance');
  const cone = (current: PresenceMode | null) => selectVillagePresence(QUEST, [at('r', 57, 20, { current })]).decisions.r;
  assert.equal(cone(null).reason, 'out-of-view');
  assert.notEqual(cone('low-rate').mode, 'hidden', 'kept inside the view margin');
  // two equal candidates for the last slot: the one already drawn keeps it
  const filler = Array.from({ length: 11 }, (_, i) => at(`f-${String(i).padStart(2, '0')}`, -20 + i * 4, 10));
  const a = at('a-new', 2, 18), b = at('z-drawn', -2, 18.2, { current: 'low-rate' });
  const sel = selectVillagePresence(QUEST, [...filler, a, b]);
  assert.notEqual(modeOf(sel, 'z-drawn'), 'hidden');
  assert.equal(modeOf(sel, 'a-new'), 'hidden');
  // full-rate threshold: about 160 px to enter, kept down to 140 px (Quest 3 at 25 px per degree)
  const size = (d: number, current: PresenceMode | null) => selectVillagePresence(QUEST, [at('r', 0, d, { current })]).decisions.r;
  assert.equal(size(14, null).mode, 'animated');
  assert.equal(size(16.5, null).mode, 'low-rate');
  assert.equal(size(16.5, 'animated').mode, 'animated');
});

test('full-rate slots are limited; travelling residents are never posed; indoor residents are hidden', () => {
  const many = Array.from({ length: 12 }, (_, i) => at(`r-${String(i).padStart(2, '0')}`, -45 + i * 8, 7 + i * 0.2));
  const sel = selectVillagePresence(QUEST, many);
  assert.equal(sel.counts.animated, VILLAGE_PRESENCE_CAPS.quest.maxFullRate);
  assert.equal(sel.counts.lowRate, 4);
  for (const id of sel.drawn) if (sel.decisions[id].mode === 'low-rate') assert.equal(sel.decisions[id].updateHz, VILLAGE_PRESENCE_CAPS.quest.lowRateHz);
  const far = selectVillagePresence(DESK_OVERVIEW, [ground('still', 0, -30), ground('walking', 2, -30, { moving: true })]);
  assert.equal(modeOf(far, 'still'), 'posed');
  assert.equal(far.decisions.still.updateHz, 0);
  assert.equal(modeOf(far, 'walking'), 'low-rate', 'a travelling resident would slide if posed');
  const home = selectVillagePresence(QUEST, [at('indoors', 0, 2, { presentable: false, interaction: 'engaged' })]);
  assert.equal(home.decisions.indoors.mode, 'hidden');
  assert.equal(home.decisions.indoors.reason, 'indoors');
});

test('desktop isometric: the overview shows many small low-rate or posed residents, the well view animates the near ones', () => {
  const requests = POP.residents.map((r, i) => ground(r.id, (i % 10) * 8 - 36, Math.floor(i / 10) * 8 - 36,
    { tier: r.fidelityTier, heightMetres: estimatedStatureMetres(r), moving: i % 3 === 0 }));
  const overview = selectVillagePresence(DESK_OVERVIEW, requests);
  assert.equal(overview.drawn.length, VILLAGE_PRESENCE_CAPS['desktop-isometric'].maxDrawn);
  assert.equal(overview.counts.animated, 0, 'nobody is big enough on screen for full-rate animation');
  assert.ok(overview.drawn.every(id => overview.decisions[id].projectedPixels < 40));
  assert.ok(overview.drawn.every(id => overview.decisions[id].mode !== 'posed' || !requests.find(r => r.residentId === id)!.moving));
  const majors = POP.residents.filter(r => r.fidelityTier === 'major').map(r => r.id);
  assert.ok(majors.every(id => overview.decisions[id].mode !== 'hidden'), 'with the cap binding, major characters are drawn first');
  const near = POP.residents.slice(0, 30).map((r, i) => at(r.id, (i % 10) * 7 - 35, 4 + Math.floor(i / 10) * 6, { tier: r.fidelityTier, heightMetres: estimatedStatureMetres(r) }));
  const well = selectVillagePresence(DESK_WELL, near);
  assert.ok(well.counts.animated >= 10 && well.counts.animated <= VILLAGE_PRESENCE_CAPS['desktop-isometric'].maxFullRate + 12);
  for (const id of well.drawn) if (well.decisions[id].distanceMetres < 10) assert.equal(well.decisions[id].mode, 'animated');
});

test('deterministic and independent of request order; update phases spread out', () => {
  const requests = POP.residents.slice(0, 40).map((r, i) => at(r.id, i * 9 - 180, 3 + i * 0.7, { tier: r.fidelityTier }));
  const a = selectVillagePresence(QUEST, requests);
  const b = selectVillagePresence(QUEST, [...requests].reverse());
  assert.deepEqual(a, b);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.decisions) && Object.isFrozen(a.decisions[requests[0].residentId]));
  const phases = Object.values(a.decisions).map(d => d.updatePhase);
  assert.ok(phases.every(p => p >= 0 && p < 1));
  assert.ok(new Set(phases.map(p => Math.floor(p * 10))).size >= 8, 'phases cover most tenths');
  assert.throws(() => selectVillagePresence(QUEST, [requests[0], requests[0]]), /distinct/);
  assert.throws(() => selectVillagePresence(QUEST, [at('bad', 0, 3, { heightMetres: 0 })]), /Invalid/);
});

test('estimated statures follow the archetypes and the measured MakeHuman statures', () => {
  // measured statures of the published crowd files (resident JSON statureCm, crowd build of 8 November: the art fixer
  // spread the height classes over each kit, so the 7 November measurements no longer apply)
  const measured: Record<string, number> = { 'ealdholt-reeve-younger-son': 0.987, 'ealdholt-mason-apprentice': 1.687, 'ealdholt-gardener': 1.61,
    'ealdholt-hall-elder': 1.635, 'ealdholt-guard-captain': 1.848, 'ealdholt-weaver-mother': 1.445, 'ealdholt-milkmaid': 1.48, 'ealdholt-gate-ward-daughter': 1.522 };
  for (const [id, metres] of Object.entries(measured)) {
    const r = POP.residents.find(x => x.id === id)!;
    assert.ok(Math.abs(estimatedStatureMetres(r) - metres) / metres <= 0.05, `${id}: ${estimatedStatureMetres(r)} against ${metres}`);
  }
  for (const r of POP.residents) {
    const h = estimatedStatureMetres(r);
    // children: the archetype's measured placement-scale range (0.70 to 1.36 of 1.195 m); a tall 11-year-old reaches 1.58 m
    const range = r.appearance.archetype === 'child' ? [0.84, 1.63] : r.appearance.archetype === 'adolescent' ? [1.35, 1.8] : [1.35, 1.95];  // adults: a short woman of 22 is estimated at 1.39 m (measured 1.456 m)
    assert.ok(h >= range[0] && h <= range[1], `${r.id} ${h}`);
  }
});

test('applying a decision: owner cadence, phase-staggered low-rate frames and the simulation proposal', () => {
  const many = Array.from({ length: 12 }, (_, i) => at(`r-${String(i).padStart(2, '0')}`, -45 + i * 8, 7 + i * 0.2));
  const sel = selectVillagePresence(QUEST, [...many, at('behind', 180, 9), at('indoors', 0, 3, { presentable: false })]);
  for (const id of sel.drawn) {
    const d = sel.decisions[id];
    assert.equal(presenceCadenceSeconds(d), d.mode === 'animated' ? 0 : d.mode === 'low-rate' ? 1 / VILLAGE_PRESENCE_CAPS.quest.lowRateHz : null);
  }
  assert.equal(presenceCadenceSeconds(sel.decisions.behind), null);
  // low-rate residents evaluate at about their rate, on frames spread by their phases (72 Hz display, one second)
  const lowIds = sel.drawn.filter(id => sel.decisions[id].mode === 'low-rate');
  assert.equal(lowIds.length, 4);
  const perFrame = new Array<number>(72).fill(0);
  for (const id of lowIds) {
    let due = 0, prev: number | null = 10;
    for (let f = 1; f <= 72; f++) { const t = 10 + f / 72; if (lowRateDue(sel.decisions[id], prev, t)) { due++; perFrame[f - 1]++; } prev = t; }
    assert.ok(due === 15 || due === 14 || due === 16, `${id} evaluated ${due} times in a second`);
  }
  assert.ok(Math.max(...perFrame) < lowIds.length, 'the phases keep the four low-rate residents off one shared frame');
  assert.equal(lowRateDue(sel.decisions[lowIds[0]], null, 3), true, 'due on the first frame after a mode change');
  assert.equal(lowRateDue(sel.decisions[sel.drawn[0]], 1, 1), sel.decisions[sel.drawn[0]].mode === 'animated');
  assert.equal(lowRateDue(sel.decisions.behind, 1, 2), false);
  // proposal: major deep always; persistent scheduled while drawn or kept loaded, far otherwise; promotion never deep
  assert.equal(proposedSimulationLevel('major', sel.decisions.behind), 'deep');
  assert.equal(proposedSimulationLevel('major', null), 'deep');
  assert.equal(proposedSimulationLevel('persistent', sel.decisions[sel.drawn[0]]), 'scheduled');
  assert.equal(proposedSimulationLevel('persistent', sel.decisions.behind), 'scheduled', 'kept loaded for a head turn');
  assert.equal(proposedSimulationLevel('persistent', sel.decisions.indoors), 'far', 'indoors: not drawn and not prefetched');
  const far = selectVillagePresence(QUEST, [at('far-away', 0, 80)]);
  assert.equal(proposedSimulationLevel('persistent', far.decisions['far-away']), 'far');
  assert.equal(proposedSimulationLevel('persistent', null), 'far');
});

test('the whole village maps onto the creator\'s simulation model: 20 deep, 80 scheduled or far', () => {
  const requests = POP.residents.map((r, i) => at(r.id, (i * 137.5) % 360 - 180, 2 + (i % 25) * 2.4,
    { tier: r.fidelityTier, heightMetres: estimatedStatureMetres(r) }));
  const sel = selectVillagePresence(QUEST, requests);
  const levels = POP.residents.map(r => proposedSimulationLevel(r.fidelityTier, sel.decisions[r.id]));
  const deep = levels.filter(l => l === 'deep').length;
  const model = { deep: [15, 25], persistent: [75, 85] };
  assert.ok(deep >= model.deep[0] && deep <= model.deep[1], `${deep} deep`);
  assert.ok(100 - deep >= model.persistent[0] && 100 - deep <= model.persistent[1]);
  assert.ok(levels.filter(l => l === 'far').length > 0 && levels.filter(l => l === 'scheduled').length > 0);
});

test('levels: crowd residents use their one crowd file, the smithy four their household levels, hidden ones nothing', () => {
  const smithy = POP.residents.filter(r => r.appearance.kind === 'existing-set').map(r => r.id);
  assert.equal(smithy.length, 4);
  const crowd = POP.residents.filter(r => r.appearance.kind === 'crowd').slice(0, 6).map(r => r.id);
  const req = (id: string, bearing: number, d: number) => at(id, bearing, d, { tier: 'major' });
  const questReqs = [req(smithy[0], 0, 3), req(smithy[1], 10, 9), req(smithy[2], -10, 20), req(smithy[3], 180, 9),
    ...crowd.map((id, i) => req(id, -20 + i * 8, 5 + i))];
  const sel = selectVillagePresence(QUEST, questReqs);
  const kinds = (id: string) => (smithy.includes(id) ? 'existing-set' : 'crowd') as 'crowd' | 'existing-set';
  const lv = selectVillageArtLevels(sel, questReqs.map(r => ({ residentId: r.residentId, kind: kinds(r.residentId), inConversation: false, current: null })));
  assert.equal(lv.levels[smithy[0]], 'quest');
  assert.equal(lv.levels[smithy[1]], 'quest');
  assert.equal(lv.levels[smithy[2]], 'quest', 'drawn beyond the household Quest distance: the only built Quest level');
  assert.equal(lv.levels[smithy[3]], null, 'hidden behind the viewer');
  for (const id of crowd) assert.equal(lv.levels[id], 'crowd');
  const desk = selectVillagePresence(DESK_WELL, questReqs.map(r => ({ ...r, inFrustum: r.residentId !== smithy[3] })));
  const dl = selectVillageArtLevels(desk, questReqs.map(r => ({ residentId: r.residentId, kind: kinds(r.residentId), inConversation: r.residentId === smithy[2], current: null })));
  // the well camera stands 8 m back and 4 m up: the nearest smithy resident is about 11 m away
  assert.equal(dl.levels[smithy[2]], 'desktop-lod0', 'conversation takes the close level');
  assert.equal(dl.levels[smithy[0]], 'desktop-lod1');
  assert.equal(dl.levels[smithy[1]], 'desktop-lod1');
  assert.equal(dl.levels[smithy[3]], null, 'outside the caller frustum');
  assert.throws(() => selectVillageArtLevels(sel, [{ residentId: 'nobody', kind: 'crowd', inConversation: false, current: null }]), /No presence decision/);
});

test('budgeted cost of a full Quest view and of the desktop isometric cap', () => {
  // fifteen drawn on Quest (the creator's upper bound), the smithy four among them
  const levels: Record<string, VillageArtLevel | null> = {};
  POP.residents.slice(0, 15).forEach(r => { levels[r.id] = r.appearance.kind === 'crowd' ? 'crowd' : 'quest'; });
  levels.hidden = null;
  const q = estimatePresentationCost(levels);
  assert.equal(q.drawn, 15);
  assert.equal(q.byLevel.quest, 4);
  // bodies, plus the crowd residents' props (motion and runtime fixer, 8 November: the adapters attach them) and the
  // smithy sets' morph textures
  assert.equal(q.trianglesNominal, 4 * VILLAGE_LEVEL_COSTS.quest.trianglesNominal + 11 * (3500 + CROWD_PROP_COSTS.trianglesNominal));
  assert.ok(q.trianglesNominal <= 15 * 4500, 'inside the creator-facing Quest triangle budget at nominal size');
  assert.equal(q.drawsMin, 4 * 2 + 11);
  assert.equal(q.drawsMax, 4 * 2 + 11 * (2 + CROWD_PROP_COSTS.drawsMax));
  assert.equal(q.morphTextureMiB, Math.round(4 * VILLAGE_LEVEL_COSTS.quest.morphTextureMiB * 10) / 10);
  assert.equal(q.props.kitAtlasMiB, Math.round(CROWD_PROP_COSTS.kits * CROWD_PROP_COSTS.kitAtlasMiB * 10) / 10);
  // measured props replace the budget (a presenter's metrics)
  const measured = estimatePresentationCost(levels, { triangles: 2100, draws: 14, kitsInView: 3 });
  assert.equal(measured.trianglesNominal, 4 * VILLAGE_LEVEL_COSTS.quest.trianglesNominal + 11 * 3500 + 2100);
  assert.equal(measured.drawsMin, 4 * 2 + 11 + 14);
  const d: Record<string, VillageArtLevel | null> = {};
  POP.residents.slice(4, 44).forEach(r => { d[r.id] = 'crowd'; });
  const dc = estimatePresentationCost(d);
  assert.equal(dc.trianglesNominal, 40 * (3500 + CROWD_PROP_COSTS.trianglesNominal));
  assert.equal(dc.drawsMin, 40);
  assert.ok(dc.decodedTextureMiB > 60 && dc.decodedTextureMiB < 70, `${dc.decodedTextureMiB}`);
});

// motion and runtime fixer, 8 November (engineering findings 10 and 11)
test('desktop overview: every presentable resident in the frustum is drawn (cap 100)', () => {
  const requests = POP.residents.slice(0, 96).map((r, i) => ({ residentId: r.id, tier: r.fidelityTier, position: [(i % 12) * 6 - 33, 0, Math.floor(i / 12) * 6 - 21] as [number, number, number],
    heightMetres: estimatedStatureMetres(r), presentable: true, moving: i % 3 === 0, interaction: 'none' as const, current: null, inFrustum: true }));
  const viewer = { platform: 'desktop-isometric' as const, position: [0, 90, 65] as [number, number, number], forward: [0, -1] as [number, number], halfFovDegrees: 40, pixelsPerDegree: 24 };
  const sel = selectVillagePresence(viewer, requests);
  assert.equal(sel.drawn.length, 96);
  assert.ok(sel.counts.animated <= VILLAGE_PRESENCE_CAPS['desktop-isometric'].maxFullRate);
  for (const r of requests) if (r.moving) assert.notEqual(sel.decisions[r.residentId].mode, 'posed', 'a travelling resident is never posed');
  assert.equal(Object.values(sel.decisions).filter(d => d.reason === 'cap').length, 0);
});

test('Quest near ring is omnidirectional; a head turn calls for a fresh decision', () => {
  const sel = selectVillagePresence(QUEST, [at('behind-4m', 180, 4), at('side-4m', 80, 4), at('behind-8m', 180, 8), at('front-4m', 0, 4)]);
  assert.equal(sel.decisions['behind-4m'].mode, 'low-rate');
  assert.equal(sel.decisions['behind-4m'].reason, 'near-out-of-view');
  assert.equal(sel.decisions['side-4m'].reason, 'near-out-of-view');
  assert.equal(sel.decisions['behind-8m'].mode, 'hidden');
  assert.equal(sel.decisions['front-4m'].reason, 'near-in-front');
  for (const id of ['behind-4m', 'side-4m', 'front-4m']) assert.ok(isGuaranteedPresence(sel.decisions[id]), id);
  assert.ok(!isGuaranteedPresence(sel.decisions['behind-8m']));
  // a cap full of residents in view: the near residents behind are added past the cap (reported), not swapped in
  const front = Array.from({ length: 12 }, (_, i) => at(`front-${String(i).padStart(2, '0')}`, -40 + i * 7, 9 + i * 0.5));
  const full = selectVillagePresence(QUEST, [...front, at('behind-3m', 170, 3)]);
  for (const r of front) assert.notEqual(full.decisions[r.residentId].mode, 'hidden', r.residentId);
  assert.deepEqual(full.overCapacity, ['behind-3m']);
  // refresh: more than 10 degrees of yaw or 0.75 m of movement since the last decision
  const turned = { ...QUEST, forward: [Math.sin(12 * Math.PI / 180), -Math.cos(12 * Math.PI / 180)] as [number, number] };
  const slight = { ...QUEST, forward: [Math.sin(6 * Math.PI / 180), -Math.cos(6 * Math.PI / 180)] as [number, number] };
  assert.equal(presenceRefreshDue(null, QUEST), true);
  assert.equal(presenceRefreshDue(QUEST, slight), false);
  assert.equal(presenceRefreshDue(QUEST, turned), true);
  assert.equal(presenceRefreshDue(QUEST, { ...QUEST, position: [0.9, 1.6, 0] }), true);
});

test('the real routines never gather more residents at an outdoor place than Quest draws: presence from each busy place, every hour', () => {
  const homes = new Set(POP.households.map(h => h.homePlaceId));
  const indoor = new Set(['proposed-church', 'proposed-house-hall', 'proposed-mill', 'proposed-bakehouse', 'proposed-road-beyond', 'smithy-forge']);
  let checked = 0;
  for (let minute = 0; minute < 1440; minute += 15) {
    const byPlace = new Map<string, string[]>();
    for (const r of POP.residents) {
      const slot = getPeopleLifeRoutine(POP.registry, r.id, minute)!;
      if (homes.has(slot.placeId) || indoor.has(slot.placeId)) continue;
      byPlace.set(slot.placeId, [...(byPlace.get(slot.placeId) ?? []), r.id]);
    }
    for (const [place, ids] of byPlace) {
      assert.ok(ids.length <= OUTDOOR_PLACE_CAP, `${place} holds ${ids.length} at ${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`);
      if (minute % 60 || ids.length < 6) continue;
      // a Quest viewer standing at the edge of the place, everyone gathered 3 to 12 m ahead: nobody in view is hidden by the cap
      const requests = ids.map((id, i) => at(id, -45 + (90 * i) / Math.max(1, ids.length - 1), 3 + (i % 5) * 2.2));
      const sel = selectVillagePresence(QUEST, requests);
      for (const id of ids) assert.notEqual(sel.decisions[id].reason, 'cap', `${id} at ${place}, ${minute / 60}:00`);
      checked++;
    }
  }
  assert.ok(checked > 10, `${checked} busy place-hours checked`);
});

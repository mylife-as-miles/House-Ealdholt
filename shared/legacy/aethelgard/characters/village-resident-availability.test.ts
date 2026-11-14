import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { EALDHOLT_VILLAGE_POPULATION as POP, type PopulationResident } from './village-population';
import type { VillagePopulationResidentState } from './village-population-runtime';
import type { VillageSiteLayout } from './village-site';
import { getPopulationArt } from './village-population-art';
import { getHouseholdArtSet } from './household-art-sets';
import { EALDHOLT_POPULATION_ASSET_SHA256 as HASHES } from './population-asset-integrity';
import { parsePopulationMotionEvidence, qualifyPopulationMotion } from './population-motion-clearance';
import { displayPopulationActivity, resolvePopulationPresentation } from './village-activity-presentation';
import { describeVillageResidentAvailability, pendingVillageResidentAvailability, presentedVillageResidentAvailability } from './village-resident-availability';
import { residentFollowAvailabilityText } from '../observer/resident-watch';

function state(resident: PopulationResident, patch: Partial<VillagePopulationResidentState> = {}): VillagePopulationResidentState {
  const slot = resident.registry.routine[0];
  return { residentId: resident.id, tier: resident.fidelityTier, activity: slot.activity, roleClip: null,
    availableRoleClips: resident.appearance.motion.roleClips, scheduledPlaceId: slot.placeId, placeId: slot.placeId,
    fromPlaceId: resident.homePlaceId, slotIndex: 0, slotStartMinute: slot.startMinute, slotEndMinute: slot.endMinute,
    status: 'travelling', reason: null, position: [10, 0, 10], yawRadians: 0, moving: true, presentable: true, ...patch };
}
const site = (profile: 'desktop' | 'quest'): VillageSiteLayout => ({ profile, sourceSha256: 'a'.repeat(64),
  frame: 'source-root-local-metres', capsule: { height: 2.1, radius: .6 }, anchors: [], routes: [], placeBindings: [], residentPlaceBindings: [] });

/** Synthetic unit envelopes exercise consumption of the real qualifier. They
 * are not measured asset evidence or a source-site certificate. */
function evidenceFor(resident: PopulationResident) {
  const art = getPopulationArt(resident.id)!, household = getHouseholdArtSet(resident.id);
  const library = POP.clipLibraries.find(row => row.archetype === resident.appearance.archetype);
  const names: string[] = household ? [household.actorMotions.idle, household.actorMotions.walk,
    household.actorMotions.talk, household.actorMotions.work, ...Object.values(household.actorMotions.extra), household.actorMotions.sit].filter((name): name is string => !!name)
    : (() => { assert.ok(library); const bytes = fs.readFileSync(new URL(`../../../../main game/public/assets/legacy/environment/aethelgard/characters/crowd-v1/clips/${library.file}`, import.meta.url));
      return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()).animations.map((clip: { name: string }) => clip.name); })();
  const levels = Object.fromEntries(art.levels.map(level => [level.level, { files: { ...HASHES },
    clips: Object.fromEntries(names.map(name => [name, { radiusMetres: .45, heightMetres: 1.8, minimumBodyYMetres: 0, placedBelowGround: false }])) }]));
  return parsePopulationMotionEvidence({ schemaVersion: 1, method: 'cpu-sampled-skin-and-props-v1', fps: 60, paddingMetres: .05,
    residents: { [resident.id]: { levels } } });
}

test('ordinary spearmen, steward, smith and messenger use the same real qualification contract on both platforms', () => {
  const ids = ['ealdholt-spearman-husband', 'ealdholt-garrison-spearman', 'ealdholt-house-steward', 'ealdholt-house-messenger',
    POP.residents.find(row => row.appearance.kind === 'existing-set')!.id];
  for (const id of ids) {
    const resident = POP.residents.find(row => row.id === id)!, row = state(resident), before = JSON.stringify(row), evidence = evidenceFor(resident);
    for (const platform of ['desktop', 'quest'] as const) {
      const presentation = resolvePopulationPresentation(row), qualification = qualifyPopulationMotion(row, presentation, site(platform), evidence, platform);
      assert.equal(qualification.presentable, true, `${id}/${platform}: ${qualification.reason}`);
      const availability = describeVillageResidentAvailability(row, presentation, qualification);
      assert.equal(availability.body, 'qualified'); assert.deepEqual(availability.position, row.position);
      assert.equal(availability.bodyReady, false); assert.equal(availability.drawnFrame, null);
      assert.match(residentFollowAvailabilityText(availability)!, /still preparing/);
    }
    assert.equal(JSON.stringify(row), before);
  }
});

test('a thatcher point, indoor intention and mismatched source never promise a qualified figure', () => {
  const resident = POP.residents.find(row => row.id === 'ealdholt-thatcher')!;
  const row = state(resident, { activity: 'Patches a roof with fresh thatch.', moving: false, status: 'at-place', workPoseQualified: false });
  const presentation = resolvePopulationPresentation(row), availability = describeVillageResidentAvailability(row, presentation,
    qualifyPopulationMotion(row, presentation, site('desktop'), null, 'desktop'));
  assert.equal(availability.body, 'held'); assert.deepEqual(availability.position, row.position);
  assert.match(residentFollowAvailabilityText(availability)!, /location is known, but their figure is unavailable/);
  const indoor = { ...row, reason: 'activity-indoors' as const, navigationStatus: 'indoors', presentable: false, position: null };
  const insidePlan = resolvePopulationPresentation(indoor);
  const inside = describeVillageResidentAvailability(indoor, insidePlan, qualifyPopulationMotion(indoor, insidePlan, site('desktop'), null, 'desktop'));
  assert.equal(inside.body, 'held'); assert.equal(inside.position, null); assert.match(residentFollowAvailabilityText(inside)!, /not placed/);
  const walking = state(resident), walkingPlan = resolvePopulationPresentation(walking);
  const wrongSource = qualifyPopulationMotion(walking, walkingPlan, site('desktop'), null, 'desktop', { profile: 'desktop', sha256: 'b'.repeat(64) });
  assert.equal(wrongSource.reason, 'motion-site-unavailable');
  const mismatched = describeVillageResidentAvailability(walking, walkingPlan, wrongSource);
  assert.equal(mismatched.body, 'held'); assert.equal(mismatched.position, null);
});

test('pending, unknown, qualified and current-frame submissions remain separate facts', () => {
  assert.equal(pendingVillageResidentAvailability('ealdholt-thatcher').body, 'pending');
  assert.equal(pendingVillageResidentAvailability('not-a-registered-resident').body, 'unknown');
  const resident = POP.residents.find(row => row.id === 'ealdholt-house-messenger')!, row = state(resident), plan = resolvePopulationPresentation(row);
  const qualified = describeVillageResidentAvailability(row, plan, qualifyPopulationMotion(row, plan, site('desktop'), evidenceFor(resident), 'desktop'));
  assert.equal(describeVillageResidentAvailability({ ...row, residentId: 'not-a-registered-resident' }, plan, { presentable: false, reason: 'motion-resident-evidence-missing' }).body, 'unknown');
  assert.equal(presentedVillageResidentAvailability(qualified, true, 7, 8).drawnFrame, null, 'a previous frame cannot claim the current frame');
  assert.equal(presentedVillageResidentAvailability(qualified, false, 8, 8).drawnFrame, null, 'selection cannot stand in for a loaded body');
  assert.equal(presentedVillageResidentAvailability(qualified, true, 8, null).drawnFrame, null, 'unknown renderer state cannot certify a draw');
  assert.match(residentFollowAvailabilityText(presentedVillageResidentAvailability(qualified, true, 8, null))!, /not yet confirmed/);
  assert.equal(presentedVillageResidentAvailability(qualified, true, -1, -1).drawnFrame, null, 'an invalid frame is unknown');
  assert.equal(presentedVillageResidentAvailability(qualified, true, 8, 8).drawnFrame, 8);
  assert.equal(residentFollowAvailabilityText(presentedVillageResidentAvailability(qualified, true, 8, 8)), null);
  const held = { ...qualified, body: 'held' as const, reason: 'motion-evidence-unavailable' };
  assert.equal(presentedVillageResidentAvailability(held, true, 8, 8).drawnFrame, null);
});

test('availability leaves raid/away wording and canonical activity untouched', () => {
  const resident = POP.residents.find(row => row.id === 'ealdholt-house-messenger')!, row = state(resident), before = JSON.stringify(row);
  for (const overlay of [{ residentId: row.residentId, activity: 'Shelters from the raiders.', scheduledPlaceId: row.scheduledPlaceId, slotIndex: row.slotIndex, alarm: true },
    { residentId: row.residentId, activity: 'Travels to the market.', scheduledPlaceId: row.scheduledPlaceId, slotIndex: row.slotIndex, away: true }]) {
    assert.equal(displayPopulationActivity(row, overlay), overlay.activity);
    const plan = resolvePopulationPresentation(row);
    describeVillageResidentAvailability(row, plan, qualifyPopulationMotion(row, plan, site('desktop'), null, 'desktop'));
    assert.equal(displayPopulationActivity(row, overlay), overlay.activity);
  }
  assert.equal(JSON.stringify(row), before);
});

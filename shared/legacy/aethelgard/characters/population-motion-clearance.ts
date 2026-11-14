import {scopedVillageEmergencyNeutralReturnSite,findVillageEmergencyNeutralReturn} from './village-emergency-neutral-return';
/** CPU-sampled, source-byte-bound motion budget gate shared by both presenters.
 * A pass says the published samples fit the certified site's proxy budget. It
 * does not certify continuous skin collision, contacts between sample times,
 * the foot band below a lifted nav capsule, crowd separation or crossfades.
 * Callers must keep crossfades off and withhold unqualified fixed workstations.
 * No asset loading, simulation, saved-state mutation or fallback clip selection.
 */
import { EALDHOLT_POPULATION_ASSET_SHA256 } from './population-asset-integrity';
import { EALDHOLT_VILLAGE_POPULATION } from './village-population';
import { getPopulationArt, type PopulationArtEntry, type PopulationArtLevelId, type PopulationArtPlatform } from './village-population-art';
import { getHouseholdArtSet } from './household-art-sets';
import { isWalkLikeClip } from './crowd-binding';
import { resolvePopulationPresentation, type PopulationPresentation } from './village-activity-presentation';
import type { VillagePopulationResidentState } from './village-population-runtime';
import type { VillageSiteLayout } from './village-site';
import {validateVillageSiteEmergencyTraversals} from './village-emergency-traversal';
import {scopedVillageEmergencyRefugeSite,validateVillageSiteEmergencyRefuges,requiredVillageRefugeMotionClips} from './village-emergency-refuges';
import { qualifyGuardWatchMotion } from './guard-watch-dwell';
import {findVillageWorkplaceRoute,requiredVillageWorkplaceMotionClips,scopedVillageWorkplaceRouteSite} from './village-workplace-routes';

/** Existing presentation floor band. Contact/workstation proofs retain their
 * own tighter limits; ordinary refuge locomotion uses this same neutral band. */
export const POPULATION_NEUTRAL_MINIMUM_BODY_Y_METRES=-.03;

export interface PopulationMotionClipEvidence {
  /** Already includes the evidence's 5 cm padding, at the resident placement scale. */
  readonly radiusMetres: number;
  readonly heightMetres: number;
  readonly minimumBodyYMetres: number;
  readonly placedBelowGround: boolean;
}
export interface PopulationMotionLevelEvidence {
  /** Raw-byte identities, relative to the shared characters asset root. */
  readonly files: Readonly<Record<string, string>>;
  readonly clips: Readonly<Record<string, PopulationMotionClipEvidence>>;
}
export interface PopulationMotionEvidence {
  readonly schemaVersion: 1;
  readonly method: 'cpu-sampled-skin-and-props-v1';
  readonly fps: 60;
  readonly paddingMetres: 0.05;
  readonly residents: Readonly<Record<string, {
    readonly levels: Readonly<Partial<Record<PopulationArtLevelId, PopulationMotionLevelEvidence>>>;
  }>>;
}
export interface PopulationMotionQualification {
  readonly presentable: boolean;
  readonly reason: string | null;
}
const trusted = new WeakSet<object>();
const PREFIX = 'aethelgard/characters/';
const LEVELS: readonly PopulationArtLevelId[] = ['crowd', 'desktop-lod0', 'desktop-lod1', 'quest'];
const CLIP_NAME = /^[a-z][a-z0-9_]{0,127}$/;
const residents = new Map(EALDHOLT_VILLAGE_POPULATION.residents.map(row => [row.id, row] as const));
/** Exact names read from the six pinned published GLBs. The older population
 * declarations omit newer transitions and support clips. Tests check this
 * snapshot against the actual byte-bound libraries, never an inferred suffix. */
const PUBLISHED_CROWD_CLIPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "adolescent": Object.freeze(["walk","idle","idle_b","walk_b","walk_c","walk_start","walk_stop","walk_b_start","walk_b_stop","walk_c_start","walk_c_stop","talk","talk_b","look_around","sit_down","sit","stand_up","work_write","work_write_enter","work_write_exit","work_read","work_read_enter","work_read_exit","carry_bundle_walk","work_grind_herbs","work_grind_herbs_enter","work_grind_herbs_exit","work_gather_herbs","work_gather_herbs_enter","work_gather_herbs_exit","carry_basket_walk","work_cobble","work_cobble_enter","work_cobble_exit","work_chisel","work_chisel_enter","work_chisel_exit","carry_sack_walk","work_sweep","work_sweep_enter","work_sweep_exit","work_saw","work_saw_enter","work_saw_exit","work_card_wool","work_card_wool_enter","work_card_wool_exit","work_weave","work_weave_enter","work_weave_exit","work_hoe","work_hoe_enter","work_hoe_exit","work_sow","work_reap","work_reap_enter","work_reap_exit"]),
  "adult-female": Object.freeze(["walk","idle","idle_b","walk_b","walk_c","walk_start","walk_stop","walk_b_start","walk_b_stop","walk_c_start","walk_c_stop","talk","talk_b","look_around","sit_down","sit","stand_up","work_stir","work_stir_enter","work_stir_exit","work_knead","work_knead_enter","work_knead_exit","carry_basket_walk","work_milk","work_milk_enter","work_milk_exit","work_churn","work_churn_enter","work_churn_exit","carry_yoke_walk","work_sell","work_sell_enter","work_sell_exit","work_sweep","work_sweep_enter","work_sweep_exit","work_dig","work_dig_enter","work_dig_exit","work_weave","work_weave_enter","work_weave_exit","work_card_wool","work_card_wool_enter","work_card_wool_exit","work_grind_herbs","work_grind_herbs_enter","work_grind_herbs_exit","work_gather_herbs","work_gather_herbs_enter","work_gather_herbs_exit","carry_bundle_walk","work_oven_peel","work_oven_peel_enter","work_oven_peel_exit","carry_bucket_walk","work_throw_pot","work_throw_pot_enter","work_throw_pot_exit","work_scatter_feed","work_scatter_feed_enter","work_scatter_feed_exit","work_herd","work_herd_enter","work_herd_exit","work_hoe","work_hoe_enter","work_hoe_exit","work_sow","work_reap","work_reap_enter","work_reap_exit","carry_sack_walk","work_twist_rope","work_twist_rope_enter","work_twist_rope_exit","work_mend_seated","work_mend_seated_enter","work_mend_seated_exit","guard_lookout","guard_lookout_enter","guard_lookout_exit","guard_patrol_walk","work_weave_basket","work_weave_basket_enter","work_weave_basket_exit","work_address","work_address_enter","work_address_exit","work_stitch_leather","work_stitch_leather_enter","work_stitch_leather_exit","work_dip_candles","work_dip_candles_enter","work_dip_candles_exit","work_shell_peas","work_shell_peas_enter","work_shell_peas_exit","work_wash_linen","work_wash_linen_enter","work_wash_linen_exit"]),
  "adult-male": Object.freeze(["walk","idle","idle_b","walk_b","walk_c","walk_crutch","walk_start","walk_stop","walk_b_start","walk_b_stop","walk_c_start","walk_c_stop","talk","talk_b","look_around","sit_down","sit","stand_up","work_tally","work_tally_enter","work_tally_exit","work_address","work_address_enter","work_address_exit","work_read","work_read_enter","work_read_exit","work_sweep","work_sweep_enter","work_sweep_exit","carry_bundle_walk","carry_bucket_walk","work_address_b","work_address_b_enter","work_address_b_exit","work_hoe","work_hoe_enter","work_hoe_exit","work_sow","work_reap","work_reap_enter","work_reap_exit","carry_sack_walk","work_pray","work_pray_enter","work_pray_exit","work_write","work_write_enter","work_write_exit","work_bundle_straw","work_bundle_straw_enter","work_bundle_straw_exit","work_cobble","work_cobble_enter","work_cobble_exit","work_hammer_bench","work_hammer_bench_enter","work_hammer_bench_exit","work_chisel","work_chisel_enter","work_chisel_exit","guard_stand_watch_b","guard_stand_watch_b_enter","guard_stand_watch_b_exit","guard_patrol_walk","guard_stand_watch_c","guard_stand_watch_c_enter","guard_stand_watch_c_exit","guard_stand_watch","guard_stand_watch_enter","guard_stand_watch_exit","guard_challenge","guard_stand_watch_d","guard_stand_watch_d_enter","guard_stand_watch_d_exit","guard_lookout","guard_lookout_enter","guard_lookout_exit","work_fletch","work_fletch_enter","work_fletch_exit","work_tend_mill","work_tend_mill_enter","work_tend_mill_exit","work_saw","work_saw_enter","work_saw_exit","work_plane","work_plane_enter","work_plane_exit","work_mend_seated","work_mend_seated_enter","work_mend_seated_exit","work_tread_cloth","work_tread_cloth_enter","work_tread_cloth_exit","work_scrape_hide","work_scrape_hide_enter","work_scrape_hide_exit","work_herd","work_herd_enter","work_herd_exit","work_prune","work_prune_enter","work_prune_exit","carry_basket_walk","work_chop_block","work_chop_block_enter","work_chop_block_exit","work_chop_wood","work_chop_wood_enter","work_chop_wood_exit"]),
  "child": Object.freeze(["walk","idle","idle_b","walk_b","walk_c","run","walk_start","walk_stop","walk_b_start","walk_b_stop","walk_c_start","walk_c_stop","talk","talk_b","look_around","sit_down","sit","stand_up","play_chase","play_chase_enter","play_chase_exit","play_toss","play_toss_enter","play_toss_exit","fetch_carry","crouch_gather","crouch_gather_enter","crouch_gather_exit","play_chase_b","play_tag","play_tag_enter","play_tag_exit","play_hop","play_hop_enter","play_hop_exit","play_skip","play_skip_enter","play_skip_exit"]),
  "elder-female": Object.freeze(["walk","idle","idle_b","walk_b","walk_c","walk_stick","walk_start","walk_stop","walk_b_start","walk_b_stop","walk_c_start","walk_c_stop","talk","talk_b","look_around","sit_down","sit","stand_up","idle_stick","walk_stick_start","walk_stick_stop","talk_stick","look_around_stick","work_shell_peas","work_shell_peas_enter","work_shell_peas_exit","carry_bundle_walk","work_spin_distaff","work_spin_distaff_enter","work_spin_distaff_exit","work_card_wool","work_card_wool_enter","work_card_wool_exit"]),
  "elder-male": Object.freeze(["walk","idle","idle_b","walk_b","walk_c","walk_stick","walk_start","walk_stop","walk_b_start","walk_b_stop","walk_c_start","walk_c_stop","talk","talk_b","look_around","sit_down","sit","stand_up","idle_stick","walk_stick_start","walk_stick_stop","talk_stick","look_around_stick","work_mend_seated","work_mend_seated_enter","work_mend_seated_exit","carry_basket_walk","work_whittle","work_whittle_enter","work_whittle_exit","work_herd","work_herd_enter","work_herd_exit"]),
});
const libraries = new Map(EALDHOLT_VILLAGE_POPULATION.clipLibraries.map(row =>
  [row.archetype, new Set(PUBLISHED_CROWD_CLIPS[row.archetype] ?? [])] as const));
const relative = (path: string): string => path.startsWith(PREFIX) ? path.slice(PREFIX.length) : path;
const held = (reason: string): PopulationMotionQualification => ({ presentable: false, reason });
// Per-clip metadata can add a stool or workplace kit not listed by art.props.
// Bind the entire small published kit set rather than guessing which it uses.
const CROWD_PROP_SOURCES = Object.keys(EALDHOLT_POPULATION_ASSET_SHA256).filter(path => /^crowd-v1\/props\/[^/]+\.glb$/.test(path));

/** Plain own data only: no accessors, inherited records, symbols or JSON hooks. */
function record(value: unknown, allowed?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) {
    throw Error('Population motion evidence needs plain records.');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value), out: Record<string, unknown> = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !('value' in descriptor) || ['__proto__', 'constructor', 'prototype'].includes(key)
      || allowed && !allowed.includes(key)) throw Error(`Invalid population motion evidence field: ${key}.`);
    out[key] = descriptor.value;
  }
  if (allowed && (Object.keys(out).length !== allowed.length || allowed.some(key => !(key in out)))) {
    throw Error('Population motion evidence is missing required fields.');
  }
  return out;
}
function finite(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw Error('Population motion evidence has an invalid measured bound.');
  }
  return value;
}
function availableNames(art: PopulationArtEntry): ReadonlySet<string> {
  const household = getHouseholdArtSet(art.residentId);
  return household ? new Set([household.actorMotions.idle, household.actorMotions.walk, household.actorMotions.talk,
    household.actorMotions.work, ...(household.actorMotions.sit ? [household.actorMotions.sit] : []),
    ...Object.values(household.actorMotions.extra), household.workTransitions.enter, household.workTransitions.exit])
    : libraries.get(art.archetype) ?? new Set();
}

/** Throws on malformed or mismatched evidence. Missing residents/levels/clips or
 * source file identities remain partial evidence and are held by the qualifier.
 * This validates caller-supplied measurements; it is not a cryptographic proof
 * that a caller actually performed the declared sampling method. */
export function parsePopulationMotionEvidence(value: unknown): PopulationMotionEvidence {
  const root = record(value, ['schemaVersion', 'method', 'fps', 'paddingMetres', 'residents']);
  if (root.schemaVersion !== 1 || root.method !== 'cpu-sampled-skin-and-props-v1' || root.fps !== 60 || root.paddingMetres !== .05) {
    throw Error('Unsupported population motion evidence method or version.');
  }
  const inputResidents = record(root.residents), output: Record<string, { levels: Partial<Record<PopulationArtLevelId, PopulationMotionLevelEvidence>> }> = Object.create(null);
  if (Object.keys(inputResidents).length > 100) throw Error('Population motion evidence exceeds its resident budget.');
  let clipCount = 0;
  for (const [residentId, rawResident] of Object.entries(inputResidents)) {
    const art = getPopulationArt(residentId);
    if (!art || !residents.has(residentId)) throw Error(`Unregistered motion-evidence resident: ${residentId}.`);
    const rawLevels = record(record(rawResident, ['levels']).levels), levels: Partial<Record<PopulationArtLevelId, PopulationMotionLevelEvidence>> = Object.create(null);
    if (Object.keys(rawLevels).length > 4) throw Error('Population motion evidence exceeds its level budget.');
    const names = availableNames(art);
    for (const [levelName, rawLevel] of Object.entries(rawLevels)) {
      if (!LEVELS.includes(levelName as PopulationArtLevelId) || !art.levels.some(level => level.level === levelName)) {
        throw Error(`Unregistered motion-evidence level: ${residentId}/${levelName}.`);
      }
      const artLevel = art.levels.find(level => level.level === levelName)!;
      if (EALDHOLT_POPULATION_ASSET_SHA256[relative(artLevel.path)] !== artLevel.sha256
        || art.clipLibrary && EALDHOLT_POPULATION_ASSET_SHA256[relative(art.clipLibrary.path)] !== art.clipLibrary.sha256) {
        throw Error(`Population art registry and canonical byte identities disagree: ${residentId}/${levelName}.`);
      }
      const data = record(rawLevel, ['files', 'clips']), inputFiles = record(data.files), files: Record<string, string> = Object.create(null);
      if (Object.keys(inputFiles).length > 256) throw Error('Population motion evidence exceeds its file budget.');
      for (const [path, hash] of Object.entries(inputFiles)) {
        if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || !Object.hasOwnProperty.call(EALDHOLT_POPULATION_ASSET_SHA256, path)
          || EALDHOLT_POPULATION_ASSET_SHA256[path] !== hash) throw Error(`Population motion source identity mismatch: ${path}.`);
        files[path] = hash;
      }
      const rawClips = record(data.clips), clips: Record<string, PopulationMotionClipEvidence> = Object.create(null);
      if (Object.keys(rawClips).length > 2048) throw Error('Population motion evidence exceeds its per-level clip budget.');
      for (const [name, rawClip] of Object.entries(rawClips)) {
        if (++clipCount > 150000 || !CLIP_NAME.test(name) || !names.has(name)) throw Error(`Invalid motion-evidence clip: ${residentId}/${name}.`);
        const clip = record(rawClip, ['radiusMetres', 'heightMetres', 'minimumBodyYMetres', 'placedBelowGround']);
        if (typeof clip.placedBelowGround !== 'boolean') throw Error('Population motion evidence needs an explicit placed-prop floor result.');
        clips[name] = Object.freeze({ radiusMetres: finite(clip.radiusMetres, 0, 100), heightMetres: finite(clip.heightMetres, .001, 100),
          minimumBodyYMetres: finite(clip.minimumBodyYMetres, -100, 100), placedBelowGround: clip.placedBelowGround });
      }
      levels[levelName as PopulationArtLevelId] = Object.freeze({ files: Object.freeze(files), clips: Object.freeze(clips) });
    }
    output[residentId] = Object.freeze({ levels: Object.freeze(levels) });
  }
  const result: PopulationMotionEvidence = Object.freeze({ schemaVersion: 1, method: 'cpu-sampled-skin-and-props-v1', fps: 60,
    paddingMetres: .05, residents: Object.freeze(output) });
  trusted.add(result);
  return result;
}

function requiredFiles(art: PopulationArtEntry, levelName: PopulationArtLevelId): readonly string[] {
  const level = art.levels.find(candidate => candidate.level === levelName);
  if (!level) return [];
  const paths = new Set([relative(level.path), relative(art.manifest)]);
  if (art.kind === 'crowd') {
    if (art.clipLibrary) paths.add(relative(art.clipLibrary.path));
    paths.add('crowd-v1/clips/manifest.json');
    for (const prop of art.props) paths.add(relative(prop.file));
    for (const path of CROWD_PROP_SOURCES) paths.add(path);
    paths.add('crowd-v1/props/kits.json');
  } else if (art.propsFiles) paths.add(relative(levelName === 'quest' ? art.propsFiles.quest : art.propsFiles.desktop));
  return [...paths];
}

export {requiredFiles as requiredPopulationMotionFiles,availableNames as availablePopulationMotionClipNames};

/** Exact clips reachable for the resolved motion, including one-shot transitions
 * and their authored terminal pose. Unrelated loaded work clips do not gate a
 * safe walk; an unsafe work/carry never falls back to idle. */
function requiredClips(art: PopulationArtEntry, presentation: PopulationPresentation): readonly string[] | null {
  const household = getHouseholdArtSet(art.residentId), names = availableNames(art), clips = new Set<string>();
  const motion = presentation.motion, role = presentation.activity.roleClip ?? null;
  const add = (name: string | null | undefined): void => { if (name) clips.add(name); };
  const optional = (name: string): void => { if (names.has(name)) add(name); };
  if (!motion) return null;
  add(household?.actorMotions.idle ?? art.motions.idle);
  if (household) {
    if (role && role !== household.actorMotions.work) return null;
    if (motion === 'work' || motion === 'workEnter' || motion === 'workExit') {
      add(household.actorMotions.work); add(household.workTransitions.enter); add(household.workTransitions.exit);
      if (household.workTransitions.from === 'sit') {
        add(household.actorMotions.sit); add(household.actorMotions.extra.sitDown); add(household.actorMotions.extra.standUp);
      }
    } else if (motion === 'walk' || motion === 'start' || motion === 'stop') {
      add(household.actorMotions.walk); add(household.actorMotions.extra.start); add(household.actorMotions.extra.stop);
    } else if (motion === 'sit' || motion === 'sitDown' || motion === 'standUp') {
      if (!household.actorMotions.sit) return null;
      add(household.actorMotions.sit); add(household.actorMotions.extra.sitDown); add(household.actorMotions.extra.standUp);
    } else if (motion === 'talk') add(household.actorMotions.talk);
    else if (motion !== 'idle') return null;
  } else if (motion === 'walk' || motion === 'start' || motion === 'stop') {
    if (role && (!art.motions.roleClips.includes(role) || !isWalkLikeClip(role))) return null;
    const walk = role ?? art.motions.walk;
    add(walk);
    // The shared owner deliberately omits plain start/stop for a carry overlay.
    if (!role || role === art.motions.walk) { optional(`${walk}_start`); optional(`${walk}_stop`); }
  } else if (motion === 'work' || motion === 'workEnter' || motion === 'workExit') {
    if (!role || !art.motions.roleClips.includes(role) || isWalkLikeClip(role)) return null;
    add(role); optional(`${role}_enter`); optional(`${role}_exit`);
    if (presentation.activity.seated) { add('sit'); optional('sit_down'); optional('stand_up'); }
  } else if (motion === 'sit' || motion === 'sitDown' || motion === 'standUp') {
    add('sit'); optional('sit_down'); optional('stand_up');
  } else if (motion === 'talk') add(art.motions.talk);
  else if (motion !== 'idle') return null;
  return [...clips];
}

/** Synchronous budget check, safe for sampled presentation cadence. The evidence
 * must come from the parser. This never turns an unavailable role into idle and
 * does not override the separate source-navigation/crowd/animation gates. */
export function qualifyPopulationMotion(state: VillagePopulationResidentState, presentation: PopulationPresentation,
  site: VillageSiteLayout | null, evidence: PopulationMotionEvidence | null,
  platform: PopulationArtPlatform,
  sourceIdentity?: { readonly profile: VillageSiteLayout['profile']; readonly sha256: string }): PopulationMotionQualification {
  if (!state.presentable || !presentation.presentable || !presentation.motion) return held('motion-presentation-held');
  const authored = resolvePopulationPresentation(state);
  if (!authored.presentable || authored.motion !== presentation.motion
    || authored.waitingForResource !== presentation.waitingForResource
    || authored.waitingForRoute !== presentation.waitingForRoute
    || authored.pausingAtDestination !== presentation.pausingAtDestination
    || authored.guardWatch !== presentation.guardWatch || !!authored.activity.guardWatch !== !!presentation.activity.guardWatch
    || authored.animationTimeSeconds !== presentation.animationTimeSeconds || authored.animationTimeMode !== presentation.animationTimeMode || authored.fadeSeconds !== presentation.fadeSeconds
    || (authored.activity.roleClip ?? null) !== (presentation.activity.roleClip ?? null)
    || !!authored.activity.seated !== !!presentation.activity.seated) return held('motion-presentation-mismatch');
  // The Desktop Low renderer can load the compact Quest-source village. Its
  // navigation certificate must match that exact source, while its characters
  // still require Desktop animation/envelope evidence. Never confuse the two.
  if (!site || site.profile !== (sourceIdentity?.profile ?? platform)
    || sourceIdentity && site.sourceSha256 !== sourceIdentity.sha256 || site.frame !== 'source-root-local-metres'
    || !Number.isFinite(site.capsule.radius) || site.capsule.radius <= 0
    || !Number.isFinite(site.capsule.height) || site.capsule.height <= 0) return held('motion-site-unavailable');
  if(state.neutralReturnMotion){
    const profile=state.neutralReturnMotion,ref={id:profile.id,certificateSha256:profile.certificateSha256,anchorId:profile.anchorId,placeId:profile.placeId},proof=findVillageEmergencyNeutralReturn(site,ref,state.residentId),scope=scopedVillageEmergencyNeutralReturnSite(site,ref,state.residentId);
    if(!proof||!scope||profile.zeroCrossfade!==true||presentation.fadeSeconds!==0||presentation.motion!=='idle'||presentation.activity.roleClip||presentation.activity.seated||presentation.guardWatch||JSON.stringify([...profile.neutralClips].sort())!==JSON.stringify([...requiredVillageRefugeMotionClips(state.residentId)].sort()))return held('neutral-return-motion-unqualified');
    const actual=evidence&&parsePopulationMotionEvidence(evidence),measured=proof.motionEvidence.residents[state.residentId];
    if(!actual||!measured)return held('neutral-return-evidence-missing');
    for(const[name,level]of Object.entries(measured.levels)){const current=actual.residents[state.residentId]?.levels[name as PopulationArtLevelId];if(!current)return held('neutral-return-level-evidence-missing');for(const[path,sha]of Object.entries(level!.files))if(current.files[path]!==sha)return held('neutral-return-file-evidence-missing');for(const clip of profile.neutralClips)if(JSON.stringify(current.clips[clip])!==JSON.stringify(level!.clips[clip]))return held('neutral-return-clip-evidence-mismatch');}
    site=scope;
  }
  if(state.ordinaryWork){
    const work=state.ordinaryWork,art=getPopulationArt(state.residentId),body=work.body;
    const clipName=work.phase==='face'?work.clip+'_enter':work.phase==='release'?work.clip+'_exit':work.clip,clip=work.clipMeasurements?.[clipName]??(clipName===work.clip?work.clipMeasurement:null);
    if(!art||!work.qualified||!clip||work.source.profile!==site.profile||work.source.sha256!==site.sourceSha256||work.source.siteIdentity!==site.profile+':'+site.sourceSha256+':'+(site.navigationRevision??'source-site')||presentation.fadeSeconds!==0||presentation.activity.roleClip!==work.clip||!['workEnter','work','workExit'].includes(presentation.motion)
      ||!Number.isFinite(body.radius)||!Number.isFinite(body.height)||body.radius<=0||body.height<=0||body.margin!==.005||body.lift!==.02||clip.placedBelowGround||clip.minimumBodyYMetres<-.005||clip.radiusMetres>body.radius||clip.heightMetres>body.height)return held('ordinary-work-motion-contract-mismatch');
    const needed=[relative(art.levels[0].path),relative(art.manifest),...(art.clipLibrary?[relative(art.clipLibrary.path)]:[])];
    if(needed.some(path=>work.files[path]!==EALDHOLT_POPULATION_ASSET_SHA256[path])||Object.entries(work.files).some(([path,sha])=>EALDHOLT_POPULATION_ASSET_SHA256[path]!==sha))return held('ordinary-work-motion-source-missing');
    return{presentable:true,reason:null};
  }
  if(state.workplaceMotion){
    const ref=state.workplaceMotion,cap=findVillageWorkplaceRoute(site,{id:ref.routeId,certificateSha256:ref.certificateSha256},state.residentId);
    if(!cap||ref.zeroCrossfade!==true||presentation.fadeSeconds!==0||!['idle','walk','start','stop'].includes(presentation.motion)||presentation.activity.roleClip||presentation.guardWatch||JSON.stringify([...ref.neutralClips].sort())!==JSON.stringify([...requiredVillageWorkplaceMotionClips(state.residentId)].sort()))return held('ordinary-route-motion-source-mismatch');
    const scope=scopedVillageWorkplaceRouteSite(site,{id:ref.routeId,certificateSha256:ref.certificateSha256,returnPlaceId:ref.returnPlaceId,...(ref.recoveryRefuge?{recoveryRefuge:ref.recoveryRefuge}:{})},state.residentId);
    if(!scope)return held('ordinary-route-motion-source-unavailable');
    const actual=evidence&&parsePopulationMotionEvidence(evidence),measured=cap.proof.motionEvidence.residents[state.residentId];
    if(!actual||!measured)return held('ordinary-route-motion-evidence-missing');
    for(const[name,level]of Object.entries(measured.levels)){const current=actual.residents[state.residentId]?.levels[name as PopulationArtLevelId];if(!current)return held('ordinary-route-level-evidence-missing');
      for(const[path,sha]of Object.entries(level!.files))if(current.files[path]!==sha)return held('ordinary-route-file-evidence-missing');
      for(const clip of ref.neutralClips)if(JSON.stringify(current.clips[clip])!==JSON.stringify(level!.clips[clip]))return held('ordinary-route-clip-evidence-mismatch');
    }
    site=scope;
  }
  let refuges:ReturnType<typeof validateVillageSiteEmergencyRefuges>=[];
  if(state.refugeMotion){
    try{
      if(!state.refugeMotion.certificates)return held('motion-refuge-source-unavailable');
      const scoped=scopedVillageEmergencyRefugeSite(site,{ids:state.refugeMotion.refugeIds,certificates:state.refugeMotion.certificates},state.residentId);
      if(!scoped)return held('motion-refuge-source-unavailable');
      refuges=validateVillageSiteEmergencyRefuges(site).filter(r=>state.refugeMotion!.refugeIds.includes(r.id)&&r.residentId===state.residentId);
      const neutral=requiredVillageRefugeMotionClips(state.residentId);
      if(!refuges.length||state.refugeMotion.zeroCrossfade!==true||presentation.fadeSeconds!==0
        ||!['idle','walk','start','stop'].includes(presentation.motion)||presentation.activity.roleClip||presentation.activity.seated||presentation.guardWatch
        ||JSON.stringify([...state.refugeMotion.neutralClips].sort())!==JSON.stringify([...neutral].sort()))return held('motion-refuge-contract-mismatch');
      site=scoped;
    }catch{return held('motion-refuge-source-unavailable');}
  }
  if (presentation.guardWatch) return qualifyGuardWatchMotion(state.residentId,site,platform);
  if (!evidence || !trusted.has(evidence)) return held('motion-evidence-unavailable');
  const art = getPopulationArt(state.residentId), resident = evidence.residents[state.residentId];
  if (!art || !resident) return held('motion-resident-evidence-missing');
  const locked=state.emergency?.requiredLocomotionClip==='carry_bucket_walk';
  const traversal=locked?validateVillageSiteEmergencyTraversals(site).find(t=>t.id===state.emergency!.traversalId&&t.residentId===state.residentId):null;
  if(locked&&(!traversal||platform!=='desktop'||presentation.motion!=='walk'||presentation.activity.roleClip!==traversal.requiredClip||presentation.fadeSeconds!==0
    ||!state.moving&&(presentation.animationTimeMode!=='seek'||presentation.animationTimeSeconds!==0)))return held('motion-carry-route-contract-mismatch');
  // This source permit certifies only the actual carry loop and fixed frame0.
  // Idle and plain walk start/stop have never been measured for this corridor.
  const clips = traversal?[traversal.requiredClip]:state.workplaceMotion?requiredVillageWorkplaceMotionClips(state.residentId):refuges.length?requiredVillageRefugeMotionClips(state.residentId):requiredClips(art, presentation);
  if (!clips) return held('motion-plan-unavailable');
  const levels: readonly PopulationArtLevelId[] = art.kind === 'crowd' ? ['crowd']
    : platform === 'quest' ? ['quest'] : ['desktop-lod0', 'desktop-lod1'];
  for (const levelName of levels) {
    const level = resident.levels[levelName];
    if (!level) return held(`motion-level-evidence-missing:${levelName}`);
    const files = requiredFiles(art, levelName);
    if (!files.length) return held(`motion-art-level-unavailable:${levelName}`);
    for (const path of files) if (!level.files[path] || level.files[path] !== EALDHOLT_POPULATION_ASSET_SHA256[path]) {
      return held(`motion-source-evidence-missing:${levelName}:${path}`);
    }
    if(traversal)for(const [path,sha]of Object.entries(traversal.files))if(level.files[path]!==sha)return held(`motion-carry-route-source-missing:${path}`);
    for(const refuge of refuges){
      const measured=refuge.proof.motionEvidence.residents[state.residentId]?.levels[levelName];
      if(!measured)return held(`motion-refuge-level-missing:${levelName}`);
      for(const [path,sha]of Object.entries(measured.files))if(level.files[path]!==sha)return held(`motion-refuge-source-missing:${path}`);
      for(const name of clips){const actual=level.clips[name],expected=measured.clips[name];
        if(!actual||!expected||actual.radiusMetres!==expected.radiusMetres||actual.heightMetres!==expected.heightMetres||actual.minimumBodyYMetres!==expected.minimumBodyYMetres||actual.placedBelowGround!==expected.placedBelowGround)return held(`motion-refuge-clip-mismatch:${levelName}:${name}`);
      }
    }
    for (const name of clips) {
      const clip = level.clips[name];
      if (!clip) return held(`motion-clip-evidence-missing:${levelName}:${name}`);
      if (clip.placedBelowGround || clip.minimumBodyYMetres < POPULATION_NEUTRAL_MINIMUM_BODY_Y_METRES) return held(`motion-floor-unqualified:${levelName}:${name}`);
      if(traversal&&(clip.radiusMetres>traversal.body.radius-.05+1e-9||clip.heightMetres>traversal.body.height-.05+1e-9))return held(`motion-carry-route-body-exceeded:${name}`);
      if (clip.radiusMetres > site.capsule.radius || clip.heightMetres > site.capsule.height) {
        return held(`motion-proxy-budget-exceeded:${levelName}:${name}`);
      }
    }
  }
  return { presentable: true, reason: null };
}

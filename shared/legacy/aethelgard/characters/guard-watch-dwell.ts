import type { VillagePopulationResidentState } from './village-population-runtime';
import { PUBLISHED_GUARD_WATCH } from './guard-watch-published';
import { EALDHOLT_POPULATION_ASSET_SHA256 } from './population-asset-integrity';
import type { CrowdResidentMeta } from './crowd-binding';
import type { VillageSiteLayout } from './village-site';

export const GUARD_WATCH_LOOP = 'guard_stand_watch_d';
export const GUARD_WATCH_WALK = 'guard_patrol_walk';
export const GUARD_WATCH_ENTER = 'guard_stand_watch_d_compact_enter_v1';
export const GUARD_WATCH_EXIT = 'guard_stand_watch_d_compact_exit_v1';
export const GUARD_WATCH_HELPER = 'guard_watch_spear_pose';
export const GUARD_WATCH_TRANSPORTS: Readonly<Record<string,string>> = Object.freeze({
  [GUARD_WATCH_WALK]: 'guard_patrol_walk_spear_pose_v1',
  [GUARD_WATCH_LOOP]: 'guard_stand_watch_d_spear_pose_v1',
});

/** A published, measured art capability, never an occupation/AI exception. Only
 * the exact body and its actual existing kit can use these authored clips. */
export function publishedGuardWatch(residentId: string) {
  const spec = PUBLISHED_GUARD_WATCH;
  if(!spec||spec.version!==1||spec.residentId!==residentId)return null;
  const required=[`crowd-v1/residents/${residentId}.glb`,`crowd-v1/residents/${residentId}.json`,
    'crowd-v1/clips/crowd-clips-adult-male-v1.glb','crowd-v1/props/crowd-props-guard-v1.glb',spec.file];
  return /^crowd-v1\/addons\/[a-z0-9-]+\/[a-z0-9-]+\.glb$/.test(spec.file)
    && required.every(path=>!!spec.sources[path]) && Object.entries(spec.sources).every(([path,hash]) =>
    EALDHOLT_POPULATION_ASSET_SHA256[path] === hash) ? spec : null;
}

/** Derived presentation metadata, after exact base/addon/kit bytes have verified.
 * A single original spear stays on its keyed helper through all four motions;
 * old role/body tracks and on-disk resident metadata are never rewritten. */
export function guardWatchCrowdMeta(meta: CrowdResidentMeta): CrowdResidentMeta {
  const spec=publishedGuardWatch(meta.residentId);
  if (!spec || !meta.presentation
    || !meta.motion.roleClips.includes(GUARD_WATCH_LOOP) || !meta.motion.roleClips.includes(GUARD_WATCH_WALK))
    throw Error('The published guard addon requires its actual owned watch, walk and spear presentation.');
  const clips = { ...meta.presentation.clips };
  for (const name of [GUARD_WATCH_WALK, GUARD_WATCH_LOOP, GUARD_WATCH_ENTER, GUARD_WATCH_EXIT]) {
    const original = clips[name === GUARD_WATCH_ENTER || name === GUARD_WATCH_EXIT ? GUARD_WATCH_LOOP : name];
    if (!original || original.held.length !== 1 || original.held[0].prop !== 'spear' || original.held[0].node !== 'prop_spear'
      || original.placed.length) throw Error('The guard transition may use only its actual existing held spear.');
    clips[name] = Object.freeze({ ...original, held: Object.freeze([Object.freeze({ ...original.held[0], bone: GUARD_WATCH_HELPER,
      matrix: Object.freeze([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]) })]) });
  }
  const byClip={...meta.envelopes?.byClip};
  for(const name of [GUARD_WATCH_WALK,GUARD_WATCH_LOOP,GUARD_WATCH_ENTER,GUARD_WATCH_EXIT]){
    const proofs=[spec.measurements.desktop.clips[name],spec.measurements.quest.clips[name]];
    if(proofs.some(p=>!p))throw Error('Both actual platforms must measure the published guard clip.');
    // Measurements include placement scale and real held geometry. The actor
    // owner's precomputed boxes use unplaced model metres; retain the 5cm pad.
    const r=Math.max(...proofs.map(p=>p.radiusMetres))/meta.placementScale;
    const top=Math.max(...proofs.map(p=>p.heightMetres))/meta.placementScale;
    const bottom=(Math.min(...proofs.flatMap(p=>[p.minimumBodyYMetres,p.minimumPropYMetres]))-.05)/meta.placementScale;
    byClip[name]=Object.freeze({min:Object.freeze([-r,bottom,-r]) as readonly[number,number,number],
      max:Object.freeze([r,top,r]) as readonly[number,number,number]});
  }
  return Object.freeze({ ...meta, presentation: Object.freeze({ ...meta.presentation, clips: Object.freeze(clips) }),
    envelopes:Object.freeze({byClip:Object.freeze(byClip),gated:meta.envelopes?.gated===true}) });
}

export function planGuardWatchDwell(state: VillagePopulationResidentState): {
  readonly motion: 'workEnter'|'work'|'workExit'; readonly animationTimeSeconds: number; readonly fadeSeconds: number;
} | null {
  const spec = publishedGuardWatch(state.residentId), dwell = state.patrolDwell;
  if (!spec || !isCertifiedPatrolDwell(state) || !dwell) return null;
  return selectGuardWatchPhase(dwell.elapsedSeconds,dwell.durationSeconds,spec.seconds,spec.fadeSeconds);
}

/** World-clock presentation only. No new patrol/work completion or timeout can
 * result from selecting a clip phase, including paused/offscreen restoration. */
export function selectGuardWatchPhase(elapsed:number,duration:number,transition:number,fade:number):
  {readonly motion:'workEnter'|'work'|'workExit';readonly animationTimeSeconds:number;readonly fadeSeconds:number}|null{
  if(![elapsed,duration,transition,fade].every(Number.isFinite)||elapsed<0||elapsed>=duration||transition<=0||fade<0||fade>.25
    ||duration<2*transition+.25)return null;
  if(elapsed<transition)return{motion:'workEnter',animationTimeSeconds:elapsed,fadeSeconds:fade};
  if(elapsed>=duration-transition)return{motion:'workExit',animationTimeSeconds:elapsed-duration+transition,fadeSeconds:fade};
  return{motion:'work',animationTimeSeconds:elapsed-transition,fadeSeconds:fade};
}

/** Separate addon proof: old unsafe transitions are never waived. These bounds
 * include actual skin and the one held spear through every measured blend. */
export function qualifyGuardWatchMotion(residentId: string, site: VillageSiteLayout, platform: 'desktop'|'quest'):
  { readonly presentable: boolean; readonly reason: string|null } {
  const spec=publishedGuardWatch(residentId), proof=spec?.measurements[platform];
  if(!spec||!proof||proof.fps!==60||proof.includesActualSkinAndHeldSpear!==true
    ||!Number.isFinite(spec.seconds)||spec.seconds<=0||!Number.isFinite(spec.fadeSeconds)||spec.fadeSeconds<0||spec.fadeSeconds>.25
    ||!Number.isFinite(proof.maximumHandGapMetres)||proof.maximumHandGapMetres<0||proof.maximumHandGapMetres>.03
    ||!Number.isFinite(proof.maximumGripAngleDegrees)||proof.maximumGripAngleDegrees<0||proof.maximumGripAngleDegrees>3)
    return {presentable:false,reason:'guard-watch-measurement-unavailable'};
  if(!Number.isFinite(proof.maximumFootCorrectionMetres)||proof.maximumFootCorrectionMetres<0||proof.maximumFootCorrectionMetres>.12)
    return {presentable:false,reason:'guard-watch-grounding-unqualified'};
  const bounds=[proof.blends,...[GUARD_WATCH_WALK,GUARD_WATCH_LOOP,GUARD_WATCH_ENTER,GUARD_WATCH_EXIT].map(name=>proof.clips[name])];
  for(const b of bounds){
    if(!b||![b.radiusMetres,b.heightMetres,b.minimumBodyYMetres,b.minimumPropYMetres].every(Number.isFinite)
      ||b.radiusMetres<=0||b.heightMetres<=0)return {presentable:false,reason:'guard-watch-bounds-unavailable'};
    if(b.minimumBodyYMetres<-.03||b.minimumPropYMetres<-.03)return {presentable:false,reason:'guard-watch-floor-unqualified'};
    if(b.radiusMetres>site.capsule.radius||b.heightMetres>site.capsule.height)return {presentable:false,reason:'guard-watch-proxy-budget-exceeded'};
  }
  return {presentable:true,reason:null};
}

/** State agreement only: this is never permission to render a guard or attach a
 * weapon. Source ownership, peers, published clips and the measured full-body
 * and held-prop transition envelope must independently qualify the pose. */
export function isCertifiedPatrolDwell(state: VillagePopulationResidentState): boolean {
  const patrol = state.patrol, intent = state.lifeIntent;
  const dwell = state.patrolDwell;
  return !!patrol && patrol.phase === 'dwelling' && !!dwell
    && Number.isFinite(dwell.elapsedSeconds) && Number.isFinite(dwell.durationSeconds)
    && dwell.elapsedSeconds >= 0 && dwell.elapsedSeconds < dwell.durationSeconds && state.presentable && state.status==='at-place'
    && state.reason===null && state.lifeStatus==='active' && state.workPoseQualified===false && !state.moving
    && state.navigationStatus === 'at-threshold' && state.navigationReason === null
    && state.placeId === patrol.waypointPlaceId && state.arrivalEvidence === 'certified-route-arrival'
    && state.arrivedAtAbsoluteMinute != null && Number.isFinite(state.arrivedAtAbsoluteMinute)
    && !!state.position && state.position.every(Number.isFinite) && !state.waitingForResource && !state.waitingForRoute
    && !!intent && intent.residentId === state.residentId && intent.activityKey === 'patrol'
    && intent.reason === 'routine' && !intent.indoor && intent.activity === state.activity
    && intent.targetPlaceId === state.scheduledPlaceId;
}

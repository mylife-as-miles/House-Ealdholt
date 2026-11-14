/** Authored visual bindings, shared by Desktop and Native. Schedule words never
 * select a clip heuristically. Unsupported actions stay held, not idle-as-work.
 * This presents sampled state only; it does not complete work or change facts. */
import { EALDHOLT_VILLAGE_POPULATION, ROLE_LOOP_VARIANTS, getPopulationClip } from './village-population';
import { getPopulationArt } from './village-population-art';
import { getHouseholdArtSet } from './household-art-sets';
import { isWalkLikeClip, type CrowdActivity, type CrowdOwnerMotion } from './crowd-binding';
import type { VillagePopulationResidentState } from './village-population-runtime';
import { planGuardWatchDwell, publishedGuardWatch, GUARD_WATCH_LOOP, GUARD_WATCH_WALK } from './guard-watch-dwell';
import {requiredVillageRefugeMotionClips} from './village-emergency-refuges';

export interface PopulationPresentation {
  readonly motion: CrowdOwnerMotion | null;
  readonly activity: CrowdActivity;
  readonly presentable: boolean;
  readonly reason: string | null;
  readonly waitingForResource?: true;
  readonly waitingForRoute?: true;
  readonly pausingAtDestination?: true;
  readonly guardWatch?: true;
  readonly animationTimeSeconds?: number;
  readonly animationTimeMode?: 'seek' | 'advance';
  readonly fadeSeconds?: number;
}
export type AuthoredPopulationActivity =
  | { readonly kind: 'role'; readonly clips: readonly string[] }
  | { readonly kind: 'talk' | 'sit' | 'travel' | 'indoors' }
  | { readonly kind: 'unpresentable'; readonly planned: string };
const residents = new Map(EALDHOLT_VILLAGE_POPULATION.residents.map(r => [r.id, r] as const));
const libraries = new Map(EALDHOLT_VILLAGE_POPULATION.clipLibraries.map(l => [l.archetype, new Set(l.clips)] as const));
const places = new Set(EALDHOLT_VILLAGE_POPULATION.registry.places.map(place => place.id));
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
const EMPTY_ACTIVITY: CrowdActivity = Object.freeze({});
const held = (reason: string): PopulationPresentation => ({ motion: null, activity: EMPTY_ACTIVITY, presentable: false, reason });
const shown = (motion: CrowdOwnerMotion, activity: CrowdActivity = EMPTY_ACTIVITY): PopulationPresentation =>
  ({ motion, activity, presentable: true, reason: null });
const family = (base: string): readonly string[] => ROLE_LOOP_VARIANTS[base]?.variants ?? [base];

/** Known generated responsibilities are destinations, not performances. A
 * certified journey may walk toward one, or wait outside for a route; neither
 * permission grants rest, shelter, care, visiting or work at the destination. */
function generatedLifeIntent(state: VillagePopulationResidentState): boolean {
  const intent = state.lifeIntent;
  if (!intent || intent.residentId !== state.residentId || intent.activity !== state.activity
    || intent.targetPlaceId !== state.scheduledPlaceId || !places.has(intent.targetPlaceId)
    || !Number.isSafeInteger(intent.issuedAbsoluteMinute) || intent.issuedAbsoluteMinute < 0) return false;
  return intent.indoor === true && (intent.activityKey === 'rest' && intent.reason === 'needs'
    || intent.activityKey === 'shelter' && (intent.reason === 'weather' || intent.reason === 'safety')
    || intent.activityKey === 'care' && intent.reason === 'family-care'
    || intent.activityKey === 'visit' && intent.reason === 'family-visit'
    || intent.activityKey === 'meal' && intent.reason === 'family-meal'
    || intent.activityKey === 'protect' && (intent.reason === 'safety' || intent.reason === 'household-protection'))
    || intent.indoor === false && intent.activityKey === 'patrol' && intent.reason === 'safety';
}
function generatedLifeJourney(state: VillagePopulationResidentState): boolean {
  return state.moving && state.status === 'travelling' && state.navigationStatus === 'travelling' && state.navigationReason === null
    && generatedLifeIntent(state);
}

/** Preserve the earliest concrete hold instead of labelling shelter or an
 * unavailable destination as missing motion evidence in the render adapters. */
export function populationPresentationHeldReason(state: VillagePopulationResidentState, presentation: PopulationPresentation,
  qualification: { readonly presentable: boolean; readonly reason: string | null }): string | null {
  if (!state.presentable) return state.navigationReason ?? state.reason ?? presentation.reason ?? 'location-unpresentable';
  if (!presentation.presentable || !presentation.motion) return presentation.reason ?? 'activity-presentation-unavailable';
  if (!qualification.presentable) return qualification.reason ?? 'motion-evidence-unavailable';
  return null;
}

/** Read-only wording for the current presentation, never a replacement intent
 * or chronicle predicate. Raid/away/changed-place overlays keep their own words. */
export function displayPopulationActivity(state: VillagePopulationResidentState,
  override?: { readonly residentId: string; readonly activity: string; readonly scheduledPlaceId: string;
    readonly alarm?: boolean; readonly away?: boolean }): string {
  const shown = override?.residentId === state.residentId ? override : undefined;
  if (shown && (shown.alarm || shown.away || shown.activity !== state.activity || shown.scheduledPlaceId !== state.scheduledPlaceId)) return shown.activity;
  if (state.waitingForRoute && resolvePopulationPresentation(state).waitingForRoute) return 'Waits to leave.';
  if (state.pausingAtDestination && resolvePopulationPresentation(state).pausingAtDestination) return 'Pauses on the route.';
  if (state.patrol && state.position?.every(Number.isFinite) && state.lifeIntent?.residentId === state.residentId
    && state.lifeIntent.activityKey === 'patrol' && state.lifeIntent.reason === 'routine' && !state.lifeIntent.indoor
    && state.lifeIntent.activity === state.activity && state.lifeIntent.targetPlaceId === state.scheduledPlaceId) {
    if (state.patrol.phase === 'travelling' && state.moving && state.navigationStatus === 'travelling' && state.navigationReason === null) return 'Patrols the lane.';
    if (state.patrol.phase === 'dwelling' && !state.moving && state.navigationStatus === 'at-threshold' && state.navigationReason === null
      && state.placeId === state.patrol.waypointPlaceId && state.arrivalEvidence === 'certified-route-arrival') return 'Pauses on the lane.';
    if (state.patrol.phase === 'waiting' && !state.moving && state.navigationStatus === 'waiting'
      && ['destination-reserved','corridor-reserved','route-unmapped','destination-unmapped','awaiting-decision-boundary'].includes(state.navigationReason ?? '')) return 'Waits on the patrol route.';
  }
  return state.waitingForResource && resolvePopulationPresentation(state).waitingForResource
    ? 'Waits to begin work.' : shown?.activity ?? state.activity;
}

/** Exact activity/role overrides take priority over the common authored table. */
export const POPULATION_ACTIVITY_ROLE_OVERRIDES: Readonly<Record<string, Readonly<Record<string, AuthoredPopulationActivity>>>> = deepFreeze({
  'lame-craftsman': { 'Seated work at the doorstep.': { kind: 'role', clips: ['work_mend_seated'] } },
  'failing-sight': { 'Seated work at the doorstep.': { kind: 'role', clips: ['work_card_wool'] } },
  convalescent: { 'Seated work at the doorstep.': { kind: 'role', clips: ['work_shell_peas'] } },
});

/** A walking resident is visibly travelling, even when the destination action
 * is held. A carry is chosen only for an explicitly authored carry activity. */
export function resolvePopulationPresentation(state: VillagePopulationResidentState): PopulationPresentation {
  const resident = residents.get(state.residentId);
  if (!resident) return held('resident-unregistered');
  if (!state.presentable || state.status === 'unmapped' || state.status === 'blocked' && !state.waitingForRoute)
    return held(`location-unpresentable:${state.reason ?? state.status}`);
  if (!state.position || !state.position.every(Number.isFinite)) return held('position-unavailable');
  if(state.neutralReturnMotion){
    const neutral=state.neutralReturnMotion;
    if(neutral.zeroCrossfade!==true||state.moving||state.navigationStatus!=='at-threshold'||state.arrivalEvidence!=='certified-route-arrival'||!neutral.neutralClips.length)return held('neutral-return-stance-unqualified');
    return{...shown('idle'),fadeSeconds:0};
  }
  if(state.ordinaryWork){
    const work=state.ordinaryWork;
    if(!work.qualified||state.moving||state.status!=='at-place'||state.navigationStatus!=='at-threshold'||state.navigationReason!==null||state.arrivalEvidence!=='certified-route-arrival'||state.placeId!==state.scheduledPlaceId||!state.workPoseQualified||!Number.isFinite(work.elapsedSeconds)||work.elapsedSeconds<0)return held('ordinary-work-unqualified');
    const motion=work.phase==='face'?'workEnter':work.phase==='release'?'workExit':'work';
    return{...shown(motion,{roleClip:work.clip}),animationTimeSeconds:work.elapsedSeconds,animationTimeMode:'advance',fadeSeconds:0};
  }
  if(state.workplaceMotion){
    const profile=state.workplaceMotion;
    if(profile.zeroCrossfade!==true||!profile.neutralClips.length)return held('ordinary-route-motion-unqualified');
    if(state.moving)return state.status==='travelling'&&state.navigationStatus==='travelling'&&state.navigationReason===null?{...shown('walk'),fadeSeconds:0}:held('ordinary-route-journey-unqualified');
    const arrived=state.status==='at-place'&&state.navigationStatus==='at-threshold'&&state.arrivalEvidence==='certified-route-arrival';
    const stopped=profile.trafficStopped===true&&state.navigationStatus==='travelling'&&state.navigationReason==='traffic-peer-held'&&state.arrivalEvidence==='none';
    const waiting=state.status==='blocked'&&state.waitingForRoute&&state.navigationStatus==='waiting';
    return arrived||stopped||waiting?{...shown('idle'),fadeSeconds:0}:held('ordinary-route-stance-unqualified');
  }
  if(state.refugeMotion){
    const neutral=requiredVillageRefugeMotionClips(state.residentId);
    if(state.refugeMotion.zeroCrossfade!==true||!state.refugeMotion.refugeIds.length||!neutral.length
      ||JSON.stringify([...state.refugeMotion.neutralClips].sort())!==JSON.stringify([...neutral].sort())
      ||state.emergency&&!state.emergency.qualified)return held('refuge-motion-unqualified');
    if(state.moving)return state.status==='travelling'&&state.navigationStatus==='travelling'&&state.navigationReason===null
      ?{...shown('walk'),fadeSeconds:0}:held('refuge-journey-unqualified');
    const arrived=state.status==='at-place'&&state.navigationStatus==='at-threshold'&&state.arrivalEvidence==='certified-route-arrival';
    const waiting=state.status==='blocked'&&state.waitingForRoute&&state.navigationStatus==='waiting';
    const stopped=state.refugeMotion.trafficStopped===true&&state.status==='travelling'&&state.navigationStatus==='travelling'&&state.navigationReason==='traffic-peer-held'&&state.arrivalEvidence==='none';
    return arrived||waiting||stopped?{...shown('idle'),fadeSeconds:0}:held('refuge-stance-unqualified');
  }
  if(state.emergency){
    const e=state.emergency,intent=state.lifeIntent,art=getPopulationArt(resident.id),household=getHouseholdArtSet(resident.id);
    if(!e.qualified||!intent||intent.residentId!==state.residentId||intent.reason!=='safety'||intent.activity!==state.activity
      ||intent.targetPlaceId!==state.scheduledPlaceId||!art)return held('emergency-state-unqualified');
    const canRole=(clip:string)=>!household&&resident.appearance.motion.roleClips.includes(clip)&&art.motions.roleClips.includes(clip)
      &&state.availableRoleClips.includes(clip)&&libraries.get(resident.appearance.archetype)?.has(clip);
    if(state.moving){
      if(state.status!=='travelling'||state.navigationStatus!=='travelling'||state.navigationReason!==null)return held('emergency-journey-unqualified');
      return e.requiredLocomotionClip||e.phase==='to-fire'?(canRole('carry_bucket_walk')?{...shown('walk',{roleClip:'carry_bucket_walk'}),fadeSeconds:0}:held('emergency-bucket-clip-unavailable')):shown('walk');
    }
    // A certified narrow route keeps its measured bucket pose when reservations
    // or a new hazard hold movement. Never blend to an unmeasured idle/start.
    if(e.requiredLocomotionClip==='carry_bucket_walk'&&e.traversalId&&e.clip==='carry_bucket_walk'&&canRole(e.clip))
      return{...shown('walk',{roleClip:e.clip}),animationTimeSeconds:0,animationTimeMode:'seek',fadeSeconds:0};
    if(e.phase==='sheltered')return state.status==='at-place'&&state.navigationStatus==='at-threshold'&&state.navigationReason===null
      &&state.placeId===state.scheduledPlaceId&&state.arrivalEvidence==='certified-route-arrival'&&!intent.indoor
      ?shown('idle'):held('emergency-refuge-unqualified');
    if(state.status!=='at-place'||state.navigationStatus!=='at-threshold'||state.navigationReason!==null
      ||state.placeId!==state.scheduledPlaceId||state.arrivalEvidence!=='certified-route-arrival'||state.arrivedAtAbsoluteMinute==null
      ||e.actionStartedAbsoluteMinute===null||e.actionElapsedSeconds===null||!Number.isFinite(e.actionElapsedSeconds)||e.actionElapsedSeconds<0
      ||!e.stationId||!e.contactPoint||!e.contactSourceActor)return held('emergency-contact-unqualified');
    if((e.phase==='drawing-water'||e.phase==='delivering-water')&&e.clip==='carry_bucket_walk'&&canRole(e.clip))
      return{...shown('walk',{roleClip:e.clip}),animationTimeSeconds:0,animationTimeMode:'seek',fadeSeconds:0};
    if(e.phase==='repairing'&&(e.clip==='work_hammer_bench'||e.clip==='work_chisel')&&canRole(e.clip))
      return{...shown('work',{roleClip:e.clip}),animationTimeSeconds:e.actionElapsedSeconds,animationTimeMode:'advance',fadeSeconds:0};
    return held('emergency-performance-unqualified');
  }
  if (state.waitingForRoute) {
    const intent = state.lifeIntent, art = getPopulationArt(resident.id), household = getHouseholdArtSet(resident.id);
    if (state.waitingForResource || state.status !== 'blocked' || state.moving || state.navigationStatus !== 'waiting'
      || !['destination-reserved','corridor-reserved','route-unmapped','destination-unmapped','awaiting-decision-boundary'].includes(state.navigationReason ?? '')
      || state.patrol || !state.placeId || state.placeId === state.scheduledPlaceId || state.workPoseQualified !== false
      || state.roleClip !== null || state.arrivalEvidence !== 'certified-route-arrival' || state.arrivedAtAbsoluteMinute == null
      || !intent || intent.residentId !== state.residentId || intent.activity !== state.activity || intent.targetPlaceId !== state.scheduledPlaceId
      || !resident.registry.routine.some(slot => slot.activity === state.activity) && !generatedLifeIntent(state)) return held('route-wait-state-unqualified');
    if (!art) return held('art-entry-unavailable');
    if (!household && (!libraries.get(resident.appearance.archetype)?.has(art.motions.idle) || getPopulationClip(art.motions.idle)?.loop !== true))
      return held(`idle-clip-unavailable:${art.motions.idle}`);
    return { ...shown('idle'), waitingForRoute: true };
  }
  const generatedJourney = generatedLifeJourney(state);
  if (!resident.registry.routine.some(slot => slot.activity === state.activity) && !generatedJourney) return held('activity-not-authored-for-resident');
  const art = getPopulationArt(resident.id);
  if (!art) return held('art-entry-unavailable');
  const household = getHouseholdArtSet(resident.id);
  const guard = !household && state.patrol && publishedGuardWatch(state.residentId)
    && resident.appearance.motion.roleClips.includes(GUARD_WATCH_LOOP) && state.availableRoleClips.includes(GUARD_WATCH_LOOP)
    && state.availableRoleClips.includes(GUARD_WATCH_WALK);
  if (guard && state.patrol?.phase === 'dwelling') {
    const plan=planGuardWatchDwell(state);
    return plan ? { ...shown(plan.motion,{roleClip:GUARD_WATCH_LOOP,guardWatch:true}),guardWatch:true,...plan }
      : held('guard-patrol-dwell-unqualified');
  }
  if (guard && state.patrol?.phase === 'travelling' && state.moving && state.navigationStatus === 'travelling' && state.navigationReason === null)
    return { ...shown('walk',{roleClip:GUARD_WATCH_WALK,guardWatch:true}),guardWatch:true };
  if (state.waitingForResource) {
    const intent = state.lifeIntent;
    if (state.lifeStatus !== 'queued' || state.status !== 'at-place' || state.moving
      || state.navigationStatus !== 'at-threshold' || state.navigationReason !== null
      || state.reason !== 'life-resource-unavailable' || !intent || intent.residentId !== state.residentId
      || intent.activityKey !== 'work' || intent.reason !== 'routine' || intent.indoor
      || intent.activity !== state.activity || intent.targetPlaceId !== state.placeId
      || intent.targetPlaceId !== state.scheduledPlaceId) return held('waiting-state-unqualified');
    // This is an explicit resource wait, never idle substituted for an
    // unpublished task, a stationary patrol, an indoor action or equipment use.
    if (household) {
      if (household.activityPresentation[state.activity]?.kind !== 'work') return held('waiting-activity-unqualified');
    } else {
      const binding = POPULATION_ACTIVITY_ROLE_OVERRIDES[resident.registry.role.id]?.[state.activity]
        ?? POPULATION_ACTIVITY_PRESENTATION[state.activity];
      const available = libraries.get(resident.appearance.archetype);
      const supported = binding?.kind === 'role' && binding.clips.flatMap(base => family(base)).some(name =>
        resident.appearance.motion.roleClips.includes(name) && art.motions.roleClips.includes(name)
        && state.availableRoleClips.includes(name) && available?.has(name)
        && getPopulationClip(name)?.loop === true && !isWalkLikeClip(name));
      if (!supported) return held('waiting-activity-unqualified');
      if (!available?.has(art.motions.idle)) return held(`idle-clip-unavailable:${art.motions.idle}`);
    }
    return { ...shown('idle'), waitingForResource: true };
  }
  if (generatedJourney) {
    if (household) return shown('walk');
    const available = libraries.get(resident.appearance.archetype), walk = art.motions.walk;
    if (!available?.has(walk) || getPopulationClip(walk)?.kind !== 'locomotion') return held(`walk-clip-unavailable:${walk}`);
    return shown('walk');
  }
  const neutralEndpoint = 'workPoseQualified' in state && state.workPoseQualified === false;
  if (household) {
    const binding = household.activityPresentation[state.activity];
    if (!binding) return held('household-activity-unmapped');
    if (state.moving) return shown('walk');
    if (binding.kind === 'indoors') return held('household-activity-indoors');
    if (binding.kind === 'unpresentable') return held(`household-loop-unavailable:${binding.planned}`);
    if (binding.kind === 'work') return neutralEndpoint ? held('workplace-orientation-unqualified') : shown('work');
    if (binding.motion === 'walk') return held('locomotion-requires-moving-state');
    if (binding.motion === 'sit' && !household.actorMotions.sit) return held('household-sit-clip-unavailable');
    return shown(binding.motion, binding.motion === 'sit' ? { seated: true } : EMPTY_ACTIVITY);
  }
  const binding = POPULATION_ACTIVITY_ROLE_OVERRIDES[resident.registry.role.id]?.[state.activity]
    ?? POPULATION_ACTIVITY_PRESENTATION[state.activity];
  if (!binding) return held('activity-unmapped');
  const available = libraries.get(resident.appearance.archetype);
  if (!available) return held('clip-library-unavailable');
  const canUseRole = (name: string) => resident.appearance.motion.roleClips.includes(name)
    && art.motions.roleClips.includes(name) && state.availableRoleClips.includes(name) && available.has(name);
  const candidates = binding.kind === 'role' ? binding.clips.flatMap(base => family(base)) : [];
  const roles = candidates.filter(canUseRole);
  if (state.pausingAtDestination) {
    const intent=state.lifeIntent;
    if (resident.group!=='guards-military'||state.waitingForResource||state.waitingForRoute||state.patrol||state.moving
      ||state.status!=='at-place'||state.navigationStatus!=='at-threshold'||state.navigationReason!==null||state.reason!==null
      ||state.lifeStatus!=='active'||state.workPoseQualified!==false||state.roleClip!==null
      ||state.arrivalEvidence!=='certified-route-arrival'||state.arrivedAtAbsoluteMinute==null
      ||!Number.isFinite(state.arrivedAtAbsoluteMinute)||state.arrivedAtAbsoluteMinute<0
      ||!intent||intent.residentId!==state.residentId||intent.activityKey!=='patrol'||intent.reason!=='routine'||intent.indoor
      ||intent.activity!==state.activity||intent.targetPlaceId!==state.placeId||intent.targetPlaceId!==state.scheduledPlaceId
      ||!Number.isSafeInteger(intent.issuedAbsoluteMinute)||intent.issuedAbsoluteMinute<0||state.arrivedAtAbsoluteMinute<intent.issuedAbsoluteMinute
      ||binding.kind!=='role'||!roles.includes('guard_patrol_walk')||roles.some(name=>!isWalkLikeClip(name)))
      return held('stationary-arrival-unqualified');
    if (!available.has(art.motions.idle)||getPopulationClip(art.motions.idle)?.loop!==true) return held(`idle-clip-unavailable:${art.motions.idle}`);
    return { ...shown('idle'),pausingAtDestination:true };
  }
  if (state.moving) {
    const carry = roles.find(name => getPopulationClip(name)?.loop === true
      && (getPopulationClip(name)?.kind === 'carry' || name === 'guard_patrol_walk'));
    if (carry) return shown('walk', { roleClip: carry });
    const walk = art.motions.walk;
    if (!available.has(walk) || getPopulationClip(walk)?.kind !== 'locomotion') return held(`walk-clip-unavailable:${walk}`);
    return shown('walk');
  }
  if (binding.kind === 'indoors') return held('activity-indoors');
  if (binding.kind === 'unpresentable') return held(`activity-loop-unavailable:${binding.planned}`);
  if (binding.kind === 'travel') return held('locomotion-requires-moving-state');
  if (binding.kind === 'talk') return available.has(art.motions.talk) ? shown('talk') : held(`talk-clip-unavailable:${art.motions.talk}`);
  if (binding.kind === 'sit') return available.has('sit') ? shown('sit', { seated: true }) : held('sit-clip-unavailable');
  const role = roles.find(name => !isWalkLikeClip(name) && getPopulationClip(name)?.loop === true);
  if (role && neutralEndpoint && role.startsWith('work_')) return held('workplace-orientation-unqualified');
  if (role) return shown('work', { roleClip: role, ...(getPopulationClip(role)?.kind === 'seated' ? { seated: true } : {}) });
  if (roles.some(isWalkLikeClip)) return held('locomotion-requires-moving-state');
  if (roles.length) return held('role-clip-is-not-a-sustained-loop');
  return held(binding.kind === 'role' ? `role-clip-unavailable:${binding.clips.join('|')}` : 'activity-unmapped');
}

// Exact strings below are replaceable authored content, not matching rules.
export const POPULATION_ACTIVITY_PRESENTATION: Readonly<Record<string, AuthoredPopulationActivity>> = deepFreeze({
  "Arms and dresses for the watch.": {"kind": "indoors"},
  "Asleep at home.": {"kind": "indoors"},
  "Bakes for households who bring dough.": {"kind": "role", "clips": ["work_oven_peel", "work_knead"]},
  "Banks the fire and sets the morning's work.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Breakfast with the household.": {"kind": "indoors"},
  "Brings the animals home to the fold.": {"kind": "travel"},
  "Cards wool and winds bobbins.": {"kind": "role", "clips": ["work_card_wool"]},
  "Cards wool by touch at the hearth.": {"kind": "indoors"},
  "Cards wool on the bench by the door.": {"kind": "role", "clips": ["work_card_wool"]},
  "Cards wool or mends by the fire.": {"kind": "indoors"},
  "Carries and roughs out stone.": {"kind": "role", "clips": ["work_chisel"]},
  "Carries firewood and water for the hall.": {"kind": "role", "clips": ["carry_bundle_walk", "carry_bucket_walk", "carry_basket_walk"]},
  "Carries grain sacks into the mill.": {"kind": "role", "clips": ["carry_sack_walk"]},
  "Carries messages around the village for the hall.": {"kind": "travel"},
  "Carries milk to the households.": {"kind": "role", "clips": ["carry_sack_walk", "carry_basket_walk", "carry_bundle_walk"]},
  "Carries tools and produce home.": {"kind": "role", "clips": ["carry_sack_walk", "carry_basket_walk", "carry_bundle_walk"]},
  "Carries water home in the lanes.": {"kind": "role", "clips": ["carry_bucket_walk", "carry_yoke_walk", "fetch_carry"]},
  "Carts and stacks firewood for the households.": {"kind": "role", "clips": ["carry_bundle_walk", "carry_bucket_walk", "carry_basket_walk"]},
  "Checks the animals and the fold.": {"kind": "role", "clips": ["work_herd", "guard_lookout"]},
  "Checks the common pasture and the fences.": {"kind": "role", "clips": ["work_herd", "guard_lookout"]},
  "Checks the guard yard and its stores.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Checks the mill race stones.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Checks the plough team and the weather.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Churns butter and presses cheese.": {"kind": "role", "clips": ["work_churn"]},
  "Clears and sweeps the workshop.": {"kind": "role", "clips": ["work_sweep"]},
  "Confers at the hall about the watch.": {"kind": "role", "clips": ["work_address"]},
  "Cooks and bakes for the hall.": {"kind": "role", "clips": ["work_knead", "work_stir", "work_oven_peel"]},
  "Copies by the fire.": {"kind": "indoors"},
  "Copies the church records.": {"kind": "role", "clips": ["work_write"]},
  "Counts and stores the day's goods.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Cuts and dyes leather.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Cuts and hangs meat at the block.": {"kind": "role", "clips": ["work_chop_block"]},
  "Cuts and soaks willow by the pond.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Cuts soles and waxes thread.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Digs and plants the vegetable plots.": {"kind": "role", "clips": ["work_dig", "work_hoe", "work_gather_herbs"]},
  "Dips candles over the tallow pot.": {"kind": "role", "clips": ["work_dip_candles"]},
  "Draws out the next repairs by the fire.": {"kind": "indoors"},
  "Dresses stone for the church repairs.": {"kind": "role", "clips": ["work_chisel"]},
  "Dries and bundles herbs by the fire.": {"kind": "indoors"},
  "Drills and mends gear at the watch post.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Drills and mends gear in the guard yard.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Drills and runs errands for the serjeant in the lanes.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Drills in the guard yard.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Drills recruits and spearmen.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Drills the watch in the guard yard.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Drives the geese to the pond and back.": {"kind": "travel"},
  "Drives the geese to the pond edge.": {"kind": "travel"},
  "Drives the pigs to the woodland edge.": {"kind": "travel"},
  "Eats at the watch post.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Eats at the work and rests.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Eats at the work.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Eats in the field.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Eats out with the animals.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Evening meal with the household.": {"kind": "indoors"},
  "Evening milking.": {"kind": "role", "clips": ["work_milk"]},
  "Evening prayers in the church.": {"kind": "indoors"},
  "Feeds the animals and readies the tools.": {"kind": "role", "clips": ["work_scatter_feed"]},
  "Feeds the birds and gathers eggs.": {"kind": "role", "clips": ["work_scatter_feed"]},
  "Fells and splits wood at the woodland edge.": {"kind": "role", "clips": ["work_chop_wood"]},
  "Fetches water and hears news at the river bank.": {"kind": "role", "clips": ["carry_bucket_walk", "carry_yoke_walk", "fetch_carry"]},
  "Fetches water and hears news at the well.": {"kind": "role", "clips": ["carry_bucket_walk", "carry_yoke_walk", "fetch_carry"]},
  "Fetches water and kindling for the work.": {"kind": "role", "clips": ["carry_bucket_walk", "carry_yoke_walk", "fetch_carry"]},
  "Fetches water and trades news at the river bank.": {"kind": "role", "clips": ["carry_bucket_walk", "carry_yoke_walk", "fetch_carry"]},
  "Fetches water and trades news at the well.": {"kind": "role", "clips": ["carry_bucket_walk", "carry_yoke_walk", "fetch_carry"]},
  "Fetches water and washes at the river bank.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Fetches water and washes at the well.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Fetches water at the river bank.": {"kind": "role", "clips": ["carry_bucket_walk", "carry_yoke_walk", "fetch_carry"]},
  "Fetches water at the well.": {"kind": "role", "clips": ["carry_bucket_walk", "carry_yoke_walk", "fetch_carry"]},
  "Fetches water for the household at the river bank.": {"kind": "role", "clips": ["carry_bucket_walk", "carry_yoke_walk", "fetch_carry"]},
  "Fetches water for the household.": {"kind": "role", "clips": ["carry_bucket_walk", "carry_yoke_walk", "fetch_carry"]},
  "Field work by season: weeding, reaping or carting.": {"kind": "role", "clips": ["work_hoe", "work_sow", "work_reap"]},
  "Fits heads and bundles arrows for the watch.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Gathers herbs at the woodland edge.": {"kind": "role", "clips": ["work_gather_herbs"]},
  "Gathers herbs in the healer's garden.": {"kind": "role", "clips": ["work_gather_herbs"]},
  "Gathers kindling along the hedgerows.": {"kind": "role", "clips": ["crouch_gather"]},
  "Gathers kindling at the woodland edge.": {"kind": "role", "clips": ["crouch_gather"]},
  "Grinds and bundles herbs beside the healer.": {"kind": "role", "clips": ["work_grind_herbs"]},
  "Grinds and steeps herbs at home.": {"kind": "role", "clips": ["work_grind_herbs"]},
  "Grinds grain and dresses the stones.": {"kind": "role", "clips": ["work_tend_mill"]},
  "Hears the night watch's report.": {"kind": "role", "clips": ["work_address"]},
  "Hears villagers' concerns at the hall.": {"kind": "role", "clips": ["work_address"]},
  "Helps at home after waking.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Helps at home with small chores.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Helps at the poultry stall.": {"kind": "role", "clips": ["work_sell"]},
  "Helps bring the flock out to pasture.": {"kind": "travel"},
  "Holds and saws timber in the yard.": {"kind": "role", "clips": ["work_saw", "work_plane"]},
  "Inspects and mends the guard's gear.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Inspects the approach and the watch post.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Inspects the mill and the stored grain.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Is helped home along the lane.": {"kind": "travel"},
  "Joins frames and fits doors around the village.": {"kind": "role", "clips": ["work_chisel"]},
  "Keeps the approach and questions travellers.": {"kind": "role", "clips": ["guard_challenge"]},
  "Keeps the hall accounts and tallies.": {"kind": "role", "clips": ["work_tally"]},
  "Keeps the hall accounts with the steward's tallies.": {"kind": "role", "clips": ["work_tally"]},
  "Keeps the hall kitchen and stores.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Keeps the lookout over the approaches.": {"kind": "role", "clips": ["work_herd", "guard_lookout"]},
  "Keeps the morning office and tends the altar.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Kneads and bakes the morning batch.": {"kind": "role", "clips": ["work_knead", "work_stir", "work_oven_peel"]},
  "Knots and mends nets.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Learns letters and the hall accounts.": {"kind": "role", "clips": ["work_write"]},
  "Learns letters with the parish clerk.": {"kind": "role", "clips": ["work_write"]},
  "Learns to square a block with mallet and chisel.": {"kind": "role", "clips": ["work_chisel"]},
  "Lights the fire and draws water.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Listens to stories by the fire.": {"kind": "indoors"},
  "Loads the day's goods.": {"kind": "role", "clips": ["carry_sack_walk", "carry_basket_walk", "carry_bundle_walk"]},
  "Mashes and brews the next batch.": {"kind": "role", "clips": ["work_stir"]},
  "Mends baskets and sacks by the fire.": {"kind": "indoors"},
  "Mends harness by the fire.": {"kind": "indoors"},
  "Mends sacks and harness in the hall.": {"kind": "role", "clips": ["work_mend_seated"]},
  "Mends shoes brought in by neighbours.": {"kind": "role", "clips": ["work_cobble"]},
  "Mends tool handles and baskets on the bench.": {"kind": "role", "clips": ["work_mend_seated"]},
  "Mends tools and harness by the fire.": {"kind": "indoors"},
  "Midday meal at home.": {"kind": "indoors"},
  "Milks before dawn.": {"kind": "role", "clips": ["work_milk"]},
  "Minds the hearth and the youngest children.": {"kind": "indoors"},
  "Morning prayers in the church.": {"kind": "indoors"},
  "Moves the flock to fresh grazing.": {"kind": "travel"},
  "Mucks out and feeds the hall horses.": {"kind": "role", "clips": ["work_sweep"]},
  "Opens the workshop and lays out the tools.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Patches a roof with fresh thatch.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Patrols the lanes, the well and the courtyard in the lanes.": {"kind": "role", "clips": ["guard_patrol_walk"]},
  "Patrols the lanes, the well and the courtyard on the green.": {"kind": "role", "clips": ["guard_patrol_walk"]},
  "Patrols the lanes, the well and the courtyard.": {"kind": "role", "clips": ["guard_patrol_walk"]},
  "Plans the coming days by the fire.": {"kind": "indoors"},
  "Plays by the pond edge.": {"kind": "role", "clips": ["play_toss", "play_chase"]},
  "Plays chase and pebble games with the other children in the lanes.": {"kind": "role", "clips": ["play_toss", "play_chase"]},
  "Plays chase and pebble games with the other children.": {"kind": "role", "clips": ["play_toss", "play_chase"]},
  "Plays on the green.": {"kind": "role", "clips": ["play_toss", "play_chase"]},
  "Ploughs, hoes or sows the arable strips.": {"kind": "role", "clips": ["work_hoe", "work_sow", "work_reap"]},
  "Practises the trade by the fire.": {"kind": "indoors"},
  "Prepares for the evening.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Prepares remedies for the night.": {"kind": "role", "clips": ["work_grind_herbs"]},
  "Prepares salves and linen at home.": {"kind": "role", "clips": ["work_grind_herbs"]},
  "Prunes and picks in the orchard.": {"kind": "role", "clips": ["work_prune"]},
  "Raises staves and drives hoops.": {"kind": "role", "clips": ["work_hammer_bench"]},
  "Readies for the night watch.": {"kind": "indoors"},
  "Readies the satchel and boots.": {"kind": "indoors"},
  "Readies the satchel and linen.": {"kind": "indoors"},
  "Reads and prepares the coming services.": {"kind": "role", "clips": ["work_read"]},
  "Reads by the fire.": {"kind": "indoors"},
  "Reads in the churchyard.": {"kind": "role", "clips": ["work_read"]},
  "Repairs the stone walls and the well head.": {"kind": "role", "clips": ["work_chisel"]},
  "Reports on the fields at the hall.": {"kind": "role", "clips": ["work_address"]},
  "Rests and mends boots by the fire.": {"kind": "indoors"},
  "Rests at home.": {"kind": "indoors"},
  "Rests indoors.": {"kind": "indoors"},
  "Returns and reports at the hall.": {"kind": "role", "clips": ["work_address"]},
  "Rings the evening bell.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Rings the morning bell.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Runs errands between neighbouring houses in the lanes.": {"kind": "travel"},
  "Runs errands between neighbouring houses.": {"kind": "travel"},
  "Runs errands for the master in the lanes.": {"kind": "travel"},
  "Runs errands for the master on the green.": {"kind": "travel"},
  "Salts and smokes meat for winter.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Saws and planes timber in the yard.": {"kind": "role", "clips": ["work_saw", "work_plane"]},
  "Scalds the pails and turns the cheeses.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Scrapes hides over the beam.": {"kind": "role", "clips": ["work_scrape_hide"]},
  "Scrubs the pails and the dairy.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Seated work at the doorstep.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Sells ale from the stall in the courtyard.": {"kind": "role", "clips": ["work_sell"]},
  "Sells cheese, butter and milk at the market.": {"kind": "role", "clips": ["work_sell"]},
  "Sells cheese, butter and milk from door to door in the lanes.": {"kind": "role", "clips": ["work_sell"]},
  "Sells eggs and birds at the courtyard market.": {"kind": "role", "clips": ["work_sell"]},
  "Sells flour and meal at the courtyard market.": {"kind": "role", "clips": ["work_sell"]},
  "Sells sausages and puddings at the market.": {"kind": "role", "clips": ["work_sell"]},
  "Sets the curds and scalds the pails.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Sets the night watch.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Settles disputes over strips and boundaries in the lanes.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Sews swaddling by the fire.": {"kind": "indoors"},
  "Shapes staves with the drawknife.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Shares news at the well.": {"kind": "talk"},
  "Sharpens chisels.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Shells peas and minds the geese from a seat.": {"kind": "role", "clips": ["work_shell_peas"]},
  "Shells peas and sorts beans at the doorstep.": {"kind": "role", "clips": ["work_shell_peas"]},
  "Shows the apprentice the warp and the pattern.": {"kind": "role", "clips": ["work_address"]},
  "Sieves and bags meal at the mill house.": {"kind": "role", "clips": ["work_tend_mill"]},
  "Sits at the guard yard and gives advice.": {"kind": "sit"},
  "Sits at the well and trades news.": {"kind": "sit"},
  "Sits by the fire.": {"kind": "indoors"},
  "Sits by the hall door and greets visitors.": {"kind": "sit"},
  "Sits in the courtyard sun with neighbours.": {"kind": "sit"},
  "Sits in the lanes sun with neighbours.": {"kind": "sit"},
  "Sits in the sun at the doorstep.": {"kind": "sit"},
  "Sits with an expectant mother.": {"kind": "unpresentable", "planned": "care visit loop and paired presentation not published"},
  "Sleeps after the night watch.": {"kind": "indoors"},
  "Small repairs by the fire.": {"kind": "indoors"},
  "Sorts and packs goods at home.": {"kind": "role", "clips": ["carry_bundle_walk", "carry_bucket_walk", "carry_basket_walk"]},
  "Sorts fleece and picks out burrs.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Spins from a distaff at the door.": {"kind": "role", "clips": ["work_spin_distaff"]},
  "Spreads linen to dry and folds it.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Stacks and covers the dressed stone.": {"kind": "role", "clips": ["carry_bundle_walk", "carry_bucket_walk", "carry_basket_walk"]},
  "Stacks and fires the kiln.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Stands the morning watch at the approach.": {"kind": "role", "clips": ["guard_stand_watch"]},
  "Stands the night watch at the approach.": {"kind": "role", "clips": ["guard_stand_watch"]},
  "Stands the watch beside an older guard.": {"kind": "role", "clips": ["guard_stand_watch"]},
  "Stitches harness and belts at the bench.": {"kind": "role", "clips": ["work_stitch_leather"]},
  "Stitches simple shoes at the bench.": {"kind": "role", "clips": ["work_cobble"]},
  "Stitches uppers and soles at the bench.": {"kind": "role", "clips": ["work_cobble"]},
  "Straightens and fletches arrow shafts.": {"kind": "role", "clips": ["work_fletch"]},
  "Stretches cloth to dry on the frames.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Stuffs and smokes sausages at home.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Sweeps and tidies the workplace.": {"kind": "role", "clips": ["work_sweep"]},
  "Sweeps shavings and sharpens tools.": {"kind": "role", "clips": ["work_sweep"]},
  "Sweeps the church and trims the lamps.": {"kind": "role", "clips": ["work_sweep"]},
  "Sweeps the church porch.": {"kind": "role", "clips": ["work_sweep"]},
  "Sweeps the meal floor and watches the stones.": {"kind": "role", "clips": ["work_sweep"]},
  "Takes the steward's messages.": {"kind": "role", "clips": ["work_address"]},
  "Teaches letters to the children who come.": {"kind": "role", "clips": ["work_read", "work_address"]},
  "Tells stories by the fire.": {"kind": "indoors"},
  "Tends the church-house garden.": {"kind": "role", "clips": ["work_dig", "work_hoe", "work_gather_herbs"]},
  "Tends the graves and the churchyard path.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Tends the hearth.": {"kind": "indoors"},
  "Tends the herb garden.": {"kind": "role", "clips": ["work_dig", "work_hoe", "work_gather_herbs"]},
  "Tends the hives and takes the wax.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Throws pots at the kick wheel.": {"kind": "role", "clips": ["work_throw_pot"]},
  "Ties straw and reed bundles.": {"kind": "role", "clips": ["work_bundle_straw"]},
  "Trades needles, ribbons and salt at the market.": {"kind": "role", "clips": ["work_sell"]},
  "Trades work and news in the courtyard.": {"kind": "talk"},
  "Trades work and news in the lanes.": {"kind": "talk"},
  "Trades work and news on the green.": {"kind": "talk"},
  "Travels the road with messages and news.": {"kind": "travel"},
  "Treads cloth in the fulling trough.": {"kind": "role", "clips": ["work_tread_cloth"]},
  "Trims and bundles candles for the church.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Turns hides in the pits.": {"kind": "role", "clips": ["work_stir"]},
  "Twists rope along the lane.": {"kind": "role", "clips": ["work_twist_rope"]},
  "Visits mothers and newborns.": {"kind": "travel"},
  "Visits the sick and injured in the lanes.": {"kind": "travel"},
  "Visits the sick and the elderly in the lanes.": {"kind": "travel"},
  "Walks out to the day's work.": {"kind": "travel"},
  "Walks slowly to the churchyard and back.": {"kind": "travel"},
  "Walks the arable strips and sets the day's labour.": {"kind": "travel"},
  "Walks the edge of the village and the woodland path in the lanes.": {"kind": "travel"},
  "Walks the hall stores with the keys.": {"kind": "travel"},
  "Walks the rounds of the watch in the lanes.": {"kind": "role", "clips": ["guard_patrol_walk"]},
  "Walks the rounds of the watch.": {"kind": "role", "clips": ["guard_patrol_walk"]},
  "Walks the village and checks repairs in the lanes.": {"kind": "travel"},
  "Walks the village and speaks with the households.": {"kind": "travel"},
  "Warps the loom and winds bobbins.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Washes and beats linen at the river.": {"kind": "role", "clips": ["work_wash_linen"]},
  "Washes before supper.": {"kind": "indoors"},
  "Watches the flock and checks the lambs.": {"kind": "role", "clips": ["work_herd", "guard_lookout"]},
  "Watches the flock come home along the lane.": {"kind": "role", "clips": ["work_herd", "guard_lookout"]},
  "Watches the lambs with the shepherd.": {"kind": "role", "clips": ["work_herd", "guard_lookout"]},
  "Watches the pigs under the trees.": {"kind": "role", "clips": ["work_herd", "guard_lookout"]},
  "Waters the herb garden.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Weaves at the upright loom.": {"kind": "role", "clips": ["work_weave"]},
  "Weaves baskets at the doorstep.": {"kind": "role", "clips": ["work_weave_basket"]},
  "Weaves fine cloth at the loom.": {"kind": "role", "clips": ["work_weave"]},
  "Weaves plain cloth at the second loom.": {"kind": "role", "clips": ["work_weave"]},
  "Weeds and picks in the herb garden.": {"kind": "role", "clips": ["work_dig", "work_hoe", "work_gather_herbs"]},
  "Weeds and waters the beans and cabbages.": {"kind": "role", "clips": ["work_dig", "work_hoe", "work_gather_herbs"]},
  "Weighs and bags meal for each household.": {"kind": "role", "clips": ["work_tend_mill"]},
  "Whittles at the cottage door.": {"kind": "role", "clips": ["work_whittle"]},
  "Whittles pegs and watches the lane.": {"kind": "role", "clips": ["work_whittle"]},
  "Winds yarn and minds the children.": {"kind": "unpresentable", "planned": "dedicated activity loop not published"},
  "Writes letters for villagers who ask in the lanes.": {"kind": "role", "clips": ["work_write"]},
  "Writes up the day's tallies.": {"kind": "role", "clips": ["work_write"]},
});

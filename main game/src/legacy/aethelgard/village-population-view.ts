import { Box3, Frustum, Group, Matrix4, Sphere, type Camera, type Object3D, Vector3 } from 'three';
import { EALDHOLT_VILLAGE_POPULATION } from '../../../../shared/legacy/aethelgard/characters/village-population';
import { getPopulationArt } from '../../../../shared/legacy/aethelgard/characters/village-population-art';
import { selectVillagePresence, type PresenceRequest, type PresenceSelection } from '../../../../shared/legacy/aethelgard/characters/village-presence';
import { getHouseholdArtSet } from '../../../../shared/legacy/aethelgard/characters/household-art-sets';
import type { VillagePopulationResidentState, VillagePopulationSample } from '../../../../shared/legacy/aethelgard/characters/village-population-runtime';
import { summarizeVillageLife } from '../../../../shared/legacy/aethelgard/characters/village-life';
import { createPopulationEndpointAdmission } from '../../../../shared/legacy/aethelgard/characters/population-endpoint-admission';
import { createResidentProcessingBudget, type ResidentProcessingScheduler } from '../../../../shared/legacy/aethelgard/characters/resident-processing-budget';
import { resolvePopulationPresentation, populationPresentationHeldReason, displayPopulationActivity } from '../../../../shared/legacy/aethelgard/characters/village-activity-presentation';
import { planGuardWatchDwell } from '../../../../shared/legacy/aethelgard/characters/guard-watch-dwell';
import { CODEX_OWNER_MOTIONS, type CrowdActivity } from '../../../../shared/legacy/aethelgard/characters/crowd-binding';
import { createCrowdPresenter, type CrowdResidentFrameState } from './characters/crowd-residents';
import { createHouseholdPresenter } from './characters/household-residents';
import { createEaldholtResidentActors } from './resident-actors';
import type { ResidentAnimationEvent } from '../../../../shared/legacy/aethelgard/characters/resident-animation-execution';
import type { EmergencyHeldProp, EmergencyRepairEquipment, EmergencyWorkpiece } from './emergency-action-visuals';
import {preparePopulationVisualTravel,samplePopulationVisualTravel,type PopulationVisualTravel} from '../../../../shared/legacy/aethelgard/characters/population-visual-travel';
import {validateVillageSiteEmergencyTraversals,sameVillageSiteEmergencyTraversal} from '../../../../shared/legacy/aethelgard/characters/village-emergency-traversal';
import {validateVillageSiteEmergencyTargets,sameVillageSiteEmergencyTarget} from '../../../../shared/legacy/aethelgard/characters/village-emergency-targets';
import {validateVillageSiteEmergencyRefuges,sameVillageSiteEmergencyRefuge} from '../../../../shared/legacy/aethelgard/characters/village-emergency-refuges';
import {validateVillageSiteWorkplaceRoutes,sameVillageSiteWorkplaceRoute} from '../../../../shared/legacy/aethelgard/characters/village-workplace-routes';
import { qualifyPopulationMotion, type PopulationMotionEvidence } from '../../../../shared/legacy/aethelgard/characters/population-motion-clearance';
import type { VillageSiteLayout } from '../../../../shared/legacy/aethelgard/characters/village-site';
import { describeVillageResidentAvailability, holdVillageResidentAvailability, pendingVillageResidentAvailability, presentedVillageResidentAvailability, type VillageResidentAvailability } from '../../../../shared/legacy/aethelgard/characters/village-resident-availability';

/** Source-space bodies are transformed by the real source root exactly once.
 * The real Desktop camera supplies the visibility frustum. */
export class EaldholtPopulationFrustum {
  private readonly frusta = [new Frustum(), new Frustum()];
  private readonly projection = new Matrix4();
  private readonly inverse = new Matrix4();
  private readonly sourceToWorld = new Matrix4();
  private readonly box = new Box3();
  private readonly sphere = new Sphere();
  private count = 0;

  refresh(sourceRoot: Object3D, cameras: readonly Camera[]): void {
    if (cameras.length < 1 || cameras.length > 2) throw Error('Population presence needs one or two actual cameras.');
    sourceRoot.updateWorldMatrix(true, false);
    this.sourceToWorld.copy(sourceRoot.matrixWorld);
    this.count = cameras.length;
    for (let i = 0; i < this.count; i++) {
      const camera = cameras[i]; camera.updateWorldMatrix(true, false);
      this.inverse.copy(camera.matrixWorld).invert();
      this.projection.multiplyMatrices(camera.projectionMatrix, this.inverse);
      this.frusta[i].setFromProjectionMatrix(this.projection);
    }
  }

  intersects(position: readonly [number, number, number], statureMetres: number, completeBounds?: Box3 | null): boolean {
    if (!this.count) return false;
    if (completeBounds && !completeBounds.isEmpty()) this.box.copy(completeBounds);
    else {
      // The actual published stature bounds an actor before its complete
      // body/prop envelope has loaded. It is only a conservative culling box.
      this.box.min.set(position[0] - 1, position[1] - .2, position[2] - 1);
      this.box.max.set(position[0] + 1, position[1] + statureMetres + .2, position[2] + 1);
    }
    this.box.applyMatrix4(this.sourceToWorld).getBoundingSphere(this.sphere);
    for (let i = 0; i < this.count; i++) if (this.frusta[i].intersectsSphere(this.sphere)) return true;
    return false;
  }
}

/** Identity actor group: the village caller parents it under the source model.
 * Its metre placements inherit the source scale, centre and presentation pivot. */
export function createEaldholtPopulationRoot(): Group {
  const group = new Group(); group.name = 'EaldholtVillagePopulation';
  group.userData.crownfallPopulationFrame = 'original-source-metres';
  return group;
}

export interface EaldholtPopulationFrame {
  readonly sample: VillagePopulationSample;
  readonly clockSeconds: number;
  readonly paused?: boolean;readonly animationRate?: number;
}

const registeredResidents = new Map(EALDHOLT_VILLAGE_POPULATION.residents.map(row => [row.id, row]));
const registeredHouseholds = new Map(EALDHOLT_VILLAGE_POPULATION.households.map(row => [row.id, row]));

/** Diagnostic facts keep simulated lives separate from certified placement.
 * None of these records grants a missing animation, entrance or work pose. */
export function describeEaldholtPopulationLife(sample: VillagePopulationSample, cached?: {
  readonly summary: ReturnType<typeof summarizeVillageLife>;
  readonly recentEvents: NonNullable<VillagePopulationSample['life']>['journal'];
} | null) {
  const life = sample.life;
  if (!life) return null;
  const physical = new Map(sample.residents.map(row => [row.residentId, row]));
  const latest = new Map<string, typeof life.journal[number]>();
  for (const event of life.journal) for (const id of event.actorIds) latest.set(id, event);
  const residents = Object.fromEntries(life.residents.map(resident => {
    const registered = registeredResidents.get(resident.residentId)!;
    const row = physical.get(resident.residentId);
    return [resident.residentId, Object.freeze({ residentId: resident.residentId, label: registered.label,
      householdId: registered.householdId, householdMemberIds: registeredHouseholds.get(registered.householdId)!.memberIds,
      family: registered.registry.family, roleId: registered.roleId, roleLabel: registered.roleLabel, homePlaceId: resident.homePlaceId,
      workPlaceId: resident.workPlaceId, simulatedPlaceId: resident.simulatedPlaceId,
      intent: resident.intent, status: resident.status, needs: resident.needs, counters: resident.counters,
      relationships: resident.relationships, latestEvent: latest.get(resident.residentId) ?? null,
      presentation: Object.freeze({ activity: row ? displayPopulationActivity(row) : null,
        patrol: row?.patrol ?? null, emergency: row?.emergency ?? null,
        ordinaryWork:row?.ordinaryWork??null,neutralReturnMotion:row?.neutralReturnMotion??null,workplaceMotion:row?.workplaceMotion??null,routineAction:row?.routineAction??null,
        status: row?.navigationStatus ?? null, reason: row?.navigationReason ?? row?.reason ?? null,
        position: row?.position ?? null, arrivalEvidence: row?.arrivalEvidence ?? 'none',
        arrivedAtAbsoluteMinute: row?.arrivedAtAbsoluteMinute ?? null, sourcePlacePresentable: row?.presentable ?? false }) })];
  }));
  return Object.freeze({ navigationAuthority: sample.navigationAuthority ?? 'schedule-projection',
    counterProvenance: 'simulated-routine' as const, summary: Object.freeze(cached?.summary ?? summarizeVillageLife(life)),
    households: life.households, residents: Object.freeze(residents), recentEvents: Object.freeze(cached?.recentEvents ?? life.journal.slice(-8)) });
}

/** Cache immutable life diagnostics; selection is resolved separately by ID. */
export function createEaldholtPopulationDiagnosticsCache() {
  let previousLife: Parameters<typeof summarizeVillageLife>[0] | null | undefined;
  let summary: { counterProvenance: 'simulated-routine'; summary: ReturnType<typeof summarizeVillageLife>;
    recentEvents: Parameters<typeof summarizeVillageLife>[0]['journal'] } | null = null;
  let previousPresentationLife: ReturnType<typeof describeEaldholtPopulationLife> | undefined;
  let encodedLife = 'null';
  return {
    read(life: Parameters<typeof summarizeVillageLife>[0] | null | undefined) {
      if (life !== previousLife) {
        previousLife = life;
        summary = life ? { counterProvenance: 'simulated-routine',
          summary: summarizeVillageLife(life), recentEvents: life.journal.slice(-8) } : null;
      }
      return summary;
    },
    serializeSnapshot<T extends { readonly life: ReturnType<typeof describeEaldholtPopulationLife> }>(snapshot: T | null): string {
      if (!snapshot) return 'null';
      const { life, ...metadata } = snapshot;
      if (life !== previousPresentationLife) { previousPresentationLife = life; encodedLife = JSON.stringify(life); }
      const encodedMetadata = JSON.stringify(metadata);
      return `${encodedMetadata.slice(0, -1)}${encodedMetadata.length > 2 ? ',' : ''}"life":${encodedLife}}`;
    },
    clear(): void { previousLife = undefined; summary = null; previousPresentationLife = undefined; encodedLife = 'null'; },
  };
}

/** Only an explicitly validated source station can authorize a work pose.
 * Source route endpoints alone prove standing clearance, never tool facing. */
export function qualifyEaldholtWorkplacePose(state: VillagePopulationResidentState,
  anchors: Readonly<Record<string, { readonly position: readonly [number, number, number]; readonly yawRadians: number }>> | undefined): VillagePopulationResidentState {
  if (state.workPoseQualified !== false || state.waitingForResource || state.moving || state.status !== 'at-place' || !state.position
    || !Number.isFinite(state.yawRadians) || !state.position.every(Number.isFinite)) return state;
  const art = getHouseholdArtSet(state.residentId), anchor = anchors?.[state.residentId];
  if (!art || !anchor || state.lifeIntent?.activityKey !== 'work'
    || state.lifeIntent.targetPlaceId !== art.workPlaceId || state.placeId !== art.workPlaceId) return state;
  const yawDelta = Math.atan2(Math.sin(state.yawRadians - anchor.yawRadians), Math.cos(state.yawRadians - anchor.yawRadians));
  if (Math.abs(yawDelta) > 1e-5 || state.position.some((value, i) => Math.abs(value - anchor.position[i]) > 1e-5)) return state;
  return { ...state, workPoseQualified: true };
}

export interface EaldholtVillagePopulationViewOptions {
  readonly camera: Camera;
  readonly viewportHeight: () => number;
  /** Current real renderer submission frame; omitted callers report draw evidence as unknown. */
  readonly renderFrame?: () => number;
  readonly sourceRoot: Object3D;
  readonly root: string;
  readonly integritySha256: Readonly<Record<string, string>>;
  readonly site: VillageSiteLayout;
  /** Identity already verified against the loaded GLB and site certificate. */
  readonly sourceIdentity: { readonly profile: VillageSiteLayout['profile']; readonly sha256: string };
  readonly motionEvidence: PopulationMotionEvidence | null;
  /** Reads the independent shared clock; the caller advances it even while hidden. */
  readonly readFrame: () => EaldholtPopulationFrame;
  /** Inspection priority only; this grants no placement or animation evidence. */
  readonly readFollowedResidentId?: () => string | null;
  /** Optional host CPU-task scheduler; never a renderer/RAF scheduler. */
  readonly processingScheduler?: ResidentProcessingScheduler;
  readonly workplaceAnchors?: Readonly<Record<string, { readonly position: readonly [number, number, number]; readonly yawRadians: number }>>;
  readonly onBoundsChanged?: (sourceBounds: Box3) => void;
  /** Wake a static renderer after a visible CPU-task commit or safety hold. */
  readonly onPresentationChanged?: () => void;
  readonly onError?: (residentId: string, error: unknown) => void;
}

/** Presents the complete registered population using one shared 100-slot budget.
 * The independent 4 Hz timer samples all 100 lives. It creates no replacement
 * places, route shortcuts, stand-in people or inferred work animations. */
export function createEaldholtVillagePopulationView(options: EaldholtVillagePopulationViewOptions) {
  let emergencySiteRevision=0;
  let currentSite=options.site, endpointAdmission = createPopulationEndpointAdmission(currentSite);
  const emergencyContacts=new Map<string,ResidentAnimationEvent>();
  const diagnosticsCache = createEaldholtPopulationDiagnosticsCache();
  const actuallyDrawn = new Set<string>();
  const failedActors = new Set<string>();
  type Qualification = { state: VillagePopulationResidentState; presentation: ReturnType<typeof resolvePopulationPresentation>;
    qualification: ReturnType<typeof qualifyPopulationMotion>; availability: VillageResidentAvailability; travel:PopulationVisualTravel|null };
  const qualifications = new Map<string, Qualification>();
  const immediateHolds = new Set<string>();
  const latestRequestedStates = new Map<string, VillagePopulationResidentState>();
  let requestedFrame: EaldholtPopulationFrame | null = null, processingPending = false;
  const onActorError = (id: string, error: unknown) => { failedActors.add(id); options.onError?.(id, error); };
  const object = createEaldholtPopulationRoot(), frustum = new EaldholtPopulationFrustum();
  const cameras: Camera[] = [options.camera];
  const sourceInverse = new Matrix4(), eye = new Vector3(), direction = new Vector3();
  const forward: [number, number] = [0, -1];
  const crowd = createCrowdPresenter({ root: options.root, parent: object,
    integritySha256: options.integritySha256, ownerMotions: CODEX_OWNER_MOTIONS.patched, maxSetupsPerFrame: 1, setupBudgetMilliseconds: 4,
    prefetchSets: false, props: true, trustPublishedEnvelopes: true,
    createActors: createEaldholtResidentActors, onError: onActorError,
    onAnimationEvent(event) {
      if(event.kind==='marker'&&event.markerKind==='contact')emergencyContacts.set(event.ownerId,Object.freeze({...event}));
      else if(event.kind==='lifecycle')emergencyContacts.delete(event.ownerId);
    } });
  const household = createHouseholdPresenter({ root: options.root, parent: object, platform: 'desktop',
    integritySha256: options.integritySha256, workplaceAnchors: options.workplaceAnchors, onError: onActorError });
  type VisualState={-readonly[K in keyof CrowdResidentFrameState]:CrowdResidentFrameState[K]};
  const visualPositions=new Map<string,[number,number,number]>();
  const states = new Map<string, VisualState>(), activities = new Map<string, CrowdActivity>();
  const heldReasons: Record<string, number> = {};
  const requests: PresenceRequest[] = [], stature = new Map<string, number>();
  const focusPosition: [number, number, number] = [0, 0, 0];
  const viewer = { platform: 'desktop-isometric' as const, position: focusPosition,
    forward, halfFovDegrees: 180, pixelsPerDegree: 20 };
  const frame: { clockSeconds: number; paused: boolean; reducedMotion: boolean; residents: ReadonlyMap<string, CrowdResidentFrameState> } = {
    clockSeconds: 0, paused: false, reducedMotion: false, residents: states };
  const bounds = new Box3(), previousBounds = new Box3();
  for (const resident of EALDHOLT_VILLAGE_POPULATION.residents) stature.set(resident.id, getPopulationArt(resident.id)!.statureMetres);
  let selection: PresenceSelection | null = null, sample: VillagePopulationSample | null = null;
  let active = false, disposed = false, tickAt = 0, clockSeconds = 0, held = 0, lastError = '', animationRate = 1;
  let visualKey = '', visualRevision = 0;
  let clockReady=false,visualClockOriginSeconds=0,visualClockOriginAt=0,visualClockBoundary=Infinity;
  function visualClockAt(now:number):number { return Math.min(visualClockBoundary,visualClockOriginSeconds+(frame.paused?0:Math.max(0,now-visualClockOriginAt)/1000*animationRate)); }
  let navigationAuthority: VillagePopulationSample['navigationAuthority'];
  let processingContext = '';
  let presentationWakeKey = '[]';
  let requestedAbsoluteMinute = -Infinity;
  let lifeDiagnostics: ReturnType<typeof describeEaldholtPopulationLife> = null;

  function refreshFrustum(): void {
    frustum.refresh(options.sourceRoot, cameras);
  }

  function completeBoundsFor(id: string): Box3 | null {
    return crowd.completeBoundsFor(id) ?? household.completeBoundsFor(id);
  }

  function notifyPresentationChanged(): void {
    if (disposed || !options.onPresentationChanged) return;
    // A source clock, life counter, cache hit or held/offscreen row alone
    // cannot wake an otherwise static full-world renderer.
    const visible = active && object.visible ? (selection?.drawn ?? []).filter(id => !immediateHolds.has(id)) : [];
    const key = visible.length ? JSON.stringify([processingContext, visible.map(id => {
      const state = states.get(id), decision = selection!.decisions[id];
      return [id, qualifications.get(id)?.availability.body, state?.position, state?.yawRadians, state?.motion,
        state?.talking, activities.get(id), decision.mode, decision.updateHz];
    })]) : '[]';
    if (key === presentationWakeKey) return;
    presentationWakeKey = key; options.onPresentationChanged();
  }

  function residentAvailability(id: string): VillageResidentAvailability {
    const entry = qualifications.get(id);
    if (!entry) return pendingVillageResidentAvailability(id, sample?.residents.find(row => row.residentId === id));
    if (lastError) return holdVillageResidentAvailability(entry.availability, 'presentation-error');
    if (immediateHolds.has(id)) return holdVillageResidentAvailability(entry.availability, 'presentation-requalification-pending');
    const owner = crowd.actorsFor(id) ?? household.actorsFor(id);
    const actor = owner?.actors.find(row => row.residentId === id);
    if (actor?.status === 'unavailable-motion' || !actor && failedActors.has(id))
      return holdVillageResidentAvailability(entry.availability, 'actor-unavailable');
    const ready = !!actor && actor.status === 'ready';
    const renderFrame = options.renderFrame?.() ?? null;
    const visualPosition=entry.travel?states.get(id)?.position:null;
    const available=visualPosition?Object.freeze({...entry.availability,position:Object.freeze([...visualPosition]) as readonly[number,number,number]}):entry.availability;
    // Existing presenters own qualified entry/exit phases; this observes the
    // body's actual submission at the current qualified source position.
    const matchingDraw = active && object.visible && owner?.object.visible && actor && available.position
      && actor.lastRenderedCamera != null && cameras.includes(actor.lastRenderedCamera)
      && actor.lastRenderedPosition && available.position.every((v, i) => Math.abs(v - actor.lastRenderedPosition![i]) <= 1e-6);
    return presentedVillageResidentAvailability(available, ready, matchingDraw ? actor!.lastRenderedFrame ?? null : null, renderFrame);
  }

  type CapturedFrame = EaldholtPopulationFrame & { readonly sampledAt: number };
  function presentationError(error: unknown): void {
    object.visible = false; lastError = error instanceof Error ? error.message : 'Population presentation failed.';
    options.onError?.('population', error); notifyPresentationChanged();
  }
  const processing = createResidentProcessingBudget<CapturedFrame, Qualification>({
    scheduler: options.processingScheduler,
    expensive: state => state.presentable,
    qualify(sampledState) {
      const state = qualifyEaldholtWorkplacePose(sampledState, options.workplaceAnchors);
      const presentation = resolvePopulationPresentation(state);
      const qualification = qualifyPopulationMotion(state, presentation, currentSite, options.motionEvidence, 'desktop', options.sourceIdentity);
      return { state, presentation, qualification, availability: describeVillageResidentAvailability(state, presentation, qualification),travel:qualification.presentable?preparePopulationVisualTravel(state,currentSite):null };
    },
    accepted: publish,
    onError: presentationError,
  });

  function continuityKey(state: VillagePopulationResidentState, presentation: ReturnType<typeof resolvePopulationPresentation>): string {
    // Continuous progress can retain its previous certified body while the
    // complete frame finishes. Every other source/action/ownership fact must
    // still match the latest request, including clock-derived action phase.
    return JSON.stringify([{ ...state, position: null, yawRadians: 0, patrolDwell: undefined, emergency:state.emergency?{...state.emergency,actionElapsedSeconds:0}:undefined },
      presentation.presentable, presentation.motion, presentation.activity]);
  }

  function revokeSupersededPresentations(qualified: ReadonlyMap<string, Qualification>): void {
    for (const [id, previous] of qualified) {
      if (previous.availability.body !== 'qualified' || immediateHolds.has(id)) continue;
      const row = latestRequestedStates.get(id);
      const state = row && qualifyEaldholtWorkplacePose(row, options.workplaceAnchors);
      const presentation = state && resolvePopulationPresentation(state);
      if (!state || !presentation?.presentable || continuityKey(state, presentation) !== continuityKey(previous.state, previous.presentation))
        immediateHolds.add(id);
    }
    // A hold survives disappearance, camera culling and later requests. Only
    // a complete publication of the latest request may release it.
    for (const id of immediateHolds) {
      const owner = crowd.actorsFor(id) ?? household.actorsFor(id);
      if (owner) owner.object.visible = false;
    }
  }

  function tick(): void {
    if (disposed) return;
    try {
      const next = options.readFrame();
      actuallyDrawn.clear();
      for (const id of selection?.drawn ?? []) {
        const actor = crowd.actorsFor(id) ?? household.actorsFor(id);
        if (active && actor?.object.visible) actuallyDrawn.add(id);
      }
      // Source sites and motion evidence are byte-validated immutable inputs.
      // Include their source/revision plus the small authored pose contract;
      // never use mutable caller identity as qualification evidence.
      const context = JSON.stringify([emergencySiteRevision,next.sample.navigationAuthority, currentSite.profile, currentSite.sourceSha256,
        currentSite.navigationRevision, currentSite.capsule, options.workplaceAnchors, options.sourceIdentity]);
      const absoluteMinute = next.sample.time.absoluteWorldMinute + next.sample.time.fractionalMinute;
      if (processingContext !== context || absoluteMinute < requestedAbsoluteMinute) {
        endpointAdmission.clear(); object.visible = false;
      }
      processingContext = context; requestedAbsoluteMinute = absoluteMinute;
      navigationAuthority = next.sample.navigationAuthority;
      // Read the complete runtime sample first: its source ownership, hidden
      // peers and corridors are checked on every request, before any reuse.
      const captured = { ...next, sampledAt: performance.now(), sample: navigationAuthority === 'resident-life' ? next.sample
        : endpointAdmission.sample(next.sample, performance.now(), actuallyDrawn) };
      requestedFrame = captured; processingPending = true;
      latestRequestedStates.clear();
      for (const row of captured.sample.residents) latestRequestedStates.set(row.residentId, row);
      revokeSupersededPresentations(qualifications);
      notifyPresentationChanged();
      if (active) {
        options.sourceRoot.updateWorldMatrix(true, false); sourceInverse.copy(options.sourceRoot.matrixWorld).invert();
        options.camera.getWorldPosition(eye).applyMatrix4(sourceInverse);
        focusPosition[0] = eye.x; focusPosition[1] = eye.y; focusPosition[2] = eye.z;
      }
      const followed = options.readFollowedResidentId?.();
      processing.request(captured, context, row => {
        if (row.residentId === followed) return 1e9;
        const p = row.position, distance = p ? Math.hypot(p[0] - focusPosition[0], p[2] - focusPosition[2]) : Infinity;
        return (actuallyDrawn.has(row.residentId) ? 1e6 : 0) - distance;
      });
    } catch (error) { presentationError(error); }
  }

  function publish(next: CapturedFrame, qualified: ReadonlyMap<string, Qualification>): void {
    if (disposed) return;
    try {
      // Sample, qualification, source clock and pause/rate travel as one frame.
      const diagnosticsUnchanged = sample?.life === next.sample.life && sample?.navigationAuthority === next.sample.navigationAuthority
        && qualifications.size === qualified.size && [...qualified].every(([id, entry]) => qualifications.get(id)?.state === entry.state);
      const previousVisualClock=clockReady?visualClockAt(next.sampledAt):next.clockSeconds;
      const rewound=clockReady&&next.clockSeconds<clockSeconds-1e-7;
      const nextRate=Number.isFinite(next.animationRate)?Math.max(0,Math.min(16,next.animationRate!)):1;
      if(!clockReady||rewound||next.clockSeconds!==clockSeconds||!!next.paused!==frame.paused||nextRate!==animationRate){
        visualClockBoundary=next.clockSeconds+(next.sample.visualAdvanceSeconds??Infinity);
        visualClockOriginSeconds=Math.min(visualClockBoundary,!clockReady||rewound?next.clockSeconds:Math.max(next.clockSeconds,previousVisualClock));
        visualClockOriginAt=next.sampledAt;clockReady=true;
      }
      sample = next.sample; processingPending = requestedFrame !== next;
      if (!processingPending) immediateHolds.clear();
      else revokeSupersededPresentations(qualified);
      qualifications.clear();
      for (const [id, cached] of qualified) {
        const entry = { ...cached };
        qualifications.set(id, entry);
      }
      if (!diagnosticsUnchanged) lifeDiagnostics = describeEaldholtPopulationLife(sample, diagnosticsCache.read(sample.life));
      object.userData.crownfallPopulationLife = lifeDiagnostics;
      clockSeconds = next.clockSeconds; tickAt=next.sampledAt;frame.paused=!!next.paused;animationRate=nextRate;frame.clockSeconds=visualClockAt(performance.now());
      const nextVisualKey = sample.residents.map(row => `${row.residentId}:${row.slotIndex}:${row.status}:${row.lifeIntent?.activityKey ?? ''}:${row.lifeIntent?.issuedAbsoluteMinute ?? ''}:${row.lifeIntent?.targetPlaceId ?? ''}:${row.navigationStatus ?? ''}:${row.lifeStatus ?? ''}:${row.presentable}:${row.reason ?? ''}:${row.patrol?.waypointPlaceId ?? ''}:${planGuardWatchDwell(row)?.motion ?? ''}:${row.emergency?.phase ?? ''}:${row.emergency?.stationId ?? ''}`).join('|');
      if (nextVisualKey !== visualKey) { visualKey = nextVisualKey; visualRevision++; }
      object.visible = active;
      if (!active) return;
      refreshFrustum(); requests.length = 0; states.clear(); activities.clear(); held = 0;
      for (const key of Object.keys(heldReasons)) delete heldReasons[key];
      options.sourceRoot.updateWorldMatrix(true, false); sourceInverse.copy(options.sourceRoot.matrixWorld).invert();
      options.camera.getWorldPosition(eye).applyMatrix4(sourceInverse);
      options.camera.getWorldDirection(direction).transformDirection(sourceInverse);
      focusPosition[0] = eye.x; focusPosition[1] = eye.y; focusPosition[2] = eye.z;
      forward[0] = direction.x; forward[1] = direction.z;
      viewer.pixelsPerDegree = options.viewportHeight() / ('fov' in options.camera ? Number(options.camera.fov) : 45);
      for (const sampledState of sample.residents) {
        const { state, presentation, qualification, availability } = qualifications.get(sampledState.residentId)!;
        const position = state.position;
        const presentable = availability.body === 'qualified' && !immediateHolds.has(state.residentId);
        if (!presentable) { held++; const reason = populationPresentationHeldReason(state, presentation, qualification) ?? 'not-presentable'; heldReasons[reason] = (heldReasons[reason] ?? 0) + 1; }
        let feet=visualPositions.get(state.residentId);if(!feet){feet=[0,0,0];visualPositions.set(state.residentId,feet);}for(let k=0;k<3;k++)feet[k]=position?.[k]??0;
        requests.push({ residentId: state.residentId, tier: state.tier, position: feet,
          heightMetres: stature.get(state.residentId)!, presentable, moving: state.moving, interaction: 'none',
          current: selection?.decisions[state.residentId]?.mode ?? null,
          inFrustum: presentable && frustum.intersects(feet, stature.get(state.residentId)!, completeBoundsFor(state.residentId)) });
        if (presentable) {
          activities.set(state.residentId, presentation.activity);
          states.set(state.residentId, { residentId: state.residentId, motion: presentation.motion!, position: feet,
            yawRadians: state.yawRadians, fadeSeconds: presentation.fadeSeconds ?? 0,
            ...(state.refugeMotion||state.workplaceMotion||state.ordinaryWork||state.neutralReturnMotion?{strictMotionPlan:true as const}:{}),
            ...(presentation.animationTimeSeconds !== undefined ? {animationTimeSeconds:presentation.animationTimeSeconds,animationTimeMode:presentation.animationTimeMode}:{}),
            talking: presentation.motion === 'talk' });
        }
      }
      selection = selectVillagePresence(viewer, requests);
      const report = crowd.sync(selection, activities);
      if (report.unpresentable.length) {
        for (const id of report.unpresentable) {
          const entry = qualifications.get(id);
          if (entry) entry.availability = holdVillageResidentAvailability(entry.availability, 'actor-plan-unavailable');
          const request = requests.find(row => row.residentId === id);
          if (request) requests[requests.indexOf(request)] = { ...request, presentable: false };
          states.delete(id); held++;
        }
        selection = selectVillagePresence(viewer, requests); crowd.sync(selection, activities);
      }
      const householdReport = household.sync(selection, activities);
      for (const id of householdReport.unpresentable) {
        const entry = qualifications.get(id);
        if (entry) entry.availability = holdVillageResidentAvailability(entry.availability, 'actor-plan-unavailable');
      }
      notifyPresentationChanged();
    } catch (error) {
      presentationError(error);
    }
  }

  const timer = setInterval(tick, 250);
  object.visible = false;
  return {
    object,
    readSite(): VillageSiteLayout { return currentSite; },
    /** Accept only additional resident-specific disaster destinations on the
     * unchanged certified graph. Canonical homes/routines/allocation stay owned
     * by the original site and cannot be replaced through this presenter. */
    setEmergencySite(next: VillageSiteLayout): void {
      if(disposed)throw Error('Population presenter is disposed.');
      const base=options.site,{residentPlaceBindings:baseRows,emergencyTargets:_baseTargets,emergencyTraversals:_baseTraversals,emergencyRefuges:_baseRefuges,workplaceRoutes:_baseWorkplaces,...baseFacts}=base,{residentPlaceBindings:nextRows,emergencyTargets:_,emergencyTraversals:_traversals,emergencyRefuges:_refuges,workplaceRoutes:_workplaces,...nextFacts}=next;
      const certificates=validateVillageSiteEmergencyTargets(next),traversals=validateVillageSiteEmergencyTraversals(next),refuges=validateVillageSiteEmergencyRefuges(next);
      const {emergencyTargets:baseTargets,emergencyTraversals:baseTraversals,emergencyRefuges:baseRefuges,residentPlaceBindings:acceptedRows}=currentSite;
      const workplaces=validateVillageSiteWorkplaceRoutes(next);
      if((currentSite.workplaceRoutes??[]).some(old=>!workplaces.some(route=>sameVillageSiteWorkplaceRoute(old,route))))throw Error('Source site changed an accepted workplace route.');
      if((baseRefuges??[]).some(old=>!refuges.some(r=>sameVillageSiteEmergencyRefuge(old,r))))throw Error('Emergency site changed an existing source refuge.');
      if((baseTraversals??[]).some(old=>!traversals.some(t=>sameVillageSiteEmergencyTraversal(old,t))))throw Error('Emergency site changed an existing measured carry route.');
      if((baseTargets??[]).some(old=>!certificates.some(t=>sameVillageSiteEmergencyTarget(old,t))))throw Error('Emergency site changed an existing source action target.');
      if(nextRows.length<acceptedRows.length||acceptedRows.some((row,i)=>JSON.stringify(row)!==JSON.stringify(nextRows[i])))throw Error('Emergency site changed an existing resident station.');
      if(JSON.stringify(baseFacts)!==JSON.stringify(nextFacts)||nextRows.length<baseRows.length
        ||baseRows.some((row,i)=>JSON.stringify(row)!==JSON.stringify(nextRows[i])))throw Error('Emergency site changed the certified source graph or authored places.');
      const residentIds=new Set(EALDHOLT_VILLAGE_POPULATION.residents.map(person=>person.id)),anchors=new Set(base.anchors.map(anchor=>anchor.id));
      const places=new Set(EALDHOLT_VILLAGE_POPULATION.registry.places.map(row=>row.id)),seen=new Set(baseRows.map(row=>`${row.residentId}\0${row.placeId}`));
      if(refuges.some(r=>!residentIds.has(r.residentId)||places.has(r.placeId)))throw Error('Emergency site refuge cannot replace a registered resident or place.');
      for(const row of nextRows.slice(baseRows.length)){
        const key=`${row.residentId}\0${row.placeId}`;
        if(!residentIds.has(row.residentId)||!certificates.some(t=>t.residentId===row.residentId&&t.placeId===row.placeId&&t.anchorId===row.anchorId)
          ||places.has(row.placeId)||seen.has(key)||row.status!=='mapped-exterior'||!row.anchorId||!anchors.has(row.anchorId))throw Error('Emergency site needs a unique resident station on an existing certified anchor.');
        seen.add(key);
      }
      if(currentSite===next)return;
      endpointAdmission.clear();currentSite=next;endpointAdmission=createPopulationEndpointAdmission(next);
      for(const id of qualifications.keys())immediateHolds.add(id);
      emergencyContacts.clear();clockReady=false;emergencySiteRevision++;processingContext='';object.visible=false;tick();
    },
    setWorkplaceSite(next:VillageSiteLayout):void { this.setEmergencySite(next); },
    emergencyPropFor(id:string,kind:EmergencyHeldProp['kind']):EmergencyHeldProp|null { return crowd.emergencyPropFor(id,kind)??household.emergencyPropFor(id,kind); },
    async loadEmergencyWorkpieceTemplate(id:string):Promise<EmergencyRepairEquipment|null> { return await crowd.loadEmergencyWorkpieceTemplate(id)??await household.loadEmergencyWorkpieceTemplate(id); },
    emergencyWorkpieceFor(id:string):EmergencyWorkpiece|null { return crowd.emergencyWorkpieceFor(id)??household.emergencyWorkpieceFor(id); },
    /** Actual evaluated marker copied from the actor owner during this update. */
    emergencyContactEventFor(id:string):ResidentAnimationEvent|null { return emergencyContacts.get(id)??null; },
    /** Ordinary work consumes only the actor's evaluated marker while its saved
     * command is performing; a routine label alone grants no contact. */
    workContactEventFor(id:string):ResidentAnimationEvent|null {
      return sample?.residents.find(row=>row.residentId===id)?.routineAction?.step==='perform'?emergencyContacts.get(id)??null:null;
    },
    /** Same sampled frame and pre-cull qualification used by this adapter. */
    get sample(): VillagePopulationSample | null { return sample; },
    residentAvailability,
    /** Presentation activity never pauses the caller's population clock. */
    setActive(value: boolean): void {
      if (disposed || active === value) return;
      active = value; object.visible = value; if (value) tick();
      notifyPresentationChanged();
    },
    /** Service ready body setups while an environment frame is in flight.
     * This never samples/advances the world clock or runs actor mixers. */
    prepare(): number {
      return disposed || !active || lastError ? 0 : crowd.prepare();
    },
    update(deltaSeconds: number, reducedMotion: boolean): void {
      if (disposed || !active || lastError) return;
      if (!processingPending) frame.clockSeconds=visualClockAt(performance.now());
      const visualElapsed=Math.max(0,Math.min(sample?.visualAdvanceSeconds??0,frame.clockSeconds-clockSeconds));
      for(const[id,state]of states){const qualified=qualifications.get(id);if(!qualified)continue;
        const point=visualPositions.get(id);if(qualified.travel&&point){state.yawRadians=samplePopulationVisualTravel(qualified.travel,visualElapsed,point);state.position=point;}
        const pose=qualified.presentation;
        if(pose.animationTimeMode==='advance'&&pose.animationTimeSeconds!==undefined&&(qualified.state.emergency?.qualified||qualified.state.ordinaryWork?.qualified))
          state.animationTimeSeconds=pose.animationTimeSeconds+visualElapsed;
      }
      frame.reducedMotion = reducedMotion;
      emergencyContacts.clear();
      const paused = frame.paused; frame.paused = paused || processingPending;
      crowd.update(frame.paused ? 0 : deltaSeconds * animationRate, frame); household.update(frame.paused ? 0 : deltaSeconds * animationRate, frame);
      frame.paused = paused;
      for (const id of immediateHolds) { const owner = crowd.actorsFor(id) ?? household.actorsFor(id); if (owner) owner.object.visible = false; }
      refreshFrustum();
      // A camera turn hides stale offscreen selections immediately. The bounded
      // next decision (at most 250 ms) admits newly visible camera-visible actors.
      if (selection) for (const id of selection.drawn) {
        const state = states.get(id); if (!state) continue;
        const visible = frustum.intersects(state.position, stature.get(id)!, completeBoundsFor(id));
        const actor = crowd.actorsFor(id) ?? household.actorsFor(id);
        // Visibility may only remove an actor; it must not undo a presenter's
        // explicit hold for a missing role clip or failed asset binding.
        if (actor && !visible) actor.object.visible = false;
      }
      previousBounds.copy(bounds);
      bounds.union(crowd.completeBounds); bounds.union(household.bounds);
      if (!bounds.equals(previousBounds)) options.onBoundsChanged?.(bounds);
    },
    get bounds(): Box3 { return bounds; },
    get snapshot() {
      return { registered: 100, crowdRegistered: 96, householdRegistered: 4,
        metric: 'desktop-source-camera', decisionHz: 4, maximumDrawn: 100,
        selected: selection?.drawn.length ?? 0, held, heldReasons: { ...heldReasons }, motionEvidence: options.motionEvidence !== null, visualRevision,
        crossfadeSeconds: 0, counts: sample?.counts ?? null, time: sample?.time ?? null,
        processing: processing.diagnostics, processingPending, life: lifeDiagnostics, animationClockSeconds: frame.clockSeconds,visualClockAdvanceSeconds:Math.max(0,frame.clockSeconds-clockSeconds), animationPaused: frame.paused, animationRate,
        crowd: crowd.metrics, household: household.metrics, error: lastError, disposed };
    },
    async settled(): Promise<void> { await processing.settled(); await Promise.all([crowd.settled(), household.settled()]); },
    dispose(): void {
      if (disposed) return; disposed = true; active = false; clearInterval(timer); object.visible = false;
      processing.dispose(); diagnosticsCache.clear(); immediateHolds.clear(); latestRequestedStates.clear(); requestedFrame = null;
      try { crowd.dispose(); } finally { household.dispose(); }
      qualifications.clear(); failedActors.clear(); emergencyContacts.clear();
      states.clear(); visualPositions.clear(); activities.clear(); selection = null; sample = null;
      lifeDiagnostics = null; delete object.userData.crownfallPopulationLife;
      endpointAdmission.clear(); actuallyDrawn.clear();
    },
  };
}

export type EaldholtVillagePopulationView = ReturnType<typeof createEaldholtVillagePopulationView>;

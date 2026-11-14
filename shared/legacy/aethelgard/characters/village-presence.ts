/**
 * Village presence: which of the 100 persistent residents are drawn this frame (or this cadence tick), and how.
 *
 * WORKING PLACEHOLDER, Claude's character-art contract (7 November 2026; see
 * docs/legacy/characters/EALDHOLT_POPULATION_ART.md). Presence is a presentation decision only. Every resident keeps
 * its identity and persistent state whether drawn or not; simulation fidelity (deep, schedule-driven, simplified far
 * simulation) is Codex's to implement and is proposed in docs/legacy/claude-integration/characters/population-README.md.
 *
 * Modes:
 * - `animated`: crowd level (or the household level for the built smithy four) with the mixer updated every frame;
 * - `low-rate`: drawn, mixer updated at `updateHz` with `updatePhase` staggering the residents across frames;
 * - `posed`: drawn, mixer frozen on its current pose (only for residents that are not travelling);
 * - `hidden`: not drawn; the resident's state continues in the simulation.
 *
 * Rules, in order: a resident that is not presentable (indoors, asleep, off on the road) is hidden; an engaged resident
 * (in conversation with or framed by the viewer) is always drawn and animated; a resident inside the near ring and in
 * front of the viewer is always drawn and animated, even past the cap, and is then listed in `overCapacity` rather than
 * silently hidden; beyond the draw distance a resident is hidden; the rest are ranked by priority (engagement, the near
 * ring, interaction, major tier, view direction, distance, and a bonus for being drawn already) and fill the platform cap.
 * Projected height decides full-rate animation among the drawn; a travelling resident is never posed (it would slide).
 * Distances, view cone, full-rate size and cap membership all have hysteresis so residents do not flicker.
 *
 * Applying a decision (runtime builder, 7 November): `presenceCadenceSeconds` maps a mode onto the actor owner's per-actor
 * `animationUpdateIntervalSeconds` (Codex, since ef1f901: 0 every frame, a positive interval, null suspended);
 * `lowRateDue` staggers low-rate residents by their phase for callers that throttle by alternating 0 and null;
 * `selectVillageArtLevels` turns the selection into the level each drawn resident shows (`crowd` for the 96 crowd
 * residents, the household levels for the smithy four); `estimatePresentationCost` sums the drawn triangles, draws and
 * decoded textures from the published budgets; `proposedSimulationLevel` is the art side's tier proposal for Codex
 * (data only: simulation is Codex's).
 *
 * Pure and deterministic: no three, DOM, timers, clock reads, randomness or scene access. ES2020.
 */
import {
  CROWD_LEVEL_BUDGET, getArchetypeSpec, VILLAGE_PERFORMANCE_MODEL, type PopulationFidelityTier, type PopulationResident,
} from './village-population';
import { selectHouseholdArtLevelsDetailed, type HouseholdArtLevel } from './household-art-sets';

export const VILLAGE_PRESENCE_STATUS = 'working-placeholder' as const;

export type PresencePlatform = 'quest' | 'desktop-isometric';
export type PresenceMode = 'animated' | 'low-rate' | 'posed' | 'hidden';
export type PresenceInteraction = 'none' | 'nearby' | 'engaged';
export type PresenceReason = 'engaged' | 'near-in-front' | 'near-out-of-view' | 'priority' | 'near-over-cap' | 'cap' | 'far' | 'out-of-view' | 'indoors';

export interface PresenceCaps {
  readonly platform: PresencePlatform;
  /** Residents drawn at once (room-scale near/engaged guarantees may exceed it and are reported; miniature mode has a hard cap). */
  readonly maxDrawn: number;
  /** Drawn residents whose mixer updates every frame. */
  readonly maxFullRate: number;
  /** Mixer update rate of `low-rate` residents. */
  readonly lowRateHz: number;
  /** A resident is drawn inside `drawEnterMetres` and kept until beyond `drawExitMetres`. */
  readonly drawEnterMetres: number;
  readonly drawExitMetres: number;
  /** Projected resident height (pixels) for full-rate animation, entered at `fullRateMinPixels`, kept down to `fullRateExitPixels`. */
  readonly fullRateMinPixels: number;
  readonly fullRateExitPixels: number;
  /** Below this projected height a stationary resident may be posed. */
  readonly lowRateMinPixels: number;
  /** Room-scale: inside this distance and in front of the viewer a resident is always drawn and animated. */
  readonly nearGuaranteeMetres: number;
  /**
   * Half-angle of "in front" for the near guarantee (wider than the view cone, so a head turn never reveals a gap). 180
   * makes the near ring omnidirectional: residents inside it behind the viewer are drawn too (`near-out-of-view`, at the
   * low rate), so a quick head turn never reveals a pop-in close by.
   */
  readonly frontHalfAngleDegrees: number;
  /** Extra half-angle a drawn resident keeps before it counts as out of view. */
  readonly viewMarginDegrees: number;
  /** Residents inside this distance stay loaded (assets and actor) even when hidden. */
  readonly prefetchMetres: number;
  /** Priority bonus for a resident drawn last decision (cap hysteresis). */
  readonly drawnBonus: number;
}

/**
 * Starting caps (proposals to tune with device profiling; nothing here is headset evidence).
 * Quest: the creator's initial target of 8 to 15 visible residents, 12 by default, 8 at full rate. A Quest 3 at
 * about 25 pixels per degree sees a 1.7 m resident about 160 px tall at 15 m and 80 px tall at 30 m. The near ring
 * (6 m) is omnidirectional (motion and runtime fixer, 8 November): with a half field of view of about 52 degrees and a
 * 4 to 10 Hz decision tick, a 75 degree ring let a quick head turn reveal residents popping in 4 m away. Residents
 * behind the viewer inside the ring are drawn at the low rate; the cost is bounded by how many can stand within 6 m.
 * Desktop isometric: every presentable resident in the frustum (up to 100), 16 at full rate, the rest low-rate or posed
 * (motion and runtime fixer, 8 November: the cap of 40 hid more than half of the outdoor village in the overview,
 * the creator's primary view). Each drawn crowd resident costs one draw and about 3,500 triangles, so 100 are about
 * 350,000 triangles and 100 draws plus their props. At 1080p with a 45 degree vertical view (about 24 pixels per degree)
 * a resident is about 330 px tall from the well view (7 m) and about 21 px tall from the overview (110 m).
 */
export const VILLAGE_PRESENCE_CAPS: Readonly<Record<PresencePlatform, PresenceCaps>> = Object.freeze({
  quest: Object.freeze({ platform: 'quest' as const, maxDrawn: 12, maxFullRate: 8, lowRateHz: 15, drawEnterMetres: 30, drawExitMetres: 34,
    fullRateMinPixels: 160, fullRateExitPixels: 140, lowRateMinPixels: 40, nearGuaranteeMetres: 6, frontHalfAngleDegrees: 180,
    viewMarginDegrees: 10, prefetchMetres: 40, drawnBonus: 60 }),
  'desktop-isometric': Object.freeze({ platform: 'desktop-isometric' as const, maxDrawn: 100, maxFullRate: 16, lowRateHz: 12, drawEnterMetres: 160,
    drawExitMetres: 175, fullRateMinPixels: 90, fullRateExitPixels: 80, lowRateMinPixels: 24, nearGuaranteeMetres: 12, frontHalfAngleDegrees: 60,
    viewMarginDegrees: 8, prefetchMetres: 190, drawnBonus: 60 }),
});

export interface PresenceViewer {
  readonly platform: PresencePlatform;
  /**
   * Explicit miniature adaptation: distances refer to the source-space inspection focus, not the physical head.
   * Requires actual head-frustum results on every request. Near/engaged guarantees cannot overflow either cap.
   * Omitted keeps the room-scale head-position contract unchanged.
   */
  readonly mode?: 'room-scale' | 'miniature-focus';
  /** Desktop camera, Quest head, or explicitly declared miniature source focus, metres (y up). */
  readonly position: readonly [number, number, number];
  /** Horizontal view direction (x, z); need not be normalised. */
  readonly forward: readonly [number, number];
  /** Horizontal half field of view in degrees. */
  readonly halfFovDegrees: number;
  /** Display pixels per degree (Quest 3 about 25; desktop: viewport height / vertical field of view). */
  readonly pixelsPerDegree: number;
}

export interface PresenceRequest {
  readonly residentId: string;
  readonly tier: PopulationFidelityTier;
  /** Feet position, metres. */
  readonly position: readonly [number, number, number];
  readonly heightMetres: number;
  /** False while the routine puts the resident indoors, asleep or off on the road. */
  readonly presentable: boolean;
  /** Travelling along a route this frame (never posed). */
  readonly moving: boolean;
  readonly interaction: PresenceInteraction;
  /** The mode shown at the last decision, for hysteresis (null on first sight). */
  readonly current: PresenceMode | null;
  /**
   * Optional result of the caller's own camera-frustum test (desktop isometric cameras look steeply down, where a
   * horizontal cone misjudges residents below the camera). When given it replaces the cone test for both the view and
   * the room-scale near-in-front guarantee; the caller applies its own margin. Required in miniature-focus mode.
   */
  readonly inFrustum?: boolean;
}

export interface PresenceDecision {
  readonly residentId: string;
  readonly mode: PresenceMode;
  /** 'display' for every frame, a rate for low-rate, 0 when posed or hidden. */
  readonly updateHz: number | 'display';
  /** Deterministic 0..1 offset that staggers low-rate updates across frames. */
  readonly updatePhase: number;
  readonly reason: PresenceReason;
  readonly priority: number;
  readonly distanceMetres: number;
  readonly projectedPixels: number;
  readonly inView: boolean;
  /** Keep assets loaded (room-scale: drawn/recent/prefetch; miniature: selected only, bounding its asset pool). */
  readonly keepLoaded: boolean;
  /** Room-scale only: drawn past the cap because a guarantee applied (never silently hidden). */
  readonly overCapacity: boolean;
}

export interface PresenceSelection {
  readonly platform: PresencePlatform;
  readonly decisions: Readonly<Record<string, PresenceDecision>>;
  /** Drawn residents, highest priority first. */
  readonly drawn: readonly string[];
  readonly overCapacity: readonly string[];
  readonly counts: { readonly animated: number; readonly lowRate: number; readonly posed: number; readonly hidden: number };
}

/** Checks caps for internal consistency and the creator's Quest target of 8 to 15 visible residents. */
export function validatePresenceCaps(caps: PresenceCaps): string | null {
  const finite = (v: number) => typeof v === 'number' && Number.isFinite(v);
  for (const [k, v] of Object.entries(caps)) if (k !== 'platform' && !finite(v as number)) return `Cap ${k} must be a finite number.`;
  if (!Number.isInteger(caps.maxDrawn) || !Number.isInteger(caps.maxFullRate) || caps.maxDrawn < 1 || caps.maxFullRate < 1) return 'Caps need whole positive counts.';
  if (caps.platform === 'quest') {
    const q = VILLAGE_PERFORMANCE_MODEL.questVisibleSimultaneously;
    if (caps.maxDrawn < q.min || caps.maxDrawn > q.max) return `Quest draws ${q.min} to ${q.max} residents at once (creator target).`;
  }
  if (caps.maxFullRate > caps.maxDrawn) return 'Full-rate residents cannot exceed drawn residents.';
  if (caps.drawExitMetres < caps.drawEnterMetres || caps.fullRateExitPixels > caps.fullRateMinPixels) return 'Hysteresis must keep a resident longer than it takes to enter.';
  if (caps.nearGuaranteeMetres <= 0 || caps.nearGuaranteeMetres > caps.drawEnterMetres) return 'The near ring must sit inside the draw distance.';
  if (caps.prefetchMetres < caps.drawExitMetres) return 'Prefetch must reach past the draw distance.';
  if (caps.lowRateHz <= 0 || caps.lowRateHz > 30) return 'Low-rate animation runs at 1 to 30 Hz.';
  if (caps.frontHalfAngleDegrees <= 0 || caps.frontHalfAngleDegrees > 180 || caps.viewMarginDegrees < 0) return 'Angles out of range.';
  return null;
}

function hashPhase(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  // final avalanche (murmur3 fmix32): IDs that differ only in their last characters must not share a phase
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}

const DEG = 180 / Math.PI;
const EMPTY_FORWARD_ANGLE = 0;

/**
 * Decides presence for every request. Deterministic and independent of request order (ties break on resident ID).
 * Throws on invalid input rather than guessing.
 */
export function selectVillagePresence(viewer: PresenceViewer, requests: readonly PresenceRequest[],
  caps: PresenceCaps = VILLAGE_PRESENCE_CAPS[viewer.platform]): PresenceSelection {
  const capsError = validatePresenceCaps(caps);
  if (capsError) throw new Error(capsError);
  if (caps.platform !== viewer.platform) throw new Error('Caps and viewer must be for the same platform.');
  const miniature = viewer.mode === 'miniature-focus';
  if (miniature && viewer.platform !== 'quest') throw new Error('Miniature focus presence is a Quest presentation adaptation.');
  const [vx, vy, vz] = viewer.position;
  if (![vx, vy, vz, viewer.forward[0], viewer.forward[1], viewer.halfFovDegrees, viewer.pixelsPerDegree].every(Number.isFinite) ||
    viewer.pixelsPerDegree <= 0 || viewer.halfFovDegrees <= 0) throw new Error('Viewer needs a finite position, direction, field of view and pixel density.');
  const fLen = Math.hypot(viewer.forward[0], viewer.forward[1]);
  const seen = new Set<string>();

  interface Row { r: PresenceRequest; d: number; angle: number; pixels: number; inView: boolean; nearFront: boolean; nearHidden: boolean; wasDrawn: boolean; priority: number }
  const rows: Row[] = [];
  for (const r of requests) {
    if (!r.residentId || seen.has(r.residentId)) throw new Error('Presence requests need distinct resident IDs.');
    seen.add(r.residentId);
    if (!r.position.every(Number.isFinite) || !Number.isFinite(r.heightMetres) || r.heightMetres <= 0) throw new Error(`Invalid presence request ${r.residentId}.`);
    if (miniature && typeof r.inFrustum !== 'boolean') throw new Error('Miniature presence requires the actual head frustum for every resident.');
    const dx = r.position[0] - vx, dz = r.position[2] - vz, dy = r.position[1] + r.heightMetres / 2 - vy;
    const d = Math.hypot(dx, dy, dz), horizontal = Math.hypot(dx, dz);
    const angle = horizontal < 1e-6 || fLen < 1e-9 ? EMPTY_FORWARD_ANGLE
      : Math.acos(Math.max(-1, Math.min(1, (dx * viewer.forward[0] + dz * viewer.forward[1]) / (horizontal * fLen)))) * DEG;
    const wasDrawn = r.current !== null && r.current !== 'hidden';
    const pixels = 2 * Math.atan2(r.heightMetres / 2, Math.max(d, 0.05)) * DEG * viewer.pixelsPerDegree;
    const inView = r.inFrustum ?? angle <= viewer.halfFovDegrees + (wasDrawn ? caps.viewMarginDegrees : 0);
    const nearFront = d <= caps.nearGuaranteeMetres && (r.inFrustum ?? angle <= caps.frontHalfAngleDegrees);
    // inside the near ring but outside the view (an omnidirectional ring): drawn, at the low rate until it is in view
    const nearHidden = nearFront && !inView;
    const range = wasDrawn ? caps.drawExitMetres : caps.drawEnterMetres;
    // a near resident out of view is still drawn (below), but after the residents in view have filled the cap
    const priority = (r.interaction === 'engaged' ? 10000 : 0) + (nearFront && !nearHidden ? 5000 : 0) + (r.interaction === 'nearby' ? 400 : 0)
      + (r.tier === 'major' ? 150 : 0) + (inView ? 300 : -300) + 200 * (1 - Math.min(d / range, 1)) + (wasDrawn ? caps.drawnBonus : 0);
    rows.push({ r, d, angle, pixels, inView, nearFront, nearHidden, wasDrawn, priority });
  }
  rows.sort((a, b) => (b.priority - a.priority) || (a.d - b.d) || (a.r.residentId < b.r.residentId ? -1 : a.r.residentId > b.r.residentId ? 1 : 0));

  const decisions: Record<string, PresenceDecision> = {};
  const drawn: string[] = [], over: string[] = [];
  let fullRate = 0;
  const counts = { animated: 0, lowRate: 0, posed: 0, hidden: 0 };
  for (const row of rows) {
    const { r, d } = row;
    const engaged = r.interaction === 'engaged';
    const range = row.wasDrawn ? caps.drawExitMetres : caps.drawEnterMetres;
    let mode: PresenceMode = 'hidden', reason: PresenceReason, overCapacity = false;
    if (!r.presentable) reason = 'indoors';
    else if (miniature && !row.inView) reason = 'out-of-view';
    else if (miniature && drawn.length >= caps.maxDrawn) reason = 'cap';
    else if (!miniature && (engaged || row.nearFront)) {
      mode = !engaged && row.nearHidden ? 'low-rate' : 'animated';
      reason = engaged ? 'engaged' : row.nearHidden ? 'near-out-of-view' : 'near-in-front';
      if (drawn.length >= caps.maxDrawn) { overCapacity = true; reason = engaged ? 'engaged' : row.nearHidden ? 'near-out-of-view' : 'near-over-cap'; }
    } else if (d > range && !(miniature && engaged)) reason = 'far';
    else if (!row.inView) reason = 'out-of-view';
    else if (drawn.length >= caps.maxDrawn) reason = 'cap';
    else {
      reason = 'priority';
      const fullEnough = row.pixels >= (r.current === 'animated' ? caps.fullRateExitPixels : caps.fullRateMinPixels);
      if (fullEnough && fullRate < caps.maxFullRate) mode = 'animated';
      else if (r.moving || row.pixels >= caps.lowRateMinPixels) mode = 'low-rate';
      else mode = 'posed';
    }
    if (mode === 'animated') fullRate++;
    if (mode !== 'hidden') drawn.push(r.residentId);
    if (overCapacity) over.push(r.residentId);
    counts[mode === 'low-rate' ? 'lowRate' : mode]++;
    decisions[r.residentId] = Object.freeze({
      residentId: r.residentId, mode,
      updateHz: mode === 'animated' ? 'display' as const : mode === 'low-rate' ? caps.lowRateHz : 0,
      updatePhase: hashPhase(r.residentId), reason, priority: Math.round(row.priority * 1000) / 1000,
      distanceMetres: Math.round(d * 1000) / 1000, projectedPixels: Math.round(row.pixels * 10) / 10, inView: row.inView,
      keepLoaded: mode !== 'hidden' || !miniature && (row.wasDrawn || r.presentable && d <= caps.prefetchMetres), overCapacity,
    });
  }
  over.sort();
  return Object.freeze({ platform: viewer.platform, decisions: Object.freeze(decisions), drawn: Object.freeze(drawn), overCapacity: Object.freeze(over), counts: Object.freeze(counts) });
}

// ------------------------------------------------------------------ applying a decision

/**
 * The actor owner's `animationUpdateIntervalSeconds` for a decision (Codex's resident-actors.ts since ef1f901: 0 or
 * omitted evaluates every frame, a positive interval throttles, null suspends while logical clip time keeps advancing):
 * animated 0, low-rate 1 / updateHz, posed and hidden null. Hidden residents are also not drawn (the caller hides or
 * disposes their actor); posed ones stay drawn on their last evaluated pose.
 */
export function presenceCadenceSeconds(decision: PresenceDecision): number | null {
  if (decision.mode === 'animated') return 0;
  if (decision.mode === 'low-rate' && typeof decision.updateHz === 'number' && decision.updateHz > 0) return 1 / decision.updateHz;
  return null;
}

/**
 * Phase-staggered low-rate evaluation: true when a low-rate resident should evaluate its pose this frame, i.e. when
 * floor(clock * updateHz + updatePhase) changed between the previous and this frame clock. A caller that alternates
 * the owner's interval between 0 (due) and null (not due) spreads its low-rate residents across frames by their
 * deterministic phases instead of evaluating them all on the same frame. Animated residents are always due; posed
 * and hidden never. The first frame after a mode change (previousClockSeconds null) is due.
 */
export function lowRateDue(decision: PresenceDecision, previousClockSeconds: number | null, clockSeconds: number): boolean {
  if (decision.mode === 'animated') return true;
  if (decision.mode !== 'low-rate' || typeof decision.updateHz !== 'number') return false;
  if (previousClockSeconds === null || !Number.isFinite(previousClockSeconds) || clockSeconds < previousClockSeconds) return true;
  const slot = (t: number) => Math.floor(t * (decision.updateHz as number) + decision.updatePhase);
  return slot(clockSeconds) !== slot(previousClockSeconds);
}

/**
 * True when presence guarantees the resident is drawn (engaged, or inside the near ring): a presenter must never hide it
 * that frame, whatever else goes wrong (the crowd adapters then keep its last motion instead of popping it out).
 */
export function isGuaranteedPresence(decision: PresenceDecision): boolean {
  return decision.mode !== 'hidden' && (decision.reason === 'engaged' || decision.reason === 'near-in-front'
    || decision.reason === 'near-over-cap' || decision.reason === 'near-out-of-view');
}

/**
 * Whether the caller should re-run `selectVillagePresence` now rather than wait for its next decision tick: the head or
 * camera turned more than `yawDegrees` or moved more than `moveMetres` since the viewer of the last decision (null: no
 * decision yet). Quest callers check it every frame, so a quick head turn is answered within a frame, not a tick.
 */
export function presenceRefreshDue(previous: PresenceViewer | null, current: PresenceViewer, yawDegrees = 10, moveMetres = 0.75): boolean {
  if (!previous || previous.platform !== current.platform) return true;
  const [ax, az] = previous.forward, [bx, bz] = current.forward;
  const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
  if (la < 1e-9 || lb < 1e-9) return true;
  const cos = Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb)));
  if (Math.acos(cos) * DEG > yawDegrees) return true;
  const [px, py, pz] = previous.position, [qx, qy, qz] = current.position;
  return Math.hypot(qx - px, qy - py, qz - pz) > moveMetres;
}

/** Simulation depth proposed to Codex (EALDHOLT_POPULATION_ART.md section 7, population-README.md). */
export type ProposedSimulationLevel = 'deep' | 'scheduled' | 'far';

/**
 * The art side's proposal, as data: a `major` resident is Deep always, drawn or not; a `persistent` resident is
 * Scheduled while presence draws it or keeps it loaded (prefetch ring, recently drawn) and Far otherwise. Presentation
 * never promotes a persistent resident to Deep, and hiding never demotes a major one. Codex implements the levels.
 */
export function proposedSimulationLevel(tier: PopulationFidelityTier, decision: PresenceDecision | null): ProposedSimulationLevel {
  if (tier === 'major') return 'deep';
  return decision !== null && (decision.mode !== 'hidden' || decision.keepLoaded) ? 'scheduled' : 'far';
}

/** The level a drawn resident shows: the one crowd file (desktop and Quest) or a built household level. */
export type VillageArtLevel = 'crowd' | HouseholdArtLevel;

export interface VillageLevelRequest {
  readonly residentId: string;
  /** `crowd` for the 96 crowd residents, `existing-set` for the built smithy four (population appearance.kind). */
  readonly kind: 'crowd' | 'existing-set';
  /** In conversation with, or framed by, the viewer (takes the close household level first). */
  readonly inConversation: boolean;
  /** The level shown now, for the household hysteresis (null when not drawn). */
  readonly current: VillageArtLevel | null;
}

export interface VillageLevelSelection {
  readonly levels: Readonly<Record<string, VillageArtLevel | null>>;
  /** Smithy residents shown at a household level that was already full (selectHouseholdArtLevelsDetailed). */
  readonly overCapacity: readonly string[];
}

/**
 * Levels for one presence selection. Hidden residents get null. A drawn crowd resident gets `crowd`. A drawn smithy
 * resident gets the household choice (`selectHouseholdArtLevelsDetailed` with the decision's distance) and, when that
 * returns null because the resident is beyond the last built level's distance but presence still draws it, the cheapest
 * built level of the platform (`quest` on Quest, `desktop-lod1` on desktop): presence decides whether a resident is
 * drawn, the household table only which of its levels. Throws on a request without a decision.
 */
export function selectVillageArtLevels(selection: PresenceSelection, requests: readonly VillageLevelRequest[]): VillageLevelSelection {
  const levels: Record<string, VillageArtLevel | null> = {};
  const household: { residentId: string; distanceMetres: number; inConversation: boolean; current: HouseholdArtLevel | null }[] = [];
  const questLike = selection.platform === 'quest';
  for (const r of requests) {
    const d = selection.decisions[r.residentId];
    if (!d) throw new Error(`No presence decision for ${r.residentId}.`);
    if (d.mode === 'hidden') { levels[r.residentId] = null; continue; }
    if (r.kind === 'crowd') { levels[r.residentId] = 'crowd'; continue; }
    household.push({ residentId: r.residentId, distanceMetres: d.distanceMetres, inConversation: r.inConversation,
      current: r.current === 'crowd' ? null : r.current });
  }
  const picked = household.length ? selectHouseholdArtLevelsDetailed(household, questLike ? 'quest' : 'desktop') : null;
  for (const h of household) levels[h.residentId] = picked!.levels[h.residentId] ?? (questLike ? 'quest' : 'desktop-lod1');
  return Object.freeze({ levels: Object.freeze(levels), overCapacity: Object.freeze([...(picked?.overCapacity ?? [])]) });
}

/** Per-level draw cost from the published budgets (crowd: CROWD_LEVEL_BUDGET; household: the measured smithy levels). */
export const VILLAGE_LEVEL_COSTS: Readonly<Record<VillageArtLevel, { readonly trianglesNominal: number; readonly trianglesMax: number;
  readonly materials: number; readonly decodedTextureMiB: number; readonly morphTextureMiB: number }>> = Object.freeze({
  // crowd: 3,500 nominal, 4,500 max, 1 or 2 materials, one 512 RGBA atlas with mips (1.33 MiB) plus the second material's share
  crowd: Object.freeze({ trianglesNominal: CROWD_LEVEL_BUDGET.triangles.nominal, trianglesMax: CROWD_LEVEL_BUDGET.triangles.max,
    materials: CROWD_LEVEL_BUDGET.materials.max, decodedTextureMiB: 1.4, morphTextureMiB: 0 }),
  // smithy sets, measured from their manifests (7 November): largest triangles of the four, 2048/1024 atlases; the 44 face
  // morph targets live in a float morph texture per mesh (the engineering critic measured 3.3 to 3.8 MiB at runtime)
  'desktop-lod0': Object.freeze({ trianglesNominal: 24889, trianglesMax: 25000, materials: 4, decodedTextureMiB: 67, morphTextureMiB: 3.8 }),
  'desktop-lod1': Object.freeze({ trianglesNominal: 7823, trianglesMax: 8000, materials: 2, decodedTextureMiB: 8.3, morphTextureMiB: 3.8 }),
  quest: Object.freeze({ trianglesNominal: 5815, trianglesMax: 6000, materials: 2, decodedTextureMiB: 8.3, morphTextureMiB: 3.8 }),
});

/**
 * Props of a drawn crowd resident (motion and runtime fixer, 8 November: the crowd adapters attach them). Nominal: one
 * held or worn prop of the kits' mean size; max: a held grip, a worn prop, a workplace prop with goods and a stool, each up
 * to the largest kit prop (408 triangles). Each prop kit in view adds its 512 atlas (RGBA with mips).
 */
export const CROWD_PROP_COSTS = Object.freeze({ trianglesNominal: 130, trianglesMax: 5 * 408, drawsNominal: 1, drawsMax: 5, kitAtlasMiB: 1.33, kits: 7 });

export interface PresentationCost {
  readonly drawn: number;
  /** Prop share included in the totals below (measured when given, else CROWD_PROP_COSTS per drawn crowd resident). */
  readonly props: { readonly trianglesNominal: number; readonly trianglesMax: number; readonly drawsNominal: number; readonly drawsMax: number; readonly kitAtlasMiB: number };
  /** Household morph textures included in decodedTextureMiB. */
  readonly morphTextureMiB: number;
  readonly trianglesNominal: number;
  readonly trianglesMax: number;
  /** Body draws (one per material) plus the props' draws. */
  readonly drawsMin: number;
  readonly drawsMax: number;
  readonly decodedTextureMiB: number;
  readonly byLevel: Readonly<Partial<Record<VillageArtLevel, number>>>;
}

/** Measured prop figures from a presenter (crowd-residents `metrics`: propTrianglesDrawn, propDrawCallsDrawn) and kits loaded. */
export interface PresentationPropsMeasured { readonly triangles: number; readonly draws: number; readonly kitsInView: number }

/**
 * Sums the budgeted cost of the drawn residents of a level selection (estimates from the files, not runtime figures):
 * bodies by level, the household morph textures, and the crowd residents' props (measured when `props` is given,
 * otherwise CROWD_PROP_COSTS per drawn crowd resident with every prop kit's atlas).
 */
export function estimatePresentationCost(levels: Readonly<Record<string, VillageArtLevel | null>>, props?: PresentationPropsMeasured): PresentationCost {
  let drawn = 0, tn = 0, tm = 0, dmin = 0, dmax = 0, tex = 0, morph = 0, crowd = 0;
  const byLevel: Partial<Record<VillageArtLevel, number>> = {};
  for (const level of Object.values(levels)) {
    if (level === null) continue;
    const c = VILLAGE_LEVEL_COSTS[level];
    drawn++; tn += c.trianglesNominal; tm += c.trianglesMax; tex += c.decodedTextureMiB + c.morphTextureMiB; morph += c.morphTextureMiB;
    dmin += level === 'crowd' ? 1 : c.materials;
    dmax += c.materials;
    if (level === 'crowd') crowd++;
    byLevel[level] = (byLevel[level] ?? 0) + 1;
  }
  const P = CROWD_PROP_COSTS;
  const p = props
    ? { trianglesNominal: props.triangles, trianglesMax: props.triangles, drawsNominal: props.draws, drawsMax: props.draws, kitAtlasMiB: props.kitsInView * P.kitAtlasMiB }
    : { trianglesNominal: crowd * P.trianglesNominal, trianglesMax: crowd * P.trianglesMax, drawsNominal: crowd * P.drawsNominal, drawsMax: crowd * P.drawsMax,
      kitAtlasMiB: crowd ? P.kits * P.kitAtlasMiB : 0 };
  tn += p.trianglesNominal; tm += p.trianglesMax; dmin += props ? props.draws : 0; dmax += p.drawsMax; tex += p.kitAtlasMiB;
  return Object.freeze({ drawn, props: Object.freeze({ ...p, kitAtlasMiB: Math.round(p.kitAtlasMiB * 10) / 10 }), morphTextureMiB: Math.round(morph * 10) / 10,
    trianglesNominal: tn, trianglesMax: tm, drawsMin: dmin, drawsMax: dmax, decodedTextureMiB: Math.round(tex * 10) / 10, byLevel: Object.freeze(byLevel) });
}

/**
 * Estimated standing height of a resident, metres, for projected-size decisions only. Piecewise fits to the measured
 * MakeHuman statures (scratchpad joint-variation runs): the archetype's reference stature, scaled by age inside the
 * archetype (children grow about 7 percent a year around 8, adolescents about 2 percent around 14, MakeHuman adults
 * under 25 are shorter by about 1.6 percent a year), by the sex macro for the mixed archetypes and by the height macro.
 * Checked against the 96 measured residents: within 5 percent (worst 4.6 percent); reference points are in the test.
 */
export function estimatedStatureMetres(resident: PopulationResident): number {
  const a = resident.appearance, spec = getArchetypeSpec(a.archetype), age = a.macro.ageYears;
  let factor = 1;
  if (a.archetype === 'child') factor = (1 + 0.07 * (age - spec.reference.ageYears)) * (1 + (a.macro.gender - 0.5) * 0.066);
  else if (a.archetype === 'adolescent') factor = (1 + 0.02 * (age - spec.reference.ageYears)) * (1 + (a.macro.gender - 0.5) * 0.084);
  else if (a.archetype === 'adult-male' || a.archetype === 'adult-female') factor = age < 25 ? 1 - (25 - age) * (a.archetype === 'adult-male' ? 0.017 : 0.0157) : 1;
  factor *= 1 + (a.macro.height - spec.reference.height) * 0.9;
  return Math.round(spec.referenceStatureCm * factor) / 100;
}

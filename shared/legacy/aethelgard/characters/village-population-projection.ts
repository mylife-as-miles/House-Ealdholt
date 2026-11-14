/** Initial/offscreen presentation of an established population at measured
 * exterior destinations. These are abstract schedule endpoints, never evidence
 * of travel, arrival, completed work, events, knowledge or house standing.
 * The world clock and persistent population stay independent of this adapter.
 */
import type { VillagePopulationResidentState, VillagePopulationSample } from './village-population-runtime';
import { resolveVillageSiteEndpoint, type VillageSiteLayout } from './village-site';

export interface VillagePopulationProjectionState extends VillagePopulationResidentState {
  readonly projectionProvenance: 'certified-route-sample' | 'abstract-schedule-endpoint' | 'unavailable';
  /** Static route evidence only, not continuous animated/crowd collision proof. */
  readonly routeCertified: boolean;
  readonly orientationProvenance: 'strict-sample' | 'neutral-unqualified';
  /** Neutral abstract placement never qualifies an equipment-facing work pose. */
  readonly workPoseQualified?: false;
  readonly projectionHeldReason: string | null;
}
export interface VillagePopulationProjectionSample extends VillagePopulationSample {
  readonly residents: readonly VillagePopulationProjectionState[];
  readonly projectionSiteIdentity: string | null;
  readonly projectionCounts: {
    readonly certifiedRouteSamples: number;
    readonly abstractCandidates: number;
    readonly abstractEndpoints: number;
    readonly heldAbstractCandidates: number;
  };
}
export interface VillagePopulationEndpointProjection {
  /** Strict rows retain their positions and original unavailable reasons. */
  readonly sample: VillagePopulationProjectionSample;
  readonly candidates: readonly VillagePopulationProjectionState[];
  readonly site: VillageSiteLayout | null;
}
export interface VillagePopulationEndpointAdmission {
  /** Caller proves never presented, or at least two seconds not drawn/offscreen.
   * This is a presentation capability, not persistent simulation state. */
  readonly eligibleResidentIds: ReadonlySet<string>;
  /** Current draw visibility. This vetoes a changed visible endpoint even when
   * eligibility was accidentally supplied. Keep this independent of camera UI. */
  readonly visibleResidentIds: ReadonlySet<string>;
  readonly previousSample?: VillagePopulationProjectionSample | null;
}
const projects = new WeakSet<object>();
const admissions = new WeakSet<object>();
const siteIdentity = (site: VillageSiteLayout | null): string | null => site ? `${site.profile}:${site.sourceSha256}` : null;
const samePosition = (a: readonly number[] | null, b: readonly number[] | null): boolean => !!a && !!b
  && a.length === 3 && b.length === 3 && a.every((value, index) => Math.abs(value - b[index]) <= 1e-6);
function finish(sample: VillagePopulationSample, rows: readonly VillagePopulationProjectionState[], identity: string | null,
  candidates: number, held: number): VillagePopulationProjectionSample {
  return Object.freeze({ ...sample, residents: Object.freeze([...rows]), projectionSiteIdentity: identity,
    counts: Object.freeze({ ...sample.counts, mapped: rows.filter(row => row.position !== null).length,
      unmapped: rows.filter(row => row.status === 'unmapped').length, moving: rows.filter(row => row.moving).length,
      blocked: rows.filter(row => row.status === 'blocked').length }),
    projectionCounts: Object.freeze({ certifiedRouteSamples: rows.filter(row => row.routeCertified && row.position !== null).length,
      abstractCandidates: candidates, abstractEndpoints: rows.filter(row => row.projectionProvenance === 'abstract-schedule-endpoint').length,
      heldAbstractCandidates: held }) });
}

/** Camera-independent candidate generation. Only a strict route-unmapped row
 * with a separately measured target may become an abstract candidate. There is
 * no inferred route, transit duration, physical arrival or fabricated position. */
export function projectVillagePopulationEndpoints(strictSample: VillagePopulationSample,
  site: VillageSiteLayout | null): VillagePopulationEndpointProjection {
  if (site && (!Object.isFrozen(site) || site.frame !== 'source-root-local-metres'
    || !Number.isFinite(site.capsule.radius) || site.capsule.radius <= 0
    || !Number.isFinite(site.capsule.height) || site.capsule.height <= 0)) {
    throw Error('Abstract endpoint projection requires a frozen measured source site.');
  }
  const strictRows = strictSample.residents.map(row => Object.freeze({ ...row,
    workPoseQualified: false as const,
    projectionProvenance: row.position !== null && row.presentable ? 'certified-route-sample' as const : 'unavailable' as const,
    routeCertified: row.position !== null && row.presentable,
    orientationProvenance: 'strict-sample' as const, projectionHeldReason: null }));
  const candidates: VillagePopulationProjectionState[] = [];
  if (site) for (const row of strictRows) {
    if (row.reason !== 'route-unmapped' || row.status !== 'unmapped' || row.position !== null || row.presentable || row.moving) continue;
    const anchor = resolveVillageSiteEndpoint(site, row.scheduledPlaceId, row.residentId);
    if (!anchor || anchor.standingOnly !== true || anchor.sourceGroundPoint.length !== 3 || !anchor.sourceGroundPoint.every(Number.isFinite)) continue;
    candidates.push(Object.freeze({ ...row, placeId: row.scheduledPlaceId, status: 'at-place' as const, reason: null,
      position: Object.freeze([...anchor.sourceGroundPoint]) as readonly [number, number, number], yawRadians: 0,
      moving: false, presentable: true, projectionProvenance: 'abstract-schedule-endpoint' as const, routeCertified: false,
      orientationProvenance: 'neutral-unqualified' as const, workPoseQualified: false, projectionHeldReason: null }));
  }
  const result = Object.freeze({ sample: finish(strictSample, strictRows, siteIdentity(site), candidates.length, candidates.length),
    candidates: Object.freeze(candidates), site });
  projects.add(result);
  return result;
}

/** Visual admission only. The caller must clear prior admission on world/session
 * changes, and provide genuine visibility/eligible sets. An already visible
 * resident can keep the same abstract endpoint but can never jump to another.
 * Every accepted endpoint is checked against all strict and abstract positions.
 * Conflicting abstract candidates are held; strict route samples are preserved.
 */
export function admitVillagePopulationEndpoints(projection: VillagePopulationEndpointProjection,
  admission: VillagePopulationEndpointAdmission): VillagePopulationProjectionSample {
  if (!projects.has(projection)) throw Error('Endpoint admission requires a generated projection.');
  const previous = admission.previousSample ?? null;
  if (previous && !admissions.has(previous)) throw Error('Previous endpoint admission was not generated by this adapter.');
  const visible = new Set(admission.visibleResidentIds), eligible = new Set(admission.eligibleResidentIds);
  const prior = new Map(previous?.residents.map(row => [row.residentId, row] as const) ?? []);
  const candidates = new Map(projection.candidates.map(row => [row.residentId, row] as const));
  const held = new Map<string, string>(), accepted = new Set<string>();
  const sameSite = !previous || previous.projectionSiteIdentity === projection.sample.projectionSiteIdentity;
  const notRewound = !previous || previous.generation <= projection.sample.generation
    && previous.time.absoluteWorldMinute + previous.time.fractionalMinute <= projection.sample.time.absoluteWorldMinute + projection.sample.time.fractionalMinute;
  for (const candidate of projection.candidates) {
    const old = prior.get(candidate.residentId);
    const continuous = sameSite && notRewound && old?.projectionProvenance === 'abstract-schedule-endpoint'
      && old.presentable && old.scheduledPlaceId === candidate.scheduledPlaceId && samePosition(old.position, candidate.position);
    if (!notRewound) held.set(candidate.residentId, 'abstract-clock-rewind-held');
    else if (visible.has(candidate.residentId) && !continuous) held.set(candidate.residentId, 'abstract-visible-transition-held');
    else if (continuous || eligible.has(candidate.residentId)) accepted.add(candidate.residentId);
    else held.set(candidate.residentId, 'abstract-admission-required');
  }
  const positioned = projection.sample.residents.map(row => accepted.has(row.residentId) ? candidates.get(row.residentId)! : row);
  if (projection.site) {
    const radius = projection.site.capsule.radius, height = projection.site.capsule.height;
    for (let i = 0; i < positioned.length; i++) for (let j = i + 1; j < positioned.length; j++) {
      const a = positioned[i], b = positioned[j];
      if (!a.position || !b.position || !a.presentable || !b.presentable) continue;
      if (Math.abs(a.position[1] - b.position[1]) < height
        && Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]) < 2 * radius - 1e-8) {
        if (accepted.has(a.residentId)) held.set(a.residentId, 'abstract-proxy-conflict');
        if (accepted.has(b.residentId)) held.set(b.residentId, 'abstract-proxy-conflict');
      }
    }
  }
  const rows = projection.sample.residents.map(row => {
    const reason = held.get(row.residentId);
    if (reason) return Object.freeze({ ...row, projectionHeldReason: reason });
    return accepted.has(row.residentId) ? candidates.get(row.residentId)! : row;
  });
  const result = finish(projection.sample, rows, projection.sample.projectionSiteIdentity, candidates.size, held.size);
  admissions.add(result);
  return result;
}

import { EALDHOLT_VILLAGE_POPULATION } from './village-population';
import type { VillagePopulationResidentState } from './village-population-runtime';
import { populationPresentationHeldReason, type resolvePopulationPresentation } from './village-activity-presentation';
import type { qualifyPopulationMotion } from './population-motion-clearance';

/** Observer facts only. A source point is neither a physical arrival nor proof
 * of an animated body. A submitted draw does not prove unobscured pixels. */
export interface VillageResidentAvailability {
  readonly residentId: string;
  readonly position: readonly [number, number, number] | null;
  readonly body: 'unknown' | 'pending' | 'held' | 'qualified';
  readonly reason: string | null;
  readonly bodyReady: boolean;
  readonly drawnFrame: number | null;
  readonly renderFrame: number | null;
}

const registered = new Set(EALDHOLT_VILLAGE_POPULATION.residents.map(row => row.id));
const positionOf = (row?: Pick<VillagePopulationResidentState, 'position'> | null) => row?.position?.length === 3
  && row.position.every(Number.isFinite) ? Object.freeze([...row.position]) as readonly [number, number, number] : null;

export function pendingVillageResidentAvailability(residentId: string,
  row?: Pick<VillagePopulationResidentState, 'position'> | null): VillageResidentAvailability {
  return Object.freeze({ residentId, position: positionOf(row), body: registered.has(residentId) ? 'pending' : 'unknown',
    reason: registered.has(residentId) ? 'presentation-pending' : 'resident-unknown', bodyReady: false, drawnFrame: null, renderFrame: null });
}

/** Consume the adapter's actual placement/motion decisions; never resolve a
 * second animation policy from the schedule or from camera visibility. */
export function describeVillageResidentAvailability(state: VillagePopulationResidentState,
  presentation: ReturnType<typeof resolvePopulationPresentation>, qualification: ReturnType<typeof qualifyPopulationMotion>): VillageResidentAvailability {
  if (!registered.has(state.residentId)) return pendingVillageResidentAvailability(state.residentId);
  // The existing qualifier owns source identity. Coordinates rejected by its
  // site gate are not a known location in the currently loaded village.
  const position = qualification.reason === 'motion-site-unavailable' ? null : positionOf(state);
  const qualified = state.presentable && presentation.presentable && qualification.presentable
    && presentation.motion !== null && position !== null;
  return Object.freeze({ residentId: state.residentId, position, body: qualified ? 'qualified' : 'held',
    reason: qualified ? null : populationPresentationHeldReason(state, presentation, qualification) ?? 'presentation-unavailable',
    bodyReady: false, drawnFrame: null, renderFrame: null });
}

export function holdVillageResidentAvailability(value: VillageResidentAvailability, reason: string): VillageResidentAvailability {
  return Object.freeze({ ...value, body: 'held', reason, bodyReady: false, drawnFrame: null });
}

/** Qualification remains camera independent; loaded-body and draw facts are
 * added separately by the renderer owner, without changing life or navigation. */
export function presentedVillageResidentAvailability(value: VillageResidentAvailability, bodyReady: boolean,
  drawnFrame: number | null, renderFrame: number | null): VillageResidentAvailability {
  const currentFrame = renderFrame !== null && Number.isSafeInteger(renderFrame) && renderFrame >= 0 ? renderFrame : null;
  return Object.freeze({ ...value, bodyReady: value.body === 'qualified' && bodyReady,
    drawnFrame: value.body === 'qualified' && bodyReady && currentFrame !== null && drawnFrame === currentFrame ? drawnFrame : null,
    renderFrame: currentFrame });
}

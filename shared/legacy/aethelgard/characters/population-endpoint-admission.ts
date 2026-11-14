import type { VillagePopulationSample } from './village-population-runtime';
import type { VillageSiteLayout } from './village-site';
import { admitVillagePopulationEndpoints, projectVillagePopulationEndpoints,
  type VillagePopulationProjectionSample } from './village-population-projection';

/** Presenter-local admission history. The caller supplies actors actually drawn
 * by the previous frame, not the selection wish list. This never changes the
 * population clock, arrivals, work completion or persistent village facts. */
export function createPopulationEndpointAdmission(site: VillageSiteLayout) {
  const lastDrawn = new Map<string, number>();
  let previous: VillagePopulationProjectionSample | null = null;
  let lastNow = -Infinity;
  return {
    sample(strict: VillagePopulationSample, nowMilliseconds: number,
      drawnResidentIds: ReadonlySet<string>): VillagePopulationProjectionSample {
      if (!Number.isFinite(nowMilliseconds) || nowMilliseconds < lastNow) {
        throw Error('Population endpoint admission requires monotonic presentation time.');
      }
      lastNow = nowMilliseconds;
      for (const id of drawnResidentIds) lastDrawn.set(id, nowMilliseconds);
      const eligible = new Set<string>();
      for (const row of strict.residents) {
        const drawnAt = lastDrawn.get(row.residentId);
        if (drawnAt === undefined || nowMilliseconds - drawnAt >= 2000) eligible.add(row.residentId);
      }
      previous = admitVillagePopulationEndpoints(projectVillagePopulationEndpoints(strict, site), {
        eligibleResidentIds: eligible, visibleResidentIds: drawnResidentIds, previousSample: previous,
      });
      return previous;
    },
    clear(): void { lastDrawn.clear(); previous = null; lastNow = -Infinity; },
  };
}

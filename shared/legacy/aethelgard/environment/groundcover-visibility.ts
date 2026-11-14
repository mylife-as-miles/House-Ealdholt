import { ealdholtPlantTriangleBudget } from './plant-triangle-budget';
/** Original source-cell visibility only. Native's stationary miniature has no
 * corresponding metre-distance cutoff; its owned actor pools remain separate. */
// Triangle budgets follow the performance table (plant-triangle-budget.ts, L-12).
export const EALDHOLT_GROUNDCOVER_VISIBILITY = Object.freeze({
  high: Object.freeze({ triangleBudget: ealdholtPlantTriangleBudget('groundcover', 'high'), drawBudget: 160, minimumPixelDiameter: 1.5 }),
  medium: Object.freeze({ triangleBudget: ealdholtPlantTriangleBudget('groundcover', 'medium'), drawBudget: 80, minimumPixelDiameter: 2 }),
  low: Object.freeze({ triangleBudget: ealdholtPlantTriangleBudget('groundcover', 'low'), drawBudget: 32, minimumPixelDiameter: 2.5 }),
});
export const EALDHOLT_GROUNDCOVER_FAMILY_RESERVE = .35;
export type EaldholtGroundcoverQuality = keyof typeof EALDHOLT_GROUNDCOVER_VISIBILITY;

export interface EaldholtGroundcoverCell {
  /** Stable source traversal ordinal; independent of candidate sorting. */
  readonly id: number;
  readonly family: string;
  readonly inFrustum: boolean;
  readonly nearDepth: number;
  readonly farDepth: number;
  /** Median source-prototype diameter after actual actor/world transforms.
   * This is never the spatial cell's eight-metre enclosure. */
  readonly plantDiameter: number;
  readonly triangles: number;
  readonly instances: number;
  readonly drawCalls: number;
}
export interface EaldholtGroundcoverProjection {
  readonly quality: EaldholtGroundcoverQuality;
  /** The perspective projection matrix's Y scale, including camera zoom. */
  readonly projectionScaleY: number;
  readonly drawBufferHeight: number;
  readonly nearPlane: number;
}
export interface EaldholtGroundcoverFamilyVisibility {
  readonly family: string;
  eligibleCells: number;
  eligibleInstances: number;
  selectedCells: number;
  selectedInstances: number;
  selectedTriangles: number;
  selectedDrawCalls: number;
}
export interface EaldholtGroundcoverVisibility {
  readonly selectedIds: readonly number[];
  readonly triangleBudget: number;
  readonly drawBudget: number;
  readonly minimumPixelDiameter: number;
  readonly eligibleCells: number;
  readonly rejectedFrustumCells: number;
  readonly rejectedDepthCells: number;
  readonly rejectedSizeCells: number;
  readonly rejectedInvalidCells: number;
  readonly rejectedBudgetCells: number;
  /** Final-cap rejection reasons may overlap when both resources are full. */
  readonly rejectedTriangleBudgetCells: number;
  readonly rejectedDrawBudgetCells: number;
  readonly reservedCells: number;
  readonly reservedTriangles: number;
  readonly reservedDrawCalls: number;
  readonly selectedInstances: number;
  readonly selectedTriangles: number;
  readonly selectedDrawCalls: number;
  readonly minimumSelectedPixelDiameter: number;
  readonly maximumSelectedPixelDiameter: number;
  readonly families: readonly EaldholtGroundcoverFamilyVisibility[];
}

/** Precomputation input is owned scratch storage, never source vertex data. A
 * median avoids one unusually scaled source actor qualifying an entire cell. */
export function ealdholtRepresentativePlantDiameter(diameters: readonly number[]): number {
  const finite = diameters.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!finite.length) return 0;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

/** Budgeted screen-size proxy, not an occlusion or alpha-coverage measurement.
 * Source cells stay whole, their instance matrices and materials stay intact.
 * Near-plane intersections are conservative; wholly behind/near-clipped cells
 * cannot acquire infinite priority through division by a negative depth. */
export function selectEaldholtGroundcoverCells(cells: readonly EaldholtGroundcoverCell[], projection: EaldholtGroundcoverProjection): EaldholtGroundcoverVisibility {
  const policy = EALDHOLT_GROUNDCOVER_VISIBILITY[projection.quality];
  if (!Object.prototype.hasOwnProperty.call(EALDHOLT_GROUNDCOVER_VISIBILITY, projection.quality)
    || ![projection.projectionScaleY, projection.drawBufferHeight, projection.nearPlane].every(value => Number.isFinite(value) && value > 0)) {
    throw Error('Invalid source groundcover projection.');
  }
  const focalPixels = projection.projectionScaleY * projection.drawBufferHeight / 2;
  if (!Number.isFinite(focalPixels)) throw Error('Invalid source groundcover projection.');
  type Candidate = { cell: EaldholtGroundcoverCell; pixels: number; cost: number; score: number };
  const candidates: Candidate[] = [];
  const families = new Map<string, EaldholtGroundcoverFamilyVisibility>();
  const ids = new Set<number>();
  let rejectedFrustumCells = 0, rejectedDepthCells = 0, rejectedSizeCells = 0, rejectedInvalidCells = 0;
  for (const cell of cells) {
    if (!Number.isSafeInteger(cell.id) || cell.id < 0 || ids.has(cell.id)) throw Error('Source groundcover cell identities must be unique stable ordinals.');
    ids.add(cell.id);
    if (!cell.inFrustum) { rejectedFrustumCells++; continue; }
    if (!cell.family || ![cell.nearDepth, cell.farDepth, cell.plantDiameter].every(Number.isFinite)
      || cell.nearDepth > cell.farDepth || cell.plantDiameter <= 0
      || ![cell.triangles, cell.instances, cell.drawCalls].every(value => Number.isSafeInteger(value) && value > 0)) {
      rejectedInvalidCells++; continue;
    }
    if (cell.farDepth <= projection.nearPlane) { rejectedDepthCells++; continue; }
    const depth = Math.max(projection.nearPlane, cell.nearDepth);
    const pixels = cell.plantDiameter * focalPixels / depth;
    if (!Number.isFinite(pixels)) { rejectedInvalidCells++; continue; }
    if (pixels < policy.minimumPixelDiameter) { rejectedSizeCells++; continue; }
    // A draw and a triangle both consume a fixed resource. Normalizing each
    // cost by its cap prevents sparse cheap cells consuming every draw slot.
    // No family, colour or flower multiplier changes projected benefit.
    const cappedPixels = Math.min(pixels, projection.drawBufferHeight);
    const cost = cell.triangles / policy.triangleBudget + cell.drawCalls / policy.drawBudget;
    const score = cappedPixels * cappedPixels * cell.instances / cost;
    if (!Number.isFinite(score)) { rejectedInvalidCells++; continue; }
    candidates.push({ cell, pixels, cost, score });
    let family = families.get(cell.family);
    if (!family) {
      family = { family: cell.family, eligibleCells: 0, eligibleInstances: 0, selectedCells: 0,
        selectedInstances: 0, selectedTriangles: 0, selectedDrawCalls: 0 };
      families.set(cell.family, family);
    }
    family.eligibleCells++; family.eligibleInstances += cell.instances;
  }
  const compareScore = (a: Candidate, b: Candidate) => b.score - a.score || a.cell.id - b.cell.id;
  const compareFamily = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  candidates.sort(compareScore);
  const selectedIds: number[] = [];
  const selected = new Set<number>();
  let selectedInstances = 0, selectedTriangles = 0, selectedDrawCalls = 0;
  let minimumSelectedPixelDiameter = Infinity, maximumSelectedPixelDiameter = 0;
  function fits(candidate: Candidate, triangleCap: number = policy.triangleBudget, drawCap: number = policy.drawBudget): boolean {
    return selectedTriangles + candidate.cell.triangles <= triangleCap && selectedDrawCalls + candidate.cell.drawCalls <= drawCap;
  }
  function take({ cell, pixels }: Candidate): void {
    selected.add(cell.id); selectedIds.push(cell.id); selectedInstances += cell.instances;
    selectedTriangles += cell.triangles; selectedDrawCalls += cell.drawCalls;
    minimumSelectedPixelDiameter = Math.min(minimumSelectedPixelDiameter, pixels);
    maximumSelectedPixelDiameter = Math.max(maximumSelectedPixelDiameter, pixels);
    const family = families.get(cell.family)!;
    family.selectedCells++; family.selectedInstances += cell.instances;
    family.selectedTriangles += cell.triangles; family.selectedDrawCalls += cell.drawCalls;
  }
  // Reserve at most 35% of BOTH resources. Every eligible family receives the
  // same rule: one economical feasible representative, followed by an equal
  // resource share. Unused reserve returns to the unrestricted remainder.
  const reserveTriangles = Math.floor(policy.triangleBudget * EALDHOLT_GROUNDCOVER_FAMILY_RESERVE);
  const reserveDraws = Math.floor(policy.drawBudget * EALDHOLT_GROUNDCOVER_FAMILY_RESERVE);
  const familyOrder = [...families.keys()].sort(compareFamily);
  const byFamily = new Map(familyOrder.map(family => [family, candidates.filter(candidate => candidate.cell.family === family)]));
  const seeds = familyOrder.flatMap(family => {
    const feasible = byFamily.get(family)!.filter(candidate => candidate.cell.triangles <= reserveTriangles && candidate.cell.drawCalls <= reserveDraws);
    feasible.sort((a, b) => a.cost - b.cost || compareScore(a, b));
    return feasible.length ? [feasible[0]] : [];
  }).sort((a, b) => a.cost - b.cost || compareFamily(a.cell.family, b.cell.family) || a.cell.id - b.cell.id);
  for (const seed of seeds) if (fits(seed, reserveTriangles, reserveDraws)) take(seed);
  const familyTriangleShare = Math.floor(reserveTriangles / Math.max(1, familyOrder.length));
  const familyDrawShare = Math.floor(reserveDraws / Math.max(1, familyOrder.length));
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const name of familyOrder) {
      const family = families.get(name)!;
      const next = byFamily.get(name)!.find(candidate => !selected.has(candidate.cell.id)
        && family.selectedTriangles + candidate.cell.triangles <= familyTriangleShare
        && family.selectedDrawCalls + candidate.cell.drawCalls <= familyDrawShare
        && fits(candidate, reserveTriangles, reserveDraws));
      if (next) { take(next); progressed = true; }
    }
  }
  const reservedCells = selectedIds.length, reservedTriangles = selectedTriangles, reservedDrawCalls = selectedDrawCalls;
  for (const candidate of candidates) if (!selected.has(candidate.cell.id) && fits(candidate)) take(candidate);
  const rejected = candidates.filter(candidate => !selected.has(candidate.cell.id));
  return { selectedIds, triangleBudget: policy.triangleBudget, drawBudget: policy.drawBudget, minimumPixelDiameter: policy.minimumPixelDiameter,
    eligibleCells: candidates.length, rejectedFrustumCells, rejectedDepthCells, rejectedSizeCells, rejectedInvalidCells,
    rejectedBudgetCells: rejected.length,
    rejectedTriangleBudgetCells: rejected.filter(candidate => selectedTriangles + candidate.cell.triangles > policy.triangleBudget).length,
    rejectedDrawBudgetCells: rejected.filter(candidate => selectedDrawCalls + candidate.cell.drawCalls > policy.drawBudget).length,
    reservedCells, reservedTriangles, reservedDrawCalls, selectedInstances, selectedTriangles, selectedDrawCalls,
    minimumSelectedPixelDiameter: selectedIds.length ? minimumSelectedPixelDiameter : 0, maximumSelectedPixelDiameter,
    families: [...families.values()].sort((a, b) => compareFamily(a.family, b.family)) };
}

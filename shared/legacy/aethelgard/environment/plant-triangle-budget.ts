/** Plant triangle budgets derived from docs/legacy/PERFORMANCE.md (audit L-12):
 * triangles in view Low ≤ 300k, Medium ≤ 800k, High ≤ 1.5M. Plants may use two
 * thirds of that; the rest stays for architecture, terrain, water, residents
 * and far scenery. The former budgets (trees 9M/3M/700k, source groundcover
 * 3M/900k/200k, regional grass 400k/250k/120k) were 3 to 8 times the table,
 * and authored cells drew up to them while their simplified models prepared.
 * Regional grass keeps 16% so the riverbank's authored plants (the riparian
 * cohort) still fit whole on Low; groundcover keeps 16% for its family reserve. */
export type PlantQuality = 'low' | 'medium' | 'high';
export const LEGACY_VIEW_TRIANGLE_BUDGET: Readonly<Record<PlantQuality, number>> = Object.freeze({low: 300_000, medium: 800_000, high: 1_500_000});
export const EALDHOLT_PLANT_TRIANGLE_SHARE = Object.freeze({trees: .34, groundcover: .16, regionalGroundcover: .16});
export type PlantBudgetKind = keyof typeof EALDHOLT_PLANT_TRIANGLE_SHARE;
export function ealdholtPlantTriangleBudget(kind: PlantBudgetKind, quality: PlantQuality): number {
  return Math.floor(LEGACY_VIEW_TRIANGLE_BUDGET[quality] * EALDHOLT_PLANT_TRIANGLE_SHARE[kind]);
}

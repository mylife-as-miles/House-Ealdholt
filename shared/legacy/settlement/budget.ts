import type { SettlementPlacement } from './contract';

/** Conservative geometry allowances for actual source buildings. These are
 * presentation limits, never currency or a Legacy progression rule. */
export const ESTATE_RENDER_LIMIT = { triangles: 80_000, draws: 40 } as const;
export function settlementRenderCost(placements: readonly SettlementPlacement[]) {
  let triangles = 0, draws = 0;
  for (const p of placements) {
    const cost = p.kind === 'pavilion' ? [24_000, 10] : p.kind === 'ruin-arch' ? [192, 1] : [512, 5];
    triangles += cost[0]; draws += cost[1];
  }
  return { triangles, draws };
}
export function settlementBudgetReason(placements: readonly SettlementPlacement[]): string | null {
  const cost = settlementRenderCost(placements);
  return cost.triangles > ESTATE_RENDER_LIMIT.triangles || cost.draws > ESTATE_RENDER_LIMIT.draws
    ? 'This estate is at its detail limit. Remove a placement to make room.' : null;
}

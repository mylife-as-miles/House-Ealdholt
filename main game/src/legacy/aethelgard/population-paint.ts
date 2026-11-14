/** Reduced-motion paint admission. Loading alone changes no world pixels. */
export function populationPaintSignature(state: {
  selected: number; loading: number; actorSets: number; setups: number; revision: number;
}): string | null {
  if (state.loading > 0 || state.actorSets < state.selected) return null;
  return `${state.selected}:${state.setups}:${state.revision}`;
}

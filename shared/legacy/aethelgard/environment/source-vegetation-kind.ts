/** Authored semantic cells first; the compact Elderbloom export keeps three
 * known top-level family names instead of cell metadata. Never classify its
 * hidden prototype or generated component children as new vegetation owners. */
export function identifySourceVegetation(name: string, data: {
  readonly crownfallElderbloom?: {readonly kind?: unknown; readonly cellSize?: unknown};
  readonly crownfallWoodlandPrototype?: unknown;
}, directSourceChild: boolean): 'tree' | 'groundcover' | null {
  if (data.crownfallWoodlandPrototype) return null;
  const meta = data.crownfallElderbloom;
  if (Number(meta?.cellSize) > 0 && (meta?.kind === 'tree' || meta?.kind === 'groundcover')) return meta.kind;
  if (!directSourceChild) return null;
  if (/^SM_BlackAlder_/i.test(name)) return 'tree';
  if (/^S_Grass_Clumps_/i.test(name)) return 'groundcover';
  return null;
}

interface Direction { readonly x: number; readonly y: number; readonly z: number }
/** Unit source-space sun directions. Live illumination still moves continuously;
 * only the expensive static shadow map waits for a visible angular change.
 * Camera/caster invalidation remains the caller's independent responsibility.
 * The village sun turns 0.25° a world minute (one every 4 s, ticked four times a
 * second), so 0.5° (0.25° on High) redraws the map a handful of times a real
 * minute instead of 240 (audit L-13); a shadow edge 10 m from its caster steps
 * about 9 cm (4 cm on High). */
export function sunShadowNeedsRefresh(previous: Direction | null, next: Direction, preset: 'low' | 'medium' | 'high'): boolean {
  if (!previous) return true;
  const degrees = preset === 'high' ? .25 : .5;
  return previous.x * next.x + previous.y * next.y + previous.z * next.z < Math.cos(degrees * Math.PI / 180);
}

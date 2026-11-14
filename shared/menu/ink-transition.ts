/** Shared story/Chronicles transition. A local mask reveals content without moving the viewpoint. */
export const INK_REVEAL = Object.freeze({
  mask: 'assets/transitions/ink-mask.png',
  durationMs: 560,
  finalScale: 4.2,
  easing: 'cubic-bezier(0.77, 0, 0.175, 1)',
});
export function usesInkReveal(view: string): boolean {
  return view === 'chapters' || view === 'chronicles' || view === 'chapter-preview';
}

/** Evaluate the same cubic-bezier timing curve for the stationary Quest material. */
export function inkSpread(progress: number): number {
  const x = Math.max(0, Math.min(1, progress));
  if (x === 0 || x === 1) return x * INK_REVEAL.finalScale;
  let low = 0, high = 1;
  for (let i = 0; i < 16; i++) {
    const t = (low + high) / 2, a = 1 - t;
    const at = 3 * a * a * t * .77 + 3 * a * t * t * .175 + t * t * t;
    if (at < x) low = t; else high = t;
  }
  const t = (low + high) / 2;
  return INK_REVEAL.finalScale * (3 * (1 - t) * t * t + t * t * t);
}

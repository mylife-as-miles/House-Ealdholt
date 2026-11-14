/** Shared desktop rendering budget; CSS layout and text stay at display size. */
export function scaledPixelRatio(devicePixelRatio: number, scale: number): number {
  const boundedScale = Number.isFinite(scale) ? Math.min(100, Math.max(50, scale)) : 100;
  return Math.min(devicePixelRatio, 1.5) * boundedScale / 100;
}

/** A frame-rate cap in frames per second; 0 is the display rate. */
export type FrameLimit = 0 | 30 | 60 | 120;

// Keep the cadence stable when rAF timestamps fall just below a frame boundary.
export function nextRenderTimestamp(
  now: number,
  previous: number,
  limit: FrameLimit,
): number | null {
  if (!limit) return now;
  const interval = 1000 / limit;
  const elapsed = now - previous;
  if (elapsed + 0.1 < interval) return null;
  return now - Math.max(0, elapsed - interval) % interval;
}

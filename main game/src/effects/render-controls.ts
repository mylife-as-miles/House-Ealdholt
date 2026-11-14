import type { FrameLimit } from "../../../shared/menu/render-resolution";
export type { FrameLimit } from "../../../shared/menu/render-resolution";

export function normalizeRenderScale(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(50, value)) : 100;
}

export function normalizeFrameLimit(value: number): FrameLimit {
  return value === 30 || value === 60 || value === 120 ? value : 0;
}

export { nextRenderTimestamp, scaledPixelRatio } from "../../../shared/menu/render-resolution";


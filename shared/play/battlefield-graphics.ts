export type BattlefieldGraphics = 'auto' | 'low' | 'medium' | 'high';
export function integratedGraphics(renderer: string): boolean {
  return /Intel|UHD|Iris|Radeon\(TM\) Graphics|Radeon Graphics|Vega \d|Mali|Adreno|PowerVR|Apple GPU|SwiftShader|llvmpipe/i.test(renderer);
}
/** The next render scale for dynamic resolution: down a step below ~42 fps, up a step from 57, between `minimum`
 * (never above `maximum`) and `maximum`. */
export function nextBattlefieldScale(scale: number, fps: number, maximum = 1, minimum = .5): number {
  const limit = Math.max(.5, Math.min(1, maximum));
  const floor = Math.min(limit, Math.max(.5, minimum));
  if (!Number.isFinite(fps) || fps <= 0) return Math.min(limit, Math.max(floor, scale));
  return fps < 42 ? Math.max(floor, Math.min(limit, scale * .85)) : fps >= 57 ? Math.min(limit, scale * 1.08) : Math.min(limit, Math.max(floor, scale));
}

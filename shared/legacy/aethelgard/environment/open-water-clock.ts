/** Bounded presentation scheduling only. It consumes the existing world clock;
 * pause, rewind and observer catch-up never seek the spectral phase. */
export interface OpenWaterClock {
  readonly timeSeconds: number; readonly deltaSeconds: number; readonly updatesPerSecond: number;
  step(elapsedSeconds: number, animated: boolean): boolean;
  reset(): void;
}
export function createOpenWaterClock(updatesPerSecond = 10): OpenWaterClock {
  if (!Number.isFinite(updatesPerSecond) || updatesPerSecond < 1 || updatesPerSecond > 15) throw Error('Open Water update rate must be 1..15 Hz.');
  let time = 0, delta = 0, previous: number | null = null, active = false, debt = 0, initialized = false, lastUpdate = 0;
  return { get timeSeconds() { return time; }, get deltaSeconds() { return delta; }, updatesPerSecond,
    step(elapsedSeconds, animated) {
      delta = 0;
      if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || typeof animated !== 'boolean') { previous = null; active = false; return false; }
      const raw = previous === null ? 0 : elapsedSeconds - previous;
      const dt = animated && active && raw >= 0 && raw <= 1 ? Math.min(.1, raw) : 0;
      previous = elapsedSeconds; active = animated; time += dt; debt += dt;
      if (!initialized) { if (!animated) return false; initialized = true; lastUpdate = time; return true; }
      if (!animated || debt + 1e-12 < 1 / updatesPerSecond) return false;
      delta = time - lastUpdate; lastUpdate = time; debt = Math.max(0, debt - Math.floor((debt + 1e-12) * updatesPerSecond) / updatesPerSecond); return true;
    },
    reset() { time = 0; delta = 0; previous = null; active = false; debt = 0; initialized = false; lastUpdate = 0; },
  };
}
export interface OpenWaterCapabilities {
  readonly webgl2: boolean; readonly floatColorBuffer: boolean; readonly maximumDrawBuffers: number;
  readonly maximumColorAttachments: number; readonly maximumTextureSize: number; readonly fragmentTextureUnits: number;
}
export function openWaterCapabilityFailure(capabilities: OpenWaterCapabilities, resolution: number): string | null {
  if (![capabilities.maximumDrawBuffers, capabilities.maximumColorAttachments, capabilities.maximumTextureSize, capabilities.fragmentTextureUnits].every(Number.isFinite)) return 'invalid-capabilities';
  if (!capabilities.webgl2) return 'webgl2-unavailable';
  if (!capabilities.floatColorBuffer) return 'float-color-buffer-unavailable';
  if (capabilities.maximumDrawBuffers < 2 || capabilities.maximumColorAttachments < 2) return 'multiple-render-targets-unavailable';
  if (capabilities.maximumTextureSize < resolution) return 'texture-size-unavailable';
  if (capabilities.fragmentTextureUnits < 16) return 'fragment-texture-budget-unavailable';
  return null;
}

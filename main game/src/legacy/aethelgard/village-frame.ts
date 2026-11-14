/** Small, renderer-free pieces of the village frame loop: failure handling,
 * frame pacing and throttled diagnostics. Kept apart so Node tests cover them. */

export interface VillageFrameGuard {
  /** The error that stopped the loop, or null while it runs. */
  readonly failure: unknown;
  readonly failed: boolean;
  run(now: number): void;
}

/** Runs one frame body. The first throw stops the loop for good and is handed
 * to `onFailure` once (which shows the error panel); later frames do nothing,
 * so a broken world never keeps throwing on every animation frame. */
export function createVillageFrameGuard(body: (now: number) => void, onFailure: (error: unknown) => void): VillageFrameGuard {
  let failed = false, failure: unknown = null;
  return {
    get failure() { return failure; },
    get failed() { return failed; },
    run(now) {
      if (failed) return;
      try { body(now); }
      catch (error) {
        failed = true; failure = error;
        try { onFailure(error); }
        catch (secondary) { console.error('Ealdholt frame failure could not be reported.', secondary); }
      }
    },
  };
}

export interface VillageFramePacing {
  /** The player's limit in frames a second; 0 means unlimited. */
  readonly frameLimit: number;
  /** Fire, residents or garden animate without the camera moving. */
  readonly ambientAnimation: boolean;
  /** The camera is being dragged, settling, following or in a pose transition. */
  readonly cameraMoving: boolean;
}

/** Frames a second for the village loop (0 = every animation frame). Camera
 * motion honours the player's limit; ambient animation alone runs at 30 Hz,
 * and a still demand-rendered view at the limit or 120 Hz. */
export function villageFrameLimit(pacing: VillageFramePacing): number {
  const limit = Number.isFinite(pacing.frameLimit) && pacing.frameLimit > 0 ? pacing.frameLimit : 0;
  if (pacing.cameraMoving) return limit;
  if (pacing.ambientAnimation) return limit ? Math.min(limit, 30) : 30;
  return limit ? Math.min(limit, 120) : 0;
}

/** Milliseconds between frames for a limit, with 1 ms of slack for rAF jitter. */
export function villageFrameInterval(limit: number): number {
  return limit > 0 ? Math.max(0, 1000 / limit - 1) : 0;
}

/** How long after the last camera change the loop keeps the player's rate. */
export const VILLAGE_CAMERA_SETTLE_MS = 160;

export interface VillageDiagnosticsReporter {
  /** True when this frame should refresh throttled diagnostics. */
  readonly due: boolean;
  /** Starts a frame; returns `due`. */
  begin(now: number): boolean;
  /** Marks throttled diagnostics as written for this frame. */
  wrote(now: number): void;
  /** Writes a data attribute only when its text changed. */
  set(name: string, value: string): void;
}

/** Diagnostics on the host element are for tests and capture tools. Release
 * builds refresh them at most every `intervalMs` and skip unchanged values,
 * instead of about 90 attribute writes and 30 JSON encodings every frame. */
export function createVillageDiagnosticsReporter(host: { readonly dataset: DOMStringMap }, intervalMs: number): VillageDiagnosticsReporter {
  let due = true, lastWrite = -Infinity;
  return {
    get due() { return due; },
    begin(now) { due = intervalMs <= 0 || now - lastWrite >= intervalMs; return due; },
    wrote(now) { if (due) lastWrite = now; },
    // Compared with the live attribute, so writes made elsewhere stay honest.
    set(name, value) { if (host.dataset[name] !== value) host.dataset[name] = value; },
  };
}

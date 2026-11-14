import { createVillagePopulationObserver, getVillagePopulationObservationStatus,
  type VillagePopulationObservationOptions, type VillagePopulationRuntime } from './village-population-runtime';

export interface VillagePopulationObservationRequest {
  /** An owner/visit token, not the changing canonical generation. */
  readonly owner: unknown;
  readonly snapshot: VillagePopulationRuntime;
  readonly requestedMilliseconds: number;
  readonly options?: VillagePopulationObservationOptions;
}
export interface VillagePopulationObservationTask { cancel(): void }
/** Callbacks must run in a later CPU task, independently of compositor RAF. */
export interface VillagePopulationObservationScheduler {
  schedule(callback: () => void): VillagePopulationObservationTask;
}
const defaultScheduler: VillagePopulationObservationScheduler = {
  schedule(callback) {
    const timer = setTimeout(callback, 0);
    (timer as unknown as { unref?: () => void }).unref?.();
    return { cancel: () => clearTimeout(timer) };
  },
};

/** A deferred owner for the existing two-minute read-only observation slice.
 * Catch-up is independent of render callbacks, no time is invented, and no observer
 * result enters the canonical store. A synchronous GL stall can still delay a
 * main-thread task; this supplies catch-up, not a hard real-time guarantee. */
export function createVillagePopulationObservationPump(options: {
  read(): VillagePopulationObservationRequest | null;
  allowed(): boolean;
  accepted(snapshot: VillagePopulationRuntime): void;
  /** Coalesced progress only. Owners must not force a heavy draw per slice. */
  changed?(): void;
  onError?(error: unknown): void;
  scheduler?: VillagePopulationObservationScheduler;
  now?: () => number;
  notificationMilliseconds?: number;
}) {
  const scheduler = options.scheduler ?? defaultScheduler, now = options.now ?? (() => performance.now());
  const notificationMilliseconds = options.notificationMilliseconds ?? 250;
  if (!Number.isFinite(notificationMilliseconds) || notificationMilliseconds < 0)
    throw Error('Observation progress needs a bounded notification cadence.');
  let observer = createVillagePopulationObserver(), context: VillagePopulationObservationRequest | null = null;
  let current: VillagePopulationRuntime | null = null, task: VillagePopulationObservationTask | null = null;
  let ticket = 0, running = false, disposed = false, lastNotification = -Infinity;
  const stats = { tasks: 0, slices: 0, notifications: 0, cancellations: 0, taskPending: false,
    maximumSliceMilliseconds: 0, error: '' };
  const sameOwner = (a: VillagePopulationObservationRequest, b: VillagePopulationObservationRequest) =>
    a.owner === b.owner && a.snapshot.worldKey === b.snapshot.worldKey && a.snapshot.population === b.snapshot.population;
  const sameContext = (a: VillagePopulationObservationRequest, b: VillagePopulationObservationRequest) =>
    sameOwner(a, b) && a.options?.site === b.options?.site && a.options?.workplaceFrame === b.options?.workplaceFrame;
  const pending = () => current ? (getVillagePopulationObservationStatus(current)?.pendingMilliseconds ?? 0) > 0 : false;
  function cancel(): void {
    ticket++;
    const previous = task; task = null; stats.taskPending = false;
    if (previous) { stats.cancellations++; previous.cancel(); }
  }
  function fail(error: unknown): void {
    cancel(); stats.error = error instanceof Error ? error.message : String(error); options.onError?.(error);
  }
  function wake(): void {
    if (disposed || running || task || !pending() || !options.allowed() || stats.error) return;
    const expected = ticket; let scheduling = true;
    try {
      const scheduled = scheduler.schedule(() => {
        if (scheduling) throw Error('Observation scheduler must defer its callback.');
        if (disposed || expected !== ticket) return;
        task = null; stats.taskPending = false; stats.tasks++;
        step();
      });
      if (!scheduled || typeof scheduled.cancel !== 'function') throw Error('Observation scheduler needs a cancellation handle.');
      task = scheduled; stats.taskPending = true;
    } catch (error) { fail(error); }
    finally { scheduling = false; }
  }
  function step(): VillagePopulationRuntime | null {
    if (disposed || running || stats.error) return current;
    if (!options.allowed()) { cancel(); return current; }
    try {
      // Read the current clock, weather and safety callbacks in this task. A
      // queued callback never captures a superseded speed/command request.
      const request = options.read();
      if (!request) { cancel(); return current; }
      if (context && !sameContext(context, request)) {
        cancel();
        // A new visit starts a new read-only branch. A site change never
        // resets an existing branch's physical/source-allocation provenance.
        if (!sameOwner(context, request)) { observer = createVillagePopulationObserver(); current = null; }
      }
      context = request;
      const expected = ticket, owner = observer, start = now();
      running = true;
      let next: VillagePopulationRuntime;
      try { next = owner.observe(request.snapshot, request.requestedMilliseconds, request.options); }
      finally { running = false; stats.maximumSliceMilliseconds = Math.max(stats.maximumSliceMilliseconds, Math.max(0, now() - start)); }
      stats.slices++;
      // Clear/pause/disposal and source/owner changes cannot publish an old
      // result, including reentrant changes from a supplied command callback.
      const latest = options.read();
      if (disposed || expected !== ticket || !options.allowed() || !latest || !sameContext(request, latest)) return current;
      current = next; options.accepted(next);
      if (disposed || expected !== ticket) return current;
      stats.error = '';
      const time = now();
      if (!pending() || time - lastNotification >= notificationMilliseconds) {
        lastNotification = time; stats.notifications++; options.changed?.();
      }
      wake();
      return current;
    } catch (error) { running = false; fail(error); return current; }
  }
  return {
    stats, step, wake,
    get snapshot(): VillagePopulationRuntime | null { return current; },
    /** Inactivity retains the previous valid state; resuming catches up from it. */
    pause: cancel,
    clear(): void {
      cancel(); observer = createVillagePopulationObserver(); context = null; current = null;
      lastNotification = -Infinity; stats.error = '';
    },
    dispose(): void { if (disposed) return; disposed = true; cancel(); observer.clear(); context = null; current = null; },
  };
}

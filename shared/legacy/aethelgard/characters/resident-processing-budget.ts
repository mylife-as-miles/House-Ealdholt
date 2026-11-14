import type { VillagePopulationResidentState, VillagePopulationSample } from './village-population-runtime';

export interface ResidentProcessingTask { cancel(): void }
export interface ResidentProcessingScheduler {
  /** Must defer its callback to a later CPU task, independently of drawing. */
  schedule(callback: () => void): ResidentProcessingTask;
}
const defaultScheduler: ResidentProcessingScheduler = {
  schedule(callback) {
    const timer = setTimeout(callback, 0);
    (timer as unknown as { unref?: () => void }).unref?.();
    return { cancel: () => clearTimeout(timer) };
  },
};

/** A presentation-only queue. Complete input samples remain authoritative:
 * nothing here advances, samples, edits or thins persistent life/navigation.
 * Expensive qualifications resume across CPU tasks; publication is atomic.
 * An in-flight frame finishes before a newer request starts, so continuously
 * changing nearby actors cannot starve the rest of its finite resident queue. */
export function createResidentProcessingBudget<F extends { readonly sample: VillagePopulationSample }, T>(options: {
  qualify(state: VillagePopulationResidentState): T;
  /** False only for a cheap rejection, such as a non-presentable source row. */
  expensive(state: VillagePopulationResidentState): boolean;
  accepted(frame: F, qualifications: ReadonlyMap<string, T>): void;
  onError(error: unknown): void;
  scheduler?: ResidentProcessingScheduler;
  now?: () => number;
  maximumQualificationsPerTask?: number;
  maximumTaskMilliseconds?: number;
}) {
  const maximumQualificationsPerTask = options.maximumQualificationsPerTask ?? 16;
  const maximumTaskMilliseconds = options.maximumTaskMilliseconds ?? 3;
  if (!Number.isSafeInteger(maximumQualificationsPerTask) || maximumQualificationsPerTask < 1
    || !Number.isFinite(maximumTaskMilliseconds) || maximumTaskMilliseconds <= 0)
    throw Error('Resident presentation needs a positive bounded processing budget.');
  const scheduler = options.scheduler ?? defaultScheduler, now = options.now ?? (() => performance.now());
  type Request = { frame: F; context: unknown; priority: (state: VillagePopulationResidentState) => number };
  type Entry = { state: VillagePopulationResidentState; signature: string; rank: number; order: number };
  type Cache = { signature: string; value: T };
  let cache = new Map<string, Cache>(), cacheContext: unknown, previousTime = -Infinity;
  let job: { request: Request; pending: Entry[]; cursor: number; values: Map<string, T>; cache: Map<string, Cache> } | null = null;
  let latest: Request | null = null, task: ResidentProcessingTask | null = null, disposed = false, ticket = 0;
  let runningContext: unknown, latestTime = -Infinity;
  const waiters: Array<() => void> = [];
  const totals = { frames: 0, tasks: 0, qualifications: 0, cacheHits: 0, cheapRejections: 0,
    maximumTaskMilliseconds: 0, maximumQualificationsInTask: 0,
    tierQualifications: { major: 0, scheduled: 0 }, tierMilliseconds: { major: 0, scheduled: 0 } };

  function cancel(): void { ticket++; task?.cancel(); task = null; }
  function settled(): void { if (!job && !latest) for (const resolve of waiters.splice(0)) resolve(); }
  function fail(error: unknown): void { cancel(); job = null; latest = null; settled(); options.onError(error); }
  function start(request: Request): void {
    const { sample } = request.frame, time = sample.time.absoluteWorldMinute + sample.time.fractionalMinute;
    // Clock reversal and source/navigation-authority changes discard prior
    // evidence. Normal clock progress can reuse only an exactly equal source
    // row, freshly sampled after the runtime's hidden-peer/corridor checks.
    if (cacheContext !== request.context || time < previousTime) cache = new Map();
    cacheContext = request.context; previousTime = time;
    const values = new Map<string, T>(), nextCache = new Map<string, Cache>(), pending: Entry[] = [];
    for (let order = 0; order < sample.residents.length; order++) {
      const state = sample.residents[order], signature = JSON.stringify(state), old = cache.get(state.residentId);
      // Full rows include intent, route/source holds, arrival identity, work
      // ownership and clock-derived dwell phase. No safety flag is inferred.
      if (old?.signature === signature) {
        values.set(state.residentId, old.value); nextCache.set(state.residentId, old); totals.cacheHits++;
      } else if (!options.expensive(state)) {
        const value = options.qualify(state);
        values.set(state.residentId, value); nextCache.set(state.residentId, { signature, value }); totals.cheapRejections++;
      } else pending.push({ state, signature, rank: request.priority(state), order });
    }
    pending.sort((a, b) => b.rank - a.rank || a.order - b.order);
    job = { request, pending, cursor: 0, values, cache: nextCache };
  }
  function wake(): void {
    if (disposed || task || !job) return;
    const expected = ticket; let scheduling = true;
    const scheduled = scheduler.schedule(() => {
      if (scheduling) throw Error('Resident processing scheduler must defer its callback.');
      if (disposed || expected !== ticket) return;
      task = null; run();
    });
    if (!scheduled || typeof scheduled.cancel !== 'function') throw Error('Resident processing needs a CPU-task cancellation handle.');
    task = scheduled;
    scheduling = false;
  }
  function run(): void {
    if (disposed || !job) return;
    try {
      const current = job, started = now(); let admitted = 0;
      while (current.cursor < current.pending.length && admitted < maximumQualificationsPerTask
        && (admitted === 0 || now() - started < maximumTaskMilliseconds)) {
        const entry = current.pending[current.cursor++], began = now(), value = options.qualify(entry.state);
        const tier = entry.state.tier === 'major' ? 'major' : 'scheduled';
        totals.tierQualifications[tier]++; totals.tierMilliseconds[tier] += Math.max(0, now() - began);
        current.values.set(entry.state.residentId, value);
        current.cache.set(entry.state.residentId, { signature: entry.signature, value });
        admitted++; totals.qualifications++;
      }
      totals.tasks++; totals.maximumQualificationsInTask = Math.max(totals.maximumQualificationsInTask, admitted);
      totals.maximumTaskMilliseconds = Math.max(totals.maximumTaskMilliseconds, Math.max(0, now() - started));
      if (current.cursor === current.pending.length) {
        cache = current.cache; job = null; totals.frames++;
        options.accepted(current.request.frame, current.values);
        if (!disposed && latest) { const request = latest; latest = null; start(request); }
      }
      wake();
      settled();
    } catch (error) { fail(error); }
  }
  return {
    request(frame: F, context: unknown, priority: Request['priority']): void {
      if (disposed) return;
      const request = { frame, context, priority };
      try {
        const time = frame.sample.time.absoluteWorldMinute + frame.sample.time.fractionalMinute;
        if (runningContext !== context || time < latestTime) {
          cancel(); job = null; latest = null; cache.clear(); previousTime = -Infinity;
        }
        runningContext = context; latestTime = time;
        if (job) { latest = request; return; }
        start(request); run();
      } catch (error) { fail(error); }
    },
    get diagnostics() {
      return Object.freeze({ stage: 'presentation-qualification' as const, maximumQualificationsPerTask, budgetMilliseconds: maximumTaskMilliseconds,
        backlog: job ? job.pending.length - job.cursor : 0, queuedFrame: latest !== null, taskPending: task !== null,
        ...totals, tierQualifications: Object.freeze({ ...totals.tierQualifications }), tierMilliseconds: Object.freeze({ ...totals.tierMilliseconds }) });
    },
    settled(): Promise<void> { return !job && !latest ? Promise.resolve() : new Promise(resolve => waiters.push(resolve)); },
    dispose(): void { if (disposed) return; disposed = true; cancel(); job = null; latest = null; cache.clear(); settled(); },
  };
}

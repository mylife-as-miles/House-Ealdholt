/** Bounded renderer-owned preparation, adapted from BakedVoxelLighting's
 * preparation-queue.js / gpu-upload-queue.js (MIT). A frame runs synchronous
 * GPU operations until about `frameMilliseconds` of CPU or `frameBytes` of
 * uploads are spent, and stops at the first asynchronous one (a shader
 * compile): that one holds the queue until it settles, so async work still
 * never holds the render loop hostage. One operation per frame (as before,
 * audit L-10) capped the village at 30–60 jobs a second whatever the GPU.
 *
 * `overflow` decides what a request does when `maximumJobs` are queued.
 * 'reject' refuses it (callers that own a retry policy). 'wait' holds it,
 * first come first served, until a slot frees: the village uses this, so a
 * burst of cells or terrain pages waits its turn instead of failing for good
 * (audit L-25). A waiting request still honours its abort signal and dispose. */
export type WorldPreparationOverflow = 'reject' | 'wait';
export function createWorldPreparationQueue(wake: () => void, maximumJobs = 64, frameBytes = 1024 * 1024, frameMilliseconds = 4, overflow: WorldPreparationOverflow = 'reject') {
  type Job = {bytes: number; priority: () => number; signal: AbortSignal; work: () => unknown;
    resolve: (value: unknown) => void; reject: (reason: unknown) => void; serial: number};
  type Waiting = {job: Job; abort: () => void};
  const jobs: Job[] = [];
  const waiting: Waiting[] = [];
  const idle: (() => void)[] = [];
  let disposed = false, running = false, serial = 0, burst = 0;
  const stats = {pending: 0, waiting: 0, completed: 0, cancelled: 0, failed: 0, bytesSubmitted: 0, lastCpuMilliseconds: 0};
  function notifyIdle() {if (!running && !jobs.length && !waiting.length) while (idle.length) idle.shift()!();}
  /** Moves held requests into free slots, oldest first. */
  function admit() {
    let admitted = false;
    while (waiting.length && jobs.length < maximumJobs) {
      const {job, abort} = waiting.shift()!; job.signal.removeEventListener('abort', abort); jobs.push(job); admitted = true;
    }
    stats.waiting = waiting.length; stats.pending = jobs.length;
    return admitted;
  }
  return {
    stats,
    get pending() { return jobs.length > 0 || running || waiting.length > 0; },
    /** Schedulers wait for a submitted promise's completion wake instead of
     * polling the renderer while the operation is still in flight. */
    get running() { return running; },
    /** Retirement waits for submitted GPU work without keeping queued jobs.
     * Keep the renderer/programs alive through this barrier on view teardown. */
    whenIdle(): Promise<void> {
      return running || jobs.length || waiting.length ? new Promise(resolve => idle.push(resolve)) : Promise.resolve();
    },
    enqueue<T>(options: {bytes: number; priority: () => number; signal: AbortSignal; work: () => T | Promise<T>}): Promise<T> {
      if (disposed) return Promise.reject(Error('World preparation is disposed.'));
      const full = jobs.length >= maximumJobs;
      if (!Number.isSafeInteger(options.bytes) || options.bytes < 0 || options.bytes > frameBytes || full && overflow === 'reject') {
        return Promise.reject(Error('World preparation exceeds the bounded job/upload budget.'));
      }
      if (options.signal.aborted) return Promise.reject(options.signal.reason ?? Error('World preparation cancelled.'));
      const promise = new Promise<T>((resolve, reject) => {
        const job: Job = {...options, resolve: resolve as (value: unknown) => void, reject, serial: serial++};
        if (!full) { jobs.push(job); return; }
        const entry: Waiting = {job, abort: () => {
          const index = waiting.indexOf(entry); if (index < 0) return;
          waiting.splice(index, 1); stats.waiting = waiting.length; stats.cancelled++;
          reject(options.signal.reason ?? Error('World preparation cancelled.')); notifyIdle();
        }};
        options.signal.addEventListener('abort', entry.abort, {once: true}); waiting.push(entry);
      });
      stats.pending = jobs.length; stats.waiting = waiting.length; wake(); return promise;
    },
    step(now: () => number = () => performance.now()) {
      if (disposed || running) return;
      for (let i = jobs.length - 1; i >= 0; i--) {
        if (!jobs[i].signal.aborted && Number.isFinite(jobs[i].priority())) continue;
        const [job] = jobs.splice(i, 1); stats.cancelled++; job.reject(job.signal.reason ?? Error('Obsolete world preparation.'));
      }
      admit();
      if (!jobs.length) {notifyIdle(); return;}
      const start = now(); let bytes = 0, ran = 0;
      while (jobs.length && !running && !disposed) {
        let next = 0;
        // Every eighth operation services the oldest retained request.
        if (++burst < 8) {
          for (let i = 1; i < jobs.length; i++) if (jobs[i].priority() < jobs[next].priority()) next = i;
        } else { burst = 0; for (let i = 1; i < jobs.length; i++) if (jobs[i].serial < jobs[next].serial) next = i; }
        // The first operation always runs; later ones only within the frame's upload and CPU budgets.
        if (ran > 0 && (bytes + jobs[next].bytes > frameBytes || now() - start >= frameMilliseconds)) { burst = burst === 0 ? 7 : burst - 1; break; } // the choice not taken is made again next frame
        const [job] = jobs.splice(next, 1); admit(); ran++; bytes += job.bytes; stats.bytesSubmitted += job.bytes;
        let result: unknown, threw = false, cause: unknown;
        try { result = job.work(); } catch (error) { threw = true; cause = error; }
        if (threw) { stats.failed++; job.reject(cause); continue; }
        if (result !== null && (typeof result === 'object' || typeof result === 'function') && typeof (result as PromiseLike<unknown>).then === 'function') {
          // Asynchronous: it holds the queue until it settles, and this frame does no more.
          running = true;
          Promise.resolve(result).then(value => {
            if (disposed || job.signal.aborted) { stats.cancelled++; job.reject(job.signal.reason ?? Error('World preparation retired.')); }
            else { stats.completed++; job.resolve(value); }
          }, error => { stats.failed++; job.reject(error); }).finally(() => { running = false; notifyIdle(); if (!disposed) wake(); });
          break;
        }
        if (disposed || job.signal.aborted) { stats.cancelled++; job.reject(job.signal.reason ?? Error('World preparation retired.')); }
        else { stats.completed++; job.resolve(result); }
      }
      stats.lastCpuMilliseconds = Math.max(0, now() - start); stats.pending = jobs.length;
      if (!running) {
        // Settled synchronously: the next frame continues (after the producers' own continuations enqueue more).
        if (jobs.length) queueMicrotask(() => { if (!disposed) wake(); }); else notifyIdle();
      }
    },
    /** The most one frame uploads (and the largest job accepted). */
    frameBytes,
    dispose() {
      if (disposed) return; disposed = true;
      for (const {job, abort} of waiting.splice(0)) { job.signal.removeEventListener('abort', abort); jobs.push(job); }
      for (const job of jobs) { stats.cancelled++; job.reject(Error('World preparation disposed.')); }
      jobs.length = 0; stats.pending = 0; stats.waiting = 0; notifyIdle();
    },
  };
}
export type WorldPreparationQueue = ReturnType<typeof createWorldPreparationQueue>;

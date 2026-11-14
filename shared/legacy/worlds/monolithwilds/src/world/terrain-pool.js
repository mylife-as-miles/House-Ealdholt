// Tiny promise-based pool of terrain workers, with a main-thread fallback (same job code) for
// environments without module workers. `runLocal` executes a job synchronously on the main thread
// (used by screenshot mode, where a frame may block until the view is fully refined).
import { runJob } from './terrain-exec.js';

export function createTerrainPool(size) {
  const local = { world: null, cache: new Map() };
  const workers = [];
  const pending = new Map();
  let nextId = 1;
  let broken = false;

  const fail = (reason) => {
    if (broken) return;
    broken = true;
    console.warn('[terrain] workers unavailable, computing on the main thread:', reason);
    for (const w of workers) w.terminate();
    // re-run whatever was in flight locally
    const jobs = [...pending.values()];
    pending.clear();
    for (const j of jobs) runDeferred(j.msg, j.resolve, j.reject);
  };

  if (typeof Worker !== 'undefined' && size > 0) {
    try {
      for (let i = 0; i < size; i++) {
        const w = new Worker(new URL('./terrain-worker.js', import.meta.url), { type: 'module' });
        w.inflight = 0;
        w.onmessage = (e) => {
          const { id, result, error } = e.data;
          const job = pending.get(id);
          if (!job) return;
          pending.delete(id);
          w.inflight--;
          if (error) job.reject(new Error(error));
          else job.resolve(result);
        };
        w.onerror = (e) => fail(e.message || 'worker error');
        workers.push(w);
      }
    } catch (err) {
      fail(err);
    }
  } else {
    broken = true;
  }

  function runDeferred(msg, resolve, reject) {
    setTimeout(() => {
      try {
        resolve(runJob(local, msg).result);
      } catch (err) {
        reject(err);
      }
    }, 0);
  }

  return {
    get size() {
      return broken ? 1 : workers.length;
    },
    get threaded() {
      return !broken;
    },
    local,
    /** In-flight job count of worker i (0 for the fallback). */
    inflight(i) {
      return broken ? 0 : workers[i].inflight;
    },
    /** Run a job on worker `i` (or the fallback). Transferables in `transfer` are moved. */
    run(i, msg, transfer = []) {
      return new Promise((resolve, reject) => {
        if (broken) return runDeferred(msg, resolve, reject);
        const id = nextId++;
        msg.id = id;
        pending.set(id, { msg, resolve, reject });
        const w = workers[i % workers.length];
        w.inflight++;
        w.postMessage(msg, transfer);
      });
    },
    /** Run synchronously on the main thread. */
    runLocal(msg) {
      return runJob(local, msg).result;
    },
    /** Send the same message to every worker (and the local state). */
    broadcast(msg) {
      runJob(local, msg);
      if (broken) return Promise.resolve();
      return Promise.all(workers.map((_, i) => this.run(i, { ...msg })));
    },
    dispose() {
      for (const w of workers) w.terminate();
    },
  };
}

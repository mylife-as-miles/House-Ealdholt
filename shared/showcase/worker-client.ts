import { MAX_ARCHIVE_BYTES, MAX_PGN_BYTES } from './catalog';
import type { ReplayJob, ReplayJobResponse, ReplayJobValue } from './replay-jobs';

const aborted = () => new DOMException('Replay processing cancelled', 'AbortError');
function validateEnvelope(job: ReplayJob): void {
  const text = job.kind === 'archive' ? job.raw : job.kind === 'open' ? job.entry.pgn : job.kind === 'import' ? job.text : '';
  const limit = job.kind === 'open' ? MAX_PGN_BYTES : MAX_ARCHIVE_BYTES;
  if (text !== null && (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > limit)) throw new Error('The replay data exceeds the supported file limit.');
  if (new TextEncoder().encode(JSON.stringify(job)).byteLength > MAX_ARCHIVE_BYTES * 2) throw new Error('The replay data exceeds the supported file limit.');
}

/** Structured clone removes Object.freeze; restore the public immutable boundaries. */
function freezeValue<T extends ReplayJobValue>(value: T): T {
  const pending: object[] = [value], visited = new WeakSet<object>();
  while (pending.length) {
    const item = pending.pop()!;
    if (visited.has(item)) continue;
    visited.add(item);
    for (const nested of Object.values(item)) if (nested && typeof nested === 'object') pending.push(nested);
    Object.freeze(item);
  }
  return value;
}

/** Every browser job owns a Worker. Abort/finally terminates it; no heavy UI-thread fallback. */
export async function runReplayJob<T extends ReplayJobValue>(job: ReplayJob, signal?: AbortSignal, onProgress?: (value: number) => void): Promise<T> {
  validateEnvelope(job);
  if (signal?.aborted) throw aborted();
  if (typeof Worker === 'undefined') {
    const node = (globalThis as unknown as { process?: { versions?: { node?: string } } }).process?.versions?.node;
    if (!node || typeof window !== 'undefined') throw new Error('Replay processing is unavailable in this browser. Try again in a browser that supports Web Workers.');
    const { executeReplayJob } = await import('./replay-jobs');
    const value = await executeReplayJob(job, signal, onProgress);
    if (signal?.aborted) throw aborted();
    return value as T;
  }
  return new Promise<T>((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./replay-worker.ts', import.meta.url), { type: 'module', name: 'crownfall-replay' }); }
    catch { reject(new Error('Replay processing could not start. Try again.')); return; }
    let settled = false;
    const finish = (error?: Error, value?: ReplayJobValue) => {
      if (settled) return;
      settled = true; signal?.removeEventListener('abort', cancel); worker.terminate();
      if (error) reject(error); else resolve(freezeValue(value!) as T);
    };
    const cancel = () => finish(aborted());
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<ReplayJobResponse>) => {
      if (settled || signal?.aborted) return;
      if (event.data.kind === 'progress') onProgress?.(event.data.progress);
      else if (event.data.kind === 'error') finish(new Error(event.data.message));
      else if (event.data.kind === 'complete') finish(undefined, event.data.value);
    };
    worker.onerror = () => finish(new Error('Replay processing failed. Your current replay and saved archive are unchanged. Try again.'));
    worker.onmessageerror = () => finish(new Error('The processed replay could not be opened. Try again.'));
    if (signal?.aborted) cancel();
    else { try { worker.postMessage(job); } catch { finish(new Error('The replay data could not be sent for processing.')); } }
  });
}

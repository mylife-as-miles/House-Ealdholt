/** Presentation residency only. This module has no resident registry, clock,
 * geography, renderer or save ownership. Resources returned by load are owned
 * preparations; any templates borrowed while preparing them stay cache-owned. */
export type RegionPhase = 'loading' | 'prepared' | 'attached' | 'detached' | 'evictable' | 'evicted' | 'failed' | 'cancelled';

export interface RegionRequest {
  readonly key: string;
  readonly owner: string;
  readonly generation: number;
  /** Cancels this presentation request, not an underlying shared asset fetch. */
  readonly signal: AbortSignal;
  isCurrent(): boolean;
}

export interface RegionStatus {
  readonly key: string;
  owner: string;
  generation: number;
  phase: RegionPhase;
  retained: boolean;
  resident: boolean;
  lastUsedMs: number;
  attempts: number;
  failures: number;
  retryAtMs: number;
  retryExhausted: boolean;
  error: string;
  currentRequest: {owner: string; generation: number; cancelled: boolean} | null;
}

export interface RegionLifecycleOptions<Resource> {
  /** Fixed render inventory; camera movement cannot create unbounded keys. */
  keys: readonly string[];
  load(request: RegionRequest): Promise<Resource>;
  attach(resource: Resource, request: RegionRequest): void;
  detach(resource: Resource, request: RegionRequest): void;
  release(resource: Resource, request: RegionRequest): void;
  prepared?(request: RegionRequest): void;
  changed?(): void;
  now?(): number;
  /** Limits apply to unretained, detached preparations; attached/retained views
   * cannot be evicted out from under their caller. */
  maxDetached: number;
  idleMs: number;
  maxFailures: number;
  retryDelayMs: number;
}

/** A request owns one preparation. Only its current owner/generation can attach
 * it. Detach removes scene participation; eviction independently releases the
 * preparation. Callbacks are synchronous except load and must not throw. */
export function createRegionLifecycle<Resource>(options: RegionLifecycleOptions<Resource>) {
  if (!Number.isInteger(options.maxDetached) || options.maxDetached < 0 ||
      !Number.isFinite(options.idleMs) || options.idleMs < 0 ||
      !Number.isInteger(options.maxFailures) || options.maxFailures < 1 ||
      !Number.isFinite(options.retryDelayMs) || options.retryDelayMs <= 0 ||
      !options.keys.length || new Set(options.keys).size !== options.keys.length || options.keys.some(key => !key)) throw Error('Invalid region residency policy.');
  type Entry = {status: RegionStatus; request: RegionRequest | null; controller: AbortController | null; resource: Resource | null;
    wakeTimer: ReturnType<typeof setTimeout> | null};
  const entries = new Map<string, Entry>(), records: RegionStatus[] = [];
  const now = options.now ?? (() => performance.now());
  let generation = 0, disposed = false;
  const changed = () => options.changed?.();
  function clearWake(entry: Entry) { if (entry.wakeTimer !== null) clearTimeout(entry.wakeTimer); entry.wakeTimer = null; }
  function current(entry: Entry, request: RegionRequest) {
    return !disposed && entry.request === request && entry.status.owner === request.owner &&
      entry.status.generation === request.generation && !request.signal.aborted;
  }
  function invalidate(entry: Entry) {
    // Invalidate before abort: an abort listener may synchronously resolve work.
    const controller = entry.controller; clearWake(entry);
    entry.request = null; entry.controller = null;
    entry.status.generation = ++generation;
    if (entry.status.currentRequest) entry.status.currentRequest.cancelled = true;
    controller?.abort();
  }
  function evict(entry: Entry) {
    const request = entry.request, resource = entry.resource;
    if (resource !== null && request) {
      if (entry.status.phase === 'attached') options.detach(resource, request);
      entry.status.phase = 'evictable'; changed();
      entry.resource = null; entry.status.resident = false;
      invalidate(entry);
      options.release(resource, request);
    } else invalidate(entry);
    entry.status.phase = 'evicted'; entry.status.retained = false; changed();
  }
  function wake(entry: Entry, delayMs: number, expired = false) {
    clearWake(entry);
    entry.wakeTimer = setTimeout(() => {
      entry.wakeTimer = null;
      if (disposed) return;
      if (expired && !entry.status.retained && entry.status.phase !== 'attached' && entry.resource !== null) evict(entry);
      else if (!expired && entry.status.retained && entry.status.phase === 'failed' && !entry.status.retryExhausted) changed();
    }, delayMs);
  }
  function request(key: string, owner: string): RegionRequest | null {
    if (disposed) return null;
    if (!options.keys.includes(key) || !owner) throw Error('Regions require an inventory key and a current owner.');
    let entry = entries.get(key);
    if (!entry) {
      entry = {status: {key, owner, generation: 0, phase: 'evicted', retained: false, resident: false,
        lastUsedMs: now(), attempts: 0, failures: 0, retryAtMs: 0, retryExhausted: false, error: '', currentRequest: null},
      request: null, controller: null, resource: null, wakeTimer: null};
      entries.set(key, entry); records.push(entry.status);
    } else if (entry.status.owner !== owner) {
      evict(entry);
      Object.assign(entry.status, {owner, attempts: 0, failures: 0, retryAtMs: 0, retryExhausted: false, error: '', currentRequest: null});
    }
    const status = entry.status;
    if (!status.retained && entry.resource !== null) clearWake(entry);
    status.retained = true; status.lastUsedMs = now();
    if (entry.request) return entry.request;
    if (status.retryExhausted || now() < status.retryAtMs) return null;
    const controller = new AbortController(), ownEntry = entry;
    const work: RegionRequest = {key, owner, generation: ++generation, signal: controller.signal,
      isCurrent: () => current(ownEntry, work)};
    entry.request = work; entry.controller = controller;
    status.generation = work.generation; status.currentRequest = {owner, generation: work.generation, cancelled: false};
    status.phase = 'loading'; status.attempts++; changed();
    // A microtask also contains a synchronous loader throw within this request.
    void Promise.resolve().then(() => {
      work.signal.throwIfAborted();
      return options.load(work);
    }).then(resource => {
      if (!current(ownEntry, work)) { options.release(resource, work); return; }
      ownEntry.resource = resource; status.resident = true; status.phase = 'prepared';
      status.failures = 0; status.retryAtMs = 0; status.retryExhausted = false; status.error = '';
      changed(); if (current(ownEntry, work)) options.prepared?.(work);
    }).catch(cause => {
      if (!current(ownEntry, work)) return;
      invalidate(ownEntry); status.phase = 'failed'; status.error = String(cause);
      status.failures++; status.retryExhausted = status.failures >= options.maxFailures;
      const delay = options.retryDelayMs * 2 ** (status.failures - 1);
      status.retryAtMs = now() + delay;
      if (!status.retryExhausted) wake(ownEntry, delay);
      changed();
    });
    return work;
  }
  function find(key: string, owner: string) {
    const entry = entries.get(key);
    return !disposed && entry?.status.owner === owner ? entry : null;
  }
  return {
    /** Stable read-only collection for diagnostics, updated on each operation. */
    records: records as readonly Readonly<RegionStatus>[],
    request,
    resource(key: string, owner: string): Resource | null { return find(key, owner)?.resource ?? null; },
    attach(key: string, owner: string): boolean {
      const entry = find(key, owner), work = entry?.request;
      if (!entry || !work || entry.resource === null || !current(entry, work)) return false;
      if (entry.status.phase !== 'attached') { options.attach(entry.resource, work); entry.status.phase = 'attached'; changed(); }
      entry.status.lastUsedMs = now(); return true;
    },
    detach(key: string, owner: string) {
      const entry = find(key, owner);
      if (!entry || entry.status.phase !== 'attached' || entry.resource === null || !entry.request) return;
      options.detach(entry.resource, entry.request); entry.status.phase = 'detached'; entry.status.lastUsedMs = now();
      if (!entry.status.retained) wake(entry, options.idleMs, true);
      changed();
    },
    unretain(key: string, owner: string) {
      const entry = find(key, owner);
      if (!entry || !entry.status.retained) return;
      entry.status.retained = false;
      if (entry.status.phase === 'loading') { invalidate(entry); entry.status.phase = 'cancelled'; }
      else if (entry.resource !== null && entry.status.phase !== 'attached') wake(entry, options.idleMs, true);
      changed();
    },
    /** Explicitly rearm an exhausted failure budget; frame updates never do so. */
    retry(key: string, owner: string) {
      const entry = find(key, owner);
      if (!entry || entry.status.phase !== 'failed') return;
      clearWake(entry); entry.status.failures = 0; entry.status.retryAtMs = 0; entry.status.retryExhausted = false; changed();
    },
    forget(key: string, owner: string) { const entry = find(key, owner); if (entry) evict(entry); },
    sweep() {
      if (disposed) return;
      // Entry count is the caller's fixed regional content inventory, not an
      // unbounded history of camera coordinates.
      let count = 0;
      for (const entry of entries.values()) if (entry.resource !== null && !entry.status.retained && entry.status.phase !== 'attached') {
        if (now() - entry.status.lastUsedMs >= options.idleMs) evict(entry); else count++;
      }
      while (count > options.maxDetached) {
        let oldest: Entry | null = null;
        for (const entry of entries.values()) if (entry.resource !== null && !entry.status.retained && entry.status.phase !== 'attached' &&
          (!oldest || entry.status.lastUsedMs < oldest.status.lastUsedMs ||
            (entry.status.lastUsedMs === oldest.status.lastUsedMs && entry.status.key < oldest.status.key))) oldest = entry;
        if (!oldest) break;
        evict(oldest); count--;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) evict(entry);
    },
  };
}

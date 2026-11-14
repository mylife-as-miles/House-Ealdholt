/** One detached producer's resources. Queue idleness is not proof that an
 * asynchronous owner has stopped submitting work; its complete producer and
 * every acquired lease must settle before a fresh GPU fence is requested. */
const quiescentOwners = new WeakSet<object>();
declare const ownerQuiescent: unique symbol;
export interface WorldOwnerQuiescence {readonly [ownerQuiescent]: true}
export function assertWorldOwnerQuiescence(value: unknown): asserts value is WorldOwnerQuiescence {
  if (!value || typeof value !== 'object' || !quiescentOwners.has(value)) throw Error('An ordered, quiescent world owner is required.');
}

interface OwnerLease {readonly ready: PromiseLike<unknown>; release(): void; releaseUnsubmitted?(): void}
export interface WorldOwnerRetirementOptions {
  /** Synchronously detach and stop/abort production. This must not await retirement. */
  stop(): void;
  /** Includes every spawned continuation; an empty queue or one lease is insufficient. */
  producer(): PromiseLike<unknown>;
  fence(owner: WorldOwnerQuiescence): Promise<void>;
  /** May await view cleanup that depends on `fenced`, never on `retire()`. */
  releaseOwned(): void | Promise<void>;
  releaseCredit(): void;
  maximumLeases?: number;
}

export function createWorldOwnerRetirement(options: WorldOwnerRetirementOptions) {
  const maximum = options.maximumLeases ?? 256;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 4096) throw Error('Invalid owner retirement lease limit.');
  const pending = new Set<Promise<unknown>>(), tracked = new WeakSet<object>();
  const leases: {lease: OwnerLease; released: boolean; ready: boolean}[] = [];
  const stats = {phase: 'active' as 'active' | 'draining' | 'fencing' | 'releasing' | 'retired' | 'held',
    acquired: 0, trackedReady: 0, pendingReady: 0, readyRejected: 0, producerRejected: false, released: 0, unsubmittedReleased: 0, error: ''};
  let retirement: Promise<void> | null = null, finishFence!: () => void;
  // Failure deliberately leaves this pending: owned GPU views remain held.
  const fenced = new Promise<void>(resolve => {finishFence = resolve;});
  function accepting() {
    if (stats.phase !== 'active' && stats.phase !== 'draining') throw Error('World owner production is sealed.');
  }
  function trackReady<T>(value: PromiseLike<T>): Promise<T> {
    accepting();
    const promise = Promise.resolve(value);
    if (tracked.has(promise)) return promise;
    if (stats.trackedReady >= maximum) throw Error('World owner readiness exceeds its bounded limit.');
    tracked.add(promise); pending.add(promise); stats.trackedReady++; stats.pendingReady = pending.size;
    const settled = () => {pending.delete(promise); stats.pendingReady = pending.size;};
    void promise.then(settled, () => {stats.readyRejected++; settled();});
    return promise;
  }
  /** Obtain a fresh paid lease from the raw shared pool, not a family facade
   * that already waits for a global fence. All production must belong to the
   * complete producer; post-seal factories are rejected before allocation. */
  function acquire<T extends OwnerLease>(factory: () => T): T {
    accepting();
    if (leases.length >= maximum || stats.trackedReady >= maximum) throw Error('World owner leases exceed their bounded limit.');
    const lease = factory(), record = {lease, released: false, ready: false};
    leases.push(record); stats.acquired++;
    // Register synchronously before returning control to the producer.
    const ready = trackReady(lease.ready);
    void ready.then(() => {record.ready = true;}, () => {});
    const wrapped = {...lease, release() {/* Normal releases stay owned until the single ordered fence. */}};
    if (lease.releaseUnsubmitted) Object.assign(wrapped, {releaseUnsubmitted() {
      if (record.released) return;
      if (!record.ready) throw Error('Only a ready, explicitly unsubmitted lease may release early.');
      lease.releaseUnsubmitted!(); record.released = true; stats.released++; stats.unsubmittedReleased++;
    }});
    return wrapped;
  }
  function hold(cause: unknown) {
    stats.phase = 'held'; stats.error = (cause instanceof Error ? cause.message : String(cause)).slice(0, 512);
  }
  async function drain() {
    // Producer rejection (including abort) is terminal, not GPU completion.
    await Promise.resolve(options.producer()).then(() => {}, () => {stats.producerRejected = true;});
    // Re-read after each settlement: late own acquisitions are part of this
    // drain. No unrelated queue work participates in this barrier.
    while (pending.size) await Promise.allSettled([...pending]);
    stats.phase = 'fencing';
    const owner = Object.freeze({}) as WorldOwnerQuiescence; quiescentOwners.add(owner);
    await options.fence(owner);
    stats.phase = 'releasing'; finishFence();
    await options.releaseOwned();
    for (const record of leases) if (!record.released) {record.lease.release(); record.released = true; stats.released++;}
    options.releaseCredit(); stats.phase = 'retired';
  }
  function retire(): Promise<void> {
    if (retirement) return retirement;
    let resolve!: () => void, reject!: (cause: unknown) => void;
    retirement = new Promise<void>((yes, no) => {resolve = yes; reject = no;});
    stats.phase = 'draining';
    // Install the idempotent promise before stop(), which may synchronously
    // re-enter disposal. Never insert a fence concurrently with production.
    try {options.stop();} catch (cause) {hold(cause); reject(cause); return retirement;}
    void drain().then(resolve, cause => {hold(cause); reject(cause);});
    return retirement;
  }
  return {stats, fenced, acquire, trackReady, retire};
}
export type WorldOwnerRetirement = ReturnType<typeof createWorldOwnerRetirement>;

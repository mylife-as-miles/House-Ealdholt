/** Transient shared residency pressure; a valid source may retry later. */
export class VegetationResidencyError extends Error {constructor(){super('Vegetation resource residency is full; retain the existing LOD.');this.name='VegetationResidencyError';}}
/** Renderer-local ownership for source-derived geometry/atlases. This is live
 * residency, separate from the persistent bake store introduced in Phase 4.
 * A source cell releases a lease, never a borrowed GLB or another cell's atlas. */
export interface OwnedVegetationResource { readonly bytes: number; dispose(): void }
export function createVegetationResourcePool<T extends OwnedVegetationResource>(maximumBytes: number, maximumEntries = 32) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || !Number.isSafeInteger(maximumEntries) || maximumEntries < 1) throw Error('Invalid vegetation residency budget.');
  type Entry = {key: string; refs: number; touched: number; estimate: number; value: T | null; signal: AbortController; ready: Promise<T>};
  const entries = new Map<string, Entry>();
  let disposed = false, serial = 0, bytes = 0, reserved = 0;
  const stats = {entries: 0, bytes: 0, reservedBytes: 0, hits: 0, builds: 0, evictions: 0, cancelled: 0, failed: 0};
  function report() {stats.entries = entries.size; stats.bytes = bytes; stats.reservedBytes = reserved;}
  function retire(entry: Entry) {
    if (entries.get(entry.key) !== entry) return;
    entries.delete(entry.key); entry.signal.abort();
    if (entry.value) {bytes -= entry.value.bytes; entry.value.dispose(); entry.value = null;}
    else {reserved -= entry.estimate; stats.cancelled++;}
    report();
  }
  function room(extraBytes: number, extraEntries: number) {
    while (bytes + reserved + extraBytes > maximumBytes || entries.size + extraEntries > maximumEntries) {
      let oldest: Entry | null = null;
      for (const entry of entries.values()) if (!entry.refs && entry.value && (!oldest || entry.touched < oldest.touched)) oldest = entry;
      if (!oldest) return false;
      retire(oldest); stats.evictions++;
    }
    return true;
  }
  return {
    stats,
    acquire(key: string, estimatedBytes: number, build: (signal: AbortSignal) => Promise<T>) {
      if (disposed || !key || key.length > 8192 || !Number.isSafeInteger(estimatedBytes) || estimatedBytes < 1 || estimatedBytes > maximumBytes) throw Error('Invalid vegetation resource request.');
      let entry = entries.get(key);
      if (entry) stats.hits++;
      else {
        if (!room(estimatedBytes, 1)) throw new VegetationResidencyError();
        const signal = new AbortController();
        entry = {key, refs: 0, touched: ++serial, estimate: estimatedBytes, value: null, signal, ready: null as unknown as Promise<T>};
        const created = entry; entries.set(key, created); reserved += estimatedBytes; stats.builds++; report();
        created.ready = Promise.resolve().then(() => {signal.signal.throwIfAborted(); return build(signal.signal);}).then(value => {
          if (disposed || signal.signal.aborted || entries.get(key) !== created) {value.dispose(); throw Error('Vegetation resource preparation retired.');}
          if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > estimatedBytes) {
            value.dispose(); throw Error('Vegetation resource exceeded its reserved budget.');
          }
          reserved -= created.estimate; bytes += value.bytes; created.value = value; report(); return value;
        }).catch(cause => {
          if (entries.get(key) === created) {entries.delete(key); reserved -= created.estimate; stats.failed++; report();}
          throw cause;
        });
      }
      const leased = entry; leased.refs++; leased.touched = ++serial;
      let released = false;
      return {
        ready: leased.ready,
        release() {
          if (released) return; released = true; leased.refs--; leased.touched = ++serial;
          if (!leased.refs && !leased.value) retire(leased);
        },
      };
    },
    /** Unused resources are the only legal eviction candidates. */
    trim() {for (const entry of [...entries.values()]) if (!entry.refs) {retire(entry); stats.evictions++;}},
    dispose() {if (disposed) return; disposed = true; for (const entry of [...entries.values()]) retire(entry);},
  };
}

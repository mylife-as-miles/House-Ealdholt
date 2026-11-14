/** Persistent derived CPU resources, separate from live GPU residency. Adapts
 * BakedVoxelLighting/cache.js's failure-tolerant storage approach (MIT; see
 * BAKED_VOXEL_LIGHTING_SOURCE.md), adding content validation, cancellation and budgets. */
import type {WorldBakeIoDiagnostics,WorldBakeIoTrace} from './world-bake-diagnostics';
export const WORLD_BAKE_SCHEMA = 1;
export interface WorldBakeBlob {readonly metadata: string; readonly data: Uint8Array}
export interface WorldBakeRecord extends WorldBakeBlob {
  readonly schema: 1; readonly key: string; readonly digest: string;
  readonly bytes: number; readonly used: number;
}
export interface WorldBakeStore {
  get(key: string, diagnosticContext?:object): Promise<WorldBakeRecord | undefined>;
  usage?(diagnosticContext?:object): Promise<{bytes: number; entries: number}>;
  put(record: WorldBakeRecord, limits: WorldBakeLimits, diagnosticContext?:object): Promise<{bytes: number; entries: number; evicted: number}>;
  remove(key: string, diagnosticContext?:object): Promise<void>; clear(diagnosticContext?:object): Promise<void>; close(): void;
  readonly diagnostics?:WorldBakeIoDiagnostics;
  diagnosticFor?(context:object):WorldBakeIoTrace|null;
}
/** `kindBytes`/`kindEntries` are each kind's share (kind = the `v1:<kind>:`
 * key prefix). Absent shares mean one shared LRU, as before. */
export interface WorldBakeLimits {readonly bytes: number; readonly entries: number; readonly kindBytes?: number; readonly kindEntries?: number}
export interface WorldBakeEvictionRow {readonly key: IDBValidKey; readonly bytes: number; readonly used: number}
/** The kind of a bake key, or '' for a malformed one. */
export function worldBakeKind(key: IDBValidKey): string {return String(key).split(':', 3)[1] ?? '';}
/** Which stored rows to evict before writing `record` (audit L-18). First the
 * incoming kind gives up its own oldest rows until it fits its share; then, while
 * the whole cache is over budget, kinds over their share lose their oldest rows
 * before anything else, and only then the oldest rows of any kind. So roaming
 * lighting volumes replace older volumes instead of pushing out vegetation
 * atlases. Returns null when the record cannot fit at all. `rows` excludes the
 * record's own key. */
export function planWorldBakeEviction(rows: readonly WorldBakeEvictionRow[], record: {readonly key: string; readonly bytes: number}, limits: WorldBakeLimits): {evict: IDBValidKey[]; bytes: number; entries: number} | null {
  const kindBytesLimit = limits.kindBytes ?? limits.bytes, kindEntriesLimit = limits.kindEntries ?? limits.entries;
  const ordered = [...rows].sort((a, b) => a.used - b.used || String(a.key).localeCompare(String(b.key)));
  const kindBytes = new Map<string, number>(), kindEntries = new Map<string, number>();
  const add = (kind: string, bytes: number, entries: number) => {kindBytes.set(kind, (kindBytes.get(kind) ?? 0) + bytes); kindEntries.set(kind, (kindEntries.get(kind) ?? 0) + entries);};
  for (const row of ordered) add(worldBakeKind(row.key), row.bytes, 1);
  const incoming = worldBakeKind(record.key); add(incoming, record.bytes, 1);
  let bytes = ordered.reduce((sum, row) => sum + row.bytes, record.bytes), entries = ordered.length + 1;
  const evicted = new Set<IDBValidKey>(), evict: IDBValidKey[] = [];
  const remove = (row: WorldBakeEvictionRow) => {const kind = worldBakeKind(row.key); evicted.add(row.key); evict.push(row.key); bytes -= row.bytes; entries--; add(kind, -row.bytes, -1);};
  const overShare = (kind: string) => (kindBytes.get(kind) ?? 0) > kindBytesLimit || (kindEntries.get(kind) ?? 0) > kindEntriesLimit;
  const overall = () => bytes > limits.bytes || entries > limits.entries;
  for (const row of ordered) {if (!overShare(incoming)) break; if (worldBakeKind(row.key) === incoming) remove(row);}
  for (const row of ordered) {if (!overall()) break; if (!evicted.has(row.key) && overShare(worldBakeKind(row.key))) remove(row);}
  for (const row of ordered) {if (!overall()) break; if (!evicted.has(row.key)) remove(row);}
  return overall() ? null : {evict, bytes, entries};
}
export interface WorldBakeFailure {
  readonly operation: 'get' | 'usage' | 'put' | 'remove' | 'digest' | 'clear' | 'close';
  readonly context: 'get' | 'put' | 'clear' | 'close';
  /** The bounded resource-kind prefix only; never a source/world key or digest. */
  readonly kind: string | null;
}
export async function worldBakeDigest(data: Uint8Array): Promise<string> {
  // Own the view: source buffers can subsequently transfer to a GPU worker.
  const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(data));
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function worldBakeKey(kind: string, identity: string): Promise<string> {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(kind) || !identity || identity.length > 16384) throw Error('Invalid world bake identity.');
  return 'v' + WORLD_BAKE_SCHEMA + ':' + kind + ':' + await worldBakeDigest(new TextEncoder().encode(identity));
}
function blobBytes(blob: WorldBakeBlob): number {return blob.data.byteLength + new TextEncoder().encode(blob.metadata).byteLength;}
async function blobDigest(blob: WorldBakeBlob): Promise<string> {
  const header = new TextEncoder().encode(blob.metadata), bytes = new Uint8Array(4 + header.length + blob.data.length);
  new DataView(bytes.buffer).setUint32(0, header.length, true); bytes.set(header, 4); bytes.set(blob.data, 4 + header.length);
  return worldBakeDigest(bytes);
}
export function createWorldBakeCache(options: {store: WorldBakeStore | null; maximumBytes?: number; maximumEntries?: number; now?: () => number}) {
  const maximumBytes = options.maximumBytes ?? 64 * 1024 * 1024, maximumEntries = options.maximumEntries ?? 128;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 512 * 1024 * 1024
    || !Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 2048) throw Error('Invalid persistent bake budget.');
  const stats = {available: !!options.store, hits: 0, misses: 0, writes: 0, invalid: 0, evicted: 0, bytes: 0, entries: 0, warning: '', lastFailure: null as WorldBakeFailure | null,
    lastFailureTiming:null as WorldBakeIoTrace|null,get io(){try{return options.store?.diagnostics??null;}catch{return null;}}};
  let generation = 0, closed = false, storageFailed = false;
  const validKey = (key: string) => /^v1:[a-z][a-z0-9-]{0,47}:[a-f0-9]{64}$/.test(key);
  const current = (epoch: number, signal?: AbortSignal) => !closed && epoch === generation && !signal?.aborted;
  const diagnosticContext=()=>{try{return options.store?.diagnosticFor?{}:undefined;}catch{return undefined;}};
  const warning = (cause: unknown, operation: WorldBakeFailure['operation'], context: WorldBakeFailure['context'], key?: string, timingContext?:object) => {
    storageFailed = true; stats.available = false; stats.warning = cause instanceof Error ? cause.message : String(cause);
    stats.lastFailure = Object.freeze({operation, context, kind: key?.split(':', 3)[1] ?? null});
    try{stats.lastFailureTiming=timingContext?options.store?.diagnosticFor?.(timingContext)??null:null;}catch{stats.lastFailureTiming=null;}
  };
  return {
    stats, get generation() {return generation;},
    async get(key: string, validate: (blob: WorldBakeBlob) => boolean, signal?: AbortSignal): Promise<WorldBakeBlob | null> {
      if (!validKey(key)) throw Error('Invalid persistent bake key.');
      const epoch = generation;
      if (!options.store || storageFailed || !current(epoch, signal)) {stats.misses++; return null;}
      let operation: WorldBakeFailure['operation'] = 'get';
      let timingContext=diagnosticContext();
      try {
        const record = await options.store.get(key,timingContext);
        if (!current(epoch, signal)) return null;
        if (!record) {stats.available = !storageFailed; stats.misses++; return null;}
        operation = 'digest';timingContext=undefined;
        let valid = record.schema === WORLD_BAKE_SCHEMA && record.key === key && typeof record.metadata === 'string'
          && record.metadata.length <= 8192 && record.data instanceof Uint8Array && record.bytes === blobBytes(record)
          && record.bytes <= maximumBytes && record.digest === await blobDigest(record);
        if (!current(epoch, signal)) return null;
        // A resource decoder may throw for an old or malformed layout. Evict
        // that resource without treating healthy IndexedDB as unavailable.
        if (valid) {try {valid = validate(record);} catch {valid = false;}}
        if (!current(epoch, signal)) return null;
        if (!valid) {
          stats.invalid++; operation = 'remove';timingContext=diagnosticContext(); await options.store.remove(key,timingContext);
          if (current(epoch, signal)) stats.misses++;
          return null;
        }
        if (!current(epoch, signal)) return null;
        if (options.store.usage) {operation = 'usage';timingContext=diagnosticContext(); const usage = await options.store.usage(timingContext); if (!current(epoch, signal)) return null; stats.bytes = usage.bytes; stats.entries = usage.entries;}
        if (!current(epoch, signal)) return null;
        // Other already-started reads may still return valid data. They cannot
        // reopen the displayed health after a different operation latched failure.
        stats.available = !storageFailed; stats.hits++; return {metadata: record.metadata, data: record.data};
      } catch (cause) {if (current(epoch, signal)) {warning(cause, operation, 'get', key,timingContext); stats.misses++;} return null;}
    },
    async put(key: string, input: WorldBakeBlob, signal?: AbortSignal, epoch = generation): Promise<boolean> {
      if (!validKey(key)) throw Error('Invalid persistent bake key.');
      if (!options.store || storageFailed || !current(epoch, signal)) return false;
      if (typeof input.metadata !== 'string' || input.metadata.length > 8192 || !(input.data instanceof Uint8Array)) throw Error('Invalid bake payload.');
      const blob = {metadata: input.metadata, data: Uint8Array.from(input.data)}, bytes = blobBytes(blob);
      if (bytes > maximumBytes) {stats.warning = 'Derived resource exceeds the persistent bake budget.'; return false;}
      let operation: WorldBakeFailure['operation'] = 'digest';
      let timingContext:object|undefined;
      try {
        const digest = await blobDigest(blob); if (!current(epoch, signal)) return false;
        operation = 'put';timingContext=diagnosticContext();
        const result = await options.store.put({schema: WORLD_BAKE_SCHEMA, key, digest, ...blob, bytes, used: (options.now ?? Date.now)()}, {bytes: maximumBytes, entries: maximumEntries, kindBytes: Math.floor(maximumBytes / 2), kindEntries: Math.floor(maximumEntries / 2)},timingContext);
        if (current(epoch, signal)) {stats.available = !storageFailed; stats.writes++; stats.bytes = result.bytes; stats.entries = result.entries; stats.evicted += result.evicted;}
        return current(epoch, signal);
      } catch (cause) {if (current(epoch, signal)) warning(cause, operation, 'put', key,timingContext); return false;}
    },
    async clear(): Promise<boolean> {
      const epoch = ++generation; if (!options.store || closed) return false;
      const timingContext=diagnosticContext();
      try {await options.store.clear(timingContext); if (!current(epoch)) return false; storageFailed = false; stats.available = true; stats.warning = ''; stats.lastFailure = null;stats.lastFailureTiming=null; stats.bytes = 0; stats.entries = 0; return true;}
      catch (cause) {if (current(epoch)) warning(cause, 'clear', 'clear',undefined,timingContext); return false;}
    },
    close() {if (closed) return; closed = true; generation++; stats.available = false; try {options.store?.close();} catch (cause) {warning(cause, 'close', 'close');}},
  };
}
export type WorldBakeCache = ReturnType<typeof createWorldBakeCache>;

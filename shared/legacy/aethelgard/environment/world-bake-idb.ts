import {planWorldBakeEviction, type WorldBakeRecord, type WorldBakeStore} from './world-bake-cache';
import {createWorldBakeIoDiagnostics,type WorldBakeIoOperation,type WorldBakeIoOutcome,type WorldBakeIoRealm,type WorldBakeIoRequest} from './world-bake-diagnostics';
const DATABASE = 'CrownfallWorldBakes', VERSION = 1, META = 'metadata', DATA = 'payloads';
const TRANSACTION_TIMEOUT_MS=3000,LATE_DISPATCH_GRACE_MS=1000;
const realms=new WeakMap<IDBFactory,WorldBakeIoRealm>();
/** Metadata-only LRU scans: never read every stored atlas into RAM to evict a
 * voxel tile. Writes/evictions share one transaction, including across tabs. */
export function createIndexedWorldBakeStore(factory?: IDBFactory,diagnosticClock?:()=>number): WorldBakeStore | null {
  try {factory ??= globalThis.indexedDB;} catch {return null;}
  if (!factory) return null;
  let realm=realms.get(factory);if(!realm){realm={owners:0,connections:0,transactions:0};realms.set(factory,realm);}realm.owners++;
  const shared=realm,io=createWorldBakeIoDiagnostics(shared,diagnosticClock);
  let closed = false, db: IDBDatabase | null = null, opening: Promise<IDBDatabase> | null = null;
  let cancelOpening: ((cause: unknown) => void) | null = null;
  const pending = new Set<(cause: unknown) => void>();
  function open(): Promise<IDBDatabase> {
    if (closed) return Promise.reject(Error('Environment cache is closed.'));
    if (db) return Promise.resolve(db);
    if (opening) return opening;
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory!.open(DATABASE, VERSION); let settled = false;
      const cleanup = () => {clearTimeout(timer); if (cancelOpening === fail) cancelOpening = null;};
      const fail = (cause: unknown) => {if (!settled) {settled = true; cleanup(); reject(cause);}};
      const timer = setTimeout(() => fail(Error('Environment cache open timed out; using nonpersistent preparation.')), 3000);
      cancelOpening = fail;
      request.onupgradeneeded = () => {for (const name of [META, DATA]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);};
      request.onerror = () => fail(request.error ?? Error('Environment cache open failed.'));
      request.onblocked = () => fail(Error('Environment cache version is blocked by another tab.'));
      request.onsuccess = () => {
        if (settled || closed) {request.result.close(); if (!settled) fail(Error('Environment cache retired during open.')); return;}
        settled = true; cleanup(); db = request.result;shared.connections++;
        db.onversionchange = () => {if(db){shared.connections--;db.close();} db = null; opening = null;}; resolve(db);
      };
    }).catch(cause => {opening = null; throw cause;});
    return opening;
  }
  type Observe=<R>(request:IDBRequest<R>,kind:WorldBakeIoRequest,success?:()=>void)=>IDBRequest<R>;
  async function transaction<T>(operation:WorldBakeIoOperation,mode: IDBTransactionMode,context:object|undefined,work: (tx: IDBTransaction, set: (value: T) => void,observe:Observe) => void): Promise<T> {
    const trace=io.begin(operation,mode,context);let connection:IDBDatabase;
    try{connection=await open();trace.opened();}catch(cause){trace.finish('open-error');throw cause;}
    return new Promise<T>((resolve, reject) => {
      if (closed) {trace.finish('cancelled');reject(Error('Environment cache retired.')); return;}
      let tx:IDBTransaction;try{tx=connection.transaction([META, DATA], mode);}catch(cause){trace.finish('setup-error');reject(cause);return;}
      shared.transactions++;trace.transaction();const transactionStarted=performance.now();let value: T, settled = false, timeout: Error | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (failed: boolean, cause?: unknown,outcome:Exclude<WorldBakeIoOutcome,'pending'>=failed?'cancelled':'complete') => {
        if (settled) return; settled = true; clearTimeout(timer); pending.delete(cancel);
        shared.transactions--;trace.finish(outcome);
        if (failed) reject(cause); else resolve(value);
      };
      const cancel = (cause: unknown) => {if (settled) return; finish(true, cause); try {tx.abort();} catch {}};
      const detach = () => {tx.oncomplete = tx.onerror = tx.onabort = null;};
      const expire = () => {
        if (settled) return;
        timeout = Error('Environment cache transaction timed out.');
        try {tx.abort();trace.abort('accepted'); finish(true, timeout,'watchdog-abort');}
        catch (cause) {
          // A commit/abort may already be finished while its terminal event is
          // queued behind a long render task. Wall time cannot overrule it.
          timeout = null;
          if (!cause || typeof cause !== 'object' || !('name' in cause) || cause.name !== 'InvalidStateError'){trace.abort('unexpected-error');finish(true, cause,'watchdog-error');}
          else trace.abort('invalid-state');
        }
      };
      const eventTurn = (turn:1|2) => {
        if(settled)return;trace.grace(turn);
        if(turn===1)timer=setTimeout(()=>eventTurn(2),0);else expire();
      };
      timer = setTimeout(() => {
        if(settled)return;
        // A long main task can hold both this timer and native request events.
        // Yield at most two task opportunities only when the actual monotonic
        // timer is >=1s overdue. No retry or seconds-long timeout is added:
        // ordinary timeouts still abort at3s, genuinely pending late work is
        // aborted after the second turn, and retirement cancels either timer.
        // The optional diagnostic clock must never decide storage policy.
        const late=performance.now()-transactionStarted-TRANSACTION_TIMEOUT_MS>=LATE_DISPATCH_GRACE_MS;
        trace.watchdog(late?0:undefined);
        if(late)timer=setTimeout(()=>eventTurn(1),0);else expire();
      }, TRANSACTION_TIMEOUT_MS);
      pending.add(cancel);
      tx.oncomplete = () => {finish(false); detach();};
      tx.onerror = () => {finish(true, timeout ?? tx.error ?? Error('Environment cache transaction failed.'),'error-event');detach();};
      tx.onabort = () => {finish(true, timeout ?? tx.error ?? Error('Environment cache transaction failed.'),'abort-event');detach();};
      // At most11 callback pairs per transaction, even if an LRU eviction
      // deletes many rows. Over-cap traces keep only the original work hooks.
      const callbacks=new Map<WorldBakeIoRequest,{success:()=>void;error:()=>void}>();
      const observe:Observe=(request,kind,success)=>{
        if(!trace.detailed){if(success)request.onsuccess=success;return request;}
        trace.request(kind);let pair=callbacks.get(kind);if(!pair){pair={success:()=>{trace.success(kind);},error:()=>{trace.error(kind);}};callbacks.set(kind,pair);}
        request.onsuccess=success?()=>{trace.success(kind);success();}:pair.success;request.onerror=pair.error;return request;
      };
      try {work(tx, result => {if (!settled){value = result;trace.value();}},observe);trace.dispatched();} catch (cause) {trace.finish('setup-error');cancel(cause);}
    });
  }
  return {
    diagnostics:io.diagnostics,diagnosticFor:io.forContext,
    async usage(context) {
      return transaction<{bytes: number; entries: number}>('usage','readonly',context, (tx, set,observe) => {
        const request = tx.objectStore(META).getAll(); observe(request,'metadata-scan',() => {
          const rows = request.result.filter(row => Number.isSafeInteger(row?.bytes) && row.bytes >= 0);
          set({bytes: rows.reduce((n, row) => n + row.bytes, 0), entries: rows.length});
        });
      });
    },
    async get(key,context) {
      // Touch only the small metadata record; its payload is cloned exactly once.
      return transaction<WorldBakeRecord | undefined>('get','readwrite',context, (tx, set,observe) => {
        const meta = tx.objectStore(META), data = tx.objectStore(DATA), m = meta.get(key), d = data.get(key);
        let done = 0;
        const finish = () => {if (++done < 2) return;
          if (!m.result || !d.result) {if (m.result || d.result) {observe(meta.delete(key),'metadata-delete');observe(data.delete(key),'payload-delete');} set(undefined); return;}
          const record = {...m.result, ...d.result}; set(record);
          observe(meta.put({...m.result, used: Date.now()}, key),'lru-touch');
        };
        observe(m,'metadata-read',finish);observe(d,'payload-read',finish);
      });
    },
    async put(record, limits,context) {
      return transaction<{bytes: number; entries: number; evicted: number}>('put','readwrite',context, (tx, set,observe) => {
        const meta = tx.objectStore(META), data = tx.objectStore(DATA), rows: {key: IDBValidKey; bytes: number; used: number}[] = [];
        // Fetch metadata in two bounded requests. A cursor event per entry
        // can spend seconds behind rendering tasks and trip the watchdog even
        // though IndexedDB itself is healthy. Payloads remain untouched.
        const keys=meta.getAllKeys(),values=meta.getAll();let ready=0;
        const collect=()=>{if(++ready<2)return;
          for(let i=0;i<keys.result.length;i++){const key=keys.result[i],value=values.result[i];
            if(!Number.isSafeInteger(value?.bytes)||value.bytes<0||!Number.isFinite(value?.used)){observe(meta.delete(key),'metadata-delete');observe(data.delete(key),'payload-delete');}
            else if(key!==record.key)rows.push({key,bytes:value.bytes,used:value.used});
          }
          // Per-kind shares first, then the shared LRU (L-18).
          const plan = planWorldBakeEviction(rows, record, limits);
          if (!plan) {tx.abort(); return;}
          for (const key of plan.evict) {observe(meta.delete(key),'metadata-delete');observe(data.delete(key),'payload-delete');}
          const bytes = plan.bytes, entries = plan.entries, evicted = plan.evict.length;
          const {data: payload, metadata, ...header} = record;
          observe(meta.put(header, record.key),'metadata-write');observe(data.put({data: payload, metadata}, record.key),'payload-write'); set({bytes, entries, evicted});
        };
        observe(keys,'key-scan',collect);observe(values,'metadata-scan',collect);
      });
    },
    async remove(key,context) {await transaction<void>('remove','readwrite',context, (tx,_set,observe) => {observe(tx.objectStore(META).delete(key),'metadata-delete');observe(tx.objectStore(DATA).delete(key),'payload-delete');});},
    async clear(context) {await transaction<void>('clear','readwrite',context, (tx,_set,observe) => {observe(tx.objectStore(META).clear(),'metadata-clear');observe(tx.objectStore(DATA).clear(),'payload-clear');});},
    close() {
      if (closed) return; closed = true;shared.owners--;
      const cause = Error('Environment cache retired.'); cancelOpening?.(cause);
      for (const cancel of pending) cancel(cause);
      const connection = db; db = null; opening = null;if(connection)shared.connections--; connection?.close();
    },
  };
}

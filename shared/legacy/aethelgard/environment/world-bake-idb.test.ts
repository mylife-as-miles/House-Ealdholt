import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {createIndexedWorldBakeStore} from './world-bake-idb';
import {createWorldBakeCache, worldBakeKey, type WorldBakeRecord, type WorldBakeStore} from './world-bake-cache';

// Exercise the real store wrapper with independently controlled native terminal
// state and event delivery. These fakes never access a browser, profile or IDB.
type Handler = (() => void) | null;
class Request<T> {
  onsuccess: Handler = null;onerror:Handler=null;
  constructor(readonly result: T) {}
  succeed() {this.onsuccess?.();}
}
class Transaction {
  oncomplete: Handler = null; onabort: Handler = null; onerror: Handler = null;
  error: DOMException | null = null;
  state: 'active' | 'finished' | 'aborted' = 'active';
  abortCalls = 0; abortFailure: unknown; workFailure: unknown;
  readonly requests: Request<unknown>[] = [];
  readonly touches: {store: string; key: IDBValidKey; value: unknown}[] = [];
  constructor(readonly stores: string[], readonly mode: IDBTransactionMode, readonly record?: WorldBakeRecord) {}
  objectStore(name: string) {
    assert.ok(this.stores.includes(name));
    const request = <T>(value: T) => {if (this.workFailure) throw this.workFailure;
      const result = new Request(value); this.requests.push(result); return result;};
    return {
      getAll: () => request(this.record ? [{...this.record, data:undefined, metadata:undefined}] : [{bytes: 8,used:0}, {bytes: 4,used:1}]),
      getAllKeys:()=>request(this.record?[this.record.key]:['first-private-key','second-private-key']),
      get: (key: IDBValidKey) => request(this.record?.key === key ? name === 'metadata'
        ? {...this.record, data: undefined, metadata: undefined}
        : {data: this.record.data, metadata: this.record.metadata} : undefined),
      put: (value: unknown, key: IDBValidKey) => {this.touches.push({store: name, key, value});return request(undefined);},
      delete:(key:IDBValidKey)=>{this.touches.push({store:name,key,value:'delete'});return request(undefined);},
      clear:()=>{this.touches.push({store:name,key:'all',value:'clear'});return request(undefined);},
    };
  }
  abort() {
    this.abortCalls++;
    if (this.abortFailure) throw this.abortFailure;
    if (this.state !== 'active') throw new DOMException('Transaction is already finished.', 'InvalidStateError');
    this.state = 'aborted'; this.error = new DOMException('Transaction aborted.', 'AbortError');
    // Native abort delivery is asynchronous, independent from abort() returning.
    queueMicrotask(() => this.onabort?.());
  }
  finishBackend() {this.state = 'finished';}
  complete() {this.finishBackend(); this.oncomplete?.();}
  succeedRequests() {for (const request of this.requests) request.succeed();}
}
type Outcome<T> = {status: 'pending'} | {status: 'fulfilled'; value: T} | {status: 'rejected'; cause: unknown};
function observe<T>(promise: Promise<T>) {
  let outcome: Outcome<T> = {status: 'pending'};
  const done = promise.then(value => {outcome = {status: 'fulfilled', value};}, cause => {outcome = {status: 'rejected', cause};});
  return {done, get outcome() {return outcome;}};
}
async function flush() {for (let i = 0; i < 12; i++) await Promise.resolve();}
// Deliver timer tasks separately from native request/terminal events. Advancing
// wall time alone must not collapse all zero-delay turns into one fake tick.
function taskTimers(t:TestContext){
 let time=0,identity=0;const timers=new Map<number,{callback:()=>void;delay:number}>(),scheduled:number[]=[];
 t.mock.method(performance,'now',()=>time);
 t.mock.method(globalThis,'setTimeout',((callback:()=>void,delay=0)=>{const id=++identity;timers.set(id,{callback,delay});scheduled.push(delay);return id as unknown as ReturnType<typeof setTimeout>;})as typeof setTimeout);
 t.mock.method(globalThis,'clearTimeout',((id:ReturnType<typeof setTimeout>)=>{timers.delete(id as unknown as number);})as typeof clearTimeout);
 return{get now(){return time;},get pending(){return timers.size;},scheduled,
  advanceTo(value:number){assert.ok(value>=time);time=value;},
  runNext(delay:number){const entry=timers.entries().next().value as[number,{callback:()=>void;delay:number}]|undefined;assert.ok(entry,'Expected a pending timer task.');assert.equal(entry[1].delay,delay);timers.delete(entry[0]);entry[1].callback();}};
}
function fixture(t: TestContext, options: {holdOpen?: boolean; record?: WorldBakeRecord; workFailure?: unknown; abortFailure?: unknown;
  diagnosticClock?:()=>number;onTransaction?(transaction: Transaction, index: number): void} = {}) {
  t.mock.timers.enable({apis: ['setTimeout']});
  const transactions: Transaction[] = [], opens: {name: string; version: number | undefined}[] = [];
  let closeCalls = 0;
  const database = {
    close() {closeCalls++;}, onversionchange: null,
    transaction(stores: string[], mode: IDBTransactionMode) {
      const tx = new Transaction(stores, mode, options.record);
      tx.workFailure = options.workFailure; tx.abortFailure = options.abortFailure;
      transactions.push(tx); options.onTransaction?.(tx, transactions.length - 1); return tx;
    },
  };
  const opened = new Request(database);
  let firstOpen=true;const factory = {open(name: string, version?: number) {
    const request=firstOpen?opened:new Request(database);firstOpen=false;opens.push({name, version}); if (!options.holdOpen) queueMicrotask(() => request.succeed()); return request;
  }};
  const store = createIndexedWorldBakeStore(factory as unknown as IDBFactory,options.diagnosticClock)!;
  t.after(() => store.close());
  return {store, opened, transactions, opens,factory:factory as unknown as IDBFactory, get closeCalls() {return closeCalls;},
    async tick(ms: number) {t.mock.timers.tick(ms); await flush();}};
}

test('a committed transaction waits for its delayed completion event after the watchdog cannot abort it', async t => {
  const f = fixture(t), result = observe(f.store.usage!()); await flush();
  assert.deepEqual(f.opens, [{name: 'CrownfallWorldBakes', version: 1}]);
  const tx = f.transactions[0]; assert.equal(tx.mode, 'readonly'); assert.deepEqual(tx.stores, ['metadata', 'payloads']);
  tx.succeedRequests(); tx.finishBackend(); await f.tick(3001);
  assert.equal(result.outcome.status, 'pending', 'Elapsed wall time must not invent failure after native completion.');
  assert.equal(tx.abortCalls, 1); tx.complete(); await result.done;
  assert.deepEqual(result.outcome, {status: 'fulfilled', value: {bytes: 12, entries: 2}});
  await f.tick(6000); assert.equal(tx.abortCalls, 1);
  assert.equal(tx.oncomplete, null); assert.equal(tx.onabort, null); assert.equal(tx.onerror, null);
});

test('delayed native abort and error retain the actual terminal cause after InvalidStateError', async t => {
  const f = fixture(t);
  for (const terminal of ['onabort', 'onerror'] as const) {
    const result = observe(f.store.usage!()); await flush(); const tx = f.transactions[f.transactions.length - 1];
    const error = new DOMException('Native backing-store failure.', 'UnknownError');
    tx.error = error; tx.finishBackend(); await f.tick(3001);
    assert.equal(result.outcome.status, 'pending'); tx[terminal]?.(); await result.done;
    assert.deepEqual(result.outcome, {status: 'rejected', cause: error});
    assert.equal(tx.oncomplete, null); assert.equal(tx.onabort, null); assert.equal(tx.onerror, null);
  }
});

test('an unfinished transaction still aborts and rejects at the bounded three-second deadline', async t => {
  const f = fixture(t), result = observe(f.store.usage!()); await flush(); const tx = f.transactions[0];
  await f.tick(2999); assert.equal(result.outcome.status, 'pending'); assert.equal(tx.abortCalls, 0);
  await f.tick(1); await result.done;
  assert.equal(result.outcome.status, 'rejected');
  assert.match((result.outcome as {cause: Error}).cause.message, /transaction timed out/);
  assert.equal(tx.abortCalls, 1); assert.equal(tx.state, 'aborted');
  tx.complete(); await f.tick(6000); f.store.close(); f.store.close(); assert.equal(tx.abortCalls, 1);
  assert.equal(f.closeCalls, 1);
});

test('normal completion clears the watchdog and native callbacks exactly once', async t => {
  const f = fixture(t), result = observe(f.store.usage!()); await flush(); const tx = f.transactions[0];
  tx.succeedRequests(); const complete = tx.oncomplete!; tx.complete(); await result.done;
  complete(); await f.tick(6000);
  assert.deepEqual(result.outcome, {status: 'fulfilled', value: {bytes: 12, entries: 2}});
  assert.equal(tx.abortCalls, 0); assert.equal(tx.oncomplete, null); assert.equal(tx.onabort, null); assert.equal(tx.onerror, null);
});

test('closing an active owner immediately retires pending transactions and cancels their timers', async t => {
  const f = fixture(t), result = observe(f.store.usage!()); await flush(); const tx = f.transactions[0];
  f.store.close(); f.store.close(); await flush();
  assert.equal(result.outcome.status, 'rejected', 'Retirement must settle waiters before a watchdog tick.');
  assert.match((result.outcome as {cause: Error}).cause.message, /retired/);
  assert.equal(tx.abortCalls, 1); assert.equal(f.closeCalls, 1);
  tx.complete(); await f.tick(6000); assert.equal(tx.abortCalls, 1);
  assert.match((result.outcome as {cause: Error}).cause.message, /retired/);
  await assert.rejects(f.store.usage!(), /closed/); assert.equal(f.opens.length, 1);
});

test('closing also settles terminal-event waiters that can no longer be aborted', async t => {
  const f = fixture(t), result = observe(f.store.usage!()); await flush(); const tx = f.transactions[0];
  tx.succeedRequests(); tx.finishBackend(); await f.tick(3001); assert.equal(result.outcome.status, 'pending');
  f.store.close(); f.store.close(); await flush();
  assert.equal(result.outcome.status, 'rejected'); assert.match((result.outcome as {cause: Error}).cause.message, /retired/);
  assert.equal(tx.abortCalls, 2); assert.equal(f.closeCalls, 1);
  tx.complete(); await f.tick(6000); assert.equal(tx.abortCalls, 2);
  assert.match((result.outcome as {cause: Error}).cause.message, /retired/);
});

test('close during a shared pending open retires all waiters and closes a late database without starting work', async t => {
  const f = fixture(t, {holdOpen: true}), first = observe(f.store.usage!()), second = observe(f.store.usage!());
  await flush(); assert.equal(f.opens.length, 1); f.store.close(); f.store.close(); await flush();
  assert.equal(first.outcome.status, 'rejected'); assert.equal(second.outcome.status, 'rejected');
  assert.match((first.outcome as {cause: Error}).cause.message, /retired/);
  assert.equal(f.closeCalls, 0); f.opened.succeed(); await flush();
  assert.equal(f.closeCalls, 1); assert.equal(f.transactions.length, 0);
  await f.tick(6000); await assert.rejects(f.store.usage!(), /closed/); assert.equal(f.opens.length, 1);
});

test('an unfinished open retains its bounded fallback and disposes any late success', async t => {
  const f = fixture(t, {holdOpen: true}), result = observe(f.store.usage!()); await flush();
  await f.tick(3000); await result.done; assert.equal(result.outcome.status, 'rejected');
  assert.match((result.outcome as {cause: Error}).cause.message, /open timed out/);
  f.opened.succeed(); await flush(); assert.equal(f.closeCalls, 1); assert.equal(f.transactions.length, 0);
  f.store.close(); assert.equal(f.closeCalls, 1);
});

test('a synchronous work failure is not masked by abort throwing InvalidStateError', async t => {
  const error = Error('Request setup failed.'), abortFailure = new DOMException('Already finished.', 'InvalidStateError');
  const f = fixture(t, {workFailure: error, abortFailure}), result = observe(f.store.usage!()); await flush();
  assert.deepEqual(result.outcome, {status: 'rejected', cause: error});
  await f.tick(6000); assert.equal(f.transactions[0].abortCalls, 1);
});

test('unexpected abort exceptions fail closed without waiting indefinitely for a native event', async t => {
  const error = new DOMException('Abort rejected unexpectedly.', 'UnknownError');
  const f = fixture(t, {abortFailure: error}), result = observe(f.store.usage!()); await flush();
  await f.tick(3000); await result.done; assert.deepEqual(result.outcome, {status: 'rejected', cause: error});
  await f.tick(6000); assert.equal(f.transactions[0].abortCalls, 1);
});

test('native transaction errors before the deadline clear timers and retain the original failure', async t => {
  const f = fixture(t), result = observe(f.store.usage!()); await flush(); const tx = f.transactions[0];
  const error = new DOMException('Native request failed.', 'ConstraintError'); tx.error = error; tx.onerror?.();
  await result.done; await f.tick(6000); assert.deepEqual(result.outcome, {status: 'rejected', cause: error});
  assert.equal(tx.abortCalls, 0); assert.equal(tx.onabort, null);
});

test('a valid cache hit survives delayed native usage completion instead of disabling its cache owner', {timeout: 15000}, async t => {
  const key = await worldBakeKey('voxel-static', 'terminal-race-test-only'), blob = {metadata: '{}', data: new Uint8Array([1, 2, 3])};
  let record: WorldBakeRecord | undefined;
  const seed: WorldBakeStore = {async get() {return undefined;}, async put(value) {record = value; return {bytes: value.bytes, entries: 1, evicted: 0};},
    async remove() {}, async clear() {}, close() {}};
  const writer = createWorldBakeCache({store: seed}); assert.equal(await writer.put(key, blob), true); writer.close();
  let usageCreated!: (transaction: Transaction) => void;
  const usageReady = new Promise<Transaction>(resolve => {usageCreated = resolve;});
  const f = fixture(t, {record, onTransaction(transaction, index) {if (index === 1) usageCreated(transaction);}});
  const cache = createWorldBakeCache({store: f.store}); t.after(() => cache.close());
  const result = observe(cache.get(key, () => true)); await flush(); const get = f.transactions[0];
  assert.equal(get.mode, 'readwrite'); get.succeedRequests(); get.complete();
  // WebCrypto runs outside the mocked clock. Observe its actual successor
  // transaction instead of assuming it finishes within a fixed turn count.
  const usage = await Promise.race([usageReady, result.done.then(() => {
    throw Error('Cache lookup settled before its expected usage transaction.');
  })]);
  assert.equal(f.transactions.length, 2); assert.equal(usage, f.transactions[1]);
  usage.succeedRequests(); usage.finishBackend(); await f.tick(3001);
  assert.equal(result.outcome.status, 'pending'); assert.equal(cache.stats.available, true); assert.equal(cache.stats.warning, '');
  usage.complete(); await result.done; assert.deepEqual(result.outcome, {status: 'fulfilled', value: blob});
  assert.equal(cache.stats.hits, 1); assert.equal(cache.stats.misses, 0); assert.equal(cache.stats.available, true);
  assert.equal(cache.stats.bytes, record!.bytes); assert.equal(cache.stats.entries, 1); assert.equal(cache.stats.warning, '');
});

const diagnosticRecord:WorldBakeRecord={schema:1,key:'v1:vegetation-atlas:'+'b'.repeat(64),digest:'private-digest-not-a-diagnostic',bytes:5,used:123,metadata:'private-metadata',data:Uint8Array.from([61,62,63])};

test('get diagnostics separate metadata/payload callbacks, LRU acknowledgement and a valid late terminal event',async t=>{
 let time=0;const context={},f=fixture(t,{record:diagnosticRecord,diagnosticClock:()=>time}),result=observe(f.store.get(diagnosticRecord.key,context));await flush();const tx=f.transactions[0];
 assert.equal(tx.mode,'readwrite');time=500;tx.requests[0].succeed();let trace=f.store.diagnosticFor!(context)!;assert.equal(trace.requestSuccesses,1);assert.equal(trace.firstRequestMilliseconds,500);assert.equal(trace.lastRequest,'metadata-read');
 time=900;tx.requests[1].succeed();trace=f.store.diagnosticFor!(context)!;assert.equal(trace.requests,3);assert.equal(trace.requestSuccesses,2);assert.equal(trace.valueReadyMilliseconds,900);assert.equal(trace.lastRequest,'lru-touch');assert.equal(trace.phase,'value-ready');
 time=1100;tx.requests[2].succeed();assert.equal(f.store.diagnosticFor!(context)!.phase,'awaiting-terminal');tx.finishBackend();time=4800;await f.tick(3001);
 trace=f.store.diagnosticFor!(context)!;assert.equal(result.outcome.status,'pending');assert.equal(trace.phase,'terminal-event-pending');assert.deepEqual(trace.watchdog,{elapsedMilliseconds:4800,latenessMilliseconds:1800,phase:'awaiting-terminal',abort:'invalid-state'});
 time=4900;tx.complete();await result.done;trace=f.store.diagnosticFor!(context)!;assert.equal(result.outcome.status,'fulfilled');assert.equal(trace.outcome,'complete');assert.equal(trace.elapsedMilliseconds,4900);assert.equal(trace.requestSuccesses,3);assert.equal(f.store.diagnostics!.active,0);
 const serialized=JSON.stringify(f.store.diagnostics);for(const secret of[diagnosticRecord.key,'b'.repeat(64),diagnosticRecord.digest,diagnosticRecord.metadata,'CrownfallWorldBakes'])assert.ok(!serialized.includes(secret));
});

test('a watchdog before any request callback reports its actual scheduling lateness without claiming a lock cause',async t=>{
 let time=0;const context={},f=fixture(t,{record:diagnosticRecord,diagnosticClock:()=>time}),result=observe(f.store.get(diagnosticRecord.key,context));await flush();time=4500;await f.tick(3000);await result.done;
 const trace=f.store.diagnosticFor!(context)!;assert.equal(trace.operation,'get');assert.equal(trace.requests,2);assert.equal(trace.requestSuccesses,0);assert.equal(trace.firstRequestMilliseconds,null);assert.equal(trace.valueReadyMilliseconds,null);assert.equal(trace.outcome,'watchdog-abort');assert.deepEqual(trace.watchdog,{elapsedMilliseconds:4500,latenessMilliseconds:1500,phase:'requests-pending',abort:'accepted'});assert.equal(f.transactions[0].abortCalls,1);
});

test('watchdog diagnostics distinguish pending LRU from all-request acknowledgements awaiting commit',async t=>{
 let time=0;const f=fixture(t,{record:diagnosticRecord,diagnosticClock:()=>time});
 for(const acknowledgeTouch of[false,true]){const context={},result=observe(f.store.get(diagnosticRecord.key,context));await flush();const tx=f.transactions.at(-1)!;
  tx.requests[0].succeed();tx.requests[1].succeed();if(acknowledgeTouch)tx.requests[2].succeed();time+=3000;await f.tick(3000);await result.done;
  const trace=f.store.diagnosticFor!(context)!;assert.equal(trace.requests,3);assert.equal(trace.requestSuccesses,acknowledgeTouch?3:2);assert.equal(trace.lastRequest,'lru-touch');assert.equal(trace.watchdog?.phase,acknowledgeTouch?'awaiting-terminal':'value-ready');assert.equal(trace.watchdog?.abort,'accepted');}
});

test('open waiting is measured independently from the unchanged transaction watchdog',async t=>{
 let time=0;const context={},f=fixture(t,{holdOpen:true,diagnosticClock:()=>time}),result=observe(f.store.usage!(context));await flush();assert.equal(f.store.diagnosticFor!(context)!.phase,'opening');time=2500;f.opened.succeed();await flush();time=5520;await f.tick(3000);await result.done;
 const trace=f.store.diagnosticFor!(context)!;assert.equal(trace.openMilliseconds,2500);assert.equal(trace.transactionMilliseconds,2500);assert.equal(trace.dispatchMilliseconds,2500);assert.equal(trace.watchdog?.elapsedMilliseconds,3020);assert.equal(trace.watchdog?.latenessMilliseconds,20);assert.equal(trace.elapsedMilliseconds,5520);
});

test('same-realm counters report concurrent owners and created transactions without asserting lock ownership',async t=>{
 const f=fixture(t),other=createIndexedWorldBakeStore(f.factory)!;t.after(()=>other.close());const first=observe(f.store.usage!()),second=observe(other.usage!());await flush();
 assert.deepEqual(f.store.diagnostics!.sameRealm,{owners:2,connections:2,transactions:2});assert.equal(other.diagnostics!.activeOperations[0].sameRealmTransactionsAtCreation,2);
 f.store.close();await first.done;assert.deepEqual(other.diagnostics!.sameRealm,{owners:1,connections:1,transactions:1});f.transactions[1].succeedRequests();f.transactions[1].complete();await second.done;other.close();assert.deepEqual(other.diagnostics!.sameRealm,{owners:0,connections:0,transactions:0});
});

test('request errors and writes expose only whitelisted phases and do not add storage requests or change records',async t=>{
 const f=fixture(t),context={},result=observe(f.store.put(diagnosticRecord,{bytes:100,entries:8},context));await flush();const tx=f.transactions[0];tx.succeedRequests();tx.complete();await result.done;
 assert.deepEqual(result.outcome,{status:'fulfilled',value:{bytes:17,entries:3,evicted:0}});assert.equal(tx.requests.length,4);assert.equal(tx.touches.length,2);assert.equal(tx.touches[0].store,'metadata');assert.equal(tx.touches[1].store,'payloads');assert.deepEqual(tx.touches[1].value,{data:diagnosticRecord.data,metadata:diagnosticRecord.metadata});assert.ok(!('diagnosticContext'in(tx.touches[0].value as object)));
 assert.equal(f.store.diagnosticFor!(context)!.requestSuccesses,4);assert.equal(f.store.diagnosticFor!(context)!.outcome,'complete');
 const failedContext={},read=observe(f.store.get(diagnosticRecord.key,failedContext));await flush();const failed=f.transactions[1],error=new DOMException('Native backing error.','UnknownError');failed.requests[1].onerror?.();failed.error=error;failed.onerror?.();await read.done;
 assert.deepEqual(read.outcome,{status:'rejected',cause:error});assert.equal(f.store.diagnosticFor!(failedContext)!.requestErrors,1);assert.equal(f.store.diagnosticFor!(failedContext)!.lastRequest,'payload-read');assert.equal(f.store.diagnosticFor!(failedContext)!.outcome,'error-event');
});

test('exact failed-operation timing remains latched while a different already-started valid hit succeeds',async t=>{
 const key=await worldBakeKey('vegetation-atlas','timing-token-test-only'),blob={metadata:'{}',data:Uint8Array.from([1,2,3])};let record!:WorldBakeRecord;
 const seed:WorldBakeStore={async get(){return undefined;},async put(value){record=value;return{bytes:value.bytes,entries:1,evicted:0};},async remove(){},async clear(){},close(){}};assert.equal(await createWorldBakeCache({store:seed}).put(key,blob),true);
 let time=0,usageCreated!:(tx:Transaction)=>void;const usageReady=new Promise<Transaction>(resolve=>{usageCreated=resolve;}),f=fixture(t,{record,diagnosticClock:()=>time,onTransaction(tx,index){if(index===2)usageCreated(tx);}}),cache=createWorldBakeCache({store:f.store});t.after(()=>cache.close());
 const failed=cache.get(key,()=>true),late=cache.get(key,()=>true);await flush();f.transactions[1].succeedRequests();f.transactions[1].finishBackend();time=3000;await f.tick(3000);assert.equal(await failed,null);
 const pinned=cache.stats.lastFailureTiming!;assert.equal(pinned.operation,'get');assert.equal(pinned.requestSuccesses,0);assert.equal(pinned.watchdog?.abort,'accepted');assert.equal(cache.stats.available,false);assert.ok(Object.isFrozen(pinned));
 f.transactions[1].complete();const usage=await usageReady;usage.succeedRequests();usage.complete();assert.deepEqual(await late,blob);assert.equal(cache.stats.available,false);assert.equal(cache.stats.hits,1);assert.equal(cache.stats.lastFailureTiming,pinned);assert.equal(cache.stats.io!.recent.at(-1)!.operation,'usage');assert.equal(cache.stats.io!.recent.at(-1)!.outcome,'complete');
 assert.ok(!JSON.stringify(cache.stats).includes(key));assert.ok(!JSON.stringify(cache.stats).includes(key.split(':')[2]));
});

for(const mode of['setup-error','abort-error','pending-open']as const)test(`diagnostic owner/transaction counts retire exactly once after ${mode}`,async t=>{
 const f=fixture(t,{workFailure:mode==='setup-error'?Error('Request setup failed.'):undefined,abortFailure:mode==='abort-error'?new DOMException('Native abort failed.','UnknownError'):undefined,holdOpen:mode==='pending-open'}),result=observe(f.store.usage!());await flush();
 if(mode==='abort-error')await f.tick(3000);if(mode==='pending-open')f.store.close();await result.done;assert.equal(result.outcome.status,'rejected');assert.equal(f.store.diagnostics!.active,0);assert.equal(f.store.diagnostics!.sameRealm.transactions,0);
 f.store.close();f.store.close();assert.deepEqual(f.store.diagnostics!.sameRealm,{owners:0,connections:0,transactions:0});
 if(mode==='pending-open'){f.opened.succeed();await flush();assert.equal(f.closeCalls,1);assert.equal(f.store.diagnostics!.sameRealm.connections,0);}
 await assert.rejects(f.store.usage!(),/closed/);assert.equal(f.store.diagnostics!.active,0);assert.deepEqual(f.store.diagnostics!.sameRealm,{owners:0,connections:0,transactions:0});
});

test('a materially late watchdog gives queued read and LRU callbacks exactly two native event opportunities',async t=>{
 const context={},f=fixture(t,{record:diagnosticRecord}),tasks=taskTimers(t),result=observe(f.store.get(diagnosticRecord.key,context));await flush();const tx=f.transactions[0];
 tasks.advanceTo(4200);tasks.runNext(3000);await flush();assert.equal(tx.abortCalls,0);assert.equal(result.outcome.status,'pending');
 let trace=f.store.diagnosticFor!(context)!;assert.deepEqual(trace.watchdog,{elapsedMilliseconds:4200,latenessMilliseconds:1200,phase:'requests-pending',abort:'pending',graceEventTurns:0});
 // Real IDB get requires a final metadata touch after both read callbacks.
 tx.requests[0].succeed();tx.requests[1].succeed();assert.equal(tx.requests.length,3);assert.equal(tx.touches.length,1);
 tasks.runNext(0);await flush();assert.equal(tx.abortCalls,0);assert.equal(f.store.diagnosticFor!(context)!.watchdog?.graceEventTurns,1);
 tx.requests[2].succeed();tx.finishBackend();tasks.runNext(0);await flush();assert.equal(tx.abortCalls,1);assert.equal(result.outcome.status,'pending','InvalidStateError must still await the real terminal event.');
 tx.complete();await result.done;assert.deepEqual(result.outcome,{status:'fulfilled',value:diagnosticRecord});assert.equal(tasks.pending,0);assert.deepEqual(tasks.scheduled,[3000,3000,0,0]);
 trace=f.store.diagnosticFor!(context)!;assert.equal(trace.watchdog?.graceEventTurns,2);assert.equal(trace.watchdog?.abort,'invalid-state');assert.equal(trace.requestSuccesses,3);assert.equal(trace.outcome,'complete');assert.equal(f.store.diagnostics!.active,0);assert.equal(f.store.diagnostics!.sameRealm.transactions,0);
 for(const secret of[diagnosticRecord.key,diagnosticRecord.digest,diagnosticRecord.metadata])assert.ok(!JSON.stringify(trace).includes(secret));
});

test('late grace never retries a genuinely unfinished transaction or adds another seconds-long timer',async t=>{
 const context={},f=fixture(t),tasks=taskTimers(t),result=observe(f.store.usage!(context));await flush();const tx=f.transactions[0];
 tasks.advanceTo(11000);tasks.runNext(3000);await flush();assert.equal(tx.abortCalls,0);assert.equal(tasks.pending,1);
 tasks.runNext(0);await flush();assert.equal(tx.abortCalls,0);tasks.advanceTo(15000);tasks.runNext(0);await result.done;
 assert.equal(result.outcome.status,'rejected');assert.match((result.outcome as{cause:Error}).cause.message,/transaction timed out/);assert.equal(tx.abortCalls,1);assert.equal(tasks.pending,0);assert.deepEqual(tasks.scheduled,[3000,3000,0,0]);
 const trace=f.store.diagnosticFor!(context)!;assert.equal(trace.watchdog?.elapsedMilliseconds,11000);assert.equal(trace.watchdog?.latenessMilliseconds,8000);assert.equal(trace.watchdog?.graceEventTurns,2);assert.equal(trace.watchdog?.abort,'accepted');assert.equal(trace.outcome,'watchdog-abort');assert.equal(f.store.diagnostics!.sameRealm.transactions,0);
});

for(const elapsed of[3000,3999,4000])test(`real monotonic watchdog threshold at${elapsed}ms preserves normal deadline and the exact bounded late policy`,async t=>{
 const f=fixture(t,{diagnosticClock:()=>1000000}),tasks=taskTimers(t),result=observe(f.store.usage!());await flush();const tx=f.transactions[0];tasks.advanceTo(elapsed);tasks.runNext(3000);await flush();
 if(elapsed<4000){await result.done;assert.equal(tx.abortCalls,1);assert.equal(tasks.pending,0);assert.equal(f.store.diagnostics!.recent[0].watchdog?.graceEventTurns,undefined);}
 else{assert.equal(tx.abortCalls,0);assert.equal(result.outcome.status,'pending');tasks.runNext(0);tasks.runNext(0);await result.done;assert.equal(tx.abortCalls,1);assert.equal(tasks.pending,0);}
 assert.equal(result.outcome.status,'rejected');
});

for(const turn of[0,1]as const)test(`completion during late grace after${turn}turns clears its pending timer without abort or a second settlement`,async t=>{
 const context={},f=fixture(t),tasks=taskTimers(t),result=observe(f.store.usage!(context));await flush();const tx=f.transactions[0];tasks.advanceTo(4200);tasks.runNext(3000);if(turn)tasks.runNext(0);
 tx.succeedRequests();tx.complete();await result.done;assert.deepEqual(result.outcome,{status:'fulfilled',value:{bytes:12,entries:2}});assert.equal(tx.abortCalls,0);assert.equal(tasks.pending,0);assert.equal(f.store.diagnosticFor!(context)!.watchdog?.graceEventTurns,turn);
 f.store.close();f.store.close();assert.equal(tx.abortCalls,0);assert.equal(f.closeCalls,1);assert.deepEqual(f.store.diagnostics!.sameRealm,{owners:0,connections:0,transactions:0});
});

for(const turn of[0,1]as const)test(`owner retirement during late grace after${turn}turns settles and cancels every scheduled continuation`,async t=>{
 const f=fixture(t),tasks=taskTimers(t),result=observe(f.store.usage!());await flush();const tx=f.transactions[0];tasks.advanceTo(4200);tasks.runNext(3000);if(turn)tasks.runNext(0);
 f.store.close();f.store.close();await result.done;assert.equal(result.outcome.status,'rejected');assert.match((result.outcome as{cause:Error}).cause.message,/retired/);assert.equal(tx.abortCalls,1);assert.equal(tasks.pending,0);assert.equal(f.closeCalls,1);assert.deepEqual(f.store.diagnostics!.sameRealm,{owners:0,connections:0,transactions:0});
 tx.complete();await flush();assert.equal(result.outcome.status,'rejected');assert.equal(f.store.diagnostics!.recent.at(-1)!.outcome,'cancelled');
});

for(const terminal of['onabort','onerror']as const)test(`a native ${terminal} during late grace retains its cause and removes scheduled abort`,async t=>{
 const f=fixture(t),tasks=taskTimers(t),result=observe(f.store.usage!());await flush();const tx=f.transactions[0],cause=new DOMException('Actual native storage failure.','UnknownError');tasks.advanceTo(4200);tasks.runNext(3000);tasks.runNext(0);
 tx.error=cause;tx.finishBackend();tx[terminal]?.();await result.done;assert.deepEqual(result.outcome,{status:'rejected',cause});assert.equal(tasks.pending,0);assert.equal(tx.abortCalls,0);assert.equal(f.store.diagnostics!.sameRealm.transactions,0);
});

test('unexpected abort failure after the fixed late turns still fails closed with the original cause',async t=>{
 const cause=new DOMException('Cannot abort backing store.','UnknownError'),f=fixture(t,{abortFailure:cause}),tasks=taskTimers(t),result=observe(f.store.usage!());await flush();tasks.advanceTo(4200);tasks.runNext(3000);tasks.runNext(0);tasks.runNext(0);await result.done;
 assert.deepEqual(result.outcome,{status:'rejected',cause});assert.equal(tasks.pending,0);assert.equal(f.transactions[0].abortCalls,1);assert.equal(f.store.diagnostics!.recent.at(-1)!.watchdog?.abort,'unexpected-error');
});

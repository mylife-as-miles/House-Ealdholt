/** Observational only: no cache identities, payloads, wall-clock timestamps or
 * timers. IndexedDB has no lock-acquired event; a missing request callback is
 * deliberately not labelled as database-lock or main-thread causation. */
export type WorldBakeIoOperation='get'|'usage'|'put'|'remove'|'clear';
export type WorldBakeIoPhase='opening'|'dispatching'|'requests-pending'|'request-events'|'value-ready'|'awaiting-terminal'|'terminal-event-pending'|'settled';
export type WorldBakeIoRequest='metadata-read'|'payload-read'|'metadata-scan'|'key-scan'|'lru-touch'|'metadata-write'|'payload-write'|'metadata-delete'|'payload-delete'|'metadata-clear'|'payload-clear';
export type WorldBakeIoOutcome='pending'|'complete'|'abort-event'|'error-event'|'cancelled'|'setup-error'|'open-error'|'watchdog-abort'|'watchdog-error';
export interface WorldBakeIoTrace {
 readonly operation:WorldBakeIoOperation;readonly mode:IDBTransactionMode;readonly phase:WorldBakeIoPhase;
 readonly elapsedMilliseconds:number;readonly openMilliseconds:number|null;readonly transactionMilliseconds:number|null;readonly dispatchMilliseconds:number|null;
 readonly firstRequestMilliseconds:number|null;readonly lastRequestMilliseconds:number|null;readonly valueReadyMilliseconds:number|null;
 readonly requests:number;readonly requestSuccesses:number;readonly requestErrors:number;readonly lastRequest:WorldBakeIoRequest|null;
 readonly sameRealmTransactionsAtCreation:number|null;readonly outcome:WorldBakeIoOutcome;
 /** Optional 0..2 counts fixed zero-delay task yields, not seconds-long extensions or retries. */
 readonly watchdog:Readonly<{elapsedMilliseconds:number;latenessMilliseconds:number;phase:WorldBakeIoPhase;abort:'pending'|'accepted'|'invalid-state'|'unexpected-error';graceEventTurns?:0|1|2}>|null;
}
export interface WorldBakeIoRealm {owners:number;connections:number;transactions:number}
export interface WorldBakeIoDiagnostics {
 readonly version:1;readonly capacity:8;readonly activeSampleMilliseconds:1000;readonly started:number;readonly completed:number;readonly failed:number;readonly active:number;readonly droppedDetails:number;
 readonly sameRealm:Readonly<WorldBakeIoRealm>;readonly activeOperations:readonly WorldBakeIoTrace[];readonly recent:readonly WorldBakeIoTrace[];
}
interface Recorder {
 readonly detailed:boolean;
 opened():void;transaction():void;dispatched():void;request(kind:WorldBakeIoRequest):void;success(kind:WorldBakeIoRequest):void;error(kind:WorldBakeIoRequest):void;value():void;watchdog(graceEventTurns?:0):void;grace(turn:1|2):void;
 abort(outcome:'accepted'|'invalid-state'|'unexpected-error'):void;finish(outcome:Exclude<WorldBakeIoOutcome,'pending'>):void;snapshot(sampleTime?:number):WorldBakeIoTrace|null;
}
const noop=()=>{};
/** At most8 detailed active operations plus8 completed snapshots per owner.
 * The operation token is ephemeral and contains no key or payload fields. */
export function createWorldBakeIoDiagnostics(realm:WorldBakeIoRealm,clock:()=>number=()=>performance.now()){
 const capacity=8,active=new Set<Recorder>(),recent:WorldBakeIoTrace[]=[],contexts=new WeakMap<object,()=>WorldBakeIoTrace|null>();
 let started=0,completed=0,failed=0,pending=0,droppedDetails=0;
 const empty=Object.freeze([] as WorldBakeIoTrace[]);
 let detailRevision=0,activeSnapshotRevision=-1,activeSnapshotBucket=-1,activeSnapshots:readonly WorldBakeIoTrace[]=empty,recentSnapshots:readonly WorldBakeIoTrace[]=empty,realmSnapshot:Readonly<WorldBakeIoRealm>|null=null;
 const now=()=>{try{const n=clock();return Number.isFinite(n)?n:0;}catch{return 0;}};
 const ms=(value:number)=>Math.round(Math.max(0,Math.min(86400000,value))*10)/10;
 // Drop the obsolete array reference on an event, but build its replacement
 // only if telemetry is actually read. No per-render copy/freeze is needed.
 function dirty(){detailRevision++;activeSnapshots=empty;activeSnapshotRevision=-1;}
 function counted(outcome:Exclude<WorldBakeIoOutcome,'pending'>){pending--;if(outcome==='complete')completed++;else failed++;}
 function begin(operation:WorldBakeIoOperation,mode:IDBTransactionMode,context?:object):Recorder{
  started++;pending++;const start=now();
  if(active.size>=capacity){droppedDetails++;let done=false;return{detailed:false,opened:noop,transaction:noop,dispatched:noop,request:noop,success:noop,error:noop,value:noop,watchdog:noop,grace:noop,abort:noop,snapshot:()=>null,
   finish(outcome){if(done)return;done=true;counted(outcome);}};}
  let transactionAt:number|null=null,settled=false;
  const row={operation,mode,phase:'opening' as WorldBakeIoPhase,elapsedMilliseconds:0,openMilliseconds:null as number|null,transactionMilliseconds:null as number|null,dispatchMilliseconds:null as number|null,
   firstRequestMilliseconds:null as number|null,lastRequestMilliseconds:null as number|null,valueReadyMilliseconds:null as number|null,
   requests:0,requestSuccesses:0,requestErrors:0,lastRequest:null as WorldBakeIoRequest|null,sameRealmTransactionsAtCreation:null as number|null,outcome:'pending' as WorldBakeIoOutcome,
   watchdog:null as WorldBakeIoTrace['watchdog']};
  let revision=0,cachedRevision=-1,cachedBucket=-1,cached:WorldBakeIoTrace|null=null;
  const elapsed=()=>ms(now()-start),changed=()=>{revision++;dirty();};
  const snapshot=(sampleTime?:number):WorldBakeIoTrace=>{
   const at=settled?0:sampleTime??now(),bucket=settled?0:Math.floor(at/1000);
   if(cached&&cachedRevision===revision&&cachedBucket===bucket)return cached;
   cached=Object.freeze({...row,elapsedMilliseconds:settled?row.elapsedMilliseconds:ms(at-start)});cachedRevision=revision;cachedBucket=bucket;return cached;
  };
  const recorder:Recorder={
   detailed:true,
   opened(){if(settled)return;row.openMilliseconds=elapsed();row.phase='dispatching';changed();},
   transaction(){if(settled)return;transactionAt=now();row.transactionMilliseconds=ms(transactionAt-start);row.sameRealmTransactionsAtCreation=realm.transactions;changed();},
   dispatched(){if(settled)return;row.dispatchMilliseconds=elapsed();row.phase='requests-pending';changed();},
   request(kind){if(settled)return;row.requests++;row.lastRequest=kind;row.phase=row.valueReadyMilliseconds===null?'requests-pending':'value-ready';changed();},
   success(kind){if(settled)return;row.requestSuccesses++;row.lastRequest=kind;const at=elapsed();row.firstRequestMilliseconds??=at;row.lastRequestMilliseconds=at;row.phase=row.requestSuccesses+row.requestErrors===row.requests?'awaiting-terminal':row.valueReadyMilliseconds===null?'request-events':'value-ready';changed();},
   error(kind){if(settled)return;row.requestErrors++;row.lastRequest=kind;const at=elapsed();row.firstRequestMilliseconds??=at;row.lastRequestMilliseconds=at;changed();},
   value(){if(settled)return;row.valueReadyMilliseconds=elapsed();row.phase=row.requestSuccesses+row.requestErrors===row.requests?'awaiting-terminal':'value-ready';changed();},
   watchdog(graceEventTurns){if(settled)return;const at=ms(now()-(transactionAt??start));row.watchdog=Object.freeze({elapsedMilliseconds:at,latenessMilliseconds:ms(at-3000),phase:row.phase,abort:'pending',...(graceEventTurns===0?{graceEventTurns}: {})});changed();},
   grace(turn){if(settled||row.watchdog?.graceEventTurns===undefined)return;row.watchdog=Object.freeze({...row.watchdog,graceEventTurns:turn});changed();},
   abort(outcome){if(settled||!row.watchdog)return;row.watchdog=Object.freeze({...row.watchdog,abort:outcome});if(outcome==='invalid-state')row.phase='terminal-event-pending';changed();},
   finish(outcome){if(settled)return;settled=true;counted(outcome);row.elapsedMilliseconds=elapsed();row.outcome=outcome;row.phase='settled';active.delete(recorder);changed();recent.push(snapshot());if(recent.length>capacity)recent.shift();recentSnapshots=Object.freeze(recent.slice());},
   snapshot,
  };
  active.add(recorder);dirty();if(context)contexts.set(context,snapshot);return recorder;
 }
 const diagnostics:WorldBakeIoDiagnostics={version:1,capacity:8,activeSampleMilliseconds:1000,get started(){return started;},get completed(){return completed;},get failed(){return failed;},get active(){return pending;},get droppedDetails(){return droppedDetails;},
  get sameRealm(){if(!realmSnapshot||realmSnapshot.owners!==realm.owners||realmSnapshot.connections!==realm.connections||realmSnapshot.transactions!==realm.transactions)realmSnapshot=Object.freeze({owners:realm.owners,connections:realm.connections,transactions:realm.transactions});return realmSnapshot;},
  get activeOperations(){
   if(!active.size)return empty;
   const at=now(),bucket=Math.floor(at/1000);
   if(activeSnapshotRevision!==detailRevision||activeSnapshotBucket!==bucket){const rows:WorldBakeIoTrace[]=[];for(const trace of active)rows.push(trace.snapshot(at)!);activeSnapshots=Object.freeze(rows);activeSnapshotRevision=detailRevision;activeSnapshotBucket=bucket;}
   return activeSnapshots;
  },get recent(){return recentSnapshots;}};
 return{diagnostics,begin,forContext(context:object){return contexts.get(context)?.()??null;}};
}

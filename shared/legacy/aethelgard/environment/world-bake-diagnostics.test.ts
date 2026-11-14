import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorldBakeIoDiagnostics} from './world-bake-diagnostics';

test('per-owner detail is capped while aggregate activity, frozen snapshots and exact ephemeral contexts remain observable',()=>{
 let time=10;const io=createWorldBakeIoDiagnostics({owners:1,connections:1,transactions:9},()=>time),contexts=Array.from({length:9},()=>({privateKey:'never-serialize-this-token'}));
 const traces=contexts.map(context=>io.begin('get','readwrite',context));assert.equal(io.diagnostics.active,9);assert.equal(io.diagnostics.activeOperations.length,8);assert.equal(io.diagnostics.droppedDetails,1);assert.equal(io.forContext(contexts[8]),null);
 const before=io.diagnostics.activeOperations;assert.ok(Object.isFrozen(before));assert.ok(before.every(Object.isFrozen));
 time=20;for(const trace of traces){trace.opened();trace.transaction();trace.request('metadata-read');trace.dispatched();trace.success('metadata-read');trace.value();trace.finish('complete');trace.finish('complete');}
 assert.equal(io.diagnostics.active,0);assert.equal(io.diagnostics.completed,9);assert.equal(io.diagnostics.recent.length,8);assert.equal(before[0].phase,'opening');assert.equal(io.forContext(contexts[0])?.outcome,'complete');
 for(let i=0;i<32;i++)io.begin('usage','readonly').finish('complete');assert.equal(io.diagnostics.recent.length,8);assert.equal(io.diagnostics.started,41);assert.equal(io.diagnostics.completed,41);
 assert.ok(!JSON.stringify(io.diagnostics).includes('never-serialize-this-token'));
});

test('diagnostic clocks cannot throw through storage and timings are finite bounded relative durations',()=>{
 let time=0;const io=createWorldBakeIoDiagnostics({owners:1,connections:0,transactions:0},()=>{if(time===-1)throw Error('A diagnostic clock failed.');return time;});
 const trace=io.begin('get','readwrite');time=-1;assert.doesNotThrow(()=>{trace.opened();trace.transaction();trace.request('payload-read');trace.dispatched();trace.success('payload-read');trace.value();trace.watchdog();trace.abort('invalid-state');});
 time=Infinity;trace.finish('complete');const snapshot=io.diagnostics.recent[0];assert.equal(snapshot.elapsedMilliseconds,0);assert.equal(snapshot.watchdog?.latenessMilliseconds,0);assert.equal(snapshot.outcome,'complete');assert.ok(Object.isFrozen(snapshot.watchdog));
});

test('unchanged hot reads reuse arrays, realm objects and settled context snapshots without further clock reads',()=>{
 let time=0,reads=0;const context={},io=createWorldBakeIoDiagnostics({owners:1,connections:1,transactions:1},()=>{reads++;return time;}),trace=io.begin('get','readwrite',context);
 const active=io.diagnostics.activeOperations,row=active[0],realm=io.diagnostics.sameRealm,recent=io.diagnostics.recent;
 for(let i=0;i<1000;i++){assert.equal(io.diagnostics.activeOperations,active);assert.equal(io.forContext(context),row);assert.equal(io.diagnostics.sameRealm,realm);assert.equal(io.diagnostics.recent,recent);}
 time=4200;trace.finish('complete');const settled=io.forContext(context),completed=io.diagnostics.recent,empty=io.diagnostics.activeOperations,clockAtCompletion=reads;
 for(let i=0;i<1000;i++){time++;assert.equal(io.forContext(context),settled);assert.equal(io.diagnostics.recent,completed);assert.equal(io.diagnostics.activeOperations,empty);assert.equal(io.diagnostics.sameRealm,realm);}
 assert.equal(reads,clockAtCompletion,'Settled, recent, empty-active and realm snapshots need no time sampling.');assert.equal(settled?.elapsedMilliseconds,4200);assert.equal(completed[0],settled);
});

test('active elapsed time refreshes at bounded read sampling while events invalidate immediately and watchdog metadata stays stable',()=>{
 let time=0;const context={},io=createWorldBakeIoDiagnostics({owners:1,connections:1,transactions:1},()=>time),trace=io.begin('get','readwrite',context),initial=io.diagnostics.activeOperations;
 time=999;assert.equal(io.diagnostics.activeOperations,initial);assert.equal(io.forContext(context),initial[0]);time=1000;const refreshed=io.diagnostics.activeOperations;assert.notEqual(refreshed,initial);assert.equal(refreshed[0].elapsedMilliseconds,1000);
 time=1999;assert.equal(io.diagnostics.activeOperations,refreshed);trace.opened();const opened=io.diagnostics.activeOperations;assert.notEqual(opened,refreshed);assert.equal(opened[0].phase,'dispatching');assert.equal(opened[0].elapsedMilliseconds,1999);assert.equal(io.forContext(context),opened[0]);
 time=3000;trace.transaction();trace.request('payload-read');trace.dispatched();trace.watchdog();trace.abort('invalid-state');const waiting=io.diagnostics.activeOperations,watchdog=waiting[0].watchdog;assert.ok(Object.isFrozen(watchdog));
 time=4000;const later=io.diagnostics.activeOperations;assert.notEqual(later,waiting);assert.equal(later[0].elapsedMilliseconds,4000);assert.equal(later[0].watchdog,watchdog,'A time-only refresh reuses unchanged nested watchdog metadata.');assert.equal(waiting[0].elapsedMilliseconds,3000,'Prior immutable snapshots never change.');
 time=4500;trace.finish('complete');assert.equal(io.forContext(context)?.elapsedMilliseconds,4500,'Terminal durations remain event-exact rather than sampled.');
});

test('recent and realm snapshots invalidate only on relevant changes and remain local to their owner',()=>{
 let time=0;const realm={owners:2,connections:2,transactions:1},a=createWorldBakeIoDiagnostics(realm,()=>time),b=createWorldBakeIoDiagnostics(realm,()=>time+10),context={},beforeA=a.diagnostics.sameRealm,beforeB=b.diagnostics.sameRealm,emptyA=a.diagnostics.recent,emptyB=b.diagnostics.recent;
 assert.notEqual(beforeA,beforeB);assert.notEqual(emptyA,emptyB);const trace=a.begin('usage','readonly',context);assert.equal(a.diagnostics.recent,emptyA);time=10;trace.finish('complete');const completeA=a.diagnostics.recent;assert.notEqual(completeA,emptyA);assert.equal(b.diagnostics.recent,emptyB);assert.equal(b.forContext(context),null);
 realm.transactions=0;const afterA=a.diagnostics.sameRealm,afterB=b.diagnostics.sameRealm;assert.notEqual(afterA,beforeA);assert.notEqual(afterB,beforeB);assert.equal(beforeA.transactions,1);assert.equal(afterA.transactions,0);assert.equal(a.diagnostics.sameRealm,afterA);assert.equal(b.diagnostics.sameRealm,afterB);assert.equal(a.diagnostics.recent,completeA);
 realm.owners=0;realm.connections=0;const closed=a.diagnostics.sameRealm;assert.deepEqual(closed,{owners:0,connections:0,transactions:0});assert.equal(a.diagnostics.sameRealm,closed);
});

test('over-cap aggregate activity does not rebuild unchanged detailed snapshots or leak an old owner cache',()=>{
 const io=createWorldBakeIoDiagnostics({owners:1,connections:1,transactions:8},()=>0),traces=Array.from({length:8},()=>io.begin('get','readwrite')),active=io.diagnostics.activeOperations,extra=io.begin('put','readwrite');
 assert.equal(io.diagnostics.active,9);assert.equal(io.diagnostics.activeOperations,active);extra.finish('complete');assert.equal(io.diagnostics.active,8);assert.equal(io.diagnostics.activeOperations,active);traces[0].finish('complete');const changed=io.diagnostics.activeOperations;assert.notEqual(changed,active);assert.equal(changed.length,7);
 const fresh=createWorldBakeIoDiagnostics({owners:1,connections:0,transactions:0},()=>0);assert.equal(fresh.diagnostics.activeOperations.length,0);assert.equal(fresh.diagnostics.recent.length,0);assert.notEqual(fresh.diagnostics.activeOperations,changed);for(const trace of traces)trace.finish('complete');
});

test('bounded grace metadata preserves initial watchdog timing and immutable event-sampled snapshots',()=>{
 let time=0;const io=createWorldBakeIoDiagnostics({owners:1,connections:1,transactions:1},()=>time),context={},trace=io.begin('get','readwrite',context);
 trace.opened();trace.transaction();trace.request('metadata-read');trace.dispatched();time=4200;trace.watchdog(0);const initial=io.forContext(context)!,watchdog=initial.watchdog!;
 assert.deepEqual(watchdog,{elapsedMilliseconds:4200,latenessMilliseconds:1200,phase:'requests-pending',abort:'pending',graceEventTurns:0});assert.ok(Object.isFrozen(watchdog));
 time=4201;trace.success('metadata-read');trace.grace(1);const first=io.forContext(context)!;assert.notEqual(first,initial);assert.equal(first.watchdog?.graceEventTurns,1);assert.equal(watchdog.graceEventTurns,0);assert.equal(first.watchdog?.elapsedMilliseconds,4200);
 time=4202;trace.grace(2);trace.abort('invalid-state');const last=io.forContext(context)!;assert.equal(last.watchdog?.graceEventTurns,2);assert.equal(last.watchdog?.elapsedMilliseconds,4200);assert.equal(last.phase,'terminal-event-pending');assert.equal(first.watchdog?.graceEventTurns,1);
 trace.finish('complete');const settled=io.forContext(context);trace.grace(1);trace.abort('accepted');assert.equal(io.forContext(context),settled);assert.equal(io.diagnostics.completed,1);assert.equal(io.diagnostics.failed,0);
});

test('grace instrumentation cannot create a watchdog or alter a non-grace operation and stays bounded over the detail cap',()=>{
 const io=createWorldBakeIoDiagnostics({owners:1,connections:1,transactions:9},()=>0),trace=io.begin('usage','readonly');trace.grace(1);assert.equal(trace.snapshot()?.watchdog,null);trace.watchdog();const before=trace.snapshot();trace.grace(2);assert.equal(trace.snapshot(),before);assert.equal(before?.watchdog?.graceEventTurns,undefined);
 const rest=Array.from({length:8},()=>io.begin('get','readwrite'));assert.equal(rest.at(-1)!.detailed,false);assert.doesNotThrow(()=>{rest.at(-1)!.watchdog(0);rest.at(-1)!.grace(1);rest.at(-1)!.grace(2);});
 for(const item of[trace,...rest])item.finish('complete');assert.equal(io.diagnostics.active,0);assert.equal(io.diagnostics.recent.length,8);assert.equal(io.diagnostics.completed,9);assert.equal(io.diagnostics.droppedDetails,1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {createRegionalDetailService,regionalDetailCellProgress,REGIONAL_DETAIL_SERVICE_MILLISECONDS,type RegionalDetailServiceTimers} from './regional-detail-service';

function clock(){
 let now=0,serial=0;const pending=new Map<number,{at:number;callback:()=>void}>(),callbacks=new Map<number,()=>void>();
 const timers:RegionalDetailServiceTimers={now:()=>now,set(callback,delay){const id=++serial;pending.set(id,{at:now+delay,callback});callbacks.set(id,callback);return id;},clear(handle){pending.delete(handle as number);}};
 return{timers,pending,callbacks,advance(target:number){
  let budget=50;
  for(;;){const next=[...pending].filter(([,job])=>job.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;
   if(--budget<0)throw Error('Detail service entered an unbounded timer loop.');now=next[1].at;pending.delete(next[0]);next[1].callback();}
  now=target;
 }};
}
test('throttled static detail gets one coalesced deadline without a render loop',()=>{
 const time=clock();let wakes=0;const service=createRegionalDetailService(()=>wakes++,time.timers);
 service.schedule(REGIONAL_DETAIL_SERVICE_MILLISECONDS);time.advance(40);service.schedule(180);service.schedule(240);
 assert.equal(time.pending.size,1);assert.equal(service.pending,true);time.advance(179);assert.equal(wakes,0);
 time.advance(180);assert.equal(wakes,1);assert.equal(service.pending,false);assert.equal(time.pending.size,0);
 time.advance(10000);assert.equal(wakes,1,'a completed deadline must not poll by itself');service.dispose();
});
test('an earlier deadline replaces an obsolete wake and cancelled callbacks stay inert',()=>{
 const time=clock();let wakes=0;const service=createRegionalDetailService(()=>wakes++,time.timers);
 service.schedule(300);const old=time.callbacks.get(1)!;time.advance(20);service.schedule(180);
 assert.equal(time.pending.size,1);old();assert.equal(wakes,0);time.advance(180);assert.equal(wakes,1);
 service.schedule(200);const cancelled=time.callbacks.get(3)!;service.cancel();cancelled();time.advance(1000);
 assert.equal(wakes,1);assert.equal(service.pending,false);service.dispose();
});
test('suspend and dispose cancel the timer; resume requests only the normal owner wake',()=>{
 const time=clock();let wakes=0;const service=createRegionalDetailService(()=>wakes++,time.timers);
 service.schedule(180);const late=time.callbacks.get(1)!;service.suspend();late();service.schedule(100);time.advance(500);
 assert.equal(wakes,0);assert.equal(time.pending.size,0);service.resume();service.resume();assert.equal(wakes,1);
 service.schedule(680);service.dispose();service.dispose();service.resume();service.schedule(700);time.callbacks.get(2)!();time.advance(1000);
 assert.equal(wakes,1);assert.equal(time.pending.size,0);
});
test('a missed deadline wakes once and malformed deadlines cannot start background work',()=>{
 const time=clock();let wakes=0;const service=createRegionalDetailService(()=>wakes++,time.timers);time.advance(500);
 assert.throws(()=>service.schedule(Infinity),/finite deadline/);assert.throws(()=>service.schedule(NaN),/finite deadline/);
 assert.equal(time.pending.size,0);service.schedule(180);time.advance(500);assert.equal(wakes,1);service.dispose();
});
test('terminal failed detail frees preparation capacity and reports a bounded explicit hold',()=>{
 const level=(readyMask:number,status:string,error='')=>({stats:{readyMask,status,error}});
 assert.deepEqual(regionalDetailCellProgress([level(15,'ready')]),{ready:true,preparing:false,held:false,error:''});
 assert.deepEqual(regionalDetailCellProgress([level(1,'preparing')]),{ready:false,preparing:true,held:false,error:''});
 const failed=regionalDetailCellProgress([level(15,'ready'),level(7,'error','source capture failed')]);
 assert.equal(failed.preparing,false);assert.equal(failed.held,true);assert.equal(failed.ready,false);assert.equal(failed.error,'source capture failed');
 const partial=regionalDetailCellProgress([level(7,'error','x'.repeat(1000)),level(3,'preparing')]);
 assert.equal(partial.preparing,true);assert.equal(partial.held,false);assert.equal(partial.error.length,320);
 const empty=regionalDetailCellProgress([]);assert.equal(empty.held,true);assert.equal(empty.preparing,false);assert.match(empty.error,/no complete derivative/);
});

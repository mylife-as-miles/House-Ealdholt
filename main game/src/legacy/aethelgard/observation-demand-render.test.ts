import test from 'node:test';
import assert from 'node:assert/strict';
import {createObservationDemandRender} from './observation-demand-render';
test('large Reduced Motion backlog coalesces automatic wakes, then requests exactly one final draw on real drain',()=>{
 const demand=createObservationDemandRender();assert.equal(demand.update(true,4600000,4000),false);assert.equal(demand.holding,true);
 for(let i=0;i<100;i++){assert.equal(demand.allowAutomatic(),false);assert.equal(demand.update(true,4600000-i*8000,4000),false);}
 assert.equal(demand.update(true,1,4000),false,'A tiny remaining backlog is not a completed forecast.');
 assert.equal(demand.update(true,0,4000),true);assert.equal(demand.holding,false);assert.equal(demand.allowAutomatic(),true);
 assert.equal(demand.update(true,0,4000),false,'Repeated polls do not request another final draw.');
});
test('a completion-only poll cannot become an environmentChanged draw while held; input and required preparation remain allowed',()=>{
 const demand=createObservationDemandRender();demand.update(true,50000,4000);let environmentUpdates=0,draws=0;
 const complete=(dirty:boolean)=>{if(!demand.allowCompletionPollDraw(dirty))return;environmentUpdates++;const environmentChanged=true;if(dirty||environmentChanged)draws++;};
 complete(false);assert.equal(environmentUpdates,0);assert.equal(draws,0);
 complete(true);assert.equal(draws,1,'An explicit camera/input or prepared-asset dirty draw is still real.');
 complete(false);assert.equal(draws,1,'Completing that input frame does not begin another clock-only redraw.');
 demand.update(true,0,4000);complete(true);assert.equal(draws,2);
});
test('inactive/disposed owners cancel held presentation work without a final redraw; normal motion stays unchanged',()=>{
 const demand=createObservationDemandRender();demand.update(true,50000,4000);demand.cancel();assert.equal(demand.holding,false);assert.equal(demand.update(true,0,4000),false);
 assert.equal(demand.update(false,50000,4000),false);assert.equal(demand.allowAutomatic(),true);assert.equal(demand.allowCompletionPollDraw(false),true);
 demand.update(true,8000,4000);assert.equal(demand.holding,false,'Ordinary small projection slices do not pause normal demand rendering.');
});
test('removing or replacing the observer cancels a held branch even when canonical reads provide no further accepted callback',()=>{
 const demand=createObservationDemandRender();demand.update(true,4600000,4000);assert.equal(demand.allowAutomatic(),false);
 // setObserver(null) cancels the old owner before returning canonical reads;
 // no forecast update is available to unstick the old hold afterward.
 demand.cancel();
 for(let poll=0;poll<3;poll++){assert.equal(demand.allowAutomatic(),true);assert.equal(demand.allowCompletionPollDraw(false),true);}
 assert.equal(demand.update(true,0,4000),false,'The abandoned owner must not request a delayed final draw.');
 demand.update(true,50000,4000);assert.equal(demand.holding,true,'A different observer can begin its own explicit hold.');
});

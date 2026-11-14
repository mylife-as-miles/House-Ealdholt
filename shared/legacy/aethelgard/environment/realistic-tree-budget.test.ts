import assert from 'node:assert/strict';
import test from 'node:test';
import {createRealisticTreeBudget,realisticTreeDetailPlan} from './realistic-tree-budget';

test('one shared weighted cap counts pending, live and retiring source wrappers before admitting Forest01',()=>{
 const budget=createRealisticTreeBudget(),leases=Array.from({length:8},(_,id)=>budget.acquire('pp3',id)!);
 assert.ok(leases.every(Boolean));assert.equal(budget.stats.chargedSourceTriangles,79064);assert.equal(budget.acquire('forest01',100),null);
 for(const lease of leases.slice(2))lease.retire();assert.equal(budget.stats.retiring,6);assert.equal(budget.stats.chargedSourceTriangles,79064);assert.equal(budget.acquire('forest01',100),null,'fading or fenced old wrappers still consume the shared cap');
 for(const lease of leases.slice(2))lease.release();const forest=budget.acquire('forest01',100)!;assert.ok(forest);assert.equal(budget.stats.chargedSourceTriangles,78177);assert.equal(budget.acquire('pp3',20),null);assert.equal(budget.acquire('forest01',101),null,'at most one full Forest01 wrapper');
 assert.deepEqual(realisticTreeDetailPlan(false,true),{pp3:2,forest01:1});assert.deepEqual(realisticTreeDetailPlan(false,false),{pp3:8,forest01:0});
 forest.retire();forest.release();for(const lease of leases)lease.release();assert.equal(budget.stats.chargedSourceTriangles,0);assert.equal(budget.stats.leases,0);assert.equal(budget.stats.retiring,0);
});

test('cancelled or failed preparation returns its lease once; retirement waits before replacement and Native keeps its own smaller path',async()=>{
 const budget=createRealisticTreeBudget(),forest=budget.acquire('forest01',1)!;let finish!:()=>void;const fence=new Promise<void>(resolve=>{finish=resolve;});
 forest.retire();const retirement=fence.then(()=>forest.release());assert.equal(budget.acquire('forest01',2),null);assert.equal(budget.stats.chargedSourceTriangles,58411);finish();await retirement;
 const failed=budget.acquire('forest01',2)!;try{throw Error('Capture or geometry preparation failed.');}catch{failed.release();failed.release();}assert.equal(budget.stats.chargedSourceTriangles,0);assert.equal(budget.stats.leases,0);
 const cancelled=budget.acquire('pp3',5)!;cancelled.release();assert.equal(budget.stats.chargedSourceTriangles,0);
 const native=createRealisticTreeBudget(true);assert.equal(native.acquire('forest01',0),null);const nativeLeases=Array.from({length:3},(_,id)=>native.acquire('pp3',id)!);assert.equal(native.acquire('pp3',3),null);assert.equal(native.stats.maximumSourceTriangles,29649);assert.deepEqual(realisticTreeDetailPlan(true,true),{pp3:3,forest01:0});nativeLeases.forEach(l=>l.release());
});

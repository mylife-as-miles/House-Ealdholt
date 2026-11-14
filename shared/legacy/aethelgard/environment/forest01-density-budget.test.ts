import assert from 'node:assert/strict';
import test from 'node:test';
import {createRealisticTreeBudget,REALISTIC_DENSITY_ALL_LEVEL_BOUND} from './realistic-tree-budget';
import {createVegetationHandoff,TREE_HLOD} from './vegetation-hlod';

test('mixed role counts include pending/live/retiring and canonical actor keys, independently of weighted credit',()=>{
 const b=createRealisticTreeBudget(false,true),old=Array.from({length:8},(_,id)=>b.acquire('pp3',id)!);
 assert.equal(b.stats.maximumSourceTriangles,112766);assert.equal(b.stats.maximumTransitionTriangles,225532);
 assert.equal(b.acquire('forest01',100),null);old.slice(2).forEach(l=>l.retire());
 old.slice(2,5).forEach(l=>l.release());assert.equal(b.stats.pp3,5);assert.equal(b.acquire('forest01',100),null,'full+5PP3 fits weighted credit but violates role counts');
 old.slice(5).forEach(l=>l.release());const full=b.acquire('forest01',100)!;assert.ok(full);
 assert.equal(b.acquire('forest01',100,'density'),null,'one canonical family/actor owner');
 const extra=b.acquire('forest01',101,'density')!;assert.ok(extra);assert.equal(b.stats.chargedSourceTriangles,112766);
 assert.equal(b.acquire('forest01',102,'density'),null);assert.equal(b.acquire('pp3',20),null);
 extra.retire();assert.equal(b.stats.retiring,1);assert.equal(b.acquire('forest01',102,'density'),null);
 extra.release();assert.equal(b.stats.chargedSourceTriangles,78177);full.release();old.forEach(l=>l.release());assert.equal(b.stats.leases,0);
});

test('optional role must retire before new primary allocations, then its actor can become full after a fresh fence',async()=>{
 const b=createRealisticTreeBudget(false,true),full=b.acquire('forest01',10)!,extra=b.acquire('forest01',11,'density')!;
 assert.equal(b.acquire('pp3',20),null,'do not allow optional work to induce required allocation failures');
 extra.retire();full.retire();let finish!:()=>void;const fence=new Promise<void>(r=>{finish=r;});
 const pending=fence.then(()=>{extra.release();full.release();});assert.equal(b.acquire('forest01',11),null);
 finish();await pending;const replacement=b.acquire('forest01',11)!;assert.ok(replacement);assert.equal(b.stats.chargedSourceTriangles,58411);replacement.release();replacement.release();assert.equal(b.stats.leases,0);
 const native=createRealisticTreeBudget(true,true);assert.equal(native.stats.maximumSourceTriangles,29649);assert.equal(native.acquire('forest01',11,'density'),null);assert.equal(native.acquire('forest01',10),null);
 const leases=Array.from({length:3},(_,id)=>native.acquire('pp3',id)!);assert.equal(native.acquire('pp3',4),null);leases.forEach(l=>l.release());
});

test('all drawable levels, not only two adjacent targets, remain below the explicit submitted ceiling',()=>{
 const full=[58411,58411,7942,2],pp3=[9883,9883,1540,2],extra=[0,34589,2746,2];
 const cost=(values:number[],mask:number)=>values.reduce((n,v,i)=>n+(mask&(1<<i)?v:0),0);
 let maximum=0;for(let a=1;a<=15;a++)for(let b=1;b<=15;b++)for(let c=1;c<=15;c++)for(let d=2;d<=14;d+=2)maximum=Math.max(maximum,cost(full,a)+cost(pp3,b)+cost(pp3,c)+cost(extra,d)+512);
 assert.equal(maximum,205231);assert.equal(maximum,REALISTIC_DENSITY_ALL_LEVEL_BOUND);assert.ok(maximum<225532);
 const handoff=createVegetationHandoff(TREE_HLOD);let active=0;
 for(let i=0;i<80;i++){const state=handoff.update(i*10,[0,140,300,800][i%4],15);active=Math.max(active,[...state.weights].filter(n=>n>1e-6).length);const mask=[...state.weights].reduce((m,w,l)=>m+(w>1e-6?1<<l:0),0);assert.ok(cost(full,mask)+2*cost(pp3,15)+cost(extra,14)+512<=225532);}
 assert.equal(active,4,'rapid retargets really retain all four nonzero levels');
});

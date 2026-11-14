import assert from 'node:assert/strict';
import test from 'node:test';
import {BoxGeometry,Group,Mesh,MeshStandardMaterial,PerspectiveCamera,Texture,type Object3D} from 'three';
import {createRegionalLandmarks} from './regional-landmarks';
import type {RegionalLandmark} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
// Synthetic CPU coordinates exercise the existing layout adapter; no authored
// scene, renderer, resident store, navigation, clock or save is constructed.
const placements:RegionalLandmark[]=[{id:'western-fort',x:0,y:2,z:0,yaw:1,radius:50,foundationDepth:2},
 {id:'temple-ruins',x:1_000,y:3,z:0,yaw:.18,radius:40,foundationDepth:3}];
function fixture(native=false){
 const root=new Group(),camera=new PerspectiveCamera(),abort=new AbortController(),jobs:{id:RegionalLandmark['id'];detail:'far'|'full';signal:AbortSignal;resolve:(v:Object3D)=>void;reject:(e:Error)=>void}[]=[];
 const geometry=new BoxGeometry(8,8,8),texture=new Texture(),material=new MeshStandardMaterial({map:texture}),templates:Group[]=[];
 let time=0,wakes=0,borrowedDisposals=0,clones=0;
 for(const resource of [geometry,texture,material])resource.addEventListener('dispose',()=>borrowedDisposals++);
 function template(){const group=new Group();group.add(new Mesh(geometry,material));const clone=group.clone.bind(group);group.clone=(recursive?:boolean)=>{clones++;return clone(recursive);};templates.push(group);return group;}
 camera.position.set(-1_000,2,0);camera.updateMatrixWorld();
 const view=createRegionalLandmarks({sourceRoot:root,camera,native,signal:abort.signal,now:()=>time,changed(){wakes++;},
  load(id,detail,signal){return new Promise((resolve,reject)=>jobs.push({id,detail,signal:signal!,resolve,reject}));}});root.add(view.object);
 function update(next=placements){camera.updateMatrixWorld();view.update(next);}
 async function initial(){update();await settle();for(const job of jobs.filter(job=>job.detail==='far'))job.resolve(template());await settle();}
 function record(id:RegionalLandmark['id'],detail:'far'|'full'){return view.stats.regions.find(r=>r.key===id+':'+detail)!;}
 function close(){view.dispose();geometry.dispose();texture.dispose();material.dispose();root.clear();}
 return{root,camera,abort,jobs,view,template,update,initial,record,close,templates,time:(v:number)=>{time=v;},
  get wakes(){return wakes;},get borrowedDisposals(){return borrowedDisposals;},get clones(){return clones;}};
}

test('far landmarks load independently; one failure leaves the other ready and retries are bounded',async t=>{
 const f=fixture();t.after(f.close);f.update();await settle();assert.equal(f.jobs.length,2);
 f.jobs.find(job=>job.id==='western-fort')!.reject(Error('fort unavailable'));
 f.jobs.find(job=>job.id==='temple-ruins')!.resolve(f.template());await settle();
 assert.equal(f.view.stats.loaded,1);assert.equal(f.view.stats.lods.far,1);assert.equal(f.view.stats.status,'held-error');
 for(let i=0;i<50;i++)f.update();await settle();assert.equal(f.jobs.length,2,'far failure does not fetch again every frame');
 f.time(1_000);f.update();await settle();assert.equal(f.jobs.length,3);f.jobs[2].resolve(f.template());await settle();
 assert.equal(f.view.stats.loaded,2);assert.equal(f.view.stats.status,'ready');assert.equal(f.view.stats.lods.far,2);
});

test('near handoff retains the existing far view until full readiness, and return reuses a detached preparation',async t=>{
 const f=fixture();t.after(f.close);await f.initial();const fort=f.view.object.children[0],far=fort.children.find(c=>c.name==='western-fort')!;
 assert.ok(far);f.camera.position.x=0;f.update();await settle();assert.equal(f.jobs[2].detail,'full');
 assert.equal(far.parent,fort);assert.equal(f.view.stats.lods.far,2);assert.equal(f.record('western-fort','full').phase,'loading');
 f.jobs[2].resolve(f.template());await settle();const full=fort.children.find(c=>c.name==='western-fort')!;
 assert.notEqual(full,far);assert.equal(far.parent,null);assert.equal(f.view.stats.lods.full,1);
 assert.equal(f.record('western-fort','far').phase,'detached');assert.equal(f.record('western-fort','far').retained,true);
 f.camera.position.x=-1_000;f.update();assert.equal(far.parent,fort);assert.equal(full.parent,null);assert.equal(f.record('western-fort','full').phase,'detached');
 f.camera.position.x=0;f.update();await settle();assert.equal(full.parent,fort);assert.equal(f.jobs.length,3,'return attaches the current cached clone');
 assert.equal(f.view.stats.lods.full,1);assert.equal(f.borrowedDisposals,0);
});

test('retreat invalidates only the presentation request; late shared fetch completion cannot clone or replace far',async t=>{
 const f=fixture();t.after(f.close);await f.initial();const fort=f.view.object.children[0],far=fort.children.find(c=>c.name==='western-fort')!;
 f.camera.position.x=0;f.update();await settle();const oldJob=f.jobs[2],oldGeneration=f.record('western-fort','full').generation;
 f.camera.position.x=-1_000;f.update();assert.equal(oldJob.signal.aborted,false);assert.equal(far.parent,fort);
 assert.equal(f.record('western-fort','full').currentRequest?.cancelled,true);
 const cloneCount=f.clones;oldJob.resolve(f.template());await settle();
 assert.equal(f.clones,cloneCount,'obsolete borrowed completion is rejected before clone');assert.equal(far.parent,fort);
 f.camera.position.x=0;f.update();assert.ok(f.record('western-fort','full').generation>oldGeneration);
 assert.equal(f.record('western-fort','full').currentRequest?.cancelled,false);assert.equal(f.record('western-fort','full').phase,'loading');
 await settle();assert.equal(f.jobs.length,3,'return reuses the resolved shared fetch');assert.equal(f.view.stats.lods.full,1);assert.equal(far.parent,null);assert.equal(f.borrowedDisposals,0);
});

test('immediate return coalesces the pending shared full fetch while only the newest request may clone and attach',async t=>{
 const f=fixture();t.after(f.close);await f.initial();f.camera.position.x=0;f.update();await settle();
 const oldGeneration=f.record('western-fort','full').generation,shared=f.jobs[2];f.camera.position.x=-1_000;f.update();f.camera.position.x=0;f.update();await settle();
 const current=f.record('western-fort','full').generation;assert.ok(current>oldGeneration);assert.equal(shared.signal.aborted,false);assert.equal(f.jobs.length,3);
 const before=f.clones;shared.resolve(f.template());await settle();assert.equal(f.clones,before+1);assert.equal(f.record('western-fort','full').currentRequest?.generation,current);
 assert.equal(f.record('western-fort','full').phase,'attached');assert.equal(f.view.stats.lods.full,1);
});

test('a revised source placement replaces its owner and rejects an obsolete full completion',async t=>{
 const f=fixture();t.after(f.close);await f.initial();f.camera.position.x=0;f.update();await settle();
 const oldJob=f.jobs[2],oldOwner=f.record('western-fort','full').owner;
 const next=placements.map(p=>p.id==='western-fort'?{...p,x:40}:p);f.update(next);await settle();
 assert.equal(oldJob.signal.aborted,false,'presentation cancellation leaves the shared root load alive');const newFort=f.view.object.children.find(c=>c.name==='Western sea fort')!;assert.equal(newFort.position.x,40);
 const before=f.clones;oldJob.resolve(f.template());await settle();assert.equal(f.clones,before);assert.equal(newFort.children.length,2,'new owner reuses the cached far template');
 assert.equal(f.jobs.length,3,'owner revision does not reparse borrowed assets');
 assert.notEqual(f.record('western-fort','far').owner,oldOwner);assert.equal(f.view.stats.loaded,2);assert.equal(f.view.stats.lods.far,2);
});

test('failed full requests retain the same far model through backoff and exhaustion, then explicit retry can recover',async t=>{
 const f=fixture();t.after(f.close);await f.initial();const fort=f.view.object.children[0],far=fort.children.find(c=>c.name==='western-fort')!;
 f.camera.position.x=0;f.update();await settle();
 for(let attempt=0;attempt<3;attempt++){
  f.jobs[2+attempt].reject(Error('full unavailable '+attempt));await settle();assert.equal(far.parent,fort);assert.equal(f.view.stats.status,'ready');assert.equal(f.view.stats.lods.far,2);
  f.time(attempt===0?1_000:attempt===1?3_000:100_000);f.update();await settle();
 }
 assert.equal(f.jobs.length,5);assert.equal(f.record('western-fort','full').retryExhausted,true);
 for(let i=0;i<50;i++)f.update();await settle();assert.equal(f.jobs.length,5);assert.equal(far.parent,fort);
 f.view.retryFailed();f.update();await settle();f.jobs[5].resolve(f.template());await settle();assert.equal(f.view.stats.lods.full,1);assert.equal(far.parent,null);
});

test('teleporting between both landmarks bounds detached full residency and eviction preserves borrowed GPU resources',async t=>{
 const f=fixture();t.after(f.close);await f.initial();
 for(const x of [0,1_000]){f.camera.position.x=x;f.update();await settle();f.jobs[f.jobs.length-1].resolve(f.template());await settle();}
 f.camera.position.x=-1_000;f.update();assert.equal(f.view.stats.ownership.detachedFull,1);
 assert.equal(f.view.stats.ownership.ownedPreparations,3,'two retained far views and one detached full view');
 assert.equal(f.view.stats.regions.filter(r=>r.key.endsWith(':full')&&r.phase==='evicted').length,1);
 f.time(15_001);f.update();assert.equal(f.view.stats.ownership.ownedPreparations,2);assert.equal(f.view.stats.ownership.detachedFull,0);
 assert.equal(f.borrowedDisposals,0);assert.ok(f.templates.every(template=>template.parent===null&&template.children.length===1));
 f.camera.position.x=0;f.update();await settle();assert.equal(f.jobs.length,4,'return after clone eviction reuses a borrowed template');assert.equal(f.view.stats.lods.full,1);
 let foundationGeometryDisposals=0,foundationMaterialDisposals=0;
 for(const group of f.view.object.children)for(const node of group.children)if(node instanceof Mesh){
  node.geometry.addEventListener('dispose',()=>foundationGeometryDisposals++);(node.material as MeshStandardMaterial).addEventListener('dispose',()=>foundationMaterialDisposals++);
 }
 f.view.dispose();f.view.dispose();assert.equal(foundationGeometryDisposals,2);assert.equal(foundationMaterialDisposals,2);assert.equal(f.borrowedDisposals,0);
 assert.equal(f.view.stats.ownership.ownedPreparations,0);assert.equal(f.view.stats.status,'disposed');
});

test('abort/dispose during a full load leaves cache templates intact and causes no late scene wake',async t=>{
 const f=fixture();t.after(f.close);await f.initial();f.camera.position.x=0;f.update();await settle();const pending=f.jobs[2];
 f.abort.abort();const wakes=f.wakes,before=f.clones;assert.equal(pending.signal.aborted,true);assert.equal(f.view.object.children.length,0);
 pending.resolve(f.template());await settle();assert.equal(f.clones,before);assert.equal(f.wakes,wakes);assert.equal(f.borrowedDisposals,0);
 assert.equal(f.view.stats.status,'disposed');f.update();assert.equal(f.jobs.length,3);
});

test('explicit Native rendering remains far-only at both near positions',async t=>{
 const f=fixture(true);t.after(f.close);await f.initial();
 for(const x of [0,1_000,0]){f.camera.position.x=x;f.update();await settle();}
 assert.equal(f.jobs.length,2);assert.equal(f.view.stats.lods.far,2);assert.equal(f.view.stats.lods.full,0);
 assert.ok(f.view.stats.regions.every(r=>r.key.endsWith(':far')));
});

test('removing the layout during cold loading cancels old owners and return starts fresh owners',async t=>{
 const f=fixture();t.after(f.close);f.update();await settle();const old=f.jobs.slice(),oldOwner=f.record('western-fort','far').owner;
 f.update([]);assert.equal(f.view.object.children.length,0);assert.equal(f.view.stats.loaded,0);assert.equal(f.view.stats.status,'awaiting-ground');
 for(const job of old){assert.equal(job.signal.aborted,false);job.resolve(f.template());}await settle();assert.equal(f.clones,0);
 f.update();await settle();assert.equal(f.jobs.length,2);assert.notEqual(f.record('western-fort','far').owner,oldOwner);
 assert.equal(f.view.stats.loaded,2);assert.equal(f.borrowedDisposals,0);
});

test('detail distance uses the current viewer in source space under the existing root transform',async t=>{
 const f=fixture();t.after(f.close);await f.initial();f.root.position.set(100,0,100);f.root.scale.setScalar(2);
 f.camera.position.set(100,4,100);f.update();await settle();assert.equal(f.jobs.length,3);assert.equal(f.jobs[2].id,'western-fort');
 assert.equal(f.jobs[2].detail,'full');assert.deepEqual(f.view.stats.placements,placements,'source placement records stay unchanged');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSourceBuildingCatalogue,type BuildingSourcePart,type SourceBuilding} from './building-damage-catalogue';
import {buildingDamageKey,type BuildingDamageBinding,type BuildingRaidOutcome} from './building-damage';
import {sampleWorldEnvironment} from '../environment/world-environment-state';
import {BUILDING_CONFLAGRATION_RULES,createBuildingConflagration,stepBuildingConflagration,parseBuildingConflagration,restoreBuildingConflagration,serializeBuildingConflagrationRestore,matchesBuildingConflagrationCatalogue,sampleBuildingConflagrationWeather,type BuildingConflagrationState,type BuildingConflagrationWeather,type BuildingFirefightingDelivery,type BuildingLocalRepairProgress,type BuildingOperationProof} from './building-conflagration';

const WORLD='existing-world-fire-test',SHA='4'.repeat(64),copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function house(x:number):BuildingSourcePart[]{return[
 {id:`door-${x}`,kind:'door',bounds:{min:[x,0,0],max:[x+4,2,.2]}},
 {id:`wall-${x}`,kind:'wall',bounds:{min:[x,0,3],max:[x+4,2,3.2]}},
 {id:`roof-${x}`,kind:'roof',bounds:{min:[x-.2,2,-.2],max:[x+4.2,2.4,3.4]}}
];}
const catalogue=(positions=[0,8,16,24,200])=>buildSourceBuildingCatalogue({sourceSha256:SHA,profile:'desktop',parts:positions.flatMap(house)});
const sources=catalogue(),building=(x:number,c=sources)=>c.buildings.find(b=>b.binding.buildingId===`door:door-${x}`)!;
function initial(c=sources,at=0){return createBuildingConflagration({worldKey:WORLD,absoluteMinute:at,seed:'reproducible-source-fire',buildings:c.buildings});}
function outcome(serial=0,at=0,target=building(0)):BuildingRaidOutcome{return{worldKey:WORLD,raidId:`raid-${at}-${serial}`,startMinute:at,settledMinute:at,outcome:'burned',binding:target.binding,targetLabel:'Source building test fixture'};}
const weather=(from:number,to:number,rain=0,windX=0,windZ=0):BuildingConflagrationWeather[]=>Array.from({length:to-from},(_,i)=>({atMinute:from+i,rain,windX,windZ}));
const record=(s:BuildingConflagrationState,b=building(0))=>s.buildings.find(v=>buildingDamageKey(v.binding)===buildingDamageKey(b.binding))!;
function proof(binding:BuildingDamageBinding,atMinute:number,id:string):BuildingOperationProof{return{sourceSha256:binding.sourceSha256,profile:binding.profile,buildingId:binding.buildingId,operationId:`operation-${id}`,arrivalId:`arrival-${id}`,contactMinute:atMinute};}
function delivery(atMinute:number,id='bucket-0',water=200,target=building(0)):BuildingFirefightingDelivery{return{id,worldKey:WORLD,binding:target.binding,atMinute,residentId:'source-resident-1',proof:proof(target.binding,atMinute,id),water};}
function repair(atMinute:number,id:string,labourMinutes=60,timber=4,target=building(0)):BuildingLocalRepairProgress{return{id,worldKey:WORLD,binding:target.binding,atMinute,residentId:'source-resident-1',proof:proof(target.binding,atMinute,id),labourMinutes,timber};}

test('fire reaches exact nearby source buildings beyond the outer raid sites, collapses and exhausts finite fuel',()=>{
 const result=stepBuildingConflagration(initial(),{absoluteMinute:100,damageOutcome:outcome(),weather:weather(0,100)}),s=result.state;
 assert.equal(s.catalogue.length,5);assert.ok(!sources.sites.some(b=>b.binding.buildingId===building(16).binding.buildingId));
 assert.equal(record(s,building(16)).phase,'charred');assert.equal(record(s,building(24)).phase,'charred');assert.equal(record(s,building(200)).phase,'sound');
 assert.ok(result.events.some(e=>e.kind==='spread'&&e.binding.buildingId===building(16).binding.buildingId));
 for(const x of[0,8,16,24]){const b=record(s,building(x));assert.equal(b.fuelRemaining,0);assert.ok(b.structuralDamage>=BUILDING_CONFLAGRATION_RULES.collapseDamage);assert.notEqual(b.collapsedAtMinute,null);}
 assert.equal(result.events.filter(e=>e.kind==='collapse').length,4);assert.equal(result.events.filter(e=>e.kind==='extinguishing').length,4);
 assert.equal(record(stepBuildingConflagration(s,{absoluteMinute:200,damageOutcome:outcome(1,100)}).state).fuelRemaining,0,'A new raid cannot create fresh fuel in an unrepaired ruin.');
 assert.deepEqual(parseBuildingConflagration(copy(s),WORLD),s);
});

test('heavy authored rain prevents spread and extinguishes the initial fire before structural collapse',()=>{
 const result=stepBuildingConflagration(initial(),{absoluteMinute:100,damageOutcome:outcome(),weather:weather(0,100,1000)}),b=record(result.state);
 assert.equal(b.phase,'extinguished');assert.equal(b.extinguishedAtMinute,10);assert.equal(b.collapsedAtMinute,null);assert.ok(b.fuelRemaining>0);
 assert.equal(result.events.filter(e=>e.kind==='spread').length,0);assert.ok(result.events.some(e=>e.kind==='extinguishing'&&e.cause==='rain'));
 assert.deepEqual(parseBuildingConflagration(copy(result.state)),result.state);
});

test('wind increases downwind heating using actual bounded building distances',()=>{
 const c=catalogue([-8,0,8]),root=building(0,c),east=building(8,c),west=building(-8,c);
 const positive=stepBuildingConflagration(initial(c),{absoluteMinute:5,damageOutcome:outcome(0,0,root),weather:weather(0,5,0,1000)}).state;
 const negative=stepBuildingConflagration(initial(c),{absoluteMinute:5,damageOutcome:outcome(0,0,root),weather:weather(0,5,0,-1000)}).state;
 assert.ok(record(positive,east).heat>record(positive,west).heat);assert.ok(record(negative,west).heat>record(negative,east).heat);
 assert.equal(record(positive,root).fuelRemaining,record(negative,root).fuelRemaining);
});

test('an actual timestamped bucket receipt extinguishes once, without credit from elapsed time or named residents',()=>{
 const first=stepBuildingConflagration(initial(),{absoluteMinute:1,damageOutcome:outcome(),firefighting:[delivery(0)],weather:weather(0,1)});
 assert.equal(record(first.state).phase,'extinguished');assert.equal(record(first.state).extinguishedAtMinute,0);assert.equal(record(first.state).fuelRemaining,1200);
 assert.deepEqual(first.events.map(e=>e.kind),['ignition','extinguishing']);
 const loaded=parseBuildingConflagration(copy(first.state)),same=stepBuildingConflagration(loaded,{absoluteMinute:1,damageOutcome:outcome(),firefighting:[delivery(0)]});
 assert.equal(same.state,loaded);assert.deepEqual(same.events,[]);assert.equal(same.state.deliveryIds.length,1);
 const unhelped=stepBuildingConflagration(initial(),{absoluteMinute:20,damageOutcome:outcome(),weather:weather(0,20)}).state;
 assert.equal(unhelped.deliveryIds.length,0);assert.equal(record(unhelped).repairLabour,0);assert.equal(record(unhelped).repairTimber,0);
});

test('renaming a delivery cannot credit the same resident operation twice, including after save/load',()=>{
 const bucket=delivery(0,'bucket-small',10),first=stepBuildingConflagration(initial(),{absoluteMinute:0,damageOutcome:outcome(),firefighting:[bucket]}).state;
 assert.equal(record(first).intensity,560);
 const loaded=parseBuildingConflagration(copy(first)),replayed=stepBuildingConflagration(loaded,{absoluteMinute:0,firefighting:[{...bucket,id:'renamed-bucket'}]});
 assert.equal(replayed.state,loaded);assert.equal(record(replayed.state).intensity,560);assert.equal(replayed.state.deliveryIds.length,1);assert.equal(replayed.state.operationIds.length,1);
 const independent=stepBuildingConflagration(loaded,{absoluteMinute:0,firefighting:[{...bucket,id:'independent-bucket',residentId:'source-resident-2'}]});assert.equal(record(independent.state).intensity,520);
});

test('repairs require explicit full material and local work receipts, then restore fuel only at the completion minute',()=>{
 const ruined=stepBuildingConflagration(initial(),{absoluteMinute:100,damageOutcome:outcome(),weather:weather(0,100)}).state;
 const partial=stepBuildingConflagration(ruined,{absoluteMinute:101,repairs:[repair(100,'repair-a'),repair(101,'repair-b')]}).state;
 assert.equal(record(partial).phase,'charred');assert.equal(record(partial).repairLabour,120);assert.equal(record(partial).repairTimber,8);
 const waiting=stepBuildingConflagration(partial,{absoluteMinute:200}).state;assert.equal(record(waiting).repairLabour,120);assert.equal(record(waiting).phase,'charred');
 const complete=stepBuildingConflagration(waiting,{absoluteMinute:200,repairs:[repair(200,'repair-c')]}),b=record(complete.state);
 assert.equal(b.phase,'sound');assert.equal(b.fuelRemaining,1200);assert.equal(b.structuralDamage,0);assert.equal(b.rebuiltAtMinute,200);assert.equal(complete.events[0].kind,'repaired');
 assert.equal(record(complete.state,building(8)).phase,'charred','A local delivery never repairs another nearby building.');
 const reburn=stepBuildingConflagration(complete.state,{absoluteMinute:200,damageOutcome:outcome(1,200)});assert.equal(record(reburn.state).phase,'burning');assert.equal(reburn.events[0].kind,'ignition');
 assert.deepEqual(parseBuildingConflagration(copy(complete.state)),complete.state);
});

test('a repair receipt during a live fire consumes its identity but cannot earn progress',()=>{
 const result=stepBuildingConflagration(initial(),{absoluteMinute:1,damageOutcome:outcome(),repairs:[repair(0,'unsafe-work')],weather:weather(0,1)});
 assert.equal(record(result.state).phase,'burning');assert.equal(record(result.state).repairLabour,0);assert.equal(record(result.state).repairTimber,0);assert.deepEqual(result.state.deliveryIds,['unsafe-work']);
});

test('whole, saved slices and bounded offline catchup preserve every event, clock, source, receipt and condition',()=>{
 const input={absoluteMinute:120,damageOutcome:outcome(),weather:weather(0,120),firefighting:[delivery(14,'bucket-other',70,building(8))],repairs:[repair(100,'repair-a'),repair(101,'repair-b'),repair(102,'repair-c')]};
 const whole=stepBuildingConflagration(initial(),{...input,maxMinutes:1440});
 let pumped=stepBuildingConflagration(initial(),{...input,maxMinutes:7}),events=[...pumped.events];
 while(pumped.remainingMinutes){pumped=stepBuildingConflagration(parseBuildingConflagration(copy(pumped.state),WORLD),{absoluteMinute:120,maxMinutes:7});events.push(...pumped.events);}
 assert.deepEqual(pumped.state,whole.state);assert.deepEqual(events,whole.events);
 let slices=initial();const slicedEvents=[];for(let minute=0;minute<=120;minute++){
  const step=stepBuildingConflagration(parseBuildingConflagration(copy(slices)),{absoluteMinute:minute,damageOutcome:minute===0?outcome():undefined,weather:minute<120?weather(minute,minute+1):[],firefighting:input.firefighting.filter(d=>d.atMinute===minute),repairs:input.repairs.filter(d=>d.atMinute===minute)});slices=step.state;slicedEvents.push(...step.events);
 }
 assert.deepEqual(slices,whole.state);assert.deepEqual(slicedEvents,whole.events);
});

test('replayed raid receipts cannot reburn a repaired structure or refill spent local resources',()=>{
 let s=stepBuildingConflagration(initial(),{absoluteMinute:50,damageOutcome:outcome(),weather:weather(0,50)}).state;
 s=stepBuildingConflagration(s,{absoluteMinute:52,repairs:[repair(50,'repair-a'),repair(51,'repair-b'),repair(52,'repair-c')]}).state;
 const duplicate=stepBuildingConflagration(s,{absoluteMinute:52,damageOutcome:outcome(),repairs:[repair(50,'repair-a')]});assert.equal(duplicate.state,s);assert.deepEqual(duplicate.events,[]);assert.equal(record(s).phase,'sound');
});

test('unbound, wrong-source and genuinely late legacy outcomes are retained verbatim without guessing a building',()=>{
 const foreignBinding={...building(0).binding,sourceSha256:'9'.repeat(64)};
 for(const o of[{...outcome(),worldKey:null,binding:null},{...outcome(),binding:foreignBinding}]){
  const result=stepBuildingConflagration(initial(),{absoluteMinute:0,damageOutcome:o});assert.equal(result.events.length,0);assert.ok(result.state.buildings.every(b=>b.phase==='sound'));assert.deepEqual(result.state.retainedOutcomes[0].outcome,o);
  const saved=parseBuildingConflagration(copy(result.state));assert.deepEqual(saved,result.state);assert.equal(stepBuildingConflagration(saved,{absoluteMinute:0,damageOutcome:o}).state,saved);
 }
 const late=stepBuildingConflagration(initial(sources,100),{absoluteMinute:100,damageOutcome:outcome()});assert.equal(late.events.length,0);assert.equal(late.state.retainedOutcomes[0].reason,'late');assert.deepEqual(late.state.retainedOutcomes[0].outcome,outcome());
});

test('source key, world and contact failures preserve the old immutable state',()=>{
 const s=initial(),before=JSON.stringify(s),d=delivery(0);
 for(const change of[(v:any)=>v.worldKey='foreign',(v:any)=>v.binding.profile='quest',(v:any)=>v.proof.sourceSha256='9'.repeat(64),(v:any)=>v.proof.contactMinute=1,(v:any)=>v.proof.arrivalId='',(v:any)=>v.water=0]){
  const wrong=copy(d);change(wrong);assert.throws(()=>stepBuildingConflagration(s,{absoluteMinute:1,firefighting:[wrong]}));
 }
 assert.throws(()=>stepBuildingConflagration(s,{absoluteMinute:0,damageOutcome:{...outcome(),worldKey:'foreign'}}),/another world/);
 assert.throws(()=>stepBuildingConflagration(s,{absoluteMinute:0,firefighting:[delivery(1)]}),/before arrival/);
 assert.throws(()=>stepBuildingConflagration(initial(sources,2),{absoluteMinute:2,firefighting:[delivery(1)]}),/backdated/);
 assert.equal(JSON.stringify(s),before);assert.ok(Object.isFrozen(s.catalogue[0].bounds.min));assert.ok(Object.isFrozen(s.buildings[0]));
});

test('historical natural weather comes from the existing world sampler and overrides never extrapolate a frame',()=>{
 for(const minute of[0,239,240,279,10000]){const w=sampleBuildingConflagrationWeather(WORLD,minute),source=sampleWorldEnvironment({absoluteWorldMinute:minute,dayIndex:Math.floor(minute/1440),dayMinute:minute%1440,fractionalMinute:0,elapsedWorldMinutes:0,deferredMilliseconds:0},WORLD);assert.equal(w.rain,Math.round(source.rain*1000));assert.equal(w.windX,Math.round(source.wind[0]*source.windStrength*1000));}
 const a=stepBuildingConflagration(initial(),{absoluteMinute:20,damageOutcome:outcome()}),b=stepBuildingConflagration(initial(),{absoluteMinute:20,damageOutcome:outcome(),weather:Array.from({length:20},(_,i)=>sampleBuildingConflagrationWeather(WORLD,i))});
 assert.deepEqual(a.state.buildings,b.state.buildings);assert.deepEqual(a.events,b.events);
 const isolated=stepBuildingConflagration(initial(),{absoluteMinute:20,damageOutcome:outcome(),weather:weather(0,1,1000)}),persistent=stepBuildingConflagration(initial(),{absoluteMinute:20,damageOutcome:outcome(),weather:weather(0,20,1000)});
 assert.notEqual(record(isolated.state).phase,record(persistent.state).phase);
});

test('source catalogue comparison holds different profiles, source coordinates, hashes and ambiguous duplicate identities',()=>{
 const s=initial();assert.equal(matchesBuildingConflagrationCatalogue(s,copy(sources.buildings)),true);
 for(const change of[(b:any)=>b.binding.sourceSha256='8'.repeat(64),(b:any)=>b.binding.profile='quest',(b:any)=>b.position[0]+=.1]){const wrong=copy(sources.buildings);change(wrong[0]);assert.equal(matchesBuildingConflagrationCatalogue(s,wrong),false);}
 assert.throws(()=>createBuildingConflagration({worldKey:WORLD,absoluteMinute:0,seed:'test',buildings:[sources.buildings[0],sources.buildings[0]]}),/Duplicate/);
 assert.throws(()=>createBuildingConflagration({worldKey:WORLD,absoluteMinute:0,seed:'test',buildings:Array.from({length:513},(_,i)=>({...sources.buildings[0],binding:{...sources.buildings[0].binding,buildingId:`fixture-${i}`,siteIndex:i}}))}),/capacity/);
});

test('finite catchup returns deferred minutes without skipping time, and command-only polls do not burn fuel',()=>{
 const result=stepBuildingConflagration(initial(),{absoluteMinute:1_000_000_000,damageOutcome:outcome()});assert.equal(result.processedMinutes,240);assert.equal(result.remainingMinutes,1_000_000_000-240);assert.equal(result.state.absoluteMinute,240);
 const zero=stepBuildingConflagration(initial(),{absoluteMinute:0,damageOutcome:outcome()});assert.equal(record(zero.state).fuelRemaining,1200);assert.equal(zero.processedMinutes,0);
 assert.equal(stepBuildingConflagration(zero.state,{absoluteMinute:0}).state,zero.state);assert.throws(()=>stepBuildingConflagration(result.state,{absoluteMinute:239}));
 for(const maxMinutes of[0,1441,Infinity])assert.throws(()=>stepBuildingConflagration(initial(),{absoluteMinute:100,maxMinutes}));
 const at=initial(sources,1000);assert.equal(stepBuildingConflagration(at,{absoluteMinute:1000,damageOutcome:outcome()}).events.length,0,'A newly installed reducer cannot replay old damage as a new blaze.');
});

test('pending raid receipts preserve chronological serials across saves instead of rebinding or dropping earlier incidents',()=>{
 const future=stepBuildingConflagration(initial(),{absoluteMinute:600,maxMinutes:1,damageOutcome:outcome(0,500)}).state;assert.equal(future.pending.length,1);assert.deepEqual(parseBuildingConflagration(copy(future)),future);
 const second=stepBuildingConflagration(future,{absoluteMinute:600,maxMinutes:1,damageOutcome:outcome(1,550,building(200))}).state;assert.equal(second.pending.length,2);assert.deepEqual(parseBuildingConflagration(copy(second)),second);
 const before=JSON.stringify(second);assert.throws(()=>stepBuildingConflagration(second,{absoluteMinute:600,damageOutcome:outcome(2,0)}),/late raid/);assert.equal(JSON.stringify(second),before);
 const corrupt=copy(second)as any;corrupt.pending[1].value.raidId='raid-550-0';assert.throws(()=>parseBuildingConflagration(corrupt));
});

test('receipt, unknown-history and caller collection capacities hold the old state without eviction',()=>{
 const full=copy(initial())as any;full.deliveryIds=Array.from({length:8192},(_,i)=>`previous-${i}`);full.operationIds=Array.from({length:8192},(_,i)=>JSON.stringify(['previous-resident',`operation-${i}`]));
 const s=parseBuildingConflagration(full),before=JSON.stringify(s);assert.throws(()=>stepBuildingConflagration(s,{absoluteMinute:0,firefighting:[delivery(0)]}),/capacity/);assert.equal(JSON.stringify(s),before);
 const retained=copy(initial())as any;retained.lastRaidSerial=511;retained.retainedOutcomes=Array.from({length:512},(_,i)=>({reason:'unbound',outcome:{...outcome(i),worldKey:null,binding:null}}));const history=parseBuildingConflagration(retained);
 assert.throws(()=>stepBuildingConflagration(history,{absoluteMinute:0,damageOutcome:{...outcome(512),worldKey:null,binding:null}}),/capacity/);assert.equal(history.retainedOutcomes.length,512);
 assert.throws(()=>stepBuildingConflagration(initial(),{absoluteMinute:10000,weather:weather(0,4097)}),/collection budget/);
});

test('bounded adjacency never jumps distant geometry or unbounded dense catalogues',()=>{
 const c=catalogue([0,100]),s=stepBuildingConflagration(initial(c),{absoluteMinute:100,damageOutcome:outcome(0,0,building(0,c)),weather:weather(0,100)}).state;assert.equal(record(s,building(100,c)).phase,'sound');
 const dense:SourceBuilding[]=Array.from({length:40},(_,i)=>({...building(0),binding:{...building(0).binding,buildingId:`dense-${i}`,siteIndex:i},bounds:{min:[0,0,0],max:[1,1,1]},position:[.5,0,.5]}));
 const initialDense=createBuildingConflagration({worldKey:WORLD,absoluteMinute:0,seed:'dense',buildings:dense}),burn=stepBuildingConflagration(initialDense,{absoluteMinute:1,damageOutcome:outcome(0,0,dense[0]),weather:weather(0,1)});
 assert.ok(burn.state.buildings.filter(b=>b.heat>0).length<=BUILDING_CONFLAGRATION_RULES.maxNeighbours);
});

test('future, malformed, foreign and getter-bearing saves are held and future JSON remains intact',()=>{
 const burned=stepBuildingConflagration(initial(),{absoluteMinute:5,damageOutcome:outcome(),weather:weather(0,5)}).state;
 for(const edit of[(s:any)=>s.schemaVersion=2,(s:any)=>s.extra=1,(s:any)=>s.buildings[0].fuelRemaining=-1,(s:any)=>s.buildings[0].phase='unknown',(s:any)=>s.catalogue[0].binding.sourceSha256='bad',(s:any)=>s.deliveryIds=['x','x'],(s:any)=>s.buildings.push(s.buildings[0]),(s:any)=>s.lastRaidSerial=-1]){
  const raw=copy(burned);edit(raw);const restored=restoreBuildingConflagration(raw,WORLD);assert.equal(restored.status,'invalid');assert.deepEqual(serializeBuildingConflagrationRestore(restored),raw);
 }
 assert.equal(restoreBuildingConflagration(burned,'other-world').status,'invalid');
 let reads=0;const bad=copy(burned);Object.defineProperty(bad,'seed',{enumerable:true,get(){reads++;return'bad';}});assert.throws(()=>parseBuildingConflagration(bad));assert.equal(reads,0);
 const future={kind:'building-conflagration',schemaVersion:99,unknown:Array(10000).fill(1),deep:Array.from({length:40}).reduce<unknown>(v=>({next:v}),{})};const held=restoreBuildingConflagration(future);assert.equal(held.status,'invalid');assert.deepEqual(serializeBuildingConflagrationRestore(held),future);
});

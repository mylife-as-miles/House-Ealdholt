import test from 'node:test';
import assert from 'node:assert/strict';
import {EALDHOLT_VILLAGE_POPULATION as POPULATION,validateVillagePopulation,type VillagePopulation} from './village-population';
import {createVillageLife,advanceVillageLife} from './village-life';
import {createEaldholtVillageSite} from './village-site';
import {createVillageLifeNavigation,advanceVillageLifeNavigation} from './village-life-navigation';
import {createResidentRoutineActions,advanceResidentRoutineActions,summarizeResidentRoutineAction,type ResidentRoutineActionsInput,type ResidentRoutineActionPhysicalPort} from './resident-routine-actions';
import {parseResidentActionQueues,type ResidentActionQueues} from './resident-action-queue';
import {createResidentBuildingEmergency} from './resident-building-emergency';

const KEY='all-resident-routine-unit-world',A=POPULATION.residents[0].id,HOME=POPULATION.residents[0].homePlaceId,WORK=POPULATION.residents[0].workPlaceId;
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function population():VillagePopulation{
 const p=copy(POPULATION) as any;
 for(const person of p.residents){person.registry.routine=[{startMinute:0,endMinute:1440,activity:person.id===A?'Mends household tools.':'Asleep at home.',placeId:person.id===A?WORK:person.homePlaceId,companionIds:[]}];
  p.registry.residents.find((r:any)=>r.id===person.id).routine=copy(person.registry.routine);}
 assert.equal(validateVillagePopulation(p),null);return p;
}
/** Synthetic source-contract fixture only. No game model, workstation or
 * animation-clearance certification is claimed by these coordinates. */
function fixture(profile:'desktop'|'quest'='desktop'){
 const p=population(),sha=(profile==='desktop'?'a':'b').repeat(64),line=[[0,0,0],[0,0,3],[4,0,3]],body=line.map(v=>[v[0],.02,v[2]]);
 const route={from:'home',to:'work',reversible:true,sourceGroundPolyline:line,capsuleBottomPolyline:body,lengthMetres:7,corridorRefs:[1,2]};
 const site=createEaldholtVillageSite({profile,modelSha256:sha,binding:{schema:1,profile,sourceSha256:sha,frame:'source-root-local-metres',capsule:{height:1.8,radius:.28},
  anchors:{home:{sourceActor:'unit-house',sourceGroundPoint:line[0],capsuleBottomPoint:body[0],standingOnly:true},work:{sourceActor:'unit-forge',sourceGroundPoint:line[2],capsuleBottomPoint:body[2],standingOnly:true}},routes:{'unit-route':route}},
  certificate:{schema:1,profile,sourceSha256:sha,frame:'source-root-local-metres',capsule:{height:1.8,radius:.28},qualified:true,sourceOriginalBuffersUnchanged:true,capsuleClearanceMargin:.005,groundBoundaryRoundingMaxMetres:1e-8,
   routes:[{from:'home',to:'work',sourceGroundPolyline:line,capsuleBottomPolyline:body,lengthMetres:7,corridor:[1,2],partialPathAccepted:false,findPathStatus:1073741824,allSourceSolidEnvelopesClear:true,groundWholeFootprintSupported:true,waterAndInteriorsExcluded:true,groundEdgeClearanceLowerBound:2,slopeLipschitzUpperBound:0,capsuleBottomLiftMetres:.02}]},
  placeBindings:[],residentPlaceBindings:[{residentId:A,placeId:HOME,anchorId:'home',status:'mapped-exterior'},{residentId:A,placeId:WORK,anchorId:'work',status:'mapped-exterior'}]});
 const life=createVillageLife(p,0,KEY),intents=life.residents.map(r=>r.intent),home={...intents[0],targetPlaceId:HOME,indoor:false};
 let navigation=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site,intents:[home,...intents.slice(1)],metresPerWorldMinute:3});
 navigation=advanceVillageLifeNavigation(navigation,{absoluteMinute:0,site,intents,metresPerWorldMinute:3});
 return{population:p,life,navigation,site};
}
function input(f:ReturnType<typeof fixture>,minute:number,overrides:Partial<ResidentRoutineActionsInput>={}):ResidentRoutineActionsInput{
 const life=advanceVillageLife(f.life,f.population,minute),navigation=advanceVillageLifeNavigation(f.navigation,{absoluteMinute:minute,site:f.site,intents:life.residents.map(r=>r.intent),metresPerWorldMinute:3});
 return{worldKey:KEY,absoluteMinute:minute,population:f.population,life,navigation,site:f.site,...overrides};
}
function row(q:ResidentActionQueues){return q.residents.find(r=>r.residentId===A)!;}

test('all100 existing lives gain persistent ordinary commands without changing households, relationships or simulation-only leases',()=>{
 const f=fixture(),unbound=input(f,0,{site:null}),before=JSON.stringify(unbound.life),q=createResidentRoutineActions(unbound),held=advanceResidentRoutineActions(q,input(f,20,{site:null}));
 assert.equal(q.residents.length,100);assert.equal(new Set(q.residents.map(r=>r.residentId)).size,100);
 assert.deepEqual(q.residents.map(r=>r.residentId).sort(),POPULATION.residents.map(r=>r.id).sort());
 assert.ok(held.residents.every(r=>r.current==='approach'&&r.performedWorldMinutes===0&&r.wait?.reason==='source-unavailable'));
 assert.equal(JSON.stringify(unbound.life),before);assert.equal(unbound.life.households.length,25);
 assert.equal(held.residents[0].jobId,q.residents[0].jobId);assert.deepEqual(parseResidentActionQueues(JSON.stringify(held),{worldKey:KEY,residentIds:POPULATION.residents.map(r=>r.id),maximumMinute:20}),held);
});

test('real navigation arrival advances only approach; an abstract life reservation never qualifies a workstation',()=>{
 const f=fixture(),initial=input(f,0),q=createResidentRoutineActions(initial),walking=advanceResidentRoutineActions(q,input(f,1));
 assert.equal(row(walking).current,'approach');assert.equal(row(walking).wait?.reason,'approach-pending');
 const reached=input(f,3),arrival=reached.navigation.residents.find(r=>r.residentId===A)!;
 assert.equal(arrival.arrivalEvidence,'certified-route-arrival');assert.equal(arrival.arrivedAtAbsoluteMinute,7/3);
 let next=advanceResidentRoutineActions(walking,reached);assert.equal(row(next).current,'reserve');
 next=advanceResidentRoutineActions(next,input(f,4));assert.equal(row(next).wait?.reason,'workstation-unqualified');
 assert.equal(row(next).performedWorldMinutes,0);assert.equal(row(next).proof.leaseId,null);assert.equal(summarizeResidentRoutineAction(row(next)).blockedReason,'workstation-unqualified');
 const before=JSON.stringify(next);assert.deepEqual(advanceResidentRoutineActions(next,input(f,4)),next);assert.equal(JSON.stringify(next),before);
});

test('profile selection takes navigationOther when its exact source matches, without borrowing the foreign source cursor',()=>{
 const desktop=fixture(),quest=fixture('quest'),i=input(quest,0),d=input(desktop,0);
 const q=createResidentRoutineActions({...i,navigation:d.navigation,navigationOther:i.navigation});assert.equal(q.source?.profile,'quest');assert.equal(q.source?.sha256,quest.site.sourceSha256);
 const wrong=createResidentRoutineActions({...i,navigation:d.navigation,navigationOther:null});assert.equal(wrong.source,null);
 const reached=advanceResidentRoutineActions(q,{...input(quest,3),navigation:input(desktop,3).navigation,navigationOther:input(quest,3).navigation});assert.equal(row(reached).current,'reserve');
 const bound=createResidentRoutineActions(d),held=advanceResidentRoutineActions(bound,{...input(quest,3),navigation:input(desktop,3).navigation,navigationOther:input(quest,3).navigation});
 assert.equal(row(held).current,'approach');assert.equal(row(held).wait?.reason,'source-changed');assert.equal(held.source?.profile,'desktop');
});

test('safety, weather and building duties suspend ordinary jobs before invoking any physical provider and preserve them through reload',()=>{
 for(const reason of ['safety','weather','emergency'] as const){
  const f=fixture(),q=createResidentRoutineActions(input(f,0)),ready=advanceResidentRoutineActions(q,input(f,3)),i=input(f,4),own=i.life.residents.find(r=>r.residentId===A)!;
  const life={...i.life,residents:i.life.residents.map(r=>r.residentId!==A?r:{...r,suspendedIntent:r.intent,intent:{...r.intent,activityKey:'shelter' as const,activity:'Takes shelter.',targetPlaceId:HOME,reason:reason==='emergency'?'routine' as const:reason,issuedAbsoluteMinute:4}})};
  let calls=0;const physical:ResidentRoutineActionPhysicalPort={observe(c){if(c.residentId===A)calls++;return null;}};
  const buildingEmergency=reason==='emergency'?{...createResidentBuildingEmergency(KEY,4),duties:[{residentId:A,incidentId:'unit-fire',issuedAbsoluteMinute:4} as any]}:undefined;
  const paused=advanceResidentRoutineActions(ready,{...i,life,physical,...(buildingEmergency?{buildingEmergency}:{})});
  assert.equal(row(paused).interruption?.reason,reason);assert.equal(row(paused).jobId,row(ready).jobId);assert.deepEqual(row(paused).goal,row(ready).goal);assert.equal(calls,0);
  const saved=parseResidentActionQueues(JSON.stringify(paused),{worldKey:KEY,residentIds:POPULATION.residents.map(r=>r.id)}),resumed=advanceResidentRoutineActions(saved,input(f,5));
  assert.equal(row(resumed).jobId,row(ready).jobId);assert.equal(row(resumed).current,'reserve','The current exclusive source stand is revalidated; no old physical lease is restored.');assert.equal(row(resumed).proof.leaseId,null);assert.equal(row(resumed).performedWorldMinutes,0);assert.equal(own.residentId,A);
 }
});

test('ordinary goal invalidation creates a new job while preserving all other lives and never transfers a physical proof',()=>{
 const f=fixture(),q=advanceResidentRoutineActions(createResidentRoutineActions(input(f,0)),input(f,3)),i=input(f,4);
 const life={...i.life,residents:i.life.residents.map(r=>r.residentId!==A?r:{...r,intent:{...r.intent,targetPlaceId:HOME,activity:'Returns home.',activityKey:'home' as const,issuedAbsoluteMinute:4}})};
 const next=advanceResidentRoutineActions(q,{...i,life});assert.notEqual(row(next).jobId,row(q).jobId);assert.equal(row(next).current,'approach');assert.equal(row(next).proof.arrivalId,null);assert.equal(row(next).performedWorldMinutes,0);
 assert.deepEqual(next.residents.filter(r=>r.residentId!==A).map(r=>r.goal),q.residents.filter(r=>r.residentId!==A).map(r=>r.goal));
});

test('a separate source-qualified physical port is required for facing, continuous work and release; output is reload deterministic',()=>{
 const f=fixture();let q=createResidentRoutineActions(input(f,0));const beforeLife=JSON.stringify(input(f,12).life);
 const physical:ResidentRoutineActionPhysicalPort={observe(c){if(c.residentId!==A||!c.queue)return null;const stationId='unit-physical-anvil',leaseId='unit-physical-lease',base={residentId:A,source:c.source},minute=c.absoluteMinute,jobId=c.queue.jobId;
  return{station:{...base,id:stationId,placeId:WORK,anchorId:'work',clip:'work_hammer',certificateSha256:'c'.repeat(64),durationWorldMinutes:2,proof:{originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:'unit-anvil'}},
   lease:{...base,id:leaseId,jobId,stationId,sinceMinute:4,untilMinute:100},facing:{...base,id:'unit-facing',jobId,stationId,leaseId,atMinute:5,sourcePoseQualified:true},
   contacts:minute>=6?[{...base,id:'unit-contact-'+minute,jobId,stationId,leaseId,atMinute:minute,sequence:minute,clip:'work_hammer',markerId:'unit-strike',contactSourceActor:'unit-anvil',contactQualified:true}]:[],
   releases:minute>=9?[{...base,id:'unit-release',jobId,stationId,leaseId,atMinute:minute}]:[],invalidatedTarget:false};}};
 // Do not expose future physical leases/facing observations to earlier phases.
 for(let minute=3;minute<=9;minute++){
  const provider=minute<4?undefined:{observe(c:Parameters<ResidentRoutineActionPhysicalPort['observe']>[0]){const p=physical.observe(c);return p?{...p,facing:minute<5?null:p.facing}:null;}};
  const i=input(f,minute,{physical:provider}),saved=parseResidentActionQueues(JSON.stringify(q));
  const a=advanceResidentRoutineActions(q,i),b=advanceResidentRoutineActions(saved,i);assert.deepEqual(a,b);q=a;
 }
 assert.equal(row(q).current,null);assert.equal(row(q).performedWorldMinutes,2);assert.equal(row(q).completedAtMinute,9);
 assert.ok(q.residents.filter(r=>r.residentId!==A).every(r=>r.performedWorldMinutes===0));assert.equal(JSON.stringify(input(f,12).life),beforeLife,'Physical receipts do not mutate abstract household counters.');
});

test('source selection rejects stale navigation revisions and stale selected navigationOther clock boundaries',()=>{
 const f=fixture(),i=input(f,3),changed=Object.freeze({...f.site,navigationRevision:'changed-source-bindings'});let calls=0;
 const physical:ResidentRoutineActionPhysicalPort={observe(){calls++;return null;}};
 const q=createResidentRoutineActions({...i,site:changed,physical});assert.equal(q.source,null);assert.equal(calls,0);assert.equal(row(q).wait?.reason,'source-unavailable');
 const quest=fixture('quest'),main=input(f,3),other=input(quest,2);assert.throws(()=>createResidentRoutineActions({...input(quest,3),navigation:main.navigation,navigationOther:other.navigation}),/current life minute/);
});

test('authoritative family-care resume retains its job and wait lineage, while a later independent obligation to the same child and home gets a new job',()=>{
 const f=fixture(),child=POPULATION.residents[2].id,conditionsAt=()=>({weather:'clear' as const,daylight:1,careNeededResidentIds:[child]});
 let life=advanceVillageLife(f.life,f.population,1,{conditionsAt}),navigation=advanceVillageLifeNavigation(f.navigation,{absoluteMinute:1,site:null,intents:life.residents.map(r=>r.intent),metresPerWorldMinute:3});
 const current=():ResidentRoutineActionsInput=>({worldKey:KEY,absoluteMinute:life.absoluteMinute,population:f.population,life,navigation,site:null});
 let q=createResidentRoutineActions(current());const job=row(q).jobId,initialGoal=row(q).goal;
 assert.equal(life.residents[0].intent.reason,'family-care');assert.ok(initialGoal.lineage?.includes(child));
 const signal={id:'unit-family-raid',kind:'violence' as const,channel:'report' as const,knownByResidentIds:[A],placeId:WORK,observedAbsoluteMinute:2,expiresAbsoluteMinute:4,affectedResidentIds:[A],shelterPlaceId:HOME};
 const tick=(minute:number,care=true)=>{life=advanceVillageLife(life,f.population,minute,{conditionsAt:()=>({weather:'clear',daylight:1,...(care?{careNeededResidentIds:[child]}:{})}),safetySignalsAt:m=>m>=2&&m<4?[signal]:[]});navigation=advanceVillageLifeNavigation(navigation,{absoluteMinute:minute,site:null,intents:life.residents.map(r=>r.intent),metresPerWorldMinute:3});q=advanceResidentRoutineActions(parseResidentActionQueues(JSON.stringify(q)),current());};
 tick(2);const paused=row(q);assert.equal(paused.interruption?.reason,'safety');assert.equal(paused.jobId,job);assert.deepEqual(paused.goal,initialGoal);
 tick(3);assert.deepEqual(row(q).wait,paused.wait);assert.equal(row(q).waitToken,paused.waitToken);
 tick(4);assert.equal(life.residents[0].intent.reason,'family-care');assert.ok(life.journal.some(e=>e.kind==='duty-resumed'&&e.atMinute===4&&e.actorIds.includes(A)));
 assert.equal(row(q).jobId,job);assert.equal(row(q).goal.key,initialGoal.key);assert.equal(row(q).goal.issuedAbsoluteMinute,4);assert.equal(row(q).goal.lineage,initialGoal.lineage);assert.equal(row(q).performedWorldMinutes,0);
 tick(5);assert.equal(row(q).jobId,job,'Continuing the resumed intent no longer depends on its journal entry.');
 tick(6,false);assert.equal(life.residents[0].intent.reason,'routine');tick(7,true);
 assert.equal(life.residents[0].intent.reason,'family-care');assert.equal(life.residents[0].intent.targetPlaceId,HOME);assert.deepEqual(life.residents[0].intent.companionIds,[child]);
 assert.notEqual(row(q).jobId,job);assert.notEqual(row(q).goal.key,initialGoal.key);assert.equal(row(q).goal.issuedAbsoluteMinute,7);assert.equal(row(q).performedWorldMinutes,0);
});

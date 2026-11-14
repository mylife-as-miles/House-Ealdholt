import test from 'node:test';import assert from 'node:assert/strict';
import {nightlyRaidMinute} from './bandit-raid';
import {planObserverNightlyRaids,restoreObserverRaidCursor,serializeObserverRaidCursor,type ObserverRaidCursorRestore} from './observer-raid-cursor';
const key='nightly-cursor-world';
const cursor=(at:number):ObserverRaidCursorRestore=>({status:'valid',state:{kind:'observer-raid-cursor',schemaVersion:1,worldKey:key,resolvedMinute:at}});
test('legacy adoption anchors at the current authoritative minute with no historical raid or clock reset',()=>{
 const at=400*1440+800,plan=planObserverNightlyRaids({worldKey:key,targetMinute:at,damageMinute:at-60});
 assert.equal(plan.status,'migrated');assert.equal(plan.fromMinute,at);assert.equal(plan.processedMinute,at);assert.deepEqual(plan.due,[]);assert.equal(plan.pendingMinutes,0);assert.equal(plan.cursor?.status,'valid');
 if(plan.cursor?.status==='valid')assert.equal(plan.cursor.state.resolvedMinute,at);
});
test('bounded chunks preserve every future nightly candidate across saves and midnight spill without flooding or repeating',()=>{
 const from=1440+700,target=90*1440+600,expected=[];
 for(let day=1;day<=90;day++){const at=nightlyRaidMinute(key,day);if(at!==null&&at>from&&at<=target)expected.push({day,minute:at});}
 let current=cursor(from),processed=from,polls=0;const actual:{day:number;minute:number}[]=[];
 while(processed<target){const plan=planObserverNightlyRaids({worldKey:key,targetMinute:target,cursor:current,damageMinute:processed,maximumDays:2});assert.equal(plan.status,'ready');assert.ok(plan.processedMinute>processed);assert.ok(plan.due.length<=3);assert.ok(plan.processedMinute-processed<=2*1440);assert.equal(plan.pendingMinutes,target-plan.processedMinute);actual.push(...plan.due);processed=plan.processedMinute;current=restoreObserverRaidCursor(JSON.parse(JSON.stringify(serializeObserverRaidCursor(plan.cursor!))),key);assert.ok(++polls<60);}
 assert.deepEqual(actual,expected);assert.ok(actual.length>3);assert.equal(new Set(actual.map(row=>row.day)).size,actual.length);
 const repeat=planObserverNightlyRaids({worldKey:key,targetMinute:target,cursor:current,damageMinute:target});assert.equal(repeat.processedMinute,target);assert.deepEqual(repeat.due,[]);assert.equal(repeat.pendingMinutes,0);
});
test('a previous-night candidate after midnight is considered exactly once',()=>{
 let selected:{day:number;minute:number}|null=null;for(let day=1;day<200;day++){const at=nightlyRaidMinute(key,day);if(at!==null&&at>=(day+1)*1440){selected={day,minute:at};break;}}
 assert.ok(selected);const from=(selected.day+1)*1440-1;
 const plan=planObserverNightlyRaids({worldKey:key,targetMinute:selected.minute,cursor:cursor(from),damageMinute:from,maximumDays:1});assert.ok(plan.due.some(row=>row.day===selected.day&&row.minute===selected.minute));
 assert.deepEqual(planObserverNightlyRaids({worldKey:key,targetMinute:selected.minute,cursor:plan.cursor,damageMinute:selected.minute}).due,[]);
});
test('invalid and foreign records stay preserved; future damage/cursor time explicitly blocks reconciliation',()=>{
 for(const raw of[{kind:'future-schema',schemaVersion:2,future:{retained:true}},{kind:'observer-raid-cursor',schemaVersion:1,worldKey:'another',resolvedMinute:900}]){
  const restored=restoreObserverRaidCursor(raw,key);assert.equal(restored.status,'invalid');assert.deepEqual(serializeObserverRaidCursor(restored),raw);
  const held=planObserverNightlyRaids({worldKey:key,targetMinute:1000,cursor:restored});assert.equal(held.status,'blocked');assert.equal(held.cursor,restored);assert.deepEqual(held.due,[]);
 }
 assert.equal(planObserverNightlyRaids({worldKey:key,targetMinute:1000,damageMinute:1001}).status,'blocked');
 assert.equal(planObserverNightlyRaids({worldKey:key,targetMinute:1200,cursor:cursor(1000),damageMinute:1100}).status,'blocked');
 assert.equal(planObserverNightlyRaids({worldKey:key,targetMinute:999,cursor:cursor(1000)}).status,'blocked');
 assert.equal(planObserverNightlyRaids({worldKey:key,targetMinute:1200,cursor:cursor(1000),damageMinute:900}).status,'ready');
});
test('planning has no input mutation; malformed/unsafe times and getters cannot create work',()=>{
 const input={worldKey:key,targetMinute:8000,cursor:cursor(4000),damageMinute:4000},before=JSON.stringify(input);planObserverNightlyRaids(input);assert.equal(JSON.stringify(input),before);
 for(const targetMinute of[-1,.5,Infinity,NaN,Number.MAX_SAFE_INTEGER])assert.equal(planObserverNightlyRaids({...input,targetMinute}).status,'blocked');
 for(const maximumDays of[0,-1,.5,17,Infinity])assert.equal(planObserverNightlyRaids({...input,maximumDays}).status,'blocked');
 let reads=0;const raw={get schemaVersion(){reads++;return 1;}};const restored=restoreObserverRaidCursor(raw,key);assert.equal(restored.status,'invalid');assert.equal(reads,0);assert.throws(()=>serializeObserverRaidCursor(restored));assert.equal(reads,0);
});

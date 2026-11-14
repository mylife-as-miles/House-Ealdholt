/** World-level, actual-source allocation regressions. No original stored file
 * is written, and none of these controlled clocks are browser pose evidence. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';
import {EALDHOLT_VILLAGE_POPULATION as POPULATION} from './village-population';
import {createEaldholtVillageSite,type VillageSiteLayout} from './village-site';
import {createVillagePopulationRuntime,advanceVillagePopulationRuntime,createVillagePopulationObserver,parseVillagePopulationRuntime,serializeVillagePopulationRuntime,sampleVillagePopulationRuntime,type VillagePopulationRuntime,type VillagePopulationRuntimeResult} from './village-population-runtime';
const DIR='/workspace/private-assets/crownfall/fresh-lane-patrol-v4-paired-2026-11-11',UNPAIRED='/workspace/private-assets/crownfall/fresh-lane-patrol-v3-2026-11-11';
const FILES={desktop:`${DIR}/desktop-guard-lane-patrol-v1.json`,quest:`${DIR}/quest-guard-lane-patrol-v1.json`,legacyDesktop:'/workspace/private-assets/crownfall/new-motion-evidence-2026-11-11/fresh-candidate-integration-v4-release-ready/desktop-fresh-commute-sites.json',legacyQuest:'/workspace/private-assets/crownfall/new-quest-tall-authoring-2026-11-11-01/motion-integration/quest-fresh-commute-sites.json'};
const EXPORTS=[['/workspace/private-assets/crownfall/task-v4-readonly-export-2026-11-11/saved-v4.json','1ab992ca5c3d45c0797d52478ac9316f46a2f04c305849bc8595562b2c47388f'],['/workspace/private-assets/crownfall/runtime-export-bound-fresh-2026-11-11-1794418478120/population-0.json','6127961eb6daadd540289ec0783d5cc729bbd878e70a0dba65e81bb80ca9477a']] as const;
const ready=Object.values(FILES).every(existsSync),skip=!ready&&'Requires both exact paired/private source profiles and original v4 sites.';
const accept=(r:VillagePopulationRuntimeResult):VillagePopulationRuntime=>{assert.ok(r.ok,r.ok?'':r.error);return r.snapshot;};
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function rawSite(raw:any){return createEaldholtVillageSite({profile:raw.binding.profile,modelSha256:raw.binding.sourceSha256,binding:raw.binding,certificate:raw.certificate,placeBindings:raw.placeBindings,residentPlaceBindings:raw.residentPlaceBindings});}
const cache=new Map<string,VillageSiteLayout>();
function site(key:keyof typeof FILES){let s=cache.get(key);if(!s){s=rawSite(JSON.parse(readFileSync(FILES[key],'utf8')));cache.set(key,s);}return s;}
function encoded(s:VillagePopulationRuntime){const r=serializeVillagePopulationRuntime(s);assert.ok(r.ok);return r.json;}
function restored(s:VillagePopulationRuntime){return accept(parseVillagePopulationRuntime(encoded(s),{worldKey:s.worldKey,contentRevision:s.contentRevision}));}
function fresh(){return accept(createVillagePopulationRuntime({population:POPULATION,confirmedEntry:true,worldKey:'patrol-allocation-integration-test',contentRevision:'patrol-allocation-tests',createdAt:1800000000000,initialDayMinute:540,millisecondsPerWorldMinute:4000,walkingSpeedMetresPerSecond:.8}));}
function step(s:VillagePopulationRuntime,minutes:number,where:VillageSiteLayout|null){return accept(advanceVillagePopulationRuntime(s,{expectedGeneration:s.generation,worldKey:s.worldKey,contentRevision:s.contentRevision,observedAt:Math.max(s.clock.lastObservedAt,s.clock.createdAt+s.clock.simulatedElapsedMilliseconds+minutes*s.clock.millisecondsPerWorldMinute),maxAdvanceMinutes:Math.max(1,minutes),site:where}));}
function held(s:VillagePopulationRuntime,where:VillageSiteLayout|null){const sample=sampleVillagePopulationRuntime(s,where);assert.equal(sample.navigationAuthority,'resident-life');assert.ok(sample.residents.every(r=>r.position===null&&!r.presentable&&!r.patrol&&!r.waitingForResource&&r.navigationReason==='source-site-changed'));}
function sameCursors(before:VillagePopulationRuntime,after:VillagePopulationRuntime){
 assert.equal(after.navigation.profile,before.navigation.profile);assert.equal(after.navigation.sourceSha256,before.navigation.sourceSha256);assert.equal(after.navigation.siteIdentity,before.navigation.siteIdentity);assert.deepEqual(after.navigation.navigationAllocation,before.navigation.navigationAllocation);
 assert.equal(!!after.navigationOther,!!before.navigationOther,'a refused first profile cannot bootstrap another cursor');
 for(const [old,now]of [[before.navigation,after.navigation],[before.navigationOther,after.navigationOther]] as const){if(!old||!now)continue;assert.equal(now.profile,old.profile);assert.equal(now.sourceSha256,old.sourceSha256);assert.deepEqual(now.navigationAllocation,old.navigationAllocation);
  for(const prior of old.residents){const row=now.residents.find(r=>r.residentId===prior.residentId)!;for(const key of ['anchorPosition','route','progressMetres','sourceSha256','sourceSiteIdentity','arrivalEvidence','arrivedAtAbsoluteMinute'] as const)assert.deepEqual(row[key],prior[key],`${prior.residentId}:${key}`);}
 }
}
function parked(before:VillagePopulationRuntime['navigation'],after:VillagePopulationRuntime['navigation']){
 const omitAvailability=(nav:VillagePopulationRuntime['navigation'])=>({...nav,residents:nav.residents.map(({reason:_reason,...r})=>r)});
 // The inactive profile truthfully reports site-unavailable. Every source,
 // position, arrival, route, phase and world-clock cursor stays unchanged.
 assert.deepEqual(omitAvailability(after),omitAvailability(before));
}
test('both exact legacy Desktop exports reject first-use paired Quest for sixty ordinary minutes without migration or schedule fallback',{skip:skip||EXPORTS.some(([p])=>!existsSync(p))},()=>{
 for(const [file,hash]of EXPORTS){const bytes=readFileSync(file),raw=JSON.parse(bytes.toString()),s=accept(parseVillagePopulationRuntime(bytes.toString(),{worldKey:raw.worldKey,contentRevision:raw.contentRevision})),before=encoded(s);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);assert.equal(before,bytes.toString());assert.equal(s.navigationOther,null);
  held(s,site('quest'));const next=step(s,60,site('quest')),control=step(s,60,site('legacyDesktop'));
  sameCursors(s,next);assert.equal(next.navigation.navigationRevision,undefined);assert.ok(next.navigation.residents.every(r=>!r.patrol));assert.deepEqual(next.life,control.life,'physical hold must not stop or rewrite abstract life/time');held(next,site('quest'));
  const history=createVillagePopulationObserver().observe(s,Math.max(0,s.clock.simulatedElapsedMilliseconds-4000),{site:site('quest')});held(history,site('quest'));assert.equal(serializeVillagePopulationRuntime(history).ok,false,'history cannot erase the original allocation policy');
  assert.equal(encoded(s),before);assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash);
 }
});
test('a paired patrol world cannot downgrade through first use of the other legacy profile',{skip},()=>{
 for(const [first,other]of [['desktop','legacyQuest'],['quest','legacyDesktop']] as const){const s=step(fresh(),241,site(first)),before=encoded(s);assert.ok(s.navigation.navigationAllocation);assert.equal(s.navigationOther,null);
  held(s,site(other));const next=step(s,1,site(other));sameCursors(s,next);held(next,site(other));assert.equal(encoded(s),before);
 }
});
test('both already-bound legacy profiles block paired allocation in either active direction',{skip},()=>{
 const both=step(step(fresh(),240,site('legacyDesktop')),0,site('legacyQuest'));assert.ok(both.navigationOther);
 for(const target of ['desktop','quest'] as const){held(both,site(target));const next=step(both,1,site(target));sameCursors(both,next);held(next,site(target));}
});
test('legacy first-profile switching remains supported, and the exact paired profiles can switch in both directions',{skip},()=>{
 for(const [first,other]of [['legacyDesktop','legacyQuest'],['legacyQuest','legacyDesktop'],['desktop','quest'],['quest','desktop']] as const){
  const firstSite=site(first),otherSite=site(other),s=step(fresh(),240,firstSite),switched=step(s,0,otherSite);
  assert.equal(switched.navigation.profile,otherSite.profile);assert.ok(switched.navigationOther);parked(s.navigation,switched.navigationOther);
  assert.deepEqual(switched.navigation.navigationAllocation,otherSite.navigationAllocation);assert.equal(switched.navigation.navigationRevision,otherSite.navigationRevision);
  const later=step(restored(switched),60,otherSite),control=step(s,60,firstSite);assert.deepEqual(later.life,control.life);
  if(otherSite.navigationAllocation)assert.ok(later.navigation.residents.some(r=>(r.patrol?.completedLegs??0)>=3),'the valid pair supports real recurring movement after actual arrival');
  const back=step(later,0,firstSite);assert.equal(back.navigation.profile,firstSite.profile);assert.ok(back.navigationOther);parked(later.navigation,back.navigationOther);assert.deepEqual(back.navigation.navigationAllocation,firstSite.navigationAllocation);
 }
});
test('foreign generations and changed pair members cannot bootstrap a new profile, even with a copied generation label',{skip},()=>{
 const s=step(fresh(),241,site('desktop')),base=JSON.parse(readFileSync(FILES.quest,'utf8'));
 for(const mutate of [(r:any)=>{r.binding.navigationAllocation.generation=r.certificate.navigationAllocation.generation='f'.repeat(64);},(r:any)=>{
  r.binding.navigationRevision=r.certificate.navigationRevision='e'.repeat(64);r.binding.navigationAllocation.questRevision=r.certificate.navigationAllocation.questRevision='e'.repeat(64);
 }]){const raw=copy(base);mutate(raw);const changed=rawSite(raw);held(s,changed);const next=step(s,1,changed);sameCursors(s,next);held(next,changed);}
 const invalid=copy(base);invalid.binding.navigationRevision=invalid.certificate.navigationRevision='e'.repeat(64);assert.throws(()=>rawSite(invalid),/profile pair/,'a declared pair must name the exact current profile revision');
});
test('mixed or missing prior allocations hold every source cursor and all presentation instead of selecting a preferred profile',{skip},()=>{
 const paired=step(fresh(),241,site('desktop')),legacyOther=step(fresh(),241,site('legacyQuest'));
 const mixedRaw=JSON.parse(encoded(paired));mixedRaw.navigationOther=legacyOther.navigation;const mixed=accept(parseVillagePopulationRuntime(JSON.stringify(mixedRaw),{worldKey:paired.worldKey,contentRevision:paired.contentRevision}));
 const unpairedRaw=JSON.parse(encoded(paired));delete unpairedRaw.navigation.navigationAllocation;const missing=accept(parseVillagePopulationRuntime(JSON.stringify(unpairedRaw),{worldKey:paired.worldKey,contentRevision:paired.contentRevision}));
 const foreignOther=JSON.parse(encoded(step(fresh(),241,site('quest'))));foreignOther.navigation.navigationAllocation.generation='f'.repeat(64);
 const foreignRaw=JSON.parse(encoded(paired));foreignRaw.navigationOther=foreignOther.navigation;const foreign=accept(parseVillagePopulationRuntime(JSON.stringify(foreignRaw),{worldKey:paired.worldKey,contentRevision:paired.contentRevision}));
 for(const s of [mixed,missing,foreign]){
  for(const target of ['desktop','quest','legacyDesktop','legacyQuest'] as const){held(s,site(target));const next=step(s,1,site(target));sameCursors(s,next);held(next,site(target));assert.deepEqual(next.life,step(s,1,site('desktop')).life);}
  held(s,null);const unloaded=step(s,1,null);sameCursors(s,unloaded);held(unloaded,null);
 }
});
test('unpaired source-authoring candidates remain readable offline but cannot bind even a fresh world',{skip:skip||!existsSync(`${UNPAIRED}/desktop-guard-lane-patrol-v1.json`)},()=>{
 const unpaired=rawSite(JSON.parse(readFileSync(`${UNPAIRED}/desktop-guard-lane-patrol-v1.json`,'utf8'))),s=fresh();assert.ok(unpaired.patrols?.length);assert.equal(unpaired.navigationAllocation,undefined);held(s,unpaired);
 const next=step(s,1,unpaired);assert.equal(next.navigation.profile,null);assert.equal(next.navigation.sourceSha256,null);assert.equal(next.navigation.navigationRevision,undefined);assert.ok(next.navigation.residents.every(r=>r.anchorPosition===null&&!r.patrol));held(next,unpaired);
});

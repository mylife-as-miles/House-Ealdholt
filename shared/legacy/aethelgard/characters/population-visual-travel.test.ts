import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceVillageLifeNavigation,createVillageLifeNavigation,sampleVillageLifeNavigation,type VillageLifeNavigationState} from './village-life-navigation';
import type {VillageSiteLayout} from './village-site';
import type {VillageLifeIntent} from './village-life';
import type {VillagePopulationResidentState} from './village-population-runtime';
import {preparePopulationVisualTravel,samplePopulationVisualTravel} from './population-visual-travel';
const site:VillageSiteLayout=Object.freeze({profile:'desktop',sourceSha256:'a'.repeat(64),frame:'source-root-local-metres',capsule:{radius:.85,height:3.5},anchors:[['home',[0,0,0]],['bend',[3,0,0]],['work',[3,0,4]]].map(([id,p])=>({id:id as string,sourceActor:'unit-source-ground',sourceGroundPoint:p as any,capsuleBottomPoint:p as any,standingOnly:true})),routes:[{id:'first',from:'home',to:'bend',reversible:true,sourceGroundPolyline:[[0,0,0],[3,0,0]],capsuleBottomPolyline:[[0,0,0],[3,0,0]],lengthMetres:3},{id:'second',from:'bend',to:'work',reversible:true,sourceGroundPolyline:[[3,0,0],[3,0,4]],capsuleBottomPolyline:[[3,0,0],[3,0,4]],lengthMetres:4}],placeBindings:['home','bend','work'].map(placeId=>({placeId,anchorId:placeId,status:'mapped-exterior'})),residentPlaceBindings:[]})as VillageSiteLayout;
const intent=(place:string):VillageLifeIntent=>({residentId:'ealdholt-brewster',activityKey:'work',targetPlaceId:place,activity:'Unit source journey.',priority:1,issuedAbsoluteMinute:0,indoor:false,companionIds:[],reason:'routine'});
function fixture(at=0){const home=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site,intents:[intent('home')],metresPerWorldMinute:1}),started=advanceVillageLifeNavigation(home,{absoluteMinute:0,site,intents:[intent('work')],metresPerWorldMinute:1});
 const nav=advanceVillageLifeNavigation(started,{absoluteMinute:at,site,intents:[intent('work')],metresPerWorldMinute:1});return row(nav);}
function row(nav:VillageLifeNavigationState){const journey=nav.residents[0],sample=sampleVillageLifeNavigation(nav,site)[0];return {residentId:journey.residentId,tier:'persistent',activity:'Unit source journey.',roleClip:null,availableRoleClips:[],scheduledPlaceId:'work',placeId:null,fromPlaceId:'home',slotIndex:0,slotStartMinute:0,slotEndMinute:1440,status:'travelling',reason:null,position:sample.position,yawRadians:sample.yawRadians,moving:true,presentable:true,navigationStatus:'travelling',navigationReason:null,lifeIntent:intent('work'),visualTravel:{journey,profile:site.profile,sourceSha256:site.sourceSha256,siteIdentity:nav.siteIdentity!,metresPerSecond:1,maximumAdvanceSeconds:2}}as VillagePopulationResidentState;}

test('visual sampling follows the exact bent source arc, has a causal time cap and cannot declare arrival',()=>{
 const source=fixture(2.75),before=JSON.stringify(source),plan=preparePopulationVisualTravel(source,site)!;assert.ok(plan);const out:[number,number,number]=[0,0,0];
 assert.equal(samplePopulationVisualTravel(plan,.5,out),0);assert.deepEqual(out,[3,0,.25]);samplePopulationVisualTravel(plan,99,out);assert.deepEqual(out,[3,0,1.75]);
 const end=preparePopulationVisualTravel(fixture(6.9),site)!;samplePopulationVisualTravel(end,2,out);assert.ok(out[2]<4&&out[2]>3.99);assert.equal(source.visualTravel!.journey.arrivalEvidence,'none');assert.equal(JSON.stringify(source),before);
});

test('visual route preparation rejects fabricated points, changed source bindings, nonmoving and held physical cursors',()=>{
 const source=fixture(1);assert.ok(preparePopulationVisualTravel(source,site));
 const changed=JSON.parse(JSON.stringify(source));changed.visualTravel.journey.route.sourceGroundPolyline[1][0]=30;assert.equal(preparePopulationVisualTravel(changed,site),null);
 assert.equal(preparePopulationVisualTravel({...source,position:[50,0,50]},site),null);
 assert.equal(preparePopulationVisualTravel({...source,moving:false},site),null);
 assert.equal(preparePopulationVisualTravel({...source,navigationReason:'dynamic-obstacle'},site),null);
 assert.equal(preparePopulationVisualTravel({...source,visualTravel:{...source.visualTravel!,sourceSha256:'b'.repeat(64)}},site),null);
 assert.equal(preparePopulationVisualTravel({...source,visualTravel:{...source.visualTravel!,navigationRevision:'foreign'}},site),null);
});

test('reversed source arcs retain their exact points and stop before an unconfirmed return arrival',()=>{
 const source=fixture(2),nav:VillageLifeNavigationState={schemaVersion:1,absoluteMinute:2,siteIdentity:source.visualTravel!.siteIdentity,sourceSha256:site.sourceSha256,profile:'desktop',residents:[source.visualTravel!.journey]};
 const back=advanceVillageLifeNavigation(nav,{absoluteMinute:2,site,intents:[intent('home')],metresPerWorldMinute:1}),base=row(back),state={...base,scheduledPlaceId:'home',lifeIntent:intent('home')},plan=preparePopulationVisualTravel(state,site)!;assert.ok(plan);assert.equal(plan.direction,-1);
 const out:[number,number,number]=[0,0,0];samplePopulationVisualTravel(plan,2,out);assert.ok(out[0]>0&&out[0]<.01);assert.equal(state.visualTravel!.journey.arrivalEvidence,'none');
});

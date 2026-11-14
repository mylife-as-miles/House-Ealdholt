import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVillageSiteEmergencyTargets,sameVillageSiteEmergencyTarget,matchesVillageSiteEmergencyStation,type VillageSiteEmergencyTarget} from './village-emergency-targets';
function source(yaw=3.930960879767402):VillageSiteEmergencyTarget{return parseVillageSiteEmergencyTargets([{id:'unit-source-bucket',residentId:'ealdholt-brewster',placeId:'unit-action-water',anchorId:'unit-source-water',kind:'water',buildingKey:null,sourceActor:'unit-source-terrain',contactPoint:[1,1,0],yawRadians:yaw,clip:'carry_bucket_walk',operationWorldMinutes:1,waterUnits:20,proof:{sourceSha256:'a'.repeat(64),profile:'desktop',siteIdentity:'unit-source-site-artifact',originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:'unit-source-well',maximumContactDistanceMetres:2,clip:'carry_bucket_walk'}}])[0];}

test('actual Chrome-export atan2 ULP pairs restore across runtimes without rewriting their durable source declaration',()=>{
 for(const [chrome,node]of [[3.930960879767402,3.9309608797674023],[-.5364714368554475,-.5364714368554477]]){
  const saved=source(chrome),current=source(node),before=JSON.stringify(saved);assert.notEqual(saved.yawRadians,current.yawRadians);assert.equal(sameVillageSiteEmergencyTarget(saved,current),true);
  assert.equal(matchesVillageSiteEmergencyStation(saved,{...current,disasterId:'unit-incident'}),true);assert.equal(JSON.stringify(saved),before);assert.equal(saved.yawRadians,chrome);
 }
});

test('the portability allowance is limited to finite 1e-12-radian yaw and rejects meaningful rotation edits',()=>{
 const saved=source();for(const delta of [1e-11,-1e-11,.001,-.001,Math.PI*2])assert.equal(sameVillageSiteEmergencyTarget(saved,{...saved,yawRadians:saved.yawRadians+delta}),false);
 for(const yawRadians of [NaN,Infinity,-Infinity])assert.equal(sameVillageSiteEmergencyTarget(saved,{...saved,yawRadians}),false);
 assert.equal(sameVillageSiteEmergencyTarget(saved,{...saved,yawRadians:saved.yawRadians+5e-13}),true);
});

test('even tiny contact-coordinate, source-proof and equipment changes remain exact failures beside a valid yaw ULP difference',()=>{
 const saved=source(),near={...saved,yawRadians:3.9309608797674023};
 for(const changed of [{...near,contactPoint:[1+1e-12,1,0]as const},{...near,proof:{...near.proof,maximumContactDistanceMetres:2+1e-13}},
  {...near,proof:{...near.proof,sourceSha256:'b'.repeat(64)}},{...near,proof:{...near.proof,siteIdentity:'another-artifact'}},
  {...near,proof:{...near.proof,equipmentSha256:'c'.repeat(64)}},{...near,anchorId:'another-anchor'},{...near,clip:'idle' as const}])assert.equal(sameVillageSiteEmergencyTarget(saved,changed),false);
});

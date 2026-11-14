import test from 'node:test';
import assert from 'node:assert/strict';
import { villageNightLightStrength } from './village-lights';
import { sampleWorldEnvironment } from './world-environment-state';
const at=(absolute:number)=>sampleWorldEnvironment({absoluteWorldMinute:absolute,fractionalMinute:0,dayIndex:Math.floor(absolute/1440),dayMinute:absolute%1440,elapsedWorldMinutes:0,deferredMilliseconds:0},'night-light-test');
test('lamps follow saved night/day time, including reload and skipped days, without advancing it',()=>{
 for(const day of [0,1,100]){
  const midnight=at(day*1440),noon=at(day*1440+720),saved=JSON.stringify(midnight);
  assert.equal(villageNightLightStrength(midnight),1);assert.equal(villageNightLightStrength(noon),0);
  assert.equal(villageNightLightStrength(JSON.parse(saved)),1);assert.equal(JSON.stringify(midnight),saved);
 }
});
test('dusk and dawn ease continuously, remain bounded and reject unavailable light state',()=>{
 assert.equal(villageNightLightStrength(null),0);assert.equal(villageNightLightStrength({daylight:NaN}),0);
 assert.equal(villageNightLightStrength({daylight:-1}),1);assert.equal(villageNightLightStrength({daylight:2}),0);
 let previous=1;for(let i=0;i<=1000;i++){const n=villageNightLightStrength({daylight:i/1000});assert.ok(n>=0&&n<=1&&n<=previous);assert.ok(previous-n<.004);previous=n;}
 assert.ok(villageNightLightStrength({daylight:.4})>0&&villageNightLightStrength({daylight:.4})<1);
});

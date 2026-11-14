import test from 'node:test';import assert from 'node:assert/strict';
import {sampleWorldEnvironment} from '../aethelgard/environment/world-environment-state';
const at=(absoluteWorldMinute:number,fractionalMinute=0)=>({absoluteWorldMinute,fractionalMinute,dayIndex:Math.floor(absoluteWorldMinute/1440),dayMinute:absoluteWorldMinute%1440,elapsedWorldMinutes:absoluteWorldMinute,deferredMilliseconds:0});
test('one saved clock drives sun, day and night independently of frame sampling',()=>{
 const noon=sampleWorldEnvironment(at(720),'house-a'),midnight=sampleWorldEnvironment(at(1440),'house-a');assert.ok(noon.sunDirection[1]>.9);assert.ok(midnight.sunDirection[1]<-.9);assert.equal(noon.daylight,1);assert.equal(midnight.sunIntensity,0);assert.ok(midnight.moonIntensity>0);
 for(let m=1;m<720;m++)sampleWorldEnvironment(at(m),'house-a');assert.deepEqual(sampleWorldEnvironment(at(720),'house-a'),noon);
 assert.ok(Math.abs(Math.hypot(...noon.sunDirection)-1)<1e-12);assert.equal(midnight.dayIndex,1);
});
test('weather remains continuous across saved-clock period boundaries and responds to authored overrides',()=>{
 for(let period=1;period<15;period++){const a=sampleWorldEnvironment(at(period*240-1,.99999),'house-a'),b=sampleWorldEnvironment(at(period*240),'house-a');assert.ok(Math.abs(a.rain-b.rain)<1e-5);assert.ok(Math.abs(a.cloudCoverage-b.cloudCoverage)<1e-5);}
 const rain=sampleWorldEnvironment(at(720),'house-a',{weather:'rain'}),clear=sampleWorldEnvironment(at(720),'house-a',{weather:'clear'});assert.ok(rain.rain>clear.rain&&rain.sunIntensity<clear.sunIntensity);assert.ok(rain.wetness>0);assert.throws(()=>sampleWorldEnvironment(at(NaN),'house-a'));
});

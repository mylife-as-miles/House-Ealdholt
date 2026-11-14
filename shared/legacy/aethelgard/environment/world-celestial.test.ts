import test from 'node:test';import assert from 'node:assert/strict';
import {sampleWorldEnvironment} from './world-environment-state';
import {sampleWorldCelestial,WORLD_LUNAR_PERIOD_DAYS} from './world-celestial';
import {worldSkyShader} from './world-sky-shader';
const at=(absoluteWorldMinute:number,fractionalMinute=0)=>({absoluteWorldMinute,fractionalMinute,dayIndex:Math.floor(absoluteWorldMinute/1440),dayMinute:absoluteWorldMinute%1440,elapsedWorldMinutes:absoluteWorldMinute,deferredMilliseconds:0});
const close=(a:number,b:number,tolerance=1e-10)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('saved calendar gives a waxing gibbous midnight, a dark moonless night, and an exact geometric phase',()=>{
 const initial=sampleWorldEnvironment(at(0),'calendar-sky',{weather:'clear'}),moonless=sampleWorldEnvironment(at(18*1440),'calendar-sky',{weather:'clear'});
 assert.equal(initial.celestial.moonPhase,.375);assert.ok(initial.celestial.moonIllumination>.75&&initial.celestial.moonIllumination<1);assert.ok(initial.celestial.moonDirection[1]>.5);assert.ok(initial.moonIntensity>0);assert.equal(initial.celestial.nightVisibility,1);
 assert.ok(moonless.celestial.moonIllumination<.01);assert.equal(moonless.moonIntensity,0);assert.equal(moonless.celestial.moonWashout,0);assert.equal(moonless.celestial.nightVisibility,1);assert.ok(moonless.skyZenith.every(v=>v>0));
 for(let minute=0;minute<60*1440;minute+=317){const state=sampleWorldEnvironment(at(minute,.25),'calendar-sky'),cel=state.celestial;close(Math.hypot(...cel.moonDirection),1);close(Math.hypot(...cel.orbitTangent),1);close(cel.orbitTangent.reduce((n,v,i)=>n+v*state.sunDirection[i],0),0);close(cel.moonDirection.reduce((n,v,i)=>n+v*state.sunDirection[i],0),1-2*cel.moonIllumination);assert.ok(cel.moonPhase>=0&&cel.moonPhase<1);}
});
test('lunar cycle, sidereal rotation and weather are deterministic without a second clock or phase reset',()=>{
 const a=sampleWorldEnvironment(at(700.5),'saved-calendar'),repeat=sampleWorldEnvironment(at(700.5+WORLD_LUNAR_PERIOD_DAYS*1440),'saved-calendar');close(a.celestial.moonPhase,repeat.celestial.moonPhase);close(a.celestial.moonIllumination,repeat.celestial.moonIllumination);
 const before=sampleWorldEnvironment(at(1439,.99999),'saved-calendar'),after=sampleWorldEnvironment(at(1440),'saved-calendar');assert.ok(Math.hypot(...before.celestial.moonDirection.map((v,i)=>v-after.celestial.moonDirection[i]))<1e-6);close(before.celestial.moonIllumination,after.celestial.moonIllumination,1e-6);
 for(let i=0;i<100;i++)sampleWorldEnvironment(at(i*123),'other-world');assert.deepEqual(sampleWorldEnvironment(at(700.5),'saved-calendar'),a);assert.ok(Math.abs(sampleWorldEnvironment(at(1440),'saved-calendar').celestial.starRotationRadians-a.celestial.starRotationRadians)>.1);
 assert.throws(()=>sampleWorldCelestial(NaN,[0,1,0]));assert.throws(()=>sampleWorldCelestial(0,[0,2,0]));assert.ok(sampleWorldCelestial(360,[0,1,0]).moonDirection.every(Number.isFinite));
});
test('dawn remains on the existing east path and fair-weather cumulus uses the authored coverage override',()=>{
 const dawn=sampleWorldEnvironment(at(360),'cove',{weather:'clear'}),noon=sampleWorldEnvironment(at(720),'cove',{weather:'clear'}),sunset=sampleWorldEnvironment(at(1080),'cove',{weather:'clear'});
 assert.ok(dawn.sunDirection[0]>.9);close(dawn.sunDirection[1],0);assert.ok(sunset.sunDirection[0]<-.9);assert.equal(noon.daylight,1);assert.equal(noon.celestial.nightVisibility,0);assert.equal(noon.rain,0);assert.equal(noon.cloudCoverage,.22);
 const held=sampleWorldEnvironment(at(720),'cove',{weather:'clear',cloudCoverage:0,windStrength:0});assert.equal(held.cloudCoverage,0);assert.equal(held.windStrength,0);assert.deepEqual(held.celestial,noon.celestial);
});
test('the gibbous disc uses a spherical sun-facing terminator rather than an unphased bright spot',()=>{
 const state=sampleWorldEnvironment(at(0),'disc'),moon=state.celestial.moonDirection,up=[0,1,0],east=[up[1]*moon[2]-up[2]*moon[1],up[2]*moon[0]-up[0]*moon[2],up[0]*moon[1]-up[1]*moon[0]],len=Math.hypot(...east);for(let i=0;i<3;i++)east[i]/=len;const north=[moon[1]*east[2]-moon[2]*east[1],moon[2]*east[0]-moon[0]*east[2],moon[0]*east[1]-moon[1]*east[0]];
 let total=0,lit=0;for(let y=-64;y<=64;y++)for(let x=-64;x<=64;x++){const a=x/64,b=y/64,r=a*a+b*b;if(r>=1)continue;total++;const normal=moon.map((v,i)=>east[i]*a+north[i]*b-v*Math.sqrt(1-r));if(normal.reduce((n,v,i)=>n+v*state.sunDirection[i],0)>0)lit++;}close(lit/total,state.celestial.moonIllumination,.01);
 for(const steps of[4,12,20,32]){const shader=worldSkyShader(steps);assert.match(shader,/normal=east\*q.x\+north\*q.y-cfWorldMoon\*z/);assert.match(shader,/dot\(normal,cfWorldSun\)/);assert.match(shader,/cfGalacticBand/);assert.match(shader,/cfStarRotation/);assert.ok(shader.indexOf('sky+=cfCelestialSky(ray)')<shader.indexOf('colour+sky*transmission'),'Cloud compositing must occlude moon/stars/Milky Way.');assert.doesNotMatch(shader,/dot\(ray,-cfWorldSun\)/,'The old always-full opposite-sun moon is removed.');}
});

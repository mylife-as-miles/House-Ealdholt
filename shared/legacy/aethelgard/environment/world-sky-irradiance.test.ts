import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleWorldEnvironment} from './world-environment-state';
import {worldSkyIrradiance} from './world-sky-irradiance';

const at=(minute:number)=>({absoluteWorldMinute:minute,fractionalMinute:0,dayIndex:Math.floor(minute/1440),dayMinute:minute%1440,elapsedWorldMinutes:minute,deferredMilliseconds:0});
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);

test('sky fill retains noon energy and applies time-sampled linear sky radiance once at twilight and night',()=>{
  const noon=sampleWorldEnvironment(at(720),'sky-fill',{weather:'clear'});
  const noonFill=worldSkyIrradiance(noon);
  for(let i=0;i<3;i++)close(noonFill[i],noon.skyHorizon[i]*.18);
  for(const minute of [360,1080,1095,1140,1440]){
    const state=sampleWorldEnvironment(at(minute),'sky-fill',{weather:'clear'}),fill=worldSkyIrradiance(state);
    for(let i=0;i<3;i++){
      close(fill[i]/noonFill[i],state.skyHorizon[i]/noon.skyHorizon[i]);
      assert.ok(fill[i]>0&&Number.isFinite(fill[i]));
    }
    if(state.daylight<1)assert.ok(fill[1]>state.skyHorizon[1]*.18*(.1+.9*state.daylight),'The old duplicate daylight attenuation must not return.');
  }
});

test('sky fill follows saved-time and weather continuously without a second clock or lunar energy injection',()=>{
  let previous=worldSkyIrradiance(sampleWorldEnvironment(at(1040),'sky-fill',{weather:'clear'}));
  for(let minute=1041;minute<1140;minute++){
    const state=sampleWorldEnvironment(at(minute),'sky-fill',{weather:'clear'}),fill=worldSkyIrradiance(state);
    assert.ok(Math.max(...fill.map((v,i)=>Math.abs(v-previous[i])))<.005);
    previous=fill;
  }
  const time=at(1080),clear=sampleWorldEnvironment(time,'sky-fill',{weather:'clear'}),rain=sampleWorldEnvironment(time,'sky-fill',{weather:'rain'});
  assert.ok(worldSkyIrradiance(rain)[2]<worldSkyIrradiance(clear)[2]);
  assert.deepEqual(worldSkyIrradiance(clear),worldSkyIrradiance(sampleWorldEnvironment(time,'sky-fill',{weather:'clear'})));
  assert.deepEqual(time,at(1080));
});

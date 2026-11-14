import assert from 'node:assert/strict';
import test from 'node:test';
import { createProceduralFireField, normalizeProceduralFireWeather, PROCEDURAL_FIRE_STEP_SECONDS } from './procedural-fire-field';
import { createProceduralFireBlackbodyLut, proceduralFireBlackbody, proceduralFirePlanck } from './procedural-fire-blackbody';
import { PROCEDURAL_FIRE_CARD_FRAGMENT, PROCEDURAL_FIRE_SAMPLE_GLSL } from './procedural-fire-shader';

test('Planck/CIE fire emission varies with temperature and the bounded LUT contains finite physical color',()=>{
  assert.equal(proceduralFirePlanck(550,0),0);assert.equal(proceduralFirePlanck(-1,1500),0);
  assert.ok(proceduralFirePlanck(550,1800)>proceduralFirePlanck(550,1000));
  const low=proceduralFireBlackbody(900),high=proceduralFireBlackbody(1800);
  assert.ok(low[0]>low[1]);assert.ok(high[0]>low[0]);assert.ok(high.every(Number.isFinite));
  const lut=createProceduralFireBlackbodyLut(32);assert.equal(lut.data.length,32*2*4);
  assert.ok(lut.data.some(value=>value>0));assert.throws(()=>createProceduralFireBlackbodyLut(1));
});
test('first reduced-motion/Hold frame has a hot pilot and freezes exact field bytes without fast-forward catchup',()=>{
  const field=createProceduralFireField(),a=new Uint8Array(64*96*4),b=new Uint8Array(a.length);
  field.writeAtlas(a);assert.ok(a.some((value,index)=>index%4===0&&value>50),'initial heat is visible without clock advancement');
  assert.equal(field.advance(10,true),false);assert.equal(field.advance(20,true),false);field.writeAtlas(b);assert.deepEqual(a,b);
  assert.equal(field.advance(20,false),false);assert.equal(field.advance(20+PROCEDURAL_FIRE_STEP_SECONDS,false),true);
  const steps=field.diagnostics.steps;assert.equal(field.advance(2000,false),false);assert.equal(field.diagnostics.steps,steps);
  assert.equal(field.advance(2000.5,false),true);assert.equal(field.diagnostics.steps,steps+1,'a long render interval admits at most one visual step');
  assert.equal(field.advance(1,false),false,'backwards time rebases');assert.equal(field.advance(NaN,false),false);
  field.dispose();assert.equal(field.advance(3,false),false);assert.equal(field.step(.05),false);
});
test('combustion consumes local oxygen, releases heat/soot and fixed pressure sweeps reduce divergence',()=>{
  const field=createProceduralFireField(),bytes=new Uint8Array(64*96*4);
  for(let i=0;i<24;i++)assert.equal(field.step(PROCEDURAL_FIRE_STEP_SECONDS),true);
  const stats=field.diagnostics;assert.equal(stats.cells,6144);assert.equal(stats.pressureIterations,6);
  assert.ok(stats.fuel>0&&stats.heat>0&&stats.soot>0);assert.ok(stats.divergenceAfter<stats.divergenceBefore);
  assert.ok([stats.fuel,stats.heat,stats.soot,stats.maxSpeed,stats.divergenceBefore,stats.divergenceAfter].every(Number.isFinite));
  field.writeAtlas(bytes);assert.ok(bytes.some((value,index)=>index%4===2&&value>0),'reaction rate reaches the rendered field');
  assert.ok(bytes.some((value,index)=>index%4===3&&value<250),'oxygen is locally consumed');
  assert.ok(bytes.some((value,index)=>index%4===1&&value>0),'soot reaches the rendered field');field.dispose();
});
test('wind/rain change the actual field, hostile inputs remain bounded and weather records remain unchanged',()=>{
  const calm=createProceduralFireField(),storm=createProceduralFireField(),weather={wind:[100,20] as const,windStrength:5,rain:2};
  const before=JSON.stringify(weather);for(let i=0;i<12;i++){calm.step(1/12);storm.step(1/12,weather);}
  const a=new Uint8Array(64*96*4),b=new Uint8Array(a.length);calm.writeAtlas(a);storm.writeAtlas(b);assert.notDeepEqual(a,b);
  assert.equal(JSON.stringify(weather),before);const normalized=normalizeProceduralFireWeather({wind:[NaN,Infinity],windStrength:NaN,rain:Infinity});
  assert.deepEqual(normalized,{windX:0,windZ:0,rain:0});assert.ok(storm.diagnostics.maxSpeed<6);
  assert.equal(storm.step(NaN),false);assert.equal(storm.step(-1),false);assert.throws(()=>storm.writeAtlas(new Uint8Array(4)));
  const collapsed=new Uint8Array(16*24*4);storm.writeAtlas(collapsed,true);assert.ok(collapsed.some(value=>value>0));calm.dispose();storm.dispose();
});
test('rendering uses one bounded non-additive integration and unassociates before output encoding',()=>{
  assert.match(PROCEDURAL_FIRE_SAMPLE_GLSL,/tap<8/);assert.match(PROCEDURAL_FIRE_SAMPLE_GLSL,/transmit\*=1\.0-alpha/);
  assert.match(PROCEDURAL_FIRE_SAMPLE_GLSL,/cfFireSupported<\.5/);assert.match(PROCEDURAL_FIRE_SAMPLE_GLSL,/cfFireFallbackColor\*a/);
  assert.ok(PROCEDURAL_FIRE_CARD_FRAGMENT.indexOf('flame.rgb/max')<PROCEDURAL_FIRE_CARD_FRAGMENT.indexOf('colorspace_fragment'));
  assert.ok(PROCEDURAL_FIRE_CARD_FRAGMENT.indexOf('gl_FragColor.rgb*=gl_FragColor.a')>PROCEDURAL_FIRE_CARD_FRAGMENT.indexOf('colorspace_fragment'));
});

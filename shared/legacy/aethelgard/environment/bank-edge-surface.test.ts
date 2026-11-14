import test from'node:test';import assert from'node:assert/strict';
import{createEaldholtChannelStages,sampleEaldholtChannelStage,ealdholtBankEdge,ealdholtBankEdgeWetness,ealdholtBankFloorRetention,ealdholtBankSurfaceStage,validEaldholtChannelStages}from'./bank-edge-surface';
import{createEaldholtBankExposureSections,patchEaldholtWoodlandValleySurface}from'./woodland-ground';
const close=(a:number,b:number,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,`${a} vs ${b}`);
test('authored local stages retain separate rising, falling and sea-level profiles without changing samples',()=>{
 for(const slope of[-.0006,.013,-.021]){
  const source=Float32Array.from(Array.from({length:65},(_,i)=>{const x=-120+i*4;return[x,10,21,.7+slope*x];}).flat()),before=source.slice(),stages=createEaldholtChannelStages(source);
  assert.equal(stages.count,2);assert.ok(stages.maximumError<=1e-6);
  for(let i=0;i<65;i++)close(sampleEaldholtChannelStage(stages,source[i*4]),source[i*4+3]);
  const far=sampleEaldholtChannelStage(stages,120),sea=sampleEaldholtChannelStage(stages,-120);assert.notEqual(far,sea);assert.deepEqual(source,before);
 }
});
test('local channel contact replaces a stale wet attribute without changing coast/sea wetness outside reach',()=>{
 const p={distance:.15,heightAboveWater:.7,field:.5,fine:.5,reach:1};assert.equal(ealdholtBankEdgeWetness(p,1),0,'Raised dry ground no longer inherits its old wet mask.');
 assert.equal(ealdholtBankEdgeWetness({...p,reach:0},.8),.8);assert.equal(ealdholtBankEdgeWetness({...p,distance:5},.8),.8);
 assert.ok(ealdholtBankEdgeWetness({...p,heightAboveWater:.01},0)>.9);
 const stages=createEaldholtChannelStages([-20,-5,5,.7,20,-5,5,1.9]);
 close(ealdholtBankSurfaceStage(stages,20,.2,1,.7),1.9);assert.equal(ealdholtBankSurfaceStage(stages,20,8,1,.7),.7);assert.equal(ealdholtBankSurfaceStage(stages,20,.2,0,.7),.7);
});
test('litter retains deliberate bare gaps and far forest while preserving actual wet bank and meadow contact patches',()=>{
 const dry={distance:1,heightAboveWater:.5,field:.5,fine:.8,reach:1};
 assert.equal(ealdholtBankFloorRetention(dry,1),.35);assert.equal(ealdholtBankFloorRetention({...dry,fine:.1},1),1);assert.equal(ealdholtBankFloorRetention(dry,0),1,'A steep exposed soil face is not a meadow patch.');
 assert.equal(ealdholtBankFloorRetention({...dry,reach:0},1),1);assert.equal(ealdholtBankFloorRetention({...dry,distance:8},1),1);
 assert.ok(ealdholtBankFloorRetention({...dry,distance:.1,heightAboveWater:.01},0)<.02);
});
test('the actual shared PBR builder binds local channel stages, keeps existing photo/normal samplers and handles changing slopes',()=>{
 for(const samples of[[-20,-5,5,.3,-5,-4,6,.6,0,-4,6,.7,20,-5,5,1.1],[-20,-5,5,.3,-5,-4,6,.8,0,-4,6,1.2,20,-5,5,.7]]){
  const sections=createEaldholtBankExposureSections(samples,64),shader={uniforms:{}as Record<string,{value:unknown}>,vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <aomap_fragment>'};
  const source=sections.waterStages.data.slice();
  patchEaldholtWoodlandValleySurface(shader,.06,'attribute',{waterHeight:17,earthNormal:{},earthOrm:{},rock:{albedo:{},normal:{},meanLuminance:.1},woodland:{bank:{tileMetres:1.3,targetLuminance:.06},meadow:{albedo:{},normal:{},meanLuminance:.07,targetLuminance:.07,tileMetres:2},sections}});
  assert.deepEqual(shader.uniforms.uEaldholtValleyWaterStages.value,source);assert.notEqual(shader.uniforms.uEaldholtValleyWaterStages.value,sections.waterStages.data);assert.deepEqual(sections.waterStages.data,source);
  assert.ok(shader.fragmentShader.includes('ealdholtP.y-mix(uEaldholtValleyWaterHeight,ealdholtValleyChannelStage(ealdholtP.x),ealdholtContactReach)'));assert.ok(!shader.fragmentShader.includes('ealdholtHeight=ealdholtP.y-uEaldholtValleyWaterHeight'));
  assert.equal((shader.fragmentShader.match(/uniform sampler2D/g)??[]).length,6,'The contact fix adds no sampler.');
  assert.ok(shader.fragmentShader.includes('uEaldholtValleyRockNormal'));assert.ok(shader.fragmentShader.includes('ealdholtBankPhoto'));assert.ok(shader.fragmentShader.includes('diffuseColor.rgb=ealdholtSurface'));
  assert.ok(shader.fragmentShader.includes(`uniform vec2 uEaldholtValleyWaterStages[${sections.waterStages.count}]`));
 }
});
test('changing channel slopes keep every authored knot and interpolate C0 at each join',()=>{
 const samples=Float32Array.of(-20,10,20,.3,-3,10,20,.31,2,10,20,.8,29,10,20,.7),stages=createEaldholtChannelStages(samples);
 assert.equal(stages.count,4);assert.equal(stages.maximumError,0);
 for(let i=4;i<samples.length-4;i+=4){const x=samples[i],level=samples[i+3];close(sampleEaldholtChannelStage(stages,x),level);close(sampleEaldholtChannelStage(stages,x-1e-7),sampleEaldholtChannelStage(stages,x+1e-7));}
 close(sampleEaldholtChannelStage(stages,-100),.3);close(sampleEaldholtChannelStage(stages,100),.7);
});
test('nonfinite, unordered, unsupported stages fail closed instead of inventing a water plane',()=>{
 for(const samples of[[0,1,2,NaN,1,1,2,0],[0,1,2,0,0,1,2,0],[0,2,1,0,1,1,2,0],[0,1,2,0]])assert.throws(()=>createEaldholtChannelStages(samples));
 const stages=createEaldholtChannelStages([0,1,2,0,1,1,2,0]);assert.ok(validEaldholtChannelStages(stages));stages.data[2]=0;assert.ok(!validEaldholtChannelStages(stages));assert.throws(()=>sampleEaldholtChannelStage(stages,0));
});
test('actual surface height and bank distance bound wet contact, with deterministic irregular damp edges',()=>{
 const input={distance:.1,heightAboveWater:.01,field:.5,fine:.6,reach:1},contact=ealdholtBankEdge(input);
 assert.ok(contact.contact>.9&&contact.damp>.9);assert.deepEqual(ealdholtBankEdge(input),contact);
 for(const changed of[{heightAboveWater:.65},{distance:3},{reach:0}]){const value=ealdholtBankEdge({...input,...changed});assert.equal(value.contact,0);assert.equal(value.damp,0);assert.equal(value.pebble,0);}
 const dry=ealdholtBankEdge({...input,heightAboveWater:.28,distance:.65,field:0}),lush=ealdholtBankEdge({...input,heightAboveWater:.28,distance:.65,field:1});assert.ok(lush.damp>dry.damp);
 for(let i=0;i<=20;i++){const value=ealdholtBankEdge({...input,fine:i/20});assert.ok(value.pebble>=0&&value.pebble<=.2&&value.contact<=1&&value.damp<=1);}
 assert.throws(()=>ealdholtBankEdge({...input,heightAboveWater:NaN}));
});

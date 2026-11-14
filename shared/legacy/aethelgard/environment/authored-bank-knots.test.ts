import assert from 'node:assert/strict';
import test from 'node:test';
import {createEaldholtAuthoredBankKnots,sampleEaldholtAuthoredBanks,validEaldholtAuthoredBankKnots,packEaldholtBankExposure,ealdholtBankLookupUniformVectors,EALDHOLT_BANK_KNOT_PROGRAM_KEY} from './authored-bank-knots';
import {createEaldholtBankExposureSections,sampleEaldholtBankSection,patchEaldholtWoodlandValleySurface,EALDHOLT_WOODLAND_BANK_ART_VERSION} from './woodland-ground';
import {recordedEaldholtChannelSamples} from './authored-bank-knots.fixture';

const input=Float32Array.from([-12,-7,3,.3,-1.125,-5,6,.4,-.0625,-8,11,.5,19,-6,4,.6]);
function original(x:number):readonly[number,number]{
 const end=input.length-4;if(x<=input[0])return[input[1],input[2]];if(x>=input[end])return[input[end+1],input[end+2]];
 for(let i=4;i<input.length;i+=4)if(x<=input[i]){const t=(x-input[i-4])/(input[i]-input[i-4]);return[input[i-3]+(input[i+1]-input[i-3])*t,input[i-2]+(input[i+2]-input[i-2])*t];}
 throw Error('Missing independent original interval.');
}
test('packed original banks retain every source scalar, own their data and stay exact at nonuniform knots and intervals',()=>{
 const saved=input.slice(),knots=createEaldholtAuthoredBankKnots(input);assert.equal(knots.count,4);assert.equal(knots.data.length,12);
 for(let row=0;row<4;row++)for(let lane=0;lane<3;lane++)assert.equal(knots.data[row*3+lane],input[row*4+lane]);
 for(const x of[-100,-12,-11,-1.125,-1.1249,-.0625,-.0624,0,8.25,19,100])assert.deepEqual(sampleEaldholtAuthoredBanks(knots,x),original(x));
 assert.deepEqual(input,saved);knots.data[0]=-99;assert.deepEqual(input,saved);
});
test('the public material CPU twin uses exact original banks and preserves the existing exposure and reach fields',()=>{
 const sections=createEaldholtBankExposureSections(input,64),data=sections.data.slice(),stages=sections.waterStages.data.slice();let oldMaximumError=0;
 for(let row=0;row<input.length;row+=4)for(const side of[0,1]){
  const x=input[row],z=input[row+1+side]+(side?1:-1)*.02,sample=sampleEaldholtBankSection(sections,x,z);
  assert.ok(Math.abs(sample.distance-.02)<1e-12,'Exact source knot, not its uniform-grid approximation.');
  const t=(x-sections.x0)/sections.step,i=Math.min(Math.floor(t),62),f=t-i,offset=side;
  const old=data[i*4+offset]+(data[(i+1)*4+offset]-data[i*4+offset])*f;oldMaximumError=Math.max(oldMaximumError,Math.abs(old-input[row+1+side]));
  const exposure=data[i*4+2+side]+(data[(i+1)*4+2+side]-data[i*4+2+side])*f;assert.ok(Math.abs(sample.exposure-exposure)<1e-12);assert.equal(sample.reach,1);
 }
 assert.ok(oldMaximumError>.1,'The independent former uniform-grid lookup must miss this real nonuniform corner.');assert.deepEqual(sections.data,data);assert.deepEqual(sections.waterStages.data,stages);
 for(const x of[-100,100])assert.equal(sampleEaldholtBankSection(sections,x,20).reach,0);
});
test('source-knot sampling is continuous through all supplied corners, including a sharply flared bank',()=>{
 const knots=createEaldholtAuthoredBankKnots(input);
 for(let row=4;row<input.length-4;row+=4){const x=input[row],at=sampleEaldholtAuthoredBanks(knots,x),left=sampleEaldholtAuthoredBanks(knots,x-1e-7),right=sampleEaldholtAuthoredBanks(knots,x+1e-7);for(let side=0;side<2;side++){assert.equal(at[side],input[row+side+1]);assert.ok(Math.abs(left[side]-at[side])<1e-5);assert.ok(Math.abs(right[side]-at[side])<1e-5);}}
});
test('exposure packing preserves Float32 values exactly and pads only the unused final pair',()=>{
 const data=Float32Array.from({length:9*4},(_,i)=>i/37),saved=data.slice(),packed=packEaldholtBankExposure(data,9);assert.equal(packed.length,20);
 for(let row=0;row<9;row++){assert.equal(packed[row*2],data[row*4+2]);assert.equal(packed[row*2+1],data[row*4+3]);}assert.deepEqual(Array.from(packed.subarray(18)),[0,0]);assert.deepEqual(data,saved);
});
test('recorded actual envelope yields the54-knot channel and removes its former near/far resampling error',()=>{
 const channel=recordedEaldholtChannelSamples(),sections=createEaldholtBankExposureSections(channel,64);assert.equal(channel.length/4,54);assert.deepEqual(recordedEaldholtChannelSamples('desktop',23),channel,'Source edge heights cannot change the channel field.');
 assert.equal(sections.authoredBanks.data.length,164);assert.equal(ealdholtBankLookupUniformVectors(54,64,sections.waterStages.count),76);assert.equal(sections.waterStages.count,2);
 let oldNear=0,oldFar=0,newError=0;
 for(let at=0;at<channel.length;at+=4){const x=channel[at],t=(x-sections.x0)/sections.step,i=Math.min(Math.floor(t),62),f=t-i;
  for(const side of[0,1]){const line=channel[at+side+1],old=sections.data[i*4+side]+(sections.data[(i+1)*4+side]-sections.data[i*4+side])*f;
   if(side)oldFar=Math.max(oldFar,Math.abs(old-line));else oldNear=Math.max(oldNear,Math.abs(old-line));newError=Math.max(newError,Math.abs(sampleEaldholtBankSection(sections,x,line).distance));}
 }
 assert.ok(oldNear>.049&&oldNear<.052);assert.ok(oldFar>.148&&oldFar<.151);assert.equal(newError,0);
});
test('the actual Quest generator keeps its own59-knot source profile within the same bounded lookup contract',()=>{
 const channel=recordedEaldholtChannelSamples('quest'),sections=createEaldholtBankExposureSections(channel,64);assert.equal(channel.length/4,59);assert.equal(sections.authoredBanks.data.length,180);assert.equal(sections.waterStages.count,2);assert.equal(ealdholtBankLookupUniformVectors(59,64,2),80);
 assert.notDeepEqual(channel,recordedEaldholtChannelSamples('desktop'),'Native keeps its own source margin/channel rather than transplanting Desktop samples.');
 for(let row=0;row<channel.length;row+=4){const banks=sampleEaldholtAuthoredBanks(sections.authoredBanks,channel[row]);assert.deepEqual(banks,[channel[row+1],channel[row+2]]);}
});
test('invalid, nonfinite, unordered, collapsed and over-budget inputs fail without accepting a uniform approximation',()=>{
 for(const bad of[[],[0,-1,1,0],Array.from(input,(_,i)=>i===4?-20:input[i]),Array.from(input,(_,i)=>i===1?NaN:input[i]),Array.from(input,(_,i)=>i===2?-10:input[i])])assert.throws(()=>createEaldholtAuthoredBankKnots(bad));
 const knots=createEaldholtAuthoredBankKnots(input);assert.equal(validEaldholtAuthoredBankKnots({...knots,count:130}),false);assert.throws(()=>sampleEaldholtAuthoredBanks(knots,Infinity));
 assert.equal(ealdholtBankLookupUniformVectors(54,64,2),76);assert.equal(ealdholtBankLookupUniformVectors(54,64,2)-(64+2+1),9);assert.throws(()=>ealdholtBankLookupUniformVectors(129,128,129),/bounded fragment uniform/);
 const tooLarge=Float32Array.from(Array.from({length:129},(_,i)=>[i,-1,1,i%2?1:.5]).flat());assert.throws(()=>createEaldholtBankExposureSections(tooLarge,128),/bounded fragment uniform/);
});
test('the shared shader retains v5 stage/floor ownership, uses packed original banks, and fails atomically on a bad knot extent',()=>{
 const sections=createEaldholtBankExposureSections(input,64),options={waterHeight:.3,woodland:{bank:{tileMetres:1.3,targetLuminance:.06},meadow:{albedo:{},meanLuminance:.07,targetLuminance:.07,tileMetres:2},sections}};
 const fixture=()=>({uniforms:{}as Record<string,{value:unknown}>,vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <aomap_fragment>'});
 const shader=fixture();patchEaldholtWoodlandValleySurface(shader,.06,'attribute',options);
 assert.equal(EALDHOLT_WOODLAND_BANK_ART_VERSION,'grounded-bank-earth-grass-rock-v5-local-stage');assert.match(shader.fragmentShader,/CROWNFALL_BANK_SOURCE_CONTACT/);assert.match(shader.fragmentShader,/CROWNFALL_BANK_AUTHORED_KNOTS/);assert.match(shader.fragmentShader,new RegExp(EALDHOLT_BANK_KNOT_PROGRAM_KEY));
 assert.deepEqual(shader.uniforms.uEaldholtValleyBankKnots.value,sections.authoredBanks.data);assert.notEqual(shader.uniforms.uEaldholtValleyBankKnots.value,sections.authoredBanks.data);assert.deepEqual(shader.uniforms.uEaldholtValleyWaterStages.value,sections.waterStages.data);assert.equal((shader.uniforms.uEaldholtValleyBank.value as Float32Array).length,128);
 const bad=fixture(),before=structuredClone(bad),wrong={...sections,authoredBanks:{...sections.authoredBanks,data:sections.authoredBanks.data.slice()}};wrong.authoredBanks.data[0]-=1;assert.throws(()=>patchEaldholtWoodlandValleySurface(bad,.06,'attribute',{...options,woodland:{...options.woodland,sections:wrong}}),/exposure extent/);assert.deepEqual(bad,before);
});

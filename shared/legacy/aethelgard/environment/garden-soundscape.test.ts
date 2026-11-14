import assert from 'node:assert/strict';
import test from 'node:test';
import {createGardenSoundscape,type GardenSoundscapeFrame} from './garden-soundscape';

class Param {
  value=0;setValueAtTime(value:number){this.value=value;return this;}
  exponentialRampToValueAtTime(value:number){this.value=value;return this;}
  setTargetAtTime(value:number){this.value=value;return this;}
  cancelScheduledValues(){return this;}
}
class Node {
  gain=new Param();frequency=new Param();Q=new Param();pan=new Param();buffer:unknown;loop=false;type='';
  started=false;stopped=false;disconnected=false;
  connect(target:unknown){return target;}
  disconnect(){this.disconnected=true;}
  start(){this.started=true;}
  stop(at?:number){if(at===undefined)this.stopped=true;}
}
function owner() {
  const nodes:Node[]=[];let resumes=0,closes=0;
  const create=()=>{const node=new Node();nodes.push(node);return node;};
  const ctx={currentTime:0,sampleRate:800,state:'running',destination:{},createGain:create,createBufferSource:create,createBiquadFilter:create,createOscillator:create,createStereoPanner:create,
    createBuffer(channels:number,length:number){const data=Array.from({length:channels},()=>new Float32Array(length));return {getChannelData:(channel:number)=>data[channel]};},
    resume(){resumes++;return Promise.resolve();},close(){closes++;return Promise.resolve();}};
  return {ctx:ctx as unknown as AudioContext,raw:ctx,nodes,get resumes(){return resumes;},get closes(){return closes;}};
}
const frame:GardenSoundscapeFrame={animationSeconds:0,daylight:1,wind:[1,0],windStrength:.4,reducedMotion:false,rain:0,nearWater:1};

test('soundscape remains silent before consent and leaves owner context lifetime untouched',()=>{
  const o=owner(),sound=createGardenSoundscape(o.ctx);sound.update(frame);
  assert.equal(o.nodes.length,0);sound.setEnabled(true);assert.equal(sound.stats.loopSources,4);assert.equal(sound.stats.active,true);
  const running=o.nodes.filter(n=>n.started);assert.equal(running.length,4);
  sound.setActive(false);assert.ok(running.every(n=>n.stopped));assert.ok(o.nodes.every(n=>n.disconnected));assert.equal(sound.stats.active,false);
  sound.dispose();sound.dispose();assert.equal(o.resumes,0);assert.equal(o.closes,0);assert.equal(sound.stats.disposed,true);
});

test('suspended owner context is never resumed; pause and rainy day/night transitions stop all voices',()=>{
  const o=owner();o.raw.state='suspended';const sound=createGardenSoundscape(o.ctx,{seed:64});sound.setEnabled(true);sound.update(frame);
  assert.equal(o.nodes.length,0);assert.equal(o.resumes,0);o.raw.state='running';sound.update(frame);
  for(let i=1;i<20;i++){o.raw.currentTime=i*9;sound.update({...frame,animationSeconds:i*9});}
  assert.ok(sound.stats.birdPhrases>0);assert.equal(sound.stats.cricketPhrases,0);
  o.raw.currentTime+=10;sound.update({...frame,daylight:0});assert.ok(sound.stats.cricketPhrases>0);
  o.raw.currentTime+=.1;sound.update({...frame,daylight:0,rain:1});assert.equal(sound.stats.voices,0);
  const count=sound.stats.birdPhrases+sound.stats.cricketPhrases;
  sound.update({...frame,paused:true});assert.equal(sound.stats.loopSources,0);assert.equal(sound.stats.active,false);
  o.raw.currentTime+=10000;sound.update({...frame,daylight:0});assert.equal(sound.stats.birdPhrases+sound.stats.cricketPhrases,count,'resume schedules ahead without a backlog burst');
  sound.setEnabled(false);assert.equal(sound.stats.active,false);assert.equal(sound.stats.loopSources,0);sound.dispose();assert.equal(o.resumes,0);assert.equal(o.closes,0);
});

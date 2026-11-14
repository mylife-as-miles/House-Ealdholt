/** Procedural Soundscape adapted from apps/viewer/web/garden.html:278-457 in
 * SamG-Coder/solstice-garden@03f0aef9c0f032105c973b97005a482e639032f2.
 * Copyright (c) 2026 SamG-Coder, MIT; full notice: ./LICENSE.solstice.txt.
 * Retains its noise bands, lapping modulation and swept sine bird/cricket
 * phrases. The village frame replaces all recursive source timers. Context,
 * permission, volume routing and resume/suspend belong to the existing owner.
 */
import {clampGardenUnit,solsticePcg,type GardenLifeFrame} from './garden-particles';
export interface GardenSoundscapeFrame extends GardenLifeFrame { readonly nearWater?:number; }
type Voice={sources:AudioScheduledSourceNode[];nodes:AudioNode[];endsAt:number;kind:'bird'|'cricket'};
type Graph={master:GainNode;leaves:GainNode;air:GainNode;water:GainNode;nodes:AudioNode[];sources:AudioScheduledSourceNode[]};

/** Silent until explicitly enabled and given an active frame and a running
 * owner context. Never constructs, resumes, suspends or closes AudioContext. */
export function createGardenSoundscape(context:AudioContext,options:{destination?:AudioNode;seed?:number}={}) {
  let enabled=false,active=true,disposed=false,frame:GardenSoundscapeFrame|undefined,graph:Graph|undefined;
  let randomState=options.seed??0x51c57ace,nextBird=Infinity,nextCricket=Infinity;
  const voices:Voice[]=[];
  const stats={enabled:false,active:false,status:'disabled',voices:0,loopSources:0,birdPhrases:0,cricketPhrases:0,disposed:false};
  const random=()=>{randomState=solsticePcg(randomState);return (randomState>>>8)/16777216;};
  function retire(voice:Voice) {
    for(const source of voice.sources){try{source.stop();}catch{/* A finished source is already stopped. */}}
    for(const node of voice.nodes)node.disconnect();
  }
  function stop() {
    for(const voice of voices)retire(voice);voices.length=0;
    if(graph){graph.master.gain.cancelScheduledValues(context.currentTime);graph.master.gain.value=0;
      for(const source of graph.sources){try{source.stop();}catch{/* Context may already be closed. */}}
      for(const node of graph.nodes)node.disconnect();graph=undefined;}
    stats.active=false;stats.voices=stats.loopSources=0;nextBird=nextCricket=Infinity;
  }
  function build() {
    const nodes:AudioNode[]=[],sources:AudioScheduledSourceNode[]=[];
    const own=<T extends AudioNode>(node:T)=>{nodes.push(node);return node;};
    const master=own(context.createGain());master.gain.value=.55;master.connect(options.destination??context.destination);
    const leaves=own(context.createGain()),air=own(context.createGain()),water=own(context.createGain());
    leaves.gain.value=air.gain.value=water.gain.value=0;leaves.connect(master);air.connect(master);water.connect(master);
    function noise(seconds:number,brown:boolean) {
      const buffer=context.createBuffer(2,Math.max(1,Math.floor(context.sampleRate*seconds)),context.sampleRate);
      for(let channel=0;channel<2;channel++) {const data=buffer.getChannelData(channel);let last=0;
        for(let i=0;i<data.length;i++){const white=random()*2-1;last=brown?(last+.02*white)/1.02:white;data[i]=brown?last*3.5:white;}}
      return buffer;
    }
    const white=noise(3,false),brown=noise(4,true);
    function band(buffer:AudioBuffer,type:BiquadFilterType,frequency:number,q:number,destination:AudioNode) {
      const source=own(context.createBufferSource()),filter=own(context.createBiquadFilter());
      source.buffer=buffer;source.loop=true;filter.type=type;filter.frequency.value=frequency;filter.Q.value=q;
      source.connect(filter);filter.connect(destination);sources.push(source);source.start();
    }
    band(white,'bandpass',2600,.6,leaves);band(brown,'lowpass',420,.3,air);
    const lap=own(context.createGain()),wobble=own(context.createOscillator()),depth=own(context.createGain());
    lap.gain.value=.5;wobble.frequency.value=.37;depth.gain.value=.35;wobble.connect(depth);depth.connect(lap.gain);lap.connect(water);
    band(white,'bandpass',900,2.5,lap);sources.push(wobble);wobble.start();
    graph={master,leaves,air,water,nodes,sources};stats.loopSources=sources.length;
    nextBird=context.currentTime+1.5+random()*6.5;nextCricket=context.currentTime+.38+random()*.3;
  }
  function phrase(kind:Voice['kind'],volume:number) {
    const pan=context.createStereoPanner(),far=context.createGain();pan.pan.value=random()*1.8-.9;far.gain.value=volume;
    pan.connect(far);far.connect(graph!.master);
    const voice:Voice={sources:[],nodes:[pan,far],endsAt:context.currentTime,kind};voices.push(voice);
    let t=context.currentTime+.025;
    return {
      pause(seconds:number){t+=seconds;},
      note(from:number,to:number,lasts:number,trill=0,amplitude=1) {
        const osc=context.createOscillator(),gain=context.createGain();voice.sources.push(osc);voice.nodes.push(osc,gain);
        osc.type='sine';osc.frequency.setValueAtTime(from,t);osc.frequency.exponentialRampToValueAtTime(to,t+lasts);
        gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(Math.max(.0002,amplitude),t+Math.min(.02,lasts*.3));gain.gain.exponentialRampToValueAtTime(.0001,t+lasts);
        if(trill){const lfo=context.createOscillator(),amount=context.createGain();lfo.frequency.value=trill;amount.gain.value=from*.06;
          lfo.connect(amount);amount.connect(osc.frequency);voice.sources.push(lfo);voice.nodes.push(lfo,amount);lfo.start(t);lfo.stop(t+lasts);}
        osc.connect(gain);gain.connect(pan);osc.start(t);osc.stop(t+lasts+.02);voice.endsAt=t+lasts+.03;t+=lasts;
      }
    };
  }
  function bird() {
    const p=phrase('bird',.03+random()*.09),kind=Math.floor(random()*4);
    if(kind===0){for(let i=0,n=5+Math.floor(random()*7);i<n;i++){const f=2600+random()*2600;p.note(f,f*(.75+random()*.6),.06+random()*.09);p.pause(.02+random()*.06);}}
    else if(kind===1){const high=4200+random()*600,low=3300+random()*400;for(let i=0,n=3+Math.floor(random()*2);i<n;i++){p.note(high,high*.98,.11);p.pause(.03);p.note(low,low*.98,.13);p.pause(.07);}}
    else if(kind===2){for(let i=0,n=3+Math.floor(random()*3);i<n;i++){const f=1500+random()*1200;p.note(f,f*(.85+random()*.45),.16+random()*.2,random()<.3?28:0);p.pause(.04+random()*.1);}}
    else {const f=3600+random()*1500;p.note(f,f*1.05,.5+random()*.6,22+random()*14);}
    stats.birdPhrases++;
  }
  function sync() {
    const ready=enabled&&active&&frame&&frame.active!==false&&!frame.paused&&context.state==='running'&&!disposed;
    stats.enabled=enabled;
    if(!ready){stop();stats.status=disposed?'disposed':!enabled?'disabled':context.state!=='running'?'awaiting-owner-context':'inactive';return;}
    if(!graph)build();stats.active=true;stats.status='active';
  }
  return {stats,
    setEnabled(value:boolean) {if(disposed)return;enabled=value;sync();},
    setActive(value:boolean) {if(disposed)return;active=value;sync();},
    update(value:GardenSoundscapeFrame) {
      if(disposed)return;frame=value;sync();if(!graph)return;
      const now=context.currentTime,day=clampGardenUnit(value.daylight),rain=clampGardenUnit(value.rain??0),wind=clampGardenUnit(value.windStrength),calm=1-rain;
      // Source gust bands; no wall-clock job or independent weather simulation.
      const time=Number.isFinite(value.animationSeconds)?value.animationSeconds:0,gust=.75+.25*Math.sin(time*.27);
      graph.leaves.gain.setTargetAtTime((.012+.03*wind*gust)*calm,now,.8);
      graph.air.gain.setTargetAtTime((.03+.05*wind*gust)*calm,now,1.2);
      graph.water.gain.setTargetAtTime(.05*clampGardenUnit(value.nearWater??0),now,.8);
      for(let i=voices.length-1;i>=0;i--){const v=voices[i];if(v.endsAt<=now||rain>.55||(v.kind==='bird'?day<.25:day>.55)){retire(v);voices.splice(i,1);}}
      // At most one new phrase per kind per frame; a long gap never catches up.
      if(now>=nextBird){nextBird=now+1.5+random()*6.5;if(day>=.25&&rain<.3&&random()<day&&voices.length<4)bird();}
      if(now>=nextCricket){nextCricket=now+.38+random()*.3;if(day<=.55&&rain<.55&&voices.length<4){const p=phrase('cricket',1),f=4300+random()*300;for(let i=0;i<3;i++){p.note(f,f,.045,0,.012*(1-day)*calm);p.pause(.01);}stats.cricketPhrases++;}}
      stats.voices=voices.length;
    },
    dispose() {if(disposed)return;disposed=true;enabled=false;stop();stats.enabled=false;stats.disposed=true;stats.status='disposed';}
  };
}

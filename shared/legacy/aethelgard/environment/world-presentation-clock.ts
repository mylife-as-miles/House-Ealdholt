import type {VillagePopulationRuntime,VillagePopulationTime} from '../characters/village-population-runtime';

type Source=Pick<VillagePopulationRuntime,'worldKey'|'clock'>;
/** Interpolates pixels between completed clock samples. This owns no timer,
 * world advancement, events, persistence, navigation or physical work credit.
 * It can approach the next causal minute but cannot cross its boundary. */
export function createWorldPresentationClock(){
 let identity='',lastLogical=-1,anchor=0,at=0,rate=0,lastNow=0,lastShown=0;
 const reset=()=>{identity='';lastLogical=-1;anchor=0;at=0;rate=0;lastNow=0;lastShown=0;};
 return{reset,sample(source:Source,nowMilliseconds:number,speed:number):{time:VillagePopulationTime;animationSeconds:number}{
  const c=source.clock,pace=c.millisecondsPerWorldMinute,logical=c.simulatedElapsedMilliseconds;
  if(!Number.isFinite(nowMilliseconds)||!Number.isFinite(speed)||speed<0||!Number.isFinite(pace)||pace<=0||!Number.isFinite(logical)||logical<0)throw Error('Presentation interpolation requires the existing finite clock and speed.');
  const nextIdentity=JSON.stringify([source.worldKey,c.createdAt,c.initialDayMinute,pace]);
  const now=Math.max(lastNow,nowMilliseconds),cap=(Math.floor(logical/pace)+1)*pace-Math.min(.001,pace*.000001);
  if(identity!==nextIdentity||logical<lastLogical){reset();identity=nextIdentity;anchor=logical;at=now;lastShown=logical;rate=speed;}
  else if(logical!==lastLogical){anchor=logical;at=now;rate=speed;}
  else if(speed!==rate){anchor=Math.min(cap,anchor+Math.max(0,now-at)*rate);at=now;rate=speed;}
  let shown=Math.min(cap,anchor+Math.max(0,now-at)*rate);
  // A newly accepted sample may trail the interpolated pose by a few ms.
  // Hold that pose until caught up; no clock record is rewritten to do so.
  shown=Math.min(cap,Math.max(logical,lastShown,shown));lastShown=shown;lastLogical=logical;lastNow=now;
  const whole=Math.floor(shown/pace),absolute=c.initialDayMinute+whole;
  return{time:{absoluteWorldMinute:absolute,dayIndex:Math.floor(absolute/1440),dayMinute:absolute%1440,
   fractionalMinute:(shown-whole*pace)/pace,elapsedWorldMinutes:shown/pace,deferredMilliseconds:c.pendingMilliseconds},
   animationSeconds:(c.initialDayMinute*pace+shown)/1000};
 }};
}

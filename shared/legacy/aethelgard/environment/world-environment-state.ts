import type {VillagePopulationTime} from '../characters/village-population-runtime';
import {sampleWorldCelestial,type WorldCelestialState} from './world-celestial';
export type WorldWeatherKind='clear'|'overcast'|'rain';
export function worldHazeDistance(state:Pick<WorldEnvironmentState,'rain'|'cloudCoverage'>|null){
 return 18000/(1+Math.max(0,Math.min(1,state?.rain??0))*3+Math.max(0,Math.min(1,state?.cloudCoverage??0))*.25);
}
export interface WorldEnvironmentState{
 readonly absoluteMinute:number;readonly dayIndex:number;readonly hour:number;readonly minute:number;
 readonly daylight:number;readonly sunDirection:readonly[number,number,number];readonly sunColour:readonly[number,number,number];readonly sunIntensity:number;
 readonly moonIntensity:number;readonly skyZenith:readonly[number,number,number];readonly skyHorizon:readonly[number,number,number];
 readonly cloudCoverage:number;readonly cloudTransmission:number;readonly rain:number;readonly wetness:number;readonly wind:readonly[number,number];readonly windStrength:number;
 readonly weather:WorldWeatherKind;readonly worldSeconds:number;
 readonly celestial:WorldCelestialState;
}
const clamp=(v:number)=>Math.max(0,Math.min(1,v)),smooth=(a:number,b:number,v:number)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
function seed(key:string){let h=2166136261;for(let i=0;i<key.length;i++)h=Math.imul(h^key.charCodeAt(i),16777619);return h>>>0;}
function hash(a:number,b:number){let h=Math.imul(a^b,374761393);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;}
function weatherAt(period:number,key:number){const h=hash(period,key);return{coverage:.18+h*.7,rain:smooth(.66,.96,h),wind:.16+hash(period,key^0x213412)*.7};}
/** Rendering is a projection of the existing persisted population clock. It
 * never advances, resets or writes that clock, and has no frame-rate input.
 * Weather spans four world hours, with a 40-minute eased transition. */
/** Replaces the seeded weather (My Legacy's observer commands the sky: rain strength and wind as well as the kind). */
export interface WorldEnvironmentOverride{readonly weather?:WorldWeatherKind;readonly cloudCoverage?:number;readonly rain?:number;readonly windStrength?:number}
export function sampleWorldEnvironment(time:VillagePopulationTime,worldKey:string,override?:WorldEnvironmentOverride):WorldEnvironmentState{
 const absolute=time.absoluteWorldMinute+time.fractionalMinute;
 if(!Number.isFinite(absolute)||absolute<0||!worldKey)throw Error('Environment needs the authoritative world time and identity.');
 const minute=((absolute%1440)+1440)%1440,phase=(minute-360)/1440*Math.PI*2;
 const direction=[Math.cos(phase)*.82,Math.sin(phase)*.98,.36] as [number,number,number],length=Math.hypot(...direction);for(let i=0;i<3;i++)direction[i]/=length;
 const daylight=smooth(-.08,.22,direction[1]),warm=1-smooth(.06,.65,direction[1]);
 const period=Math.floor(absolute/240),transition=smooth(0,40,absolute-period*240),worldSeed=seed(worldKey),a=weatherAt(period-1,worldSeed),b=weatherAt(period,worldSeed);
 let coverage=a.coverage+(b.coverage-a.coverage)*transition,rain=a.rain+(b.rain-a.rain)*transition;
 if(override?.weather){rain=override.weather==='rain'?.85:0;coverage=override.weather==='clear'?.22:override.weather==='overcast'?.78:.91;}
 if(override?.cloudCoverage!==undefined)coverage=clamp(override.cloudCoverage);
 if(override?.rain!==undefined)rain=clamp(override.rain);
 const windStrength=override?.windStrength!==undefined?clamp(override.windStrength):a.wind+(b.wind-a.wind)*transition,angle=.35+Math.sin(absolute/1900)*.24;
 const cloudTransmission=1-coverage*.48,night=1-daylight,weather:WorldWeatherKind=rain>.18?'rain':coverage>.6?'overcast':'clear';
 const celestial=sampleWorldCelestial(absolute,direction);
 let wetness=rain;for(let past=1;past<=3;past++)wetness=Math.max(wetness,weatherAt(period-past,worldSeed).rain*Math.exp(-(absolute-(period-past+1)*240)/180)*.8);
 const mix=(night:readonly[number,number,number],day:readonly[number,number,number])=>night.map((v,i)=>v+(day[i]-v)*daylight) as [number,number,number];
 const zenith=mix([.004,.009,.022],[.17,.34,.56]),horizon=mix([.016,.025,.047],[.64,.73,.77]);
 for(let i=0;i<3;i++){zenith[i]*=1-coverage*.22;horizon[i]*=1-coverage*.15;}
 horizon[0]+=warm*daylight*.16;horizon[1]+=warm*daylight*.035;
 return{absoluteMinute:absolute,dayIndex:Math.floor(absolute/1440),hour:Math.floor(minute/60),minute:Math.floor(minute%60),daylight,
 sunDirection:direction,sunColour:[1,1-warm*.27,.91-warm*.48],sunIntensity:2.6*daylight*cloudTransmission,
 moonIntensity:.12*night*celestial.moonIllumination*celestial.moonVisibility*cloudTransmission,skyZenith:zenith,skyHorizon:horizon,cloudCoverage:coverage,cloudTransmission,rain,wetness:clamp(wetness),wind:[Math.cos(angle),Math.sin(angle)],windStrength,weather,worldSeconds:absolute*60,celestial};
}

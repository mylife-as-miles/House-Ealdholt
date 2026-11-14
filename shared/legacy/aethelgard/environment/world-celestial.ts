/** Celestial appearance is a pure projection of the persisted world calendar.
 * No wall clock, assets, renderer, timers or saved-state migration live here. */
export interface WorldCelestialState {
 readonly moonPhase:number;
 readonly moonIllumination:number;
 readonly moonDirection:readonly[number,number,number];
 readonly orbitTangent:readonly[number,number,number];
 readonly starRotationRadians:number;
 readonly nightVisibility:number;
 readonly moonWashout:number;
 readonly moonVisibility:number;
}
export const WORLD_LUNAR_PERIOD_DAYS=29.530588;
const TAU=Math.PI*2;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** The initial calendar epoch is waxing gibbous. It changes only with the
 * existing saved world minute, never the machine date or animation seconds. */
export function sampleWorldCelestial(absoluteMinute:number,sunDirection:readonly[number,number,number]):WorldCelestialState{
 if(!Number.isFinite(absoluteMinute)||absoluteMinute<0||sunDirection.some(v=>!Number.isFinite(v))||Math.abs(Math.hypot(...sunDirection)-1)>1e-6)throw Error('Celestial sampling needs the authoritative minute and normalized sun.');
 const moonPhase=((absoluteMinute/(1440*WORLD_LUNAR_PERIOD_DAYS)+.375)%1+1)%1,elongation=moonPhase*TAU;
 const daily=(absoluteMinute%1440-360)/1440*TAU,tangent=[-.82*Math.sin(daily),.98*Math.cos(daily),0];
 const along=tangent.reduce((n,v,i)=>n+v*sunDirection[i],0);for(let i=0;i<3;i++)tangent[i]-=along*sunDirection[i];
 let magnitude=Math.hypot(...tangent);
 if(magnitude<1e-10){tangent[0]=Math.abs(sunDirection[0])<.9?1:0;tangent[1]=0;tangent[2]=tangent[0]?0:1;const dot=tangent.reduce((n,v,i)=>n+v*sunDirection[i],0);for(let i=0;i<3;i++)tangent[i]-=dot*sunDirection[i];magnitude=Math.hypot(...tangent);}
 for(let i=0;i<3;i++)tangent[i]/=magnitude;
 const moonDirection=sunDirection.map((v,i)=>v*Math.cos(elongation)-tangent[i]*Math.sin(elongation))as[number,number,number];
 const moonIllumination=(1-Math.cos(elongation))*.5,nightVisibility=1-smooth(-.20,-.05,sunDirection[1]),moonVisibility=smooth(-.015,.08,moonDirection[1]);
 return{moonPhase,moonIllumination,moonDirection,orbitTangent:tangent as[number,number,number],starRotationRadians:((absoluteMinute/1440*1.00273790935)%1)*TAU,nightVisibility,moonVisibility,moonWashout:Math.pow(moonIllumination,1.5)*moonVisibility*nightVisibility};
}

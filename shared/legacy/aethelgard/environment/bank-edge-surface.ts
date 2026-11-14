/** Material contact only. Original terrain, channel vertices, collisions and
 * navigation are not altered. Heights are the authored channel surface stage,
 * not water depth, groundwater or a fabricated river bed. */
export interface EaldholtChannelStages {
  readonly count:number;
  /** Source-X / surface-Y pairs, ordered by X. */
  readonly data:Float32Array;
  readonly maximumError:number;
}
export const EALDHOLT_BANK_EDGE=Object.freeze({
  contactHeight:Object.freeze([.005,.14]as const),contactDistance:Object.freeze([.06,.55]as const),
  dampHeight:Object.freeze([.06,.4]as const),dampDistance:Object.freeze([.15,1.1]as const),
  widthVariation:Object.freeze([.55,1.35]as const),pebbleMaximum:.2,
  channelDistance:Object.freeze([2.4,4]as const),
});
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const smooth=(a:number,b:number,n:number)=>{const t=clamp((n-a)/(b-a));return t*t*(3-2*t);};

/** Retain every knot for changing slopes. The actual Crownfall channel has an
 * affine stage; collapsing its Float32 roundoff to two endpoints is bounded to
 * one micrometre and avoids a per-fragment search over dozens of uniform rows. */
export function createEaldholtChannelStages(channel:ArrayLike<number>):EaldholtChannelStages{
 if(channel.length<8||channel.length%4||channel.length/4>129)throw Error('Channel stages require 2–129 source [x, low, high, level] rows.');
 const pairs:number[]=[];
 for(let i=0;i<channel.length;i+=4){const x=channel[i],low=channel[i+1],high=channel[i+2],y=channel[i+3];
  if(![x,low,high,y].every(Number.isFinite)||low>=high||i>0&&x<=channel[i-4])throw Error('Invalid authored channel stage.');pairs.push(x,y);
 }
 const end=pairs.length-2,x0=pairs[0],y0=pairs[1],x1=pairs[end],y1=pairs[end+1];let maximumError=0;
 for(let i=2;i<end;i+=2)maximumError=Math.max(maximumError,Math.abs(pairs[i+1]-(y0+(y1-y0)*(pairs[i]-x0)/(x1-x0))));
 const data=Float32Array.from(maximumError<=1e-6?[x0,y0,x1,y1]:pairs),result={count:data.length/2,data,maximumError:maximumError<=1e-6?maximumError:0};
 if(!validEaldholtChannelStages(result))throw Error('Unrepresentable authored channel stage.');
 // Include Float32 transport roundoff in the advertised error bound.
 let storedError=0;for(let i=0;i<pairs.length;i+=2)storedError=Math.max(storedError,Math.abs(sampleEaldholtChannelStage(result,pairs[i])-pairs[i+1]));
 if(storedError>1e-6)throw Error('Channel stage exceeds its source precision bound.');
 return{...result,maximumError:storedError};
}
export function validEaldholtChannelStages(stages:EaldholtChannelStages):boolean{
 if(!stages||!Number.isSafeInteger(stages.count)||stages.count<2||stages.count>129||!(stages.data instanceof Float32Array)||stages.data.length!==stages.count*2||!Number.isFinite(stages.maximumError)||stages.maximumError<0||stages.maximumError>1e-6)return false;
 for(let i=0;i<stages.data.length;i+=2)if(!Number.isFinite(stages.data[i])||!Number.isFinite(stages.data[i+1])||i>0&&stages.data[i]<=stages.data[i-2])return false;
 return true;
}
/** C0 at each exact supplied knot; clamp outside the channel, where the
 * caller's existing reach mask retains coast/sea shading independently. */
export function sampleEaldholtChannelStage(stages:EaldholtChannelStages,x:number):number{
 if(!validEaldholtChannelStages(stages)||!Number.isFinite(x))throw Error('Invalid channel-stage sample.');
 const p=stages.data,last=p.length-2;if(x<=p[0])return p[1];if(x>=p[last])return p[last+1];
 let low=0,high=stages.count-1;while(high-low>1){const middle=(low+high)>>>1;if(p[middle*2]<=x)low=middle;else high=middle;}
 const a=low*2,b=high*2;return p[a+1]+(p[b+1]-p[a+1])*(x-p[a])/(p[b]-p[a]);
}
export interface EaldholtBankEdgeInput{distance:number;heightAboveWater:number;field:number;fine:number;reach:number}
export function ealdholtBankChannelInfluence(distance:number,reach:number):number{
 if(!Number.isFinite(distance)||!Number.isFinite(reach))throw Error('Invalid channel influence.');
 return clamp(reach)*(1-smooth(...EALDHOLT_BANK_EDGE.channelDistance,Math.max(0,distance)));
}
/** Preserve the prior sea-plane height classification away from the river.
 * The full local stage is used throughout the narrower physical contact. */
export function ealdholtBankSurfaceStage(stages:EaldholtChannelStages,x:number,distance:number,reach:number,seaLevel:number):number{
 if(!Number.isFinite(seaLevel))throw Error('Invalid sea surface stage.');
 const influence=ealdholtBankChannelInfluence(distance,reach);
 return seaLevel*(1-influence)+sampleEaldholtChannelStage(stages,x)*influence;
}
/** CPU twin of the contact material mask. Deliberate exposed gaps come from
 * the existing source-metre fields; a real wet contact remains continuous. */
export function ealdholtBankEdge(input:EaldholtBankEdgeInput){
 if(!Object.values(input).every(Number.isFinite))throw Error('Invalid bank-edge material sample.');
 const b=EALDHOLT_BANK_EDGE,d=Math.max(0,input.distance),h=Math.max(0,input.heightAboveWater),reach=clamp(input.reach),field=clamp(input.field),fine=clamp(input.fine);
 const width=b.widthVariation[0]+(b.widthVariation[1]-b.widthVariation[0])*field;
 const contact=(1-smooth(...b.contactHeight,h))*(1-smooth(...b.contactDistance,d))*reach;
 const damp=(1-smooth(...b.dampHeight,h))*(1-smooth(b.dampDistance[0]*width,b.dampDistance[1]*width,d))*reach;
 const pebble=b.pebbleMaximum*damp*smooth(.42,.78,fine);
 return{contact,damp,pebble};
}
/** Only the nearby channel replaces the old mask. Existing coast/sea wetness
 * remains the fallback outside this bounded reach. */
export function ealdholtBankEdgeWetness(input:EaldholtBankEdgeInput,fallback:number):number{
 if(!Number.isFinite(fallback))throw Error('Invalid bank-edge fallback.');
 const edge=ealdholtBankEdge(input),influence=ealdholtBankChannelInfluence(input.distance,input.reach);
 return clamp(fallback)*(1-influence)+edge.damp*influence;
}
/** Existing litter must not erase the contact material after its PBR layers
 * run. Only broken, already meadow-classified upper-bank patches lose litter. */
export function ealdholtBankFloorRetention(input:EaldholtBankEdgeInput,meadowWeight:number):number{
 if(!Number.isFinite(meadowWeight))throw Error('Invalid bank meadow weight.');
 const edge=ealdholtBankEdge(input),influence=ealdholtBankChannelInfluence(input.distance,input.reach);
 return 1-influence*Math.max(edge.damp,.65*smooth(.3,.7,clamp(input.fine))*clamp(meadowWeight));
}

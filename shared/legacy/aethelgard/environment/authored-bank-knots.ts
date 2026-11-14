/** Live material lookup only. Source geometry, hydro/navigation and persistent
 * bake identities do not depend on this version. */
export const EALDHOLT_BANK_KNOT_PROGRAM_KEY=':authored-bank-knots-v1';
/** Reserve at least96 of WebGL2's minimum224 fragment uniform vectors for the
 * existing PBR/lighting/weather path. Actual full programs still require linking. */
export const EALDHOLT_BANK_LOOKUP_MAXIMUM_VECTORS=128;
export interface EaldholtAuthoredBankKnots{
 readonly count:number;
 /** Original [source X, lower Z, upper Z] scalars packed across vec4 slots.
  * Padding is zero; array elements must not waste a full vector per scalar. */
 readonly data:Float32Array;
}
export function validEaldholtAuthoredBankKnots(value:EaldholtAuthoredBankKnots):boolean{
 if(!value||!Number.isSafeInteger(value.count)||value.count<2||value.count>129||!(value.data instanceof Float32Array)||value.data.length!==Math.ceil(value.count*3/4)*4)return false;
 const p=value.data;for(let i=0;i<value.count;i++){const at=i*3;if(!Number.isFinite(p[at])||!Number.isFinite(p[at+1])||!Number.isFinite(p[at+2])||p[at+1]>=p[at+2]||i>0&&p[at]<=p[at-3])return false;}
 for(let i=value.count*3;i<p.length;i++)if(p[i]!==0)return false;
 return true;
}
export function createEaldholtAuthoredBankKnots(channel:ArrayLike<number>):EaldholtAuthoredBankKnots{
 if(channel.length<8||channel.length%4||channel.length/4>129)throw Error('Authored bank knots need2–129 [x, low, high, stage] rows.');
 const count=channel.length/4,data=new Float32Array(Math.ceil(count*3/4)*4);
 for(let i=0;i<count;i++)for(let lane=0;lane<3;lane++)data[i*3+lane]=channel[i*4+lane];
 const result={count,data};if(!validEaldholtAuthoredBankKnots(result))throw Error('Invalid authored bank knots.');
 return result;
}
/** CPU twin of the shader's original-knot search; clamp beyond authored ends.
 * Exposure/reach remain the existing separately sampled, smoothed art fields. */
export function sampleEaldholtAuthoredBanks(knots:EaldholtAuthoredBankKnots,x:number):readonly[number,number]{
 if(!validEaldholtAuthoredBankKnots(knots)||!Number.isFinite(x))throw Error('Invalid authored bank sample.');
 const p=knots.data;let lo=0,hi=knots.count-1;
 while(hi-lo>1){const mid=(lo+hi)>>>1;if(p[mid*3]<=x)lo=mid;else hi=mid;}
 const a=lo*3,b=hi*3,t=Math.max(0,Math.min(1,(x-p[a])/(p[b]-p[a])));
 return[p[a+1]+(p[b+1]-p[a+1])*t,p[a+2]+(p[b+2]-p[a+2])*t];
}
/** Keep every existing Float32 exposure value; two pairs share one vec4. */
export function packEaldholtBankExposure(data:Float32Array,count:number):Float32Array{
 if(!Number.isSafeInteger(count)||count<8||count>128||data.length!==count*4)throw Error('Invalid bank exposure packing.');
 const packed=new Float32Array(Math.ceil(count/2)*4);
 for(let i=0;i<count;i++){const near=data[i*4+2],far=data[i*4+3];if(!Number.isFinite(near)||!Number.isFinite(far))throw Error('Nonfinite bank exposure.');packed[i*2]=near;packed[i*2+1]=far;}
 return packed;
}
export function ealdholtBankLookupUniformVectors(knots:number,exposure:number,stages:number):number{
 if(!Number.isSafeInteger(knots)||knots<2||knots>129||!Number.isSafeInteger(exposure)||exposure<8||exposure>128||!Number.isSafeInteger(stages)||stages<2||stages>129)throw Error('Invalid bank uniform profile.');
 const vectors=Math.ceil(knots*3/4)+Math.ceil(exposure/2)+stages+1;
 if(vectors>EALDHOLT_BANK_LOOKUP_MAXIMUM_VECTORS)throw Error('Authored bank lookup exceeds its bounded fragment uniform profile.');
 return vectors;
}

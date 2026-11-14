export const CROWNFALL_WATER_SOURCE:Readonly<{repository:string;commit:string;author:string;license:string;publication:string;files:Readonly<Record<string,string>>}>;
/** Compatibility metadata aliases for original Crownfall water only. */
export const ALPINE_SOURCE:typeof CROWNFALL_WATER_SOURCE;
export const ALPINE_COMMON_GLSL:string;
export const ALPINE_WATER_GLSL:string;
export interface AlpineWaterLook {
  inScatter:readonly[number,number,number];skyLow:readonly[number,number,number];skyHigh:readonly[number,number,number];
  bedLow:readonly[number,number,number];bedHigh:readonly[number,number,number];opticalDepthSlope:number;skyCloudMix:number;
}
export const CROWNFALL_ALPINE_LOOK:Readonly<AlpineWaterLook>;
export function createCrownfallEstateWater(options:{THREE:any;profile?:'desktop'|'quest';waterLevel?:number;extent?:number;look?:Partial<AlpineWaterLook>}):{
  root:any;update(delta:number,camera?:any):void;setReducedMotion(value:boolean):void;
  getInfo():{included:boolean;assetId:string;source:{id:string;repository:string;commit:string;path:string;generator:string;license:string};shader:any;triangles:number;drawCalls:number;time:number;reducedMotion:boolean;permissionRecordPending:boolean;usesUpstreamAlpineCode?:boolean};
  dispose():void;
};
export const createAlpineWater:typeof createCrownfallEstateWater;

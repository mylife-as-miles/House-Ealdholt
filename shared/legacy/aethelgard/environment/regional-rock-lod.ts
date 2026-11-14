/** Select between the two already-resident scan meshes. A projected sphere is
 * a conservative screen-size proxy, not a geometric-error or visibility proof. */
export const REGIONAL_ROCK_LOD_VERSION='resident-rock-screen-size-v1';
export type RegionalRockQuality='low'|'medium'|'high';
export const REGIONAL_ROCK_LOD={
 desktop:{low:{range:650,near:100,enterPixels:20,exitPixels:16},medium:{range:1000,near:160,enterPixels:14,exitPixels:11.2},high:{range:1500,near:240,enterPixels:10,exitPixels:8}},
 native:{low:{range:280,near:60,enterPixels:24,exitPixels:19.2},medium:{range:280,near:60,enterPixels:18,exitPixels:14.4},high:{range:280,near:60,enterPixels:14,exitPixels:11.2}},
} as const;
export interface RegionalRockProjection {
 kind:'perspective'|'orthographic'|'unknown';projectionScaleX:number;projectionScaleY:number;drawBufferWidth:number;drawBufferHeight:number;
 nearPlane:number;viewDepth:number;viewOffset:number;radius:number;
}
function basisDot(a:ArrayLike<number>,x:number,y:number){return a[x]*a[y]+a[x+1]*a[y+1]+a[x+2]*a[y+2];}
/** Gershgorin bound of AᵀA. Unlike the longest basis column, this also safely
 * encloses a sphere when nonuniform parent scale plus rotation creates shear. */
export function regionalRockWorldScale(a:ArrayLike<number>):number|null{
 if(a.length!==16)return null;for(let i=0;i<16;i++)if(!Number.isFinite(a[i]))return null;
 const xy=Math.abs(basisDot(a,0,4)),xz=Math.abs(basisDot(a,0,8)),yz=Math.abs(basisDot(a,4,8));
 const radius=Math.sqrt(Math.max(basisDot(a,0,0)+xy+xz,basisDot(a,4,4)+xy+yz,basisDot(a,8,8)+xz+yz));
 return radius>0&&Number.isFinite(radius)?radius:null;
}
/** null retains the original distance policy. Wholly near-clipped/behind
 * spheres return zero; an intersected near plane stays conservatively detailed.
 * Perspective uses the nearest sphere depth, never its more distant centre. */
export function regionalRockPixelDiameter(p:RegionalRockProjection):number|null{
 if(p.kind==='unknown'||!Number.isFinite(p.projectionScaleX)||!Number.isFinite(p.projectionScaleY)||!Number.isFinite(p.drawBufferWidth)||!Number.isFinite(p.drawBufferHeight)
  ||!Number.isFinite(p.nearPlane)||!Number.isFinite(p.viewDepth)||!Number.isFinite(p.viewOffset)||!Number.isFinite(p.radius)
  ||p.projectionScaleX<=0||p.projectionScaleY<=0||p.drawBufferWidth<=0||p.drawBufferHeight<=0||p.nearPlane<=0||p.radius<=0||p.viewOffset<0)return null;
 if(p.viewDepth+p.radius<=p.nearPlane)return 0;
 if(p.viewDepth-p.radius<=p.nearPlane)return Infinity;
 const focal=Math.max(p.projectionScaleX*p.drawBufferWidth,p.projectionScaleY*p.drawBufferHeight);
 // Bound either screen axis, including off-axis perspective enlargement. The
 // max source scale bounds a nonuniform display transform before this step.
 const pixels=p.radius*focal/(p.kind==='perspective'?p.viewDepth-p.radius:1)*(p.kind==='perspective'?1+p.viewOffset/p.viewDepth:1);
 return Number.isFinite(pixels)?pixels:null;
}
export function regionalRockUsesNear(distance:number,pixels:number|null,wasNear:boolean,quality:RegionalRockQuality,native=false):boolean{
 const policy=REGIONAL_ROCK_LOD[native?'native':'desktop'][quality];
 if(!Number.isFinite(distance)||distance<0||distance>=policy.near)return false;
 if(pixels===null||Number.isNaN(pixels))return true;
 return pixels>=(wasNear?policy.exitPixels:policy.enterPixels);
}

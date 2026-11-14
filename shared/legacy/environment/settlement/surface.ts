import { hexToLinear } from '../kernel';
import { settlementHeight, settlementShore } from './layout';

const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const blend=(a:readonly number[],b:readonly number[],t:number):[number,number,number]=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const smooth=(x:number)=>x*x*(3-2*x);
const hash=(x:number,z:number)=>{const n=Math.sin(x*127.1+z*311.7)*43758.5453;return n-Math.floor(n);};
/** Original, continuous world-metre tint fields. Texture detail is supplied by
 * the existing owned grass/earth textures, rather than extra mesh overlays. */
function patch(x:number,z:number,scale:number):number {
 const xx=x/scale,zz=z/scale,ix=Math.floor(xx),iz=Math.floor(zz),fx=smooth(xx-ix),fz=smooth(zz-iz);
 return (hash(ix,iz)*(1-fx)+hash(ix+1,iz)*fx)*(1-fz)+(hash(ix,iz+1)*(1-fx)+hash(ix+1,iz+1)*fx)*fz;
}
const MEADOW=hexToLinear('#9b955f'),OLIVE=hexToLinear('#697c4d'),EARTH=hexToLinear('#a38a60'),LEAF=hexToLinear('#ad8248'),SAND=hexToLinear('#b6ad91'),WET=hexToLinear('#676f63');
/** Soft irregular swales are a surface treatment, not parcels or new terrain.
 * Their broad scale remains legible from the establishing camera without
 * adding repeated rows, screen-space noise or a new texture. */
function meadowSwale(x:number,z:number,cx:number,cz:number,rx:number,rz:number):number {
 const xx=(x-cx+2.2*Math.sin(z*.11))/rx,zz=(z-cz+1.8*Math.sin(x*.09))/rz;
 return smooth(clamp((1.15-Math.hypot(xx,zz))/.65));
}
export function settlementGroundTint(x:number,z:number):[number,number,number] {
 const coast=x-settlementShore(z),soil=clamp((patch(x+31,z-19,15)-.43)*1.65),leaf=clamp((patch(x-57,z+28,22)-.47)*1.6);
 const swale=Math.max(meadowSwale(x,z,-22,13,21,18),meadowSwale(x,z,38,29,25,22),meadowSwale(x,z,13,-48,26,17));
 const grass=clamp(swale*.82+(patch(x,z,25)-.28)*.55);
 let colour=blend(MEADOW,OLIVE,grass);colour=blend(colour,EARTH,soil*.42);colour=blend(colour,LEAF,leaf*.45*(1-swale*.55));
 // Mineral shoreline and slightly darker damp lip separate cool water from
 // the warm upland. The heightfield, shore position and dry-ground rule stay exact.
 if(coast<12)colour=blend(coast<2?WET:SAND,colour,smooth(clamp((coast-3)/9)));
 const shade=.88+.15*patch(x+3,z+11,8);return colour.map(v=>v*shade) as [number,number,number];
}
export interface SettlementRoadVertex {x:number;y:number;z:number;normal:readonly[number,number,number];tint:readonly[number,number,number];offset:number}
/** Three cross-road samples add a worn centre and broken, inset verges while
 * retaining the exact authored path corridor used by walking and placement. */
export function settlementRoadRow(x:number,z:number,nx:number,nz:number,width:number):readonly SettlementRoadVertex[] {
 const half=width*.5,left=half*(.86+.12*patch(x+13,z-4,3.7)),right=half*(.86+.12*patch(x-28,z+6,4.1));
 const wear=.92+.08*patch(x-5,z+3,2.6),edge=patch(x+7,z,5),edgeTint:[number,number,number]=[.60+edge*.08,.64+edge*.06,.42+edge*.06];
 return [left,0,-right].map((offset,i)=>{
  const xx=x+nx*offset,zz=z+nz*offset,dx=(settlementHeight(xx+1,zz)-settlementHeight(xx-1,zz))/2,dz=(settlementHeight(xx,zz+1)-settlementHeight(xx,zz-1))/2,length=Math.hypot(dx,1,dz);
  return {x:xx,y:settlementHeight(xx,zz)+.045,z:zz,normal:[-dx/length,1/length,-dz/length] as const,tint:i===1?[wear,wear*.97,wear*.88] as const:edgeTint,offset};
 });
}

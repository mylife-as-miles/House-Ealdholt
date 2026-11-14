/** Original Crownfall settlement composition. Reference is visual guidance only;
 * no reference game assets, names, economy or progression are copied. */
import type { LandmarkId } from '../../types';
import type { Collider, TerrainField } from '../kernel/mesh';
export type SettlementPoint = readonly [number,number,number];
export interface SettlementFootprint { readonly id:LandmarkId; readonly center:SettlementPoint; readonly width:number; readonly depth:number; readonly yaw:number }
export interface SettlementPath { readonly id:string; readonly points:readonly (readonly [number,number])[]; readonly width:number }
export interface SettlementBuilding { readonly id:string; readonly x:number; readonly z:number; readonly width:number; readonly depth:number; readonly eaves:number; readonly roofHeight:number; readonly yaw:number; readonly roof:'blue'|'green'|'rust'; readonly landmark:LandmarkId|null }
export const AUTUMN_SETTLEMENT_EXTENT=Object.freeze({minX:-88,maxX:88,minZ:-88,maxZ:88});
export const AUTUMN_WATER_LEVEL=.55;
export const settlementShore=(z:number)=>-49+5*Math.sin(z*.035)+2*Math.sin(z*.113);
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
export function settlementHeight(x:number,z:number):number {
  const coast=x-settlementShore(z),t=clamp((coast+4)/12),s=t*t*(3-2*t);
  const upland=2.8+.013*x-.008*z+1.8*Math.exp(-((x-21)**2+(z+27)**2)/2400)+.3*Math.sin(x*.071)*Math.cos(z*.063);
  return -1.8+(upland+1.8)*s;
}
const center=(x:number,z:number):SettlementPoint=>Object.freeze([x,settlementHeight(x,z),z]);
export const AUTUMN_LANDMARK_FOOTPRINTS:readonly SettlementFootprint[]=Object.freeze([
  Object.freeze({id:'banner-hall',center:center(8,-23),width:21,depth:15,yaw:.08}),
  Object.freeze({id:'muster-grounds',center:center(22,9),width:14,depth:12,yaw:-.06}),
  Object.freeze({id:'war-record',center:center(-19,-7),width:11,depth:9,yaw:.18}),
  Object.freeze({id:'heralds-station',center:center(1,31),width:11,depth:8,yaw:-.08}),
]);
/** Unplanted meadow clearings preserve the established village tree layout.
 * They are scenery space, with no farming controls, planting or production. */
export const SETTLEMENT_MEADOW_CLEARINGS = Object.freeze([
  {x:50,z:35,width:17,depth:12,yaw:0},
  {x:48,z:51,width:17,depth:12,yaw:0},
  {x:4,z:60,width:16,depth:12,yaw:0},
  {x:-23,z:45,width:15,depth:11,yaw:0},
]);
const path=(id:string,points:readonly (readonly [number,number])[],width:number):SettlementPath=>Object.freeze({id,points:Object.freeze(points.map(p=>Object.freeze([...p] as [number,number]))),width});
export const AUTUMN_SETTLEMENT_PATHS:readonly SettlementPath[]=Object.freeze([
  path('main',[[36,87],[28,70],[16,51],[12,39],[11,23],[-6,18],[-6,3],[-7,-13],[-7,-39],[10,-58],[19,-78]],3.4),
  path('west',[[-7,-13],[-7,-22],[-24,-26],[-35,-19],[-40,-2],[-25,17],[-6,18]],2.5),
  path('east',[[-7,-13],[21,-11],[37,-1],[38,16],[30,29],[16,51]],2.5),
  path('shore',[[-40,-2],[-34,12],[-38,31],[-23,34],[8,37],[12,39]],2.1),
  path('outer-village',[[30,29],[50,24],[66,25],[66,60],[34,70],[28,70]],2.2),
]);
const building=(id:string,x:number,z:number,width:number,depth:number,eaves:number,roofHeight:number,yaw:number,roof:SettlementBuilding['roof'],landmark:LandmarkId|null=null):SettlementBuilding=>Object.freeze({id,x,z,width,depth,eaves,roofHeight,yaw,roof,landmark});
export const AUTUMN_SETTLEMENT_BUILDINGS:readonly SettlementBuilding[]=Object.freeze([
  building('banner-hall',8,-23,20,14,8,8.5,.08,'blue','banner-hall'),
  building('muster-lodge',22,9,11,8,4.2,5,-.06,'green','muster-grounds'),
  building('war-record',-19,-7,10,8,4.5,5.6,.18,'green','war-record'),
  building('herald-lodge',1,31,10,7,4.2,5,-.08,'rust','heralds-station'),
  building('cottage-01',-20,-38,7,8,3.7,5,.04,'rust'),building('cottage-02',25,-28,8,7,4.2,5.4,-.22,'green'),
  building('cottage-03',34,-16,7,9,4,5,.32,'blue'),building('cottage-04',25,23,8,7,3.6,4.8,-.25,'rust'),
  building('cottage-05',-15,5,7,8,3.9,5.2,.2,'green'),building('cottage-06',-15,25,7,8,3.8,4.8,.15,'blue'),
  building('cottage-07',-28,24,6,8,3.5,4.6,-.18,'rust'),building('cottage-08',-32,-34,7,7,3.8,4.8,.2,'green'),
  building('cottage-09',18,-46,8,7,4,5.2,-.12,'rust'),building('cottage-10',49,7,6,7,3.5,4.8,-.1,'blue'),
  building('cottage-11',-10,47,6,7,3.6,4.8,.32,'green'),building('cottage-12',31,43,6,7,3.8,4.7,-.1,'rust'),
  // Neutral source-built village dressing, not additional house members or
  // earned progression. Existing roads and the two starter plots stay open.
  building('cottage-13',-20,-48,6,6,3.7,4.8,0,'blue'),building('cottage-14',-31,-46,6,6,3.6,4.7,0,'green'),
  building('cottage-15',31,-40,6,6,3.8,4.7,0,'rust'),building('cottage-16',43,-14,6,6,3.6,4.8,0,'blue'),
  building('cottage-17',49,-6,6,6,3.7,4.8,0,'green'),building('cottage-18',-24,4,6,6,3.7,4.7,0,'rust'),
  building('cottage-19',-35,45,6,6,3.6,4.8,0,'green'),building('cottage-20',7,46,6,6,3.7,4.8,0,'blue'),
]);
const segmentDistance=(x:number,z:number,a:readonly[number,number],b:readonly[number,number])=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);};
export function distanceToSettlementPath(x:number,z:number):number {let d=Infinity;for(const road of AUTUMN_SETTLEMENT_PATHS)for(let i=1;i<road.points.length;i++)d=Math.min(d,segmentDistance(x,z,road.points[i-1],road.points[i])-road.width/2);return d;}
export function settlementRectangleContains(x:number,z:number,cx:number,cz:number,width:number,depth:number,yaw:number,pad=0):boolean {const dx=x-cx,dz=z-cz,c=Math.cos(yaw),s=Math.sin(yaw);return Math.abs(c*dx-s*dz)<width/2+pad&&Math.abs(s*dx+c*dz)<depth/2+pad;}
export function settlementSiteFree(x:number,z:number,pad=0):boolean {return !AUTUMN_SETTLEMENT_BUILDINGS.some(b=>settlementRectangleContains(x,z,b.x,b.z,b.width,b.depth,b.yaw,pad))&&!SETTLEMENT_MEADOW_CLEARINGS.some(p=>settlementRectangleContains(x,z,p.x,p.z,p.width,p.depth,p.yaw,pad));}
/** Real open ground for a first buildings. Trees are not
 * authored here, so the visible site and placement validator agree. */
export const SETTLEMENT_OPEN_GROUND=Object.freeze([{x:4,z:7,width:12,depth:11},{x:32,z:56,width:14,depth:12}]);
export function createSettlementTerrainField():TerrainField {
  const cellSize=2,columns=89,rows=89,heights=new Float32Array(columns*rows);
  for(let z=0;z<rows;z++)for(let x=0;x<columns;x++)heights[z*columns+x]=settlementHeight(-88+x*cellSize,-88+z*cellSize);
  return {originX:-88,originZ:-88,cellSize,columns,rows,heights};
}
export function settlementColliders():Collider[] { return AUTUMN_SETTLEMENT_BUILDINGS.map(b=>({center:[b.x,settlementHeight(b.x,b.z)+(b.eaves+b.roofHeight)/2,b.z],halfExtents:[b.width/2,(b.eaves+b.roofHeight)/2,b.depth/2],yaw:b.yaw,landmark:b.landmark,blocksCamera:true})); }

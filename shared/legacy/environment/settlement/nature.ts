import { MeshBuilder, lathe, hexToLinear, Rng } from '../kernel';
import type { InstanceSet, MeshBuffer } from '../kernel';
import { InstanceCollector } from '../kits/context';
import { AUTUMN_SETTLEMENT_PATHS, AUTUMN_WATER_LEVEL,SETTLEMENT_OPEN_GROUND,distanceToSettlementPath,settlementRectangleContains,settlementSiteFree,settlementHeight, settlementShore } from './layout';
export { distanceToSettlementPath,settlementSiteFree } from './layout';
import { settlementGroundTint,settlementRoadRow } from './surface';
function terrain(b:MeshBuilder){
 b.part('terrain').material('settlement-ground').shadows(false,true);const n=80,span=320,base=-160,indices:number[][]=[];
 for(let iz=0;iz<=n;iz++){const row:number[]=[];for(let ix=0;ix<=n;ix++){const x=base+ix*span/n,z=base+iz*span/n,y=settlementHeight(x,z),dx=(settlementHeight(x+1,z)-settlementHeight(x-1,z))/2,dz=(settlementHeight(x,z+1)-settlementHeight(x,z-1))/2,inv=1/Math.hypot(dx,1,dz);b.colorV(settlementGroundTint(x,z));row.push(b.vertex(x,y,z,-dx*inv,inv,-dz*inv,x,z));}indices.push(row);}
 for(let z=0;z<n;z++)for(let x=0;x<n;x++)b.quad(indices[z][x],indices[z+1][x],indices[z+1][x+1],indices[z][x+1]);
 // The runtime kit draws original Crownfall estate water. No second
 // coplanar scaffold surface is emitted by the worker.
}
function roads(b:MeshBuilder){b.part('settlement').material('settlement-path').shadows(false,true).color(1,1,1);for(const path of AUTUMN_SETTLEMENT_PATHS)for(let k=1;k<path.points.length;k++){
 const a=path.points[k-1],c=path.points[k],dx=c[0]-a[0],dz=c[1]-a[1],length=Math.hypot(dx,dz),nx=-dz/length,nz=dx/length,steps=Math.ceil(length/1.2);let last:number[]|null=null;
 for(let i=0;i<=steps;i++){const t=i/steps,x=a[0]+dx*t,z=a[1]+dz*t;const row=settlementRoadRow(x,z,nx,nz,path.width).map(v=>{b.colorV(v.tint);return b.vertex(v.x,v.y,v.z,...v.normal,v.x,v.z);});if(last){b.quad(last[0],row[0],row[1],last[1]);b.quad(last[1],row[1],row[2],last[2]);}last=row;}
 }}
function treePrototype(variant:number):MeshBuffer[]{const b=new MeshBuilder(),r=Rng.fromKey('autumn-tree-'+variant);b.part('vegetation').shadows(true,true).material('settlement-bark').color(1,1,1);const poplar=variant===3,h=poplar?13:8.5;lathe(b,[[.24,-.3],[.18,h*.5],[.06,h*.85]],6,{smooth:false});for(let i=0;i<3;i++){b.push().transform(0,h*.4,0,i*2.1,.2,.6);lathe(b,[[.08,0],[.03,2.5]],4);b.pop();}b.material('settlement-leaf').motion({kind:'sway',amplitude:.08,frequency:.35}).motionWeight(1);const palette=['#ad4c25','#c87d2a','#853721','#bd8b2c'];const color=hexToLinear(palette[variant]);
 if(poplar){b.colorV(color);lathe(b,[[.5,3],[1.5,5],[1.6,8],[.8,11],[.1,13]],7,{smooth:false});}else for(let i=0;i<7;i++){const a=i*2.3999,rr=i===0?0:1.7+r.next()*.7,rx=2.4+r.next()*.7,ry=1.9+r.next()*.8,y=4.7+r.next()*2+(i===0?1.8:0);b.colorV(color,.8+r.next()*.35).push().transform(Math.sin(a)*rr,y,Math.cos(a)*rr,a,0,0,rx,ry,rx);lathe(b,[[.1,-1],[.72,-.65],[1,0],[.78,.65],[.1,1]],7,{smooth:false});b.pop();}b.motion(null);return b.finish();}
export interface SettlementTreeSite {x:number;z:number;distance:number;variant:number;scale:number;yaw:number}
export function settlementTreeSites():readonly SettlementTreeSite[]{ const r=Rng.fromKey('crownfall-autumn-woodland'),sites:SettlementTreeSite[]=[];for(let z=-125;z<=125;z+=5.4)for(let x=-67;x<=126;x+=5.4){const px=x+r.jitter(2.1),pz=z+r.jitter(2.1);if(px<settlementShore(pz)+11||settlementHeight(px,pz)<AUTUMN_WATER_LEVEL+1||!settlementSiteFree(px,pz,3.5)||distanceToSettlementPath(px,pz)<3||SETTLEMENT_OPEN_GROUND.some(p=>settlementRectangleContains(px,pz,p.x,p.z,p.width,p.depth,0,2)))continue;const central=Math.abs(px)<42&&pz>-50&&pz<58;if(central&&r.next()<.7)continue;sites.push({x:px,z:pz,distance:Math.hypot(px*.8,pz),variant:r.next()<.22?3:Math.floor(r.next()*3),scale:.72+r.next()*.58,yaw:r.next()*6.283});}sites.sort((a,c)=>a.distance-c.distance);return sites;}
export function buildSettlementNature(quest:boolean,treeLimit=quest?330:760):{meshes:MeshBuffer[];instances:InstanceSet[]}{const b=new MeshBuilder();terrain(b);roads(b);const instances=new InstanceCollector();for(let i=0;i<4;i++)instances.define({key:'settlement-tree-'+i,part:'vegetation',castShadow:!quest,receiveShadow:true,lod:quest?1:0,motion:{kind:'sway',amplitude:.08,frequency:.35},gate:null,build:()=>treePrototype(i)});
 const sites=settlementTreeSites();for(const site of sites.slice(0,treeLimit))instances.add('settlement-tree-'+site.variant,site.x,settlementHeight(site.x,site.z),site.z,site.yaw,site.scale);
 return {meshes:b.finish(),instances:instances.finish()};}

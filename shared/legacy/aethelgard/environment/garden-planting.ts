/** Bounded interpretation of SamG-Coder/solstice-garden, MIT © 2026 SamG-Coder,
 * pinned 03f0aef9c0f032105c973b97005a482e639032f2. Sources:
 * apps/bake/src/garden/{planting,herbs}.rs. See LICENSE.solstice.txt.
 * Bed tiers, drift planting and lily construction are adapted; no source
 * terrain, absolute placements, baked assets or tree populations are imported. */
import type { PondShoreOutline } from './pond-shore';

export const GARDEN_SPECIES = ['lavender','catmint','salvia','delphinium','foxglove','white-foxglove',
  'daisy','poppy','allium','iris','reedmace','fern','hosta','white-lily','pink-lily'] as const;
export type GardenSpecies = typeof GARDEN_SPECIES[number];
export type GardenProfile = 'desktop'|'quest';
export interface GardenFootprint { readonly minX:number; readonly maxX:number; readonly minZ:number; readonly maxZ:number }
export interface GardenCanopy { readonly x:number; readonly z:number; readonly radius:number }
export interface GardenPlacement { readonly species:GardenSpecies; readonly x:number; readonly y:number; readonly z:number;
  readonly yaw:number; readonly scale:number; readonly radius:number; readonly habitat:'sunny'|'shade'|'margin'|'water' }
export interface GardenPlan { readonly placements:readonly GardenPlacement[]; readonly rejected:Readonly<Record<string,number>>;
  readonly terrainTriangles:number; readonly profile:GardenProfile;
  readonly water:{readonly sampled:number;readonly insideCap:number;readonly visibleWater:number;readonly terrainOccluded:number;
    readonly unsupported:number;readonly raftInset:number;readonly minimumDepth:number|null;readonly maximumDepth:number|null;readonly acceptedRafts:number} }
export const GARDEN_LIMITS = Object.freeze({desktop:Object.freeze({plants:360,attempts:9000,drifts:18}),
  quest:Object.freeze({plants:144,attempts:4200,drifts:12}),outsideReach:7.5,maximumSlope:.48,maximumFootprintRelief:.12});
const TAU=Math.PI*2;
export function gardenRandom(seed:number):()=>number {let state=seed>>>0;return()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};}
/** Positive inside the unchanged, qualified cap. Terrain support below decides
 * whether a point inside that cap is actual visible water. */
export function gardenPondDistance(outline:PondShoreOutline,x:number,z:number):number {
  let inside=false,nearest=Infinity;const b=outline.boundary;
  for(let i=0;i<b.length;i++){const a=b[i],c=b[(i+1)%b.length],dx=c[0]-a[0],dz=c[1]-a[1];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
    nearest=Math.min(nearest,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));
    if((a[1]>z)!==(c[1]>z)&&x<(c[0]-a[0])*(z-a[1])/(c[1]-a[1])+a[0])inside=!inside;
  }return nearest*(inside?1:-1);
}
interface TerrainFace { a:readonly number[]; b:readonly number[]; c:readonly number[]; den:number; slope:number }
/** Exact barycentric highest-Landscape support. The grid only indexes source
 * triangles; it never supplies an invented plane outside their footprints. */
export function gardenTerrainSupport(triangles:readonly number[]) {
  if(!triangles.length||triangles.length%9||triangles.some(n=>!Number.isFinite(n)))throw Error('Garden requires complete finite Landscape triangles.');
  const grid=new Map<string,TerrainFace[]>(),cell=4,edges=new Map<string,{a:readonly number[];b:readonly number[];count:number}>();let count=0;
  for(let i=0;i<triangles.length;i+=9){const a=triangles.slice(i,i+3),b=triangles.slice(i+3,i+6),c=triangles.slice(i+6,i+9),
    ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2],den=ux*vz-uz*vx;
    if(Math.abs(den)<1e-10)continue;
    const face={a,b,c,den,slope:Math.hypot(uy*vz-uz*vy,ux*vy-uy*vx)/Math.abs(den)};count++;
    for(const [p,q] of [[a,b],[b,c],[c,a]]){const keys=[p.map(n=>n.toFixed(5)).join(','),q.map(n=>n.toFixed(5)).join(',')].sort(),key=keys.join('|'),old=edges.get(key);
      if(old)old.count++;else edges.set(key,{a:p,b:q,count:1});}
    for(let z=Math.floor(Math.min(a[2],b[2],c[2])/cell);z<=Math.floor(Math.max(a[2],b[2],c[2])/cell);z++)
      for(let x=Math.floor(Math.min(a[0],b[0],c[0])/cell);x<=Math.floor(Math.max(a[0],b[0],c[0])/cell);x++){
        const key=x+','+z,list=grid.get(key)??[];list.push(face);grid.set(key,list);}
  }
  function at(x:number,z:number):{height:number;slope:number}|null {let best=-Infinity,slope=0;
    for(const {a,b,c,den,slope:s} of grid.get(Math.floor(x/cell)+','+Math.floor(z/cell))??[]){
      const u=((x-a[0])*(c[2]-a[2])-(z-a[2])*(c[0]-a[0]))/den,v=((b[0]-a[0])*(z-a[2])-(b[2]-a[2])*(x-a[0]))/den;
      if(u>=-1e-8&&v>=-1e-8&&u+v<=1+1e-8){const h=a[1]+u*(b[1]-a[1])+v*(c[1]-a[1]);if(h>best){best=h;slope=s;}}}
    return Number.isFinite(best)?{height:best,slope}:null;
  }
  const boundary=[...edges.values()].filter(e=>e.count===1);
  function covered(x:number,z:number,radius:number):boolean {
    if(!at(x,z))return false;
    // A disk cannot leave a connected triangle union without crossing an
    // exposed source edge. This catches narrow holes between sampling spokes.
    for(const {a,b} of boundary){if(Math.max(a[0],b[0])<x-radius||Math.min(a[0],b[0])>x+radius||Math.max(a[2],b[2])<z-radius||Math.min(a[2],b[2])>z+radius)continue;
      const dx=b[0]-a[0],dz=b[2]-a[2],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz)));
      if(Math.hypot(x-a[0]-t*dx,z-a[2]-t*dz)<radius+1e-6)return false;}
    return true;
  }
  return {at,covered,triangles:count};
}
const radiusOf=(s:GardenSpecies)=>s.endsWith('lily')?.72:s==='hosta'?.55:s==='fern'?.78:s==='iris'?.7:s==='reedmace'?.95:
  s==='catmint'?.38:s==='lavender'?.32:s==='foxglove'||s==='white-foxglove'?.3:.27;
const driftNoise=(x:number,z:number,seed:number)=>Math.sin(x*.43+Math.sin(z*.31+seed)*1.7+seed)*.57+Math.sin(z*.71-x*.21+seed*1.7)*.43;

export function planEaldholtGarden(input:{outline:PondShoreOutline;terrain:readonly number[];blockers?:readonly GardenFootprint[];
  canopies?:readonly GardenCanopy[];profile?:GardenProfile}):GardenPlan {
  const profile=input.profile??'desktop',limits=GARDEN_LIMITS[profile],support=gardenTerrainSupport(input.terrain),
    random=gardenRandom(0x501571ce),placements:GardenPlacement[]=[],rejected:Record<string,number>={},outline=input.outline,
    blockers=input.blockers??[],canopies=input.canopies??[];
  if(!support.triangles)throw Error('Garden Landscape has no projected support.');
  const waterStats={sampled:0,insideCap:0,visibleWater:0,terrainOccluded:0,unsupported:0,raftInset:0,minimumDepth:Infinity,maximumDepth:-Infinity,acceptedRafts:0};
  const reject=(reason:string)=>{rejected[reason]=(rejected[reason]??0)+1;};
  const blocked=(x:number,z:number,r:number)=>blockers.some(b=>x+r>b.minX&&x-r<b.maxX&&z+r>b.minZ&&z-r<b.maxZ);
  const shade=(x:number,z:number)=>canopies.some(c=>Math.hypot(x-c.x,z-c.z)<c.radius);
  const spanX=outline.bounds.max[0]-outline.bounds.min[0],spanZ=outline.bounds.max[1]-outline.bounds.min[1];
  // Each bed is a ragged capsule centred beside the *actual* source cap, never
  // a replacement Solstice site plan or radial approximation of the water.
  const drifts:{x:number;z:number;angle:number;length:number;width:number;kind:'sunny'|'shade'}[]=[];
  for(let i=0;i<limits.drifts*12&&drifts.length<limits.drifts;i++){
    const edge=Math.floor(random()*outline.boundary.length),a=outline.boundary[edge],b=outline.boundary[(edge+1)%outline.boundary.length],t=random(),
      length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<1e-6)continue;
    const outward=1.5+random()*3.6,x=a[0]+(b[0]-a[0])*t-(b[1]-a[1])/length*outward,
      z=a[1]+(b[1]-a[1])*t+(b[0]-a[0])/length*outward;
    if(gardenPondDistance(outline,x,z)>-.8||!support.at(x,z)||blocked(x,z,.65))continue;
    if(drifts.some(d=>Math.hypot(x-d.x,z-d.z)<1.8))continue;
    drifts.push({x,z,angle:Math.atan2(b[1]-a[1],b[0]-a[0])+(random()-.5)*.6,length:1.2+random()*2.4,width:.8+random()*.9,kind:shade(x,z)?'shade':'sunny'});
  }
  const add=(species:GardenSpecies,x:number,z:number,habitat:GardenPlacement['habitat'])=>{
    const scale=.85+random()*.35,r=radiusOf(species)*scale+(habitat==='water'?.025:.17),water=habitat==='water',terrain=support.at(x,z);
    if(blocked(x,z,r)){reject('blocked-authored-footprint');return;}
    if(!terrain){reject('unsupported-Landscape');return;}
    if(!support.covered(x,z,r)){reject('unsupported-whole-footprint');return;}
    const d=gardenPondDistance(outline,x,z),depth=outline.height-terrain.height;
    // The original GLB's pond is only ~7cm above its drawn Landscape. It has
    // no recovered bathymetry: visible-water clearance, not an invented pond
    // depth, qualifies floating pads. Outside the cap, height alone is never
    // evidence of water because no water geometry is present there.
    if(water&&d<r){reject('lily-cap-footprint-inset');return;}
    if(water&&depth<=.001){reject('lily-Landscape-occludes-water');return;}
    if(!water&&habitat!=='margin'&&d>-r){reject('dry-bed-touches-water');return;}
    if(habitat==='margin'&&(d<-.7||d>1.15||depth<-.24||depth>.38)){reject('unsupported-pond-margin');return;}
    let low=terrain.height,high=terrain.height;
    for(let k=0;k<8;k++){const angle=k*TAU/8,sx=x+Math.cos(angle)*r,sz=z+Math.sin(angle)*r,p=support.at(sx,sz);
      if(!p){reject('unsupported-whole-footprint');return;}
      if(water&&gardenPondDistance(outline,sx,sz)<0){reject('lily-raft-crosses-cap');return;}
      if(water&&p.height>=outline.height-.001){reject('lily-raft-Landscape-occlusion');return;}
      if(!water&&habitat!=='margin'&&gardenPondDistance(outline,sx,sz)>0){reject('bed-footprint-touches-water');return;}
      if(!water&&p.slope>GARDEN_LIMITS.maximumSlope){reject('Landscape-slope');return;}
      low=Math.min(low,p.height);high=Math.max(high,p.height);
    }
    if(!water&&high-low>GARDEN_LIMITS.maximumFootprintRelief){reject('Landscape-relief');return;}
    // Actual complete botanical footprint, including the conservative wind
    // envelope, owns space. All source obstacles were expanded before this.
    if(placements.some(p=>Math.hypot(x-p.x,z-p.z)<(p.radius+r)*.89)){reject('plant-spacing');return;}
    placements.push(Object.freeze({species,x,y:water?outline.height:low-.006,z,yaw:random()*TAU,scale,radius:r,habitat}));
    if(water)waterStats.acceptedRafts++;
  };
  // Flower/fern beds form coherent drifts and use the source's edge-to-back
  // species tiers. Random darts, never a visible square lattice.
  const landBudget=Math.floor(limits.plants*.72);
  for(let attempt=0;attempt<limits.attempts&&placements.length<landBudget&&drifts.length;attempt++){
    const bed=drifts[Math.floor(random()*drifts.length)],u=(random()*2-1)*bed.length,v=(random()*2-1)*bed.width,
      x=bed.x+Math.cos(bed.angle)*u-Math.sin(bed.angle)*v,z=bed.z+Math.sin(bed.angle)*u+Math.cos(bed.angle)*v,
      edge=bed.width-Math.abs(v)+(driftNoise(x,z,1)*.16);
    if(edge<.12||Math.abs(u)>bed.length*(.8+.2*driftNoise(x,z,4)))continue;
    const a=driftNoise(x,z,2),b=driftNoise(x,z,3);let species:GardenSpecies;
    if(bed.kind==='shade')species=edge<.4?'hosta':a>.68?'white-foxglove':a>-.25?'fern':'hosta';
    else if(edge<.48)species=a>0?'lavender':'catmint';
    else if(edge<.95)species=b>.35?'salvia':b>-.05?'daisy':b>-.45?'poppy':'allium';
    else species=a>.3?'delphinium':a>-.25?'foxglove':b>0?'white-foxglove':'daisy';
    add(species,x,z,bed.kind);
  }
  // Aquatic colonies are clipped by both the cap and actual submerged terrain.
  const aquaticStart=placements.length,lilyBudget=Math.max(8,Math.floor(limits.plants*.17));
  for(let attempt=0;attempt<limits.attempts/2&&placements.length<limits.plants;attempt++){
    const x=outline.bounds.min[0]+random()*spanX,z=outline.bounds.min[1]+random()*spanZ,d=gardenPondDistance(outline,x,z),n=driftNoise(x,z,7);
    waterStats.sampled++;
    if(d>0){waterStats.insideCap++;const terrain=support.at(x,z);
      if(!terrain)waterStats.unsupported++;else{const depth=outline.height-terrain.height;
        waterStats.minimumDepth=Math.min(waterStats.minimumDepth,depth);waterStats.maximumDepth=Math.max(waterStats.maximumDepth,depth);
        if(depth>.001){waterStats.visibleWater++;if(d>.8)waterStats.raftInset++;}else waterStats.terrainOccluded++;}}
    if(d>.9&&n>.1&&placements.length-aquaticStart<lilyBudget)add(driftNoise(x,z,11)>.05?'pink-lily':'white-lily',x,z,'water');
    else if(d>-.7&&d<1.15&&n>.18)add(d>.35?'reedmace':'iris',x,z,'margin');
  }
  return Object.freeze({placements:Object.freeze(placements),rejected:Object.freeze(rejected),terrainTriangles:support.triangles,profile,
    water:Object.freeze({...waterStats,minimumDepth:Number.isFinite(waterStats.minimumDepth)?waterStats.minimumDepth:null,maximumDepth:Number.isFinite(waterStats.maximumDepth)?waterStats.maximumDepth:null})});
}

type V=readonly [number,number,number];
type RGB=readonly [number,number,number];
const GREEN:RGB=[.055,.14,.025],GREY_GREEN:RGB=[.15,.21,.105],STEM:RGB=[.09,.16,.035],WHITE:RGB=[.86,.83,.72],
  PINK:RGB=[.68,.19,.31],YELLOW:RGB=[.82,.48,.025],VIOLET:RGB=[.28,.09,.48],BLUE:RGB=[.12,.19,.5];
const plus=(a:V,b:V):V=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const times=(a:V,n:number):V=>[a[0]*n,a[1]*n,a[2]*n];
const unit=(a:V):V=>{const n=Math.hypot(...a)||1;return times(a,1/n);};
const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export interface GardenGeometry {readonly positions:Float32Array;readonly colours:Float32Array;readonly indices:Uint32Array;
  readonly height:number;readonly triangles:number;readonly byteLength:number}
/** Leaves are curved, folded surfaces, petals cupped radial profiles and bells
 * continuous lofts. No billboards, stock spheres or crown blobs are used. */
class Botanist {
  positions:number[]=[];colours:number[]=[];indices:number[]=[];
  vertex(p:V,c:RGB):number {const i=this.positions.length/3;this.positions.push(...p);this.colours.push(...c);return i;}
  quad(a:number,b:number,c:number,d:number){this.indices.push(a,b,d,b,c,d);}
  blade(base:V,axis:V,length:number,width:number,arch:number,colour:RGB,rows=6,cup=.2){
    const direction=unit(axis),side=unit([direction[2],0,-direction[0]]),first=this.positions.length/3;
    for(let row=0;row<=rows;row++){const t=row/rows,spread=Math.max(.004,Math.pow(Math.sin(Math.PI*t),.75))*width*.5;
      for(let column=0;column<3;column++){const s=column-1,p=plus(plus(base,times(direction,t*length)),times(side,s*spread));
        this.vertex([p[0],p[1]+arch*Math.sin(Math.PI*t)-arch*.45*t*t+cup*spread*s*s,p[2]],
          times(colour,.88+.12*Math.sin(Math.PI*t)) as RGB);}}
    for(let row=0;row<rows;row++)for(let col=0;col<2;col++){const a=first+row*3+col;this.quad(a,a+1,a+4,a+3);}
  }
  tube(points:readonly V[],radius:number,tip:number,colour:RGB,sides=6){
    const first=this.positions.length/3;
    for(let j=0;j<points.length;j++){const p=points[j],a=points[Math.max(0,j-1)],b=points[Math.min(points.length-1,j+1)],
      tangent=unit([b[0]-a[0],b[1]-a[1],b[2]-a[2]]),side=unit(cross(tangent,Math.abs(tangent[1])>.9?[1,0,0]:[0,1,0])),
      forward=unit(cross(tangent,side)),r=radius+(tip-radius)*j/(points.length-1);
      for(let k=0;k<sides;k++){const angle=k*TAU/sides;this.vertex(plus(p,plus(times(side,Math.cos(angle)*r),times(forward,Math.sin(angle)*r))),colour);}}
    for(let j=0;j<points.length-1;j++)for(let k=0;k<sides;k++)this.quad(first+j*sides+k,first+j*sides+(k+1)%sides,first+(j+1)*sides+(k+1)%sides,first+(j+1)*sides+k);
    // Closed cut ends also keep silhouette/contact honest in back views.
    const start=this.vertex(points[0],colour),end=this.vertex(points[points.length-1],colour);
    for(let k=0;k<sides;k++)this.indices.push(start,first+(k+1)%sides,first+k,end,first+(points.length-1)*sides+k,first+(points.length-1)*sides+(k+1)%sides);
  }
  dome(centre:V,radius:number,height:number,colour:RGB,sides=10){
    const first=this.positions.length/3;
    for(let j=0;j<4;j++){const t=j/4*Math.PI/2;for(let k=0;k<sides;k++){const angle=k*TAU/sides;
      this.vertex([centre[0]+Math.cos(angle)*Math.cos(t)*radius,centre[1]+Math.sin(t)*height,centre[2]+Math.sin(angle)*Math.cos(t)*radius],colour);}}
    for(let j=0;j<3;j++)for(let k=0;k<sides;k++)this.quad(first+j*sides+k,first+j*sides+(k+1)%sides,first+(j+1)*sides+(k+1)%sides,first+(j+1)*sides+k);
    const top=this.vertex([centre[0],centre[1]+height,centre[2]],colour);for(let k=0;k<sides;k++)this.indices.push(first+3*sides+k,first+3*sides+(k+1)%sides,top);
  }
  petals(centre:V,count:number,length:number,width:number,up:number,colour:RGB,turn=0){
    for(let k=0;k<count;k++){const angle=k*TAU/count+turn;
      this.blade(centre,[Math.cos(angle),up,Math.sin(angle)],length,width,-length*.11,colour,4,.45);}
  }
  bell(centre:V,angle:number,length:number,mouth:number,colour:RGB){
    const first=this.positions.length/3,axis:V=[Math.cos(angle)*.83,-.56,Math.sin(angle)*.83],side:V=[-Math.sin(angle),0,Math.cos(angle)],
      up=unit(cross(axis,side)),sides=8;
    for(let j=0;j<=4;j++){const t=j/4,r=mouth*(.28+.72*Math.sin(t*Math.PI*.56));
      for(let k=0;k<sides;k++){const a=k*TAU/sides,lip=j===4?1+.08*Math.cos(k*Math.PI):1;
        this.vertex(plus(plus(centre,times(axis,length*t)),plus(times(side,Math.cos(a)*r*lip),times(up,Math.sin(a)*r*lip))),times(colour,.72+.28*t) as RGB);}}
    for(let j=0;j<4;j++)for(let k=0;k<sides;k++)this.quad(first+j*sides+k,first+j*sides+(k+1)%sides,first+(j+1)*sides+(k+1)%sides,first+(j+1)*sides+k);
  }
  pad(centre:V,radius:number,turn:number){
    const core=this.vertex(centre,GREEN),segments=16,first=this.positions.length/3;
    // An actual V notch, raised rim and depressed petiole distinguish pads
    // from opaque circles. Opening faces a different seeded direction per pad.
    for(let k=0;k<=segments;k++){const a=turn+.22+(TAU-.44)*k/segments,r=radius*(1+.04*Math.sin(k*2.7));
      this.vertex([centre[0]+Math.cos(a)*r,centre[1]+.004+Math.sin(a*3)*.002,centre[2]+Math.sin(a)*r],
        times(GREEN,.88+.14*Math.sin(a)) as RGB);}
    for(let k=0;k<segments;k++)this.indices.push(core,first+k+1,first+k);
  }
  result():GardenGeometry {const positions=new Float32Array(this.positions),colours=new Float32Array(this.colours),indices=new Uint32Array(this.indices);
    let height=.01;for(let i=1;i<positions.length;i+=3)height=Math.max(height,positions[i]);
    return{positions,colours,indices,height,triangles:indices.length/3,byteLength:positions.byteLength+colours.byteLength+indices.byteLength};}
}
function rosette(b:Botanist,random:()=>number,count:number,length:number,width:number){
  for(let k=0;k<count;k++){const angle=k*2.39996+random()*.3,elevation=.2+random()*.65;
    b.blade([0,.006,0],[Math.cos(angle),elevation,Math.sin(angle)],length*(.7+random()*.3),width,.07,GREEN,6,.35);}
}
/** One reusable, deterministic botanical mesh per species. Density is a
 * placement budget; Native does not evaluate a second geometry algorithm. */
export function createGardenBotanicalGeometry(species:GardenSpecies):GardenGeometry {
  const b=new Botanist(),random=gardenRandom(53+GARDEN_SPECIES.indexOf(species)*79);
  if(species.endsWith('lily')){
    const pads:{x:number;z:number;r:number}[]=[];
    for(let attempt=0;attempt<60&&pads.length<7;attempt++){const a=random()*TAU,r=.085+random()*.075,d=Math.sqrt(random())*.48,
      x=Math.cos(a)*d,z=Math.sin(a)*d;
      if(pads.every(p=>Math.hypot(x-p.x,z-p.z)>(r+p.r)*.86))pads.push({x,z,r});}
    pads.forEach((p,i)=>b.pad([p.x,.004+i*.0015,p.z],p.r,random()*TAU));
    for(let flower=0;flower<2;flower++){const a=random()*TAU,d=.12+random()*.15,c:V=[Math.cos(a)*d,.025,Math.sin(a)*d],colour=species==='pink-lily'?PINK:WHITE;
      b.petals(c,9,.058,.021,.22,colour);b.petals(plus(c,[0,.004,0]),8,.049,.019,.7,colour,.3);
      b.petals(plus(c,[0,.007,0]),6,.038,.014,1.15,colour,.6);b.dome(plus(c,[0,.008,0]),.011,.012,YELLOW);}
  }else if(species==='fern'){
    for(let frond=0;frond<8;frond++){const angle=frond*2.39996,length=.5+random()*.2,radial:V=[Math.cos(angle),0,Math.sin(angle)],points:V[]=[];
      for(let j=0;j<=8;j++){const t=j/8;points.push(plus(times(radial,t*length),[0,.015+.72*length*Math.sin(t*1.8),0]));}
      b.tube(points,.003,.0008,STEM,5);
      for(let j=1;j<8;j++){const t=j/8,origin=points[j],reach=length*.22*Math.sin(Math.PI*t);
        for(const side of [-1,1])b.blade(origin,[Math.cos(angle+side*1.05),.05,Math.sin(angle+side*1.05)],reach,.034,.018,GREEN,4,.2);}}
  }else if(species==='hosta')rosette(b,random,11,.44,.17);
  else if(species==='iris'||species==='reedmace'){
    rosette(b,random,7,species==='iris'?.65:.9,species==='iris'?.038:.028);
    for(let shoot=0;shoot<3;shoot++){const angle=shoot*2.4,x=Math.cos(angle)*.08,z=Math.sin(angle)*.08,h=species==='iris'?.7:.98;
      b.tube([[x,0,z],[x+.025,h*.6,z],[x+.03,h,z+.015]],.006,.003,STEM);
      if(species==='reedmace')b.tube([[x+.03,h-.02,z+.015],[x+.03,h+.15,z+.015]],.021,.017,[.16,.075,.025],8);
      else{const c:V=[x+.03,h,z+.015];b.petals(c,3,.075,.035,-.42,YELLOW);b.petals(plus(c,[0,.007,0]),3,.05,.025,1,YELLOW,.8);}}
  }else if(species==='foxglove'||species==='white-foxglove'){
    rosette(b,random,8,.25,.085);const h=1.28;b.tube([[0,0,0],[.03,.65,0],[.04,h,.015]],.009,.0025,STEM);
    for(let k=0;k<17;k++){const t=k/17,a=k*2.39996;b.bell([.035,.47+t*.76,.01],a,.052*(1-t*.4),.021*(1-t*.35),species==='white-foxglove'?WHITE:PINK);}
  }else if(species==='lavender'||species==='catmint'||species==='salvia'||species==='delphinium'){
    const tall=species==='delphinium',low=species==='lavender'||species==='catmint',shoots=low?9:tall?3:6,height=low?.48:tall?1.35:.8,
      colour=species==='lavender'?VIOLET:species==='catmint'?BLUE:species==='salvia'?[.25,.055,.37] as RGB:BLUE;
    for(let shoot=0;shoot<shoots;shoot++){const a=shoot*2.39996,r=(.05+random()*.13)*(low?1:.7),x=Math.cos(a)*r,z=Math.sin(a)*r,h=height*(.8+random()*.2),
      end:V=[x*1.55,h,z*1.55];b.tube([[x,0,z],[x*1.2,h*.55,z*1.2],end],.0035,.0014,STEM,5);
      for(let k=0;k<4;k++)for(const side of [-1,1]){const y=.05+k*h*.12,angle=a+side*.9;
        b.blade([x,y,z],[Math.cos(angle),.25,Math.sin(angle)],low?.065:.11,low?.014:.04,.013,low?GREY_GREEN:GREEN,4,.25);}
      const whorls=tall?11:6;for(let k=0;k<whorls;k++){const t=k/whorls,c:V=[end[0],h-(1-t)*(tall?.5:.14),end[2]];
        b.petals(c,tall?4:3,tall?.023:.012,tall?.017:.008,.35,colour,k*.8);}}
  }else{
    rosette(b,random,6,.15,.045);
    for(let shoot=0;shoot<3;shoot++){const a=shoot*2.4,c:V=[Math.cos(a)*.11,.38+random()*.16,Math.sin(a)*.11];
      b.tube([[0,0,0],[c[0]*.6,c[1]*.6,c[2]*.6],c],.0035,.0017,STEM,5);
      if(species==='allium'){
        for(let k=0;k<22;k++){const y=1-2*(k+.5)/22,theta=k*2.39996,r=Math.sqrt(1-y*y)*.048,
          p=plus(c,[Math.cos(theta)*r,y*.048,Math.sin(theta)*r]);b.petals(p,4,.009,.006,.2,VIOLET,theta);}
      }else if(species==='poppy'){b.petals(c,5,.047,.055,.45,[.7,.045,.025]);b.dome(plus(c,[0,.004,0]),.012,.009,[.045,.027,.018]);}
      else {b.petals(c,13,.039,.012,.02,WHITE);b.dome(plus(c,[0,.003,0]),.013,.008,YELLOW);}}
  }
  return b.result();
}

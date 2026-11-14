import {sampleEaldholtFarGeography,type EaldholtFarGeography} from './far-surround';
import {REGIONAL_RIPARIAN_GROUNDCOVER as POLICY,regionalRiparianSourceScaleRange,validRegionalGroundcoverSource,type RegionalGroundcoverSource} from './regional-groundcover-policy';

type Rect=EaldholtFarGeography['sourceEnvelope'];
type Footprint={height:number;minimumHeight:number;maximumHeight:number;slope:number};
export interface RegionalRiparianDiagnostics {attempted:number;accepted:number;rejected:Record<string,number>;heightQualification?:{examined:number;enlarged:number;held:Record<string,number>}}
const random=(a:number,b:number)=>{let h=Math.imul(a^0x5f3759df,b+374761393);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;};
const outside=(r:Rect,x:number,z:number)=>Math.hypot(Math.max(r.minX-x,0,x-r.maxX),Math.max(r.minZ-z,0,z-r.maxZ));
function segmentDistance(x:number,z:number,ax:number,az:number,bx:number,bz:number){const dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l)):0;return Math.hypot(x-ax-t*dx,z-az-t*dz);}

/** Same piecewise-linear, terminal-constant channel as the authored hydro field. */
export function regionalRiverBank(g:EaldholtFarGeography,x:number,side:0|1){
 const p=g.channelSamples;let at=0,t=0;
 for(let i=4;i<p.length;i+=4){if(x<=p[i]){at=i-4;t=Math.max(0,(x-p[at])/(p[i]-p[at]));break;}at=i;}
 const next=Math.min(at+4,p.length-4),z=p[at+1+side]*(1-t)+p[next+1+side]*t,water=p[at+3]*(1-t)+p[next+3]*t;
 const slope=next===at?0:(p[next+1+side]-p[at+1+side])/(p[next]-p[at]);return{z,water,slope};
}
export function maximumWaterStage(g:EaldholtFarGeography,minX:number,maxX:number){
 let maximum=Math.max(g.seaLevel,regionalRiverBank(g,minX,0).water,regionalRiverBank(g,maxX,0).water);
 for(let i=0;i<g.channelSamples.length;i+=4)if(g.channelSamples[i]>=minX&&g.channelSamples[i]<=maxX)maximum=Math.max(maximum,g.channelSamples[i+3]);
 return maximum;
}

/** Exact minimum distance to coast/channel segments, including their constant
 * terminal continuations. Protects water wedges between sparse height probes. */
export function regionalShoreClearance(g:EaldholtFarGeography,x:number,z:number){
 if(sampleEaldholtFarGeography(g,x,z).kind!=='mainland')return 0;
 let distance=Infinity;const c=g.coastSamples,p=g.channelSamples;
 for(let i=2;i<c.length;i+=2)distance=Math.min(distance,segmentDistance(x,z,c[i-1],c[i-2],c[i+1],c[i]));
 distance=Math.min(distance,segmentDistance(x,z,c[1],Math.min(z,c[0])-1,c[1],c[0]),segmentDistance(x,z,c[c.length-1],c[c.length-2],c[c.length-1],Math.max(z,c[c.length-2])+1));
 for(const side of [0,1] as const){for(let i=4;i<p.length;i+=4)distance=Math.min(distance,segmentDistance(x,z,p[i-4],p[i-3+side],p[i],p[i+1+side]));distance=Math.min(distance,segmentDistance(x,z,p[p.length-4],p[p.length-3+side],Math.max(x,g.riverFarX)+1,p[p.length-3+side]));}
 return Math.min(distance,segmentDistance(x,z,p[0],p[1],p[0],p[2]));
}

/** Redistribute a capped tail of existing grass, reusing its source families,
 * draw budgets and wind. All fixture buffers remain read-only. */
export function redistributeRiparianGroundcover(input:{
 geography:EaldholtFarGeography;village:Rect;grass:number[];source?:RegionalGroundcoverSource;
 footprint:(x:number,z:number,radius:number)=>Footprint|null;
 fixtures:readonly {x:number;z:number;radius:number}[];
 diagnostics?:RegionalRiparianDiagnostics;
}):number{
 const {geography:g,grass,source}=input,diagnostics=input.diagnostics,reject=(reason:string)=>{if(diagnostics)diagnostics.rejected[reason]=(diagnostics.rejected[reason]??0)+1;};if(!validRegionalGroundcoverSource(source)){reject('source-unqualified');return 0;}
 const target=Math.floor(grass.length/6*POLICY.maximumFraction);if(!target)return 0;
 const start=g.channelSamples[0]+8,end=Math.min(g.riverFarX-8,g.sourceEnvelope.maxX+650);if(end<=start)return 0;
 const existing=new Map<string,{x:number;z:number}[]>(),accepted=new Map<string,{x:number;z:number}[]>(),fixtures=new Map<string,typeof input.fixtures[number][]>();
 const insert=(map:Map<string,{x:number;z:number}[]>,p:{x:number;z:number})=>{const key=Math.floor(p.x/2)+','+Math.floor(p.z/2),list=map.get(key);if(list)list.push(p);else map.set(key,[p]);};
 const occupancy=new Map<string,number>(),largeFixtures:typeof input.fixtures[number][]=[];let maximumCell=0,maximumFixture=0;
 for(let i=0;i<grass.length;i+=6){insert(existing,{x:grass[i],z:grass[i+2]});const key=Math.floor(grass[i]/16)+','+Math.floor(grass[i+2]/16),n=(occupancy.get(key)??0)+1;occupancy.set(key,n);maximumCell=Math.max(maximumCell,n);}
 for(const p of input.fixtures){if(p.radius>8){largeFixtures.push(p);continue;}const key=Math.floor(p.x/8)+','+Math.floor(p.z/8),list=fixtures.get(key);if(list)list.push(p);else fixtures.set(key,[p]);maximumFixture=Math.max(maximumFixture,p.radius);}
 const replacement:number[]=[];
 for(let attempt=0;attempt<target*64&&replacement.length/6<target;attempt++){
  if(diagnostics)diagnostics.attempted++;
  // Shared cluster centres, irregular openings and dry offsets leave patches,
  // not a planted stripe. Each clump must qualify on its own actual triangle.
  const cluster=Math.floor(attempt/12),side=(random(cluster,102)<.5?0:1) as 0|1,sign=side===0?-1:1;
  if(random(cluster,103)<.22){reject('cluster-opening');continue;}
  const x=start+random(cluster,101)*(end-start)+(random(attempt,104)-.5)*6;if(x<=start||x>=end){reject('channel-range');continue;}
  // Short rigid source clumps cannot seat on the steep cut face. Preserve
  // inner-bank patches, but also search the existing landward shoulder where
  // actual support can flatten. Source/path/root/water guards remain identical.
  const shoulder=random(cluster,109)>.35,offset=shoulder?7+random(cluster,105)*12+random(attempt,106)*3:.9+random(cluster,105)*4+random(attempt,106)*2;
  const bank=regionalRiverBank(g,x,side),normal=1/Math.hypot(1,bank.slope);
  const px=x-sign*bank.slope*normal*offset,z=bank.z+sign*normal*offset,size=.4+random(attempt,107)*.4,radius=source.radius*size;
  if(px<=start||px>=end){reject('channel-range');continue;}
  // Maximum shared grass wind bend is 0.11 * clump height. Keep this entire
  // envelope dry and outside fixtures without altering the common wind shader.
  const envelope=radius+.11*source.maximumHeight*size,clearance=envelope+POLICY.minimumDryMarginMetres;
  if(outside(g.sourceEnvelope,px,z)<5+envelope){reject('authored-source-envelope');continue;}
  if(outside(input.village,px,z)<5+envelope){reject('authored-village-envelope');continue;}
  if(regionalShoreClearance(g,px,z)<clearance){reject('water-envelope');continue;}
  const support=input.footprint(px,z,radius+.001);
  if(!support){reject('unsupported-or-overlapping-footprint');continue;}
  if(support.slope>POLICY.maximumSlope){reject('terrain-slope');continue;}
  if(support.minimumHeight<maximumWaterStage(g,px-envelope,px+envelope)+POLICY.minimumDryMarginMetres){reject('low-wet-bank');continue;}
  if(support.maximumHeight-support.minimumHeight>Math.min(POLICY.maximumBurialMetres,source.minimumHeight*size*POLICY.maximumBurialFraction)){reject('excess-soil-burial');continue;}
  let clear=!largeFixtures.some(p=>Math.hypot(p.x-px,p.z-z)<p.radius+envelope+.1);const reach=maximumFixture+envelope+.1;
  for(let cx=Math.floor((px-reach)/8);clear&&cx<=Math.floor((px+reach)/8);cx++)for(let cz=Math.floor((z-reach)/8);clear&&cz<=Math.floor((z+reach)/8);cz++)for(const p of fixtures.get(cx+','+cz)??[])if(Math.hypot(p.x-px,p.z-z)<p.radius+envelope+.1){clear=false;break;}
  if(!clear){reject('root-rock-or-landmark-envelope');continue;}
  for(const map of [existing,accepted])for(let cx=Math.floor(px/2)-1;clear&&cx<=Math.floor(px/2)+1;cx++)for(let cz=Math.floor(z/2)-1;clear&&cz<=Math.floor(z/2)+1;cz++)for(const p of map.get(cx+','+cz)??[])if(Math.hypot(p.x-px,p.z-z)<.8){clear=false;break;}
  if(!clear){reject('existing-or-riparian-grass-spacing');continue;}
  const cell=Math.floor(px/16)+','+Math.floor(z/16);if((occupancy.get(cell)??0)>=maximumCell){reject('cell-density');continue;}
  // Cancel the renderer's established 4 mm lift: the lowest source vertex sits
  // at the lowest support height. Soil burial is bounded by family height.
  replacement.push(px,support.minimumHeight-.004,z,random(attempt,108)*Math.PI*2,size,attempt%3);insert(accepted,{x:px,z});occupancy.set(cell,(occupancy.get(cell)??0)+1);
 }
 // Preserve the established qualified patch distribution exactly. Only enlarge
 // rows whose *larger* source/wind disk qualifies anew; a held enlargement keeps
 // its original safe small row rather than removing coverage or shifting grass.
 const scaleRange=regionalRiparianSourceScaleRange(source),height={examined:replacement.length/6,enlarged:0,held:{} as Record<string,number>};
 const hold=(reason:string)=>{height.held[reason]=(height.held[reason]??0)+1;};
 for(let at=0;at<replacement.length;at+=6){
  if(!scaleRange){hold('source-height-envelope');continue;}
  const px=replacement[at],z=replacement[at+2],size=scaleRange.minimum+random(at/6,110)*(scaleRange.maximum-scaleRange.minimum),radius=source.radius*size;
  if(size<=replacement[at+4]){hold('already-readable-height');continue;}
  const envelope=radius+.11*source.maximumHeight*size;
  if(outside(g.sourceEnvelope,px,z)<5+envelope){hold('authored-source-envelope');continue;}
  if(outside(input.village,px,z)<5+envelope){hold('authored-village-envelope');continue;}
  if(regionalShoreClearance(g,px,z)<envelope+POLICY.minimumDryMarginMetres){hold('water-envelope');continue;}
  const support=input.footprint(px,z,radius+.001);
  if(!support){hold('unsupported-or-overlapping-footprint');continue;}
  if(support.slope>POLICY.maximumSlope){hold('terrain-slope');continue;}
  if(support.minimumHeight<maximumWaterStage(g,px-envelope,px+envelope)+POLICY.minimumDryMarginMetres){hold('low-wet-bank');continue;}
  if(support.maximumHeight-support.minimumHeight>Math.min(POLICY.maximumBurialMetres,source.minimumHeight*size*POLICY.maximumBurialFraction)){hold('excess-soil-burial');continue;}
  let clear=!largeFixtures.some(p=>Math.hypot(p.x-px,p.z-z)<p.radius+envelope+.1);const reach=maximumFixture+envelope+.1;
  for(let cx=Math.floor((px-reach)/8);clear&&cx<=Math.floor((px+reach)/8);cx++)for(let cz=Math.floor((z-reach)/8);clear&&cz<=Math.floor((z+reach)/8);cz++)for(const p of fixtures.get(cx+','+cz)??[])if(Math.hypot(p.x-px,p.z-z)<p.radius+envelope+.1){clear=false;break;}
  if(!clear){hold('root-rock-or-landmark-envelope');continue;}
  replacement[at+1]=support.minimumHeight-.004;replacement[at+4]=size;height.enlarged++;
 }
 if(diagnostics)diagnostics.heightQualification=height;
 if(replacement.length)grass.splice(grass.length-replacement.length,replacement.length,...replacement);
 if(diagnostics)diagnostics.accepted=replacement.length/6;
 return replacement.length/6;
}

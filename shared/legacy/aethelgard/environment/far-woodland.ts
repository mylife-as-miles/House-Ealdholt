import type {WalkingBounds,WalkingTerrainTriangle} from './realistic-tree-walking';
import { sampleEaldholtFarGeography, type EaldholtFarGeography } from './far-surround';
import type { EaldholtWoodlandPlacement, EaldholtWoodlandSurface } from './river-woodland';

export const EALDHOLT_FAR_WOODLAND_BUDGET = Object.freeze({ actors: 48, triangles: 500000, drawCalls: 3,
  combinedActors: 328, combinedTriangles: 2500000, combinedDrawCalls: 6, extraTextureBytes: 0 });
/** Retained only for explicitly selected private native-LOD comparisons. */
export const EALDHOLT_FAR_WOODLAND_LOD_BUDGET = Object.freeze({ actors: 128, triangles: 67200, drawCalls: 3,
  combinedActors: 328, combinedTriangles: 2100000, combinedDrawCalls: 6, extraTextureBytes: 0 });
export interface EaldholtFarWoodlandPlacement extends EaldholtWoodlandPlacement { readonly grove: number }
export interface EaldholtFarGrove { readonly x: number; readonly z: number; readonly radiusX: number; readonly radiusZ: number }
export interface EaldholtFarWoodlandLayout {
  readonly placements: readonly EaldholtFarWoodlandPlacement[]; readonly groves: readonly EaldholtFarGrove[];
  readonly acceptedPerGrove: readonly number[]; readonly attempted: number;
  readonly rejected: Readonly<Record<string, number>>; readonly supportTriangles: number;
}
type Rect = { minX:number;maxX:number;minZ:number;maxZ:number };
type Support = { height:number;slope:number };

/** Exact triangle support, indexed only inside the bounded planting domain.
 * Giant continuation triangles do not allocate kilometre-sized spatial grids. */
export function createEaldholtWoodlandSupportIndex(surfaces:readonly EaldholtWoodlandSurface[], domain:Rect) {
  const triangles: { p:ArrayLike<number>; a:number;b:number;c:number }[] = [], cells = new Map<string,number[]>();
  const cell = 24;
  for (const s of surfaces) {
    if (s.positions.length % 3 || s.indices.length % 3) throw Error('Incomplete far woodland support.');
    for (let at=0;at<s.indices.length;at+=3) {
      const [a,b,c]=[s.indices[at]*3,s.indices[at+1]*3,s.indices[at+2]*3], p=s.positions;
      if (![a,b,c].every(v=>Number.isSafeInteger(v)&&v>=0&&v+2<p.length)
        || ![p[a],p[a+1],p[a+2],p[b],p[b+1],p[b+2],p[c],p[c+1],p[c+2]].every(Number.isFinite)) throw Error('Invalid far woodland support triangle.');
      const minX=Math.max(domain.minX,Math.min(p[a],p[b],p[c])), maxX=Math.min(domain.maxX,Math.max(p[a],p[b],p[c]));
      const minZ=Math.max(domain.minZ,Math.min(p[a+2],p[b+2],p[c+2])), maxZ=Math.min(domain.maxZ,Math.max(p[a+2],p[b+2],p[c+2]));
      if (minX>maxX||minZ>maxZ) continue;
      const id=triangles.length;triangles.push({p,a,b,c});
      for(let x=Math.floor(minX/cell);x<=Math.floor(maxX/cell);x++)for(let z=Math.floor(minZ/cell);z<=Math.floor(maxZ/cell);z++) {
        const key=x+','+z, list=cells.get(key); if(list)list.push(id);else cells.set(key,[id]);
      }
    }
  }
  return { triangles:triangles.length,
  /** Read-only exact surface candidates for one-time source qualification.
   * Existing terrain, source priorities and point sampling remain unchanged. */
  projectedTriangles(bounds:WalkingBounds):readonly WalkingTerrainTriangle[] {
    const ids=new Set<number>(),out:WalkingTerrainTriangle[]=[];
    for(let x=Math.floor(bounds.minX/cell);x<=Math.floor(bounds.maxX/cell);x++)for(let z=Math.floor(bounds.minZ/cell);z<=Math.floor(bounds.maxZ/cell);z++)for(const id of cells.get(x+','+z)??[])ids.add(id);
    for(const id of ids){const{p,a,b,c}=triangles[id];
      if(Math.min(p[a],p[b],p[c])>bounds.maxX||Math.max(p[a],p[b],p[c])<bounds.minX||Math.min(p[a+2],p[b+2],p[c+2])>bounds.maxZ||Math.max(p[a+2],p[b+2],p[c+2])<bounds.minZ)continue;
      out.push({vertices:[[p[a],p[a+1],p[a+2]],[p[b],p[b+1],p[b+2]],[p[c],p[c+1],p[c+2]]]});
    }return out;
  }, sample(x:number,z:number):Support|null {
    if(x<domain.minX||x>domain.maxX||z<domain.minZ||z>domain.maxZ)return null;
    let result:Support|null=null;
    for(const id of cells.get(Math.floor(x/cell)+','+Math.floor(z/cell))??[]) {
      const {p,a,b,c}=triangles[id], dx1=p[b]-p[a],dz1=p[b+2]-p[a+2],dx2=p[c]-p[a],dz2=p[c+2]-p[a+2],det=dx1*dz2-dx2*dz1;
      if(Math.abs(det)<1e-9)continue;
      const u=((x-p[a])*dz2-(z-p[a+2])*dx2)/det,v=(dx1*(z-p[a+2])-dz1*(x-p[a]))/det;
      if(u< -1e-6||v< -1e-6||u+v>1+1e-6)continue;
      const dy1=p[b+1]-p[a+1],dy2=p[c+1]-p[a+1],height=p[a+1]+u*dy1+v*dy2;
      const slope=Math.hypot((dy1*dz2-dy2*dz1)/det,(dx1*dy2-dx2*dy1)/det);
      if(!result||height>result.height)result={height,slope};
    }
    return result;
  }, /** Conservative support for a small, non-solid grass patch. The complete
   * disk must fit in one actual triangle, with no conflicting overlapping
   * plane. A handful of successful height probes cannot certify terrain holes. */
  groundcoverFootprint(x:number,z:number,radius:number):{height:number;minimumHeight:number;maximumHeight:number;slope:number}|null {
    if(![x,z,radius].every(Number.isFinite)||radius<=0||radius>4||x-radius<domain.minX||x+radius>domain.maxX||z-radius<domain.minZ||z+radius>domain.maxZ)return null;
    const nearby=new Set<number>();
    for(let cx=Math.floor((x-radius)/cell);cx<=Math.floor((x+radius)/cell);cx++)for(let cz=Math.floor((z-radius)/cell);cz<=Math.floor((z+radius)/cell);cz++)for(const id of cells.get(cx+','+cz)??[])nearby.add(id);
    const planes:{height:number;gx:number;gz:number;contains:boolean;id:number}[]=[];
    const distanceToSegment=(ax:number,az:number,bx:number,bz:number)=>{const dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l)):0;return Math.hypot(x-ax-t*dx,z-az-t*dz);};
    for(const id of nearby){
      const {p,a,b,c}=triangles[id],dx1=p[b]-p[a],dz1=p[b+2]-p[a+2],dx2=p[c]-p[a],dz2=p[c+2]-p[a+2],det=dx1*dz2-dx2*dz1;if(Math.abs(det)<1e-9)continue;
      const u=((x-p[a])*dz2-(z-p[a+2])*dx2)/det,v=(dx1*(z-p[a+2])-dz1*(x-p[a]))/det,inside=u>=0&&v>=0&&u+v<=1;
      const edge=Math.min(distanceToSegment(p[a],p[a+2],p[b],p[b+2]),distanceToSegment(p[b],p[b+2],p[c],p[c+2]),distanceToSegment(p[c],p[c+2],p[a],p[a+2]));
      if(!inside&&edge>radius)continue;
      const dy1=p[b+1]-p[a+1],dy2=p[c+1]-p[a+1],gx=(dy1*dz2-dy2*dz1)/det,gz=(dx1*dy2-dx2*dy1)/det;
      planes.push({height:p[a+1]+u*dy1+v*dy2,gx,gz,contains:inside&&edge>=radius+1e-5,id});
    }
    const plane=planes.filter(p=>p.contains).sort((a,b)=>b.height-a.height)[0];if(!plane)return null;
    for(const other of planes){const {p,a,b,c}=triangles[other.id];for(const at of [a,b,c])if(Math.abs(p[at+1]-(plane.height+(p[at]-x)*plane.gx+(p[at+2]-z)*plane.gz))>2e-5)return null;}
    const slope=Math.hypot(plane.gx,plane.gz),variation=radius*slope;return{height:plane.height,minimumHeight:plane.height-variation,maximumHeight:plane.height+variation,slope};
  }, intersectsDisk(x:number,z:number,radius:number):boolean {
    const seen=new Set<number>(),limit=radius*radius;
    const segment=(ax:number,az:number,bx:number,bz:number)=>{
      const dx=bx-ax,dz=bz-az,length=dx*dx+dz*dz;
      const t=length>1e-20?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/length)):0;
      return (x-ax-dx*t)**2+(z-az-dz*t)**2;
    };
    for(let cx=Math.floor((x-radius)/cell);cx<=Math.floor((x+radius)/cell);cx++)
      for(let cz=Math.floor((z-radius)/cell);cz<=Math.floor((z+radius)/cell);cz++)
        for(const id of cells.get(cx+','+cz)??[]) {
          if(seen.has(id))continue;seen.add(id);
          const {p,a,b,c}=triangles[id],dx1=p[b]-p[a],dz1=p[b+2]-p[a+2],dx2=p[c]-p[a],dz2=p[c+2]-p[a+2],det=dx1*dz2-dx2*dz1;
          if(Math.abs(det)>1e-12) {
            const u=((x-p[a])*dz2-(z-p[a+2])*dx2)/det,v=(dx1*(z-p[a+2])-dz1*(x-p[a]))/det;
            if(u>=0&&v>=0&&u+v<=1)return true;
          }
          if(Math.min(segment(p[a],p[a+2],p[b],p[b+2]),segment(p[b],p[b+2],p[c],p[c+2]),segment(p[c],p[c+2],p[a],p[a+2]))<=limit)return true;
        }
    return false;
  }};
}
function stream(seed:number) {return()=>{seed=Math.imul(seed^seed>>>15,1|seed);seed^=seed+Math.imul(seed^seed>>>7,61|seed);return((seed^seed>>>14)>>>0)/4294967296;};}
function outerMean(points:readonly EaldholtWoodlandPlacement[], axis:'x'|'z', sign:number) {
  const sorted=[...points].sort((a,b)=>sign*(a[axis]-b[axis])), n=Math.max(1,Math.min(12,Math.ceil(points.length/8)));
  return sorted.slice(0,n).reduce((v,p)=>({x:v.x+p.x/n,z:v.z+p.z/n}),{x:0,z:0});
}

/** Deterministic complete-tree groves. Quality tiers use prefixes of this one
 * HIGH pool; failed candidates cannot reshuffle any existing/local actors. */
type LayoutInput = {
  readonly land:readonly EaldholtWoodlandSurface[]; readonly water?:readonly EaldholtWoodlandSurface[];
  readonly geography:EaldholtFarGeography; readonly existingPlacements:readonly EaldholtWoodlandPlacement[];
  readonly existingCanopyRadius:number; readonly canopyRadius:number; readonly maximumTrees?:number;
  readonly groves?:readonly EaldholtFarGrove[];
};
export function createEaldholtFarWoodlandLayout(input:LayoutInput):EaldholtFarWoodlandLayout {return layout(input,false);}
/** Larger source-derived scenery is only published after its four HLOD levels
 * are resident. This separate policy does not relax the old raw-tree budgets. */
export function createEaldholtRegionalWoodlandLayout(input:LayoutInput):EaldholtFarWoodlandLayout {return layout(input,true);}
function layout(input:LayoutInput,regional:boolean):EaldholtFarWoodlandLayout {
  const maximum=input.maximumTrees??96, {canopyRadius,existingCanopyRadius}=input;
  if(!Number.isInteger(maximum)||maximum<0||maximum>(regional?2048:EALDHOLT_FAR_WOODLAND_LOD_BUDGET.actors)
    || !Number.isFinite(canopyRadius)||canopyRadius<=0||canopyRadius>25
    || !Number.isFinite(existingCanopyRadius)||existingCanopyRadius<0||existingCanopyRadius>100)throw Error('Invalid far woodland budget or crown.');
  const existing=input.existingPlacements;
  if(!existing.length||existing.some(p=>![p.x,p.y,p.z,p.scale,p.yaw].every(Number.isFinite)||p.scale<=0))throw Error('Far woodland requires the unchanged local tree placements.');
  const north=outerMean(existing,'z',1), east=outerMean(existing,'x',-1),south=outerMean(existing,'z',-1);
  const box=input.geography.sourceEnvelope, midX=(box.minX+box.maxX)/2,midZ=(box.minZ+box.maxZ)/2;
  const groves=input.groves??(regional?[
    {x:midX+80,z:box.minZ-280,radiusX:260,radiusZ:220},
    {x:box.maxX+300,z:box.minZ-260,radiusX:260,radiusZ:230},
    {x:box.maxX+520,z:midZ+20,radiusX:250,radiusZ:260},
    {x:box.maxX+380,z:box.maxZ+320,radiusX:280,radiusZ:230},
  ]:[
    {x:north.x-10,z:north.z-34,radiusX:48,radiusZ:48},
    {x:(north.x+east.x)/2+26,z:north.z-20,radiusX:50,radiusZ:44},
    {x:east.x+42,z:east.z-8,radiusX:48,radiusZ:58},
    {x:south.x+12,z:south.z+40,radiusX:52,radiusZ:50},
  ]);
  if(groves.length<3||groves.length>4||groves.some(g=>![g.x,g.z,g.radiusX,g.radiusZ].every(Number.isFinite)||g.radiusX<10||g.radiusZ<10||g.radiusX>(regional?400:100)||g.radiusZ>(regional?400:100)))throw Error('Far woodland needs three or four bounded groves.');
  const pad=canopyRadius*1.4+2, domain={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
  for(const g of groves){domain.minX=Math.min(domain.minX,g.x-g.radiusX-pad);domain.maxX=Math.max(domain.maxX,g.x+g.radiusX+pad);domain.minZ=Math.min(domain.minZ,g.z-g.radiusZ-pad);domain.maxZ=Math.max(domain.maxZ,g.z+g.radiusZ+pad);}
  if(domain.maxX-domain.minX>1600||domain.maxZ-domain.minZ>1600)throw Error('Far woodland domain exceeds its bounded local continuation.');
  const land=createEaldholtWoodlandSupportIndex(input.land,domain),water=createEaldholtWoodlandSupportIndex(input.water??[],domain), buckets:EaldholtFarWoodlandPlacement[][]=groves.map(()=>[]);
  const random=groves.map((_,i)=>stream(0x4f616b31+i)),rejected:Record<string,number>={}, attempts=groves.map(()=>0);
  const fail=(why:string)=>{rejected[why]=(rejected[why]??0)+1;};
  const protectedSource=input.geography.sourceEnvelope;
  const all:EaldholtFarWoodlandPlacement[]=[],crownCells=new Map<string,{x:number;z:number;radius:number;existing:boolean}[]>();
  const crownCell=Math.max(8,canopyRadius*3,existingCanopyRadius*2),key=(x:number,z:number)=>Math.floor(x/crownCell)+','+Math.floor(z/crownCell);
  const insert=(p:{x:number;z:number;radius:number;existing:boolean})=>{const k=key(p.x,p.z),list=crownCells.get(k);if(list)list.push(p);else crownCells.set(k,[p]);};
  let maximumCrown=0;
  for(const p of existing){const radius=existingCanopyRadius*p.scale;maximumCrown=Math.max(maximumCrown,radius);insert({...p,radius,existing:true});}
  const overlaps=(x:number,z:number,radius:number)=>{const reach=radius+maximumCrown;
    for(let cx=Math.floor((x-reach)/crownCell);cx<=Math.floor((x+reach)/crownCell);cx++)for(let cz=Math.floor((z-reach)/crownCell);cz<=Math.floor((z+reach)/crownCell);cz++)
      for(const p of crownCells.get(cx+','+cz)??[])if(Math.hypot(p.x-x,p.z-z)<(radius+p.radius)*(p.existing?1:.65))return true;
    return false;};
  const dry=(x:number,z:number)=>sampleEaldholtFarGeography(input.geography,x,z).kind==='mainland'&&!water.sample(x,z);
  for(let round=0;round<maximum*100&&all.length<maximum;round++)for(let group=0;group<groves.length&&all.length<maximum;group++) {
    if(buckets[group].length>=Math.ceil(maximum/groves.length))continue;
    const r=random[group],g=groves[group];attempts[group]++;
    const angle=r()*Math.PI*2, radius=Math.sqrt(r()),x=g.x+Math.cos(angle)*radius*g.radiusX,z=g.z+Math.sin(angle)*radius*g.radiusZ;
    const scale=.92+r()*.36, footprint=canopyRadius*scale;
    if(x+footprint>protectedSource.minX-4&&x-footprint<protectedSource.maxX+4&&z+footprint>protectedSource.minZ-4&&z-footprint<protectedSource.maxZ+4){fail('source');continue;}
    // Exact continuous disk/triangle clearance catches narrow wet wedges
    // between the eight terrain-height probes around a complete crown.
    if(!dry(x,z)||water.intersectsDisk(x,z,footprint+.35)){fail('water');continue;}
    if(regional?overlaps(x,z,footprint):(existing.some(p=>Math.hypot(p.x-x,p.z-z)<footprint+existingCanopyRadius*p.scale)||all.some(p=>Math.hypot(p.x-x,p.z-z)<Math.max(3,canopyRadius*(scale+p.scale)*.78)))){fail('crown');continue;}
    const centre=land.sample(x,z);if(!centre||centre.slope>.62){fail('support');continue;}
    let valid=true;
    for(let edge=0;edge<8;edge++) {
      const a=edge*Math.PI/4,sx=x+Math.cos(a)*footprint,sz=z+Math.sin(a)*footprint,s=land.sample(sx,sz);
      if(!s||s.slope>.72||Math.abs(s.height-centre.height)>2.5||!dry(sx,sz)){valid=false;break;}
    }
    if(!valid){fail('footprint');continue;}
    const p={x,y:centre.height,z,scale,yaw:r()*Math.PI*2,region:'mainland' as const,grove:group};buckets[group].push(p);all.push(p);maximumCrown=Math.max(maximumCrown,footprint);insert({x,z,radius:footprint,existing:false});
  }
  const placements:EaldholtFarWoodlandPlacement[]=[];
  for(let i=0;i<Math.max(0,...buckets.map(b=>b.length));i++)for(const b of buckets)if(b[i])placements.push(b[i]);
  return {placements,groves:groves.map(g=>({...g})),acceptedPerGrove:buckets.map(b=>b.length),attempted:attempts.reduce((a,b)=>a+b,0),rejected,supportTriangles:land.triangles};
}

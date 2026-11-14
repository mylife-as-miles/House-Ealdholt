import { SETTLEMENT_TOOLS, type SettlementPlacement } from './contract';
export interface SettlementObstacle { x: number; z: number; width: number; depth: number; yaw?: number }
export interface SettlementSurface {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  groundAt(x: number, z: number): number;
  dryAt(x: number, z: number): boolean;
  clearAt?(x: number, y: number, z: number): boolean;
  obstacles: readonly SettlementObstacle[];
  paths: readonly { points: readonly (readonly [number, number])[]; width: number }[];
}
type Point = readonly [number, number];
const EPS = 1e-7;
export function placementCorners(p: SettlementObstacle): Point[] {
  const c = Math.cos(p.yaw ?? 0), s = Math.sin(p.yaw ?? 0);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z]) => [p.x+c*x*p.width/2+s*z*p.depth/2,p.z-s*x*p.width/2+c*z*p.depth/2] as Point);
}
export function placementObstacle(p: SettlementPlacement): SettlementObstacle { return { x:p.x,z:p.z,width:p.width,depth:p.depth,yaw:p.rotation*Math.PI/2 }; }
function overlaps(a: Point[], b: Point[], margin = .3): boolean {
  for(const polygon of [a,b]) for(let i=0;i<4;i++) {
    const next=polygon[(i+1)%4],dx=next[0]-polygon[i][0],dz=next[1]-polygon[i][1],length=Math.hypot(dx,dz),ax=-dz/length,az=dx/length;
    const pa=a.map(p=>p[0]*ax+p[1]*az),pb=b.map(p=>p[0]*ax+p[1]*az);
    if(Math.max(...pa)+margin<=Math.min(...pb)||Math.max(...pb)+margin<=Math.min(...pa))return false;
  }
  return true;
}
function pointSegment(p: Point,a: Point,b: Point) {
  const dx=b[0]-a[0],dz=b[1]-a[1],square=dx*dx+dz*dz,t=square?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/square)):0;
  return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);
}
function cross(a:Point,b:Point,c:Point){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function segmentsMeet(a:Point,b:Point,c:Point,d:Point){
  const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
  if(abC*abD < -EPS && cdA*cdB < -EPS)return true;
  return (Math.abs(abC)<EPS&&pointSegment(c,a,b)<EPS)||(Math.abs(abD)<EPS&&pointSegment(d,a,b)<EPS)||(Math.abs(cdA)<EPS&&pointSegment(a,c,d)<EPS)||(Math.abs(cdB)<EPS&&pointSegment(b,c,d)<EPS);
}
function inside(point:Point,polygon:Point[]){const signs=polygon.map((p,i)=>cross(p,polygon[(i+1)%4],point));return signs.every(v=>v>=-EPS)||signs.every(v=>v<=EPS);}
function pathDistance(corners:Point[],a:Point,b:Point){
  if(inside(a,corners)||inside(b,corners))return 0;
  let distance=Infinity;
  for(let i=0;i<4;i++){const c=corners[i],d=corners[(i+1)%4];if(segmentsMeet(a,b,c,d))return 0;distance=Math.min(distance,pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b));}
  return distance;
}
export function validPlacementShape(p: unknown): p is SettlementPlacement {
  if(!p||typeof p!=='object')return false;const v=p as SettlementPlacement,tool=SETTLEMENT_TOOLS.find(t=>t.id===v.kind);
  return !!tool && typeof v.id==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(v.id)
    && !['banner-hall','muster-grounds','war-record','heralds-station'].includes(v.id)
    && [v.x,v.z,v.width,v.depth].every(Number.isFinite) && Math.abs(v.x)<1e6 && Math.abs(v.z)<1e6
    && [0,1,2,3].includes(v.rotation) && Number.isInteger(v.rotation)
    && v.width===tool.width && v.depth===tool.depth && v.crop===null;
}
export function validatePlacement(p: SettlementPlacement, surface: SettlementSurface, existing: readonly SettlementPlacement[] = []): string | null {
  if(!validPlacementShape(p))return 'Choose a valid building.';
  const rect=placementObstacle(p),corners=placementCorners(rect),b=surface.bounds;
  if(corners.some(([x,z])=>x<b.minX+1||x>b.maxX-1||z<b.minZ+1||z>b.maxZ-1))return 'Keep this plot within the estate boundary.';
  if(surface.obstacles.some(o=>overlaps(corners,placementCorners(o))))return 'This plot overlaps a building.';
  if(existing.some(o=>o.id!==p.id&&overlaps(corners,placementCorners(placementObstacle(o)))))return 'This plot overlaps another placement.';
  for(const path of surface.paths)for(let i=1;i<path.points.length;i++)if(pathDistance(corners,path.points[i-1],path.points[i])<path.width/2+.65)return 'Keep the paths clear.';
  const c=Math.cos(rect.yaw!),s=Math.sin(rect.yaw!),heights:number[]=[];
  for(let ix=0;ix<=Math.ceil(p.width/2);ix++)for(let iz=0;iz<=Math.ceil(p.depth/2);iz++){
    const lx=-p.width/2+ix/Math.ceil(p.width/2)*p.width,lz=-p.depth/2+iz/Math.ceil(p.depth/2)*p.depth;
    const x=p.x+c*lx+s*lz,z=p.z-s*lx+c*lz,y=surface.groundAt(x,z);
    if(!Number.isFinite(y)||!surface.dryAt(x,z))return 'Choose dry ground for this plot.';
    if(surface.clearAt&&!surface.clearAt(x,y,z))return 'There is not enough clear ground here.';
    heights.push(y);
  }
  if(Math.max(...heights)-Math.min(...heights)>.9)return 'The ground is too steep for this plot.';
  return null;
}

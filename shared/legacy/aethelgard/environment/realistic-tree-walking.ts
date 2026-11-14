import type {RootTerrainSupport} from './vegetation-root-contact';
export const REALISTIC_TREE_WALKING_VERSION='terrain-walk-volume-v1';
export type WalkingPoint=readonly[number,number,number];
export interface WalkingTerrainTriangle {readonly vertices:readonly[WalkingPoint,WalkingPoint,WalkingPoint]}
export interface WalkingBounds {readonly minX:number;readonly maxX:number;readonly minZ:number;readonly maxZ:number}
const epsilon=1e-7;
function clip(polygon:readonly WalkingPoint[],distance:(point:WalkingPoint)=>number):WalkingPoint[]{
 const result:WalkingPoint[]=[];
 for(let at=0;at<polygon.length;at++){const a=polygon[at],b=polygon[(at+1)%polygon.length],da=distance(a),db=distance(b),keep=da>=-epsilon,next=db>=-epsilon;
  if(keep)result.push(a);if(keep!==next){const t=da/(da-db);result.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t]);}
 }return result;
}

/** One-time worker qualification. Complete-source wood remains inside the old
 * reserved radius at every height occupied by a 3.5 m walker above actual ground.
 * Triangles and edge intersections account for scale, burial and terrain slope.
 * Uncertain overlapping support retains the original visual instead of granting
 * a clearance certificate from a centre ray or unburied prototype profile. */
export function realisticTreeWalkingClearance(input:{x:number;y:number;z:number;yaw:number;scale:number;reservedRadius:number;triangles:Float64Array;
 sample(x:number,z:number):RootTerrainSupport|null;terrain?(bounds:WalkingBounds):readonly WalkingTerrainTriangle[]}): 'clear'|'overflow'|'uncertain'{
 const {x,y,z,scale,triangles,reservedRadius}=input;
 if(![x,y,z,input.yaw,scale,reservedRadius].every(Number.isFinite)||scale<=0||reservedRadius<=0||!(triangles instanceof Float64Array)||triangles.length%9||triangles.length>9883*9||!triangles.every(Number.isFinite))return 'uncertain';
 if(!triangles.length)return 'clear';if(!input.terrain)return 'uncertain';
 const c=Math.cos(input.yaw),s=Math.sin(input.yaw),world=new Float64Array(triangles.length);
 const bounds={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
 for(let at=0;at<triangles.length;at+=3){const px=x+(triangles[at]*c+triangles[at+2]*s)*scale,pz=z+(-triangles[at]*s+triangles[at+2]*c)*scale;
  world[at]=px;world[at+1]=y+triangles[at+1]*scale;world[at+2]=pz;bounds.minX=Math.min(bounds.minX,px);bounds.maxX=Math.max(bounds.maxX,px);bounds.minZ=Math.min(bounds.minZ,pz);bounds.maxZ=Math.max(bounds.maxZ,pz);
 }
 const terrain=input.terrain(bounds).map(({vertices})=>{const[a,b,d]=vertices,dx1=b[0]-a[0],dz1=b[2]-a[2],dx2=d[0]-a[0],dz2=d[2]-a[2],det=dx1*dz2-dx2*dz1;
  return{vertices,det,gx:((b[1]-a[1])*dz2-(d[1]-a[1])*dz1)/det,gz:(dx1*(d[1]-a[1])-dx2*(b[1]-a[1]))/det,
   minX:Math.min(a[0],b[0],d[0]),maxX:Math.max(a[0],b[0],d[0]),minZ:Math.min(a[2],b[2],d[2]),maxZ:Math.max(a[2],b[2],d[2]),minY:Math.min(a[1],b[1],d[1]),maxY:Math.max(a[1],b[1],d[1])};
 }).filter(t=>Math.abs(t.det)>=1e-9);
 if(!terrain.length)return 'uncertain';const radius=reservedRadius*scale,minimumGround=Math.min(...terrain.map(t=>t.minY)),maximumGround=Math.max(...terrain.map(t=>t.maxY));
 for(let at=0;at<world.length;at+=9){const triangle:WalkingPoint[]=[0,3,6].map(offset=>[world[at+offset],world[at+offset+1],world[at+offset+2]]);
  if(triangle.every(p=>Math.hypot(p[0]-x,p[2]-z)<=radius+epsilon))continue;
  const minX=Math.min(...triangle.map(p=>p[0])),maxX=Math.max(...triangle.map(p=>p[0])),minZ=Math.min(...triangle.map(p=>p[2])),maxZ=Math.max(...triangle.map(p=>p[2])),minY=Math.min(...triangle.map(p=>p[1])),maxY=Math.max(...triangle.map(p=>p[1]));
  if(maxY<minimumGround-epsilon||minY>maximumGround+3.5+epsilon)continue;
  for(const t of terrain){if(t.maxX<minX-epsilon||t.minX>maxX+epsilon||t.maxZ<minZ-epsilon||t.minZ>maxZ+epsilon||maxY<t.minY-epsilon||minY>t.maxY+3.5+epsilon)continue;
   const[a,b,d]=t.vertices,sign=Math.sign(t.det),ground=(p:WalkingPoint)=>a[1]+t.gx*(p[0]-a[0])+t.gz*(p[2]-a[2]);let polygon=triangle;
   for(const[p,q]of[[a,b],[b,d],[d,a]]){polygon=clip(polygon,v=>sign*((q[0]-p[0])*(v[2]-p[2])-(q[2]-p[2])*(v[0]-p[0])));if(!polygon.length)break;}
   polygon=clip(polygon,p=>p[1]-ground(p));polygon=clip(polygon,p=>3.5-(p[1]-ground(p)));
   for(const p of polygon){if(Math.hypot(p[0]-x,p[2]-z)<=radius+epsilon)continue;
    const support=input.sample(p[0],p[2]);if(!support||!Number.isFinite(support.height))return 'uncertain';
    // Either this is an authoritative walking-volume witness, or overlapping
    // support makes this projected proof uncertain. Both retain source fallback.
    const above=p[1]-support.height;if(above>=-2e-6&&above<=3.5+2e-6)return 'overflow';return 'uncertain';
   }
  }
 }
 return 'clear';
}

import { noise3 } from '../../environment/kernel/noise';

export type EaldholtEdge = readonly (readonly [coordinate:number,height:number])[];
export interface EaldholtTerrainEdges {
  minX:number;maxX:number;minZ:number;maxZ:number;
  west:EaldholtEdge;east:EaldholtEdge;north:EaldholtEdge;south:EaldholtEdge;
}
export interface EaldholtValleyMesh {
  positions:Float32Array;normals:Float32Array;uv:Float32Array;colours:Float32Array;indices:Uint16Array;
}
export interface EaldholtRiverValleyBuffers {
  land:EaldholtValleyMesh;water:EaldholtValleyMesh;
  bounds:{min:readonly[number,number,number];max:readonly[number,number,number]};
  triangles:number;bufferBytes:number;sourceJoinVertices:number;
}
type Point=[number,number,number];
type Vertex={point:Point;u:number;index:number};
const segments=64;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;

/** Linear semantic palette sampled at a real bank distance, before the PBR
 * photo layers. The same field is used for refined coastal transition vertices. */
export function sampleEaldholtRiverPalette(x:number,z:number,shore:number,normalY=1):[number,number,number] {
  const dampWidth=2.2+.9*Math.sin(x*.17+.8)+.4*Math.sin(x*.43),meadow=smooth(dampWidth*.4,dampWidth+4,shore);
  const wet=1-smooth(0,dampWidth,shore),variation=.9+.2*noise3(x*.035,0,z*.035,5813),soil=[.105,.081,.054],grass=[.063,.080,.034];
  const stone=smooth(.12,.46,1-normalY),rock=[.10,.105,.102];
  return soil.map((value,c)=>lerp(lerp(value,grass[c],meadow)*lerp(1,.6,wet)*variation,rock[c],stone))as[number,number,number];
}

/** Profile data comes only from an already loaded private model, never bundled
 * source-height arrays. The +Z presentation side is not a canon compass bearing. */
export function createEaldholtRiverValleyBuffers(e:EaldholtTerrainEdges,profile:'desktop'|'quest'='desktop'):EaldholtRiverValleyBuffers {
  const margin=profile==='quest'?30:70,ratio=margin/70;
  if(![e.minX,e.maxX,e.minZ,e.maxZ].every(Number.isFinite)||e.maxX<=e.minX||e.maxZ<=e.minZ)throw Error('Invalid source terrain envelope.');
  for(const side of ['west','east','north','south']as const){
    const edge=e[side],lo=side==='west'||side==='east'?e.minZ:e.minX,hi=side==='west'||side==='east'?e.maxZ:e.maxX;
    if(edge.length<2||edge.length>4096||Math.abs(edge[0][0]-lo)>.001||Math.abs(edge[edge.length-1][0]-hi)>.001)throw Error('Incomplete source terrain boundary.');
    for(let i=0;i<edge.length;i++)if(!edge[i].every(Number.isFinite)||(i&&edge[i][0]<=edge[i-1][0]))throw Error('Invalid source edge samples.');
  }
  for(const [a,b]of [[e.west[0],e.north[0]],[e.east[0],e.north[e.north.length-1]],[e.west[e.west.length-1],e.south[0]],[e.east[e.east.length-1],e.south[e.south.length-1]]])if(Math.abs(a[1]-b[1])>.03)throw Error('Source terrain corner does not join.');
  const sourceJoinVertices=e.west.length+e.east.length+e.north.length+e.south.length;
  function height(edge:EaldholtEdge,at:number){
    let lo=0,hi=edge.length-1;if(at<=edge[lo][0])return edge[lo][1];if(at>=edge[hi][0])return edge[hi][1];
    while(hi-lo>1){const mid=(lo+hi)>>1;if(edge[mid][0]<=at)lo=mid;else hi=mid;}
    return lerp(edge[lo][1],edge[hi][1],(at-edge[lo][0])/(edge[hi][0]-edge[lo][0]));
  }
  function outsideHeight(x:number,z:number){
    const dx=Math.max(e.minX-x,0,x-e.maxX),dz=Math.max(e.minZ-z,0,z-e.maxZ),distance=Math.hypot(dx,dz);
    const h=x<e.minX?height(e.west,z):x>e.maxX?height(e.east,z):z<e.minZ?height(e.north,x):height(e.south,x);
    const rolling=3.8+2.2*(noise3(x*.033,0,z*.033,5731)-.5)+1.4*(noise3(x*.09,0,z*.09,5743)-.5);
    return lerp(h,rolling,smooth(0,35,distance));
  }
  const positions:number[]=[],colours:number[]=[],indices:number[]=[],uv:number[]=[];
  const river=(x:number)=>({center:e.maxZ+margin*.6+ratio*(5*Math.sin(x*.035)+1.6*Math.sin(x*.087+1.1)),half:5.5+.75*Math.sin(x*.043+.8),level:.4-.0006*(x-(e.minX+e.maxX)/2)});
  function vertex(p:Point):Vertex{
    const index=positions.length/3;positions.push(...p);uv.push(p[0]/2,-p[2]/2);
    const r=river(p[0]);
    const shore=Math.abs(p[2]-r.center)-r.half;
    colours.push(...sampleEaldholtRiverPalette(p[0],p[2],shore));
    return {point:p,u:0,index};
  }
  function row(points:Point[],axis:0|2):Vertex[]{const lo=points[0][axis],hi=points[points.length-1][axis];return points.map(p=>{const v=vertex(p);v.u=(p[axis]-lo)/(hi-lo);return v;});}
  function triangle(a:Vertex,b:Vertex,c:Vertex){
    const nx=(b.point[2]-a.point[2])*(c.point[0]-a.point[0])-(b.point[0]-a.point[0])*(c.point[2]-a.point[2]);
    if(Math.abs(nx)<1e-9)throw Error('Degenerate valley triangle.');
    if(nx>0)indices.push(a.index,b.index,c.index);else indices.push(a.index,c.index,b.index);
  }
  function stitch(a:Vertex[],b:Vertex[]){let i=0,j=0;while(i<a.length-1||j<b.length-1){if(j===b.length-1||(i<a.length-1&&a[i+1].u<=b[j+1].u)){triangle(a[i],a[i+1],b[j]);i++;}else{triangle(a[i],b[j+1],b[j]);j++;}}}
  function uniform(make:(t:number)=>Point,axis:0|2){return row(Array.from({length:segments+1},(_,i)=>make(i/segments)),axis);}
  const radial=[0,8*ratio,18*ratio,30*ratio,46*ratio,margin];
  function side(which:'west'|'east'){
    const edge=e[which],x=which==='west'?e.minX:e.maxX,sign=which==='west'?-1:1;
    const rows=[row(edge.map(([z,y])=>[x,y,z]),2)];
    for(const radius of radial.slice(1)){const outX=x+sign*radius;const next=uniform(t=>{const z=lerp(e.minZ,e.maxZ,t);return[outX,outsideHeight(outX,z),z];},2);stitch(rows[rows.length-1],next);rows.push(next);}return rows;
  }
  const west=side('west'),east=side('east');
  function crossJoin(which:'north'|'south'){
    const last=which==='north'?0:-1,z=which==='north'?e.minZ:e.maxZ;
    const points:Point[]=west.slice(1).reverse().map(r=>r[last===0?0:r.length-1].point);
    for(const [x,y]of e[which])points.push([x,y,z]);
    points.push(...east.slice(1).map(r=>r[last===0?0:r.length-1].point));return row(points,0);
  }
  let previous=crossJoin('north');
  for(const radius of radial.slice(1)){
    const z=e.minZ-radius,next=uniform(t=>{const x=lerp(e.minX-margin,e.maxX+margin,t);return[x,outsideHeight(x,z),z];},0);
    stitch(previous,next);previous=next;
  }
  previous=crossJoin('south');
  const westX=e.minX-margin,eastX=e.maxX+margin;
  // Each river row is a real bank/shore/bed contour, so the separate bounded
  // surface never blankets the landscape or intersects dry land at mid-channel.
  for(const band of ['foothill','terrace','near-bank','near-shore','bed','far-shore','far-bank','outer']as const){
    const next=uniform(t=>{
      const x=lerp(westX,eastX,t),r=river(x);let z:number,y:number;
      if(band==='foothill'||band==='terrace'||band==='outer'){
        z=e.maxZ+(band==='foothill'?4*ratio:band==='terrace'?12*ratio:margin);y=outsideHeight(x,z);
      }else if(band==='near-bank'){z=r.center-r.half-1.8;y=r.level+.45;}
      else if(band==='far-bank'){z=r.center+r.half+1.8;y=r.level+.45;}
      else if(band==='bed'){z=r.center;y=r.level-1.2-.2*Math.sin(x*.11);}
      else{z=r.center+(band==='near-shore'?-r.half:r.half);y=r.level-.06;}
      return[x,y,z];
    },0);stitch(previous,next);previous=next;
  }
  const land=finish(positions,uv,colours,indices);
  for(let i=0;i<land.colours.length;i+=3){
    const stone=smooth(.12,.46,1-land.normals[i+1]),palette=[.10,.105,.102];
    for(let c=0;c<3;c++)land.colours[i+c]=lerp(land.colours[i+c],palette[c],stone);
  }
  const waterPositions:number[]=[],waterUv:number[]=[],waterColours:number[]=[],waterIndices:number[]=[];
  for(let i=0;i<=segments;i++){
    const x=lerp(westX,eastX,i/segments),r=river(x);
    for(const sign of [-1,1]){waterPositions.push(x,r.level,r.center+sign*r.half);waterUv.push(x/2,(r.center+sign*r.half)/2);waterColours.push(1,1,1);}
    if(i){const a=(i-1)*2,b=a+1,c=i*2,d=c+1;waterIndices.push(a,b,c,b,d,c);}
  }
  const water=finish(waterPositions,waterUv,waterColours,waterIndices);
  const min:Point=[Infinity,Infinity,Infinity],max:Point=[-Infinity,-Infinity,-Infinity];
  for(const mesh of [land,water])for(let i=0;i<mesh.positions.length;i+=3)for(let c=0;c<3;c++){min[c]=Math.min(min[c],mesh.positions[i+c]);max[c]=Math.max(max[c],mesh.positions[i+c]);}
  const triangles=(land.indices.length+water.indices.length)/3,bufferBytes=[land,water].reduce((n,m)=>n+m.positions.byteLength+m.normals.byteLength+m.uv.byteLength+m.colours.byteLength+m.indices.byteLength,0);
  if(triangles>15000||bufferBytes>=1024*1024)throw Error('River valley exceeds the bounded geometry budget.');
  return {land,water,bounds:{min,max},triangles,bufferBytes,sourceJoinVertices};
}

/** Read boundary samples from the runtime private asset. Root-local coordinates
 * let both adapters ignore miniature/display transforms while keeping all child
 * actor matrices. No sample data is shipped with this general algorithm. */
export function collectEaldholtTerrainEdges(scan:(visit:(x:number,y:number,z:number)=>void)=>void):EaldholtTerrainEdges {
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,count=0;
  scan((x,y,z)=>{if(![x,y,z].every(Number.isFinite))throw Error('Nonfinite source terrain.');minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);count++;});
  if(count<4||minX===maxX||minZ===maxZ)throw Error('Source landscape is unavailable.');
  const maps={west:new Map<number,readonly[number,number]>(),east:new Map<number,readonly[number,number]>(),north:new Map<number,readonly[number,number]>(),south:new Map<number,readonly[number,number]>()};
  function sample(side:keyof typeof maps,coordinate:number,y:number){const key=Math.round(coordinate*10000),before=maps[side].get(key);if(before&&Math.abs(before[1]-y)>.03)throw Error('Overhanging terrain boundary requires a different join.');if(!before)maps[side].set(key,[coordinate,y]);}
  scan((x,y,z)=>{if(Math.abs(x-minX)<.0001)sample('west',z,y);if(Math.abs(x-maxX)<.0001)sample('east',z,y);if(Math.abs(z-minZ)<.0001)sample('north',x,y);if(Math.abs(z-maxZ)<.0001)sample('south',x,y);});
  const edge=(side:keyof typeof maps)=>[...maps[side].values()].sort((a,b)=>a[0]-b[0]);
  return {minX,maxX,minZ,maxZ,west:edge('west'),east:edge('east'),north:edge('north'),south:edge('south')};
}

function finish(positions:number[],uv:number[],colours:number[],indices:number[]):EaldholtValleyMesh {
  if(positions.length/3>65535)throw Error('Valley indices exceed Uint16.');
  const normals=new Float32Array(positions.length);
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    const ax=positions[b]-positions[a],ay=positions[b+1]-positions[a+1],az=positions[b+2]-positions[a+2];
    const bx=positions[c]-positions[a],by=positions[c+1]-positions[a+1],bz=positions[c+2]-positions[a+2];
    const x=ay*bz-az*by,y=az*bx-ax*bz,z=ax*by-ay*bx;
    for(const v of [a,b,c]){normals[v]+=x;normals[v+1]+=y;normals[v+2]+=z;}
  }
  for(let i=0;i<normals.length;i+=3){const length=Math.hypot(normals[i],normals[i+1],normals[i+2]);if(!length)throw Error('Degenerate valley normal.');for(let c=0;c<3;c++)normals[i+c]/=length;}
  return {positions:Float32Array.from(positions),normals,uv:Float32Array.from(uv),colours:Float32Array.from(colours),indices:Uint16Array.from(indices)};
}

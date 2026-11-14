/** Source-driven authored shore treatment. These masks describe damp ground
 * and a shallow-colour transition, not recovered bathymetry or hydrology. */
export const EALDHOLT_POND_SHORE=Object.freeze({resolution:128,planeTolerance:1e-4,
  minimumCapNormalY:1-1e-7,minimumCapProjectedFraction:.8,outsideMetres:.65,insideMetres:1.2,groundcoverMetres:.2,
  maximumByteLength:96*1024});
export const POND_SHORE_CHANNELS=Object.freeze({r:'outside-damp',g:'inside-shallow',b:'outside-groundcover-break',a:'treatment-support'});
export type PondShorePoint=readonly [number,number];
export interface PondShoreBounds {readonly min:PondShorePoint;readonly max:PondShorePoint}
export interface PondShoreOutline {
  /** Actual cap boundary, clockwise in XZ, starting at its minimum X then Z. */
  readonly boundary:readonly PondShorePoint[];readonly height:number;readonly bounds:PondShoreBounds;
  readonly metrics:{readonly triangles:number;readonly vertices:number;readonly boundaryEdges:number;readonly area:number;
    readonly projectedArea:number;readonly projectedFraction:number;readonly maximumDeviation:number};
}
export interface PondShoreMip {readonly width:number;readonly height:number;readonly data:Uint8Array}
export interface PondShoreField {
  readonly data:Uint8Array;readonly width:number;readonly height:number;readonly bounds:PondShoreBounds;readonly waterHeight:number;
  /** Complete chain INCLUDING level0; data aliases mipmaps[0].data. */
  readonly mipmaps:readonly PondShoreMip[];readonly byteLength:number;readonly baseByteLength:number;
  readonly channels:typeof POND_SHORE_CHANNELS;readonly normalization:255;
  readonly contact:{readonly mode:'cap-outline'|'terrain-contact';readonly terrainTriangles:number;readonly segments:number;readonly length:number;
    readonly terrainContactSegments:number;readonly terrainContactLength:number;readonly capEdgeSegments:number;readonly coplanarTerrainTriangles:number};
}
type Point3=readonly [number,number,number];
interface Triangle {points:Point3[];keys:string[];normal:Point3;area:number}
const point2=(x:number,z:number):PondShorePoint=>Object.freeze([x,z] as const);
const fail=(message:string):never=>{throw Error(`Unsupported pond shore: ${message}`);};
const key=(point:Point3)=>point.join(',');
const edgeKey=(a:string,b:string)=>JSON.stringify(a<b?[a,b]:[b,a]);
const signedArea=(boundary:readonly PondShorePoint[])=>boundary.reduce((sum,a,i)=>{
  const b=boundary[(i+1)%boundary.length],o=boundary[0];return sum+(a[0]-o[0])*(b[1]-o[1])-(b[0]-o[0])*(a[1]-o[1]);},0)/2;

/** Input is ALL flattened, drawn, verified pond triangle XYZ in root-local
 * metres (9numbers per triangle), including any bevel/sides/bottom. No source
 * buffer is mutated. An open cap disk is valid; holes, ambiguous water levels,
 * disconnected/nonmanifold caps and truncated/nonfinite draws throw Error. */
export function qualifyEaldholtPondShore(positions:readonly number[]|Float32Array|Float64Array):PondShoreOutline{
  if(!(Array.isArray(positions)||positions instanceof Float32Array||positions instanceof Float64Array)
    ||positions.length<9||positions.length%9)fail('complete drawn triangles are required.');
  for(let i=0;i<positions.length;i++)if(!Number.isFinite(positions[i]))fail('draw coordinates must be finite.');
  const triangles:Triangle[]=[],tolerance=EALDHOLT_POND_SHORE.planeTolerance;let highest=-Infinity,upArea=0;
  for(let offset=0;offset<positions.length;offset+=9){
    const points:Point3[]=[];
    for(let i=0;i<9;i+=3){const p:Point3=[positions[offset+i],positions[offset+i+1],positions[offset+i+2]];points.push(p);highest=Math.max(highest,p[1]);}
    const [a,b,c]=points,ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,length=Math.hypot(nx,ny,nz);
    if(!Number.isFinite(length)||length<=1e-12)fail('degenerate drawn triangle.');
    triangles.push({points,keys:points.map(key),normal:[nx/length,ny/length,nz/length],area:length/2});upArea+=Math.max(0,ny)/2;
  }
  const cap:Triangle[]=[];
  for(const triangle of triangles){
    if(triangle.normal[1]<EALDHOLT_POND_SHORE.minimumCapNormalY)continue;
    const low=Math.min(...triangle.points.map(p=>p[1])),high=Math.max(...triangle.points.map(p=>p[1]));
    if(high-low>tolerance)fail('upper surface is nonplanar.');
    if(highest-low>tolerance)fail('ambiguous caps at multiple water levels.');cap.push(triangle);
  }
  if(!cap.length)fail('no consistent highest horizontal upward cap.');
  const stable=cap.reduce((best,face)=>face.area>best.area?face:best),origin=stable.points[0],normal=stable.normal;
  const edges=new Map<string,{a:string;b:string;faces:number[]}>(),vertices=new Map<string,Point3>(),neighbours=cap.map(()=>new Set<number>());
  let area=0,projectedArea=0,maximumDeviation=0;
  for(let i=0;i<cap.length;i++){
    const face=cap[i];area+=face.area;projectedArea+=face.area*face.normal[1];
    if(face.normal.reduce((sum,n,j)=>sum+n*normal[j],0)<EALDHOLT_POND_SHORE.minimumCapNormalY)fail('inconsistent cap normals.');
    for(let j=0;j<3;j++){
      const p=face.points[j];maximumDeviation=Math.max(maximumDeviation,Math.abs(normal.reduce((sum,n,k)=>sum+n*(p[k]-origin[k]),0)));
      vertices.set(face.keys[j],p);const a=face.keys[j],b=face.keys[(j+1)%3],id=edgeKey(a,b),edge=edges.get(id)??{a,b,faces:[]};
      for(const other of edge.faces){neighbours[i].add(other);neighbours[other].add(i);}edge.faces.push(i);edges.set(id,edge);
    }
  }
  if(!Number.isFinite(area)||!Number.isFinite(projectedArea)||!Number.isFinite(upArea))fail('drawn area must be finite.');
  if(maximumDeviation>tolerance)fail('upper cap exceeds the1e-4m plane tolerance.');
  const reached=new Set<number>(),pending=[0];
  while(pending.length){const i=pending.pop()!;if(reached.has(i))continue;reached.add(i);pending.push(...neighbours[i]);}
  if(reached.size!==cap.length)fail('upper cap is disconnected.');
  const boundaryNeighbours=new Map<string,string[]>();
  for(const edge of edges.values()){
    if(edge.faces.length>2)fail('upper cap is nonmanifold.');
    if(edge.faces.length===1){boundaryNeighbours.set(edge.a,[...(boundaryNeighbours.get(edge.a)??[]),edge.b]);boundaryNeighbours.set(edge.b,[...(boundaryNeighbours.get(edge.b)??[]),edge.a]);}
  }
  if(!boundaryNeighbours.size||[...boundaryNeighbours.values()].some(next=>next.length!==2))fail('invalid cap boundary.');
  const sorted=[...boundaryNeighbours.keys()].sort((a,b)=>vertices.get(a)![0]-vertices.get(b)![0]||vertices.get(a)![2]-vertices.get(b)![2]);
  const first=sorted[0],seen=new Set<string>(),ordered:PondShorePoint[]=[];let current=first,previous='';
  do{if(seen.has(current))fail('invalid cap boundary loop.');seen.add(current);const p=vertices.get(current)!;ordered.push(point2(p[0],p[2]));
    const next=boundaryNeighbours.get(current)!.find(id=>id!==previous)!;previous=current;current=next;
  }while(current!==first);
  if(seen.size!==boundaryNeighbours.size)fail('upper cap has a hole or warped interior.');
  if(signedArea(ordered)>0)ordered.splice(1,ordered.length-1,...ordered.slice(1).reverse());
  validatePolygon(ordered);
  if(Math.abs(-signedArea(ordered)-projectedArea)>Math.max(1e-8,projectedArea*1e-7))fail('cap triangles do not conserve the boundary area.');
  const projectedFraction=projectedArea/upArea;
  if(projectedFraction<EALDHOLT_POND_SHORE.minimumCapProjectedFraction)fail('upper cap is not dominant.');
  return Object.freeze({boundary:Object.freeze(ordered),height:highest,bounds:polygonBounds(ordered),metrics:Object.freeze({
    triangles:cap.length,vertices:vertices.size,boundaryEdges:ordered.length,area,projectedArea,projectedFraction,maximumDeviation})});
}

function polygonBounds(boundary:readonly PondShorePoint[]):PondShoreBounds{
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
  for(const [x,z] of boundary){minX=Math.min(minX,x);minZ=Math.min(minZ,z);maxX=Math.max(maxX,x);maxZ=Math.max(maxZ,z);}
  return Object.freeze({min:point2(minX,minZ),max:point2(maxX,maxZ)});
}
function validatePolygon(boundary:readonly PondShorePoint[]):void{
  if(boundary.length<3||boundary.some(p=>p.length!==2||!p.every(Number.isFinite)))fail('finite polygon coordinates are required.');
  const bounds=polygonBounds(boundary),span=Math.max(bounds.max[0]-bounds.min[0],bounds.max[1]-bounds.min[1]);
  if(!Number.isFinite(span)||span<=0||!Number.isFinite(signedArea(boundary))||Math.abs(signedArea(boundary))<=1e-12)fail('polygon has no finite area.');
  const epsilon=Math.max(1,span*span)*1e-12;
  const cross=(a:PondShorePoint,b:PondShorePoint,p:PondShorePoint)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
  const on=(a:PondShorePoint,b:PondShorePoint,p:PondShorePoint)=>Math.abs(cross(a,b,p))<=epsilon
    &&p[0]>=Math.min(a[0],b[0])-epsilon&&p[0]<=Math.max(a[0],b[0])+epsilon&&p[1]>=Math.min(a[1],b[1])-epsilon&&p[1]<=Math.max(a[1],b[1])+epsilon;
  for(let i=0;i<boundary.length;i++){
    const a=boundary[i],b=boundary[(i+1)%boundary.length];if(Math.hypot(b[0]-a[0],b[1]-a[1])<=1e-12)fail('boundary edge is degenerate.');
    for(let j=i+1;j<boundary.length;j++){
      if(j===i+1||(i===0&&j===boundary.length-1))continue;
      const c=boundary[j],d=boundary[(j+1)%boundary.length],ac=cross(a,b,c),ad=cross(a,b,d),ca=cross(c,d,a),cb=cross(c,d,b);
      if((ac*ad<0&&ca*cb<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))fail('boundary self-intersects.');
    }
  }
}

/** Positive inside, negative outside; Euclidean distance to the unchanged
 * polygon edges, never a radial approximation or an expanded water outline. */
function signedDistance(boundary:readonly PondShorePoint[],x:number,z:number):number{
  let inside=false,distanceSquared=Infinity;
  for(let i=0;i<boundary.length;i++){
    const a=boundary[i],b=boundary[(i+1)%boundary.length],dx=b[0]-a[0],dz=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
    distanceSquared=Math.min(distanceSquared,(x-a[0]-dx*t)**2+(z-a[1]-dz*t)**2);
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return Math.sqrt(distanceSquared)*(inside?1:-1);
}
interface ShoreSegment {a:PondShorePoint;b:PondShorePoint;terrain:boolean}
interface TerrainFace {points:Point3[];den:number}
const segmentLength=(a:PondShorePoint,b:PondShorePoint)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
function segmentDistance(segments:readonly ShoreSegment[],x:number,z:number):number{
  let squared=Infinity;
  for(const {a,b} of segments){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
    squared=Math.min(squared,(x-a[0]-t*dx)**2+(z-a[1]-t*dz)**2);}
  return Math.sqrt(squared);
}
function appendCuts(cuts:number[],a:PondShorePoint,b:PondShorePoint,c:PondShorePoint,d:PondShorePoint):void{
  const dx=b[0]-a[0],dz=b[1]-a[1],ex=d[0]-c[0],ez=d[1]-c[1],den=dx*ez-dz*ex;
  if(Math.abs(den)>1e-12){
    const t=((c[0]-a[0])*ez-(c[1]-a[1])*ex)/den,u=((c[0]-a[0])*dz-(c[1]-a[1])*dx)/den;
    if(t>0&&t<1&&u>=-1e-9&&u<=1+1e-9)cuts.push(t);
  }else if(Math.abs((c[0]-a[0])*dz-(c[1]-a[1])*dx)<1e-10){
    const lengthSquared=dx*dx+dz*dz;
    for(const p of [c,d]){const t=((p[0]-a[0])*dx+(p[1]-a[1])*dz)/lengthSquared;if(t>0&&t<1)cuts.push(t);}
  }
}

/** Exact triangle/plane contacts and exposed cap edges in the same local
 * frame. A small grid accelerates height queries; it does not rasterize or
 * displace the source contact. Highest terrain handles overlapping draws. */
function terrainShore(boundary:readonly PondShorePoint[],height:number,origin:PondShorePoint,spanX:number,spanZ:number,
  input:readonly number[]|Float32Array|Float64Array){
  if(!(Array.isArray(input)||input instanceof Float32Array||input instanceof Float64Array)||input.length%9)fail('complete terrain triangles are required.');
  for(let i=0;i<input.length;i++)if(!Number.isFinite(input[i]))fail('terrain coordinates must be finite.');
  const faces:TerrainFace[]=[],grid=new Map<number,TerrainFace[]>(),cells=32,margin=EALDHOLT_POND_SHORE.outsideMetres;
  const cellX=(x:number)=>Math.max(0,Math.min(cells-1,Math.floor((x+margin)/(spanX+2*margin)*cells)));
  const cellZ=(z:number)=>Math.max(0,Math.min(cells-1,Math.floor((z+margin)/(spanZ+2*margin)*cells)));
  const raw:ShoreSegment[]=[],add=(a:PondShorePoint,b:PondShorePoint,terrain=true)=>{if(segmentLength(a,b)>1e-9)raw.push({a,b,terrain});};
  let coplanar=0;
  for(let at=0;at<input.length;at+=9){
    const points:Point3[]=[];for(let j=0;j<9;j+=3)points.push([input[at+j]-origin[0],input[at+j+1]-height,input[at+j+2]-origin[1]]);
    const [a,b,c]=points,ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    const areaLength=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx);
    if(!Number.isFinite(areaLength)||areaLength<=1e-12)fail('degenerate or nonfinite terrain triangle.');
    const face={points,den:ux*vz-uz*vx};faces.push(face);
    const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0])),minZ=Math.min(...points.map(p=>p[2])),maxZ=Math.max(...points.map(p=>p[2]));
    if(maxX>=-margin&&minX<=spanX+margin&&maxZ>=-margin&&minZ<=spanZ+margin)
      for(let z=cellZ(minZ);z<=cellZ(maxZ);z++)for(let x=cellX(minX);x<=cellX(maxX);x++){const key=z*cells+x,list=grid.get(key)??[];list.push(face);grid.set(key,list);}
    const hits:PondShorePoint[]=[];if(points.every(p=>Math.abs(p[1])<1e-9))coplanar++;
    for(let j=0;j<3;j++){
      const p=points[j],q=points[(j+1)%3],p2=point2(p[0],p[2]),q2=point2(q[0],q[2]);
      if(Math.abs(p[1])<1e-9)hits.push(p2);
      if(p[1]*q[1]<0){const t=-p[1]/(q[1]-p[1]),hit=point2(p[0]+t*(q[0]-p[0]),p[2]+t*(q[2]-p[2]));hits.push(hit);
        if(p[1]>0)add(p2,hit);else add(hit,q2);
      }else if(p[1]>=0&&q[1]>=0)add(p2,q2);
    }
    const distinct=hits.filter((p,i)=>hits.findIndex(q=>segmentLength(p,q)<1e-9)===i);
    if(distinct.length===2)add(distinct[0],distinct[1]);
  }
  const terrainHeight=(x:number,z:number)=>{
    let highest=-Infinity;
    for(const face of grid.get(cellZ(z)*cells+cellX(x))??[]){
      if(Math.abs(face.den)<1e-12)continue;const [a,b,c]=face.points;
      const u=((x-a[0])*(c[2]-a[2])-(z-a[2])*(c[0]-a[0]))/face.den,v=((b[0]-a[0])*(z-a[2])-(b[2]-a[2])*(x-a[0]))/face.den;
      if(u>=-1e-9&&v>=-1e-9&&u+v<=1+1e-9)highest=Math.max(highest,a[1]+u*(b[1]-a[1])+v*(c[1]-a[1]));
    }
    return highest;
  };
  const wet=(x:number,z:number)=>signedDistance(boundary,x,z)>=0&&terrainHeight(x,z)<0;
  for(let i=0;i<boundary.length;i++)add(boundary[i],boundary[(i+1)%boundary.length],false);
  const result:ShoreSegment[]=[],seen=new Set<string>(),rawSeen=new Set<string>();
  const segmentKey=(a:PondShorePoint,b:PondShorePoint)=>[a.map(n=>n.toFixed(8)).join(','),b.map(n=>n.toFixed(8)).join(',')].sort().join('|');
  for(const candidate of raw){
    const {a,b}=candidate,rawKey=segmentKey(a,b);if(rawSeen.has(rawKey))continue;rawSeen.add(rawKey);
    if(Math.max(a[0],b[0])<0||Math.min(a[0],b[0])>spanX||Math.max(a[1],b[1])<0||Math.min(a[1],b[1])>spanZ)continue;
    const cuts=[0,1],near=new Set<TerrainFace>();
    for(let z=cellZ(Math.min(a[1],b[1]));z<=cellZ(Math.max(a[1],b[1]));z++)for(let x=cellX(Math.min(a[0],b[0]));x<=cellX(Math.max(a[0],b[0]));x++)
      for(const face of grid.get(z*cells+x)??[])near.add(face);
    for(let i=0;i<boundary.length;i++)appendCuts(cuts,a,b,boundary[i],boundary[(i+1)%boundary.length]);
    for(const face of near){
      for(let i=0;i<3;i++){const p=face.points[i],q=face.points[(i+1)%3];appendCuts(cuts,a,b,[p[0],p[2]],[q[0],q[2]]);}
      // A higher overlapping draw can hide only part of a contact segment.
      if(Math.abs(face.den)>1e-12){
        const [p,q,r]=face.points,uv=(s:PondShorePoint)=>[((s[0]-p[0])*(r[2]-p[2])-(s[1]-p[2])*(r[0]-p[0]))/face.den,
          ((q[0]-p[0])*(s[1]-p[2])-(q[2]-p[2])*(s[0]-p[0]))/face.den];
        const ua=uv(a),ub=uv(b),ha=p[1]+ua[0]*(q[1]-p[1])+ua[1]*(r[1]-p[1]),hb=p[1]+ub[0]*(q[1]-p[1])+ub[1]*(r[1]-p[1]);
        if(ha*hb<0){const t=-ha/(hb-ha),u=ua[0]+t*(ub[0]-ua[0]),v=ua[1]+t*(ub[1]-ua[1]);if(u>=-1e-9&&v>=-1e-9&&u+v<=1+1e-9)cuts.push(t);}
      }
    }
    cuts.sort((x,y)=>x-y);const unique=cuts.filter((t,i)=>i===0||t-cuts[i-1]>1e-9);
    for(let i=1;i<unique.length;i++){
      const lo=unique[i-1],hi=unique[i],start=point2(a[0]+lo*(b[0]-a[0]),a[1]+lo*(b[1]-a[1])),end=point2(a[0]+hi*(b[0]-a[0]),a[1]+hi*(b[1]-a[1]));
      const length=segmentLength(start,end);if(length<=1e-8)continue;
      const x=(start[0]+end[0])/2,z=(start[1]+end[1])/2,probe=Math.min(1e-5,length*.01),nx=-(end[1]-start[1])/length*probe,nz=(end[0]-start[0])/length*probe;
      if(wet(x+nx,z+nz)===wet(x-nx,z-nz))continue;
      const id=segmentKey(start,end);if(seen.has(id))continue;seen.add(id);result.push({a:start,b:end,terrain:candidate.terrain});
    }
  }
  const contacts=result.filter(segment=>segment.terrain),length=result.reduce((sum,segment)=>sum+segmentLength(segment.a,segment.b),0);
  return{wet,segments:result,contacts,metrics:Object.freeze({mode:'terrain-contact' as const,terrainTriangles:faces.length,segments:result.length,length,
    terrainContactSegments:contacts.length,terrainContactLength:contacts.reduce((sum,segment)=>sum+segmentLength(segment.a,segment.b),0),
    capEdgeSegments:result.length-contacts.length,coplanarTerrainTriangles:coplanar})};
}
const smooth=(low:number,high:number,value:number)=>{const t=Math.max(0,Math.min(1,(value-low)/(high-low)));return t*t*(3-2*t);};
const fade=(distance:number,width:number)=>1-smooth(0,width,distance);

/** Linear masks, byte/255. R: irregular outside damp0.15–0.65m; G: inside
 * shallow-colour0.4–1.2m; B: strongest outside groundcover-break patches only,
 *0.15–0.20m; A: max(R,G,B) at base resolution. No mask extends beyond its
 * stated signed-distance support. Mips are area averages, not extra supports.
 * Row0=minZ, column0=minX; pixel centres; flipY=false. Adapters must reject
 * coordinates outside field.bounds before texture lookup (no clamp streak).
 * Optional terrain is complete drawn Landscape XYZ (root-local metres),
 * cropped only outside field bounds. It moves the treatment to actual visible
 * water/terrain contacts and exposed cap edges without moving the cap. Highest
 * terrain hides lower overlapping draws; coplanar terrain is dry. B then uses
 * only actual terrain-contact portions, not the exposed geometric cap edge.
 * Caller owns the new arrays; complete128²→1² RGBA8 chain is87,380bytes. */
export function createEaldholtPondShoreField(outline:PondShoreOutline,terrainTrianglePositions?:readonly number[]|Float32Array|Float64Array):PondShoreField{
  validatePolygon(outline.boundary);if(!Number.isFinite(outline.height))fail('water height must be finite.');
  const source=polygonBounds(outline.boundary);
  if(!outline.bounds||source.min.some((n,i)=>n!==outline.bounds.min[i])||source.max.some((n,i)=>n!==outline.bounds.max[i]))fail('outline bounds do not match the polygon.');
  const margin=EALDHOLT_POND_SHORE.outsideMetres,bounds=Object.freeze({min:point2(source.min[0]-margin,source.min[1]-margin),max:point2(source.max[0]+margin,source.max[1]+margin)});
  const size=EALDHOLT_POND_SHORE.resolution,data=new Uint8Array(size*size*4),spanX=source.max[0]-source.min[0],spanZ=source.max[1]-source.min[1];
  // Work near the polygon origin so a distant root translation cannot flip a
  // texel's inside/outside classification through large-number cancellation.
  const localBoundary=outline.boundary.map(([x,z])=>point2(x-source.min[0],z-source.min[1]));
  const terrain=terrainTrianglePositions===undefined?null:terrainShore(localBoundary,outline.height,source.min,spanX,spanZ,terrainTrianglePositions);
  for(let row=0;row<size;row++)for(let column=0;column<size;column++){
    const x=-margin+(column+.5)/size*(spanX+2*margin),z=-margin+(row+.5)/size*(spanZ+2*margin);
    const nx=x/spanX-.5,nz=z/spanZ-.5,tau=2*Math.PI;
    const variation=Math.max(0,Math.min(1,.5+.3*Math.sin(tau*(1.35*nx+.65*nz))+.2*Math.cos(tau*(.45*nx-1.1*nz))));
    const insideWidth=.4+.8*(.5+.5*Math.sin(tau*(.7*nx-1.25*nz)+.8));
    const wet=terrain?terrain.wet(x,z):signedDistance(localBoundary,x,z)>=0;
    const distance=terrain?segmentDistance(terrain.segments,x,z)*(wet?1:-1):signedDistance(localBoundary,x,z),offset=(row*size+column)*4;
    const coverDistance=terrain?segmentDistance(terrain.contacts,x,z)*(wet?1:-1):distance;
    data[offset]=Math.round(255*((terrain?!wet:distance<=0)?fade(-distance,.15+.5*variation)*smooth(.15,.65,variation):0));
    data[offset+1]=Math.round(255*((terrain?wet:distance>=0)?fade(distance,insideWidth):0));
    data[offset+2]=Math.round(255*((terrain?!wet:distance<=0)?fade(-coverDistance,.15+.05*variation)*smooth(.6,.9,variation):0));
    data[offset+3]=Math.max(data[offset],data[offset+1],data[offset+2]);
  }
  const mipmaps:PondShoreMip[]=[Object.freeze({width:size,height:size,data})];let previous=data,width:number=size,byteLength=data.byteLength;
  while(width>1){
    const nextWidth=width/2,next=new Uint8Array(nextWidth*nextWidth*4);
    for(let z=0;z<nextWidth;z++)for(let x=0;x<nextWidth;x++)for(let channel=0;channel<4;channel++){
      const offset=(z*2*width+x*2)*4+channel;next[(z*nextWidth+x)*4+channel]=Math.round((previous[offset]+previous[offset+4]+previous[offset+width*4]+previous[offset+width*4+4])/4);
    }
    mipmaps.push(Object.freeze({width:nextWidth,height:nextWidth,data:next}));previous=next;width=nextWidth;byteLength+=next.byteLength;
  }
  if(byteLength>EALDHOLT_POND_SHORE.maximumByteLength)fail('shore field exceeds its fixed CPU budget.');
  const capLength=localBoundary.reduce((sum,a,i)=>sum+segmentLength(a,localBoundary[(i+1)%localBoundary.length]),0);
  const contact=terrain?.metrics??Object.freeze({mode:'cap-outline' as const,terrainTriangles:0,segments:localBoundary.length,length:capLength,
    terrainContactSegments:0,terrainContactLength:0,capEdgeSegments:localBoundary.length,coplanarTerrainTriangles:0});
  return Object.freeze({data,width:size,height:size,bounds,waterHeight:outline.height,mipmaps:Object.freeze(mipmaps),byteLength,
    baseByteLength:data.byteLength,channels:POND_SHORE_CHANNELS,normalization:255 as const,contact});
}

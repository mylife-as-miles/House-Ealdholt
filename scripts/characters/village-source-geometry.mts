// @ts-nocheck
/** Offline original-triangle measurements. No renderer, saved state or source
 * mutation. Every test is conservative: ambiguity retains an explicit hold. */
export interface SourceClearanceProxy {readonly radius:number;readonly height:number;readonly margin:number;readonly lift:number;readonly seamTolerance:number;readonly maximumSlope:number}
export const SOURCE_PROXY:SourceClearanceProxy=Object.freeze({radius:.85,height:2.1,margin:.005,lift:.02,seamTolerance:.00002,maximumSlope:Math.tan(35*Math.PI/180)});
/** Taller armed residents require a new source measurement, never a relabelled
 * certificate. Keep all horizontal, floor, water and support margins fixed. */
export function sourceClearanceProxy(height:number=SOURCE_PROXY.height){
 if(typeof height!=='number'||!Number.isFinite(height)||height<SOURCE_PROXY.height||height>3.5)throw Error('Fresh source clearance height must be between 2.1 and 3.5 metres.');
 return Object.freeze({...SOURCE_PROXY,height});
}
const cross=(a,b,c)=>(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
export function pointSegmentDistance(p,a,b){const x=b[0]-a[0],z=b[2]-a[2],l=x*x+z*z,t=l?Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[2]-a[2])*z)/l)):0;return Math.hypot(p[0]-a[0]-t*x,p[2]-a[2]-t*z);}
export function segmentDistance(a,b,c,d){if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return 0;return Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b));}
function inside(p,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[2]>p[2])!==(b[2]>p[2])&&p[0]<(b[0]-a[0])*(p[2]-a[2])/(b[2]-a[2])+a[0])yes=!yes;}return yes;}
function clipY(poly,y,above){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],keep=above?a[1]>=y:a[1]<=y,next=above?b[1]>=y:b[1]<=y;if(keep)out.push(a);if(keep!==next){const t=(y-a[1])/(b[1]-a[1]);out.push(a.map((n,k)=>n+t*(b[k]-n)));}}return out;}
export function cylinderIntersectsTriangle(a,b,triangle,radius,low,high){let poly=clipY(triangle,low,true);if(poly.length)poly=clipY(poly,high,false);return poly.length>0&&(inside(a,poly)||inside(b,poly)||poly.some((p,i)=>segmentDistance(a,b,p,poly[(i+1)%poly.length])<radius));}

/** Exact interval where an XZ segment crosses a nonvertical terrain triangle.
 * Height is affine inside that interval; checking its ends bounds the entire
 * segment, rather than relying on a sampling grid or an endpoint slope. */
export function terrainInterval(a,b,triangle){
 const [u,v,w]=triangle,area=cross(u,v,w);if(Math.abs(area)<1e-14)return null;
 let lo=0,hi=1;const sign=Math.sign(area);
 for(const [p,q]of [[u,v],[v,w],[w,u]]){const start=sign*cross(p,q,a),end=sign*cross(p,q,b),delta=end-start;if(Math.abs(delta)<1e-14){if(start< -1e-10)return null;}else{const t=-start/delta;if(delta>0)lo=Math.max(lo,t);else hi=Math.min(hi,t);}if(lo>hi+1e-10)return null;}
 const height=t=>{const x=a[0]+t*(b[0]-a[0]),z=a[2]+t*(b[2]-a[2]),p=[x,0,z],s=cross(p,v,w)/area,two=cross(u,p,w)/area;return s*u[1]+two*v[1]+(1-s-two)*w[1];};
 return{lo:Math.max(0,lo),hi:Math.min(1,hi),height};
}
export function projectTerrainProfile(a,b,intervals,seamTolerance=SOURCE_PROXY.seamTolerance){
 const distance=Math.hypot(b[0]-a[0],b[2]-a[2]);if(distance<1e-9)return{points:[[...a]],maximumUnsplitDeviationMetres:0,maximumEmittedDeviationMetres:0,maximumCoverageGapMetres:0};
 const useful=intervals.filter(i=>i&&i.hi>=i.lo-1e-10).sort((x,y)=>x.lo-y.lo||x.hi-y.hi);if(!useful.length)return null;
 let covered=0,gap=0;for(const row of useful){gap=Math.max(gap,Math.max(0,row.lo-covered)*distance);covered=Math.max(covered,row.hi);}gap=Math.max(gap,(1-covered)*distance);if(gap>seamTolerance+1e-9)return null;
 const times=[0,1,...useful.flatMap(i=>[i.lo,i.hi])].sort((x,y)=>x-y).filter((t,i,all)=>!i||t-all[i-1]>1e-10);
 const result=[];let maximumUnsplitDeviationMetres=0,maximumEmittedDeviationMetres=0;
 const at=t=>useful.filter(row=>t>=row.lo-1e-9&&t<=row.hi+1e-9);
 for(const t of times){const rows=at(t);if(!rows.length)return null;const heights=rows.map(row=>row.height(t));if(Math.max(...heights)-Math.min(...heights)>seamTolerance+1e-8)return null;const y=heights.reduce((n,v)=>n+v,0)/heights.length;
  maximumUnsplitDeviationMetres=Math.max(maximumUnsplitDeviationMetres,Math.abs(y-(a[1]+t*(b[1]-a[1]))));result.push([a[0]+t*(b[0]-a[0]),y,a[2]+t*(b[2]-a[2])]);}
 if(Math.abs(result[0][1]-a[1])>seamTolerance+1e-8||Math.abs(result.at(-1)[1]-b[1])>seamTolerance+1e-8)return null;
 result[0]=[...a];result[result.length-1]=[...b];
 for(let i=1;i<times.length;i++){const t=(times[i-1]+times[i])/2,rows=at(t),y=(result[i-1][1]+result[i][1])/2;if(!rows.length){if((times[i]-times[i-1])*distance>seamTolerance+1e-9)return null;continue;}for(const row of rows)maximumEmittedDeviationMetres=Math.max(maximumEmittedDeviationMetres,Math.abs(row.height(t)-y));}
 if(maximumEmittedDeviationMetres>seamTolerance+1e-8)return null;
 return{points:result,maximumUnsplitDeviationMetres,maximumEmittedDeviationMetres,maximumCoverageGapMetres:gap};
}

export function measureSourceTopology(ground,tolerance=SOURCE_PROXY.seamTolerance){
 const groups=[],cells=new Map(),ids=[],rawEdges=new Map();let maximumMeasuredEndpointDeltaMetres=0;
 for(let i=0;i<ground.length;i+=3){const p=ground.slice(i,i+3),cell=p.map(n=>Math.floor(n/tolerance));let found=-1;
  for(let a=-1;a<=1&&found<0;a++)for(let b=-1;b<=1&&found<0;b++)for(let c=-1;c<=1&&found<0;c++)for(const id of cells.get(`${cell[0]+a},${cell[1]+b},${cell[2]+c}`)??[]){if(groups[id].every(q=>Math.hypot(...p.map((n,k)=>n-q[k]))<=tolerance)){found=id;break;}}
  if(found<0){found=groups.length;groups.push([]);const key=cell.join(',');if(!cells.has(key))cells.set(key,[]);cells.get(key).push(found);}
  for(const q of groups[found])maximumMeasuredEndpointDeltaMetres=Math.max(maximumMeasuredEndpointDeltaMetres,Math.hypot(...p.map((n,k)=>n-q[k])));groups[found].push(p);ids.push(found);
 }
 // Equal undirected edge counts alone do not establish a surface boundary:
 // duplicate faces would pair all their own edges and erase a real edge. First
 // prove that the canonical faces are unique and each shared edge is traversed
 // once in each direction. Only that oriented manifold can support a footprint.
 const faces=new Set(),edges=new Map();for(let i=0;i<ids.length;i+=3){const face=ids.slice(i,i+3),key=[...face].sort((a,b)=>a-b).join(',');
  if(new Set(face).size!==3)throw Error('Degenerate canonical source terrain face cannot establish support.');
  const [p,q,r]=face.map(id=>groups[id][0]),u=q.map((v,k)=>v-p[k]),v=r.map((n,k)=>n-p[k]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  if(Math.hypot(...normal)<=1e-12)throw Error('Degenerate canonical source terrain face cannot establish support.');
  if(faces.has(key))throw Error('Duplicate canonical source terrain faces cannot erase true boundaries.');faces.add(key);
  for(let j=0;j<3;j++){const ia=i+j,ib=i+(j+1)%3,a=ids[ia],b=ids[ib],key=a<b?`${a},${b}`:`${b},${a}`,direction=a<b?1:-1,rawA=ground.slice(ia*3,ia*3+3).join(','),rawB=ground.slice(ib*3,ib*3+3).join(','),raw=rawA<rawB?rawA+'|'+rawB:rawB+'|'+rawA;rawEdges.set(raw,(rawEdges.get(raw)??0)+1);const e=edges.get(key);if(e){e.count++;e.directedIncidence+=direction;}else edges.set(key,{count:1,directedIncidence:direction,a:groups[a][0],b:groups[b][0]});}
 }
 if([...edges.values()].some(e=>e.count>2))throw Error('Original source terrain has non-manifold seam topology.');
 if([...edges.values()].some(e=>e.count===2&&e.directedIncidence!==0))throw Error('Inconsistent directed source terrain edge incidence cannot establish support.');
 const boundaries=[...edges.values()].filter(e=>e.count===1),originalUnmatchedEdgeCount=[...rawEdges.values()].filter(n=>n===1).length,pairedEdgeCount=originalUnmatchedEdgeCount-boundaries.length;
 if(pairedEdgeCount<0||pairedEdgeCount%2)throw Error('Source seam pairing does not close complete edge pairs.');
 return{boundaries,evidence:{sourceBufferMutation:false,sourceCoordinateRoundingMetres:0,seamPairClosureToleranceMetres:tolerance,maximumMeasuredEndpointDeltaMetres,pairedEdgeCount,originalUnmatchedEdgeCount,trueBoundaryEdgeCount:boundaries.length,canonicalFaceCount:faces.size,duplicateCanonicalFaces:0,degenerateCanonicalFaces:0,inconsistentDirectedEdgePairs:0,boundaryPolicy:'unique-canonical-faces-with-opposite-directed-shared-edges'}};
}

export function createSourceGeometryOracle({three,MeshBVH,ground,groundActors,solid,water,proofBox,topology,proxy=SOURCE_PROXY,overheadMaximumY=proofBox.max.y+30}){
 sourceClearanceProxy(proxy.height);
 const {BufferGeometry,BufferAttribute,Box3,Vector3,Ray,DoubleSide}=three,trees=[];
 function tree(data){const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float64Array(data),3));trees.push(geometry);return new MeshBVH(geometry,{targetLeafSize:12,indirect:true});}
 const gbvh=tree(ground),sbvh=tree(solid),ray=new Ray(new Vector3(),new Vector3(0,-1,0)),v=new Vector3();
 function floor(x,z){ray.origin.set(x,proofBox.max.y+20,z);const hit=gbvh.raycastFirst(ray,DoubleSide,0,100);return hit?{point:[x,hit.point.y,z],sourceActor:groundActors[hit.faceIndex]}:null;}
 function solidClear(a,b,exterior=false){const low=Math.min(a[1],b[1])+.005,high=exterior?overheadMaximumY:Math.max(a[1],b[1])+proxy.height,bb=new Box3(new Vector3(Math.min(a[0],b[0])-proxy.radius-proxy.margin,low,Math.min(a[2],b[2])-proxy.radius-proxy.margin),new Vector3(Math.max(a[0],b[0])+proxy.radius+proxy.margin,high,Math.max(a[2],b[2])+proxy.radius+proxy.margin));
  if(!exterior&&!proofBox.containsBox(bb))return false;let blocked=false;sbvh.shapecast({intersectsBounds:box=>box.intersectsBox(bb),intersectsTriangle:t=>{if(cylinderIntersectsTriangle(a,b,[t.a.toArray(),t.b.toArray(),t.c.toArray()],proxy.radius+proxy.margin,low,high)){blocked=true;return true;}return false;}});return!blocked;
 }
 function support(a,b){let edge=Infinity;for(const e of topology.boundaries)edge=Math.min(edge,segmentDistance(a,b,e.a,e.b));if(edge<proxy.radius+proxy.margin+proxy.seamTolerance)return null;
  for(const box of water)if(Math.min(a[0],b[0])-proxy.radius<box.max.x&&Math.max(a[0],b[0])+proxy.radius>box.min.x&&Math.min(a[2],b[2])-proxy.radius<box.max.z&&Math.max(a[2],b[2])+proxy.radius>box.min.z)return null;
  const bb=new Box3(new Vector3(Math.min(a[0],b[0])-proxy.radius,-Infinity,Math.min(a[2],b[2])-proxy.radius),new Vector3(Math.max(a[0],b[0])+proxy.radius,Infinity,Math.max(a[2],b[2])+proxy.radius));let slope=0;
  gbvh.shapecast({intersectsBounds:box=>box.intersectsBox(bb),intersectsTriangle:t=>{t.getNormal(v);const measured=Math.hypot(v.x,v.z)/Math.abs(v.y);slope=Math.max(slope,measured);return false;}});
  return Number.isFinite(slope)&&slope<=proxy.maximumSlope?{edge,slope}:null;
 }
 function profile(a,b){const intervals=[],bb=new Box3(new Vector3(Math.min(a[0],b[0])-1e-7,-Infinity,Math.min(a[2],b[2])-1e-7),new Vector3(Math.max(a[0],b[0])+1e-7,Infinity,Math.max(a[2],b[2])+1e-7));
  gbvh.shapecast({intersectsBounds:box=>box.intersectsBox(bb),intersectsTriangle:t=>{const interval=terrainInterval(a,b,[t.a.toArray(),t.b.toArray(),t.c.toArray()]);if(interval)intervals.push(interval);return false;}});return projectTerrainProfile(a,b,intervals,proxy.seamTolerance);
 }
 function stand(p){return!!support(p,p)&&solidClear(p,p)&&solidClear(p,p,true);}
 function leg(a,b){const projected=profile(a,b);if(!projected)return null;let edge=Infinity,slope=0;
  for(let i=1;i<projected.points.length;i++){const from=projected.points[i-1],to=projected.points[i],supported=support(from,to);if(!supported||!solidClear(from,to)||!solidClear(from,to,true))return null;edge=Math.min(edge,supported.edge);slope=Math.max(slope,supported.slope);}
  return{...projected,edge,slope};
 }
 return{floor,stand,leg,solidClear,support,profile,dispose(){for(const geometry of trees)geometry.dispose();}};
}

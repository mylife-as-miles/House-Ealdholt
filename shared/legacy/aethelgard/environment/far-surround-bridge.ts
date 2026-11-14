import type { EaldholtContinuityBounds } from './coastal-continuity';
import type { EaldholtFarMesh, EaldholtFarSurroundBuffers, EaldholtFarGeography } from './far-surround';
export interface EaldholtFarSurroundBridgeBuffers {
  readonly land:(EaldholtFarMesh&{readonly wetness:Float32Array})|null;
  readonly sea:(EaldholtFarMesh&{readonly across:Float32Array;readonly halfWidth:Float32Array})|null;
  readonly channel:(EaldholtFarMesh&{readonly across:Float32Array;readonly halfWidth:Float32Array})|null;
  readonly bounds:EaldholtContinuityBounds|null;
  readonly localBounds:EaldholtContinuityBounds;
  readonly geography:EaldholtFarGeography;
  readonly triangles:number;readonly bufferBytes:number;readonly drawCalls:0|1|2|3;
  readonly textureBytes:0;readonly localPlacementEligible:false;
}
type Point=[number,number,number];
type Vertex={p:Point;n:Point;c:Point;uv:[number,number];a:number;h:number;source:number};
type Mesh=EaldholtFarSurroundBuffers['land']|EaldholtFarSurroundBuffers['sea'];
const bits=new DataView(new ArrayBuffer(4));
function adjacent(value:number,up:boolean){if(value===0)return up?1.401298464324817e-45:-1.401298464324817e-45;bits.setFloat32(0,value);const n=bits.getUint32(0);bits.setUint32(0,n+((value>0)===up?1:-1));return bits.getFloat32(0);}
function boundedFloat(value:number,lo:number,hi:number){let result=Math.fround(Math.max(lo,Math.min(hi,value)));if(result<lo)result=adjacent(result,true);if(result>hi)result=adjacent(result,false);if(!Number.isFinite(result)||result<lo||result>hi)throw Error('Bridge bounds have no finite Float32 interior.');return result;}
function interpolate(a:Vertex,b:Vertex,t:number,axis:number,bound:number):Vertex{
  if(t<=0)return a;if(t>=1)return b;
  const mix=(x:number,y:number)=>x+(y-x)*t,p=a.p.map((x,k)=>mix(x,b.p[k]))as Point,n=a.n.map((x,k)=>mix(x,b.n[k]))as Point;
  p[axis]=bound;const length=Math.hypot(...n);if(!(length>0))throw Error('Invalid bridge interpolated normal.');
  return{p,n:n.map(x=>x/length)as Point,c:a.c.map((x,k)=>mix(x,b.c[k]))as Point,uv:a.uv.map((x,k)=>mix(x,b.uv[k]))as[number,number],a:mix(a.a,b.a),h:mix(a.h,b.h),source:-1};
}
function clipPlane(vertices:Vertex[],axis:number,bound:number,sign:1|-1){const out:Vertex[]=[];for(let i=0;i<vertices.length;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length],da=sign*(a.p[axis]-bound),db=sign*(b.p[axis]-bound);if(da>=0)out.push(a);if((da>=0)!==(db>=0))out.push(interpolate(a,b,da/(da-db),axis,bound));}return out;}
function clipMesh(mesh:Mesh,water:boolean,bounds:EaldholtContinuityBounds){const count=mesh.positions.length/3,scalar='wetness'in mesh?mesh.wetness:mesh.across,half='halfWidth'in mesh?mesh.halfWidth:null;
  if(!Number.isInteger(count)||count<3||count>65535||mesh.normals.length!==count*3||mesh.colours.length!==count*3||mesh.uv.length!==count*2||mesh.sourceVertex.length!==count||scalar.length!==count||half&&half.length!==count||!mesh.indices.length||mesh.indices.length%3)throw Error('Incomplete bridge source mesh.');
  const vertices:Vertex[]=[];for(let id=0;id<count;id++){const p=Array.from({length:3},(_,k)=>mesh.positions[id*3+k])as Point,n=Array.from({length:3},(_,k)=>mesh.normals[id*3+k])as Point,c=Array.from({length:3},(_,k)=>mesh.colours[id*3+k])as Point,uv=[mesh.uv[id*2],mesh.uv[id*2+1]]as[number,number],a=scalar[id],h=half?half[id]:-1,source=mesh.sourceVertex[id];if(![...p,...n,...c,...uv,a,h].every(Number.isFinite)||n[1]<=0||!Number.isInteger(source)||source< -1||!water&&(a<0||a>1))throw Error('Invalid bridge source attributes.');vertices.push({p,n,c,uv,a,h,source});}
  const kept:Vertex[]=[],indices:number[]=[],cache=new Map<string,number>();
  const add=(vertex:Vertex)=>{const p=vertex.p.map((n,k)=>boundedFloat(n,bounds.min[k],bounds.max[k]))as Point,key=p.join(':'),old=cache.get(key);if(old!==undefined){if(kept[old].source<0&&vertex.source>=0)kept[old]={...vertex,p};return old;}const id=kept.length;if(id>=65535)throw Error('Bridge exceeds Uint16 vertex capacity.');cache.set(key,id);kept.push({...vertex,p});return id;};
  for(let at=0;at<mesh.indices.length;at+=3){const ids=Array.from(mesh.indices.subarray(at,at+3));if(ids.some(id=>!Number.isInteger(id)||id<0||id>=count))throw Error('Invalid bridge source index.');let poly=ids.map(id=>vertices[id]);for(const axis of[0,2,1]){poly=clipPlane(poly,axis,bounds.min[axis],1);if(poly.length)poly=clipPlane(poly,axis,bounds.max[axis],-1);if(!poly.length)break;}
    for(let i=1;i<poly.length-1;i++){const tri=[poly[0],poly[i],poly[i+1]],p=tri.map(v=>v.p.map((n,k)=>boundedFloat(n,bounds.min[k],bounds.max[k]))as Point),up=(p[1][2]-p[0][2])*(p[2][0]-p[0][0])-(p[1][0]-p[0][0])*(p[2][2]-p[0][2]);if(Math.abs(up)<=1e-10)continue;const output=tri.map(add);indices.push(...(up>0?output:[output[0],output[2],output[1]]));}
  }
  if(!indices.length)return null;
  const base:EaldholtFarMesh={positions:Float32Array.from(kept.flatMap(v=>v.p)),normals:Float32Array.from(kept.flatMap(v=>v.n)),colours:Float32Array.from(kept.flatMap(v=>v.c)),uv:Float32Array.from(kept.flatMap(v=>v.uv)),indices:Uint16Array.from(indices),sourceVertex:Int32Array.from(kept.map(v=>v.source))};
  return water?{...base,across:Float32Array.from(kept.map(v=>v.a)),halfWidth:Float32Array.from(kept.map(v=>v.h))}:{...base,wetness:Float32Array.from(kept.map(v=>v.a))};
}
/** Fill only the finite local-envelope gaps using canonical far triangles.
 * Full far solids never enter the Native miniature. The remaining unbounded
 * scenery is a separate non-solid projection of the same geographic packet. */
export function clipEaldholtFarSurroundToLocalBounds(canonical:EaldholtFarSurroundBuffers,localBounds:EaldholtContinuityBounds):EaldholtFarSurroundBridgeBuffers{
  if(!localBounds||localBounds.min.length!==3||localBounds.max.length!==3||![...localBounds.min,...localBounds.max].every(Number.isFinite)||localBounds.min.some((v,k)=>v>=localBounds.max[k]))throw Error('Invalid bridge local bounds.');
  const land=clipMesh(canonical.land,false,localBounds)as EaldholtFarSurroundBridgeBuffers['land'],sea=clipMesh(canonical.sea,true,localBounds)as EaldholtFarSurroundBridgeBuffers['sea'],channel=clipMesh(canonical.channel,true,localBounds)as EaldholtFarSurroundBridgeBuffers['channel'];
  const meshes=[land,sea,channel].filter((m):m is NonNullable<typeof m>=>m!==null),triangles=meshes.reduce((n,m)=>n+m.indices.length/3,0),bufferBytes=meshes.reduce((n,m)=>n+[m.positions,m.normals,m.colours,m.uv,m.indices,...('wetness'in m?[m.wetness]:[m.across,m.halfWidth])].reduce((sum,a)=>sum+a.byteLength,0),0);
  if(triangles>512||bufferBytes>32768)throw Error(`Local far bridge exceeds budget: ${triangles} triangles/${bufferBytes} bytes.`);
  let bounds:EaldholtContinuityBounds|null=null;if(meshes.length){const min:Point=[Infinity,Infinity,Infinity],max:Point=[-Infinity,-Infinity,-Infinity];for(const m of meshes)for(let at=0;at<m.positions.length;at++){min[at%3]=Math.min(min[at%3],m.positions[at]);max[at%3]=Math.max(max[at%3],m.positions[at]);}bounds={min,max};}
  return{land,sea,channel,bounds,localBounds:{min:[...localBounds.min],max:[...localBounds.max]},geography:canonical.geography,triangles,bufferBytes,drawCalls:meshes.length as 0|1|2|3,textureBytes:0,localPlacementEligible:false};
}

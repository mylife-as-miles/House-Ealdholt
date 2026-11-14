// Source-geometry LOD for a world seen from a long way off. Every monument and its source placement
// is retained, and no triangles are dropped at random or replaced with props. Vertices weld inside an
// absolute cell, per connected surface, so a merged mesh spanning kilometres is reduced by the same
// metric error as a small one.
//
// Correctness guards (compare golden-temple/lod.js):
//   * Geometry keeps its source vertices when its material or attributes make welding meaningless:
//     custom shader programs, transparent or alpha-tested surfaces, textures, multiple materials,
//     instances placed at runtime, and per-vertex payloads such as falling-water timing or wind weights.
//   * A weld never crosses surfaces that do not touch in the source, so no face can bridge separate
//     blocks, ribs, tiles or isles.
//   * Corners on one weld share a position but keep their own normal and tint, so hard edges stay hard
//     and no cracks open along them.
//   * A surface small for the cell welds on a finer cell scaled to it. If it would still lose extent or
//     area, its source triangles are kept. Nothing is erased or flattened.
import * as THREE from 'crownfall-world-three';
import { createWorkYield } from './src/core/yield.js';

const isInstanceAttribute=a=>a.isInstancedBufferAttribute||(a.isInterleavedBufferAttribute&&a.data?.isInstancedInterleavedBuffer);
const triangleCount=g=>(g.index?g.index.count:g.attributes.position.count)/3;

/** Welding cell in source metres before instance scale. PROVENANCE.md gives the viewing distances. */
export const CELL_METRES={quest:2.4,desktop:1.2};
const SURFACE_ATTRIBUTES=new Set(['position','normal','uv','color']);
/** Rigid motion per vertex: a surface may weld only where all its vertices carry the same value. */
const RIGID_ATTRIBUTES=['aIsle','choirAnim','choirBob'];
/** Coordinates in metres along a surface: corners on one weld stay apart across a seam in the coordinate. */
const METRIC_ATTRIBUTES=['choirUv'];
const TEXTURE_SLOTS=['map','normalMap','roughnessMap','metalnessMap','aoMap','alphaMap','bumpMap','emissiveMap','displacementMap'];
const MIN_GEOMETRY_TRIANGLES=48,KEEP_SURFACE_TRIANGLES=12,CELLS_PER_SURFACE=2,MAX_EXTENT_LOSS=.25,MIN_AREA=.72,MAX_AREA=1.3,WORTHWHILE=.9,RETRIES=2;

/** Why this mesh must keep its source vertices, or null when it may weld. */
export function clusterRefusal(mesh){
  const material=mesh.material;
  if(Array.isArray(material))return'multiple materials';
  if(material.isShaderMaterial)return'custom shader program';
  if(material.transparent)return'transparent';
  if(material.alphaTest>0)return'alpha test';
  if(TEXTURE_SLOTS.some(slot=>material[slot]))return'texture coordinates';
  // A runtime LOD chain places these later, so their instance scale is unknown here.
  if(mesh.isInstancedMesh&&mesh.instanceMatrix.usage===THREE.DynamicDrawUsage)return'instances placed at runtime';
  for(const name of Object.keys(mesh.geometry.attributes)){
    const attribute=mesh.geometry.attributes[name];
    if(isInstanceAttribute(attribute))continue;
    if(attribute.isInterleavedBufferAttribute)return`interleaved ${name}`;
    if(!SURFACE_ATTRIBUTES.has(name)&&!RIGID_ATTRIBUTES.includes(name)&&!METRIC_ATTRIBUTES.includes(name))return`payload ${name}`;
  }
  return null;
}

/** A large instance needs finer source geometry for the same metric error. */
function worldScale(mesh){
  let scale=mesh.matrixWorld.getMaxScaleOnAxis();
  if(mesh.isInstancedMesh){
    const m=mesh.instanceMatrix.array;let largest=0;
    for(let i=0;i<mesh.count;i++){const o=i*16;largest=Math.max(largest,Math.hypot(m[o],m[o+1],m[o+2]),Math.hypot(m[o+4],m[o+5],m[o+6]),Math.hypot(m[o+8],m[o+9],m[o+10]));}
    scale*=largest||1;
  }
  return scale||1;
}

/** Connected surfaces: vertices join only through a shared triangle or an exactly equal position. */
function connectedSurfaces(P,n,corner,total){
  const parent=new Int32Array(n);for(let i=0;i<n;i++)parent[i]=i;
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a;};
  // Open-addressed table on exact coordinates: strings would dominate the load on millions of vertices.
  const size=1<<Math.ceil(Math.log2(n*2+2)),mask=size-1,table=new Int32Array(size).fill(-1),bits=new Int32Array(P.buffer,P.byteOffset,n*3);
  for(let i=0;i<n;i++){
    const x=bits[i*3],y=bits[i*3+1],z=bits[i*3+2];
    let h=(Math.imul(x,73856093)^Math.imul(y,19349663)^Math.imul(z,83492791))&mask;
    for(;;){const j=table[h];if(j<0){table[h]=i;break;}if(bits[j*3]===x&&bits[j*3+1]===y&&bits[j*3+2]===z){join(j,i);break;}h=(h+1)&mask;}
  }
  for(let t=0;t<total;t+=3){const a=corner(t);join(a,corner(t+1));join(a,corner(t+2));}
  const ids=new Int32Array(n).fill(-1);let count=0;
  for(let i=0;i<n;i++){const root=find(i);if(ids[root]<0)ids[root]=count++;ids[i]=ids[root];}
  return{ids,count};
}

const triangleArea=(P,a,b,c)=>{
  const ux=P[b*3]-P[a*3],uy=P[b*3+1]-P[a*3+1],uz=P[b*3+2]-P[a*3+2],vx=P[c*3]-P[a*3],vy=P[c*3+1]-P[a*3+1],vz=P[c*3+2]-P[a*3+2];
  const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;return Math.sqrt(x*x+y*y+z*z)/2;
};
/** Normal sector, about 20 degrees. */
const normalSector=(N,i)=>N?Math.round(N.getX(i)*3)+3+7*(Math.round(N.getY(i)*3)+3)+49*(Math.round(N.getZ(i)*3)+3):0;
/** Tint step: stone colour breaks and the hour coding on the Loom's glyphs stay put. */
const tintSector=(C,i)=>{if(!C)return 0;const q=v=>Math.min(39,Math.max(0,Math.round(v*16)));return q(C.getX(i))+40*(q(C.getY(i))+40*q(C.getZ(i)));};

/** Welds one surface on a grid. Returns [source corner x3, welded position x3] per face, or null if its shape would not survive. */
function weldSurface(surface,cell,fineness,g){
  const {P,N,corner,cellOf}=g,{vertices,triangles,min,max,sourceArea}=surface;
  const size=[max[0]-min[0],max[1]-min[1],max[2]-min[2]],centre=[(min[0]+max[0])/2,(min[1]+max[1])/2,(min[2]+max[2])/2];
  const step=size.map(s=>Math.max(Math.min(cell,s/(CELLS_PER_SURFACE*fineness)),1e-5)),across=size.map((s,k)=>Math.floor(s/step[k])+1);
  // The welded position is a source vertex, the one farthest out in its cell, so the outline does not erode.
  const cells=new Map();
  for(const i of vertices){
    const key=Math.floor((P[i*3]-min[0])/step[0])+across[0]*(Math.floor((P[i*3+1]-min[1])/step[1])+across[1]*Math.floor((P[i*3+2]-min[2])/step[2]));
    let c=cells.get(key);if(!c){c={best:-1,rep:i};cells.set(key,c);}
    const dx=P[i*3]-centre[0],dy=P[i*3+1]-centre[1],dz=P[i*3+2]-centre[2],d=dx*dx+dy*dy+dz*dz;
    if(d>c.best){c.best=d;c.rep=i;}
    cellOf[i]=key;
  }
  const faces=[],seen=new Set();let area=0;
  for(const t of triangles){
    const ia=corner(t);let ib=corner(t+1),ic=corner(t+2),a=cells.get(cellOf[ia]).rep,b=cells.get(cellOf[ib]).rep,c=cells.get(cellOf[ic]).rep;
    if(a===b||b===c||a===c)continue;
    const s=triangleArea(P,a,b,c);if(s<1e-9)continue;
    const lo=Math.min(a,b,c),hi=Math.max(a,b,c),key=`${lo},${a+b+c-lo-hi},${hi},${normalSector(N,ia)}`;
    if(seen.has(key))continue;seen.add(key);area+=s;
    if(N){
      // Moving a corner can turn a small face over; it must keep facing the way its source corners do.
      const ux=P[b*3]-P[a*3],uy=P[b*3+1]-P[a*3+1],uz=P[b*3+2]-P[a*3+2],vx=P[c*3]-P[a*3],vy=P[c*3+1]-P[a*3+1],vz=P[c*3+2]-P[a*3+2];
      const facing=(uy*vz-uz*vy)*(N.getX(ia)+N.getX(ib)+N.getX(ic))+(uz*vx-ux*vz)*(N.getY(ia)+N.getY(ib)+N.getY(ic))+(ux*vy-uy*vx)*(N.getZ(ia)+N.getZ(ib)+N.getZ(ic));
      if(facing<0){let swap=ib;ib=ic;ic=swap;swap=b;b=c;c=swap;}
    }
    faces.push(ia,ib,ic,a,b,c);
  }
  if(!faces.length||faces.length/6>=triangles.length*WORTHWHILE)return null;
  const ratio=area/Math.max(sourceArea,1e-12);
  if(ratio<MIN_AREA||ratio>MAX_AREA)return null;
  // Measured on the faces that survive: a thin part hanging off a larger surface must not vanish.
  const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
  for(let f=3;f<faces.length;f+=6)for(let j=0;j<3;j++)for(let k=0;k<3;k++){const v=P[faces[f+j]*3+k];if(v<low[k])low[k]=v;if(v>high[k])high[k]=v;}
  for(let k=0;k<3;k++)if(size[k]-(high[k]-low[k])>Math.max(size[k]*MAX_EXTENT_LOSS,cell))return null;
  return faces;
}

/** Rewrites `geometry` in place: source LOD managers keep this object and its live instance buffers. */
async function simplifyGeometry(geometry,cell,report,breathe){
  const position=geometry.getAttribute('position'),n=position.count,index=geometry.index,total=index?index.count:n;
  const plain=position.array instanceof Float32Array&&position.itemSize===3&&!position.isInterleavedBufferAttribute;
  const P=plain?position.array:Float32Array.from({length:n*3},(_,i)=>position.getComponent(i/3|0,i%3));
  const corner=index?(i=>index.getX(i)):(i=>i),N=geometry.getAttribute('normal'),C=geometry.getAttribute('color');
  const rigid=RIGID_ATTRIBUTES.map(name=>geometry.getAttribute(name)).filter(Boolean),metric=METRIC_ATTRIBUTES.map(name=>geometry.getAttribute(name)).filter(Boolean);
  const {ids,count}=connectedSurfaces(P,n,corner,total);
  const surfaces=Array.from({length:count},()=>({vertices:[],triangles:[],min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity],sourceArea:0,rigid:true,motion:null}));
  for(let i=0;i<n;i++){
    const s=surfaces[ids[i]];s.vertices.push(i);
    for(let k=0;k<3;k++){const v=P[i*3+k];if(v<s.min[k])s.min[k]=v;if(v>s.max[k])s.max[k]=v;}
    if(rigid.length){const motion=rigid.map(a=>a.array.subarray(i*a.itemSize,(i+1)*a.itemSize).join()).join('|');if(s.motion===null)s.motion=motion;else if(s.motion!==motion)s.rigid=false;}
  }
  for(let t=0;t<total;t+=3){const a=corner(t),s=surfaces[ids[a]];s.triangles.push(t);s.sourceArea+=triangleArea(P,a,corner(t+1),corner(t+2));}
  const g={P,N,corner,cellOf:new Float64Array(n)},fromPosition=[],fromAttributes=[],indices=[],local=new Int32Array(n);
  let welded=0,kept=0;
  for(const s of surfaces){
    await breathe();
    let faces=null;
    if(s.rigid&&s.triangles.length>KEEP_SURFACE_TRIANGLES)for(let attempt=0,fineness=1;attempt<=RETRIES&&!faces;attempt++,fineness*=2)faces=weldSurface(s,cell/fineness,fineness,g);
    if(faces){
      welded++;
      const corners=new Map();
      for(let f=0;f<faces.length;f+=6)for(let k=0;k<3;k++){
        const source=faces[f+k],rep=faces[f+3+k],sector=rep*343*64000+normalSector(N,source)*64000+tintSector(C,source);
        const key=metric.length?`${sector}|${metric.map(a=>`${Math.round(a.getX(source)/cell)},${Math.round(a.getY(source)/cell)}`).join()}`:sector;
        let id=corners.get(key);if(id===undefined){id=fromPosition.length;corners.set(key,id);fromPosition.push(rep);fromAttributes.push(source);}
        indices.push(id);
      }
    }else{
      kept++;
      for(const i of s.vertices){local[i]=fromPosition.length;fromPosition.push(i);fromAttributes.push(i);}
      for(const t of s.triangles)indices.push(local[corner(t)],local[corner(t+1)],local[corner(t+2)]);
    }
  }
  report.surfacesWelded+=welded;report.surfacesKept+=kept;
  if(!welded||indices.length>=total*WORTHWHILE)return false;
  for(const name of Object.keys(geometry.attributes)){
    const a=geometry.attributes[name];if(isInstanceAttribute(a))continue;
    const sources=name==='position'?fromPosition:fromAttributes,data=new a.array.constructor(sources.length*a.itemSize);
    for(let i=0;i<sources.length;i++)for(let k=0;k<a.itemSize;k++)data[i*a.itemSize+k]=a.getComponent(sources[i],k);
    geometry.setAttribute(name,new THREE.BufferAttribute(data,a.itemSize,a.normalized));
  }
  geometry.setIndex(indices);geometry.clearGroups();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  geometry.userData={...geometry.userData,crownfallCluster:{cellMetres:cell,sourceTriangles:total/3,triangles:indices.length/3}};
  return true;
}

export async function applySourceLod(root,profile){
  const cell=CELL_METRES[profile==='quest'?'quest':'desktop'],breathe=createWorkYield();
  root.updateMatrixWorld(true);
  const nodes=[],users=new Map();
  root.traverse(o=>{if(o.isMesh&&!o.isBatchedMesh&&o.geometry?.attributes.position){nodes.push(o);if(!users.has(o.geometry))users.set(o.geometry,[]);users.get(o.geometry).push(o);}});
  const instances=o=>o.isInstancedMesh?o.count:o.geometry.isInstancedBufferGeometry?o.geometry.instanceCount:1;
  const report={profile,sourceTriangles:0,lodTriangles:0,geometriesSimplified:0,maxClusterCellMetres:0,surfacesWelded:0,surfacesKept:0,refused:{},method:'connected-surface vertex welding on an absolute cell; original monument layout retained'};
  for(const o of nodes)report.sourceTriangles+=triangleCount(o.geometry)*instances(o);
  for(const [geometry,meshes] of users){
    await breathe();
    const reason=meshes.map(clusterRefusal).find(Boolean);
    if(reason){const r=report.refused[reason]??={geometries:0,triangles:0};r.geometries++;r.triangles+=triangleCount(geometry);continue;}
    if(triangleCount(geometry)<=MIN_GEOMETRY_TRIANGLES)continue;
    if(await simplifyGeometry(geometry,cell/Math.max(...meshes.map(worldScale)),report,breathe)){report.geometriesSimplified++;report.maxClusterCellMetres=cell;}
  }
  for(const o of nodes)report.lodTriangles+=triangleCount(o.geometry)*instances(o);
  return report;
}

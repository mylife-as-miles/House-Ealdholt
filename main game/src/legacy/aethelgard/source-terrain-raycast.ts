/** CPU candidate acceleration. Original triangles, exact query coordinates and
 * Three's own ray math stay authoritative; cells never provide heights. */
import {BufferGeometry,Uint32BufferAttribute,Vector3,type Box3,type Matrix4,type Mesh} from 'three';
export interface SourceTerrainRow {readonly actor:Mesh;readonly frame:Matrix4;readonly bounds:Box3}
export interface SourceTerrainRaycastIndex {
 /** `full` is the existing private exact source proxy, with borrowed attributes,
  * original bounding volumes/frame and the existing DoubleSide material. */
 meshFor(row:SourceTerrainRow,x:number,z:number,full:Mesh):Mesh|null;
 readonly stats:{readonly indexedRows:number;readonly fallbackRows:number;readonly triangleReferences:number;readonly cells:number;readonly cachedMeshes:number;readonly cachedIndexBytes:number};
 dispose():void;
}
const CELL=2,MAX_CELLS=65536,MAX_REFERENCES=4*1024*1024,MAX_TRIANGLES=2*1024*1024,MAX_CELLS_PER_TRIANGLE=64,MAX_SPILLS=2048;
const MAX_QUERY_TRIANGLES=32768,MAX_CACHE_BYTES=8*1024*1024,MAX_CACHED_MESHES=512;
type Cell={count:number;ids:Uint32Array|null;cursor:number};
type Plan={cells:Map<string,Cell>;spill:Uint32Array;fallback:boolean};
type Cache={mesh:Mesh;bytes:number;key:string;plan:Plan};
/** Two bounded passes produce compact original-ordinal candidate lists. The
 * existing async caller drives/cancels this generator. Pathological source
 * rows retain the exact full-raycast fallback instead of losing support. */
export function* prepareSourceTerrainRaycastIndex(rows:readonly SourceTerrainRow[]):Generator<void,SourceTerrainRaycastIndex,unknown>{
 const plans=new Map<SourceTerrainRow,Plan>(),cache=new Map<Plan,Map<string,Cache>>(),lru=new Set<Cache>(),v=new Vector3();
 const stats={indexedRows:0,fallbackRows:0,triangleReferences:0,cells:0,cachedMeshes:0,cachedIndexBytes:0};let disposed=false,complete=false,visits=0;
 const drop=(entry:Cache)=>{cache.get(entry.plan)?.delete(entry.key);lru.delete(entry);entry.mesh.geometry.dispose();stats.cachedMeshes--;stats.cachedIndexBytes-=entry.bytes;};
 const dispose=()=>{if(disposed)return;disposed=true;for(const entry of [...lru])drop(entry);cache.clear();plans.clear();};
 try{for(const row of rows){
  const geometry=row.actor.geometry,p=geometry.getAttribute('position'),index=geometry.index,count=index?.count??p?.count??0,triangles=Math.floor(count/3);
  const cells=new Map<string,Cell>(),spill:number[]=[];let references=0,fallback=!p||triangles>MAX_TRIANGLES;
  // Bounds only select candidates. No source vertex or final ray is rounded.
  function bounds(i:number):readonly[number,number,number,number]|null {
   let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,scale=1;
   for(let k=0;k<3;k++){v.fromBufferAttribute(p,index?index.getX(i+k):i+k).applyMatrix4(row.frame);if(!Number.isFinite(v.x)||!Number.isFinite(v.z))return null;minX=Math.min(minX,v.x);maxX=Math.max(maxX,v.x);minZ=Math.min(minZ,v.z);maxZ=Math.max(maxZ,v.z);scale=Math.max(scale,Math.abs(v.x),Math.abs(v.z));}
   const padding=1e-5+64*Number.EPSILON*scale,x0=Math.floor((minX-padding)/CELL),x1=Math.floor((maxX+padding)/CELL),z0=Math.floor((minZ-padding)/CELL),z1=Math.floor((maxZ+padding)/CELL);
   return[x0,x1,z0,z1].every(Number.isSafeInteger)?[x0,x1,z0,z1]:null;
  }
  if(!fallback)for(let i=0;i+2<count;i+=3){
   if(++visits%2048===0)yield;const b=bounds(i);if(!b){fallback=true;break;}
   const span=(b[1]-b[0]+1)*(b[3]-b[2]+1);if(span>MAX_CELLS_PER_TRIANGLE){spill.push(i/3);if(spill.length>MAX_SPILLS||stats.triangleReferences+references+spill.length>MAX_REFERENCES){fallback=true;break;}continue;}
   if(stats.triangleReferences+references+spill.length+span>MAX_REFERENCES){fallback=true;break;}
   for(let x=b[0];x<=b[1]&&!fallback;x++)for(let z=b[2];z<=b[3];z++){const key=x+':'+z,old=cells.get(key);if(old)old.count++;else{if(stats.cells+cells.size>=MAX_CELLS){fallback=true;break;}cells.set(key,{count:1,ids:null,cursor:0});}references++;}
  }
  if(fallback){plans.set(row,{cells:new Map(),spill:new Uint32Array(),fallback:true});stats.fallbackRows++;yield;continue;}
  for(const cell of cells.values()){cell.ids=new Uint32Array(cell.count);if(++visits%2048===0)yield;}
  // Retain original triangle order, including duplicate/coplanar equal-depth
  // faces, rather than sorting by vertex number, normal or calculated height.
  for(let i=0;i+2<count;i+=3){if(++visits%2048===0)yield;const b=bounds(i)!;if((b[1]-b[0]+1)*(b[3]-b[2]+1)>MAX_CELLS_PER_TRIANGLE)continue;
   for(let x=b[0];x<=b[1];x++)for(let z=b[2];z<=b[3];z++){const cell=cells.get(x+':'+z)!;cell.ids![cell.cursor++]=i/3;}
  }
  plans.set(row,{cells,spill:new Uint32Array(spill),fallback:false});stats.indexedRows++;stats.triangleReferences+=references+spill.length;stats.cells+=cells.size;yield;
 }
 const owner:SourceTerrainRaycastIndex={stats,dispose,meshFor(row,x,z,full){
  if(disposed||!Number.isFinite(x)||!Number.isFinite(z))return null;const plan=plans.get(row);if(!plan||plan.fallback)return full;
  const key=Math.floor(x/CELL)+':'+Math.floor(z/CELL),local=plan.cells.get(key)?.ids,spill=plan.spill,total=(local?.length??0)+spill.length;
  if(!total)return null;if(total>MAX_QUERY_TRIANGLES)return full;
  let byCell=cache.get(plan);if(!byCell){byCell=new Map();cache.set(plan,byCell);}const old=byCell.get(key);if(old){lru.delete(old);lru.add(old);return old.mesh;}
  const source=full.geometry,index=source.index,indices=new Uint32Array(total*3);let a=0,b=0,out=0;
  while(a<(local?.length??0)||b<spill.length){const ordinal=b>=spill.length||a<(local?.length??0)&&local![a]<spill[b]?local![a++]:spill[b++],first=ordinal*3;for(let k=0;k<3;k++)indices[out++]=index?index.getX(first+k):first+k;}
  const geometry=new BufferGeometry();for(const[name,attribute]of Object.entries(source.attributes))geometry.setAttribute(name,attribute);
  geometry.setIndex(new Uint32BufferAttribute(indices,1));geometry.setDrawRange(0,indices.length);geometry.boundingBox=source.boundingBox?.clone()??null;geometry.boundingSphere=source.boundingSphere?.clone()??null;
  const Constructor=full.constructor as new(geometry:BufferGeometry,material:Mesh['material'])=>Mesh,mesh=new Constructor(geometry,full.material);mesh.matrixAutoUpdate=false;mesh.matrixWorld.copy(full.matrixWorld);
  const entry={mesh,bytes:indices.byteLength,key,plan};byCell.set(key,entry);lru.add(entry);stats.cachedMeshes++;stats.cachedIndexBytes+=entry.bytes;
  while(stats.cachedMeshes>MAX_CACHED_MESHES||stats.cachedIndexBytes>MAX_CACHE_BYTES)drop(lru.values().next().value!);return mesh;
 }};complete=true;return owner;
 }finally{if(!complete)dispose();}
}

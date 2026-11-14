// Deterministic source-geometry LOD. Preserve the source node hierarchy/site
// plan; weld only vertices occupying the same local cell and normal sector.
import * as THREE from 'crownfall-world-three';

function triangleCount(mesh){return (mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3*(mesh.isInstancedMesh?mesh.count:1);}
function thinInstances(mesh,stride){
 if(!mesh.isInstancedMesh||stride<=1||mesh.count<20)return;
 // A source corridor bay is architecture, not interchangeable dressing.
 if(/corridorBay/i.test(mesh.name))return;
 if(Object.values(mesh.geometry.attributes).some(a=>a.isInterleavedBufferAttribute))return;
 const count=mesh.count, kept=Math.ceil(count/stride);
 const instanceFields=Object.values(mesh.geometry.attributes).filter(a=>a.isInstancedBufferAttribute);
 if([mesh.instanceMatrix,mesh.instanceColor,...instanceFields].filter(Boolean).some(a=>a.isInterleavedBufferAttribute||(a.meshPerAttribute??1)!==1||a.count<count))return;
 // Some source prototypes share their geometry. Compact only private instance data.
 if(instanceFields.length)mesh.geometry=mesh.geometry.clone();
 const attributes=[...new Set([mesh.instanceMatrix,mesh.instanceColor,...Object.values(mesh.geometry.attributes).filter(a=>a.isInstancedBufferAttribute)].filter(Boolean))];
 for(const attribute of attributes){
  // a prototype can carry an instance field with its own meshPerAttribute.
  if((attribute.meshPerAttribute??1)!==1||attribute.count<count)continue;
  const size=attribute.itemSize,array=attribute.array;
  for(let dest=0;dest<kept;dest++){const source=Math.min(count-1,dest*stride);for(let j=0;j<size;j++)array[dest*size+j]=array[source*size+j];}
  attribute.needsUpdate=true;
 }
 mesh.count=kept;
}
function cannotCluster(mesh,geometry){
 const material=mesh.material;
 if(Array.isArray(material)||material.transparent||material.alphaTest>0||material.isShaderMaterial)return true;
 const attributes=Object.entries(geometry.attributes);
 if(attributes.some(([,a])=>a.isInterleavedBufferAttribute))return true;
 // These are renderer payloads, not ordinary geometry samples: changing aOrg,
 // aInst/aCard/aLoc etc across a face can send its corners to unrelated places.
 if(attributes.some(([name])=>!['position','normal','uv','color','aAO','aTint'].includes(name)))return true;
 const hook=material.userData?.patch?.vertexWorld??'';
 if(/\bwPos4(?:\.[xyzw]+)?\s*(?:[+*\/-]?=)|\btransformed\s*(?:[+*\/-]?=)/.test(hook))return true;
 return false;
}
function localTolerance(mesh,cell){
 let scale=mesh.matrixWorld.getMaxScaleOnAxis();
 if(mesh.isInstancedMesh){
  let instanceScale=1;const a=mesh.instanceMatrix;
  for(let i=0;i<mesh.count;i++){
   const o=i*16,m=a.array;
   instanceScale=Math.max(instanceScale,Math.hypot(m[o],m[o+1],m[o+2]),Math.hypot(m[o+4],m[o+5],m[o+6]),Math.hypot(m[o+8],m[o+9],m[o+10]));
  }
  scale*=instanceScale;
 }
 return cell/Math.max(1,scale);
}
// Long source geometries yield every this many loop steps so the driver can give the tab a turn.
const STEP=8192;
// Exact lookup keyed by a row of numbers. A hash match is always confirmed by comparing every
// column, so two different keys can never merge. Same grouping as joined string keys, without the strings.
function rowTable(capacity,columns){
 const size=2**Math.ceil(Math.log2(Math.max(16,capacity*2))),mask=size-1,slots=new Int32Array(size).fill(-1),rows=new Float64Array(capacity*columns);
 let used=0;
 return {
  row:new Float64Array(columns),
  // Returns the first index stored under this.row, storing `value` if the row is new.
  lookup(value,values){
   const row=this.row;let hash=0;
   for(let c=0;c<columns;c++){const v=row[c];hash=Math.imul(hash^(v|0),0x01000193);hash=Math.imul(hash^((v/4294967296)|0),0x01000193);}
   hash^=hash>>>15;
   for(let slot=hash&mask;;slot=(slot+1)&mask){
    const entry=slots[slot];
    if(entry<0){slots[slot]=used;rows.set(row,used*columns);values[used]=value;used++;return -1;}
    let same=true;const at=entry*columns;for(let c=0;c<columns&&same;c++)same=rows[at+c]===row[c];
    if(same)return values[entry];
   }
  },
 };
}
function* sourceTopology(original){
 const position=original.attributes.position,normal=original.attributes.normal,uv=original.attributes.uv;
 const count=position.count,logical=new Int32Array(count),parent=new Int32Array(count),seams=new Uint8Array(count);
 const q=x=>Math.round(x*1e6);
 const find=index=>{while(parent[index]!==index){parent[index]=parent[parent[index]];index=parent[index];}return index;};
 const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a;};
 const table=rowTable(count,3),firsts=new Int32Array(count),row=table.row;
 const nx=normal?new Float64Array(count):null,ny=normal?new Float64Array(count):null,nz=normal?new Float64Array(count):null,ux=uv?new Float64Array(count):null,uy=uv?new Float64Array(count):null;
 for(let i=0;i<count;i++){
  parent[i]=i;
  row[0]=q(position.getX(i));row[1]=q(position.getY(i));row[2]=q(position.getZ(i));
  if(normal){nx[i]=q(normal.getX(i));ny[i]=q(normal.getY(i));nz[i]=q(normal.getZ(i));}
  if(uv){ux[i]=q(uv.getX(i));uy[i]=q(uv.getY(i));}
  const previous=table.lookup(i,firsts);
  if(previous>=0){logical[i]=previous;if((normal&&(nx[previous]!==nx[i]||ny[previous]!==ny[i]||nz[previous]!==nz[i]))||(uv&&(ux[previous]!==ux[i]||uy[previous]!==uy[i])))seams[previous]=1;}
  else logical[i]=i;
  if(!(i%STEP))yield;
 }
 const sourceIndex=original.index,total=sourceIndex?.count??count;
 const vertex=i=>sourceIndex?sourceIndex.getX(i):i;
 // Exactly touching source vertices define topology; merely occupying one LOD
 // cell does not connect distinct leaves, tiles, ornaments or other components.
 for(let i=0;i+2<total;i+=3){join(logical[vertex(i)],logical[vertex(i+1)]);join(logical[vertex(i)],logical[vertex(i+2)]);if(!(i%STEP))yield;}
 const components=new Int32Array(count);
 for(let i=0;i<count;i++){components[i]=find(logical[i]);if(!(i%STEP))yield;}
 // Trial cell widths never change source topology. Retain only immutable typed arrays for this build.
 return {logical,components,seams};
}
function* clustered(original,cell,topology){
 const position=original.attributes.position,normal=original.attributes.normal,uv=original.attributes.uv;
 if(!position||Object.values(original.attributes).some(a=>a.isInterleavedBufferAttribute))return null;
 const entries=Object.entries(original.attributes),count=position.count;
 const {logical,components,seams}=topology;
 const q=x=>Math.round(x*1e6);
 const sourceIndex=original.index,total=sourceIndex?.count??count;
 const vertex=i=>sourceIndex?sourceIndex.getX(i):i;
 const tint=original.attributes.aTint,ao=original.attributes.aAO;
 const mappings=new Int32Array(count),table=rowTable(count,10),assigned=new Int32Array(count),sourceList=new Int32Array(count),row=table.row;
 let sourceCount=0;
 for(let i=0;i<count;i++){
  const point=logical[i],seam=seams[point];
  // Preserve seams exactly, and scalar material/occlusion discontinuities as well.
  row[0]=seam;
  if(seam){row[1]=point;row[2]=normal?q(normal.getX(i)):0;row[3]=normal?q(normal.getY(i)):0;row[4]=normal?q(normal.getZ(i)):0;row[5]=uv?q(uv.getX(i)):0;row[6]=uv?q(uv.getY(i)):0;row[7]=0;}
  else{row[1]=components[i];row[2]=Math.round(position.getX(i)/cell);row[3]=Math.round(position.getY(i)/cell);row[4]=Math.round(position.getZ(i)/cell);row[5]=normal?Math.round(normal.getX(i)*3):0;row[6]=normal?Math.round(normal.getY(i)*3):0;row[7]=normal?Math.round(normal.getZ(i)*3):0;}
  row[8]=tint?q(tint.getX(i)):0;row[9]=ao?q(ao.getX(i)):0;
  const known=table.lookup(sourceCount,assigned);
  if(known>=0)mappings[i]=known;
  else{sourceList[sourceCount]=i;mappings[i]=sourceCount++;}
  if(!(i%STEP))yield;
 }
 const triangles=rowTable(Math.floor(total/3)+1,3),firstSeen=new Int32Array(Math.floor(total/3)+1),triangleRow=triangles.row,indices=[];
 for(let i=0;i+2<total;i+=3){const a=mappings[vertex(i)],b=mappings[vertex(i+1)],c=mappings[vertex(i+2)];if(a!==b&&b!==c&&c!==a){
  const lo=Math.min(a,b,c),hi=Math.max(a,b,c);triangleRow[0]=lo;triangleRow[1]=a+b+c-lo-hi;triangleRow[2]=hi;
  if(triangles.lookup(i,firstSeen)<0)indices.push(a,b,c);
 }if(!(i%STEP))yield;}
 // A connected surface that completely collapses is retained, never erased.
 if(!indices.length||indices.length>=total*.97)return null;
 const geometry=new THREE.BufferGeometry();
 for(const [key,attribute]of entries){
  const size=attribute.itemSize,array=new attribute.array.constructor(sourceCount*size);
  for(let dest=0;dest<sourceCount;dest++){const index=sourceList[dest];for(let j=0;j<size;j++)array[dest*size+j]=attribute.array[index*size+j];if(!(dest%STEP))yield;}
  geometry.setAttribute(key,new THREE.BufferAttribute(array,size,attribute.normalized));
 }
 geometry.setIndex(indices);geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}

function* lodSteps(root,profile){
 const quest=profile==='quest';
 const caps=quest?{'Temple terrain':90000,'Temple pond':105000,'Temple hall':90000,'Temple pagoda':85000,'Temple bridge':40000,'Temple buildings':110000,'Temple props':35000,'Temple vegetation':105000,'props.anchors':25000}:{'Temple terrain':220000,'Temple pond':280000,'Temple hall':300000,'Temple pagoda':260000,'Temple bridge':150000,'Temple buildings':330000,'Temple props':100000,'Temple vegetation':300000,'props.anchors':90000};
 root.updateMatrixWorld(true);
 const report=[],topologyCache=new WeakMap();
 for(const group of root.children){
  const meshes=[];group.traverse(object=>{if(object.isMesh&&object.geometry?.attributes.position)meshes.push(object);});
  const before=meshes.reduce((n,mesh)=>n+triangleCount(mesh),0);
  if(quest)for(const mesh of meshes){
    const natural=group.name==='Temple terrain'||group.name==='Temple vegetation';
    thinInstances(mesh,mesh.count>1000?(natural?18:8):mesh.count>100?(natural?9:5):mesh.count>30?2:1);
    yield;
  }
  else for(const mesh of meshes){
    const natural=group.name==='Temple terrain'||group.name==='Temple vegetation';
    if(natural)thinInstances(mesh,mesh.count>1000?7:mesh.count>100?3:1);
    else if(/cap|tile|noshi|disc|stud|rosette|giboshi|makito|rafter|lip/i.test(mesh.name))thinInstances(mesh,mesh.count>100?2:1);
    yield;
  }
  const cap=caps[group.name]??Infinity;
  const originals=new Map(meshes.map(mesh=>[mesh,mesh.geometry]));
  const ratio=Math.max(1,meshes.reduce((n,mesh)=>n+triangleCount(mesh),0)/cap);
  let cell=quest?Math.min(1.05,.12*Math.pow(ratio,.65)):.06*Math.pow(ratio,.65);
  for(let pass=0;pass<4 && meshes.reduce((n,mesh)=>n+triangleCount(mesh),0)>cap;pass++){
   const cache=new Map();
   for(const mesh of meshes){
    const original=originals.get(mesh);
    if(cannotCluster(mesh,original))continue;
    if((original.index?.count??original.attributes.position.count)<120)continue;
    const tolerance=localTolerance(mesh,cell),cacheKey=`${original.uuid}:${tolerance}`;
    let reduced=cache.get(cacheKey);
    if(reduced===undefined){
     let topology=topologyCache.get(original);
     if(!topology){topology=yield* sourceTopology(original);topologyCache.set(original,topology);}
     reduced=yield* clustered(original,tolerance,topology);cache.set(cacheKey,reduced);
    }
    if(reduced){if(mesh.geometry!==original&&mesh.geometry!==reduced)mesh.geometry.dispose();mesh.geometry=reduced;}
    yield;
   }
   cell*=1.7;
  }
  report.push({name:group.name,beforeTriangles:before,triangles:meshes.reduce((n,mesh)=>n+triangleCount(mesh),0),draws:meshes.reduce((n,mesh)=>n+(mesh.geometry.groups.length||1),0)});
 }
 return report;
}
/** Runs the whole reduction in one call. */
export function applySourceLod(root,profile){
 const steps=lodSteps(root,profile);let step=steps.next();
 while(!step.done)step=steps.next();
 return step.value;
}
/** The same reduction, handing the tab back at least every budgetMs. Its result is identical to applySourceLod. */
export async function applySourceLodSliced(root,profile,pause,budgetMs=100){
 const steps=lodSteps(root,profile);let step=steps.next();
 while(!step.done){
  const started=performance.now();
  while(!step.done&&performance.now()-started<budgetMs)step=steps.next();
  if(!step.done)await pause();
 }
 return step.value;
}

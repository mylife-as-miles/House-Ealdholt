// Offline PRIVATE display candidate. Original GLB/BIN bytes, village surfaces,
// architecture and pond remain intact; append owned replacements and explicitly
// qualified exterior-only surface regrouping without changing source UV buffers.
import { readFile, writeFile, stat, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { mat4, mat4Multiply, type Mat4 } from '../shared/legacy/environment/kernel/math';
import { noise3 } from '../shared/legacy/environment/kernel/noise';

type Json=Record<string,any>;
type Rect={minX:number;maxX:number;minZ:number;maxZ:number};
type Point=[number,number,number];
interface Group { mesh:Json;node:number;world:Mat4;positions:Float32Array;normals:Float32Array;oldWorld:Float64Array;newWorld:Float64Array;protected:Uint8Array;primitives:Json[];positionAccessor:number;normalAccessor:number;keys:string[] }
interface Triangle { group:Group;a:number;b:number;c:number }
export interface ExteriorOptions { expectedSha256:string;protectionMargin?:number;blendMetres?:number;coastalRelief?:number;eastRelief?:number;transitionMode?:'source-height'|'protected-edge';exteriorSurface?:'preserve'|'earth' }
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const foliage=(name:string)=>/Grass_Clumps|BlackAlder|flower_|SM_vmcob|SM_vgzte/i.test(name);
const landscape=(name:string)=>/^LandscapeComponent_\d+$/.test(name);
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const inside=(r:Rect,x:number,z:number)=>x>=r.minX&&x<=r.maxX&&z>=r.minZ&&z<=r.maxZ;
const key=(p:ArrayLike<number>,i:number)=>`${Math.round(p[i]*1e4)},${Math.round(p[i+1]*1e4)},${Math.round(p[i+2]*1e4)}`;
function local(n:Json):Mat4 {
  if(n.matrix)return Float64Array.from(n.matrix);
  const[x,y,z,w]=n.rotation??[0,0,0,1],[a,b,c]=n.scale??[1,1,1],[tx,ty,tz]=n.translation??[0,0,0];
  return new Float64Array([(1-2*y*y-2*z*z)*a,(2*x*y+2*z*w)*a,(2*x*z-2*y*w)*a,0,(2*x*y-2*z*w)*b,(1-2*x*x-2*z*z)*b,(2*y*z+2*x*w)*b,0,(2*x*z+2*y*w)*c,(2*y*z-2*x*w)*c,(1-2*x*x-2*y*y)*c,0,tx,ty,tz,1]);
}
function transform(m:Mat4,x:number,y:number,z:number):Point{return[m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]];}
function verticalFrame(m:Mat4){if(Math.abs(m[1])+Math.abs(m[2])+Math.abs(m[4])+Math.abs(m[6])+Math.abs(m[8])+Math.abs(m[9])>1e-5||!Number.isFinite(m[5])||Math.abs(m[5])<1e-8)throw Error('Expected axis-aligned source terrain/instance frame; do not shear protected geometry.');}
function extrema(data:ArrayLike<number>,width:number){const min=Array(width).fill(Infinity),max=Array(width).fill(-Infinity);for(let i=0;i<data.length;i++) {const c=i%width;min[c]=Math.min(min[c],data[i]);max[c]=Math.max(max[c],data[i]);}return{min,max};}

export async function adaptElderbloomExterior(inputPath:string,outputPath:string,options:ExteriorOptions){
  const input=await realpath(inputPath),output=resolve(outputPath),parent=await realpath(dirname(output));
  if(input===output||parent===repository||parent.startsWith(repository+'/'))throw Error('Use a separate PRIVATE output outside the repository.');
  try{await stat(output);throw Error('Output exists; do not replace an earlier candidate.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if((await stat(input)).size>256*1024*1024)throw Error('Use an optimized private derivative below256MiB.');
  const source=await readFile(input),sourceHash=sha(source);
  if(!/^[a-f0-9]{64}$/.test(options.expectedSha256)||sourceHash!==options.expectedSha256)throw Error('Input SHA-256 differs from the explicitly qualified derivative.');
  if(source.length<28||source.readUInt32LE(0)!==0x46546c67||source.readUInt32LE(4)!==2||source.readUInt32LE(8)!==source.length||source.readUInt32LE(16)!==0x4e4f534a)throw Error('Expected GLB2 JSON+BIN.');
  const at=20+source.readUInt32LE(12);
  if(at+8>source.length||source.readUInt32LE(at+4)!==0x004e4942||at+8+source.readUInt32LE(at)!==source.length)throw Error('Invalid binary chunk.');
  const j:Json=JSON.parse(source.subarray(20,at).toString('utf8')),original=structuredClone(j),binary=source.subarray(at+8);
  if(j.buffers.length!==1||j.buffers[0].uri)throw Error('Expected one embedded source buffer.');
  const margin=options.protectionMargin??2,blend=options.blendMetres??7,coastal=options.coastalRelief??2.5,east=options.eastRelief??5.5;
  const transition=options.transitionMode??'source-height',exteriorSurface=options.exteriorSurface??'preserve';
  if(!['source-height','protected-edge'].includes(transition)||!['preserve','earth'].includes(exteriorSurface))throw Error('Invalid exterior transition/surface policy.');
  if(![margin,blend,coastal,east].every(Number.isFinite)||margin<1||margin>10||blend<2||blend>20||coastal<0||coastal>8||east<coastal||east>12)throw Error('Invalid bounded exterior parameters.');
  function accessor(index:number,width:number):Float32Array|Uint32Array{
    const a=j.accessors[index],v=j.bufferViews[a?.bufferView],component=a?.componentType;
    if(!a||!v||v.buffer!==0||a.sparse||!Number.isSafeInteger(a.count)||a.count<1||(width>1&&component!==5126)||a.type!==(width===1?'SCALAR':`VEC${width}`))throw Error('Expected dense bounded float geometry/unsigned indices.');
    const size=component===5121?1:component===5123?2:component===5125||component===5126?4:0,stride=v.byteStride??width*size,start=(v.byteOffset??0)+(a.byteOffset??0);
    if(!size||stride<size*width||start+stride*(a.count-1)+size*width>(v.byteOffset??0)+v.byteLength||(v.byteOffset??0)+v.byteLength>binary.length)throw Error('Accessor exceeds source buffer.');
    const data=width===1?new Uint32Array(a.count):new Float32Array(a.count*width);
    for(let i=0;i<a.count;i++)for(let c=0;c<width;c++){const p=start+i*stride+c*size;data[i*width+c]=component===5126?binary.readFloatLE(p):size===4?binary.readUInt32LE(p):size===2?binary.readUInt16LE(p):binary[p];}return data;
  }
  const world=new Map<number,Mat4>(),parents=new Map<number,number>();
  function walk(index:number,parent:Mat4){const n=j.nodes[index],m=mat4Multiply(mat4(),parent,local(n));world.set(index,m);for(const child of n.children??[]){parents.set(child,index);walk(child,m);}}
  for(const node of j.scenes[j.scene??0].nodes??[])walk(node,mat4());
  const boundsCache=new Map<number,{min:number[];max:number[]}>();
  function meshBounds(index:number){let result=boundsCache.get(index);if(result)return result;const all:number[]=[];for(const p of j.meshes[index].primitives){const e=extrema(accessor(p.attributes.POSITION,3),3);all.push(...e.min,...e.max);}result=extrema(all,3);boundsCache.set(index,result);return result;}
  function instances(n:Json){const attrs=n.extensions?.EXT_mesh_gpu_instancing?.attributes;if(!attrs)return null;const count=j.accessors[Object.values(attrs)[0]as number].count;return{attrs,count,translation:attrs.TRANSLATION===undefined?new Float32Array(count*3):accessor(attrs.TRANSLATION,3)as Float32Array,rotation:attrs.ROTATION===undefined?null:accessor(attrs.ROTATION,4),scale:attrs.SCALE===undefined?null:accessor(attrs.SCALE,3)};}
  const protect:Rect={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity},pondNodes:number[]=[],architectureNodes:number[]=[];
  for(const [index,m]of world){
    const n=j.nodes[index],mesh=j.meshes[n.mesh];if(!mesh||landscape(mesh.name??'')||foliage(mesh.name??''))continue;
    architectureNodes.push(index);if(mesh.primitives.some((p:Json)=>/Pond_Water/.test(j.materials[p.material]?.name??'')))pondNodes.push(index);
    const box=meshBounds(n.mesh),actors=instances(n),count=actors?.count??1;
    for(let actor=0;actor<count;actor++){
      const frame=actors?mat4Multiply(mat4(),m,local({translation:Array.from(actors.translation.subarray(actor*3,actor*3+3)),rotation:actors.rotation?Array.from(actors.rotation.subarray(actor*4,actor*4+4)):undefined,scale:actors.scale?Array.from(actors.scale.subarray(actor*3,actor*3+3)):undefined})):m;
      for(const x of [box.min[0],box.max[0]])for(const y of [box.min[1],box.max[1]])for(const z of [box.min[2],box.max[2]]){const p=transform(frame,x,y,z);protect.minX=Math.min(protect.minX,p[0]);protect.maxX=Math.max(protect.maxX,p[0]);protect.minZ=Math.min(protect.minZ,p[2]);protect.maxZ=Math.max(protect.maxZ,p[2]);}
    }
  }
  if(!architectureNodes.length||!pondNodes.length||!Object.values(protect).every(Number.isFinite))throw Error('A qualified village/prop/pond protection footprint is required.');
  protect.minX-=margin;protect.maxX+=margin;protect.minZ-=margin;protect.maxZ+=margin;
  const groups:Group[]=[],triangles:Triangle[]=[],meshUses=new Map<number,number>();
  for(const [index]of world){const n=j.nodes[index];if(n.mesh!==undefined)meshUses.set(n.mesh,(meshUses.get(n.mesh)??0)+1);}
  for(const [index,m]of world){
    const n=j.nodes[index],mesh=j.meshes[n.mesh];if(!mesh||!landscape(mesh.name??''))continue;verticalFrame(m);
    if(meshUses.get(n.mesh)!==1||n.extensions?.EXT_mesh_gpu_instancing)throw Error('Expected uniquely placed source landscape meshes.');
    const cache=new Map<string,Group>();
    for(const p of mesh.primitives){
      if((p.mode??4)!==4||p.attributes.NORMAL===undefined||p.attributes.TANGENT!==undefined||!j.materials[p.material]?.extras?.crownfallTerrainRepair)throw Error('Expected generated review terrain with normals and no stale tangents.');
      const id=`${p.attributes.POSITION}:${p.attributes.NORMAL}`;let g=cache.get(id);
      if(!g){const positions=accessor(p.attributes.POSITION,3)as Float32Array,normals=accessor(p.attributes.NORMAL,3)as Float32Array;if(positions.length!==normals.length)throw Error('Landscape attribute length mismatch.');
        const oldWorld=new Float64Array(positions.length);for(let v=0;v<positions.length;v+=3)oldWorld.set(transform(m,positions[v],positions[v+1],positions[v+2]),v);
        g={mesh,node:index,world:m,positions,normals,oldWorld,newWorld:oldWorld.slice(),protected:new Uint8Array(positions.length/3),primitives:[],positionAccessor:p.attributes.POSITION,normalAccessor:p.attributes.NORMAL,keys:Array.from({length:positions.length/3},(_,v)=>key(oldWorld,v*3))};cache.set(id,g);groups.push(g);
      }
      g.primitives.push(p);const ix=p.indices===undefined?Uint32Array.from({length:g.positions.length/3},(_,v)=>v):accessor(p.indices,1);
      if(ix.length%3)throw Error('Incomplete source terrain triangles.');
      for(let t=0;t<ix.length;t+=3){const a=ix[t],b=ix[t+1],c=ix[t+2];if(Math.max(a,b,c)*3+2>=g.positions.length)throw Error('Terrain index outside source positions.');triangles.push({group:g,a,b,c});
        const w=g.oldWorld,x0=Math.min(w[a*3],w[b*3],w[c*3]),x1=Math.max(w[a*3],w[b*3],w[c*3]),z0=Math.min(w[a*3+2],w[b*3+2],w[c*3+2]),z1=Math.max(w[a*3+2],w[b*3+2],w[c*3+2]);
        if(x1>=protect.minX&&x0<=protect.maxX&&z1>=protect.minZ&&z0<=protect.maxZ)g.protected[a]=g.protected[b]=g.protected[c]=1;
      }
    }
  }
  if(!groups.length)throw Error('No qualified source landscape found.');
  const protectedKeys=new Set<string>();for(const g of groups)for(let v=0;v<g.protected.length;v++)if(g.protected[v])protectedKeys.add(g.keys[v]);
  for(const g of groups)for(let v=0;v<g.protected.length;v++)if(protectedKeys.has(g.keys[v]))g.protected[v]=1;
  const protectedHashBefore=createHash('sha256'),xzHashBefore=createHash('sha256'),tuple=Buffer.alloc(24),pair=Buffer.alloc(8),protectedHeights:number[]=[];
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,protectedVertices=0;
  for(const g of groups)for(let i=0;i<g.positions.length;i+=3){
    minX=Math.min(minX,g.oldWorld[i]);maxX=Math.max(maxX,g.oldWorld[i]);minZ=Math.min(minZ,g.oldWorld[i+2]);maxZ=Math.max(maxZ,g.oldWorld[i+2]);
    pair.writeFloatLE(g.positions[i],0);pair.writeFloatLE(g.positions[i+2],4);xzHashBefore.update(pair);
    if(g.protected[i/3]){protectedVertices++;protectedHeights.push(g.oldWorld[i+1]);for(let c=0;c<3;c++){tuple.writeFloatLE(g.positions[i+c],c*4);tuple.writeFloatLE(g.normals[i+c],12+c*4);}protectedHashBefore.update(tuple);}
  }
  protectedHeights.sort((a,b)=>a-b);if(!protectedHeights.length)throw Error('Protection footprint has no real source ground.');
  const baseHeight=protectedHeights[Math.floor((protectedHeights.length-1)*.1)];
  const grid=new Map<string,Triangle[]>(),cellSize=8;
  for(const t of triangles){const p=t.group.oldWorld,ix=[t.a*3,t.b*3,t.c*3],x0=Math.floor(Math.min(...ix.map(i=>p[i]))/cellSize),x1=Math.floor(Math.max(...ix.map(i=>p[i]))/cellSize),z0=Math.floor(Math.min(...ix.map(i=>p[i+2]))/cellSize),z1=Math.floor(Math.max(...ix.map(i=>p[i+2]))/cellSize);
    if((x1-x0+1)*(z1-z0+1)>256)throw Error('Unexpected unbounded source terrain triangle.');
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const id=`${x},${z}`,list=grid.get(id);if(list)list.push(t);else grid.set(id,[t]);}
  }
  function support(x:number,z:number,after:boolean){let highest=-Infinity;for(const t of grid.get(`${Math.floor(x/cellSize)},${Math.floor(z/cellSize)}`)??[]){const p=after?t.group.newWorld:t.group.oldWorld,a=t.a*3,b=t.b*3,c=t.c*3,dx1=p[b]-p[a],dz1=p[b+2]-p[a+2],dx2=p[c]-p[a],dz2=p[c+2]-p[a+2],det=dx1*dz2-dx2*dz1;if(Math.abs(det)<1e-10)continue;const u=((x-p[a])*dz2-(z-p[a+2])*dx2)/det,v=(dx1*(z-p[a+2])-dz1*(x-p[a]))/det;if(u< -1e-6||v< -1e-6||u+v>1+1e-6)continue;highest=Math.max(highest,p[a+1]+u*(p[b+1]-p[a+1])+v*(p[c+1]-p[a+1]));}return Number.isFinite(highest)?highest:null;}
  let alteredVertices=0,maxLowering=0,sourceHighOutside=0,remainingHighOutside=0;
  for(const g of groups)for(let i=0;i<g.positions.length;i+=3){
    const x=g.oldWorld[i],oldY=g.oldWorld[i+1],z=g.oldWorld[i+2];if(!inside(protect,x,z)&&oldY>18)sourceHighOutside++;
    if(g.protected[i/3])continue;
    const distance=Math.hypot(Math.max(protect.minX-x,0,x-protect.maxX),Math.max(protect.minZ-z,0,z-protect.maxZ));
    const eastWeight=smooth(minX+(maxX-minX)*.5,maxX,x),northWeight=1-smooth(minZ,maxZ,z);
    const relief=coastal+(east-coastal)*eastWeight*(.75+.25*northWeight),variation=.7+.3*noise3(x*.035,0,z*.035,6101);
    const target=baseHeight+relief*variation;
    const boundary=transition==='protected-edge'?support(Math.max(protect.minX,Math.min(protect.maxX,x)),Math.max(protect.minZ,Math.min(protect.maxZ,z)),false):oldY;
    if(boundary===null)throw Error('Protected-edge transition has no actual source support.');
    const next=Math.min(oldY,mix(boundary,target,smooth(0,blend,distance)));
    if(Math.abs(next-oldY)>1e-7){g.positions[i+1]+=(next-oldY)/g.world[5];g.newWorld[i+1]=transform(g.world,g.positions[i],g.positions[i+1],g.positions[i+2])[1];alteredVertices++;maxLowering=Math.max(maxLowering,oldY-g.newWorld[i+1]);}
  }
  // Global coordinate keys join adjacent source component borders. Keep every
  // protected normal bit-exact; recompute only the exterior normals in world space.
  const normalSums=new Map<string,Point>();
  for(const t of triangles){const p=t.group.newWorld,a=t.a*3,b=t.b*3,c=t.c*3,ax=p[b]-p[a],ay=p[b+1]-p[a+1],az=p[b+2]-p[a+2],bx=p[c]-p[a],by=p[c+1]-p[a+1],bz=p[c+2]-p[a+2];let x=ay*bz-az*by,y=az*bx-ax*bz,z=ax*by-ay*bx;if(y<0){x=-x;y=-y;z=-z;}
    for(const v of [t.a,t.b,t.c]){const id=t.group.keys[v],sum=normalSums.get(id);if(sum){sum[0]+=x;sum[1]+=y;sum[2]+=z;}else normalSums.set(id,[x,y,z]);}
  }
  let alteredNormals=0;
  for(const g of groups)for(let v=0;v<g.protected.length;v++){
    const i=v*3;if(!inside(protect,g.newWorld[i],g.newWorld[i+2])&&g.newWorld[i+1]>18)remainingHighOutside++;
    if(g.protected[v])continue;const n=normalSums.get(g.keys[v]);if(!n)continue;
    const m=g.world,x=m[0]*n[0]+m[1]*n[1]+m[2]*n[2],y=m[4]*n[0]+m[5]*n[1]+m[6]*n[2],z=m[8]*n[0]+m[9]*n[1]+m[10]*n[2],length=Math.hypot(x,y,z);
    if(!length)throw Error('Degenerate exterior normal.');const values=[x/length,y/length,z/length];if(values.some((q,c)=>Math.abs(q-g.normals[i+c])>1e-7))alteredNormals++;for(let c=0;c<3;c++)g.normals[i+c]=values[c];
  }
  const chunks:Buffer[]=[binary];let length=binary.length;
  function append(data:Float32Array,sourceAccessor:number|undefined){const padding=(4-length%4)%4;if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}const bytes=Buffer.from(data.buffer,data.byteOffset,data.byteLength),view=j.bufferViews.length;j.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length,target:34962});chunks.push(bytes);length+=bytes.length;
    const e=extrema(data,3),index=j.accessors.length,a=sourceAccessor===undefined?{}:structuredClone(j.accessors[sourceAccessor]);delete a.sparse;delete a.byteOffset;j.accessors.push({...a,bufferView:view,componentType:5126,count:data.length/3,type:'VEC3',min:e.min,max:e.max});return index;}
  const appendedIndices=new Map<number,Uint32Array>();
  function appendIndices(values:number[]){if(!values.length)throw Error('Do not emit empty terrain primitives.');const padding=(4-length%4)%4;if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}const data=Uint32Array.from(values),bytes=Buffer.from(data.buffer),view=j.bufferViews.length;j.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length,target:34963});chunks.push(bytes);length+=bytes.length;const index=j.accessors.length;j.accessors.push({bufferView:view,componentType:5125,count:data.length,type:'SCALAR'});appendedIndices.set(index,data);return index;}
  const removedPrimitives=new Set<Json>(),surfaceReports:Json[]=[];let exteriorEarthFaces=0;
  function triangleIndices(p:Json,g:Group){return p.indices===undefined?Uint32Array.from({length:g.positions.length/3},(_,v)=>v):accessor(p.indices,1)as Uint32Array;}
  for(const g of groups){const positions=append(g.positions,g.positionAccessor),normals=append(g.normals,g.normalAccessor);for(const p of g.primitives){p.attributes.POSITION=positions;p.attributes.NORMAL=normals;}}
  if(exteriorSurface==='earth')for(const g of groups){
    const rocks=g.primitives.filter(p=>j.materials[p.material].extras?.crownfallGroundDetail?.kind==='rock');if(!rocks.length)continue;
    const earthPrimitive=g.primitives.find(p=>j.materials[p.material].extras?.crownfallGroundDetail?.kind==='earth');
    if(!earthPrimitive)throw Error('Exterior earth remap lacks a compatible complete earth primitive.');
    const material=j.materials[earthPrimitive.material],detail=material.extras.crownfallGroundDetail,channel=detail.uvChannel,tile=detail.tileMetres;
    if(![2,3].includes(channel)||!Number.isFinite(tile)||tile<=0||material.normalTexture?.texCoord!==channel||material.pbrMetallicRoughness?.metallicRoughnessTexture?.texCoord!==channel)throw Error('Exterior earth detail UV/material frame is unverified.');
    const uvAccessor=earthPrimitive.attributes[`TEXCOORD_${channel}`],uv=accessor(uvAccessor,2);if(uv.length!==g.positions.length/3*2)throw Error('Earth UV does not cover the complete shared position buffer.');
    let maximumUvError=0;
    for(let v=0;v<g.positions.length/3;v++){maximumUvError=Math.max(maximumUvError,Math.abs(uv[v*2]-Math.fround(g.oldWorld[v*3]/tile)),Math.abs(uv[v*2+1]-Math.fround(-g.oldWorld[v*3+2]/tile)));}
    if(maximumUvError>1e-5)throw Error('Existing earth UV is not compatible world-XZ projection.');
    const earthIndices=Array.from(triangleIndices(earthPrimitive,g));let remapped=0,keptProtected=0;
    for(const p of rocks){
      const rock=j.materials[p.material],sameBase=JSON.stringify(rock.pbrMetallicRoughness?.baseColorTexture)===JSON.stringify(material.pbrMetallicRoughness?.baseColorTexture)&&JSON.stringify(rock.pbrMetallicRoughness?.baseColorFactor??[1,1,1,1])===JSON.stringify(material.pbrMetallicRoughness?.baseColorFactor??[1,1,1,1]);
      const attrs=(a:Json)=>Object.fromEntries(Object.entries(a).filter(([name])=>name!==`TEXCOORD_${channel}`));
      if(!sameBase||JSON.stringify(attrs(p.attributes))!==JSON.stringify(attrs(earthPrimitive.attributes)))throw Error('Rock/earth source atlas and shared vertex frame differ; do not remap blindly.');
      const old=triangleIndices(p,g),kept:number[]=[];let changed=0;
      for(let i=0;i<old.length;i+=3){const a=old[i],b=old[i+1],c=old[i+2],q=g.newWorld,ax=q[b*3]-q[a*3],ay=q[b*3+1]-q[a*3+1],az=q[b*3+2]-q[a*3+2],bx=q[c*3]-q[a*3],by=q[c*3+1]-q[a*3+1],bz=q[c*3+2]-q[a*3+2],nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx;
        const protectedFace=g.protected[a]||g.protected[b]||g.protected[c];
        if(!protectedFace&&Math.abs(ny)>1e-10&&Math.hypot(nx,nz)/Math.abs(ny)<=.6){earthIndices.push(a,b,c);changed++;}
        else{kept.push(a,b,c);if(protectedFace)keptProtected++;}
      }
      if(kept.length+changed*3!==old.length)throw Error('Exterior remap lost source triangles.');
      if(changed){if(kept.length)p.indices=appendIndices(kept);else removedPrimitives.add(p);remapped+=changed;}
    }
    if(remapped)earthPrimitive.indices=appendIndices(earthIndices);
    exteriorEarthFaces+=remapped;surfaceReports.push({node:g.node,meshName:g.mesh.name,existingEarthMaterial:earthPrimitive.material,existingEarthUvAccessor:uvAccessor,uvChannel:channel,tileMetres:tile,maximumUvError,remappedExteriorTriangles:remapped,protectedRockTrianglesRetained:keptProtected,newUvBuffers:0,newDrawCalls:0});
  }
  if(removedPrimitives.size)for(const mesh of j.meshes)mesh.primitives=mesh.primitives.filter((p:Json)=>!removedPrimitives.has(p));
  let exteriorRoots=0,movedRoots=0,protectedRoots=0,missingSupportRoots=0,maxRootOffsetError=0;const instanceReports:Json[]=[];
  for(const [index,m]of world){
    const n=j.nodes[index],mesh=j.meshes[n.mesh];if(!mesh||!foliage(mesh.name??''))continue;
    const actors=instances(n);let moved=0,kept=0;
    if(actors){
      verticalFrame(m);const data=actors.translation.slice();
      for(let i=0;i<actors.count;i++){
        const p=transform(m,data[i*3],data[i*3+1],data[i*3+2]);if(inside(protect,p[0],p[2])){protectedRoots++;kept++;continue;}exteriorRoots++;
        const before=support(p[0],p[2],false),after=support(p[0],p[2],true);if(before===null||after===null){missingSupportRoots++;continue;}const delta=after-before;if(Math.abs(delta)<=1e-7)continue;
        data[i*3+1]+=delta/m[5];const q=transform(m,data[i*3],data[i*3+1],data[i*3+2]);maxRootOffsetError=Math.max(maxRootOffsetError,Math.abs((q[1]-after)-(p[1]-before)));moved++;movedRoots++;
      }
      if(moved){
        const box=meshBounds(n.mesh),points:number[]=[];
        for(let actor=0;actor<actors.count;actor++){
          const frame=mat4Multiply(mat4(),m,local({translation:Array.from(data.subarray(actor*3,actor*3+3)),rotation:actors.rotation?Array.from(actors.rotation.subarray(actor*4,actor*4+4)):undefined,scale:actors.scale?Array.from(actors.scale.subarray(actor*3,actor*3+3)):undefined}));
          for(const x of [box.min[0],box.max[0]])for(const y of [box.min[1],box.max[1]])for(const z of [box.min[2],box.max[2]])points.push(...transform(frame,x,y,z));
        }
        actors.attrs.TRANSLATION=append(data,actors.attrs.TRANSLATION);n.extras??={};n.extras.crownfallExteriorAdaptation={verticalRootOffsetsPreserved:true,alteredInstances:moved,keptProtectedInstances:kept,cellXZUnchanged:true,translationBounds:extrema(data,3),worldBounds:extrema(points,3)};
      }
    }else{
      const p=transform(m,0,0,0);if(inside(protect,p[0],p[2])){protectedRoots++;kept++;}else{exteriorRoots++;const before=support(p[0],p[2],false),after=support(p[0],p[2],true);if(before===null||after===null)missingSupportRoots++;else if(Math.abs(after-before)>1e-7){const parentFrame=parents.has(index)?world.get(parents.get(index)!)!:mat4();verticalFrame(parentFrame);const delta=(after-before)/parentFrame[5];if(n.matrix)n.matrix[13]+=delta;else{n.translation??=[0,0,0];n.translation[1]+=delta;}moved=1;movedRoots++;n.extras??={};n.extras.crownfallExteriorAdaptation={verticalRootOffsetsPreserved:true,alteredInstances:1,cellXZUnchanged:true};}}
    }
    if(moved)instanceReports.push({node:index,name:n.name,meshName:mesh.name,altered:moved,protectedUnchanged:kept,instancingAccessorBoundsRefreshed:!!actors});
  }
  if(maxRootOffsetError>1e-4)throw Error('Foliage no longer preserves its original ground offset.');
  const protectedHashAfter=createHash('sha256'),xzHashAfter=createHash('sha256');let afterMinY=Infinity,afterMaxY=-Infinity,protectedMaxY=-Infinity,protectedEdgeMaxY=-Infinity,protectedAbove18=0,protectedEdgeAbove18=0,unprotectedMaxY=-Infinity,farExteriorMaxY=-Infinity;
  let protectedEdgeVertices=0;
  const seamHeights=new Map<string,{min:number;max:number}>();
  for(const g of groups)for(let i=0;i<g.positions.length;i+=3){
    pair.writeFloatLE(g.positions[i],0);pair.writeFloatLE(g.positions[i+2],4);xzHashAfter.update(pair);
    afterMinY=Math.min(afterMinY,g.newWorld[i+1]);afterMaxY=Math.max(afterMaxY,g.newWorld[i+1]);
    const id=g.keys[i/3],existing=seamHeights.get(id);if(existing){existing.min=Math.min(existing.min,g.newWorld[i+1]);existing.max=Math.max(existing.max,g.newWorld[i+1]);}else seamHeights.set(id,{min:g.newWorld[i+1],max:g.newWorld[i+1]});
    if(g.protected[i/3]){protectedMaxY=Math.max(protectedMaxY,g.newWorld[i+1]);if(g.newWorld[i+1]>18)protectedAbove18++;
      if(!inside(protect,g.newWorld[i],g.newWorld[i+2])){protectedEdgeVertices++;protectedEdgeMaxY=Math.max(protectedEdgeMaxY,g.newWorld[i+1]);if(g.newWorld[i+1]>18)protectedEdgeAbove18++;}
      for(let c=0;c<3;c++){tuple.writeFloatLE(g.positions[i+c],c*4);tuple.writeFloatLE(g.normals[i+c],12+c*4);}protectedHashAfter.update(tuple);
    }else{unprotectedMaxY=Math.max(unprotectedMaxY,g.newWorld[i+1]);const distance=Math.hypot(Math.max(protect.minX-g.newWorld[i],0,g.newWorld[i]-protect.maxX),Math.max(protect.minZ-g.newWorld[i+2],0,g.newWorld[i+2]-protect.maxZ));if(distance>=blend)farExteriorMaxY=Math.max(farExteriorMaxY,g.newWorld[i+1]);}
  }
  const protectedBefore=protectedHashBefore.digest('hex'),protectedAfter=protectedHashAfter.digest('hex'),xzBefore=xzHashBefore.digest('hex'),xzAfter=xzHashAfter.digest('hex');
  if(protectedBefore!==protectedAfter||xzBefore!==xzAfter)throw Error('Protected terrain or source XZ coordinates changed.');
  let maxSharedEdgeHeightDeviation=0;for(const v of seamHeights.values())maxSharedEdgeHeightDeviation=Math.max(maxSharedEdgeHeightDeviation,v.max-v.min);
  if(maxSharedEdgeHeightDeviation>.001)throw Error('Adjacent source components developed an exterior seam.');
  for(let i=0;i<j.materials.length;i++)if(JSON.stringify(j.materials[i])!==JSON.stringify(original.materials[i]))throw Error('Source material changed.');
  for(let i=0;i<j.meshes.length;i++){
    if(!landscape(j.meshes[i].name??'')&&JSON.stringify(j.meshes[i])!==JSON.stringify(original.meshes[i]))throw Error('Nonterrain source mesh changed.');
    if(landscape(j.meshes[i].name??'')&&exteriorSurface==='preserve'){
      const normalized=structuredClone(j.meshes[i]);for(let p=0;p<normalized.primitives.length;p++){normalized.primitives[p].attributes.POSITION=original.meshes[i].primitives[p].attributes.POSITION;normalized.primitives[p].attributes.NORMAL=original.meshes[i].primitives[p].attributes.NORMAL;}
      if(JSON.stringify(normalized)!==JSON.stringify(original.meshes[i]))throw Error('Terrain topology, UVs or material bindings changed.');
    }
  }
  // Conserve every oriented source face, and its exact material/UV assignment
  // whenever any of its vertices belongs to the protected village surface.
  let verifiedFaces=0,verifiedProtectedFaces=0;
  for(const g of groups){
    const originalPrimitives=original.meshes[j.nodes[g.node].mesh].primitives.filter((p:Json)=>p.attributes.POSITION===g.positionAccessor&&p.attributes.NORMAL===g.normalAccessor);
    const position=g.primitives[0].attributes.POSITION,normal=g.primitives[0].attributes.NORMAL,current=g.mesh.primitives.filter((p:Json)=>p.attributes.POSITION===position&&p.attributes.NORMAL===normal);
    const signature=(p:Json)=>{const q=structuredClone(p);delete q.indices;delete q.attributes.POSITION;delete q.attributes.NORMAL;return JSON.stringify(q);};
    const before=new Map<string,number>(),after=new Map<string,number>(),protectedBefore=new Map<string,number>(),protectedAfter=new Map<string,number>();
    const add=(map:Map<string,number>,id:string)=>map.set(id,(map.get(id)??0)+1);
    function collect(primitives:Json[],faces:Map<string,number>,protectedFaces:Map<string,number>,isAfter:boolean){for(const p of primitives){
      if(isAfter&&!originalPrimitives.some((q:Json)=>signature(q)===signature(p)))throw Error('Exterior remap invented an unverified material or vertex/UV frame.');
      const ix=isAfter&&appendedIndices.has(p.indices)?appendedIndices.get(p.indices)!:triangleIndices(p,g),s=signature(p);
      for(let t=0;t<ix.length;t+=3){const a=ix[t],b=ix[t+1],c=ix[t+2],id=`${a},${b},${c}`;add(faces,id);if(g.protected[a]||g.protected[b]||g.protected[c])add(protectedFaces,`${s}:${id}`);}
    }}
    collect(originalPrimitives,before,protectedBefore,false);collect(current,after,protectedAfter,true);
    const equal=(a:Map<string,number>,b:Map<string,number>)=>a.size===b.size&&[...a].every(([id,count])=>b.get(id)===count);
    if(!equal(before,after)||!equal(protectedBefore,protectedAfter))throw Error('Source topology or protected face material/UV assignments changed.');
    verifiedFaces+=[...after.values()].reduce((a,b)=>a+b,0);verifiedProtectedFaces+=[...protectedAfter.values()].reduce((a,b)=>a+b,0);
  }
  for(const node of architectureNodes)if(JSON.stringify(j.nodes[node])!==JSON.stringify(original.nodes[node]))throw Error('A building, prop or pond actor changed.');
  for(let i=0;i<j.nodes.length;i++)if(JSON.stringify(j.nodes[i].extras?.crownfallElderbloom)!==JSON.stringify(original.nodes[i].extras?.crownfallElderbloom))throw Error('Source XZ spatial-cell metadata changed.');
  function activeGeometryBytes(g:Json){const refs=new Set<number>();for(const m of g.meshes)for(const p of m.primitives){for(const index of Object.values(p.attributes))refs.add(index as number);if(p.indices!==undefined)refs.add(p.indices);}for(const n of g.nodes)for(const index of Object.values(n.extensions?.EXT_mesh_gpu_instancing?.attributes??{}))refs.add(index as number);const views=new Set<number>();for(const index of refs)views.add(g.accessors[index].bufferView);return [...views].reduce((sum,index)=>sum+g.bufferViews[index].byteLength,0);}
  const beforeGeometryBytes=activeGeometryBytes(original),afterGeometryBytes=activeGeometryBytes(j),padding=(4-length%4)%4;if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}
  j.buffers[0].byteLength=length;j.asset.extras??={};j.asset.extras.crownfallExteriorDisplayCandidate={version:2,sourceSha256:sourceHash,protectedVillageAndPond:true,lowerOnlyExterior:true,georeferenced:false};
  let text=Buffer.from(JSON.stringify(j));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);const bin=Buffer.concat(chunks),out=Buffer.alloc(28+text.length+bin.length),header=20+text.length;
  out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(text.length,12);out.writeUInt32LE(0x4e4f534a,16);text.copy(out,20);out.writeUInt32LE(bin.length,header);out.writeUInt32LE(0x004e4942,header+4);bin.copy(out,header+8);
  if(!bin.subarray(0,binary.length).equals(binary))throw Error('Original BIN prefix changed.');
  if(sha(await readFile(input))!==sourceHash)throw Error('Input changed during candidate preparation.');
  const report={input,output,inputSha256:sourceHash,sha256:sha(out),inputBytes:source.length,outputBytes:out.length,byteChange:out.length-source.length,
    parameters:{protectionMargin:margin,blendMetres:blend,coastalRelief:coastal,eastRelief:east,baseHeight,transitionMode:transition,exteriorSurface},
    orientation:{east:'+X',north:'-Z',inlet:'+Z',provisionalPresentationOnly:true,georeferenced:false},protectedFootprint:protect,
    terrain:{groups:groups.length,triangles:triangles.length,protectedVertices,alteredExteriorVertices:alteredVertices,alteredExteriorNormals:alteredNormals,maximumLowering:maxLowering,
      sourceOutsideVerticesAbove18m:sourceHighOutside,remainingOutsideVerticesAbove18m:remainingHighOutside,protectedPeaks:{maxY:protectedMaxY,above18m:protectedAbove18,edgeVertices:protectedEdgeVertices,edgeMaxY:protectedEdgeMaxY,edgeAbove18m:protectedEdgeAbove18},unprotectedMaxY,farExteriorMaxY,verifiedFaces,verifiedProtectedFaces,exteriorEarthFaces,surfaceReports,afterHeightRange:[afterMinY,afterMaxY],protectedPositionNormalHashBefore:protectedBefore,protectedPositionNormalHashAfter:protectedAfter,sourceXZHashBefore:xzBefore,sourceXZHashAfter:xzAfter,maxSharedEdgeHeightDeviation},
    foliage:{exteriorRoots,movedRoots,protectedRoots,missingSupportRoots,maximumPreservedOffsetError:maxRootOffsetError,changedNodes:instanceReports},
    preservation:{inputUnchanged:true,originalBinPrefixExact:true,allSourceMaterials:true,allNonterrainMeshes:true,allArchitecturePropsAndPondActors:true,protectedVillageAndPondSurfacesExact:true,allTopologyAndUVBuffers:true,protectedFaceMaterialAndUVAssignmentsExact:true,exteriorFaceRegroupingOnly:exteriorSurface==='earth',sourceCellXZMetadataExact:true,updatedInstanceAccessorBounds:true},
    memory:{activeGeometryBytesBefore:beforeGeometryBytes,activeGeometryBytesAfter:afterGeometryBytes,activeGeometryByteChange:afterGeometryBytes-beforeGeometryBytes,texturesUnchanged:true,limits:'Referenced buffer-view metadata only; not measured GPU allocation or headset performance.'},
    visualReviewRequired:true,limits:'Local exterior display candidate only. No exact map placement or regional-distance horizon is established. Original UV buffers and protected face assignments remain unchanged. Eligible unprotected low-slope rock faces may reuse the verified existing world-XZ earth frame; inherited macro paint/biome remains unchanged. Missing-support source foliage is preserved, not guessed.'};
  await writeFile(output,out,{flag:'wx'});await writeFile(output+'.exterior-report.json',JSON.stringify(report,null,2),{flag:'wx'});return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),allowed=new Set(['--input','--output','--expected-sha256','--protection-margin','--blend-metres','--coastal-relief','--east-relief','--transition-mode','--exterior-surface']);
  if(args.length%2||args.some((v,i)=>i%2===0&&!allowed.has(v))){console.error('Use --input private.glb --output separate-private.glb --expected-sha256 HASH [--protection-margin 2 --blend-metres 7 --coastal-relief 2.5 --east-relief 5.5 --transition-mode source-height|protected-edge --exterior-surface preserve|earth].');process.exitCode=1;}
  else{const flags=Object.fromEntries(Array.from({length:args.length/2},(_,i)=>[args[i*2],args[i*2+1]]));if(!flags['--input']||!flags['--output']||!flags['--expected-sha256']){console.error('Explicit input, separate output and expected input SHA-256 are required.');process.exitCode=1;}
    else adaptElderbloomExterior(flags['--input'],flags['--output'],{expectedSha256:flags['--expected-sha256'],protectionMargin:flags['--protection-margin']===undefined?undefined:Number(flags['--protection-margin']),blendMetres:flags['--blend-metres']===undefined?undefined:Number(flags['--blend-metres']),coastalRelief:flags['--coastal-relief']===undefined?undefined:Number(flags['--coastal-relief']),eastRelief:flags['--east-relief']===undefined?undefined:Number(flags['--east-relief']),transitionMode:flags['--transition-mode'] as ExteriorOptions['transitionMode'],exteriorSurface:flags['--exterior-surface'] as ExteriorOptions['exteriorSurface']}).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.stack??e.message);process.exitCode=1;});}
}

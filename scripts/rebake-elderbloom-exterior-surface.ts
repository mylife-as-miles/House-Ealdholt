// Guarded offline PRIVATE candidate: preserve every original byte and protected
// face's material/UVs; append an exterior-only atlas and split index lists.
import { readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mat4, mat4Multiply, normalMatrix, linearToSrgb, srgbToLinear, type Mat4 } from '../shared/legacy/environment/kernel/math';
import { noise3 } from '../shared/legacy/environment/kernel/noise';
import { rasterGround, rasterSourceGrass, type GroundBounds, type GroundMesh, type GroundSamples } from '../shared/legacy/aethelgard/environment/ground-atlas';
import { villageSurfaceBlend } from '../shared/legacy/aethelgard/environment/laas-surface';

type Json=Record<string,any>;
type Rect=GroundBounds;
interface Glb { path:string; hash:string; bytes:Buffer; json:Json; original:Json; binary:Buffer }
interface Ground extends GroundMesh { node:number; mesh:Json; primitives:Json[]; protected:Uint8Array; keys:string[] }
export interface ExteriorSurfaceOptions {
  expectedSha256:string;
  fieldSourcePath?:string;
  expectedFieldSha256?:string;
  atlasSize?:512|1024;
  protectionMargin?:number;
  transitionMetres?:number;
}
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const foliage=(name:string)=>/Grass_Clumps|BlackAlder|flower_|SM_vmcob|SM_vgzte/i.test(name);
const landscape=(name:string)=>/^LandscapeComponent_\d+$/.test(name);
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
function local(n:Json):Mat4 {
  if(n.matrix)return Float64Array.from(n.matrix);
  const[x,y,z,w]=n.rotation??[0,0,0,1],[a,b,c]=n.scale??[1,1,1],[tx,ty,tz]=n.translation??[0,0,0];
  return new Float64Array([(1-2*y*y-2*z*z)*a,(2*x*y+2*z*w)*a,(2*x*z-2*y*w)*a,0,(2*x*y-2*z*w)*b,(1-2*x*x-2*z*z)*b,(2*y*z+2*x*w)*b,0,(2*x*z+2*y*w)*c,(2*y*z-2*x*w)*c,(1-2*x*x-2*y*y)*c,0,tx,ty,tz,1]);
}
function point(m:Mat4,x:number,y:number,z:number):[number,number,number]{return[m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]];}
async function load(path:string,expected:string):Promise<Glb>{
  path=await realpath(path);if((await stat(path)).size>256*1024*1024)throw Error('Use a qualified private derivative below 256 MiB.');
  const bytes=await readFile(path),hash=sha(bytes);if(!/^[a-f0-9]{64}$/.test(expected)||hash!==expected)throw Error('Input SHA-256 differs from the explicitly qualified derivative.');
  if(bytes.length<28||bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)throw Error('Expected GLB2 JSON+BIN.');
  const at=20+bytes.readUInt32LE(12);if(at+8>bytes.length||bytes.readUInt32LE(at+4)!==0x004e4942||at+8+bytes.readUInt32LE(at)!==bytes.length)throw Error('Invalid binary chunk.');
  const json:Json=JSON.parse(bytes.subarray(20,at).toString());if(json.buffers.length!==1||json.buffers[0].uri)throw Error('Expected one embedded buffer.');
  if(!json.asset.extras?.crownfallExteriorDisplayCandidate?.protectedVillageAndPond||json.asset.extras.crownfallExteriorDisplayCandidate.version<2)throw Error('Expected a qualified v2 exterior display candidate.');
  return {path,hash,bytes,json,original:structuredClone(json),binary:bytes.subarray(at+8)};
}
function accessor(g:Glb,index:number,width:number):Float32Array|Uint32Array {
  const a=g.json.accessors[index],v=g.json.bufferViews[a?.bufferView],component=a?.componentType,size=component===5121?1:component===5123?2:component===5125||component===5126?4:0;
  if(!a||!v||v.buffer!==0||a.sparse||!Number.isSafeInteger(a.count)||a.count<1||!size||width>1&&component!==5126||a.type!==(width===1?'SCALAR':`VEC${width}`))throw Error('Expected dense bounded float vectors or unsigned indices.');
  const stride=v.byteStride??width*size,start=(v.byteOffset??0)+(a.byteOffset??0);if(stride<width*size||start+stride*(a.count-1)+width*size>(v.byteOffset??0)+v.byteLength||(v.byteOffset??0)+v.byteLength>g.binary.length)throw Error('Accessor exceeds source buffer.');
  const out=width===1?new Uint32Array(a.count):new Float32Array(a.count*width);
  for(let i=0;i<a.count;i++)for(let c=0;c<width;c++){const p=start+i*stride+c*size;out[i*width+c]=component===5126?g.binary.readFloatLE(p):size===4?g.binary.readUInt32LE(p):size===2?g.binary.readUInt16LE(p):g.binary[p];}return out;
}
function frames(g:Glb){const world=new Map<number,Mat4>();function walk(i:number,parent:Mat4){const n=g.json.nodes[i],m=mat4Multiply(mat4(),parent,local(n));world.set(i,m);for(const child of n.children??[])walk(child,m);}for(const i of g.json.scenes[g.json.scene??0].nodes??[])walk(i,mat4());return world;}
function meshBounds(g:Glb,index:number){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of g.json.meshes[index].primitives){const coords=accessor(g,p.attributes.POSITION,3);for(let i=0;i<coords.length;i++) {min[i%3]=Math.min(min[i%3],coords[i]);max[i%3]=Math.max(max[i%3],coords[i]);}}return{min,max};}
function actorFrames(g:Glb,n:Json,m:Mat4){const attrs=n.extensions?.EXT_mesh_gpu_instancing?.attributes;if(!attrs)return[m];const count=g.json.accessors[Object.values(attrs)[0]as number].count,t=attrs.TRANSLATION===undefined?null:accessor(g,attrs.TRANSLATION,3),r=attrs.ROTATION===undefined?null:accessor(g,attrs.ROTATION,4),s=attrs.SCALE===undefined?null:accessor(g,attrs.SCALE,3);return Array.from({length:count},(_,i)=>mat4Multiply(mat4(),m,local({translation:t?Array.from(t.subarray(i*3,i*3+3)):undefined,rotation:r?Array.from(r.subarray(i*4,i*4+4)):undefined,scale:s?Array.from(s.subarray(i*3,i*3+3)):undefined})));}
function protection(g:Glb,world:Map<number,Mat4>,margin:number):Rect {
  const bounds:Rect={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};let pond=false;
  for(const [i,m]of world){const n=g.json.nodes[i],mesh=g.json.meshes[n.mesh];if(!mesh||landscape(mesh.name??'')||foliage(mesh.name??''))continue;
    pond||=mesh.primitives.some((p:Json)=>/Pond_Water/.test(g.json.materials[p.material]?.name??''));const box=meshBounds(g,n.mesh);
    for(const frame of actorFrames(g,n,m))for(const x of[box.min[0],box.max[0]])for(const y of[box.min[1],box.max[1]])for(const z of[box.min[2],box.max[2]]){const p=point(frame,x,y,z);bounds.minX=Math.min(bounds.minX,p[0]);bounds.maxX=Math.max(bounds.maxX,p[0]);bounds.minZ=Math.min(bounds.minZ,p[2]);bounds.maxZ=Math.max(bounds.maxZ,p[2]);}
  }
  if(!pond||!Object.values(bounds).every(Number.isFinite))throw Error('Expected a real building/prop/pond protection footprint.');
  return {minX:bounds.minX-margin,maxX:bounds.maxX+margin,minZ:bounds.minZ-margin,maxZ:bounds.maxZ+margin};
}
function grounds(g:Glb,world:Map<number,Mat4>,protect:Rect){
  const result:Ground[]=[],bounds:GroundBounds={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity},meshes=new Set<number>();let uvError=0;const atlas=new Set<number>();
  for(const [node,m]of world){const n=g.json.nodes[node],mesh=g.json.meshes[n.mesh];if(!mesh||!landscape(mesh.name??''))continue;if(meshes.has(n.mesh))throw Error('Expected uniquely placed landscape meshes.');meshes.add(n.mesh);
    const grouped=new Map<string,Ground>(),nm=normalMatrix(new Float64Array(9),m);
    for(const p of mesh.primitives){const material=g.json.materials[p.material],base=material?.pbrMetallicRoughness?.baseColorTexture;
      if((p.mode??4)!==4||!/^Crownfall_LAAS_BakedGround_Review_(earth|rock)_Microdetail$/.test(material?.name??'')||!material.extras?.crownfallTerrainRepair||base?.texCoord!==1||base.extensions||p.attributes.TEXCOORD_1===undefined||p.attributes.COLOR_0!==undefined)throw Error('Expected verified atlas-only terrain with unchanged world UV1.');atlas.add(base.index);
      const id=`${p.attributes.POSITION}:${p.attributes.NORMAL}`;let group=grouped.get(id);
      if(!group){const positions=accessor(g,p.attributes.POSITION,3)as Float32Array,normals=accessor(g,p.attributes.NORMAL,3)as Float32Array;if(positions.length!==normals.length)throw Error('Terrain attribute mismatch.');
        for(let v=0;v<positions.length;v+=3){positions.set(point(m,positions[v],positions[v+1],positions[v+2]),v);const x=normals[v],y=normals[v+1],z=normals[v+2],nx=nm[0]*x+nm[3]*y+nm[6]*z,ny=nm[1]*x+nm[4]*y+nm[7]*z,nz=nm[2]*x+nm[5]*y+nm[8]*z,l=Math.hypot(nx,ny,nz);if(!l)throw Error('Invalid terrain normal.');normals.set([nx/l,ny/l,nz/l],v);bounds.minX=Math.min(bounds.minX,positions[v]);bounds.maxX=Math.max(bounds.maxX,positions[v]);bounds.minZ=Math.min(bounds.minZ,positions[v+2]);bounds.maxZ=Math.max(bounds.maxZ,positions[v+2]);}
        group={node,mesh,positions,normals,indices:[],primitives:[],protected:new Uint8Array(positions.length/3),keys:Array.from({length:positions.length/3},(_,v)=>`${Math.round(positions[v*3]*1e4)},${Math.round(positions[v*3+1]*1e4)},${Math.round(positions[v*3+2]*1e4)}`)};grouped.set(id,group);result.push(group);
      }
      const ix=p.indices===undefined?Uint32Array.from({length:group.positions.length/3},(_,v)=>v):accessor(g,p.indices,1)as Uint32Array;if(ix.length%3)throw Error('Incomplete terrain faces.');group.primitives.push(p);
      // Avoid spreading hundreds of thousands of indices into a call stack.
      for(let t=0;t<ix.length;t+=3){const a=ix[t],b=ix[t+1],c=ix[t+2],w=group.positions;if(Math.max(a,b,c)*3+2>=w.length)throw Error('Terrain index exceeds positions.');(group.indices as number[]).push(a,b,c);
        if(Math.max(w[a*3],w[b*3],w[c*3])>=protect.minX&&Math.min(w[a*3],w[b*3],w[c*3])<=protect.maxX&&Math.max(w[a*3+2],w[b*3+2],w[c*3+2])>=protect.minZ&&Math.min(w[a*3+2],w[b*3+2],w[c*3+2])<=protect.maxZ)group.protected[a]=group.protected[b]=group.protected[c]=1;
      }
    }
  }
  if(!result.length||atlas.size!==1)throw Error('Expected one shared verified ground atlas.');
  const protectedKeys=new Set<string>();for(const group of result)for(let v=0;v<group.protected.length;v++)if(group.protected[v])protectedKeys.add(group.keys[v]);
  for(const group of result){group.indices=Uint32Array.from(group.indices);for(let v=0;v<group.protected.length;v++)if(protectedKeys.has(group.keys[v]))group.protected[v]=1;
    for(const p of group.primitives){const uv=accessor(g,p.attributes.TEXCOORD_1,2);if(uv.length!==group.positions.length/3*2)throw Error('Incomplete shared world UV1.');for(let v=0;v<uv.length/2;v++)uvError=Math.max(uvError,Math.abs(uv[v*2]-(group.positions[v*3]-bounds.minX)/(bounds.maxX-bounds.minX)),Math.abs(uv[v*2+1]-(group.positions[v*3+2]-bounds.minZ)/(bounds.maxZ-bounds.minZ)));}
  }
  if(uvError>2e-6)throw Error('Atlas UV1 is not the proved source world-XZ frame.');return{groups:result,bounds,atlasTexture:[...atlas][0],uvError};
}
function sourceSites(g:Glb,world:Map<number,Mat4>){const grass:{origin:[number,number,number];footprintRadius:number}[]=[],trees:{origin:[number,number,number];radius:number}[]=[];
  for(const [i,m]of world){const n=g.json.nodes[i],mesh=g.json.meshes[n.mesh];if(!mesh||!/Grass_Clumps|BlackAlder/i.test(mesh.name??''))continue;const box=meshBounds(g,n.mesh);
    for(const frame of actorFrames(g,n,m)){const origin=point(frame,0,0,0),scale=Math.max(Math.hypot(frame[0],frame[2]),Math.hypot(frame[8],frame[10])),radius=Math.hypot(box.max[0]-box.min[0],box.max[2]-box.min[2])*scale/2;
      if(/Grass_Clumps/i.test(mesh.name))grass.push({origin,footprintRadius:radius});else trees.push({origin,radius:Math.max(1,Math.min(9,radius))});
    }
  }return{grass,trees};
}
function canopyMask(trees:ReturnType<typeof sourceSites>['trees'],surface:GroundSamples,b:GroundBounds){const size=surface.size,result=new Float32Array(size*size),sx=(b.maxX-b.minX)/size,sz=(b.maxZ-b.minZ)/size;let accepted=0;
  for(const site of trees){const[x,y,z]=site.origin,r=site.radius,cx=Math.floor((x-b.minX)/sx),cz=Math.floor((z-b.minZ)/sz);if(cx<0||cz<0||cx>=size||cz>=size||Math.abs(surface.heights[cz*size+cx]-y)>2.5)continue;accepted++;
    for(let iz=Math.max(0,Math.ceil((z-r-b.minZ)/sz-.5));iz<=Math.min(size-1,Math.floor((z+r-b.minZ)/sz-.5));iz++)for(let ix=Math.max(0,Math.ceil((x-r-b.minX)/sx-.5));ix<=Math.min(size-1,Math.floor((x+r-b.minX)/sx-.5));ix++){const q=((b.minX+(ix+.5)*sx-x)**2+(b.minZ+(iz+.5)*sz-z)**2)/(r*r);if(q<1)result[iz*size+ix]+=(1-q)**2;}
  }for(let i=0;i<result.length;i++)result[i]=1-Math.exp(-result[i]);return{values:result,accepted};
}
/** Exact metric distance to the rasterized frozen faces. Continuous face-edge
 * uncertainty is bounded by the raster-cell diagonal, not a rectangular mask. */
export function distanceFromProtectedSamples(mask:ArrayLike<number>,size:number,stepX:number,stepZ:number):Float32Array {
  if(mask.length!==size*size||!Number.isInteger(size)||size<2||![stepX,stepZ].every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid protected surface raster.');
  const distances=Float64Array.from(mask,v=>v?0:Infinity);if(!distances.some(Number.isFinite))throw Error('Protected face raster is empty.');
  function pass(values:Float64Array,step:number){const out=new Float64Array(size).fill(Infinity),vertices=new Int32Array(size),knees=new Float64Array(size+1),spacing=step*step;let count=-1;
    for(let q=0;q<size;q++){if(!Number.isFinite(values[q]))continue;let crossing=-Infinity;
      while(count>=0){const v=vertices[count];crossing=(values[q]+spacing*q*q-values[v]-spacing*v*v)/(2*spacing*(q-v));if(crossing>knees[count])break;count--;}
      count++;vertices[count]=q;knees[count]=count===0?-Infinity:crossing;knees[count+1]=Infinity;
    }
    if(count<0)return out;let k=0;for(let q=0;q<size;q++){while(k<count&&knees[k+1]<q)k++;const v=vertices[k];out[q]=values[v]+spacing*(q-v)*(q-v);}return out;
  }
  for(let z=0;z<size;z++)distances.set(pass(distances.slice(z*size,(z+1)*size),stepX),z*size);
  for(let x=0;x<size;x++){const values=pass(Float64Array.from({length:size},(_,z)=>distances[z*size+x]),stepZ);for(let z=0;z<size;z++)distances[z*size+x]=values[z];}
  return Float32Array.from(distances,Math.sqrt);
}
/** Original authored meadow layer plus measured repaired slope, clump presence
 * and projected tree footprints. Moisture remains unknown/zero: no invented AO,
 * water, road or recovered source-paint mask is baked into this albedo. */
export function exteriorSurfaceAlbedo(x:number,y:number,z:number,slope:number,grass:number,canopy:number):[number,number,number]{
  if(![x,y,z,slope,grass,canopy].every(Number.isFinite)||slope<0)throw Error('Exterior surface fields must be finite and slope nonnegative.');
  const meadow=.55+.3*noise3(x*.065,0,z*.065,6221),vegetation=Math.max(grass,meadow),blend=villageSurfaceBlend({slope,vegetationDensity:vegetation,moisture:0,rockExposure:0,riverDepthMetres:0,shoreWetness:0});
  const forest=Math.max(0,Math.min(1,canopy))*.7*(1-blend.weights.rock),soil=[.105,.081,.054],green=[.045,.079,.025],litter=[.071,.058,.034],rock=[.15,.145,.13],detail=.94+.12*noise3(x*.7,y*.7,z*.7,6223);
  return soil.map((v,c)=>(v*blend.weights.soil+green[c]*blend.weights.grass+rock[c]*blend.weights.rock)*(1-forest)*detail+litter[c]*forest*detail)as[number,number,number];
}
export async function rebakeElderbloomExteriorSurface(inputPath:string,outputPath:string,options:ExteriorSurfaceOptions){
  const output=resolve(outputPath),parent=await realpath(dirname(output));if(parent===repository||parent.startsWith(repository+'/'))throw Error('Use a separate PRIVATE output outside the repository.');
  try{await stat(output);throw Error('Output exists; preserve all earlier candidates.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const size=options.atlasSize??1024,margin=options.protectionMargin??2,transition=options.transitionMetres??4;if(![512,1024].includes(size)||!Number.isFinite(margin)||margin<1||margin>10||!Number.isFinite(transition)||transition<2||transition>12)throw Error('Invalid bounded exterior surface parameters.');
  const g=await load(inputPath,options.expectedSha256);if(g.path===output)throw Error('Use a separate PRIVATE output.');const fieldPath=options.fieldSourcePath?await realpath(options.fieldSourcePath):g.path;
  const field=fieldPath===g.path?g:await load(fieldPath,options.expectedFieldSha256??'');const world=frames(g),protect=protection(g,world,margin),ground=grounds(g,world,protect),fieldWorld=field===g?world:frames(field),fieldProtect=field===g?protect:protection(field,fieldWorld,margin),fieldGround=field===g?ground:grounds(field,fieldWorld,fieldProtect);
  if(Object.keys(ground.bounds).some(k=>Math.abs(ground.bounds[k as keyof Rect]-fieldGround.bounds[k as keyof Rect])>1e-4))throw Error('Field source and target have different world-XZ envelopes.');
  const j=g.json,sharp=createRequire(new URL('../main-game-vr/package.json',import.meta.url))('sharp'),atlasTexture=j.textures[ground.atlasTexture],atlasImage=j.images[atlasTexture.source],atlasView=j.bufferViews[atlasImage?.bufferView];
  if(atlasImage?.name!=='Crownfall_AethelgardGroundAtlas'||atlasImage.mimeType!=='image/png'||!atlasView)throw Error('Expected the verified generated macro atlas.');
  const originalPng=g.binary.subarray(atlasView.byteOffset??0,(atlasView.byteOffset??0)+atlasView.byteLength),originalMetadata=await sharp(originalPng).metadata();if(![1024,2048].includes(originalMetadata.width)||originalMetadata.width!==originalMetadata.height)throw Error('Unexpected qualified macro atlas dimensions.');
  // One common field resolution makes Desktop/Quest use the same measured mask.
  const fieldSize=1024,surface=rasterGround(fieldGround.groups,ground.bounds,fieldSize),sites=sourceSites(field,fieldWorld),grass=rasterSourceGrass(sites.grass,surface,ground.bounds),canopy=canopyMask(sites.trees,surface,ground.bounds),old:Buffer=await sharp(originalPng).ensureAlpha().resize(fieldSize,fieldSize,{kernel:'lanczos3'}).raw().toBuffer(),pixels=Buffer.from(old);
  const frozenGround=ground.groups.map(group=>{const indices:number[]=[];for(let i=0;i<group.indices.length;i+=3){const a=group.indices[i],b=group.indices[i+1],c=group.indices[i+2];if(group.protected[a]||group.protected[b]||group.protected[c])indices.push(a,b,c);}return{positions:group.positions,normals:group.normals,indices:Uint32Array.from(indices)};});
  const frozenRaster=rasterGround(frozenGround,ground.bounds,fieldSize),frozenMask=Uint8Array.from(frozenRaster.heights,h=>Number.isFinite(h)?1:0),b=ground.bounds,stepX=(b.maxX-b.minX)/fieldSize,stepZ=(b.maxZ-b.minZ)/fieldSize,distances=distanceFromProtectedSamples(frozenMask,fieldSize,stepX,stepZ);
  let changedPixels=0,measuredGrassPixels=0,treePixels=0,boundaryPixels=0,maximumBoundaryChannelChange=0;
  for(let z=0;z<fieldSize;z++)for(let x=0;x<fieldSize;x++){
    const i=z*fieldSize+x,y=surface.heights[i];if(!Number.isFinite(y))continue;const wx=b.minX+(x+.5)/fieldSize*(b.maxX-b.minX),wz=b.minZ+(z+.5)/fieldSize*(b.maxZ-b.minZ),distance=distances[i],weight=smooth(0,transition,distance);if(!weight)continue;
    const nx=surface.normals[i*3],ny=surface.normals[i*3+1],nz=surface.normals[i*3+2],slope=ny>0?Math.hypot(nx,nz)/ny:1e6,color=exteriorSurfaceAlbedo(wx,y,wz,slope,grass[i],canopy.values[i]);
    const edge=Math.min(wx-b.minX,b.maxX-wx,wz-b.minZ,b.maxZ-wz),edgeWeight=smooth(0,6,edge),meadow=[.045,.079,.025];
    for(let c=0;c<3;c++){const linear=mix(meadow[c],color[c],edgeWeight),before=srgbToLinear(old[i*4+c]/255);pixels[i*4+c]=Math.round(Math.max(0,Math.min(1,linearToSrgb(mix(before,linear,weight))))*255);}pixels[i*4+3]=255;changedPixels++;if(distance<=Math.max(stepX,stepZ)*1.5){boundaryPixels++;for(let c=0;c<3;c++)maximumBoundaryChannelChange=Math.max(maximumBoundaryChannelChange,Math.abs(pixels[i*4+c]-old[i*4+c]));}if(grass[i]>.05)measuredGrassPixels++;if(canopy.values[i]>.05)treePixels++;
  }
  const png:Buffer=await sharp(pixels,{raw:{width:fieldSize,height:fieldSize,channels:4}}).resize(size,size,{kernel:'lanczos3'}).png({compressionLevel:9,adaptiveFiltering:true}).toBuffer();
  const chunks:Buffer[]=[g.binary];let length=g.binary.length;function append(bytes:Buffer,target?:number){const padding=(4-length%4)%4;if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}const view=j.bufferViews.length;j.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length,...(target?{target}:{})});chunks.push(bytes);length+=bytes.length;return view;}
  const image=j.images.length;j.images.push({name:'Crownfall_ExteriorSurfaceAtlas_PrivateCandidate',mimeType:'image/png',bufferView:append(png)});const texture=j.textures.length;j.textures.push({...structuredClone(atlasTexture),source:image});
  const ownedMaterials=new Map<number,number>(),appended=new Map<number,Uint32Array>();function material(index:number){let value=ownedMaterials.get(index);if(value!==undefined)return value;const copy=structuredClone(j.materials[index]);copy.pbrMetallicRoughness.baseColorTexture.index=texture;copy.extras.crownfallExteriorSurface={version:3,privateDisplayCandidate:true,protectedSourceAtlasUnchanged:true,sourceMaterial:index,atlasSha256:sha(png),moistureField:'unavailable; zero',forestField:'actual supported tree-footprint projection',meadowField:'original authored low-frequency ground cover'};const created:number=j.materials.length;j.materials.push(copy);ownedMaterials.set(index,created);return created;}
  function index(values:number[]){if(!values.length)throw Error('Do not write empty exterior primitives.');const data=Uint32Array.from(values),a=j.accessors.length;j.accessors.push({bufferView:append(Buffer.from(data.buffer),34963),componentType:5125,count:data.length,type:'SCALAR'});appended.set(a,data);return a;}
  let exteriorFaces=0,protectedFaces=0,drawsBefore=0,drawsAfter=0;const replacements=new Map<Json,Json[]>();
  for(const group of ground.groups)for(const p of group.primitives){const ix=p.indices===undefined?Uint32Array.from({length:group.positions.length/3},(_,v)=>v):accessor(g,p.indices,1),inside:number[]=[],outside:number[]=[];for(let i=0;i<ix.length;i+=3){const list=group.protected[ix[i]]||group.protected[ix[i+1]]||group.protected[ix[i+2]]?inside:outside;list.push(ix[i],ix[i+1],ix[i+2]);}
    const parts:Json[]=[];if(inside.length){const keep=structuredClone(p);if(outside.length)keep.indices=index(inside);parts.push(keep);protectedFaces+=inside.length/3;}
    if(outside.length){const copy=structuredClone(p);copy.material=material(p.material);if(inside.length)copy.indices=index(outside);parts.push(copy);exteriorFaces+=outside.length/3;}replacements.set(p,parts);drawsBefore++;drawsAfter+=parts.length;
  }
  for(const mesh of j.meshes)if(landscape(mesh.name??''))mesh.primitives=mesh.primitives.flatMap((p:Json)=>replacements.get(p)??[p]);
  // Explicit per-face proof: topology and each protected material/UV assignment.
  let verifiedFaces=0,verifiedProtectedFaces=0;
  for(const group of ground.groups){const pos=group.primitives[0].attributes.POSITION,nor=group.primitives[0].attributes.NORMAL,current=group.mesh.primitives.filter((p:Json)=>p.attributes.POSITION===pos&&p.attributes.NORMAL===nor),faces=new Map<string,number>(),protectedBefore=new Map<string,number>(),protectedAfter=new Map<string,number>();
    const signature=(p:Json)=>{const copy=structuredClone(p);delete copy.indices;return JSON.stringify(copy);},add=(m:Map<string,number>,id:string)=>m.set(id,(m.get(id)??0)+1);
    for(const p of group.primitives){const ix=p.indices===undefined?Uint32Array.from({length:group.positions.length/3},(_,v)=>v):accessor(g,p.indices,1);for(let t=0;t<ix.length;t+=3){const id=`${ix[t]},${ix[t+1]},${ix[t+2]}`;add(faces,id);if(group.protected[ix[t]]||group.protected[ix[t+1]]||group.protected[ix[t+2]])add(protectedBefore,`${signature(p)}:${id}`);}}
    for(const p of current){const ix=appended.get(p.indices)??(p.indices===undefined?Uint32Array.from({length:group.positions.length/3},(_,v)=>v):accessor(g,p.indices,1));for(let t=0;t<ix.length;t+=3){const id=`${ix[t]},${ix[t+1]},${ix[t+2]}`,count=faces.get(id)??0;if(!count)throw Error('Exterior surface split duplicated or invented a source face.');faces.set(id,count-1);verifiedFaces++;if(group.protected[ix[t]]||group.protected[ix[t+1]]||group.protected[ix[t+2]]){add(protectedAfter,`${signature(p)}:${id}`);verifiedProtectedFaces++;if(p.material>=g.original.materials.length)throw Error('Protected face used the new exterior atlas.');}}}
    if([...faces.values()].some(Boolean)||protectedBefore.size!==protectedAfter.size||[...protectedBefore].some(([k,v])=>protectedAfter.get(k)!==v))throw Error('Exterior surface split changed topology or protected material/UV assignments.');
  }
  for(let i=0;i<g.original.meshes.length;i++)if(!landscape(g.original.meshes[i].name??'')&&JSON.stringify(j.meshes[i])!==JSON.stringify(g.original.meshes[i]))throw Error('Nonterrain mesh changed.');
  for(const key of['nodes','scenes','samplers'])if(JSON.stringify(j[key])!==JSON.stringify(g.original[key]))throw Error(`Original ${key} changed.`);
  for(const key of['materials','images','textures','accessors','bufferViews'])if(JSON.stringify(j[key].slice(0,g.original[key].length))!==JSON.stringify(g.original[key]))throw Error(`Original ${key} changed.`);
  const padding=(4-length%4)%4;if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}j.buffers[0].byteLength=length;j.asset.extras.crownfallExteriorSurfaceCandidate={version:3,sourceSha256:g.hash,fieldSha256:field.hash,protectedAtlasAndMipChainExact:true,allGeometryAndTransformsExact:true,georeferenced:false};
  let text=Buffer.from(JSON.stringify(j));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);const bin=Buffer.concat(chunks),out=Buffer.alloc(28+text.length+bin.length),at=20+text.length;out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(text.length,12);out.writeUInt32LE(0x4e4f534a,16);text.copy(out,20);out.writeUInt32LE(bin.length,at);out.writeUInt32LE(0x004e4942,at+4);bin.copy(out,at+8);
  if(!bin.subarray(0,g.binary.length).equals(g.binary)||sha(await readFile(g.path))!==g.hash||field!==g&&sha(await readFile(field.path))!==field.hash)throw Error('A private input or original BIN prefix changed.');
  const report={input:g.path,fieldSource:field.path,output,inputSha256:g.hash,fieldSha256:field.hash,sha256:sha(out),inputBytes:g.bytes.length,outputBytes:out.length,byteChange:out.length-g.bytes.length,parameters:{atlasSize:size,fieldSize,protectionMargin:margin,transitionMetres:transition},protectedFootprint:protect,sourceWorldBounds:ground.bounds,atlas:{image,texture,sha256:sha(png),bytes:png.length,width:size,height:size,worldUvMaxError:ground.uvError,featherBoundary:'actual frozen source-face raster',featherDistanceErrorBoundMetres:Math.hypot(stepX,stepZ),boundaryPixels,maximumBoundaryChannelChangeSrgb:maximumBoundaryChannelChange,changedFieldPixels:changedPixels,measuredGrassPixels,treeFootprintPixels:treePixels,sourceGrassSites:sites.grass.length,sourceTreeSites:sites.trees.length,supportedTreeSites:canopy.accepted,moisture:'unknown; zero',ambientOcclusion:'no macro AO in input or output; existing tiling microdetail unchanged'},terrain:{verifiedFaces,verifiedProtectedFaces,exteriorFaces,protectedFaces,drawsBefore,drawsAfter,additionalDraws:drawsAfter-drawsBefore,newMaterials:ownedMaterials.size,geometryPositionsNormalsUVsAndTransformsExact:true},preservation:{inputUnchanged:true,fieldInputUnchanged:true,originalBinPrefixExact:true,allOriginalImagesMaterialsAndTexturesExact:true,protectedAtlasAndMipChainExact:true,allProtectedFaceMaterialsAndUVsExact:true,allArchitecturePondAndFoliageExact:true},memory:{additionalAtlasBytesWithMips:Math.ceil(size*size*4*4/3),appendedIndexBufferBytes:[...appended.values()].reduce((sum,q)=>sum+q.byteLength,0),limits:'Referenced metadata estimates only, not measured GPU or headset allocations.'},visualReviewRequired:true,limits:'Surface-only private candidate. No exact map match, regional horizon, recovered paint mask, moisture or AO is claimed. Protected-edge terrain peaks from the prior candidate remain unchanged. Exterior atlas uses actual repaired Desktop normals/placements plus an explicitly authored original meadow layer.'};
  await writeFile(output,out,{flag:'wx'});await writeFile(output+'.surface-report.json',JSON.stringify(report,null,2),{flag:'wx'});return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const args=process.argv.slice(2),allowed=new Set(['--input','--output','--expected-sha256','--field-source','--field-sha256','--atlas-size']);if(args.length%2||args.some((v,i)=>i%2===0&&!allowed.has(v))){console.error('Use --input private-v2.glb --output separate-private-v3.glb --expected-sha256 HASH [--field-source private-desktop-v2.glb --field-sha256 HASH --atlas-size 512|1024].');process.exitCode=1;}else{const f=Object.fromEntries(Array.from({length:args.length/2},(_,i)=>[args[i*2],args[i*2+1]]));if(!f['--input']||!f['--output']||!f['--expected-sha256']){console.error('Input, separate private output and qualified SHA-256 required.');process.exitCode=1;}else rebakeElderbloomExteriorSurface(f['--input'],f['--output'],{expectedSha256:f['--expected-sha256'],fieldSourcePath:f['--field-source'],expectedFieldSha256:f['--field-sha256'],atlasSize:f['--atlas-size']===undefined?undefined:Number(f['--atlas-size'])as 512|1024}).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.stack??e.message);process.exitCode=1;});}}

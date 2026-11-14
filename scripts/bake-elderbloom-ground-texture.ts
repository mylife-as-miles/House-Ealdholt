// Local-only shared albedo bake. Neither renderer nor source models are changed.
import { readFile,writeFile,stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { mat4,mat4Multiply,normalMatrix,type Mat4 } from '../shared/legacy/environment/kernel/math';
import { rasterGround,rasterSourceGrass,groundUv,groundAlbedo,type GroundBounds,type GroundMesh } from '../shared/legacy/aethelgard/environment/ground-atlas';
type Json=Record<string,any>;
interface Glb { json:Json; binary:Buffer; bytes:number }
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function readGlb(path:string):Promise<Glb> {
  if((await stat(path)).size>128*1024*1024) throw new Error('Use an optimized copy, not the original GLB.');
  const b=await readFile(path),n=b.readUInt32LE(12),at=20+n;
  if(b.readUInt32LE(0)!==0x46546c67||b.readUInt32LE(4)!==2||b.readUInt32LE(8)!==b.length||b.readUInt32LE(16)!==0x4e4f534a||b.readUInt32LE(at+4)!==0x004e4942||at+8+b.readUInt32LE(at)!==b.length) throw new Error('Expected a valid JSON+BIN GLB.');
  return {json:JSON.parse(b.subarray(20,at).toString('utf8')),binary:b.subarray(at+8),bytes:b.length};
}
function local(n:Json):Mat4 {
  if(n.matrix)return new Float64Array(n.matrix);
  const[x,y,z,w]=n.rotation??[0,0,0,1],[a,b,c]=n.scale??[1,1,1],[tx,ty,tz]=n.translation??[0,0,0];
  return new Float64Array([(1-2*y*y-2*z*z)*a,(2*x*y+2*z*w)*a,(2*x*z-2*y*w)*a,0,(2*x*y-2*z*w)*b,(1-2*x*x-2*z*z)*b,(2*y*z+2*x*w)*b,0,(2*x*z+2*y*w)*c,(2*y*z-2*x*w)*c,(1-2*x*x-2*y*y)*c,0,tx,ty,tz,1]);
}
function accessor(g:Glb,index:number,width:number):Float32Array|Uint32Array {
  const a=g.json.accessors[index],v=g.json.bufferViews[a?.bufferView],component=a?.componentType;
  if(!a||!v||v.buffer!==0||a.sparse||!Number.isSafeInteger(a.count)||a.count<1)throw new Error('Invalid dense accessor.');
  const element=component===5126||component===5125?4:component===5123?2:component===5121?1:0;
  if(!element||(width>1&&component!==5126))throw new Error('Expected float vectors or unsigned indices.');
  const stride=v.byteStride??element*width,offset=(v.byteOffset??0)+(a.byteOffset??0),view=new DataView(g.binary.buffer,g.binary.byteOffset,g.binary.byteLength);
  if(offset+stride*(a.count-1)+element*width>(v.byteOffset??0)+v.byteLength)throw new Error('Accessor exceeds its buffer view.');
  const out=width===1?new Uint32Array(a.count):new Float32Array(a.count*width);
  for(let i=0;i<a.count;i++)for(let k=0;k<width;k++){const p=offset+i*stride+k*element;out[i*width+k]=component===5126?view.getFloat32(p,true):element===4?view.getUint32(p,true):element===2?view.getUint16(p,true):view.getUint8(p);}
  return out;
}
interface Terrain extends GroundMesh { primitive:Json; node:number }
function terrain(g:Glb):Terrain[] {
  const result:Terrain[]=[],seen=new Set<number>();
  function walk(index:number,parent:Mat4){
    const node=g.json.nodes[index],world=mat4Multiply(mat4(),parent,local(node)),mesh=g.json.meshes[node.mesh];
    if(mesh&&/^LandscapeComponent_\d+$/.test(mesh.name??'')){
      if(seen.has(node.mesh))throw new Error('Clone shared terrain before an atlas bake.');seen.add(node.mesh);
      const nm=normalMatrix(new Float64Array(9),world);
      for(const primitive of mesh.primitives){
        const material=g.json.materials[primitive.material];
        if(!material?.name?.startsWith('Crownfall_LAAS_')||!material.extras?.crownfallTerrainRepair||primitive.attributes.TEXCOORD_1!==undefined)throw new Error('Expected our generated review ground with unused UV1.');
        if((primitive.mode??4)!==4)throw new Error('Expected terrain triangle lists.');
        const positions=accessor(g,primitive.attributes.POSITION,3) as Float32Array,normals=accessor(g,primitive.attributes.NORMAL,3) as Float32Array;
        for(let i=0;i<positions.length;i+=3){
          const x=positions[i],y=positions[i+1],z=positions[i+2];
          positions[i]=world[0]*x+world[4]*y+world[8]*z+world[12];positions[i+1]=world[1]*x+world[5]*y+world[9]*z+world[13];positions[i+2]=world[2]*x+world[6]*y+world[10]*z+world[14];
          const a=normals[i],b=normals[i+1],c=normals[i+2],nx=nm[0]*a+nm[3]*b+nm[6]*c,ny=nm[1]*a+nm[4]*b+nm[7]*c,nz=nm[2]*a+nm[5]*b+nm[8]*c,l=Math.hypot(nx,ny,nz);
          if(!l)throw new Error('Invalid terrain normal.');normals[i]=nx/l;normals[i+1]=ny/l;normals[i+2]=nz/l;
        }
        const indices=primitive.indices===undefined?Uint32Array.from({length:positions.length/3},(_,i)=>i):accessor(g,primitive.indices,1) as Uint32Array;
        result.push({positions,normals,indices,primitive,node:index});
      }
    }
    for(const child of node.children??[])walk(child,world);
  }
  for(const index of g.json.scenes[g.json.scene??0].nodes??[])walk(index,mat4());
  if(!result.length)throw new Error('No generated landscape found.');return result;
}

async function embedAtlas(g:Glb,ground:Terrain[],bounds:GroundBounds,png:Buffer,path:string){
  const j=g.json,chunks=[g.binary];let length=g.binary.length;
  function append(bytes:Buffer,target?:number){
    const padding=(4-length%4)%4;if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}
    const index=j.bufferViews.length;j.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length,...(target?{target}:{})});chunks.push(bytes);length+=bytes.length;return index;
  }
  const material=j.materials.length;
  for(const part of ground){
    const uv=new Float32Array(part.positions.length/3*2);
    for(let i=0;i<part.positions.length;i+=3){const [u,v]=groundUv(part.positions[i],part.positions[i+2],bounds);uv[i/3*2]=u;uv[i/3*2+1]=v;}
    const view=append(Buffer.from(uv.buffer),34962),index=j.accessors.length;
    j.accessors.push({bufferView:view,componentType:5126,count:uv.length/2,type:'VEC2'});
    part.primitive.attributes.TEXCOORD_1=index;
    // Native's rebuilt ground has no original UV0. An alias is harmless and
    // supports loaders that still expect the primary UV attribute to exist.
    if(part.primitive.attributes.TEXCOORD_0===undefined)part.primitive.attributes.TEXCOORD_0=index;
    delete part.primitive.attributes.COLOR_0; // ours, confirmed by terrain()
    part.primitive.material=material;
  }
  const image=j.images.length;j.images.push({name:'Crownfall_AethelgardGroundAtlas',bufferView:append(png),mimeType:'image/png'});
  j.samplers??=[];const sampler=j.samplers.length;j.samplers.push({magFilter:9729,minFilter:9987,wrapS:33071,wrapT:33071});
  const texture=j.textures.length;j.textures.push({source:image,sampler});
  j.materials.push({name:'Crownfall_LAAS_BakedGround_Review',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],baseColorTexture:{index:texture,texCoord:1},metallicFactor:0,roughnessFactor:.94},extras:{crownfallTerrainRepair:'Shared world-planar albedo atlas from actual Desktop terrain height/normals and source Grass_Clumps placements; owned 3D microtexture. No invented road/water/moisture masks.',atlasSha256:hash(png)}});
  const pad=(4-length%4)%4;if(pad){chunks.push(Buffer.alloc(pad));length+=pad;}
  j.buffers[0].byteLength=length;
  let json=Buffer.from(JSON.stringify(j));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
  const binary=Buffer.concat(chunks),out=Buffer.alloc(28+json.length+binary.length);
  out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);
  const at=20+json.length;out.writeUInt32LE(binary.length,at);out.writeUInt32LE(0x004e4942,at+4);binary.copy(out,at+8);
  await writeFile(path,out,{flag:'wx'});
  return {file:resolve(path),bytes:out.length,sha256:hash(out),atlasSha256:hash(png),terrainPrimitives:ground.length};
}

async function estimatedGpuBytes(g:Glb,sharp:any){
  let textures=0;
  for(const image of g.json.images??[]){
    const v=g.json.bufferViews[image.bufferView];if(!v)throw new Error('External images prevent a bounded texture estimate.');
    const m=await sharp(g.binary.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength)).metadata();
    if(!m.width||!m.height)throw new Error('Unknown source image size.');textures+=m.width*m.height*4*4/3;
  }
  const geometry=g.json.bufferViews.filter((v:Json)=>v.target===34962||v.target===34963).reduce((s:number,v:Json)=>s+v.byteLength,0);
  return {texturesWithMips:Math.ceil(textures),geometry,combined:Math.ceil(textures)+geometry};
}

export async function bakeGroundTexture(desktopPath:string,questPath:string,metadataPath:string,boundsPath:string,outputDir:string){
  const sharp=createRequire(new URL('../main-game-vr/package.json',import.meta.url))('sharp');
  const desktop=await readGlb(desktopPath),quest=await readGlb(questPath),desktopGround=terrain(desktop),questGround=terrain(quest);
  const nativeBefore=await estimatedGpuBytes(quest,sharp);
  const bounds:GroundBounds={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
  for(const m of desktopGround)for(let i=0;i<m.positions.length;i+=3){bounds.minX=Math.min(bounds.minX,m.positions[i]);bounds.maxX=Math.max(bounds.maxX,m.positions[i]);bounds.minZ=Math.min(bounds.minZ,m.positions[i+2]);bounds.maxZ=Math.max(bounds.maxZ,m.positions[i+2]);}
  const size=2048,surface=rasterGround(desktopGround,bounds,size);
  const metadata=JSON.parse(await readFile(metadataPath,'utf8')),sourceBounds=JSON.parse(await readFile(boundsPath,'utf8'));
  const ids=new Set(metadata.meshes.flatMap((m:Json,i:number)=>m.name?.startsWith('S_Grass_Clumps_')&&m.primitives.some((p:Json)=>metadata.materials[p.material]?.name?.includes('Grass_Clumps'))?[i]:[]));
  const placements=sourceBounds.nodeBoxes.filter((e:Json)=>ids.has(e.mesh));
  if(!placements.length)throw new Error('No verified source Grass_Clumps placements.');
  const sites=placements.map((e:Json)=>({origin:e.origin,footprintRadius:Math.hypot(e.max[0]-e.min[0],e.max[2]-e.min[2])/2}));
  const density=rasterSourceGrass(sites,surface,bounds),pixels=Buffer.alloc(size*size*4);
  let vegetationPixels=0,densitySum=0;
  for(let z=0;z<size;z++)for(let x=0;x<size;x++){
    const i=z*size+x,y=surface.heights[i],nx=surface.normals[i*3],ny=surface.normals[i*3+1],nz=surface.normals[i*3+2];
    if(Number.isFinite(y)){
      const slope=ny>0?Math.hypot(nx,nz)/ny:1e6;
      const color=groundAlbedo(bounds.minX+(x+.5)/size*(bounds.maxX-bounds.minX),y,bounds.minZ+(z+.5)/size*(bounds.maxZ-bounds.minZ),slope,density[i]);
      pixels[i*4]=color[0];pixels[i*4+1]=color[1];pixels[i*4+2]=color[2];
      if(density[i]>.05)vegetationPixels++;densitySum+=density[i];
    }else{pixels[i*4]=64;pixels[i*4+1]=69;pixels[i*4+2]=73;}
    pixels[i*4+3]=255;
  }
  const png=await sharp(pixels,{raw:{width:size,height:size,channels:4}}).png({compressionLevel:9,adaptiveFiltering:true}).toBuffer();
  const pngPath=resolve(outputDir,'elderbloom-ground-atlas.png');await writeFile(pngPath,png,{flag:'wx'});
  const desktopResult=await embedAtlas(desktop,desktopGround,bounds,png,resolve(outputDir,'elderbloom-village-desktop-textured.glb'));
  const questResult=await embedAtlas(quest,questGround,bounds,png,resolve(outputDir,'elderbloom-village-quest-textured.glb'));
  const atlasGpuBytes=Math.ceil(size*size*4*4/3),newUvBytes=questGround.reduce((sum,m)=>sum+m.positions.length/3*2*4,0);
  const nativeCombinedEstimate=nativeBefore.combined+atlasGpuBytes+newUvBytes;
  const report={desktop:desktopResult,quest:questResult,atlas:{file:pngPath,sha256:hash(png),bytes:png.length,width:size,height:size,bounds,coveredPixels:surface.coveredPixels,totalPixels:size*size,sourcePlantPlacements:placements.length,vegetationPixels,meanInferredDensity:densitySum/Math.max(1,surface.coveredPixels)},nativeMemory:{before:nativeBefore,atlasGpuBytes,newUvBytes,combinedEstimate:nativeCombinedEstimate,budgetBytes:64*1024*1024,withinBudget:nativeCombinedEstimate<64*1024*1024},limits:'Atlas uses actual Desktop heightfield triangles and source clump footprints. Original paint/road/water masks were unavailable. Owned 3D noise changes albedo only. World-planar projection can stretch on steep faces; no new geometry, lighting, AO, normal map or renderer. Estimate includes original target buffers conservatively; it is not a measured Quest GPU allocation or physical-headset pass.'};
  await writeFile(resolve(outputDir,'elderbloom-ground-atlas-report.json'),JSON.stringify(report,null,2),{flag:'wx'});
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length!==7){console.error('Usage: tsx scripts/bake-elderbloom-ground-texture.ts desktop-final.glb quest-final.glb source-metadata.json source-world-bounds.json existing-output-directory');process.exitCode=1;}
  else bakeGroundTexture(...process.argv.slice(2,7) as [string,string,string,string,string]).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.stack??e.message);process.exitCode=1;});
}

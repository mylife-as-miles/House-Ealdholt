// Local-only postprocess of the optimizer's compact GLB. Never run on the
// original 937 MB source. Preserves all non-landscape meshes and textures.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mat4, mat4Multiply, type Mat4 } from '../shared/legacy/environment/kernel/math';
import { bakeVillageTerrain } from '../shared/legacy/aethelgard/environment/terrain-bake';
import { sourceGrassDensity } from '../shared/legacy/aethelgard/environment/source-vegetation';

type Json = Record<string, any>;
function localMatrix(node: Json): Mat4 {
  if (node.matrix) return new Float64Array(node.matrix);
  const [x,y,z,w] = node.rotation ?? [0,0,0,1];
  const [sx,sy,sz] = node.scale ?? [1,1,1], [tx,ty,tz] = node.translation ?? [0,0,0];
  return new Float64Array([
    (1-2*y*y-2*z*z)*sx, (2*x*y+2*z*w)*sx, (2*x*z-2*y*w)*sx, 0,
    (2*x*y-2*z*w)*sy, (1-2*x*x-2*z*z)*sy, (2*y*z+2*x*w)*sy, 0,
    (2*x*z+2*y*w)*sz, (2*y*z-2*x*w)*sz, (1-2*x*x-2*y*y)*sz, 0,
    tx,ty,tz,1,
  ]);
}

export async function bakeElderbloomTerrain(inputPath: string, outputPath: string, sourceGrass?: { metadata:string; worldBounds:string }) {
  if (resolve(inputPath) === resolve(outputPath)) throw new Error('Use a separate output path; source bytes are preserved.');
  if ((await stat(inputPath)).size > 128*1024*1024) throw new Error('Use the optimized crop, not the large source GLB.');
  const bytes = await readFile(inputPath);
  if (bytes.readUInt32LE(0)!==0x46546c67 || bytes.readUInt32LE(4)!==2 || bytes.readUInt32LE(8)!==bytes.length) throw new Error('Invalid GLB header.');
  let gltf: Json | undefined, binary: Buffer | undefined;
  for (let at=12; at<bytes.length;) {
    const size=bytes.readUInt32LE(at), kind=bytes.readUInt32LE(at+4);
    if (at+8+size>bytes.length) throw new Error('Truncated GLB chunk.');
    if (kind===0x4e4f534a) gltf=JSON.parse(bytes.subarray(at+8,at+8+size).toString('utf8'));
    else if(kind===0x004e4942) binary=bytes.subarray(at+8,at+8+size);
    else throw new Error('Unknown GLB chunk would be lost; refusing.');
    at+=size+8;
  }
  if(!gltf || !binary || gltf.buffers?.length!==1 || gltf.buffers[0].uri) throw new Error('Expected one embedded GLB buffer.');
  let grass:ReturnType<typeof sourceGrassDensity>|undefined, sourcePlantPlacements=0;
  if(sourceGrass) {
    const metadata=JSON.parse(await readFile(sourceGrass.metadata,'utf8'));
    const bounds=JSON.parse(await readFile(sourceGrass.worldBounds,'utf8'));
    const ids=new Set(metadata.meshes.flatMap((mesh:Json,index:number)=>mesh.name?.startsWith('S_Grass_Clumps_') && mesh.primitives.some((p:Json)=>metadata.materials[p.material]?.name?.includes('Grass_Clumps'))?[index]:[]));
    const placements=bounds.nodeBoxes.filter((entry:Json)=>ids.has(entry.mesh));
    if(!placements.length) throw new Error('No verified source Grass_Clumps placements found; refusing an implied vegetation bake.');
    sourcePlantPlacements=placements.length;
    grass=sourceGrassDensity(placements.map((entry:Json)=>({origin:entry.origin,footprintRadius:Math.hypot(entry.max[0]-entry.min[0],entry.max[2]-entry.min[2])/2})));
  }
  const world = new Map<number,Mat4>();
  function walk(index:number,parent:Mat4) {
    if(world.has(index)) throw new Error('Scene node has multiple parents.');
    const node=gltf!.nodes[index], transform=mat4Multiply(mat4(),parent,localMatrix(node));
    world.set(index,transform);
    for(const child of node.children??[]) walk(child,transform);
  }
  for(const root of gltf.scenes[gltf.scene??0].nodes??[]) walk(root,mat4());
  function normalsFor(index:number):Float32Array {
    const a=gltf!.accessors[index], v=gltf!.bufferViews[a?.bufferView];
    if(!a || !v || a.componentType!==5126 || a.type!=='VEC3' || a.sparse || v.buffer!==0) throw new Error('Expected dense float VEC3 attributes from the crop.');
    const stride=v.byteStride??12, start=(v.byteOffset??0)+(a.byteOffset??0);
    if(!Number.isSafeInteger(a.count)||a.count<=0||stride<12||start+stride*(a.count-1)+12>(v.byteOffset??0)+v.byteLength) throw new Error('Invalid normal accessor range.');
    const source=new DataView(binary!.buffer,binary!.byteOffset,binary!.byteLength), result=new Float32Array(a.count*3);
    for(let i=0;i<a.count;i++) for(let c=0;c<3;c++) result[i*3+c]=source.getFloat32(start+i*stride+c*4,true);
    return result;
  }
  const chunks:Buffer[]=[binary], processed=new Map<number,string>();
  let length=binary.length, vertices=0, weightedRoughness=0, primitives=0, densityTotal=0, vegetatedVertices=0;
  const repairMaterial=gltf.materials.length;
  for(const [nodeIndex,transform] of world) {
    const node=gltf.nodes[nodeIndex], mesh=gltf.meshes[node.mesh];
    if(!mesh || !/^LandscapeComponent_\d+$/.test(mesh.name??'')) continue;
    const key=Array.from(transform).join(',');
    if(processed.has(node.mesh)) {
      if(processed.get(node.mesh)!==key) throw new Error('Shared terrain has different transforms; clone it before baking.');
      continue;
    }
    processed.set(node.mesh,key);
    for(const primitive of mesh.primitives) {
      const material=gltf.materials[primitive.material];
      const unpaintedGround = material?.name==='LAndscapepaint' || material?.name==='Elderbloom_Ground_MaterialReview';
      if(!unpaintedGround || material.pbrMetallicRoughness?.baseColorTexture || primitive.attributes.COLOR_0!==undefined) throw new Error('Terrain has existing surface treatment; refusing to overwrite it.');
      const baked=bakeVillageTerrain(normalsFor(primitive.attributes.NORMAL),transform,undefined,grass?{positions:normalsFor(primitive.attributes.POSITION),densityAt:grass.at}:undefined);
      if(gltf.accessors[primitive.attributes.POSITION].count!==baked.vertices) throw new Error('Position/normal count mismatch.');
      const colorBytes=Buffer.from(baked.colors.buffer), viewIndex=gltf.bufferViews.length;
      gltf.bufferViews.push({buffer:0,byteOffset:length,byteLength:colorBytes.length,target:34962});
      primitive.attributes.COLOR_0=gltf.accessors.length;
      gltf.accessors.push({bufferView:viewIndex,componentType:5126,count:baked.vertices,type:'VEC3'});
      primitive.material=repairMaterial;
      chunks.push(colorBytes);length+=colorBytes.length;
      vertices+=baked.vertices;weightedRoughness+=baked.meanRoughness*baked.vertices;primitives++;
      densityTotal+=baked.meanVegetationDensity*baked.vertices;vegetatedVertices+=baked.vegetatedVertices;
    }
  }
  if(!primitives) throw new Error('No untreated LandscapeComponent terrain found.');
  const fieldPolicy=grass?'Measured world-normal slope and density inferred from source Grass_Clumps footprint/base placements only; moisture/water/shore zero. Not a recovered road/paint mask.':'Measured world-normal slope only; vegetation/moisture/water/shore masks zero. Existing textured non-terrain retained.';
  gltf.materials.push({name:grass?'Crownfall_LAAS_SourceGrassGround_Review':'Crownfall_LAAS_DryGround_Review',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:weightedRoughness/vertices},extras:{crownfallTerrainRepair:fieldPolicy}});
  gltf.buffers[0].byteLength=length;
  const json=Buffer.from(JSON.stringify(gltf)), padding=(4-json.length%4)%4;
  const jsonChunk=Buffer.concat([json,Buffer.alloc(padding,0x20)]), binChunk=Buffer.concat(chunks);
  const output=Buffer.alloc(12+8+jsonChunk.length+8+binChunk.length);
  output.writeUInt32LE(0x46546c67,0);output.writeUInt32LE(2,4);output.writeUInt32LE(output.length,8);
  output.writeUInt32LE(jsonChunk.length,12);output.writeUInt32LE(0x4e4f534a,16);jsonChunk.copy(output,20);
  const binAt=20+jsonChunk.length;output.writeUInt32LE(binChunk.length,binAt);output.writeUInt32LE(0x004e4942,binAt+4);binChunk.copy(output,binAt+8);
  await writeFile(outputPath,output,{flag:'wx'});
  return {input:resolve(inputPath),output:resolve(outputPath),bytes:output.length,terrainMeshes:processed.size,terrainPrimitives:primitives,terrainVertices:vertices,meanRoughness:weightedRoughness/vertices,sourcePlantPlacements,uniquePlantSites:grass?.sites??0,vegetatedVertices,meanVegetationDensity:densityTotal/vertices,fieldPolicy};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(!process.argv[2]||!process.argv[3] || Boolean(process.argv[4])!==Boolean(process.argv[5])) {console.error('Usage: tsx scripts/bake-elderbloom-terrain.ts crop.glb separate-ground.glb [source-metadata.json source-world-bounds.json]');process.exitCode=1;}
  else bakeElderbloomTerrain(process.argv[2],process.argv[3],process.argv[4]?{metadata:process.argv[4],worldBounds:process.argv[5]}:undefined).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}

// Local-only PBR microdetail for our reconstructed Elderbloom ground. This does
// not recover the missing Unreal landscape paint. No runtime or source edits.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mat4, mat4Multiply, type Mat4 } from '../shared/legacy/environment/kernel/math';

type Json = Record<string, any>;
type Axis = 'x' | 'y' | 'z';
interface Glb { json: Json; binary: Buffer; bytes: number }
interface Ground { mesh: Json; world: Mat4 }
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const textureDirectory = join(repository, 'main game/public/assets/legacy/environment/textures');
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

async function readGlb(path: string): Promise<Glb> {
  if ((await stat(path)).size > 256 * 1024 * 1024) throw new Error('Use an optimized derivative smaller than256MiB, never the original GLB.');
  const bytes = await readFile(path);
  if (bytes.length < 28 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Expected GLB2 JSON+BIN.');
  const jsonLength = bytes.readUInt32LE(12), binaryHeader = 20 + jsonLength;
  if (binaryHeader + 8 > bytes.length || bytes.readUInt32LE(binaryHeader + 4) !== 0x004e4942 || binaryHeader + 8 + bytes.readUInt32LE(binaryHeader) !== bytes.length) throw new Error('Invalid binary chunk.');
  return { json: JSON.parse(bytes.subarray(20, binaryHeader).toString('utf8')), binary: bytes.subarray(binaryHeader + 8), bytes: bytes.length };
}

function local(node: Json): Mat4 {
  if (node.matrix) return new Float64Array(node.matrix);
  const [x,y,z,w] = node.rotation ?? [0,0,0,1], [a,b,c] = node.scale ?? [1,1,1], [tx,ty,tz] = node.translation ?? [0,0,0];
  return new Float64Array([(1-2*y*y-2*z*z)*a,(2*x*y+2*z*w)*a,(2*x*z-2*y*w)*a,0,
    (2*x*y-2*z*w)*b,(1-2*x*x-2*z*z)*b,(2*y*z+2*x*w)*b,0,
    (2*x*z+2*y*w)*c,(2*y*z-2*x*w)*c,(1-2*x*x-2*y*y)*c,0,tx,ty,tz,1]);
}

function readAccessor(g: Glb, index: number, width: number): Float32Array | Uint32Array {
  const accessor = g.json.accessors[index], view = g.json.bufferViews[accessor?.bufferView];
  if (!accessor || !view || view.buffer !== 0 || accessor.sparse || !Number.isSafeInteger(accessor.count) || accessor.count < 1) throw new Error('Expected a dense bounded accessor.');
  const component = accessor.componentType, element = component === 5126 || component === 5125 ? 4 : component === 5123 ? 2 : component === 5121 ? 1 : 0;
  if (!element || width > 1 && component !== 5126 || (width > 1 ? accessor.type !== `VEC${width}` : accessor.type !== 'SCALAR')) throw new Error('Expected float vectors or unsigned indices.');
  const stride = view.byteStride ?? width * element, offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  if (stride < width * element || offset + stride * (accessor.count - 1) + width * element > (view.byteOffset ?? 0) + view.byteLength || (view.byteOffset ?? 0) + view.byteLength > g.binary.length) throw new Error('Accessor exceeds its buffer view.');
  const data = new DataView(g.binary.buffer, g.binary.byteOffset, g.binary.byteLength);
  const output = width === 1 ? new Uint32Array(accessor.count) : new Float32Array(accessor.count * width);
  for (let i = 0; i < accessor.count; i++) for (let k = 0; k < width; k++) {
    const at = offset + i * stride + k * element;
    output[i * width + k] = component === 5126 ? data.getFloat32(at, true) : element === 4 ? data.getUint32(at, true) : element === 2 ? data.getUint16(at, true) : data.getUint8(at);
  }
  return output;
}

function groundMeshes(g: Glb): Ground[] {
  const result: Ground[] = [], seen = new Set<number>();
  function walk(index: number, parent: Mat4) {
    const node = g.json.nodes[index], world = mat4Multiply(mat4(), parent, local(node)), mesh = g.json.meshes[node.mesh];
    if (mesh && /^LandscapeComponent_\d+$/.test(mesh.name ?? '')) {
      if (seen.has(node.mesh)) throw new Error('Expected uniquely placed reconstructed ground meshes.');
      seen.add(node.mesh);
      for (const primitive of mesh.primitives) {
        const material = g.json.materials[primitive.material];
        if (!material?.name?.startsWith('Crownfall_LAAS_') || !material.extras?.crownfallTerrainRepair || !material.pbrMetallicRoughness?.baseColorTexture || primitive.attributes.TEXCOORD_1 === undefined) throw new Error('Bake the reconstructed ground atlas first.');
        if (material.extras.crownfallGroundDetail || material.normalTexture || material.pbrMetallicRoughness.metallicRoughnessTexture) throw new Error('Ground already has detail maps; do not overwrite authored treatment.');
        if ((primitive.mode ?? 4) !== 4 || primitive.attributes.TANGENT !== undefined) throw new Error('Expected triangle ground with derivative tangents.');
      }
      result.push({ mesh, world });
    }
    for (const child of node.children ?? []) walk(child, world);
  }
  for (const root of g.json.scenes[g.json.scene ?? 0].nodes ?? []) walk(root, mat4());
  if (!result.length) throw new Error('No reconstructed landscape found.');
  return result;
}

/** Bounded dominant-axis box projection avoids stretching a world-XZ map up
 * cliffs. It is deliberately not advertised as smoothly blended triplanar. */
export function projectGroundDetail(position: readonly number[], axis: Axis, tileMetres: number): [number, number] {
  if (!Number.isFinite(tileMetres) || tileMetres <= 0) throw new Error('Expected a positive tile size.');
  return axis === 'x' ? [position[2] / tileMetres, position[1] / tileMetres]
    : axis === 'z' ? [position[0] / tileMetres, position[1] / tileMetres]
    : [position[0] / tileMetres, -position[2] / tileMetres];
}

export async function bakeElderbloomGroundDetail(inputPath: string, outputPath: string) {
  if (resolve(inputPath) === resolve(outputPath)) throw new Error('Use a separate output; source and earlier derivatives stay unchanged.');
  const g = await readGlb(inputPath), j = g.json, ground = groundMeshes(g);
  const originalMaterials = JSON.stringify(j.materials), originalBinaryHash = sha256(g.binary);
  const nonGround = j.meshes.filter((mesh: Json) => !/^LandscapeComponent_\d+$/.test(mesh.name ?? '')).map((mesh: Json) => JSON.stringify(mesh));
  const uvChannel = [2,3].find(channel => ground.every(({ mesh }) => mesh.primitives.every((primitive: Json) => primitive.attributes[`TEXCOORD_${channel}`] === undefined)));
  if (uvChannel === undefined) throw new Error('No unused supported UV channel for isolated ground microdetail.');
  const chunks: Buffer[] = [g.binary]; let length = g.binary.length, appendedGeometry = 0;
  function append(bytes: Buffer, target?: number): number {
    const padding = (4 - length % 4) % 4;
    if (padding) { chunks.push(Buffer.alloc(padding)); length += padding; }
    const index = j.bufferViews.length;
    j.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes); length += bytes.length;
    if (target) appendedGeometry += bytes.length;
    return index;
  }
  const sharp = createRequire(new URL('../package.json', import.meta.url))('sharp');
  const manifest = JSON.parse(await readFile(join(textureDirectory, 'manifest.json'), 'utf8'));
  if (manifest.provenance !== 'Original procedural textures generated from shared/legacy/environment/textures (no external images).') throw new Error('Unrecognized source-map provenance.');
  j.images ??= []; j.textures ??= []; j.samplers ??= [];
  const sampler = j.samplers.length;
  j.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });
  const mapReports: Json[] = [], mapIndices: Record<string, number> = {};
  let mapGpuBytes = 0;
  for (const kind of ['earth','rock']) for (const map of ['normal','orm']) {
    const source = manifest.sets[kind]?.files[`${map}_512`];
    if (!source || source.size !== 512) throw new Error('Expected an original512px procedural map.');
    const sourceBytes = await readFile(join(textureDirectory, source.file));
    if (sha256(sourceBytes) !== source.sha256) throw new Error(`Map hash differs from source manifest: ${source.file}`);
    const png = await sharp(sourceBytes).png({ compressionLevel: 9 }).toBuffer();
    const metadata = await sharp(png).metadata();
    if (metadata.width !== 512 || metadata.height !== 512) throw new Error('Unexpected map dimensions.');
    const image = j.images.length; j.images.push({ name: `Crownfall_GroundDetail_${kind}_${map}`, bufferView: append(png), mimeType: 'image/png' });
    const texture = j.textures.length; j.textures.push({ source: image, sampler }); mapIndices[`${kind}-${map}`] = texture;
    mapGpuBytes += Math.ceil(512 * 512 * 4 * 4 / 3);
    mapReports.push({ kind, map, sourceFile: source.file, sourceSha256: source.sha256, embeddedSha256: sha256(png), bytes: png.length, width: 512, height: 512 });
  }
  const materialCache = new Map<string, number>();
  function detailedMaterial(original: number, axis: Axis): number {
    const kind = axis === 'y' ? 'earth' : 'rock', key = `${original}:${kind}`;
    const cached = materialCache.get(key); if (cached !== undefined) return cached;
    const material = structuredClone(j.materials[original]);
    material.name += `_${kind}_Microdetail`;
    material.normalTexture = { index: mapIndices[`${kind}-normal`], texCoord: uvChannel, scale: kind === 'earth' ? .45 : .75 };
    material.pbrMetallicRoughness.metallicRoughnessTexture = { index: mapIndices[`${kind}-orm`], texCoord: uvChannel };
    material.extras.crownfallGroundDetail = { provenance: manifest.provenance, generator: manifest.generator,
      projection: 'Dominant-axis box projection, no geometry displacement; not blended triplanar', kind,
      tileMetres: manifest.sets[kind].tileMetres, uvChannel, missingUnrealLandscapeNotRecovered: true };
    const index = j.materials.length; j.materials.push(material); materialCache.set(key, index); return index;
  }
  const trianglesByAxis = { x: 0, y: 0, z: 0 };
  let triangleCount = 0, terrainPrimitivesBefore = 0, terrainPrimitivesAfter = 0;
  for (const { mesh, world } of ground) {
    const newPrimitives: Json[] = [];
    for (const primitive of mesh.primitives) {
      terrainPrimitivesBefore++;
      const positions = readAccessor(g, primitive.attributes.POSITION, 3) as Float32Array;
      const worldPositions = new Float64Array(positions.length);
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i], y = positions[i+1], z = positions[i+2];
        worldPositions[i] = world[0]*x + world[4]*y + world[8]*z + world[12];
        worldPositions[i+1] = world[1]*x + world[5]*y + world[9]*z + world[13];
        worldPositions[i+2] = world[2]*x + world[6]*y + world[10]*z + world[14];
        if (![worldPositions[i],worldPositions[i+1],worldPositions[i+2]].every(Number.isFinite)) throw new Error('Nonfinite terrain transform.');
      }
      const indices = primitive.indices === undefined ? Uint32Array.from({ length: positions.length / 3 }, (_,i) => i) : readAccessor(g, primitive.indices, 1) as Uint32Array;
      if (indices.length % 3 !== 0) throw new Error('Incomplete terrain triangle.');
      const groups: Record<Axis, number[]> = { x: [], y: [], z: [] };
      for (let i = 0; i < indices.length; i += 3) {
        const [a,b,c] = [indices[i]*3,indices[i+1]*3,indices[i+2]*3];
        if (Math.max(a,b,c) >= positions.length) throw new Error('Terrain index exceeds positions.');
        const ax=worldPositions[b]-worldPositions[a], ay=worldPositions[b+1]-worldPositions[a+1], az=worldPositions[b+2]-worldPositions[a+2];
        const bx=worldPositions[c]-worldPositions[a], by=worldPositions[c+1]-worldPositions[a+1], bz=worldPositions[c+2]-worldPositions[a+2];
        const nx=Math.abs(ay*bz-az*by), ny=Math.abs(az*bx-ax*bz), nz=Math.abs(ax*by-ay*bx);
        const axis: Axis = ny >= nx && ny >= nz ? 'y' : nx >= nz ? 'x' : 'z';
        groups[axis].push(indices[i],indices[i+1],indices[i+2]); trianglesByAxis[axis]++; triangleCount++;
      }
      for (const axis of ['x','y','z'] as const) {
        if (!groups[axis].length) continue;
        const kind = axis === 'y' ? 'earth' : 'rock', tileMetres = manifest.sets[kind].tileMetres;
        const uv = new Float32Array(positions.length / 3 * 2);
        for (let i = 0; i < worldPositions.length; i += 3) {
          const pair = projectGroundDetail([worldPositions[i],worldPositions[i+1],worldPositions[i+2]], axis, tileMetres);
          uv[i/3*2] = pair[0]; uv[i/3*2+1] = pair[1];
        }
        const uvIndex = j.accessors.length;
        j.accessors.push({ bufferView: append(Buffer.from(uv.buffer),34962), componentType: 5126, count: uv.length/2, type: 'VEC2' });
        const ix = Uint32Array.from(groups[axis]), indexAccessor = j.accessors.length;
        j.accessors.push({ bufferView: append(Buffer.from(ix.buffer),34963), componentType: 5125, count: ix.length, type: 'SCALAR' });
        newPrimitives.push({ ...primitive, attributes: { ...primitive.attributes, [`TEXCOORD_${uvChannel}`]: uvIndex }, indices: indexAccessor,
          material: detailedMaterial(primitive.material, axis) });
      }
    }
    mesh.primitives = newPrimitives; terrainPrimitivesAfter += newPrimitives.length;
  }
  const originalMaterialCount = JSON.parse(originalMaterials).length;
  if (JSON.stringify(j.materials.slice(0,originalMaterialCount)) !== originalMaterials) throw new Error('Original materials changed.');
  const afterNonGround = j.meshes.filter((mesh: Json) => !/^LandscapeComponent_\d+$/.test(mesh.name ?? '')).map((mesh: Json) => JSON.stringify(mesh));
  if (JSON.stringify(nonGround) !== JSON.stringify(afterNonGround)) throw new Error('Non-ground meshes changed.');
  const padding=(4-length%4)%4; if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}
  j.buffers[0].byteLength = length;
  let json=Buffer.from(JSON.stringify(j)); json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
  const binary=Buffer.concat(chunks);
  if (sha256(binary.subarray(0,g.binary.length)) !== originalBinaryHash) throw new Error('Original binary prefix changed.');
  const output=Buffer.alloc(28+json.length+binary.length);
  output.writeUInt32LE(0x46546c67,0);output.writeUInt32LE(2,4);output.writeUInt32LE(output.length,8);
  output.writeUInt32LE(json.length,12);output.writeUInt32LE(0x4e4f534a,16);json.copy(output,20);
  const at=20+json.length;output.writeUInt32LE(binary.length,at);output.writeUInt32LE(0x004e4942,at+4);binary.copy(output,at+8);
  await writeFile(outputPath,output,{flag:'wx'});
  const report = { input: resolve(inputPath), output: resolve(outputPath), inputBytes: g.bytes, outputBytes: output.length, sha256: sha256(output),
    sourceAndEarlierDerivativeUnchanged: true, originalBinaryPrefixPreserved: true, allOriginalMaterialsPreserved: true, nonGroundMeshesPreserved: true,
    terrainMeshes: ground.length, terrainPrimitivesBefore, terrainPrimitivesAfter, terrainTriangles: triangleCount, trianglesByAxis,
    uvChannel, appendedGeometryBytes: appendedGeometry, additionalTextureBytesWithMips: mapGpuBytes,
    addedGpuBufferAndTextureBytesEstimate: appendedGeometry + mapGpuBytes, maps: mapReports,
    provenance: manifest.provenance, limits: 'Generated earth/rock micro-normal and roughness maps only. Original atlas/albedo, masks, positions, normals, source UVs and non-ground assets remain unchanged. Dominant-axis projection can show axis/material seams; no displacement or blended triplanar. Unreal landscape paint is not recovered. Texture/buffer estimates are metadata, not physical Quest allocations or performance.' };
  await writeFile(outputPath+'.ground-detail.json',JSON.stringify(report,null,2),{flag:'wx'});
  return report;
}

if(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.length!==4){console.error('Usage: tsx scripts/bake-elderbloom-ground-detail.ts atlas-input.glb separate-detail-output.glb');process.exitCode=1;}
  else bakeElderbloomGroundDetail(process.argv[2],process.argv[3]).then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(error.stack??error.message);process.exitCode=1;});
}

// Read-only GLB intake. Reads the JSON chunk rather than loading a large model
// into memory. It neither executes asset extras nor downloads external resources.
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function readExactly(handle, size, position) {
  const bytes = Buffer.alloc(size);
  let read = 0;
  while (read < size) {
    const result = await handle.read(bytes, read, size - read, position + read);
    if (!result.bytesRead) throw new Error('The GLB is truncated.');
    read += result.bytesRead;
  }
  return bytes;
}

export async function inspectVillageGlb(path) {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    const header = await readExactly(handle, 20, 0);
    if (header.readUInt32LE(0) !== 0x46546c67 || header.readUInt32LE(4) !== 2) throw new Error('Expected a GLB version2 file.');
    if (header.readUInt32LE(8) !== stat.size) throw new Error('Declared GLB length does not match the file.');
    const jsonBytes = header.readUInt32LE(12);
    if (header.readUInt32LE(16) !== 0x4e4f534a || jsonBytes > 64 * 1024 * 1024 || 20 + jsonBytes > stat.size) throw new Error('Invalid or oversized GLB JSON chunk.');
    const gltf = JSON.parse((await readExactly(handle, jsonBytes, 20)).toString('utf8'));
    if (gltf.asset?.version !== '2.0') throw new Error('Expected glTF2.0 asset metadata.');
    const meshes = gltf.meshes ?? [], nodes = gltf.nodes ?? [], materials = gltf.materials ?? [], accessors = gltf.accessors ?? [];
    const materialReview = [], trianglesByMesh = [];
    let primitives = 0, missingNormals = 0;
    for (const [meshIndex, mesh] of meshes.entries()) {
      let triangles = 0;
      for (const [primitiveIndex, primitive] of (mesh.primitives ?? []).entries()) {
        primitives++;
        const count = accessors[primitive.indices ?? primitive.attributes?.POSITION]?.count;
        if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid accessor count in mesh${meshIndex}/primitive${primitiveIndex}.`);
        const mode = primitive.mode ?? 4;
        if (mode === 4) {
          if (count % 3 !== 0) throw new Error('Triangle-list accessor count must be divisible by3.');
          triangles += count / 3;
        } else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
        if (primitive.attributes?.NORMAL === undefined) missingNormals++;
        const material = materials[primitive.material];
        const baseMap = material?.pbrMetallicRoughness?.baseColorTexture;
        const reason = material === undefined ? 'No assigned material.' : baseMap === undefined
          ? 'No base-colour texture; may be intentional flat colour, requires visual review.'
          : primitive.attributes?.[`TEXCOORD_${baseMap.texCoord ?? 0}`] === undefined ? 'Base-colour texture references a missing UV set.' : null;
        if (reason) materialReview.push({ meshIndex, primitiveIndex, materialIndex: primitive.material ?? null, reason });
      }
      trianglesByMesh.push(triangles);
    }
    const imageBytes = (gltf.images ?? []).reduce((sum, image) => sum + (gltf.bufferViews?.[image.bufferView]?.byteLength ?? 0), 0);
    function instancesOf(node) {
      const extension = node.extensions?.EXT_mesh_gpu_instancing;
      if (extension === undefined) return 1;
      const ids = Object.values(extension.attributes ?? {});
      const counts = ids.map(index => accessors[index]?.count);
      if (!counts.length || counts.some(count => !Number.isSafeInteger(count) || count < 1 || count !== counts[0])) throw new Error('Invalid GPU instance accessor counts.');
      return counts[0];
    }
    const meshNodes = nodes.filter(node => node.mesh !== undefined);
    for (const node of meshNodes) if (!meshes[node.mesh]) throw new Error('Node references a missing mesh.');
    return {
      path: resolve(path), bytes: stat.size, jsonBytes,
      counts: { scenes: gltf.scenes?.length ?? 0, nodes: nodes.length, meshes: meshes.length, primitives, materials: materials.length,
        textures: gltf.textures?.length ?? 0, images: gltf.images?.length ?? 0, animations: gltf.animations?.length ?? 0, skins: gltf.skins?.length ?? 0,
        uniqueMeshTriangles: trianglesByMesh.reduce((sum, count) => sum + count, 0),
        meshInstances: meshNodes.reduce((sum, node) => sum + instancesOf(node), 0),
        gpuInstancedNodes: meshNodes.filter(node => node.extensions?.EXT_mesh_gpu_instancing !== undefined).length,
        allNodeMeshTriangles: meshNodes.reduce((sum, node) => sum + trianglesByMesh[node.mesh] * instancesOf(node), 0) },
      embeddedImageBytes: imageBytes, externalResourceCount: [...(gltf.buffers ?? []), ...(gltf.images ?? [])].filter(item => typeof item.uri === 'string' && !item.uri.startsWith('data:')).length,
      requiredExtensions: gltf.extensionsRequired ?? [], primitivesMissingNormals: missingNormals, materialReview,
      limits: 'Metadata only: all-node totals include inactive scenes/LODs. No decoded texture sizes, visible draw counts, terrain identification, licence verification or Quest performance claim.',
    };
  } finally { await handle.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) { console.error('Usage: node scripts/inspect-village-glb.mjs /path/to/original.glb'); process.exitCode = 1; }
  else try { console.log(JSON.stringify(await inspectVillageGlb(process.argv[2]), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}

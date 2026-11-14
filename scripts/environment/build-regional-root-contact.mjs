// Read the existing exported GLBs; never rewrite meshes, maps or materials.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function readRegionalWoodRoots(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw Error('Root contacts require the exported glTF2 GLB.');
  const jsonLength = bytes.readUInt32LE(12), json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binary = 28 + jsonLength, result = new Map();
  for (const root of json.scenes[json.scene ?? 0].nodes) {
    const group = json.nodes[root];
    if (!['tree', 'shrub'].includes(group.extras?.crownfallElderbloom?.kind)) continue;
    if (group.matrix || group.translation || group.rotation || group.scale) throw Error('Root metadata needs a reviewed prototype group frame.');
    const points = [];
    for (const child of group.children ?? []) {
      const node = json.nodes[child]; if (!node.name?.endsWith(' bark') || node.mesh === undefined) continue;
      if (node.translation || node.rotation || node.scale) throw Error('Root metadata needs the exported matrix frame.');
      const m = node.matrix ?? [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
      if (m.length !== 16 || !m.every(Number.isFinite)) throw Error('Invalid root frame.');
      for (const primitive of json.meshes[node.mesh].primitives) {
        const accessor = json.accessors[primitive.attributes.POSITION], view = json.bufferViews[accessor.bufferView];
        if (accessor.type !== 'VEC3' || accessor.componentType !== 5126 || accessor.sparse || view.buffer !== 0) throw Error('Root metadata requires ordinary float positions.');
        const offset = binary + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), stride = view.byteStride ?? 12;
        for (let i = 0; i < accessor.count; i++) {
          const at = offset + i * stride, x = bytes.readFloatLE(at), y = bytes.readFloatLE(at + 4), z = bytes.readFloatLE(at + 8);
          const point = [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];
          if (!point.every(Number.isFinite)) throw Error('Invalid wood-root vertex.'); points.push(point);
        }
      }
    }
    if (!points.length) throw Error('Missing wood-only root: ' + group.name);
    const baseY = points.reduce((y, p) => Math.min(y, p[1]), Infinity);
    result.set(group.name, { baseY, points: points.filter(p => p[1] <= baseY + .03) });
  }
  if (result.size !== 15) throw Error('Root metadata must cover every regional prototype.');
  return result;
}

export function combineRegionalRootContacts(profiles) {
  const result = {};
  for (const id of profiles[0].keys()) {
    const roots = profiles.map(profile => profile.get(id));
    if (roots.some(root => !root)) throw Error('Missing matching root profile: ' + id);
    const merged = new Map();
    for (const root of roots) for (const p of root.points) {
      const key = p[0].toFixed(8) + ':' + p[2].toFixed(8), previous = merged.get(key);
      // A common placement must cover the higher of coincident Desktop/Quest
      // foot vertices, so a coarser asset cannot float after an LOD handoff.
      if (!previous || p[1] > previous[1]) merged.set(key, p);
    }
    const sorted = [...merged.values()].sort((a,b) => a[0]-b[0] || a[2]-b[2]);
    const cross = (a,b,c) => (b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
    const lower = [], upper = [];
    for (const p of sorted) { while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
    for (const p of [...sorted].reverse()) { while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
    const points = [...lower.slice(0,-1), ...upper.slice(0,-1)];
    if (points.length < 3 || points.length > 64) throw Error('Unbounded or empty root footprint: ' + id);
    result[id] = { baseY: Math.min(...roots.map(root => root.baseY)), radius: Math.max(...points.map(p => Math.hypot(p[0],p[2]))), points };
  }
  return result;
}

export async function buildRegionalRootContacts(directory, target) {
  const files = ['vegetation-desktop.glb','vegetation-quest.glb'], bytes = await Promise.all(files.map(file => readFile(resolve(directory,file))));
  const contacts = combineRegionalRootContacts(bytes.map(readRegionalWoodRoots));
  const hashes = Object.fromEntries(files.map((file,i) => [file,createHash('sha256').update(bytes[i]).digest('hex')]));
  await writeFile(target, '/** Wood-only root contacts measured from unchanged exported Desktop/Quest GLBs.\n * Regenerate: node scripts/environment/build-regional-root-contact.mjs */\nimport type {VegetationRootContact} from \'./vegetation-root-contact\';\nexport const REGIONAL_ROOT_CONTACT_SOURCES = '+JSON.stringify(hashes,null,2)+' as const;\nexport const REGIONAL_ROOT_CONTACTS: Readonly<Record<string,VegetationRootContact>> = '+JSON.stringify(contacts,null,2)+';\n');
  return { hashes, contacts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await buildRegionalRootContacts(process.argv[2] ?? 'main game/public/assets/legacy/environment/aethelgard/regional-v1', process.argv[3] ?? 'shared/legacy/aethelgard/environment/regional-root-contact-data.ts');
  console.log('Measured unchanged root sources:', result.hashes);
}

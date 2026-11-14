// Local, material-only repair of verified Elderbloom export fallbacks.
// Geometry, textures and all other materials remain unchanged. No publication.
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const troughSources = [890, 891, 892, 893, 894, 895];
const lakeSource = 896;
// Actual M_Water_Lake factor from the inspected source, reused for the troughs.
const lakeColour = [0.300543785, 0.351532608, 0.439657182, 1];
const equalColour = (a, b) => Array.isArray(a) && a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) < 1e-7);

export async function repairElderbloomWater(inputPath, outputPath, reportPath) {
  if (resolve(inputPath) === resolve(outputPath)) throw new Error('Use a separate output; source bytes are preserved.');
  if ((await stat(inputPath)).size > 128 * 1024 * 1024) throw new Error('Use an optimized copy, not the original GLB.');
  const bytes = await readFile(inputPath);
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid GLB header.');
  const jsonLength = bytes.readUInt32LE(12), binAt = 20 + jsonLength;
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || binAt + 8 > bytes.length || bytes.readUInt32LE(binAt + 4) !== 0x004e4942 || binAt + 8 + bytes.readUInt32LE(binAt) !== bytes.length) throw new Error('Expected exactly JSON and BIN chunks.');
  const gltf = JSON.parse(bytes.subarray(20, binAt).toString('utf8'));
  const binary = bytes.subarray(binAt + 8);
  const mapping = JSON.parse(await readFile(reportPath, 'utf8')).sourceMaterialMap;
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error('Missing verified source material map.');
  const sources = [...troughSources, lakeSource], repaired = new Map();
  for (const sourceIndex of sources) {
    const index = mapping[sourceIndex];
    if (index === undefined) continue;
    if (!Number.isSafeInteger(index) || !gltf.materials[index]) throw new Error('Invalid mapped water material.');
    const aliases = Object.entries(mapping).filter(([, mapped]) => mapped === index).map(([source]) => Number(source));
    if (aliases.some(source => !sources.includes(source))) throw new Error('Water material is shared with an unverified source; refusing a broad repair.');
    const expected = sourceIndex === lakeSource ? lakeColour : [1, 0, 1, 1];
    const original = gltf.materials[index];
    if (!equalColour(original.pbrMetallicRoughness?.baseColorFactor, expected)) throw new Error('Mapped material no longer matches the inspected water export.');
    if (repaired.has(index)) continue;
    const replacement = structuredClone(original);
    replacement.name = sourceIndex === lakeSource ? 'Crownfall_Pond_Water_Review' : 'Crownfall_Trough_Water_Review';
    replacement.pbrMetallicRoughness.metallicFactor = 0;
    if (sourceIndex !== lakeSource) {
      replacement.pbrMetallicRoughness.baseColorFactor = [...lakeColour];
      replacement.pbrMetallicRoughness.roughnessFactor = 0.3;
    }
    repaired.set(index, { sourceIndices: aliases, before: original, after: replacement });
  }
  if (!repaired.size) throw new Error('No verified water materials found.');
  for (const [index, change] of repaired) gltf.materials[index] = change.after;
  const json = Buffer.from(JSON.stringify(gltf)), padding = (4 - json.length % 4) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(padding, 0x20)]);
  const output = Buffer.alloc(28 + jsonChunk.length + binary.length);
  output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonChunk.length, 12); output.writeUInt32LE(0x4e4f534a, 16); jsonChunk.copy(output, 20);
  const at = 20 + jsonChunk.length;
  output.writeUInt32LE(binary.length, at); output.writeUInt32LE(0x004e4942, at + 4); binary.copy(output, at + 8);
  await writeFile(outputPath, output, { flag: 'wx' });
  return { input: resolve(inputPath), output: resolve(outputPath), bytes: output.length,
    repaired: [...repaired].map(([materialIndex, change]) => ({ materialIndex, sourceIndices: change.sourceIndices })),
    binarySha256: createHash('sha256').update(binary).digest('hex'),
    limitation: 'Static dielectric-water material repair only; no animated water, screen-space reflection or Quest performance claim.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2] || !process.argv[3] || !process.argv[4]) {
    console.error('Usage: node scripts/repair-elderbloom-water.mjs optimized.glb separate-output.glb optimizer-report.json');
    process.exitCode = 1;
  } else repairElderbloomWater(...process.argv.slice(2, 5)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}

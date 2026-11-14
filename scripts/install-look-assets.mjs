import { readFile, mkdir, copyFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(repo, 'shared/play/look-assets.json'), 'utf8'));
const sourceIndex = process.argv.indexOf('--source');
const source = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : null;
const destination = join(repo, 'main game/public/gameport-look');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
for (const item of manifest.assets) {
  const target = join(destination, item.path);
  try {
    const current = await readFile(target);
    if (current.length === item.bytes && digest(current) === item.sha256) continue;
  } catch { /* Install missing files from the explicitly supplied source package. */ }
  if (!source) throw new Error(`Missing or changed look asset: ${item.path}. Supply --source <game-port folder>.`);
  const parts = item.path.split('/');
  let input;
  if (parts[0] === 'look') input = join(resolve(source), ...parts);
  else if (parts[0] === 'optimized') input = join(resolve(source), 'exports_ktx2', ...(parts[1] === 'scene-01' ? [] : [parts[1]]), parts[2]);
  else input = join(repo, 'main game/node_modules/three/examples/jsm/libs', parts[0] === 'draco' ? 'draco/gltf' : 'basis', parts[1]);
  const bytes = await readFile(input);
  if (bytes.length !== item.bytes || digest(bytes) !== item.sha256) throw new Error(`Source package differs from the pinned look asset: ${item.path}`);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(input, target);
}
// The separate lightmaps are already installed by the published Gameport release installer.
for (const scene of ['scene-01', 'scene-02']) for (const part of ['arena', 'environment']) await access(join(repo, 'main game/public/gameport', scene, `${part}.exr`));
console.log(`Verified ${manifest.assets.length} look assets (${manifest.assets.reduce((n, item) => n + item.bytes, 0)} bytes) and four required lightmaps.`);

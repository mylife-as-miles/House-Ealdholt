import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const taskRoot = dirname(fileURLToPath(import.meta.url));
const repository = resolve(taskRoot, '..');
const folder = resolve(repository, 'private-assets/elderbloom');
const report = JSON.parse(await readFile(resolve(folder, 'installation.json'), 'utf8'));
if (!report.verified || report.assets.length !== 12) throw new Error('Complete verified release installation is required.');
const base = 'http://127.0.0.1:4188/';
const names = {
  desktop: 'elderbloom-village-desktop-coastal-full-woodland-candidate-v5.glb',
  quest: 'elderbloom-village-quest-coastal-pond-foliage-candidate-v2-normal16.glb',
};
const probes = {};
for (const profile of ['desktop', 'quest']) {
  const metadataName = 'ealdholt-pond-' + profile + '-balanced-r1.metadata.json';
  const metadata = JSON.parse(await readFile(resolve(folder, metadataName), 'utf8'));
  const model = report.assets.find(asset => asset.name === names[profile]);
  if ('sha256:' + metadata.modelSha256 !== model.digest || metadata.profile !== profile) throw new Error('Pond/model identity mismatch.');
  probes[profile] = {
    modelUrl: base + names[profile], modelSha256: metadata.modelSha256,
    lightingVersion: metadata.lightingVersion,
    hdrUrl: base + 'ealdholt-pond-' + profile + '-balanced-r1.hdr', metadataUrl: base + metadataName,
  };
}
const content = '# Local licensed village inputs; keep out of Git.\n'
  + 'VITE_ELDERBLOOM_PREVIEW_URL=' + base + '\n'
  + "VITE_ELDERBLOOM_POND_PROBES='" + JSON.stringify(probes) + "'\n";
for (const app of ['main game', 'main-game-vr']) {
  const file = resolve(repository, app, '.env.development.local');
  let existing; try { existing = await readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing !== undefined && existing !== content) throw new Error('Preserved existing development configuration: ' + app);
  if (existing === undefined) await writeFile(file, content, { flag: 'wx' });
  console.log('Configured the existing village route for ' + app);
}
console.log('Existing Legacy saves are untouched.');

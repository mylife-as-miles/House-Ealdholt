/** Restore pinned existing Crownfall sources to a private, external cache.
 * Usage: node scripts/chess/fetch_combat_sources.mjs --cache /absolute/private/cache
 * Does not fetch demonstration models, meshes or replacement characters. */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), index = args.indexOf('--cache');
const destination = index >= 0 ? args[index + 1] : undefined;
if (!destination || !isAbsolute(destination)) throw new Error('Supply --cache with an absolute private directory outside the repository');
const cache = resolve(destination), inside = relative(repo, cache);
if (!inside || (!inside.startsWith('..') && !isAbsolute(inside))) throw new Error('Keep original source GLBs outside the repository');
await mkdir(cache, { recursive: true });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const rows = [];
for (const key of ['wp', 'bp']) {
  const pinned = JSON.parse(await readFile(resolve(repo, 'web/src/assets/chess/combat-v1', `${key}.json`), 'utf8'));
  for (const source of pinned.sources) {
    if (!['rigged', 'idle', 'attack', 'death'].includes(source.role) || !/^[a-f0-9]{64}$/.test(source.sha256) || !Number.isSafeInteger(source.bytes)) throw new Error('Invalid pinned source');
    const url = new URL(source.url);
    if (url.protocol !== 'https:') throw new Error('Source must use HTTPS');
    const path = resolve(cache, `${key}-${source.role}.glb`);
    let bytes;
    try { bytes = await readFile(path); } catch { /* Cold cache. */ }
    if (!bytes || bytes.length !== source.bytes || digest(bytes) !== source.sha256) {
      // curl inherits the environment's configured proxy and CA trust; Node's
      // native fetch does not automatically honor those on every Node version.
      bytes = execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--max-time', '90', url.href],
        { maxBuffer: source.bytes + 1048576 });
      if (bytes.length !== source.bytes || digest(bytes) !== source.sha256) throw new Error(`${key}/${source.role}: source bytes changed; refusing rebake`);
      await writeFile(`${path}.partial`, bytes);
      await rename(`${path}.partial`, path);
    }
    rows.push({ class: key, ...source, path });
    console.log(`Verified ${key}/${source.role}: ${bytes.length} bytes`);
  }
}
const manifest = resolve(cache, 'manifest.json');
await writeFile(manifest, JSON.stringify(rows, null, 2) + '\n');
console.log(`Source manifest: ${manifest}`);

/** Restore the CC0 animation packs behind combat-v2 to a private, external cache.
 * Usage: node scripts/chess/fetch_combat_animation_sources.mjs --cache /absolute/private/cache
 *
 * The packs are free itch.io downloads (no account, no payment). itch hands out
 * short-lived signed URLs, so the pinned identity is the upload id plus the
 * archive's SHA-256 in web/src/assets/chess/combat-v2/provenance.json. Only the
 * files that manifest lists are extracted; the archive is deleted afterwards.
 * Refuses to continue if an archive or an extracted file no longer matches. */
import { readFile, writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), index = args.indexOf('--cache');
const destination = index >= 0 ? args[index + 1] : undefined;
if (!destination || !isAbsolute(destination)) throw new Error('Supply --cache with an absolute private directory outside the repository');
const cache = resolve(destination), inside = relative(repo, cache);
if (!inside || (!inside.startsWith('..') && !isAbsolute(inside))) throw new Error('Keep downloaded packs outside the repository');
const provenance = JSON.parse(await readFile(resolve(repo, 'web/src/assets/chess/combat-v2/provenance.json'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const agent = 'Mozilla/5.0 (X11; Linux x86_64) crownfall-asset-restore';
// curl inherits the environment's proxy and CA trust (see fetch_combat_sources.mjs).
const curl = (...extra) => execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--max-time', '180', '-A', agent, ...extra], { maxBuffer: 256 * 1048576 });

for (const pack of provenance.packs) {
  const wanted = pack.files;
  let complete = true;
  for (const file of wanted) {
    try { if (digest(await readFile(resolve(cache, file.path))) !== file.sha256) complete = false; } catch { complete = false; }
  }
  if (!complete) {
    if (!/^https:\/\/[a-z0-9-]+\.itch\.io\/[a-z0-9-]+\/file\/\d+$/.test(pack.download.endpoint)) throw new Error(`${pack.id}: unexpected download endpoint`);
    const work = await mkdtemp(resolve(tmpdir(), 'crownfall-cc0-')), jar = resolve(work, 'cookies.txt'), archive = resolve(work, 'pack.zip');
    try {
      curl('-c', jar, '-b', jar, '-o', resolve(work, 'page.html'), pack.storeUrl);
      const token = (await readFile(jar, 'utf8')).split('\n').map(line => line.split('\t')).find(cells => cells[5] === 'itchio_token')?.[6];
      if (!token) throw new Error(`${pack.id}: itch.io did not issue a session token`);
      const reply = JSON.parse(curl('-c', jar, '-b', jar, '-X', 'POST', '--data-urlencode', `csrf_token=${decodeURIComponent(token)}`,
        `${pack.download.endpoint}?source=game_download`).toString());
      if (typeof reply.url !== 'string' || !reply.url.startsWith('https://')) throw new Error(`${pack.id}: no download URL (a login or payment may now be required; do not create an account)`);
      curl('-o', archive, reply.url);
      const bytes = await readFile(archive);
      if (bytes.length !== pack.download.bytes || digest(bytes) !== pack.download.sha256) throw new Error(`${pack.id}: archive changed upstream; review the new version and its licence before rebaking`);
      for (const file of wanted) {
        const target = resolve(cache, file.path);
        await mkdir(dirname(target), { recursive: true });
        // -p writes the one member to stdout: nothing else from the archive touches the disk.
        const data = execFileSync('unzip', ['-p', archive, file.archivePath.replace(/[[\]]/g, '\\$&')], { maxBuffer: 256 * 1048576 });
        if (data.length !== file.bytes || digest(data) !== file.sha256) throw new Error(`${pack.id}/${file.path}: extracted bytes changed`);
        await writeFile(target, data);
      }
    } finally { await rm(work, { recursive: true, force: true }); }
  }
  console.log(`Verified ${pack.id} (${pack.licence.name}): ${wanted.length} files`);
}
console.log(`CC0 animation cache: ${cache}`);

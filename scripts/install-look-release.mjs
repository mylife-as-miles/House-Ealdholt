// Installs the Play look package (Eclipse and Violet Night: the 360-degree panoramas, depth panoramas, optimized
// arenas, extras, baked board, grading LUT and decoders) from the private GitHub release that carries it.
//
//   node scripts/install-look-release.mjs                 download, verify and install
//   node scripts/install-look-release.mjs --zip <file>    install from an archive that is already downloaded
//   node scripts/install-look-release.mjs --verify-only   check the installed files; never downloads
//
// Every file is checked against the sizes and SHA-256 digests pinned in shared/play/look-assets.json before it
// replaces anything, and the archive itself against the digest pinned below. Nothing outside
// `main game/public/gameport-look/` is written, except a lightmap that is missing from `main game/public/gameport/`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';

export const RELEASE = {
  repository: 'mylife-as-miles/Crownfall',
  tag: 'gameport-look-360-2026-11-10',
  asset: { id: 733368822, name: 'crownfall-360-panorama-arenas.zip', bytes: 278568632, sha256: 'b0c358be0eaca0883ab7aa22af617cbf5d462d6a36e6ee28e2da1d90d29dfaf4' },
};
/** The four lightmaps the look pipeline reuses; the same bytes as the gameport-2026-11-03 release. */
export const LIGHTMAPS = [
  { path: 'scene-01/arena.exr', bytes: 5603169, sha256: '540ca60beee1729c864142c01c3268b747ba54e915f61be8fdad793498f323e4' },
  { path: 'scene-01/environment.exr', bytes: 11676084, sha256: '716429d8eb965770492fd4c793179920b2eba74b63d615d623905c247fe5bb60' },
  { path: 'scene-02/arena.exr', bytes: 5641355, sha256: '60b49911ccb1de11d57b106a193ae4dbb62ff59ef793438b4546b02d38e7bc05' },
  { path: 'scene-02/environment.exr', bytes: 11671643, sha256: 'b3b687e78901db688bb0522031cdb5d1e5286bd6d797caaf0c6e8be423e38c3a' },
];
const LOOK_PREFIX = 'main game/public/gameport-look/';
const LIGHTMAP_PREFIX = 'main game/public/gameport/';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The entries of a zip archive, by name, from its central directory. Only what this package needs is read: stored
 * and deflated entries, no encryption, no zip64.
 */
export async function readZipDirectory(handle) {
  const { size } = await handle.stat();
  const tailLength = Math.min(size, 65557);
  const tail = Buffer.alloc(tailLength);
  await handle.read(tail, 0, tailLength, size - tailLength);
  let end = -1;
  for (let i = tailLength - 22; i >= 0; i -= 1) if (tail.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('Not a zip archive: no end-of-directory record.');
  const count = tail.readUInt16LE(end + 10), length = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
  if (count === 0xffff || length === 0xffffffff || offset === 0xffffffff) throw new Error('Zip64 archives are not supported.');
  if (offset + length > size) throw new Error('Zip directory lies outside the archive.');
  const directory = Buffer.alloc(length);
  await handle.read(directory, 0, length, offset);
  const entries = new Map();
  let at = 0;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > length || directory.readUInt32LE(at) !== 0x02014b50) throw new Error('Corrupt zip directory.');
    const flags = directory.readUInt16LE(at + 8), method = directory.readUInt16LE(at + 10);
    const compressed = directory.readUInt32LE(at + 20), bytes = directory.readUInt32LE(at + 24);
    const nameLength = directory.readUInt16LE(at + 28), extraLength = directory.readUInt16LE(at + 30), commentLength = directory.readUInt16LE(at + 32);
    const header = directory.readUInt32LE(at + 42);
    const name = directory.toString('utf8', at + 46, at + 46 + nameLength).replaceAll('\\', '/');
    if (compressed === 0xffffffff || bytes === 0xffffffff || header === 0xffffffff) throw new Error('Zip64 archives are not supported.');
    if (entries.has(name)) throw new Error(`Zip archive lists "${name}" twice.`);
    entries.set(name, { name, encrypted: (flags & 1) === 1, method, compressed, bytes, header });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The contents of one entry, or an error when it is not exactly `bytes` long with digest `sha256`. */
export async function readZipEntry(handle, entry, expected) {
  if (entry.encrypted) throw new Error(`Encrypted zip entry: ${entry.name}`);
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`Unsupported zip compression ${entry.method}: ${entry.name}`);
  if (entry.bytes !== expected.bytes) throw new Error(`Archive entry has the wrong size: ${entry.name}`);
  const local = Buffer.alloc(30);
  await handle.read(local, 0, 30, entry.header);
  if (local.readUInt32LE(0) !== 0x04034b50) throw new Error(`Corrupt zip entry: ${entry.name}`);
  const start = entry.header + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  const packed = Buffer.alloc(entry.compressed);
  const { bytesRead } = await handle.read(packed, 0, entry.compressed, start);
  if (bytesRead !== entry.compressed) throw new Error(`Truncated zip entry: ${entry.name}`);
  const data = entry.method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: expected.bytes });
  if (data.length !== expected.bytes || sha256(data) !== expected.sha256) throw new Error(`Archive entry differs from the pinned asset: ${entry.name}`);
  return data;
}

async function matches(file, expected) {
  try { if ((await stat(file)).size !== expected.bytes) return false; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return sha256(await readFile(file)) === expected.sha256;
}

/**
 * Installs the look assets and any missing lightmap from `archive` under `root`. A look file that is absent or
 * differs is replaced; a lightmap is only ever added, because the Gameport installer owns those. Returns what it did.
 */
export async function installFromArchive({ archive, root, assets, lightmaps = LIGHTMAPS, log = () => {} }) {
  const handle = await open(archive, 'r');
  const result = { installed: [], kept: [] };
  try {
    const entries = await readZipDirectory(handle);
    const jobs = [
      ...assets.map((item) => ({ item, entry: LOOK_PREFIX + item.path, output: join(root, LOOK_PREFIX, item.path), replace: true })),
      ...lightmaps.map((item) => ({ item, entry: LIGHTMAP_PREFIX + item.path, output: join(root, LIGHTMAP_PREFIX, item.path), replace: false })),
    ];
    for (const { item, entry: name, output, replace } of jobs) {
      const current = await matches(output, item);
      if (current === true) { result.kept.push(item.path); continue; }
      if (current === false && !replace) throw new Error(`Preserved an existing lightmap that differs from the release: ${item.path}`);
      const entry = entries.get(name);
      if (!entry) throw new Error(`The archive has no "${name}".`);
      const data = await readZipEntry(handle, entry, item);
      await mkdir(dirname(output), { recursive: true });
      const temporary = `${output}.install-${process.pid}`;
      try { await writeFile(temporary, data, { flag: 'wx' }); await rename(temporary, output); }
      catch (error) { await unlink(temporary).catch(() => {}); throw error; }
      result.installed.push(item.path);
      log(`Installed ${item.path}`);
    }
  } finally { await handle.close(); }
  return result;
}

/** True when every look asset and lightmap under `root` matches its pin; otherwise the first path that does not. */
export async function verifyInstallation({ root, assets, lightmaps = LIGHTMAPS }) {
  for (const item of assets) if (await matches(join(root, LOOK_PREFIX, item.path), item) !== true) return LOOK_PREFIX + item.path;
  for (const item of lightmaps) if (await matches(join(root, LIGHTMAP_PREFIX, item.path), item) !== true) return LIGHTMAP_PREFIX + item.path;
  return true;
}

/**
 * Credentials to try, in order: the environment's token, whatever git's credential helper already holds, and none
 * at all (a public repository, or a network that adds the credential itself).
 */
function credentials() {
  const filled = spawnSync('git', ['-c', 'credential.interactive=never', 'credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', windowsHide: true, env: { ...process.env, GCM_INTERACTIVE: 'Never' },
  });
  const held = (filled.stdout || '').split(/\r?\n/).find((line) => line.startsWith('password='))?.slice('password='.length);
  return [...new Set([process.env.GH_TOKEN, process.env.GITHUB_TOKEN, held].filter(Boolean)), null];
}

async function download(file, log) {
  const { repository, asset } = RELEASE;
  let response = null;
  for (const token of credentials()) {
    const headers = { Accept: 'application/octet-stream', 'User-Agent': 'Crownfall-look-installer', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    response = await fetch(`https://api.github.com/repos/${repository}/releases/assets/${asset.id}`, { headers, signal: AbortSignal.timeout(60 * 60 * 1000) });
    if (response.ok && response.body) break;
    await response.body?.cancel();
    if (![401, 403, 404].includes(response.status)) throw new Error(`Download failed with HTTP ${response.status}.`);
  }
  if (!response.ok || !response.body) {
    throw new Error(`Download refused with HTTP ${response.status}. The repository is private: set GH_TOKEN or GITHUB_TOKEN to a token that can read it, `
      + `or download ${asset.name} from the "${RELEASE.tag}" release in a browser and pass --zip <file>.`);
  }
  log(`Downloading ${asset.name} (${asset.bytes} bytes)`);
  const hash = createHash('sha256');
  let bytes = 0;
  const limit = new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length;
    if (bytes > asset.bytes) { done(new Error('The download is larger than the release asset.')); return; }
    hash.update(chunk); done(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(file, { flags: 'wx' }));
  if (bytes !== asset.bytes || hash.digest('hex') !== asset.sha256) throw new Error('The downloaded archive does not match the pinned release asset.');
}

async function archiveMatches(file) {
  const hash = createHash('sha256');
  const handle = await open(file, 'r');
  try { for await (const chunk of handle.createReadStream()) hash.update(chunk); } finally { await handle.close(); }
  return hash.digest('hex') === RELEASE.asset.sha256;
}

async function main() {
  const args = process.argv.slice(2);
  let zip = null, verifyOnly = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--verify-only') verifyOnly = true;
    else if (args[i] === '--zip' && args[i + 1]) zip = resolve(args[++i]);
    else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { assets } = JSON.parse(await readFile(join(root, 'shared/play/look-assets.json'), 'utf8'));
  const summary = `Verified ${assets.length} look assets (${assets.reduce((n, item) => n + item.bytes, 0)} bytes) and four required lightmaps.`;
  const missing = await verifyInstallation({ root, assets });
  if (missing === true) { console.log(summary); return; }
  if (verifyOnly) throw new Error(`Missing or changed: ${missing}. Run the installer without --verify-only.`);

  let temporary = null;
  try {
    if (zip) { if (!await archiveMatches(zip)) throw new Error(`${zip} is not the pinned "${RELEASE.tag}" archive.`); }
    else { temporary = join(tmpdir(), `crownfall-look-${process.pid}.zip`); await download(temporary, console.log); }
    await installFromArchive({ archive: zip ?? temporary, root, assets, log: console.log });
  } finally { if (temporary) await unlink(temporary).catch(() => {}); }
  const after = await verifyInstallation({ root, assets });
  if (after !== true) throw new Error(`Installation incomplete: ${after}`);
  console.log(summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();

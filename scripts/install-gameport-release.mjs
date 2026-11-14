import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const repository = 'mylife-as-miles/Crownfall';
const tag = 'gameport-2026-11-03';
const manifestSHA256 = '0e967138595080e743ac27948d161c6d7a80a6b520508a5dbef95bc20bcf2dae';
const base = `https://github.com/${repository}/releases/download/${tag}/`;
const target = resolve(dirname(fileURLToPath(import.meta.url)), '../main game/public/gameport');
const args = process.argv.slice(2);
let manifestFile, verifyOnly = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--verify-only') verifyOnly = true;
  else if (args[i] === '--manifest' && args[i + 1]) manifestFile = args[++i];
  else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
}
const digest = data => createHash('sha256').update(data).digest('hex');
// The repository is private (T-08): with GH_TOKEN or GITHUB_TOKEN set, assets come through the GitHub API, which
// accepts the token; without one, the public download address is tried and a refusal says what is missing.
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;
const agent = 'Crownfall-arena-installer';
let releaseAssets = null;
async function source(name) {
  if (!token) return { url: `${base}${encodeURIComponent(name)}`, headers: { 'User-Agent': agent } };
  releaseAssets ??= (async () => {
    const result = await fetch(`https://api.github.com/repos/${repository}/releases/tags/${tag}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': agent }, signal: AbortSignal.timeout(60 * 1000),
    });
    if (!result.ok) throw new Error(`The GitHub API refused the "${tag}" release with HTTP ${result.status}. Check that the token can read ${repository}.`);
    const release = await result.json();
    return new Map((release.assets ?? []).map(asset => [asset.name, asset.id]));
  })();
  const id = (await releaseAssets).get(name);
  if (!id) throw new Error(`The "${tag}" release has no asset named ${name}.`);
  return { url: `https://api.github.com/repos/${repository}/releases/assets/${id}`, headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream', 'User-Agent': agent } };
}
async function response(name) {
  const { url, headers } = await source(name);
  const result = await fetch(url, { headers, signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (result.ok) return result;
  await result.body?.cancel();
  if (!token && [401, 403, 404].includes(result.status)) {
    throw new Error(`HTTP ${result.status}: ${name}. The repository is private: set GH_TOKEN or GITHUB_TOKEN to a token that can read it, `
      + `or download the "${tag}" release's files in a browser, put the arena files under "main game/public/gameport/<scene>/", `
      + `and run this script with --manifest <gameport-manifest.json> --verify-only.`);
  }
  throw new Error(`HTTP ${result.status}: ${name}`);
}
const raw = manifestFile ? await readFile(manifestFile) : Buffer.from(await (await response('gameport-manifest.json')).arrayBuffer());
if (digest(raw) !== manifestSHA256) throw new Error('Release manifest checksum mismatch; installation was not changed.');
const manifest = JSON.parse(raw);
const expected = ['scene-01', 'scene-02'].flatMap(scene => ['arena', 'environment'].flatMap(part => ['glb', 'exr'].map(ext => `${scene}/${part}.${ext}`)));
if (manifest.version !== 1 || manifest.repository !== repository || manifest.tag !== tag || !Array.isArray(manifest.assets) || manifest.assets.length !== expected.length) throw new Error('Unsupported release manifest.');
for (const path of expected) {
  const records = manifest.assets.filter(asset => asset.path === path);
  const entry = records[0];
  if (records.length !== 1 || entry.asset !== path.replace('/', '-') || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 4 || entry.bytes > 2 ** 31) throw new Error(`Invalid manifest entry: ${path}`);
}
async function check(file, entry) {
  try { if ((await stat(file)).size !== entry.bytes) return false; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  const hash = createHash('sha256'); let header = Buffer.alloc(0);
  for await (const data of createReadStream(file)) { hash.update(data); if (header.length < 4) header = Buffer.concat([header, data]).subarray(0, 4); }
  const magic = entry.path.endsWith('.glb') ? Buffer.from('glTF') : Buffer.from([0x76, 0x2f, 0x31, 0x01]);
  return header.equals(magic) && hash.digest('hex') === entry.sha256;
}
for (const path of expected) {
  const entry = manifest.assets.find(asset => asset.path === path);
  const output = resolve(target, path);
  if (await check(output, entry)) { console.log(`Verified ${path}`); continue; }
  if (verifyOnly) throw new Error(`Missing or mismatched asset: ${path}. Run the installer without --verify-only.`);
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.download-${process.pid}`;
  let ownTemporary = false;
  try {
    const download = await response(entry.asset);
    let bytes = 0;
    const limit = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > entry.bytes ? new Error(`Oversized download: ${path}`) : null, chunk);
    } });
    const writer = createWriteStream(temporary, { flags: 'wx' });
    writer.once('open', () => { ownTemporary = true; });
    console.log(`Downloading ${path} (${entry.bytes} bytes)`);
    await pipeline(Readable.fromWeb(download.body), limit, writer);
    if (!await check(temporary, entry)) throw new Error(`Asset checksum/format mismatch: ${path}; existing file is unchanged.`);
    await rename(temporary, output);
    ownTemporary = false;
    console.log(`Installed ${path}`);
  } finally { if (ownTemporary) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
console.log('All eight Crownfall arena assets verified.');

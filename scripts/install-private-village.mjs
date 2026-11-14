import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const taskRoot = dirname(fileURLToPath(import.meta.url));
const destination = resolve(taskRoot, '../private-assets/elderbloom');
const expected = JSON.parse(await readFile(resolve(taskRoot, 'private-village-release.json'), 'utf8'));
const verifyOnly = process.argv.includes('--verify-only');
const credential = verifyOnly ? { stdout: '' } : spawnSync('git', ['-c', 'credential.interactive=never', 'credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', windowsHide: true,
  env: { ...process.env, GCM_INTERACTIVE: 'Never' },
});
const fields = Object.fromEntries((credential.stdout || '').trim().split(/\r?\n/).map(line => {
  const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
}));
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || fields.password;
if (!token && !verifyOnly) throw new Error('Use an authorized GitHub credential or GH_TOKEN/GITHUB_TOKEN for this private release.');
await mkdir(destination, { recursive: true });
async function digest(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return 'sha256:' + hash.digest('hex');
}
const results = [];
async function install(asset) {
  if (!/^[a-zA-Z0-9._-]+$/.test(asset.name)) throw new Error('Unsafe release filename');
  const output = resolve(destination, asset.name);
  let current; try { current = await stat(output); } catch {}
  if (current) {
    if (current.size !== asset.size || await digest(output) !== asset.digest) throw new Error('Preserved existing mismatched file: ' + asset.name);
    results.push({ name: asset.name, bytes: asset.size, digest: asset.digest, reused: true });
    console.log('VERIFIED existing ' + asset.name); return;
  }
  if (verifyOnly) throw new Error('Missing local release asset: ' + asset.name);
  const response = await fetch('https://api.github.com/repos/mylife-as-miles/Crownfall/releases/assets/' + asset.id, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/octet-stream', 'User-Agent': 'Crownfall-local-asset-recovery' },
  });
  if (!response.ok || !response.body) throw new Error('Download failed HTTP ' + response.status + ': ' + asset.name);
  const hash = createHash('sha256'); let bytes = 0;
  const limit = new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length; if (bytes > asset.size) { done(new Error('Oversized asset')); return; }
    hash.update(chunk); done(null, chunk);
  } });
  const temporary = output + '.download-' + process.pid;
  await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(temporary, { flags: 'wx' }));
  const actualDigest = 'sha256:' + hash.digest('hex');
  if (bytes !== asset.size || actualDigest !== asset.digest) throw new Error('Release integrity mismatch: ' + asset.name);
  await rename(temporary, output);
  results.push({ name: asset.name, bytes, digest: actualDigest, reused: false });
  console.log('VERIFIED ' + asset.name + ' (' + bytes + ' bytes)');
}
let next = 0;
await Promise.all(Array.from({ length: 2 }, async () => {
  while (next < expected.assets.length) await install(expected.assets[next++]);
}));
await writeFile(resolve(destination, 'installation.json'), JSON.stringify({ verified: true, tag: expected.tag, directory: destination, assets: results }, null, 2) + '\n');
console.log('READY: ' + results.length + ' release assets verified.');

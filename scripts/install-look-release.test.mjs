import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { LIGHTMAPS, RELEASE, installFromArchive, readZipDirectory, verifyInstallation } from './install-look-release.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pin = (path, data) => ({ path, bytes: data.length, sha256: sha256(data) });

/** A minimal zip: `files` is [name, data, deflate?]. */
function zip(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, data, deflate] of files) {
    const nameBytes = Buffer.from(name), packed = deflate ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(deflate ? 8 : 0, 10);
    header.writeUInt32LE(packed.length, 20); header.writeUInt32LE(data.length, 24); header.writeUInt16LE(nameBytes.length, 28); header.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed); central.push(header, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const board = Buffer.from('glTF baked board '.repeat(400)), pano = Buffer.from('panorama '.repeat(900)), lightmap = Buffer.from('lightmap '.repeat(300));
const assets = [pin('look/board/board.glb', board), pin('look/setting1_pano.exr', pano)];
const lightmaps = [pin('scene-01/arena.exr', lightmap)];
const LOOK = 'main game/public/gameport-look/', MAPS = 'main game/public/gameport/';
const goodFiles = [[LOOK + 'look/board/board.glb', board, true], [LOOK + 'look/setting1_pano.exr', pano, false], [MAPS + 'scene-01/arena.exr', lightmap, true], ['artifacts/releases/NOTICE.md', Buffer.from('notice'), false]];

async function sandbox(t, files = goodFiles) {
  const root = await mkdtemp(join(tmpdir(), 'look-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = join(root, 'package.zip');
  await writeFile(archive, zip(files));
  return { root, archive };
}
const put = async (file, data) => { await mkdir(dirname(file), { recursive: true }); await writeFile(file, data); };

test('installs every pinned look asset and a missing lightmap, and nothing else', async (t) => {
  const { root, archive } = await sandbox(t);
  assert.equal(await verifyInstallation({ root, assets, lightmaps }), LOOK + 'look/board/board.glb');
  const result = await installFromArchive({ archive, root, assets, lightmaps });
  assert.deepEqual(result, { installed: ['look/board/board.glb', 'look/setting1_pano.exr', 'scene-01/arena.exr'], kept: [] });
  assert.deepEqual(await readFile(join(root, LOOK, 'look/board/board.glb')), board);
  assert.deepEqual(await readFile(join(root, LOOK, 'look/setting1_pano.exr')), pano);
  assert.deepEqual(await readFile(join(root, MAPS, 'scene-01/arena.exr')), lightmap);
  assert.equal(await verifyInstallation({ root, assets, lightmaps }), true);
  assert.deepEqual((await readdir(root)).sort(), ['main game', 'package.zip'], 'the archive\'s other entries are not extracted');
});

test('keeps files that already match and replaces a look file that differs', async (t) => {
  const { root, archive } = await sandbox(t);
  await put(join(root, LOOK, 'look/board/board.glb'), board);
  await put(join(root, LOOK, 'look/setting1_pano.exr'), Buffer.from('an older panorama'));
  await put(join(root, MAPS, 'scene-01/arena.exr'), lightmap);
  const result = await installFromArchive({ archive, root, assets, lightmaps });
  assert.deepEqual(result, { installed: ['look/setting1_pano.exr'], kept: ['look/board/board.glb', 'scene-01/arena.exr'] });
  assert.deepEqual(await readFile(join(root, LOOK, 'look/setting1_pano.exr')), pano);
});

test('never overwrites a lightmap that differs from the release', async (t) => {
  const { root, archive } = await sandbox(t);
  const own = Buffer.from('a lightmap somebody re-baked');
  await put(join(root, MAPS, 'scene-01/arena.exr'), own);
  await assert.rejects(installFromArchive({ archive, root, assets, lightmaps }), /Preserved an existing lightmap/);
  assert.deepEqual(await readFile(join(root, MAPS, 'scene-01/arena.exr')), own);
});

test('refuses an archive whose content differs from the pin and leaves the installed file alone', async (t) => {
  const tampered = Buffer.from(pano); tampered[5] ^= 1;
  const { root, archive } = await sandbox(t, [goodFiles[0], [LOOK + 'look/setting1_pano.exr', tampered, false], goodFiles[2]]);
  const older = Buffer.from('an older panorama');
  await put(join(root, LOOK, 'look/setting1_pano.exr'), older);
  await assert.rejects(installFromArchive({ archive, root, assets, lightmaps }), /differs from the pinned asset/);
  assert.deepEqual(await readFile(join(root, LOOK, 'look/setting1_pano.exr')), older);
  assert.deepEqual(await readdir(join(root, LOOK, 'look')), ['board', 'setting1_pano.exr'], 'no temporary file is left behind');
});

test('refuses an archive that lacks a pinned file, or lists one with the wrong size', async (t) => {
  const missing = await sandbox(t, [goodFiles[0], goodFiles[2]]);
  await assert.rejects(installFromArchive({ ...missing, assets, lightmaps }), /The archive has no "main game\/public\/gameport-look\/look\/setting1_pano.exr"/);
  const short = await sandbox(t, [goodFiles[0], [LOOK + 'look/setting1_pano.exr', pano.subarray(0, 100), true], goodFiles[2]]);
  await assert.rejects(installFromArchive({ ...short, assets, lightmaps }), /wrong size/);
});

test('reads names with backslashes as paths and rejects files that are not zip archives', async (t) => {
  const { root, archive } = await sandbox(t, [[(LOOK + 'look/board/board.glb').replaceAll('/', '\\'), board, true]]);
  const handle = await open(archive, 'r');
  try { assert.deepEqual([...(await readZipDirectory(handle)).keys()], [LOOK + 'look/board/board.glb']); } finally { await handle.close(); }
  const plain = join(root, 'not-a-zip.bin');
  await writeFile(plain, Buffer.alloc(4096, 7));
  await assert.rejects(installFromArchive({ archive: plain, root, assets, lightmaps }), /Not a zip archive/);
});

test('the release pins are well formed and the look manifest is what the installer reads', async () => {
  assert.match(RELEASE.asset.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(RELEASE.asset.id) && RELEASE.asset.bytes > 0);
  assert.deepEqual(LIGHTMAPS.map((item) => item.path), ['scene-01/arena.exr', 'scene-01/environment.exr', 'scene-02/arena.exr', 'scene-02/environment.exr']);
  for (const item of LIGHTMAPS) assert.match(item.sha256, /^[a-f0-9]{64}$/);
  const manifest = JSON.parse(await readFile(new URL('../shared/play/look-assets.json', import.meta.url), 'utf8'));
  assert.equal(manifest.assets.length, 23);
  assert.equal(manifest.assets.reduce((n, item) => n + item.bytes, 0), 267180918);
  for (const item of manifest.assets) assert.ok(!item.path.startsWith('/') && !item.path.split('/').includes('..'), item.path);
});

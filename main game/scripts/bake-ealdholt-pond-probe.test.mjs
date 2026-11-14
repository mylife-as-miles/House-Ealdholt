import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hashServedPondProbeModel, parsePondProbeBakeArgs, preparePrivatePondProbeOutput,
  qualifyPondProbeHdr, readPondProbeAppOrigin, validatePondProbeModelUrl, writePrivatePondProbeFile } from './bake-ealdholt-pond-probe.mjs';

test('optional app origin reuses only a simple owned HTTP loopback server and keeps the default', () => {
  assert.equal(readPondProbeAppOrigin(), 'http://127.0.0.1:5173');
  assert.equal(readPondProbeAppOrigin(''), 'http://127.0.0.1:5173');
  for (const origin of ['http://127.0.0.1:4191', 'http://localhost:4191', 'http://[::1]:4191', 'http://localhost']) {
    assert.equal(readPondProbeAppOrigin(origin), origin);
  }
  assert.equal(readPondProbeAppOrigin('HTTP://LOCALHOST:80'), 'http://localhost');
  for (const origin of [null, 4191, 'https://localhost:4191', 'http://example.com:4191', 'http://127.0.0.2:4191',
    'http://127.1:4191', 'http://2130706433:4191', 'http://localhost.evil.test:4191', 'http://localhost.:4191',
    'http://user@localhost:4191', 'http://user:secret@127.0.0.1:4191', 'http://localhost:4191/',
    'http://localhost:4191/path', 'http://localhost:4191?', 'http://localhost:4191#', 'http://localhost:4191/?x=1',
    'http://localhost:0', 'http://localhost:65536', ' http://localhost:4191', 'http://localhost:4191\n']) {
    assert.throws(() => readPondProbeAppOrigin(origin), /simple HTTP loopback origin/);
  }
});

test('offline CLI refuses missing revisions, original/mismatched/nonlocal inputs and ambiguous arguments', () => {
  const args = ['--profile', 'quest', '--model-url', 'http://127.0.0.1:8066/elderbloom-village-quest-fixture.glb', '--output', '/workspace/private-assets/elderbloom/probes/new', '--lighting-version', 'fixture-r1'];
  assert.equal(parsePondProbeBakeArgs(args).profile, 'quest');
  assert.throws(() => parsePondProbeBakeArgs(args.slice(0, -2)));
  assert.throws(() => parsePondProbeBakeArgs([...args, '--profile', 'quest']));
  for (const url of ['http://example.com/elderbloom-village-quest-fixture.glb', 'file:///tmp/a.glb',
    'http://127.0.0.1:8066/ElderbloomOriginal.glb', 'http://127.0.0.1:8066/elderbloom-village-desktop-fixture.glb',
    'http://user:secret@127.0.0.1/elderbloom-village-quest-fixture.glb', 'http://127.0.0.1/elderbloom-village-quest-fixture.glb?other=1']) {
    assert.throws(() => validatePondProbeModelUrl(url, 'quest'));
  }
});

test('served model hashing streams exact GLB bytes and rejects oversized originals and redirects before rendering', async () => {
  const body = Buffer.alloc(64); body.writeUInt32LE(0x46546c67); body.writeUInt32LE(2, 4); body.writeUInt32LE(body.length, 8);
  const server = createServer((request, response) => {
    if (request.url.includes('huge')) { response.setHeader('Content-Length', 256 * 1024 * 1024 + 1); response.end(); return; }
    if (request.url.includes('redirect')) { response.writeHead(302, { Location: '/elderbloom-village-quest-fixture.glb' }).end(); return; }
    if (request.url.includes('invalid')) { response.end(Buffer.alloc(64)); return; }
    // Split the header across chunks to exercise actual streamed intake.
    response.write(body.subarray(0, 3)); setImmediate(() => { response.write(body.subarray(3, 7)); response.end(body.subarray(7)); });
  });
  try {
    await new Promise(done => server.listen(0, '127.0.0.1', done)); const origin = `http://127.0.0.1:${server.address().port}`;
    assert.deepEqual(await hashServedPondProbeModel(`${origin}/elderbloom-village-quest-fixture.glb`, 'quest'), {
      sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length,
    });
    for (const kind of ['huge', 'redirect', 'invalid']) await assert.rejects(hashServedPondProbeModel(`${origin}/elderbloom-village-quest-${kind}.glb`, 'quest'));
  } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
});

test('private output refuses overwrites, escapes, directory symlinks and file symlinks', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'crownfall-pond-probe-')), root = join(temporary, 'private'), outside = join(temporary, 'outside');
  try {
    await mkdir(root); await mkdir(outside); await writeFile(join(outside, 'existing.hdr'), 'preserve');
    const output = await preparePrivatePondProbeOutput(join(root, 'probes', 'new'), root);
    await writePrivatePondProbeFile(output, 'fixture.hdr', 'first');
    await assert.rejects(writePrivatePondProbeFile(output, 'fixture.hdr', 'second'));
    assert.equal(await readFile(join(output.path, 'fixture.hdr'), 'utf8'), 'first');
    await assert.rejects(preparePrivatePondProbeOutput(output.path, root));
    await assert.rejects(preparePrivatePondProbeOutput(join(outside, 'new'), root));
    await symlink(outside, join(root, 'linked'), 'dir'); await assert.rejects(preparePrivatePondProbeOutput(join(root, 'linked', 'new'), root));
    await symlink(join(outside, 'existing.hdr'), join(output.path, 'linked.hdr'));
    await assert.rejects(writePrivatePondProbeFile(output, 'linked.hdr', 'replace'));
    await assert.rejects(writePrivatePondProbeFile(output, '../existing.hdr', 'replace'));
    assert.equal(await readFile(join(outside, 'existing.hdr'), 'utf8'), 'preserve');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

function syntheticHdr(width, height, varied) {
  const parts = [Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`)];
  for (let y = 0; y < height; y++) {
    parts.push(Buffer.from([2, 2, width >> 8, width & 255]));
    for (let channel = 0; channel < 4; channel++) for (let x = 0; x < width; x += 127) {
      parts.push(Buffer.from([128 + Math.min(127, width - x), varied && y % 2 ? 0 : channel === 3 ? 129 : 128]));
    }
  }
  return Buffer.concat(parts);
}

test('actual public HDR-loader qualification records HDR range/variation and rejects black/constant/wrong profile', () => {
  const hdr = syntheticHdr(512, 256, true), result = qualifyPondProbeHdr(hdr, 'quest');
  assert.equal(result.threeRevision, '185'); assert.equal(result.width, 512); assert.equal(result.nonblackPixels, 512 * 128);
  assert.ok(result.maximumLinearRgb > 1); assert.ok(result.varianceLuminance > .1);
  assert.equal(result.hdrSha256, createHash('sha256').update(hdr).digest('hex'));
  assert.throws(() => qualifyPondProbeHdr(hdr, 'desktop'), /dimensions/);
  assert.throws(() => qualifyPondProbeHdr(syntheticHdr(512, 256, false), 'quest'), /constant/);
  assert.throws(() => qualifyPondProbeHdr(Buffer.alloc(100), 'quest'));
});

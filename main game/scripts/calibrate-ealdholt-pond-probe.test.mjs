import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePondProbeCalibrationArgs, preparePrivateCalibrationArtifact, preparePrivateCalibrationHdrArtifact,
  writePrivateCalibrationArtifact, writePrivateCalibrationHdr } from './calibrate-ealdholt-pond-probe.mjs';

test('calibration runner requires each actual app origin and never routes Native through Desktop Vite', () => {
  const args = (platform, origin) => ['--platform', platform, '--origin', origin, '--output', '/workspace/private-assets/elderbloom/calibration/new.json'];
  assert.equal(parsePondProbeCalibrationArgs(args('desktop', 'http://127.0.0.1:5173')).origin, 'http://127.0.0.1:5173');
  assert.equal(parsePondProbeCalibrationArgs(args('quest', 'https://localhost:8081')).platform, 'quest');
  assert.equal(parsePondProbeCalibrationArgs([...args('desktop', 'http://127.0.0.1:5173'), '--mode', 'capture']).mode, 'capture');
  assert.throws(() => parsePondProbeCalibrationArgs([...args('quest', 'https://localhost:8081'), '--mode', 'capture']), /Desktop-only/);
  for (const [platform, origin] of [['quest', 'http://127.0.0.1:5173'], ['desktop', 'https://localhost:8081'],
    ['quest', 'https://example.com:8081'], ['quest', 'https://localhost:8081/src/other'], ['quest', 'https://user:secret@localhost:8081']]) {
    assert.throws(() => parsePondProbeCalibrationArgs(args(platform, origin)));
  }
});

test('private calibration JSON supports existing real directories but refuses overwrites, symlinks and escapes', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'crownfall-calibration-')), root = join(temporary, 'private'), outside = join(temporary, 'outside');
  try {
    await mkdir(root); await mkdir(outside);
    const target = await preparePrivateCalibrationArtifact(join(root, 'nested', 'result.json'), root);
    await writePrivateCalibrationArtifact(target, '{"passed":true}');
    assert.equal(await readFile(join(root, 'nested', 'result.json'), 'utf8'), '{"passed":true}');
    await assert.rejects(preparePrivateCalibrationArtifact(join(root, 'nested', 'result.json'), root), /exists/);
    const direct = await preparePrivateCalibrationArtifact(join(root, 'direct.json'), root);
    await writePrivateCalibrationArtifact(direct, '{}'); assert.equal(await readFile(join(root, 'direct.json'), 'utf8'), '{}');
    await assert.rejects(preparePrivateCalibrationArtifact(join(outside, 'result.json'), root), /private storage/);
    await symlink(outside, join(root, 'linked'), 'dir'); await assert.rejects(preparePrivateCalibrationArtifact(join(root, 'linked', 'result.json'), root), /symlink/);
    await writeFile(join(outside, 'preserve.json'), 'preserve'); await symlink(join(outside, 'preserve.json'), join(root, 'linked.json'));
    await assert.rejects(preparePrivateCalibrationArtifact(join(root, 'linked.json'), root), /exists/);
    const late = await preparePrivateCalibrationArtifact(join(root, 'late.json'), root);
    await symlink(join(outside, 'preserve.json'), join(root, 'late.json')); await assert.rejects(writePrivateCalibrationArtifact(late, 'replace'));
    assert.equal(await readFile(join(outside, 'preserve.json'), 'utf8'), 'preserve');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('synthetic HDR companion is privately labelled and refuses overwrites and invalid payloads', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'crownfall-capture-calibration-'));
  try {
    const output = await preparePrivateCalibrationArtifact(join(temporary, 'capture.json'), temporary), hdr = await preparePrivateCalibrationHdrArtifact(output);
    assert.equal(hdr.filename, 'capture-synthetic-calibration.hdr');
    const bytes = Buffer.alloc(128); bytes.write('#?RADIANCE\n');
    await writePrivateCalibrationHdr(hdr, bytes); assert.deepEqual(await readFile(join(temporary, hdr.filename)), bytes);
    await assert.rejects(preparePrivateCalibrationHdrArtifact(output), /exists/);
    await assert.rejects(writePrivateCalibrationHdr(hdr, bytes));
    await assert.rejects(writePrivateCalibrationHdr({ ...hdr, filename: 'ordinary.hdr' }, bytes));
    await assert.rejects(writePrivateCalibrationHdr({ ...hdr, filename: 'invalid-synthetic-calibration.hdr' }, Buffer.alloc(128)), /Radiance/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

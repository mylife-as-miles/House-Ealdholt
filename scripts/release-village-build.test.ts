import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stripPrivatePreviewBuildInputs } from './private-preview-build-env';
import {
  RELEASE_VILLAGE_ABSENT_LINE, RELEASE_VILLAGE_DEFINE, copyReleaseVillage, prepareReleaseVillage,
  releaseVillagePlugin, releaseVillageSource, type ReleaseVillageSource,
} from './release-village-build';
import { RELEASE_VILLAGE_FILES, readReleaseVillage } from '../shared/legacy/aethelgard/release-village';

const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

/** A stand-in installation: tiny files under the real names, a manifest pinning them, and a receipt. */
async function standIn(options: { verified?: boolean; omit?: string; tamper?: string } = {}): Promise<ReleaseVillageSource & { cleanup(): Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'release-village-'));
  const files = new Map<string, string>();
  for (const profile of ['desktop', 'quest'] as const) {
    const names = RELEASE_VILLAGE_FILES[profile];
    const model = `stand-in ${profile} model`;
    files.set(names.model, model);
    files.set(names.hdr, `stand-in ${profile} radiance`);
    files.set(names.metadata, JSON.stringify({ version: 1, profile, modelSha256: sha(model), lightingVersion: `stand-in-${profile}-r1` }));
  }
  files.set('LICENSE-USE.md', 'stand-in licence');
  const assets = [...files].map(([name, content]) => ({ name, size: Buffer.byteLength(content), digest: 'sha256:' + sha(content) }));
  for (const [name, content] of files) if (name !== options.omit) await writeFile(join(directory, name), name === options.tamper ? content.replace(/.$/, '!') : content);
  await writeFile(join(directory, 'private-village-release.json'), JSON.stringify({ tag: 'stand-in', assets }));
  await writeFile(join(directory, 'installation.json'), JSON.stringify({ verified: options.verified ?? true, tag: 'stand-in', directory, assets }));
  return { directory, manifest: join(directory, 'private-village-release.json'), override: true, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('a verified installation yields only the profile files and their probe identity', async () => {
  const source = await standIn();
  try {
    const prepared = await prepareReleaseVillage(source, ['desktop']);
    assert.equal(prepared.status, 'ready');
    if (prepared.status !== 'ready') return;
    assert.deepEqual(prepared.files.map(file => file.name), Object.values(RELEASE_VILLAGE_FILES.desktop));
    const desktop = readReleaseVillage(prepared.marker, 'desktop');
    assert.equal(desktop?.modelSha256, sha('stand-in desktop model'));
    assert.equal(desktop?.lightingVersion, 'stand-in-desktop-r1');
    assert.equal(readReleaseVillage(prepared.marker, 'quest'), null, 'the desktop build carries no Quest files');
    const out = await mkdtemp(join(tmpdir(), 'release-village-out-'));
    try {
      await copyReleaseVillage(prepared, out);
      assert.deepEqual((await readdir(join(out, 'legacy/elderbloom'))).sort(), Object.values(RELEASE_VILLAGE_FILES.desktop).sort());
    } finally { await rm(out, { recursive: true, force: true }); }
  } finally { await source.cleanup(); }
});

test('a hash mismatch in a verified installation fails loudly', async () => {
  const source = await standIn({ tamper: RELEASE_VILLAGE_FILES.quest.model });
  try {
    await assert.rejects(prepareReleaseVillage(source, ['quest']), /integrity mismatch: elderbloom-village-quest/);
    // A file the app does not load is not read, so it cannot fail the other app's build.
    assert.equal((await prepareReleaseVillage(source, ['desktop'])).status, 'ready');
  } finally { await source.cleanup(); }
});

test('pond metadata that names another model fails loudly', async () => {
  const source = await standIn();
  try {
    const name = RELEASE_VILLAGE_FILES.desktop.metadata;
    const metadata = JSON.stringify({ version: 1, profile: 'desktop', modelSha256: sha('another model'), lightingVersion: 'stand-in-desktop-r1' });
    await writeFile(join(source.directory, name), metadata);
    const manifest = JSON.parse(await readFile(source.manifest, 'utf8'));
    const asset = manifest.assets.find((entry: { name: string }) => entry.name === name);
    Object.assign(asset, { size: Buffer.byteLength(metadata), digest: 'sha256:' + sha(metadata) });
    await writeFile(source.manifest, JSON.stringify(manifest));
    const receipt = JSON.parse(await readFile(join(source.directory, 'installation.json'), 'utf8'));
    receipt.assets = manifest.assets;
    await writeFile(join(source.directory, 'installation.json'), JSON.stringify(receipt));
    await assert.rejects(prepareReleaseVillage(source, ['desktop']), /does not match its desktop model/);
  } finally { await source.cleanup(); }
});

test('a missing file in a verified installation fails loudly', async () => {
  const source = await standIn({ omit: RELEASE_VILLAGE_FILES.desktop.hdr });
  try { await assert.rejects(prepareReleaseVillage(source, ['desktop']), /missing from the verified installation/); }
  finally { await source.cleanup(); }
});

test('no installation, or an unverified one, skips cleanly with one line and a null marker', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'release-village-empty-'));
  const unverified = await standIn({ verified: false });
  try {
    const source = { directory: empty, manifest: releaseVillageSource({}).manifest, override: false };
    assert.deepEqual(await prepareReleaseVillage(source, ['desktop']), { status: 'absent', reason: 'no installation' });
    assert.equal((await prepareReleaseVillage(unverified, ['quest'])).status, 'absent');
    const lines: string[] = [];
    const plugin = releaseVillagePlugin({ profiles: ['desktop'], source, log: line => lines.push(line) });
    const config = await plugin.config({}, { command: 'build' });
    assert.deepEqual(config, { define: { [RELEASE_VILLAGE_DEFINE]: 'null' } });
    assert.equal(lines.length, 1);
    assert.ok(lines[0].startsWith(RELEASE_VILLAGE_ABSENT_LINE), lines[0]);
    plugin.configResolved({ root: empty, build: { outDir: 'dist' } });
    await plugin.writeBundle({ dir: join(empty, 'dist') });
    assert.deepEqual(await readdir(empty), [], 'nothing is copied');
  } finally { await rm(empty, { recursive: true, force: true }); await unverified.cleanup(); }
});

test('development never reads the installation and never sees a release marker', async () => {
  const lines: string[] = [];
  const plugin = releaseVillagePlugin({ profiles: ['desktop'], source: { directory: '/nonexistent', manifest: '/nonexistent', override: true }, log: line => lines.push(line) });
  assert.deepEqual(await plugin.config({}, { command: 'serve' }), { define: { [RELEASE_VILLAGE_DEFINE]: 'null' } });
  assert.deepEqual(lines, []);
});

test('the release marker survives the private-input strip, and no VITE_ELDERBLOOM_ value reaches it', async () => {
  const source = await standIn();
  try {
    const environment: Record<string, string | undefined> = {
      VITE_ELDERBLOOM_PREVIEW_URL: 'http://127.0.0.1:4188/', VITE_ELDERBLOOM_POND_PROBES: '{"desktop":"operator-only-config"}',
    };
    stripPrivatePreviewBuildInputs('build', environment, { VITE_ELDERBLOOM_RESIDENT_PREVIEW: 'operator-only-resident' });
    const plugin = releaseVillagePlugin({ profiles: ['desktop', 'quest'], source, log: () => {} });
    const config = await plugin.config({}, { command: 'build' });
    const injected = config.define[RELEASE_VILLAGE_DEFINE];
    // The strip blanks every VITE_ELDERBLOOM_ input, and leaves the release marker as it is.
    const exposed: Record<string, string | undefined> = { ...environment, [RELEASE_VILLAGE_DEFINE]: injected };
    stripPrivatePreviewBuildInputs('build', exposed);
    assert.equal(exposed[RELEASE_VILLAGE_DEFINE], injected);
    assert.equal(exposed.VITE_ELDERBLOOM_PREVIEW_URL, '');
    assert.ok(!RELEASE_VILLAGE_DEFINE.startsWith('VITE_ELDERBLOOM_'));
    assert.notEqual(injected, 'null');
    assert.ok(readReleaseVillage(JSON.parse(injected), 'desktop') && readReleaseVillage(JSON.parse(injected), 'quest'));
    assert.doesNotMatch(injected, /127\.0\.0\.1|4188|operator-only|private-assets|VITE_ELDERBLOOM|release-village-|https?:/);
    assert.ok(!injected.includes(source.directory), 'no build-machine path');
  } finally { await source.cleanup(); }
});

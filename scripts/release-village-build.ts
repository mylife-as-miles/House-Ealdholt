import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RELEASE_VILLAGE_FILES, RELEASE_VILLAGE_PATH, isReleaseVillageLightingVersion,
  type ReleaseVillageMarker, type ReleaseVillageProfile,
} from '../shared/legacy/aethelgard/release-village';

/** Release builds ship the licensed Elderbloom village from the local, verified installation
 * (`npm run assets:village:install` into the ignored private-assets/elderbloom/). This Vite plugin copies only
 * the files each app loads into its output under RELEASE_VILLAGE_PATH, re-checking every SHA-256 against the
 * pinned release manifest, and injects a non-secret description under RELEASE_VILLAGE_DEFINE. Without a
 * verified installation the build still succeeds and My Legacy keeps its fallback screen.
 *
 * Nothing from .env files, no URL and no build-machine path reaches the bundle: the VITE_ELDERBLOOM_* inputs
 * stay blanked by private-preview-build-env.ts, and the marker holds only fixed file names, the release path
 * and the probe identity from the release's own metadata. */
export const RELEASE_VILLAGE_DEFINE = '__CROWNFALL_RELEASE_VILLAGE__';
export const RELEASE_VILLAGE_ABSENT_LINE = 'release village not installed: My Legacy will use its fallback screen';
/** Test-only: a folder holding a stand-in installation and its own private-village-release.json. */
export const RELEASE_VILLAGE_OVERRIDE_ENV = 'CROWNFALL_VILLAGE_DIR';

type Profile = keyof typeof RELEASE_VILLAGE_FILES;
interface ManifestAsset { name: string; size: number; digest: string }
interface ReleaseManifest { tag: string; assets: ManifestAsset[] }

export interface ReleaseVillageSource {
  /** The installation folder: installation.json plus the release files. */
  readonly directory: string;
  /** The pinned release manifest the files are checked against. */
  readonly manifest: string;
  readonly override: boolean;
}
export interface ReleaseVillageFile { readonly name: string; readonly source: string; readonly size: number; readonly digest: string }
export type PreparedReleaseVillage =
  | { readonly status: 'absent'; readonly reason: string }
  | { readonly status: 'ready'; readonly marker: ReleaseVillageMarker; readonly files: readonly ReleaseVillageFile[] };

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function releaseVillageSource(environment: Record<string, string | undefined> = process.env): ReleaseVillageSource {
  const override = environment[RELEASE_VILLAGE_OVERRIDE_ENV];
  if (override) {
    const directory = resolve(override);
    return { directory, manifest: join(directory, 'private-village-release.json'), override: true };
  }
  return { directory: resolve(repository, 'private-assets/elderbloom'), manifest: resolve(repository, 'scripts/private-village-release.json'), override: false };
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return 'sha256:' + hash.digest('hex');
}

async function readJson(file: string): Promise<unknown | undefined> {
  let text: string;
  try { text = await readFile(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  return JSON.parse(text);
}

function readManifest(raw: unknown, file: string): ReleaseManifest {
  const manifest = raw as Partial<ReleaseManifest> | undefined;
  if (!manifest || typeof manifest.tag !== 'string' || !Array.isArray(manifest.assets)
    || !manifest.assets.every(asset => asset && typeof asset.name === 'string' && /^[a-zA-Z0-9._-]+$/.test(asset.name)
      && Number.isSafeInteger(asset.size) && typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(asset.digest))) {
    throw new Error(`Release village manifest is malformed: ${file}`);
  }
  return manifest as ReleaseManifest;
}

/** Decides whether a release build carries the village, and verifies every file it would ship.
 * Absent or unverified installation: { status: 'absent' }. Verified installation whose files do not match
 * the manifest: throws, so the build fails loudly instead of shipping the wrong bytes. */
export async function prepareReleaseVillage(source: ReleaseVillageSource, profiles: readonly Profile[]): Promise<PreparedReleaseVillage> {
  let report: unknown;
  try { report = await readJson(join(source.directory, 'installation.json')); }
  catch { return { status: 'absent', reason: 'its installation.json is unreadable' }; }
  if (report === undefined) return { status: 'absent', reason: 'no installation' };
  const manifest = readManifest(await readJson(source.manifest), source.manifest);
  const installation = report as { verified?: unknown; tag?: unknown; assets?: unknown };
  if (installation.verified !== true || !Array.isArray(installation.assets)) return { status: 'absent', reason: 'the installation is not verified' };
  if (installation.tag !== manifest.tag) return { status: 'absent', reason: `the installation is not release ${manifest.tag}` };
  const installed = new Map((installation.assets as { name?: unknown; digest?: unknown }[]).map(asset => [asset?.name, asset?.digest]));
  const missing = manifest.assets.filter(asset => !installed.has(asset.name));
  if (missing.length) return { status: 'absent', reason: `the installation is incomplete (${missing.length} of ${manifest.assets.length} files missing)` };
  for (const asset of manifest.assets) {
    if (installed.get(asset.name) !== asset.digest) throw new Error(`Release village installation receipt disagrees with the manifest: ${asset.name}`);
  }

  const files: ReleaseVillageFile[] = [];
  const verify = async (name: string): Promise<ReleaseVillageFile> => {
    const expected = manifest.assets.find(asset => asset.name === name);
    if (!expected) throw new Error(`Release village manifest has no entry for ${name}`);
    const file = join(source.directory, name);
    let size: number;
    try { size = (await stat(file)).size; }
    catch { throw new Error(`Release village file is missing from the verified installation: ${name}`); }
    if (size !== expected.size) throw new Error(`Release village size mismatch: ${name} (expected ${expected.size} bytes, found ${size})`);
    const digest = await sha256File(file);
    if (digest !== expected.digest) throw new Error(`Release village integrity mismatch: ${name} (expected ${expected.digest}, found ${digest})`);
    const verified = { name, source: file, size, digest };
    files.push(verified);
    return verified;
  };
  const entries: Partial<Record<Profile, ReleaseVillageProfile>> = {};
  for (const profile of profiles) {
    const names = RELEASE_VILLAGE_FILES[profile];
    const model = await verify(names.model);
    await verify(names.hdr);
    const metadataFile = await verify(names.metadata);
    let metadata: Record<string, unknown>;
    try { metadata = JSON.parse(await readFile(metadataFile.source, 'utf8')); }
    catch { throw new Error(`Release village pond metadata is not JSON: ${names.metadata}`); }
    if (!metadata || metadata.profile !== profile || typeof metadata.modelSha256 !== 'string'
      || 'sha256:' + metadata.modelSha256.toLowerCase() !== model.digest) {
      throw new Error(`Release village pond metadata does not match its ${profile} model: ${names.metadata}`);
    }
    if (!isReleaseVillageLightingVersion(metadata.lightingVersion)) throw new Error(`Release village pond metadata has no usable lighting version: ${names.metadata}`);
    entries[profile] = Object.freeze({ ...names, modelSha256: metadata.modelSha256.toLowerCase(), lightingVersion: metadata.lightingVersion });
  }
  return { status: 'ready', marker: Object.freeze({ version: 1, path: RELEASE_VILLAGE_PATH, profiles: entries }), files };
}

/** Copies the verified files into the build output and checks each copy's hash once more, so the bytes that
 * ship are the bytes the manifest pins. A mismatch removes the copy and fails the build. */
export async function copyReleaseVillage(prepared: Extract<PreparedReleaseVillage, { status: 'ready' }>, outDir: string): Promise<string[]> {
  const target = join(outDir, ...RELEASE_VILLAGE_PATH.split('/').filter(Boolean));
  await mkdir(target, { recursive: true });
  const written: string[] = [];
  for (const file of prepared.files) {
    const destination = join(target, file.name);
    await copyFile(file.source, destination);
    const digest = await sha256File(destination);
    if (digest !== file.digest) {
      await unlink(destination);
      throw new Error(`Release village integrity mismatch after copying: ${file.name} (expected ${file.digest}, found ${digest})`);
    }
    written.push(destination);
  }
  return written;
}

interface ReleaseVillagePluginOptions {
  readonly profiles: readonly Profile[];
  readonly source?: ReleaseVillageSource;
  readonly log?: (line: string) => void;
}

/** The Vite plugin both apps use: `releaseVillagePlugin({ profiles: ['desktop'] })`. */
export function releaseVillagePlugin(options: ReleaseVillagePluginOptions) {
  const log = options.log ?? ((line: string) => console.log(line));
  let prepared: PreparedReleaseVillage | null = null;
  let outDir = '';
  return {
    name: 'crownfall-release-village',
    // Read by scripts/public-build-filter.ts: a build without the village leaves the village's public files out.
    api: { shipsVillage: () => prepared?.status === 'ready' },
    async config(_config: unknown, environment: { command: 'build' | 'serve' }) {
      // Development keeps its local asset server and never sees a release marker.
      if (environment.command !== 'build') return { define: { [RELEASE_VILLAGE_DEFINE]: 'null' } };
      const source = options.source ?? releaseVillageSource();
      if (source.override) log(`release village: using the test override folder (${RELEASE_VILLAGE_OVERRIDE_ENV})`);
      prepared = await prepareReleaseVillage(source, options.profiles);
      if (prepared.status === 'absent') log(`${RELEASE_VILLAGE_ABSENT_LINE} (${prepared.reason})`);
      else log(`release village: ${prepared.files.length} verified files for ${options.profiles.join(' and ')} will ship under ${RELEASE_VILLAGE_PATH}`);
      return { define: { [RELEASE_VILLAGE_DEFINE]: prepared.status === 'ready' ? JSON.stringify(prepared.marker) : 'null' } };
    },
    configResolved(config: { root: string; build: { outDir: string } }) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async writeBundle(output: { dir?: string }) {
      if (prepared?.status !== 'ready') return;
      const written = await copyReleaseVillage(prepared, output.dir ?? outDir);
      log(`release village: copied and re-verified ${written.length} files into ${RELEASE_VILLAGE_PATH}`);
    },
  };
}
